/**
 * ChatStore —— 会话/消息/实时进度/待答问题/队列/插件的唯一数据源。
 *
 * 设计取舍（与 web 前端的对应关系）：
 *   · `rows`（ChatRow）        ≈ web `deriveRows(state)`：一个 turn = 1 user 行 + 1 assistant 行
 *   · live 迭代（isLive=true） ≈ web 的 live 行 + `progress_structured`
 *   · seq 水位线               = `ProgressEvent.seq`（per-Run，丢弃重放）
 *   · `askUser` / `queue`      = 服务端权威（每 (channel,chat) 至多一个 pending）
 *
 * 为什么不用 ArkUI 的 @Observed：跨页面共享一个普通类 + 回调通知更简单可控，
 * 页面把它同步进 @State（见 pages/Index.ets 的 syncFrom）。
 */
import { XbotHttp, HTTP_SEND_READ_TIMEOUT_MS, HTTP_CANCEL_READ_TIMEOUT_MS } from './http';
import { log } from './applog';
import { SseClient } from './sse';
/** SSE 意图的竞态窗口（web `useSessionStore.ts` 同值 15s）。 */
import { hasFreshPhaseDone, isIdleAction, runningAfterReconcile, rowIsEmpty, sendStartsTurn, shouldReloadHistory, stripInterruptedMarker } from './streammerge';
import { arrOrEmpty, isPresent } from './guards';
import { ChatState, DomainEvent, EventSeq, initialChatState, iterNum, NonEmptyS, nonEmptyStr, turnID, TurnID, UserRow } from './chat_types_full';
import { DEMO_ANSWER, DEMO_REASONING, demoSeedPrompt, demoSessions } from './demo';
import { reduce, applySessionFields } from './reduce';
import { deriveRows, Row } from './derive';
import { extractEventChatID, normalizeEvent } from './normalize';
import { historyToReplaced, liveProgressFromState } from './integrate';
import { applyRow, invalidateAppliedRow } from './render';
import { ChatMessage, ChatMessageRole, EMPTY_PROGRESS_SNAPSHOT, ProgressSnapshot, WebCompaction, WebIteration } from './chattypes';
import { toHistoryCompactions } from './compaction';
import { normalizeWebIteration } from './agent_normalize';
import { canonicalChatId, channelForChat } from './sessionpick';
import { parseAgentChatID, ParsedAgentChatID } from './sessiongroup';
import { ForkResult, GoalInfo, SearchHit, SessionStatus, TodoItem, TokenUsage, UploadResult } from './types';
import type { GoalInfo as ChatGoalInfo } from './chattypes';
import { normalizeLocale, setLocale, t as i18nT } from './i18n';
import { moveOrders, parseSearchHits, searchBody, SEARCH_LIMIT_DEFAULT, SearchBody, chatSwitchPath, chatSwitchChannel, ChatSwitchResult, parseChatSwitch } from './sessionops';
import { RewindReq, RewindTarget, gapTopBefore, rewindTargetDBID } from './msgops';
import { activeSubAgentNodes, BgTask, CronJob, resolveSessionNode, KillBgTaskParams, RunnerRow, SubAgentRow, subAgentRowOf, isWidgetEvent } from './panels';
import { PromoteShellParams, PromoteShellResult, promoteSessionKey } from './toolshell';
import { TerminalInfo } from './termproto';
import { serverKey, toLocalSettings, KEY_ACCENT } from './settings';
import { setAppAccent } from './theme';
import { FsEntry } from './composer';
import { FsListBody, FsReadResult, FsSearchBody, FsSearchEntry, fsListBody, fsSearchBody } from './files';
import { GenuiShareBody, genuiPanelUrl, genuiShareBody } from './genui';
import { SkillItem, SkillWire, parseSkillList } from './skills';
import { MaxContextParams, RPC_GET_SESSION_SUBSCRIPTION, RPC_GET_USER_MAX_CONTEXT, RPC_LIST_ALL_MODEL_ENTRIES, RPC_SELECT_MODEL, RPC_SET_USER_MAX_CONTEXT, SelectModelParams, RPC_SKILL_GET_CONTENT, RPC_SKILL_LIST, RPC_SKILL_SET_ENABLED, RPC_WEB_PLUGIN_LIST, RPC_GET_AGENT_SESSION_DUMP, RPC_GET_SESSION_MESSAGES, SubAgentHistoryParams, AgentSessionDump, SubAgentMsg, SessionSelectorParams, SessionSubscription, SkillContentWire, SkillGetContentParams, SkillListParams, SkillSetEnabledAck, SkillSetEnabledParams, normalizeMaxContext, readableRpcError, rpc, sessionSubscriptionId } from './rpc';
import {
  PluginCatalog,
  WebPluginListWire,
  buildPluginCatalog,
} from './pluginhost';
import {
  NOTIFY_KIND_NONE,
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_TURN_DONE,
  TURN_DONE_DEDUPE_MS,
  appIsForeground,
  applyNotifyPrefs,
  clearAll,
  clearForChat,
  notifyBody,
  notifyKindForSse,
  notifyTitle,
  noteForegroundSeen,
  publishTurn,
  publishLiveView,
  cancelLiveView,
  shouldNotify,
  withinDedupeWindow,
  stripMarkdownForNotify,
} from './notify';
import {
  AskRespondReq,
  ChannelReq,
  CreateChatReq,
  CronRemoveReq,
  EmptyReq,
  ForkReq,
  FsListReq,
  HistoryReq,
  IterationDetailReq,
  LlmModelReq,
  MaxContextReq,
  MessageReq,
  QueueCancelReq,
  QueueReorderReq,
  RegionsReq,
  RenameReq,
  RpcReq,
  SearchReq,
  SessionReq,
  SettingsReq,
} from './reqbody';
import { LlmConfig, LlmConfigEntries, LlmModelEntry } from './llmfmt';
import {

  AskQuestion,
  AskUserPrompt,
  ChatRow,
  HistoryData,
  HistoryIteration,
  HistoryMessage,
  IterationDetailData,
  PluginPanelInfo,
  ProgressEvent,
  QueueItem,
  QueueListData,
  SessionEvent,
  SessionItem,
  RegionsData,
  SessionTreeData,
  SseEnvelope,
  SseEventType,
  ToolProgress,
  WebPluginInfo,
  WebPluginListData,
} from './types';

/** SSE 意图的竞态窗口（web `useSessionStore.ts` 同值 15s）。 */
const SSE_INTENT_TTL_MS: number = 15000;

/**
 * **全局**（跨 store 实例共享）单调序号 —— 用于生成**全局唯一**的 `requestID`。
 *
 * ⛔ 为什么不能复用 per-store 的 `idSeq`（血债，2026-10-16 用户 P0「有个会话消息根本发不出去」）：
 *   服务端 `dispatchUserMessageOnce`（`channel/web/web_inbound.go:287`）按
 *   `{senderID, channel, chatID, requestID}` **去重**（`inboundRequestRetention = 10min`）——
 *   同一 requestID 在 10 分钟内**第二次**到达会被**静默吞掉**（返回上一次的缓存结果）。
 *   而 per-store 计数器在 **store 重建（池淘汰 / 重启）后重置** ⇒ 同一会话可能再次生成
 *   `req-2` ⇒ 服务端去重 ⇒ **消息未真正发送**（原生乐观行因拿到缓存回执而"看起来成功"，
 *   但 web/DB 都没有）——正是用户症状「原生显示发了、web 显示没发、重开就没了」。
 *   Web 端用 `req-${Date.now()}-${random}`（全局唯一）⇒ 原生对齐。
 */
let globalReqSeq: number = 0;

/** 全局唯一的 requestID（对齐 web `newMessageRequestID`：时间戳 + 序号 + 随机）。 */
function newRequestID(): string {
  globalReqSeq++;
  return `req-${Date.now()}-${globalReqSeq}-${Math.floor(Math.random() * 1000000)}`;
}

export class ChatStore {
  /** resync 重载的最小间隔（ms）——**合并**冗余的 `resync_required`（见 SSE 分支的注释）。 */
  private static readonly RESYNC_MIN_MS: number = 2000;
  /** 静态自增实例号：**只为诊断**（池里每个会话一个 store ⇒ 日志必须能分辨是哪一个）。 */
  private static nextSid: number = 1;
  /** 本实例的实例号（诊断用；见 `[SWITCH]` 日志）。 */
  readonly sid: number = ChatStore.nextSid++;
  /**
   * resync 重载的**合并闸门**（见 SSE `resync_required` 分支）：
   * `resyncAt` = 上次重载时间戳；`resyncInFlight` = 是否正在重载。
   * ⛔ 不合并 ⇒ 大/活跃会话会 `loadHistory` **自触发成环**（实测每 ~230ms 一次）。
   */
  resyncAt: number = 0;
  resyncInFlight: boolean = false;
  http: XbotHttp;
  sse: SseClient;
  channel: string = 'web';

  // ── 会话状态（服务端权威；/api/session/status + 结构化事件里的 goal）──
  /**
   * 会话凭据失效（任何请求或 SSE 返回 401）时回调 —— 页面据此退回登录页。
   * 汇聚点只有这一个：http 与 sse 的 401 都走这里（避免两处各自处理漏掉一个）。
   */
  onAuthExpired: () => void = () => {
  };
  /** 历史是否正在加载（骨架屏判据：只有"还没内容且正在拉"才展示骨架） */
  /** 会话树最近一次拉取时刻（busy 对账的新鲜度判据） */
  sessionsFetchedAt: number = 0;

  /**
   * **SSE 意图时间戳**（web `useSessionStore.ts:1012-1027` 的 `sseIntentsRef` 逐字移植）：
   * SSE 的 busy/idle 只是**有界 15s 竞态窗口提示**；HTTP（session-tree）是**持久权威**。
   * · 新鲜 busy 意图（≤15s）⇒ 可覆盖"矛盾的 HTTP"（刚发送/刚起跑，树数据落后一个 RTT）；
   * · 意图过期或缺失 ⇒ **HTTP 说了算**（保证即使所有 SSE 都丢也能收敛）。
   */
  private intentBusyAt: number = 0;
  private intentIdleAt: number = 0;
  /** 会话树对账轮询句柄（`-1` = 未排程）。 */
  /**
   * 会话代数：**每次 `beginSwitch` 自增**。所有异步回包（history/status/queue/sessions/
   * settings/terminals/subscription）在 await 之后必须比对它（+ currentChatId）——
   * 同一个 ChatStore 可以被重新 open 到另一个 chat（新建/切池），没有代数就会把
   * A 的响应写进 B（跨会话状态污染）。判据：`tools/tests/session_isolation_wiring.test.ts`。
   */
  private chatGen: number = 0;
  /**
   * UI 行重建挂起（滚动/触摸期由页面置 true）。
   *
   * ⛔ 2026-10-17 用户 P0「流式期滚动高度不断抖动」：`rebuildRows` 会把新的 `Row` **就地**写进
   * `rowCache` 里的 `ChatRow`，而该对象已被 `LazyForEach` 的 `MessageRowView` 以 `@ObjectLink`
   * 订阅 ⇒ **绕过了页面的 `syncFrom` 早退**：每帧 SSE 都改一次 content/iterations ⇒ 行高变化 ⇒
   * 用户滚动时高度抖动。修法：滚动/触摸期挂起 `rebuildRows`（状态机照常累加），
   * `onScrollStop/onTouchUp` 恢复后**一次性**重建 + 投影（不丢内容）。
   */
  private uiSuspended: boolean = false;
  private sessionPollTimer: number = -1;
  /** SSE 是否曾 open 过（用于区分"首次连接"与"断线重连"）。 */
  private sseOpenedOnce: boolean = false;
  /** 本次 open 之前是否发生过断线 —— 重连后必须做一次权威历史重载。 */
  private sseHadDisconnect: boolean = false;
  /** 回前台/重连后的权威 resync 节流（避免 onPageShow + onState 双触发打爆 history）。 */
  private lastResumeResyncAt: number = 0;
  /** resume resync 在飞守卫：onPageShow / onAppResumed / SSE reopen 三路只允许一份全量重载。 */
  private resumeResyncInFlight: boolean = false;
  /** 在飞期间到达的 resync 请求排队一次；不得静默丢弃（live-stall / 新迭代都靠它恢复）。 */
  private resumeResyncPending: boolean = false;
  /** resume resync 的 fail-safe 释放定时器（网络挂死也必须恢复 UI 渲染）。 */
  private resumeResyncTimer: number = -1;
  /** 当前在飞的 `/api/history` 所属 chatGen（同一代最多一份，跨代允许切换重载）。 */
  private historyLoadGen: number = -1;
  /** 是否当前页面正在展示这个 store（后台 tab 的 SSE 重连不得触发 history 重载） */
  private resumeActive: boolean = false;

  /** 页面切到/离开本 store 时设置；只有 active store 才允许在 SSE 重连时做 history resync。 */
  setResumeActive(active: boolean): void {
    if (this.resumeActive === active) {
      return;
    }
    this.resumeActive = active;
    if (!active) {
      // 后台 tab 不再持有一条 SSE / 轮询；只保留状态，切回时再订阅。
      try {
        this.sse.close();
      } catch (e) {
        // close 幂等，失败不影响释放语义
      }
      if (this.sessionPollTimer !== -1) {
        clearTimeout(this.sessionPollTimer);
        this.sessionPollTimer = -1;
      }
      return;
    }
    if (this.currentChatId.length > 0) {
      // 切回池里已有会话：openSession 的 alreadyOpen 分支不会再 subscribe，这里补上。
      this.subscribe();
    }
  }
  lastSendAt: number = 0;
  historyLoading: boolean = false;
  /**
   * 最近一次历史加载的**失败原因**（已可读化；空 = 无错）。
   *
   * ⛔ 2026-10-12 P0 根因之一：`loadHistory` 之前**只有 try/finally、没有 catch** ⇒
   *   `/api/history` 失败会**炸穿到调用方**，而调用点是否 catch 并不统一 ⇒ 出现"页面空白、
   *   无任何提示"。失败必须**落地成状态**（页面据此显示可读原因 + 重试），⛔ 不许静默。
   */
  historyError: string = '';
  /** 上次打印 [SWITCH] 日志的 sid —— 避免每帧 rebuildRows 刷屏 */
  private lastLoggedSid: number = -1;
  /** SSE 连接状态（`idle|connecting|open|reconnecting`）——弱网提示用 */
  connState: string = 'idle';
  /**
   * 最近一次插件 widget 事件名与原始载荷（`web_widgets` / `plugin_widgets`）。
   *
   * 为什么在 store 里留这一份：widget 载荷**不是** `DomainEvent`（`core/normalize.ts` /
   * `core/reduce.ts` 都没有 widget 分支）⇒ 若交给状态机只会被**静默丢弃**。这里按
   * **原始串**留存（不解析、不解释），由页面把它喂给 `components/PluginWidgets`
   * （判据在 `core/widgetsview.ets` + `core/pluginview.ets`，组件只画）—— 页面据此渲染 PluginWidgets。
   * 未收到过任何 widget 事件时为空串（组件判 `visible=false` ⇒ 零节点）。
   */
  lastWidgetEvent: string = '';
  lastWidgetContent: string = '';
  /** #7-1（2026-10-17）：bg_task_output 增量的原始串（widget 同款「不解析早退」模式）+ 递增序号（防同串去重失效）。 */
  lastBgOutput: string = '';
  lastBgOutputSeq: number = 0;
  /** LLM 配置（订阅/可选模型/上下文上限；`GET /api/llm-config`） */
  llmConfig: LlmConfig | undefined = undefined;
  /**
   * LLM 配置拉取的**三态**（`idle|loading|ready|error`）—— 模型列表面板据此区分
   * 「加载中」/「加载失败(+重试)」/「已加载但空」。⛔ 旧实现把失败**静默**吞掉 ⇒ 面板只能
   * 永远显示"加载中"（**永久转圈**，用户读不出"是慢还是坏了"）。口径与 `core/llmfmt.ets:modelPanelStatus` 同源。
   */
  llmConfigState: string = 'idle';
  /** 最近一次 LLM 配置拉取的**失败原因**（已可读化；空 = 无错）—— 供模型列表面板的失败态显示。 */
  llmConfigError: string = '';
  /**
   * 当前会话的**订阅显示串**（`get_session_subscription` → `subscription_id`；空串 = 无/未取到）。
   * §会话信息面板据此显示「订阅」行；空串 ⇒ **不显示该行**（web `SessionInfo.tsx:191` 同口径）。
   */
  sessionSubscription: string = '';
  /**
   * **会话级当前模型**（`get_session_subscription.model` 的权威投影）。
   *
   * ⛔ 为什么必须单独存（用户 2026-10-17 亲报「提示成功但后端其实都没切」）：
   *   徽章原先读 `llmCfg.model`（**用户级**配置）⇒ 即便会话切成功，徽章也**不变**
   *   ⇒ 用户看着像"没切"。web 的读法同样是**会话级优先**
   *   （`SessionInfo.tsx:79`：`dump.modelName || sub.model || settings.model`）。
   */
  sessionModel: string = '';
  /**
   * 订阅查询的**三态**（`idle|loading|ready|error`）—— 与 `llmConfigState` 同口径。
   * ⛔ 现仅面板可读；失败态/加载态由 `sessionSubState`/`sessionSubError` 承载（非静默吞）。
   */
  sessionSubState: string = 'idle';
  /** 最近一次订阅查询的**失败原因**（已可读化；空 = 无错）。 */
  sessionSubError: string = '';
  /** token/上下文用量（拿不到就是 undefined，界面不显示、绝不估算） */
  usage: TokenUsage | undefined = undefined;
  /** 工作目录 */
  cwd: string = '';
  /** todos（服务端权威） */
  todos: TodoItem[] = [];
  /** 目标（来自结构化进度事件的 goal） */
  goal: GoalInfo | undefined = undefined;

  sessions: SessionItem[] = [];

  /**
   * AppGallery 审核用**纯本地演示模式**。由登录页 `isDemoLogin()` 打开：
   * 不建 SSE、不发 HTTP、不走真实会话；`send()` 只生成固定演示事件。
   */
  demoMode: boolean = false;
  private demoTurnSeq: number = 1000;
  private demoSeq: number = 1;

  /**
   * 渲染行（`ChatRow`）—— **由状态机派生**，对齐 web `useChatMessages`：
   * `rows = applyRow(deriveRows(state))`。不再手写维护（手写近似 = 全部 bug 的源头）。
   */
  rows: ChatRow[] = [];

  /**
   * 单会话**唯一事实源**：`ChatState`（逐字移植 web `chat/types.ts` / `reduce.ts`）。
   *
   * 所有进度事件经 `normalizeEvent → reduce` 落入它；渲染行由 `deriveRows` 得出、
   * busy 由 AgentPanel 三元公式得出。打开会话时**整体复位**（会话隔离，见 openSession）。
   */
  private state: ChatState = initialChatState('');

  /**
   * 「无法追赶的 gap」重载令牌的**观察点**（web `AgentPanel.tsx:446-462` 的
   * `gapReloadSeenRef` 逐字移植：key 变 ⇒ 只记录；token 变 ⇒ 重载）。
   */
  private gapReloadSeenKey: string = '';
  private gapReloadSeenToken: number = 0;

  /** 行对象缓存（id → ChatRow）——就地更新，保住 @ObjectLink 恒等。 */
  private rowCache: Map<string, ChatRow> = new Map();
  /**
   * live 行缓存的**生命周期键**（turn 代数/迭代号）。
   * ⛔ 行 id 可能跨 turn 复用（缺 turn id 时 `turn-0-live`）；若只按 id 命中 `rowCache`，
   *    新 turn/新迭代会拿到**旧 ChatRow**，`applyRow` 的 `appliedRowByRow` 会误判未变化
   *    ⇒ 新迭代的 reasoning 不落行，页面停在「思考中…」。key 变 ⇒ 删除所有 live 缓存行。
   */
  private liveCacheKey: string = '';

  /** 已拉取的历史消息累积（对齐 web `useChatMessages` 的 messages 数组）——
   *  分页只追加更早段，每次派发 `history_replaced(全量)` 让 reduce 做 merge。 */
  private history: ChatMessage[] = [];

  currentChatId: string = '';

  /** 当前会话的 live 进度快照（对齐 web `liveProgressFromState`）。页面 live 尾块读它。 */
  liveProgress(): ProgressSnapshot {
    return liveProgressFromState(this.state);
  }

  /**
   * **本地乐观清除目标** —— `clear_goal` RPC 成功后由页面调用（对齐 web
   * `web/src/workspace/panels/AgentPanel.tsx:864-874` 的 `goalEditRef.current.commit(null, seq)`）。
   *
   * ⛔ 为什么必须有：服务端**会**推 `{objective:"",status:"cleared"}` 的显式清除标记
   *   （`core/reduce.ts:88-97` 的 goal 三态语义已支持），但**只靠它不行** —— RPC 已成功而
   *   推送延迟/丢失时，界面会一直显示一个**后端已删掉的目标**（用户 2026-10-13 亲报
   *   「goal 的删除按钮点击后前端还显示 goal，虽然后端已经删掉了」）。web 的做法就是
   *   本地先覆盖（乐观），推送到达即同值收敛（幂等）。
   * ⛔ 走 `applySessionFields(s, undefined, null)`（reduce 的**同一个**会话级字段更新器）：
   *   `null` = 显式清除、`undefined` = todos 不动 ⇒ **不另写一套 state 更新语义**。
   * ⚠️ 只在**成功**后调用：失败时保留 banner（配合页面的 toast，用户能分清"没删掉"）。
   */
  clearGoalLocal(): void {
    if (this.state.goal === null) {
      return;
    }
    this.state = applySessionFields(this.state, undefined, null);
    this.onUpdate();
  }

  /**
   * **本地乐观设置/更新目标** —— `set_goal` RPC 成功后由页面调用（与 `clearGoalLocal` 对称）。
   *
   * ⛔ 为什么必须有：服务端在 `set_goal` 成功后**不保证**立即推结构化 progress；只等推送时，
   *   编辑保存后 banner 仍显示旧 objective（用户 2026-10-17 亲报「goal 编辑保存后文字不变」）。
   *   web `AgentPanel.tsx` 的 `goalEditRef.commit(...)` 就是本地先覆盖（推送到达即同值收敛）。
   * ⛔ 走 reduce 的**同一个** `applySessionFields`：不另写 state 更新语义。
   */
  setGoalLocal(objective: string): void {
    const goal: ChatGoalInfo = { objective: objective, status: 'active' };
    this.state = applySessionFields(this.state, undefined, goal);
    this.onUpdate();
  }

