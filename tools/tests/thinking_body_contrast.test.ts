/**
 * 思考展开体（长散文）可读性门禁 —— 用户 2026-10-14 亲报「切主题后历史正文几乎不可见」的机器判据。
 *
 * 真根因（取证链见 `core/theme.thinkingBodyColor` 函数头）：
 *   展开体原写法 = `pal.textMuted × TEXT_DIM(0.75)`（与 web `ThinkingLine.tsx:72-73` 逐字同源），
 *   合成后 **浅色 1.90:1**（`#94A3B8` 压 `#F8FAFC`）—— 连本仓「元信息档」`AA_MUTED = 2.0` 都不到，
 *   而 `AA_MUTED` 明文**只给元信息、不外扩到正文**（`docs/DESIGN-SYSTEM.md:1198/1240`）。
 *   ⚠️ 用户看到的"老的字颜色不会改过来"是**观感**不是机制：行确实跟随主题
 *   （`@StorageProp('appTheme')` + 数据源结构性重载；模拟器实测：切换前创建的行会渲染成深色板色）。
 *   真正不可见的是**这个落点本身**（且"达标档再乘 0.75"也解不掉：porcelain 2.97 < 3.0）。
 *
 * 三条判据：
 *  (1) **五套色板全部 ≥ AA 4.5**：`thinkingBodyColor` 对各自 `appBg` 的对比度（刻度的唯一表达 = 层级）；
 *  (2) **弱于正文**：必须仍明显弱于 `textPrimary`（不然思考块会争主）—— 且不得再叠 `.opacity()`；
 *  (3) **判别力自证**：旧写法（`textMuted × 0.75`）在浅色族必须**仍然不达标**（退回去必红），
 *      另加源码形态断言（落点必须消费纯函数、展开体不得有 `.opacity(TEXT_DIM)`），零扫描判红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  ALL_THEMES, Palette, paletteOf, isLightPalette, thinkingBodyColor, contrastRatio, compositeOver,
} from '../../entry/src/main/ets/core/theme';
import { TEXT_DIM } from '../../entry/src/main/ets/core/design';

let pass: number = 0;
let fail: number = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 把不透明度折进色值 —— ⛔ 本仓 8 位约定是 **`#AARRGGBB`（alpha 在前）**：
 *    `theme.parseColorRgba` 对 6 位色值补的是**前缀** `FF`（`h = 'FF' + h`）。
 */
function withAlpha(hex: string, a: number): string {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const v: string = Math.round(a * 255).toString(16).toUpperCase().padStart(2, '0');
  return `#${v}${h}`;
}

/** 某前景色按给定不透明度压在某底色上之后，与该底色的 WCAG 对比度。 */
function dimmedRatio(fg: string, bg: string, a: number): number {
  const composed: string = compositeOver(withAlpha(fg, a), bg);
  return contrastRatio(composed, bg);
}

const FLOOR: number = 4.5;   // WCAG AA（正文）
const QUIET_MIN: number = 1.5;   // 「必须弱于正文」：至少比 textPrimary 低这么多

console.log('thinking_body_contrast: 思考展开体可读性');

const themes: string[] = ALL_THEMES;
ok('主题清单非空（判据覆盖 5 套）', themes.length === 5, `got ${themes.length}`);

let lightChecked: number = 0;
let darkChecked: number = 0;
for (const name of themes) {
  const p: Palette = paletteOf(name);
  const body: string = thinkingBodyColor(p);
  const ratio: number = contrastRatio(body, p.appBg);
  const primaryRatio: number = contrastRatio(p.textPrimary, p.appBg);
  ok(`${name}: 展开体 ≥ AA ${FLOOR}`, ratio >= FLOOR, `${body} 压 ${p.appBg} = ${ratio.toFixed(2)}`);
  ok(`${name}: 仍明显弱于正文（≤ 正文 / ${QUIET_MIN}）`, ratio * QUIET_MIN <= primaryRatio,
    `body ${ratio.toFixed(2)} vs primary ${primaryRatio.toFixed(2)}`);
  ok(`${name}: 取值 = textSecondary（达标档，不自造第三档）`, body === p.textSecondary,
    `got ${body} want ${p.textSecondary}`);
  if (isLightPalette(p)) {
    lightChecked++;
    // 判别力：旧写法（textMuted × 0.75）必须**仍然不达标** —— 退回旧实现 ⇒ 本段红。
    const oldRatio: number = dimmedRatio(p.textMuted, p.appBg, TEXT_DIM);
    ok(`${name}: 旧写法(textMuted×0.75) 确实不达标（本判据有判别力）`, oldRatio < 2.1,
      `old = ${oldRatio.toFixed(2)}`);
  } else {
    darkChecked++;
    const oldDark: number = dimmedRatio(p.textMuted, p.appBg, TEXT_DIM);
    ok(`${name}: 新版严格优于旧写法`, ratio > oldDark, `old ${oldDark.toFixed(2)} → new ${ratio.toFixed(2)}`);
  }
}
ok('浅色族被覆盖（light/porcelain）', lightChecked === 2, `got ${lightChecked}`);
ok('深色族被覆盖（dark/aurora/nebula）', darkChecked === 3, `got ${darkChecked}`);

// ── 源码形态断言：落点必须**消费**纯函数（零扫描判红 + 禁止退回「muted + 压暗」）──────────
const root: string = require('path').join(__dirname, '..', '..', '..', '..');  // <repo>/tools/tests/.out-one.$$/js → 4 级
const comp: string = require('fs').readFileSync(
  require('path').join(root, 'entry/src/main/ets/components/ThinkingLine.ets'), 'utf8');
const callSites: number = comp.split('thinkingBodyColor(').length - 1;
ok('ThinkingLine 消费 thinkingBodyColor（≥1 调用点；0 处即判红）', callSites >= 1, `got ${callSites}`);
ok('ThinkingLine 展开体不再无条件用 textMuted（源码形态）',
  comp.indexOf('.fontColor(paletteOf(this.themeId()).textMuted)') < 0);
ok('ThinkingLine 展开体用的是 this.bodyColor()', comp.indexOf('.fontColor(this.bodyColor())') >= 0);
ok('ThinkingLine 展开体不再叠 .opacity(TEXT_DIM)（压暗是把达标档拖下地板的原因）',
  comp.indexOf('.opacity(TEXT_DIM)') < 0);

const themeSrc: string = require('fs').readFileSync(
  require('path').join(root, 'entry/src/main/ets/core/theme.ets'), 'utf8');
ok('纯函数定义在 core/theme.ets（判据与渲染同源）',
  themeSrc.indexOf('export function thinkingBodyColor(') >= 0);

if (fail > 0) { console.log(`  thinking_body_contrast: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  thinking_body_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};
