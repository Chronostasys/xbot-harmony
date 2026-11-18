/**
 * 判据：**会话级状态必须带 turn 水位**（2026-10-24 用户：「状态机没考虑 turn，bug 全是 turn 造成的」）。
 *
 * 现场（用户点名）：busy(T1) 时发消息 → 排队；立刻 cancel T1 ⇒ 期望排队消息**立刻出队**、
 *   `turn_started(T2)` 后**恢复 busy**。旧实现的两条竞态：
 *   ① `session(idle, turn=T1)` 迟到/重放 ⇒ 把正在跑的 **T2 压成 idle**（模型侧连 turn 字段都没有）；
 *   ② cancel ack（`text_final` 无 turn_id）**晚于** `turn_started(T2)` ⇒ `endingTurnOf` 的
 *      "取最早未收尾"兜底落到 **T2** ⇒ 把刚出队的一轮标成 cancelled/final ⇒ 之后 T2 的 tick
 *      全被当"迟到帧"丢弃 ⇒ 消息静默消失。
 *
 * 修法：
 *   · `Session.runningTurn` + `SessionFrame.turn`，`onSession` **按水位丢弃陈旧信号**，
 *     `onOpen` 推进水位；
 *   · `applyLocalIdle(chatId, authoritative, turnHint)` 同一闸门（探针/SSE 绕过 reduce 的入口）；
 *   · `endingTurnOf` **只认仍 live+streaming 的那一轮**；无法归属 ⇒ 产出 `snapshot` effect
 *     （交给驱动层权威重载），**既不猜也不丢**。
 *
 * ⛔ mutation 自证：
 *   · 删 `onSession` 的 stale 闸门 ⇒ 用例①/③ 红；
 *   · `endingTurnOf` 恢复"取最早未收尾" ⇒ 用例④ 红（T2 被杀）；
 *   · 删 `snapshot` effect（改成静默返回）⇒ 用例⑤ 红。
 */
declare const process: { exit: (c: number) => void };

import { emptyState, newTurn, State, TurnRec, TurnID } from '../../entry/src/main/ets/core/model_types';
import { stepEvent } from '../../entry/src/main/ets/core/model_bridge';
import { ModelFeed } from './model_harness';

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

function sess(turn: number, running: boolean): unknown {
  return { type: 'session', busy: running, turnID: turn > 0 ? turn : null };
}

// ── ① 迟到 idle（属于旧轮）不得压掉新轮 ────────────────────────────────────────
{
  const f = new ModelFeed('wm1');
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'msg2' });
  // 旧轮 T1 的粗粒度 idle 迟到
  f.push(sess(1, false));
  ok('① 旧轮 idle 被丢弃：running 仍为 true', f.state.sess.running === true);
  eq('① 水位停在 T2', f.state.sess.runningTurn as number, 2);
}

// ── ② 同一轮/更新轮的 idle 正常生效 ───────────────────────────────────────────
{
  const f = new ModelFeed('wm2');
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'msg2' });
  f.push(sess(2, false));
  ok('② 同轮 idle 生效：running=false', f.state.sess.running === false);
  f.push(sess(3, true));
  ok('③ 更新轮 busy 生效：running=true', f.state.sess.running === true);
  eq('③ 水位推进到 T3', f.state.sess.runningTurn as number, 3);
  // 再回放旧轮 busy ⇒ 必须被丢弃
  f.push(sess(1, true));
  ok('③ 更旧轮的 busy 不得覆盖新轮状态', f.state.sess.runningTurn as number === 3);
}

