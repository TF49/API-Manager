'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  Pencil,
  Trash2,
  Copy,
  Check,
  Activity,
  Cpu,
  ArrowRight,
  Loader2,
  Clock,
} from 'lucide-react';
import StatusBadge, { SiteStatus } from './StatusBadge';
import SpotlightCard from './reactbits/SpotlightCard';
import { useToast } from './ToastProvider';

gsap.registerPlugin(useGSAP);

interface Site {
  id: number;
  name: string;
  base_url: string;
  api_key_masked: string;
  group_tag: string | null;
  notes: string | null;
  status: SiteStatus;
  last_tested_at: string | null;
}

interface Props {
  site: Site;
  onEdit: (site: Site) => void;
  onDeleteRequest: (site: Site) => void;
  onRefresh: () => void;
}

export default function SiteCard({ site, onEdit, onDeleteRequest, onRefresh }: Props) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testedStatus, setTestedStatus] = useState<{ forProp: SiteStatus; value: SiteStatus } | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [modelNotice, setModelNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const displayStatus = testedStatus && testedStatus.forProp === site.status ? testedStatus.value : site.status;

  useGSAP(
    () => {
      if (modelNotice && noticeRef.current) {
        gsap.fromTo(
          noticeRef.current,
          { opacity: 0, y: 6, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
        );
      }
    },
    { dependencies: [modelNotice] }
  );

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/test`, { method: 'POST' });
      const json = await res.json();
      if (json.data) {
        const nextStatus = json.data.status as SiteStatus;
        setTestedStatus({ forProp: site.status, value: nextStatus });
        setLatency(json.data.latency_ms);
        if (nextStatus === 'ok') {
          toast(`${site.name} 连通正常（${json.data.latency_ms}ms）`, 'success');
        } else if (nextStatus === 'quota') {
          toast(`${site.name} Key 超额或余额不足`, 'error');
        } else {
          toast(`${site.name} 连通测试失败`, 'error');
        }
      }
      onRefresh();
    } finally {
      setTesting(false);
    }
  }

  async function handleFetchModels() {
    setFetchingModels(true);
    setModelNotice(null);
    try {
      const res = await fetch(`/api/sites/${site.id}/models`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setModelNotice({ ok: true, text: `已获取 ${json.data.count} 个模型（${json.data.latency_ms}ms）` });
        toast(`${site.name} 成功拉取 ${json.data.count} 个模型`, 'success');
      } else {
        setModelNotice({ ok: false, text: `获取失败：${json.error}` });
        toast(`${site.name} 拉取模型失败`, 'error');
      }
      setTimeout(() => setModelNotice(null), 4000);
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleCopy() {
    navigator.clipboard.writeText(site.api_key_masked);
    setCopied(true);
    toast('已复制掩码 API Key', 'info');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SpotlightCard
      className="site-card-item"
      spotlightColor={
        displayStatus === 'ok'
          ? 'rgba(16, 185, 129, 0.13)'
          : displayStatus === 'error'
          ? 'rgba(239, 68, 68, 0.12)'
          : 'rgba(99, 102, 241, 0.16)'
      }
      style={{ padding: 18 }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
            <h3
              style={{
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--foreground)',
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              {site.name}
            </h3>
            {site.group_tag && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  background: 'rgba(99, 102, 241, 0.12)',
                  color: '#4338ca',
                  borderRadius: 20,
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {site.group_tag}
              </span>
            )}
          </div>
          <StatusBadge status={displayStatus} latency={latency} />
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexShrink: 0 }}>
          <button
            onClick={() => onEdit(site)}
            title="编辑站点"
            aria-label="编辑站点"
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid transparent',
              cursor: 'pointer',
              color: 'var(--muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(129,140,248,0.12)';
              e.currentTarget.style.borderColor = 'rgba(129,140,248,0.25)';
              e.currentTarget.style.color = '#4338ca';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.color = 'var(--muted)';
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDeleteRequest(site)}
            title="删除站点"
            aria-label="删除站点"
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid transparent',
              cursor: 'pointer',
              color: 'var(--muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
              e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)';
              e.currentTarget.style.color = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
              e.currentTarget.style.color = 'var(--muted)';
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '0 0 12px' }} />

      {/* Base URL */}
      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Base URL
        </p>
        <p
          title={site.base_url}
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-geist-mono), monospace',
            color: '#64748b',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {site.base_url}
        </p>
      </div>

      {/* API Key */}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          API Key
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-geist-mono), monospace',
              color: '#64748b',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {site.api_key_masked}
          </code>
          <button
            onClick={handleCopy}
            title="复制"
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '3px 9px',
              borderRadius: 6,
              background: copied ? 'rgba(16,185,129,0.12)' : 'var(--surface-alt)',
              border: `1px solid ${copied ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
              color: copied ? '#059669' : 'var(--muted)',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      {site.notes && (
        <p
          style={{
            fontSize: 12,
            color: '#64748b',
            fontStyle: 'italic',
            marginBottom: 12,
            padding: '6px 10px',
            background: 'var(--surface-alt)',
            borderRadius: 7,
            borderLeft: '2px solid var(--primary)',
          }}
        >
          {site.notes}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            flex: 1,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            color: testing ? 'var(--muted)' : 'var(--foreground)',
            cursor: testing ? 'not-allowed' : 'pointer',
            opacity: testing ? 0.65 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
          onMouseEnter={(e) => {
            if (!testing) e.currentTarget.style.background = 'var(--border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--surface-alt)';
          }}
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
          {testing ? '测试中' : '测试'}
        </button>

        <button
          onClick={handleFetchModels}
          disabled={fetchingModels}
          style={{
            flex: 1,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            color: fetchingModels ? 'var(--muted)' : 'var(--foreground)',
            cursor: fetchingModels ? 'not-allowed' : 'pointer',
            opacity: fetchingModels ? 0.65 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
          onMouseEnter={(e) => {
            if (!fetchingModels) e.currentTarget.style.background = 'var(--border)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--surface-alt)';
          }}
        >
          {fetchingModels ? <Loader2 size={13} className="animate-spin" /> : <Cpu size={13} />}
          {fetchingModels ? '获取中' : '模型'}
        </button>

        <Link
          href={`/sites/${site.id}`}
          style={{
            flex: 1,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(99,102,241,0.16) 0%, rgba(129,140,248,0.08) 100%)',
            border: '1px solid rgba(99,102,241,0.32)',
            color: '#4338ca',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.28) 0%, rgba(129,140,248,0.16) 100%)';
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.55)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.16) 0%, rgba(129,140,248,0.08) 100%)';
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.32)';
          }}
        >
          详情
          <ArrowRight size={13} />
        </Link>
      </div>

      {modelNotice && (
        <div
          ref={noticeRef}
          style={{
            marginTop: 10,
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 500,
            background: modelNotice.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${modelNotice.ok ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)'}`,
            color: modelNotice.ok ? '#059669' : '#dc2626',
          }}
        >
          {modelNotice.text}
        </div>
      )}

      {site.last_tested_at && (
        <p
          style={{
            fontSize: 10,
            color: 'var(--muted)',
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 4,
          }}
        >
          <Clock size={10} />
          最后测试：{new Date(site.last_tested_at).toLocaleString('zh-CN')}
        </p>
      )}
    </SpotlightCard>
  );
}
