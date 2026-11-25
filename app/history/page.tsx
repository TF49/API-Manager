'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  BarChart3,
  Gauge,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/ToastProvider';
import BlurText from '@/components/reactbits/BlurText';
import CountUp from '@/components/reactbits/CountUp';
import SpotlightCard from '@/components/reactbits/SpotlightCard';

gsap.registerPlugin(useGSAP);

interface HistoryItem {
  id: number;
  site_id: number;
  site_name: string;
  site_name_live: string | null;
  model_id: string | null;
  action_type: string;
  status: string;
  status_code: number | null;
  latency_ms: number | null;
  error_msg: string | null;
  created_at: string;
}

const actionConfig: Record<string, { label: string; color: string; bg: string }> = {
  test: { label: '连通测试', color: '#4f46e5', bg: 'rgba(99,102,241,0.12)' },
  fetch_models: { label: '获取模型', color: '#0284c7', bg: 'rgba(56,189,248,0.12)' },
  batch_test: { label: '批量测试', color: '#7c3aed', bg: 'rgba(167,139,250,0.12)' },
  model_test: { label: '模型测试', color: '#059669', bg: 'rgba(16,185,129,0.12)' },
};

const statusConfig: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: '正常', color: '#059669', Icon: CheckCircle2 },
  error: { label: '失败', color: '#dc2626', Icon: XCircle },
  quota: { label: '超额', color: '#d97706', Icon: AlertTriangle },
  timeout: { label: '超时', color: '#ea580c', Icon: Clock },
};

function LatencyBar({ ms }: { ms: number }) {
  const max = 3000;
  const pct = Math.max(6, Math.min((ms / max) * 100, 100));
  const color = ms < 500 ? '#059669' : ms < 1500 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 52, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace', color: 'var(--muted)', minWidth: 40 }}>
        {ms}ms
      </span>
    </div>
  );
}

