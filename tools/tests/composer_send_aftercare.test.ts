/**
 * 「发送后收尾」接线门禁 —— `pages/Index.ets` `sendDraft()` 的**调用点证据**。
 *
 * ── 背景（用户 2026-10-12 真机亲报）──────────────────────────────────────────────────
 *   *"发完不收键盘、视角不自动滚到最下方"*。语义：用户**主动发消息** ⇒ 意图必然是"看最新的"
 *   （与切会话同一语义：意图重置为跟随）。此前该行为**零判据覆盖**（`scroll_follow_wiring` 只管
 *   **流式期间**的"上滚不被人机对抗"，与发送后收尾是**两条不同的路径**）。
 *
 * ── 钉什么（5 条独立断言，缺一即"以为修好了其实没有"）──────────────────────────────
 *   ① 零扫描判红：`Index.ets` 真读到、`sendDraft()` 真扫到、切片非空。
 *   ② 收键盘：`sendDraft()` 切片内 `this.dismissKeyboard();` **恰 1 处**。
 *   ③ 意图重置：`this.followBottom = true;` **恰 1 处**（后续 `syncFrom` 的 `shouldAutoScroll`
 *      才会继续把新增行跟到底 —— 只滚一次会被下一帧拉回去）。
 *   ④ 立刻到底：`this.listScroller.scrollEdge(Edge.Bottom);` **恰 1 处**。
 *   ⑤ ⛔ **顺序**：②④ 都必须出现在 `await store.send(` **之前**（若排在 await 之后，键盘要等到
 *      网络往返结束才收 —— 正是用户报的"发完（等）不收键盘"）；且 ⛔ 切片内不得有 `setTimeout(`
 *      （性能预算 timer 已满 7/7，收尾不许靠定时器）。
 *   ⑥ **非死代码**：`dismissKeyboard()` 的实现体**真的**调 IME（`getFocusController().clearFocus()`），
 *      且 `this.dismissKeyboard()` 在全文件确有调用点（≥1）—— 防"函数在但没人调"。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到 `dismissKeyboard()` 是文档，不是调用点）；计数一律**精确 `=== n`**
 *   （本仓教训：阈值用 `>= n` 会**假绿** —— 15f 实测 `>=2` 而实际 3 处，删 1 处仍通过）。
 * ⚠️ **注入式 mutation 必须"切片内"定位**（本轮实测踩过两次）：`this.listScroller.scrollEdge(
 *   Edge.Bottom);` 在**全文件出现 4 处**、`this.failedSend = '';` 也有多处 ⇒ 用"全文件 `.replace(…,1)`"
 *   或 `s.index(…)` 会打到**切片之外**的第一处 ⇒ 判据自然不红，**看起来像"判据没判别力"，实际是注入打偏**。
 *   正确做法：先算切片 `[i, j)`，只在 `slice` 内替换/搬移，并**打印切片内计数**自证注入生效。
 * ✅ 判据自证：打印扫了哪个文件 + 逐项计数；**零扫描判红**。
 *   mutation（切片内注入，全部命中）：删 `dismissKeyboard()` ⇒ 3 红 · 删 `followBottom = true` ⇒ 1 红 ·
 *   删 `scrollEdge(Bottom)` ⇒ 2 红 · 把收键盘块搬到切片末尾（= await 之后）⇒ 1 红；还原均 md5 一致。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层 pass/fail 不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail ? ` ｜ ${detail}` : ''}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**调用点。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])https?:\/\/[^\s]*/g, '$1').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readSrc(rel: string): string {
  const p = path.join(PAGES, rel);
  if (!fs.existsSync(p)) { return ''; }
  return stripComments(fs.readFileSync(p, 'utf8'));
}

/** 取 `a` 之后到 `b` 之前的切片（**终点排他** —— 15e 踩过：终点取被钉元素本身会假红）。 */
function sliceBetween(s: string, a: string, b: string): string {
  const i = s.indexOf(a);
  if (i < 0) { return ''; }
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? s.substring(i) : s.substring(i, j);
}

