'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, ArrowRight, Loader2, RefreshCw, CheckCircle2, XCircle, CircleDashed } from 'lucide-react';
import { useToast } from './ToastProvider';
import { timeAgo } from './price-format';

export interface Site {
  id: number;
  name: string;
  base_url: string;
  login_email?: string | null;
  has_login_password?: boolean;
  group_tag: string | null;
  notes: string | null;
  architecture: string | null;
  group_count: number;
  last_fetched_at: string | null;
  last_fetch_ok: number | null;
  last_fetch_error: string | null;
}

interface Props {
  site: Site;
  isLast: boolean;
  onEdit: (site: Site) => void;
  onDeleteRequest: (site: Site) => void;
  onRefresh: () => void;
}

const mono = 'var(--font-geist-mono), monospace';

function FetchStatus({ site }: { site: Site }) {
  if (!site.last_fetched_at) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>
        <CircleDashed size={13} />
        未获取
      </span>
    );
  }
  const ok = site.last_fetch_ok === 1;
  return (
    <span
      title={ok ? new Date(site.last_fetched_at).toLocaleString('zh-CN') : site.last_fetch_error ?? '获取失败'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: ok ? 'var(--muted)' : '#dc2626', minWidth: 0 }}
    >
      {ok ? <CheckCircle2 size={13} style={{ color: '#059669', flexShrink: 0 }} /> : <XCircle size={13} style={{ flexShrink: 0 }} />}
      <span style={{ whiteSpace: 'nowrap' }}>{timeAgo(site.last_fetched_at)}</span>
      {!ok && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>失败</span>}
    </span>
  );
}

export default function SiteRow({ site, isLast, onEdit, onDeleteRequest, onRefresh }: Props) {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/price-groups`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        toast(`${site.name}：${d.count} 个分组${d.changes ? `，${d.changes} 处变动` : ''}（${d.latency_ms}ms）`, 'success');
      } else {
        toast(`${site.name} 获取失败：${json.error}`, 'error');
      }
      onRefresh();
    } catch {
      toast(`${site.name} 请求出错`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="site-row-item" style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      <div className="site-list-grid" style={{ padding: '12px 20px' }}>
        {/* Name + tag + notes */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Link
              href={`/sites/${site.id}`}
              title={site.name}
              className="site-row-name"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--foreground)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {site.name}
            </Link>
            {site.group_tag && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  background: 'rgba(99, 102, 241, 0.12)',
                  color: '#4338ca',
                  borderRadius: 20,
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}
              >
                {site.group_tag}
              </span>
            )}
          </div>
          {site.notes && (
            <p
              title={site.notes}
              style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {site.notes}
            </p>
          )}
        </div>

        {/* Base URL */}
        <span
          title={site.base_url}
          style={{ fontSize: 12, fontFamily: mono, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
        >
          {site.base_url}
        </span>

        {/* Architecture */}
        <span style={{ fontSize: 12, color: site.architecture ? 'var(--foreground)' : 'var(--muted-alt)', fontFamily: mono }}>
          {site.architecture ?? '—'}
        </span>

        {/* Group count */}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>
          {site.group_count || '—'}
        </span>

        {/* Last fetch */}
        <div style={{ minWidth: 0 }}>
          <FetchStatus site={site} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <button onClick={handleSync} disabled={syncing} className="row-text-btn" title="重新获取分组和倍率">
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncing ? '获取中' : '刷新'}
          </button>
          <Link href={`/sites/${site.id}`} className="row-text-btn row-text-btn-primary" title="查看分组详情">
            详情
            <ArrowRight size={12} />
          </Link>
          <button onClick={() => onEdit(site)} title="编辑站点" aria-label="编辑站点" className="row-icon-btn">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDeleteRequest(site)} title="删除站点" aria-label="删除站点" className="row-icon-btn row-icon-btn-danger">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
