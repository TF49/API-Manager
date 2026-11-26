import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { UnsafeUrlError } from '@/lib/net/safe-fetch';
import { fetchPriceGroups, PriceGroupsAuthError, type GroupModel, type PriceGroup } from '@/lib/price-groups';
import { classifyGroup, classifyModel } from '@/lib/model-category';
import { siteCredentials } from '@/lib/site-login';

/**
 * 同步一个站点的分组、模型和倍率，并记录变动。
 * 手动刷新和定时任务共用；同一站点同时只跑一次（进程内锁，挂在 globalThis 上，
 * 这样 Route Handler 和 instrumentation 即使是不同的模块实例也共享同一把锁）。
 */

export type SyncErrorKind = 'unsafe_url' | 'auth' | 'upstream' | 'not_found' | 'internal';

export type SyncResult =
  | { ok: true; site_id: number; count: number; architecture: string; sources: string[]; latency_ms: number; changes: number }
  | { ok: false; site_id: number; error: string; kind: SyncErrorKind; latency_ms: number };

interface SiteRow extends RowDataPacket {
  id: number;
  name: string;
  base_url: string;
  login_email: string | null;
  login_password_encrypted: string | null;
}

interface ExistingGroup extends RowDataPacket {
  group_name: string;
  ratio: number | null;
  categories: string | null;
  category_override: string | null;
}

interface ExistingModel extends RowDataPacket {
  group_name: string;
  model_name: string;
  billing: 'token' | 'request';
  input_price: number | null;
  request_price: number | null;
}

type SyncState = { inflight: Map<number, Promise<SyncResult>>; queued: Map<number, Promise<SyncResult>> };
const g = globalThis as typeof globalThis & { __priceSync?: SyncState };
const state = (g.__priceSync ??= { inflight: new Map(), queued: new Map() });

/**
 * 同步站点。
 * fresh=false（定时任务、手动刷新）：已在同步时直接复用正在跑的结果。
 * fresh=true（刚修改了站点地址或登录信息）：已在同步时排队，等它结束后再用新配置跑一次，
 *   否则正在跑的那次读到的还是旧配置。
 */
export function syncSite(siteId: number, opts: { fresh?: boolean } = {}): Promise<SyncResult> {
  const running = state.inflight.get(siteId);
  if (!running) {
    const p = doSync(siteId).finally(() => state.inflight.delete(siteId));
    state.inflight.set(siteId, p);
    return p;
  }
  if (!opts.fresh) return running;
  const queued = state.queued.get(siteId);
  if (queued) return queued;
  const next = running
    .catch(() => undefined)
    .then(() => {
      state.queued.delete(siteId);
      return syncSite(siteId);
    });
  state.queued.set(siteId, next);
  return next;
}

export function isSyncing(siteId: number): boolean {
  return state.inflight.has(siteId);
}

function errorKind(err: unknown): SyncErrorKind {
  if (err instanceof UnsafeUrlError) return 'unsafe_url';
  if (err instanceof PriceGroupsAuthError) return 'auth';
  return 'upstream';
}

const RETRYABLE_DB_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MAX_ATTEMPTS = 3;

async function doSync(siteId: number): Promise<SyncResult> {
  const start = Date.now();
  const [sites] = await pool.query<SiteRow[]>(
    'SELECT id, name, base_url, login_email, login_password_encrypted FROM sites WHERE id = ?',
    [siteId]
  );
  if (!sites.length) return { ok: false, site_id: siteId, error: '站点不存在', kind: 'not_found', latency_ms: 0 };
  const site = sites[0];

  let result;
  try {
    result = await fetchPriceGroups(site.base_url, { sub2api: siteCredentials(site) });
  } catch (err) {
    const msg = (err instanceof Error ? err.message : '获取分组失败').slice(0, 1000);
    await pool
      .query('UPDATE sites SET last_fetched_at = NOW(), last_fetch_ok = 0, last_fetch_error = ? WHERE id = ?', [msg, siteId])
      .catch(() => {});
    return { ok: false, site_id: siteId, error: msg, kind: errorKind(err), latency_ms: Date.now() - start };
  }

  const latency = Date.now() - start;
  // 并发同步多个站点时，写库可能因为间隙锁互相死锁；遇到死锁或锁等待超时重试整次写入
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 获取期间站点地址被改了（或站点被删了）：这次拿到的是旧上游的数据，丢弃，由排队的新同步处理
      const [cur] = await conn.query<RowDataPacket[]>('SELECT base_url FROM sites WHERE id = ? FOR UPDATE', [siteId]);
      if (!cur.length || cur[0].base_url !== site.base_url) {
        await conn.rollback();
        return { ok: false, site_id: siteId, error: '站点地址在获取期间被修改，本次结果已丢弃', kind: 'internal', latency_ms: latency };
      }
      const changes = await writeGroups(conn, siteId, result.groups);
      await conn.query(
        `UPDATE sites SET architecture = ?, last_fetched_at = NOW(), last_success_at = NOW(),
           last_fetch_ok = 1, last_fetch_error = NULL WHERE id = ?`,
        [result.architecture, siteId]
      );
      await conn.commit();
      return {
        ok: true,
        site_id: siteId,
        count: result.groups.length,
        architecture: result.architecture,
        sources: result.sources,
        latency_ms: latency,
        changes,
      };
    } catch (err) {
      await conn.rollback().catch(() => {});
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (!code || !RETRYABLE_DB_CODES.has(code) || attempt === MAX_ATTEMPTS) break;
    } finally {
      conn.release();
    }
  }
  const msg = (lastErr instanceof Error ? lastErr.message : '保存分组失败').slice(0, 1000);
  return { ok: false, site_id: siteId, error: msg, kind: 'internal', latency_ms: latency };
}

