"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcBody = exports.RegionsBody = exports.QueueReorderBody = exports.QueueCancelBody = exports.AskRespondBody = exports.IterationDetailBody = exports.SettingsBody = exports.HistoryBody = exports.ChatStore = void 0;
exports.toolsSummary = toolsSummary;
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
const http_1 = require("./http");
const sse_1 = require("./sse");
const chat_types_full_1 = require("./chat_types_full");
const reduce_1 = require("./reduce");
const derive_1 = require("./derive");
const normalize_1 = require("./normalize");
const integrate_1 = require("./integrate");
const render_1 = require("./render");
const agent_normalize_1 = require("./agent_normalize");
const sessionpick_1 = require("./sessionpick");
const sessionops_1 = require("./sessionops");
const panels_1 = require("./panels");
const settings_1 = require("./settings");
const reqbody_1 = require("./reqbody");
const types_1 = require("./types");
class ChatStore {
    /** 当前会话的 live 进度快照（对齐 web `liveProgressFromState`）。页面 live 尾块读它。 */
    liveProgress() {
        return (0, integrate_1.liveProgressFromState)(this.state);
    }
    /**
     * 忙碌 —— 逐字对齐 web `AgentPanel.tsx:713` 的三元公式：
     *   `currentSession.running || progressSnapshot.streaming || busyFallback(activeTurn!==null)`
     * 再叠加 AskUser-pending 的互斥（web 同款：等待用户回答时回合是 PAUSED，不得显示 busy）。
     */
    get busy() {
        const snap = (0, integrate_1.liveProgressFromState)(this.state);
        const busyFallback = this.state.activeTurn !== null;
        return (this.state.sessionRunning || snap.streaming || busyFallback) && this.askUser === null;
    }
    /** 服务端会话树给出的权威 running（`sessions[i].running`，经 session_running 入状态机）。 */
    get serverRunning() {
        return this.state.sessionRunning;
    }
    /** 是否有一条在飞的 live turn（会话隔离判据：只读当前 store 的 state）。 */
    hasLiveTurn() {
        return this.state.activeTurn !== null;
    }
    /** 当前是否持有带产出的 live 行（尾块/占位符让位判据）。 */
    hasLiveRowWithContent() {
        if (this.state.activeTurn === null) {
            return false;
        }
        const snap = (0, integrate_1.liveProgressFromState)(this.state);
        return snap.streamContent.length > 0 || snap.reasoningStreamContent.length > 0
            || snap.activeTools.length > 0 || snap.streamingTools.length > 0
            || snap.iterationHistory.length > 0;
    }
    /** 状态机自愈：busy=false 却残留空壳 live turn（迟到的进度事件造的）⇒ 由 reduce 的
     *  idle 分支收尾；此处仅保留旧接口名给页面调用（对齐 web 无此步 —— 见对照表）。 */
    pruneEmptyLiveRowIfIdle() {
        return false;
    }
    /** 把一批 DomainEvent 依次喂给状态机，然后重建渲染行。 */
    pushEvents(evs) {
        if (evs === null) {
            return;
        }
        let next = this.state;
        for (let i = 0; i < evs.length; i++) {
            next = (0, reduce_1.reduce)(next, evs[i]);
        }
        this.state = next;
        this.rebuildRows();
    }
    /** 单个 DomainEvent（内部便捷）。 */
    pushEvent(ev) {
        this.state = (0, reduce_1.reduce)(this.state, ev);
        this.rebuildRows();
    }
    /** `ChatState → rows`：`deriveRows` + 就地适配（对象恒等）。 */
    rebuildRows() {
        const derived = (0, derive_1.deriveRows)(this.state);
        const next = [];
        const alive = new Set();
        for (let i = 0; i < derived.length; i++) {
            const r = derived[i];
            alive.add(r.id);
            let row = this.rowCache.get(r.id);
            if (row === undefined) {
                row = new types_1.ChatRow();
                row.id = r.id;
                this.rowCache.set(r.id, row);
            }
            const changed = (0, render_1.applyRow)(row, r);
            if (changed) {
                this.touch(row);
            }
            next.push(row);
        }
        // 淘汰已消失的行（turn 被删/切会话）
        if (this.rowCache.size > alive.size) {
            const stale = [];
            this.rowCache.forEach((_v, k) => {
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
    resetRows() {
        this.state = (0, chat_types_full_1.initialChatState)(this.currentChatId);
        this.rowCache = new Map();
        this.rows = [];
    }
    /** 标记行内容已变（ForEach key 随 rev 变化 ⇒ 强制重建该项，避免显示陈旧内容）。 */
    touch(row) {
        row.rev = row.rev + 1;
    }
    nextRowID(prefix) {
        this.idSeq++;
        return `${prefix}-${this.idSeq}`;
    }
    constructor(baseUrl) {
        this.channel = 'web';
        // ── 会话状态（服务端权威；/api/session/status + 结构化事件里的 goal）──
        /**
         * 会话凭据失效（任何请求或 SSE 返回 401）时回调 —— 页面据此退回登录页。
         * 汇聚点只有这一个：http 与 sse 的 401 都走这里（避免两处各自处理漏掉一个）。
         */
        this.onAuthExpired = () => {
        };
        /** 历史是否正在加载（骨架屏判据：只有"还没内容且正在拉"才展示骨架） */
        /** 会话树最近一次拉取时刻（busy 对账的新鲜度判据） */
        this.sessionsFetchedAt = 0;
        /** 最近一次发送时刻（乐观 busy 的保护窗口，见 loadSessions 的对账） */
        this.lastSendAt = 0;
        this.historyLoading = false;
        /** SSE 连接状态（`idle|connecting|open|reconnecting`）——弱网提示用 */
        this.connState = 'idle';
        /** LLM 配置（订阅/可选模型/上下文上限；`GET /api/llm-config`） */
        this.llmConfig = undefined;
        /** token/上下文用量（拿不到就是 undefined，界面不显示、绝不估算） */
        this.usage = undefined;
        /** 工作目录 */
        this.cwd = '';
        /** todos（服务端权威） */
        this.todos = [];
        /** 目标（来自结构化进度事件的 goal） */
        this.goal = undefined;
        this.sessions = [];
        /**
         * 渲染行（`ChatRow`）—— **由状态机派生**，对齐 web `useChatMessages`：
         * `rows = applyRow(deriveRows(state))`。不再手写维护（手写近似 = 全部 bug 的源头）。
         */
        this.rows = [];
        /**
         * 单会话**唯一事实源**：`ChatState`（逐字移植 web `chat/types.ts` / `reduce.ts`）。
         *
         * 所有进度事件经 `normalizeEvent → reduce` 落入它；渲染行由 `deriveRows` 得出、
         * busy 由 AgentPanel 三元公式得出。打开会话时**整体复位**（会话隔离，见 openSession）。
         */
        this.state = (0, chat_types_full_1.initialChatState)('');
        /** 行对象缓存（id → ChatRow）——就地更新，保住 @ObjectLink 恒等。 */
        this.rowCache = new Map();
        /** 已拉取的历史消息累积（对齐 web `useChatMessages` 的 messages 数组）——
         *  分页只追加更早段，每次派发 `history_replaced(全量)` 让 reduce 做 merge。 */
        this.history = [];
        this.currentChatId = '';
        /** 历史分页（loadMore 游标） */
        this.hasMore = false;
        this.oldestId = 0;
        this.loadingMore = false;
        /** 待回答的 AskUser（服务端权威：每会话至多一个） */
        this.askUser = null;
        /** 待发队列 */
        this.queue = [];
        /**
         * 行 id 的单调计数器。
         *
         * ⛔ 必须全局唯一：`ForEach` 的 key 一旦重复，ArkUI 会复用/错位组件 —— 表现就是"整个渲染错乱"
         * （与 Web 端 React 重复 key 的 #185 同源）。原先 id 由 消息id / turnID / Date.now() 拼接，
         * 跨命名空间会撞（`a-<消息id>` vs `a-<turnID>`），同一毫秒连发两条也会撞 ⇒ 统一用计数器。
         */
        this.idSeq = 1;
        /** 变更通知（页面接到 @State 上） */
        this.onUpdate = () => {
        };
        // ── P8 面板数据（定时任务 / 后台任务 / Runner；子代理取会话树） ──────────────
        /** 定时任务（`POST /api/cron/list` → `{tasks}`） */
        this.cronTasks = [];
        /** 后台 shell 任务（`POST /api/tasks/list` → `{background_tasks}`） */
        this.bgTasks = [];
        /** 受管机器（RPC `runner_list` → `{runners}`；凭据绝不下发） */
        this.runners = [];
        /** 子代理（会话树的 orphan_subagents） */
        this.subagents = [];
        /**
         * 用户设置（服务端权威；键为**本地键名**）。
         * `POST /api/settings`（空体）→ `{settings:{服务端键:值}}` ⇒ `toLocalSettings` 本地化。
         */
        this.settings = {};
        this.http = new http_1.XbotHttp(baseUrl);
        this.sse = new sse_1.SseClient(baseUrl);
        this.sse.onState = (state) => {
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
    async loadSessions() {
        const data = await this.http.postAs('/api/session-tree', new reqbody_1.EmptyReq());
        // 子代理也来自会话树（面板用；不是另开一个数据源）
        const subs = [];
        const orphan = data.orphan_subagents;
        if (orphan !== undefined) {
            for (let i = 0; i < orphan.length; i++) {
                const src = orphan[i];
                const row = new panels_1.SubAgentRow();
                row.chat_id = src.chat_id !== undefined ? src.chat_id : '';
                row.label = src.label !== undefined ? src.label : '';
                row.running = src.running === true;
                subs.push(row);
            }
        }
        this.subagents = subs;
        const list = data.sessions !== undefined && data.sessions.length > 0
            ? data.sessions
            : (data.chats !== undefined ? data.chats : []);
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
        let found = false;
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
    async createSession() {
        const created = await this.http.postAs('/api/chats/create', new reqbody_1.CreateChatReq());
        await this.loadSessions();
        if (created.chat_id !== undefined && created.chat_id.length > 0) {
            await this.openSession(created.chat_id);
        }
    }
    async loadSettings() {
        const raw = await this.http.postAs('/api/settings', new reqbody_1.EmptyReq());
        const srv = raw['settings'];
        const map = srv !== undefined ? srv : {};
        this.settings = (0, settings_1.toLocalSettings)(map);
        this.onUpdate();
    }
    /** 保存若干设置项（本地键 → 服务端键后批量写；本地缓存同步更新，界面立即生效）。 */
    async saveSettings(pairs) {
        const srv = {};
        const keys = Object.keys(pairs);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            srv[(0, settings_1.serverKey)(k)] = pairs[k];
            this.settings[k] = pairs[k];
        }
        const body = new reqbody_1.SettingsReq(srv);
        await this.http.post('/api/settings', body);
        this.onUpdate();
    }
    /**
     * 列目录（`POST /api/fs/list {path, show_hidden?}` → `{entries:[{name,isDir,size,mode,modTime}]}`）。
     * 输入框 `@` 文件补全用；服务端已做路径安全校验（resolveSafePath）。
     */
    async listFs(path) {
        const body = { 'path': path.length > 0 ? path : '/' };
        const raw = await this.http.postAs('/api/fs/list', body);
        const arr = raw['entries'];
        return arr !== undefined ? arr : [];
    }
    async loadCronTasks() {
        const raw = await this.http.postAs('/api/cron/list', new reqbody_1.SessionReq(this.channel, this.currentChatId));
        const arr = raw['tasks'];
        this.cronTasks = arr !== undefined ? arr : [];
        this.onUpdate();
    }
    /** 删除一条定时任务（`POST /api/cron/remove` body `{channel, chat_id, job_id}`）。 */
    async removeCronTask(jobId) {
        const body = {
            'channel': this.channel, 'chat_id': this.currentChatId, 'job_id': jobId,
        };
        await this.http.post('/api/cron/remove', body);
        await this.loadCronTasks();
    }
    async loadBgTasks() {
        const raw = await this.http.postAs('/api/tasks/list', new reqbody_1.SessionReq(this.channel, this.currentChatId));
        const arr = raw['background_tasks'];
        this.bgTasks = arr !== undefined ? arr : [];
        this.onUpdate();
    }
    /**
     * 受管机器列表（走 REST RPC 桥 `POST /api/rpc` body `{method, params}`）。
     * 用 RPC 而不是 `/api/runners/list`：后者是给插件面板用的包装，RPC 是同一权威数据源。
     */
    async loadRunners() {
        // 只发 method：服务端对空 params 会补 `{}`（见 handleRPC）——
        // ArkTS 禁止嵌套空对象字面量 `{...: {}}`（arkts-no-untyped-obj-literals）。
        const body = { 'method': 'runner_list' };
        const raw = await this.http.postAs('/api/rpc', body);
        const arr = raw['runners'];
        this.runners = arr !== undefined ? arr : [];
        this.onUpdate();
    }
    /**
     * 会话分支（`POST /api/chats/fork` body `{source_channel, source_chat_id, label?}`）。
     * @returns 新会话 id（服务端 `{chat_id}`）
     */
    async forkSession(chatId, label) {
        const body = {
            'source_channel': this.channel,
            'source_chat_id': chatId,
            'label': label,
        };
        const res = await this.http.postAs('/api/chats/fork', body);
        const id = res.chat_id;
        if (id === undefined || id.length === 0) {
            throw new Error('服务端未返回新会话 id');
        }
        return id;
    }
    /**
     * 会话排序（`POST /api/chats/reorder` body `{channel, orders}`）。
     * `ids` 为当前**显示顺序**的会话 id 列表；内部算好全量序号再提交。
     */
    async reorderSessions(ids, movedId, dir) {
        const orders = (0, sessionops_1.moveOrders)(ids, movedId, dir);
        const body = { 'channel': this.channel, 'orders': orders };
        await this.http.post('/api/chats/reorder', body);
        await this.loadSessions();
    }
    /**
     * 在当前会话里搜索消息（`POST /api/search` legacy → `GET /api/search?q=`）。
     * ⚠️ 服务端只检索**当前会话**的 tenant（不是全局搜索）。
     */
    async searchMessages(q) {
        const body = { 'channel': this.channel, 'chat_id': this.currentChatId, 'q': q };
        const res = await this.http.postAs('/api/search', body);
        const arr = res['results'];
        return arr !== undefined ? arr : [];
    }
    async deleteSession(chatId) {
        // 服务端 handleChatDeletePOST 只认 `{channel}`（chat_id 在路径上）——
        // 严格解码下多发一个 chat_id 就是 400
        await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/delete', new reqbody_1.ChannelReq(this.channel));
        if (chatId === this.currentChatId) {
            this.currentChatId = '';
            this.rows = [];
            this.sse.close();
        }
        await this.loadSessions();
    }
    async renameSession(chatId, label) {
        // 服务端 handleChatRename 只认 `{channel, label}`（chat_id 在路径上）——
        // 严格解码下多发 chat_id 就是 400（真机事故）
        await this.http.post('/api/chats/' + encodeURIComponent(chatId) + '/rename', new reqbody_1.RenameReq(this.channel, label));
        await this.loadSessions();
    }
    async openSession(chatId) {
        // ⚠️ 会话可能属于**非 web 渠道**（飞书 oc_*/ou_*）。必须用它自己的 channel，
        // 否则 /api/history 会返回 404 session not found（真机实测，见 core/sessionpick.ets）。
        //
        // ⚠️ 而渠道解析**依赖会话列表**：列表为空时 channelForChat 会回落默认渠道 ⇒ 非 web 会话
        // 被当成 web ⇒ 404。多会话池引入后这一点会真实发生（池里新 store 从没拉过列表，真机复现），
        // 所以这里先确保列表就绪 —— 把"渠道解析的前置条件"在**使用点**落实，而不是期待调用方记得。
        if (this.sessions.length === 0) {
            await this.loadSessions();
        }
        this.channel = (0, sessionpick_1.channelForChat)(this.sessions, chatId);
        this.currentChatId = chatId;
        // ⛔ 会话隔离（用户反复强调，真机 P0）：切会话必须**整体复位状态机**。
        //   ChatState 是**唯一事实源**，`initialChatState(chatId)` 一次重建即复位
        //   【全部】per-session 状态（turns/lastSeq/activeTurn/busy/pendingUsers/
        //   todos/goal/queue/sessionRunning/gapReloadToken/…）—— 不存在"漏重置某个
        //   字段"的可能（旧实现逐字段手写复位，先后漏过 lastTurnID/stream*/serverRunning，
        //   每漏一个就是一处串台）。
        this.state = (0, chat_types_full_1.initialChatState)(chatId);
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
    async loadHistory() {
        this.historyLoading = true;
        this.onUpdate();
        try {
            await this.loadHistoryInner();
        }
        finally {
            this.historyLoading = false;
            this.onUpdate();
        }
    }
    async loadHistoryInner() {
        const data = await this.http.postAs('/api/history', new reqbody_1.HistoryReq(this.channel, this.currentChatId, 30, 0));
        this.applyHistoryMeta(data);
        // 历史 → `history_replaced`（逐字对齐 web `integrate.ts` 的 historyToReplaced）：
        //   经状态机（**merge 语义**，不盲替换 —— 见 reduce.ets 的 history_replaced 注释；
        //   盲替换会抹掉"只存在于状态机、DB 快照还没有"的 in-flight/post-fetch commit）。
        this.history = ChatStore.toChatMessages(data.messages);
        this.pushEvent((0, integrate_1.historyToReplaced)(this.history, data.active_progress));
        const ap = data.active_progress;
        if (ap !== undefined) {
            this.pickAskUserFromProgress(ap);
        }
        this.onUpdate();
    }
    /** 上拉加载更早历史（`before_id` 游标）。 */
    async loadMore() {
        if (!this.hasMore || this.loadingMore || this.oldestId <= 0) {
            return;
        }
        this.loadingMore = true;
        try {
            const data = await this.http.postAs('/api/history', new reqbody_1.HistoryReq(this.channel, this.currentChatId, 30, this.oldestId));
            const older = ChatStore.toChatMessages(data.messages);
            this.history = older.concat(this.history);
            this.applyHistoryMeta(data);
            // 分页只增量喂历史（active 快照传 null —— 不得动 live turn）。
            this.pushEvent((0, integrate_1.historyToReplaced)(this.history, null));
        }
        finally {
            this.loadingMore = false;
            this.onUpdate();
        }
    }
    applyHistoryMeta(data) {
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
    /** 历史消息 → web `ChatMessage[]`（`historyToReplaced` 的输入形状）。 */
    static toChatMessages(messages) {
        const out = [];
        if (messages === undefined) {
            return out;
        }
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            const role = m.role === 'user' ? 'user'
                : (m.role === 'system' ? 'system' : 'assistant');
            const msg = {
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
    static toWebIterations(iters) {
        const out = [];
        if (iters === undefined) {
            return out;
        }
        for (let i = 0; i < iters.length; i++) {
            const w = (0, agent_normalize_1.normalizeWebIteration)(iters[i]);
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
    static rowsFromHistory(messages) {
        const ev = (0, integrate_1.historyToReplaced)(ChatStore.toChatMessages(messages), null);
        const state = (0, reduce_1.reduce)((0, chat_types_full_1.initialChatState)(''), ev);
        const derived = (0, derive_1.deriveRows)(state);
        const out = [];
        for (let i = 0; i < derived.length; i++) {
            const row = new types_1.ChatRow();
            row.id = derived[i].id;
            (0, render_1.applyRow)(row, derived[i]);
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
    async loadEarlierRegions(row) {
        if (row.regionsBefore <= 0) {
            return;
        }
        let minIter = -1;
        for (let i = 0; i < row.iterations.length; i++) {
            const n = row.iterations[i].iteration;
            if (minIter < 0 || n < minIter) {
                minIter = n;
            }
        }
        if (minIter < 0) {
            return;
        }
        const data = await this.http.postAs('/api/regions', new reqbody_1.RegionsReq(this.channel, this.currentChatId, row.turnID, minIter, 100));
        const older = data.iterations !== undefined ? data.iterations : [];
        // 段边界去重后经 `iterations_loaded` 交给状态机 —— reduce 做 union 合并（同号权威
        // 覆盖、轻字段永不覆盖完整数据），与 web `iterations_loaded` 同一语义。
        const seen = new Set();
        const merged = [];
        for (let i = 0; i < older.length; i++) {
            const n = older[i].iteration;
            if (seen.has(n)) {
                continue;
            }
            seen.add(n);
            const w = (0, agent_normalize_1.normalizeWebIteration)(older[i]);
            if (w !== null) {
                merged.push(w);
            }
        }
        this.pushEvent({
            type: 'iterations_loaded',
            turnID: row.turnID,
            iterations: merged,
            regionsBefore: data.regions_before !== undefined ? data.regions_before : 0,
        });
    }
    /** 按需拉取某迭代的完整工具详情（折叠视图下 summary/args/detail 默认不下发）。 */
    async fetchIterationDetail(turnID, iteration) {
        try {
            const data = await this.http.postAs('/api/iteration_detail', new reqbody_1.IterationDetailReq(this.channel, this.currentChatId, turnID, iteration));
            const it = data.iteration;
            if (it === undefined) {
                return null;
            }
            const w = (0, agent_normalize_1.normalizeWebIteration)(it);
            if (w !== null) {
                // 同号权威覆盖（regionsBefore 缺省 = 不变 —— 详情 hydrate 不动区域计数）。
                this.pushEvent({ type: 'iterations_loaded', turnID, iterations: [w] });
            }
            return it;
        }
        catch (e) {
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
    async send(text, uploadKeys, fileNames, fileSizes, interrupt) {
        const isInterrupt = interrupt === true;
        this.lastSendAt = Date.now();
        const requestID = this.nextRowID('req');
        if (!isInterrupt) {
            const c = (0, chat_types_full_1.nonEmptyStr)(text);
            if (c !== null) {
                const row = {
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
            const raw = await this.http.post('/api/message', new reqbody_1.MessageReq(this.channel, this.currentChatId, text, uploadKeys, fileNames, fileSizes, isInterrupt, requestID));
            if (isInterrupt) {
                return true;
            }
            let ack = {};
            try {
                ack = JSON.parse(raw);
            }
            catch (e) {
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
        }
        catch (e) {
            this.pushEvent({ type: 'user_fail', requestID });
            throw e;
        }
    }
    /**
     * 拉取 LLM 配置（`GET /api/llm-config` → 订阅/模型条目/上下文上限）。
     * 只读；切换见 `setModel` / `setMaxContext`。
     */
    async loadLlmConfig() {
        try {
            const cfg = await this.http.getAs('/api/llm-config');
            this.llmConfig = cfg;
            this.onUpdate();
        }
        catch (e) {
            // 选择栏非关键路径：失败不打断主链路
        }
    }
    /**
     * 切换模型（`POST /api/llm-config/model`，body `{sub_id, model}`）。
     *
     * ⚠️ 必须带 `sub_id` —— 项目铁律：绝不裸模型名解析（同名模型可能属于多个订阅）。
     * 服务端按 sender 生效，切换后立刻刷新配置与状态（用量里的模型名会变）。
     */
    async setModel(subId, model) {
        const body = { 'sub_id': subId, 'model': model };
        await this.http.post('/api/llm-config/model', body);
        await this.loadLlmConfig();
        await this.loadStatus();
    }
    /** 设置上下文上限（`POST /api/llm-max-context`）。 */
    async setMaxContext(n) {
        const body = { 'max_context': n };
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
    async loadStatus() {
        if (this.currentChatId.length === 0) {
            return;
        }
        try {
            const st = await this.http.postAs('/api/session/status', new reqbody_1.SessionReq(this.channel, this.currentChatId));
            this.usage = st.token_usage;
            this.cwd = st.cwd !== undefined ? st.cwd : '';
            this.todos = st.todos !== undefined ? st.todos : [];
            this.onUpdate();
        }
        catch (e) {
            // 状态拉取失败不影响主链路（历史/发送优先）
        }
    }
    /**
     * 上传一个附件，返回服务端给的 `upload_key`（发消息时放进 `upload_keys`）。
     *
     * 服务端契约（`channel/web/web_file.go` 的 writeJSON）：`{upload_key, name, size}` ——
     * 与 Web 前端读的字段一致（`res.upload_key`）。字段名写错会得到 undefined ⇒ 附件静默丢失。
     */
    async uploadAttachment(name, data, mime) {
        const raw = await this.http.uploadBytes('/api/files/upload', name, data, mime);
        const res = JSON.parse(raw);
        const key = res.upload_key;
        if (key === undefined || key.length === 0) {
            throw new Error('上传成功但响应里没有 upload_key（服务端契约变化？）');
        }
        return key;
    }
    async cancel() {
        await this.http.post('/api/cancel', new reqbody_1.SessionReq(this.channel, this.currentChatId));
    }
    // ── AskUser ────────────────────────────────────────────────────────────────
    pickAskUserFromProgress(p) {
        const qs = p.questions;
        if (qs === undefined || qs.length === 0) {
            return;
        }
        const prompt = { request_id: p.request_id, questions: qs };
        this.askUser = prompt;
    }
    /** 回答（answers: questionId → 文本）。cancelled=true 表示"取消/跳过"。 */
    async respondAsk(answers, cancelled) {
        const prompt = this.askUser;
        if (prompt === null) {
            return;
        }
        let firstQ = '';
        const qs = prompt.questions;
        if (qs !== undefined && qs.length > 0 && qs[0].id !== undefined) {
            firstQ = qs[0].id;
        }
        const single = answers[firstQ] !== undefined ? answers[firstQ] : '';
        await this.http.post('/api/ask_user/respond', new reqbody_1.AskRespondReq(this.channel, this.currentChatId, firstQ, single, answers, cancelled));
        this.askUser = null;
        this.onUpdate();
    }
    // ── 待发队列 ───────────────────────────────────────────────────────────────
    async loadQueue() {
        try {
            const data = await this.http.postAs('/api/queue/list', new reqbody_1.SessionReq(this.channel, this.currentChatId));
            const list = data.items !== undefined ? data.items
                : (data.queue !== undefined ? data.queue : []);
            this.queue = list;
            this.onUpdate();
        }
        catch (e) {
            // 队列不可用时静默（不影响主链路）
        }
    }
    async cancelQueued(msgId) {
        await this.http.post('/api/queue/cancel', new reqbody_1.QueueCancelReq(this.channel, this.currentChatId, msgId));
        await this.loadQueue();
    }
    /** 上/下移一格：把当前顺序投影回服务端（msg_ids 即权威顺序）。 */
    async moveQueued(msgId, dir) {
        const ids = [];
        for (let i = 0; i < this.queue.length; i++) {
            const id = this.queue[i].msg_id !== undefined ? this.queue[i].msg_id
                : (this.queue[i].id !== undefined ? this.queue[i].id : '');
            if (id.length > 0) {
                ids.push(id);
            }
        }
        const at = ids.indexOf(msgId);
        if (at < 0) {
            return;
        }
        const to = at + dir;
        if (to < 0 || to >= ids.length) {
            return;
        }
        const tmp = ids[at];
        ids[at] = ids[to];
        ids[to] = tmp;
        await this.http.post('/api/queue/reorder', new reqbody_1.QueueReorderReq(this.channel, this.currentChatId, ids));
        await this.loadQueue();
    }
    // ── 插件面板（ArkWeb 用） ──────────────────────────────────────────────────
    /**
     * 拉取带 web 产物的插件清单。
     * 服务端 RPC `web_plugin_list`（只返回声明了 web.entry 的插件）；
     * URL 若后端未给 module_url，则按 `/plugins/<id>/web/<entry>` 拼（与 web 前端同构）。
     */
    async listPlugins() {
        const out = [];
        try {
            const data = await this.http.postAs('/api/rpc', new reqbody_1.RpcReq('web_plugin_list'));
            const list = data.plugins !== undefined ? data.plugins : [];
            for (let i = 0; i < list.length; i++) {
                const p = list[i];
                const id = p.id !== undefined ? p.id
                    : (p.plugin_id !== undefined ? p.plugin_id : '');
                if (id.length === 0) {
                    continue;
                }
                const entry = p.entry !== undefined && p.entry.length > 0 ? p.entry : 'index.js';
                const info = new types_1.PluginPanelInfo();
                info.id = id;
                info.name = p.name !== undefined && p.name.length > 0 ? p.name
                    : (p.label !== undefined ? p.label : id);
                info.url = p.module_url !== undefined && p.module_url.length > 0
                    ? p.module_url
                    : `${this.http.baseUrl}/plugins/${id}/web/${entry}`;
                info.icon = p.icon !== undefined ? p.icon : '';
                out.push(info);
            }
        }
        catch (e) {
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
    dispose() {
        try {
            this.sse.close();
        }
        catch (e) {
            // 关闭失败不影响释放语义
        }
        this.onUpdate = () => {
        };
    }
    subscribe() {
        if (this.currentChatId.length === 0) {
            return;
        }
        this.sse.connect(this.currentChatId, this.channel, this.http.cookieHeaderForStream(), (event, data) => {
            this.onSse(event, data);
        });
    }
    onSse(event, data) {
        if (event === types_1.SseEventType.heartbeat) {
            return;
        }
        let raw;
        try {
            raw = JSON.parse(data);
        }
        catch (e) {
            return;
        }
        if (event === types_1.SseEventType.askUser) {
            const env = JSON.parse(data);
            if (env.progress !== undefined) {
                this.pickAskUserFromProgress(env.progress);
                this.onUpdate();
            }
            return;
        }
        if (event === types_1.SseEventType.askUserResolved) {
            this.askUser = null;
            this.onUpdate();
            return;
        }
        if (event === types_1.SseEventType.queueState) {
            this.loadQueue();
            return;
        }
        if (event === types_1.SseEventType.resyncRequired) {
            // 环形缓冲已淘汰 ⇒ 回退 DB 权威快照（web 同款语义）
            this.loadHistory().catch((e) => {
                console.error(`resync 失败: ${e.message}`);
            });
            return;
        }
        // ⛔ 事件 → DomainEvent 的**唯一入口**（逐字移植 web `normalize.ts` 的 normalizeEvent）：
        //   按**事件名**分流（raw.type）、chat 过滤、null 数组归一、数值校验全在 normalize 里。
        //   SSE 事件名 = 权威类型（web WSMessage.type 同源）——绝不按载荷字段猜分类
        //   （服务端会给流式帧盖 iteration，猜错会把 stream_* 当结构化静默丢弃）。
        raw['type'] = event;
        this.pushEvents((0, normalize_1.normalizeEvent)(raw, this.currentChatId));
        // session 事件：idle 收尾后刷新权威状态（todos/用量/会话树 running）。状态机本身
        // 已按 reduce 的 session 分支定格/清 activeTurn —— 这里只是 REST 对账（web 的
        // AgentPanel 在 busy→idle 边沿重取 get_goal 的同一语义）。
        if (event === types_1.SseEventType.session) {
            const env = JSON.parse(data);
            const action = env.session !== undefined && env.session.action !== undefined
                ? env.session.action : '';
            if (action === 'idle' || action === 'agent-idle') {
                this.loadStatus().catch(() => {
                    // 状态非关键路径
                });
                this.loadSessions().catch(() => {
                    // 对账失败不影响主链路
                });
            }
        }
    }
}
exports.ChatStore = ChatStore;
// ── 请求体（显式字段 = 协议契约，见 channel/web/web_rest.go） ─────────────────
class HistoryBody {
    constructor(channel, chatId, limit, beforeId) {
        this.channel = channel;
        this.chat_id = chatId;
        this.limit = limit;
        this.before_id = beforeId;
    }
}
exports.HistoryBody = HistoryBody;
/** `/api/settings` 的请求体（`{settings:{…}}`）。 */
class SettingsBody {
    constructor(settings) {
        this.settings = settings;
    }
}
exports.SettingsBody = SettingsBody;
class IterationDetailBody {
    constructor(channel, chatId, turnId, iteration) {
        this.channel = channel;
        this.chat_id = chatId;
        this.turn_id = turnId;
        this.iteration = iteration;
    }
}
exports.IterationDetailBody = IterationDetailBody;
class AskRespondBody {
    constructor(channel, chatId, questionId, answer, answers, cancelled) {
        this.channel = channel;
        this.chat_id = chatId;
        this.question_id = questionId;
        this.answer = answer;
        this.answers = answers;
        this.cancelled = cancelled;
    }
}
exports.AskRespondBody = AskRespondBody;
class QueueCancelBody {
    constructor(channel, chatId, msgId) {
        this.channel = channel;
        this.chat_id = chatId;
        this.msg_id = msgId;
    }
}
exports.QueueCancelBody = QueueCancelBody;
class QueueReorderBody {
    constructor(channel, chatId, msgIds) {
        this.channel = channel;
        this.chat_id = chatId;
        this.msg_ids = msgIds;
    }
}
exports.QueueReorderBody = QueueReorderBody;
class RegionsBody {
    constructor(channel, chatId, turnId, beforeIter, regionLimit) {
        this.channel = channel;
        this.chat_id = chatId;
        this.turn_id = turnId;
        this.before_iteration = beforeIter;
        this.region_limit = regionLimit;
    }
}
exports.RegionsBody = RegionsBody;
class RpcBody {
    constructor(method, params) {
        this.method = method;
        this.params = params;
    }
}
exports.RpcBody = RpcBody;
/** 工具摘要（UI 复用）。 */
function toolsSummary(tools) {
    const names = [];
    for (let i = 0; i < tools.length; i++) {
        names.push(tools[i].name);
    }
    return names.join(' · ');
}
