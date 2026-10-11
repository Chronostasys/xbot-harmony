/**
 * porcelain `surfaceHi` 组合对比度判据（目标⑤ · 2026-10-11）。
 *
 * ── 为什么需要它（不是"再造一套矩阵"）─────────────────────────────────────────────
 * `porcelain-audit` ⚠️-3 实测：`contrastReqs()`（`core/design.ets`）此前**只**把 `surfaceHi`
 * 当作 `textPrimary` 的底 ⇒ 「选中 pill / 高亮行 / 悬停行（= `surface.active` /
 * `surface.pillSelected` / `surface.overlayRowHover`，`RUNG_ACTIVE` = `surfaceHi`）上的**次要文字**
 * 与**强调色图形/文字**」**没有任何判定**。审计当时**未逐一 grep 消费点**，只记为"护栏"。
 *
 * 本判据补三件事（口径 = 仓内已批准常量，⛔ 不放宽）：
 *   §1 把 `surfaceHi` 纳入 `textSecondary` / `accent` 的**下限断言**（矩阵形态 + 零扫描判红）；
 *   §2 钉住 ⚠️-4：`colorOf` 必须覆盖 6 个此前只能 `pal()` 直取的角色（**形态 + 逐主题取值**）；
 *   §3 **核实真实落点**并给 `file:line` 证据 + **逐主题实算比值**；
 *   §4 台账纪律：不达标格**必须已登记**（未登记 ⇒ 红）、台账条目**必须仍是不达标对**（修好 ⇒ 陈旧 ⇒ 红）。
 *
 * ★ mutation 自证（交付回报含原文）：
 *   ① 删 `contrastReqs()` 里 `('textSecondary','surfaceHi',…)` 一行 ⇒ §1 必红；
 *   ② 删 `colorOf()` 里任一新增 `if (role === 'x')` ⇒ §2 必红（形态 + 取值双路）。
 *
 * ⚠️ 本文件**只判不改色板**：真不达标的格归 `core/theme.ets`（brand-impl）或落点组件侧
 * ⇒ 出 spec / 登记台账，⛔ 不在此越权改色值。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, Palette, THEME_PORCELAIN } from '../../entry/src/main/ets/core/theme';
import {
  colorOf, contrastReqs, contrastAudit, contrastFailures, knownContrastLedger,
  AA_TEXT, ContrastReq, ContrastResult, ContrastFailure,
} from '../../entry/src/main/ets/core/design';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail.length > 0 ? `\n      ${detail}` : ''}`); }
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const designPath: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'design.ets');
/** 剥注释（仓内约定：注释里记色值/role 是允许且鼓励的 ⇒ 扫源码前必须剥，保留换行不漂行号）。 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

// ════════════════════════════════════════════════════════════════════════════
// §1 矩阵形态：surfaceHi 必须作为 textSecondary / accent 的底（零扫描判红）
// ════════════════════════════════════════════════════════════════════════════
const reqs: ContrastReq[] = contrastReqs();
ok('零扫描判红：contrastReqs() 非空（≥15 条）', reqs.length >= 15, `got ${reqs.length}`);
function findReq(list: ContrastReq[], fg: string, bg: string): ContrastReq | undefined {
  for (let i = 0; i < list.length; i++) { if (list[i].fg === fg && list[i].bg === bg) { return list[i]; } }
  return undefined;
}
const rTs: ContrastReq | undefined = findReq(reqs, 'textSecondary', 'surfaceHi');
const rAc: ContrastReq | undefined = findReq(reqs, 'accent', 'surfaceHi');
ok('矩阵含 textSecondary × surfaceHi（选中/高亮面上的次要文字）', rTs !== undefined);
ok('矩阵含 accent × surfaceHi（选中/高亮面上的强调色图形/文字）', rAc !== undefined);
ok('这两格的门槛 = AA_TEXT(4.5)（⛔ 未放宽）',
  rTs !== undefined && rAc !== undefined && rTs.min === AA_TEXT && rAc.min === AA_TEXT,
  `textSecondary.min=${rTs !== undefined ? rTs.min : 'n/a'} accent.min=${rAc !== undefined ? rAc.min : 'n/a'}`);
let surfaceHiAsBg: number = 0;
for (let i = 0; i < reqs.length; i++) { if (reqs[i].bg === 'surfaceHi') { surfaceHiAsBg++; } }
ok('surfaceHi 作为「底」的条目 ≥3（textPrimary/textSecondary/accent）', surfaceHiAsBg >= 3, `got ${surfaceHiAsBg}`);

// ════════════════════════════════════════════════════════════════════════════
// §2 ⚠️-4：colorOf 必须覆盖 6 个此前只能 pal() 直取的角色（形态 + 取值双路）
// ════════════════════════════════════════════════════════════════════════════
const NEW_ROLES: string[] = ['foreground3', 'accentHover', 'accentSoftFade', 'bubbleUser', 'borderStrong', 'success'];
ok('清单冻结 = 6 个（本波接入范围）', NEW_ROLES.length === 6);
const designSrc: string = stripSrc(fsMod.readFileSync(designPath, 'utf-8'));
for (let i = 0; i < NEW_ROLES.length; i++) {
  // 形态路：真源里必须有 `role === 'x'` 分支（删掉 ⇒ 红）—— 也是 color-roles.sh 的派生来源
  ok(`形态：design.ets 含 role === '${NEW_ROLES[i]}' 分支`,
    designSrc.indexOf(`role === '${NEW_ROLES[i]}'`) >= 0);
}
ok('形态：design.ets **不含** role === \'transparent\'（保留兜底哨兵语义）',
  designSrc.indexOf("role === 'transparent'") < 0);
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const m: Record<string, string> = p as unknown as Record<string, string>;
  for (let i = 0; i < NEW_ROLES.length; i++) {
    // 取值路：逐主题取到**非 transparent** 且与同名 Palette 字段**逐字节相同**（⛔ 不调色）
    const got: string = colorOf(p, NEW_ROLES[i]);
    ok(`[${theme}] colorOf('${NEW_ROLES[i]}') = p.${NEW_ROLES[i]}（非 transparent）`,
      got === m[NEW_ROLES[i]] && got !== p.transparent, `got ${got} want ${m[NEW_ROLES[i]]}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §3 真实落点取证 + 逐主题实算（审计数的复核）
// ════════════════════════════════════════════════════════════════════════════
// 真实落点（`textSecondary` 坐在 `surfaceHi` 面上）—— 审计当时**未**逐一 grep，本处查实：
//   · components/LiveTailView.ets:442  .fontColor(pal().textSecondary)
//                    同元素 :445      .backgroundColor(overOpen ? pal().surfaceHi : …)  「+N」溢出徽标
//   · components/MessageRow.ets:925    .fontColor(pal().textSecondary)
//                   同元素 :928        .backgroundColor(overIter===it ? pal().surfaceHi : …) 「+N」溢出徽标
//   · components/SettingsLlm.ets:819   Text('取消').fontColor(pal().textSecondary)（FS_CAPTION）
//                   容器 :831          .backgroundColor(surfaceFillOf(p,'surface.active'))  = surfaceHi
//   · pages/Index.ets:4210             .fontColor(runningNow() ? pal().textSecondary : …)（发送键图标）
//                   同元素 :4222        .backgroundColor(runningNow() ? pal().surfaceHi : …)
// ⚠️ `accent` 坐在 `surfaceHi` 上：**未找到**真实落点（已 grep `pal().accent` 全部前景用法；
//    MessageNav 的 `accent` 坐在 `withAlpha(accent, 0.10)` 上、非 surfaceHi）⇒ 该格为**护栏**。
const por: Palette = paletteOf(THEME_PORCELAIN);
const porTs: number = contrastRatio(por.textSecondary, por.surfaceHi);
const porAc: number = contrastRatio(por.accent, por.surfaceHi);
ok('复核审计数：porcelain textSecondary × surfaceHi ≈ 4.337', Math.abs(porTs - 4.3374) < 0.001, `got ${porTs.toFixed(4)}`);
ok('复核审计数：porcelain accent × surfaceHi ≈ 4.017', Math.abs(porAc - 4.0170) < 0.001, `got ${porAc.toFixed(4)}`);

const ledger: string[] = knownContrastLedger();
console.log('  · surfaceHi 组合实算（AA_TEXT = 4.5）：');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const a: number = contrastRatio(p.textSecondary, p.surfaceHi);
  const b: number = contrastRatio(p.accent, p.surfaceHi);
  console.log(`      ${theme.padEnd(10)} textSecondary=${a.toFixed(4)}${a < AA_TEXT ? ' !' : '  '}` +
    `  accent=${b.toFixed(4)}${b < AA_TEXT ? ' !' : '  '}`);
  if (a < AA_TEXT) {
    ok(`[${theme}] textSecondary × surfaceHi 缺口（${a.toFixed(3)} < 4.5）已登记台账`,
      ledger.indexOf(`${theme}|textSecondary|surfaceHi`) >= 0);
  }
  if (b < AA_TEXT) {
    ok(`[${theme}] accent × surfaceHi 缺口（${b.toFixed(3)} < 4.5）已登记台账`,
      ledger.indexOf(`${theme}|accent|surfaceHi`) >= 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §4 台账纪律：未登记缺口 ⇒ 红；陈旧条目（已修好）⇒ 红（只减不增）
// ════════════════════════════════════════════════════════════════════════════
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const fails: ContrastFailure[] = contrastFailures(theme);
  if (fails.length > 0) {
    for (let i = 0; i < fails.length; i++) {
      console.log(`      ✗ 未登记 ${fails[i].theme}|${fails[i].fg}|${fails[i].bg}=${fails[i].ratio.toFixed(4)}`);
    }
  }
  ok(`[${theme}] 台账之外无对比度缺口`, fails.length === 0, `got ${fails.length}`);
}
// 陈旧检测：每条台账 = 「当前确实不达标」的对（修好 ⇒ ratios≥min ⇒ 红 ⇒ 逼同步删台账）
for (let i = 0; i < ledger.length; i++) {
  const parts: string[] = ledger[i].split('|');
  const theme: string = parts[0];
  const fg: string = parts[1];
  const bg: string = parts[2];
  const all: ContrastResult[] = contrastAudit(theme);
  let hit: ContrastResult | undefined = undefined;
  for (let k = 0; k < all.length; k++) {
    if (all[k].fg === fg && all[k].bg === bg) { hit = all[k]; }
  }
  ok(`台账条目仍是不达标对（已修好 ⇒ 请删台账）：${ledger[i]}`,
    hit !== undefined && hit.ratio < hit.min,
    hit === undefined ? '该对不在矩阵里（台账与矩阵脱节）' : `ratio ${hit.ratio.toFixed(4)} ≥ min ${hit.min}`);
}
// 白名单冻结：条目集合变化（增/删）都必须**显式**改这里 ⇒ 否则红（防静默留缺口/静默放宽）
const EXPECTED_LEDGER: string[] = [
  'dark|accent|surfaceHi',
  'dark|onAccent|accent',
  'porcelain|accent|surfaceHi',
  'porcelain|textSecondary|surfaceHi',
];
ok('台账集合 = 已登记白名单（增/删都必须同步本清单 ⇒ 否则红）',
  JSON.stringify(ledger.slice().sort()) === JSON.stringify(EXPECTED_LEDGER.slice().sort()),
  `got ${JSON.stringify(ledger.slice().sort())}`);

console.log(`\n  porcelain_surfacehi_contrast: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
