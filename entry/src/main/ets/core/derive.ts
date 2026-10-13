// 逐字移植自 xbot web `web/src/chat/derive.ts`（逻辑一比一：同一份规则，不做重写）
/**
 * derive.ts — 渲染模型：deriveRows : ChatState → readonly Row[]（纯函数）。
 *
 * 定理（design doc §5.3）：
 *   T1 total       —— 穷尽 switch + I2/I6 类型保证 ⇒ 无 TypeError 可达 ⇒ DOM 永不消失
 *   T4 无 ghost 行 —— 每 turn 恰经一次 assistantRow（判别联合三选一）⇒ 至多一行
 *   T5 线性一致    —— legacy 前缀 ⊕ turnID 升序 ⊕ (user < assistant)，纯函数
 *
 * 渲染组件只做 Row → DOM 映射；isPartial 语义收窄至 live/frozen（kind 判别，
 * 不再有 find(isPartial) 启发式 —— Bug 7 根治点）。
 */

import type { TodoItem, WebCompaction, WebIteration, WebSubAgentProgress, WebToolProgress } from './chattypes'
import type { ChatState, LegacyRow, LiveSnapshot, Turn, TurnID } from './chat_types_full'

// ─── TURNDROP 诊断（降噪：逐 turn 走 debug + burst 结束打**一条** warn 汇总） ───
// 背景（perf-audit #5）：冷启动加载「cron/通知 turn」时，DB 快照里只有 user 行、
// 没有 assistant 产出（真实取证见 TURNDROP(2) 提交说明）⇒ `historyToReplaced`
// 造出 frozen 空壳，derive **正确**跳过它的 assistant 行（幽灵行消除：空壳无内容
// 可渲染，user 行照常渲染 ⇒ 不是内容丢失）。旧实现每 turnID 打一条 console.warn
// （一次冷启动可达 ~60 条），纯噪音且把 warn 级日志淹没。
//
// 现在：逐条走 `console.debug`（不污染 warn 级）；一轮诊断 burst 结束后由
// `flushTurndropSummary` 打**唯一**的 warn 级汇总（目标：冷启动 warn 级 TURNDROP < 5）。
// ⚠️ 语义零改动：这里只改**日志**，绝不改任何丢弃/保留判据。
export type TurndropKind = 'hollowFrozen' | 'foldedLive' | 'lateText' | 'idleFroze' | 'idleDelete'

// 去重键（turn 粒度 —— derive 每帧调用 + 状态机事件重放都靠它只计一次）。
const turndropSeen = new Set<string>()
const turndropCounts: Record<TurndropKind, number> = {
  hollowFrozen: 0,
  foldedLive: 0,
  lateText: 0,
  idleFroze: 0,
  idleDelete: 0,
}
let turndropTimer: ReturnType<typeof setTimeout> | null = null
/** burst 静默窗口：最后一条诊断后这么久没有新诊断就汇总（同一 burst 只汇总一次）。 */
const TURNDROP_QUIET_MS = 1200

/**
 * 记录一次 TURNDROP 诊断。同一 key（turn 粒度）只累计/打印一次；逐条 `console.debug`。
 * 唯一 warn 级输出由 burst 结束后的 `flushTurndropSummary` 打（或测试直接调用）。
 */
export function noteTurndrop(
  kind: TurndropKind,
  key: string,
  detail: Record<string, unknown>,
): void {
  if (!turndropSeen.has(key)) {
    turndropSeen.add(key)
    turndropCounts[kind] += 1
    console.debug(`[TURNDROP] ${kind}`, detail)
  }
  if (turndropTimer === null) {
    turndropTimer = setTimeout(flushTurndropSummary, TURNDROP_QUIET_MS)
  }
}

/**
 * 打**一条** warn 汇总并清零（burst 结束触发；测试可直接调用以获得确定性）。
 * 这是 TURNDROP 唯一的 warn 级输出 —— 逐 turn 明细已降级为 debug。
 */
