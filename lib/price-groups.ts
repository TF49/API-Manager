import { safeFetch, UnsafeUrlError } from '@/lib/net/safe-fetch';

/**
 * 获取中转站（new-api / one-api 系）的计费分组及倍率。
 *
 * 数据来源（均为站点公开接口，不发送任何 API Key）：
 *  - GET /api/pricing      → group_ratio（倍率）、usable_group（说明）、data[].enable_groups（各分组可用模型）
 *  - GET /api/user/groups  → { [分组]: { ratio, desc, svip_ratio? } }
 * 两者合并，任一可用即可。
 */

export interface PriceGroup {
  name: string;
  ratio: number | null;
  /** 部分魔改版 new-api 额外返回的会员倍率 */
  svip_ratio: number | null;
  description: string | null;
  /** 该分组下可用的模型数量（来自 /api/pricing） */
  model_count: number | null;
}

export interface PriceGroupsResult {
  origin: string;
  groups: PriceGroup[];
  sources: string[];
}

const MAX_GROUPS = 500;
const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 500;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

type GroupMap = Map<string, { ratio?: number | null; svip_ratio?: number | null; description?: string | null; model_count?: number }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toRatio(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function cleanName(v: string): string | null {
  const name = v.trim();
  return name && name.length <= MAX_NAME_LEN ? name : null;
}

function cleanDesc(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const desc = v.trim();
  return desc ? desc.slice(0, MAX_DESC_LEN) : null;
}

function entry(map: GroupMap, rawName: string) {
  const name = cleanName(rawName);
  if (!name) return null;
  let e = map.get(name);
  if (!e) {
    if (map.size >= MAX_GROUPS) return null;
    e = {};
    map.set(name, e);
  }
  return e;
}

/** 解析 /api/pricing 的响应 */
export function parsePricingResponse(json: unknown): GroupMap {
  const map: GroupMap = new Map();
  if (!isRecord(json) || json.success === false) return map;

  if (isRecord(json.group_ratio)) {
    for (const [name, ratio] of Object.entries(json.group_ratio)) {
      const e = entry(map, name);
      if (e) e.ratio = toRatio(ratio);
    }
  }

  if (isRecord(json.usable_group)) {
    for (const [name, desc] of Object.entries(json.usable_group)) {
      const e = entry(map, name);
      if (e) e.description = cleanDesc(desc);
    }
  }

  if (Array.isArray(json.data)) {
    const counts = new Map<string, number>();
    for (const model of json.data) {
      if (!isRecord(model) || !Array.isArray(model.enable_groups)) continue;
      for (const g of new Set(model.enable_groups)) {
        if (typeof g !== 'string') continue;
        const name = cleanName(g);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    // 只给已知分组计数，避免模型里的杂项分组名凭空生成分组
    for (const [name, e] of map) e.model_count = counts.get(name) || 0;
  }

  return map;
}

/** 解析 /api/user/groups 的响应 */
export function parseUserGroupsResponse(json: unknown): GroupMap {
  const map: GroupMap = new Map();
  if (!isRecord(json) || json.success === false || !isRecord(json.data)) return map;

  for (const [name, info] of Object.entries(json.data)) {
    if (!isRecord(info)) continue;
    const e = entry(map, name);
    if (!e) continue;
    e.ratio = toRatio(info.ratio);
    e.svip_ratio = toRatio(info.svip_ratio);
    e.description = cleanDesc(info.desc);
  }
  return map;
}

/** 合并两个来源；倍率以 /api/pricing 为准，按倍率从低到高排序 */
export function mergePriceGroups(pricing: GroupMap, userGroups: GroupMap): PriceGroup[] {
  const names = new Set([...pricing.keys(), ...userGroups.keys()]);
  const groups: PriceGroup[] = [];

  for (const name of names) {
    const p = pricing.get(name) || {};
    const u = userGroups.get(name) || {};
    const ratio = p.ratio ?? u.ratio ?? null;
    if (ratio === null) continue; // 没有倍率的分组没有意义
    groups.push({
      name,
      ratio,
      svip_ratio: u.svip_ratio ?? null,
      description: p.description ?? u.description ?? null,
      model_count: p.model_count ?? null,
    });
    if (groups.length >= MAX_GROUPS) break;
  }

  return groups.sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.name.localeCompare(b.name));
}

/**
 * 规范化用户随手输入的地址：去空白，缺协议时补 https://，只保留 http/https。
 * 返回 null 表示无法识别为网址。
 */
export function normalizeLookupUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 500 || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 根据站点 Base URL 推导要尝试的站点根地址。
 * Base URL 常填 API 子域（如 https://api.example.com/v1），而分组接口通常在同一 new-api 实例上，
 * 若不行再尝试去掉 "api." 前缀的主域。
 */
export function candidateOrigins(baseUrl: string): string[] {
  const url = new URL(baseUrl.trim());
  const origins = [url.origin];
  if (url.hostname.toLowerCase().startsWith('api.') && url.hostname.split('.').length > 2) {
    const bare = new URL(url.origin);
    bare.hostname = url.hostname.slice(4);
    origins.push(bare.origin);
  }
  return origins;
}

async function readTextCapped(res: Awaited<ReturnType<typeof safeFetch>>): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_BODY_BYTES) {
    await res.body?.cancel();
    throw new Error('响应过大');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('响应过大');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await safeFetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await readTextCapped(res);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}，返回的不是 JSON（可能不是 new-api 站点）`);
  }
  if (!res.ok || (isRecord(json) && json.success === false)) {
    const msg = isRecord(json) && typeof json.message === 'string' ? json.message.slice(0, 200) : '';
    throw new Error(`HTTP ${res.status}${msg ? `：${msg}` : ''}`);
  }
  return json;
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return '请求超时';
  return err instanceof Error ? err.message : String(err);
}

export async function fetchPriceGroups(baseUrl: string): Promise<PriceGroupsResult> {
  const failures: string[] = [];

  for (const origin of candidateOrigins(baseUrl)) {
    const [pricing, userGroups] = await Promise.allSettled([
      fetchJson(`${origin}/api/pricing`),
      fetchJson(`${origin}/api/user/groups`),
    ]);

    // SSRF 拦截等安全错误直接抛出，不再尝试其他地址
    for (const r of [pricing, userGroups]) {
      if (r.status === 'rejected' && r.reason instanceof UnsafeUrlError) throw r.reason;
    }

    const pricingMap = pricing.status === 'fulfilled' ? parsePricingResponse(pricing.value) : new Map();
    const userMap = userGroups.status === 'fulfilled' ? parseUserGroupsResponse(userGroups.value) : new Map();
    const groups = mergePriceGroups(pricingMap, userMap);

    if (groups.length) {
      const sources: string[] = [];
      if (pricingMap.size) sources.push('/api/pricing');
      if (userMap.size) sources.push('/api/user/groups');
      return { origin, groups, sources };
    }

    const reasons = [
      `/api/pricing ${pricing.status === 'rejected' ? describeError(pricing.reason) : '无分组数据'}`,
      `/api/user/groups ${userGroups.status === 'rejected' ? describeError(userGroups.reason) : '无分组数据'}`,
    ];
    failures.push(`${origin}（${reasons.join('；')}）`);
  }

  throw new Error(`未能获取分组信息，站点可能不是 new-api/one-api 架构，或价格页需要登录。尝试过：${failures.join('，')}`);
}
