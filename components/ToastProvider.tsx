'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

gsap.registerPlugin(useGSAP);

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function ToastRow({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!rowRef.current) return;
      gsap.fromTo(
        rowRef.current,
        { opacity: 0, x: 32, scale: 0.94 },
        { opacity: 1, x: 0, scale: 1, duration: 0.28, ease: 'back.out(1.4)' }
      );
    },
    { scope: rowRef }
  );

  const cfg = {
    success: { icon: CheckCircle2, color: '#059669', border: 'rgba(16, 185, 129, 0.3)', bg: 'rgba(16, 185, 129, 0.1)' },
    error: { icon: AlertCircle, color: '#dc2626', border: 'rgba(239, 68, 68, 0.3)', bg: 'rgba(239, 68, 68, 0.1)' },
    info: { icon: Info, color: '#4f46e5', border: 'rgba(99, 102, 241, 0.3)', bg: 'rgba(99, 102, 241, 0.1)' },
  }[item.type];

  const Icon = cfg.icon;

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        minWidth: 260,
        maxWidth: 380,
        background: 'rgba(255, 255, 255, 0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${cfg.border}`,
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.14)',
        color: 'var(--foreground)',
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span style={{ color: cfg.color, display: 'flex', flexShrink: 0 }}>
        <Icon size={16} />
      </span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{item.message}</span>
      <button
        onClick={() => onClose(item.id)}
        aria-label="关闭通知"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, type, message }]);
      setTimeout(() => remove(id), 3600);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 90,
          pointerEvents: 'none',
        }}
      >
        {items.map((item) => (
          <div key={item.id} style={{ pointerEvents: 'auto' }}>
            <ToastRow item={item} onClose={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
