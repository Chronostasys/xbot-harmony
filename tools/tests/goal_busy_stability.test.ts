/**
 * goal_busy_stability.test.ts —— 两条用户规则（2026-10-21 原话）的判据：
 *
 * ① **goal 不得抽搐**：
 *    「Goal 这个问题一定是你出现了幻觉，认为某些消息会带上 goal 状态，但是这些消息可能
 *      根本就没有这个字段，然后你又没有做逻辑校验，没这个字段你就以为它是空的」。
 *    ⇒ `goal` 三态必须是：**字段缺失 ⇒ 不动**；`status:"cleared"` ⇒ 显式清除；
 *      其余（含 `objective:""` 的零值占位）⇒ **不动**。
 *    旧实现把 `objective === ''` 当清除 ⇒ 任何带零值 goal 的帧都把横幅清一次 ⇒ 抽搐。
 *
 * ② **busy 只能按两种方式变 idle**：
 *    「必须是要么你收到了一个没有 toolcall 的迭代，要么是后端告诉你他 idle 了，
 *      别的任何情况你不能让 busy 变成 IDLE」。
 *    ⇒ `history_replaced`（DB 快照，**滞后**于 SSE）**绝不允许**把 running 关掉 ——
 *      它只能"打开"（快照里有 active turn 时）。
 */
declare const process: { exit: (c: number) => void };

import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import {
  ChatState, DomainEvent, initialChatState, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import type { GoalInfo } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = turnID(1);
function progress(goal: unknown, presence: boolean): DomainEvent | null {
  const p: Record<string, unknown> = {
    chat_id: 'c', phase: '', turn_id: 1, seq: 5,
  };
  if (presence) { p.goal = goal; }
  const evs = normalizeEvent({ type: 'progress_structured', progress: p }, 'c');
  if (evs === null || evs.length === 0) { return null; }
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].type === 'iteration' || evs[i].type === 'phase_done') { return evs[i]; }
  }
  return evs[0];
}
function goalOf(ev: DomainEvent | null): GoalInfo | null | undefined {
  if (ev === null) { return undefined; }
  const g: unknown = (ev as unknown as { goal?: unknown }).goal;
  return g as GoalInfo | null | undefined;
}

console.log('\n▶ §A goal 三态：缺失 ⇒ 不动；零值占位 ⇒ 不动；cleared ⇒ 清除；有效 ⇒ 覆盖');
{
  ok('★A 字段**缺失** ⇒ undefined（不动状态）', goalOf(progress(null, false)) === undefined);
  ok('★A `{}` ⇒ undefined（不动）', goalOf(progress({}, true)) === undefined);
  ok('★A `objective:""` 且无 cleared 标记 ⇒ undefined（**旧实现这里是 null ⇒ 抽搐**）',
    goalOf(progress({ objective: '', status: 'active' }, true)) === undefined);
  ok('★A `status:"cleared"` ⇒ null（显式清除）',
    goalOf(progress({ objective: '', status: 'cleared' }, true)) === null);
  const got = goalOf(progress({ objective: '重构状态机', status: 'active' }, true)) as unknown as { objective?: string };
  ok('★A 有效目标 ⇒ 覆盖', got !== null && got !== undefined && got.objective === '重构状态机');
}

console.log('\n▶ §B 零值 goal 帧不得清掉已有目标（状态机层面）');
{
  let s: ChatState = reduce(initialChatState('c'), {
    type: 'session_fields', todos: [], goal: { objective: '目标A', status: 'active' } as GoalInfo,
  } as unknown as DomainEvent);
  ok('★B 前置：目标已存在', s.goal !== null && s.goal !== undefined);
  // 模拟真实帧：带 goal:{} ⇒ normalize 产出 undefined ⇒ applySessionFields 不动
  const ev: DomainEvent | null = progress({}, true);
  const g: unknown = ev === null ? undefined : (ev as unknown as { goal?: unknown }).goal;
  s = reduce(s, { type: 'session_fields', todos: [], goal: g as GoalInfo | undefined } as unknown as DomainEvent);
  ok('★B 零值帧后目标**仍在**（不被清空）', s.goal !== null && s.goal !== undefined);
}

console.log('\n▶ §C busy：DB 快照（history_replaced）不得把 running 关掉');
{
  let s: ChatState = reduce(initialChatState('c'), {
    type: 'session_running', running: true,
  } as unknown as DomainEvent);
  ok('★C 前置：running=true', s.sessionRunning);
  // 快照：无 active turn（DB 滞后，assistant 行还没落库）
  s = reduce(s, {
    type: 'history_replaced', turns: [], legacy: [], pendingUsers: [], active: null,
    lastSeq: 0, todos: [], goal: undefined, standalone: [],
  } as unknown as DomainEvent);
  ok('★C 无 active 的快照**不得**把 running 关掉（旧实现会 ⇒ busy 抽搐）', s.sessionRunning);
}

console.log('\n▶ §D mutation 自证（外部注入）');
console.log('   · `optGoal` 恢复 `objective === "" ⇒ null` ⇒ §A 第三条必红');
console.log('   · `history_replaced` 改回 `sessionRunning: authoritativeRunning` ⇒ §C 必红');

console.log(`\n  goal_busy_stability: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
