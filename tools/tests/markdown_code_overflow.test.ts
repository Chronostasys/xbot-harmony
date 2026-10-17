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
 *
 * ⛔ **mutation 写作铁律（本轮实测踩坑）**：同一文件里**同一属性可能出现在多处**（如码块体内
 *    有两处 `.clip(true)`：Scroll 自身 + 根容器）⇒ `str.replace('.clip(true)','')` **只删第一处**
 *    ⇒ "删了但判据仍真" ⇒ mutation **假绿**。凡做"抽掉某属性"的 mutation：
 *    ① 用 `split(x).join('')` **全删**，或；② **精确圈定目标片段**（先 `substring` 取到子串再删）。
 *    反之，"断言某属性存在"时也要**圈定片段**（否则别处的同名属性会把断言满足成"假有牙"）。
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

const raw: string = fs.readFileSync(path.join(REPO, MV), 'utf8').replace(/i18nT\(([^()]*)\)/g, '$1');
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

// ── §B 正文级 `Text` 的 `wordBreak` 不得是 `NORMAL`（长 URL / 行内码 / 长 token 会撑破容器）──────
// 背景：用户截图"正文首段尾部被裁"。web 的 markdown 用 `break-words` 兜底；原生 `Text` 默认
//   `WordBreak.NORMAL` ⇒ 无空格超长串（`https://a/b/c`、`/Users/x/y`、`a-b-c-d…`）找不到断点 ⇒ 撑宽。
// ⛔ 唯一允许 `NORMAL` 的是**代码块横滑**那处（横滑设计已裁定：内容在 Scroll 里、不折行）。
console.log('\n▶ §B 正文级 Text 的 wordBreak（不得 NORMAL，除代码块横滑）');
function matchPairB(s: string, i: number, o: string, c: string): number {
  let d = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === o) { d++; } else if (ch === c) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
