import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/guard';
import { isCategory } from '@/lib/model-category';
import { schedulerStatus } from '@/lib/price-scheduler';
import { schemaErrorMessage } from '@/lib/site-login';

/**
 * GET /api/compare?category=gpt[&model=gpt-4o]
 *
 * 不带 model：列出所有含该类别的分组，按分组倍率从低到高。
 * 带 model：只列出有这个模型的分组，按实际价格（基础价 × 分组倍率）从低到高。
 */

const MAX_MODEL_NAMES_PER_ROW = 300;

// 分组的有效类别：手动覆盖优先，否则用自动判断
const EFFECTIVE_CATS = "COALESCE(NULLIF(g.category_override, ''), g.categories)";

function mul(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Number((a * b).toPrecision(10));
}

async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || 'gpt';
    if (!isCategory(category)) {
      return NextResponse.json({ success: false, error: '类别无效' }, { status: 400 });
    }
    const model = (searchParams.get('model') || '').trim().slice(0, 200);

    // 该类别下出现过的模型，供下拉选择；按覆盖站点数排序
    const [modelRows] = await pool.query<RowDataPacket[]>(
      `SELECT m.model_name AS name, COUNT(*) AS group_count, COUNT(DISTINCT m.site_id) AS site_count
       FROM site_group_models m
       WHERE m.category = ?
       GROUP BY m.model_name
       ORDER BY site_count DESC, group_count DESC, m.model_name ASC`,
      [category]
    );

    const siteCols = `s.name AS site_name, s.base_url, s.last_fetch_ok, s.last_fetched_at, s.last_success_at, s.last_fetch_error`;
    const groupCols = `g.site_id, g.group_name, g.ratio, g.prev_ratio, g.ratio_changed_at, g.description, g.fetched_at, g.model_count`;

    let rows: Record<string, unknown>[];

    if (model) {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT ${groupCols}, ${siteCols},
                m.model_name, m.billing, m.input_price, m.output_price, m.request_price
         FROM site_group_models m
         JOIN site_price_groups g ON g.site_id = m.site_id AND g.group_name = m.group_name
         JOIN sites s ON s.id = m.site_id
         WHERE m.model_name = ?`,
        [model]
      );
      // 7 天内这个模型的基础价变动：挂到当前基础价等于变动后价格的分组上
      const [priceChanges] = await pool.query<RowDataPacket[]>(
        `SELECT site_id, old_price, new_price, price_billing, created_at
         FROM price_group_changes
         WHERE change_type = 'model_price' AND model_name = ? AND created_at >= NOW() - INTERVAL 7 DAY
         ORDER BY id DESC`,
        [model]
      );
      rows = r.map((x) => {
        const ratio = x.ratio as number | null;
        const base = x.billing === 'request' ? x.request_price : x.input_price;
        const pc = priceChanges.find((c) => c.site_id === x.site_id && c.new_price === base && c.price_billing === x.billing);
        return {
          ...x,
          price_input: mul(x.input_price, ratio),
          price_output: mul(x.output_price, ratio),
          price_request: mul(x.request_price, ratio),
          base_price_change: pc ? { old_price: pc.old_price, new_price: pc.new_price, at: pc.created_at } : null,
        };
      });
      // 按实际价格排序：先按次价/输入价，再按输出价，没价格的排最后
      const key = (x: Record<string, unknown>) => (x.price_input ?? x.price_request ?? Infinity) as number;
      rows.sort(
        (a, b) =>
          key(a) - key(b) ||
          ((a.price_output as number | null) ?? Infinity) - ((b.price_output as number | null) ?? Infinity) ||
          ((a.ratio as number | null) ?? Infinity) - ((b.ratio as number | null) ?? Infinity)
      );
    } else {
      const [groups] = await pool.query<RowDataPacket[]>(
        `SELECT ${groupCols}, ${siteCols}
         FROM site_price_groups g
         JOIN sites s ON s.id = g.site_id
         WHERE FIND_IN_SET(?, ${EFFECTIVE_CATS})
         ORDER BY g.ratio IS NULL, g.ratio ASC, s.name ASC, g.group_name ASC`,
        [category]
      );
      // 每个分组里属于该类别的模型（手动归类、但没有该类别模型的分组，显示全部模型）
      const [models] = await pool.query<RowDataPacket[]>(
        `SELECT m.site_id, m.group_name, m.model_name, m.category
         FROM site_group_models m
         JOIN site_price_groups g ON g.site_id = m.site_id AND g.group_name = m.group_name
         WHERE FIND_IN_SET(?, ${EFFECTIVE_CATS})
         ORDER BY m.model_name`,
        [category]
      );
      const inCat = new Map<string, string[]>();
      const all = new Map<string, string[]>();
      for (const m of models) {
        const k = `${m.site_id}\u0000${m.group_name}`;
        let a = all.get(k);
        if (!a) all.set(k, (a = []));
        a.push(m.model_name);
        if (m.category === category) {
          let c = inCat.get(k);
          if (!c) inCat.set(k, (c = []));
          c.push(m.model_name);
        }
      }
      rows = groups.map((g) => {
        const k = `${g.site_id}\u0000${g.group_name}`;
        const names = inCat.get(k) ?? all.get(k) ?? [];
        return { ...g, models: names.slice(0, MAX_MODEL_NAMES_PER_ROW), category_model_count: names.length };
      });
    }

    const [[meta]] = await pool.query<RowDataPacket[]>(
      // 「数据更新于」只算成功的获取，失败的不算
      'SELECT MAX(last_success_at) AS last_success_at, COUNT(*) AS site_count, SUM(last_fetch_ok = 0) AS failed_count FROM sites'
    );

    return NextResponse.json({
      success: true,
      data: {
        category,
        model: model || null,
        models: modelRows.map((m) => ({ name: m.name, group_count: Number(m.group_count), site_count: Number(m.site_count) })),
        rows,
        last_success_at: meta?.last_success_at ?? null,
        site_count: Number(meta?.site_count ?? 0),
        failed_site_count: Number(meta?.failed_count ?? 0),
        scheduler: schedulerStatus(),
      },
    });
  } catch (err: unknown) {
    const msg = schemaErrorMessage(err) ?? (err instanceof Error ? err.message : '查询失败');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
