'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { AlertTriangle, X } from 'lucide-react';

gsap.registerPlugin(useGSAP);

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!open) return;
      if (overlayRef.current) {
        gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power2.out' });
      }
      if (dialogRef.current) {
        gsap.fromTo(
          dialogRef.current,
          { opacity: 0, scale: 0.92, y: 14 },
          { opacity: 1, scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)' }
        );
      }
    },
    { dependencies: [open] }
  );

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
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
        zIndex: 80,
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--card)',
          border: '1px solid var(--border-light)',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.16)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: danger ? 'rgba(239, 68, 68, 0.12)' : 'rgba(99, 102, 241, 0.12)',
                border: `1px solid ${danger ? 'rgba(239, 68, 68, 0.28)' : 'rgba(99, 102, 241, 0.28)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: danger ? '#dc2626' : '#4f46e5',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{title}</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            aria-label="关闭"
            style={{
              width: 28,
              height: 28,
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

        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '14px 0 22px 50px' }}>
          {description}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              background: danger
                ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              border: `1px solid ${danger ? 'rgba(239, 68, 68, 0.4)' : 'rgba(99, 102, 241, 0.4)'}`,
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: danger ? '0 4px 12px rgba(239, 68, 68, 0.25)' : '0 4px 12px rgba(99, 102, 241, 0.3)',
            }}
          >
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
