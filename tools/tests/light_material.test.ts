/**
 * 浅色「光感白」材质再设计契约（C3，2026-10-11；`docs/DESIGN-SYSTEM.md §18`）。
 *
 * 起点（backlog）：`sheen`/`elev`/`glass` 的浅色档此前只是**中性等价**（"把深色去色"），
 * 不是**特制**的白色主题。用户判据：「一套特制的、原生独享的应用白色主题」+ 苹果科技感。
 *
 * 本判据把 C3 的三条落点钉死（**判据与渲染同源**：渲染层调的就是这些 token/函数）：
 *   ★① **深色逐字节不变**（硬编码期望值 —— ⛔ 不用"改后自比"）：`shadowLayersOf` 的深色 `far`
 *      必须 = 迁移前 SyntheticCard 的**原单层**（`elev1` @ `shadowRadiusOf('card')` + offsetY 2），
 *      且 `near` 必须**透明**（= 不加层）。
 *   ★② **浅色 = ≥2 层柔影**（C3 的"多层柔影"）：`shadowLayersOf` 浅色必须返回 **2 层**
 *      （贴合：小半径 + 透明非零；环境：大半径），且两层**色都不透明**（影真的存在）。
 *      ⛔ 反过来：深色**只有 1 层"真影"**（`near` 透明不算），否则深色被加层 = 回归。
 *   ★③ **玻璃更实 / 亮边更明确**（数值硬编码）：浅色 `glassBg` 0.80→0.84、`glassBorder`
 *      0.70→0.86；深色玻璃**逐字节不变**。
 *
 * mutation 自证（必红，实测）：
 *   ① 把 `shadowLayersOf` 浅色臂改回"单层"（`near.color = p.transparent`）⇒ ★② 红；
 *   ② 把浅色 `glassBg` 改回 0.80 ⇒ ★③ 红。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  ALL_THEMES, ShadowLayer, isLightPalette, paletteOf, effectsOf, shadowLayersOf, shadowRadiusOf,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function alphaOf(hex: string): number { return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) : 255; }

// ⭐ 硬编码期望值（改动前录得，⛔ 不自比）：
const DARK_ELEV1: string = '#3D000000';     // 深色 elev1 = 黑@24%（所有深色族同值）
const CARD_BASE_RADIUS: number = 10;        // shadowRadiusBaseOf('card')
const DARK_CARD_RADIUS: number = 10;        // shadowRadiusOf(dark,'card') = 10（不乘扩散）
const LIGHT_CARD_FAR_RADIUS: number = 15;   // shadowRadiusOf(light,'card') = round(10 × 1.5)
const LIGHT_CARD_NEAR_RADIUS: number = 3;   // max(3, round(10 × 0.30))
// C3 玻璃新值（0.84 / 0.86）与其**旧值**（0.80 / 0.70）—— 用于"更实/更明确"的方向断言。
const LIGHT_GLASS_ALPHA_NEW: number = 214;  // round(0.84 × 255) = 214 = 0xD6
const LIGHT_GLASS_ALPHA_OLD: number = 204;  // round(0.80 × 255) = 204 = 0xCC
const LIGHT_BORDER_ALPHA_NEW: number = 219; // round(0.86 × 255) = 219 = 0xDB
const LIGHT_BORDER_ALPHA_OLD: number = 179; // round(0.70 × 255) = 179 = 0xB3

// ── ★① 深色逐字节不变 ────────────────────────────────────────────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (isLightPalette(p)) { continue; }
    const layers: ShadowLayer[] = shadowLayersOf(p, 'card');
    eq(`★① 深色 ${t}: 恒 2 元素（调用点可无条件取 [0]/[1]）`, layers.length, 2);
    ok(`★① 深色 ${t}: near **透明**（= 不加层 ⇒ 视图树不随主题分叉）`,
      alphaOf(layers[0].color) === 0, `near.color=${layers[0].color}`);
    eq(`★① 深色 ${t}: far.color = 原单层 elev1（逐字节）`, layers[1].color, DARK_ELEV1);
    eq(`★① 深色 ${t}: far.radius = 原 shadowRadiusOf('card')`, layers[1].radius, DARK_CARD_RADIUS);
    eq(`★① 深色 ${t}: far.offsetY = 原 offsetY 2`, layers[1].offsetY, 2);
  }
}

// ── ★② 浅色 = ≥2 层柔影（C3 的"多层柔影"）；深色只有 1 层"真影" ────────────────────
{
  let lightThemes = 0;
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const layers: ShadowLayer[] = shadowLayersOf(p, 'card');
    let realLayers = 0;
    for (let j = 0; j < layers.length; j++) {
      if (alphaOf(layers[j].color) > 0) { realLayers++; }
    }
    if (isLightPalette(p)) {
      lightThemes++;
      eq(`★② 浅色 ${t}: 恒 2 层`, layers.length, 2);
      eq(`★② 浅色 ${t}: **可见层数 = 2**（贴合 + 环境）`, realLayers, 2);
      ok(`★② 浅色 ${t}: 贴合层更小半径（near < far：${layers[0].radius} < ${layers[1].radius}）`,
        layers[0].radius < layers[1].radius);
      eq(`★② 浅色 ${t}: 贴合层半径 = round(base × 0.30)`, layers[0].radius, LIGHT_CARD_NEAR_RADIUS);
      eq(`★② 浅色 ${t}: 环境层半径 = shadowRadiusOf('card')（× 浅色扩散）`, layers[1].radius, LIGHT_CARD_FAR_RADIUS);
      eq(`★② 浅色 ${t}: 贴合层 1vp 偏移（"落在纸面上"）`, layers[0].offsetY, 1);
      eq(`★② 浅色 ${t}: 贴合层 = elev1（同族柔影，⛔ 非黑块）`, layers[0].color, effectsOf(p).elev1);
      eq(`★② 浅色 ${t}: 环境层 = elev2`, layers[1].color, effectsOf(p).elev2);
      ok(`★② 浅色 ${t}: 环境层偏移 4vp（向下投影，别四边糊）`, layers[1].offsetY === 4);
      // 大面/浮层档：更清楚的 2 层（elev2 贴合 + elev3 环境）
      const ov: ShadowLayer[] = shadowLayersOf(p, 'overlay');
      eq(`★② 浅色 ${t}: overlay 也是 2 层`, ov.length, 2);
      eq(`★② 浅色 ${t}: overlay 贴合 = elev2`, ov[0].color, effectsOf(p).elev2);
      eq(`★② 浅色 ${t}: overlay 环境 = elev3`, ov[1].color, effectsOf(p).elev3);
    } else {
      eq(`★② 深色 ${t}: **只有 1 层真影**（浅色才多层 —— 深色加层即回归）`, realLayers, 1);
    }
  }
  ok(`★② 扫到浅色主题（${lightThemes} 个；零扫描判红）`, lightThemes > 0);
}

// ── ★③ 玻璃：浅色更实 + 亮边更明确；深色逐字节不变 ──────────────────────────────────
{
  const light = effectsOf(paletteOf('light'));
  const porc = effectsOf(paletteOf('porcelain'));
  const dark = effectsOf(paletteOf('dark'));
  // 浅色玻璃底：0.84（硬编码期望，且**方向**上比旧 0.80 更实）
  eq('★③ light glassBg = 白@84%', light.glassBg, '#D6FFFFFF');
  eq('★③ porcelain glassBg = 白@84%', porc.glassBg, '#D6FFFFFF');
  ok('★③ 浅色玻璃底 alpha ≥ 旧 0.80（更实一档，⛔ 不是"去色"）',
    alphaOf(light.glassBg) >= LIGHT_GLASS_ALPHA_NEW && LIGHT_GLASS_ALPHA_NEW > LIGHT_GLASS_ALPHA_OLD);
  // 浅色亮边：0.86（硬编码期望，且**方向**上比旧 0.70 更明确）
  eq('★③ light glassBorder = borderStrong@86%', light.glassBorder, '#DBCBD5E1');
  eq('★③ porcelain glassBorder = borderStrong@86%', porc.glassBorder, '#DBD8D8DC');
  ok('★③ 浅色玻璃亮边 alpha ≥ 旧 0.70（更明确一档）',
    alphaOf(light.glassBorder) >= LIGHT_BORDER_ALPHA_NEW && LIGHT_BORDER_ALPHA_NEW > LIGHT_BORDER_ALPHA_OLD);
  // 深色玻璃：逐字节不变（硬编码期望）
  eq('★③ dark glassBg 逐字节不变（黑玻璃@62%）', dark.glassBg, '#9E0E0E14');
  eq('★③ dark glassBorder 逐字节不变（@55%）', dark.glassBorder, '#8C2E2E3C');
  eq('★③ aurora glassBg 逐字节不变', effectsOf(paletteOf('aurora')).glassBg, '#9E0B1424');
  eq('★③ nebula glassBg 逐字节不变', effectsOf(paletteOf('nebula')).glassBg, '#9E0F0A1E');
}

// ── ★④ 零扫描判红（白绿防线）────────────────────────────────────────────────────────
ok('★④ ALL_THEMES 非空（零扫描判红）', ALL_THEMES.length > 0);
ok('★④ shadowRadiusOf 基线仍为 card=10（多层柔影的"far"依赖它）',
  shadowRadiusOf(paletteOf('dark'), 'card') === CARD_BASE_RADIUS);

if (fail > 0) { console.log(`  light_material: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  light_material: ${pass} passed, 0 failed`);
process.exit(0);
