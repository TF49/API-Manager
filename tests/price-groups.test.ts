import { describe, expect, it } from 'vitest';
import {
  candidateOrigins,
  mergePriceGroups,
  normalizeLookupUrl,
  parseModelPlazaResponse,
  parseNewApiModel,
  parsePricingResponse,
  parseSub2apiChannels,
  parseSub2apiGroups,
  parseSub2apiModel,
  parseSub2apiSettings,
  parseUserGroupsResponse,
} from '@/lib/price-groups';

const pricing = {
  success: true,
  group_ratio: { default: 2.5, svip: 0.8, 'Claude code Max': 8, broken: 'abc', negative: -1 },
  usable_group: { default: '默认分组', svip: '活动分组', 'Claude code Max': 'CC 稳定' },
  data: [
    { model_name: 'a', quota_type: 0, model_ratio: 1.25, completion_ratio: 4, enable_groups: ['default', 'svip'] },
    { model_name: 'b', quota_type: 1, model_price: 0.04, enable_groups: ['svip', 'svip', 'unknown-group'] },
    { model_name: 'c' },
  ],
};

const userGroups = {
  success: true,
  data: {
    default: { ratio: 2.5, desc: '默认（user）', svip_ratio: 2 },
    svip: { ratio: 0.8, desc: '活动', svip_ratio: 0.5 },
    'only-here': { ratio: '1.5', desc: '' },
  },
};

describe('parsePricingResponse', () => {
  it('extracts ratios, descriptions and models per group', () => {
    const map = parsePricingResponse(pricing);
    const a = { name: 'a', billing: 'token', input: 2.5, output: 10, request: null };
    const b = { name: 'b', billing: 'request', input: null, output: null, request: 0.04 };
    expect(map.get('default')).toEqual({ ratio: 2.5, description: '默认分组', models: [a] });
    expect(map.get('svip')).toEqual({ ratio: 0.8, description: '活动分组', models: [a, b] });
    expect(map.get('Claude code Max')?.models).toEqual([]);
    expect(map.get('broken')?.ratio).toBeNull();
    expect(map.get('negative')?.ratio).toBeNull();
    expect(map.has('unknown-group')).toBe(false);
  });

  it('returns empty for failures and non-objects', () => {
    expect(parsePricingResponse({ success: false, message: '未登录' }).size).toBe(0);
    expect(parsePricingResponse('<html>').size).toBe(0);
    expect(parsePricingResponse(null).size).toBe(0);
  });
});

describe('parseUserGroupsResponse', () => {
  it('extracts ratio, svip_ratio and desc', () => {
    const map = parseUserGroupsResponse(userGroups);
    expect(map.get('default')).toEqual({ ratio: 2.5, svip_ratio: 2, description: '默认（user）' });
    expect(map.get('only-here')).toEqual({ ratio: 1.5, svip_ratio: null, description: null });
  });
});

describe('mergePriceGroups', () => {
  it('merges sources, drops ratio-less groups and sorts by ratio', () => {
    const groups = mergePriceGroups(parsePricingResponse(pricing), parseUserGroupsResponse(userGroups));
    expect(groups.map((g) => g.name)).toEqual(['svip', 'only-here', 'default', 'Claude code Max']);
    expect(groups[0]).toMatchObject({ name: 'svip', ratio: 0.8, svip_ratio: 0.5, description: '活动分组', model_count: 2, platform: null });
    expect(groups[0].models?.map((m) => m.name)).toEqual(['a', 'b']);
    expect(groups[1]).toMatchObject({ model_count: null, models: null });
  });

  it('works with only one source', () => {
    const groups = mergePriceGroups(new Map(), parseUserGroupsResponse(userGroups));
    expect(groups).toHaveLength(3);
  });
});

describe('candidateOrigins', () => {
  it('uses the origin and strips /v1', () => {
    expect(candidateOrigins('https://bob-api.com/v1')).toEqual(['https://bob-api.com']);
  });
  it('also tries the bare domain for api.* hosts', () => {
    expect(candidateOrigins('https://api.bob-api.com/')).toEqual(['https://api.bob-api.com', 'https://bob-api.com']);
  });
  it('does not strip api. from a two-label host', () => {
    expect(candidateOrigins('https://api.com')).toEqual(['https://api.com']);
  });
});

