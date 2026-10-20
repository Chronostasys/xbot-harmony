/**
 * resync_session_state.test.ts —— 「**每次 resync 都要同步 todos + goal**」的接线判据。
 *
 * 用户 2026-10-21 原话：
 *   「我们的 todo 经常在切换别的应用再回来的时候和真实状态不同步，所以我觉得**每次我们需要
 *     resync 的时候都要同步一下会话的 to do 啊，包括 goal 的状态**」。
 *
 * 历史缺陷（本文件要钉死的形态）：
 *   · `goal` 只有**被动**来源（结构化 progress 事件里的 `goal`）⇒ 后台期间错过的变更永远补
 *     不回来（banner 停在旧值 / 空白），直到下一个带 goal 的事件；
 *   · `todos` 只在 `session(idle)` 事件时拉，回前台 resync **不拉** ⇒ 切后台期间由别的客户端
 *     改过的 todo 不同步。
 *
 * 判据（形态断言，钉**调用点**而不是"方法存在"）：
 *   ① `resyncAfterResume` 的 history 收尾链里**必须**同时调 `loadStatus()` 与 `loadGoal()`；
 *   ② `loadGoal()` 存在且走 `get_goal` RPC（常量 `RPC_GET_GOAL`，⛔ 不散落字符串）；
 *   ③ 失败分支**不能**写 `null`（网络失败 ≠ 目标被删除）；
 *   ④ `null` 返回必须落成"显式清除"（`applySessionFields(state, undefined, null)`）。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
const rpcSrc = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/rpc.ets'), 'utf8');

function section(src: string, from: string, to: string): string {
  const i = src.indexOf(from);
  if (i < 0) { return ''; }
  const j = src.indexOf(to, i);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}

console.log('\n▶ §A resync 的收尾链必须对齐权威会话状态（todos + goal）');
{
  const body = section(store, 'resyncAfterResume(', 'private async loadSubAgentHistory');
  ok('★A 找得到 resyncAfterResume 的实现（零扫描防线）', body.length > 500);
  ok('★A 它在历史重载之后调 `this.loadStatus()`（todos/用量权威）',
    /loadHistory\(\)[\s\S]{0,600}this\.loadStatus\(\)/.test(body));
  ok('★A 并且调 `this.loadGoal()`（goal 权威）',
    /loadHistory\(\)[\s\S]{0,800}this\.loadGoal\(\)/.test(body));
  ok('★A 两处都 catch 掉（非关键路径不得阻断 resync 的 release）',
    /this\.loadStatus\(\)\.catch\(/.test(body) && /this\.loadGoal\(\)\.catch\(/.test(body));
}

console.log('\n▶ §B loadGoal 的实现语义（RPC 名常量 / null 清除 / 失败不动本地）');
{
  const body = section(store, 'async loadGoal(): Promise<void> {', 'async uploadAttachment');
  ok('★B 方法存在（零扫描防线）', body.length > 200);
  ok('★B 走 `RPC_GET_GOAL` 常量（⛔ 不在调用点写裸字符串）',
    body.indexOf('RPC_GET_GOAL') >= 0 && body.indexOf("'get_goal'") < 0);
  ok('★B `null` ⇒ 显式清除（把 null 交给 applySessionFields）',
    /g === null \? null :/.test(body) && /applySessionFields\(this\.state, undefined, nextGoal\)/.test(body));
  ok('★B catch 分支里**没有** applySessionFields（失败 ≠ 目标被删）',
    !/catch[\s\S]{0,300}applySessionFields/.test(body));
  ok('★B 有 chatGen/currentChat 身份守卫（跨会话回包必须丢弃）',
    /gen !== this\.chatGen \|\| forChat !== this\.currentChatId/.test(body));
  ok('★B rpc 调用关掉全局 toast（`false` = 静默，后台拉取不打扰用户）',
    /RPC_GET_GOAL[\s\S]{0,120}false\)/.test(body));
}

console.log('\n▶ §C 会话空闲（idle）也有 goal 对齐（回合收尾那一刻目标可能刚变）');
{
  const body = section(store, 'isIdleAction(action)', 'notifyOnSse(event, action, null)');
  ok('★C idle 分支调 `loadStatus()`（既有行为，不许回退）', /this\.loadStatus\(\)\.catch\(/.test(body));
  ok('★C idle 分支调 `loadGoal()`（本波新增）', /this\.loadGoal\(\)\.catch\(/.test(body));
}

console.log('\n▶ §D 常量定义在 rpc.ets（唯一真源，禁止散落）');
{
  ok('★D `RPC_GET_GOAL` 常量存在且值为 `get_goal`',
    /export const RPC_GET_GOAL: string = 'get_goal';/.test(rpcSrc));
  ok('★D 入参类 `GoalReq` 存在（`{channel, chat_id}`）',
    /export class GoalReq \{[\s\S]{0,200}chat_id/.test(rpcSrc));
}

console.log('\n▶ §E mutation 自证（外部注入）');
console.log('   · 删掉 resyncAfterResume 里的 `this.loadGoal()` ⇒ §A 必红');
console.log('   · 把 `g === null ? null : …` 改成恒 `undefined` ⇒ §B 必红（目标删不掉）');
console.log('   · 在 catch 里补 `applySessionFields(state, undefined, null)` ⇒ §B 必红（弱网误删目标）');

console.log(`\n  resync_session_state: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
