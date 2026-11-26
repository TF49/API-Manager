'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Globe, Loader2, Search, XCircle, Clock, X } from 'lucide-react';
import BlurText from '@/components/reactbits/BlurText';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import PriceGroupList, { ratioRange, type PriceGroupView } from '@/components/PriceGroupList';

interface LookupResult {
  origin: string;
  groups: PriceGroupView[];
  sources: string[];
  latency_ms: number;
}

const RECENT_KEY = 'price-lookup:recent';
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

export default function PriceLookupPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    // localStorage 只能在客户端读取，挂载后再同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
  }, []);

  async function lookup(target: string) {
    const value = target.trim();
    if (!value || loading) return;
    setUrl(value);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/price-groups/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        const next = [json.data.origin as string, ...recent.filter((r) => r !== json.data.origin)].slice(0, RECENT_MAX);
        setRecent(next);
        writeRecent(next);
      } else {
        setError(json.error || '查询失败');
      }
    } catch {
      setError('请求出错，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  }

  function removeRecent(item: string) {
    const next = recent.filter((r) => r !== item);
    setRecent(next);
    writeRecent(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    lookup(url);
  }

  const range = result ? ratioRange(result.groups) : null;

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <BlurText
          text="分组查询"
          as="h1"
          stagger={0.04}
          style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.03em', margin: 0, marginBottom: 6 }}
        />
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          输入任意中转站地址，实时查询它的全部分组及倍率（支持 new-api / one-api 架构，结果不保存）
        </p>
      </div>

      <SpotlightCard lift={false} style={{ padding: 18, marginBottom: 22 }}>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Globe
              size={15}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="例如 https://example.com 或 example.com"
              aria-label="站点地址"
              autoFocus
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 12px 10px 36px',
                fontSize: 14,
                color: 'var(--foreground)',
                outline: 'none',
                fontFamily: 'var(--font-geist-mono), monospace',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#6366f1';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              border: '1px solid rgba(129,140,248,0.4)',
              color: 'white',
              cursor: loading || !url.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !url.trim() ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 4px 14px rgba(99,102,241,0.32)',
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {loading ? '查询中...' : '查询'}
          </button>
        </form>

        {recent.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Clock size={11} />
              最近：
            </span>
            {recent.map((item) => (
              <span
                key={item}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 11,
                  borderRadius: 20,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => lookup(item)}
                  disabled={loading}
                  style={{ background: 'transparent', border: 'none', padding: '3px 4px 3px 10px', color: 'var(--foreground)', cursor: 'pointer', fontSize: 11 }}
                >
                  {item.replace(/^https?:\/\//, '')}
                </button>
                <button
                  type="button"
                  onClick={() => removeRecent(item)}
                  aria-label={`移除 ${item}`}
                  style={{ background: 'transparent', border: 'none', padding: '3px 8px 3px 2px', color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </SpotlightCard>

      {error && (
        <div
          role="alert"
          style={{
            padding: '12px 15px',
            borderRadius: 10,
            fontSize: 13,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.28)',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            wordBreak: 'break-word',
          }}
        >
          <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 46, borderRadius: 9 }} />
          ))}
        </div>
      )}

      {result && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', letterSpacing: '-0.02em', margin: 0, wordBreak: 'break-all' }}>
              {result.origin.replace(/^https?:\/\//, '')}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              共 <strong style={{ color: 'var(--foreground)' }}>{result.groups.length}</strong> 个分组
              {range && ` · 倍率 ${range}`}
              {` · ${result.latency_ms}ms · 来源 ${result.sources.join(' + ')}`}
            </p>
          </div>
          <PriceGroupList key={result.origin} groups={result.groups} />
        </div>
      )}
    </div>
  );
}
