/**
 * turndrop.test.ts — perf-audit #5 的判别力测试（TURNDROP 诊断降噪 + 语义判定）。
 *
 * 判定前提（已用真实数据取证，见提交说明）：TURNDROP 里被"丢弃/跳过"的 turn 是
 * **无 assistant 产出的空壳 frozen**（真实来源：cron「⏰ [定时任务触发]」/通知 turn —
 * 后端只下发 user 行）。derive 跳过它的 assistant 行是**正确**的（幽灵行消除），
 * **不是内容丢失**；user 行照常渲染。
 *
 * 本文件锁死三件事：
 *   ① 丢弃语义：空壳 turn ⇒ 无 assistant 行、但 user 行必须保留（不是"整个 turn 消失"）。
 *   ② 保留语义：正常 turn 的内容必须完整渲染；mid-turn 收尸（fold）不得丢内容。
 *   ③ 日志收敛：逐 turn 走 debug、唯一 warn 是**一条**汇总结论且计数正确、跨帧去重。
 *
 * mutation 自证（改坏判据 ⇒ 必红）见各 it 内注释。
 */

import { describe, expect, it, summary } from './vitest_shim'
import { deriveRows, flushTurndropSummary } from '../../entry/src/main/ets/core/derive'
import { historyToReplaced } from '../../entry/src/main/ets/core/integrate'
import { reduce } from '../../entry/src/main/ets/core/reduce'
import {
  initialChatState,
  iterNum,
  turnID,
  type ChatState,
  type DomainEvent,
} from '../../entry/src/main/ets/core/chat_types_full'
import type { ChatMessage } from '../../entry/src/main/ets/core/chattypes'

// ─── 构造工具 ─────────────────────────────────────────────────

function msg(id: number, turn: number, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: `m-${id}`,
    role,
    content,
    iterations: [],
    timestamp: `t${id}`,
    isPartial: false,
    turnID: turn,
    dbID: id,
  }
}

/** 走真实水合路径：DB 历史 → history_replaced → reduce（= store 的冷启动路径）。 */
function hydrate(msgs: readonly ChatMessage[]): ChatState {
  const ev: DomainEvent = historyToReplaced(msgs, null)
  return reduce(initialChatState('c'), ev)
}

const T1 = turnID(1)
const T2 = turnID(2)

// ─── ① 丢弃语义 ────────────────────────────────────────────────

describe('TURNDROP ① 丢弃语义（hollow-frozen 是正确跳过，不是内容丢失）', () => {
  it('空壳 turn：无 assistant 行、user 行保留（不是"整个 turn 从渲染层消失"）', () => {
    // turn 1 = cron/通知形态（只有 user 行，payload 无 assistant）
    // turn 2 = 正常 turn（user + assistant）
    const s = hydrate([
      msg(101, 1, 'user', '⏰ [定时任务触发] 背诵一次出师表'),
      msg(102, 2, 'user', '正常提问'),
      msg(103, 2, 'assistant', '正常回复'),
    ])

    // 空壳 turn（1）在状态里确实是 frozen 且无产出（前提自检）。
    const t1 = s.turns.get(T1)!
    expect(t1.phase.kind).toBe('frozen')

    const rows = deriveRows(s)
    // turn 2 内容完整渲染（保留语义）。
    expect(
      rows.some((r) => r.kind === 'committed' && r.turnID === 2 && String(r.content).includes('正常回复')),
    ).toBe(true)
    // turn 1 的 user 行 **必须保留** —— 这是"不是整个 turn 消失"的判别断言。
    expect(rows.some((r) => r.kind === 'user' && r.turnID === 1)).toBe(true)
    // turn 1 **没有任何** assistant 行 —— 空壳无内容可渲染（丢弃正确）。
    // mutation：把 hasVisibleOutput 改成恒 true ⇒ 空壳会渲染 frozen 行 ⇒ 此断言必红。
    expect(rows.some((r) => r.kind !== 'user' && r.turnID === 1)).toBe(false)
  })
})

// ─── ② 保留语义（mid-turn 收尸不丢内容） ────────────────────────

