import { safeFetch, UnsafeUrlError } from '@/lib/net/safe-fetch';

/**
 * 获取中转站的计费分组及倍率，自动识别架构。
 *
 * new-api / one-api 系（均为站点公开接口，不发送任何凭据）：
 *  - GET /api/pricing      → group_ratio（倍率）、usable_group（说明）、data[].enable_groups（各分组可用模型）
 *  - GET /api/user/groups  → { [分组]: { ratio, desc, svip_ratio? } }
 *  两者合并，任一可用即可。
 *
 * sub2api（响应格式为 { code: 0, message, data }）：
 *  - GET /api/v1/settings/public → 识别架构、模型广场开关、验证码开关
 *  - GET /api/v1/model-plaza     → 管理员开启模型广场时公开返回全部分组、倍率和模型
 *  - 未开放广场时，用站点账号登录（POST /api/v1/auth/login）拿 JWT，
 *    再读 GET /api/v1/groups/available（可用分组）和 GET /api/v1/groups/rates（个人专属倍率），
 *    读完立即调用 /api/v1/auth/logout 撤销本次登录的 refresh token。
 */

export interface PriceGroup {
  name: string;
  ratio: number | null;
  /** 部分魔改版 new-api 额外返回的会员倍率 */
  svip_ratio: number | null;
  description: string | null;
  /** 该分组下可用的模型数量（来自 /api/pricing） */
  model_count: number | null;
}

export type SiteArchitecture = 'new-api' | 'sub2api';

export interface PriceGroupsResult {
  origin: string;
  architecture: SiteArchitecture;
  groups: PriceGroup[];
  sources: string[];
}

/** sub2api 站点账号，仅在站点未开放模型广场时用于登录读取分组 */
export interface Sub2apiCredentials {
  email: string;
  password: string;
}

export interface FetchPriceGroupsOptions {
  sub2api?: Sub2apiCredentials | null;
}

/** 需要用户补充凭据或调整站点设置才能继续的错误 */
export class PriceGroupsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceGroupsAuthError';
  }
}

const MAX_GROUPS = 500;
const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 500;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

