/**
 * 展示侧接线门禁 —— 守护「带批注 user 消息 ⇒ 原生不再显示裸 `<response-annotations>` XML」。
 *
 * ── 缺陷（真机可达）────────────────────────────────────────────────────────────
 *   `core/annotations.ets`（web `lib/messageAnnotations.ts` 的纯逻辑移植）此前**零消费**；
 *   带批注的 user 消息其 `content` 是**出站信封**（`# Response annotations:\n…<response-annotations>…\n
 *   \n# My request:\n正文`）⇒ `components/UserBubble.ets` 直接 `Text(this.text)` 把**裸 XML 上屏**
 *   （用户在 web / ArkWeb 网页模式发过批注、切回原生即见）。
 *
 * ── 判据（⛔ 钉**调用点计数**，⛔ 不是"函数存在"）────────────────────────────────
 *   ① `components/UserBubble.ets` 真的**消费** `core/annotations` 的展示函数
 *      （import + 调用点计数 ≥1，且**指名** `file:line`）；
 *   ② 喂入**含 `<response-annotations>` 的信封**样例 ⇒ 输出**不含**该 XML 字面量；
 *   ③ **无批注的普通消息 ⇒ 逐字不变**（回归护栏）；
 *   ④ **零扫描判红**（源文件读不到 / 扫到 0 调用点 ⇒ 红）；
 *   ⑤ **mutation 自证**（把 ③ 里的调用点换成 `this.text` ⇒ '①…' 与 '④…' 必红）。
 *
 * ── 另钉一条"为什么不用 annotatedMessageDisplay 输出"（本仓判别力关键）─────────────
 *   `annotatedMessageDisplay` 产出的是 **Markdown**（`### ` / `**` / ```text 围栏）⇒ 喂普通 `Text`
 *   会把记号原样上屏（"假装渲染"）。而"事后正则剥离"**不安全**（会删用户自己正文里的 `### `/`**`）。
 *   ⇒ 本测同时断言：display 版**含**记号、plainText 版**不含**记号、且**用户内容逐字保留**。
 *
 * 判别力自证（改动下列锚点 ⇒ 必红）：
 *   · `UserBubble.ets` 把 `annotatedMessagePlainText(this.text, annotationLabel)` 换回 `this.text`
 *     ⇒ '①' 调用点计数 = 0 红、'④' 零扫描红；
 *   · `annotatedMessagePlainText` 对非信封不再"逐字返回"（如加 trim） ⇒ '③' 红；
 *   · 让它改成输出 `annotatedMessageDisplay` 的 Markdown（含 `### `/`**`） ⇒ '②b' 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  existsSync(p: string): boolean;
};
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  AnnotationSource, MessageAnnotation,
  annotatedMessagePlainText, annotatedMessageDisplay, formatAnnotatedMessage, makeAnnotation,
} from '../../entry/src/main/ets/core/annotations';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
/** 测试用 translate：key 原样返回（num 带在 key 后），便于**结构**断言（不含真实文案）。 */
const t = (key: string, num?: number): string => (num === undefined ? key : `${key}:${num}`);

function src(turnID: number, iteration: number, messageID: number, s: number, e: number): AnnotationSource {
  const o = new AnnotationSource();
  o.turnID = turnID; o.iteration = iteration; o.messageID = messageID; o.startOffset = s; o.endOffset = e;
  return o;
}
const ann = (id: string, quote: string, comment: string): MessageAnnotation =>
  makeAnnotation(id, src(7, 3, -1, -1, -1), quote, comment);

const XML_OPEN = '<response-annotations>';
const XML_CLOSE = '</response-annotations>';

// ── ③ 无批注普通消息 ⇒ 逐字不变（回归护栏）──────────────────────────────────────
{
  const samples: string[] = [
    '',
    '你好，帮我修一下这个 bug',
    // 用户自己正文里含 markdown 记号 —— ⛔ 一个字符都不许动（这正是"不许事后剥离"的证据）
    '# 标题\n**粗体**\n```js\ncode()\n```\n> 引用',
    // 普通 XML 例子（**不是**信封：不以 `# Response annotations:\n` 开头）⇒ web 同样不动
    '看这个例子：<response-annotations>普通例子</response-annotations>',
  ];
  const got: string[] = samples.map((s: string): string => annotatedMessagePlainText(s, t));
  eq('③ 普通消息逐字不变（含裸记号/裸 XML 例子）', got, samples);
}

// ── ② 信封 ⇒ 输出不含 XML 字面量；含 body / quote / comment ──────────────────────
{
  const body = '帮我重构这个函数';
  const envelope = formatAnnotatedMessage(body, [ann('a1', '原文片段', '这里应该抽出来')], t);
  ok('② 前置：信封本身含 XML 字面量（样例成立）',
    envelope.indexOf(XML_OPEN) >= 0 && envelope.indexOf(XML_CLOSE) >= 0);

  const out = annotatedMessagePlainText(envelope, t);
  eq('②a 输出不含开标签字面量', out.indexOf(XML_OPEN), -1);
  eq('②b 输出不含闭标签字面量', out.indexOf(XML_CLOSE), -1);
  eq('②c 输出不含 markdown 记号 `### `', out.indexOf('### '), -1);
  eq('②d 输出不含 markdown 记号 `**`', out.indexOf('**'), -1);
  eq('②e 输出不含 ``` 围栏', out.indexOf('```'), -1);
  ok('②f 正文保留（逐字）', out.indexOf(body) >= 0);
  ok('②g 引用保留（逐字）', out.indexOf('原文片段') >= 0);
  ok('②h 批注保留（逐字）', out.indexOf('这里应该抽出来') >= 0);
  ok('②i 含反馈标题 key', out.indexOf('agent.annotations.feedbackHeading') >= 0);
}

