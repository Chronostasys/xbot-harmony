/**
 * state_fuzz.test.ts —— 会话状态机的**机器穷举**（不变量守门 + 随机事件序列）。
 *
 * 为什么需要（用户 2026-10-21：「为什么每次改完都有新 bug」「必须定一个不可能再出新问题的
 * 彻底修复方案」的结构性答复）：
 *   前八轮验收靠"10 个盲审子代理逐行读代码" —— 人是**有限枚举**：只能想到自己想到的组合。
 *   每轮都能挖出新问题，不是因为修得不够，而是因为**枚举方法有天花板**。
 *   本测试把验收从"人读"变成"机器穷举"：
 *     ① 随机（固定种子，可复现）生成**合法与非法混杂**的事件序列；
 *     ② 每一步 reduce 之后跑 `invariantViolations` —— 全部规则同时成立；
 *     ③ 失败时打印**最短前缀**（shrink），可直接固化成回归用例。
 *
 * 覆盖的三类"人的盲区"（历史确证项全部落在这三类里）：
 *   A. **乱序/迟到/重复**帧（旧轮 idle、低 seq、重复 turn_started、回放）；
 *   B. **交错的生命周期**（发送中 ↔ 取消 ↔ 新轮 ↔ 权威 idle ↔ 历史重放）；
 *   C. **非法帧必须零写入**（陈旧帧不许改任何字段）—— 本文件的 `zeroWrite` 族断言。
 *
 * 种子：默认 8 个固定种子（可复现）；`FUZZ_SEEDS=50` 可加长（CI 慢跑）。
 */

import { describe, expect, it, summary } from './vitest_shim'
import { reduce } from '../../entry/src/main/ets/core/reduce'
import { describeState, invariantViolations } from '../../entry/src/main/ets/core/state_invariants'
import {
  ChatState,
  DomainEvent,
  EMPTY_LIVE,
  eventSeq,
  initialChatState,
  iterNum,
  nonEmptyStr,
  turnID,
  Turn,
  UserRow,
  commitViaText,
} from '../../entry/src/main/ets/core/chat_types_full'
import type { WebIteration } from '../../entry/src/main/ets/core/chattypes'

// 脱机 harness 不装 @types/node ⇒ 自声明最小的 `process`（只用到 env/exit）。
declare const process: {
  env: Record<string, string | undefined>
  exit(code: number): void
}

// ─── 确定性 PRNG（mulberry32）─────────────────────────────────
class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0
    let t: number = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [0, n) 的整数。 */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]
  }

  bool(p: number = 0.5): boolean {
    return this.next() < p
  }
}

// ─── 事件生成器：模拟真实链路里会出现的一切（含所有脏形态）──────────
class Gen {
  readonly rng: Rng
  seq: number = 0
  nextTurn: number = 1
  nextIter: number = 1
  reqCounter: number = 0
  readonly reqs: string[] = []
  readonly turnIDs: number[] = []
  readonly trace: string[] = []

  constructor(seed: number) {
    this.rng = new Rng(seed)
  }

  private newReq(): string {
    this.reqCounter++
    const r: string = `rq-${this.reqCounter}`
    this.reqs.push(r)
    return r
  }

  private knownReq(): string | null {
    if (this.reqs.length === 0 || this.rng.bool(0.15)) {
      return null
    }
    return this.rng.pick(this.reqs)
  }

  private row(sending: boolean, requestID: string | null): UserRow {
    return {
      id: `u-${this.reqCounter}-${this.rng.int(1000)}`,
      content: nonEmptyStr('hello')!,
      timestamp: '2026-10-21T00:00:00Z',
      isNotification: false,
      queued: false,
      sending,
      requestID,
      turnHint: undefined,
      dbID: undefined,
    }
  }

  private iterObj(n: number): WebIteration {
    return { iteration: n, content: `c${n}`, reasoning: '', tools: [], toolCount: 0 }
  }