function countOf(s: string, sub: string): number {
  return s.split(sub).length - 1;
}

const idx: string = readSrc('Index.ets');
console.log(`▶ 扫描 entry/src/main/ets/pages/Index.ets（剥注释后 ${idx.length} 字符）`);

// ── ① 零扫描判红 + 切片定位 ─────────────────────────────────────────────────────────
ok('① 真读到 Index.ets（非空）', idx.length > 1000);
ok('① 真扫到 `sendDraft`（零扫描判红）', idx.indexOf('private async sendDraft()') >= 0,
  `实得 ${countOf(idx, 'sendDraft')} 处提及`);
const send: string = sliceBetween(idx, 'private async sendDraft()', '\n  private ');
ok('① sendDraft 切片可定位且非空（锚点失效即红）', send.length > 500, `实得 ${send.length} 字符`);

// ── ②③④ 三条收尾动作（精确计数）────────────────────────────────────────────────────
const dismiss: number = countOf(send, 'this.dismissKeyboard();');
const follow: number = countOf(send, 'this.followBottom = true;');
const edge: number = countOf(send, 'this.listScroller.scrollEdge(Edge.Bottom);');
console.log(`▶ sendDraft 收尾：dismissKeyboard=${dismiss} · followBottom=true ${follow} · scrollEdge(Bottom)=${edge}`);
ok(`② 收键盘：\`this.dismissKeyboard();\` 恰 1 处（实得 ${dismiss}）`, dismiss === 1);
ok(`③ 意图重置：\`this.followBottom = true;\` 恰 1 处（实得 ${follow}）`, follow === 1);
ok(`④ 立刻到底：\`scrollEdge(Edge.Bottom)\` 恰 1 处（实得 ${edge}）`, edge === 1);

// ── ⑤ 顺序（收尾必须在 await 之前）+ 无定时器 ───────────────────────────────────────
const awaitAt: number = send.indexOf('await store.send(');
const dismissAt: number = send.indexOf('this.dismissKeyboard();');
const edgeAt: number = send.indexOf('this.listScroller.scrollEdge(Edge.Bottom);');
ok('⑤ 定位到 `await store.send(`（锚点失效即红）', awaitAt > 0, `实得 ${awaitAt}`);
ok('⑤ 收键盘在 `await store.send(` **之前**（⛔ 否则要等网络往返才收）',
  dismissAt >= 0 && awaitAt > 0 && dismissAt < awaitAt, `dismiss=${dismissAt} await=${awaitAt}`);
ok('⑤ `scrollEdge(Bottom)` 也在 `await store.send(` **之前**（立刻到底，不等往返）',
  edgeAt >= 0 && awaitAt > 0 && edgeAt < awaitAt, `edge=${edgeAt} await=${awaitAt}`);
const timers: number = countOf(send, 'setTimeout(');
ok(`⑤ ⛔ sendDraft 内无定时器（性能预算 timer 7/7 满；实得 ${timers}）`, timers === 0);

// ── ⑥ 非死代码：dismissKeyboard 真调 IME + 真有调用点 ────────────────────────────────
const impl: string = sliceBetween(idx, 'private dismissKeyboard(): void {', '\n  private ');
ok('⑥ dismissKeyboard 实现体可定位（非空）', impl.length > 50, `实得 ${impl.length} 字符`);
ok(`⑥ 实现体**真的**调 IME（\`getFocusController().clearFocus()\`，实得 ${countOf(impl, 'getFocusController().clearFocus()')}）`,
  countOf(impl, 'getFocusController().clearFocus()') === 1);
const callSites: number = countOf(idx, 'this.dismissKeyboard()');
ok(`⑥ \`this.dismissKeyboard()\` 全文件真有调用点（≥1，防死代码；实得 ${callSites}）`, callSites >= 1);

if (fail > 0) { console.log(`  composer_send_aftercare: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  composer_send_aftercare: ${pass} passed, 0 failed`);
process.exit(0);
