export type SiteStatus = 'unknown' | 'ok' | 'error' | 'quota' | 'timeout';

export const statusConfig: Record<SiteStatus, {
  label: string;
  color: string;
  dot: string;
  bg: string;
  border: string;
  pulse?: boolean;
}> = {
  unknown: {
    label: '未测试',
    color: '#64748b',
    dot: '#64748b',
    bg: 'rgba(100, 116, 139, 0.08)',
    border: 'rgba(100, 116, 139, 0.22)',
  },
  ok: {
    label: '正常',
    color: '#059669',
    dot: '#059669',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.28)',
    pulse: true,
  },
  error: {
    label: '无效',
    color: '#dc2626',
    dot: '#dc2626',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.28)',
  },
  quota: {
    label: '超额',
    color: '#d97706',
    dot: '#d97706',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.28)',
  },
  timeout: {
    label: '超时',
    color: '#ea580c',
    dot: '#ea580c',
    bg: 'rgba(249, 115, 22, 0.1)',
    border: 'rgba(249, 115, 22, 0.28)',
  },
};

interface StatusBadgeProps {
  status: SiteStatus;
  latency?: number | null;
}

export default function StatusBadge({ status, latency }: StatusBadgeProps) {
  const cfg = statusConfig[status] || statusConfig.unknown;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        letterSpacing: '0.01em',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: cfg.dot,
          flexShrink: 0,
          boxShadow: `0 0 8px ${cfg.dot}`,
        }}
        className={cfg.pulse ? 'pulse-dot' : ''}
      />
      {cfg.label}
      {latency != null && (
        <span
          style={{
            color: cfg.color,
            opacity: 0.75,
            marginLeft: 2,
            fontFamily: 'var(--font-geist-mono), monospace',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {latency}ms
        </span>
      )}
    </span>
  );
}
