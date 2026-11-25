import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encrypt, decrypt, maskKey } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { assertSafeUpstreamUrl, UnsafeUrlError } from '@/lib/net/safe-fetch';

// GET /api/sites/[id]
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [rows] = await pool.query('SELECT * FROM sites WHERE id = ?', [id]) as any[];
    if (!rows.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    const site = rows[0];
    return NextResponse.json({
      success: true,
      data: { ...site, api_key_masked: maskKey(decrypt(site.api_key_encrypted)), api_key_encrypted: undefined }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PUT /api/sites/[id]
async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, base_url, api_key, group_tag, notes } = body;

    if (!name || !base_url) {
      return NextResponse.json({ success: false, error: '名称和 Base URL 为必填项' }, { status: 400 });
    }

    const normalizedUrl = String(base_url).trim().replace(/\/$/, '');
    try {
      await assertSafeUpstreamUrl(normalizedUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    // If api_key provided, re-encrypt; otherwise keep existing
    if (api_key) {
      await pool.query(
        'UPDATE sites SET name=?, base_url=?, api_key_encrypted=?, group_tag=?, notes=? WHERE id=?',
        [name, normalizedUrl, encrypt(api_key), group_tag || null, notes || null, id]
      );
    } else {
      await pool.query(
        'UPDATE sites SET name=?, base_url=?, group_tag=?, notes=? WHERE id=?',
        [name, normalizedUrl, group_tag || null, notes || null, id]
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE /api/sites/[id]
async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await pool.query('DELETE FROM sites WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const PUT = withAuth(handlePUT);
export const DELETE = withAuth(handleDELETE);
