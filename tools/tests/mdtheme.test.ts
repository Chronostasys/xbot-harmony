/** Markdown 主题清单测试 —— 必须与 web `types/markdown-theme.ts` 逐字对齐。
 *
 * 判别力：断言 id 集合与**顺序**，任何"少一套/多一套/顺序变了"都会红（顺序会影响设置面板的观感）。
 */
declare const process: { exit: (c: number) => void };

import { MD_THEMES, DEFAULT_MD_THEME, mdThemeLabel, mdThemeMode, normalizeMdTheme, isLightMdTheme, codeTone } from '../../entry/src/main/ets/core/mdtheme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// 1. 与 web MARKDOWN_THEMES 逐字对齐（id + 顺序）
const WANT_IDS = [
  'vscode-dark', 'github-dark', 'github-light', 'solarized-light', 'one-light', 'quiet-light',
  'dracula', 'one-dark', 'monokai', 'tokyo-night', 'nord', 'solarized-dark',
  'night-wolf-gray', 'night-wolf-blue', 'tui-midnight', 'tui-ocean', 'tui-forest', 'tui-sunset',
  'tui-rose', 'tui-mono', 'tui-catppuccin', 'xbot-aurora', 'xbot-nebula',
];
eq('主题数量 = web(23)', MD_THEMES.length, 23);
eq('id 与顺序逐字一致', MD_THEMES.map((t) => t.id).join(','), WANT_IDS.join(','));
eq('默认主题 = web DEFAULT_MARKDOWN_THEME', DEFAULT_MD_THEME, 'vscode-dark');
eq('每套都有非空显示名', MD_THEMES.filter((t) => t.label.length === 0).length, 0);
eq('mode 只能是 dark/light', MD_THEMES.filter((t) => t.mode !== 'dark' && t.mode !== 'light').length, 0);
eq('浅色主题数量 = 4', MD_THEMES.filter((t) => t.mode === 'light').length, 4);

// 2. 查表
eq('未知 id 回落默认', normalizeMdTheme('nope'), 'vscode-dark');
eq('undefined 回落默认', normalizeMdTheme(undefined), 'vscode-dark');
eq('合法 id 原样返回', normalizeMdTheme('monokai'), 'monokai');
eq('标签查表', mdThemeLabel('tokyo-night'), 'Tokyo Night');
eq('未知 id 的标签原样返回（暴露脏数据）', mdThemeLabel('nope'), 'nope');
eq('mode 查表', mdThemeMode('github-light'), 'light');
eq('未知 id 的 mode 回落 dark', mdThemeMode('nope'), 'dark');
eq('isLightMdTheme', isLightMdTheme('one-light'), true);
eq('isLightMdTheme 深色', isLightMdTheme('dracula'), false);

// 3. 代码配色：每套都要给出三个非空角色，且深浅主题不能长得一样
let missing = 0;
for (let i = 0; i < MD_THEMES.length; i++) {
  const t = codeTone(MD_THEMES[i].id);
  if (t.bg.length === 0 || t.fg.length === 0 || t.inlineBg.length === 0) { missing++; }
}
eq('每套主题都有完整代码配色', missing, 0);
// 判别力：不同主题必须给出不同配色（否则等于没实现）
eq('vscode-dark 与 dracula 配色不同', codeTone('vscode-dark').bg !== codeTone('dracula').bg, true);
eq('github-light 与 github-dark 配色不同', codeTone('github-light').bg !== codeTone('github-dark').bg, true);
// 浅色主题的代码底必须比字亮（否则深底浅字压在浅色页面上会割裂）
eq('浅色主题代码底比字亮', ((): boolean => {
  const t = codeTone('github-light');
  return t.bg > t.fg;   // 字符串比较对 #RRGGBB 近似等价于亮度比较（同为 # 开头定长）
})(), true);

console.log(`mdtheme: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
