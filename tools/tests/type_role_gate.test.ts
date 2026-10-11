/**
 * type_role_gate.test.ts —— **文字层级（type role）使用一致性**（"苹果那种干净"的层级纪律 · 2026-10-11）。
 *
 * ── 真源（⛔ 不臆造，现场从 `core/design.ets` 解析）──────────────────────────────
 * `typeRoles()` 8 档，**严格递减、无重复**：`display 28 · title FS_HERO(21) · headline 17 ·
 * body 15 · callout FS_BODY(14) · subhead FS_BODY-1(13) · caption FS_CAPTION(12) · micro 10`。
 * ⚠️ `type.micro` 的源码注释原文：**"替代散落的 10 / 11 字面量"** ⇒ **`11` 不在阶梯里**，
 *    这是**本仓自己写下的规矩**（所以下面的 A 类判据不是我造的需求）。
 *
 * ── 判据（A 类硬红）───────────────────────────────────────────────────────────
 * **`Text` / `Span` 的 `.fontSize(<数字>)` 必须走排版档** —— 只要出现字面量数字就红，
 * 除非登记在 `KNOWN_OK`（有据可依）或 `PENDING_SPEC`（本线**禁改**的文件，归他人）。
 * ⛔ 两张表**只许缩短**。
 * 附加不变量：阶梯必须**严格递减且无重复**（表自己的声明）；`micro` 必须是阶梯最小档。
 *
 * ── ⚠️ 与"图标字号"分开（上一轮的账）───────────────────────────────────────────
 * `SymbolGlyph` / `Image` 的 `.fontSize(...)` 属**图标尺寸档**（另一条线，`icon_consistency_gate`
 * 的 C 类报告），**不算**文字层级 ⇒ 本判据**只数 Text/Span**。混在一起来会得出"50 处"的假规模。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import { typeRoles, typeOf, TypeRole } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: string | number = src.indexOf('\n', i); i = (j as number) < 0 ? n : (j as number); continue; }
      if (src.charAt(i + 1) === '*') {
        const j: number = src.indexOf('*/', i + 2);
        if (j < 0) { break; }
        let nl: number = 0;
        for (let k = i; k < j; k++) { if (src.charAt(k) === '\n') { nl++; } }
        out += '\n'.repeat(nl); i = j + 2; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}
function matchPair(s: string, i: number): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === '(') { d++; }
    else if (s.charAt(i) === ')') { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
/** ⛔ 起始/续行空白**必须含 `\r\n`**（上一轮踩过"漏换行 ⇒ 链恒空"的假结论）。 */
const WS: string = ' \t\r\n';
function chainAfter(s: string, i: number): string {
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  let out: string = '';
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j);
    if (k < 0) { break; }
    out += s.substring(i, k + 1);
    i = k + 1;
    while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  }
  return out;
}
function lineOf(s: string, idx: number): number { let n: number = 1; for (let i = 0; i < idx; i++) { if (s.charAt(i) === '\n') { n++; } } return n; }

// ── §A 真源：阶梯形状 ─────────────────────────────────────────────────────────
console.log('\n▶ §A 真源（core/design.ets 的 typeRoles()）');
const roles: TypeRole[] = typeRoles();
const ladder: string[] = [];
for (let i = 0; i < roles.length; i++) { ladder.push(`${roles[i].name}=${roles[i].size}(w${roles[i].weight},${roles[i].colorRole})`); }
console.log('  ' + ladder.join('  ·  '));
let strictlyDecreasing: boolean = true;
const seen: number[] = [];
for (let i = 0; i < roles.length; i++) {
  for (let j = 0; j < seen.length; j++) { if (seen[j] === roles[i].size) { strictlyDecreasing = false; } }
  if (i > 0 && roles[i].size >= roles[i - 1].size) { strictlyDecreasing = false; }
  seen.push(roles[i].size);
}
ok('① 阶梯**严格递减且无重复**（表自己的声明 "严格递减、无重复"）', strictlyDecreasing);
ok(`② 最小档 = \`type.micro\` = ${typeOf('type.micro').size}（源码注释原文：\`type.micro\` 用来**替代散落的 10 / 11 字面量**）`,
  typeOf('type.micro').name === 'type.micro' && typeOf('type.micro').size === 10);