function chainAfterB(s: string, i: number): string {
  const WS = ' \t\r\n';
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  let out = '';
  while (i < s.length && s.charAt(i) === '.') {
    const j = s.indexOf('(', i);
    if (j < 0) { break; }
    const k = matchPairB(s, j, '(', ')');
    if (k < 0) { break; }
    out += s.substring(i, k + 1);
    i = k + 1;
    while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  }
  return out;
}
class TSite { line = 0; arg = ''; chain = ''; }
/** 枚举 `Text(...)` / `Text() {…}` 站点，取**各自属性链**（块体在链**之前** ⇒ 先配对花括号再取链）。 */
function textSites(src: string): TSite[] {
  const out: TSite[] = [];
  const rx = /\bText\s*\(/g;
  let m: RegExpExecArray | null = rx.exec(src);
  while (m !== null) {
    const j = src.indexOf('(', m.index);
    const k = matchPairB(src, j, '(', ')');
    if (k > 0) {
      const s = new TSite();
      s.line = (src.substring(0, m.index).match(/\n/g) || []).length + 1;
      s.arg = src.substring(j + 1, k).trim().replace(/\s+/g, ' ');
      let p = k + 1;
      while (p < src.length && ' \t\r\n'.indexOf(src.charAt(p)) >= 0) { p += 1; }
      if (src.charAt(p) === '{') {
        const b = matchPairB(src, p, '{', '}');
        s.chain = b > 0 ? chainAfterB(src, b + 1) : '';
      } else {
        s.chain = chainAfterB(src, k + 1);
      }
      out.push(s);
    }
    m = rx.exec(src);
  }
  return out;
}
/** **短常量/结构性**站点豁免（无 `wordBreak` 也安全）—— ⛔ 只许缩短，每条附理由。 */
const NO_WB_EXEMPT: string[] = [
  "b.ordered ? `${k + 1}.` : '•'",         // 列表标记：定长（`N.`/`•`），无长串
  "b.lang.length > 0 ? b.lang : 'code'",    // 代码语言标签：短标识符 + 已有 layoutWeight(1) 约束宽度
  "'复制'",                                  // 固定短常量
];
const mvSrc: string = stripComments(raw);
const ts: TSite[] = textSites(mvSrc);
console.log(`  Text 站点 ${ts.length} 处`);
for (let i = 0; i < ts.length; i++) {
  const hasAll = ts[i].chain.indexOf('WordBreak.BREAK_ALL') >= 0;
  const hasNorm = ts[i].chain.indexOf('WordBreak.NORMAL') >= 0;
  const hasAny = ts[i].chain.indexOf('wordBreak(') >= 0;
  const verdict = hasAll ? 'BREAK_ALL' : (hasNorm ? '**NORMAL**' : (hasAny ? 'BREAK_WORD' : '（无 wordBreak）'));
  console.log(`    :${ts[i].line} ${verdict}  arg=${ts[i].arg.substring(0, 34)}`);
}
ok('★B0 零扫描判红：MarkdownView 的 `Text(` 站点数 > 0', ts.length > 0);
const normals: TSite[] = ts.filter((s: TSite): boolean => s.chain.indexOf('WordBreak.NORMAL') >= 0);
ok(`★B1 唯一允许 NORMAL 的是**代码块横滑**那处（实测 NORMAL ${normals.length} 处）`,
  normals.length === 1 && normals[0].arg === '');
function unexempted(sites: TSite[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < sites.length; i++) {
    if (sites[i].chain.indexOf('wordBreak(') >= 0) { continue; }       // 已有 wordBreak（ALL/WORD）
    if (NO_WB_EXEMPT.indexOf(sites[i].arg) >= 0) { continue; }         // 短常量豁免
    out.push(sites[i].arg);
  }
  return out;
}
const unex = unexempted(ts);
ok(`★B2 无 wordBreak 的站点全部在短常量豁免台账内（未豁免 ${unex.length}）`, unex.length === 0);
for (let i = 0; i < unex.length; i++) { console.log(`      [未豁免] ${unex[i]}`); }

// ★B3 mutation：合成"正文级 Text 无 wordBreak" ⇒ unexempted 必抓到（判据有牙；⛔ 不是恒真）
{
  const inj: TSite[] = textSites("build() {\n  Text(this.url)\n}\n");
  ok('★B3 mutation：`Text(this.url)` 无 wordBreak ⇒ 被 unexempted 抓到', unexempted(inj).length === 1);
  const inj2: TSite[] = textSites("build() {\n  Text(this.url).wordBreak(WordBreak.BREAK_ALL)\n}\n");
  ok('★B3 反向对照：加 `BREAK_ALL` ⇒ 不抓（不是"凡 Text 必红"）', unexempted(inj2).length === 0);
}
// ★B4 mutation：合成"正文显式 NORMAL" ⇒ 落入 normals ⇒ ★B1 会红
{
  const inj: TSite[] = textSites("build() {\n  Text(this.body)\n    .wordBreak(WordBreak.NORMAL)\n}\n");
  ok('★B4 mutation：显式 NORMAL 的正文站点落入 normals（★B1 会红）',
    inj.filter((s: TSite): boolean => s.chain.indexOf('WordBreak.NORMAL') >= 0).length === 1);
}
// ★B5 mutation：`Text() { … }` 块体形态也要能取到链（块在链**之前**，漏配对 ⇒ 链恒空 ⇒ 假结论）
{
  const inj: TSite[] = textSites("build() {\n  Text() {\n    Span(x)\n  }\n  .wordBreak(WordBreak.NORMAL)\n}\n");
  ok('★B5 mutation：块体形态 `Text(){…}.wordBreak(NORMAL)` 也能取到链（★B1 不因块而漏）',
    inj.length === 1 && inj[0].chain.indexOf('WordBreak.NORMAL') >= 0);
}

console.log(`  markdown_code_overflow: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
