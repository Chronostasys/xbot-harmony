import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { componentSnapshot, componentUtils, display, promptAction } from '@kit.ArkUI';
import { image } from '@kit.ImageKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { vibrator } from '@kit.SensorServiceKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { AppConfig, ConfigStore, isValidServerUrl, normalizeServerUrl } from '../core/config';
import { webview } from '@kit.ArkWeb';
import { ChatStore } from '../core/store';
import { normalizeTheme, Palette, paletteOf, themeLabel, toggleTheme } from '../core/theme';
import { loadErrHint, loadErrTitle, needsRelogin, needsSessionRefresh } from '../core/autherr';
import {
  advanceVisible, clipRunes, isCJK, isTyping, runeCount, TICK_MS, toRunes,
} from '../core/typewriter';
import {
  canMove, MOVE_DOWN, MOVE_TOP, MOVE_UP, hitLine, sessionLabel, sessionMatches,
} from '../core/sessionops';
import {
  BgTask, bgTaskLine, CronJob, cronLine, RunnerRow, runnerLine, SubAgentRow, subagentLine,
} from '../core/panels';
import {
  activeToken, applyCommand, applyMention, CommandItem, enterSends, FsEntry, joinPath, matchCommands,
  matchFiles, parentDir,
} from '../core/composer';
import {
  clampOffset, clampScale, isZoomed, nextZoom, panLimit, saveImageName, scaleText,
} from '../core/imgops';
import {
  fontScaleFrom, fontScaleLabel, fontScalePresets, KEY_APP_THEME, KEY_CODE_WRAP, KEY_FONT_SCALE, KEY_SURFACE,
  KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_REASONING_DEFAULT, KEY_SEND_KEY, normalizeSendKey,
  parseBool, sendKeyLabel, settingOf, settingLabel, SEND_KEY_MOD_ENTER,
} from '../core/settings';
import {
  isInterruptSend, MODE_INTERRUPT, MODE_QUEUE, modeHint, modeLabel, sendToast, toggleMode,
} from '../core/sendmode';
import { mdCacheStats, MdCacheStats } from '../core/markdown';
import { displayContent, displayReasoning, rowIsEmpty, streamStatsText } from '../core/streammerge';
import {
  channelLabel, hiddenRowCount, visibleRows, MAX_ROWS_VISIBLE,
} from '../core/sessionpick';
import {
  ATTACH_DONE, ATTACH_FAILED, ATTACH_UPLOADING, AttachItem, MAX_ATTACH, appendRef, attachChipText,
  attachmentRef, baseName, doneKeys, doneNames, doneRefs, doneSizes, hasRef, humanSize, mimeOf,
  patchByUid, pendingCount, removeByUid,
} from '../core/attach';
import { changedRowIndices, rowKey, sameRowIds, tailRows } from '../core/rowdiff';
import {
  currentTodo, goalText, modelText, todoProgress, usageText,
} from '../core/statusfmt';
import {
  contextPresets, contextText, currentModelText, groupModels, LlmConfig, LlmModelEntry, ModelGroup,
  modelLabel, parseContext, selectable,
} from '../core/llmfmt';
import {
  COPY_RAW, COPY_REPLY, COPY_THINKING, COPY_TOOLS, CopyParts, composeCopy, linkLabel, linksIn,
  resolveOpenable, toolArgsOnly, toolCopyText, toolResultOnly,
} from '../core/msgops';
import {
  AskOption,
  AskQuestion,
  AskUserPrompt,
  ChatRow,
  GoalInfo,
  HistoryIteration,
  PluginPanelInfo,
  QueueItem,
  SearchHit,
  SessionItem,
  TodoItem,
  TokenUsage,
  ToolProgress,
} from '../core/types';
import { MarkdownView } from '../components/MarkdownView';
import { WebSurface } from '../components/WebSurface';

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

@Entry
@Component
struct Index {
  // ── 引导 / 登录 ────────────────────────────────────────────────────────────
  @State booted: boolean = false;
  @State loggedIn: boolean = false;
  @State errMsg: string = '';
  @State serverUrl: string = 'http://';
  @State username: string = '';
  @State password: string = '';
  @State testing: boolean = false;
  @State testMsg: string = '';
  @State recentServers: string[] = [];

  // ── 聊天数据 ──────────────────────────────────────────────────────────────
  @State sessions: SessionItem[] = [];
  @State rows: ChatRow[] = [];
  @State busy: boolean = false;
  /**
   * 加载失败原因（网络/代理不通时最常见）。
   * 聊天页在"列表为空"时必须给出可读原因 + 重试，否则用户看到的就是一片空白，
   * 极易被误判为「渲染坏了 / 完全用不了」。
   */
  @State loadErr: string = '';
  @State currentChat: string = '';
  @State draft: string = '';
  @State hasMore: boolean = false;
  @State loadingMore: boolean = false;
  @State queue: QueueItem[] = [];

  // ── 弹层 ──────────────────────────────────────────────────────────────────
  @State showDrawer: boolean = false;
  @State showSettings: boolean = false;
  @State showQueue: boolean = false;
  @State showPlugins: boolean = false;
  @State showSelfCheck: boolean = false;
  /** 各页版面几何的**屏幕可见文本**（无需网络：截一张图即可把数值带给我） */
  /**
   * 用户当前是否停在列表底部。
   * ⚠️ 自动"跟随到底部"必须由它守卫：流式期间每个事件都会同步一次，若无条件
   * `scrollEdge(Bottom)`，用户往上滚想看工具/思考详情会被立刻拽回底部 ⇒ 表现为"根本没法用"。
   * 与 xbot Web 端既有铁律一致（所有 GotoBottom 调用由 !userScrolledUp 守卫）。
   */
  @State atBottom: boolean = true;

  /** 首屏渲染的行窗口（避免一次性构建几十行；点上方的「显示更早」按批放开） */
  @State rowLimit: number = MAX_ROWS_VISIBLE;

  // ── 附件（web 有、原生原先没有：发文件/图片）──────────────────────────────
  /**
   * 附件列表（支持多选 + 逐条状态）。上传是并发的：**按 uid 回填，不按下标**。
   * 只有 done 的才会进发送载荷；有 uploading 时禁止发送（否则发出没有 key 的空附件）。
   */
  @State attachments: AttachItem[] = [];

  // ── 会话状态栏（todos / goal / token 用量 / cwd）──
  @State showStatus: boolean = false;
  /** LLM 选择栏（订阅/模型/上下文上限；服务端权威值） */
  @State showModel: boolean = false;
  @State llmCfg: LlmConfig | undefined = undefined;
  @State ctxInput: string = '';
  /** 正在切换的模型条目（显示 loading，防连点） */
  @State modelBusy: string = '';

  /**
   * 发送模式：`queue`（排队）| `interrupt`（⚡ 插话）。
   * busy=false 时**必须自动复位**（Web gotcha：否则用户以为在发普通消息，实际插进了别人的回合）。
   */
  @State sendMode: string = MODE_QUEUE;

  // ── P11 输入体验（多行 / 补全 / 震动）──
  /** 当前正在输入的 `/` 或 `@` token（空 = 不显示补全） */
  @State cmdToken: string = '';
  /** 命令候选 */
  @State cmdItems: CommandItem[] = [];
  /** 文件候选（`@` 触发） */
  @State fsEntries: FsEntry[] = [];
  /** 当前列目录（继续下钻用） */
  @State fsDir: string = '/';

  // ── P9 设置（服务端权威：/api/settings；与 web 共用同一份偏好）──
  // ⚠️ 名字必须与**已有的** SettingsSheet（插件/旧设置弹层）区分开，否则 ArkTS 报重复标识符。
  @State showPrefs: boolean = false;
  @State settings: Record<string, string> = {};
  /** 是否已把"思考默认展开"应用过一次（避免每次同步都覆盖用户手动切换） */
  private reasoningDefaultApplied: boolean = false;

  // ── P8 面板（定时任务 / 后台任务 / 子代理 / Runner）──
  @State showPanels: boolean = false;
  /** cron | tasks | subs | runners */
  @State panelTab: string = 'cron';
  @State cronTasks: CronJob[] = [];
  @State bgTasks: BgTask[] = [];
  @State runners: RunnerRow[] = [];
  @State subagents: SubAgentRow[] = [];
  @State panelBusy: boolean = false;

  // ── P7 会话管理（搜索 / 排序 / 分支）──
  /** 抽屉里的本地筛选词（只过滤显示，不打断会话） */
  @State sessQuery: string = '';
  /** 打开「⋯」操作菜单的会话 id（空=关闭） */
  @State sessMenuId: string = '';
  /** 删除二次确认的目标 id */
  @State sessConfirmDelete: string = '';
  /** 会话内消息搜索结果 */
  @State searchHits: SearchHit[] = [];
  @State searchBusy: boolean = false;
  @State showSearchHits: boolean = false;

  // ── 长按菜单（P5 消息操作：消息 / 迭代 / 工具 / 链接）──
  @State ctxOpen: boolean = false;
  /** user | row | iter | tool */
  @State ctxKind: string = '';
  @State ctxRowId: string = '';
  @State ctxIter: number = 0;
  @State ctxTool: string = '';
  @State usage: TokenUsage | undefined = undefined;
  @State cwd: string = '';
  @State todos: TodoItem[] = [];
  @State goal: GoalInfo | undefined = undefined;

  @State geoText: string = '';
  @State geoRunning: boolean = false;
  @State auditing: boolean = false;
  @State auditLog: string = '';
  @State renamingId: string = '';
  @State renameText: string = '';

  // ── AskUser ───────────────────────────────────────────────────────────────
  @State askUser: AskUserPrompt | null = null;
  @State askSelections: AskSelection[] = [];
  @State askBusy: boolean = false;

  // ── 插件 / ArkWeb 面板 ────────────────────────────────────────────────────
  @State plugins: PluginPanelInfo[] = [];
  @State panelUrl: string = '';

  // ── 图片查看 ──────────────────────────────────────────────────────────────
  @State imagePixel: image.PixelMap | null = null;
  @State imageBusy: boolean = false;

  // ── P14 弱网与健壮性 ──
  /**
   * 会话 cookie（**应用级唯一来源**）。
   *
   * ⚠️ 教训（真机 401 事故）：cookie 属于「应用会话」，不属于某个 store 实例。
   * 任何新建的 store 都必须带上它 —— 否则该 store 的每个请求都会 401
   * （多会话池正是这样踩的：头部显示着会话名，历史加载却 401，还被误报成"网络不通"）。
   */
  private cookie: string = '';
  /** 401 只处理一次（多个请求可能同时失败，避免重复弹回登录） */
  private authExpiredHandled: boolean = false;

  /** 应用主题（深/浅；与 Web 共用服务端偏好键 xbot-app-theme） */
  @State themeName: string = 'dark';
  /** SSE 连接状态（来自 store：idle|connecting|open|reconnecting） */
  @State connState: string = 'idle';
  /** 输入框聚焦（合成器卡片描边亮起） */
  @State composerFocused: boolean = false;
  /**
   * 聊天界面承载方式：`web`（默认，ArkWeb 内嵌**完整 web UI** ⇒ 与 web 一比一）或 `native`。
   *
   * 为什么默认 web：用户明确要求「一比一和 web 对齐」。把真实 web UI 嵌进来就是**由构造保证**的
   * 一比一（动画、打字机、样式、状态机全部同一份代码），也避免我重写渲染层时不断偏离。
   * 原生实现完整保留（切到 native 即可用），继续按 web 逐行对齐地演进。
   */
  @State useWebUI: boolean = false;
  /** 内嵌 web UI 的地址（登录成功后写入；空 = 不渲染） */
  @State webUiUrl: string = '';
  @State webCookieReady: boolean = false;
  /** 承载方式偏好是否已套用（只在首次拿到设置时套用，之后尊重用户本次切换） */
  private surfaceApplied: boolean = false;

  /** 安全区（状态栏/导航栏高度，由 EntryAbility 写入）—— 消除"内容顶到状态栏" */
  @StorageProp('safeTopVp') safeTop: number = 0;
  @StorageProp('safeBottomVp') safeBottom: number = 0;

  // ── live 进行中快照（与 web 的 progressSnapshot→LiveIteration 同构）──
  // 渲染在 LazyForEach **之外**、由 @State 直接驱动：虚拟列表条目在真机上不可靠地
  // 重建是"流式期间什么都看不到"（无打字机、无工具、结束时内容一次性冒出）的根因。
  @State liveOn: boolean = false;
  @State liveText: string = '';
  @State liveReasoning: string = '';
  @State liveTools: ToolProgress[] = [];
  @State liveIterNo: number = 0;
  @State liveRowTurn: number = 0;
  @State liveReasonOpen: boolean = false;
  /** 历史加载中（骨架屏判据：只有"还没内容且正在拉"才展示） */
  @State historyLoading: boolean = false;
  // ── 打字机特效（与 web 同算法：50ms 一拍 / gap÷3 / CJK 半速；见 core/typewriter.ets）──
  /** live 迭代正文的可见码点数 */
  @State twContent: number = 0;
  /** live 迭代思考的可见码点数 */
  @State twReason: number = 0;
  /** 打字机当前绑定的身份（`行id#迭代号`；变了就重置，避免上一段文本的进度串到新文本） */
  private twKey: string = '';
  /** 打字机绑定的 live 行 id（每拍 bump 它的 rev，让 LazyForEach 重建该条目） */
  private twRowId: string = '';
  private twTextRunes: string[] = [];
  private twReasonRunes: string[] = [];
  private twTextLen: number = -1;
  private twReasonLen: number = -1;
  private twSkip: boolean = false;
  private twTimer: number = -1;

