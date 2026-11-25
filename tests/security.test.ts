import { describe, expect, it } from 'vitest';
import { allowedPrivateHosts, buildAllowedCidrs, isPublicIp } from '@/lib/net/ip-policy';
import { parseUpstreamUrl, UnsafeUrlError } from '@/lib/net/safe-fetch';
import { isSessionValid } from '@/lib/auth/session';
import { passwordPolicyError } from '@/lib/auth/password';

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe('parseUpstreamUrl', () => {
  it('accepts normal https URLs', () => {
    expect(parseUpstreamUrl('https://api.openai.com/v1').hostname).toBe('api.openai.com');
  });

  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'gopher://example.com',
    'https://user:pass@example.com',
    'http://127.0.0.1:8080',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://0x7f000001/',
    'http://2130706433/',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(() => parseUpstreamUrl(raw)).toThrow(UnsafeUrlError);
  });

  it('parses the allowlist env', () => {
    expect([...allowedPrivateHosts(' localhost , [::1],10.0.0.5 ')]).toEqual(['localhost', '::1', '10.0.0.5']);
  });
});

describe('buildAllowedCidrs', () => {
  it('allows the proxy fake-ip range only outside production by default', () => {
    expect(buildAllowedCidrs(undefined, false).check('198.18.1.31', 'ipv4')).toBe(true);
    expect(buildAllowedCidrs(undefined, true).check('198.18.1.31', 'ipv4')).toBe(false);
  });

  it('honours an explicit list and never widens to loopback implicitly', () => {
    const list = buildAllowedCidrs('10.8.0.0/16', true);
    expect(list.check('10.8.3.4', 'ipv4')).toBe(true);
    expect(list.check('127.0.0.1', 'ipv4')).toBe(false);
    expect(buildAllowedCidrs('', false).check('198.18.1.31', 'ipv4')).toBe(false);
  });

  it('rejects malformed entries loudly', () => {
    expect(() => buildAllowedCidrs('10.0.0.0', true)).toThrow();
    expect(() => buildAllowedCidrs('nope/8', true)).toThrow();
  });
});

describe('isSessionValid', () => {
  const base = { createdAt: 1000, lastSeenAt: 1000, expiresAt: 1000 + 12 * 3600_000, isActive: true, passwordChangedAt: 500 };

  it('valid inside idle and absolute limits', () => {
    expect(isSessionValid(base, 1000 + 29 * 60_000)).toBe(true);
  });
  it('expires after 30 minutes idle', () => {
    expect(isSessionValid(base, 1000 + 30 * 60_000)).toBe(false);
  });
  it('expires at the absolute limit even if active', () => {
    expect(isSessionValid({ ...base, lastSeenAt: base.expiresAt - 1000 }, base.expiresAt)).toBe(false);
  });
  it('dies when the user is disabled or the password changed later', () => {
    expect(isSessionValid({ ...base, isActive: false }, 2000)).toBe(false);
    expect(isSessionValid({ ...base, passwordChangedAt: 1500 }, 2000)).toBe(false);
  });
});

describe('passwordPolicyError', () => {
  it('requires length and character variety', () => {
    expect(passwordPolicyError('short1A!')).not.toBeNull();
    expect(passwordPolicyError('alllowercaseletters')).not.toBeNull();
    expect(passwordPolicyError('Correct-Horse-Battery-9')).toBeNull();
  });
});
