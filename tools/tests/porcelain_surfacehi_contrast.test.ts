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

declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string): string[]; statSync(p: string): { isDirectory(): boolean } };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, Palette, THEME_PORCELAIN } from '../../entry/src/main/ets/core/theme';
import {
  colorOf, contrastReqs, contrastAudit, contrastFailures, knownContrastLedger,
  ansiTerminalExceptions, ansiRoleTextLeaks, AnsiTextException,
  AA_TEXT, AA_NON_TEXT, AA_MUTED, ContrastReq, ContrastResult, ContrastFailure,
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
ok('矩阵含 accent × surfaceHi（选中/高亮面上的强调色图形）', rAc !== undefined);
// 档位 = **role 类别（= 字号档）**：textSecondary 有 10–14 的**文字**落点 ⇒ AA_TEXT(4.5)；
// accent 是**非文本/图形** role（弧/环/点/图标）⇒ AA_NON_TEXT(3.0)。⛔ 两者都不是"为了让判据变绿"。
ok('textSecondary × surfaceHi 门槛 = AA_TEXT(4.5)（文字类）',
  rTs !== undefined && rTs.min === AA_TEXT,
  `textSecondary.min=${rTs !== undefined ? rTs.min : 'n/a'}`);
ok('accent × surfaceHi 门槛 = AA_NON_TEXT(3.0)（非文本类）',
  rAc !== undefined && rAc.min === AA_NON_TEXT,
  `accent.min=${rAc !== undefined ? rAc.min : 'n/a'}`);
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
//    MessageNav 的 `accent` 坐在 `withAlpha(accent, 0.10)` 上、非 surfaceHi）⇒ 该格按 accent 的
//    **非文本/图形**类别取 `AA_NON_TEXT`(3.0) ⇒ 各主题均达标。
//    ⚠️ 但 `accent` **另有** normal 字号（10–14）**文字**落点（ANSI 终端文本
//    `SyntheticCard.ets:248/260`、`ToolVisual.ets:115`；`MessageNav.ets:121-129` 序号）—— 那是
//    **跨类把图形 role 当文字用** ⇒ 属**落点侧**缺陷，列"落点修复清单"（⛔ 不靠抬 role 档位兜）。
const por: Palette = paletteOf(THEME_PORCELAIN);
const porTs: number = contrastRatio(por.textSecondary, por.surfaceHi);
const porAc: number = contrastRatio(por.accent, por.surfaceHi);
ok('复核审计数：porcelain textSecondary × surfaceHi ≈ 4.337', Math.abs(porTs - 4.3374) < 0.001, `got ${porTs.toFixed(4)}`);
ok('复核审计数：porcelain accent × surfaceHi ≈ 4.017', Math.abs(porAc - 4.0170) < 0.001, `got ${porAc.toFixed(4)}`);

const ledger: string[] = knownContrastLedger();
console.log('  · surfaceHi 组合实算（textSecondary 档 4.5 / accent 档 3.0）：');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const a: number = contrastRatio(p.textSecondary, p.surfaceHi);
  const b: number = contrastRatio(p.accent, p.surfaceHi);
  console.log(`      ${theme.padEnd(10)} textSecondary=${a.toFixed(4)}${a < AA_TEXT ? ' !' : '  '}` +
    `  accent=${b.toFixed(4)}${b < AA_NON_TEXT ? ' !' : '  '}`);
  if (a < AA_TEXT) {
    ok(`[${theme}] textSecondary × surfaceHi 缺口（${a.toFixed(3)} < 4.5）已登记台账`,
      ledger.indexOf(`${theme}|textSecondary|surfaceHi`) >= 0);
  }
  ok(`[${theme}] accent × surfaceHi ≥ 3.0（非文本类，⛔ 不误判为文字）`, b >= AA_NON_TEXT, `got ${b.toFixed(4)}`);
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
  'dark|onAccent|accent',
  'porcelain|textSecondary|surfaceHi',
];
ok('台账集合 = 已登记白名单（增/删都必须同步本清单 ⇒ 否则红）',
  JSON.stringify(ledger.slice().sort()) === JSON.stringify(EXPECTED_LEDGER.slice().sort()),
  `got ${JSON.stringify(ledger.slice().sort())}`);

