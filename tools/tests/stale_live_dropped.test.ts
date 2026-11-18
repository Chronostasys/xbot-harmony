/**
 * **陈旧 live 必须被丢弃**（用户 2026-11-05：「有些边缘情况会把两个 agent turn 连续渲染」+
 * 「最后一个思考内容是之前的一个老 turn 里的」）。
 *
 * 根因：`live` 是"当前在飞迭代"，但它只被**同号收尾**清掉（`onDone`/`onFinal` 判 `live.turn === f.turn`）。
 *   边缘情况下（服务端跳过 done 直接开下一轮 / 权威快照已推进到新回合 / 断流重放）上一轮的
 *   `live` 会**残留**：它挂在自己的旧回合上 ⇒ 该回合的行 = 已提交块 ⊕ 陈旧在飞块
 *   ⇒ 界面上"思考/工具"多出一段（看起来就是两个 agent turn 连着渲染）。
 *
 * 不变量（两条）：
 *   ① **新回合开始**（`open(turn N)`）⇒ 任何 `live.turn < N` 一律丢弃；
 *   ② **权威快照推进**（`hydrate` 里快照出现比 live 更新的回合）⇒ 旧 live 一律丢弃。
 */
declare const process: { exit: (c: number) => void };

import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { OpenFrame, State, TickFrame, TurnID, UserLine } from '../../entry/src/main/ets/core/model_types';
import { step } from '../../entry/src/main/ets/core/model_step';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

const CHAT = 'chat_S';
const EPOCH = 1;
let sl_pass = 0, sl_fail = 0;
function sl_eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { sl_pass++; } else { sl_fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function sl_ok(name: string, cond: boolean): void {
  if (cond) { sl_pass++; } else { sl_fail++; console.log(`  ✗ ${name}`); }
}

function user(turn: number): UserLine {
  return {
    id: `u${turn}`, content: `问题${turn}`, timestamp: 't', isNotification: false,
    queued: false, sending: false, requestID: `r${turn}`,
  };
}
function open(turn: number, seq: number): OpenFrame {
  return { kind: 'open', epoch: EPOCH, seq, chat: CHAT, turn, user: user(turn), requestID: `r${turn}` };
}
function tick(turn: number, iteration: number, seq: number, text: string): TickFrame {
  return {
    kind: 'tick', epoch: EPOCH, seq, chat: CHAT, turn, iteration, phase: 'thinking', streaming: true,
    content: { kind: 'full', text }, reasoning: { kind: 'full', text: `思考-${text}` },
    tools: [], genui: '',
  };
}

// ── §1 新回合 open ⇒ 上一轮的陈旧 live 必须丢弃（否则旧回合多渲染一段）──────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, '第一轮实时'), '').state;
  sl_ok('§1 前置：live 属于回合 1', s.live !== null && s.live.turn === 1);
  // 服务端直接开下一轮（这一轮的 done/final 丢了）
  s = step(s, open(2, 3), '').state;
  sl_eq('§1 新回合 open 后旧 live 必须清空', s.live, null);
  sl_ok('§1 旧回合 1 仍在（不丢历史）', s.turns.has(1 as TurnID));
}

// ── §2 权威快照推进到更新的回合 ⇒ 旧 live 丢弃（断流重放/跳轮）─────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, '第一轮实时'), '').state;
  const snap: WireHistoryMessage[] = [
    { id: 'm1', role: 'user', content: '问题1', turnID: 1, timestamp: 't' },
    { id: 'm2', role: 'assistant', content: '答1', turnID: 1, timestamp: 't', iterations: [] },
    { id: 'm3', role: 'user', content: '问题2', turnID: 2, timestamp: 't' },
    { id: 'm4', role: 'assistant', content: '答2', turnID: 2, timestamp: 't', iterations: [] },
  ];
  const next: State = hydrate(s, snap, 3);
  sl_eq('§2 快照已有更新回合 ⇒ 旧 live 必须清空', next.live, null);
}

// ── §3 快照里 live 的那一轮**仍在飞**（没有更新回合）⇒ live 必须保留 ──────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, '实时'), '').state;
  const snap: WireHistoryMessage[] = [
    { id: 'm1', role: 'user', content: '问题1', turnID: 1, timestamp: 't' },
  ];
  const next: State = hydrate(s, snap, 3);
  sl_ok('§3 没有更新回合 ⇒ live 保留', next.live !== null && next.live.turn === 1);
}

// ── §4 idle 帧携带**更新的回合号** ⇒ 陈旧 live 必须清空（用户 2026-11-05 截图：空闲会话末尾
//   还挂着上一轮的「思考 95 字 + 两枚工具」，看起来就是"两个 agent turn 连着渲染"）──────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, '实时正文'), '').state;
  sl_ok('§4 前置：live 存在', s.live !== null);
  // 服务端已推进到回合 2 并 idle（回合 1 的 done/final 丢了）⇒ 回合 1 的 live 是陈旧的
  s = step(s, {
    kind: 'session', epoch: EPOCH, seq: 3, chat: CHAT, running: false, turn: 2,
  } as never, '').state;
  sl_eq('§4 idle(回合 2) ⇒ 回合 1 的陈旧 live 必须清空', s.live, null);
  sl_ok('§4 回合本体仍在（只清在飞，不丢历史）', s.turns.has(1 as TurnID));
}

// ── §5 **对照**：idle 不带回合号 ⇒ live 必须保留（`reduce F1` 语义：idle 只停流，
//   generating 工具不得消失；⛔ 不能为了清陈旧 live 而把当前在飞内容一起清掉）─────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, '实时正文'), '').state;
  s = step(s, { kind: 'session', epoch: EPOCH, seq: 3, chat: CHAT, running: false } as never, '').state;
  sl_ok('§5 idle 无回合号 ⇒ live 保留（在飞工具不消失）', s.live !== null && s.live.turn === 1);
}

console.log(`stale_live_dropped: ${sl_pass} passed, ${sl_fail} failed`);
if (sl_fail > 0) { process.exit(1); }
