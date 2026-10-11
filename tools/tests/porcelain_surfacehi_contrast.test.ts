/**
 * porcelain `surfaceHi` 组合对比度判据（目标⑤ · 2026-10-11）。
 *
 * ── 为什么需要它（不是"再造一套矩阵"）─────────────────────────────────────────────
 * `porcelain-audit` ⚠️-3 实测：`contrastReqs()`（`core/design.ets`）此前**只**把 `surfaceHi`
 * 当作 `textPrimary` 的底 ⇒ 「选中 pill / 高亮行 / 悬停行（= `surface.active` /
 * `surface.pillSelected` / `surface.overlayRowHover`，`RUNG_ACTIVE` = `surfaceHi`）上的**次要文字**
 * 与**强调色图形/文字**」**没有任何判定**。审计当时**未逐一 grep 消费点**，只记为"护栏"。
 *
 * 本判据补这些（口径 = 仓内已批准常量，⛔ 不放宽）：
 *   §1 把 `surfaceHi` 纳入 `textSecondary` / `accent` 的**下限断言**（矩阵形态 + 零扫描判红）；
 *   §2 钉住 ⚠️-4：`colorOf` 必须覆盖 6 个此前只能 `pal()` 直取的角色（**形态 + 逐主题取值**）；
 *   §3 **核实真实落点**并给 `file:line` 证据 + **逐主题实算比值**（含 L1–L4 的**现状**：1–3 已换底、4 是图标）；
 *   §4 台账纪律：不达标格**必须已登记**（未登记 ⇒ 红）、台账条目**必须仍是不达标对**（修好 ⇒ 陈旧 ⇒ 红）；
 *   §5 阈值来源 = **字号档**（文字 4.5 / 非文本 3.0 / 元信息 2.0）逐格钉死；
 *   §6 「ANSI 终端语义色」**例外**（裁决 2）+ 边界扫描 + 越界台账；
 *   §7 **别名家族**：`surfaceHi` 的同 rung 别名必须全部 ≡ `p.surfaceHi`（从 `surfaceRoles()` **派生**，
 *       ⛔ 不硬编面名 —— 这是"按名搜面必漏"教训的机器防线）。
 *
 * ★ mutation 自证（交付回报含原文）：
 *   ① 删 `contrastReqs()` 里 `('textSecondary','surfaceHi',…)` 一行 ⇒ §1 必红；
 *   ② 删 `colorOf()` 里任一新增 `if (role === 'x')` ⇒ §2 必红（形态 + 取值双路）；
 *   ③ 非终端落点注入 `accent` 当文字 ⇒ §6 必红；④ 删例外登记一条 ⇒ §6 必红；
 *   ⑤ 把 `surface.pillSelected` 的 rung 改成 `RUNG_RAISED` ⇒ §7 必红（别名家族被拆散）。
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
  surfaceAliasesOf, surfaceRoles, surfaceFillOf,
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
// 真实落点（`textSecondary` 坐在 `surfaceHi` 面 / 其**别名**面上）—— 审计当时**未**逐一 grep，本处查实。
// ⚠️ **现状（2026-10-11，两批均已清）**：
//   · **第一批（`8fbe8d2`，直接 `pal().surfaceHi`）—— 已修（换底）**：
//       L1 `components/LiveTailView.ets`  `OverflowBadge`「+N」：展开态底 → `surface.raised`（porcelain 4.696 ✓）
//       L2 `components/MessageRow.ets`     `OverflowBadge`「+N」：展开态底 → `surface.card`（porcelain 5.071 ✓）
//       L3 `components/SettingsLlm.ets`    「取消」容器底 → `surface.raised`（porcelain 4.696 ✓）
//       L4 `pages/Index.ets` 运行中发送键：前景是 **`SymbolGlyph` 图标（非文字）** ⇒ `AA_NON_TEXT`(3.0)
//          ⇒ porcelain 4.337 ≥ 3.0 **本就达标、非缺陷、不改**（`contrast_landing.test.ts §5` 钉死）。
//   · **第二批（`3f3e7d1`，别名掩盖）—— 已清**：
//       `'surface.overlayRowHover'` / `'surface.pillSelected'` / `'surface.active'` **同属 `RUNG_ACTIVE`
//       ≡ `surfaceHi`**（同一底色、不同名字）⇒ **只按字面量 `'surfaceHi'` 搜会漏**。曾漏 3 处**文字**落点
//       （坐在 `surface.overlayRowHover` 底上），修法：`pages/Index.ets:6626`（'取消'）/:6687（'⋯'）
//       **只换"当前会话"支的 fg** → `textPrimary`（⛔ 不换底 ⇒ 保住"当前会话"的强调）；
//       `components/AskUserSheet.ets:202`（`type.callout` = `textSecondary`）**整条梯子下移一档**
//       （选中 `surface.overlayRow` / 未选中 `surface.overlay`）。
//       ⇒ **结构性教训（仍成立）**：凡"按面名搜落点"必须**展开别名** —— 已固化成 `surfaceAliasesOf()`
//         （`core/design.ets`，**从 `surfaceRoles()` 派生**）+ 本文件 §7 + `tools/tests/surface_alias.test.ts`。
// ⚠️ **矩阵层不受影响**：`contrastReqs()` 的 `textSecondary × surfaceHi` 仍是 **4.3374 < 4.5**
//    ⇒ `knownContrastLedger()` 那条**保留**（它与"落点是否修好"无关，见 `theme_contrast` 台账注释）。
// ⚠️ `accent` 坐在 `surfaceHi` 上：**未找到**真实落点（已 grep `pal().accent` 全部前景用法；
//    MessageNav 的 `accent` 坐在 `withAlpha(accent, 0.10)` 上、非 surfaceHi）⇒ 该格按 accent 的
//    **非文本/图形**类别取 `AA_NON_TEXT`(3.0) ⇒ 各主题均达标。
//    ⚠️ 但 `accent` **另有** normal 字号（10–14）**文字**落点（ANSI 终端文本
//    `SyntheticCard.ets:248/260`、`ToolVisual.ets:115`；`MessageNav.ets:121-129` 序号）—— 那是
//    **跨类把图形 role 当文字用** ⇒ 属**落点侧**缺陷，已作 §6 例外 + 越界台账（⛔ 不靠抬 role 档位兜）。
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
  'dark|iconMuted|surfaceHi',
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
/** 扫描活性自证：走过的文件数 + 见到的 `.fontColor(` 行数（防"扫描器与真源脱节 ⇒ 白绿"）。 */
function scanLiveness(): number[] {
  const files: string[] = walkEts(pathMod.join(etsRoot, 'components')).concat(walkEts(pathMod.join(etsRoot, 'pages')));
  let n: number = 0;
  for (let fi = 0; fi < files.length; fi++) {
    let lines: string[] = [];
    try { lines = fsMod.readFileSync(files[fi], 'utf-8').split('\n'); } catch (ee) { continue; }
    for (let i = 0; i < lines.length; i++) { if (lines[i].indexOf('.fontColor(') >= 0) { n++; } }
  }
  return [files.length, n];
}
const LIVE: number[] = scanLiveness();
ok('§6.2 零扫描判红：扫描确实走过组件/页面源码（文件 >0）', LIVE[0] > 0, `files=${LIVE[0]}`);
ok('§6.2 零扫描判红：扫描确实见到 `.fontColor(` 行（>0 ⇒ 扫描器与真源相连）', LIVE[1] > 0, `fontColor lines=${LIVE[1]}`);
ok('§6.2 非终端直接文字用法 == 已知越界清单（新增 ⇒ 红；修好 ⇒ 红 ⇒ 逼缩清单）',
  JSON.stringify(leaks) === JSON.stringify(KNOWN_LEAKS),
  `got ${JSON.stringify(leaks)}`);