const ladderSizes: number[] = roles.map((r) => r.size);
ok('③ `11` **不在**阶梯里（本仓自己说它该被 micro 取代）⇒ 出现 `fontSize(11)` 就是绕过阶梯',
  ladderSizes.indexOf(11) < 0);

// ── §B 枚举：Text/Span 的字面量字号 ───────────────────────────────────────────
class Site { rel: string = ''; line: number = 0; ty: string = ''; val: number = 0; arg: string = ''; }
/**
 * ⛔ **台账键必须是稳定键，不能含行号**（2026-10-11 血案）：本判据第一版用 `rel :: line :: val`，
 *    而 `pages/Index.ets` 被别的线改动后**行号整体 +12** ⇒ 台账**同时**报"未登记 2 + 陈旧 2"，
 *    把一次"无关的行号漂移"渲染成"层级错配"。⇒ 现改为 `rel :: val :: <Text 实参>`（内容锚点），
 *    并配**多重集**比较（因为 `'xbot'` 那类实参会重复出现两次，集合比较会吞掉一处）。
 */
function keyOf(s: Site): string { return `${s.rel} :: ${s.val} :: ${s.arg}`; }
const srcByRel: Map<string, string> = new Map<string, string>();
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); }
      else if (ents[i].endsWith('.ets')) { srcByRel.set(pathMod.relative(etsRoot, p), fsMod.readFileSync(p, 'utf-8')); }
    }
  };
  walk(base);
}
function textLiteralSizes(m: Map<string, string>): Site[] {
  const out: Site[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b(Text|Span)\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j);
      if (k > 0) {
        const ch: string = chainAfter(src, k + 1);
        const fs: RegExpExecArray | null = /\.fontSize\(\s*(\d+)\s*\)/.exec(ch);
        if (fs !== null) {
          const s: Site = new Site();
          s.rel = rel; s.line = lineOf(src, x.index); s.ty = x[1]; s.val = Number(fs[1]);
          s.arg = src.substring(j + 1, k).trim().replace(/\s+/g, ' ');
          out.push(s);
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}
const sites: Site[] = textLiteralSizes(srcByRel);
console.log('\n▶ §B 枚举：Text/Span 用**字面量**字号的落点');
const byFile: Map<string, number> = new Map<string, number>();
for (let i = 0; i < sites.length; i++) { byFile.set(sites[i].rel, (byFile.get(sites[i].rel) || 0) + 1); }
console.log(`  总计 ${sites.length} 处（⚠️ 只数 Text/Span；SymbolGlyph/Image 的属"图标尺寸档"，另一条线）`);
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  console.log(`  ${pad(s.rel, 44)}:${pad(String(s.line), 5)} ${pad(s.ty, 6)} fontSize(${s.val})${ladderSizes.indexOf(s.val) < 0 ? '  ← **阶梯外**' : ''}`);
}
ok('零扫描判红：扫到文件数 > 0', srcByRel.size > 0);

// ── §C 判据：台账（只许缩短）──────────────────────────────────────────────────
console.log('\n▶ §C A 类判据：Text/Span 不得用字面量字号（必须走排版档）');
/**
 * `KNOWN_OK`：**有据可依**的（每条必须写理由）。
 */
const KNOWN_OK: string[] = [
  // 代码条（语言标签 / 「复制」/ 表格标签）：源码明确**对齐 web** `MarkdownRenderer.tsx:214`
  // 的 `font-mono text-[11px]`（`index.css:199` 定色 muted）⇒ 换成本仓 `type.micro`(10) 会**偏离 web 基线**
  // ⇒ 属"有意"，非"层级乱"。**内容锚点**（⛔ 不含行号）。
  "components/MarkdownView.ets :: 11 :: b.lang.length > 0 ? b.lang : 'code'",
  "components/MarkdownView.ets :: 11 :: '复制'",
  "components/MarkdownView.ets :: 11 :: `表格（${b.header.length} 列 · ${b.rows.length} 行）`",
  // 工具浮层的**代码/终端输出行**：web `ToolCallBlock.tsx:98` 的 `text-[12px]`，且注释原文
  // "同一浮层里'代码/终端输出'的字号必须一致" ⇒ **有意**。
  "components/ToolPopover.ets :: 12 :: ln.length > 0 ? ln : ' '",
  // diff 视图的 `+/-` 标记列：必须与**同一浮层代码行同号(12)** 才能纵向对齐 ⇒ **有意**。
  "components/ToolPopover.ets :: 12 :: ln.kind === DIFF_ADD ? '+' : (ln.kind === DIFF_DEL ? '-' : ' ')",
];
/** `PENDING_SPEC`：本线**禁改**的文件（归他人）—— ⛔ 只许缩短。 */
const PENDING_SPEC: string[] = [
  // 消息行（归 chat-surface-ux）：`11` 是**阶梯外**值（`type.micro`=10 的源码注释就写着"替代 10/11 字面量"）
  "components/MessageRow.ets :: 11 :: '正在加载更多…'",
  "components/MessageRow.ets :: 11 :: '加载失败 · 重试'",
  "components/MessageRow.ets :: 11 :: `更早的 ${this.row.regionsBefore} 个区域`",
  "components/MessageRow.ets :: 11 :: `更早的 ${this.hiddenBlocks()} 个迭代块`",
  "components/MessageRow.ets :: 11 :: COMPACTED_LABEL",
  // dev 面板（`components/Settings*.ets` 归 tokens-ux）：等宽日志行，10 是 micro 档值却写死
  "components/SettingsDeveloper.ets :: 10 :: a.desc",
  "components/SettingsDeveloper.ets :: 10 :: fmtClock(e.atMs)",
  "components/SettingsDeveloper.ets :: 10 :: e.name",
  "components/SettingsDeveloper.ets :: 10 :: previewText(e.payload, 120)",
  "components/SettingsDeveloper.ets :: 10 :: '录制中'",
  // 登录/空态大字（归 chat-surface-ux）：18 / 34 **阶梯外**（阶梯最高 display=28）；两次 `'xbot'` 靠**多重集**区分
  "pages/Index.ets :: 18 :: 'xbot'",
  "pages/Index.ets :: 34 :: 'xbot'",
  "pages/Index.ets :: 34 :: 'xbot'",
];
const reg: string[] = KNOWN_OK.concat(PENDING_SPEC);
const measured: string[] = sites.map(keyOf);
/** **多重集**差集（⛔ 不能用集合：`'xbot'` 那类重复实参会被吞掉一处）。 */
function multisetDiff(a: string[], b: string[]): string[] {
  const pool: string[] = b.slice();
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const at: number = pool.indexOf(a[i]);
    if (at < 0) { out.push(a[i]); } else { pool.splice(at, 1); }
  }
  return out;
}
const unreg: string[] = multisetDiff(measured, reg);
const stale: string[] = multisetDiff(reg, measured);
ok(`无"未登记的字面量字号"（未登记 ${unreg.length}${unreg.length > 0 ? '：' + unreg.slice(0, 4).join(' / ') : ''}）`, unreg.length === 0);
ok(`台账**只许缩短**：无"已改好却仍留在表里"（陈旧 ${stale.length}${stale.length > 0 ? '：' + stale.slice(0, 4).join(' / ') : ''}）`, stale.length === 0);
ok(`全部字面量字号都有归属（KNOWN_OK ${KNOWN_OK.length} + PENDING_SPEC ${PENDING_SPEC.length} = 实测 ${measured.length}）`,
  reg.length === measured.length);
