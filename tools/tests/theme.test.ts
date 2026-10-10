/** 色板测试（语义 token 缺值会让浅色主题出现"白底白字"，必须钉死）。 */
declare const process: { exit: (c: number) => void };

import {
  darkPalette, lightPalette, paletteValues, normalizeTheme, paletteComplete, paletteOf, THEME_DARK, THEME_LIGHT,
  themeLabel, toggleTheme,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const d = darkPalette();
const l = lightPalette();

eq('深色色板完整', paletteComplete(d), true);
// 枚举表必须覆盖 Palette 的**全部**字段（新增字段忘加进 paletteValues ⇒ 这条红）
eq('取值表覆盖全部字段', paletteValues(d).length, Object.keys(d).length);
eq('浅色取值表同样覆盖', paletteValues(l).length, Object.keys(l).length);
eq('浅色色板完整', paletteComplete(l), true);
eq('两套色板字段数一致', Object.keys(d).length, Object.keys(l).length);

// 深色保留改造前的观感（逐值核对关键角色）
eq('深色背景', d.appBg, '#0B0F19');
eq('深色卡片', d.surface, '#0F172A');
eq('深色正文', d.textPrimary, '#E5E7EB');
eq('深色强调', d.accent, '#7C3AED');
eq('深色边框', d.border, '#1F2937');

// 浅色必须与深色逐字段不同（否则等于没换）
let same = 0;
const keys = Object.keys(d);
for (let i = 0; i < keys.length; i++) {
  const dd: Record<string, string> = d as unknown as Record<string, string>;
  const ll: Record<string, string> = l as unknown as Record<string, string>;
  if (dd[keys[i]] === ll[keys[i]]) { same++; }
}
// 两种主题下**合法相同**的只有三处：transparent（无色）、onAccent（强调色上的白字）、
// bubbleUser（用户气泡保持品牌紫）。其余字段若相同说明浅色没真正生效。
eq('浅色仅 3 个字段与深色相同', same, 3);

// 浅色：背景要亮、文字要暗（反相正确）
eq('浅色背景亮', l.appBg, '#F8FAFC');
eq('浅色正文暗', l.textPrimary, '#0F172A');

eq('取色板 dark', paletteOf(THEME_DARK).appBg, '#0B0F19');
eq('取色板 light', paletteOf(THEME_LIGHT).appBg, '#F8FAFC');
eq('未知主题回落深色', paletteOf('weird').appBg, '#0B0F19');
eq('规范化未知', normalizeTheme('weird'), THEME_DARK);
eq('规范化 light', normalizeTheme(THEME_LIGHT), THEME_LIGHT);
eq('规范化 undefined', normalizeTheme(undefined), THEME_DARK);
eq('主题名', themeLabel(THEME_LIGHT), '浅色');
eq('主题名 dark', themeLabel(THEME_DARK), '深色');
eq('切换', toggleTheme(THEME_LIGHT), THEME_DARK);
eq('切换回来', toggleTheme(THEME_DARK), THEME_LIGHT);

if (fail > 0) { console.log(`  theme: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  theme: ${pass} passed, 0 failed`);
process.exit(0);
