/**
 * cancel_then_send_order.test.ts —— **cancel 一轮后再发消息，顺序不能乱**（用户 2026-11-18 P0）：
 *   期望：`user1 → agent1(被 cancel) → user2 → agent2`
 *   现场：`user2 → user1 → agent1(cancelled) → agent2`（"继续"跑到最上面，整段错位）。
 *
 * 本判据把三种真实时序都喂一遍（都是 web 同源事件流里会出现的）：
 *   ① 正常 cancel + 新回合号更大；
 *   ② cancel 后 `turn_started` **复用同一个回合号**（服务端重启/号重排/同会话重开）；
 *   ③ cancel 后先来一枪 `history_replaced`（取消会让历史重新水合）再发新消息。
 *
 * ⛔ 不变量：**user 行只能出现在"它自己那一轮"的位置**，且新消息永远在**最下方**
 *   （pending 沉底 / 新回合最后插入）；cancel 过的轮永远排在它之前。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function layout(rows: ChatRow[]): string {
  // 助手行：正文可能为空（cancel 收尾），块仍在 ⇒ 打印「首块正文」或块数。
  return rows.map((r: ChatRow): string => {
    if (r.role === 'user') return `U:${r.content}`;
    const first: string = r.iterations.length > 0 && r.iterations[0].content !== undefined
      ? (r.iterations[0].content as string) : '';
    return `A:${first.slice(0, 8)}(${r.iterations.length})`;
  }).join(' | ');
}
function userTexts(rows: ChatRow[]): string[] {
  return rows.filter((r: ChatRow) => r.role === 'user').map((r: ChatRow) => r.content);
}

function send(f: ModelFeed, rid: string, text: string, turn: number): void {
  f.push({
    type: 'user_sent',
    row: { id: `opt-${rid}`, content: text, timestamp: 't', isNotification: false, queued: false, sending: true, requestID: rid },
  });
  f.push({ type: 'turn_started', turnID: turn, requestID: rid, trigger: 'user', content: text });
}

function iter(f: ModelFeed, turn: number, n: number, content: string, seq: number): void {
  f.push({
    type: 'iteration', turnID: turn, iter: n, phase: 'stream', seq,
    content, reasoning: '', streamingTools: [],
  });
}

/** 取消：先 idle（服务端权威），再来一条带部分正文 + cancelled 的 final。 */
function cancelTurn(f: ModelFeed, turn: number, seq: number, partial: string): void {
  f.push({ type: 'session', running: false, turnID: turn, seq });
  f.push({ type: 'text_final', turnID: turn, content: partial, cancelled: true, seq: seq + 1 });
}

// ── ① 正常：cancel turn1 → 发 msg2（turn2）─────────────────────────────────────
{
  const f = new ModelFeed('chat_ct_1');
  send(f, 'r1', 'msg-1', 1);
  iter(f, 1, 1, 'agent1-工作到一半', 11);
  cancelTurn(f, 1, 20, 'agent1-工作到一半');
  send(f, 'r2', 'msg-2', 2);
  iter(f, 2, 1, 'agent2', 31);
  const rows: ChatRow[] = f.rows();
  eq('① user 顺序', userTexts(rows), ['msg-1', 'msg-2']);
  eq('① 整表顺序', layout(rows), 'U:msg-1 | A:agent1-工(1) | U:msg-2 | A:agent2(1)');
}

// ── ② cancel 后**复用同一个 turn 号**（服务端号重排）────────────────────────────
{
  const f = new ModelFeed('chat_ct_2');
  send(f, 'r1', 'msg-1', 1);
  iter(f, 1, 1, 'agent1-工作到一半', 11);
  cancelTurn(f, 1, 20, 'agent1-工作到一半');
  send(f, 'r2', 'msg-2', 1);          // ← 同一个号
  iter(f, 1, 2, 'agent2', 31);
  const rows: ChatRow[] = f.rows();
  eq('② user 顺序（msg-1 在前、msg-2 在最下）', userTexts(rows), ['msg-1', 'msg-2']);
  // 号复用场景（服务端把新轮也用 1）：本端**不绑旧回合** ⇒ msg-2 沉底；
  // ⛔ 关键不变量：旧回合（含被 cancel 的回复）必须仍在 msg-2 **之上**。
  const ls: string[] = layout(rows).split(' | ');
  ok('② msg-2 在最下方', ls[ls.length - 1] === 'U:msg-2');
  ok('② agent1 在 msg-2 之上', layout(rows).indexOf('A:agent1-工') >= 0
    && layout(rows).indexOf('A:agent1-工') < layout(rows).indexOf('U:msg-2'));
}

// ── ③ cancel 后先来 history_replaced（取消会触发水合）再发消息 ─────────────────
{
  const f = new ModelFeed('chat_ct_3');
  send(f, 'r1', 'msg-1', 1);
  iter(f, 1, 1, 'agent1-工作到一半', 11);
  cancelTurn(f, 1, 20, 'agent1-工作到一半');
  f.push({
    type: 'history_replaced',
    lastSeq: 25,
    messages: [
      { id: 'm1', role: 'user', content: 'msg-1', turnID: 1 },
      { id: 'm2', role: 'assistant', content: '', turnID: 1, iterations: [{ iteration: 1, content: 'agent1-工作到一半', reasoning: '' }] },
    ],
  });
  send(f, 'r2', 'msg-2', 2);
  iter(f, 2, 1, 'agent2', 41);
  const rows: ChatRow[] = f.rows();
  eq('③ user 顺序', userTexts(rows), ['msg-1', 'msg-2']);
  eq('③ 整表顺序', layout(rows), 'U:msg-1 | A:agent1-工(1) | U:msg-2 | A:agent2(1)');
}

// ── ④ cancel 后 ack 先到（turnHint 指向**新**回合）再 turn_started ──────────────
{
  const f = new ModelFeed('chat_ct_4');
  send(f, 'r1', 'msg-1', 1);
  iter(f, 1, 1, 'agent1-工作到一半', 11);
  cancelTurn(f, 1, 20, 'agent1-工作到一半');
  f.push({
    type: 'user_sent',
    row: { id: 'opt-r2', content: 'msg-2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnID: 2, queued: false, commandReply: false });
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'msg-2' });
  iter(f, 2, 1, 'agent2', 31);
  const rows: ChatRow[] = f.rows();
  eq('④ user 顺序', userTexts(rows), ['msg-1', 'msg-2']);
  eq('④ 整表顺序', layout(rows), 'U:msg-1 | A:agent1-工(1) | U:msg-2 | A:agent2(1)');
}

console.log(`cancel_then_send_order: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
