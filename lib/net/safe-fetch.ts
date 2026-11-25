import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';
import { allowedPrivateHosts, isAllowedDestination } from './ip-policy';

/**
 * SSRF-safe outbound fetch for user-supplied upstream URLs (site base_url).
 *
 * Defence layers:
 *  1. URL shape: http/https only, no embedded credentials.
 *  2. IP-literal hosts are checked directly (the socket never does DNS for them).
 *  3. Hostnames are checked at *connect time* by a custom DNS lookup on the undici Agent,
 *     so a DNS-rebinding answer can't swap in 127.0.0.1 after validation.
 *  4. Redirects are followed manually and every hop goes through the same checks;
 *     only same-host redirects are followed so the API key never leaves its upstream.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const MAX_REDIRECTS = 3;

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isExempt(hostname: string): boolean {
  return allowedPrivateHosts().has(normalizeHost(hostname));
}

/** Synchronous structural checks; throws UnsafeUrlError. */
export function parseUpstreamUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Base URL 格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Base URL 只支持 http 或 https');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Base URL 不能包含用户名或密码');
  }
  const host = normalizeHost(url.hostname);
  if (!host) throw new UnsafeUrlError('Base URL 缺少主机名');
  if (isIP(host) && !isAllowedDestination(host) && !isExempt(host)) {
    throw new UnsafeUrlError('Base URL 不能指向内网、本机或保留地址');
  }
  return url;
}

/**
 * Full validation for saving a site: structure + resolve DNS now to give the user
 * an immediate, clear error. (Connect-time checks still run on every request.)
 */
export async function assertSafeUpstreamUrl(raw: string): Promise<void> {
  const url = parseUpstreamUrl(raw);
  const host = normalizeHost(url.hostname);
  if (isIP(host) || isExempt(host)) return;

  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(host, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)));
  }).catch(() => {
    throw new UnsafeUrlError('Base URL 的域名无法解析');
  });

  if (!addresses.length || addresses.some((a) => !isAllowedDestination(a.address))) {
    throw new UnsafeUrlError('Base URL 的域名解析到了内网、本机或保留地址');
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/** DNS lookup used by every outbound socket; refuses non-public answers. */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number, callback: LookupCallback) {
  const opts = typeof options === 'number' ? { family: options } : options || {};
  dnsLookup(hostname, { family: opts.family, all: true }, (err, addresses) => {
    if (err) return callback(err, opts.all ? [] : '', undefined);

    const exempt = isExempt(hostname);
    const bad = addresses.find((a) => !isAllowedDestination(a.address));
    if (!addresses.length || (bad && !exempt)) {
      const e: NodeJS.ErrnoException = new Error(
        `拒绝连接：${hostname} 解析到了内网、本机或保留地址`
      );
      e.code = 'ESSRFBLOCKED';
      return callback(e, opts.all ? [] : '', undefined);
    }

    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never },
});

/**
 * Drop-in replacement for fetch() when the URL comes from user data.
 * Error messages from UnsafeUrlError are safe to show to the user.
 */
export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let url = parseUpstreamUrl(input);
  let currentInit: RequestInit = { ...init, redirect: 'manual', dispatcher: agent };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await undiciFetch(url, currentInit);
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    if (hop === MAX_REDIRECTS) {
      await res.body?.cancel();
      throw new UnsafeUrlError('上游重定向次数过多');
    }

    await res.body?.cancel();
    const next = parseUpstreamUrl(new URL(location, url).toString());
    // Our requests carry the API key in headers; never forward them to a different host.
    if (normalizeHost(next.hostname) !== normalizeHost(url.hostname)) {
      throw new UnsafeUrlError(`上游尝试跳转到其他域名 (${next.hostname})，已拒绝以保护 API Key`);
    }
    if (url.protocol === 'https:' && next.protocol === 'http:') {
      throw new UnsafeUrlError('上游尝试从 https 降级跳转到 http，已拒绝');
    }
    url = next;

    // 301/302/303 turn a POST into a body-less GET, like browsers do.
    const method = (currentInit.method || 'GET').toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      currentInit = { ...currentInit, method: 'GET', body: undefined };
    }
  }

  throw new UnsafeUrlError('上游重定向次数过多');
}
