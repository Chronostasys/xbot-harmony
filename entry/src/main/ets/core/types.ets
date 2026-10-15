/**
 * xbot 协议类型（客户端侧镜像）。
 *
 * 权威来源：xbot 仓库 `protocol/ws.go`、`protocol/events.go`、`channel/web/web_api.go`。
 * 这里只声明**客户端真正读到**的字段；未声明字段在 ArkTS 下会被安全忽略
 * （JSON.parse 后按 interface 取值）。
 */
import type { WebCompaction, WebSubAgentProgress } from './chattypes';

/** 统一 REST 信封：`{ok, data, error}`（`channel/web/web_auth.go` writeJSON）。 */
export interface ApiEnvelope {
  ok: boolean;
  data?: object;
  error?: ApiError;
}

export interface ApiError {
  code?: string;
  message?: string;
}

/** 会话项（`/api/session-tree` / `/api/chats/list`）。 */
/**
 * `/api/files/upload` 的响应（服务端 `channel/web/web_file.go` 的 writeJSON：
 * `{upload_key, name, size}`；Web 前端读的也是 `upload_key`）。
 */
export interface UploadResult {
  upload_key?: string;
  name?: string;
  size?: number;
}

export interface SessionItem {
  chat_id: string;
  channel?: string;
  label?: string;
  last_active?: string;
  running?: boolean;
  /**
   * 会话树**子节点**（子代理挂在当前会话的 `children` 下 —— 后端实测：`harmony-ui-dev` 有 19 个
   * `type=agent` 的子项）。此前**未解析** ⇒ 面板「子代理」tab 取的是 `orphan_subagents`（后端恒
   * `null`）⇒ **结构性永远空**（15h 实锤，见 `docs/WEB-ALIGNMENT.md §21.50`）。
   */
  children?: SessionItem[];
  /** 子代理身份：`role`/`instance`（web `subAgentTitle` 优先用它们）。 */
  role?: string;
  instance?: string;
  /** 子代理状态（`running`/`waiting_input`/`pending`/`done`…；web `isActiveSubAgent` 判据之一）。 */
  status?: string;
  /** 是否历史会话（web 副行文本用）。 */
  historical?: boolean;
  preview?: string;
  /** 会话类型（`main`/`agent`）。 */
  type?: string;
}

export interface SessionTreeData {
  sessions?: SessionItem[];
  chats?: SessionItem[];
  orphan_subagents?: SessionItem[];
}

/** 工具调用（迭代内）。 */
export interface ToolProgress {
  name: string;
  label?: string;
  status?: string;
  summary?: string;
  args?: string;
  detail?: string;
  elapsed_ms?: number;
  exit_code?: number;
  /** generating 状态下参数已生成的字符数（服务端 ToolProgress.GenChars） */
  gen_chars?: number;
  call_id?: string;
  ui_mode?: string;
  ui_libs?: string[];
  /** 工具提示（PostToolUse hook 产出的 markdown，含 ```diff 围栏）—— diff 卡的**唯一数据源**。 */
  tool_hints?: string;
}

/** 迭代（一个 LLM 请求-响应回合内的一个迭代）。 */
export interface HistoryIteration {
  iteration: number;
  content?: string;
  reasoning?: string;
  tools?: ToolProgress[];
  tools_folded?: boolean;
  created_at?: string;
  /**
   * **客户端累积**的流式文本（服务端 `stream_content` 检查点 / `stream_delta` 增量合成）。
   * 与 `content`（权威快照）分开存放：流式期间只有它更新，收尾时才由 `content` 接管。
   * 语义见 core/streammerge.ets。
   */
  stream_text?: string;
  /** 同上，推理流。 */
  stream_reasoning?: string;
  /**
   * ⚠️ 渲染层标记：这一块是**在飞（in-flight）迭代**（尚未 commit）。
   *
   * `core/render.ets` 从 live Row 的在飞字段（content/reasoning/activeTools/
   * streamingTools + lastIter）折叠出的**最后一个迭代块** —— 与已完成迭代
   * **共用同一套块渲染**，仅它带打字机/占位（对齐 web `TurnBody` 里 iterations
   * 之后追加的 `LiveIteration`：live 迭代就是该消息气泡**内部的最后一块**，
   * 而不是另一个气泡/另一行）。
   */
  live?: boolean;
  /**
   * 该迭代 spawn 的 **SubAgent 进度树**（对齐 web `chattypes.WebIteration.subAgents`，
   * 迭代边界冻结 —— 后台 SubAgent 的进度归属到原迭代，不漂移到最新迭代）。
   *
   * 数据源：状态机 `WebIteration.subAgents` → `core/render.ets:toHistoryIteration` 拷贝。
   * 渲染层据此展平（`core/subagent.flattenSubAgents`）后交给 `components/SubAgentTree`。
   * ⚠️ **只在有值时存在**（无 SubAgent 的迭代**不新增该键**，保持既有行对象形状不变）；
   *    空/缺省 ⇒ 渲染层**零产出**（不留空行）。
   */
  subAgents?: WebSubAgentProgress[];
}

