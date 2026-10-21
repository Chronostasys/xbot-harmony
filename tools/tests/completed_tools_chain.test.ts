/**
 * completed_tools_chain.test.ts —— **端到端链路回归**：服务端 `completed_tools` → 状态机存储
 * → derive 投影 → render 并入 live 工具列表（用户亲报 bug 的整链）。
 *
 * 用户亲报（2026-10-13）：「一个迭代 agent 调用两个工具 filereplace 和 shell，filereplace
 * 完成后会从原生前端消失，只能看到 shell」。
 *
 * 根因（对齐 web `LiveIteration.tsx:149-183` `toolDeriv`）：服务端把**完成**的工具从
 * `active_tools` 移入 **`completed_tools`**；web 的 live 列表 = `streaming + active +
 * completed`（**三数组**），而本仓只并了前两个，且 `completedTools` 字段**全链无存储/消费**
 * （死字段 —— 类型里早有 `chat_types_full.ts`/`chattypes.ts`/`agent_normalize.ts:185`
 * 写它，却没有任何消费者）。
 *
 * 本测试钉**四段链路**（任一断裂即红；`render_inflight.test.ts` 的 ★⑦ 只覆盖第 ③ 段）：
 *   ① 状态机：`iteration` 事件的 `completedTools` **必须落进 live 快照**（此前未存）；
 *   ② derive：live 行的 `completedTools` 投影（此前 `LiveRowView` 无此字段）；
 *   ③ render：`inFlightBlock` 并入 `completedTools`（此前只并 active+streaming）；
 *   ④ 空值防御：旧序列化/手写行缺该字段 ⇒ `?? []` 不崩（真机 type-cast 形状）。
 *
 * ⛔ mutation 自证：把 reduce 那行 `completedTools:` 删掉 ⇒ ★①/★② 红；把 render 的
 *    `cTools` 循环删掉 ⇒ ★② 红（★① 仍绿 ⇒ 证明本组确实在钉不同链段）。
 */
import { describe, expect, it, summary } from './vitest_shim'
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive'
import { reduce } from '../../entry/src/main/ets/core/reduce'
import { inFlightBlock } from '../../entry/src/main/ets/core/render'
import {
  initialChatState, iterNum, turnID, DomainEvent,
} from '../../entry/src/main/ets/core/chat_types_full'
import type { WebToolProgress } from '../../entry/src/main/ets/core/chattypes'
import type { ChatRow, ToolProgress } from '../../entry/src/main/ets/core/types'

const T1 = turnID(1)

/** `turn_started` 事件（造 live turn 的第一步）。 */
function started(turn: ReturnType<typeof turnID>): DomainEvent {
  return { type: 'turn_started', turnID: turn, requestID: null, trigger: 'user', content: null } as unknown as DomainEvent
}

/** 造一枚**线格式**工具（判据只用 name/status/callID/iteration）。 */
function tw(name: string, status: string, callId: string, iter: number): WebToolProgress {
  const t = {
    name, label: name, status, elapsedMs: 0, summary: '', detail: '', args: '', toolHints: '', callID: callId,
  } as unknown as WebToolProgress
  (t as unknown as { iteration?: number }).iteration = iter
  return t
}

/** `iteration` 事件（带 activeTools / completedTools）。 */
function iterEvent(
  turn: ReturnType<typeof turnID>, iter: number,
  active: WebToolProgress[], completed: WebToolProgress[], seq = 5,
): DomainEvent {
  return {
    type: 'iteration', turnID: turn, iter: iterNum(iter), seq: seq as never,
    content: undefined, reasoning: undefined,
    activeTools: active as never, completedTools: completed as never,
    iterationsDelta: [], todos: undefined, goal: undefined, subAgents: undefined,
    tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent
}

function liveOf(s: ReturnType<typeof initialChatState>): LiveRowView | undefined {
  const rows: readonly Row[] = deriveRows(s)
  const r = rows.find((x) => x.kind === 'live')
  return r as LiveRowView | undefined
}

describe('completed_tools_chain（用户亲报 bug 的端到端链路）', () => {
  it('★① 状态机存储：iteration.completedTools 落进 live 快照（此前死字段）', () => {
    const frDone = tw('FileReplace', 'done', 'fr-1', 1)
    let s = reduce(initialChatState('chat-1'), started(T1))
    s = reduce(s, iterEvent(T1, 1, [], [frDone]))
    const live = liveOf(s)
    expect(live !== undefined, '应有 live 行').toBe(true)
    const ct = (live as LiveRowView).completedTools
    expect(ct !== undefined && ct.length === 1, 'completedTools 应含 1 枚').toBe(true)
    expect(ct !== undefined && ct[0].name === 'FileReplace', '应含 FileReplace').toBe(true)
  })

  it('★② 端到端：完成工具（completedTools）并入 live 块 ⇒ FileReplace 不消失', () => {
    const shell = tw('Shell', 'running', 'shell-1', 1)
    const frDone = tw('FileReplace', 'done', 'fr-1', 1)
    let s = reduce(initialChatState('chat-1'), started(T1))
    s = reduce(s, iterEvent(T1, 1, [shell], [frDone]))
    const live = liveOf(s)
    expect(live !== undefined, '应有 live 行').toBe(true)
    const block = inFlightBlock(live as LiveRowView, [])
    expect(block !== null, '应有在飞块').toBe(true)
    const bt: ToolProgress[] = (block as { tools?: ToolProgress[] }).tools ?? []
    const ids: string[] = bt.map((t) => (t.call_id === undefined ? '' : t.call_id))
    expect(ids.indexOf('fr-1') >= 0, 'FileReplace 不消失').toBe(true)
    expect(ids.indexOf('shell-1') >= 0, 'Shell 保留').toBe(true)
    expect(bt.length === 2, '两枚工具都在（用户原症状：只剩 shell）').toBe(true)
  })

  it('★③ 空值防御：completedTools 字段缺失（旧序列化）⇒ 不崩', () => {
    const shell = tw('Shell', 'running', 'shell-1', 1)
    let s = reduce(initialChatState('chat-1'), started(T1))
    s = reduce(s, iterEvent(T1, 1, [shell], []))
    const live = liveOf(s)
    expect(live !== undefined, '应有 live 行').toBe(true)
    // 抹掉字段，模拟"手写/旧序列化的 live 行"（真机上走 `as unknown as` 转型的路径）。
    const bare = { ...(live as LiveRowView) } as unknown as Record<string, unknown>
    delete bare.completedTools
    const block = inFlightBlock(bare as unknown as LiveRowView, [])
    expect(block !== null, '缺 completedTools 字段也不崩').toBe(true)
    // live 缺失字段时，shell 仍在 activeTools ⇒ 块内可见。
    const bt: ToolProgress[] = (block as { tools?: ToolProgress[] }).tools ?? []
    expect(bt.map((t) => t.call_id).indexOf('shell-1') >= 0, 'activeTools 照常渲染').toBe(true)
  })
})

summary('completed_tools_chain')

export {};
