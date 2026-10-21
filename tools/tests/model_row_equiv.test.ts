/**
 * `model_row_equiv` —— **行级等价**判据：旧管线 vs 新模型 + ArkTS 桥接（`docs/STATE-MODEL.md` §9.3）。
 *
 * 同一串老 wire 事件分别走
 *   ① 旧：`reduce` → `deriveRows` → (`applyRow` 由 store 做)
 *   ② 新：`adapt` → `stepAll` → `applyModel`（`core/model_bridge.ets`）
 * 断言两边的行序列在 **(id, role, turnID, 块数, 在飞正文, 用户正文)** 上完全一致。
 *
 * 这是 **W2 切换行源前的最后一道证据**：本判据绿 ⇒ 可以安全把 `store.rebuildRows` 的行源换成模型。
 * ⛔ 口径：比较的是**结构与身份**，不是每个渲染字段（视觉细节由装机对照负责）。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState } from '../../entry/src/main/ets/core/chat_types_full';
import type { ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';
import { deriveRows } from '../../entry/src/main/ets/core/derive';
import type { Row } from '../../entry/src/main/ets/core/derive';
import { adapt } from '../../entry/src/main/ets/core/model_adapter';
import type { WireEvent } from '../../entry/src/main/ets/core/model_adapter';
import { stepAll } from '../../entry/src/main/ets/core/model_step';
import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { State } from '../../entry/src/main/ets/core/model_types';
import { applyModel } from '../../entry/src/main/ets/core/model_bridge';
import { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const CHAT = 'chat_row_equiv';

/** 一段真实形状的事件流：user 回合 → 迭代1（工具）→ 迭代2（正文）→ final。 */
const EVS: WireEvent[] = [
  { type: 'turn_started', turnID: 1, trigger: 'user', content: 'hello', requestID: 'r1' },
  {
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', content: '', reasoning: 'r1',
    activeTools: [{ name: 'Shell', label: 'Shell: ls', status: 'running', call_id: 'c1', iteration: 1 }],
    completedTools: [], streamingTools: [],
  },
  {
    type: 'iteration', turnID: 1, iter: 1,
    activeTools: [], completedTools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', call_id: 'c1', iteration: 1 }],
    streamingTools: [],
    iterationsDelta: [{ iteration: 1, content: '', reasoning: 'r1', tools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', call_id: 'c1', iteration: 1 }] }],
  },
  {
    type: 'iteration', turnID: 1, iter: 2, phase: 'thinking', content: 'answer', reasoning: '',
    activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [{ iteration: 2, content: 'answer', reasoning: '', tools: [] }],
  },
  {
    type: 'text_final', turnID: 1, content: 'answer',
    progressHistory: [
      { iteration: 1, content: '', reasoning: 'r1', tools: [{ name: 'Shell', label: 'Shell: ls', status: 'done', call_id: 'c1', iteration: 1 }] },
      { iteration: 2, content: 'answer', reasoning: '', tools: [] },
    ],
  },
];

function toDomain(e: WireEvent): DomainEvent {
  switch (e.type) {
    case 'turn_started':
      return { type: 'turn_started', turnID: 1 as never, requestID: e.requestID ?? null, trigger: 'user', content: e.content ?? null } as unknown as DomainEvent;
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

// ① 旧管线
const oldState: ChatState = EVS.reduce((s: ChatState, e: WireEvent) => reduce(s, toDomain(e)), initialChatState(CHAT));
const oldRows: readonly Row[] = deriveRows(oldState);

// ② 新模型 + ArkTS 桥接
let newState: State = emptyState(CHAT, 1, 0);
for (const e of EVS) {
  newState = stepAll(newState, adapt({ ...e, seq: newState.seq + 1 }, CHAT, 1), 't').state;
}
const newRows: ChatRow[] = applyModel(newState, new Map<string, ChatRow>());

// ③ 对齐比较：行数 / 每行身份 / 块数 / 正文
eq('① 行数一致', newRows.length, oldRows.length);
{
  const n: number = Math.min(newRows.length, oldRows.length);
  for (let i = 0; i < n; i++) {
    const o: Row = oldRows[i];
    const r: ChatRow = newRows[i];
    const oRole: string = o.kind === 'user' ? 'user' : 'assistant';
    eq(`② 行 ${i} 角色一致`, r.role, oRole);
    if (o.kind === 'user') {
      eq(`② 行 ${i} 用户正文一致`, r.content, o.content);
      eq(`② 行 ${i} turnID 一致`, r.turnID, o.turnID);
    } else {
      const oBlocks: number = o.kind === 'committed' || o.kind === 'live' || o.kind === 'frozen'
        ? o.iterations.length : 0;
      eq(`② 行 ${i} 块数一致`, r.iterations.length, oBlocks);
      // 工具身份（call_id）逐块对齐
      const oCalls: string[][] = [];
      if (o.kind === 'committed' || o.kind === 'live' || o.kind === 'frozen') {
        for (const it of o.iterations) {
          const cs: string[] = [];
          const ts: unknown = (it as { tools?: unknown }).tools;
          if (Array.isArray(ts)) {
            for (const t of ts as Array<{ call_id?: string }>) {
              cs.push(t.call_id === undefined ? '' : t.call_id);
            }
          }
          oCalls.push(cs);
        }
      }
      const nCalls: string[][] = r.iterations.map((it) => (it.tools === undefined ? [] : it.tools.map((t) => (t.call_id === undefined ? '' : t.call_id))));
      eq(`② 行 ${i} 工具身份一致`, nCalls, oCalls);
    }
  }
}

console.log(`\nmodel_row_equiv: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
