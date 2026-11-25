import { safeFetch } from '@/lib/net/safe-fetch';
export type ModelTestStatus = 'ok' | 'error' | 'quota' | 'timeout';

export interface ModelTestOutcome {
  model_id: string;
  status: ModelTestStatus;
  status_code: number | null;
  latency_ms: number;
  error_msg: string | null;
}

function resolveV1Base(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? clean : `${clean}/v1`;
}

function extractErrorMessage(rawText: string, statusCode: number): string {
  if (!rawText) return `HTTP ${statusCode}`;
  try {
    const parsed = JSON.parse(rawText);
    const msg =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error_msg ||
      parsed?.detail ||
      (typeof parsed?.error === 'string' ? parsed.error : null);
    if (msg) return String(msg).slice(0, 300);
  } catch {
    // Plain text response
  }
  return rawText.replace(/\s+/g, ' ').trim().slice(0, 200) || `HTTP ${statusCode}`;
}

function classifyHttpFailure(statusCode: number, errorMsg: string): ModelTestStatus {
  if (statusCode === 429 || statusCode === 402) return 'quota';
  const lower = errorMsg.toLowerCase();
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('balance') ||
    lower.includes('余额不足') ||
    lower.includes('额度')
  ) {
    return 'quota';
  }
  return 'error';
}

/**
 * Tests a single model against an OpenAI-compatible (with Anthropic/reasoning fallbacks) endpoint.
 */
export async function testModelAvailability(params: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<ModelTestOutcome> {
  const { baseUrl, apiKey, modelId } = params;
  const v1Base = resolveV1Base(baseUrl);
  const start = Date.now();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const isEmbedding = /(?:^|[-_/])(embedding|embed)(?:[-_/]|$)/i.test(modelId) && !/chat/i.test(modelId);

  try {
    const endpoint = isEmbedding ? `${v1Base}/embeddings` : `${v1Base}/chat/completions`;
    let payload: Record<string, unknown> = isEmbedding
      ? { model: modelId, input: 'hi' }
      : {
          model: modelId,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        };

    let res = await safeFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    let rawText = await res.text();

    // Fallback 1: OpenAI reasoning models (o1/o3/o4/gpt-5) often require max_completion_tokens instead of max_tokens
    if (!isEmbedding && res.status === 400 && /max_tokens|max_completion_tokens/i.test(rawText)) {
      payload = {
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_completion_tokens: 16,
        stream: false,
      };
      res = await safeFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      rawText = await res.text();
    }

    // Fallback 2: Pure Anthropic /v1/messages endpoint when /v1/chat/completions returns 404 for Claude models
    if (!isEmbedding && res.status === 404 && /claude/i.test(modelId)) {
      res = await safeFetch(`${v1Base}/messages`, {
        method: 'POST',
        headers: {
          ...headers,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      rawText = await res.text();
    }

    const latency = Date.now() - start;

    if (!res.ok) {
      const errorMsg = extractErrorMessage(rawText, res.status);
      return {
        model_id: modelId,
        status: classifyHttpFailure(res.status, errorMsg),
        status_code: res.status,
        latency_ms: latency,
        error_msg: `HTTP ${res.status}: ${errorMsg}`,
      };
    }

    // Verify HTTP 200 payload doesn't wrap an upstream error object
    try {
      const parsed = JSON.parse(rawText);
      if (parsed?.error) {
        const msg = extractErrorMessage(rawText, 200);
        return {
          model_id: modelId,
          status: classifyHttpFailure(200, msg),
          status_code: 200,
          latency_ms: latency,
          error_msg: msg,
        };
      }
    } catch {
      // Non-JSON 200 response or SSE chunk; still counts as reachable if 200
    }

    return {
      model_id: modelId,
      status: 'ok',
      status_code: res.status,
      latency_ms: latency,
      error_msg: null,
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    const errorObj = err instanceof Error ? err : null;
    const isTimeout = errorObj?.name === 'TimeoutError' || errorObj?.name === 'AbortError';
    return {
      model_id: modelId,
      status: isTimeout ? 'timeout' : 'error',
      status_code: null,
      latency_ms: latency,
      error_msg: isTimeout ? '请求超时 (>20s)' : String(errorObj?.message || '网络请求失败').slice(0, 300),
    };
  }
}
