'use client';

import { useEffect, useState } from 'react';
import { Layers, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import PriceGroupList, { ratioRange, type PriceGroupView } from '@/components/PriceGroupList';

interface PriceGroupRow {
  group_name: string;
  ratio: number | null;
  svip_ratio: number | null;
  prev_ratio: number | null;
  ratio_changed_at: string | null;
  description: string | null;
  model_count: number | null;
  fetched_at: string;
}

function toView(rows: PriceGroupRow[]): PriceGroupView[] {
  return rows.map(({ group_name, ...rest }) => ({ name: group_name, ...rest }));
}

export default function PriceGroupsPanel({ siteId }: { siteId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PriceGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState('');

  async function load() {
    const res = await fetch(`/api/sites/${siteId}/price-groups`);
    const json = await res.json();
    if (json.success) {
      setRows(json.data);
      setLoadError('');
    } else {
      setLoadError(json.error || '加载分组失败');
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sites/${siteId}/price-groups`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setRows(json.data);
        else setLoadError(json.error || '加载分组失败');
      })
      .catch(() => !cancelled && setLoadError('加载分组失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  async function refresh() {
    setFetching(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/price-groups`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        await load();
        toast(`已获取 ${json.data.count} 个分组（${json.data.latency_ms}ms）`, 'success');
      } else {
        toast(`获取分组失败：${json.error}`, 'error');
      }
    } catch {
      toast('获取分组请求出错', 'error');
    } finally {
      setFetching(false);
    }
  }

  const groups = toView(rows);
  const range = ratioRange(groups);

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--foreground)',
              letterSpacing: '-0.02em',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Layers size={18} style={{ color: '#4f46e5' }} />
            分组倍率
          </h2>
          {rows.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 0 }}>
              共 <strong style={{ color: 'var(--foreground)' }}>{rows.length}</strong> 个分组
              {range && ` · 倍率 ${range}`}
              {` · 最后获取：${new Date(rows[0].fetched_at).toLocaleString('zh-CN')}`}
            </p>
          )}
        </div>

        <button
          onClick={refresh}
          disabled={fetching}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 9,
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.32)',
            color: '#4338ca',
            cursor: fetching ? 'not-allowed' : 'pointer',
            opacity: fetching ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {fetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {fetching ? '获取中...' : rows.length ? '重新获取' : '获取分组'}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 44, borderRadius: 9 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: '28px 20px',
            background: 'var(--card)',
            border: '1px dashed var(--border-light)',
            borderRadius: 14,
            textAlign: 'center',
            fontSize: 13,
            color: loadError ? '#dc2626' : 'var(--muted)',
          }}
        >
          {loadError || '暂无分组数据。点击「获取分组」从站点读取全部分组及倍率（支持 new-api / one-api 架构的站点）'}
        </div>
      ) : (
        <PriceGroupList groups={groups} />
      )}
    </div>
  );
}
