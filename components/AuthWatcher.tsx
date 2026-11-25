'use client';

import { useEffect } from 'react';

/**
 * When a session expires while a page is open (idle timeout, revoked, password changed),
 * the next API call returns 401. Send the user to the login page instead of showing
 * a broken page. Login/logout endpoints are excluded.
 */
export default function AuthWatcher() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (res.status !== 401 || redirecting) return res;

      const input = args[0];
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let url: URL;
      try {
        url = new URL(raw, window.location.href);
      } catch {
        return res;
      }
      if (url.origin !== window.location.origin) return res;
      if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/')) return res;
      if (window.location.pathname === '/login') return res;

      redirecting = true;
      const next = window.location.pathname + window.location.search;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
