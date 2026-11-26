import { describe, expect, it } from 'vitest';
import { readLoginInput, resolveLoginColumns, SiteLoginInputError, toPublicSite } from '@/lib/site-login';

const fakeEncrypt = (s: string) => `enc(${s})`;

describe('readLoginInput', () => {
  it('reads and trims email, keeps password as-is', () => {
    expect(readLoginInput({ login_email: '  a@b.com ', login_password: ' p w ' })).toEqual({
      email: 'a@b.com',
      password: ' p w ',
      clear: false,
    });
  });

  it('treats blank password as "unchanged"', () => {
    expect(readLoginInput({ login_email: 'a@b.com', login_password: '   ' }).password).toBeNull();
  });

  it('clear_login wins over everything', () => {
    expect(readLoginInput({ login_email: 'a@b.com', login_password: 'x', clear_login: true })).toEqual({
      email: null,
      password: null,
      clear: true,
    });
  });

  it('rejects bad input', () => {
    expect(() => readLoginInput({ login_email: 'not-an-email' })).toThrow(SiteLoginInputError);
    expect(() => readLoginInput({ login_password: 'secret' })).toThrow(/登录邮箱/);
    expect(() => readLoginInput({ login_email: 'a@b.com', login_password: 'x'.repeat(201) })).toThrow(/过长/);
  });

  it('ignores missing / non-string fields', () => {
    expect(readLoginInput({ login_email: 123 })).toEqual({ email: null, password: null, clear: false });
  });
});

describe('resolveLoginColumns', () => {
  it('encrypts a new password', () => {
    expect(resolveLoginColumns({ email: 'a@b.com', password: 'pw', clear: false }, false, fakeEncrypt)).toEqual({
      login_email: 'a@b.com',
      login_password_encrypted: 'enc(pw)',
    });
  });

  it('keeps the stored password when only the email is sent', () => {
    expect(resolveLoginColumns({ email: 'a@b.com', password: null, clear: false }, true, fakeEncrypt)).toEqual({
      login_email: 'a@b.com',
    });
  });

  it('requires a password when none is stored', () => {
    expect(() => resolveLoginColumns({ email: 'a@b.com', password: null, clear: false }, false, fakeEncrypt)).toThrow(
      /登录密码/
    );
  });

  it('clears both when the email is emptied or clear is set', () => {
    const cleared = { login_email: null, login_password_encrypted: null };
    expect(resolveLoginColumns({ email: null, password: null, clear: false }, true, fakeEncrypt)).toEqual(cleared);
    expect(resolveLoginColumns({ email: null, password: null, clear: true }, true, fakeEncrypt)).toEqual(cleared);
  });
});

describe('toPublicSite', () => {
  it('never exposes encrypted columns', () => {
    const out = toPublicSite({
      id: 1,
      name: 's',
      api_key_encrypted: null,
      login_email: 'a@b.com',
      login_password_encrypted: 'deadbeef:cafe',
    });
    expect(out).toEqual({ id: 1, name: 's', login_email: 'a@b.com', has_login_password: true });
    expect(JSON.stringify(out)).not.toContain('deadbeef');
  });
});
