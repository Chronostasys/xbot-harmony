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
const streammerge_1 = require("./streammerge");
const sessionpick_1 = require("./sessionpick");
const sessionops_1 = require("./sessionops");
const panels_1 = require("./panels");
const settings_1 = require("./settings");
const reqbody_1 = require("./reqbody");
const types_1 = require("./types");
class ChatStore {
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
        this.rows = [];
        this.busy = false;
        /**
         * 服务端会话树给出的**权威**忙碌标记（`sessions[i].running`）。
         * ⛔ 用途：迟到的 coarse `session(idle)`（SSE 重放 / 切后台恢复）不能冻结在飞的回合 ——
         * 只要权威仍说 running，就把这条 idle 当陈旧信号忽略（真结束由会话树翻 false 收尾）。
         */
        this.serverRunning = false;
        this.currentChatId = '';
        this.lastSeq = 0;
        /**
         * **turn 级**流式缓冲（对齐 web `ProgressStore.streamContent/streamReasoning/streamingTools`）。
         * ⛔ 绝不能把流式内容直接挂到某个 iteration 对象上：流式帧的归属迭代会随服务端盖号变化，
         *    挂错就会"同一段内容重复渲染到不同迭代"（真机 2026-10-10）。正确模型：
         *    · 流式帧只写这组缓冲；**迭代前进时**把缓冲"折叠"进上一迭代，然后清空；
         *    · 收尾（text / idle）时折叠进当前迭代并清空。
         */
        this.streamText = '';
        this.streamReasoning = '';
        this.streamTools = [];
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
        // ⛔ busy 对账（真机 P0，2026-10-10）：会话树是**快照**，服务端 `running` 标记有 RTT 延迟。
        //  只在 ① 权威说 running=true（恢复），或 ② 本地确实没有在飞的 live 行且已过发送保护窗口
        //  时才用它改 busy；否则会把**在飞的回合**误判成空闲 ⇒「思考中」一闪一没、
        //  中间无任何打字机/进度、收尾才蹦出完整迭代（用户报告）。
        let found = false;
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].chat_id !== this.currentChatId) {
                continue;
            }
            found = true;
            const serverRunning = this.sessions[i].running === true;
            this.serverRunning = serverRunning;
            // ⛔ 对账只在 ① 权威 running=true（恢复）或 ② 本地确实没有在飞的 live 行
            //   且已过发送保护窗口 时才动 busy；否则会把在飞回合误判成空闲。
            if (serverRunning || (!this.hasLiveRow() && Date.now() - this.lastSendAt > 3000)) {
                this.busy = serverRunning;
            }
            break;
        }
        // web 用 `currentSession?.running ?? false`：会话不在列表里 ⇒ 权威值回落 false
        if (!found) {
            this.serverRunning = false;
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
        this.rows = ChatStore.rowsFromHistory(data.messages !== undefined ? data.messages : []);
        this.applyHistoryMeta(data);
        const ap = data.active_progress;
        if (ap !== undefined) {
            if (ap.busy === true) {
                this.busy = true;
            }
            // active_progress 是服务端权威快照 —— 与 web 的 `case 'progress_structured' | 'sync_progress'`
            // 同路：结构化字段走结构化路径；若快照同时带流式字段（熄屏/弱网恢复的 catch-up），
            // 再按流式路径补一遍打字机缓冲（两路径都只写自己那份字段，互不覆盖）。
            this.applyStructuredProgress(ap);
            if (ap.stream_content !== undefined || ap.stream_delta !== undefined
                || ap.reasoning_stream_content !== undefined || ap.reasoning_stream_delta !== undefined
                || (ap.streaming_tools !== undefined && ap.streaming_tools.length > 0)) {
                this.applyStreamProgress(ap);
            }
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
            const older = ChatStore.rowsFromHistory(data.messages !== undefined ? data.messages : []);
            this.rows = older.concat(this.rows);
            this.applyHistoryMeta(data);
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
    /** 历史 → 渲染行（每 turn 取第一条 user + 最后一条 assistant）。 */
    static rowsFromHistory(messages) {
        const out = [];
        let current = null;
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            const turnID = m.turn_id !== undefined ? m.turn_id : 0;
            if (m.role === 'user') {
                const r = new types_1.ChatRow();
                r.id = `u-${m.id}`; // 历史行：消息 id 天然唯一
                r.role = 'user';
                r.turnID = turnID;
                r.content = m.content !== undefined ? m.content : '';
                out.push(r);
                current = null;
            }
            else if (m.role === 'assistant') {
                if (current === null || current.turnID !== turnID) {
                    const r = new types_1.ChatRow();
                    r.id = `a-${m.id}`; // 历史行：消息 id 天然唯一
                    r.role = 'assistant';
                    r.turnID = turnID;
                    r.content = m.content !== undefined ? m.content : '';
                    r.iterations = m.iterations !== undefined ? m.iterations : [];
                    r.regionsBefore = m.regions_before !== undefined ? m.regions_before : 0;
                    out.push(r);
                    current = r;
                }
                else {
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
        const visible = [];
        for (let i = 0; i < out.length; i++) {
            const r = out[i];
            if (r.role === 'user' || !(0, streammerge_1.rowIsEmpty)(r)) {
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
        const merged = [];
        const seen = new Set();
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
    async fetchIterationDetail(turnID, iteration) {
        try {
            const data = await this.http.postAs('/api/iteration_detail', new reqbody_1.IterationDetailReq(this.channel, this.currentChatId, turnID, iteration));
            const it = data.iteration;
            if (it === undefined) {
                return null;
            }
            this.mergeIterationDetail(turnID, it);
            return it;
        }
        catch (e) {
            return null;
        }
    }
    mergeIterationDetail(turnID, it) {
        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];
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
    appendLocalUser(text) {
        const r = new types_1.ChatRow();
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
    async send(text, uploadKeys, fileNames, fileSizes, interrupt) {
        const isInterrupt = interrupt === true;
        this.lastSendAt = Date.now();
        let row = undefined;
        if (!isInterrupt) {
            row = this.appendLocalUser(text);
            this.busy = true;
        }
        this.onUpdate();
        try {
            const raw = await this.http.post('/api/message', new reqbody_1.MessageReq(this.channel, this.currentChatId, text, uploadKeys, fileNames, fileSizes, isInterrupt));
            if (isInterrupt) {
                return true;
            }
            // 服务端可能把插话退化成普通发送（会话当时空闲）—— 按 ack 如实回执
            try {
                const ack = JSON.parse(raw);
                return ack.interrupted === true;
            }
            catch (e) {
                return false;
            }
        }
        catch (e) {
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
        let env;
        try {
            env = JSON.parse(data);
        }
        catch (e) {
            return;
        }
        if (event === types_1.SseEventType.heartbeat) {
            return;
        }
        if (event === types_1.SseEventType.session) {
            this.onSessionEvent(env.session);
            return;
        }
        if (event === types_1.SseEventType.userEcho) {
            this.onUserEcho(env);
            return;
        }
        // ⛔ 派发必须按**事件名**（web `useProgressStream.ts` 就是 `switch (msg.type)`）——
        //   绝不能用载荷字段猜分类：服务端会给**流式帧**盖 iteration（切迭代边界语义），
        //   用字段猜会把流式帧判成"结构化" ⇒ stream_* 被 applyStructured 静默丢弃 ⇒ 整段流式不渲染。
        if (event === types_1.SseEventType.streamContent) {
            if (env.progress !== undefined) {
                this.applyStreamProgress(env.progress);
                this.pickAskUserFromProgress(env.progress);
            }
            return;
        }
        if (event === types_1.SseEventType.progressStructured || event === types_1.SseEventType.syncProgress) {
            if (env.progress !== undefined) {
                this.applyStructuredProgress(env.progress);
                this.pickAskUserFromProgress(env.progress);
            }
            return;
        }
        if (event === types_1.SseEventType.askUser) {
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
        if (event === types_1.SseEventType.text) {
            this.onFinalText(env);
            return;
        }
        if (event === types_1.SseEventType.resyncRequired) {
            // 环形缓冲已淘汰 ⇒ 回退 DB 权威快照（web 同款语义）
            this.loadHistory().catch((e) => {
                console.error(`resync 失败: ${e.message}`);
            });
        }
    }
    onSessionEvent(ev) {
        if (ev === undefined) {
            return;
        }
        // ⚠️ 服务端字段是 `action`（不是 `state`，见 core/streammerge.ets 注释）
        const action = ev.action !== undefined ? ev.action : '';
        if ((0, streammerge_1.isIdleAction)(action)) {
            // ⛔ 迟到的 coarse idle（SSE `last_event_id` 重放 / restoreActiveProgress 竞态）
            //   绝不能冻结在飞的回合：权威会话树仍说 running ⇒ 视为陈旧信号，只去刷新权威状态。
            if (this.serverRunning) {
                // ⛔ 权威（会话树 running）仍为 true ⇒ 这条 coarse idle 必然陈旧/误传，
                //    不得冻结运行中的 turn（web reduce.ts `case 'session'` 同款闸门）。
                //    真结束由会话树翻 false 后的下一条 idle 收尾。
                this.loadSessions().catch(() => {
                    // 忽略
                });
                return;
            }
            // 照抄 web：idle = live 的**收尾兜底**（有产出定格 / 空壳保留 / 真空壳删除）
            this.settleLiveOnIdle();
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
        }
        else if ((0, streammerge_1.isBusyAction)(action)) {
            this.busy = true;
            // 回合开始 ⇒ 水位重置（新 Run 的 seq 从 1 计数）
            this.lastSeq = 0;
            this.onUpdate();
        }
        else if ((0, streammerge_1.shouldReloadHistory)(action)) {
            // 历史被回退 ⇒ 必须重载，否则界面停留在已被撤销的内容上
            this.loadHistory().catch((e) => {
                console.error(`rewound 重载失败: ${e.message}`);
            });
        }
    }
    /**
     * idle 收尾 —— **逐字对齐 web `reduce.ts` 的 `case 'session'` idle 分支**：
     *  · 有产出的 live 行 ⇒ **定格**（`isLive=false`，内容全部保留 = frozen 语义）
     *  · 无产出但前面有 user 行 ⇒ **保留为空壳**（只定格，不删 —— 否则 user 行悬空/粘连）
     *  · 无产出且无 user 行 ⇒ **删除**（"空壳行灭绝"）
     */
    settleLiveOnIdle() {
        // 回合结束 ⇒ 先折叠残留缓冲（把最后一段流式内容落到当前迭代），再定格/删除
        for (let i = this.rows.length - 1; i >= 0; i--) {
            if (this.rows[i].role === 'assistant' && this.rows[i].isLive) {
                this.foldStreamBuffers(this.rows[i]);
                break;
            }
        }
        for (let i = this.rows.length - 1; i >= 0; i--) {
            const r = this.rows[i];
            if (r.role !== 'assistant' || !r.isLive) {
                continue;
            }
            const hasOutput = r.iterations.length > 0 && !(0, streammerge_1.rowIsEmpty)(r);
            const prev = i > 0 ? this.rows[i - 1] : undefined;
            const hasUser = prev !== undefined && prev.role === 'user';
            if (hasOutput || hasUser) {
                r.isLive = false;
                this.touch(r);
            }
            else {
                this.rows.splice(i, 1);
            }
            return;
        }
    }
    onUserEcho(env) {
        const text = env.content !== undefined ? env.content : '';
        const turnID = env.turn_id !== undefined ? env.turn_id : 0;
        for (let i = this.rows.length - 1; i >= 0; i--) {
            const r = this.rows[i];
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
        const r = new types_1.ChatRow();
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
    hasLiveRow() {
        for (let i = this.rows.length - 1; i >= 0; i--) {
            const r = this.rows[i];
            if (r.role === 'assistant' && r.isLive) {
                return true;
            }
        }
        return false;
    }
    liveRow() {
        const last = this.rows.length > 0 ? this.rows[this.rows.length - 1] : undefined;
        if (last !== undefined && last.role === 'assistant' && last.isLive) {
            return last;
        }
        const r = new types_1.ChatRow();
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
    liveMaxIter() {
        for (let i = this.rows.length - 1; i >= 0; i--) {
            const r = this.rows[i];
            if (r.role === 'assistant' && r.isLive) {
                let max = 0;
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
    /**
     * 流式帧（`stream_content`）—— 与 web `useProgressStream.ts` 的 `case 'stream_content'` **一一对应**。
     * ⛔ 本路径**不看**载荷是否"像结构化"：事件名已决定语义（服务端会给流式帧盖 iteration 用于切边界）。
     */
    applyStreamProgress(p) {
        const row = this.liveRow();
        // 迭代前进 ⇒ 先把 turn 级缓冲折叠进**上一迭代**（web: advanced ⇒ fold），再清缓冲
        if (p.iteration !== undefined && p.iteration > 0 && p.iteration > (0, streammerge_1.liveIterationOf)(row).iteration) {
            this.foldStreamBuffers(row);
            (0, streammerge_1.upsertIteration)(row, p.iteration);
        }
        // 只写 turn 级缓冲（delta 追加 / checkpoint 替换）——与 web setStreamContent/appendStreamContent 同义
        if (p.stream_content !== undefined && p.stream_content.length > 0) {
            this.streamText = p.stream_content;
        }
        else if (p.stream_delta !== undefined && p.stream_delta.length > 0) {
            this.streamText = this.streamText + p.stream_delta;
        }
        if (p.reasoning_stream_content !== undefined && p.reasoning_stream_content.length > 0) {
            this.streamReasoning = p.reasoning_stream_content;
        }
        else if (p.reasoning_stream_delta !== undefined && p.reasoning_stream_delta.length > 0) {
            this.streamReasoning = this.streamReasoning + p.reasoning_stream_delta;
        }
        if (p.streaming_tools !== undefined && p.streaming_tools.length > 0) {
            this.streamTools = (0, streammerge_1.mergeTools)(this.streamTools, p.streaming_tools);
        }
        this.touch(row);
        this.onUpdate();
    }
    /** 把 turn 级流式缓冲折叠进指定迭代（默认当前在飞迭代），并清空缓冲。 */
    foldStreamBuffers(row) {
        const it = (0, streammerge_1.liveIterationOf)(row);
        if (this.streamText.length > 0) {
            it.stream_text = this.streamText;
        }
        if (this.streamReasoning.length > 0) {
            it.stream_reasoning = this.streamReasoning;
        }
        if (this.streamTools.length > 0) {
            it.tools = (0, streammerge_1.mergeTools)(it.tools, this.streamTools);
        }
        this.streamText = '';
        this.streamReasoning = '';
        this.streamTools = [];
        this.touch(row);
    }
    /**
     * 结构化帧（`progress_structured` / `sync_progress`）—— 与 web 同名分支对应：
     * per-Run seq 水位（丢弃纯重放）+ 按号 upsert + 只覆盖"确实带了内容"的字段。
     */
    applyStructuredProgress(p) {
        const seq = p.seq !== undefined ? p.seq : 0;
        if (seq > 0 && (0, streammerge_1.isStaleSeqEvent)(this.lastSeq, seq, this.liveMaxIter(), p)) {
            return;
        }
        if (seq > 0) {
            this.lastSeq = seq;
        }
        const row = this.liveRow();
        const itNum = p.iteration !== undefined && p.iteration > 0
            ? p.iteration : (0, streammerge_1.liveIterationOf)(row).iteration;
        // 迭代前进 ⇒ 先把流式缓冲折叠进上一迭代（否则同一段内容会被重复渲染到两个迭代）
        if (itNum > (0, streammerge_1.liveIterationOf)(row).iteration) {
            this.foldStreamBuffers(row);
        }
        (0, streammerge_1.applyStructured)((0, streammerge_1.upsertIteration)(row, itNum), p);
        const hist = p.iteration_history;
        if (hist !== undefined) {
            for (let i = 0; i < hist.length; i++) {
                const h = hist[i];
                const target = (0, streammerge_1.upsertIteration)(row, h.iteration);
                if (h.content !== undefined && h.content.length > 0) {
                    target.content = h.content;
                    target.stream_text = '';
                }
                if (h.reasoning !== undefined && h.reasoning.length > 0) {
                    target.reasoning = h.reasoning;
                    target.stream_reasoning = '';
                }
                if (h.tools !== undefined && h.tools.length > 0) {
                    target.tools = (0, streammerge_1.mergeTools)(target.tools, h.tools);
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
    onFinalText(env) {
        const text = env.content !== undefined ? env.content : '';
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
        const last = this.rows[this.rows.length - 1];
        // ⛔ 空 text 且回合仍在跑 ⇒ 不终结 live 行（真实回复随后到）——
        //   否则会把 live 行的内容清空并置 isLive=false（用户报告："用户消息后什么都没有"）。
        if (text.length === 0 && this.busy && last.role === 'assistant' && last.isLive && !(0, streammerge_1.rowIsEmpty)(last)) {
            return;
        }
        if (last.role !== 'assistant') {
            if (text.length === 0) {
                return;
            }
            const r = new types_1.ChatRow();
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
            const itNum = (0, streammerge_1.liveIterationOf)(last).iteration;
            const it = (0, streammerge_1.upsertIteration)(last, itNum);
            it.content = text;
            it.stream_text = ''; // 权威快照接管，清流式缓冲
            // ⚠️ reasoning 绝不清空（进行中迭代的思考只存在于 live 快照，
            //    真机曾出现"提交后 Thought N chars 消失"）
        }
        this.foldStreamBuffers(last);
        last.isLive = false;
        last.turnID = env.turn_id !== undefined ? env.turn_id : last.turnID;
        this.touch(last);
        // 完全无产出（text 空、迭代也空）⇒ 不落地空行（空气泡）
        if ((0, streammerge_1.rowIsEmpty)(last)) {
            this.rows.splice(this.rows.length - 1, 1);
        }
        this.busy = false;
        this.lastSeq = 0;
        this.onUpdate();
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
