import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';
import { parseCategoryList, isCategory } from '@/lib/model-category';
import { syncSite } from '@/lib/price-sync';
import { schemaErrorMessage } from '@/lib/site-login';

function dbErrorMessage(err: unknown, fallback: string): string {
  return schemaErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

// GET /api/sites/[id]/price-groups - 已保存的分组倍率，附带每个分组的模型和类别
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [groups] = await pool.query<RowDataPacket[]>(
      `SELECT group_name, ratio, svip_ratio, prev_ratio, ratio_changed_at, description, model_count,
              platform, categories, category_override, fetched_at
       FROM site_price_groups
       WHERE site_id = ?
       ORDER BY ratio IS NULL, ratio ASC, group_name ASC`,
      [id]
    );
    const [models] = await pool.query<RowDataPacket[]>(
      `SELECT group_name, model_name, category, billing, input_price, output_price, request_price
       FROM site_group_models WHERE site_id = ? ORDER BY model_name`,
      [id]
    );
    const byGroup = new Map<string, RowDataPacket[]>();
    for (const m of models) {
      let list = byGroup.get(m.group_name);
      if (!list) byGroup.set(m.group_name, (list = []));
      list.push(m);
    }

    const data = groups.map((g) => ({
      ...g,
      categories: parseCategoryList(g.category_override) ?? parseCategoryList(g.categories) ?? [],
      auto_categories: parseCategoryList(g.categories) ?? [],
      category_overridden: !!parseCategoryList(g.category_override),
      models: (byGroup.get(g.group_name) ?? []).map((m) => ({
        name: m.model_name,
        category: m.category,
        billing: m.billing,
        input: m.input_price,
        output: m.output_price,
        request: m.request_price,
      })),
    }));
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: dbErrorMessage(err, '获取分组失败') }, { status: 500 });
  }
}

const SYNC_STATUS = { unsafe_url: 400, auth: 422, upstream: 502, not_found: 404, internal: 500 } as const;

// POST /api/sites/[id]/price-groups - 从站点重新拉取分组倍率并同步
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    return NextResponse.json({ success: false, error: '站点 ID 无效' }, { status: 400 });
  }
  try {
    const r = await syncSite(siteId);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: SYNC_STATUS[r.kind] });
    return NextResponse.json({ success: true, data: r });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: dbErrorMessage(err, '获取分组失败') }, { status: 500 });
  }
}

// PATCH /api/sites/[id]/price-groups - 手动设置分组类别 { group_name, categories: string[] | null }
async function handlePATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const groupName = body && typeof body.group_name === 'string' ? body.group_name : '';
    if (!groupName || groupName.length > 100) {
      return NextResponse.json({ success: false, error: '缺少分组名' }, { status: 400 });
    }
    let override: string | null = null;
    if (Array.isArray(body.categories) && body.categories.length) {
      if (!body.categories.every(isCategory)) {
        return NextResponse.json({ success: false, error: '类别无效' }, { status: 400 });
      }
      override = parseCategoryList(body.categories.join(','))!.join(',');
    }
    const [result] = await pool.query<import('mysql2').ResultSetHeader>(
      'UPDATE site_price_groups SET category_override = ? WHERE site_id = ? AND group_name = ?',
      [override, id, groupName]
    );
    if (!result.affectedRows) return NextResponse.json({ success: false, error: '分组不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: dbErrorMessage(err, '保存失败') }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
export const PATCH = withAuth(handlePATCH);