  /** 运行中工具的流光位置（纯 transform，不触发布局） */
  @State sweepX: number = -80;
  /** 切会话时列表淡入（0.001 → 1 由 animateTo 驱动） */
  @State listAlpha: number = 1;
  /** 上次发送失败的正文（提供一键重试） */
  @State failedSend: string = '';
  private draftTimer: number = -1;
  /**
   * 运行脉冲（P13）：只在有回合在跑时用 600ms 定时器翻转一次 opacity。
   * 为什么用 opacity 而不是 layout 属性：触屏设备上 layout 动画（height/width）会掉帧，
   * 这是项目里已定稿的规矩（Web 端同款）。
   */
  @State pulseOn: boolean = true;
  private pulseTimer: number = -1;
  // ── P12 查看器：缩放/平移（夹取逻辑在 core/imgops.ets，已单测）──
  @State imgScale: number = 1;
  @State imgTransX: number = 0;
  @State imgTransY: number = 0;
  @State imgW: number = 0;
  @State imgH: number = 0;
  @State viewW: number = 0;
  @State viewH: number = 0;
  private imgBaseScale: number = 1;
  private imgBaseX: number = 0;
  private imgBaseY: number = 0;

  // ── 工具/迭代展开 ─────────────────────────────────────────────────────────
  @State openToolKey: string = '';
  @State openReasonKey: string = '';
  /** 展开了全部迭代的 turn（默认只渲染最近 MAX_ITER_VISIBLE 个，防长 turn 爆炸） */
  @State expandedTurn: string = '';

  // ── 显示设置 ──────────────────────────────────────────────────────────────
  @State showReasoning: boolean = true;

  private store: ChatStore | null = null;
  /** 合并同步用：待同步的 store 与"已排帧"标志（见 scheduleSync） */
  private pendingSync: ChatStore | null = null;

