/**
 * **环境（插件）值被消费**契约（`glassOpacity`/`wallpaperOpacity`/`glassBlur`；2026-10-11）。
 *
 * 背景：backlog 记「插件值原生**未消费**」= 用户 `setSetting` 后界面**静默无反应**（死消费族）。
 * 口径（主 agent 定死）：**覆盖式** —— `currentAmbience === null`（未设置）⇒ **完全走现状**
 * （⛔ 不用 web 的 0.82/1/0 当缺省：相乘口径下缺省即变，spec 自相矛盾）；非空 ⇒ 覆盖
 * `glassBg`/`glassBorder` 的 alpha = `glassOpacity`、`e.glassBlur = glassBlur`（值直用，web 侧亦无换算）。
 * ⚠️ `wallpaperOpacity`：**原生 N/A（web 独有）**——`grep -rn "wallpaper" entry/src/main/ets/` 剥注释后为空；
 *    保留在 `AmbienceValues` 里对齐 web 契约，**判据显式豁免**。
 *
 * ⭐ 期望值来源（⛔ 不用"改后自比"）：**改动前**用 tsc+node 录下三主题的 `glassBg/glassBorder/glassBlur`。
 * ⭐ 消费点断言钉**调用点计数**（`currentAmbience` 在 `buildEffects` 里被**读**），⛔ 不钉"函数存在"。
 * mutation：把 `buildEffects` 里对 `currentAmbience` 的消费摘掉 ⇒ ★②/★③ 必红（还原后复跑绿）。
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, setAmbience, AmbienceValues } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ⭐ 改动前录得的期望值（tsc+node 实跑，非自比）
const BEFORE: string[][] = [
  ['base', '#9E0E0E14', '#8C2E2E3C', '18'],
  ['dark', '#9E0E0E14', '#8C2E2E3C', '18'],
  ['porcelain', '#CCFFFFFF', '#B3D8D8DC', '18'],
];

// ── ① `null` ⇒ 现状**逐字节**（用改前期望值比对）────────────────────────────────────
{
  setAmbience(null);
  for (let i = 0; i < BEFORE.length; i++) {
    const p = paletteOf(BEFORE[i][0]);
    const e = effectsOf(p);
    eq(`① ${BEFORE[i][0]} glassBg 缺省 == 改前`, e.glassBg, BEFORE[i][1]);
    eq(`① ${BEFORE[i][0]} glassBorder 缺省 == 改前`, e.glassBorder, BEFORE[i][2]);
    eq(`① ${BEFORE[i][0]} glassBlur 缺省 == 改前`, String(e.glassBlur), BEFORE[i][3]);
  }
}

// ── ② 设置了 ⇒ 按设置变；复位 ⇒ 回① ────────────────────────────────────────────────
{
  const v = new AmbienceValues();
  v.glassOpacity = 0.5; v.wallpaperOpacity = 1; v.glassBlur = 24;
  setAmbience(v);
  const p = paletteOf('base');
  const e = effectsOf(p);
  ok('② 设置后 glassBg 与缺省**不同**', e.glassBg !== BEFORE[0][1], `got ${e.glassBg}`);
  eq('② glassBlur 直用设置值', e.glassBlur, 24);
  ok('② 设置的 alpha 生效（0.5 ⇒ 首字节 0x80）', e.glassBg.substring(1, 3) === '80', e.glassBg);
  setAmbience(null);
  eq('② 复位后 glassBg 回到改前', effectsOf(p).glassBg, BEFORE[0][1]);
}

// ── ③ 消费点：形态断言钉**调用点计数**（⛔ 不钉"函数存在"）───────────────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const c = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/core/theme.ets'))) { repo = c; break; }
  }
  ok('③ 探测到 theme.ets', repo.length > 0);
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const reads: number = (src.match(/currentAmbience/g) || []).length;   // 读+写共现；零扫描判红
    ok(`③ ★消费点：theme.ets 里 currentAmbience 出现 ${reads} 次（≥4：声明/写入口 2/读 1+）`, reads >= 4);
    ok('③ 且 `buildEffects` 里确有读（`const amb: AmbienceValues | null = currentAmbience;`）',
      src.indexOf('const amb: AmbienceValues | null = currentAmbience;') >= 0);
    ok('③ 且三处玻璃取值都吃 `amb`（glassBlur + 2 主题 glassBg/Border）',
      (src.match(/amb === null \?/g) || []).length >= 5);
  }
}

if (fail > 0) { console.log(`  ambience_override: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ambience_override: ${pass} passed, 0 failed`);
process.exit(0);
