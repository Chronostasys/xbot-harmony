/**
 * genui_inline_always.test.ts —— GenUI 面板**必须始终内联渲染**（用户 2026-11-18）。
 *
 * 用户三连报：
 *   ① 「切会话之后再切回来，这个渲染面板就看不到了」；
 *   ② 「有时候只看得到渲染面板的 header bar，看不到面板内容」；
 *   ③ 「希望无论什么时候 display_html 都渲染 inline 的面板，不用交互就能看到 html 内容」。
 *
 * ## 真因（都在 `GenuiPanelCard` / 切会话入口，不涉及状态机）
 * - **并发名额泄漏**：`genuiInlineMounted` 只在 `aboutToDisappear` 归还，而切会话时 Index 页
 *   不销毁、LazyForEach 回收也不保证回调 ⇒ 计数**单调上涨** ⇒ 撞上限后**所有**面板永久
 *   退化成紧凑卡 = 「只看得到 header bar，看不到内容」（②）。
 * - **只尝试一次**：`ensureInline()` 只在 `aboutToAppear` 跑；切会话重建行时 `@Prop code`
 *   可能后到 ⇒ 那次 `code.length === 0` 直接 return，**再无重试** ⇒ 永久紧凑卡（①）。
 * - **建链失败无重试入口**：失败后停在紧凑卡；而紧凑卡的分享 chip 只建链接、不切内联。
 *
 * ## 修法
 * 1. 名额上限 3 → 12（同屏可见面板本来就少；LazyForEach 只创建可见项），
 *    并导出 `resetGenuiInlineBudget()` 供**切会话时整体归还**；
 * 2. `code` 加 `@Watch('onCodeChanged')` ⇒ 到位就重试内联（幂等早退）；
 * 3. 分享建链成功后，若仍是紧凑卡就地切内联（不用再点「打开面板」）。
 *
 * ⛔ mutation 自证：删 `@Watch('onCodeChanged')` ⇒ ① 红；删 `resetGenuiInlineBudget` 调用
 *   ⇒ ② 红；把上限改回 3 ⇒ ③ 红；删分享后切内联 ⇒ ④ 红。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const root: string = path.join(__dirname, '..', '..', '..', '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const card: string = read('entry/src/main/ets/components/GenuiPanelCard.ets');
const page: string = read('entry/src/main/ets/pages/Index.ets');

// ── ① code 后到必须重试（否则切会话回来永远紧凑卡）────────────────────────────
ok("① code 声明带 @Watch('onCodeChanged')", /@Prop @Watch\('onCodeChanged'\) code: string = '';/.test(card));
ok('①b onCodeChanged 里调用 ensureInline()',
  /private onCodeChanged\(\): void \{\s*this\.ensureInline\(\);\s*\}/.test(card));

// ── ② 名额必须在切会话时整体归还 ──────────────────────────────────────────────
ok('② 导出 resetGenuiInlineBudget（页面可清零预算）',
  /export function resetGenuiInlineBudget\(\): void \{/.test(card));
ok('②b Index 的 beginSwitch 之前调用它（切会话归还名额）', (() => {
  const i = page.indexOf('target.beginSwitch(chatId);');
  if (i < 0) return false;
  const window = page.substring(Math.max(0, i - 600), i);
  return window.indexOf('resetGenuiInlineBudget()') >= 0;
})());

// ── ③ 名额上限不得回到 3（否则同屏 4 张面板就有一张变紧凑卡）────────────────────
ok('③ GENUI_INLINE_MAX ≥ 12', (() => {
  const m = card.match(/const GENUI_INLINE_MAX: number = (\d+);/);
  return m !== null && parseInt(m[1], 10) >= 12;
})());

// ── ④ 分享建链成功后：紧凑卡就地切内联 ────────────────────────────────────────
ok('④ 分享成功分支会把 inlineUrl 赋上（不必再点「打开面板」）', (() => {
  const i = card.indexOf('this.shareState = SHARE_DONE;');
  if (i < 0) return false;
  const window = card.substring(Math.max(0, i - 700), i);
  return window.indexOf('this.inlineUrl = url;') >= 0;
})());

// ── ⑤ 内联态必须有内容区（不是只有 header）────────────────────────────────────
ok('⑤ InlinePanel 里有 WebSurface 内容区', (() => {
  const i = card.indexOf('InlinePanel() {');
  const j = card.indexOf('CompactCard() {');
  if (i < 0 || j < 0) return false;
  return card.substring(i, j).indexOf('WebSurface({') >= 0;
})());
ok('⑤b 内容区高度是确定值（不是百分比 ⇒ 不会塌成 0）', (() => {
  const i = card.indexOf('InlinePanel() {');
  const j = card.indexOf('CompactCard() {');
  const body: string = card.substring(i, j);
  return body.indexOf('.height(GENUI_INLINE_H)') >= 0;
})());

// ── ⑥ 每张卡都带「打开面板」逃生口（内联失败也不丢功能）────────────────────────
ok('⑥ 内联态与紧凑卡都有 GENUI_OPEN_LABEL', (() => {
  const n = (card.match(/GENUI_OPEN_LABEL/g) || []).length;
  return n >= 2;
})());

console.log(`genui_inline_always: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