// ---------------------------------------------------------------------------
// 模型级变动（纯函数，便于测试）
// ---------------------------------------------------------------------------

export interface OldModelRow {
  group: string;
  model: string;
  billing: 'token' | 'request';
  input: number | null;
  request: number | null;
}

export interface ModelChange {
  type: 'model_price' | 'model_added' | 'model_removed';
  model: string;
  /** 涉及的分组（按名称排序），记录时取第一个并保存总数 */
  groups: string[];
  billing: 'token' | 'request' | null;
  old_price: number | null;
  new_price: number | null;
}

function basePrice(m: { billing: 'token' | 'request'; input: number | null; request: number | null }): number | null {
  return m.billing === 'request' ? m.request : m.input;
}

/**
 * 对比同一站点前后两次的模型数据，按「模型 + 变动」聚合（同一个模型在多个分组里同样变动只记一条）：
 *  - model_price：分组里的模型基础价（输入价或按次价）变了
 *  - model_added / model_removed：原本就存在的分组里，多了 / 少了这个模型
 * 新增或下架的分组本身已有分组级记录，不再逐个模型记；本次没有模型数据的分组跳过。
 */
export function diffModels(oldRows: OldModelRow[], groups: PriceGroup[]): ModelChange[] {
  const oldByGroup = new Map<string, Map<string, OldModelRow>>();
  for (const r of oldRows) {
    let m = oldByGroup.get(r.group);
    if (!m) oldByGroup.set(r.group, (m = new Map()));
    m.set(r.model, r);
  }

  const agg = new Map<string, ModelChange>();
  const add = (key: string, c: Omit<ModelChange, 'groups'>, group: string) => {
    const e = agg.get(key);
    if (e) e.groups.push(group);
    else agg.set(key, { ...c, groups: [group] });
  };

  for (const grp of groups) {
    const before = oldByGroup.get(grp.name);
    if (!before || !grp.models) continue; // 新分组，或本次没有模型数据
    const now = new Map<string, GroupModel>(grp.models.map((m) => [m.name, m]));

    for (const m of grp.models) {
      const o = before.get(m.name);
      if (!o) {
        add(`added\u0000${m.name}`, { type: 'model_added', model: m.name, billing: m.billing, old_price: null, new_price: basePrice(m) }, grp.name);
        continue;
      }
      const oldP = basePrice(o);
      const newP = basePrice(m);
      if (o.billing !== m.billing || oldP !== newP) {
        add(
          `price\u0000${m.name}\u0000${m.billing}\u0000${oldP}\u0000${newP}`,
          { type: 'model_price', model: m.name, billing: m.billing, old_price: oldP, new_price: newP },
          grp.name
        );
      }
    }
    for (const o of before.values()) {
      if (!now.has(o.model)) {
        add(`removed\u0000${o.model}`, { type: 'model_removed', model: o.model, billing: o.billing, old_price: basePrice(o), new_price: null }, grp.name);
      }
    }
  }

  const out = [...agg.values()];
  for (const c of out) c.groups.sort((a, b) => a.localeCompare(b));
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.model.localeCompare(b.model));
}

const INSERT_CHUNK = 500;

