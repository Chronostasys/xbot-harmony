/**
 * 浅色 / 极简白专项对比度门禁 —— **跨来源配对**（任务5 波 L1，2026-10-11）。
 *
 * ── 为什么单列一个文件（不并进 `theme_contrast.test.ts`）──────────────────────────
 *  `theme_contrast.test.ts` 判的是「**色板角色 × 色板面**」的叉乘（同一个 `Palette` 内部的关系）。
 *  但本仓有一类缺陷是**跨来源配对**：`MarkdownView` 把「**所选 md 主题**的底」
 *  （`core/mdtheme.ets` 的 `inlineBg` / `codeBgOf`）与「**全局色板**的前景」
 *  （`pal.accentText` / `pal.textMuted`）拼在一起。这两者来自**两条独立的明暗轴**
 *  （应用主题 5 套 × md 主题 23 套，各自有 mode）⇒ 色板叉乘**永远查不到**这类缺陷，
 *  而它恰恰是「极简白 + 默认 vscode-dark」这种最常见组合下的**白底深字压深底**。
 *
 * ── 判据（阈值一个都没放宽）────────────────────────────────────────────────────
 *  · 行内码 / 代码文本 = 正文级 4.5:1（13fp 等宽，不是大字）；
 *  · 语言标签 = 最弱说明档 2.0:1（既有 `textMuted` 档，不改）；
 *  · 「复制」= 可点文字 3.0:1（既有 `accentSoft` 档）；
 *  · 结构性不变量：**语言条与代码区必须同明暗**（不许出现"近白语言条压全黑代码块"）。
 *
 * ── 与组件的关系（强绑定）──────────────────────────────────────────────────────
 *  `components/**` **不进离线 harness**（`run.sh` 只把 `core/**` 当纯 TS 编译）⇒
 *  本文件的数值部分复算的是「组件**必须实现**的那条规则」，§E 再读 `MarkdownView.ets`
 *  **真实源码**断言它确实照这条规则接线（沿用 `orb.test.ts` / `live_tail_delivery.test.ts`
 *  的既定先例）。任一侧被改坏 ⇒ 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  Palette, paletteOf, ALL_THEMES, contrastRatio, relativeLuminance, isLightPalette, compositeOver,
} from '../../entry/src/main/ets/core/theme';
import {
  MD_THEMES, CodeTone, codeTone, codeBgOf, codeFgOf, isLightMdTheme,
} from '../../entry/src/main/ets/core/mdtheme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const LIGHT_FAMILY: string[] = ['light', 'porcelain'];
const INLINE_TEXT: number = 4.5;
const STRIP_LABEL: number = 2.0;
const STRIP_ACTION: number = 3.0;
/** 「这个颜色是不是浅色」—— 与色板判据同一口径（相对亮度），但阈值取 0.5 做**明暗分类**。 */
function isLightish(hex: string): boolean {
  return relativeLuminance(hex) > 0.5;
}

// 复算「组件必须实现」的两条规则（与 `components/MarkdownView.ets` 逐条对应，§E 绑定）

/** 行内码文本色：`accentText` 对它自己的底够读就用它，否则退回 md 主题的代码字色。 */
function inlineFgOf(p: Palette, md: string): string {
  const t: CodeTone = codeTone(md);
  return contrastRatio(p.accentText, t.inlineBg) >= INLINE_TEXT ? p.accentText : t.fg;
}
/** 语言条是否必须跟随代码底：应用主题与 md 主题**明暗相反**时为真。 */
function chromeOnTone(p: Palette, md: string): boolean {
  return isLightPalette(p) !== isLightMdTheme(md);
}
function stripBgOf(p: Palette, md: string): string {
  return chromeOnTone(p, md) ? codeBgOf(md, p) : p.surfaceAlt;
}
/** 语言标签**刻意不跟随**：`textMuted` 是中调灰，压浅底/深底都读得出（见组件注释）。 */
function stripLabelOf(p: Palette, md: string): string {
  return p.textMuted;
}
function stripActionOf(p: Palette, md: string): string {
  return chromeOnTone(p, md) ? codeFgOf(md) : p.accentSoft;
}