// ════════════════════════════════════════════════════════════════════════════
// §5 阈值来源 = **字号档**（裁决 1）—— 把"为什么 4.5 / 3.0"钉死 ⇒ 改错阈值必红
// ════════════════════════════════════════════════════════════════════════════
// 规则：有 **normal 字号（<18.66px）文字落点** ⇒ `AA_TEXT`(4.5)；只有**非文本/图形**落点 ⇒ `AA_NON_TEXT`(3.0)；
//       `textMuted` 的**非交互元信息**档 ⇒ `AA_MUTED`(2.0)（⛔ 不外扩）。
// （large text 在本仓不构成第三档：排版阶梯里只有 type.display(28)/type.title(21 bold) 达 large，
//   没有任何 role 只出现在 large 档 —— 见 `core/design.ets` 的 `AA_TEXT` 注释与 `docs/DESIGN-SYSTEM.md §15`。）
ok('零扫描判红：contrastReqs() 被取到（三方阈值来源之一）', reqs.length > 0);
function reqMin(fg: string, bg: string): number {
  const r: ContrastReq | undefined = findReq(reqs, fg, bg);
  return r !== undefined ? r.min : -1;
}
// ── 文字类（有 normal 字号落点）⇒ AA_TEXT ──────────────────────────────────
ok('contrastReqs: textSecondary|surface = 4.5（文字）', reqMin('textSecondary', 'surface') === AA_TEXT, `got ${reqMin('textSecondary', 'surface')}`);
ok('contrastReqs: textSecondary|surfaceHi = 4.5（文字）', reqMin('textSecondary', 'surfaceHi') === AA_TEXT, `got ${reqMin('textSecondary', 'surfaceHi')}`);
ok('contrastReqs: accentSoft|surface = 4.5（链接/可点文字）', reqMin('accentSoft', 'surface') === AA_TEXT, `got ${reqMin('accentSoft', 'surface')}`);
ok('contrastReqs: dangerText|surface = 4.5（失败文字）', reqMin('dangerText', 'surface') === AA_TEXT, `got ${reqMin('dangerText', 'surface')}`);
ok('contrastReqs: successText|surface = 4.5（成功文字）', reqMin('successText', 'surface') === AA_TEXT, `got ${reqMin('successText', 'surface')}`);
ok('contrastReqs: warn|surface = 4.5（警告文字）', reqMin('warn', 'surface') === AA_TEXT, `got ${reqMin('warn', 'surface')}`);
ok('contrastReqs: dangerOnFill|dangerBg = 4.5（实心底上的**文字**，原误用 3.0）', reqMin('dangerOnFill', 'dangerBg') === AA_TEXT, `got ${reqMin('dangerOnFill', 'dangerBg')}`);
ok('contrastReqs: warnOnFill|warnBg = 4.5（同上）', reqMin('warnOnFill', 'warnBg') === AA_TEXT, `got ${reqMin('warnOnFill', 'warnBg')}`);
// ── 非文本/图形类 ⇒ AA_NON_TEXT ───────────────────────────────────────────
ok('contrastReqs: iconMuted|appBg = 3.0（非文本图标）', reqMin('iconMuted', 'appBg') === AA_NON_TEXT, `got ${reqMin('iconMuted', 'appBg')}`);
ok('contrastReqs: accent|surfaceHi = 3.0（非文本图形）', reqMin('accent', 'surfaceHi') === AA_NON_TEXT, `got ${reqMin('accent', 'surfaceHi')}`);
ok('contrastReqs: accentSoft|surfaceAlt = 3.0（在飞标记，非文本）', reqMin('accentSoft', 'surfaceAlt') === AA_NON_TEXT, `got ${reqMin('accentSoft', 'surfaceAlt')}`);
// ── 元信息专用档 ─────────────────────────────────────────────────────────
ok('contrastReqs: textMuted|surface = 2.0（非交互元信息）', reqMin('textMuted', 'surface') === AA_MUTED, `got ${reqMin('textMuted', 'surface')}`);
ok('常量值本身：4.5 / 3.0 / 2.0', AA_TEXT === 4.5 && AA_NON_TEXT === 3.0 && AA_MUTED === 2.0);
// ── 另两个判据的档位（**形态**路：读源文件，改回旧档 ⇒ 必红）──────────────
const tcSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(repoRoot, 'tools', 'tests', 'theme_contrast.test.ts'), 'utf-8'));
const rsmSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(repoRoot, 'tools', 'tests', 'role_surface_matrix.test.ts'), 'utf-8'));
ok('零扫描判红：两个判据源都被读到', tcSrc.length > 0 && rsmSrc.length > 0);
const TC_TEXT_ROLES: string[] = ['textPrimary', 'textSecondary', 'accentSoft', 'dangerText', 'successText', 'warn'];
for (let i = 0; i < TC_TEXT_ROLES.length; i++) {
  ok(`形态：theme_contrast 的 CANVAS_ROLES 把 ${TC_TEXT_ROLES[i]} 钉在 T_BODY（文字类）`,
    tcSrc.indexOf(`{ fg: '${TC_TEXT_ROLES[i]}', tier: T_BODY }`) >= 0);
}
const TC_GRAPHIC_ROLES: string[] = ['accent', 'statusError', 'statusRunning'];
for (let i = 0; i < TC_GRAPHIC_ROLES.length; i++) {
  ok(`形态：theme_contrast 的 CANVAS_ROLES 把 ${TC_GRAPHIC_ROLES[i]} 留 T_SECOND（非文本类）`,
    tcSrc.indexOf(`{ fg: '${TC_GRAPHIC_ROLES[i]}', tier: T_SECOND }`) >= 0);
}
// ⛔ 反向：这些"文字类"role **不得**再被写回 T_SECOND（若写回 ⇒ 红）
for (let i = 0; i < TC_TEXT_ROLES.length; i++) {
  if (TC_TEXT_ROLES[i] === 'textPrimary') { continue; }
  ok(`反向：theme_contrast 里 ${TC_TEXT_ROLES[i]} **不再**是 T_SECOND`,
    tcSrc.indexOf(`{ fg: '${TC_TEXT_ROLES[i]}', tier: T_SECOND }`) < 0);
}
ok('形态：role_surface_matrix 把 accentSoft 钉在 AA_TEXT（文字类）', rsmSrc.indexOf("mk('accentSoft', AA_TEXT,") >= 0);
ok('形态：role_surface_matrix 把 warn 钉在 AA_TEXT（文字类）', rsmSrc.indexOf("mk('warn', AA_TEXT,") >= 0);
ok('反向：role_surface_matrix 里 accentSoft **不再**是 AA_NON_TEXT', rsmSrc.indexOf("mk('accentSoft', AA_NON_TEXT,") < 0);
ok('反向：role_surface_matrix 里 warn **不再**是 AA_NON_TEXT', rsmSrc.indexOf("mk('warn', AA_NON_TEXT,") < 0);

