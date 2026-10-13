/**
 * highlight_memo.test.ts —— 语法高亮**记忆化**的判别力判据。
 *
 * 用户 2026-10-13 亲报「往上加载特别多内容后明细特别卡」，长期要求「性能也要非常好」。
 * 已实测排除的一项：行指纹 `rowsFpOf`（n=2000 仅 0.057ms/次，n=20000 才 0.6ms ⇒ 不是主因）。
 * 本文件守住的是**行重建时最贵的一步**：`highlightCode()` 每次都要跑 Prism4j 分词，而
 * `LazyForEach` 整表 reload / 主题变更 / 流式 live 行逐帧重建都会触发重建。
 *
 * ⚠️ 脱机环境里 `@hxa-atpc/noties_prism4j` 是 mock（`grammar()` 恒 `null`、`tokenize()` 恒 `[]`）
 *    ⇒ 只能覆盖**退化路径**，真实分词收益只能真机验收。因此判据钉的是**语义等价性**：
 *      · 命中缓存 ⇒ 返回**同一实例**（= 没有重算，是"零重算"的可判定证据，不依赖计时）；
 *      · 键含语言与代码全文 ⇒ 不同入参不得串味（含同语法不同别名的情形）；
 *      · 有界（条目数 + 字符数双闸）⇒ 淘汰后**必须重算**（不得返回被淘汰的旧值）；
 *      · 形态：`engine().tokenize(` **全文件唯一一处**，且落在未缓存实现里
 *        （有人把分词搬回入口 ⇒ 缓存形同虚设 ⇒ 必红）。
 *
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
import {
  HlSpan, highlightCode, highlightMemoSize, highlightMemoChars, clearHighlightMemo,
  prismLangName,
} from '../../entry/src/main/ets/core/highlight';

declare const require: (m: string) => { readFileSync(p: string, enc: string): string; existsSync(p: string): boolean; join(...p: string[]): string };
declare const __dirname: string;
declare const process: { exit(code?: number): void };
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

/** 深比：span 序列内容（文本 + 语义色键）逐项相等。 */
function sameSpans(a: HlSpan[], b: HlSpan[]): boolean {
  if (a.length !== b.length) { return false; }
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].key !== b[i].key) { return false; }
  }
  return true;
}

console.log('— 命中缓存 = 同一实例（零重算的可判定证据）—');
clearHighlightMemo();
const code1: string = 'const a = 1;\nfunction f() { return a; }';
const a1: HlSpan[] = highlightCode(code1, 'ts');
const a2: HlSpan[] = highlightCode(code1, 'ts');
ok('同入参第二次调用返回同一实例（命中缓存 ⇒ 未重算）', a1 === a2);
ok('内容未被缓存改变（首末 span 文本与入参一致）',
  sameSpans(a1, a1) && a1.length === 1 && a1[0].text === code1);
ok('表内确有 1 条（键 = 语法名 + 代码全文）', highlightMemoSize() === 1);
ok('字符计数 = 键长（语法名 + 分隔符 + 全文）',
  highlightMemoChars() === prismLangName('ts').length + 1 + code1.length);

console.log('— 键必须含语言：同语法不同别名**归一后同键**（去重，且不得跨语法串味）—');
// `ts` 与 `typescript` 归一到**同一语法名** ⇒ 键相同 ⇒ 命中同一份结果（别名胜在归一，是特性不是缺陷）。
const b1: HlSpan[] = highlightCode(code1, 'typescript');
ok('同语法不同别名 ⇒ 命中同一实例（按归一后的语法名做键，别名自动去重）', b1 === a1);
ok('同语法不同别名 ⇒ 内容等价（语义一致）', sameSpans(a1, b1));
ok('归一后仍只有 1 条键（未按原始写法各存一份）', highlightMemoSize() === 1);
// 跨语法不得串味：非同归一名的语言必须各自独立
const py1: HlSpan[] = highlightCode(code1, 'py');
ok('不同语法 ⇒ 不同实例（键含语法名 ⇒ 不跨语法串味）', py1 !== a1);
ok('两条键并存', highlightMemoSize() === 2);