/** 写入分组和模型，返回记录的变动条数 */
async function writeGroups(conn: PoolConnection, siteId: number, groups: PriceGroup[]): Promise<number> {
  const [existingRows] = await conn.query<ExistingGroup[]>(
    'SELECT group_name, ratio, categories, category_override FROM site_price_groups WHERE site_id = ? FOR UPDATE',
    [siteId]
  );
  const existing = new Map(existingRows.map((r) => [r.group_name, r]));
  // 站点第一次获取（或换了上游被清空）时不记录变动，避免一次产生几十条噪音
  const firstFetch = existing.size === 0;

  const [oldModelRows] = await conn.query<ExistingModel[]>(
    'SELECT group_name, model_name, billing, input_price, request_price FROM site_group_models WHERE site_id = ?',
    [siteId]
  );

  const changeRows: unknown[][] = [];
  const pushChange = (row: {
    group: string;
    type: string;
    oldRatio?: number | null;
    newRatio?: number | null;
    cats: string | null;
    model?: string | null;
    groupCount?: number | null;
    billing?: string | null;
    oldPrice?: number | null;
    newPrice?: number | null;
  }) =>
    changeRows.push([
      siteId,
      row.group,
      row.model ?? null,
      row.groupCount ?? null,
      row.type,
      row.oldRatio ?? null,
      row.newRatio ?? null,
      row.billing ?? null,
      row.oldPrice ?? null,
      row.newPrice ?? null,
      row.cats,
    ]);

  const newNames = new Set<string>();
  for (const grp of groups) {
    newNames.add(grp.name);
    const cats = classifyGroup({
      models: (grp.models ?? []).map((m) => m.name),
      platform: grp.platform,
      name: grp.name,
      description: grp.description,
    }).join(',');
    const old = existing.get(grp.name);
    const effectiveCats = old?.category_override || cats;

    if (old && old.ratio !== grp.ratio) {
      pushChange({ group: grp.name, type: 'ratio', oldRatio: old.ratio, newRatio: grp.ratio, cats: effectiveCats });
    } else if (!old && !firstFetch) {
      pushChange({ group: grp.name, type: 'added', newRatio: grp.ratio, cats: effectiveCats });
    }

    // 赋值按顺序执行：先根据旧 ratio 记录变动，再写入新 ratio
    await conn.query(
      `INSERT INTO site_price_groups
         (site_id, group_name, ratio, svip_ratio, description, model_count, platform, categories, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         ratio_changed_at = IF(ratio <=> VALUES(ratio), ratio_changed_at, NOW()),
         prev_ratio = IF(ratio <=> VALUES(ratio), prev_ratio, ratio),
         ratio = VALUES(ratio),
         svip_ratio = VALUES(svip_ratio),
         description = VALUES(description),
         model_count = VALUES(model_count),
         platform = VALUES(platform),
         categories = VALUES(categories),
         fetched_at = NOW()`,
      [siteId, grp.name, grp.ratio, grp.svip_ratio, grp.description, grp.model_count, grp.platform, cats]
    );
  }

  const removed = existingRows.filter((r) => !newNames.has(r.group_name));
  for (const r of removed) {
    pushChange({ group: r.group_name, type: 'removed', oldRatio: r.ratio, cats: r.category_override || r.categories });
  }
  if (removed.length) {
    await conn.query('DELETE FROM site_price_groups WHERE site_id = ? AND group_name IN (?)', [
      siteId,
      removed.map((r) => r.group_name),
    ]);
  }

  // 模型级变动：之前完全没有模型数据时（第一次获取或旧版本数据）不记录
  if (!firstFetch && oldModelRows.length) {
    const oldRows: OldModelRow[] = oldModelRows.map((r) => ({
      group: r.group_name,
      model: r.model_name,
      billing: r.billing,
      input: r.input_price,
      request: r.request_price,
    }));
    for (const c of diffModels(oldRows, groups)) {
      pushChange({
        group: c.groups[0],
        type: c.type,
        model: c.model,
        groupCount: c.groups.length,
        billing: c.billing,
        oldPrice: c.old_price,
        newPrice: c.new_price,
        cats: classifyModel(c.model),
      });
    }
  }

  // 模型整表替换：没有模型数据（null）的分组不写
  await conn.query('DELETE FROM site_group_models WHERE site_id = ?', [siteId]);
  const modelRows: unknown[][] = [];
  for (const grp of groups) {
    for (const m of grp.models ?? []) {
      modelRows.push([siteId, grp.name, m.name, classifyModel(m.name), m.billing, m.input, m.output, m.request]);
    }
  }
  for (let i = 0; i < modelRows.length; i += INSERT_CHUNK) {
    await conn.query(
      `INSERT IGNORE INTO site_group_models
         (site_id, group_name, model_name, category, billing, input_price, output_price, request_price)
       VALUES ?`,
      [modelRows.slice(i, i + INSERT_CHUNK)]
    );
  }

  if (changeRows.length) {
    await conn.query(
      `INSERT INTO price_group_changes
         (site_id, group_name, model_name, group_count, change_type, old_ratio, new_ratio, price_billing, old_price, new_price, categories)
       VALUES ?`,
      [changeRows]
    );
  }
  return changeRows.length;
}

/** 换了上游站点时清空旧数据，下次同步按第一次获取处理（不会和旧上游对比出假变动） */
export async function resetSiteData(siteId: number): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM site_group_models WHERE site_id = ?', [siteId]);
    await conn.query('DELETE FROM site_price_groups WHERE site_id = ?', [siteId]);
    await conn.query(
      'UPDATE sites SET architecture = NULL, last_fetched_at = NULL, last_success_at = NULL, last_fetch_ok = NULL, last_fetch_error = NULL WHERE id = ?',
      [siteId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** 同步所有站点，最多 concurrency 个并发 */
export async function syncAllSites(concurrency = 3): Promise<SyncResult[]> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM sites ORDER BY id');
  const ids = rows.map((r) => Number(r.id));
  const results: SyncResult[] = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        results.push(await syncSite(id));
      } catch (err) {
        results.push({
          ok: false,
          site_id: id,
          error: err instanceof Error ? err.message : '同步失败',
          kind: 'internal',
          latency_ms: 0,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}