describe('normalizeLookupUrl', () => {
  it.each([
    ['bob-api.com', 'https://bob-api.com'],
    ['  https://bob-api.com/  ', 'https://bob-api.com'],
    ['https://api.bob-api.com/v1/chat', 'https://api.bob-api.com'],
    ['http://example.com:8080/x', 'http://example.com:8080'],
    ['HTTPS://Example.COM', 'https://example.com'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeLookupUrl(input)).toBe(expected);
  });

  it.each(['', '   ', 'ftp://example.com', 'javascript:alert(1)', 'not a url', 'localhostx', 'a'.repeat(501)])(
    'rejects %s',
    (input) => {
      expect(normalizeLookupUrl(input)).toBeNull();
    }
  );
});

describe('parseSub2apiSettings', () => {
  const base = { code: 0, message: 'success', data: { registration_enabled: true, model_plaza_enabled: false, version: '0.2.25' } };

  it('detects sub2api and reads plaza / captcha switches', () => {
    expect(parseSub2apiSettings(base)).toEqual({
      modelPlazaEnabled: false,
      modelPlazaRequireAuth: false,
      captcha: null,
      backendMode: false,
    });
    const s = parseSub2apiSettings({
      code: 0,
      data: { registration_enabled: false, model_plaza_enabled: true, model_plaza_require_auth: true, tencent_captcha_enabled: true },
    });
    expect(s).toMatchObject({ modelPlazaEnabled: true, modelPlazaRequireAuth: true, captcha: '腾讯云验证码' });
  });

  it('rejects non-sub2api responses', () => {
    expect(parseSub2apiSettings({ success: true, data: { registration_enabled: true } })).toBeNull();
    expect(parseSub2apiSettings({ code: 1, data: { registration_enabled: true } })).toBeNull();
    expect(parseSub2apiSettings({ code: 0, data: { foo: 1 } })).toBeNull();
    expect(parseSub2apiSettings('404 page not found')).toBeNull();
  });
});

describe('parseSub2apiGroups', () => {
  const list = [
    { id: 1, name: 'Claude Max', platform: 'anthropic', rate_multiplier: 1.2, description: '稳定', status: 'active', subscription_type: 'standard' },
    { id: 2, name: 'Codex', platform: 'openai', rate_multiplier: 0.5, description: '', is_exclusive: true },
    { id: 3, name: 'Codex', platform: 'gemini', rate_multiplier: 0.8 },
    { id: 4, name: 'Disabled', platform: 'openai', rate_multiplier: 0.1, status: 'disabled' },
    { id: 5, name: 'NoRate', platform: 'openai', rate_multiplier: 'x' },
    { id: 6, name: 'Sub', platform: 'antigravity', rate_multiplier: 1, subscription_type: 'subscription' },
  ];

  it('maps groups, applies personal rates and sorts by effective ratio', () => {
    const groups = parseSub2apiGroups(list, { '1': 0.9 });
    expect(groups.map((g) => [g.name, g.ratio])).toEqual([
      ['Codex', 0.5],
      ['Codex (Gemini)', 0.8],
      ['Claude Max', 0.9],
      ['Sub', 1],
    ]);
    expect(groups.find((g) => g.name === 'Claude Max')?.description).toBe('Claude · 个人倍率（原 1.2x） — 稳定');
    expect(groups.find((g) => g.name === 'Codex')?.description).toBe('OpenAI · 专属');
    expect(groups.find((g) => g.name === 'Sub')?.description).toBe('Antigravity · 订阅制');
    expect(groups[0]).toMatchObject({ svip_ratio: null, model_count: null });
  });

  it('handles bad input', () => {
    expect(parseSub2apiGroups(null)).toEqual([]);
    expect(parseSub2apiGroups({ groups: [] })).toEqual([]);
  });
});

