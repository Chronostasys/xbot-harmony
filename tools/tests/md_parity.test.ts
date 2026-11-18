/**
 * Markdown **与 web 能力对齐** 判据（用户 2026-11-06：「把 web 和原生的 md 渲染能力对齐」）。
 *
 * ── 审计（web `components/agent/MarkdownRenderer.tsx`）────────────────────────────
 *   remark-gfm      ：表格 / 任务列表 / 删除线 / 自动链接（原生已对齐，见 `md_autolink`）
 *   remark-math     ：`$…$` 行内公式、`$$…$$` 块公式
 *   rehype-katex    ：公式排版（原生**无法**移植 KaTeX —— 没有 JS 引擎；降级为等宽公式块）
 *   源级预处理       ：`stripFrontmatter`（YAML 头不能被当成 setext 标题吞掉）
 *                     `normalizeMathDelimiters`（`\(…\)`/`\[…\]` ⇒ `$…$`/`$$…$$`，代码围栏内不动）
 *                     `clipTrailingUnclosedMath`（流式期裁掉未闭合公式尾部，避免半截 TeX 上屏）
 *   mermaid 围栏     ：web 画图；原生无渲染器 ⇒ 仍是**代码块**（但 lang 必须保留 `mermaid`，可识别）
 *
 * 本判据钉住原生侧的三件缺失（⛔ 先红后修：当前实现下 §1/§2/§3 全红）：
 *   §1 frontmatter 剥离       §2 块公式 `$$…$$`      §3 行内公式 `$…$`
 *   §4 定界符归一             §5 流式未闭合裁剪      §6 mermaid 围栏不被当成公式
 */
declare const process: { exit: (c: number) => void };

import {
  MdBlock, MdBlockKind, MdSpan, clipTrailingUnclosedMath, normalizeMathDelimiters,
  parseInline, parseMarkdown, stripFrontmatter,
} from '../../entry/src/main/ets/core/markdown';

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
function kinds(src: string): number[] {
  return parseMarkdown(src).map((b: MdBlock) => b.kind);
}
function firstOf(src: string, kind: number): MdBlock | null {
  const bs: MdBlock[] = parseMarkdown(src);
  for (let i = 0; i < bs.length; i++) {
    if (bs[i].kind === kind) {
      return bs[i];
    }
  }
  return null;
}
function mathSpans(text: string): MdSpan[] {
  return parseInline(text).filter((s: MdSpan) => s.math);
}

// ── §1 frontmatter：YAML 头必须被剥掉（web `lib/markdown.ts:stripFrontmatter`）──────
console.log('\n▶ §1 frontmatter');
{
  eq('§1 文档头的 --- 块被剥掉', stripFrontmatter('---\nname: a\ndescription: b\n---\n\n# 标题\n'), '# 标题\n');
  eq('§1 无 frontmatter 原样返回', stripFrontmatter('# 标题\n正文'), '# 标题\n正文');
  eq('§1 非文档头的 --- 不动（水平线）', stripFrontmatter('甲\n\n---\n\n乙'), '甲\n\n---\n\n乙');
  eq('§1 未闭合的 --- 不动', stripFrontmatter('---\nname: a'), '---\nname: a');
  eq('§1 恰好只有 frontmatter ⇒ 空串', stripFrontmatter('---\na: b\n---\n'), '');
  ok('§1 frontmatter 不会被解析成标题/正文',
    parseMarkdown(stripFrontmatter('---\nname: a\n---\n# 标题')).filter((b: MdBlock) => b.kind === MdBlockKind.Heading).length === 1);
}

// ── §2 块公式 `$$…$$` ────────────────────────────────────────────────────────
console.log('\n▶ §2 块公式');
{
  const one: MdBlock | null = firstOf('$$E=mc^2$$', MdBlockKind.Math);
  ok('§2 单行 $$…$$ 成为 Math 块', one !== null);
  eq('§2 单行块公式正文（不含 $$）', one !== null ? one.code : '', 'E=mc^2');
  const multi: MdBlock | null = firstOf('$$\na = b \\\\\nc\n$$', MdBlockKind.Math);
  ok('§2 多行 $$…$$ 成为 Math 块', multi !== null);
  ok('§2 多行正文保留换行', multi !== null && multi.code.indexOf('\n') > 0,
    multi !== null ? JSON.stringify(multi.code) : 'null');
  ok('§2 块公式前后正文仍是独立块',
    kinds('前文\n\n$$\nx\n$$\n\n后文').filter((k: number) => k === MdBlockKind.Math).length === 1);
  ok('§2 代码围栏里的 $$ 不变公式', firstOf('```\n$$x$$\n```', MdBlockKind.Math) === null);
}