console.log('— 代码全文进键：不同代码不得复用 —');
const c1: HlSpan[] = highlightCode('const a = 2;', 'ts');
ok('不同代码 ⇒ 不同实例', c1 !== a1 && c1[0].text === 'const a = 2;');
ok('原键仍命中（LRU 不误删未超限的项）', highlightCode(code1, 'ts') === a1);

console.log('— 退化路径也要缓存（未知语言 / 空串 / 超长）—');
clearHighlightMemo();
const p1: HlSpan[] = highlightCode(code1, '');
const p2: HlSpan[] = highlightCode(code1, '');
ok('无语言 ⇒ 纯文本退化且被缓存（同一实例）', p1 === p2 && p1.length === 1 && p1[0].text === code1);
ok('无语言 ⇒ 语义色键为空（不硬着色）', p1[0].key === '');
const e1: HlSpan[] = highlightCode('', 'ts');
const e2: HlSpan[] = highlightCode('', 'ts');
ok('空串 ⇒ 单段空文本且被缓存', e1 === e2 && e1.length === 1 && e1[0].text === '');

console.log('— 有界：条目数闸 + 字符数闸，淘汰后必须重算 —');
clearHighlightMemo();
const firstBody: string = 'x'.repeat(40) + '0000';
const firstOut: HlSpan[] = highlightCode(firstBody, 'json');
ok('首条已入表', highlightMemoSize() === 1);
for (let i = 0; i < 80; i++) {
  highlightCode(`y${i}${'z'.repeat(30)}`, 'json');
}
ok(`条目数不超上限（${highlightMemoSize()} ≤ 64）`, highlightMemoSize() <= 64);
ok('最旧那条已被淘汰 ⇒ 再取必须**重算**（新实例）', highlightCode(firstBody, 'json') !== firstOut);
ok('淘汰后字符计数仍不超上限', highlightMemoChars() <= 256 * 1024);

clearHighlightMemo();
const huge: string = 'q'.repeat(300 * 1024);
const h1: HlSpan[] = highlightCode(huge, 'json');
const h2: HlSpan[] = highlightCode(huge, 'json');
ok('单条超字符上限 ⇒ 不入表（两次调用各自重算）', h1 !== h2);
ok('单条超上限时表仍为空', highlightMemoSize() === 0);

console.log('— 形态：分词必须落在**未缓存实现**里（否则缓存形同虚设）—');
function findRepo(from: string): string {
  let d: string = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'entry/src/main/ets/core/highlight.ets'))) { return d; }
    d = path.join(d, '..');
  }
  return from;
}
const repo: string = findRepo(__dirname);
const src: string = fs.readFileSync(path.join(repo, 'entry/src/main/ets/core/highlight.ets'), 'utf8');
function countOf(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}
ok('零扫描白绿防线：highlight.ets 源码读到了', src.length > 2000);
ok('`engine().tokenize(` 全文件唯一一处', countOf(src, 'engine().tokenize(') === 1);
// 分词必须出现在 `highlightUncached` 里（入口 `highlightCode` 只查表 + 写表）
const entryAt: number = src.indexOf('export function highlightCode(');
const uncachedAt: number = src.indexOf('function highlightUncached(');
ok('入口与未缓存实现都取到了（非空切片）', entryAt >= 0 && uncachedAt > entryAt);
const entryBody: string = src.substring(entryAt, uncachedAt);
ok('入口体内**不出现**分词调用（只有查表/写表）', countOf(entryBody, 'engine().tokenize(') === 0);
ok('入口体内确实查了表（`HL_MEMO.get(key)`）', countOf(entryBody, 'HL_MEMO.get(key)') === 1);
ok('入口体内确实写了表（`HL_MEMO.set(key, out)`）', countOf(entryBody, 'HL_MEMO.set(key, out)') === 1);

console.log('');
console.log(`highlight_memo: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