  /**
   * 忙碌 —— 逐字对齐 web `AgentPanel.tsx:713` 的三元公式：
   *   `currentSession.running || progressSnapshot.streaming || busyFallback(activeTurn!==null)`
   * 再叠加 AskUser-pending 的互斥（web 同款：等待用户回答时回合是 PAUSED，不得显示 busy）。
   */
  get busy(): boolean {
    const snap: ProgressSnapshot = liveProgressFromState(this.state);
    // ⛔ `activeTurn !== null` **不再**计入 busy：权威 idle 现在只把 live 的
    //   `streaming` 置 false（不再转 frozen/清 activeTurn）⇒ 若仍用 activeTurn
    //   当 busy 兜底，权威 idle 之后会**永久卡 busy**。`snap.streaming` 本身就是
    //   "live turn 仍在产出"的唯一同源判据（EMPTY_LIVE.streaming=true，
    //   任何被应用的事件都会把它恢复 true），足以覆盖 REST ack→turn_started 窗口。
    // ★ 发送意图窗（用户 2026-10-18 P0「有概率发送后不立刻出现思考中」）：
    //   `turn_started`/ack 是网络往返，ack 还可能没有 turn_id；用户点发送后的**本地
    //   即时反馈**不能等它。发送前先置 `intentBusyAt`，get busy 立刻为 true。
    return (this.state.sessionRunning || snap.streaming || this.sendIntentActive()) && this.askUser === null;
  }

  /** 发送意图窗（≤8s）：在 REST ack/turn_started 到达前给 composer/占位符即时反馈。 */
  private sendIntentActive(): boolean {
    return this.intentBusyAt > 0 && Date.now() - this.intentBusyAt < 8000;
  }

  /**
   * 是否已经收到某个 turn 的 finalizer，但还没看到下一个 turn_started。
   *
   * ⛔ 这是「content 后接思考中」在 **排队发送** 场景的漏网之鱼：
   *   旧 `watchBusyWithoutLiveTurn` 用 `sendIntentActive()` 直接豁免所有发送窗口；
   *   但上一 turn 已 `text_final`、用户又发/排队下一条消息时，`sessionRunning`
   *   可能已被乐观置 true，而新 turn 的 `turn_started` 丢失 ⇒ activeTurn=null +
   *   sendIntentActive=true ⇒ 旧守卫直接 return ⇒ 永远不 resync。
   *   只有「刚发送、还没有任何 turn 结束」才允许豁免。
   */
  private finalizedAwaitingTurnStart: boolean = false;

  /** 服务端会话树给出的权威 running（`sessions[i].running`，经 session_running 入状态机）。 */
  get serverRunning(): boolean {
    return this.state.sessionRunning;
  }

  /** 是否有一条在飞的 live turn（会话隔离判据：只读当前 store 的 state）。 */
  hasLiveTurn(): boolean {
    return this.state.activeTurn !== null;
  }

  /** 当前是否有尚未被 ack/turn_started 确认的乐观 user 行（发送中）。 */
  hasSendingUser(): boolean {
    for (let i = 0; i < this.state.pendingUsers.length; i++) {
      if (this.state.pendingUsers[i].sending) return true;
    }
    if (this.state.activeTurn !== null) {
      const t = this.state.turns.get(this.state.activeTurn);
      if (t !== undefined && t.user !== null && t.user.sending) return true;
    }
    return false;
  }

  /** 当前是否持有带产出的 live 行（尾块/占位符让位判据）。 */
  hasLiveRowWithContent(): boolean {
    if (this.state.activeTurn === null) {
      return false;
    }
    const snap: ProgressSnapshot = liveProgressFromState(this.state);
    // ⛔ 必须要求 `streaming`：权威 idle 现在只停流、保留 activeTurn（为了不丢同迭代
    //   后续帧）⇒ 若仍以"有内容"当 busy 信号，idle 之后 composer 会永久显示 cancel
    //   （用户症状：cancel 无效/卡死）。`sessionRunning` 由 `get busy` 单独覆盖。
    if (!snap.streaming) {
      return false;
    }
    return snap.streamContent.length > 0 || snap.reasoningStreamContent.length > 0
      || snap.activeTools.length > 0 || snap.streamingTools.length > 0
      || snap.iterationHistory.length > 0;
  }

  /** 状态机自愈：busy=false 却残留空壳 live turn（迟到的进度事件造的）⇒ 由 reduce 的
   *  idle 分支收尾；此处仅保留旧接口名给页面调用（对齐 web 无此步 —— 见对照表）。 */
  pruneEmptyLiveRowIfIdle(): boolean {
    return false;
  }

  /**
   * **「无法追赶的 gap」⇒ 重新加载该会话**（web `AgentPanel.tsx:446-462` 逐字移植）。
   *
   * ⛔ 2026-10-17 P0（用户亲报）：历史停在 `迭代1 迭代2`、在飞已到 50 时"看起来正常"，
   *   50 一结束合成块消失 ⇒ "又只剩旧窗口"。根因不是判据缺失（`reduce.ts:liveAheadGapSig`
   *   一直在自增 `gapReloadToken`），而是**原生侧 0 消费方**——判据触发、没人重载 ⇒
   *   洞永久补不上（典型"死消费"）。web 侧消费方：`markHistoryStale` + `reset` + `reloadChat`。
   *
   * 计数器语义（与 web 同款）：同一缺口形状只触发一次 ⇒ 不可能重载风暴；
   * 重载后状态机归零（token 回 0），**新的**缺口形状才会再次触发。
   */
  private watchGapReload(): void {
    const key: string = `${this.channel}:${this.currentChatId}`;
    const token: number = this.state.gapReloadToken;
    if (this.gapReloadSeenKey !== key) {
      // 新会话首帧只记录（否则切会话会因历史 token 立刻重载一次）
      this.gapReloadSeenKey = key;
      this.gapReloadSeenToken = token;
      return;
    }
    if (token === this.gapReloadSeenToken) {
      return;
    }
    this.gapReloadSeenToken = token;
    console.debug(`[SESSION_RELOAD] 出现无法追赶的 gap ⇒ 重新加载会话 chat=${this.currentChatId} token=${token}`);
    // ① 丢弃带洞的本地窗口（web `agentChat.reset()` —— 同一出口 `initialChatState`）
    this.resetStateMachine();
    this.state = initialChatState(this.currentChatId);
    this.gapReloadSeenToken = this.state.gapReloadToken;
    this.rebuildRows();
    // ② 权威重载（web `reloadChat()`）；失败态由 `loadHistory` 自身三态暴露，不静默吞
    this.loadHistory().catch(() => {
    });
  }

  /**
   * 不变量：**一个已结束的 turn 不可能继续持有 busy**。
   *
   * `text_final` 是该 turn 的权威 finalizer；如果它结束时 `sessionRunning` 仍为 true，
   * 只允许两种解释：① 服务端已有**下一个** turn（`activeTurn` 指向别的 turn）；
   * ② 前端状态机丢了事件，当前 busy 是幽灵。②不能等下一个 idle/轮询慢慢自愈——
   * 用户看到的就是「回复已经结束，输入框还在转圈/思考中」。这里直接请求一次权威
   * resync（`resyncAfterResume` 自带 in-flight 合并，不会风暴）。
   *
   * ⛔ 不能把「`sessionRunning` 为 true」直接清零：它可能是后一个 turn 的权威 busy；
   * 判据必须是 **结束的 turn 是否仍是 activeTurn（或已无 activeTurn）**。
   */
  private watchTurnEndedWhileBusy(prev: ChatState, next: ChatState, ev: DomainEvent): void {
    if (ev.type !== 'text_final') {
      return;
    }
    if (ev.commandReply === true || !next.sessionRunning) {
      return;
    }
    const ended: TurnID | null = ev.turnID !== null ? ev.turnID : prev.activeTurn;
    if (ended === null) {
      return;
    }
    // 已有后续 turn 占有 busy（activeTurn 指向另一个 turn）⇒ 合法。
    if (next.activeTurn !== null && next.activeTurn !== ended) {
      return;
    }
    log('resync', `turn 已结束但仍 busy chat=${this.currentChatId} turn=${String(ended)} active=${String(next.activeTurn)}`);
    this.resyncAfterResume('turn-end-while-busy', true);
  }

  /**
   * 兜底不变量：**busy=true 时必须有 live turn 承载它**。
   *
   * 用户 2026-10-20 原话：「一个 turn 已经结束了，会话还是 busy ⇒ 一定要 resync；
   * busy 只能是之后的 turn。」若 finalizer/事件丢失导致 `sessionRunning` 残留，
   * `activeTurn` 已为 null（或指向 committed/frozen）⇒ 本地没有任何 turn 能解释
   * 这个 busy ⇒ 请求权威 history 校准。
   *
   * ⛔ 发送意图窗内 activeTurn 尚未由 turn_started 建立，这是合法的本地反馈，
   * 不能 resync（否则每次发送都会多打一次 history）。
   */
  private watchBusyWithoutLiveTurn(next: ChatState): void {
    if (!next.sessionRunning) {
      // ⛔ 不能在这里清 `finalizedAwaitingTurnStart`：排队发送会先发 `user_sent`，
      //   此时 `sessionRunning` 仍为 false；若清掉，紧接着 ack 的
      //   `session_running(true)` 就被 sendIntentActive 豁免吞掉 ⇒ 永不 resync。
      //   只在权威 `turn_started` / `session_running(false)` 时清（见 settle）。
      return;
    }
    // 普通发送窗（还没有任何 turn 结束）是合法的本地即时反馈；但**上一 turn 已
    // finalizer、用户又发/排队下一条消息**时不能豁免——截图里的「content 后思考中」
    // 正是这个状态：sessionRunning=true + activeTurn=null + sendIntentActive=true。
    if (this.sendIntentActive() && !this.finalizedAwaitingTurnStart) {
      return;
    }
    let hasLive: boolean = false;
    if (next.activeTurn !== null) {
      const t = next.turns.get(next.activeTurn);
      // ⛔ 只有**仍在 streaming** 的 live turn 才能解释 busy；`session_idle`/
      //   `session_running(false)` 只停流、保留 activeTurn（为了不丢同迭代后续帧），
      //   若这里把“live 但已停流”也算作有效 busy，turn 已结束却仍 busy 的幽灵
      //   会再次出现（用户 2026-10-20 亲报）。
      hasLive = t !== undefined && t.phase.kind === 'live' && t.phase.data.streaming === true;
    }
    if (!hasLive) {
      log('resync', `会话 busy 但没有 live turn chat=${this.currentChatId} active=${String(next.activeTurn)}`);
      this.resyncAfterResume('busy-without-live-turn');
    }
  }

  /** 把一批 DomainEvent 依次喂给状态机，然后重建渲染行。 */
  private pushEvents(evs: readonly DomainEvent[] | null): void {
    if (evs === null) {
      return;
    }
    let next: ChatState = this.state;
    let lastEndedTurn: TurnID | null = null;
    for (let i = 0; i < evs.length; i++) {
      const prev: ChatState = next;
      this.settleIntentOnAuthoritative(evs[i]);
      next = reduce(next, evs[i]);
      // 记录本批最后一个 turn finalizer；最终统一用 next 的 activeTurn 判定
      // 「busy 是否属于后续 turn」，避免一批里 turn A 结束 + turn B 启动时误 resync。
      // ⛔ 必须先落成局部变量：`evs[i]` 的重复索引访问在 TS 里不做判别联合收窄。
      const ev: DomainEvent = evs[i];
      if (ev.type === 'text_final' && ev.commandReply !== true) {
        lastEndedTurn = ev.turnID !== null ? ev.turnID : prev.activeTurn;
      }
    }
    this.state = next;
    this.rebuildRows();
    if (lastEndedTurn !== null && next.sessionRunning
      && (next.activeTurn === null || next.activeTurn === lastEndedTurn)) {
      log('resync', `turn 已结束但仍 busy chat=${this.currentChatId} turn=${String(lastEndedTurn)} active=${String(next.activeTurn)}`);
      this.resyncAfterResume('turn-end-while-busy', true);
    }
    this.watchBusyWithoutLiveTurn(next);
    // ⛔ 洞检测的**唯一消费点**（见 `watchGapReload`）
    this.watchGapReload();
  }

  /** 单事件便捷。 */
  private pushEvent(ev: DomainEvent): void {
    const prev: ChatState = this.state;
    this.settleIntentOnAuthoritative(ev);
    this.state = reduce(this.state, ev);
    this.rebuildRows();
    this.watchTurnEndedWhileBusy(prev, this.state, ev);
    this.watchBusyWithoutLiveTurn(this.state);
    // ⛔ 洞检测的**唯一消费点**（见 `watchGapReload`）
    this.watchGapReload();
  }

  /**
   * 发送意图窗（8s）只用于 ack/turn_started 到达前的本地反馈；**任何权威回合事件**
   * 都必须终止它，否则 ack 里续期后 turn 在 8s 内收尾 ⇒ busy 幽灵（页面显示思考中）。
   */
  private settleIntentOnAuthoritative(ev: DomainEvent): void {
    if (ev.type === 'turn_started') {
      // 新 turn 真正开始了：之前 finalizer 留下的“等待新 turn”窗口结束。
      this.finalizedAwaitingTurnStart = false;
      this.intentBusyAt = 0;
      return;
    }
    if (ev.type === 'text_final') {
      // 正常 turn 的权威收尾。命令回复（commandReply）不属于 turn 生命周期。
      if (ev.commandReply !== true) {
        this.finalizedAwaitingTurnStart = true;
      }
      this.intentBusyAt = 0;
      return;
    }
    if (ev.type === 'phase_done') {
      this.intentBusyAt = 0;
      return;
    }
    if (ev.type === 'session' && ev.busy === false) {
      this.finalizedAwaitingTurnStart = false;
      this.intentBusyAt = 0;
    }
  }

  /** `ChatState → rows`：`deriveRows` + 就地适配（对象恒等）。 */
  /** 使 live 行的 applied-Row 缓存失效；**保留 ChatRow 身份**（删对象会破坏 LazyForEach 同键渲染）。 */
  private invalidateLiveRowCache(): void {
    this.rowCache.forEach((r: ChatRow) => {
      if (r.isLive) {
        invalidateAppliedRow(r);
      }
    });
  }

  private rebuildRows(): void {
    // ⛔ 滚动/触摸期挂起：状态机继续累加，但**不碰** `rowCache` 里的 ChatRow（@ObjectLink
    //   会绕过页面 syncFrom 早退，每帧改 content/iterations ⇒ 行高抖动）。恢复时一次重建。
    if (this.uiSuspended) {
      return;
    }
    const derived: readonly Row[] = deriveRows(this.state);
    // ⛔ live 行缓存的 key 必须含 turn/iteration 生命周期：行 id 会跨 turn 复用，
    //    只按 id 命中会让新迭代拿到旧 ChatRow（appliedRowByRow 误判）⇒ 思考中卡死。
    let liveCacheKey: string = '';
    for (let i = 0; i < derived.length; i++) {
      const dr: Row = derived[i];
      if (dr.kind === 'live') {
        liveCacheKey = `${this.state.turns.size}#${dr.turnID}#${dr.lastIter}`;
        break;
      }
    }
    if (liveCacheKey !== this.liveCacheKey) {
      this.liveCacheKey = liveCacheKey;
      this.invalidateLiveRowCache();
    }
    const next: ChatRow[] = [];
    const alive: Set<string> = new Set();
    // ⛔ **行 id 必须唯一**（血债，2026-10-12 真机 P0）：ArkUI 的 `ForEach`/`LazyForEach` key 一旦重复
    //    会抛**应用级错误** `Ids generated by the ForEach id gen function must be unique`
    //    ⇒ **该列表子树整体不渲染** ⇒ 切到这种会话就是**白屏**（`hilog` 实证：`AceStateMgmt` 报
    //    `Duplicated index: [45,273,316,...]`、`AceLazyForEach: Use repeat key for index: 7/9/10`）。
    //    来源：派生行 id 是 `turn-${t.id}`（/`-live`/`-c`）形状 —— **两个 turn 的 id 相同**
    //    （历史里缺 turn id ⇒ 都是 0）时同 id ⇒ `rowCache.get(同 id)` 拿到**同一个对象被 push 两次**
    //    ⇒ LazyForEach key 重复。⇒ 这里给**重复出现的** id 补序号：首个仍是规范 id（既有
    //    `rowById`/导航锚点照常命中），只有病态重复项被改名（它们本就没有合法身份）。
    const seenIds: Set<string> = new Set();
    for (let i = 0; i < derived.length; i++) {
      const r: Row = derived[i];
      let rid: string = r.id;
      if (seenIds.has(rid)) {
        let n: number = 2;
        let cand: string = `${rid}~${n}`;
        while (seenIds.has(cand)) {
          n = n + 1;
          cand = `${rid}~${n}`;
        }
        rid = cand;
      }
      seenIds.add(rid);
      alive.add(rid);
      let row: ChatRow | undefined = this.rowCache.get(rid);
      if (row === undefined) {
        row = new ChatRow();
        row.id = rid;
        this.rowCache.set(rid, row);
      }
      const changed: boolean = applyRow(row, r);
      if (changed) {
        this.touch(row);
      }
      next.push(row);
    }
    // 淘汰已消失的行（turn 被删/切会话）
    if (this.rowCache.size > alive.size) {
      const stale: string[] = [];
      this.rowCache.forEach((_v: ChatRow, k: string) => {
        if (!alive.has(k)) {
          stale.push(k);
        }
      });
      for (let i = 0; i < stale.length; i++) {
        this.rowCache.delete(stale[i]);
      }
    }
    this.rows = next;
    this.onUpdate();
    // ⛔ 切会话诊断：只在真正切会话时打日志，避免 rebuildRows 每帧刷屏淹没关键日志
    if (this.sid !== this.lastLoggedSid) {
      console.debug(`[SWITCH] loaded sid=${this.sid} chatId=${this.currentChatId} channel=${this.channel} rows=${this.rows.length} histErr=${this.historyError}`);
      this.lastLoggedSid = this.sid;
    }
  }

  /** 清空行缓存（切会话 / 整体复位时）。 */
  private resetRows(): void {
    this.state = initialChatState(this.currentChatId);
    this.rowCache = new Map();
    this.rows = [];
  }

  /** 历史分页（loadMore 游标） */
  hasMore: boolean = false;
  oldestId: number = 0;
  loadingMore: boolean = false;
  /**
   * `loadMore` 的**真结果**（空串 = 无错误；`LOADMORE_ERR_NOCURSOR` = 游标失效；其余 = 可读原因）。
   *
   * ⛔ 为什么必须有（2026-10-15 用户亲报「加载不出更早」）：旧实现的三道闸门
   *    （`!hasMore || loadingMore || oldestId <= 0`）**全部静默 `return`**，且请求失败**无 catch**
   *    （异常直接抛进 `onScrollIndex` 回调、无人接）⇒ 头部提示仍写着「下拉到底部自动加载更早消息」
   *    （它按 `hasMore` 渲染）而列表**永远不动、零反馈**。真结果必须落成可读字段
   *    （页面据此 toast + 自愈），⛔ 绝不静默。
   */
  loadMoreErr: string = '';

  /** 待回答的 AskUser（服务端权威：每会话至多一个） */
  askUser: AskUserPrompt | null = null;

  /**
   * **已答/已取消**的那个 AskUser 的 `request_id`（闪回防线）。
   *
   * ⛔ 用户亲报（2026-10-16）：「ask user **提交或者 cancel 后必须立刻消失**，现在消失了**还会出现一瞬间**，
   *    严重 bug」。根因有两层，缺一不可：
   *   ① 清除时机：旧实现 `await POST` 之后才清 ⇒ 往返期间面板仍在；
   *   ② **回填**：往返期间任何在途 progress 载荷都带同一个 pending 问题 ⇒
   *      `pickAskUserFromProgress` 把它**写回** `askUser` ⇒ 面板"消失又冒出来一下"。
   *   ⇒ 记下刚答过的 `request_id`，服务端在收尾期重发**同一问题**时一律**不弹**；
   *     模型随后问**新**问题（新 `request_id`）时照常弹（⛔ 不靠时间窗，靠身份）。
   */
  private answeredAskId: string = '';

  /** 待发队列 */
  queue: QueueItem[] = [];
  /**
   * 行 id 的单调计数器。
   *
   * ⛔ 必须全局唯一：`ForEach` 的 key 一旦重复，ArkUI 会复用/错位组件 —— 表现就是"整个渲染错乱"
   * （与 Web 端 React 重复 key 的 #185 同源）。原先 id 由 消息id / turnID / Date.now() 拼接，
   * 跨命名空间会撞（`a-<消息id>` vs `a-<turnID>`），同一毫秒连发两条也会撞 ⇒ 统一用计数器。
   */
  private idSeq: number = 1;

  /** 标记行内容已变（ForEach key 随 rev 变化 ⇒ 强制重建该项，避免显示陈旧内容）。 */
  private touch(row: ChatRow): void {
    row.rev = row.rev + 1;
  }

  private nextRowID(prefix: string): string {
    this.idSeq++;
    return `${prefix}-${this.idSeq}`;
  }


  /** 变更通知（页面接到 @State 上） */
  onUpdate: () => void = () => {
  };

