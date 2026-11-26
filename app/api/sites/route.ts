import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { assertSafeUpstreamUrl, UnsafeUrlError } from '@/lib/net/safe-fetch';
import { syncSite } from '@/lib/price-sync';
import { readLoginInput, resolveLoginColumns, schemaErrorMessage, SiteLoginInputError, toPublicSite } from '@/lib/site-login';

// GET /api/sites - 获取所有站点
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const group = searchParams.get('group');

    let sql = `SELECT s.id, s.name, s.base_url, s.login_email, s.login_password_encrypted, s.group_tag, s.notes,
        s.architecture, s.last_fetched_at, s.last_fetch_ok, s.last_fetch_error, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM site_price_groups g WHERE g.site_id = s.id) AS group_count
      FROM sites s`;
    const params: string[] = [];
    if (group) {
      sql += ' WHERE s.group_tag = ?';
      params.push(group);
    }
    sql += ' ORDER BY s.created_at DESC';

    const [rows] = await pool.query(sql, params) as any[];
    return NextResponse.json({ success: true, data: rows.map(toPublicSite) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: schemaErrorMessage(err) ?? err.message }, { status: 500 });
  }
}

// POST /api/sites - 新增站点
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, base_url, group_tag, notes } = body;

    if (!name || !base_url) {
      return NextResponse.json({ success: false, error: '名称和 Base URL 为必填项' }, { status: 400 });
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
    // sub2api login is optional — only needed when the site's model plaza is not public
    let login;
    try {
      login = resolveLoginColumns(readLoginInput(body), false, encrypt);
    } catch (e) {
      if (e instanceof SiteLoginInputError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    const [result] = await pool.query(
      'INSERT INTO sites (name, base_url, login_email, login_password_encrypted, group_tag, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [name, normalizedUrl, login.login_email, login.login_password_encrypted ?? null, group_tag || null, notes || null]
    ) as any[];

    // 新站点立即在后台获取一次分组，不阻塞响应
    void syncSite(Number(result.insertId)).catch(() => {});

    return NextResponse.json({ success: true, data: { id: result.insertId } }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: schemaErrorMessage(err) ?? err.message }, { status: 500 });
  }
}

export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);
