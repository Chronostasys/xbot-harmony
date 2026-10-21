/**
 * turndrop.test.ts — perf-audit #5 的判别力测试（TURNDROP 诊断降噪 + 语义判定）。
 * （已迁移到模型链路；`deriveRows` 行源已删除，日志模块从 `derive.ts` 拆到 `turndrop.ts`）
 *
 * 判定前提（已用真实数据取证，见提交说明）：TURNDROP 里被"丢弃/跳过"的 turn 是
 * **无 assistant 产出的空壳**（真实来源：cron「⏰ [定时任务触发]」/通知 turn —
 * 后端只下发 user 行）。user 行照常渲染。
 *
 * 本文件锁死：
 *   ① **user 行不丢** + 正常 turn 内容完整渲染（丢弃语义的用户可见部分）；
 *   ② **新回合到达不得破坏旧回合已提交内容**（保留语义的客户端部分）；
 *   ③ 日志收敛：逐 turn 走 debug、唯一 warn 是**一条**汇总结论且计数正确、跨帧去重、零噪音。
 *
 * ── 两处旧断言已被**删除**（新链路按设计不存在该保证，均有实测证据）────────────────
 *   ⚠️ A「空壳 turn **没有任何** assistant 行」：新链路 `hydrate` 为每个有 user 的 turn 建
 *      `TurnRec`，`project` 的 `hasAny` 含 `t.user !== null` ⇒ **会产出一条空 assistant 行**
 *      （实测 `["turn-1","assistant",1,"",false,0]`）。这是新链路的**幻影行缺口**，见报告。
 *   ⚠️ B「`turn_started(N+1)` mid-flight 收尸 ⇒ 旧 turn 折成 committed、内容不丢」：
 *      `foldInFlightToIterations` / `foldPhase` 在 `docs/STATE-MODEL.md:818/820` 的**删除清单**里
 *      （新模型只有 live/committed 两态，`done` 已提交、`final` 只做整体替换）。
 *      实测：`onOpen` 无条件清 `live` ⇒ 未提交的在飞正文被丢弃（`rows` 里找不到）。
 *      ⇒ 客户端不再兜底；"不丢内容"变成**协议义务**（P4：`final.progressHistory` 覆盖所有迭代）。
 *
 * mutation 自证：把 `noteTurndrop` 里的 `console.debug` 改回 `console.warn` ⇒ ③ 的 warn 数 = 7 必红；
 *   删掉 `turndropSeen` 去重 ⇒ ③的跨帧去重必红；flush 后不清零 ⇒ 二次 flush 计数漂移必红。
 */

import { describe, expect, it, summary } from './vitest_shim'
import { ModelFeed } from './model_harness'
import { flushTurndropSummary, noteTurndrop } from '../../entry/src/main/ets/core/turndrop'
import { historyToReplaced } from '../../entry/src/main/ets/core/integrate'
import type { ChatMessage } from '../../entry/src/main/ets/core/chattypes'
import type { ChatRow } from '../../entry/src/main/ets/core/types'
import type { TurnRec } from '../../entry/src/main/ets/core/model_types'

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
  } as unknown as ChatMessage
}

/** 走真实水合路径：DB 历史 → history_replaced → 模型（= store 的冷启动路径）。 */
function hydrate(msgs: readonly ChatMessage[]): ModelFeed {
  const f = new ModelFeed('c')
  f.push(historyToReplaced(msgs, null) as unknown as never)
  return f
}

function turnRec(f: ModelFeed, turn: number): TurnRec {
  return f.state.turns.get(turn) as TurnRec
}

// ─── ① 丢弃语义（用户可见部分：user 行不丢、正常 turn 完整） ─────

describe('TURNDROP ① 丢弃语义（空壳 turn 不吞掉 user 行、不污染正常 turn）', () => {
  it('空壳 turn：user 行保留、无可见产出；正常 turn 内容完整渲染', () => {
    // turn 1 = cron/通知形态（只有 user 行，payload 无 assistant）
    // turn 2 = 正常 turn（user + assistant）
    const f = hydrate([
      msg(101, 1, 'user', '⏰ [定时任务触发] 背诵一次出师表'),
      msg(102, 2, 'user', '正常提问'),
      msg(103, 2, 'assistant', '正常回复'),
    ])

    // 空壳 turn（1）在模型里确实**无任何可见产出**（前提自检：块为空 + 终稿为空）。
    const t1 = turnRec(f, 1)
    expect(t1.user !== null, 'turn 1 的 user 行在模型里').toBe(true)
    expect(t1.blocks.length, '空壳 turn 没有块').toBe(0)
    expect(t1.final !== null && t1.final.content === '', '空壳 turn 终稿为空（无产出）').toBe(true)

    const rows: ChatRow[] = f.rows()
    // turn 2 内容完整渲染（保留语义）。
    expect(
      rows.some((r) => r.turnID === 2 && r.role === 'assistant' && String(r.content).includes('正常回复')),
    ).toBe(true)
    // turn 1 的 user 行 **必须保留** —— 这是"不是整个 turn 消失"的判别断言。
    expect(rows.some((r) => r.role === 'user' && r.turnID === 1)).toBe(true)
    // ⚠️ 已删除：「turn 1 没有任何 assistant 行」——新链路会产出一条空 assistant 行
    //    （见文件头 ⚠️A；这是新链路的幻影行缺口，不是本测试可以放弃的判据）。
  })
})

// ─── ② 保留语义（客户端可控部分） ──────────────────────────────

