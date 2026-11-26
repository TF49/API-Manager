'use client';

import { Fragment, useMemo, useState } from 'react';
import { Search, X, ChevronDown, ChevronRight, Copy, Check, Pencil, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { CATEGORIES, type Category } from '@/lib/model-category';
import { CATEGORY_COLORS, DAY_MS, formatPrice, formatRatio, isWithin, ratioColor } from '@/components/price-format';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface GroupModelView {
  name: string;
  category: string;
  billing: 'token' | 'request';
  input: number | null;
  output: number | null;
  request: number | null;
}

export interface GroupView {
  name: string;
  ratio: number | null;
  svip_ratio: number | null;
  description: string | null;
  model_count: number | null;
  categories: Category[];
  auto_categories?: Category[];
  category_overridden?: boolean;
  models: GroupModelView[] | null;
  prev_ratio?: number | null;
  ratio_changed_at?: string | null;
}

interface Props {
  groups: GroupView[];
  /** 提供时可以修改分组类别；categories 为 null 表示恢复自动判断。返回是否保存成功 */
  onCategoryChange?: (group: string, categories: Category[] | null) => Promise<boolean>;
}

const mono = 'var(--font-geist-mono), monospace';

function mul(a: number | null, b: number | null) {
  return a === null || b === null ? null : a * b;
}

export function CategoryChip({ cat, small }: { cat: string; small?: boolean }) {
  const c = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other;
  return (
    <span
      style={{
        fontSize: small ? 10 : 11,
        fontWeight: 600,
        padding: small ? '0 6px' : '1px 7px',
        borderRadius: 20,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {CATEGORIES.find((x) => x.key === cat)?.label ?? cat}
    </span>
  );
}

function CategoryEditor({
  group,
  onSave,
  onClose,
}: {
  group: GroupView;
  onSave: (cats: Category[] | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Set<Category>>(new Set(group.categories));
  const [saving, setSaving] = useState(false);
  async function save(cats: Category[] | null) {
    setSaving(true);
    try {
      // 失败时调用方已经提示过，编辑框保持打开方便重试
      if (await onSave(cats)) onClose();
    } catch {
      /* 调用方负责提示 */
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      {CATEGORIES.map((c) => {
        const on = sel.has(c.key);
        const col = CATEGORY_COLORS[c.key];
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() =>
              setSel((prev) => {
                const next = new Set(prev);
                if (next.has(c.key)) next.delete(c.key);
                else next.add(c.key);
                return next;
              })
            }
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 9px',
              borderRadius: 20,
              cursor: 'pointer',
              color: on ? col.color : 'var(--muted)',
              background: on ? col.bg : 'transparent',
              border: `1px solid ${on ? col.border : 'var(--border)'}`,
            }}
          >
            {c.label}
          </button>
        );
      })}
      <button
        type="button"
        disabled={saving || sel.size === 0}
        onClick={() => save(CATEGORIES.map((c) => c.key).filter((k) => sel.has(k)))}
        className="row-text-btn row-text-btn-primary"
      >
        保存
      </button>
      {group.category_overridden && (
        <button type="button" disabled={saving} onClick={() => save(null)} className="row-text-btn" title="恢复按模型自动判断">
          <RotateCcw size={11} />
          自动
        </button>
      )}
      <button type="button" onClick={onClose} className="row-text-btn">
        取消
      </button>
    </div>
  );
}

function ModelTable({ models, ratio }: { models: GroupModelView[]; ratio: number | null }) {
  const [kw, setKw] = useState('');
  const list = kw ? models.filter((m) => m.name.toLowerCase().includes(kw.toLowerCase())) : models;
  return (
    <div style={{ padding: '4px 16px 14px 40px' }}>
      {models.length > 12 && (
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder={`在 ${models.length} 个模型中搜索...`}
          aria-label="搜索模型"
          style={{
            width: 260,
            maxWidth: '100%',
            marginBottom: 8,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '5px 10px',
            fontSize: 12,
            color: 'var(--foreground)',
            outline: 'none',
            fontFamily: mono,
          }}
        />
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table className="model-price-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>类别</th>
              <th className="num">基础输入</th>
              <th className="num">基础输出</th>
              <th className="num">实际输入 $/1M</th>
              <th className="num">实际输出 $/1M</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.name}>
                <td>
                  <code style={{ fontFamily: mono, fontSize: 12, wordBreak: 'break-all' }}>{m.name}</code>
                </td>
                <td>
                  <CategoryChip cat={m.category} small />
                </td>
                {m.billing === 'request' ? (
                  <>
                    <td className="num" colSpan={2}>
                      ${formatPrice(m.request)} /次
                    </td>
                    <td className="num" colSpan={2} style={{ fontWeight: 700 }}>
                      ${formatPrice(mul(m.request, ratio))} /次
                    </td>
                  </>
                ) : (
                  <>
                    <td className="num">${formatPrice(m.input)}</td>
                    <td className="num">${formatPrice(m.output)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      ${formatPrice(mul(m.input, ratio))}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      ${formatPrice(mul(m.output, ratio))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GroupTable({ groups, onCategoryChange }: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<Category | ''>('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState('');
  const [copied, setCopied] = useState('');

  const presentCats = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const c of g.categories) s.add(c);
    return CATEGORIES.filter((c) => s.has(c.key));
  }, [groups]);

  const keyword = search.trim().toLowerCase();
  const filtered = groups.filter((g) => {
    if (catFilter && !g.categories.includes(catFilter)) return false;
    if (!keyword) return true;
    return (
      g.name.toLowerCase().includes(keyword) ||
      (g.description || '').toLowerCase().includes(keyword) ||
      (g.models ?? []).some((m) => m.name.toLowerCase().includes(keyword))
    );
  });
  const hasSvip = groups.some((g) => g.svip_ratio !== null);

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function copyName(name: string) {
    navigator.clipboard.writeText(name);
    setCopied(name);
    toast(`已复制分组名 ${name}`, 'info');
    setTimeout(() => setCopied(''), 2000);
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--surface-alt)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', flex: '0 1 300px' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
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
            placeholder="搜索分组、说明或模型..."
            aria-label="搜索分组"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="清空搜索"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {[{ key: '' as const, label: '全部' }, ...presentCats].map((c) => {
            const active = catFilter === c.key;
            return (
              <button
                key={c.key || 'all'}
                onClick={() => setCatFilter(c.key)}
                style={{
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  borderRadius: 20,
                  background: active ? 'rgba(99,102,241,0.14)' : 'transparent',
                  border: active ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
                  color: active ? '#4338ca' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.map((g, idx) => {
        const c = ratioColor(g.ratio);
        const prev = g.prev_ratio ?? null;
        const changed = prev !== null && g.ratio !== null && prev !== g.ratio;
        const up = changed && g.ratio! > prev!;
        const recent = changed && isWithin(g.ratio_changed_at, DAY_MS);
        const isOpen = open.has(g.name);
        const canExpand = !!g.models?.length;
        return (
          <Fragment key={g.name}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 16px',
                borderBottom: idx < filtered.length - 1 || isOpen ? '1px solid var(--border)' : 'none',
                background: isOpen ? 'var(--surface-alt)' : undefined,
              }}
            >
              <button
                onClick={() => canExpand && toggle(g.name)}
                disabled={!canExpand}
                aria-label={isOpen ? '收起模型' : '展开模型'}
                aria-expanded={isOpen}
                style={{
                  marginTop: 1,
                  background: 'transparent',
                  border: 'none',
                  padding: 2,
                  display: 'flex',
                  color: canExpand ? 'var(--muted)' : 'var(--border-light)',
                  cursor: canExpand ? 'pointer' : 'default',
                }}
              >
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>

              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    onClick={() => canExpand && toggle(g.name)}
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', wordBreak: 'break-all', whiteSpace: 'pre-wrap', cursor: canExpand ? 'pointer' : 'default' }}
                  >
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
                  {g.categories.map((cat) => (
                    <CategoryChip key={cat} cat={cat} />
                  ))}
                  {g.category_overridden && <span style={{ fontSize: 10, color: 'var(--muted-alt)' }}>手动</span>}
                  {onCategoryChange && editing !== g.name && (
                    <button
                      onClick={() => setEditing(g.name)}
                      title="修改分组类别"
                      aria-label="修改分组类别"
                      style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
                {g.description && (
                  <p
                    title={g.description}
                    style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {g.description}
                  </p>
                )}
                {onCategoryChange && editing === g.name && (
                  <CategoryEditor group={g} onSave={(cats) => onCategoryChange(g.name, cats)} onClose={() => setEditing('')} />
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {g.model_count !== null ? `${g.model_count} 个模型` : '无模型数据'}
                </span>
                {changed && (
                  <span
                    title={`${g.ratio_changed_at ? new Date(g.ratio_changed_at).toLocaleString('zh-CN') + ' ' : ''}由 ${formatRatio(prev)} 调整为 ${formatRatio(g.ratio)}`}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: up ? '#dc2626' : '#059669',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: recent ? '1px 6px' : 0,
                      borderRadius: 6,
                      background: recent ? (up ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.1)') : 'transparent',
                    }}
                  >
                    {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}原 {formatRatio(prev)}
                    {recent && ' · 24h'}
                  </span>
                )}
                {hasSvip && (
                  <span title="会员倍率" style={{ fontSize: 11, color: 'var(--muted)', fontFamily: mono }}>
                    SVIP {formatRatio(g.svip_ratio)}
                  </span>
                )}
                <span
                  style={{
                    minWidth: 56,
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: mono,
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
            {isOpen && g.models && (
              <div style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--surface-alt)' }}>
                <ModelTable models={g.models} ratio={g.ratio} />
              </div>
            )}
          </Fragment>
        );
      })}

      {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>没有匹配的分组</div>}

      <style>{`
        .model-price-table { width: 100%; border-collapse: collapse; background: var(--card); }
        .model-price-table th {
          text-align: left; font-size: 11px; font-weight: 700; color: var(--muted);
          padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .model-price-table td {
          padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px;
          font-family: var(--font-geist-mono), monospace; color: var(--foreground);
        }
        .model-price-table tr:last-child td { border-bottom: none; }
        .model-price-table .num { text-align: right; white-space: nowrap; }
      `}</style>
    </div>
  );
}
