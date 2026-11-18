/**
 * **子代理的 live 进度必须能落地**（用户 2026-11-04：「看不到 live 进度」）。
 *
 * 根因：子代理的转录来自 `get_agent_session_dump`（`parseSubAgentMessages` 按 user 行数派生
 *   turn 1..N），而子代理的 **SSE progress 帧**带的是**服务端自己的 `turn_id`**（
 *   `agent/interactive.go:373-390` 的 `buildPayload`，注释明确要求携带 TurnID）。
 *   两者不一致时（服务端 turn 号 > 本地 dump 派生的 turn 数），`onTick` 的
 *   「未知 turn ⇒ 不凭空造」分支直接丢弃该帧 ⇒ **live 永远不出现**。
 *
 * 不变量：**子代理会话（`chat` 以 `agent:` 开头）里，未知 turn 的流式帧必须现场建回合**；
 *   普通会话保持原纪律（不凭空造，交给 `pullTurn` 权威拉取）。
 */
declare const process: { exit: (c: number) => void };

import { emptyState, newTurn } from '../../entry/src/main/ets/core/model_types';
import type { State, TickFrame, TurnID, UserLine } from '../../entry/src/main/ets/core/model_types';
import { step } from '../../entry/src/main/ets/core/model_step';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

const EPOCH = 1;
let sp_pass = 0, sp_fail = 0;
function sp_eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { sp_pass++; } else { sp_fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function sp_ok(name: string, cond: boolean): void {
  if (cond) { sp_pass++; } else { sp_fail++; console.log(`  ✗ ${name}`); }
}

const SUB_CHAT = 'agent:web:chat_T/explore:inst';
const NORMAL_CHAT = 'chat_T';

function tick(chat: string, turn: number, iteration: number, seq: number, text: string): TickFrame {
  return {
    kind: 'tick', epoch: EPOCH, seq, chat, turn, iteration, phase: 'thinking', streaming: true,
    content: { kind: 'full', text }, reasoning: { kind: 'full', text: '想' },
    tools: [], genui: '',
  };
}
/** 子代理 dump 形态：一个 user 行 ⇒ 本地只有 turn 1。 */
function subDump(): State {
  const wire: WireHistoryMessage[] = [{
    id: 'm1', role: 'user', content: '【任务】', turnID: 1, timestamp: 't',
  }, {
    id: 'm2', role: 'assistant', content: '', turnID: 1, timestamp: 't',
    iterations: [{ iteration: 1, content: '历史迭代', reasoning: '', tools: [] }],
  }];
  return hydrate(emptyState(SUB_CHAT, EPOCH, 0), wire, 0, null);
}

// ── §1 子代理：服务端 turn 号 ≠ 本地 turn（本地只有 1）⇒ 仍必须落地 live ──────────
{
  const s: State = subDump();
  sp_eq('§1 前置：本地只有 turn 1', s.turns.size, 1);
  const r = step(s, tick(SUB_CHAT, 2, 1, 1, '实时正文'), '');
  const t = r.state.turns.get(2 as TurnID);
  sp_ok('§1 未知 turn 必须现场建回合（否则整帧被丢）', t !== undefined);
  sp_eq('§1 live 已建立且指向该 turn', r.state.live === null ? -1 : r.state.live.turn, 2);
  sp_eq('§1 实时正文落到 live', r.state.live === null ? '' : r.state.live.content, '实时正文');
}

// ── §2 普通会话：未知 turn 仍**不**凭空造（保持原纪律，交给权威拉取）────────────
{
  const s: State = emptyState(NORMAL_CHAT, EPOCH, 0);
  const r = step(s, tick(NORMAL_CHAT, 5, 1, 1, 'x'), '');
  sp_eq('§2 普通会话未知 turn 不造回合', r.state.turns.size, 0);
  sp_eq('§2 普通会话走 pullTurn 权威拉取', r.effects.length, 1);
  sp_eq('§2 effect 类型', (r.effects[0] as { kind: string }).kind, 'pullTurn');
}

// ── §3 子代理：done 帧同样不得因为未知 turn 被丢 ─────────────────────────────────
{
  const s: State = subDump();
  const r = step(s, {
    kind: 'done', epoch: EPOCH, seq: 2, chat: SUB_CHAT, turn: 3,
    block: { iteration: 1, content: '结果', reasoning: '', tools: [], subAgents: [], genui: '', cancelled: false },
  } as never, '');
  const t = r.state.turns.get(3 as TurnID);
  sp_ok('§3 子代理 done 未知 turn 也要建回合并落块', t !== undefined && t.blocks.length === 1);
}

// ── §4 会话树里的子代理 chat_id 可能**不带** `agent:` 前缀（形如 `web:chat_T/role:inst`）──
//   ⛔ 旧实现 `isSubChat` 只认 `agent:` 前缀 ⇒ 这类子代理会话被当成普通会话 ⇒
//      未知 turn 的进度帧全部走 pullTurn（拿不到 live）⇒ **子代理视图不渲染 SSE 进度**
//      （用户 2026-11-13 亲报「进入 subagent 视图不会渲染 sse 的进度」）。
{
  const ID2: string = 'web:chat_T/explore:inst';
  const s: State = emptyState(ID2, EPOCH, 0);
  const r = step(s, tick(ID2, 2, 1, 1, '实时正文'), '');
  sp_ok('§4 无 agent: 前缀的子代理 chat 也必须现场建回合',
    r.state.turns.get(2 as TurnID) !== undefined);
  sp_eq('§4 live 指向该 turn', r.state.live === null ? -1 : r.state.live.turn, 2);
  sp_eq('§4 实时正文落到 live', r.state.live === null ? '' : r.state.live.content, '实时正文');
}
console.log(`subagent_live_progress: ${sp_pass} passed, ${sp_fail} failed`);
if (sp_fail > 0) { process.exit(1); }
