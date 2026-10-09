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

/** 渲染用行模型：一个 turn = 一条 user 行 + 一条 assistant 行（与 web 一致）。 */
export class ChatRow {
  id: string = '';
  role: string = 'assistant';
  turnID: number = 0;
  content: string = '';
  iterations: HistoryIteration[] = [];
  isLive: boolean = false;
}
