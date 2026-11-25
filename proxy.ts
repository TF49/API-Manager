import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

/**
 * First, optimistic gate: only checks that a session cookie *exists*.
 * Real validation happens in every Route Handler via withAuth() (lib/auth/guard.ts),
 * because Proxy coverage can silently change with matcher edits.
 */

const PUBLIC_PAGES = new Set(['/login']);
const PUBLIC_APIS = new Set(['/api/auth/login', '/api/auth/logout']);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_APIS.has(pathname) || hasSession) return NextResponse.next();
    return NextResponse.json(
      { success: false, error: '未登录或登录已过期' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (PUBLIC_PAGES.has(pathname) || hasSession) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next internals (/_next/* incl. the dev HMR socket, /__nextjs* dev overlay)
    // and static files with an extension. Redirecting the HMR socket to /login makes the dev
    // client reload the page forever.
    '/((?!_next/|__nextjs|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)',
  ],
};
