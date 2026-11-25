import { describe, expect, it } from 'vitest';
import { getClientIp, isSafeMethod, isSameOriginRequest, safeNextPath } from '@/lib/auth/request-checks';

const h = (init: Record<string, string>) => new Headers(init);

describe('getClientIp', () => {
  it('ignores X-Real-IP unless the proxy is trusted', () => {
    expect(getClientIp(h({ 'x-real-ip': '1.2.3.4' }), false)).toBe('unknown');
    expect(getClientIp(h({ 'x-real-ip': '1.2.3.4' }), true)).toBe('1.2.3.4');
  });

  it('never trusts X-Forwarded-For (client-controllable)', () => {
    expect(getClientIp(h({ 'x-forwarded-for': '9.9.9.9' }), true)).toBe('unknown');
  });

  it('rejects garbage in X-Real-IP', () => {
    expect(getClientIp(h({ 'x-real-ip': 'not-an-ip' }), true)).toBe('unknown');
    expect(getClientIp(h({ 'x-real-ip': '1.2.3.4, 5.6.7.8' }), true)).toBe('unknown');
  });
});

describe('isSameOriginRequest', () => {
  const origin = 'https://admin.example.com';

  it('accepts matching Origin', () => {
    expect(isSameOriginRequest(h({ origin, 'sec-fetch-site': 'same-origin' }), origin)).toBe(true);
  });

  it('rejects other origins, missing and null Origin', () => {
    expect(isSameOriginRequest(h({ origin: 'https://evil.com' }), origin)).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'https://admin.example.com.evil.com' }), origin)).toBe(false);
    expect(isSameOriginRequest(h({}), origin)).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'null' }), origin)).toBe(false);
  });

  it('rejects cross-site Sec-Fetch-Site even with a spoofed Origin', () => {
    expect(isSameOriginRequest(h({ origin, 'sec-fetch-site': 'cross-site' }), origin)).toBe(false);
    expect(isSameOriginRequest(h({ origin, 'sec-fetch-site': 'same-site' }), origin)).toBe(false);
  });

  it('falls back to Host in development', () => {
    expect(isSameOriginRequest(h({ origin: 'http://localhost:3000', host: 'localhost:3000' }), undefined)).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'http://localhost:4000', host: 'localhost:3000' }), undefined)).toBe(false);
  });
});

describe('isSafeMethod', () => {
  it('only treats read methods as safe', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('post')).toBe(false);
    expect(isSafeMethod('DELETE')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps local paths', () => {
    expect(safeNextPath('/sites/3?tab=models')).toBe('/sites/3?tab=models');
  });

  it('blocks open redirects', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/%5Cevil', '/\tevil', '/login', '/api/sites']) {
      const out = safeNextPath(bad);
      expect(out.startsWith('//')).toBe(false);
      expect(['/sites', '/%5Cevil']).toContain(out);
    }
  });
});
