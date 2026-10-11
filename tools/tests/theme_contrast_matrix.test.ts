/**
 * 文字可读性**矩阵**判据（2026-10-11）—— 把口径从「role vs 画布」扩到「role vs **实际合成底**」。
 *
 * 背景：用户投诉**白/浅色主题下消息正文对底只有 ≈1.2:1**。存量 `theme_contrast.test.ts`
 * （617 断言）判的是 `text* × {appBg,surface,surfaceAlt,surfaceHi,glassBg, sunken}` ——
 * 它**没有**覆盖下面这些**生产里真实存在**的底：
 *   · `glow` / `glowSoft` **合成到画布后**的中心色（辉光/光晕区域，`Index.ets` 顶部辉光、
 *     空态星形圆光、CTA 光晕、发送键光晕 —— 这些面**未必**还是纯 `appBg`）；
 *   · `elev2` / `elev3`（**阴影 token 当底用**，`ToolPopover` 一族）；
 *   · `sheen` 扫光扫过后的底；
 *   · `gradientFrom/gradientTo`（主按钮/徽标渐变端，用户真看到的是**渐变**不是纯色）；
 *   · **强调色叠加后**（`withAccent`）的 `accent` 家族 vs 新底 —— 用户改了强调色就是另一套底。
 *
 * ⛔ 阈值一个都不放宽：正文 `T_BODY=4.5` / 次要 `T_SECOND=3.0` / 元信息 `T_MUTED=2.0`（与存量同值）。
 * ⛔ 零扫描判红：面表为空、或组合数低于下限、或某主题没扫到 ⇒ **红**（白绿防线）。
 * ★ mutation 自证（两处）：
 *   ① 把 `ROLES` 里的 `textPrimary` 改成 `textMuted` 档 ⇒ `textPrimary(4.5)` 那组全红；
 *   ② 把任一浅色主题的 `surface` 改回纯白（使某正文档跌破 4.5）⇒ 红。
 *   （见交付回报里的原文。）
 *
 * ⚠️ 本文件**只判不改**：真不达标的组合落在 `core/theme.ets`（归 brand-impl）⇒ 出 spec，不在此修。
 */
export {};

declare function require(m: string): unknown;
declare const process: { exit: (c: number) => void };

