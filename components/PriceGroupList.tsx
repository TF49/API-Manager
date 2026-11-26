'use client';

import { useState } from 'react';
import { Search, X, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';

export interface PriceGroupView {
  name: string;
  ratio: number | null;
  svip_ratio: number | null;
  description: string | null;
  model_count: number | null;
  /** 仅已保存的站点有：最近一次变动前的倍率 */
  prev_ratio?: number | null;
  ratio_changed_at?: string | null;
}

const COLLAPSED_COUNT = 8;

export function formatRatio(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return String(Number(v.toFixed(4)));
}

/** 倍率越低越便宜：≤1 绿色，≤3 蓝色，≤8 橙色，其余红色 */
function ratioColor(v: number | null) {
  if (v === null) return { color: 'var(--muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
  if (v <= 1) return { color: '#059669', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' };
  if (v <= 3) return { color: '#4338ca', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)' };
  if (v <= 8) return { color: '#b45309', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' };
  return { color: '#dc2626', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.28)' };
}

export function ratioRange(groups: PriceGroupView[]): string | null {
  const ratios = groups.map((g) => g.ratio).filter((r): r is number => r !== null);
  if (!ratios.length) return null;
  return `${formatRatio(Math.min(...ratios))} ~ ${formatRatio(Math.max(...ratios))}`;
}

export default function PriceGroupList({ groups }: { groups: PriceGroupView[] }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState('');

  function copyName(name: string) {
    navigator.clipboard.writeText(name);
    setCopied(name);
    toast(`已复制分组名 ${name}`, 'info');
    setTimeout(() => setCopied(''), 2000);
  }

  const keyword = search.trim().toLowerCase();
  const filtered = groups.filter(
    (g) => !keyword || g.name.toLowerCase().includes(keyword) || (g.description || '').toLowerCase().includes(keyword)
  );
  const visible = expanded || keyword ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hasSvip = groups.some((g) => g.svip_ratio !== null);

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      {groups.length > COLLAPSED_COUNT && (
        <div style={{ padding: '8px 12px', background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', maxWidth: 320 }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}
            />
            <input
              style={{
                width: '100%',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 9,
                padding: '6px 30px 6px 32px',
                fontSize: 13,
                color: 'var(--foreground)',
                outline: 'none',
              }}
              placeholder="搜索分组或说明..."
              aria-label="搜索分组"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="清空分组搜索"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  display: 'flex',
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {visible.map((g, idx) => {
        const c = ratioColor(g.ratio);
        const prev = g.prev_ratio ?? null;
        const changed = prev !== null && g.ratio !== null && prev !== g.ratio;
        const up = changed && g.ratio! > prev!;
        return (
          <div
            key={g.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 16px',
              borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                  {g.name}
                </span>
                <button
                  onClick={() => copyName(g.name)}
                  aria-label={`复制分组名 ${g.name}`}
                  title="复制分组名"
                  style={{ background: 'transparent', border: 'none', color: copied === g.name ? '#059669' : 'var(--muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
                >
                  {copied === g.name ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              {g.description && (
                <p
                  title={g.description}
                  style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {g.description}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
              {g.model_count !== null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{g.model_count} 个模型</span>}
              {changed && (
                <span
                  title={`${g.ratio_changed_at ? new Date(g.ratio_changed_at).toLocaleString('zh-CN') + ' ' : ''}由 ${formatRatio(prev)} 调整为 ${formatRatio(g.ratio)}`}
                  style={{ fontSize: 11, fontWeight: 600, color: up ? '#dc2626' : '#059669', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}原 {formatRatio(prev)}
                </span>
              )}
              {hasSvip && (
                <span title="会员倍率" style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-geist-mono), monospace' }}>
                  SVIP {formatRatio(g.svip_ratio)}
                </span>
              )}
              <span
                style={{
                  minWidth: 56,
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: 'var(--font-geist-mono), monospace',
                  padding: '3px 10px',
                  borderRadius: 8,
                  color: c.color,
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                }}
              >
                ×{formatRatio(g.ratio)}
              </span>
            </div>
          </div>
        );
      })}

      {keyword && filtered.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>没有匹配的分组</div>
      )}

      {!keyword && filtered.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            width: '100%',
            padding: '9px 16px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--surface-alt)',
            border: 'none',
            borderTop: '1px solid var(--border)',
            color: 'var(--muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? '收起' : `展开全部 ${filtered.length} 个分组`}
        </button>
      )}
    </div>
  );
}
