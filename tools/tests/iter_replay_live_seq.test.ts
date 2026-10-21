/**
 * 重放真机日志序列（turn=1038 / iter 138→140，2026-10-21 16:50）并看**渲染结果**。
 * 目的：把用户报的「一个 Shell 消失」变成可复现的离线用例（先确认问题，再修）。
 *
 * 日志逐帧（[ITER-APPLY]）：
 *   evIter=139 delta=[138:Shell@138] active=[]      completed=[]        carried=false
 *   evIter=139 delta=[]              active=[]      completed=[]        carried=false ×3
 *   evIter=139 delta=[]              active=[Shell@139] completed=[]    carried=true  ×3
 *   evIter=139 delta=[]              active=[]      completed=[Shell@139] carried=true
 *   evIter=140 delta=[139:Shell@139] active=[]      completed=[]        carried=false
 *   evIter=140 delta=[]              active=[]      completed=[]        carried=false ×3
 *   evIter=140 delta=[]              active=[task_wait@140] completed=[] carried=true ×2
 */
declare const process: { exit: (c: number) => void }
declare function require(m: string): any

import { reduce } from '../../entry/src/main/ets/core/reduce'
import { initialChatState, iterNum, turnID, eventSeq } from '../../entry/src/main/ets/core/chat_types_full'
import type { ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full'
import { deriveRows } from '../../entry/src/main/ets/core/derive'
import { applyRow } from '../../entry/src/main/ets/core/render'
import { ChatRow } from '../../entry/src/main/ets/core/types'
import type { WebIteration, WebToolProgress } from '../../entry/src/main/ets/core/chattypes'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++ } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`) }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${name}`) }
}

let seq = 1000
function tool(name: string, iter: number, status: string): WebToolProgress {
  return { name, label: name, status, iteration: iter, callID: `${name}-${iter}`, elapsedMs: 0 } as unknown as WebToolProgress
}
/** 把工具塞进「该迭代的快照」形状（delta 里迭代条目带的 tools 就是 WebToolProgress[]）。 */
function iterSnap(n: number, tools: WebToolProgress[]): WebIteration {
  return { iteration: n, content: '', reasoning: '', tools, toolCount: tools.length } as unknown as WebIteration
}
function ev(evIter: number, delta: WebIteration[], active: WebToolProgress[], completed: WebToolProgress[], carried: boolean): DomainEvent {
  seq += 1
  return {
    type: 'iteration', turnID: turnID(1), iter: iterNum(evIter), seq: eventSeq(seq),
    content: undefined, reasoning: undefined,
    activeTools: active, completedTools: completed, iterationsDelta: delta,
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    toolsCarried: carried,
  } as unknown as DomainEvent
}

// ① 基线：live turn 1，已持有迭代 1..137（每块无工具）—— 对齐日志 heldMax=137。
let s: ChatState = initialChatState('chat-1')
s = reduce(s, { type: 'turn_started', turnID: turnID(1), requestID: null, trigger: 'user', content: 'go' } as DomainEvent)
const base: WebIteration[] = []
for (let i = 1; i <= 137; i++) base.push(iterSnap(i, []))
s = reduce(s, {
  type: 'iteration', turnID: turnID(1), iter: iterNum(138), seq: eventSeq(++seq),
  content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
  iterationsDelta: base, todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  toolsCarried: false,
} as unknown as DomainEvent)

// ② 逐帧重放日志
const sh138 = tool('Shell', 138, 'done')
const sh139 = tool('Shell', 139, 'done')
const tw140 = tool('task_wait', 140, 'running')
s = reduce(s, ev(139, [iterSnap(138, [sh138])], [], [], false))
s = reduce(s, ev(139, [], [], [], false))
s = reduce(s, ev(139, [], [tool('Shell', 139, 'running')], [], true))
s = reduce(s, ev(139, [], [tool('Shell', 139, 'running')], [], true))
s = reduce(s, ev(139, [], [], [sh139], true))
s = reduce(s, ev(140, [iterSnap(139, [sh139])], [], [], false))
s = reduce(s, ev(140, [], [], [], false))
s = reduce(s, ev(140, [], [tw140], [], true))

// ③ 状态层断言
const t = s.turns.get(turnID(1))
ok('重放后仍是 live turn', t !== undefined && t.phase.kind === 'live')
if (t !== undefined && t.phase.kind === 'live') {
  const its = t.phase.data.iterations
  const it138 = its.filter((x) => x.iteration === 138)[0]
  const it139 = its.filter((x) => x.iteration === 139)[0]
  ok('state: iter138 存在且带 Shell', it138 !== undefined && it138.tools.length === 1)
  ok('state: iter139 存在且带 Shell', it139 !== undefined && it139.tools.length === 1)
  ok('state: 在飞工具是 task_wait@140',
    t.phase.data.activeTools.length === 1 && t.phase.data.activeTools[0].name === 'task_wait')
}

