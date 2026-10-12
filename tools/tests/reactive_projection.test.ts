/**
 * 「**非 `@State` 状态不得在 builder 内直读**」的通用守卫（读源码形态；纯逻辑、可脱机跑）。
 *
 * 背景（2026-10-12 连发两例同类真机缺陷）：
 *   · ① `iterStatsBadge`（批 13h）：头部 builder 内直读 `store.liveProgress().streamStats`
 *     ⇒ 头部只在 busy/currentChat/nativeCatalog 变化时重渲，而 busy 在回合**开始**即置 true
 *     ⇒ 之后指标有了却**无重渲触发** ⇒ 徽章**恒空**（真机 dump：全页 0 处 `t/s`）。
 *   · ② 忙碌占位行（批 14a）：`Text(busyLabel(this.store.liveProgress().phase))` 同样直读
 *     ⇒ 只在建行那一刻采样 phase ⇒ 压缩开始时页面级 `@State` 不一定变化 ⇒ **行不重渲**
 *     ⇒ 压缩期仍显示「思考中…」，与 web（`MessageList.tsx:1679-1686` 按 phase 二选一）分叉。
 *
 * 根因同一条（`AGENTS.md`）：**会变的值要么让行自己订阅，要么在变更路径显式发通知**。
 * ⇒ 本用例钉死一条**普遍不变式**：`pages/Index.ets` 里 `liveProgress()` **只许出现在赋值右侧**
 *   （= 投影进 `@State` / 纯计算函数），**不得出现在任何 UI 调用参数里**。
 *   （这条同时是"新写 UI 若直读 store ⇒ 必红"的前置防线，比逐点形态断言更耐腐化。）
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ⛔ `run-one.sh` 把测试编译到 `.out.$$/js/` 下再跑 ⇒ `__dirname` 不是 `tools/tests/`；向上找仓库根。
let root: string = __dirname;
for (let i = 0; i < 10; i++) {
  if (require('fs').existsSync(require('path').join(root, 'entry', 'src', 'main', 'ets'))) { break; }
  root = require('path').join(root, '..');
}
const idxPath: string = require('path').join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
const raw: string = require('fs').existsSync(idxPath) ? require('fs').readFileSync(idxPath, 'utf-8') : '';
// 剥注释：只认**真实代码形态**（注释里的说明/历史不算 —— 本文件头就大量提到 `liveProgress()`）
const src: string = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const lines: string[] = src.split('\n');
const callLines: string[] = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('liveProgress()') >= 0) { callLines.push(lines[i]); }
}
// 赋值右侧形态：`= <标识符链>liveProgress()`（⛔ 不能用"行内有没有 `=`"——`!==`/`<=` 也含 `=`）
const assignRe: RegExp = /=[^=<>!]*liveProgress\(\)/;
const nonReactive: string[] = [];
for (let i = 0; i < callLines.length; i++) {
  if (!assignRe.test(callLines[i])) { nonReactive.push(callLines[i].trim()); }
}

ok('零扫描防线：读到 Index.ets 源码', src.length > 1000);
ok('定位到 liveProgress() 调用点（≥3 处：goal / phase / 徽章纯函数）', callLines.length >= 3);
ok('★ 每处 liveProgress() 都是**赋值右侧**（投影语义），无一处落在 UI 参数位', nonReactive.length === 0);
if (nonReactive.length > 0) {
  console.log(`     ⛔ 非响应式直读 ${nonReactive.length} 处：`);
  for (let i = 0; i < nonReactive.length; i++) { console.log(`        ${nonReactive[i].slice(0, 110)}`); }
}

// ── 两条已知投影的形态（回归钉；与上面普遍不变式互补）──────────────────────────
ok('① `@State iterStatsBadge` 声明在位', src.indexOf('@State iterStatsBadge: string') >= 0);
ok('① 头部徽章 `Text` 读 `@State`（非直读 store）', src.indexOf('Text(this.iterStatsBadge)') >= 0);
ok('② `@State busyPhase` 声明在位', src.indexOf('@State busyPhase: string') >= 0);
ok('② 占位行走 `busyLabel(this.busyPhase)`', src.indexOf('busyLabel(this.busyPhase)') >= 0);
eq('② ⛔ 不得残留直读 phase 的旧写法',
  src.indexOf('this.store !== null ? this.store.liveProgress().phase'), -1);

if (fail > 0) {
  console.log(`  ✗ reactive_projection: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ reactive_projection: ${pass} passed, 0 failed`);
process.exit(0);