console.log('  · §6.2 已知越界（非终端 accent 文字，⛔ 只许缩短；修法 = 换 accentSoft）:');
for (let i = 0; i < leaks.length; i++) { console.log(`      ${leaks[i]}`); }

// ════════════════════════════════════════════════════════════════════════════
// §7 别名家族：`RUNG_ACTIVE` 的面（= `p.surfaceHi` 的别名）必须全部 ≡ `p.surfaceHi`
// ════════════════════════════════════════════════════════════════════════════
// 结构性教训（`contrast-landing` 复核）：**按面名搜落点必须能展开别名**，否则永远漏 ——
//   `surface.active` / `surface.pillSelected` / `surface.overlayRowHover` 与 `surfaceHi`
//   **同属 `RUNG_ACTIVE`** ⇒ **同一底色、不同名字**（实测漏掉 3 处坐在别名底上的文字落点）。
// ⚠️ `surfaceHi` 是 **Palette 字段名**（不是面角色名）⇒ 家族要**从一个真实角色名派生**。
// ⇒ 本节的家族**从 `surfaceRoles()` 派生**（`surfaceAliasesOf`），⛔ 不硬编面名字面量。
const ACTIVE_ALIASES: string[] = surfaceAliasesOf('surface.active').slice().sort();
const EXPECT_ALIASES: string[] = ['surface.active', 'surface.overlayRowHover', 'surface.pillSelected'].sort();
ok('§7 零扫描判红：别名家族可从真源派生且非空', ACTIVE_ALIASES.length > 0, `got ${ACTIVE_ALIASES.length}`);
ok('§7 零扫描判红：面表非空（= 别名的派生来源）', surfaceRoles().length >= 10, `got ${surfaceRoles().length}`);
ok('§7 RUNG_ACTIVE 别名家族冻结 = {surface.active, surface.overlayRowHover, surface.pillSelected}',
  JSON.stringify(ACTIVE_ALIASES) === JSON.stringify(EXPECT_ALIASES), `got ${JSON.stringify(ACTIVE_ALIASES)}`);
