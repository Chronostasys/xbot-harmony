/**
 * 跨会话状态污染 P0/P1 的**形态判据**（2026-10-17 用户复查时点名要补）。
 *
 * 用户担心的两类串台（都是真实交错，不是理论）：
 *  A. 页面投影层：`scheduleSync` 的 16ms flush / 抽屉 flush 在切 store 后仍调用
 *     `syncFrom(旧 store)`；旧 `syncFrom` 没有身份闸 ⇒ `identityChanged` 会把
 *     `this.currentChat` 改回旧会话（界面 A、this.store=B）。
 *  B. store 异步回填层：同一个 ChatStore 被重新 open 到另一个 chat 时，旧的
 *     `loadStatus/loadQueue/loadSessions/loadSessionSubscription/loadSettings/loadTerminals/
 *      loadHistoryInner/loadMore/openSession` 回包会写进新会话。
 *
 * 修法：`syncFrom` 首行身份闸 + 延迟 flush 二次校验 + 切 store 清 pending；
 *      `ChatStore.chatGen`（beginSwitch 自增）+ 每个异步回包 await 后比对。
 *
 * 判据含 mutation：删掉任一守卫 ⇒ 必红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

const root: string = path.resolve(__dirname, '../../../..');
const index: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const store: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/core/store.ets'), 'utf8');
const tail: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/components/LiveTailView.ets'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}
function countOf(s: string, sub: string): number {
  return s.split(sub).length - 1;
}

// ── 判据本体（可被 mutation 喂副本）────────────────────────────────────────────
function pageSafe(idx: string): boolean {
  const s0: number = idx.indexOf('private syncFrom(store: ChatStore): void {');
  if (s0 < 0) { return false; }
  const sBody: string = idx.substring(s0, s0 + 700);
  // ① syncFrom 首行身份闸（允许先有注释，但守卫必须在任何投影语句之前）
  if (sBody.indexOf('if (store !== this.store)') < 0) { return false; }
  // ② 16ms flush 二次校验
  const d0: number = idx.indexOf('this.syncScheduled = true;');
  if (d0 < 0) { return false; }
  const dBody: string = idx.substring(d0, d0 + 900);
  if (dBody.indexOf('s === this.store') < 0) { return false; }
  // ③ 抽屉 flush 二次校验
  if (idx.indexOf('if (!this.showDrawer && this.pendingSync !== null)') < 0) { return false; }
  // ④ switchSession 切 store 时丢弃旧延迟投影 / 取消驻留
  const sw0: number = idx.indexOf('private async switchSession(chatId: string');
  if (sw0 < 0) { return false; }
  const swBody: string = idx.substring(sw0, sw0 + 2600);
  if (swBody.indexOf('this.pendingSync = null;') < 0) { return false; }
  if (swBody.indexOf('this.syncScheduled = false;') < 0) { return false; }
  if (swBody.indexOf('this.cancelSpinHold = false;') < 0) { return false; }
  // store 池已彻底删除：切走必须 dispose 旧 store（不再复用 session 历史缓存）。
  if (swBody.indexOf('prevStore.dispose()') < 0) { return false; }
  if (idx.indexOf('private pools: Map<string, ChatStore>') >= 0) { return false; }
  // ⑤ 滚动期不写任何 live @State（性能 P0）：守卫必须在 `const rev` 之前
  const lt0: number = idx.indexOf('private syncLiveTail(): void {');
  if (lt0 < 0) { return false; }
  const ltBody: string = idx.substring(lt0, lt0 + 800);
  const guardAt: number = ltBody.indexOf('if (this.userScrolling || (this.userTouchActive && this.busy))');
  const revAt: number = ltBody.indexOf('const rev: number =');
  if (guardAt < 0 || revAt < 0 || guardAt > revAt) { return false; }
  // ⑥ 滚动/触摸期**挂起 store 行重建**（@ObjectLink 会绕过页面早退；否则行高抖动）
  const touch0: number = idx.indexOf('.onTouch((event: TouchEvent) => {');
  if (touch0 < 0) { return false; }
  const touchBody: string = idx.substring(touch0, touch0 + 1400);
  if (touchBody.indexOf('suspendUiUpdates(true)') < 0) { return false; }
  if (touchBody.indexOf('suspendUiUpdates(false)') < 0) { return false; }
  const ws0: number = idx.indexOf('.onWillScroll((offset: number, state: ScrollState, source: ScrollSource) => {');
  if (ws0 < 0) { return false; }
  const wsBody: string = idx.substring(ws0, ws0 + 2200);
  if (wsBody.indexOf('suspendUiUpdates(true)') < 0) { return false; }
  const stop0: number = idx.indexOf('.onScrollStop(() => {');
  if (stop0 < 0) { return false; }
  const stopBody: string = idx.substring(stop0, stop0 + 1800);
  if (stopBody.indexOf('suspendUiUpdates(false)') < 0) { return false; }
  // 看门狗：onScrollStop 丢失时不能永久挂起
  if (idx.indexOf('lastUserScrollAtMs') < 0) { return false; }
  // 模块级滚动标志：LazyForEach 已有条目拿不到新的 paused @Prop ⇒ LiveTailView 必须直接读它
  if (idx.indexOf('setUiScrolling(true)') < 0 || idx.indexOf('setUiScrolling(false)') < 0) { return false; }
  return true;
}

/** LiveTailView 打字机必须在滚动期停止推进（否则行高继续变）。 */
function tailSafe(t: string): boolean {
  if (!/from '\.\.\/core\/listfollow'/.test(t)) { return false; }
  const tick0: number = t.indexOf('private tick(): void {');
  if (tick0 < 0) { return false; }
  const tickBody: string = t.substring(tick0, tick0 + 900);
  return tickBody.indexOf('tailIsPaused()') >= 0 || tickBody.indexOf('uiIsScrolling()') >= 0;
}