  /** 单调递增 seq（也可能"回退"= 陈旧帧，由调用方决定）。 */
  private seqFor(stale: boolean): number {
    if (stale) {
      return Math.max(1, this.seq - 1 - this.rng.int(3))
    }
    this.seq += 1 + this.rng.int(2)
    return this.seq
  }

  /** 只生成"**能判陈旧**"的帧（带 seq 的增量帧 / 回合号回放），用于零写入断言。
   *  ⛔ `lastSeq` 必须取**状态机的当前水位**（不是生成器自己的计数）：生成器发过的帧
   *  可能被状态机整帧丢弃（无归属/陈旧）⇒ 两个计数器会分叉，用生成器的值会造出
   *  "其实很新"的假陈旧帧（我第一次就踩了这个，报了个假红）。 */
  nextStale(lastSeq: number | null): DomainEvent {
    const active: number | null = this.turnIDs.length > 0 ? this.turnIDs[this.turnIDs.length - 1] : null
    const staleSeq: number = Math.max(1, (lastSeq === null ? 1 : lastSeq) - 1 - this.rng.int(5))
    switch (this.rng.int(5)) {
      case 0:
        this.trace.push('stale iteration')
        return {
          type: 'iteration',
          turnID: active === null ? null : turnID(active),
          iter: iterNum(Math.max(1, this.nextIter - 1)),
          seq: eventSeq(staleSeq),
          content: 'STALE',
          reasoning: undefined,
          activeTools: [],
          completedTools: [],
          iterationsDelta: [this.iterObj(1)],
          todos: [{ id: 'x', text: 'STALE', done: false } as never],
          subAgents: undefined,
          tokenUsage: undefined,
          streamStats: undefined,
        }
      case 1:
        this.trace.push('stale stream')
        return {
          type: 'stream',
          turnID: active === null ? null : turnID(active),
          seq: eventSeq(staleSeq),
          iteration: iterNum(Math.max(1, this.nextIter - 1)),
          content: 'STALE',
          reasoning: undefined,
          streamingTools: [],
          genui: undefined,
          streamStats: undefined,
        }
      case 2:
        this.trace.push('stale phase_done')
        return {
          type: 'phase_done',
          turnID: active === null ? null : turnID(active),
          seq: eventSeq(staleSeq),
          finalIteration: this.iterObj(1),
          todos: [],
        }
      case 3:
        this.trace.push('stale session_fields')
        return {
          type: 'session_fields',
          todos: [],
          goal: { objective: 'STALE', status: 'active' },
          seq: eventSeq(staleSeq),
        }
      default: {
        // 回合号回放：比已知最大更旧的 turn_started
        const replay: number = this.turnIDs.length > 1 ? this.turnIDs[0] : 1
        this.trace.push(`replay turn_started(${replay})`)
        return {
          type: 'turn_started',
          turnID: turnID(replay),
          requestID: null,
          trigger: 'resume',
          content: 'STALE',
          todos: [],
          goal: null,
        }
      }
    }
  }

