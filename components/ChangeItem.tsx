import { TrendingUp, TrendingDown, Plus, Minus, Box } from 'lucide-react';
import { formatPrice, formatRatio, timeAgo } from '@/components/price-format';

export interface Change {
  id: number;
  site_id: number;
  site_name: string;
  group_name: string;
  model_name?: string | null;
  group_count?: number | null;
  change_type: 'ratio' | 'added' | 'removed' | 'model_price' | 'model_added' | 'model_removed';
  old_ratio: number | null;
  new_ratio: number | null;
  price_billing?: 'token' | 'request' | null;
  old_price?: number | null;
  new_price?: number | null;
  categories?: string[];
  created_at: string;
}

const mono = 'var(--font-geist-mono), monospace';

function price(v: number | null | undefined, billing: Change['price_billing']) {
  return `$${formatPrice(v)}${billing === 'request' ? '/次' : ''}`;
}

/** 变动的方向：up 涨价、down 降价、added 新增/上架、removed 下架 */
export function changeDirection(c: Change): 'up' | 'down' | 'added' | 'removed' {
  if (c.change_type === 'added' || c.change_type === 'model_added') return 'added';
  if (c.change_type === 'removed' || c.change_type === 'model_removed') return 'removed';
  if (c.change_type === 'ratio') return (c.new_ratio ?? 0) > (c.old_ratio ?? 0) ? 'up' : 'down';
  return (c.new_price ?? 0) > (c.old_price ?? 0) ? 'up' : 'down';
}

function describe(c: Change): string {
  const groups = c.group_count && c.group_count > 1 ? `（${c.group_count} 个分组）` : '';
  switch (c.change_type) {
    case 'ratio':
      return `分组倍率 ×${formatRatio(c.old_ratio)} → ×${formatRatio(c.new_ratio)}`;
    case 'added':
      return `新增分组 ×${formatRatio(c.new_ratio)}`;
    case 'removed':
      return `分组下架（原 ×${formatRatio(c.old_ratio)}）`;
    case 'model_price':
      return `基础价 ${price(c.old_price, c.price_billing)} → ${price(c.new_price, c.price_billing)}${groups}`;
    case 'model_added':
      return `模型上架${groups}`;
    case 'model_removed':
      return `模型下架${groups}`;
  }
}

/** 一条变动：涨价红、降价绿、新增蓝、下架灰；模型级变动显示模型名 */
export default function ChangeItem({ c, showDate = false }: { c: Change; showDate?: boolean }) {
  const dir = changeDirection(c);
  const color = { added: '#4338ca', removed: '#64748b', up: '#dc2626', down: '#059669' }[dir];
  const Icon = { added: Plus, removed: Minus, up: TrendingUp, down: TrendingDown }[dir];
  const isModel = c.change_type.startsWith('model_');
  return (
    <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ color, display: 'flex', marginTop: 2 }}>
        <Icon size={14} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 600, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 }}>
          <span>{c.site_name} /</span>
          {isModel ? (
            <span
              title={c.group_count && c.group_count > 1 ? `涉及 ${c.group_count} 个分组，例如 ${c.group_name}` : c.group_name}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0, wordBreak: 'break-all' }}
            >
              <Box size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <code style={{ fontFamily: mono, color: '#4338ca' }}>{c.model_name}</code>
              {(!c.group_count || c.group_count <= 1) && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>@ {c.group_name}</span>}
            </span>
          ) : (
            <span style={{ color: '#4338ca', wordBreak: 'break-all' }}>{c.group_name}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color, fontFamily: mono, marginTop: 2 }}>{describe(c)}</div>
      </div>
      <span title={new Date(c.created_at).toLocaleString('zh-CN')} style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {showDate ? new Date(c.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : timeAgo(c.created_at)}
      </span>
    </div>
  );
}