// ④ **渲染层**断言（用户要求：看渲染结果）
const rows = deriveRows(s)
const liveRow = rows.filter((r) => r.kind === 'live')[0]
ok('有 live 渲染行', liveRow !== undefined)
if (liveRow !== undefined) {
  const cr = new ChatRow()
  cr.id = 'live'
  applyRow(cr, liveRow)
  const names = (b: number): string[] => {
    const blk = cr.iterations.filter((x) => x.iteration === b)[0]
    return (blk !== undefined && blk.tools !== undefined ? blk.tools : []).map((x) => x.name)
  }
  eq('渲染: iter138 块含 Shell', names(138).indexOf('Shell') >= 0, true)
  eq('渲染: iter139 块含 Shell', names(139).indexOf('Shell') >= 0, true)
}

// ⑤ 追加：`phase_done` 带同号 `finalIteration`（tools 为空）—— 是否**覆盖**掉已渲染的工具？
//    服务端 `snapshotCompletedIteration` 之后可能再组装一份"最后迭代"，`mergeIterations`
//    对同号是 **incoming 权威覆盖** ⇒ tools:[] 会把工具抹掉（用户「完成后 Shell 消失」的形态）。
{
  let s2: ChatState = s
  s2 = reduce(s2, {
    type: 'phase_done', turnID: turnID(1), seq: eventSeq(seq + 100),
    finalIteration: iterSnap(139, []), todos: undefined,
  } as unknown as DomainEvent)
  const t2 = s2.turns.get(turnID(1))
  let names2: string[] = []
  if (t2 !== undefined && t2.phase.kind === 'live') {
    const b = t2.phase.data.iterations.filter((x) => x.iteration === 139)[0]
    names2 = (b !== undefined ? b.tools : []).map((x) => x.name)
  }
  eq('state: phase_done(finalIteration=139,tools=[]) **不得**抹掉 iter139 的 Shell',
    names2.indexOf('Shell') >= 0, true)
}

// ── ⑪ P0（2026-10-21 用户：「task_wait 完成后从历史消失」，必要条件 = 该迭代只有 toolcall）──
//   形态：工具已在 live 快照的 `completed_tools` 里 `done`，而对应迭代的 delta **还没到**
//   ⇒ 提交（text_final / 收尸）时旧实现只折 `active/streaming`，**never completed**
//   ⇒ 这条工具彻底丢失；只有 toolcall 的迭代于是变空块 ⇒ 从界面消失。
{
  let s: ChatState = initialChatState('chat-1')
  s = reduce(s, { type: 'turn_started', turnID: turnID(1), requestID: null, trigger: 'user', content: 'go' } as DomainEvent)
  const base: WebIteration[] = []
  for (let n = 1; n <= 76; n++) base.push(iterSnap(n, []))
  s = reduce(s, {
    type: 'iteration', turnID: turnID(1), iter: iterNum(77), seq: eventSeq(++seq),
    content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
    iterationsDelta: base, todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    toolsCarried: false,
  } as unknown as DomainEvent)
  // task_wait 在跑 → 完成（进 completed_tools），delta 尚未到
  s = reduce(s, {
    type: 'iteration', turnID: turnID(1), iter: iterNum(77), seq: eventSeq(++seq),
    content: undefined, reasoning: undefined,
    activeTools: [tool('task_wait', 77, 'running')], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    toolsCarried: true,
  } as unknown as DomainEvent)
  s = reduce(s, {
    type: 'iteration', turnID: turnID(1), iter: iterNum(77), seq: eventSeq(++seq),
    content: undefined, reasoning: undefined,
    activeTools: [], completedTools: [tool('task_wait', 77, 'done')],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    toolsCarried: true,
  } as unknown as DomainEvent)
  // 提交（无正文、progressHistory 也没带 77）
  s = reduce(s, { type: 'text_final', turnID: turnID(1), content: '', progressHistory: [], cancelled: false } as unknown as DomainEvent)
  const t = s.turns.get(turnID(1))
  let names: string[] = []
  if (t !== undefined && t.phase.kind === 'committed') {
    const b = t.phase.payload.iterations.filter((x) => x.iteration === 77)[0]
    names = (b !== undefined && b.tools !== undefined ? b.tools : []).map((x) => x.name)
  }
  eq('★⑪ 提交时 completed_tools 里的 task_wait **不得丢失**（只含 toolcall 的迭代更不能整块消失）',
    names.indexOf('task_wait') >= 0, true)
}

console.log(`  iter_replay_live_seq: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
export {}
