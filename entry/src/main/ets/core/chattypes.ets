/**
 * 聊天状态的**数据类型**（逐字移植自 xbot web：`web/src/types/shared.ts` + `web/src/chat/types.ts`）。
 *
 * 移植原则（用户要求「逻辑一比一」）：**不重新设计**，原样搬运字段与语义 ——
 * 这样原生端的渲染/状态行为与 web 由**代码同一性**保证一致，而不是靠我"照着理解再写"。
 */

/** Goal info (mirrors Go protocol.GoalInfo). */
export interface GoalInfo {
  objective: string
  status: string // "active" | "completed"
  summary?: string
}

/** TODO item — mirrors Go protocol.TodoItem (json: text, status). v2: status-only (done field removed).
 * No `id`: the array order the agent sends IS the display order. */
export interface TodoItem {
  text: string
  /** "pending" | "doing" | "done"（必填——LLM 必须显式标记状态） */
  status: string
}

/** SubAgent progress node — mirrors Go protocol.SubAgentInfo. */
export interface WebSubAgentProgress {
  role: string
  instance?: string
  sessionKey?: string
  status: string
  desc?: string
  children?: WebSubAgentProgress[]
  /** Spawn iteration of the main agent — background subagents outlive it and
   * render under their ORIGINAL iteration, never the newest one. */
  iteration?: number
}

/** Tool call progress — normalized from WS progress events or history. */
export interface WebToolProgress {
  name: string
  label: string
  status: ToolStatus
  elapsedMs: number
  summary: string
  detail: string
  args: string
  toolHints: string
  /** Iteration number this tool belongs to (from server). Used to filter
   * cross-iteration tool pollution — completedTools should only contain
   * tools from the CURRENT iteration, not all iterations. */
  iteration?: number
  /** UI capability mode from the tool's UIDecl metadata (e.g. "genui").
   * Frontend renders via GenUIBlock — metadata-driven, never tool-name-driven.
   * (see docs/agent/genui-plugin-design.md §9) */
  uiMode?: string
  /** LLM tool_call id — stable per-call identity. Present on ActiveTools
   * entries; used by the promote-to-background RPC to target the exact
   * running shell. Empty on legacy/history events. */
  callID?: string
  /** Global libraries the UI needs (echarts/three/motion). */
  uiLibs?: string[]
  /** Top-level panel declaration (from UIDecl.Surface) — the UI result renders
   * as a fancy top-level panel (header + collapse + fullscreen) instead of
   * being folded into the normal tool list. */
  surface?: UISurface
}

/** Iteration snapshot — one completed iteration's reasoning + tools + text output. */
export interface WebIteration {
  iteration: number
  /** 迭代的文本输出（最终回复 = 最终 iter 的 content）。thinking 字段已彻底删除。 */
  content: string
  reasoning: string
  tools: WebToolProgress[]
  toolCount: number
  /** Wall-clock duration (ms), optional — not always available from snapshots. */
  elapsedMs?: number
  /** 该迭代生成的 completion tokens（per-iteration，非累计）。 */
  tokens?: number
  /** 该迭代 LLM 首 token 延迟（ms）。 */
  ttftMs?: number
  /** 该迭代平均生成速度（tokens/sec）。 */
  tokensPerSec?: number
  /** 该迭代工具总耗时（ms） —— 由 tools 的 elapsedMs 求和。 */
  toolMs?: number
  /** 该迭代 spawn 的 SubAgent 树（迭代边界冻结）。后台 SubAgent 的进度
   * 归属到原迭代渲染，不漂移到最新迭代。 */
  subAgents?: WebSubAgentProgress[]
  /**
   * 该迭代的**工具详情**（summary/args/detail/tool_hints）未随历史载荷下发
   * （后端 `tools_folded`；缺省 false = 完整）。
   *
   * pill 渲染所需的**轻字段完整**（name/label/status/elapsedMs/exitCode/callID/
   * uiMode/uiLibs/surface + tools 数组长度）⇒ 默认视图（pills 全渲染、`+N` 溢出、
   * 失败 chip、复制菜单）与全量视图像素级一致。
   *
   * 浮层（LazyPillPopover → ToolPopoverDetail）打开时经 `POST /api/iteration_detail`
   * 按 `(turnID, iteration)` 拉取完整数据，再经 `mergeIterations` **同号覆盖**
   * —— 迭代号不变（不产生新洞/新块），轻字段永不覆盖已加载的完整数据。
   */
  toolsFolded?: boolean
}

/**
 * WebCompaction — 一个在 turn **内部**发生的上下文压缩点。
 *
 * 压缩由后端在 LLM 请求**之前**触发（agent.maybeCompress）⇒ 恒在**迭代边界** ⇒
 * 渲染在「迭代 AfterIteration 与 AfterIteration+1 之间」，与迭代同级（Cursor 式
 * "context summarized"）。AfterIteration=0 表示在第一个迭代之前。
 *
 * 老数据（无结构化迭代 / 无时间戳）无法定位 ⇒ 压缩以独立的 standalone 行渲染
 * （见 ChatMessage.standalone），不进此字段 —— 基本兼容。
 */
export interface WebCompaction {
  /** 压缩发生在该迭代号**之后**（0 = 第一个迭代之前）。 */
  afterIteration: number
  /** "[Compacted context]\n\n<summary>" 摘要正文（前端可展开查看）。 */
  content?: string
  /** 压缩记录时刻（compress record created_at）。 */
  timestamp?: string
}

/** 工具状态（逐字取自 web `types/shared.ts:344`）。 */
export type ToolStatus = 'pending' | 'generating' | 'running' | 'done' | 'error';

/** 队列项（逐字取自 web `types/shared.ts:213`）。 */
export interface QueueItemPayload {
  msg_id: string;
  turn_id: number;
  content: string;
  preview: string;
  source: string;
  enqueued_at: number;
}

/** UI 呈现描述（逐字取自 web `types/shared.ts:415`）。 */
export interface UISurface {
  kind?: string;
  title?: string;
  collapsible?: boolean;
  fullscreen?: boolean;
  defaultOpen?: boolean;
}
