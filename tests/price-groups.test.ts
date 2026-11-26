import { describe, expect, it } from 'vitest';
import {
  candidateOrigins,
  mergePriceGroups,
  normalizeLookupUrl,
  parsePricingResponse,
  parseUserGroupsResponse,
} from '@/lib/price-groups';

const pricing = {
  success: true,
  group_ratio: { default: 2.5, svip: 0.8, 'Claude code Max': 8, broken: 'abc', negative: -1 },
  usable_group: { default: '默认分组', svip: '活动分组', 'Claude code Max': 'CC 稳定' },
  data: [
    { model_name: 'a', enable_groups: ['default', 'svip'] },
    { model_name: 'b', enable_groups: ['svip', 'svip', 'unknown-group'] },
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
  it('extracts ratios, descriptions and model counts', () => {
    const map = parsePricingResponse(pricing);
    expect(map.get('default')).toEqual({ ratio: 2.5, description: '默认分组', model_count: 1 });
    expect(map.get('svip')).toEqual({ ratio: 0.8, description: '活动分组', model_count: 2 });
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
    expect(groups[0]).toEqual({ name: 'svip', ratio: 0.8, svip_ratio: 0.5, description: '活动分组', model_count: 2 });
    expect(groups[1].model_count).toBeNull();
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
