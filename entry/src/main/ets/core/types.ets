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
   * 渲染版本号（**整数**，非内容指纹）—— 由 `core/render.ets` 在转换时分配。
   *
   * ⛔ 参与 `MessageRow` 内层 `ForEach` 的 key：同号迭代内容变化时换 key ⇒ 只重建
   *   该块。**绝不用字符串比较内容**（性能 + 禁止内容去重）；源对象未变时复用同一
   *   个 `HistoryIteration`（WeakMap 按源 `WebIteration` 恒等记忆化）⇒ rev 不变。
   */
  rev?: number;
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

/**
 * **高频在飞内容**的可观察持有者（`@Observed`）—— 流式期逐帧变化的那部分。
 *
 * ⛔ 为什么必须独立成一个对象（2026-10-20 性能根因，见 `docs/PERF-BOUNDS.md §3`）：
 *   旧实现把 `liveText/liveReasoning/liveTools` 放在**页面 `@State`**、再由页面投给
 *   `MessageRowView` 的 `@Prop` ⇒ 每次投递都会让**整页** rebuild（页面 build 是万行级
 *   函数，含会话列表/抽屉/浮层分支），并以 ≤10Hz 重复 ⇒ 与滚动/手势抢主线程。
 *   现在：写这个对象的属性**只通知订阅它的 `LiveTailView`**（`@ObjectLink`），
 *   页面与行组件都不重建 ⇒ 每帧成本与页规模、迭代数量无关（O(1) 属性写）。
 *
 * 约定（不变量，判据见 `tools/tests/perf_frame_bounded.test.ts`）：
 *   · 只由页面 `syncLiveTail()` 按**投递节流**写（保持既有的可见性/浮层/滚动闸门语义）；
 *   · 组件侧**只读**；
 *   · `rev` 每次投递 +1（保证"值没变但需要重渲"也能通知到；工具数组是就地变更的）。
 */
@Observed
export class LiveTailState {
  /** 在飞正文（已收到的全量，未裁剪） */
  text: string = '';
  /** 在飞思考 */
  reasoning: string = '';
  /** 在飞工具列表（引用可能恒定、元素就地变更 ⇒ 依赖 `rev` 触发重渲） */
  tools: ToolProgress[] = [];
  /** 投递代数（每次真正投递 +1） */
  rev: number = 0;

  /** 组件侧读的"是否有在飞内容"（判据与行挂载同源）。 */
  hasContent(): boolean {
    return this.text.length > 0 || this.reasoning.length > 0 || this.tools.length > 0;
  }

  /**
   * **一次性**写入在飞内容（页面投递的唯一入口）。
   *
   * ⛔ 为什么必须聚合成一个方法（2026-10-21 P0「思考动画/字数卡死 5 秒」）：
   *   `@Observed` 的每个属性赋值都会通知订阅者 ⇒ 逐个写 `text`/`reasoning`/`tools`/`rev`
   *   会让 `LiveTailView` **连续重建 3–4 次**（每次都重跑 `onDidBuild → onSource → toRunes`
   *   + MarkdownView 重建）；叠加 20Hz 打字机与 600ms 脉冲，主线程被成串重建塞满 ⇒
   *   光球动画（Canvas）与「思考 N 字」一起静止数秒。
   *   ⇒ 聚合成**一次**方法调用：内容与代数在同一"写事务"里落定，订阅者只重建一次。
   *   内容没变时不写任何字段（零通知）。
   */
  setContent(text: string, reasoning: string, tools: ToolProgress[]): boolean {
    const sameText: boolean = this.text === text;
    const sameReason: boolean = this.reasoning === reasoning;
    const sameTools: boolean = this.tools === tools;
    if (sameText && sameReason && sameTools) {
      return false;
    }
    if (!sameText) { this.text = text; }
    if (!sameReason) { this.reasoning = reasoning; }
    if (!sameTools) { this.tools = tools; }
    this.rev = this.rev + 1;
    return true;
  }
}

