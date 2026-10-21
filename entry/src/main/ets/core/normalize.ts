import { asRecord } from './guards';

// 逐字移植自 xbot web `web/src/chat/normalize.ts`（逻辑一比一：同一份规则，不做重写）
/**
 * ⛔ 迭代历史**不许在客户端截断**（用户 2026-09-21 定稿：「不能有任何 gap，任何 gap 都是
 * 破坏线性一致性」/「为什么我的 iter 还是缺」）。
 *
 * 服务端已不再按 turn 截断（BoundHistoryIterations / maxActiveSnapshotIterations 已删除）；
 * 客户端**也不许**再截一次 —— 两侧各截一次会让"本地窗口"与"权威窗口"不相邻 ⇒ 拼接出 gap ⇒
 * 渲染层只能在 gap 处截断（用户看到的历史停在旧位置 / 中间迭代不见），而且取不回来。
 *
 * 体积与渲染性能由**渲染层**解决（`TurnBody` 迭代级窗口化：只挂载视口附近的块 + contain，
 * 代价与迭代数解耦），不得丢数据。
 */

/**
 * normalize.ts — raw SSE/WS JSON → DomainEvent 的唯一入口（I6 保证点）。
 *
 * 职责（全项目唯一的 null/格式处理点）：
 *   - Go nil slice 序列化的 JSON null → []（Bug 4 根治：null.tools 进渲染层）
 *   - snake_case → 判别联合字段
 *   - 数值校验（turn_id/iteration/seq）
 *   - 非法事件 → null（调用方丢弃，状态机零污染）
 *
 * normalize 之后的世界里不存在 null 数组字段 —— 类型未声明 null 即不存在。
 * 渲染层与 reducer 永远不再做格式防御（也禁止 `as`，ESLint no-as）。
 */