export function flushTurndropSummary(): void {
  if (turndropTimer !== null) {
    clearTimeout(turndropTimer)
    turndropTimer = null
  }
  const c = turndropCounts
  const total = c.hollowFrozen + c.foldedLive + c.lateText + c.idleFroze + c.idleDelete
  if (total === 0) return
  console.warn(
    `[TURNDROP] 汇总：derive 跳过 ${c.hollowFrozen} 个空壳 frozen turn（无 assistant 产出，user 行保留）`
    + `；mid-turn 收尾 folded=${c.foldedLive} froze=${c.idleFroze} lateText=${c.lateText} delete=${c.idleDelete}`,
  )
  c.hollowFrozen = 0
  c.foldedLive = 0
  c.lateText = 0
  c.idleFroze = 0
  c.idleDelete = 0
  turndropSeen.clear()
}

// ─── Row 判别联合（渲染层唯一数据契约） ────────────────────────

export interface UserRowView {
  readonly kind: 'user'
  readonly id: string
  readonly content: string
  readonly timestamp: string
  readonly isNotification: boolean
  readonly queued: boolean
  readonly sending: boolean
  readonly dbID: number | undefined
  /** 排序键（turnID；pending 行 = Infinity 沉底）。 */
  readonly turnID: number
  /** 「无 turn」标记 —— 命令行（turn-less 命令输入行）设置；`bindTurnIDs` 据此跳过
   *  绑定（否则会被绑到最近的**后续** turn，跑到它的输出之后 / 下一个 turn 里）。 */
  readonly standalone?: boolean
  /** 命令行的时间锚点（见 `LegacyRow.anchorTurnID`）——仅 turn-less 命令输入行设置。 */
  readonly anchorTurnID?: number
}

/** live assistant 行 —— 唯一接收实时进度的行（kind 判别，无启发式）。 */
export interface LiveRowView {
  readonly kind: 'live'
  readonly id: string
  readonly turnID: number
  readonly isPartial: true
  readonly streaming: boolean
  readonly content: string
  readonly reasoning: string
  readonly iterations: readonly WebIteration[]
  readonly iterationsTruncated?: number
  readonly activeTools: readonly WebToolProgress[]
  readonly streamingTools: readonly WebToolProgress[]
  /** 当前迭代已完成工具（web `toolDeriv` 第三数组）—— 渲染在飞块时并入 live 工具列表。 */
  readonly completedTools: readonly WebToolProgress[]
  readonly genui: string
  readonly subAgents: readonly WebSubAgentProgress[]
  readonly todos: readonly TodoItem[]
  readonly lastIter: number
  /** busy 快照折叠视图的区域窗口声明（live 闭环）——与 committed 行同语义。 */
  readonly regionsBefore?: number
}

/** frozen assistant 行（cancel 定格 / idle 兜底）—— isPartial=true 保 activeTools 渲染。 */
export interface FrozenRowView {
  readonly kind: 'frozen'
  readonly id: string
  readonly turnID: number
  readonly isPartial: true
  readonly content: string
  readonly reasoning: string
  readonly iterations: readonly WebIteration[]
  readonly iterationsTruncated?: number
  readonly activeTools: readonly WebToolProgress[]
  readonly genui: string
  readonly lastIter: number
  /** busy 快照折叠视图的区域窗口声明（live 定格不丢）。 */
  readonly regionsBefore?: number
}

