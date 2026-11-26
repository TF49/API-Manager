'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Plus, Search, X, Server, Layers, XCircle, CircleDashed, Loader2, Plug, RefreshCw } from 'lucide-react';
import SiteRow, { type Site } from '@/components/SiteRow';
import SiteForm from '@/components/SiteForm';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/ToastProvider';
import { describeRun, syncAllAndWait } from '@/components/sync-all';
import BlurText from '@/components/reactbits/BlurText';
import CountUp from '@/components/reactbits/CountUp';
import Magnet from '@/components/reactbits/Magnet';
import SpotlightCard from '@/components/reactbits/SpotlightCard';

gsap.registerPlugin(useGSAP);

type StatusFilter = '' | 'failed' | 'never';

const POLL_MS = 30_000;

export default function SitesPage() {
  const { toast } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [filterGroup, setFilterGroup] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editSite, setEditSite] = useState<Site | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [searchText, setSearchText] = useState('');

  const pageRef = useRef<HTMLDivElement>(null);
  const modalBoxRef = useRef<HTMLDivElement>(null);

  const fetchSites = useCallback(async () => {
    const url = filterGroup ? `/api/sites?group=${encodeURIComponent(filterGroup)}` : '/api/sites';
    const [sitesRes, groupsRes] = await Promise.all([
      fetch(url, { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/groups', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (sitesRes.success) setSites(sitesRes.data);
    if (groupsRes.success) setGroups(groupsRes.data);
    setLoading(false);
  }, [filterGroup]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 状态在 await 之后才更新
    void fetchSites();
    // 定时同步在后台跑，列表定期刷新以显示最新的获取状态
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchSites();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchSites]);

  const failedCount = sites.filter((s) => s.last_fetch_ok === 0).length;
  const neverCount = sites.filter((s) => !s.last_fetched_at).length;
  const groupTotal = sites.reduce((n, s) => n + Number(s.group_count || 0), 0);

  const keyword = searchText.toLowerCase();
  const displaySites = sites.filter((s) => {
    const matchesSearch =
      !keyword ||
      s.name.toLowerCase().includes(keyword) ||
      s.base_url.toLowerCase().includes(keyword) ||
      (s.group_tag || '').toLowerCase().includes(keyword);
    const matchesStatus =
      !filterStatus || (filterStatus === 'failed' && s.last_fetch_ok === 0) || (filterStatus === 'never' && !s.last_fetched_at);
    return matchesSearch && matchesStatus;
  });

  useGSAP(
    () => {
      if (loading) return;
      const rows = pageRef.current?.querySelectorAll('.site-row-item');
      if (rows && rows.length > 0) {
        gsap.fromTo(
          rows,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.32, stagger: { amount: 0.2, from: 'start' }, ease: 'power3.out', clearProps: 'transform' }
        );
      }
    },
    { scope: pageRef, dependencies: [loading, filterGroup, filterStatus] }
  );

  useGSAP(
    () => {
      if (showForm && modalBoxRef.current) {
        gsap.fromTo(modalBoxRef.current, { opacity: 0, scale: 0.93, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: 'back.out(1.5)' });
      }
    },
    { dependencies: [showForm] }
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/sites/${deleteTarget.id}`, { method: 'DELETE' });
      toast(`已删除站点「${deleteTarget.name}」`, 'success');
      setDeleteTarget(null);
      fetchSites();
    } finally {
      setDeleting(false);
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const status = await syncAllAndWait();
      const { text, kind } = describeRun(status);
      toast(text, kind);
      fetchSites();
    } catch (err) {
      toast(err instanceof Error ? err.message : '同步请求出错', 'error');
    } finally {
      setSyncingAll(false);
    }
  }

  const closeForm = () => {
    setShowForm(false);
    setEditSite(null);
  };

  const kpis = [
    { key: '' as StatusFilter, label: '站点数', value: sites.length, color: '#4f46e5', spotlight: 'rgba(99, 102, 241, 0.16)', Icon: Server },
    { key: null, label: '分组总数', value: groupTotal, color: '#059669', spotlight: 'rgba(16, 185, 129, 0.14)', Icon: Layers },
    { key: 'failed' as StatusFilter, label: '最近获取失败', value: failedCount, color: '#dc2626', spotlight: 'rgba(239, 68, 68, 0.12)', Icon: XCircle },
    { key: 'never' as StatusFilter, label: '尚未获取', value: neverCount, color: '#64748b', spotlight: 'rgba(148, 163, 184, 0.12)', Icon: CircleDashed },
  ];

  return (
    <div ref={pageRef}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <BlurText
              text="站点管理"
              as="h1"
              stagger={0.04}
              style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.03em', margin: 0, marginBottom: 6 }}
            />
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>添加中转站后自动获取分组、模型和倍率，并定时同步</p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
            <button
              onClick={handleSyncAll}
              disabled={syncingAll || sites.length === 0}
              style={{
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                color: syncingAll || sites.length === 0 ? 'var(--muted)' : 'var(--foreground)',
                cursor: syncingAll || sites.length === 0 ? 'not-allowed' : 'pointer',
                opacity: syncingAll || sites.length === 0 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {syncingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} style={{ color: '#4f46e5' }} />}
              {syncingAll ? '同步中...' : '全部同步'}
            </button>

            <Magnet magnetStrength={0.2}>
              <button
                onClick={() => {
                  setEditSite(null);
                  setShowForm(true);
                }}
                style={{
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  border: '1px solid rgba(129, 140, 248, 0.45)',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 4px 16px rgba(99, 102, 241, 0.35)',
                }}
              >
                <Plus size={15} strokeWidth={2.4} />
                添加站点
              </button>
            </Magnet>
          </div>
        </div>

        {/* KPI Summary Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {kpis.map(({ key, label, value, color, spotlight, Icon }) => {
            const clickable = key !== null;
            const active = clickable && filterStatus === key && key !== '';
            return (
              <SpotlightCard
                key={label}
                spotlightColor={spotlight}
                onClick={clickable ? () => setFilterStatus((prev) => (prev === key ? '' : key)) : undefined}
                style={{
                  padding: '14px 16px',
                  cursor: clickable ? 'pointer' : 'default',
                  borderColor: active ? `${color}66` : undefined,
                  boxShadow: active ? `0 0 0 1px ${color}44, 0 8px 24px rgba(15, 23, 42, 0.10)` : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{label}</span>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: `${color}18`,
                      border: `1px solid ${color}33`,
                      color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={14} />
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em' }}>
                  <CountUp to={value} duration={0.7} />
                </div>
              </SpotlightCard>
            );
          })}
        </div>

        {/* Search & Filter Bar */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '12px 16px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 280 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              style={{
                width: '100%',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 30px 7px 32px',
                fontSize: 13,
                color: 'var(--foreground)',
                outline: 'none',
              }}
              placeholder="搜索站点名称、URL 或标签..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                aria-label="清空搜索"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginRight: 2 }}>标签：</span>
            {['全部', ...groups].map((g) => {
              const isActive = g === '全部' ? !filterGroup : filterGroup === g;
              return (
                <button
                  key={g}
                  onClick={() => setFilterGroup(g === '全部' ? '' : g === filterGroup ? '' : g)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    borderRadius: 20,
                    background: isActive ? 'linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(129,140,248,0.1) 100%)' : 'transparent',
                    border: isActive ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
                    color: isActive ? '#4338ca' : 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  {g}
                </button>
              );
            })}
          </div>

          {filterStatus && (
            <button
              onClick={() => setFilterStatus('')}
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.28)',
                color: '#4338ca',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              已按状态筛选
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.28)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 70,
            padding: 16,
          }}
        >
          <div
            ref={modalBoxRef}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border-light)',
              borderRadius: 16,
              padding: '26px 28px 24px',
              width: '100%',
              maxWidth: 480,
              maxHeight: 'calc(100vh - 32px)',
              overflowY: 'auto',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(99,102,241,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', margin: 0, letterSpacing: '-0.02em' }}>
                  {editSite ? '编辑站点' : '添加新站点'}
                </h2>
                {editSite && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{editSite.name}</p>}
              </div>
              <button
                onClick={closeForm}
                aria-label="关闭弹窗"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>
            <SiteForm
              initial={editSite || {}}
              groups={groups}
              onSuccess={() => {
                toast(editSite ? '站点修改已保存，正在后台重新获取分组' : '新站点已添加，正在后台获取分组', 'success');
                closeForm();
                fetchSites();
                // 后台获取通常几秒内完成，稍后再刷新一次列表
                setTimeout(() => void fetchSites(), 8000);
              }}
              onCancel={closeForm}
            />
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="删除站点"
        description={`确定删除「${deleteTarget?.name || ''}」？该站点的分组、模型和倍率变动记录也会一并删除，且无法恢复。`}
        confirmLabel="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {loading ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ height: 38, background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }} />
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ padding: '12px 20px', borderBottom: i < 5 ? '1px solid var(--border)' : 'none' }}>
              <div className="skeleton" style={{ height: 28 }} />
            </div>
          ))}
        </div>
      ) : displaySites.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '72px 20px',
            background: 'var(--card)',
            border: '1px dashed var(--border-light)',
            borderRadius: 16,
            gap: 12,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              color: '#4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plug size={24} />
          </div>
          <p style={{ fontSize: 16, color: 'var(--foreground)', fontWeight: 600, margin: 0 }}>
            {searchText || filterGroup || filterStatus ? '没有匹配的站点' : '还没有添加站点'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
            {searchText || filterGroup || filterStatus ? '尝试调整搜索关键词或清除筛选条件' : '点击右上角「添加站点」，填写中转站地址即可'}
          </p>
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 980 }}>
              <div className="site-list-grid" style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-alt)' }}>
                {['站点', 'Base URL', '架构', '分组数', '最后获取', '操作'].map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      letterSpacing: '0.05em',
                      textAlign: h === '操作' ? 'right' : undefined,
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              {displaySites.map((site, idx) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  isLast={idx === displaySites.length - 1}
                  onEdit={(s) => {
                    setEditSite(s);
                    setShowForm(true);
                  }}
                  onDeleteRequest={(s) => setDeleteTarget(s)}
                  onRefresh={fetchSites}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