/** 压缩点（`protocol/events.go:317 HistoryCompaction`）。 */
export interface HistoryCompaction {
  /** 压缩发生在该迭代号**之后**（0 = 该 turn 第一条迭代之前）。 */
  after_iteration?: number;
  /** `"[Compacted context]\n\n<summary>"` 正文（前端可展开）。 */
  content?: string;
  timestamp?: string;
}

/** 历史消息行。 */
export interface HistoryMessage {
  id: number;
  role: string;
  content?: string;
  turn_id?: number;
  timestamp?: string;
  iterations?: HistoryIteration[];
  regions_before?: number;
  /**
   * 该 turn 的 user 行 —— **仅当**该 turn 只下发了尾部区域窗口（`regions_before > 0`）时，
   * 服务端转换层把它**从消息流里摘出来**挂在这里（`protocol/events.go:302-310`
   * `TurnUser`、`channel/subscription.go:712 relocateIncompleteTurnUsers`；后端 `5c3aec7b`）。
   *
   * ⛔ 消息不连续零容忍（用户 2026-10-11）：接口层**绝不**把这条 user 行放进消息流
   * —— 否则任何「照着数组渲染」的消费者都会把它渲染在一个**尚未加载的缺口**上方
   * （`user msg → 跳 y 条 → iter`）。客户端必须在**边缘**还原成常规 user 行：
   * 落点 `store.ets:toChatMessages`（对齐 web `hooks/useChatMessages.ts:200-221`），
   * 是否渲染由 derive 的「窗口未覆盖迭代 1 ⇒ user 行不渲染」规则决定
   * （`core/derive.ts:287 userHiddenByFold`）。
   */
  turn_user?: HistoryMessage;
  /**
   * 该 turn **内部**发生过的上下文压缩点（`protocol/events.go:301/317`；`compactions`）。
   *
   * ⛔ 本仓此前**零消费**（`HistoryMessage` 没有这个字段 ⇒ JSON 被直接丢弃 ⇒ 历史 turn 的
   * 「上下文已压缩」横线**从不内联出现**）。消费链：`store.ets:toChatMessages`
   * （经 `core/compaction.ets:toHistoryCompactions`）→ `ChatMessage.compactions`
   * → `integrate.ts` 建 turn → `derive.ts` 的 `windowCompactions` 窗口过滤
   * → `MessageRow` 的「锚定迭代之后」内联渲染。web 同源：`hooks/useChatMessages.ts:250`。
   */
  compactions?: HistoryCompaction[];
}

/** `/api/history` 的 data。 */
export interface HistoryData {
  messages?: HistoryMessage[];
  chat_id?: string;
  channel?: string;
  last_seq?: number;
  active_progress?: ProgressEvent;
  has_more?: boolean;
  oldest_id?: number;
}

/** 语义进度事件（`protocol/events.go`）；`seq` 是 **per-Run** 水位线。 */
export interface ProgressEvent {
  seq?: number;
  iteration?: number;
  phase?: string;
  content?: string;
  reasoning?: string;
  tools?: ToolProgress[];
  iteration_history?: HistoryIteration[];
  streaming?: boolean;
  busy?: boolean;
  chat_id?: string;
  channel?: string;
  turn_id?: number;
  /** ask_user 事件的载荷字段（服务端 ProgressEvent 的 Questions/RequestID） */
  questions?: AskQuestion[];
  request_id?: string;

  // ── 流式字段（**服务端 protocol/events.go 的实际命名**；合并语义见 core/streammerge.ets）──
  /** 累积累积文本的**检查点**（非空 ⇒ 整体替换累积值） */
  stream_content?: string;
  /** **增量**文本（追加到累积值） */
  stream_delta?: string;
  /** 推理流的检查点 与 增量 */
  reasoning_stream_content?: string;
  reasoning_stream_delta?: string;
  /** 在飞工具（流式事件用这个字段名） */
  streaming_tools?: ToolProgress[];
  // ── 结构化快照里的工具（progress_structured / history）──
  active_tools?: ToolProgress[];
  completed_tools?: ToolProgress[];
  tool_calls?: ToolProgress[];
  tools_folded?: boolean;
  /** 结构化事件里的目标（服务端 ProgressEvent.Goal） */
  goal?: GoalInfo;
  /** 会话级 todos（服务端 ProgressEvent.Todos）—— web normalize/integrate 读取。 */
  todos?: ProtoTodoItem[];
  /** SubAgent 进度树（服务端 ProgressEvent.SubAgents）—— web 读取并归一。 */
  sub_agents?: ProtoSubAgent[];
  /** busy 快照折叠窗口声明（服务端 ProgressEvent.IterationRegionsBefore）。 */
  iteration_regions_before?: number;
  /** 实时流式时序（服务端 ProgressEvent.StreamStats）—— web parseStreamStats 读取。 */
  stream_stats?: ProtoStreamStats;
}

