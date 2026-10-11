/**
 * B 项契约：**半径令牌化 + 浅色扩散分叉**（`core/tokens.ets` + `core/theme.ets`）。
 *
 * 洞见：**浅色柔影 = 更大半径 + 更低 alpha**（HIG 的"软影"）；深色柔影 = 更小半径 + 更高 alpha。
 * 此前半径是**调用点字面量** ⇒ 深浅同半径 ⇒ 浅色"没手感"。修法：
 *   · `core/tokens.ets`：`SHADOW_RADIUS_CARD`(=10) / `SHADOW_RADIUS_OVERLAY`(=20) / `LIGHT_SHADOW_DIFFUSION`(=1.5)；
 *   · `core/theme.ets: shadowRadiusOf(p, tier)`：深色 ⇒ 基础档（**逐字节不变**）；浅色 ⇒ × 扩散系数。
 *   · 基础值取**现状字面量的等同值**（`SyntheticCard` 的 10 = `SP_5/2`；`SPACE_LG` 的 20 = `SP_5`）
 *     ⇒ 迁移后**深色渲染不变**。
 *
 * mutation 自证（必红）：浅色臂去掉扩散（`return base`）⇒ ★②（浅色更大半径）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  paletteOf, effectsOf, isLightPalette, shadowRadiusOf, ALL_THEMES,
} from '../../entry/src/main/ets/core/theme';
import {
  SHADOW_RADIUS_CARD, SHADOW_RADIUS_OVERLAY, LIGHT_SHADOW_DIFFUSION,
} from '../../entry/src/main/ets/core/tokens';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ── ★① 深色族**逐字节不变**（快照：基础档原值）──────────────────────────────────────
{
  eq('档值快照：CARD = 10（= SP_5/2，原 SyntheticCard 字面量）', SHADOW_RADIUS_CARD, 10);
  eq('档值快照：OVERLAY = 20（= SP_5 = SPACE_LG，原 sheet 字面量）', SHADOW_RADIUS_OVERLAY, 20);
  ok('扩散系数 > 1（浅色更大半径）', LIGHT_SHADOW_DIFFUSION > 1);
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) {
      eq(`深色族 ${t}: card 档 === 基础值（逐字节不变）`, shadowRadiusOf(p, 'card'), SHADOW_RADIUS_CARD);
      eq(`深色族 ${t}: overlay 档 === 基础值（逐字节不变）`, shadowRadiusOf(p, 'overlay'), SHADOW_RADIUS_OVERLAY);
    }
  }
}

// ── ★② 浅色族：半径**更大**（方向正确）+ alpha **更低**（方向正确）────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) { continue; }
    eq(`${t}: card 半径 = round(base × 扩散)`, shadowRadiusOf(p, 'card'), Math.round(SHADOW_RADIUS_CARD * LIGHT_SHADOW_DIFFUSION));
    ok(`★② ${t}: 浅色 card 半径 > 深色基础（更软）`,
      shadowRadiusOf(p, 'card') > SHADOW_RADIUS_CARD, `got ${shadowRadiusOf(p, 'card')}`);
    ok(`  · overlay 半径同样更大`, shadowRadiusOf(p, 'overlay') > SHADOW_RADIUS_OVERLAY);
    // alpha 方向：浅色 elev2 的 alpha 必须**低于**深色 elev2（软影 = 更低 alpha）
    const lightA = parseInt(effectsOf(p).elev2.slice(1, 3), 16);
    const darkA = parseInt(effectsOf(paletteOf('dark')).elev2.slice(1, 3), 16);
    ok(`  · 浅色柔影 alpha(${lightA}) < 深色 alpha(${darkA})（更低 alpha）`, lightA < darkA);
  }
}

// ── ★③ 源码形态：分叉在 theme.ets；⛔ 深色臂不乘；⛔ 未反向 import design ────────────────
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
    const th: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8');
    const tk: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/tokens.ets'), 'utf-8');
    ok('theme.ets: 导出 shadowRadiusOf', th.indexOf('export function shadowRadiusOf(') >= 0);
    ok('  · 浅色臂乘扩散系数', th.indexOf('Math.round(base * LIGHT_SHADOW_DIFFUSION)') >= 0);
    ok('  · 深色臂返回基础档', th.indexOf('return isLightPalette(p) ? Math.round(base * LIGHT_SHADOW_DIFFUSION) : base;') >= 0);
    ok('  · 未反向 import design（防成环）', th.indexOf("from './design'") < 0);
    ok('  · import tokens（纯数值层）', th.indexOf("from './tokens'") >= 0);
    ok('tokens.ets: 三个新档齐备',
      tk.indexOf('SHADOW_RADIUS_CARD') >= 0 && tk.indexOf('SHADOW_RADIUS_OVERLAY') >= 0 && tk.indexOf('LIGHT_SHADOW_DIFFUSION') >= 0);

    // ── ★④ 不留"未消费"：新档必须被真实调用点消费 ─────────────────────────────────
    const consumers: string[] = ['SyntheticCard', 'AskUserSheet', 'MenuSheets', 'StatusSheet'];
    for (let i = 0; i < consumers.length; i++) {
      const c: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${consumers[i]}.ets`), 'utf-8');
      ok(`消费：${consumers[i]}.ets 用了 shadowRadiusOf`, c.indexOf('shadowRadiusOf(this.pal(),') >= 0);
    }
    const sc: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/SyntheticCard.ets'), 'utf-8');
    ok("  · 且走 'card' 档（= 原字面量 10 ⇒ 深色不变）", sc.indexOf("shadowRadiusOf(this.pal(), 'card')") >= 0);
    const ms: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/MenuSheets.ets'), 'utf-8');
    ok("  · sheet 走 'overlay' 档（= 原 SPACE_LG=20 ⇒ 深色不变）", ms.indexOf("shadowRadiusOf(this.pal(), 'overlay')") >= 0);
  }
}

if (fail > 0) { console.log(`  shadow_radius: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  shadow_radius: ${pass} passed, 0 failed`);
process.exit(0);