// ════════════════════════════════════════════════════════════════════════════
// §A 行内码：浅色族 × 23 套 md 主题，文本必须达正文级 4.5
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 行内码（浅色族 × 23 md 主题，正文级 4.5）');

let inlineFail = 0;
let inlineWorst = 99;
let inlineWorstAt = '';
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const th: string = LIGHT_FAMILY[ti];
  const p: Palette = paletteOf(th);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const md: string = MD_THEMES[mi].id;
    const bg: string = codeTone(md).inlineBg;
    const r: number = contrastRatio(inlineFgOf(p, md), bg);
    if (r < INLINE_TEXT) {
      inlineFail++;
      console.log(`  ✗ ${th} · 行内码 ${md} = ${r.toFixed(2)}:1 (< ${INLINE_TEXT}；${inlineFgOf(p, md)} on ${bg})`);
    }
    if (r < inlineWorst) { inlineWorst = r; inlineWorstAt = `${th}·${md}`; }
  }
}
ok(`浅色族行内码全部达标（最差 ${inlineWorstAt} = ${inlineWorst.toFixed(2)}）`, inlineFail === 0);

// ── A2 判别力 / mutation：**天真规则**（永远用 `pal.accentText`）在浅色族下大面积不达标 ──────
// 若有人把组件退回"st.color = pal.accentText"，这一段（连同 §E 的源码断言）会红。
let naiveBad = 0;
let naiveWorst = 99;
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const p: Palette = paletteOf(LIGHT_FAMILY[ti]);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const md: string = MD_THEMES[mi].id;
    const r: number = contrastRatio(p.accentText, codeTone(md).inlineBg);
    if (r < INLINE_TEXT) { naiveBad++; }
    if (r < naiveWorst) { naiveWorst = r; }
  }
}
ok(`天真规则（永远 accentText）在浅色族下确实大面积不达标（${naiveBad} 处，最差 ${naiveWorst.toFixed(2)}）`, naiveBad >= 10);
ok('默认组合（极简白 + vscode-dark）天真规则确实读不出（< 4.5）',
  contrastRatio(paletteOf('porcelain').accentText, codeTone('vscode-dark').inlineBg) < INLINE_TEXT);
ok('默认组合（浅色 + vscode-dark）天真规则确实读不出（< 4.5）',
  contrastRatio(paletteOf('light').accentText, codeTone('vscode-dark').inlineBg) < INLINE_TEXT);

// ── A3 零回归：**同明暗**（深色应用 + 深色 md 主题）下必须仍用 `accentText`（观感不变）──────
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const item = MD_THEMES[mi];
    if (isLightPalette(p) !== (item.mode === 'light')) { continue; }   // 只查同明暗
    eq(`${th} · ${item.id} 同明暗 ⇒ 行内码仍是 accentText（零回归）`, inlineFgOf(p, item.id), p.accentText);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §B 代码块语言条：**必须与代码区同明暗** + 标签/复制可读
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 代码块语言条（底随代码区 + 标签 2.0 / 复制 3.0）');

let stripClassFail = 0;
let stripLabelFail = 0;
let stripActionFail = 0;
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const md: string = MD_THEMES[mi].id;
    const strip: string = stripBgOf(p, md);
    const codeBg: string = codeBgOf(md, p);
    if (isLightish(strip) !== isLightish(codeBg)) {
      stripClassFail++;
      console.log(`  ✗ ${th} · ${md} 语言条与代码区**明暗错位**（条 ${strip} vs 代码 ${codeBg}）`);
    }
    const lr: number = contrastRatio(stripLabelOf(p, md), strip);
    if (lr < STRIP_LABEL) { stripLabelFail++; }
    const ar: number = contrastRatio(stripActionOf(p, md), strip);
    if (ar < STRIP_ACTION) { stripActionFail++; }
  }
}
ok(`语言条与代码区恒同明暗（0 处错位）`, stripClassFail === 0);
ok(`语言标签恒达最弱档 2.0（0 处不达标）`, stripLabelFail === 0);
ok(`「复制」恒达可点档 3.0（0 处不达标）`, stripActionFail === 0);