export interface CommittedRowView {
  readonly kind: 'committed'
  readonly id: string
  readonly turnID: number
  readonly isPartial: false
  readonly content: string
  readonly iterations: readonly WebIteration[]
  /** turn 内压缩点（迭代之间内联渲染，Cursor 式）—— 见 WebCompaction。 */
  readonly compactions?: readonly WebCompaction[]
  /** 命令回复（standalone 段）的「无 turn」标记 —— `bindTurnIDs` 据此跳过绑定。 */
  readonly standalone?: boolean
  /** 命令行的时间锚点（见 `LegacyRow.anchorTurnID`）——排序键用它插回原位。 */
  readonly anchorTurnID?: number
  readonly iterationsTruncated?: number
  /**
   * 该 turn **更早未下发的展示区域数**（后端 `regions_before`）—— D1 线的
   * `RegionsDivider` 从 Row 读此字段：>0 时 turn 顶部渲染「更早区域」分隔条
   * （+ IO 哨兵，`POST /api/regions` 整段取回）。缺省 = 该 turn 已完整下发。
   */
  readonly regionsBefore?: number
}

export type Row = UserRowView | LiveRowView | FrozenRowView | CommittedRowView

// ─── deriveRows：ρ（T5 顺序 = legacy ⊕ turnID 升序 ⊕ user<assistant） ──

/**
 * 派生对象的**对象恒等 memo**（长 turn 卡顿回归的根因修复）：
 * 源对象引用不变 ⇒ 派生 Row 引用必须不变。
 *
 * 每个流式帧 `state` 都是新引用（reduce 的 `withTurn` 只改 active turn），
 * deriveRows 每帧执行；若每帧为**所有** turn 重建 Row，则下游
 * rowsToChatMessages → MessageItem（memo）逐帧全部失效 —— 每个 assistant 行
 * 内部是该 turn 的整棵迭代树，代价 ∝ 会话内全部已渲染迭代。
 * WeakMap 以源对象为键：未变更的 turn 直接复用上一帧的 Row（零分配、零比较）。
 *
 * 纯函数证据：assistantRow 只读 `t.id` / `t.phase`（都封装在 Turn 内，不可变）；
 * userRowOf 只读 `t.user`；legacy/pending 只读各自的消息对象。
 */
const assistantRowByTurn = new WeakMap<Turn, Row | null>()
const userRowByMsg = new WeakMap<object, UserRowView>()
const legacyRowByMsg = new WeakMap<LegacyRow, Row>()

function cachedAssistantRow(t: Turn): Row | null {
  const cached = assistantRowByTurn.get(t)
  if (cached !== undefined) return cached
  const row = assistantRow(t)
  assistantRowByTurn.set(t, row)
  return row
}

function cachedUserRow(t: Turn): UserRowView {
  const u = t.user!
  const cached = userRowByMsg.get(u)
  if (cached !== undefined) return cached
  const row = userRowOf(t)
  userRowByMsg.set(u, row)
  return row
}

function cachedUserRowView(u: ChatState['pendingUsers'][number]): Row {
  const cached = userRowByMsg.get(u)
  if (cached !== undefined) return cached
  const row = userRowView(u)
  userRowByMsg.set(u, row)
  return row
}

function cachedLegacyRow(l: LegacyRow): Row {
  const cached = legacyRowByMsg.get(l)
  if (cached !== undefined) return cached
  const row: Row =
    l.role === 'user'
      ? {
          kind: 'user',
          id: l.id,
          content: l.content,
          timestamp: l.timestamp,
          isNotification: false,
          queued: false,
          sending: false,
          dbID: l.dbID,
          turnID: 0,
          standalone: l.standalone,
          anchorTurnID: l.anchorTurnID,
        }
      : {
          kind: 'committed',
          id: l.id,
          turnID: 0,
          // standalone 段（命令回复）显式透传「无 turn」标记 —— `bindTurnIDs` 见到该
          // 标记就跳过绑定（否则会绑到 live turn、与 live 行撞虚拟键：CI 实证尺寸缓存
          // 串味 → 总高翻倍 → 命令输出被推到可视区之上）。
          standalone: l.standalone,
          anchorTurnID: l.anchorTurnID,
          isPartial: false,
          content: l.content,
          iterations: l.iterations,
          // 更早未下发的展示区域数（standalone/legacy 段同样可能带 —— 与
          // turn 行的 committed payload 同一来源语义）。
          regionsBefore: l.regionsBefore,
        }
  legacyRowByMsg.set(l, row)
  return row
}

