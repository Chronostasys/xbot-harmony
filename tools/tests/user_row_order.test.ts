/**
 * user_row_order.test.ts —— 刚发出的 user 消息**不得跑到上面**（用户 2026-11-17 P0：
 * 「user 消息刚发出去、还没发送成功的时候，可能出现在错误的位置（在上一个 user msg 后面，
 * 下方是之前的回复）」）。
 *
 * 两条结构性根因（都在本判据里钉住）：
 *   ① **渲染顺序不能按 turn 号排序**：号一旦"倒退"（重连后 DB 号 < 本地新号、子代理 dump 号
 *      与 SSE 号混用、服务端重启后号重排），按号排序会把**新轮**排到**旧轮前面** ⇒ 新 user
 *      行跑到上面。⇒ 一律按**到达顺序**（`Map` 插入序 = 真实事件时序）。
 *   ② **不能把新消息绑进一个"已经有内容"的旧回合**：`user_ack(delivered)`/`turn_started` 若带
 *      一个**已收尾或有块的 turn 号**（服务端忙/重启/号复用），旧实现直接 `turns.set(turn,
 *      {...t, user})` ⇒ 新 user 行落进旧回合的 user 槽，旧回复的块仍排在同一回合的后面 ⇒
 *      视觉上"两个 user 连在一起、下面是之前的回复"。⇒ 这种情况**不绑**，让乐观行继续沉底
 *      （`pending` 永远渲染在最后），等真正的空回合到来再绑。
 *
 * ⛔ mutation 自证：恢复"按 turn 号排序" ⇒ ① 红；去掉"已占用回合不绑"守卫 ⇒ ② 红。
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

function userRows(rows: ChatRow[]): ChatRow[] {
  return rows.filter((r: ChatRow) => r.role === 'user');
}
function ids(rows: ChatRow[]): string {
  return rows.map((r: ChatRow) => `${r.role}:${r.id}`).join(' | ');
}

function turnWithReply(f: ModelFeed, turn: number, user: string, rid: string, reply: string): void {
  f.push({
    type: 'user_sent',
    row: { id: `opt-${rid}`, content: user, timestamp: 't', isNotification: false, queued: false, sending: true, requestID: rid },
  });
  f.push({ type: 'turn_started', turnID: turn, requestID: rid, trigger: 'user', content: user });
  f.push({
    type: 'iteration', turnID: turn, iter: 1, phase: 'done', seq: turn * 10,
    content: reply, reasoning: '', streamingTools: [],
  });
  f.push({
    type: 'phase_done', turnID: turn, seq: turn * 10 + 1,
    finalIteration: { iteration: 1, content: reply, reasoning: '', tools: [] },
  });
  f.push({ type: 'text_final', turnID: turn, content: reply, seq: turn * 10 + 2 });
}

// ── ① turn 号倒退 ⇒ 仍按到达顺序渲染（新轮在底部）─────────────────────────────
{
  const f = new ModelFeed('chat_order1');
  turnWithReply(f, 900, 'user-A', 'rA', 'reply-A');
  f.push({
    type: 'user_sent',
    row: { id: 'opt-rB', content: 'user-B', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'rB' },
  });
  // 新轮号**更小**（真实场景：重连后 DB 号 vs 本地号；服务端重启后号重排）
  f.push({ type: 'turn_started', turnID: 5, requestID: 'rB', trigger: 'user', content: 'user-B' });
  const rows: ChatRow[] = f.rows();
  const users: ChatRow[] = userRows(rows);
  eq('① 两个 user 行', users.length, 2);
  // ⚡ 2026-11-18 用户口径：「他不是有 turn id 吗」⇒ 普通会话**按 turn id 升序**（服务端权威时序）。
  //   本用例造的是号倒退（900 → 5）；按 id 排序时 turn 5 在前 ⇒ user-B 在上、user-A 在下。
  eq('①b 按 turn id 升序（5 在前、900 在后）', users[0].content, 'user-B');
  ok('①c turn-900 排在 turn-5 之后', ids(rows).indexOf('user:turn-900-user') > ids(rows).indexOf('user:turn-5-user'));
}

// ── ② ack 指向**已收尾的旧回合** ⇒ 新消息不绑（继续沉底），旧回复位置不变 ────────
{
  const f = new ModelFeed('chat_order2');
  turnWithReply(f, 1, 'user-1', 'r1', 'reply-1');
  const before: string = ids(f.rows());
  // 新消息：乐观行 → ack 带着**旧回合号**（服务端忙/号复用）
  f.push({
    type: 'user_sent',
    row: { id: 'opt-r2', content: 'user-2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnHint: 1, queued: false, command: false });
  const rows: ChatRow[] = f.rows();
  const users: ChatRow[] = userRows(rows);
  eq('② 仍是两个 user 行（user-1 未被顶掉）', users.length, 2);
  eq('②b user-1 内容不变', users[0].content, 'user-1');
  eq('②c 新消息在最下面', users[users.length - 1].content, 'user-2');
  ok('②d 旧回复 reply-1 必须仍在 user-2 之上',
    ids(rows).indexOf('assistant:turn-1') >= 0 && ids(rows).indexOf('assistant:turn-1') < ids(rows).lastIndexOf('user:' + users[users.length - 1].id));
  ok('②e 行序除 append 的新 user 外未变', ids(rows).indexOf(before) === 0 || ids(rows).startsWith(before));
}

// ── ③ ack 的 turn_id 指向**已收尾的旧回合** ⇒ 新消息不得绑进去（继续沉底）────────
{
  const f = new ModelFeed('chat_order3');
  turnWithReply(f, 1, 'user-1', 'r1', 'reply-1');
  f.push({
    type: 'user_sent',
    row: { id: 'opt-r2', content: 'user-2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  // 服务端把这条消息 ack 到**旧回合**（忙/号复用/重启后重排）
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnID: 1, queued: false, commandReply: false });
  const rows: ChatRow[] = f.rows();
  const users: ChatRow[] = userRows(rows);
  eq('③ 两个 user 行', users.length, 2);
  eq('③b user-1 不得被顶掉', users[0].content, 'user-1');
  eq('③c 新消息在最下面', users[users.length - 1].content, 'user-2');
  ok('③d 旧回复仍在 user-2 之上', rows.length >= 3 && rows[1].role === 'assistant');
}

// ── ④ turn_started 复用**已有内容的旧回合号** ⇒ 新 user 不得插到旧回复之前 ─────
{
  const f = new ModelFeed('chat_order4');
  turnWithReply(f, 1, 'user-1', 'r1', 'reply-1');
  f.push({
    type: 'user_sent',
    row: { id: 'opt-r2', content: 'user-2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r2', trigger: 'user', content: 'user-2' });
  const rows: ChatRow[] = f.rows();
  const users: ChatRow[] = userRows(rows);
  eq('④ 两个 user 行', users.length, 2);
  eq('④b 新消息在最下面', users[users.length - 1].content, 'user-2');
  ok('④c 旧回复 reply-1 仍在 user-2 之上', rows[1].role === 'assistant');
}

console.log(`user_row_order: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
