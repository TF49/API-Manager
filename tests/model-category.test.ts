import { describe, expect, it } from 'vitest';
import { classifyGroup, classifyModel, parseCategoryList } from '@/lib/model-category';

describe('classifyModel', () => {
  it.each([
    ['gpt-4o', 'gpt'],
    ['gpt-5-codex', 'gpt'],
    ['chatgpt-4o-latest', 'gpt'],
    ['o3-mini', 'gpt'],
    ['o1', 'gpt'],
    ['openai/gpt-4.1', 'gpt'],
    ['text-embedding-3-small', 'gpt'],
    ['claude-sonnet-4-5-20250929', 'claude'],
    ['anthropic/claude-opus-4', 'claude'],
    ['gemini-2.5-pro', 'gemini'],
    ['nano-banana', 'gemini'],
    ['veo-3', 'gemini'],
    ['deepseek-v3.1', 'cn'],
    ['deepseek-r1-distill-qwen-32b', 'cn'],
    ['qwen3-coder-plus', 'cn'],
    ['glm-4.6', 'cn'],
    ['kimi-k2-0905', 'cn'],
    ['doubao-seed-1.6', 'cn'],
    ['doubao-seedance-1-0-pro', 'cn'],
    ['MiniMax-M2', 'cn'],
    ['hy4-flash', 'cn'],
    ['360gpt-pro', 'cn'],
    ['grok-4', 'other'],
    ['llama-3.3-70b', 'other'],
    ['omni', 'other'],
  ])('%s → %s', (name, cat) => {
    expect(classifyModel(name)).toBe(cat);
  });
});

describe('classifyGroup', () => {
  it('unions model categories in fixed order', () => {
    expect(classifyGroup({ models: ['gemini-2.5-pro', 'claude-sonnet-4', 'gpt-4o'], name: 'mix' })).toEqual(['gpt', 'claude', 'gemini']);
  });

  it('falls back to platform, then group name', () => {
    expect(classifyGroup({ models: [], platform: 'anthropic', name: 'x' })).toEqual(['claude']);
    expect(classifyGroup({ models: [], platform: 'antigravity', name: 'Claude 反代' })).toEqual(['claude']);
    expect(classifyGroup({ models: [], name: 'Codex 专用' })).toEqual(['gpt']);
    expect(classifyGroup({ models: [], name: 'default' })).toEqual(['other']);
  });
});

describe('parseCategoryList', () => {
  it('keeps valid categories in fixed order', () => {
    expect(parseCategoryList('claude,gpt,bogus')).toEqual(['gpt', 'claude']);
    expect(parseCategoryList('')).toBeNull();
    expect(parseCategoryList('bogus')).toBeNull();
    expect(parseCategoryList(null)).toBeNull();
  });
});
