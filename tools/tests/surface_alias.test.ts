/**
 * 「**语义别名**掩盖的对比度落点」判据（目标⑤ · 白主题「所有细节都做好」 · 2026-10-11 · `surface-alias` 线）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 * `design-matrix` 的落点排查只搜了**字面量** `pal().surfaceHi` ⇒ **漏掉**坐在**别名底**上的同类文字：
 *   `surface.active` / `surface.pillSelected` / `surface.overlayRowHover` 与 `surfaceHi`
 *   **同属 `RUNG_ACTIVE`** ⇒ **同一底色、不同名字**（`surfaceFillOf` 只按 rung 取色）。
 * ⇒ 本判据钉两件事：
 *   ① 检查清单**由别名表派生**（`surfaceAliasesOf` / 按色值等价从 `surfaceRoles()` 推导），⛔ 不硬编面名字面量；
 *   ② 三处真实落点 `file:line` 的**修法形态**（`Text` 前景 ⇒ AA_TEXT(4.5) 地板 + 换底/换支）+ mutation 锚。
 *
 * ── 三处落点（改前 → 改后，`file:line` 逐个实读复核）──────────────────────────────
 *   A `pages/Index.ets` 会话重命名行的「取消」
 *       改前 :6626 `Text('取消')…fontColor(textSecondary)`；底 = 会话行「当前会话」填充
 *                 `surfaceFillOf(p,'surface.overlayRowHover')`（= `surfaceHi`）
 *       改后 :6632 **当前会话支** fg → `textPrimary`（非当前会话仍 `textSecondary`；其底 = `transparent`）
 *   B `pages/Index.ets` 会话行的「⋯」
 *       改前 :6673 `Text('⋯')…fontColor(textSecondary)`（**`Text` 文字字形，⛔ 不是 `SymbolGlyph`**）
 *       改后 :6688 同款「当前会话支 → `textPrimary`」
 *   C `components/AskUserSheet.ets` 选中选项的 `opt.description`（`tc(p,'type.callout')` = textSecondary）
 *       改前 选中底 = `'surface.overlayRowHover'`（= `surfaceHi`）
 *       改后 选中底 = `'surface.overlayRow'`（RUNG_RAISED）、未选中 = `'surface.overlay'`（RUNG_CARD）
 *            ⇒ **「选中 = 面提升一档」保留**（CARD → RAISED），且 porcelain textSecondary ≥ 4.5
 *
 * ── 阈值口径（= `docs/DESIGN-SYSTEM.md §15` 的「字号档」）────────────────────────────
 *   文字（`Text`/`Span`，normal 字号 <18.66px）⇒ `AA_TEXT`(4.5)；非文本/图标（`SymbolGlyph`）⇒ 3.0。
 *   ⛔ 本判据**不动任何阈值**（只读 `AA_TEXT`/`AA_NON_TEXT`）。
 *
 * ★ mutation 自证（交付回报含原文）：
 *   ① A/B 支回退成**无条件** `fontColor(this.pal().textSecondary)` ⇒ §2/§3 必红；
 *   ② C 选中底回退成 `'surface.overlayRowHover'`（或家族任一成员）⇒ §4 必红；
 *   ③ 「按别名搜」的**判别力**自证见 §5（合成样本：家族每个成员都能被检出 ⇒ ⛔ 不是只认字面量）。
 */
export {};

declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, THEME_PORCELAIN, Palette } from '../../entry/src/main/ets/core/theme';
import {
  surfaceFillOf, surfaceRoles, surfaceAliasesOf, SurfaceRole, AA_TEXT, AA_NON_TEXT,
} from '../../entry/src/main/ets/core/design';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail.length > 0 ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');
function rel(p: string): string { return pathMod.join(etsRoot, p); }
/** 剥注释（仓内约定：注释里记 role/落点是允许且鼓励的 ⇒ 扫源码前必须剥）。保留换行不漂行号。 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}
function readStrip(p: string): string { return stripSrc(fsMod.readFileSync(rel(p), 'utf-8')); }

const A_PATH: string = 'pages/Index.ets';
const C_PATH: string = 'components/AskUserSheet.ets';
const aSrc: string = readStrip(A_PATH);
const cSrc: string = readStrip(C_PATH);

// ════════════════════════════════════════════════════════════════════════════
// §0 零扫描判红 —— 源码确实读到、且是"真源码"（不是空串/注释残渣）
// ════════════════════════════════════════════════════════════════════════════
ok('§0 零扫描判红：两个落点文件都被读到（非空）', aSrc.length > 0 && cSrc.length > 0,
  `len=${aSrc.length}/${cSrc.length}`);
ok('§0 零扫描判红：A/B 文件含会话列表锚点（drawerGroups / renamingId）',
  aSrc.indexOf('renamingId') >= 0 && aSrc.indexOf('currentChat') >= 0);
ok('§0 零扫描判红：C 文件含 AskUserSheet 选项锚点（onToggleOption / isSelected）',
  cSrc.indexOf('onToggleOption') >= 0 && cSrc.indexOf('isSelected') >= 0);
ok('§0 零扫描判红：C 文件含 `.fontColor(` 行（扫描器与真源相连）', cSrc.indexOf('.fontColor(') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §1 检查清单**由别名表派生**（⛔ 不硬编面名字面量）—— 本轮的结构性教训
// ════════════════════════════════════════════════════════════════════════════
// 派生路 ①：真源 `surfaceAliasesOf()`（从 `surfaceRoles()` 按 rung 派生）
const ACTIVE_ALIASES: string[] = surfaceAliasesOf('surface.active').slice().sort();
// 派生路 ②：**按色值等价**从面表推导 —— 与 ① 互相独立、必须一致（防"家族名拼错/漏项"）
function activeFamilyByColor(p: Palette): string[] {
  const roles: SurfaceRole[] = surfaceRoles();
  const out: string[] = [];
  for (let i = 0; i < roles.length; i++) {
    if (surfaceFillOf(p, roles[i].name) === p.surfaceHi) { out.push(roles[i].name); }
  }
  return out.sort();
}
const BY_COLOR: string[] = activeFamilyByColor(paletteOf(THEME_PORCELAIN));
ok('§1 零扫描判红：家族可从真源派生且非空', ACTIVE_ALIASES.length > 0, `got ${ACTIVE_ALIASES.length}`);
ok('§1 零扫描判红：面表非空（= 家族派生的来源）', surfaceRoles().length >= 10, `got ${surfaceRoles().length}`);
ok('§1 两条独立派生路一致（surfaceAliasesOf ≡ 按色值等价推导）',
  JSON.stringify(ACTIVE_ALIASES) === JSON.stringify(BY_COLOR),
  `aliasesOf=${JSON.stringify(ACTIVE_ALIASES)} byColor=${JSON.stringify(BY_COLOR)}`);
ok('§1 家族冻结 = {surface.active, surface.overlayRowHover, surface.pillSelected}（改 ⇒ 红）',
  JSON.stringify(ACTIVE_ALIASES) === JSON.stringify(['surface.active', 'surface.overlayRowHover', 'surface.pillSelected'].sort()),
  `got ${JSON.stringify(ACTIVE_ALIASES)}`);
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const t: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(t);
  for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
    eq(`§1 [${t}] surfaceFillOf('${ACTIVE_ALIASES[i]}') ≡ p.surfaceHi（别名 = 同一 rung）`,
      surfaceFillOf(p, ACTIVE_ALIASES[i]), p.surfaceHi);
  }
}
// 反面：非本 rung 的面不得混进家族（否则"按别名搜"会误伤）
const NON_ACTIVE: string[] = ['surface.raised', 'surface.overlayRow', 'surface.card', 'surface.overlay',
  'surface.pill', 'surface.chip', 'surface.well', 'surface.input', 'surface.canvas'];
for (let i = 0; i < NON_ACTIVE.length; i++) {
  ok(`§1 反面：${NON_ACTIVE[i]}（不同 rung）不在 RUNG_ACTIVE 家族`,
    ACTIVE_ALIASES.indexOf(NON_ACTIVE[i]) < 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §2 落点 A —— Index.ets 会话重命名行「取消」：当前会话支 fg 不再是 textSecondary
// ════════════════════════════════════════════════════════════════════════════
const A_NEW: string = '.fontColor(this.isCurrentSession(s.chat_id) ? this.pal().textPrimary : this.pal().textSecondary)';
// ① 形态：旧的无条件用法**已消失**（mutation 锚：回退成旧单行 ⇒ 本行红）
ok('§2 ⛔ 旧形态（`取消` 无条件 textSecondary 单行链）已消失',
  aSrc.indexOf("Text('取消').fontSize(typeOf('type.subhead').size).fontColor(this.pal().textSecondary)") < 0);
// ② 新形态存在：当前会话支 → textPrimary
ok('§2 ✓ 新形态：`取消` 的 fg = `isCurrentSession(s.chat_id) ? textPrimary : textSecondary`',
  aSrc.indexOf(A_NEW) >= 0);
// ③ 非当前会话仍走 textSecondary（弱化观感保留；其底 = `transparent` ⇒ 画布，达标）
ok('§2 ✓ 非当前会话支保留 `textSecondary`（弱化观感未丢）', A_NEW.indexOf(': this.pal().textSecondary') >= 0);
// ④ ⛔ **行底不许改**：当前会话的填充强调（porcelain 下唯一可见档）必须还在
ok("§2 ⛔ 会话行底仍是 `surface.overlayRowHover`（保留「当前会话」填充强调，不许换底）",
  aSrc.indexOf("this.chat_id === this.currentChat") >= 0 || aSrc.indexOf("s.chat_id === this.currentChat\n") >= 0
  || aSrc.indexOf("? surfaceFillOf(this.pal(), 'surface.overlayRowHover')") >= 0);
ok("§2 ✓ 会话行补 `surface.overlayRowHover` 的调用点仍在（未被误删）",
  aSrc.indexOf("surfaceFillOf(this.pal(), 'surface.overlayRowHover')") >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §3 落点 B —— Index.ets 会话行「⋯」：**文字**（不是图标）⇒ 4.5 地板 ⇒ 同款修法
// ════════════════════════════════════════════════════════════════════════════
{
  // 类型判定（本条的**关键**）：`⋯` 的最近前导 widget 必须是 `Text`/`Span`（⇒ 文字 ⇒ AA_TEXT）
  const lines: string[] = aSrc.split('\n');
  let ellLine: number = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("Text('⋯')") >= 0) { ellLine = i; break; }
  }
  ok('§3 零扫描判红：找到 `Text(\'⋯\')` 行', ellLine >= 0);
  let kind: string = 'none';
  for (let j = ellLine; j >= Math.max(0, ellLine - 12); j--) {
    const m: RegExpMatchArray | null = lines[j].match(/\b(Text|Span|SymbolGlyph)\s*\(/);
    if (m !== null) { kind = m[1]; break; }
  }
  eq("§3 前景 widget = `Text`（文字字形，⛔ 不是 SymbolGlyph）⇒ 适用 **AA_TEXT(4.5)**", kind, 'Text');
  ok('§3 反向断言：**不是** SymbolGlyph（若被误改成图标 ⇒ 本条红 ⇒ 逼重新论证地板）', kind !== 'SymbolGlyph');
  // 形态：旧的**单行无条件**用法已消失；新形态存在
  ok('§3 ⛔ 旧形态（`⋯` 无条件 textSecondary 单行链）已消失',
    aSrc.indexOf("Text('⋯').fontSize(typeOf('type.headline').size).fontColor(this.pal().textSecondary)") < 0);
  ok('§3 ✓ 新形态：`⋯` 的 fg = 当前会话支 `textPrimary` / 其余 `textSecondary`',
    aSrc.indexOf(A_NEW) >= 0);
  // 该行**不再是**无条件 textSecondary（防"把条件去掉"这种更弱的回退）
  // ⚠️ 2026-10-13：条件判据从 `s.chat_id === this.currentChat` 收成**唯一助手**
  //    `this.isCurrentSession(s.chat_id)`（规范化比较，见 docs §21.112）⇒ 断言随形态更新，意图不变。
  const ellChain: string = lines.slice(ellLine, ellLine + 4).join('\n');
  ok('§3 ✓ 该链含条件（非无条件 `textSecondary`）', ellChain.indexOf('?') >= 0 && ellChain.indexOf('isCurrentSession') >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §4 落点 C —— AskUserSheet 选中选项 `description`（textSecondary）的底不再是 RUNG_ACTIVE
// ════════════════════════════════════════════════════════════════════════════
// ① 新形态：选中 = RUNG_RAISED（`surface.overlayRow`）、未选中 = RUNG_CARD（`surface.overlay`）
ok("§4 ✓ 选中底 = 'surface.overlayRow'（RUNG_RAISED；保留「面提升一档」）",
  cSrc.indexOf("? 'surface.overlayRow'") >= 0);
ok("§4 ✓ 未选中底 = 'surface.overlay'（RUNG_CARD；与浮层面齐平）",
  cSrc.indexOf(": 'surface.overlay')") >= 0);
// ② ⛔ 全端零残留：**按派生别名表**扫 —— 该文件里**任何** RUNG_ACTIVE 家族成员都不许再作底
{
  const hits: string[] = [];
  for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
    if (cSrc.indexOf(`'${ACTIVE_ALIASES[i]}'`) >= 0) { hits.push(ACTIVE_ALIASES[i]); }
  }
  ok('§4 ⛔ 零残留（**按派生别名家族**扫）：AskUserSheet 不再出现任何 RUNG_ACTIVE 面名',
    hits.length === 0, `got ${JSON.stringify(hits)}`);
}
// ③ Index.ets 的 RUNG_ACTIVE 面名**逐字面量计数**冻结（新增 ⇒ 红 ⇒ 逼显式论证）
{
  const found: string[] = [];
  for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
    if (aSrc.split(`'${ACTIVE_ALIASES[i]}'`).length - 1 > 0) { found.push(ACTIVE_ALIASES[i]); }
  }
  const foundSorted: string[] = found.slice().sort();
  ok('§4 Index.ets 的 RUNG_ACTIVE 面名集合冻结 = {overlayRowHover(会话行底), pillSelected(渠道 chip)}',
    JSON.stringify(foundSorted) === JSON.stringify(['surface.overlayRowHover', 'surface.pillSelected'].sort()),
    `got ${JSON.stringify(foundSorted)}`);
  ok("§4 Index.ets 里 `surfaceFillOf(p,'surface.overlayRowHover')` 恰好 1 处（会话行底）",
    aSrc.split("surfaceFillOf(this.pal(), 'surface.overlayRowHover')").length - 1 === 1);
  ok("§4 Index.ets 里 `surface.pillSelected` 的面名**只**出现在渠道 chip（其 fg 是条件支）",
    aSrc.indexOf("this.activeChannel.length === 0 ? 'surface.pillSelected' : 'surface.chip'") >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §5 「按别名搜」的**判别力**自证 —— 家族每个成员都能被检出（⛔ 只认字面量 `surfaceHi` 是漏因）
// ════════════════════════════════════════════════════════════════════════════
/** 判别器：源里 `Text(...).fontColor(textSecondary)`（**无条件**）且其 widget 的底用 ACTIVE 家族面名 ⇒ 命中。 */
function detectTextOnActive(src: string, aliases: string[]): number {
  const lines: string[] = src.split('\n');
  let hits: number = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('.fontColor(this.pal().textSecondary)') < 0) { continue; }
    if (lines[i].indexOf('?') >= 0) { continue; }                 // 条件支 ⇒ 不是本形态
    let bg: string = '';
    for (let j = i; j < Math.min(lines.length, i + 25); j++) {
      if (lines[j].indexOf('.backgroundColor(') >= 0) { bg = lines.slice(j, j + 4).join(' '); break; }
    }
    if (bg.length === 0) { continue; }
    for (let k = 0; k < aliases.length; k++) {
      if (bg.indexOf(`'${aliases[k]}'`) >= 0) { hits++; break; }
    }
  }
  return hits;
}
for (let i = 0; i < ACTIVE_ALIASES.length; i++) {
  const synthetic: string = `Text('样本')\n  .fontColor(this.pal().textSecondary)\n  .padding(8)\n.x\n  .backgroundColor(surfaceFillOf(this.pal(), '${ACTIVE_ALIASES[i]}'))\n`;
  eq(`§5 判别力自证：合成样本（底 = '${ACTIVE_ALIASES[i]}'）必被检出`, detectTextOnActive(synthetic, ACTIVE_ALIASES), 1);
}
equ: {
  const clean: string = `Text('样本')\n  .fontColor(this.pal().textSecondary)\n  .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))\n`;
  eq('§5 反向：底 = RUNG_RAISED（不同 rung）⇒ **不**命中（防误伤）', detectTextOnActive(clean, ACTIVE_ALIASES), 0);
  const cond: string = `Text('样本')\n  .fontColor(x ? this.pal().textPrimary : this.pal().textSecondary)\n  .backgroundColor(surfaceFillOf(this.pal(), '${ACTIVE_ALIASES[0]}'))\n`;
  eq('§5 反向：条件支 ⇒ **不**命中（本波修法形态即此）', detectTextOnActive(cond, ACTIVE_ALIASES), 0);
  // 三处真实落点（改后）必须**零命中**（判别器跑真源 ⇒ 与 §2-§4 的精确断言互相印证）
  eq('§5 ✓ 真源 Index.ets 命中数 = 0（三处落点已清）', detectTextOnActive(aSrc, ACTIVE_ALIASES), 0);
  eq('§5 ✓ 真源 AskUserSheet.ets 命中数 = 0', detectTextOnActive(cSrc, ACTIVE_ALIASES), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §6 五主题实算：新形态 ≥ AA_TEXT；且**缺口本身仍在**（证明修的是落点，不是偷偷改色板）
// ════════════════════════════════════════════════════════════════════════════
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const t: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(t);
  const rNewFg: number = contrastRatio(p.textPrimary, p.surfaceHi);              // A/B 当前会话支
  const rRaised: number = contrastRatio(p.textSecondary, surfaceFillOf(p, 'surface.overlayRow')); // C 选中
  const rCard: number = contrastRatio(p.textSecondary, surfaceFillOf(p, 'surface.overlay'));      // C 未选中
  ok(`§6 [${t}] textPrimary × surfaceHi ≥ 4.5（A/B 修后）`, rNewFg >= AA_TEXT, `got ${rNewFg.toFixed(4)}`);
  ok(`§6 [${t}] textSecondary × surface.overlayRow ≥ 4.5（C 选中修后）`, rRaised >= AA_TEXT, `got ${rRaised.toFixed(4)}`);
  ok(`§6 [${t}] textSecondary × surface.overlay ≥ 4.5（C 未选中）`, rCard >= AA_TEXT, `got ${rCard.toFixed(4)}`);
}
{
  const pp: Palette = paletteOf(THEME_PORCELAIN);
  const bad: number = contrastRatio(pp.textSecondary, pp.surfaceHi);
  ok(`§6 复核缺口本身仍在：porcelain textSecondary × surfaceHi = ${bad.toFixed(4)} < 4.5（落点被移除，色板未动）`,
    Math.abs(bad - 4.3374) < 0.001 && bad < AA_TEXT);
  // 图/文地板对照：若 B 真是图标，则 4.337 ≥ 3.0 ⇒ 无需改（⛔ 本判据已判它是 Text ⇒ 必须改）
  ok('§6 对照：同值 ≥ AA_NON_TEXT(3.0) ⇒ 唯有"当文字用"才不达标（类型判定是本条关键）',
    bad >= AA_NON_TEXT);
}

console.log(`\n  surface_alias: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
