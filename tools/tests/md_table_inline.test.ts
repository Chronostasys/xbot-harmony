/**
 * md_table_inline.test.ts —— 表格里的**行内 markdown** 必须渲染，且认出 GFM 允许的表格形态
 * （用户 2026-11-20：「现在表格里的 md 你都不会渲染」）。
 *
 * 本判据钉两件事：
 * ① **表格识别**（GFM）：有无外层竖线都要认；列数按分隔行定；对齐按 `:---:` 解析；
 * ② **单元格行内标记**：`**粗**` / `` `code` `` / `[链](url)` / `~~删~~` 必须被 `parseInline` 解析
 *    （渲染层 `TableCellSpan` 走 `inlineStyles → parseInlineCached`，与此同源 ⇒ 解析对即渲染对）。
 *
 * ⛔ 若这里绿而真机表格仍显示字面 `**`，那是**模型输出本身**没闭合（如闭合 `**` 前多空格，
 *   CommonMark 右翼规则不允许闭合 —— web 同样不渲染），不是客户端解析问题。
 */
export {};

declare const process: { exit: (c: number) => void };

import { MdBlock, MdBlockKind, MdSpan, parseInline, parseMarkdown, tableAlignsOf } from '../../entry/src/main/ets/core/markdown';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function tables(md: string): MdBlock[] {
  return parseMarkdown(md).filter((b: MdBlock) => b.kind === MdBlockKind.Table);
}

// ── ① 标准表格（带外层竖线）────────────────────────────────────────────────────
{
  const md: string = [
    '| 名称 | 说明 |',
    '| --- | ---: |',
    '| **粗** | `code` |',
    '| [链](https://a.b) | ~~删~~ |',
    '',
  ].join('\n');
  const ts: MdBlock[] = tables(md);
  eq('① 识别为表格', ts.length, 1);
  eq('①b 两列表头', ts.length > 0 ? ts[0].header : [], ['名称', '说明']);
  eq('①c 两行数据', ts.length > 0 ? ts[0].rows.length : -1, 2);
  eq('①d 对齐（左/右）', ts.length > 0 ? ts[0].aligns : [], [0, 2]);
  // 单元格文本原样保留标记（渲染层据此解析）
  eq('①e 单元格保留行内标记', ts.length > 0 ? ts[0].rows[0] : [], ['**粗**', '`code`']);
}

// ── ② 无外层竖线的表格（GFM 允许）─────────────────────────────────────────────
{
  const md: string = ['名称 | 说明', '--- | ---', '**粗** | 值', ''].join('\n');
  const ts: MdBlock[] = tables(md);
  eq('② 无外层竖线也识别为表格', ts.length, 1);
  eq('②b 表头', ts.length > 0 ? ts[0].header : [], ['名称', '说明']);
  eq('②c 数据行', ts.length > 0 ? ts[0].rows[0] : [], ['**粗**', '值']);
}

// ── ③ 单元格行内标记：与渲染层同源（`parseInline`）─────────────────────────────
{
  const b: MdSpan[] = parseInline('**粗** 与 `code` 与 [链](https://a.b) 与 ~~删~~');
  ok('③ 粗体', b.some((s: MdSpan) => s.bold === true && s.text === '粗'));
  ok('③b 行内码', b.some((s: MdSpan) => s.code === true && s.text === 'code'));
  ok('③c 链接', b.some((s: MdSpan) => s.link === 'https://a.b' && s.text === '链'));
  ok('③d 删除线', b.some((s: MdSpan) => s.strike === true && s.text === '删'));
}

// ── ④ 单元格内的字面 `|`（GFM 转义 `\|`）与 code span 内的 `|` 不切列 ────────────
{
  const md: string = ['| a | b |', '| --- | --- |', '| x \\| y | `p|q` |', ''].join('\n');
  const ts: MdBlock[] = tables(md);
  eq('④ 转义/码内的竖线不切列（仍 2 列）', ts.length > 0 ? ts[0].rows[0].length : -1, 2);
  eq('④b 转义竖线还原为字面 \\|', ts.length > 0 ? ts[0].rows[0][0] : 'MISSING', 'x | y');
  eq('④c code span 原样保留', ts.length > 0 ? ts[0].rows[0][1] : 'MISSING', '`p|q`');
  const spans: MdSpan[] = parseInline('`p|q`');
  ok('④d code span 内竖线按代码渲染', spans.some((s: MdSpan) => s.code === true && s.text === 'p|q'));
}

// ── ⑤ 对齐解析（`:---:` 居中 / `---` 默认左 / `---:` 右）────────────────────────
{
  eq('⑤ 对齐三元组', tableAlignsOf('| :--- | :---: | ---: |'), [0, 1, 2]);
  eq('⑤b 无冒号默认左', tableAlignsOf('| --- | --- |'), [0, 0]);
}

// ── ⑥ 列数不齐的行不崩（多退少补，不得整表丢弃）───────────────────────────────
{
  const md: string = ['| a | b | c |', '| --- | --- | --- |', '| 1 |', ''].join('\n');
  const ts: MdBlock[] = tables(md);
  eq('⑥ 缺列的行仍算表格数据行', ts.length > 0 ? ts[0].rows.length : -1, 1);
  ok('⑥b 行内单元格数 ≤ 表头数（渲染层 tableRowFields 负责补齐）',
    ts.length > 0 && ts[0].rows[0].length <= ts[0].header.length);
}

// ── ⑦ 引用块里的块级 markdown（表格/列表）必须渲染（用户 2026-11-20）──────────────
// ⛔ 引用块此前把「> 」后面当**一段纯文本** ⇒ `> | a | b |` 的表格整块消失（"表格不渲染"）。
{
  const md: string = [
    '> 引用里带表格：',
    '> | a | b |',
    '> | --- | --- |',
    '> | **粗** | `x` |',
    '',
  ].join(String.fromCharCode(10));
  const qs: MdBlock[] = parseMarkdown(md).filter((b: MdBlock) => b.kind === MdBlockKind.Quote);
  eq('⑦ 识别为引用块', qs.length, 1);
  ok('⑦b 引用体递归出子块', qs.length > 0 && qs[0].children.length >= 2);
  const inner: MdBlock[] = qs.length > 0
    ? qs[0].children.filter((c: MdBlock) => c.kind === MdBlockKind.Table) : [];
  eq('⑦c 引用里的表格被识别', inner.length, 1);
  eq('⑦d 表格单元格保留行内标记', inner.length > 0 ? inner[0].rows[0] : [], ['**粗**', '`x`']);
}

// ── ⑧ 引用里的列表也必须出来 ─────────────────────────────────────────────────
{
  const md2: string = ['- 甲', '- 乙', ''].map((l: string) => `> ${l}`).join(String.fromCharCode(10));
  const qs2: MdBlock[] = parseMarkdown(md2).filter((b: MdBlock) => b.kind === MdBlockKind.Quote);
  const ls2: MdBlock[] = qs2.length > 0
    ? qs2[0].children.filter((c: MdBlock) => c.kind === MdBlockKind.List) : [];
  eq('⑧ 引用里的列表被识别', ls2.length, 1);
  eq('⑧b 两个项', ls2.length > 0 ? ls2[0].items.length : -1, 2);
}

console.log(`md_table_inline: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
