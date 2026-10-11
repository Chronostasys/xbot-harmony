/**
 * ⭐ 星标图标落点对比度判据（目标⑤ · 2026-10-11）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 * `porcelain_surfacehi_contrast` §8 钉的是**矩阵/台账层**（`iconMuted × surfaceHi` 的能力缺口：
 *   dark 仅 **2.8164 < 3.0**，已登记 `knownContrastLedger`），且它的**落点锚**只判"星标支 ∈
 *   {仍 `iconMuted`, 已换 `textSecondary`}"（两态都接受 ⇒ **不能**拦住回退）。
 * 本判据钉的是**落点侧的唯一正确答案**：
 *   · 形态：会话行星标**未收藏支**取色 role **必须** = `textSecondary`（⛔ 不得回退 `iconMuted`）；
 *   · 计数：该 ternary 全仓**恰好一处**（零扫描判红；多一处 ⇒ 红）；
 *   · 实算：**逐主题**用「源码解析出的 role」× 真实底（`surface.overlayRowHover` = `RUNG_ACTIVE`
 *     = `surfaceHi`）算比值 ⇒ 五主题全 ≥ `AA_NON_TEXT`(3.0，图标地板)。
 *
 * ── 落点（内容锚，⛔ 不按行号 —— `pages/Index.ets` 常被其它线编辑，行号会漂）────────────
 *   `pages/Index.ets` 会话行：`.fontColor([this.isStarredChat(s.chat_id) ? this.pal().accent
 *     : <未收藏支取色>])`，其**最近前导 widget = `SymbolGlyph`（图标）** ⇒ 地板 `AA_NON_TEXT`(3.0)。
 *   底 = `.backgroundColor(s.chat_id === this.currentChat ? surfaceFillOf(this.pal(),
 *     'surface.overlayRowHover') : this.pal().transparent)` ⇒ 仅"当前会话"行坐在 `surfaceHi` 上。
 *
 * ── 裁决（`design-matrix`，走**落点侧**）─────────────────────────────────────────
 *   未收藏支 `iconMuted` ⇒ `iconMutedOf`（浅色 = `textSecondary`，深色 = `textMuted`）压 `surfaceHi`：
 *   light 6.1468 ✓ · aurora 3.9022 ✓ · nebula 4.1535 ✓ · porcelain 4.3374 ✓ · **dark 2.8164 ✗**。
 *   ⇒ 改该支为 `textSecondary`（五主题 ≥4.33 ✓；浅色族 `iconMuted` 本就 = `textSecondary` ⇒ 零变化）。
 *   ⛔ 不动收藏支（`accent` 强调 = 关键反馈）；⛔ 不动底/布局/其它落点；⛔ 不动 `core/design.ets`。
 *
 * ★ mutation 自证（交付回报含原文）：把未收藏支**回退**成 `colorOf(this.pal(), 'iconMuted')`
 *   ⇒ ① §1 形态红（role ≠ textSecondary）；② §2 实算红（本判据**从源码解析 role** ⇒ dark 变 2.8164 < 3.0）。
 *   两路独立 ⇒ 无法靠"改一个判据"绕过。
 */
