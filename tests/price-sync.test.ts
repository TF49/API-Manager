import { describe, expect, it } from 'vitest';
import { diffModels, type OldModelRow } from '@/lib/price-sync';
import { refreshIntervalMinutes } from '@/lib/price-scheduler';
import type { GroupModel, PriceGroup } from '@/lib/price-groups';

const tok = (name: string, input: number | null): GroupModel => ({ name, billing: 'token', input, output: input === null ? null : input * 4, request: null });
const req = (name: string, request: number): GroupModel => ({ name, billing: 'request', input: null, output: null, request });
const group = (name: string, models: GroupModel[] | null): PriceGroup => ({
  name,
  ratio: 1,
  svip_ratio: null,
  description: null,
  model_count: models?.length ?? null,
  models,
  platform: null,
});
const old = (g: string, model: string, input: number | null, billing: 'token' | 'request' = 'token'): OldModelRow => ({
  group: g,
  model,
  billing,
  input: billing === 'token' ? input : null,
  request: billing === 'request' ? input : null,
});

describe('diffModels', () => {
  it('aggregates the same price change across groups into one entry', () => {
    const changes = diffModels(
      [old('a', 'gpt-5', 2.5), old('b', 'gpt-5', 2.5), old('c', 'gpt-5', 2.5)],
      [group('a', [tok('gpt-5', 2)]), group('b', [tok('gpt-5', 2)]), group('c', [tok('gpt-5', 2.5)])]
    );
    expect(changes).toEqual([
      { type: 'model_price', model: 'gpt-5', groups: ['a', 'b'], billing: 'token', old_price: 2.5, new_price: 2 },
    ]);
  });

  it('records models added to / removed from existing groups', () => {
    const changes = diffModels(
      [old('a', 'gpt-4o', 5), old('a', 'o3', 4)],
      [group('a', [tok('gpt-4o', 5), tok('gpt-5', 2.5)])]
    );
    expect(changes).toEqual([
      { type: 'model_added', model: 'gpt-5', groups: ['a'], billing: 'token', old_price: null, new_price: 2.5 },
      { type: 'model_removed', model: 'o3', groups: ['a'], billing: 'token', old_price: 4, new_price: null },
    ]);
  });

  it('skips new groups and groups without model data this time', () => {
    const changes = diffModels([old('a', 'gpt-4o', 5)], [group('a', null), group('new', [tok('gpt-5', 1)])]);
    expect(changes).toEqual([]);
  });

  it('treats a billing mode switch as a price change', () => {
    const changes = diffModels([old('a', 'img', 2.5)], [group('a', [req('img', 0.04)])]);
    expect(changes).toEqual([{ type: 'model_price', model: 'img', groups: ['a'], billing: 'request', old_price: 2.5, new_price: 0.04 }]);
  });

  it('reports nothing when prices are unchanged', () => {
    expect(diffModels([old('a', 'gpt-5', 2.5)], [group('a', [tok('gpt-5', 2.5)])])).toEqual([]);
  });
});

describe('refreshIntervalMinutes', () => {
  it('defaults, disables and clamps to avoid setTimeout overflow', () => {
    expect(refreshIntervalMinutes(undefined)).toBe(30);
    expect(refreshIntervalMinutes('')).toBe(30);
    expect(refreshIntervalMinutes('abc')).toBe(30);
    expect(refreshIntervalMinutes('-5')).toBe(30);
    expect(refreshIntervalMinutes('0')).toBe(0);
    expect(refreshIntervalMinutes('0.2')).toBe(1);
    expect(refreshIntervalMinutes('15')).toBe(15);
    // 30 天会让 setTimeout 溢出成 1ms，限制在 7 天
    expect(refreshIntervalMinutes('43200')).toBe(7 * 24 * 60);
  });
});