import {
  ALL_THEMES, Effects, Palette, Surfaces, compositeOver, contrastRatio, effectsOf,
  isDarkThemeName, paletteOf, surfacesOf, withAccent,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail.length > 0 ? `\n      ${detail}` : ''}`); }
}

const T_BODY: number = 4.5;
const T_SECOND: number = 3.0;
const T_MUTED: number = 2.0;

interface Role { readonly fg: string; readonly tier: number; }
const ROLES: Role[] = [
  { fg: 'textPrimary', tier: T_BODY },
  { fg: 'textSecondary', tier: T_SECOND },
  { fg: 'textMuted', tier: T_MUTED },
];

function roleHex(p: Palette, name: string): string {
  const m: Record<string, string> = p as unknown as Record<string, string>;
  return m[name];
}

/**
 * **实际合成底**（关键：先合成成不透明色，再算对比度）。
 * ⛔ 这里每一行都必须有生产落点（见 `where`），不造"没人用的对"。
 */
interface Face { readonly name: string; readonly where: string; readonly decorative: boolean; }
/**
 * **实际合成底**（关键：先合成成不透明色，再算对比度）。
 *
 * ⚠️ `decorative` = **装饰底**（辉光/阴影/扫光）：它们是**内容背后的光晕/柔影**，
 *    语义上**不承载元信息文字**（文字坐在 `surface` 上，光晕只是它后面的一层）
 *    ⇒ 主 agent 2026-10-11 裁决：**装饰底不进 `textMuted`(2.0) 的可读性面表**
 *    （实测它们把 `textMuted` 压到 1.61–1.99，属"判了没有生产落点的对"）。
 *    ⛔ 但 `textPrimary`(4.5)/`textSecondary`(3.0) 仍**照判**（若有人在光晕上写字，必须被抓住）。
 */
const FACES: Face[] = [
  { name: 'appBg', where: '画布', decorative: false },
  { name: 'surface', where: '卡片/面板', decorative: false },
  { name: 'surfaceAlt', where: '次级面/输入框', decorative: false },
  { name: 'surfaceHi', where: '高亮面/选中 chip', decorative: false },
  { name: 'glass/appBg', where: '玻璃浮层压在画布上（Effects.glassBg 合成）', decorative: false },
  { name: 'glass/surface', where: '玻璃浮层压在卡片上', decorative: false },
  { name: 'glow/appBg', where: '辉光中心压在画布上（Index 顶部辉光 / 空态星形圆光）', decorative: true },
  { name: 'glowSoft/appBg', where: '弱辉光中心压在画布上（620² 顶部辉光）', decorative: true },
  { name: 'glow/surface', where: '辉光压在卡片上（CTA/发送键光晕）', decorative: true },
  { name: 'glowSoft/surface', where: '弱辉光压在卡片上', decorative: true },
  { name: 'elev2/appBg', where: '阴影 token 当底（ToolPopover 一族）', decorative: true },
  { name: 'elev3/appBg', where: '最重阴影 token 当底', decorative: true },
  { name: 'sheen/surface', where: '扫光扫过后的卡片面', decorative: true },
  { name: 'sunken', where: '代码块 / 终端块 / diff 行底（surfacesOf.sunken）', decorative: false },
];

/** 一套主题的合成底表。 */
function facesOf(p: Palette): Record<string, string> {
  const e: Effects = effectsOf(p);
  const s: Surfaces = surfacesOf(p);
  const m: Record<string, string> = {};
  m['appBg'] = p.appBg;
  m['surface'] = p.surface;
  m['surfaceAlt'] = p.surfaceAlt;
  m['surfaceHi'] = p.surfaceHi;
  m['glass/appBg'] = compositeOver(e.glassBg, p.appBg);
  m['glass/surface'] = compositeOver(e.glassBg, p.surface);
  m['glow/appBg'] = compositeOver(e.glow, p.appBg);
  m['glowSoft/appBg'] = compositeOver(e.glowSoft, p.appBg);
  m['glow/surface'] = compositeOver(e.glow, p.surface);
  m['glowSoft/surface'] = compositeOver(e.glowSoft, p.surface);
  m['elev2/appBg'] = compositeOver(e.elev2, p.appBg);
  m['elev3/appBg'] = compositeOver(e.elev3, p.appBg);
  m['sheen/surface'] = compositeOver(e.sheen, p.surface);
  m['sunken'] = s.sunken;
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
// §1 零扫描防线（白绿）：面表 / 角色表 / 主题表都要"非空且够用"
// ════════════════════════════════════════════════════════════════════════════
eq('面表非空且 ≥14 个真实合成底', FACES.length >= 14, true);
eq('角色表 = 正文/次要/元信息 三档', ROLES.length, 3);
eq('主题表非空', ALL_THEMES.length >= 5, true);
{
  let empty = 0;
  for (let ti = 0; ti < ALL_THEMES.length; ti++) {
    const f: Record<string, string> = facesOf(paletteOf(ALL_THEMES[ti]));
    for (let fi = 0; fi < FACES.length; fi++) {
      const v: string | undefined = f[FACES[fi].name];
      if (v === undefined || v.length === 0 || v === 'undefined') { empty++; }
    }
  }
  eq('零扫描防线：每个主题 × 每个底都取到了色值', empty, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §2 矩阵判定：role × 合成底（阈值同存量，⛔ 不放宽）
// ════════════════════════════════════════════════════════════════════════════
let judged = 0;
let worstName: string = '';
let worstRatio: number = 999;
const badMatrix: string[] = [];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const faces: Record<string, string> = facesOf(p);
  for (let ri = 0; ri < ROLES.length; ri++) {
    for (let fi = 0; fi < FACES.length; fi++) {
      const fgHex: string = roleHex(p, ROLES[ri].fg);
      const bgHex: string = faces[FACES[fi].name];
      const r: number = contrastRatio(fgHex, bgHex);
      judged++;
      if (r < worstRatio) { worstRatio = r; worstName = `${theme} ${ROLES[ri].fg} on ${FACES[fi].name}`; }
      // 裁决（2026-10-11）：装饰底（光晕/阴影/扫光）不承载元信息 ⇒ 不与 `textMuted` 组对判定
      //（若真有人在光晕上写元信息，那是调用点错误 ⇒ 由生产接线自证（§D 类）去抓，不在这里放宽）
      if (FACES[fi].decorative && ROLES[ri].fg === 'textMuted') { continue; }
      if (r < ROLES[ri].tier) {
        badMatrix.push(`${theme}|${ROLES[ri].fg}|${FACES[fi].name}|${r.toFixed(4)}`);
      }
    }
  }
}
ok(`矩阵规模足够（判了 ${judged} 组，下限 ${ALL_THEMES.length * ROLES.length * FACES.length}）`,
  judged === ALL_THEMES.length * ROLES.length * FACES.length);
console.log(`  · 矩阵 ${judged} 组，最差 = ${worstName} @ ${worstRatio.toFixed(4)}`);

// ✅ 裁决后本组**零台账**：装饰底不再与 `textMuted` 组对（见 FACES 的 `decorative` 注释）。
// 历史：收窄前这里有 8 条 `textMuted`（元信息，阈值 2.0）压在
//    `glow*` / `elev3` 合成底上（1.61–1.99）。判断：这些底是**装饰性光晕/阴影**，
//    其**中心**本就不承载元信息正文（光晕在内容**背后**，文字坐在 `surface` 上）
//    ⇒ 属"**该收窄面表**"而非真缺陷 —— 但按纪律**先记账、由主 agent 裁决**（⛔ 不放宽阈值）。
//    另：`textPrimary`（正文，4.5）/`textSecondary`（3.0）在本矩阵下**全部达标**（含 light/porcelain）
//    ⇒ 用户报的"正文 ≈1.2:1"**不是**「role vs 合成底」这条路（详见交付回报）。
const KNOWN_BAD_MATRIX_COUNT: number = 0;
console.log(`  · role×合成底 台账（${badMatrix.length} 条，全是 textMuted×装饰底）:`);
for (let i = 0; i < badMatrix.length; i++) { console.log(`      ${badMatrix[i]}`); }
eq('台账计数 = 实测不达标数（只准删不准加；修好/收窄面表 ⇒ 计数变 ⇒ 红）',
  badMatrix.length, KNOWN_BAD_MATRIX_COUNT);

// ════════════════════════════════════════════════════════════════════════════
// §3 渐变端 + 强调色叠加后的底（用户改了强调色 ⇒ 是另一套底）
// ════════════════════════════════════════════════════════════════════════════
// ① 渐变端（主按钮/徽标**真实底色**是渐变，不是纯 accent）
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const e: Effects = effectsOf(p);
  eq(`${theme} · onAccent 压 gradientFrom >= 4.5`, contrastRatio(p.onAccent, e.gradientFrom) >= T_BODY, true);
  eq(`${theme} · onAccent 压 gradientTo >= 4.5`, contrastRatio(p.onAccent, e.gradientTo) >= T_BODY, true);
}
// ② 强调色叠加（6 预设 × 5 主题）：叠加后 accent 家族 vs 文字角色仍要达标
//
// ⚠️ **本组实测有真实不达标**（2026-10-11）：`onAccent = contrastForeground(accent)` 用的是
//    BT.601 亮度 >150 的**粗阈值**（`core/theme.ets:contrastForeground`），它**不保证** AA 4.5
//    ⇒ 部分 (主题 × 预设) 组合只有 3.5–3.9。**根因在 `core/theme.ets`（归 brand-impl）⇒ 只出 spec**。
//    这里按仓内既有的「台账」纪律处理：**只准删不准加**（修好一条 ⇒ 计数变 ⇒ 红，逼你同步删台账；
//    新增一条 ⇒ 计数变 ⇒ 红，逼你上报）。⛔ 不放宽阈值、不删断言。
// 【已修 2026-10-11】brand-impl 按裁决把 contrastForeground 由 BT.601 lum>150 二值改为
// 按 WCAG 相对亮度在黑白两候选中取对比度更高者（core/theme.ets:173-186）=> 15 组全部达标，台账归零。
// 断言保留"计数变化即红"：若改回粗阈值、或新增 accent 预设不保 AA => 计数 > 0 => 立即红。
const KNOWN_BAD_ONACCENT_COUNT: number = 0;
const badPairs: string[] = [];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const base: Palette = paletteOf(theme);
  const isDark: boolean = isDarkThemeName(theme);
  for (let ai = 0; ai < 6; ai++) {
    const hex: string = ['#3388BB', '#2563EB', '#7C3AED', '#DC2626', '#059669', '#EA580C'][ai];
    const p: Palette = withAccent(base, hex, isDark);
    const onAccent: number = contrastRatio(p.onAccent, p.accent);
    if (onAccent < T_BODY) { badPairs.push(`${theme}|${hex}|${onAccent.toFixed(4)}`); }
    const softOnCanvas: number = contrastRatio(p.accentSoft, base.appBg);
    ok(`${theme} + accent ${hex} · accentSoft 压画布 >= 3.0`, softOnCanvas >= T_SECOND,
      `got ${softOnCanvas.toFixed(4)}`);
  }
}
console.log(`  · onAccent×accent 台账（${badPairs.length} 条，全是 contrastForeground 粗阈值所致）:`);
for (let i = 0; i < badPairs.length; i++) { console.log(`      ${badPairs[i]}`); }
eq('台账计数 = 实测不达标数（只准删不准加；修好 ⇒ 计数变 ⇒ 红）',
  badPairs.length, KNOWN_BAD_ONACCENT_COUNT);

if (fail > 0) { console.log(`  ✗ theme_contrast_matrix: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ theme_contrast_matrix: ${pass} passed, 0 failed`);
process.exit(0);
