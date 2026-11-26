'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw, Layers, CheckCircle2, XCircle, CircleDashed, ExternalLink } from 'lucide-react';
import BlurText from '@/components/reactbits/BlurText';
import { useToast } from '@/components/ToastProvider';
import GroupTable, { type GroupView } from '@/components/GroupTable';
import ChangeItem, { type Change } from '@/components/ChangeItem';
import type { Category } from '@/lib/model-category';
import { formatRatio, timeAgo } from '@/components/price-format';

interface Site {
  id: number;
  name: string;
  base_url: string;
  group_tag: string | null;
  notes: string | null;
  architecture: string | null;
  last_fetched_at: string | null;
  last_fetch_ok: number | null;
  last_fetch_error: string | null;
}

interface GroupRow extends Omit<GroupView, 'name'> {
  group_name: string;
  fetched_at: string;
}

const mono = 'var(--font-geist-mono), monospace';

function SiteDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const [site, setSite] = useState<Site | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const json = (url: string) => fetch(url, { cache: 'no-store' }).then(async (r) => ({ status: r.status, body: await r.json() }));
    try {
      const [s, g, c] = await Promise.all([
        json(`/api/sites/${id}`),
        json(`/api/sites/${id}/price-groups`),
        json(`/api/changes?site_id=${id}&limit=20`),
      ]);
      if (s.body.success) {
        setSite(s.body.data);
        setLoadError('');
      } else if (s.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(s.body.error || '加载站点失败');
      }
      if (g.body.success) setGroups(g.body.data);
      else if (s.body.success) setLoadError(g.body.error || '加载分组失败');
      if (c.body.success) setChanges(c.body.data);
    } catch {
      setLoadError('加载失败，请检查网络后刷新页面');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 状态在 await 之后才更新
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const json = await fetch(`/api/sites/${id}/price-groups`, { method: 'POST' }).then((r) => r.json());
      if (json.success) {
        const d = json.data;
        toast(`已获取 ${d.count} 个分组（${d.architecture} · ${d.latency_ms}ms）${d.changes ? `，${d.changes} 处变动` : ''}`, 'success');
      } else {
        toast(`获取失败：${json.error}`, 'error');
      }
      await load();
    } catch {
      toast('获取分组请求出错', 'error');
    } finally {
      setSyncing(false);
    }
  }

  /** 返回是否保存成功；失败时已经提示过，编辑框保持打开 */
  async function changeCategory(group: string, categories: Category[] | null): Promise<boolean> {
    try {
      const json = await fetch(`/api/sites/${id}/price-groups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_name: group, categories }),
      }).then((r) => r.json());
      if (!json.success) {
        toast(json.error || '保存失败', 'error');
        return false;
      }
      toast(categories ? '已修改分组类别' : '已恢复自动判断', 'success');
      await load();
      return true;
    } catch {
      toast('保存请求出错', 'error');
      return false;
    }
  }

  if (notFound) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
        站点不存在。<Link href="/sites" style={{ color: '#4f46e5' }}>返回站点管理</Link>
      </div>
    );
  }

  const views: GroupView[] = groups.map(({ group_name, ...rest }) => ({ name: group_name, ...rest }));
  const ratios = groups.map((g) => g.ratio).filter((r): r is number => r !== null);
  const modelTotal = new Set(groups.flatMap((g) => (g.models ?? []).map((m) => m.name))).size;

  return (
    <div>
      <Link href="/sites" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 14 }}>
        <ArrowLeft size={14} />
        站点管理
      </Link>

      {loadError && !site ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{loadError}</div>
      ) : loading || !site ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="skeleton" style={{ height: 70 }} />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 44 }} />
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ minWidth: 0 }}>
              <BlurText
                text={site.name}
                as="h1"
                stagger={0.03}
                style={{ fontSize: 26, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.03em', margin: 0, marginBottom: 6 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
                <a href={site.base_url} target="_blank" rel="noreferrer noopener" style={{ fontFamily: mono, color: '#64748b', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {site.base_url}
                  <ExternalLink size={11} />
                </a>
                {site.architecture && <span style={{ fontFamily: mono }}>{site.architecture}</span>}
                {site.group_tag && <span>标签：{site.group_tag}</span>}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: site.last_fetch_ok === 0 ? '#dc2626' : undefined }}>
                  {!site.last_fetched_at ? <CircleDashed size={12} /> : site.last_fetch_ok ? <CheckCircle2 size={12} style={{ color: '#059669' }} /> : <XCircle size={12} />}
                  {site.last_fetched_at ? `${timeAgo(site.last_fetched_at)}获取${site.last_fetch_ok ? '' : '失败'}` : '尚未获取'}
                </span>
              </div>
              {site.notes && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>{site.notes}</p>}
            </div>
            <button
              onClick={sync}
              disabled={syncing}
              style={{
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                border: '1px solid rgba(129, 140, 248, 0.45)',
                color: 'white',
                cursor: syncing ? 'not-allowed' : 'pointer',
                opacity: syncing ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {syncing ? '获取中...' : groups.length ? '重新获取' : '获取分组'}
            </button>
          </div>

          {site.last_fetch_ok === 0 && site.last_fetch_error && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: 16,
                borderRadius: 10,
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.25)',
                fontSize: 12,
                color: '#b91c1c',
                lineHeight: 1.6,
                wordBreak: 'break-all',
              }}
            >
              最近一次获取失败：{site.last_fetch_error}
              {groups.length > 0 && <div style={{ color: 'var(--muted)' }}>下面显示的是上一次成功获取的数据。</div>}
            </div>
          )}

          <div className="site-detail-layout">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={17} style={{ color: '#4f46e5' }} />
                  分组
                </h2>
                {groups.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {groups.length} 个分组 · {modelTotal} 个模型
                    {ratios.length > 0 && ` · 倍率 ${formatRatio(Math.min(...ratios))} ~ ${formatRatio(Math.max(...ratios))}`}
                    {' · 点击分组查看模型和价格'}
                  </span>
                )}
              </div>
              {groups.length === 0 ? (
                <div
                  style={{
                    padding: '28px 20px',
                    background: 'var(--card)',
                    border: '1px dashed var(--border-light)',
                    borderRadius: 14,
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--muted)',
                    lineHeight: 1.7,
                  }}
                >
                  暂无分组数据。点击「获取分组」从站点读取全部分组、模型和倍率（支持 new-api / one-api / sub2api；sub2api 站点未开放模型广场时，需在编辑站点里填写登录账号）。
                </div>
              ) : (
                <GroupTable groups={views} onCategoryChange={changeCategory} />
              )}
            </div>

            <aside style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', alignSelf: 'start' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>倍率变动</div>
              {changes.length === 0 ? (
                <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>暂无变动记录</div>
              ) : (
                changes.map((c) => <ChangeItem key={c.id} c={c} showDate />)
              )}
            </aside>
          </div>
        </>
      )}

      <style>{`
        .site-detail-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; }
        @media (max-width: 980px) { .site-detail-layout { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </div>
  );
}

export default function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 70 }} />}>
      <SiteDetailContent params={params} />
    </Suspense>
  );
}
