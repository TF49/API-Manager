'use client';

import { useState, useEffect, use, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  ArrowLeft,
  Activity,
  RefreshCw,
  Search,
  X,
  Copy,
  Check,
  Cpu,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Play,
  Square,
  Zap,
} from 'lucide-react';
import StatusBadge, { SiteStatus } from '@/components/StatusBadge';
import BlurText from '@/components/reactbits/BlurText';
import CountUp from '@/components/reactbits/CountUp';
import Magnet from '@/components/reactbits/Magnet';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { useToast } from '@/components/ToastProvider';
import PriceGroupsPanel from '@/components/PriceGroupsPanel';

gsap.registerPlugin(useGSAP);

interface Model {
  model_id: string;
  owned_by: string | null;
  model_created_at: number | null;
  fetched_at: string;
  test_status: SiteStatus;
  test_latency_ms: number | null;
  test_status_code: number | null;
  test_error_msg: string | null;
  last_tested_at: string | null;
}

interface Site {
  id: number;
  name: string;
  base_url: string;
  api_key_masked: string;
  group_tag: string | null;
  status: SiteStatus;
  notes: string | null;
  last_tested_at: string | null;
}

interface TestResult {
  status: SiteStatus;
  status_code?: number | null;
  latency_ms?: number | null;
}

type StatusFilter = '' | 'ok' | 'fail' | 'unknown';

function SiteDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [site, setSite] = useState<Site | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [copiedModel, setCopiedModel] = useState('');

  // Per-model testing states
  const [testingModels, setTestingModels] = useState<Record<string, boolean>>({});
  const [batchTestingModels, setBatchTestingModels] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const batchAbortRef = useRef<AbortController | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const testBannerRef = useRef<HTMLDivElement>(null);

  async function fetchSite() {
    const res = await fetch(`/api/sites/${id}`);
    const json = await res.json();
    if (json.success) setSite(json.data);
    else router.push('/sites');
  }

  async function fetchModels() {
    setLoadingModels(true);
    const res = await fetch(`/api/sites/${id}/models`);
    const json = await res.json();
    if (json.success) setModels(json.data);
    setLoadingModels(false);
  }

  async function refreshModels() {
    setFetchingModels(true);
    try {
      const res = await fetch(`/api/sites/${id}/models`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        await fetchModels();
        toast(`已拉取 ${json.data.count} 个模型（${json.data.latency_ms}ms）`, 'success');
      } else {
        toast(`获取模型失败：${json.error}`, 'error');
      }
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/sites/${id}/test`, { method: 'POST' });
      const json = await res.json();
      const result: TestResult = json.data || json;
      setTestResult(result);
      fetchSite();
      if (result.status === 'ok') {
        toast(`连通正常（${result.latency_ms}ms）`, 'success');
      } else {
        toast('连通测试未通过', 'error');
      }
    } finally {
      setTesting(false);
    }
  }

  async function runSingleModelTest(modelId: string, signal?: AbortSignal, silent = false): Promise<SiteStatus> {
    setTestingModels((prev) => ({ ...prev, [modelId]: true }));
    try {
      const res = await fetch(`/api/sites/${id}/models/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
        signal,
      });
      const json = await res.json();
      const result = json.data;
      if (result) {
        setModels((prev) =>
          prev.map((m) =>
            m.model_id === modelId
              ? {
                  ...m,
                  test_status: result.status as SiteStatus,
                  test_latency_ms: result.latency_ms,
                  test_status_code: result.status_code,
                  test_error_msg: result.error_msg,
                  last_tested_at: result.last_tested_at,
                }
              : m
          )
        );
        if (!silent) {
          if (result.status === 'ok') {
            toast(`${modelId} 可用（${result.latency_ms}ms）`, 'success');
          } else {
            toast(`${modelId} 测试失败：${result.error_msg || '未知错误'}`, 'error');
          }
        }
        return result.status as SiteStatus;
      }
      return 'error';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (!silent) toast(`${modelId} 请求出错`, 'error');
      return 'error';
    } finally {
      setTestingModels((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }

  async function handleBatchTestModels(targets: Model[]) {
    if (targets.length === 0) return;

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchTestingModels(true);
    setBatchProgress({ done: 0, total: targets.length });

    let okCount = 0;
    let failCount = 0;
    let cursor = 0;
    const concurrency = Math.min(3, targets.length);

    async function worker() {
      while (cursor < targets.length) {
        if (controller.signal.aborted) break;
        const current = targets[cursor++];
        try {
          const status = await runSingleModelTest(current.model_id, controller.signal, true);
          if (status === 'ok') okCount++;
          else failCount++;
          setBatchProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') break;
          failCount++;
          setBatchProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (controller.signal.aborted) {
        toast(`已停止模型测试（已完成 ${okCount + failCount}/${targets.length}）`, 'info');
      } else {
        toast(`模型测试完成：${okCount} 个可用，${failCount} 个异常`, okCount > 0 && failCount === 0 ? 'success' : failCount > 0 ? 'info' : 'error');
      }
    } finally {
      batchAbortRef.current = null;
      setBatchTestingModels(false);
    }
  }

  function handleStopBatchTest() {
    batchAbortRef.current?.abort();
  }

  function copyModel(modelId: string) {
    navigator.clipboard.writeText(modelId);
    setCopiedModel(modelId);
    toast(`已复制 ${modelId}`, 'info');
    setTimeout(() => setCopiedModel(''), 2000);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sites/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setSite(json.data);
        else router.push('/sites');
      });
    fetch(`/api/sites/${id}/models`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setModels(json.data);
        setLoadingModels(false);
      });
    return () => {
      cancelled = true;
      batchAbortRef.current?.abort();
    };
  }, [id, router]);

  const ownedByGroups = [...new Set(models.map((m) => m.owned_by).filter((v): v is string => Boolean(v)))];

  const modelStats = {
    ok: models.filter((m) => m.test_status === 'ok').length,
    fail: models.filter((m) => m.test_status === 'error' || m.test_status === 'quota' || m.test_status === 'timeout').length,
    unknown: models.filter((m) => !m.test_status || m.test_status === 'unknown').length,
  };

  const displayModels = models.filter((m) => {
    const matchesSearch =
      !search ||
      m.model_id.toLowerCase().includes(search.toLowerCase()) ||
      (m.owned_by || '').toLowerCase().includes(search.toLowerCase());
    const matchesProvider = !selectedProvider || m.owned_by === selectedProvider;
    const st = m.test_status || 'unknown';
    const matchesStatus =
      !statusFilter ||
      (statusFilter === 'ok' && st === 'ok') ||
      (statusFilter === 'fail' && (st === 'error' || st === 'quota' || st === 'timeout')) ||
      (statusFilter === 'unknown' && st === 'unknown');
    return matchesSearch && matchesProvider && matchesStatus;
  });

  useGSAP(
    () => {
      if (loadingModels || !listRef.current) return;
      const rows = listRef.current.querySelectorAll('.model-row-item');
      if (rows.length > 0) {
        gsap.fromTo(
          rows,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.3,
            stagger: { amount: 0.28, from: 'start' },
            ease: 'power2.out',
            clearProps: 'transform',
          }
        );
      }
    },
    { scope: listRef, dependencies: [loadingModels, models.length, selectedProvider] }
  );

  useGSAP(
    () => {
      if (testResult && testBannerRef.current) {
        gsap.fromTo(
          testBannerRef.current,
          { opacity: 0, y: -6 },
          { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }
        );
      }
    },
    { dependencies: [testResult] }
  );

  if (!site) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10, color: 'var(--muted)' }}>
        <Loader2 size={18} className="animate-spin" style={{ color: '#4f46e5' }} />
        加载站点详情...
      </div>
    );
  }

  const hasActiveFilter = Boolean(search || selectedProvider || statusFilter);

  return (
    <div>
      {/* Back Link */}
      <Link
        href="/sites"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--muted)',
          textDecoration: 'none',
          marginBottom: 18,
          padding: '6px 12px',
          borderRadius: 9,
          background: 'var(--surface-alt)',
          border: '1px solid var(--border)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--foreground)';
          e.currentTarget.style.borderColor = 'var(--border-light)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--muted)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        <ArrowLeft size={14} />
        返回站点列表
      </Link>

      {/* Site Info Card */}
      <SpotlightCard lift={false} style={{ padding: 24, marginBottom: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <BlurText
                  text={site.name}
                  as="h1"
                  stagger={0.03}
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: 'var(--foreground)',
                    letterSpacing: '-0.03em',
                    margin: 0,
                  }}
                />
                {site.group_tag && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 10px',
                      background: 'rgba(99,102,241,0.12)',
                      color: '#4338ca',
                      borderRadius: 20,
                      border: '1px solid rgba(99,102,241,0.28)',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {site.group_tag}
                  </span>
                )}
                <StatusBadge status={site.status} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 58, flexShrink: 0 }}>
                    URL
                  </span>
                  <code style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono), monospace', color: '#64748b', wordBreak: 'break-all' }}>
                    {site.base_url}
                  </code>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 58, flexShrink: 0 }}>
                    API Key
                  </span>
                  <code style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono), monospace', color: '#64748b' }}>
                    {site.api_key_masked}
                  </code>
                </div>
                {site.notes && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 58, flexShrink: 0 }}>
                      备注
                    </span>
                    <span style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>{site.notes}</span>
                  </div>
                )}
                {site.last_tested_at && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', width: 58, flexShrink: 0 }}>
                      上次测
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} />
                      {new Date(site.last_tested_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              <button
                onClick={handleTest}
                disabled={testing}
                style={{
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 9,
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  color: testing ? 'var(--muted)' : 'var(--foreground)',
                  cursor: testing ? 'not-allowed' : 'pointer',
                  opacity: testing ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                {testing ? '测试中...' : '测试连通'}
              </button>

              <Magnet magnetStrength={0.18}>
                <button
                  onClick={refreshModels}
                  disabled={fetchingModels}
                  style={{
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 9,
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    border: '1px solid rgba(129,140,248,0.4)',
                    color: 'white',
                    cursor: fetchingModels ? 'not-allowed' : 'pointer',
                    opacity: fetchingModels ? 0.75 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 4px 14px rgba(99,102,241,0.32)',
                  }}
                >
                  {fetchingModels ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {fetchingModels ? '拉取中...' : '拉取模型'}
                </button>
              </Magnet>
            </div>
          </div>

          {testResult && (
            <div
              ref={testBannerRef}
              style={{
                padding: '11px 15px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 500,
                background:
                  testResult.status === 'ok'
                    ? 'rgba(16,185,129,0.08)'
                    : testResult.status === 'quota'
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(239,68,68,0.08)',
                border: `1px solid ${
                  testResult.status === 'ok'
                    ? 'rgba(16,185,129,0.28)'
                    : testResult.status === 'quota'
                    ? 'rgba(245,158,11,0.28)'
                    : 'rgba(239,68,68,0.28)'
                }`,
                color: testResult.status === 'ok' ? '#059669' : testResult.status === 'quota' ? '#b45309' : '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {testResult.status === 'ok' && (
                <>
                  <CheckCircle2 size={16} />
                  <span>连通正常，响应 {testResult.latency_ms}ms</span>
                </>
              )}
              {testResult.status === 'quota' && (
                <>
                  <AlertTriangle size={16} />
                  <span>Key 超额或余额不足（HTTP {testResult.status_code}），响应 {testResult.latency_ms}ms</span>
                </>
              )}
              {testResult.status === 'error' && (
                <>
                  <XCircle size={16} />
                  <span>连通失败（HTTP {testResult.status_code ?? '无响应'}），响应 {testResult.latency_ms}ms</span>
                </>
              )}
              {testResult.status === 'timeout' && (
                <>
                  <Clock size={16} />
                  <span>请求超时（&gt;15s）</span>
                </>
              )}
            </div>
          )}
        </div>
      </SpotlightCard>

      {/* Pricing Groups Section */}
      <PriceGroupsPanel siteId={id} />

      {/* Models Section */}
      <div>
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
              <Cpu size={18} style={{ color: '#4f46e5' }} />
              可用模型
            </h2>
            {models.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span>
                  共 <strong style={{ color: 'var(--foreground)' }}><CountUp to={models.length} duration={0.6} /></strong> 个模型
                  {ownedByGroups.length > 0 && ` · ${ownedByGroups.length} 个来源`}
                  {` · 最后拉取：${new Date(models[0]?.fetched_at).toLocaleString('zh-CN')}`}
                </span>
                {(modelStats.ok > 0 || modelStats.fail > 0) && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                    {modelStats.ok > 0 && <span style={{ color: '#059669', fontWeight: 600 }}>· {modelStats.ok} 可用</span>}
                    {modelStats.fail > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>· {modelStats.fail} 异常</span>}
                    {modelStats.unknown > 0 && <span>· {modelStats.unknown} 未测</span>}
                  </span>
                )}
              </p>
            )}
          </div>

          {models.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {batchTestingModels ? (
                <button
                  onClick={handleStopBatchTest}
                  style={{
                    padding: '7px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 9,
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.35)',
                    color: '#dc2626',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Square size={12} fill="currentColor" />
                  停止测试 ({batchProgress.done}/{batchProgress.total})
                </button>
              ) : (
                <button
                  onClick={() => handleBatchTestModels(displayModels)}
                  disabled={displayModels.length === 0}
                  style={{
                    padding: '7px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 9,
                    background: 'rgba(16,185,129,0.12)',
                    border: '1px solid rgba(16,185,129,0.32)',
                    color: '#059669',
                    cursor: displayModels.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: displayModels.length === 0 ? 0.5 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Zap size={13} />
                  {hasActiveFilter ? `测试筛选模型 (${displayModels.length})` : `测试全部模型 (${models.length})`}
                </button>
              )}

              <div style={{ position: 'relative' }}>
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
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 9,
                    padding: '7px 30px 7px 32px',
                    fontSize: 13,
                    color: 'var(--foreground)',
                    outline: 'none',
                    width: 240,
                  }}
                  placeholder="搜索模型 ID 或来源..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#6366f1';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    aria-label="清空模型搜索"
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
        </div>

        {/* Filter chips row (Provider + Test Status) */}
        {models.length > 0 && (ownedByGroups.length > 1 || modelStats.ok > 0 || modelStats.fail > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            {ownedByGroups.length > 1 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {['全部来源', ...ownedByGroups].map((provider) => {
                  const active = provider === '全部来源' ? !selectedProvider : selectedProvider === provider;
                  return (
                    <button
                      key={provider}
                      onClick={() => setSelectedProvider(provider === '全部来源' ? '' : selectedProvider === provider ? '' : provider)}
                      style={{
                        padding: '4px 11px',
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        borderRadius: 20,
                        background: active ? 'rgba(99,102,241,0.18)' : 'var(--card)',
                        border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                        color: active ? '#4338ca' : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {provider}
                    </button>
                  );
                })}
              </div>
            ) : <div />}

            {(modelStats.ok > 0 || modelStats.fail > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { key: '' as StatusFilter, label: `全部状态 (${models.length})` },
                  { key: 'ok' as StatusFilter, label: `可用 (${modelStats.ok})` },
                  { key: 'fail' as StatusFilter, label: `异常 (${modelStats.fail})` },
                  { key: 'unknown' as StatusFilter, label: `未测 (${modelStats.unknown})` },
                ].map((opt) => {
                  const active = statusFilter === opt.key;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setStatusFilter(opt.key)}
                      style={{
                        padding: '4px 11px',
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        borderRadius: 20,
                        background: active ? 'rgba(99,102,241,0.18)' : 'var(--card)',
                        border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                        color: active ? '#4338ca' : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Batch testing progress bar */}
        {batchTestingModels && batchProgress.total > 0 && (
          <div
            style={{
              marginBottom: 12,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--foreground)', fontWeight: 500 }}>
                <Loader2 size={13} className="animate-spin" style={{ color: '#059669' }} />
                正在逐个模型发包测试...
              </span>
              <span style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
                {batchProgress.done} / {batchProgress.total} ({Math.round((batchProgress.done / batchProgress.total) * 100)}%)
              </span>
            </div>
            <div style={{ width: '100%', height: 5, background: 'var(--surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #059669, #6366f1)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>
        )}

        {loadingModels ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 48, borderRadius: 9 }} />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              background: 'var(--card)',
              border: '1px dashed var(--border-light)',
              borderRadius: 14,
              gap: 10,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.25)',
                color: '#4f46e5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cpu size={22} />
            </div>
            <p style={{ fontSize: 15, color: 'var(--foreground)', fontWeight: 600, margin: 0 }}>暂无模型数据</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>点击右上角「拉取模型」获取该站点支持的模型列表</p>
          </div>
        ) : (
          <div
            ref={listRef}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {hasActiveFilter && (
              <div
                style={{
                  padding: '8px 16px',
                  background: 'var(--surface-alt)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  color: 'var(--muted)',
                }}
              >
                {displayModels.length === 0
                  ? '没有符合条件的模型'
                  : `显示 ${displayModels.length} / ${models.length} 个模型`}
              </div>
            )}
            <div>
              {displayModels.map((model, idx) => {
                const isTestingThis = Boolean(testingModels[model.model_id]);
                const rowStatus = (model.test_status || 'unknown') as SiteStatus;

                return (
                  <div
                    key={model.model_id}
                    className="model-row-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '11px 16px',
                      borderBottom: idx < displayModels.length - 1 ? '1px solid var(--border)' : 'none',
                      transition: 'background 0.15s',
                      flexWrap: 'wrap',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--surface-alt)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <code
                          style={{
                            fontSize: 13,
                            fontFamily: 'var(--font-geist-mono), monospace',
                            color: 'var(--foreground)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {model.model_id}
                        </code>
                        {model.owned_by && (
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              background: 'var(--surface-alt)',
                              padding: '2px 8px',
                              borderRadius: 20,
                              border: '1px solid var(--border)',
                            }}
                          >
                            {model.owned_by}
                          </span>
                        )}
                      </div>

                      {model.test_error_msg && rowStatus !== 'ok' && (
                        <p
                          title={model.test_error_msg}
                          style={{
                            margin: '4px 0 0',
                            fontSize: 11,
                            color: rowStatus === 'quota' ? '#b45309' : '#dc2626',
                            opacity: 0.88,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 640,
                          }}
                        >
                          {model.test_error_msg}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <StatusBadge status={rowStatus} latency={model.test_latency_ms} />

                      <button
                        onClick={() => runSingleModelTest(model.model_id)}
                        disabled={isTestingThis}
                        title={model.last_tested_at ? `上次测试：${new Date(model.last_tested_at).toLocaleString('zh-CN')}` : '发送实际请求测试该模型'}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 7,
                          background: isTestingThis ? 'rgba(99,102,241,0.12)' : 'var(--surface-alt)',
                          border: `1px solid ${isTestingThis ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`,
                          color: isTestingThis ? '#4338ca' : 'var(--foreground)',
                          cursor: isTestingThis ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {isTestingThis ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />}
                        {isTestingThis ? '测试中' : rowStatus === 'unknown' ? '测试' : '重测'}
                      </button>

                      <button
                        onClick={() => copyModel(model.model_id)}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 7,
                          background: copiedModel === model.model_id ? 'rgba(16,185,129,0.12)' : 'var(--surface-alt)',
                          border: `1px solid ${copiedModel === model.model_id ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
                          color: copiedModel === model.model_id ? '#059669' : 'var(--muted)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {copiedModel === model.model_id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedModel === model.model_id ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {displayModels.length === 0 && hasActiveFilter && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  没有匹配的模型，请尝试其他关键字或筛选条件
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10, color: 'var(--muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ color: '#4f46e5' }} />
          加载中...
        </div>
      }
    >
      <SiteDetailContent params={params} />
    </Suspense>
  );
}
