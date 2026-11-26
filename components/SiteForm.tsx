'use client';

import { useState } from 'react';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { PRESET_GROUPS } from '@/lib/groups';

interface Props {
  initial?: {
    id?: number;
    name?: string;
    base_url?: string;
    group_tag?: string | null;
    notes?: string | null;
  };
  groups: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-alt)',
  // Longhands: FormInput overrides borderColor on focus; mixing with `border` makes React warn.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: 9,
  padding: '9px 12px',
  fontSize: 13,
  color: 'var(--foreground)',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

function FormInput({
  label,
  required,
  hint,
  rightSlot,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  hint?: string;
  rightSlot?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--muted)',
          marginBottom: 6,
          letterSpacing: '0.03em',
        }}
      >
        {label}
        {required && <span style={{ color: '#4f46e5', marginLeft: 3 }}>*</span>}
        {hint && <span style={{ color: 'var(--muted-alt)', fontWeight: 400, marginLeft: 6 }}>{hint}</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={{
            ...inputStyle,
            paddingRight: rightSlot ? 38 : 12,
            ...(inputProps.style || {}),
            borderColor: focused ? '#6366f1' : 'var(--border)',
            boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.14)' : 'none',
          }}
        />
        {rightSlot && (
          <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
            {rightSlot}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SiteForm({ initial = {}, groups, onSuccess, onCancel }: Props) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({
    name: initial.name || '',
    base_url: initial.base_url || '',
    api_key: '',
    group_tag: initial.group_tag || '',
    notes: initial.notes || '',
  });
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.base_url.trim()) {
      setError('名称和 Base URL 为必填项');
      return;
    }
    if (!isEdit && !form.api_key.trim()) {
      setError('API Key 为必填项');
      return;
    }
    setLoading(true);
    try {
      const url = isEdit ? `/api/sites/${initial.id}` : '/api/sites';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FormInput
        label="站点名称"
        required
        placeholder="例：OpenRouter / 硅基流动"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
      />

      <FormInput
        label="Base URL"
        required
        placeholder="https://openrouter.ai/api"
        value={form.base_url}
        onChange={(e) => set('base_url', e.target.value)}
        style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
      />

      <FormInput
        label="API Key"
        required={!isEdit}
        hint={isEdit ? '（留空则不修改）' : undefined}
        type={showKey ? 'text' : 'password'}
        placeholder={isEdit ? '留空则不修改' : 'sk-...'}
        value={form.api_key}
        onChange={(e) => set('api_key', e.target.value)}
        style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
        rightSlot={
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
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
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />

      <div>
        <label
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--muted)',
            marginBottom: 6,
            letterSpacing: '0.03em',
          }}
        >
          快速分组
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESET_GROUPS.map((g) => {
            const active = form.group_tag === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={active}
                onClick={() => set('group_tag', active ? '' : g)}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  borderRadius: 20,
                  background: active
                    ? 'linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(129,140,248,0.1) 100%)'
                    : 'transparent',
                  border: active ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
                  color: active ? '#4338ca' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--muted)',
              marginBottom: 6,
              letterSpacing: '0.03em',
            }}
          >
            分组标签
          </label>
          <input
            list="groups-list"
            placeholder="选择上方分组或自定义"
            value={form.group_tag}
            onChange={(e) => set('group_tag', e.target.value)}
            style={inputStyle}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = '#6366f1';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.14)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <datalist id="groups-list">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--muted)',
              marginBottom: 6,
              letterSpacing: '0.03em',
            }}
          >
            备注
          </label>
          <input
            placeholder="可选备注信息"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            style={inputStyle}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = '#6366f1';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.14)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.28)',
            borderRadius: 9,
            fontSize: 13,
            color: '#b91c1c',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '9px 20px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 9,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--border)';
            e.currentTarget.style.color = 'var(--foreground)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--surface-alt)';
            e.currentTarget.style.color = 'var(--muted)';
          }}
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '9px 24px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 9,
            background: loading ? 'rgba(99,102,241,0.5)' : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            border: '1px solid rgba(99,102,241,0.4)',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.8 : 1,
            boxShadow: loading ? 'none' : '0 4px 14px rgba(99,102,241,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {loading ? '保存中...' : isEdit ? '保存修改' : '添加站点'}
        </button>
      </div>
    </form>
  );
}