describe('parseModelPlazaResponse', () => {
  it('reads groups with models and user_rate_multiplier', () => {
    const groups = parseModelPlazaResponse({
      groups: [
        {
          id: 1,
          name: 'A',
          platform: 'anthropic',
          rate_multiplier: 2,
          user_rate_multiplier: 1.5,
          models: [
            { name: 'm1', pricing: { billing_mode: 'token', input_price: 0.000003, output_price: 0.000015 } },
            { name: 'm2', pricing: null },
          ],
        },
        { id: 2, name: 'B', platform: 'openai', rate_multiplier: 1, models: [] },
      ],
    });
    expect(groups).toEqual([
      { name: 'B', ratio: 1, svip_ratio: null, description: 'OpenAI', model_count: 0, models: [], platform: 'openai' },
      {
        name: 'A',
        ratio: 1.5,
        svip_ratio: null,
        description: 'Claude · 个人倍率（原 2x）',
        model_count: 2,
        models: [
          { name: 'm1', billing: 'token', input: 3, output: 15, request: null },
          { name: 'm2', billing: 'token', input: null, output: null, request: null },
        ],
        platform: 'anthropic',
      },
    ]);
    expect(parseModelPlazaResponse(null)).toEqual([]);
  });
});

describe('parseNewApiModel', () => {
  it('converts model_ratio to USD per 1M tokens', () => {
    expect(parseNewApiModel({ model_name: 'gpt-4o', quota_type: 0, model_ratio: 1.25, completion_ratio: 4 })).toEqual({
      name: 'gpt-4o',
      billing: 'token',
      input: 2.5,
      output: 10,
      request: null,
    });
    // completion_ratio 缺失时输出价等于输入价
    expect(parseNewApiModel({ model_name: 'x', model_ratio: 0.5 })).toMatchObject({ input: 1, output: 1 });
    expect(parseNewApiModel({ model_name: 'img', quota_type: 1, model_price: 0.02 })).toMatchObject({ billing: 'request', request: 0.02 });
    expect(parseNewApiModel({ model_name: '' })).toBeNull();
  });
});

describe('parseSub2apiModel', () => {
  it('converts per-token prices to USD per 1M tokens without float noise', () => {
    expect(parseSub2apiModel({ name: 'claude', pricing: { billing_mode: 'token', input_price: 0.0000025, output_price: 0.00001 } })).toEqual({
      name: 'claude',
      billing: 'token',
      input: 2.5,
      output: 10,
      request: null,
    });
    expect(parseSub2apiModel({ name: 'img', pricing: { billing_mode: 'image', per_request_price: 0.04 } })).toMatchObject({
      billing: 'request',
      request: 0.04,
    });
    expect(parseSub2apiModel({ name: 'n' })).toMatchObject({ billing: 'token', input: null });
    expect(parseSub2apiModel(null)).toBeNull();
  });
});

describe('parseSub2apiChannels', () => {
  it('maps group ids to their supported models', () => {
    const map = parseSub2apiChannels([
      {
        name: 'ch1',
        platforms: [
          {
            platform: 'openai',
            groups: [{ id: 2 }, { id: 3 }],
            supported_models: [{ name: 'gpt-5', pricing: { billing_mode: 'token', input_price: 0.00000125, output_price: 0.00001 } }],
          },
        ],
      },
      { name: 'ch2', platforms: [{ platform: 'openai', groups: [{ id: 2 }], supported_models: [{ name: 'gpt-5' }, { name: 'o3' }] }] },
    ]);
    expect(map.get('2')?.map((m) => m.name)).toEqual(['gpt-5', 'o3']);
    expect(map.get('2')?.[0].input).toBe(1.25);
    expect(map.get('3')?.map((m) => m.name)).toEqual(['gpt-5']);
    expect(parseSub2apiChannels(null).size).toBe(0);
  });

  it('attaches channel models to /groups/available groups', () => {
    const models = parseSub2apiChannels([{ platforms: [{ groups: [{ id: 7 }], supported_models: [{ name: 'gpt-5' }] }] }]);
    const [g] = parseSub2apiGroups([{ id: 7, name: 'G', platform: 'openai', rate_multiplier: 1 }], undefined, models);
    expect(g).toMatchObject({ model_count: 1, platform: 'openai' });
  });
});
