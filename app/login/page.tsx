'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, Loader2, LockKeyhole, User } from 'lucide-react';

function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/sites';
  if (next.startsWith('/login') || next.startsWith('/api/')) return '/sites';
  return next;
}

const inputWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 14px',
  height: 44,
  borderRadius: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--foreground)',
  fontSize: 14,
  height: '100%',
};

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const userRef = useRef<HTMLInputElement>(null);

  // Already logged in? Skip the form.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => {
        if (!cancelled && r.ok) window.location.replace(nextPath);
      })
      .catch(() => {});
    userRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [nextPath]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setTimeout(() => setLockSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockSeconds]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || lockSeconds > 0) return;
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        // Full navigation so every component re-reads auth state.
        window.location.replace(nextPath);
        return;
      }
      setPassword('');
      if (res.status === 429) {
        const retry = Number(res.headers.get('Retry-After')) || 60;
        setLockSeconds(retry);
        setError('尝试次数过多，已暂时锁定');
      } else {
        setError(json.error || '登录失败，请稍后再试');
      }
    } catch {
      setError('网络错误，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const locked = lockSeconds > 0;
  const lockText =
    lockSeconds >= 60 ? `${Math.ceil(lockSeconds / 60)} 分钟后可重试` : `${lockSeconds} 秒后可重试`;

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>用户名</span>
        <div style={inputWrap} className="login-input">
          <User size={15} color="var(--muted)" />
          <input
            ref={userRef}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            disabled={submitting}
          />
        </div>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>密码</span>
        <div style={inputWrap} className="login-input">
          <LockKeyhole size={15} color="var(--muted)" />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            disabled={submitting}
          />
        </div>
      </label>

      <div
        role="alert"
        aria-live="polite"
        style={{
          minHeight: 20,
          fontSize: 13,
          color: 'var(--error)',
        }}
      >
        {error && (
          <span>
            {error}
            {locked && `，${lockText}`}
          </span>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting || locked}
        style={{
          height: 44,
          borderRadius: 10,
          border: 'none',
          fontSize: 14,
          fontWeight: 600,
          color: '#fff',
          cursor: submitting || locked ? 'not-allowed' : 'pointer',
          opacity: submitting || locked ? 0.6 : 1,
          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          boxShadow: '0 0 20px rgba(99, 102, 241, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {submitting && <Loader2 size={16} style={{ animation: 'spin 0.9s linear infinite' }} />}
        {locked ? lockText : submitting ? '正在验证…' : '登录'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: 'calc(100vh - 56px - 84px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="glass-card" style={{ width: '100%', maxWidth: 380, padding: '32px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 26 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              boxShadow: '0 0 24px rgba(99, 102, 241, 0.45)',
            }}
          >
            <KeyRound size={22} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>登录 API Manager</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>仅限管理员访问</p>
        </div>
        <Suspense fallback={<div style={{ height: 220 }} />}>
          <LoginForm />
        </Suspense>
      </div>
      <style>{`
        .login-input:focus-within {
          border-color: var(--primary) !important;
          box-shadow: 0 0 0 3px var(--primary-dim);
        }
      `}</style>
    </div>
  );
}