// ★ 家族每一项 × 每一主题 都**逐字节** = `p.surfaceHi`（"别名 = 同一 rung ⇒ 同一底色"的机器形式）
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
    ok(`§7 [${theme}] surfaceFillOf('${ACTIVE_ALIASES[i]}') ≡ p.surfaceHi（别名 = 同一 rung）`,
      surfaceFillOf(p, ACTIVE_ALIASES[i]) === p.surfaceHi,
      `got ${surfaceFillOf(p, ACTIVE_ALIASES[i])} want ${p.surfaceHi}`);
  }
}
// 反面：**不同 rung** 的面不得混进家族（否则"别名"无从谈"同一底色"）
const NON_ACTIVE: string[] = ['surface.card', 'surface.overlay', 'surface.raised', 'surface.overlayRow',
  'surface.pill', 'surface.chip', 'surface.well', 'surface.input', 'surface.canvas'];
for (let i = 0; i < NON_ACTIVE.length; i++) {
  ok(`§7 反面：${NON_ACTIVE[i]}（不同 rung）不在 RUNG_ACTIVE 别名家族里`,
    ACTIVE_ALIASES.indexOf(NON_ACTIVE[i]) < 0);
}
// 反向自证锚：家族成员必须**真解析到 surfaceHi**（防"家族名拼错 ⇒ 静默回落 card"）
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const p: Palette = paletteOf(ALL_THEMES[ti]);
  for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
    ok(`§7 反向锚：[${ALL_THEMES[ti]}] '${ACTIVE_ALIASES[i]}' 解析值 ≠ card 的 surface（未回落）`,
      surfaceFillOf(p, ACTIVE_ALIASES[i]) !== p.surface,
      `got ${surfaceFillOf(p, ACTIVE_ALIASES[i])}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §8 ⭐ 星标图标地面：`iconMuted` 压 `RUNG_ACTIVE` 面（= `surfaceHi`）
// ════════════════════════════════════════════════════════════════════════════
// 落点（唯一，实测）：`pages/Index.ets:6692` —— 会话行**星标**（`SymbolGlyph`，未收藏支 = `iconMuted`），
//   底 = `surface.overlayRowHover`（= `RUNG_ACTIVE` = `surfaceHi`），**仅"当前会话"那一行的状态**。
// ⚠️ **订正**：常被误记成"深色三主题都不足 3.0"——那是把 **`dark` 的 `textMuted`** 拿去压
//   aurora/nebula 的 `surfaceHi`（跨主题错配）。按 `iconMutedOf` 的正确取值，**只有 dark 缺**。
const STAR_LANDING: string = 'pages/Index.ets:6692';
const rIm: ContrastReq | undefined = findReq(reqs, 'iconMuted', 'surfaceHi');
ok('§8 矩阵含 iconMuted × surfaceHi（RUNG_ACTIVE 面；零扫描判红）', rIm !== undefined);
ok('§8 其门槛 = AA_NON_TEXT(3.0)（图标 = 非文本地板，⛔ 不放宽到 2.x）',
  rIm !== undefined && rIm.min === AA_NON_TEXT,
  `got ${rIm !== undefined ? rIm.min : 'n/a'}`);
// `surfaceHi` 确为 RUNG_ACTIVE 别名族的填充（与 §7 同源；⛔ 不硬编面名）
ok('§8 RUNG_ACTIVE 别名族非空（该面确由别名族承载）', surfaceAliasesOf('surface.active').length > 0);
const REGISTERED_STAR: string = 'dark';   // 唯一已登记主题（见 `knownContrastLedger`）
const STAR_RATIO_PIN: number = 2.8164;    // 钉死数值：只许变好，⛔ 不许静默变差
console.log(`  · §8 ${STAR_LANDING} 的 iconMuted 压 RUNG_ACTIVE 面，逐主题实算（地板 3.0）：`);
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const r: number = contrastRatio(colorOf(p, 'iconMuted'), p.surfaceHi);
  const bad: boolean = r < AA_NON_TEXT;
  console.log(`      ${theme.padEnd(10)} iconMuted=${colorOf(p, 'iconMuted')} ${r.toFixed(4)}${bad ? ' !' : '  '}`);
  if (theme === REGISTERED_STAR) {
    // 已登记主题：**必须仍不达标**（修好 ⇒ 陈旧 ⇒ 红）+ **数值钉死**（只许变好）
    ok(`§8 [${theme}] 是已登记缺口（>3.0 ⇒ 陈旧 ⇒ 请收缩台账）`, bad, `got ${r.toFixed(4)}`);
    ok(`§8 [${theme}] 缺口数值钉死 ≈ ${STAR_RATIO_PIN}（⛔ 不许静默恶化；变好 ⇒ 同步订正）`,
      Math.abs(r - STAR_RATIO_PIN) < 0.002, `got ${r.toFixed(4)}`);
  } else {
    ok(`§8 [${theme}] iconMuted 压 RUNG_ACTIVE 面 ≥ ${AA_NON_TEXT}（未登记 ⇒ 必须达标）`,
      !bad, `got ${r.toFixed(4)}`);
  }
}
ok('§8 落点被登记（台账含 dark|iconMuted|surfaceHi ⇒ 交主 agent 派线修）',
  ledger.indexOf('dark|iconMuted|surfaceHi') >= 0);
// 落点存在性锚（**内容锚，⛔ 不按行号** —— `pages/Index.ets` 常被其他线编辑，行号会漂）：
const idxSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(etsRoot, 'pages', 'Index.ets'), 'utf-8'));
//   ⚠️ 无论哪种，**台账行 `dark|iconMuted|surfaceHi` 都保留** —— 它记录的是「**role × 面**的能力缺口」
//     （`iconMuted`(dark) 在 `surfaceHi` 上只有 2.816），**不是**某个落点；落点换 fg 不会让它陈旧。
const STAR_STILL_MUTED: string = "isStarredChat(s.chat_id) ? this.pal().accent : colorOf(this.pal(), 'iconMuted')";
const STAR_FIXED: string = "isStarredChat(s.chat_id) ? this.pal().accent : this.pal().textSecondary";
const starMuted: boolean = idxSrc.indexOf(STAR_STILL_MUTED) >= 0;
const starFixed: boolean = idxSrc.indexOf(STAR_FIXED) >= 0;
ok('§8 落点存活锚：星标未收藏支 ∈ {仍用 iconMuted（登记项活着）, 已换 textSecondary（落点已修）}',
  starMuted || starFixed, `neither found（落点被重写 ⇒ 请同步本段）`);
console.log(`      · §8 星标落点现状：${starMuted ? '仍用 iconMuted（欠账活着）' : (starFixed ? '已换 textSecondary（落点已修）' : '未识别')}`);

// ════════════════════════════════════════════════════════════════════════════
// §9 「加载中…」的层级：**web 权威 = `text-muted`**（元信息档）
// ════════════════════════════════════════════════════════════════════════════
// web 取证（只读 `/Users/bobli/src/xbot/web`）：同句一律走 `text-text-muted` ——
//   · `src/pages/SharePage.tsx:111`  `<div className="p-8 text-center text-sm text-text-muted">加载中…</div>`
//   · `src/plugins/ssh-runner/index.tsx:1565` / `:1759`  `text-[10px] text-text-muted`
//   · `src/plugins/git-fancy/index.tsx:248` / `:415`、`commit.tsx:60`  `text-xs text-text-muted`
//   token 定义：`src/index.css:163`（浅 `--text-muted:#999999`）/ `:269`（深 `#6b6b6b`）
//             + `:397` `--color-text-muted: var(--text-muted)` ⇒ 原生对应 role = **`textMuted`**。
// ⇒ 本仓「加载中…」**必须走 `textMuted`**（⛔ 不因主题变档）。
// ✅ **2026-10-11 已清零**：唯一偏离 `SettingsAbout.ets`（曾用 `secondaryText()` ⇒ 浅色族变
//   `textSecondary`）已按 web 口径改用 `this.pal().textMuted` ⇒ 8 处全部一致。
// 形态判据（源码扫；⛔ 不硬编行号，按 `Settings*.ets` 全扫 + 文案锚）：
const KNOWN_LOADING_LEVEL_EXCEPTIONS: string[] = [];   // ⛔ 只许为空；若再出现偏离 ⇒ 显式登记（勿静默）
function settingsFiles(): string[] {
  const dir: string = pathMod.join(etsRoot, 'components');
  const all: string[] = [];
  const entries: string[] = fsMod.readdirSync(dir);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].indexOf('Settings') === 0 && entries[i].slice(-4) === '.ets') { all.push(entries[i]); }
  }
  return all;
}
function scanLoadingLevels(): string[] {   // 返回 `文件|fontColor 实参 role 表达式`
  const out: string[] = [];
  // ⚠️ 定向正则：`this.pal().textMuted` / `this.secondaryText()` / `colorOf(...)`
  //    （⛔ 不能用 `.fontColor\(([^)]*)\)` —— 会被 `this.pal()` 的内层 `)` 截断）
  const re: RegExp = /\.fontColor\(\s*\[?\s*(this\.pal\(\)\.[A-Za-z0-9_]+|this\.[A-Za-z0-9_]+\(\)|colorOf\([^\]]*\))/;
  // ⚠️ 窗口要**够宽**（元素链里可插注释 ⇒ 实测 `.fontColor` 可离文案 5–6 行），
  //   且**遇到下一个 widget 就停**（防跨元素误取）。
  const reNextWidget: RegExp = /^\s*(Text|Span|SymbolGlyph|Button|Column|Row|Image|Stack)\s*\(/;
  const hit = (lines: string[], i: number): string => {
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 10); j++) {
      const m: RegExpMatchArray | null = lines[j].match(re);
      if (m !== null) { return m[1].trim(); }
      if (reNextWidget.test(lines[j])) { return ''; }
    }
    return '';
  };
  const names: string[] = settingsFiles();
  for (let n = 0; n < names.length; n++) {
    const rel: string = `components/${names[n]}`;
    const lines: string[] = stripSrc(fsMod.readFileSync(pathMod.join(etsRoot, rel), 'utf-8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('加载中') < 0) { continue; }
      out.push(`${rel}|${hit(lines, i)}`);
    }
  }
  // 环境注入（mutation 自证用；⛔ 不碰仓内文件）
  const extra: string = process.env.XBOT_SCAN_EXTRA !== undefined ? (process.env.XBOT_SCAN_EXTRA as string) : '';
  if (extra.length > 0) {
    const xs: string[] = extra.split(':');
    for (let i = 0; i < xs.length; i++) {
      if (xs[i].length === 0) { continue; }
      const ls: string[] = fsMod.readFileSync(xs[i], 'utf-8').split('\n');
      for (let k = 0; k < ls.length; k++) {
        if (ls[k].indexOf('加载中') < 0) { continue; }
        out.push(`${xs[i]}|${hit(ls, k)}`);
      }
    }
  }
  return out;
}
const LOADING: string[] = scanLoadingLevels();
ok('§9 零扫描判红：扫到「加载中…」文案（>0 ⇒ 扫描器与真源相连）', LOADING.length > 0, `got ${LOADING.length}`);
console.log(`  · §9 「加载中…」层级实扫（web 权威 = textMuted）：`);
for (let i = 0; i < LOADING.length; i++) {
  const parts: string[] = LOADING[i].split('|');
  const file: string = parts[0];
  const arg: string = parts[1];
  const known: boolean = KNOWN_LOADING_LEVEL_EXCEPTIONS.indexOf(file) >= 0;
  console.log(`      ${file} → ${arg}${known ? '  [已知偏离，待修]' : ''}`);
  if (known) {
    ok(`§9 [${file}] 是**已登记偏离**（已改 textMuted ⇒ 请从白名单删除）`,
      arg.indexOf('textMuted') < 0, `got ${arg}`);
  } else {
    ok(`§9 [${file}] 走 web 口径 textMuted（⛔ 不因主题变档）`, arg === 'this.pal().textMuted', `got ${arg}`);
  }
}

console.log(`\n  porcelain_surfacehi_contrast: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