  constructor(baseUrl: string) {
    this.http = new XbotHttp(baseUrl);
    this.sse = new SseClient(baseUrl);
    this.sse.onState = (state: string) => {
      this.connState = state;
      // 应用日志（用户要求）：连接态变化是排障第一条线索（重连风暴 / 静默死一眼可辨）。
      log('sse', state);
      if (state !== 'open' && this.sseOpenedOnce) {
        this.sseHadDisconnect = true;
      }
      if (state === 'open') {
        const reconnected: boolean = this.sseHadDisconnect;
        this.sseOpenedOnce = true;
        this.sseHadDisconnect = false;
        // 重连后必须对账：断线期间可能错过 idle/busy 事件（错过 idle ⇒ 永远"运行中"）
        // ⛔ 不能先 loadSessions 再 resyncAfterResume：后者内部**已经**先 loadSessions
        //    ⇒ 同一轮重连打两次会话树（resume 预算 = 最多一次 reopen 的成本）。
        if (reconnected && this.resumeActive) {
          // 断线期间还可能错过**已完成的通知/回合**（SSE ring 淘汰后仅靠 session-tree
          // 不会带消息正文）⇒ 重连后必须做一次权威 history 重载，不能只看连接状态。
          // ⛔ 只有当前展示中的 store 才做：后台 tab 的 store 也会重连，N 个 store
          // 同时 loadHistory 会在 UI 线程上解析 N 份大历史 ⇒ 恢复休眠时整页冻死
          //（用户 2026-10-19 实测）。后台 store 切回来时 openSession 会自己加载。
          // 重连是状态可能已分叉的边界：不能被 1.2s 节流吞掉（否则只更新
          // session-tree，正文/live 永远不重新对齐）。
          this.resyncAfterResume('sse-reopen', true);
        } else {
          this.loadSessions().catch(() => {
            // 对账失败不影响连接本身
          });
        }
      }
      this.onUpdate();
    };
    // 会话凭证失效（任何请求/SSE 401）⇒ 同时清掉通知与角标：
    // 通知内容属于一个**已经进不去的会话**（点它只会再吃一次 401），且登出后也不该留未读提醒。
    const onExpired = () => {
      clearAll();
      this.onAuthExpired();
    };
    this.sse.onUnauthorized = () => {
      onExpired();
    };
    this.http.onUnauthorized = () => {
      onExpired();
    };
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────

  /**
   * `loadSessions` 的**并发去重**底座（2026-10-17 P0-B）：快速频繁切会话 ⇒ 多个 openSession
   * 并发进 `loadSessions` ⇒ N 个重复 `/api/session-tree` 请求在飞（模拟器 relay backlog=8
   * 易被打满 ⇒ 请求挂死）+ 响应乱序互相覆盖。in-flight 复用：先到的请求挂 Promise，后到者
   * 直接 await 同一份；成败都会清 inflight（失败绝不缓存 ⇒ 下次重试是新请求）。
   */
  private sessionsInflight: Promise<SessionTreeData> | null = null;

  private fetchSessionsOnce(): Promise<SessionTreeData> {
    if (this.sessionsInflight !== null) {
      return this.sessionsInflight;
    }
    const p: Promise<SessionTreeData> = this.http.postAs<SessionTreeData>('/api/session-tree', new EmptyReq());
    this.sessionsInflight = p.then((d: SessionTreeData): SessionTreeData => {
      this.sessionsInflight = null;
      return d;
    }).catch((e: Object): Promise<SessionTreeData> => {
      this.sessionsInflight = null;
      throw e as Error;
    });
    return this.sessionsInflight;
  }

  /** 打开 AppGallery 本地演示模式（不连任何真实服务端）。 */
  enableDemo(): void {
    this.demoMode = true;
    this.sessions = demoSessions();
    this.onUpdate();
  }

  async loadSessions(): Promise<void> {
    if (this.demoMode) {
      this.sessions = demoSessions();
      this.onUpdate();
      return;
    }
    // 会话代数 + 身份快照：await 期间 store 可能被重开到另一个 chat（新建/池 rekey）⇒
    // 旧会话树的 running/subagents 绝不能写进新会话（会冻结新会话在飞的 turn）。
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    const forChannel: string = this.channel;
    const data: SessionTreeData = await this.fetchSessionsOnce();
    if (gen !== this.chatGen || forChat !== this.currentChatId) {
      return;
    }
    // sessions/chats 同为服务端返回 ⇒ 均可能为 null（曾 `sessions !== undefined && sessions.length` 崩溃）。
    const sessionList: SessionItem[] = arrOrEmpty(data.sessions);
    const list: SessionItem[] = sessionList.length > 0 ? sessionList : arrOrEmpty(data.chats);
    this.sessions = list;
    // 子代理 = **当前会话节点的 children**（只取活跃者）—— web `TasksPanel.tsx:36-40` 同源。
    //  ⛔ 15h 实锤（用户「任务管理做的很差」的第二处）：旧实现取 `orphan_subagents`（孤立根），
    //     而后端对当前会话**恒返回 `null`** ⇒ 面板「子代理」tab **结构性永远空**；
    //     web 列的是当前会话的子代理树（后端实测 `harmony-ui-dev` 有 19 个 `type=agent` 子项）。
    //  ⚠️ 服务端 Go 的 nil slice → JSON `null` ⇒ 一律 `arrOrEmpty`/三态取值（历史 P0 形态）。
    //  ⚠️ 必须在 `list` 声明**之后**（否则 TS2448 块级变量先用后声明 —— 本轮编译真红过）。
    //  ⛔ 用**规范化**解析器（`resolveSessionNode`）而非按原值精确比对：会话树实测同时给出
    //     「幽灵行」（`chat_id='web:chat_X'`、`children=0`）与「真身行」（`chat_id='chat_X'`、
    //     `children=19`），而本仓 `currentChatId` 是全键 ⇒ 精确比对**恰好命中幽灵** ⇒ 本 tab 恒空。
    const node: SessionItem | null = resolveSessionNode(list, this.channel, this.currentChatId);
    const actives: SessionItem[] = activeSubAgentNodes(node);
    const subs: SubAgentRow[] = [];
    for (let i = 0; i < actives.length; i++) {
      subs.push(subAgentRowOf(actives[i]));
    }
    this.subagents = subs;
    // 会话树的 `running` 是服务端权威忙碌标记 —— 本地 busy 只是 SSE 事件的快路径，
    // 错过一条 idle（断线重连/切后台）就会永远显示"运行中"。每次拉到会话树都对账一次。
    // 例外：刚发送的 3 秒内不对账（乐观 busy 先行，服务端标记 running 有一个 RTT 窗口）。
    this.sessionsFetchedAt = Date.now();
    // ⛔ 会话树的 `running` 是**服务端 reconcile 后的权威**忙态（对齐 web
    //   `AgentPanel.tsx:433` `sessionRunning: currentSession?.running ?? false`）。
    //   它经状态机 `session_running` 事件落进 `state.sessionRunning`：
    //     · running=true  ⇒ 只更新闸门（迟到的 coarse idle 不得冻结在飞 turn）；
    //     · running=false ⇒ 把仍在 live 的 turn 定格收尾（内容保留，绝不 wipe）。
    //   busy 本身由 AgentPanel 三元公式**计算**（get busy），不再在此手写对账 ——
    //   手写"对账窗口"正是「busy 残留 / 切会话几秒不对」的根源（真机 2026-10-10）。
    //  ⛔ 与子代理同一解析器（`resolveSessionNode`）：按原值精确比对会命中幽灵行
    //     （`running` 字段缺失 ⇒ 恒 false）⇒ 真身 `running=true` 永远丢。
    const runNode: SessionItem | null = resolveSessionNode(list, this.channel, this.currentChatId);
    // ⛔ 2026-10-17 P0（用户亲报「busy 会话时不时变 idle 又迅速变回 busy + 历史消息闪烁」）：
    //    服务端 /api/session-tree 实测不回 running 字段（curl 全文 0 次）——
    //    runNode.running === true 对 undefined 恒 false ⇒ 每次 loadSessions 都发
    //    session_running(false) ⇒ 状态机把仍 live 的 turn 定格（行键变整行重建）⇒
    //    下一帧 SSE delta 又翻回 busy ⇒ 双重翻转 = 闪烁。修：字段缺失 ≠ false——
    //    只有服务端显式给出 boolean 才对账；缺失 ⇒ 跳过（SSE session(idle) 是唯一 idle 来源）。
    // ⛔ 2026-10-17 P0（用户亲报「卡在 busy 态」）——上一版这里写的是
    //    `typeof runNode.running === 'boolean'` 才对账（把"缺字段"当 unknown 跳过），
    //    但**服务端 `/api/session-tree` 的 `running` 是 `omitempty`**（实测：running 行有
    //    `running:true`，idle 行**没有该字段**）⇒ 缺字段**就是 false**（AGENTS.md 已记此契约）。
    //    按旧写法 ⇒ idle 永远灌不回去 ⇒ 一旦某条 idle 被闸门挡掉/丢失 ⇒ **busy 永久卡住**
    //    （截图实证：最后工具已完成，界面还挂「思考中…」+ 输入框排队）。
    //    对齐 web：HTTP 是权威（缺字段=false），但**新鲜 busy 意图(≤15s)** 可覆盖矛盾的 HTTP
    //    （刚发送时树数据落后一个 RTT ⇒ 否则会"刚发就变 idle"再翻回 = 闪烁）。
    if (runNode !== null) {
      // ⛔ 判据收敛到 `core/streammerge.runningAfterReconcile`（与状态机同源、可脱机单测）。
      //    服务端 `running` 是 omitempty ⇒ 缺字段**就是 false**（已折好再传入）。
      this.pushEvent({
        type: 'session_running',
        running: runningAfterReconcile(runNode.running === true, this.intentBusyAt,
          this.intentIdleAt, Date.now(), SSE_INTENT_TTL_MS),
      });
    }
    this.onUpdate();
  }

  /**
   * 权威 idle 的**本地落点**（逐字移植 web `agent-idle` → `useSessionStore.setStatus(selector,'idle')`）。
   *
   * 为什么必须本地置位、不能只靠 REST 对账：web 权威明确 —— `session(idle)` 与 PhaseDone
   *   都在**内存里**把会话标记 idle（`useSessionStore.ts:1697` 原文 *"Don't call refresh() here
   *   — it causes a race where the HTTP response (which may be stale) overwrites the SSE-driven
   *   status"*）。原生此前只发 REST `loadSessions()` ⇒ `serverRunning()` 要等一个往返才转 false
   *   ⇒ composer 的 busy 拖后（用户 2026-10-12：*"iter 结束如果最后没 tool … 应该立刻进入
   *   idle"*）。
   *
   * 两个动作**同帧**：
   *   ① 会话树内存置位（`running=false`）⇒ 页面 `serverRunning()/freshServerRunning` 立即转
   *      false（`fingerprintSessions` 含 running ⇒ 页面下一帧即同步；`busyNow` 的四路 OR 少一路）；
   *   ② 状态机 `session_running(false)` ⇒ 清权威闸门 + 把仍 live 的 turn **定格收尾**
   *      （`reduce.ts:515-533`：activeTurn=null、内容保留、streaming=false）。
   *
   * 幂等：会话树已 false + `sessionRunning` 已 false 时，reduce 返回原 state（零渲染变化）。
   */
  private applyLocalIdle(chatId: string, authoritative: boolean = false): void {
    // ② SSE 意图：idle 证据时刻（对账时用于压住"矛盾的旧 busy"）
    log('idle', `回合结束 chat=${chatId} 权威=${authoritative ? 'PhaseDone' : 'SSE idle'}`);
    // ⛔ 非权威（coarse `session(idle)` / `agent-idle`）且状态机**仍认为会话在跑 + 有 live turn**
    //   ⇒ 这条 idle 陈旧/错传 ⇒ **绝不**冻结在跑 turn（对齐 reduce `session_idle` 的
    //   `if (s.sessionRunning) return s` 闸门）。本函数此前走了**唯一没闸门**的
    //   `session_running(false)` 分支 —— 正是用户 2026-10-16 P0「长工具被误标失败 / 迭代整行
    //   消失」的根因：冻结后 `foldInFlightToIterations` 把在飞工具标 `error`，下一条事件又提回 live。
    //   权威路径（本帧 `hasFreshPhaseDone` 命中，已按 turnID 归属校验）才允许即刻收尾。
    if (!authoritative && this.state.sessionRunning && this.state.activeTurn !== null) {
      return;
    }
    // ⛔ 只有**真正被接受**的 idle 才写意图窗口：写在闸门之前会让一条被拒绝的陈旧 idle
    //   污染 `runningAfterReconcile`（下一轮对账把 running 判 false ⇒ 短暂假 idle 再翻回）。
    this.intentIdleAt = Date.now();
    // ⛔ ArkTS 禁对象展开（`arkts-no-spread`，门禁 ④ 实测抓到 `store.ets` 的对象字面量展开）
    //    ⇒ 原地改字段（`SessionItem` 字段可写）。页面按 `fingerprintSessions`（含 running）
    //    的**值**变化识别 ⇒ `this.sessions = store.sessions.slice()` 换新数组引用 ⇒ 重渲。
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].chat_id === chatId && this.sessions[i].running === true) {
        this.sessions[i].running = false;
      }
    }
    // pushEvent → rebuildRows → onUpdate（页面据此同步会话树 + 行）。
    this.pushEvent({ type: 'session_running', running: false });
  }

  /**
   * 新建会话（web `useSessionStore.ts:1451-1485`）。
   *
   * `label` 可选：**空/未给 ⇒ 不发 label 字段**（服务端自动生成，与本改动前的行为逐字节一致）；
   * 非空 ⇒ 透传（web `NewSessionDialog.tsx:54` 的同口径：`label.trim() || undefined`）。
   * 判据见 `tools/tests/parity_defer.test.ts`（加性：零参调用仍成立）。
   */
  async createSession(label?: string): Promise<void> {
    const created: SessionItem = await this.http.postAs<SessionItem>(
      '/api/chats/create', new CreateChatReq(label));
    await this.loadSessions();
    // ⚠️ 外来 JSON：字段可能是 null（服务端 nil → null）⇒ 三态判空，否则 `.length` 会炸
    const newId: string | null | undefined = created.chat_id;
    if (newId !== undefined && newId !== null && newId.length > 0) {
      await this.openSession(newId, this.channel);
    }
  }

  // ── P8 面板数据（定时任务 / 后台任务 / Runner；子代理取会话树） ──────────────

  /** 定时任务（`POST /api/cron/list` → `{tasks}`） */
  cronTasks: CronJob[] = [];
  /** 后台 shell 任务（`POST /api/tasks/list` → `{background_tasks}`） */
  bgTasks: BgTask[] = [];
  /** 终端（PTY）列表（`POST /api/terminal/list` → `{terminals}`）。 */
  terminals: TerminalInfo[] = [];
  /** 受管机器（RPC `runner_list` → `{runners}`；凭据绝不下发） */
  runners: RunnerRow[] = [];
  /** 子代理（会话树的 orphan_subagents） */
  subagents: SubAgentRow[] = [];

  /**
   * 用户设置（服务端权威；键为**本地键名**）。
   * `POST /api/settings`（空体）→ `{settings:{服务端键:值}}` ⇒ `toLocalSettings` 本地化。
   */
  settings: Record<string, string> = {};
  /**
   * 单会话主题回退 p0（2026-10-17 用户亲报「切部分会话突然变回深色，只有那个会话深色，
   * 开设置又变浅」）：settings 副本是否经 loadSettings 确认——新建/切身份时 false
   *（旧缓存不算数），loadSettings 完成才 true。页面主题块只信 fresh 的 settings
   *（旧深值不再覆盖全局 themeName——此前只治了「空串」没治「旧值」，:2213 注释的
   * 2026-10-13 同症状修复的补刀）。
   */
  settingsFresh: boolean = false;

  async loadSettings(): Promise<void> {
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/settings', new EmptyReq());
    if (gen !== this.chatGen || forChat !== this.currentChatId) {
      return;
    }
    const srv: Object | undefined = raw['settings'];
    // 服务端 nil map → JSON null；只判 undefined 会把 null 交下去（toLocalSettings(null) 崩）。
    const map: Record<string, string> = isPresent(srv) ? srv as Record<string, string> : {};
    this.settings = toLocalSettings(map);
    // 服务端设置里的语言是权威：启动/刷新设置时同步运行时语言（与 web `xbot-locale` 同键）。
    setLocale(normalizeLocale(this.settings['xbot-locale']));
    this.settingsFresh = true;
    this.syncAppAccent();
    this.syncNotifyPrefs();
    this.onUpdate();
  }

  /**
   * 把 settings 里的强调色同步给 `core/theme` 的**应用级覆盖**。
   *
   * 为什么在这里（2026-10-11 真机实证「强调色全局空操作」的修复）：
   *   `paletteOf(theme)` 是**唯一取色入口**，40 个组件共 80 处都走它；而"强调色叠加"此前只发生在
   *   `pages/Index.ets` 的 `pal()` 里 ⇒ 组件（含设置面板自身）拿不到 ⇒ 标签写 `湖蓝`、按钮仍是主题紫。
   *   现在覆盖值随 settings 落到 `core/theme`，`paletteOf` 据此自动叠加 ⇒ **全站一致**。
   * ⛔ 组件不得直接调 `setAppAccent`（唯一写入点 = 这里）。
   */
  private syncAppAccent(): void {
    const v: string | undefined = this.settings[KEY_ACCENT];
    setAppAccent(v !== undefined ? v : '');
  }

  /**
   * 把 settings 里的通知偏好同步给 `core/notify` 的**模块级缓存**（`applyNotifyPrefs`）。
   *
   * 为什么必须有它（2026-10-11 同批审计钓出，**与强调色同一类缺陷**）：
   *   `core/notify.ets` 的 `shouldNotify`（`:458`）与出通知正文的 `notifyBodyPlan(..., currentPrefs.detail)`
   *   （`:1035`）**都只读模块级 `currentPrefs`**；而它唯一的写入入口 `applyNotifyPrefs` 交付时写着
   *   "由页面在设置加载/变更时调用（**本文件不碰 UI**）" —— **那个接线从未发生**（全仓 0 调用）
   *   ⇒ `currentPrefs` 恒为 `notifyPrefsFrom({})` ＝**三类开关全开**，用户在设置里关掉
   *   「收到提问时通知 / 回合完成时通知 / 通知显示回复内容」**全都不生效**（死开关）。
   *   现在改在**settings 唯一落点**（本方法，与 `syncAppAccent` 同址）下沉 ⇒ 无需页面记得调。
   */
  private syncNotifyPrefs(): void {
    applyNotifyPrefs(this.settings);
  }

  /** 保存若干设置项（本地键 → 服务端键后批量写；本地缓存同步更新，界面立即生效）。 */
  async saveSettings(pairs: Record<string, string>): Promise<void> {
    const srv: Record<string, string> = {};
    const keys: string[] = Object.keys(pairs);
    for (let i = 0; i < keys.length; i++) {
      const k: string = keys[i];
      srv[serverKey(k)] = pairs[k];
      this.settings[k] = pairs[k];
    }
    this.syncAppAccent();
    this.syncNotifyPrefs();
    const body: SettingsReq = new SettingsReq(srv);
    await this.http.post('/api/settings', body);
    this.onUpdate();
  }

  /**
   * 切**当前会话**的模型（RPC `select_model`）——对齐 web `ModelSelector.handleSelect`
   * （`ModelSelector.tsx:73` → `api.ts:796 selectModel`）。
   *
   * ⛔ 2026-10-17 P0 修复：旧实现打 `POST /api/llm-config {action:'set_model'}`，
   *    那条路由只在 `channel/web/web.go:918` 注册为**配置 upsert**、不认 `action`
   *    ⇒ 请求 200 但**什么都没切**（用户亲报「所有会话里切换模型都是无效的」）。
   *    正解是 RPC `select_model {sub_id, model, chat_id, channel}` —— 服务端按
   *    (channel, chat_id) 落到该会话；`chat_id` 缺失会被服务端直接拒。
   * 切换后刷新 llm 配置与用量（模型名显示 = `currentModelText(llmCfg, modelText(usage))`）。
   */
  async setModel(subId: string, model: string): Promise<void> {
    const chatId: string = this.currentChatId;
    await rpc<void>(this.http, RPC_SELECT_MODEL,
      new SelectModelParams(subId, model, chatId, this.channel));
    await this.loadLlmConfig();
    await this.loadStatus();
    // ⛔ 会话订阅（含 `model`）**必须**一起刷：徽章的权威源是它（见 `sessionModel` 注释）
    await this.loadSessionSubscription();
    this.onUpdate();
  }

  /**
   * 列目录（`POST /api/fs/list {path, show_hidden?}` → `{entries:[{name,isDir,size,mode,modTime}]}`）。
   * 输入框 `@` 文件补全用；文件管理面板用（`showHidden` 来自面板的隐藏文件开关）。
   * 服务端已做路径安全校验（resolveSafePath）。
   *
   * ⛔ 请求体由 `core/files.ets:fsListBody` **单点**构造（键名 `show_hidden` 与服务端 query 键
   *    `showHidden` 的驼峰/下划线差异是 footgun，见该函数注释）。
   */
  async listFs(path: string, showHidden: boolean = false): Promise<FsEntry[]> {
    const body: FsListBody = fsListBody(path, showHidden);
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/fs/list', body);
    const arr: Object | undefined = raw['entries'];
    return arrOrEmpty(arr as FsEntry[]);
  }

  /**
   * 读文件（`POST /api/fs/read {path}` → `{content,language,size,isBinary,encoding?}`）。
   *
   * 权威契约 = 服务端 `channel/web/web_fs.go:fsReadResponse`（⛔ 不是 `/api/files/*`）。
   * 文件管理面板用；`isBinary` 为真时 `content` 无意义（面板改走图片/字节通道）。
   */
  async readFs(path: string): Promise<FsReadResult> {
    const body: Record<string, string> = { 'path': path };
    return await this.http.postAs<FsReadResult>('/api/fs/read', body);
  }

  /**
   * 递归搜索（`POST /api/fs/search {query,path?,limit?,show_hidden?}` → `{results:[{path,name,isDir}]}`）。
   *
   * 权威契约 = 服务端 `channel/web/web_rest.go:482-501`（POST 壳）+ `web_fs.go:472-548`（递归 walk）。
   * ⛔ 请求体由 `core/files.ets:fsSearchBody` **单点**构造 —— POST body 键名 `query` 与 GET query
   *    键名 `q` 的差异是 footgun（写错 ⇒ 服务端 400，不是空结果）。
   * ⛔ 响应键是 `results`（**不是** `entries`）。
   */
  async searchFs(query: string, path: string, showHidden: boolean = false): Promise<FsSearchEntry[]> {
    const body: FsSearchBody = fsSearchBody(query, path, showHidden);
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/fs/search', body);
    const arr: Object | undefined = raw['results'];
    return arrOrEmpty(arr as FsSearchEntry[]);
  }

  /**
   * 为一个 **GenUI（`display_html`）面板**建分享，返回可交 `WebSurface` 载入的 URL。
   *
   * ── 为什么走分享（完整依据见 `core/genui.ets` 头注释）──────────────────────────
   * 面板是 LLM 生成的 **TSX**，ArkTS 禁动态求值 ⇒ 原生**不执行**它；唯一与 web 一致的
   * 落地是把源码交给 web **自己的** shareRenderer（`xbot.genui` 插件注册的
   * `xbot.genui/tsx`）在 ArkWeb 里渲染 —— 且**只渲染这个面板**（用户点名过：
   * 不要「整屏变成 web 版的完整聊天应用」）。
   *
   * `POST /api/share/create`（后端 `channel/web/web_share.go:34`）body
   * `{plugin_id, content_type, payload, title}` ⇒ data `{token, path:'/s/<token>', …}`。
   * ⛔ 请求体由 `core/genui.genuiShareBody` **单点**构造；URL 由 `genuiPanelUrl` 拼。
   */
  async shareGenuiPanel(code: string, title: string): Promise<string> {
    const body: GenuiShareBody = genuiShareBody(code, title);
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/share/create', body);
    const p: Object | undefined = raw['path'];
    const path: string = p !== undefined && p !== null ? p.toString() : '';
    return genuiPanelUrl(this.http.baseUrl, path);
  }

  async loadCronTasks(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/cron/list', new SessionReq(this.channel, this.wireChatId()));
    const arr: Object | undefined = raw['tasks'];
    this.cronTasks = arrOrEmpty(arr as CronJob[]);
    this.onUpdate();
  }

  /** 删除一条定时任务（`POST /api/cron/remove` body `{channel, chat_id, job_id}`）。 */
  async removeCronTask(jobId: string): Promise<void> {
    const body: Record<string, string> = {
      'channel': this.channel, 'chat_id': this.wireChatId(), 'job_id': jobId,
    };
    await this.http.post('/api/cron/remove', body);
    await this.loadCronTasks();
  }

  async loadBgTasks(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/tasks/list', new SessionReq(this.channel, this.wireChatId()));
    const arr: Object | undefined = raw['background_tasks'];
    this.bgTasks = arrOrEmpty(arr as BgTask[]);
    this.onUpdate();
  }

  /**
   * 终止一条后台任务（RPC `kill_bg_task`，参数 `{task_id}`）—— web `BackgroundPanel.kill`
   * （`workspace/panels/BackgroundPanel.tsx:172` `ws.rpc('kill_bg_task', {task_id})`）同源。
   * 成功后重拉列表（web 靠 30s 轮询；这里立刻刷，用户按下去就能看到状态变化）。
   */
  async killBgTask(taskId: string): Promise<void> {
    await rpc<void>(this.http, 'kill_bg_task', new KillBgTaskParams(taskId));
    await this.loadBgTasks();
  }

  /**
   * 把**正在执行的前台 shell** 转入后台（RPC `promote_shell`，参数 `{session_key, tool_call_id}`）
   * —— web `ShellPromoteBar`（`components/agent/ToolRender.tsx:491-516`）同源。
   *
   * 成功后返回新后台任务 id（web 拿它显示 done 条 + task_id + toast），并**立刻**重拉后台任务
   * 列表（web 靠 `bg-task-promoted` 事件让任务面板即时刷新，否则 30s 轮询内看不到新任务）。
   *
   * ⛔ `session_key` 必须是**面板所见会话**（`channel:chatID`）—— 服务端按它查注册的
   *    `ForegroundShellHandle`（`tools/shell.go:347` / `tools/shell_promote.go`）；用 shell 自身的
   *    ctx 键在 physicalChannel override / SubAgent 场景下会落空报 `no running shell`
   *    （`docs/agent/gotchas-tools.md:18`）。
   */
  async promoteShell(toolCallId: string): Promise<string> {
    const key: string = promoteSessionKey(this.channel, this.wireChatId());
    const res: PromoteShellResult = await rpc<PromoteShellResult>(
      this.http, 'promote_shell', new PromoteShellParams(key, toolCallId));
    await this.loadBgTasks();
    // ⛔ 转后台是**服务端状态变更**：随后到达的 progress/snapshot 可能不再携带这个前台
    //    shell tool（它已变成 bg task），只靠增量 event 会让 pill 从历史里消失；用户实测
    //    「重新加载 session 才出现」。这里立即做一次权威 history 对账，把服务端已落库的
    //    tool 行拉回来，不依赖下一次手动切会话。
    await this.loadHistory();
    return res.task_id !== undefined && res.task_id !== null ? res.task_id : '';
  }

  /**
   * 终端（PTY）列表 —— 对齐 web `useTerminal` 的 refresh（同一端点 `POST /api/terminal/list`）。
   * ⚠️ body 键是 `chat_id`（**小写**），而 create 用的是 `chatID`（**大写 ID**）——
   * 服务端既有事实（`channel/web/web_pty.go` 的 `terminalListReq` / `terminalCreateReq`），照抄别"统一"。
   */
  async loadTerminals(): Promise<void> {
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    const body: Record<string, string> = { 'chat_id': this.wireChatId() };
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/terminal/list', body);
    if (gen !== this.chatGen || forChat !== this.currentChatId) {
      return;
    }
    const arr: Object | undefined = raw['terminals'];
    this.terminals = arrOrEmpty(arr as TerminalInfo[]);
    this.onUpdate();
  }

  /** 新建终端（`POST /api/terminal/create` body `{chatID, cwd}` → `{tid}`）。返回 tid（缺失时空串）。 */
  async createTerminal(cwd: string): Promise<string> {
    const body: Record<string, string> = { 'chatID': this.wireChatId(), 'cwd': cwd };
    const r: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/terminal/create', body);
    await this.loadTerminals();
    const tid: Object | undefined = r['tid'];
    return typeof tid === 'string' ? tid as string : '';
  }

  /**
   * 关闭终端（`POST /api/terminal/{tid}/delete`）。
   * 服务端 `Delete` 会一并销毁 PTY（web 侧靠卸载面板触发同一调用）—— 语义与 web **同源**。
   */
  async deleteTerminal(tid: string): Promise<void> {
    await this.http.post(`/api/terminal/${tid}/delete`, new EmptyReq());
    await this.loadTerminals();
  }

  /**
   * 受管机器列表（走 REST RPC 桥 `POST /api/rpc` body `{method, params}`）。
   * 用 RPC 而不是 `/api/runners/list`：后者是给插件面板用的包装，RPC 是同一权威数据源。
   */
  async loadRunners(): Promise<void> {
    // 只发 method：服务端对空 params 会补 `{}`（见 handleRPC）——
    // ArkTS 禁止嵌套空对象字面量 `{...: {}}`（arkts-no-untyped-obj-literals）。
    const body: Record<string, string> = { 'method': 'runner_list' };
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/rpc', body);
    const arr: Object | undefined = raw['runners'];
    this.runners = arrOrEmpty(arr as RunnerRow[]);
    this.onUpdate();
  }

  /**
   * 会话分支（`POST /api/chats/fork` body `{source_channel, source_chat_id, label?}`）。
   * @returns 新会话 id（服务端 `{chat_id}`）
   */
  async forkSession(chatId: string, label: string): Promise<string> {
    const body: Record<string, string> = {
      'source_channel': this.channel,
      'source_chat_id': chatId,
      'label': label,
    };
    const res: ForkResult = await this.http.postAs<ForkResult>('/api/chats/fork', body);
    const id: string | undefined = res.chat_id;
    if (id === undefined || id.length === 0) {
      throw new Error('服务端未返回新会话 id');
    }
    return id;
  }

  /**
   * 会话排序（`POST /api/chats/reorder` body `{channel, orders}`）。
   * `ids` 为当前**显示顺序**的会话 id 列表；内部算好全量序号再提交。
   */
  async reorderSessions(ids: string[], movedId: string, dir: string): Promise<void> {
    const orders: Record<string, number> = moveOrders(ids, movedId, dir);
    const body: Record<string, Object> = { 'channel': this.channel, 'orders': orders };
    await this.http.post('/api/chats/reorder', body);
    await this.loadSessions();
  }

  /**
   * 在当前会话里搜索消息（`POST /api/search`；服务端只检索**当前会话**的 tenant）。
   *
   * ⛔ 请求体**只能是** `{query, limit}` —— 服务端 `handleSearchPOST`（`web_rest.go:432-449`）
   * 用 `DisallowUnknownFields()` 解码（`web_rest.go:35`），多发 `channel`/`chat_id`/`q`
   * 会直接 **400**。（曾经如此 ⇒ 该按钮恒失败。）构造/归一/解析见 `core/sessionops.ets`。
   */
  async searchMessages(q: string): Promise<SearchHit[]> {
    const body: SearchBody = searchBody(q, SEARCH_LIMIT_DEFAULT);
    const res: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/search', body);
    return parseSearchHits(res);
  }

  async deleteSession(chatId: string): Promise<void> {
    // 服务端 handleChatDeletePOST 只认 `{channel}`（chat_id 在路径上）——
    // 严格解码下多发一个 chat_id 就是 400
    await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/delete',
      new ChannelReq(this.channel));
    if (chatId === this.currentChatId) {
      this.currentChatId = '';
      this.rows = [];
      this.sse.close();
    }
    await this.loadSessions();
  }

  async renameSession(chatId: string, label: string): Promise<void> {
    // 服务端 handleChatRename 只认 `{channel, label}`（chat_id 在路径上）——
    // 严格解码下多发 chat_id 就是 400（真机事故）
    await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/rename',
      new RenameReq(this.channel, label));
    await this.loadSessions();
  }

  /**
   * **点击即反馈**：把"身份 + 清空 + loading"当场落地（**无 await**）。
   *
   * 用途见 `openSession` 顶部注释（用户 2026-10-13 亲报「切换会话点击后立刻要 loading，不能看起来
   * 没变」）。与 `openSession` 里那段复位**同源**（都用 `initialChatState` 的复位口径），区别只是
   * **时机**：本方法在**任何网络往返之前**，好让页面第一帧就给出反馈。
   *
   * ⛔ 渠道解析（`channelForChat`）**不在此处**：它依赖会话列表（列表为空会回落默认渠道 ⇒
   *    非 web 会话 `/api/history` 404，真机实测），必须留在 `openSession` 的列表就绪之后。
   */
  beginSwitch(chatId: string): void {
    this.currentChatId = chatId;
    // 新会话从“不挂起”开始（旧 store 可能停在滚动挂起态）。
    this.uiSuspended = false;
    // ⛔ 会话代数自增：所有在飞异步回包（history/status/queue/sessions/settings/terminals）
    //   在 await 之后都会因代数不符而丢弃（同一个 store 被重开到另一个 chat 的串台根因）。
    this.chatGen++;
    // ⛔ **立刻整体复位状态机**（不是只清 rows）：从 beginSwitch 到 openSession 复位之间
    //   有一段窗口，旧实现仍持有**上一个会话**的 turns/busy/sessionRunning ⇒ 页面读到
    //   旧值（切会话瞬间按钮/进度错乱），且旧会话的迟到事件会落进"新会话身份"。            
    this.state = initialChatState(chatId);
    this.gapReloadSeenKey = '';
    this.gapReloadSeenToken = 0;
    // 上一会话的 SSE 意图窗口不属于新会话：不清会让 `runningAfterReconcile` 把
    // **空闲的新会话**误判 running（最长 15s 显示 cancel）。
    this.intentBusyAt = 0;
    this.intentIdleAt = 0;
    this.rows = [];
    this.rowCache = new Map();
    // 分页累积也必须清：否则切会话后 `loadMore` 会把旧会话的 history 与新会话混在一起。
    this.history = [];
    this.hasMore = false;
    this.oldestId = 0;
    this.historyError = '';
    this.historyLoading = true;
    // 会话级**非状态机**字段也要在“身份切换那一刻”清：openSession 里清是更晚一步，
    // 中间窗口会让 B 短暂看到 A 的队列/AskUser/用量/cwd/子代理/widget（用户反馈过的串台形态）。
    this.askUser = null;
    this.queue = [];
    this.usage = undefined;
    this.cwd = '';
    this.subagents = [];
    this.lastWidgetEvent = '';
    this.lastWidgetContent = '';
    // 会话级订阅（模型/上下文徽章）与终端列表同属会话态 ⇒ 身份切换时清掉，
    // 否则 B 会短暂显示 A 的模型徽章/终端（load* 的代数守卫负责迟到的回包）。
    this.sessionSubState = 'idle';
    this.sessionSubError = '';
    this.sessionSubscription = '';
    this.sessionModel = '';
    this.terminals = [];
    // 切会话身份：settings 旧缓存「不算数」——loadSettings 完成前主题不动（防旧深值回写）。
    this.settingsFresh = false;
    this.onUpdate();
  }

  /** Demo session: local state only, no `/api/history`, no SSE. */
  private openDemoSession(chatId: string): void {
    this.currentChatId = chatId;
    this.channel = 'web';
    this.state = initialChatState(chatId);
    this.rowCache = new Map();
    this.rows = [];
    this.askUser = null;
    this.queue = [];
    this.hasMore = false;
    this.oldestId = 0;
    this.historyError = '';
    this.lastWidgetEvent = '';
    this.lastWidgetContent = '';
    this.onUpdate();
    // 每个 demo 会话自动带一条固定示例，打开即可看到内容。
    this.demoRunTurn(demoSeedPrompt(chatId), true);
  }

  /**
   * 固定演示事件流：无论用户输入什么，正文/思考/迭代完全相同。
   * ⛔ 不走网络；仅复用真实状态机的 DomainEvent，保证 UI 与线上同构。
   */
  private demoRunTurn(text: string, seeded: boolean = false): void {
    const turn = turnID(this.demoTurnSeq++);
    const seq = this.demoSeq++;
    this.pushEvent({
      type: 'turn_started', turnID: turn, requestID: `demo-${turn}`,
      trigger: 'user', content: text,
    });
    this.pushEvent({
      type: 'iteration', turnID: turn, iter: iterNum(1), seq: seq as never,
      content: seeded ? DEMO_ANSWER as never : undefined,
      reasoning: DEMO_REASONING as never,
      activeTools: [], completedTools: [], iterationsDelta: [],
      todos: undefined, goal: undefined, subAgents: undefined,
      tokenUsage: undefined, streamStats: undefined,
    });
    this.pushEvent({
      type: 'text_final', turnID: turn, content: DEMO_ANSWER as never,
      progressHistory: [], cancelled: false,
    });
    this.pushEvent({ type: 'session_running', running: false });
  }

  async openSession(chatId: string, channelHint: string = ''): Promise<void> {
    if (this.demoMode) {
      this.openDemoSession(chatId);
      return;
    }
    // ⛔ **点击即刻可见**（用户 2026-10-13 亲报「切换会话点击后立刻要 loading，不能看起来没变」）：
    //    `openSession()` 在拉到历史之前有**两次网络往返**（会话列表 + `/api/history`）；期间界面若
    //    原封不动仍是**上一个会话**的内容 ⇒ 用户以为"点了没反应"。⇒ 先当场切身份 + 清空 + 进 loading
    //    （页面据此立刻渲染历史骨架 `showsHistorySkeleton`），网络回来只是把内容填进来。
    //    幂等：页面池中已开路径不经此处；下面 loadHistory 还会再置一次。
    this.beginSwitch(chatId);
    // 本次 open 的代数：任何 await 之后若已被新的 openSession/beginSwitch 取代，
    // 立即放弃（否则旧请求回来会把 currentChatId/state 改回旧会话 = 串台）。
    const gen: number = this.chatGen;
    // 否则 /api/history 会返回 404 session not found（真机实测，见 core/sessionpick.ets）。
    //
    // ⚠️ 渠道解析**依赖会话列表**：列表为空时 channelForChat 会回落默认渠道 ⇒ 非 web 会话
    // 被当成 web ⇒ 404。但 **绝不能 await 会话列表**：`/api/session-tree` 一旦挂住，
    // `openSession` 永不返回 ⇒ 页面 `switchSplash` 永久停在“会话加载中…”（用户 2026-10-17
    // 真机截图实锤）。会话列表只是**渠道推断的优化** ⇒ 后台补齐；先用已有信息/全键前缀推断。
    if (this.sessions.length === 0) {
      this.loadSessions().catch((): void => {
        // 列表拉取失败不阻塞首屏（渠道已按前缀/默认推断；后续 onUpdate 会校正）
      });
    }
    // ⛔ 不能按 `chatId.indexOf(':')` 猜 channel：CLI 会话 id 本身带冒号
    //    （`/Users/bobli:Agent-swift-brook`）⇒ 会把 `/Users/bobli` 当 channel，
    //    `/api/history`/SSE 直接 404「session not found」。页面在点击会话时
    //    已经拿到 `SessionItem.channel` ⇒ 用显式 hint；列表仍作为无 hint 时的回退。
    const parsedAgent: ParsedAgentChatID | undefined = parseAgentChatID(chatId);
    const agentChannel: string = parsedAgent !== undefined ? parsedAgent.parentChannel : '';
    const listedChannel: string = this.sessions.length > 0
      ? channelForChat(this.sessions, chatId) : '';
    this.channel = channelHint.length > 0
      ? channelHint
      : (agentChannel.length > 0 ? agentChannel : (listedChannel.length > 0 ? listedChannel : 'web'));
    this.currentChatId = chatId;
    // ⛔ 切会话诊断（用户点名要的）：入口就把"切到谁 / 什么渠道 / 列表里有没有它"打出来 ——
    //    渠道解析依赖会话列表（列表为空/不含该会话 ⇒ 回落默认渠道 ⇒ `/api/history` 404）。
    console.debug(`[SWITCH] open sid=${this.sid} chatId=${chatId} channel=${this.channel} sessions=${this.sessions.length} rowsBefore=${this.rows.length} histErrBefore=${this.historyError}`);
    // ⛔ 通知服务端"当前会话"（`POST /api/chats/{chatID}/switch`）—— **fire-and-forget**。
    //   服务端的 active session（`userCurrentSession[senderID]`）是 `handleSearch`（搜消息，`:1120`）、
    //   会话树（`:1443`）、终端（`web_pty.go:557`）、WS 缺省路由/cancel 的**唯一**输入；
    //   不发 ⇒ 服务端仍指向上一次（web/别人）设的会话 ⇒ 搜消息查错会话（真机：`CI` 0 命中）。
    //   ⛔ 失败**绝不影响**切会话主流程（与下方 `loadStatus` 同款吞异常）。
    this.notifyServerSwitch(chatId).then((res: ChatSwitchResult) => {
      // 切会话即刻恢复 TODO —— 仅当**仍是当前会话**时套用（用户已切走 ⇒ 丢弃，避免串台）。
      if (this.currentChatId === chatId && res.todos.length > 0) {
        this.todos = res.todos;
        this.onUpdate();
      }
    }).catch(() => {
      // 非关键路径：服务端 active session 下次切会话再补；不弹错、不阻塞
    });
    // 通知（波3）：用户**正在看这个会话** ⇒ 它的提醒已被"读到"，**只**清它（其余会话的提醒保留）。
    // 失败/不存在都在 notify.clearForChat 内部吞掉（1600007 = 本来就没有 ⇒ 视为成功）。
    clearForChat(chatId);
    // ⛔ 会话隔离（用户反复强调，真机 P0）：切会话必须**整体复位状态机**。
    //   ChatState 是**唯一事实源**，`initialChatState(chatId)` 一次重建即复位
    //   【全部】per-session 状态（turns/lastSeq/activeTurn/busy/pendingUsers/
    //   todos/goal/queue/sessionRunning/gapReloadToken/…）—— 不存在"漏重置某个
    //   字段"的可能（旧实现逐字段手写复位，先后漏过 lastTurnID/stream*/serverRunning，
    //   每漏一个就是一处串台）。
    this.state = initialChatState(chatId);
    this.rowCache = new Map();
    this.rows = [];
    this.askUser = null;
    this.queue = [];
    this.hasMore = false;
    this.oldestId = 0;
    // 插件 widget 载荷同属**会话态**（服务端按 chat_id 推 `web_widgets`/`plugin_widgets`）
    // ⇒ 必须随会话复位，否则切到会话 B 仍显示**会话 A** 的 widget（串台）。
    // 与 `rows`/`queue` 同档：在下面这一次 `onUpdate()` 之前生效。
    this.lastWidgetEvent = '';
    this.lastWidgetContent = '';
    this.onUpdate();
    // ⛔ **先订阅、后拉历史**（顺序不可反）：
    //   ① 拉历史是网络往返；期间到达的 turn_started/stream 若无人接收 ⇒ 打字机/迭代
    //      永久缺一段（旧实现把 subscribe 放在两次 await 之后）。
    //   ② 旧实现 `await loadHistory()` 抛错时**永不 subscribe** ⇒ 新会话永远收不到
    //      任何事件（用户症状：有网但发消息无效/cancel 无效）。
    //   先订阅后，事件与 history merge 由状态机处理（history_replaced 不覆盖 live）。
    this.subscribe();
    await this.loadHistory();
    if (gen !== this.chatGen) {
      return;
    }
    await this.loadQueue();
    if (gen !== this.chatGen) {
      return;
    }
    this.loadStatus().catch(() => {
      // 状态非关键路径
    });
    // 会话级订阅（`get_session_subscription`）：与 loadStatus 同档触发（打开会话 + 回合结束）。
    this.loadSessionSubscription().catch(() => {
      // 订阅查询非关键路径
    });
  }

  /**
   * 挂起/恢复 UI 行重建（页面在滚动/触摸期调用）。
   *
   * 恢复时必须立即 `rebuildRows()` 一次（把挂起期间累积的 state 一次性落到行对象），
   * 再 `onUpdate()` 让页面重新投影 + 投递 live 内容。挂起只影响**渲染**，不影响状态机/网络。
   */
  suspendUiUpdates(suspend: boolean): void {
    if (this.uiSuspended === suspend) {
      return;
    }
    this.uiSuspended = suspend;
    if (!suspend) {
      this.rebuildRows();
      this.onUpdate();
    }
  }

  /**
   * **出网用的规范会话 id** —— 去掉重复的渠道前缀（详见 `core/sessionpick.canonicalChatId`）。
   *
   * ⛔ 为什么出网必须规范化（2026-10-13 服务端对照实验铁证）：服务端把会话键一律组装成
   *   `channel + ":" + chat_id`（48 处），**期望 `chat_id` 是裸 id**（web 同款：`s.chatID` 裸、
   *   `${channel}:${chatID}` 才是键）。而本仓 `currentChatId` 是**全键**（`/api/session-tree` 的
   *   `is_current` 行 `chat_id` 字段自带前缀 ⇒ 客户端原样收下）⇒ 出网组装成 `web:web:chat_…`，
   *   落到**幽灵会话**上。实测（同会话两种形态直打服务端）：`/api/cron/list` 裸 ✅ / 全键 `null`；
   *   `/api/tasks/list` 裸 ✅ 返回真任务 / 全键 `[]`；`/api/session/status` 裸 ✅ 正确 cwd+todos /
   *   全键 空 todos + 默认 cwd `/Users/bobli`。
   *   ⇒ 用户可见：**定时/后台任务面板结构性永远空**（"任务管理做得很差"的真根因）、cwd 显示成
   *   默认目录、todos 丢失、历史显示空态「开始对话」。
   * ⛔ 只规范**出网参数**：`currentChatId` 自身与会话树里的值保持原样（列表内各处比较、`/` 分隔的
   *   子代理 id 都以后者为准）。
   * ⛔ **public 且必须被页面复用**：页面级 RPC（`SetCwd`/`SetGoal`/`SetTodos`/`Git` 系列/
   *   `SessionUsageStats`/`SessionUsageBuckets`、导出会话的 `chatID`）此前各自直接传
   *   `currentChatId` ⇒ 全部漏网、一律落到幽灵会话（实测：统计面板「暂无数据」而同屏状态栏有
   *   `202K/1000K`；裸 id 的 `get_session_usage_stats` 返 294 tok/s + 102 turns，全键返全 0）。
   *   页面一律走本方法，判据 `tools/tests/session_id_wire.test.ts` 钉 `Index.ets` 里这类直传为 0 处。
   */
  wireChatId(): string {
    return canonicalChatId(this.channel, this.currentChatId);
  }

  /**
   * 通知服务端"当前会话"（`POST /api/chats/{chatID}/switch`，body `{channel}`）。
   *
   * 服务端把它记为 active session（`userCurrentSession[senderID]`）——`handleSearch`/会话树/
   * 终端/WS 缺省路由都读它。⛔ 路径必须 URL-encode chatID（`chatSwitchPath`）；
   * `channel` 缺省 `web`（`chatSwitchChannel`）。**调用方负责吞异常**（fire-and-forget）。
   */
  private async notifyServerSwitch(chatId: string): Promise<ChatSwitchResult> {
    const path: string = chatSwitchPath(canonicalChatId(this.channel, chatId));
    const body: ChannelReq = new ChannelReq(chatSwitchChannel(this.channel));
    const raw: Object = await this.http.postAs<Object>(path, body);
    return parseChatSwitch(raw);
  }

  // ── 历史（含上拉分页） ─────────────────────────────────────────────────────

  async loadHistory(): Promise<void> {
    // ⛔ 同一 chatGen 最多一份在飞：resume / resync_required / gap reload / 页面重试
    //    可能同帧撞车，重复请求只会重复解析 + 重建（resume 预算 = 最多一次 reopen）。
    const gen: number = this.chatGen;
    if (this.historyLoading && this.historyLoadGen === gen) {
      return;
    }
    this.historyLoadGen = gen;
    this.historyLoading = true;
    // 权威 history 重载 ⇒ 旧 live 行的缓存必须整体失效（不只按 id 命中）。
    // 否则 resync 后 `rowCache` 仍返回旧 ChatRow，`appliedRowByRow` 会误判未变化。
    this.liveCacheKey = '';
    this.invalidateLiveRowCache();
    this.onUpdate();
    try {
      await this.loadHistoryInner();
    } catch (e) {
      // ⛔ 2026-10-12 P0：**这里此前没有 catch** ⇒ `/api/history` 的任何失败（或
      //   下方 `active_progress` 解析/归并里的一处抛错）都会**炸穿到调用方**，
      //    而部分调用点没有 `.catch` ⇒ **白屏、无任何提示**（用户实报："切特定会话
      //    必定加载不出历史"）。⇒ 失败必须**落地成可读原因 + 可重试**（fail-safe）。
      this.historyError = readableRpcError((e as Error).message);
    } finally {
      this.historyLoading = false;
      if (this.historyLoadGen === gen) {
        this.historyLoadGen = -1;
      }
      this.onUpdate();
    }
  }

  /**
   * **回前台 / SSE 重连后的权威重载**（用户 2026-10-18 P0：后台休眠期间通知被处理并恢复 idle，
   * 回前台后不重新打开 App 看不到新消息）。
   *
   * 为什么不能只 `probeNow/forceReconnect`：
   *   · SSE 可能仍是 `open`（半开/后台被系统冻结但状态没变），probe 阈值未到 ⇒ 不重连；
   *   · 即使重连，服务端 ring 里的事件可能已被淘汰，`session-tree` 也只有 running 没有正文；
   *   · 休眠期间服务端可能又跑完一个 notification turn 并 idle ⇒ 本地必须用 `/api/history`
   *     重新对齐，才能看到新的 user/notification 行与 assistant 输出。
   *
   * 语义：先 `loadSessions`（running 权威 + 会话列表），再 `loadHistory`（正文权威）。
   * 节流 1.2s（`onPageShow` 与 `onState(open)` 可能同帧双触发）；失败静默（旁路，不阻断 UI）。
   */
  resyncAfterResume(reason: string = '', force: boolean = false): void {
    if (this.currentChatId.length === 0) {
      return;
    }
    const now: number = Date.now();
    // 回前台双触发做节流；但「turn 已结束却仍 busy」是状态机不变量被破坏，
    // 必须立刻校准，不能被上一次 send-ack 的 1.2s 节流吞掉（短 turn 会卡思考中）。
    if (!force && now - this.lastResumeResyncAt < 1200) {
      return;
    }
    // 回前台可能同时收到 onPageShow / onAppResumed / SSE reopen 三路触发；在飞期间
    // **排队一次**（不能静默丢弃：live-stall / 新迭代的恢复请求都靠它）。
    if (this.resumeResyncInFlight) {
      this.resumeResyncPending = true;
      return;
    }
    this.lastResumeResyncAt = now;
    this.resumeResyncInFlight = true;
    // ⛔ 回前台瞬时**挂起行重建**：休眠期间 SSE ring / loadHistory 可能一次回放大量事件，
    //    每个事件都 rebuildRows + onUpdate 会连续标脏整页 ⇒ 用户看到的「打开卡死、严重掉帧」。
    //    状态机/网络照常推进，两路 authoritative 数据落完后只 rebuild 一次。
    this.suspendUiUpdates(true);
    let released: boolean = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      if (this.resumeResyncTimer >= 0) {
        clearTimeout(this.resumeResyncTimer);
        this.resumeResyncTimer = -1;
      }
      this.resumeResyncInFlight = false;
      // 网络挂死也必须恢复渲染（fail-safe）：不能把 UI 永久留在挂起态。
      this.suspendUiUpdates(false);
      if (this.resumeResyncPending) {
        this.resumeResyncPending = false;
        // 排队的请求已经晚于节流窗口，直接放行。
        this.lastResumeResyncAt = 0;
        this.resyncAfterResume(`${reason}-queued`);
      }
    };
    // 旁路超时：正常请求远小于 15s；超时仍释放并 rebuild 当前已到的状态。
    this.resumeResyncTimer = setTimeout(release, 15000);
    log('resume', `权威重载 chat=${this.currentChatId} reason=${reason}`);
    // 先会话树（running/子代理），再历史正文；两步都按 chatGen/currentChatId 守卫（loadHistory 内部）。
    this.loadSessions().catch(() => {
      // 会话树失败不阻断历史重载（历史失败会落 historyError，页面可重试）
    }).then(() => {
      if (this.currentChatId.length === 0) {
        release();
        return;
      }
      this.loadHistory().catch(() => {
        // loadHistory 已把可读错误写进 historyError；这里只防未处理 rejection
      }).then(() => {
        release();
      });
    });
  }

  /**
   * 子代理会话历史加载（逐字对齐 web `useChatMessages.ts:489-522`）。
   *
   * Live SubAgent（`parseAgentChatID` 命中）从后端**内存 registry** 取数据：
   *   ① `get_agent_session_dump`（含 iterations） → ② 兜底 `get_session_messages`（只 role/content）
   * Persisted Agent Tab（`channel=agent`）走正常 `/api/history`（由 `loadHistoryInner` 处理）。
   */
  private async loadSubAgentHistory(): Promise<void> {
    const forChat: string = this.currentChatId;
    const parsed: ParsedAgentChatID | undefined = parseAgentChatID(this.currentChatId);
    if (parsed === undefined) {
      console.info(`[SUBAGENT] loadSubAgentHistory: parseAgentChatID returned undefined for ${this.currentChatId}`);
      return;
    }
    console.info(`[SUBAGENT] loadSubAgentHistory: chatId=${this.currentChatId} parentChannel=${parsed.parentChannel} parentChatID=${parsed.parentChatID} role=${parsed.role} instance=${parsed.instance}`);
    const params: SubAgentHistoryParams = new SubAgentHistoryParams(
      parsed.parentChannel, parsed.parentChatID, parsed.role, parsed.instance);
    // ① 先试 get_agent_session_dump（内存 registry，含 iterations）
    let messages: Object[] = [];
    try {
      const dump: AgentSessionDump = await rpc<AgentSessionDump>(this.http, RPC_GET_AGENT_SESSION_DUMP, params);
      if (this.currentChatId !== forChat) { return; }
      console.info(`[SUBAGENT] get_agent_session_dump response: dump=${dump !== null ? 'non-null' : 'null'} messages=${dump !== null && dump.messages !== undefined ? dump.messages.length : 0} iterations=${dump !== null && dump.iterations !== undefined ? dump.iterations.length : 0}`);
      const dumpMsgs: Object[] = dump !== null && dump.messages !== undefined && dump.messages !== null ? dump.messages : [];
      const dumpIts: Object[] = dump !== null && dump.iterations !== undefined && dump.iterations !== null ? dump.iterations : [];
      if (dumpMsgs.length > 0 || dumpIts.length > 0) {
        messages = dumpMsgs;
      }
    } catch (e) {
      console.info(`[SUBAGENT] get_agent_session_dump failed: ${(e as Error).message}`);
    }
    // ② 兜底：get_session_messages（只 role/content）
    if (messages.length === 0) {
      try {
        const msgs: SubAgentMsg[] = await rpc<SubAgentMsg[]>(this.http, RPC_GET_SESSION_MESSAGES, params);
        if (this.currentChatId !== forChat) { return; }
        console.info(`[SUBAGENT] get_session_messages response: msgs=${msgs !== null ? (Array.isArray(msgs) ? msgs.length : 'not-array') : 'null'}`);
        messages = msgs !== null && msgs !== undefined && Array.isArray(msgs) ? msgs as Object[] : [];
      } catch (e) {
        console.info(`[SUBAGENT] get_session_messages failed: ${(e as Error).message}`);
      }
    }
    if (this.currentChatId !== forChat) { return; }
    // 解析 SubAgentMsg[] → ChatMessage[]（逐字对齐 web `parseSubAgentMessages`）
    const chatMsgs: ChatMessage[] = this.parseSubAgentMessages(messages);
    console.info(`[SUBAGENT] parsed ${chatMsgs.length} messages from ${messages.length} raw`);
    this.history = chatMsgs;
    this.pushEvent(historyToReplaced(chatMsgs, null));
    this.onUpdate();
  }

  /** 把 SubAgentMsg[]（简单 role/content 对）转成 ChatMessage[]。 */
  private parseSubAgentMessages(raw: Object[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < raw.length; i++) {
      const m: Object = raw[i];
      const role: string = (m as Record<string, Object>)['role'] as string;
      const content: string = (m as Record<string, Object>)['content'] as string;
      if (role === undefined || content === undefined) {
        continue;
      }
      out.push({
        id: `sa-${i}`,
        role: role === 'assistant' ? 'assistant' : 'user',
        content: content,
        iterations: [],
        turnID: 0,
        isNotification: false,
        timestamp: '',
        isPartial: false,
        // ⛔ **合成 dbID 必填**（血债，2026-10-16）：`historyToReplaced`（`core/integrate.ts:57`）
        //   对 `dbID === undefined` 的行**全部 `continue`**（过滤乐观/echo 副本）⇒ 不给 dbID
        //   会导致**整批子代理消息被丢弃** ⇒ 历史仍空。子代理会话不需要 rewind/分页，
        //   故合成一个递增 id（唯一即可）安全。
        dbID: i + 1,
      });
    }
    return out;
  }

  private async loadHistoryInner(): Promise<void> {
    // ⛔ 切会话竞态：`await` 期间用户可能已切走 ⇒ 旧响应**绝不能**写进新会话
    //   （否则就是"切 A→B 后看到 A 的内容"的串台）。会话号变了 ⇒ 整个丢弃。
    // ⚡ 2026-10-20 子代理历史：Live SubAgent（parseAgentChatID 命中）走 RPC 路径，
    //   不走 /api/history（服务端对 channel=agent 租户返回 messages:null）。
    if (parseAgentChatID(this.currentChatId) !== undefined) {
      await this.loadSubAgentHistory();
      return;
    }
    const forChat: string = this.currentChatId;
    const gen: number = this.chatGen;
    const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryReq(
      // 30 → **100**（2026-10-14，C 线审计口径对齐）：web 权威首屏一次拉 100 条
      // （useChatMessages.ts:525 `limit: 100`）；渲染窗口（rowLimit=12 首屏）不受此影响。
      this.channel, this.wireChatId(), 100, 0));
    if (gen !== this.chatGen || this.currentChatId !== forChat) {
      return;
    }
    this.applyHistoryMeta(data);
    // 历史 → `history_replaced`（逐字对齐 web `integrate.ts` 的 historyToReplaced）：
    //   经状态机（**merge 语义**，不盲替换 —— 见 reduce.ets 的 history_replaced 注释；
    //   盲替换会抹掉"只存在于状态机、DB 快照还没有"的 in-flight/post-fetch commit）。
    this.history = ChatStore.toChatMessages(data.messages, 0);
    this.pushEvent(historyToReplaced(this.history, data.active_progress));
    // ⚠️ `active_progress` 在"没有在飞进度"的会话上是 **JSON null**（真机实测）⇒ 必须三态判空。
    // ⛔ 且这一支**不得**炸掉整次历史加载：它只是"顺带恢复在飞态"，失败必须降级为"无在飞态"，
    //    否则**正在跑的会话**（active_progress 非空）会整页白屏（2026-10-12 P0 的形态）。
    const ap: ProgressEvent | null | undefined = data.active_progress;
    if (isPresent(ap)) {
      try {
        this.pickAskUserFromProgress(ap);
      } catch (e) {
        // 降级：AskUser 恢复失败不影响历史本身（历史已在上面喂进状态机）。
      }
    }
    this.onUpdate();
  }

  /** 上拉加载更早历史（`before_id` 游标）。 */
  async loadMore(): Promise<void> {
    // ⛔ 入口状态快照（**诊断锚**，一行）：用户亲报的「滑到顶不加载」有三种可能——① 触发点
    //    压根没调到这里（`onScrollIndex`/`onReachStart` 未触发）② 被守卫挡住
    //    （`hasMore` / `loadingMore` 陈旧）③ 游标失效（`oldestId <= 0`）。三者处置完全不同，
    //    而远程无法推断 ⇒ 必须留下"到这里时三个标志各是什么"的可观测证据（`hdc hilog` 可读）。
    console.debug(`[LM] enter hasMore=${this.hasMore ? 1 : 0} loading=${this.loadingMore ? 1 : 0} oldest=${this.oldestId} hist=${this.history.length} rows=${this.rows.length}`);
    if (!this.hasMore || this.loadingMore) {
      return;
    }
    // ── 游标失效：**不静默**，落哨兵码由页面自愈（P0 2026-10-15「加载不出更早」）─────────
    // 旧实现此处直接 `return`（且三道闸门全部静默）⇒ 头部提示按 `hasMore` 渲染
    // 「下拉到底部自动加载更早消息」⇒ 用户看到"还有更早"却**永远加载不出来、零反馈**。
    // `oldest_id` 来自 `/api/history`（`applyHistoryMeta` 三态判空：服务端 nil 时不写入）
    // ⇒ 冷启首帧缺字段 / 历史重载未回带 / 响应异常都会留下 `0`。
    // 处置 = 哨兵码 + 页面**重拉首页**重建游标（用户口径"清除状态重新拉 api"）⇒ 自愈。
    if (this.oldestId <= 0) {
      this.loadMoreErr = LOADMORE_ERR_NOCURSOR;
      console.debug(`[LM] nocursor oldest=${this.oldestId} hist=${this.history.length}`);
      this.onUpdate();
      return;
    }
    if (this.loadMoreErr.length > 0) {
      this.loadMoreErr = '';
    }
    this.loadingMore = true;
    const forChat: string = this.currentChatId;
    const gen: number = this.chatGen;
    try {
      const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryReq(
        // 30 → **100**（2026-10-14，C 线审计口径对齐）：web 权威每批 100 条
        // （useChatMessages.ts:607）；渲染窗口逐步放开（12/次）的预算不受影响。
        this.channel, this.wireChatId(), 100, this.oldestId));
      // ⛔ 切会话竞态：`await` 期间用户可能已切走 ⇒ 旧分页响应**绝不能**写进新会话
      //   （否则旧会话的更早消息会被 pushEvent 到新会话状态 = 串台）。
      if (gen !== this.chatGen || this.currentChatId !== forChat) {
        return;
      }
      const older: ChatMessage[] = ChatStore.toChatMessages(data.messages, this.oldestId);
      // ⛔ 「全是重复 ⇒ 到底」停止条件（对齐 web `useChatMessages.ts:620-639` 的 `noExactDups`）：
      //    服务端 `has_more` 只保证「这批之后还有行」，但若这批**全部**是与本地已持有的同
      //    一行（游标未前进 / 边界对齐回带已加载行），说明已到尾部 —— 停止分页，绝不重复
      //    前插（重复行 id 撞 `LazyForEach` key ⇒ 该子树不建项 = 用户「更早的加载不出来」）。
      //    ⛔ 刻意**不**用「长度不变」当停止条件：一个超长 turn 跨多批时中间批只增迭代不增
      //    行槽 ⇒ 长度不变但服务端仍有更早数据（web 同注释）。只认「精确 id 全重复」。
      const existing: Set<string> = new Set<string>();
      for (let i = 0; i < this.history.length; i++) {
        existing.add(this.history[i].id);
      }
      const fresh: ChatMessage[] = [];
      for (let i = 0; i < older.length; i++) {
        if (!existing.has(older[i].id)) {
          fresh.push(older[i]);
        }
      }
      if (fresh.length === 0) {
        this.hasMore = false;
        return;
      }
      this.history = fresh.concat(this.history);
      this.applyHistoryMeta(data);
      console.debug(`[LM] ok fresh=${fresh.length} hasMore=${this.hasMore ? 1 : 0} oldest=${this.oldestId} hist=${this.history.length}`);
      // 分页只增量喂历史（active 快照传 null —— 不得动 live turn）。
      this.pushEvent(historyToReplaced(this.history, null));
    } catch (e) {
      // ⛔ 失败**绝不静默**（同族缺陷：`loadLlmConfig` 曾把失败吞掉 ⇒ 面板永久转圈）：
      //    旧实现无 catch ⇒ 异常直接抛进 `onScrollIndex` 回调（无人接）⇒ 用户只看到
      //    "划不动、没反应"，而头部提示仍在承诺"会自动加载更早"。这里落**可读原因**，
      //    页面据此 toast（并保留同一入口重试）。
      const err: Error = e as Error;
      const msg: string = err !== undefined && err !== null && err.message !== undefined
        ? err.message : '';
      this.loadMoreErr = msg.length > 0 ? msg : '加载更早失败';
      console.debug(`[LM] fail oldest=${this.oldestId} err=${msg}`);
      this.onUpdate();
    } finally {
      this.loadingMore = false;
      this.onUpdate();
    }
  }

  private applyHistoryMeta(data: HistoryData): void {
    this.hasMore = data.has_more === true;
    // ⚠️ 外来 JSON：`oldest_id` 可能是 null（服务端 nil → null）；直接赋值会把 null 塞进
    //    数值字段，之后当 `before_id` 发出去就是脏请求 ⇒ 必须三态判空
    const oldest: number | null | undefined = data.oldest_id;
    if (oldest !== undefined && oldest !== null) {
      this.oldestId = oldest;
    }
    // ⚠️ 绝不把 history 的 `last_seq` 写进 progress 水位（本次真机 P0 根因）：
    // 它是 **SSE 回放游标**（全局计数，几百量级），而 ProgressEvent.Seq 是 **per-Run**
    // 从 1 计数 —— 混用后新回合的全部事件被 `seq <= lastSeq` 整批丢弃
    // （表现：SSE 事件完全不渲染、思考中消失后永远空白）。web 的 lastSeq 属于
    // activeTurn、turn_started 重置、从不从 history 设置。SSE 回放游标由
    // SseClient 的 lastEventId 单独负责。
    //
    // ── 但对账备忘**要用**它（2026-10-11 死消费修复）─────────────────────────────
    // 上面那条"绝不写进 ChatState"**不适用于**对账备忘：备忘只跟"后台扩展的 turnKey"比对，
    // 而扩展 `fetchMark` 用的就是 `/api/history` 的 `chat_id` + `last_seq` —— **同一字段**，
    // ⇒ 两处 turnKey 必然一致。前台**看到**了这个会话的最新回合 ⇒ 记下"已见"
    // ⇒ 后台对账不会把用户**已看过**的回合误报成"新消息"。
    // 旁路：`noteForegroundSeen` 自带前台闸 + 落盘端口（见 `core/notify.ets`）。
    const seenSeq: number | null | undefined = data.last_seq;
    if (seenSeq !== undefined && seenSeq !== null) {
      noteForegroundSeen(this.currentChatId, seenSeq);
    }
  }

  /** 历史消息 → web `ChatMessage[]`（`historyToReplaced` 的输入形状）。 */
  static toChatMessages(messages: HistoryMessage[] | null | undefined, batchTag: number = 0): ChatMessage[] {
    const out: ChatMessage[] = [];
    // 服务端 messages 可能为流式 payload/历史快照的缺失字段 —— null 与 undefined 一律归一为空。
    const src: HistoryMessage[] = arrOrEmpty(messages);
    // ⛔ **行 id 必须全局唯一**（本仓血债：`store.ets` 下方 `idSeq` 的注释已警告同类事故）。
    //    ArkUI 的 `ForEach`/`LazyForEach` key 一旦重复，会抛**应用级错误**
    //    `Ids generated by the ForEach id gen function must be unique` ⇒ **该列表子树整体不渲染**
    //    ⇒ 切到这种会话就是**白屏**（真机实证 2026-10-12：`hilog` 里 `AceStateMgmt` 报
    //    `Duplicated index: [45,273,316,...]`）。服务端历史里 `id` **可能缺省/为 null**
    //    （工具行、迭代行、内部记录）⇒ 旧写法 `m-${m.id}` 会让**多条记录同一个 `m-undefined`**
    //    ⇒ 撞 key。本处在**同一批**内去重：缺 id 用下标兜底；重复再补一次序号。
    //    ⚠️ 稳定 id 的语义不变：正常（有 id 且不重复）时输出仍逐字为 `m-<id>`。
    const seen: Map<string, number> = new Map<string, number>();
    // 同一批内唯一化（见上「行 id 必须全局唯一」血债）。turn_user 还原行与常规行走**同一张表**
    // ⇒ 两行永不撞 key。
    const mkID = (base: string): string => {
      const dup: number | undefined = seen.get(base);
      if (dup !== undefined) {
        seen.set(base, dup + 1);
        return `${base}~${dup + 1}`;
      }
      seen.set(base, 0);
      return base;
    };
    for (let i = 0; i < src.length; i++) {
      const m: HistoryMessage = src[i];
      // ── `turn_user` 边缘还原（后端 `5c3aec7b`；对齐 web `hooks/useChatMessages.ts:200-221`）──
      // 窗口化 turn（`regions_before > 0`，只下发了尾部区域窗口）的 user 行被服务端**从消息流里
      // 摘下**、改挂到该 turn 的 assistant 行的 `turn_user` 上（⛔ 消息不连续零容忍）。这里在
      // **边缘**还原成常规 user 行，且**插在该 assistant 行之前** —— 下游（`historyToReplaced`
      // 建 turn / derive / rewind / 加载更多）**零改动**；是否渲染仍由 derive 的「窗口未覆盖
      // 迭代 1 ⇒ user 行不渲染」规则决定（`core/derive.ts:287 userHiddenByFold`：该 assistant 行
      // 已经承载 `regionsBefore>0` ⇒ 还原出的 user 行在窗口补齐前**不渲染**，补齐后自然出现）。
      const tu: HistoryMessage | undefined = m.turn_user;
      if (tu !== undefined && tu !== null && tu.role === 'user'
        && tu.content !== undefined && tu.content !== null) {
        const tuID: number | undefined = tu.id !== undefined && tu.id !== null ? tu.id : undefined;
        const tuTurn: number | undefined = tu.turn_id !== undefined && tu.turn_id !== null
          ? tu.turn_id : undefined;
        const tuTs: string | undefined = tu.timestamp !== undefined && tu.timestamp !== null
          ? tu.timestamp : undefined;
        const parentTurn: number | undefined = m.turn_id !== undefined && m.turn_id !== null
          ? m.turn_id : undefined;
        const uRow: ChatMessage = {
          id: mkID(tuID !== undefined ? `m-${tuID}` : `tu-${batchTag}-${i}`),
          role: 'user',
          content: tu.content,
          iterations: [],
          turnID: tuTurn !== undefined ? tuTurn
            : (parentTurn !== undefined ? parentTurn : 0),
          timestamp: tuTs !== undefined ? tuTs : '',
          isPartial: false,
          // ⛔ dbID 必须取 **user 行自己**的 id —— 绝不能回落成 assistant 行的 id，
          //    否则 rewind 会把这条 user msg 回滚到 assistant 行上（web 同处 CR 抓到的 bug）。
          dbID: tuID !== undefined ? tuID : (i + 1),
        };
        out.push(uRow);
      }
      const role: ChatMessageRole = m.role === 'user' ? 'user'
        : (m.role === 'system' ? 'system' : 'assistant');
      const hasID: boolean = m.id !== undefined && m.id !== null;
      const mid: string = mkID(hasID ? `m-${m.id}` : `hist-${batchTag}-${i}`);
      // turn 内压缩点（`protocol/events.go:317`，后端早已下发 —— 本仓此前**零消费**）：
      // 空 ⇒ 不设键（保持既有行对象形状，渲染层零产出）。
      const comps: WebCompaction[] = toHistoryCompactions(m.compactions);
      // ── 中断标记：正文**开头**的 `[interrupted]` 不是用户可见正文（web 权威同口径）───────────
      // 语义与真机缺陷见 `core/streammerge.ets:INTERRUPTED_MARKER` 的长注释。
      const rawContent: string = m.content !== undefined && m.content !== null ? m.content : '';
      const content: string = stripInterruptedMarker(rawContent);
      const iters: WebIteration[] = ChatStore.toWebIterations(m.iterations);
      // 剥完**空**且**无迭代** ⇒ 该行没有任何可见信息（web 文档规则 1/5：跳过纯标记行）；
      // 留着只会是一张空气泡卡片。⛔ 只可能命中 `assistant`（用户正文不含该标记）。
      if (role === 'assistant' && content.length === 0 && iters.length === 0) {
        continue;
      }
      const msg: ChatMessage = {
        id: mid,
        role,
        // ⚠️ 外来 JSON（`/api/history` 的 messages 元素）：字符串/数值字段都可能是
        //    JSON null（Go nil → null）⇒ 必须**显式三态**（`isPresent` 不做类型收窄，
        //    用在赋值/成员访问位置会因 `| null` 而编译不过）
        content,
        iterations: iters,
        turnID: m.turn_id !== undefined && m.turn_id !== null ? m.turn_id : 0,
        timestamp: m.timestamp !== undefined && m.timestamp !== null ? m.timestamp : '',
        isPartial: false,
        dbID: m.id,
        compactions: comps.length > 0 ? comps : undefined,
        regionsBefore: m.regions_before !== undefined && m.regions_before !== null
          ? m.regions_before : undefined,
      };
      out.push(msg);
    }
    return out;
  }

  /** 原生 HistoryIteration[] → web WebIteration[]（经 normalizeWebIteration 归一，web 同一函数）。 */
  static toWebIterations(iters: HistoryIteration[] | null | undefined): WebIteration[] {
    const out: WebIteration[] = [];
    const src: HistoryIteration[] = arrOrEmpty(iters);
    for (let i = 0; i < src.length; i++) {
      const w: WebIteration | null = normalizeWebIteration(src[i]);
      if (w !== null) {
        out.push(w);
      }
    }
    return out;
  }

  /**
   * 历史消息 → 渲染行（**走状态机**：`historyToReplaced → reduce → deriveRows → applyRow`）。
   * 与页面渲染同一条路径（不再是独立的手写映射）。live 诊断测试用。
   */
  static rowsFromHistory(messages: HistoryMessage[]): ChatRow[] {
    const ev: DomainEvent = historyToReplaced(ChatStore.toChatMessages(messages, 0), null);
    const state: ChatState = reduce(initialChatState(''), ev);
    const derived: readonly Row[] = deriveRows(state);
    const out: ChatRow[] = [];
    for (let i = 0; i < derived.length; i++) {
      const row: ChatRow = new ChatRow();
      row.id = derived[i].id;
      applyRow(row, derived[i]);
      out.push(row);
    }
    return out;
  }

  /**
   * 加载该 turn **更早的展示区域**（REST 历史是折叠视图：每 turn 只下发尾部 100 个区域）。
   *
   * 契约（channel/web/web_api.go handleRegions）：POST /api/regions
   *   body {channel, chat_id, turn_id, before_iteration, region_limit}
   *   data {iterations, regions_before}
   * `before_iteration` 取该 turn 当前**最小**迭代号 ⇒ 取回更早一段；新区段前插并去重，
   * `regions_before` 归零前可反复加载。与 Web 端同源语义（"⌃ 更早的 N 个区域"）。
   */
  async loadEarlierRegions(row: ChatRow): Promise<void> {
    if (row.regionsBefore <= 0) {
      return;
    }
    // ⛔ 取段游标 = 洞的上边界（有洞时），否则最小迭代号（web `AssistantMessage.tsx:104-117`）。
    //    旧实现恒取 minIter ⇒ 有洞时请求到已持有的段、**洞永远填不上**。
    const before: number = gapTopBefore(row.iterations);
    if (before <= 0) {
      return;
    }
    const data: RegionsData = await this.http.postAs<RegionsData>('/api/regions', new RegionsReq(
      this.channel, this.wireChatId(), row.turnID, before, 100));
    const older: HistoryIteration[] = arrOrEmpty(data.iterations);
    // 段边界去重后经 `iterations_loaded` 交给状态机 —— reduce 做 union 合并（同号权威
    // 覆盖、轻字段永不覆盖完整数据），与 web `iterations_loaded` 同一语义。
    const seen: Set<number> = new Set();
    const merged: WebIteration[] = [];
    for (let i = 0; i < older.length; i++) {
      const n: number = older[i].iteration;
      if (seen.has(n)) {
        continue;
      }
      seen.add(n);
      const w: WebIteration | null = normalizeWebIteration(older[i]);
      if (w !== null) {
        merged.push(w);
      }
    }
    this.pushEvent({
      type: 'iterations_loaded',
      turnID: row.turnID,
      iterations: merged,
      regionsBefore: isPresent(data.regions_before) ? data.regions_before : 0,
    });
  }

  /** 按需拉取某迭代的完整工具详情（折叠视图下 summary/args/detail 默认不下发）。 */
  async fetchIterationDetail(turnID: number, iteration: number): Promise<HistoryIteration | null> {
    try {
      const data: IterationDetailData = await this.http.postAs<IterationDetailData>(
        '/api/iteration_detail', new IterationDetailReq(
          this.channel, this.wireChatId(), turnID, iteration));
      const it: HistoryIteration | undefined = data.iteration;
      if (it === undefined) {
        return null;
      }
      const w: WebIteration | null = normalizeWebIteration(it);
      if (w !== null) {
        // 同号权威覆盖（regionsBefore 缺省 = 不变 —— 详情 hydrate 不动区域计数）。
        this.pushEvent({ type: 'iterations_loaded', turnID, iterations: [w] });
      }
      return it;
    } catch (e) {
      return null;
    }
  }

  // ── 发送 / 取消 ────────────────────────────────────────────────────────────

  /**
   * 发送消息。
   *
   * 事件全部交给状态机（对齐 web `useChatMessages` 的 user_sent/user_ack/user_fail）：
   *  · user_sent —— 乐观 user 行进 pendingUsers（`sending=true`）；
   *  · user_ack  —— REST 成功：清 sending、回填 turnHint/dbID/queued/command；
   *  · user_fail —— REST 失败：移除乐观行（对齐旧 removeById 语义）。
   *
   * `interrupt=true` ⇒ **⚡ 插话**：服务端把它注入正在跑的 turn（下一个工具边界作为
   * 合成 `user_interrupt` 工具结果喂给模型），**不排队、不产生 user 行、不带 turn_id** ——
   * 因此插话路径**不发 user_sent**（否则会留下永远等不到后端确认的幽灵消息）。
   * 会话空闲时服务端会退化为普通发送，返回值会如实反映（`interrupted=false`）。
   *
   * @returns 是否真的插话成功（true=已注入当前回合）
   */
  async send(text: string, uploadKeys?: string[], fileNames?: string[], fileSizes?: number[],
    interrupt?: boolean): Promise<boolean> {
    if (this.demoMode) {
      this.lastSendAt = Date.now();
      this.demoRunTurn(text, false);
      return false;
    }
    const isInterrupt: boolean = interrupt === true;
    this.lastSendAt = Date.now();
    // ★ 用户 P0（2026-10-18）「有概率发送后不立刻出现思考中」：在**任何网络 await 之前**
    //   置本地发送意图窗（非命令、非插话）。旧实现只在 ack 且 ack.turn_id>0 后才乐观置
    //   running ⇒ ack 慢/缺 turn_id 时用户点了发送却毫无反馈，直到 turn_started。
    //   命令（!cmd / slash）没有 turn 生命周期，不得进入该窗口。
    const commandLike: boolean = text.startsWith('!') || text.startsWith('/');
    const intentStamp: number = Date.now();
    if (!isInterrupt && !commandLike) {
      this.intentBusyAt = intentStamp;
      this.onUpdate();
      // 兜底止损：8s 内既没有 turn_started 也没有 ack 的 running ⇒ 不永久卡 busy。
      setTimeout(() => {
        if (this.intentBusyAt === intentStamp) {
          this.intentBusyAt = 0;
          this.onUpdate();
        }
      }, 8500);
    }
    // 全局唯一 requestID...
    const requestID: string = newRequestID()
    console.info(`[SEND] enter: textLen=${text.length} channel=${this.channel} chatId=${this.currentChatId} interrupt=${isInterrupt} rid=${requestID}`)
    log('send', `发送 chat=${this.currentChatId} len=${text.length}${isInterrupt ? ' (插话)' : ''} rid=${requestID}`);
    if (!isInterrupt) {
      const c: NonEmptyS | null = nonEmptyStr(text);
      if (c !== null) {
        const row: UserRow = {
          id: `local-${requestID}`,
          content: c,
          timestamp: new Date().toISOString(),
          isNotification: false,
          queued: false,
          sending: true,
          requestID,
          turnHint: undefined,
          dbID: undefined,
        };
        this.pushEvent({ type: 'user_sent', row });
      }
    }
    try {
      // ⛔ **出网会话键必须规范化**（与 cancel/history/queue 同一 `wireChatId()`）：
      //   旧实现用 `currentChatId` 原值 —— 当它是全键（`web:chat_X`）时服务端按
      //   `channel + ':' + chat_id` 组键 ⇒ 落到 `web:web:chat_X` **幽灵会话**
      //   （send 与 cancel 打不同会话；用户症状：有网但发消息无效 / cancel 无效）。
      const wireID: string = this.wireChatId();
      if (wireID.length === 0) {
        throw new Error('会话未就绪（chat_id 为空）');
      }
      // ⛔ 发送走**短读超时**（`HTTP_SEND_READ_TIMEOUT_MS`，非默认 120s）：切后台后半开连接会让
      //    乐观行无反馈地挂 2 分钟（用户 2026-10-16 P0「显示已发、实际没发」）。短超时 ⇒
      //    快速抛错 ⇒ `sendDraft` 回滚乐观行 + 明确报错（而不是静默挂着）。
      const raw: string = await this.http.post('/api/message', new MessageReq(
        this.channel, wireID, text, uploadKeys, fileNames, fileSizes, isInterrupt,
        requestID), HTTP_SEND_READ_TIMEOUT_MS);
      if (isInterrupt) {
        // 对齐 web（`sseConnection.ts:473` → 服务端 `web_rest.go:95-104`）：插话成功的**唯一判据**是
        // 响应里的 `interrupted === true`。旧实现无条件 `return true` ⇒ 服务端在"会话已空闲"时
        // 把插话**降级成普通发送**（`session_queue.go:484`），前端却报"插话成功"，随后
        // `turn_started.content` 在回复之后又冒出一条**独立 user 气泡**（用户看到的就是这个 bug）。
        let ack: SendAck = {};
        try {
          ack = JSON.parse(raw) as SendAck;
        } catch (e) {
          ack = {};
        }
        return ack.interrupted === true;
      }
      let ack: SendAck = {};
      try {
        ack = JSON.parse(raw) as SendAck;
      } catch (e) {
        ack = {};
      }
      // ★ 乐观置 running（**根因修复**，用户 2026-10-17 P0「mid-turn idle 冻结」）——
      //   逐字对齐 web `AgentPanel.tsx:177-180` 的 `store.setStatus(selector,'running')`：
      //   发送成功后**立刻**把会话标为 running（`state.sessionRunning=true`）。
      //   必要性：服务端 `/api/session-tree` 的 `running` 字段是 `omitempty`（false 缺字段、
      //   只有**处理中**才回 true）⇒ 落库对账是**慢路径**；不乐观置位时，整个 turn 期间
      //   `sessionRunning` 恒为 false ⇒ 状态机的粗粒度 idle 闸门（`reduce.ts`
      //   `if (s.sessionRunning) return s`；`store.ets` `applyLocalIdle` 的非权威闸门）
      //   **恒失效** ⇒ 一条迟到/回放的 `session(idle)`/`agent-idle` 就把在飞 turn 冻结，
      //   同迭代 stream 紧接着被静默丢弃（用户症状：「live 进度消失且永不再更新」）。
      //   真结束由权威路径收尾（PhaseDone ⇒ `applyLocalIdle(true)` ⇒ `session_running(false)`）。
      //   ⛔ 命令（`!cmd`/slash）无 turn 生命周期 ⇒ 不置位（`sendStartsTurn` 门控 —— 否则永久卡 busy）。
      if (sendStartsTurn(ack.turn_id, ack.queued)) {
        this.intentBusyAt = Date.now();
        this.pushEvent({ type: 'session_running', running: true });
      } else if (ack.command === true) {
        // 命令无 turn：清发送意图，避免 composer 假 busy。
        this.intentBusyAt = 0;
      } else if (!isInterrupt) {
        // 200 但没有 turn_id/queued 不等于“服务端没受理”：普通消息可能由 worker 异步
        // 启动（远端实测 user 已落库、assistant 已产出，但客户端没收到 SSE）。
        // 不在这里 user_fail；统一由下方的 post-ack history 对账拉回真实回合。
      }
      this.pushEvent({
        type: 'user_ack',
        requestID,
        // ⚠️ `/api/message` 回执是外来 JSON：字段可能 null ⇒ 显式三态（null 落进 dbID 会污染后续分页游标）
        dbID: ack.id !== undefined && ack.id !== null ? ack.id : 0,
        turnHint: ack.turn_id !== undefined && ack.turn_id !== null ? ack.turn_id : undefined,
        queued: ack.queued === true,
        command: ack.command === true,
      });
      // ★ 所有普通发送：短延迟做一次权威 history 对账。SSE 可能半开/丢 turn_started，
      //   只靠事件会让 user 行永远停在“已发送但无回复”；history 是服务端真实回合的兜底。
      //   （命令无 turn；插话由 interrupted 响应路径处理。）
      if (!isInterrupt && !commandLike) {
        const chatAtSend: string = this.currentChatId;
        setTimeout(() => {
          if (this.currentChatId === chatAtSend) {
            this.resyncAfterResume('send-ack-sync');
          }
        }, 3000);
      }
      return ack.interrupted === true;
    } catch (e) {
      // 失败：清掉本次发送意图窗（成功路径由 turn_started/8s 兜底接管）。
      if (this.intentBusyAt === intentStamp) {
        this.intentBusyAt = 0;
      }
      this.pushEvent({ type: 'user_fail', requestID });
      throw e as Error;
    }
  }

  /**
   * 拉取 LLM 配置（`GET /api/llm-config` → 订阅/模型条目/上下文上限）。
   * 只读；切换见 `setModel` / `setMaxContext`。
   */
  async loadLlmConfig(): Promise<void> {
    // 三态：先落"加载中"（面板立刻能读"正在读"，不是空白），再按**真结果**落 `ready`/`error`。
    // ⛔ 旧实现把失败**静默**吞掉（下方 catch 空体）⇒ 模型列表面板只能永远显示"加载中"、
    //    **永久转圈**。这里把既有取数路径的**真结果**暴露给面板（`llmConfigState`/`llmConfigError`）。
    this.llmConfigState = 'loading';
    this.llmConfigError = '';
    this.onUpdate();
    try {
      // ⛔ **为什么不再用 `GET /api/llm-config`**（2026-10-12 实测根因）：服务端
      //   `channel/web/web.go:918` 把该路由注册为 `authenticatedPOST(...)`（**只收 POST**）
      //   ⇒ **GET 恒 405**（实测 0.4ms 返回 `405 method not allowed`）⇒ 模型列**永远拉不到**；
      //   旧版还把这失败**静默吞掉** ⇒ 模型面板**永久转圈**（用户实报）。
      //   web 取模型列表从来不走走那条 REST（`useLLMSettings.ts:10`：All RPC calls go through
      //   `WSConnection.rpc` → `POST /api/rpc`）⇒ 与 web 同源的正确入口 = RPC `list_all_model_entries`。
      // ⚠️ `rpc()` 已解开信封并返回 `data`；服务端 `rpc0err` 在无条目时回 **null**
      //   ⇒ 归一成"空数组"（`arrOrEmpty`），但仍是**成功** ⇒ `ready`（面板显示**空态引导**），
      //   ⛔ **不是** `error`（那专指请求真的失败）。
      const entries: LlmModelEntry[] = await rpc<LlmModelEntry[]>(this.http, RPC_LIST_ALL_MODEL_ENTRIES);
      // 用户级**上下文上限**：与 web 同源走 RPC（⛔ 不是 `GET /api/llm-config`，那条是 POST-only
      // ⇒ 恒 405 ⇒ 面板永远显示「未设置」，2026-10-12 真机实证）。该值**单独兜底**：
      // 取不到/抛错 ⇒ 0（"未设置"），⛔ 不让它拖垮模型列表。
      let maxCtx: number = 0;
      try {
        const mc: number = await rpc<number>(this.http, RPC_GET_USER_MAX_CONTEXT);
        maxCtx = normalizeMaxContext(mc);
      } catch (e) {
        maxCtx = 0;
      }
      this.llmConfig = new LlmConfigEntries(arrOrEmpty(entries), maxCtx);
      this.llmConfigState = 'ready';
      this.onUpdate();
    } catch (e) {
      // 选择栏非关键路径：失败不打断主链路，但**记下真结果**（失败态 + 可读原因）供模型列表面板显示。
      this.llmConfigState = 'error';
      this.llmConfigError = readableRpcError((e as Error).message);
      this.onUpdate();
    }
  }

  /**
   * 拉当前会话的**订阅**（`get_session_subscription` → `{subscription_id?, model?}`）。
   *
   * 三态与 `loadLlmConfig` **同模式**（`loading` → `ready`/`error` + `readableRpcError`）；
   * ⛔ 不新造超时 / `setTimeout`（沿用 `rpc()` 既有网络语义）。
   * ⛔ **channel 必须显式传本会话渠道**：服务端缺省回落 `"cli"`（`rpc_table.go:820-822`）
   *    ⇒ 不传会读到**错的租户行**（同类坑见 `docs/WEB-PARITY.md:371`）。
   */
  async loadSessionSubscription(): Promise<void> {
    if (this.currentChatId.length === 0) {
      return;
    }
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    this.sessionSubState = 'loading';
    this.sessionSubError = '';
    this.onUpdate();
    try {
      const sub: SessionSubscription = await rpc<SessionSubscription>(
        this.http, RPC_GET_SESSION_SUBSCRIPTION,
        new SessionSelectorParams(this.channel, this.wireChatId()));
      if (gen !== this.chatGen || forChat !== this.currentChatId) {
        return;
      }
      this.sessionSubscription = sessionSubscriptionId(sub);
      // 会话级模型（可能只有 `model` 没有 `subscription_id` —— 服务端两个分支，见 rpc.ets:272）
      this.sessionModel = (sub.model !== undefined && sub.model !== null) ? sub.model : '';
      this.sessionSubState = 'ready';
      this.onUpdate();
    } catch (e) {
      if (gen !== this.chatGen || forChat !== this.currentChatId) {
        return;
      }
      // 非关键路径：失败不打断主链路，但**记下真结果**（面板据此可显示失败态/可读原因）。
      this.sessionSubState = 'error';
      this.sessionSubError = readableRpcError((e as Error).message);
      this.onUpdate();
    }
  }

  /**
   * 切换模型（`POST /api/llm-config/model`，body `{sub_id, model}`）。
   *
   * ⚠️ 必须带 `sub_id` —— 项目铁律：绝不裸模型名解析（同名模型可能属于多个订阅）。
   * 服务端按 sender 生效，切换后立刻刷新配置与状态（用量里的模型名会变）。
   */
  /**
   * P0（2026-10-17 用户亲报「切换模型出错」）：`setModel` **已删** —— 它打
   * `POST /api/llm-config/model`，服务端未注册该路由（`channel/web/web.go:918` 只注册
   * 裸 `/api/llm-config`，POST 语义是配置 upsert）⇒ 恒 404。切换模型的正解 = 聊天命令
   * `/set-model <订阅名> <模型名>`（`store.send`，见 `Index.pickModel`）。
   */

  /** 设置上下文上限（`POST /api/llm-max-context`）。 */
  async setMaxContext(n: number): Promise<void> {
    // ⛔ 与 web 同源：写入口是 RPC `set_user_max_context`（`rpc_table.go:679-681`）。
    //    旧实现打 `POST /api/llm-max-context` —— `channel/web/web.go` **未注册**该路由 ⇒ 恒 404
    //    ⇒ 设置静默不生效（真机：设了 1M 却显示「未设置」，2026-10-12）。
    await rpc<void>(this.http, RPC_SET_USER_MAX_CONTEXT, new MaxContextParams(n));
    await this.loadLlmConfig();
    await this.loadStatus();
  }

  /**
   * 拉取会话状态（`/api/session/status` → `{token_usage, cwd, todos}`）。
   *
   * 为什么单独一次：它是**服务端权威**的 todos / token 用量（不做估算，见项目铁律）。
   * 在打开会话、每轮结束（idle）时各拉一次即可 —— 不做轮询。
   */
  async loadStatus(): Promise<void> {
    if (this.currentChatId.length === 0) {
      return;
    }
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    try {
      const st: SessionStatus = await this.http.postAs<SessionStatus>(
        '/api/session/status', new SessionReq(this.channel, this.wireChatId()));
      if (gen !== this.chatGen || forChat !== this.currentChatId) {
        return;
      }
      // ⚠️ 外来 JSON：`token_usage` 可能是 JSON null（无用量时服务端给 nil 指针）⇒ 必须在这里
      //    收口成 `undefined`，否则 null 会落进 `usage: TokenUsage | undefined` 字段，
      //    下游 `usage !== undefined` 判真 ⇒ 取 `usage.prompt_tokens` 炸（同类缺陷的典型形态）。
      this.usage = st.token_usage !== undefined && st.token_usage !== null ? st.token_usage : undefined;
      this.cwd = st.cwd !== undefined && st.cwd !== null ? st.cwd : '';
      this.todos = arrOrEmpty(st.todos);
      this.onUpdate();
    } catch (e) {
      // 状态拉取失败不影响主链路（历史/发送优先）
    }
  }

  /**
   * 上传一个附件，返回服务端给的 `upload_key`（发消息时放进 `upload_keys`）。
   *
   * 服务端契约（`channel/web/web_file.go` 的 writeJSON）：`{upload_key, name, size}` ——
   * 与 Web 前端读的字段一致（`res.upload_key`）。字段名写错会得到 undefined ⇒ 附件静默丢失。
   */
  async uploadAttachment(name: string, data: ArrayBuffer, mime: string): Promise<string> {
    const raw: string = await this.http.uploadBytes('/api/files/upload', name, data, mime);
    const res: UploadResult = JSON.parse(raw) as UploadResult;
    const key: string | undefined = res.upload_key;
    if (key === undefined || key.length === 0) {
      throw new Error('上传成功但响应里没有 upload_key（服务端契约变化？）');
    }
    return key;
  }

  /** `cancel` 请求在飞（web `useChatMessages.ts:101` `cancelling`）⇒ 停止按钮**转圈**。 */
  cancelling: boolean = false;

  /**
   * 取消当前回合 —— **逐字移植 web**（`useChatMessages.ts:870-884` + `AgentPanel.tsx:191-197`）：
   *   ① 置 `cancelling=true`（按钮转圈；web `MessageInput.tsx:938` `(cancelling && !canSend && busy)`）；
   *   ② 发取消请求；
   *   ③ **成功后立即乐观进 idle** —— web 原文：*"Optimistically mark the session as idle so the
   *      UI exits busy immediately — don't wait for the SSE session(idle) event"*
   *      （用户要求同款手感：*"点了 cancel，应该 spin 一下，请求成功立刻进入 idle"*）；
   *   ④ 无论成败都复位 `cancelling`（失败 ⇒ **保持 busy**，界面不假装已停）。
   *
   * 乐观 idle **复用状态机已有的两类事件**（⛔ 不新造状态机语义、不绕过 `reduce`）：
   *   · `session_running(false)`：清权威闸门 + 把仍 live 的 turn 定格（`reduce.ts:512-530`）；
   *   · `session(busy=false)`：清 coarse busy（`reduce.ts:1220-1229`）。
   *   ⛔ 顺序不可反：`session` 的 idle 分支在 `sessionRunning` 仍为 true 时是 **no-op**（`:1226`）。
   */
  private cancelInFlight: Promise<void> | null = null;

  cancel(): Promise<void> {
    // ⛔ 重复点击必须**复用同一个在飞 Promise**，不能静默 return：
    //   UI 的 `cancelSpinHold` 会把"立即 resolve"当成取消成功、停止转圈，
    //   但请求其实没发/没完成（用户亲报：按钮不转圈、点很多次都没用）。
    if (this.cancelInFlight !== null) {
      return this.cancelInFlight;
    }
    const p: Promise<void> = this.performCancel();
    this.cancelInFlight = p;
    return p;
  }

  private async performCancel(): Promise<void> {
    const chatAt: string = this.currentChatId;
    const genAt: number = this.chatGen;
    this.cancelling = true;
    this.onUpdate();
    try {
      // ⛔ **短超时**（8s，非默认 120s）：取消请求挂死时 `cancelling` 会锁住两层
      //   spinner 闸门（本字段 + 页面 `cancelSpinHold`）⇒ 用户看到"永久转圈"，
      //   且重复点击被静默 return（用户症状）。有界超时 ⇒ finally 必然复位。
      await this.http.post('/api/cancel', new SessionReq(this.channel, this.wireChatId()),
        HTTP_CANCEL_READ_TIMEOUT_MS);
      // 取消成功 = 权威 idle 证据（与 applyLocalIdle 同一字段）：15s 意图窗内
      // session-tree 对账不得因"发送时的 fresh busy 意图"把 busy 翻回来。
      // ⛔ 但若期间已切到别的会话/代数，旧回包绝不能把新会话标 idle。
      if (genAt !== this.chatGen || chatAt !== this.currentChatId) {
        return;
      }
      this.intentIdleAt = Date.now();
      this.pushEvents([
        { type: 'session_running', running: false },
        { type: 'session', busy: false },
      ]);
    } finally {
      this.cancelling = false;
      this.cancelInFlight = null;
      this.onUpdate();
    }
  }

  // ── AskUser ────────────────────────────────────────────────────────────────

  /**
   * 从 progress 载荷里提取 pending 问题（**自身防御**）。
   *
   * ⚠️ 入参必须收 `| null`：`POST /api/history` 对**没有在飞进度**的会话返回
   *    `"active_progress": null`（JSON **null**，不是缺字段）。类型标注 `| undefined`
   *    骗不过运行时 —— 这是 2026-10-11 真机 P0 的根因（点「＋ 新建」100% 失败，
   *    Toast `Cannot read property questions of null`；链路：`createSession → openSession
   *    → loadHistoryInner → 这里`）。
   *
   * 为什么把安全性长在**本函数里**、而不是靠调用方判空：调用方判空正是它能再犯的原因
   * （同类先例见 `:399` 的 `toLocalSettings(null)` 注释：服务端 nil map → JSON null）。
   */
  private pickAskUserFromProgress(p: ProgressEvent | null | undefined): void {
    if (p === undefined || p === null) {
      return; // 三态守卫：JSON null 与"缺字段"一视同仁（顺便让下面的 `p.xxx` 通过类型收窄）
    }
    const qs: AskQuestion[] = arrOrEmpty(p.questions);
    if (qs.length === 0) {
      return;
    }
    // ⛔ 闪回防线（用户 2026-10-16 亲报「取消/提交后消失了一瞬间又出现」）：收尾期服务端会重发
    //    **同一个** pending 问题（`request_id` 相同）⇒ 一律不弹；新问题的 id 必然不同 ⇒ 照常弹。
    const rid: string | undefined = p.request_id;
    if (rid !== undefined && rid !== null && rid.length > 0 && rid === this.answeredAskId) {
      return;
    }
    const prompt: AskUserPrompt = { request_id: p.request_id, questions: qs };
    this.askUser = prompt;
  }

  /** 回答（answers: questionId → 文本）。cancelled=true 表示"取消/跳过"。 */
  async respondAsk(answers: Record<string, string>, cancelled: boolean): Promise<void> {
    const prompt: AskUserPrompt | null = this.askUser;
    if (prompt === null) {
      return;
    }
    let firstQ: string = '';
    const qs: AskQuestion[] = arrOrEmpty(prompt.questions);
    // ⚠️ 外来 JSON（ask_user 载荷）：`id` 可能 null（Go nil → null）⇒ 显式三态，别把 null 当问题 id 发回去
    const firstId: string | null | undefined = qs.length > 0 ? qs[0].id : undefined;
    if (firstId !== undefined && firstId !== null && firstId.length > 0) {
      firstQ = firstId;
    }
    const single: string = answers[firstQ] !== undefined ? answers[firstQ] : '';
    // ⛔ **点击即清**（用户 2026-10-16 亲报「提交/cancel 后必须立刻消失」）：
    //   旧实现清在 `await POST` 之后 ⇒ 往返期间面板仍在，且期间任何在途 progress 载荷都会把它
    //   **写回** ⇒ 肉眼看到"消失了一瞬间又出现"。⇒ 先清 + 记 id 抑制回填，再发请求；
    //   失败才把问题**还回来**（可重试，并撤销抑制）—— ⛔ 不假装成功。
    const rid: string = prompt.request_id !== undefined && prompt.request_id !== null ? prompt.request_id : '';
    this.answeredAskId = rid;
    this.askUser = null;
    this.onUpdate();
    try {
      await this.http.post('/api/ask_user/respond', new AskRespondReq(
        this.channel, this.wireChatId(), firstQ, single, answers, cancelled));
    } catch (e) {
      this.answeredAskId = '';
      this.askUser = prompt;
      this.onUpdate();
      // ⛔ ArkTS 禁 `throw <任意类型>`（arkts-limited-throw）⇒ 包成 `Error` 再抛（调用方只读 message）。
      const msg: string = e instanceof Error ? e.message : String(e);
      throw new Error(msg); // 调用方（页面）负责可读提示 —— 与既有 catch 路径一致
    }
  }

  // ── 待发队列 ───────────────────────────────────────────────────────────────

  async loadQueue(): Promise<void> {
    const gen: number = this.chatGen;
    const forChat: string = this.currentChatId;
    try {
      const data: QueueListData = await this.http.postAs<QueueListData>(
        '/api/queue/list', new SessionReq(this.channel, this.wireChatId()));
      if (gen !== this.chatGen || forChat !== this.currentChatId) {
        return;
      }
      const items: QueueItem[] = arrOrEmpty(data.items);
      const list: QueueItem[] = items.length > 0 ? items : arrOrEmpty(data.queue);
      this.queue = list;
      this.onUpdate();
    } catch (e) {
      // 队列不可用时静默（不影响主链路）
    }
  }

  async cancelQueued(msgId: string): Promise<void> {
    await this.http.post('/api/queue/cancel', new QueueCancelReq(this.channel, this.wireChatId(), msgId));
    await this.loadQueue();
  }

  /** 上/下移一格：把当前顺序投影回服务端（msg_ids 即权威顺序）。 */
  async moveQueued(msgId: string, dir: number): Promise<void> {
    const ids: string[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      // ⚠️ 外来 JSON（`/api/queue/list` 的 items/queue 元素）：两个 id 字段都可能 null ⇒ 三态
      const mid: string | null | undefined = this.queue[i].msg_id;
      const qid: string | null | undefined = this.queue[i].id;
      const id: string = mid !== undefined && mid !== null ? mid
        : (qid !== undefined && qid !== null ? qid : '');
      if (id.length > 0) {
        ids.push(id);
      }
    }
    const at: number = ids.indexOf(msgId);
    if (at < 0) {
      return;
    }
    const to: number = at + dir;
    if (to < 0 || to >= ids.length) {
      return;
    }
    const tmp: string = ids[at];
    ids[at] = ids[to];
    ids[to] = tmp;
    await this.http.post('/api/queue/reorder', new QueueReorderReq(this.channel, this.wireChatId(), ids));
    await this.loadQueue();
  }

  /**
   * 清空待发队列 —— **无独立端点**（web 同款）：**逐个** `POST /api/queue/cancel`。
   *
   * ⚠️ 先快照 id 再逐个取消：`cancelQueued` 内的 `loadQueue` 会**改写** `this.queue`，
   *    边遍历边取消会漏项。
   */
  async clearQueue(): Promise<void> {
    const ids: string[] = this.queuedMsgIds();
    for (let i = 0; i < ids.length; i++) {
      await this.cancelQueued(ids[i]);
    }
  }

  /** 当前队列里可寻址的 msg_id（顺序 = 队列顺序）。 */
  private queuedMsgIds(): string[] {
    const ids: string[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const id: string = queueItemId(this.queue[i]);
      if (id.length > 0) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * **立刻插话（interject）** —— 把队列里某条待发消息**立刻注入正在跑的 turn**。
   *
   * web `useChatMessages.ts:899-920 interjectQueued` 的原生移植（**无独立端点**）：
   *   ① `POST /api/queue/cancel {…, msg_id}` 先从队列移除；
   *   ② 以 `interrupt=true` 重发内容（`send(content, …, true)`）—— 服务端把它注入当前 turn 的
   *      下一个工具边界；会话空闲时自动退化为普通发送（返回值如实反映）。
   *
   * ⛔ 两个真坑（web CR 记档）：
   *   · **必须传完整 `content`**，绝不能用服务端截断的 `preview`（>80 runes 会丢内容，
   *     而队列原件已被取消 ⇒ 不可恢复）；
   *   · cancel 返回 `{cancelled:false, already_processing:true}` **不是错误**（消息已被
   *     dequeue 正在处理，用户"移出队列"的意图已满足）—— `http.post` 只在非 2xx 抛，
   *     故此处**不得**把 `cancelled:false` 当失败、必须继续 send。
   *
   * @returns send 是否真的插话成功（`interrupted===true`）
   */
  async interjectQueued(msgId: string, content: string): Promise<boolean> {
    // ① 先从队列移除（already_processing=true 不是错误 —— 见上）
    await this.cancelQueued(msgId);
    // ② 以 interrupt=true 重发**完整**内容
    return await this.send(content, undefined, undefined, undefined, true);
  }

  // ── 消息编辑并重发（rewind） ────────────────────────────────────────────────

  /**
   * **消息编辑并重发（rewind）** —— web `AgentPanel.tsx:929 rewindTo` 的原生移植。
   *
   * ⛔ 铁律顺序（web `AgentPanel.tsx:959-970` 注释钉死，**一步都不能省**）：
   *   ① **REST rewind**：`POST /api/history/rewind {channel, chat_id, history_id}`
   *      （服务端删掉该 history_id 起的消息）；
   *   ② **reset 状态机**：`initialChatState` 整体重建 —— 漏了这一步，被删 assistant 的
   *      live 残渣会在下一个 `turn_started` 时提交，把**已被回退掉的回复回放**在新回合下方；
   *   ③ **reload**（= `loadHistory`）：**必须在 send 之前** —— 否则 send 的乐观 user 行会被
   *      紧随其后的新历史抹掉（web 注释：messageMutationGen 竞态）；
   *   ④ **send(editedContent)**：把编辑后的内容作为新消息发出。
   *
   * @param historyId    目标 user 行的 DB id（`resolveRewindDBID` 解出；<=0 直接拒绝 —— 服务端亦 400）
   * @param editedContent 编辑后的完整内容（非空）
   * @returns 是否执行了回退
   */
  async rewindTo(historyId: number, editedContent: string): Promise<boolean> {
    if (historyId <= 0 || editedContent.length === 0) {
      return false;
    }
    // ① rewind（先删服务端消息）
    await this.http.post('/api/history/rewind',
      new RewindReq(this.channel, this.wireChatId(), historyId));
    // ② reset 状态机（漏了 ⇒ 被删的 assistant 回放）
    this.resetStateMachine();
    // ③ reload 必须在 send 之前（否则乐观行被新历史抹掉）
    await this.loadHistory();
    // ④ 发送编辑后的内容
    await this.send(editedContent);
    return true;
  }

  /**
   * 从当前会话的历史行解出目标 user 行的 DB id（纯逻辑见 `core/msgops.ets:rewindTargetDBID`）。
   * 找不到返回 0（= 尚未落库/不可用）。
   */
  resolveRewindDBID(target: RewindTarget): number {
    return rewindTargetDBID(this.history, target);
  }

  /**
   * rewind 的**入口**（页面用）：先解析目标 DB id，解析不到时**拉一次新鲜历史**再解析
   * （对齐 web `AgentPanel.tsx:944-948`：回声行缺 dbID 时用 `fetchHistory` 兜底），
   * 然后再走 {@link rewindTo} 的完整铁律顺序。
   *
   * @returns 是否执行了回退（false = 目标不可用/未落库）
   */
  async rewindToMessage(target: RewindTarget, editedContent: string): Promise<boolean> {
    let id: number = rewindTargetDBID(this.history, target);
    if (id <= 0) {
      // 新鲜快照兜底：`user_echo` 在入队时发出、dbID 只随历史重载下发。
      await this.loadHistory();
      id = rewindTargetDBID(this.history, target);
    }
    if (id <= 0) {
      return false;
    }
    return await this.rewindTo(id, editedContent);
  }

  /**
   * 整体复位状态机 + 行缓存 + 历史累积（rewind / 重载前用）。
   * 与 `openSession` 的复位同源（`initialChatState` —— 杜绝"漏重置某个字段"）。
   */
  private resetStateMachine(): void {
    this.resetRows();
    this.history = [];
    this.hasMore = false;
    this.oldestId = 0;
  }

  // ── 插件面板 / 插件目录 ────────────────────────────────────────────────────

  /**
   * 拉取**插件目录**（消费 `web.contributes`，纯逻辑在 `core/pluginhost.ets`）。
   *
   * 服务端 RPC `web_plugin_list`（只返回声明了 `web.entry` 的插件；**无 requireAdmin**，
   * 普通用户可调 —— `serverapp/rpc_table.go:2262-2264` 的 params 只有可选 `rescan`）。
   *
   * ⭐ **URL 语义（波1b 修正，波1c 沿用）**：`module_url` 是**插件前端 ESM 模块资源**
   * （`/plugins/<id>/web/<entry>`，宿主用**同页 `import()`** 加载，见 `core/pluginhost.ets` 文件头），
   * **不是网页**。`item.url` = 权威宿主页 URL（插件在那里按 web 语义运行），ESM 地址只在 `item.moduleUrl`。
   *
   * @param locale 界面语言（清单文本是 i18n key：`manifest.name` / `view.*.title`）；
   *               缺省用仓库默认 `zh-CN`（与 `core/i18n.ets:DEFAULT_LOCALE` 一致）。
   */
  async loadPluginCatalog(locale: string = ''): Promise<PluginCatalog> {
    const lang: string = locale !== undefined && locale.length > 0 ? locale : 'zh-CN';
    try {
      const data: WebPluginListWire = await rpc<WebPluginListWire>(this.http, RPC_WEB_PLUGIN_LIST);
      return buildPluginCatalog(data, lang, this.http.baseUrl);
    } catch (e) {
      // 插件系统不可用（或未启用）⇒ 空目录（不是错误路径）
      return new PluginCatalog();
    }
  }

  /**
   * 兼容既有消费方（`pages/Index.ets:5143` 只用 id/name/url/icon）：
   * 直接投影目录条目 —— `Item` 是 `PluginPanelInfo` 的子类，列出与打开语义都不变。
   */
  async listPlugins(): Promise<PluginPanelInfo[]> {
    const catalog: PluginCatalog = await this.loadPluginCatalog();
    return catalog.items;
  }

  // ── 技能管理（`xbot.skill-manager` 的**原生等价物**；纯逻辑在 `core/skills.ets`）─────────

  /**
   * 拉取**技能列表**（RPC `skill_list` → `agent/skills.go:368 ListSkillsDetailed`）。
   *
   * `projectDir` = 会话工作区根；非空 ⇒ 一并列出 `{projectDir}/.xbot/skills` 与
   * `{projectDir}/.agents/skills` 下的**项目技能**（web 传 `cwd`，见
   * `SkillManagerPanel.tsx:52-55`；原生传 `serverUrl` 之外的会话工作区）。
   *
   * ⚠️ 与 `loadPluginCatalog`（把错误吞成空目录）**故意不同**：技能面板有**失败态 + 重试**
   *    （三态判据），必须能区分"空"与"失败" ⇒ 这里**原样抛出**（`readableRpcError` 由调用方格式化）。
   */
  async listSkills(projectDir: string): Promise<SkillItem[]> {
    const raw: SkillWire[] = await rpc<SkillWire[]>(this.http, RPC_SKILL_LIST, new SkillListParams(projectDir));
    return parseSkillList(raw);
  }

  /** 启用/禁用一条技能（RPC `skill_set_enabled`；服务端写 `disabled_skills` 黑名单并广播）。 */
  async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    await rpc<SkillSetEnabledAck>(this.http, RPC_SKILL_SET_ENABLED, new SkillSetEnabledParams(name, enabled));
  }

  /**
   * 读取技能的 `SKILL.md` 内容（RPC `skill_get_content`）。
   *
   * ⛔ `path` 是**技能目录**（不是文件）：服务端自己拼 `SKILL.md`，且只有它能解析内置技能的
   *    `embedded:<name>` 伪路径 ⇒ 客户端**不要**自己拼路径。
   */
  async getSkillContent(path: string): Promise<string> {
    const res: SkillContentWire = await rpc<SkillContentWire>(this.http, RPC_SKILL_GET_CONTENT, new SkillGetContentParams(path));
    return res.content !== undefined && res.content !== null ? res.content : '';
  }

  // ── SSE ────────────────────────────────────────────────────────────────────

  /**
   * 释放这个 store（多会话池驱逐 / 退出登录时调用）。
   *
   * 只做两件事：关掉 SSE（后端资源）与断开 UI 回调（避免已释放的 store 再驱动界面）。
   * 不清数据 —— 池里被驱逐后若用户再切回，重新 openSession 拉一次权威历史即可。
   */
  dispose(): void {
    try {
      this.sse.close();
    } catch (e) {
      // 关闭失败不影响释放语义
    }
    // ⛔ 会话树轮询必须随 store 一起停：被池淘汰的 store 仍持有非空 currentChatId ⇒
    //   旧实现每 30s（busy 5s）继续打 `/api/session-tree`，永不停止（定时器泄漏）。
    if (this.sessionPollTimer !== -1) {
      clearTimeout(this.sessionPollTimer);
      this.sessionPollTimer = -1;
    }
    // ⛔ **解除所有外部回调**（登录/登出死循环的根因）：
    //   dispose 只 close SSE 不清回调时，**已 dispose 的 store 的 in-flight 请求/重连**
    //   仍会把 401 送回页面 → 用户重新登录成功后，又一条迟到 401 触发
    //   `handleAuthExpired`（清 cookie + 回登录页）→ 每隔一个轮询周期重复一次。
    //   这里把 401/API 错误/状态更新全部摘掉（幂等；之后再触发也只是 noop）。
    this.http.onUnauthorized = () => {
    };
    this.http.onApiError = () => {
    };
    this.sse.onUnauthorized = () => {
    };
    this.onAuthExpired = () => {
    };
    this.onUpdate = () => {
    };
  }

  subscribe(): void {
    if (this.demoMode) {
      return;
    }
    if (!this.resumeActive) {
      // 物理约束：只有页面当前 active 的 store 允许建立 SSE。
      // 后台 tab 的 store 只保留历史/草稿，一条连接都不许有。
      return;
    }
    const wireID: string = this.wireChatId();
    if (wireID.length === 0) {
      return;
    }
    // 一次只能连一个 SSE：active store 已处于 open/connecting/reconnecting 时不要重开。
    // （setResumeActive(true) 与 openSession 都会调用本方法；不设闸会在切回池中会话时
    //  同一 store 连两条，后台旧连接还抢事件。）
    if (this.sse.state === 'open' || this.sse.state === 'connecting' || this.sse.state === 'reconnecting') {
      return;
    }
    // ⛔ SSE 订阅也必须用**规范键**（与 send/cancel/history 同源）：全键（`web:chat_X`）
    //   会让服务端把连接挂到 `web:web:chat_X` 幽灵会话 ⇒ 本会话的事件一条都收不到
    //   （用户症状：历史正常、发消息无效、cancel 无效）。
    this.sse.connect(wireID, this.channel, this.http.cookieHeaderForStream(),
      (event: string, data: string) => {
        this.onSse(event, data);
      });
    // ⛔ **无条件会话树轮询**（web `useSessionStore.ts:1012-1014` 原文：
    //   "HTTP (session-tree) is the persistent authority, and the unconditional 30s poll
    //    guarantees convergence even when every SSE event is missed"）。
    //   这是"丢了一条 idle 就永久卡 busy"的唯一解药；本地 SSE 仍是快路径。
    this.scheduleSessionPoll();
  }

  /**
   * 轮询间隔：在飞 5s（收敛快，与 `useTasks` 的"running 时 2s"同族）、空闲 30s（web 基线）。
   * ⛔ 这不是"写死的假延迟"——它是**权威对账周期**，不参与任何业务判定。
   */
  private sessionPollDelayMs(): number {
    return this.busy ? 5000 : 30000;
  }

  private scheduleSessionPoll(): void {
    if (this.sessionPollTimer !== -1) {
      clearTimeout(this.sessionPollTimer);
    }
    this.sessionPollTimer = setTimeout(() => {
      this.sessionPollTimer = -1;
      if (this.currentChatId.length === 0) {
        return;
      }
      this.loadSessions().catch(() => {
        // 对账失败不阻断；下一轮继续
      }).then(() => {
        this.scheduleSessionPoll();
      });
    }, this.sessionPollDelayMs());
  }

  /**
   * 原始 SSE 串的**会话归属**快速判定（不做完整 JSON 解析）。
   *
   * ⛔ 为什么需要它：widget / `bg_task_output` 在 `JSON.parse` **之前**早退，若不先过滤，
   *   别的会话的载荷会覆盖本 store 的会话态字段（widget/bg 都按 chat 推送）⇒ 跨会话串台。
   *   只做一次轻量正则（`"chat_id"` 在顶层与 `session/progress` 嵌套里都能命中），
   *   **只用于这两个低频早退分支**（流式帧仍走下面的完整解析 + `extractEventChatID`）。
   *   抓不到 chat_id ⇒ 放行（legacy 控制消息）。
   */
  private rawChatMatches(data: string): boolean {
    const marker: string = '"chat_id"';
    const i: number = data.indexOf(marker);
    if (i < 0) {
      return true;
    }
    let j: number = i + marker.length;
    while (j < data.length && (data[j] === ' ' || data[j] === '\t' || data[j] === '\n' || data[j] === '\r')) {
      j++;
    }
    if (j >= data.length || data[j] !== ':') {
      return true;
    }
    j++;
    while (j < data.length && (data[j] === ' ' || data[j] === '\t' || data[j] === '\n' || data[j] === '\r')) {
      j++;
    }
    if (j >= data.length || data[j] !== '"') {
      return true;
    }
    j++;
    let end: number = j;
    while (end < data.length && data[end] !== '"' && data[end] !== '\\') {
      end++;
    }
    if (end >= data.length || end === j) {
      return true;
    }
    const chat: string = data.substring(j, end);
    return canonicalChatId(this.channel, chat) === this.wireChatId();
  }

  private onSse(event: string, data: string): void {
    if (event === SseEventType.heartbeat) {
      return;
    }
    // ── 插件 widget 载荷：**收下来、早退**（不给状态机，也不解析）──────────────────
    // ① 为什么必须早退：widget 载荷**不是** `DomainEvent`（`normalize.ts`/`reduce.ts` 都没有
    //    widget 分支）⇒ 落到下面只会被**静默丢弃**（页面永远不知道有 plugin widget）。
    // ② 为什么在 `JSON.parse` **之前**：保留**原始串**（**含坏 JSON**）交给消费方
    //    （`PluginWidgets` 会显式降级成"插件数据无效"），而不是在这里吞掉；且不解析 ⇒ 不可能抛。
    // ③ 只设字段 + `onUpdate()`（页面据此重渲），**不做任何业务解释**（判据在 core/widgetsview）。
    if (isWidgetEvent(event)) {
      if (!this.rawChatMatches(data)) {
        return;
      }
      this.lastWidgetEvent = event;
      this.lastWidgetContent = data;
      this.onUpdate();
      // server push 通知插件：检查 widget 中是否有 "notify" 标记的 span
      this.checkServerNotify(data);
      return;
    }
    // ── #7-1：bg_task_output 增量（web `sseConnection.ts:445` 同款早退——不是 DomainEvent，
    //    落到 reduce 只会被静默丢弃；保留原始串交 UI 层解析——详情面板实时化）。
    if (event === SseEventType.bgTaskOutput) {
      if (!this.rawChatMatches(data)) {
        return;
      }
      this.lastBgOutput = data;
      this.lastBgOutputSeq += 1;
      this.onUpdate();
      return;
    }
    let raw: Record<string, Object>;
    try {
      raw = JSON.parse(data) as Record<string, Object>;
    } catch (e) {
      return;
    }
    // ⛔ **会话归属过滤必须在这里（任何副作用之前）**：
    //   `normalizeEvent` 的过滤只保护走状态机的那条路；而 `ask_user` /
    //   `ask_user_resolved` / `resync_required` / `session` 四个分支**绕过**它
    //   （用户级 fan-out 会把别的会话的 idle 送到本连接）。旧实现直接执行 ⇒
    //   A 的 idle 会把 B 的在飞 turn 收尾（跨会话污染）。用与 normalize 同一份
    //   三层提取（顶层/session/progress）+ 规范键比较。
    const msgChat: string | undefined = extractEventChatID(raw);
    if (msgChat !== undefined && canonicalChatId(this.channel, msgChat) !== this.wireChatId()) {
      return;
    }
    if (event === SseEventType.askUser) {
      const env: SseEnvelope = JSON.parse(data) as SseEnvelope;
      // ⚠️ `progress` 可能是 JSON null（服务端 nil → null）⇒ 三态判空
      if (isPresent(env.progress)) {
        const prevReq: string = this.askRequestId();
        this.pickAskUserFromProgress(env.progress);
        this.onUpdate();
        // 通知旁路（新增）：**待用户回答** —— 同一 request_id 重复送达不重复提醒。
        if (this.askRequestId() !== prevReq) {
          this.notifyOnSse(event, '', null);
        }
      }
      return;
    }
    if (event === SseEventType.askUserResolved) {
      this.askUser = null;
      this.onUpdate();
      return;
    }
    if (event === SseEventType.queueState) {
      this.loadQueue();
      return;
    }
    if (event === SseEventType.resyncRequired) {
      // 环形缓冲已淘汰 ⇒ 回退 DB 权威快照（web 同款语义）。
      //
      // ⛔ **必须合并**（2026-10-12 真机 P0「永远加载不完」的真形态，实测）：大/活跃会话
      //   （真机例：`chat_D3D036023DB7` 2513 行）下，服务端因**增量窗口覆盖不了客户端缺口**
      //   会**反复**下发 `resync_required`；而每次重载只取 `limit=30` 的**快照尾部**，
      //   **缺口并没有被补上** ⇒ 服务端再发 ⇒ `loadHistory` **自触发成环**
      //   （实测：每 ~230ms 重拉一次、`rows` 每次 +8：212→220→228→…，屏幕永不落定）。
      //   ⇒ 合并策略：**在飞**或**刚拉过**（< `RESYNC_MIN_MS`）直接丢弃这一次 ——
      //   重载总是取**最新**快照，丢弃不会让画面更旧；间隔到点后仍会重新校准。
      const now: number = Date.now();
      if (this.resyncInFlight || now - this.resyncAt < ChatStore.RESYNC_MIN_MS) {
        console.debug(`[SWITCH] resyncCoalesced sid=${this.sid} chatId=${this.currentChatId} dt=${now - this.resyncAt} inFlight=${this.resyncInFlight ? 1 : 0}`);
        return;
      }
      this.resyncAt = now;
      this.resyncInFlight = true;
      console.debug(`[SWITCH] resyncRequired sid=${this.sid} chatId=${this.currentChatId} rows=${this.rows.length}`);
      log('resync', `服务端要求校准 chat=${this.currentChatId} rows=${this.rows.length}`);
      // `loadHistory` 自带 try/catch（不抛）⇒ 两个回调都释放闸门
      this.loadHistory().then(() => {
        this.resyncInFlight = false;
      }, () => {
        this.resyncInFlight = false;
      });
      return;
    }
    // ⛔ 事件 → DomainEvent 的**唯一入口**（逐字移植 web `normalize.ts` 的 normalizeEvent）：
    //   按**事件名**分流（raw.type）、chat 过滤、null 数组归一、数值校验全在 normalize 里。
    //   SSE 事件名 = 权威类型（web WSMessage.type 同源）——绝不按载荷字段猜分类
    //   （服务端会给流式帧盖 iteration，猜错会把 stream_* 当结构化静默丢弃）。
    raw['type'] = event;
    const evs: readonly DomainEvent[] | null = normalizeEvent(raw, this.currentChatId);
    // 水位必须在 `pushEvents` **之前**取（事件应用后 seq 会前移 ⇒ 陈旧守卫失效）。
    const lastSeqBefore: EventSeq | null = this.state.lastSeq;
    this.pushEvents(evs);
    // ── PhaseDone ⇒ **立刻**本地置 idle（逐字移植 web `useProgressStream.ts:1190-1198`
    //    的 `dispatchAgentIdle(ownChatID, ownChannel)`）─────────────────────────────
    //  服务端 `PhaseDone`（`progress.phase === 'done'`）是 turn 结束的**最快**权威信号；
    //  `session(idle)` 要等 `Run()` 完全退出后才发（`agent/agent.go:3531` 的 defer）。
    //  web 据此把会话**内存内**置 idle；原生此前只等 `session(idle)` → REST 往返 ⇒
    //  composer 的 busy 拖后（用户 2026-10-12：*"iter 结束如果最后没 tool … 应该立刻
    //  进入 idle"*）。新鲜性守卫见 `hasFreshPhaseDone`（防回放的上一回合 PhaseDone 误伤）。
    if (hasFreshPhaseDone(evs, lastSeqBefore, this.state.activeTurn)) {
      // 权威路径（已按 turnID 归属校验）⇒ 允许即刻收尾（`authoritative=true`）。
      this.applyLocalIdle(this.currentChatId, true);
    }
    // 通知旁路（新增；不改状态机语义）：回合结束取**上面同一份**归一化结果
    // （`phase_done`）——判据与状态机同源，不二次解析载荷。
    this.notifyOnSse(event, '', evs);
    // session 事件：idle 收尾后刷新权威状态（todos/用量/会话树 running）。状态机本身
    // 已按 reduce 的 session 分支定格/清 activeTurn —— 这里只是 REST 对账（web 的
    // AgentPanel 在 busy→idle 边沿重取 get_goal 的同一语义）。
    if (event === SseEventType.session) {
      const env: SseEnvelope = JSON.parse(data) as SseEnvelope;
      // ⚠️ `session` 本身也可能是 JSON null（nil 指针 → null）⇒ 先判存在再取成员
      const sess: SessionEvent | null | undefined = env.session;
      const action: string = sess !== undefined && sess !== null && sess.action !== undefined
        ? sess.action : '';
      if (shouldReloadHistory(action)) {
        // 外部 rewind（别的客户端 / 本机编辑确定后服务端广播 `history_rewound`）⇒
        // 历史已被截断，必须重载（复用 core/streammerge.ets 的判据，与 web 同源）。
        // ⛔ **必须先复位状态机**：`history_replaced` 是 merge 语义（本地 content
        //   非空优先），带着旧 committed 直接重载会让**被撤销的内容继续显示**
        //   （用户症状：rewind 后旧消息不消失）。与本地 `rewindTo` 的
        //   `resetStateMachine()` 同一处置。
        console.debug(`[SWITCH] historyRewound sid=${this.sid} chatId=${this.currentChatId} action=${action}`);
        this.state = initialChatState(this.currentChatId);
        this.rowCache = new Map();
        this.rows = [];
        this.rebuildRows();
        this.loadHistory().catch(() => {
          // 重载失败不影响主链路；下一次事件/切会话会再兜底
        });
      } else if (isIdleAction(action)) {
        // ⛔ 判据**必须**走 `core/streammerge.isIdleAction`（同一纯函数）：此前这里内联
        //    `action === 'idle' || action === 'agent-idle'` ⇒ 那个导出函数**生产 0 消费**
        //    （"死消费"形态：判据与状态机不同源，改一处另一处不跟）。语义逐字不变。
        // ★ 本地**立即**置 idle（web `useSessionStore` 内存内 `setStatus('idle')` —— 不刷 REST）。
        //   服务端 `session(idle)` 是权威"本会话已停"信号（归属已由 `normalizeEvent` 的
        //   `extractEventChatID` 按 chat 过滤）⇒ 立即清权威闸门 + 会话树 running；下面的
        //   REST 对账仍照跑（拉权威 todos/用量/running，覆盖本地乐观值的漂移）。
        this.applyLocalIdle(this.currentChatId);
        this.loadStatus().catch(() => {
          // 状态非关键路径
        });
        this.loadSessionSubscription().catch(() => {
          // 订阅查询非关键路径
        });
        this.loadSessions().catch(() => {
          // 对账失败不影响主链路
        });
        // 通知旁路（新增）：会话空闲 = 回合结束（与 phase_done 同一档；
        // 同一回合的第二次信号被 withinDedupeWindow 吃掉）。
        this.notifyOnSse(event, action, null);
      }
    }
  }

  // ── 通知（主方案：本地通知 + 前台抑制；**旁路**，绝不参与状态机语义）─────────

  /** 上一次"回合结束"提醒的时刻（去重窗口用；0 = 从没提醒过）。 */
  private lastTurnDoneNotifyAt: number = 0;

  /**
   * 事件 + 归一化结果 → 该不该发通知 → 发。
   *
   * 判据是 `core/notify.ets` 里的**纯函数**（`notifyKindForSse` + `shouldNotify`），
   * 这里只负责取上下文（前台标志、会话名、问题文本）与调用 SDK。
   * ⚠️ 任何异常都吞掉：通知是旁路，失败不能影响聊天主链路。
   */
  private notifyOnSse(event: string, sessionAction: string, evs: readonly DomainEvent[] | null): void {
    try {
      const kind: string = notifyKindForSse(event, sessionAction, evs);
      // 实况窗（灵动岛）更新——不受 shouldNotify 限制（busy 时持续显示）
      if (kind === NOTIFY_KIND_TURN_DONE || kind === NOTIFY_KIND_NONE) {
        cancelLiveView().catch(() => {});
      } else {
        const lvStatus: string = kind === NOTIFY_KIND_ASK ? i18nT('等待你的回答…') : i18nT('思考中…');
        const lvCapsule: string = kind === NOTIFY_KIND_ASK ? i18nT('等待') : i18nT('思考');
        publishLiveView(this.currentChatId, lvStatus, lvCapsule, 0).catch(() => {});
      }
      if (!shouldNotify(appIsForeground(), kind)) {
        return;
      }
      if (kind === NOTIFY_KIND_TURN_DONE) {
        const now: number = Date.now();
        if (withinDedupeWindow(now, this.lastTurnDoneNotifyAt, TURN_DONE_DEDUPE_MS)) {
          return;
        }
        this.lastTurnDoneNotifyAt = now;
      }
      // 通知信息量（2026-10-17）：ask 档带问题文本；turn_done 档带**最后 assistant 回复**
      // （此前恒空串 ⇒ 「回合已完成」零信息文案——用户亲报「一点信息量都没有」）。
      const detail: string = kind === NOTIFY_KIND_ASK
        ? ChatStore.askDetailOf(this.askUser)
        : (kind === NOTIFY_KIND_TURN_DONE ? ChatStore.lastAssistantDigest(this.rows) : '');
      publishTurn(notifyTitle(kind, ChatStore.chatLabelOf(this.sessions, this.currentChatId)),
        notifyBody(kind, detail), this.currentChatId);
    } catch (e) {
      // 通知是旁路：静默（主链路不受影响）
    }
  }

  /**
   * server push 通知插件：检查 widget 事件中是否有 "notify" 标记的 span。
   * 如果有——调用 publishTurn 发布系统通知。
   * ⚠️ 解析失败 ⇒ 静默忽略（通知是旁路，不影响主链路）。
   */
  private checkServerNotify(data: string): void {
    try {
      const parsed: Record<string, Object> = JSON.parse(data) as Record<string, Object>;
      const spansObj: Object | undefined = parsed.spans;
      if (spansObj === undefined || spansObj === null) {
        return;
      }
      const spans: Object[] = spansObj as Object[];
      if (spans.length === 0) {
        return;
      }
      for (let i = 0; i < spans.length; i++) {
        const span: Record<string, Object> = spans[i] as Record<string, Object>;
        const notify: Object | undefined = span.notify;
        if (notify === true) {
          const titleObj: Object | undefined = span.notifyTitle;
          const title: string = titleObj !== undefined && titleObj !== null
            ? (titleObj as string) : 'xbot';
          const bodyObj: Object | undefined = span.notifyBody;
          const textObj: Object | undefined = span.text;
          const body: string = bodyObj !== undefined && bodyObj !== null
            ? (bodyObj as string)
            : (textObj !== undefined && textObj !== null ? (textObj as string) : '通知');
          publishTurn(title, body, this.currentChatId).catch(() => {});
          return;
        }
      }
    } catch (e) {
      // 解析失败 ⇒ 静默忽略
    }
  }

  /**
   * 回合完成通知的正文（纯函数）：取 rows 尾最近的 assistant 行 content。
   * 病根修复（2026-10-17 用户亲报「通知一点信息量都没有」）：此前 turn_done 的
   * detail 恒空串 ⇒ 走 defaultNotifyBody 的「回合已完成」零信息文案——而长文本
   * 3072B/多行/直达会话的管道全现成，只是没喂内容。喂上后通知直接可读回复核心。
   * 静态纯函数（与 askDetailOf 同款）：rows 由外来事件构造，脱机可直接断言。
   */
  static lastAssistantDigest(rows: readonly ChatRow[]): string {
    if (rows === undefined || rows === null) {
      return '';
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const r: ChatRow | undefined = rows[i];
      if (r !== undefined && r !== null && r.role === 'assistant'
        && r.content !== undefined && r.content.length > 0) {
        // ⚡ 2026-10-20：洗 markdown（原返回 raw content ⇒ 通知里全是 ## ** 等标记字符，
        //   用户亲报「一点信息量都没有太垃圾了」）。洗后通知可读、信息量保留。
        return stripMarkdownForNotify(r.content);
      }
    }
    return '';
  }

  /** 待回答的 `request_id`（通知去重用）：没有 pending 或缺失 ⇒ 空串。 */
  private askRequestId(): string {
    const p: AskUserPrompt | null = this.askUser;
    // ⚠️ `request_id` 来自外来 JSON，可能是 null ⇒ 三态判空（否则把 null 当 id 比对上）
    const rid: string | null | undefined = p !== null ? p.request_id : undefined;
    return rid !== undefined && rid !== null ? rid : '';
  }

  /**
   * 待回答问题的正文（通知用）：取第一问的问题文本，回落 header。
   *
   * 抽成**静态纯函数**：`askUser` 由外来 JSON 构造（`questions`/`question`/`header` 都可能是
   * JSON null），而它的唯一调用点在"通知真的发出"时才会执行（脱机测试里永远走到不到）
   * ⇒ 做成静态函数后可直接对 null 输入断言（判别力）。
   */
  static askDetailOf(p: AskUserPrompt | null | undefined): string {
    // ⚠️ 旧写法 `p.questions === undefined` 对 null 为假，紧接 `.length` 直接抛
    if (p === undefined || p === null) {
      return '';
    }
    const qs: AskQuestion[] | null | undefined = p.questions;
    if (qs === undefined || qs === null || qs.length === 0) {
      return '';
    }
    const q: AskQuestion = qs[0];
    if (q.question !== undefined && q.question !== null && q.question.length > 0) {
      return q.question;
    }
    return q.header !== undefined && q.header !== null ? q.header : '';
  }

  /**
   * 会话展示名（通知标题用）：找不到就回落 chat_id，再没有就空串。
   * 同样抽成静态纯函数（`label` 来自会话树 = 外来 JSON，可能是 null ⇒ 可测）。
   */
  static chatLabelOf(sessions: readonly SessionItem[], chatId: string): string {
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].chat_id === chatId) {
        // ⚠️ 旧写法 `l !== undefined && l.length` 在 label 为 null 时抛 Cannot read property 'length' of null
        const l: string | null | undefined = sessions[i].label;
        return l !== undefined && l !== null && l.length > 0 ? l : chatId;
      }
    }
    return '';
  }

}

