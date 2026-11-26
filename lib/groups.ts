// 预设分组：始终显示在筛选栏和表单中，即使暂无站点
export const PRESET_GROUPS = ['Claude code', 'ChatGPT', 'Antigravity/Gemini', 'Seedance'] as const;

// 预设分组在前（按定义顺序），其余自定义分组按字母序追加
export function mergeGroups(existing: string[]): string[] {
  const presets: string[] = [...PRESET_GROUPS];
  const custom = existing.filter((g) => g && !presets.includes(g)).sort((a, b) => a.localeCompare(b));
  return [...presets, ...custom];
}
