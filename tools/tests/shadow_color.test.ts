/**
 * A 项契约：**投影口径** `shadowColorOf(p, tier)`（`core/theme.ets`）。
 *
 * 背景：`eff().glow` = **发光**；浅色已按 E2 定为"不出辉光"（透明）。但 `pages/Index.ets` 有 4 处把它
 * **当投影用** ⇒ 浅色下"卡片没有阴影"。投影与发光是两件事 ⇒ 提供唯一口径：
 *   · **深色系 ⇒ `glow`（逐字节不变）**（深色"彩色发光 = 观感来源"，当投影即既有观感）；
 *   · **浅色系 ⇒ `elev2`/`elev3`**（真投影档：**非透明**且 **chroma 近中性**）。
 *
 * mutation 自证（必红）：把浅色臂改回 `return e.glow` ⇒ ★②（浅色非透明）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, isLightPalette, shadowColorOf, ALL_THEMES } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function chan(hex: string): number[] {
  const h: string = hex.length === 9 ? hex.slice(3) : hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function alphaOf(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) / 255 : 1;
}
/** chroma 近中性 ⇒ 饱和度 < 3%（与 E2 判据同一口径）。 */
function nearNeutral(hex: string): boolean {
  const c = chan(hex);
  const max = Math.max(c[0], c[1], c[2]);
  return max === 0 || (max - Math.min(c[0], c[1], c[2])) / max < 0.03;
}
/** 半透明前景合成到不透明底（浅色投影的色相只在**合成后**才可判 —— 与 E2 同口径）。 */
function compositeOver(fg: string, bg: string): string {
  const a = alphaOf(fg), f = chan(fg), b = chan(bg);
  const m = [0, 1, 2].map((i) => Math.round(a * f[i] + (1 - a) * b[i]));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

// ── ★① 深色臂**逐字节不变**：shadowColorOf === effectsOf().glow ────────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) {
      eq(`深色族 ${t}: shadowColorOf === glow（逐字节不变）`, shadowColorOf(p, 'raised'), effectsOf(p).glow);
      eq(`  · overlay 档同样 === glow`, shadowColorOf(p, 'overlay'), effectsOf(p).glow);
    }
  }
}

// ── ★② 浅色臂：**非透明**的真投影档，且区分 tier ──────────────────────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) { continue; }
    const e = effectsOf(p);
    eq(`${t}: shadowColorOf(raised) === elev2`, shadowColorOf(p, 'raised'), e.elev2);
    eq(`${t}: shadowColorOf(overlay) === elev3`, shadowColorOf(p, 'overlay'), e.elev3);
    ok(`★② ${t}: 浅色投影**非透明**（否则就是"卡片没有阴影"）`, alphaOf(shadowColorOf(p, 'raised')) > 0,
      `got ${shadowColorOf(p, 'raised')}`);
    ok(`  · 合成后 chroma 近中性（投影不该是彩色辉光）`,
      nearNeutral(compositeOver(shadowColorOf(p, 'raised'), p.appBg)));
    ok(`  · 与 glow 区分（浅色 glow 透明 ⇒ 不等）`, shadowColorOf(p, 'raised') !== e.glow);
  }
}

// ── ★③ 源码形态：口径落在 theme.ets 且浅色臂分叉 ────────────────────────────────────
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
    ok('theme.ets: 导出 shadowColorOf', src.indexOf('export function shadowColorOf(') >= 0);
    ok('  · 浅色臂走 elev3/elev2（真投影档）', src.indexOf("return tier === 'overlay' ? e.elev3 : e.elev2;") >= 0);
    ok('  · 深色臂走 e.glow（逐字节）', src.indexOf('return e.glow;') >= 0);
    ok('  · 判据走 isLightPalette（⛔ 不按主题名）', src.indexOf('!isLightPalette(p)') >= 0);
    ok('  · 未反向 import design（防成环）', src.indexOf("from './design'") < 0);
  }
}

if (fail > 0) { console.log(`  shadow_color: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  shadow_color: ${pass} passed, 0 failed`);
process.exit(0);
