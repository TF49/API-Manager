import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { safeFetch } from '@/lib/net/safe-fetch';

// POST /api/sites/batch-test - 批量连通测试（同样用 GET /v1/models 探测）
async function handlePOST() {
  try {
    const [sites] = await pool.query('SELECT * FROM sites') as any[];
    if (!sites.length) return NextResponse.json({ success: true, data: [] });

    const results = await Promise.allSettled(
      sites.map(async (site: any) => {
        const start = Date.now();
        // Sites without an API Key can't be probed; skip without touching their status
        if (!site.api_key_encrypted) {
          return { id: site.id, name: site.name, status: 'skipped', error: '未配置 API Key' };
        }
        try {
          const apiKey = decrypt(site.api_key_encrypted);
          const baseUrl = site.base_url.replace(/\/$/, '');

          const res = await safeFetch(`${baseUrl}/v1/models`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
          });

          const latency = Date.now() - start;
          let status: string;

          if (res.status === 401 || res.status === 403) status = 'error';
          else if (res.status === 429 || res.status === 402) status = 'quota';
          else if (res.ok) status = 'ok';
          else status = 'error';

          await pool.query('UPDATE sites SET status=?, last_tested_at=NOW() WHERE id=?', [status, site.id]);
          await pool.query(
            'INSERT INTO call_history (site_id, site_name, action_type, status, status_code, latency_ms) VALUES (?, ?, ?, ?, ?, ?)',
            [site.id, site.name, 'batch_test', status, res.status, latency]
          );

          return { id: site.id, name: site.name, status, status_code: res.status, latency_ms: latency };
        } catch (err: any) {
          const latency = Date.now() - start;
          await pool.query('UPDATE sites SET status=?, last_tested_at=NOW() WHERE id=?', ['error', site.id]);
          return { id: site.id, name: site.name, status: 'error', error: err.message, latency_ms: latency };
        }
      })
    );

    const data = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 'error' }));
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export const POST = withAuth(handlePOST);
