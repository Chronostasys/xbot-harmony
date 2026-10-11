/**
 * 扫光取色门禁 —— 守护 `core/sweep.ets:sweepBandOf` 的浅/深分叉。
 *
 * 判据（判别力核心）：
 *  · **深色**逐字节 = 波5 前的原值（`accentSoftFade` / `accentSoft` / `sheen`）；
 *  · **浅色**（`isLightPalette`，含 light / porcelain）落**中性柔影**，且 **`core` 必须可见**
 *    （`= Effects.elev3` = `textPrimary@16%`，⛔ 不得是 `transparent`）—— E2 曾把浅色 `glow` 短路成
 *    透明（`core` 取值随之隐形 ⇒ **扫光带反序退化**）⇒ 这里钉「可见」与「中心 ≥ 两端」两条真值。
 *    **绝不含 accent 色**（改回 accentSoft ⇒ 本门禁必红）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { SweepBand, sweepBandOf } from '../../entry/src/main/ets/core/sweep';
import { ALL_THEMES, Effects, isLightPalette, Palette, paletteOf, effectsOf } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const DARK_THEMES: string[] = ['dark', 'aurora', 'nebula'];
const LIGHT_THEMES: string[] = ['light', 'porcelain'];

// ── 浅/深划分（判据 = isLightPalette 按 appBg 亮度，**不看主题名**）──────────────
eq('浅色主题集 = [light, porcelain]',
  ALL_THEMES.filter((t: string): boolean => isLightPalette(paletteOf(t))), LIGHT_THEMES);
for (const t of DARK_THEMES) { eq(`${t}: isLightPalette === false`, isLightPalette(paletteOf(t)), false); }
for (const t of LIGHT_THEMES) { eq(`${t}: isLightPalette === true`, isLightPalette(paletteOf(t)), true); }

// ── 深色：逐字节 = 原值（改深色 ⇒ 必红）────────────────────────────────────────
for (const t of DARK_THEMES) {
  const p: Palette = paletteOf(t);
  const e: Effects = effectsOf(p);
  const b: SweepBand = sweepBandOf(p);
  eq(`${t}: 深色 fade = accentSoftFade（逐字节）`, b.fade, p.accentSoftFade);
  eq(`${t}: 深色 core = accentSoft（逐字节）`, b.core, p.accentSoft);
  eq(`${t}: 深色 sheen = effects.sheen（逐字节）`, b.sheen, e.sheen);
  // 仍是**彩色**（accent 族）—— 深色不中性化
  eq(`${t}: 深色 core 仍是 accent 族`, b.core, p.accentSoft);
}

// ── 浅色：落中性柔影（core 必须可见；绝不含 accent）──────────────────────────────
/** 从 `#AARRGGBB` / `#RRGGBB` 取 alpha（0..255）—— 用于"中心 ≥ 两端"的可量化比较。 */
function alphaOf(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) : 255;
}
for (const t of LIGHT_THEMES) {
  const p: Palette = paletteOf(t);
  const e: Effects = effectsOf(p);
  const b: SweepBand = sweepBandOf(p);
  // ★ 真值①：核心**可见**（⛔ 不得是 transparent）—— E2 后浅色 `glow` 恒透明 ⇒ 曾退化
  eq(`${t}: 浅色 core **非透明**（核心可见）`,
    alphaOf(b.core) > 0 && b.core !== p.transparent, true);
  // ★ 真值②：核心 = 中性柔影档 `elev3`（textPrimary@16%，与 E2 前 glow 同值）；⛔ 不复用透明通道
  eq(`${t}: 浅色 core = elev3（textPrimary@16%）`, b.core, e.elev3);
  eq(`${t}: 浅色 core ≠ glow（⛔ 不得复用透明通道）`, b.core !== e.glow, true);
  eq(`${t}: 浅色 fade = glowSoft（textPrimary@10%）`, b.fade, e.glowSoft);
  eq(`${t}: 浅色 sheen = effects.sheen（中性）`, b.sheen, e.sheen);
  // ★ 真值③：强弱序 —— 中心强于两端（alpha 比较），不再"反序"
  eq(`${t}: 浅色核心可见度 ≥ 两端（alpha(core) ≥ alpha(fade)）`,
    alphaOf(b.core) >= alphaOf(b.fade), true);
  eq(`${t}:   · 严格更强（中心 > 两端 ⇒ "中心亮、两端淡出"）`,
    alphaOf(b.core) > alphaOf(b.fade), true);
  // ⚠️ E2：浅色 `glow` 改为**透明**（不出辉光）。
  eq(`${t}: 浅色 glow = 透明（不出辉光，E2）`, e.glow, p.transparent);
  // ⚠️ L3：elev2 @10%→@7%（分层交给 L2 白度差）⇒ 两者**不再同值**；改为"强弱序"不变量。
  eq(`${t}: 浅色柔影强弱序 elev2 < glowSoft`,
    parseInt(e.elev2.slice(1,3),16) < parseInt(e.glowSoft.slice(1,3),16), true);
  // 判别力核心：浅色**绝不**再用 accent 色（mutation：改回 accentSoft ⇒ 必红）
  eq(`${t}: 浅色 core ≠ accentSoft（无彩色）`, b.core !== p.accentSoft, true);
  eq(`${t}: 浅色 fade ≠ accentSoftFade（无彩色）`, b.fade !== p.accentSoftFade, true);
  // 且与深色**不同色**（证明中性化真的生效，不是两侧都同值）
  eq(`${t}: 浅色 core ≠ 深色 core`, b.core !== sweepBandOf(paletteOf('dark')).core, true);
}

// ── 纯函数性（同一 palette 多次调用逐字节一致）────────────────────────────────
{
  const p: Palette = paletteOf('light');
  const a: SweepBand = sweepBandOf(p);
  const b: SweepBand = sweepBandOf(p);
  eq('sweepBandOf 幂等（同 palette 逐字节一致）',
    [a.fade, a.core, a.sheen], [b.fade, b.core, b.sheen]);
}

// ── 源码形态：浅色 core 已改走可见中性档（`elev3`）；陈旧注释已同步订正 ──────────────
//    ⛔ 零扫描判红：正断言用 `indexOf(...) >= 0` ⇒ 扫不到（0 处）即红（白绿防线）。
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/sweep.ets'))) { repo = cand; break; }
  }
  eq('探测到仓库根（sweep.ets）', repo.length > 0, true);
  if (repo.length > 0) {
    const src: string =
      fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/sweep.ets'), 'utf-8');
    eq('sweep.ets: 浅色 core = e.elev3（**可见中性档**）', src.indexOf('b.core = e.elev3;') >= 0, true);
    eq('sweep.ets: ⛔ 不再以透明通道 e.glow 作 core', src.indexOf('b.core = e.glow;') < 0, true);
    eq('sweep.ets: 陈旧注释（core=`glow`(16%) 强于 fade=`glowSoft`(10%)）已订正',
      src.indexOf('强于 fade=`glowSoft`') < 0, true);
    eq('sweep.ets: 深色臂 core 逐字节不变（accentSoft）', src.indexOf('b.core = p.accentSoft;') >= 0, true);
    eq('sweep.ets: 深色臂 fade 逐字节不变（accentSoftFade）',
      src.indexOf('b.fade = p.accentSoftFade;') >= 0, true);
  }
}

console.log(`  sweep: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
