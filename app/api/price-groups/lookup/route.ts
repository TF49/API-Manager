import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guard';
import { UnsafeUrlError } from '@/lib/net/safe-fetch';
import { fetchPriceGroups, normalizeLookupUrl, PriceGroupsAuthError, type Sub2apiCredentials } from '@/lib/price-groups';
import { readLoginInput, SiteLoginInputError } from '@/lib/site-login';

// POST /api/price-groups/lookup - 输入任意站点地址，实时查询其分组及倍率（不保存）
// 可选 login_email / login_password：sub2api 站点未开放模型广场时用于登录，仅本次使用，不保存
async function handlePOST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  const fields: Record<string, unknown> = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  const url = typeof fields.url === 'string' ? normalizeLookupUrl(fields.url) : null;
  if (!url) {
    return NextResponse.json({ success: false, error: '请输入有效的站点地址，例如 https://example.com' }, { status: 400 });
  }

  let credentials: Sub2apiCredentials | null = null;
  try {
    const login = readLoginInput(fields);
    if (login.email && !login.password) throw new SiteLoginInputError('填写了 sub2api 登录邮箱，也需要填写登录密码');
    if (login.email && login.password) credentials = { email: login.email, password: login.password };
  } catch (e) {
    if (e instanceof SiteLoginInputError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
    throw e;
  }

  const start = Date.now();
  try {
    const result = await fetchPriceGroups(url, { sub2api: credentials });
    return NextResponse.json({
      success: true,
      data: { ...result, latency_ms: Date.now() - start },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '查询分组失败';
    const status = err instanceof UnsafeUrlError ? 400 : err instanceof PriceGroupsAuthError ? 422 : 502;
    return NextResponse.json({ success: false, error: msg, needs_login: err instanceof PriceGroupsAuthError }, { status });
  }
}

export const POST = withAuth(handlePOST);