// ════════════════════════════════════════════════════════════════════════════
// §6 「ANSI 终端语义色」例外（裁决 2）—— 登记 + 边界 + 零扫描（mutation 锚见 §6.3）
// ════════════════════════════════════════════════════════════════════════════
// 裁决：`accent` / `statusError` / `statusRunning` 的**文字**落点在 ANSI **终端输出**，
//   其色相与 web 权威（`noties_prism4j` / 标准 xterm 色板）一致 ⇒ **登记为例外**，
//   ⛔ 不放宽 `AA_TEXT` 本身、⛔ 不把三者接成"文字类"。
// 边界：① 例外清单**只许缩短**；② 这三个 role **只许**出现在 ANSI/终端 或 **图形**落点。
const EXC: AnsiTextException[] = ansiTerminalExceptions();
const excRoles: string[] = EXC.map((e: AnsiTextException) => e.role).sort();
const EXC_EXPECT: string[] = ['accent', 'statusError', 'statusRunning'].sort();
ok('§6.1 例外 role 集合 = {accent,statusError,statusRunning}（只许缩短 ⇒ 改则红）',
  JSON.stringify(excRoles) === JSON.stringify(EXC_EXPECT), `got ${JSON.stringify(excRoles)}`);
for (let i = 0; i < EXC.length; i++) {
  const e: AnsiTextException = EXC[i];
  ok(`§6.1 例外 ${e.role} 有 ANSI 槽位证据`, e.ansiSlot.length > 0);
  ok(`§6.1 例外 ${e.role} 有终端落点 file:line`, e.terminals.length > 0);
  ok(`§6.1 例外 ${e.role} 有字号证据`, e.sizes.length > 0);
  ok(`§6.1 例外 ${e.role} 有实算比值证据`, e.ratios.length > 0);
  // ⛔ 不许接成"文字类"：这三个 role 不得在 contrastReqs() 里以 AA_TEXT 出现
  let asText = 0;
  for (let k = 0; k < reqs.length; k++) { if (reqs[k].fg === e.role && reqs[k].min === AA_TEXT) { asText++; } }
  ok(`§6.1 ⛔ ${e.role} 在 contrastReqs() 里**不以 AA_TEXT 出现**（不许接成文字类）`, asText === 0, `got ${asText}`);
}
// 终端是**受认可**的文字通道：`core/ansi.ets` 的槽表必须含这三者（否则例外无据）
const ansiSrc: string = stripSrc(fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'ansi.ets'), 'utf-8'));
for (let i = 0; i < EXC_EXPECT.length; i++) {
  ok(`§6.1 core/ansi.ets 的 ANSI_COLOR_ROLES 含 '${EXC_EXPECT[i]}'（终端是受认可通道）`,
    ansiSrc.indexOf(`'${EXC_EXPECT[i]}'`) >= 0);
}