/** 服务端 ProgressEvent.SubAgents 的节点（ArkTS 禁止 unknown ⇒ 具名递归接口）。 */
export interface ProtoSubAgent {
  role?: string;
  instance?: string;
  session_key?: string;
  status?: string;
  desc?: string;
  iteration?: number;
  children?: ProtoSubAgent[];
}

/** 服务端 ProgressEvent.Todos 的元素（ArkTS 禁止对象字面量作类型 ⇒ 具名接口）。 */
export interface ProtoTodoItem {
  id?: string;
  text?: string;
  status?: string;
}

/** 服务端 ProgressEvent.StreamStats（实时流式时序）。 */
export interface ProtoStreamStats {
  ttft_ms?: number;
  tpot_ms?: number;
  tokens_per_sec?: number;
  total_ms?: number;
  chunks?: number;
}

/** 会话生命周期事件（`session` 事件载荷）。 */
export interface SessionEvent {
  /** 服务端 `SessionEvent.Action`（json:"action"）：idle / busy / history_rewound / subagent_* … */
  action?: string;
  chat_id?: string;
  channel?: string;
  busy?: boolean;
}

/** SSE 信封（`protocol/ws.go` WSMessage 的客户端视图）。 */
export interface SseEnvelope {
  type?: string;
  id?: string;
  content?: string;
  seq?: number;
  ts?: number;
  turn_id?: number;
  chat_id?: string;
  channel?: string;
  progress?: ProgressEvent;
  session?: SessionEvent;
  metadata?: Record<string, string>;
}

/** SSE 事件名（与 web 前端白名单一致，`web/src/providers/sseConnection.ts`）。 */
export class SseEventType {
  static readonly text: string = 'text';
  static readonly progressStructured: string = 'progress_structured';
  static readonly streamContent: string = 'stream_content';
  static readonly userEcho: string = 'user_echo';
  static readonly session: string = 'session';
  static readonly heartbeat: string = 'heartbeat';
  static readonly askUser: string = 'ask_user';
  static readonly askUserResolved: string = 'ask_user_resolved';
  static readonly syncProgress: string = 'sync_progress';
  static readonly resyncRequired: string = 'resync_required';
  static readonly queueState: string = 'queue_state';
  static readonly runnerStatus: string = 'runner_status';
  static readonly webWidgets: string = 'web_widgets';
  static readonly pluginWidgets: string = 'plugin_widgets';
  /** 后台任务输出增量（web `sseConnection.ts:445` 同源；详情面板实时化——中等项 #7-1）。 */
  static readonly bgTaskOutput: string = 'bg_task_output';
}

/**
 * 渲染用行模型：一个 turn = 一条 user 行 + 一条 assistant 行（与 web 一致）。
 *
 * ⚠️ `rev` 是**渲染版本号**，必须每次改动行内容时自增，且参与 ForEach 的 key：
 * ArkUI 按 key 复用列表项 —— 若原地改字段而 key 不变，框架认为该项无需重建，
 * 界面就会显示陈旧/半新半旧的内容（"整个渲染错乱"的典型来源）。
 */
/**
 * 「有迭代数组」这一最小能力，供 core/streammerge.ets 的纯函数使用。
 * ⚠️ ArkTS 禁止结构化类型（`arkts-no-structural-typing`）：参数类型必须是**具名**接口，
 * 且传参方必须**显式 implements**（仅字段形状相同不算）。
 */
export interface IterList {
  iterations: HistoryIteration[];
}

