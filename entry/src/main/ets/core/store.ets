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
import {
  applyStreamFrame, applyStructured, isStreamOnly, isIdleAction, isBusyAction,
  shouldReloadHistory, liveIterationOf, upsertIteration, mergeTools, rowIsEmpty, isStaleSeqEvent,
} from './streammerge';
import { channelForChat } from './sessionpick';
import { ForkResult, GoalInfo, SearchHit, SessionStatus, TodoItem, TokenUsage, UploadResult } from './types';
import { moveOrders } from './sessionops';
import { BgTask, CronJob, RunnerRow, SubAgentRow } from './panels';
import { serverKey, toLocalSettings } from './settings';
import { FsEntry } from './composer';
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
  rows: ChatRow[] = [];
  busy: boolean = false;
  /**
   * 服务端会话树给出的**权威**忙碌标记（`sessions[i].running`）。
   * ⛔ 用途：迟到的 coarse `session(idle)`（SSE 重放 / 切后台恢复）不能冻结在飞的回合 ——
   * 只要权威仍说 running，就把这条 idle 当陈旧信号忽略（真结束由会话树翻 false 收尾）。
   */
  serverRunning: boolean = false;
  currentChatId: string = '';
  lastSeq: number = 0;

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
    this.sse.onUnauthorized = () => {
      this.onAuthExpired();
    };
    this.http.onUnauthorized = () => {
      this.onAuthExpired();
    };
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────

  async loadSessions(): Promise<void> {
    const data: SessionTreeData = await this.http.postAs<SessionTreeData>(
      '/api/session-tree', new EmptyReq());
    // 子代理也来自会话树（面板用；不是另开一个数据源）
    const subs: SubAgentRow[] = [];
    const orphan: SessionItem[] | undefined = data.orphan_subagents;
    if (orphan !== undefined) {
      for (let i = 0; i < orphan.length; i++) {
        const src: SessionItem = orphan[i];
        const row: SubAgentRow = new SubAgentRow();
        row.chat_id = src.chat_id !== undefined ? src.chat_id : '';
        row.label = src.label !== undefined ? src.label : '';
        row.running = src.running === true;
        subs.push(row);
      }
    }
    this.subagents = subs;
    const list: SessionItem[] = data.sessions !== undefined && data.sessions.length > 0
      ? data.sessions
      : (data.chats !== undefined ? data.chats : []);
    this.sessions = list;
    // 会话树的 `running` 是服务端权威忙碌标记 —— 本地 busy 只是 SSE 事件的快路径，
    // 错过一条 idle（断线重连/切后台）就会永远显示"运行中"。每次拉到会话树都对账一次。
    // 例外：刚发送的 3 秒内不对账（乐观 busy 先行，服务端标记 running 有一个 RTT 窗口）。
    this.sessionsFetchedAt = Date.now();
    // ⛔ busy 对账（真机 P0，2026-10-10）：会话树是**快照**，服务端 `running` 标记有 RTT 延迟。
    //  只在 ① 权威说 running=true（恢复），或 ② 本地确实没有在飞的 live 行且已过发送保护窗口
    //  时才用它改 busy；否则会把**在飞的回合**误判成空闲 ⇒「思考中」一闪一没、
    //  中间无任何打字机/进度、收尾才蹦出完整迭代（用户报告）。
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].chat_id !== this.currentChatId) {
        continue;
      }
      const serverRunning: boolean = this.sessions[i].running === true;
      this.serverRunning = serverRunning;
      if (serverRunning || (!this.hasLiveRow() && Date.now() - this.lastSendAt > 3000)) {
        this.busy = serverRunning;
      }
      break;
    }
    this.onUpdate();
  }

  async createSession(): Promise<void> {
    const created: SessionItem = await this.http.postAs<SessionItem>(
      '/api/chats/create', new CreateChatReq());
    await this.loadSessions();
    if (created.chat_id !== undefined && created.chat_id.length > 0) {
      await this.openSession(created.chat_id);
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
    const map: Record<string, string> = srv !== undefined ? srv as Record<string, string> : {};
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
    return arr !== undefined ? arr as FsEntry[] : [];
  }

  async loadCronTasks(): Promise<void> {
    const raw: Record<string, Object> = await this.http.postAs<Record<string, Object>>(
      '/api/cron/list', new SessionReq(this.channel, this.currentChatId));
    const arr: Object | undefined = raw['tasks'];
    this.cronTasks = arr !== undefined ? arr as CronJob[] : [];
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
    this.bgTasks = arr !== undefined ? arr as BgTask[] : [];
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
    this.runners = arr !== undefined ? arr as RunnerRow[] : [];
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
    return arr !== undefined ? arr as SearchHit[] : [];
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
    this.lastSeq = 0;
    this.rows = [];
    this.busy = false;
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
    this.rows = ChatStore.rowsFromHistory(data.messages !== undefined ? data.messages : []);
    this.applyHistoryMeta(data);
    const ap: ProgressEvent | undefined = data.active_progress;
    if (ap !== undefined) {
      if (ap.busy === true) {
        this.busy = true;
      }
      this.applyProgress(ap);
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
      const older: ChatRow[] = ChatStore.rowsFromHistory(
        data.messages !== undefined ? data.messages : []);
      this.rows = older.concat(this.rows);
      this.applyHistoryMeta(data);
    } finally {
      this.loadingMore = false;
      this.onUpdate();
    }
  }

  private applyHistoryMeta(data: HistoryData): void {
    this.hasMore = data.has_more === true;
    if (data.oldest_id !== undefined) {
      this.oldestId = data.oldest_id;
    }
    // ⚠️ 绝不把 history 的 `last_seq` 写进 progress 水位（本次真机 P0 根因）：
    // 它是 **SSE 回放游标**（全局计数，几百量级），而 ProgressEvent.Seq 是 **per-Run**
    // 从 1 计数 —— 混用后新回合的全部事件被 `seq <= lastSeq` 整批丢弃
    // （表现：SSE 事件完全不渲染、思考中消失后永远空白）。web 的 lastSeq 属于
    // activeTurn、turn_started 重置、从不从 history 设置。SSE 回放游标由
    // SseClient 的 lastEventId 单独负责。
  }

  /** 历史 → 渲染行（每 turn 取第一条 user + 最后一条 assistant）。 */
  static rowsFromHistory(messages: HistoryMessage[]): ChatRow[] {
    const out: ChatRow[] = [];
    let current: ChatRow | null = null;
    for (let i = 0; i < messages.length; i++) {
      const m: HistoryMessage = messages[i];
      const turnID: number = m.turn_id !== undefined ? m.turn_id : 0;
      if (m.role === 'user') {
        const r: ChatRow = new ChatRow();
        r.id = `u-${m.id}`; // 历史行：消息 id 天然唯一
        r.role = 'user';
        r.turnID = turnID;
        r.content = m.content !== undefined ? m.content : '';
        out.push(r);
        current = null;
      } else if (m.role === 'assistant') {
        if (current === null || current.turnID !== turnID) {
          const r: ChatRow = new ChatRow();
          r.id = `a-${m.id}`; // 历史行：消息 id 天然唯一
          r.role = 'assistant';
          r.turnID = turnID;
          r.content = m.content !== undefined ? m.content : '';
          r.iterations = m.iterations !== undefined ? m.iterations : [];
          r.regionsBefore = m.regions_before !== undefined ? m.regions_before : 0;
          out.push(r);
          current = r;
        } else {
          current.content = m.content !== undefined && m.content.length > 0 ? m.content : current.content;
          if (m.iterations !== undefined && m.iterations.length > 0) {
            current.iterations = m.iterations;
          }
          if (m.regions_before !== undefined) {
            current.regionsBefore = m.regions_before;
          }
        }
      }
    }
    // 空气泡过滤：无正文且无迭代内容的 assistant 行不渲染（用户真机"莫名其妙的空气泡"）
    const visible: ChatRow[] = [];
    for (let i = 0; i < out.length; i++) {
      const r: ChatRow = out[i];
      if (r.role === 'user' || !rowIsEmpty(r)) {
        visible.push(r);
      }
    }
    return visible;
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
    const older: HistoryIteration[] = data.iterations !== undefined ? data.iterations : [];
    const merged: HistoryIteration[] = [];
    const seen: Set<number> = new Set();
    for (let i = 0; i < older.length; i++) {
      if (!seen.has(older[i].iteration)) {
        seen.add(older[i].iteration);
        merged.push(older[i]);
      }
    }
    for (let i = 0; i < row.iterations.length; i++) {
      if (!seen.has(row.iterations[i].iteration)) {
        seen.add(row.iterations[i].iteration);
        merged.push(row.iterations[i]);
      }
    }
    row.iterations = merged;
    row.regionsBefore = data.regions_before !== undefined ? data.regions_before : 0;
    this.touch(row);
    this.onUpdate();
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
      this.mergeIterationDetail(turnID, it);
      return it;
    } catch (e) {
      return null;
    }
  }

  private mergeIterationDetail(turnID: number, it: HistoryIteration): void {
    for (let i = 0; i < this.rows.length; i++) {
      const row: ChatRow = this.rows[i];
      if (row.role !== 'assistant' || row.turnID !== turnID) {
        continue;
      }
      for (let k = 0; k < row.iterations.length; k++) {
        if (row.iterations[k].iteration === it.iteration) {
          row.iterations[k] = it; // 同号权威覆盖
          this.touch(row);
          this.onUpdate();
          return;
        }
      }
    }
  }

  // ── 发送 / 取消 ────────────────────────────────────────────────────────────

  private appendLocalUser(text: string): ChatRow {
    const r: ChatRow = new ChatRow();
    r.id = this.nextRowID('local');
    r.role = 'user';
    r.turnID = 0;
    r.content = text;
    this.touch(r);
    this.rows.push(r);
    this.onUpdate();
    return r;
  }

  /**
   * 发送一条用户消息（可带附件）。
   *
   * ⚠️ 失败时**必须移除乐观插入的那一行**：否则界面上会留下一条"从未发出"的消息
   * （用户看到的就是"发了但没反应/重复"）。失败原因原样抛给调用方展示（含服务端文案）。
   */
  /**
   * 发送消息。
   *
   * `interrupt=true` ⇒ **⚡ 插话**：服务端把它注入到正在跑的 turn（下一个工具边界作为
   * 合成 `user_interrupt` 工具结果喂给模型），**不排队、不产生 user 行、不带 turn_id**。
   * 因此插话路径**不加乐观行**（否则会留下一条永远等不到后端确认的幽灵消息）。
   * 会话空闲时服务端会退化为普通发送，返回值会如实反映（`interrupted=false`）。
   *
   * @returns 是否真的插话成功（true=已注入当前回合）
   */
  async send(text: string, uploadKeys?: string[], fileNames?: string[], fileSizes?: number[],
    interrupt?: boolean): Promise<boolean> {
    const isInterrupt: boolean = interrupt === true;
    this.lastSendAt = Date.now();
    let row: ChatRow | undefined = undefined;
    if (!isInterrupt) {
      row = this.appendLocalUser(text);
      this.busy = true;
    }
    this.onUpdate();
    try {
      const raw: string = await this.http.post('/api/message', new MessageReq(
        this.channel, this.currentChatId, text, uploadKeys, fileNames, fileSizes, isInterrupt));
      if (isInterrupt) {
        return true;
      }
      // 服务端可能把插话退化成普通发送（会话当时空闲）—— 按 ack 如实回执
      try {
        const ack: SendAck = JSON.parse(raw) as SendAck;
        return ack.interrupted === true;
      } catch (e) {
        return false;
      }
    } catch (e) {
      // 回滚：把这条乐观行摘掉（插话路径没有乐观行，只需复位忙态）
      if (row !== undefined) {
        for (let i = this.rows.length - 1; i >= 0; i--) {
          if (this.rows[i].id === row.id) {
            this.rows.splice(i, 1);
            break;
          }
        }
        this.busy = false;
      }
      this.onUpdate();
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
      this.llmConfig = cfg;
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
      this.todos = st.todos !== undefined ? st.todos : [];
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

  private pickAskUserFromProgress(p: ProgressEvent): void {
    const qs: AskQuestion[] | undefined = p.questions;
    if (qs === undefined || qs.length === 0) {
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
    const qs: AskQuestion[] | undefined = prompt.questions;
    if (qs !== undefined && qs.length > 0 && qs[0].id !== undefined) {
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
      const list: QueueItem[] = data.items !== undefined ? data.items
        : (data.queue !== undefined ? data.queue : []);
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

  // ── 插件面板（ArkWeb 用） ──────────────────────────────────────────────────

  /**
   * 拉取带 web 产物的插件清单。
   * 服务端 RPC `web_plugin_list`（只返回声明了 web.entry 的插件）；
   * URL 若后端未给 module_url，则按 `/plugins/<id>/web/<entry>` 拼（与 web 前端同构）。
   */
  async listPlugins(): Promise<PluginPanelInfo[]> {
    const out: PluginPanelInfo[] = [];
    try {
      const data: WebPluginListData = await this.http.postAs<WebPluginListData>(
        '/api/rpc', new RpcReq('web_plugin_list'));
      const list: WebPluginInfo[] = data.plugins !== undefined ? data.plugins : [];
      for (let i = 0; i < list.length; i++) {
        const p: WebPluginInfo = list[i];
        const id: string = p.id !== undefined ? p.id
          : (p.plugin_id !== undefined ? p.plugin_id : '');
        if (id.length === 0) {
          continue;
        }
        const entry: string = p.entry !== undefined && p.entry.length > 0 ? p.entry : 'index.js';
        const info: PluginPanelInfo = new PluginPanelInfo();
        info.id = id;
        info.name = p.name !== undefined && p.name.length > 0 ? p.name
          : (p.label !== undefined ? p.label : id);
        info.url = p.module_url !== undefined && p.module_url.length > 0
          ? p.module_url
          : `${this.http.baseUrl}/plugins/${id}/web/${entry}`;
        info.icon = p.icon !== undefined ? p.icon : '';
        out.push(info);
      }
    } catch (e) {
      // 插件系统不可用（或未启用）时返回空表
    }
    return out;
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
    let env: SseEnvelope;
    try {
      env = JSON.parse(data) as SseEnvelope;
    } catch (e) {
      return;
    }
    if (event === SseEventType.heartbeat) {
      return;
    }
    if (event === SseEventType.session) {
      this.onSessionEvent(env.session);
      return;
    }
    if (event === SseEventType.userEcho) {
      this.onUserEcho(env);
      return;
    }
    if (event === SseEventType.progressStructured || event === SseEventType.streamContent) {
      if (env.progress !== undefined) {
        this.applyProgress(env.progress);
        this.pickAskUserFromProgress(env.progress);
      }
      return;
    }
    if (event === SseEventType.askUser) {
      if (env.progress !== undefined) {
        this.pickAskUserFromProgress(env.progress);
        this.onUpdate();
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
    if (event === SseEventType.text) {
      this.onFinalText(env);
      return;
    }
    if (event === SseEventType.resyncRequired) {
      // 环形缓冲已淘汰 ⇒ 回退 DB 权威快照（web 同款语义）
      this.loadHistory().catch((e: Error) => {
        console.error(`resync 失败: ${e.message}`);
      });
    }
  }

  private onSessionEvent(ev: SessionEvent | undefined): void {
    if (ev === undefined) {
      return;
    }
    // ⚠️ 服务端字段是 `action`（不是 `state`，见 core/streammerge.ets 注释）
    const action: string = ev.action !== undefined ? ev.action : '';
    if (isIdleAction(action)) {
      // ⛔ 迟到的 coarse idle（SSE `last_event_id` 重放 / restoreActiveProgress 竞态）
      //   绝不能冻结在飞的回合：权威会话树仍说 running ⇒ 视为陈旧信号，只去刷新权威状态。
      if (this.serverRunning) {
        this.loadSessions().catch(() => {
          // 忽略
        });
        return;
      }
      this.busy = false;
      // 回合结束 ⇒ 水位重置（web：idle 置 null —— 下一个 Run 从 1 计数）
      this.lastSeq = 0;
      this.onUpdate();
      // 每轮结束刷新一次权威状态（todos/用量会变）
      this.loadStatus().catch(() => {
        // 忽略
      });
      // 会话树的 `running` 是"服务端权威的忙碌标记"（P24：界面状态必须与它一致，
      // 不能只信本地 busy 标志 —— 否则切会话/重连后会显示成"还在跑"或"已经停"）
      this.loadSessions().catch(() => {
        // 忽略
      });
    } else if (isBusyAction(action)) {
      this.busy = true;
      // 回合开始 ⇒ 水位重置（新 Run 的 seq 从 1 计数）
      this.lastSeq = 0;
      this.onUpdate();
    } else if (shouldReloadHistory(action)) {
      // 历史被回退 ⇒ 必须重载，否则界面停留在已被撤销的内容上
      this.loadHistory().catch((e: Error) => {
        console.error(`rewound 重载失败: ${e.message}`);
      });
    }
  }

  private onUserEcho(env: SseEnvelope): void {
    const text: string = env.content !== undefined ? env.content : '';
    const turnID: number = env.turn_id !== undefined ? env.turn_id : 0;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r: ChatRow = this.rows[i];
      if (r.role === 'user' && r.turnID === 0 && r.content === text) {
        r.turnID = turnID;
        this.touch(r);
        this.busy = true;
        // 新 turn ⇒ progress 水位重置（seq 是 per-Run 计数；web：turn_started 置 null）
        this.lastSeq = 0;
        this.onUpdate();
        return;
      }
    }
    const r: ChatRow = new ChatRow();
    r.id = this.nextRowID('echo');
    r.role = 'user';
    r.turnID = turnID;
    r.content = text;
    this.touch(r);
    this.rows.push(r);
    this.busy = true;
    this.onUpdate();
  }

  /** 是否有"在飞的 live 行"（= 本轮正在进行；会话树快照不可用于清 busy）。 */
  hasLiveRow(): boolean {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r: ChatRow = this.rows[i];
      if (r.role === 'assistant' && r.isLive) {
        return true;
      }
    }
    return false;
  }

  private liveRow(): ChatRow {
    const last: ChatRow | undefined = this.rows.length > 0 ? this.rows[this.rows.length - 1] : undefined;
    if (last !== undefined && last.role === 'assistant' && last.isLive) {
      return last;
    }
    const r: ChatRow = new ChatRow();
    r.id = this.nextRowID('live');
    r.role = 'assistant';
    r.isLive = true;
    this.touch(r);
    this.rows.push(r);
    return r;
  }

  /**
   * 进度事件落地：**流式与结构化两条路径语义完全不同**（服务端契约见 core/streammerge.ets）。
   *
   * - 流式帧（`stream_content`）：按契约**不带迭代号、不带工具**（`isStreamOnlyProgress` 要求
   *   `iteration==0 && content=="" && 无 tools`）⇒ 必须归到**在飞迭代**，且**只增不减**地累积；
   *   若当成结构化事件处理，就会造出幽灵「迭代 0」并清空该迭代的 tools/reasoning（真机表现：
   *   工具 pill 一闪就没 + live 区空白 = "渲染整个都是错乱的、完全用不了"）。
   * - 结构化帧（`progress_structured`）：迭代按号 upsert，**缺字段时保留旧值**（绝不清空）。
   * - `seq` 是 per-Run 水位线，用于丢弃**纯重放**；流式帧没有 seq，故只在 `seq > 0` 时判定。
   */
  /** 当前 live 行已持有的最大迭代号（无 live 行 = 0；**不创建**行）。 */
  private liveMaxIter(): number {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r: ChatRow = this.rows[i];
      if (r.role === 'assistant' && r.isLive) {
        let max: number = 0;
        for (let j = 0; j < r.iterations.length; j++) {
          if (r.iterations[j].iteration > max) {
            max = r.iterations[j].iteration;
          }
        }
        return max;
      }
    }
    return 0;
  }

  private applyProgress(p: ProgressEvent): void {
    const seq: number = p.seq !== undefined ? p.seq : 0;
    const streamOnly: boolean = isStreamOnly(p);
    // 流式帧：**无 seq 闸**（web 同款 —— 累积全量推送，重放无害：非空即整体替换）
    if (!streamOnly) {
      // 结构化帧：per-Run 水位 + "新迭代信息豁免"（isStaleSeq，web reduce.ts:423 逐字移植）。
      // ⚠️ Run 重启后 seq 从 1 计数：只按 seq 丢会把新 Run 整批吞掉（本次真机 P0）。
      if (seq > 0 && isStaleSeqEvent(this.lastSeq, seq, this.liveMaxIter(), p)) {
        return;
      }
      if (seq > 0) {
        this.lastSeq = seq;
      }
    }
    const row: ChatRow = this.liveRow();
    if (streamOnly) {
      // ⛔ 流式帧可能盖着 iteration（服务端语义：新迭代只发流式事件时，前端据此**切迭代边界**并
      //   清上一迭代的流式状态）。若不按它切，新迭代的打字机会写到旧迭代块里、边界也不清。
      let target: HistoryIteration = liveIterationOf(row);
      if (p.iteration !== undefined && p.iteration > target.iteration) {
        target = upsertIteration(row, p.iteration);
      }
      applyStreamFrame(target, p);
      this.touch(row);
      this.onUpdate();
      return;
    }
    const itNum: number = p.iteration !== undefined && p.iteration > 0
      ? p.iteration : liveIterationOf(row).iteration;
    applyStructured(upsertIteration(row, itNum), p);

    // 收尾快照携带整段迭代历史：按号 upsert，只覆盖"确实带了内容"的字段
    const hist: HistoryIteration[] | undefined = p.iteration_history;
    if (hist !== undefined) {
      for (let i = 0; i < hist.length; i++) {
        const h: HistoryIteration = hist[i];
        const target: HistoryIteration = upsertIteration(row, h.iteration);
        if (h.content !== undefined && h.content.length > 0) {
          target.content = h.content;
          target.stream_text = '';
        }
        if (h.reasoning !== undefined && h.reasoning.length > 0) {
          target.reasoning = h.reasoning;
          target.stream_reasoning = '';
        }
        if (h.tools !== undefined && h.tools.length > 0) {
          target.tools = mergeTools(target.tools, h.tools);
        }
        if (h.tools_folded === true) {
          target.tools_folded = true;
        }
      }
    }
    this.touch(row);
    this.onUpdate();
  }

  /**
   * `text` 事件（回合收尾文本）—— **逐字对齐 web `chat/reduce.ts` 的 `text_final`**。
   *
   * ⛔ 真机铁证（"同一条回复渲染两次"）：旧实现把 finalText 写进**行级 `row.content`**，
   * 而迭代里已经有同一段文本 ⇒ 渲染层两处都画（一遍带「思考 N 字」、一遍不带）。
   * web 的语义是：**finalText 属于「进行中迭代」** —— 并入该迭代（保留它的 reasoning），
   * 行级 content 保持为空（行级 content 只服务历史/legacy 行）。
   */
  private onFinalText(env: SseEnvelope): void {
    const text: string = env.content !== undefined ? env.content : '';
    // ⛔ 空 text 信封（WaitingUser / 中途空 text）**不得**提交、**不得**删行、**不得**动 busy：
    // web `chat/reduce.ts` 的 text_final 明确规定「空 finalText 不得擦已有内容」。
    // 旧实现在空 text 时走"空行 ⇒ splice 删除"，于是**正在流式的整行被删掉**
    // （用户报"迭代完成了就消失、永远只能看到最新迭代"）；回合结束由 session idle 决定。
    if (text.length === 0) {
      return;
    }
    if (this.rows.length === 0) {
      return;
    }
    const last: ChatRow = this.rows[this.rows.length - 1];
    // ⛔ 空 text 且回合仍在跑 ⇒ 不终结 live 行（真实回复随后到）——
    //   否则会把 live 行的内容清空并置 isLive=false（用户报告："用户消息后什么都没有"）。
    if (text.length === 0 && this.busy && last.role === 'assistant' && last.isLive && !rowIsEmpty(last)) {
      return;
    }
    if (last.role !== 'assistant') {
      if (text.length === 0) {
        return;
      }
      const r: ChatRow = new ChatRow();
      r.role = 'assistant';
      r.turnID = env.turn_id !== undefined ? env.turn_id : 0;
      r.id = this.nextRowID('a');
      r.iterations = [{ iteration: 1, content: text, reasoning: '', tools: [] }];
      this.rows.push(r);
      this.busy = false;
      this.lastSeq = 0;
      this.onUpdate();
      return;
    }
    {
      // 进行中迭代号 = 该行最大迭代号（web：max(live.iter, 迭代列表最后号)）
      const itNum: number = liveIterationOf(last).iteration;
      const it: HistoryIteration = upsertIteration(last, itNum);
      it.content = text;
      it.stream_text = '';               // 权威快照接管，清流式缓冲
      // ⚠️ reasoning 绝不清空（进行中迭代的思考只存在于 live 快照，
      //    真机曾出现"提交后 Thought N chars 消失"）
    }
    last.isLive = false;
    last.turnID = env.turn_id !== undefined ? env.turn_id : last.turnID;
    this.touch(last);
    // 完全无产出（text 空、迭代也空）⇒ 不落地空行（空气泡）
    if (rowIsEmpty(last)) {
      this.rows.splice(this.rows.length - 1, 1);
    }
    this.busy = false;
    this.lastSeq = 0;
    this.onUpdate();
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

/** 发送回执（服务端 `{interrupted: true}` 表示插话已注入当前回合）。 */
interface SendAck {
  interrupted?: boolean;
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