import {
  normalizeWebIteration,
  parseWebIterations,
} from './agent_normalize'
import {
  normalizeWebSubAgents,
  normalizeWebTools,
} from './progress_types'
import type { GoalInfo, QueueItemPayload, TodoItem, WebIteration } from './chattypes'
import {
  eventSeq,
  iterNum,
  nonEmptyStr,
  turnID,
  type DomainEvent,
  type LiveSnapshot,
} from './chat_types_full'

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function optTurnID(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

function optTodos(v: unknown): TodoItem[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((t) => {
    const r = asRecord(t)
    return {
      id: typeof r?.id === 'number' ? r.id : 0,
      text: typeof r?.text === 'string' ? r.text : '',
      // 新格式 status 必填；老数据兼容 done: true → "done"
      status: typeof r?.status === 'string' && r.status
        ? r.status
        : r?.done === true ? 'done' : 'pending',
    }
  })
}

/**
 * optGoal — progress 载荷的 goal 字段（protocol.ProgressEvent.Goal，engine 的
 * refreshStructuredTodos 每个 iteration 刷新 + set_goal_complete 工具完成后
 * emitGoalProgress 直发）。三态语义（xbotgh CR 🔴 goal 清除链路）：
 *  - undefined = "事件未携带 goal"（ProgressEvent.Goal 带 omitempty，字段整体消失）→ 保持状态不覆盖
 *  - null      = "显式清除标记"（后端 ClearGoal 推 {objective:"", status:"cleared"}——
 *               nil Goal 经 omitempty 序列化后字段消失，前端无法与"未携带"区分，因此用
 *               空 objective 的 cleared 标记表达"目标已删除"）→ 写入 s.goal = null
 *  - GoalInfo  = 目标状态（active/completed）→ 写入 s.goal
 * 目标是会话级状态，banner 靠它实时更新。
 */
function optGoal(v: unknown): GoalInfo | null | undefined {
  const r = asRecord(v)
  // ⛔ 字段**缺失**（`goal` 键不存在）⇒ undefined = "不动"，绝不当成"清空"。
  if (!r) return undefined
  // ⛔ 用户 2026-10-21 P0（goal 横幅来回抽搐）：**只有 `status === 'cleared'` 才是显式清除**。
  //   旧实现把 `objective === ''` 也当清除 —— 而很多帧会带一个**零值/占位**的 goal 对象
  //   （`objective: ''`、status 缺省），于是每来一帧就把目标清空、下一帧又恢复 ⇒ 抽搐。
  //   语义收紧：空 objective **且**没有 cleared 标记 ⇒ 视为"本帧不携带有效目标" ⇒ 不动状态。
  // `cleared` = **用户显式删除**（`ClearGoal` RPC / 另一客户端删除）⇒ 必须清除。
  // ⛔ 与「不能消失」区分：后者指**不能被轮询/重载/回合切换清掉**，不是忽略显式删除。
  //   清零的唯一两个来源：本帧 cleared 标记 + 本地手点 ✕（`clearGoalLocal`）。
  if (r.status === 'cleared') return null
  if (typeof r.objective !== 'string' || r.objective === '') return undefined
  return {
    objective: r.objective,
    status: typeof r.status === 'string' && r.status ? r.status : 'active',
    summary: typeof r.summary === 'string' && r.summary ? r.summary : undefined,
  }
}

/**
 * extractEventChatID — 从一条 raw WS/SSE 消息提取其归属的 chat_id（单一来源）。
 *
 * chat_id 的位置因事件类型而异：
 *   - 顶层 `chat_id`（progress/stream/text/user_echo —— 后端构造 WSMessage 时
 *     设置顶层 ChatID）
 *   - 嵌套 `session.chat_id`（session 事件 —— 历史上 SendSessionState 只填
 *     Session 字段，顶层留空）
 *   - 嵌套 `progress.chat_id`（部分 progress 事件）
 *   - 全部缺省（queue_state 等控制消息）→ 返回 undefined（调用方按"无归属"
 *     处理 —— legacy 行为：不过滤，依赖路由层保证）
 *
 * ⚠️ 必须与 useProgressStream 的 matchesChatID 保持同一提取视图：同一 SSE
 * 连接上有两个 chat 过滤器（matchesChatID 守 useProgressStream/
 * useChatMessages；normalizeEvent 守 ChatStore）。历史 bug（2026-09 "cancel
 * 右边，左边立刻变 idle view"）：normalizeEvent 只查顶层，session 事件的
 * 嵌套 chat_id 被漏掉 —— user 级 fan-out（broadcastSessionStateToWebClients）
 * 把 session B 的 idle（seq=0）送达 session A 的连接 → A 的 ChatStore
 * reduce session case 冻结/删除 A 自己的 live turn。修复后两层都做三层提取。
 */
export function extractEventChatID(env: Record<string, unknown>): string | undefined {
  return (
    optStr(env.chat_id) ??
    optStr(asRecord(env.session)?.chat_id) ??
    optStr(asRecord(env.progress)?.chat_id)
  )
}

/**
 * normalizeEvent — 把一条 raw WS/SSE 消息规范化为 DomainEvent。
 * 返回 null 表示事件非法或不属于本 chat（调用方直接丢弃）。
 *
 * 支持的 raw type：
 *   progress_structured → turn_started / iteration / phase_done / stream（按 phase + 载荷分流）
 *   stream_content      → stream
 *   text                → text_final
 *   session             → session
 *   user_echo/inject_user → user_echo
 *
 * 返回【事件数组】：一条 progress_structured 可能同时携带结构化载荷与流式
 * 载荷（旧前端在同一 handler 里两者都处理 —— get_active_progress 合并
 * streamState 的快照就是 stream_content/genui_content 与 active_tools 并存）。
 * 此时产出 [stream, structured] 两个事件（stream 先应用）。null/空数组 = 丢弃。
 */
export function normalizeEvent(raw: unknown, chatID: string): readonly DomainEvent[] | null {
  const env = asRecord(raw)
  if (!env) return null

  // chat 过滤（ChatStore 的唯一会话边界）：消息归属的 chat_id 与本面板不符 →
  // 丢弃。user 级 fan-out 会把其他 session 的 session 事件送达本连接（侧边栏
  // 需要它们，ChatStore 不需要）。双剥 channel 前缀（本地可能带 "web:" 前缀
  // 而远端 bare，或反之 —— 两个方向都兼容）。无归属标识（undefined）→ 通过
  //（legacy 控制消息，路由层已保证送达目标）。
  const msgChat = extractEventChatID(env)
  if (msgChat && stripChannel(msgChat) !== stripChannel(chatID)) return null

  switch (typeof env.type === 'string' ? env.type : '') {
    case 'progress_structured':
      return normalizeProgress(env)
    case 'stream_content':
      return normalizeStream(env)
    case 'text':
      return normalizeText(env)
    case 'session':
      return normalizeSession(env)
    case 'user_echo':
    case 'inject_user':
      return normalizeUserEcho(env)
    case 'queue_state': {
      const qs = asRecord(env.queue_state)
      const items = qs && Array.isArray(qs.items) ? qs.items as QueueItemPayload[] : []
      return [{ type: 'queue_state', queue: items }]
    }
    default:
      return null
  }
}

/** channel 前缀剥离（"web:chat-1" vs "chat-1" 兼容）。 */
function stripChannel(chatID: string): string {
  const i = chatID.indexOf(':')
  return i >= 0 ? chatID.slice(i + 1) : chatID
}

// ─── progress_structured → turn_started / iteration / phase_done / stream ──

/** progress 载荷是否携带流式字段（stream/genui/streamingTools）。 */
function hasStreamPayload(p: Record<string, unknown>): boolean {
  return (
    p.stream_content !== undefined ||
    p.reasoning_stream_content !== undefined ||
    p.genui_content !== undefined ||
    p.streaming_tools !== undefined
  )
}

/** 从 progress 载荷构造 stream 事件。 */
function streamEventFrom(
  p: Record<string, unknown>,
  turn: number | null,
  seq: ReturnType<typeof eventSeq> | null,
): DomainEvent {
  return {
    type: 'stream',
    turnID: turn !== null ? turnID(turn) : null,
    seq,
    iteration: typeof p.iteration === 'number' && p.iteration >= 1 ? iterNum(p.iteration) : null,
    content: optStr(p.stream_content),
    reasoning: optStr(p.reasoning_stream_content),
    streamingTools: Array.isArray(p.streaming_tools)
      ? normalizeWebTools(p.streaming_tools)
      : undefined,
    genui: optStr(p.genui_content),
    streamStats: parseStreamStats(p),
    // ⛔ 用户 2026-10-21 P0（「todo_write 之后 todo 不立刻更新，turn end 才更新」）：
    //   会话级字段（todos/goal）**与"这一帧带不带流式载荷"无关** —— 而 turn 进行中几乎
    //   每帧都带 `stream_content` ⇒ 全走本分支；本分支此前**不带** todos/goal ⇒ 只有
    //   回合末尾的 `phase_done`（无流式载荷）才把 todos 带进状态机 ⇒ 面板要等 turn end。
    //   ⇒ 流式帧同样携带（缺字段仍是 undefined = 不动）。
    todos: optTodos(p.todos),
    goal: optGoal(p.goal),
  }
}

/** 从 progress 载荷解析 stream_stats（tokens/sec / TTFT）。 */
function parseStreamStats(
  p: Record<string, unknown>,
): NonNullable<LiveSnapshot['streamStats']> | undefined {
  const rawSS = asRecord(p.stream_stats)
  if (!rawSS) return undefined
  const tokensPerSec = typeof rawSS.tokens_per_sec === 'number' ? rawSS.tokens_per_sec : 0
  const ttftMs = typeof rawSS.ttft_ms === 'number' ? rawSS.ttft_ms : 0
  // 完全无数据（后端未带 stream_stats 或全零）→ undefined，不覆盖 live。
  if (tokensPerSec <= 0 && ttftMs <= 0) return undefined
  return {
    ttftMs,
    tpotMs: typeof rawSS.tpot_ms === 'number' ? rawSS.tpot_ms : 0,
    tokensPerSec,
    totalMs: typeof rawSS.total_ms === 'number' ? rawSS.total_ms : 0,
    chunks: typeof rawSS.chunks === 'number' ? rawSS.chunks : 0,
  }
}

function normalizeProgress(env: Record<string, unknown>): readonly DomainEvent[] | null {
  const p = asRecord(env.progress)
  if (!p) return null

  const turn = optTurnID(p.turn_id)
  const phase = typeof p.phase === 'string' ? p.phase : ''
  const seq = typeof p.seq === 'number' ? eventSeq(p.seq) : null
  const streamPayload = hasStreamPayload(p)

  // ── turn_started ──
  if (phase === 'turn_started') {
    if (!turn) return null
    const ts = asRecord(p.turn_start)
    const rawTrigger = optStr(ts?.trigger)
    const trigger: 'user' | 'resume' | 'notification' =
      rawTrigger === 'resume' ? 'resume' : rawTrigger === 'notification' ? 'notification' : 'user'
    const started: DomainEvent = {
      type: 'turn_started', turnID: turnID(turn),
      requestID: optStr(ts?.request_id) ?? null, trigger, content: optStr(ts?.content) ?? null,
      // ⛔ 审计确证（state-check-5 C1）：后端 `emitTurnStarted` **已携带** todos/goal（B1 修复），
      //   但本分支此前只读 turn 字段 ⇒ 重连后只回放到 turn_started 时，todo/goal 保持旧值/空，
      //   直到第一个结构化迭代帧（长思考时体感很差）。⇒ 三态原样带上。
      todos: optTodos(p.todos),
      goal: optGoal(p.goal),
    }
    // ⛔ 审计：本分支此前直接 return，**丢掉并存的流式载荷**（与 done / iteration 分支不对称）。
    //   服务端在"turn_started + 第一段流式内容"合帧时会因此丢字。现在按同一规则：先 stream 后 start。
    return streamPayload ? [streamEventFrom(p, turn, seq), started] : [started]
  }

  // ── 纯流式帧（打字机/genui 流）──
  // ⚠️ Web channel 把【所有】ProgressEvent 转发为 type='progress_structured'
  // （旧 useProgressStream 注释："the Web channel forwards ALL ProgressEvents
  // as type=progress_structured, including stream callbacks"）—— 不存在独立的
  // 'stream_content' 消息类型！打字机帧 = progress_structured + phase='' +
  // stream_content/reasoning_stream_content/genui_content 字段。必须在
  // iteration fallback 之前分流：否则被误判为 iteration 事件，流式字段被完全
  // 忽略 → 打字机死掉 / GenUI 流式预览不渲染（E2E genui-render 复现）。
  if (phase === '' && streamPayload) {
    return [streamEventFrom(p, turn, seq)]
  }

  // ── phase_done（PhaseDone：turn 结束，text/cancel ack 随后到） ──
  if (phase === 'done') {
    // seq 缺失（E2E mock 省略）宽容：事件照常产出（reduce 的 I5 对 null seq
    // 不推进基准）。真实后端 ProgressEvent 总带 seq。
    // turn 缺失（turn_id=0）也照常产出 —— todos 是会话级状态，不因 turn 缺失
    // 而丢弃（turnID 置 null，reduce 回退 activeTurn）。
    // 后端 recordFinalIteration attach 的最后迭代快照（可能 null/缺失）。
    const rawHist = Array.isArray(p.iteration_history) ? p.iteration_history : []
    const normalized = dedupeIterationsByNumber(
      rawHist.map(normalizeWebIteration).filter((x): x is NonNullable<typeof x> => x !== null),
    )
    const finalIteration = normalized.length > 0 ? normalized[normalized.length - 1] : null
    const done: DomainEvent = {
      type: 'phase_done',
      turnID: turn !== null ? turnID(turn) : null,
      seq,
      finalIteration,
      todos: optTodos(p.todos),
      goal: optGoal(p.goal),
    }
    // 快照合并场景：done + 流式载荷并存 → stream 先应用（收尾定格流式文本）。
    return streamPayload ? [streamEventFrom(p, turn, seq), done] : [done]
  }

  // ── 会话级字段帧（todos / goal）—— **不得**被当成 turn 活动事件 ──────────────
  // ⛔ 审计确证（state-final-9 / 3：「会话级字段帧被当成 turn 活动事件」）：后端的
  //   `emitTodosProgress` / `emitGoalProgress` / `ClearGoal` 发的是
  //   `Phase:"" / Iteration:0 / 只有 Todos(+Goal)` 的轻量帧；若落进下面的 `iteration` 分支，
  //   reduce 会把它当成"该迭代的结构帧" ⇒ **清空在飞工具列表**、把 `streaming` 置 true
  //   ⇒ 复活 busy（用户看到：编辑 todo 时工具 pill 消失 / 已结束的回合又变「思考中」）。
  //   ⇒ 这类帧单独归一成 `session_fields`（只应用会话级三态，不碰 turn/工具）。
  const hasIterationPayload: boolean = (typeof p.iteration === 'number' && p.iteration > 0)
    || Array.isArray(p.iteration_history) || Array.isArray(p.active_tools)
    || Array.isArray(p.completed_tools) || Array.isArray(p.streaming_tools)
    || typeof p.content === 'string' || typeof p.reasoning === 'string'
    || streamPayload === true
  if (!hasIterationPayload) {
    const onlyTodos = Array.isArray(p.todos)
    const onlyGoal = p.goal !== undefined && p.goal !== null
    if (onlyTodos || onlyGoal) {
      return [{
        type: 'session_fields',
        todos: optTodos(p.todos),
        goal: optGoal(p.goal),
      }]
    }
  }

  // ── iteration（普通结构化事件：thinking / tool_exec / …） ──
  // seq 缺失（E2E mock 省略）宽容：事件照常产出（reduce 的 I5 对 null seq
  // 不推进基准 —— `ev.seq <= s.lastSeq` 对 null 恒 false，不误杀）。
  // turn 缺失（turn_id=0）也照常产出 —— todos 是会话级，不因 turn 缺失丢弃。
  const rawDelta = Array.isArray(p.iteration_history) ? p.iteration_history : []
  // token_usage（ContextRing/会话上下文刷新）。
  const rawTU = asRecord(p.token_usage)
  const tokenUsage =
    rawTU && typeof rawTU.prompt_tokens === 'number'
      ? {
          promptTokens: rawTU.prompt_tokens,
          completionTokens: typeof rawTU.completion_tokens === 'number' ? rawTU.completion_tokens : 0,
          totalTokens: typeof rawTU.total_tokens === 'number' ? rawTU.total_tokens : 0,
        }
      : undefined
  // stream_stats（实时流式时序：TTFT/tokens-per-sec）—— iteration 事件携带，
  // reduce 写入 live，liveProgressFromState 输出到 ProgressSnapshot.streamStats。
  const rawSS = asRecord(p.stream_stats)
  const streamStats =
    rawSS && (typeof rawSS.tokens_per_sec === 'number' || typeof rawSS.ttft_ms === 'number')
      ? {
          ttftMs: typeof rawSS.ttft_ms === 'number' ? rawSS.ttft_ms : 0,
          tpotMs: typeof rawSS.tpot_ms === 'number' ? rawSS.tpot_ms : 0,
          tokensPerSec: typeof rawSS.tokens_per_sec === 'number' ? rawSS.tokens_per_sec : 0,
          totalMs: typeof rawSS.total_ms === 'number' ? rawSS.total_ms : 0,
          chunks: typeof rawSS.chunks === 'number' ? rawSS.chunks : 0,
        }
      : undefined
  const iter: DomainEvent = {
    type: 'iteration',
    turnID: turn !== null ? turnID(turn) : null,
    phase: optStr(p.phase),
    // ⛔ **缺失 ≠ 迭代 1**：伪造 1 会把无迭代号的结构化事件应用/覆盖到第 1 迭代
    //   （迭代内容跳变/同号重复的真根因之一）。null ⇒ reducer 保留 prev.iter，
    //   且不参与 `advanced` / gap 判据。
    iter: typeof p.iteration === 'number' && p.iteration >= 1 ? iterNum(p.iteration) : null,
    seq,
    content: optStr(p.content),
    reasoning: optStr(p.reasoning),
    // Go nil slice → JSON null → []（I6：normalize 之后无 null 数组）
    // ⛔ F1：显式携带标记（`undefined`=沿用旧行为），供 reduce 区分"缺失"与"权威空"。
    toolsCarried: Array.isArray(p.active_tools) || Array.isArray(p.completed_tools),
    activeTools: normalizeWebTools(Array.isArray(p.active_tools) ? p.active_tools : []),
    completedTools: normalizeWebTools(Array.isArray(p.completed_tools) ? p.completed_tools : []),
    iterationsDelta: dedupeIterationsByNumber(
      rawDelta.map(normalizeWebIteration).filter((x): x is NonNullable<typeof x> => x !== null),
    ),
    todos: optTodos(p.todos),
    goal: optGoal(p.goal),
    subAgents: Array.isArray(p.sub_agents)
      ? normalizeWebSubAgents(p.sub_agents as unknown[])
      : undefined,
    tokenUsage,
    streamStats,
  }
  // 快照合并场景（get_active_progress mergeStreamState）：结构化 + 流式载荷
  // 并存 → [stream, iteration]（stream 先应用；iteration 的 content 存在时
  // 覆盖 stream 文本 —— 旧 DUPLICATE PREVENTION 语义）。
  return streamPayload ? [streamEventFrom(p, turn, seq), iter] : [iter]
}

// ─── stream_content → stream ──

function normalizeStream(env: Record<string, unknown>): readonly DomainEvent[] | null {
  const p = asRecord(env.progress)
  if (!p) return null
  // turn_id 缺失（已知后端 gap：部分 stream 事件无 turn_id）不丢弃 ——
  // 透传 null，reduce 回退 activeTurn。旧前端对 stream 事件同样无 turn_id
  // 要求（打字机依赖此宽容性）。
  const turn = optTurnID(p.turn_id)
  return [
    {
      type: 'stream',
      turnID: turn !== null ? turnID(turn) : null,
      seq: typeof p.seq === 'number' ? eventSeq(p.seq) : null,
      iteration: typeof p.iteration === 'number' && p.iteration >= 1 ? iterNum(p.iteration) : null,
      content: optStr(p.stream_content),
      reasoning: optStr(p.reasoning_stream_content),
      streamingTools: Array.isArray(p.streaming_tools)
        ? normalizeWebTools(p.streaming_tools)
        : undefined,
      genui: optStr(p.genui_content),
      streamStats: parseStreamStats(p),
      // ⛔ 与 `streamEventFrom` 同源（审计发现两条流式入口曾不同源：这条漏了会话级字段）
      todos: optTodos(p.todos),
      goal: optGoal(p.goal),
    },
  ]
}

// ─── text → text_final ──

function normalizeText(env: Record<string, unknown>): readonly DomainEvent[] | null {
  // turn_id 的两处来源：顶层（WSMessage.TurnID，omitempty —— 0 时缺省）与
  // metadata.turn_id（sendMessage 给最终回复显式带上的权威值）。命令回复
  // （`!cmd` / slash）**两处都没有** —— 那是"无 turn"的唯一合法形态
  // （reduce 把它渲染为 legacy 独立行）。
  const meta = asRecord(env.metadata)
  const metaTurn = optTurnID(meta?.turn_id)
  const turn = optTurnID(env.turn_id) ?? metaTurn
  // 后端 `markCommandReply` / `sendCommandReply` 显式打标（字符串 'true'，兼容布尔值）——
  // **只有**它代表「无 turn 的独立命令回复」（CR 2026-09-21 P1-1）。
  const commandReply = meta?.command_reply === 'true' || meta?.command_reply === true
  const content = typeof env.content === 'string' ? env.content : ''
  const progressHistory = parseWebIterations(optStr(env.progress_history))
  return [
    {
      type: 'text_final',
      commandReply,
      turnID: turn !== null ? turnID(turn) : null,
      content: nonEmptyStr(content),
      progressHistory,
      cancelled: env.cancelled === true,
    },
  ]
}

// ─── session → session ──

function normalizeSession(env: Record<string, unknown>): readonly DomainEvent[] | null {
  const s = asRecord(env.session)
  const action = optStr(s?.action)
  // ⛔ 审计（2026-10-21）：此前只认 `busy`/`idle`，把服务端同样会发的
  //   `agent-busy` / `agent-idle`（`core/streammerge.ets:isIdleAction/isBusyAction` 已承认）
  //   全部丢弃 ⇒ 粗粒度 idle **到不了状态机**（只剩 store.applyLocalIdle 一条路，
  //   而它在 `sessionRunning` 已 false 时是幂等 no-op）⇒ 出现"有产出但 busy 永不复位"的死角。
  //   现在四个取值都归一（判据复用同一对纯函数，与渲染/状态机同源）。
  // ⛔ `normalize.ts` 是**纯 TS 端口件**，ArkTS 硬禁 `.ts` import `.ets`
  //   （`10605999 Importing ArkTS files in JS and TS files is forbidden`）⇒ 这里内联同一份集合
  //   （与 `core/streammerge.ets:isIdleAction/isBusyAction` **逐字对应**，改动必须两处同步）。
  // `turn_id` 把 busy/idle 钉到具体一轮（服务端 `SessionEvent.TurnID`）；缺省 = 未指定。
  const rawTurn = s?.turn_id
  const sessTurn: ReturnType<typeof turnID> | null = typeof rawTurn === 'number' && rawTurn > 0
    ? turnID(rawTurn) : null
  // ⚠️ 只有真的有 turn_id 时才带 `turnID` 键（缺省 = 未指定）：形状保持与既有事件逐字一致，
  //   避免"多一个 null 键"改变归一结果的深比较（既有判据依赖完全相同的形状）。
  if (action === 'idle' || action === 'agent-idle' || action === 'session-idle') {
    return [sessTurn !== null ? { type: 'session', busy: false, turnID: sessTurn } : { type: 'session', busy: false }]
  }
  if (action === 'busy' || action === 'agent-busy' || action === 'session-busy') {
    return [sessTurn !== null ? { type: 'session', busy: true, turnID: sessTurn } : { type: 'session', busy: true }]
  }
  return null
}

// ─── user_echo / inject_user → user_echo ──

// F#9：同毫秒两条 echo（后端连续注入）→ Date.now() 相同 → id 碰撞 →
// React key 重复 + TanStack Virtual 高度测量串行。echoSeq 单调后缀保证唯一
//（与 useChatMessages.ts 乐观行 id 的既有模式一致）。
let echoSeq = 0

function normalizeUserEcho(env: Record<string, unknown>): readonly DomainEvent[] | null {
  // F#10：nonEmptyStr smart constructor 直接产出 NonEmptyS（原 gate +
  // `as never` 绕过 branded 类型 —— no-as 规则）。'' → null（非法，丢弃）。
  const content = nonEmptyStr(typeof env.content === 'string' ? env.content : '')
  if (content === null) return null
  const turn = optTurnID(env.turn_id)
  // ⚠️ requestID 字段兼容（双 user 行 + 双思考中根因）：后端 web_inbound.go
  // 把 requestID 序列化到 WSMessage.ID（json:"id"），不带 request_id 字段。
  // 旧代码只读 env.request_id → 永远 null → reduce 的幂等检查全部跳过 →
  // echo 无条件追加进 pendingUsers → 同一 user 在 turns[].user 和 pending
  // 各一份（双 user 行；第二个"思考中"是底部 busy placeholder，px-3 缩进
  // 多空格 —— 用户报告）。大部分时候 useChatMessages 的 echo 处理（读 msg.id，
  // 字段正确）触发 history_replaced → step5 按 turnHint 清理兜底；但 REST ack
  // 先到把 MessageStore 行标 persisted 时该兜底跳过 → 偶发双行。requestID
  // 正确解析后幂等在 reduce 层结构生效，不依赖任何兜底。
  const requestID = optStr(env.request_id) ?? optStr(env.id) ?? null
  return [{
    type: 'user_echo',
    row: {
      id: `echo-${turn ?? 'x'}-${Date.now()}-${echoSeq++}`,
      content,
      timestamp: new Date().toISOString(),
      isNotification: env.is_notification === true,
      queued: false,
      sending: false,
      requestID,
      turnHint: turn ?? undefined,
      dbID: undefined,
    },
  },
  ]
}

// ─── 本地事件构造器（非 SSE —— UI 侧直接构造已规范化的 DomainEvent） ──
// F#8：userSentEvent/historyReplacedEvent 已删除 —— grep 全项目零引用
//（useAgentChatState 直接内联构造 DomainEvent，不经过这两个包装）。

/**
 * 按 iteration 号去重（**渲染层防线**）。
 *
 * 判据只用 **O(1) 的非空性 + 完整度**，⛔ 不做全文字符串比较：
 *   · 有正文/思考的一条**永不**被同号空壳（committed 占位行）覆盖；
 *   · 两条都有或都没有正文 ⇒ **后者胜**（事件内后者 = 更晚到达的增量）；
 *   · 完整字段（`toolsFolded !== true`）不被轻字段覆盖；
 *   · 输出按号升序。
 * 真正的跨事件合并（引用稳定/轻完整四象限）在 `reduce.mergeIterations`。
 */
export function dedupeIterationsByNumber(iters: readonly WebIteration[]): WebIteration[] {
  if (iters.length <= 1) return iters as WebIteration[]
  const byNum = new Map<number, WebIteration>()
  for (const it of iters) {
    const prev = byNum.get(it.iteration)
    if (!prev) {
      byNum.set(it.iteration, it)
      continue
    }
    const prevFolded = prev.toolsFolded === true
    const curFolded = it.toolsFolded === true
    const prevHas = (prev.content ?? '').length > 0 || (prev.reasoning ?? '').length > 0
    const curHas = (it.content ?? '').length > 0 || (it.reasoning ?? '').length > 0
    // 空壳不得覆盖有内容的；有内容的更新（同号修正）应当生效。
    if (curHas && !prevHas) {
      byNum.set(it.iteration, it)
      continue
    }
    if (!curHas && prevHas) {
      continue
    }
    // 同"有无内容"：轻字段不得覆盖完整字段；同完整度后者胜。
    if (prevFolded && !curFolded) {
      byNum.set(it.iteration, it)
    } else if (!prevFolded && curFolded) {
      // keep prev
    } else {
      byNum.set(it.iteration, it)
    }
  }
  return [...byNum.values()].sort((a, b) => a.iteration - b.iteration)
}
