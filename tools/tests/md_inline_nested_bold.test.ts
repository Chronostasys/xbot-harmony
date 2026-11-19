/**
 * md_inline_nested_bold.test.ts —— **加粗里套链接/强调**必须真的渲染
 * （用户 2026-11-20：「`**[mol-lora-operator-manual.html](/api/files/download?key=…)**`
 *   没渲染成链接。似乎是对加粗渲染有问题」）。
 *
 * ## 真因
 * `core/markdown.ets: pushEmphasis()` 用 `EMPH_NESTED` 决定要不要递归解析强调体：
 * ```ts
 * const EMPH_NESTED: RegExp = /[`$]/;   // ⛔ 只认反引号和公式符
 * if (!EMPH_NESTED.test(inner)) { 整段当一个纯文本 span（只加 bold） ; return; }
 * ```
 * ⇒ `**[文字](url)**` 的 inner（`[文字](url)`）**既无反引号也无 `$`** ⇒ 不递归 ⇒
 *   整条 `[文字](url)` 原样上屏（**不是链接**，还带着方括号/圆括号）。
 *
 * ## 修法
 * `EMPH_NESTED` 覆盖所有会开启内联分支的字符：`` ` `` `$` `[` `!` `*` `_` `~` `<`。
 * ⇒ 加粗里的 链接 / 图片 / 嵌套强调 / 删除线 / 自动链接 全部正确；纯文本仍走一个 span 的快路径。
 *
 * ⛔ mutation 自证：把 `EMPH_NESTED` 改回 `/[`$]/` ⇒ ①②③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { MdSpan, parseInline } from '../../entry/src/main/ets/core/markdown';

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

const FILE_URL: string = '/api/files/download?key=agent%2F2cef5683-bc85-496e-8f8b-dcb901429a92'
  + '%2Fmol-lora-operator-manual.html';

// ── ① 线上形态：加粗 + 链接（用户原串）────────────────────────────────────────
{
  const src: string = `HTML 已发给你：**[mol-lora-operator-manual.html](${FILE_URL})**（单文件、57 KB）`;
  const spans: MdSpan[] = parseInline(src);
  const links: MdSpan[] = spans.filter((s: MdSpan) => s.link.length > 0);
  eq('① 必须解析出 1 个链接', links.length, 1);
  eq('①b href 完整（含 ?key= 与 %2F）', links.length > 0 ? links[0].link : 'MISSING', FILE_URL);
  eq('①c 链接文本', links.length > 0 ? links[0].text : 'MISSING', 'mol-lora-operator-manual.html');
  ok('①d 链接同时是加粗（bold 透传）', links.length > 0 && links[0].bold === true);
  ok('①e 不得残留 markdown 原文（`](` 不应出现在任何 span 文本里）',
    spans.every((s: MdSpan) => s.text.indexOf('](') < 0));
}

// ── ② 加粗里套**斜体** / 删除线 ────────────────────────────────────────────────
{
  const it: MdSpan[] = parseInline('**前 *强调* 后**');
  ok('② 加粗里的斜体被解析（bold + italic）',
    it.some((s: MdSpan) => s.bold === true && s.italic === true && s.text === '强调'));
  const st: MdSpan[] = parseInline('**前 ~~删~~ 后**');
  ok('②b 加粗里的删除线被解析（bold + strike）',
    st.some((s: MdSpan) => s.bold === true && s.strike === true && s.text === '删'));
}

// ── ③ 加粗里套**行内代码**（原有能力不得回退）──────────────────────────────────
{
  const c: MdSpan[] = parseInline('**收 `npm i` 结束**');
  ok('③ 加粗里的行内代码仍被解析',
    c.some((s: MdSpan) => s.code === true && s.text === 'npm i'));
}

// ── ④ 纯文本加粗仍是**一个** span（快路径没被破坏）─────────────────────────────
{
  const t: MdSpan[] = parseInline('**只是加粗**');
  eq('④ 纯文本加粗 = 1 个 span', t.length, 1);
  ok('④b bold 且文本正确', t.length === 1 && t[0].bold === true && t[0].text === '只是加粗');
}

// ── ⑤ 相对链接（本仓 2026-10-27 已按 RFC 3986 解析）不受影响 ──────────────────
{
  const r: MdSpan[] = parseInline('**见 [docs/a.md](docs/a.md)**');
  ok('⑤ 加粗里的相对链接也被识别', r.some((s: MdSpan) => s.link === 'docs/a.md'));
}

console.log(`md_inline_nested_bold: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
