'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  RefreshCw,
  Loader2,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Crown,
  Clock,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import BlurText from '@/components/reactbits/BlurText';
import ChangeItem, { type Change } from '@/components/ChangeItem';
import { useToast } from '@/components/ToastProvider';
import { describeRun, syncAllAndWait, type RefreshStatus } from '@/components/sync-all';
import { CATEGORIES, type Category } from '@/lib/model-category';
import {
  CATEGORY_COLORS,
  DAY_MS,
  formatPrice,
  formatRatio,
  isWithin,
  ratioColor,
  timeAgo,
} from '@/components/price-format';

interface ModelOption {
  name: string;
  group_count: number;
  site_count: number;
}

interface Row {
  site_id: number;
  site_name: string;
  base_url: string;
  group_name: string;
  ratio: number | null;
  prev_ratio: number | null;
  ratio_changed_at: string | null;
  description: string | null;
  fetched_at: string;
  last_fetch_ok: number | null;
  last_fetched_at: string | null;
  last_fetch_error: string | null;
  // 分组视图
  models?: string[];
  category_model_count?: number;
  // 模型视图
  model_name?: string;
  billing?: 'token' | 'request';
  input_price?: number | null;
  output_price?: number | null;
  request_price?: number | null;
  price_input?: number | null;
  price_output?: number | null;
  price_request?: number | null;
  /** 7 天内这个模型在该站的基础价变动 */
  base_price_change?: { old_price: number | null; new_price: number | null; at: string } | null;
}

interface CompareData {
  category: Category;
  model: string | null;
  models: ModelOption[];
  rows: Row[];
  last_success_at: string | null;
  site_count: number;
  failed_site_count: number;
  scheduler: RefreshStatus;
}

/** 基础价变动（站点改了模型倍率），和分组倍率变动分开提示 */
function BasePriceBadge({ change, billing }: { change: Row['base_price_change']; billing?: 'token' | 'request' }) {
  if (!change || change.old_price === null || change.new_price === null || change.old_price === change.new_price) return null;
  const up = change.new_price > change.old_price;
  const unit = billing === 'request' ? '/次' : '';
  return (
    <span
      title={`${new Date(change.at).toLocaleString('zh-CN')} 站点调整了这个模型的基础价：$${formatPrice(change.old_price)}${unit} → $${formatPrice(change.new_price)}${unit}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: up ? '#dc2626' : '#059669', whiteSpace: 'nowrap' }}
    >
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      基础价原 ${formatPrice(change.old_price)}
    </span>
  );
}


const POLL_MS = 30_000;
const QUICK_MODELS = 10;
const COLLAPSED_MODELS = 6;
const mono = 'var(--font-geist-mono), monospace';

function ChangeBadge({ prev, ratio, at }: { prev: number | null; ratio: number | null; at: string | null }) {
  if (prev === null || ratio === null || prev === ratio) return null;
  const up = ratio > prev;
  const recent = isWithin(at, DAY_MS);
  const pct = prev > 0 ? Math.round(((ratio - prev) / prev) * 100) : null;
  return (
    <span
      title={`${at ? new Date(at).toLocaleString('zh-CN') + ' ' : ''}由 ${formatRatio(prev)} 调整为 ${formatRatio(ratio)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
        fontWeight: 600,
        color: up ? '#dc2626' : '#059669',
        padding: recent ? '1px 6px' : 0,
        borderRadius: 6,
        background: recent ? (up ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.1)') : 'transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      原 {formatRatio(prev)}
      {pct !== null && ` (${pct > 0 ? '+' : ''}${pct}%)`}
      {recent && <span style={{ fontWeight: 700 }}>· 24h</span>}
    </span>
  );
}

function StaleWarning({ row }: { row: Row }) {
  if (row.last_fetch_ok !== 0) return null;
  return (
    <span
      title={`最近一次获取失败（${timeAgo(row.last_fetched_at)}）：${row.last_fetch_error ?? ''}\n显示的是 ${new Date(row.fetched_at).toLocaleString('zh-CN')} 的数据`}
      style={{ display: 'inline-flex', color: '#d97706' }}
    >
      <AlertTriangle size={13} />
    </span>
  );
}

function ModelChips({ models, total }: { models: string[]; total: number }) {
  const [open, setOpen] = useState(false);
  if (!models.length) return <span style={{ fontSize: 12, color: 'var(--muted-alt)' }}>无模型数据</span>;
  const visible = open ? models : models.slice(0, COLLAPSED_MODELS);
  const hidden = total - visible.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {visible.map((m) => (
        <code
          key={m}
          style={{
            fontSize: 11,
            fontFamily: mono,
            padding: '1px 6px',
            borderRadius: 5,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
          }}
        >
          {m}
        </code>
      ))}
      {(hidden > 0 || open) && models.length > COLLAPSED_MODELS && (
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 5,
            border: '1px solid rgba(99,102,241,0.3)',
            background: 'rgba(99,102,241,0.08)',
            color: '#4338ca',
            cursor: 'pointer',
          }}
        >
          {open ? '收起' : `+${hidden}`}
        </button>
      )}
    </div>
  );
}

