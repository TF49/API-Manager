import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { withAuth } from '@/lib/auth/guard';
import { assertSafeUpstreamUrl, UnsafeUrlError } from '@/lib/net/safe-fetch';
import { resetSiteData, syncSite } from '@/lib/price-sync';
import { readLoginInput, resolveLoginColumns, schemaErrorMessage, SiteLoginInputError, toPublicSite } from '@/lib/site-login';

// GET /api/sites/[id]
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [rows] = await pool.query('SELECT * FROM sites WHERE id = ?', [id]) as any[];
    if (!rows.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: toPublicSite(rows[0]) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PUT /api/sites/[id]
async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, base_url, group_tag, notes } = body;

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

    const [existing] = await pool.query('SELECT base_url, login_password_encrypted FROM sites WHERE id = ?', [id]) as any[];
    if (!existing.length) return NextResponse.json({ success: false, error: '站点不存在' }, { status: 404 });

    // A different host is a different upstream: its groups must not be diffed against the old one's
    const hostChanged = new URL(existing[0].base_url).host !== new URL(normalizedUrl).host;

    // Login: new password → re-encrypt; empty email / clear_login → remove both; otherwise keep the stored password
    let login;
    try {
      const input = readLoginInput(body);
      const storedPassword = !!existing[0].login_password_encrypted;
      // A stored password belongs to the old host; never silently send it to a different site
      if (hostChanged && storedPassword && input.email && !input.password) {
        throw new SiteLoginInputError('Base URL 换了域名，请重新填写 sub2api 登录密码（旧密码不会发送到新站点）');
      }
      login = resolveLoginColumns(input, storedPassword, encrypt);
    } catch (e) {
      if (e instanceof SiteLoginInputError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    const sets = ['name=?', 'base_url=?', 'group_tag=?', 'notes=?', 'login_email=?'];
    const values: unknown[] = [name, normalizedUrl, group_tag || null, notes || null, login.login_email];
    if (login.login_password_encrypted !== undefined) {
      sets.push('login_password_encrypted=?');
      values.push(login.login_password_encrypted);
    }

    await pool.query(`UPDATE sites SET ${sets.join(', ')} WHERE id=?`, [...values, id]);

    // 换了上游站点：清空旧上游的分组和模型，下次同步按第一次获取处理，不会对比出假变动
    if (hostChanged) await resetSiteData(Number(id));

    // 地址或登录信息可能变了，后台用新配置重新获取一次（正在同步时排队，等它结束再跑）
    void syncSite(Number(id), { fresh: true }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: schemaErrorMessage(err) ?? err.message }, { status: 500 });
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