type GroupMap = Map<string, { ratio?: number | null; svip_ratio?: number | null; description?: string | null; model_count?: number }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toRatio(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function cleanName(v: string): string | null {
  const name = v.trim();
  return name && name.length <= MAX_NAME_LEN ? name : null;
}

function cleanDesc(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const desc = v.trim();
  return desc ? desc.slice(0, MAX_DESC_LEN) : null;
}

function entry(map: GroupMap, rawName: string) {
  const name = cleanName(rawName);
  if (!name) return null;
  let e = map.get(name);
  if (!e) {
    if (map.size >= MAX_GROUPS) return null;
    e = {};
    map.set(name, e);
  }
  return e;
}

/** 解析 /api/pricing 的响应 */
export function parsePricingResponse(json: unknown): GroupMap {
  const map: GroupMap = new Map();
  if (!isRecord(json) || json.success === false) return map;

  if (isRecord(json.group_ratio)) {
    for (const [name, ratio] of Object.entries(json.group_ratio)) {
      const e = entry(map, name);
      if (e) e.ratio = toRatio(ratio);
    }
  }

  if (isRecord(json.usable_group)) {
    for (const [name, desc] of Object.entries(json.usable_group)) {
      const e = entry(map, name);
      if (e) e.description = cleanDesc(desc);
    }
  }

  if (Array.isArray(json.data)) {
    const counts = new Map<string, number>();
    for (const model of json.data) {
      if (!isRecord(model) || !Array.isArray(model.enable_groups)) continue;
      for (const g of new Set(model.enable_groups)) {
        if (typeof g !== 'string') continue;
        const name = cleanName(g);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    // 只给已知分组计数，避免模型里的杂项分组名凭空生成分组
    for (const [name, e] of map) e.model_count = counts.get(name) || 0;
  }

  return map;
}

/** 解析 /api/user/groups 的响应 */
export function parseUserGroupsResponse(json: unknown): GroupMap {
  const map: GroupMap = new Map();
  if (!isRecord(json) || json.success === false || !isRecord(json.data)) return map;

  for (const [name, info] of Object.entries(json.data)) {
    if (!isRecord(info)) continue;
    const e = entry(map, name);
    if (!e) continue;
    e.ratio = toRatio(info.ratio);
    e.svip_ratio = toRatio(info.svip_ratio);
    e.description = cleanDesc(info.desc);
  }
  return map;
}

/** 合并两个来源；倍率以 /api/pricing 为准，按倍率从低到高排序 */
export function mergePriceGroups(pricing: GroupMap, userGroups: GroupMap): PriceGroup[] {
  const names = new Set([...pricing.keys(), ...userGroups.keys()]);
  const groups: PriceGroup[] = [];

  for (const name of names) {
    const p = pricing.get(name) || {};
    const u = userGroups.get(name) || {};
    const ratio = p.ratio ?? u.ratio ?? null;
    if (ratio === null) continue; // 没有倍率的分组没有意义
    groups.push({
      name,
      ratio,
      svip_ratio: u.svip_ratio ?? null,
      description: p.description ?? u.description ?? null,
      model_count: p.model_count ?? null,
    });
    if (groups.length >= MAX_GROUPS) break;
  }

  return groups.sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// sub2api
// ---------------------------------------------------------------------------

export interface Sub2apiSettings {
  modelPlazaEnabled: boolean;
  modelPlazaRequireAuth: boolean;
  /** 登录开启的人机验证名称；null 表示未开启 */
  captcha: string | null;
  backendMode: boolean;
}

/** 解析 /api/v1/settings/public；不是 sub2api 站点时返回 null */
export function parseSub2apiSettings(json: unknown): Sub2apiSettings | null {
  if (!isRecord(json) || json.code !== 0 || !isRecord(json.data)) return null;
  const d = json.data;
  // sub2api 公开设置的固定字段（new-api 没有这个接口）
  if (typeof d.registration_enabled !== 'boolean' && typeof d.model_plaza_enabled !== 'boolean') return null;

  const captchas: Array<[string, string]> = [
    ['turnstile_enabled', 'Cloudflare Turnstile'],
    ['tencent_captcha_enabled', '腾讯云验证码'],
    ['aliyun_captcha_enabled', '阿里云验证码'],
  ];
  const captcha = captchas.find(([key]) => d[key] === true)?.[1] ?? null;

  return {
    modelPlazaEnabled: d.model_plaza_enabled === true,
    modelPlazaRequireAuth: d.model_plaza_require_auth === true,
    captcha,
    backendMode: d.backend_mode_enabled === true,
  };
}

const SUB2API_PLATFORMS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
};

function platformLabel(platform: unknown): string | null {
  if (typeof platform !== 'string' || !platform.trim()) return null;
  const p = platform.trim();
  return SUB2API_PLATFORMS[p.toLowerCase()] ?? p.slice(0, 30);
}

/**
 * 把 sub2api 的分组列表（/groups/available 或 model-plaza 的 groups）转成 PriceGroup。
 * 倍率取实际生效的：个人专属倍率（/groups/rates 或 user_rate_multiplier）优先，否则用分组倍率。
 */
export function parseSub2apiGroups(list: unknown, userRates?: unknown): PriceGroup[] {
  if (!Array.isArray(list)) return [];
  const rates = isRecord(userRates) ? userRates : {};
  const groups: PriceGroup[] = [];
  const seen = new Set<string>();

  for (const g of list) {
    if (groups.length >= MAX_GROUPS) break;
    if (!isRecord(g) || typeof g.name !== 'string') continue;
    if (typeof g.status === 'string' && g.status !== 'active') continue;

    const baseRatio = toRatio(g.rate_multiplier);
    const idKey = typeof g.id === 'number' || typeof g.id === 'string' ? String(g.id) : null;
    const userRatio = (idKey !== null ? toRatio(rates[idKey]) : null) ?? toRatio(g.user_rate_multiplier);
    const ratio = userRatio ?? baseRatio;
    if (ratio === null) continue;

    const platform = platformLabel(g.platform);
    let name = cleanName(g.name);
    // 不同平台可能有同名分组，加平台后缀区分
    if (name && seen.has(name) && platform) name = cleanName(`${name} (${platform})`);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const tags = [
      platform,
      g.subscription_type === 'subscription' ? '订阅制' : null,
      g.is_exclusive === true ? '专属' : null,
      userRatio !== null && baseRatio !== null && userRatio !== baseRatio ? `个人倍率（原 ${baseRatio}x）` : null,
    ].filter(Boolean);
    const desc = cleanDesc(g.description);

    groups.push({
      name,
      ratio,
      svip_ratio: null,
      description: cleanDesc([tags.join(' · '), desc].filter(Boolean).join(' — ')),
      model_count: Array.isArray(g.models) ? g.models.length : null,
    });
  }

  return groups.sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.name.localeCompare(b.name));
}

/** 解析 /api/v1/model-plaza 的 data */
export function parseModelPlazaResponse(data: unknown): PriceGroup[] {
  return isRecord(data) ? parseSub2apiGroups(data.groups) : [];
}

/**
 * 规范化用户随手输入的地址：去空白，缺协议时补 https://，只保留 http/https。
 * 返回 null 表示无法识别为网址。
 */
export function normalizeLookupUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 500 || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 根据站点 Base URL 推导要尝试的站点根地址。
 * Base URL 常填 API 子域（如 https://api.example.com/v1），而分组接口通常在同一 new-api 实例上，
 * 若不行再尝试去掉 "api." 前缀的主域。
 */
export function candidateOrigins(baseUrl: string): string[] {
  const url = new URL(baseUrl.trim());
  const origins = [url.origin];
  if (url.hostname.toLowerCase().startsWith('api.') && url.hostname.split('.').length > 2) {
    const bare = new URL(url.origin);
    bare.hostname = url.hostname.slice(4);
    origins.push(bare.origin);
  }
  return origins;
}

async function readTextCapped(res: Awaited<ReturnType<typeof safeFetch>>): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_BODY_BYTES) {
    await res.body?.cancel();
    throw new Error('响应过大');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('响应过大');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function requestJson(url: string, init: RequestOptions = {}) {
  const res = await safeFetch(url, {
    method: init.method,
    body: init.body,
    headers: { Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await readTextCapped(res);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}，返回的不是 JSON`);
  }
  return { res, json };
}

function upstreamMessage(json: unknown): string {
  return isRecord(json) && typeof json.message === 'string' ? json.message.slice(0, 200) : '';
}

/** new-api 系接口：{ success, message, data } */
async function fetchJson(url: string): Promise<unknown> {
  const { res, json } = await requestJson(url);
  if (!res.ok || (isRecord(json) && json.success === false)) {
    const msg = upstreamMessage(json);
    throw new Error(`HTTP ${res.status}${msg ? `：${msg}` : ''}`);
  }
  return json;
}

class Sub2apiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** sub2api 接口：{ code: 0, message, data }，返回 data */
async function fetchSub2api(url: string, init: RequestOptions = {}): Promise<unknown> {
  const { res, json } = await requestJson(url, {
    ...init,
    headers: {
      'Accept-Language': 'zh-CN',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok || !isRecord(json) || json.code !== 0) {
    const msg = upstreamMessage(json);
    throw new Sub2apiHttpError(`HTTP ${res.status}${msg ? `：${msg}` : ''}`, res.status);
  }
  return json.data;
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return '请求超时';
  return err instanceof Error ? err.message : String(err);
}

async function sub2apiLogin(origin: string, creds: Sub2apiCredentials) {
  let data: unknown;
  try {
    data = await fetchSub2api(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    if (err instanceof Sub2apiHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      throw new PriceGroupsAuthError(`sub2api 登录失败（${err.message}），请检查站点设置里的登录邮箱和密码`);
    }
    throw new Error(`sub2api 登录失败：${describeError(err)}`);
  }
  if (isRecord(data) && data.requires_2fa === true) {
    throw new PriceGroupsAuthError('该 sub2api 账号开启了两步验证，无法自动登录。请在站点上关闭两步验证，或换一个没开的账号');
  }
  if (!isRecord(data) || typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('sub2api 登录响应里没有 access_token');
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '',
  };
}

/** 撤销本次登录产生的 refresh token，避免在站点上堆积会话 */
async function sub2apiLogout(origin: string, accessToken: string, refreshToken: string) {
  if (!refreshToken) return;
  try {
    await fetchSub2api(`${origin}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    /* 撤销失败不影响结果，refresh token 到期后自然失效 */
  }
}

async function fetchSub2apiPriceGroups(
  origin: string,
  settings: Sub2apiSettings,
  creds: Sub2apiCredentials | null | undefined
): Promise<PriceGroupsResult> {
  // 1. 公开的模型广场：不需要任何凭据
  let plazaNote: string;
  if (settings.modelPlazaEnabled && !settings.modelPlazaRequireAuth) {
    try {
      const groups = parseModelPlazaResponse(await fetchSub2api(`${origin}/api/v1/model-plaza`));
      if (groups.length) return { origin, architecture: 'sub2api', groups, sources: ['/api/v1/model-plaza'] };
      plazaNote = '模型广场没有分组数据';
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw err;
      plazaNote = `模型广场读取失败（${describeError(err)}）`;
    }
  } else {
    plazaNote = settings.modelPlazaEnabled ? '模型广场需要登录' : '站点未开放模型广场';
  }

  // 2. 用站点账号登录读取
  const prefix = `这是 sub2api 站点，${plazaNote}`;
  if (!creds) {
    throw new PriceGroupsAuthError(`${prefix}，分组接口需要登录。请在站点设置中填写 sub2api 登录邮箱和密码后重试`);
  }
  if (settings.backendMode) {
    throw new PriceGroupsAuthError(`${prefix}，且站点开启了后台模式（只允许管理员登录），无法用普通账号获取分组`);
  }
  if (settings.captcha) {
    throw new PriceGroupsAuthError(`${prefix}，且登录开启了人机验证（${settings.captcha}），无法自动登录`);
  }

  const { accessToken, refreshToken } = await sub2apiLogin(origin, creds);
  try {
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
    const [available, rates] = await Promise.allSettled([
      fetchSub2api(`${origin}/api/v1/groups/available`, auth),
      fetchSub2api(`${origin}/api/v1/groups/rates`, auth),
    ]);
    if (available.status === 'rejected') {
      if (available.reason instanceof UnsafeUrlError) throw available.reason;
      throw new Error(`sub2api 已登录，但读取分组失败：${describeError(available.reason)}`);
    }
    const groups = parseSub2apiGroups(available.value, rates.status === 'fulfilled' ? rates.value : undefined);
    if (!groups.length) throw new Error('sub2api 已登录，但该账号没有可用分组');

    const sources = ['/api/v1/groups/available'];
    if (rates.status === 'fulfilled') sources.push('/api/v1/groups/rates');
    return { origin, architecture: 'sub2api', groups, sources };
  } finally {
    await sub2apiLogout(origin, accessToken, refreshToken);
  }
}

export async function fetchPriceGroups(baseUrl: string, options: FetchPriceGroupsOptions = {}): Promise<PriceGroupsResult> {
  const failures: string[] = [];

  for (const origin of candidateOrigins(baseUrl)) {
    const [pricing, userGroups, sub2Settings] = await Promise.allSettled([
      fetchJson(`${origin}/api/pricing`),
      fetchJson(`${origin}/api/user/groups`),
      requestJson(`${origin}/api/v1/settings/public`).then(({ json }) => parseSub2apiSettings(json)),
    ]);

    // SSRF 拦截等安全错误直接抛出，不再尝试其他地址
    for (const r of [pricing, userGroups, sub2Settings]) {
      if (r.status === 'rejected' && r.reason instanceof UnsafeUrlError) throw r.reason;
    }

    const pricingMap = pricing.status === 'fulfilled' ? parsePricingResponse(pricing.value) : new Map();
    const userMap = userGroups.status === 'fulfilled' ? parseUserGroupsResponse(userGroups.value) : new Map();
    const groups = mergePriceGroups(pricingMap, userMap);

    if (groups.length) {
      const sources: string[] = [];
      if (pricingMap.size) sources.push('/api/pricing');
      if (userMap.size) sources.push('/api/user/groups');
      return { origin, architecture: 'new-api', groups, sources };
    }

    // 识别为 sub2api 后，它的结果或错误就是最终结论，不再尝试其他地址
    if (sub2Settings.status === 'fulfilled' && sub2Settings.value) {
      return fetchSub2apiPriceGroups(origin, sub2Settings.value, options.sub2api);
    }

    const reasons = [
      `/api/pricing ${pricing.status === 'rejected' ? describeError(pricing.reason) : '无分组数据'}`,
      `/api/user/groups ${userGroups.status === 'rejected' ? describeError(userGroups.reason) : '无分组数据'}`,
    ];
    failures.push(`${origin}（${reasons.join('；')}）`);
  }

  throw new Error(
    `未能获取分组信息，站点可能不是 new-api / one-api / sub2api 架构，或价格页需要登录。尝试过：${failures.join('，')}`
  );
}