/**
 * **已完成迭代块列表**的可观察持有者（`@Observed`）—— 只在块列表真正变化时替换 `blocks`。
 *
 * ⛔ 为什么（同一性能根因）：旧实现让**行组件**（`MessageRowView`）的 build 里直接
 *   `ForEach(shownIters())`。行对象是 `@ObjectLink` 订阅的，而 `applyRow` 在 live 分支
 *   **每个 SSE 事件**都会写行字段（正文/迭代/代际）⇒ 行组件逐帧 rebuild ⇒ 那个 `ForEach`
 *   逐帧对**全部 N 个块**重算 key（O(N)）。现在块列表被搬进独立组件（`IterBlocksView`），
 *   它只订阅这个持有者：正文流式增长**不换块数组** ⇒ 该组件**零重建** ⇒ 每帧 O(1)。
 */
@Observed
export class IterBlocks {
  /** 已完成（已跨迭代合并）的块列表 */
  blocks: HistoryIteration[] = [];
  /** turn 内压缩点（渲染在迭代之间；引用稳定） */
  compactions: WebCompaction[] = [];
  /** 归属行 id（`ForEach` 键前缀） */
  rowID: string = '';
  /** 归属 turn（思考展开态/知识键 `turnID:iteration`） */
  turnID: number = 0;
  /** 块代数（每次真正替换 +1；锚点表 memo 键/诊断） */
  rev: number = 0;
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
  /** 乐观 user 行：REST ack 前为 true（web `UserMessage.sending`）。 */
  sending: boolean = false;
  /** 已排队等待当前 turn 结束。 */
  queued: boolean = false;
  /** 渲染版本：每次内容变化自增（**整数**；仅诊断/锚点缓存用，不进外层 LazyForEach 键） */
  rev: number = 0;
  /**
   * live 行的**内容代际**：`core/render.ets:applyRow` 在 live 分支每次真正更新时 +1。
   * 页面 `syncLiveTail` 只比较这个整数（O(1)）来投递 `liveText/liveTools/liveBlocks`
   * —— ⛔ **不再用字符串指纹**（`blocksSignature`/`toolsSignature`/`subAgentsFingerprint`
   * 都是 O(内容) 拼接，违反"禁止用字符串比较内容去重"）。
   */
  liveRevision: number = 0;
  /**
   * live 行的**已完成块**（不含末尾在飞块）—— 由 `applyRow` 从源
   * `LiveRowView.iterations` 按**源数组对象恒等**记忆化得到（`convertedBlocksMemo`）。
   * 页面直接把这个引用投给 `@State liveBlocks`：引用不变 ⇒ 不重投（零字符串比较）。
   */
  completedBlocks: HistoryIteration[] = [];
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
  /**
   * **主题代际**触发器（2026-10-17 P0 白底白字的独立修复线）。
   *
   * ⛔ 背景：`MarkdownView` 的色链（`@StorageProp('appTheme')`）在虚拟列表**缓存 item** 上
   *   **不触发重渲**（0152795 亲证的平台坑）⇒ 切浅色后 C 块 MarkdownView 持有深色配色 = 白字；
   *   `applyRows` 的 `onDataReloaded`（键含 @theme）理论上会重建 item，但实测仍有窗口。
   * 修：主题 structural reload 时对每行 **@Observed 赋值**（`themeGen++`）⇒ @ObjectLink 组件
   *   **强制刷新**（绕过 @StorageProp 订阅坑）⇒ MarkdownView @Prop 重投 ⇒ pal() 更新 ⇒ 黑字。
   * 字段本身无 UI 语义（纯触发器）；赋值即通知，无需被 build 读取。
   */
  themeGen: number = 0;
  /**
   * **高频在飞内容**持有者（`@Observed`）—— 只通知订阅它的 `LiveTailView`。
   * ⛔ 行组件/页面**不读也不写**它的属性（读了不会建立订阅，写了会误判订阅源）。
   * 见 `LiveTailState` 的根因说明。
   */
  liveTail: LiveTailState = new LiveTailState();
  /**
   * **已完成块列表**持有者（`@Observed`）—— 只通知订阅它的 `IterBlocksView`。
   * 由 `core/render.ets:applyRow` 维护（仅在块列表/压缩点真正变化时替换）。
   */
  iterBlocks: IterBlocks = new IterBlocks();
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
