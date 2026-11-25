import { NextRequest, NextResponse } from 'next/server';
import { audit } from '@/lib/auth/audit';
import {
  IP_POLICY,
  LOGIN_BODY_LIMIT_BYTES,
  PASSWORD_MAX_LENGTH,
  USER_POLICY,
  USERNAME_PATTERN,
} from '@/lib/auth/config';
import { checkCsrf, jsonError, setSessionCookie } from '@/lib/auth/guard';
import { PasswordCheckBusyError, verifyPassword } from '@/lib/auth/password';
import { clearBuckets, ipBucketKey, pruneBuckets, reserveAttempts, userBucketKey } from '@/lib/auth/rate-limit';
import { getClientIp } from '@/lib/auth/request-checks';
import { createSession, pruneSessions } from '@/lib/auth/session';
import { findUserByUsername, recordLogin } from '@/lib/auth/users';

const GENERIC_FAILURE = '用户名或密码错误';

/** Reads the body with a hard byte cap so oversized payloads can't exhaust memory. */
async function readLimitedText(req: NextRequest, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > limit) return null;
  if (!req.body) return '';

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseCredentials(text: string): { username: string; password: string } | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const u = username.trim();
  if (!USERNAME_PATTERN.test(u)) return null;
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return null;
  return { username: u, password };
}

// POST /api/auth/login
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return jsonError(415, '请求格式不正确');
  }

  const text = await readLimitedText(req, LOGIN_BODY_LIMIT_BYTES);
  if (text === null) return jsonError(413, '请求体过大');

  const creds = parseCredentials(text);
  // Malformed input is treated like a wrong password so it reveals nothing.
  if (!creds) return jsonError(400, GENERIC_FAILURE);

  const ip = getClientIp(req.headers);
  const userAgent = req.headers.get('user-agent');
  const bucketKeys = [ipBucketKey(ip), userBucketKey(creds.username)];

  try {
    const reservation = await reserveAttempts([
      { key: bucketKeys[0], policy: IP_POLICY },
      { key: bucketKeys[1], policy: USER_POLICY },
    ]);

    if (!reservation.allowed) {
      await audit({ event: 'login_blocked', username: creds.username, ip, userAgent, detail: reservation.key.split(':')[0] });
      return jsonError(429, '尝试次数过多，请稍后再试', { 'Retry-After': String(reservation.retryAfter) });
    }

    const user = await findUserByUsername(creds.username);
    const passwordOk = await verifyPassword(user?.passwordHash ?? null, creds.password);

    if (!user || !passwordOk || !user.isActive) {
      await audit({
        event: 'login_failed',
        userId: user?.id ?? null,
        username: creds.username,
        ip,
        userAgent,
        detail: !user ? 'unknown_user' : !passwordOk ? 'bad_password' : 'disabled',
      });
      return jsonError(401, GENERIC_FAILURE);
    }

    await clearBuckets(bucketKeys);
    const { token } = await createSession(user.id, ip, userAgent);
    await recordLogin(user.id, ip);
    await audit({ event: 'login_success', userId: user.id, username: user.username, ip, userAgent });
    // Opportunistic housekeeping; never blocks or fails the login.
    void Promise.all([pruneSessions(), pruneBuckets()]).catch(() => {});

    const res = NextResponse.json({ success: true, data: { username: user.username } });
    res.headers.set('Cache-Control', 'no-store');
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    if (err instanceof PasswordCheckBusyError) {
      return jsonError(503, err.message, { 'Retry-After': '5' });
    }
    console.error('[auth] login failed:', err instanceof Error ? err.message : err);
    return jsonError(500, '登录服务暂不可用');
  }
}