// ── §3 行内公式 `$…$` ────────────────────────────────────────────────────────
console.log('\n▶ §3 行内公式');
{
  const sp: MdSpan[] = mathSpans('公式 $x^2$ 结束');
  eq('§3 行内 $…$ 成为 math span', sp.length, 1);
  eq('§3 行内公式正文去定界符', sp.length > 0 ? sp[0].text : '', 'x^2');
  eq('§3 行内公式外侧文本不丢', parseInline('公式 $x^2$ 结束').map((s: MdSpan) => s.text).join(''), '公式 x^2 结束');
  eq('§3 行内代码里的 $ 不变公式', mathSpans('`$x$`').length, 0);
  eq('§3 未闭合 $ 不吞正文', mathSpans('价格 $5 元').length, 0);
  eq('§3 金额 $5$ 可成公式（成对才认）', mathSpans('$5$').length, 1);
}

// ── §4 定界符归一（web `normalizeMathDelimiters`）─────────────────────────────
console.log('\n▶ §4 定界符归一');
{
  eq('§4 \\( \\) ⇒ $ $', normalizeMathDelimiters('a \\(x\\) b'), 'a $x$ b');
  eq('§4 \\[ \\] ⇒ $$ $$', normalizeMathDelimiters('a \\[x\\] b'), 'a $$x$$ b');
  eq('§4 代码围栏内不归一', normalizeMathDelimiters('```\n\\(x\\)\n```'), '```\n\\(x\\)\n```');
  eq('§4 行内代码内不归一', normalizeMathDelimiters('`\\(x\\)`'), '`\\(x\\)`');
}

// ── §5 流式未闭合裁剪（web `clipTrailingUnclosedMath`）───────────────────────
console.log('\n▶ §5 流式未闭合裁剪');
{
  eq('§5 未闭合块公式尾部被裁掉', clipTrailingUnclosedMath('前文\n\n$$\na = b'), '前文\n\n');
  eq('§5 已闭合块公式不动', clipTrailingUnclosedMath('前文\n\n$$\na\n$$\n'), '前文\n\n$$\na\n$$\n');
  // web 口径：裁到未闭合 `$` 之前（**保留 `$` 前的空格** —— 与 `MarkdownRenderer.tsx:462-464`
  // 的 `slice(0, cut)` 逐字一致；被裁掉的只有 `$` 及其后的半截公式）
  eq('§5 末行未闭合行内 $ 被裁掉', clipTrailingUnclosedMath('前文\n公式 $x'), '前文\n公式 ');
  ok('§5 ⛔ 绝不裁成空串（$$ 打头时转义保留正文）',
    clipTrailingUnclosedMath('$$\na = b').trim().length > 0
    && clipTrailingUnclosedMath('$$\na = b').indexOf('a = b') > 0);
  eq('§5 代码围栏里的 $$ 不参与裁剪', clipTrailingUnclosedMath('```\n$$\n```'), '```\n$$\n```');
}

// ── §6 mermaid 围栏：仍是代码块（原生无渲染器），但语言标识保留 ─────────────────
console.log('\n▶ §6 mermaid');
{
  const code: MdBlock | null = firstOf('```mermaid\ngraph TD;\nA-->B\n```', MdBlockKind.Code);
  ok('§6 mermaid 围栏是代码块', code !== null);
  eq('§6 语言标识保留 mermaid', code !== null ? code.lang : '', 'mermaid');
  eq('§6 不会被误判成块公式', kinds('```mermaid\ngraph TD;\n```').filter((k: number) => k === MdBlockKind.Math).length, 0);
}

console.log(`\n=== md_parity: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};
