import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { safeFetch } from '@/lib/net/safe-fetch';

interface SiteRow extends RowDataPacket {
  id: number;
  name: string;
  base_url: string;
  api_key_encrypted: string;
}

interface UpstreamModelItem {
  id?: string;
  owned_by?: string;
  created?: number;
}

// GET /api/sites/[id]/models - 获取已缓存的模型列表（含测试状态）
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT model_id, owned_by, model_created_at, fetched_at,
              test_status, test_latency_ms, test_status_code, test_error_msg, last_tested_at
       FROM models
       WHERE site_id = ?
       ORDER BY model_id ASC`,
      [id]
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '获取模型列表失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/sites/[id]/models - 重新拉取并同步模型（保留已有模型的测试状态）
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const start = Date.now();

  try {
    const [sites] = await pool.query<SiteRow[]>('SELECT * FROM sites WHERE id = ?', [id]);
    if (!sites.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    const site = sites[0];
    const apiKey = decrypt(site.api_key_encrypted);
    const cleanBase = site.base_url.trim().replace(/\/+$/, '');
    const v1Base = cleanBase.endsWith('/v1') ? cleanBase : `${cleanBase}/v1`;

    const res = await safeFetch(`${v1Base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      await logHistory(id, site.name, 'fetch_models', res.status >= 429 ? 'quota' : 'error', res.status, latency, errText.slice(0, 500));
      return NextResponse.json({ success: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` }, { status: res.status });
    }

    const json = (await res.json()) as { data?: UpstreamModelItem[]; models?: UpstreamModelItem[] };
    const rawModels = json.data || json.models || [];
    const models = rawModels.filter((m): m is UpstreamModelItem & { id: string } => Boolean(m && typeof m.id === 'string' && m.id.trim()));

    if (!models.length) {
      return NextResponse.json({ success: false, error: '未返回任何模型' }, { status: 200 });
    }

    const modelIds = models.map((m) => m.id);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Remove models no longer offered by the upstream site
      await conn.query('DELETE FROM models WHERE site_id = ? AND model_id NOT IN (?)', [id, modelIds]);
      // Upsert current models while keeping existing test results intact
      for (const m of models) {
        await conn.query(
          `INSERT INTO models (site_id, model_id, owned_by, model_created_at, fetched_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             owned_by = VALUES(owned_by),
             model_created_at = VALUES(model_created_at),
             fetched_at = NOW()`,
          [id, m.id, m.owned_by || null, m.created || null]
        );
      }
      await conn.commit();
    } finally {
      conn.release();
    }

    await logHistory(id, site.name, 'fetch_models', 'ok', res.status, latency, null);

    return NextResponse.json({ success: true, data: { count: models.length, latency_ms: latency } });
  } catch (err: unknown) {
    const latency = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const msg = err instanceof Error ? err.message : '拉取模型失败';
    await logHistory(id, '', 'fetch_models', isTimeout ? 'timeout' : 'error', null, latency, msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

async function logHistory(
  siteId: string,
  siteName: string,
  action: string,
  status: string,
  statusCode: number | null,
  latency: number,
  errorMsg: string | null
) {
  try {
    await pool.query(
      'INSERT INTO call_history (site_id, site_name, action_type, status, status_code, latency_ms, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [siteId, siteName, action, status, statusCode, latency, errorMsg]
    );
  } catch {
    /* ignore logging errors */
  }
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