// ── 请求体（显式字段 = 协议契约，见 channel/web/web_rest.go） ─────────────────

/**
 * `loadMoreErr` 的**哨兵码**：分页游标（`oldest_id`）失效。
 *
 * 语义：`store.loadMore()` 发现 `oldestId <= 0` 却不静默 return（见该方法注释），而是落本码；
 * 页面见到本码 ⇒ **重拉首页**重建游标（用户口径"清除状态重新拉 api"）⇒ 自愈。
 * ⛔ 与"真实请求失败（可读原因）"区分开：前者要重取游标，后者只需提示 + 可重试。
 */
export const LOADMORE_ERR_NOCURSOR: string = 'nocursor';



export class HistoryBody {
  channel: string;
  chat_id: string;
  limit: number;
  before_id: number;

  constructor(channel: string, chatId: string, limit: number, beforeId: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.limit = limit;
    this.before_id = beforeId;
  }
}


/** `/api/settings` 的请求体（`{settings:{…}}`）。 */
export class SettingsBody {
  settings: Record<string, string>;

  constructor(settings: Record<string, string>) {
    this.settings = settings;
  }
}

/** 发送回执（服务端 `{interrupted, turn_id, queued, command, id}`）。 */
interface SendAck {
  interrupted?: boolean;
  /** 服务端分配的 turn_id（排队/命令消息缺省）。 */
  turn_id?: number;
  /** 消息入队（chat 忙，排队等待执行）。 */
  queued?: boolean;
  /** 后端判定这条消息是命令（`!cmd`/slash）。 */
  command?: boolean;
  /** 落库后的消息 id（DB auto-increment）。 */
  id?: number;
}