export {};
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, Palette } from '../../entry/src/main/ets/core/theme';
import { colorOf, surfaceFillOf, AA_NON_TEXT } from '../../entry/src/main/ets/core/design';

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
/** 剥注释（仓内约定：注释里记色值/role 是允许且鼓励的 ⇒ 扫源码前必须剥，保留换行不漂行号）。 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}
const idxPath: string = pathMod.join(etsRoot, 'pages', 'Index.ets');
const idxRaw: string = fsMod.readFileSync(idxPath, 'utf-8');
const idx: string = stripSrc(idxRaw);

// ════════════════════════════════════════════════════════════════════════════
// §0 零扫描判红 —— 源码确实读到、且含星标内容锚（不是空串/注释残渣）
// ════════════════════════════════════════════════════════════════════════════
ok('§0 零扫描判红：pages/Index.ets 被读到（非空）', idx.length > 0, `len=${idx.length}`);
ok('§0 零扫描判红：源码含星标内容锚 `isStarredChat(s.chat_id)`', idx.indexOf('isStarredChat(s.chat_id)') >= 0);
ok('§0 零扫描判红：源码含 `toggleStarChat(s.chat_id)`（真实落点的第二锚）', idx.indexOf('toggleStarChat(s.chat_id)') >= 0);
ok("§0 零扫描判红：该行底锚存在 —— `surfaceFillOf(this.pal(), 'surface.overlayRowHover')`（= RUNG_ACTIVE = surfaceHi）",
  idx.indexOf("surfaceFillOf(this.pal(), 'surface.overlayRowHover')") >= 0);

// ════════════════════════════════════════════════════════════════════════════
// §1 落点定位（内容锚）+ 形态：未收藏支**必须** = `textSecondary`，且**恰好一处**
// ════════════════════════════════════════════════════════════════════════════
// 星标 fontColor = `.fontColor([this.isStarredChat(s.chat_id) ? <收藏支> : <未收藏支>])`
const STAR_FG_RE: RegExp = /\.fontColor\(\[this\.isStarredChat\(s\.chat_id\)\s*\?\s*([^:\]\n]+?)\s*:\s*([^\]\n]+?)\]\)/g;
const starMatches: RegExpMatchArray[] = [];
{
  let m: RegExpExecArray | null = STAR_FG_RE.exec(idx);
  while (m !== null) { starMatches.push(m as unknown as RegExpMatchArray); m = STAR_FG_RE.exec(idx); }
}
ok('§1 零扫描判红：星标 ternary 取色在 Index.ets 中恰好 1 处（多/少 ⇒ 红）',
  starMatches.length === 1, `got ${starMatches.length}`);
/** `this.pal().X` → X；`colorOf(this.pal(), 'X')` → X；否则原样（便于报错时看到未知串）。 */
function roleOf(expr: string): string {
  const t: string = expr.trim();
  let m: RegExpMatchArray | null = t.match(/^colorOf\(this\.pal\(\),\s*'([^']+)'\)$/);
  if (m !== null) { return m[1]; }
  m = t.match(/^this\.pal\(\)\.(\w+)$/);
  if (m !== null) { return m[1]; }
  return t;
}
let unstarExpr: string = '';
let unstarRole: string = '';
let starExpr: string = '';
let starRole: string = '';
if (starMatches.length >= 1) {
  starExpr = (starMatches[0][1] as string).trim();
  unstarExpr = (starMatches[0][2] as string).trim();
  starRole = roleOf(starExpr);
  unstarRole = roleOf(unstarExpr);
}
eq('§1 未收藏支取色 role = textSecondary（形态，⛔ 唯一的正确答案）', unstarRole, 'textSecondary');
ok('§1 未收藏支 ⛔ 不得回退成 iconMuted（登记的能力缺口，压 surfaceHi 仅 2.8164 < 3.0）',
  unstarRole !== 'iconMuted');
ok('§1 未收藏支表达式是**纯 role 取色**（⛔ 零颜色字面量：无 `#`/`rgb`/0x 色值）',
  unstarExpr.indexOf('#') < 0 && unstarExpr.indexOf('rgb') < 0 && unstarExpr.indexOf('0x') < 0,
  `expr=${unstarExpr}`);
// 落点行号（实测，仅作证据；⛔ 判据本身不按行号）
{
  const lines: string[] = idx.split('\n');
  let found: number = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('.fontColor([') >= 0 && lines[i].indexOf('this.isStarredChat(s.chat_id)') >= 0) { found = i + 1; break; }
  }
  ok('§1 落点行号可定位（内容锚命中）', found > 0, `line=${found}`);
  console.log(`  · §1 落点：pages/Index.ets:${found}（内容锚命中；行号仅供证据，判据不依赖它）`);
  // 最近前导 widget = SymbolGlyph（图标，非 Text/Span）⇒ 适用 AA_NON_TEXT(3.0)
  let kind: string = 'none';
  for (let j = found - 1; j >= Math.max(0, found - 1 - 12); j--) {
    const wm: RegExpMatchArray | null = lines[j].match(/\b(Text|Span|SymbolGlyph|Image|Progress)\s*\(/);
    if (wm !== null) { kind = wm[1]; break; }
  }
  eq('§1 前景 widget = SymbolGlyph（⛔ 图标 ⇒ 地板 AA_NON_TEXT(3.0)，不是文字 4.5）', kind, 'SymbolGlyph');
}

