'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { KeyRound, Server, Layers, LogOut, UserRound, ChartNoAxesColumn, ArrowDownUp } from 'lucide-react';
import Magnet from './reactbits/Magnet';
import { CHANGES_SEEN_EVENT, markChangesSeen, readSeenChangeId } from './changes-seen';

gsap.registerPlugin(useGSAP);

const navLinks = [
  { href: '/compare', label: '价格对比', Icon: ChartNoAxesColumn },
  { href: '/changes', label: '倍率变动', Icon: ArrowDownUp },
  { href: '/sites', label: '站点管理', Icon: Server },
  { href: '/price-lookup', label: '分组查询', Icon: Layers },
];

export default function Navbar() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const isLoginPage = pathname === '/login';
  const [username, setUsername] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.success) setUsername(json.data.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoginPage]);

  // 「倍率变动」未读数：每分钟检查一次，打开变动页后清零
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    async function check() {
      try {
        const seen = readSeenChangeId();
        const url = seen === null ? '/api/changes?limit=1' : `/api/changes?limit=1&since_id=${seen}`;
        const json = await fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
        if (cancelled || !json?.success) return;
        if (seen === null) {
          // 第一次使用：把现有的变动都当作已读
          markChangesSeen(json.latest_id ?? 0);
          setUnread(0);
        } else {
          setUnread(Number(json.new_count ?? 0));
        }
      } catch {
        /* 网络问题时保持原样 */
      }
    }
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 60_000);
    const onSeen = () => setUnread(0);
    window.addEventListener(CHANGES_SEEN_EVENT, onSeen);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(CHANGES_SEEN_EVENT, onSeen);
    };
  }, [isLoginPage]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } finally {
      window.location.replace('/login');
    }
  }

  useGSAP(
    () => {
      if (!navRef.current) return;
      gsap.fromTo(
        navRef.current,
        { y: -12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }
      );
    },
    { scope: navRef }
  );

  return (
    <nav
      ref={navRef}
      style={{
        background: 'rgba(255, 255, 255, 0.82)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div className="max-w-7xl mx-auto px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <Magnet magnetStrength={0.18}>
          <Link href="/compare" className="flex items-center gap-2.5 group" style={{ textDecoration: 'none' }}>
            <div
              style={{
                width: 32,
                height: 32,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 0 18px rgba(99, 102, 241, 0.45)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              className="group-hover:scale-105"
            >
              <KeyRound size={16} strokeWidth={2.2} />
            </div>
            <div className="hidden md:flex" style={{ alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  background: 'linear-gradient(135deg, #0f172a 0%, #4338ca 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                API Manager
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  color: '#4f46e5',
                  letterSpacing: '0.04em',
                }}
              >
                CONSOLE
              </span>
            </div>
          </Link>
        </Magnet>

        {/* Nav Links */}
        {!isLoginPage && (
        <div className="flex items-center gap-0.5 md:gap-1.5">
          {navLinks.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-label={label}
                className="nav-link"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 9,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  transition: 'all 0.18s ease',
                  background: active
                    ? 'linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(129,140,248,0.1) 100%)'
                    : 'transparent',
                  color: active ? '#4338ca' : 'var(--muted)',
                  border: active ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
                  boxShadow: active ? '0 0 14px rgba(99, 102, 241, 0.14)' : 'none',
                  textDecoration: 'none',
                }}
              >
                <Icon size={14} strokeWidth={2} />
                <span className="hidden sm:inline">{label}</span>
                {href === '/changes' && unread > 0 && (
                  <span
                    title={`${unread} 条未读变动`}
                    style={{
                      minWidth: 16,
                      height: 16,
                      padding: '0 4px',
                      borderRadius: 8,
                      background: '#dc2626',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: '16px',
                      textAlign: 'center',
                    }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            );
          })}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 6px' }} />
          {username && (
            <span
              title="当前登录用户"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--muted)', padding: '0 6px' }}
            >
              <UserRound size={14} strokeWidth={2} />
              <span className="hidden lg:inline">{username}</span>
            </span>
          )}
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            title="退出登录"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--muted)',
              background: 'transparent',
              border: '1px solid transparent',
              cursor: loggingOut ? 'wait' : 'pointer',
              transition: 'all 0.18s ease',
            }}
            className="hover:text-red-600"
          >
            <LogOut size={14} strokeWidth={2} />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
        )}
      </div>
    </nav>
  );
}
