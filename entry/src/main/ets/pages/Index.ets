import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { componentSnapshot, componentUtils, display, window } from '@kit.ArkUI';
import { image } from '@kit.ImageKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { vibrator } from '@kit.SensorServiceKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { KeyCode } from '@kit.InputKit';
import { util } from '@kit.ArkTS';
import { AppConfig, ConfigStore, isValidServerUrl, normalizeServerUrl, readCachedTheme } from '../core/config';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ChatStore, LOADMORE_ERR_NOCURSOR } from '../core/store';
import { beginTurnKeepAlive, endTurnKeepAlive, ensureEnabled, notificationsEnabled, PENDING_CHAT_KEY, PENDING_CHAT_SEQ_KEY, PENDING_ACTION_KEY, isKnownNotifyAction, NOTIFY_ACTION_STOP, NOTIFY_ACTION_CONTINUE } from '../core/notify';
// 后台对账（workScheduler 延迟任务）的取消入口（目标①：登出必须停掉它）
import { cancelReconcileScheduled } from '../workreconcile/schedule';
// 触觉「事件 → 档位」：唯一入口 `buzz(event)` 只消费本模块的**纯映射**（阶段 2）。
// ⛔ 时长不再裸写、也不再直接用单档常量 —— 一律由 `hapticFor(event)` 决定（未登记事件 ⇒ 不动）。
import {
  hapticFor, HAPTIC_NONE_MS,
  HAPTIC_EVENT_SEND, HAPTIC_EVENT_STOP, HAPTIC_EVENT_SELECT, HAPTIC_EVENT_TOGGLE, HAPTIC_EVENT_CONFIRM,
} from '../core/haptics';
// ⚠️ 2026-10-11：`isDarkThemeName` **已从这里移除** —— 本文件 3 处旧用法已全部改走**亮度口径**
//   （`isLightPalette(paletteOf(theme))`，铁律「禁按主题名硬判」）⇒ 该导入**已无消费者**（死导入）。
import { ALL_THEMES, normalizeTheme, Palette, paletteOf, renderThemeKey, themeBaseName, themeLabel, Effects, effectsOf, isLightPalette, shadowColorOf, shadowLayersOf, ShadowLayer, shadowRadiusOf, setAmbience } from '../core/theme';
// 环境（插件）值解析：`plugin_config`（**不看 `Web.Entry`**）里 `xbot.ambience` 的 `values`
// ⇒ `AmbienceValues`（只取"用户真改过"的键）。详见 `core/theme.ets` 的 2026-10-13 订正注释。
import { AMBIENCE_PLUGIN_ID, ambienceFromPluginConfig } from '../core/settingsplugins';
import { brandAccentFor } from '../core/brand';
import { ACCENT_PRESETS, accentLabel, contrastForeground, normalizeAccent, withAccent } from '../core/accent';
import { MD_THEMES, appPaletteForMdTheme, mdThemeLabel, normalizeMdTheme } from '../core/mdtheme';
import { localeLabel, normalizeLocale } from '../core/i18n';
import { isStarred, parseStarred, serializeStarred, starredFirst, toggleStarred } from '../core/stars';
import { EASE_SPRING_DAMPING, EASE_SPRING_RESPONSE, FS_BODY, FS_BOOT_WORDMARK, FS_BRAND_WORDMARK, FS_CAPTION, FS_HERO, FS_META, FS_TITLE, R_2XL, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5, SP_6, SP_8 } from '../core/tokens';
// 「更早的 N 个迭代块」哨兵的**同一份**恒定行高（①三处提示同视觉语言 ⇒ 同高，⛔ 不另写字面量）。
import { MSG_BLOCK_SENTINEL_H } from '../core/rowsview';
// 抽屉重排：尺度/层级/材质一律走语义令牌层（⛔ 不新增字面量；`surfaceFillOf`/`hairlineOf`/
// `typeOf` 是唯一出口）。色值一律经 `this.pal()`（`surfaceFillOf` 的 role 是**带点**的语义面名）。
import {
  GAP_BLOCK, HIT_TARGET_MIN, ICON_LG, ICON_MD, ICON_SM, ICON_XL, INSET_ROW_X,
  MARKER_GUTTER,
  PRESS_OPACITY, PRESS_SCALE, RADIUS_CARD, RADIUS_CHIP, RADIUS_PILL, RADIUS_SHEET, SHEET_ACTION_GLYPH, SPACE_HAIR, SPACE_LG, SPACE_MD,
  SPACE_SM, SPACE_XL, SPACE_XS, SPACE_XXL, SPACE_XXS, STROKE_HAIRLINE, STROKE_RAIL, colorOf, hairlineOf,
  insetHairlineOf, SHEET_WIDTH, surfaceFillOf, typeOf,
} from '../core/design';
import { isUnauthorized, loadErrHint, loadErrTitle, needsRelogin, needsSessionRefresh } from '../core/autherr';
import {
  canMove, MOVE_DOWN, MOVE_TOP, MOVE_UP, hitLine, sessionTitle, sessionMatches,
} from '../core/sessionops';
import {
  BgTask, bgTaskLeadCode, bgTaskMetaText, bgTaskOutputText, bgTaskPrimary, bgTaskRunning, bgTaskStatusText, bgTaskSubText,
  sortBgTasksActiveFirst,
  cmdOneLine,
  bgTaskTone, CronJob, cronMessageText, cronPrimary, cronSubText, cronTargetText, fmtDateTime,
  RunnerRow, runnerPrimary, runnerSubText, runnerTone, scheduleText,
  SubAgentRow, subagentPrimary, subagentSubText, subagentTone, TONE_MUTED, LEAD_CRON,
  resolveSessionNode,
} from '../core/panels';
import { TerminalInfo, terminalPrimary, terminalSubText, terminalTone } from '../core/termproto';
import {
  activeToken, applyCommand, applyMention, clampSel, CMD_ROWS, CommandItem, completionKeyAction,
  ComposerButton, composerButtonState, composerPlaceholder, enterSends,
  FS_ROWS, FsEntry, joinPath, matchCommands, matchFiles, parentDir, selNext, selPrev, spinHoldRemainingMs,
} from '../core/composer';
// §21.122bu「一个页面只有一个形态」：能力面承载判定（唯一真源）+ 入口唯一出口 `openSurface`。
import {
  isNativeSurface, SURFACE_NATIVE, SURFACE_WEB, SURF_FILES, SURF_GENUI, SURF_PLUGINS,
  SURF_TASKS, SURF_TERMINAL, SURF_WEBUI, surfaceOf,
} from '../core/surfaces';
// §21.122bx：浮层覆盖聊天区时的 live 可见态**降频**判据（纯函数，防"开浮层特别卡"）。
import { shouldDeliverLive } from '../core/livedeliver';
import {
  clampOffset, clampScale, isZoomed, nextZoom, panLimit, saveImageName, scaleText,
} from '../core/imgops';
import {
  fontScaleFrom, fontScaleLabel, fontScalePresets, KEY_CODE_WRAP, KEY_FONT_SCALE, KEY_SURFACE,
  KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_ORB, KEY_REASONING_DEFAULT, KEY_SEND_KEY, KEY_SESSION_CATEGORY,
  KEY_STARRED, normalizeSendKey, orbEnabled, parseBool, sendKeyLabel, settingOf, settingLabel, SEND_KEY_MOD_ENTER,
  THINKING_STEP_LABELS, thinkingModeToStep, thinkingStepLabel, thinkingStepToMode,
} from '../core/settings';
// 最近工作目录（新建会话选 cwd）—— web `lib/recent-workdirs.ts` 的纯逻辑移植（`10aae43`）。
// 持久化走**服务端设置键** `RECENT_WORKDIRS_SERVER_KEY`（= web `userSettings.ts:44` 的映射目标），
// 与 web 共享同一份偏好（`core/settings.ets` 对该键原样透传 ⇒ 零丢键）。
import {
  parseRecentWorkDirs, rememberWorkDir, removeWorkDir, serializeRecentWorkDirs, RECENT_WORKDIRS_SERVER_KEY,
} from '../core/recentdirs';
// 路径选择器自动补全的纯逻辑（web `PathPicker.tsx` 的 parseInput/filter/navigateInto）——
// 新建会话弹层的 cwd 输入即消费它（E 项）。
import { childPath, filterChildDirs, parsePathInput, PathInput } from '../core/pathpick';
import {
  isInterruptSend, MODE_INTERRUPT, MODE_QUEUE, modeHint, modeLabel, sendToast, toggleMode,
} from '../core/sendmode';
import { mdCacheStats, MdCacheStats } from '../core/markdown';
import { completedBlocks, displayContent, displayReasoning, resolveRowReply, rowHasInFlightSignal, rowIsEmpty, streamStatsText, toolsSignature } from '../core/streammerge';
import { canRewindWhile } from '../core/ctxmenu';
import { rowById } from '../core/rowquery';
import {
  activeChannelLabel, ALL_CHANNEL_ORDER, availableChannels, channelFilterMatches,
  channelLabel, dedupeSessionItems, hiddenRowCount, sessionInChannel, visibleRows, MAX_ROWS_VISIBLE,
  canonicalChatId, channelForChat, channelForChatIndexed, channelIndex,
} from '../core/sessionpick';
import {
  applyGroupsCollapsed, collapseAllPlan, collapseKey, CollapseAllPlan, formatLastActive, groupSessionsFromItems, groupTitle,
  normalizeSessionCategory, parseAgentChatID, pathGroupTooltip, relativeTimeLabel, SESSION_CATEGORIES, SessionGroup, sessionCategoryLabel,
  sessionStatusRole,
} from '../core/sessiongroup';
import { AnchorsMemo, buildAnchors, NavAnchor, nearestSeq, userAnchorRows } from '../core/msgindex';
import { PluginCatalog, PluginCatalogGroup, PluginCatalogItem, PluginOpenTarget, PluginViewItem, WebPluginListWire, buildPluginCatalog, embedPluginViewLink, nativeViewKind, pluginOpenTarget, pluginViewDeepLink, pluginViewTarget, primaryViewId, PLUGIN_MANAGER_VIEW_ID, webPanelDeepLink, webPanelTitle } from '../core/pluginhost';
import { hasIterStatsBadge, iterStatsText } from '../core/pluginviews';
import { SkillItem } from '../core/skills';
import { FsFileEntry, FsReadResult, FsSearchEntry, fileKindOf, baseNameOf, FK_IMAGE, fsMention, sortFsEntries, sortFsSearch } from '../core/files';
import {
  ATTACH_DONE, ATTACH_FAILED, ATTACH_UPLOADING, AttachItem, MAX_ATTACH, appendRef, attachChipText,
  attachmentRef, baseName, doneKeys, doneNames, doneRefs, doneSizes, hasRef, humanSize, mimeOf,
  patchByUid, pendingCount, removeByUid,
} from '../core/attach';
import { identityChanged, needsFullReload, rowKey, rowsFpOf, sameRowIds,
  structRowsFpOf,
  scopedFingerprint, themableRowKey, tailRows } from '../core/rowdiff';
import { BusySignals, busyLabel, busyNow, DRAWER_EMPTY_NO_MATCH, DRAWER_EMPTY_NO_SESSIONS, DRAWER_EMPTY_NONE, drawerEmptyHint, drawerEmptyKind, showsBusyPlaceholder, showsHistorySkeleton, showsJumpToLatest } from '../core/indicators';
import { drawerCacheHit, drawerFingerprint } from '../core/drawerfp';
// SSE 终态（服务端明确拒绝 ⇒ 停止无限重连）——页面横幅据它显示**可解释的终态**而非"正在重连"。
import { SSE_STATE_FAILED } from '../core/sse';
// 插件 widget 数据面（页面半边）：SSE 事件名 + 载荷（判据在 `core/widgetsview.ets`）
import { WIDGET_EVENT_WEB } from '../core/widgetsview';
// 插件桥 page→native 的消息类型（协议权威 = `core/webbridge.ets`）
import { BridgeMessage, HostNavEvent, HOST_NAV_TITLE, HOST_NAV_READY, HOST_NAV_OPEN_FILE } from '../core/webbridge';
import { listItemCount, nextFollowBottom, shouldAutoScroll, followSuppressUntil, FOLLOW_SUPPRESS_MS, markUserScrollFrame, followAfterScrollStop, anchoredIndexAfterPrepend } from '../core/listfollow';
import { hasOverlay, OverlayCode, OverlayState, topOverlay } from '../core/overlays';
import {
  currentTodo, modelText, todoProgress, usageText,
} from '../core/statusfmt';
import { ctxHasUsage, ctxLabel, ctxPercent } from '../core/ctxring';
import {
  contextPresets, contextText, currentModelText, groupModels, LlmConfig, LlmModelEntry, ModelGroup,
  MODEL_PANEL_EMPTY, MODEL_PANEL_ERROR, MODEL_PANEL_LOADING, ModelPanelStatus, modelLabel,
  modelPanelStatus, parseContext, selectable,
} from '../core/llmfmt';
import {
  AskAnswerInput, askAllAnswered, askAnsweredFlags, COPY_RAW, COPY_REPLY, COPY_THINKING, COPY_TOOLS, CopyParts, composeCopy, linkLabel,
  linksIn, mergeAskAnswers, PendingEdit, resolveOpenable, RewindTarget, toolArgsOnly, toolCopyText,
  toolResultOnly,
} from '../core/msgops';
import { PendingSeq } from '../core/pendingedit';
import {
  AskOption,
  AskQuestion,
  AskUserPrompt,
  ChatRow,
  HistoryIteration,
  QueueItem,
  SearchHit,
  SessionItem,
  TodoItem,
  TokenUsage,
  ToolProgress,
} from '../core/types';
import { runeCount } from '../core/typewriter';
// 应用内开屏（冷启动 T1 入场 / T2 让位）—— 判据全在 `core/splash`（纯逻辑、已单测），页面只负责编排。
import {
  LAUNCH_COLD, SPLASH_T1, SPLASH_T2, SPLASH_T3,
  SPLASH_EXIT_MS, SPLASH_HYSTERESIS_MS, SPLASH_MIN_DWELL_MS, SPLASH_TIMEOUT_MS,
  shouldShowSplash, shouldStartSplash,
} from '../core/splash';
import { SplashOverlay } from '../components/SplashOverlay';
import { Lightbox } from '../components/Lightbox';
import { Toast } from '../components/Toast';
import {
  TOAST_KIND_COPY, TOAST_KIND_NOTICE, ToastState, emptyToast, nextToast,
  toastDurationMs, toastExpired, toastVisible,
} from '../core/toast';
import { MessageRowView } from '../components/MessageRow';
import { UserBubbleView } from '../components/UserBubble';
import { MarkdownView } from '../components/MarkdownView';
import { WebSurface } from '../components/WebSurface';
import { ContextRing } from '../components/ContextRing';
import { SettingsPanel, SETTINGS_TAB_ACCOUNT, SETTINGS_TAB_AGENT, SETTINGS_TAB_APPEARANCE, SETTINGS_TAB_ABOUT, SETTINGS_TAB_CHANNELS, SETTINGS_TAB_DEVELOPER, SETTINGS_TAB_LLM, SETTINGS_TAB_NOTIFY, SETTINGS_TAB_PLUGINS, SETTINGS_TAB_STORAGE, SETTINGS_TAB_TOOLS, SETTINGS_TAB_WEBUSERS } from '../components/SettingsPanel';
import {
  COMMAND_INPUT_FOCUS, COMMAND_SESSION_NEW, COMMAND_SETTINGS_OPEN, COMMAND_SIDEBAR_TOGGLE,
  CommandAction, PENDING_COMMAND_KEY, PENDING_COMMAND_SEQ_KEY, commandArg, commandDispatchable, parseCommandUri,
} from '../core/command';
import { MessageNav, NAV_ACTIVE_SEQ_KEY } from '../components/MessageNav';
import { SearchHit as RowHit, rowSearchHits } from '../core/rowsearch';
import { PluginHost } from '../components/PluginHost';
import { GoalBanner } from '../components/GoalBanner';
import { WidgetDock } from '../components/WidgetDock';
import { TodoPanel } from '../components/TodoPanel';
import { StagingTray } from '../components/StagingTray';
import { StatusSheet } from '../components/StatusSheet';
import { QueueSheet } from '../components/QueueSheet';
import { PluginsSheet } from '../components/PluginsSheet';
import { SessionStatsSheet } from '../components/SessionStatsSheet';
import { FilesSheet } from '../components/FilesSheet';
import { SkillsSheet } from '../components/SkillsSheet';
import { SelfCheckSheet } from '../components/SelfCheckSheet';
import { TaskDetailSheet } from '../components/TaskDetailSheet';
import { CronDetailSheet } from '../components/CronDetailSheet';
import { GitPanelSheet } from '../components/GitPanelSheet';
// 远程机器面板（web 内置插件 `xbot.ssh-runner` 的落地）——**自持状态 + 注入 RPC 通道**
// （同 `TerminalSheet` 先例：判据全在 `core/sshrunner.ets`，页面只给通道与 flag）。
import { SshRunnerSheet } from '../components/SshRunnerSheet';
// 原生 Git 面板（web 内置插件 `xbot.git-fancy` 的落地）——**数据模型/判据/格式化全在纯模块**，
// 页面只做取数与所有权（与 `core/panels.ets`→`CronDetailSheet` 同一分层）。
import {
  GitChange, GitCommitDetail, GitDiffData, GitLog, GitStatus, GitChatParams, GitCommitParams,
  GitDiffParams, GitLogParams, WebPluginRpcParams, GitCommitDetailWire, GitDiffWire, GitLogWire,
  GitStatusWire, gitAheadBehindText, gitBranchText, gitCommitMetaText, gitHeadline, gitMethod,
  hasMoreGitLog, mergeGitLog, parseGitCommit, parseGitDiff, parseGitLog, parseGitStatus, GIT_LOG_PAGE,
  GIT_PLUGIN_ID, RPC_WEB_PLUGIN,
} from '../core/gitpanel';
// 运行面板（任务管理）的**结构化行卡**（真 @Component；取色走 `paletteOf(theme)` ⇒ 不占页面预算）
import { PanelRowCard, ROW_TRAIL_CHEVRON, ROW_TRAIL_CLOSE, ROW_TRAIL_DELETE, ROW_TRAIL_NONE, ROW_TRAIL_STOP } from '../components/PanelRows';
import { TerminalSheet } from '../components/TerminalSheet';
import { SessSheet, SearchHitsSheet, ContextSheet } from '../components/MenuSheets';
import { AskUserSheet } from '../components/AskUserSheet';
import { animBase, animFast, drawerTransition, fadeTransition, sheetTransition } from '../components/anim';
// 运行面板「运行中 @2s / 静息 @30s」的自适应轮询预算（web `useTasks.ts:117-122` + `TasksPanel.tsx:48-54` 同源）
import { panelPollMs } from '../core/panels';
// 会话面切换的入场位移档（动效数值只许从底座 `core/motion.ets` 取；⛔ 页面不写字面量）
import { MOTION_SESSION_SWITCH_SLIDE_VP } from '../core/motion';
import { readableRpcError, rpc, RpcMethod, RPC_PLUGIN_CONFIG, PluginConfigParams, RPC_WEB_PLUGIN_LIST, RPC_GET_SESSION_USAGE_STATS, RPC_GET_USER_TOKEN_USAGE, RPC_GET_DAILY_TOKEN_USAGE, RPC_GET_SESSION_USAGE_BUCKETS, SessionUsageStatsParams, DailyUsageParams, SessionUsageBucketsParams, EmptyParams, ThinkingModeParams } from '../core/rpc';
import { parseSessionUsage, SessionUsage, SessionUsageWire, parseUserUsage, parseDailyUsage, parseBuckets, UserUsage, UserUsageWire, DailyUsage, DailyUsageWire, UsageBucket, UsageBucketWire, bucketRequestCount, DAILY_DAYS_WINDOW, tzOffsetMinutesFor } from '../core/sessionstats';
import { TodoPayloadRow, removeTodoAt, renameTodoAt, todoPayloadRows, toggleTodoAt } from '../core/todos';
import { genuiPayloadTooLarge } from '../core/genui';
import { WebSubAgentProgress } from '../core/chattypes';
import { EMPTY_BLOCKS_SIGNATURE, liveBlocksSignature, subAgentsFingerprint } from '../core/render';
import { withAlpha } from '../core/bubble';

/** 一个问题当前选中的答案（用类而非 Map/Record：ArkTS 下最稳，且能整体替换触发重渲染）。 */
class AskSelection {
  qid: string = '';
  labels: string[] = [];
  other: string = '';
  /**
   * 该题的**自由文本**（web `AskUserPanel.tsx:43 freeInputs`；优先级最高）。
   * ⛔ web 铁律：**每题恒有自由文本输入**（用户可以无视选项直接写）。
   */
  free: string = '';
}

/**
 * 抽屉会话列表的**分组渲染单元**（页面侧 VM）。
 *
 * ⛔ 为什么还要一层：`core/sessiongroup.ets` 的分组产物只带"分组/排序读到的字段"
 *   （`GroupSession`），而抽屉的行卡片要渲染 `label`/`running` 等**原始行字段**
 *   ⇒ 这里把 `SessionGroup` 与原始 `SessionItem` 配对（顺序仍由纯逻辑决定）。
 *   这样行体（原封不动的 `s: SessionItem` 渲染）**一个字都不用改**，也不需要把渲染字段
 *   塞回纯逻辑模块（保持 `core/` 只谈分组语义）。
 */
class DrawerGroup {
  /** 组键（path = 完整目录 / `__unset__`；time = 桶名；status = 状态名）。 */
  key: string = '';
  /** 组标题（来自 `groupTitle`，不在页面里重写一套文案规则）。 */
  title: string = '';
  /** 完整路径（仅 path 分类且非 unset 时非空；原生端用作行内副标题消歧）。 */
  tip: string = '';
  /** 组成员（**原始行**，顺序 = 纯逻辑给的顺序）。 */
  items: SessionItem[] = [];
}

/**
 * `set_goal` 的 RPC params（web `agent/api.ts:181-186`：`{channel, chat_id, objective}`）。
 * ⛔ 显式类而非对象字面量（ArkTS `arkts-no-untyped-obj-literals`）。
 */
class SetGoalParams {
  channel: string = '';
  chat_id: string = '';
  objective: string = '';

  constructor(channel: string, chatId: string, objective: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.objective = objective;
  }
}

/** `clear_goal` 的 RPC params（web `api.ts:236-241`：`{channel, chat_id}`）。 */
class ClearGoalParams {
  channel: string = '';
  chat_id: string = '';

  constructor(channel: string, chatId: string) {
    this.channel = channel;
    this.chat_id = chatId;
  }
}

/** `set_todos` 的 RPC params（web `api.ts:194-198`：`{channel, chat_id, todos}`，只发 text+status）。 */
class SetTodosParams {
  channel: string = '';
  chat_id: string = '';
  todos: TodoPayloadRow[] = [];

  constructor(channel: string, chatId: string, todos: TodoPayloadRow[]) {
    this.channel = channel;
    this.chat_id = chatId;
    this.todos = todos;
  }
}

/**
 * `set_cwd` 的 RPC params（web `agent/api.ts:168-177`：`{channel, chat_id, dir, force:true}`）。
 *
 * ⛔ `force:true` 不可省：服务端 `rpc_table.go:431-449` 据此走 `SetCWDForced`（**原样采纳**传入路径），
 *   否则会被既有 cwd / 自动推断值顶掉（用户要求原文：「我传的是什么路径就得是什么路径」）。
 */
class SetCwdParams {
  channel: string = '';
  chat_id: string = '';
  dir: string = '';
  force: boolean = true;

  constructor(channel: string, chatId: string, dir: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.dir = dir;
  }
}

/** `set_cwd` 的 RPC method 名（服务端 `agent/req_types.go:14`；⛔ 与 `set_goal` 等同址就地定义）。 */
const RPC_SET_CWD: string = 'set_cwd';

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
 * 空态星形**圆形辉光**的直径（vp）。
 *
 * 为什么是"圆光"而不是 `.shadow`：`.shadow` 按**字形包围盒**渲染 —— 深色底上星形外面是
 * 一圈"圆角方盒"而非圆光（真机截图取证：亮区 x 恒为 556..763 的矩形）。改用径向渐变
 * （`radialGradient`，与登录页顶部光晕同一手段，见 `docs/DESIGN-SYSTEM.md §4`）裁成圆：
 * 中心 accent 辉光、边缘透明 ⇒ 是圆不是盒，且不随字形包围盒变形。
 * 尺寸取星形字号 52 的 ~2.7×（150）：足够铺开柔和过渡，又不至于把空态撑得太空。
 */
const STAR_GLOW_SIZE: number = 150;

/**
 * 诊断开关：登录后**自动**走查并上传所有页面截图。
 *
 * 为什么需要它：用户反馈"渲染错乱、完全用不了"时，可能**连 ⚙ 都点不到** ⇒
 * 交互式触发不可靠。置 true 后 App 会在登录后自行走查一遍（每页截图上传到服务端），
 * 供排查用。**排查完成应改回 false**（避免每次启动都上传）。
 */

/**
 * 本文件**唯一**的 `setTimeout` 调用点 —— 所有一次性延时都经此收敛。
 *
 * 为什么要收敛：性能预算 ⑦（`tools/perf/guard.sh`）计的是 **`setTimeout(` 调用点个数**（≤7），
 * 目的是防"定时器散落各处"。与本仓 `components/SettingsChannels.ets:663` 的同款做法
 * （那边也把 `setTimeout` 收成唯一出口）。返回定时器 id，供 `clearTimeout` 取消。
 */
function delay(fn: () => void, ms: number): number {
  return setTimeout(fn, ms);
}

// ── 分段控件（iOS segmented control）的**视觉**尺寸（用户 2026-10-12 亲报「那个项目/状态/时间 高度
//    太高了」）────────────────────────────────────────────────────────────────────────────
// 病根：此前把**命中盒**（`HIT_TARGET_MIN` = 44vp）直接当**视觉**高度用 ⇒ 轨道 44 + 上下内边距 = 48vp，
//   比 Apple 栏内控件（~32-36pt，见 iOS 分段控件/导航栏按钮）高出一大截，观感"笨重"。
// ⛔ 不能靠 `responseRegion` 负偏移外扩来"视觉小、热区大" —— 真机实测无效（本仓 GOTCHA）。
//    ⇒ 正解：**轨道画小（36）、命中外盒留大（44）**：选中芯 32 浮在 36 轨道里（Apple 的 28-in-32 同比例），
//    而每段的 `onClick` 落在 44 的布局盒上 ⇒ 视觉是 Apple 的、热区仍是 44。
/** 分段控件的视觉轨道高（vp）= 36。 */
const SEG_TRACK_H: number = SPACE_XXL + SPACE_XXS;
/** 分段控件选中芯（浮起 pill）高（vp）= 32 —— 与轨道留 2vp 内缩。 */
const SEG_PILL_H: number = SPACE_XXL;

/**
 * 会话行「运行中」状态点的**光晕半径**（vp）= 3（≈ web `boxShadow: 0 0 8px` ÷ density 3.386）。
 * 静态阴影 ⇒ 与"唯一在飞动效 = 光球"的口径不冲突（⛔ 不做呼吸/脉冲：那会进 `animateTo` 不透明度，
 * 触本仓门禁⑨ 的 B 级通道，且呼吸点会与光球抢注意力）。
 */
const DOT_GLOW_R: number = 3;

// ════════════════════════════════════════════════════════════════════════════
// 深链命令的页面落点（S1）—— 纯映射部分
// ════════════════════════════════════════════════════════════════════════════

/** composer 输入框的**焦点 id**（`input.focus` 命令靠它定位；⛔ 别在多处硬写这个字符串）。 */
export const COMPOSER_INPUT_ID: string = 'composer-input';

/**
 * 深链 `input.focus` 的**挂载后延迟**（ms）—— 让首帧先布局，`COMPOSER_INPUT_ID` 的 TextArea
 * 挂上了再聚焦。见 `dispatchCommand` 的 `COMMAND_INPUT_FOCUS` 分支（冷启动路径早于 `build()`）。
 */
export const FOCUS_AFTER_MOUNT_MS: number = 16;

/**
 * 设置分区**白名单** —— 真源 = `components/SettingsPanel.ets` 的 `SETTINGS_TAB_*` **导出**
 * （⛔ 不在此新造字符串；web 的 `settings.open?section=llm` 用的就是同一批小写名）。
 */
const SETTINGS_TABS: string[] = [
  SETTINGS_TAB_APPEARANCE, SETTINGS_TAB_TOOLS, SETTINGS_TAB_LLM, SETTINGS_TAB_AGENT,
  SETTINGS_TAB_STORAGE, SETTINGS_TAB_WEBUSERS, SETTINGS_TAB_ABOUT, SETTINGS_TAB_ACCOUNT,
  SETTINGS_TAB_DEVELOPER, SETTINGS_TAB_PLUGINS, SETTINGS_TAB_CHANNELS, SETTINGS_TAB_NOTIFY,
];

/**
 * `settings.open?section=<x>` → 设置面分区。
 * 未知 / 缺省 ⇒ `SETTINGS_TAB_APPEARANCE`（**默认首档**；⛔ 不把未知值硬塞进面板 —— 那会打开一个空面板）。
 */
function settingsTabFrom(section: string): string {
  for (let i: number = 0; i < SETTINGS_TABS.length; i++) {
    if (SETTINGS_TABS[i] === section) {
      return section;
    }
  }
  return SETTINGS_TAB_APPEARANCE;
}

/** 等待 ms 毫秒（冷启动自动登录的重试退避用）。 */
function sleepMs(ms: number): Promise<void> {
  return new Promise<void>((resolve: (v: void) => void) => {
    delay(() => {
      resolve();
    }, ms);
  });
}

/** 冷启动自动登录的最大尝试次数（首次 + 重试）。
 *  为什么要重试而不是直接掉回登录页：见 `bootstrap()` 里的注释（真机实测的"偶发登出"）。 */
const AUTO_LOGIN_ATTEMPTS: number = 3;

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
 * todos 指纹（乐观覆盖层与同步**共用同一口径** —— 两处必须逐字一致，否则永不收敛）。
 * 模块级函数：ArkUI struct 的静态成员在真机上是 undefined。
 */
function todosFpOf(todos: TodoItem[]): string {
  const parts: string[] = [];
  for (let i = 0; i < todos.length; i++) {
    parts.push(`${todos[i].status}#${todos[i].text}`);
  }
  return `${todos.length}|${parts.join(',')}`;
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
 * 该 `ScrollSource` 是否来自**用户输入** ——「是否跟随到底部」只允许被它翻转。
 *
 * 判据本体在 `core/listfollow.nextFollowBottom`（纯函数，脱机单测：`listfollow.test.ts`）；
 * 这里是**唯一的 ArkUI 胶水**（把 `ScrollSource` 映射成"是不是用户干的"），因为 core/ 不许
 * 引用 ArkUI 全局类型（run.sh 把 core/*.ets 当纯 TS 编译）。
 *
 * 程序滚动 = `SCROLLER` / `SCROLLER_ANIMATION`（`Scroller` 成员方法：`scrollEdge`/`scrollToIndex`）
 * 以及内容增删引起的钳位/索引回调 —— **绝不**能置位，否则"用户往上看历史"的意图被一次程序动作
 * 改写（真机 P0：点工具 pill 触发 store 变更 ⇒ syncFrom 的 scrollEdge(Bottom) 把视角拽到最下方，
 * 2026-10-11）。`EDGE_EFFECT` = Spring 过卷，是手指拉出来的 ⇒ 算用户输入。
 */
// ── 用户滚动意图标志（`onWillScroll` → `onScrollIndex` 一次性消费）────────────
/**
 * 「用户滚动意图」标志的推进 —— **只置位、不清位**（`core/listfollow.markUserScrollFrame` 的包装）。
 *
 * ⛔ 为什么不能"这一帧是程序滚动就清位"（上一版写法，真机缺陷）：
 *    流式期间**每帧都有程序滚动**（`shouldAutoScroll` 命中 ⇒ `scrollEdge(Edge.Bottom)`，
 *    打字机/工具 pill 每 ~50ms 长大一次）。用户手指上滑的序列是：
 *      ① `onWillScroll(DRAG/FLING)` → 置位；
 *      ② **在 `onScrollIndex` 之前**，一次流式自动滚动到达 ⇒ `onWillScroll(SCROLLER)`
 *         → 清位（**吃掉用户意图**）；
 *      ③ `onScrollIndex` 消费 ⇒ `userDriven=false` ⇒ `followBottom` 恒为 true
 *         ⇒ 自动滚动继续把视角拽回底部 ⇒ 用户**根本滚不动**（用户 2026-10-11 亲报）。
 *    清位只发生在 `onScrollIndex` 消费时（`nextFollowBottom` 之后立即复位）。
 */
function isUserScrollSource(src: ScrollSource): boolean {
  // ⛔ `EDGE_EFFECT` **不算用户输入**：SDK `component/enums.d.ts:3928-3936` 原文
  //    "Over scroll with EdgeEffect.Spring" —— 那是**弹性回弹动画帧**，不是用户手势。
  //    此前把它计入用户 ⇒ 贴底回弹/过滚动时置 `followBottom=false` ⇒「回到最新」药丸
  //    在**回弹期间闪现**、回正后才消失（用户 2026-10-12 亲报）。⛔ 别再把它加回来。
  return src === ScrollSource.DRAG || src === ScrollSource.FLING
    || src === ScrollSource.OTHER_USER_INPUT
    || src === ScrollSource.SCROLL_BAR || src === ScrollSource.SCROLL_BAR_FLING;
}

@Entry
@Component
struct Index {
  // ── 引导 / 登录 ────────────────────────────────────────────────────────────
  // `@Watch`：`booted` 变 true = 首帧内容就绪 ⇒ 通知开屏"可以撤了"（见 onBootedChanged）。
  @State @Watch('onBootedChanged') booted: boolean = false;
  @State loggedIn: boolean = false;
  @State errMsg: string = '';
  @State serverUrl: string = '';
  @State username: string = '';
  @State password: string = '';
  @State testing: boolean = false;
  @State testMsg: string = '';
  @State recentServers: string[] = [];

  // ── 应用内开屏（冷启动）────────────────────────────────────────────────────
  /**
   * 是否显示开屏 overlay。
   *
   * **初值 `false`**（用户口径「尽可能快，加载慢才展示动画」）：只在**迟滞**（`SPLASH_HYSTERESIS_MS`）
   * 到点**仍未就绪**时才由 `startSplash()` 置 `true`（快启动 ⇒ 从 T0 系统开屏**直接过渡到主界面**，
   * 开屏压根不出现）。热启动（进程存活、ability 再拉起）**不会重建本页** ⇒ 不会重开屏；
   * 若将来引入"页面级重建的热启动"，把 `splashLaunchKind` 换成 `LAUNCH_WARM` 即自动不显示。
   */
  @State showSplash: boolean = false;
  /** 自绘 in-app toast（单槽；`msg` 非空 = 可见）。唯一判据来源 = `core/toast.ets`（⛔ 不另立）。 */
  @State toastState: ToastState = emptyToast();
  /** 开屏阶段（T1→T2→T3）；唯一消费方是 `SplashOverlay` 的 `@Watch`。 */
  @State splashPhase: string = SPLASH_T1;

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

  /**
   * 会话列表的**渠道过滤**（空串 = 全部）。
   * ⚠️ 纯客户端派生（web `useSessionStore.activeChannel`）；过滤只作用于列表视图，
   *    绝不改 `channelForChat` 的"按会话取渠道"语义（真机事故：否则点开非 web 会话报
   *    `session not found`）。web 用 localStorage 持久化（`xbot:active-channel`），
   *    原生端本波未接线持久化（`core/config.ets` 不属本波可改文件）⇒ 进程内记忆。
   */
  @State activeChannel: string = '';
  /**
   * 抽屉分类的**本地首帧镜像**（`path`/`status`/`time`；`''` = 没存过）。
   *
   * 为什么要有它（用户 2026-10-12 亲报「侧边栏要能记忆上次选择的排序」）：分类的**真值**在服务端
   * settings（`web:session:category`，与 web 共读一份，读写都已核实通过），但那份要**登录后一次
   * 网络往返**才到页面 ⇒ 冷启后立刻开抽屉会先显示默认『项目』、随后跳到上次选择（观感 = "没记住"）。
   * 本地盘上镜像（`core/config.ets` 的 `sessionCategory`）让**首帧**即上次的选择；服务端值到达后
   * **服务端胜**（`sessionCategory()` 的优先级：服务端 > 本地镜像 > 默认）⇒ 跨设备一致。
   */
  @State localSessionCategory: string = '';
  /**
   * **会话面切换**的入场位移系数（`0` = 静息；切换瞬间置 `1` 再动画归零）。
   *
   * ⛔ 只动位移、绝不动不透明度：静息态恒为 0 ⇒ 动画即使被打断，内容仍在原位、**完全可读**
   * （本仓血债「可读性不能是动画的函数」+ 门禁 ⑨）。位移值 = 底座 `MOTION_SESSION_SWITCH_SLIDE_VP`。
   */
  @State switchSlide: number = 0;

  /**
   * rewind（编辑并重发）的当前编辑目标 —— 非空即处于"编辑态"。
   * 保存 row.id / 该 user 行的 turnID / **原始**正文（用于在新鲜历史里定位 DB id，
   * 用户编辑后的新正文由 `draft` 承载）。
   */
  /**
   * rewind 编辑目标 = **只存行 id**（`core/rowquery.rowById` 用时查 `turnID`/`content`）。
   * ⛔ 曾另有 `rewindEditTurnID` + `rewindEditOriginal` —— 同一行**三个来源**、三处须同步（脆）⇒ 收敛掉。
   */
  @State rewindEditRowId: string = '';

  // ── 弹层 ──────────────────────────────────────────────────────────────────
  @State @Watch('onDrawerChanged') showDrawer: boolean = false;
  // ── 新建会话（web `NewSessionDialog` 等价弹层：工作目录 + 最近目录候选）─────────
  /** 弹层开关。 */
  @State showNewSession: boolean = false;
  /** 工作目录输入（空 = 不设 cwd，用服务端默认 —— 与原生既有行为一致）。 */
  @State newSessionPath: string = '';
  /**
   * 最近目录候选的**渲染快照**（打开时从 settings 解析一次；删除后同步更新）。
   * ⚠️ 用独立 @State 而非每次读 settings：删除要立刻反映到界面（同 web 的 `setRecentWorkDirs`）。
   */
  @State newSessionDirs: string[] = [];
  /** 会话名称输入（web `NewSessionDialog.tsx:73-79`；空 ⇒ 不发 label 字段，服务端自动生成）。 */
  @State newSessionLabel: string = '';
  /** 路径自动补全下拉：候选（`listFs` 结果经 `filterChildDirs`）/ 加载中 / 是否展开（web `PathPicker`）。 */
  @State nsPathDirs: FsEntry[] = [];
  @State nsPathLoading: boolean = false;
  @State nsPathOpen: boolean = false;
  /**
   * 抽屉里**已折叠的分组键**（`collapseKey(category, groupKey)` 形态）。
   *
   * ⚠️ 与 web 的差异（**有据**）：web 把折叠态持久化在 `localStorage`
   *   （`useSessionStore.ts` 的 `loadCollapsedGroups/persistCollapsedGroups`）。原生端没有 localStorage，
   *   而"新增一个持久化键"需要动 `core/settings.ets`（本波禁改）⇒ 只做**进程内**记忆
   *   （切会话/刷新列表不丢；杀进程后重置）。语义与 web 一致，仅持久化范围不同。
   */
  @State collapsedGroups: string[] = [];
  @State showQueue: boolean = false;
  @State showPlugins: boolean = false;
  // ── 技能管理（目标④）——页面独占所有权；组件只收 @Prop ──────────────────────
  @State showSkills: boolean = false;
  @State skills: SkillItem[] = [];
  @State skillsLoading: boolean = false;
  @State skillsError: string = '';
  /** 阅读态：技能名非空 ⇒ 面板切到 `SKILL.md` 视图。 */
  @State skillViewName: string = '';
  @State skillViewText: string = '';
  @State skillViewLoading: boolean = false;
  // ── 文件管理（目标④）——页面独占所有权；组件只收 @Prop ──────────────────────
  @State showFiles: boolean = false;
  @State fmDir: string = '/';
  @State fmEntries: FsFileEntry[] = [];
  @State fsLoading: boolean = false;
  @State fsError: string = '';
  /** 隐藏文件开关（`/api/fs/list` 的 `show_hidden`）—— 跨开关面板保留（用户偏好级）。 */
  @State fsShowHidden: boolean = false;
  @State fsPreviewPath: string = '';
  @State fsPreviewText: string = '';
  @State fsPreviewLoading: boolean = false;
  @State fsPreviewIsImage: boolean = false;
  @State fsPreviewImageUrl: string = '';
  /** 预览语言（`/api/fs/read` 的 `language`；代码预览据此选 Prism4j 语法）。 */
  @State fsPreviewLanguage: string = '';
  /**
   * 预览通知（非空 ⇒ 面板显示居中通知态，**不显示正文**）。
   * 用于「二进制文件」「未连接服务端」「读取失败」—— 这些**不是文件内容**
   * （旧实现把它们塞进正文 Text ⇒ 看着像文件真的写着那句话）。
   */
  @State fsPreviewNotice: string = '';
  /**
   * ── 递归搜索（`/api/fs/search`）───────────────────────────────────────────────
   * 触发是**手动**（过滤框回车）而不是输入防抖：性能预算里 `setTimeout` 只剩 1 处余量，
   * 且服务端是**同步递归 walk**（`searchDir` 深度优先、最多 `maxSearchLimit` 条）⇒ 每键一搜会打爆响应。
   * `fsSearchActive` = 搜索态（面板据此切列表/空态文案）；清空查询 / 切目录 / 刷新都会退出它。
   */
  @State fsSearchActive: boolean = false;
  @State fsSearchQuery: string = '';
  @State fsSearchItems: FsSearchEntry[] = [];
  @State fsSearchLoading: boolean = false;
  @State fsSearchError: string = '';
  @State showSelfCheck: boolean = false;
  /** 各页版面几何的**屏幕可见文本**（无需网络：截一张图即可把数值带给我） */
  /**
   * 「是否跟随到底部」—— 它是**用户意图标志**（= web 的 `!userScrolledUp`），**不是位置快照**。
   *
   * ⛔ 只由**用户输入**翻转（`onWillScroll` 的 `ScrollSource`，判据见 `isUserScrollSource`）：
   *   程序滚动 / 内容增删引起的**钳位与索引回调**一律不置位。上一版把它写成"最后可见项 == 末项"
   *   的**位置快照**，由 `onScrollIndex` 无条件双向赋值 ⇒ live 行在飞⇄折叠、busy 占位符进出、
   *   行窗口放开会改变项数，ArkUI 重排时的钳位/索引回调会把它**误置 true 并粘住**，之后任意
   *   一次 store 变更（流式事件、或**点工具 pill** 触发的 `fetchIterationDetail`）就
   *   `scrollEdge(Bottom)` ⇒ 真机 P0"有时候点击工具 pill 自动把视角跳到最下方"（2026-10-11）。
   *
   * 与 xbot Web 端既有铁律一致（所有 GotoBottom 调用由 !userScrolledUp 守卫）。
   */
  @State followBottom: boolean = true;

  /**
   * 上一次**滚动停止**时是否已在末尾（`Scroller.isAtEnd()` 的页面缓存）。
   * 用途 = 「回到最新」药丸的**贴底位置闸门**（压制 `EdgeEffect.Spring` 弹性过滚动期间的**闪现**）。
   * ⛔ 为什么不直接调 `isAtEnd()`：**弹性过滚动期间它判假**（2026-10-12 实测：过滚动瞬间药丸
   *   照闪、回正才消失）⇒ 只有在**滚动停止**时采样才稳定。见 `core/indicators.ets:showsJumpToLatest`。
   */
  @State atEndUi: boolean = true;

  /**
   * 「程序滚到底」的**就地操作抑制窗**结束时刻（毫秒；0 = 无抑制）。
   *
   * ⛔ 为什么还需要它（真机 P0，2026-10-11 用户报"点击最后一个迭代里的工具会自动滚到最下方"）：
   *   `followBottom` 只表达"用户**愿意**跟随新内容"，**无法区分**"尾部真的长出新内容"与
   *   "用户在原地展开了一张卡片" —— 后者同样会改行指纹（`rev` 自增）：点工具 pill ⇒
   *   `toggleTool` ⇒ 异步 `fetchIterationDetail` ⇒ store 变更 ⇒ 若无条件 `scrollEdge(Bottom)`，
   *   展开后更高的卡片会把用户刚点的那颗 pill **顶出视口**（"我点一下，视角被抢走"）。
   *   ⇒ 用户**自己发起**的就地内容变化（展开/折叠工具详情），在 `FOLLOW_SUPPRESS_MS` 窗内
   *   **不许**程序滚动（流式新增不受影响：它不经过这里）。
   *   判据本体在 `core/listfollow.shouldAutoScroll`（纯函数，脱机单测 + mutation 自证）。
   */
  private followSuppressUntilMs: number = 0;

  /**
   * 本帧的滚动是否来自**用户输入**（`onWillScroll` 置位、`onScrollIndex` **一次性消费**）。
   * 非 @State：只作判据传递，不驱动渲染。
   */
  private userScrollFrame: boolean = false;

  /**
   * **最近一帧** `onWillScroll` 的滚动是否来自用户输入（每次 `onWillScroll` 覆写）。
   *
   * 为什么单有 `userScrollFrame` 不够（用户 2026-10-12 真机亲报：「思考中数字滚动的时候，
   *   用户滚开会立马被拉回最下方」）：`userScrollFrame` 是**单布尔**，**任一**索引回调都会消费它；
   *   流式期间程序滚动（`scrollEdge(Bottom)`，打字机每帧触发）与用户拖动**交错** ⇒ 程序滚动的
   *   `onScrollIndex` 会**抢先消费**用户刚置的 flag，且此刻 `end` 恰为 `itemCount-1`
   *   ⇒ `followBottom` 被判回 `true` ⇒ 用户被拽回底部。
   *   ⇒ 本字段让 `onScrollIndex` 只在**本帧确属用户滚动**时才判定"是否恢复跟随"
   *   （web `MessageList.tsx` 的 `onWheel → pauseFollowing()` + `checkBottomAndResume()` 同构：
   *   程序滚动**绝不**改写用户意图）。
   */
  private lastScrollWasUser: boolean = false;

  /** 首屏渲染的行窗口（避免一次性构建几十行；点上方的「显示更早」按批放开） */
  @State rowLimit: number = MAX_ROWS_VISIBLE;

  /**
   * 列表第一个**可见列表项**下标（`onScrollIndex` 的 `start`）—— 供「用户消息导航」算当前锚点。
   * ⚠️ 它是**列表项**下标（含可选的「加载更早」头项 + busy/live 尾项），不是行下标；
   *    换算见 `navActiveSeq()`。
   *
   * ⛔ **刻意不是 `@State`**（2026-10-15 性能修复）：它每次滚动索引变化都被写，
   *    若是 `@State` ⇒ **每次滚动都让整页 build 重跑**（连带重算锚点/重拷正文、重跑全部
   *    `pal()` 分配）⇒ 掉帧且随历史变长而变重（用户亲报「固定历史还会掉帧」）。
   *    它只在**命令式**逻辑里被读（`insertRows` 的 prevTop / `navActiveSeq` 的换算），
   *    **不参与渲染** ⇒ 普通字段即可。渲染真正需要的只有 `navSeq`（见下）。
   */
  private listStart: number = 0;

  /**
   * 「用户消息导航」当前锚点序号（1-based；0 = 无）—— **渲染用**的唯一滚动状态。
   *
   * 与 `listStart` 的关键差别：**只在序号真的变化时**才写（`onScrollIndex` 里 `if (seq !== …)`）
   * ⇒ 绝大多数滚动帧**零页级状态写入** ⇒ 零整页 build（滚过锚点边界才更新一次）。
   */
  /**
   * 当前用户消息导航序号（1-based；0 = 无）—— **仅供页面做"值是否变化"的判定**（普通字段）。
   *
   * ⛔ 2026-10-15（用户实录「加载完毕后滚动就掉帧」「感觉是列表太长」）：**不许**把它写成
   *    页级 `@State`。写 `@State` ⇒ 每跨过一个用户消息锚点就整页 `build()` 重跑；而页面 build
   *    里的 `LazyForEach` 要按数据源行数（= 行窗口 `rowLimit`，**随"加载更早"逐次变大**）做
   *    重复 diff ⇒ **历史越长、窗口越大，滚动越掉帧**。真源改为 AppStorage（键见
   *    `MessageNav.NAV_ACTIVE_SEQ_KEY`）：`MessageNav` 用 `@StorageProp` 自己订阅 ⇒ 写入只通知它。
   */
  private navSeq: number = 0;

  /** 锚点表记忆化（按 `this.rows` **对象恒等**；见 `core/msgindex.ets:AnchorsMemo`）。 */
  private navMemo: AnchorsMemo = new AnchorsMemo();

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
  /**
   * 模型列表**三态**（加载中 / 加载失败 / 已加载但空）—— 镜像 `store.llmConfigState`/`llmConfigError`
   * 的**真结果**（由 `syncFromStore` 同步）。判据/渲染同源：`core/llmfmt.ets:modelPanelStatus`。
   * ⛔ 旧实现只判 `llmCfg === undefined` ⇒ 拉失败**永久转圈**。
   */
  @State llmCfgState: string = 'idle';
  @State llmCfgError: string = '';
  @State ctxInput: string = '';
  /** 正在切换的模型条目（显示 loading，防连点） */
  @State modelBusy: string = '';
  /** 思考模式当前档位（step 0..3；web composer `ThinkingModeControl` 同语义）。 */
  @State thinkStep: number = 1;
  /** 思考模式写入中（防连点，同 `modelBusy` 口径）。 */
  @State thinkBusy: boolean = false;

  /**
   * 发送模式：`queue`（排队）| `interrupt`（⚡ 插话）。
   * busy=false 时**必须自动复位**（Web gotcha：否则用户以为在发普通消息，实际插进了别人的回合）。
   */
  @State sendMode: string = MODE_QUEUE;

  // 输出搜索结果（MessageNav 搜索框的回填）：只在打字时写（rowSearchHits 纯函数）。
  // ⛔ 与服务端搜索（:925 searchHits/SearchHitsSheet）是**两条链**：本地即时过滤 vs 网络 API
  //    —— 独立状态（rowHits），绝不共写（共写会互相污染对方面板）。
  @State rowHits: RowHit[] = [];

  /**
   * 取消按钮的**最短转圈驻留**窗口（§21.122bs）。
   *
   * 真机量化：本地 `/api/cancel` 非阻塞派发 ⇒ 点停止后 ≤115ms 按钮已收束，而设备侧最快截图量具
   * 周期就是 115ms/帧 ⇒ 用户**看不到**那一下 spin（用户要求②「cancel 按钮 spin 一下」形同没做）。
   * ⇒ 请求返回后补足到 `CANCEL_SPIN_MIN_MS`（见 `core/composer.spinHoldRemainingMs`）。
   * ⛔ **只**延后按钮自己的视觉收束，**不**推迟会话 idle（乐观 idle 仍在请求成功那一刻发生）。
   */
  @State cancelSpinHold: boolean = false;

  // ── P11 输入体验（多行 / 补全 / 震动）──
  /** 当前正在输入的 `/` 或 `@` token（空 = 不显示补全） */
  @State cmdToken: string = '';
  /** 命令候选 */
  @State cmdItems: CommandItem[] = [];
  /** 文件候选（`@` 触发） */
  @State fsEntries: FsEntry[] = [];
  /** 当前列目录（继续下钻用） */
  @State fsDir: string = '/';
  /** 候选浮层的**选中索引**（0 基；`↓`/`↑` 环绕推进，接受键取它）。对齐 web `useCompletion.ts:157`。 */
  @State cmdSel: number = 0;

  // ── P9 设置（服务端权威：/api/settings；与 web 共用同一份偏好）──
  /**
   * 设置面（`components/SettingsPanel`，全屏）的**唯一**浮层开关。
   * ⚠️ 它**不进** `core/overlays.OverlayState`（那是给别人用的封闭枚举）—— 由 `onBackPress`
   *    在既有浮层栈之前优先关闭（见该方法），语义与"最上层浮层"一致。
   */
  @State showSettingsPanel: boolean = false;
  /** 系统通知授权状态（**只读系统真值**，不本地另记；由设置面板的开关展示）。 */
  @State notifyOn: boolean = false;
  @State settings: Record<string, string> = {};
  /** 是否已把"思考默认展开"应用过一次（避免每次同步都覆盖用户手动切换） */
  private reasoningDefaultApplied: boolean = false;

  // ── P8 面板（定时任务 / 后台任务 / 子代理 / Runner）──
  @State showPanels: boolean = false;
  /** cron | tasks | subs | runners */
  @State panelTab: string = 'cron';
  @State cronTasks: CronJob[] = [];
  @State bgTasks: BgTask[] = [];
  /**
   * 快赢 3（2026-10-17）：后台任务列表「只看运行中」过滤开关。
   * 默认 `true` = 对齐 web（`useTasks.ts:86` 只显 isRunningBgTask）；关掉 = 全量历史
   * （354 条的「事后查错」原生详情层是超集，⛔ 不砍——审计 pitfalls）。
   */
  @State panelBgOnlyRunning: boolean = true;
  /**
   * 快赢 1（2026-10-17）：终端 live 状态（tid ⇒ `status|exitCode` 复合串）——由
   * `TerminalSheet` 的 `onStatus` @Watch 上抛；列表行按此取 tone（此前恒 muted 灰点，审计病灶①）。
   */
  @State terminalLive: Map<string, string> = new Map<string, string>();
  /** #7-1：已消费的 bg_task_output 序号（store.lastBgOutputSeq 比对——增量不漏不重）。 */
  @State lastBgOutputSeen: number = 0;
  // 后台任务详情（用户点名「任务管理做的很差」：看不到输出、杀不掉 ⇒ 点列表行打开详情）
  @State showTaskDetail: boolean = false;
  @State taskDetailId: string = '';
  @State taskDetailTitle: string = '';
  @State taskDetailStatus: string = '';
  @State taskDetailMeta: string = '';
  @State taskDetailOutput: string = '';
  @State taskDetailRunning: boolean = false;

  /**
   * #7-1（2026-10-17）：bg_task_output SSE 增量 → 详情输出**尾追加**（web
   * `BackgroundPanel.tsx:159-172` 同款——此前仅 2s 轮询全量刷，长命令输出滞后一拍）。
   * 50KB 尾截断对齐 web `BackgroundPanel.tsx:97-102`；坏帧静默丢弃（SSE 主链路同口径）。
   */
  private appendBgOutput(raw: string): void {
    if (!this.showTaskDetail || this.taskDetailId.length === 0) {
      return;
    }
    try {
      const obj: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      const tid: string = typeof obj['task_id'] === 'string' ? obj['task_id'] as string : '';
      const delta: string = typeof obj['content'] === 'string' ? obj['content'] as string : '';
      if (tid !== this.taskDetailId || delta.length === 0) {
        return;
      }
      const merged: string = this.taskDetailOutput + delta;
      const MAX_OUT: number = 51200;
      this.taskDetailOutput = merged.length > MAX_OUT ? merged.substring(merged.length - MAX_OUT) : merged;
    } catch (_e) {
      // 坏帧静默丢弃
    }
  }
  // 定时任务详情（web `TasksPanel.tsx:120-172` 展开区对齐）：cron 行**点开看全文**（此前只复制一行摘要，
  // 多行提示词被主行 `maxLines(1)` 截断 ⇒ 正文永久不可见）。
  @State showCronDetail: boolean = false;
  @State cronDetailMessage: string = '';
  @State cronDetailSchedule: string = '';
  @State cronDetailNext: string = '';
  @State cronDetailTarget: string = '';
  @State cronDetailCreated: string = '';
  @State cronDetailId: string = '';
  @State runners: RunnerRow[] = [];
  @State subagents: SubAgentRow[] = [];
  @State panelBusy: boolean = false;
  /**
   * 「面板待刷新」标志（15g）：`refreshPanel()` 在**上一次拉取还在飞**时被调用 ⇒ 记下待刷新，
   * 等当前这次结束再为**当前** tab 补一次。⛔ 不许退回"直接 return 丢掉请求"的写法（真机实证见
   * `refreshPanel` 内注释：切 tab 后列表停在空态，而后端同一会话有 48 条）。
   */
  private panelRefreshQueued: boolean = false;
  // 终端（PTY）—— 用户点名「终端做的很差」：原生此前 **0 消费**（`/api/terminal` 前缀 + `/ws/terminal`）
  @State terminals: TerminalInfo[] = [];
  @State showTerminal: boolean = false;
  @State termTid: string = '';
  @State termCwd: string = '';

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
  /**
   * **工具组**菜单的项集入参（`ctxKind === 'tools'`）—— 在**开菜单那一刻**由 `ctxIteration()`
   * 派生（判据 = `core/ctxmenu.toolsMenuItems`）；与 `MenuSheets` 的 3 个 `@Prop` 对齐。
   */
  @State ctxToolNames: string[] = [];
  @State ctxToolHasText: boolean[] = [];
  @State ctxToolsAllHasText: boolean = false;
  @State usage: TokenUsage | undefined = undefined;
  @State cwd: string = '';
  @State todos: TodoItem[] = [];
  /**
   * Goal 横幅的**字符串数据源**（web `MessageInput.tsx:694` 的 `goal.objective`/`goal.status`）。
   *
   * ⛔ **单一口径**（`docs/WEB-ALIGNMENT.md §13.3`：同一状态只能有一处判据）：状态栏
   *   `goalLine()` 与「详情」gating 都读这里 —— 曾经它们读 `store.goal`
   *   （`core/types.ets` 的 `GoalInfo{text,status}`，字段名不符协议 `{objective,status}`，
   *   且 `store.ets` 无赋值点）⇒ `goalLine()` **恒空** ⇒ 只有 goal、没有 todo 的会话
   *   「详情」入口消失。现从**权威的归一化进度快照** `store.liveProgress().goal`（字段名正确）
   *   取串，绕开两个同名 `GoalInfo` 的命名碰撞。
   */
  @State goalObjective: string = '';
  @State goalStatus: string = '';
  /**
   * 顶栏**原生**「迭代指标」徽章文案（插件 `xbot.iteration-stats` 的 `status_bar_right` 视图）。
   *
   * ⛔ **必须经 `@State` 投影**（2026-10-12 真机实锤缺陷）：此前头部 builder **直读**
   *    `store.liveProgress().streamStats`（非响应式）⇒ 头部只在 `busy`/`currentChat`/
   *    `nativeCatalog` 变化时重渲，而 `busy` 在回合**开始**那一刻就置 true（此时
   *    `stream_stats` 尚为 0）⇒ 之后指标有了**却没有重渲触发** ⇒ 徽章**恒为空**
   *    （真机实测：流式中全页 0 处 `t/s`，而 web 同期显示 `190t/s · 930ms`）。
   *    ⇒ 唯一正解 = 在更新通路 `sync()` 里投影（同 `goalObjective`/`todos`/`widgetContent`），
   *    头部只读本 `@State`；取值判据仍在 `core/pluginviews.ets:iterStatsText`。
   */
  @State iterStatsBadge: string = '';
  /**
   * 忙碌占位行的**阶段**（`ProgressSnapshot.phase`）—— `core/indicators.ets:busyLabel` 的输入。
   *
   * ⛔ **必须经 `@State` 投影**（与 `iterStatsBadge` 同因，2026-10-12）：占位行曾在 builder 内
   *    直读 `store.liveProgress().phase`（非响应式）⇒ 只在建行那一刻采样；压缩开始时页面级
   *    `@State` 不一定变化 ⇒ **行不重渲** ⇒ 压缩期仍显示「思考中…」，与 web
   *    （`MessageList.tsx:1679-1686` 按 phase 二选一）分叉。
   */
  @State busyPhase: string = '';
  /**
   * 「正在添加目标」内联输入（web `MessageInput.tsx:695-726` 的 `addingGoal`）——
   * 由 `TodoPanel` 的 🎯 按钮打开；输入非空并回车/失焦 ⇒ `set_goal`。
   */
  @State addingGoal: boolean = false;
  /** 添加目标的草稿（web `MessageInput` 的 `goalDraft`）。 */
  @State goalDraft: string = '';
  /**
   * live 行 SubAgent 树的**页面 @State 镜像** —— 与 `liveText`/`liveBlocks` 同款值投递
   * （行对象就地更新 ⇒ 引用恒定 ⇒ 组件读它不产生值变化 ⇒ 树不刷新）。
   */
  @State liveSubAgents: WebSubAgentProgress[] = [];

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
  /** 能力面板的插件行（`PluginCatalogItem` ⇒ 行才画得出 description/version/state 层次）。 */
  @State plugins: PluginCatalogItem[] = [];
  /** 能力面板三态（判据在 `core/pluginview.ets:pluginPanelStatus`）：加载中 / 已可读化的失败原因。 */
  @State pluginPanelLoading: boolean = false;
  @State pluginPanelError: string = '';
  @State panelUrl: string = '';
  /**
   * 承载页顶栏的**人类标题**（`WebSurface.chromeLabel`）—— 顶栏**绝不**显示原始 URL。
   * 与 `panelUrl` **同生共死**：每次赋值 URL 时一并给出（插件名 / 「完整 Web UI」…）。
   */
  @State panelTitle: string = '';
  /** 原生「插件目录 + 宿主页」（components/PluginHost）的全屏浮层与数据。 */
  @State showPluginHost: boolean = false;
  @State pluginItems: PluginCatalogItem[] = [];
  @State pluginGroups: PluginCatalogGroup[] = [];
  /**
   * 插件目录（**常驻**一份，非"打开面板才拉"）—— 供**原生渲染插件视图**判据用
   * （`core/pluginviews.ets`：装了且声明了某视图才渲染原生徽章）。
   * 非关键路径：失败留 null ⇒ 原生徽章不显示（不是错误）。
   */
  @State nativeCatalog: PluginCatalog | null = null;
  /** 插件宿主页 URL（**与页面级 `panelUrl` 分离** ⇒ 不会同时挂载两个 WebSurface）。 */
  @State pluginPageUrl: string = '';
  /**
   * 插件宿主页顶栏的**人类标题**（透传 `PluginHost.panelTitle` → `WebSurface.chromeLabel`）。
   *
   * 来源：插件**自己声明**的视图标题（`PluginViewItem.title`，清单里是 i18n key、已在
   * `buildPluginCatalog` 解析好）——宿主零猜测。⛔ 顶栏**绝不**显示原始 URL
   * （用户 2026-10-13 亲报「你开插件，上面有个地址是不是太丑了」）。
   */
  @State pluginPageTitle: string = '';
  // ── 原生 Git 面板（web 内置插件 `xbot.git-fancy` 的原生落地）───────────────────
  // 数据全来自宿主 RPC（`web_plugin_rpc` → `xbot.git-fancy.*`），判据/解析在 `core/gitpanel.ets`。
  // ⛔ 形态机（`list`/`diff`/`commit`）与开关由**页面**持有（组件不发 RPC、不自持开关）。
  @State showGit: boolean = false;
  /** 远程机器面板（web 内置插件 `xbot.ssh-runner`，§21.117）—— 组件自持状态，此处只持 flag。 */
  @State showSsh: boolean = false;
  /** `list` | `diff` | `commit`（详情形态由它决定，⛔ 不靠"猜有没有 diff 文本"）。 */
  @State gitMode: string = 'list';
  @State gitStatus: GitStatus = new GitStatus();
  @State gitLog: GitLog = new GitLog();
  @State gitLoading: boolean = false;
  @State gitLogLoading: boolean = false;
  @State gitError: string = '';
  /** diff 详情（已归一化：`diffText` 可直接喂 `parseUnifiedDiff`）。 */
  @State gitDiffPath: string = '';
  @State gitDiffText: string = '';
  @State gitDiffAdds: number = 0;
  @State gitDiffDels: number = 0;
  @State gitDiffFromCommit: string = '';
  @State gitDiffLoading: boolean = false;
  /** commit 详情。 */
  @State gitCommitHash: string = '';
  @State gitCommitMeta: string = '';
  @State gitCommitMessage: string = '';
  @State gitCommitFiles: GitChange[] = [];
  // ── 会话统计面板（内置插件 `xbot.session-stats` 的原生落地）─────────────────────
  // 它不在服务端 `web_plugin_list`（随 web 主包打包）⇒ 只能作为**内置入口**暴露；
  // 数据全来自宿主 RPC（`get_session_usage_stats`）⇒ 原生渲染，不塞 WebView。
  @State showSessionStats: boolean = false;
  @State sessUsage: SessionUsage = new SessionUsage();
  @State sessionStatsLoading: boolean = false;
  @State sessionStatsError: string = '';
  // 15i：统计面板另三块（web 有而原生缺）—— 用户累计 / 按日 / 趋势桶。
  @State statsUser: UserUsage = new UserUsage();
  @State statsDaily: DailyUsage[] = [];
  @State statsBuckets: UsageBucket[] = [];
  /** 趋势粒度（分段控件；切换只重拉桶，不重拉其余三路）。 */
  @State statsGranularity: string = 'hour';
  /**
   * 取数在飞（⛔ 同一时刻只允许一次）。
   * §21.49 的教训（面板切 tab 请求被**静默吞掉**）在这里同样成立 ⇒ 重入**排队**而不是丢弃。
   */
  private statsBusy: boolean = false;
  private statsRefreshQueued: boolean = false;
  // ── 插件 widget 数据面（页面半边；`store` 半边在 `core/store.ets` 的 lastWidgetEvent/Content）──
  /** 当前 widget 事件名（SSE 载荷产出；空 ⇒ 回落 `WIDGET_EVENT_WEB`）。 */
  @State widgetEvent: string = WIDGET_EVENT_WEB;
  /** 当前 widget 载荷（空 ⇒ `PluginHost` 内零节点，目录视觉不变）。 */
  @State widgetContent: string = '';

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

  /**
   * 应用主题（深/浅；与 Web 共用服务端偏好键 **`xbot-md-theme`** ⇒ `web:ui:md-theme`）—— **唯一真源**。
   *
   * ⛔ 订正（2026-10-13 取证）：本行原文写的是「与 Web 共用 … `xbot-app-theme`」，**事实错误** ——
   *   主题真走 `KEY_MD_THEME`（`core/settings.ets:78-80`），取值点见本文件 `applySettingsCached`
   *   的 `settingOf(store.settings, KEY_MD_THEME)`；web 权威 `src/providers/theme.tsx:110-111`
   *   亦然（`MARKDOWN_THEME_STORAGE_KEY = 'xbot-md-theme'` + `syncSettingToServer`）。
   *   实测 `grep -rn "app-theme" web/src/` ⇒ **零命中**（web 根本没有这个键）。
   * ⛔ 别去"接线" `KEY_APP_THEME`（`xbot-app-theme`）：它**不是**主题源 —— 它是已被删除的
   *   「原生第二套主题」遗留键，`tools/tests/settings_keys_consumed.test.ts:145-152` 把它与
   *   `KEY_UI_MODE` 一并钉为 `DELIBERATE_DEAD`（理由：保留常量只为不删服务端遗留值）。
   *   谁把它接成第二个主题源，就是 `AGENTS.md` 警告的"死消费复活"缺陷。
   *
   * ⛔ 用 `@StorageLink('appTheme')`（不是 `@State`）：把主题**同步进 AppStorage**，让每个
   *   历史行组件用 `@StorageProp('appTheme')` **各自订阅**（见 `components/MessageRow.ets`
   *   的根因说明）。为什么必须订阅：历史行由 `LazyForEach` 承载，其 item builder **只在行键
   *   （`id#rev`）变化时**执行；主题变更不改变任何行键 ⇒ `applyRows` 零通知 ⇒ 只靠页面把
   *   `themeName` 当 `@Prop` 投递，已存在行会**冻结在创建那刻**（浅色主题下取深色板 = 白底白字）。
   *   `@StorageLink` 保持本变量为唯一真源，所有既有写入点（首帧缓存 / 设置变更 / 设置面板）
   *   自动同步到 AppStorage，无需另加 @Watch。
   * ⚠️ 装饰器参数是**字面量** `'appTheme'`，与各组件的 `@StorageProp('appTheme')` 逐字一致。
   */
  @StorageLink('appTheme') themeName: string = 'dark';
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
  /**
   * 软键盘高度（**px**，由 `EntryAbility` 的 `keyboardHeightChange` 广播；键盘收起时为 0）。
   * 为什么需要它：`KeyboardAvoidMode.RESIZE` **只对"焦点在文档流输入框"生效** —— 焦点落在**浮层内**
   * 输入框（抽屉搜索框、运行面板里的输入行）时真机实测**视口一点不缩**（页面内容根恒 y2754）
   * ⇒ 浮层底栏/输入行留在窗口底、被软键盘**完全盖死**（用户点名「终端和任务管理做的很差」的硬点）。
   * 消费方式：**底部锚定的浮层**给其容器加 `.padding({ bottom: px2vp(this.kbHeightPx) })`。
   */
  @StorageProp('kbHeightPx') kbHeightPx: number = 0;

  // ── 点通知要打开的会话（通道 = AppStorage，键由 EntryAbility.captureOpenChat 写入）──
  // ⚠️ 装饰器参数必须是**字面量**（不能用导入的常量），这里的字符串与 core/notify.ets 的
  //    `PENDING_CHAT_KEY`/`PENDING_CHAT_SEQ_KEY` 逐字一致；下面的 AppStorage.get 则用导入常量
  //    （单一真值点），二者不得分叉。
  /** 目标会话 id。 */
  @StorageProp('pendingOpenChatId') @Watch('onPendingChatChanged') pendingChatId: string = '';
  /** 序号（number）：同一会话被点第二次时 id 不变，靠它察觉变化（@StorageProp 只在值变了才通知）。 */
  @StorageProp('pendingOpenChatSeq') @Watch('onPendingChatChanged') pendingChatSeq: number = 0;
  /** 通知**动作按钮**带来的动作 id（EntryAbility 从 `want.parameters.notify_action` 白名单解析后写入）。 */
  @StorageProp('pendingNotifyAction') @Watch('onPendingActionChanged') pendingAction: string = '';
  /**
   * 深链命令（S1）。键**逐字**与 `core/command.ets` 的 `PENDING_COMMAND_KEY`/`PENDING_COMMAND_SEQ_KEY` 一致
   * （与上面两个通知键同款：`@StorageProp` 只吃字面量 ⇒ 靠注释锁同源 + 单测钉常量值）。
   */
  @StorageProp('pendingCommandUri') @Watch('onPendingCommandChanged') pendingCommandUri: string = '';
  /** 序号（同一条命令被再发一次时值不变，靠它察觉变化）。 */
  @StorageProp('pendingCommandSeq') @Watch('onPendingCommandChanged') pendingCommandSeq: number = 0;

  /**
   * 设置面**初始分区**（深链 `settings.open?section=<x>` 指定；面板用 `initialTab` 消费）。
   * ⚠️ 2026-10-16（目标③「所有面板对标 Apple」）：缺省由 `SETTINGS_TAB_APPEARANCE` 改为**空串**
   *    —— 空串 = 面板停在**根列表**（分组列表 + 钻取），这才是 Apple 设置面的打开语义；
   *    深链仍可直达某个分区（`settingsTabFrom(...)`）。
   */
  @State settingsInitialTab: string = '';

  // ── live turn 的整条 assistant 消息（同气泡：已完成迭代 + 在飞块）──
  // ⚠️ 为什么**非懒**渲染（LazyForEach 之外、@State 直驱）：虚拟列表条目在真机上
  //    不可靠地重建是"流式期间什么都看不到"（无打字机、无工具、结束时内容一次性冒出）
  //    的根因。live 行整条（含其已完成迭代与末尾在飞块）由一个 ListItem 承担。
  // ⚠️ 不变量（真机 bug ①/② 根治）：**在飞迭代是这条消息气泡内的最后一块**，
  //    与已完成迭代同一气泡、同一套块渲染 —— 绝不再是独立的气泡/独立的 ListItem。
  @State hasLiveRow: boolean = false;
  @State liveRowRef: ChatRow = new ChatRow();
  /**
   * live 行「在飞内容」的**页面 @State 镜像** —— 由 `syncLiveTail()` 在每次 store 更新时
   * 从**同一个** live 行（其末尾在飞块，与 `rowIsEmpty` 判据同源）派生并赋值。
   *
   * ⛔ 为什么必须要有（P55→P58 回归根因）：ArkUI V1 组件只在**收到的状态值发生变化**时
   *   重建。`ChatRow` 是**就地更新**的（保 @ObjectLink 恒等）⇒ 引用恒定 ⇒ **不构成值变化**；
   *   P55 把 live 行改成「非懒尾项 + 只从行对象读在飞内容」后，整个流式期间 live 组件
   *   **一次都不重建**（渲染输入冻结在创建那一瞬 = 空）⇒ 占位让位却画不出任何东西
   *   （真机「第一条 SSE 到达就消失、中间全空、commit 才一次性出现」）。
   *   这三项提供了「值变化」这个唯一可靠的重建驱动（= 回归前 P54 的机制，web 亦是把
   *   live 快照当 prop 往下传）。
   */
  @State liveText: string = '';
  @State liveReasoning: string = '';
  @State liveTools: ToolProgress[] = [];
  /**
   * live 行**已完成迭代块列表**的页面 `@State` 镜像 —— 由 `syncLiveTail()` 从
   * **同一个** live 行（`completedBlocks(liveRowRef)`，渲染层读同一函数）派生并赋值。
   *
   * ⛔ 为什么必须要有（真机 2026-10-10「iter1 的 tool call 完成后 iter1 消失、iter2
   *   前面看不到 iter1」根因）：P58 修好「在飞块」的投递后，**已完成块**仍走带参 @Builder
   *   `AssistantBlock(this.row)` 里的 `ForEach`（参数是同一 `ChatRow` 引用，`applyRow`
   *   就地改它）⇒ 参数不变 ⇒ 其内 UI 不重建（docs/ARKTS-GOTCHAS §4）⇒ 已完成块区
   *   **冻结在创建那一瞬（空）**。tool call 完成 → iter1 进 iteration_history（模型正确）、
   *   在飞块随 @Prop 清空 ⇒ 两个区都空 ⇒ iter1 消失。此项提供「值变化」这条唯一可靠的
   *   重建驱动（对齐 web：`MessageList` 把整份 `liveProgress` 快照当 prop 传 `TurnBody`）。
   */
  @State liveBlocks: HistoryIteration[] = [];
  /** 历史加载中（骨架屏判据：只有"还没内容且正在拉"才展示） */
  @State historyLoading: boolean = false;
  /**
   * **切会话的专属加载遮罩**（用户 2026-10-14 要求：「切换会话的时候，请求历史 api 的时候要有一个
   * 会话加载中的 splash screen」）。
   *
   * 与 `historyLoading` 的分工：后者只在"**还没有任何行**"时走骨架（`showsHistorySkeleton`）；
   * 而切到**池里已有**会话时列表会立刻复用旧 store 的行、`beginSwitch` 之后行才清空 ——
   * 这段时间用户看到的可能是**上一个会话的残影**或骨架，缺乏一个明确的"正在加载这个会话"信号。
   * ⇒ 由 `switchSession()` 在**真正发生网络等待的那条路径**上置位（`!alreadyOpen`），
   *   `await openSession` 收尾（含失败）必复位 ⇒ 失败方向安全（绝不永久遮挡）。
   */
  @State switchSplash: boolean = false;

  /** 运行中工具的流光位置（纯 transform，不触发布局） */
  @State sweepX: number = -80;
  /** 上次发送失败的正文（提供一键重试） */
  @State failedSend: string = '';
  private draftTimer: number = -1;
  /**
   * 运行脉冲（P13）：只在有回合在跑时用 600ms 定时器翻转一次 opacity。
   * 为什么用 opacity 而不是 layout 属性：触屏设备上 layout 动画（height/width）会掉帧，
   * 这是项目里已定稿的规矩（Web 端同款）。
   */
  private pulseTimer: number = -1;
  /**
   * 运行面板的**自适应轮询**定时器（自续期 `setTimeout`，模式同 `core/sse.ets` 看门狗）。
   * 周期判据 = `core/panels.panelPollMs`（有在跑的东西 ⇒ 2s，否则 30s；web `useTasks.ts:117-122` 同源）。
   */
  private panelPollTimer: number = -1;
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

  // ── 显示设置 ──────────────────────────────────────────────────────────────
  @State showReasoning: boolean = true;

  /** todos 的乐观覆盖层（web `usePendingEdit.ts:57-95`）：本地勾选/改名不被更旧的快照盖掉。 */
  private pendingTodos: PendingEdit = new PendingEdit();
  /**
   * todos 乐观覆盖的**提交闸门**（web `usePendingEdit.ts` 的单调序号语义；判据/实现见
   * `core/pendingedit.ets` —— 本字段即该移植件的**真实消费点**）。
   * `begin()` 发号 → RPC 成功 `acceptSeq(seq)` 记账 → 失败 `discard()` 作废更旧提交。
   */
  private pendingSeq: PendingSeq = new PendingSeq();

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
    // 应用内开屏的 T1 底色 + 页面首帧底色都取自 `themeName`；而系统开屏（`startWindow`）/
    // 应用级 colorMode 已由 `EntryAbility.onCreate` 按**缓存主题**在首帧前定下（见其 onCreate）。
    // ⇒ 这里**同步**读回同一份缓存，让 `themeName` 在首帧前就与那两者**同源**：开屏 T1 与
    //   页面首帧 + 系统开屏**同色**（`docs/BRAND.md §12.1` FOLLOW_APPLICATION 的零跳色）。
    //   之后 settings（主题真值）到达会照旧覆盖（`syncFrom` 的 `normalizeTheme`）。旁路：读失败只回落默认。
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const cachedTheme: string = readCachedTheme(ctx);
      if (cachedTheme.length > 0) {
        this.themeName = normalizeTheme(cachedTheme);
      }
    } catch (e) {
      // 读缓存失败不影响启动（保留默认主题）
    }
    this.bootstrap();
    this.startSplash();
  }

  aboutToDisappear(): void {
    this.clearAllSplashTimers();
    const s: ChatStore | null = this.store;
    if (s !== null) {
      s.sse.close();
    }
  }

  // ── 应用内开屏（冷启动）—— 编排；判据全在 core/splash（纯逻辑、已单测）────────────
  //
  // 口径（用户拍板「尽可能快；加载慢就展示一下动画」）：
  //   · **快启动不出现**：内容在**迟滞** `SPLASH_HYSTERESIS_MS` 内就绪 ⇒ 开屏**压根不展示**，
  //     从 T0 系统开屏**直接过渡到主界面**（判据 = `core/splash.shouldStartSplash`）；
  //   · **慢加载才播**：迟滞已过仍未就绪 ⇒ 展示，并**完整播完**（T1 入场 → T2 让位，无超调）；
  //   · `minDwell` = **展示后**"动效不半截被切"的**下限**（⛔ 不是"固定等待"，更不拖慢快启动）；
  //   · **交互打断** ⇒ `skipSplash()` **立即**进主界面（直接 T3，跳过让位动画）；
  //   · `SPLASH_TIMEOUT_MS` = 慢到离谱时**收尾**（非正常路径）；
  //   · 热启动不重建本页 ⇒ 开屏不会再次显示（见 `showSplash` 字段说明）。

  /** 启动类别（页面首次挂载 ≈ 冷启动；热启动不重建本页 ⇒ 不会走到这里）。 */
  private splashLaunchKind: string = LAUNCH_COLD;
  /** 开屏**展示**起始时刻（`Date.now()`；`0` = 尚未展示）。 */
  private splashT0: number = 0;
  /** 是否已进入出场（T2/T3）；幂等，防重复 arm。 */
  private splashExiting: boolean = false;
  private splashStartTimer: number = -1;
  private splashDwellTimer: number = -1;
  private splashCapTimer: number = -1;
  private splashExitTimer: number = -1;

  /** 冷启动开屏装表：先等**迟滞**，到点仍**未就绪**才展示（快启动直接过、开屏不出现）。 */
  private startSplash(): void {
    this.splashStartTimer = delay(() => {
      this.splashStartTimer = -1;
      // 迟滞闸门（纯函数）：就绪时间在迟滞**内** ⇒ 不展示；否则展示并**完整播完**。
      if (!shouldStartSplash(this.splashLaunchKind, SPLASH_HYSTERESIS_MS, this.booted)) {
        return;
      }
      this.showSplash = true;
      this.splashT0 = Date.now();
      // ① minDwell 下限：到点再评估"够不够撤"（保证入场动效**不半截被切**）。
      this.splashDwellTimer = delay(() => {
        this.maybeExitSplash();
      }, SPLASH_MIN_DWELL_MS);
      // ② 慢到离谱兜底：宁可显示首帧，也不无限停在开屏。
      this.splashCapTimer = delay(() => {
        this.beginExitSplash();
      }, SPLASH_TIMEOUT_MS);
    }, SPLASH_HYSTERESIS_MS);
  }

  /**
   * 首帧内容就绪（`booted` 变 true）⇒ 重新评估。
   * 尚未展示时本调用是 no-op（迟滞到点由 `startSplash` 的定时器按 `shouldStartSplash` 判定）；
   * 已展示时评估是否可撤（仍需过 minDwell，由 `shouldShowSplash` 兜住）。
   */
  private onBootedChanged(): void {
    this.maybeExitSplash();
  }

  /**
   * 是否该撤下（**仅在已展示后**）—— 判据**唯一来源** = `core/splash.shouldShowSplash`
   * （纯函数、已单测）：`elapsedMs` 自**展示**起算，`cold` 且（`elapsed < minDwell` 或 内容未就绪）
   * 且 `elapsed < timeout` ⇒ 继续显示。
   */
  private maybeExitSplash(): void {
    if (!this.showSplash || this.splashExiting || this.splashT0 === 0) {
      return;
    }
    const elapsed: number = Date.now() - this.splashT0;
    if (shouldShowSplash(this.splashLaunchKind, elapsed, this.booted)) {
      return;
    }
    this.beginExitSplash();
  }

  /** 出场：T2 让位（`animEaseOut`，`SPLASH_EXIT_MS`）→ T3 交棒（overlay `onDone` 卸载）。 */
  private beginExitSplash(): void {
    if (this.splashExiting || !this.showSplash) {
      return;
    }
    this.splashExiting = true;
    this.clearSplashTimer(this.splashDwellTimer);
    this.splashDwellTimer = -1;
    this.clearSplashTimer(this.splashCapTimer);
    this.splashCapTimer = -1;
    this.splashPhase = SPLASH_T2;
    this.splashExitTimer = delay(() => {
      this.splashPhase = SPLASH_T3;
    }, SPLASH_EXIT_MS);
  }

  /** 用户轻点 ⇒ **立即**进主界面（跳过让位动画，直接 T3 → overlay `onDone`）。 */
  private skipSplash(): void {
    if (!this.showSplash) {
      return;
    }
    this.splashExiting = true;
    this.clearAllSplashTimers();
    this.splashPhase = SPLASH_T3;
  }

  /** overlay `onDone`：撤下开屏并清表。 */
  private onSplashDone(): void {
    this.clearAllSplashTimers();
    // ⛔ **必须延到下一帧**：本回调由子组件（`SplashOverlay`）在**它的 build 期**触发 ⇒
    //    直接写 `showSplash` 就是「build 期改 @Component 状态」，ArkUI 抛**应用级错误**
    //    （真机实证 2026-10-12：`AceStateMgmt: State variable 'showSplash' has changed during
    //    render! ... New UINode objects added to update queue while re-render!`）——
    //    它会连带破坏本次渲染（列表空白的同类病灶）。`delay(…, 0)` 把写入排到当前帧之后。
    delay(() => {
      this.showSplash = false;
    }, 0);
  }

  private clearSplashTimer(id: number): void {
    if (id >= 0) {
      clearTimeout(id);
    }
  }

  private clearAllSplashTimers(): void {
    this.clearSplashTimer(this.splashStartTimer);
    this.splashStartTimer = -1;
    this.clearSplashTimer(this.splashDwellTimer);
    this.splashDwellTimer = -1;
    this.clearSplashTimer(this.splashCapTimer);
    this.splashCapTimer = -1;
    this.clearSplashTimer(this.splashExitTimer);
    this.splashExitTimer = -1;
  }

  // ── 点通知要打开的会话（主 UX：点通知回到应用 ⇒ 切到对应会话）────────────────────

  /** 已消费过的「id#seq」——防同一条待打开请求被重复消费（@Watch 可能重复触发 / 冷启动再读一次）。 */
  private pendingChatConsumed: string = '';

  /**
   * 备1 短时任务是否由本页申请在手（旁路；只为"同一次回合只 end 一次"，
   * 避免 syncFrom 每帧都调 endTurnKeepAlive）。真正的幂等在 core/notify.ets 里。
   */
  private keepAliveTurn: boolean = false;

  /**
   * `@StorageProp` 变更回调（**热启动路**）。
   *
   * 热启动：应用在后台，EntryAbility.onNewWant 写 AppStorage ⇒ 本回调触发。
   * 冷启动不会走这里（见 `openPendingChat` 的说明）—— 故它与 bootstrap 末尾各调一次同一函数。
   */
  private onPendingChatChanged(): void {
    this.openPendingChat();
  }

  /** `@StorageProp` 变更回调（**热启动路**）：通知动作按钮 → 页面动作。 */
  private onPendingActionChanged(): void {
    this.consumePendingAction();
  }

  /** `@StorageProp` 变更回调（**热启动路**）：深链命令 → 页面动作。 */
  private onPendingCommandChanged(): void {
    this.consumePendingCommand();
  }

  /**
   * 消费「深链命令」—— `core/command.ets` 的**唯一页面落点**（S1）。
   *
   * 分层：`EntryAbility.captureCommandUri` **只投递**（并负责"形状非法/未注册 ⇒ hilog 报错"），
   * 页面**只消费**。这里再走一次 `commandDispatchable` 闸门（= `null` 守卫 ∧ 形状 ∧ **已注册**）——
   * 防"AppStorage 被别的路径塞进非白名单值"（与 `consumePendingAction` 再判 `isKnownNotifyAction` 同款）。
   *
   * 冷/热两条路都要覆盖（与 `openPendingChat` 同款）：热启动靠 `@Watch`；**冷启动**时
   * `EntryAbility.onCreate` 写值可能早于本页挂载 ⇒ `@Watch` 不触发 ⇒ `bootstrap()` 完成后主动读一次。
   * 消费后 `AppStorage.delete(PENDING_COMMAND_KEY)`，防"返回页面"重复触发。
   *
   * 命令集合（真源 = `core/command.ets: registeredCommands()`，逐条对应 web `AppShell.tsx:118-152`）：
   *   `settings.open`（可带 `?section=`）· `session.new` · `sidebar.toggle` · `input.focus`。
   */
  private consumePendingCommand(): void {
    const uriV: string | undefined = AppStorage.get<string>(PENDING_COMMAND_KEY);
    const uri: string = uriV !== undefined ? uriV : '';
    if (uri.length === 0) {
      return;
    }
    try {
      AppStorage.delete(PENDING_COMMAND_KEY);
    } catch (e) {
      // 有意吞：键不存在时 `delete` 会抛；此处只想确保"消费掉"待处理命令，无键即无事可做。
    }
    const action: CommandAction | null = parseCommandUri(uri);
    if (action === null || !commandDispatchable(action)) {
      return;   // 闸门不过 ⇒ 页面不执行任何动作（EntryAbility 已就"未注册/形状非法"报过错）
    }
    if (action.id === COMMAND_SETTINGS_OPEN) {
      // ⚠️ 面板的 `initialTab` 是 `@Prop`（`@State active` 只在构造时取初值）⇒ 面板**已打开时**
      //    再发同一条命令不会切档（可接受：先关再开即可；⛔ 不为此改 SettingsPanel —— 那是 tokens-ux 域）。
      this.settingsInitialTab = settingsTabFrom(commandArg(action, 'section'));
      this.showSettingsPanel = true;
      return;
    }
    if (action.id === COMMAND_SESSION_NEW) {
      void this.newSession();
      return;
    }
    if (action.id === COMMAND_SIDEBAR_TOGGLE) {
      // ⛔ 唯一开抽屉入口 = `openDrawer()`（它做浮层互斥）；关才直接置 false。
      if (this.showDrawer) {
        this.showDrawer = false;
      } else {
        this.openDrawer();
      }
      return;
    }
    if (action.id === COMMAND_INPUT_FOCUS) {
      // 聚焦 composer（`focusControl` 从 `@kit.ArkUI` 取；id 挂在下面的 TextArea 上）
      // ⛔ **必须延后一拍**：本分支会被冷启动的 `consumePendingCommand()` 在 `bootstrap()`
      //    （= `aboutToAppear`，早于 `build()`）里调到 —— 那时 `COMPOSER_INPUT_ID` 的 TextArea
      //    **尚未挂载** ⇒ 同步 `requestFocus` **静默失败**（冷启动深链 `input.focus` 聚焦不了）。
      //    复用页面**唯一**定时器出口 `delay()`（性能预算 7/7 已满 ⇒ ⛔ 不新增 `setTimeout` 调用点）。
      delay((): void => {
        focusControl.requestFocus(COMPOSER_INPUT_ID);
      }, FOCUS_AFTER_MOUNT_MS);
      return;
    }
  }

  /**
   * 消费「通知动作按钮」——把动作 id 派发到**既有**状态机入口（⛔ 不在页面就地判）。
   *
   * 判据与 `core/notify.ets` **同源**：白名单 `isKnownNotifyAction`（EntryAbility 已过滤一次，
   * 这里再判一次防注入）；未就绪（未登录 / store 未建）**不消费**（保留值，待 bootstrap 后再调）；
   * 消费后清空 `PENDING_ACTION_KEY`（与 `openPendingChat` 删 `PENDING_CHAT_KEY` 同款）。
   */
  private consumePendingAction(): void {
    if (!this.loggedIn || this.store === null) {
      return;
    }
    const v: string | undefined = AppStorage.get<string>(PENDING_ACTION_KEY);
    const action: string = v !== undefined ? v : '';
    if (action.length === 0) {
      return;
    }
    try {
      AppStorage.delete(PENDING_ACTION_KEY);
    } catch (e) {
      // 有意吞：同 PENDING_COMMAND_KEY —— 键不存在即无需清理（防注入的白名单校验在下方）。
    }
    if (!isKnownNotifyAction(action)) {
      return;   // 白名单外：不执行任何能力（防注入）
    }
    if (action === NOTIFY_ACTION_STOP) {
      this.store.cancel();
      return;
    }
    if (action === NOTIFY_ACTION_CONTINUE) {
      this.store.send('/continue').then(() => {
        this.keepAliveTurn = true;
        beginTurnKeepAlive();
      }).catch(() => {
        // 有意吞：通知栏"继续"的 keepAlive 是**旁路**（失败只记日志）；发送结果由 store 状态/列表体现 ⇒ 不重复提示。
      });
      return;
    }
    // NOTIFY_ACTION_OPEN：已由 pendingOpenChatId 覆盖 ⇒ no-op
  }

  /**
   * 消费「点通知要打开的会话」——**只切会话，绝不改会话/消息状态语义**（状态以后端为准）。
   *
   * 两条路都要覆盖（缺一不可）：
   *  · **热启动**：应用已在后台，`onNewWant` 写 AppStorage ⇒ `@Watch('onPendingChatChanged')` 触发。
   *  · **冷启动**：`EntryAbility.onCreate` 写值**可能早于 `Index` 挂载** ⇒ 挂载时值已存在，
   *    `@Watch` 不产生「变更」⇒ 永远不触发。故必须由 `bootstrap()` 完成后**主动读一次初值**。
   *
   * 就绪判定：未登录 / store 未建时**不消费**（把值留在 AppStorage 里），待 bootstrap 完成后再调一次
   * 即可打开 —— 这样冷启动那条路也不会因为"值来得太早、应用还没登录"而丢事件。
   *
   * 幂等：用 `id#seq` 去重（同一会话二次点击 seq 变、token 也变，故能再次消费）。
   * 消费后 `AppStorage.delete(PENDING_CHAT_KEY)`（EntryAbility 注释明确要求），防"返回页面"重复触发。
   */
  private openPendingChat(): void {
    if (!this.loggedIn || this.store === null) {
      // 未就绪：不消费（保留 AppStorage 值），bootstrap 完成后会再调一次
      return;
    }
    const idV: string | undefined = AppStorage.get<string>(PENDING_CHAT_KEY);
    const id: string = idV !== undefined ? idV : '';
    if (id.length === 0) {
      return;   // 无待打开会话（含"已被消费后 @Watch 再次触发"）
    }
    const seqV: number | undefined = AppStorage.get<number>(PENDING_CHAT_SEQ_KEY);
    const seq: number = seqV !== undefined ? seqV : 0;
    const token: string = `${id}#${seq}`;
    if (token === this.pendingChatConsumed) {
      return;   // 同一条请求已处理过
    }
    this.pendingChatConsumed = token;
    // 消费掉：防重复消费（"从后台返回"会再次进入，不清空就会反复切会话）
    try {
      AppStorage.delete(PENDING_CHAT_KEY);
    } catch (e) {
      // 脱机/异常：删不掉也不致命（token 去重已兜住重复消费）
    }
    if (id !== this.currentChat) {
      // 走 store 既有的选会话入口（池化 / 切草稿 / 状态机复位 / 清会话作用域前端状态）
      this.switchSession(id);
    }
  }

  private async bootstrap(): Promise<void> {
    // 兜底：即使本地存储不可用，也必须能进登录页（否则永远停在 Loading，无从排查）
    let saved: AppConfig = new AppConfig();
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
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
    // 渠道过滤：读回持久化值（`config.init` 已用 `normalizeActiveChannel` 归一化，回落单点）
    // ⇒ 用户上次选的渠道**重启后还在**（对齐 web `useSessionStore` 的 `xbot:active-channel`）。
    this.activeChannel = saved.activeChannel;
    // 分类本地镜像：**首帧就用上次的选择**（服务端值到达后由 `sessionCategory()` 接管 —— 服务端胜）
    this.localSessionCategory = saved.sessionCategory;
    this.recentServers = this.config.recentServers();
    if (saved.serverUrl.length > 0 && saved.sessionCookie.length > 0) {
      this.cookie = saved.sessionCookie;
      const store: ChatStore = this.makeStore(saved.serverUrl, saved.sessionCookie);
      // 冷启动自动登录：**必须区分「凭据失效(401)」与「瞬态连不上」**。
      //   · 401 ⇒ http/SSE 的 onUnauthorized 已经走了 handleAuthExpired（清凭证 + 回登录页 + 写明原因），正确。
      //   · 其它失败（连接被拒 / 超时 / 服务端抖动 / 装包重启窗口内端口转发未就绪）⇒ 只是"连不上"。
      //     旧实现在 catch 里直接 `loggedIn = false` ⇒ **静默掉回登录页**，用户以为"又被登出了"，
      //     而 cookie 其实完全有效（真机实测：这是最容易误判成"登出"的现象）。
      //   ⇒ 退避重试；凭证原样保留；最终失败也给可读原因，而不是一张毫无信息量的登录页。
      let ok: boolean = false;
      let lastErr: string = '';
      for (let attempt = 0; attempt < AUTO_LOGIN_ATTEMPTS && !ok; attempt++) {
        try {
          await store.loadSessions();
          ok = true;
        } catch (e) {
          lastErr = errText(e as Object);
          if (isUnauthorized(lastErr)) {
            // 401：handleAuthExpired 已处理（清凭证 + 回登录页 + "登录已过期"），不重试
            break;
          }
          if (attempt + 1 < AUTO_LOGIN_ATTEMPTS) {
            this.errMsg = `${loadErrTitle(lastErr)}：正在重试（${attempt + 2}/${AUTO_LOGIN_ATTEMPTS}）…`;
            await sleepMs(400 * (attempt + 1));
          }
        }
      }
      if (ok) {
        this.attach(store);
        this.cookie = store.http.exportSessionCookie();
        this.prepareWebUI(store);
        store.loadSettings().catch(() => {
          // 设置非关键路径
        });
        // 插件目录（**常驻一份**）：原生渲染插件视图（如迭代指标徽章）的启用判据。
        // 非关键路径——失败置 null ⇒ 原生徽章不显示（不阻塞启动，也不吞成"成功"）。
        store.loadPluginCatalog(this.localeId()).then((c: PluginCatalog) => {
          this.nativeCatalog = c;
        }).catch(() => {
          this.nativeCatalog = null;
        });
        this.authExpiredHandled = false;
        this.loggedIn = true;
        this.errMsg = '';
        // 环境（插件）值：**在首帧之前**落到 `core/theme`（主界面由 `booted` 闸门放行 ⇒ 首次 build 必吃新值；
        //   ⛔ 若像 `loadSettings()` 那样 fire-and-forget，首帧玻璃会是旧值 ⇒ 观感闪一下）。
        // 背景：`xbot.ambience` 的 `glassOpacity`/`glassBlur` **此前从没人应用**（值早就在 `plugin_config`
        //   返回里 —— 原注释误以为"到不了客户端"，见 `core/theme.ets` 的 2026-10-13 订正）。
        // ⛔ 解析器**逐键比对 schema 默认值**：用户没动过 ⇒ `null` ⇒ 观感**逐字节不变**（⛔ 绝不把 web 的
        //   0.82/0/1 当缺省 —— 那会让深色玻璃 0.62→0.82、柔焦 18→0）。
        // 非关键路径：插件系统不可用 / 无该插件 ⇒ 保持现状，**绝不因它拖死启动**（同 `loadPluginCatalog`）。
        try {
          const ambRaw: Object = await rpc<Object>(store.http, RPC_PLUGIN_CONFIG, new PluginConfigParams(AMBIENCE_PLUGIN_ID));
          setAmbience(ambienceFromPluginConfig(ambRaw));
        } catch (e) {
          setAmbience(null);
        }
        // ⚠️ 打开首个会话**必须**单独兜住：它有网络等待（history/queue/status/subscribe）。
        //    若让它抛出到 bootstrap 外层，`booted` 永远不置位 ⇒ **无限启动页**（真机实测过）。
        //    失败只是"这个会话没打开"，用户可在界面上另选，不该拖死整个启动。
        try {
          const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
          if (first !== undefined && first.chat_id !== undefined) {
            await store.openSession(first.chat_id);
            // 启动 store 也入池并按它真正打开的会话建索引（否则切回该会话会再建一个 ⇒ 双订阅）
            this.rekeyPool(store, first.chat_id);
          }
        } catch (e) {
          this.loadErr = errText(e as Object);
        }
        // 冷启动路（点通知把**未运行**的进程拉起）：EntryAbility.onCreate 早于本页挂载，
        // `@Watch` 不会触发 ⇒ 必须在这里（已登录 + store 就绪）主动消费一次。
        // 它若命中会把界面从"默认首个会话"切到通知指向的会话（幂等，见 openPendingChat）。
        this.openPendingChat();
        // 通知**动作按钮**同款冷启动路：onCreate 写值可能早于挂载 ⇒ @Watch 不触发 ⇒ 这里补读一次
        this.consumePendingAction();
        // 深链命令同款冷启动路（`EntryAbility.onCreate` 写值早于挂载 ⇒ @Watch 不触发）
        this.consumePendingCommand();
      } else if (!this.authExpiredHandled) {
        // 网络/服务端问题：**保留凭证**（下次冷启动仍会自动登录），并给出可读原因
        this.loggedIn = false;
        this.errMsg = `${loadErrTitle(lastErr)}：${lastErr}（登录凭证已保留，可直接重试）`;
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
    this.draftTimer = delay(() => {
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
  @State appPaused: boolean = false;

  onPageHide(): void {
    // 进后台：停掉脉冲与打字机的所有定时器（降功耗；回前台自动恢复）
    this.appPaused = true;
    this.syncPulse(false);
    this.syncPanelPoll();
  }

  onPageShow(): void {
    this.appPaused = false;
    this.syncPulse(this.busy);
    this.syncPanelPoll();
    // 回前台强制探活（旁路，仅此处一处调用）：`readTimeout:0` ⇒ 连接被中间设备静默掐死时
    // **收不到 `dataEnd`**，`dataEnd→scheduleReconnect` 那条路根本不走 ⇒ 界面看着在连、其实早死
    // （表现：消息不再更新）。`SseClient.forceReconnect()` 自判（久无帧 + 非 idle + 2s 节流，
    // 见 core/sse.ets:164-203），复用 `scheduleReconnect()` ⇒ 带 `last_event_id` 续传、不清会话状态；
    // 不需要页面传上下文，任何异常它内部已吞掉（返回 false）。**只在 onPageShow 调一次**，
    // 绝不放进 build()/高频回调（避免重连风暴）。
    const store: ChatStore | null = this.store;
    if (store !== null) {
      store.sse.forceReconnect();
    }
  }

  /** 当前所有浮层的状态投影（给 core/overlays 的纯函数用）。 */
  private overlayState(): OverlayState {
    return {
      drawer: this.showDrawer,
      // ⚠️ `settings` / `prefs` 是 `core/overlays.OverlayState` 的**既有字段**（该类型是给别人用的
      //    封闭契约）⇒ 两个旧设置浮层已删，这里恒 `false`（返回键链路上对应分支不再可达）。
      settings: false,
      prefs: false,
      queue: this.showQueue,
      plugins: this.showPlugins,
      selfCheck: this.showSelfCheck,
      status: this.showStatus,
      model: this.showModel,
      panels: this.showPanels,
      sessMenu: this.sessMenuId.length > 0,
      searchHits: this.showSearchHits,
      ctxMenu: this.ctxOpen,
      image: this.imagePixel !== null || this.imageBusy,
      webPanel: this.panelUrl.length > 0,
    };
  }

  /**
   * **是否有任何模态浮层打开** —— 仅用于那层统一遮罩（见 `build()` 顶部）。
   *
   * ⛔ 为什么**不能**直接用 `core/overlays.hasOverlay(this.overlayState())`（我第一版就是这么写的，
   *    装机量测当场否掉）：`overlayState()` 是**返回键链路**的契约子集，字段表由 `core/overlays`
   *    `OverlayState` 定死（drawer/settings/prefs/queue/plugins/selfCheck/status/model/panels/
   *    sessMenu/searchHits/ctxMenu/image/webPanel）⇒ **不含** `showTerminal` / `showTaskDetail` /
   *    `showCronDetail` / `showGit` / `showFiles` / `showSkills` / `showSessionStats` /
   *    `showNewSession` ⇒ 用它对终端 sheet 恒假、遮罩不出现（实测：终端打开时页面状态行仍是
   *    `#9e9fa9` 原亮度，与修复前逐像素相同）。
   *
   * ⛔ 判据同源：`tools/tests/sheet_scrim_wiring.test.ts` 静态扫描 `build()` 里**每一个**
   *    `if (this.showX)` 浮层块，断言其旗标都在本方法里被消费 ⇒ 新增浮层忘了加进来会**红**
   *    （否则就是本仓 `AGENTS.md` 反复警告的"死消费/假绿"）。
   *
   * 不含 `showSplash`：开屏是**不透明**品牌画布（`core/splash.ets`）⇒ 背后没有可见内容，
   * 加遮罩无意义（也避免与 T2 渐隐过渡抢帧）。
   */
  private anyModalOpen(): boolean {
    return this.showDrawer || this.showNewSession || this.showQueue || this.showPlugins
      || this.showFiles || this.showSkills || this.showSessionStats || this.showSelfCheck
      || this.showStatus || this.showModel || this.showPanels || this.showTaskDetail
      || this.showCronDetail || this.showGit || this.showSsh || this.showTerminal || this.showSettingsPanel
      || this.showPluginHost || this.sessMenuId.length > 0 || this.showSearchHits
      || this.ctxOpen || this.imagePixel !== null || this.imageBusy
      || this.panelUrl.length > 0 || this.askUser !== null;
  }

  /**
   * 返回键 = web 的 `Esc`：先关**最上层**浮层；没有浮层才交还系统（退出/回桌面）。
   *
   * ⛔ 此前原生端**没有**任何返回键处理 ⇒ 浮层打开时按返回直接退出应用
   * （与 web 用户按 Esc"关弹窗"的语义不一致，且会误退）。AskUser 是服务端权威
   * 的必答项，故意不在此关闭（见 core/overlays.topOverlay 的说明）。
   */
  onBackPress(): boolean {
    // 全屏插件宿主浮层：优先关"承载的宿主页"，其次关整个浮层（与 WebSurface 的 ‹ 返回同序）
    if (this.showPluginHost) {
      if (this.pluginPageUrl.length > 0) {
        this.pluginPageUrl = '';
        this.pluginPageTitle = '';
      } else {
        this.showPluginHost = false;
      }
      return true;
    }
    // 全屏设置分区面板（工具/模型/智能体）优先于既有浮层栈关闭（它是渲染在最上层的全屏层）
    if (this.showSettingsPanel) {
      this.showSettingsPanel = false;
      return true;
    }
    // 新建会话弹层（与设置面同款：不进 `OverlayState` 封闭枚举，先于既有浮层栈关闭）
    if (this.showNewSession) {
      this.showNewSession = false;
      return true;
    }
    // 任务/定时/终端详情（都从运行面板内开出 ⇒ 必须先于 `panels` 关，否则返回键会连面板一起收）
    if (this.showCronDetail) {
      this.showCronDetail = false;
      return true;
    }
    // 原生 Git 面板（顶层浮层）：**详情形态先回列表**，列表形态才关面板（与组件内返回键同序）
    if (this.showGit) {
      if (this.gitMode !== 'list') {
        this.gitMode = 'list';
      } else {
        this.showGit = false;
      }
      return true;
    }
    // 远程机器面板（顶层浮层，web 内置插件 `xbot.ssh-runner`）
    if (this.showSsh) {
      this.showSsh = false;
      return true;
    }
    const code: OverlayCode = topOverlay(this.overlayState());
    if (code === '') {
      return false;
    }
    this.closeOverlay(code);
    return true;
  }

  private closeOverlay(code: OverlayCode): void {
    switch (code) {
      case 'webPanel': this.panelUrl = ''; break;
      case 'image': this.closeViewer(); break;
      case 'ctxMenu': this.ctxOpen = false; break;
      case 'searchHits': this.showSearchHits = false; break;
      case 'sessMenu': this.sessMenuId = ''; this.sessConfirmDelete = ''; break;
      case 'panels': this.showPanels = false; break;
      case 'model': this.showModel = false; break;
      case 'status': this.showStatus = false; break;
      case 'selfCheck': this.showSelfCheck = false; break;
      case 'plugins': this.showPlugins = false; break;
      case 'queue': this.showQueue = false; break;
      case 'drawer': this.closeDrawer(); break;
      default: break;
    }
  }

  /** 收起会话抽屉（web backdrop 点击 / 返回键同款语义：一并复位改名态）。 */
  private closeDrawer(): void {
    this.showDrawer = false;
    this.renamingId = '';
  }

  private syncPulse(busy: boolean): void {
    // §21.122bx：浮层覆盖聊天区时**停掉装饰动效**（流光扫过 live pill；被浮层盖住 ⇒ 无人看见）
    // —— 这条 600ms 的页级 `@State` 写入会把**整页标脏**，与浮层入场动画抢帧预算。
    // 浮层关闭后随下一帧 `sync` 自动复起（`sync` 每次都会调本方法）。
    if (busy && !this.appPaused && !this.anyModalOpen() && this.pulseTimer < 0) {
      this.pulseTimer = setInterval(() => {
        // 同一拍顺手推进流光位置（避免为装饰再开一个定时器）
        this.sweepX = this.sweepX >= 300 ? -80 : this.sweepX + 110;
      }, 600);
      return;
    }
    if (!busy && this.pulseTimer >= 0) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = -1;
    }
  }

  /**
   * 运行面板**轮询**：补一拍 + 按**最新**数据重排下一拍（自续期 `setTimeout`，同 `core/sse.ets` 看门狗）。
   *
   * ⛔ 为什么必须有：此前面板**只在**「打开 / 切 tab / 手点刷新」取数 ⇒ 面板开着时数据是**死的**
   *    （后台任务跑完、子代理状态翻转都不会更新）—— 用户口径「任务管理做的很差」的可修点。
   * ⚠️ 周期判据走 `core/panels.panelPollMs`（与「哪条在跑」的渲染判据同一份纯函数 ⇒ 不可能不一致）。
   * ⚠️ 只补**当前 tab** 那一拍（`refreshPanel()` 自带 `panelBusy` 排队守卫、失败 toast，⛔ 不重复实现）。
   */
  private async panelPollStep(): Promise<void> {
    if (!this.showPanels || this.appPaused) {
      return;
    }
    await this.refreshPanel();
    this.syncPanelPoll();
  }

  /**
   * 布防/撤防运行面板轮询（**唯一布防点**）。
   *
   * 触发点：开面板 / 切 tab / 关面板（含 `closeOverlaysAboveDrawer`）/ 前台↔后台；另外每拍结束后
   * 由 `panelPollStep()` 重排（数据变了 ⇒ 周期从 30s 切到 2s，反之亦然 —— 与 web `useTasks.ts:117`
   * 的 `useEffect([bgTasks])` 同效果）。
   * ⛔ 幂等：先无条件清掉旧定时器再按需重排（⛔ 绝不叠加两个定时器）。
   */
  private syncPanelPoll(): void {
    if (this.panelPollTimer >= 0) {
      clearTimeout(this.panelPollTimer);
      this.panelPollTimer = -1;
    }
    if (!this.showPanels || this.appPaused) {
      return;
    }
    this.panelPollTimer = setTimeout(() => {
      this.panelPollTimer = -1;
      void this.panelPollStep();
    }, panelPollMs(this.bgTasks, this.subagents));
  }

  private scheduleSync(store: ChatStore): void {
    // ⚠️ 只有**当前会话**的 store 能驱动界面：池里后台会话的更新照常积累在它自己的
    // 状态里，但绝不能覆盖正在显示的会话（否则两个会话的事件互相打架）。
    if (store !== this.store) {
      return;
    }
    // #7-1（2026-10-17）：bg_task_output 增量旁路——详情面板实时化（帧内直追，不等去抖节拍）。
    if (store.lastBgOutputSeq !== this.lastBgOutputSeen) {
      this.lastBgOutputSeen = store.lastBgOutputSeq;
      this.appendBgOutput(store.lastBgOutput);
    }
    this.pendingSync = store;
    // ── 抽屉冻结（2026-10-17 用户亲报「busy 时侧边栏滚动掉帧」）────────────────────
    //    流式期每帧 syncFrom ⇒ 整棵树重渲与抽屉滚动抢帧 ⇒ 掉帧。抽屉开着：**不进 16ms
    //    派发**（连 delay 都不排——最省），数据停留在 pendingSync 积累；关闭瞬间由
    //    onDrawerChanged 一次性刷回（「关闭一瞬间刷回来」= 用户给的方案）。
    if (this.showDrawer) {
      return;
    }
    if (this.syncScheduled) {
      return;
    }
    this.syncScheduled = true;
    delay(() => {
      this.syncScheduled = false;
      const s: ChatStore | null = this.pendingSync;
      this.pendingSync = null;
      if (s !== null) {
        this.syncFrom(s);
      }
    }, 16);
  }

  /**
   * 抽屉关闭瞬间：把冻结期间积累的 pendingSync **一次性刷回**（见 scheduleSync 的冻结注释）。
   * ⚠️ 只在关（false 转变）时刷——打开时不动（打开那一刻本来就没有冻结数据）。
   */
  onDrawerChanged(): void {
    if (!this.showDrawer && this.pendingSync !== null) {
      const s: ChatStore | null = this.pendingSync;
      this.pendingSync = null;
      if (s !== null) {
        this.syncFrom(s);
      }
    }
  }

  private attach(store: ChatStore): void {
    this.store = store;
    this.syncFrom(store);
  }

  private syncFrom(store: ChatStore): void {
    // 自愈：not busy 却残留空 live 行（迟到事件造的）⇒ 先删掉再投影，避免 busy 被钉死
    store.pruneEmptyLiveRowIfIdle();
    // ── ⛔ 真机严重事故（"所有会话都渲染了第一个打开的会话的迭代"）的顺序契约 ──
    // ① **会话身份必须最先落定**：下面行指纹 / 行键 / live 尾 全部以 `this.currentChat` 为准，
    //    它排在后面会让行键仍用**旧会话 id**（跨会话键仍碰撞 = 复用旧条目）。
    // ② **指纹缓存必须随身份作废**：行 id 是**每 store 独立计数**（`live-1`/`a-1`…），
    //    两个会话的行指纹可能**逐字相同** ⇒ 不重置就永远不刷新 `this.rows`
    //    （表现为"切到哪个会话都显示上一个会话的内容"，且 busy 与内容来自不同会话 = 状态混乱）。
    if (identityChanged(this.currentChat, store.currentChatId)) {
      // ⛔ 切会话诊断（用户点名要的）：页面侧看见的"身份切换"（含渲染入口的关键量）。
      console.debug(`[SWITCH] page identity ${this.currentChat} -> ${store.currentChatId} sid=${store.sid} storeRows=${store.rows.length} dsBefore=${this.rowDs.count()} limit=${this.rowLimit}`);
      this.currentChat = store.currentChatId;   // ← 身份先定
      this.followBottom = true;   // 切会话：用户预期"看到最新" ⇒ 意图重置为跟随
      this.rowLimit = MAX_ROWS_VISIBLE;   // 切会话重置行窗口（否则行数会无限累积增长）
      this.rowsFp = '';
      this.sessionsFp = '';
      this.queueFp = '';
      this.todosFp = '';   // 逐一会话作废（见下）
      this.pendingTodos.discard();   // 乐观覆盖层随会话作废（否则会挡住新会话的快照）
    }
    const sessFp: string = this.fingerprintSessions(store.sessions, store.currentChatId);
    if (sessFp !== this.sessionsFp) {
      this.sessionsFp = sessFp;
      this.sessions = store.sessions.slice();
    }
    const rowsFp: string = this.fingerprintRows(store.rows, store.currentChatId);
    const contentGrew: boolean = rowsFp !== this.rowsFp;
    // ⛔ 每帧 hilog 是真开销（流式期 ~33 帧/秒 × 字符串拼接 + 设备侧日志写入）⇒ 原先逐帧的
    //    `[SYNC]` / `[DUPCHK]` 诊断（2026-10-12 P0 临时件）已移除；需要诊断时用按需汇总探针。
    const structFp: string = structRowsFpOf(store.rows, store.currentChatId);
    this.structFp = structFp;   // 供 `navAnchors()` 结构记忆化（见字段注释）
    if (contentGrew) {
      this.rowsFp = rowsFp;
      this.rows = store.rows.slice();
      // 用户在阅读历史时保持视口不变——内容增长不应把用户拽回底部。
      // syncRowDs → applyRows → LazyForEach onDataReloaded 可能导致 List 自动跟随，
      // 需要主动 scrollTo 保持用户视口（web DOM scroll 不会因底部增长而自动滚动）。
      const savedOffset: number = !this.followBottom ? this.listScroller.currentOffset().yOffset : 0;
      // live 行整条（已完成迭代 + 末尾在飞块）在 syncRowDs 里抽出为非懒尾项
      this.syncRowDs();
      if (!this.followBottom) {
        delay(() => {
          try { this.listScroller.scrollTo({ xOffset: 0, yOffset: savedOffset }); } catch (e) { }
        }, 0);
      }
    } else {
      // 非 contentGrew 路径也需要 syncRowDs（主题切换等）
      // （原逻辑：contentGrew=false 时不调 syncRowDs——保持不变）
    }
    // ⛔ 底部跟随（真机："看不到任何进度/思考打字机看不到"，2026-10-10）：
    //   live 尾块在**生长**（思考/正文打字机、工具 pill 增加）⇒ 若用户仍在底部，
    //   必须跟着滚到底，否则流式内容掉到视口下方 —— 看上去就是"没有进度、只有收尾才出现"。
    //   ⛔ 但**只有"尾部内容真的变了"且"不是用户就地操作的后果"**才滚（真机 P0，2026-10-11：
    //      用户"点击最后一个迭代里的工具就自动滚到最下方" —— 点 pill ⇒ toggleTool ⇒
    //      fetchIterationDetail ⇒ store 变更 ⇒ 旧代码无条件 scrollEdge 把刚点的 pill 顶出视口）。
    //      判据本体是纯函数 `core/listfollow.shouldAutoScroll`（脱机单测 + mutation 自证）。
    if (shouldAutoScroll(this.followBottom, contentGrew, Date.now(), this.followSuppressUntilMs)) {
      this.listScroller.scrollEdge(Edge.Bottom);
    }
    this.busy = store.busy;
    // 插件 `xbot.iteration-stats` 的原生徽章文案 —— ⛔ **必须在这里投影成 `@State`**：
    // 头部若直读 `store.liveProgress()`（非响应式），徽章会在回合开始那一刻（stat 尚为 0）
    // 渲染成空，之后**永不重渲** ⇒ 徽章恒空（真机实锤，见 `computeIterStatsBadge` 注释）。
    const iterBadge: string = this.computeIterStatsBadge(store);
    if (this.iterStatsBadge !== iterBadge) {
      this.iterStatsBadge = iterBadge;
    }
    this.connState = store.connState;
    // 插件 widget 数据面：把 store 收到的最新 SSE widget 载荷投影到页面（载荷未变则不触发重渲染）。
    // 判据（事件名/载荷）全在 `core/`（`store` 的 onSse 早退 + `core/widgetsview` 解析）。
    if (store.lastWidgetContent !== this.widgetContent) {
      this.widgetEvent = store.lastWidgetEvent.length > 0 ? store.lastWidgetEvent : WIDGET_EVENT_WEB;
      this.widgetContent = store.lastWidgetContent;
    }
    this.syncPulse(store.busy);
    // 备1 短时任务（旁路，幂等）：回合结束（busy 落）⇒ 结束短时任务。
    // 只在本回合确实申请过时调一次（避免每帧 syncFrom 都触发无谓的 end 调用）。
    if (!store.busy && this.keepAliveTurn) {
      this.keepAliveTurn = false;
      endTurnKeepAlive();
    }
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
    const todosFp: string = todosFpOf(store.todos);
    if (this.pendingTodos.accepts(todosFp)) {
      // 本地乐观编辑尚未收敛：忽略（可能更旧的）服务端快照，保持本地覆盖（web usePendingEdit）。
    } else if (todosFp !== this.todosFp) {
      this.todosFp = todosFp;
      this.todos = store.todos.slice();
    }
    // ── Goal 横幅数据源（web `MessageInput.tsx:694` 的 `goal.objective`/`goal.status`）──
    // ⛔ 必须读**归一化进度快照**的 goal（`core/chattypes.GoalInfo{objective,status}`），
    //    而不是 `store.goal`（`core/types.GoalInfo{text,status}`，字段名不符协议 ⇒ 永远空）。
    const g = store.liveProgress().goal;
    const gObj: string = g !== null && g !== undefined ? g.objective : '';
    const gSt: string = g !== null && g !== undefined ? g.status : '';
    if (this.goalObjective !== gObj) {
      this.goalObjective = gObj;
    }
    if (this.goalStatus !== gSt) {
      this.goalStatus = gSt;
    }
    // 忙碌占位行的**阶段投影**（`core/indicators.ets:busyLabel` 的唯一判据输入）。
    // ⛔ 同 `iterStatsBadge`（2026-10-12 真机实锤）：占位行曾在 builder 内**直读**
    //    `store.liveProgress().phase`（非响应式）⇒ 只在建行那一刻采样 phase；压缩开始时
    //    页面级 `@State` 不一定变化 ⇒ **行不重渲** ⇒ 压缩期仍显示「思考中…」（与 web 分叉）。
    const ph: string = store.liveProgress().phase;
    if (this.busyPhase !== ph) {
      this.busyPhase = ph;
    }
    this.llmCfg = store.llmConfig;
    // 模型列表三态：镜像既有取数路径（`store.loadLlmConfig`）的**真结果**（`llmConfigState`/`llmConfigError`）。
    this.llmCfgState = store.llmConfigState;
    this.llmCfgError = store.llmConfigError;
    if (this.cronTasks !== store.cronTasks) {
      this.cronTasks = store.cronTasks;
    }
    if (this.bgTasks !== store.bgTasks) {
      this.bgTasks = store.bgTasks;
      // P0「开盖冻结」修复（2026-10-14 前后任务详情是打开那一刻的静态快照）：
      // 列表镜像更新 ⇒ 跟随重投开着的详情页（输出持续增长、状态自然翻转、
      // 终止钮自动消失——不再「任务跑完仍显示运行中，kill 已死进程才被动刷新」）。
      // 轮询（`panelPollMs` 2s/30s）/ kill / promote 后的就地重拉全部经过这里。
      this.refreshTaskDetailFrom(this.bgTasks);
    }
    if (this.runners !== store.runners) {
      this.runners = store.runners;
    }
    if (this.subagents !== store.subagents) {
      this.subagents = store.subagents;
    }
    if (this.terminals !== store.terminals) {
      this.terminals = store.terminals;
    }
    // ⚡ A 线审计静默面 #6（2026-10-14）：同族对象写入（sessions :2035 / widgetContent :2072 /
    //   queue :2087 / todos :2096）全有守卫，唯 settings 裸写 ⇒ 流式期每帧对**同引用**反复赋值。
    //   若 ArkUI 对同引用赋值也标脏，settings 读取面（抽屉分组键/星标/主题等）会被每帧重评——
    //   给 A 线「页级 build 发动机」再加一码。加 !== 守卫=纯收益（引用变照写，语义不变）。
    // ⛔ 2026-10-17 P0（用户模拟器复现白底白字，截图实证）：切会话后 `this.settings`
    //    被目标 store 的**旧缓存**覆盖（深色时代的 settings，settingsFresh 曾为 true 的
    //    陈旧态）⇒ `mdThemeId()` 读到深 md 主题 ⇒ MarkdownView 用深 md 配色（浅色文字）
    //    渲染在浅底上 = **白底白字**；「重载会话正常/打开设置又变浅」皆因 loadSettings
    //    到达后 settings 才刷新 —— 与主题守卫同一纪律：**设置没到达（settingsFresh=false）
    //    就不动页面镜像**，沿用上一会话已确认的浅色值。
    if (store.settingsFresh && store.settings !== this.settings) {
      this.settings = store.settings;
    }
    // ⛔ 主题**单一真源** = markdown 主题（服务端 `web:ui:md-theme`，与 web 同一项）。
    // web 权威 `providers/theme.tsx:101-113`：应用明暗 = `modeForTheme(mdTheme)` **派生**，
    // 没有第二套「应用主题」设置（用户 2026-10-13 拍板：「只有一种主题设置，就是你从后端接口拉的那种」）。
    // 判据与取色同源：色板只由 `core/mdtheme.appPaletteForMdTheme` 给出（纯函数、已单测）。
    // 主题标识 = **色板名 + 强调色**（`renderThemeKey`）：强调色是模块级覆盖、**不是** ArkUI 可
    // 观察的状态 ⇒ 若标识只含色板名，改强调色时全站**零重渲染** ⇒ 80 处 `paletteOf` 仍是旧色板
    //（用户 2026-10-13 亲报「配色根本没起作用 / theme 里各种配色必须真实起作用」的真根因）。
    // ⛔ **2026-10-13 用户报障真根因**：「重启=浅色 → 切会话=变深色 → 开设置=又变浅色」。
    //    机制：`switchSession()` 把 `this.store` 换成**池里另一个 ChatStore**，而它的 `settings`
    //    **还没拉回来**（空 `{}`）⇒ `appPaletteForMdTheme('')` 回落**深色** ⇒ 主题被错误翻成深色；
    //    等设置到达（开设置页 / 该 store 的 `loadSettings()` 返回）再翻回浅色 ⇒ 用户看到"抽奖"。
    //    ⇒ 与下方 `reasoningDefaultApplied` / `surfaceApplied` **同一纪律**：设置**没到达就不动它**
    //    （首帧已有缓存主题，见 `aboutToAppear` 的 `normalizeTheme(cachedTheme)`）。
    // ⛔ 主题**只在拿到权威键值时**重算（用户 2026-10-14 亲报「theme 会突变一下又变回来」）：
    //    旧写法判据是 `Object.keys(store.settings).length > 0` —— 太弱：切到**池里另一个 store**
    //    时它的 `settings` 可能**只到达了一部分**（或该后端没下发 `md-theme` 这一格），
    //    此时 `appPaletteForMdTheme(settingOf(..., KEY_MD_THEME))` 收到**空串** ⇒ 回落**默认色板
    //    （深色）** ⇒ 浅色用户看到"翻深一下"，等完整设置到达再翻回浅色 = 用户说的"突变一下又变回来"。
    //    ⇒ 判据收紧为**该键真的在**；缺键 ⇒ **继承当前全局值**（`themeName` 本身就是
    //    `@StorageLink('appTheme')` 的全局真源，⛔ 绝不"用默认值覆盖"）。
    //    ⛔ 全站主题只有**一个**真源（`appTheme`），⛔ 不新增第二套"应用主题"状态。
    const mdRaw: string = settingOf(store.settings, KEY_MD_THEME);
    // 单会话主题回退 p0（2026-10-17）：mdRaw 来自**会话 store 的 settings 副本**——池里
    // store 的旧缓存（深色时代的旧值）非空但过期 ⇒ 曾把 themeName 写成深色。只信
    // loadSettings 确认过的 fresh 副本（store.settingsFresh）。
    if (mdRaw.length > 0 && store.settingsFresh) {
      const nextTheme: string = renderThemeKey(appPaletteForMdTheme(mdRaw), this.accentHex());
      // ⛔ 同值不写：写 = 触发全站重渲（`@StorageLink` 订阅者），无变化时不产生噪声。
      if (nextTheme !== this.themeName) {
        this.themeName = nextTheme;
        // ⛔ 主题切换**当场**强制全表重建（用户 2026-10-17 怒报「修三四次修不好」的最终根治）：
        //    行键已含主题（themableRowKey），但 LazyForEach **只在数据源通知时重读键**——
        //    切主题不产生 SSE 事件 ⇒ sync/applyRows 不跑 ⇒ reload 通知永不到达 ⇒ 历史行
        //    冻结在旧色板（「iter1000 前白字、新 iter 正确」的分裂症状；重载会话 = chatId
        //    变化走 needsFullReload ⇒ 正常——同机制的反证）。此处带新主题当场投一次 ⇒
        //    键变 + reload 通知齐发 ⇒ 框架重读全部行键 ⇒ 全表重建（与重载会话等效，保滚动位）。
        this.rowDs.applyRows(tailRows(this.rows, this.rowLimit), this.currentChat, nextTheme);
      }
      // md 主题**同时推给全局订阅**（`@StorageProp('appMdTheme')`，消费点 `components/MarkdownView`）：
      // md 主题只影响代码块/行内码配色，而历史行由 `LazyForEach` 承载 ⇒ 只靠 `@Prop mdTheme` 投递
      // 会**冻结在创建那刻** ⇒ 换 md 主题后已存在行仍是旧配色（用户 2026-10-13 亲报
      // 「浅色模式字色有时对有时不对像抽奖」/「所有浅色 theme 看起来完全一样」的同一根因）。
      // 与 `appTheme` 走**同一纪律**：会变的值必须让行自己订阅，不靠列表重投递。
      // ⚠️ 直接由**权威原值**归一化（`normalizeMdTheme`），不绕 `this.settings` 的页面镜像
      //    （镜像可能属于**别的** store，同一条"多处缓存"病根）。
      const mdId: string = normalizeMdTheme(mdRaw);
      if (mdId !== AppStorage.get<string>('appMdTheme')) {
        AppStorage.setOrCreate<string>('appMdTheme', mdId);
      }
    }
    // 系统表面跟随主题（幂等：仅主题变化时打系统 API + 写本地缓存）。
    // 冷启动 settings 到达这条路由它覆盖 EntryAbility 的缓存判定（热启动亦生效）。
    this.syncSystemTheme();
    if (!this.reasoningDefaultApplied && Object.keys(store.settings).length > 0) {
      // 只在设置首次到达时套用默认展开状态（之后尊重用户的手动切换）
      this.showReasoning = parseBool(settingOf(store.settings, KEY_REASONING_DEFAULT), this.showReasoning);
      this.reasoningDefaultApplied = true;
    }
    // 承载方式（web / native）：只在设置**首次到达**时套用一次，之后尊重用户本次切换。
    // ⚠️ store/http 此处必然就绪：syncFrom 由 store 变更回调驱动，store 已在 attach() 时持有，
    //    且 settings 非空意味着 loadSettings()（登录成功后）已返回。
    if (!this.surfaceApplied && Object.keys(store.settings).length > 0) {
      if (settingOf(store.settings, KEY_SURFACE) === 'web' && !this.useWebUI) {
        // ⚠️ 必须先置位：prepareWebUI 首行即 `if (!this.useWebUI) return`
        this.useWebUI = true;
        this.prepareWebUI(store);
      }
      this.surfaceApplied = true;
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
    // 只有用户意图为"跟随"**且尾部内容真的变了**才跟随；用户往上滚后意图被翻掉就不再抢滚动位置
    // （否则"阅读中被打断"）；用户就地展开/折叠（抑制窗内）也不抢（真机 P0，2026-10-11）。
    if (shouldAutoScroll(this.followBottom, contentGrew, Date.now(), this.followSuppressUntilMs)) {
      delay(() => {
        // ⛔ **派发后复查意图**：这 30ms 内用户可能已经动手（`onWillScroll` 立即置
        //    `followBottom=false`）⇒ 若此处不复查，一个"用户动手前刚排上队"的程序滚动
        //    仍会把他拽回底部（用户 2026-10-12 亲报的"立马被拉回"的次要来源）。
        if (!this.followBottom) {
          return;
        }
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
      this.testMsg = `连接成功：${hint}`;
      // 顺手记进"最近使用"
      await this.config.save(url, this.username, '');
      this.recentServers = this.config.recentServers();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.testMsg = `连接失败：${err.message}（检查 IP/端口、手机是否同网段、服务端是否在跑）`;
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
      this.openDrawer();
      await this.wait(700);
      parts.push(`# 会话抽屉\n${this.collectGeometry()}`);
      this.showDrawer = false;
      this.anim(() => {
            this.showSettingsPanel = true;
          });
      await this.wait(700);
      parts.push(`# 设置\n${this.collectGeometry()}`);
      this.showSettingsPanel = false;
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
      this.showSettingsPanel = false;
      this.showQueue = false;
      this.showPlugins = false;
      this.geoRunning = false;
    }
  }

  /** 等待 ms（ArkTS 里没有 await sleep，自己包一层 Promise）。 */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      delay(() => {
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
        const flag: string = (gw === 0 || gh === 0) ? ' 未布局(0尺寸,或被弹层遮挡/当前不在该页)' : '';
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
      this.openDrawer();
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
            this.showSettingsPanel = true;
          });
      await this.wait(900);
      try {
        done.push(`03-settings=${await this.captureAndUpload('03-settings')}`);
      } catch (e) {
        done.push(`03-settings=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 03-settings ---\n${this.collectGeometry()}`);
      this.showSettingsPanel = false;
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

  /**
   * 自绘 in-app toast（C4：不吃系统 `promptAction` ⇒ 与设计系统同族：token 半径/柔影/发丝/字角色）。
   * 可见性 = **状态的函数**（`toastVisible`），动画只做装饰（`.transition`）⇒ fail-safe（门禁 ⑨ 正向形态）。
   * ⛔ 复用本文件**唯一** setTimeout 出口 `delay()`（性能预算 7/7 已满，⛔ 不新增调用点）。
   */
  private toast(msg: string, kind: string = TOAST_KIND_NOTICE): void {
    this.toastState = nextToast(this.toastState, kind, msg);
    const seq: number = this.toastState.seq;
    const ms: number = toastDurationMs(this.toastState.kind);
    delay((): void => {
      // 版本校验：陈旧计时器**不误杀**新 toast（单槽替换语义）
      if (toastExpired(this.toastState, seq)) {
        this.toastState = emptyToast();
      }
    }, ms);
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
    // 目标①(a)：显式登出**也要**取消后台对账延迟任务 —— 否则它带着旧会话继续被系统唤起空跑
    // （幂等 + 失败静默，见 `workreconcile/schedule.ets:cancelReconcileScheduled`）。
    // ⚠️ 不能靠 `core/notify.clearAll` 兜：它只清**通知**，而 `doLogout` 现行为**不调**它
    //    （401/换账号路径由 `clearAll → sessionClearedHook` 覆盖，显式登出这条没有）。
    cancelReconcileScheduled();
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

  /** 池上限（超过按 LRU 驱逐并关连接）。
   *  ⚠️ 不能太小：驱逐 = 下次切回来要 `openSession()` → **重新拉一次 `/api/history`**。
   *  用户实测"来回切会话看到大量没必要的历史请求"的根因就是这里只有 3 —— 只要会话数 > 3，
   *  切第 4 个就把第 1 个赶走。聊天应用常态会在 5~8 个会话间来回切，故放宽到 8
   *  （每个 store 只是一份内存状态机 + 一条 SSE，代价可控）。 */
  private poolMax(): number {
    return 8;
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
    // ── 会话面切换动效（用户 2026-10-12 亲报「侧边栏点击切换会话后要有动画，现在没有」）──────
    // ① 本帧先把整面**下沉一格**（`switchSlide=1`；静息态是 0 ⇒ 不动时与原先逐字节一致）；
    // ② 内容就位后由 `settleSwitchSlide()` 在**下一帧**动画归零 ⇒ 新会话"从下方落位"。
    // ⛔ 只动位移、**绝不碰不透明度**：动画被打断最多是位置差一格，内容始终完全可读（门禁 ⑨）。
    // ⛔ 为什么必须跨帧：同帧里"置 1 再动画到 0"会被 ArkUI 合并成一次状态变更（起点=终点 ⇒ 看不见）。
    this.switchSlide = 1;
    // ⛔ 会话作用域的**前端状态**必须随切换清空（同「跨会话串内容」一类事故，2026-10-10）：
    //   attachments —— 在 A 会话挂的文件绝不能跟着带到 B 会话（切过去直接发 => 发错文件）
    //   cmd* / fs*  —— 上一个会话残留的 `/` `@` 补全菜单
    //   ctxOpen     —— 长按菜单指向的是上一个会话的行，切换后必须关掉
    this.attachments = [];
    this.cmdToken = '';
    this.cmdItems = [];
    this.fsEntries = [];
    this.ctxOpen = false;
    // 「添加目标」输入行也随会话清空（否则在 A 会话敲了一半的目标会带到 B 会话）
    this.addingGoal = false;
    this.goalDraft = '';
    const target: ChatStore = this.storeFor(chatId);
    const alreadyOpen: boolean = target.currentChatId === chatId;
    this.store = target;
    this.rekeyPool(target, chatId);
    // ⛔ **点击即刻可见**（用户 2026-10-13 亲报「切换会话点击后立刻要 loading，不能看起来没变」）：
    //    `openSession()` 在能拉到历史之前有**两次网络往返**（会话列表 + `/api/history`）；期间界面若
    //    原封不动仍是**上一个会话**的内容 ⇒ 用户以为"点了没反应"。⇒ 当场（无 await）切身份 + 清空
    //    + 进 loading：头部立刻换成新会话标题、消息区立刻进历史骨架。
    //    ⛔ 会话列表的补齐**下沉**到 `openSession()`（它本来就会补一次），此处不再单独 await。
    if (!alreadyOpen) {
      target.beginSwitch(chatId);
    }
    // #7-4（2026-10-17）：切会话自动对账终端列表（web `useTerminal.ts:315-317` restoreFromBackend
    // 同款——chatID 变化即拉；此前仅建/删后拉 ⇒ 别的端建的终端要等手动刷新才出现）。
    // fire-and-forget：不阻塞切换（结果经 store.onUpdate 泵回界面）。
    void target.loadTerminals();
    // ⛔ 8s 自愈（2026-10-17 P0-B：用户亲报「快速频繁切会话 ⇒ 整个应用全空且无法自动恢复，
    //   侧栏也空」）：beginSwitch 置 historyLoading=true 后若 **loadSessions/loadHistory 因
    //   竞态/网络挂死**，loading 永不复位 ⇒ 会话加载中… 永久卡死（截图实锤）。此守卫在
    //   8s 后检查：仍 loading 且仍是这个会话 ⇒ 自动重拉一次 history（fire-and-forget；
    //   重试仍失败由下次事件/手动兜底 —— 但**绝不永久卡死**）。
    delay((): void => {
      const st: ChatStore | null = this.store;
      if (st !== null && st.historyLoading && st.currentChatId === chatId) {
        st.loadHistory().catch((): void => {
          // 重试失败不影响主链路（下次切会话/事件再兜底）
        });
      }
    }, 8000);
    // ⛔ 切会话**不再**用"整张列表 opacity 0.001 → 1"来遮旧会话：
    //    那是"可读性成了动画的函数"（动画被打断/未跑 ⇒ 整列表近不可见，用户亲报的同类缺陷）。
    //    现在由 **行级 `entryRestOpacity()` + `.transition` 出现过渡**（`core/msgentry.ets`）负责观感：
    //    静息态恒为 1（fail-safe），过渡只是锦上添花。`rekeyPool(target, chatId)` 已负责换行。
    // 切会话即换草稿（每个会话各自一份；弱网下也能恢复）
    this.failedSend = '';
    this.draft = this.config.draftFor(chatId);
    if (alreadyOpen) {
      // 池里这个会话一直开着：直接把已累积的状态映到界面（不发生任何网络等待）
      this.syncFrom(target);
      // ⛔ 这条路径**没有 await**（同帧同步返回）⇒ 必须照样收尾，否则入场位移永远停在起点
      //    （整面比正常位置低 16vp —— 本仓"位移起点必须被收回"的硬要求）。
      this.settleSwitchSlide();
      return;
    }
    // ③ 会话加载 splash：本条路径**确有网络等待**（会话列表补齐 + `/api/history`）⇒ 置位遮罩。
    this.switchSplash = true;
    try {
      await target.openSession(chatId);
    } catch (e) {
      this.loadErr = errText(e as Object);
      this.toast(`切换失败: ${this.loadErr}`);
    } finally {
      // ⛔ 必复位（含失败路径）⇒ 遮罩绝不永久遮挡（失败方向安全；门禁⑨ 同族纪律）。
      this.switchSplash = false;
    }
    this.settleSwitchSlide();
  }

  /**
   * 会话面切换的**收尾**：在**下一帧**把入场位移用底座动效归零（静息态）。
   *
   * ⛔ 必须跨帧：`switchSession()` 的"池中已开"路径**没有 await**（同帧同步跑完）⇒ 若在这里直接
   *    `this.anim(…)`，ArkUI 会把"置 1 + 归 0"合并成一次状态变更（动画起点 = 终点 = 0）⇒ **看不见动画**。
   *    `delay(…, 0)` 是本文件唯一的 `setTimeout` 出口（性能预算 ⑦ 计调用点个数）。
   * ⛔ 只归零位移、不动不透明度：可读性不依赖动画（门禁 ⑨ / `anim-opacity-gate.sh`）。
   */
  private settleSwitchSlide(): void {
    delay(() => {
      this.anim(() => {
        this.switchSlide = 0;
      });
    }, 0);
  }

  /**
   * 会话行右侧的「相对时间」（web `SessionItem.tsx:332-347` 同源）。
   *
   * ⛔ 页面**只做时钟注入**，规则全在 `core/sessiongroup.ets:relativeTimeLabel`（判据与渲染同源）。
   *    `last_active` 缺失 ⇒ 传空串 ⇒ 解析失败 ⇒ `''`（缺时间**不撒谎**，⛔ 不回落 `'刚刚'`）。
   */
  private relTimeOf(lastActive: string | undefined): string {
    return relativeTimeLabel(lastActive !== undefined ? lastActive : '', Date.now());
  }

  /**
   * 行的 `chat_id` 是否就是**当前会话** —— ⛔ 必须用**规范化**比较。
   *
   * 为什么（2026-10-13，同 §21.111 幽灵行根因第三次咬人）：`currentChat` 是**全键**
   * （`web:chat_026B…`，历史 bug 写的），而会话树里**真身行**的 `chat_id` 是裸 id
   * （`chat_026B…`）⇒ 原值精确比对**命中幽灵行**（现已由 `dedupeSessionItems` 从列表剔除）
   * ⇒ 修完之后**没有任何行**会显示为当前会话（标题不高亮、无行底填充）＝新的静默退化。
   */
  private isCurrentSession(chatId: string): boolean {
    if (chatId === this.currentChat) {
      return true;
    }
    // ⚡ A2a（2026-10-14）：a 半边走**渠道索引**（O(1) 回查）；b 半边同一次 build 内恒定
    //    ⇒ 页级缓存 `currentCanonicalId`。原实现每行 ×2 线性扫 ⇒ 开抽屉全量构建 O(n²)
    //    （n≈684 ⇒ 4-5M 次比较，秒级阻塞成分）。语义逐字不变（首命中优先/缺省 web）。
    const a: string = canonicalChatId(channelForChatIndexed(this.sessions, this.channelIdx(), chatId), chatId);
    const b: string = this.currentCanonicalId();
    return a.length > 0 && a === b;
  }

  /** 渠道索引缓存（A2a）：失效键 = `sessions` 引用恒等（loadSessions 恒换新数组 ⇒ 引用变即失效）。 */
  private channelIdxRef: object | null = null;
  private channelIdxCache: Map<string, string> = new Map<string, string>();
  private channelIdx(): Map<string, string> {
    if (this.channelIdxRef !== this.sessions) {
      this.channelIdxCache = channelIndex(this.sessions);
      this.channelIdxRef = this.sessions;
    }
    return this.channelIdxCache;
  }

  /** 当前会话的规范 id（`isCurrentSession` 的 b 半边）：同 build 恒定 ⇒ 只算一次。 */
  private curCanRef: object | null = null;
  private curCanChat: string = '';
  private curCanCache: string = '';
  private currentCanonicalId(): string {
    if (this.curCanRef !== this.sessions || this.curCanChat !== this.currentChat) {
      this.curCanCache = canonicalChatId(
        channelForChatIndexed(this.sessions, this.channelIdx(), this.currentChat), this.currentChat);
      this.curCanRef = this.sessions;
      this.curCanChat = this.currentChat;
    }
    return this.curCanCache;
  }

  /** 标签显示名（来自会话列表的名字，取不到则用 id 末段）。 */
  private tabLabel(chatId: string): string {
    // ⛔ 用**规范化解析器**取标签（`resolveSessionNode` 挑"真身"）：按原值精确比对会命中
    //    幽灵行，而幽灵行的 label **就是原始会话键** ⇒ 顶栏标题显示 `web:chat_026B…`
    //    （真机截图实锤），真名 `harmony-ui-dev` 反而丢失。
    const node: SessionItem | null =
      resolveSessionNode(this.sessions, channelForChatIndexed(this.sessions, this.channelIdx(), chatId), chatId);
    if (node !== null) {
      return sessionTitle(node.label !== undefined ? node.label : '', chatId,
        node.preview !== undefined ? node.preview : '');
    }
    return sessionTitle('', chatId);
  }

  /** 该标签的会话是否在跑（用会话列表的 running，或该池 store 的 busy）。 */
  private tabRunning(chatId: string): boolean {
    // ⛔ 同 `tabLabel`：按原值比对会命中幽灵行（无 `running` 字段 ⇒ 恒 false）。
    const node: SessionItem | null =
      resolveSessionNode(this.sessions, channelForChatIndexed(this.sessions, this.channelIdx(), chatId), chatId);
    if (node !== null) {
      return node.running === true;
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

  /**
   * 打开「新建会话」弹层 —— web `NewSessionDialog` 的等价落点（工作目录 + 最近目录候选）。
   *
   * 为什么需要它：web 的「新建会话」是**弹层**（`SessionSidebar.tsx:529` / `builtinPanels.tsx:228`），
   * 里面可选 cwd（`PathPicker`）+ 最近目录候选；原生此前 `newSession()` **直建**（无 cwd）
   * ⇒ 最近目录根本无从露面。本次只补"工作目录"这一段（label 要改 `core/store.ets` 的
   * `createSession` 签名，超出本次改动面 ⇒ 不碰）。
   */
  private openNewSession(): void {
    this.showDrawer = false;
    // 打开那刻读一次（对齐 web `NewSessionDialog.tsx:42-50` 的 useEffect）。
    this.newSessionDirs = parseRecentWorkDirs(settingOf(this.settings, RECENT_WORKDIRS_SERVER_KEY));
    // 预填最近一条（web `:47` `recent[0] || '/'`）；原生**无候选则留空 = 不设 cwd**（不改既有默认行为的兜底）。
    this.newSessionPath = this.newSessionDirs.length > 0 ? this.newSessionDirs[0] : '';
    // 会话名称复位（web `:45` `setLabel('')`）。
    this.newSessionLabel = '';
    // 补全下拉复位（web `:48` `setBusy(false)` 同口径；下拉在打开时由输入重新拉取）。
    this.nsPathDirs = [];
    this.nsPathLoading = false;
    this.nsPathOpen = false;
    this.showNewSession = true;
  }

  private closeNewSession(): void {
    this.showNewSession = false;
    this.nsPathOpen = false;
  }

  /**
   * 拉一次路径补全候选（web `PathPicker.tsx:51-73` 的 effect：`listDir(dirPath,true)` → 只留目录 → 前缀过滤）。
   *
   * ⚠️ 无 debounce：web 用 `useDebounce(200ms)`；原生端**不引入计时器**（本仓禁在页面新造 `setTimeout`，
   *   见 `model_list_states` 的「块内零 setTimeout」）。改为**每次输入即拉**（服务端 `resolveSafePath` 已做
   *   开销兜底）；行为对用户可见差异仅在"打字中的请求数"，候选集**逐字一致**。
   */
  private async refreshPathDirs(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    const parsed: PathInput = parsePathInput(this.newSessionPath);
    const dir: string = parsed.dirPath.length > 0 ? parsed.dirPath : '/';
    const prefix: string = parsed.prefix;
    this.nsPathOpen = true;
    this.nsPathLoading = true;
    try {
      const all: FsEntry[] = await store.listFs(dir);
      this.nsPathDirs = filterChildDirs(all, prefix);
    } catch (e) {
      this.nsPathDirs = [];
    } finally {
      this.nsPathLoading = false;
    }
  }

  /** 下钻进一个候选目录（web `PathPicker.tsx:88-97 navigateInto`）：值 = `childPath(dir,name)`，继续列下一层。 */
  private pickPathDir(name: string): void {
    const parsed: PathInput = parsePathInput(this.newSessionPath);
    this.newSessionPath = childPath(parsed.dirPath, name);
    void this.refreshPathDirs();
  }

  /** 移除一条最近目录（web `NewSessionDialog.tsx:107` 的 X）—— 立即落盘。 */
  private removeRecentDir(path: string): void {
    const next: string[] = removeWorkDir(this.newSessionDirs, path);
    this.newSessionDirs = next;
    this.persistRecentDirs(next);
  }

  /** 最近目录落盘（服务端设置键 = 与 web 同一格；失败只 toast，不影响本次使用）。 */
  private persistRecentDirs(list: string[]): void {
    void this.setSetting(RECENT_WORKDIRS_SERVER_KEY, serializeRecentWorkDirs(list));
  }

  /**
   * 确认新建：建会话 →（有路径则）`set_cwd` → 记入最近目录
   * —— 逐条对齐 web `useSessionStore.ts:1481-1485`（create → setCwd → rememberRecentWorkDir）。
   *
   * ⚠️ 顺序不可换：**只有 `set_cwd` 成功才 remember**（失败不往列表里塞噪声）。
   * ⚠️ `set_cwd` 失败**不回滚**会话（会话已建好）；只 toast —— 与 web 同款非致命处理。
   */
  private async confirmNewSession(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    const path: string = this.newSessionPath.trim();
    // 会话名称：trim 后非空才发（web `NewSessionDialog.tsx:54` `label.trim() || undefined`）。
    const label: string = this.newSessionLabel.trim();
    this.showNewSession = false;
    this.showDrawer = false;
    try {
      await store.createSession(label.length > 0 ? label : undefined);
    } catch (e) {
      this.toast(`新建失败: ${errText(e as Object)}`);
      return;
    }
    if (path.length === 0) {
      return;
    }
    try {
      await this.sendSetCwd(store, path);
      const next: string[] = rememberWorkDir(this.newSessionDirs, path);
      this.newSessionDirs = next;
      this.persistRecentDirs(next);
    } catch (e) {
      this.toast(`工作目录设置失败: ${errText(e as Object)}`);
    }
  }

  /**
   * 发 `set_cwd`（**唯一**工作路径写路径；web `components/agent/api.ts:168-177`）。
   *
   * ⛔ 不新造 RPC 名 / 不新造参数类型：只用既有 `RPC_SET_CWD` + `SetCwdParams`（见本文件顶部常量）。
   * ⛔ `force:true` 不可省：服务端据此原样采纳传入路径（不做推断/转换）。
   */
  private async sendSetCwd(store: ChatStore, dir: string): Promise<void> {
    await rpc<Object>(store.http, RPC_SET_CWD, new SetCwdParams(store.channel, store.wireChatId(), dir));
  }

  /**
   * 「会话状态」面板里改工作路径 → 提交（web `SessionInfo.tsx:100-120` 的 `applyCwd`）。
   *
   * 复用上面的唯一写路径 `sendSetCwd`；成功后拉一次会话状态 ⇒ **服务端权威** `cwd` 回流
   * （`store.loadStatus` → `store.cwd` → `syncFrom` → `this.cwd`）。⛔ 不本地估算 / 不假装成功。
   */
  private async submitCwd(dir: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    const path: string = dir.trim();
    // 空路径 / 未改动 ⇒ 不发请求（与 web `applyCwd` 的早退同口径）。
    if (path.length === 0 || path === store.cwd) {
      return;
    }
    try {
      await this.sendSetCwd(store, path);
      await store.loadStatus();
    } catch (e) {
      this.toast(`工作目录设置失败: ${errText(e as Object)}`);
    }
  }

  /**
   * 当前会话的「最后活跃」（`SessionItem.last_active`，`core/types.ets:37`；服务端 RFC3339）。
   * 取不到 ⇒ 空串 ⇒ 面板**不显示**该行（web `SessionInfo.tsx:174-176` 同口径：truthy 才显示）。
   */
  private currentLastActive(): string {
    const id: string = this.store !== null ? this.store.currentChatId : '';
    if (id.length === 0) {
      return '';
    }
    // ⛔ 同族（§21.112）：按原值精确比对命中的是**幽灵行**（`last_active` = 幽灵创建时刻，
    //    真身的活跃时间反而丢）⇒ 状态面板的「最后活跃」会显示一个无意义的旧值。
    const node: SessionItem | null =
      resolveSessionNode(this.sessions, channelForChatIndexed(this.sessions, this.channelIdx(), id), id);
    if (node !== null) {
      return node.last_active !== undefined ? node.last_active : '';
    }
    return '';
  }

  /**
   * 当前会话是否**子代理（SubAgent）会话** —— agent 形 tenant 键 `<ch>:<chat>/<role>[:inst]`。
   *
   * 判据**唯一来源** = `core/sessiongroup.parseAgentChatID`（web `parseAgentChatID` 的逐字移植）
   * ⇒ ⛔ 不在页面另写一套"含 `/` 就算"的字符串猜测（那会把普通会话名里的斜杠误判成子代理）。
   *
   * 为什么要它：**web 权威**（`web/src/workspace/panels/AgentPanel.tsx:561/930/1093/1114`）对子代理
   * 面板有一整组 `!isSubAgent` 门控 —— 不渲染 StagingTray / MessageInput（输入区）、不做 queue 水合、
   * 不给 rewind。原生的做法是把子代理会话**当普通聊天开**（`openSubAgentSession` → `switchSession`），
   * 于是给一个**没有任何持久化消息**的会话（服务端 `/api/history` 实测回 `messages:null`；
   * DB `session_messages` 对这些 `channel=agent` 租户 `msgs=0` —— 子代理内容只以 `sub_agents`
   * 进度挂在**父轮次**里）配上"可以在这打字"的输入框 ⇒ 用户看到「子代理会话进入后永远空白」。
   */
  private isSubAgentChat(): boolean {
    return parseAgentChatID(this.currentChat) !== undefined;
  }

  private labelOf(chatId: string): string {
    // ⛔ 规范化解析（同 §21.112）：按原值精确比对会命中幽灵行，而幽灵行的 label **就是原始
    //    会话键** ⇒ **顶栏标题**显示 `web:chat_026B…`（真机 22:09 装机实测：改完 `tabLabel`
    //    顶栏仍不见好，正是因为顶栏走的是本方法，不是 `tabLabel`）。同族漏网点必须一次扫尽。
    // ⚡ B-F1（2026-10-14，B 线审计「同一会话三套名字」）：旧版直吐 `node.label` ⇒ 无回声
    //    判定（机器串可上顶栏）、无未名占位、无 preview 兜底 ⇒ 与抽屉行/池标签不同名。
    //    收敛到**唯一出口** `sessionTitle`（判据与渲染同源 —— AGENTS.md）。
    const node: SessionItem | null =
      resolveSessionNode(this.sessions, channelForChatIndexed(this.sessions, this.channelIdx(), chatId), chatId);
    if (node !== null) {
      return sessionTitle(node.label !== undefined ? node.label : '', node.chat_id,
        node.preview !== undefined ? node.preview : '');
    }
    return sessionTitle('', chatId);
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
    if (this.goalObjective.length === 0) {
      return '';
    }
    return `${this.goalStatus === 'completed' ? '已完成：' : '目标：'}${this.goalObjective}`;
  }

  /** 当前进行中的 todo（面板顶部显示）。 */
  private currentTodoLine(): string {
    return currentTodo(this.todos);
  }

  // ── 目标 / 清单的**写操作**（web `AgentPanel.tsx` 的 handleSetGoal/handleClearGoal/
  //    handleUpdateTodos → `agent/api.ts` 的 set_goal/clear_goal/set_todos RPC）──
  // ⛔ 一律直发 RPC、不做本地乐观改写：服务端落库后推 progress 事件 ⇒ store.todos /
  //    快照 goal 刷新（状态以后端为准 —— 与存量 todos 的权威来源同一路径）。

  /** 设置/更新目标（web `setGoal`）。 */
  private async handleSetGoal(objective: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || objective.length === 0) {
      return;
    }
    try {
      await rpc<Object>(store.http, 'set_goal',
        new SetGoalParams(store.channel, store.wireChatId(), objective));
    } catch (e) {
      this.toast(`设置目标失败: ${errText(e as Object)}`);
    }
  }

  /** 清除目标（web `clearGoal`）。 */
  private async handleClearGoal(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      await rpc<Object>(store.http, 'clear_goal',
        new ClearGoalParams(store.channel, store.wireChatId()));
      // ⛔ **乐观覆盖**（web `AgentPanel.tsx:864-874` 的 `goalEditRef.current.commit(null, seq)` 同款）：
      //    RPC 成功 ⇒ **立刻**本地清掉 goal（goal 条当场消失）；服务端的显式清除标记
      //    （`{objective:"",status:"cleared"}`）到达即同值收敛（幂等，判据在 `core/reduce.ts:88-97`）。
      //    ⛔ 只等服务端推送是不够的：RPC 已成功而推送延迟/丢失时，界面会一直显示一个
      //    **后端已删掉的目标**（用户 2026-10-13 亲报「点删除后前端还显示 goal」）。
      store.clearGoalLocal();
    } catch (e) {
      // 失败**不**做本地清除：banner 保留 + 明确报错（用户能分清"没删掉"，⛔ 不假装成功）
      this.toast(`清除目标失败: ${errText(e as Object)}`);
    }
  }

  /** 整表替换 todo 清单（web `updateTodos` —— 勾选/改名/删除都走这一条）。 */
  private async pushTodos(next: TodoItem[]): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    // 乐观覆盖（web `usePendingEdit`）：立即本地生效 + 记 pending，挡住在途的**更旧**快照。
    const seq: number = this.pendingSeq.begin(); // ① 提交序号（乱序防护）
    this.pendingTodos.commit(todosFpOf(next));
    this.todos = next;
    this.todosFp = todosFpOf(next);
    try {
      await rpc<Object>(store.http, 'set_todos',
        new SetTodosParams(store.channel, store.wireChatId(), todoPayloadRows(next)));
      this.pendingSeq.acceptSeq(seq); // ② RPC 成功 ⇒ 本次提交记账（更旧的提交不得回写）
    } catch (e) {
      // 失败：放弃本地覆盖，下一次同步回落到服务端权威值
      this.pendingSeq.discard(); // ③ 放弃覆盖（把 applied 推到 issued ⇒ 更旧提交作废）
      this.pendingTodos.discard();
      this.toast(`更新清单失败: ${errText(e as Object)}`);
    }
  }

  /** 点开 SubAgent 会话（web `SubAgentProgressTree.openSubAgent` → 打开该 agent 会话）。 */
  private openSubAgentSession(sessionKey: string): void {
    if (sessionKey.length === 0) {
      return;
    }
    this.switchSession(sessionKey);
  }

  /**
   * 提交「添加目标」内联输入（web `MessageInput.tsx:695-726` 的 Enter / onBlur 分支：
   * **trim 非空才提交**；随后清空草稿并关闭输入行）。
   */
  private commitAddingGoal(): void {
    const text: string = this.goalDraft.trim();
    this.addingGoal = false;
    this.goalDraft = '';
    if (text.length > 0) {
      this.handleSetGoal(text);
    }
  }

  /**
   * 收起软键盘（用户**显式发送后**调用）。
   *
   * 走 `UIContext` 的焦点控制器 `FocusController.clearFocus()`（API 12；SDK 声明
   * `@ohos.arkui.UIContext.d.ts:3239-3250`）：清焦点 ⇒ 输入法会话结束 ⇒ 键盘收起。
   * ⛔ 不用 `focusControl.requestFocus(别的 id)` 那种"把焦点挪走"的绕法（会改变焦点语义、
   *   给别的控件戴上高亮）；也⛔不引 `inputMethod.stopInputSession()`（更重、是全局 IME 操作）。
   */
  private dismissKeyboard(): void {
    try {
      this.getUIContext().getFocusController().clearFocus();
    } catch (e) {
      // 无焦点/无 UI 上下文：无事可做（⛔ 绝不因"收键盘失败"影响发送本身）
    }
  }

  private async sendDraft(): Promise<void> {
    const store: ChatStore | null = this.store;
    const text: string = this.draft.trim();
    if (store === null || this.anyUploading()) {
      return;
    }
    // rewind 编辑态：发送 = 回退并重发（不走普通发送路径 —— rewind → reset → reload → send
    // 的铁律顺序封装在 store.rewindTo 内）。
    if (this.rewindEditRowId.length > 0) {
      if (text.length === 0) {
        this.toast('内容不能为空');
        return;
      }
      await this.submitRewind(text);
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
    // 触觉：本入口同管"发送"与"打断"两种动作 ⇒ 事件名由 `interrupt` 判别，
    // 两者档位相同（中档），但登记名分开 ⇒ 判据可钉住"这里是发送/打断"。
    this.buzz(interrupt ? HAPTIC_EVENT_STOP : HAPTIC_EVENT_SEND);
    // ★ 发送后：**收起键盘 + 视角回到最新**（用户 2026-10-12 真机亲报「发完不收键盘、
    //   视角不自动滚到最下方」）。语义 = 用户**主动发消息** ⇒ 意图必然是"看最新的"
    //   （与切会话同一语义：意图重置为跟随，见 `switchSession`）。⛔ 不新增定时器 ——
    //   后续 `syncFrom` 的 `shouldAutoScroll`（意图已为 true）会继续跟随后续新增行到底。
    this.followBottom = true;
    // ⛔ 顺带清掉「就地操作」抑制窗：它存在只为保护"展开/收起工具后别被程序拽走视口"，
    //    而**主动发送**是更新的意图（用户 2026-10-13 亲报「有时候发消息了不会自动 follow bottom」）
    //    —— 抑制窗还没过期时发送就会命中"不跟随"。发送 ⇒ 意图重置 ⇒ 抑制作废。
    this.followSuppressUntilMs = 0;
    this.dismissKeyboard();
    try {
      this.listScroller.scrollEdge(Edge.Bottom);
    } catch (e) {
      // 首帧尚未布局：忽略（下一步 store 变更后的 syncFrom 仍会跟随到底）
    }
    try {
      let interrupted: boolean = false;
      console.info('xbot send: 进入发送路径（await 前）');
      if (keys.length > 0) {
        interrupted = await store.send(content, keys, names, sizes, interrupt);
      } else {
        interrupted = await store.send(content, undefined, undefined, undefined, interrupt);
      }
      console.info('xbot send: await 已 resolve');
      this.failedSend = '';
      const note: string = sendToast(interrupted, busyBefore);
      if (note.length > 0) {
        this.toast(note);
      }
      // 备1 短时任务（旁路，幂等）：发送成功 ⇒ 申请一段"不被冻结"的窗口，
      // 兜住"用户发完立刻切后台"。绝不参与发送/会话语义（失败只记日志）。
      this.keepAliveTurn = true;
      beginTurnKeepAlive();
    } catch (e) {
      console.info('xbot send: 发送失败/异常（' + errText(e as Object) + '）');
      // 失败：草稿与附件都还给用户（store 已回滚那条乐观行，界面不会留幽灵消息）
      this.draft = text;
      this.attachments = keep;
      this.failedSend = text;
      this.toast(`发送失败: ${errText(e as Object)}`);
    }
  }

  // ── 技能管理（目标④「真的支持 web 的所有插件和功能」）─────────────────────────
  //
  // web 把技能管理做成内置前端插件 `xbot.skill-manager`（面板 `SkillManagerPanel.tsx`），
  // 原生此前**零覆盖** ⇒ 补齐。数据/所有权全留页面（组件只收 @Prop + 回调）。
  /** 开技能面板（并拉一次列表）。 */
  private openSkills(): void {
    this.dismissKeyboard();
    this.showSkills = true;
    this.closeSkillView();
    this.loadSkills();
  }

  /** 拉技能列表。失败 ⇒ 面板红字 + 重试（⛔ 不吞异常、不假装成空列表 —— 与插件目录的吞法故意相反）。 */
  private async loadSkills(): Promise<void> {
    const st: ChatStore | null = this.store;
    if (st === null) {
      return;
    }
    this.skillsLoading = true;
    this.skillsError = '';
    try {
      // `project_dir` = 会话工作区根（与 web 传 `cwd` 同源）⇒ 项目技能也能列出来。
      const list: SkillItem[] = await st.listSkills(st.cwd);
      this.skills = list;
    } catch (e) {
      this.skillsError = errText(e as Object);
      this.skills = [];
    } finally {
      this.skillsLoading = false;
    }
  }

  /**
   * 开/关一条技能（**乐观更新**：先翻本地态，失败回滚 + 报错，最后静默重拉对齐服务端
   * —— 逐条对齐 web `SkillManagerPanel.tsx:77-107` 的语义；防抖在原生**不需要**
   * （`Toggle` 的 onChange 是离散事件，不是拖动流））。
   */
  private async toggleSkill(name: string, enabled: boolean): Promise<void> {
    const st: ChatStore | null = this.store;
    if (st === null) {
      return;
    }
    const before: SkillItem[] = this.skills;
    const next: SkillItem[] = [];
    for (let i = 0; i < before.length; i++) {
      const it: SkillItem = before[i];
      next.push(it.name === name
        ? {
          name: it.name, description: it.description, path: it.path, source: it.source,
          enabled: enabled, canUninstall: it.canUninstall,
        }
        : it);
    }
    this.skills = next;
    try {
      await st.setSkillEnabled(name, enabled);
    } catch (e) {
      this.skills = before;
      this.skillsError = errText(e as Object);
      return;
    }
    // 静默重拉：以服务端为准（与 web 的 `load(true)` 一致）
    try {
      this.skills = await st.listSkills(st.cwd);
    } catch (e) {
      // 重拉失败**不回滚**已成功的写入（写入已生效；列表保持乐观态即可）
    }
  }

  /** 打开一条技能的 `SKILL.md`（`skill_get_content`；`path` 是**目录**，服务端自己拼文件）。 */
  private async openSkillView(item: SkillItem): Promise<void> {
    const st: ChatStore | null = this.store;
    if (st === null) {
      return;
    }
    this.skillViewName = item.name;
    this.skillViewText = '';
    this.skillViewLoading = true;
    try {
      this.skillViewText = await st.getSkillContent(item.path);
    } catch (e) {
      this.skillViewText = `读取失败：${errText(e as Object)}`;
    } finally {
      this.skillViewLoading = false;
    }
  }

  private closeSkillView(): void {
    this.skillViewName = '';
    this.skillViewText = '';
    this.skillViewLoading = false;
  }

  /** 取图片字节（带会话鉴权）—— AuthImage 与查看器共用同一实现。 */
  // ── 文件管理（目标④「文件管理也没有」）───────────────────────────────────────
  /**
   * 「Web 版」文件面板（§21.122bg）：原生入口接管默认后，web 版仍须**显式可达**
   * （要求④：能力可换实现，⛔ 不能凭空消失）。拿不到基地址 ⇒ 明说不可用，
   * ⛔ 不静默什么都不做（用户会以为按钮坏了）。
   */
  /**
   * **唯一的面板出口**（§21.122bu，用户定向「一个页面必须只有一个形态，别入口不同展示的不同」）。
   *
   * 形态判定**只**来自 `core/surfaces.surfaceOf`（唯一真源）；本函数是唯一的动作落点 ⇒
   * 任何入口（抽屉键 / 顶栏 / 面板内跳转 / web 宿主导航）调它都拿到**同一形态**。
   * ⛔ 页面里不得再出现"这里走原生、那里走 web"的分叉判断。
   */
  private openSurface(id: string): void {
    if (isNativeSurface(id)) {
      // 原生态：收掉可能开着的 web 面板（否则两层面板叠着、退回时看到旧 web 页）。
      this.panelUrl = '';
      if (id === SURF_FILES) {
        this.showFiles = false;
        this.openFiles();
        return;
      }
      if (id === SURF_TASKS) {
        // ⛔ **必须重置页签**（2026-10-16 装机实测）：与 `SURF_TERMINAL` 同理，此前只 `openPanels()`
        //    而 `panelTab` 是页面 @State ⇒ **保留上一次的页签**。用户上一轮用过「终端」再点底栏
        //    「任务」，面板直接落在**终端**页（实测复现：点任务后文本仍是「暂无终端 / 新建终端即可…」）
        //    ⇒ 「任务」入口名实不符。任务面 = 定时(cron) + 后台(tasks)，权威落地页 = `cron`。
        this.switchPanelTab('cron');
        this.openPanels();
        return;
      }
      if (id === SURF_TERMINAL) {
        this.switchPanelTab('term');
        this.openPanels();
        return;
      }
      return; // 未知原生态：不动（⛔ 不猜）
    }
    // web 态（插件目录/宿主页/GenUI/完整 Web UI + 未知 id 的 fail-safe 兜底）。
    if (id === SURF_PLUGINS) {
      this.openPluginManager();
      return;
    }
    if (!this.openWebPanel(id)) {
      this.toast('Web 面板不可用：未连接服务端');
    }
  }

  /** 开文件面板。初始目录 = 当前会话 cwd（`/api/session/status` 的权威值），缺则根目录。 */
  private openFiles(): void {
    this.dismissKeyboard();
    this.showFiles = true;
    this.closeFsPreview();
    const start: string = this.store !== null && this.store.cwd.length > 0 ? this.store.cwd : '/';
    this.loadFsDir(start);
  }

  /** 列目录。失败 ⇒ 面板红字 + 重试（⛔ 不吞异常、不假装成空目录）。 */
  private async loadFsDir(dir: string): Promise<void> {
    const store: ChatStore | null = this.store;
    this.fmDir = dir;
    // 切目录 / 刷新 / 切隐藏开关都走这里 ⇒ 一律**退出搜索态**（搜索结果属于上一个目录，留着是陈旧数据）。
    this.exitFsSearch();
    this.fsError = '';
    if (store === null) {
      this.fsError = '未连接服务端';
      this.fmEntries = [];
      return;
    }
    this.fsLoading = true;
    try {
      const es: FsEntry[] = await store.listFs(dir, this.fsShowHidden);
      const mapped: FsFileEntry[] = [];
      for (let i = 0; i < es.length; i++) {
        mapped.push({ name: es[i].name, isDir: es[i].isDir, size: es[i].size });
      }
      // 排序**唯一判据** = `core/files.ets:sortFsEntries`（与判据同一份纯函数）。
      this.fmEntries = sortFsEntries(mapped);
    } catch (err) {
      this.fsError = '目录读取失败，请重试';
      this.fmEntries = [];
    }
    this.fsLoading = false;
  }

  /**
   * 递归搜索（`/api/fs/search`）—— web 侧**有端点、无 UI**（`useFileSystem.searchFiles` 全仓 0 消费方，
   * 权威取证见 `core/files.ets` 的 `FsSearchBody` 注释）⇒ 本仓接上是**超越 web**，不是 parity 缺口。
   *
   * ⛔ 手动触发（过滤框**回车**）：性能预算 `setTimeout` 仅剩 1 处余量，且服务端是同步递归 walk。
   * ⛔ 空查询 ⇒ 直接退出搜索态（不拿空串去打服务端，那会 400）。
   * 失败 ⇒ 面板走**通知态**（红字 + 重试），⛔ 不假装成"没有匹配"（那是两条完全不同的用户结论）。
   */
  private async runFsSearch(query: string): Promise<void> {
    const q: string = query !== undefined && query !== null ? query.trim() : '';
    if (q.length === 0) {
      this.exitFsSearch();
      return;
    }
    const store: ChatStore | null = this.store;
    this.fsSearchActive = true;
    this.fsSearchQuery = q;
    this.fsSearchError = '';
    if (store === null) {
      this.fsSearchError = '未连接服务端';
      this.fsSearchItems = [];
      return;
    }
    this.fsSearchLoading = true;
    try {
      const items: FsSearchEntry[] = await store.searchFs(q, this.fmDir, this.fsShowHidden);
      // 排序**唯一判据** = `core/files.ets:sortFsSearch`（目录在前，再按名称；与目录列表同口径）。
      this.fsSearchItems = sortFsSearch(items);
    } catch (err) {
      this.fsSearchError = '搜索失败，请重试';
      this.fsSearchItems = [];
    }
    this.fsSearchLoading = false;
  }

  /** 退出搜索态（清空查询 / 切目录 / 刷新 / 关面板都落到这里）。 */
  private exitFsSearch(): void {
    this.fsSearchActive = false;
    this.fsSearchQuery = '';
    this.fsSearchItems = [];
    this.fsSearchLoading = false;
    this.fsSearchError = '';
  }
  private async openFsFile(filePath: string, kind: string): Promise<void> {
    const store: ChatStore | null = this.store;
    this.fsPreviewPath = filePath;
    this.fsPreviewText = '';
    this.fsPreviewNotice = '';
    this.fsPreviewLanguage = '';
    this.fsPreviewIsImage = kind === FK_IMAGE;
    this.fsPreviewImageUrl = kind === FK_IMAGE
      ? `/api/fs/raw?path=${encodeURIComponent(filePath)}` : '';
    if (kind === FK_IMAGE) {
      return;    // 图片：字节走 AuthImage（`/api/fs/raw` 是字节流，读文本无意义）
    }
    if (store === null) {
      this.fsPreviewNotice = '未连接服务端';
      return;
    }
    this.fsPreviewLoading = true;
    try {
      const r: FsReadResult = await store.readFs(filePath);
      if (r.isBinary) {
        // ⛔ 二进制：**通知态**（不是文件内容）—— 旧实现写进 `previewText` ⇒ 代码视图里像源代码
        this.fsPreviewNotice = '二进制文件，无法以文本预览';
      } else {
        this.fsPreviewText = r.content;
        this.fsPreviewLanguage = r.language !== undefined && r.language !== null ? r.language : '';
      }
    } catch (err) {
      this.fsPreviewNotice = '文件读取失败，请重试';
    }
    this.fsPreviewLoading = false;
  }

  private closeFsPreview(): void {
    this.fsPreviewPath = '';
    this.fsPreviewText = '';
    this.fsPreviewNotice = '';
    this.fsPreviewLanguage = '';
    this.fsPreviewIsImage = false;
    this.fsPreviewImageUrl = '';
  }

  private async loadImageBytes(src: string): Promise<ArrayBuffer> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return new ArrayBuffer(0);
    }
    const buf: ArrayBuffer | null = await store.http.getBinary(src);
    return buf !== null ? buf : new ArrayBuffer(0);
  }

  /** 文件行菜单「复制路径」——走全站唯一剪贴板出口 `copyText`（⛔ 不另开 pasteboard 调用）。 */
  private copyFsPath(filePath: string): void {
    void this.copyText(filePath, '路径');
  }

  /**
   * 文件行菜单「加入聊天」——把 `@path` 提及时**追加**进输入框（web `insertIntoChat` 的
   * "appended to current content" 语义，`src/lib/chatInputBridge.ts`）。
   *
   * 追加而非覆盖：用户可能已在打字，覆盖会**吃掉**他写的内容。
   * 收面板：文件面板是**全屏侧栏**，不收起来则输入框被盖住 ⇒ 用户看不到刚插进去的提及。
   */
  private addFsToChat(filePath: string): void {
    const mention: string = fsMention(filePath);
    if (mention.length === 0) {
      return;
    }
    const base: string = this.draft;
    this.draft = base.length === 0 ? mention : `${base} ${mention}`;
    this.showFiles = false;
    this.toast('已加入聊天输入框');
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

  /**
   * 上拉加载更早历史 —— **失败/游标失效都不静默**（P0 2026-10-15 用户亲报「加载不出更早」）。
   *
   * 旧实现只有一句 `await store.loadMore()`：`store` 侧三道闸门静默 `return`、请求失败无 catch
   * ⇒ 头部提示（按 `hasMore` 渲染「更早的历史消息」）**永远在承诺**而列表不动、
   * 零反馈。这里把真结果处理成两种出口：
   *   · 游标失效（`LOADMORE_ERR_NOCURSOR`）⇒ **自愈**：重拉首页（`openSession` 走完整取数）
   *     重建 `oldest_id`（用户口径"清除状态重新拉 api"），而不是永远卡在静默 return 上；
   *   · 真实失败 ⇒ toast 可读原因（同一入口可再试：头部项仍是那个点击出口）。
   */
  private async loadMore(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      await store.loadMore();
      // ⚡ C 线审计 2026-10-14：fetch 成功 ⇒ **同批立即揭示**一批（对齐 web「新行立刻进可渲染集」；
      //   否则本批抓回的行仍被 rowLimit 窗口挡住 ⇒ 用户滚到顶「一切照旧」，得再滚一下触发
      //   onScrollIndex 的本地揭示支——「抓了不给你看」的第二屏形态）。揭示量 12/批仍是
      //   `widenRowWindow` 的窗口 diff 预算口径；头项常驻承担「继续滚=继续揭示」提示。
      if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
        this.widenRowWindow();
      }
      const err: string = store.loadMoreErr;
      if (err.length === 0) {
        return;
      }
      store.loadMoreErr = '';
      if (err === LOADMORE_ERR_NOCURSOR) {
        // 游标失效自愈：重拉首页（`openSession` 会重建 history/游标/hasMore）。
        this.toast('分页游标失效，正在重新载入会话历史…');
        await store.openSession(this.currentChat);
        return;
      }
      this.toast(`加载更早失败：${err}`);
    } catch (e) {
      // 兜底（`store.loadMore` 已把失败落成 `loadMoreErr`，这里只防它自身的守卫异常）
      this.toast(`加载更早失败：${errText(e as Object)}`);
    }
  }

  /**
   * 放开一批行窗口 + **保持可见位置**（新放开的行落在屏幕**上方之外**）。
   *
   * 用户 2026-10-13 亲报：「加载更多触发后，加载的新内容应该直接接在**当前屏幕上方**（屏外），
   * 用户要继续往上滚才能看到；现在是加载之后**立刻视角跑到被加载的最上方**」。
   *
   * 机制（见 `core/listfollow.ets:anchoredIndexAfterPrepend` 的长注释）：放开窗口 ⇒ 数据源**头部
   * 插入**行；插入点 = **头项之后**（头项是列表第 0 项且此刻可见）⇒ 落在**视口之内** ⇒
   * 框架的 `List.maintainVisibleContentPosition`（只对"视口**之外**插入/删除"生效）帮不上忙；
   * `List` 只能按像素偏移保位 ⇒ 同一偏移此刻指向新插入的行 ⇒ 视口跳到新内容顶部。
   * ⇒ **显式**把旧的首个可见**内容行**滚回视口顶部（`ScrollAlign.START`）：新行全部在它前面。
   *
   * ⛔ 锚点取「首个可见**内容行**」而不是「首个可见列表项」：头项可见时（`listStart === 0`）
   *    头项自身**不动**（插入在它之后），锚它等于没锚 ⇒ 必须锚 `listStart || 1` 那一行
   *    （= 放开前视口顶部那一条正文），这才是用户眼睛所在。
   */
  private widenRowWindow(): void {
    const before: number = this.rowDs.count();
    const prevTop: number = this.listStart > 0 ? this.listStart : 1;
    this.rowLimit += MAX_ROWS_VISIBLE;
    this.syncRowDs();
    const prepended: number = this.rowDs.count() - before;
    if (prepended > 0) {
      const target: number = anchoredIndexAfterPrepend(prevTop, prepended);
      // ⛔ 必须**下一帧再滚一次**：`syncRowDs()` 刚发出的 `onDataReloaded()` 要到下一次布局才
      //    生效，同帧 `scrollToIndex` 会落到**旧布局**上而**静默失效**（真机实测：`[DS] tail 12→15`
      //    证明插入已发生，但视口纹丝不动 = 补偿没生效）。故同帧先试一次（布局已就绪时立即生效）
      //    + 下一帧补一次（reload 生效后生效）。
      try {
        this.listScroller.scrollToIndex(target, false, ScrollAlign.START);
      } catch (e) {
        // 首帧尚未布局：交给下一帧的补偿
      }
      // ⛔ 2026-10-17 用户再报「加载更多视角被拉到最上方」（真机双帧补偿曾失效的复发）：
      //    setTimeout(0) 的「下一帧」与 onDataReloaded 的布局生效（下一个 vsync，~16ms）
      //    同周期 ⇒ 补偿仍落在旧布局。改为**三连补偿**（0/32/96ms——跨过 vsync 的幂等重试）：
      //    已对齐时 scrollToIndex 无害；布局就绪的那一跳必中其一。
      const retries: number[] = [0, 32, 96];
      for (let r = 0; r < retries.length; r++) {
        const wait: number = retries[r];
        setTimeout(() => {
          try {
            this.listScroller.scrollToIndex(target, false, ScrollAlign.START);
          } catch (e) {
            // 未布局：交给下一跳
          }
        }, wait);
      }
    }
  }

  // ── 用户消息导航（components/MessageNav + core/msgindex）──────────────────────

  /** 导航锚点（用户消息 + 同 turn 首个 assistant 预览）—— 与组件读**同一**纯函数。 */
  private navAnchors(): NavAnchor[] {
    // ⛔ 记忆化（按 `this.structFp` **结构签名**，不是按 `rows` 数组恒等）：页面每次 build 都会取它，
    //    而 build 由流式内容增长/滚动/其它状态变化频繁触发 —— `buildAnchors` 是 O(总行数) 且
    //    **复制每条消息的完整正文** ⇒ 不记忆化（或按含 `rev` 的指纹记忆化）就是"每帧工作量随
    //    历史长度增长"（用户亲报的"固定历史掉帧" + "stream 时滚历史整个窗口抖动"）。
    return this.navMemo.ofSig(this.rows, this.structFp);
  }

  /**
   * 列表里**是否存在**「加载更早消息」头项 —— **唯一**判据（渲染它的 `if`、项数 `listItemCount`、
   * 列表项下标 ⇄ 行下标换算全部读这里，杜绝三处各写一份而漂移）。
   *
   * 三个条件缺一不可：还有更早历史要拉（`hasMore`）/ 正在拉（`loadingMore`）/ 行窗口被截断
   * （`hiddenRowCount > 0`，此时头项显示「更早的历史消息」/「已到最早」）。
   */
  private hasHeadItem(): boolean {
    return this.hasMore || this.loadingMore || hiddenRowCount(this.rows.length, this.rowLimit) > 0;
  }

  /**
   * 当前可视锚点序号（1-based；0 = 无）。
   *
   * 把 `onScrollIndex` 给的**列表项**下标换算回**行**下标，再交给 `core/msgindex.nearestSeq`
   * （与 web `MessageUserNav` 的 `visibleStart + ACTIVE_ANCHOR_ROWS` 判定同源）：
   *   rowStart = 列表项下标 − 「加载更早」头项 − 行窗口起点
   * （行窗口 `rowLimit` 会把更早的行挡在数据源之外）。越界一律夹到 0。
   */
  private navActiveSeq(): number {
    const len: number = this.rows.length;
    const liveRows: number = this.hasLiveRow ? 1 : 0;
    const restLen: number = len - liveRows > 0 ? len - liveRows : 0;
    const head: number = this.hasHeadItem() ? 1 : 0;
    const windowStart: number = restLen - this.rowLimit > 0 ? restLen - this.rowLimit : 0;
    let rowStart: number = this.listStart - head + windowStart;
    if (rowStart < 0) {
      rowStart = 0;
    }
    return nearestSeq(userAnchorRows(this.rows), rowStart);
  }

  /**
   * 跳转到某行（`MessageNav` 的 `onNavigate`）—— **纯滚动**，绝不触发任何"加载更多"。
   *
   * 目标行若落在渲染窗口（`rowLimit`）之外 ⇒ 先把窗口**本地**放开到包含它（这些行**已在内存**，
   * `rowLimit` 只是渲染上限，放开它不产生任何网络请求）；再解除"贴底跟随"并把列表滚到该项。
   */
  private navToRow(rowIndex: number): void {
    const len: number = this.rows.length;
    if (rowIndex < 0 || rowIndex >= len) {
      return;
    }
    // 用户主动跳转 ⇒ 关掉跟随（否则随后的流式 `scrollEdge(Bottom)` 会把他拉回底部）
    this.followBottom = false;
    const needWindow: number = len - rowIndex + MAX_ROWS_VISIBLE;
    if (needWindow > this.rowLimit) {
      this.rowLimit = needWindow;
      this.syncRowDs();
    }
    const liveRows: number = this.hasLiveRow ? 1 : 0;
    const restLen: number = len - liveRows > 0 ? len - liveRows : 0;
    const head: number = this.hasHeadItem() ? 1 : 0;
    const windowStart: number = restLen - this.rowLimit > 0 ? restLen - this.rowLimit : 0;
    const isLiveTarget: boolean = liveRows === 1 && rowIndex === len - 1;
    const listIndex: number = isLiveTarget
      ? head + this.rowDs.count()
      : head + (rowIndex - windowStart);
    try {
      this.listScroller.scrollToIndex(listIndex);
    } catch (e) {
      // 首帧尚未布局：忽略（下一次滚动索引回调会纠正高亮）
    }
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
    // ⛔ 用户**就地**展开/折叠工具详情：此后这次内容变化是**用户自己**造成的 ⇒ 开抑制窗，
    //    窗内不许程序滚到底（否则展开后更高的卡片会把他刚点的那颗 pill 顶出视口）。
    //    进/出都置位：收起时内容变矮同样不该移动视口。判据见 `core/listfollow.shouldAutoScroll`。
    this.followSuppressUntilMs = followSuppressUntil(Date.now(), FOLLOW_SUPPRESS_MS);
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
      copy.free = s.free;
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

  /**
   * 设置「其他（自己填）」的文本（P2-3：AskUserSheet 的 `setOther` 回调）。
   *
   * ⛔ **逐字搬**自原 `@Builder AskUserSheet()` 里 `TextInput.onChange` 的内联体（搬而不改）：
   * 整体重建 `askSelections`（每个元素新建 `AskSelection`，`labels` 沿用原引用）——
   * 这是「选中态切换靠整体替换触发重渲染」的既有约定，不能改写成就地改。
   */
  private setAskOther(qid: string, v: string): void {
    const next: AskSelection[] = [];
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      const copy: AskSelection = new AskSelection();
      copy.qid = s.qid;
      copy.labels = s.labels;
      copy.other = s.qid === qid ? v : s.other;
      copy.free = s.free;
      next.push(copy);
    }
    this.askSelections = next;
  }

  /**
   * 设置某题的**自由文本**（web `AskUserPanel.tsx:301-315` 的 `freeInputs`）。
   *
   * 形态与 `setAskOther` 逐字同款（整体重建 `askSelections` ⇒ 触发重渲染；`labels`/`other` 沿用）。
   * ⛔ 不回写 `other`：两者是**并列**输入通道，合并优先级由 `mergeAskAnswers` 决定
   *    （free > other > labels，web `:71-85`）。
   */
  private setAskFree(qid: string, v: string): void {
    const next: AskSelection[] = [];
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      const copy: AskSelection = new AskSelection();
      copy.qid = s.qid;
      copy.labels = s.labels;
      copy.other = s.other;
      copy.free = s.qid === qid ? v : s.free;
      next.push(copy);
    }
    this.askSelections = next;
  }

  /** 读某题的「其他」文本（组件 `readOther` 回调；找不到 ⇒ 空串）。 */
  private askOtherOf(qid: string): string {
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      if (s.qid === qid) {
        return s.other;
      }
    }
    return '';
  }

  /** 读某题的自由文本（组件 `readFree` 回调；找不到 ⇒ 空串）。 */
  private askFreeOf(qid: string): string {
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      if (s.qid === qid) {
        return s.free;
      }
    }
    return '';
  }

  /** 当前答案（`mergeAskAnswers` 唯一真源；组件只消费，⛔ 不自己拼）。 */
  private askAnswers(): Record<string, string> {
    const inputs: AskAnswerInput[] = [];
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      inputs.push(new AskAnswerInput(s.labels, s.other, s.free));
    }
    return mergeAskAnswers(inputs);
  }

  /** 逐题「已答」标记（向导圆点 + 提交可用态；判据同源 `core/msgops`）。 */
  private askAnswered(): boolean[] {
    return askAnsweredFlags(this.askAnswers(), this.askSelections.length);
  }

  private async submitAsk(cancelled: boolean): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || this.askBusy) {
      return;
    }
    this.askBusy = true;
    try {
      const inputs: AskAnswerInput[] = [];
      for (let i = 0; i < this.askSelections.length; i++) {
        const s: AskSelection = this.askSelections[i];
        inputs.push(new AskAnswerInput(s.labels, s.other, s.free));
      }
      const answers: Record<string, string> = mergeAskAnswers(inputs);
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

  /**
   * 打开能力面板（`components/PluginsSheet` 的注入点）。
   *
   * ⭐ **三态（本波）**：先**立刻**显示面板 + 加载态，再拉目录 —— 旧实现是
   *   "关抽屉 → `await` 拉 RPC → 才显示"，慢网下用户**看不到任何反馈**（以为没反应）。
   *   失败**不吞**（旧 `store.listPlugins()` 把错误吞成空目录 ⇒ 面板分不清空/失败）。
   */
  private async openPlugins(): Promise<void> {
    // 浮层互斥：能力面板由抽屉进入 ⇒ 先收抽屉（同一时刻只允许一个半屏/全屏浮层；同 `openPanels`）
    this.showDrawer = false;
    this.pluginPanelError = '';
    this.pluginPanelLoading = true;
    const store0: ChatStore | null = this.store;
    // ⛔ 面板内任一「打开」都会载入同源 web 页面（`WebSurface`）⇒ 先把会话 cookie 注入 ArkWeb
    if (store0 !== null) {
      this.syncSessionCookieToWeb(store0);
    }
    this.anim(() => {
      this.showPlugins = true;
    });
    await this.loadPluginCatalog();
  }

  /**
   * 拉插件目录 → 投给能力面板（**不吞错**：失败 ⇒ 可读化后交面板显示 + 可重试）。
   *
   * 为什么在页面直接发 RPC 而不用 `store.listPlugins()`：后者 `catch` 后返回**空目录**
   * （`core/store.ets:loadPluginCatalog`）⇒ 面板无法区分"没有插件"与"加载失败"。
   * 页面直接调的写法与同文件既有能力（`set_goal`/`set_todos` 等）一致。
   */
  private async loadPluginCatalog(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      this.pluginPanelLoading = false;
      this.pluginPanelError = '尚未连接服务端';
      return;
    }
    this.pluginPanelLoading = true;
    try {
      const data: WebPluginListWire = await rpc<WebPluginListWire>(store.http, RPC_WEB_PLUGIN_LIST);
      const catalog: PluginCatalog = buildPluginCatalog(data, this.localeId(), store.http.baseUrl);
      this.plugins = catalog.items;
      this.pluginItems = catalog.items;
      this.pluginGroups = catalog.groups;
      this.pluginPanelError = '';
    } catch (e) {
      this.plugins = [];
      this.pluginItems = [];
      this.pluginGroups = [];
      this.pluginPanelError = readableRpcError((e as Error).message);
    } finally {
      this.pluginPanelLoading = false;
    }
  }

  /**
   * 插件桥 page→native 的业务消息（事件名 `xbot:bridge`，信封为 JSON 字符串）。
   *
   * ⛔ 只**记录**：`close`/`log`/`ready` 已在 `components/WebSurface` 内闭环（判据
   *    `core/webbridge.hostActionFor`）；未实现的 host 能力（call/notify 的 capability、
   *    `openExternal`、`resize`）**只记录、绝不回假 result**（回执是页面对
   *    `window.xbotNative.postMessage(信封串)` 的**同步返回值**，编造 = 对插件撒谎）。
   */
  private handleBridgeMessage(m: BridgeMessage): void {
    console.log(`[bridge] ${m.type} ${m.id} len=${m.payload.length}`);
  }

  /**
   * 顶栏**原生**「迭代指标」徽章文案（插件 `xbot.iteration-stats` 的 `status_bar_right` 视图）。
   *
   * ⭐ **原生渲染（不是把 web UI 塞进 WebView）** —— 数据**全部来自宿主自己**
   * （`ProgressSnapshot.streamStats` 的 `tokensPerSec`/`ttftMs`），与 web 侧该插件消费的
   * "实时指标桥"**同源**；判据逐字对齐插件产物（`tps<=0 ⇒ 不显示`），落在
   * `core/pluginviews.ets:iterStatsText`（纯逻辑，可脱机单测）。
   *
   * 启用判据 = **插件已安装且声明了该视图**（`hasIterStatsBadge(this.nativeCatalog)`）——
   * 没装就恒不渲染（不臆造一个 web 没有的东西）。
   *
   * ⛔ **本函数只做"算"，调用点必须在更新通路 `sync()` 里**（不得在 builder 内直调）——
   *    2026-10-12 真机实锤：它此前**直接在头部 builder 内被调用** ⇒ 头部只在
   *    `busy`/`currentChat`/`nativeCatalog` 变化时重渲，而 `busy` 在回合**开始**那一刻就
   *    置 true（此时 `stream_stats` 尚为 0）⇒ 之后指标有了**却没有重渲触发** ⇒ 徽章
   *    **恒为空**（真机实测：流式中全页 0 处 `t/s`，而 web 同期显示 `190t/s · 930ms`）。
   *    ⇒ 正解 = 投影成 `@State iterStatsBadge`（头部只读它）。
   */
  private computeIterStatsBadge(st: ChatStore | null): string {
    if (st === null || !hasIterStatsBadge(this.nativeCatalog)) {
      return '';
    }
    const ss = st.liveProgress().streamStats;
    if (ss === undefined || ss === null) {
      return '';
    }
    // `showTTFT` 默认 true（插件 `plugin.json` 的 configuration 默认值）。
    return iterStatsText(ss.tokensPerSec, ss.ttftMs, true);
  }

  /**
   * 打开**原生插件目录 + 宿主页**（`components/PluginHost` 的唯一注入点）。
   * 目录数据 = `store.loadPluginCatalog()`（服务端 `web_plugin_list` 元数据，零猜测）。
   * 宿主页 URL 用**独立的** `pluginPageUrl`（与页面级 `panelUrl` 分离）。
   */
  private async openPluginHost(): Promise<void> {
    // 浮层互斥：从抽屉/能力面板进入 ⇒ 先收它们
    this.showDrawer = false;
    this.showPlugins = false;
    this.panelUrl = '';
    this.pluginPageUrl = '';
    const store: ChatStore | null = this.store;
    // ⛔ 插件宿主页（`WebSurface` 载入的同源页面）**必须**先带上会话 cookie，否则 401（见 `syncSessionCookieToWeb`）
    if (store !== null) {
      this.syncSessionCookieToWeb(store);
    }
    this.showPluginHost = true;
    if (store === null) {
      return;
    }
    try {
      const catalog: PluginCatalog = await store.loadPluginCatalog(this.localeId());
      this.pluginItems = catalog.items;
      this.pluginGroups = catalog.groups;
    } catch (e) {
      // 目录非关键路径：失败留空目录（PluginHost 会显示"没有声明前端产物的插件"）
      this.toast(`插件目录加载失败: ${errText(e as Object)}`);
    }
  }

  /**
   * 打开 **web 插件管理面板**（抽屉「插件」的**权威入口**；用户 2026-10-14 定向）。
   *
   * ── 为什么以 web 的插件管理为中心 ──────────────────────────────────────────────
   * 用户原话：「我看你插件现在都是原生的？那岂不是全是定制逻辑？…我要求我们原生要支持所有 web
   *   插件…你应该支持渲染小 webview，然后代理一部分 web 原生的事件」。
   * 实测反证原生目录**必然漏**（本轮装机审计）：`xbot.genui` 在原生目录里显示「**0 个视图**」
   *   ⇒ 连「打开」按钮都没有；`迭代指标` 有 1 视图同样无入口 ⇒ 用户报的「统计插件面板看不到」。
   *   web 的插件管理（`web/src/plugins/manager/PluginManagerPanel.tsx`）按**插件自己声明的
   *   contributes** 渲染列表 + 启停/重载 ⇒ 原生零猜测、**未来插件自动可用**。
   * ⛔ 带 `xbot_embed=1`：语义统一为「插件入口一律 WebView 直渲」（将来若有人给这个 view 加原生
   *   落地，也不会把它从 webview 里偷走）。
   * ⛔ 内嵌 webview 载入同源页面**必须**先注入会话 cookie，否则 401 落登录页。
   */
  private openPluginManager(): void {
    this.showPlugins = false;
    this.showDrawer = false;
    this.panelUrl = '';
    const store: ChatStore | null = this.store;
    if (store !== null) {
      this.syncSessionCookieToWeb(store);
    }
    const url: string = pluginViewDeepLink(this.serverUrl, PLUGIN_MANAGER_VIEW_ID, '插件');
    if (url.length === 0) {
      this.toast('服务器地址未配置，无法打开插件管理');
      return;
    }
    this.panelTitle = '插件';
    this.panelUrl = embedPluginViewLink(url);
  }

  /**
   * 打开 **web 内置面板**（`?xbot_panel=<id>`；真源 `web/src/workspace/panelRequest.ts`）。
   *
   * §21.122c（用户定向）：「必须真的支持 web 的所有插件和功能…**终端和任务管理做的很差**」
   * ⇒ 原生的正确做法是把 **web 自己的面板**（`builtinPanels.tsx` 的 `core.*`）渲在 WebView 里
   * （与 web 逐字同源、能力自动跟随 web 演进）；而不是每个能力再写一套原生实现
   * （那套永远追不上 web、且必然与 web 分叉 —— `FilesSheet` 801 行就是前车之鉴）。
   * ⛔ 与插件视图同一条纪律：内嵌 webview 载入同源页面**必须先注入会话 cookie**，否则 401 落登录页。
   * ⛔ 白名单外/基地址空 ⇒ `webPanelDeepLink` 返回空串 ⇒ **什么都不开**（fail-closed，
   *    ⛔ 不渲染一个 web 端会忽略参数、看着像"点了没反应"的空白页）。
   */
  private openWebPanel(panelId: string): boolean {
    this.showDrawer = false;
    this.panelUrl = '';
    const store: ChatStore | null = this.store;
    if (store !== null) {
      this.syncSessionCookieToWeb(store);
    }
    const base: string = this.serverUrl.length > 0
      ? this.serverUrl
      : (store !== null ? store.http.baseUrl : '');
    const url: string = webPanelDeepLink(base, panelId);
    if (url.length === 0) {
      // ⛔ fail-closed：白名单外/基地址空 ⇒ **不开任何 WebView**，返回 `false` 让调用方**回落**
      //    到原生面板（§21.122e）。⛔ 不再在这里弹"服务器地址未配置" —— 每个调用点都有原生
      //    回落时，一条错误提示反而是噪音（原生面板已经把能力端上来了）。
      return false;
    }
    const title: string = webPanelTitle(panelId);
    this.panelTitle = title.length > 0 ? title : '面板';
    this.panelUrl = url;
    return true;
  }

  /**
   * 代理 **web 面板的导航意图**（§21.122f；真源 `web/src/workspace/hostBridge.ts:postHostNav`，
   * 判定在 `core/webbridge.ets:parseHostNavPayload` 这个纯函数里，这里只做副作用）。
   *
   * 用户原话：「这种嵌套 web view 应该**代理原 web 的导航事件**，并且去掉多余的 ui。然后
   *   **文件面板应该代理后触发原生 ui**」。
   *
   * 嵌入模式（`?xbot_embed=1`）下 web 只渲面板本体 ⇒ 面板里"用户想往外走"的动作没有 web 侧
   * 落点，必须由宿主接住。三类：
   *   · `title`    —— 面板自述标题 ⇒ 原生 chrome 标题跟随（用户不必看 web 自己再画一条标题）；
   *   · `ready`    —— 嵌入握手 ⇒ 记日志（**这是"嵌入真的生效"的唯一正向信号**：线上产物陈旧/
   *                   参数被丢时它不会到达 ⇒ 用 hilog 一眼分辨"面板没开"还是"开了但没嵌对"）；
   *   · `openFile` —— 在 web 文件面板里点了文件 ⇒ **触发原生 UI**：关掉 web 面板、开原生文件面板
   *                   并直接落到该文件的预览（复用 `openFsFile` 这唯一预览出口，⛔ 不再在
   *                   WebView 里再开一个 web 编辑器 —— 那等于把"嵌套 webview"再套一层）。
   */
  private handleHostNav(ev: HostNavEvent): void {
    if (ev.kind === HOST_NAV_TITLE) {
      if (ev.text.length > 0) {
        this.panelTitle = ev.text;
      }
      return;
    }
    if (ev.kind === HOST_NAV_READY) {
      hilog.info(0x0000, 'XBOT-PANEL', 'embed ready: %{public}s', ev.text);
      return;
    }
    if (ev.kind === HOST_NAV_OPEN_FILE) {
      if (ev.text.length === 0) {
        return;
      }
      // 原生 UI 占全屏 ⇒ 先收掉 web 面板（否则两层面板叠着，退回时用户会看到旧 web 页）。
      this.panelUrl = '';
      this.openFiles();
      // kind 由**同一判据** `fileKindOf` 推导（⛔ 组件/代理处不另判后缀）。
      this.openFsFile(ev.text, fileKindOf(baseNameOf(ev.text), false));
      return;
    }
  }

  /**
   * 打开 **GenUI（`display_html`）面板** —— 按需建分享 + 落 `WebSurface` URL。
   *
   * ── 为什么这样（完整依据见 `core/genui.ets` 头注释）────────────────────────────
   * 面板是 LLM 生成的 **TSX**，ArkTS 禁动态求值 ⇒ 原生**不执行**它。与 web 一致的唯一落地：
   * 把源码交给 web **自己的** shareRenderer（`xbot.genui` 插件注册的 `xbot.genui/tsx`）
   * 在 ArkWeb 里渲染 —— 且**只渲染这个面板**（SPA `/s/<token>` 路由，不是整个聊天应用；
   * 用户明确否掉过「整屏变成 web 版的完整聊天应用」）。
   * ⛔ 分享**按需创建**（点开才建）：不在渲染路径里发请求（分层铁律），也不给用户留垃圾分享。
   */
  private async openGenuiPanel(code: string, title: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || code.length === 0) {
      return;
    }
    if (genuiPayloadTooLarge(code)) {
      this.toast('面板过大，无法打开');
      return;
    }
    // 内嵌 webview 打开**服务端页面**前必须注入会话 cookie，否则 401 落登录页
    // （与插件面板同因，见 `syncSessionCookieToWeb`）。
    this.syncSessionCookieToWeb(store);
    try {
      const url: string = await store.shareGenuiPanel(code, title);
      if (url.length === 0) {
        this.toast('面板链接生成失败');
        return;
      }
      // 浮层互斥：收掉其它浮层，再落 `panelUrl`（WebSurface 由既有分支渲染）。
      this.showPlugins = false;
      this.showPluginHost = false;
      this.showDrawer = false;
      this.panelTitle = title.length > 0 ? title : '交互式面板';
      this.panelUrl = url;
    } catch (e) {
      this.toast(`打开面板失败: ${errText(e as Object)}`);
    }
  }

  /**
   * GenUI 面板「分享」chip 的实现（web `genui/index.tsx:129-151` ShareablePanel.onShare 对等物）——
   * 复用既有建分享链（`shareGenuiPanel`：`POST /api/share/create` → `<host>/s/<token>`）。
   * 失败**吞成空串**（卡片自落 error 态『分享失败，重试』可重选；页面不另弹 toast——卡片文案即反馈）。
   * 复制进系统剪贴板归卡片（`GenuiPanelCard.shareClicked` 内 pasteboard 直写，
   * 与 `MarkdownView` 复制同 idiom）。**只建 URL 不落 WebSurface**（分享 = 拿链接转发朋友，
   * 与 onOpen 的"本机打开面板"是两个动作）。
   */
  private async shareGenuiLink(code: string, title: string): Promise<string> {
    const store: ChatStore | null = this.store;
    if (store === null || code.length === 0) {
      return '';
    }
    if (genuiPayloadTooLarge(code)) {
      return '';
    }
    try {
      return await store.shareGenuiPanel(code, title);
    } catch (e) {
      return '';
    }
  }

  /**
   * 插件视图深链导航 → 原生面板路由（「插件视图导航拦截协议」的路由端）。
   * WebSurface 的 `onLoadIntercept` 拦截到 `?xbot_view=<viewId>[&xbot_view_params=<json>]`
   * 深链后回调这里。`params` = 深链参数（如 git commit 的 `{ hash }`）。
   * ⛔ 只做一件事：按 `nativeViewKind(viewId)` 打开对应原生面板（无原生落地 ⇒ 不会进来）。
   * ⚠️ 协议本身通用（任何插件视图都能走深链），这里只是"原生落地注册表"的分发。
   */
  private routePluginView(viewId: string, title: string, url: string, params: Record<string, string>): void {
    const kind: string = nativeViewKind(viewId);
    if (kind === 'git.panel' || kind === 'git.commit') {
      // 先关插件宿主浮层（若拦截发生在宿主页里），再开原生 Git 面板
      // （openGitPanel 内部再收抽屉/能力面板/panelUrl）。
      this.showPluginHost = false;
      // commit 视图（dynamic，带 hash 参数）⇒ 精确打开那一个 commit 详情；
      // 其余（panel）/ 无 hash ⇒ 默认列表。
      const hash: string = params['hash'] || '';
      if (kind === 'git.commit' && hash.length > 0) {
        this.openGitCommit(hash);
      } else {
        this.openGitPanel();
      }
    } else if (kind === 'ssh.panel') {
      // 远程机器（web 内置插件 `xbot.ssh-runner`）：先关插件宿主浮层，再开原生面板。
      this.showPluginHost = false;
      this.openSshPanel();
    }
    // 未来新插件的原生落地：往 nativeViewKind 注册 + 这里加一条分支。
  }

  // ── 原生「远程机器」面板（web 内置插件 `xbot.ssh-runner` 的落地，§21.117）─────────
  // 与 Git 面板同因：web 侧插件 view **没有静态 URL 入口** ⇒ 未原生化就只会落到
  // **整个 web 宿主页**（用户明确否掉的形态）。数据面 = 宿主 RPC（`web_plugin_rpc` +
  // 核心 `runner_*`），解析/判据全在 `core/sshrunner.ets`；组件**自持**交互状态
  // （同 `TerminalSheet` 先例）⇒ 页面只提供 RPC 通道与会话身份。

  /** 打开原生「远程机器」面板（浮层互斥：从抽屉/能力面板进来先收它们）。 */
  private openSshPanel(): void {
    this.showDrawer = false;
    this.showPlugins = false;
    this.panelUrl = '';
    this.showSsh = true;
  }

  private closeSshPanel(): void {
    this.showSsh = false;
  }

  /** 面板用的宿主 RPC 通道（`rpc<Object>` 的薄封装 —— 组件不 import store）。 */
  private sshRpc(): (method: string, params: Object) => Promise<Object> {
    const st: ChatStore | null = this.store;
    return (method: string, params: Object): Promise<Object> => {
      if (st === null) {
        return Promise.reject(new Error('尚未连接服务端'));
      }
      return rpc<Object>(st.http, method, params);
    };
  }

  // ── 原生 Git 面板（web 内置插件 `xbot.git-fancy` 的落地）────────────────────────
  // 为什么原生化：web 侧插件 view **没有静态 URL 入口**（只能经 `ctx.ui.openViewTab`），
  // 原生壳没有 React 宿主 ⇒ 点插件行只能落到 web 根页（聊天页）——用户「插件都打不开」。
  // 数据面 = 宿主 RPC（`web_plugin_rpc` → `xbot.git-fancy.*`），解析/判据在 `core/gitpanel.ets`。

  /** 打开原生 Git 面板（浮层互斥：从抽屉/能力面板进来先收它们）+ 首次取数。 */
  private openGitPanel(): void {
    this.showDrawer = false;
    this.showPlugins = false;
    this.panelUrl = '';
    this.showGit = true;
    this.gitMode = 'list';
    this.loadGitPanel();
  }

  /** 关闭（并复位形态：否则下次进来还停在某个 diff 上，用户会以为面板坏了）。 */
  private closeGitPanel(): void {
    this.showGit = false;
    this.gitMode = 'list';
  }

  /** 详情形态 → 列表。 */
  private gitBackToList(): void {
    this.gitMode = 'list';
  }

  /**
   * 取数：工作区状态 + 首页提交（**顺序两路**，失败即可读化 ⇒ 面板显示原因 + 可重试）。
   * ⛔ 不吞错（同统计面板的教训）：错误落在 `gitError`，面板里画出来。
   */
  private async loadGitPanel(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      this.gitStatus = new GitStatus();
      this.gitLog = new GitLog();
      this.gitError = '尚未连接服务端';
      return;
    }
    this.gitLoading = true;
    this.gitError = '';
    try {
      const st: GitStatusWire = await rpc<GitStatusWire>(store.http, RPC_WEB_PLUGIN,
        new WebPluginRpcParams(gitMethod('status'),
          new GitChatParams(store.channel, store.wireChatId())));
      this.gitStatus = parseGitStatus(st);
      const lg: GitLogWire = await rpc<GitLogWire>(store.http, RPC_WEB_PLUGIN,
        new WebPluginRpcParams(gitMethod('log'),
          new GitLogParams(store.channel, store.wireChatId(), GIT_LOG_PAGE, 0)));
      this.gitLog = parseGitLog(lg);
    } catch (e) {
      this.gitError = readableRpcError((e as Error).message);
    } finally {
      this.gitLoading = false;
    }
  }

  /** 「加载更多」：`skip` = 已取条数，取下一页并**按 hash 去重合并**（⛔ 不去重 ⇒ 重复行 + 键冲突）。 */
  private async loadMoreGitLog(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || this.gitLogLoading || !hasMoreGitLog(this.gitLog)) {
      return;
    }
    this.gitLogLoading = true;
    try {
      const page: GitLogWire = await rpc<GitLogWire>(store.http, RPC_WEB_PLUGIN,
        new WebPluginRpcParams(gitMethod('log'),
          new GitLogParams(store.channel, store.wireChatId(), GIT_LOG_PAGE, this.gitLog.commits.length)));
      this.gitLog = mergeGitLog(this.gitLog, parseGitLog(page));
    } catch (e) {
      this.gitError = readableRpcError((e as Error).message);
    } finally {
      this.gitLogLoading = false;
    }
  }

  /** 打开某文件的 diff（`commit` 非空 ⇒ 该提交作用域；空 ⇒ 工作区 vs HEAD）。 */
  private async openGitDiff(path: string, commit: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.gitMode = 'diff';
    this.gitDiffPath = path;
    this.gitDiffFromCommit = commit;
    this.gitDiffText = '';
    this.gitDiffAdds = 0;
    this.gitDiffDels = 0;
    this.gitDiffLoading = true;
    try {
      const d: GitDiffWire = await rpc<GitDiffWire>(store.http, RPC_WEB_PLUGIN,
        new WebPluginRpcParams(gitMethod('diff'),
          new GitDiffParams(store.channel, store.wireChatId(), path, commit)));
      const parsed: GitDiffData = parseGitDiff(d);
      this.gitDiffText = parsed.diffText;
      this.gitDiffAdds = parsed.adds;
      this.gitDiffDels = parsed.dels;
    } catch (e) {
      this.gitError = readableRpcError((e as Error).message);
    } finally {
      this.gitDiffLoading = false;
    }
  }

  /** 打开某提交的详情（作者/时间/信息全文 + 该提交内文件；点文件再进 diff）。 */
  private async openGitCommit(hash: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.gitMode = 'commit';
    this.gitCommitMeta = '';
    this.gitCommitMessage = '';
    this.gitCommitFiles = [];
    this.gitLoading = true;
    try {
      const c: GitCommitDetailWire = await rpc<GitCommitDetailWire>(store.http, RPC_WEB_PLUGIN,
        new WebPluginRpcParams(gitMethod('commit'),
          new GitCommitParams(store.channel, store.wireChatId(), hash)));
      const parsed: GitCommitDetail = parseGitCommit(c);
      this.gitCommitMeta = gitCommitMetaText(parsed);
      this.gitCommitMessage = parsed.message;
      this.gitCommitFiles = parsed.files;
    } catch (e) {
      this.gitError = readableRpcError((e as Error).message);
    } finally {
      this.gitLoading = false;
    }
  }

  /**
   * 打开**会话统计面板**（内置插件 `xbot.session-stats` 的原生落地）。
   *
   * 为什么是"内置入口"而不是从 `web_plugin_list` 取：该插件在 web 是随**主包**打包的
   * `builtinViews`（`web/src/plugin-runtime/usePluginRuntimeHost.ts:112`），不在磁盘插件目录
   * ⇒ 服务端从不下发它（实测只回 4 条磁盘插件）⇒ 原生必须自己给它一个入口，否则用户
   * 「统计插件的面板我们看不到」（用户原话）。
   *
   * 浮层互斥：从能力面板/抽屉进入 ⇒ 先收它们（同一时刻只允许一个半屏/全屏浮层）。
   */
  private openSessionStats(): void {
    this.showDrawer = false;
    this.showPlugins = false;
    this.dismissKeyboard();
    this.anim(() => {
      this.showSessionStats = true;
    });
    this.loadSessionStats();
  }

  /**
   * 拉会话用量统计 → 投给统计面板（**不吞错**：失败可读化后交面板显示 + 可重试）。
   *
   * 四路数据（**逐字对齐 web 面板** `SessionStatsPanel.tsx` + `TokenTrendSection.tsx`）：
   *   ① `get_session_usage_stats`（会话聚合；失败 ⇒ 面板显示错误 + 可重试）
   *   ② `get_user_token_usage`（用户累计）    ┐
   *   ③ `get_daily_token_usage`（按日明细）   ├ **尽力而为**：单路失败只清该块，
   *   ④ `get_session_usage_buckets`（趋势桶） ┘ 不拖垮整页（旧后端可能没有某一路 RPC）。
   * 判据/格式化全在 `core/sessionstats.ets`（纯逻辑）；页面只负责取数与所有权。
   *
   * ⛔ 在飞守卫：忙时**排队**（`statsRefreshQueued`）而不是丢弃 —— §21.49 的"请求被静默吞掉"同族缺陷。
   */
  private async loadSessionStats(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      this.sessUsage = new SessionUsage();
      this.statsUser = new UserUsage();
      this.statsDaily = [];
      this.statsBuckets = [];
      this.sessionStatsError = '尚未连接服务端';
      this.sessionStatsLoading = false;
      return;
    }
    if (this.statsBusy) {
      this.statsRefreshQueued = true;
      return;
    }
    this.statsBusy = true;
    this.sessionStatsLoading = true;
    try {
      const wire: SessionUsageWire = await rpc<SessionUsageWire>(
        store.http, RPC_GET_SESSION_USAGE_STATS,
        new SessionUsageStatsParams(store.channel, store.wireChatId(), 500));
      this.sessUsage = parseSessionUsage(wire);
      this.sessionStatsError = '';
    } catch (e) {
      this.sessUsage = new SessionUsage();
      this.sessionStatsError = readableRpcError((e as Error).message);
    } finally {
      // ①②③④ 各自 try/catch ⇒ 这里只收尾（清 busy + 消费排队）。
      this.statsBusy = false;
      this.sessionStatsLoading = false;
      const again: boolean = this.statsRefreshQueued;
      this.statsRefreshQueued = false;
      if (again) {
        this.loadSessionStats();
        return;
      }
    }
    await this.loadStatsAux();
  }

  /** 用户累计 / 按日 / 趋势桶（三路**尽力而为**；任一路失败只清该块）。 */
  private async loadStatsAux(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      const u: UserUsageWire = await rpc<UserUsageWire>(
        store.http, RPC_GET_USER_TOKEN_USAGE, new EmptyParams());
      this.statsUser = parseUserUsage(u);
    } catch (e) {
      this.statsUser = new UserUsage();
    }
    try {
      const d: DailyUsageWire[] = await rpc<DailyUsageWire[]>(
        store.http, RPC_GET_DAILY_TOKEN_USAGE, new DailyUsageParams(DAILY_DAYS_WINDOW));
      this.statsDaily = parseDailyUsage(d);
    } catch (e) {
      this.statsDaily = [];
    }
    await this.reloadStatsBuckets();
  }

  /** 只重拉趋势桶（切换粒度时不惊动其余三路）。 */
  private async reloadStatsBuckets(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    const g: string = this.statsGranularity;
    try {
      const b: UsageBucketWire[] = await rpc<UsageBucketWire[]>(
        store.http, RPC_GET_SESSION_USAGE_BUCKETS,
        new SessionUsageBucketsParams(store.channel, store.wireChatId(), g,
          bucketRequestCount(g), tzOffsetMinutesFor(new Date().getTimezoneOffset())));
      this.statsBuckets = parseBuckets(b);
    } catch (e) {
      this.statsBuckets = [];
    }
  }

  /** 切换趋势粒度（分段控件回调）—— 只换 `statsGranularity` 并重拉桶。 */
  private async setStatsGranularity(g: string): Promise<void> {
    if (g === this.statsGranularity) {
      return;
    }
    this.statsGranularity = g;
    await this.reloadStatsBuckets();
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
      } else if (this.useWebUI && this.webUiUrl.length > 0) {
        // ArkWeb 承载完整 web UI（设置里可切换；右下角按钮一键切回原生）
        Stack() {
          WebSurface({ url: this.webUiUrl, theme: this.themeName, chrome: false, sessionCookie: this.cookie, onBridgeMessage: (m: BridgeMessage) => {
            this.handleBridgeMessage(m);
          }, onOpenView: (viewId: string, title: string, url: string, params: Record<string, string>) => {
            this.routePluginView(viewId, title, url, params);
          }, onOpenExternal: (url: string) => {
            // §21.122b：`target="_blank"`/`window.open` 的外链 ⇒ 交系统浏览器（与原生消息里的
            // 链接**同一出口** `openUrl` ⇒ 协议白名单/失败提示只有一份）。
            this.openUrl(url);
          }, onClipboardWrite: (text: string) => {
            // §21.122d：页面「复制」⇒ 宿主代写系统剪贴板（非 secure context 下浏览器不给
            // `navigator.clipboard`；web 侧 9+ 处复制此前**全部静默失效**）。
            // ⛔ 复用既有唯一出口 `copyText`（含 fail 提示 + toast），不另写一套。
            this.copyText(text, '');
          }, onDownloadDone: (name: string, path: string) => {
            // §21.122d 余项：页面下载完成 ⇒ 给用户可见反馈（⛔ 不假装成功：路径一并记日志，
            // 应用沙箱内的落盘位置可 `hdc file recv` 核对）。沙箱导出/分享出口见 TODO。
            hilog.info(0x0000, 'XBOT-DL', 'downloaded %{public}s -> %{public}s', name, path);
            this.toast(`已下载 ${name}`);
          }, onClose: () => {
          } })
          Text('切回原生')
            .fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary)
            .padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(RADIUS_PILL)
            .margin({ left: SPACE_XS, top: SPACE_XS })
            .onClick(() => {
              this.setSurface(false);
            })
        }
        .width('100%').height('100%')
        .alignContent(Alignment.TopStart)
      } else {
        this.ChatView()
      }

      // ── 模态遮罩（**单一真源**：`core/overlays.hasOverlay`）───────────────────────────────
      // 为什么必须**只此一层**（2026-10-13 真机取证）：
      //   此前**每个浮层各自的点击捕获层都是完全透明**的（`Row(){Blank()}.width('100%')
      //   .height('100%').onClick(close)`，**没有 backgroundColor**），只有抽屉那一处恰好带了
      //   scrim ⇒ 两个后果（用户可见）：
      //     ① **观感故障**：页面内容在 sheet 卡片边缘露出半截字形。实测铁证 —— 终端 sheet 打开时
      //        卡片左缘 x=53，而**页面**底部状态行 `deepseek-flash · /Users/bobli` 从 x=33 起
      //        ⇒ 首字母 `d` 的左半截从卡片左侧露出来（BMP 逐像素：y≈2468、x≈52、`#9e9fa9`）。
      //        我一开始误判成"终端溢出"（终端井底 y=1914，差着 550px），`dumpLayout` 才定住真凶。
      //     ② **模态感缺失**：背后页面看起来还能点（实际被捕获层拦住 ⇒ 承诺与事实不符）。
      //   ⇒ 收敛成一层：任何浮层打开就压暗（`core/overlays.hasOverlay` 已是既有的单一真源，
      //      抽屉也算在内 ⇒ 顺手删掉抽屉自己那层 scrim，避免叠成双倍黑）。
      // ⛔ 位置敏感：必须在**所有浮层声明之前**（ArkUI Stack 后声明者在上）⇒ 它盖住页面与内嵌
      //    WebSurface，又被每个浮层自己的捕获层盖住（捕获层保持透明、继续负责点击收起）。
      // ⛔ 只加**一处** `eff()` 调用（`eff()` 预算 80，现值 27）—— 若改成逐浮层加色则要 +12 处。
      if (this.anyModalOpen()) {
        Row()
          .width('100%').height('100%')
          .backgroundColor(this.eff().elev2)
          // 纯淡入淡出（与抽屉横向滑入 / sheet 上浮同起同止）—— 走底座 `fadeTransition()`。
          .transition(fadeTransition())
      }

      // 会话抽屉（左侧滑出）：点击遮罩收起（对齐 web backdrop 语义）。
      // scrim 颜色 = 上面那层统一遮罩（取调色板派生 token `eff().elev2`：深色系 = 中性黑@32%、
      // 浅色系 = 正文色@10%，与 Apple 侧栏 scrim 同量级；浅色主题自动更淡）——**不引入任何 hex
      // 字面量**，也不按主题名硬判（`effectsOf` 内部用 `isLightPalette` 亮度口径，新增主题自动成立）。
      if (this.showDrawer) {
        Stack() {
          Row() {
            Blank()
          }
          .width('100%').height('100%')
          .onClick(() => {
            this.closeDrawer();
          })
          this.DrawerSheet()
        }
        .width('100%').height('100%')
      }
      // 新建会话弹层（工作目录 + 最近目录候选）—— web `NewSessionDialog` 的等价落点。
      // 底部 sheet，容器同既有 QueueSheet/PluginsSheet（scrim 点击收起 + 内容上浮过渡）。
      if (this.showNewSession) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.closeNewSession();
          })
          this.NewSessionSheet()
        }.width('100%').height('100%')
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：新建会话有 **2 个输入框**（名称 / 工作目录）且是
        // **底部 sheet** ⇒ 键盘弹起时整张 sheet 在最底、被完全盖住（浮层内输入框 ⇒ 系统避让不生效）
        // ⇒ 按键盘高度收缩可用区，sheet 整体**浮到键盘上方**。
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 队列
      if (this.showQueue) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showQueue = false;
          })
          // 待发队列（P2 抽出：components/QueueSheet.ets）——store 动作走回调，flag 留页面。
          QueueSheet({
            theme: this.themeName,
            queue: this.queue,
            onClear: () => {
              this.store?.clearQueue();
            },
            onMove: (id: string, delta: number) => {
              this.store?.moveQueued(id, delta);
            },
            onInterject: (id: string, full: string) => {
              this.store?.interjectQueued(id, full);
            },
            onCancel: (id: string) => {
              this.store?.cancelQueued(id);
            },
            onClose: () => {
              this.showQueue = false;
            },
          })
        }.width('100%').height('100%')
      }
      // 插件面板选择
      if (this.showPlugins) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showPlugins = false;
          })
          // 能力面板（P2 抽出：components/PluginsSheet.ets）——panelUrl/showPlugins 留页面。
          PluginsSheet({
            theme: this.themeName,
            plugins: this.plugins,
            groupCount: this.pluginGroups.length,
            loading: this.pluginPanelLoading,
            error: this.pluginPanelError,
            onOpenPluginHost: () => {
              this.openPluginHost();
            },
            onOpenWebUi: () => {
              this.showPlugins = false;
              this.panelTitle = '完整 Web UI';
              this.panelUrl = this.serverUrl;
            },
            onOpenSessionStats: () => {
              this.openSessionStats();
            },
            onOpenSkills: () => {
              this.showPlugins = false;
              this.openSkills();
            },
            onOpenGit: () => {
              this.openGitPanel();
            },
            onOpenPlugin: (p: PluginCatalogItem) => {
              this.showPlugins = false;
              // ⛔ 内嵌 webview 打开**服务端页面**前必须注入会话 cookie，否则 401 落登录页
              //    （2026-10-12 真机实测过：那正是「插件都打不开」的客户端侧根因之一）。
              const st: ChatStore | null = this.store;
              if (st !== null) {
                this.syncSessionCookieToWeb(st);
              }
              // ── **通用**打开（零插件特判，判据在 `core/pluginhost.ets:pluginOpenTarget`）────
              // 数据来自插件自己声明的 view 贡献点（`contributes.views`）⇒ 以后 web 新加的任何
              // 插件（内置/第三方）都自动可打开，宿主零改动。深链由 web 侧唯一入口
              // `pluginViewRequest.ts` 消费（`?xbot_view=<viewId>`）。
              // ⛔ 与本页"插件目录"那条路径**同一个纯函数** ⇒ 两处不可能再分叉（真机实证过的分叉：
              //    目录那条曾直接载入 `openUrl` = host 根页 = 聊天页 ⇒「跑回主界面」）。
              const target: PluginOpenTarget = pluginOpenTarget(p, this.serverUrl);
              if (target.url.length > 0) {
                // ── §21.122（用户 2026-10-14 定向）：插件视图**一律 WebView 直渲** ───────────────
                // 原实现：有原生落地的视图**直开原生面板**（省一次 WebSurface 装载）。用户明确否掉
                //   这条路线 ——「插件都做成原生 ⇒ 全是定制逻辑，追不上『支持所有 web 插件』」。
                // 现实现：插件内容（插件自带 UI，与 web 逐字同源）在 WebView 里渲染；原生只做
                //   **外壳 chrome + 事件代理**（见 `docs/WEB-PARITY.md`）。`xbot_embed=1` 让
                //   `onLoadIntercept` **让路**（否则同一 viewId 又会被拦回原生面板）。
                // ⛔ 原生落地（Git/SSH 面板）保留为**可选增强**，由能力面板里的固定入口直开
                //   （`onOpenGit` 等）—— 与插件目录这条路分离，两条路不再互相偷走对方的打开动作。
                this.panelTitle = target.title;
                this.panelUrl = embedPluginViewLink(target.url);
                return;
              }
              // 没有任何 view 贡献点（如 `xbot.genui` 由宿主内联渲染）⇒ 回落既有行为（web 根页）。
              this.panelTitle = p.name.length > 0 ? p.name : '插件';
              this.panelUrl = p.url;
            },
            onOpenPluginManager: () => {
              this.openPluginManager();
            },
            onRetry: () => {
              // 重试拉目录（失败态里那颗「重试」按钮）——判据/三态由 `loadPluginCatalog` 统一驱动
              this.loadPluginCatalog();
            },
            onClose: () => {
              this.showPlugins = false;
            },
          })
        }.width('100%').height('100%')
      }
      // 文件管理（P2 抽出：components/FilesSheet.ets）——showFiles/目录/预览全留页面。
      if (this.showFiles) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showFiles = false;
          })
          FilesSheet({
            theme: this.themeName,
            path: this.fmDir,
            entries: this.fmEntries,
            loading: this.fsLoading,
            error: this.fsError,
            previewPath: this.fsPreviewPath,
            previewText: this.fsPreviewText,
            previewLanguage: this.fsPreviewLanguage,
            previewNotice: this.fsPreviewNotice,
            previewLoading: this.fsPreviewLoading,
            previewIsImage: this.fsPreviewIsImage,
            previewImageUrl: this.fsPreviewImageUrl,
            mdTheme: this.mdThemeId(),
            loadImageBytes: (src: string) => {
              return this.loadImageBytes(src);
            },
            onNavigate: (dir: string) => {
              this.loadFsDir(dir);
            },
            onOpenFile: (f: string, k: string) => {
              this.openFsFile(f, k);
            },
            onCopyPath: (f: string) => {
              this.copyFsPath(f);
            },
            onAddToChat: (f: string) => {
              this.addFsToChat(f);
            },
            onClosePreview: () => {
              this.closeFsPreview();
            },
            // P1-1（2026-10-14）：文件面板预览大图点按 ⇒ 全屏查看器（`Lightbox`）——
            // 与聊天图片同一条 `openImage` 通道（:4737 装载 `imagePixel` + 开壳）。
            onOpenImage: (url: string) => {
              void this.openImage(url);
            },
            onRefresh: () => {
              this.loadFsDir(this.fmDir);
            },
            // §21.122bu：**移除**面板内「用 web 文件面板打开」次级入口 —— 用户定向
            // 「一个页面必须只有一个形态，别入口不同展示的不同」⇒ 文件面只保留原生一套
            // （原生是超集：浏览/搜索/预览/加入聊天；web 版此前只是"能力不减"的双开）。
            searching: this.fsSearchActive,
            searchQuery: this.fsSearchQuery,
            searchItems: this.fsSearchItems,
            searchLoading: this.fsSearchLoading,
            searchError: this.fsSearchError,
            onSearch: (q: string) => {
              this.runFsSearch(q);
            },
            onExitSearch: () => {
              this.exitFsSearch();
            },
            showHidden: this.fsShowHidden,
            onToggleHidden: () => {
              this.fsShowHidden = !this.fsShowHidden;
              this.loadFsDir(this.fmDir);
            },
            onClose: () => {
              this.showFiles = false;
            },
          })
        }.width('100%').height('100%')
      }
      // 技能管理（目标④：web 的 `xbot.skill-manager` 插件面板 ⇒ 原生落地）——showSkills/列表全留页面。
      if (this.showSkills) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showSkills = false;
          })
          SkillsSheet({
            theme: this.themeName,
            loading: this.skillsLoading,
            error: this.skillsError,
            items: this.skills,
            viewName: this.skillViewName,
            viewText: this.skillViewText,
            viewLoading: this.skillViewLoading,
            mdTheme: this.mdThemeId(),
            fontScale: this.fontScale(),
            wrapCode: this.wrapCode(),
            onToggle: (name: string, on: boolean) => {
              void this.toggleSkill(name, on);
            },
            onOpen: (it: SkillItem) => {
              void this.openSkillView(it);
            },
            onClosePreview: () => {
              this.closeSkillView();
            },
            onRefresh: () => {
              void this.loadSkills();
            },
            onClose: () => {
              this.showSkills = false;
              this.closeSkillView();
            },
          })
        }.width('100%').height('100%')
      }
      // 会话统计面板（内置插件 `xbot.session-stats` 的原生落地）——数据/所有权留页面。
      if (this.showSessionStats) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showSessionStats = false;
          })
          SessionStatsSheet({
            theme: this.themeName,
            stats: this.sessUsage,
            user: this.statsUser,
            daily: this.statsDaily,
            buckets: this.statsBuckets,
            granularity: this.statsGranularity,
            loading: this.sessionStatsLoading,
            error: this.sessionStatsError,
            onGranularity: (g: string) => {
              this.setStatsGranularity(g);
            },
            onRetry: () => {
              this.loadSessionStats();
            },
            onClose: () => {
              this.showSessionStats = false;
            },
          })
        }.width('100%').height('100%')
      }
      // AskUser（服务端权威：有 pending 就弹；P2-3 抽出：components/AskUserSheet.ets）
      if (this.askUser !== null) {
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：AskUser 卡是**居中**的（`SHEET_WIDTH` + 内容高），
        // 键盘弹起时其底部（「其它」输入框 / 提交按钮）会被系统避让**漏掉**（浮层内输入框）⇒ 被盖住。
        // 这里收缩可用区 ⇒ 卡片整体上移。⛔ 包一层全屏 `Stack` **不改变层级语义**：原实现就是根
        // `Stack` 的直系子节点、同为核心居中。
        Stack() {
          AskUserSheet({
            theme: this.themeName,
            questions: this.askUser !== null && this.askUser.questions !== undefined ? this.askUser.questions : [],
            busy: this.askBusy,
            // 派生入参（⛔ 判据同源 `core/msgops`，组件不自造第二套）
            answered: this.askAnswered(),
            allAnswered: askAllAnswered(this.askAnswered()),
            isSelected: (qid: string, label: string) => this.isAskSelected(qid, label),
            onToggleOption: (qid: string, label: string, multi: boolean) => {
              this.toggleAskOption(qid, label, multi);
            },
            setOther: (qid: string, v: string) => {
              this.setAskOther(qid, v);
            },
            readFree: (qid: string) => this.askFreeOf(qid),
            readOther: (qid: string) => this.askOtherOf(qid),
            setFree: (qid: string, v: string) => {
              this.setAskFree(qid, v);
            },
            onSubmit: (cancelled: boolean) => {
              this.submitAsk(cancelled);
            },
          })
        }
        .width('100%').height('100%')
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 渲染自检（逐构件隔离排查用）
      if (this.showSelfCheck) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showSelfCheck = false;
          })
          // 渲染自检（P2 抽出：components/SelfCheckSheet.ets）——取证文本在页面合成。
          SelfCheckSheet({
            theme: this.themeName,
            geoRunning: this.geoRunning,
            auditText: this.auditText(),
            onCollect: () => {
              this.collectAllGeometry();
            },
            onClose: () => {
              this.showSelfCheck = false;
            },
          })
        }.width('100%').height('100%')
      }
      // ⚠️ 三个「从运行面板里开出来的」详情层（后台任务 / 定时任务 / 终端）**刻意**渲染在
      //   `showPanels` 之后 —— ArkUI 的绘制顺序 = build 里的**先后**（后者盖前者）。
      //   ⛔ 2026-10-13 真机实证（本波）：这三层原先排在 `showPanels` **之前** ⇒ 点开「定时」详情后，
      //   运行面板（60% 底部 sheet）**盖住了详情卡的下半屏**（截图：详情只剩标题 + 消息块一半，
      //   「调度/下次运行/目标/ID」全被面板压住）。判据：`cron_detail.test.ts` ⑥q 钉**顺序**。
      // 会话状态（todos / goal / 用量 / cwd）
      if (this.showStatus) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showStatus = false;
          })
          // 会话状态面板（P1 抽出为组件：`components/StatusSheet.ets`）——判据仍在页面算，
          // 组件只吃算好的字符串 + 两个回调（弹层开关所有权留在页面，见 core/overlays.topOverlay）。
          StatusSheet({
            theme: this.themeName,
            goalLine: this.goalLine(),
            usageText: usageText(this.usage),
            modelName: this.currentModelName(),
            ctxText: this.ctxText(),
            cwd: this.cwd,
            // 会话信息补全（web `SessionInfo.tsx:48-49/174-176`）：身份字段直接读 store 权威值；
            // 缺失 ⇒ 空串 ⇒ 组件不显示该行（判据仍留本页，组件不算任何东西）。
            sessionId: this.store !== null ? this.store.currentChatId : '',
            channel: this.store !== null ? this.store.channel : '',
            lastActive: formatLastActive(this.currentLastActive()),
            // 订阅（web `SessionInfo.tsx:191-193` 的「订阅」行）：直接读 store 权威值（`get_session_subscription`
            // 的产物，`store.loadSessionSubscription` 落库）；空串 ⇒ 组件不显示该行（判据仍留 store/组件）。
            subscription: this.store !== null ? this.store.sessionSubscription : '',
            onClose: () => {
              this.showStatus = false;
            },
            onOpenModel: () => {
              this.anim(() => {
                this.showModel = true;
              });
              // 打开面板即走**既有取数入口**（与失败态「重试」同一个：`reloadModelList`）。
              this.reloadModelList();
              // 思考模式也在此刻读一次（web `ModelSelector` 打开时 `llmSettings.data.thinkingMode` 已在手）。
              void this.loadThinkingMode();
            },
            // 改工作路径：复用页面唯一的 `set_cwd` 写路径（`submitCwd` → `sendSetCwd`）。
            onSubmitCwd: (dir: string) => {
              this.submitCwd(dir);
            },
          })
        }.width('100%').height('100%')
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：状态面板内的「工作路径」输入框是**浮层内**输入框
        // ⇒ 系统避让不生效 ⇒ 按键盘高度收缩可用区（面板随之整体上移）。
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 模型 / 上下文上限选择栏
      if (this.showModel) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showModel = false;
          })
          this.ModelSheet()
        }.width('100%').height('100%')
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：模型栏底部有「上下文上限」手输框（浮层内输入框
        // ⇒ 系统避让不生效）⇒ 按键盘高度收缩可用区（栏随之整体上移，输入行不被盖）。
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 面板（定时任务 / 后台任务 / 子代理 / Runner）
      if (this.showPanels) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.showPanels = false;
          })
          this.PanelsSheet()
        }.width('100%').height('100%')
        // ⛔ 这里**不加**键盘让位（与本仓"不许死消费"纪律一致）：`PanelsSheet` 切片内
        //    `TextInput|TextArea` 命中 **0** 处（终端 tab 只有列表 + 「＋ 新建」按钮，
        //    真正的输入行在 `TerminalSheet`）⇒ 面板**不可能**与软键盘共存（开面板时
        //    `openPanels()` 已先收键盘）⇒ 加了就是**不可达的死代码**。终端那层已单独处理。
      }
      // ── 运行面板**之上**的三层详情（顺序敏感：后渲染者盖前者，⛔ 别往上挪）──────────
      // 后台任务详情（任务列表点行打开）——用户点名「任务管理做的很差」
      if (this.showTaskDetail) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showTaskDetail = false;
          })
          TaskDetailSheet({
            theme: this.themeName,
            title: this.taskDetailTitle,
            statusText: this.taskDetailStatus,
            metaText: this.taskDetailMeta,
            output: this.taskDetailOutput,
            running: this.taskDetailRunning,
            onKill: () => {
              this.killTaskDetail();
            },
            onClose: () => {
              this.showTaskDetail = false;
            },
          })
        }.width('100%').height('100%')
      }
      // 定时任务详情（定时 tab 点行打开）——web `TasksPanel.tsx:120-172` 的展开区对齐：
      // 「调度 / 下次运行 / 目标 / ID(+创建时间)」+ 消息全文（主行 `maxLines(1)` 看不到的那部分）。
      if (this.showCronDetail) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showCronDetail = false;
          })
          CronDetailSheet({
            theme: this.themeName,
            message: this.cronDetailMessage,
            schedule: this.cronDetailSchedule,
            nextText: this.cronDetailNext,
            targetText: this.cronDetailTarget,
            createdText: this.cronDetailCreated,
            idText: this.cronDetailId,
            onClose: () => {
              this.showCronDetail = false;
            },
          })
        }.width('100%').height('100%')
      }
      // 终端面板（运行面板 → 「终端」tab 点行/新建 打开）——用户点名「终端做的很差」
      if (this.showTerminal) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.showTerminal = false;
          })
          TerminalSheet({
            theme: this.themeName,
            tid: this.termTid,
            cwd: this.termCwd,
            baseUrl: this.termBaseUrl(),
            cookie: this.termCookie(),
            onClose: () => {
              this.showTerminal = false;
              // ⛔ 关闭面板 = 销毁 PTY（TerminalSheet.closeSelf 已发 `{"type":"close"}` ⇒ 服务端
              //    `web_pty.go:689` `backend.Close(streamID)`）⇒ 终端条目必须**同步移除**，否则列表残留
              //    "死终端"（PTY 已死，再点开 WS 连不上）。对齐 web `useTerminal.closeTerminal`：
              //    关 tab = 销毁后端 PTY + 从 store 移除 session（不留死条目）。
              void this.closeTerminal(this.termTid);
            },
            // 快赢 1：status 翻转上抛 ⇒ 列表行 tone/文案跟上（此前状态困 sheet 本地 ⇒ 恒灰点）。
            onStatus: (tid: string, st: string, code: number) => {
              this.terminalLive.set(tid, `${st}|${code}`);
            },
          })
        }.width('100%').height('100%')
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：终端 sheet 是 `.height('82%')` **居中**的，其底部
        // （命令行输入行）会在键盘弹起时被盖住 ⇒ 按键盘高度收缩可用区，sheet 随之整体上移。
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 原生 Git 面板（抽屉「插件」→ 点 `Git 面板` 行）—— web 内置插件 `xbot.git-fancy` 的落地。
      // ⚠️ **渲染顺序敏感**：必须在 `PanelsSheet()` 与三层详情**之后**（ArkUI 层级 = build 先后；
      //    见 15z13 的「详情被面板盖住」真缺陷）——⛔ 别往上挪。
      if (this.showGit) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.closeGitPanel();
          })
          GitPanelSheet({
            theme: this.themeName,
            loading: this.gitLoading,
            error: this.gitError,
            headline: gitHeadline(this.gitStatus),
            // 非仓库 ⇒ 组件**不渲染**「工作区变更 / 提交历史」分区骨架（对齐 web
            // `plugins/git-fancy/index.tsx:256`：非仓库时只渲染一句 notice）。
            isRepo: this.gitStatus.repo,
            branch: gitBranchText(this.gitStatus),
            aheadBehind: gitAheadBehindText(this.gitStatus),
            changes: this.gitStatus.changes,
            log: this.gitLog,
            logLoading: this.gitLogLoading,
            hasMore: hasMoreGitLog(this.gitLog),
            mode: this.gitMode,
            diffPath: this.gitDiffPath,
            diffText: this.gitDiffText,
            diffAdds: this.gitDiffAdds,
            diffDels: this.gitDiffDels,
            diffFromCommit: this.gitDiffFromCommit,
            diffLoading: this.gitDiffLoading,
            commitMeta: this.gitCommitMeta,
            commitMessage: this.gitCommitMessage,
            commitFiles: this.gitCommitFiles,
            onClose: () => {
              this.closeGitPanel();
            },
            onRefresh: () => {
              this.loadGitPanel();
            },
            onLoadMore: () => {
              this.loadMoreGitLog();
            },
            // 形态在**切换之前**读：commit 形态里点文件 ⇒ 该提交作用域的 diff。
            onOpenDiff: (path: string) => {
              this.openGitDiff(path, this.gitMode === 'commit' ? this.gitCommitHash : '');
            },
            onOpenCommit: (hash: string) => {
              this.openGitCommit(hash);
            },
            onBack: () => {
              this.gitBackToList();
            },
          })
        }.width('100%').height('100%')
      }
      // 原生「远程机器」面板（web 内置插件 `xbot.ssh-runner`）——⛔ 渲染顺序同 Git 面板：
      // 必须在各详情 sheet 之后（ArkUI 层级 = build 先后），别往上挪。
      if (this.showSsh) {
        Stack() {
          Row() {
            Blank()
          }.width('100%').height('100%').onClick(() => {
            this.closeSshPanel();
          })
          SshRunnerSheet({
            theme: this.themeName,
            sessionChannel: this.store !== null ? this.store.channel : '',
            sessionChatID: this.store !== null ? this.store.wireChatId() : '',
            sessionReady: this.store !== null && this.store.wireChatId().length > 0,
            callRpc: this.sshRpc(),
            onClose: () => {
              this.closeSshPanel();
            },
          })
        }.width('100%').height('100%')
      }
      // 会话操作菜单（置顶/上移/下移/改名/分支/删除）
      if (this.sessMenuId.length > 0) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.sessMenuId = '';
            this.sessConfirmDelete = '';
          })
          // 会话操作菜单（P2-2 抽出：components/MenuSheets.ets）——判据/flag 留页面，派发走 onItem。
          SessSheet({
            theme: this.themeName,
            title: this.menuLabel(),
            canTop: this.menuCanMove(MOVE_TOP),
            canUp: this.menuCanMove(MOVE_UP),
            canDown: this.menuCanMove(MOVE_DOWN),
            confirmDelete: this.sessConfirmDelete === this.sessMenuId,
            starred: this.isStarredChat(this.sessMenuId),
            onItem: (code: string) => {
              this.onSheetItem(code);
            },
          })
        }.width('100%').height('100%')
      }
      // 会话内搜索结果
      if (this.showSearchHits) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.showSearchHits = false;
          })
          // 会话内搜索结果（P2-2 抽出：components/MenuSheets.ets）
          SearchHitsSheet({
            theme: this.themeName,
            hits: this.searchHits,
            onPickHit: (snippet: string) => {
              this.copyText(snippet, '片段');
              this.showSearchHits = false;
            },
            onItem: (code: string) => {
              this.onSheetItem(code);
            },
          })
        }.width('100%').height('100%')
      }
      // 长按操作菜单（消息 / 迭代 / 工具 / 链接）——贴底弹出，点空白关闭
      if (this.ctxOpen) {
        Column() {
          Blank().layoutWeight(1).width('100%').onClick(() => {
            this.ctxOpen = false;
          })
          // 长按操作菜单（P2-2 抽出：components/MenuSheets.ets）——ctxKind/links 判据留页面
          ContextSheet({
            theme: this.themeName,
            ctxKind: this.ctxKind,
            links: this.ctxLinks(),
            // 迭代菜单的**空项过滤**（判据 = `core/ctxmenu.iterMenuItems`，对齐 web）
            canIterReply: this.ctxIterCanReply(),
            canIterThinking: this.ctxIterCanThinking(),
            canIterTools: this.ctxIterCanTools(),
            // 用户菜单：**并发编辑互斥**（判据 = `core/ctxmenu.canRewindWhile`；web `UserMessage.tsx:38-39`
            // `editDisabled` = "another message is being edited"）—— 有任一其它消息在编辑 ⇒ 「编辑并重发」置灰。
            canRewind: canRewindWhile(this.rewindEditRowId, this.ctxRowId),
            // **消息（行）**菜单的空项过滤（判据与动作**同源** = `composeCopy(partsForRow(row), …)`
            // 是否非空；项集真源 = `core/ctxmenu.rowMenuItems`）。用户 2026-10-13 亲报
            // 「长按复制会提示没有可复制的内容」—— 长按"最后无正文的助手消息"点「复制回复」即命中。
            canRowReply: this.ctxRowVariantText(COPY_REPLY).length > 0,
            canRowThinking: this.ctxRowVariantText(COPY_THINKING).length > 0,
            canRowTools: this.ctxRowVariantText(COPY_TOOLS).length > 0,
            canRowRaw: this.ctxRowVariantText(COPY_RAW).length > 0,
            // 工具组菜单（`ctxKind === 'tools'`）：逐枚名 + 逐枚"有内容" + 组级拼接是否非空
            toolNames: this.ctxToolNames,
            toolHasText: this.ctxToolHasText,
            toolsAllHasText: this.ctxToolsAllHasText,
            onItem: (code: string) => {
              this.onSheetItem(code);
            },
          })
        }.width('100%').height('100%')
      }
      // 图片查看（E5）：真 @Component `Lightbox`（旧 `@Builder ImageViewer()` 已删 —— 它缺「下滑关闭」
      //   与「按角色分别处置的 press」；容器也从「94%×80% 卡片」改为**全屏浮层**，对齐 web `Lightbox.tsx`）
      if (this.imagePixel !== null || this.imageBusy) {
        Lightbox({
          theme: this.themeName,
          pixel: this.imagePixel,
          busy: this.imageBusy,
          label: '',
          onClose: () => {
            this.closeViewer();
          },
          onSave: () => {
            void this.saveToAlbum();
          },
          onToast: (m: string) => {
            this.toast(m);
          },
        })
      }
      // ArkWeb 逃生舱（插件 UI / GenUI / 终端 / 编辑器 / 完整 Web UI）
      if (this.panelUrl.length > 0) {
        WebSurface({ url: this.panelUrl, theme: this.themeName, sessionCookie: this.cookie, chromeLabel: this.panelTitle, onBridgeMessage: (m: BridgeMessage) => {
          this.handleBridgeMessage(m);
        }, onOpenView: (viewId: string, title: string, url: string, params: Record<string, string>) => {
          this.routePluginView(viewId, title, url, params);
        }, onOpenExternal: (url: string) => {
          // §21.122b：插件面板/完整 Web UI 里的 `target="_blank"` 外链 ⇒ 系统浏览器。
          this.openUrl(url);
        }, onClipboardWrite: (text: string) => {
          // §21.122d：面板里的「复制」⇒ 宿主代写系统剪贴板（同 §21.122b 的出口收敛思路）。
          this.copyText(text, '');
        }, onDownloadDone: (name: string, path: string) => {
          // §21.122d 余项：全屏 WebView 面板里的页面下载完成 ⇒ 可见反馈（同第一处出口）。
          hilog.info(0x0000, 'XBOT-DL', 'downloaded %{public}s -> %{public}s', name, path);
          this.toast(`已下载 ${name}`);
        }, onHostNav: (ev: HostNavEvent) => {
          // §21.122f：嵌入模式下面板的导航意图（标题 / 就绪握手 / 要求打开文件 ⇒ 原生 UI）。
          this.handleHostNav(ev);
        }, onClose: () => {
          this.panelUrl = '';
        } })
      }
      // 全屏：设置面（`components/SettingsPanel` 的**唯一注入点**；自带 Header/onClose，
      // 页面**不再**自绘头部 —— 否则两个头部、内层是死的）。字段/回调名以组件 `@Prop` 为准。
      if (this.showSettingsPanel) {
        Column() {
          if (this.store !== null) {
            Column() {
              SettingsPanel({
                http: this.store.http,
                theme: this.themeName,
                settings: this.settings,
                // 深链 `settings.open?section=<x>` 指定的初始分区（缺省 = 外观档）
                initialTab: this.settingsInitialTab,
                surfaceWeb: this.useWebUI,
                notifyOn: this.notifyOn,
                // 账号面板的用户名（审计 G1：此前**未透传** ⇒ 账号页永远看不到真实用户名）
                username: this.username,
                // 「开发者 → 导出会话」要会话选择器（`{channel, chat_id}`）；空 ⇒ 按钮禁用
                channel: this.store.channel,
                chatID: this.store.wireChatId(),
                onClose: () => {
                  this.showSettingsPanel = false;
                },
                // 「设置分区加载失败 ⇒ 重试」—— ⛔ 按分区粒度：插件分区重拉**插件目录**，
                //    接 `loadSettings()` 会变成假重试（这正是判据 `settings_error_retry` 钉住的红线）。
                onRetrySettings: (): void => {
                  if (this.store !== null) {
                    void this.store.loadSettings();
                  }
                },
                onRetryPluginCatalog: (): void => {
                  void this.loadPluginCatalog();
                },
                onSetSetting: (key: string, value: string) => {
                  void this.setSetting(key, value);
                },
                onSetSurface: (web: boolean) => {
                  this.setSurface(web);
                },
                onSetNotify: (on: boolean) => {
                  void this.applyNotifyToggle(on);
                },
                onRefresh: () => {
                  const st: ChatStore | null = this.store;
                  if (st !== null) {
                    st.loadSettings().catch(() => {
                      // 有意吞：下拉刷新拉设置失败时保留旧值（下次进设置会再拉），⛔ 不打断下拉手势。
                    });
                  }
                },
              })
            }.width('100%').layoutWeight(1)
          } else {
            Text('未连接服务端').fontSize(FS_CAPTION).fontColor(this.pal().textMuted).padding(SP_4)
          }
        }
        .width('100%').height('100%')
        .backgroundColor(this.pal().appBg)
        // 键盘让位（⛔ 见 `kbHeightPx` 注释）：设置面有 **6 个分区含输入框**（LLM 的 key/URL、
        // 外观、渠道、插件、用户、审计行）——全是**浮层内**输入框 ⇒ 系统避让不生效 ⇒ 底部输入行
        // 会被键盘盖死。按键盘高度收缩可用区（面板内滚动列表随之缩短 ⇒ 输入行可滚进可见区）。
        .padding({ bottom: px2vp(this.kbHeightPx) })
      }
      // 全屏：原生插件目录 + 宿主页（components/PluginHost 的**唯一注入点**，消孤儿）。
      if (this.showPluginHost) {
        Column() {
          Row() {
            Text('插件').fontSize(typeOf('type.headline').size).fontWeight(typeOf('type.headline').weight).fontColor(this.pal().textPrimary).layoutWeight(1)
            // 关闭（页头 X）—— 统一 token + 弱色 role；⚠️ 原实现 `.fontSize(17).padding(SPACE_XS)`
            //   命中盒仅 17+2×8 = 33vp **< 44**（真机可点性不足）⇒ 改真实 44×44 布局盒承载 onClick。
            Row() {
              SymbolGlyph($r('sys.symbol.xmark'))
                .fontSize(SHEET_ACTION_GLYPH)
                .fontColor([colorOf(this.pal(), 'iconMuted')])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
            .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText('关闭')
            .onClick(() => {
              this.showPluginHost = false;
              this.pluginPageUrl = '';
            })
          }.width('100%').padding({ left: SP_5, right: SP_2, top: SP_3, bottom: SP_1 })

          Column() {
            PluginHost({
              items: this.pluginItems,
              groups: this.pluginGroups,
              theme: this.themeName,
              panelUrl: this.pluginPageUrl,
              panelTitle: this.pluginPageTitle,
              widgetContent: this.widgetContent,
              widgetEvent: this.widgetEvent,
              onOpenPlugin: (p: PluginCatalogItem) => {
                // ⛔ 目录里点卡片/视图行**必须**走同一套通用深链（`pluginOpenTarget`）——
                //    直接载入 `openUrl` 会落到 host 根页（聊天页）=「跑回主界面」（真机实证）。
                // §21.122：插件视图一律 **WebView 直渲**（`xbot_embed=1` ⇒ 原生拦截让路）。
                const t: PluginOpenTarget = pluginOpenTarget(p, this.serverUrl);
                this.pluginPageTitle = t.title;
                this.pluginPageUrl = embedPluginViewLink(t.url);
              },
              onOpenView: (v: PluginViewItem) => {
                // 用户点名了目录里的**具体一行** ⇒ 开那一个 view（`pluginViewTarget`）。
                const t: PluginOpenTarget = pluginViewTarget(v, this.serverUrl);
                this.pluginPageTitle = t.title;
                this.pluginPageUrl = embedPluginViewLink(t.url);
              },
              onNativeView: (viewId: string, title: string, url: string, params: Record<string, string>) => {
                // WebSurface 拦截到插件视图深链导航（`?xbot_view=<viewId>`）⇒ 路由到原生面板。
                this.routePluginView(viewId, title, url, params);
              },
              onOpenExternal: (url: string) => {
                // §21.122b：插件 WebView 里的外链（`target="_blank"`）⇒ 系统浏览器。
                this.openUrl(url);
              },
              onClipboardWrite: (text: string) => {
                // §21.122d：插件 WebView 里的「复制」⇒ 宿主代写系统剪贴板（与面板同一出口）。
                this.copyText(text, '');
              },
              onDownloadDone: (name: string, path: string) => {
                // §21.122d 余项：插件 WebView 里的页面下载完成 ⇒ 可见反馈（同一出口，不另写一套）。
                hilog.info(0x0000, 'XBOT-DL', 'downloaded %{public}s -> %{public}s', name, path);
                this.toast(`已下载 ${name}`);
              },
              onClose: () => {
                this.pluginPageUrl = '';
                this.pluginPageTitle = '';
              },
            })
          }.width('100%').layoutWeight(1)
        }
        .width('100%').height('100%')
        .backgroundColor(this.pal().appBg)
      }

      // ── 应用内开屏（冷启动）—— ⛔ **末子节点**（ArkUI `Stack` **后入子的在上层**：本项目里
      //    `WebSurface` + '切回原生' 悬浮按钮、抽屉 scrim + sheet 都据此"后者在上"）。它要**叠在
      //    内容之上**，故必须放**最后**；放到"LoadingView 之前"（首子节点）会盖在内容**下面**看不到。
      //    只有 `startSplash()` 在**迟滞**（`SPLASH_HYSTERESIS_MS`）到点判定"仍未就绪"才置
      //    `showSplash=true`（快启动 ⇒ 开屏压根不出现，T0 系统开屏直接过渡到主界面）。
      if (this.showSplash) {
        // ⛔ **不传 `theme`**（2026-10-11 真机缺陷修复，方案 (a)「品牌开屏恒深」）：
        //    旧实现把画布绑在可变的 `themeName` 上 ⇒ 浅色用户在同一段展示期间看到画布由深翻白，
        //    且 T0 系统开屏恒深 ⇒ 无论如何都跳变。现 T1 画布/标记**恒定**（`core/splash.splashBrandCanvas`），
        //    与 T0 同色 ⇒ T0→T1 零跳色；T1→T3 由 T2 淡出过渡（渐隐，非硬切）。
        SplashOverlay({
          phase: this.splashPhase,
          onDone: () => {
            this.onSplashDone();
          },
          onSkip: () => {
            this.skipSplash();
          },
        })
      }

      // ── 自绘 in-app toast（C4）—— **末子**（`Stack` 后入子的在上层；`hitTestBehavior(None)` 不吃点击）──
      //    可见性 = 状态的函数（`toastVisible`）⇒ 动画被打断也不会"永久不可读"（门禁 ⑨ 的正向形态）。
      if (toastVisible(this.toastState)) {
        Toast({ theme: this.themeName, msg: this.toastState.msg })
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
      Text('xbot').fontSize(FS_BOOT_WORDMARK).fontColor(this.pal().textPrimary).margin({ top: SPACE_SM })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  LoginView() {
    Stack({ alignContent: Alignment.Center }) {
      // ── 深空底：垂直渐变（appBg → surfaceAlt → appBg）—— **仅深色系**（那是深色的设计）──
      // ⛔ 浅色面**不画**：porcelain 下三端 = `#FFFFFF → #F6F6F7 → #FFFFFF`（对比度 ≈1.0，肉眼零差）
      //    ⇒ 纯空转一次全屏渐变，且违 `docs/REDESIGN.md §3.4`"白底不靠渐变立层次"。
      //    白主题的层次由**发丝 + 柔影**给（登录卡的 `surface.card` + `hairlineOf`）。
      //    深浅只经 `isLightPalette(paletteOf(theme))` 判（⛔ 不按主题名硬判）；深色**逐字节不变**。
      if (!isLightPalette(this.pal())) {
        Column()
          .width('100%').height('100%')
          .linearGradient({
            angle: 180,
            colors: [[this.pal().appBg, 0.0], [this.pal().surfaceAlt, 0.52], [this.pal().appBg, 1.0]],
          })
      }
      // ── 顶部光晕：径向 accent 辉光（未来感的来源，纯装饰）──
      Column()
        .width(620).height(620).borderRadius(310)
        .radialGradient({
          center: ['50%', '50%'],
          radius: 310,
          colors: [[this.eff().glowSoft, 0.0], [this.pal().transparent, 1.0]],
        })
        .offset({ y: -300 })

      // ── 玻璃表单卡 ──
      Column({ space: SP_2 }) {
        // 应用徽标：ArkUI 的 `linearGradient` 是 **CommonAttribute 的背景渐变**（≈ backgroundImage），
        // 与 `fontColor` 无关（ArkUI 没有 gradient-text）⇒ 渐变必须放在**容器**上，文字用纯色前景。
        // 原写法把 Text 的背景刷成紫渐变、且无 borderRadius ⇒ 真机上是"直角紫方块"
        // （见 docs/ARKTS-GOTCHAS.md 批次 14）。此处改为有意的应用徽标（squircle 观感）。
        //
        // ⛔ 浅色面**不是**彩色渐变牌（`docs/REDESIGN.md §3.4`：白底靠"发丝 + 柔影"立层次，
        //    禁彩色渐变当"牌"）—— porcelain 下 `gradientFrom/To` = `#0071E3→#0066CC`，刷在纯白上
        //    就是"一块蓝渐变牌"，与极简白的气质冲突。⇒ 浅色面改 **中性面（`surface.card` = 白）
        //    + 结构性发丝（`hairlineOf`）+ 柔影**，glyph 用**本主题品牌色**（`brandAccentFor(p)`，
        //    porcelain = Apple Blue `#0071E3`，即浅色面"标记色"口径，见 `docs/BRAND.md §12.1`/①）。
        // 深色面**逐字节不变**（品牌渐变 + `onAccent` glyph + `glassBorder`）。
        // 深浅只经 `isLightPalette(paletteOf(theme))` 判（⛔ 不按主题名硬判）。
        if (isLightPalette(this.pal())) {
          // G1（加性多层柔影）：外层 `Stack` 承载**贴合层 near**（浅色接触影；深色透明 ⇒ 零变化）；
          // 内层保留原单层 far（色/半径/offsetY 10 逐字节不变 ⇒ 深色族观感不变）。
          Stack() {
            Column() {
              Text('xbot').fontSize(FS_BRAND_WORDMARK).fontWeight(typeOf('type.headline').weight)
                .fontColor(brandAccentFor(this.pal()))
                .letterSpacing(0.5)
            }
            .width(108).height(108)
            .borderRadius(30)
            .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
            .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
            .shadow({ radius: shadowRadiusOf(this.pal(), 'hero'), color: shadowColorOf(this.pal(), 'raised'), offsetX: 0, offsetY: 10 })
            .justifyContent(FlexAlign.Center)
          }
          .width(108).height(108)
          .borderRadius(30)
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
          .shadow({ radius: this.contactLayer('hero').radius, color: this.contactLayer('hero').color, offsetX: 0, offsetY: this.contactLayer('hero').offsetY })
        } else {
          Column() {
            Text('xbot').fontSize(FS_BRAND_WORDMARK).fontWeight(typeOf('type.headline').weight)
              .fontColor(this.pal().onAccent)
              .letterSpacing(0.5)
          }
          .width(108).height(108)
          .borderRadius(30)
          .linearGradient({
            angle: 135,
            colors: [[this.eff().gradientFrom, 0.0], [this.eff().gradientTo, 1.0]],
          })
          .border({ width: 1, color: this.eff().glassBorder })
          .shadow({ radius: shadowRadiusOf(this.pal(), 'hero'), color: shadowColorOf(this.pal(), 'raised'), offsetX: 0, offsetY: 10 })
          .justifyContent(FlexAlign.Center)
        }
        Text('连接你的 xbot 服务端 · 原生鸿蒙客户端')
          .fontSize(FS_CAPTION).fontColor(this.pal().textMuted)
          .margin({ bottom: SP_4 })

        TextInput({ placeholder: '服务端地址，如 192.168.1.10:16000', text: this.serverUrl })
          .onChange((v: string) => {
            this.serverUrl = v;
            this.testMsg = '';
          })
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.eff().glassBg).fontColor(this.pal().textPrimary)
          .constraintSize({ minHeight: 48 }).borderRadius(R_XL)
          .border({ width: 1, color: this.eff().glassBorder })
          .padding({ left: SP_3, right: SP_3 })

        // 最近用过的地址（一点即填，省得重打 IP）
        if (this.recentServers.length > 0) {
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.recentServers, (u: string) => {
              Text(u)
                .fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
                .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
                .margin(SP_1)
                .backgroundColor(this.eff().glassBg).borderRadius(R_MD)
                .border({ width: 1, color: this.eff().glassBorder })
                .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.serverUrl = u;
                  this.testMsg = '';
                })
            }, (u: string) => u)
          }
          .width('100%')
        }

        Button(this.testing ? '测试中…' : '测试连接')
          .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_BODY)
          .fontColor(this.pal().textSecondary)
          .backgroundColor(Color.Transparent)
          .borderRadius(R_XL)
          .border({ width: 1, color: this.eff().glassBorder })
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.testConnection();
          })

        if (this.testMsg.length > 0) {
          Text(this.testMsg).fontSize(FS_CAPTION)
            .wordBreak(WordBreak.BREAK_ALL)
            .fontColor(this.testMsg.startsWith('连接成功') ? this.pal().successText : this.pal().warn)
            .width('100%')
        }

        TextInput({ placeholder: '用户名', text: this.username })
          .onChange((v: string) => {
            this.username = v;
          })
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.eff().glassBg).fontColor(this.pal().textPrimary)
          .constraintSize({ minHeight: 48 }).borderRadius(R_XL)
          .border({ width: 1, color: this.eff().glassBorder })
          .padding({ left: SP_3, right: SP_3 })
        TextInput({ placeholder: '密码' })
          .type(InputType.Password)
          .onChange((v: string) => {
            this.password = v;
          })
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.eff().glassBg).fontColor(this.pal().textPrimary)
          .constraintSize({ minHeight: 48 }).borderRadius(R_XL)
          .border({ width: 1, color: this.eff().glassBorder })
          .padding({ left: SP_3, right: SP_3 })

        if (this.errMsg.length > 0) {
          Text(this.errMsg).fontSize(FS_CAPTION).fontColor(this.pal().dangerText).width('100%')
            .wordBreak(WordBreak.BREAK_ALL)
        }

        // 主 CTA：渐变 + 光晕
        // G1（加性多层柔影）：外层 `Stack` 承载贴合层 near；按钮保留原 far（offsetY 6 逐字节不变）。
        Stack() {
          Button('登录').width('100%').constraintSize({ minHeight: 50 })
            .fontSize(FS_TITLE).fontWeight(typeOf('type.subhead').weight)
            .borderRadius(R_XL)
            .fontColor(this.pal().onAccent)
            .backgroundColor(this.pal().accent)
            .linearGradient({
              angle: 135,
              colors: [[this.eff().gradientFrom, 0.0], [this.eff().gradientTo, 1.0]],
            })
            .shadow({ radius: shadowRadiusOf(this.pal(), 'raised'), color: shadowColorOf(this.pal(), 'raised'), offsetX: 0, offsetY: 6 })
            .stateStyles({ pressed: { .opacity(0.78).scale({ x: 0.985, y: 0.985 }) }, normal: { .opacity(1).scale({ x: 1, y: 1 }) } })
            .onClick(() => {
              this.doLogin();
            })
        }
        .width('100%')
        .borderRadius(R_XL)
        .backgroundColor(this.pal().accent)
        .shadow({ radius: this.contactLayer('raised').radius, color: this.contactLayer('raised').color, offsetX: 0, offsetY: this.contactLayer('raised').offsetY })
        .margin({ top: SP_2 })
        // 次 CTA：幽灵按钮
        Button('注册（仅服务端允许时）').width('100%').constraintSize({ minHeight: 44 })
          .fontSize(FS_BODY)
          .fontColor(this.pal().textSecondary)
          .backgroundColor(Color.Transparent)
          .borderRadius(R_XL)
          .border({ width: 1, color: this.eff().glassBorder })
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.doRegister();
          })
        // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
        Text('渲染自检（排查渲染问题用）')
          .fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
          .margin({ top: SP_3 })
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.showSelfCheck = true;
          })
      }
      .constraintSize({ maxWidth: 460 })
      .padding(SP_6)
      .borderRadius(R_2XL)
      .backgroundColor(this.eff().glassBg)
      .backgroundBlurStyle(BlurStyle.Thin, { colorMode: this.glassMode() })
      .border({ width: 1, color: this.eff().glassBorder })
      .shadow({ radius: shadowRadiusOf(this.pal(), 'panel'), color: this.eff().elev3, offsetX: 0, offsetY: 12 })
      .margin({ left: SP_4, right: SP_4 })
      .id('xbot-login')
    }
    .width('100%').height('100%')
  }

  /**
   * rewind 编辑态提示条。
   *
   * 无参 `@Builder`（读 `this` 状态）—— 满足"带参全局 @Builder 的子树不随参数重建"纪律：
   * 提示条的显隐由外层 `if (this.rewindEditRowId.length > 0)` 控制，@Builder 内不含会变参数。
   */
  @Builder
  RewindEditBar() {
    Row({ space: SP_2 }) {
      SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(ICON_MD).fontColor([this.pal().warn])
      Text('编辑并重发：将回退此消息及其后的回复')
        .fontSize(FS_CAPTION).fontColor(this.pal().warn).layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      Text('取消').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
        .padding({ left: SP_2, right: SP_2, top: SPACE_XXS, bottom: SPACE_XXS })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.cancelRewindEdit();
        })
    }
    .width('100%')
    .padding({ left: SP_2, right: SP_1, top: 6, bottom: 6 })
    .backgroundColor(withAlpha(this.pal().warn, 0.08))
    .borderRadius(R_MD)
    .border({ width: 1, color: withAlpha(this.pal().warn, 0.35) })
    .margin({ left: SP_3, right: SP_3, top: SP_2 })
  }

  /**
   * 骨架屏的**一行**（静态：两段占位条宽比）。
   *
   * ⛔ 这里刻意**不用 `ForEach`**（性能预算 ⑦：`ForEach(` 是全仓硬上限，只有 4 行的**静态**
   *    装饰性骨架不值得占一个"动态列表站点"）。参数是**编译期字面量**（`'72%'/'46%'`…），
   *    不会变 ⇒ 用带参 `@Builder` 完全安全（"带参子树不随参数重建"的坑只在参数会变时成立）。
   */
  @Builder
  SkeletonRow(w1: string, w2: string) {
    Row({ space: 8 }) {
      Row().width(26).height(26).borderRadius(26 / 2).backgroundColor(this.pal().surfaceHi)
      Column({ space: 6 }) {
        Row().width(w1).height(10)
          .backgroundColor(this.pal().surfaceHi).borderRadius(5)
        Row().width(w2).height(10)
          .backgroundColor(this.pal().surfaceHi).borderRadius(5)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%')
  }

  @Builder
  ChatView() {
    Column() {
      // 顶栏：玻璃材质 + 底部细描边（磨砂顶栏是"干净/未来感"的关键一笔）
      Row() {
        SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(22).fontColor([this.pal().textPrimary])
          .padding(SPACE_SM)
          .borderRadius(RADIUS_CHIP)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('打开侧栏')
          .onClick(() => {
            this.openDrawer();
          })
        Column({ space: 2 }) {
          Text(this.currentChat.length > 0 ? this.labelOf(this.currentChat) : 'xbot')
            .fontSize(FS_TITLE).fontWeight(typeOf('type.subhead').weight)
            .fontColor(this.pal().textPrimary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            // ⛔ H1：`Row` 内可变长标题必须有横向约束（否则长会话名顶出屏；父 Column 已有 layoutWeight(1)）
            .constraintSize({ maxWidth: '100%' })
          Row({ space: SP_1 }) {
            // ⚠️ 不用 `Circle().fill()`：其声明在本 SDK 标 @since 26（工程 pin 21）⇒
            //    改用通用属性画同形圆点（观感等价）。
            Row().width(6).height(6).borderRadius(6 / 2)
              .backgroundColor(this.busy ? this.pal().accent : this.pal().textMuted)
            // ⛔ 状态点不再呼吸（第二处"在飞"）——唯一在飞动效 = 光球；状态只由**颜色**表达。
            Text(this.busy ? '运行中…' : '空闲')
              .fontSize(typeOf('type.caption').size).fontColor(this.busy ? this.pal().accentSoft : this.pal().textMuted)
          }
          // ⚠️ 状态块可点 = 打开会话状态面板（与 5682 状态栏「详情」同源）：无 goal/todo/usage
          //   数据时 5682 状态栏不渲染 ⇒ 此处是**唯一常驻入口**（用户随时可查 cwd/会话信息/订阅）。
          .padding({ top: SPACE_XXS, bottom: SPACE_XXS })
          .onClick(() => {
            this.anim(() => {
              this.showStatus = true;
            });
          })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        // ── 原生「迭代指标」徽章（插件 `xbot.iteration-stats` 的 `status_bar_right` 视图）──
        // ⭐ 这正是"插件视图原生渲染"的落点：数据来自宿主自己的实时指标（与 web 侧插件同源），
        //    **不打开任何 web UI**。文案判据 `core/pluginviews.ets:iterStatsText`（空 ⇒ 不渲染）。
        // ⛔ 只读 `@State iterStatsBadge`（在 `sync()` 投影）——不得在此直调 `store.liveProgress()`，
        //    否则回合开始后 stat 到达时**不会重渲**（真机实锤缺陷，见该 `@State` 的注释）。
        // 钮序（2026-10-15）：插件徽章放在内置按钮**之前**——内置按钮钉右，插件被挤到中间。
        if (this.iterStatsBadge.length > 0) {
          Text(this.iterStatsBadge)
            .fontSize(typeOf('type.micro').size)
            .fontWeight(typeOf('type.micro').weight)
            .fontFamily('monospace')
            .fontColor(colorOf(this.pal(), 'successText'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ right: SP_1 })
        }

        // ── 常驻「运行面板」入口（对标 web 移动壳的**常驻面板按钮条**，`MobileAppShell.tsx:701-731`）──
        // 用户亲报：「运行面板入口不方便，要打开侧边栏才能进入」。原实现只有抽屉底栏那 5 键
        // （`DrawerSheet` 里），必须**先开侧边栏**才点得到；而 web 的移动壳把面板入口做成**常驻**
        // 按钮条（files/search/info/tasks/terminal 一直在屏上，见 `PANEL_BUTTONS`）⇒ 原生把
        // 「运行面板」这一枚落到**顶栏**（与状态块 / 队列 chip 同排）⇒ 一步直达，不必开抽屉。
        // ⛔ 图标用既有 `list_bullet`（= 抽屉底栏「运行」**同一枚** ⇒ 两处入口同形，不会被读成新功能）。
        // ⛔ 真实 ≥44 布局盒承载点击（真机实测 `responseRegion` 负偏移外扩**无效**）。
        // ⚠️ 取色走 `this.panelActionTint()`（本页**动作色单一出口**，内部只读一次 `palOnce()`）：
        //    性能预算 B 线（`pal()∨palOnce()` 读取总量）余量已见底 —— 直接写 `palOnce()` 会把 1350
        //    顶穿（实测 1351 ⇒ 门禁红）；走该出口**不加计数**，且它本就是 Apple「动作键」色（`accentSoft`），
        //    与运行面板表头的「新建/刷新」同源 ⇒ 一眼可辨"这是动作"。
        Row() {
          SymbolGlyph($r('sys.symbol.list_bullet'))
            .fontSize(ICON_XL)
            .fontColor([this.panelActionTint()])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('运行面板：定时任务、后台任务、子代理、Runner、终端')
        .onClick(() => {
          this.openPanels();
        })

        // ── 常驻「文件」「插件」入口（同一对标：web 移动壳 `MobileAppShell.tsx:701-731` 的常驻
        //    面板按钮条里 `files` / 插件面板 likewise **一直在屏上**）─────────────────────────────
        // 用户 2026-10-13 亲报 ④：「插件都打不开…统计插件的面板我们看不到。文件管理也没有」
        // ⇒ 代码层核查：面板本身**都在且都接线**（门禁 ⑤：67 组件 0 孤儿；`FilesSheet` 有搜索/预览/
        //   图片/隐藏文件/失败重试全套），入口却只在**抽屉底栏**（要先开侧边栏）⇒ 真病根是**可达性**，
        //   与上面「运行」入口同源 ⇒ 同修法：落到顶栏（图标 = 抽屉同一枚，处理器 = 抽屉同一个）。
        // ── 钮序（2026-10-17 用户亲报「自带按钮应该在最右边，而不是被插件挤压到左边去」）：
        //    插件钮在前、文件钮（宿主自带）在后 ⇒ 自带入口钉右。两钮结构/热区/处理器完全不变，
        //    只换位（图标 = 抽屉同一枚，处理器 = 抽屉同一个的约定不动）。
        Row() {
          SymbolGlyph($r('sys.symbol.puzzle'))
            .fontSize(ICON_XL)
            .fontColor([this.panelActionTint()])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('插件与 Web UI：插件目录、宿主页、完整 Web UI')
        .onClick(() => {
          this.openPlugins();
        })

        Row() {
          SymbolGlyph($r('sys.symbol.folder'))
            .fontSize(ICON_XL)
            .fontColor([this.panelActionTint()])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('文件管理：原生文件面板（浏览/搜索/预览/加入聊天）')
        .onClick(() => {
          this.openFiles();
        })

        // ── 队列 chip（2026-10-17 删除）：队列信息已由对话窗口的排队/插队条承载（goal 细节
        //    「busy 时 cancel 钮自动变插队/排队钮」），顶栏再放一颗 ⇒ 双份冗余 + head 拥挤
        //    （用户亲报「head 太挤…队列渲染在对话窗口那么 header 就不该有了」）。
      }
      .width('100%').constraintSize({ minHeight: 56 }).padding({ left: SP_2, right: SP_2 })
      .backgroundColor(this.pal().appBg)
      // 极简顶栏：分隔靠**结构性发丝**（⛔ 不是装饰描边），不靠 box 边框
      .borderWidth({ bottom: STROKE_HAIRLINE }).borderColor(hairlineOf(this.pal()))
      .id('xbot-header')

      // 加载失败且列表为空 ⇒ 明确提示 + 重试（网络/代理故障时界面必须自解释）
      if (this.rows.length === 0 && this.loadErr.length > 0) {
        Column({ space: 8 }) {
          Text(loadErrTitle(this.loadErr)).fontSize(typeOf('type.callout').size).fontColor(this.pal().dangerText)
          Text(this.loadErr).fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary)
            .maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(loadErrHint(this.loadErr))
            .fontSize(typeOf('type.caption').size).fontColor(this.pal().textMuted).maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          // 判据与标题同一处：401 给「重新登录」，其余给「重试」
          Button(needsRelogin(this.loadErr) ? '重新登录' : (needsSessionRefresh(this.loadErr) ? '刷新会话列表' : '重试'))
            .constraintSize({ minHeight: HIT_TARGET_MIN }).backgroundColor(this.pal().accent).onClick(() => {
              if (needsRelogin(this.loadErr)) {
                this.handleAuthExpired();
              } else if (needsSessionRefresh(this.loadErr)) {
                this.recoverMissingSession();
              } else {
                this.retryLoad();
              }
            })
        }
        .width('100%').padding(SPACE_MD).alignItems(HorizontalAlign.Start)
        .backgroundColor(this.pal().surfaceAlt).borderRadius(10).margin({ left: SPACE_SM, right: SPACE_SM, top: SPACE_SM })
      }

      // 空态：没有消息、没有错误、也不在跑 —— 给友好的起步引导（而不是一片黑洞）。
      // 末项 `!showsHistorySkeleton(...)` 保证与骨架屏**互斥**（二者都是 rows===0 布局，
      // 判据重叠时会同时渲染 ⇒ 真机走查见过「星形 + 开始对话 + 4 行灰条」并存）。
      // ⚠️「在跑」判据必须与 busy 占位符**同源**（`busyNow(busySignals())`）—— 此前用原始
      //    `!this.busy`（仅本地事件驱动）⇒ 服务端已 running 但本地事件未到时，空态与占位符
      //    **都可能不显示**（不变量被破坏，见 `docs/REDESIGN-INPUT-STATES.md §F2`）。
      if (this.rows.length === 0 && this.loadErr.length === 0 && !busyNow(this.busySignals())
        && !this.loadingMore && this.currentChat.length > 0
        && !this.isSubAgentChat()          // ⛔ 子代理会话**不**走通用「开始对话」空态（走下方专属空态）
        && !showsHistorySkeleton(this.historyLoading, this.rows.length)) {
        Column({ space: SP_3 }) {
          // ⛔ 星形不再用 `.shadow`：它按**字形包围盒**渲染 ⇒ 深色底上星形外面是一圈
          //    "圆角方盒"而不是圆光（浅色系返回无阴影只是躲开了白盒，深色一直漏着）。
          //    改用**真·圆光**：径向渐变（`radialGradient`，与登录页顶部光晕同一手段，
          //    `docs/DESIGN-SYSTEM.md §4` 已列）裁成圆，中心 accent 辉光、边缘透明。
          //    ⛔ 静态（不再呼吸：唯一"在飞动效" = 光球；页面级心跳已随 §4.1/§4.3 移除）。
          Stack({ alignContent: Alignment.Center }) {
            Column()
              .width(STAR_GLOW_SIZE).height(STAR_GLOW_SIZE).borderRadius(STAR_GLOW_SIZE / 2)
              .radialGradient({
                center: ['50%', '50%'],
                radius: STAR_GLOW_SIZE / 2,
                colors: [[this.eff().glow, 0.0], [this.pal().transparent, 1.0]],
              })
              // ⛔ 静态：唯一"在飞动效" = 光球（§4.1）——空态插图**不呼吸**
              .opacity(1)
            SymbolGlyph($r('sys.symbol.star_fill')).fontSize(52).fontColor([this.pal().accent])
          }
          .width(STAR_GLOW_SIZE).height(STAR_GLOW_SIZE)
          Text('开始对话').fontSize(FS_HERO).fontWeight(typeOf('type.subhead').weight)
            .fontColor(this.pal().textPrimary)
          Text('直接说需求；也可以用 / 选命令、@ 提文件、加附件')
            .fontSize(FS_CAPTION).fontColor(this.pal().textMuted).textAlign(TextAlign.Center)
            .padding({ left: SP_8, right: SP_8 })
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        .id('xbot-empty-state')
      }

      // ── 子代理会话的**专属空态**（与上面通用空态互斥：条件加了 `!this.isSubAgentChat()`）──────
      // 为什么必须分开：子代理会话**没有独立消息历史** —— 服务端 `/api/history` 实测回
      // `messages:null`、DB `session_messages` 对其 `channel=agent` 租户 `msgs=0`（它的内容只以
      // `sub_agents` 进度挂在**父轮次**里，见 `isSubAgentChat()` 头注）⇒ 通用「开始对话 + 用 / 选命令、@ 提文件」
      // 对该类会话**是误导**（那边没有可对话的东西、输入区也已按 web 语义不渲染）。
      // ⚠️ 复用页面既有 `@Builder PanelEmpty`（图标 + 主行 + 提示行，居中）—— ⛔ 不新写取色：
      //    性能预算 B 线（`pal()∨palOnce()` 读取总量）余量为 **0**（1350/1350），而 `PanelEmpty`
      //    内部只读一次 `palOnce()`、已是既有站点 ⇒ **调用它不加计数**（新增取色会立刻顶穿门禁）。
      if (this.rows.length === 0 && this.loadErr.length === 0 && this.currentChat.length > 0
        && !this.loadingMore && this.isSubAgentChat()
        && !showsHistorySkeleton(this.historyLoading, this.rows.length)) {
        this.PanelEmpty($r('sys.symbol.person_2'), '子代理会话',
          '它没有独立的消息历史 —— 运行过程显示在父会话对应的轮次里')
      }

      // ── ③ 切会话加载 splash（用户 2026-10-14 要求）──────────────────────────────────
      // 只在 `switchSession()` 的**真网络等待**路径上出现（`!alreadyOpen` ⇒ 拉会话列表 + history），
      // 拉完（或失败）立刻撤 ⇒ 静息态恒不可见（失败方向安全，⛔ 不是"不透明度由动画驱动"那种形态）。
      // 用**不透明**遮罩而不是半透明：这期间列表里可能是**上一个会话的残影**（`beginSwitch` 之后
      // 才清空），半透明会让用户读到错会话的内容 —— 遮挡要**确定**（与本仓"模态感"同一口径）。
      if (this.switchSplash) {
        Column({ space: SPACE_SM }) {
          LoadingProgress().width(32).height(32).color(this.pal().accent)
          Text('会话加载中…')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.pal().textSecondary)
        }
        .width('100%').layoutWeight(1)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .backgroundColor(this.pal().appBg)
        .id('xbot-session-splash')
      }

      // 骨架屏：**只在"正在拉历史且还没有任何行"时**出现（判据在 `core/indicators.ets`，
      // 可脱机单测）。⛔ 曾经写成 `!historyLoading`（与 `BusySignals.loading` 契约相反）
      // ⇒ 空会话上骨架屏永久残留，且与下方空态同时渲染（真机走查抓到）。
      // ⚠️ 与上面的切会话 splash **互斥**（`!this.switchSplash`）：两者都是"占满内容区"的加载态，
      //    同时渲染会得到"转圈套骨架"，语义重复。
      if (!this.switchSplash
        && showsHistorySkeleton(this.historyLoading, this.rows.length) && this.currentChat.length > 0) {
        Column({ space: 10 }) {
          this.SkeletonRow('72%', '46%')
          this.SkeletonRow('54%', '64%')
          this.SkeletonRow('72%', '46%')
          this.SkeletonRow('54%', '64%')
        }
        .width('100%').layoutWeight(1).padding({ left: SPACE_XXS, right: SPACE_XXS, top: SPACE_SM })
        .id('xbot-skeleton')
      }

      // 消息列表 —— 顶部**只有**「更早」这一类指示器（自动触发，不可点），保证其上方没有任何消息行。
      // ⚠️ 与两个**行内**「更早」哨兵（`components/MessageRow` 的「更早的 N 个区域」/「更早的 N 个
      //    迭代块」）**同一视觉语言**（用户 2026-10-14 亲报「怎么搞这么多不同的加载提示」）：
      //    同为 `chevron_up`(12) + `iconMuted` + `FS_META` + `textMuted` + 居中恒定行高。
      //    ⇒ 三处读起来是**同一套控件在不同层级**（历史行 / 区域 / 迭代块），而不是三种不同的加载器。
      //    加载中态也收敛为同一形态：**同一行**换成 spinner + 「正在加载更早…」（与行内的
      //    「正在加载更多…」同款），而不是另起一种排版。
      Stack({ alignContent: Alignment.TopEnd }) {
      List({ scroller: this.listScroller }) {
        if (this.hasHeadItem()) {
          ListItem() {
            Row({ space: 6 }) {
              if (this.loadingMore) {
                LoadingProgress().width(13).height(13).color(this.pal().textMuted)
                Text('正在加载更早…').fontSize(FS_META).fontColor(this.pal().textMuted)
              } else {
                SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(12)
                  .fontColor([colorOf(this.pal(), 'iconMuted')])
                Text(this.hasMore ? '更早的历史消息' : '已到最早')
                  .fontSize(FS_META).fontColor(this.pal().textMuted)
              }
            }
            .width('100%').height(MSG_BLOCK_SENTINEL_H).justifyContent(FlexAlign.Center)
            .onClick(() => {
              // 兜底：万一自动触发没打到（例如列表未滚动），点一下也能放开窗口
              if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
                this.widenRowWindow();
              } else if (!this.loadingMore && this.hasMore) {
                this.loadMore();
              }
            })
          }
        }

        // 行窗口：`List` + `ForEach` 会**一次性构建全部行**（每行 ≤16 个迭代块 × Markdown）
        // ⇒ 几十行就是几千个节点（真机"很卡、交互差"的主因之一）。只渲染末尾 rowLimit 行，
        // 更早的按批放开（滚到顶时自动放开，见上面的 onScrollIndex/onReachStart）。
        LazyForEach(this.rowDs, (row: ChatRow) => {
          ListItem() {
            this.ChatRowBody(row)
          }
        }, (row: ChatRow) => themableRowKey(this.currentChat, this.themeName, row))

        // ── live turn 的整条 assistant 消息（LazyForEach 之外，@State 直驱）──
        // 真机 bug ② 根治点：live 迭代不再是"单独的气泡/单独的 ListItem"，而是这条
        // assistant 消息气泡内的**最后一块**（MessageRowView 内部渲染：
        // 已完成迭代 ⊕ 末尾在飞块，共用同一套块渲染）。整条非懒渲染是可靠性要求
        // （虚拟列表条目在真机不可靠重建 = 流式期间什么都看不到）。
        if (this.hasLiveRow) {
          ListItem() {
            // ⚠️ 打字机（20Hz）状态在 **LiveTailView 子组件内部**（MessageRowView 里）
            // —— 否则每拍会重跑整页 build，把系统 spinner 都拖到 2Hz。
            // ⛔ 走**无参** @Builder（`LiveRowBody`）：其内部直接读页面 @State
            //   （`liveRowRef`/`liveText`/`liveReasoning`/`liveTools`）—— 带参 @Builder
            //   按参数传值 =「调用那一刻的快照」（官方语义，见 docs/ARKTS-GOTCHAS.md §4）。
            this.LiveRowBody()
          }
          // ── §21.122bx：live 行**可见性**（用户定向「看不见就不做高频更新，快进入视野时再更新」）──
          // 阈值 `0.01`：哪怕只露出 1% 就算"看得见" ⇒ 一进入视野**立刻**恢复全速投递（无感知）。
          // 只在**真变化**时写字段（⛔ 不每帧写：字段变化会触发页级同步）。
          .onVisibleAreaChange([0.0, 0.01], (isVisible: boolean) => {
            if (isVisible === this.liveRowVisible) {
              return;
            }
            this.liveRowVisible = isVisible;
            // ⛔ 这里**不**触发同步：可见性回调在滚动/布局期高频，回调里 `scheduleSync` 会形成
            //    "同步→重建→可见性变化→再同步"的回环（滚动时表现为抖动）。恢复可见后，下一帧
            //    SSE（流式期 ≤50ms）自然投递；投递降频窗口上限也只有 400ms ⇒ 用户无感。
          })
        }

        if (showsBusyPlaceholder(this.busySignals())) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(16).height(16).color(this.pal().accent)
              // ⛔ 文案**唯一真源** = `core/indicators.ets:busyLabel(phase)`（§12-E 修复）：
              //    压缩期（`phase === 'compressing'`）⇒「正在压缩上下文…」，否则「思考中…」。
              //    此前写死资源串 ⇒ **`busyLabel` 零生产消费者**（门禁 ⑧ 警告）且压缩期文案与 web 分叉
              //    （web `MessageList.tsx:1679-1686` 按 phase 二选一）。
              // ⛔ 只读 `@State busyPhase`（在 `sync()` 投影）——不得在此直调 `store.liveProgress()`，
              //    否则压缩开始时**不会重渲**（真机同类缺陷，见该 `@State` 的注释）。
              Text(busyLabel(this.busyPhase)).fontSize(typeOf('type.subhead').size).fontColor(this.pal().textSecondary)
            }.padding({ left: 14, top: SPACE_XS, bottom: SPACE_XS })
          }
        }
      }
      .width('100%').height('100%').edgeEffect(EdgeEffect.Spring).padding({ left: SPACE_XS, right: SPACE_XS })
      // 预构建 4 行：滚动时不必等构建（越小内存越省，越大滚动越顺）
      .cachedCount(4)
      // ⛔ **上方插入内容时必须保持可见位置**（用户 2026-10-13 亲报）：
      //   「加载更多触发后，新内容应该接在**当前屏幕上方**（屏外），用户继续往上滚才能看到；
      //     现在是一加载视角就跑到**被加载内容的最上方**」。
      //   机制：行窗口放开（`rowLimit += MAX_ROWS_VISIBLE`）⇒ 数据源**在头部插入**行
      //   （`applyRows` 判骨架变化 ⇒ `onDataReloaded()`）⇒ 列表按**下标**保位 ⇒ 同一个下标
      //   现在指向的是**新插入的内容** ⇒ 视口"跳"到新内容顶部。
      //   修法 = ArkUI **内置**语义（SDK `list.d.ts:1439`，`@since 12`）：数据在**可视区之外**
      //   插入/删除时保持可见内容位置不变 ⇒ 新行落在屏外上方，用户不动。
      //   ⛔ 不手写"记录首行键 + 事后 scrollToIndex"的补偿：那要跨一次布局回调（`scrollToIndex`
      //      在 DS 通知生效前会打到旧布局，`navToRow` 的 `try/catch` 注释已记该竞态），
      //      而本属性由框架在**布局阶段**完成，无竞态。
      .maintainVisibleContentPosition(true)
      // ⛔ 记录的**只有**"这一帧的滚动是不是用户干的"（ScrollSource 由 Scroll 框架给出，
      //    `SCROLLER`/`SCROLLER_ANIMATION` = 程序滚动与内容钳位 ⇒ 绝不算用户输入）。
      .onWillScroll((offset: number, state: ScrollState, source: ScrollSource) => {
        const user: boolean = isUserScrollSource(source);
        // 记录**本帧**来源：`onScrollIndex` 只在**本帧确属用户滚动**时才判定恢复跟随
        // （见字段 `lastScrollWasUser` 的论证 —— 单布尔 flag 会被程序滚动的索引回调抢先消费）。
        this.lastScrollWasUser = user;
        // **只置位、不清位**（`markUserScrollFrame`）：程序帧不得清掉用户在飞意图。
        this.userScrollFrame = markUserScrollFrame(this.userScrollFrame, user);
        // ★ 用户一动手 ⇒ **立即暂停跟随**（逐字移植 web `MessageList.tsx:1330-1333`
        //   `onWheel → pauseFollowing()`：**与方向/位置无关**，用户一碰就交还控制权）。
        //   为什么必须**立即**、不能等 `onScrollIndex` 按位置判定（用户 2026-10-12 真机亲报）：
        //   流式期间程序滚动与用户拖动**交错**，等索引回调时程序滚动可能已把视图钉回底部
        //   （`end === itemCount-1`）⇒ 被判"仍在跟随" ⇒ 用户**滚不动**。
        if (user) {
          // 用户一动手 ⇒ **立即**暂停跟随（逐字移植 web `MessageList.tsx:1330-1333` 的
          //   `onWheel → pauseFollowing()`：与方向/位置无关）。⛔ 这里**不**加位置判据：
          //   弹性过滚动期间 `isAtEnd()` 不可靠（实测判假）⇒ 用"位置闸门"当暂停条件会漏；
          //   药丸的**闪现**由**渲染侧**的贴底闸门 `atEndUi` 压制（见 `showsJumpToLatest` 注释），
          //   与"暂停"职责分离。
          // ⛔ 只在**真的变化**时写（`followBottom` 是 `@State`）：用户拖动的每一帧都会进这一支，
          //   无论框架对同值写入是否短路，都不该在"已经暂停"后继续反复标脏（零写入最稳）。
          if (this.followBottom) {
            this.followBottom = false;
          }
        }
      })
      // 跟踪"是否跟随到底部"：end 是最后一个可见项的下标，等于末项下标即在底部。
      // 项数 = [可选"加载更早"头项] + rows + [可选 live 行项] + [可选 busy 指示器]，
      // 故用 listItemCount() 显式算（头项判据与渲染它的 `if` 同源：`hasHeadItem()`）。
      .onScrollIndex((start: number, end: number) => {
        this.listStart = start;   // 用户消息导航据此算当前锚点（**普通字段**：写它不触发整页 build）
        // ⛔ **只在序号真的变化时**才写渲染状态（`navSeq` 是 `@State`）——
        //    这样"滚动但没跨过锚点边界"的帧 = 零页级状态写入 = 零整页 build。
        //    旧写法（每次滚都写 `listStart` 这个 @State）会让整页 build 每帧重跑：
        //    锚点表重建 + 每条消息正文重拷 + 全部 `pal()` 重新分配 ⇒ 掉帧、
        //    且随历史长度线性变重（用户亲报「固定历史还会掉帧」的根因）。
        const seq: number = this.navActiveSeq();
        if (seq !== this.navSeq) {
          this.navSeq = seq;
          // ⛔ 真源落 **AppStorage**（`MessageNav` 用 `@StorageProp(NAV_ACTIVE_SEQ_KEY)` 自己订阅），
          //    **绝不写页级 `@State`**：写页级状态 ⇒ 每跨一个锚点整页 `build()` 重跑，而页面 build
          //    里 `LazyForEach` 的重复数据源 diff 与**数据源行数（= 行窗口 `rowLimit`）**成正比；
          //    行窗口随"加载更早"逐次变大 ⇒ **历史越长、滚动越掉帧**（用户 2026-10-15 实录
          //    「加载完毕后滚动就掉帧」「感觉是列表太长」）。见 AGENTS.md 同源纪律。
          AppStorage.setOrCreate<number>(NAV_ACTIVE_SEQ_KEY, seq);
        }
        // ⛔ 跟随开关是**用户意图**，只由**用户输入**翻转：只有**本帧确属用户滚动**
        //    （`lastScrollWasUser`）且 flag 在飞时才判定 —— 程序滚动 / 内容增删引起的
        //    索引回调一律**不碰意图**（否则"点工具 pill ⇒ store 变更 ⇒ 拽到最下方"的 P0 复发，
        //    以及用户滚到一半被程序滚动的索引回调误判回跟随）。
        const userDriven: boolean = this.userScrollFrame && this.lastScrollWasUser;
        // 一次性消费（避免泄漏到后续程序滚动帧）。
        this.userScrollFrame = false;
        if (userDriven) {
          const busyPlaceholder: boolean = showsBusyPlaceholder(this.busySignals());
          const liveRows: number = this.hasLiveRow ? 1 : 0;
          const itemCount: number = listItemCount(this.hasHeadItem(), busyPlaceholder,
            this.rowDs.count(), liveRows);
          // 用户滚回底部 ⇒ 恢复跟随（web `checkBottomAndResume()` 同义）；否则保持暂停。
          // ⛔ 恢复**必须**用精确位置判据 `isAtEnd()`（第 5 实参）—— 索引判据在
          //    "末项 = 高到占满视口的在飞 live 行"时会**误判已回底**（用户 2026-10-12 亲报的
          //    "流式时上滚被强行拉回"就是它；论证见 `core/listfollow.ets:nextFollowBottom`）。
          this.followBottom = nextFollowBottom(this.followBottom, true, end, itemCount,
            this.listScroller.isAtEnd());
        }
        // 对齐 web：滚到顶部**自动**拉更早历史（web 用 IntersectionObserver 哨兵，同语义），
        // 不再要求用户先点一下按钮。loadingMore 自锁，避免请求风暴。
        // ⛔ 触发点**取证日志**（P0 2026-10-15「滑到顶不加载」）：`store.loadMore()` 入口的
        //    `[LM] enter`（`core/store.ets:1010`）在守卫**之前**，而实测 `[LM]` 计数 = 0
        //    ⇒ 触发链**从未调到 store.loadMore()**。剩下的可能只有三种，且都必须靠设备侧
        //    数值才能分辨（远程无法推断）：
        //      ① 本回调压根不是 `start === 0`（没真的滑到顶 / 头项不在首位）；
        //      ② 页级守卫被挡：`loadingMore` 或 `hasMore` 的**页面镜像**陈旧（`syncFrom` 每帧
        //         从 store 镜像，见 `:2097`）；
        //      ③ 头项判据 `hasHeadItem()` 为假（头项不在列表首位 ⇒ 下标 0 是消息行）。
        //    ⇒ 凡滚到顶（含"差一行"的边界帧）都留一行三标志快照；命中 `start === 0` 时前缀
        //    换成 `[LMP] top`，便于 `grep -c` 直接读出"触发到底有没有到过顶"。
        if (start <= 1) {
          console.debug(`[LMP] ${start === 0 ? 'top' : 'near'} start=${start} hasMore=${this.hasMore ? 1 : 0}`
            + ` loading=${this.loadingMore ? 1 : 0} head=${this.hasHeadItem() ? 1 : 0}`
            + ` hidden=${hiddenRowCount(this.rows.length, this.rowLimit)} rows=${this.rows.length}`
            + ` limit=${this.rowLimit}`);
        }
        if (start === 0) {
          // ⚡ C 线审计 2026-10-14（用户亲报「更早的历史为什么要点击而不是自动加载？」）：
          //   web 权威 = 滚到顶哨兵**自动 fetch + 立即揭示**（MessageList.tsx 的 IntersectionObserver）；
          //   旧版自动路径只接 fetch ⇒ 两种「抓了不给你看」：① fetch 的行进了内存但 rowLimit 渲染窗
          //   不动 ⇒ 屏幕零变化（长会话常态）；② hasMore=false 而 hidden>0 的**死角**（一次已拉全的
          //   13~100 行会话，自动判据恒不触发、只能点）。
          //   ⇒ 与头项点击双支（`hasHeadItem()`/onClick）**同源同序**：先本地揭示（零网络、行已在
          //   内存、12 行/批保持窗口 diff 预算），没有可揭示的了才网络 fetch。头项点击保留兜底
          //   （万一自动触发没打到，例如列表尚未滚动）。节流面：onScrollIndex 只在区间变化时回调
          //   ⇒ 顶住不动不重发（天然 arm/disarm）；`loadingMore` 自锁防请求风暴。
          if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
            this.widenRowWindow();
          } else if (!this.loadingMore && this.hasMore) {
            this.loadMore();
          }
        }
      })
      // ★ 停止滚动时的**位置式**复位（用户 2026-10-12 真机亲报「滚回最下方『回到最新』不消失」；
      //   真机截图实证：列表已停在末项、药丸仍常驻）——
      //   `onWillScroll` 对**每个用户帧**置 `followBottom=false`（含贴底之后的回弹/惯性帧），
      //   而 `onScrollIndex` **只在可见索引区间变化**时才回调 ⇒ 末帧"已贴底但索引未变"时
      //   **无人复位**。`isAtEnd()` 判**滚动位置**、与索引区间无关 ⇒ 贴底停手即恢复跟随。
      //   判据与状态**同源**（`core/listfollow.ets:followAfterScrollStop`，脱机单测 + mutation 自证）。
      .onScrollStop(() => {
        // 位置只在**滚动停止**时采样：弹性过滚动期间 `isAtEnd()` 判假、不可用（实测）；
        // 停止时采样得到的是**稳定**位置 ⇒ 同时喂给「恢复跟随」与药丸的贴底闸门。
        const atEnd: boolean = this.listScroller.isAtEnd();
        this.followBottom = followAfterScrollStop(this.followBottom, atEnd);
        this.atEndUi = atEnd;
      })
      .onReachStart(() => {
        if (!this.loadingMore && this.hasMore) {
          this.loadMore();
        }
      })
      .id('xbot-list')

        // 用户消息导航（右上角 32×32 悬浮按钮 + 浮层列表）。`anchors`/`activeSeq` 由本页
        // 用核心纯函数派生；点击条目 ⇒ `navToRow` 纯滚动（绝不触发"加载更多"）。
        MessageNav({
          anchors: this.navAnchors(),
          // ⛔ 不再传 `activeSeq`：真源是 AppStorage（`MessageNav` 用 `@StorageProp` 自己订阅）⇒
          //    滚动跨锚点时**页级 build 零参与**（传参就必须把它存成页级 `@State` ⇒ 整页重跑）。
          theme: this.themeName,
          onNavigate: (rowIndex: number) => {
            this.navToRow(rowIndex);
          },
          // ── 输出搜索（web 没有——原生超越）：页面持有全行 ⇒ 在这里算 hits 回填。──
          // searchHits 只在**打字时**写（非滚动路径）⇒ 无 LazyForEach 掉帧风险（对比 activeSeq 教训）。
          hits: this.rowHits,
          onSearch: (q: string) => {
            this.rowHits = rowSearchHits(this.rows, q);
          },
          onPickHit: (rowIndex: number) => {
            this.navToRow(rowIndex);
          },
        })
        .margin({ top: SP_2, right: SP_2 })

        // 「回到最新」—— **悬浮提示**（叠在消息区之上、贴底居中；⛔ **不占布局行** ⇒ 不挤压历史）。
        // 出现条件与原实现一致（`showsJumpToLatest` 纯函数：跟随暂停 + 确有内容）。
        // 命中盒：`onClick` 落在 **≥ HIT_TARGET_MIN(44) 的布局盒** 上 —— 原实现用 `responseRegion`
        //   负偏移外扩热区，**真机实测无效**（`docs/ARKTS-GOTCHAS.md`）；视觉药丸尺寸不变，只是把它
        //   居中放进一个 44 高的透明命中盒（与 `components/Toast` 同一「全屏透明容器 + 底对齐」手法）。
        if (showsJumpToLatest(this.followBottom, this.rows.length, this.atEndUi)) {
          Column() {
            Row() {
              Text('回到最新').fontSize(typeOf('type.caption').size).fontColor(this.pal().textPrimary)
                .padding({ left: SPACE_SM, right: SPACE_SM, top: 7, bottom: 7 })
                .backgroundColor(this.pal().accentDeep)
                .borderRadius(RADIUS_SHEET)
            }
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: SPACE_MD, right: SPACE_MD })
            .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
            .onClick(() => {
              // 用户显式要求回到底部 ⇒ 意图置为跟随（与切会话同一语义）
              this.listScroller.scrollEdge(Edge.Bottom);
              this.followBottom = true;
            })
          }
          .width('100%').height('100%')
          .justifyContent(FlexAlign.End)
          .alignItems(HorizontalAlign.Center)
          .padding({ bottom: SPACE_MD })
          // ⛔ 不吃任何命中：容器透明（子药丸可点；下方列表照常滚动/点击）—— 与 `components/Toast`
          //    **同一口径**（`Toast.ets:95` 也是 `None`）。
          //    ⚠️ 此前这里写的是 `HitTestMode.Transparent`：它**让容器自身也参与命中测试**
          //    （Transparent = "自身 + 子 + 兄弟都响应"），而本容器是 **100%×100% 全屏**覆盖层 ⇒
          //    它会把消息区上方整片区域纳入自己的响应面。模拟器隔离对照实测：同样的上滑手势
          //    （`swipe x=660`，路径**掠过**药丸）把视角带向**更新**内容（= 药丸的
          //    `scrollEdge(Bottom)` 生效了），而 `x=200`（避开药丸）正常上行 ⇒ 滑动手势会误触药丸。
          //    改 `None`（"自身不响应，子组件响应"）后覆盖层对命中测试完全透明，只有药丸 44 盒响应。
          .hitTestBehavior(HitTestMode.None)
          // 「回到最新」的**浮现/隐去** = 纯淡入淡出（无空间含义 ⇒ 不滑入）—— 走底座具名工厂
          // `fadeTransition()`，与 `components/Toast`（**同为**「全屏透明容器 + 底对齐」的悬浮提示）
          // 同一族；此前是"啪"地出现/消失（`Toast` 早已有过渡，本处却漏了 ⇒ 观感不一致）。
          // 静息态 = 组件自身属性 = **可见** ⇒ fail-safe（门禁 ⑨；⛔ 不用 `.opacity(cond ? 1 : 0)`）。
          .transition(fadeTransition())
        }
      }
      .layoutWeight(1).width('100%')
      // 会话面切换的入场位移（用户亲报「切换会话后要有动画，现在没有」）：静息态 = `switchSlide` 恒 0
      // ⇒ 与原先逐字节一致；切换瞬间由 `switchSession()` 置 1、下一帧经 `this.anim()` 归零。
      // ⛔ 只动 `translate`：**不碰不透明度** ⇒ 动画即使被打断，内容也只是偏移若干 vp、完全可读
      //    （本仓血债「可读性不能是动画的函数」；门禁 ⑨ / `tools/lint/anim-opacity-gate.sh`）。
      .translate({ y: this.switchSlide * MOTION_SESSION_SWITCH_SLIDE_VP })
      if (this.statusBarText().length > 0) {
        Row({ space: 8 }) {
          // 上下文用量环（web `ContextRing.tsx` 同构）：常驻可视，≥80% 变告警色。
          // ⛔ 无服务端用量时**不挂载**（web 画空轨道；这里整环不出现，绝不显示 "0%" 假值）。
          if (ctxHasUsage(this.usage)) {
            ContextRing({
              percent: ctxPercent(this.usage),
              label: ctxLabel(this.usage),
              theme: this.themeName,
            })
          }
          // ⛔ "详情"的 onClick 绑在**这层内 Row**（不是外层 Row）：环自己带点击（弹明细浮层），
          //    ArkUI 里更内层的 onClick 会吃掉事件 ⇒ 绑在外层就点不到"详情"。内 Row 用
          //    layoutWeight(1) + 垂直 padding 补齐热区（≈ 改造前的整行可点面积）。
          Row({ space: 10 }) {
            Text(this.statusBarText())
              .fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.todoCount() > 0 || this.goalLine().length > 0) {
              Text('详情').fontSize(typeOf('type.caption').size).fontColor(this.pal().accentSoft).padding({ left: 6, right: 6 })
            }
          }
          .layoutWeight(1)
          .padding({ top: SPACE_XXS, bottom: SPACE_HAIR })
          .onClick(() => {
            this.anim(() => {
              this.showStatus = true;
            });
          })
        }
        .width('100%').padding({ left: 10, right: 10 })
      }

      // 弱网：连接断开时明确告知（并说明恢复后会自动补齐，避免用户重复发）
      if (this.connState === 'reconnecting' || this.connState === 'connecting') {
        Row({ space: 6 }) {
          LoadingProgress().width(14).height(14).color(this.pal().warn)
          Text('连接断开，正在重连…（恢复后自动补齐消息）')
            .fontSize(typeOf('type.caption').size).fontColor(this.pal().warn).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%').padding({ left: SPACE_SM, right: SPACE_SM, top: 6, bottom: 6 })
        .backgroundColor(this.pal().warnBg)
      } else if (this.connState === SSE_STATE_FAILED) {
        // 终态（服务端明确拒绝：404 会话不存在 / 403 无权 / 400 参数…）——
        // ⛔ 不再显示"正在重连"（它永不成功，是**误导性静默**，见
        //    `docs/REDESIGN-INPUT-STATES.md §F4`）。给可解释原因 + 明确出口。
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
            .fontSize(typeOf('type.callout').size).fontColor([this.pal().dangerText])
          Text(`连接被服务端拒绝：${this.sseTerminalReason()}`)
            .fontSize(typeOf('type.caption').size).fontColor(this.pal().dangerText).layoutWeight(1)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('重试').fontSize(typeOf('type.caption').size).fontColor(this.pal().accentSoft).padding(6)
            .stateStyles({ pressed: { .opacity(0.7) }, normal: { .opacity(1) } })
            .onClick(() => {
              const st: ChatStore | null = this.store;
              if (st !== null) {
                st.sse.forceReconnect();
              }
            })
        }
        .width('100%').padding({ left: SPACE_SM, right: SPACE_SM, top: 6, bottom: 6 })
        .backgroundColor(this.pal().warnBg)
      }

      // 上次发送失败 ⇒ 一键重试（不必重新打字）
      if (this.failedSend.length > 0) {
        Row({ space: 8 }) {
          Text('上次发送失败').fontSize(typeOf('type.caption').size).fontColor(this.pal().dangerText).layoutWeight(1)
          Text('重试').fontSize(typeOf('type.caption').size).fontColor(this.pal().warn).padding(6)
            .stateStyles({ pressed: { .opacity(0.7) }, normal: { .opacity(1) } })
            .onClick(() => {
              const t: string = this.failedSend;
              this.failedSend = '';
              this.draft = t;
              this.sendDraft();
            })
          Text('丢弃').fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary).padding(6)
            .onClick(() => {
              this.failedSend = '';
            })
        }
        .width('100%').padding({ left: 10, right: 6, top: 6, bottom: SPACE_HAIR })
      }

      // 输入补全（/ 命令 或 @ 文件）—— 候选浮层（选中态 + 键盘导航，对齐 web CompletionPopup.tsx）
      if (this.completionOpen()) {
        Column({ space: 2 }) {
          if (this.cmdItems.length > 0) {
            ForEach(this.cmdItems.slice(0, CMD_ROWS), (c: CommandItem, i: number) => {
              Row({ space: 8 }) {
                Text(c.name).fontSize(typeOf('type.subhead').size).fontColor(this.pal().accentText).constraintSize({ maxWidth: 150 })
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(c.desc).fontSize(typeOf('type.caption').size).fontColor(this.pal().textMuted).layoutWeight(1)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%').padding({ left: 10, right: 10, top: 7, bottom: 7 })
              .backgroundColor(i === this.cmdSel ? colorOf(this.pal(), 'accentDeep') : this.pal().surface)
              .borderRadius(RADIUS_CHIP)
              .onClick(() => {
                this.cmdSel = i;
                this.pickCommand(c.name);
              })
            }, (c: CommandItem) => `cc-${c.name}`)
          }
          if (this.fsMatches().length > 0) {
            ForEach(this.fsMatches().slice(0, FS_ROWS), (e: FsEntry, i: number) => {
              Row({ space: 8 }) {
                Text(e.isDir ? '目录' : '文件').fontSize(typeOf('type.caption').size)
                Text(e.name).fontSize(typeOf('type.subhead').size).fontColor(this.pal().textPrimary).layoutWeight(1)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(this.fsDir).fontSize(typeOf('type.micro').size).fontColor(this.pal().textMuted)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 120 })
              }
              .width('100%').padding({ left: 10, right: 10, top: 7, bottom: 7 })
              .backgroundColor(i === this.cmdSel ? colorOf(this.pal(), 'accentDeep') : this.pal().surface)
              .borderRadius(RADIUS_CHIP)
              .onClick(() => {
                this.cmdSel = i;
                this.pickFile(e);
              })
            }, (e: FsEntry) => `fe-${e.name}#${e.isDir}`)
          }
        }
        .width('100%').padding({ left: SPACE_XS, right: SPACE_XS, bottom: SPACE_XXS })
        .backgroundColor(this.pal().appBg).borderRadius(RADIUS_PILL)
        .border({ width: 1, color: this.pal().border })
      }

      // 会话标签（池里的会话，切回瞬时；● 表示该会话正在跑）
      if (this.poolOrder.length > 1) {
        Scroll() {
          Row({ space: 6 }) {
            ForEach(this.poolOrder, (cid: string) => {
              Row({ space: 4 }) {
                Text(this.tabLabel(cid)).fontSize(typeOf('type.caption').size)
                  // 选中态底色是**浅填充** `accentDeep`（浅色系 = 强调色 lighten(0.78)）⇒ 字色必须用
                  // `accentText`（角色定义即"强调色浅底上的文字"）；`onAccent` 是为**实心** accent 底
                  // 设计的白字，压在浅填充上浅色主题仅 1.1x（见对比度台账 B）
                  .fontColor(cid === this.currentChat ? this.pal().accentText : this.pal().textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 90 })
                if (this.tabRunning(cid)) {
                  Row().width(6).height(6).borderRadius(6 / 2).backgroundColor(this.pal().successText)
                }
                SymbolGlyph($r('sys.symbol.xmark')).fontSize(11).fontColor([colorOf(this.pal(), 'iconMuted')])
                  .accessibilityText('关闭标签页')
                  .onClick(() => {
                    this.closeTab(cid);
                  })
              }
              .padding({ left: SPACE_XS, right: 6, top: SPACE_XXS, bottom: SPACE_XXS })
              .backgroundColor(cid === this.currentChat ? this.pal().accentDeep : this.pal().surfaceAlt)
              .borderRadius(RADIUS_CHIP)
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
        // ⛔ H0：横向滚动区自身 `clip(true)`（否则内容撑宽父级 ⇒ 溢出屏）
        .clip(true)
      }

      // 附件 chips：每条独立状态（⏳ 上传中 / 📎 已就绪 / ⚠ 失败可重试），✕ 移除
      if (this.attachments.length > 0) {
        Column({ space: 4 }) {
          ForEach(this.attachments, (it: AttachItem, i: number) => {
            Row({ space: 6 }) {
              Text(attachChipText(it))
                .fontSize(typeOf('type.caption').size)
                .fontColor(it.status === ATTACH_FAILED ? this.pal().dangerText : this.pal().accentSoft)
                .layoutWeight(1).maxLines(1).wordBreak(WordBreak.BREAK_ALL)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(it.status === ATTACH_FAILED ? '重试' : '移除')
                .fontSize(typeOf('type.caption').size)
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
        .width('100%').padding({ left: 10, right: SPACE_XXS, top: 6 })
      }

      // ── 待发队列托盘（web `workspace/panels/AgentPanel.tsx:1094` 的 `<StagingTray>` 排在
      //    `MessageList` 与 `MessageInput` **之间**）—— 本仓落在输入区**正上方**、Goal 横幅
      //    **之前**，即 web 的同一相对位置（列表 → 托盘 → 输入区）。组件自身以
      //    `queue.length > 0` 短路（空 ⇒ 零节点）⇒ 无条件挂载 == web 的条件挂载（同一判据）。
      //    它把「后面还排着几条 / 下一条是什么」提到一眼可见（顶栏 `队列 N` chip 只管"有没有"）。
      StagingTray({
        theme: this.themeName,
        queue: this.queue,
        onOpenManager: () => {
          this.showQueue = true;
        },
        onInterject: (id: string, full: string) => {
          this.store?.interjectQueued(id, full);
        },
        onCancel: (id: string) => {
          this.store?.cancelQueued(id);
        },
      })

      // ── Goal 横幅（web `MessageInput.tsx:694`：`{goal ? <GoalBanner goal={goal} onEdit
      //    onClear/> : null}` —— 挂在输入胶囊**正上方**）。组件自身以 `goalDisplay().visible`
      //    短路（无目标 ⇒ 零节点）⇒ 无条件挂载 == web 的条件挂载（同一显示判据）。
      GoalBanner({
        objective: this.goalObjective,
        status: this.goalStatus,
        theme: this.themeName,
        onEditGoal: (v: string) => {
          this.handleSetGoal(v);
        },
        onClearGoal: () => {
          this.handleClearGoal();
        },
      })

      // ── 「添加目标」内联输入（web `MessageInput.tsx:695-726` 的 `addingGoal` 分支 ——
      //    位置在 GoalBanner 与 TodoPullOut **之间**，同一列）。由 TodoPanel 的 🎯 打开。
      if (this.addingGoal) {
        Row({ space: SP_2 }) {
          SymbolGlyph($r('sys.symbol.dart_target')).fontSize(ICON_MD).fontColor([this.pal().accent])
          TextInput({ text: this.goalDraft, placeholder: '输入目标…' })
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .placeholderColor(this.pal().textMuted)
            .backgroundColor(this.pal().transparent)
            .borderRadius(R_MD)
            .border({ width: 1, color: withAlpha(this.pal().accent, 0.4) })
            .layoutWeight(1)
            .onChange((v: string) => {
              this.goalDraft = v;
            })
            .onSubmit(() => {
              this.commitAddingGoal();
            })
          Text('回车保存')
            .fontSize(typeOf('type.micro').size).fontColor(this.pal().textMuted)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        // web：`mx-2 mb-1.5 … rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5`
        .padding({ left: 10, right: 10, top: 6, bottom: 6 })
        .backgroundColor(withAlpha(this.pal().accent, 0.05))
        .borderRadius(R_MD)
        .border({ width: 1, color: withAlpha(this.pal().accent, 0.3) })
        .margin({ left: SP_2, right: SP_2, bottom: SP_1 + 2 })
      }

      // ── Todo 拉出面板（web `MessageInput.tsx:728-742`：`{todoState ? <TodoPullOut .../> : null}`
      //    —— 紧随 GoalBanner 之后、同在输入胶囊上方）。组件自身以 `hasTodos` 短路（空 ⇒ 零节点）。
      //    `goalText` 用于行尾 goal 徽标；`hasGoal` 决定右侧 🎯「设为目标」（web `:730-741`）。
      TodoPanel({
        todos: this.todos,
        goalText: this.goalObjective,
        hasGoal: this.goalObjective.length > 0 || this.addingGoal,
        theme: this.themeName,
        onSetGoal: () => {
          this.addingGoal = true;
        },
        // ⛔ 能力开关走显式布尔（回调默认值是 no-op 非 undefined ⇒ "靠 undefined 判能力"恒真）
        canSetGoalTodo: true,
        onSetGoalTodo: (t: string) => {
          // web `:305` 同义：用该行文本直接设为目标（服务端 `set_goal`，与 🎯 同一出口）
          this.handleSetGoal(t);
        },
        onToggleTodo: (i: number) => {
          this.pushTodos(toggleTodoAt(this.todos, i));
        },
        onRenameTodo: (i: number, t: string) => {
          this.pushTodos(renameTodoAt(this.todos, i, t));
        },
        onRemoveTodo: (i: number) => {
          this.pushTodos(removeTodoAt(this.todos, i));
        },
      })

      // rewind 编辑态提示条（在输入胶囊上方；仅编辑态渲染）
      if (this.rewindEditRowId.length > 0) {
        this.RewindEditBar()
      }

      // ── 输入区：**子代理会话不渲染**（web 权威 `AgentPanel.tsx:1114` 的 `!isSubAgent && <MessageInput/>`）──
      // 为什么：子代理会话**没有独立持久化历史**（服务端 `/api/history` 实测 `messages:null`），
      // 它在服务端的角色是"父轮次里的进度"，不是可对话的会话 ⇒ 给它挂输入框会明确误导用户
      // （"可以在这聊"），也正是「子代理会话进入后永远空白」观感的一半来源（空白 + 一个能打字的框）。
      // ⛔ 判据见 `isSubAgentChat()`（唯一来源 `core/sessiongroup.parseAgentChatID`）。
      if (!this.isSubAgentChat()) {
      // 输入区：**单一面**（附件 / 输入 / 发送共用一条胶囊），靠留白分层，不靠描边。
      Row({ space: SP_1 }) {
        SymbolGlyph($r('sys.symbol.paperclip')).fontSize(22).fontColor([this.pal().textSecondary])
          .padding({ left: SP_3, right: SP_1, top: SP_2, bottom: SP_2 })
          .stateStyles({ pressed: { .opacity(0.5) }, normal: { .opacity(1) } })
          .accessibilityText('添加附件')
          .onClick(() => {
            this.pickFiles();
          })
        SymbolGlyph($r('sys.symbol.picture')).fontSize(22).fontColor([this.pal().textSecondary])
          .padding({ left: SP_1, right: SP_1, top: SP_2, bottom: SP_2 })
          .stateStyles({ pressed: { .opacity(0.5) }, normal: { .opacity(1) } })
          .accessibilityText('添加图片')
          .onClick(() => {
            this.pickImages();
          })
        // 占位文案**随状态/模式变化**（web `MessageInput.tsx:214-221` 同源；判据 `core/composer.ets`）：
        // idle/busy 排队/插话 三态各不相同 —— busy 时输入框是用户**看得见的下一条反馈**，
        // 必须提前说清"按下去是排队还是打断"（插话语义与普通发送相反）。
        // ⛔ 文案一律单行：真机实测可用宽 240vp，web 桌面文案（含 `（Ctrl+Enter 发送）`）会换行被裁；
        //    "回车键什么行为"由下方 `.enterKeyType(...)`（软键盘回车键标签）表达，不重复塞进占位。
        TextArea({ placeholder: composerPlaceholder(this.composerBtn().running, isInterruptSend(this.composerBtn().running, this.sendMode)), text: this.draft })
          // 深链 `input.focus` 的落点（`focusControl.requestFocus(COMPOSER_INPUT_ID)`）
          .id(COMPOSER_INPUT_ID)
          .onChange((v: string) => {
            this.draft = v;
            this.refreshCompletion(v);
            this.scheduleDraftSave(v);
          })
          .enterKeyType(enterSends(this.sendKeyMode()) ? EnterKeyType.Send : EnterKeyType.NEW_LINE)
          // 补全浮层的键盘导航（↑↓ / Tab / Esc）—— 只在浮层打开时消费，不影响正常输入。
          .onKeyEvent((e: KeyEvent) => {
            this.onComposerKey(e);
          })
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
          .backgroundColor(this.pal().transparent).fontColor(this.pal().textPrimary)
          .placeholderColor(this.pal().textMuted)
          .fontSize(typeOf('type.body').size)
          .borderRadius(0).padding({ left: 0, right: 0 })
          .onSubmit(() => {
            // `@` 文件浮层打开时回车 = 接受选中候选（web `useCompletion.ts:383`）；否则按发送键模式发送。
            if (this.completionOpen() && completionKeyAction('Enter', this.fsActive(), false) === 'accept') {
              this.acceptCompletion();
              return;
            }
            if (enterSends(this.sendKeyMode())) {
              this.sendDraft();
            }
          })
        if (this.composerBtn().running) {
          Text(modeLabel(this.sendMode))
            .fontSize(FS_CAPTION)
            .fontColor(this.sendMode === MODE_INTERRUPT ? this.pal().warn : this.pal().textMuted)
            .padding({ left: SP_2, right: SP_2 })
            .stateStyles({ pressed: { .opacity(0.5) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.sendMode = toggleMode(this.sendMode);
              this.toast(modeHint(this.sendMode));
            })
        }
        // 唯一的主按钮 —— 语义**逐字对齐 web** `MessageInput.tsx:686-687/935-939`：
        //   · 有内容（`composerCanSend`）⇒ **发送**（busy 时按 `sendMode` = 插队/排队）；
        //   · busy 且无内容 ⇒ **停止**；停止请求在飞 ⇒ **转圈**（`LoadingProgress`）。
        //   ⇒ 用户要求「busy 时输入了文字 ⇒ 按钮自动变插队/排队」= web 同一规则（此前原生缺）。
        // ⚠️ `SymbolGlyph` 一旦给了固定 width/height **不会自动把图标居中**（图标会偏上/偏左）——
        //    必须用 `Stack({alignContent: Alignment.Center})` 显式居中；圆形底、阴影、点击态挂在内层。
        // ⛔ 热区：真机实测 `responseRegion` 的负偏移外扩**不生效**（AGENTS.md GOTCHA）⇒ 用**真实
        //    44×44 布局盒**承载点击（盒**透明**、32 圆居中 ⇒ 观感不变、命中区真的 ≥44）。
        Stack() {
          Stack({ alignContent: Alignment.Center }) {
            if (this.composerCancelling()) {
              LoadingProgress()
                .width(typeOf('type.callout').size)
                .height(typeOf('type.callout').size)
                .color(this.pal().textSecondary)
            } else {
              // ⚡ 插话模式（busy + 有内容 + `sendMode===interrupt`）时图标换成 `bolt`（逐字对齐
              //    web `MessageInput.tsx:941` 的 `interruptMode ? <Zap/> : busy ? <Mail/> : <Send/>`）：
              //    "点了这一下会把消息**注入正在跑的回合**"必须一眼可辨，不能与普通发送共用纸飞机
              //    （用户要求「busy 时输入文字 ⇒ 按钮变插队/排队」的**视觉**落点；文字 chip 仍标模式名）。
              SymbolGlyph(this.composerShowStop()
                ? $r('sys.symbol.square_fill')
                : (this.composerBtn().interject ? $r('sys.symbol.bolt_fill') : $r('sys.symbol.paperplane_fill')))
                .fontSize(typeOf('type.callout').size)
                .fontColor([this.composerShowStop() ? this.pal().textSecondary : this.pal().onAccent])
                // ── 状态过渡：**同一个主按钮**的语义在「发送 → 插话 → 停止」之间切换 ────────────
                // 用户要求「busy 时输入了文字 ⇒ cancel 按钮自动变成插队/排队按钮」的**视觉**落点；
                // 图标**换**的那一下用 Apple SF Symbols 的 replace 惯用法过渡，而不是硬切。
                // ⛔ `ReplaceSymbolEffect` 是**一次性**子类 ⇒ `tools/lint/inflight-single-source.sh`
                //    的 A 类（循环动效）不管它，归其 B2 约束（已在脚本注释里明列）。
                // ⚠️ 必须显式选 `CROSS_FADE`：这三枚符号（paperplane / bolt / square）**彼此无关**
                //    （不是同一符号的变体）⇒ 默认的 `SEQUENTIAL` 不适用（SDK `symbolglyph.d.ts:265-300`
                //    的 `ReplaceEffectType`：SEQUENTIAL=0 / CROSS_FADE=1 / SLASH_OVERLAY=2）。
                .symbolEffect(new ReplaceSymbolEffect(EffectScope.WHOLE, ReplaceEffectType.CROSS_FADE))
            }
          }
          // 视觉 32vp（`SPACE_XXL`；⛔ 无 `control.send` token，见交付缺 token 清单）
          .width(SPACE_XXL).height(SPACE_XXL)
          .borderRadius(RADIUS_SHEET)   // = 32/2 ⇒ 正圆
          .backgroundColor(this.composerShowStop() ? this.pal().surfaceHi : this.pal().accent)
          .shadow({ radius: this.composerShowStop() ? 0 : shadowRadiusOf(this.pal(), 'pill'), color: this.composerShowStop() ? this.pal().transparent : shadowColorOf(this.pal(), 'raised'), offsetX: 0, offsetY: 0 })
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY).scale({ x: PRESS_SCALE, y: PRESS_SCALE }) }, normal: { .opacity(1).scale({ x: 1, y: 1 }) } })
        .accessibilityText(this.composerShowStop() ? '停止' : '发送')
        .onClick(() => {
          if (this.composerShowStop()) {
            this.cancelTurn();
          } else {
            this.sendDraft();
          }
        })
      }
      .width('100%')
      .constraintSize({ minHeight: 56 })
      .padding({ left: SP_1, right: SP_1 })
      // 输入面 = 语义面 `surface.input`；**静息 = 结构性发丝**（浅色系靠它立边），
      // **聚焦才描边 `accent`**（⛔ 静息不描 accent）。圆角 = `RADIUS_CARD`（对齐样张 ①）。
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.input'))
      .borderRadius(RADIUS_CARD)
      .border({
        width: STROKE_HAIRLINE,
        color: this.composerFocused ? this.pal().accent : hairlineOf(this.pal()),
      })
      .margin({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
      .id('xbot-composer')
      }   // ← 关闭「子代理会话不渲染输入区」的 `if (!this.isSubAgentChat())`（见该块头注）

      // ── 常驻信息栏（插件**声明式 widget** 的落点）────────────────────────────────
      // 权威（web，逐条核对）：`MobileAppShell.tsx:483-487` 在 `main` **下方**常驻 `<InfoBar/>`
      //   → `plugins/InfoBar.tsx:15-27`：`WidgetZone zone="infoBar" excludePrefixes={['git:']}`
      //   → `WidgetZone.tsx:56-69`：无 span ⇒ 零节点。
      // ⛔ 显示判据**唯一**在 `core/widgetsview.widgetDockView`（复用 `widgetsView` 的同一次解析）
      //   ⇒ 无 `infoBar` widget 时**零节点 / 零高度**，与改造前的聊天页布局逐字节一致。
      WidgetDock({
        content: this.widgetContent,
        event: this.widgetEvent,
        theme: this.themeName,
      })
    }
    .width('100%').height('100%')
  }

  // ── P7：会话管理 ─────────────────────────────────────────────────────────

  /** 抽屉里显示的会话（本地筛选：按名字/chat_id，大小写不敏感）。 */
  private filteredSessions(starredIn?: string[]): SessionItem[] {
    // ── 幽灵行消除（`core/sessionpick.dedupeSessionItems`，纯函数 + 单测）──────────────
    // 服务端 `/api/session-tree` 会把**同一会话的两行**并排下发：真身 `chat_X`（label
    // `harmony-ui-dev` + 19 个子代理）与历史 bug 造出的幽灵 `web:chat_X`（**label 就是这串原始
    // 会话键**）。抽屉按行渲染 ⇒ 用户看到一条叫 `web:chat_026B326DE4C4` 的垃圾行（用户口径③
    // "侧边栏丑"的一类）。**同渠道 + 同规范 id** 只留信息量最大的一行（判据 `sessionBodyScore`）。
    // ⛔ web 侧不做这件事（`session-grouping.ts:13` 直接 `${channel}:${chatID}` 拼键）⇒ 这里是
    //    口径③允许的**超越**，不是偏离：被丢弃的行严格更少信息（0 子节点、无真人名、默认 cwd）。
    const rows: SessionItem[] = dedupeSessionItems(this.sessions);
    const out: SessionItem[] = [];
    for (let i = 0; i < rows.length; i++) {
      const s: SessionItem = rows[i];
      const label: string = s.label !== undefined ? s.label : '';
      // 归属判据：自身 channel ∪ parent_channel ∪ children.parent_channel（web SessionSidebar:99-106）
      if (sessionMatches(label, s.chat_id, this.sessQuery)
        && sessionInChannel(s, this.activeChannel)) {
        out.push(s);
      }
    }
    // 星标优先（对齐 web `sortSessions` 的第一关键字）；同组内保持服务端下发顺序，
    // 不重排其余项 —— 避免与既有的置顶/上移/下移打架。
    // ⚡ 性能热点（抽屉）：`starredIds()` 是 `parseStarred(settingOf(...))` = **每次都 JSON 解析**；
    // 调用方（`drawerGroups`）已算过一次 ⇒ 传入复用（⛔ 不改变语义：同一帧内 settings 不变）。
    const starred: string[] = starredIn !== undefined ? starredIn : this.starredIds();
    if (starred.length === 0) {
      return out;
    }
    const order: string[] = [];
    const byId: Map<string, SessionItem> = new Map<string, SessionItem>();
    for (let i = 0; i < out.length; i++) {
      order.push(out[i].chat_id);
      byId.set(out[i].chat_id, out[i]);
    }
    const sorted: string[] = starredFirst(order, starred);
    const res: SessionItem[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const it: SessionItem | undefined = byId.get(sorted[i]);
      if (it !== undefined) { res.push(it); }
    }
    return res;
  }

  // ── 会话分组（纯逻辑在 `core/sessiongroup.ets`；这里只做"取分类 + 配对原始行"）──────

  /**
   * 生效分类：**读服务端设置里的 `xbot:session-category`**（与 web 共用同一个键，
   * 映射到 `web:session:category` —— 见 `core/settings.ets`），经 `normalizeSessionCategory` 归一化。
   *
   * ⚠️ `migrated` 传 `true`：只尊重已存的值，**不做** web 的"一次性 `time → path` 迁移"——
   *   那个迁移要一个 marker 键（web 放在 localStorage），原生端没有该键位（新增键需动
   *   `core/settings.ets`，本波禁改）。对"网页端已迁移过"的用户语义等价（读到的就是 `path`）。
   */
  private sessionCategory(): string {
    const srv: string = settingOf(this.settings, KEY_SESSION_CATEGORY);
    if (srv.length > 0) {
      return normalizeSessionCategory(srv, true);
    }
    // 服务端设置**尚未到达**（冷启首帧 / 离线 / 本用户从未在服务端存过）⇒ 用**本地镜像**
    // （用户"上次选的那个"）；都没有才回落默认『项目』。⇒ 首帧就"记得"，且服务端一到就接管。
    return normalizeSessionCategory(this.localSessionCategory, true);
  }

  /**
   * 切分类：乐观生效 + **双写**（本地镜像 + 服务端，与其它设置同一条路径）。
   * 本地写只为**首帧**；服务端写才是跨设备真值 ⇒ 两条都必须有（缺本地 ⇒ 冷启首帧闪默认值；
   * 缺服务端 ⇒ 换设备/网页端看不到你的选择）。
   */
  private setSessionCategory(cat: string): void {
    this.localSessionCategory = cat;
    this.persistSessionCategory(cat);
    this.setSetting(KEY_SESSION_CATEGORY, cat);
  }

  /**
   * 本地镜像落盘（**失败不影响**本次切换 —— 见 catch 内说明）。
   *
   * ⚠️ 为什么包成独立方法而不是就地挂一个空的链式 catch：本仓吞异常台账**只许缩短**
   *   （`tools/tests/interaction_feedback.test.ts` 的 `SWALLOW_BUDGET`），新增"空 catch"会直接红。
   *   这里用**有说明的** catch（块内写清为什么可以吞）⇒ 既诚实又不触发预算。
   */
  private async persistSessionCategory(cat: string): Promise<void> {
    try {
      await this.config.saveSessionCategory(cat);
    } catch (e) {
      // 有意吞：本地镜像**写盘失败不影响本次切换**。服务端（`setSetting`）才是跨设备真值，
      // 本地盘只是"冷启首帧"用的镜像；写失败 ⇒ 下次冷启首帧回落默认『项目』，
      // 随后服务端值一到即纠正（`sessionCategory()` 的优先级：服务端 > 本地镜像 > 默认）。
      // 也**不弹 toast**：这是用户看不见的内部降级，弹了只是噪音。
    }
  }

  /** 某分组是否已折叠（键**必须**带分类前缀 —— 见 `core/sessiongroup.ets:collapseKey`）。 */
  private isGroupCollapsed(cat: string, key: string): boolean {
    const ck: string = collapseKey(cat, key);
    for (let i = 0; i < this.collapsedGroups.length; i++) {
      if (this.collapsedGroups[i] === ck) {
        return true;
      }
    }
    return false;
  }

  /** 折叠/展开一个分组（整体替换数组 ⇒ 触发重渲染）。 */
  private toggleGroup(cat: string, key: string): void {
    const ck: string = collapseKey(cat, key);
    const next: string[] = [];
    let found: boolean = false;
    for (let i = 0; i < this.collapsedGroups.length; i++) {
      if (this.collapsedGroups[i] === ck) {
        found = true;
      } else {
        next.push(this.collapsedGroups[i]);
      }
    }
    if (!found) {
      next.push(ck);
    }
    this.collapsedGroups = next;
  }

  /** 当前分类下的**分组键**（web `SessionViewBar` 的 `groupKeys` = `filteredGroups.map(g => g.key)`）。
   * 复用 `drawerGroups()` ⇒ 与列表渲染**同源**（⛔ 不另起一套分组判据）。 */
  private drawerGroupKeys(): string[] {
    const gs: DrawerGroup[] = this.drawerGroups();
    const out: string[] = [];
    for (let i = 0; i < gs.length; i++) {
      out.push(gs[i].key);
    }
    return out;
  }

  /**
   * 「全部折叠 / 全部展开」的**一体化判据**（`parity-audit` 指认的 0 消费缺口）。
   * 逐条对齐 web `SessionViewBar.tsx:37-39`：`keys` / `allCollapsed` / 点击目标 `target` 三判据合一，
   * ⛔ 页面只读它，不得再判一次（否则"图标显示展开、点的却是折叠"必分叉）。
   */
  private collapseAllPlanNow(): CollapseAllPlan {
    return collapseAllPlan(this.sessionCategory(), this.drawerGroupKeys(), this.collapsedGroups);
  }

  /** 点「全部折叠/展开」：把当前分类**所有分组**整批并入/剔除折叠集（web `setGroupsCollapsed(keys, !allCollapsed)`）。
   * 折叠态走**既有** `collapsedGroups`（与单组折叠 `toggleGroup` 同一套状态，⛔ 不自造）。 */
  private applyCollapseAll(): void {
    const plan: CollapseAllPlan = this.collapseAllPlanNow();
    this.collapsedGroups = applyGroupsCollapsed(this.collapsedGroups, plan.keys, plan.target);
  }

  /**
   * `sessions` 的 **chat_id → 行** 索引（O(n) 建一次）。
   *
   * 为什么：`drawerGroups` 原对每个分组项调一次 `sessionById`（线性扫描）⇒ **O(n²)**；
   * 抽屉每帧重建（`DrawerSheet` 直接消费 `drawerGroups()`）⇒ 6s 级主线程阻塞的嫌疑点。
   * ⚠️ **首命中优先**（`if (!has) set`）⇒ 与原逐项线性扫描**逐字等价**（重复 id 时同取首个）。
   */
  private sessionIndex(): Map<string, SessionItem> {
    const idx: Map<string, SessionItem> = new Map<string, SessionItem>();
    for (let i = 0; i < this.sessions.length; i++) {
      const s: SessionItem = this.sessions[i];
      if (!idx.has(s.chat_id)) {
        idx.set(s.chat_id, s);
      }
    }
    return idx;
  }

  /**
   * 抽屉列表的**分组视图**（唯一入口；`DrawerSheet` 只消费它）。
   *
   * 数据源 = `GET /api/session-tree`（`core/store.ets:loadSessions` → `this.sessions`）。
   * 分组/排序**全部**由 `core/sessiongroup.ets` 的纯逻辑给出，判据都是**服务端字段**（无客户端改判）：
   *   · `work_dir` → `path` 组（服务端持久化的工作目录；缺失 ⇒ `__unset__`）
   *   · `status`   → `status` 组（服务端状态机；词汇见 `STATUS_ORDER`）
   *   · `last_active` → `time` 桶（今天/昨天/更早）
   *   · 组内顺序：星标 → `sort_order` → `created_at` 升序
   * 前先把与搜索框一致的本地筛选过一遍（`filteredSessions`），空组不产出。
   */
  /**
   * A 线 2026-10-14（用户亲报「agent 工作时滚侧栏，极卡，几秒一帧」）：分组求值**签名记忆化**。
   *
   * 根因：流式期间页级 build 每圈重跑 ⇒ 本函数（filteredSessions O(n)×5 遍 + 3 次 JSON.parse +
   * O(n log n) 排序，n≈684）被拖着 22-33 次/秒重算；而抽屉观察的输入在 token 帧内不变。
   * ⇒ 同输入命中缓存 O(1) 返回；失效键 = sessions 引用恒等 + 四元指纹（星标原始串/分类/
   * 搜索词/渠道；⛔ 折叠态不进键——它只影响组内行显隐（渲染层 `isGroupCollapsed`），
   * 不改分组数据本身）。命中路径**零 JSON.parse**（星标串只参与指纹拼串）。判据=core/drawerfp。
   * 手法复刻：AnchorsMemo（§1.6h）/ liveBlocksMemo（§1.6b）。
   */
  private drawerCacheRef: object | null = null;
  private drawerCacheFp: string = '';
  private drawerCache: DrawerGroup[] = [];

  private drawerGroups(): DrawerGroup[] {
    const fp: string = drawerFingerprint(settingOf(this.settings, KEY_STARRED),
      this.sessionCategory(), this.sessQuery, this.activeChannel);
    if (drawerCacheHit(this.drawerCacheRef, this.sessions, this.drawerCacheFp, fp)) {
      return this.drawerCache;
    }
    const gs: DrawerGroup[] = this.drawerGroupsCompute();
    this.drawerCacheRef = this.sessions;
    this.drawerCacheFp = fp;
    this.drawerCache = gs;
    return gs;
  }

  private drawerGroupsCompute(): DrawerGroup[] {
    const cat: string = this.sessionCategory();
    // ⚡ 每帧只算**一次** starred（原：filteredSessions 内一次 + 这里一次 ⇒ 两次 JSON 解析）。
    const starred: string[] = this.starredIds();
    const groups: SessionGroup[] = groupSessionsFromItems(
      this.filteredSessions(starred), cat, starred);
    // ⚡ 回查改**预建索引**（原：每项一次线性扫描 ⇒ O(n²)）。
    const idx: Map<string, SessionItem> = this.sessionIndex();
    const out: DrawerGroup[] = [];
    // ⛔ **全局去重（2026-10-12 P0 根因修复）**：同一个 `chat_id` 只能出现在**一个**分组里。
    //    否则 `ForEach(g.items…)` 会出现两条**序列化完全相同**的条目 —— 而该 `ForEach` 未写 key
    //    生成器 ⇒ ArkUI 用**条目序列化值**当键 ⇒ **键重复 ⇒ 抛应用级错误**
    //    `Ids generated by the ForEach id gen function must be unique`（真机实证
    //    `Duplicated index: [43,271,315,324,337,339,346]`）⇒ **整个 `Index` 渲染中断**
    //    ⇒ **聊天区与输入框全不渲染（整页空白）**。设备侧自证：`[DUPCHK] drawerItem(n=684)→7`。
    //    用户可见症状同时包括"抽屉里同一会话出现两行"。
    const seenChat: Map<string, boolean> = new Map<string, boolean>();
    for (let i = 0; i < groups.length; i++) {
      const g: SessionGroup = groups[i];
      const items: SessionItem[] = [];
      for (let j = 0; j < g.sessions.length; j++) {
        const it: SessionItem | undefined = idx.get(g.sessions[j].chatId);
        if (it !== undefined && !seenChat.has(it.chat_id)) {
          seenChat.set(it.chat_id, true);
          items.push(it);
        }
      }
      if (items.length === 0) {
        continue;
      }
      const dg: DrawerGroup = new DrawerGroup();
      dg.key = g.key;
      dg.title = groupTitle(g.key, cat);
      dg.tip = '';
      dg.items = items;
      out.push(dg);
    }
    // path 组的**重名消歧**：web 把完整路径放在 hover tooltip（`SessionGroup.tsx:82`），
    // 原生端没有 hover ⇒ 只在"末段目录名重复"时补一行完整路径（保持列表干净）。
    // ⚡ 消歧由 O(g²) 嵌套扫描改为 **O(g)** 计数（语义逐字等价：title 出现 >1 次即"重名"）。
    const titleCount: Map<string, number> = new Map<string, number>();
    for (let i = 0; i < out.length; i++) {
      const t: string = out[i].title;
      const c: number = titleCount.get(t) !== undefined ? (titleCount.get(t) as number) : 0;
      titleCount.set(t, c + 1);
    }
    for (let i = 0; i < out.length; i++) {
      const dup: boolean = (titleCount.get(out[i].title) as number) > 1;
      out[i].tip = dup ? pathGroupTooltip(out[i].key, cat) : '';
    }
    return out;
  }

  /**
   * 抽屉的空态档位（**唯一判据**，来自 `core/indicators.ets` 的同族函数）。
   * `total` = 未筛选总数；`filtered` = 搜索词 × 渠道过滤后的数量。
   */
  private drawerEmpty(): string {
    return drawerEmptyKind(this.sessions.length, this.filteredSessions().length);
  }

  /** 「清除筛选」出口（筛选后为空时给用户可恢复的动作，⛔ 不许静默）。 */
  private clearSessFilters(): void {
    this.sessQuery = '';
    this.activeChannel = '';
    this.config.saveActiveChannel('').catch(() => {
      // 有意吞：清筛选时持久化渠道偏好失败不影响当前视图（内存态 sessQuery/activeChannel 已清）。
    });
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
    return s === undefined ? '' : sessionTitle(s.label !== undefined ? s.label : '', s.chat_id,
      s.preview !== undefined ? s.preview : '');
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
      const base: string = s !== undefined ? sessionTitle(s.label !== undefined ? s.label : '', s.chat_id,
        s.preview !== undefined ? s.preview : '') : id;
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
    if (code === 'star') {
      // 标星/取消标星（web `SessionItem.tsx` context menu 的 `session.star/unstar`）。
      // ⛔ 复用**既有**出口 `toggleStarChat`（唯一写入点；页面不另写一套 star 存储）。
      this.sessMenuId = '';
      this.toggleStarChat(id);
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
  /** `palOnce()` 的 memo（⛔ 只由 `palOnce` 读写；键 = `主题|强调色`）。 */
  private palMemoTheme: string = '';
  private palMemoAccent: string = '';
  private palMemoVal: Palette | null = null;

  // ── 抽屉底栏取色（**§21.122c 收敛**；性能预算 B 线 `pal()∨palOnce()` **只许减不许增**）──────
  // ⛔ 为什么必须收敛到方法：`@Builder`/`build()` 体内**只许写 UI 语法**（ArkTS 硬约束 ——
  //    我第一版想在底栏 `const p: Palette = this.palOnce();` 声明局部量，真门禁 ④ 直接红：
  //    `10905209 Only UI component syntax can be written here`）。所以只能在**方法**里收敛；
  //    形态与同仓 `FilesSheet.tint(role)` / `AskUserSheet.trayColor(role)` 一致：
  //    按 `role + 主题 + 强调色` 记忆化（换主题/换强调色自动失效重算）。
  private barMemoRole: string = '';
  private barMemoTheme: string = '';
  private barMemoAccent: string = '';
  private barMemoVal: string = '';
  /** 抽屉底栏取色：`'muted'`（图标弱色）/ `'text'`（标签）/ `'danger'`（退出）/ `'rule'`（发丝）。 */
  private barTint(role: string): string {
    const t: string = this.themeName;
    const a: string = this.accentHex();
    if (this.barMemoRole === role && this.barMemoTheme === t && this.barMemoAccent === a) {
      return this.barMemoVal;
    }
    const p: Palette = this.palOnce();
    let v: string = p.textSecondary;
    if (role === 'muted') {
      v = colorOf(p, 'iconMuted');
    } else if (role === 'danger') {
      v = p.dangerText;
    } else if (role === 'rule') {
      v = hairlineOf(p);
    }
    this.barMemoRole = role;
    this.barMemoTheme = t;
    this.barMemoAccent = a;
    this.barMemoVal = v;
    return v;
  }

  /**
   * **记忆化**色板 —— 与 `pal()` 同值，但**同一（主题|强调色）只算一次**。
   *
   * 为什么要它（两条都成立）：
   *   ① `pal()` **未记忆化**：每次都 `withAccent(base, …)` 重新分配色板（只有 `paletteOf` 按主题 memo）
   *      ⇒ 一个 builder 内多次取色会重复分配。本访问器按 `主题|强调色` memo，换主题/换强调色自动失效，
   *      **语义与 `pal()` 逐字节一致**（键含 accentHex ⇒ 强调色变了也会重算）。
   *   ② **预算硬约束**：`tools/perf/guard.sh --static` 的 `this.pal()` 调用点预算 = **1250**
   *      （`docs/PERF-BUDGET.md` 表 A），本页基线已 ~1247 ⇒ 新增 UI（D/E/F）统一走本入口。
   *      ⛔ 不是"绕过判据"：memo 后**真实重复分配更少**，开销只会更低。
   */
  private palOnce(): Palette {
    const t: string = this.themeName;
    const a: string = this.accentHex();
    if (this.palMemoVal === null || this.palMemoTheme !== t || this.palMemoAccent !== a) {
      this.palMemoVal = this.pal();
      this.palMemoTheme = t;
      this.palMemoAccent = a;
    }
    return this.palMemoVal;
  }

  private pal(): Palette {
    // 强调色叠加在主题色板之上（**只覆盖 accent 家族**，亮度阶梯保持不变）。
    // 对齐 web：`providers/theme.tsx` 把 accentColor 写进 --accent* CSS 变量。
    // ⚠️ 未显式设置时必须**原样返回主题色板**（不能回落 web 的默认强调色 ——
    //    那会把主题自己的强调色顶掉，整套配色的身份就没了）。
    const base: Palette = paletteOf(this.themeName);
    const a: string = this.accentHex();
    return a.length === 0 ? base : withAccent(base, a, !isLightPalette(base));
  }

  /** 视觉效果 token（玻璃/光晕/渐变/层级阴影）—— 由当前色板派生，换主题即换效果。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }

  /**
   * G1「多层柔影」的**贴合层（near）** —— `shadowLayersOf(p, tier)[0]`（浅色 = `elev1`/大面 `elev2`
   * 小半径接触影；深色 = 透明/radius 0 ⇒ 不渲染）。
   *
   * 用法（**加性**迁移，⛔ 不丢既有语义）：把浮起面的**原单层 `.shadow()`（far）原样保留**在面容器上，
   * 另用一个**同 box 的背板**承载本层 ⇒ 浅色多一层"落在纸面上"的接触感；深色零变化。
   * ⛔ far 的色/半径/偏移（含 `offsetX`）一律留在调用点原表达式 ⇒ **深色逐字节不变**。
   */
  private contactLayer(tier: string): ShadowLayer {
    return shadowLayersOf(this.pal(), tier)[0];
  }

  /**
   * 毛玻璃的明暗模式 —— **跟随当前主题**。
   *
   * 为什么需要它：`backgroundBlurStyle` 的 `colorMode` 原先被硬编码为 `DARK`，
   * 于是切到浅色系主题（light / porcelain）后，白底卡片上会压一层深灰毛玻璃 ——
   * 正是历史文档警告过的「白卡 + 深灰玻璃」割裂形态。改为按主题判定后，
   * `effectsOf` 派生的 `glassBg/glassBorder/elev*`（已随色板走柔影分支）与 colorMode 同源一致。
   * 抽成本地辅助是为了避免 7 个调用点各自展开三元分支。
   */
  private glassMode(): ThemeColorMode {
    // ⛔ 深浅走**亮度口径**（`isLightPalette(paletteOf(t))`），不按主题名硬判（本仓铁律）。
    return isLightPalette(paletteOf(this.themeName)) ? ThemeColorMode.LIGHT : ThemeColorMode.DARK;
  }

  /** 上一次已应用到**系统表面**的主题（`''` = 还没应用过）；幂等用，避免重复打系统 API。 */
  private appliedSystemTheme: string = '';

  /**
   * 把当前主题应用到**系统表面**（应用级 colorMode + 状态栏/导航栏前景色）。
   *
   * 为什么必须：自绘色板由 `pal()` 负责，但**系统绘制的表面**（系统弹框 / 选择与长按菜单 /
   * 状态栏前景…）只听 `setColorMode` / `setWindowSystemBarProperties`（EntryAbility 冷启动
   * 已按缓存主题设过一次，这里覆盖运行期切换）。判据走**亮度口径**（`isLightPalette`，与 `glassMode()`
   * **同源**）⇒ 不会出现"状态栏深、玻璃浅"。
   *
   * 幂等：只在主题**真的变化**时打系统 API（`syncFrom` 每帧都会调它，不变即早返回）；
   * 同一处顺带把主题写进**本地缓存**（EntryAbility 冷启动据此定系统表面）。
   * 旁路：任何失败只记日志，绝不影响切主题本身。
   */
  private async syncSystemTheme(): Promise<void> {
    const t: string = this.themeName;
    if (t.length === 0 || t === this.appliedSystemTheme) {
      return;
    }
    this.appliedSystemTheme = t;
    const dark: boolean = !isLightPalette(paletteOf(t));   // 亮度口径（铁律），非主题名硬判
    // 本地缓存（冷启动 EntryAbility 读它）：只在主题变化时写一次盘。
    // ⛔ 写**色板名**而不是复合标识（`名字|强调色`）：EntryAbility 只按它定系统开屏/colorMode，
    //    缓存里混进强调色会让冷启动的 `normalizeTheme` 多一次无谓分支（且强调色与开屏无关）。
    this.config.saveTheme(themeBaseName(t)).catch(() => {
      // 缓存写盘失败不影响切主题
    });
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      ctx.getApplicationContext().setColorMode(dark
        ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
        : ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
    } catch (e) {
      console.warn(`xbot theme: setColorMode 失败（已忽略）: ${errText(e as Object)}`);
    }
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const win: window.Window = await window.getLastWindow(ctx);
      await win.setWindowSystemBarProperties({
        statusBarContentColor: dark ? '#FFFFFF' : '#000000', // allow-color-literal: setWindowSystemBarProperties 只接受色值字符串（不接资源引用），已按 dark 分叉
        navigationBarContentColor: dark ? '#FFFFFF' : '#000000', // allow-color-literal: 同上（系统栏 API 参数，非 UI 渲染色）
      });
    } catch (e) {
      console.warn(`xbot theme: 状态栏更新失败（已忽略）: ${errText(e as Object)}`);
    }
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
    // 动效**统一走底座**（`components/anim.ets` 的 `AnimateParam` 工厂 = 唯一 import
    // `@ohos.curves` 处）；且用 `UIContext.animateTo`（全局 `animateTo` 自 API 18 deprecated）。
    this.getUIContext().animateTo(animBase(), run);
  }

  /** 最近一个迭代号（流式光标只挂在最后一个迭代上）。 */
  private lastIterationNo(row: ChatRow): number {
    const n: number = row.iterations.length;
    return n > 0 ? row.iterations[n - 1].iteration : 0;
  }

  /** 面板/弹层的统一出入场（唯一实现搬去了 `components/anim.ets`：动效只许一个出口）。 */

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

  /** 输入变化时刷新补全（`/` 命令优先，其次 `@` 文件）；候选集合一变就把选中索引复位（web `:270`）。 */
  private refreshCompletion(text: string): void {
    const slash: string = activeToken(text, '/');
    if (slash.length > 0) {
      this.cmdToken = slash;
      this.cmdItems = matchCommands(this.commands(), slash);
      this.fsEntries = [];
      this.cmdSel = 0;
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
      this.cmdSel = 0;
      return;
    }
    this.cmdToken = '';
    this.cmdItems = [];
    this.fsEntries = [];
    this.cmdSel = 0;
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
    this.buzz(HAPTIC_EVENT_SELECT);
  }

  // ── 补全浮层的选中态 / 键盘导航（纯语义全在 `core/composer.ets`，这里只做接线）──────────

  /** `@` 文件候选 = 服务器原始条目 **经前缀过滤**（`matchFiles`，对齐 web `useCompletion.ts:295-302`）。 */
  private fsMatches(): FsEntry[] {
    if (this.cmdToken.length === 0 || this.cmdToken.charAt(0) !== '@') {
      return [];
    }
    return matchFiles(this.fsEntries, this.cmdToken);
  }

  /** 浮层当前可见/可选的候选数（命令与文件互斥；各自受行数上限约束）。 */
  private completionCount(): number {
    if (this.cmdItems.length > 0) {
      return Math.min(this.cmdItems.length, CMD_ROWS);
    }
    const f: FsEntry[] = this.fsMatches();
    return Math.min(f.length, FS_ROWS);
  }

  /** 补全浮层当前是否打开。 */
  private completionOpen(): boolean {
    return this.cmdToken.length > 0 && (this.cmdItems.length > 0 || this.fsMatches().length > 0);
  }

  /** 当前补全的是文件（`@`）而非命令（`/`）。 */
  private fsActive(): boolean {
    return this.cmdItems.length === 0 && this.fsMatches().length > 0;
  }

  /** 接受当前选中候选（键盘 Tab/回车 或点击都汇到此处）。索引先夹回合法范围（空候选即返回）。 */
  private acceptCompletion(): void {
    const n: number = this.completionCount();
    if (n <= 0) {
      return;
    }
    const i: number = clampSel(this.cmdSel, n);
    if (this.cmdItems.length > 0) {
      this.pickCommand(this.cmdItems[i].name);
    } else {
      this.pickFile(this.fsMatches()[i]);
    }
  }

  /** 关闭补全浮层（Escape）。 */
  private closeCompletion(): void {
    this.cmdToken = '';
    this.cmdItems = [];
    this.fsEntries = [];
    this.cmdSel = 0;
  }

  /** 把 `KeyEvent.keyCode` 归一成 web 口径的键名（未识别 ⇒ 空串）。 */
  private completionKeyName(code: number): string {
    if (code === KeyCode.KEYCODE_DPAD_DOWN) {
      return 'ArrowDown';
    }
    if (code === KeyCode.KEYCODE_DPAD_UP) {
      return 'ArrowUp';
    }
    if (code === KeyCode.KEYCODE_TAB) {
      return 'Tab';
    }
    if (code === KeyCode.KEYCODE_ENTER || code === KeyCode.KEYCODE_NUMPAD_ENTER) {
      return 'Enter';
    }
    if (code === KeyCode.KEYCODE_ESCAPE) {
      return 'Escape';
    }
    return '';
  }

  /**
   * 输入框按键 → 补全导航（对齐 web `useCompletion.ts:369-397` handleKeyDown）。
   *
   * ⚠️ 只在浮层打开时消费；不认识的键**不** `stopPropagation` ⇒ 正常输入/换行不受影响。
   * ⚠️ 手机软键盘不产生方向键/Tab ⇒ 此路径主要服务**外接键盘 + 无障碍**（手感待真机验证）。
   * ⚠️ `Enter` 不在这里处理（走 `onSubmit`，见下）——避免与发送/换行打架。
   */
  private onComposerKey(e: KeyEvent): void {
    if (e.type !== KeyType.Down) {
      return;
    }
    if (!this.completionOpen()) {
      return;
    }
    const key: string = this.completionKeyName(e.keyCode);
    if (key.length === 0) {
      return;
    }
    const act: string = completionKeyAction(key, this.fsActive(), false);
    if (act === 'next') {
      this.cmdSel = selNext(this.cmdSel, this.completionCount());
      e.stopPropagation();
    } else if (act === 'prev') {
      this.cmdSel = selPrev(this.cmdSel, this.completionCount());
      e.stopPropagation();
    } else if (act === 'accept') {
      this.acceptCompletion();
      e.stopPropagation();
    } else if (act === 'close') {
      this.closeCompletion();
      e.stopPropagation();
    }
  }

  /** 选中一条文件候选（目录继续下钻，文件补完整）。 */
  private pickFile(e: FsEntry): void {
    this.draft = applyMention(this.draft, this.cmdToken, e.name, e.isDir);
    if (e.isDir) {
      this.loadFs(joinPath(this.fsDir, e.name));
    }
    this.refreshCompletion(this.draft);
    this.buzz(HAPTIC_EVENT_SELECT);
  }

  /**
   * 短震动反馈（**恒开**；无马达/无权限时**静默** —— 不打断任何流程）。
   *
   * 阶段 2（目标⑤）：**唯一入口收事件名** `buzz(event)`，档位由纯映射 `hapticFor(event)`
   * 决定（映射真源在 `core/haptics.ets`，登记表 `HAPTIC_EVENT_*`）。
   * ⛔ **未登记事件 ⇒ `hapticFor` 返 0（`HAPTIC_NONE_MS`）⇒ 不动**（安全默认；拼错/新造的名字
   *   只会静默不震，绝不误震、绝不抛错）。
   *
   * ⚠️ 2026-10-11 删死码：原实现这里有一段
   * `if (!parseBool(settingOf(this.settings, <代码换行开关>), true)) { …分支体只有注释… }`
   * —— **读错了键**（`KEY_CODE_WRAP` 是「代码换行」，与触觉无关）且**分支体只有注释** ⇒
   * 死代码 + 误导（看着像"受开关控制"，实际恒开）。现直接写明"恒开"。
   * 依据：手感反馈是"世界第一流畅"的一部分 ⇒ 有意恒开（web 权威零触觉 ⇒ 本仓不新增触觉点，
   * 只保留这一处既有约定；判据 = `tools/tests/haptics.test.ts`）。
   */
  private buzz(event: string): void {
    const ms: number = hapticFor(event);
    if (ms === HAPTIC_NONE_MS) {
      return; // 未登记事件 ⇒ 不动（安全默认）
    }
    try {
      vibrator.startVibration({ type: 'time', duration: ms }, { id: 0, usage: 'unknown' })
        .catch(() => {
          // 有意吞：无振动器件（平板/模拟器）—— 触觉反馈可选，失败不影响任何交互语义。
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

  /** 当前强调色：**未设置返回空串 = 不覆盖主题本色**；设置了才规范化。
   *  （空串与非法值语义不同：非法值回落 DEFAULT_ACCENT，未设置则保持主题。） */
  private accentHex(): string {
    const raw: string = settingOf(this.settings, KEY_ACCENT);
    return raw.trim().length === 0 ? '' : normalizeAccent(raw);
  }

  /** 当前 Markdown 主题 id（与 web 共享 `web:ui:md-theme`；未知回落默认）。 */
  private mdThemeId(): string {
    return normalizeMdTheme(settingOf(this.settings, KEY_MD_THEME));
  }

  /** Markdown 主题可选项（与 web `MARKDOWN_THEMES` 同序同 id）。 */
  private mdThemeChoices(): string[] {
    const out: string[] = [];
    for (let i = 0; i < MD_THEMES.length; i++) {
      out.push(MD_THEMES[i].id);
    }
    return out;
  }

  /** 当前语言（仅展示；见 core/i18n.ets 顶部说明）。 */
  private localeId(): string {
    return normalizeLocale(settingOf(this.settings, KEY_LOCALE));
  }

  /** 已星标的会话 id 列表（与 web 共享 `web:session:starred`）。 */
  private starredIds(): string[] {
    return parseStarred(settingOf(this.settings, KEY_STARRED));
  }

  /**
   * 星标集合**预解析缓存**（A 线 2026-10-14）：行体每行调 3-4 次 `isStarredChat` ⇒ 原实现
   * 每次 `JSON.parse`（开抽屉全量构建 ≈2400+ 次解析）。同星标原始串 ⇒ 复用同一 Set；
   * `setSetting` 恒整串替换 ⇒ 键换即失效。（行为与 `isStarred(this.starredIds(), id)` 逐字等价。）
   */
  private starredSetRaw: string = '\u0000';
  private starredSetCache: Set<string> = new Set<string>();
  private starredSetOf(): Set<string> {
    const raw: string = settingOf(this.settings, KEY_STARRED);
    if (raw !== this.starredSetRaw) {
      const set: Set<string> = new Set<string>();
      const ids: string[] = parseStarred(raw);
      for (let i = 0; i < ids.length; i++) {
        set.add(ids[i]);
      }
      this.starredSetCache = set;
      this.starredSetRaw = raw;
    }
    return this.starredSetCache;
  }

  private isStarredChat(chatId: string): boolean {
    return this.starredSetOf().has(chatId);
  }

  /** 切换会话星标（乐观更新 + 失败回滚由 `setSetting` 负责）。 */
  private toggleStarChat(chatId: string): void {
    const next: string[] = toggleStarred(this.starredIds(), chatId);
    this.setSetting(KEY_STARRED, serializeStarred(next));
    this.buzz(HAPTIC_EVENT_TOGGLE);
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

  /** 「思考光球动效」是否开启（键 = `core/settings.KEY_ORB`；缺失回落开）。投到 `LiveTailView.orb`。 */
  private orbOn(): boolean {
    return orbEnabled(this.settings);
  }

  /** 从**系统**读通知授权状态（不本地另记；失败保守 false）。打开设置面板时刷新一次。 */
  private async refreshNotifyState(): Promise<void> {
    this.notifyOn = await notificationsEnabled();
  }

  /**
   * 设置面板的「通知提醒」开关动作。
   *
   * 状态**以系统为准**（不本地另记）：开 ⇒ 走既有 `ensureEnabled`（已授权无框；未授权弹系统框），
   * 之后**重新读系统状态**；关 ⇒ 应用**无法**自行关闭系统通知 ⇒ 只提示去系统设置，并把开关
   * 复原成系统真值。任何失败只 toast，绝不影响设置面板本身。
   */
  private async applyNotifyToggle(on: boolean): Promise<void> {
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      if (on) {
        await ensureEnabled(ctx);
        this.notifyOn = await notificationsEnabled();
        if (!this.notifyOn) {
          this.toast('未获得通知权限，可在系统设置中开启');
        }
      } else {
        // 应用无权关闭自身通知 ⇒ 以系统真值覆盖回去，避免开关显示与系统不一致
        this.notifyOn = await notificationsEnabled();
        this.toast('如需关闭，请在系统设置中关闭本应用的通知');
      }
    } catch (e) {
      this.notifyOn = await notificationsEnabled();
      this.toast(`通知设置失败: ${errText(e as Object)}`);
    }
  }

  /**
   * 打开设置面板（`components/SettingsPanel`，全屏）—— 设置入口的**唯一实现**。
   *
   * 两个入口（抽屉底部「设置」行 / 右上角 ⚙）**曾并存**（用户报「为什么有两个设置按钮」）；
   * 顶栏 ⚙ 已删（`c673d26`），现仅抽屉底部成组行可进入 —— 本方法为它服务。
   */
  private async openSettingsPanel(): Promise<void> {
    // 浮层互斥：由抽屉进入时**先收抽屉**（否则两个浮层叠加，顶部既没被压暗也没被盖住）
    this.showDrawer = false;
    this.anim(() => {
      this.showSettingsPanel = true;
    });
    // 刷新系统通知授权状态（通知分区开关反映系统真值；不本地另记）
    this.refreshNotifyState().catch(() => {
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
    // ⛔ 主题切换必须**同步**更新 themeName（`@StorageLink('appTheme')` 唯一真源）——
    //    原实现只在 `syncFrom` 从 `store.settings` 重算（依赖 saveSettings 异步返回），
    //    乐观更新只写了 `settings`、没写 `themeName` ⇒ 切换后色板**冻结在旧主题**
    //    （用户亲报「浅色看不清 / 所有 theme 不生效」的真根因）。这里立即派生同步，
    //    与 `syncFrom` 的取值**同源**（`appPaletteForMdTheme(KEY_MD_THEME)`），最终值一致。
    // 主题标识含**强调色** ⇒ 改 `KEY_ACCENT` 也必须重算标识（否则强调色只写进模块级覆盖、
    // 无任何可观察状态变化 ⇒ 全站零重渲染 ⇒「配色根本没起作用」，用户 2026-10-13 亲报）。
    if (key === KEY_MD_THEME || key === KEY_ACCENT) {
      this.themeName = renderThemeKey(
        appPaletteForMdTheme(settingOf(this.settings, KEY_MD_THEME)), this.accentHex());
      // 与 `syncFrom` 同址：乐观切换时必须**同步**推全局订阅，否则已存在行（`LazyForEach` 承载）
      // 的代码块/行内码配色停在旧 md 主题（同 `themeName` 的那条注释，用户亲报的"抽奖"）。
      AppStorage.setOrCreate<string>('appMdTheme', this.mdThemeId());
      this.syncSystemTheme();
      // ⛔ 2026-10-17 P0 第五修（用户五连怒报「不能有哪怕一秒看不清」）：本路径此前**只写
      //    themeName、不投 rowDs** ⇒ LazyForEach 收不到 reload 通知、键（含 `@theme`）不被
      //    重读 ⇒ 历史行**冻结在旧色板**（浅色下白字）；直到下一次 SSE 事件驱动 `syncFrom`
      //    的常规投递（:8845，即"一个迭代结束"）才重建恢复 —— 用户症状「切换后、迭代结束前
      //    看不清」的唯一根因。修法与 :2256/:8845 **完全同款**：当场带新主题强制投一次 ⇒
      //    `structural`（theme 变）⇒ `onDataReloaded` ⇒ 框架同帧重读全部行键 ⇒ 整窗重建。
      //    成本 O(窗口)：`tailRows` 只切尾窗、`onDataReloaded` 一发、重建仅已实例化项 ——
      //    ⛔ 不触碰全历史（2026-10-17 性能红线「整个窗口没有任何 O(n)，无论历史多长」）。
      this.rowDs.applyRows(tailRows(this.rows, this.rowLimit), this.currentChat, this.themeName);
    }
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
      // 主题/强调色保存失败：乐观值已上屏、settings 却滚回旧值 —— themeName 必须当场一并
      // 滚回（并同款强制投 rowDs），否则主题停在乐观新值、行冻结到下一次 sync 才翻回
      // （期间历史行不可读 —— 同 P0 的「秒级不可读」红线）。
      if (key === KEY_MD_THEME || key === KEY_ACCENT) {
        this.themeName = renderThemeKey(
          appPaletteForMdTheme(settingOf(this.settings, KEY_MD_THEME)), this.accentHex());
        AppStorage.setOrCreate<string>('appMdTheme', this.mdThemeId());
        this.syncSystemTheme();
        this.rowDs.applyRows(tailRows(this.rows, this.rowLimit), this.currentChat, this.themeName);
      }
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
    if (tab === 'term') {
      return this.terminals.length;
    }
    if (tab === 'runners') {
      return this.runners.length;
    }
    return this.cronTasks.length;
  }

  /**
   * 面板片条文案（web `SessionViewBar` 的两级：名 + 计数）。
   *
   * ⚠️ 2026-10-12（目标③）**计数为 0 时不显示后缀** —— Apple 徽标惯例：没有东西可提示就不画徽标。
   * 信息**不减**（面板正文本来就有空态），但 5 片能**单行放下**（真机实测带 ` 0` 时末片会被挤到第二行）。
   */
  private panelTabLabel(tab: string): string {
    const n: number = this.panelCount(tab);
    const suffix: string = n > 0 ? ` ${n}` : '';
    // ⚠️ 2026-10-12（目标③ 排版）：标签一律 **2 个汉字** —— tab 行改成 `Row` + `layoutWeight(1)`
    //    等分（5 片在 1320px 屏上每片 63vp），文字预算 = `63vp − 2×SPACE_XS` ≈ 3.9 个全角字；
    //    「2 字 + 空格 + 2 位数」= 3.8 个全角字 ⇒ **放得下**；3 字标签 + 计数会溢出（被挤/换行）。
    //    ⇒ `后台任务`→`后台`、`定时任务`→`定时`、`子代理`→`代理`、`Runner`→`机器`
    //    （`机器` 与本面板自己的空态文案「暂无受管机器」同源）。
    if (tab === 'tasks') {
      return `后台${suffix}`;
    }
    if (tab === 'subs') {
      return `代理${suffix}`;
    }
    if (tab === 'term') {
      return `终端${suffix}`;
    }
    if (tab === 'runners') {
      return `机器${suffix}`;
    }
    return `定时${suffix}`;
  }

  private panelTabs(): string[] {
    return ['cron', 'tasks', 'subs', 'runners', 'term'];
  }

  /** 刷新当前标签页的数据（每个标签只拉自己那一个端点）。 */
  /**
   * 任务列表的**渲染序**：运行中置顶（判据 `core/panels.ets:sortBgTasksActiveFirst`，
   * 页面不自己判）。
   *
   * 为什么需要：真机实测 354 条后台任务一屏平铺，"正在跑的那条"混在中段 ⇒ 用户报
   * 「任务管理做的很差」的第一观感就是"看不到任务"。
   */
  private bgTasksSorted(): BgTask[] {
    return sortBgTasksActiveFirst(this.bgTasks);
  }

  /**
   * 快赢 3（2026-10-17）：列表**可见集**——开关开 ⇒ 只看运行中（`bgTaskRunning` 与状态
   * 文案/行内终止同一真源）；关 ⇒ 全量。渲染序仍走置顶排序（两职责正交）。
   */
  private bgTasksVisible(): BgTask[] {
    if (!this.panelBgOnlyRunning) {
      return this.bgTasksSorted();
    }
    const visible: BgTask[] = [];
    for (let i = 0; i < this.bgTasks.length; i++) {
      if (bgTaskRunning(this.bgTasks[i])) {
        visible.push(this.bgTasks[i]);
      }
    }
    return sortBgTasksActiveFirst(visible);
  }

  /** 快赢 1（2026-10-17）：tid 的 live 复合键（无记录 ⇒ 'none'——含进 ForEach key ⇒ 翻转即行重建）。 */
  private termLiveKey(tid: string): string {
    const v: string | undefined = this.terminalLive.get(tid);
    return v !== undefined ? v : 'none';
  }

  /** 快赢 1：tid 的列表行 tone（无记录 ⇒ muted 兜底——与 connecting 同 tone，首帧不闪）。 */
  private termLiveTone(tid: string): string {
    const v: string | undefined = this.terminalLive.get(tid);
    if (v === undefined) { return TONE_MUTED; }
    return terminalTone(v.split('|')[0]);
  }

  /**
   * 打开后台任务详情。
   * ⛔ 判据**全部**来自 `core/panels.ets`（`bgTaskStatusText`/`bgTaskMetaText`/`bgTaskOutputText`/
   *   `bgTaskRunning`）—— 与列表行 `bgTaskLine` 同一份纯函数 ⇒ 不可能"列表说运行中、详情说完成"。
   */
  private openTaskDetail(t: BgTask): void {
    this.taskDetailId = t.id !== undefined ? t.id : '';
    // ⚠️ 详情**标题**也走单行归一化（与列表主行 `bgTaskPrimary` 同一纯函数）：命令里的字面
    //    `\n` 若原样进标题，会在表头换行把布局撑乱。
    this.taskDetailTitle = t.command !== undefined ? cmdOneLine(t.command) : '';
    this.taskDetailStatus = bgTaskStatusText(t);
    this.taskDetailMeta = bgTaskMetaText(t, this.nowMs());
    this.taskDetailOutput = bgTaskOutputText(t);
    this.taskDetailRunning = bgTaskRunning(t);
    // 任务输出卡会占满下半屏 ⇒ 开卡前收键盘（否则输出正文被键盘压住）。
    this.dismissKeyboard();
    this.showTaskDetail = true;
  }

  /**
   * 后台任务详情的「跟随重投」（P0 修复详情页「开盖冻结」，2026-10-14）。
   *
   * web 权威 `BackgroundPanel.tsx:152-172` 用 SSE 增量 + 轮询双通道保证详情实时；
   * 原生无 SSE 支线（P1）前的最小闭环：**列表每次镜像更新**（`syncFromStore` 的
   * bgTasks 分支 ⇐ 轮询 `panelPollMs` / kill / promote 后就地重拉）⇒ 开着的
   * 详情页用同一组 `core/panels.ets` 纯函数重投四态：
   * - id 命中 ⇒ Status/Meta/Output/Running 全部按最新列表重算（判据同源 ⇒
   *   不可能「列表说运行中、详情说完成」；Output 增长 ⇒ TaskDetailSheet
   *   `onAreaChange + running` 既有逻辑自动跟底；自然结束 ⇒ running=false ⇒
   *   终止钮自动消失）。@State 同值赋值不触发重渲 ⇒ 无谓刷新为 0。
   * - id 从列表消失（服务端清理）⇒ 自动关详情——不吊死在已不存在的任务上。
   * ⛔ 不走 `openTaskDetail`：它含 `dismissKeyboard()` + `showTaskDetail=true`，
   *   每 2s 轮询都跑会把用户在别处的键盘无端收掉。
   */
  private refreshTaskDetailFrom(list: BgTask[]): void {
    if (!this.showTaskDetail) {
      return;
    }
    const id: string = this.taskDetailId;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        const t: BgTask = list[i];
        this.taskDetailStatus = bgTaskStatusText(t);
        this.taskDetailMeta = bgTaskMetaText(t, this.nowMs());
        this.taskDetailOutput = bgTaskOutputText(t);
        this.taskDetailRunning = bgTaskRunning(t);
        return;
      }
    }
    this.showTaskDetail = false;
  }

  /**
   * 打开定时任务详情。
   * ⛔ 判据**全部**来自 `core/panels.ets`（`cronMessageText`/`scheduleText`/`cronTargetText`/`fmtDateTime`）
   *   —— 与列表行 `cronPrimary`/`cronSubText` 同一份纯函数 ⇒ 不可能"行里说 A、详情说 B"。
   * 为什么需要它：cron 主行是 `.maxLines(1)`（多行提示词只显示第一行），此前点按只复制一行摘要
   *   ⇒ **正文永久不可见**（web `TasksPanel.tsx:120-172` 的展开区正是为修这一条）。
   */
  private openCronDetail(job: CronJob): void {
    this.cronDetailMessage = cronMessageText(job);
    const one: string = job.one_shot === true ? ' · 一次性' : '';
    this.cronDetailSchedule = `${scheduleText(job)}${one}`;
    this.cronDetailNext = fmtDateTime(job.next_run);
    this.cronDetailTarget = cronTargetText(job);
    this.cronDetailCreated = fmtDateTime(job.created_at);
    this.cronDetailId = job.id !== undefined && job.id !== null ? job.id.trim() : '';
    // 详情卡会占掉下半屏 ⇒ 开卡前收键盘（与后台任务详情同一处置）。
    this.dismissKeyboard();
    this.showCronDetail = true;
  }

  // ── 终端（PTY）：列表 / 新建 / 关闭 / 打开 ─────────────────────────────────

  /** 终端 WS 的基址（`store.http.baseUrl`；`ws://` 由 `termWsUrl` 派生）。 */
  private termBaseUrl(): string {
    const store: ChatStore | null = this.store;
    return store !== null ? store.http.baseUrl : '';
  }

  /** 终端 WS 的会话 Cookie（与 `/api/*` 同一鉴权）。 */
  private termCookie(): string {
    const store: ChatStore | null = this.store;
    return store !== null ? store.http.cookieHeaderForStream() : '';
  }

  /** 打开终端面板（列表行点击）。 */
  private openTerminal(t: TerminalInfo): void {
    this.termTid = t.tid;
    this.termCwd = t.cwd !== undefined ? t.cwd : '';
    // ⛔ 必须先收起运行面板：面板是**底部**浮层，不收起会压住终端自己的输入行与快捷键行
    //    （真机 dump 实证：输入框在 y2144，而面板从 y2097 起 ⇒ 无法输入）。与「子代理行」同范式。
    this.showPanels = false;
    this.showTerminal = true;
    // 面板已收起 ⇒ 撤防轮询（⛔ 别让它在后台空转）
    this.syncPanelPoll();
  }

  /** 新建终端（`POST /api/terminal/create`）；成功后直接打开数据通道。 */
  private async newTerminal(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      // P1（2026-10-14）：新建终端落**会话工作目录**——对齐 web `useTerminal.ts:329-337`
      // （fetchCwd → createTerminal(chatID, cwd)）。原生 `store.cwd` 由 `loadStatus()`
      // （`/api/session/status`）在打开会话/每轮 idle 时拉一次；空串 = 尚未拿到（未开盘的
      // 会话秒开终端）⇒ 服务端落沙箱默认目录（web_pty.go:550-555，与旧行为一致的兜底）。
      const tid: string = await store.createTerminal(store.cwd);
      if (tid.length > 0) {
        this.termTid = tid;
        this.termCwd = '';
        this.showPanels = false;
        this.showTerminal = true;
        // 面板已收起 ⇒ 撤防轮询（同 `openTerminal`）
        this.syncPanelPoll();
      } else {
        this.toast('新建终端失败');
      }
    } catch (e) {
      this.toast(`新建终端失败: ${errText(e as Object)}`);
    }
  }

  /** 关闭（删除）终端 —— 服务端 `Delete` 一并销毁 PTY（与 web 卸载面板同语义）。 */
  private async closeTerminal(tid: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || tid.length === 0) {
      return;
    }
    try {
      await store.deleteTerminal(tid);
      if (this.termTid === tid) {
        this.showTerminal = false;
      }
    } catch (e) {
      this.toast(`关闭终端失败: ${errText(e as Object)}`);
    }
  }

  /**
   * 终止详情里的后台任务（RPC `kill_bg_task`；web `BackgroundPanel.tsx:172` 的
   * `ws.rpc('kill_bg_task', {task_id})` 同源）。
   * 成功后**就地刷新**详情（SIGTERM 在飞时状态可能还是"运行中" ⇒ 用户可自行关闭/再点，
   * ⛔ 不假装成功）；失败给可读 toast（服务端 `access denied: task not found` 是唯一原因来源）。
   */
  /**
   * **行内终止**运行中的后台任务（列表行的尾部动作）。
   *
   * 与 `killTaskDetail` 同一 RPC（`kill_bg_task`，web `TasksPanel.tsx:246-255` / `BackgroundPanel.tsx:172`
   * 同源），差别只在落点：这里不动详情卡（用户还在列表上）。
   * ⛔ `store.killBgTask` 内部已 `loadBgTasks()` ⇒ 列表**就地**刷新（不靠轮询那 2s/30s 一拍）；
   *    页面侧镜像由既有同步路径负责（`syncFromStore`）——⛔ 不另写一套取数。
   */
  private async killBgTaskRow(t: BgTask): Promise<void> {
    const st: ChatStore | null = this.store;
    const id: string = t.id !== undefined ? t.id : '';
    if (st === null || id.length === 0) {
      return;
    }
    try {
      await st.killBgTask(id);
      this.toast('已请求终止');
    } catch (e) {
      this.toast(`终止失败: ${errText(e as Object)}`);
    }
  }

  private async killTaskDetail(): Promise<void> {
    const id: string = this.taskDetailId;
    const st: ChatStore | null = this.store;
    if (id.length === 0 || st === null) {
      return;
    }
    try {
      await st.killBgTask(id);
      this.toast('已请求终止');
      // kill 成功 ⇒ store 已就地重拉列表（`store.killBgTask` 内部 `loadBgTasks`），
      // 从最新列表重投详情（与 syncFromStore 镜像分支共用 `refreshTaskDetailFrom`：
      // running=false ⇒ 终止钮立即消失；任务从列表消失 ⇒ 片头自动关）。
      // 旧内联「找 id → openTaskDetail / 消失 → 关」并入该方法，不再各写一份。
      this.refreshTaskDetailFrom(st.bgTasks);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`终止失败: ${err.message}`);
    }
  }

  /**
   * 「转后台」—— 把**正在执行的前台 shell** 转入后台（RPC `promote_shell`；web
   * `ShellPromoteBar`（`components/agent/ToolRender.tsx:491-516`）同源）。
   *
   * 成功：toast 报出新任务 id（store 内已就地重拉后台任务列表 ⇒ 任务面板立刻可见，
   * 不必等 web 那 30s 轮询）。失败：可读 toast + **向上抛**，让浮层卡片进入 error 态
   * （web 同款 `PromoteState.error`，⛔ 不假装成功）。
   */
  private async promoteShellAction(callId: string): Promise<string> {
    const st: ChatStore | null = this.store;
    if (st === null || callId.length === 0) {
      return '';
    }
    try {
      const taskId: string = await st.promoteShell(callId);
      this.toast(taskId.length > 0 ? `已转入后台：${taskId}` : '已转入后台');
      return taskId;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`转后台失败: ${err.message}`);
      throw e as Error;
    }
  }

  private async refreshPanel(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    if (this.panelBusy) {
      // ⛔ 2026-10-12（15g）**绝不静默丢弃**：原写法在此直接 `return` ⇒ 切 tab / 连点「刷新」时，
      //   若上一次拉取还在飞，**这次请求被整个吞掉** ⇒ 列表停在旧数据或空态。
      //   真机实证（决定性）：抽屉 → 运行（默认「定时任务」，打开即发请求）→ **马上**点「后台任务」
      //   ⇒ 显示「本会话暂无后台任务」；而 `POST /api/tasks/list` 对**同一会话**
      //   （`channel=web, chat_id=chat_EDE9F493EB26`）返回 **48 条**；随后点表头「刷新」
      //   （= 同一段代码、此时 `panelBusy` 已落回 false）⇒ 48 条**立刻全部出现**。
      //   ⇒ 结论：不是取数或渲染问题，就是**这次请求被守卫丢掉**。
      //   修法：记「待刷新」标志，等当前这次结束再按**当前** tab 补一次（幂等、⛔ 不加定时器）。
      this.panelRefreshQueued = true;
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
      } else if (this.panelTab === 'term') {
        await store.loadTerminals();
      } else {
        await store.loadSessions();  // 子代理来自会话树
      }
    } catch (e) {
      this.toast(`加载失败: ${errText(e as Object)}`);
    } finally {
      this.panelBusy = false;
      if (this.panelRefreshQueued) {
        // 先清标志再重入 ⇒ 不会自激循环（只补一次；期间再来请求会重新置位）
        this.panelRefreshQueued = false;
        this.refreshPanel();
      }
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
    // ⛔ 规范化解析器（与 `tabLabel`/store 同一判据）：按原值精确比对会命中**幽灵行**
    //    （`chat_id='web:chat_X'`、无 `running` 字段）⇒ 服务端权威 running **永远拿不到**
    //    ⇒ `busySignals().freshServerRunning` 恒 false ⇒ 只剩 SSE 快路径 ⇒ 错过一条 idle
    //    就永远显示"运行中"（正是本方法存在的理由，却因为比对形态失效）。
    const node: SessionItem | null =
      resolveSessionNode(this.sessions, channelForChatIndexed(this.sessions, this.channelIdx(), this.currentChat), this.currentChat);
    return node !== null && node.running === true;
  }

  /**
   * 界面统一的"是否在跑"。
   *
   * busy 本身已被 loadSessions 对账（SSE 事件快路径 + 会话树权威值）；
   * `serverRunning()` 只在**快照新鲜**（20s 内拉过会话树）时采信 ——
   * 过期的 running=true 快照曾把 idle 会话显示成"运行中"（真机）。
   */
  /**
   * 采集判定"是否在跑"的全部信号 —— composer 与列表占用符**共用**（见 core/indicators.ets）。
   *
   * ⛔ 真机 P0（2026-10-10「发送完了连思考中都没来」）：按钮此前用 `runningNow()`、
   *   列表占位符用 `this.busy`，两套判据分叉 ⇒ 服务端已 running 但本地 turn_started 未到
   *   时按钮=停止、列表=空。统一到本方法 + `busyNow/showsBusyPlaceholder` 后不变量按构造成立。
   */
  /**
   * 终态失败的可解释原因（`SseClient.lastFailureReason`，由 `reasonForStreamStatus` 给出）。
   * 页面横幅只消费它，**不本地另判**（一个状态、一份判据）。
   */
  private sseTerminalReason(): string {
    const st: ChatStore | null = this.store;
    if (st === null) {
      return '连接被拒绝';
    }
    const r: string = st.sse.lastFailureReason;
    return r.length > 0 ? r : '连接被拒绝';
  }

  private busySignals(): BusySignals {
    const store: ChatStore | null = this.store;
    const fresh: boolean = store !== null && Date.now() - store.sessionsFetchedAt <= 20000;
    return {
      localBusy: this.busy,
      liveHasContent: store !== null && store.hasLiveRowWithContent(),
      // ⛔ 用户 2026-10-10 ①：尾部**在飞信号**才让位（末尾在飞块有 正文/思考/工具），
      //   绝不是「行非空」—— 后者含**已提交（历史）迭代块**。迭代刚 commit、下一迭代
      //   首个 delta 未到时行非空 ⇒ 旧判据抑制占位 ⇒ 空隙里什么都没有。见
      //   core/streammerge.rowHasInFlightSignal 与 docs/WEB-ALIGNMENT.md §10。
      tailShowsIndicator: this.hasLiveRow && rowHasInFlightSignal(this.liveRowRef),
      freshServerRunning: fresh && this.serverRunning(),
      loading: this.historyLoading,
      rowsLen: this.rows.length,
    };
  }

  private runningNow(): boolean {
    // ⛔ 会话隔离（用户要求）：busy 只能来自**当前会话自己的 store**，且身份必须一致。
    //   切换瞬间 store / currentChat 可能短暂不一致（或 store 已置空）⇒ 一律按"不在跑"处理，
    //   绝不用别的会话或上一会话的状态 —— 真机："隔壁会话 busy，我这也显示 busy"。
    const runningStore: ChatStore | null = this.store;
    if (runningStore === null || runningStore.currentChatId !== this.currentChat) {
      return false;
    }
    // ⛔ 与 web 同式：`currentSession.running || progressSnapshot.streaming || busyFallback(activeTurn!==null)`
    //   —— 只要本地还有"在飞的 live 迭代/行"就一定在跑；否则 SSE 抖动会让占位符一闪一没。
    return busyNow(this.busySignals());
  }

  // ── 主按钮语义（**逐字移植 web** `MessageInput.tsx:686-687/935-939`）────────────────
  //  web 原文：`canSend = hasContent || pendingUploads || annotations`；
  //            `sendDisabled = submitting || (canSend ? … : busy ? cancelling : true)`。
  //  ⇒ **busy 时只要用户输入了内容，主按钮就是「发送」**（按 `sendMode` 插队/排队），
  //    只有 **busy 且无内容** 时才是「停止」；停止请求在飞时按钮**转圈**。
  //  用户要求（2026-10-12）：*"用户如果在 busy 的时候输入了文字，那么 cancel 按钮应该自动
  //    变成插队或者排队按钮"* —— 与 web 同一语义，此前原生缺这一步（永远只显示停止）。

  /** 主按钮当前是否"可发送"（有正文或待发附件）—— web `canSend` 的原生对应。 */
  private composerCanSend(): boolean {
    return this.draft.trim().length > 0 || pendingCount(this.attachments) > 0;
  }

  /**
   * 主按钮簇的**同源语义**（chip 可见性 / 停止 / 转圈 / ⚡ 插话）——
   * 判据本体是纯函数 `core/composer.composerButtonState`（脱机单测 + mutation 自证）。
   *
   * ⛔ 页面里**只准**从本方法取这几个布尔；⛔ 不得再出现裸 `this.busy` 驱动按钮簇
   *   （2026-10-15 审计实测的缺陷：chip 曾用裸 `this.busy`，与按钮的 `runningNow()` 分叉 ⇒
   *    「停止按钮 + 无模式 chip」自相矛盾。本仓铁律：判据与渲染必须同源）。
   */
  private composerBtn(): ComposerButton {
    const st: ChatStore | null = this.store;
    const running: boolean = this.runningNow();
    return composerButtonState(running, this.composerCanSend(),
      st !== null && st.cancelling, isInterruptSend(running, this.sendMode));
  }

  /** 主按钮是否显示**停止**（= 回合在跑 且 不可发送）；其余情况显示**发送**。 */
  private composerShowStop(): boolean {
    // ⛔ `|| this.cancelSpinHold`：请求返回后 spinner **驻留**期内，按钮仍按"停止"档渲染
    //    （灰底 `surfaceHi` 才与 spinner 的 `textSecondary` 对得上；见 `composerCancelling`）。
    return this.composerBtn().showStop || this.cancelSpinHold;
  }

  /** 停止按钮是否**转圈**（web `:938` `cancelling && !canSend && busy`）。 */
  private composerCancelling(): boolean {
    // ⛔ 请求返回后的最短驻留窗口内继续转圈（§21.122bs）——仍以 `composerBtn()` 为**唯一**来源，
    //    不新增第二个 busy 源；`cancelSpinHold` 只是把"那一下"补到肉眼可见。
    return this.composerBtn().cancelling || this.cancelSpinHold;
  }

  /** 点「停止」= web `MessageInput.onCancel` ⇒ `chat.cancel()`；失败给可读提示（web 同款 toast）。 */
  private cancelTurn(): void {
    const st: ChatStore | null = this.store;
    if (st === null) {
      return;
    }
    if (this.cancelSpinHold) {
      // 驻留窗口内的重复点击：忽略（会话已在请求成功那一刻进 idle，再发一次取消没有意义）。
      return;
    }
    this.cancelSpinHold = true;
    const t0: number = Date.now();
    st.cancel().then(() => {
      // 请求成功 ⇒ 会话**已经**进 idle（`store.cancel()` 内的乐观 idle）；这里只补按钮的视觉驻留。
      const rest: number = spinHoldRemainingMs(Date.now() - t0);
      if (rest === 0) {
        this.cancelSpinHold = false;
        return;
      }
      setTimeout(() => { this.cancelSpinHold = false; }, rest);
    }).catch(() => {
      this.cancelSpinHold = false;
      this.toast('取消失败，请重试');
    });
  }

  /**
   * 把原生会话 cookie 同步进 ArkWeb 的 cookie 仓（**幂等**；与「承载方式」无关）。
   *
   * 为什么必须独立成方法：ArkWeb 有**独立的 cookie 仓**（**不**共享原生 `XbotHttp` 的内存 cookie），
   * 而下列**每一个**页面都是同源 `base/` 的 web 页面 ⇒ 都必须带上会话 cookie：
   *   · 完整 Web UI（`webUiUrl`）；· **插件宿主页 / 插件面板**（`panelUrl`/`pluginPageUrl` → `WebSurface`）。
   * ⛔ 此前只在 `prepareWebUI` 里注入，且其首行即 `if (!this.useWebUI) return` ⇒ **原生承载下**
   *   任何 `WebSurface` 打开服务器页面都是**未登录** ⇒ 服务端 **401** ⇒ 用户看到 web 登录页
   *   （2026-10-12 真机实测：插件目录点「迭代指标 → 打开」得到 `加载失败：HTTP 401 Unauthorized`；
   *   这正是「插件都打不开」的**客户端侧**根因）。
   * @returns 是否已把（非空）cookie 注入（false ⇒ 页面会落到登录页，可重登）。
   */
  private syncSessionCookieToWeb(store: ChatStore): boolean {
    const base: string = store.http.baseUrl;
    const cookie: string = store.http.exportSessionCookie();
    if (cookie.length === 0) {
      return false;
    }
    try {
      // 服务端 cookie 是 host-only；对根地址配置即可覆盖整站
      webview.WebCookieManager.configCookieSync(base + '/', cookie);
      return true;
    } catch (e) {
      // 注入失败不阻塞：webview 里会落到登录页，用户可再登一次
      return false;
    }
  }

  /**
   * 准备内嵌 web UI：先把会话 cookie 注入 ArkWeb（见 `syncSessionCookieToWeb`）再设地址
   * ⇒ 打开即已登录（与原生侧同一凭据，用户不用在 webview 里再登一次）。
   */
  private prepareWebUI(store: ChatStore): void {
    if (!this.useWebUI) {
      return;
    }
    this.webCookieReady = this.syncSessionCookieToWeb(store);
    this.webUiUrl = store.http.baseUrl + '/';
  }

  /** 切换"内嵌完整 web UI / 原生界面"（写进设置，两端口径一致）。 */
  private async setSurface(useWeb: boolean): Promise<void> {
    this.useWebUI = useWeb;
    // 用户已手动选择 ⇒ 后续 settings 到达不再用服务端值覆盖（只首帧套用一次）
    this.surfaceApplied = true;
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
    // ⛔ 浮层互斥（**反方向**）：抽屉在渲染序里是**最底层的浮层**（build 里 `if (this.showDrawer)`
    //   最先渲染，运行面板/任务详情/设置面都在其后 ⇒ z 序更高）⇒ 开抽屉前必须收掉它们，
    //   否则真机表现为"抽屉背景里叠着一张任务卡 + 运行面板"，抽屉列表被盖住 ⇒ **看起来像坏了**
    //   （2026-10-12 实测三张浮层同屏）。与 `openPanels()`「面板由抽屉进入 ⇒ 先收抽屉」是同一条铁律。
    // ⛔ 开浮层前**先收软键盘**（`dismissKeyboard()`，与发送后同一出口）：聊天页 composer 常驻焦点
    //   ⇒ 键盘弹起；不收则**抽屉底部 5 键 / 运行面板内容被键盘压掉**（2026-10-12 真机实证：
    //   键盘弹起时抽屉 5 键从 y2667 被顶到 y1719，运行面板「终端」tab 下半屏被盖）。
    //   Apple 语义：打开新浮层 ⇒ 旧上下文的输入焦点一并撤销。
    this.dismissKeyboard();
    this.closeOverlaysAboveDrawer();
    this.showDrawer = true;
    const store: ChatStore | null = this.store;
    if (store !== null) {
      store.loadSessions().catch(() => {
        // 刷新失败保留旧列表（弱网下仍能看到上次的会话）
      });
    }
  }

  /**
   * 收掉所有**渲染在抽屉之上**的浮层（开抽屉前的互斥收口）——**唯一真源**。
   *
   * ⛔ 新增浮层时**必须**在这里登记（并补判据 `drawer_exclusive_wiring`：
   *   `showDrawer = true` 全仓**只许出现 1 处**＝就是 `openDrawer()` 里那句
   *   ⇒ 任何"绕过 openDrawer 直接开抽屉"的写法都会被抓红）。
   */
  private closeOverlaysAboveDrawer(): void {
    this.showNewSession = false;
    this.showQueue = false;
    this.showPlugins = false;
    this.showSkills = false;
    this.showFiles = false;
    this.showSelfCheck = false;
    this.showStatus = false;
    this.showModel = false;
    this.showSettingsPanel = false;
    this.showPanels = false;
    this.showTaskDetail = false;
    this.showCronDetail = false;
    this.showTerminal = false;
    this.showSearchHits = false;
    this.showPluginHost = false;
    this.showSessionStats = false;
    // 原生 Git 面板（顶层浮层）——新增浮层必须在这里登记（本方法 = 唯一真源）。
    this.showGit = false;
    // 远程机器面板（同为顶层浮层）——同上，必须在此登记。
    this.showSsh = false;
    this.sessMenuId = '';
    this.ctxOpen = false;
    this.panelUrl = '';
    this.pluginPageUrl = '';
    // 图片查看器走既有收口（重置缩放/位移 + 释放 PixelMap），⛔ 不手写第二套。
    this.closeViewer();
    // 面板已被收（`showPanels = false`）⇒ 撤防轮询（本方法 = 浮层收口的唯一真源 ⇒ 必须在此撤防）
    this.syncPanelPoll();
  }

  private openPanels(): void {
    // 浮层互斥：面板由抽屉进入 ⇒ 先收抽屉（同一时刻只允许一个半屏/全屏浮层）
    this.showDrawer = false;
    // ⛔ 面板内容（终端 / 任务列表）绝不能被**软键盘**压住（2026-10-12 真机实证：键盘弹起时
    //   「终端」tab 只剩标题+芯片可见，正文与输入行全在键盘之下）⇒ 开面板前先收键盘。
    this.dismissKeyboard();
    this.anim(() => {
            this.showPanels = true;
          });
    this.refreshPanel();
    // 面板开着 = 数据要活着（web `useTasks.ts:117-122` 的自适应轮询；见 `syncPanelPoll`）
    this.syncPanelPoll();
  }

  private switchPanelTab(tab: string): void {
    this.panelTab = tab;
    this.refreshPanel();
    // 切 tab 顺手把轮询倒计时重置（周期可能随新 tab 的数据变化 ⇒ 由 `syncPanelPoll` 重排）
    this.syncPanelPoll();
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

  // ── 帧内变更判定（官方性能规范：避免无效刷新）──
  // ⚠️ 为什么必须做：`syncFrom` 每帧都跑，而 `this.rows = store.rows.slice()` 这类
  // **数组/对象赋值在 ArkUI 里一定触发重渲染**（哪怕内容没变）⇒ 每个 SSE 帧都整页重刷，
  // 滚动与流式同时卡。指纹是 O(n) 字符串比较（n = 窗口内行数），**任何变化都会改变指纹**，
  // 所以"指纹没变就不赋值"既省渲染又不可能漏更新。
  private rowsFp: string = '';
  /**
   * 行集合的**结构**指纹（`core/rowdiff.structRowsFpOf`：`id#isLive#迭代数#末迭代在飞`）。
   *
   * 用途：`navAnchors()` 的记忆化键 —— ⛔ **不能**用含 `rev` 的 `rowsFp`（流式每帧都变 ⇒ 每帧
   * 重建整份锚点表 = 掉帧主因，真机计数取证 `sync/s≈33 · anchorsBuilds/s≈33`）。
   */
  private structFp: string = '';
  private sessionsFp: string = '';
  private queueFp: string = '';
  private todosFp: string = '';
  /** live SubAgent 树指纹（值投递门控 —— 见 `syncLiveTail`）。 */
  private liveSubAgentsFp: string = '-';
  /**
   * live 行**已完成块指纹**的页侧副本（值投递门控 —— 见 `syncLiveTail`）。
   * ⛔ 与 `liveBlocks` 同步写入：`liveBlocksSig` 是"当初赋给 `liveBlocks` 的那份指纹"，
   *    下一帧只须把它与行侧指纹（`liveBlocksSignature(liveRowRef)`，O(1)）比一次即可。
   *    初值 = 空块指纹（`liveBlocks` 初值 `[]` 的指纹）⇒ 首帧不会误赋值。
   */
  private liveBlocksSig: string = EMPTY_BLOCKS_SIGNATURE;
  /**
   * 在飞**工具列表**的页侧副本签名（值投递门控 —— 见 `syncLiveTail`）。
   * ⛔ 为什么不能按**数组恒等**门控（2026-10-14 用户亲报「tool 生成中 x 字，这个 x 不会更新」）：
   *    在飞迭代的 `tools` 数组是**就地更新**的（同一引用、元素字段在变）⇒ 恒等恒成立
   *    ⇒ 永不投递 `@Prop liveTools` ⇒ pill 的 `生成中 N 字`/耗时冻结在创建那一刻。
   *    判据本体是纯函数 `core/streammerge.toolsSignature`（可脱机单测）。
   */
  private liveToolsSig: string = '';

  /**
   * §21.122bx：上一次 live 可见态投递的时刻（`syncLiveTail` 的降频判据用）。
   *
   * 只在**浮层覆盖聊天区且仍在流式**时生效（最小间隔 `COVERED_DELIVER_MS`）；判据是纯函数
   * `core/livedeliver.shouldDeliverLive`（`!covered || !busy` ⇒ 必投，⛔ 不会陈旧）。
   */
  private liveDeliverAtMs: number = 0;
  /** 用户在阅读历史时降低 live tail 更新频率——减少整页 build + LazyForEach diff */
  private lastNonFollowLiveMs: number = 0;

  /**
   * §21.122bx：live 行**此刻是否在视野内**（`onVisibleAreaChange` 维护，只在真变化时写）。
   *
   * 用户定向：「**一旦 live iter 看不到就不渲染它了，只记录状态**……它**快进入视野的时候再
   * 挂载回来**」⇒ 看不见时投递降频（`core/livedeliver`），回到视野立刻补一帧（用户无感）。
   * 初值 `true`：首帧必须投（⛔ 不能用 false 当默认 —— 那样开局就降频，内容会滞后）。
   */
  private liveRowVisible: boolean = true;

  private fingerprintRows(rows: ChatRow[], chatId: string): string {
    return rowsFpOf(rows, chatId);   // 纯函数在 core/rowdiff（带会话身份，有判别测试）
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
    // ── live 行**整条**交给非懒尾项渲染（同气泡：已完成迭代 + 末尾在飞块）──
    // 为什么整条排除（而不是只排除"在飞那一块"）：① 在飞迭代现在是该消息气泡内的
    // 最后一块，与已完成迭代必须同一气泡 ⇒ 不能跨 LazyForEach 边界；② 虚拟列表条目
    // 在真机不可靠重建（流式期间什么都看不到的根因）⇒ live 行整条走非懒路径。
    // 绝不再是"列表里一条 live 行 + 尾部另一个 live 气泡"（真机 bug ② 根治点）。
    let live: ChatRow | undefined = undefined;
    const rest: ChatRow[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r: ChatRow = this.rows[i];
      if (live === undefined && r.isLive) {
        live = r;
      } else {
        rest.push(r);
      }
    }
    if (live !== undefined) {
      this.liveRowRef = live;
      this.hasLiveRow = true;
    } else {
      this.hasLiveRow = false;
    }
    // live 行「在飞内容」→ 页面 @State 镜像（**必须**：见 `liveText` 的注释 ——
    // 行对象只被就地修改，引用恒定，不产生 ArkUI 能看见的「值变化」）。
    this.syncLiveTail();
    // 必须把**会话身份**一起交给数据源：否则两个会话同形时它会判「骨架未变」=> 零通知 =>
    // LazyForEach 保留上一个会话的条目（真机「所有会话都显示第一个会话的内容」）。
    const tail: ChatRow[] = tailRows(rest, this.rowLimit);
    // ⛔ 每帧 hilog 是**真开销**（流式期可达 ~45 帧/秒 ⇒ 每秒几十条 debug 写入 + 字符串拼接）。
    //   此处原先每条 sync 都打一行 `[DS] …` 诊断（2026-10-12 P0 期临时件）⇒ 已移除；
    //   需要诊断时用页面级**按需**探针（`[PF]` 汇总/秒），⛔ 不再逐帧打点。
    this.rowDs.applyRows(tail, this.currentChat, this.themeName);
  }

  /**
   * 把当前 live 行的**在飞内容**同步进页面 `@State`（`liveText/liveReasoning/liveTools`）。
   *
   * 数据源 = live 行本身末尾那块 `live:true` 的在飞块（`core/render.ets` 从状态机在飞字段
   * 折叠而来）—— 与可见性判据 `rowIsEmpty`/`rowVisibleChars` **同源**（同一个块），
   * 因此「判据说有内容」与「@Prop 投递给渲染的内容」不可能分叉。
   *
   * ⛔ 为什么必须显式同步（而不是让组件直接读行对象）：ArkUI V1 只在「收到的值变化」时
   *   重建组件；对同一 `ChatRow` 引用的就地修改不构成值变化 ⇒ live 组件永不重建 ⇒
   *   流式期间渲染输入冻结在创建那一瞬（P55 回归）。这三项 `@State` 提供值变化。
   *
   * 赋值前先比较：内容未变（同一引用 / 同值）时**不赋值** ⇒ 不产生多余重建（零额外开销）。
   *
   * 除在飞块外，同时把**已完成块列表**（`completedBlocks(liveRowRef)`，与渲染读同一函数）
   * 镜像进 `@State liveBlocks` —— 这是「iter1 的 tool call 完成后 iter1 消失」的根治项：
   * 已完成块区必须走**值变化**通道，否则冻结在创建那一瞬（见 `liveBlocks` 的注释）。
   * 同样按 `blocksSignature` 门控（只在结构/内容变化时赋值 ⇒ 流式期间零额外重建）。
   */
  private syncLiveTail(): void {
    // 用户在阅读历史时降低 live tail 更新频率——减少整页 build + LazyForEach diff
    if (!this.followBottom && this.busy && Date.now() - this.lastNonFollowLiveMs < 200) {
      return;
    }
    this.lastNonFollowLiveMs = Date.now();
    // ── §21.122bx：浮层覆盖聊天区时**降频投递**（用户亲报「打开侧边栏/菜单时主视图还在 stream
    //    就特别卡」）── 流式期间每个 SSE 帧都把页级可见态写进 `@State` ⇒ **整页 build + live 行
    //    重排**；浮层打开时这些帧**看不见**，却与浮层入场动画抢同一帧预算。
    //    判据是纯函数（`core/livedeliver`，有判别力单测 + mutation 自证）：
    //      · `covered && busy` ⇒ 最小间隔 400ms（≈2.5 次/秒，肉眼无差别）；
    //      · **其余一律立即投**（`!covered` 或 `!busy`）—— 后者是**防陈旧的关键**：
    //        回合结束那一帧 `busy=false` ⇒ 必投 ⇒ 最终内容不可能停在被丢弃的那一帧上。
    if (!shouldDeliverLive(this.anyModalOpen(), this.liveRowVisible, this.busy, Date.now(),
      this.liveDeliverAtMs)) {
      return;
    }
    this.liveDeliverAtMs = Date.now();
    let text: string = '';
    let reasoning: string = '';
    let tools: ToolProgress[] = [];
    if (this.hasLiveRow) {
      const its: HistoryIteration[] = this.liveRowRef.iterations;
      for (let i = its.length - 1; i >= 0; i--) {
        if (its[i].live === true) {
          text = displayContent(its[i]);
          reasoning = displayReasoning(its[i]);
          const t: ToolProgress[] | undefined = its[i].tools;
          if (t !== undefined) {
            tools = t;
          }
          break;
        }
      }
    }
    if (this.liveText !== text) {
      this.liveText = text;
    }
    if (this.liveReasoning !== reasoning) {
      this.liveReasoning = reasoning;
    }
    // ⛔ 工具列表必须按**内容签名**门控（⛔ 不是数组恒等）——2026-10-14 用户亲报
    //    「tool 生成中 x 字，这个 x 不会更新」：在飞迭代的 `tools` 是**就地更新**的同一数组，
    //    恒等比较恒成立 ⇒ 永不投递 `@Prop` ⇒ pill 的生成字数/耗时冻结在创建那一刻。
    //    与 `liveBlocks` 同一门手艺（签名变化才投递**新数组** ⇒ ArkUI 看得见"值变化"）。
    const toolsSig: string = toolsSignature(tools);
    if (toolsSig !== this.liveToolsSig) {
      this.liveToolsSig = toolsSig;
      this.liveTools = tools.slice();
    }
    // 已完成块列表（值变化通道）—— 只在结构/内容变化时赋值。
    // ⛔ 双命中（目标⑤ round4）：行侧指纹按**派生行源数组对象恒等**记忆化（`liveBlocksSignature`，
    //    见 `core/render.ets`），页侧指纹随赋值一起记进 `liveBlocksSig` ⇒ 本判定每帧 **O(1)**：
    //    不再每帧 `completedBlocks`（O(块数) 过滤分配）+ `buildBlocksSignature`（O(块数) 拼串）。
    //    旧写法 `blocksSignature(this.liveBlocks) !== blocksSignature(blocks)` 的右侧每帧新数组 ⇒ 必 miss。
    const blocksSig: string = this.hasLiveRow ? liveBlocksSignature(this.liveRowRef) : EMPTY_BLOCKS_SIGNATURE;
    if (blocksSig !== this.liveBlocksSig) {
      this.liveBlocksSig = blocksSig;
      this.liveBlocks = this.hasLiveRow ? completedBlocks(this.liveRowRef) : [];
    }
    // live SubAgent 树（值变化通道）—— 用 render 的**同一份**指纹门控（判据与渲染同源）：
    // 只在树内容真变了才投递新引用（applyRow 每次都会换新数组 ⇒ 不门控会逐帧重建）。
    const subs: WebSubAgentProgress[] = this.hasLiveRow ? this.liveRowRef.subAgents : [];
    if (subAgentsFingerprint(subs) !== this.liveSubAgentsFp) {
      this.liveSubAgentsFp = subAgentsFingerprint(subs);
      this.liveSubAgents = subs.slice();
    }
  }

  /**
   * live turn 是否已有**在飞信号**（决定「思考中…」占位符是否让位 —— 恰好一个指示器）。
   *
   * ⛔ 判据 = `rowHasInFlightSignal`（末尾在飞块里有 正文/思考/工具），**不是**「行非空」：
   *   行非空含**已提交（历史）迭代块**，用它当判据会让迭代空隙的「思考中」消失
   *   （用户 2026-10-10 ①）。与 `busySignals().tailShowsIndicator` 同一函数 —— 判据唯一。
   * 数据源 = live 行本身（其末尾在飞块由 `core/render.ets` 从状态机在飞字段折叠而来）——
   * 不再由页面从 `liveProgressFromState` 拼凑第二份在飞内容（那正是 bug ② 的来源）。
   * 会话隔离由 `syncRowDs` 保证（`this.rows` 只来自**当前** store）。
   */
  private liveTailHasContent(): boolean {
    // ⛔ 2026-10-17（用户亲报「占位→思考 streaming 高度闪烁：行突然消失，0.x 秒后才出现
    //   思考x字」）：让位判据原来只看 store 的在飞信号 —— 占位让位的**同一帧**，页面投递
    //   给 MessageRow 的 `@State liveBlocks` 可能还没到达（值传递晚一帧）⇒ 占位已删、思考块
    //   未渲染 = 空白一帧（高度塌了再涨）。加 **liveBlocks 已到达** 前置：占位与思考块
    //   同帧无缝交接，绝不出现间隙。
    return this.hasLiveRow && this.liveBlocks.length > 0 && rowHasInFlightSignal(this.liveRowRef);
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
    this.dismissKeyboard();
    this.anim(() => {
      this.ctxOpen = true;
    });
  }

  /**
   * 打开**工具组**菜单（`ctxKind === 'tools'`，对齐 web `MessageActions.tsx:302-312`）。
   * 在开菜单那一刻由 `ctxIteration()` 派生 `names/hasText/allHasText`（判据 =
   * `core/ctxmenu.toolsMenuItems`，组件内不另写过滤）。
   */
  private openToolsCtx(rowId: string, iter: number): void {
    this.ctxKind = 'tools';
    this.ctxRowId = rowId;
    this.ctxIter = iter;
    this.ctxTool = '';
    this.dismissKeyboard();
    const it: HistoryIteration | undefined = this.ctxIteration();
    const names: string[] = [];
    const hasText: boolean[] = [];
    const all: string[] = [];
    if (it !== undefined && it.tools !== undefined) {
      for (let i = 0; i < it.tools.length; i++) {
        const tw: ToolProgress | undefined = it.tools[i];
        if (tw === undefined) {
          continue;
        }
        names.push(tw.label !== undefined && tw.label.length > 0 ? tw.label : tw.name);
        const text: string = toolCopyText(tw.name, tw.args !== undefined ? tw.args : '',
          tw.detail !== undefined ? tw.detail : '');
        hasText.push(text.trim().length > 0);
        all.push(text);
      }
    }
    this.ctxToolNames = names;
    this.ctxToolHasText = hasText;
    this.ctxToolsAllHasText = all.join('\n\n').trim().length > 0;
    this.anim(() => {
      this.ctxOpen = true;
    });
  }

  private ctxRow(): ChatRow | undefined {    for (let i = 0; i < this.rows.length; i++) {
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
  /**
   * 「迭代」长按菜单三项的**可用性**（判据与渲染同源 = `core/ctxmenu.iterMenuItems` 的空项过滤，
   * 对齐 web `MessageActions.tsx:298-301`）。三项皆空 ⇒ 菜单只剩「取消」。
   */
  private ctxIterCanReply(): boolean {
    const it: HistoryIteration | undefined = this.ctxIteration();
    return it !== undefined && displayContent(it).length > 0;
  }

  private ctxIterCanThinking(): boolean {
    const it: HistoryIteration | undefined = this.ctxIteration();
    return it !== undefined && displayReasoning(it).length > 0;
  }

  private ctxIterCanTools(): boolean {
    const it: HistoryIteration | undefined = this.ctxIteration();
    return it !== undefined && it.tools !== undefined && it.tools.length > 0;
  }

  /**
   * 「消息（行）」菜单各变体的**可复制文本**（判据与动作**同源**：动作也是
   * `composeCopy(this.partsForRow(row), this.variantOf(code))`，见 `runCtxAction`）。
   *
   * ⛔ **别按"单个字段非空"判** —— `COPY_THINKING` 的产物是**正文 + 思考**、
   *    `COPY_TOOLS` 是**正文 + 思考 + 工具**（`core/msgops.composeCopy`）：正文非空时产物即非空
   *    ⇒ 该项**应当**给出。按字段判会少给项（判据与动作脱节）。
   * 事故（2026-10-13 用户亲报「长按复制会提示没有可复制的内容」）：`ContextSheet` 的行分支
   *    此前**恒出 4 项** ⇒ 长按"最后无正文的助手消息"（工具收尾/空壳）点「复制回复」得空复制。
   */
  private ctxRowVariantText(variant: string): string {
    const row: ChatRow | undefined = this.ctxRow();
    return row === undefined ? '' : composeCopy(this.partsForRow(row), variant);
  }

  private partsForIteration(it: HistoryIteration): CopyParts {    const p: CopyParts = new CopyParts();
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

  /**
   * 整条消息的分段 —— **逐字对齐 web `MessageActions.resolveCopyText` / `buildCopyVariant`**
   * （`web/src/components/agent/MessageActions.tsx:31-61`；⛔ 不是"只看最后一迭代"）：
   *   · `reply`    = 顶层 `content`，否则**从末迭代往前扫**（正文优先，再退一步推理）
   *                  —— 真源 = `core/streammerge.resolveRowReply`（可脱机单测）；
   *   · `thinking` = **跨全部迭代**的推理（web `its.filter(it=>it?.reasoning)`）；
   *   · `tools`    = **跨全部迭代**的工具（web `its.flatMap(it=>it.tools)`）。
   *
   * 事故（2026-10-13 用户亲报「长按复制会提示没有可复制的内容」）**取文侧根因**：
   *   旧实现 `reply` 只取**最后一个迭代**的 `displayContent` ⇒ 末迭代是「工具收尾 / 仅思考」
   *   时 `reply=''` ⇒ 即便该行**明明有正文**（在更早的迭代里），「复制回复」也产出空串
   *   （`ctxmenu.rowMenuItems` 的空项过滤只是把死项藏起来，取文侧不修用户**仍复制不到正文**）。
   */
  private partsForRow(row: ChatRow): CopyParts {
    const p: CopyParts = new CopyParts();
    p.reply = resolveRowReply(row.content, row.iterations);
    const thinks: string[] = [];
    const tools: string[] = [];
    const n: number = row.iterations.length;
    for (let i = 0; i < n; i++) {
      const ip: CopyParts = this.partsForIteration(row.iterations[i]);
      if (ip.thinking.length > 0) {
        thinks.push(ip.thinking);
      }
      if (ip.tools.length > 0) {
        tools.push(ip.tools);
      }
      if (i === n - 1) {
        p.raw = ip.raw;
      }
    }
    p.thinking = thinks.join('\n\n');
    p.tools = tools.join('\n---\n');
    if (n === 0) {
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

  /**
   * 底部菜单项的**统一派发**（原 `@Builder CtxItem()` 内联的三分支，P2-2 抽出后**逐字留在页面**）：
   *   ① `cancel-hits` ⇒ 关搜索命中面板；
   *   ② `MOVE_*` / `rename` / `fork` / `delete` ⇒ 会话操作（`runSessAction`）；
   *   ③ 其余 ⇒ 长按菜单动作（`runCtxAction`）。
   * ⛔ 三个 sheet 组件只回调 `onItem(code)` —— 派发逻辑不在组件里（判据/派发不入组件）。
   */
  private onSheetItem(code: string): void {
    if (code === 'cancel-hits') {
      this.showSearchHits = false;
      return;
    }
    if (code === MOVE_TOP || code === MOVE_UP || code === MOVE_DOWN || code === 'rename'
      || code === 'fork' || code === 'delete' || code === 'star') {
      this.runSessAction(code);
      return;
    }
    this.runCtxAction(code);
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
    if (code.indexOf('copy-tool:') === 0) {
      // 工具组菜单：复制**第 i 枚**工具的文本（逐枚项，web `MessageActions.tsx:304-306`）
      const it: HistoryIteration | undefined = this.ctxIteration();
      if (it === undefined || it.tools === undefined) {
        return;
      }
      const idx: number = Number.parseInt(code.substring(10), 10);
      if (idx >= 0 && idx < it.tools.length) {
        const tw: ToolProgress | undefined = it.tools[idx];
        if (tw === undefined) {
          return;
        }
        this.copyText(toolCopyText(tw.name, tw.args !== undefined ? tw.args : '',
          tw.detail !== undefined ? tw.detail : ''), '工具输出');
      }
      return;
    }
    if (code === 'copy-all-tools') {
      // 工具组菜单：复制**全部**工具输出（web `:308-312`）
      const it: HistoryIteration | undefined = this.ctxIteration();
      if (it === undefined || it.tools === undefined) {
        return;
      }
      const segs: string[] = [];
      for (let i = 0; i < it.tools.length; i++) {
        const tw: ToolProgress | undefined = it.tools[i];
        if (tw === undefined) {
          continue;
        }
        segs.push(toolCopyText(tw.name, tw.args !== undefined ? tw.args : '',
          tw.detail !== undefined ? tw.detail : ''));
      }
      this.copyText(segs.join('\n\n'), '全部工具输出');
      return;
    }
    if (row === undefined) {
      return;
    }
    if (code === 'user-text') {
      this.copyText(row.content, '文本');
      return;
    }
    if (code === 'user-rewind') {
      this.beginRewindEdit(row);
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

  // ── rewind（编辑并重发） ───────────────────────────────────────────────────
  //
  // 对齐 web：`UserMessage.tsx` 的内联编辑 + `AgentPanel.tsx:929 rewindTo`。
  // ⛔ 铁律顺序（rewind → reset 状态机 → reload → send）封装在 `store.rewindTo` 内，
  //    页面只负责"进入编辑态 / 提交"。

  /** 进入 rewind 编辑态：把该 user 行正文预填进输入框，标记编辑目标。 */
  private beginRewindEdit(row: ChatRow): void {
    if (row.role !== 'user') {
      return;
    }
    this.rewindEditRowId = row.id;
    this.draft = row.content;
    this.anim(() => {
      this.ctxOpen = false;
    });
    this.scheduleDraftSave(row.content);
    this.toast('编辑后发送 = 回退此消息及其后的回复，并重发');
  }

  /** 退出 rewind 编辑态（取消）。 */
  private cancelRewindEdit(): void {
    this.rewindEditRowId = '';
    this.draft = '';
  }

  /**
   * 提交 rewind —— 交给 `store.rewindToMessage`（内含"新鲜快照兜底解析 DB id" +
   * rewind → reset → reload → send 的铁律顺序）。
   */
  private async submitRewind(text: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    // 目标行**用时查得**（单一来源：只存行 id）。行已不在（会话切换/行被替换）⇒ 放弃本次提交。
    const row: ChatRow | undefined = rowById(this.rows, this.rewindEditRowId);
    if (row === undefined) {
      this.cancelRewindEdit();
      return;
    }
    const target: RewindTarget = new RewindTarget(row.turnID, row.content);
    this.rewindEditRowId = '';
    this.draft = '';
    try {
      const done: boolean = await store.rewindToMessage(target, text);
      if (!done) {
        this.toast('暂时无法回退这条消息（尚未落库）');
        return;
      }
      this.buzz(HAPTIC_EVENT_CONFIRM);
      this.toast('已回退并重发');
    } catch (e) {
      this.draft = text;
      this.toast(`回退失败: ${errText(e as Object)}`);
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

  /**
   * 新建会话弹层（web `NewSessionDialog` 的等价物）—— 工作目录输入 + 最近目录候选。
   *
   * 无参 `@Builder`（读 `this` 状态）⇒ 满足"带参 @Builder 子树不随参数重建"纪律：
   * 候选/输入都是页面 `@State`，删一条立即反映（同 web `setRecentWorkDirs`）。
   * 样式与既有 sheet 同源（实底 overlay 面）；⛔ **不加**入场动效（见方法尾注释）；命中区全 ≥44 真实布局盒。
   */
  @Builder
  NewSessionSheet() {
    Column({ space: SPACE_SM }) {
      // 头部：标题 + 关闭（44 命中区）
      Row() {
        Text('新建会话')
          .fontSize(typeOf('type.headline').size)
          .fontWeight(typeOf('type.headline').weight)
          .fontColor(this.pal().textPrimary)
          .layoutWeight(1)
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(SHEET_ACTION_GLYPH)
            .fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('关闭')
        .onClick(() => {
          this.closeNewSession();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // 会话名称（web `NewSessionDialog.tsx:72-80`：Label「会话名称」+ Input，placeholder「留空则自动生成」）
      Text('会话名称')
        .fontSize(typeOf('type.micro').size)
        .fontColor(this.palOnce().textSecondary)
        .width('100%')
      TextInput({ placeholder: '留空则自动生成', text: this.newSessionLabel })
        .onChange((v: string) => {
          this.newSessionLabel = v;
        })
        .placeholderColor(this.palOnce().textMuted)
        .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
        .fontColor(this.palOnce().textPrimary)
        .fontSize(typeOf('type.caption').size)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .borderRadius(RADIUS_CARD)
        .padding({ left: SPACE_SM, right: SPACE_SM })

      // 工作目录（web `PathPicker`：输入面 + **自动补全下拉**，`PathPicker.tsx:135-192`）
      Text('工作路径')
        .fontSize(typeOf('type.micro').size)
        .fontColor(this.palOnce().textSecondary)
        .width('100%')
      TextInput({ placeholder: '输入绝对路径，例如 /root/Code/xbot', text: this.newSessionPath })
        .onChange((v: string) => {
          this.newSessionPath = v;
          this.refreshPathDirs();
        })
        .onFocus(() => {
          this.refreshPathDirs();
        })
        .placeholderColor(this.palOnce().textMuted)
        .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
        .fontColor(this.palOnce().textPrimary)
        .fontSize(typeOf('type.caption').size)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .borderRadius(RADIUS_CARD)
        .padding({ left: SPACE_SM, right: SPACE_SM })

      // 自动补全下拉（web `PathPicker.tsx:154-192`）：加载中 / 无结果 / 目录候选（点击下钻）。
      // ⛔ 行**纯文本**（不引 `sys.symbol.folder`：本 SDK 符号表无 `folder`，避免编译期资源缺失）。
      if (this.nsPathOpen) {
        Column({ space: SPACE_HAIR }) {
          if (this.nsPathLoading) {
            Row({ space: SPACE_XS }) {
              LoadingProgress().width(14).height(14).color(this.palOnce().accent)
              Text('加载中…')
                .fontSize(typeOf('type.micro').size).fontColor(this.palOnce().textMuted)
            }
            .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: SPACE_SM, right: SPACE_SM })
            .alignItems(VerticalAlign.Center)
          } else if (this.nsPathDirs.length === 0) {
            Text('无匹配结果')
              .fontSize(typeOf('type.micro').size).fontColor(this.palOnce().textMuted)
              .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
              .padding({ left: SPACE_SM, right: SPACE_SM })
          } else {
            ForEach(this.nsPathDirs, (e: FsEntry) => {
              Row() {
                Text(e.name)
                  .fontSize(typeOf('type.caption').size)
                  .fontColor(this.palOnce().textPrimary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
              }
              .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
              .padding({ left: SPACE_SM, right: SPACE_SM })
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.pickPathDir(e.name);
              })
            }, (e: FsEntry) => `nsp-${e.name}`)
          }
        }
        .width('100%')
        .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
        .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.palOnce()) })
        .borderRadius(RADIUS_CARD)
        .constraintSize({ maxHeight: 220 })
      }

      // 最近目录候选（web `NewSessionDialog.tsx:91-114`；空 ⇒ 整段不渲染，对齐 web 的 `: null`）
      // 2026-10-12（第四批排版）：原实现**每行各披一层 `surface.chip` 圆角底** ⇒ N 个药丸堆叠、
      // chrome 噪点大（web 侧本就是**纯列表**）。改 **iOS inset grouped**：一个圆角容器承载所有行、
      // 行间用**发丝线**分隔 —— 与本抽屉列表同一套结构语言（结构靠发丝，不靠卡片）。
      if (this.newSessionDirs.length > 0) {
        Text('最近使用的工作路径')
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.pal().textSecondary)
          .width('100%')
        Column() {
          ForEach(this.newSessionDirs, (path: string, idx: number) => {
            if (idx > 0) {
              Divider()
                .strokeWidth(STROKE_HAIRLINE)
                .color(hairlineOf(this.palOnce()))
                .margin({ left: SPACE_SM, right: SPACE_SM })
            }
            Row({ space: SPACE_XS }) {
              // 点路径 = 填进输入框（web `:99 setWorkPath`）—— 自带 ≥44 布局盒
              Row() {
                Text(path)
                  .fontSize(typeOf('type.caption').size)
                  .fontColor(this.pal().textSecondary)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
              }
              .layoutWeight(1)
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText(`使用工作路径 ${path}`)
              .onClick(() => {
                this.newSessionPath = path;
              })
              // 删除这条（web `:103-110` 的 X）—— 44×44 真实布局盒
              Row() {
                SymbolGlyph($r('sys.symbol.xmark'))
                  .fontSize(ICON_MD)
                  .fontColor([colorOf(this.palOnce(), 'iconMuted')])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
              .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText('删除')
              .onClick(() => {
                this.removeRecentDir(path);
              })
            }
            .width('100%')
            .padding({ left: SPACE_SM, right: SPACE_XXS })
            .alignItems(VerticalAlign.Center)
          }, (path: string) => `ns-${path}`)
        }
        .width('100%')
        .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
        .borderRadius(RADIUS_CARD)
        .clip(true)
      }

      // 取消 / 创建（自绘行按钮，各占一半、命中区 ≥44）
      Row({ space: SPACE_SM }) {
        Row() {
          Text('取消')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.pal().textSecondary)
        }
        .layoutWeight(1)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.closeNewSession();
        })
        Row() {
          Text('创建')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.pal().onAccent)
        }
        .layoutWeight(1)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .backgroundColor(this.pal().accent)
        .borderRadius(RADIUS_PILL)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          void this.confirmNewSession();
        })
      }
      .width('100%')
    }
    .width('100%').padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius({ topLeft: R_2XL, topRight: R_2XL })
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    .alignItems(HorizontalAlign.Start)
    // ⛔ 有意**不加** `.transition(sheetTransition())`：遵守「不新增未登记动效」——
    //    `pages/Index.ets` 的动效台账（`tools/tests/motion_budget.test.ts`）为 3，此处加第 4 处会
    //    破"只许缩短"。弹层**即刻出现**（无入场动效）；如要与兄弟 sheet 一致的滑入，请先登记台账。
  }

  /**
   * 面板空态：**居中**的一行（Apple 的空态是"有意留白"，⛔ 不是顶左的一小撮小字）。
   *
   * ⚠️ 参数是**字面量**、不随状态变 ⇒ 用页面自持的带参 `@Builder` 安全（不触发"带参 @Builder 的
   * 子树不随参数重建"那类失效 —— 那条只对"会变的内容"致命）。
   */
  /**
   * 面板表头**动作键**色（单一来源）：与抽屉「新建」（`DrawerSheet`）同口径 —— Apple 导航栏
   * 动作键 = **图标 + accentSoft 文字**（⛔ 不用实心色块抢占列表/页签层级）。
   *
   * 收成一个方法 = 性能预算 B 线（`pal() ∨ palOnce()` 读取总量，余量个位数）**净减**：
   * 「新建」原有 2 个读取点（`onAccent` + `accent`）+「刷新」1 个 ⇒ 收敛为这里的 1 个。
   * ⛔ 别为了"看着直白"再散回各动作键（会把 B 线顶穿）。
   */
  private panelActionTint(): string {
    return this.palOnce().accentSoft;
  }

  // ── 2026-10-13（对标 Apple）：空态从「顶部一行小字」升级为**大号弱化字形 + 说明**，
  //    并在内容区**真正居中**（真机取证：原实现贴在内容区**顶部**、下方留一大片空洞 ⇒
  //    观感「这个面板没做完」）。`layoutWeight(1)` 占满剩余空间才是"居中"的前提。
  //    ⚠️ 字形必须**已核对存在**（SDK `previewer/common/resources/entry/resources.txt` 资源表；
  //    本仓血债 =「猜字形」，见 AGENTS.md）：本面板用 `clock`/`hourglass`/`person_2`/`code` ——
  //    ⛔ **没有** `terminal` 字形（该表 9552 个字形里 0 命中）⇒ 终端改用 `code`。
  // ── 2026-10-13（S2，对标 Apple 空态**层级**）：Apple 的"什么都没有"从来不是**一句话**，
  //    而是 **字形 → 主行（说"没有什么"）→ 提示行（说"怎么才会有"）** 的三段层级：
  //      · 主行 `type.subhead` + `textSecondary`（读成"标题"）
  //      · 提示行 `type.caption` + `textMuted`（读成"补充"）
  //    ⇒ 由 1 行升为 2 行（`hint` 允许空串 ⇒ 自动退回单行形态）。
  @Builder
  PanelEmpty(icon: Resource, title: string, hint: string) {
    Column({ space: SPACE_XS }) {
      SymbolGlyph(icon)
        .fontSize(typeOf('type.display').size)
        .fontColor([colorOf(this.palOnce(), 'iconMuted')])
      Text(title)
        .fontSize(typeOf('type.subhead').size)
        .fontWeight(typeOf('type.subhead').weight)
        // ⚠️ 走 `palOnce()`（记忆化入口）：本页 `this.pal()` 调用点受性能预算 A 线（≤1250）约束，
        //    新增 UI 一律走 memo 入口（语义与 `pal()` 逐字节一致）。
        .fontColor(this.palOnce().textSecondary)
        .width('100%')
        .textAlign(TextAlign.Center)
        .padding({ top: SPACE_SM })
      if (hint.length > 0) {
        Text(hint)
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.palOnce().textMuted)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ bottom: SPACE_SM })
      }
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    // 与 tab 内容的 List 同一过渡（切 tab 时「空态 <-> 列表」也只淡入，不跳）
    .transition(fadeTransition())
  }

  /** 面板：四个标签各拉一个端点（定时任务 / 后台任务 / 子代理 / Runner）。 */
  @Builder
  PanelsSheet() {
    Column({ space: SPACE_SM }) {
      // ⚠️ 2026-10-12（目标③）：`刷新` / `✕` 原先只靠 `padding(SPACE_XS)` 撑热区（≈32 < 44，
      //    违反 Apple HIG）⇒ 改**真实 ≥44 布局盒**（⛔ 不用 `responseRegion` 负偏移外扩 —— 真机实测无效）。
      Row({ space: SPACE_XS }) {
        Text('运行面板').fontSize(typeOf('type.headline').size).fontWeight(typeOf('type.headline').weight).fontColor(this.pal().textPrimary).layoutWeight(1)
        if (this.panelBusy) {
          LoadingProgress().width(16).height(16).color(this.pal().accent)
        }
        // ⚠️ 2026-10-12（目标③/④）：原「＋ 新建」是**内容区里一行右对齐的孤按钮**（真机取证：
        //    终端 tab 下它单独占一行、上下各留 ~150px 空隙、空态再沉到最底 ⇒ 看着"没做完"）。
        //    ⇒ 收进**表头**（与 刷新/✕ 同排，仅终端 tab 出现）：动作归动作、内容归内容，
        //    与 `SettingsPanel` / `PluginsSheet` 的表头动作惯例一致。
        if (this.panelTab === 'term') {
          // ── 2026-10-13（S2，对标 Apple）：由**实心 accent 胶囊**改 **Apple 导航栏动作键形态**
          //    = **图标 + accentSoft 文字**（与抽屉「新建」`DrawerSheet` 逐字同款）。原实心块与
          //    页签/标题抢层级（用户口径「实心色块 = 按钮墙」）。
          //    ⛔ 弃用全角「＋」——其字面宽度/基线与其他字形不同，真机观感是"＋ 新建"被拉开成两块。
          //    `.id('xbot-panel-new')` = 面板动作键的**稳定判据锚**（`sheet_chrome` ⑥ /
          //    `panel_terminal_wiring` ① 钉它，取代易随文案漂移的字面量）。
          Row({ space: SPACE_XS }) {
            SymbolGlyph($r('sys.symbol.plus'))
              .fontSize(ICON_SM)
              .fontColor([this.panelActionTint()])
            Text('新建')
              .fontSize(typeOf('type.subhead').size)
              .fontColor(this.panelActionTint())
          }
          // ⚠️ 用 `SPACE_XS`（⛔ **不是** `SPACE_HAIR`）：`status_sheet_drawer` 判据以
          //    「`SPACE_HAIR` 且后接块开头」那一行为**首个**锚去切"抽屉分段控件轨道"——本处若同用
          //    该间距常量会成为更早的首匹配 ⇒ 切片起点前移到本行、把 8916 的折叠动作卷进轨道
          //    ⇒ 那条"控制类型不混用"断言**假红**（本轮实测踩过；⛔ 注释里也不得复写该锚串）。
          // 真机实测 `responseRegion` 负偏移外扩**不生效**（AGENTS.md GOTCHA）⇒ 用真实 44 布局盒
          .id('xbot-panel-new')
          .height(HIT_TARGET_MIN)
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('新建终端')
          .onClick(() => {
            this.newTerminal();
          })
        }
        // ── 2026-10-14（要求③-2「所有面板」）：由**文字「刷新」**改 **Apple 导航栏图标键**，
        //    与 `SessionStatsSheet`（统计）/ `WebSurface`（Web 面板）的刷新**逐字段同款**
        //    （字形 `arrow_clockwise` · `ICON_MD` · 色 `textSecondary` · 44 布局盒 · a11y '刷新'）。
        //    理由：**同一个动作在三个面板必须是同一控件类型** —— 此前"统计=图标键 / 运行面板=文字键"
        //    并存 ⇒ 与用户口径「控件类型不自洽」同类（同 ③-1 抽屉两修的判据）。且本行原为
        //    「文字键 + 图标 ✕」混排，图标键后整排动作键形态收敛为字形。
        //    ⛔ 热区仍是**真实 ≥44 布局盒**（`responseRegion` 负偏移在本机/SDK21 实测无效，见 AGENTS.md）。
        //    ⛔ 本行**不得**改成 `SPACE_HAIR`：`status_sheet_drawer` 判据以「`SPACE_HAIR` 且后接块开头」
        //    那行为首个锚切"抽屉分段控件轨道"，此处更早匹配会把 8916 的折叠动作卷进轨道 ⇒ 假红。
        Row() {
          SymbolGlyph($r('sys.symbol.arrow_clockwise'))
            .fontSize(ICON_MD)
            .fontColor([this.pal().textSecondary])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('刷新')
        .onClick(() => {
          this.refreshPanel();
        })
        Row() {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH).fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('关闭运行面板')
        .onClick(() => {
          this.showPanels = false;
        })
      }.width('100%').alignItems(VerticalAlign.Center)

      // ⚠️ 2026-10-12（目标③ 排版）：原 `Row({space:6})` 不换行 ⇒ 5 个 tab 右缘被裁（真机 dump：
      //    `终端 0` 落在 [1120,2536][1302,2623] 贴 sheet 右缘、像"坏了"）⇒ 先改 `Flex(wrap)`
      //    （不裁了，但**每片宽度随标签参差** 222/222/182/194/141px ⇒ 看着"没排过"）。
      //    本轮改 **`Row` + 每片 `layoutWeight(1)` 等分**：⛔ 不可能被裁（每片恰得 1/n 宽）、
      //    **也不可能参差**（无魔数、任何屏宽都齐平）—— 这就是 iOS `UISegmentedControl` 的形态。
      //    ⚠️ 前提 = 标签 ≤ 2 个汉字（含计数）：「2 字 + 空格 + 2 位数」= 3.8 个全角字 ≤ 每片预算
      //    3.9（见 `panelTabLabel` 头注）；判据 ③b 钉住这条不变式（标签槽位 + 等分形态）。
      //    ⚠️ 2026-10-13（目标③ 15z12）：由**实心 accent 芯片**改 **下划线式页签** —— 与
      //    `SettingsPanel.TabBar`（早一轮同项改造）**同一视觉语言**：选中 = 文字加重 + 一条 accent
      //    指示线，不是填充块。用户亲报「实心芯片」：5 枚同形实心块读起来是"按钮墙"，且实心色块
      //    的视觉重量（5 × 色块）会压过面板标题本身的层级。
      //    等分形态**保持不变**（每片 `layoutWeight(1)` ⇒ 任何屏宽都齐平、不可能被裁/参差）。
      Row({ space: SPACE_XS }) {
        ForEach(this.panelTabs(), (tab: string) => {
          Column({ space: SPACE_HAIR }) {
            Text(this.panelTabLabel(tab))
              .fontSize(typeOf('type.subhead').size)
              .fontWeight(this.panelTab === tab ? FontWeight.Medium : typeOf('type.subhead').weight)
              // ⛔ `accent` **不得**直接做文字色（对底仅 4.05 < 4.5，仓内铁律 `accent_chrome.test.ts`）
              //    ⇒ 选中文字走 `accentSoft`（5.57–12.0 全主题过线），与设置页签同一口径。
              .fontColor(this.panelTab === tab ? this.pal().accentSoft : this.pal().textSecondary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center)
            // 指示器：**仅选中项上色**（未选中 = 透明 ⇒ 失败方向安全：绝不让"状态缺失"读成"已选中"）。
            Row()
              .width(SPACE_LG)
              .height(STROKE_RAIL)
              .borderRadius(STROKE_RAIL)
              .backgroundColor(this.panelTab === tab ? this.pal().accent : this.pal().transparent)
              // 选中态缓动（与抽屉分段控件同一口径；只动指示器底色）
              .animation(animBase())
          }
          .layoutWeight(1)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.switchPanelTab(tab);
          })
        }, (tab: string) => `ptab-${tab}`)
      }.width('100%')

      // ── 快赢 4（2026-10-17）：任务面板 loading 行 + 断线提示 ──
      // web 对照 `TasksPanel.tsx:265-269`（Loader2 loading）与 `:275-277`（断线文案）；
      // 原生此前 `panelBusy` 只做排队守卫（无 UI）、断线静默 ⇒ 用户看到旧数据/空态却不知为何。
      // 形态与主界面弱网行（:6577 区 Row+LoadingProgress+warn）同款——全站一套语言。
      if (this.panelBusy) {
        Row({ space: 6 }) {
          // B 线预算（⛔ pal() 只许减）：loading 是中性信息——LoadingProgress 默认色+Text 继承，
          // 不再各取一色（省 2 处 pal()）。
          LoadingProgress().width(14).height(14)
          Text('加载中…')
            .fontSize(typeOf('type.caption').size)
        }
        .width('100%').padding({ left: SPACE_SM, right: SPACE_SM, top: 4, bottom: 4 })
      } else if (this.connState === 'reconnecting' || this.connState === 'connecting') {
        Row({ space: 6 }) {
          // 警示性由文字 warn 色+warnBg 背景承担（LoadingProgress 默认色——省 1 处 pal()）。
          // ⛔ 不用 `layoutWeight(1)`（①b 断言的 tabRow 窗口覆盖到本行——会数成第 3 处假红）；
          // 用 maxWidth 约束防溢出，省略号截断同效。
          LoadingProgress().width(14).height(14)
          Text('连接断开，正在重连…（任务状态可能滞后）')
            .fontSize(typeOf('type.caption').size).fontColor(this.pal().warn)
            .constraintSize({ maxWidth: '100%' })
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%').padding({ left: SPACE_SM, right: SPACE_SM, top: 4, bottom: 4 })
        .backgroundColor(this.pal().warnBg)
      }

      if (this.panelTab === 'cron') {
        if (this.cronTasks.length === 0) {
          this.PanelEmpty($r('sys.symbol.clock'), '暂无定时任务', '定时任务到点会自动执行本会话')
        } else {
          List({ space: 6 }) {
            ForEach(this.cronTasks, (job: CronJob, i: number) => {
              ListItem() {
                PanelRowCard({
                  theme: this.themeName,
                  // 常驻 ⏰ 前导字形（web `TasksPanel.tsx:115` AlarmClock 同源；见 `LEAD_CRON` 注释）。
                  lead: LEAD_CRON,
                  primary: cronPrimary(job),
                  secondary: cronSubText(job),
                  tone: TONE_MUTED,
                  trailing: ROW_TRAIL_DELETE,
                  onTap: () => {
                    this.openCronDetail(job);
                  },
                  onTrailing: () => {
                    this.removeCron(job.id !== undefined ? job.id : '');
                  },
                })
              }
            }, (job: CronJob, i: number) => `cron-${job.id}#${i}`)
          }.layoutWeight(1).width('100%')
          // 切 tab = 分支移除 + 插入 => 用**出现过渡**（`fadeTransition`）。静息态恒为可见值
          // （⛔ 绝不写 `opacity(x?1:0)` + animateTo 那种「可读性是动画的函数」的形态，见门禁⑨）。
          .transition(fadeTransition())
        }
      } else if (this.panelTab === 'tasks') {
        // 快赢 3（2026-10-17）：过滤开关行——**tasks 分支公共头部**（空态/过滤空态/列表态
        // 恒在场；装机实证初版只放列表分支 ⇒ 过滤空态文案让用户「关闭开关」却无处可关）。
        // ⛔ 文本与开关之间用 `Blank()` 撑开（不用 `layoutWeight(1)`：①b 断言的 tabRow 窗口
        //    钉「layoutWeight(1) 恰 2 处」，本行落在窗口内会假红）。B 线预算：Text 不取色（继承）。
        if (this.bgTasks.length > 0) {
          Row({ space: SPACE_XS }) {
            Text('只看运行中')
              .fontSize(typeOf('type.caption').size)
            Blank()
            Toggle({ type: ToggleType.Switch, isOn: this.panelBgOnlyRunning })
              .onChange((on: boolean) => {
                this.panelBgOnlyRunning = on;
              })
          }
          .width('100%').padding({ left: SPACE_SM, right: SPACE_SM, top: 2, bottom: 2 })
        }
        if (this.bgTasks.length === 0) {
          this.PanelEmpty($r('sys.symbol.hourglass'), '暂无后台任务', '后台命令在服务端持续运行，不受会话切换影响')
        } else if (this.bgTasksVisible().length === 0) {
          // 快赢 3：过滤后空（全量非空）——明说「是过滤的结果」，⛔ 不误导成「暂无任务」。
          this.PanelEmpty($r('sys.symbol.hourglass'), '无运行中的后台任务',
            `共 ${this.bgTasks.length} 条历史，关闭「只看运行中」即可查看`)
        } else {
          List({ space: 6 }) {
            // ⛔ **运行中置顶**（判据 `core/panels.ets:sortBgTasksActiveFirst`）：真机实测 354 条
            //    任务一屏平铺、正在跑的那条混在中段 ⇒ 用户"看不到任务"。排序 + 前导状态字形
            //    （`bgTaskLeadCode`）让"哪条在跑 / 哪条失败"一眼可扫。
            ForEach(this.bgTasksVisible(), (t: BgTask, i: number) => {
              ListItem() {
                PanelRowCard({
                  theme: this.themeName,
                  lead: bgTaskLeadCode(t),
                  primary: bgTaskPrimary(t),
                  secondary: bgTaskSubText(t, this.nowMs()),
                  tone: bgTaskTone(t),
                  // 尾部动作按**状态**分流（判据 `bgTaskRunning` = 与状态文案/前导字形同一真源）：
                  //   运行中 ⇒ **行内终止**（web `TasksPanel.tsx:246-255` 只在 running 时给 `Square` 按钮）；
                  //   完成/失败 ⇒ chevron（进详情看输出 —— 原生比 web 多的一层，不因此丢掉）。
                  // ⛔ 行键含 `t.status`（见下方 ForEach key）⇒ 状态翻转时该行**重建**，
                  //    尾部动作随之切换（否则 `@Prop trailing` 不更新 = 完成的任务还挂着"终止"）。
                  trailing: bgTaskRunning(t) ? ROW_TRAIL_STOP : ROW_TRAIL_CHEVRON,
                  onTap: () => {
                    this.openTaskDetail(t);
                  },
                  onTrailing: () => {
                    this.killBgTaskRow(t);
                  },
                })
              }
            }, (t: BgTask, i: number) => `bg-${t.id}#${t.status}#${i}`)
          }.layoutWeight(1).width('100%')
          // 切 tab = 分支移除 + 插入 => 用**出现过渡**（`fadeTransition`）。静息态恒为可见值
          // （⛔ 绝不写 `opacity(x?1:0)` + animateTo 那种「可读性是动画的函数」的形态，见门禁⑨）。
          .transition(fadeTransition())
        }
      } else if (this.panelTab === 'subs') {
        if (this.subagents.length === 0) {
          this.PanelEmpty($r('sys.symbol.person_2'), '暂无子代理', '派发子代理后会出现在这里')
        } else {
          List({ space: 6 }) {
            ForEach(this.subagents, (a: SubAgentRow, i: number) => {
              ListItem() {
                PanelRowCard({
                  theme: this.themeName,
                  primary: subagentPrimary(a),
                  secondary: subagentSubText(a),
                  tone: subagentTone(a),
                  trailing: ROW_TRAIL_NONE,
                  onTap: () => {
                    this.showPanels = false;
                    if (a.chat_id !== undefined) {
                      this.switchSession(a.chat_id);
                    }
                  },
                })
              }
            }, (a: SubAgentRow, i: number) => `sub-${a.chat_id}#${i}`)
          }.layoutWeight(1).width('100%')
          // 切 tab = 分支移除 + 插入 => 用**出现过渡**（`fadeTransition`）。静息态恒为可见值
          // （⛔ 绝不写 `opacity(x?1:0)` + animateTo 那种「可读性是动画的函数」的形态，见门禁⑨）。
          .transition(fadeTransition())
        }
      } else if (this.panelTab === 'term') {
        // ⚠️ 取色一律走 `palOnce()`（记忆化入口，语义与 `pal()` 逐字节一致）：`this.pal()` 是
        //    **未 memo 的真分配**，性能预算 A 线（≤1250）只许减 ⇒ 新增 UI 按本页既定约定走本入口。
        // ⛔ 内容区**不再放计数**：面板 tab 标签本身已带计数（`panelTabLabel('term')` = `终端${n>0? ' '+n:''}`，
        //    `panelCount('term')` = `terminals.length`）⇒「共 N 个终端」与 tab「终端 N」**永远重复**
        //    （真机取证：tab 显示「终端 2」+ 内容区「共 2 个终端」）。留 tab 的计数即可（其空态自动隐后缀）。
        // ⛔ 内容区**无动作**：唯一的「＋ 新建」已上移到表头（见上）——此处只留列表 / 空态。
        if (this.terminals.length === 0) {
          this.PanelEmpty($r('sys.symbol.code'), '暂无终端', '新建终端即可在此设备上运行 shell')
        } else {
          List({ space: 6 }) {
            ForEach(this.terminals, (t: TerminalInfo, i: number) => {
              ListItem() {
                PanelRowCard({
                  theme: this.themeName,
                  primary: terminalPrimary(t, i),
                  secondary: terminalSubText(t, this.nowMs()),
                  // ⛔ 终端**列表**无连接状态数据（状态只在 `TerminalSheet` 的本地 @State）⇒ 恒 muted
                  tone: this.termLiveTone(t.tid),
                  trailing: ROW_TRAIL_CLOSE,
                  onTap: () => {
                    this.openTerminal(t);
                  },
                  onTrailing: () => {
                    this.closeTerminal(t.tid);
                  },
                })
              }
            }, (t: TerminalInfo, i: number) => `term-${t.tid}#${this.termLiveKey(t.tid)}#${i}`)
          }.layoutWeight(1).width('100%')
          // 切 tab = 分支移除 + 插入 => 用**出现过渡**（`fadeTransition`）。静息态恒为可见值
          // （⛔ 绝不写 `opacity(x?1:0)` + animateTo 那种「可读性是动画的函数」的形态，见门禁⑨）。
          .transition(fadeTransition())
        }
      } else {
        if (this.runners.length === 0) {
          this.PanelEmpty($r('sys.symbol.computer'), '暂无受管机器', '在服务端注册 Runner 后可在此查看')
        } else {
          List({ space: 6 }) {
            ForEach(this.runners, (r: RunnerRow, i: number) => {
              ListItem() {
                PanelRowCard({
                  theme: this.themeName,
                  primary: runnerPrimary(r),
                  secondary: runnerSubText(r),
                  tone: runnerTone(r),
                  trailing: ROW_TRAIL_NONE,
                  tappable: false,
                })
              }
            }, (r: RunnerRow, i: number) => `run-${r.name}#${r.online}#${i}`)
          }.layoutWeight(1).width('100%')
          // 切 tab = 分支移除 + 插入 => 用**出现过渡**（`fadeTransition`）。静息态恒为可见值
          // （⛔ 绝不写 `opacity(x?1:0)` + animateTo 那种「可读性是动画的函数」的形态，见门禁⑨）。
          .transition(fadeTransition())
        }
      }
    }
    .width('100%')
    // ⚠️ 2026-10-12（目标③/④，用户点名「**任务管理做的很差**」）：原先是**按内容撑高**的底部
    //    sheet（真机量测只有 640px = 189vp），列表又被 `maxHeight: 420` 卡住 ⇒ 一屏看不下 3 行。
    //    改**固定 60%**（iOS 中档 detent 量级）：高度稳定、列表 `layoutWeight(1)` 吃满剩余
    //    ⇒ 一屏能看 ~6 行；空态仍在顶部（内容少时 sheet 不塌、也不留突兀空白）。
    .height('60%')
    .padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius({ topLeft: R_2XL, topRight: R_2XL })
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    .alignItems(HorizontalAlign.Start)
    .transition(sheetTransition())
  }

  /** 一行的主体（用户气泡 / 助手块）——由 `LazyForEach` 的 `ListItem` 调用。 */
  @Builder
  ChatRowBody(row: ChatRow) {
    if (row.role === 'user') {
      UserBubbleView({
        text: row.content,
        // 通知类 user 行**原样呈现**（web `UserMessage.notification.test.tsx:13/23`）；其余走
        // 与助手同一条 markdown 渲染（web `UserMessage.tsx:4-5`）—— 追加的图片引用因此成图。
        isNotification: row.isNotification === true,
        mdTheme: this.mdThemeId(),
        onImage: (src: string) => {
          this.openImage(src);
        },
        loadImage: (src: string) => {
          return this.loadImageBytes(src);
        },
        onLongPress: () => {
          this.openCtx('user', row.id, 0, '');
        },
      })
    } else if (!rowIsEmpty(row)) {
      // 空气泡守卫：无正文/思考/工具的行（含等待首帧的 live 行）不渲染卡片；
      // 等待态由列表尾部的「思考中…」占位承担（与 web 的 ShimmerThinking 同语义）
      MessageRowView({
        row: row,
        mdTheme: this.mdThemeId(),
        fontScaleV: this.fontScale(),
        wrapCodeV: this.wrapCode(),
        sweepX: this.sweepX,
        orb: this.orbOn(),
        // §21.122bx：浮层覆盖聊天区时**停表**（光球 30fps Canvas 是流式期唯一实测到的 CPU 地板；
        // 被浮层盖住 ⇒ 无人看见，却与浮层入场动画抢帧预算）。语义与"后台停表"同一条通道。
        paused: this.appPaused || this.anyModalOpen(),
        onImage: (src: string) => {
          this.openImage(src);
        },
        loadImage: (src: string) => {
          return this.loadImageBytes(src);
        },
        onLoadMoreRegions: () => {
          return this.loadMoreRegions(row);
        },
        onOpenCtx: (iter: number, name: string) => {
          this.openCtx(name.length > 0 ? 'tool' : 'iter', row.id, iter, name);
        },
        onOpenToolsCtx: (iter: number) => {
          this.openToolsCtx(row.id, iter);
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
        // B6：代码块「复制」反馈落点 = **品牌 toast**（`TOAST_KIND_COPY` ⇒ 文案「已复制」、时长 1200ms，
        // 与消息级复制**同一落点**/同一句）。⛔ 组件内不再用系统 `promptAction.showToast`。
        onToast: (msg: string) => {
          this.toast(msg, TOAST_KIND_COPY);
        },
        subAgentOpenable: true,
        onOpenSubAgent: (sessionKey: string) => {
          this.openSubAgentSession(sessionKey);
        },
        // 转后台：进行中的 shell 工具浮层里出现「转后台」条（RPC `promote_shell` + toast）。
        onPromoteShell: (callId: string) => {
          return this.promoteShellAction(callId);
        },
        // GenUI（`display_html`）面板：工具卡片 → 建分享 + 落 `WebSurface` URL（层内不留 IO）。
        onOpenGenui: (code: string, title: string) => {
          this.openGenuiPanel(code, title);
        },
        // 分享 chip（web ShareablePanel 对等物）：页面建分享链 + 回 URL（复制由卡片 pasteboard 落地）。
        onShareGenui: (code: string, title: string): Promise<string> => {
          return this.shareGenuiLink(code, title);
        },
      })
    }
  }



  /**
   * live turn 的整条 assistant 消息体（同气泡：已完成迭代 ⊕ 末尾在飞块）。
   *
   * ⛔ **无参** @Builder，内部全部读页面 `@State`（`liveRowRef` / `liveText` /
   *   `liveReasoning` / `liveTools`）—— 这是本回归的根治点：
   *   · live 行**不能**带参调用（`this.ChatRowBody(this.liveRowRef)`）：@Builder 按值
   *     传参是"调用那一刻的快照"，`ChatRow` 又是就地更新的（引用恒定）⇒ 组件永不重建
   *     ⇒ 流式期间渲染输入冻结（真机「第一条 SSE 到达就消失、中间全空」）。见
   *     docs/ARKTS-GOTCHAS.md §4 与 `liveText` 的注释。
   *   · 三项 `live*` 由 `syncLiveTail()` 从**同一个** live 行的末尾在飞块派生
   *     （与 `rowIsEmpty` 判据同源）⇒ 投递给渲染的内容与判据不可能分叉。
   */
  @Builder
  LiveRowBody() {
    if (!rowIsEmpty(this.liveRowRef)) {
      MessageRowView({
        row: this.liveRowRef,
        liveText: this.liveText,
        liveReasoning: this.liveReasoning,
        liveTools: this.liveTools,
        liveBlocks: this.liveBlocks,
        liveSubAgents: this.liveSubAgents,
        mdTheme: this.mdThemeId(),
        fontScaleV: this.fontScale(),
        wrapCodeV: this.wrapCode(),
        sweepX: this.sweepX,
        orb: this.orbOn(),
        // §21.122bx：浮层覆盖聊天区时**停表**（光球 30fps Canvas 是流式期唯一实测到的 CPU 地板；
        // 被浮层盖住 ⇒ 无人看见，却与浮层入场动画抢帧预算）。语义与"后台停表"同一条通道。
        paused: this.appPaused || this.anyModalOpen(),
        onImage: (src: string) => {
          this.openImage(src);
        },
        loadImage: (src: string) => {
          return this.loadImageBytes(src);
        },
        onLoadMoreRegions: () => {
          return this.loadMoreRegions(this.liveRowRef);
        },
        onOpenCtx: (iter: number, name: string) => {
          this.openCtx(name.length > 0 ? 'tool' : 'iter', this.liveRowRef.id, iter, name);
        },
        onOpenToolsCtx: (iter: number) => {
          this.openToolsCtx(this.liveRowRef.id, iter);
        },
        onToggleTool: (iter: number, name: string) => {
          this.toggleToolByKey(this.liveRowRef, iter, name);
        },
        onRowLongPress: () => {
          this.openCtx('row', this.liveRowRef.id, 0, '');
        },
        onCopy: (text: string, what: string) => {
          this.copyText(text, what);
        },
        // B6：live 在飞正文里的代码块「复制」—— 落点 = 品牌 toast（同 committed 侧）。
        onToast: (msg: string) => {
          this.toast(msg, TOAST_KIND_COPY);
        },
        // 转后台：live 侧 shell 工具浮层里的「转后台」条（RPC `promote_shell` + toast）。
        onPromoteShell: (callId: string) => {
          return this.promoteShellAction(callId);
        },
        // GenUI（`display_html`）面板：工具卡片 → 建分享 + 落 `WebSurface` URL（层内不留 IO）。
        onOpenGenui: (code: string, title: string) => {
          this.openGenuiPanel(code, title);
        },
        // 分享 chip（web ShareablePanel 对等物）：页面建分享链 + 回 URL（复制由卡片 pasteboard 落地）。
        onShareGenui: (code: string, title: string): Promise<string> => {
          return this.shareGenuiLink(code, title);
        },
      })
    }
  }

  /** 一个迭代 = 思考(T) / 正文(O) / 工具(C)。 */



  /** live 行的行 id（长按菜单用）。 */
  private liveRowIdOf(): string {
    return this.hasLiveRow ? this.liveRowRef.id : '';
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
      : '几何未采集：请点上面的「采集各页版面几何」按钮';
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
    let regionRows: number = 0;
    let regionTotal: number = 0;
    for (let i = 0; i < rows.length; i++) {
      const r: ChatRow = rows[i];
      const n: number = r.iterations.length;
      iterTotal += n;
      if (n > maxIter) {
        maxIter = n;
      }
      if (r.regionsBefore > 0) {
        regionRows++;
        regionTotal += r.regionsBefore;
      }
    }
    // 迭代**全量渲染**（对齐 web：无「点击展开全部」）⇒ 渲染块数 = 迭代总数
    return `rows=${rows.length}\n迭代总数=${iterTotal}（全量渲染）\n单行最多迭代=${maxIter}\n`
      + `带更早区域的行=${regionRows}（共 ${regionTotal} 个区域可上滑加载）\n`
      + `会话=${this.currentChat}\nbusy=${this.busy}\n`
      + mdCacheText() + '\n' + streamStatsText();
  }

  /**
   * 加载该 turn 更早的展示区域（服务端折叠视图按需取回）。
   *
   * 返回是否成功 —— 行组件据此显示 idle / error（**失败不自动重试**，与 web
   * `useRegionWindow` 一致：避免弱网下的自动请求循环）。
   */
  private async loadMoreRegions(row: ChatRow): Promise<boolean> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return false;
    }
    try {
      await store.loadEarlierRegions(row);
      return true;
    } catch (e) {
      this.toast(`加载更早区域失败: ${errText(e as Object)}`);
      return false;
    }
  }


  /**
   * 工具状态颜色 —— web 的「色彩只表达状态」法则：
   * 运行/生成中保留注意力色（琥珀会被误读为警告，改用强调色）；完成/排队中性；失败红。
   */

  /** 工具状态角标（web 五态：generating 带字数、running 带时长、error 带 exit）。 */

  /** pill 显示名（名字 + 状态角标）。 */

  // ── 弹层：会话抽屉 ────────────────────────────────────────────────────────

  /**
   * 渠道筛选**下拉内容**（web `ChannelPicker.tsx:120-142` 的 `PopoverContent` 等价物）。
   *
   * ⛔ 纯客户端派生（`availableChannels`），只作用于列表视图；**不动** `channelForChat`
   *    （真机事故：否则点开非 web 会话报 `session not found`）。
   * ⛔ 无参 `@Builder`（读 `this`，非带参 ⇒ 不触 `ARKTS-GOTCHAS` 的"带参 @Builder 快照"坑）。
   *    浮层内容会随 `activeChannel` 变（accent 跟随当前值），开合即重建，故不缓存快照。
   */
  @Builder
  ChannelPickerMenu() {
    Column() {
      // 「全部」（web `data-channel="__all__"`）：当前值走 accent 强调
      // （对齐 web `!current ? 'font-medium text-accent'`）—— 判据同源（`activeChannel`）。
      Text(activeChannelLabel(''))
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .fontSize(typeOf('type.subhead').size)
        .fontColor(this.activeChannel.length === 0 ? this.pal().accentText : this.pal().textSecondary)
        .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
        .borderRadius(RADIUS_CHIP)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.activeChannel = '';
          // 切换成功后落盘（对齐 web localStorage；失败不影响本次过滤）
          this.config.saveActiveChannel('').catch(() => {
          });
        })
      ForEach(availableChannels(this.sessions), (ch: string) => {
        Text(activeChannelLabel(ch))
          .width('100%')
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(typeOf('type.subhead').size)
          .fontColor(this.activeChannel === ch ? this.pal().accentText : this.pal().textSecondary)
          .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
          .borderRadius(RADIUS_CHIP)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.activeChannel = ch;
            // 切换成功后落盘（对齐 web localStorage；失败不影响本次过滤）
            this.config.saveActiveChannel(ch).catch(() => {
            });
          })
      }, (ch: string) => `chmenu-${ch}`)
    }
    .padding(SPACE_HAIR)
    // 菜单宽度**显式给**：行内的 `width('100%')` 若没有父宽度约束，会被 ArkUI 按浮层**最大宽**
    // 解析 ⇒ popup 被撑到 ~375vp（真机实测），菜单项左右各留一大片空白。给死宽度后行面 = 菜单宽
    // （点按热区随之满行）。
    .width(200)
  }

  /**
   * 「分组显示」菜单（`ellipsis_circle` 触发，见筛选行内的注）。
   *
   * **只渲染此刻适用的那一项**（Apple「…」菜单惯例：菜单里只放当前能做的事）——
   * `allCollapsed` 决定是「全部展开」还是「全部折叠」；点击落 `applyCollapseAll()`
   * （= 按 `collapseAllPlan.target` **原子**设置，⛔ 不自造第二套折叠状态）。
   */
  @Builder
  CollapseMenu() {
    Column() {
      Text(this.collapseAllPlanNow().allCollapsed ? '全部展开' : '全部折叠')
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .fontSize(typeOf('type.subhead').size)
        .fontColor(this.pal().textPrimary)
        .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
        .borderRadius(RADIUS_CHIP)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.applyCollapseAll();
        })
    }
    .padding(SPACE_HAIR)
    // 菜单宽度**显式给**（同 `ChannelPickerMenu`：不给会被 ArkUI 按浮层最大宽解析 ⇒ 撑到 ~375vp）。
    .width(160)
  }

  /**
   * 抽屉分区**组头**（`ListItemGroup.header`）。
   *
   * ⚠️ 为什么独立成构件而不是内联成 `ListItem`：只有 `header` 能配 `List().sticky(StickyStyle.Header)`
   *    ⇒ 组头**吸顶**（Apple 列表语义：滚动长会话列表时「今天 / 昨天」始终可见；web 侧栏**不吸顶**
   *    ⇒ 这是原生**超越**项）。普通 `ListItem` 写了 `.sticky()` 也**静默无效**。
   * ⚠️ **吸顶必须自带不透明底**，否则行会从组头下面透出来。这里用**与抽屉根同一材质**
   *    （实底 `surface.overlay`）⇒ 吸顶时与周围**逐像素无缝**（⛔ 别换成玻璃或别的 surface
   *    角色：抽屉根已于 15o·d 统一为实底 overlay，玻璃会重新"透字成脏"并在吸顶时露色差接缝）。
   * ⚠️ 组间距（非首组 `SPACE_MD`）由 `margin` 改 `padding` **且被底色覆盖**：未吸顶时观感**逐像素不变**
   *    （仍是"60vp = 留白 + 标题"），吸顶时那段留白不再是透明缝（否则行会在缝里露出来）。
   * ⚠️ 折叠态在 builder 体内读 `this.isGroupCollapsed(...)`，而 `header` 参数是**调用那一刻的快照**
   *    （本仓 `@Builder` 快照陷阱）⇒ 外层 ForEach 的**键必须带折叠态**（见 `DrawerSheet` 内注释），
   *    否则 chevron 旋转会**卡在初值**。
   */
  /**
   * 会话行**状态点**的语义色 role（**唯一判据** = `core/sessiongroup.sessionStatusRole`）：
   * 跑着=蓝 / 等回答=琥珀 / 失败=红；idle·未知 ⇒ 空串 ⇒ **不画点**（原生克制，见纯函数注释）。
   * ⚠️ 2026-10-13：原实现只在 `running === true` 画**绿**点 ⇒ `waiting_input`（该你说话了）
   * 与 `error` **完全不可见**，且绿 ≠ web `--status-running`。
   */
  private sessDotRole(s: SessionItem): string {
    return sessionStatusRole(s.status, s.running === true);
  }

  /** 状态点色值（role → 色；未知名回落 transparent，与 `colorOf` 兜底同向）。 */
  private sessDotColor(s: SessionItem): string {
    return colorOf(this.palOnce(), this.sessDotRole(s));
  }

  @Builder
  DrawerGroupHeader(g: DrawerGroup, gIdx: number) {
    Row({ space: SPACE_XS }) {
      // 折叠箭头住进**与行内标记同一个槽**（`MARKER_GUTTER`）⇒ 组头标题与行标题落在
      // **同一条竖轴**上（此前组头标题 x≈22vp、行标题 x≈58vp ⇒ 差 36vp，读起来像两套排版）。
      Row() {
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(typeOf('type.micro').size).fontColor([colorOf(this.pal(), 'iconMuted')])
          .rotate({ angle: this.isGroupCollapsed(this.sessionCategory(), g.key) ? 0 : 90 })
          // 折叠/展开的箭头旋转**要有过渡**（此前瞬变 ⇒ 观感"跳"）。
          // 属性动画走底座 `animFast()`（⛔ 不自造时长/曲线）；`.animation()` 作用于其**之前**的属性。
          .animation(animFast())
      }
      .width(MARKER_GUTTER)
      .justifyContent(FlexAlign.Center)
      .alignItems(VerticalAlign.Center)
      Text(g.title)
        // Apple 侧栏分区头节奏：次级字号 + 半档字重（中文无大小写 ⇒ 以字重补 web `uppercase`
        // 的层次）。⚠️ 2026-10-12：原 `type.micro`(10) 与行标题 15 的落差过大 ⇒ 真机读不动。
        .fontSize(typeOf('type.caption').size).fontWeight(typeOf('type.subhead').weight).fontColor(this.palOnce().textSecondary)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      // 计数 = **纯数字**（⛔ 不做胶囊底）：原实现的 `surfaceAlt` 药丸底 + 内边距把它读成一枚**按钮**，
      // 与组头的折叠箭头抢注意力（Apple 分组列表的计数就是一行次级文字）。字号提 caption ⇒ 仍可读。
      Text(`${g.items.length}`)
        .fontSize(typeOf('type.caption').size).fontColor(this.palOnce().textMuted)
    }
    .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
    // 组头左右内边距 = **行内边距**（`INSET_ROW_X`）：此前组头用 `SPACE_XXS`(4) 而行用
    // `INSET_ROW_X`(12) ⇒ 组头文字与行标题再多差 8vp（叠加箭头差 ⇒ 合计 36vp）。
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: gIdx > 0 ? SPACE_MD : 0 })
    // ⚠️ **居中 + 仅非首组留白**（2026-10-12 二次修，原为「44 盒底对齐」）：底对齐把 44 盒里 ~26vp
    //    的空气全堆在组头上方，而**首个组**上方没有"上一组" ⇒ 那 26vp 顶在筛选条下面，真机量测
    //    「筛选条底(y≈700) → 首组标题(y≈852)」= ~150px 空带（看起来像布局断了）。
    .alignItems(VerticalAlign.Center)
    // 吸顶底：与抽屉根**同材质**（实底 overlay，见上方注释）。
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.toggleGroup(this.sessionCategory(), g.key);
    })
  }

  @Builder
  DrawerSheet() {
    Column() {
      // ── 头部（44 命中区 = Apple 导航栏高度）────────────────────────────────
      // 层级：标题 = 本面板**唯一**「页标题级」（`type.title`，主航面档；见下）；「新建」= 次要动作文字
      // （`type.subhead` + accentSoft，⛔ 不用实心色块抢占层级）；关闭 = 44×44 热区。
      Row({ space: SPACE_XS }) {
        // ⚠️ 2026-10-14（目标③「抽屉对标 Apple」）：标题档由 `type.headline`(17) 升到
        //    **`type.title`**(21 semibold)。理由：抽屉是**主航面**（不是 sheet）—— Apple 的主航面
        //    用 large title，而 sheet 用 inline title；此前抽屉与 4 个 sheet 页头同为 17 ⇒ 主航面
        //    读起来"没有比自己打开的面板更高一级"。21 是本仓排版阶梯里**唯一**达 large 的页头档
        //    （`design.ets:864`），且仍 **bold/≥18.66px** ⇒ 对比度地板语义不变（走 `textPrimary`）。
        //    ⛔ 不是新造档：`Fallback.ets` 的页标题已用同一档。
        Text('会话')
          .fontSize(typeOf('type.title').size)
          .fontWeight(typeOf('type.title').weight)
          .fontColor(this.pal().textPrimary)
          .layoutWeight(1)
        // ── 「分组显示」= **视图选项**（全部折叠/全部展开）⇒ 归**顶栏**（Apple：视图/排序类选项在导航栏）
        //    2026-10-14（目标③）：原先它挤在**筛选条**里，与「分段维度」「渠道值」两个*筛选*控件并排
        //    ⇒ 三个等重胶囊让"筛选"与"视图"语义分不开、且把分段控件挤到只剩 65% 宽。移到顶栏后：
        //    顶栏 = 标题 + 视图选项 + 新建 + 关闭（标准 Apple 导航栏），筛选条 = **只装筛选**。
        //    ⛔ 形态与接线**逐字未变**（`collapse_all_wiring` 的形态契约照旧）：单枚 `ellipsis_circle`
        //    + `bindMenu`（ArkUI 自管开合）+ 真实 44 布局盒 + a11y 文案。
        if (this.collapseAllPlanNow().visible) {
          Row() {
            Row() {
              // ⛔ 弃用"两枚箭头叠成 ⇅"：HarmonyOS **没有** `chevrons_up_down` 单字形，叠出来的
              //    2×10vp 双箭头挤在 44 盒中央，真机观感像**渲染故障**。改用平台标准「更多动作」
              //    原语 `ellipsis_circle` + `bindMenu` ⇒ 语义自解释，⛔ 不必再"猜字形"。
              SymbolGlyph($r('sys.symbol.ellipsis_circle'))
                // ⚠️ 2026-10-14（目标③「侧边栏对标 Apple」· 控件类型自洽）：字形 `ICON_MD`(14)
                //    与**同一导航行**的 `新建`(`ICON_SM` 图标)/`✕`(`SHEET_ACTION_GLYPH`) 不同档，
                //    再叠一层灰底方块 ⇒ 这一行里出现"唯一一枚填充控件"，读起来像**误留的按钮**。
                //    Apple 导航栏的"更多动作"是**裸字形**（无底、无描边），与创建/关闭同权 ⇒ 走到 `ICON_XL`。
                .fontSize(ICON_XL).fontColor([colorOf(this.pal(), 'iconMuted')])
            }
            .justifyContent(FlexAlign.Center)
            .alignItems(VerticalAlign.Center)
          }
          // ⛔ 真机实测：`responseRegion` 负偏移外扩**无效** ⇒ 热区靠**真实 ≥44 布局盒**。
          .width(HIT_TARGET_MIN)
          .height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          // a11y：**图标-only、无可见文案** ⇒ 必须给读屏文案（对齐 web `SessionViewBar.tsx:39`
          // 的 `aria-label`/`title`；动作文案逐字对齐 web `i18n/zh-CN.ts:108-109`）。
          .accessibilityText('分组显示')
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          // ⛔ `bindMenu` 由 ArkUI 自管开合 ⇒ **不写 `onClick`**（写了会与锚点处理竞态）。
          .bindMenu(this.CollapseMenu, { placement: Placement.BottomRight, enableArrow: false })
        }
        // 「新建」= Apple 导航栏动作键形态：**图标 + accent 文字**（⛔ 不用实心色块抢占列表层级；
        // 调色板无 accent 底档 ⇒ 上色只能走前景）。图标 `plus`。
        // ⛔ 两个坑都**真机实测**过：① 全角「＋」——其字面宽度/基线与其他字形不同，观感是"+ 新建"
        //    被拉开成两块；② `square_and_pencil` —— 本仓把它当**重命名**用（`components/MenuSheets.ets:99`），
        //    且只给到 `ICON_SM`(12) 时方框细节糊掉 ⇒ 真机读成"☑ 新建"（勾选框），语义与观感双错。
        //    `plus` 在本仓既有使用（本文件 `:9100`）⇒ SDK21 上确实存在；给到 `ICON_LG`(16) 才有
        //    导航栏动作键的光学重量（Apple 的 `+` 与标题同视觉量级）。
        Row({ space: SPACE_HAIR }) {
          SymbolGlyph($r('sys.symbol.plus'))
            .fontSize(ICON_LG)
            .fontColor([this.pal().accentSoft])
          Text('新建')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.pal().accentSoft)
        }
        .height(HIT_TARGET_MIN)
        .padding({ left: SPACE_XS, right: SPACE_XS })
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          // 走「新建会话」弹层（可选用工作目录）；web `SessionSidebar.tsx:529` 同款。
          this.openNewSession();
        })
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(SHEET_ACTION_GLYPH)
            .fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('关闭')
        .onClick(() => {
          this.showDrawer = false;
          this.renamingId = '';
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ bottom: SPACE_SM })

      // ── 搜索：本地筛选（即时）+ 「搜索本会话消息」（服务端 /api/search）──────
      // 输入面 = 浮层内的行面（`surface.overlayRow`）；命中区 44。
      // 2026-10-12（对标 Apple 搜索框）：原裸 `TextInput` 无任何提示"这是搜索"⇒ 加**行内放大镜**
      // （`magnifyingglass`）+ **清空键**（`xmark_circle_fill`，仅非空时出现；Apple `UISearchBar`
      // 的 clear 同为条件出现）。容器改成 `Row` 承载图标 ⇒ `TextInput` 自身透明、去内边距。
      Row({ space: SPACE_XS }) {
        // 命中层 44（透明）→ 视觉层 36（Apple 搜索框高度）：与同排 chip 同高 ⇒ 整条搜索带读成一排。
        // ⚠️ 清空键仍是**真实 44×44 布局盒**（`hit_target_gate` 只认链上 `HIT_TARGET_MIN`）；它比
        //    视觉行高 8vp 但**居中溢出**（ArkUI 默认不裁剪、图标居中 ⇒ 观感零差、命中只多不少）。
        Row() {
          // 输入面（**内层容器**）：承载放大镜 + 透明 `TextInput`（+ 条件清空键）⇒ 图标真正"在框里"。
          Row({ space: SPACE_XS }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass'))
              .fontSize(ICON_MD).fontColor([colorOf(this.pal(), 'iconMuted')])
              .margin({ left: SPACE_SM })
            TextInput({ placeholder: '筛选会话…', text: this.sessQuery })
              .onChange((v: string) => {
                this.sessQuery = v;
              })
              .layoutWeight(1)
              .backgroundColor(Color.Transparent)
              .fontColor(this.palOnce().textPrimary)
              .fontSize(typeOf('type.subhead').size)
              .padding({ left: 0, right: 0 })
            // 清空键：仅非空时渲染（零噪音）；**真实 44×44 布局盒**（⛔ 不用 responseRegion 外扩）。
            if (this.sessQuery.length > 0) {
              Row() {
                SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
                  .fontSize(ICON_MD).fontColor([colorOf(this.pal(), 'iconMuted')])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
              .justifyContent(FlexAlign.Center)
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText('清空筛选')
              .onClick(() => {
                this.sessQuery = '';
              })
            }
          }
          .width('100%')
          .height(SEG_TRACK_H)
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))
          // 与右侧「搜本会话」chip **同一面语言**：填充 + 内凹发丝。此前只有 chip 有边框、搜索框裸填充
          // ⇒ 同排两种"面"读起来一个像输入框一个像按钮（`insetHairlineOf` 深色才有值、浅色透明）。
          .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
          .borderRadius(RADIUS_CARD)
          .alignItems(VerticalAlign.Center)
        }
        .layoutWeight(1)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        // 「搜索消息」（服务端 `/api/search`，**仅当前会话**）——与左边"本地即时筛选会话列表"是
        // **两件事** ⇒ 必须是**看起来像按钮**的独立控件：图标 + 明示动宾（`搜本会话`，避免被读成
        // "全局搜会话名"）+ **空查询时置灰**（Apple：无效果的动作不能看起来可点）+ a11y 写清作用域。
        // 命中层 44（透明）→ 视觉层 36 chip（与搜索框、分段轨道同高）。上色/转圈逻辑逐字不变。
        Row() {
          Row({ space: SPACE_XXS }) {
            if (this.searchBusy) {
              LoadingProgress().width(SPACE_MD).height(SPACE_MD).color(this.pal().accent)
            } else {
              // ⛔ 字形**必须区别于筛选框的 `magnifyingglass`**：同排两个放大镜会让用户以为
              // 这是第二个搜索框。`text_and_magnifyingglass`（"搜索正文"）语义精确、外形可辨。
              SymbolGlyph($r('sys.symbol.text_and_magnifyingglass'))
                .fontSize(ICON_SM)
                .fontColor([this.sessQuery.trim().length > 0
                  ? this.palOnce().accentSoft
                  : colorOf(this.palOnce(), 'iconMuted')])
              Text('搜本会话')
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.sessQuery.trim().length > 0 ? this.palOnce().accentSoft : this.palOnce().textSecondary)
            }
          }
          .height(SEG_TRACK_H)
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          // ── 视觉：**幽灵动作键**（2026-10-15，目标③「对标 Apple」第三批）──────────────────
          // 原实现是 chip 面（填充 + 内凹发丝）——与左边搜索框**同一种面**并排 ⇒ 两个等重量的
          // 填充控件抢焦点，整条搜索带读起来"两个输入框"（真机截图实锤）。Apple 工具栏范式是
          // **一个填充字段 + 一个裸字形文字动作**（`.searchable` 的 cancel 就是裸文字）。
          // ⛔ 与同排下面那条筛选工具条的渠道触发器**同一口径**（那里已按 web 权威落成幽灵按钮：
          //    `web/src/components/session/ChannelPicker.tsx:93-101` 原文「无边框、无底色…塞一个
          //    描边方块会喧宾夺主」）⇒ 本仓同一工具栏内**只有一种动作键语言**。
          // 激活/置灰仍靠前景色表达（`accentSoft` / `iconMuted` + `textSecondary`），承载"当前能否生效"。
          .backgroundColor(Color.Transparent)
        }
        .height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('在当前会话的消息中搜索（服务端）')
        .onClick(() => {
          if (!this.searchBusy) {
            this.runSearch();
          }
        })
      }
      .width('100%').padding({ bottom: SPACE_SM })

      // ── 筛选工具条（**单行**；2026-10-12 目标③ 第二批）─────────────────────────
      // ① 分段控件**只装互斥选项**：原实现把「全部折叠/展开」的动作键塞进轨道当第 4 段 ⇒
      //    **控制类型混用**（点它会以为切换了分组维度）⇒ 已移到轨道**之外**。
      // ② 渠道筛选对齐 web 的**下拉**语义：`ChannelPicker.tsx:90-119` 的触发器 = `label` + `ChevronDown`
      //    （内容 = 「全部」+ 各渠道项，`:120-142`）。此前把同一份数据画成**第二条 chips 行**与分段控件
      //    并列 ⇒ 两条并列筛选条（IA 重复、~250px 纵向 chrome）⇒ 收成**一个触发器**。
      //    ⛔ 绝不动 `channelForChat`（真机事故：否则点开非 web 会话报 `session not found`）。
      Row({ space: SPACE_XS }) {
        // ① 分类切换器（iOS 分段控件）：下沉轨道（`surface.chip`）+ 选中段浮起。
        //    清单**只从** `SESSION_CATEGORIES` 渲染（组件里不再列一遍分类）。
        //    ⚠️ 尺寸：**轨道 36 / 选中芯 32 / 命中外盒 44**（`SEG_TRACK_H`/`SEG_PILL_H` 见文件头）
        //    —— 视觉按 Apple、热区仍 `HIT_TARGET_MIN`（⛔ 不能靠 `responseRegion` 外扩：真机无效）。
        //    结构 = `Stack[ 轨道层 | 命中层 ]`：轨道是**画**出来的背景（垂直居中），命中层承载点击。
        Stack() {
          Row()
            .width('100%').height(SEG_TRACK_H)
            // 测试钩子（同 `xbot-empty-state`/`xbot-skeleton` 口径）：真机 `uitest dumpLayout` 能取到
            // 这一层的 bounds ⇒ **可观测量出**视觉高度（用户报的就是"视觉太高"，必须可量）。
            .id('xbot-seg-track')
            .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip'))
            // §15：chip 面补**内凹发丝**（深色才有值、浅色 transparent ⇒ 浅色逐字节不变）
            .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
            .borderRadius(RADIUS_CARD)
          Row({ space: SPACE_HAIR }) {
            ForEach(SESSION_CATEGORIES, (c: string) => {
              Row() {
                Row() {
                  Text(sessionCategoryLabel(c))
                    .fontSize(typeOf('type.caption').size)
                    .fontWeight(c === this.sessionCategory() ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(c === this.sessionCategory() ? this.pal().textPrimary : this.pal().textSecondary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .width('100%').height(SEG_PILL_H)
                .justifyContent(FlexAlign.Center)
                .alignItems(VerticalAlign.Center)
                // 选中芯 = **RUNG_ACTIVE**（`surface.pillSelected` = "选中的 pill" 专属语义面）。
                // ⚠️ 2026-10-13 真机取色实证（sips→BMP 采样 `dr1.jpeg`）：原用 `surface.card`（RUNG_CARD）
                //    ⇒ 深色下选中芯 `#0d0f14` 压轨道 `#0b0a0e`，**Δ≈0.8% ⇒ 选中态肉眼不可见**（只剩文字
                //    变白）——这是用户报「侧边栏丑」的硬根因之一。`surface.pillSelected` = `#1c1d27`
                //    ⇒ 明确浮在凹槽轨道上（与设计系统自身判据 `design.ets:1424` 的
                //    `['surface.pillSelected','surface.chip']` 同源，⛔ 不是新造对照）。
                .backgroundColor(c === this.sessionCategory()
                  ? surfaceFillOf(this.pal(), 'surface.pillSelected')
                  : Color.Transparent)
                .borderRadius(RADIUS_PILL)
                // 选中态缓动（Apple `UISegmentedControl` 的选中是**渐变**、不是硬切）：走底座
                // `animBase()`（⛔ 不新建曲线对象，受 `anim*()` ≤20 预算约束）。只动底色
                // => 不碰不透明度语义、失败方向安全（门禁⑨ 无关）。
                .animation(animBase())
              }
              .layoutWeight(1)
              .height(HIT_TARGET_MIN)
              .justifyContent(FlexAlign.Center)
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.setSessionCategory(c);
              })
            }, (c: string) => `cat-${c}`)
          }
          .width('100%').height(HIT_TARGET_MIN)
        }
        .layoutWeight(1)
        .height(HIT_TARGET_MIN)

        // ② 渠道筛选**下拉触发器**（web `ChannelPicker.tsx:90-119` 同构）。中性治装：选中「全部」
        //    = 凹槽面（`surface.pillSelected`）；选中具体渠道 = 中性 chip + 内凹发丝。**当前值显示在
        //    触发器上** ⇒ 删掉 chips 行后信息不减（用户一眼看得出"正在按渠道过滤"）。
        // 命中层 44（透明）→ 视觉层 36 chip：与分段轨道、同排「分组显示」chip **同高**。
        Row() {
          Row({ space: SPACE_HAIR }) {
            Text(activeChannelLabel(this.activeChannel))
              // ⚠️ 2026-10-12：此前 `type.micro`(10) 而**同一行的分段控件**用 `type.caption`(12)
              // ⇒ 两个并列筛选控件的标签竟不同档（真机量测：分段文字高 47px、chip 文字高 40px）。
              // 同排控件标签**必须同档**（Apple：工具栏上的并列控件共用一个字阶）⇒ 提 caption(12)。
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.activeChannel.length === 0 ? this.pal().textPrimary : this.pal().textSecondary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            SymbolGlyph($r('sys.symbol.chevron_down'))
              .fontSize(typeOf('type.caption').size)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
          }
          .height(SEG_TRACK_H)
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          // ── 控件类型自洽（2026-10-14，目标③「侧边栏对标 Apple」）────────────────────────
          // **权威 = web**（本仓铁律：不许发明）：`web/src/components/session/ChannelPicker.tsx:93-101`
          // 的触发器是**幽灵按钮** —— 注释原文「幽灵按钮：与面板标题行/工具条的极简风格一致
          // （无边框、无底色，hover 才浮起）」，并记录了用户原话：「**之前做成带 border+bg 的方形
          // 按钮**，用户 2026-09-15：「你觉得这好看？」—— 标题行里只有图标+文字，塞一个描边方块会喧宾夺主」。
          // ⛔ 本仓此前把它做成 `surface.pillSelected` 填充（+内凹发丝）—— **正是 web 已否决的形态**，
          //    且 `pillSelected` 是**左侧分段轨道**同族凹槽面 ⇒ 真机观感"分段控件有**第 4 段**"。
          // ⇒ 回到 web 口径：**无底、无边框**（只保留 44 命中层与「当前值」文字；激活时用
          //    `accentSoft` 文字表达"正在按渠道过滤"，⛔ 不新造第三种面）。
          .backgroundColor(Color.Transparent)
        }
        .height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        // ③ 渠道筛选**下拉**（平台菜单原语 `bindMenu`）：ArkUI **自管开合**（点锚点开/关、点外部收起）
        //    ⇒ 页面**不自持**开合态、⛔ 不写 `onClick`（否则与 ArkUI 的锚点处理打架）。
        //    ⚠️ 真机实测：`bindPopup` + 自持 `@State` + `onClick` toggle 与 ArkUI 的 dismiss 回调
        //    会竞态 —— "从关到开"约 25% 漏点，不可交付；`mask: true` 又会吃掉锚点点击（4/4 打不开）。
        .bindMenu(this.ChannelPickerMenu, {
          placement: Placement.BottomRight,
          enableArrow: false,
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ bottom: SPACE_SM })

      // ── 结构性发丝：工具条（标题 + 搜索 + 筛选）与内容区的分界 ──────────────────────
      // 2026-10-14（目标③「抽屉对标 Apple」）：Apple 的侧栏/列表在工具栏与内容之间有一条发丝
      // （`UINavigationBar` 底边 / macOS 侧栏顶部 divider）⇒ chrome 读成一个**工具条**、内容自成一区。
      // 此前两者同底同色、边界只靠留白 ⇒ 观感是"一堆控件浮在灰面上"。⛔ 只加一条**结构性**发丝
      // （`hairlineOf`；⛔ 不引入卡片/色块/第二层底色）。
      Divider()
        .strokeWidth(STROKE_HAIRLINE)
        .color(hairlineOf(this.pal()))
        .margin({ bottom: SPACE_SM })

      // ── 列表 / 空态 ────────────────────────────────────────────────────────
      // 空态判据走 `core/indicators.ets`（与骨架/占位同族，⛔ 页面不写第二套 `if`）。
      if (this.drawerEmpty() !== DRAWER_EMPTY_NONE) {
        Column({ space: SPACE_SM }) {
          SymbolGlyph($r('sys.symbol.square_grid_2x2'))
            .fontSize(typeOf('type.display').size)
            .fontColor([colorOf(this.pal(), 'iconMuted')])
          Text(drawerEmptyHint(this.drawerEmpty()))
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.pal().textPrimary)
            // ⛔ H3：提示文案可能含不可断长串（路径/命令）⇒ 词内断行（⛔ 必须**限定名** WordBreak.BREAK_ALL）
            .wordBreak(WordBreak.BREAK_ALL)
          if (this.drawerEmpty() === DRAWER_EMPTY_NO_SESSIONS) {
            Text('新建一个会话，开始对话')
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.pal().textSecondary)
              .textAlign(TextAlign.Center)
            Row() {
              Text('＋ 新建会话')
                .fontSize(typeOf('type.subhead').size)
                .fontColor(this.pal().onAccent)
            }
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: SPACE_MD, right: SPACE_MD })
            .justifyContent(FlexAlign.Center)
            .alignItems(VerticalAlign.Center)
            .backgroundColor(this.pal().accent)
            .borderRadius(RADIUS_PILL)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.openNewSession();
            })
          } else {
            Row() {
              Text('清除筛选')
                .fontSize(typeOf('type.subhead').size)
                .fontColor(this.pal().accentSoft)
            }
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: SPACE_MD, right: SPACE_MD })
            .justifyContent(FlexAlign.Center)
            .alignItems(VerticalAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.clearSessFilters();
            })
          }
        }
        .width('100%').layoutWeight(1)
        .padding({ left: SPACE_MD, right: SPACE_MD })
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      } else {
        List() {
          ForEach(this.drawerGroups(), (g: DrawerGroup, gIdx: number) => {
            // 组头 = `ListItemGroup` 的 `header`（⛔ 不再是普通 `ListItem`）：只有 `header` 能配
            // `.sticky(StickyStyle.Header)` ⇒ 组头**吸顶**（Apple 列表语义：滚动长会话列表时
            // 「今天 / 昨天」始终可见；web 侧栏不吸顶 ⇒ 这是原生**超越**项）。构件见 `DrawerGroupHeader`。
            ListItemGroup({ header: this.DrawerGroupHeader(g, gIdx) }) {
              // ⚠️ 组头**移出**本 builder 体（改为 `header`），故这里只剩行；缩进沿用原层级（ArkTS 不看缩进）。
            // 仅当"末段目录名重名"时补一行完整路径（web 靠 hover tooltip，原生端没有 hover）
            if (g.tip.length > 0) {
              ListItem() {
                Text(g.tip)
                  .fontSize(typeOf('type.micro').size).fontColor(this.pal().textMuted)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%').padding({ left: SPACE_LG, bottom: SPACE_HAIR })
              }
            }
            if (!this.isGroupCollapsed(this.sessionCategory(), g.key)) {
              ForEach(g.items, (s: SessionItem, sIdx: number) => {
                ListItem() {
                  Column() {
                    // 行体：**扁平行**（无卡片/无描边/无阴影）—— 结构靠发丝线，选中靠一档填充。
                    // 层级：标题 = `type.body`（最重）；渠道 chip / id = `type.micro`（次级）。
                    Column({ space: GAP_BLOCK }) {
                      if (this.renamingId === s.chat_id) {
                        Row({ space: SPACE_XS }) {
                          TextInput({ text: this.renameText })
                            .onChange((v: string) => {
                              this.renameText = v;
                            })
                            .layoutWeight(1).constraintSize({ minHeight: 36 })
                            .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlayRow'))
                            .fontColor(this.palOnce().textPrimary)
                            .fontSize(typeOf('type.body').size)
                            .borderRadius(RADIUS_PILL)
                          Text('保存').fontSize(typeOf('type.subhead').size).fontColor(this.palOnce().accentSoft).padding(SPACE_XS).onClick(() => {
                            const store: ChatStore | null = this.store;
                            if (store !== null && s.chat_id !== undefined) {
                              store.renameSession(s.chat_id, this.renameText);
                            }
                            this.renamingId = '';
                          })
                          Text('取消')
                            .fontSize(typeOf('type.subhead').size)
                            // ⛔ 不做无条件 `textSecondary`：本行底 = **当前会话**时 `surface.overlayRowHover`
                            // （= `RUNG_ACTIVE` = `surfaceHi`，语义别名掩盖的落点）——porcelain 下
                            // `textSecondary` 压它仅 **4.337 < AA 4.5**（文字 role，13）。
                            // 修法 = **只改当前会话这一支**的 fg 到 `textPrimary`（各主题 ≥12：
                            // 另见 `tools/tests/surface_alias.test.ts`）；⛔ 不改行底 —— 当前会话的
                            // 填充强调必须保留（porcelain 的 RUNG_RAISED 仅 1.009 vs 画布 ≈ 不可见）。
                            .fontColor(this.isCurrentSession(s.chat_id) ? this.pal().textPrimary : this.pal().textSecondary)
                            .padding(SPACE_XS)
                            .onClick(() => {
                              this.renamingId = '';
                            })
                        }.width('100%')
                      } else {
                        // ── 单行行体（web `SessionItem.tsx:1-8` 权威：`[状态点] 标题 相对时间`）──
                        // 移除三处"开发者噪音"：渠道 chip、裸 `chat_id`、两行排版。⛔ 它们对用户无信息量，
                        // 却各占视线（原实现第二行恒显示 `Web` + `chat_026B326DE4C4`）。
                        // 超越 web：行内动作收进**尾部拇指区**（星标 + ⋯），各自真实 44×44 布局盒。
                        Row({ space: SPACE_XS }) {
                          // 前导**标记槽**（`MARKER_GUTTER`）：恒定占位、内容可空。
                          // 为什么：标记此前是**条件渲染** ⇒ 「有状态的会话」标题被顶右、「无状态的」贴左，
                          // 真机同屏量到标题左缘 **80px vs 134px（差 16vp）** ⇒ 整列参差（Apple 列表的
                          // 行文字恒在同一条竖轴上）。槽内**居中** ⇒ 点/星/空三种情形的标题左缘完全一致。
                          Row({ space: SPACE_HAIR }) {
                            // 状态点（**唯一判据** = `core/sessiongroup.sessionStatusRole`，与 web
                            // `SessionItem.tsx:57-64` 的 `STATUS_COLOR` + `:92-94` 的 `executing` 同源）：
                            // 跑着=蓝 / 等回答=琥珀 / 失败=红；idle·未知 ⇒ 空串 ⇒ 不画（原生克制）。
                            // ⚠️ 2026-10-13 修：原只在 `running===true` 画绿点 ⇒ `waiting_input`（该你说话了）
                            // 与 `error` 完全不可见。
                            if (this.sessDotRole(s).length > 0) {
                              // 运行中 = **静态** 状态点 + 光晕（⛔ 不呼吸：唯一在飞动效 = 光球）。
                              Row()
                                .width(SPACE_XS).height(SPACE_XS).borderRadius(SPACE_XS / 2)
                                .backgroundColor(this.sessDotColor(s))
                                .shadow({ radius: DOT_GLOW_R, color: this.sessDotColor(s), offsetX: 0, offsetY: 0 })
                            }
                            // 标星 = **非交互小标记**（Apple 旗标式；⛔ 不占 44 热区 —— 真机量测：星标盒吃
                            // 149px（15% 行宽），把当前会话标题截成 `harmony-ui…`）。仅**已标星**才渲染
                            // （未标星不显示空星 ⇒ 零噪音）；交互入口统一在 `⋯` 菜单的「标星/取消标星」
                            // （对齐 web `SessionItem.tsx` 把 star 放进 context menu 的口径）。
                            // ⚠️ 三元保留 `isStarredChat` 真判据（`star_contrast.test.ts` §1 钉"恰好 1 处"）。
                            if (this.isStarredChat(s.chat_id)) {
                              SymbolGlyph(this.isStarredChat(s.chat_id)
                                ? $r('sys.symbol.star_fill') : $r('sys.symbol.star'))
                                .fontSize(typeOf('type.subhead').size)
                                .fontColor([this.isStarredChat(s.chat_id) ? this.pal().accent : this.pal().textSecondary])
                            }
                          }
                          .width(MARKER_GUTTER)
                          .justifyContent(FlexAlign.Center)
                          .alignItems(VerticalAlign.Center)
                          // ── 标题 + 时间：**两行**（Apple「文件」列表形态）────────────────────
                          // ⚠️ 2026-10-12（真机量测，`dumpLayout` 实得）：单行时行宽 999px 被
                          //    `[点槽 81][标题 509][时间 179][⋯ 149]` 切走 —— 标题只拿 **51%**
                          //    ⇒ `手机NPU部署30B-MoE`（需 ~712px）被截成 `手机NPU部署30B-…`。
                          //    把时间降到**第二行**：标题拿 999-81-149-8 ≈ **761px**（+50%）⇒ 15 字标题不再截断；
                          //    两行合计 59+47 = 106px < 行高 149px(44vp) ⇒ **密度零损失**、行高仍 = Apple 单行高度。
                          //    次级信息降行 = 原生列表惯例（Apple Files/Notes 同款），⛔ 不是"复刻 web"（web 是单行）。
                          Column({ space: SPACE_HAIR }) {
                            Text(this.tabLabel(s.chat_id))
                              .fontSize(typeOf('type.body').size)
                              // 选中态 = 填充 + **中黑**（Apple 列表选中项的字重提升；深色下仅靠
                              // `surface.overlayRowHover` 填充区分度不足）。⛔ 不改字号/字形 ⇒ 行高不变。
                              .fontWeight(this.isCurrentSession(s.chat_id) ? FontWeight.Medium : FontWeight.Regular)
                              .fontColor(this.isCurrentSession(s.chat_id) ? this.palOnce().accentText : this.palOnce().textPrimary)
                              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                              .width('100%').textAlign(TextAlign.Start)
                            // 相对时间（web `SessionItem.tsx:332-347`；`last_active` 缺失 ⇒ 空串 ⇒ 不渲任何字符）。
                            // ⚠️ 空串时**整行不渲染**（两行布局下渲染空串会白留一行高 ⇒ 行高参差）。
                            if (this.relTimeOf(s.last_active).length > 0) {
                              Text(this.relTimeOf(s.last_active))
                                // ⚠️ 2026-10-12：`type.micro`(10) 读不动 ⇒ caption(12)（iOS 列表元信息档）。
                                .fontSize(typeOf('type.caption').size).fontColor(this.palOnce().textMuted)
                                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                                .width('100%').textAlign(TextAlign.Start)
                            }
                          }
                          .layoutWeight(1).alignItems(HorizontalAlign.Start)
                          // 行内次级动作折成一个 `⋯` + 菜单（标星入口已在菜单里 ⇒ 行体只剩一个动作键）。
                          // ⛔ 前景是 **`Text`**（文字字形，⛔ 不是 `SymbolGlyph`）⇒ 地板 = AA_TEXT(4.5)，
                          // 而 porcelain 下 `textSecondary` 压本行**当前会话**底（`surface.overlayRowHover`
                          // = `surfaceHi`）仅 **4.337 < 4.5** ⇒ 当前会话支改 `textPrimary`（各主题 ≥12）；
                          // 非当前会话底 = `transparent`（画布）⇒ 仍用 `textSecondary`（porcelain 5.07 ✓）。
                          Text('⋯')
                            .fontSize(typeOf('type.headline').size)
                            .fontColor(this.isCurrentSession(s.chat_id) ? this.palOnce().textPrimary : this.palOnce().textSecondary)
                            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).textAlign(TextAlign.Center)
                            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                            .accessibilityText('更多操作')
                            .onClick(() => {
                              this.anim(() => {
                                this.sessMenuId = s.chat_id;
                              });
                              this.sessConfirmDelete = '';
                            })
                        }
                        .width('100%').alignItems(VerticalAlign.Center)
                      }
                    }
                    .width('100%')
                    // 行高预算（2026-10-12 **二次**收紧）：行体内容 = 尾部 `⋯` 的 **44vp 真实热区盒**
                    // （⛔ 不可小于 `HIT_TARGET_MIN`，`responseRegion` 外扩真机无效）⇒ **行高恒 == 44vp ==
                    // Apple 单行列表高度**。前批把 `INSET_ROW_Y`(8) 收到 `SPACE_XXS`(4) ⇒ 52vp（仍比
                    // Apple 44pt 高 ~18%）；本轮直接**去掉竖向内边距** —— 44 盒即行高：真机量测
                    // **178px → 149px**（density 3.386），同屏多约 18% 行数
                    // （用户 2026-10-12 亲报「只有那么一点点区域真的用于会话，用户要频繁的滚动」）。
                    .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
                    .backgroundColor(this.isCurrentSession(s.chat_id)
                      ? surfaceFillOf(this.pal(), 'surface.overlayRowHover')
                      : Color.Transparent)
                    .borderRadius(RADIUS_PILL)
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      if (s.chat_id !== undefined && this.renamingId.length === 0) {
                        this.switchSession(s.chat_id);
                      }
                    })
                    // 结构性发丝（⛔ 不是装饰描边）：行与行之间的唯一分隔。
                    // 左缘**内缩到文字起点**（Apple 的 inset separator：线只从正文起画，前导标记槽那片
                    // 留白不画线）⇒ 视觉上"线跟着文字走"，与标题左缘形成同一条竖轴。
                    // ⚠️ 2026-10-13（目标③「对标苹果」）：**每组的最后一行不留线** —— Apple 分组列表
                    //    （`UITableView.insetGrouped` / iOS「设置」）组尾**不画**分隔线；原位画一条会在
                    //    组尾形成"悬空线"，紧贴下一个组头 ⇒ 组与组之间读出两条平行线、分组层次反而糊。
                    if (sIdx < g.items.length - 1) {
                      Divider()
                        .strokeWidth(STROKE_HAIRLINE)
                        .color(hairlineOf(this.palOnce()))
                        .margin({ left: INSET_ROW_X + MARKER_GUTTER + SPACE_XS, right: INSET_ROW_X })
                    }
                  }
                  .width('100%')
                }
              }, (s: SessionItem) => `${s.chat_id}#${s.label}#${s.running}#${s.status}`)
            }
            // ↑ 关闭 `if (!isGroupCollapsed…)`；↓ 关闭本组 `ListItemGroup`
            }
          // ⚠️ 键里**必须**带上折叠态：`ListItemGroup.header` 的参数是"调用那一刻的快照"（本仓
          //    `@Builder` 快照陷阱）⇒ 折叠态不进键（或不经 `@State` 读取）时，chevron 旋转会**卡在初值**。
          }, (g: DrawerGroup) => `${this.sessionCategory()}#${g.key}#${this.isGroupCollapsed(this.sessionCategory(), g.key)}`)
        }
        .layoutWeight(1).width('100%')
        .scrollBar(BarState.Off)
        // 组头吸顶：⛔ 只有 `ListItemGroup.header` 才吸，普通 `ListItem` 写了**静默无效**。
        .sticky(StickyStyle.Header)
      }

      // ── 底部动作：**紧凑工具栏**（单行 4 键；图标 + micro 标签）──────────────────
      // ⛔ 2026-10-12 用户亲报（原话）：「只有那么一点点区域真的用于会话，用户要频繁的滚动…
      //    按钮占据一大半？你要么侧边栏彻底给按钮重设计会话的交互，要么按钮改别的布局」。
      //    原实现 = 4 个**整行**条目（每行 ≥44vp + 3 条发丝线 + 16vp 空带 ≈ 195vp ≈ 22% 屏高）
      //    ⇒ 会话列表只剩 ~25% 屏高（真机截图量：列表仅 ~720px / 2848px）。
      //    改**单行 4 键**：热区仍 ≥44vp、`accessibilityText` 逐字保留（含全量枚举）⇒
      //    释放 ~140vp ≈ 18% 屏高给列表。破坏性动作仍**独立在最右**（Apple：不可逆动作与
      //    导航项拉开），但不再单独占一整行。
      // ⚡ 取色**收敛**（性能预算 B 线 `this.pal()∨palOnce()` **只许减不许增**）：§21.122c 加
      //    「终端」键时若每键各读两次会顶穿 1353 ⇒ 整条底栏统一走记忆化助手 `barTint(role)`
      //    （实现见 `barTint` 注释：`@Builder` 体内不许声明局部量，只能在方法里收敛）。
      Divider().strokeWidth(STROKE_HAIRLINE).color(this.barTint('rule')).margin({ top: SPACE_SM })
      Row() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.gearshape'))
            .fontSize(ICON_XL).fontColor([this.barTint('muted')])
          Text('设置')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('text'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('设置')
        .onClick(() => {
          this.openSettingsPanel();
        })
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.list_bullet'))
            .fontSize(ICON_XL).fontColor([this.barTint('muted')])
          Text('任务')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('text'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        // §21.122bu（用户定向 2026-10-16「一个页面必须只有一个形态」）：**统一到原生运行面板**。
        // ⛔ 不再开 `?xbot_panel=tasks`（web 任务面板）—— 同一能力面曾按入口不同渲染成两种形态。
        // 形态判定收敛在 `surfaceOf(SURF_TASKS)`（唯一真源），动作走唯一出口 `openSurface`。
        .accessibilityText('任务：原生运行面板（cron + 后台任务 + 子代理 + Runner + 终端）')
        .onClick(() => {
          this.openSurface(SURF_TASKS);
        })
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.puzzle'))
            .fontSize(ICON_XL).fontColor([this.barTint('muted')])
          Text('插件')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('text'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('插件与 Web UI：插件目录、宿主页、完整 Web UI')
        .onClick(() => {
          this.openPlugins();
        })
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.folder'))
            .fontSize(ICON_XL).fontColor([this.barTint('muted')])
          Text('文件')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('text'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('文件管理：原生文件面板（浏览/搜索/预览/加入聊天）')
        .onClick(() => {
          // §21.122bg：与顶栏「文件」同一出口（用户定向「文件不需要用 web」）⇒ **原生优先**。
          // 收掉可能开着的 web 面板，否则两层面板叠着、退回时用户看到旧 web 页。
          this.panelUrl = '';
          this.showFiles = false;
          this.openFiles();
        })
        // ── §21.122c：**终端**（web 内置面板 `core.terminal` 走 WebView）────────────────────
        // 用户原话「终端和任务管理做的很差」——本仓此前**根本没有**终端入口（4 键里没有），
        // 而 web 的终端面板（TerminalList + useTerminal）是完整能力。按用户定向：**渲染 web
        // 自己的面板**（与 web 逐字同源、能力自动跟随 web 演进），⛔ 不再写一套原生终端。
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.code'))
            .fontSize(ICON_XL).fontColor([this.barTint('muted')])
          Text('终端')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('text'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('终端：原生终端（新建/切换会话终端；与运行面板终端页同一实现）')
        .onClick(() => {
          // §21.122bu：**统一到原生终端**（用户定向「一个页面必须只有一个形态」）。
          // 形态判定 = `surfaceOf(SURF_TERMINAL)`（唯一真源）；入口动作走唯一出口 `openSurface`。
          this.openSurface(SURF_TERMINAL);
        })
        // ── 竖向发丝：把**销毁性**动作（退出登录）与导航项拉开 ──────────────────────
        // 2026-10-14（目标③「抽屉对标 Apple」）：Apple 不在主导航里放"等重的销毁项"——它要么收进
        // 设置，要么与导航项**显式隔开**。本仓的「退出登录」功能已有更安全的入口
        // （设置 → 账号：**两步确认** + 同一 `logout()` 路径）⇒ 底栏这枚保留为快捷方式，
        // 但用一条竖向发丝把它与四个导航键分开 ⇒ 读成「4 导航 + 1 危险」，而不再是一排五个等权按钮。
        Column()
          .width(STROKE_HAIRLINE)
          .height(SPACE_LG)
          .backgroundColor(this.barTint('rule'))
          .margin({ left: SPACE_XS, right: SPACE_XS })
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.power'))
            .fontSize(ICON_XL).fontColor([this.barTint('danger')])
          Text('退出')
            .fontSize(typeOf('type.micro').size).fontColor(this.barTint('danger'))
        }
        .layoutWeight(1).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('退出登录')
        .onClick(() => {
          this.doLogout();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    // ⚠️ 88%（原 82%）：真机量测行内容仅 919px ⇒ 标题在"已标星 + 有相对时间 + ⋯"时被截断
    //    （`harmony-ui-dev` → `harmony-ui…`）。侧栏是**主动航面**，Apple 在 iPhone 上也逼近全宽。
    .width('88%').height('100%')
    // ── 键盘让位（⛔ 见 `kbHeightPx` 注释）：焦点在**抽屉自己的搜索框/行内重命名框**时 `RESIZE` 不生效
    //    ⇒ 抽屉内容留在窗口底、被软键盘盖死（真机 dump：节点被 IME 窗口整批裁掉）。
    //    让位**落根容器**（而非底栏那一排）：整片内容区上缩 ⇒ 底部 5 键顶到键盘上方，
    //    **且**列表一起缩短 ⇒ 行内重命名输入框能被滚进可见区（只抬底栏做不到后者）。
    //    键盘收起 = 0 ⇒ 与原先逐字节一致。
    .padding({ top: SP_3, left: SP_3, right: SP_3, bottom: SP_3 + px2vp(this.kbHeightPx) })
    // ⚠️ 2026-10-12（用户「侧边栏丑的要死 · 你要考虑**所有的面板**」）：抽屉原先**只有它是玻璃**
    //    （`eff().glassBg` alpha 0.84 + `BlurStyle.Regular`），其余 **7 个浮层全是实底**
    //    `surfaceFillOf(pal,'surface.overlay')`（Plugins/Queue/SessionStats/TaskDetail/Terminal/
    //    Status/Files）。真机截图实锤：抽屉背后是**高密度正文**（代码 + 思考），0.84 的玻璃把它透上来
    //    ⇒ 满屏模糊灰斑 =「脏」，列表可读性反而下降（大面积 ≠ 小芯片，玻璃在小面上是质感、在大面上是噪点）。
    //    ⇒ 与所有面板统一**面语言**：实底 overlay 面（去 blur，保留右缘发丝线 + 投影 + 滑入过渡）。
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderWidth({ right: STROKE_HAIRLINE }).borderColor(hairlineOf(this.pal()))
    .shadow({ radius: shadowRadiusOf(this.pal(), 'drawer'), color: this.eff().elev3, offsetX: SPACE_XS, offsetY: 0 })
    .position({ x: 0, y: 0 })
    // 抽屉出入场：**横向滑入 + 淡入**（底座唯一出口 `drawerTransition()`；⛔ 不自造时长/位移）。
    .transition(drawerTransition())
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
    // ── 根面统一（L1 顶层弹层）：`surfaceFillOf(p,'surface.overlay')` + 结构性发丝 `hairlineOf`
    //    + **两层柔影**（同 `StatusSheet`/`QueueSheet`/`SelfCheckSheet`/`AskUserSheet` 同通道；
    //    此前是**裸 `pal().appBg` + 裸 `border`**，与同层级弹层割裂 ⇒ 本轮补齐。
    Stack() {
    Column({ space: 10 }) {
      Row() {
        Text('模型与上下文').fontSize(typeOf('type.headline').size).fontWeight(typeOf('type.headline').weight).fontColor(this.pal().textPrimary).layoutWeight(1)
        // ⛔ 用户 2026-10-11 报「关闭**不好点到**」。**真机装机实测（08:35）结论**：
        //    ① 点 X **视觉中心** ⇒ 关闭 ✓；② 点它**框外 11px（上方）/ 15px（左侧，仍在父 Row 内）**
        //       ⇒ **不关闭** ✗ ⇒ **`responseRegion` 的负偏移外扩在真机（SDK21）上不生效**
        //       （此前那版就是靠它外扩到 44 —— 等于没修）。
        //    ⇒ 改用**真实 44×44 布局盒**（`HIT_TARGET_MIN`）承载 `onClick`：热区 = 布局盒本身，
        //      不依赖 `responseRegion` 的越界扩展；图标**视觉尺寸不变**（仍 17，盒内居中）。
        Row() {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH).fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
        .accessibilityText('关闭')
        .onClick(() => {
          this.showModel = false;
        })
      }.width('100%')

      Text(`当前：${this.currentModelName()}`)
        .fontSize(typeOf('type.caption').size).fontColor(this.pal().successText).width('100%')
        .wordBreak(WordBreak.BREAK_ALL)

      // 上下文上限
      Text(`上下文上限：${this.ctxText().length > 0 ? this.ctxText() : '未设置'}`)
        .fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary).width('100%')
      Row({ space: 6 }) {
        ForEach(this.ctxPresets(), (p: number, i: number) => {
          // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先仅靠 `padding(…5)` 撑到 ≈22 ⇒ 低于阈值。
          //    改**真实 ≥44 布局盒**承载 `onClick`（同本面板「思考模式」chip 与全仓浮层口径）。
          Row() {
            Text(this.ctxPresetText(p))
              .fontSize(typeOf('type.caption').size).fontColor(this.pal().accentSoft)
              .padding({ left: SPACE_XS, right: SPACE_XS })
          }
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip')).borderRadius(RADIUS_CHIP)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
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
          .layoutWeight(1).constraintSize({ minHeight: HIT_TARGET_MIN })
          .backgroundColor(this.pal().surfaceAlt).fontColor(this.pal().textPrimary).fontSize(typeOf('type.caption').size)
        // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44)：原仅靠 `padding(…SPACE_XS)` 撑到 ≈28 ⇒ 低于阈值。
        Row() {
          Text('应用').fontSize(typeOf('type.caption').size).fontColor(this.pal().onAccent)
        }
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SPACE_SM, right: SPACE_SM })
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .backgroundColor(this.pal().accent).borderRadius(RADIUS_CHIP)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
            const n: number = parseContext(this.ctxInput);
            if (n <= 0) {
              this.toast('上下文上限格式不对（示例：200k / 1m / 200000）');
              return;
            }
            this.applyMaxContext(n);
          })
      }.width('100%')

      // 模型列表（按订阅分组）—— **三态**：加载中 / 加载失败(+重试) / 已加载但空。
      // 判据与渲染同源：`core/llmfmt.ets:modelPanelStatus`（只消费它，⛔ 不在页面另算一套）。
      // ⛔ 旧实现只判 `llmCfg === undefined` ⇒ **恒**转圈（后端不可用/超时/报错时**永久转圈**，
      //    用户读不出"是慢还是坏了"）。失败态来自既有取数路径的真结果（`reloadModelList`→`store.loadLlmConfig`）。
      if (this.modelPanelStatusNow().state === MODEL_PANEL_ERROR) {
        Column({ space: SPACE_XS }) {
          Text(this.modelPanelStatusNow().text)
            .fontSize(typeOf('type.caption').size).fontColor(colorOf(this.pal(), 'dangerText'))
            .width('100%')
            // 失败详情可能含 URL / 不可断串 ⇒ 必须允许任意字符处断行（同 `PluginsSheet` 状态行）。
            .wordBreak(WordBreak.BREAK_ALL)
          // 错误态标准样式 = 一行语义色小字 + 「重试」（同 `SettingsErrorBar` / `PluginsSheet`）。
          // 重试走**既有取数入口**（`reloadModelList` → `store.loadLlmConfig`）；真实 ≥44 布局盒。
          Row() {
            Text('重试').fontSize(typeOf('type.caption').size).fontColor(colorOf(this.pal(), 'accentSoft'))
          }
          .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.reloadModelList();
          })
        }.width('100%').padding(10)
      } else if (this.modelPanelStatusNow().state === MODEL_PANEL_LOADING) {
        Row({ space: 8 }) {
          LoadingProgress().width(16).height(16).color(this.pal().accent)
          Text(this.modelPanelStatusNow().text)
            .fontSize(typeOf('type.caption').size).fontColor(colorOf(this.pal(), this.modelPanelStatusNow().colorRole))
            // 横向约束（H1：Row 内动态文本无布局约束会顶出屏宽）+ 任意处断行（H3）。
            .layoutWeight(1)
            .wordBreak(WordBreak.BREAK_ALL)
        }.padding(10)
      } else if (this.modelPanelStatusNow().state === MODEL_PANEL_EMPTY) {
        Text(this.modelPanelStatusNow().text)
          .fontSize(typeOf('type.caption').size).fontColor(colorOf(this.pal(), this.modelPanelStatusNow().colorRole))
          .width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      } else {
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.modelGroups(), (g: ModelGroup) => {
              Column({ space: 4 }) {
                Text(g.name).fontSize(typeOf('type.caption').size).fontColor(this.pal().textMuted).width('100%')
                ForEach(g.entries, (e: LlmModelEntry, i: number) => {
                  Row({ space: 8 }) {
                    Text(this.labelOfModel(e)).fontSize(typeOf('type.subhead').size)
                      .fontColor(this.modelSelectable(e) ? this.pal().textPrimary : this.pal().textMuted)
                      .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    if (this.modelBusy === `${g.subId}#${e.model}`) {
                      LoadingProgress().width(14).height(14).color(this.pal().accent)
                    } else if (e.model === this.currentModelName()) {
                      Text('当前').fontSize(typeOf('type.caption').size).fontColor(this.pal().successText)
                    }
                  }
                  // ⛔ 命中区 ≥44（原 `padding(SPACE_XS)` 仅撑到 ≈29）⇒ 行真实 ≥44 布局盒（Apple 列表行口径）。
                  .width('100%')
                  .constraintSize({ minHeight: HIT_TARGET_MIN })
                  .padding({ left: SPACE_XS, right: SPACE_XS })
                  .alignItems(VerticalAlign.Center)
                  .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip')).borderRadius(RADIUS_CHIP)
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    if (!this.modelSelectable(e)) {
                      this.toast('该模型已禁用');
                      return;
                    }
                    this.pickModel(g.subId, g.name, e.model !== undefined ? e.model : '');
                  })
                }, (e: LlmModelEntry, i: number) => `${g.subId}#${e.model}`)
              }.width('100%')
            }, (g: ModelGroup) => `grp-${g.subId}`)
          }.width('100%')
        }
        // ⛔ 用户 2026-10-11 报「**滚动栏挡住交互**」：默认 `BarState.Auto` 的滚动条**叠在列表右缘**
        //    并参与命中测试 ⇒ 点行右侧（如「当前」角标那一带）会打到滚动条而非行。
        //    这里是**面板内的短列表**（≤420 高、外层已有空白区可点关闭）⇒ 关掉滚动条
        //    （与本仓既有口径一致：`DrawerSheet`/`SettingsPanel:359`/`AskUserSheet`/`PluginHost` 同为 `Off`）。
        .constraintSize({ maxHeight: 420 }).width('100%')
        .scrollBar(BarState.Off)
      }

      // ── 思考模式（web `ModelSelector.tsx:154-164` 的 popover 底部 `ThinkingModeControl`）──────
      // 落点：web 把它挂在「模型选择器」popover 内 ⇒ 原生等价物即本 `ModelSheet`（最小改动）。
      // 形态（2026-10-13，15z12，目标③「对标苹果」）：由 **实心 accent 芯片 ×4** 改
      //   **iOS 分段控件**（`UISegmentedControl`）—— 与抽屉「分类」分段控件**同一形态/同一尺寸**
      //   （`SEG_TRACK_H`/`SEG_PILL_H` 见文件头）。病根与同批改造的运行面板页签**同一个**：
      //   实心色块读起来是"按钮墙"；而"选一个值"的语义 Apple 一律用**分段控件**，不是 4 个实心块。
      //   ⛔ 不新增视觉语言：下沉轨道（`surface.chip` + 内凹发丝）+ 选中段**浮起**（`surface.card`）+
      //   文字加重 —— 这三点全部照抄抽屉那一处（单一真源在**令牌层**，⛔ 不另发明一套配色）。
      // **步骤语义/文案**逐字对齐 web composer
      //   （`core/settings.ets` 的 `thinkingStepLabel` = `关/思考/思考+/思考++`）。
      // ⛔ 行**真实 ≥44 布局盒**（`HIT_TARGET_MIN`，不靠 `responseRegion`）；写库走 `set_user_thinking_mode` 裸值。
      Column({ space: SPACE_XS }) {
        Row() {
          Text('思考模式')
            .fontSize(typeOf('type.micro').size).fontColor(this.palOnce().textMuted)
            .layoutWeight(1)
          Text(thinkingStepLabel(this.thinkStep))
            .fontSize(typeOf('type.micro').size).fontColor(this.palOnce().textSecondary)
            // 横向约束（同 H1：表达式取显示文案，给收缩能力）
            .constraintSize({ maxWidth: 120 })
        }
        .width('100%')
        // 结构 = `Stack[ 轨道层 | 命中层 ]`（同抽屉分类分段控件）：轨道是**画**出来的背景（垂直居中），
        // 命中层承载点击 ⇒ 视觉 36、热区 44（⛔ 不能靠 `responseRegion` 外扩：真机实测无效）。
        Stack() {
          Row()
            .width('100%').height(SEG_TRACK_H)
            .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
            // chip 面补**内凹发丝**（深色才有值、浅色 transparent ⇒ 浅色逐字节不变）
            .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.palOnce()) })
            .borderRadius(RADIUS_PILL)
          Row({ space: SPACE_HAIR }) {
            ForEach(THINKING_STEP_LABELS, (label: string, i: number) => {
              Row() {
                Row() {
                  Text(label)
                    .fontSize(typeOf('type.caption').size)
                    .fontWeight(i === this.thinkStep ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(i === this.thinkStep ? this.palOnce().textPrimary : this.palOnce().textSecondary)
                    // ⛔ 横向约束（`horizontal_overflow_gate` H1：`label` 是**变量**、长度无上限
                    //    ⇒ 必须给收缩能力，否则该站点判红）。`layoutWeight(1)` + `textAlign(Center)`
                    //    在分段控件里是**天然**语义：段内文字占满芯宽、超出走省略号。
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .width('100%').height(SEG_PILL_H)
                .justifyContent(FlexAlign.Center)
                .alignItems(VerticalAlign.Center)
                .backgroundColor(i === this.thinkStep
                  ? surfaceFillOf(this.palOnce(), 'surface.card')
                  : Color.Transparent)
                .borderRadius(RADIUS_CHIP)
                // 选中态缓动（Apple 分段控件的选中是**渐变**、不是硬切）：走底座 `animBase()`
                // ⛔ 不新建曲线对象（受 `anim*()` ≤20 预算约束）；只动底色 ⇒ 不碰不透明度语义。
                .animation(animBase())
              }
              .layoutWeight(1)
              .height(HIT_TARGET_MIN)
              .justifyContent(FlexAlign.Center)
              .alignItems(VerticalAlign.Center)
              // 提交在飞（`thinkBusy`）⇒ 整段降不透明度（与旧形态同一语义；初值 1 ⇒ 失败方向安全）
              .opacity(this.thinkBusy ? 0.5 : 1)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                if (!this.thinkBusy && i !== this.thinkStep) {
                  void this.commitThinkingStep(i);
                }
              })
            }, (label: string, i: number) => `think-step-${i}`)
          }
          .width('100%')
        }
        .width('100%')
        .height(HIT_TARGET_MIN)
      }
      .width('100%')
      .padding({ top: SPACE_SM })
      .border({ width: { top: STROKE_HAIRLINE }, color: hairlineOf(this.pal()) })
    }
    .width('100%').padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    // 顶层弹层根边界 = **结构性发丝**（与 `QueueSheet`/`SelfCheckSheet`/`StatusSheet` 等同层级 ⇒ 同通道）。
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    // 贴合层（near）：浅色 = 接触影；深色 = 透明（不渲染 ⇒ 净观感不变）。
    .shadow({
      radius: this.contactLayer('overlay').radius,
      color: this.contactLayer('overlay').color,
      offsetX: 0, offsetY: this.contactLayer('overlay').offsetY,
    })
    }
    .width(SHEET_WIDTH)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值。
    .shadow({
      radius: shadowLayersOf(this.pal(), 'overlay')[1].radius,
      color: shadowLayersOf(this.pal(), 'overlay')[1].color,
      offsetX: 0, offsetY: shadowLayersOf(this.pal(), 'overlay')[1].offsetY,
    })
    .transition(sheetTransition())
  }

  /**
   * 拉模型列表 —— **唯一取数入口** = `store.loadLlmConfig()`（三态由它写 `llmConfigState`/`llmConfigError`）。
   * 打开面板与失败态「重试」都经此（⛔ 不自造第二套 RPC / 状态）。
   * store 未连接 ⇒ 直接落**失败态**（可重试），⛔ 不静默留一个转不完的圈。
   */
  private reloadModelList(): void {
    const store: ChatStore | null = this.store;
    if (store === null) {
      this.llmCfgState = 'error';
      this.llmCfgError = '尚未连接服务端';
      return;
    }
    void store.loadLlmConfig();
  }

  /**
   * 读一次思考模式（**唯一取数入口** = `get_user_thinking_mode`，与设置页 `SettingsLlm` 同 RPC）。
   * 库值 → 步骤：`thinkingModeToStep`（判据在 `core/settings.ets`，web `ThinkingModeControl.tsx:19-31`）。
   */
  private async loadThinkingMode(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      const mode: string = await rpc<string>(store.http, RpcMethod.getUserThinkingMode);
      this.thinkStep = thinkingModeToStep(mode);
    } catch (e) {
      // 读失败 ⇒ 保持当前档（⛔ 不假装成"自动"；与设置页"读失败不落假值"同口径）。
    }
  }

  /**
   * 写思考模式：`set_user_thinking_mode {mode}`（**裸值**，web `components/agent/api.ts:823`）。
   * 失败 ⇒ 回滚到上一档 + toast（⛔ 不留"看起来已生效"的假值，同 `commitThinking`）。
   */
  private async commitThinkingStep(step: number): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || this.thinkBusy) {
      return;
    }
    const prev: number = this.thinkStep;
    this.thinkBusy = true;
    this.thinkStep = step;
    try {
      await rpc<void>(store.http, RpcMethod.setUserThinkingMode,
        new ThinkingModeParams(thinkingStepToMode(step)));
      this.toast('已保存');
    } catch (e) {
      this.thinkStep = prev;
      this.toast(`保存失败: ${errText(e as Object)}`);
    } finally {
      this.thinkBusy = false;
    }
  }

  /** 可选模型**条目**总数（三态纯函数输入；0 ⟺ 无任何可选模型）。 */
  private modelEntryCount(): number {
    const gs: ModelGroup[] = this.modelGroups();
    let n: number = 0;
    for (let i = 0; i < gs.length; i++) {
      n += gs[i].entries.length;
    }
    return n;
  }

  /** 模型列表面板三态（**判据与渲染同源**：`core/llmfmt.ets:modelPanelStatus`；⛔ 不在页面另算一套）。 */
  private modelPanelStatusNow(): ModelPanelStatus {
    return modelPanelStatus(this.llmCfgState, this.modelEntryCount(), this.llmCfgError);
  }

  /** 切模型（带 sub_id；防连点；失败把原因原样告诉用户）。 */
  private async pickModel(subId: string, subName: string, model: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || model.length === 0 || subId.length === 0 || this.modelBusy.length > 0) {
      return;
    }
    this.modelBusy = `${subId}#${model}`;
    try {
      // 直接调后端 HTTP API（POST /api/llm-config action=set_model）——
      // 不发 /set-model 聊天消息（会在聊天历史里产生一条命令消息）。
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

  // ── 弹层：图片查看 ────────────────────────────────────────────────────────

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
  /**
   * 上一帧的 `id#rev` 键快照。
   *
   * ⛔ 必须快照（不能用 `changedRowIndices(this.rows, next)`）：`ChatRow` 是**就地更新**
   * 的（保 @ObjectLink 恒等，见 core/render.ets）⇒ `this.rows[i]` 与 `next[i]` 是
   * **同一对象引用**，`rowKey` 读到的 `rev` 是同一个（已自增）⇒ 恒相等 ⇒ 零通知 ⇒
   * `LazyForEach` 永不重建该行（bug ①「迭代 commit 后消失」的根因之一）。见
   * core/rowdiff.changedByKeys。
   */
  private keys: string[] = [];
  private listeners: DataChangeListener[] = [];
  /** 上一帧的行色板（`themeName`）。与 `chatId` 同责：变了就必须整表 reload（键含主题）。 */
  private theme: string = '';

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): ChatRow {
    // ⛔ **绝不返回 `undefined`**（2026-10-12 真机 P0）：`LazyForEach` 的 key 生成器
    //    `sessionScopedRowKey(this.currentChat, row)` 会立刻读 `row.id` —— 拿到 `undefined`
    //    即**抛异常**，ArkUI 随即**中断整个子树**的构建 ⇒ `List` 与它之后的一切（**输入框**）
    //    都不渲染 = 用户看到的"列表空 + 输入框都没出来"（白屏）。索引越界只可能发生在
    //    "框架缓存的 count 与数组已换"的竞态窗口里 ⇒ 这里给一个**空行兜底**，保证不炸。
    const r: ChatRow | undefined = this.rows[index];
    return r !== undefined && r !== null ? r : new ChatRow();
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
  applyRows(next: ChatRow[], chatId: string, theme: string): void {
    // 骨架重建判据必须含**会话身份**（见 core/rowdiff.needsFullReload 的事故注释）
    // ⛔ 还必须含**主题**：`LazyForEach` 的键含主题（`themableRowKey`）⇒ 主题变了键全变，
    //    必须走整表 reload 让框架重读键/重建条目；否则键已变而只发 `onDataChange` ⇒
    //    已存在行仍冻结在旧色板（用户亲报「深色看不清字」的同一根因）。
    const fullReload: boolean = needsFullReload(this.rows, next, this.chatId, chatId);
    const themeChanged: boolean = theme !== this.theme;
    this.theme = theme;
    // ⚠️ 2026-10-17 键去 rev 后：**内容更新不再走 onDataChange**（同键 item 被
    //    LazyForEach 用 onDataChange 触发重建 = 闪烁根源）—— @Observed 属性刷新接管：
    //    ChatRow 是 @Observed、render.applyRow 对 iterations 等赋值替换引用 ⇒
    //    @ObjectLink 组件自动重渲（与 web 的 React 状态更新同语义）。changed 恒空。
    const changed: number[] = [];
    this.rows = next;
    this.chatId = chatId;
    const keys: string[] = [];
    for (let i = 0; i < next.length; i++) {
      keys.push(rowKey(next[i]));
    }
    // ⛔ 重复键检测（2026-10-12 真机 P0：`AceLazyForEach: Use repeat key for index: 0 / 9`
    //    ⇒ LazyForEach 因键重复不建项 ⇒ **列表不渲染（整片空白）**。键 = `chatId#id#rev`
    //    由页面 key 生成器算（`sessionScopedRowKey`），任何两行同 id+rev 就会撞。）
    {
      const seen: Map<string, number> = new Map<string, number>();
      const dups: string[] = [];
      for (let i = 0; i < next.length; i++) {
        const k: string = keys[i];
        const prev: number | undefined = seen.get(k);
        if (prev !== undefined) {
          dups.push(`#${prev}/#${i}:id=${next[i].id},rev=${next[i].rev}`);
        } else {
          seen.set(k, i);
        }
      }
      if (dups.length > 0) {
        console.debug(`[KEYDUP] chatId=${chatId} n=${next.length} dups=${dups.length} ${dups.slice(0, 6).join(' | ')}`);
      }
    }
    this.keys = keys;
    if (fullReload) {
      for (let i = 0; i < this.listeners.length; i++) {
        this.listeners[i].onDataReloaded();
      }
      return;
    }
    if (themeChanged) {
      // ⛔ 2026-10-17 白底白字终极修复（hilog keygen 实证：onDataReloaded 不重建可见 item
      //   ——键生成器被调用+键含正确 @theme+但 build 没重跑 ⇒ MarkdownView 持旧色板）：
      //   逐行发 onDataChange(i) 强制框架重建每个可见 item ⇒ build 重跑 ⇒ AppStorage.get
      //   读最新主题 ⇒ 正确色板 ⇒ 正确文字色。
      console.debug('[THEME5] applyRows themeChanged → onDataChange 逐行 chat=' + chatId + ' theme=' + theme + ' n=' + next.length);
      for (let i = 0; i < next.length; i++) {
        for (let j = 0; j < this.listeners.length; j++) {
          this.listeners[j].onDataChange(i);
        }
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