  /**
   * 多会话池（P10）：最多同时保持 3 个会话的 SSE 与状态。
   *
   * 为什么要池：切会话若"关连接 + 重建 + 重拉历史"，用户会看到 loading 与重连空窗；
   * 池化后**切回已打开的会话是瞬时的**（状态一直在累积），后台会话的进度也不丢
   * （后端仍在推，它自己的 store 一直在收）。超出上限按 LRU 驱逐并 dispose（关 SSE）。
   */
  private pools: Map<string, ChatStore> = new Map<string, ChatStore>();
  private poolOrder: string[] = [];
  private syncScheduled: boolean = false;
  private config: ConfigStore = new ConfigStore();
  private listScroller: Scroller = new Scroller();
  /**
   * `LazyForEach` 数据源：只有可视区附近的行会被真正构建（真虚拟化）。
   * 之前 `List` + `ForEach` 一次性构建全部行 ⇒ 几十行 × 每行多个 Markdown 迭代块 = 数千节点。
   */
  private rowDs: ChatRowDataSource = new ChatRowDataSource();

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
    } catch (e) {
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
      } catch (e) {
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
  private syncPulse(busy: boolean): void {
    if (busy && this.pulseTimer < 0) {
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
    // 切会话 ⇒ 用户预期"看到最新"，总是跳到底（此时门控必须放行）
    if (store.currentChatId !== this.currentChat) {
      this.atBottom = true;
      this.rowLimit = MAX_ROWS_VISIBLE;   // 切会话重置行窗口（否则行数会无限累积增长）
    }
    this.sessions = store.sessions.slice();
    this.rows = store.rows.slice();
    this.syncRowDs();
    this.syncLiveTail(store);
    this.busy = store.busy;
    this.connState = store.connState;
    this.syncPulse(store.busy);
    this.pumpTypewriter();
    this.currentChat = store.currentChatId;
    this.hasMore = store.hasMore;
    this.loadingMore = store.loadingMore;
    this.queue = store.queue.slice();
    this.usage = store.usage;
    this.cwd = store.cwd;
    this.todos = store.todos.slice();
    this.goal = store.goal;
    this.llmCfg = store.llmConfig;
    this.cronTasks = store.cronTasks;
    this.bgTasks = store.bgTasks;
    this.runners = store.runners;
    this.subagents = store.subagents;
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
        } catch (e) {
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
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.testMsg = `❌ 连不上：${err.message}（检查 IP/端口、手机是否同网段、服务端是否在跑）`;
    } finally {
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
    } catch (e) {
      this.geoText = `采集失败: ${errText(e as Object)}`;
    } finally {
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
    } catch (e) {
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
      } catch (e) {
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
      } catch (e) {
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
      } catch (e) {
        done.push(`03-settings=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 03-settings ---\n${this.collectGeometry()}`);
      this.showSettings = false;
      // 渲染自检
      this.showSelfCheck = true;
      await this.wait(1200);
      try {
        done.push(`04-selfcheck=${await this.captureAndUpload('04-selfcheck')}`);
      } catch (e) {
        done.push(`04-selfcheck=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 04-selfcheck ---\n${this.collectGeometry()}`);
      this.showSelfCheck = false;
      // 队列（有内容才有意义，无内容也截，便于对比）
      this.showQueue = true;
      await this.wait(900);
      try {
        done.push(`05-queue=${await this.captureAndUpload('05-queue')}`);
      } catch (e) {
        done.push(`05-queue=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 05-queue ---\n${this.collectGeometry()}`);
      this.showQueue = false;
      // 能力面板
      await this.openPlugins();
      await this.wait(900);
      try {
        done.push(`06-plugins=${await this.captureAndUpload('06-plugins')}`);
      } catch (e) {
        done.push(`06-plugins=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 06-plugins ---\n${this.collectGeometry()}`);
      this.showPlugins = false;
      await this.wait(400);
      try {
        done.push(`07-chat-back=${await this.captureAndUpload('07-chat-back')}`);
      } catch (e) {
        done.push(`07-chat-back=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 07-chat-back ---\n${this.collectGeometry()}`);
      this.auditLog = done.join('  ');
      this.toast('走查完成，已上传 7 张截图 + 1 份版面几何');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.auditLog = `失败: ${err.message}（已完成: ${done.join(' ') }）`;
      this.toast(`走查失败: ${err.message}`);
    } finally {
      // 几何数值必须送达（唯一不依赖图像的信息）：即使中途失败也要上传
      const st: ChatStore | null = this.store;
      if (st !== null && geo.length > 0) {
        try {
          const txt: string = geo.join('\n\n');
          const bytes: Uint8Array = new Uint8Array(new util.TextEncoder().encodeInto(txt));
          await st.http.uploadBytes('/api/files/upload', 'audit-layout.txt',
            bytes.buffer as ArrayBuffer, 'text/plain');
          this.auditLog = `${this.auditLog}\n几何已上传(${geo.length} 页)`;
        } catch (e) {
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
    } catch (e) {
      this.errMsg = `[登录请求] ${errText(e)}`;
      return;
    }
    try {
      await store.loadSessions();
      this.attach(store);
    } catch (e) {
      this.errMsg = `[加载会话] ${errText(e)}`;
      return;
    }
    try {
      this.cookie = store.http.exportSessionCookie();
      this.authExpiredHandled = false;
      await this.config.save(url, this.username, this.cookie);
      this.recentServers = this.config.recentServers();
    } catch (e) {
      this.errMsg = `[保存登录态] ${errText(e)}`;
      return;
    }
    this.loggedIn = true;
    const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
    if (first !== undefined && first.chat_id !== undefined) {
      try {
        await store.openSession(first.chat_id);
      } catch (e) {
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
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.errMsg = err.message;
    }
  }

  private async doLogout(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store !== null) {
      try {
        await store.http.logout();
      } catch (e) {
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
      } else {
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
    const target: ChatStore = this.storeFor(chatId);
    // 会话列表是**应用级**数据，但快照存在 store 上：池里刚建的 store 是空的，
    // 若直接切过去，抽屉会没数据、渠道解析也会错（⇒ 404）。这里先补齐。
    if (target.sessions.length === 0) {
      try {
        await target.loadSessions();
      } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
      } catch (e) {
        this.attachments = patchByUid(this.attachments, it.uid, '', 0, ATTACH_FAILED, errText(e as Object));
      }
    } catch (e) {
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
      } else {
        interrupted = await store.send(content, undefined, undefined, undefined, interrupt);
      }
      this.failedSend = '';
      const note: string = sendToast(interrupted, busyBefore);
      if (note.length > 0) {
        this.toast(note);
      }
    } catch (e) {
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
      } else {
        this.currentChat = '';
        this.rows = [];
        this.syncRowDs();
      }
    } catch (e) {
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
      } else {
        await store.openSession(this.currentChat);
      }
    } catch (e) {
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
      } else if (s.labels.indexOf(label) >= 0) {
        copy.labels = s.labels.filter((x: string) => x !== label);
      } else {
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
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`提交失败: ${err.message}`);
    } finally {
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
    } catch (e) {
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
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`图片解码失败: ${err.message}`);
    } finally {
      this.imageBusy = false;
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  build() {
    Stack() {
      if (!this.booted) {
        this.LoadingView()
      } else if (!this.loggedIn) {
        this.LoginView()
      } else {
        this.ChatView()
      }

      // 会话抽屉
      if (this.showDrawer) {
        this.DrawerSheet()
      }
      // 设置
      if (this.showSettings) {
        this.SettingsSheet()
      }
      // 队列
      if (this.showQueue) {
        this.QueueSheet()
      }
      // 插件面板选择
      if (this.showPlugins) {
        this.PluginsSheet()
      }
      // AskUser（服务端权威：有 pending 就弹）
      if (this.askUser !== null) {
        this.AskUserSheet()
      }
      // 渲染自检（逐构件隔离排查用）
      if (this.showSelfCheck) {
        this.SelfCheckSheet()
      }
      // 会话状态（todos / goal / 用量 / cwd）
      if (this.showStatus) {
        this.StatusSheet()
      }
      // 模型 / 上下文上限选择栏
      if (this.showModel) {
        this.ModelSheet()
      }
      // 偏好设置（字号 / 换行 / 思考默认 / 快捷键）
      if (this.showPrefs) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.showPrefs = false;
          })
          this.PrefsSheet()
        }.width('100%').height('100%')
      }
      // 面板（定时任务 / 后台任务 / 子代理 / Runner）
      if (this.showPanels) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.showPanels = false;
          })
          this.PanelsSheet()
        }.width('100%').height('100%')
      }
      // 会话操作菜单（置顶/上移/下移/改名/分支/删除）
      if (this.sessMenuId.length > 0) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.sessMenuId = '';
            this.sessConfirmDelete = '';
          })
          this.SessSheet()
        }.width('100%').height('100%')
      }
      // 会话内搜索结果
      if (this.showSearchHits) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.showSearchHits = false;
          })
          this.SearchHitsSheet()
        }.width('100%').height('100%')
      }
      // 长按操作菜单（消息 / 迭代 / 工具 / 链接）——贴底弹出，点空白关闭
      if (this.ctxOpen) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.ctxOpen = false;
          })
          this.ContextSheet()
        }.width('100%').height('100%')
      }
      // 图片查看
      if (this.imagePixel !== null || this.imageBusy) {
        this.ImageViewer()
      }
      // ArkWeb 逃生舱（插件 UI / GenUI / 终端 / 编辑器 / 完整 Web UI）
      if (this.panelUrl.length > 0) {
        WebSurface({ url: this.panelUrl, theme: this.themeName, onClose: () => {
          this.panelUrl = '';
        } })
      }
    }
    .width('100%')
    .height('100%')
    .padding({ top: this.safeTop, bottom: this.safeBottom })
    .backgroundColor(this.pal().appBg)
    .id('xbot-root')
  }

  @Builder
  LoadingView() {
    Column() {
      LoadingProgress().width(48).height(48).color(this.pal().accent)
      Text('xbot').fontSize(18).fontColor(this.pal().textPrimary).margin({ top: 12 })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  LoginView() {
    Column({ space: 12 }) {
      Text('xbot').fontSize(34).fontWeight(FontWeight.Bold)
        .linearGradient({ angle: 135, colors: [[this.pal().accent, 0.0], [this.pal().accentSoft, 1.0]] })
      Text('连接你的 xbot 服务端（原生鸿蒙客户端）').fontSize(13).fontColor(this.pal().textSecondary).margin({ bottom: 8 })

      TextInput({ placeholder: '服务端地址，如 192.168.1.10:16000', text: this.serverUrl })
        .onChange((v: string) => {
          this.serverUrl = v;
          this.testMsg = '';
        })
        .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
        .constraintSize({ minHeight: 46 }).borderRadius(12).padding({ left: 12, right: 12 })

      // 最近用过的地址（一点即填，省得重打 IP）
      if (this.recentServers.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.recentServers, (u: string) => {
            Text(u)
              .fontSize(11).fontColor(this.pal().accentSoft)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .margin(2)
              .backgroundColor(this.pal().surfaceAlt).borderRadius(6)
              .onClick(() => {
                this.serverUrl = u;
                this.testMsg = '';
              })
          }, (u: string) => u)
        }
        .width('100%')
      }

      Row({ space: 8 }) {
        Button(this.testing ? '测试中…' : '测试连接')
          .layoutWeight(1).constraintSize({ minHeight: 38 })
          .backgroundColor(this.pal().surfaceHi)
          .onClick(() => {
            this.testConnection();
          })
      }
      .width('100%')

      if (this.testMsg.length > 0) {
        Text(this.testMsg).fontSize(12)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontColor(this.testMsg.startsWith('✅') ? this.pal().successText : this.pal().warn)
          .width('100%')
      }
      TextInput({ placeholder: '用户名', text: this.username })
        .onChange((v: string) => {
          this.username = v;
        })
        .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
        .constraintSize({ minHeight: 46 }).borderRadius(12).padding({ left: 12, right: 12 })
      TextInput({ placeholder: '密码' })
        .type(InputType.Password)
        .onChange((v: string) => {
          this.password = v;
        })
        .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
        .constraintSize({ minHeight: 46 }).borderRadius(12).padding({ left: 12, right: 12 })

      if (this.errMsg.length > 0) {
        Text(this.errMsg).fontSize(12).fontColor(this.pal().dangerText).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }

      Button('登录').width('100%').constraintSize({ minHeight: 44 })
        .backgroundColor(this.pal().accent).fontColor(this.pal().onAccent)
        .onClick(() => {
          this.doLogin();
        })
      Button('注册（仅服务端允许时）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().surfaceHi)
        .onClick(() => {
          this.doRegister();
        })
      // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
      Text('渲染自检（排查渲染问题用）')
        .fontSize(12).fontColor(this.pal().accentSoft).margin({ top: 8 })
        .onClick(() => {
          this.showSelfCheck = true;
        })
    }
    .padding(24).width('100%').height('100%').justifyContent(FlexAlign.Center)
    .id('xbot-login')
  }

  @Builder
  ChatView() {
    Column() {
      // 顶栏
      Row() {
        Text('☰').fontSize(20).fontColor(this.pal().textPrimary).padding(10).onClick(() => {
          this.openDrawer();
        })
        Column() {
          Text(this.currentChat.length > 0 ? this.labelOf(this.currentChat) : 'xbot')
            .fontSize(15).fontColor(this.pal().textPrimary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.busy ? '运行中…' : '空闲')
            .fontSize(11).fontColor(this.busy ? this.pal().warn : this.pal().textMuted)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (this.queue.length > 0) {
          Text(`队列 ${this.queue.length}`)
            .fontSize(12).fontColor(this.pal().warn).padding(8)
            .onClick(() => {
              this.showQueue = true;
            })
        }
        Text('⊞').fontSize(20).fontColor(this.pal().textPrimary).padding(10).onClick(() => {
          this.openPlugins();
        })
        Text('⚙').fontSize(20).fontColor(this.pal().textPrimary).padding(10).onClick(() => {
          this.anim(() => {
            this.showSettings = true;
          });
        })
      }
      .width('100%').constraintSize({ minHeight: 56 }).padding({ left: 4, right: 4 }).backgroundColor(this.pal().surfaceAlt)
      .id('xbot-header')

      // 加载失败且列表为空 ⇒ 明确提示 + 重试（网络/代理故障时界面必须自解释）
      if (this.rows.length === 0 && this.loadErr.length > 0) {
        Column({ space: 8 }) {
          Text(loadErrTitle(this.loadErr)).fontSize(14).fontColor(this.pal().dangerText)
          Text(this.loadErr).fontSize(12).fontColor(this.pal().textSecondary)
            .maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(loadErrHint(this.loadErr))
            .fontSize(11).fontColor(this.pal().textMuted).maxLines(3)
          // 判据与标题同一处：401 给「重新登录」，其余给「重试」
          Button(needsRelogin(this.loadErr) ? '重新登录' : (needsSessionRefresh(this.loadErr) ? '刷新会话列表' : '重试'))
            .constraintSize({ minHeight: 38 }).backgroundColor(this.pal().accent).onClick(() => {
              if (needsRelogin(this.loadErr)) {
                this.handleAuthExpired();
              } else if (needsSessionRefresh(this.loadErr)) {
                this.recoverMissingSession();
              } else {
                this.retryLoad();
              }
            })
        }
        .width('100%').padding(16).alignItems(HorizontalAlign.Start)
        .backgroundColor(this.pal().surfaceAlt).borderRadius(10).margin({ left: 12, right: 12, top: 12 })
      }

      // 空态：没有消息、没有错误、也不在跑 —— 给友好的起步引导（而不是一片黑洞）
      if (this.rows.length === 0 && this.loadErr.length === 0 && !this.busy
        && !this.loadingMore && this.currentChat.length > 0) {
        Column({ space: 10 }) {
          Text('✦').fontSize(44).fontColor(this.pal().accent)
            .opacity(this.pulseOn ? 1 : 0.55)
            .animation({ duration: 1400, curve: Curve.EaseInOut })
          Text('开始对话').fontSize(18).fontColor(this.pal().textPrimary).fontWeight(FontWeight.Medium)
          Text('直接说需求；也可以用 / 选命令、@ 提文件、📎 加附件')
            .fontSize(12).fontColor(this.pal().textMuted).textAlign(TextAlign.Center)
            .padding({ left: 32, right: 32 })
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        .id('xbot-empty-state')
      }

      // 骨架屏：历史还没到时给"内容即将出现"的观感（比裸转圈自然）
      if (!this.historyLoading && this.currentChat.length > 0 && this.rows.length === 0) {
        Column({ space: 10 }) {
          ForEach([0, 1, 2, 3], (i: number) => {
            Row({ space: 8 }) {
              Circle({ width: 26, height: 26 }).fill(this.pal().surfaceHi)
              Column({ space: 6 }) {
                Row().width(i % 2 === 0 ? '72%' : '54%').height(10)
                  .backgroundColor(this.pal().surfaceHi).borderRadius(5)
                Row().width(i % 2 === 0 ? '46%' : '64%').height(10)
                  .backgroundColor(this.pal().surfaceHi).borderRadius(5)
                  .opacity(this.pulseOn ? 0.85 : 0.45)
                  .animation({ duration: 900, curve: Curve.EaseInOut })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.width('100%')
          }, (i: number) => `sk-${i}`)
        }
        .width('100%').layoutWeight(1).padding({ left: 4, right: 4, top: 12 })
        .id('xbot-skeleton')
      }

      // 消息列表
      List({ scroller: this.listScroller }) {
        if (this.hasMore || this.loadingMore) {
          ListItem() {
            Row() {
              if (this.loadingMore) {
                LoadingProgress().width(16).height(16).color(this.pal().accent)
                Text('加载更早消息…').fontSize(12).fontColor(this.pal().textSecondary).margin({ left: 6 })
              } else {
                Text('↑ 加载更早消息').fontSize(12).fontColor(this.pal().accentSoft).onClick(() => {
                  this.loadMore();
                })
              }
            }
            .width('100%').justifyContent(FlexAlign.Center).padding(10)
          }
        }

        // 行窗口：`List` + `ForEach` 会**一次性构建全部行**（每行 ≤16 个迭代块 × Markdown）
        // ⇒ 几十行就是几千个节点（真机"很卡、交互差"的主因之一）。只渲染末尾 rowLimit 行，
        // 更早的按批放开。
        if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
          ListItem() {
            Row() {
              Text(`↑ 显示更早的 ${hiddenRowCount(this.rows.length, this.rowLimit)} 条`)
                .fontSize(12).fontColor(this.pal().accentSoft)
            }
            .width('100%').justifyContent(FlexAlign.Center).padding(10)
            .onClick(() => {
              this.rowLimit += MAX_ROWS_VISIBLE;
              this.syncRowDs();
            })
          }
        }
        LazyForEach(this.rowDs, (row: ChatRow) => {
          ListItem() {
            this.ChatRowBody(row)
          }
        }, (row: ChatRow) => rowKey(row))

        // ── live 进行中块（LazyForEach 之外，@State 直驱 ⇒ 流式/打字机/工具必然渲染）──
        if (this.liveTailHasContent()) {
          ListItem() {
            this.LiveTail()
          }
        }

        if (this.busy && !this.liveTailHasContent()) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(16).height(16).color(this.pal().accent)
              Text('思考中…').fontSize(13).fontColor(this.pal().textSecondary)
                .opacity(this.pulseOn ? 1 : 0.45)
                .animation({ duration: 600, curve: Curve.EaseInOut })
            }.padding({ left: 14, top: 8, bottom: 8 })
          }
        }
      }
      .layoutWeight(1).width('100%').edgeEffect(EdgeEffect.Spring).padding({ left: 8, right: 8 })
      .opacity(this.listAlpha)
      // 预构建 4 行：滚动时不必等构建（越小内存越省，越大滚动越顺）
      .cachedCount(4)
      // 跟踪"用户是否停在底部"：end 是最后一个可见项的下标，等于末项下标即在底部。
      // 项数 = [可选"加载更早"] + rows + [可选 busy 指示器]，故用 listItemCount() 显式算。
      .onScrollIndex((start: number, end: number) => {
        this.atBottom = end >= listItemCount(this.hasMore, this.loadingMore, this.rowDs.count(),
          this.busy || this.liveOn) - 1;
      })
      .id('xbot-list')

      // 不在底部时给一个「回到最新」（列表很长时不用一路滑）
      if (!this.atBottom && this.rows.length > 0) {
        Row() {
          Text('↓ 回到最新').fontSize(12).fontColor(this.pal().textPrimary)
            .padding({ left: 12, right: 12, top: 7, bottom: 7 })
            .backgroundColor(this.pal().accentDeep)
            .borderRadius(16)
            .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.listScroller.scrollEdge(Edge.Bottom);
              this.atBottom = true;
            })
        }
        .width('100%').justifyContent(FlexAlign.Center)
        .padding({ top: 2, bottom: 2 })
      }

      // 状态栏：模型 · token 用量 · todos · goal（点开看全部；全部来自服务端权威值）
      if (this.statusBarText().length > 0) {
        Row({ space: 10 }) {
          Text(this.statusBarText())
            .fontSize(11).fontColor(this.pal().textSecondary).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.todoCount() > 0 || this.goalLine().length > 0) {
            Text('详情').fontSize(11).fontColor(this.pal().accentSoft).padding({ left: 6, right: 6 })
          }
        }
        .width('100%').padding({ left: 10, right: 10, top: 4, bottom: 2 })
        .onClick(() => {
          this.anim(() => {
            this.showStatus = true;
          });
        })
      }

      // 弱网：连接断开时明确告知（并说明恢复后会自动补齐，避免用户重复发）
      if (this.connState === 'reconnecting' || this.connState === 'connecting') {
        Row({ space: 6 }) {
          LoadingProgress().width(14).height(14).color(this.pal().warn)
          Text('连接断开，正在重连…（恢复后自动补齐消息）')
            .fontSize(11).fontColor(this.pal().warn).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%').padding({ left: 12, right: 12, top: 6, bottom: 6 })
        .backgroundColor(this.pal().warnBg)
      }

      // 上次发送失败 ⇒ 一键重试（不必重新打字）
      if (this.failedSend.length > 0) {
        Row({ space: 8 }) {
          Text('上次发送失败').fontSize(12).fontColor(this.pal().dangerText).layoutWeight(1)
          Text('重试').fontSize(12).fontColor(this.pal().warn).padding(6)
            .stateStyles({ pressed: { .opacity(0.7) }, normal: { .opacity(1) } })
            .onClick(() => {
              const t: string = this.failedSend;
              this.failedSend = '';
              this.draft = t;
              this.sendDraft();
            })
          Text('丢弃').fontSize(12).fontColor(this.pal().textSecondary).padding(6)
            .onClick(() => {
              this.failedSend = '';
            })
        }
        .width('100%').padding({ left: 10, right: 6, top: 6, bottom: 2 })
      }

      // 输入补全（/ 命令 或 @ 文件）
      if (this.cmdToken.length > 0 && (this.cmdItems.length > 0 || this.fsEntries.length > 0)) {
        Column({ space: 2 }) {
          if (this.cmdItems.length > 0) {
            ForEach(this.cmdItems.slice(0, 6), (c: CommandItem) => {
              Row({ space: 8 }) {
                Text(c.name).fontSize(13).fontColor(this.pal().accentText).constraintSize({ maxWidth: 150 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(c.desc).fontSize(11).fontColor(this.pal().textMuted).layoutWeight(1)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%').padding({ left: 10, right: 10, top: 7, bottom: 7 })
              .backgroundColor(this.pal().surface).borderRadius(6)
              .onClick(() => {
                this.pickCommand(c.name);
              })
            }, (c: CommandItem) => `cc-${c.name}`)
          }
          if (this.fsEntries.length > 0) {
            ForEach(this.fsEntries.slice(0, 8), (e: FsEntry) => {
              Row({ space: 8 }) {
                Text(e.isDir ? '📁' : '📄').fontSize(12)
                Text(e.name).fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(this.fsDir).fontSize(10).fontColor(this.pal().textMuted)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 120 })
              }
              .width('100%').padding({ left: 10, right: 10, top: 7, bottom: 7 })
              .backgroundColor(this.pal().surface).borderRadius(6)
              .onClick(() => {
                this.pickFile(e);
              })
            }, (e: FsEntry) => `fe-${e.name}#${e.isDir}`)
          }
        }
        .width('100%').padding({ left: 8, right: 8, bottom: 4 })
        .backgroundColor(this.pal().appBg).borderRadius(8)
        .border({ width: 1, color: this.pal().border })
      }

      // 会话标签（池里的会话，切回瞬时；● 表示该会话正在跑）
      if (this.poolOrder.length > 1) {
        Scroll() {
          Row({ space: 6 }) {
            ForEach(this.poolOrder, (cid: string) => {
              Row({ space: 4 }) {
                Text(this.tabLabel(cid)).fontSize(11)
                  .fontColor(cid === this.currentChat ? this.pal().onAccent : this.pal().textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 90 })
                if (this.tabRunning(cid)) {
                  Text('●').fontSize(9).fontColor(this.pal().successText)
                }
                Text('✕').fontSize(10).fontColor(this.pal().textMuted)
                  .onClick(() => {
                    this.closeTab(cid);
                  })
              }
              .padding({ left: 8, right: 6, top: 4, bottom: 4 })
              .backgroundColor(cid === this.currentChat ? this.pal().accentDeep : this.pal().surfaceAlt)
              .borderRadius(6)
              .onClick(() => {
                if (cid !== this.currentChat) {
                  this.switchSession(cid);
                }
              })
            }, (cid: string) => `tab-${cid}#${cid === this.currentChat}#${this.tabRunning(cid)}`)
          }
        }
        .scrollable(ScrollDirection.Horizontal)
        .width('100%').padding({ left: 10, right: 10, top: 6 })
      }

      // 附件 chips：每条独立状态（⏳ 上传中 / 📎 已就绪 / ⚠ 失败可重试），✕ 移除
      if (this.attachments.length > 0) {
        Column({ space: 4 }) {
          ForEach(this.attachments, (it: AttachItem, i: number) => {
            Row({ space: 6 }) {
              Text(attachChipText(it))
                .fontSize(12)
                .fontColor(it.status === ATTACH_FAILED ? this.pal().dangerText : this.pal().accentSoft)
                .layoutWeight(1).maxLines(1).wordBreak(WordBreak.BREAK_ALL)
              Text(it.status === ATTACH_FAILED ? '重试' : '✕')
                .fontSize(12)
                .fontColor(it.status === ATTACH_FAILED ? this.pal().warn : this.pal().dangerText)
                .padding(6)
                .onClick(() => {
                  if (it.status === ATTACH_FAILED) {
                    this.retryAttachment(it.uid);
                  } else {
                    this.removeAttachment(it.uid);
                  }
                })
            }.width('100%')
          }, (it: AttachItem, i: number) => `${it.uid}#${it.status}`)
        }
        .width('100%').padding({ left: 10, right: 4, top: 6 })
      }

      // 输入区：圆角卡片（附件 / 输入 / 发送），聚焦时描边亮起
      Row({ space: 6 }) {
        Text('📎').fontSize(19).fontColor(this.pal().accentSoft).padding(6)
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.pickFiles();
          })
        Text('▣').fontSize(19).fontColor(this.pal().accentSoft).padding(6)
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.pickImages();
          })
        TextArea({ placeholder: '发消息…', text: this.draft })
          .onChange((v: string) => {
            this.draft = v;
            this.refreshCompletion(v);
            this.scheduleDraftSave(v);
          })
          .enterKeyType(enterSends(this.sendKeyMode()) ? EnterKeyType.Send : EnterKeyType.NEW_LINE)
          .onPaste((value: string, event: PasteEvent) => {
            this.pasteImage();
          })
          .onFocus(() => {
            this.composerFocused = true;
          })
          .onBlur(() => {
            this.composerFocused = false;
          })
          .layoutWeight(1).constraintSize({ minHeight: 40, maxHeight: 150 })
          .backgroundColor('#00000000').fontColor(this.pal().textPrimary)
          .borderRadius(0).padding({ left: 2, right: 2 })
          .onSubmit(() => {
            if (enterSends(this.sendKeyMode())) {
              this.sendDraft();
            }
          })
        if (this.busy) {
          Text(modeLabel(this.sendMode))
            .fontSize(12)
            .fontColor(this.sendMode === MODE_INTERRUPT ? this.pal().warn : this.pal().textSecondary)
            .padding({ left: 8, right: 8, top: 8, bottom: 8 })
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(8)
            .border({ width: 1, color: this.sendMode === MODE_INTERRUPT ? this.pal().warn : this.pal().border })
            .onClick(() => {
              this.sendMode = toggleMode(this.sendMode);
              this.toast(modeHint(this.sendMode));
            })
        }
        Button(this.runningNow() ? '停止' : '发送')
          .constraintSize({ minHeight: 38, minWidth: 76 })
          .borderRadius(19)
          .fontColor(this.pal().onAccent)
          .backgroundColor(this.pal().accent)
          .linearGradient({
            angle: 135,
            colors: this.runningNow()
              ? [[this.pal().dangerBg, 0.0], [this.pal().dangerBg, 1.0]]
              : [[this.pal().accent, 0.0], [this.pal().bubbleUser, 1.0]],
          })
          .shadow({ radius: 10, color: '#33000000', offsetX: 0, offsetY: 2 })
          .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
          .onClick(() => {
            if (this.runningNow()) {
              this.store?.cancel();
            } else {
              this.sendDraft();
            }
          })
      }
      .width('100%').padding({ left: 8, right: 8, top: 8, bottom: 8 })
      .backgroundColor(this.pal().surface)
      .borderRadius(22)
      .border({ width: 1, color: this.composerFocused ? this.pal().accent : this.pal().border })
      .shadow({ radius: 14, color: '#1A000000', offsetX: 0, offsetY: 3 })
      .margin({ left: 8, right: 8, top: 2, bottom: 8 })
      .id('xbot-composer')
    }
    .width('100%').height('100%')
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
      } catch (e) {
        this.toast(`删除失败: ${errText(e as Object)}`);
      }
      return;
    }
    if (code === MOVE_TOP || code === MOVE_UP || code === MOVE_DOWN) {
      this.sessMenuId = '';
      try {
        await store.reorderSessions(this.sessionIds(), id, code);
      } catch (e) {
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
      } catch (e) {
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
   * 把 live 迭代的正文/思考喂给打字机。
   *
   * 算法与 web `useTypewriter` 一致：50ms 一拍、每拍前进 `gap/3`（至少 1）、CJK 每隔一拍才走
   * （中文否则会"哗"地全出来）。**只在文本增长时重算码点表**（每帧对长文本重算会很贵）。
   */
  private pumpTypewriter(): void {
    let row: ChatRow | undefined = undefined;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].isLive === true) {
        row = this.rows[i];
        break;
      }
    }
    let it: HistoryIteration | undefined = undefined;
    if (row !== undefined && row.iterations.length > 0) {
      it = row.iterations[row.iterations.length - 1];
    }
    const key: string = row !== undefined && it !== undefined ? `${row.id}#${it.iteration}` : '';
    this.twRowId = row !== undefined ? row.id : '';
    if (key !== this.twKey) {
      this.twKey = key;
      this.twContent = 0;
      this.twReason = 0;
      this.twTextRunes = [];
      this.twReasonRunes = [];
      this.twTextLen = -1;
      this.twReasonLen = -1;
      this.twSkip = false;
    }
    const text: string = it !== undefined ? displayContent(it) : '';
    const reason: string = it !== undefined ? displayReasoning(it) : '';
    if (text.length !== this.twTextLen) {
      this.twTextLen = text.length;
      this.twTextRunes = toRunes(text);
    }
    if (reason.length !== this.twReasonLen) {
      this.twReasonLen = reason.length;
      this.twReasonRunes = toRunes(reason);
    }
    const typing: boolean = isTyping(this.twContent, this.twTextRunes.length)
      || isTyping(this.twReason, this.twReasonRunes.length);
    this.syncTwTimer(typing);
  }

  /** 有内容没追平就开 50ms 定时器，追平立刻关（绝不留后台定时器）。 */
  private syncTwTimer(on: boolean): void {
    if (on && this.twTimer < 0) {
      this.twTimer = setInterval(() => {
        this.twTick();
      }, TICK_MS);
      return;
    }
    if (!on && this.twTimer >= 0) {
      clearInterval(this.twTimer);
      this.twTimer = -1;
    }
  }

  /** 一拍：等比推进正文与思考（同一拍共用"是否 CJK 半速"的判定）。 */
  private twTick(): void {
    const skip: boolean = this.twSkip;
    this.twSkip = !this.twSkip;
    if (isTyping(this.twContent, this.twTextRunes.length)) {
      const code: number = this.twTextRunes.length > 0
        ? this.twTextRunes[Math.min(this.twContent, this.twTextRunes.length - 1)].codePointAt(0) as number : 0;
      this.twContent = advanceVisible(this.twContent, this.twTextRunes.length, skip && isCJK(code));
    }
    if (isTyping(this.twReason, this.twReasonRunes.length)) {
      const code: number = this.twReasonRunes.length > 0
        ? this.twReasonRunes[Math.min(this.twReason, this.twReasonRunes.length - 1)].codePointAt(0) as number : 0;
      this.twReason = advanceVisible(this.twReason, this.twReasonRunes.length, skip && isCJK(code));
    }
    if (!isTyping(this.twContent, this.twTextRunes.length)
      && !isTyping(this.twReason, this.twReasonRunes.length)) {
      this.syncTwTimer(false);
    }
    // 尾块（LiveTail）直接读 @State twContent/twReason ⇒ 每拍必然重渲染，
    // 不再需要 bump 虚拟列表条目的键（那条路径在真机上不可靠）。
  }

  /** live 迭代的正文（打字机裁剪；非 live 迭代原样返回）。 */
  private liveIterText(row: ChatRow, it: HistoryIteration): string {
    const full: string = displayContent(it);
    if (row.isLive !== true || `${row.id}#${it.iteration}` !== this.twKey) {
      return full;
    }
    return clipRunes(full, this.twContent);
  }

  /** live 迭代的思考（同上）。 */
  private liveIterReason(row: ChatRow, it: HistoryIteration): string {
    const full: string = displayReasoning(it);
    if (row.isLive !== true || `${row.id}#${it.iteration}` !== this.twKey) {
      return full;
    }
    return clipRunes(full, this.twReason);
  }

  /** 该迭代是否正在"打字"（决定要不要显示光标）。 */
  private twTyping(row: ChatRow, it: HistoryIteration): boolean {
    if (row.isLive !== true || `${row.id}#${it.iteration}` !== this.twKey) {
      return false;
    }
    return isTyping(this.twContent, this.twTextRunes.length)
      || isTyping(this.twReason, this.twReasonRunes.length);
  }

  /** 统一的"轻动效"入口（时长/曲线只有一处，避免每个面板各自为政）。 */
  private anim(run: () => void): void {
    animateTo({ duration: 220, curve: Curve.Friction }, run);
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    this.settings[key] = value;   // 乐观：界面立刻变
    try {
      await store.saveSettings(pairs);
      if (key === KEY_REASONING_DEFAULT) {
        this.showReasoning = parseBool(value, false);
        this.reasoningDefaultApplied = true;
      }
    } catch (e) {
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
      } else if (this.panelTab === 'tasks') {
        await store.loadBgTasks();
      } else if (this.panelTab === 'runners') {
        await store.loadRunners();
      } else {
        await store.loadSessions();  // 子代理来自会话树
      }
    } catch (e) {
      this.toast(`加载失败: ${errText(e as Object)}`);
    } finally {
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
    } catch (e) {
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
      } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
      this.toast(`搜索失败: ${errText(e as Object)}`);
    } finally {
      this.searchBusy = false;
    }
  }

  /** 把「当前该显示的行」推给数据源（行窗口 + 真虚拟化两层叠加）。 */
  private syncRowDs(): void {
    // live 行不进虚拟列表（由列表尾的 LiveTail 承担，@State 直驱 ⇒ 必然重渲染）；
    // 提交（isLive=false）后自动进入列表。
    const committed: ChatRow[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r: ChatRow = this.rows[i];
      if (r.role !== 'assistant' || r.isLive !== true) {
        committed.push(r);
      }
    }
    this.rowDs.applyRows(tailRows(committed, this.rowLimit));
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
      return;
    }
    const it: HistoryIteration = liveRow.iterations[liveRow.iterations.length - 1];
    this.liveOn = true;
    this.liveText = displayContent(it);
    this.liveReasoning = displayReasoning(it);
    this.liveTools = it.tools !== undefined ? it.tools.slice() : [];
    this.liveIterNo = it.iteration;
    this.liveRowTurn = liveRow.turnID;
  }

  /** live 尾块是否有任何可显示内容（决定 busy 占位符是否让位 —— 恰好一个指示器）。 */
  private liveTailHasContent(): boolean {
    return this.liveOn && (this.liveText.length > 0 || this.liveReasoning.length > 0
      || this.liveTools.length > 0);
  }

  /** 打字机可见正文（安全回退：定时器未跑 ⇒ 显示全文，绝不让内容不可见）。 */
  private twVisibleText(): string {
    const full: string = this.liveText;
    if (full.length === 0) {
      return '';
    }
    if (this.twTimer < 0 || this.twContent >= this.twTextRunes.length) {
      return full;
    }
    return clipRunes(full, this.twContent);
  }

  /** 打字机可见思考（同上）。 */
  private twVisibleReason(): string {
    const full: string = this.liveReasoning;
    if (full.length === 0) {
      return '';
    }
    if (this.twTimer < 0 || this.twReason >= this.twReasonRunes.length) {
      return full;
    }
    return clipRunes(full, this.twReason);
  }

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
    } else if (last !== undefined) {
      p.reply = displayContent(last);
    }
    if (last !== undefined) {
      const ip: CopyParts = this.partsForIteration(last);
      p.thinking = ip.thinking;
      p.tools = ip.tools;
      p.raw = ip.raw;
    } else {
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
      return t !== undefined ? toolCopyText(t.name, t.args !== undefined ? t.args : '',
        t.detail !== undefined ? t.detail : '') : '';
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
    } catch (e) {
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
    } catch (e) {
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
      } else if (code === 'tool-args') {
        this.copyText(toolArgsOnly(args), '工具参数');
      } else {
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
  @Builder
  PrefsSheet() {
    Column({ space: 10 }) {
      Row() {
        Text('设置').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showSettings = false;
        })
      }.width('100%')

      // 主题（深/浅）
      Row({ space: 8 }) {
        Text(settingLabel(KEY_APP_THEME)).fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text(themeLabel(this.themeName))
          .fontSize(12).fontColor(this.pal().onAccent)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.pal().accent).borderRadius(8)
          .onClick(() => {
            this.themeName = toggleTheme(this.themeName);
            this.setSetting(KEY_APP_THEME, this.themeName);
            this.buzz();
          })
      }.width('100%')

      // 字号
      Text(`${settingLabel(KEY_FONT_SCALE)}：${fontScaleLabel(this.fontScale())}`)
        .fontSize(12).fontColor(this.pal().textSecondary).width('100%')
      Row({ space: 6 }) {
        ForEach(fontScalePresets(), (n: number) => {
          Text(fontScaleLabel(n))
            .fontSize(12)
            .fontColor(Math.abs(this.fontScale() - n) < 0.01 ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(Math.abs(this.fontScale() - n) < 0.01 ? this.pal().accent : this.pal().surface)
            .borderRadius(8)
            .onClick(() => {
              this.setSetting(KEY_FONT_SCALE, `${n}`);
            })
        }, (n: number) => `fs-${n}`)
      }.width('100%')

      // 代码换行
      Row({ space: 8 }) {
        Text(settingLabel(KEY_CODE_WRAP)).fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text(this.wrapCode() ? '开' : '关')
          .fontSize(12).fontColor(this.pal().onAccent).padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.wrapCode() ? this.pal().success : this.pal().borderStrong).borderRadius(8)
          .onClick(() => {
            this.setSetting(KEY_CODE_WRAP, this.wrapCode() ? '0' : '1');
          })
      }.width('100%')

      // 思考默认展开
      Row({ space: 8 }) {
        Text(settingLabel(KEY_REASONING_DEFAULT)).fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text(this.reasoningDefault() ? '开' : '关')
          .fontSize(12).fontColor(this.pal().onAccent).padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.reasoningDefault() ? this.pal().success : this.pal().borderStrong).borderRadius(8)
          .onClick(() => {
            this.setSetting(KEY_REASONING_DEFAULT, this.reasoningDefault() ? '0' : '1');
          })
      }.width('100%')

      // 发送快捷键
      Row({ space: 8 }) {
        Text(settingLabel(KEY_SEND_KEY)).fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text(sendKeyLabel(this.sendKeyMode()))
          .fontSize(12).fontColor(this.pal().onAccent).padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.pal().surfaceHi).borderRadius(8)
          .onClick(() => {
            const next: string = this.sendKeyMode() === SEND_KEY_MOD_ENTER ? 'enter' : SEND_KEY_MOD_ENTER;
            this.setSetting(KEY_SEND_KEY, next);
          })
      }.width('100%')

      Divider().color(this.pal().surfaceHi)

      // 与 web 共享的只读项（原生端暂不改这些）
      ForEach(this.readonlySettings(), (k: string) => {
        Row({ space: 8 }) {
          Text(settingLabel(k)).fontSize(12).fontColor(this.pal().textSecondary).layoutWeight(1)
          Text(settingOf(this.settings, k).length > 0 ? settingOf(this.settings, k) : '（未设置）')
            .fontSize(12).fontColor(this.pal().textMuted)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }.width('100%')
      }, (k: string) => `ro-${k}`)
      Text('浅色主题需要色板重构（已单列为 P9b），当前仅深色。')
        .fontSize(11).fontColor(this.pal().textMuted).width('100%')

      Row({ space: 8 }) {
        Text('刷新').fontSize(12).fontColor(this.pal().accentSoft).padding(8).onClick(() => {
          this.openPrefs();
        })
      }.width('100%')
    }
    .width('100%').padding(16)
    .backgroundColor(this.pal().appBg)
    .borderRadius({ topLeft: 14, topRight: 14 })
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
    .transition(this.sheetTransition())
  }

  /** 面板：四个标签各拉一个端点（定时任务 / 后台任务 / 子代理 / Runner）。 */
  @Builder
  PanelsSheet() {
    Column({ space: 8 }) {
      Row() {
        Text('面板').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        if (this.panelBusy) {
          LoadingProgress().width(16).height(16).color(this.pal().accent)
        }
        Text('刷新').fontSize(12).fontColor(this.pal().accentSoft).padding(8).onClick(() => {
          this.refreshPanel();
        })
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showPanels = false;
        })
      }.width('100%')

      Row({ space: 6 }) {
        ForEach(this.panelTabs(), (tab: string) => {
          Text(this.panelTabLabel(tab))
            .fontSize(12)
            .fontColor(this.panelTab === tab ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.panelTab === tab ? this.pal().accent : this.pal().surface)
            .borderRadius(8)
            .onClick(() => {
              this.switchPanelTab(tab);
            })
        }, (tab: string) => `ptab-${tab}`)
      }.width('100%')

      if (this.panelTab === 'cron') {
        if (this.cronTasks.length === 0) {
          Text('（本会话暂无定时任务）').fontSize(12).fontColor(this.pal().textMuted).width('100%')
        } else {
          List({ space: 6 }) {
            ForEach(this.cronTasks, (job: CronJob, i: number) => {
              ListItem() {
                Row({ space: 6 }) {
                  Text(cronLine(job)).fontSize(12).fontColor(this.pal().textPrimary).layoutWeight(1)
                    .maxLines(2).wordBreak(WordBreak.BREAK_ALL)
                  Text('✕').fontSize(12).fontColor(this.pal().dangerText).padding(6).onClick(() => {
                    this.removeCron(job.id !== undefined ? job.id : '');
                  })
                }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
              }
            }, (job: CronJob, i: number) => `cron-${job.id}#${i}`)
          }.constraintSize({ maxHeight: 420 }).width('100%')
        }
      } else if (this.panelTab === 'tasks') {
        if (this.bgTasks.length === 0) {
          Text('（本会话暂无后台任务）').fontSize(12).fontColor(this.pal().textMuted).width('100%')
        } else {
          List({ space: 6 }) {
            ForEach(this.bgTasks, (t: BgTask, i: number) => {
              ListItem() {
                Text(bgTaskLine(t, this.nowMs())).fontSize(12).fontColor(this.pal().textPrimary)
                  .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
                  .maxLines(3).wordBreak(WordBreak.BREAK_ALL)
                  .copyOption(CopyOptions.LocalDevice)
              }
            }, (t: BgTask, i: number) => `bg-${t.id}#${t.status}#${i}`)
          }.constraintSize({ maxHeight: 420 }).width('100%')
        }
      } else if (this.panelTab === 'subs') {
        if (this.subagents.length === 0) {
          Text('（暂无子代理会话）').fontSize(12).fontColor(this.pal().textMuted).width('100%')
        } else {
          List({ space: 6 }) {
            ForEach(this.subagents, (a: SubAgentRow, i: number) => {
              ListItem() {
                Text(subagentLine(a)).fontSize(12)
                  .fontColor(a.running === true ? this.pal().successText : this.pal().textSecondary)
                  .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
                  .maxLines(2).wordBreak(WordBreak.BREAK_ALL)
                  .onClick(() => {
                    this.showPanels = false;
                    if (a.chat_id !== undefined) {
                      this.switchSession(a.chat_id);
                    }
                  })
              }
            }, (a: SubAgentRow, i: number) => `sub-${a.chat_id}#${i}`)
          }.constraintSize({ maxHeight: 420 }).width('100%')
        }
      } else {
        if (this.runners.length === 0) {
          Text('（没有受管机器；Runner 由 xbot.ssh-runner 插件纳管）').fontSize(12).fontColor(this.pal().textMuted).width('100%')
        } else {
          List({ space: 6 }) {
            ForEach(this.runners, (r: RunnerRow, i: number) => {
              ListItem() {
                Text(runnerLine(r)).fontSize(12)
                  .fontColor(r.online === true ? this.pal().successText : this.pal().textSecondary)
                  .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
                  .maxLines(2).wordBreak(WordBreak.BREAK_ALL)
              }
            }, (r: RunnerRow, i: number) => `run-${r.name}#${r.online}#${i}`)
          }.constraintSize({ maxHeight: 420 }).width('100%')
        }
      }
    }
    .width('100%').padding(16)
    .backgroundColor(this.pal().appBg)
    .borderRadius({ topLeft: 14, topRight: 14 })
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
    .transition(this.sheetTransition())
  }

  /** 会话操作菜单（贴底；删除需二次确认）。 */
  @Builder
  SessSheet() {
    Column({ space: 0 }) {
      Text(this.menuLabel())
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      this.CtxItem(this.menuCanMove(MOVE_TOP) ? '置顶' : '置顶（已在顶部）', MOVE_TOP)
      this.CtxItem(this.menuCanMove(MOVE_UP) ? '上移' : '上移（已在顶部）', MOVE_UP)
      this.CtxItem(this.menuCanMove(MOVE_DOWN) ? '下移' : '下移（已在底部）', MOVE_DOWN)
      this.CtxItem('重命名', 'rename')
      this.CtxItem('分支（fork 出新会话）', 'fork')
      this.CtxItem(this.sessConfirmDelete === this.sessMenuId ? '确认删除（再点一次）' : '删除', 'delete')
      Divider().color(this.pal().surfaceHi).margin({ top: 4 })
      this.CtxItem('取消', 'cancel')
    }
    .width('100%')
    .backgroundColor(this.pal().appBg)
    .borderRadius({ topLeft: 14, topRight: 14 })
    .border({ width: 1, color: this.pal().border })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    .transition(this.sheetTransition())
  }

  /** 会话内消息搜索结果（点一条复制该片段；只覆盖当前会话）。 */
  @Builder
  SearchHitsSheet() {
    Column({ space: 0 }) {
      Text(`本会话命中 ${this.searchHits.length} 条（点一条复制片段）`)
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })
      List({ space: 6 }) {
        ForEach(this.searchHits, (h: SearchHit, i: number) => {
          ListItem() {
            Text(hitLine(h.role !== undefined ? h.role : '', h.snippet !== undefined ? h.snippet : '', 120))
              .fontSize(13).fontColor(this.pal().textPrimary)
              .width('100%').padding(10)
              .backgroundColor(this.pal().surface).borderRadius(6)
              .maxLines(3).wordBreak(WordBreak.BREAK_ALL)
              .onClick(() => {
                this.copyText(h.snippet !== undefined ? h.snippet : '', '片段');
                this.showSearchHits = false;
              })
          }
        }, (h: SearchHit, i: number) => `hit-${h.id}#${i}`)
      }
      .constraintSize({ maxHeight: 420 }).width('100%')
      Divider().color(this.pal().surfaceHi).margin({ top: 6 })
      this.CtxItem('关闭', 'cancel-hits')
    }
    .width('100%')
    .backgroundColor(this.pal().appBg)
    .borderRadius({ topLeft: 14, topRight: 14 })
    .border({ width: 1, color: this.pal().border })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    .transition(this.sheetTransition())
  }

  /** 菜单里的一项（点击走 `runCtxAction(code)`；@Builder 不能传闭包 ⇒ 用字符串码派发）。 */
  @Builder
  CtxItem(label: string, code: string) {
    Text(label)
      .fontSize(14).fontColor(this.pal().textPrimary)
      .width('100%').padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .stateStyles({ pressed: { .backgroundColor(this.pal().surfaceAlt) }, normal: { .backgroundColor(this.pal().appBg) } })
      .onClick(() => {
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
      })
  }

  /** 长按操作菜单（底部弹出，贴手指易点区）。 */
  @Builder
  ContextSheet() {
    Column({ space: 0 }) {
      Text(this.ctxKind === 'tool' ? '工具操作' : (this.ctxKind === 'iter' ? '迭代操作' : '消息操作'))
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })

      if (this.ctxKind === 'user') {
        this.CtxItem('复制文本', 'user-text')
      } else if (this.ctxKind === 'tool') {
        this.CtxItem('复制输出', 'tool-out')
        this.CtxItem('复制参数', 'tool-args')
        this.CtxItem('复制全部（名字+参数+输出）', 'tool-all')
      } else if (this.ctxKind === 'iter') {
        this.CtxItem('复制该迭代正文', 'iter-reply')
        this.CtxItem('复制该迭代（含思考）', 'iter-thinking')
        this.CtxItem('复制该迭代（含工具）', 'iter-tools')
      } else {
        this.CtxItem('复制回复', 'row-reply')
        this.CtxItem('复制（含思考）', 'row-thinking')
        this.CtxItem('复制（含工具）', 'row-tools')
        this.CtxItem('复制原始 Markdown', 'row-raw')
      }

      // 链接（命中链接时才有 —— 与 Web 的落点语义一致）
      if (this.ctxKind !== 'tool') {
        ForEach(this.ctxLinks(), (l: string, i: number) => {
          this.CtxItem(`打开链接 ${linkLabel(l)}`, `open-link:${i}`)
          this.CtxItem(`复制链接地址 ${linkLabel(l)}`, `copy-link:${i}`)
        }, (l: string, i: number) => `ctx-link-${i}`)
      }

      Divider().color(this.pal().surfaceHi).margin({ top: 4 })
      this.CtxItem('取消', 'cancel')
    }
    .width('100%')
    .backgroundColor(this.pal().appBg)
    .borderRadius({ topLeft: 14, topRight: 14 })
    .border({ width: 1, color: this.pal().border })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    .transition(this.sheetTransition())
  }

  /** 一行的主体（用户气泡 / 助手块）——由 `LazyForEach` 的 `ListItem` 调用。 */
  @Builder
  ChatRowBody(row: ChatRow) {
    if (row.role === 'user') {
      this.UserBubble(row)
    } else if (!rowIsEmpty(row)) {
      // 空气泡守卫：无正文/思考/工具的行（含等待首帧的 live 行）不渲染卡片；
      // 等待态由列表尾部的「思考中…」占位承担（与 web 的 ShimmerThinking 同语义）
      this.AssistantBlock(row)
    }
  }

  @Builder
  UserBubble(row: ChatRow) {
    Row() {
      Blank()
      Text(row.content)
        .wordBreak(WordBreak.BREAK_ALL)
        .fontSize(15).fontColor(this.pal().textPrimary).padding(12)
        .constraintSize({ maxWidth: '78%' })
        .backgroundColor(this.pal().bubbleUser).borderRadius(12)
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%').padding({ top: 6, bottom: 6 })
    .gesture(LongPressGesture().onAction(() => {
      this.openCtx('user', row.id, 0, '');
    }))
  }

  @Builder
  AssistantBlock(row: ChatRow) {
    Column({ space: 6 }) {
      if (row.content.length > 0 && row.iterations.length === 0) {
        MarkdownView({
          text: row.content,
          onImage: (src: string) => {
            this.openImage(src);
          },
          loadImage: (src: string) => {
            return this.loadImageBytes(src);
          },
          fontScale: this.fontScale(),
          wrapCode: this.wrapCode(),
          theme: this.themeName,
        })
      }
      // 服务端折叠视图：更早的展示区域需按需取回（与 Web 端「⌃ 更早的 N 个区域」同源）
      if (row.regionsBefore > 0) {
        Row({ space: 6 }) {
          Text(`⌃ 更早的 ${row.regionsBefore} 个区域`).fontSize(11).fontColor(this.pal().warn)
          Text('（点击加载）').fontSize(11).fontColor(this.pal().textMuted)
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.loadMoreRegions(row);
        })
      }
      if (this.hiddenIterCount(row) > 0) {
        Row({ space: 6 }) {
          Text(`↑ 已折叠更早的 ${this.hiddenIterCount(row)} 个迭代`)
            .fontSize(11).fontColor(this.pal().accentSoft)
          Text('（点击展开全部）').fontSize(11).fontColor(this.pal().textMuted)
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.expandedTurn = row.id;
        })
      }
      ForEach(this.itersFor(row), (it: HistoryIteration) => {
        this.IterationBlock(row, it)
      }, (it: HistoryIteration) => `${row.id}#${row.rev}-${it.iteration}`)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.pal().surface)
    .borderRadius(14)
    .border({ width: 1, color: this.pal().border })
    .shadow({ radius: 10, color: '#14000000', offsetX: 0, offsetY: 2 })
    .margin({ top: 4, bottom: 4 })
    // 长按整条 → 复制（回复 / 含思考 / 含工具 / 原始 Markdown）
    .gesture(LongPressGesture().onAction(() => {
      this.openCtx('row', row.id, 0, '');
    }))
  }

  /** 一个迭代 = 思考(T) / 正文(O) / 工具(C)。 */
  @Builder
  IterationBlock(row: ChatRow, it: HistoryIteration) {
    Column({ space: 6 }) {
      // web 形态：**没有"迭代 N"这种标题**，只有一条可展开的「思考 N 字」
      if (displayReasoning(it).length > 0) {
        Row({ space: 6 }) {
          Text('✳').fontSize(11).fontColor(this.pal().textMuted)
          Text(`思考 ${runeCount(displayReasoning(it))} 字`)
            .fontSize(11).fontColor(this.pal().textSecondary)
          Text(this.openReasonKey === `${row.id}-${it.iteration}` ? '▾' : '▸')
            .fontSize(11).fontColor(this.pal().textMuted)
        }
        .padding({ top: 2, bottom: 2 })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          const key: string = `${row.id}-${it.iteration}`;
          this.openReasonKey = this.openReasonKey === key ? '' : key;
        })
      }

      if (displayReasoning(it).length > 0
        && this.openReasonKey === `${row.id}-${it.iteration}`) {
        Text(this.liveIterReason(row, it))
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(13).fontColor(this.pal().textSecondary).padding(8).width('100%')
          .backgroundColor(this.pal().surface).borderRadius(8)
          .copyOption(CopyOptions.LocalDevice)
      }

      if (displayContent(it).length > 0) {
        MarkdownView({
          text: this.liveIterText(row, it),
          onImage: (src: string) => {
            this.openImage(src);
          },
          loadImage: (src: string) => {
            return this.loadImageBytes(src);
          },
          fontScale: this.fontScale(),
          wrapCode: this.wrapCode(),
          theme: this.themeName,
        })
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(it.tools, (t: ToolProgress) => {
            this.ToolPill(row, it, t)
          }, (t: ToolProgress, ti: number) => `${this.toolKey(row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${ti}`)
        }
        .width('100%')
      }

      // 工具详情（点击 pill 展开）
      if (this.openToolKey.startsWith(`${row.turnID}:${it.iteration}:`) && it.tools !== undefined) {
        ForEach(it.tools, (t: ToolProgress) => {
          if (this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name)) {
            this.ToolDetail(t)
          }
        }, (t: ToolProgress, ti: number) => `d-${this.toolKey(row.turnID, it.iteration, t.name)}#${ti}`)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 4 })
  }

  /** live 进行中块（web 的 LiveIteration 同构：思考行 + 打字机正文 + 全状态工具 pill）。 */
  @Builder
  LiveTail() {
    Column({ space: 6 }) {
      // 思考行（web 形态：✳ 思考 N 字 ▸/▾）
      if (this.liveReasoning.length > 0) {
        Row({ space: 6 }) {
          Text('✳').fontSize(11).fontColor(this.pal().textMuted)
          Text(`思考 ${runeCount(this.liveReasoning)} 字`)
            .fontSize(11).fontColor(this.pal().textSecondary)
          Text(this.liveReasonOpen ? '▾' : '▸').fontSize(11).fontColor(this.pal().textMuted)
        }
        .padding({ top: 2, bottom: 2 })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.liveReasonOpen = !this.liveReasonOpen;
        })
      }
      if (this.liveReasonOpen && this.twVisibleReason().length > 0) {
        Text(this.twVisibleReason())
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textSecondary).padding(8).width('100%')
          .backgroundColor(this.pal().surfaceAlt).borderRadius(8)
          .opacity(this.twReason < this.twReasonRunes.length ? (this.pulseOn ? 1 : 0.7) : 1)
          .animation({ duration: 600, curve: Curve.EaseInOut })
          .copyOption(CopyOptions.LocalDevice)
      }
      // 正文（打字机裁剪 + 光标；@State 直驱 ⇒ 必然逐字上屏）
      if (this.twVisibleText().length > 0) {
        Column({ space: 2 }) {
          MarkdownView({
            text: this.twVisibleText(),
            onImage: (src: string) => {
              this.openImage(src);
            },
            loadImage: (src: string) => {
              return this.loadImageBytes(src);
            },
            fontScale: this.fontScale(),
            wrapCode: this.wrapCode(),
            theme: this.themeName,
          })
          if (this.twContent < this.twTextRunes.length) {
            Text('▍').fontSize(14).fontColor(this.pal().accent)
              .opacity(this.pulseOn ? 1 : 0.15)
              .animation({ duration: 600, curve: Curve.EaseInOut })
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      // 工具（全部状态：generating / running / done / error / pending）
      if (this.liveTools.length > 0) {
        Column({ space: 4 }) {
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.liveTools, (t: ToolProgress, i: number) => {
              this.LiveToolPill(t)
            }, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.status}`)
          }.width('100%')
          ForEach(this.liveTools, (t: ToolProgress, i: number) => {
            if (this.openToolKey === this.toolKey(this.liveRowTurn, this.liveIterNo, t.name)) {
              this.ToolDetailCard(t)
            }
          }, (t: ToolProgress, i: number) => `ltd-${i}#${t.name}#${t.status}`)
        }.width('100%')
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.pal().surface).borderRadius(14)
    .border({ width: 1, color: this.pal().border })
    .shadow({ radius: 10, color: '#14000000', offsetX: 0, offsetY: 2 })
    .margin({ top: 4, bottom: 4 })
  }

  /** live 工具 pill（与已提交行同一套五态规则）。 */
  @Builder
  LiveToolPill(t: ToolProgress) {
    Stack() {
      Row({ space: 4 }) {
        Text(this.toolIcon(t)).fontSize(11).fontColor(this.toolColor(t))
        Text(this.toolLabel(t)).fontSize(12).fontColor(this.toolColor(t))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 240 })
      }
      .padding({ left: 8, right: 8, top: 5, bottom: 5 })
      .margin(3)
      if (t.status === 'running' || t.status === 'generating') {
        Row()
          .width(46).height('100%')
          .linearGradient({ angle: 90, colors: [
            [this.pal().accentSoftFade, 0.0], [this.pal().accentSoft, 0.5], [this.pal().accentSoftFade, 1.0],
          ] })
          .opacity(0.35)
          .translate({ x: this.sweepX })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .clip(true)
    .backgroundColor(this.pal().surfaceAlt)
    .borderRadius(6)
    .border({
      width: 1,
      color: this.openToolKey === this.toolKey(this.liveRowTurn, this.liveIterNo, t.name)
        ? this.pal().accent : this.pal().border,
    })
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      const key: string = this.toolKey(this.liveRowTurn, this.liveIterNo, t.name);
      this.openToolKey = this.openToolKey === key ? '' : key;
    })
    .gesture(LongPressGesture().onAction(() => {
      this.openCtx('tool', this.liveRowIdOf(), this.liveIterNo, t.name);
    }))
  }

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

  /** 工具详情卡（点 pill 展开：状态行 + 摘要 + 参数 + 输出）。 */
  @Builder
  ToolDetailCard(t: ToolProgress) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text(this.toolIcon(t)).fontSize(12).fontColor(this.toolColor(t))
        Text(t.label !== undefined && t.label.length > 0 ? t.label : t.name)
          .fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.toolStatusBadge(t).length > 0 ? this.toolStatusBadge(t) : '完成')
          .fontSize(11).fontColor(this.toolColor(t))
      }.width('100%')
      if (t.summary !== undefined && t.summary.length > 0) {
        Text(t.summary).fontSize(12).fontColor(this.pal().textSecondary).width('100%')
          .wordBreak(WordBreak.BREAK_ALL).copyOption(CopyOptions.LocalDevice)
      }
      if (t.args !== undefined && t.args.length > 0) {
        Text(t.args).fontSize(11).fontColor(this.pal().textSecondary).width('100%')
          .backgroundColor(this.pal().surfaceAlt).borderRadius(6).padding(8)
          .fontFamily('monospace').wordBreak(WordBreak.BREAK_ALL)
          .copyOption(CopyOptions.LocalDevice)
      }
      if (t.detail !== undefined && t.detail.length > 0) {
        Text(t.detail).fontSize(11).fontColor(this.pal().textSecondary).width('100%')
          .maxLines(12).textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL).copyOption(CopyOptions.LocalDevice)
      }
    }
    .width('100%').padding(10)
    .backgroundColor(this.pal().surfaceAlt).borderRadius(8)
    .border({ width: 1, color: this.pal().border })
  }

  @Builder
  ToolPill(row: ChatRow, it: HistoryIteration, t: ToolProgress) {
    Stack() {
      Row({ space: 4 }) {
      Text(this.toolIcon(t)).fontSize(11)
        .fontColor(this.toolColor(t))
      Text(this.toolLabel(t))
        .fontSize(12)
        .fontColor(this.toolColor(t))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: 220 })
    }
    .padding({ left: 8, right: 8, top: 5, bottom: 5 })
    .margin(3)
      // 运行中：一道流光扫过（纯 transform ⇒ 不触发布局，触屏也稳）
      if (t.status === 'running' || t.status === 'generating') {
        Row()
          .width(46).height('100%')
          .linearGradient({ angle: 90, colors: [
            [this.pal().accentSoftFade, 0.0], [this.pal().accentSoft, 0.5], [this.pal().accentSoftFade, 1.0],
          ] })
          .opacity(0.35)
          .translate({ x: this.sweepX })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .clip(true)
    .backgroundColor(this.pal().surfaceAlt)
    .borderRadius(6)
    .border({ width: 1, color: this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name) ? this.pal().accent : this.pal().border })
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.toggleTool(row, it, t);
    })
    .gesture(LongPressGesture().onAction(() => {
      this.openCtx('tool', row.id, it.iteration, t.name);
    }))
  }

  @Builder
  ToolDetail(t: ToolProgress) {
    Column({ space: 4 }) {
      if (t.summary !== undefined && t.summary.length > 0) {
        Text(t.summary).fontSize(12).fontColor(this.pal().textSecondary).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      if (t.args !== undefined && t.args.length > 0) {
        Text('参数').fontSize(10).fontColor(this.pal().textMuted)
        Text(t.args)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textPrimary).fontFamily('monospace')
          .width('100%').padding(6).backgroundColor(this.pal().surfaceAlt).borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if (t.detail !== undefined && t.detail.length > 0) {
        Text('输出').fontSize(10).fontColor(this.pal().textMuted)
        Text(t.detail)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textPrimary).fontFamily('monospace')
          .width('100%').padding(6).backgroundColor(this.pal().surfaceAlt).borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if ((t.summary === undefined || t.summary.length === 0)
        && (t.args === undefined || t.args.length === 0)
        && (t.detail === undefined || t.detail.length === 0)) {
        Text('（详情加载中或该工具无详情）').fontSize(11).fontColor(this.pal().textMuted)
      }
      if (t.elapsed_ms !== undefined) {
        Text(`耗时 ${t.elapsed_ms} ms`).fontSize(10).fontColor(this.pal().textMuted)
      }
    }
    .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
    .alignItems(HorizontalAlign.Start)
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
    } catch (e) {
      this.toast(`加载更早区域失败: ${errText(e as Object)}`);
    }
  }

  /** 该 turn 实际要渲染的迭代（默认只给最近 MAX_ITER_VISIBLE 个）。 */
  private itersFor(row: ChatRow): HistoryIteration[] {
    const all: HistoryIteration[] = row.iterations;
    if (this.expandedTurn === row.id || all.length <= MAX_ITER_VISIBLE) {
      return all;
    }
    return all.slice(all.length - MAX_ITER_VISIBLE);
  }

  /** 被折叠掉的迭代数量（0 表示全展示）。 */
  private hiddenIterCount(row: ChatRow): number {
    if (this.expandedTurn === row.id) {
      return 0;
    }
    return row.iterations.length > MAX_ITER_VISIBLE ? row.iterations.length - MAX_ITER_VISIBLE : 0;
  }

  private toolIcon(t: ToolProgress): string {
    if (t.status === 'generating') {
      return '◐';
    }
    if (t.status === 'running') {
      return '●';
    }
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return '✗';
    }
    if (t.status === 'pending') {
      return '○';
    }
    return '✓';
  }

  /**
   * 工具状态颜色 —— web 的「色彩只表达状态」法则：
   * 运行/生成中保留注意力色（琥珀会被误读为警告，改用强调色）；完成/排队中性；失败红。
   */
  private toolColor(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    return this.pal().textSecondary;
  }

  /** 工具状态角标（web 五态：generating 带字数、running 带时长、error 带 exit）。 */
  private toolStatusBadge(t: ToolProgress): string {
    if (t.status === 'generating') {
      const n: number = t.gen_chars !== undefined ? t.gen_chars : 0;
      return n > 0 ? `生成中 ${n} 字` : '生成中…';
    }
    if (t.status === 'running') {
      const ms: number = t.elapsed_ms !== undefined ? t.elapsed_ms : 0;
      return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '运行中';
    }
    if (t.status === 'error') {
      return t.exit_code !== undefined && t.exit_code !== 0 ? `失败 exit ${t.exit_code}` : '失败';
    }
    if (t.status === 'pending') {
      return '排队';
    }
    return '';
  }

  /** pill 显示名（名字 + 状态角标）。 */
  private toolLabel(t: ToolProgress): string {
    const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
    const badge: string = this.toolStatusBadge(t);
    return badge.length > 0 ? `${base} ${badge}` : base;
  }

  // ── 弹层：会话抽屉 ────────────────────────────────────────────────────────

  @Builder
  DrawerSheet() {
    Column() {
      Row() {
        Text('会话').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('＋ 新建').fontSize(12).fontColor(this.pal().onAccent)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.pal().accent).borderRadius(14)
          .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
          .onClick(() => {
          this.newSession();
        })
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showDrawer = false;
          this.renamingId = '';
        })
      }
      .width('100%').padding(8)

      // 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）
      Row({ space: 6 }) {
        TextInput({ placeholder: '筛选会话…', text: this.sessQuery })
          .onChange((v: string) => {
            this.sessQuery = v;
          })
          .layoutWeight(1).constraintSize({ minHeight: 38 })
          .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary).fontSize(13)
          .borderRadius(12).padding({ left: 12, right: 12 })
        if (this.searchBusy) {
          LoadingProgress().width(16).height(16).color(this.pal().accent)
        } else {
          Text('搜消息').fontSize(12).fontColor(this.pal().accentSoft).padding(6)
            .onClick(() => {
              this.runSearch();
            })
        }
      }
      .width('100%').padding({ bottom: 6 })

      List() {
        ForEach(this.filteredSessions(), (s: SessionItem) => {
          ListItem() {
            Column({ space: 4 }) {
              if (this.renamingId === s.chat_id) {
                Row({ space: 6 }) {
                  TextInput({ text: this.renameText })
                    .onChange((v: string) => {
                      this.renameText = v;
                    })
                    .layoutWeight(1).constraintSize({ minHeight: 36 }).backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
                  Text('保存').fontSize(13).fontColor(this.pal().accentSoft).padding(6).onClick(() => {
                    const store: ChatStore | null = this.store;
                    if (store !== null && s.chat_id !== undefined) {
                      store.renameSession(s.chat_id, this.renameText);
                    }
                    this.renamingId = '';
                  })
                  Text('取消').fontSize(13).fontColor(this.pal().textSecondary).padding(6).onClick(() => {
                    this.renamingId = '';
                  })
                }.width('100%')
              } else {
                Row() {
                  Column() {
                    Row({ space: 6 }) {
                      if (s.running === true) {
                        Circle({ width: 7, height: 7 }).fill(this.pal().success)
                          .opacity(this.pulseOn ? 1 : 0.35)
                          .animation({ duration: 600, curve: Curve.EaseInOut })
                      }
                      Text(this.tabLabel(s.chat_id))
                        .fontSize(15)
                        .fontColor(s.chat_id === this.currentChat ? this.pal().accentText : this.pal().textPrimary)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1)
                    }.width('100%')
                    Row({ space: 6 }) {
                      Text(channelLabel(s.channel !== undefined ? s.channel : 'web'))
                        .fontSize(9).fontColor(this.pal().accentText)
                        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
                        .backgroundColor(this.pal().surfaceHi).borderRadius(4)
                      Text(s.chat_id)
                        .fontSize(10).fontColor(this.pal().textMuted)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1)
                    }.width('100%')
                  }
                  .layoutWeight(1).alignItems(HorizontalAlign.Start)

                  // 触屏铁律：多个行内操作折叠成「一个 ⋯ + 菜单」，绝不并排常显
                  Text('⋯').fontSize(18).fontColor(this.pal().textSecondary).padding({ left: 10, right: 6, top: 4, bottom: 4 })
                    .onClick(() => {
                      this.anim(() => {
                        this.sessMenuId = s.chat_id;
                      });
                      this.sessConfirmDelete = '';
                    })
                }.width('100%')
              }
            }
            .width('100%').padding(12)
            .backgroundColor(s.chat_id === this.currentChat ? this.pal().surfaceHi : this.pal().surface)
            .borderRadius(12)
            .border({
              width: { left: 3, top: 1, right: 1, bottom: 1 },
              color: {
                left: s.chat_id === this.currentChat ? this.pal().accent : this.pal().border,
                top: this.pal().border, right: this.pal().border, bottom: this.pal().border,
              },
            })
            .shadow({ radius: 8, color: '#10000000', offsetX: 0, offsetY: 2 })
            .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
            .onClick(() => {
              if (s.chat_id !== undefined && this.renamingId.length === 0) {
                this.switchSession(s.chat_id);
              }
            })
          }
        }, (s: SessionItem) => `${s.chat_id}#${s.label}#${s.running}`)
      }
      .layoutWeight(1).width('100%')

      Button('设置（字号 / 换行 / 思考）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().surfaceHi).margin({ top: 8 }).onClick(() => {
          this.openPrefs();
        })
      Button('面板（任务 / 子代理 / Runner）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().surfaceHi).margin({ top: 8 }).onClick(() => {
          this.openPanels();
        })
      Button('退出登录').width('100%').constraintSize({ minHeight: 40 }).backgroundColor(this.pal().surfaceHi).margin({ top: 8 }).onClick(() => {
        this.doLogout();
      })
    }
    .width('82%').height('100%')
    .padding(12)
    .backgroundColor(this.pal().appBg)
    .border({ width: { right: 1 }, color: this.pal().border })
    .position({ x: 0, y: 0 })
  }

  // ── 弹层：设置 ────────────────────────────────────────────────────────────

  @Builder
  SettingsSheet() {
    Column({ space: 10 }) {
      Row() {
        Text('设置').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showSettings = false;
        })
      }.width('100%')

      Text('服务端').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
      TextInput({ text: this.serverUrl })
        .onChange((v: string) => {
          this.serverUrl = v;
        })
        .constraintSize({ minHeight: 42 }).backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)

      Text('用户名').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
      TextInput({ text: this.username })
        .onChange((v: string) => {
          this.username = v;
        })
        .constraintSize({ minHeight: 42 }).backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)

      Row() {
        Text('显示思考过程').fontSize(14).fontColor(this.pal().textPrimary).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.showReasoning })
          .onChange((on: boolean) => {
            this.showReasoning = on;
          })
      }.width('100%')

      Row() {
        Text('当前会话 ID').fontSize(12).fontColor(this.pal().textSecondary).layoutWeight(1)
        Text(this.currentChat.length > 0 ? this.currentChat : '-')
          .fontSize(11).fontColor(this.pal().textMuted).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 180 })
      }.width('100%')

      Button('保存服务端/用户名').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().accent).fontColor(this.pal().onAccent)
        .onClick(async () => {
        const store: ChatStore | null = this.store;
        this.takeServerUrl();
        await this.config.save(this.serverUrl, this.username,
          store !== null ? store.http.exportSessionCookie() : '');
        this.toast('已保存（换服务端请退出重登）');
      })
      Button(this.auditing ? '走查中…' : '① 走查并上传所有页面截图（推荐）').width('100%').constraintSize({ minHeight: 44 })
        .backgroundColor(this.pal().accent)
        .onClick(() => {
          this.showSettings = false;
          this.runUiAudit();
        })
      if (this.auditLog.length > 0) {
        Text(this.auditLog).fontSize(10).fontColor(this.pal().textSecondary).width('100%').maxLines(4)
      }
      Button('渲染自检（排查渲染问题用）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().surfaceHi)
        .onClick(() => {
          this.showSettings = false;
          this.showSelfCheck = true;
        })
      Button('打开完整 Web UI（插件/GenUI/终端）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().surfaceHi)
        .onClick(() => {
          this.showSettings = false;
          this.panelUrl = this.serverUrl;
        })
      Button('退出登录').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor(this.pal().dangerBg)
        .onClick(() => {
          this.showSettings = false;
          this.doLogout();
        })
    }
    .width('92%').padding(16).backgroundColor(this.pal().appBg)
    .borderRadius(12).border({ width: 1, color: this.pal().border })
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
  @Builder
  ModelSheet() {
    Column({ space: 10 }) {
      Row() {
        Text('模型与上下文').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showModel = false;
        })
      }.width('100%')

      Text(`当前：${this.currentModelName()}`)
        .fontSize(12).fontColor(this.pal().successText).width('100%')
        .wordBreak(WordBreak.BREAK_ALL)

      // 上下文上限
      Text(`上下文上限：${this.ctxText().length > 0 ? this.ctxText() : '未设置'}`)
        .fontSize(12).fontColor(this.pal().textSecondary).width('100%')
      Row({ space: 6 }) {
        ForEach(this.ctxPresets(), (p: number, i: number) => {
          Text(this.ctxPresetText(p))
            .fontSize(12).fontColor(this.pal().accentSoft)
            .padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .backgroundColor(this.pal().surface).borderRadius(6)
            .border({ width: 1, color: this.pal().border })
            .onClick(() => {
              this.applyMaxContext(p);
            })
        }, (p: number, i: number) => `ctx-preset-${p}`)
      }.width('100%')

      Row({ space: 6 }) {
        TextInput({ placeholder: '自定义，如 200k / 1m', text: this.ctxInput })
          .onChange((v: string) => {
            this.ctxInput = v;
          })
          .layoutWeight(1).constraintSize({ minHeight: 36 })
          .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary).fontSize(12)
        Text('应用').fontSize(12).fontColor(this.pal().onAccent).padding({ left: 12, right: 12, top: 8, bottom: 8 })
          .backgroundColor(this.pal().accent).borderRadius(6)
          .onClick(() => {
            const n: number = parseContext(this.ctxInput);
            if (n <= 0) {
              this.toast('上下文上限格式不对（示例：200k / 1m / 200000）');
              return;
            }
            this.applyMaxContext(n);
          })
      }.width('100%')

      // 模型列表（按订阅分组）
      if (this.llmCfg === undefined) {
        Row({ space: 8 }) {
          LoadingProgress().width(16).height(16).color(this.pal().accent)
          Text('正在读取模型列表…').fontSize(12).fontColor(this.pal().textSecondary)
        }.padding(10)
      } else if (this.modelGroups().length === 0) {
        Text('（没有可选模型：请在设置里添加订阅）').fontSize(12).fontColor(this.pal().textMuted)
      } else {
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.modelGroups(), (g: ModelGroup) => {
              Column({ space: 4 }) {
                Text(g.name).fontSize(11).fontColor(this.pal().textMuted).width('100%')
                ForEach(g.entries, (e: LlmModelEntry, i: number) => {
                  Row({ space: 8 }) {
                    Text(this.labelOfModel(e)).fontSize(13)
                      .fontColor(this.modelSelectable(e) ? this.pal().textPrimary : this.pal().textMuted)
                      .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    if (this.modelBusy === `${g.subId}#${e.model}`) {
                      LoadingProgress().width(14).height(14).color(this.pal().accent)
                    } else if (e.model === this.currentModelName()) {
                      Text('✓ 当前').fontSize(11).fontColor(this.pal().successText)
                    }
                  }
                  .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
                  .onClick(() => {
                    if (!this.modelSelectable(e)) {
                      this.toast('该模型已禁用');
                      return;
                    }
                    this.pickModel(g.subId, e.model !== undefined ? e.model : '');
                  })
                }, (e: LlmModelEntry, i: number) => `${g.subId}#${e.model}`)
              }.width('100%')
            }, (g: ModelGroup) => `grp-${g.subId}`)
          }.width('100%')
        }
        .constraintSize({ maxHeight: 420 }).width('100%')
      }
    }
    .width('92%').padding(16).backgroundColor(this.pal().appBg)
    .borderRadius(12).border({ width: 1, color: this.pal().border })
    .transition(this.sheetTransition())
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
    } catch (e) {
      this.toast(`切换失败: ${errText(e as Object)}`);
    } finally {
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
    } catch (e) {
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
  @Builder
  StatusSheet() {
    Column({ space: 10 }) {
      Row() {
        Text('会话状态').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showStatus = false;
        })
      }.width('100%')

      if (this.goalLine().length > 0) {
        Text(this.goalLine()).fontSize(13).fontColor(this.pal().warn).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      if (this.currentTodoLine().length > 0) {
        Text(`进行中：${this.currentTodoLine()}`).fontSize(12).fontColor(this.pal().accentSoft).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      Text(this.statusBarText().length > 0 ? this.statusBarText() : '（暂无用量/模型信息）')
        .fontSize(12).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_ALL)
      Text(`todos ${todoProgress(this.todos).length > 0 ? todoProgress(this.todos) : '0/0'}`)
        .fontSize(12).fontColor(this.pal().textSecondary).width('100%')
      if (this.cwd.length > 0) {
        Text(`cwd: ${this.cwd}`).fontSize(11).fontColor(this.pal().textMuted).width('100%')
          .wordBreak(WordBreak.BREAK_ALL).copyOption(CopyOptions.LocalDevice)
      }

      // 模型 / 上下文上限（下一步：切换）
      Row({ space: 8 }) {
        Text(`模型：${this.currentModelName()}`)
          .fontSize(12).fontColor(this.pal().textPrimary).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.ctxText().length > 0) {
          Text(`上下文 ${this.ctxText()}`).fontSize(11).fontColor(this.pal().textSecondary)
        }
        Text('切换 ›').fontSize(12).fontColor(this.pal().accentSoft).padding({ left: 6, right: 6 })
      }
      .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
      .onClick(() => {
        this.anim(() => {
            this.showModel = true;
          });
        this.store?.loadLlmConfig();
      })

      if (this.todos.length > 0) {
        List({ space: 6 }) {
          ForEach(this.todos, (td: TodoItem, i: number) => {
            ListItem() {
              Row({ space: 8 }) {
                Text(td.status === 'completed' ? '✅' : (td.status === 'in_progress' ? '◐' : '○'))
                  .fontSize(13).fontColor(td.status === 'completed' ? this.pal().successText : this.pal().textSecondary)
                Text(td.text !== undefined ? td.text : '')
                  .fontSize(13)
                  .fontColor(td.status === 'completed' ? this.pal().textMuted : this.pal().textPrimary)
                  .layoutWeight(1)
                  .wordBreak(WordBreak.BREAK_ALL)
              }
              .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(6)
            }
          }, (td: TodoItem, i: number) => `${i}#${td.status}#${td.text}`)
        }
        .constraintSize({ maxHeight: 380 }).width('100%')
      } else {
        Text('（本会话暂无 todos）').fontSize(12).fontColor(this.pal().textMuted).width('100%')
      }
    }
    .width('92%').padding(16).backgroundColor(this.pal().appBg)
    .borderRadius(12).border({ width: 1, color: this.pal().border })
    .transition(this.sheetTransition())
  }

  @Builder
  SelfCheckSheet() {
    Column() {
      Row() {
        Text('渲染自检').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showSelfCheck = false;
        })
      }.width('100%')

      Button(this.geoRunning ? '采集中…' : '采集各页版面几何（数值，无需网络）')
        .width('100%').constraintSize({ minHeight: 40 }).backgroundColor(this.pal().accentSoft)
        .onClick(() => {
          this.collectAllGeometry();
        })
      Text('下方这一段可【长按复制】后直接粘贴给对方 —— 不必截图（零网络也能取证）')
        .fontSize(11).fontColor(this.pal().warn).width('100%')
      Text(this.auditText())
        .fontSize(11).fontColor(this.pal().successText).fontFamily('monospace')
        .width('100%').padding(8)
        .backgroundColor(this.pal().surfaceAlt).borderRadius(8)
        .copyOption(CopyOptions.LocalDevice)

      Scroll() {
        Column({ space: 10 }) {
          Column({ space: 6 }) {
            Text('A 纯文本（自动换行）').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。' })
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('B 行内样式（粗/斜/删除/行内码/链接）').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。' })
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('C 标题 + 列表').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二' })
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('D 代码块（含超长行）').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```' })
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('E 表格').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |' })
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('F 工具 pill 行（Flex 换行）').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(['✓ Read', '✓ Shell', '● Grep', '✓ Edit', '✗ Fetch'], (t: string) => {
                Text(t).fontSize(12).fontColor(this.pal().successText)
                  .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                  .margin(3).backgroundColor(this.pal().surfaceAlt).borderRadius(6)
                  .border({ width: 1, color: this.pal().border })
              }, (t: string) => t)
            }.width('100%')
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('G 长 URL（不可断词）').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            Text('https://xbot.pivotlang.tech/api/files/download?key=uploads%2F4%2Faaef9711-1349-420d-97ea-94e70e2401e7.jpg&inline=1')
              .fontSize(12).fontColor(this.pal().accentSoft).width('100%')
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })

          Column({ space: 6 }) {
            Text('H 顶栏内联布局').fontSize(12).fontColor(this.pal().textSecondary).width('100%')
            Row() {
              Text('☰').fontSize(20).fontColor(this.pal().textPrimary).padding(10)
              Text('标题文本').fontSize(15).fontColor(this.pal().textPrimary).layoutWeight(1)
              Text('⊞').fontSize(20).fontColor(this.pal().textPrimary).padding(10)
              Text('⚙').fontSize(20).fontColor(this.pal().textPrimary).padding(10)
            }.width('100%').backgroundColor(this.pal().surfaceAlt)
          }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          .border({ width: 1, color: this.pal().border })
        }
        .width('100%')
        .padding(10)
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('94%').height('86%')
    .padding(12)
    .backgroundColor(this.pal().appBg)
    .borderRadius(12)
    .border({ width: 1, color: this.pal().borderStrong })
  }

  @Builder
  QueueSheet() {
    Column({ space: 8 }) {
      Row() {
        Text(`待发队列 (${this.queue.length})`).fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showQueue = false;
        })
      }.width('100%')

      List() {
        ForEach(this.queue, (q: QueueItem) => {
          ListItem() {
            Row({ space: 6 }) {
              Text(q.content !== undefined && q.content.length > 0
                ? q.content
                : (q.text !== undefined ? q.text : ''))
                .fontSize(13).fontColor(this.pal().textPrimary).layoutWeight(1).maxLines(3)
                .wordBreak(WordBreak.BREAK_ALL)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text('↑').fontSize(14).fontColor(this.pal().accentSoft).padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.moveQueued(id, -1);
              })
              Text('↓').fontSize(14).fontColor(this.pal().accentSoft).padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.moveQueued(id, 1);
              })
              Text('✕').fontSize(14).fontColor(this.pal().dangerText).padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.cancelQueued(id);
              })
            }.width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
          }
        }, (q: QueueItem) => `${q.msg_id}#${q.content}#${q.text}`)
      }
      .height(300).width('100%')
    }
    .width('92%').padding(16).backgroundColor(this.pal().appBg)
    .borderRadius(12).border({ width: 1, color: this.pal().border })
  }

  // ── 弹层：插件面板 ────────────────────────────────────────────────────────

  @Builder
  PluginsSheet() {
    Column({ space: 8 }) {
      Row() {
        Text('能力面板').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(8).onClick(() => {
          this.showPlugins = false;
        })
      }.width('100%')

      Text('原生渲染聊天主链路；下列能力由 ArkWeb 承载（与 Web 版同源、能力一致）：')
        .fontSize(11).fontColor(this.pal().textSecondary).width('100%')

      List() {
        // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
        ListItem() {
          Row() {
            Text('🌐  完整 Web UI').fontSize(14).fontColor(this.pal().textPrimary).layoutWeight(1)
            Text('打开').fontSize(12).fontColor(this.pal().accentSoft)
          }
          .width('100%').padding(12).backgroundColor(this.pal().surfaceAlt).borderRadius(8)
          .onClick(() => {
            this.showPlugins = false;
            this.panelUrl = this.serverUrl;
          })
        }
        ForEach(this.plugins, (p: PluginPanelInfo) => {
          ListItem() {
            Row() {
              Column() {
                Text(p.name).fontSize(14).fontColor(this.pal().textPrimary)
                Text(p.url).fontSize(10).fontColor(this.pal().textMuted).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('打开').fontSize(12).fontColor(this.pal().accentSoft)
            }
            .width('100%').padding(12).backgroundColor(this.pal().surfaceAlt).borderRadius(8)
            .onClick(() => {
              this.showPlugins = false;
              this.panelUrl = p.url;
            })
          }
        }, (p: PluginPanelInfo) => `${p.id}#${p.url}`)
      }
      .height(320).width('100%')
    }
    .width('92%').padding(16).backgroundColor(this.pal().appBg)
    .borderRadius(12).border({ width: 1, color: this.pal().border })
  }

  // ── 弹层：AskUser ────────────────────────────────────────────────────────

  @Builder
  AskUserSheet() {
    Column({ space: 10 }) {
      Text('xbot 需要你确认').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.pal().warn).width('100%')
      List() {
        ForEach(this.askUser !== null && this.askUser.questions !== undefined ? this.askUser.questions : [],
          (q: AskQuestion, qi: number) => {
            ListItem() {
              Column({ space: 6 }) {
                if (q.header !== undefined && q.header.length > 0) {
                  Text(q.header).fontSize(12).fontColor(this.pal().textSecondary).width('100%')
                }
                Text(q.question !== undefined ? q.question : '').fontSize(14).fontColor(this.pal().textPrimary).width('100%')

                ForEach(q.options !== undefined ? q.options : [], (opt: AskOption, oi: number) => {
                  Row() {
                    Text(this.isAskSelected(q.id !== undefined ? q.id : `q${qi}`,
                      opt.label !== undefined ? opt.label : '') ? '◉' : '○')
                      .fontSize(14).fontColor(this.pal().accentText)
                    Column() {
                      Text(opt.label !== undefined ? opt.label : '').fontSize(13).fontColor(this.pal().textPrimary)
                      if (opt.description !== undefined && opt.description.length > 0) {
                        Text(opt.description).fontSize(11).fontColor(this.pal().textMuted)
                      }
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 6 })
                  }
                  .width('100%').padding(8).backgroundColor(this.pal().surface)
                  .borderRadius(6)
                  .onClick(() => {
                    this.toggleAskOption(q.id !== undefined ? q.id : `q${qi}`,
                      opt.label !== undefined ? opt.label : '',
                      q.multi_select === true);
                  })
                }, (opt: AskOption, oi: number) => `o-${qi}-${oi}`)

                if (q.allow_other === true) {
                  TextInput({ placeholder: '其他（自己填）' })
                    .onChange((v: string) => {
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
                    })
                    .constraintSize({ minHeight: 38 }).backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary)
                }
              }.width('100%').padding(8)
            }
          }, (q: AskQuestion, qi: number) => q.id !== undefined ? q.id : `q${qi}`)
      }
      .constraintSize({ maxHeight: 420 }).width('100%')

      Row({ space: 8 }) {
        Button('取消').layoutWeight(1).constraintSize({ minHeight: 42 }).backgroundColor(this.pal().surfaceHi).onClick(() => {
          this.submitAsk(true);
        })
        Button(this.askBusy ? '提交中…' : '提交').layoutWeight(1).constraintSize({ minHeight: 42 })
          .backgroundColor(this.pal().accent).fontColor(this.pal().onAccent)
          .onClick(() => {
            this.submitAsk(false);
          })
      }.width('100%')
    }
    .width('94%').padding(16).backgroundColor(this.pal().surfaceAlt)
    .borderRadius(12).border({ width: 1, color: this.pal().warn })
  }

  // ── 弹层：图片查看 ────────────────────────────────────────────────────────

  @Builder
  ImageViewer() {
    Column() {
      Row({ space: 8 }) {
        Text('图片').fontSize(15).fontColor(this.pal().textPrimary).layoutWeight(1)
        if (isZoomed(this.imgScale)) {
          Text(scaleText(this.imgScale)).fontSize(12).fontColor(this.pal().textSecondary)
          Text('复位').fontSize(12).fontColor(this.pal().accentSoft).padding(6).onClick(() => {
            this.imgScale = 1;
            this.imgTransX = 0;
            this.imgTransY = 0;
          })
        }
        // 保存到相册：走系统安全组件（SaveButton）—— 用户授权后才有写权限，
        // 因此不需要申请相册写权限，也不会在未授权时静默失败。
        SaveButton({ icon: SaveIconStyle.FULL_FILLED, text: SaveDescription.SAVE_IMAGE, buttonType: ButtonType.Capsule })
          .onClick((event: ClickEvent, result: SaveButtonOnClickResult) => {
            if (result === SaveButtonOnClickResult.SUCCESS) {
              this.saveToAlbum();
            } else {
              this.toast('需要授权才能保存到相册');
            }
          })
        Text('✕').fontSize(16).fontColor(this.pal().textSecondary).padding(10).onClick(() => {
          this.closeViewer();
        })
      }.width('100%')

      if (this.imageBusy) {
        Column() {
          LoadingProgress().width(32).height(32).color(this.pal().accent)
          Text('加载图片…').fontSize(12).fontColor(this.pal().textSecondary).margin({ top: 8 })
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.imagePixel !== null) {
        Stack() {
          Image(this.imagePixel)
            .objectFit(ImageFit.Contain)
            .width('100%')
            .height('100%')
            .scale({ x: this.imgScale, y: this.imgScale })
            .translate({ x: this.imgTransX, y: this.imgTransY })
            .gesture(
              GestureGroup(GestureMode.Parallel,
                // 双指缩放：以手势开始时的缩放为基准（否则会指数级失控）
                PinchGesture({ fingers: 2 })
                  .onActionStart(() => {
                    this.imgBaseScale = this.imgScale;
                  })
                  .onActionUpdate((e: GestureEvent) => {
                    this.imgScale = clampScale(this.imgBaseScale * e.scale);
                    if (!isZoomed(this.imgScale)) {
                      this.imgTransX = 0;
                      this.imgTransY = 0;
                    }
                  }),
                // 拖动平移：位移同样以手势开始时的位置为基准，并按放大倍数夹取
                PanGesture({ fingers: 1 })
                  .onActionStart(() => {
                    this.imgBaseX = this.imgTransX;
                    this.imgBaseY = this.imgTransY;
                  })
                  .onActionUpdate((e: GestureEvent) => {
                    const limX: number = panLimit(this.imgScale, this.viewW, this.imgW);
                    const limY: number = panLimit(this.imgScale, this.viewH, this.imgH);
                    this.imgTransX = clampOffset(this.imgBaseX + e.offsetX, limX);
                    this.imgTransY = clampOffset(this.imgBaseY + e.offsetY, limY);
                  }),
                // 双击：1 ↔ 2.5 倍
                TapGesture({ count: 2 })
                  .onAction(() => {
                    this.imgScale = nextZoom(this.imgScale);
                    if (!isZoomed(this.imgScale)) {
                      this.imgTransX = 0;
                      this.imgTransY = 0;
                    }
                  })
              )
            )
        }
        .layoutWeight(1)
        .width('100%')
        .clip(true)
        .onAreaChange((oldArea: Area, newArea: Area) => {
          this.viewW = Number(newArea.width);
          this.viewH = Number(newArea.height);
        })
      }
    }
    .width('94%').height('80%').padding(12)
    .backgroundColor(this.pal().appBg).borderRadius(12).border({ width: 1, color: this.pal().border })
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
  applyRows(next: ChatRow[]): void {
    const structural: boolean = !sameRowIds(this.rows, next);
    const changed: number[] = structural ? [] : changedRowIndices(this.rows, next);
    this.rows = next;
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