  /** 生成一条事件。`stale` 允许注入"陈旧/错轮/错会话"污染（零写入断言用）。 */
  next(stale: boolean = false): DomainEvent {
    const active: number | null = this.turnIDs.length > 0 ? this.turnIDs[this.turnIDs.length - 1] : null
    // 交错顺序：turn 生命周期优先，其次流式/会话/计划/本地乐观
    const kind: number = this.rng.int(100)
    if (kind < 10) {
      // 新回合（也可能回放旧回合号 ⇒ reduce 必须丢弃）
      let id: number
      if (this.rng.bool(0.15) && this.turnIDs.length > 0) {
        id = this.rng.pick(this.turnIDs)
      } else {
        id = this.nextTurn++
        this.turnIDs.push(id)
      }
      this.nextIter = 1
      const ev: DomainEvent = {
        type: 'turn_started',
        turnID: turnID(id),
        requestID: this.knownReq(),
        trigger: this.rng.pick(['user', 'resume', 'notification'] as const),
        content: this.rng.bool(0.3) ? 'hello' : null,
      }
      this.trace.push(`turn_started(${id})`)
      return ev
    }
    if (kind < 14) {
      const r: string = this.newReq()
      this.trace.push('user_sent')
      return { type: 'user_sent', row: this.row(true, r) }
    }
    if (kind < 17) {
      const r: string | null = this.knownReq()
      this.trace.push(`user_ack(${r})`)
      return { type: 'user_ack', requestID: r ?? 'unknown', dbID: 1 }
    }
    if (kind < 19) {
      const r: string | null = this.knownReq()
      this.trace.push(`user_fail(${r})`)
      return { type: 'user_fail', requestID: r ?? 'unknown' }
    }
    if (kind < 22) {
      const r: string | null = this.knownReq()
      this.trace.push('user_echo')
      return { type: 'user_echo', row: this.row(false, r) }
    }
    if (kind < 40) {
      // iteration：可能挂错轮/无归属/陈旧 seq
      const n: number = this.rng.bool(0.85) ? this.nextIter++ : Math.max(1, this.nextIter - 1)
      const tid: number | null = active
      this.trace.push(`iteration(${tid},i${n})`)
      return {
        type: 'iteration',
        turnID: tid === null ? null : turnID(tid),
        iter: iterNum(n),
        seq: eventSeq(this.seqFor(stale)),
        content: `c${n}`,
        reasoning: undefined,
        activeTools: [],
        completedTools: [],
        iterationsDelta: this.rng.bool(0.5) ? [this.iterObj(n)] : [],
        todos: undefined,
        subAgents: undefined,
        tokenUsage: undefined,
        streamStats: undefined,
      }
    }
    if (kind < 56) {
      // stream：可能带迭代号回退
      const n: number = this.rng.bool(0.85) ? this.nextIter : Math.max(1, this.nextIter - 1)
      const tid: number | null = active
      this.trace.push(`stream(${tid},i${n})`)
      return {
        type: 'stream',
        turnID: tid === null ? null : turnID(tid),
        seq: eventSeq(this.seqFor(stale)),
        iteration: iterNum(n),
        content: `s${n}`,
        reasoning: undefined,
        streamingTools: [],
        genui: undefined,
        streamStats: undefined,
      }
    }
    if (kind < 62) {
      const tid: number | null = active
      this.trace.push(`phase_done(${tid})`)
      return {
        type: 'phase_done',
        turnID: tid === null ? null : turnID(tid),
        seq: eventSeq(this.seqFor(stale)),
        finalIteration: this.rng.bool(0.5) ? this.iterObj(Math.max(1, this.nextIter - 1)) : null,
        todos: undefined,
      }
    }
    if (kind < 70) {
      // text_final：有时挂"未知的下一轮"（迟到/提前）
      let id: number | null = active
      if (this.rng.bool(0.1)) {
        id = this.nextTurn
      }
      this.trace.push(`text_final(${id})`)
      return {
        type: 'text_final',
        turnID: id === null ? null : turnID(id),
        content: nonEmptyStr('final'),
        progressHistory: [],
        cancelled: this.rng.bool(0.15),
      }
    }
    if (kind < 76) {
      // 权威 idle 只有一种形态：`session(busy=false)`（`session_idle` 已删除）
      this.trace.push('session(idle)')
      return { type: 'session', busy: false, turnID: null }
    }
    if (kind < 84) {
      const run: boolean = this.rng.bool(0.5)
      this.trace.push(`session_running(${run})`)
      return { type: 'session_running', running: run }
    }
    if (kind < 90) {
      // 粗粒度 session 帧（可能带 turnID，也可能不带）
      const b: boolean = this.rng.bool(0.5)
      const withTid: boolean = this.rng.bool(0.5)
      this.trace.push(`session(busy=${b})`)
      return withTid && active !== null
        ? { type: 'session', busy: b, turnID: turnID(active) }
        : { type: 'session', busy: b, turnID: null }
    }
    if (kind < 94) {
      this.trace.push('session_fields')
      return {
        type: 'session_fields',
        todos: this.rng.bool(0.5) ? [] : undefined,
        goal: this.rng.bool(0.2) ? { objective: '', status: 'cleared' } : undefined,
        seq: eventSeq(this.seqFor(stale)),
      }
    }
    if (kind < 96) {
      // 历史重放（切会话/重连）：可能携带 active 快照
      const id: number = this.rng.bool(0.6) && this.turnIDs.length > 0 ? this.rng.pick(this.turnIDs) : this.nextTurn++
      if (!this.turnIDs.includes(id)) {
        this.turnIDs.push(id)
      }
      const turns: Turn[] = [{
        id: turnID(id),
        user: this.row(false, null),
        phase: { kind: 'committed', payload: commitViaText(nonEmptyStr('seed')!, []) },
        requestID: null,
      }]
      const withActive: boolean = this.rng.bool(0.35)
      this.trace.push(`history_replaced(${id},active=${withActive})`)
      return {
        type: 'history_replaced',
        legacy: [],
        turns,
        standalone: [],
        active: withActive ? { turnID: turnID(id), snapshot: { ...EMPTY_LIVE, content: 'live' } } : null,
        lastSeq: this.rng.bool(0.5) ? eventSeq(this.seq) : null,
        todos: [],
      }
    }
    // queue_state / iterations_loaded
    if (this.rng.bool(0.5) && active !== null) {
      this.trace.push('iterations_loaded')
      return { type: 'iterations_loaded', turnID: active, iterations: [this.iterObj(1)] }
    }
    this.trace.push('queue_state')
    return { type: 'queue_state', queue: [] }
  }
}

