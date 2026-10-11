/**
 * E2：**浅色系不出辉光** 的契约（`docs/DESIGN-SYSTEM.md` 的 effects 表判据）。
 *
 * 判据（唯一口径）：「辉光被读成**光**」须同时满足
 *   ① **中心对底 ≥ 1.5:1**（合成后）；② **含色彩语义（chroma > 0）**。
 * 实测（改前）：浅色 `glow = textPrimary@16%` 合成 `rgb(212,212,213)` ⇒ 对底 **1.383:1(porcelain)/1.394(light)**、
 * **chroma = 0** ⇒ 两条都不满足 ⇒ 不是"光"，是**脏灰团**（深色 = `accent` 紫 **1.771**、chroma > 0 ✅）。
 * 备选否掉：浅色改 `accent@16%` → 1.238、`@10%` → 1.14，须 ≥24% 才 1.5 ⇒ 变"脏彩"。
 * ⇒ **浅色一律不出**（`effectsOf().glow = p.transparent`）；层次由发丝/白度差/柔影（§13）负责。
 *
 * mutation 自证（必红）：把浅色臂 `e.glow = p.transparent` 改回 `alphaHex(p.textPrimary, 0.16)`
 *   ⇒ ★①（浅色必须"不出"，否则判据不过）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, isLightPalette, ALL_THEMES, contrastRatio } from '../../entry/src/main/ets/core/theme';
import { sweepBandOf, SweepBand } from '../../entry/src/main/ets/core/sweep';
import { orbRingStrokeOf, inflightHaloOf, hairlineOf } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// ── 判别力：判据本身能判"脏灰团"（用改前的旧值自证）────────────────────────────────
const GLOW_MIN_RATIO: number = 1.5;

function channel(hex: string): number[] {
  const h: string = hex.length === 9 ? hex.slice(3) : hex.slice(1);  // 容忍 #AARRGGBB
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/**
 * 是否含**色彩语义**（chroma）：按**饱和度** `(max-min)/max ≥ CHROMA_MIN` 判。
 * ⛔ 不能用严格 `r==g==b`：浅色旧辉光合成 `rgb(212,212,213)` 只有 **1/255** 的蓝差
 *    （视觉上是中性灰），严格判会误判成"有色彩"。
 */
const CHROMA_MIN: number = 0.03;   // ≥3% 饱和度才算"有色彩语义"（≈ JND 之上）
function hasChroma(hex: string): boolean {
  const c = channel(hex);
  const max = Math.max(c[0], c[1], c[2]);
  return max > 0 && (max - Math.min(c[0], c[1], c[2])) / max >= CHROMA_MIN;
}
function alphaOf(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) / 255 : 1;
}
/** 半透明前景合成到不透明底上（返回 #RRGGBB）。 */
function compositeOver(fg: string, bg: string): string {
  const a = alphaOf(fg), f = channel(fg), b = channel(bg);
  const m = [0, 1, 2].map((i) => Math.round(a * f[i] + (1 - a) * b[i]));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}
/** 判据：辉光"能被读成光"（透明 ⇒ 视为"不出" ⇒ 返回 true，因为不出的分支另有约束）。 */
function glowReadsAsLight(glow: string, bg: string): boolean {
  if (alphaOf(glow) === 0) { return true; }   // 不出辉光 ⇒ 不适用（不是"脏灰团"）
  const c: string = compositeOver(glow, bg);
  return contrastRatio(c, bg) >= GLOW_MIN_RATIO && hasChroma(c);
}

{
  // 改前旧值（浅色 textPrimary@16% 合成）⇒ 判据必须判它**不合格**（判别力自证）
  const oldGlow = '#291D1D1F';   // textPrimary@16%
  ok('判别力：旧浅色辉光（textPrimary@16% 合成 #D4D4D5）判为**不是光**',
    !glowReadsAsLight(oldGlow, '#FFFFFF'));
  ok('  · 理由①：对比 < 1.5', contrastRatio(compositeOver(oldGlow, '#FFFFFF'), '#FFFFFF') < GLOW_MIN_RATIO);
  ok('  · 理由②：**合成后**零 chroma（中性灰 rgb(212,212,213)）', !hasChroma(compositeOver(oldGlow, '#FFFFFF')));
  ok('判别力：深色 accent@45% 判为**是光**（紫、1.771）', glowReadsAsLight('#737C5CFF', '#0B0B0E'));
}

