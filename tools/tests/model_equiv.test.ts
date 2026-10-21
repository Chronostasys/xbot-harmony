/**
 * `model_equiv` —— **老管线 × 新模型**的等价判据（`docs/STATE-MODEL.md` §9.3 差分回放的离线版）。
 *
 * 做法：同一串**老 wire 事件**分别喂给
 *   ① 旧 `reduce`（`core/reduce.ts`，ChatState）
 *   ② `adapter.adapt` → `stepAll`（新模型 State）
 * 然后按 (turn, iteration) 对齐比较：块数、块正文、块内工具 `call_id` 序列、在飞迭代号。
 *
 * ⛔ 口径说明（诚实边界）：这是**结构等价**，不是逐字节等价 —— 老管线有若干"客户端兜底"
 * （同号合并、空壳顶位、在飞折叠），新模型把这些统一成"服务端义务 + 拉权威"。
 * 因此本判据断言的是：**在合法事件序列下（每迭代都有 delta/done），两侧的迭代与工具完全一致**。
 * 任何一侧出现"多一块/少一块/多一枚工具"⇒ 红。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState } from '../../entry/src/main/ets/core/chat_types_full';
import type { ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';
import { adapt } from '../../entry/src/main/ets/core/model_adapter';
import type { WireEvent } from '../../entry/src/main/ets/core/model_adapter';
import { stepAll } from '../../entry/src/main/ets/core/model_step';
import type { State } from '../../entry/src/main/ets/core/model_types';
import { emptyState } from '../../entry/src/main/ets/core/model_types';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const CHAT = 'chat_x';

// ── 事件序列（老 wire 形状；turn_started → 两次迭代（各带 delta）→ text_final）──
const EVS: WireEvent[] = [
  { type: 'turn_started', turnID: 1, trigger: 'user', content: 'hello', requestID: 'r1' },
  {
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec',
    content: '', reasoning: 'thinking1',
    activeTools: [{ name: 'Shell', label: 'Shell: ls', status: 'running', callID: 'c1', iteration: 1 }],
    completedTools: [], streamingTools: [],
  },
  {
    type: 'iteration', turnID: 1, iter: 1,
    activeTools: [], completedTools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', callID: 'c1', iteration: 1 }],
    streamingTools: [],
    iterationsDelta: [{ iteration: 1, content: '', reasoning: 'thinking1', tools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', callID: 'c1', iteration: 1 }] }],
  },
  {
    type: 'iteration', turnID: 1, iter: 2, phase: 'thinking',
    content: 'answer', reasoning: '',
    activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [{ iteration: 2, content: 'answer', reasoning: '', tools: [] }],
  },
  {
    type: 'text_final', turnID: 1, content: 'answer',
    progressHistory: [
      { iteration: 1, content: '', reasoning: 'thinking1', tools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', callID: 'c1', iteration: 1 }] },
      { iteration: 2, content: 'answer', reasoning: '', tools: [] },
    ],
  },
];

/** 旧管线：DomainEvent 形状（这里直接按 reduce 需要的字段造）。 */
function toDomain(e: WireEvent): DomainEvent {
  switch (e.type) {
    case 'turn_started':
      return { type: 'turn_started', turnID: 1 as never, requestID: e.requestID ?? null, trigger: 'user', content: e.content ?? null } as DomainEvent;
    case 'iteration':
      return {
        type: 'iteration', turnID: 1 as never, iter: (e.iter ?? 1) as never, seq: null,
        phase: e.phase, content: e.content, reasoning: e.reasoning,
        activeTools: (e.activeTools ?? []) as never, completedTools: (e.completedTools ?? []) as never,
        streamingTools: (e.streamingTools ?? []) as never,
        iterationsDelta: (e.iterationsDelta ?? []) as never,
        todos: undefined, goal: undefined,
      } as unknown as DomainEvent;
    case 'text_final':
      return {
        type: 'text_final', turnID: 1 as never, content: e.content as never,
        progressHistory: (e.progressHistory ?? []) as never, cancelled: false,
      } as unknown as DomainEvent;
    default:
      return { type: 'session', busy: false } as unknown as DomainEvent;
  }
}

const oldS: ChatState = EVS.reduce((s: ChatState, e: WireEvent) => reduce(s, toDomain(e)), initialChatState(CHAT));

// 新模型：adapter（老 wire → 6 帧）→ stepAll
let newS: State = emptyState(CHAT, 1, 0);
for (const e of EVS) {
  const inputs = e.seq === undefined ? adapt({ ...e, seq: newS.seq + 1 }, CHAT, 1) : adapt(e, CHAT, 1);
  newS = stepAll(newS, inputs, 't').state;
}

// ── 对齐比较 ──
const oldTurn = oldS.turns.get(1 as never);
const newTurn = newS.turns.get(1);
if (oldTurn === undefined || newTurn === undefined) {
  fail++;
  console.log('  ✗ 两侧都必须有 turn 1');
} else {
  const oldIts = oldTurn.phase.kind === 'committed'
    ? oldTurn.phase.payload.iterations
    : oldTurn.phase.data.iterations;
  eq('① 块数一致', newTurn.blocks.length, oldIts.length);
  const oldNums = oldIts.map((it) => it.iteration);
  const newNums = newTurn.blocks.map((b) => b.iteration);
  eq('② 迭代号序列一致', newNums, oldNums);
  const oldContent = oldIts.map((it) => (it.content === undefined ? '' : it.content));
  const newContent = newTurn.blocks.map((b) => b.content);
  eq('③ 块正文一致', newContent, oldContent);
  const oldCalls = oldIts.map((it) => (it.tools === undefined ? [] : it.tools.map((t) => t.callID)));
  const newCalls = newTurn.blocks.map((b) => b.tools.map((t) => t.call));
  eq('④ 每块的工具体一致（按 call_id）', newCalls, oldCalls);
  eq('⑤ 最终正文一致', newTurn.final === null ? null : newTurn.final.content,
    oldTurn.phase.kind === 'committed' ? oldTurn.phase.payload.content : null);
  eq('⑥ 新模型无在飞残留（已 final）', newS.live, null);
}

console.log(`\nmodel_equiv: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