function CompareContent() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlCat = searchParams.get('c');
  const category: Category = CATEGORIES.some((c) => c.key === urlCat) ? (urlCat as Category) : 'gpt';
  const model = searchParams.get('m') || '';

  const [data, setData] = useState<CompareData | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [rowFilter, setRowFilter] = useState('');
  const [showAllChanges, setShowAllChanges] = useState(false);
  const reqId = useRef(0);
  /** 本页已经看到的最新一条变动，轮询到更新的变动时弹出提示 */
  const seenTopId = useRef<number | null>(null);

  const setQuery = useCallback(
    (next: { c?: string; m?: string | null }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.c !== undefined) p.set('c', next.c);
      if (next.m !== undefined) {
        if (next.m) p.set('m', next.m);
        else p.delete('m');
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const load = useCallback(
    async (silent = false) => {
      const id = ++reqId.current;
      if (!silent) setLoading(true);
      try {
        const q = new URLSearchParams({ category });
        if (model) q.set('model', model);
        const [cmp, chg] = await Promise.all([
          fetch(`/api/compare?${q}`, { cache: 'no-store' }).then((r) => r.json()),
          fetch(`/api/changes?category=${category}&limit=30`, { cache: 'no-store' }).then((r) => r.json()),
        ]);
        if (id !== reqId.current) return;
        if (cmp.success) {
          setData(cmp.data);
          setError('');
        } else {
          setError(cmp.error || '加载失败');
        }
        if (chg.success) {
          const list: Change[] = chg.data;
          const top = list[0]?.id ?? 0;
          const seen = seenTopId.current;
          if (silent && seen !== null && top > seen) {
            const n = list.filter((c) => c.id > seen).length;
            toast(`${CATEGORIES.find((c) => c.key === category)?.label} 有 ${n} 条新的价格变动，见右侧「最近变动」`, 'info');
          }
          seenTopId.current = top;
          setChanges(list);
        }
      } catch {
        if (id === reqId.current && !silent) setError('加载失败，请检查网络');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [category, model, toast]
  );

  useEffect(() => {
    // 换了类别：重新开始记录「已看到的最新变动」，避免把另一个类别的旧变动当成新变动提示
    seenTopId.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换类别/模型时重新加载，状态在 await 之后才更新
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function refreshAll() {
    setRefreshing(true);
    try {
      const status = await syncAllAndWait();
      const { text, kind } = describeRun(status);
      toast(text, kind);
      await load(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : '同步请求出错', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  const rows = useMemo(() => {
    const kw = rowFilter.trim().toLowerCase();
    const list = data?.rows ?? [];
    if (!kw) return list;
    return list.filter(
      (r) =>
        r.site_name.toLowerCase().includes(kw) ||
        r.group_name.toLowerCase().includes(kw) ||
        (r.description || '').toLowerCase().includes(kw)
    );
  }, [data, rowFilter]);

  const modelOptions = useMemo(() => data?.models ?? [], [data]);
  const searchedModels = useMemo(() => {
    const kw = modelSearch.trim().toLowerCase();
    if (!kw) return [];
    return modelOptions.filter((m) => m.name.toLowerCase().includes(kw)).slice(0, 30);
  }, [modelOptions, modelSearch]);

  const modelView = !!data?.model;
  const best = rows[0];
  const siteCount = new Set(rows.map((r) => r.site_id)).size;
  const sched = data?.scheduler;

  const visibleChanges = showAllChanges ? changes : changes.slice(0, 8);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <BlurText
            text="价格对比"
            as="h1"
            stagger={0.04}
            style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.03em', margin: 0, marginBottom: 6 }}
          />
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Clock size={13} />
            数据更新于 {timeAgo(data?.last_success_at)}
            {sched?.enabled ? (
              <>
                {' · '}每 {sched.interval_minutes} 分钟自动同步
                {sched.running ? (
                  <span style={{ color: '#4338ca', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Loader2 size={12} className="animate-spin" />
                    同步中
                  </span>
                ) : (
                  sched.next_run_at && ` · 下次 ${new Date(sched.next_run_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                )}
              </>
            ) : (
              sched && ' · 自动同步已关闭'
            )}
            {' · '}页面每 30 秒刷新
          </p>
          {!!data?.failed_site_count && (
            <Link
              href="/sites"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                marginTop: 6,
                fontSize: 12,
                color: '#b45309',
                textDecoration: 'none',
              }}
            >
              <AlertTriangle size={13} />
              {data.failed_site_count} 个站点最近一次获取失败，它们显示的是旧数据 →
            </Link>
          )}
        </div>
        <button
          onClick={refreshAll}
          disabled={refreshing || !!sched?.running}
          style={{
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            border: '1px solid rgba(129, 140, 248, 0.45)',
            color: 'white',
            cursor: refreshing || sched?.running ? 'not-allowed' : 'pointer',
            opacity: refreshing || sched?.running ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
          }}
        >
          {refreshing || sched?.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {refreshing || sched?.running ? '同步中...' : '立即同步全部站点'}
        </button>
      </div>

      {/* Category tabs */}
      <div
        role="tablist"
        aria-label="模型类别"
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'var(--surface-alt)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          marginBottom: 14,
          overflowX: 'auto',
        }}
      >
        {CATEGORIES.map((c) => {
          const active = c.key === category;
          const col = CATEGORY_COLORS[c.key];
          return (
            <button
              key={c.key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setModelSearch('');
                setQuery({ c: c.key, m: null });
              }}
              style={{
                flex: '1 0 auto',
                minWidth: 80,
                padding: '9px 16px',
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                borderRadius: 9,
                border: active ? `1px solid ${col.border}` : '1px solid transparent',
                background: active ? 'var(--card)' : 'transparent',
                color: active ? col.color : 'var(--muted)',
                boxShadow: active ? '0 1px 4px rgba(15,23,42,0.08)' : 'none',
                cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Model picker */}
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>按模型比价：</span>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchedModels[0]) {
                  setQuery({ m: searchedModels[0].name });
                  setModelSearch('');
                }
              }}
              placeholder={`搜索 ${modelOptions.length} 个${CATEGORIES.find((c) => c.key === category)?.label}模型...`}
              aria-label="搜索模型"
              style={{
                width: '100%',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px 7px 30px',
                fontSize: 13,
                color: 'var(--foreground)',
                outline: 'none',
                fontFamily: mono,
              }}
            />
            {searchedModels.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  maxHeight: 320,
                  overflowY: 'auto',
                  background: 'var(--card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(15,23,42,0.14)',
                  padding: 4,
                }}
              >
                {searchedModels.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => {
                      setQuery({ m: m.name });
                      setModelSearch('');
                    }}
                    className="model-option"
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '7px 10px',
                      border: 'none',
                      borderRadius: 7,
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <code style={{ fontSize: 12, fontFamily: mono, color: 'var(--foreground)', wordBreak: 'break-all' }}>{m.name}</code>
                    <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {m.site_count} 站 · {m.group_count} 组
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {model && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px 5px 12px',
                borderRadius: 20,
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.4)',
                color: '#4338ca',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: mono,
              }}
            >
              {model}
              <button
                onClick={() => setQuery({ m: null })}
                aria-label="取消模型筛选"
                style={{ display: 'flex', background: 'transparent', border: 'none', color: '#4338ca', cursor: 'pointer', padding: 2 }}
              >
                <X size={13} />
              </button>
            </span>
          )}
        </div>
        {modelOptions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted-alt)' }}>常见：</span>
            {modelOptions.slice(0, QUICK_MODELS).map((m) => {
              const active = m.name === model;
              return (
                <button
                  key={m.name}
                  onClick={() => setQuery({ m: active ? null : m.name })}
                  title={`${m.site_count} 个站点 · ${m.group_count} 个分组`}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    fontFamily: mono,
                    fontWeight: active ? 700 : 500,
                    borderRadius: 20,
                    background: active ? 'rgba(99,102,241,0.14)' : 'transparent',
                    border: active ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
                    color: active ? '#4338ca' : 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  {m.name}
                  <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>{m.site_count}站</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="compare-layout">
        <div style={{ minWidth: 0 }}>
          {/* Cheapest summary */}
          {!loading && best && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
                padding: '14px 18px',
                marginBottom: 12,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%)',
                border: '1px solid rgba(16,185,129,0.35)',
              }}
            >
              <Crown size={20} style={{ color: '#059669', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>
                  最便宜{modelView ? ` · ${data?.model}` : ` · ${CATEGORIES.find((c) => c.key === category)?.label} 分组`}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', marginTop: 2, wordBreak: 'break-all' }}>
                  {best.site_name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>/</span> {best.group_name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }}>
                {modelView ? (
                  best.billing === 'request' ? (
                    <span style={{ fontSize: 22, fontWeight: 800, fontFamily: mono, color: '#059669' }}>
                      ${formatPrice(best.price_request)}
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> /次</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 22, fontWeight: 800, fontFamily: mono, color: '#059669' }}>
                      ${formatPrice(best.price_input)}
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> 输入 / </span>${formatPrice(best.price_output)}
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> 输出 · 每百万 token</span>
                    </span>
                  )
                ) : (
                  <span style={{ fontSize: 22, fontWeight: 800, fontFamily: mono, color: '#059669' }}>×{formatRatio(best.ratio)}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span>
                  共 {rows.length} 个分组，来自 {siteCount} 个站点
                </span>
                {!modelView && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Info size={12} style={{ flexShrink: 0 }} />
                    分组倍率不等于实际价格（各站的模型倍率可能不同），选择具体模型即可按实际价格排序
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-alt)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', flex: '0 1 260px' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
                <input
                  value={rowFilter}
                  onChange={(e) => setRowFilter(e.target.value)}
                  placeholder="筛选站点或分组..."
                  aria-label="筛选站点或分组"
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '6px 10px 6px 28px',
                    fontSize: 12,
                    color: 'var(--foreground)',
                    outline: 'none',
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                {modelView ? '按实际价格（基础价 × 分组倍率）从低到高' : '按分组倍率从低到高'}
              </span>
            </div>

            {loading && !data ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 36 }} />
                ))}
              </div>
            ) : error ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
                {data?.site_count === 0 ? (
                  <>
                    还没有站点。<Link href="/sites" style={{ color: '#4f46e5', fontWeight: 600 }}>去添加站点</Link>，添加后会自动获取分组和倍率。
                  </>
                ) : rowFilter ? (
                  '没有匹配的分组'
                ) : modelView ? (
                  '没有站点提供这个模型'
                ) : (
                  '没有属于这个类别的分组。可以在站点详情里手动修改分组类别。'
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>站点 / 分组</th>
                      {modelView ? (
                        <>
                          <th className="num">输入 $/1M</th>
                          <th className="num">输出 $/1M</th>
                          <th className="num">分组倍率</th>
                        </>
                      ) : (
                        <>
                          <th className="num">倍率</th>
                          <th>模型</th>
                        </>
                      )}
                      <th>更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const c = ratioColor(r.ratio);
                      const top = i === 0;
                      return (
                        <tr key={`${r.site_id}-${r.group_name}`} className={top ? 'is-best' : undefined}>
                          <td>
                            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: top ? '#059669' : 'var(--muted)' }}>
                              {top ? <Crown size={14} /> : i + 1}
                            </span>
                          </td>
                          <td style={{ minWidth: 200 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Link href={`/sites/${r.site_id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', textDecoration: 'none' }}>
                                {r.site_name}
                              </Link>
                              <StaleWarning row={r} />
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, wordBreak: 'break-all' }}>
                              <span style={{ fontWeight: 600, color: '#4338ca', whiteSpace: 'pre-wrap' }}>{r.group_name}</span>
                              {r.description && (
                                <span title={r.description} style={{ marginLeft: 6 }}>
                                  {r.description.length > 40 ? r.description.slice(0, 40) + '…' : r.description}
                                </span>
                              )}
                            </div>
                          </td>
                          {modelView ? (
                            <>
                              {r.billing === 'request' ? (
                                <td className="num" colSpan={2}>
                                  <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: top ? '#059669' : 'var(--foreground)' }}>
                                    ${formatPrice(r.price_request)}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'var(--muted)' }}> /次</span>
                                  <div>
                                    <BasePriceBadge change={r.base_price_change} billing={r.billing} />
                                  </div>
                                </td>
                              ) : (
                                <>
                                  <td className="num">
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                                      <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: top ? '#059669' : 'var(--foreground)' }}>
                                        ${formatPrice(r.price_input)}
                                      </span>
                                      <BasePriceBadge change={r.base_price_change} billing={r.billing} />
                                    </div>
                                  </td>
                                  <td className="num">
                                    <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--foreground)' }}>${formatPrice(r.price_output)}</span>
                                  </td>
                                </>
                              )}
                              <td className="num">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                                  <span style={{ fontFamily: mono, fontWeight: 600, fontSize: 12, padding: '1px 8px', borderRadius: 6, color: c.color, background: c.bg, border: `1px solid ${c.border}` }}>
                                    ×{formatRatio(r.ratio)}
                                  </span>
                                  <ChangeBadge prev={r.prev_ratio} ratio={r.ratio} at={r.ratio_changed_at} />
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="num">
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                                  <span
                                    style={{
                                      fontFamily: mono,
                                      fontWeight: 700,
                                      fontSize: 14,
                                      padding: '2px 10px',
                                      borderRadius: 8,
                                      color: c.color,
                                      background: c.bg,
                                      border: `1px solid ${c.border}`,
                                    }}
                                  >
                                    ×{formatRatio(r.ratio)}
                                  </span>
                                  <ChangeBadge prev={r.prev_ratio} ratio={r.ratio} at={r.ratio_changed_at} />
                                </div>
                              </td>
                              <td style={{ minWidth: 220 }}>
                                <ModelChips models={r.models ?? []} total={r.category_model_count ?? 0} />
                              </td>
                            </>
                          )}
                          <td>
                            <span
                              title={new Date(r.fetched_at).toLocaleString('zh-CN')}
                              style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}
                            >
                              {timeAgo(r.fetched_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent changes */}
        <aside style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', alignSelf: 'start' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
              最近变动 · {CATEGORIES.find((c) => c.key === category)?.label}
            </span>
            <Link href={`/changes?category=${category}`} style={{ fontSize: 12, color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
              全部
            </Link>
          </div>
          {changes.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>暂无变动记录</div>
          ) : (
            <>
              {visibleChanges.map((c) => (
                <ChangeItem key={c.id} c={c} />
              ))}
              {changes.length > 8 && (
                <button
                  onClick={() => setShowAllChanges((v) => !v)}
                  style={{
                    width: '100%',
                    padding: '8px',
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
                  {showAllChanges ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {showAllChanges ? '收起' : `再显示 ${changes.length - 8} 条`}
                </button>
              )}
            </>
          )}
        </aside>
      </div>

      <style>{`
        .compare-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 16px; }
        @media (max-width: 980px) { .compare-layout { grid-template-columns: minmax(0, 1fr); } }
        .compare-table { width: 100%; border-collapse: collapse; }
        .compare-table th {
          text-align: left; font-size: 11px; font-weight: 700; color: var(--muted);
          letter-spacing: 0.05em; padding: 9px 12px; border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .compare-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
        .compare-table tr:last-child td { border-bottom: none; }
        .compare-table tbody tr:hover { background: var(--surface-alt); }
        .compare-table tr.is-best { background: rgba(16,185,129,0.06); }
        .compare-table tr.is-best:hover { background: rgba(16,185,129,0.1); }
        .compare-table .num { text-align: right; }
        .model-option:hover { background: var(--surface-alt) !important; }
      `}</style>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareContent />
    </Suspense>
  );
}