// ════════════════════════════════════════════════════════════════════════════
// §2 逐主题实算：**从源码解析出的 role** × 真实底 ≥ 3.0（mutation: 回退 iconMuted ⇒ dark 红）
// ════════════════════════════════════════════════════════════════════════════
// 底 = 会话行"当前会话"支的真实表达式（`surface.overlayRowHover`），逐主题必须 ≡ p.surfaceHi。
console.log(`  · §2 星标（未收藏支 role=${unstarRole}）压"当前会话"行底（地板 ${AA_NON_TEXT}）：`);
let worst: number = Infinity;
let worstTheme: string = '';
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const t: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(t);
  const bg: string = surfaceFillOf(p, 'surface.overlayRowHover');
  ok(`§2 [${t}] 行底 surface.overlayRowHover ≡ p.surfaceHi（RUNG_ACTIVE ⇒ 同一 rung）`, bg === p.surfaceHi,
    `got ${bg} want ${p.surfaceHi}`);
  const fg: string = colorOf(p, unstarRole);
  const r: number = contrastRatio(fg, bg);
  if (r < worst) { worst = r; worstTheme = t; }
  console.log(`      ${t.padEnd(10)} ${unstarRole}=${fg} ratio=${r.toFixed(4)}${r < AA_NON_TEXT ? '  ✗ < 3.0' : '  ✓'}`);
  ok(`§2 [${t}] ${unstarRole} 压 RUNG_ACTIVE 面 ≥ ${AA_NON_TEXT}（图标地板）`, r >= AA_NON_TEXT, `got ${r.toFixed(4)}`);
}
// 反面钉死：**旧 role（iconMuted）** 在 dark 上确实不达标 ⇒ 证明"改 role 不是无病呻吟"
{
  const pd: Palette = paletteOf('dark');
  const rOld: number = contrastRatio(colorOf(pd, 'iconMuted'), pd.surfaceHi);
  ok(`§2 mutation 锚：dark 下旧 role iconMuted 压 surfaceHi = ${rOld.toFixed(4)} < 3.0（回退 ⇒ 本判据必红）`,
    rOld < AA_NON_TEXT, `got ${rOld.toFixed(4)}`);
  ok('§2 mutation 锚：dark 缺口数值钉死 ≈ 2.8164（⛔ 不许静默漂）', Math.abs(rOld - 2.8164) < 0.002, `got ${rOld.toFixed(4)}`);
}
console.log(`  · §2 最差主题 = ${worstTheme}（${worst.toFixed(4)}）—— 改后五主题全达标`);

// ════════════════════════════════════════════════════════════════════════════
// §3 收藏支仍是 accent 强调（防误改另一支）+ 其实算达标
// ════════════════════════════════════════════════════════════════════════════
eq('§3 收藏支取色 = accent 强调（关键反馈，⛔ 不得改）', starRole, 'accent');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const t: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(t);
  const r: number = contrastRatio(colorOf(p, 'accent'), surfaceFillOf(p, 'surface.overlayRowHover'));
  ok(`§3 [${t}] 收藏支 accent 压 RUNG_ACTIVE 面 ≥ ${AA_NON_TEXT}（非文本图形）`, r >= AA_NON_TEXT, `got ${r.toFixed(4)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// §4 落点唯一性：`colorOf(..., 'iconMuted')` **不再**出现在星标 ternary 里（mutation: 出现 ⇒ §1 红）
// ════════════════════════════════════════════════════════════════════════════
// ⛔ 只扫星标 ternary（`iconMuted` 在 Index.ets 其它落点合法存在，不能全端断言）
ok("§4 星标未收藏支已不再用 `colorOf(this.pal(), 'iconMuted')`（唯一落点已修）",
  unstarExpr.indexOf("iconMuted") < 0, `expr=${unstarExpr}`);

console.log(`\n  star_contrast: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
