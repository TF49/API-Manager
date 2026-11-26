import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';
import { isCategory } from '@/lib/model-category';
import { schemaErrorMessage } from '@/lib/site-login';

/**
 * GET /api/changes - 倍率变动记录
 *   category  只看某个类别的分组
 *   type      up（涨价）/ down（降价）/ added（新增分组或模型上架）/ removed（分组下架或模型下架）
 *   site_id   只看某个站点
 *   since_id  额外返回 id 大于它的记录数（new_count），用于「未读变动」提示
 *   page, limit
 *
 * 涨价/降价同时包含分组倍率变动和模型基础价变动。
 */

const UP_SQL = "((c.change_type = 'ratio' AND c.new_ratio > c.old_ratio) OR (c.change_type = 'model_price' AND c.new_price > c.old_price))";
const DOWN_SQL = "((c.change_type = 'ratio' AND c.new_ratio < c.old_ratio) OR (c.change_type = 'model_price' AND c.new_price < c.old_price))";
const ADDED_SQL = "c.change_type IN ('added', 'model_added')";
const REMOVED_SQL = "c.change_type IN ('removed', 'model_removed')";

const TYPES = new Set(['up', 'down', 'added', 'removed']);

async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 30));
    const category = searchParams.get('category');
    const type = searchParams.get('type');
    const siteId = Number(searchParams.get('site_id'));

    const where: string[] = [];
    const params: unknown[] = [];
    if (category && isCategory(category)) {
      where.push('FIND_IN_SET(?, c.categories)');
      params.push(category);
    }
    if (type && TYPES.has(type)) {
      where.push({ up: UP_SQL, down: DOWN_SQL, added: ADDED_SQL, removed: REMOVED_SQL }[type as 'up' | 'down' | 'added' | 'removed']);
    }
    if (Number.isInteger(siteId) && siteId > 0) {
      where.push('c.site_id = ?');
      params.push(siteId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.site_id, s.name AS site_name, c.group_name, c.model_name, c.group_count, c.change_type,
              c.old_ratio, c.new_ratio, c.price_billing, c.old_price, c.new_price, c.categories, c.created_at
       FROM price_group_changes c
       JOIN sites s ON s.id = c.site_id
       ${whereSql}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const [[{ total }]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM price_group_changes c ${whereSql}`,
      params
    );
    const [[stats]] = await pool.query<RowDataPacket[]>(
      `SELECT
         SUM(${DOWN_SQL}) AS down_24h,
         SUM(${UP_SQL}) AS up_24h,
         SUM(${ADDED_SQL}) AS added_24h,
         SUM(${REMOVED_SQL}) AS removed_24h,
         (SELECT MAX(id) FROM price_group_changes) AS latest_id
       FROM price_group_changes c
       WHERE c.created_at >= NOW() - INTERVAL 1 DAY`
    );

    let newCount: number | null = null;
    const sinceId = Number(searchParams.get('since_id'));
    if (searchParams.has('since_id') && Number.isFinite(sinceId) && sinceId >= 0) {
      const [[r]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM price_group_changes WHERE id > ?', [sinceId]);
      newCount = Number(r.n);
    }

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ ...r, categories: r.categories ? String(r.categories).split(',') : [] })),
      total: Number(total),
      page,
      limit,
      stats_24h: {
        down: Number(stats?.down_24h ?? 0),
        up: Number(stats?.up_24h ?? 0),
        added: Number(stats?.added_24h ?? 0),
        removed: Number(stats?.removed_24h ?? 0),
      },
      latest_id: stats?.latest_id === null || stats?.latest_id === undefined ? 0 : Number(stats.latest_id),
      new_count: newCount,
    });
  } catch (err: unknown) {
    const msg = schemaErrorMessage(err) ?? (err instanceof Error ? err.message : '查询失败');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/changes - 清空变动记录
async function handleDELETE() {
  try {
    await pool.query('DELETE FROM price_group_changes');
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '清空失败' }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const DELETE = withAuth(handleDELETE);
