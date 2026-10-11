/**
 * markdown_code_overflow.test.ts —— **代码块不得横向撑破父级**（用户截图缺陷 · 2026-10-11）。
 *
 * 背景（用户截图，深色看一条 Markdown 回答）：右侧被裁三处同源 ——
 *   ① 正文首段右缘被裁（`…123.45, 64.00, -67` / 下一行才接 `8.90"）`）；
 *   ② 代码块"长行 + 右对齐注解"（`/data … ← 只要 X`）末行被裁；
 *   ③ 根因：**代码块容器无上界、不裁剪** ⇒ 内层 Text 固有宽度（=最长行宽）把**父级**顶宽 ⇒
 *      连**整条消息列**都超出视口右缘。
 *
 * ── 判据（形态断言）────────────────────────────────────────────────────────────
 *  `MarkdownView` 的 `CodeBlock` 根容器必须同时具备：
 *    - `.constraintSize({ maxWidth: '100%' })`  ⇒ 宽度**锁死在父级**（不被内容反推）；
 *    - `.clip(true)`                             ⇒ 任何残余超宽只在块内被裁（横向滚动由内层 Scroll 负责）。
 *  自证：打印抽取的 builder 体长度 + 两个护栏的命中；**零扫描判红**（抽不到 builder ⇒ 红）；
 *  **mutation**：把 `clip(true)` 抽掉 ⇒ `guarded()` 必假（判据有判别力）。
 *
 * ⚠️ 本文件是**本线（explore / chat-surface）自有命名空间**，与 `contrast-ux` 的全局
 *    `horizontal_overflow_gate` 互不覆盖。⛔ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])[ \t]*\/\/[^\n]*/g, '$1');
}

const REPO: string = findRoot();
ok('探测到仓库根', REPO.length > 0);
const MV = 'entry/src/main/ets/components/MarkdownView.ets';

/** 抽 `CodeBlock(...) { <body> }` 的 builder 体（花括号配对）。
 *  ⚠️ 必须取**定义处**：`indexOf('CodeBlock(')` 会先命中**调用点** `this.CodeBlock(b)`
 *  （`Block()` 里，正文之前）⇒ 用 `lastIndexOf` 取定义（本轮实测踩过：抽到 126 字符的错区）。 */
function codeBlockBody(src: string): string {
  const sig: number = src.lastIndexOf('CodeBlock(');
  if (sig < 0) { return ''; }
  const open: number = src.indexOf('{', sig);
  if (open < 0) { return ''; }
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === '{') { d++; } else if (ch === '}') { d--; if (d === 0) { return src.substring(open + 1, i); } }
  }
  return '';
}
/** 护栏：根容器同时有 `maxWidth(100%)` 与 `clip(true)`。 */
function guarded(body: string): boolean {
  return body.indexOf("constraintSize({ maxWidth: '100%' })") >= 0 && body.indexOf('.clip(true)') >= 0;
}

const raw: string = fs.readFileSync(path.join(REPO, MV), 'utf8');
const body: string = codeBlockBody(stripComments(raw));
console.log(`  scan file=${MV} builderBodyLen=${body.length}`);
ok('零扫描判红：抽到 CodeBlock builder 体（长度 > 0，否则正则/真源脱节 ⇒ 白绿）', body.length > 0);
console.log(`  guards: maxWidth=${body.indexOf("constraintSize({ maxWidth: '100%' })") >= 0} clip=${body.indexOf('.clip(true)') >= 0}`);

// ★① 形态断言
ok('★① CodeBlock 根容器设 `.constraintSize({ maxWidth: \'100%\' })`（宽度锁死父级）',
  body.indexOf("constraintSize({ maxWidth: '100%' })") >= 0);
ok('★② CodeBlock 根容器设 `.clip(true)`（超宽只在块内被裁）', body.indexOf('.clip(true)') >= 0);
ok('★③ 两者**同时**在位（guarded）', guarded(body));

// ★④ 横向溢出策略仍在（wrap ⇒ BREAK_ALL；非 wrap ⇒ 横向 Scroll）—— 防"用裁剪冒充换行、丢数据"
ok('★④ 换行模式仍走 `WordBreak.BREAK_ALL`（⛔ 不是靠裁剪）', body.indexOf('WordBreak.BREAK_ALL') >= 0);
ok('★④ 非换行模式仍有 `ScrollDirection.Horizontal`（⛔ 不是靠裁剪）', body.indexOf('ScrollDirection.Horizontal') >= 0);

// ★⑥ **外层横向 `Scroll` 自身**必须有 `clip(true)`（H0 硬红；contrast-ux 复核指出上轮只给根容器加了、
//     Scroll 本身没有 ⇒ 内容仍可能按最长行撑宽父级）。点名断言：**Scroll 自己的属性链**上有 `.clip(true)`
//     （⛔ 必须只取 Scroll 的链 —— 根容器那处 `clip(true)` 在它**之后**，直接用 `indexOf(clip, scIdx)`
//      会被根容器那处满足 ⇒ 判据"假有牙"；本轮实测踩到）。
const scIdx: number = body.indexOf('.scrollable(ScrollDirection.Horizontal)');
const scEnd: number = scIdx >= 0 ? body.indexOf('} else', scIdx) : -1;
const scChain: string = scIdx >= 0 ? (scEnd > scIdx ? body.substring(scIdx, scEnd) : body.substring(scIdx)) : '';
ok('★⑥ 抽到代码块外层横向 Scroll 的自身属性链', scChain.length > 0);
ok('★⑥ 该链上有 `.clip(true)`（Scroll 自裁）', scChain.indexOf('.clip(true)') >= 0);

// ★⑤ mutation：抽掉码块体里**全部** `clip(true)` ⇒ guarded 必假（判据有判别力）
//   ⚠️ 必须 `split/join` 全删：现在码块体有**两处** `clip(true)`（Scroll 自身 + 根容器），
//      `replace` 只删第一处 ⇒ 旧写法会"删了但判据仍真"（本轮实测踩到）。
const broken: string = body.split('.clip(true)').join('');
ok('★⑤ mutation：抽掉全部 `clip(true)` ⇒ guarded=false（判据有判别力）', guarded(broken) === false);
// ★⑤b mutation：抽掉 maxWidth ⇒ guarded 必假
const broken2: string = body.replace("constraintSize({ maxWidth: '100%' })", '');
ok('★⑤b mutation：抽掉 `maxWidth` ⇒ guarded=false', guarded(broken2) === false);
// ★⑤c mutation：只抽掉 **Scroll 自身链**那处 `clip(true)` ⇒ ★⑥ 必假（证明 ★⑥ 真管 Scroll、不是被根容器满足）
const scBroken: string = scChain.replace('.clip(true)', '');
ok('★⑤c mutation：只抽掉 Scroll 自身 clip ⇒ ★⑥ 判假', scChain.indexOf('.clip(true)') >= 0 && scBroken.indexOf('.clip(true)') < 0);

console.log(`  markdown_code_overflow: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