function storeSafe(s: string): boolean {
  if (s.indexOf('private chatGen: number = 0;') < 0) { return false; }
  // UI 行重建挂起（滚动期高度抖动 P0）
  if (s.indexOf('private uiSuspended: boolean = false;') < 0) { return false; }
  const rb0: number = s.indexOf('private rebuildRows(): void {');
  if (rb0 < 0) { return false; }
  if (s.substring(rb0, rb0 + 900).indexOf('if (this.uiSuspended)') < 0) { return false; }
  if (s.indexOf('suspendUiUpdates(suspend: boolean): void') < 0) { return false; }
  // beginSwitch 自增代数
  const bs0: number = s.indexOf('beginSwitch(chatId: string): void {');
  if (bs0 < 0) { return false; }
  const bsBody: string = s.substring(bs0, bs0 + 1400);
  if (bsBody.indexOf('this.chatGen++;') < 0) { return false; }
  // 每个异步回包**方法体**都要有代数守卫（⛔ 只数全局会出现"别的方法补上了"的假绿）
  const methods: string[] = [
    'async loadSessions(): Promise<void> {',
    'async loadSettings(): Promise<void> {',
    'async loadTerminals(): Promise<void> {',
    'async loadSessionSubscription(): Promise<void> {',
    'async loadStatus(): Promise<void> {',
    'async loadQueue(): Promise<void> {',
    'private async loadHistoryInner(): Promise<void> {',
    'async loadMore(): Promise<void> {',
  ];
  for (let i = 0; i < methods.length; i++) {
    const at: number = s.indexOf(methods[i]);
    if (at < 0) { return false; }
    const body: string = s.substring(at, at + 2600);
    if (body.indexOf('gen !== this.chatGen') < 0) { return false; }
  }
  // openSession 自身也要代数守卫（loadSessions/history/queue 后）
  const os0: number = s.indexOf('async openSession(chatId: string');
  if (os0 < 0) { return false; }
  const osBody: string = s.substring(os0, os0 + 7000);
  if (osBody.indexOf('const gen: number = this.chatGen;') < 0) { return false; }
  // ⚠️ 2026-10-17：`loadSessions` 改为**后台补齐**（不再 await，避免会话列表挂住导致首屏永久
  //    splash）⇒ openSession 的 await 后守卫只剩 loadHistory / loadQueue 两处。
  if (countOf(osBody, 'gen !== this.chatGen') < 2) { return false; }
  return true;
}

