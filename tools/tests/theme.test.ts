/** 色板测试（语义 token 缺值会让浅色主题出现"白底白字"，必须钉死）。 */
declare const process: { exit: (c: number) => void };

import {
  darkPalette, lightPalette, porcelainPalette, paletteValues, normalizeTheme, paletteComplete, paletteOf,
  THEME_DARK, THEME_LIGHT, THEME_PORCELAIN, ALL_THEMES,
  themeLabel, toggleTheme, isDarkThemeName, isLightThemeName, isLightPalette, effectsOf,
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

// 深色 = "深空仪表盘"：单一紫色系 + 每级约 8% 亮度阶梯（2026-10 重设计，逐值核对）
eq('深色背景', d.appBg, '#0B0B0E');
eq('深色卡片', d.surface, '#0E0E14');
eq('深色正文', d.textPrimary, '#EDEDF2');
eq('深色强调', d.accent, '#7C5CFF');
eq('深色边框', d.border, '#20202B');
// 纪律：accentSoft 必须是**紫系**（历史 bug：曾是浅蓝 #93C5FD，与紫主色打架）
eq('强调浅色同色相(紫)', d.accentSoft, '#B9A7FF');
// 纪律：border 不能等于 surfaceHi（历史 bug：两者都曾 #1F2937）
eq('边框与选中面不同值', d.border === d.surfaceHi, false);

// 浅色必须与深色逐字段不同（否则等于没换）
let same = 0;
const keys = Object.keys(d);
for (let i = 0; i < keys.length; i++) {
  const dd: Record<string, string> = d as unknown as Record<string, string>;
  const ll: Record<string, string> = l as unknown as Record<string, string>;
  if (dd[keys[i]] === ll[keys[i]]) { same++; }
}
// 两种主题下**合法相同**的五处：transparent（无色）、onAccent（强调色上的白字）、
// bubbleUser（用户气泡保持品牌紫）、statusRunning / statusWaiting（web 的
// --status-running / --status-waiting 在 dark/light 两套里本就是同一组语义色）。
// 其余字段若相同说明浅色没真正生效。
eq('浅色仅 5 个字段与深色相同', same, 5);

// 浅色：背景要亮、文字要暗（反相正确）
eq('浅色背景亮', l.appBg, '#F8FAFC');
eq('浅色正文暗', l.textPrimary, '#0F172A');

// ── 新增角色（foreground3 + 状态四色）：值必须与 web index.css 逐值一致 ──────────
eq('dark foreground3 = web', d.foreground3, '#4F4F4F');
eq('light foreground3 = web', l.foreground3, '#BBBBBB');
eq('dark 状态色 = web', [d.statusRunning, d.statusWaiting, d.statusIdle, d.statusError].join(','),
  '#3388BB,#E6A700,#858585,#F48771');
eq('light 状态色 = web', [l.statusRunning, l.statusWaiting, l.statusIdle, l.statusError].join(','),
  '#3388BB,#E6A700,#6B6B6B,#D1242F');
// 层级：最弱一档必须比 textMuted 更靠近底色（深色系更暗 / 浅色系更亮）—— 否则"多一档"无意义
// （灰阶值字符串比较即近似亮度比较）
eq('dark foreground3 更暗(更弱)', d.foreground3 < d.textMuted, true);
eq('light foreground3 更亮(更弱)', l.foreground3 > l.textMuted, true);

// ── 极简白（porcelain）：原生独享白主题 ────────────────────────────────────────
const pp = porcelainPalette();
eq('porcelain 完整', paletteComplete(pp), true);
eq('porcelain 取值表覆盖全部字段', paletteValues(pp).length, Object.keys(pp).length);
eq('porcelain 字段数 = dark', Object.keys(pp).length, Object.keys(d).length);
eq('porcelain 画布纯白', pp.appBg, '#FFFFFF');
eq('porcelain 强调色 = Apple Blue', pp.accent, '#0071E3');
// 纪律：不得有 slate/紫残留（accent 与用户气泡都不能是紫）
eq('porcelain 无紫残留(bubbleUser)', pp.bubbleUser, '#0071E3');
eq('porcelain 发丝极淡(≠slate 灰)', pp.border === '#E2E8F0', false);
eq('ALL_THEMES 含 porcelain', ALL_THEMES.indexOf(THEME_PORCELAIN) >= 0, true);
eq('取色板 porcelain', paletteOf(THEME_PORCELAIN).accent, '#0071E3');
eq('规范化 porcelain', normalizeTheme(THEME_PORCELAIN), THEME_PORCELAIN);
eq('主题名 porcelain', themeLabel(THEME_PORCELAIN), '极简白');

// ── 明暗判据 / 柔影方向（新白主题必须归 light 分支）────────────────────────────
eq('porcelain 归浅色系(isDark=false)', isDarkThemeName(THEME_PORCELAIN), false);
eq('porcelain 是浅色(isLight=true)', isLightThemeName(THEME_PORCELAIN), true);
eq('dark 仍深色系', isDarkThemeName(THEME_DARK), true);
eq('light 是浅色系', isLightThemeName(THEME_LIGHT), true);
eq('未知主题算深色', isDarkThemeName('weird'), true);
// 色板亮度判据（不依赖主题名）
eq('isLightPalette(porcelain) = true', isLightPalette(pp), true);
eq('isLightPalette(light) = true', isLightPalette(l), true);
eq('isLightPalette(dark) = false', isLightPalette(d), false);
// 切换：从浅色系（porcelain）切走必须回深色
eq('切换 porcelain → dark', toggleTheme(THEME_PORCELAIN), THEME_DARK);

// 柔影方向：浅色柔影必须是**正文色极低 alpha**（不再是黑 @24% 的"脏影"）；
// 深色阴影逐字节不动（其他线依赖）。
const eDark = effectsOf(d), eLight = effectsOf(l), ePorc = effectsOf(pp);
eq('深色 elev1 不变(黑@24%)', eDark.elev1, '#3D000000');
eq('浅色 elev1 是正文色低 alpha', eLight.elev1, '#0F0F172A');
eq('porcelain elev1 是正文色低 alpha', ePorc.elev1, '#0F1D1D1F');
eq('浅色 elev 比深色柔和(alpha 更低)', ePorc.elev1 !== eDark.elev1, true);
eq('深色 sheen 仍为白@6%', eDark.sheen, '#0FFFFFFF');
eq('浅色 sheen 换中性（非白）', ePorc.sheen, '#0F000000');

eq('取色板 dark', paletteOf(THEME_DARK).appBg, '#0B0B0E');
eq('取色板 light', paletteOf(THEME_LIGHT).appBg, '#F8FAFC');
eq('未知主题回落深色', paletteOf('weird').appBg, '#0B0B0E');
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