/** turn 顺序（deriveRows 的 T5 前提）：Map 插入序在真实事件流里已按 turnID 单调
 *  （withTurn 拷贝保持插入序、新 turn 追加），O(T) 检查通过即免去每帧 O(T log T) 排序。 */
function sortedTurns(turns: ReadonlyMap<TurnID, Turn>): Turn[] {
  const out: Turn[] = []
  let last = -1
  let ordered = true
  for (const t of turns.values()) {
    if (t.id < last) ordered = false
    last = t.id
    out.push(t)
  }
  return ordered ? out : out.sort((a, b) => a.id - b.id)
}

/** turn 的区域窗口声明（committed 从 payload、live/frozen 从 data 读 —— 语义同源）。 */
function turnRegionsBefore(t: Turn): number | undefined {
  if (t.phase.kind === 'committed') return t.phase.payload.regionsBefore
  return t.phase.data.regionsBefore
}

export function deriveRows(s: ChatState): readonly Row[] {
  const turnRows: Row[] = []
  for (const t of sortedTurns(s.turns)) {
    // 用户规则（2026-10-01 回归修复，用户原话：「如果用户看到了一个用户输入，那么
    // 这个用户输入之后的所有消息就必须是完整的，不能是接下来动态加载的。所以这种
    // 情况如果需要动态加载，你不能渲染那个用户的输入」）——
    // **任何 phase**（live/frozen/committed）的 regionsBefore > 0（更早区域待动态
    // 加载）时 user 行不渲染：否则「user 输入悬在折叠内容上方」破坏对话时间线的因果
    // 视觉（修改前全量视图从不存在此形态）。2026-10-02 生产截图第二次点名（live
    // turn 540 迭代、regionsBefore=166，user「继续」悬在「⌃ 更早的 166 个区域」上
    // 方）：「加载更多前面不能渲染任何东西，加载更多一定在顶部」—— 此前的 live
    // 豁免（「正在生成的对话不能藏用户刚发的消息」）不成立：折叠窗口只在长 turn
    // （≥100 区域）才激活，「刚发的消息」场景 regionsBefore 缺省、user 行照常渲染。
    // 过滤走 turn 的实时值（不走缓存 row）：段加载完成 regionsBefore 归零后
    // derive 重跑 ⇒ user 行自然出现，与内容一起构成完整时间线。
    const rb = turnRegionsBefore(t)
    // > 0 才隐藏：段加载完成后服务端显式下发 regions_before: 0（权威归零声明），
    // 此时 user 行必须立刻随完整内容一起出现（!== undefined 会把归零误判成未完成）。
    const userHiddenByFold = rb !== undefined && rb > 0
    if (t.user && !userHiddenByFold) turnRows.push(cachedUserRow(t))
    const ar = cachedAssistantRow(t)
    if (ar !== null) turnRows.push(ar)
  }

  // pendingUsers（未绑定的乐观行）：沉到底部（发送中/排队 —— 归属 turn 未知）。
  const pending: Row[] = s.pendingUsers.map(cachedUserRowView)

  // legacy 段保持 DB 顺序：user/assistant 交错（非 turn 模型 —— 直接按原序映射）。
  const legacySorted: Row[] = s.legacy.map(cachedLegacyRow)

  // standalone 段（无 turn 归属的**实时**回复：命令 `!cmd`/slash 的输出）——
  // 排在 turns 之后（用户视角的最新消息）。若与 legacy 混用，命令输出会跑到
  // 会话顶部（derive 的 legacy 前缀段），用户仍会觉得"没有输出"。
  const standaloneRows: Row[] = s.standalone.map(cachedLegacyRow)

  return [...legacySorted, ...turnRows, ...standaloneRows, ...pending]
}

// ─── assistantRow：穷尽 switch（T4：每 turn 至多一行） ─────────