/** 只替换某方法体（从 sig 起）里的第一处，避免误伤前面同名代码。 */
function replaceInMethod(src: string, sig: string, oldText: string, newText: string): string {
  const at: number = src.indexOf(sig);
  if (at < 0) { return src; }
  const head: string = src.substring(0, at);
  const tail: string = src.substring(at).replace(oldText, newText);
  return head + tail;
}

console.log('\n▶ 跨会话污染：页面投影身份闸 + store 异步代数守卫');
ok('零扫描防线：Index/store 真读到内容', index.length > 50000 && store.length > 50000);
ok('页面：syncFrom 首行身份闸 + 延迟 flush 二次校验 + 切 store 清 pending + 滚动期不写 live @State',
  pageSafe(index));
ok('store：chatGen 自增 + 8+ 处异步回包守卫 + openSession 三处守卫', storeSafe(store));
ok('LiveTailView：打字机 tick 读模块级滚动标志（LazyForEach 旧条目也能停）', tailSafe(tail));

// ── mutation 自证（必红）──────────────────────────────────────────────────────
ok('mutation A：删 syncFrom 身份闸 ⇒ 必红',
  !pageSafe(replaceInMethod(index, 'private syncFrom(store: ChatStore): void {',
    'if (store !== this.store) {', 'if (false) {')));
ok('mutation B：删 16ms flush 的二次校验 ⇒ 必红',
  !pageSafe(replaceInMethod(index, 'this.syncScheduled = true;',
    'if (s !== null && s === this.store) {', 'if (s !== null) {')));
ok('mutation C：删滚动期 live @State 守卫 ⇒ 必红',
  !pageSafe(replaceInMethod(index, 'private syncLiveTail(): void {',
    'if (this.userScrolling || (this.userTouchActive && this.busy)) {', 'if (false) {')));
ok('mutation D：删 loadStatus 的代数守卫 ⇒ 必红',
  !storeSafe(replaceInMethod(store, 'async loadStatus(): Promise<void> {',
    'gen !== this.chatGen', 'false')));
ok('mutation E：删 beginSwitch 的 chatGen++ ⇒ 必红',
  !storeSafe(replaceInMethod(store, 'beginSwitch(chatId: string): void {',
    'this.chatGen++;', '')));
ok('mutation F：删 rebuildRows 的 uiSuspended 守卫 ⇒ 必红',
  !storeSafe(replaceInMethod(store, 'private rebuildRows(): void {',
    'if (this.uiSuspended) {', 'if (false) {')));
ok('mutation G：删 onWillScroll 的挂起调用 ⇒ 必红',
  !pageSafe(replaceInMethod(index, '.onWillScroll((offset: number, state: ScrollState, source: ScrollSource) => {',
    'st.suspendUiUpdates(true);', '')));
ok('mutation H：删 onScrollStop 的恢复调用 ⇒ 必红',
  !pageSafe(replaceInMethod(index, '.onScrollStop(() => {',
    'st.suspendUiUpdates(false);', '')));
ok('mutation I：删 LiveTailView 的暂停标志读取 ⇒ 必红',
  !tailSafe(replaceInMethod(tail, 'private tick(): void {', 'tailIsPaused()', 'false')));
ok('mutation J：删页面 setUiScrolling(true) ⇒ 必红',
  !pageSafe(index.split('setUiScrolling(true);').join('')));

console.log(fail === 0 ? 'session_isolation_wiring: ALL PASS' : `session_isolation_wiring: ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

export {};
