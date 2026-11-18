/**
 * 行内代码 `…` **渲染缺失**判据 —— 用户 2026-11-07 截图亲报：
 *   「inline code 怎么有时候没渲染」。
 *
 * 截图事实（同一条消息里三种状态并存）：
 *   · `_attn_probe` / `feat/mixed-lora-slots` / `e1d6c38352` ⇒ 正常 code chip
 *   · `` `ebc178d0b2` ``（**段首**，后面接 `→` + 链接）⇒ **反引号原样上屏**
 *   · 表格「证据」列里的 `` `git diff …` `` ⇒ 反引号原样上屏
 *
 * 根因（本文件钉死，回退即红）：
 *   ① **表格按 `|` 裸切单元格**（`splitRow`）⇒ 单元格里的 `` `a|b` `` 被切成两半，
 *      各自只剩一个反引号 ⇒ 永远配不成对 ⇒ 反引号上屏（web 的 GFM 切格**尊重行内代码**）。
 *   ② **强调/删除线内部的 code 不递归**（`**`x`**`）：`**…**` 分支把内部文本整段吃成
 *      一个 bold span ⇒ 反引号原样上屏（web 渲染 `<strong><code>x</code></strong>`）。
 *   ③ **多反引号 code span**（``` ``a`b`` ```）：只找最近的一个反引号 ⇒ 内容被截断。
 *   ④ 落单的反引号（真的没闭合）**必须**保持纯文本（不能吞掉后续正文）。
 */
declare const process: { exit: (c: number) => void };

import { MdBlock, MdBlockKind, MdSpan, parseInline, parseMarkdown } from '../../entry/src/main/ets/core/markdown';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail.length > 0 ? '\n      ' + detail : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
}
/** 把所有 span 还原成"上屏文本"（用于判断反引号是否泄漏）。 */
function plain(text: string): string {
  const sp: MdSpan[] = parseInline(text);
  let s = '';
  for (let i = 0; i < sp.length; i++) {
    s += sp[i].text;
  }
  return s;
}
function codeTexts(text: string): string[] {
  const out: string[] = [];
  const sp: MdSpan[] = parseInline(text);
  for (let i = 0; i < sp.length; i++) {
    if (sp[i].code) {
      out.push(sp[i].text);
    }
  }
  return out;
}

// ── §1 段首 code + 箭头 + 链接（截图第一处）──────────────────────────────────
console.log('\n▶ §1 段首行内码');
{
  eq('§1 段首 `x` 是 code span', codeTexts('`ebc178d0b2` → https://a.com/x'), ['ebc178d0b2']);
  eq('§1 上屏文本不含反引号（段首）', plain('`ebc178d0b2` → https://a.com/x'), 'ebc178d0b2 → https://a.com/x');
  eq('§1 段中 `x` 是 code span', codeTexts('见 `git diff` 输出'), ['git diff']);
  eq('§1 含空格的 code 正常', codeTexts('`git diff HEAD --stat`'), ['git diff HEAD --stat']);
  eq('§1 行首缩进后 code 正常', codeTexts('  `x` 后文'), ['x']);
}

// ── §2 表格单元格（截图第二处）──────────────────────────────────────────────
console.log('\n▶ §2 表格单元格');
{
  const bs: MdBlock[] = parseMarkdown('| 检查项 | 证据 |\n| --- | --- |\n| A | `git diff` |\n');
  const tb: MdBlock | null = bs.length > 0 && bs[0].kind === MdBlockKind.Table ? bs[0] : null;
  ok('§2 表格解析成功', tb !== null);
  eq('§2 单元格保留 code 文本', tb !== null ? tb.rows[0] : [], ['A', '`git diff`']);
  eq('§2 单元格里的 code 能渲染（反引号被吃）', tb !== null ? codeTexts(tb.rows[0][1]) : [], ['git diff']);
  // ⭐ 截图根因：单元格里**含竖线**的行内代码不得被裸切成两列（GFM 切格尊重 code span）
  const bs2: MdBlock[] = parseMarkdown('| 检查项 | 证据 |\n| --- | --- |\n| A | `git diff --stat \\| head` |\n');
  const tb2: MdBlock | null = bs2.length > 0 && bs2[0].kind === MdBlockKind.Table ? bs2[0] : null;
  eq('§2 含 \\| 转义的单元格不被切列', tb2 !== null ? tb2.rows[0].length : -1, 2);
  // GFM 的表格语法要求单元格内的裸 `|` 用 `\|` 转义；但模型常直接写 `a|b`，
  // 我们至少要保证：**成对反引号内的 `|` 不切列**（否则必然漏渲染）
  const bs3: MdBlock[] = parseMarkdown('| 检查项 | 证据 |\n| --- | --- |\n| A | `a|b` |\n');
  const tb3: MdBlock | null = bs3.length > 0 && bs3[0].kind === MdBlockKind.Table ? bs3[0] : null;
  eq('§2 code span 内的裸 | 不切列', tb3 !== null ? tb3.rows[0].length : -1, 2);
  eq('§2 code span 内的裸 | 可渲染', tb3 !== null ? codeTexts(tb3.rows[0][1]) : [], ['a|b']);
}

// ── §3 强调 / 删除线里的 code（不再泄漏反引号）──────────────────────────────
console.log('\n▶ §3 嵌套');
{
  eq('§3 **`x`** 里 code 被识别', codeTexts('**`x`**'), ['x']);
  eq('§3 **`x`** 上屏无反引号', plain('**`x`**'), 'x');
  ok('§3 **`x`** 同时保留 bold', parseInline('**`x`**')[0].bold === true
    && parseInline('**`x`**')[0].code === true);
  eq('§3 ~~`x`~~ 里 code 被识别', codeTexts('~~`x`~~'), ['x']);
  eq('§3 *`x`* 里 code 被识别', codeTexts('*`x`*'), ['x']);
  eq('§3 粗体正文不被误判成 code', codeTexts('**普通粗体**'), []);
  eq('§3 粗体正文仍 bold', plain('**普通粗体**'), '普通粗体');
}

// ── §4 多反引号 code span（CommonMark：等长配对）────────────────────────────
console.log('\n▶ §4 多反引号');
{
  eq('§4 ``a`b`` ⇒ 内容 a`b', codeTexts('``a`b``'), ['a`b']);
  eq('§4 ``a`b`` 上屏无多余反引号', plain('``a`b``'), 'a`b');
  eq('§4 单个反引号语义不变', codeTexts('`a`'), ['a']);
  eq('§4 落单反引号保持纯文本', plain('价格 `50'), '价格 `50');
}

// ── §5 回归：既有形态不受影响 ───────────────────────────────────────────────
console.log('\n▶ §5 回归');
{
  eq('§5 列表项里的 code', codeTexts('- `git add` 一下'), ['git add']);
  eq('§5 链接与 code 并存', plain('看 `a` 和 [链](https://x.com)'),
    '看 a 和 链');
  eq('§5 行内公式仍工作', parseInline('$x^2$').filter((s: MdSpan) => s.math).length, 1);
  eq('§5 代码里的 $ 不当公式', parseInline('`$x$`').filter((s: MdSpan) => s.math).length, 0);
}

console.log(`\n=== md_inline_code: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};