describe('TURNDROP ② 保留语义（收尾路径不得丢已产出内容）', () => {
  it('turn_started(N+1) mid-flight 收尸：旧 turn 有产出 ⇒ 折成 committed（内容不丢）', () => {
    let s = initialChatState('c')
    s = reduce(s, { type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null })
    s = reduce(s, {
      type: 'stream', turnID: T1, seq: null, iteration: iterNum(1),
      content: '逐字稿重要内容', reasoning: undefined, streamingTools: undefined, genui: undefined, streamStats: undefined,
    })
    // N+1 到达（旧 live 仍在跑）—— 收尸路径。
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: null, trigger: 'user', content: null })

    // 旧 turn 必须折成 committed（有产出），**不得**变空壳。
    // mutation：把收尸分支的 `hasOutput(...) ? foldPhase : frozen` 改成恒 frozen ⇒ 必红。
    const t1 = s.turns.get(T1)!
    expect(t1.phase.kind).toBe('committed')
    // 渲染层：内容仍在（"已渲染内容永不消失"）。
    const rows = deriveRows(s)
    expect(
      rows.some((r) => r.turnID === 1 && String(r.content ?? '').includes('逐字稿重要内容')),
    ).toBe(true)
  })
})

// ─── ③ 日志收敛（逐 turn debug + 唯一 warn 汇总 + 去重） ─────────

interface Cap { level: 'warn' | 'debug'; text: string }

function withCapture(fn: (cap: Cap[]) => void): Cap[] {
  const cap: Cap[] = []
  const ow = console.warn
  const od = console.debug
  console.warn = (...a: unknown[]) => { cap.push({ level: 'warn', text: a.map(String).join(' ') }) }
  console.debug = (...a: unknown[]) => { cap.push({ level: 'debug', text: a.map(String).join(' ') }) }
  try {
    fn(cap)
  } finally {
    console.warn = ow
    console.debug = od
  }
  return cap
}

describe('TURNDROP ③ 日志收敛', () => {
  it('逐 turn 走 debug（非 warn）+ burst 结束打唯一 warn 汇总且计数正确', () => {
    flushTurndropSummary() // 清掉前面用例可能残留的累计（跨用例模块级状态）

    const msgs: ChatMessage[] = []
    for (let i = 0; i < 7; i++) msgs.push(msg(200 + i, 10 + i, 'user', '⏰ [定时任务触发]'))

    const cap = withCapture((c) => {
      const s = hydrate(msgs)
      deriveRows(s)
      // 7 个空壳 turn：逐条 debug（不会污染 warn 级日志）。
      expect(c.filter((x) => x.level === 'warn').length).toBe(0)
      expect(c.filter((x) => x.level === 'debug').length).toBe(7)
      // burst 结束 → 唯一一条 warn 汇总。
      flushTurndropSummary()
    })

    const warns = cap.filter((x) => x.level === 'warn')
    // 唯一 warn（旧实现是 7 条逐 turn warn）。
    // mutation：把 noteTurndrop 里的 console.debug 改回 console.warn ⇒ 此处 warn 数=7 必红。
    expect(warns.length).toBe(1)
    // 汇总计数正确（7 个空壳）。
    // mutation：flush 后不清零/不清 Set ⇒ 二次 flush 或计数漂移 ⇒ 必红。
    expect(warns[0].text.includes('7')).toBe(true)
    expect(warns[0].text.includes('hollow') || warns[0].text.includes('空壳')).toBe(true)
  })

  it('跨帧去重：同一 turnID 反复 derive 只计一次（不刷屏）', () => {
    flushTurndropSummary()

    const msgs: ChatMessage[] = [
      msg(301, 30, 'user', '⏰ [定时任务触发] A'),
      msg(302, 31, 'user', '⏰ [定时任务触发] B'),
    ]

    const cap = withCapture((c) => {
      // 两次**独立**水合 ⇒ 两套全新 Turn 对象（同 turnID）—— 真实场景：idempotent
      // history_replaced 重放时每个 turn 会重建。去重键按 turnID ⇒ 只计一次。
      deriveRows(hydrate(msgs))
      deriveRows(hydrate(msgs))
      // 2 个 turnID ⇒ 2 条 debug（不是 4 条）。
      // mutation：删掉 noteTurndrop 的 turndropSeen 去重 ⇒ 4 条 ⇒ 必红。
      expect(c.filter((x) => x.level === 'debug').length).toBe(2)
      flushTurndropSummary()
    })

    const warns = cap.filter((x) => x.level === 'warn')
    expect(warns.length).toBe(1)
    expect(warns[0].text.includes('2')).toBe(true)
  })

  it('无诊断时不打汇总（零噪音）', () => {
    flushTurndropSummary()
    const cap = withCapture((c) => {
      // 只有正常 turn（无空壳、无收尾）⇒ 零 TURNDROP。
      deriveRows(hydrate([msg(401, 40, 'user', '正常'), msg(402, 40, 'assistant', '正常回复')]))
      flushTurndropSummary()
    })
    expect(cap.length).toBe(0)
  })
})

declare const process: { exit: (c: number) => void }
process.exit(summary('turndrop'))
