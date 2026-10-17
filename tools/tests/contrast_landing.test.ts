/**
 * 落点对比度判据（目标⑤ · 「白色主题、所有细节都做好」· 2026-10-11）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 * `porcelain_surfacehi_contrast` 只断言了**矩阵层**（`contrastReqs` 含
 * `textSecondary × surfaceHi`、porcelain 实算 4.337 < 4.5 且**已登记台账**）。
 * 但"矩阵红" ≠ "落点被修"：只要落点仍在，缺口就在。本判据钉的是**真实落点侧**：
 * 逐 `file:line` 断言"修好的落点**不再**出现 `textSecondary` 坐在 `surfaceHi` 上"，
 * 并 pin 修法**形态**（换底）与 **mutation 锚**（回退 ⇒ 本判据必红）。
 *
 * ── 落点（修前 → 修后，全部 `file:line` 实测复核过）────────────────────────────────
 *   L1 `components/LiveTailView.ets`  `OverflowBadge`「+N」
 *       修前 :442 `.fontColor(textSecondary)` + :445 `.backgroundColor(overOpen ? surfaceHi : SURFACE_CHIP)`
 *       修后 :445 展开态底 → `surfaceFillOf(p,'surface.raised')`（RUNG_RAISED）
 *   L2 `components/MessageRow.ets`     `OverflowBadge`「+N」
 *       修前 :925 fontColor + :928 `.backgroundColor(overIter===it ? surfaceHi : surfaceAlt)`
 *       修后 :928 展开态底 → `surfaceFillOf(p,'surface.card')`（RUNG_CARD）
 *   L3 `components/SettingsLlm.ets`    模型配置编辑器「取消」
 *       修前 :819 `Text('取消').fontColor(textSecondary)` + :831 容器底 `surface.active`(=surfaceHi)
 *       修后 :831 容器底 → `surfaceFillOf(p,'surface.raised')`（RUNG_RAISED）
 *   L4 `pages/Index.ets`               运行中态的发送/停止键
 *       :4330 `.fontColor([runningNow() ? textSecondary : onAccent])` + :4342 `.backgroundColor(runningNow() ? surfaceHi : accent)`
 *       ⇒ 该前景是 **`SymbolGlyph`（图标，非文字）** ⇒ 适用地板 **AA_NON_TEXT(3.0)**，
 *         porcelain 4.337 ≥ 3.0 **本来就达标** ⇒ **无需改**（本判据 §5 把它钉死，防止误改）。
 *
 * ── 阈值口径（= `docs/DESIGN-SYSTEM.md §15` 的"字号档"）────────────────────────────
 *   文字（`Text`，normal 字号 <18.66px = FS_CAPTION 12）⇒ `AA_TEXT`(4.5)；
 *   非文本/图标（`SymbolGlyph`/图形）⇒ `AA_NON_TEXT`(3.0)；元信息 ⇒ `AA_MUTED`(2.0)。
 *
 * ★ mutation 自证（交付回报含原文）：把任一落点**回退**到修前的 `surfaceHi` ⇒ 对应 § 必红：
 *   ① L1 回退 `.backgroundColor(this.overOpen ? this.pal().surfaceHi : …)` ⇒ §2 红；
 *   ② L2 回退 ⇒ §3 红；③ L3 回退 `.backgroundColor(surfaceFillOf(p,'surface.active'))` ⇒ §4 红；
 *   ④ 把 L4 的图标**误改**成 `Text`（或改走文字档） ⇒ §5 红（把"无需改"的理据钉住）。
 */
export {};

declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, THEME_PORCELAIN, Palette } from '../../entry/src/main/ets/core/theme';
import { surfaceFillOf, AA_TEXT, AA_NON_TEXT } from '../../entry/src/main/ets/core/design';

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
/** 剥注释（仓内约定：注释里记色值/role 是允许且鼓励的 ⇒ 扫源码前必须剥）。保留换行不漂行号。 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}
function readStrip(p: string): string { return stripSrc(fsMod.readFileSync(rel(p), 'utf-8').replace(/i18nT\(([^()]*)\)/g, '$1')); }

// 三个被修的落点组件（L4 的 Index.ets 单列，见 §5）
const L1_PATH: string = 'components/LiveTailView.ets';
const L2_PATH: string = 'components/MessageRow.ets';
const L3_PATH: string = 'components/SettingsLlm.ets';
const L4_PATH: string = 'pages/Index.ets';
const l1: string = readStrip(L1_PATH);
const l2: string = readStrip(L2_PATH);
const l3: string = readStrip(L3_PATH);
const l4: string = readStrip(L4_PATH);

// ════════════════════════════════════════════════════════════════════════════
// §0 零扫描判红 —— 源码确实读到、且读到的是"真源码"（不是空串/注释残渣）
// ════════════════════════════════════════════════════════════════════════════
ok('零扫描判红：4 个落点文件都被读到（非空）', l1.length > 0 && l2.length > 0 && l3.length > 0 && l4.length > 0,
  `len=${l1.length}/${l2.length}/${l3.length}/${l4.length}`);
ok('零扫描判红：L1 含 OverflowBadge 锚点（确实扫到该组件源码）', l1.indexOf('OverflowBadge') >= 0);
// ⚡ 2026-10-16：L2（`MessageRow`）的 `@Builder OverflowBadge` 已删 —— 分组渲染（`toolGroupsOf`）
//   上线后由内联「+N」徽标取代 ⇒ 锚点改钉**新的内联徽标**（`groupHideCount`）。
//   零扫描判红语义不变：扫不到真源码 ⇒ 仍必红。
ok('零扫描判红：L2 含内联「+N」徽标锚点（groupHideCount）', l2.indexOf('groupHideCount') >= 0);
ok('零扫描判红：L3 含 ModelConfigEditor 锚点', l3.indexOf('ModelConfigEditor') >= 0);
ok('零扫描判红：L4 含 sendKey/发送键图标锚点（runningNow）', l4.indexOf('runningNow()') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §1 修法形态 = **换底**：新底是语义 role，且逐主题实算达标（≥ AA_TEXT）
// ════════════════════════════════════════════════════════════════════════════
// 先钉死 role→rung→色值的语义（⛔ 若哪天 role 的定义被改，本判据随之红）
{
  const pp: Palette = paletteOf(THEME_PORCELAIN);
  eq("surfaceFillOf('surface.raised') === pal.surfaceAlt（RUNG_RAISED）", surfaceFillOf(pp, 'surface.raised'), pp.surfaceAlt);
  eq("surfaceFillOf('surface.card') === pal.surface（RUNG_CARD）", surfaceFillOf(pp, 'surface.card'), pp.surface);
}
// 新底 × textSecondary：**所有主题** ≥ AA_TEXT（porcelain / light / dark / aurora / nebula）
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const t: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(t);
  const ts: string = p.textSecondary;
  const rRaised: number = contrastRatio(ts, surfaceFillOf(p, 'surface.raised'));
  const rCard: number = contrastRatio(ts, surfaceFillOf(p, 'surface.card'));
  ok(`[${t}] textSecondary × surface.raised ≥ 4.5（L1/L3 新底）`, rRaised >= AA_TEXT, `got ${rRaised.toFixed(4)}`);
  ok(`[${t}] textSecondary × surface.card ≥ 4.5（L2 新底）`, rCard >= AA_TEXT, `got ${rCard.toFixed(4)}`);
}
// 复核审计数：porcelain textSecondary × surfaceHi 仍是 4.337（= 缺口本身；证明 §2-§4 的"修"是真的）
{
  const pp: Palette = paletteOf(THEME_PORCELAIN);
  const bad: number = contrastRatio(pp.textSecondary, pp.surfaceHi);
  ok('复核：porcelain textSecondary × surfaceHi ≈ 4.337（缺口本身仍在；落点被移除）', Math.abs(bad - 4.3374) < 0.001,
    `got ${bad.toFixed(4)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// §2 L1 —— LiveTailView `OverflowBadge`：展开态底不再压 surfaceHi，且文字仍 textSecondary
// ════════════════════════════════════════════════════════════════════════════
ok('L1 ⛔ 已移除旧表达式 `this.overOpen ? this.pal().surfaceHi`',
  l1.indexOf('this.overOpen ? this.pal().surfaceHi') < 0);
ok("L1 ✓ 新表达式存在：展开态底 = surfaceFillOf(p,'surface.raised')",
  l1.indexOf("this.overOpen ? surfaceFillOf(this.pal(), 'surface.raised')") >= 0);
ok('L1 ✓ 常态底仍是 `surface.chip`（SURFACE_CHIP）—— 未误伤',
  l1.indexOf(': surfaceFillOf(this.pal(), SURFACE_CHIP))') >= 0);
ok('L1 ✓ 文字仍保留 `textSecondary`（弱化观感未变）',
  l1.indexOf('.fontColor(this.pal().textSecondary)') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §3 L2 —— MessageRow `OverflowBadge`：同款
// ════════════════════════════════════════════════════════════════════════════
ok('L2 ⛔ 已移除旧表达式 `this.overIter === it.iteration ? this.pal().surfaceHi`',
  l2.indexOf('this.overIter === it.iteration ? this.pal().surfaceHi') < 0);
ok("L2 ✓ 新表达式存在：展开态底 = surfaceFillOf(p,'surface.card')",
  l2.indexOf("this.overIter === it.iteration ? surfaceFillOf(this.pal(), 'surface.card')") >= 0);
ok('L2 ✓ 常态底仍是 `pal().surfaceAlt` —— 未误伤',
  l2.indexOf(': this.pal().surfaceAlt)') >= 0);
ok('L2 ✓ 文字仍保留 `textSecondary`（弱化观感未变）',
  l2.indexOf('.fontColor(this.pal().textSecondary)') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §4 L3 —— SettingsLlm 模型配置编辑器：容器底换掉 surface.active(=surfaceHi)
// ════════════════════════════════════════════════════════════════════════════
ok("L3 ⛔ 已移除旧底 `surfaceFillOf(p,'surface.active')`",
  l3.indexOf("surfaceFillOf(this.pal(), 'surface.active')") < 0);
ok("L3 ✓ 新底存在：surfaceFillOf(p,'surface.raised')",
  l3.indexOf("surfaceFillOf(this.pal(), 'surface.raised')") >= 0);
ok('L3 ✓ 「取消」文字仍保留 `textSecondary`（弱化观感未变）',
  l3.indexOf("Text('取消')") >= 0 && l3.indexOf('.fontColor(this.pal().textSecondary)') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §5 L4 —— Index 发送/停止键：**图标**（SymbolGlyph）⇒ 3.0 地板 ⇒ 4.337 达标 ⇒ **无需改**
// ════════════════════════════════════════════════════════════════════════════
// 5.1 形态：该 `.fontColor([... textSecondary ...])` 行的**最近前导 widget** 必须是 SymbolGlyph（非 Text/Span）
{
  const lines: string[] = l4.split('\n');
  let fgLine: number = -1;
  // 形态锚：主按钮的"停止态前景"行。2026-10-12 起该行的条件由 `runningNow()` 改名成
  // `composerShowStop()`（web `MessageInput.tsx:687` 同源语义：**有内容 ⇒ 发送**，
  // busy 且无内容才是停止）⇒ 锚点同时接受新旧名（⛔ 不放松其它约束：widget 仍必须是
  // SymbolGlyph、色仍必须是 textSecondary）。
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('.fontColor([') >= 0 && lines[i].indexOf('this.pal().textSecondary') >= 0
      && (lines[i].indexOf('runningNow()') >= 0 || lines[i].indexOf('composerShowStop()') >= 0)) {
      fgLine = i;
      break;
    }
  }
  ok('零扫描判红：L4 找到发送/停止键的 fontColor 行', fgLine >= 0);
  let kind: string = 'none';
  for (let j = fgLine; j >= Math.max(0, fgLine - 12); j--) {
    const m: RegExpMatchArray | null = lines[j].match(/\b(Text|Span|SymbolGlyph|Image|Progress)\s*\(/);
    if (m !== null) { kind = m[1]; break; }
  }
  eq('L4 前景 widget = SymbolGlyph（图标，非文字）⇒ 适用 AA_NON_TEXT(3.0)，**无需改**', kind, 'SymbolGlyph');
  // 反向：它**不是** Text/Span ⇒ 不适用 4.5（把"文字/图标"判定的根因钉死）
  ok('L4 反向断言：该前景不是 Text/Span（若改成文字 ⇒ 本判据红 ⇒ 逼回图标或改修法）',
    kind !== 'Text' && kind !== 'Span');
  // 同一 Stack 的底 = surfaceHi（未改），且图标色 = textSecondary（未改）—— 记录"无需改"的现状
  // （2026-10-12：条件名 `runningNow()` → `composerShowStop()`；底色/前景色**一字未动**）
  const stackTail: string = lines.slice(fgLine, fgLine + 20).join('\n');
  ok('L4 现状保留：图标 `textSecondary` 压 `composerShowStop() ? surfaceHi`（本轮**有意不动**）',
    stackTail.indexOf('this.composerShowStop() ? this.pal().surfaceHi : this.pal().accent') >= 0
      || stackTail.indexOf('this.runningNow() ? this.pal().surfaceHi : this.pal().accent') >= 0);
}
// 5.2 实算：porcelain textSecondary × surfaceHi ≥ AA_NON_TEXT(3.0) ⇒ 图标确实达标
{
  const pp: Palette = paletteOf(THEME_PORCELAIN);
  const r: number = contrastRatio(pp.textSecondary, pp.surfaceHi);
  ok(`L4 实算：porcelain textSecondary × surfaceHi = ${r.toFixed(4)} ≥ 3.0（图标地板）⇒ 无需改`,
    r >= AA_NON_TEXT);
  ok('L4 反向：该实算 **< 4.5**（证明它"若当文字用"才不达标 ⇒ 类型判定是本条的关键）', r < AA_TEXT);
}

// ════════════════════════════════════════════════════════════════════════════
// §6 全端零残留：**这三个组件**里不再有 `textSecondary` 坐在 `surfaceHi` 面上的**其它**落点
//     （形态扫描：`surfaceHi` 直取当底色 + 附近 textSecondary —— 只扫被修文件，避免误伤他域）
// ════════════════════════════════════════════════════════════════════════════
{
  const targets: string[] = [L1_PATH, L2_PATH, L3_PATH];
  let residual: number = 0;
  for (let i = 0; i < targets.length; i++) {
    const src: string = readStrip(targets[i]);
    // 直取 `pal().surfaceHi` 当底色（`this.pal().surfaceHi` 出现在 `.backgroundColor(` 附近）
    const m: RegExpMatchArray | null = src.match(/\.backgroundColor\([^\n]*this\.pal\(\)\.surfaceHi[^\n]*/g);
    if (m !== null) { residual += m.length; }
  }
  eq('被修的三个组件内无 `pal().surfaceHi` 直取当底色残留（porcelain 落点已清）', residual, 0);
}

console.log(`\n  contrast_landing: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