// ── 全主题：浅色必须"不出"；深色必须"是光" ────────────────────────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const g: string = effectsOf(p).glow;
    if (isLightPalette(p)) {
      ok(`${t}: 浅色 ⇒ glow = 透明（**不出辉光**，E2）`, g === p.transparent);
      ok(`  · 若一旦非透明，判据必须它能被读成光（否则就是脏灰团）`,
        g === p.transparent || glowReadsAsLight(g, p.appBg));
    } else {
      ok(`${t}: 深色 ⇒ glow 是光（≥1.5:1 且有 chroma）`, glowReadsAsLight(g, p.appBg));
    }
  }
}

// ── 源码形态：口径落在 theme.ets；深色臂逐字节不变 ───────────────────────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/theme.ets'))) { repo = cand; break; }
  }
  ok('探测到仓库根', repo.length > 0);
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8');
    ok("theme.ets: 浅色臂 e.glow = p.transparent（E2）", src.indexOf('e.glow = p.transparent;') >= 0);
    ok('theme.ets: 深色臂 e.glow = accent@45%（**逐字节不变**）', src.indexOf('e.glow = alphaHex(p.accent, 0.45);') >= 0);
    ok('theme.ets: glowSoft 未动（V6 冻结：@10%）', src.indexOf('e.glowSoft = alphaHex(p.textPrimary, 0.10);') >= 0);
  }
}

// ── E2 的**下游一致性**：浅色 `glow = 透明` ⇒ 任何把它当"**色带主体**"的消费者都会退化成
//    "**隐形/反序**"。本节把「正确接线的消费者」**钉强断言**，把「已退化的消费者」登记成台账。
// 实测缺陷（2026-10-11，**已在本轮 G2 修复**）：`core/sweep.ets` 浅色 `core = effectsOf().glow`（**恒透明**）、
//    `fade = effectsOf().glowSoft`（可见）⇒ 浅色扫光带**核心透明、两端有色**（**反序退化**）。修法 = 浅色
//    `core` 改走**可见中性档** `effectsOf().elev3`（`textPrimary@16%`，= E2 前 `glow` **同值**，且
//    `@16%` > fade `@10%` ⇒ **中心强于两端**）⇒ 真值/形态断言落在 `tools/tests/sweep.test.ts`。
// ⇒ 台账随之**收缩为空**（⛔ 只许缩短）。
const KNOWN_GLOW_CONSUMER_DEFECTS: string[] = [];
{
  // ① 正确接线的消费者：浅色下**不得**是透明（否则等于通道消失）
  const porc = paletteOf('porcelain');
  const lite = paletteOf('light');
  ok('下游·orbRingStrokeOf：浅色 = 结构性发丝（**非透明**，真的看得见）',
    orbRingStrokeOf(porc) === hairlineOf(porc) && orbRingStrokeOf(porc) !== porc.transparent);
  ok('下游·inflightHaloOf：浅色 = elev2 柔影（**非透明**）',
    inflightHaloOf(porc) !== porc.transparent && inflightHaloOf(lite) !== lite.transparent);
  // ② sweep 已修复（G2）⇒ 由"台账登记"改为**强断言**：浅色 `core` 必须**非透明**
  let sweepDefect: boolean = false;
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const p = paletteOf(ALL_THEMES[i]);
    if (!isLightPalette(p)) { continue; }
    const b: SweepBand = sweepBandOf(p);
    if (b.core === p.transparent) { sweepDefect = true; }
  }
  ok('下游·sweepBandOf：浅色 `core` **非透明**（扫光带不再反序退化）',
    sweepDefect === false, 'core 又变透明 ⇒ 退化回归');
  ok('  · 缺陷台账已清空（修好即收缩，⛔ 只许缩短；再登记缺陷须同步本节）',
    KNOWN_GLOW_CONSUMER_DEFECTS.length === 0);
}

if (fail > 0) { console.log(`  porcelain_glow: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_glow: ${pass} passed, 0 failed`);
process.exit(0);
