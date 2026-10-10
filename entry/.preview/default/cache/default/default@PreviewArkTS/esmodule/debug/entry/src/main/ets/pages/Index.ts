if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Index_Params {
    booted?: boolean;
    loggedIn?: boolean;
    errMsg?: string;
    serverUrl?: string;
    username?: string;
    password?: string;
    testing?: boolean;
    testMsg?: string;
    recentServers?: string[];
    sessions?: SessionItem[];
    rows?: ChatRow[];
    busy?: boolean;
    loadErr?: string;
    currentChat?: string;
    draft?: string;
    hasMore?: boolean;
    loadingMore?: boolean;
    queue?: QueueItem[];
    showDrawer?: boolean;
    showSettings?: boolean;
    showQueue?: boolean;
    showPlugins?: boolean;
    showSelfCheck?: boolean;
    atBottom?: boolean;
    rowLimit?: number;
    attachments?: AttachItem[];
    showStatus?: boolean;
    showModel?: boolean;
    llmCfg?: LlmConfig | undefined;
    ctxInput?: string;
    modelBusy?: string;
    sendMode?: string;
    cmdToken?: string;
    cmdItems?: CommandItem[];
    fsEntries?: FsEntry[];
    fsDir?: string;
    showPrefs?: boolean;
    settings?: Record<string, string>;
    reasoningDefaultApplied?: boolean;
    showPanels?: boolean;
    panelTab?: string;
    cronTasks?: CronJob[];
    bgTasks?: BgTask[];
    runners?: RunnerRow[];
    subagents?: SubAgentRow[];
    panelBusy?: boolean;
    sessQuery?: string;
    sessMenuId?: string;
    sessConfirmDelete?: string;
    searchHits?: SearchHit[];
    searchBusy?: boolean;
    showSearchHits?: boolean;
    ctxOpen?: boolean;
    ctxKind?: string;
    ctxRowId?: string;
    ctxIter?: number;
    ctxTool?: string;
    usage?: TokenUsage | undefined;
    cwd?: string;
    todos?: TodoItem[];
    goal?: GoalInfo | undefined;
    geoText?: string;
    geoRunning?: boolean;
    auditing?: boolean;
    auditLog?: string;
    renamingId?: string;
    renameText?: string;
    askUser?: AskUserPrompt | null;
    askSelections?: AskSelection[];
    askBusy?: boolean;
    plugins?: PluginPanelInfo[];
    panelUrl?: string;
    imagePixel?: image.PixelMap | null;
    imageBusy?: boolean;
    cookie?: string;
    authExpiredHandled?: boolean;
    themeName?: string;
    connState?: string;
    composerFocused?: boolean;
    useWebUI?: boolean;
    webUiUrl?: string;
    webCookieReady?: boolean;
    surfaceApplied?: boolean;
    safeTop?: number;
    safeBottom?: number;
    liveOn?: boolean;
    liveText?: string;
    liveReasoning?: string;
    liveTools?: ToolProgress[];
    liveIterNo?: number;
    liveRowTurn?: number;
    lastLiveLen?: number;
    historyLoading?: boolean;
    sweepX?: number;
    listAlpha?: number;
    failedSend?: string;
    draftTimer?: number;
    pulseOn?: boolean;
    pulseTimer?: number;
    imgScale?: number;
    imgTransX?: number;
    imgTransY?: number;
    imgW?: number;
    imgH?: number;
    viewW?: number;
    viewH?: number;
    imgBaseScale?: number;
    imgBaseX?: number;
    imgBaseY?: number;
    openToolKey?: string;
    openReasonKey?: string;
    expandedTurn?: string;
    showReasoning?: boolean;
    store?: ChatStore | null;
    pendingSync?: ChatStore | null;
    pools?: Map<string, ChatStore>;
    poolOrder?: string[];
    syncScheduled?: boolean;
    config?: ConfigStore;
    listScroller?: Scroller;
    rowDs?: ChatRowDataSource;
    appPaused?: boolean;
    rowsFp?: string;
    sessionsFp?: string;
    queueFp?: string;
    todosFp?: string;
}
import type common from "@ohos:app.ability.common";
import fileIo from "@ohos:file.fs";
import picker from "@ohos:file.picker";
import componentSnapshot from "@ohos:arkui.componentSnapshot";
import componentUtils from "@ohos:arkui.componentUtils";
import display from "@ohos:display";
import promptAction from "@ohos:promptAction";
import image from "@ohos:multimedia.image";
import pasteboard from "@ohos:pasteboard";
import vibrator from "@ohos:vibrator";
import photoAccessHelper from "@ohos:file.photoAccessHelper";
import type { BusinessError as BusinessError } from "@ohos:base";
import util from "@ohos:util";
import { AppConfig, ConfigStore, isValidServerUrl, normalizeServerUrl } from "@normalized:N&&&entry/src/main/ets/core/config&";
import webview from "@ohos:web.webview";
import { ChatStore } from "@normalized:N&&&entry/src/main/ets/core/store&";
import { normalizeTheme, paletteOf, themeLabel, toggleTheme } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import { loadErrHint, loadErrTitle, needsRelogin, needsSessionRefresh } from "@normalized:N&&&entry/src/main/ets/core/autherr&";
import { canMove, MOVE_DOWN, MOVE_TOP, MOVE_UP, hitLine, sessionLabel, sessionMatches, } from "@normalized:N&&&entry/src/main/ets/core/sessionops&";
import { bgTaskLine, cronLine, runnerLine, subagentLine, } from "@normalized:N&&&entry/src/main/ets/core/panels&";
import type { BgTask, CronJob, RunnerRow, SubAgentRow } from "@normalized:N&&&entry/src/main/ets/core/panels&";
import { activeToken, applyCommand, applyMention, CommandItem, enterSends, joinPath, matchCommands, parentDir, } from "@normalized:N&&&entry/src/main/ets/core/composer&";
import type { FsEntry } from "@normalized:N&&&entry/src/main/ets/core/composer&";
import { clampOffset, clampScale, isZoomed, nextZoom, panLimit, saveImageName, scaleText, } from "@normalized:N&&&entry/src/main/ets/core/imgops&";
import { fontScaleFrom, fontScaleLabel, fontScalePresets, KEY_APP_THEME, KEY_CODE_WRAP, KEY_FONT_SCALE, KEY_SURFACE, KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_REASONING_DEFAULT, KEY_SEND_KEY, normalizeSendKey, parseBool, sendKeyLabel, settingOf, settingLabel, SEND_KEY_MOD_ENTER, } from "@normalized:N&&&entry/src/main/ets/core/settings&";
import { isInterruptSend, MODE_INTERRUPT, MODE_QUEUE, modeHint, modeLabel, sendToast, toggleMode, } from "@normalized:N&&&entry/src/main/ets/core/sendmode&";
import { mdCacheStats } from "@normalized:N&&&entry/src/main/ets/core/markdown&";
import type { MdCacheStats } from "@normalized:N&&&entry/src/main/ets/core/markdown&";
import { displayContent, displayReasoning, rowIsEmpty, streamStatsText } from "@normalized:N&&&entry/src/main/ets/core/streammerge&";
import { channelLabel, hiddenRowCount, MAX_ROWS_VISIBLE, } from "@normalized:N&&&entry/src/main/ets/core/sessionpick&";
import { ATTACH_DONE, ATTACH_FAILED, ATTACH_UPLOADING, AttachItem, MAX_ATTACH, appendRef, attachChipText, baseName, doneKeys, doneNames, doneRefs, doneSizes, hasRef, mimeOf, patchByUid, pendingCount, removeByUid, } from "@normalized:N&&&entry/src/main/ets/core/attach&";
import { changedRowIndices, identityChanged, needsFullReload, rowsFpOf, scopedFingerprint, sessionScopedRowKey, tailRows } from "@normalized:N&&&entry/src/main/ets/core/rowdiff&";
import { currentTodo, goalText, modelText, todoProgress, usageText, } from "@normalized:N&&&entry/src/main/ets/core/statusfmt&";
import { contextPresets, contextText, currentModelText, groupModels, modelLabel, parseContext, selectable, } from "@normalized:N&&&entry/src/main/ets/core/llmfmt&";
import type { LlmConfig, LlmModelEntry, ModelGroup } from "@normalized:N&&&entry/src/main/ets/core/llmfmt&";
import { COPY_RAW, COPY_REPLY, COPY_THINKING, COPY_TOOLS, CopyParts, composeCopy, linkLabel, linksIn, resolveOpenable, toolArgsOnly, toolCopyText, toolResultOnly, } from "@normalized:N&&&entry/src/main/ets/core/msgops&";
import type { AskOption, AskQuestion, AskUserPrompt, ChatRow, GoalInfo, HistoryIteration, PluginPanelInfo, QueueItem, SearchHit, SessionItem, TodoItem, TokenUsage, ToolProgress } from '../core/types';
import { LiveTailView } from "@normalized:N&&&entry/src/main/ets/components/LiveTailView&";
import { MessageRowView } from "@normalized:N&&&entry/src/main/ets/components/MessageRow&";
import { UserBubbleView } from "@normalized:N&&&entry/src/main/ets/components/UserBubble&";
import { MarkdownView } from "@normalized:N&&&entry/src/main/ets/components/MarkdownView&";
import { WebSurface } from "@normalized:N&&&entry/src/main/ets/components/WebSurface&";
/** 一个问题当前选中的答案（用类而非 Map/Record：ArkTS 下最稳，且能整体替换触发重渲染）。 */
class AskSelection {
    qid: string = '';
    labels: string[] = [];
    other: string = '';
}
/**
 * 单个 turn 默认最多渲染多少个迭代。
 *
 * ⛔ 为什么必须限制：一个 turn 可能有**上千个迭代**（每次工具调用一个），若全部渲染 ——
 * 每个迭代还带完整 Markdown（含 Span/表格/代码块）—— 视口内外的 DOM 会瞬间上千，
 * 表现就是**卡到没法用 / 看起来"整个渲染错乱"**。Web 端同样的问题是用"迭代级窗口化"解决的
 * （见 xbot 仓库 docs/agent/gotchas-web-frontend.md）。这里先用**上限 + 手动展开**做等价保护。
 */
const MAX_ITER_VISIBLE: number = 16;
/**
 * 诊断开关：登录后**自动**走查并上传所有页面截图。
 *
 * 为什么需要它：用户反馈"渲染错乱、完全用不了"时，可能**连 ⚙ 都点不到** ⇒
 * 交互式触发不可靠。置 true 后 App 会在登录后自行走查一遍（每页截图上传到服务端），
 * 供排查用。**排查完成应改回 false**（避免每次启动都上传）。
 */
/** 把任意 catch 到的值变成可读文本（BusinessError 有 message/code；其它情况回落 JSON）。 */
function errText(e: Object): string {
    const err: BusinessError = e as BusinessError;
    const m: string = err.message !== undefined ? err.message : '';
    const c: string = err.code !== undefined ? `${err.code}` : '';
    if (m.length > 0) {
        return c.length > 0 ? `${m}（code ${c}）` : m;
    }
    const raw: string = JSON.stringify(e);
    return raw !== undefined && raw.length > 2 ? raw : '未知错误';
}
/**
 * 按 AskUser 载荷生成选择状态。
 * ⚠️ 模块级函数而非 `struct Index` 的 static 方法（ArkUI struct 的静态成员在真机上
 * 是 undefined，调用即 "undefined is not callable"）。
 */
function selectionsFor(ask: AskUserPrompt | null): AskSelection[] {
    const out: AskSelection[] = [];
    if (ask === null || ask.questions === undefined) {
        return out;
    }
    for (let i = 0; i < ask.questions.length; i++) {
        const q: AskQuestion = ask.questions[i];
        const sel: AskSelection = new AskSelection();
        sel.qid = q.id !== undefined ? q.id : `q${i}`;
        out.push(sel);
    }
    return out;
}
/**
 * markdown 解析缓存的一行摘要（**模块级函数**：ArkUI 的 struct 不是普通类，真机上静态成员会解析成
 * undefined —— 见 docs/ARKTS-GOTCHAS.md）。放在自检页是为了在真机截图上**证明**"整行反复重建
 * 不再反复解析几百 KB"这条优化确实在命中。
 */
function mdCacheText(): string {
    const st: MdCacheStats = mdCacheStats();
    const total: number = st.hits + st.misses;
    const rate: number = total > 0 ? Math.round(st.hits * 100 / total) : 0;
    return `md缓存 命中=${st.hits} 未命中=${st.misses}（命中率 ${rate}%）`
        + ` 占用=${Math.round(st.chars / 1024)}KB 条目=${st.entries}`;
}
/**
 * 消息列表的项数 = [可选"加载更早消息"项] + rows + [可选 busy 指示器项]。
 *
 * 必须显式算：`onScrollIndex` 给的是**列表项**下标，而项数不等于 rows.length
 * （头部可能多一项、尾部可能多一项 busy 指示器）—— 用错就会误判"在不在底部"。
 * 模块级函数：ArkUI 的 struct 不是普通类，真机上静态成员会解析成 undefined（见 docs/ARKTS-GOTCHAS.md）。
 */
