/**
 * 判据：**busy 时发送的消息必须以"排队"处理**（2026-10-22 用户亲报）。
 *
 * 现场：会话 busy（T1 在飞）时发一条消息 ⇒ 服务端把它**入队**（回包 `queued:true`，并附带
 *   `turn_id` = "将来要跑的那一轮"），而**原生把它按"没排队"渲染**（普通气泡挂在消息流里、
 *   还带「发送中/已送达」语义）⇒ 与 StagingTray 的队列视图矛盾、回合归属混乱。
 *
 * 根因（行源已是模型 W3）：`core/model_adapter.ts` 的 `user_ack` **只认 command/delivered**，
 *   `ev.queued` 被整个丢掉 ⇒ `AckIntent.how` 的 `'queued'` 是**零生产者死值** ⇒ `onAck`
 *   没有"排队⇒只退役 pending"这条路径。
 *
 * 权威口径：
 *   · `core/reduce.ts:2565`：`ev.queued === true ⇒ 从 pendingUsers 移除`（StagingTray 是唯一渲染面）；
 *   · web `hooks/useChatMessages.ts:870`：ack 后给乐观行打 `queued: true`。
 *
 * ⛔ mutation 自证：
 *   · `adapt` 还原成 `command ? 'command' : 'delivered'` ⇒ ① 红（排队行仍留在消息流里）；
 *   · `onAck` 删掉 `how === 'queued'` 分支 ⇒ ① 红；
 *   · 反向过度修复（所有 ack 都当 queued 退役）⇒ ② 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');
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

/** 一条发送中的乐观 user 行（与 `store.send` 落地形状一致）。 */
function sendRow(id: string, content: string, requestID: string): unknown {
  return {
    type: 'user_sent',
    row: {
      id: id, content: content, timestamp: '2026-10-22T05:00:00Z', isNotification: false,
      queued: false, sending: true, requestID: requestID,
    },
  };
}

/** busy 现场：T1 已开、迭代 1 在飞。 */
function busyFeed(chat: string): ModelFeed {
  const f = new ModelFeed(chat);
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r1', trigger: 'user', content: 'user1' });
  f.push({
    type: 'iteration', turnID: 1, iter: 1, seq: 1, phase: 'thinking',
    content: 'c1', reasoning: '', activeTools: [], completedTools: [],
  });
  return f;
}

// ── ① busy 时发消息 → ack(queued) ⇒ 必须从消息流退役（渲染交给 StagingTray）─────
{
  const f = busyFeed('q1');
  f.push(sendRow('u2', 'user2', 'r2'));
  const before: ChatRow[] = f.rows();
  eq('① ack 前：乐观行在消息流里（发送中）', before.length, 3);
  ok('① ack 前：该行 sending=true', before[2].sending === true);

  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnHint: 2, queued: true, command: false });
  const after: ChatRow[] = f.rows();
  const ids: string[] = after.map((r: ChatRow) => `${r.role}:${r.id}`);
  eq('① ack(queued) 后：排队行必须离开消息流', ids, ['user:turn-1-user', 'assistant:turn-1-live']);
  ok('① 不得凭空造出 turn 2（排队 ≠ 已开始那一轮）', f.state.turns.get(2 as never) === undefined);
  ok('① 正在跑那一轮的 user 行不得被排队消息顶掉',
    f.state.turns.get(1 as never) !== undefined
    && (f.state.turns.get(1 as never) as { user: { content: string } }).user.content === 'user1');
  eq('① 排队行不得残留在 pending', f.state.local.pending.length, 0);
}

// ── ② 反向：非排队 ack（delivered）必须**保留**行（防"全部退役"的过度修复）─────
{
  const f = busyFeed('q2');
  f.push(sendRow('u3', 'user3', 'r3'));
  f.push({ type: 'user_ack', requestID: 'r3', dbID: 33, turnHint: 2, queued: false, command: false });
  const rows: ChatRow[] = f.rows();
  const mine: ChatRow | undefined = rows.filter((r: ChatRow) => r.id === 'u3')[0];
  ok('② 非排队 ack：乐观行仍在消息流里（等 turn_started 绑定）', mine !== undefined);
  ok('② 非排队 ack：sending 已结算为 false', mine !== undefined && mine.sending === false);
}

// ── ③ 命令回复（commandReply）仍走 command 分支，不受 queued 影响 ───────────────
{
  const f = busyFeed('q3');
  f.push(sendRow('u4', '!pwd', 'r4'));
  f.push({ type: 'user_ack', requestID: 'r4', dbID: 0, turnHint: 0, queued: false, command: true });
  const rows: ChatRow[] = f.rows();
  ok('③ 命令 ack：不得绑 turn、不得造 assistant 行',
    rows.filter((r: ChatRow) => r.role === 'assistant').length === 1);
}

// ── ④ 结构性判据：`queued` 必须真的被 adapt 读（防死值回归）───────────────────
{
  const adapter: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/model_adapter.ts'), 'utf8');
  ok('④ adapt 读 ev.queued（`queued` 不再是零生产者死值）',
    /ev\.queued === true \? 'queued' : 'delivered'/.test(adapter));
  const step: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/model_step.ts'), 'utf8');
  ok('④ onAck 有 queued 分支（只退役 pending）',
    /if \(f\.how === 'queued'\) \{[\s\S]{0,400}return \{ state: \{ \.\.\.s, local \}, effects: \[\] \};/.test(step));
}

console.log(`queued_ack: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