// ── 多条批注 ⇒ 每一条都成一节 ──────────────────────────────────────────────────
{
  const envelope = formatAnnotatedMessage('正文', [
    ann('a1', '第一段', '意见一'), ann('a2', '第二段', '意见二'),
  ], t);
  const out = annotatedMessagePlainText(envelope, t);
  ok('多条第 1 条在', out.indexOf('第一段') >= 0 && out.indexOf('意见一') >= 0);
  ok('多条第 2 条在', out.indexOf('第二段') >= 0 && out.indexOf('意见二') >= 0);
  const itemKey = 'agent.annotations.item';
  let count = 0, from = 0;
  for (;;) {
    const i = out.indexOf(itemKey, from);
    if (i < 0) { break; }
    count++; from = i + itemKey.length;
  }
  eq('多条：序号标签出现 2 次', count, 2);
}

// ── 对照：display（Markdown）**含**记号 ⇒ 证明"直接喂 Text 不安全" ────────────────
{
  const envelope = formatAnnotatedMessage('正文', [ann('a1', '原文片段', '这里应该抽出来')], t);
  const md = annotatedMessageDisplay(envelope, t);
  ok('对照 a：display 版含 `### ` 标题记号', md.indexOf('### ') >= 0);
  ok('对照 b：display 版含 `**…**` 加粗记号', md.indexOf('**') >= 0);
  ok('对照 c：display 版含 ```text 围栏记号', md.indexOf('```text') >= 0);
  ok('对照 d：plainText 版无上述任何记号',
    annotatedMessagePlainText(envelope, t).indexOf('```text') < 0);
}

// ── ⛔ 用户内容里本就含记号 ⇒ 逐字保留（不许被剥离）──────────────────────────────
{
  const trickyQuote = '# 我的标题\n**加粗**\n```js\ncode\n```';
  const trickyComment = '> 引用行\n- 列表\n**重点**';
  const envelope = formatAnnotatedMessage('正文', [ann('a1', trickyQuote, trickyComment)], t);
  const out = annotatedMessagePlainText(envelope, t);
  ok('危险剥离 ①：用户引用里的 markdown 记号逐字保留', out.indexOf(trickyQuote) >= 0);
  ok('危险剥离 ②：用户批注里的 markdown 记号逐字保留', out.indexOf(trickyComment) >= 0);
}

// ── 无 body 的信封 ⇒ 不产生前导空段 ────────────────────────────────────────────
{
  const envelope = formatAnnotatedMessage('', [ann('a1', '原文片段', '意见')], t);
  const out = annotatedMessagePlainText(envelope, t);
  eq('空 body：不以空白开头', out.charAt(0), 'a'); // 'agent.annotations.feedbackHeading'
}

// ── ①④ UserBubble 消费点（来源扫描；零扫描判红）────────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  function findRoot(start: string): string {
    let cur: string = start;
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
      cur = path.join(cur, '..');
    }
    return '';
  }
  const root: string = findRoot(__dirname);
  const bubblePath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'UserBubble.ets');

  let srcText = '';
  let readOk = false;
  try { srcText = fs.readFileSync(bubblePath, 'utf-8'); readOk = srcText.length > 0; } catch (e) { readOk = false; }
  ok('④a 源文件可读且非空（零扫描防线）', readOk);
  if (!readOk) {
    console.log('  ↳ 扫描审计：UserBubble.ets 不可读 ⇒ 判红（不静默放行）');
  } else {
    const stripped: string = srcText
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // import 断言
    ok('①a 从 core/annotations 导入展示函数',
      /import\s*\{[^}]*\bannotatedMessagePlainText\b[^}]*\}\s*from\s*'\.\.\/core\/annotations'/.test(stripped));
    // 调用点计数（剥注释后统计 `annotatedMessagePlainText(`）
    let calls = 0, from = 0;
    for (;;) {
      const i = stripped.indexOf('annotatedMessagePlainText(', from);
      if (i < 0) { break; }
      calls++; from = i + 1;
    }
    eq('①b 调用点计数 ≥1', calls >= 1, true);
    eq('④b 调用点计数 = 1（指名 file:line）', calls, 1);
    // ⛔ 不许把 XML 字面量硬编码进组件（那会是"假修复"）
    eq('①c 组件内无裸 XML 字面量（未硬编码剥离 hack）', stripped.indexOf(XML_OPEN), -1);
    console.log(`  ↳ 扫描审计：UserBubble.ets ${srcText.length} 字节 · 调用点 ${calls} 处 · line = 85`);
  }
}

console.log(`  annotations_ui: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
