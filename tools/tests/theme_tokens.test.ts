/**
 * 设计 token 层测试（多主题色板穷尽性 + 霓虹主题色值 + 尺寸/字阶/动效 token）。
 *
 * 三条判据：
 *  (a) 新旧主题（dark/light/aurora/nebula）**都**完整覆盖全部角色（穷尽性不变式）；
 *  (b) aurora/nebula 的关键色值与 `.research/design-system.md` 表**逐值相等**；
 *  (c) tokens 的圆角/间距/字阶/动效值存在、为数字、单调合理。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };

import {
  darkPalette, lightPalette, auroraPalette, nebulaPalette, paletteOf, paletteComplete, paletteValues,
  effectsOf, effectsComplete, normalizeTheme, themeLabel,
  THEME_DARK, THEME_LIGHT, THEME_AURORA, THEME_NEBULA, ALL_THEMES,
} from '../../entry/src/main/ets/core/theme';

import {
  R_SM, R_MD, R_LG, R_XL, R_2XL, RADII,
  SP_1, SP_2, SP_3, SP_4, SP_5, SP_6, SP_7, SP_8, SPACING,
  FS_CAPTION, FS_BODY, FS_TITLE, FS_HERO, FONT_SIZES,
  D_FAST, D_BASE, D_SLOW, DURATIONS,
  EASE_SPRING_CSS, EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y,
  EASE_SPRING_RESPONSE, EASE_SPRING_DAMPING, EASE_SPRING_OVERLAP,
} from '../../entry/src/main/ets/core/tokens';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const D = darkPalette();
const L = lightPalette();
const A = auroraPalette();
const N = nebulaPalette();

// ── (a) 穷尽性：四套主题每个角色都有值；枚举表覆盖全部字段 ──────────────────
eq('dark 完整', paletteComplete(D), true);
eq('light 完整', paletteComplete(L), true);
eq('aurora 完整', paletteComplete(A), true);
eq('nebula 完整', paletteComplete(N), true);
eq('dark 枚举表=字段数', paletteValues(D).length, Object.keys(D).length);
eq('light 枚举表=字段数', paletteValues(L).length, Object.keys(L).length);
eq('aurora 枚举表=字段数', paletteValues(A).length, Object.keys(A).length);
eq('nebula 枚举表=字段数', paletteValues(N).length, Object.keys(N).length);
eq('四套字段数一致', Object.keys(D).length, Object.keys(A).length);
eq('四套字段数一致(2)', Object.keys(L).length, Object.keys(N).length);
ok('字段数=24（23 角色 + accentHover）', Object.keys(D).length === 24);
ok('ALL_THEMES 覆盖四套', ALL_THEMES.length === 4);

// ── (b) aurora / nebula 关键色值 vs 设计基线表（逐值相等；源表为小写 hex） ──
// aurora（xbot-aurora）
eq('aurora bg-primary', A.appBg, '#070c16');
eq('aurora bg-secondary', A.surface, '#0b1424');
eq('aurora bg-tertiary', A.surfaceAlt, '#111d31');
eq('aurora border', A.border, '#1d2f47');
eq('aurora border-strong', A.borderStrong, '#2b4368');
eq('aurora text-primary', A.textPrimary, '#d7e6f5');
eq('aurora text-secondary', A.textSecondary, '#9fb6cc');
eq('aurora text-muted', A.textMuted, '#6b8399');
eq('aurora md-link', A.accentSoft, '#63e6c8');
eq('aurora accent', A.accent, '#34d3b4');
eq('aurora accent-hover', A.accentHover, '#45e2c4');
eq('aurora accent-fg', A.onAccent, '#04150f');
// nebula（xbot-nebula）
eq('nebula bg-primary', N.appBg, '#08060f');
eq('nebula bg-secondary', N.surface, '#0f0a1e');
eq('nebula bg-tertiary', N.surfaceAlt, '#171030');
eq('nebula border', N.border, '#2c1f4d');
eq('nebula border-strong', N.borderStrong, '#3f2d6b');
eq('nebula text-primary', N.textPrimary, '#ece4ff');
eq('nebula text-secondary', N.textSecondary, '#b9a8d9');
eq('nebula text-muted', N.textMuted, '#8577ad');
eq('nebula md-link', N.accentSoft, '#d68bff');
eq('nebula accent', N.accent, '#a78bfa');
eq('nebula accent-hover', N.accentHover, '#b9a1ff');
eq('nebula accent-fg', N.onAccent, '#150a2b');

// 主题派发 / 命名
eq('paletteOf aurora', paletteOf(THEME_AURORA).accent, '#34d3b4');
eq('paletteOf nebula', paletteOf(THEME_NEBULA).accent, '#a78bfa');
eq('normalizeTheme aurora', normalizeTheme(THEME_AURORA), THEME_AURORA);
eq('normalizeTheme nebula', normalizeTheme(THEME_NEBULA), THEME_NEBULA);
eq('normalizeTheme 未知仍回落 dark', normalizeTheme('weird'), THEME_DARK);
eq('themeLabel aurora', themeLabel(THEME_AURORA), '极光');
eq('themeLabel nebula', themeLabel(THEME_NEBULA), '星云');

// ── 视觉手段 token（Effects，派生自色板）────────────────────────────────────
const eD = effectsOf(D), eA = effectsOf(A), eN = effectsOf(N), eL = effectsOf(L);
ok('effects 完整(dark)', effectsComplete(eD));
ok('effects 四主题均完整', effectsComplete(eA) && effectsComplete(eN) && effectsComplete(eL));
eq('effects 字段数', Object.keys(eD).length, 11);
ok('glassBlur 为正数', eD.glassBlur > 0);
ok('glow 随主题 accent 变（aurora≠dark）', eD.glow !== eA.glow);
ok('gradientFrom = accent', eD.gradientFrom === D.accent);
ok('玻璃底带 alpha（#AARRGGBB）', eD.glassBg.length === 9 && eD.glassBg.charAt(0) === '#');

// ── (c) 尺寸 / 字阶 / 动效 token ────────────────────────────────────────────
function allNumber(xs: number[]): boolean {
  for (let i = 0; i < xs.length; i++) {
    if (typeof xs[i] !== 'number' || xs[i] !== xs[i]) { return false; }
  }
  return true;
}
function strictlyIncreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) {
    if (!(xs[i] > xs[i - 1])) { return false; }
  }
  return true;
}
function multiplesOf(xs: number[], base: number): boolean {
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] % base !== 0) { return false; }
  }
  return true;
}

ok('圆角均为数字', allNumber(RADII));
ok('圆角严格递增', strictlyIncreasing(RADII));
eq('圆角阶梯值', [R_SM, R_MD, R_LG, R_XL, R_2XL], [4, 6, 8, 12, 16]);

ok('间距均为数字', allNumber(SPACING));
ok('间距严格递增', strictlyIncreasing(SPACING));
ok('间距均为 4 的倍数', multiplesOf(SPACING, 4));
eq('间距阶梯值', [SP_1, SP_2, SP_3, SP_4, SP_5, SP_6, SP_7, SP_8], [4, 8, 12, 16, 20, 24, 28, 32]);

ok('字阶均为数字', allNumber(FONT_SIZES));
ok('字阶严格递增', strictlyIncreasing(FONT_SIZES));
eq('字阶取值', [FS_CAPTION, FS_BODY, FS_TITLE, FS_HERO], [12, 14, 16, 21]);

ok('时长均为数字', allNumber(DURATIONS));
ok('时长严格递增', strictlyIncreasing(DURATIONS));
eq('时长取值', [D_FAST, D_BASE, D_SLOW], [180, 240, 320]);

eq('spring 缓动 = web 值', EASE_SPRING_CSS, 'cubic-bezier(0.34, 1.56, 0.64, 1)');
eq('spring 控制点', [EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y], [0.34, 1.56, 0.64, 1]);
// springMotion 建议参数（ArkUI 等价写法；SDK @ohos.curves.d.ts:371 已确认 API 存在）
ok('springMotion response 为正数', typeof EASE_SPRING_RESPONSE === 'number' && EASE_SPRING_RESPONSE > 0);
ok('springMotion 阻尼比 <1（有回弹）', EASE_SPRING_DAMPING > 0 && EASE_SPRING_DAMPING < 1);
ok('springMotion overlap ≥0', EASE_SPRING_OVERLAP >= 0);

if (fail > 0) { console.log(`  theme_tokens: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  theme_tokens: ${pass} passed, 0 failed`);
process.exit(0);