export class IterationDetailBody {
  channel: string;
  chat_id: string;
  turn_id: number;
  iteration: number;

  constructor(channel: string, chatId: string, turnId: number, iteration: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.turn_id = turnId;
    this.iteration = iteration;
  }
}

export class AskRespondBody {
  channel: string;
  chat_id: string;
  question_id: string;
  answer: string;
  answers: Record<string, string>;
  cancelled: boolean;

  constructor(channel: string, chatId: string, questionId: string, answer: string,
    answers: Record<string, string>, cancelled: boolean) {
    this.channel = channel;
    this.chat_id = chatId;
    this.question_id = questionId;
    this.answer = answer;
    this.answers = answers;
    this.cancelled = cancelled;
  }
}

export class QueueCancelBody {
  channel: string;
  chat_id: string;
  msg_id: string;

  constructor(channel: string, chatId: string, msgId: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.msg_id = msgId;
  }
}

export class QueueReorderBody {
  channel: string;
  chat_id: string;
  msg_ids: string[];

  constructor(channel: string, chatId: string, msgIds: string[]) {
    this.channel = channel;
    this.chat_id = chatId;
    this.msg_ids = msgIds;
  }
}

export class RegionsBody {
  channel: string;
  chat_id: string;
  turn_id: number;
  before_iteration: number;
  region_limit: number;

  constructor(channel: string, chatId: string, turnId: number, beforeIter: number, regionLimit: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.turn_id = turnId;
    this.before_iteration = beforeIter;
    this.region_limit = regionLimit;
  }
}

export class RpcBody {
  method: string;
  params: object;

  constructor(method: string, params: object) {
    this.method = method;
    this.params = params;
  }
}

/** 工具摘要（UI 复用）。 */
export function toolsSummary(tools: ToolProgress[]): string {
  const names: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    names.push(tools[i].name);
  }
  return names.join(' · ');
}

/**
 * 队列项的可寻址 id（`msg_id` 优先，回落 `id`）。
 * ⚠️ 外来 JSON（`/api/queue/list` 的 items 元素）：两个字段都可能 null ⇒ 显式三态。
 */
export function queueItemId(item: QueueItem): string {
  const mid: string | null | undefined = item.msg_id;
  if (mid !== undefined && mid !== null && mid.length > 0) {
    return mid;
  }
  const qid: string | null | undefined = item.id;
  if (qid !== undefined && qid !== null) {
    return qid;
  }
  return '';
}