// ── B2 判别力：旧行为（写死 `pal().surfaceAlt`）在浅色族 + 深色 md 主题下会明暗错位 ──────────
let legacyBad = 0;
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const p: Palette = paletteOf(LIGHT_FAMILY[ti]);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const md: string = MD_THEMES[mi].id;
    if (isLightish(p.surfaceAlt) !== isLightish(codeBgOf(md, p))) { legacyBad++; }
  }
}
ok(`旧行为（写死 surfaceAlt）在浅色族下确实会明暗错位（${legacyBad} 处）`, legacyBad >= 10);
ok('默认组合（极简白 + vscode-dark）旧行为确实"近白条压黑块"',
  isLightish(paletteOf('porcelain').surfaceAlt) !== isLightish(codeBgOf('vscode-dark', paletteOf('porcelain'))));

// ════════════════════════════════════════════════════════════════════════════
// §C 用户气泡「面」：`textPrimary` 压在 `accent @15%`（唯一底色）
//   web 权威 `UserMessage.tsx:272` `bg-accent/15 text-text-primary`。浅色族必须达正文级 4.5。
//   ⚠️ 2026-10-11 修正：用户气泡**曾是**不透明 `accent→accentSoft` 渐变 + `onAccent`
//   （已删，见 `core/bubbleview.ets`）⇒ 本块改为断言**真实面**。原两条 `onAccent` 断言
//   **保留但重贴标签**：它们守护的是**登录主按钮**的渐变（`theme_contrast.test.ts:817`），
//   与气泡无关 —— 删掉会丢覆盖，故只改归属、不删。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 用户气泡面（浅色族：textPrimary / accent@15%）');
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const th: string = LIGHT_FAMILY[ti];
  const p: Palette = paletteOf(th);
  const bubbleBg: string = compositeOver(withAlpha(p.accent, 0.15), p.appBg);
  ok(`${th} 气泡 textPrimary / accent@15% 底达正文级 4.5（${contrastRatio(p.textPrimary, bubbleBg).toFixed(2)}）`,
    contrastRatio(p.textPrimary, bubbleBg) >= INLINE_TEXT);
  // 主按钮渐变（accent → accentSoft 上压 onAccent）——不是气泡，但同属浅色族必须可达
  ok(`${th} 主按钮渐变起点 onAccent/accent 达标（${contrastRatio(p.onAccent, p.accent).toFixed(2)}）`,
    contrastRatio(p.onAccent, p.accent) >= INLINE_TEXT);
  ok(`${th} 主按钮渐变终点 onAccent/accentSoft 达标（${contrastRatio(p.onAccent, p.accentSoft).toFixed(2)}）`,
    contrastRatio(p.onAccent, p.accentSoft) >= INLINE_TEXT);
}

// ════════════════════════════════════════════════════════════════════════════
// §D 半透明叠层：浅色下的"加亮一档"约定 ⇒ 用 `isLightPalette` 分叉的组件必须在白底上仍可辨
//   判据：叠层（accent@α 压在卡面上）必须**真的与卡面可分**（对比度 > 1.0 且不与卡面恒等）。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 半透明叠层（浅色族：与卡面可分）');
function withAlpha(hex: string, alpha: number): string {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const a: number = Math.round(alpha * 255);
  const d: string = '0123456789ABCDEF';
  return `#${d.charAt(Math.floor(a / 16))}${d.charAt(a % 16)}${h.slice(0, 6).toUpperCase()}`;
}
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const th: string = LIGHT_FAMILY[ti];
  const p: Palette = paletteOf(th);
  const tint15: string = compositeOver(withAlpha(p.accent, 0.15), p.surface);
  const tint18: string = compositeOver(withAlpha(p.accent, 0.18), compositeOver(withAlpha(p.accent, 0.14), p.surface));
  ok(`${th} GoalBanner 徽标底 accent@15% 与卡面可分（${contrastRatio(tint15, p.surface).toFixed(4)}）`,
    contrastRatio(tint15, p.surface) > 1.05 && tint15 !== p.surface);
  ok(`${th} TodoPanel goal 徽标底 accent@18% 与行底可分（${contrastRatio(tint18, p.surface).toFixed(4)}）`,
    contrastRatio(tint18, p.surface) > 1.05 && tint18 !== p.surface);
  // 徽标文字（accent 压在 tint 上）必须达可点档 3.0
  ok(`${th} GoalBanner 徽标文字 accent/tint 达 3.0（${contrastRatio(p.accent, tint15).toFixed(2)}）`,
    contrastRatio(p.accent, tint15) >= STRIP_ACTION);
}