function assistantRow(t: Turn): Row | null {
  switch (t.phase.kind) {
    case 'live': {
      const d = t.phase.data
      return {
        kind: 'live',
        id: `turn-${t.id}-live`,
        turnID: t.id,
        isPartial: true,
        streaming: d.streaming,
        content: d.content,
        reasoning: d.reasoning,
        iterations: d.iterations,
        activeTools: d.activeTools,
        streamingTools: d.streamingTools,
        completedTools: d.completedTools,
        genui: d.genui,
        subAgents: d.subAgents,
        todos: d.todos,
        lastIter: d.iter,
        regionsBefore: d.regionsBefore,
      }
    }
    case 'frozen': {
      // 空壳 frozen（完全无产出）不出行 —— Bug 6/8 的"幽灵行"根治点。
      // 这不是内容丢失：空壳的 payload 里**根本没有** assistant 产出（真实来源：
      // cron/通知 turn —— 后端只下发 user 行）。user 行由 deriveRows 照常渲染。
      if (!hasVisibleOutput(t.phase.data)) {
        // 逐 turn 走 debug（不污染 warn 级）；唯一 warn 级汇总见 flushTurndropSummary。
        noteTurndrop('hollowFrozen', `hollow-frozen:${t.id}`, { turnID: t.id })
        return null
      }
      const d = t.phase.data
      // cancel 时正在执行的工具折进最后迭代 —— rowsToChatMessages 不向渲染层
      // 传 activeTools（liveProgress 在 frozen 时为空），TurnBody 从 iterations 读
      // 工具。保证"已渲染内容永不消失"（cancel 后正在执行的 tool 保留在最新迭代
      // —— 用户/测试要求）。
      // F1（Loop2）：streamingTools（参数流式生成中，generating）与 activeTools
      // 同折 —— 只折 activeTools 会让 generating 工具在 cancel/text 丢失定格时
      // 从 frozen 行消失（text_final/reduce 的 foldInFlightToIterations 同原则：
      // activeTools + streamingTools 都是"从未完成、不在 iteration_history"的
      // in-flight 工具）。markError 对 done 工具恒等（既有语义：activeTools 里
      // 已完成的工具也保留折入 —— SSE 丢迭代 delta 时 frozen 渲染的最后防线）。
      const errTools = [...d.activeTools, ...d.streamingTools].map(markError)
      const iterations = foldToolsIntoIterations(d.iterations, errTools, d.iter)
      return {
        kind: 'frozen',
        id: `turn-${t.id}`,
        turnID: t.id,
        isPartial: true,
        content: d.content,
        reasoning: d.reasoning,
        iterations,
        activeTools: errTools,
        genui: d.genui,
        lastIter: d.iter,
        regionsBefore: d.regionsBefore,
      }
    }
    case 'committed': {
      // I2：payload 必可渲染（via text → content 非空；via fold → iterations 非空）。
      // via 仅区分构造路径的 I2 保证，消费侧无差异 —— content 两分支同源
      //（恒等三元已删，F#7）。
      return {
        kind: 'committed',
        id: `turn-${t.id}-c`,
        turnID: t.id,
        isPartial: false,
        content: t.phase.payload.content,
        iterations: t.phase.payload.iterations,
        iterationsTruncated: t.phase.payload.iterationsTruncated ?? 0,
        // turn 内压缩点：透传引用（payload 引用稳定 ⇒ memo 不失效）。
        // ⛔ 消息不连续零容忍（用户 2026-10-11，判据 A）：`afterIteration === 0`（压缩发生在该
        //    turn 第一条迭代**之前** ⇒ 紧随 user msg）的横线，只有窗口**覆盖到迭代 1**
        //    （`regionsBefore` 归零 ⇒ 上面已加载）时才允许渲染；否则它会浮在一个**尚未加载的
        //    缺口**正上方（缺口 `[1..a-1]` 就在横线下面）= 又一处不连续。与 `deriveRows` 里
        //    user 行的隐藏规则**同源同处**（都在 derive）⇒ 任何时刻「要么完整时间线，要么什么
        //    都不渲染」。web 同处：`src/chat/derive.ts:323 windowCompactions`。
        compactions: windowCompactions(t.phase.payload.compactions, t.phase.payload.regionsBefore),
        // 更早未下发的展示区域数（D1 线的 RegionsDivider 消费；>0 渲染分隔条）。
        regionsBefore: t.phase.payload.regionsBefore,
      }
    }
  }
}

