import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/auth/audit';
import { checkCsrf, clearSessionCookie, getSession, getSessionToken } from '@/lib/auth/guard';
import { getClientIp } from '@/lib/auth/request-checks';
import { revokeSessionByToken } from '@/lib/auth/session';

// POST /api/auth/logout - always succeeds and always clears the cookie
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  try {
    const session = await getSession(req);
    await revokeSessionByToken(getSessionToken(req));
    if (session) {
      await audit({
        event: 'logout',
        userId: session.userId,
        username: session.username,
        ip: getClientIp(req.headers),
        userAgent: req.headers.get('user-agent'),
      });
    }
  } catch (err) {
    console.error('[auth] logout cleanup failed:', err instanceof Error ? err.message : err);
  }

  const res = NextResponse.json({ success: true });
  res.headers.set('Cache-Control', 'no-store');
  clearSessionCookie(res);
  return res;
}