@Observed
export class ChatRow implements IterList {
  id: string = '';
  role: string = 'assistant';
  turnID: number = 0;
  content: string = '';
  iterations: HistoryIteration[] = [];
  isLive: boolean = false;
  /**
   * 该 user 行是否为**后台通知注入**（web `ChatMessage.isNotification` / `UserMessage.tsx:45`）。
   * 渲染层据此分流：**通知类原样呈现**（web `UserMessage.notification.test.tsx:13/23`），
   * 普通用户消息走与助手同一条 markdown（web `UserMessage.tsx:4-5`）。
   * 数据源：派生行 `UserRowView.isNotification` → `core/render.ets:applyRow` 透传。
   */
  isNotification: boolean = false;
  /** 渲染版本：每次内容变化自增，参与 ForEach key */
  rev: number = 0;
  /**
   * 派生行内容指纹（`core/render.ets` 写入）—— 与上一帧相同则**不更新字段**、
   * 不自增 rev（保住 @ObjectLink 恒等 + 避免无谓重建）。⚠️ 纯内部状态，不参与 UI。
   */
  signature: string = '';
  /**
   * 该 turn **更早未下发的展示区域数**（服务端 `regions_before`）。
   * REST 历史是折叠视图（`HistoryRegionWindow = 100`）：每个 turn 只下发尾部 100 个区域，
   * 更早的必须用 `POST /api/regions` 按需取回。缺省 0 = 已完整下发。
   */
  regionsBefore: number = 0;
  /**
   * turn **内部**的上下文压缩点（compaction）—— 渲染在**迭代之间**、与迭代同级
   * （Cursor 式 "context summarized"）。见 `chattypes.WebCompaction`。
   *
   * 空数组 = 该 turn 无压缩 ⇒ 渲染层**不产出任何节点**（不留空行/占位）。
   * 数据源：`derive` 的 committed Row → `core/render.ets:applyRow` 透传（引用稳定）。
   */
  compactions: WebCompaction[] = [];
  /**
   * 该行**当前**的 **SubAgent 进度树**快照 —— 对齐 web live 快照的 `subAgents`。
   *
   * 数据源：状态机 `LiveRowView.subAgents` → `core/render.ets:applyRow` 写入。
   * **只有 live 行会有值**；已提交/frozen 行的各迭代树在 `iterations[].subAgents` 上
   * （迭代边界冻结，故不合并到行级 —— 与 web 逐迭代渲染同源）。
   *
   * 渲染层据此展平（`core/subagent.flattenSubAgents(row.subAgents, …)`）后交给
   * `components/SubAgentTree`；空数组 ⇒ **零产出**。
   */
  subAgents: WebSubAgentProgress[] = [];
}

// ─────────────────────────────────────────────────────────────────────────────
// M2 新增：AskUser / 队列 / 插件面板 / 工具详情
// ─────────────────────────────────────────────────────────────────────────────

export interface AskOption {
  label?: string;
  description?: string;
}

export interface AskQuestion {
  id?: string;
  header?: string;
  question?: string;
  options?: AskOption[];
  multi_select?: boolean;
  allow_other?: boolean;
}

/** `ask_user` 事件的载荷（对应服务端 ProgressEvent 的 Questions/RequestID）。 */
export interface AskUserPrompt {
  request_id?: string;
  questions?: AskQuestion[];
}

export interface QueueItem {
  msg_id?: string;
  id?: string;
  content?: string;
  text?: string;
  created_at?: string;
}

export interface QueueListData {
  items?: QueueItem[];
  queue?: QueueItem[];
}

/** `web_plugin_list`（RPC）返回的 web 插件（字段做过兼容，服务端可能用 id/plugin_id）。 */
export interface WebPluginInfo {
  id?: string;
  plugin_id?: string;
  name?: string;
  label?: string;
  entry?: string;
  module_url?: string;
  icon?: string;
}

export interface WebPluginListData {
  plugins?: WebPluginInfo[];
}

/** `/api/iteration_detail` 的 data。 */
export interface IterationDetailData {
  iteration?: HistoryIteration;
}

/** `/api/regions` 的 data：内层区域分页（返回 `iteration < before_iteration` 的下一段更早区域）。 */
export interface RegionsData {
  iterations?: HistoryIteration[];
  regions_before?: number;
}

/** UI 用的插件面板条目（id/名字/可打开的 URL）。 */
export class PluginPanelInfo {
  id: string = '';
  name: string = '';
  url: string = '';
  icon: string = '';
}

/** `/api/session/status` 返回的 token 用量（服务端 sessionTokenUsage 的键）。 */
export interface TokenUsage {
  available?: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  max_context_tokens?: number;
  /** 0..100 */
  usage_percent?: number;
  model?: string;
  subscription_name?: string;
}

/** 一条 todo（`protocol.TodoItem`）。 */
export interface TodoItem {
  id?: string;
  text?: string;
  /** pending | in_progress | completed */
  status?: string;
}

/** 目标（结构化进度事件里的 `goal`）。 */
export interface GoalInfo {
  text?: string;
  status?: string;
}

/** `/api/session/status` 的响应（`{token_usage, cwd, todos}`）。 */
export interface SessionStatus {
  token_usage?: TokenUsage;
  cwd?: string;
  todos?: TodoItem[];
}

/** 搜索命中（服务端 `searchHit`）。⚠️ 只在**当前会话**的消息里检索。 */
export interface SearchHit {
  id?: number;
  role?: string;
  created_at?: string;
  snippet?: string;
}

/** 会话分支（fork）结果（服务端 `{chat_id, channel}`）。 */
export interface ForkResult {
  chat_id?: string;
  channel?: string;
}