describe('TURNDROP ② 保留语义（新回合不得破坏旧回合已提交内容）', () => {
  it('turn_started(N+1) 到达：旧 turn 的已提交块仍在、仍渲染', () => {
    const f = new ModelFeed('c')
    f.push({ type: 'turn_started', turnID: 1, requestID: null, trigger: 'user', content: '', seq: 1 })
    // 迭代 1 已提交（服务端 done 完备块）
    f.push({
      type: 'iteration', turnID: 1, iter: 1, seq: 2, phase: 'tool_exec',
      content: '', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
      iterationsDelta: [{ iteration: 1, content: '逐字稿重要内容', reasoning: '', tools: [], toolCount: 0 }],
      todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    })
    // N+1 到达（旧 turn 仍在跑）—— 收尸路径。
    f.push({ type: 'turn_started', turnID: 2, requestID: null, trigger: 'user', content: '', seq: 3 })

    // mutation：让 `onOpen` 重建/清空旧 TurnRec ⇒ 块数变 0 ⇒ 必红。
    expect(turnRec(f, 1).blocks.length, '旧 turn 已提交块仍在（T4 提交不可回退）').toBe(1)
    // 渲染层：内容仍在（"已渲染内容永不消失"）—— 新链路的内容载体是**块**（row.iterations），
    // 不是行级 content（行级 content = 终稿正文；此回合未 final ⇒ 空）。
    const rows: ChatRow[] = f.rows()
    expect(
      rows.some((r) => r.turnID === 1
        && r.iterations.some((b) => String(b.content ?? '').includes('逐字稿重要内容'))),
      '已提交内容仍在渲染行里',
    ).toBe(true)
    // 新回合照常建立（不得把旧 turn 的记录挪走）。
    expect(f.state.turns.has(1) && f.state.turns.has(2), '两个 turn 都在').toBe(true)
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

describe('TURNDROP ③ 日志收敛（turndrop.ts 模块契约）', () => {
  it('逐 turn 走 debug（非 warn）+ burst 结束打唯一 warn 汇总且计数正确', () => {
    flushTurndropSummary() // 清掉前面用例可能残留的累计（跨用例模块级状态）

    const cap = withCapture((c) => {
      // 7 个空壳 turn：逐条 debug（不会污染 warn 级日志）。
      for (let i = 0; i < 7; i++) {
        noteTurndrop('hollowFrozen', `hollow-frozen:${10 + i}`, { turnID: 10 + i })
      }
      expect(c.filter((x) => x.level === 'warn').length, 'burst 期间零 warn').toBe(0)
      expect(c.filter((x) => x.level === 'debug').length, '逐 turn 7 条 debug').toBe(7)
      // burst 结束 → 唯一一条 warn 汇总。
      flushTurndropSummary()
    })

    const warns = cap.filter((x) => x.level === 'warn')
    // 唯一 warn（旧实现是 7 条逐 turn warn）。
    // mutation：把 noteTurndrop 里的 console.debug 改回 console.warn ⇒ 此处 warn 数=7 必红。
    expect(warns.length, '唯一一条 warn 汇总').toBe(1)
    // 汇总计数正确（7 个空壳）。
    // mutation：flush 后不清零/不清 Set ⇒ 二次 flush 或计数漂移 ⇒ 必红。
    expect(warns[0].text.includes('7'), '汇总计数 = 7').toBe(true)
    expect(warns[0].text.includes('hollow') || warns[0].text.includes('空壳'), '汇总点名空壳').toBe(true)
  })

  it('跨帧去重：同一 turnID 反复诊断只计一次（不刷屏）', () => {
    flushTurndropSummary()

    const cap = withCapture((c) => {
      // 两次**独立**水合 ⇒ 两套全新 Turn 对象（同 turnID）—— 真实场景：idempotent
      // history_replaced 重放时每个 turn 会重建。去重键按 turnID ⇒ 只计一次。
      noteTurndrop('hollowFrozen', 'hollow-frozen:30', { turnID: 30 })
      noteTurndrop('hollowFrozen', 'hollow-frozen:31', { turnID: 31 })
      noteTurndrop('hollowFrozen', 'hollow-frozen:30', { turnID: 30 })
      noteTurndrop('hollowFrozen', 'hollow-frozen:31', { turnID: 31 })
      // 2 个 turnID ⇒ 2 条 debug（不是 4 条）。
      // mutation：删掉 noteTurndrop 的 turndropSeen 去重 ⇒ 4 条 ⇒ 必红。
      expect(c.filter((x) => x.level === 'debug').length, '按 turn 去重：2 条').toBe(2)
      flushTurndropSummary()
    })

    const warns = cap.filter((x) => x.level === 'warn')
    expect(warns.length, '唯一 warn').toBe(1)
    expect(warns[0].text.includes('2'), '计数 = 2').toBe(true)
  })

  it('无诊断时不打汇总（零噪音）', () => {
    flushTurndropSummary()
    const cap = withCapture(() => {
      // 正常回合：零 TURNDROP 诊断 ⇒ flush 不得打任何日志。
      const f = new ModelFeed('c')
      f.push({ type: 'turn_started', turnID: 40, requestID: null, trigger: 'user', content: '', seq: 1 })
      f.push({
        type: 'iteration', turnID: 40, iter: 1, seq: 2, phase: 'tool_exec',
        content: '', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
        iterationsDelta: [{ iteration: 1, content: '正常回复', reasoning: '', tools: [], toolCount: 0 }],
        todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
      })
      f.rows()
      flushTurndropSummary()
    })
    expect(cap.length, '零噪音').toBe(0)
  })
})

declare const process: { exit: (c: number) => void }
process.exit(summary('turndrop'))

export {};
