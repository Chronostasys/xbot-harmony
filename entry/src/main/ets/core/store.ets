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
  shouldReloadHistory, liveIterationOf, upsertIteration, mergeTools,
} from './streammerge';
import { channelForChat } from './sessionpick';
import { GoalInfo, SessionStatus, TodoItem, TokenUsage, UploadResult } from './types';
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
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────

  async loadSessions(): Promise<void> {
    const data: SessionTreeData = await this.http.postAs<SessionTreeData>(
      '/api/session-tree', new EmptyBody());
    const list: SessionItem[] = data.sessions !== undefined && data.sessions.length > 0
      ? data.sessions
      : (data.chats !== undefined ? data.chats : []);
    this.sessions = list;
    this.onUpdate();
  }

  async createSession(): Promise<void> {
    const created: SessionItem = await this.http.postAs<SessionItem>(
      '/api/chats/create', new ChannelBody(this.channel));
    await this.loadSessions();
    if (created.chat_id !== undefined && created.chat_id.length > 0) {
      await this.openSession(created.chat_id);
    }
  }

  async deleteSession(chatId: string): Promise<void> {
    await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/delete',
      new ChannelBody(this.channel, chatId));
    if (chatId === this.currentChatId) {
      this.currentChatId = '';
      this.rows = [];
      this.sse.close();
    }
    await this.loadSessions();
  }

  async renameSession(chatId: string, label: string): Promise<void> {
    await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/rename', new RenameBody(
      this.channel, chatId, label));
    await this.loadSessions();
  }

  async openSession(chatId: string): Promise<void> {
    // ⚠️ 会话可能属于**非 web 渠道**（飞书 oc_*/ou_*）。必须用它自己的 channel，
    // 否则 /api/history 会返回 404 session not found（真机实测，见 core/sessionpick.ets）。
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
    const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryBody(
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
      const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryBody(
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
    if (data.last_seq !== undefined) {
      this.lastSeq = data.last_seq;
    }
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
    const data: RegionsData = await this.http.postAs<RegionsData>('/api/regions', new RegionsBody(
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
        '/api/iteration_detail', new IterationDetailBody(
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
  async send(text: string, uploadKeys?: string[], fileNames?: string[], fileSizes?: number[]): Promise<void> {
    const row: ChatRow = this.appendLocalUser(text);
    this.busy = true;
    this.onUpdate();
    try {
      await this.http.post('/api/message', new MessageBody(
        this.channel, this.currentChatId, text, 0, uploadKeys, fileNames, fileSizes));
    } catch (e) {
      // 回滚：把这条乐观行摘掉（并复位忙碌态由调用方/SSE 权威决定）
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (this.rows[i].id === row.id) {
          this.rows.splice(i, 1);
          break;
        }
      }
      this.busy = false;
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
        '/api/session/status', new ChannelBody(this.channel, this.currentChatId));
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
    await this.http.post('/api/cancel', new ChannelBody(this.channel, this.currentChatId));
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
    await this.http.post('/api/ask_user/respond', new AskRespondBody(
      this.channel, this.currentChatId, firstQ, single, answers, cancelled));
    this.askUser = null;
    this.onUpdate();
  }

  // ── 待发队列 ───────────────────────────────────────────────────────────────

  async loadQueue(): Promise<void> {
    try {
      const data: QueueListData = await this.http.postAs<QueueListData>(
        '/api/queue/list', new ChannelBody(this.channel, this.currentChatId));
      const list: QueueItem[] = data.items !== undefined ? data.items
        : (data.queue !== undefined ? data.queue : []);
      this.queue = list;
      this.onUpdate();
    } catch (e) {
      // 队列不可用时静默（不影响主链路）
    }
  }

  async cancelQueued(msgId: string): Promise<void> {
    await this.http.post('/api/queue/cancel', new QueueCancelBody(this.channel, this.currentChatId, msgId));
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
    await this.http.post('/api/queue/reorder', new QueueReorderBody(this.channel, this.currentChatId, ids));
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
        '/api/rpc', new RpcBody('web_plugin_list', new EmptyBody()));
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
      this.busy = false;
      this.onUpdate();
      // 每轮结束刷新一次权威状态（todos/用量会变）
      this.loadStatus().catch(() => {
        // 忽略
      });
    } else if (isBusyAction(action)) {
      this.busy = true;
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
  private applyProgress(p: ProgressEvent): void {
    const seq: number = p.seq !== undefined ? p.seq : 0;
    if (seq > 0 && seq <= this.lastSeq) {
      return;
    }
    if (seq > 0) {
      this.lastSeq = seq;
    }
    const row: ChatRow = this.liveRow();
    if (isStreamOnly(p)) {
      applyStreamFrame(liveIterationOf(row), p);
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

  private onFinalText(env: SseEnvelope): void {
    const text: string = env.content !== undefined ? env.content : '';
    if (this.rows.length === 0) {
      return;
    }
    const last: ChatRow = this.rows[this.rows.length - 1];
    if (last.role === 'assistant') {
      last.content = text.length > 0 ? text : last.content;
      last.isLive = false;
      this.touch(last);
      last.turnID = env.turn_id !== undefined ? env.turn_id : last.turnID;
      // ⚠️ 不改成 `a-<turnID>`：那会与历史行的 id 空间重叠 ⇒ ForEach key 重复 ⇒ 渲染错位
      if (last.id.length === 0) {
        last.id = this.nextRowID('a');
      }
    } else {
      const r: ChatRow = new ChatRow();
      r.role = 'assistant';
      r.turnID = env.turn_id !== undefined ? env.turn_id : 0;
      r.id = this.nextRowID('a');
      r.content = text;
      this.rows.push(r);
    }
    this.busy = false;
    this.onUpdate();
  }
}

// ── 请求体（显式字段 = 协议契约，见 channel/web/web_rest.go） ─────────────────

export class EmptyBody {
}

export class ChannelBody {
  channel: string;
  chat_id?: string;

  constructor(channel: string, chatId?: string) {
    this.channel = channel;
    this.chat_id = chatId;
  }
}

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

export class MessageBody {
  channel: string;
  chat_id: string;
  content: string;
  turn_id: number;
  /**
   * 附件（服务端 `expandUploadKeys` 会把这三者展开成内容里的引用；
   * 字段名与 `protocol.WSClientMessage` 的 json tag 逐字一致）。
   */
  upload_keys?: string[];
  file_names?: string[];
  file_sizes?: number[];

  constructor(channel: string, chatId: string, content: string, turnId: number,
    uploadKeys?: string[], fileNames?: string[], fileSizes?: number[]) {
    this.channel = channel;
    this.chat_id = chatId;
    this.content = content;
    this.turn_id = turnId;
    this.upload_keys = uploadKeys;
    this.file_names = fileNames;
    this.file_sizes = fileSizes;
  }
}

export class RenameBody {
  channel: string;
  chat_id: string;
  label: string;

  constructor(channel: string, chatId: string, label: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.label = label;
  }
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
