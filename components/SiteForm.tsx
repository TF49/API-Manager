'use client';

import { useState } from 'react';
import { Eye, EyeOff, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { PRESET_GROUPS } from '@/lib/groups';

interface Props {
  initial?: {
    id?: number;
    name?: string;
    base_url?: string;
    group_tag?: string | null;
    notes?: string | null;
    api_key_masked?: string | null;
    login_email?: string | null;
    has_login_password?: boolean;
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
  const hasStoredKey = isEdit && !!initial.api_key_masked;
  const hasStoredLogin = isEdit && !!initial.login_email && !!initial.has_login_password;
  const [form, setForm] = useState({
    name: initial.name || '',
    base_url: initial.base_url || '',
    api_key: '',
    group_tag: initial.group_tag || '',
    notes: initial.notes || '',
    login_email: initial.login_email || '',
    login_password: '',
  });
  const [clearKey, setClearKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showLogin, setShowLogin] = useState(hasStoredLogin);
  const [clearLogin, setClearLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    setLoading(true);
    try {
      const url = isEdit ? `/api/sites/${initial.id}` : '/api/sites';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          clear_api_key: clearKey && !form.api_key.trim(),
          clear_login: clearLogin,
        }),
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

      <div>
        <FormInput
          label="API Key"
          hint={hasStoredKey ? '（可选，留空则不修改）' : '（可选，仅连通测试 / 模型拉取需要）'}
          type={showKey ? 'text' : 'password'}
          placeholder={hasStoredKey ? `当前：${initial.api_key_masked}` : '不填也可获取分组和倍率'}
          value={form.api_key}
          disabled={clearKey}
          onChange={(e) => set('api_key', e.target.value)}
          style={{ fontFamily: 'var(--font-geist-mono), monospace', opacity: clearKey ? 0.5 : 1 }}
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
        {hasStoredKey && (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 8,
              fontSize: 12,
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(e) => {
                setClearKey(e.target.checked);
                if (e.target.checked) set('api_key', '');
              }}
            />
            清除已保存的 API Key
          </label>
        )}
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: showLogin ? '10px 12px 12px' : '0 12px' }}>
        <button
          type="button"
          onClick={() => setShowLogin((v) => !v)}
          aria-expanded={showLogin}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: showLogin ? '0 0 10px' : '10px 0',
            cursor: 'pointer',
            color: 'var(--muted)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.03em',
            textAlign: 'left',
          }}
        >
          <span>
            sub2api 登录
            <span style={{ color: 'var(--muted-alt)', fontWeight: 400, marginLeft: 6 }}>
              {hasStoredLogin && !clearLogin ? `（已保存：${initial.login_email}）` : '（可选，仅 sub2api 站点获取分组需要）'}
            </span>
          </span>
          {showLogin ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showLogin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-alt)', lineHeight: 1.6 }}>
              sub2api 站点没开放模型广场时，分组接口需要登录才能访问。填写后，获取分组时会用这个账号自动登录，读完立即退出。
              站点开启了验证码或两步验证时无法自动登录。密码加密存储，不会返回给浏览器。
            </p>
            <FormInput
              label="登录邮箱"
              type="email"
              autoComplete="off"
              placeholder="you@example.com"
              value={form.login_email}
              disabled={clearLogin}
              onChange={(e) => set('login_email', e.target.value)}
              style={{ opacity: clearLogin ? 0.5 : 1 }}
            />
            <FormInput
              label="登录密码"
              hint={hasStoredLogin ? '（留空则不修改）' : undefined}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={hasStoredLogin ? '已保存，留空保持不变' : 'sub2api 账号密码'}
              value={form.login_password}
              disabled={clearLogin}
              onChange={(e) => set('login_password', e.target.value)}
              style={{ opacity: clearLogin ? 0.5 : 1 }}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
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
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            />
            {hasStoredLogin && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={clearLogin}
                  onChange={(e) => {
                    setClearLogin(e.target.checked);
                    if (e.target.checked) set('login_password', '');
                  }}
                />
                清除已保存的登录信息
              </label>
            )}
          </div>
        )}
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
