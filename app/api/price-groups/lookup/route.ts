import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guard';
import { UnsafeUrlError } from '@/lib/net/safe-fetch';
import { fetchPriceGroups, normalizeLookupUrl } from '@/lib/price-groups';

// POST /api/price-groups/lookup - 输入任意站点地址，实时查询其分组及倍率（不保存）
async function handlePOST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  const input = body && typeof body === 'object' && 'url' in body ? body.url : undefined;
  const url = typeof input === 'string' ? normalizeLookupUrl(input) : null;
  if (!url) {
    return NextResponse.json({ success: false, error: '请输入有效的站点地址，例如 https://example.com' }, { status: 400 });
  }

  const start = Date.now();
  try {
    const result = await fetchPriceGroups(url);
    return NextResponse.json({
      success: true,
      data: { ...result, latency_ms: Date.now() - start },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '查询分组失败';
    return NextResponse.json({ success: false, error: msg }, { status: err instanceof UnsafeUrlError ? 400 : 502 });
  }
}

export const POST = withAuth(handlePOST);
