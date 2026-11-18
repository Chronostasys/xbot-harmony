/**
 * Markdown **自动链接（autolink）**判据 — 用户 2026-11-06 截图亲报：
 *
 *   「文档已发布： <https://neocloud.feishu.cn/docx/VM3gdigySolc6rxUmuScW4Q0ned>」
 *
 * 真机上**尖括号原样上屏**、整段不可点：`parseInline` 只认 `[text](href)`，
 * 不认 CommonMark 的 `<url>` 自动链接，也不认 GFM 的裸链自动链接（remark-gfm 两者都开）。
 * ⇒ web 里是可点的短链，原生是「一串带 <> 的死文本」。
 *
 * 本判据钉住（⛔ 先红后修：当前实现下 §1/§2/§3 全红）：
 *   §1 `<scheme:…>` 自动链接：剥掉尖括号，text 与 href 都是 URL 本身
 *   §2 裸链（GFM autolink literal）：`http://` / `https://` / `www.`
 *   §3 边界：中文标点/句号/右括号不吃进链接；行内代码里的 URL **不得**变成链接
 *   §4 既有 `[text](href)` 语义不变；纯文本仍走单 span 快路径（性能守卫）
 */
declare const process: { exit: (c: number) => void };

import { MdSpan, parseInline } from '../../entry/src/main/ets/core/markdown';

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

/** 把所有 span 压成 `text | link` 便于断言。 */
function links(text: string): string[] {
  const out: string[] = [];
  const spans: MdSpan[] = parseInline(text);
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].link.length > 0) {
      out.push(spans[i].text + '|' + spans[i].link);
    }
  }
  return out;
}
function plainText(text: string): string {
  const spans: MdSpan[] = parseInline(text);
  let s = '';
  for (let i = 0; i < spans.length; i++) {
    s += spans[i].text;
  }
  return s;
}

// ── §1 `<url>` 自动链接（CommonMark）─────────────────────────────────────────
console.log('\n▶ §1 尖括号自动链接');
{
  eq('§1 <https://…> ⇒ 单链接，尖括号被剥掉',
    links('文档已发布： <https://neocloud.feishu.cn/docx/VM3g>'),
    ['https://neocloud.feishu.cn/docx/VM3g|https://neocloud.feishu.cn/docx/VM3g']);
  eq('§1 上屏文本不含尖括号', plainText('<https://a.com/x>'), 'https://a.com/x');
  eq('§1 <mailto:…> ⇒ text 去 scheme、href 保留 mailto',
    links('<mailto:someone@example.com>'), ['someone@example.com|mailto:someone@example.com']);
  eq('§1 不是 URL 的 <xxx> 原样保留', plainText('a <b> c'), 'a <b> c');
  eq('§1 未闭合的 <https://a.com 原样保留', plainText('<https://a.com'), '<https://a.com');
}

// ── §2 裸链（GFM autolink literal）───────────────────────────────────────────
console.log('\n▶ §2 裸链自动链接');
{
  eq('§2 https 裸链变链接', links('见 https://a.com/x 末尾'), ['https://a.com/x|https://a.com/x']);
  eq('§2 http 裸链变链接', links('http://a.com'), ['http://a.com|http://a.com']);
  eq('§2 www 裸链补 http://', links('www.example.com'), ['www.example.com|http://www.example.com']);
  eq('§2 中文标点不吃进链接', links('见 https://a.com/x。'), ['https://a.com/x|https://a.com/x']);
  eq('§2 逗号/顿号不吃进链接', links('a https://a.com/x，b'), ['https://a.com/x|https://a.com/x']);
  eq('§2 行末右括号不计入（无配对左括号）', links('(https://a.com/x)'), ['https://a.com/x|https://a.com/x']);
  eq('§2 URL 内的配对括号保留', links('https://a.com/a(b)c'), ['https://a.com/a(b)c|https://a.com/a(b)c']);
  eq('§2 多个裸链各自成链接', links('https://a.com/1 与 https://b.com/2'),
    ['https://a.com/1|https://a.com/1', 'https://b.com/2|https://b.com/2']);
}

// ── §3 边界：代码内不自动链接 ────────────────────────────────────────────────
console.log('\n▶ §3 边界');
{
  eq('§3 行内代码里的 URL 不变链接', links('`https://a.com/x`'), []);
  eq('§3 行内代码仍是 code span', (() => {
    const sp: MdSpan[] = parseInline('`https://a.com/x`');
    return sp.length === 1 && sp[0].code === true && sp[0].text === 'https://a.com/x';
  })(), true);
  eq('§3 单词粘连不误判（xhttps://a.com 不算）', links('xhttps://a.com'), []);
  eq('§3 无协议无 www 的域名不链接', links('example.com/path'), []);
}

// ── §4 既有语义不变 ──────────────────────────────────────────────────────────
console.log('\n▶ §4 回归');
{
  eq('§4 [text](href) 语义不变', links('看 [文档](https://a.com/x) 吧'), ['文档|https://a.com/x']);
  eq('§4 纯文本仍单 span（快路径）', (() => {
    const sp: MdSpan[] = parseInline('一段没有任何标记的普通文本');
    return sp.length === 1 && sp[0].text === '一段没有任何标记的普通文本' && !sp[0].code;
  })(), true);
  eq('§4 粗体/斜体不受影响', (() => {
    const sp: MdSpan[] = parseInline('**粗** 和 *斜*');
    return sp.filter((s) => s.bold).length === 1 && sp.filter((s) => s.italic).length === 1;
  })(), true);
  eq('§4 自动链接可与粗体共存（不吞标记）', (() => {
    const sp: MdSpan[] = parseInline('**https://a.com/x**');
    return sp.length >= 1 && sp[0].bold === true;
  })(), true);
}

console.log(`\n=== md_autolink: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};
