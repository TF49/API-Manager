import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encrypt, maskKey, decrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { assertSafeUpstreamUrl, UnsafeUrlError } from '@/lib/net/safe-fetch';

// GET /api/sites - 获取所有站点
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const group = searchParams.get('group');

    let sql = 'SELECT id, name, base_url, api_key_encrypted, group_tag, notes, status, last_tested_at, created_at, updated_at FROM sites';
    const params: string[] = [];
    if (group) {
      sql += ' WHERE group_tag = ?';
      params.push(group);
    }
    sql += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(sql, params) as any[];
    const sites = rows.map((r: any) => ({
      ...r,
      api_key_masked: maskKey(decrypt(r.api_key_encrypted)),
      api_key_encrypted: undefined,
    }));

    return NextResponse.json({ success: true, data: sites });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/sites - 新增站点
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, base_url, api_key, group_tag, notes } = body;

    if (!name || !base_url || !api_key) {
      return NextResponse.json({ success: false, error: '名称、Base URL 和 API Key 为必填项' }, { status: 400 });
    }

    // Normalize base_url
    const normalizedUrl = String(base_url).trim().replace(/\/$/, '');
    try {
      await assertSafeUpstreamUrl(normalizedUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 });
      }
      throw e;
    }
    const encryptedKey = encrypt(api_key);

    const [result] = await pool.query(
      'INSERT INTO sites (name, base_url, api_key_encrypted, group_tag, notes) VALUES (?, ?, ?, ?, ?)',
      [name, normalizedUrl, encryptedKey, group_tag || null, notes || null]
    ) as any[];

    return NextResponse.json({ success: true, data: { id: result.insertId } }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
