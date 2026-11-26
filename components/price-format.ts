/** 倍率、价格、时间的显示格式（客户端共用） */

export function formatRatio(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return String(Number(v.toFixed(4)));
}

/** 价格：≥1 保留两位，<1 保留四位有效数字 */
export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '0';
  if (v >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toPrecision(4)));
}

/** 倍率越低越便宜：≤1 绿色，≤3 蓝色，≤8 橙色，其余红色 */
export function ratioColor(v: number | null | undefined) {
  if (v === null || v === undefined) return { color: 'var(--muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
  if (v <= 1) return { color: '#059669', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' };
  if (v <= 3) return { color: '#4338ca', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)' };
  if (v <= 8) return { color: '#b45309', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' };
  return { color: '#dc2626', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.28)' };
}

export function timeAgo(v: string | null | undefined): string {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(v).toLocaleDateString('zh-CN');
}

export function isWithin(v: string | null | undefined, ms: number): boolean {
  if (!v) return false;
  const t = new Date(v).getTime();
  return Number.isFinite(t) && Date.now() - t < ms;
}

export const DAY_MS = 86_400_000;

export const CATEGORY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  gpt: { color: '#047857', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  claude: { color: '#c2410c', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
  gemini: { color: '#1d4ed8', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
  cn: { color: '#b91c1c', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.28)' },
  other: { color: '#475569', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.28)' },
};