function listItemCount(hasMore: boolean, loadingMore: boolean, rowsLen: number, busy: boolean): number {
    let n: number = rowsLen;
    if (hasMore || loadingMore) {
        n += 1;
    }
    if (busy) {
        n += 1;
    }
    return n;
}
class Index extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__booted = new ObservedPropertySimplePU(false, this, "booted");
        this.__loggedIn = new ObservedPropertySimplePU(false, this, "loggedIn");
        this.__errMsg = new ObservedPropertySimplePU('', this, "errMsg");
        this.__serverUrl = new ObservedPropertySimplePU('http://', this, "serverUrl");
        this.__username = new ObservedPropertySimplePU('', this, "username");
        this.__password = new ObservedPropertySimplePU('', this, "password");
        this.__testing = new ObservedPropertySimplePU(false, this, "testing");
        this.__testMsg = new ObservedPropertySimplePU('', this, "testMsg");
        this.__recentServers = new ObservedPropertyObjectPU([], this, "recentServers");
        this.__sessions = new ObservedPropertyObjectPU([], this, "sessions");
        this.__rows = new ObservedPropertyObjectPU([], this, "rows");
        this.__busy = new ObservedPropertySimplePU(false, this, "busy");
        this.__loadErr = new ObservedPropertySimplePU('', this, "loadErr");
        this.__currentChat = new ObservedPropertySimplePU('', this, "currentChat");
        this.__draft = new ObservedPropertySimplePU('', this, "draft");
        this.__hasMore = new ObservedPropertySimplePU(false, this, "hasMore");
        this.__loadingMore = new ObservedPropertySimplePU(false, this, "loadingMore");
        this.__queue = new ObservedPropertyObjectPU([], this, "queue");
        this.__showDrawer = new ObservedPropertySimplePU(false, this, "showDrawer");
        this.__showSettings = new ObservedPropertySimplePU(false, this, "showSettings");
        this.__showQueue = new ObservedPropertySimplePU(false, this, "showQueue");
        this.__showPlugins = new ObservedPropertySimplePU(false, this, "showPlugins");
        this.__showSelfCheck = new ObservedPropertySimplePU(false, this, "showSelfCheck");
        this.__atBottom = new ObservedPropertySimplePU(true, this, "atBottom");
        this.__rowLimit = new ObservedPropertySimplePU(MAX_ROWS_VISIBLE, this, "rowLimit");
        this.__attachments = new ObservedPropertyObjectPU([], this, "attachments");
        this.__showStatus = new ObservedPropertySimplePU(false, this, "showStatus");
        this.__showModel = new ObservedPropertySimplePU(false, this, "showModel");
        this.__llmCfg = new ObservedPropertyObjectPU(undefined, this, "llmCfg");
        this.__ctxInput = new ObservedPropertySimplePU('', this, "ctxInput");
        this.__modelBusy = new ObservedPropertySimplePU('', this, "modelBusy");
        this.__sendMode = new ObservedPropertySimplePU(MODE_QUEUE, this, "sendMode");
        this.__cmdToken = new ObservedPropertySimplePU('', this, "cmdToken");
        this.__cmdItems = new ObservedPropertyObjectPU([], this, "cmdItems");
        this.__fsEntries = new ObservedPropertyObjectPU([], this, "fsEntries");
        this.__fsDir = new ObservedPropertySimplePU('/', this, "fsDir");
        this.__showPrefs = new ObservedPropertySimplePU(false, this, "showPrefs");
        this.__settings = new ObservedPropertyObjectPU({}, this, "settings");
        this.reasoningDefaultApplied = false;
        this.__showPanels = new ObservedPropertySimplePU(false, this, "showPanels");
        this.__panelTab = new ObservedPropertySimplePU('cron', this, "panelTab");
        this.__cronTasks = new ObservedPropertyObjectPU([], this, "cronTasks");
        this.__bgTasks = new ObservedPropertyObjectPU([], this, "bgTasks");
        this.__runners = new ObservedPropertyObjectPU([], this, "runners");
        this.__subagents = new ObservedPropertyObjectPU([], this, "subagents");
        this.__panelBusy = new ObservedPropertySimplePU(false, this, "panelBusy");
        this.__sessQuery = new ObservedPropertySimplePU('', this, "sessQuery");
        this.__sessMenuId = new ObservedPropertySimplePU('', this, "sessMenuId");
        this.__sessConfirmDelete = new ObservedPropertySimplePU('', this, "sessConfirmDelete");
        this.__searchHits = new ObservedPropertyObjectPU([], this, "searchHits");
        this.__searchBusy = new ObservedPropertySimplePU(false, this, "searchBusy");
        this.__showSearchHits = new ObservedPropertySimplePU(false, this, "showSearchHits");
        this.__ctxOpen = new ObservedPropertySimplePU(false, this, "ctxOpen");
        this.__ctxKind = new ObservedPropertySimplePU('', this, "ctxKind");
        this.__ctxRowId = new ObservedPropertySimplePU('', this, "ctxRowId");
        this.__ctxIter = new ObservedPropertySimplePU(0, this, "ctxIter");
        this.__ctxTool = new ObservedPropertySimplePU('', this, "ctxTool");
        this.__usage = new ObservedPropertyObjectPU(undefined, this, "usage");
        this.__cwd = new ObservedPropertySimplePU('', this, "cwd");
        this.__todos = new ObservedPropertyObjectPU([], this, "todos");
        this.__goal = new ObservedPropertyObjectPU(undefined, this, "goal");
        this.__geoText = new ObservedPropertySimplePU('', this, "geoText");
        this.__geoRunning = new ObservedPropertySimplePU(false, this, "geoRunning");
        this.__auditing = new ObservedPropertySimplePU(false, this, "auditing");
        this.__auditLog = new ObservedPropertySimplePU('', this, "auditLog");
        this.__renamingId = new ObservedPropertySimplePU('', this, "renamingId");
        this.__renameText = new ObservedPropertySimplePU('', this, "renameText");
        this.__askUser = new ObservedPropertyObjectPU(null, this, "askUser");
        this.__askSelections = new ObservedPropertyObjectPU([], this, "askSelections");
        this.__askBusy = new ObservedPropertySimplePU(false, this, "askBusy");
        this.__plugins = new ObservedPropertyObjectPU([], this, "plugins");
        this.__panelUrl = new ObservedPropertySimplePU('', this, "panelUrl");
        this.__imagePixel = new ObservedPropertyObjectPU(null, this, "imagePixel");
        this.__imageBusy = new ObservedPropertySimplePU(false, this, "imageBusy");
        this.cookie = '';
        this.authExpiredHandled = false;
        this.__themeName = new ObservedPropertySimplePU('dark', this, "themeName");
        this.__connState = new ObservedPropertySimplePU('idle', this, "connState");
        this.__composerFocused = new ObservedPropertySimplePU(false, this, "composerFocused");
        this.__useWebUI = new ObservedPropertySimplePU(false, this, "useWebUI");
        this.__webUiUrl = new ObservedPropertySimplePU('', this, "webUiUrl");
        this.__webCookieReady = new ObservedPropertySimplePU(false, this, "webCookieReady");
        this.surfaceApplied = false;
        this.__safeTop = this.createStorageProp('safeTopVp', 0, "safeTop");
        this.__safeBottom = this.createStorageProp('safeBottomVp', 0, "safeBottom");
        this.__liveOn = new ObservedPropertySimplePU(false, this, "liveOn");
        this.__liveText = new ObservedPropertySimplePU('', this, "liveText");
        this.__liveReasoning = new ObservedPropertySimplePU('', this, "liveReasoning");
        this.__liveTools = new ObservedPropertyObjectPU([], this, "liveTools");
        this.__liveIterNo = new ObservedPropertySimplePU(0, this, "liveIterNo");
        this.__liveRowTurn = new ObservedPropertySimplePU(0, this, "liveRowTurn");
        this.lastLiveLen = 0;
        this.__historyLoading = new ObservedPropertySimplePU(false, this, "historyLoading");
        this.__sweepX = new ObservedPropertySimplePU(-80, this, "sweepX");
        this.__listAlpha = new ObservedPropertySimplePU(1, this, "listAlpha");
        this.__failedSend = new ObservedPropertySimplePU('', this, "failedSend");
        this.draftTimer = -1;
        this.__pulseOn = new ObservedPropertySimplePU(true, this, "pulseOn");
        this.pulseTimer = -1;
        this.__imgScale = new ObservedPropertySimplePU(1, this, "imgScale");
        this.__imgTransX = new ObservedPropertySimplePU(0, this, "imgTransX");
        this.__imgTransY = new ObservedPropertySimplePU(0, this, "imgTransY");
        this.__imgW = new ObservedPropertySimplePU(0, this, "imgW");
        this.__imgH = new ObservedPropertySimplePU(0, this, "imgH");
        this.__viewW = new ObservedPropertySimplePU(0, this, "viewW");
        this.__viewH = new ObservedPropertySimplePU(0, this, "viewH");
        this.imgBaseScale = 1;
        this.imgBaseX = 0;
        this.imgBaseY = 0;
        this.__openToolKey = new ObservedPropertySimplePU('', this, "openToolKey");
        this.__openReasonKey = new ObservedPropertySimplePU('', this, "openReasonKey");
        this.__expandedTurn = new ObservedPropertySimplePU('', this, "expandedTurn");
        this.__showReasoning = new ObservedPropertySimplePU(true, this, "showReasoning");
        this.store = null;
        this.pendingSync = null;
        this.pools = new Map<string, ChatStore>();
        this.poolOrder = [];
        this.syncScheduled = false;
        this.config = new ConfigStore();
        this.listScroller = new Scroller();
        this.rowDs = new ChatRowDataSource();
        this.__appPaused = new ObservedPropertySimplePU(false, this, "appPaused");
        this.rowsFp = '';
        this.sessionsFp = '';
        this.queueFp = '';
        this.todosFp = '';
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Index_Params) {
        if (params.booted !== undefined) {
            this.booted = params.booted;
        }
        if (params.loggedIn !== undefined) {
            this.loggedIn = params.loggedIn;
        }
        if (params.errMsg !== undefined) {
            this.errMsg = params.errMsg;
        }
        if (params.serverUrl !== undefined) {
            this.serverUrl = params.serverUrl;
        }
        if (params.username !== undefined) {
            this.username = params.username;
        }
        if (params.password !== undefined) {
            this.password = params.password;
        }
        if (params.testing !== undefined) {
            this.testing = params.testing;
        }
        if (params.testMsg !== undefined) {
            this.testMsg = params.testMsg;
        }
        if (params.recentServers !== undefined) {
            this.recentServers = params.recentServers;
        }
        if (params.sessions !== undefined) {
            this.sessions = params.sessions;
        }
        if (params.rows !== undefined) {
            this.rows = params.rows;
        }
        if (params.busy !== undefined) {
            this.busy = params.busy;
        }
        if (params.loadErr !== undefined) {
            this.loadErr = params.loadErr;
        }
        if (params.currentChat !== undefined) {
            this.currentChat = params.currentChat;
        }
        if (params.draft !== undefined) {
            this.draft = params.draft;
        }
        if (params.hasMore !== undefined) {
            this.hasMore = params.hasMore;
        }
        if (params.loadingMore !== undefined) {
            this.loadingMore = params.loadingMore;
        }
        if (params.queue !== undefined) {
            this.queue = params.queue;
        }
        if (params.showDrawer !== undefined) {
            this.showDrawer = params.showDrawer;
        }
        if (params.showSettings !== undefined) {
            this.showSettings = params.showSettings;
        }
        if (params.showQueue !== undefined) {
            this.showQueue = params.showQueue;
        }
        if (params.showPlugins !== undefined) {
            this.showPlugins = params.showPlugins;
        }
        if (params.showSelfCheck !== undefined) {
            this.showSelfCheck = params.showSelfCheck;
        }
        if (params.atBottom !== undefined) {
            this.atBottom = params.atBottom;
        }
        if (params.rowLimit !== undefined) {
            this.rowLimit = params.rowLimit;
        }
        if (params.attachments !== undefined) {
            this.attachments = params.attachments;
        }
        if (params.showStatus !== undefined) {
            this.showStatus = params.showStatus;
        }
        if (params.showModel !== undefined) {
            this.showModel = params.showModel;
        }
        if (params.llmCfg !== undefined) {
            this.llmCfg = params.llmCfg;
        }
        if (params.ctxInput !== undefined) {
            this.ctxInput = params.ctxInput;
        }
        if (params.modelBusy !== undefined) {
            this.modelBusy = params.modelBusy;
        }
        if (params.sendMode !== undefined) {
            this.sendMode = params.sendMode;
        }
        if (params.cmdToken !== undefined) {
            this.cmdToken = params.cmdToken;
        }
        if (params.cmdItems !== undefined) {
            this.cmdItems = params.cmdItems;
        }
        if (params.fsEntries !== undefined) {
            this.fsEntries = params.fsEntries;
        }
        if (params.fsDir !== undefined) {
            this.fsDir = params.fsDir;
        }
        if (params.showPrefs !== undefined) {
            this.showPrefs = params.showPrefs;
        }
        if (params.settings !== undefined) {
            this.settings = params.settings;
        }
        if (params.reasoningDefaultApplied !== undefined) {
            this.reasoningDefaultApplied = params.reasoningDefaultApplied;
        }
        if (params.showPanels !== undefined) {
            this.showPanels = params.showPanels;
        }
        if (params.panelTab !== undefined) {
            this.panelTab = params.panelTab;
        }
        if (params.cronTasks !== undefined) {
            this.cronTasks = params.cronTasks;
        }
        if (params.bgTasks !== undefined) {
            this.bgTasks = params.bgTasks;
        }
        if (params.runners !== undefined) {
            this.runners = params.runners;
        }
        if (params.subagents !== undefined) {
            this.subagents = params.subagents;
        }
        if (params.panelBusy !== undefined) {
            this.panelBusy = params.panelBusy;
        }
        if (params.sessQuery !== undefined) {
            this.sessQuery = params.sessQuery;
        }
        if (params.sessMenuId !== undefined) {
            this.sessMenuId = params.sessMenuId;
        }
        if (params.sessConfirmDelete !== undefined) {
            this.sessConfirmDelete = params.sessConfirmDelete;
        }
        if (params.searchHits !== undefined) {
            this.searchHits = params.searchHits;
        }
        if (params.searchBusy !== undefined) {
            this.searchBusy = params.searchBusy;
        }
        if (params.showSearchHits !== undefined) {
            this.showSearchHits = params.showSearchHits;
        }
        if (params.ctxOpen !== undefined) {
            this.ctxOpen = params.ctxOpen;
        }
        if (params.ctxKind !== undefined) {
            this.ctxKind = params.ctxKind;
        }
        if (params.ctxRowId !== undefined) {
            this.ctxRowId = params.ctxRowId;
        }
        if (params.ctxIter !== undefined) {
            this.ctxIter = params.ctxIter;
        }
        if (params.ctxTool !== undefined) {
            this.ctxTool = params.ctxTool;
        }
        if (params.usage !== undefined) {
            this.usage = params.usage;
        }
        if (params.cwd !== undefined) {
            this.cwd = params.cwd;
        }
        if (params.todos !== undefined) {
            this.todos = params.todos;
        }
        if (params.goal !== undefined) {
            this.goal = params.goal;
        }
        if (params.geoText !== undefined) {
            this.geoText = params.geoText;
        }
        if (params.geoRunning !== undefined) {
            this.geoRunning = params.geoRunning;
        }
        if (params.auditing !== undefined) {
            this.auditing = params.auditing;
        }
        if (params.auditLog !== undefined) {
            this.auditLog = params.auditLog;
        }
        if (params.renamingId !== undefined) {
            this.renamingId = params.renamingId;
        }
        if (params.renameText !== undefined) {
            this.renameText = params.renameText;
        }
        if (params.askUser !== undefined) {
            this.askUser = params.askUser;
        }
        if (params.askSelections !== undefined) {
            this.askSelections = params.askSelections;
        }
        if (params.askBusy !== undefined) {
            this.askBusy = params.askBusy;
        }
        if (params.plugins !== undefined) {
            this.plugins = params.plugins;
        }
        if (params.panelUrl !== undefined) {
            this.panelUrl = params.panelUrl;
        }
        if (params.imagePixel !== undefined) {
            this.imagePixel = params.imagePixel;
        }
        if (params.imageBusy !== undefined) {
            this.imageBusy = params.imageBusy;
        }
        if (params.cookie !== undefined) {
            this.cookie = params.cookie;
        }
        if (params.authExpiredHandled !== undefined) {
            this.authExpiredHandled = params.authExpiredHandled;
        }
        if (params.themeName !== undefined) {
            this.themeName = params.themeName;
        }
        if (params.connState !== undefined) {
            this.connState = params.connState;
        }
        if (params.composerFocused !== undefined) {
            this.composerFocused = params.composerFocused;
        }
        if (params.useWebUI !== undefined) {
            this.useWebUI = params.useWebUI;
        }
        if (params.webUiUrl !== undefined) {
            this.webUiUrl = params.webUiUrl;
        }
        if (params.webCookieReady !== undefined) {
            this.webCookieReady = params.webCookieReady;
        }
        if (params.surfaceApplied !== undefined) {
            this.surfaceApplied = params.surfaceApplied;
        }
        if (params.liveOn !== undefined) {
            this.liveOn = params.liveOn;
        }
        if (params.liveText !== undefined) {
            this.liveText = params.liveText;
        }
        if (params.liveReasoning !== undefined) {
            this.liveReasoning = params.liveReasoning;
        }
        if (params.liveTools !== undefined) {
            this.liveTools = params.liveTools;
        }
        if (params.liveIterNo !== undefined) {
            this.liveIterNo = params.liveIterNo;
        }
        if (params.liveRowTurn !== undefined) {
            this.liveRowTurn = params.liveRowTurn;
        }
        if (params.lastLiveLen !== undefined) {
            this.lastLiveLen = params.lastLiveLen;
        }
        if (params.historyLoading !== undefined) {
            this.historyLoading = params.historyLoading;
        }
        if (params.sweepX !== undefined) {
            this.sweepX = params.sweepX;
        }
        if (params.listAlpha !== undefined) {
            this.listAlpha = params.listAlpha;
        }
        if (params.failedSend !== undefined) {
            this.failedSend = params.failedSend;
        }
        if (params.draftTimer !== undefined) {
            this.draftTimer = params.draftTimer;
        }
        if (params.pulseOn !== undefined) {
            this.pulseOn = params.pulseOn;
        }
        if (params.pulseTimer !== undefined) {
            this.pulseTimer = params.pulseTimer;
        }
        if (params.imgScale !== undefined) {
            this.imgScale = params.imgScale;
        }
        if (params.imgTransX !== undefined) {
            this.imgTransX = params.imgTransX;
        }
        if (params.imgTransY !== undefined) {
            this.imgTransY = params.imgTransY;
        }
        if (params.imgW !== undefined) {
            this.imgW = params.imgW;
        }
        if (params.imgH !== undefined) {
            this.imgH = params.imgH;
        }
        if (params.viewW !== undefined) {
            this.viewW = params.viewW;
        }
        if (params.viewH !== undefined) {
            this.viewH = params.viewH;
        }
        if (params.imgBaseScale !== undefined) {
            this.imgBaseScale = params.imgBaseScale;
        }
        if (params.imgBaseX !== undefined) {
            this.imgBaseX = params.imgBaseX;
        }
        if (params.imgBaseY !== undefined) {
            this.imgBaseY = params.imgBaseY;
        }
        if (params.openToolKey !== undefined) {
            this.openToolKey = params.openToolKey;
        }
        if (params.openReasonKey !== undefined) {
            this.openReasonKey = params.openReasonKey;
        }
        if (params.expandedTurn !== undefined) {
            this.expandedTurn = params.expandedTurn;
        }
        if (params.showReasoning !== undefined) {
            this.showReasoning = params.showReasoning;
        }
        if (params.store !== undefined) {
            this.store = params.store;
        }
        if (params.pendingSync !== undefined) {
            this.pendingSync = params.pendingSync;
        }
        if (params.pools !== undefined) {
            this.pools = params.pools;
        }
        if (params.poolOrder !== undefined) {
            this.poolOrder = params.poolOrder;
        }
        if (params.syncScheduled !== undefined) {
            this.syncScheduled = params.syncScheduled;
        }
        if (params.config !== undefined) {
            this.config = params.config;
        }
        if (params.listScroller !== undefined) {
            this.listScroller = params.listScroller;
        }
        if (params.rowDs !== undefined) {
            this.rowDs = params.rowDs;
        }
        if (params.appPaused !== undefined) {
            this.appPaused = params.appPaused;
        }
        if (params.rowsFp !== undefined) {
            this.rowsFp = params.rowsFp;
        }
        if (params.sessionsFp !== undefined) {
            this.sessionsFp = params.sessionsFp;
        }
        if (params.queueFp !== undefined) {
            this.queueFp = params.queueFp;
        }
        if (params.todosFp !== undefined) {
            this.todosFp = params.todosFp;
        }
    }
    updateStateVars(params: Index_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__booted.purgeDependencyOnElmtId(rmElmtId);
        this.__loggedIn.purgeDependencyOnElmtId(rmElmtId);
        this.__errMsg.purgeDependencyOnElmtId(rmElmtId);
        this.__serverUrl.purgeDependencyOnElmtId(rmElmtId);
        this.__username.purgeDependencyOnElmtId(rmElmtId);
        this.__password.purgeDependencyOnElmtId(rmElmtId);
        this.__testing.purgeDependencyOnElmtId(rmElmtId);
        this.__testMsg.purgeDependencyOnElmtId(rmElmtId);
        this.__recentServers.purgeDependencyOnElmtId(rmElmtId);
        this.__sessions.purgeDependencyOnElmtId(rmElmtId);
        this.__rows.purgeDependencyOnElmtId(rmElmtId);
        this.__busy.purgeDependencyOnElmtId(rmElmtId);
        this.__loadErr.purgeDependencyOnElmtId(rmElmtId);
        this.__currentChat.purgeDependencyOnElmtId(rmElmtId);
        this.__draft.purgeDependencyOnElmtId(rmElmtId);
        this.__hasMore.purgeDependencyOnElmtId(rmElmtId);
        this.__loadingMore.purgeDependencyOnElmtId(rmElmtId);
        this.__queue.purgeDependencyOnElmtId(rmElmtId);
        this.__showDrawer.purgeDependencyOnElmtId(rmElmtId);
        this.__showSettings.purgeDependencyOnElmtId(rmElmtId);
        this.__showQueue.purgeDependencyOnElmtId(rmElmtId);
        this.__showPlugins.purgeDependencyOnElmtId(rmElmtId);
        this.__showSelfCheck.purgeDependencyOnElmtId(rmElmtId);
        this.__atBottom.purgeDependencyOnElmtId(rmElmtId);
        this.__rowLimit.purgeDependencyOnElmtId(rmElmtId);
        this.__attachments.purgeDependencyOnElmtId(rmElmtId);
        this.__showStatus.purgeDependencyOnElmtId(rmElmtId);
        this.__showModel.purgeDependencyOnElmtId(rmElmtId);
        this.__llmCfg.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxInput.purgeDependencyOnElmtId(rmElmtId);
        this.__modelBusy.purgeDependencyOnElmtId(rmElmtId);
        this.__sendMode.purgeDependencyOnElmtId(rmElmtId);
        this.__cmdToken.purgeDependencyOnElmtId(rmElmtId);
        this.__cmdItems.purgeDependencyOnElmtId(rmElmtId);
        this.__fsEntries.purgeDependencyOnElmtId(rmElmtId);
        this.__fsDir.purgeDependencyOnElmtId(rmElmtId);
        this.__showPrefs.purgeDependencyOnElmtId(rmElmtId);
        this.__settings.purgeDependencyOnElmtId(rmElmtId);
        this.__showPanels.purgeDependencyOnElmtId(rmElmtId);
        this.__panelTab.purgeDependencyOnElmtId(rmElmtId);
        this.__cronTasks.purgeDependencyOnElmtId(rmElmtId);
        this.__bgTasks.purgeDependencyOnElmtId(rmElmtId);
        this.__runners.purgeDependencyOnElmtId(rmElmtId);
        this.__subagents.purgeDependencyOnElmtId(rmElmtId);
        this.__panelBusy.purgeDependencyOnElmtId(rmElmtId);
        this.__sessQuery.purgeDependencyOnElmtId(rmElmtId);
        this.__sessMenuId.purgeDependencyOnElmtId(rmElmtId);
        this.__sessConfirmDelete.purgeDependencyOnElmtId(rmElmtId);
        this.__searchHits.purgeDependencyOnElmtId(rmElmtId);
        this.__searchBusy.purgeDependencyOnElmtId(rmElmtId);
        this.__showSearchHits.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxOpen.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxKind.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxRowId.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxIter.purgeDependencyOnElmtId(rmElmtId);
        this.__ctxTool.purgeDependencyOnElmtId(rmElmtId);
        this.__usage.purgeDependencyOnElmtId(rmElmtId);
        this.__cwd.purgeDependencyOnElmtId(rmElmtId);
        this.__todos.purgeDependencyOnElmtId(rmElmtId);
        this.__goal.purgeDependencyOnElmtId(rmElmtId);
        this.__geoText.purgeDependencyOnElmtId(rmElmtId);
        this.__geoRunning.purgeDependencyOnElmtId(rmElmtId);
        this.__auditing.purgeDependencyOnElmtId(rmElmtId);
        this.__auditLog.purgeDependencyOnElmtId(rmElmtId);
        this.__renamingId.purgeDependencyOnElmtId(rmElmtId);
        this.__renameText.purgeDependencyOnElmtId(rmElmtId);
        this.__askUser.purgeDependencyOnElmtId(rmElmtId);
        this.__askSelections.purgeDependencyOnElmtId(rmElmtId);
        this.__askBusy.purgeDependencyOnElmtId(rmElmtId);
        this.__plugins.purgeDependencyOnElmtId(rmElmtId);
        this.__panelUrl.purgeDependencyOnElmtId(rmElmtId);
        this.__imagePixel.purgeDependencyOnElmtId(rmElmtId);
        this.__imageBusy.purgeDependencyOnElmtId(rmElmtId);
        this.__themeName.purgeDependencyOnElmtId(rmElmtId);
        this.__connState.purgeDependencyOnElmtId(rmElmtId);
        this.__composerFocused.purgeDependencyOnElmtId(rmElmtId);
        this.__useWebUI.purgeDependencyOnElmtId(rmElmtId);
        this.__webUiUrl.purgeDependencyOnElmtId(rmElmtId);
        this.__webCookieReady.purgeDependencyOnElmtId(rmElmtId);
        this.__safeTop.purgeDependencyOnElmtId(rmElmtId);
        this.__safeBottom.purgeDependencyOnElmtId(rmElmtId);
        this.__liveOn.purgeDependencyOnElmtId(rmElmtId);
        this.__liveText.purgeDependencyOnElmtId(rmElmtId);
        this.__liveReasoning.purgeDependencyOnElmtId(rmElmtId);
        this.__liveTools.purgeDependencyOnElmtId(rmElmtId);
        this.__liveIterNo.purgeDependencyOnElmtId(rmElmtId);
        this.__liveRowTurn.purgeDependencyOnElmtId(rmElmtId);
        this.__historyLoading.purgeDependencyOnElmtId(rmElmtId);
        this.__sweepX.purgeDependencyOnElmtId(rmElmtId);
        this.__listAlpha.purgeDependencyOnElmtId(rmElmtId);
        this.__failedSend.purgeDependencyOnElmtId(rmElmtId);
        this.__pulseOn.purgeDependencyOnElmtId(rmElmtId);
        this.__imgScale.purgeDependencyOnElmtId(rmElmtId);
        this.__imgTransX.purgeDependencyOnElmtId(rmElmtId);
        this.__imgTransY.purgeDependencyOnElmtId(rmElmtId);
        this.__imgW.purgeDependencyOnElmtId(rmElmtId);
        this.__imgH.purgeDependencyOnElmtId(rmElmtId);
        this.__viewW.purgeDependencyOnElmtId(rmElmtId);
        this.__viewH.purgeDependencyOnElmtId(rmElmtId);
        this.__openToolKey.purgeDependencyOnElmtId(rmElmtId);
        this.__openReasonKey.purgeDependencyOnElmtId(rmElmtId);
        this.__expandedTurn.purgeDependencyOnElmtId(rmElmtId);
        this.__showReasoning.purgeDependencyOnElmtId(rmElmtId);
        this.__appPaused.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__booted.aboutToBeDeleted();
        this.__loggedIn.aboutToBeDeleted();
        this.__errMsg.aboutToBeDeleted();
        this.__serverUrl.aboutToBeDeleted();
        this.__username.aboutToBeDeleted();
        this.__password.aboutToBeDeleted();
        this.__testing.aboutToBeDeleted();
        this.__testMsg.aboutToBeDeleted();
        this.__recentServers.aboutToBeDeleted();
        this.__sessions.aboutToBeDeleted();
        this.__rows.aboutToBeDeleted();
        this.__busy.aboutToBeDeleted();
        this.__loadErr.aboutToBeDeleted();
        this.__currentChat.aboutToBeDeleted();
        this.__draft.aboutToBeDeleted();
        this.__hasMore.aboutToBeDeleted();
        this.__loadingMore.aboutToBeDeleted();
        this.__queue.aboutToBeDeleted();
        this.__showDrawer.aboutToBeDeleted();
        this.__showSettings.aboutToBeDeleted();
        this.__showQueue.aboutToBeDeleted();
        this.__showPlugins.aboutToBeDeleted();
        this.__showSelfCheck.aboutToBeDeleted();
        this.__atBottom.aboutToBeDeleted();
        this.__rowLimit.aboutToBeDeleted();
        this.__attachments.aboutToBeDeleted();
        this.__showStatus.aboutToBeDeleted();
        this.__showModel.aboutToBeDeleted();
        this.__llmCfg.aboutToBeDeleted();
        this.__ctxInput.aboutToBeDeleted();
        this.__modelBusy.aboutToBeDeleted();
        this.__sendMode.aboutToBeDeleted();
        this.__cmdToken.aboutToBeDeleted();
        this.__cmdItems.aboutToBeDeleted();
        this.__fsEntries.aboutToBeDeleted();
        this.__fsDir.aboutToBeDeleted();
        this.__showPrefs.aboutToBeDeleted();
        this.__settings.aboutToBeDeleted();
        this.__showPanels.aboutToBeDeleted();
        this.__panelTab.aboutToBeDeleted();
        this.__cronTasks.aboutToBeDeleted();
        this.__bgTasks.aboutToBeDeleted();
        this.__runners.aboutToBeDeleted();
        this.__subagents.aboutToBeDeleted();
        this.__panelBusy.aboutToBeDeleted();
        this.__sessQuery.aboutToBeDeleted();
        this.__sessMenuId.aboutToBeDeleted();
        this.__sessConfirmDelete.aboutToBeDeleted();
        this.__searchHits.aboutToBeDeleted();
        this.__searchBusy.aboutToBeDeleted();
        this.__showSearchHits.aboutToBeDeleted();
        this.__ctxOpen.aboutToBeDeleted();
        this.__ctxKind.aboutToBeDeleted();
        this.__ctxRowId.aboutToBeDeleted();
        this.__ctxIter.aboutToBeDeleted();
        this.__ctxTool.aboutToBeDeleted();
        this.__usage.aboutToBeDeleted();
        this.__cwd.aboutToBeDeleted();
        this.__todos.aboutToBeDeleted();
        this.__goal.aboutToBeDeleted();
        this.__geoText.aboutToBeDeleted();
        this.__geoRunning.aboutToBeDeleted();
        this.__auditing.aboutToBeDeleted();
        this.__auditLog.aboutToBeDeleted();
        this.__renamingId.aboutToBeDeleted();
        this.__renameText.aboutToBeDeleted();
        this.__askUser.aboutToBeDeleted();
        this.__askSelections.aboutToBeDeleted();
        this.__askBusy.aboutToBeDeleted();
        this.__plugins.aboutToBeDeleted();
        this.__panelUrl.aboutToBeDeleted();
        this.__imagePixel.aboutToBeDeleted();
        this.__imageBusy.aboutToBeDeleted();
        this.__themeName.aboutToBeDeleted();
        this.__connState.aboutToBeDeleted();
        this.__composerFocused.aboutToBeDeleted();
        this.__useWebUI.aboutToBeDeleted();
        this.__webUiUrl.aboutToBeDeleted();
        this.__webCookieReady.aboutToBeDeleted();
        this.__safeTop.aboutToBeDeleted();
        this.__safeBottom.aboutToBeDeleted();
        this.__liveOn.aboutToBeDeleted();
        this.__liveText.aboutToBeDeleted();
        this.__liveReasoning.aboutToBeDeleted();
        this.__liveTools.aboutToBeDeleted();
        this.__liveIterNo.aboutToBeDeleted();
        this.__liveRowTurn.aboutToBeDeleted();
        this.__historyLoading.aboutToBeDeleted();
        this.__sweepX.aboutToBeDeleted();
        this.__listAlpha.aboutToBeDeleted();
        this.__failedSend.aboutToBeDeleted();
        this.__pulseOn.aboutToBeDeleted();
        this.__imgScale.aboutToBeDeleted();
        this.__imgTransX.aboutToBeDeleted();
        this.__imgTransY.aboutToBeDeleted();
        this.__imgW.aboutToBeDeleted();
        this.__imgH.aboutToBeDeleted();
        this.__viewW.aboutToBeDeleted();
        this.__viewH.aboutToBeDeleted();
        this.__openToolKey.aboutToBeDeleted();
        this.__openReasonKey.aboutToBeDeleted();
        this.__expandedTurn.aboutToBeDeleted();
        this.__showReasoning.aboutToBeDeleted();
        this.__appPaused.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    // ── 引导 / 登录 ────────────────────────────────────────────────────────────
    private __booted: ObservedPropertySimplePU<boolean>;
    get booted() {
        return this.__booted.get();
    }
    set booted(newValue: boolean) {
        this.__booted.set(newValue);
    }
    private __loggedIn: ObservedPropertySimplePU<boolean>;
    get loggedIn() {
        return this.__loggedIn.get();
    }
    set loggedIn(newValue: boolean) {
        this.__loggedIn.set(newValue);
    }
    private __errMsg: ObservedPropertySimplePU<string>;
    get errMsg() {
        return this.__errMsg.get();
    }
    set errMsg(newValue: string) {
        this.__errMsg.set(newValue);
    }
    private __serverUrl: ObservedPropertySimplePU<string>;
    get serverUrl() {
        return this.__serverUrl.get();
    }
    set serverUrl(newValue: string) {
        this.__serverUrl.set(newValue);
    }
    private __username: ObservedPropertySimplePU<string>;
    get username() {
        return this.__username.get();
    }
    set username(newValue: string) {
        this.__username.set(newValue);
    }
    private __password: ObservedPropertySimplePU<string>;
    get password() {
        return this.__password.get();
    }
    set password(newValue: string) {
        this.__password.set(newValue);
    }
    private __testing: ObservedPropertySimplePU<boolean>;
    get testing() {
        return this.__testing.get();
    }
    set testing(newValue: boolean) {
        this.__testing.set(newValue);
    }
    private __testMsg: ObservedPropertySimplePU<string>;
    get testMsg() {
        return this.__testMsg.get();
    }
    set testMsg(newValue: string) {
        this.__testMsg.set(newValue);
    }
    private __recentServers: ObservedPropertyObjectPU<string[]>;
    get recentServers() {
        return this.__recentServers.get();
    }
    set recentServers(newValue: string[]) {
        this.__recentServers.set(newValue);
    }
    // ── 聊天数据 ──────────────────────────────────────────────────────────────
    private __sessions: ObservedPropertyObjectPU<SessionItem[]>;
    get sessions() {
        return this.__sessions.get();
    }
    set sessions(newValue: SessionItem[]) {
        this.__sessions.set(newValue);
    }
    private __rows: ObservedPropertyObjectPU<ChatRow[]>;
    get rows() {
        return this.__rows.get();
    }
    set rows(newValue: ChatRow[]) {
        this.__rows.set(newValue);
    }
    private __busy: ObservedPropertySimplePU<boolean>;
    get busy() {
        return this.__busy.get();
    }
    set busy(newValue: boolean) {
        this.__busy.set(newValue);
    }
    /**
     * 加载失败原因（网络/代理不通时最常见）。
     * 聊天页在"列表为空"时必须给出可读原因 + 重试，否则用户看到的就是一片空白，
     * 极易被误判为「渲染坏了 / 完全用不了」。
     */
    private __loadErr: ObservedPropertySimplePU<string>;
    get loadErr() {
        return this.__loadErr.get();
    }
    set loadErr(newValue: string) {
        this.__loadErr.set(newValue);
    }
    private __currentChat: ObservedPropertySimplePU<string>;
    get currentChat() {
        return this.__currentChat.get();
    }
    set currentChat(newValue: string) {
        this.__currentChat.set(newValue);
    }
    private __draft: ObservedPropertySimplePU<string>;
    get draft() {
        return this.__draft.get();
    }
    set draft(newValue: string) {
        this.__draft.set(newValue);
    }
    private __hasMore: ObservedPropertySimplePU<boolean>;
    get hasMore() {
        return this.__hasMore.get();
    }
    set hasMore(newValue: boolean) {
        this.__hasMore.set(newValue);
    }
    private __loadingMore: ObservedPropertySimplePU<boolean>;
    get loadingMore() {
        return this.__loadingMore.get();
    }
    set loadingMore(newValue: boolean) {
        this.__loadingMore.set(newValue);
    }
    private __queue: ObservedPropertyObjectPU<QueueItem[]>;
    get queue() {
        return this.__queue.get();
    }
    set queue(newValue: QueueItem[]) {
        this.__queue.set(newValue);
    }
    // ── 弹层 ──────────────────────────────────────────────────────────────────
    private __showDrawer: ObservedPropertySimplePU<boolean>;
    get showDrawer() {
        return this.__showDrawer.get();
    }
    set showDrawer(newValue: boolean) {
        this.__showDrawer.set(newValue);
    }
    private __showSettings: ObservedPropertySimplePU<boolean>;
    get showSettings() {
        return this.__showSettings.get();
    }
    set showSettings(newValue: boolean) {
        this.__showSettings.set(newValue);
    }
    private __showQueue: ObservedPropertySimplePU<boolean>;
    get showQueue() {
        return this.__showQueue.get();
    }
    set showQueue(newValue: boolean) {
        this.__showQueue.set(newValue);
    }
    private __showPlugins: ObservedPropertySimplePU<boolean>;
    get showPlugins() {
        return this.__showPlugins.get();
    }
    set showPlugins(newValue: boolean) {
        this.__showPlugins.set(newValue);
    }
    private __showSelfCheck: ObservedPropertySimplePU<boolean>;
    get showSelfCheck() {
        return this.__showSelfCheck.get();
    }
    set showSelfCheck(newValue: boolean) {
        this.__showSelfCheck.set(newValue);
    }
    /** 各页版面几何的**屏幕可见文本**（无需网络：截一张图即可把数值带给我） */
    /**
     * 用户当前是否停在列表底部。
     * ⚠️ 自动"跟随到底部"必须由它守卫：流式期间每个事件都会同步一次，若无条件
     * `scrollEdge(Bottom)`，用户往上滚想看工具/思考详情会被立刻拽回底部 ⇒ 表现为"根本没法用"。
     * 与 xbot Web 端既有铁律一致（所有 GotoBottom 调用由 !userScrolledUp 守卫）。
     */
    private __atBottom: ObservedPropertySimplePU<boolean>;
    get atBottom() {
        return this.__atBottom.get();
    }
    set atBottom(newValue: boolean) {
        this.__atBottom.set(newValue);
    }
    /** 首屏渲染的行窗口（避免一次性构建几十行；点上方的「显示更早」按批放开） */
    private __rowLimit: ObservedPropertySimplePU<number>;
    get rowLimit() {
        return this.__rowLimit.get();
    }
    set rowLimit(newValue: number) {
        this.__rowLimit.set(newValue);
    }
    // ── 附件（web 有、原生原先没有：发文件/图片）──────────────────────────────
    /**
     * 附件列表（支持多选 + 逐条状态）。上传是并发的：**按 uid 回填，不按下标**。
     * 只有 done 的才会进发送载荷；有 uploading 时禁止发送（否则发出没有 key 的空附件）。
     */
    private __attachments: ObservedPropertyObjectPU<AttachItem[]>;
    get attachments() {
        return this.__attachments.get();
    }
    set attachments(newValue: AttachItem[]) {
        this.__attachments.set(newValue);
    }
    // ── 会话状态栏（todos / goal / token 用量 / cwd）──
    private __showStatus: ObservedPropertySimplePU<boolean>;
    get showStatus() {
        return this.__showStatus.get();
    }
    set showStatus(newValue: boolean) {
        this.__showStatus.set(newValue);
    }
    /** LLM 选择栏（订阅/模型/上下文上限；服务端权威值） */
    private __showModel: ObservedPropertySimplePU<boolean>;
    get showModel() {
        return this.__showModel.get();
    }
    set showModel(newValue: boolean) {
        this.__showModel.set(newValue);
    }
    private __llmCfg: ObservedPropertyObjectPU<LlmConfig | undefined>;
    get llmCfg() {
        return this.__llmCfg.get();
    }
    set llmCfg(newValue: LlmConfig | undefined) {
        this.__llmCfg.set(newValue);
    }
    private __ctxInput: ObservedPropertySimplePU<string>;
    get ctxInput() {
        return this.__ctxInput.get();
    }
    set ctxInput(newValue: string) {
        this.__ctxInput.set(newValue);
    }
    /** 正在切换的模型条目（显示 loading，防连点） */
    private __modelBusy: ObservedPropertySimplePU<string>;
    get modelBusy() {
        return this.__modelBusy.get();
    }
    set modelBusy(newValue: string) {
        this.__modelBusy.set(newValue);
    }
    /**
     * 发送模式：`queue`（排队）| `interrupt`（⚡ 插话）。
     * busy=false 时**必须自动复位**（Web gotcha：否则用户以为在发普通消息，实际插进了别人的回合）。
     */
    private __sendMode: ObservedPropertySimplePU<string>;
    get sendMode() {
        return this.__sendMode.get();
    }
    set sendMode(newValue: string) {
        this.__sendMode.set(newValue);
    }
    // ── P11 输入体验（多行 / 补全 / 震动）──
    /** 当前正在输入的 `/` 或 `@` token（空 = 不显示补全） */
    private __cmdToken: ObservedPropertySimplePU<string>;
    get cmdToken() {
        return this.__cmdToken.get();
    }
    set cmdToken(newValue: string) {
        this.__cmdToken.set(newValue);
    }
    /** 命令候选 */
    private __cmdItems: ObservedPropertyObjectPU<CommandItem[]>;
    get cmdItems() {
        return this.__cmdItems.get();
    }
    set cmdItems(newValue: CommandItem[]) {
        this.__cmdItems.set(newValue);
    }
    /** 文件候选（`@` 触发） */
    private __fsEntries: ObservedPropertyObjectPU<FsEntry[]>;
    get fsEntries() {
        return this.__fsEntries.get();
    }
    set fsEntries(newValue: FsEntry[]) {
        this.__fsEntries.set(newValue);
    }
    /** 当前列目录（继续下钻用） */
    private __fsDir: ObservedPropertySimplePU<string>;
    get fsDir() {
        return this.__fsDir.get();
    }
    set fsDir(newValue: string) {
        this.__fsDir.set(newValue);
    }
    // ── P9 设置（服务端权威：/api/settings；与 web 共用同一份偏好）──
    // ⚠️ 名字必须与**已有的** SettingsSheet（插件/旧设置弹层）区分开，否则 ArkTS 报重复标识符。
    private __showPrefs: ObservedPropertySimplePU<boolean>;
    get showPrefs() {
        return this.__showPrefs.get();
    }
    set showPrefs(newValue: boolean) {
        this.__showPrefs.set(newValue);
    }
    private __settings: ObservedPropertyObjectPU<Record<string, string>>;
    get settings() {
        return this.__settings.get();
    }
    set settings(newValue: Record<string, string>) {
        this.__settings.set(newValue);
    }
    /** 是否已把"思考默认展开"应用过一次（避免每次同步都覆盖用户手动切换） */
    private reasoningDefaultApplied: boolean;
    // ── P8 面板（定时任务 / 后台任务 / 子代理 / Runner）──
    private __showPanels: ObservedPropertySimplePU<boolean>;
    get showPanels() {
        return this.__showPanels.get();
    }
    set showPanels(newValue: boolean) {
        this.__showPanels.set(newValue);
    }
    /** cron | tasks | subs | runners */
    private __panelTab: ObservedPropertySimplePU<string>;
    get panelTab() {
        return this.__panelTab.get();
    }
    set panelTab(newValue: string) {
        this.__panelTab.set(newValue);
    }
    private __cronTasks: ObservedPropertyObjectPU<CronJob[]>;
    get cronTasks() {
        return this.__cronTasks.get();
    }
    set cronTasks(newValue: CronJob[]) {
        this.__cronTasks.set(newValue);
    }
    private __bgTasks: ObservedPropertyObjectPU<BgTask[]>;
    get bgTasks() {
        return this.__bgTasks.get();
    }
    set bgTasks(newValue: BgTask[]) {
        this.__bgTasks.set(newValue);
    }
    private __runners: ObservedPropertyObjectPU<RunnerRow[]>;
    get runners() {
        return this.__runners.get();
    }
    set runners(newValue: RunnerRow[]) {
        this.__runners.set(newValue);
    }
    private __subagents: ObservedPropertyObjectPU<SubAgentRow[]>;
    get subagents() {
        return this.__subagents.get();
    }
    set subagents(newValue: SubAgentRow[]) {
        this.__subagents.set(newValue);
    }
    private __panelBusy: ObservedPropertySimplePU<boolean>;
    get panelBusy() {
        return this.__panelBusy.get();
    }
    set panelBusy(newValue: boolean) {
        this.__panelBusy.set(newValue);
    }
    // ── P7 会话管理（搜索 / 排序 / 分支）──
    /** 抽屉里的本地筛选词（只过滤显示，不打断会话） */
    private __sessQuery: ObservedPropertySimplePU<string>;
    get sessQuery() {
        return this.__sessQuery.get();
    }
    set sessQuery(newValue: string) {
        this.__sessQuery.set(newValue);
    }
    /** 打开「⋯」操作菜单的会话 id（空=关闭） */
    private __sessMenuId: ObservedPropertySimplePU<string>;
    get sessMenuId() {
        return this.__sessMenuId.get();
    }
    set sessMenuId(newValue: string) {
        this.__sessMenuId.set(newValue);
    }
    /** 删除二次确认的目标 id */
    private __sessConfirmDelete: ObservedPropertySimplePU<string>;
    get sessConfirmDelete() {
        return this.__sessConfirmDelete.get();
    }
    set sessConfirmDelete(newValue: string) {
        this.__sessConfirmDelete.set(newValue);
    }
    /** 会话内消息搜索结果 */
    private __searchHits: ObservedPropertyObjectPU<SearchHit[]>;
    get searchHits() {
        return this.__searchHits.get();
    }
    set searchHits(newValue: SearchHit[]) {
        this.__searchHits.set(newValue);
    }
    private __searchBusy: ObservedPropertySimplePU<boolean>;
    get searchBusy() {
        return this.__searchBusy.get();
    }
    set searchBusy(newValue: boolean) {
        this.__searchBusy.set(newValue);
    }
    private __showSearchHits: ObservedPropertySimplePU<boolean>;
    get showSearchHits() {
        return this.__showSearchHits.get();
    }
    set showSearchHits(newValue: boolean) {
        this.__showSearchHits.set(newValue);
    }
    // ── 长按菜单（P5 消息操作：消息 / 迭代 / 工具 / 链接）──
    private __ctxOpen: ObservedPropertySimplePU<boolean>;
    get ctxOpen() {
        return this.__ctxOpen.get();
    }
    set ctxOpen(newValue: boolean) {
        this.__ctxOpen.set(newValue);
    }
    /** user | row | iter | tool */
    private __ctxKind: ObservedPropertySimplePU<string>;
    get ctxKind() {
        return this.__ctxKind.get();
    }
    set ctxKind(newValue: string) {
        this.__ctxKind.set(newValue);
    }
    private __ctxRowId: ObservedPropertySimplePU<string>;
    get ctxRowId() {
        return this.__ctxRowId.get();
    }
    set ctxRowId(newValue: string) {
        this.__ctxRowId.set(newValue);
    }
    private __ctxIter: ObservedPropertySimplePU<number>;
    get ctxIter() {
        return this.__ctxIter.get();
    }
    set ctxIter(newValue: number) {
        this.__ctxIter.set(newValue);
    }
    private __ctxTool: ObservedPropertySimplePU<string>;
    get ctxTool() {
        return this.__ctxTool.get();
    }
    set ctxTool(newValue: string) {
        this.__ctxTool.set(newValue);
    }
    private __usage: ObservedPropertyObjectPU<TokenUsage | undefined>;
    get usage() {
        return this.__usage.get();
    }
    set usage(newValue: TokenUsage | undefined) {
        this.__usage.set(newValue);
    }
    private __cwd: ObservedPropertySimplePU<string>;
    get cwd() {
        return this.__cwd.get();
    }
    set cwd(newValue: string) {
        this.__cwd.set(newValue);
    }
    private __todos: ObservedPropertyObjectPU<TodoItem[]>;
    get todos() {
        return this.__todos.get();
    }
    set todos(newValue: TodoItem[]) {
        this.__todos.set(newValue);
    }
    private __goal: ObservedPropertyObjectPU<GoalInfo | undefined>;
    get goal() {
        return this.__goal.get();
    }
    set goal(newValue: GoalInfo | undefined) {
        this.__goal.set(newValue);
    }
    private __geoText: ObservedPropertySimplePU<string>;
    get geoText() {
        return this.__geoText.get();
    }
    set geoText(newValue: string) {
        this.__geoText.set(newValue);
    }
    private __geoRunning: ObservedPropertySimplePU<boolean>;
    get geoRunning() {
        return this.__geoRunning.get();
    }
    set geoRunning(newValue: boolean) {
        this.__geoRunning.set(newValue);
    }
    private __auditing: ObservedPropertySimplePU<boolean>;
    get auditing() {
        return this.__auditing.get();
    }
    set auditing(newValue: boolean) {
        this.__auditing.set(newValue);
    }
    private __auditLog: ObservedPropertySimplePU<string>;
    get auditLog() {
        return this.__auditLog.get();
    }
    set auditLog(newValue: string) {
        this.__auditLog.set(newValue);
    }
    private __renamingId: ObservedPropertySimplePU<string>;
    get renamingId() {
        return this.__renamingId.get();
    }
    set renamingId(newValue: string) {
        this.__renamingId.set(newValue);
    }
    private __renameText: ObservedPropertySimplePU<string>;
    get renameText() {
        return this.__renameText.get();
    }
    set renameText(newValue: string) {
        this.__renameText.set(newValue);
    }
    // ── AskUser ───────────────────────────────────────────────────────────────
    private __askUser: ObservedPropertyObjectPU<AskUserPrompt | null>;
    get askUser() {
        return this.__askUser.get();
    }
    set askUser(newValue: AskUserPrompt | null) {
        this.__askUser.set(newValue);
    }
    private __askSelections: ObservedPropertyObjectPU<AskSelection[]>;
    get askSelections() {
        return this.__askSelections.get();
    }
    set askSelections(newValue: AskSelection[]) {
        this.__askSelections.set(newValue);
    }
    private __askBusy: ObservedPropertySimplePU<boolean>;
    get askBusy() {
        return this.__askBusy.get();
    }
    set askBusy(newValue: boolean) {
        this.__askBusy.set(newValue);
    }
    // ── 插件 / ArkWeb 面板 ────────────────────────────────────────────────────
    private __plugins: ObservedPropertyObjectPU<PluginPanelInfo[]>;
    get plugins() {
        return this.__plugins.get();
    }
    set plugins(newValue: PluginPanelInfo[]) {
        this.__plugins.set(newValue);
    }
    private __panelUrl: ObservedPropertySimplePU<string>;
    get panelUrl() {
        return this.__panelUrl.get();
    }
    set panelUrl(newValue: string) {
        this.__panelUrl.set(newValue);
    }
    // ── 图片查看 ──────────────────────────────────────────────────────────────
    private __imagePixel: ObservedPropertyObjectPU<image.PixelMap | null>;
    get imagePixel() {
        return this.__imagePixel.get();
    }
    set imagePixel(newValue: image.PixelMap | null) {
        this.__imagePixel.set(newValue);
    }
    private __imageBusy: ObservedPropertySimplePU<boolean>;
    get imageBusy() {
        return this.__imageBusy.get();
    }
    set imageBusy(newValue: boolean) {
        this.__imageBusy.set(newValue);
    }
    // ── P14 弱网与健壮性 ──
    /**
     * 会话 cookie（**应用级唯一来源**）。
     *
     * ⚠️ 教训（真机 401 事故）：cookie 属于「应用会话」，不属于某个 store 实例。
     * 任何新建的 store 都必须带上它 —— 否则该 store 的每个请求都会 401
     * （多会话池正是这样踩的：头部显示着会话名，历史加载却 401，还被误报成"网络不通"）。
     */
    private cookie: string;
    /** 401 只处理一次（多个请求可能同时失败，避免重复弹回登录） */
    private authExpiredHandled: boolean;
    /** 应用主题（深/浅；与 Web 共用服务端偏好键 xbot-app-theme） */
    private __themeName: ObservedPropertySimplePU<string>;
    get themeName() {
        return this.__themeName.get();
    }
    set themeName(newValue: string) {
        this.__themeName.set(newValue);
    }
    /** SSE 连接状态（来自 store：idle|connecting|open|reconnecting） */
    private __connState: ObservedPropertySimplePU<string>;
    get connState() {
        return this.__connState.get();
    }
    set connState(newValue: string) {
        this.__connState.set(newValue);
    }
    /** 输入框聚焦（合成器卡片描边亮起） */
    private __composerFocused: ObservedPropertySimplePU<boolean>;
    get composerFocused() {
        return this.__composerFocused.get();
    }
    set composerFocused(newValue: boolean) {
        this.__composerFocused.set(newValue);
    }
    /**
     * 聊天界面承载方式：`web`（默认，ArkWeb 内嵌**完整 web UI** ⇒ 与 web 一比一）或 `native`。
     *
     * 为什么默认 web：用户明确要求「一比一和 web 对齐」。把真实 web UI 嵌进来就是**由构造保证**的
     * 一比一（动画、打字机、样式、状态机全部同一份代码），也避免我重写渲染层时不断偏离。
     * 原生实现完整保留（切到 native 即可用），继续按 web 逐行对齐地演进。
     */
    private __useWebUI: ObservedPropertySimplePU<boolean>;
    get useWebUI() {
        return this.__useWebUI.get();
    }
    set useWebUI(newValue: boolean) {
        this.__useWebUI.set(newValue);
    }
    /** 内嵌 web UI 的地址（登录成功后写入；空 = 不渲染） */
    private __webUiUrl: ObservedPropertySimplePU<string>;
    get webUiUrl() {
        return this.__webUiUrl.get();
    }
    set webUiUrl(newValue: string) {
        this.__webUiUrl.set(newValue);
    }
    private __webCookieReady: ObservedPropertySimplePU<boolean>;
    get webCookieReady() {
        return this.__webCookieReady.get();
    }
    set webCookieReady(newValue: boolean) {
        this.__webCookieReady.set(newValue);
    }
    /** 承载方式偏好是否已套用（只在首次拿到设置时套用，之后尊重用户本次切换） */
    private surfaceApplied: boolean;
    /** 安全区（状态栏/导航栏高度，由 EntryAbility 写入）—— 消除"内容顶到状态栏" */
    private __safeTop: ObservedPropertyAbstractPU<number>;
    get safeTop() {
        return this.__safeTop.get();
    }
    set safeTop(newValue: number) {
        this.__safeTop.set(newValue);
    }
    private __safeBottom: ObservedPropertyAbstractPU<number>;
    get safeBottom() {
        return this.__safeBottom.get();
    }
    set safeBottom(newValue: number) {
        this.__safeBottom.set(newValue);
    }
    // ── live 进行中快照（与 web 的 progressSnapshot→LiveIteration 同构）──
    // 渲染在 LazyForEach **之外**、由 @State 直接驱动：虚拟列表条目在真机上不可靠地
    // 重建是"流式期间什么都看不到"（无打字机、无工具、结束时内容一次性冒出）的根因。
    private __liveOn: ObservedPropertySimplePU<boolean>;
    get liveOn() {
        return this.__liveOn.get();
    }
    set liveOn(newValue: boolean) {
        this.__liveOn.set(newValue);
    }
    private __liveText: ObservedPropertySimplePU<string>;
    get liveText() {
        return this.__liveText.get();
    }
    set liveText(newValue: string) {
        this.__liveText.set(newValue);
    }
    private __liveReasoning: ObservedPropertySimplePU<string>;
    get liveReasoning() {
        return this.__liveReasoning.get();
    }
    set liveReasoning(newValue: string) {
        this.__liveReasoning.set(newValue);
    }
    private __liveTools: ObservedPropertyObjectPU<ToolProgress[]>;
    get liveTools() {
        return this.__liveTools.get();
    }
    set liveTools(newValue: ToolProgress[]) {
        this.__liveTools.set(newValue);
    }
    private __liveIterNo: ObservedPropertySimplePU<number>;
    get liveIterNo() {
        return this.__liveIterNo.get();
    }
    set liveIterNo(newValue: number) {
        this.__liveIterNo.set(newValue);
    }
    private __liveRowTurn: ObservedPropertySimplePU<number>;
    get liveRowTurn() {
        return this.__liveRowTurn.get();
    }
    set liveRowTurn(newValue: number) {
        this.__liveRowTurn.set(newValue);
    }
    /** 渐入透明度：新流式文本到达时 0.45 → 1 淡入（用户要求用"渐入"替代逐字裁剪） */
    /** 上一帧 live 文本长度（判断"有新文本"以触发渐入） */
    private lastLiveLen: number;
    /** 历史加载中（骨架屏判据：只有"还没内容且正在拉"才展示） */
    private __historyLoading: ObservedPropertySimplePU<boolean>;
    get historyLoading() {
        return this.__historyLoading.get();
    }
    set historyLoading(newValue: boolean) {
        this.__historyLoading.set(newValue);
    }
    /** 运行中工具的流光位置（纯 transform，不触发布局） */
    private __sweepX: ObservedPropertySimplePU<number>;
    get sweepX() {
        return this.__sweepX.get();
    }
    set sweepX(newValue: number) {
        this.__sweepX.set(newValue);
    }
    /** 切会话时列表淡入（0.001 → 1 由 animateTo 驱动） */
    private __listAlpha: ObservedPropertySimplePU<number>;
    get listAlpha() {
        return this.__listAlpha.get();
    }
    set listAlpha(newValue: number) {
        this.__listAlpha.set(newValue);
    }
    /** 上次发送失败的正文（提供一键重试） */
    private __failedSend: ObservedPropertySimplePU<string>;
    get failedSend() {
        return this.__failedSend.get();
    }
    set failedSend(newValue: string) {
        this.__failedSend.set(newValue);
    }
    private draftTimer: number;
    /**
     * 运行脉冲（P13）：只在有回合在跑时用 600ms 定时器翻转一次 opacity。
     * 为什么用 opacity 而不是 layout 属性：触屏设备上 layout 动画（height/width）会掉帧，
     * 这是项目里已定稿的规矩（Web 端同款）。
     */
    private __pulseOn: ObservedPropertySimplePU<boolean>;
    get pulseOn() {
        return this.__pulseOn.get();
    }
    set pulseOn(newValue: boolean) {
        this.__pulseOn.set(newValue);
    }
    private pulseTimer: number;
    // ── P12 查看器：缩放/平移（夹取逻辑在 core/imgops.ets，已单测）──
    private __imgScale: ObservedPropertySimplePU<number>;
    get imgScale() {
        return this.__imgScale.get();
    }
    set imgScale(newValue: number) {
        this.__imgScale.set(newValue);
    }
    private __imgTransX: ObservedPropertySimplePU<number>;
    get imgTransX() {
        return this.__imgTransX.get();
    }
    set imgTransX(newValue: number) {
        this.__imgTransX.set(newValue);
    }
    private __imgTransY: ObservedPropertySimplePU<number>;
    get imgTransY() {
        return this.__imgTransY.get();
    }
    set imgTransY(newValue: number) {
        this.__imgTransY.set(newValue);
    }
    private __imgW: ObservedPropertySimplePU<number>;
    get imgW() {
        return this.__imgW.get();
    }
    set imgW(newValue: number) {
        this.__imgW.set(newValue);
    }
    private __imgH: ObservedPropertySimplePU<number>;
    get imgH() {
        return this.__imgH.get();
    }
    set imgH(newValue: number) {
        this.__imgH.set(newValue);
    }
    private __viewW: ObservedPropertySimplePU<number>;
    get viewW() {
        return this.__viewW.get();
    }
    set viewW(newValue: number) {
        this.__viewW.set(newValue);
    }
    private __viewH: ObservedPropertySimplePU<number>;
    get viewH() {
        return this.__viewH.get();
    }
    set viewH(newValue: number) {
        this.__viewH.set(newValue);
    }
    private imgBaseScale: number;
    private imgBaseX: number;
    private imgBaseY: number;
    // ── 工具/迭代展开 ─────────────────────────────────────────────────────────
    private __openToolKey: ObservedPropertySimplePU<string>;
    get openToolKey() {
        return this.__openToolKey.get();
    }
    set openToolKey(newValue: string) {
        this.__openToolKey.set(newValue);
    }
    private __openReasonKey: ObservedPropertySimplePU<string>;
    get openReasonKey() {
        return this.__openReasonKey.get();
    }
    set openReasonKey(newValue: string) {
        this.__openReasonKey.set(newValue);
    }
    /** 展开了全部迭代的 turn（默认只渲染最近 MAX_ITER_VISIBLE 个，防长 turn 爆炸） */
    private __expandedTurn: ObservedPropertySimplePU<string>;
    get expandedTurn() {
        return this.__expandedTurn.get();
    }
    set expandedTurn(newValue: string) {
        this.__expandedTurn.set(newValue);
    }
    // ── 显示设置 ──────────────────────────────────────────────────────────────
    private __showReasoning: ObservedPropertySimplePU<boolean>;
    get showReasoning() {
        return this.__showReasoning.get();
    }
    set showReasoning(newValue: boolean) {
        this.__showReasoning.set(newValue);
    }
    private store: ChatStore | null;
    /** 合并同步用：待同步的 store 与"已排帧"标志（见 scheduleSync） */
    private pendingSync: ChatStore | null;
    /**
     * 多会话池（P10）：最多同时保持 3 个会话的 SSE 与状态。
     *
     * 为什么要池：切会话若"关连接 + 重建 + 重拉历史"，用户会看到 loading 与重连空窗；
     * 池化后**切回已打开的会话是瞬时的**（状态一直在累积），后台会话的进度也不丢
     * （后端仍在推，它自己的 store 一直在收）。超出上限按 LRU 驱逐并 dispose（关 SSE）。
     */
    private pools: Map<string, ChatStore>;
    private poolOrder: string[];
    private syncScheduled: boolean;
    private config: ConfigStore;
    private listScroller: Scroller;
    /**
     * `LazyForEach` 数据源：只有可视区附近的行会被真正构建（真虚拟化）。
     * 之前 `List` + `ForEach` 一次性构建全部行 ⇒ 几十行 × 每行多个 Markdown 迭代块 = 数千节点。
     */
    private rowDs: ChatRowDataSource;
    // ── 生命周期 ──────────────────────────────────────────────────────────────
    aboutToAppear(): void {
        this.bootstrap();
    }
    aboutToDisappear(): void {
        const s: ChatStore | null = this.store;
        if (s !== null) {
            s.sse.close();
        }
    }
    private async bootstrap(): Promise<void> {
        // 兜底：即使本地存储不可用，也必须能进登录页（否则永远停在 Loading，无从排查）
        let saved: AppConfig = new AppConfig();
        try {
            const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
            saved = await this.config.init(ctx);
        }
        catch (e) {
            this.errMsg = `[本地存储不可用] ${errText(e)}（可继续手填地址登录）`;
            this.booted = true;
            return;
        }
        if (saved.serverUrl.length > 0) {
            this.serverUrl = saved.serverUrl;
        }
        this.username = saved.username;
        this.recentServers = this.config.recentServers();
        if (saved.serverUrl.length > 0 && saved.sessionCookie.length > 0) {
            this.cookie = saved.sessionCookie;
            const store: ChatStore = this.makeStore(saved.serverUrl, saved.sessionCookie);
            try {
                await store.loadSessions();
                this.attach(store);
                this.cookie = store.http.exportSessionCookie();
                this.prepareWebUI(store);
                store.loadSettings().catch(() => {
                    // 设置非关键路径
                });
                this.authExpiredHandled = false;
                this.loggedIn = true;
                const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
                if (first !== undefined && first.chat_id !== undefined) {
                    await store.openSession(first.chat_id);
                    // 启动 store 也入池并按它真正打开的会话建索引（否则切回该会话会再建一个 ⇒ 双订阅）
                    this.rekeyPool(store, first.chat_id);
                }
            }
            catch (e) {
                this.loggedIn = false;
            }
        }
        this.booted = true;
    }
    /**
     * 建 store —— **必须显式给 cookie**（除了"尚未登录"的探测/登录/注册场景）。
     *
     * 为什么把 cookie 做成必填参数：它是应用级凭据，而 store 是可随时新建的（多会话池、
     * 新会话、分支…）。漏传一次，那个 store 的**所有**请求都会 401，且症状会伪装成
     * "会话加载失败/网络不通"，极难定位（真机踩过一次）。显式参数让编译器帮我们兜住。
     */
    private makeStore(url: string, cookie: string): ChatStore {
        const store: ChatStore = new ChatStore(url);
        if (cookie.length > 0) {
            store.http.importSessionCookie(cookie);
        }
        store.onUpdate = () => {
            this.scheduleSync(store);
        };
        store.onAuthExpired = () => {
            this.handleAuthExpired();
        };
        return store;
    }
    /**
     * 会话凭据失效（任何请求/SSE 返回 401）⇒ 退回登录页。
     *
     * ⚠️ 绝不能把它当成网络故障（真机事故：web 会话有效，客户端却提示"网络不通"）。
     * 这里做三件事：清池（关掉所有已失效连接）、清本地凭据、回到登录页并写明原因。
     */
    private handleAuthExpired(): void {
        if (this.authExpiredHandled) {
            return;
        }
        this.authExpiredHandled = true;
        const poolKeys: string[] = Array.from(this.pools.keys());
        for (let i = 0; i < poolKeys.length; i++) {
            const ps: ChatStore | undefined = this.pools.get(poolKeys[i]);
            if (ps !== undefined) {
                ps.dispose();
            }
        }
        this.pools.clear();
        this.poolOrder = [];
        const cur: ChatStore | null = this.store;
        if (cur !== null) {
            cur.dispose();
        }
        this.store = null;
        this.cookie = '';
        this.config.save(this.serverUrl, this.username, '').catch(() => {
            // 清凭据失败不影响退回登录
        });
        this.rows = [];
        this.syncRowDs();
        this.busy = false;
        this.loadErr = '';
        this.loggedIn = false;
        this.errMsg = '登录已过期，请重新登录';
    }
    /**
     * 把 store→UI 的同步**合并到每帧至多一次**。
     *
     * 为什么：流式期间每个 SSE 事件都会 onUpdate（每秒可达数十次），逐次同步会把 UI 线程打满
     * ⇒ 真机表现"渲染很卡、交互也很差"。与 xbot Web 端已定稿的结论同款：所有"每帧一次"的更新
     * 必须走同一个调度器。（切会话/首帧仍走同步路径 syncFrom，保证不迟一帧。）
     */
    /**
     * 草稿落盘（600ms 防抖）。
     * 弱网/杀进程/来电切走都不该丢掉用户正在写的内容 —— 落盘失败也不打断输入。
     */
    private scheduleDraftSave(text: string): void {
        if (this.draftTimer >= 0) {
            clearTimeout(this.draftTimer);
        }
        this.draftTimer = setTimeout(() => {
            this.draftTimer = -1;
            if (this.currentChat.length > 0) {
                this.config.saveDraft(this.currentChat, text).catch(() => {
                    // 落盘失败：静默（下次输入还会再存一次）
                });
            }
        }, 600);
    }
    /** 有回合在跑 ⇒ 开启 600ms 脉冲；空闲 ⇒ 关掉（绝不留后台定时器）。 */
    /** 应用是否在后台（官方性能规范 §3：后台挂起非必要定时器与动画）。 */
    private __appPaused: ObservedPropertySimplePU<boolean>;
    get appPaused() {
        return this.__appPaused.get();
    }
    set appPaused(newValue: boolean) {
        this.__appPaused.set(newValue);
    }
    onPageHide(): void {
        // 进后台：停掉脉冲与打字机的所有定时器（降功耗；回前台自动恢复）
        this.appPaused = true;
        this.syncPulse(false);
    }
    onPageShow(): void {
        this.appPaused = false;
        this.syncPulse(this.busy);
    }
    private syncPulse(busy: boolean): void {
        if (busy && !this.appPaused && this.pulseTimer < 0) {
            this.pulseTimer = setInterval(() => {
                this.pulseOn = !this.pulseOn;
                // 同一拍顺手推进流光位置（避免为装饰再开一个定时器）
                this.sweepX = this.sweepX >= 300 ? -80 : this.sweepX + 110;
            }, 600);
            return;
        }
        if (!busy && this.pulseTimer >= 0) {
            clearInterval(this.pulseTimer);
            this.pulseTimer = -1;
            this.pulseOn = true;
        }
    }
    private scheduleSync(store: ChatStore): void {
        // ⚠️ 只有**当前会话**的 store 能驱动界面：池里后台会话的更新照常积累在它自己的
        // 状态里，但绝不能覆盖正在显示的会话（否则两个会话的事件互相打架）。
        if (store !== this.store) {
            return;
        }
        this.pendingSync = store;
        if (this.syncScheduled) {
            return;
        }
        this.syncScheduled = true;
        setTimeout(() => {
            this.syncScheduled = false;
            const s: ChatStore | null = this.pendingSync;
            this.pendingSync = null;
            if (s !== null) {
                this.syncFrom(s);
            }
        }, 16);
    }
    private attach(store: ChatStore): void {
        this.store = store;
        this.syncFrom(store);
    }
    private syncFrom(store: ChatStore): void {
        // ── ⛔ 真机严重事故（"所有会话都渲染了第一个打开的会话的迭代"）的顺序契约 ──
        // ① **会话身份必须最先落定**：下面行指纹 / 行键 / live 尾 全部以 `this.currentChat` 为准，
        //    它排在后面会让行键仍用**旧会话 id**（跨会话键仍碰撞 = 复用旧条目）。
        // ② **指纹缓存必须随身份作废**：行 id 是**每 store 独立计数**（`live-1`/`a-1`…），
        //    两个会话的行指纹可能**逐字相同** ⇒ 不重置就永远不刷新 `this.rows`
        //    （表现为"切到哪个会话都显示上一个会话的内容"，且 busy 与内容来自不同会话 = 状态混乱）。
        if (identityChanged(this.currentChat, store.currentChatId)) {
            this.currentChat = store.currentChatId; // ← 身份先定
            this.atBottom = true;
            this.rowLimit = MAX_ROWS_VISIBLE; // 切会话重置行窗口（否则行数会无限累积增长）
            this.rowsFp = '';
            this.sessionsFp = '';
            this.queueFp = '';
            this.todosFp = ''; // 逐一会话作废（见下）
        }
        const sessFp: string = this.fingerprintSessions(store.sessions, store.currentChatId);
        if (sessFp !== this.sessionsFp) {
            this.sessionsFp = sessFp;
            this.sessions = store.sessions.slice();
        }
        const rowsFp: string = this.fingerprintRows(store.rows, store.currentChatId);
        if (rowsFp !== this.rowsFp) {
            this.rowsFp = rowsFp;
            this.rows = store.rows.slice();
            this.syncRowDs();
        }
        this.syncLiveTail(store);
        this.busy = store.busy;
        this.connState = store.connState;
        this.syncPulse(store.busy);
        this.currentChat = store.currentChatId;
        this.hasMore = store.hasMore;
        this.loadingMore = store.loadingMore;
        const queueFp: string = this.fingerprintQueue(store.queue, store.currentChatId);
        if (queueFp !== this.queueFp) {
            this.queueFp = queueFp;
            this.queue = store.queue.slice();
        }
        this.usage = store.usage;
        this.cwd = store.cwd;
        const todosFp: string = `${store.todos.length}|${store.todos.map((t: TodoItem) => `${t.status}#${t.text}`).join(',')}`;
        if (todosFp !== this.todosFp) {
            this.todosFp = todosFp;
            this.todos = store.todos.slice();
        }
        this.goal = store.goal;
        this.llmCfg = store.llmConfig;
        if (this.cronTasks !== store.cronTasks) {
            this.cronTasks = store.cronTasks;
        }
        if (this.bgTasks !== store.bgTasks) {
            this.bgTasks = store.bgTasks;
        }
        if (this.runners !== store.runners) {
            this.runners = store.runners;
        }
        if (this.subagents !== store.subagents) {
            this.subagents = store.subagents;
        }
        this.settings = store.settings;
        const t: string = settingOf(store.settings, KEY_APP_THEME);
        if (t.length > 0) {
            this.themeName = normalizeTheme(t);
        }
        if (!this.reasoningDefaultApplied && Object.keys(store.settings).length > 0) {
            // 只在设置首次到达时套用默认展开状态（之后尊重用户的手动切换）
            this.showReasoning = parseBool(settingOf(store.settings, KEY_REASONING_DEFAULT), this.showReasoning);
            this.reasoningDefaultApplied = true;
        }
        // busy 结束 ⇒ 发送模式复位（插话只对"正在跑"的会话有意义）
        if (!store.busy && this.sendMode !== MODE_QUEUE) {
            this.sendMode = MODE_QUEUE;
        }
        const ask: AskUserPrompt | null = store.askUser;
        if (ask !== this.askUser) {
            this.askUser = ask;
            this.askSelections = selectionsFor(ask);
        }
        // 只有用户本来就在底部才跟随；用户往上滚后就不再抢滚动位置（否则"阅读中被打断"）
        if (this.atBottom) {
            setTimeout(() => {
                try {
                    this.listScroller.scrollEdge(Edge.Bottom);
                }
                catch (e) {
                    // 首帧尚未布局
                }
            }, 30);
        }
    }
    /** 规范化并校验服务端地址；不合法返回空串并把原因写进 testMsg。 */
    private takeServerUrl(): string {
        const url: string = normalizeServerUrl(this.serverUrl);
        if (!isValidServerUrl(url)) {
            this.testMsg = '地址不完整：需要 http://主机:端口（例如 http://192.168.1.10:16000）';
            return '';
        }
        this.serverUrl = url;
        return url;
    }
    /** 「测试连接」：打公开端点 /api/auth/config（不需要登录），立刻给出可达性结论。 */
    private async testConnection(): Promise<void> {
        const url: string = this.takeServerUrl();
        if (url.length === 0) {
            return;
        }
        this.testing = true;
        this.testMsg = '';
        try {
            // 探测服务端可用性：此时**还没登录**，不带凭据
            const store: ChatStore = this.makeStore(url, '');
            const cfg = await store.http.authConfig();
            const hint: string = cfg.need_bootstrap === true
                ? '服务端可用：还没有账号，先「注册」建第一个账号'
                : (cfg.invite_only === true ? '服务端可用：仅允许已存在的账号登录' : '服务端可用：可直接登录或注册');
            this.testMsg = `✅ ${hint}`;
            // 顺手记进"最近使用"
            await this.config.save(url, this.username, '');
            this.recentServers = this.config.recentServers();
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.testMsg = `❌ 连不上：${err.message}（检查 IP/端口、手机是否同网段、服务端是否在跑）`;
        }
        finally {
            this.testing = false;
        }
    }
    /**
     * 逐页采集版面几何并**显示在屏幕上**（不依赖网络）。
     *
     * 为什么需要：真机画面只能靠用户截图；但"哪个容器高度为 0 / 跑到屏幕外"这类根因，
     * **数值比图更直接**。把数值渲染成文本后，用户截一张图就等于把 7 页的实测几何带给我。
     */
    private async collectAllGeometry(): Promise<void> {
        if (this.geoRunning) {
            return;
        }
        this.geoRunning = true;
        const parts: string[] = [];
        try {
            parts.push(`# 聊天页\n${this.collectGeometry()}`);
            this.showDrawer = true;
            await this.wait(700);
            parts.push(`# 会话抽屉\n${this.collectGeometry()}`);
            this.showDrawer = false;
            this.anim(() => {
                this.showSettings = true;
            });
            await this.wait(700);
            parts.push(`# 设置\n${this.collectGeometry()}`);
            this.showSettings = false;
            this.showQueue = true;
            await this.wait(700);
            parts.push(`# 队列\n${this.collectGeometry()}`);
            this.showQueue = false;
            this.showPlugins = true;
            await this.wait(700);
            parts.push(`# 能力面板\n${this.collectGeometry()}`);
            this.showPlugins = false;
            await this.wait(300);
            parts.push(`# 回到聊天\n${this.collectGeometry()}`);
            this.geoText = parts.join('\n\n');
        }
        catch (e) {
            this.geoText = `采集失败: ${errText(e as Object)}`;
        }
        finally {
            this.showDrawer = false;
            this.showSettings = false;
            this.showQueue = false;
            this.showPlugins = false;
            this.geoRunning = false;
        }
    }
    /** 等待 ms（ArkTS 里没有 await sleep，自己包一层 Promise）。 */
    private wait(ms: number): Promise<void> {
        return new Promise<void>((resolve: () => void) => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    }
    /**
     * 采集关键组件的**版面几何数值**（可读文本，不依赖看图）。
     *
     * 为什么需要：若渲染乱到看不清，数值仍能指出根因（例如列表高度 0、元素跑到屏幕外、
     * 宽度为 0）。`componentUtils.getRectangleById(id)` 对不存在的组件会抛错 ⇒ 逐个兜底。
     */
    private collectGeometry(): string {
        const ids: string[] = [
            'xbot-root', 'xbot-header', 'xbot-list', 'xbot-composer', 'xbot-login',
            'xbot-drawer', 'xbot-settings', 'xbot-selfcheck',
        ];
        const out: string[] = [];
        try {
            const d: display.Display = display.getDefaultDisplaySync();
            out.push(`screen=${d.width}x${d.height} densityDPI=${d.densityDPI}`);
        }
        catch (e) {
            out.push('screen=unknown');
        }
        // 显式标注当前页：否则"聊天页组件全 0 尺寸"会被误读成渲染塌陷（实际是当时在登录页）
        out.push(`当前页面=${this.loggedIn ? '聊天页' : '登录页（聊天页组件不存在，几何全 0 属正常）'}`);
        for (let i = 0; i < ids.length; i++) {
            try {
                const r: componentUtils.ComponentInfo = componentUtils.getRectangleById(ids[i]);
                const gx: number = Math.round(r.screenOffset.x);
                const gy: number = Math.round(r.screenOffset.y);
                const gw: number = Math.round(r.size.width);
                const gh: number = Math.round(r.size.height);
                // ⚠️ ArkUI 对"不存在"的 id 往往返回 0 尺寸而不是抛错 ⇒ 必须显式标注，
                // 否则"组件真的 0 尺寸"与"组件不存在"分不开（曾导致一份几何文本无法判读）。
                const flag: string = (gw === 0 || gh === 0) ? ' ⚠未布局(0尺寸,或被弹层遮挡/当前不在该页)' : '';
                out.push(`${ids[i]}: x=${gx} y=${gy} w=${gw} h=${gh}${flag}`);
            }
            catch (e) {
                out.push(`${ids[i]}: absent（getRectangleById 抛错=确实不存在）`);
            }
        }
        return out.join('\n');
    }
    /** 截取根容器当前画面并上传到服务端（返回服务端给的 key）。 */
    private async captureAndUpload(name: string): Promise<string> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return '';
        }
        const pm: image.PixelMap = await componentSnapshot.get('xbot-root');
        const packer: image.ImagePacker = image.createImagePacker();
        const buf: ArrayBuffer = await packer.packing(pm, { format: 'image/png', quality: 100 });
        await packer.release();
        const data: string = await store.http.uploadBytes('/api/files/upload', `${name}.png`, buf, 'image/png');
        await pm.release();
        return data;
    }
    /**
     * UI 走查：逐页截图并上传（登录页/聊天页/会话抽屉/设置/队列/能力面板/渲染自检）。
     *
     * 为什么要自动化：本机无法渲染鸿蒙 Stage 应用（预览器源码 `Linux is not supported`、
     * 无头容器 `AttachSurface not ready`），只能借助真机。与其让用户一页页手动截图，
     * 不如让应用**自己**把每一页截下来传到用户自己的服务端 —— 服务端目录我这边可读。
     */
    private async runUiAudit(): Promise<void> {
        if (this.auditing) {
            return;
        }
        // ⚠️ 未登录时走查毫无意义：只会上传 7 张**登录页**（真机已发生过一次，白跑一轮）。
        // 这里直接拦住并说明原因，避免产生无法判读的证据。
        if (!this.loggedIn) {
            this.auditLog = '未登录：走查只能拍到登录页，已跳过（请先登录再走查）';
            this.toast('未登录：请先登录再走查（否则只能拍到登录页）');
            return;
        }
        this.auditing = true;
        const done: string[] = [];
        const geo: string[] = [];
        try {
            const steps: string[] = ['01-chat'];
            for (let i = 0; i < steps.length; i++) {
                await this.wait(600);
                done.push(`${steps[i]}=${await this.captureAndUpload(steps[i])}`);
                geo.push(`--- ${steps[i]} ---\n${this.collectGeometry()}`);
            }
            // 会话抽屉
            this.showDrawer = true;
            await this.wait(900);
            try {
                done.push(`02-drawer=${await this.captureAndUpload('02-drawer')}`);
            }
            catch (e) {
                done.push(`02-drawer=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 02-drawer ---\n${this.collectGeometry()}`);
            this.showDrawer = false;
            // 设置
            this.anim(() => {
                this.showSettings = true;
            });
            await this.wait(900);
            try {
                done.push(`03-settings=${await this.captureAndUpload('03-settings')}`);
            }
            catch (e) {
                done.push(`03-settings=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 03-settings ---\n${this.collectGeometry()}`);
            this.showSettings = false;
            // 渲染自检
            this.showSelfCheck = true;
            await this.wait(1200);
            try {
                done.push(`04-selfcheck=${await this.captureAndUpload('04-selfcheck')}`);
            }
            catch (e) {
                done.push(`04-selfcheck=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 04-selfcheck ---\n${this.collectGeometry()}`);
            this.showSelfCheck = false;
            // 队列（有内容才有意义，无内容也截，便于对比）
            this.showQueue = true;
            await this.wait(900);
            try {
                done.push(`05-queue=${await this.captureAndUpload('05-queue')}`);
            }
            catch (e) {
                done.push(`05-queue=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 05-queue ---\n${this.collectGeometry()}`);
            this.showQueue = false;
            // 能力面板
            await this.openPlugins();
            await this.wait(900);
            try {
                done.push(`06-plugins=${await this.captureAndUpload('06-plugins')}`);
            }
            catch (e) {
                done.push(`06-plugins=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 06-plugins ---\n${this.collectGeometry()}`);
            this.showPlugins = false;
            await this.wait(400);
            try {
                done.push(`07-chat-back=${await this.captureAndUpload('07-chat-back')}`);
            }
            catch (e) {
                done.push(`07-chat-back=FAILED:${errText(e as Object)}`);
            }
            geo.push(`--- 07-chat-back ---\n${this.collectGeometry()}`);
            this.auditLog = done.join('  ');
            this.toast('走查完成，已上传 7 张截图 + 1 份版面几何');
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.auditLog = `失败: ${err.message}（已完成: ${done.join(' ')}）`;
            this.toast(`走查失败: ${err.message}`);
        }
        finally {
            // 几何数值必须送达（唯一不依赖图像的信息）：即使中途失败也要上传
            const st: ChatStore | null = this.store;
            if (st !== null && geo.length > 0) {
                try {
                    const txt: string = geo.join('\n\n');
                    const bytes: Uint8Array = new Uint8Array(new util.TextEncoder().encodeInto(txt));
                    await st.http.uploadBytes('/api/files/upload', 'audit-layout.txt', bytes.buffer as ArrayBuffer, 'text/plain');
                    this.auditLog = `${this.auditLog}\n几何已上传(${geo.length} 页)`;
                }
                catch (e) {
                    this.auditLog = `${this.auditLog}\n几何上传失败: ${errText(e as Object)}`;
                }
            }
            this.auditing = false;
            this.showSelfCheck = false;
        }
    }
    private toast(msg: string): void {
        promptAction.showToast({ message: msg, duration: 2500 });
    }
    // ── 登录 / 登出 ───────────────────────────────────────────────────────────
    private async doLogin(): Promise<void> {
        this.errMsg = '';
        const url: string = this.takeServerUrl();
        if (url.length === 0) {
            this.errMsg = this.testMsg;
            return;
        }
        // 登录：此时还没有凭据（login() 成功后 cookie 由 http 内部持有）
        const store: ChatStore = this.makeStore(url, '');
        try {
            await store.http.login(this.username, this.password);
        }
        catch (e) {
            this.errMsg = `[登录请求] ${errText(e)}`;
            return;
        }
        try {
            await store.loadSessions();
            this.attach(store);
        }
        catch (e) {
            this.errMsg = `[加载会话] ${errText(e)}`;
            return;
        }
        try {
            this.cookie = store.http.exportSessionCookie();
            this.authExpiredHandled = false;
            await this.config.save(url, this.username, this.cookie);
            this.recentServers = this.config.recentServers();
        }
        catch (e) {
            this.errMsg = `[保存登录态] ${errText(e)}`;
            return;
        }
        this.loggedIn = true;
        const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
        if (first !== undefined && first.chat_id !== undefined) {
            try {
                await store.openSession(first.chat_id);
            }
            catch (e) {
                this.errMsg = `[打开会话] ${errText(e)}`;
            }
        }
    }
    private async doRegister(): Promise<void> {
        this.errMsg = '';
        const url: string = this.takeServerUrl();
        if (url.length === 0) {
            this.errMsg = this.testMsg;
            return;
        }
        try {
            const store: ChatStore = this.makeStore(url, '');
            await store.http.register(this.username, this.password);
            await this.doLogin();
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.errMsg = err.message;
        }
    }
    private async doLogout(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store !== null) {
            try {
                await store.http.logout();
            }
            catch (e) {
                // 忽略
            }
            store.sse.close();
        }
        await this.config.clearSession();
        // 清空多会话池（每个 store 都要关 SSE，否则会留下后台连接）
        const poolKeys: string[] = Array.from(this.pools.keys());
        for (let i = 0; i < poolKeys.length; i++) {
            const ps: ChatStore | undefined = this.pools.get(poolKeys[i]);
            if (ps !== undefined) {
                ps.dispose();
            }
        }
        this.pools.clear();
        this.poolOrder = [];
        this.store = null;
        this.loggedIn = false;
        this.rows = [];
        this.syncRowDs();
        this.sessions = [];
        this.showDrawer = false;
    }
    // ── 会话 ──────────────────────────────────────────────────────────────────
    /** 池上限（超过按 LRU 驱逐并关连接）。 */
    private poolMax(): number {
        return 3;
    }
    /** 取会话对应的 store（池里有就复用；没有就建 + 入池 + 必要时驱逐）。 */
    private storeFor(chatId: string): ChatStore {
        const hit: ChatStore | undefined = this.pools.get(chatId);
        if (hit !== undefined) {
            this.touchPool(chatId);
            return hit;
        }
        // 池里的 store 也必须带上会话凭据（否则它发出的每个请求都是 401）
        const store: ChatStore = this.makeStore(this.serverUrl, this.cookie);
        this.pools.set(chatId, store);
        this.poolOrder.push(chatId);
        this.evictPools();
        return store;
    }
    /**
     * 把 store 在池里的注册**归位到它当前真正打开的会话**。
     *
     * 为什么需要：池按 chatId 建索引，但 store 的 `currentChatId` 会变（新建会话、分支、
     * 冷启动首个会话）。不归位就会出现两种隐患：① 同一个会话被两个 store 订阅（双连、双事件）；
     * ② 旧键指向一个已经打开别的会话的 store ⇒ 切回去时白白重拉。
     */
    private rekeyPool(store: ChatStore, chatId: string): void {
        const stale: string[] = [];
        const keys: string[] = Array.from(this.pools.keys());
        for (let i = 0; i < keys.length; i++) {
            const k: string = keys[i];
            const v: ChatStore | undefined = this.pools.get(k);
            if (v === store && k !== chatId) {
                stale.push(k);
            }
        }
        for (let i = 0; i < stale.length; i++) {
            this.pools.delete(stale[i]);
            const oi: number = this.poolOrder.indexOf(stale[i]);
            if (oi >= 0) {
                this.poolOrder.splice(oi, 1);
            }
        }
        this.pools.set(chatId, store);
        this.touchPool(chatId);
    }
    /** 标记最近使用（LRU）。 */
    private touchPool(chatId: string): void {
        const i: number = this.poolOrder.indexOf(chatId);
        if (i >= 0) {
            this.poolOrder.splice(i, 1);
        }
        this.poolOrder.push(chatId);
    }
    /** 超出上限：从最久未用的开始驱逐（**不能驱逐当前会话**）。 */
    private evictPools(): void {
        while (this.poolOrder.length > this.poolMax()) {
            let victim: string = '';
            for (let i = 0; i < this.poolOrder.length; i++) {
                if (this.poolOrder[i] !== this.currentChat) {
                    victim = this.poolOrder[i];
                    break;
                }
            }
            if (victim.length === 0) {
                return;
            }
            const store: ChatStore | undefined = this.pools.get(victim);
            if (store !== undefined) {
                store.dispose();
            }
            this.pools.delete(victim);
            const idx: number = this.poolOrder.indexOf(victim);
            if (idx >= 0) {
                this.poolOrder.splice(idx, 1);
            }
        }
    }
    /** 关掉一个标签（若是当前会话，先切到别的；没有别的就清空视图）。 */
    private closeTab(chatId: string): void {
        const store: ChatStore | undefined = this.pools.get(chatId);
        if (store !== undefined) {
            store.dispose();
        }
        this.pools.delete(chatId);
        const i: number = this.poolOrder.indexOf(chatId);
        if (i >= 0) {
            this.poolOrder.splice(i, 1);
        }
        if (chatId === this.currentChat) {
            const next: string = this.poolOrder.length > 0 ? this.poolOrder[this.poolOrder.length - 1] : '';
            if (next.length > 0) {
                this.switchSession(next);
            }
            else {
                this.store = null;
                this.currentChat = '';
                this.rows = [];
                this.syncRowDs();
                this.busy = false;
            }
        }
    }
    /**
     * 切换会话：**池里已有 ⇒ 瞬时切换**（不重建、不断连、不重新拉历史）。
     *
     * 这与 Web 端的 MultiSSEManager 同思路：可见会话保持连接与状态，切回是 0 等待。
     */
    private async switchSession(chatId: string): Promise<void> {
        this.showDrawer = false;
        // ⛔ 会话作用域的**前端状态**必须随切换清空（同「跨会话串内容」一类事故，2026-10-10）：
        //   attachments —— 在 A 会话挂的文件绝不能跟着带到 B 会话（切过去直接发 => 发错文件）
        //   cmd* / fs*  —— 上一个会话残留的 `/` `@` 补全菜单
        //   ctxOpen     —— 长按菜单指向的是上一个会话的行，切换后必须关掉
        this.attachments = [];
        this.cmdToken = '';
        this.cmdItems = [];
        this.fsEntries = [];
        this.ctxOpen = false;
        const target: ChatStore = this.storeFor(chatId);
        // 会话列表是**应用级**数据，但快照存在 store 上：池里刚建的 store 是空的，
        // 若直接切过去，抽屉会没数据、渠道解析也会错（⇒ 404）。这里先补齐。
        if (target.sessions.length === 0) {
            try {
                await target.loadSessions();
            }
            catch (e) {
                // 拉不到列表不阻塞切换：openSession 里还会再试一次
            }
        }
        const alreadyOpen: boolean = target.currentChatId === chatId;
        this.store = target;
        this.rekeyPool(target, chatId);
        // 切会话：列表淡入（先置近 0 再 animateTo 回 1 —— 避免"闪一下旧会话"的观感）
        this.listAlpha = 0.001;
        this.anim(() => {
            this.listAlpha = 1;
        });
        // 切会话即换草稿（每个会话各自一份；弱网下也能恢复）
        this.failedSend = '';
        this.draft = this.config.draftFor(chatId);
        if (alreadyOpen) {
            // 池里这个会话一直开着：直接把已累积的状态映到界面（不发生任何网络等待）
            this.syncFrom(target);
            return;
        }
        try {
            await target.openSession(chatId);
        }
        catch (e) {
            this.loadErr = errText(e as Object);
            this.toast(`切换失败: ${this.loadErr}`);
        }
    }
    /** 标签显示名（来自会话列表的名字，取不到则用 id 末段）。 */
    private tabLabel(chatId: string): string {
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].chat_id === chatId) {
                const s: SessionItem = this.sessions[i];
                return sessionLabel(s.label !== undefined ? s.label : '', chatId);
            }
        }
        return sessionLabel('', chatId);
    }
    /** 该标签的会话是否在跑（用会话列表的 running，或该池 store 的 busy）。 */
    private tabRunning(chatId: string): boolean {
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].chat_id === chatId) {
                return this.sessions[i].running === true;
            }
        }
        const st: ChatStore | undefined = this.pools.get(chatId);
        return st !== undefined && st.busy;
    }
    private async newSession(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        this.showDrawer = false;
        try {
            await store.createSession();
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.toast(`新建失败: ${err.message}`);
        }
    }
    private labelOf(chatId: string): string {
        for (let i = 0; i < this.sessions.length; i++) {
            const s: SessionItem = this.sessions[i];
            if (s.chat_id === chatId) {
                return s.label !== undefined && s.label.length > 0 ? s.label : s.chat_id;
            }
        }
        return chatId;
    }
    // ── 发送 / 取消 / 分页 ────────────────────────────────────────────────────
    /**
     * 选一个文件 → 读字节 → 上传 → 记下 `upload_key`（发送时随消息带上）。
     *
     * 与服务端契约一致：multipart 字段名 `file`，响应用 `upload_key`（见 core/attach.ets 与
     * store.uploadAttachment）。上传完成前不允许发送（避免发出没有 key 的空附件）。
     */
    private async pickFiles(): Promise<void> {
        try {
            const opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
            opt.maxSelectNumber = MAX_ATTACH;
            const res: string[] = await new picker.DocumentViewPicker().select(opt);
            if (res === undefined || res.length === 0) {
                return;
            }
            await this.uploadUris(res);
        }
        catch (e) {
            this.toast(`选择文件失败: ${errText(e as Object)}`);
        }
    }
    /** 从相册选图（多选）。 */
    private async pickImages(): Promise<void> {
        try {
            const opt: picker.PhotoSelectOptions = new picker.PhotoSelectOptions();
            opt.MIMEType = picker.PhotoViewMIMETypes.IMAGE_TYPE;
            opt.maxSelectNumber = MAX_ATTACH;
            const res: picker.PhotoSelectResult = await new picker.PhotoViewPicker().select(opt);
            const uris: string[] = res !== undefined ? res.photoUris : [];
            if (uris.length === 0) {
                return;
            }
            await this.uploadUris(uris);
        }
        catch (e) {
            this.toast(`选择图片失败: ${errText(e as Object)}`);
        }
    }
    /** 是否还有附件在上传（>0 禁止发送）。 */
    private anyUploading(): boolean {
        return pendingCount(this.attachments) > 0;
    }
    /** 批量入列并逐个上传（每个文件独立状态，互不影响）。 */
    private async uploadUris(uris: string[]): Promise<void> {
        const items: AttachItem[] = [];
        for (let i = 0; i < uris.length; i++) {
            const it: AttachItem = new AttachItem();
            it.uid = util.generateRandomUUID();
            it.uri = uris[i];
            it.name = baseName(uris[i]);
            it.mime = mimeOf(it.name);
            it.status = ATTACH_UPLOADING;
            items.push(it);
        }
        this.attachments = this.attachments.concat(items);
        for (let i = 0; i < items.length; i++) {
            await this.uploadOne(items[i].uid, items[i].uri, items[i].name, items[i].mime);
        }
    }
    /** 上传一个本地文件（按 uid 回填状态）。 */
    private async uploadOne(uid: string, uri: string, name: string, mime: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            const st: fileIo.Stat = fileIo.statSync(uri);
            const f: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
            const buf: ArrayBuffer = new ArrayBuffer(st.size);
            fileIo.readSync(f.fd, buf);
            fileIo.closeSync(f);
            const key: string = await store.uploadAttachment(name, buf, mime);
            this.attachments = patchByUid(this.attachments, uid, key, st.size, ATTACH_DONE, '');
        }
        catch (e) {
            this.attachments = patchByUid(this.attachments, uid, '', 0, ATTACH_FAILED, errText(e as Object));
        }
    }
    /** 粘贴板里的图片直接变成附件（文本粘贴不拦截，交给输入框自身）。 */
    private async pasteImage(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            const board: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();
            const data: pasteboard.PasteData = await board.getData();
            const mime: string = data.getPrimaryMimeType().toLowerCase();
            if (mime.indexOf('image/') !== 0) {
                return;
            }
            const pm: image.PixelMap | undefined = await data.getPrimaryPixelMap();
            if (pm === undefined) {
                return;
            }
            const packer: image.ImagePacker = image.createImagePacker();
            const buf: ArrayBuffer = await packer.packing(pm, { format: 'image/png', quality: 100 });
            const it: AttachItem = new AttachItem();
            it.uid = util.generateRandomUUID();
            it.uri = '';
            it.name = `粘贴图片-${Date.now()}.png`;
            it.mime = 'image/png';
            it.status = ATTACH_UPLOADING;
            this.attachments = this.attachments.concat([it]);
            this.toast(`正在上传${it.name}…`);
            try {
                const key: string = await store.uploadAttachment(it.name, buf, it.mime);
                this.attachments = patchByUid(this.attachments, it.uid, key, buf.byteLength, ATTACH_DONE, '');
            }
            catch (e) {
                this.attachments = patchByUid(this.attachments, it.uid, '', 0, ATTACH_FAILED, errText(e as Object));
            }
        }
        catch (e) {
            // 粘贴板无图片 / 无权限：静默（不打断用户输入）
        }
    }
    /** 失败重试（用记录的本地 URI 重传）。 */
    private async retryAttachment(uid: string): Promise<void> {
        let target: AttachItem | undefined = undefined;
        for (let i = 0; i < this.attachments.length; i++) {
            if (this.attachments[i].uid === uid) {
                target = this.attachments[i];
            }
        }
        if (target === undefined || target.uri.length === 0) {
            this.toast('无法重试：本地文件已不可用');
            return;
        }
        this.attachments = patchByUid(this.attachments, uid, '', 0, ATTACH_UPLOADING, '');
        const uri: string = target.uri;
        const name: string = target.name;
        const mime: string = target.mime;
        await this.uploadOne(uid, uri, name, mime);
    }
    private removeAttachment(uid: string): void {
        this.attachments = removeByUid(this.attachments, uid);
    }
    private clearAttachments(): void {
        this.attachments = [];
    }
    /** 状态栏一行（只用服务端真实值拼装；都没有则返回空串，不占位）。 */
    private statusBarText(): string {
        const parts: string[] = [];
        const m: string = modelText(this.usage);
        if (m.length > 0) {
            parts.push(m);
        }
        const u: string = usageText(this.usage);
        if (u.length > 0) {
            parts.push(u);
        }
        const tp: string = todoProgress(this.todos);
        if (tp.length > 0) {
            parts.push(`todos ${tp}`);
        }
        if (this.cwd.length > 0) {
            parts.push(this.cwd);
        }
        return parts.join('  ·  ');
    }
    private todoCount(): number {
        return this.todos.length;
    }
    private goalLine(): string {
        return goalText(this.goal);
    }
    /** 当前进行中的 todo（面板顶部显示）。 */
    private currentTodoLine(): string {
        return currentTodo(this.todos);
    }
    private async sendDraft(): Promise<void> {
        const store: ChatStore | null = this.store;
        const text: string = this.draft.trim();
        if (store === null || this.anyUploading()) {
            return;
        }
        const keys: string[] = doneKeys(this.attachments);
        const names: string[] = doneNames(this.attachments);
        const sizes: number[] = doneSizes(this.attachments);
        if (text.length === 0 && keys.length === 0) {
            return;
        }
        // 正文里带上引用（看得见发了什么）。服务端 `appendUploadRef` 自带去重：
        // 正文已有同一引用时不会再追加 —— 这正是 Web 上「图片变两张」的根治点。
        let content: string = text;
        const refs: string[] = doneRefs(this.attachments);
        for (let i = 0; i < refs.length && i < keys.length; i++) {
            if (!hasRef(content, keys[i])) {
                content = appendRef(content, refs[i]);
            }
        }
        const keep: AttachItem[] = this.attachments;
        this.draft = '';
        this.attachments = [];
        const busyBefore: boolean = this.busy;
        const interrupt: boolean = isInterruptSend(this.busy, this.sendMode);
        this.buzz();
        try {
            let interrupted: boolean = false;
            if (keys.length > 0) {
                interrupted = await store.send(content, keys, names, sizes, interrupt);
            }
            else {
                interrupted = await store.send(content, undefined, undefined, undefined, interrupt);
            }
            this.failedSend = '';
            const note: string = sendToast(interrupted, busyBefore);
            if (note.length > 0) {
                this.toast(note);
            }
        }
        catch (e) {
            // 失败：草稿与附件都还给用户（store 已回滚那条乐观行，界面不会留幽灵消息）
            this.draft = text;
            this.attachments = keep;
            this.failedSend = text;
            this.toast(`发送失败: ${errText(e as Object)}`);
        }
    }
    /** 取图片字节（带会话鉴权）—— AuthImage 与查看器共用同一实现。 */
    private async loadImageBytes(src: string): Promise<ArrayBuffer> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return new ArrayBuffer(0);
        }
        const buf: ArrayBuffer | null = await store.http.getBinary(src);
        return buf !== null ? buf : new ArrayBuffer(0);
    }
    /**
     * 会话在服务端已不存在（404）：刷新列表并切到第一个可用会话。
     * 这类错误**重试没有意义**（会话真的没了），必须换一个会话。
     */
    private async recoverMissingSession(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        this.loadErr = '';
        this.toast('该会话已不存在，正在刷新会话列表…');
        try {
            await store.loadSessions();
            const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
            if (first !== undefined && first.chat_id !== undefined && first.chat_id.length > 0) {
                await this.switchSession(first.chat_id);
            }
            else {
                this.currentChat = '';
                this.rows = [];
                this.syncRowDs();
            }
        }
        catch (e) {
            this.loadErr = errText(e as Object);
        }
    }
    /** 重试加载当前会话（网络恢复后一键回到正常）。 */
    private async retryLoad(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        this.loadErr = '';
        try {
            if (this.currentChat.length === 0) {
                await store.loadSessions();
                const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
                if (first !== undefined && first.chat_id !== undefined) {
                    await store.openSession(first.chat_id);
                }
            }
            else {
                await store.openSession(this.currentChat);
            }
        }
        catch (e) {
            this.loadErr = errText(e as Object);
            this.toast(`仍然失败: ${this.loadErr}`);
        }
    }
    private async loadMore(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        await store.loadMore();
    }
    // ── 工具详情 / 迭代展开 ───────────────────────────────────────────────────
    /** 行组件回调入口：按 (迭代号, 工具名) 找到工具后沿用 toggleTool 的语义。 */
    private async toggleToolByKey(row: ChatRow, iter: number, name: string): Promise<void> {
        for (let i = 0; i < row.iterations.length; i++) {
            const it: HistoryIteration = row.iterations[i];
            if (it.iteration !== iter || it.tools === undefined) {
                continue;
            }
            for (let k = 0; k < it.tools.length; k++) {
                if (it.tools[k].name === name) {
                    await this.toggleTool(row, it, it.tools[k]);
                    return;
                }
            }
        }
    }
    /** 工具详情的开合键（页面与行组件各自持有一份同实现）。 */
    private toolKey(turnID: number, iter: number, name: string): string {
        return `${turnID}:${iter}:${name}`;
    }
    private async toggleTool(row: ChatRow, it: HistoryIteration, t: ToolProgress): Promise<void> {
        const key: string = this.toolKey(row.turnID, it.iteration, t.name);
        if (this.openToolKey === key) {
            this.openToolKey = '';
            return;
        }
        this.openToolKey = key;
        const store: ChatStore | null = this.store;
        // 折叠视图下详情未下发（该迭代带 tools_folded）→ 按需拉取
        if (store !== null && it.tools_folded === true && (t.detail === undefined || t.detail.length === 0)) {
            await store.fetchIterationDetail(row.turnID, it.iteration);
        }
    }
    // ── AskUser ───────────────────────────────────────────────────────────────
    private toggleAskOption(qid: string, label: string, multi: boolean): void {
        const next: AskSelection[] = [];
        for (let i = 0; i < this.askSelections.length; i++) {
            const s: AskSelection = this.askSelections[i];
            if (s.qid !== qid) {
                next.push(s);
                continue;
            }
            const copy: AskSelection = new AskSelection();
            copy.qid = s.qid;
            copy.other = s.other;
            if (!multi) {
                copy.labels = s.labels.indexOf(label) >= 0 ? [] : [label];
            }
            else if (s.labels.indexOf(label) >= 0) {
                copy.labels = s.labels.filter((x: string) => x !== label);
            }
            else {
                copy.labels = s.labels.concat([label]);
            }
            next.push(copy);
        }
        this.askSelections = next;
    }
    private isAskSelected(qid: string, label: string): boolean {
        for (let i = 0; i < this.askSelections.length; i++) {
            const s: AskSelection = this.askSelections[i];
            if (s.qid === qid) {
                return s.labels.indexOf(label) >= 0;
            }
        }
        return false;
    }
    private async submitAsk(cancelled: boolean): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null || this.askBusy) {
            return;
        }
        this.askBusy = true;
        try {
            const answers: Record<string, string> = {};
            for (let i = 0; i < this.askSelections.length; i++) {
                const s: AskSelection = this.askSelections[i];
                const joined: string = s.labels.join(', ');
                answers[s.qid] = s.other.length > 0 ? (joined.length > 0 ? `${joined}；${s.other}` : s.other) : joined;
            }
            await store.respondAsk(answers, cancelled);
            this.askUser = null;
            this.askSelections = [];
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.toast(`提交失败: ${err.message}`);
        }
        finally {
            this.askBusy = false;
        }
    }
    // ── 插件面板 ──────────────────────────────────────────────────────────────
    private async openPlugins(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store !== null) {
            this.plugins = await store.listPlugins();
        }
        this.showPlugins = true;
    }
    // ── 图片（cookie 鉴权端点 → 自行取字节解码） ──────────────────────────────
    /** 关闭查看器（复位缩放/位移，下次打开是干净的）。 */
    private closeViewer(): void {
        this.imagePixel = null;
        this.imageBusy = false;
        this.imgScale = 1;
        this.imgTransX = 0;
        this.imgTransY = 0;
    }
    /** 把当前图片存进相册（SaveButton 授权成功后调用；失败原样报错，不静默）。 */
    private async saveToAlbum(): Promise<void> {
        const pm: image.PixelMap | null = this.imagePixel;
        if (pm === null) {
            return;
        }
        try {
            const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
            const helper: photoAccessHelper.PhotoAccessHelper = photoAccessHelper.getPhotoAccessHelper(ctx);
            const opts: photoAccessHelper.CreateOptions = { title: saveImageName(Date.now()) };
            const uri: string = await helper.createAsset(photoAccessHelper.PhotoType.IMAGE, 'png', opts);
            const f: fileIo.File = await fileIo.open(uri, fileIo.OpenMode.READ_WRITE);
            const packer: image.ImagePacker = image.createImagePacker();
            const buf: ArrayBuffer = await packer.packing(pm, { format: 'image/png', quality: 100 });
            await fileIo.write(f.fd, buf);
            await fileIo.close(f);
            this.toast('已保存到相册');
        }
        catch (e) {
            this.toast(`保存失败: ${errText(e as Object)}`);
        }
    }
    private async openImage(src: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        this.imageBusy = true;
        this.imagePixel = null;
        try {
            const buf: ArrayBuffer | null = await store.http.getBinary(src);
            if (buf === null) {
                this.toast('图片加载失败（可能已过期或未登录）');
                return;
            }
            const source: image.ImageSource = image.createImageSource(buf);
            const pm: image.PixelMap = await source.createPixelMap();
            // 记录原始尺寸（平移边界要用）并复位缩放/位移
            const info: image.ImageInfo = await pm.getImageInfo();
            this.imgW = info.size.width;
            this.imgH = info.size.height;
            this.imgScale = 1;
            this.imgTransX = 0;
            this.imgTransY = 0;
            this.imagePixel = pm;
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            this.toast(`图片解码失败: ${err.message}`);
        }
        finally {
            this.imageBusy = false;
        }
    }
    // ── UI ────────────────────────────────────────────────────────────────────
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
            Stack.debugLine("entry/src/main/ets/pages/Index.ets(1729:5)", "entry");
            Stack.width('100%');
            Stack.height('100%');
            Stack.padding({ top: this.safeTop, bottom: this.safeBottom });
            Stack.backgroundColor(this.pal().appBg);
            Stack.id('xbot-root');
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (!this.booted) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.LoadingView.bind(this)();
                });
            }
            else if (!this.loggedIn) {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.LoginView.bind(this)();
                });
            }
            else if (this.useWebUI && this.webUiUrl.length > 0) {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
                        Stack.create();
                        Stack.debugLine("entry/src/main/ets/pages/Index.ets(1736:9)", "entry");
                        // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
                        Stack.width('100%');
                        // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
                        Stack.height('100%');
                        // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
                        Stack.alignContent(Alignment.TopStart);
                    }, Stack);
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new WebSurface(this, { url: this.webUiUrl, theme: this.themeName, chrome: false, onClose: () => {
                                    } }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 1737, col: 11 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        url: this.webUiUrl,
                                        theme: this.themeName,
                                        chrome: false,
                                        onClose: () => {
                                        }
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    url: this.webUiUrl, theme: this.themeName, chrome: false
                                });
                            }
                        }, { name: "WebSurface" });
                    }
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('切回原生');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1739:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                        Text.padding({ left: 10, right: 10, top: 5, bottom: 5 });
                        Text.backgroundColor(this.pal().surfaceAlt);
                        Text.borderRadius(8);
                        Text.margin({ left: 8, top: 8 });
                        Text.onClick(() => {
                            this.setSurface(false);
                        });
                    }, Text);
                    Text.pop();
                    // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
                    Stack.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(3, () => {
                    this.ChatView.bind(this)();
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 会话抽屉
            if (this.showDrawer) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.DrawerSheet.bind(this)();
                });
            }
            // 设置
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 设置
            if (this.showSettings) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.SettingsSheet.bind(this)();
                });
            }
            // 队列
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 队列
            if (this.showQueue) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.QueueSheet.bind(this)();
                });
            }
            // 插件面板选择
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 插件面板选择
            if (this.showPlugins) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.PluginsSheet.bind(this)();
                });
            }
            // AskUser（服务端权威：有 pending 就弹）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // AskUser（服务端权威：有 pending 就弹）
            if (this.askUser !== null) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.AskUserSheet.bind(this)();
                });
            }
            // 渲染自检（逐构件隔离排查用）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 渲染自检（逐构件隔离排查用）
            if (this.showSelfCheck) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.SelfCheckSheet.bind(this)();
                });
            }
            // 会话状态（todos / goal / 用量 / cwd）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 会话状态（todos / goal / 用量 / cwd）
            if (this.showStatus) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.StatusSheet.bind(this)();
                });
            }
            // 模型 / 上下文上限选择栏
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 模型 / 上下文上限选择栏
            if (this.showModel) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.ModelSheet.bind(this)();
                });
            }
            // 偏好设置（字号 / 换行 / 思考默认 / 快捷键）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 偏好设置（字号 / 换行 / 思考默认 / 快捷键）
            if (this.showPrefs) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1789:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Blank.create();
                        Blank.debugLine("entry/src/main/ets/pages/Index.ets(1790:11)", "entry");
                        Blank.layoutWeight(1);
                        Blank.width('100%');
                        Blank.onClick(() => {
                            this.showPrefs = false;
                        });
                    }, Blank);
                    Blank.pop();
                    this.PrefsSheet.bind(this)();
                    Column.pop();
                });
            }
            // 面板（定时任务 / 后台任务 / 子代理 / Runner）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 面板（定时任务 / 后台任务 / 子代理 / Runner）
            if (this.showPanels) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1798:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Blank.create();
                        Blank.debugLine("entry/src/main/ets/pages/Index.ets(1799:11)", "entry");
                        Blank.layoutWeight(1);
                        Blank.width('100%');
                        Blank.onClick(() => {
                            this.showPanels = false;
                        });
                    }, Blank);
                    Blank.pop();
                    this.PanelsSheet.bind(this)();
                    Column.pop();
                });
            }
            // 会话操作菜单（置顶/上移/下移/改名/分支/删除）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 会话操作菜单（置顶/上移/下移/改名/分支/删除）
            if (this.sessMenuId.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1807:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Blank.create();
                        Blank.debugLine("entry/src/main/ets/pages/Index.ets(1808:11)", "entry");
                        Blank.layoutWeight(1);
                        Blank.width('100%');
                        Blank.onClick(() => {
                            this.sessMenuId = '';
                            this.sessConfirmDelete = '';
                        });
                    }, Blank);
                    Blank.pop();
                    this.SessSheet.bind(this)();
                    Column.pop();
                });
            }
            // 会话内搜索结果
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 会话内搜索结果
            if (this.showSearchHits) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1817:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Blank.create();
                        Blank.debugLine("entry/src/main/ets/pages/Index.ets(1818:11)", "entry");
                        Blank.layoutWeight(1);
                        Blank.width('100%');
                        Blank.onClick(() => {
                            this.showSearchHits = false;
                        });
                    }, Blank);
                    Blank.pop();
                    this.SearchHitsSheet.bind(this)();
                    Column.pop();
                });
            }
            // 长按操作菜单（消息 / 迭代 / 工具 / 链接）——贴底弹出，点空白关闭
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 长按操作菜单（消息 / 迭代 / 工具 / 链接）——贴底弹出，点空白关闭
            if (this.ctxOpen) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1826:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Blank.create();
                        Blank.debugLine("entry/src/main/ets/pages/Index.ets(1827:11)", "entry");
                        Blank.layoutWeight(1);
                        Blank.width('100%');
                        Blank.onClick(() => {
                            this.ctxOpen = false;
                        });
                    }, Blank);
                    Blank.pop();
                    this.ContextSheet.bind(this)();
                    Column.pop();
                });
            }
            // 图片查看
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 图片查看
            if (this.imagePixel !== null || this.imageBusy) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.ImageViewer.bind(this)();
                });
            }
            // ArkWeb 逃生舱（插件 UI / GenUI / 终端 / 编辑器 / 完整 Web UI）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // ArkWeb 逃生舱（插件 UI / GenUI / 终端 / 编辑器 / 完整 Web UI）
            if (this.panelUrl.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new WebSurface(this, { url: this.panelUrl, theme: this.themeName, onClose: () => {
                                        this.panelUrl = '';
                                    } }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 1839, col: 9 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        url: this.panelUrl,
                                        theme: this.themeName,
                                        onClose: () => {
                                            this.panelUrl = '';
                                        }
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    url: this.panelUrl, theme: this.themeName
                                });
                            }
                        }, { name: "WebSurface" });
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        Stack.pop();
    }
    LoadingView(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(1853:5)", "entry");
            Column.width('100%');
            Column.height('100%');
            Column.justifyContent(FlexAlign.Center);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            LoadingProgress.create();
            LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(1854:7)", "entry");
            LoadingProgress.width(48);
            LoadingProgress.height(48);
            LoadingProgress.color(this.pal().accent);
        }, LoadingProgress);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('xbot');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1855:7)", "entry");
            Text.fontSize(18);
            Text.fontColor(this.pal().textPrimary);
            Text.margin({ top: 12 });
        }, Text);
        Text.pop();
        Column.pop();
    }
    LoginView(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 12 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(1861:5)", "entry");
            Column.padding(24);
            Column.width('100%');
            Column.height('100%');
            Column.justifyContent(FlexAlign.Center);
            Column.id('xbot-login');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('xbot');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1862:7)", "entry");
            Text.fontSize(34);
            Text.fontWeight(FontWeight.Bold);
            Text.linearGradient({ angle: 135, colors: [[this.pal().accent, 0.0], [this.pal().accentSoft, 1.0]] });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('连接你的 xbot 服务端（原生鸿蒙客户端）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1864:7)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textSecondary);
            Text.margin({ bottom: 8 });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '服务端地址，如 192.168.1.10:16000', text: this.serverUrl });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(1866:7)", "entry");
            TextInput.onChange((v: string) => {
                this.serverUrl = v;
                this.testMsg = '';
            });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
            TextInput.constraintSize({ minHeight: 46 });
            TextInput.borderRadius(12);
            TextInput.padding({ left: 12, right: 12 });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 最近用过的地址（一点即填，省得重打 IP）
            if (this.recentServers.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Flex.create({ wrap: FlexWrap.Wrap });
                        Flex.debugLine("entry/src/main/ets/pages/Index.ets(1876:9)", "entry");
                        Flex.width('100%');
                    }, Flex);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const u = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(u);
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(1878:13)", "entry");
                                Text.fontSize(11);
                                Text.fontColor(this.pal().accentSoft);
                                Text.padding({ left: 8, right: 8, top: 4, bottom: 4 });
                                Text.margin(2);
                                Text.backgroundColor(this.pal().surfaceAlt);
                                Text.borderRadius(6);
                                Text.onClick(() => {
                                    this.serverUrl = u;
                                    this.testMsg = '';
                                });
                            }, Text);
                            Text.pop();
                        };
                        this.forEachUpdateFunction(elmtId, this.recentServers, forEachItemGenFunction, (u: string) => u, false, false);
                    }, ForEach);
                    ForEach.pop();
                    Flex.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(1892:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.testing ? '测试中…' : '测试连接');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(1893:9)", "entry");
            Button.layoutWeight(1);
            Button.constraintSize({ minHeight: 38 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.onClick(() => {
                this.testConnection();
            });
        }, Button);
        Button.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.testMsg.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.testMsg);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1903:9)", "entry");
                        Text.fontSize(12);
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.fontColor(this.testMsg.startsWith('✅') ? this.pal().successText : this.pal().warn);
                        Text.width('100%');
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '用户名', text: this.username });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(1908:7)", "entry");
            TextInput.onChange((v: string) => {
                this.username = v;
            });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
            TextInput.constraintSize({ minHeight: 46 });
            TextInput.borderRadius(12);
            TextInput.padding({ left: 12, right: 12 });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '密码' });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(1914:7)", "entry");
            TextInput.type(InputType.Password);
            TextInput.onChange((v: string) => {
                this.password = v;
            });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
            TextInput.constraintSize({ minHeight: 46 });
            TextInput.borderRadius(12);
            TextInput.padding({ left: 12, right: 12 });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.errMsg.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.errMsg);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1923:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().dangerText);
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('登录');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(1927:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 44 });
            Button.backgroundColor(this.pal().accent);
            Button.fontColor(this.pal().onAccent);
            Button.onClick(() => {
                this.doLogin();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('注册（仅服务端允许时）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(1932:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.onClick(() => {
                this.doRegister();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
            Text.create('渲染自检（排查渲染问题用）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1938:7)", "entry");
            // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
            Text.fontSize(12);
            // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
            Text.fontColor(this.pal().accentSoft);
            // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
            Text.margin({ top: 8 });
            // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
            Text.onClick(() => {
                this.showSelfCheck = true;
            });
        }, Text);
        // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
        Text.pop();
        Column.pop();
    }
    ChatView(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(1950:5)", "entry");
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 顶栏
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(1952:7)", "entry");
            // 顶栏
            Row.width('100%');
            // 顶栏
            Row.constraintSize({ minHeight: 56 });
            // 顶栏
            Row.padding({ left: 4, right: 4 });
            // 顶栏
            Row.backgroundColor(this.pal().surfaceAlt);
            // 顶栏
            Row.id('xbot-header');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('☰');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1953:9)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
            Text.onClick(() => {
                this.openDrawer();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(1956:9)", "entry");
            Column.layoutWeight(1);
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.currentChat.length > 0 ? this.labelOf(this.currentChat) : 'xbot');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1957:11)", "entry");
            Text.fontSize(15);
            Text.fontColor(this.pal().textPrimary);
            Text.maxLines(1);
            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.busy ? '运行中…' : '空闲');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1959:11)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.busy ? this.pal().warn : this.pal().textMuted);
        }, Text);
        Text.pop();
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.queue.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`队列 ${this.queue.length}`);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1966:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().warn);
                        Text.padding(8);
                        Text.onClick(() => {
                            this.showQueue = true;
                        });
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('⊞');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1972:9)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
            Text.onClick(() => {
                this.openPlugins();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('⚙');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(1975:9)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
            Text.onClick(() => {
                this.anim(() => {
                    this.showSettings = true;
                });
            });
        }, Text);
        Text.pop();
        // 顶栏
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 加载失败且列表为空 ⇒ 明确提示 + 重试（网络/代理故障时界面必须自解释）
            if (this.rows.length === 0 && this.loadErr.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 8 });
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(1986:9)", "entry");
                        Column.width('100%');
                        Column.padding(16);
                        Column.alignItems(HorizontalAlign.Start);
                        Column.backgroundColor(this.pal().surfaceAlt);
                        Column.borderRadius(10);
                        Column.margin({ left: 12, right: 12, top: 12 });
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(loadErrTitle(this.loadErr));
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1987:11)", "entry");
                        Text.fontSize(14);
                        Text.fontColor(this.pal().dangerText);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.loadErr);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1988:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.maxLines(4);
                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(loadErrHint(this.loadErr));
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(1990:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                        Text.maxLines(3);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // 判据与标题同一处：401 给「重新登录」，其余给「重试」
                        Button.createWithLabel(needsRelogin(this.loadErr) ? '重新登录' : (needsSessionRefresh(this.loadErr) ? '刷新会话列表' : '重试'));
                        Button.debugLine("entry/src/main/ets/pages/Index.ets(1993:11)", "entry");
                        // 判据与标题同一处：401 给「重新登录」，其余给「重试」
                        Button.constraintSize({ minHeight: 38 });
                        // 判据与标题同一处：401 给「重新登录」，其余给「重试」
                        Button.backgroundColor(this.pal().accent);
                        // 判据与标题同一处：401 给「重新登录」，其余给「重试」
                        Button.onClick(() => {
                            if (needsRelogin(this.loadErr)) {
                                this.handleAuthExpired();
                            }
                            else if (needsSessionRefresh(this.loadErr)) {
                                this.recoverMissingSession();
                            }
                            else {
                                this.retryLoad();
                            }
                        });
                    }, Button);
                    // 判据与标题同一处：401 给「重新登录」，其余给「重试」
                    Button.pop();
                    Column.pop();
                });
            }
            // 空态：没有消息、没有错误、也不在跑 —— 给友好的起步引导（而不是一片黑洞）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 空态：没有消息、没有错误、也不在跑 —— 给友好的起步引导（而不是一片黑洞）
            if (this.rows.length === 0 && this.loadErr.length === 0 && !this.busy
                && !this.loadingMore && this.currentChat.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('xbot-empty-state')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Column.create({ space: 10 });
                            Column.debugLine("entry/src/main/ets/pages/Index.ets(2011:9)", "entry");
                            Column.width('100%');
                            Column.layoutWeight(1);
                            Column.justifyContent(FlexAlign.Center);
                            Column.id('xbot-empty-state');
                        }, Column);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('✦');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2012:11)", "entry");
                            Context.animation({ duration: 1400, curve: Curve.EaseInOut });
                            Text.fontSize(44);
                            Text.fontColor(this.pal().accent);
                            Text.opacity(this.pulseOn ? 1 : 0.55);
                            Context.animation(null);
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('开始对话');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2015:11)", "entry");
                            Text.fontSize(18);
                            Text.fontColor(this.pal().textPrimary);
                            Text.fontWeight(FontWeight.Medium);
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('直接说需求；也可以用 / 选命令、@ 提文件、📎 加附件');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2016:11)", "entry");
                            Text.fontSize(12);
                            Text.fontColor(this.pal().textMuted);
                            Text.textAlign(TextAlign.Center);
                            Text.padding({ left: 32, right: 32 });
                        }, Text);
                        Text.pop();
                        Column.pop();
                    }
                });
            }
            // 骨架屏：历史还没到时给"内容即将出现"的观感（比裸转圈自然）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 骨架屏：历史还没到时给"内容即将出现"的观感（比裸转圈自然）
            if (!this.historyLoading && this.currentChat.length > 0 && this.rows.length === 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('xbot-skeleton')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Column.create({ space: 10 });
                            Column.debugLine("entry/src/main/ets/pages/Index.ets(2026:9)", "entry");
                            Column.width('100%');
                            Column.layoutWeight(1);
                            Column.padding({ left: 4, right: 4, top: 12 });
                            Column.id('xbot-skeleton');
                        }, Column);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            ForEach.create();
                            const forEachItemGenFunction = _item => {
                                const i = _item;
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Row.create({ space: 8 });
                                    Row.debugLine("entry/src/main/ets/pages/Index.ets(2028:13)", "entry");
                                    Row.width('100%');
                                }, Row);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Circle.create({ width: 26, height: 26 });
                                    Circle.debugLine("entry/src/main/ets/pages/Index.ets(2029:15)", "entry");
                                    Circle.fill(this.pal().surfaceHi);
                                }, Circle);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Column.create({ space: 6 });
                                    Column.debugLine("entry/src/main/ets/pages/Index.ets(2030:15)", "entry");
                                    Column.layoutWeight(1);
                                    Column.alignItems(HorizontalAlign.Start);
                                }, Column);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Row.create();
                                    Row.debugLine("entry/src/main/ets/pages/Index.ets(2031:17)", "entry");
                                    Row.width(i % 2 === 0 ? '72%' : '54%');
                                    Row.height(10);
                                    Row.backgroundColor(this.pal().surfaceHi);
                                    Row.borderRadius(5);
                                }, Row);
                                Row.pop();
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Row.create();
                                    Row.debugLine("entry/src/main/ets/pages/Index.ets(2033:17)", "entry");
                                    Context.animation({ duration: 900, curve: Curve.EaseInOut });
                                    Row.width(i % 2 === 0 ? '46%' : '64%');
                                    Row.height(10);
                                    Row.backgroundColor(this.pal().surfaceHi);
                                    Row.borderRadius(5);
                                    Row.opacity(this.pulseOn ? 0.85 : 0.45);
                                    Context.animation(null);
                                }, Row);
                                Row.pop();
                                Column.pop();
                                Row.pop();
                            };
                            this.forEachUpdateFunction(elmtId, [0, 1, 2, 3], forEachItemGenFunction, (i: number) => `sk-${i}`, false, false);
                        }, ForEach);
                        ForEach.pop();
                        Column.pop();
                    }
                });
            }
            // 消息列表
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 消息列表
            List.create({ scroller: this.listScroller });
            List.debugLine("entry/src/main/ets/pages/Index.ets(2046:7)", "entry");
            // 消息列表
            List.layoutWeight(1);
            // 消息列表
            List.width('100%');
            // 消息列表
            List.edgeEffect(EdgeEffect.Spring);
            // 消息列表
            List.padding({ left: 8, right: 8 });
            // 消息列表
            List.opacity(this.listAlpha);
            // 消息列表
            List.cachedCount(4);
            // 消息列表
            List.onScrollIndex((start: number, end: number) => {
                this.atBottom = end >= listItemCount(this.hasMore, this.loadingMore, this.rowDs.count(), this.busy || this.liveOn) - 1;
            });
            // 消息列表
            List.id('xbot-list');
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.hasMore || this.loadingMore) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        const itemCreation = (elmtId, isInitialRender) => {
                            ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                            itemCreation2(elmtId, isInitialRender);
                            if (!isInitialRender) {
                                ListItem.pop();
                            }
                            ViewStackProcessor.StopGetAccessRecording();
                        };
                        const itemCreation2 = (elmtId, isInitialRender) => {
                            ListItem.create(deepRenderFunction, true);
                            ListItem.debugLine("entry/src/main/ets/pages/Index.ets(2048:11)", "entry");
                        };
                        const deepRenderFunction = (elmtId, isInitialRender) => {
                            itemCreation(elmtId, isInitialRender);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create();
                                Row.debugLine("entry/src/main/ets/pages/Index.ets(2049:13)", "entry");
                                Row.width('100%');
                                Row.justifyContent(FlexAlign.Center);
                                Row.padding(10);
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                If.create();
                                if (this.loadingMore) {
                                    this.ifElseBranchUpdateFunction(0, () => {
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            LoadingProgress.create();
                                            LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(2051:17)", "entry");
                                            LoadingProgress.width(16);
                                            LoadingProgress.height(16);
                                            LoadingProgress.color(this.pal().accent);
                                        }, LoadingProgress);
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create('加载更早消息…');
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2052:17)", "entry");
                                            Text.fontSize(12);
                                            Text.fontColor(this.pal().textSecondary);
                                            Text.margin({ left: 6 });
                                        }, Text);
                                        Text.pop();
                                    });
                                }
                                else {
                                    this.ifElseBranchUpdateFunction(1, () => {
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create('↑ 加载更早消息');
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2054:17)", "entry");
                                            Text.fontSize(12);
                                            Text.fontColor(this.pal().accentSoft);
                                            Text.onClick(() => {
                                                this.loadMore();
                                            });
                                        }, Text);
                                        Text.pop();
                                    });
                                }
                            }, If);
                            If.pop();
                            Row.pop();
                            ListItem.pop();
                        };
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        ListItem.pop();
                    }
                });
            }
            // 行窗口：`List` + `ForEach` 会**一次性构建全部行**（每行 ≤16 个迭代块 × Markdown）
            // ⇒ 几十行就是几千个节点（真机"很卡、交互差"的主因之一）。只渲染末尾 rowLimit 行，
            // 更早的按批放开。
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 行窗口：`List` + `ForEach` 会**一次性构建全部行**（每行 ≤16 个迭代块 × Markdown）
            // ⇒ 几十行就是几千个节点（真机"很卡、交互差"的主因之一）。只渲染末尾 rowLimit 行，
            // 更早的按批放开。
            if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        const itemCreation = (elmtId, isInitialRender) => {
                            ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                            itemCreation2(elmtId, isInitialRender);
                            if (!isInitialRender) {
                                ListItem.pop();
                            }
                            ViewStackProcessor.StopGetAccessRecording();
                        };
                        const itemCreation2 = (elmtId, isInitialRender) => {
                            ListItem.create(deepRenderFunction, true);
                            ListItem.debugLine("entry/src/main/ets/pages/Index.ets(2067:11)", "entry");
                        };
                        const deepRenderFunction = (elmtId, isInitialRender) => {
                            itemCreation(elmtId, isInitialRender);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create();
                                Row.debugLine("entry/src/main/ets/pages/Index.ets(2068:13)", "entry");
                                Row.width('100%');
                                Row.justifyContent(FlexAlign.Center);
                                Row.padding(10);
                                Row.onClick(() => {
                                    this.rowLimit += MAX_ROWS_VISIBLE;
                                    this.syncRowDs();
                                });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(`↑ 显示更早的 ${hiddenRowCount(this.rows.length, this.rowLimit)} 条`);
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2069:15)", "entry");
                                Text.fontSize(12);
                                Text.fontColor(this.pal().accentSoft);
                            }, Text);
                            Text.pop();
                            Row.pop();
                            ListItem.pop();
                        };
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        ListItem.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        {
            const __lazyForEachItemGenFunction = _item => {
                const row = _item;
                {
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(() => { }, false);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(2080:11)", "entry");
                    };
                    const observedDeepRender = () => {
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        this.ChatRowBody.bind(this)(row);
                        ListItem.pop();
                    };
                    observedDeepRender();
                }
            };
            const __lazyForEachItemIdFunc = (row: ChatRow) => sessionScopedRowKey(this.currentChat, row);
            LazyForEach.create("1", this, this.rowDs, __lazyForEachItemGenFunction, __lazyForEachItemIdFunc);
            LazyForEach.pop();
        }
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // ── live 进行中块（LazyForEach 之外，@State 直驱 ⇒ 流式/打字机/工具必然渲染）──
            if (this.liveTailHasContent()) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        const itemCreation = (elmtId, isInitialRender) => {
                            ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                            itemCreation2(elmtId, isInitialRender);
                            if (!isInitialRender) {
                                ListItem.pop();
                            }
                            ViewStackProcessor.StopGetAccessRecording();
                        };
                        const itemCreation2 = (elmtId, isInitialRender) => {
                            ListItem.create(deepRenderFunction, true);
                            ListItem.debugLine("entry/src/main/ets/pages/Index.ets(2087:11)", "entry");
                        };
                        const deepRenderFunction = (elmtId, isInitialRender) => {
                            itemCreation(elmtId, isInitialRender);
                            {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    if (isInitialRender) {
                                        let componentCall = new 
                                        // ⚠️ 打字机（20Hz）状态在**这个子组件内部** —— 否则每拍会重跑整页 build，
                                        // 把系统 spinner 都拖到 2Hz（真机"卡的要死 + spinner 半秒动一次"的根因）
                                        LiveTailView(this, {
                                            text: this.liveText,
                                            reasoning: this.liveReasoning,
                                            tools: this.liveTools,
                                            paused: this.appPaused,
                                            theme: this.themeName,
                                            fontScale: this.fontScale(),
                                            wrapCode: this.wrapCode(),
                                            onImage: (src: string) => {
                                                this.openImage(src);
                                            },
                                            loadImage: (src: string) => {
                                                return this.loadImageBytes(src);
                                            },
                                            onToolLongPress: (name: string) => {
                                                this.openCtx('tool', this.liveRowIdOf(), this.liveIterNo, name);
                                            },
                                        }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 2090, col: 13 });
                                        ViewPU.create(componentCall);
                                        let paramsLambda = () => {
                                            return {
                                                text: this.liveText,
                                                reasoning: this.liveReasoning,
                                                tools: this.liveTools,
                                                paused: this.appPaused,
                                                theme: this.themeName,
                                                fontScale: this.fontScale(),
                                                wrapCode: this.wrapCode(),
                                                onImage: (src: string) => {
                                                    this.openImage(src);
                                                },
                                                loadImage: (src: string) => {
                                                    return this.loadImageBytes(src);
                                                },
                                                onToolLongPress: (name: string) => {
                                                    this.openCtx('tool', this.liveRowIdOf(), this.liveIterNo, name);
                                                }
                                            };
                                        };
                                        componentCall.paramsGenerator_ = paramsLambda;
                                    }
                                    else {
                                        this.updateStateVarsOfChildByElmtId(elmtId, {
                                            text: this.liveText,
                                            reasoning: this.liveReasoning,
                                            tools: this.liveTools,
                                            paused: this.appPaused,
                                            theme: this.themeName,
                                            fontScale: this.fontScale(),
                                            wrapCode: this.wrapCode()
                                        });
                                    }
                                }, { name: "LiveTailView" });
                            }
                            ListItem.pop();
                        };
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        ListItem.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.busy && !this.liveTailHasContent()) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        const itemCreation = (elmtId, isInitialRender) => {
                            ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                            itemCreation2(elmtId, isInitialRender);
                            if (!isInitialRender) {
                                ListItem.pop();
                            }
                            ViewStackProcessor.StopGetAccessRecording();
                        };
                        const itemCreation2 = (elmtId, isInitialRender) => {
                            ListItem.create(deepRenderFunction, true);
                            ListItem.debugLine("entry/src/main/ets/pages/Index.ets(2112:11)", "entry");
                        };
                        const deepRenderFunction = (elmtId, isInitialRender) => {
                            itemCreation(elmtId, isInitialRender);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create({ space: 8 });
                                Row.debugLine("entry/src/main/ets/pages/Index.ets(2113:13)", "entry");
                                Row.padding({ left: 14, top: 8, bottom: 8 });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                LoadingProgress.create();
                                LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(2114:15)", "entry");
                                LoadingProgress.width(16);
                                LoadingProgress.height(16);
                                LoadingProgress.color(this.pal().accent);
                            }, LoadingProgress);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('思考中…');
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2115:15)", "entry");
                                Context.animation({ duration: 600, curve: Curve.EaseInOut });
                                Text.fontSize(13);
                                Text.fontColor(this.pal().textSecondary);
                                Text.opacity(this.pulseOn ? 1 : 0.45);
                                Context.animation(null);
                            }, Text);
                            Text.pop();
                            Row.pop();
                            ListItem.pop();
                        };
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        ListItem.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        // 消息列表
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 不在底部时给一个「回到最新」（列表很长时不用一路滑）
            if (!this.atBottom && this.rows.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create();
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(2136:9)", "entry");
                        Row.width('100%');
                        Row.justifyContent(FlexAlign.Center);
                        Row.padding({ top: 2, bottom: 2 });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('↓ 回到最新');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2137:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textPrimary);
                        Text.padding({ left: 12, right: 12, top: 7, bottom: 7 });
                        Text.backgroundColor(this.pal().accentDeep);
                        Text.borderRadius(16);
                        ViewStackProcessor.visualState("pressed");
                        Text.opacity(0.75);
                        ViewStackProcessor.visualState("normal");
                        Text.opacity(1);
                        ViewStackProcessor.visualState();
                        Text.onClick(() => {
                            this.listScroller.scrollEdge(Edge.Bottom);
                            this.atBottom = true;
                        });
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            // 状态栏：模型 · token 用量 · todos · goal（点开看全部；全部来自服务端权威值）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 状态栏：模型 · token 用量 · todos · goal（点开看全部；全部来自服务端权威值）
            if (this.statusBarText().length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 10 });
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(2153:9)", "entry");
                        Row.width('100%');
                        Row.padding({ left: 10, right: 10, top: 4, bottom: 2 });
                        Row.onClick(() => {
                            this.anim(() => {
                                this.showStatus = true;
                            });
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.statusBarText());
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2154:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                        Text.layoutWeight(1);
                        Text.maxLines(1);
                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.todoCount() > 0 || this.goalLine().length > 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('详情');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(2158:13)", "entry");
                                    Text.fontSize(11);
                                    Text.fontColor(this.pal().accentSoft);
                                    Text.padding({ left: 6, right: 6 });
                                }, Text);
                                Text.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                            });
                        }
                    }, If);
                    If.pop();
                    Row.pop();
                });
            }
            // 弱网：连接断开时明确告知（并说明恢复后会自动补齐，避免用户重复发）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 弱网：连接断开时明确告知（并说明恢复后会自动补齐，避免用户重复发）
            if (this.connState === 'reconnecting' || this.connState === 'connecting') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(2171:9)", "entry");
                        Row.width('100%');
                        Row.padding({ left: 12, right: 12, top: 6, bottom: 6 });
                        Row.backgroundColor(this.pal().warnBg);
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(2172:11)", "entry");
                        LoadingProgress.width(14);
                        LoadingProgress.height(14);
                        LoadingProgress.color(this.pal().warn);
                    }, LoadingProgress);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('连接断开，正在重连…（恢复后自动补齐消息）');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2173:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().warn);
                        Text.layoutWeight(1);
                        Text.maxLines(1);
                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            // 上次发送失败 ⇒ 一键重试（不必重新打字）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 上次发送失败 ⇒ 一键重试（不必重新打字）
            if (this.failedSend.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 8 });
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(2183:9)", "entry");
                        Row.width('100%');
                        Row.padding({ left: 10, right: 6, top: 6, bottom: 2 });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('上次发送失败');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2184:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().dangerText);
                        Text.layoutWeight(1);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('重试');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2185:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().warn);
                        Text.padding(6);
                        ViewStackProcessor.visualState("pressed");
                        Text.opacity(0.7);
                        ViewStackProcessor.visualState("normal");
                        Text.opacity(1);
                        ViewStackProcessor.visualState();
                        Text.onClick(() => {
                            const t: string = this.failedSend;
                            this.failedSend = '';
                            this.draft = t;
                            this.sendDraft();
                        });
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('丢弃');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2193:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.padding(6);
                        Text.onClick(() => {
                            this.failedSend = '';
                        });
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            // 输入补全（/ 命令 或 @ 文件）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 输入补全（/ 命令 或 @ 文件）
            if (this.cmdToken.length > 0 && (this.cmdItems.length > 0 || this.fsEntries.length > 0)) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 2 });
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(2203:9)", "entry");
                        Column.width('100%');
                        Column.padding({ left: 8, right: 8, bottom: 4 });
                        Column.backgroundColor(this.pal().appBg);
                        Column.borderRadius(8);
                        Column.border({ width: 1, color: this.pal().border });
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.cmdItems.length > 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = _item => {
                                        const c = _item;
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Row.create({ space: 8 });
                                            Row.debugLine("entry/src/main/ets/pages/Index.ets(2206:15)", "entry");
                                            Row.width('100%');
                                            Row.padding({ left: 10, right: 10, top: 7, bottom: 7 });
                                            Row.backgroundColor(this.pal().surface);
                                            Row.borderRadius(6);
                                            Row.onClick(() => {
                                                this.pickCommand(c.name);
                                            });
                                        }, Row);
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(c.name);
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2207:17)", "entry");
                                            Text.fontSize(13);
                                            Text.fontColor(this.pal().accentText);
                                            Text.constraintSize({ maxWidth: 150 });
                                            Text.maxLines(1);
                                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                        }, Text);
                                        Text.pop();
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(c.desc);
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2209:17)", "entry");
                                            Text.fontSize(11);
                                            Text.fontColor(this.pal().textMuted);
                                            Text.layoutWeight(1);
                                            Text.maxLines(1);
                                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                        }, Text);
                                        Text.pop();
                                        Row.pop();
                                    };
                                    this.forEachUpdateFunction(elmtId, this.cmdItems.slice(0, 6), forEachItemGenFunction, (c: CommandItem) => `cc-${c.name}`, false, false);
                                }, ForEach);
                                ForEach.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                            });
                        }
                    }, If);
                    If.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.fsEntries.length > 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = _item => {
                                        const e = _item;
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Row.create({ space: 8 });
                                            Row.debugLine("entry/src/main/ets/pages/Index.ets(2221:15)", "entry");
                                            Row.width('100%');
                                            Row.padding({ left: 10, right: 10, top: 7, bottom: 7 });
                                            Row.backgroundColor(this.pal().surface);
                                            Row.borderRadius(6);
                                            Row.onClick(() => {
                                                this.pickFile(e);
                                            });
                                        }, Row);
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(e.isDir ? '📁' : '📄');
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2222:17)", "entry");
                                            Text.fontSize(12);
                                        }, Text);
                                        Text.pop();
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(e.name);
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2223:17)", "entry");
                                            Text.fontSize(13);
                                            Text.fontColor(this.pal().textPrimary);
                                            Text.layoutWeight(1);
                                            Text.maxLines(1);
                                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                        }, Text);
                                        Text.pop();
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(this.fsDir);
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2225:17)", "entry");
                                            Text.fontSize(10);
                                            Text.fontColor(this.pal().textMuted);
                                            Text.maxLines(1);
                                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                            Text.constraintSize({ maxWidth: 120 });
                                        }, Text);
                                        Text.pop();
                                        Row.pop();
                                    };
                                    this.forEachUpdateFunction(elmtId, this.fsEntries.slice(0, 8), forEachItemGenFunction, (e: FsEntry) => `fe-${e.name}#${e.isDir}`, false, false);
                                }, ForEach);
                                ForEach.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                            });
                        }
                    }, If);
                    If.pop();
                    Column.pop();
                });
            }
            // 会话标签（池里的会话，切回瞬时；● 表示该会话正在跑）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 会话标签（池里的会话，切回瞬时；● 表示该会话正在跑）
            if (this.poolOrder.length > 1) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Scroll.create();
                        Scroll.debugLine("entry/src/main/ets/pages/Index.ets(2244:9)", "entry");
                        Scroll.scrollable(ScrollDirection.Horizontal);
                        Scroll.width('100%');
                        Scroll.padding({ left: 10, right: 10, top: 6 });
                    }, Scroll);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(2245:11)", "entry");
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const cid = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create({ space: 4 });
                                Row.debugLine("entry/src/main/ets/pages/Index.ets(2247:15)", "entry");
                                Row.padding({ left: 8, right: 6, top: 4, bottom: 4 });
                                Row.backgroundColor(cid === this.currentChat ? this.pal().accentDeep : this.pal().surfaceAlt);
                                Row.borderRadius(6);
                                Row.onClick(() => {
                                    if (cid !== this.currentChat) {
                                        this.switchSession(cid);
                                    }
                                });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(this.tabLabel(cid));
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2248:17)", "entry");
                                Text.fontSize(11);
                                Text.fontColor(cid === this.currentChat ? this.pal().onAccent : this.pal().textSecondary);
                                Text.maxLines(1);
                                Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                Text.constraintSize({ maxWidth: 90 });
                            }, Text);
                            Text.pop();
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                If.create();
                                if (this.tabRunning(cid)) {
                                    this.ifElseBranchUpdateFunction(0, () => {
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create('●');
                                            Text.debugLine("entry/src/main/ets/pages/Index.ets(2253:19)", "entry");
                                            Text.fontSize(9);
                                            Text.fontColor(this.pal().successText);
                                        }, Text);
                                        Text.pop();
                                    });
                                }
                                else {
                                    this.ifElseBranchUpdateFunction(1, () => {
                                    });
                                }
                            }, If);
                            If.pop();
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('✕');
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2255:17)", "entry");
                                Text.fontSize(10);
                                Text.fontColor(this.pal().textMuted);
                                Text.onClick(() => {
                                    this.closeTab(cid);
                                });
                            }, Text);
                            Text.pop();
                            Row.pop();
                        };
                        this.forEachUpdateFunction(elmtId, this.poolOrder, forEachItemGenFunction, (cid: string) => `tab-${cid}#${cid === this.currentChat}#${this.tabRunning(cid)}`, false, false);
                    }, ForEach);
                    ForEach.pop();
                    Row.pop();
                    Scroll.pop();
                });
            }
            // 附件 chips：每条独立状态（⏳ 上传中 / 📎 已就绪 / ⚠ 失败可重试），✕ 移除
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 附件 chips：每条独立状态（⏳ 上传中 / 📎 已就绪 / ⚠ 失败可重试），✕ 移除
            if (this.attachments.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 4 });
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(2277:9)", "entry");
                        Column.width('100%');
                        Column.padding({ left: 10, right: 4, top: 6 });
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, i: number) => {
                            const it = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create({ space: 6 });
                                Row.debugLine("entry/src/main/ets/pages/Index.ets(2279:13)", "entry");
                                Row.width('100%');
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(attachChipText(it));
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2280:15)", "entry");
                                Text.fontSize(12);
                                Text.fontColor(it.status === ATTACH_FAILED ? this.pal().dangerText : this.pal().accentSoft);
                                Text.layoutWeight(1);
                                Text.maxLines(1);
                                Text.wordBreak(WordBreak.BREAK_ALL);
                            }, Text);
                            Text.pop();
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(it.status === ATTACH_FAILED ? '重试' : '✕');
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(2284:15)", "entry");
                                Text.fontSize(12);
                                Text.fontColor(it.status === ATTACH_FAILED ? this.pal().warn : this.pal().dangerText);
                                Text.padding(6);
                                Text.onClick(() => {
                                    if (it.status === ATTACH_FAILED) {
                                        this.retryAttachment(it.uid);
                                    }
                                    else {
                                        this.removeAttachment(it.uid);
                                    }
                                });
                            }, Text);
                            Text.pop();
                            Row.pop();
                        };
                        this.forEachUpdateFunction(elmtId, this.attachments, forEachItemGenFunction, (it: AttachItem, i: number) => `${it.uid}#${it.status}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                    Column.pop();
                });
            }
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(2302:7)", "entry");
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.width('100%');
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.padding({ left: 8, right: 8, top: 8, bottom: 8 });
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.backgroundColor(this.pal().surface);
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.borderRadius(22);
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.border({ width: 1, color: this.composerFocused ? this.pal().accent : this.pal().border });
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.shadow({ radius: 14, color: '#1A000000', offsetX: 0, offsetY: 3 });
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.margin({ left: 8, right: 8, top: 2, bottom: 8 });
            // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
            Row.id('xbot-composer');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('📎');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(2303:9)", "entry");
            Text.fontSize(19);
            Text.fontColor(this.pal().accentSoft);
            Text.padding(6);
            ViewStackProcessor.visualState("pressed");
            Text.opacity(0.6);
            ViewStackProcessor.visualState("normal");
            Text.opacity(1);
            ViewStackProcessor.visualState();
            Text.onClick(() => {
                this.pickFiles();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('▣');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(2308:9)", "entry");
            Text.fontSize(19);
            Text.fontColor(this.pal().accentSoft);
            Text.padding(6);
            ViewStackProcessor.visualState("pressed");
            Text.opacity(0.6);
            ViewStackProcessor.visualState("normal");
            Text.opacity(1);
            ViewStackProcessor.visualState();
            Text.onClick(() => {
                this.pickImages();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextArea.create({ placeholder: '发消息…', text: this.draft });
            TextArea.debugLine("entry/src/main/ets/pages/Index.ets(2313:9)", "entry");
            TextArea.onChange((v: string) => {
                this.draft = v;
                this.refreshCompletion(v);
                this.scheduleDraftSave(v);
            });
            TextArea.enterKeyType(enterSends(this.sendKeyMode()) ? EnterKeyType.Send : EnterKeyType.NEW_LINE);
            TextArea.onPaste((value: string, event: PasteEvent) => {
                this.pasteImage();
            });
            TextArea.onFocus(() => {
                this.composerFocused = true;
            });
            TextArea.onBlur(() => {
                this.composerFocused = false;
            });
            TextArea.layoutWeight(1);
            TextArea.constraintSize({ minHeight: 40, maxHeight: 150 });
            TextArea.backgroundColor('#00000000');
            TextArea.fontColor(this.pal().textPrimary);
            TextArea.borderRadius(0);
            TextArea.padding({ left: 2, right: 2 });
            TextArea.onSubmit(() => {
                if (enterSends(this.sendKeyMode())) {
                    this.sendDraft();
                }
            });
        }, TextArea);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.busy) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(modeLabel(this.sendMode));
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(2338:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.sendMode === MODE_INTERRUPT ? this.pal().warn : this.pal().textSecondary);
                        Text.padding({ left: 8, right: 8, top: 8, bottom: 8 });
                        Text.backgroundColor(this.pal().surfaceAlt);
                        Text.borderRadius(8);
                        Text.border({ width: 1, color: this.sendMode === MODE_INTERRUPT ? this.pal().warn : this.pal().border });
                        Text.onClick(() => {
                            this.sendMode = toggleMode(this.sendMode);
                            this.toast(modeHint(this.sendMode));
                        });
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.runningNow() ? '停止' : '发送');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(2350:9)", "entry");
            Button.constraintSize({ minHeight: 38, minWidth: 76 });
            Button.borderRadius(19);
            Button.fontColor(this.pal().onAccent);
            Button.backgroundColor(this.pal().accent);
            Button.linearGradient({
                angle: 135,
                colors: this.runningNow()
                    ? [[this.pal().dangerBg, 0.0], [this.pal().dangerBg, 1.0]]
                    : [[this.pal().accent, 0.0], [this.pal().bubbleUser, 1.0]],
            });
            Button.shadow({ radius: 10, color: '#33000000', offsetX: 0, offsetY: 2 });
            ViewStackProcessor.visualState("pressed");
            Button.opacity(0.75);
            ViewStackProcessor.visualState("normal");
            Button.opacity(1);
            ViewStackProcessor.visualState();
            Button.onClick(() => {
                if (this.runningNow()) {
                    this.store?.cancel();
                }
                else {
                    this.sendDraft();
                }
            });
        }, Button);
        Button.pop();
        // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
        Row.pop();
        Column.pop();
    }
    // ── P7：会话管理 ─────────────────────────────────────────────────────────
    /** 抽屉里显示的会话（本地筛选：按名字/chat_id，大小写不敏感）。 */
    private filteredSessions(): SessionItem[] {
        const out: SessionItem[] = [];
        for (let i = 0; i < this.sessions.length; i++) {
            const s: SessionItem = this.sessions[i];
            const label: string = s.label !== undefined ? s.label : '';
            if (sessionMatches(label, s.chat_id, this.sessQuery)) {
                out.push(s);
            }
        }
        return out;
    }
    private sessionIds(): string[] {
        const out: string[] = [];
        for (let i = 0; i < this.sessions.length; i++) {
            out.push(this.sessions[i].chat_id);
        }
        return out;
    }
    private currentMenuSession(): SessionItem | undefined {
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].chat_id === this.sessMenuId) {
                return this.sessions[i];
            }
        }
        return undefined;
    }
    private menuLabel(): string {
        const s: SessionItem | undefined = this.currentMenuSession();
        return s === undefined ? '' : sessionLabel(s.label !== undefined ? s.label : '', s.chat_id);
    }
    /** 会话操作菜单项的可点状态（置顶/上移在顶部时置灰）。 */
    private menuCanMove(dir: string): boolean {
        return canMove(this.sessionIds(), this.sessMenuId, dir);
    }
    /** 执行会话操作（字符串码派发，@Builder 不能传闭包）。 */
    private async runSessAction(code: string): Promise<void> {
        const store: ChatStore | null = this.store;
        const id: string = this.sessMenuId;
        if (store === null || id.length === 0) {
            return;
        }
        if (code === 'delete') {
            // 二次确认：第一次点只切到"确认删除"态
            if (this.sessConfirmDelete !== id) {
                this.sessConfirmDelete = id;
                return;
            }
            this.sessMenuId = '';
            this.sessConfirmDelete = '';
            try {
                await store.deleteSession(id);
                this.toast('会话已删除');
            }
            catch (e) {
                this.toast(`删除失败: ${errText(e as Object)}`);
            }
            return;
        }
        if (code === MOVE_TOP || code === MOVE_UP || code === MOVE_DOWN) {
            this.sessMenuId = '';
            try {
                await store.reorderSessions(this.sessionIds(), id, code);
            }
            catch (e) {
                this.toast(`排序失败: ${errText(e as Object)}`);
            }
            return;
        }
        if (code === 'fork') {
            this.sessMenuId = '';
            const s: SessionItem | undefined = this.currentMenuSession();
            const base: string = s !== undefined ? sessionLabel(s.label !== undefined ? s.label : '', s.chat_id) : id;
            try {
                const newId: string = await store.forkSession(id, `${base} 分支`);
                await store.loadSessions();
                this.toast(`已分支为 ${newId}`);
                this.switchSession(newId);
            }
            catch (e) {
                this.toast(`分支失败: ${errText(e as Object)}`);
            }
            return;
        }
        if (code === 'rename') {
            this.renamingId = id;
            const s: SessionItem | undefined = this.currentMenuSession();
            this.renameText = s !== undefined && s.label !== undefined ? s.label : '';
            this.sessMenuId = '';
        }
    }
    /** 当前语义色板（**全页面唯一取色入口**；theme.ets 之外不再有颜色字面量）。 */
    private pal(): Palette {
        return paletteOf(this.themeName);
    }
    /**
       * 打字机驱动（用户语义）：
       *   · **正文任何时候都逐字**；但正文是 Markdown —— 逐字裁剪要按拍重解析整段文本，
       *     真机教训「打字机几秒动一次」正是 20 次/秒 × 上千字符的重解析把 UI 线程吃满。
       *     因此正文**每 3 拍推进一次（≈150ms）**：观感仍是逐字（6–7 次/秒），解析压力降 1/3。
       *   · **思考**（纯文本、代价低）：展开时每拍（50ms）逐字；**折叠时不推进**，
       *     只让「思考 N 字」的数字随流式跳动（用户明确要求）。
       */
    /** 该迭代是否"仍在进行"（显示流式光标）。 */
    /** 统一的"轻动效"入口（时长/曲线只有一处，避免每个面板各自为政）。 */
    private anim(run: () => void): void {
        Context.animateTo({ duration: 220, curve: Curve.Friction }, run);
    }
    /** 最近一个迭代号（流式光标只挂在最后一个迭代上）。 */
    private lastIterationNo(row: ChatRow): number {
        const n: number = row.iterations.length;
        return n > 0 ? row.iterations[n - 1].iteration : 0;
    }
    /** 面板/弹层的统一出入场：从下滑入 + 淡入（只用 transform/opacity）。 */
    private sheetTransition(): TransitionEffect {
        return TransitionEffect.translate({ y: 260 })
            .animation({ duration: 220, curve: Curve.Friction })
            .combine(TransitionEffect.OPACITY.animation({ duration: 180 }));
    }
    // ── P11：输入体验 ────────────────────────────────────────────────────────
    /**
     * 命令表（镜像服务端命令注册表 `agent/command_builtin.go` 的 `r.Register(...)`）。
     * 不发明命令：这里逐条对应服务端真实注册的 usage/description。
     */
    private commands(): CommandItem[] {
        const out: CommandItem[] = [];
        const rows: string[] = [
            '/new|开始新对话（归档记忆后重置）',
            '/version|显示版本信息',
            '/help|显示帮助',
            '/prompt [query]|预览完整提示词（不调用 LLM）',
            '/llm|查看当前解析到的订阅与模型',
            '/llms|列出所有个人 LLM 订阅',
            '/compress|手动触发上下文压缩',
            '/continue|继续上一轮被中断的对话（基于 DB 断点恢复）',
            '/usage|查看 token 用量统计',
            '/context|查看上下文统计',
            '/models|列出可选模型（带正常/离线/禁用状态）',
            '/settings|打开个人设置',
            '/goal clear|清除当前目标',
            '/cancel|取消当前回合',
        ];
        for (let i = 0; i < rows.length; i++) {
            const parts: string[] = rows[i].split('|');
            const c: CommandItem = new CommandItem();
            c.name = parts[0];
            c.desc = parts.length > 1 ? parts[1] : '';
            out.push(c);
        }
        return out;
    }
    /** 输入变化时刷新补全（`/` 命令优先，其次 `@` 文件）。 */
    private refreshCompletion(text: string): void {
        const slash: string = activeToken(text, '/');
        if (slash.length > 0) {
            this.cmdToken = slash;
            this.cmdItems = matchCommands(this.commands(), slash);
            this.fsEntries = [];
            return;
        }
        const at: string = activeToken(text, '@');
        if (at.length > 0) {
            this.cmdToken = at;
            this.cmdItems = [];
            const q: string = at.substring(1);
            // `@a/b` ⇒ 列 `/a/b` 的上一层；`@name` ⇒ 列上次用过的那一层
            const dir: string = q.indexOf('/') > 0 || q.indexOf('/') === 0 ? parentDir(q) : this.fsDir;
            this.loadFs(dir);
            return;
        }
        this.cmdToken = '';
        this.cmdItems = [];
        this.fsEntries = [];
    }
    private async loadFs(dir: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            this.fsDir = dir.length > 0 ? dir : '/';
            this.fsEntries = await store.listFs(this.fsDir);
        }
        catch (e) {
            this.fsEntries = [];
        }
    }
    /** 选中一条命令候选。 */
    private pickCommand(name: string): void {
        this.draft = applyCommand(this.draft, this.cmdToken, name);
        this.refreshCompletion(this.draft);
        this.buzz();
    }
    /** 选中一条文件候选（目录继续下钻，文件补完整）。 */
    private pickFile(e: FsEntry): void {
        this.draft = applyMention(this.draft, this.cmdToken, e.name, e.isDir);
        if (e.isDir) {
            this.loadFs(joinPath(this.fsDir, e.name));
        }
        this.refreshCompletion(this.draft);
        this.buzz();
    }
    /** 短震动反馈（无马达/无权限时静默 —— 不打断任何流程）。 */
    private buzz(): void {
        if (!parseBool(settingOf(this.settings, KEY_CODE_WRAP), true)) {
            // 复用不了别的开关，这里保持始终开启：手感反馈是"世界第一流畅"的一部分
        }
        try {
            vibrator.startVibration({ type: 'time', duration: 12 }, { id: 0, usage: 'unknown' })
                .catch(() => {
            });
        }
        catch (e) {
            // 无振动器件：忽略
        }
    }
    // ── P9：设置 ─────────────────────────────────────────────────────────────
    /** 当前字号缩放（来自设置；非法值回落 1）。 */
    private fontScale(): number {
        return fontScaleFrom(settingOf(this.settings, KEY_FONT_SCALE));
    }
    /** 代码是否自动换行（默认开）。 */
    private wrapCode(): boolean {
        return parseBool(settingOf(this.settings, KEY_CODE_WRAP), true);
    }
    /** 发送快捷键模式（默认 Enter 发送）。 */
    private sendKeyMode(): string {
        return normalizeSendKey(settingOf(this.settings, KEY_SEND_KEY));
    }
    private reasoningDefault(): boolean {
        return parseBool(settingOf(this.settings, KEY_REASONING_DEFAULT), false);
    }
    private async openPrefs(): Promise<void> {
        this.anim(() => {
            this.showPrefs = true;
        });
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            await store.loadSettings();
        }
        catch (e) {
            this.toast(`读取设置失败: ${errText(e as Object)}`);
        }
    }
    /** 改一项设置（立刻生效 + 写回服务端；失败回滚显示）。 */
    private async setSetting(key: string, value: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        const prev: string = settingOf(this.settings, key);
        const pairs: Record<string, string> = {};
        pairs[key] = value;
        this.settings[key] = value; // 乐观：界面立刻变
        try {
            await store.saveSettings(pairs);
            if (key === KEY_REASONING_DEFAULT) {
                this.showReasoning = parseBool(value, false);
                this.reasoningDefaultApplied = true;
            }
        }
        catch (e) {
            // 回滚显示（ArkTS 限制：不能用 Object.assign —— 受限标准库）
            const rollback: Record<string, string> = {};
            const ks: string[] = Object.keys(this.settings);
            for (let i = 0; i < ks.length; i++) {
                rollback[ks[i]] = this.settings[ks[i]];
            }
            rollback[key] = prev;
            this.settings = rollback;
            this.toast(`保存失败: ${errText(e as Object)}`);
        }
    }
    private readonlySettings(): string[] {
        return [KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE];
    }
    // ── P8：面板 ─────────────────────────────────────────────────────────────
    private panelCount(tab: string): number {
        if (tab === 'tasks') {
            return this.bgTasks.length;
        }
        if (tab === 'subs') {
            return this.subagents.length;
        }
        if (tab === 'runners') {
            return this.runners.length;
        }
        return this.cronTasks.length;
    }
    private panelTabLabel(tab: string): string {
        if (tab === 'tasks') {
            return `后台任务 ${this.panelCount(tab)}`;
        }
        if (tab === 'subs') {
            return `子代理 ${this.panelCount(tab)}`;
        }
        if (tab === 'runners') {
            return `Runner ${this.panelCount(tab)}`;
        }
        return `定时任务 ${this.panelCount(tab)}`;
    }
    private panelTabs(): string[] {
        return ['cron', 'tasks', 'subs', 'runners'];
    }
    /** 刷新当前标签页的数据（每个标签只拉自己那一个端点）。 */
    private async refreshPanel(): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null || this.panelBusy) {
            return;
        }
        this.panelBusy = true;
        try {
            if (this.panelTab === 'cron') {
                await store.loadCronTasks();
            }
            else if (this.panelTab === 'tasks') {
                await store.loadBgTasks();
            }
            else if (this.panelTab === 'runners') {
                await store.loadRunners();
            }
            else {
                await store.loadSessions(); // 子代理来自会话树
            }
        }
        catch (e) {
            this.toast(`加载失败: ${errText(e as Object)}`);
        }
        finally {
            this.panelBusy = false;
        }
    }
    /** 打开抽屉：立刻显示（不等网络），同时后台刷新会话列表（避免看到过期快照）。 */
    /**
     * 服务端权威的忙碌标记（会话树的 `running`）——与本地 busy 取或。
     *
     * 为什么必须这样：本地 `busy` 是事件驱动的快路径（SSE progress/idle），
     * 切会话、断线重连、或错过一条 idle 事件时它会漂移 ⇒ 界面出现
     * "idle 会话显示运行中 / busy 会话显示空闲"。会话树的 running 由服务端对账，
     * 是权威值（web 端同样以它为准）。
     */
    private serverRunning(): boolean {
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].chat_id === this.currentChat) {
                return this.sessions[i].running === true;
            }
        }
        return false;
    }
    /**
     * 界面统一的"是否在跑"。
     *
     * busy 本身已被 loadSessions 对账（SSE 事件快路径 + 会话树权威值）；
     * `serverRunning()` 只在**快照新鲜**（20s 内拉过会话树）时采信 ——
     * 过期的 running=true 快照曾把 idle 会话显示成"运行中"（真机）。
     */
    private runningNow(): boolean {
        if (this.busy) {
            return true;
        }
        const store: ChatStore | null = this.store;
        if (store === null) {
            return false;
        }
        if (Date.now() - store.sessionsFetchedAt > 20000) {
            return false;
        }
        return this.serverRunning();
    }
    /**
     * 准备内嵌 web UI：把会话 cookie 注入 ArkWeb 的 cookie 存储（httpOnly 由 ArkWeb 自己处理），
     * 再设地址 ⇒ 打开即已登录（与原生侧同一凭据，用户不用在 webview 里再登一次）。
     */
    private prepareWebUI(store: ChatStore): void {
        if (!this.useWebUI) {
            return;
        }
        const base: string = store.http.baseUrl;
        const cookie: string = store.http.exportSessionCookie();
        try {
            if (cookie.length > 0) {
                // 服务端 cookie 是 host-only；对根地址配置即可覆盖整站
                webview.WebCookieManager.configCookieSync(base + '/', cookie);
            }
            this.webCookieReady = true;
        }
        catch (e) {
            // 注入失败不阻塞：webview 里会落到登录页，用户可再登一次
            this.webCookieReady = false;
        }
        this.webUiUrl = base + '/';
    }
    /** 切换"内嵌完整 web UI / 原生界面"（写进设置，两端口径一致）。 */
    private async setSurface(useWeb: boolean): Promise<void> {
        this.useWebUI = useWeb;
        const store: ChatStore | null = this.store;
        if (useWeb && store !== null) {
            this.prepareWebUI(store);
            store.loadSettings().catch(() => {
                // 设置非关键路径
            });
        }
        if (this.webUiUrl.length > 0 && !useWeb) {
            // 切回原生时清掉 web 地址（卸载 ArkWeb，释放资源）
            this.webUiUrl = '';
        }
        if (store !== null) {
            const pairs: Record<string, string> = {};
            pairs[KEY_SURFACE] = useWeb ? 'web' : 'native';
            try {
                await store.saveSettings(pairs);
            }
            catch (e) {
                // 持久化失败不影响本次切换
            }
        }
    }
    private openDrawer(): void {
        this.showDrawer = true;
        const store: ChatStore | null = this.store;
        if (store !== null) {
            store.loadSessions().catch(() => {
                // 刷新失败保留旧列表（弱网下仍能看到上次的会话）
            });
        }
    }
    private openPanels(): void {
        this.anim(() => {
            this.showPanels = true;
        });
        this.refreshPanel();
    }
    private switchPanelTab(tab: string): void {
        this.panelTab = tab;
        this.refreshPanel();
    }
    private async removeCron(jobId: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null || jobId.length === 0) {
            return;
        }
        try {
            await store.removeCronTask(jobId);
            this.toast('定时任务已删除');
        }
        catch (e) {
            this.toast(`删除失败: ${errText(e as Object)}`);
        }
    }
    private nowMs(): number {
        return Date.now();
    }
    /** 在当前会话里搜索消息（服务端只检索当前会话 —— 不是全局搜索）。 */
    private async runSearch(): Promise<void> {
        const store: ChatStore | null = this.store;
        const q: string = this.sessQuery.trim();
        if (store === null || q.length === 0 || this.searchBusy) {
            return;
        }
        this.searchBusy = true;
        try {
            const hits: SearchHit[] = await store.searchMessages(q);
            this.searchHits = hits;
            this.anim(() => {
                this.showSearchHits = true;
            });
            if (hits.length === 0) {
                this.toast('当前会话里没有匹配的消息');
            }
        }
        catch (e) {
            this.toast(`搜索失败: ${errText(e as Object)}`);
        }
        finally {
            this.searchBusy = false;
        }
    }
    // ── 帧内变更判定（官方性能规范：避免无效刷新）──
    // ⚠️ 为什么必须做：`syncFrom` 每帧都跑，而 `this.rows = store.rows.slice()` 这类
    // **数组/对象赋值在 ArkUI 里一定触发重渲染**（哪怕内容没变）⇒ 每个 SSE 帧都整页重刷，
    // 滚动与流式同时卡。指纹是 O(n) 字符串比较（n = 窗口内行数），**任何变化都会改变指纹**，
    // 所以"指纹没变就不赋值"既省渲染又不可能漏更新。
    private rowsFp: string;
    private sessionsFp: string;
    private queueFp: string;
    private todosFp: string;
    private fingerprintRows(rows: ChatRow[], chatId: string): string {
        return rowsFpOf(rows, chatId); // 纯函数在 core/rowdiff（带会话身份，有判别测试）
    }
    private fingerprintSessions(items: SessionItem[], chatId: string): string {
        const parts: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const s: SessionItem = items[i];
            parts.push(`${s.chat_id}#${s.running === true ? 1 : 0}#${s.label !== undefined ? s.label : ''}`);
        }
        return scopedFingerprint(chatId, parts);
    }
    private fingerprintQueue(items: QueueItem[], chatId: string): string {
        const parts: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const it: QueueItem = items[i];
            // 字段都可选（协议里 msg_id/content 与 id/text 两套命名并存）⇒ 显式取值
            const id: string = it.msg_id !== undefined ? it.msg_id
                : (it.id !== undefined ? it.id : '');
            const body: string = it.content !== undefined ? it.content
                : (it.text !== undefined ? it.text : '');
            parts.push(`${id}#${body.length}`);
        }
        return scopedFingerprint(chatId, parts);
    }
    /** 把「当前该显示的行」推给数据源（行窗口 + 真虚拟化两层叠加）。 */
    private syncRowDs(): void {
        // ⚠️ **不能**把 live 行整行排除：那样 live 行里**已完成的迭代**就再也没有渲染位置，
        // 而列表尾的 LiveTail 只渲染"进行中的最后一个迭代" ⇒ 每完成一个迭代就消失一个，
        // 用户只能看到最新的那个（真机严重 bug）。
        // 正解：live 行**进列表**（其已完成迭代正常渲染），只是它的**最后一个迭代**
        // （= 进行中）由尾块承担 —— 渲染侧用 `isTailOwned` 互斥，不会画两遍。
        // 必须把**会话身份**一起交给数据源：否则两个会话同形时它会判「骨架未变」=> 零通知 =>
        // LazyForEach 保留上一个会话的条目（真机「所有会话都显示第一个会话的内容」）。
        this.rowDs.applyRows(tailRows(this.rows, this.rowLimit), this.currentChat);
    }
    /** 从 store 的 live 行提取进行中快照（正文/思考/工具，全部 @State 镜像）。 */
    private syncLiveTail(store: ChatStore): void {
        let liveRow: ChatRow | undefined = undefined;
        for (let i = store.rows.length - 1; i >= 0; i--) {
            const r: ChatRow = store.rows[i];
            if (r.role === 'assistant' && r.isLive) {
                liveRow = r;
                break;
            }
        }
        if (liveRow === undefined || liveRow.iterations.length === 0) {
            this.liveOn = false;
            this.liveText = '';
            this.liveReasoning = '';
            this.liveTools = [];
            this.liveIterNo = 0;
            this.liveRowTurn = 0;
            this.lastLiveLen = 0;
            return;
        }
        const it: HistoryIteration = liveRow.iterations[liveRow.iterations.length - 1];
        this.liveOn = true;
        this.liveText = displayContent(it);
        this.liveReasoning = displayReasoning(it);
        this.liveTools = it.tools !== undefined ? it.tools.slice() : [];
        this.liveIterNo = it.iteration;
        this.liveRowTurn = liveRow.turnID;
        // ── 渐入特效（用户要求）──
        // 为什么不用"逐字裁剪"：那要每 50ms 重新解析整段 Markdown 并重建节点
        // （代价 O(文本长度)），真机上直接饱和 UI 线程 ⇒ 用户看到的正是
        // "打字机几秒动一次"。渐入只动 opacity，代价恒定。
    }
    /** live 尾块是否有任何可显示内容（决定 busy 占位符是否让位 —— 恰好一个指示器）。 */
    private liveTailHasContent(): boolean {
        return this.liveOn && (this.liveText.length > 0 || this.liveReasoning.length > 0
            || this.liveTools.length > 0);
    }
    /** 打字机可见正文（安全回退：定时器未跑 ⇒ 显示全文，绝不让内容不可见）。 */
    /** 打字机可见正文（安全回退：定时器未跑 ⇒ 全文，绝不让内容不可见）。 */
    /** 打字机可见思考（同上）。 */
    // ── P5 消息操作（长按菜单）─────────────────────────────────────────────────
    //
    // 对齐 Web（`MessageActions.tsx`）：复制粒度四档 reply/thinking/tools/raw；
    // 工具级复制输出/参数；链接走白名单（http/https/mailto），相对地址按服务端地址解析。
    private openCtx(kind: string, rowId: string, iter: number, tool: string): void {
        this.ctxKind = kind;
        this.ctxRowId = rowId;
        this.ctxIter = iter;
        this.ctxTool = tool;
        this.anim(() => {
            this.ctxOpen = true;
        });
    }
    private ctxRow(): ChatRow | undefined {
        for (let i = 0; i < this.rows.length; i++) {
            if (this.rows[i].id === this.ctxRowId) {
                return this.rows[i];
            }
        }
        return undefined;
    }
    private ctxIteration(): HistoryIteration | undefined {
        const row: ChatRow | undefined = this.ctxRow();
        if (row === undefined) {
            return undefined;
        }
        for (let i = 0; i < row.iterations.length; i++) {
            if (row.iterations[i].iteration === this.ctxIter) {
                return row.iterations[i];
            }
        }
        return undefined;
    }
    private ctxToolObj(): ToolProgress | undefined {
        const it: HistoryIteration | undefined = this.ctxIteration();
        if (it === undefined || it.tools === undefined) {
            return undefined;
        }
        for (let i = 0; i < it.tools.length; i++) {
            if (it.tools[i].name === this.ctxTool) {
                return it.tools[i];
            }
        }
        return undefined;
    }
    /** 一个迭代的内容分段（正文/思考/工具/原文）。 */
    private partsForIteration(it: HistoryIteration): CopyParts {
        const p: CopyParts = new CopyParts();
        p.reply = displayContent(it);
        p.thinking = displayReasoning(it);
        p.raw = it.content !== undefined ? it.content : '';
        const segs: string[] = [];
        if (it.tools !== undefined) {
            for (let i = 0; i < it.tools.length; i++) {
                const t: ToolProgress = it.tools[i];
                const args: string = t.args !== undefined ? t.args : '';
                const out: string = t.detail !== undefined ? t.detail : '';
                segs.push(toolCopyText(t.name, args, out));
            }
        }
        p.tools = segs.join('\n---\n');
        return p;
    }
    /** 整条消息的分段（Web 语义：顶层 content → 最后一迭代正文 → 该迭代思考/工具）。 */
    private partsForRow(row: ChatRow): CopyParts {
        const p: CopyParts = new CopyParts();
        let last: HistoryIteration | undefined = undefined;
        if (row.iterations.length > 0) {
            last = row.iterations[row.iterations.length - 1];
        }
        if (row.content.length > 0) {
            p.reply = row.content;
        }
        else if (last !== undefined) {
            p.reply = displayContent(last);
        }
        if (last !== undefined) {
            const ip: CopyParts = this.partsForIteration(last);
            p.thinking = ip.thinking;
            p.tools = ip.tools;
            p.raw = ip.raw;
        }
        else {
            p.raw = row.content;
        }
        return p;
    }
    /** 当前菜单目标的文本（用于抽链接与整体复制）。 */
    private ctxTargetText(): string {
        const row: ChatRow | undefined = this.ctxRow();
        if (row === undefined) {
            return '';
        }
        if (this.ctxKind === 'user') {
            return row.content;
        }
        if (this.ctxKind === 'iter') {
            const it: HistoryIteration | undefined = this.ctxIteration();
            return it !== undefined ? this.partsForIteration(it).reply : '';
        }
        if (this.ctxKind === 'tool') {
            const t: ToolProgress | undefined = this.ctxToolObj();
            return t !== undefined ? toolCopyText(t.name, t.args !== undefined ? t.args : '', t.detail !== undefined ? t.detail : '') : '';
        }
        return this.partsForRow(row).reply;
    }
    /** 当前菜单目标里的链接（最多 3 条，避免菜单过长）。 */
    private ctxLinks(): string[] {
        const all: string[] = linksIn(this.ctxTargetText());
        return all.length > 3 ? all.slice(0, 3) : all;
    }
    /** 复制到系统剪贴板（失败原样报错）。 */
    private async copyText(text: string, what: string): Promise<void> {
        if (text.trim().length === 0) {
            this.toast('没有可复制的内容');
            return;
        }
        try {
            const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
            await pasteboard.getSystemPasteboard().setData(data);
            this.toast(`已复制${what}`);
        }
        catch (e) {
            this.toast(`复制失败: ${errText(e as Object)}`);
        }
    }
    /** 打开链接（协议白名单 + 相对地址按服务端地址解析）。 */
    private async openUrl(href: string): Promise<void> {
        const store: ChatStore | null = this.store;
        const base: string = store !== null ? store.http.baseUrl : normalizeServerUrl(this.serverUrl);
        const abs: string = resolveOpenable(href, base);
        if (abs.length === 0) {
            this.toast('该链接不能打开（仅支持 http/https/mailto）');
            return;
        }
        try {
            const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
            await ctx.startAbility({ action: 'ohos.want.action.viewData', uri: abs });
        }
        catch (e) {
            this.toast(`打开失败: ${errText(e as Object)}`);
        }
    }
    private runCtxAction(code: string): void {
        const row: ChatRow | undefined = this.ctxRow();
        this.ctxOpen = false;
        if (code === 'cancel') {
            return;
        }
        if (code.indexOf('open-link:') === 0) {
            const idx: number = Number.parseInt(code.substring(10), 10);
            const ls: string[] = this.ctxLinks();
            if (idx >= 0 && idx < ls.length) {
                this.openUrl(ls[idx]);
            }
            return;
        }
        if (code.indexOf('copy-link:') === 0) {
            const idx: number = Number.parseInt(code.substring(10), 10);
            const ls: string[] = this.ctxLinks();
            if (idx >= 0 && idx < ls.length) {
                this.copyText(ls[idx], '链接地址');
            }
            return;
        }
        if (row === undefined) {
            return;
        }
        if (code === 'user-text') {
            this.copyText(row.content, '文本');
            return;
        }
        if (code.indexOf('row-') === 0) {
            this.copyText(composeCopy(this.partsForRow(row), this.variantOf(code)), '消息');
            return;
        }
        if (code.indexOf('iter-') === 0) {
            const it: HistoryIteration | undefined = this.ctxIteration();
            if (it === undefined) {
                return;
            }
            this.copyText(composeCopy(this.partsForIteration(it), this.variantOf(code)), '该迭代');
            return;
        }
        if (code.indexOf('tool-') === 0) {
            const t: ToolProgress | undefined = this.ctxToolObj();
            if (t === undefined) {
                return;
            }
            const args: string = t.args !== undefined ? t.args : '';
            const out: string = t.detail !== undefined ? t.detail : '';
            if (code === 'tool-out') {
                this.copyText(toolResultOnly(out), '工具输出');
            }
            else if (code === 'tool-args') {
                this.copyText(toolArgsOnly(args), '工具参数');
            }
            else {
                this.copyText(toolCopyText(t.name, args, out), '工具内容');
            }
        }
    }
    private variantOf(code: string): string {
        if (code.endsWith('reply')) {
            return COPY_REPLY;
        }
        if (code.endsWith('thinking')) {
            return COPY_THINKING;
        }
        if (code.endsWith('tools')) {
            return COPY_TOOLS;
        }
        return COPY_RAW;
    }
    /** 偏好设置面板（本地偏好 + 服务端偏好；与 web 共用同一份键）。 */
    PrefsSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3214:5)", "entry");
            Column.width('100%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius({ topLeft: 14, topRight: 14 });
            Column.border({ width: 1, color: this.pal().border });
            Column.alignItems(HorizontalAlign.Start);
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3215:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('设置');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3216:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3217:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showSettings = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 聊天界面：原生 / 内嵌 ArkWeb（用户要求可切换；ArkWeb 内也有"切回原生"按钮）
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3223:7)", "entry");
            // 聊天界面：原生 / 内嵌 ArkWeb（用户要求可切换；ArkWeb 内也有"切回原生"按钮）
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('聊天界面');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3224:9)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.useWebUI ? '内嵌网页' : '原生');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3225:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.pal().accent);
            Text.borderRadius(8);
            Text.onClick(() => {
                this.setSurface(!this.useWebUI);
                this.buzz();
            });
        }, Text);
        Text.pop();
        // 聊天界面：原生 / 内嵌 ArkWeb（用户要求可切换；ArkWeb 内也有"切回原生"按钮）
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 主题（深/浅）
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3236:7)", "entry");
            // 主题（深/浅）
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(settingLabel(KEY_APP_THEME));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3237:9)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(themeLabel(this.themeName));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3238:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.pal().accent);
            Text.borderRadius(8);
            Text.onClick(() => {
                this.themeName = toggleTheme(this.themeName);
                this.setSetting(KEY_APP_THEME, this.themeName);
                this.buzz();
            });
        }, Text);
        Text.pop();
        // 主题（深/浅）
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 字号
            Text.create(`${settingLabel(KEY_FONT_SCALE)}：${fontScaleLabel(this.fontScale())}`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3250:7)", "entry");
            // 字号
            Text.fontSize(12);
            // 字号
            Text.fontColor(this.pal().textSecondary);
            // 字号
            Text.width('100%');
        }, Text);
        // 字号
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3252:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const n = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(fontScaleLabel(n));
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3254:11)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(Math.abs(this.fontScale() - n) < 0.01 ? this.pal().onAccent : this.pal().textSecondary);
                    Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
                    Text.backgroundColor(Math.abs(this.fontScale() - n) < 0.01 ? this.pal().accent : this.pal().surface);
                    Text.borderRadius(8);
                    Text.onClick(() => {
                        this.setSetting(KEY_FONT_SCALE, `${n}`);
                    });
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, fontScalePresets(), forEachItemGenFunction, (n: number) => `fs-${n}`, false, false);
        }, ForEach);
        ForEach.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 代码换行
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3267:7)", "entry");
            // 代码换行
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(settingLabel(KEY_CODE_WRAP));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3268:9)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.wrapCode() ? '开' : '关');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3269:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.wrapCode() ? this.pal().success : this.pal().borderStrong);
            Text.borderRadius(8);
            Text.onClick(() => {
                this.setSetting(KEY_CODE_WRAP, this.wrapCode() ? '0' : '1');
            });
        }, Text);
        Text.pop();
        // 代码换行
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 思考默认展开
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3278:7)", "entry");
            // 思考默认展开
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(settingLabel(KEY_REASONING_DEFAULT));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3279:9)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.reasoningDefault() ? '开' : '关');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3280:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.reasoningDefault() ? this.pal().success : this.pal().borderStrong);
            Text.borderRadius(8);
            Text.onClick(() => {
                this.setSetting(KEY_REASONING_DEFAULT, this.reasoningDefault() ? '0' : '1');
            });
        }, Text);
        Text.pop();
        // 思考默认展开
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 发送快捷键
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3289:7)", "entry");
            // 发送快捷键
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(settingLabel(KEY_SEND_KEY));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3290:9)", "entry");
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(sendKeyLabel(this.sendKeyMode()));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3291:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.pal().surfaceHi);
            Text.borderRadius(8);
            Text.onClick(() => {
                const next: string = this.sendKeyMode() === SEND_KEY_MOD_ENTER ? 'enter' : SEND_KEY_MOD_ENTER;
                this.setSetting(KEY_SEND_KEY, next);
            });
        }, Text);
        Text.pop();
        // 发送快捷键
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Divider.create();
            Divider.debugLine("entry/src/main/ets/pages/Index.ets(3300:7)", "entry");
            Divider.color(this.pal().surfaceHi);
        }, Divider);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 与 web 共享的只读项（原生端暂不改这些）
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const k = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Row.create({ space: 8 });
                    Row.debugLine("entry/src/main/ets/pages/Index.ets(3304:9)", "entry");
                    Row.width('100%');
                }, Row);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(settingLabel(k));
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3305:11)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.pal().textSecondary);
                    Text.layoutWeight(1);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(settingOf(this.settings, k).length > 0 ? settingOf(this.settings, k) : '（未设置）');
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3306:11)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.pal().textMuted);
                    Text.maxLines(1);
                    Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                }, Text);
                Text.pop();
                Row.pop();
            };
            this.forEachUpdateFunction(elmtId, this.readonlySettings(), forEachItemGenFunction, (k: string) => `ro-${k}`, false, false);
        }, ForEach);
        // 与 web 共享的只读项（原生端暂不改这些）
        ForEach.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('浅色主题需要色板重构（已单列为 P9b），当前仅深色。');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3311:7)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().textMuted);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3314:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('刷新');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3315:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().accentSoft);
            Text.padding(8);
            Text.onClick(() => {
                this.openPrefs();
            });
        }, Text);
        Text.pop();
        Row.pop();
        Column.pop();
    }
    /** 面板：四个标签各拉一个端点（定时任务 / 后台任务 / 子代理 / Runner）。 */
    PanelsSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3331:5)", "entry");
            Column.width('100%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius({ topLeft: 14, topRight: 14 });
            Column.border({ width: 1, color: this.pal().border });
            Column.alignItems(HorizontalAlign.Start);
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3332:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('面板');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3333:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.panelBusy) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(3335:11)", "entry");
                        LoadingProgress.width(16);
                        LoadingProgress.height(16);
                        LoadingProgress.color(this.pal().accent);
                    }, LoadingProgress);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('刷新');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3337:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().accentSoft);
            Text.padding(8);
            Text.onClick(() => {
                this.refreshPanel();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3340:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showPanels = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3345:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const tab = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(this.panelTabLabel(tab));
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3347:11)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.panelTab === tab ? this.pal().onAccent : this.pal().textSecondary);
                    Text.padding({ left: 10, right: 10, top: 6, bottom: 6 });
                    Text.backgroundColor(this.panelTab === tab ? this.pal().accent : this.pal().surface);
                    Text.borderRadius(8);
                    Text.onClick(() => {
                        this.switchPanelTab(tab);
                    });
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, this.panelTabs(), forEachItemGenFunction, (tab: string) => `ptab-${tab}`, false, false);
        }, ForEach);
        ForEach.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.panelTab === 'cron') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.cronTasks.length === 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('（本会话暂无定时任务）');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3361:11)", "entry");
                                    Text.fontSize(12);
                                    Text.fontColor(this.pal().textMuted);
                                    Text.width('100%');
                                }, Text);
                                Text.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    List.create({ space: 6 });
                                    List.debugLine("entry/src/main/ets/pages/Index.ets(3363:11)", "entry");
                                    List.constraintSize({ maxHeight: 420 });
                                    List.width('100%');
                                }, List);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = (_item, i: number) => {
                                        const job = _item;
                                        {
                                            const itemCreation = (elmtId, isInitialRender) => {
                                                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                                                itemCreation2(elmtId, isInitialRender);
                                                if (!isInitialRender) {
                                                    ListItem.pop();
                                                }
                                                ViewStackProcessor.StopGetAccessRecording();
                                            };
                                            const itemCreation2 = (elmtId, isInitialRender) => {
                                                ListItem.create(deepRenderFunction, true);
                                                ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3365:15)", "entry");
                                            };
                                            const deepRenderFunction = (elmtId, isInitialRender) => {
                                                itemCreation(elmtId, isInitialRender);
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Row.create({ space: 6 });
                                                    Row.debugLine("entry/src/main/ets/pages/Index.ets(3366:17)", "entry");
                                                    Row.width('100%');
                                                    Row.padding(8);
                                                    Row.backgroundColor(this.pal().surface);
                                                    Row.borderRadius(6);
                                                }, Row);
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create(cronLine(job));
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3367:19)", "entry");
                                                    Text.fontSize(12);
                                                    Text.fontColor(this.pal().textPrimary);
                                                    Text.layoutWeight(1);
                                                    Text.maxLines(2);
                                                    Text.wordBreak(WordBreak.BREAK_ALL);
                                                }, Text);
                                                Text.pop();
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create('✕');
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3369:19)", "entry");
                                                    Text.fontSize(12);
                                                    Text.fontColor(this.pal().dangerText);
                                                    Text.padding(6);
                                                    Text.onClick(() => {
                                                        this.removeCron(job.id !== undefined ? job.id : '');
                                                    });
                                                }, Text);
                                                Text.pop();
                                                Row.pop();
                                                ListItem.pop();
                                            };
                                            this.observeComponentCreation2(itemCreation2, ListItem);
                                            ListItem.pop();
                                        }
                                    };
                                    this.forEachUpdateFunction(elmtId, this.cronTasks, forEachItemGenFunction, (job: CronJob, i: number) => `cron-${job.id}#${i}`, true, true);
                                }, ForEach);
                                ForEach.pop();
                                List.pop();
                            });
                        }
                    }, If);
                    If.pop();
                });
            }
            else if (this.panelTab === 'tasks') {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.bgTasks.length === 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('（本会话暂无后台任务）');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3379:11)", "entry");
                                    Text.fontSize(12);
                                    Text.fontColor(this.pal().textMuted);
                                    Text.width('100%');
                                }, Text);
                                Text.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    List.create({ space: 6 });
                                    List.debugLine("entry/src/main/ets/pages/Index.ets(3381:11)", "entry");
                                    List.constraintSize({ maxHeight: 420 });
                                    List.width('100%');
                                }, List);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = (_item, i: number) => {
                                        const t = _item;
                                        {
                                            const itemCreation = (elmtId, isInitialRender) => {
                                                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                                                itemCreation2(elmtId, isInitialRender);
                                                if (!isInitialRender) {
                                                    ListItem.pop();
                                                }
                                                ViewStackProcessor.StopGetAccessRecording();
                                            };
                                            const itemCreation2 = (elmtId, isInitialRender) => {
                                                ListItem.create(deepRenderFunction, true);
                                                ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3383:15)", "entry");
                                            };
                                            const deepRenderFunction = (elmtId, isInitialRender) => {
                                                itemCreation(elmtId, isInitialRender);
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create(bgTaskLine(t, this.nowMs()));
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3384:17)", "entry");
                                                    Text.fontSize(12);
                                                    Text.fontColor(this.pal().textPrimary);
                                                    Text.width('100%');
                                                    Text.padding(8);
                                                    Text.backgroundColor(this.pal().surface);
                                                    Text.borderRadius(6);
                                                    Text.maxLines(3);
                                                    Text.wordBreak(WordBreak.BREAK_ALL);
                                                    Text.copyOption(CopyOptions.LocalDevice);
                                                }, Text);
                                                Text.pop();
                                                ListItem.pop();
                                            };
                                            this.observeComponentCreation2(itemCreation2, ListItem);
                                            ListItem.pop();
                                        }
                                    };
                                    this.forEachUpdateFunction(elmtId, this.bgTasks, forEachItemGenFunction, (t: BgTask, i: number) => `bg-${t.id}#${t.status}#${i}`, true, true);
                                }, ForEach);
                                ForEach.pop();
                                List.pop();
                            });
                        }
                    }, If);
                    If.pop();
                });
            }
            else if (this.panelTab === 'subs') {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.subagents.length === 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('（暂无子代理会话）');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3394:11)", "entry");
                                    Text.fontSize(12);
                                    Text.fontColor(this.pal().textMuted);
                                    Text.width('100%');
                                }, Text);
                                Text.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    List.create({ space: 6 });
                                    List.debugLine("entry/src/main/ets/pages/Index.ets(3396:11)", "entry");
                                    List.constraintSize({ maxHeight: 420 });
                                    List.width('100%');
                                }, List);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = (_item, i: number) => {
                                        const a = _item;
                                        {
                                            const itemCreation = (elmtId, isInitialRender) => {
                                                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                                                itemCreation2(elmtId, isInitialRender);
                                                if (!isInitialRender) {
                                                    ListItem.pop();
                                                }
                                                ViewStackProcessor.StopGetAccessRecording();
                                            };
                                            const itemCreation2 = (elmtId, isInitialRender) => {
                                                ListItem.create(deepRenderFunction, true);
                                                ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3398:15)", "entry");
                                            };
                                            const deepRenderFunction = (elmtId, isInitialRender) => {
                                                itemCreation(elmtId, isInitialRender);
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create(subagentLine(a));
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3399:17)", "entry");
                                                    Text.fontSize(12);
                                                    Text.fontColor(a.running === true ? this.pal().successText : this.pal().textSecondary);
                                                    Text.width('100%');
                                                    Text.padding(8);
                                                    Text.backgroundColor(this.pal().surface);
                                                    Text.borderRadius(6);
                                                    Text.maxLines(2);
                                                    Text.wordBreak(WordBreak.BREAK_ALL);
                                                    Text.onClick(() => {
                                                        this.showPanels = false;
                                                        if (a.chat_id !== undefined) {
                                                            this.switchSession(a.chat_id);
                                                        }
                                                    });
                                                }, Text);
                                                Text.pop();
                                                ListItem.pop();
                                            };
                                            this.observeComponentCreation2(itemCreation2, ListItem);
                                            ListItem.pop();
                                        }
                                    };
                                    this.forEachUpdateFunction(elmtId, this.subagents, forEachItemGenFunction, (a: SubAgentRow, i: number) => `sub-${a.chat_id}#${i}`, true, true);
                                }, ForEach);
                                ForEach.pop();
                                List.pop();
                            });
                        }
                    }, If);
                    If.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(3, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.runners.length === 0) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('（没有受管机器；Runner 由 xbot.ssh-runner 插件纳管）');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3415:11)", "entry");
                                    Text.fontSize(12);
                                    Text.fontColor(this.pal().textMuted);
                                    Text.width('100%');
                                }, Text);
                                Text.pop();
                            });
                        }
                        else {
                            this.ifElseBranchUpdateFunction(1, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    List.create({ space: 6 });
                                    List.debugLine("entry/src/main/ets/pages/Index.ets(3417:11)", "entry");
                                    List.constraintSize({ maxHeight: 420 });
                                    List.width('100%');
                                }, List);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    ForEach.create();
                                    const forEachItemGenFunction = (_item, i: number) => {
                                        const r = _item;
                                        {
                                            const itemCreation = (elmtId, isInitialRender) => {
                                                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                                                itemCreation2(elmtId, isInitialRender);
                                                if (!isInitialRender) {
                                                    ListItem.pop();
                                                }
                                                ViewStackProcessor.StopGetAccessRecording();
                                            };
                                            const itemCreation2 = (elmtId, isInitialRender) => {
                                                ListItem.create(deepRenderFunction, true);
                                                ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3419:15)", "entry");
                                            };
                                            const deepRenderFunction = (elmtId, isInitialRender) => {
                                                itemCreation(elmtId, isInitialRender);
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create(runnerLine(r));
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3420:17)", "entry");
                                                    Text.fontSize(12);
                                                    Text.fontColor(r.online === true ? this.pal().successText : this.pal().textSecondary);
                                                    Text.width('100%');
                                                    Text.padding(8);
                                                    Text.backgroundColor(this.pal().surface);
                                                    Text.borderRadius(6);
                                                    Text.maxLines(2);
                                                    Text.wordBreak(WordBreak.BREAK_ALL);
                                                }, Text);
                                                Text.pop();
                                                ListItem.pop();
                                            };
                                            this.observeComponentCreation2(itemCreation2, ListItem);
                                            ListItem.pop();
                                        }
                                    };
                                    this.forEachUpdateFunction(elmtId, this.runners, forEachItemGenFunction, (r: RunnerRow, i: number) => `run-${r.name}#${r.online}#${i}`, true, true);
                                }, ForEach);
                                ForEach.pop();
                                List.pop();
                            });
                        }
                    }, If);
                    If.pop();
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    /** 会话操作菜单（贴底；删除需二次确认）。 */
    SessSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3441:5)", "entry");
            Column.width('100%');
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius({ topLeft: 14, topRight: 14 });
            Column.border({ width: 1, color: this.pal().border });
            Column.padding({ bottom: 10 });
            Column.alignItems(HorizontalAlign.Start);
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.menuLabel());
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3442:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
            Text.padding({ left: 16, top: 12, bottom: 6 });
            Text.maxLines(1);
            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
        }, Text);
        Text.pop();
        this.CtxItem.bind(this)(this.menuCanMove(MOVE_TOP) ? '置顶' : '置顶（已在顶部）', MOVE_TOP);
        this.CtxItem.bind(this)(this.menuCanMove(MOVE_UP) ? '上移' : '上移（已在顶部）', MOVE_UP);
        this.CtxItem.bind(this)(this.menuCanMove(MOVE_DOWN) ? '下移' : '下移（已在底部）', MOVE_DOWN);
        this.CtxItem.bind(this)('重命名', 'rename');
        this.CtxItem.bind(this)('分支（fork 出新会话）', 'fork');
        this.CtxItem.bind(this)(this.sessConfirmDelete === this.sessMenuId ? '确认删除（再点一次）' : '删除', 'delete');
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Divider.create();
            Divider.debugLine("entry/src/main/ets/pages/Index.ets(3452:7)", "entry");
            Divider.color(this.pal().surfaceHi);
            Divider.margin({ top: 4 });
        }, Divider);
        this.CtxItem.bind(this)('取消', 'cancel');
        Column.pop();
    }
    /** 会话内消息搜索结果（点一条复制该片段；只覆盖当前会话）。 */
    SearchHitsSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3467:5)", "entry");
            Column.width('100%');
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius({ topLeft: 14, topRight: 14 });
            Column.border({ width: 1, color: this.pal().border });
            Column.padding({ bottom: 10 });
            Column.alignItems(HorizontalAlign.Start);
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`本会话命中 ${this.searchHits.length} 条（点一条复制片段）`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3468:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
            Text.padding({ left: 16, top: 12, bottom: 6 });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 6 });
            List.debugLine("entry/src/main/ets/pages/Index.ets(3471:7)", "entry");
            List.constraintSize({ maxHeight: 420 });
            List.width('100%');
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = (_item, i: number) => {
                const h = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        itemCreation2(elmtId, isInitialRender);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3473:11)", "entry");
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(hitLine(h.role !== undefined ? h.role : '', h.snippet !== undefined ? h.snippet : '', 120));
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(3474:13)", "entry");
                            Text.fontSize(13);
                            Text.fontColor(this.pal().textPrimary);
                            Text.width('100%');
                            Text.padding(10);
                            Text.backgroundColor(this.pal().surface);
                            Text.borderRadius(6);
                            Text.maxLines(3);
                            Text.wordBreak(WordBreak.BREAK_ALL);
                            Text.onClick(() => {
                                this.copyText(h.snippet !== undefined ? h.snippet : '', '片段');
                                this.showSearchHits = false;
                            });
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.searchHits, forEachItemGenFunction, (h: SearchHit, i: number) => `hit-${h.id}#${i}`, true, true);
        }, ForEach);
        ForEach.pop();
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Divider.create();
            Divider.debugLine("entry/src/main/ets/pages/Index.ets(3487:7)", "entry");
            Divider.color(this.pal().surfaceHi);
            Divider.margin({ top: 6 });
        }, Divider);
        this.CtxItem.bind(this)('关闭', 'cancel-hits');
        Column.pop();
    }
    /** 菜单里的一项（点击走 `runCtxAction(code)`；@Builder 不能传闭包 ⇒ 用字符串码派发）。 */
    CtxItem(label: string, code: string, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(label);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3502:5)", "entry");
            Text.fontSize(14);
            Text.fontColor(this.pal().textPrimary);
            Text.width('100%');
            Text.padding({ left: 16, right: 16, top: 11, bottom: 11 });
            ViewStackProcessor.visualState("pressed");
            Text.backgroundColor(this.pal<>().surfaceAlt);
            ViewStackProcessor.visualState("normal");
            Text.backgroundColor(this.pal<>().appBg);
            ViewStackProcessor.visualState();
            Text.onClick(() => {
                if (code === 'cancel-hits') {
                    this.showSearchHits = false;
                    return;
                }
                if (code === MOVE_TOP || code === MOVE_UP || code === MOVE_DOWN || code === 'rename'
                    || code === 'fork' || code === 'delete') {
                    this.runSessAction(code);
                    return;
                }
                this.runCtxAction(code);
            });
        }, Text);
        Text.pop();
    }
    /** 长按操作菜单（底部弹出，贴手指易点区）。 */
    ContextSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3523:5)", "entry");
            Column.width('100%');
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius({ topLeft: 14, topRight: 14 });
            Column.border({ width: 1, color: this.pal().border });
            Column.padding({ bottom: 10 });
            Column.alignItems(HorizontalAlign.Start);
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.ctxKind === 'tool' ? '工具操作' : (this.ctxKind === 'iter' ? '迭代操作' : '消息操作'));
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3524:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
            Text.padding({ left: 16, top: 12, bottom: 6 });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.ctxKind === 'user') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.CtxItem.bind(this)('复制文本', 'user-text');
                });
            }
            else if (this.ctxKind === 'tool') {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.CtxItem.bind(this)('复制输出', 'tool-out');
                    this.CtxItem.bind(this)('复制参数', 'tool-args');
                    this.CtxItem.bind(this)('复制全部（名字+参数+输出）', 'tool-all');
                });
            }
            else if (this.ctxKind === 'iter') {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.CtxItem.bind(this)('复制该迭代正文', 'iter-reply');
                    this.CtxItem.bind(this)('复制该迭代（含思考）', 'iter-thinking');
                    this.CtxItem.bind(this)('复制该迭代（含工具）', 'iter-tools');
                });
            }
            else {
                this.ifElseBranchUpdateFunction(3, () => {
                    this.CtxItem.bind(this)('复制回复', 'row-reply');
                    this.CtxItem.bind(this)('复制（含思考）', 'row-thinking');
                    this.CtxItem.bind(this)('复制（含工具）', 'row-tools');
                    this.CtxItem.bind(this)('复制原始 Markdown', 'row-raw');
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 链接（命中链接时才有 —— 与 Web 的落点语义一致）
            if (this.ctxKind !== 'tool') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, i: number) => {
                            const l = _item;
                            this.CtxItem.bind(this)(`打开链接 ${linkLabel(l)}`, `open-link:${i}`);
                            this.CtxItem.bind(this)(`复制链接地址 ${linkLabel(l)}`, `copy-link:${i}`);
                        };
                        this.forEachUpdateFunction(elmtId, this.ctxLinks(), forEachItemGenFunction, (l: string, i: number) => `ctx-link-${i}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Divider.create();
            Divider.debugLine("entry/src/main/ets/pages/Index.ets(3553:7)", "entry");
            Divider.color(this.pal().surfaceHi);
            Divider.margin({ top: 4 });
        }, Divider);
        this.CtxItem.bind(this)('取消', 'cancel');
        Column.pop();
    }
    /** 一行的主体（用户气泡 / 助手块）——由 `LazyForEach` 的 `ListItem` 调用。 */
    ChatRowBody(row: ChatRow, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (row.role === 'user') {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new UserBubbleView(this, {
                                    text: row.content,
                                    theme: this.themeName,
                                    onLongPress: () => {
                                        this.openCtx('user', row.id, 0, '');
                                    },
                                }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 3569, col: 7 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        text: row.content,
                                        theme: this.themeName,
                                        onLongPress: () => {
                                            this.openCtx('user', row.id, 0, '');
                                        }
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    text: row.content,
                                    theme: this.themeName
                                });
                            }
                        }, { name: "UserBubbleView" });
                    }
                });
            }
            else if (!rowIsEmpty(row)) {
                this.ifElseBranchUpdateFunction(1, () => {
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new 
                                // 空气泡守卫：无正文/思考/工具的行（含等待首帧的 live 行）不渲染卡片；
                                // 等待态由列表尾部的「思考中…」占位承担（与 web 的 ShimmerThinking 同语义）
                                MessageRowView(this, {
                                    row: row,
                                    theme: this.themeName,
                                    fontScaleV: this.fontScale(),
                                    wrapCodeV: this.wrapCode(),
                                    sweepX: this.sweepX,
                                    onImage: (src: string) => {
                                        this.openImage(src);
                                    },
                                    loadImage: (src: string) => {
                                        return this.loadImageBytes(src);
                                    },
                                    onLoadMoreRegions: () => {
                                        this.loadMoreRegions(row);
                                    },
                                    onOpenCtx: (iter: number, name: string) => {
                                        this.openCtx(name.length > 0 ? 'tool' : 'iter', row.id, iter, name);
                                    },
                                    onToggleTool: (iter: number, name: string) => {
                                        this.toggleToolByKey(row, iter, name);
                                    },
                                    onRowLongPress: () => {
                                        this.openCtx('row', row.id, 0, '');
                                    },
                                    onCopy: (text: string, what: string) => {
                                        this.copyText(text, what);
                                    },
                                }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 3579, col: 7 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        row: row,
                                        theme: this.themeName,
                                        fontScaleV: this.fontScale(),
                                        wrapCodeV: this.wrapCode(),
                                        sweepX: this.sweepX,
                                        onImage: (src: string) => {
                                            this.openImage(src);
                                        },
                                        loadImage: (src: string) => {
                                            return this.loadImageBytes(src);
                                        },
                                        onLoadMoreRegions: () => {
                                            this.loadMoreRegions(row);
                                        },
                                        onOpenCtx: (iter: number, name: string) => {
                                            this.openCtx(name.length > 0 ? 'tool' : 'iter', row.id, iter, name);
                                        },
                                        onToggleTool: (iter: number, name: string) => {
                                            this.toggleToolByKey(row, iter, name);
                                        },
                                        onRowLongPress: () => {
                                            this.openCtx('row', row.id, 0, '');
                                        },
                                        onCopy: (text: string, what: string) => {
                                            this.copyText(text, what);
                                        }
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    row: row,
                                    theme: this.themeName,
                                    fontScaleV: this.fontScale(),
                                    wrapCodeV: this.wrapCode(),
                                    sweepX: this.sweepX
                                });
                            }
                        }, { name: "MessageRowView" });
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(2, () => {
                });
            }
        }, If);
        If.pop();
    }
    /** 一个迭代 = 思考(T) / 正文(O) / 工具(C)。 */
    /** live 行的行 id（长按菜单用）。 */
    private liveRowIdOf(): string {
        for (let i = 0; i < this.rows.length; i++) {
            const r: ChatRow = this.rows[i];
            if (r.role === 'assistant' && r.isLive) {
                return r.id;
            }
        }
        return '';
    }
    /**
     * **一段可长按复制的完整取证文本** = 渲染规模 + 各页实测几何。
     *
     * 为什么合成一段：取证的最低摩擦路径不是截图，而是「长按 → 复制 → 粘贴到对话里」
     * —— 截图受限于截图工具/传输，纯文本不会丢信息、也不用修代理。
     */
    private auditText(): string {
        const geo: string = this.geoText.length > 0
            ? this.geoText
            : '（几何未采集：请点上面的「采集各页版面几何」按钮）';
        return `===== xbot-harmony 自检取证（长按可复制）=====\n`
            + `[渲染规模]\n${this.sessionStats()}\n\n[各页几何 x/y/w/h]\n${geo}`;
    }
    /**
     * 当前会话的**渲染规模统计**（设备侧实测）。
     *
     * 与 tools/tests/live_dump.test.ts（服务端侧测量）互为印证：一张自检页截图即可带回
     * "这台手机上到底要渲染多少块"——用于确认"卡到没法用"是否已由迭代上限解决。
     */
    private sessionStats(): string {
        const rows: ChatRow[] = this.rows;
        let iterTotal: number = 0;
        let maxIter: number = 0;
        let rendered: number = 0;
        let foldedRows: number = 0;
        for (let i = 0; i < rows.length; i++) {
            const r: ChatRow = rows[i];
            const n: number = r.iterations.length;
            iterTotal += n;
            if (n > maxIter) {
                maxIter = n;
            }
            rendered += Math.min(n, MAX_ITER_VISIBLE);
            if (r.regionsBefore > 0) {
                foldedRows++;
            }
        }
        return `rows=${rows.length}\n迭代总数=${iterTotal}\n单行最多迭代=${maxIter}\n`
            + `实际渲染块数=${rendered}（每行≤${MAX_ITER_VISIBLE}）\n带更早折叠区域的行=${foldedRows}\n`
            + `会话=${this.currentChat}\nbusy=${this.busy}\n`
            + mdCacheText() + '\n' + streamStatsText();
    }
    /** 加载该 turn 更早的展示区域（服务端折叠视图按需取回）。 */
    private async loadMoreRegions(row: ChatRow): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            await store.loadEarlierRegions(row);
        }
        catch (e) {
            this.toast(`加载更早区域失败: ${errText(e as Object)}`);
        }
    }
    /** 该 turn 实际要渲染的迭代（默认只给最近 MAX_ITER_VISIBLE 个）。 */
    /** 被折叠掉的迭代数量（0 表示全展示）。 */
    /**
     * 工具状态颜色 —— web 的「色彩只表达状态」法则：
     * 运行/生成中保留注意力色（琥珀会被误读为警告，改用强调色）；完成/排队中性；失败红。
     */
    /** 工具状态角标（web 五态：generating 带字数、running 带时长、error 带 exit）。 */
    /** pill 显示名（名字 + 状态角标）。 */
    // ── 弹层：会话抽屉 ────────────────────────────────────────────────────────
    DrawerSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3705:5)", "entry");
            Column.width('82%');
            Column.height('100%');
            Column.padding(12);
            Column.backgroundColor(this.pal().appBg);
            Column.border({ width: { right: 1 }, color: this.pal().border });
            Column.position({ x: 0, y: 0 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3706:7)", "entry");
            Row.width('100%');
            Row.padding(8);
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('会话');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3707:9)", "entry");
            Text.fontSize(17);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('＋ 新建');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3708:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 6, bottom: 6 });
            Text.backgroundColor(this.pal().accent);
            Text.borderRadius(14);
            ViewStackProcessor.visualState("pressed");
            Text.opacity(0.75);
            ViewStackProcessor.visualState("normal");
            Text.opacity(1);
            ViewStackProcessor.visualState();
            Text.onClick(() => {
                this.newSession();
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3715:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showDrawer = false;
                this.renamingId = '';
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3723:7)", "entry");
            // 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）
            Row.width('100%');
            // 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）
            Row.padding({ bottom: 6 });
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '筛选会话…', text: this.sessQuery });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(3724:9)", "entry");
            TextInput.onChange((v: string) => {
                this.sessQuery = v;
            });
            TextInput.layoutWeight(1);
            TextInput.constraintSize({ minHeight: 38 });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
            TextInput.fontSize(13);
            TextInput.borderRadius(12);
            TextInput.padding({ left: 12, right: 12 });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.searchBusy) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(3732:11)", "entry");
                        LoadingProgress.width(16);
                        LoadingProgress.height(16);
                        LoadingProgress.color(this.pal().accent);
                    }, LoadingProgress);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('搜消息');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3734:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().accentSoft);
                        Text.padding(6);
                        Text.onClick(() => {
                            this.runSearch();
                        });
                    }, Text);
                    Text.pop();
                });
            }
        }, If);
        If.pop();
        // 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create();
            List.debugLine("entry/src/main/ets/pages/Index.ets(3742:7)", "entry");
            List.layoutWeight(1);
            List.width('100%');
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const s = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        itemCreation2(elmtId, isInitialRender);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(3744:11)", "entry");
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Column.create({ space: 4 });
                            Column.debugLine("entry/src/main/ets/pages/Index.ets(3745:13)", "entry");
                            Column.width('100%');
                            Column.padding(12);
                            Column.backgroundColor(s.chat_id === this.currentChat ? this.pal().surfaceHi : this.pal().surface);
                            Column.borderRadius(12);
                            Column.border({
                                width: { left: 3, top: 1, right: 1, bottom: 1 },
                                color: {
                                    left: s.chat_id === this.currentChat ? this.pal().accent : this.pal().border,
                                    top: this.pal().border, right: this.pal().border, bottom: this.pal().border,
                                },
                            });
                            Column.shadow({ radius: 8, color: '#10000000', offsetX: 0, offsetY: 2 });
                            ViewStackProcessor.visualState("pressed");
                            Column.opacity(0.75);
                            ViewStackProcessor.visualState("normal");
                            Column.opacity(1);
                            ViewStackProcessor.visualState();
                            Column.onClick(() => {
                                if (s.chat_id !== undefined && this.renamingId.length === 0) {
                                    this.switchSession(s.chat_id);
                                }
                            });
                        }, Column);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            If.create();
                            if (this.renamingId === s.chat_id) {
                                this.ifElseBranchUpdateFunction(0, () => {
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 6 });
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(3747:17)", "entry");
                                        Row.width('100%');
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        TextInput.create({ text: this.renameText });
                                        TextInput.debugLine("entry/src/main/ets/pages/Index.ets(3748:19)", "entry");
                                        TextInput.onChange((v: string) => {
                                            this.renameText = v;
                                        });
                                        TextInput.layoutWeight(1);
                                        TextInput.constraintSize({ minHeight: 36 });
                                        TextInput.backgroundColor(this.pal().surfaceAlt);
                                        TextInput.fontColor(this.pal().textPrimary);
                                    }, TextInput);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create('保存');
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3753:19)", "entry");
                                        Text.fontSize(13);
                                        Text.fontColor(this.pal().accentSoft);
                                        Text.padding(6);
                                        Text.onClick(() => {
                                            const store: ChatStore | null = this.store;
                                            if (store !== null && s.chat_id !== undefined) {
                                                store.renameSession(s.chat_id, this.renameText);
                                            }
                                            this.renamingId = '';
                                        });
                                    }, Text);
                                    Text.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create('取消');
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3760:19)", "entry");
                                        Text.fontSize(13);
                                        Text.fontColor(this.pal().textSecondary);
                                        Text.padding(6);
                                        Text.onClick(() => {
                                            this.renamingId = '';
                                        });
                                    }, Text);
                                    Text.pop();
                                    Row.pop();
                                });
                            }
                            else {
                                this.ifElseBranchUpdateFunction(1, () => {
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create();
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(3765:17)", "entry");
                                        Row.width('100%');
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Column.create();
                                        Column.debugLine("entry/src/main/ets/pages/Index.ets(3766:19)", "entry");
                                        Column.layoutWeight(1);
                                        Column.alignItems(HorizontalAlign.Start);
                                    }, Column);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 6 });
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(3767:21)", "entry");
                                        Row.width('100%');
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        If.create();
                                        if (s.running === true) {
                                            this.ifElseBranchUpdateFunction(0, () => {
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Circle.create({ width: 7, height: 7 });
                                                    Circle.debugLine("entry/src/main/ets/pages/Index.ets(3769:25)", "entry");
                                                    Context.animation({ duration: 600, curve: Curve.EaseInOut });
                                                    Circle.fill(this.pal().success);
                                                    Circle.opacity(this.pulseOn ? 1 : 0.35);
                                                    Context.animation(null);
                                                }, Circle);
                                            });
                                        }
                                        else {
                                            this.ifElseBranchUpdateFunction(1, () => {
                                            });
                                        }
                                    }, If);
                                    If.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(this.tabLabel(s.chat_id));
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3773:23)", "entry");
                                        Text.fontSize(15);
                                        Text.fontColor(s.chat_id === this.currentChat ? this.pal().accentText : this.pal().textPrimary);
                                        Text.maxLines(1);
                                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                        Text.layoutWeight(1);
                                    }, Text);
                                    Text.pop();
                                    Row.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 6 });
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(3779:21)", "entry");
                                        Row.width('100%');
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(channelLabel(s.channel !== undefined ? s.channel : 'web'));
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3780:23)", "entry");
                                        Text.fontSize(9);
                                        Text.fontColor(this.pal().accentText);
                                        Text.padding({ left: 4, right: 4, top: 1, bottom: 1 });
                                        Text.backgroundColor(this.pal().surfaceHi);
                                        Text.borderRadius(4);
                                    }, Text);
                                    Text.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(s.chat_id);
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3784:23)", "entry");
                                        Text.fontSize(10);
                                        Text.fontColor(this.pal().textMuted);
                                        Text.maxLines(1);
                                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                        Text.layoutWeight(1);
                                    }, Text);
                                    Text.pop();
                                    Row.pop();
                                    Column.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                        Text.create('⋯');
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3793:19)", "entry");
                                        // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                        Text.fontSize(18);
                                        // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                        Text.fontColor(this.pal().textSecondary);
                                        // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                        Text.padding({ left: 10, right: 6, top: 4, bottom: 4 });
                                        // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                        Text.onClick(() => {
                                            this.anim(() => {
                                                this.sessMenuId = s.chat_id;
                                            });
                                            this.sessConfirmDelete = '';
                                        });
                                    }, Text);
                                    // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                                    Text.pop();
                                    Row.pop();
                                });
                            }
                        }, If);
                        If.pop();
                        Column.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.filteredSessions(), forEachItemGenFunction, (s: SessionItem) => `${s.chat_id}#${s.label}#${s.running}`, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('设置（字号 / 换行 / 思考）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3825:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.margin({ top: 8 });
            Button.onClick(() => {
                this.openPrefs();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('面板（任务 / 子代理 / Runner）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3829:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.margin({ top: 8 });
            Button.onClick(() => {
                this.openPanels();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('退出登录');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3833:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.margin({ top: 8 });
            Button.onClick(() => {
                this.doLogout();
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    // ── 弹层：设置 ────────────────────────────────────────────────────────────
    SettingsSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3848:5)", "entry");
            Column.width('92%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3849:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('设置');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3850:9)", "entry");
            Text.fontSize(17);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3851:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showSettings = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('服务端');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3856:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ text: this.serverUrl });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(3857:7)", "entry");
            TextInput.onChange((v: string) => {
                this.serverUrl = v;
            });
            TextInput.constraintSize({ minHeight: 42 });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('用户名');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3863:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ text: this.username });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(3864:7)", "entry");
            TextInput.onChange((v: string) => {
                this.username = v;
            });
            TextInput.constraintSize({ minHeight: 42 });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3870:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('显示思考过程');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3871:9)", "entry");
            Text.fontSize(14);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Toggle.create({ type: ToggleType.Switch, isOn: this.showReasoning });
            Toggle.debugLine("entry/src/main/ets/pages/Index.ets(3872:9)", "entry");
            Toggle.onChange((on: boolean) => {
                this.showReasoning = on;
            });
        }, Toggle);
        Toggle.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3878:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('当前会话 ID');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3879:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.currentChat.length > 0 ? this.currentChat : '-');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3880:9)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().textMuted);
            Text.maxLines(1);
            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
            Text.constraintSize({ maxWidth: 180 });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('保存服务端/用户名');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3885:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().accent);
            Button.fontColor(this.pal().onAccent);
            Button.onClick(async () => {
                const store: ChatStore | null = this.store;
                this.takeServerUrl();
                await this.config.save(this.serverUrl, this.username, store !== null ? store.http.exportSessionCookie() : '');
                this.toast('已保存（换服务端请退出重登）');
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.auditing ? '走查中…' : '① 走查并上传所有页面截图（推荐）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3894:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 44 });
            Button.backgroundColor(this.pal().accent);
            Button.onClick(() => {
                this.showSettings = false;
                this.runUiAudit();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.auditLog.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.auditLog);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3901:9)", "entry");
                        Text.fontSize(10);
                        Text.fontColor(this.pal().textSecondary);
                        Text.width('100%');
                        Text.maxLines(4);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('渲染自检（排查渲染问题用）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3903:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.onClick(() => {
                this.showSettings = false;
                this.showSelfCheck = true;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('打开完整 Web UI（插件/GenUI/终端）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3909:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.onClick(() => {
                this.showSettings = false;
                this.panelUrl = this.serverUrl;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('退出登录');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(3915:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().dangerBg);
            Button.onClick(() => {
                this.showSettings = false;
                this.doLogout();
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    // ── 弹层：队列 ────────────────────────────────────────────────────────────
    /**
     * 渲染自检：把每类渲染构件分块画出来（带序号标签）。
     * 用途：截一张图即可定位"到底哪类构件渲染错乱"，不必逐页猜。
     *
     * 注意：ArkUI 的 @Builder **不能接受函数/回调参数**（需 @BuilderParam 组件才行），
     * 所以这里把每格内联展开，不做回调包装。
     */
    /**
     * LLM 选择栏：按订阅分组的模型列表 + 上下文上限预设/手输。
     *
     * 契约：`GET /api/llm-config`（model_entries[].{sub_id,sub_name,model,status,vision}、max_context）；
     * 切换 `POST /api/llm-config/model {sub_id, model}`（**必带 sub_id**：绝不裸模型名解析）；
     * 上限 `POST /api/llm-max-context {max_context}`。
     */
    ModelSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(3944:5)", "entry");
            Column.width('92%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3945:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('模型与上下文');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3946:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3947:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showModel = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`当前：${this.currentModelName()}`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3952:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().successText);
            Text.width('100%');
            Text.wordBreak(WordBreak.BREAK_ALL);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 上下文上限
            Text.create(`上下文上限：${this.ctxText().length > 0 ? this.ctxText() : '未设置'}`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3957:7)", "entry");
            // 上下文上限
            Text.fontSize(12);
            // 上下文上限
            Text.fontColor(this.pal().textSecondary);
            // 上下文上限
            Text.width('100%');
        }, Text);
        // 上下文上限
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3959:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = (_item, i: number) => {
                const p = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(this.ctxPresetText(p));
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(3961:11)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.pal().accentSoft);
                    Text.padding({ left: 10, right: 10, top: 5, bottom: 5 });
                    Text.backgroundColor(this.pal().surface);
                    Text.borderRadius(6);
                    Text.border({ width: 1, color: this.pal().border });
                    Text.onClick(() => {
                        this.applyMaxContext(p);
                    });
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, this.ctxPresets(), forEachItemGenFunction, (p: number, i: number) => `ctx-preset-${p}`, true, true);
        }, ForEach);
        ForEach.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 6 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(3972:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '自定义，如 200k / 1m', text: this.ctxInput });
            TextInput.debugLine("entry/src/main/ets/pages/Index.ets(3973:9)", "entry");
            TextInput.onChange((v: string) => {
                this.ctxInput = v;
            });
            TextInput.layoutWeight(1);
            TextInput.constraintSize({ minHeight: 36 });
            TextInput.backgroundColor(this.pal().surfaceAlt);
            TextInput.fontColor(this.pal().textPrimary);
            TextInput.fontSize(12);
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('应用');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(3979:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().onAccent);
            Text.padding({ left: 12, right: 12, top: 8, bottom: 8 });
            Text.backgroundColor(this.pal().accent);
            Text.borderRadius(6);
            Text.onClick(() => {
                const n: number = parseContext(this.ctxInput);
                if (n <= 0) {
                    this.toast('上下文上限格式不对（示例：200k / 1m / 200000）');
                    return;
                }
                this.applyMaxContext(n);
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 模型列表（按订阅分组）
            if (this.llmCfg === undefined) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 8 });
                        Row.debugLine("entry/src/main/ets/pages/Index.ets(3993:9)", "entry");
                        Row.padding(10);
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(3994:11)", "entry");
                        LoadingProgress.width(16);
                        LoadingProgress.height(16);
                        LoadingProgress.color(this.pal().accent);
                    }, LoadingProgress);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('正在读取模型列表…');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3995:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            else if (this.modelGroups().length === 0) {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('（没有可选模型：请在设置里添加订阅）');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(3998:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Scroll.create();
                        Scroll.debugLine("entry/src/main/ets/pages/Index.ets(4000:9)", "entry");
                        Scroll.constraintSize({ maxHeight: 420 });
                        Scroll.width('100%');
                    }, Scroll);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 8 });
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(4001:11)", "entry");
                        Column.width('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const g = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Column.create({ space: 4 });
                                Column.debugLine("entry/src/main/ets/pages/Index.ets(4003:15)", "entry");
                                Column.width('100%');
                            }, Column);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(g.name);
                                Text.debugLine("entry/src/main/ets/pages/Index.ets(4004:17)", "entry");
                                Text.fontSize(11);
                                Text.fontColor(this.pal().textMuted);
                                Text.width('100%');
                            }, Text);
                            Text.pop();
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                ForEach.create();
                                const forEachItemGenFunction = (_item, i: number) => {
                                    const e = _item;
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 8 });
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(4006:19)", "entry");
                                        Row.width('100%');
                                        Row.padding(8);
                                        Row.backgroundColor(this.pal().surface);
                                        Row.borderRadius(6);
                                        Row.onClick(() => {
                                            if (!this.modelSelectable(e)) {
                                                this.toast('该模型已禁用');
                                                return;
                                            }
                                            this.pickModel(g.subId, e.model !== undefined ? e.model : '');
                                        });
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(this.labelOfModel(e));
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4007:21)", "entry");
                                        Text.fontSize(13);
                                        Text.fontColor(this.modelSelectable(e) ? this.pal().textPrimary : this.pal().textMuted);
                                        Text.layoutWeight(1);
                                        Text.maxLines(1);
                                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                                    }, Text);
                                    Text.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        If.create();
                                        if (this.modelBusy === `${g.subId}#${e.model}`) {
                                            this.ifElseBranchUpdateFunction(0, () => {
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    LoadingProgress.create();
                                                    LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(4011:23)", "entry");
                                                    LoadingProgress.width(14);
                                                    LoadingProgress.height(14);
                                                    LoadingProgress.color(this.pal().accent);
                                                }, LoadingProgress);
                                            });
                                        }
                                        else if (e.model === this.currentModelName()) {
                                            this.ifElseBranchUpdateFunction(1, () => {
                                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                    Text.create('✓ 当前');
                                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4013:23)", "entry");
                                                    Text.fontSize(11);
                                                    Text.fontColor(this.pal().successText);
                                                }, Text);
                                                Text.pop();
                                            });
                                        }
                                        else {
                                            this.ifElseBranchUpdateFunction(2, () => {
                                            });
                                        }
                                    }, If);
                                    If.pop();
                                    Row.pop();
                                };
                                this.forEachUpdateFunction(elmtId, g.entries, forEachItemGenFunction, (e: LlmModelEntry, i: number) => `${g.subId}#${e.model}`, true, true);
                            }, ForEach);
                            ForEach.pop();
                            Column.pop();
                        };
                        this.forEachUpdateFunction(elmtId, this.modelGroups(), forEachItemGenFunction, (g: ModelGroup) => `grp-${g.subId}`, false, false);
                    }, ForEach);
                    ForEach.pop();
                    Column.pop();
                    Scroll.pop();
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    /** 切模型（带 sub_id；防连点；失败把原因原样告诉用户）。 */
    private async pickModel(subId: string, model: string): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null || model.length === 0 || this.modelBusy.length > 0) {
            return;
        }
        this.modelBusy = `${subId}#${model}`;
        try {
            await store.setModel(subId, model);
            this.toast(`已切换到 ${model}`);
            this.showModel = false;
        }
        catch (e) {
            this.toast(`切换失败: ${errText(e as Object)}`);
        }
        finally {
            this.modelBusy = '';
        }
    }
    /** 设置上下文上限（服务端权威；成功后刷新显示）。 */
    private async applyMaxContext(n: number): Promise<void> {
        const store: ChatStore | null = this.store;
        if (store === null) {
            return;
        }
        try {
            await store.setMaxContext(n);
            this.toast(`上下文上限已设为 ${contextText(n)}`);
            this.ctxInput = '';
        }
        catch (e) {
            this.toast(`设置失败: ${errText(e as Object)}`);
        }
    }
    // ── @Builder 可用的包装（ArkUI 的 @Builder 里裸标识符会被解析为类成员 ⇒ 必须经 this） ──
    /** 当前生效的模型名（优先服务端 llm-config，回落状态里的 usage.model）。 */
    private currentModelName(): string {
        return currentModelText(this.llmCfg, modelText(this.usage));
    }
    /** 上下文上限文本（拿不到则空串）。 */
    private ctxText(): string {
        return contextText(this.llmCfg !== undefined ? this.llmCfg.max_context : undefined);
    }
    /** 按订阅分组的模型列表。 */
    private modelGroups(): ModelGroup[] {
        return this.llmCfg !== undefined ? groupModels(this.llmCfg.model_entries) : [];
    }
    /** 上下文预设。 */
    private ctxPresets(): number[] {
        return contextPresets();
    }
    /** 预设的可读文本。 */
    private ctxPresetText(p: number): string {
        return contextText(p);
    }
    /** 模型条目显示名。 */
    private labelOfModel(e: LlmModelEntry): string {
        return modelLabel(e);
    }
    /** 该模型是否可选（禁用的不给点）。 */
    private modelSelectable(e: LlmModelEntry): boolean {
        return selectable(e);
    }
    /** 会话状态面板：goal + todos 全量 + 用量 + cwd（服务端权威值，不做本地推算）。 */
    StatusSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4110:5)", "entry");
            Column.width('92%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
            Column.transition(this.sheetTransition());
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4111:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('会话状态');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4112:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4113:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showStatus = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.goalLine().length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.goalLine());
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4119:9)", "entry");
                        Text.fontSize(13);
                        Text.fontColor(this.pal().warn);
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.currentTodoLine().length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`进行中：${this.currentTodoLine()}`);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4123:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().accentSoft);
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.statusBarText().length > 0 ? this.statusBarText() : '（暂无用量/模型信息）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4126:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
            Text.wordBreak(WordBreak.BREAK_ALL);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`todos ${todoProgress(this.todos).length > 0 ? todoProgress(this.todos) : '0/0'}`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4128:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.cwd.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`cwd: ${this.cwd}`);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4131:9)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.copyOption(CopyOptions.LocalDevice);
                    }, Text);
                    Text.pop();
                });
            }
            // 模型 / 上下文上限（下一步：切换）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 模型 / 上下文上限（下一步：切换）
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4136:7)", "entry");
            // 模型 / 上下文上限（下一步：切换）
            Row.width('100%');
            // 模型 / 上下文上限（下一步：切换）
            Row.padding(8);
            // 模型 / 上下文上限（下一步：切换）
            Row.backgroundColor(this.pal().surface);
            // 模型 / 上下文上限（下一步：切换）
            Row.borderRadius(6);
            // 模型 / 上下文上限（下一步：切换）
            Row.onClick(() => {
                this.anim(() => {
                    this.showModel = true;
                });
                this.store?.loadLlmConfig();
            });
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`模型：${this.currentModelName()}`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4137:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
            Text.maxLines(1);
            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.ctxText().length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`上下文 ${this.ctxText()}`);
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4141:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('切换 ›');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4143:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().accentSoft);
            Text.padding({ left: 6, right: 6 });
        }, Text);
        Text.pop();
        // 模型 / 上下文上限（下一步：切换）
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.todos.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        List.create({ space: 6 });
                        List.debugLine("entry/src/main/ets/pages/Index.ets(4154:9)", "entry");
                        List.constraintSize({ maxHeight: 380 });
                        List.width('100%');
                    }, List);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, i: number) => {
                            const td = _item;
                            {
                                const itemCreation = (elmtId, isInitialRender) => {
                                    ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                                    itemCreation2(elmtId, isInitialRender);
                                    if (!isInitialRender) {
                                        ListItem.pop();
                                    }
                                    ViewStackProcessor.StopGetAccessRecording();
                                };
                                const itemCreation2 = (elmtId, isInitialRender) => {
                                    ListItem.create(deepRenderFunction, true);
                                    ListItem.debugLine("entry/src/main/ets/pages/Index.ets(4156:13)", "entry");
                                };
                                const deepRenderFunction = (elmtId, isInitialRender) => {
                                    itemCreation(elmtId, isInitialRender);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 8 });
                                        Row.debugLine("entry/src/main/ets/pages/Index.ets(4157:15)", "entry");
                                        Row.width('100%');
                                        Row.padding(8);
                                        Row.backgroundColor(this.pal().surface);
                                        Row.borderRadius(6);
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(td.status === 'completed' ? '✅' : (td.status === 'in_progress' ? '◐' : '○'));
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4158:17)", "entry");
                                        Text.fontSize(13);
                                        Text.fontColor(td.status === 'completed' ? this.pal().successText : this.pal().textSecondary);
                                    }, Text);
                                    Text.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(td.text !== undefined ? td.text : '');
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4160:17)", "entry");
                                        Text.fontSize(13);
                                        Text.fontColor(td.status === 'completed' ? this.pal().textMuted : this.pal().textPrimary);
                                        Text.layoutWeight(1);
                                        Text.wordBreak(WordBreak.BREAK_ALL);
                                    }, Text);
                                    Text.pop();
                                    Row.pop();
                                    ListItem.pop();
                                };
                                this.observeComponentCreation2(itemCreation2, ListItem);
                                ListItem.pop();
                            }
                        };
                        this.forEachUpdateFunction(elmtId, this.todos, forEachItemGenFunction, (td: TodoItem, i: number) => `${i}#${td.status}#${td.text}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                    List.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('（本会话暂无 todos）');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4172:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textMuted);
                        Text.width('100%');
                    }, Text);
                    Text.pop();
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    SelfCheckSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4182:5)", "entry");
            Column.width('94%');
            Column.height('86%');
            Column.padding(12);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().borderStrong });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4183:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('渲染自检');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4184:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4185:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showSelfCheck = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.geoRunning ? '采集中…' : '采集各页版面几何（数值，无需网络）');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(4190:7)", "entry");
            Button.width('100%');
            Button.constraintSize({ minHeight: 40 });
            Button.backgroundColor(this.pal().accentSoft);
            Button.onClick(() => {
                this.collectAllGeometry();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('下方这一段可【长按复制】后直接粘贴给对方 —— 不必截图（零网络也能取证）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4195:7)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().warn);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.auditText());
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4197:7)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().successText);
            Text.fontFamily('monospace');
            Text.width('100%');
            Text.padding(8);
            Text.backgroundColor(this.pal().surfaceAlt);
            Text.borderRadius(8);
            Text.copyOption(CopyOptions.LocalDevice);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create();
            Scroll.debugLine("entry/src/main/ets/pages/Index.ets(4203:7)", "entry");
            Scroll.layoutWeight(1);
            Scroll.width('100%');
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4204:9)", "entry");
            Column.width('100%');
            Column.padding(10);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4205:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A 纯文本（自动换行）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4206:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new MarkdownView(this, { text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。' }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 4207, col: 13 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。'
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。'
                    });
                }
            }, { name: "MarkdownView" });
        }
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4211:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B 行内样式（粗/斜/删除/行内码/链接）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4212:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new MarkdownView(this, { text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。' }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 4213, col: 13 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。'
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。'
                    });
                }
            }, { name: "MarkdownView" });
        }
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4217:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('C 标题 + 列表');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4218:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new MarkdownView(this, { text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二' }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 4219, col: 13 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二'
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二'
                    });
                }
            }, { name: "MarkdownView" });
        }
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4223:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('D 代码块（含超长行）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4224:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new MarkdownView(this, { text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```' }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 4225, col: 13 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```'
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```'
                    });
                }
            }, { name: "MarkdownView" });
        }
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4229:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('E 表格');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4230:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new MarkdownView(this, { text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |' }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Index.ets", line: 4231, col: 13 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |'
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |'
                    });
                }
            }, { name: "MarkdownView" });
        }
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4235:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('F 工具 pill 行（Flex 换行）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4236:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Flex.create({ wrap: FlexWrap.Wrap });
            Flex.debugLine("entry/src/main/ets/pages/Index.ets(4237:13)", "entry");
            Flex.width('100%');
        }, Flex);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const t = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(t);
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4239:17)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.pal().successText);
                    Text.padding({ left: 8, right: 8, top: 5, bottom: 5 });
                    Text.margin(3);
                    Text.backgroundColor(this.pal().surfaceAlt);
                    Text.borderRadius(6);
                    Text.border({ width: 1, color: this.pal().border });
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, ['✓ Read', '✓ Shell', '● Grep', '✓ Edit', '✗ Fetch'], forEachItemGenFunction, (t: string) => t, false, false);
        }, ForEach);
        ForEach.pop();
        Flex.pop();
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4248:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('G 长 URL（不可断词）');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4249:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('https://xbot.pivotlang.tech/api/files/download?key=uploads%2F4%2Faaef9711-1349-420d-97ea-94e70e2401e7.jpg&inline=1');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4250:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().accentSoft);
            Text.width('100%');
        }, Text);
        Text.pop();
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4255:11)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('H 顶栏内联布局');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4256:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4257:13)", "entry");
            Row.width('100%');
            Row.backgroundColor(this.pal().surfaceAlt);
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('☰');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4258:15)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('标题文本');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4259:15)", "entry");
            Text.fontSize(15);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('⊞');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4260:15)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('⚙');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4261:15)", "entry");
            Text.fontSize(20);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(10);
        }, Text);
        Text.pop();
        Row.pop();
        Column.pop();
        Column.pop();
        Scroll.pop();
        Column.pop();
    }
    QueueSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4281:5)", "entry");
            Column.width('92%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4282:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`待发队列 (${this.queue.length})`);
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4283:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4285:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showQueue = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create();
            List.debugLine("entry/src/main/ets/pages/Index.ets(4290:7)", "entry");
            List.height(300);
            List.width('100%');
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const q = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        itemCreation2(elmtId, isInitialRender);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(4292:11)", "entry");
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Row.create({ space: 6 });
                            Row.debugLine("entry/src/main/ets/pages/Index.ets(4293:13)", "entry");
                            Row.width('100%');
                            Row.padding(8);
                            Row.backgroundColor(this.pal().surface);
                            Row.borderRadius(8);
                        }, Row);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(q.content !== undefined && q.content.length > 0
                                ? q.content
                                : (q.text !== undefined ? q.text : ''));
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4294:15)", "entry");
                            Text.fontSize(13);
                            Text.fontColor(this.pal().textPrimary);
                            Text.layoutWeight(1);
                            Text.maxLines(3);
                            Text.wordBreak(WordBreak.BREAK_ALL);
                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('↑');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4300:15)", "entry");
                            Text.fontSize(14);
                            Text.fontColor(this.pal().accentSoft);
                            Text.padding(6);
                            Text.onClick(() => {
                                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                                this.store?.moveQueued(id, -1);
                            });
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('↓');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4304:15)", "entry");
                            Text.fontSize(14);
                            Text.fontColor(this.pal().accentSoft);
                            Text.padding(6);
                            Text.onClick(() => {
                                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                                this.store?.moveQueued(id, 1);
                            });
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('✕');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4308:15)", "entry");
                            Text.fontSize(14);
                            Text.fontColor(this.pal().dangerText);
                            Text.padding(6);
                            Text.onClick(() => {
                                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                                this.store?.cancelQueued(id);
                            });
                        }, Text);
                        Text.pop();
                        Row.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.queue, forEachItemGenFunction, (q: QueueItem) => `${q.msg_id}#${q.content}#${q.text}`, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
    }
    // ── 弹层：插件面板 ────────────────────────────────────────────────────────
    PluginsSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4326:5)", "entry");
            Column.width('92%');
            Column.padding(16);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4327:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('能力面板');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4328:9)", "entry");
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4329:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(8);
            Text.onClick(() => {
                this.showPlugins = false;
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('原生渲染聊天主链路；下列能力由 ArkWeb 承载（与 Web 版同源、能力一致）：');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4334:7)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().textSecondary);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create();
            List.debugLine("entry/src/main/ets/pages/Index.ets(4337:7)", "entry");
            List.height(320);
            List.width('100%');
        }, List);
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                itemCreation2(elmtId, isInitialRender);
                if (!isInitialRender) {
                    // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.debugLine("entry/src/main/ets/pages/Index.ets(4339:9)", "entry");
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Row.create();
                    Row.debugLine("entry/src/main/ets/pages/Index.ets(4340:11)", "entry");
                    Row.width('100%');
                    Row.padding(12);
                    Row.backgroundColor(this.pal().surfaceAlt);
                    Row.borderRadius(8);
                    Row.onClick(() => {
                        this.showPlugins = false;
                        this.panelUrl = this.serverUrl;
                    });
                }, Row);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('🌐  完整 Web UI');
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4341:13)", "entry");
                    Text.fontSize(14);
                    Text.fontColor(this.pal().textPrimary);
                    Text.layoutWeight(1);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('打开');
                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4342:13)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.pal().accentSoft);
                }, Text);
                Text.pop();
                Row.pop();
                // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
            ListItem.pop();
        }
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const p = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        itemCreation2(elmtId, isInitialRender);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(4351:11)", "entry");
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Row.create();
                            Row.debugLine("entry/src/main/ets/pages/Index.ets(4352:13)", "entry");
                            Row.width('100%');
                            Row.padding(12);
                            Row.backgroundColor(this.pal().surfaceAlt);
                            Row.borderRadius(8);
                            Row.onClick(() => {
                                this.showPlugins = false;
                                this.panelUrl = p.url;
                            });
                        }, Row);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Column.create();
                            Column.debugLine("entry/src/main/ets/pages/Index.ets(4353:15)", "entry");
                            Column.layoutWeight(1);
                            Column.alignItems(HorizontalAlign.Start);
                        }, Column);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(p.name);
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4354:17)", "entry");
                            Text.fontSize(14);
                            Text.fontColor(this.pal().textPrimary);
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(p.url);
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4355:17)", "entry");
                            Text.fontSize(10);
                            Text.fontColor(this.pal().textMuted);
                            Text.maxLines(1);
                            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                        }, Text);
                        Text.pop();
                        Column.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('打开');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4358:15)", "entry");
                            Text.fontSize(12);
                            Text.fontColor(this.pal().accentSoft);
                        }, Text);
                        Text.pop();
                        Row.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.plugins, forEachItemGenFunction, (p: PluginPanelInfo) => `${p.id}#${p.url}`, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
    }
    // ── 弹层：AskUser ────────────────────────────────────────────────────────
    AskUserSheet(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4378:5)", "entry");
            Column.width('94%');
            Column.padding(16);
            Column.backgroundColor(this.pal().surfaceAlt);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().warn });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('xbot 需要你确认');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4379:7)", "entry");
            Text.fontSize(15);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.pal().warn);
            Text.width('100%');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create();
            List.debugLine("entry/src/main/ets/pages/Index.ets(4380:7)", "entry");
            List.constraintSize({ maxHeight: 420 });
            List.width('100%');
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = (_item, qi: number) => {
                const q = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        itemCreation2(elmtId, isInitialRender);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.debugLine("entry/src/main/ets/pages/Index.ets(4383:13)", "entry");
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Column.create({ space: 6 });
                            Column.debugLine("entry/src/main/ets/pages/Index.ets(4384:15)", "entry");
                            Column.width('100%');
                            Column.padding(8);
                        }, Column);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            If.create();
                            if (q.header !== undefined && q.header.length > 0) {
                                this.ifElseBranchUpdateFunction(0, () => {
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(q.header);
                                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4386:19)", "entry");
                                        Text.fontSize(12);
                                        Text.fontColor(this.pal().textSecondary);
                                        Text.width('100%');
                                    }, Text);
                                    Text.pop();
                                });
                            }
                            else {
                                this.ifElseBranchUpdateFunction(1, () => {
                                });
                            }
                        }, If);
                        If.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(q.question !== undefined ? q.question : '');
                            Text.debugLine("entry/src/main/ets/pages/Index.ets(4388:17)", "entry");
                            Text.fontSize(14);
                            Text.fontColor(this.pal().textPrimary);
                            Text.width('100%');
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            ForEach.create();
                            const forEachItemGenFunction = (_item, oi: number) => {
                                const opt = _item;
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Row.create();
                                    Row.debugLine("entry/src/main/ets/pages/Index.ets(4391:19)", "entry");
                                    Row.width('100%');
                                    Row.padding(8);
                                    Row.backgroundColor(this.pal().surface);
                                    Row.borderRadius(6);
                                    Row.onClick(() => {
                                        this.toggleAskOption(q.id !== undefined ? q.id : `q${qi}`, opt.label !== undefined ? opt.label : '', q.multi_select === true);
                                    });
                                }, Row);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create(this.isAskSelected(q.id !== undefined ? q.id : `q${qi}`, opt.label !== undefined ? opt.label : '') ? '◉' : '○');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4392:21)", "entry");
                                    Text.fontSize(14);
                                    Text.fontColor(this.pal().accentText);
                                }, Text);
                                Text.pop();
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Column.create();
                                    Column.debugLine("entry/src/main/ets/pages/Index.ets(4395:21)", "entry");
                                    Column.layoutWeight(1);
                                    Column.alignItems(HorizontalAlign.Start);
                                    Column.margin({ left: 6 });
                                }, Column);
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create(opt.label !== undefined ? opt.label : '');
                                    Text.debugLine("entry/src/main/ets/pages/Index.ets(4396:23)", "entry");
                                    Text.fontSize(13);
                                    Text.fontColor(this.pal().textPrimary);
                                }, Text);
                                Text.pop();
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    If.create();
                                    if (opt.description !== undefined && opt.description.length > 0) {
                                        this.ifElseBranchUpdateFunction(0, () => {
                                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                                Text.create(opt.description);
                                                Text.debugLine("entry/src/main/ets/pages/Index.ets(4398:25)", "entry");
                                                Text.fontSize(11);
                                                Text.fontColor(this.pal().textMuted);
                                            }, Text);
                                            Text.pop();
                                        });
                                    }
                                    else {
                                        this.ifElseBranchUpdateFunction(1, () => {
                                        });
                                    }
                                }, If);
                                If.pop();
                                Column.pop();
                                Row.pop();
                            };
                            this.forEachUpdateFunction(elmtId, q.options !== undefined ? q.options : [], forEachItemGenFunction, (opt: AskOption, oi: number) => `o-${qi}-${oi}`, true, true);
                        }, ForEach);
                        ForEach.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            If.create();
                            if (q.allow_other === true) {
                                this.ifElseBranchUpdateFunction(0, () => {
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        TextInput.create({ placeholder: '其他（自己填）' });
                                        TextInput.debugLine("entry/src/main/ets/pages/Index.ets(4412:19)", "entry");
                                        TextInput.onChange((v: string) => {
                                            const next: AskSelection[] = [];
                                            for (let i = 0; i < this.askSelections.length; i++) {
                                                const s: AskSelection = this.askSelections[i];
                                                const copy: AskSelection = new AskSelection();
                                                copy.qid = s.qid;
                                                copy.labels = s.labels;
                                                copy.other = s.qid === (q.id !== undefined ? q.id : `q${qi}`) ? v : s.other;
                                                next.push(copy);
                                            }
                                            this.askSelections = next;
                                        });
                                        TextInput.constraintSize({ minHeight: 38 });
                                        TextInput.backgroundColor(this.pal().surfaceAlt);
                                        TextInput.fontColor(this.pal().textPrimary);
                                    }, TextInput);
                                });
                            }
                            else {
                                this.ifElseBranchUpdateFunction(1, () => {
                                });
                            }
                        }, If);
                        If.pop();
                        Column.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.askUser !== null && this.askUser.questions !== undefined ? this.askUser.questions : [], forEachItemGenFunction, (q: AskQuestion, qi: number) => q.id !== undefined ? q.id : `q${qi}`, true, true);
        }, ForEach);
        ForEach.pop();
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4433:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('取消');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(4434:9)", "entry");
            Button.layoutWeight(1);
            Button.constraintSize({ minHeight: 42 });
            Button.backgroundColor(this.pal().surfaceHi);
            Button.onClick(() => {
                this.submitAsk(true);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.askBusy ? '提交中…' : '提交');
            Button.debugLine("entry/src/main/ets/pages/Index.ets(4437:9)", "entry");
            Button.layoutWeight(1);
            Button.constraintSize({ minHeight: 42 });
            Button.backgroundColor(this.pal().accent);
            Button.fontColor(this.pal().onAccent);
            Button.onClick(() => {
                this.submitAsk(false);
            });
        }, Button);
        Button.pop();
        Row.pop();
        Column.pop();
    }
    // ── 弹层：图片查看 ────────────────────────────────────────────────────────
    ImageViewer(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/pages/Index.ets(4452:5)", "entry");
            Column.width('94%');
            Column.height('80%');
            Column.padding(12);
            Column.backgroundColor(this.pal().appBg);
            Column.borderRadius(12);
            Column.border({ width: 1, color: this.pal().border });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 8 });
            Row.debugLine("entry/src/main/ets/pages/Index.ets(4453:7)", "entry");
            Row.width('100%');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('图片');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4454:9)", "entry");
            Text.fontSize(15);
            Text.fontColor(this.pal().textPrimary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (isZoomed(this.imgScale)) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(scaleText(this.imgScale));
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4456:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('复位');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4457:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().accentSoft);
                        Text.padding(6);
                        Text.onClick(() => {
                            this.imgScale = 1;
                            this.imgTransX = 0;
                            this.imgTransY = 0;
                        });
                    }, Text);
                    Text.pop();
                });
            }
            // 保存到相册：走系统安全组件（SaveButton）—— 用户授权后才有写权限，
            // 因此不需要申请相册写权限，也不会在未授权时静默失败。
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 保存到相册：走系统安全组件（SaveButton）—— 用户授权后才有写权限，
            // 因此不需要申请相册写权限，也不会在未授权时静默失败。
            SaveButton.create({ icon: SaveIconStyle.FULL_FILLED, text: SaveDescription.SAVE_IMAGE, buttonType: ButtonType.Capsule });
            SaveButton.debugLine("entry/src/main/ets/pages/Index.ets(4465:9)", "entry");
            // 保存到相册：走系统安全组件（SaveButton）—— 用户授权后才有写权限，
            // 因此不需要申请相册写权限，也不会在未授权时静默失败。
            SaveButton.onClick((event: ClickEvent, result: SaveButtonOnClickResult) => {
                if (result === SaveButtonOnClickResult.SUCCESS) {
                    this.saveToAlbum();
                }
                else {
                    this.toast('需要授权才能保存到相册');
                }
            });
        }, SaveButton);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('✕');
            Text.debugLine("entry/src/main/ets/pages/Index.ets(4473:9)", "entry");
            Text.fontSize(16);
            Text.fontColor(this.pal().textSecondary);
            Text.padding(10);
            Text.onClick(() => {
                this.closeViewer();
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.imageBusy) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("entry/src/main/ets/pages/Index.ets(4479:9)", "entry");
                        Column.layoutWeight(1);
                        Column.justifyContent(FlexAlign.Center);
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/pages/Index.ets(4480:11)", "entry");
                        LoadingProgress.width(32);
                        LoadingProgress.height(32);
                        LoadingProgress.color(this.pal().accent);
                    }, LoadingProgress);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('加载图片…');
                        Text.debugLine("entry/src/main/ets/pages/Index.ets(4481:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.margin({ top: 8 });
                    }, Text);
                    Text.pop();
                    Column.pop();
                });
            }
            else if (this.imagePixel !== null) {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Stack.create();
                        Stack.debugLine("entry/src/main/ets/pages/Index.ets(4484:9)", "entry");
                        Stack.layoutWeight(1);
                        Stack.width('100%');
                        Stack.clip(true);
                        Stack.onAreaChange((oldArea: Area, newArea: Area) => {
                            this.viewW = Number(newArea.width);
                            this.viewH = Number(newArea.height);
                        });
                    }, Stack);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Image.create(this.imagePixel);
                        Image.debugLine("entry/src/main/ets/pages/Index.ets(4485:11)", "entry");
                        Image.objectFit(ImageFit.Contain);
                        Image.width('100%');
                        Image.height('100%');
                        Image.scale({ x: this.imgScale, y: this.imgScale });
                        Image.translate({ x: this.imgTransX, y: this.imgTransY });
                        Gesture.create(GesturePriority.Low);
                        GestureGroup.create(GestureMode.Parallel);
                        // 双指缩放：以手势开始时的缩放为基准（否则会指数级失控）
                        PinchGesture.create({ fingers: 2 });
                        // 双指缩放：以手势开始时的缩放为基准（否则会指数级失控）
                        PinchGesture.onActionStart(() => {
                            this.imgBaseScale = this.imgScale;
                        });
                        // 双指缩放：以手势开始时的缩放为基准（否则会指数级失控）
                        PinchGesture.onActionUpdate((e: GestureEvent) => {
                            this.imgScale = clampScale(this.imgBaseScale * e.scale);
                            if (!isZoomed(this.imgScale)) {
                                this.imgTransX = 0;
                                this.imgTransY = 0;
                            }
                        });
                        // 双指缩放：以手势开始时的缩放为基准（否则会指数级失控）
                        PinchGesture.pop();
                        // 拖动平移：位移同样以手势开始时的位置为基准，并按放大倍数夹取
                        PanGesture.create({ fingers: 1 });
                        // 拖动平移：位移同样以手势开始时的位置为基准，并按放大倍数夹取
                        PanGesture.onActionStart(() => {
                            this.imgBaseX = this.imgTransX;
                            this.imgBaseY = this.imgTransY;
                        });
                        // 拖动平移：位移同样以手势开始时的位置为基准，并按放大倍数夹取
                        PanGesture.onActionUpdate((e: GestureEvent) => {
                            const limX: number = panLimit(this.imgScale, this.viewW, this.imgW);
                            const limY: number = panLimit(this.imgScale, this.viewH, this.imgH);
                            this.imgTransX = clampOffset(this.imgBaseX + e.offsetX, limX);
                            this.imgTransY = clampOffset(this.imgBaseY + e.offsetY, limY);
                        });
                        // 拖动平移：位移同样以手势开始时的位置为基准，并按放大倍数夹取
                        PanGesture.pop();
                        // 双击：1 ↔ 2.5 倍
                        TapGesture.create({ count: 2 });
                        // 双击：1 ↔ 2.5 倍
                        TapGesture.onAction(() => {
                            this.imgScale = nextZoom(this.imgScale);
                            if (!isZoomed(this.imgScale)) {
                                this.imgTransX = 0;
                                this.imgTransY = 0;
                            }
                        });
                        // 双击：1 ↔ 2.5 倍
                        TapGesture.pop();
                        GestureGroup.pop();
                        Gesture.pop();
                    }, Image);
                    Stack.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(2, () => {
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    static getEntryName(): string {
        return "Index";
    }
}
/**
 * `LazyForEach` 的数据源（ArkUI `IDataSource` 壳子）。
 *
 * 为什么放在页面文件里而不是 `core/`：它引用 ArkUI 全局类型（`IDataSource`/`DataChangeListener`），
 * 而 `tools/tests/run.sh` 会把 `core/*.ets` 当纯 TS 在 Node 里编译（没有这些全局）⇒ 放 core 会直接编译失败。
 * 可脱机单测的 diff 逻辑在 `core/rowdiff.ets`。
 *
 * 只做一件事：把「当前该显示哪些行」告诉框架，并按最小代价通知变化
 * （身份不变 ⇒ 逐行 `onDataChange`；身份变了 ⇒ 整表 reload）。
 */
class ChatRowDataSource implements IDataSource {
    private rows: ChatRow[] = [];
    /** 当前承载的**会话身份**（切会话必须整表重建，见 needsFullReload） */
    private chatId: string = '';
    private listeners: DataChangeListener[] = [];
    totalCount(): number {
        return this.rows.length;
    }
    getData(index: number): ChatRow {
        return this.rows[index];
    }
    registerDataChangeListener(listener: DataChangeListener): void {
        if (this.listeners.indexOf(listener) < 0) {
            this.listeners.push(listener);
        }
    }
    unregisterDataChangeListener(listener: DataChangeListener): void {
        const i: number = this.listeners.indexOf(listener);
        if (i >= 0) {
            this.listeners.splice(i, 1);
        }
    }
    /** 当前持有行数（滚动位置的项数计算用）。 */
    count(): number {
        return this.rows.length;
    }
    /** 用新行集替换（骨架不变则只通知变更行，避免整表重建丢滚动锚点）。 */
    applyRows(next: ChatRow[], chatId: string): void {
        // 骨架重建判据必须含**会话身份**（见 core/rowdiff.needsFullReload 的事故注释）
        const structural: boolean = needsFullReload(this.rows, next, this.chatId, chatId);
        const changed: number[] = structural ? [] : changedRowIndices(this.rows, next);
        this.rows = next;
        this.chatId = chatId;
        if (structural) {
            for (let i = 0; i < this.listeners.length; i++) {
                this.listeners[i].onDataReloaded();
            }
            return;
        }
        for (let i = 0; i < changed.length; i++) {
            const idx: number = changed[i];
            for (let j = 0; j < this.listeners.length; j++) {
                this.listeners[j].onDataChange(idx);
            }
        }
    }
}
registerNamedRoute(() => new Index(undefined, {}), "", { bundleName: "com.chronostasys.xbot", moduleName: "entry", pagePath: "pages/Index", pageFullPath: "entry/src/main/ets/pages/Index", integratedHsp: "false", moduleType: "followWithHap" });
