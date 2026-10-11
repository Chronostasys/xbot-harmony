/**
 * 扫光取色门禁 —— 守护 `core/sweep.ets:sweepBandOf` 的浅/深分叉。
 *
 * 判据（判别力核心）：
 *  · **深色**逐字节 = 波5 前的原值（`accentSoftFade` / `accentSoft` / `sheen`）；
 *  · **浅色**（`isLightPalette`，含 light / porcelain）落**中性**，且 = `Effects.glow/glowSoft`
 *    同口径（`textPrimary@16% / @10%`）⇒ **绝不含 accent 色**（改回 accentSoft ⇒ 本门禁必红）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

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

// ── 浅色：落中性（同 glow/glowSoft 口径；绝不含 accent）────────────────────────
for (const t of LIGHT_THEMES) {
  const p: Palette = paletteOf(t);
  const e: Effects = effectsOf(p);
  const b: SweepBand = sweepBandOf(p);
  eq(`${t}: 浅色 core = glow（textPrimary@16%）`, b.core, e.glow);
  eq(`${t}: 浅色 fade = glowSoft（textPrimary@10%）`, b.fade, e.glowSoft);
  eq(`${t}: 浅色 sheen = effects.sheen（中性）`, b.sheen, e.sheen);
  // 同口径交叉验证：浅色 glow === elev3（均 textPrimary@16%）、glowSoft === elev2（均 textPrimary@10%）
  eq(`${t}: glow 与 elev3 同口径（textPrimary@16%）`, e.glow, e.elev3);
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

console.log(`  sweep: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
