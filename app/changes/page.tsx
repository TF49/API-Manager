'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Trash2, TrendingDown, TrendingUp, Plus, Minus } from 'lucide-react';
import BlurText from '@/components/reactbits/BlurText';
import ChangeItem, { type Change } from '@/components/ChangeItem';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/ToastProvider';
import { markChangesSeen } from '@/components/changes-seen';
import { CATEGORIES, isCategory } from '@/lib/model-category';

const LIMIT = 30;
const POLL_MS = 60_000;

const TYPES = [
  { key: '', label: '全部' },
  { key: 'down', label: '降价', Icon: TrendingDown, color: '#059669' },
  { key: 'up', label: '涨价', Icon: TrendingUp, color: '#dc2626' },
  { key: 'added', label: '新增/上架', Icon: Plus, color: '#4338ca' },
  { key: 'removed', label: '下架', Icon: Minus, color: '#64748b' },
] as const;

interface Stats {
  down: number;
  up: number;
  added: number;
  removed: number;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        borderRadius: 20,
        background: active ? 'rgba(99,102,241,0.14)' : 'transparent',
        border: active ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
        color: active ? '#4338ca' : 'var(--muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {children}
    </button>
  );
}

function ChangesContent() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawCat = searchParams.get('category');
  const category = isCategory(rawCat) ? rawCat : '';
  const type = searchParams.get('type') || '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const [rows, setRows] = useState<Change[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const setQuery = useCallback(
    (next: Record<string, string>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const load = useCallback(
    async (silent = false) => {
      const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (category) q.set('category', category);
      if (type) q.set('type', type);
      // 切换筛选时显示加载状态，避免旧列表看起来像筛选结果
      if (!silent) setLoading(true);
      try {
        const json = await fetch(`/api/changes?${q}`, { cache: 'no-store' }).then((r) => r.json());
        if (json.success) {
          setRows(json.data);
          setTotal(json.total);
          setStats(json.stats_24h);
          setError('');
          markChangesSeen(json.latest_id ?? 0);
        } else {
          setError(json.error || '加载失败');
        }
      } catch {
        if (!silent) setError('加载失败，请检查网络');
      } finally {
        setLoading(false);
      }
    },
    [category, type, page]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换筛选时重新加载
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function clearAll() {
    setClearing(true);
    try {
      const json = await fetch('/api/changes', { method: 'DELETE' }).then((r) => r.json());
      if (json.success) {
        toast('已清空变动记录', 'success');
        setConfirmClear(false);
        setQuery({ page: '' });
        void load();
      } else {
        toast(json.error || '清空失败', 'error');
      }
    } catch {
      toast('清空请求出错', 'error');
    } finally {
      setClearing(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <BlurText
            text="倍率变动"
            as="h1"
            stagger={0.04}
            style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.03em', margin: 0, marginBottom: 6 }}
          />
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>每次同步时，分组倍率涨跌、模型基础价涨跌、分组和模型的上架与下架都会记录在这里</p>
        </div>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={total === 0}
          className="row-text-btn"
          style={{ opacity: total === 0 ? 0.5 : 1 }}
        >
          <Trash2 size={12} />
          清空记录
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {TYPES.slice(1).map((t) => {
            if (!('Icon' in t)) return null;
            const value = stats[t.key as keyof Stats];
            return (
              <button
                key={t.key}
                onClick={() => setQuery({ type: type === t.key ? '' : t.key, page: '' })}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--card)',
                  border: type === t.key ? `1px solid ${t.color}` : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                  <t.Icon size={13} style={{ color: t.color }} />
                  24 小时{t.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: value ? t.color : 'var(--foreground)', marginTop: 4 }}>{value}</div>
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '12px 14px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', width: 36 }}>类别</span>
          <Chip active={!category} onClick={() => setQuery({ category: '', page: '' })}>
            全部
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.key} active={category === c.key} onClick={() => setQuery({ category: c.key, page: '' })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', width: 36 }}>类型</span>
          {TYPES.map((t) => (
            <Chip key={t.key} active={type === t.key} onClick={() => setQuery({ type: t.key, page: '' })}>
              {'Icon' in t && <t.Icon size={12} style={{ color: t.color }} />}
              {t.label}
            </Chip>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 40 }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            暂无变动记录。站点第一次获取时不会记录，之后每次同步发现分组倍率、模型价格或模型上下架有变化，才会出现在这里。
          </div>
        ) : (
          rows.map((c) => <ChangeItem key={c.id} c={c} showDate />)
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <button className="row-icon-btn" disabled={page <= 1} onClick={() => setQuery({ page: String(page - 1) })} aria-label="上一页">
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            第 {page} / {pages} 页 · 共 {total} 条
          </span>
          <button className="row-icon-btn" disabled={page >= pages} onClick={() => setQuery({ page: String(page + 1) })} aria-label="下一页">
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmClear}
        title="清空变动记录"
        description="确定清空全部倍率变动记录？清空后无法恢复，但不影响当前的分组和倍率数据。"
        confirmLabel="确认清空"
        loading={clearing}
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

export default function ChangesPage() {
  return (
    <Suspense fallback={null}>
      <ChangesContent />
    </Suspense>
  );
}
