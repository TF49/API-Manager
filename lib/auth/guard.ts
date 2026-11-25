import { NextRequest, NextResponse } from 'next/server';
import { IS_PROD, SESSION_ABSOLUTE_MS, SESSION_COOKIE_NAME } from './config';
import { isSafeMethod, isSameOriginRequest } from './request-checks';
import { validateSessionToken, type SessionInfo } from './session';

/**
 * Route Handler guard. Every protected API route is wrapped with `withAuth`, so authorization
 * is enforced next to the data, not only in proxy.ts (which is an optimistic first filter).
 */

export function jsonError(status: number, error: string, headers?: HeadersInit): NextResponse {
  const res = NextResponse.json({ success: false, error }, { status, headers });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

export function getSessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE_NAME)?.value;
}

/** CSRF gate for state-changing methods. Returns an error response, or null if OK. */
export function checkCsrf(req: NextRequest): NextResponse | null {
  if (isSafeMethod(req.method)) return null;
  if (!isSameOriginRequest(req.headers)) return jsonError(403, '请求来源校验失败');
  return null;
}

export async function getSession(req: NextRequest): Promise<SessionInfo | null> {
  return validateSessionToken(getSessionToken(req));
}

type Handler<C> = (req: NextRequest, ctx: C, session: SessionInfo) => Promise<Response> | Response;

export function withAuth<C>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;

    // Read the cookie outside try/catch: during `next build` this access throws Next's
    // "bail out of prerendering" signal, which must propagate rather than become a 503.
    const token = getSessionToken(req);

    let session: SessionInfo | null;
    try {
      session = await validateSessionToken(token);
    } catch (err) {
      console.error('[auth] session check failed:', err instanceof Error ? err.message : err);
      return jsonError(503, '鉴权服务暂不可用');
    }

    if (!session) {
      const res = jsonError(401, '未登录或登录已过期');
      clearSessionCookie(res);
      return res;
    }

    const res = await handler(req, ctx, session);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
}
