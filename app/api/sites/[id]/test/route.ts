import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { safeFetch } from '@/lib/net/safe-fetch';

// POST /api/sites/[id]/test - 连通性测试（调用 /v1/models 探测）
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const start = Date.now();

  try {
    const [sites] = await pool.query('SELECT * FROM sites WHERE id = ?', [id]) as any[];
    if (!sites.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    const site = sites[0];
    const apiKey = decrypt(site.api_key_encrypted);
    const baseUrl = site.base_url.replace(/\/$/, '');

    // 使用 GET /v1/models 探测：所有兼容站点均支持，不消耗 token，不依赖具体模型名
    const res = await safeFetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    const latency = Date.now() - start;
    let newStatus: string;

    if (res.status === 401 || res.status === 403) {
      newStatus = 'error'; // Key 无效
    } else if (res.status === 429 || res.status === 402) {
      newStatus = 'quota'; // 超额 / 余额不足
    } else if (res.ok) {
      newStatus = 'ok';    // 正常
    } else {
      newStatus = 'error'; // 其他错误（503 等）
    }

    // 更新站点状态
    await pool.query('UPDATE sites SET status=?, last_tested_at=NOW() WHERE id=?', [newStatus, id]);

    // 写入历史
    await pool.query(
      'INSERT INTO call_history (site_id, site_name, action_type, status, status_code, latency_ms, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, site.name, 'test', newStatus, res.status, latency, newStatus !== 'ok' ? `HTTP ${res.status}` : null]
    );

    return NextResponse.json({
      success: true,
      data: { status: newStatus, status_code: res.status, latency_ms: latency },
    });
  } catch (err: any) {
    const latency = Date.now() - start;
    const isTimeout = err.name === 'TimeoutError';
    const status = isTimeout ? 'timeout' : 'error';

    await pool.query('UPDATE sites SET status=?, last_tested_at=NOW() WHERE id=?', ['error', id]);
    await pool.query(
      'INSERT INTO call_history (site_id, site_name, action_type, status, status_code, latency_ms, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, '', 'test', status, null, latency, err.message]
    );

    return NextResponse.json({
      success: false,
      error: err.message,
      data: { status, latency_ms: latency },
    });
  }
}

export const POST = withAuth(handlePOST);