// ── ④ 迟到的 turn-less cancel ack 不得杀掉刚出队的新轮（用户点名的竞态）────────
{
  const f = new ModelFeed('wm4');
  // T1 在飞
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r1', trigger: 'user', content: 'msg1' });
  f.push({
    type: 'iteration', turnID: 1, iter: 3, seq: 1, phase: 'thinking',
    content: 'c3', reasoning: '', iterationsDelta: [
      { iteration: 1, content: 'a', reasoning: '', tools: [] },
      { iteration: 2, content: 'b', reasoning: '', tools: [] },
    ], activeTools: [], completedTools: [],
  });
  // 排队消息
  f.push({
    type: 'user_sent',
    row: { id: 'u2', content: 'msg2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnHint: 2, queued: true, command: false });
  // cancel T1（带 turn 的收尾帧 = 后端 PR #454 之后的正常形态）
  f.push({ type: 'text_final', turnID: 1, content: '', cancelled: true, progressHistory: [] });
  // 排队消息立刻出队成新一轮
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'msg2' });
  f.push({
    type: 'iteration', turnID: 2, iter: 1, seq: 2, phase: 'thinking',
    content: 'x', reasoning: '', activeTools: [], completedTools: [],
  });
  // ⛔ 迟到的 turn-less cancel ack：**带上取消归属**（store 的 `cancelTargetTurn` = 取消发起时的轮 T1）
  //   ⇒ bridge 必须只认 T1（已收尾 ⇒ 幂等丢弃），绝不顺手收尾刚出队的 T2。
  f.push({ type: 'text_final', turnID: null, content: '', cancelled: true, progressHistory: [] }, 1);

  const t2: TurnRec | undefined = f.state.turns.get(2 as never);
  ok('④ 出队的新轮 T2 仍存在', t2 !== undefined);
  ok('④ 新轮 T2 **不得**被迟到 cancel ack 收尾（final 必须为空）', t2 !== undefined && t2.final === null);
  ok('④ 新轮 T2 仍 live', f.state.live !== null && (f.state.live as { turn: number }).turn === 2);
  const t1: TurnRec | undefined = f.state.turns.get(1 as never);
  ok('④ 被取消的 T1 已收尾且标记 cancelled',
    t1 !== undefined && t1.final !== null && t1.final.cancelled === true);
  const rows = f.rows();
  const u2 = rows.filter((r) => r.role === 'user' && r.content === 'msg2');
  eq('④ 排队消息在消息流里**恰好一次**（不重复、不丢）', u2.length, 1);
}

// ── ⑤ 归属不明（无在飞轮）⇒ 产出 snapshot effect（权威重载），不静默丢 ─────────
{
  const st: State = emptyState('c1', 1, 0);
  const res = stepEvent(st, {
    type: 'text_final', turnID: null, content: '', cancelled: true, progressHistory: [],
  } as never, 'c1');
  eq('⑤ 无在飞轮时的 turn-less 收尾 ⇒ 恰好一个 snapshot effect', res.effects.length, 1);
  eq('⑤ effect 种类 = snapshot', res.effects.length > 0 ? res.effects[0].kind : '', 'snapshot');
}

// ── ⑥ 反向：仍在飞且 streaming 的轮 ⇒ turn-less 收尾照旧生效（不回归）──────────
{
  const st: State = emptyState('c1', 1, 0);
  const t: TurnRec = newTurn(1 as TurnID, null, null);
  const turns = new Map<number, TurnRec>();
  turns.set(1, { ...t, blocks: [{ iteration: 1 }] as never, final: null, streaming: true, phase: 'tool_exec' });
  const live = { turn: 1, iteration: 1, content: '', reasoning: '', tools: [], genui: '' };
  const res = stepEvent({ ...st, turns, live } as State, {
    type: 'text_final', turnID: null, content: '', cancelled: true, progressHistory: [],
  } as never, 'c1');
  const got: TurnRec | undefined = res.state.turns.get(1 as never);
  ok('⑥ 在飞轮被 turn-less 收尾（final 落定）', got !== undefined && got.final !== null);
  ok('⑥ 且带 cancelled 标记', got !== undefined && got.final !== null && got.final.cancelled === true);
}

console.log(`turn_watermark: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
