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
import { XbotHttp } from './http';
import { SseClient } from './sse';
import { rowIsEmpty } from './streammerge';
import { arrOrEmpty, isPresent } from './guards';
import { ChatState, DomainEvent, initialChatState, NonEmptyS, nonEmptyStr, UserRow } from './chat_types_full';
import { reduce } from './reduce';
import { deriveRows, Row } from './derive';
import { normalizeEvent } from './normalize';
import { historyToReplaced, liveProgressFromState } from './integrate';
import { applyRow } from './render';
import { ChatMessage, ChatMessageRole, EMPTY_PROGRESS_SNAPSHOT, ProgressSnapshot, WebIteration } from './chattypes';
import { normalizeWebIteration } from './agent_normalize';
import { channelForChat } from './sessionpick';
import { ForkResult, GoalInfo, SearchHit, SessionStatus, TodoItem, TokenUsage, UploadResult } from './types';
import { moveOrders } from './sessionops';
import { BgTask, CronJob, RunnerRow, SubAgentRow } from './panels';
import { serverKey, toLocalSettings } from './settings';
import { FsEntry } from './composer';
import { RPC_WEB_PLUGIN_LIST, rpc } from './rpc';
import {
  PluginCatalog,
  WebPluginListWire,
  buildPluginCatalog,
} from './pluginhost';
import {
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_TURN_DONE,
  TURN_DONE_DEDUPE_MS,
  appIsForeground,
  clearAll,
  clearForChat,
  notifyBody,
  notifyKindForSse,
  notifyTitle,
  publishTurn,
  shouldNotify,
  withinDedupeWindow,
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
import { LlmConfig } from './llmfmt';
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

export class ChatStore {
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
  /** 最近一次发送时刻（乐观 busy 的保护窗口，见 loadSessions 的对账） */
  lastSendAt: number = 0;
  historyLoading: boolean = false;
  /** SSE 连接状态（`idle|connecting|open|reconnecting`）——弱网提示用 */
  connState: string = 'idle';
  /** LLM 配置（订阅/可选模型/上下文上限；`GET /api/llm-config`） */
  llmConfig: LlmConfig | undefined = undefined;
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

  /** 行对象缓存（id → ChatRow）——就地更新，保住 @ObjectLink 恒等。 */
  private rowCache: Map<string, ChatRow> = new Map();

  /** 已拉取的历史消息累积（对齐 web `useChatMessages` 的 messages 数组）——
   *  分页只追加更早段，每次派发 `history_replaced(全量)` 让 reduce 做 merge。 */
  private history: ChatMessage[] = [];

  currentChatId: string = '';

  /** 当前会话的 live 进度快照（对齐 web `liveProgressFromState`）。页面 live 尾块读它。 */
  liveProgress(): ProgressSnapshot {
    return liveProgressFromState(this.state);
  }

  /**
   * 忙碌 —— 逐字对齐 web `AgentPanel.tsx:713` 的三元公式：
   *   `currentSession.running || progressSnapshot.streaming || busyFallback(activeTurn!==null)`
   * 再叠加 AskUser-pending 的互斥（web 同款：等待用户回答时回合是 PAUSED，不得显示 busy）。
   */
  get busy(): boolean {
    const snap: ProgressSnapshot = liveProgressFromState(this.state);
    const busyFallback: boolean = this.state.activeTurn !== null;
    return (this.state.sessionRunning || snap.streaming || busyFallback) && this.askUser === null;
  }

  /** 服务端会话树给出的权威 running（`sessions[i].running`，经 session_running 入状态机）。 */
  get serverRunning(): boolean {
    return this.state.sessionRunning;
  }

  /** 是否有一条在飞的 live turn（会话隔离判据：只读当前 store 的 state）。 */
  hasLiveTurn(): boolean {
    return this.state.activeTurn !== null;
  }

  /** 当前是否持有带产出的 live 行（尾块/占位符让位判据）。 */
  hasLiveRowWithContent(): boolean {
    if (this.state.activeTurn === null) {
      return false;
    }
    const snap: ProgressSnapshot = liveProgressFromState(this.state);
    return snap.streamContent.length > 0 || snap.reasoningStreamContent.length > 0
      || snap.activeTools.length > 0 || snap.streamingTools.length > 0
      || snap.iterationHistory.length > 0;
  }

  /** 状态机自愈：busy=false 却残留空壳 live turn（迟到的进度事件造的）⇒ 由 reduce 的
   *  idle 分支收尾；此处仅保留旧接口名给页面调用（对齐 web 无此步 —— 见对照表）。 */
  pruneEmptyLiveRowIfIdle(): boolean {
    return false;
  }

  /** 把一批 DomainEvent 依次喂给状态机，然后重建渲染行。 */
  private pushEvents(evs: readonly DomainEvent[] | null): void {
    if (evs === null) {
      return;
    }
    let next: ChatState = this.state;
    for (let i = 0; i < evs.length; i++) {
      next = reduce(next, evs[i]);
    }
    this.state = next;
    this.rebuildRows();
  }

  /** 单个 DomainEvent（内部便捷）。 */
  private pushEvent(ev: DomainEvent): void {
    this.state = reduce(this.state, ev);
    this.rebuildRows();
  }

  /** `ChatState → rows`：`deriveRows` + 就地适配（对象恒等）。 */
  private rebuildRows(): void {
    const derived: readonly Row[] = deriveRows(this.state);
    const next: ChatRow[] = [];
    const alive: Set<string> = new Set();
    for (let i = 0; i < derived.length; i++) {
      const r: Row = derived[i];
      alive.add(r.id);
      let row: ChatRow | undefined = this.rowCache.get(r.id);
      if (row === undefined) {
        row = new ChatRow();
        row.id = r.id;
        this.rowCache.set(r.id, row);
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

  /** 待回答的 AskUser（服务端权威：每会话至多一个） */
  askUser: AskUserPrompt | null = null;

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
      if (state === 'open') {
        // 重连后必须对账：断线期间可能错过 idle/busy 事件（错过 idle ⇒ 永远"运行中"）
        this.loadSessions().catch(() => {
          // 对账失败不影响连接本身
        });
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

  async loadSessions(): Promise<void> {
    const data: SessionTreeData = await this.http.postAs<SessionTreeData>(
      '/api/session-tree', new EmptyReq());
    // 子代理也来自会话树（面板用；不是另开一个数据源）
    const subs: SubAgentRow[] = [];
    // ⚠️ 服务端 Go 的 nil slice → JSON null：必须用 arrOrEmpty，不能只判 undefined。
    //   P0 根因：orphan_subagents 为 null 时 `orphan.length` 抛 "Cannot read property length of null"。
    const orphan: SessionItem[] = arrOrEmpty(data.orphan_subagents);
    for (let i = 0; i < orphan.length; i++) {
      const src: SessionItem = orphan[i];
      const row: SubAgentRow = new SubAgentRow();
      row.chat_id = src.chat_id !== undefined ? src.chat_id : '';
      row.label = src.label !== undefined ? src.label : '';
      row.running = src.running === true;
      subs.push(row);
    }
    this.subagents = subs;
    // sessions/chats 同为服务端返回 ⇒ 均可能为 null（曾 `sessions !== undefined && sessions.length` 崩溃）。
    const sessionList: SessionItem[] = arrOrEmpty(data.sessions);
    const list: SessionItem[] = sessionList.length > 0 ? sessionList : arrOrEmpty(data.chats);
    this.sessions = list;
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
    let found: boolean = false;
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].chat_id !== this.currentChatId) {
        continue;
      }
      found = true;
      this.pushEvent({ type: 'session_running', running: this.sessions[i].running === true });
      break;
    }
    // web 用 `currentSession?.running ?? false`：会话不在列表里 ⇒ 权威值回落 false
    if (!found) {
      this.pushEvent({ type: 'session_running', running: false });
    }
    this.onUpdate();
  }

  async createSession(): Promise<void> {
    const created: SessionItem = await this.http.postAs<SessionItem>(
      '/api/chats/create', new CreateChatReq());
    await this.loadSessions();
    // ⚠️ 外来 JSON：字段可能是 null（服务端 nil → null）⇒ 三态判空，否则 `.length` 会炸
    const newId: string | null | undefined = created.chat_id;
    if (newId !== undefined && newId !== null && newId.length > 0) {
      await this.openSession(newId);
    }
  }

  // ── P8 面板数据（定时任务 / 后台任务 / Runner；子代理取会话树） ──────────────

  /** 定时任务（`POST /api/cron/list` → `{tasks}`） */
  cronTasks: CronJob[] = [];
  /** 后台 shell 任务（`POST /api/tasks/list` → `{background_tasks}`） */
  bgTasks: BgTask[] = [];
  /** 受管机器（RPC `runner_list` → `{runners}`；凭据绝不下发） */
  runners: RunnerRow[] = [];
  /** 子代理（会话树的 orphan_subagents） */
  subagents: SubAgentRow[] = [];

  /**
   * 用户设置（服务端权威；键为**本地键名**）。
   * `POST /api/settings`（空体）→ `{settings:{服务端键:值}}` ⇒ `toLocalSettings` 本地化。
   */
  settings: Record<string, string> = {};

  async loadSettings(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/settings', new EmptyReq());
    const srv: Object | undefined = raw['settings'];
    // 服务端 nil map → JSON null；只判 undefined 会把 null 交下去（toLocalSettings(null) 崩）。
    const map: Record<string, string> = isPresent(srv) ? srv as Record<string, string> : {};
    this.settings = toLocalSettings(map);
    this.onUpdate();
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
    const body: SettingsReq = new SettingsReq(srv);
    await this.http.post('/api/settings', body);
    this.onUpdate();
  }

  /**
   * 列目录（`POST /api/fs/list {path, show_hidden?}` → `{entries:[{name,isDir,size,mode,modTime}]}`）。
   * 输入框 `@` 文件补全用；服务端已做路径安全校验（resolveSafePath）。
   */
  async listFs(path: string): Promise<FsEntry[]> {
    const body: Record<string, string> = { 'path': path.length > 0 ? path : '/' };
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/fs/list', body);
    const arr: Object | undefined = raw['entries'];
    return arrOrEmpty(arr as FsEntry[]);
  }

  async loadCronTasks(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/cron/list', new SessionReq(this.channel, this.currentChatId));
    const arr: Object | undefined = raw['tasks'];
    this.cronTasks = arrOrEmpty(arr as CronJob[]);
    this.onUpdate();
  }

  /** 删除一条定时任务（`POST /api/cron/remove` body `{channel, chat_id, job_id}`）。 */
  async removeCronTask(jobId: string): Promise<void> {
    const body: Record<string, string> = {
      'channel': this.channel, 'chat_id': this.currentChatId, 'job_id': jobId,
    };
    await this.http.post('/api/cron/remove', body);
    await this.loadCronTasks();
  }

  async loadBgTasks(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/tasks/list', new SessionReq(this.channel, this.currentChatId));
    const arr: Object | undefined = raw['background_tasks'];
    this.bgTasks = arrOrEmpty(arr as BgTask[]);
    this.onUpdate();
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
   * 在当前会话里搜索消息（`POST /api/search` legacy → `GET /api/search?q=`）。
   * ⚠️ 服务端只检索**当前会话**的 tenant（不是全局搜索）。
   */
  async searchMessages(q: string): Promise<SearchHit[]> {
    const body: Record<string, string> = { 'channel': this.channel, 'chat_id': this.currentChatId, 'q': q };
    const res: Record<string, Object> = await this.http.postAs<Record<string, Object>>('/api/search', body);
    const arr: Object | undefined = res['results'];
    return arrOrEmpty(arr as SearchHit[]);
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

  async openSession(chatId: string): Promise<void> {
    // ⚠️ 会话可能属于**非 web 渠道**（飞书 oc_*/ou_*）。必须用它自己的 channel，
    // 否则 /api/history 会返回 404 session not found（真机实测，见 core/sessionpick.ets）。
    //
    // ⚠️ 而渠道解析**依赖会话列表**：列表为空时 channelForChat 会回落默认渠道 ⇒ 非 web 会话
    // 被当成 web ⇒ 404。多会话池引入后这一点会真实发生（池里新 store 从没拉过列表，真机复现），
    // 所以这里先确保列表就绪 —— 把"渠道解析的前置条件"在**使用点**落实，而不是期待调用方记得。
    if (this.sessions.length === 0) {
      await this.loadSessions();
    }
    this.channel = channelForChat(this.sessions, chatId);
    this.currentChatId = chatId;
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
    this.onUpdate();
    await this.loadHistory();
    await this.loadQueue();
    this.loadStatus().catch(() => {
      // 状态非关键路径
    });
    this.subscribe();
  }

  // ── 历史（含上拉分页） ─────────────────────────────────────────────────────

  async loadHistory(): Promise<void> {
    this.historyLoading = true;
    this.onUpdate();
    try {
      await this.loadHistoryInner();
    } finally {
      this.historyLoading = false;
      this.onUpdate();
    }
  }

  private async loadHistoryInner(): Promise<void> {
    const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryReq(
      this.channel, this.currentChatId, 30, 0));
    this.applyHistoryMeta(data);
    // 历史 → `history_replaced`（逐字对齐 web `integrate.ts` 的 historyToReplaced）：
    //   经状态机（**merge 语义**，不盲替换 —— 见 reduce.ets 的 history_replaced 注释；
    //   盲替换会抹掉"只存在于状态机、DB 快照还没有"的 in-flight/post-fetch commit）。
    this.history = ChatStore.toChatMessages(data.messages);
    this.pushEvent(historyToReplaced(this.history, data.active_progress));
    // ⚠️ `active_progress` 在"没有在飞进度"的会话上是 **JSON null**（真机实测）⇒ 必须三态判空
    const ap: ProgressEvent | null | undefined = data.active_progress;
    if (isPresent(ap)) {
      this.pickAskUserFromProgress(ap);
    }
    this.onUpdate();
  }

  /** 上拉加载更早历史（`before_id` 游标）。 */
  async loadMore(): Promise<void> {
    if (!this.hasMore || this.loadingMore || this.oldestId <= 0) {
      return;
    }
    this.loadingMore = true;
    try {
      const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryReq(
        this.channel, this.currentChatId, 30, this.oldestId));
      const older: ChatMessage[] = ChatStore.toChatMessages(data.messages);
      this.history = older.concat(this.history);
      this.applyHistoryMeta(data);
      // 分页只增量喂历史（active 快照传 null —— 不得动 live turn）。
      this.pushEvent(historyToReplaced(this.history, null));
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
  }

  /** 历史消息 → web `ChatMessage[]`（`historyToReplaced` 的输入形状）。 */
  static toChatMessages(messages: HistoryMessage[] | null | undefined): ChatMessage[] {
    const out: ChatMessage[] = [];
    // 服务端 messages 可能为流式 payload/历史快照的缺失字段 —— null 与 undefined 一律归一为空。
    const src: HistoryMessage[] = arrOrEmpty(messages);
    for (let i = 0; i < src.length; i++) {
      const m: HistoryMessage = src[i];
      const role: ChatMessageRole = m.role === 'user' ? 'user'
        : (m.role === 'system' ? 'system' : 'assistant');
      const msg: ChatMessage = {
        id: `m-${m.id}`,
        role,
        content: m.content !== undefined ? m.content : '',
        iterations: ChatStore.toWebIterations(m.iterations),
        turnID: m.turn_id !== undefined ? m.turn_id : 0,
        timestamp: m.timestamp !== undefined ? m.timestamp : '',
        isPartial: false,
        dbID: m.id,
        regionsBefore: m.regions_before !== undefined ? m.regions_before : undefined,
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
    const ev: DomainEvent = historyToReplaced(ChatStore.toChatMessages(messages), null);
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
    let minIter: number = -1;
    for (let i = 0; i < row.iterations.length; i++) {
      const n: number = row.iterations[i].iteration;
      if (minIter < 0 || n < minIter) {
        minIter = n;
      }
    }
    if (minIter < 0) {
      return;
    }
    const data: RegionsData = await this.http.postAs<RegionsData>('/api/regions', new RegionsReq(
      this.channel, this.currentChatId, row.turnID, minIter, 100));
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
          this.channel, this.currentChatId, turnID, iteration));
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
    const isInterrupt: boolean = interrupt === true;
    this.lastSendAt = Date.now();
    const requestID: string = this.nextRowID('req');
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
      const raw: string = await this.http.post('/api/message', new MessageReq(
        this.channel, this.currentChatId, text, uploadKeys, fileNames, fileSizes, isInterrupt,
        requestID));
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
      this.pushEvent({
        type: 'user_ack',
        requestID,
        dbID: ack.id !== undefined ? ack.id : 0,
        turnHint: ack.turn_id !== undefined ? ack.turn_id : undefined,
        queued: ack.queued === true,
        command: ack.command === true,
      });
      return ack.interrupted === true;
    } catch (e) {
      this.pushEvent({ type: 'user_fail', requestID });
      throw e as Error;
    }
  }

  /**
   * 拉取 LLM 配置（`GET /api/llm-config` → 订阅/模型条目/上下文上限）。
   * 只读；切换见 `setModel` / `setMaxContext`。
   */
  async loadLlmConfig(): Promise<void> {
    try {
      const cfg: LlmConfig = await this.http.getAs<LlmConfig>('/api/llm-config');
      // ⚠️ `/api/llm-config` 无可用配置时服务端 **data 整块为 null**（实测）⇒ `getAs` 返回 null。
      //   必须归一成 undefined（"拿不到"），否则 `llmConfig=null` 会让下游
      //   `llmConfig.model_entries` 抛 "Cannot read property 'model_entries' of null"。
      this.llmConfig = isPresent(cfg) ? cfg : undefined;
      this.onUpdate();
    } catch (e) {
      // 选择栏非关键路径：失败不打断主链路
    }
  }

  /**
   * 切换模型（`POST /api/llm-config/model`，body `{sub_id, model}`）。
   *
   * ⚠️ 必须带 `sub_id` —— 项目铁律：绝不裸模型名解析（同名模型可能属于多个订阅）。
   * 服务端按 sender 生效，切换后立刻刷新配置与状态（用量里的模型名会变）。
   */
  async setModel(subId: string, model: string): Promise<void> {
    const body: Record<string, string> = { 'sub_id': subId, 'model': model };
    await this.http.post('/api/llm-config/model', body);
    await this.loadLlmConfig();
    await this.loadStatus();
  }

  /** 设置上下文上限（`POST /api/llm-max-context`）。 */
  async setMaxContext(n: number): Promise<void> {
    const body: Record<string, number> = { 'max_context': n };
    await this.http.post('/api/llm-max-context', body);
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
    try {
      const st: SessionStatus = await this.http.postAs<SessionStatus>(
        '/api/session/status', new SessionReq(this.channel, this.currentChatId));
      this.usage = st.token_usage;
      this.cwd = st.cwd !== undefined ? st.cwd : '';
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

  async cancel(): Promise<void> {
    await this.http.post('/api/cancel', new SessionReq(this.channel, this.currentChatId));
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
    const qs: AskQuestion[] = p !== undefined && p !== null ? arrOrEmpty(p.questions) : [];
    if (qs.length === 0) {
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
    if (qs.length > 0 && qs[0].id !== undefined) {
      firstQ = qs[0].id;
    }
    const single: string = answers[firstQ] !== undefined ? answers[firstQ] : '';
    await this.http.post('/api/ask_user/respond', new AskRespondReq(
      this.channel, this.currentChatId, firstQ, single, answers, cancelled));
    this.askUser = null;
    this.onUpdate();
  }

  // ── 待发队列 ───────────────────────────────────────────────────────────────

  async loadQueue(): Promise<void> {
    try {
      const data: QueueListData = await this.http.postAs<QueueListData>(
        '/api/queue/list', new SessionReq(this.channel, this.currentChatId));
      const items: QueueItem[] = arrOrEmpty(data.items);
      const list: QueueItem[] = items.length > 0 ? items : arrOrEmpty(data.queue);
      this.queue = list;
      this.onUpdate();
    } catch (e) {
      // 队列不可用时静默（不影响主链路）
    }
  }

  async cancelQueued(msgId: string): Promise<void> {
    await this.http.post('/api/queue/cancel', new QueueCancelReq(this.channel, this.currentChatId, msgId));
    await this.loadQueue();
  }

  /** 上/下移一格：把当前顺序投影回服务端（msg_ids 即权威顺序）。 */
  async moveQueued(msgId: string, dir: number): Promise<void> {
    const ids: string[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const id: string = this.queue[i].msg_id !== undefined ? this.queue[i].msg_id as string
        : (this.queue[i].id !== undefined ? this.queue[i].id as string : '');
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
    await this.http.post('/api/queue/reorder', new QueueReorderReq(this.channel, this.currentChatId, ids));
    await this.loadQueue();
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
    this.onUpdate = () => {
    };
  }

  subscribe(): void {
    if (this.currentChatId.length === 0) {
      return;
    }
    this.sse.connect(this.currentChatId, this.channel, this.http.cookieHeaderForStream(),
      (event: string, data: string) => {
        this.onSse(event, data);
      });
  }

  private onSse(event: string, data: string): void {
    if (event === SseEventType.heartbeat) {
      return;
    }
    let raw: Record<string, Object>;
    try {
      raw = JSON.parse(data) as Record<string, Object>;
    } catch (e) {
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
      // 环形缓冲已淘汰 ⇒ 回退 DB 权威快照（web 同款语义）
      this.loadHistory().catch((e: Error) => {
        console.error(`resync 失败: ${e.message}`);
      });
      return;
    }
    // ⛔ 事件 → DomainEvent 的**唯一入口**（逐字移植 web `normalize.ts` 的 normalizeEvent）：
    //   按**事件名**分流（raw.type）、chat 过滤、null 数组归一、数值校验全在 normalize 里。
    //   SSE 事件名 = 权威类型（web WSMessage.type 同源）——绝不按载荷字段猜分类
    //   （服务端会给流式帧盖 iteration，猜错会把 stream_* 当结构化静默丢弃）。
    raw['type'] = event;
    const evs: readonly DomainEvent[] | null = normalizeEvent(raw, this.currentChatId);
    this.pushEvents(evs);
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
      if (action === 'idle' || action === 'agent-idle') {
        this.loadStatus().catch(() => {
          // 状态非关键路径
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
      const detail: string = kind === NOTIFY_KIND_ASK ? this.askDetailForNotify() : '';
      publishTurn(notifyTitle(kind, this.currentChatLabel()), notifyBody(kind, detail), this.currentChatId);
    } catch (e) {
      // 通知是旁路：静默（主链路不受影响）
    }
  }

  /** 待回答的 `request_id`（通知去重用）：没有 pending 或缺失 ⇒ 空串。 */
  private askRequestId(): string {
    const p: AskUserPrompt | null = this.askUser;
    // ⚠️ `request_id` 来自外来 JSON，可能是 null ⇒ 三态判空（否则把 null 当 id 比对上）
    const rid: string | null | undefined = p !== null ? p.request_id : undefined;
    return rid !== undefined && rid !== null ? rid : '';
  }

  /** 待回答问题的正文（通知用）：取第一问的问题文本，回落 header。 */
  private askDetailForNotify(): string {
    const p: AskUserPrompt | null = this.askUser;
    if (p === null || p.questions === undefined || p.questions.length === 0) {
      return '';
    }
    const q: AskQuestion = p.questions[0];
    if (q.question !== undefined && q.question.length > 0) {
      return q.question;
    }
    return q.header !== undefined ? q.header : '';
  }

  /** 当前会话的展示名（通知标题用）：找不到就回落 chat_id，再没有就空串。 */
  private currentChatLabel(): string {
    const id: string = this.currentChatId;
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].chat_id === id) {
        const l: string | undefined = this.sessions[i].label;
        return l !== undefined && l.length > 0 ? l : id;
      }
    }
    return '';
  }

}

// ── 请求体（显式字段 = 协议契约，见 channel/web/web_rest.go） ─────────────────



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
