import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';
import { UnsafeUrlError } from '@/lib/net/safe-fetch';
import { fetchPriceGroups } from '@/lib/price-groups';

interface SiteRow extends RowDataPacket {
  id: number;
  name: string;
  base_url: string;
}

function dbErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ER_NO_SUCH_TABLE') {
    return '数据表不存在，请先运行 npm run db:init 完成数据库迁移';
  }
  return err instanceof Error ? err.message : fallback;
}

// GET /api/sites/[id]/price-groups - 已保存的分组倍率
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT group_name, ratio, svip_ratio, prev_ratio, ratio_changed_at, description, model_count, fetched_at
       FROM site_price_groups
       WHERE site_id = ?
       ORDER BY ratio IS NULL, ratio ASC, group_name ASC`,
      [id]
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: dbErrorMessage(err, '获取分组失败') }, { status: 500 });
  }
}

// POST /api/sites/[id]/price-groups - 从站点重新拉取分组倍率并同步
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const start = Date.now();
  let siteName = '';

  try {
    const [sites] = await pool.query<SiteRow[]>('SELECT id, name, base_url FROM sites WHERE id = ?', [id]);
    if (!sites.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    const site = sites[0];
    siteName = site.name;

    let result;
    try {
      result = await fetchPriceGroups(site.base_url);
    } catch (err: unknown) {
      const latency = Date.now() - start;
      const msg = err instanceof Error ? err.message : '获取分组失败';
      await logHistory(id, siteName, 'error', latency, msg.slice(0, 1000));
      const status = err instanceof UnsafeUrlError ? 400 : 502;
      return NextResponse.json({ success: false, error: msg }, { status });
    }

    const latency = Date.now() - start;
    const names = result.groups.map((g) => g.name);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM site_price_groups WHERE site_id = ? AND group_name NOT IN (?)', [id, names]);
      for (const g of result.groups) {
        // 赋值按顺序执行：先根据旧 ratio 记录变动，再写入新 ratio
        await conn.query(
          `INSERT INTO site_price_groups (site_id, group_name, ratio, svip_ratio, description, model_count, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             ratio_changed_at = IF(ratio <=> VALUES(ratio), ratio_changed_at, NOW()),
             prev_ratio = IF(ratio <=> VALUES(ratio), prev_ratio, ratio),
             ratio = VALUES(ratio),
             svip_ratio = VALUES(svip_ratio),
             description = VALUES(description),
             model_count = VALUES(model_count),
             fetched_at = NOW()`,
          [id, g.name, g.ratio, g.svip_ratio, g.description, g.model_count]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logHistory(id, siteName, 'ok', latency, null);

    return NextResponse.json({
      success: true,
      data: { count: result.groups.length, latency_ms: latency, origin: result.origin, sources: result.sources },
    });
  } catch (err: unknown) {
    const msg = dbErrorMessage(err, '获取分组失败');
    await logHistory(id, siteName, 'error', Date.now() - start, msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

async function logHistory(siteId: string, siteName: string, status: string, latency: number, errorMsg: string | null) {
  try {
    await pool.query(
      `INSERT INTO call_history (site_id, site_name, action_type, status, status_code, latency_ms, error_msg)
       VALUES (?, ?, 'fetch_groups', ?, NULL, ?, ?)`,
      [siteId, siteName, status, latency, errorMsg]
    );
  } catch {
    /* ignore logging errors */
  }
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
