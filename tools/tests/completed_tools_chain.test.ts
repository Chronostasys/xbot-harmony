/**
 * completed_tools_chain.test.ts —— **端到端链路回归**：服务端 `completed_tools` → 模型状态
 * → 投影（`model_project`）→ 渲染行（`model_bridge.applyModel`）并入 live 工具列表
 * （用户亲报 bug 的整链）。
 *
 * 用户亲报（2026-10-13）：「一个迭代 agent 调用两个工具 filereplace 和 shell，filereplace
 * 完成后会从原生前端消失，只能看到 shell」。
 *
 * 根因（对齐 web `LiveIteration.tsx:149-183` `toolDeriv`）：服务端把**完成**的工具从
 * `active_tools` 移入 **`completed_tools`**；web 的 live 列表 = `streaming + active +
 * completed`（**三数组**），而本仓曾只并了前两个，且 `completedTools` 字段**全链无存储/消费**
 * （死字段）。
 *
 * ── 新链路（本判据）────────────────────────────────────────────────────────────
 *   `model_adapter.adapt` 的 `iteration` 分支把 `streamingTools ⊕ activeTools ⊕ completedTools`
 *   全部翻成 `ToolTick` ⇒ `model_step.onTick` 写进 `live.tools`（位置状态）；投影把 `live`
 *   摊成末尾**在飞块**，`applyModel` 落到 `row.iterations` 末尾。
 *   本测试钉**三段链路**（任一断裂即红）：
 *     ① 模型状态：`iteration.completedTools` **必须落进 live 快照**（`state.live.tools`）；
 *     ② 端到端：渲染行末尾在飞块的 `tools` 同时含 completed 与 active（用户原症状：只剩 shell）；
 *     ③ 空值防御：事件缺 `completedTools` 字段（旧序列化/手写形状）⇒ 不崩、active 照常渲染。
 *
 * ⛔ mutation 自证：把 `model_adapter.adapt` 里 `push(ev.completedTools)` 删掉 ⇒ ①② 红
 *   （③ 仍绿，因为它只带 activeTools）。
 */
import { describe, expect, it, summary } from './vitest_shim'
import { ModelFeed } from './model_harness'
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types'

/** `turn_started` 事件（造 live turn 的第一步）。 */
function started(turn: number): Record<string, unknown> {
  return { type: 'turn_started', turnID: turn, requestID: null, trigger: 'user', content: null }
}

/** 造一枚**线格式**工具（判据只用 name/status/callID/iteration）。 */
function tw(name: string, status: string, callId: string, iter: number): Record<string, unknown> {
  return {
    name, label: name, status, elapsedMs: 0, summary: '', detail: '', args: '',
    toolHints: '', callID: callId, iteration: iter,
  }
}

/** `iteration` 事件（带 activeTools / completedTools）。 */
function iterEvent(
  turn: number, iter: number,
  active: Record<string, unknown>[], completed: Record<string, unknown>[] | undefined, seq: number,
): Record<string, unknown> {
  const ev: Record<string, unknown> = {
    type: 'iteration', turnID: turn, iter, seq, phase: 'tool_exec',
    content: undefined, reasoning: undefined,
    activeTools: active, iterationsDelta: [], todos: undefined, goal: undefined,
    subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  }
  if (completed !== undefined) {
    ev.completedTools = completed
  }
  return ev
}

/** live 行末尾在飞块的工具（页面 `LiveTailView` 读的就是这一块）。 */
function liveTools(row: ChatRow | undefined): ToolProgress[] {
  if (row === undefined) {
    return []
  }
  const its: HistoryIteration[] = row.iterations
  if (its.length === 0) {
    return []
  }
  const ts: ToolProgress[] | undefined = its[its.length - 1].tools
  return ts !== undefined ? ts : []
}

function ids(ts: ToolProgress[]): string[] {
  return ts.map((t) => (t.call_id === undefined ? '' : t.call_id))
}

describe('completed_tools_chain（用户亲报 bug 的端到端链路）', () => {
  it('★① 模型状态：iteration.completedTools 落进 live 快照（此前死字段）', () => {
    const f = new ModelFeed('chat-1')
    f.push(started(1))
    f.push(iterEvent(1, 1, [], [tw('FileReplace', 'done', 'fr-1', 1)], 2))
    const live = f.state.live
    expect(live !== null, '应有 live 快照').toBe(true)
    const lt = live === null ? [] : live.tools
    expect(lt.length === 1, 'live.tools 应含 1 枚').toBe(true)
    expect(lt.length > 0 && lt[0].meta.name === 'FileReplace', '应含 FileReplace').toBe(true)
    expect(lt.length > 0 && lt[0].state.status === 'done', '状态 = done').toBe(true)
  })

  it('★② 端到端：完成工具（completedTools）并入 live 块 ⇒ FileReplace 不消失', () => {
    const f = new ModelFeed('chat-1')
    f.push(started(1))
    f.push(iterEvent(1, 1,
      [tw('Shell', 'running', 'shell-1', 1)],
      [tw('FileReplace', 'done', 'fr-1', 1)], 2))
    const row = f.row('turn-1-live')
    expect(row !== undefined, '应有 live 行').toBe(true)
    const ts = liveTools(row)
    expect(ids(ts).indexOf('fr-1') >= 0, 'FileReplace 不消失').toBe(true)
    expect(ids(ts).indexOf('shell-1') >= 0, 'Shell 保留').toBe(true)
    expect(ts.length === 2, '两枚工具都在（用户原症状：只剩 shell）').toBe(true)
  })

  it('★③ 空值防御：completedTools 字段缺失（旧序列化）⇒ 不崩，active 照常渲染', () => {
    const f = new ModelFeed('chat-1')
    f.push(started(1))
    // 事件**不带** completedTools 键（真机旧序列化/手写形状）。
    f.push(iterEvent(1, 1, [tw('Shell', 'running', 'shell-1', 1)], undefined, 2))
    const row = f.row('turn-1-live')
    expect(row !== undefined, '缺 completedTools 字段也不崩').toBe(true)
    const ts = liveTools(row)
    expect(ids(ts).indexOf('shell-1') >= 0, 'activeTools 照常渲染').toBe(true)
    expect(ts.length === 1, '只有 activeTools 一枚（不凭空造）').toBe(true)
  })
})

summary('completed_tools_chain')

export {};
