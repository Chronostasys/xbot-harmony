/** Markdown 主题清单测试 —— 必须与 web `types/markdown-theme.ts` 逐字对齐。
 *
 * 判别力：断言 id 集合与**顺序**，任何"少一套/多一套/顺序变了"都会红（顺序会影响设置面板的观感）。
 */
declare const process: { exit: (c: number) => void };

import { MD_THEMES, DEFAULT_MD_THEME, mdThemeLabel, mdThemeMode, mdThemePickerDescription, normalizeMdTheme, isLightMdTheme, codeTone, codeBgOf } from '../../entry/src/main/ets/core/mdtheme';
import { darkPalette, porcelainPalette } from '../../entry/src/main/ets/core/theme';

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
// 说明文案里的**项数**必须由 MD_THEMES 派生（2026-10-11 审计钓出：组件曾硬编码「19 项」，
// 而实为 23 套 ⇒ 用户看到的数量与取值集不符）。
// ★ 判别力（mutation 必红）：把 mdThemePickerDescription() 里的 `${MD_THEMES.length}` 改成 `19`
//   ⇒ 下面两条立刻红（第一条找不到「23 项」，第二条找到「19 项」）。
eq('说明文案含真实项数（23 项）', mdThemePickerDescription().indexOf(`${MD_THEMES.length} 项`) >= 0, true);
eq('说明文案不含历史硬编码的 19 项', mdThemePickerDescription().indexOf('19 项') < 0, true);
// 2026-10-14（目标③·真机帧评审）：原文案含 **agent 自造的开发商向术语**
// 「仅作用于 Markdown 代码高亮；与 Web 端共用同一组 id」——「共用同一组 id」是**实现细节**，
// 出现在用户可见设置里 = 真缺陷（web 权威无此句）。
// ★ 判别力（mutation 必红）：首句改成别的话 ⇒ 第①条红；把「与 Web 端共用同一组 id」加回来 ⇒ 第②条红。
const MD_DESC: string = mdThemePickerDescription();
eq('说明文案以 web 权威原文开头（zh-CN.ts:517 settings.mdThemeDesc）',
  MD_DESC.indexOf('选择 Agent 对话区 Markdown 渲染的配色主题') === 0, true);
eq('说明文案不含开发商向术语（共用同一组 id）',
  MD_DESC.indexOf('共用同一组 id') < 0, true);
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

// 4. codeBgOf：全局浅色（**含新白主题 porcelain**）配深色 md 主题时必须回落规范深底。
//    判别力：旧实现在此处硬编码 `p.appBg === '#F8FAFC'`，porcelain 的 appBg 是 #FFFFFF ⇒
//    会漏判、返回 md 主题底色（#161B22）而不是规范深底（#1E1E1E）——这两条能抓住该回归。
eq('深色页 + github-dark ⇒ 用 md 主题底', codeBgOf('github-dark', darkPalette()), '#161B22');
eq('极简白页 + github-dark ⇒ 回落规范深底', codeBgOf('github-dark', porcelainPalette()), '#1E1E1E');
eq('浅色 md 主题 ⇒ 用自己的浅底', codeBgOf('github-light', porcelainPalette()), '#F6F8FA');

console.log(`mdtheme: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);