/**
 * 压缩点的**窗口可见性**过滤（「消息不连续」零容忍的判据 A，用户 2026-10-11）：
 * `afterIteration=0` 的压缩点位于该 turn 第一条迭代**之前**（紧随 user msg）—— 它只有在
 * 窗口覆盖到迭代 1（`regionsBefore` 归零 ⇒ 上面已加载）时才允许渲染，否则它会浮在一个
 * **尚未加载的缺口**正上方（缺口 `[1..a-1]` 就在它下面）。`regionsBefore > 0` 时把这类
 * 压缩点滤掉；`afterIteration>0` 的锚定由 `MessageRow.compactionAnchors` 的「锚定迭代必须
 * 已渲染」规则兜住。逐字对齐 web `src/chat/derive.ts:336-346`。
 */
function windowCompactions(
  compactions: readonly WebCompaction[] | undefined,
  regionsBefore: number | undefined,
): readonly WebCompaction[] | undefined {
  if (!compactions || compactions.length === 0) return undefined
  if (regionsBefore === undefined || regionsBefore <= 0) return compactions
  const kept = compactions.filter((c) => c.afterIteration > 0)
  return kept.length > 0 ? kept : undefined
}

function userRowOf(t: Turn): UserRowView {
  const u = t.user!
  return {
    kind: 'user',
    id: u.id,
    content: u.content,
    timestamp: u.timestamp,
    isNotification: u.isNotification,
    queued: u.queued,
    sending: u.sending,
    dbID: u.dbID,
    turnID: t.id,
  }
}

function userRowView(u: ChatState['pendingUsers'][number]): UserRowView {
  return {
    kind: 'user',
    id: u.id,
    content: u.content,
    timestamp: u.timestamp,
    isNotification: u.isNotification,
    queued: u.queued,
    sending: u.sending,
    dbID: u.dbID,
    turnID: Number.MAX_SAFE_INTEGER,
  }
}

function hasVisibleOutput(d: LiveSnapshot): boolean {
  return (
    d.content !== '' ||
    d.reasoning !== '' ||
    d.iterations.length > 0 ||
    d.genui !== '' ||
    d.activeTools.length > 0 ||
    d.streamingTools.length > 0
  )
}

/** frozen 的进行中工具标 error（cancel 语义 —— "已渲染内容永不误导"）。 */
function markError(t: WebToolProgress): WebToolProgress {
  return t.status === 'running' || t.status === 'generating' || t.status === 'pending'
    ? { ...t, status: 'error' }
    : t
}

/** cancel 时正在执行的工具折进最后迭代（渲染层从 iterations 读工具）。
 *  最后迭代已存在 → 合并 tools；不存在（iterations 空）→ 追加含工具的迭代。 */
function foldToolsIntoIterations(
  its: readonly WebIteration[],
  tools: readonly WebToolProgress[],
  lastIter: number,
): readonly WebIteration[] {
  if (tools.length === 0) return its
  const arr = [...its]
  const idx = arr.findIndex((it) => it.iteration === lastIter)
  if (idx >= 0) {
    arr[idx] = {
      ...arr[idx],
      tools: [...arr[idx].tools, ...tools],
      toolCount: (arr[idx].toolCount ?? 0) + tools.length,
    }
  } else {
    arr.push({ iteration: lastIter, content: '', reasoning: '', tools: [...tools], toolCount: tools.length })
  }
  return arr
}
