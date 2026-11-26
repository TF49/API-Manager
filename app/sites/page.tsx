'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  Zap,
  Plus,
  Search,
  X,
  Server,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Loader2,
  Plug,
} from 'lucide-react';
import SiteRow from '@/components/SiteRow';
import SiteForm from '@/components/SiteForm';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/ToastProvider';
import BlurText from '@/components/reactbits/BlurText';
import CountUp from '@/components/reactbits/CountUp';
import Magnet from '@/components/reactbits/Magnet';
import SpotlightCard from '@/components/reactbits/SpotlightCard';

gsap.registerPlugin(useGSAP);

interface Site {
  id: number;
  name: string;
  base_url: string;
  api_key_masked: string | null;
  login_email?: string | null;
  has_login_password?: boolean;
  group_tag: string | null;
  notes: string | null;
  status: 'unknown' | 'ok' | 'error' | 'quota' | 'timeout';
  last_tested_at: string | null;
}

interface BatchResult {
  id: number;
  name: string;
  status: string;
  latency_ms?: number | null;
}

type StatusFilter = '' | 'ok' | 'issue' | 'unknown';

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
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchResults, setBatchResults] = useState<Record<number, BatchResult>>({});
  const [searchText, setSearchText] = useState('');

  const pageRef = useRef<HTMLDivElement>(null);
  const modalBoxRef = useRef<HTMLDivElement>(null);
  const batchBoxRef = useRef<HTMLDivElement>(null);

  const fetchSites = useCallback(async () => {
    const url = filterGroup ? `/api/sites?group=${encodeURIComponent(filterGroup)}` : '/api/sites';
    const [sitesRes, groupsRes] = await Promise.all([
      fetch(url).then((r) => r.json()),
      fetch('/api/groups').then((r) => r.json()),
    ]);
    if (sitesRes.success) setSites(sitesRes.data);
    if (groupsRes.success) setGroups(groupsRes.data);
    setLoading(false);
  }, [filterGroup]);

  useEffect(() => {
    let cancelled = false;
    const url = filterGroup ? `/api/sites?group=${encodeURIComponent(filterGroup)}` : '/api/sites';
    Promise.all([
      fetch(url).then((r) => r.json()),
      fetch('/api/groups').then((r) => r.json()),
    ]).then(([sitesRes, groupsRes]) => {
      if (cancelled) return;
      if (sitesRes.success) setSites(sitesRes.data);
      if (groupsRes.success) setGroups(groupsRes.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filterGroup]);

  const statusCounts = { ok: 0, error: 0, quota: 0, unknown: 0, timeout: 0 };
  sites.forEach((s) => {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  });
  const issueCount = statusCounts.error + statusCounts.quota + statusCounts.timeout;

  const displaySites = sites.filter((s) => {
    const matchesSearch =
      !searchText ||
      s.name.toLowerCase().includes(searchText.toLowerCase()) ||
      s.base_url.toLowerCase().includes(searchText.toLowerCase()) ||
      (s.group_tag || '').toLowerCase().includes(searchText.toLowerCase());

    const matchesStatus =
      !filterStatus ||
      (filterStatus === 'ok' && s.status === 'ok') ||
      (filterStatus === 'unknown' && s.status === 'unknown') ||
      (filterStatus === 'issue' && (s.status === 'error' || s.status === 'quota' || s.status === 'timeout'));

    return matchesSearch && matchesStatus;
  });

  // GSAP stagger entrance for list rows
  useGSAP(
    () => {
      if (loading) return;
      const rows = pageRef.current?.querySelectorAll('.site-row-item');
      if (rows && rows.length > 0) {
        gsap.fromTo(
          rows,
          { opacity: 0, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: 0.32,
            stagger: { amount: 0.2, from: 'start' },
            ease: 'power3.out',
            clearProps: 'transform',
          }
        );
      }
    },
    { scope: pageRef, dependencies: [loading, filterGroup, filterStatus, sites.length] }
  );

  // GSAP modal spring entrance
  useGSAP(
    () => {
      if (showForm && modalBoxRef.current) {
        gsap.fromTo(
          modalBoxRef.current,
          { opacity: 0, scale: 0.93, y: 16 },
          { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: 'back.out(1.5)' }
        );
      }
    },
    { dependencies: [showForm] }
  );

  // GSAP batch result entrance
  useGSAP(
    () => {
      if (Object.keys(batchResults).length > 0 && batchBoxRef.current) {
        gsap.fromTo(
          batchBoxRef.current,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }
        );
      }
    },
    { dependencies: [batchResults] }
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

  async function handleBatchTest() {
    setBatchTesting(true);
    setBatchResults({});
    try {
      const res = await fetch('/api/sites/batch-test', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const map: Record<number, BatchResult> = {};
        (json.data as BatchResult[]).forEach((r) => {
          map[r.id] = r;
        });
        setBatchResults(map);
        const results = json.data as BatchResult[];
        const okNum = results.filter((r) => r.status === 'ok').length;
        const skipped = results.filter((r) => r.status === 'skipped').length;
        const tested = results.length - skipped;
        toast(
          `批量测试完成：${okNum} / ${tested} 个站点正常${skipped ? `，${skipped} 个未配置 Key 已跳过` : ''}`,
          'info'
        );
      }
      fetchSites();
    } finally {
      setBatchTesting(false);
    }
  }

  const kpis = [
    {
      key: '' as StatusFilter,
      label: '总站点数',
      value: sites.length,
      color: '#4f46e5',
      spotlight: 'rgba(99, 102, 241, 0.16)',
      Icon: Server,
    },
    {
      key: 'ok' as StatusFilter,
      label: '健康可用',
      value: statusCounts.ok,
      color: '#059669',
      spotlight: 'rgba(16, 185, 129, 0.14)',
      Icon: CheckCircle2,
    },
    {
      key: 'issue' as StatusFilter,
      label: '异常 / 超额',
      value: issueCount,
      color: '#d97706',
      spotlight: 'rgba(245, 158, 11, 0.14)',
      Icon: AlertTriangle,
    },
    {
      key: 'unknown' as StatusFilter,
      label: '待测试',
      value: statusCounts.unknown,
      color: '#64748b',
      spotlight: 'rgba(148, 163, 184, 0.12)',
      Icon: HelpCircle,
    },
  ];

  return (
    <div ref={pageRef}>
      {/* Page Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <BlurText
              text="站点管理"
              as="h1"
              stagger={0.04}
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: 'var(--foreground)',
                letterSpacing: '-0.03em',
                margin: 0,
                marginBottom: 6,
              }}
            />
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              集中管理 API 站点密钥、连通状态与可用模型清单
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
            <button
              onClick={handleBatchTest}
              disabled={batchTesting || sites.length === 0}
              style={{
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                color: batchTesting || sites.length === 0 ? 'var(--muted)' : 'var(--foreground)',
                cursor: batchTesting || sites.length === 0 ? 'not-allowed' : 'pointer',
                opacity: batchTesting || sites.length === 0 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!batchTesting && sites.length > 0) e.currentTarget.style.background = 'var(--border)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--surface-alt)';
              }}
            >
              {batchTesting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} style={{ color: '#b45309' }} />}
              {batchTesting ? '批量测试中...' : '批量测试'}
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
            const active = filterStatus === key && key !== '';
            return (
              <SpotlightCard
                key={label}
                spotlightColor={spotlight}
                onClick={() => setFilterStatus((prev) => (prev === key ? '' : key))}
                style={{
                  padding: '14px 16px',
                  cursor: 'pointer',
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
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted)',
                pointerEvents: 'none',
              }}
            />
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
              placeholder="搜索站点名称、URL 或分组..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#6366f1';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                aria-label="清空搜索"
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
                  padding: 2,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginRight: 2 }}>分组：</span>
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
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(129,140,248,0.1) 100%)'
                      : 'transparent',
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
            if (e.target === e.currentTarget) {
              setShowForm(false);
              setEditSite(null);
            }
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
                onClick={() => {
                  setShowForm(false);
                  setEditSite(null);
                }}
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
                setShowForm(false);
                toast(editSite ? '站点修改已保存' : '新站点已添加', 'success');
                setEditSite(null);
                fetchSites();
              }}
              onCancel={() => {
                setShowForm(false);
                setEditSite(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除站点"
        description={`确定删除「${deleteTarget?.name || ''}」？该站点缓存的模型信息也将一并清除，且无法恢复。`}
        confirmLabel="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Site Grid */}
      {loading ? (
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
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
            {searchText || filterGroup || filterStatus ? '尝试调整搜索关键词或清除筛选条件' : '点击右上角「添加站点」开始管理你的第一个 API Key'}
          </p>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 1040 }}>
              {/* List Header */}
              <div
                className="site-list-grid"
                style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-alt)',
                }}
              >
                {['站点', 'Base URL', 'API Key', '状态', '最后测试', '操作'].map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
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

      {/* Batch Test Results */}
      {Object.keys(batchResults).length > 0 && (
        <div
          ref={batchBoxRef}
          style={{
            marginTop: 24,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={15} style={{ color: '#b45309' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>批量测试结果</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {Object.keys(batchResults).length} 个站点
              </span>
            </div>
            <button
              onClick={() => setBatchResults({})}
              aria-label="关闭批量结果"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                display: 'flex',
                padding: 4,
                borderRadius: 6,
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div style={{ padding: '6px 0' }}>
            {Object.values(batchResults).map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 20px',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 500 }}>{r.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {r.latency_ms != null && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        fontFamily: 'var(--font-geist-mono), monospace',
                      }}
                    >
                      <CountUp to={r.latency_ms} duration={0.45} suffix="ms" />
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color:
                        r.status === 'ok'
                          ? '#059669'
                          : r.status === 'quota'
                            ? '#d97706'
                            : r.status === 'skipped'
                              ? 'var(--muted)'
                              : '#dc2626',
                    }}
                  >
                    {r.status === 'ok'
                      ? '正常'
                      : r.status === 'quota'
                        ? '超额'
                        : r.status === 'skipped'
                          ? '未配置 Key'
                          : '失败'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