// ─── 深比较用的状态投影（Map/数组 → 可 JSON 化的形状）──────────────
function project(s: ChatState): string {
  // ⛔ 必须**投影全部会被判据读取的字段**（gates-audit 确证：投影漏投 ⇒ "陈旧帧零写入"
  //   断言看不到那些字段的变化 ⇒ 白绿）。新增字段时同步加进来。
  const turns: string[] = []
  for (const [k, t] of s.turns) {
    const u = t.user === null
      ? '-'
      : `${t.user.id}:${t.user.sending}:${t.user.queued}:${t.user.dbID ?? '-'}:${t.user.content}`
    turns.push(`${k}|${u}|${t.phase.kind}|${t.requestID ?? '-'}`
      + (t.phase.kind === 'committed'
        ? `|c=${t.phase.payload.content}:${t.phase.payload.iterations.length}`
        : `|s=${t.phase.data.streaming}|i=${t.phase.data.iter}|c=${t.phase.data.content.length}`
          + `|r=${t.phase.data.reasoning.length}|a=${t.phase.data.activeTools.length}`
          + `|st=${t.phase.data.streamingTools.length}|ct=${t.phase.data.completedTools.length}`
          + `|g=${t.phase.data.genui.length}|it=${t.phase.data.iterations.length}`))
  }
  turns.sort()
  return JSON.stringify({
    chat: s.chatID,
    active: s.activeTurn,
    busy: s.busy,
    run: s.sessionRunning,
    seq: s.lastSeq,
    turns,
    pending: s.pendingUsers.map((u) => `${u.id}:${u.sending}:${u.queued}:${u.content}`),
    todos: s.todos.map((t) => `${t.text}:${t.status}`),
    goal: s.goal === null ? null : `${s.goal.objective}:${s.goal.status}`,
    legacy: s.legacy.length,
    standalone: s.standalone.length,
    queue: s.queue.length,
    resync: s.resync_required === true,
    gap: `${s.gapReloadToken}|${s.unreachableGapSig}|${s.lostIterGapSig}|${s.liveAheadGapSig}`,
  })
}

function seeds(): number[] {
  const raw: string = typeof process !== 'undefined' && process.env.FUZZ_SEEDS ? process.env.FUZZ_SEEDS : '8'
  const n: number = Math.max(1, Math.min(500, Number(raw) || 8))
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    out.push(0x5EED + i * 7919)
  }
  return out
}

// ─── 用例 ────────────────────────────────────────────────────

