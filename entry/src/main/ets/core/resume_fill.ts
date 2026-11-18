/**
 * resume_fill.ts —— **补洞事件构造器**（纯 TS：`core/*.ts` 不受 ArkTS 的
 * `arkts-no-untyped-obj-literals` 约束，`DomainEvent` 是**联合接口** ⇒ 只能在 `.ts` 里造）。
 *
 * 用途：`store.resumeContinuity` 的 GAP 分支把服务端 `get_active_progress` 快照里的
 * `iteration_history`（增量）喂回**既有事件管道**（`adapt → step`）。
 * ⛔ 这里**不合并**任何状态：只把"服务端已确认的迭代"翻译成与 SSE 同形的 `iteration` 帧，
 *   投影/去重/块序仍由状态机与模型算（单一真源）。
 * ⛔ 只造 `done`（`iterationsDelta`）与一次 `tick`（尾部累积正文），绝不造 `final`。
 */
import { DomainEvent, iterNum, turnID } from './chat_types_full';

/**
 * ⛔ **不能**从 `.ets` 导入类型（ArkTS 硬约束：`Importing ArkTS files in JS and TS files is
 *   forbidden` —— 门禁 ④ 实测）。这里按**结构**声明补洞所需的最小字段面，
 *   与 `types.ets` 的 `HistoryIteration`/`ToolProgress` 逐字段兼容（调用方直接传即可）。
 */
interface GapIterationLike {
  readonly iteration?: number;
  readonly content?: string;
  readonly reasoning?: string;
  readonly tools?: readonly object[];
  readonly genui?: string;
}

interface GapToolLike {
  readonly name?: string;
}

/**
 * 把 `history` 里 `[fromIter .. toIter]` 的迭代翻成**提交型** `iteration` 帧
 * （`iterationsDelta` ⇒ 走 `done` 语义）。
 */
export function gapIterationEvents(turn: number, fromIter: number, toIter: number,
  history: readonly GapIterationLike[], seq: number): DomainEvent[] {
  const out: DomainEvent[] = [];
  for (let i = 0; i < history.length; i++) {
    const it: GapIterationLike = history[i];
    const n: number = it.iteration !== undefined ? it.iteration : 0;
    if (n < fromIter || n > toIter) {
      continue;
    }
    out.push({
      type: 'iteration',
      turnID: turnID(turn),
      iter: iterNum(n),
      seq,
      phase: 'done',
      content: '',
      reasoning: '',
      iterationsDelta: [it],
      activeTools: [],
      completedTools: [],
    } as unknown as DomainEvent);
  }
  return out;
}

/**
 * 尾部帧（**tick** 语义）：把快照里"当前迭代"的累积正文/推理/在飞工具落地。
 * ⛔ 用 `content`（全文替换）而不是 `stream_delta`：快照是累积值，当增量用会重复追加。
 */
export function gapTailEvent(turn: number, iter: number, content: string, reasoning: string,
  activeTools: readonly GapToolLike[], seq: number): DomainEvent {
  return {
    type: 'iteration',
    turnID: turnID(turn),
    iter: iterNum(iter),
    seq,
    phase: 'thinking',
    content,
    reasoning,
    activeTools: activeTools.slice() as unknown as object[],
    completedTools: [],
  } as unknown as DomainEvent;
}
