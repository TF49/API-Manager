/**
 * 模型类别：按模型名判断属于 GPT / Claude / Gemini / 国模 / 其他。
 * 分组的类别是分组内所有模型类别的并集，没有模型数据时再用平台、分组名推断。
 */

export const CATEGORIES = [
  { key: 'gpt', label: 'GPT' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'cn', label: '国模' },
  { key: 'other', label: '其他' },
] as const;

export type Category = (typeof CATEGORIES)[number]['key'];

const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((c) => c.key));

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && CATEGORY_KEYS.has(v);
}

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// 按顺序匹配，先匹配到的为准（例如 "deepseek-r1-distill-qwen" 归国模）
const RULES: Array<[Category, RegExp]> = [
  ['claude', /claude|anthropic/],
  ['gemini', /gemini|gemma|imagen|veo-?\d|nano-?banana|learnlm/],
  [
    'cn',
    /deepseek|qwen|qwq|qvq|tongyi|glm|zhipu|kimi|moonshot|doubao|seed(?:ance|ream|-)|ernie|wenxin|hunyuan|^hy\d|minimax|abab|baichuan|\byi-|step-\d|spark|internlm|longcat|\bling-|\bring-|mimo|baidu|bytedance|360gpt|sensenova|skylark|wan-?\d|kling|hailuo|cogview|cogvideo/,
  ],
  ['gpt', /gpt|chatgpt|codex|openai|dall-?e|whisper|^o\d(?:$|[-.])|^tts-|^text-embedding|^omni-moderation|^sora/],
];

/** 根据模型名判断类别 */
export function classifyModel(modelName: string): Category {
  // 去掉常见的 "provider/" 前缀，例如 "openai/gpt-4o"、"[官方]claude"
  const name = modelName.toLowerCase().replace(/^\[[^\]]*\]\s*/, '');
  const bare = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  for (const [cat, re] of RULES) {
    if (re.test(bare) || re.test(name)) return cat;
  }
  return 'other';
}

const PLATFORM_CATEGORY: Record<string, Category> = {
  anthropic: 'claude',
  claude: 'claude',
  openai: 'gpt',
  gemini: 'gemini',
};

/** 按固定顺序排列类别 */
function ordered(set: Set<Category>): Category[] {
  return CATEGORIES.map((c) => c.key).filter((k) => set.has(k));
}

/**
 * 推断分组的类别。
 * 优先看分组内的模型；没有模型数据时看 sub2api 平台，再看分组名和说明。
 */
export function classifyGroup(input: { models: string[]; platform?: string | null; name: string; description?: string | null }): Category[] {
  const set = new Set<Category>();
  for (const m of input.models) set.add(classifyModel(m));
  if (set.size) return ordered(set);

  const platform = input.platform?.toLowerCase();
  if (platform && PLATFORM_CATEGORY[platform]) return [PLATFORM_CATEGORY[platform]];

  const text = `${input.name} ${input.description ?? ''}`;
  const guess = classifyModel(text);
  return [guess];
}

/** 解析数据库里的类别覆盖（逗号分隔）；无效值丢弃，空则返回 null */
export function parseCategoryList(v: unknown): Category[] | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const set = new Set<Category>();
  for (const part of v.split(',')) {
    const k = part.trim();
    if (isCategory(k)) set.add(k);
  }
  return set.size ? ordered(set) : null;
}