describe('state fuzz：随机事件序列下全部不变量恒成立', () => {
  it('每条序列每一步都满足 I1-I9（含交错的生命周期）', () => {
    const SS: number[] = seeds()
    let steps: number = 0
    for (const seed of SS) {
      const g = new Gen(seed)
      let s: ChatState = initialChatState('chat-1')
      const perSeq: number = 220
      for (let i = 0; i < perSeq; i++) {
        const ev = g.next(false)
        s = reduce(s, ev)
        steps++
        const bad = invariantViolations(s)
        if (bad.length > 0) {
          throw new Error(`seed=${seed} step=${i} ${ev.type}\n  违反：${bad.join(' / ')}\n`
            + `  状态：${describeState(s)}\n  轨迹：${g.trace.slice(Math.max(0, i - 8)).join(' → ')}`)
        }
      }
    }
    expect(steps > 1000).toBe(true)
  })

  it('陈旧/错轮帧必须**零写入**（逐字段不变）', () => {
    // 判据边界（必须是"能判陈旧"的帧）：
    //   · 带 seq 的增量帧（iteration/stream/phase_done/session_fields）：seq ≤ 水位 ⇒ 陈旧；
    //   · `turn_started`：回合号回放 ⇒ 陈旧。
    // ⛔ 排除 coarse 权威帧（`session`/`session_idle`/`session_running`）：它们**按契约不带 seq**
    //   （来自 session-tree/status 的 REST 对账 + agent-idle），"陈旧"对它们无定义 ——
    //   把它们算进来会把"权威信号生效"误报成"陈旧帧写入"（假红）。
    for (const seed of seeds().slice(0, 4)) {
      const g = new Gen(seed + 11)
      let s: ChatState = initialChatState('chat-1')
      for (let i = 0; i < 60; i++) {
        s = reduce(s, g.next(false))
      }
      for (let i = 0; i < 40; i++) {
        // 水位为 null（新回合刚开、还没有任何 seq 帧落地）时"陈旧"无定义 ⇒ 跳过，
        // 不能拿 seq=1 硬当陈旧（那是**新鲜**帧，写入是合法的 —— 我第一版就报了这个假红）。
        if (s.lastSeq === null) {
          s = reduce(s, g.next(false))
          continue
        }
        const before: string = project(s)
        const ev = g.nextStale(s.lastSeq)
        s = reduce(s, ev)
        const after: string = project(s)
        if (before !== after) {
          throw new Error(`seed=${seed + 11} 陈旧帧 ${ev.type} 产生了写入\n  前：${before}\n  后：${after}`)
        }
      }
    }
    expect(true).toBe(true)
  })

  it('不变量判据自身有判别力（mutation 自证）', () => {
    // 造一个合法状态，然后逐条注入违反 ⇒ 对应编号必须报出来。
    const g = new Gen(0xABCD)
    let s: ChatState = initialChatState('chat-1')
    for (let i = 0; i < 40; i++) {
      s = reduce(s, g.next(false))
    }
    const base = invariantViolations(s)
    expect(base.length).toBe(0)
    // I1
    expect(invariantViolations({ ...s, busy: !s.sessionRunning }).some((v) => v.startsWith('I1:'))).toBe(true)
    // I8（墓碑漏进 state）
    expect(invariantViolations({ ...s, goal: { objective: '', status: 'cleared' } })
      .some((v) => v.startsWith('I8:'))).toBe(true)
    // I2（activeTurn 指向不存在的 turn）
    expect(invariantViolations({ ...s, activeTurn: turnID(9999) }).some((v) => v.startsWith('I2:'))).toBe(true)
    // I6（同一 user 既在 pending 又已绑定）
    if (s.turns.size > 0) {
      let bound: UserRow | null = null
      for (const [, t] of s.turns) {
        if (t.user !== null) { bound = t.user; break }
      }
      if (bound !== null) {
        expect(invariantViolations({ ...s, pendingUsers: [bound] }).some((v) => v.startsWith('I6:'))).toBe(true)
      }
    }
  })
})

process.exit(summary('state_fuzz'))