// ── §6.2 边界扫描：这三个 role 的**非终端直接文字用法** ⊆ `ansiRoleTextLeaks()`（只许缩短）──
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');
function walkEts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[] = [];
    try { entries = fsMod.readdirSync(d); } catch (ee) { return; }
    for (let i = 0; i < entries.length; i++) {
      const full: string = pathMod.join(d, entries[i]);
      let st: { isDirectory(): boolean } | null = null;
      try { st = fsMod.statSync(full); } catch (ee2) { st = null; }
      if (st === null) { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (full.slice(full.length - 4) === '.ets') { out.push(full); }
    }
  };
  walk(dir);
  return out;
}
/** 直接（非 ANSI）的**文字**用法：`.fontColor(` 行引用这三个 role，且最近的前导 widget 是 Text/Span。 */
function textLeaks(): string[] {
  const files: string[] = walkEts(pathMod.join(etsRoot, 'components')).concat(walkEts(pathMod.join(etsRoot, 'pages')));
  const extra: string = process.env.XBOT_SCAN_EXTRA !== undefined ? (process.env.XBOT_SCAN_EXTRA as string) : '';
  const extras: string[] = extra.length > 0 ? extra.split(':') : [];
  for (let i = 0; i < extras.length; i++) { if (extras[i].length > 0) { files.push(extras[i]); } }
  const reRole: RegExp = /pal\(\)\.(accent|statusError|statusRunning)\b|'(accent|statusError|statusRunning)'/;
  const reWidget: RegExp = /\b(Text|Span|SymbolGlyph|Progress|LoadingProgress)\s*\(/;
  const out: string[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    const f: string = files[fi];
    let lines: string[] = [];
    try { lines = fsMod.readFileSync(f, 'utf-8').split('\n'); } catch (ee) { continue; }
    for (let i = 0; i < lines.length; i++) {
      const ln: string = lines[i];
      if (ln.indexOf('.fontColor(') < 0) { continue; }
      if (!reRole.test(ln)) { continue; }
      if (ln.indexOf('ansiFgOf') >= 0) { continue; }   // ANSI 通道 = 例外本体，放行
      let kind: string = 'graphic';
      for (let j = i; j >= Math.max(0, i - 12); j--) {
        const m: RegExpMatchArray | null = lines[j].match(reWidget);
        if (m !== null) { kind = (m[1] === 'Text' || m[1] === 'Span') ? 'text' : 'graphic'; break; }
      }
      if (kind !== 'text') { continue; }               // 图形（SymbolGlyph/Progress/图标）不经此处
      const relPath: string = f.indexOf(etsRoot) === 0 ? f.slice(etsRoot.length + 1) : f;
      out.push(`${relPath}:${i + 1}`);
    }
  }
  return out.sort();
}
const leaks: string[] = textLeaks();
const KNOWN_LEAKS: string[] = ansiRoleTextLeaks().slice().sort();
ok('§6.2 零扫描判红：边界扫描确实扫到组件/页面源码（>0 文件）',
  walkEts(pathMod.join(etsRoot, 'components')).length > 0 && walkEts(pathMod.join(etsRoot, 'pages')).length > 0);
ok('§6.2 零扫描判红：已知越界清单非空（否则本判据会白绿）', KNOWN_LEAKS.length > 0, `got ${KNOWN_LEAKS.length}`);
ok('§6.2 非终端直接文字用法 == 已知越界清单（新增 ⇒ 红；修好 ⇒ 红 ⇒ 逼缩清单）',
  JSON.stringify(leaks) === JSON.stringify(KNOWN_LEAKS),
  `got ${JSON.stringify(leaks)}`);
console.log('  · §6.2 已知越界（非终端 accent 文字，⛔ 只许缩短；修法 = 换 accentSoft）:');
for (let i = 0; i < leaks.length; i++) { console.log(`      ${leaks[i]}`); }

console.log(`\n  porcelain_surfacehi_contrast: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
