/**
 * 语法高亮适配层门禁 —— `core/highlight.ets`。
 *
 * 本模块把 **Prism4j** 的分词结果摊平成带"语义色键"的 span（配色由设计系统决定）。
 * 可脱机测的部分：
 *   · **映射表**（`tokenKey` / `prismLangName` / `langFromFence`）—— 真逻辑；
 *   · **退化路径**（`highlightCode` / `supportsLang`）—— 库不可用/超长/未知语言时
 *     必须**零丢失**地返回纯文本，绝不吞内容、绝不抛异常。
 *
 * ⚠️ Prism4j 是 bytecode HAR，脱机环境由 `tools/tests/mocks/prism4j.js` 提供 stub
 *    （其 `grammar()` 恒返回 null）⇒ 这里断言的是"库缺席时的安全姿态"。
 *    真实着色效果在真机验收（`docs/TOOLPOPOVER-SPEC.md`）。
 */
declare const process: { exit: (c: number) => void };

import {
  HlSpan, K_COMMENT, K_DIFF_ADD, K_DIFF_DEL, K_FUNC, K_KEYWORD, K_NUMBER, K_OP, K_PROP,
  K_PUNCT, K_STRING, K_TAG, K_TYPE, MAX_HL_CHARS, highlightCode, langFromFence,
  prismLangName, supportsLang, tokenKey,
} from '../../entry/src/main/ets/core/highlight';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
/** 把 span 序列拼回原串（**不变量**：着色绝不能改内容）。 */
function rejoin(spans: HlSpan[]): string {
  let s = '';
  for (let i = 0; i < spans.length; i++) { s += spans[i].text; }
  return s;
}

// ── tokenKey：Prism 类型 ⇒ 语义色键（前缀匹配，大小写不敏感）─────────────────
eq('comment', tokenKey('comment'), K_COMMENT);
eq('string', tokenKey('string'), K_STRING);
eq('string-interpolation 前缀命中 string', tokenKey('string-interpolation'), K_STRING);
eq('attr-value ⇒ string', tokenKey('attr-value'), K_STRING);
eq('keyword', tokenKey('keyword'), K_KEYWORD);
eq('boolean ⇒ keyword', tokenKey('boolean'), K_KEYWORD);
eq('number', tokenKey('number'), K_NUMBER);
eq('function', tokenKey('function'), K_FUNC);
eq('property ⇒ prop', tokenKey('property'), K_PROP);
eq('attr-name ⇒ prop', tokenKey('attr-name'), K_PROP);
eq('class-name ⇒ type', tokenKey('class-name'), K_TYPE);
eq('builtin ⇒ type', tokenKey('builtin'), K_TYPE);
eq('operator', tokenKey('operator'), K_OP);
eq('punctuation', tokenKey('punctuation'), K_PUNCT);
eq('tag', tokenKey('tag'), K_TAG);
eq('inserted ⇒ diff-add', tokenKey('inserted'), K_DIFF_ADD);
eq('deleted ⇒ diff-del', tokenKey('deleted'), K_DIFF_DEL);
eq('大小写不敏感 COMMENT', tokenKey('COMMENT'), K_COMMENT);
eq('未知类型回落空串', tokenKey('whatever'), '');
eq('空类型回落空串', tokenKey(''), '');

// ── prismLangName：本项目写法 ⇒ Prism 语法名 ─────────────────────────────────
eq('ArkTS/ets/ts/tsx ⇒ typescript', prismLangName('ArkTS'), 'typescript');
eq('ets ⇒ typescript', prismLangName('ets'), 'typescript');
eq('tsx ⇒ typescript', prismLangName('tsx'), 'typescript');
eq('js ⇒ javascript', prismLangName('js'), 'javascript');
eq('shell ⇒ bash', prismLangName('shell'), 'bash');
eq('console ⇒ bash', prismLangName('console'), 'bash');
eq('yml ⇒ yaml', prismLangName('yml'), 'yaml');
eq('py ⇒ python', prismLangName('py'), 'python');
eq('c++ ⇒ cpp', prismLangName('c++'), 'cpp');
eq('c# ⇒ csharp', prismLangName('c#'), 'csharp');
eq('htm ⇒ markup', prismLangName('htm'), 'markup');
eq('text/plain/txt ⇒ 空（不着色）', prismLangName('plaintext'), '');
eq('txt ⇒ 空', prismLangName('txt'), '');
eq('空串 ⇒ 空', prismLangName(''), '');
eq('未列出的小写透传', prismLangName('Rust'), 'rust');
eq('首尾空白被裁掉', prismLangName('  json  '), 'json');

// ── langFromFence：从代码围栏信息取语言 ──────────────────────────────────────
eq('```json ⇒ json', langFromFence('json'), 'json');
eq('带属性的围栏取首词', langFromFence('js title=x'), 'js');
eq('大写归一', langFromFence('JSON'), 'json');
eq('空围栏', langFromFence(''), '');
eq('纯空白', langFromFence('   '), '');

// ── supportsLang：库缺席（stub）时安全回落 false，不抛异常 ───────────────────
eq('库缺席时 json 也不硬撑', supportsLang('json'), false);
eq('无语言名', supportsLang(''), false);
eq('text 无语言名', supportsLang('text'), false);

// ── highlightCode：退化路径必须**零丢失** ───────────────────────────────────
const code = '{ "name": "HarmonyOS", "n": 42 }';
const spans = highlightCode(code, 'json');
eq('退化仍能拼回原文', rejoin(spans), code);
eq('退化无色键（默认前景）', spans.length >= 1 && spans[0].key === '', true);
eq('空输入不抛且为空串', rejoin(highlightCode('', 'json')), '');
// 超长文本：跳过语法分析，原样返回（防阻塞 UI 线程）
const huge = 'x'.repeat(MAX_HL_CHARS + 10);
eq('超长文本零丢失', rejoin(highlightCode(huge, 'json')).length, huge.length);
// 未知语言 ⇒ 纯文本
eq('未知语言零丢失', rejoin(highlightCode('a+b=1', 'nosuchlang')).length, 5);
// 无语言名 ⇒ 纯文本
eq('无语言名零丢失', rejoin(highlightCode('任何文本\n第二行', '')).length, '任何文本\n第二行'.length);

console.log(`  highlight: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
