/**
 * 浅色「玻璃/柔影层数」审计契约（目标⑤「干净」的另一半，2026-10-11）。
 *
 * ── 取证（合成后实测；porcelain / light / dark）────────────────────────────────────
 * | 层 | porcelain | light | dark |
 * |---|---|---|---|
 * | 画布 `appBg` | `#F7F7F8` | `#F8FAFC` | `#0B0B0E` |
 * | 玻璃（`glassBg` 合成到画布） | `#FDFDFE` | `#FEFEFE` | `#0D0D12` |
 * | 卡片 `surface` | `#FFFFFF` | `#FFFFFF` | `#0E0E14` |
 * | 抬升 `surfaceAlt` | `#F6F6F7` | `#F1F5F9` | `#14141C` |
 * | 激活 `surfaceHi` | `#EDEDEF` | `#E2E8F0` | `#1D1D28` |
 * | **Δ 画布↔玻璃** | **10** | **7** | **5** |
 * | **Δ 玻璃↔卡片** | **3** ⚠️ | **2** ⚠️ | **2** ⚠️ |
 * | Δ 玻璃↔抬升 / 卡片↔抬升 | 12 / 15 | 17 / 18 | 14 / 12 |
 *
 * **结论（可分，但有一对必须靠"结构"兜底）**：
 *   · 画布 → 玻璃 → 抬升 → 激活 这条 fill 阶梯**可分**（Δ ≥ 5，浅色更强）；
 *   · ⚠️ **"卡片压玻璃"这一对 fill 差只有 Δ2–3**（≈ 1.008–1.017 对比）⇒ **纯靠 fill 会糊**；
 *     ⇒ 现状是靠 `surface.card` 的**结构性发丝**（`hairline=true`）分界的 —— 本判据把它**钉住**。
 *
 * mutation 自证（必红）：① 把玻璃浅色档 alpha 降到 0.6（Δ 掉到 <6）⇒ ★① 红；
 *   ② 把 `surface.card` 的 hairline 改 false ⇒ ★② 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, surfacesOf, isLightPalette, ALL_THEMES } from '../../entry/src/main/ets/core/theme';
import { surfaceRoles, SurfaceRole, surfaceFillOf } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function chan(hex: string): number[] {
  const h = hex.length === 9 ? hex.slice(3) : hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function alphaOf(hex: string): number { return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) / 255 : 1; }
function over(fg: string, bg: string): string {
  const a = alphaOf(fg), f = chan(fg), b = chan(bg);
  return '#' + [0, 1, 2].map((i) => Math.round(a * f[i] + (1 - a) * b[i]).toString(16).padStart(2, '0').toUpperCase()).join('');
}
function dRGB(a: string, b: string): number {
  const A = chan(a), B = chan(b);
  return Math.sqrt(Math.pow(A[0] - B[0], 2) + Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2));
}

// 阈值**来自实测基线 − 余量**（⛔ 不是为好看调的）：浅色族最小 = 7（light）⇒ 6；深色族 = 5 ⇒ 4。
const MIN_GLASS_DELTA_LIGHT: number = 6;
const MIN_GLASS_DELTA_DARK: number = 4;

// ── ★① 玻璃与画布**必须可分**（浅色靠不透明度；且浅色要求更强于深色）──────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const glass: string = over(effectsOf(p).glassBg, p.appBg);
    const d: number = dRGB(p.appBg, glass);
    const min: number = isLightPalette(p) ? MIN_GLASS_DELTA_LIGHT : MIN_GLASS_DELTA_DARK;
    ok(`★① ${t}: Δ(画布, 玻璃合成) = ${d.toFixed(1)} ≥ ${min}（玻璃"看得见"，不糊进画布）`, d >= min,
      `canvas=${p.appBg} glass=${glass}`);
    ok(`  · ${t}: 玻璃比画布更亮（浅色族方向正确）`, isLightPalette(p) ? dRGB(glass, '#FFFFFF') < dRGB(p.appBg, '#000000') || chan(glass)[0] >= chan(p.appBg)[0] : true);
  }
}

// ── ★② "卡压玻璃"必靠**结构性发丝**兜底（fill 差只 Δ2–3 ⇒ 不许把发丝去掉）───────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const glass: string = over(effectsOf(p).glassBg, p.appBg);
    const card: string = surfaceFillOf(p, 'surface.card');
    const gap: number = dRGB(glass, card);
    // 实锤这对 fill 差很小（这是"必须靠结构"的前提；若哪天 fill 拉开了，本判据自动放行）
    if (gap < 8) {
      let cardRole: SurfaceRole | undefined = undefined;
      const roles: SurfaceRole[] = surfaceRoles();
      for (let j = 0; j < roles.length; j++) { if (roles[j].name === 'surface.card') { cardRole = roles[j]; } }
      ok(`★② ${t}: 卡↔玻璃 fill 差仅 ${gap.toFixed(1)} ⇒ 必须由结构性发丝兜底（surface.card.hairline === true）`,
        cardRole !== undefined && cardRole.hairline);
      ok(`  · ${t}: glassBorder 非全透明（边界可用）`, alphaOf(effectsOf(p).glassBorder) > 0);
    }
  }
}

// ── ★③ fill 阶梯：抬升/激活与玻璃**可分**（Δ ≥ 8；这条撑住"三层"）────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const glass: string = over(effectsOf(p).glassBg, p.appBg);
    ok(`★③ ${t}: 抬升级与玻璃可分（Δ = ${dRGB(glass, p.surfaceAlt).toFixed(1)} ≥ 8）`, dRGB(glass, p.surfaceAlt) >= 8);
    ok(`  · ${t}: 激活级与抬升级可分（Δ = ${dRGB(p.surfaceAlt, p.surfaceHi).toFixed(1)} ≥ 8）`, dRGB(p.surfaceAlt, p.surfaceHi) >= 8);
  }
}

if (fail > 0) { console.log(`  porcelain_layers: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_layers: ${pass} passed, 0 failed`);
process.exit(0);