const offLadder: string[] = sites.filter((s) => ladderSizes.indexOf(s.val) < 0).map((s) => `${s.rel}:${s.line}(${s.val})`);
console.log(`  ⚠ **阶梯外**字号的落点（${offLadder.length} 处，优先级最高）：`);
for (let i = 0; i < offLadder.length; i++) { console.log(`     · ${offLadder[i]}`); }
console.log('  逐文件分布：');
const perFileKeys: Map<string, number> = new Map<string, number>();
for (let i = 0; i < measured.length; i++) {
  const rel: string = measured[i].split(' :: ')[0];
  perFileKeys.set(rel, (perFileKeys.get(rel) || 0) + 1);
}
perFileKeys.forEach((v: number, kk: string) => { console.log(`     ${pad(kk, 44)} ${v}`); });

// ── §C2 裁定钉住（2026-10-11 指挥者裁决）：MarkdownView 的代码条/表格标签**保持紧凑**
//    ⇒ 这三个站点**不得**改走 `sz()`（`sz()` 会乘 `fontScale`）。
//    理由（裁决原文）：代码块/表格标签**有意不随字号档放大** —— 它们是"结构性附属说明"，
//    跟着正文一起放大只会挤占代码/表格的可读宽度。⇒ **不是缺陷**，别再当 spec 挂着。
console.log('\n▶ §C2 裁定钉住：代码条/表格标签**不得**改走 `sz()`（有意保持紧凑）');
const TIGHT_SITES: string[] = [
  "components/MarkdownView.ets :: 11 :: b.lang.length > 0 ? b.lang : 'code'",
  "components/MarkdownView.ets :: 11 :: '复制'",
  "components/MarkdownView.ets :: 11 :: `表格（${b.header.length} 列 · ${b.rows.length} 行）`",
];
{
  const offenders: string[] = [];
  srcByRel.forEach((raw: string, rel: string) => {
    if (rel !== 'components/MarkdownView.ets') { return; }
    const src: string = stripComments(raw);
    const rx: RegExp = /\b(Text)\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j);
      if (k > 0) {
        const ch: string = chainAfter(src, k + 1);
        if (ch.indexOf('sz(') >= 0) {
          const arg: string = src.substring(j + 1, k).trim().replace(/\s+/g, ' ');
          const kk: string = `components/MarkdownView.ets :: ${arg}`;
          // 只关心那三个紧凑站点是否"被改走 sz()"
          for (let q = 0; q < TIGHT_SITES.length; q++) {
            if (TIGHT_SITES[q].indexOf(arg) >= 0) { offenders.push(kk); }
          }
        }
      }
      x = rx.exec(src);
    }
  });
  for (let i = 0; i < offenders.length; i++) { console.log(`     ⚠ 被改走 sz()：${offenders[i]}`); }
  ok('裁定：MarkdownView 代码条/表格标签**不得**改走 `sz()`（有意紧凑，⛔ 不是缺陷）', offenders.length === 0);
}

