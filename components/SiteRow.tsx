'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Pencil, Trash2, Copy, Check, Activity, Cpu, ArrowRight, Loader2 } from 'lucide-react';
import StatusBadge, { SiteStatus } from './StatusBadge';
import { useToast } from './ToastProvider';

gsap.registerPlugin(useGSAP);

export interface Site {
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
  isLast: boolean;
  onEdit: (site: Site) => void;
  onDeleteRequest: (site: Site) => void;
  onRefresh: () => void;
}

const mono = 'var(--font-geist-mono), monospace';

export default function SiteRow({ site, isLast, onEdit, onDeleteRequest, onRefresh }: Props) {
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
        gsap.fromTo(noticeRef.current, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' });
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
    <div
      className="site-row-item"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}
    >
      <div className="site-list-grid" style={{ padding: '12px 20px' }}>
        {/* Name + group + notes */}
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
                  textTransform: 'uppercase',
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
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                margin: '3px 0 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {site.notes}
            </p>
          )}
        </div>

        {/* Base URL */}
        <span
          title={site.base_url}
          style={{
            fontSize: 12,
            fontFamily: mono,
            color: '#64748b',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {site.base_url}
        </span>

        {/* API Key */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <code
            style={{
              fontSize: 12,
              fontFamily: mono,
              color: '#64748b',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {site.api_key_masked}
          </code>
          <button
            onClick={handleCopy}
            title={copied ? '已复制' : '复制掩码 Key'}
            aria-label="复制掩码 API Key"
            className="row-icon-btn"
            data-active={copied ? 'true' : undefined}
            style={{ width: 24, height: 24 }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>

        {/* Status */}
        <div>
          <StatusBadge status={displayStatus} latency={latency} />
        </div>

        {/* Last tested */}
        <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {site.last_tested_at ? new Date(site.last_tested_at).toLocaleString('zh-CN') : '—'}
        </span>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <button onClick={handleTest} disabled={testing} className="row-text-btn" title="连通测试">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
            {testing ? '测试中' : '测试'}
          </button>
          <button onClick={handleFetchModels} disabled={fetchingModels} className="row-text-btn" title="拉取模型列表">
            {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
            {fetchingModels ? '获取中' : '模型'}
          </button>
          <Link href={`/sites/${site.id}`} className="row-text-btn row-text-btn-primary" title="查看详情">
            详情
            <ArrowRight size={12} />
          </Link>
          <button onClick={() => onEdit(site)} title="编辑站点" aria-label="编辑站点" className="row-icon-btn">
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDeleteRequest(site)}
            title="删除站点"
            aria-label="删除站点"
            className="row-icon-btn row-icon-btn-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {modelNotice && (
        <div style={{ padding: '0 20px 10px' }}>
          <div
            ref={noticeRef}
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 500,
              background: modelNotice.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${modelNotice.ok ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)'}`,
              color: modelNotice.ok ? '#059669' : '#dc2626',
            }}
          >
            {modelNotice.text}
          </div>
        </div>
      )}
    </div>
  );
}