// ════════════════════════════════════════════════════════════════════════════
// §E 组件源码契约：把上面的"规则复算"绑定到 `MarkdownView.ets` 的**真实实现**
//   （`components/**` 不进离线 harness ⇒ 读源码做形态断言，沿用既有先例）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E MarkdownView 源码契约');
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const mdViewSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MarkdownView.ets'), 'utf-8');

ok('行内码文本色走 `inlineCodeFg(`（不再无条件 accentText）', mdViewSrc.indexOf('st.color = inlineCodeFg(') >= 0);
ok('`inlineCodeFg` 存在且带 4.5 守卫', mdViewSrc.indexOf('function inlineCodeFg(') >= 0
  && mdViewSrc.indexOf('INLINE_CODE_MIN_RATIO: number = 4.5') >= 0);
ok('`inlineCodeFg` 的回退是 md 主题代码字色 `tone.fg`', mdViewSrc.indexOf('return tone.fg;') >= 0);
ok('行内码**不再**直接写 `st.color = pal.accentText`', mdViewSrc.indexOf('st.color = pal.accentText') < 0);

ok('语言条底走 `codeStripBg()`（不再写死 surfaceAlt）', mdViewSrc.indexOf('.backgroundColor(this.codeStripBg())') >= 0);
ok('`codeStripBg` 在"明暗相反"时用 `codeBgOf`（与代码区同底）',
  mdViewSrc.indexOf('return this.codeChromeOnTone() ? codeBgOf(this.mdTheme, this.pal()) : this.pal().surfaceAlt;') >= 0);
ok('语言标签**保持** `textMuted`（中调灰，压浅/深底都可读；源码形态不变）',
  mdViewSrc.indexOf("          .fontSize(11)\n          .fontFamily('monospace')\n          .fontColor(this.pal().textMuted)") >= 0);
ok('「复制」走 `codeStripAction()`', mdViewSrc.indexOf('.fontColor(this.codeStripAction())') >= 0);
ok('`codeChromeOnTone` 用 `isLightPalette` + `isLightMdTheme`（按亮度，不按主题名）',
  mdViewSrc.indexOf('return isLightPalette(this.pal()) !== isLightMdTheme(this.mdTheme);') >= 0);
ok('MarkdownView 未按主题名硬判（无 `theme === \'porcelain\'` 之类）',
  mdViewSrc.indexOf("=== 'porcelain'") < 0 && mdViewSrc.indexOf("=== 'light'") < 0);

// 摘要（供报告复核）
let inlineNaiveMin = 99, inlineFixMin = 99;
for (let ti = 0; ti < LIGHT_FAMILY.length; ti++) {
  const p: Palette = paletteOf(LIGHT_FAMILY[ti]);
  for (let mi = 0; mi < MD_THEMES.length; mi++) {
    const md: string = MD_THEMES[mi].id;
    inlineNaiveMin = Math.min(inlineNaiveMin, contrastRatio(p.accentText, codeTone(md).inlineBg));
    inlineFixMin = Math.min(inlineFixMin, contrastRatio(inlineFgOf(p, md), codeTone(md).inlineBg));
  }
}
console.log('\n▼ 摘要（浅色族 × 23 md 主题）');
console.log(`   行内码 天真规则最差 = ${inlineNaiveMin.toFixed(2)}  ⇒ 修复后最差 = ${inlineFixMin.toFixed(2)}（阈值 ${INLINE_TEXT}）`);
console.log(`   语言条明暗错位 旧 = ${legacyBad} 处 ⇒ 新 = ${stripClassFail} 处`);

if (fail > 0) {
  console.log(`\n  theme_contrast_light: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  theme_contrast_light: ${pass} passed, 0 failed`);
process.exit(0);