// ── §D mutation ───────────────────────────────────────────────────────────────
console.log('\n▶ §D mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text('x')\n    .fontSize(11)\n}\n");
  const got: Site[] = textLiteralSizes(inj);
  ok('mutation：把正文字号写成 `fontSize(11)`（阶梯外）⇒ 必被枚举到', got.length === 1 && got[0].val === 11);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text('x')\n    .fontSize(typeOf('type.caption').size)\n}\n");
  const got: Site[] = textLiteralSizes(inj);
  ok('反向对照：走排版档（`typeOf(...).size`）⇒ 不命中（判据不是"凡 fontSize 必红"）', got.length === 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph(x)\n    .fontSize(13)\n}\n");
  const got: Site[] = textLiteralSizes(inj);
  ok('边界：`SymbolGlyph` 的字面量字号**不**计入文字层级（属图标尺寸档，另一条线）', got.length === 0);
}

{
  // ⛔ mutation：**行号漂移鲁棒性**（本轮红灯的根因）—— 在站点前注入空行 ⇒ 台账仍须匹配
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "\n\n\n\n\n\n\n\n\n\n\n\nbuild() {\n  Text('xbot')\n    .fontSize(34)\n}\n");
  const got: Site[] = textLiteralSizes(inj);
  const k: string = got.length === 1 ? keyOf(got[0]) : 'NONE';
  console.log(`     [drift] 注入 12 空行后键 = ${k}`);
  ok('mutation：键**不含行号** ⇒ 行号漂移不影响判定（第一版正是这样被别的线改红）',
    k === "components/Fake.ets :: 34 :: 'xbot'");
}

console.log('\n▼ 摘要');
console.log(`  阶梯 ${roles.length} 档（${ladderSizes.join('/')}），严格递减=${strictlyDecreasing}；micro=${typeOf('type.micro').size}`);
console.log(`  Text/Span 字面量字号 ${sites.length} 处：KNOWN_OK ${KNOWN_OK.length}（有据）+ PENDING_SPEC ${PENDING_SPEC.length}（禁改文件）+ 阶梯外 ${offLadder.length}`);
if (fail > 0) { console.log(`\n  type_role_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  type_role_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
