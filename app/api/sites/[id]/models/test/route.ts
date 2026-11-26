import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { decrypt, NO_API_KEY_ERROR } from '@/lib/crypto';
import { testModelAvailability } from '@/lib/model-test';
import { withAuth } from '@/lib/auth/guard';

interface SiteRow extends RowDataPacket {
  id: number;
  name: string;
  base_url: string;
  api_key_encrypted: string | null;
}

// POST /api/sites/[id]/models/test - 针对单个指定模型进行实际调用测试
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const body = await req.json();
    const modelId = typeof body?.model_id === 'string' ? body.model_id.trim() : '';

    if (!modelId) {
      return NextResponse.json({ success: false, error: '请提供要测试的 model_id' }, { status: 400 });
    }

    const [sites] = await pool.query<SiteRow[]>('SELECT * FROM sites WHERE id = ?', [id]);
    if (!sites.length) {
      return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    }

    const site = sites[0];
    if (!site.api_key_encrypted) {
      return NextResponse.json({ success: false, error: NO_API_KEY_ERROR }, { status: 400 });
    }
    const apiKey = decrypt(site.api_key_encrypted);

    const outcome = await testModelAvailability({
      baseUrl: site.base_url,
      apiKey,
      modelId,
    });

    const now = new Date();

    // Update cached model test status (create row if tested manually before refresh)
    await pool.query(
      `INSERT INTO models (site_id, model_id, test_status, test_latency_ms, test_status_code, test_error_msg, last_tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         test_status = VALUES(test_status),
         test_latency_ms = VALUES(test_latency_ms),
         test_status_code = VALUES(test_status_code),
         test_error_msg = VALUES(test_error_msg),
         last_tested_at = VALUES(last_tested_at)`,
      [id, modelId, outcome.status, outcome.latency_ms, outcome.status_code, outcome.error_msg, now]
    );

    // Record in call_history
    await pool.query(
      `INSERT INTO call_history (site_id, site_name, model_id, action_type, status, status_code, latency_ms, error_msg)
       VALUES (?, ?, ?, 'model_test', ?, ?, ?, ?)`,
      [id, site.name, modelId, outcome.status, outcome.status_code, outcome.latency_ms, outcome.error_msg]
    );

    return NextResponse.json({
      success: outcome.status === 'ok',
      data: {
        ...outcome,
        last_tested_at: now.toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '模型测试失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export const POST = withAuth(handlePOST);
