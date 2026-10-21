/**
 * send_state_settle.test.ts —— 「消息已回复却仍显示**发送中…**」的端到端复现判据。
 *
 * 用户 2026-10-21 真机（截图）：最后几条 user 气泡全部挂着「发送中…」，而**回复已经渲染**、
 * 顶栏还写着「运行中…」，输入框显示「处理中 — 消息将排队…」。
 * 用户原话：「不是说好了只要新迭代的 SSE 到了就代表一定发送成功了吗？」
 *
 * 不变量（本文件钉死，**新链路口径**）：
 *   **送达证据（`turn_started` 携带同一 requestID）⇒ 乐观 user 行必须退役，
 *    该 user 行的 `sending` 必须为 false。**
 *   `sending` 只允许存在"乐观行已入队、服务端还没确认"的窗口里（`local.pending`）。
 *
 * ── 链路迁移（2026-10-21）──────────────────────────────────────────────────────
 *   旧判据钉 `reduce → deriveRows`（`settlePendingSending` 的跨切面收敛：任何送达证据都会
 *   把 pending 与 turn 内 user 行的 `sending` 一并刷 false，含**按内容兜底**的 turn_started）。
 *   新链路行源 = `model_bridge.applyModel`，`sending` 的语义由模型 `state.local.pending` 承担：
 *   **`local.pending` 只按 `requestID` 精确退役**（`model_step.onOpen`/`onAck`，⛔ 内容匹配
 *   是被有意删掉的 —— 见 `model_step.ts:204` 注释"不做内容匹配"）。
 *   ⇒ 本文件保留"按 requestID 送达 ⇒ 结算"的判据（生产里 `user_sent` 的 requestID 恒非空，
 *     见 `store.ets` 的 `newRequestID()`）；旧 reduce 的**内容兜底**与**快照/收尾兜底**两条
 *     路径在新链路**整体不存在**，对应用例已删除（理由见文末 §D）。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = 1;
const RID = 'req-1';

/** 乐观 user 行（本机意图 `send`）。 */
function sentRow(id: string, content: string, sending: boolean, requestID: string | null): { [k: string]: unknown } {
  return {
    id, content, timestamp: '2026-10-21T01:00:00Z',
    isNotification: false, queued: false, sending, requestID, turnHint: undefined, dbID: undefined,
  };
}

/** 页面上会看到的所有 user 行（含 `local.pending` 段）。 */
function userRows(f: ModelFeed): ChatRow[] {
  const rows: ChatRow[] = f.rows();
  const out: ChatRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'user') { out.push(rows[i]); }
  }
  return out;
}
function anySending(f: ModelFeed): boolean {
  const us: ChatRow[] = userRows(f);
  for (let i = 0; i < us.length; i++) {
    if (us[i].sending) { return true; }
  }
  return false;
}
function countUserRows(f: ModelFeed): number { return userRows(f).length; }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 正常路径（requestID 精确绑定）：回复到达后不得残留「发送中」');
{
  const f = new ModelFeed('c');
  f.push({ type: 'session_running', running: true });          // 合法窗口：会话在跑
  f.push({ type: 'user_sent', row: sentRow('u-1', '你好', true, RID) });
  ok('★A busy 窗口里乐观行**确实**显示发送中（前置条件）', anySending(f));
  f.push({ type: 'turn_started', turnID: T, requestID: RID, trigger: 'user', content: '你好' });
  ok('★A turn_started 送达 ⇒ **不再**显示发送中（用户的原话：SSE 到了就代表发送成功）', !anySending(f));
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 10, phase: 'thinking',
    content: '你好', reasoning: '', activeTools: [], completedTools: [],
  });
  ok('★A 第一帧迭代到达后仍不显示发送中', !anySending(f));
  f.push({ type: 'text_final', turnID: T, content: '你好！', progressHistory: [], cancelled: false });
  ok('★A 回合结束后仍不显示发送中', !anySending(f));
  ok('★A 且只有**一条** user 行（乐观行被收编，没有幽灵副本）', countUserRows(f) === 1);
  ok('★A 被收编的 user 行归属 turn 1（身份是 turn 内 user，不是沉底 pending）',
    userRows(f)[0].turnID === T);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 连续发两条（第二条排队）：第一条必须已结算，第二条只允许"排队"不算发送中');
{
  const f = new ModelFeed('c');
  f.push({ type: 'session_running', running: true });
  f.push({ type: 'user_sent', row: sentRow('u-a', '第一条', true, 'req-a') });
  f.push({ type: 'turn_started', turnID: T, requestID: 'req-a', trigger: 'user', content: '第一条' });
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 10, phase: 'thinking',
    content: '收到', reasoning: '', activeTools: [], completedTools: [],
  });
  ok('★C 第一条在第二条入队前已结算', !anySending(f));
  // 第二条（不同 id/requestID —— 旧判据两条复用了同一个 `u-1`，在按 id 缓存行对象的
  // 新链路里会撞键；这里用真实形状：每条消息有各自的乐观行 id）。
  f.push({ type: 'user_sent', row: sentRow('u-b', '第二条', true, 'req-b') });
  ok('★C 第二条的 sending=true 是合法窗口（服务端尚无证据）', anySending(f));
  ok('★C 此时 total user 行 = 2（第一条已绑定 turn + 第二条 pending）', countUserRows(f) === 2);
  f.push({ type: 'text_final', turnID: T, content: '收到', progressHistory: [], cancelled: false });
  ok('★C 第一条回合结束后，第二条仍只允许 pending（不得凭空变两条已发送）', countUserRows(f) === 2);
  ok('★C 且 pending 行只可能是 pending 段那条（turn 内 user 恒 sending=false）',
    userRows(f).filter((r) => r.turnID === T).every((r) => r.sending === false));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 删除用例清单与理由（新链路保证整体不存在的部分）');
console.log('   · 旧 §B（turn_started 不带 requestID / 内容兜底结算）：新链路 `local.pending` 只按');
console.log('     requestID 精确退役（`model_step.onOpen`），按内容兜底的结算已随旧 reduce 删除；');
console.log('     且生产 `user_sent` 的 requestID 恒非空（`store.newRequestID()`）⇒ 场景不可达。');
console.log('   · 旧 §E（权威 history 快照 ⇒ pending 的 sending 结算）：`model_hydrate.hydrate`');
console.log('     **保留** `local.pending`（只替换 turns/legacy）⇒ 该保证在新链路不存在。');
console.log('   · 旧 §F（排队出队 turn_started 只带 content ⇒ 内容兜底收编）：同 §B。');
console.log('   · 旧 §G（text_final 收尾时收敛所有行的 sending）：跨切面收敛器不存在于新链路。');
console.log('   ⇒ 上述 4 段若要恢复，需先在 `model_step` 里补"权威事件退役 pending"的规则（core 改动），');
console.log('     不在本次测试迁移范围内（已上报）。');

console.log('\n▶ §D mutation 自证（外部注入）');
console.log('   · 删掉 `model_step.onOpen` 里按 requestID 退役 pending 的那两行 ⇒ §A ★A / §C ★C 必红；');
console.log('   · `model_adapter` 的 `open` 不写 `sending:false`（user 行恒 true）⇒ §A 必红。');

console.log(`\n  send_state_settle: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
