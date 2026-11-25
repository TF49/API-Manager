import { isIP } from 'node:net';

/**
 * Request-level checks that only look at headers. Pure functions over a Headers object,
 * so they can be unit-tested without a server.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Client IP for rate limiting and audit.
 *
 * Only trusts `X-Real-IP` when TRUST_PROXY=1, which must only be set when the app listens on
 * 127.0.0.1 behind Nginx/Caddy that *overwrites* the header. Otherwise any client could forge it
 * and get a fresh rate-limit bucket per request.
 *
 * Without a trusted proxy all clients share the "unknown" bucket: fail-closed (stricter), never open.
 */
export function getClientIp(headers: Headers, trustProxy = process.env.TRUST_PROXY === '1'): string {
  if (trustProxy) {
    const realIp = headers.get('x-real-ip')?.trim();
    if (realIp && isIP(realIp)) return realIp;
  }
  return 'unknown';
}

/**
 * CSRF defence for state-changing requests: the browser-set Origin must match our own origin.
 * Browsers always send Origin on cross-origin and on same-origin POST/PUT/DELETE fetches,
 * so a missing Origin is rejected too. Combined with SameSite=Strict cookies.
 *
 * `allowedOrigin` comes from APP_ORIGIN in production. In development we fall back to
 * comparing against the Host header so localhost on any port works.
 */
export function isSameOriginRequest(
  headers: Headers,
  allowedOrigin: string | undefined = process.env.APP_ORIGIN
): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const origin = headers.get('origin');
  if (!origin || origin === 'null') return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  if (allowedOrigin) {
    try {
      return originUrl.origin === new URL(allowedOrigin).origin;
    } catch {
      return false;
    }
  }

  const host = headers.get('host');
  return Boolean(host) && originUrl.host === host;
}

/**
 * Only allow redirecting to a local path after login. Blocks `//evil.com`, `/\evil.com`,
 * `https://evil.com` and similar open-redirect tricks.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/sites'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/api/')) return fallback;
  try {
    const parsed = new URL(next, 'http://local.invalid');
    if (parsed.origin !== 'http://local.invalid') return fallback;
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