export default function HistoryPage() {
  const { toast } = useToast();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);
  const limit = 30;

  const fetchHistory = useCallback(async () => {
    const res = await fetch(`/api/history?page=${page}&limit=${limit}`);
    const json = await res.json();
    if (json.success) {
      setHistory(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?page=${page}&limit=${limit}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setHistory(json.data);
          setTotal(json.total);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const filteredHistory = history.filter((item) => {
    const matchesAction = !actionFilter || item.action_type === actionFilter;
    const matchesStatus =
      !statusFilter ||
      (statusFilter === 'ok' && item.status === 'ok') ||
      (statusFilter === 'fail' && item.status !== 'ok');
    return matchesAction && matchesStatus;
  });

  useGSAP(
    () => {
      if (loading || !tableRef.current) return;
      const rows = tableRef.current.querySelectorAll('.history-row-item');
      if (rows.length > 0) {
        gsap.fromTo(
          rows,
          { opacity: 0, x: -8 },
          {
            opacity: 1,
            x: 0,
            duration: 0.28,
            stagger: { amount: 0.22, from: 'start' },
            ease: 'power2.out',
            clearProps: 'transform',
          }
        );
      }
    },
    { scope: tableRef, dependencies: [loading, page, actionFilter, statusFilter, history.length] }
  );

  async function confirmClear() {
    setClearing(true);
    try {
      await fetch('/api/history', { method: 'DELETE' });
      toast('调用历史已全部清空', 'success');
      setConfirmOpen(false);
      setPage(1);
      fetchHistory();
    } finally {
      setClearing(false);
    }
  }

  const okCount = history.filter((h) => h.status === 'ok').length;
  const successRate = history.length > 0 ? Math.round((okCount / history.length) * 100) : 0;
  const latencies = history.map((h) => h.latency_ms).filter((v): v is number => v != null);
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 22,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <BlurText
            text="调用历史"
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
            追踪站点连通测试与模型拉取的响应表现
          </p>
        </div>

        <button
          onClick={() => setConfirmOpen(true)}
          disabled={total === 0}
          style={{
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 10,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.28)',
            color: '#dc2626',
            cursor: total === 0 ? 'not-allowed' : 'pointer',
            opacity: total === 0 ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseEnter={(e) => {
            if (total > 0) e.currentTarget.style.background = 'rgba(239,68,68,0.16)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
          }}
        >
          <Trash2 size={14} />
          清空历史
        </button>
      </div>

      {/* Summary Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
        <SpotlightCard spotlightColor="rgba(99, 102, 241, 0.15)" style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>总记录数</span>
            <BarChart3 size={15} style={{ color: '#4f46e5' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--foreground)' }}>
            <CountUp to={total} duration={0.7} />
          </div>
        </SpotlightCard>

        <SpotlightCard spotlightColor="rgba(16, 185, 129, 0.14)" style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>本页成功率</span>
            <Activity size={15} style={{ color: '#059669' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#059669' }}>
            <CountUp to={successRate} duration={0.7} suffix="%" />
          </div>
        </SpotlightCard>

        <SpotlightCard spotlightColor="rgba(56, 189, 248, 0.14)" style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>平均响应延迟</span>
            <Gauge size={15} style={{ color: '#0284c7' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--foreground)' }}>
            <CountUp to={avgLatency} duration={0.7} suffix="ms" />
          </div>
        </SpotlightCard>
      </div>

      {/* Filter Bar */}
      {history.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '10px 16px',
            marginBottom: 16,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>操作：</span>
            {[
              { key: '', label: '全部' },
              { key: 'test', label: '连通测试' },
              { key: 'model_test', label: '模型测试' },
              { key: 'fetch_models', label: '获取模型' },
              { key: 'batch_test', label: '批量测试' },
            ].map((opt) => {
              const active = actionFilter === opt.key;
              return (
                <button
                  key={opt.label}
                  onClick={() => setActionFilter(opt.key)}
                  style={{
                    padding: '4px 11px',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    borderRadius: 20,
                    background: active ? 'rgba(99,102,241,0.18)' : 'transparent',
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

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>状态：</span>
            {[
              { key: '', label: '全部' },
              { key: 'ok', label: '正常' },
              { key: 'fail', label: '异常' },
            ].map((opt) => {
              const active = statusFilter === opt.key;
              return (
                <button
                  key={opt.label}
                  onClick={() => setStatusFilter(opt.key)}
                  style={{
                    padding: '4px 11px',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    borderRadius: 20,
                    background: active ? 'rgba(99,102,241,0.18)' : 'transparent',
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
        </div>
      )}

      {/* Confirm Clear Modal */}
      <ConfirmModal
        open={confirmOpen}
        title="清空调用历史"
        description="确定清空所有调用历史记录？此操作不可撤销。"
        confirmLabel="确认清空"
        loading={clearing}
        onConfirm={confirmClear}
        onCancel={() => setConfirmOpen(false)}
      />

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 52, borderRadius: i === 0 ? '12px 12px 0 0' : i === 7 ? '0 0 12px 12px' : 0 }}
            />
          ))}
        </div>
      ) : filteredHistory.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '76px 20px',
            background: 'var(--card)',
            border: '1px dashed var(--border-light)',
            borderRadius: 16,
            gap: 10,
          }}
        >
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: 14,
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.25)',
              color: '#4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BarChart3 size={24} />
          </div>
          <p style={{ fontSize: 16, color: 'var(--foreground)', fontWeight: 600, margin: 0 }}>
            {history.length === 0 ? '暂无历史记录' : '没有符合筛选条件的记录'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
            {history.length === 0 ? '测试站点连通性或拉取模型后，记录会实时呈现在这里' : '尝试切换操作或状态筛选标签'}
          </p>
        </div>
      ) : (
        <div
          ref={tableRef}
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 680 }}>
              {/* Table Header */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 100px 90px 65px 115px 155px',
                  gap: 16,
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-alt)',
                }}
              >
                {['站点', '操作', '状态', 'HTTP', '延迟', '时间'].map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows */}
              <div>
                {filteredHistory.map((item, idx) => {
                  const sc = statusConfig[item.status];
                  const ac = actionConfig[item.action_type];
                  const StatusIcon = sc?.Icon || CheckCircle2;
                  return (
                    <div
                      key={item.id}
                      className="history-row-item"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 100px 90px 65px 115px 155px',
                        gap: 16,
                        padding: '12px 20px',
                        borderBottom: idx < filteredHistory.length - 1 ? '1px solid var(--border)' : 'none',
                        alignItems: 'center',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface-alt)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Site name */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: 13,
                              color: 'var(--foreground)',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.site_name_live || item.site_name}
                          </span>
                          {item.model_id && (
                            <code
                              title={item.model_id}
                              style={{
                                fontSize: 11,
                                fontFamily: 'var(--font-geist-mono), monospace',
                                color: '#047857',
                                background: 'rgba(16,185,129,0.1)',
                                border: '1px solid rgba(16,185,129,0.25)',
                                padding: '1px 7px',
                                borderRadius: 6,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 220,
                                flexShrink: 1,
                              }}
                            >
                              {item.model_id}
                            </code>
                          )}
                        </div>
                        {item.error_msg && (
                          <span
                            title={item.error_msg}
                            style={{
                              fontSize: 11,
                              color: '#dc2626',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              opacity: 0.8,
                            }}
                          >
                            {item.error_msg.slice(0, 60)}
                          </span>
                        )}
                      </div>

                      {/* Action */}
                      <div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 9px',
                            borderRadius: 20,
                            background: ac?.bg || 'var(--surface-alt)',
                            color: ac?.color || 'var(--muted)',
                            border: `1px solid ${(ac?.color || '#64748b')}33`,
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                          }}
                        >
                          {ac?.label || item.action_type}
                        </span>
                      </div>

                      {/* Status */}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: sc?.color || 'var(--muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <StatusIcon size={13} />
                        {sc?.label || item.status}
                      </span>

                      {/* HTTP Code */}
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: 'var(--font-geist-mono), monospace',
                          color: item.status_code
                            ? item.status_code >= 200 && item.status_code < 300
                              ? '#059669'
                              : item.status_code >= 400 && item.status_code < 500
                              ? '#d97706'
                              : '#dc2626'
                            : 'var(--muted)',
                          fontWeight: item.status_code ? 600 : 400,
                        }}
                      >
                        {item.status_code || '—'}
                      </span>

                      {/* Latency */}
                      {item.latency_ms != null ? (
                        <LatencyBar ms={item.latency_ms} />
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      )}

                      {/* Time */}
                      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {new Date(item.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 9,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: page === 1 ? 'var(--muted-alt)' : 'var(--foreground)',
              cursor: page === 1 ? 'not-allowed' : 'pointer',
              opacity: page === 1 ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ChevronLeft size={14} />
            上一页
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '7px 16px',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 9,
              fontSize: 13,
              color: 'var(--muted)',
              gap: 6,
            }}
          >
            <span style={{ color: 'var(--foreground)', fontWeight: 700 }}>{page}</span>
            <span>/</span>
            <span>{totalPages}</span>
          </div>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 9,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: page === totalPages ? 'var(--muted-alt)' : 'var(--foreground)',
              cursor: page === totalPages ? 'not-allowed' : 'pointer',
              opacity: page === totalPages ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            下一页
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
