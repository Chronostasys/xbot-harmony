/**
 * xbot 协议类型（客户端侧镜像）。
 *
 * 权威来源：xbot 仓库 `protocol/ws.go`、`protocol/events.go`、`channel/web/web_api.go`。
 * 这里只声明**客户端真正读到**的字段；未声明字段在 ArkTS 下会被安全忽略
 * （JSON.parse 后按 interface 取值）。
 */

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
export interface SessionItem {
  chat_id: string;
  channel?: string;
  label?: string;
  last_active?: string;
  running?: boolean;
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
  call_id?: string;
  ui_mode?: string;
  ui_libs?: string[];
}

/** 迭代（一个 LLM 请求-响应回合内的一个迭代）。 */
export interface HistoryIteration {
  iteration: number;
  content?: string;
  reasoning?: string;
  tools?: ToolProgress[];
  tools_folded?: boolean;
  created_at?: string;
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
}

/** 会话生命周期事件（`session` 事件载荷）。 */
export interface SessionEvent {
  chat_id?: string;
  channel?: string;
  state?: string;
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
}

/**
 * 渲染用行模型：一个 turn = 一条 user 行 + 一条 assistant 行（与 web 一致）。
 *
 * ⚠️ `rev` 是**渲染版本号**，必须每次改动行内容时自增，且参与 ForEach 的 key：
 * ArkUI 按 key 复用列表项 —— 若原地改字段而 key 不变，框架认为该项无需重建，
 * 界面就会显示陈旧/半新半旧的内容（"整个渲染错乱"的典型来源）。
 */
export class ChatRow {
  id: string = '';
  role: string = 'assistant';
  turnID: number = 0;
  content: string = '';
  iterations: HistoryIteration[] = [];
  isLive: boolean = false;
  /** 渲染版本：每次内容变化自增，参与 ForEach key */
  rev: number = 0;
  /**
   * 该 turn **更早未下发的展示区域数**（服务端 `regions_before`）。
   * REST 历史是折叠视图（`HistoryRegionWindow = 100`）：每个 turn 只下发尾部 100 个区域，
   * 更早的必须用 `POST /api/regions` 按需取回。缺省 0 = 已完整下发。
   */
  regionsBefore: number = 0;
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
