/**
 * indicators.ets —— 列表「进行中」信号的**唯一判据**（纯逻辑，可脱机单测）。
 *
 * 不变量（用户 2026-09-19 / 2026-10-10 真机两次点名）：
 *   **「只要输入框是 cancel（停止），列表尾部就必须有一个可见的『进行中』信号」**
 *   （「思考中…」占位，或 live 行自身渲染出的在飞内容）。
 *
 * 对齐 web（`web/src/components/agent/MessageList.tsx`）：
 *   · `liveId` 指向接收 liveProgress 的那一行（尾行是 live 行时才可能"自带信号"）；
 *   · `tailShowsIndicator = tailIsLiveRow && liveIterationInFlight(...)`；
 *   · `showBusyPlaceholder = busy && !(loading && rows.length===0) && !tailShowsIndicator && !tailIsLiveRow`。
 *   web 用**同一个 `busy`** 驱动 composer 的 cancel 与列表占位符 ⇒ 不变量按构造成立。
 *
 * ⛔ 真机 P0（2026-10-10「发送完了连思考中都没来」）：native 把 composer 的 busy
 *   （`runningNow()`：本地 busy ∥ live 内容 ∥ 新鲜的服务端 running）与列表占位符的
 *   busy（`this.busy` = store.busy，仅本地事件驱动）**分成两套判据**。服务端已 running
 *   但本地 turn_started 未到（SSE 延迟/错过/刚切到运行中会话）时，按钮=停止、列表=空
 *   ⇒ 不变量被破坏。修法：两者共用下面这个 `busyNow`（= web 的单一 busy 语义）。
 */

import { t } from './i18n';
export interface BusySignals {
  /** 本地事件驱动的 busy（`store.busy`：sessionRunning ∥ streaming ∥ activeTurn） */
  localBusy: boolean;
  /** 当前会话持有**带产出**的 live 行（`store.hasLiveRowWithContent()`） */
  liveHasContent: boolean;
  /** 尾部 live 行自身已在渲染在飞信号（`hasLiveRow` 且该行非空） */
  tailShowsIndicator: boolean;
  /** 服务端会话树 `running` 且快照新鲜（≤20s 内拉过会话树） */
  freshServerRunning: boolean;
  /** 历史加载中（骨架屏判据：只有"还没内容且正在拉"才用骨架，不与占位叠加） */
  loading: boolean;
  /** 列表已有行数 */
  rowsLen: number;
  /**
   * 开屏/会话加载 splash 是否**正在展示**（冷启动 `showSplash` ∥ 切会话 `switchSplash`）。
   *
   * ⛔ 用户 2026-10-16 亲报（严重）：「splash screen 还没消失，那个**小的『思考中』**就渲染了」。
   *    splash 自身已经是"正在准备"的反馈 ⇒ 再叠一个「思考中…/思考光球」既**语义矛盾**
   *   （同一屏既"开始/加载中"又"思考中"）又廉价。splash 展示期间 ⇒ **列表侧一切
   *   "进行中"指示器一律让位**（composer 的 cancel **不受影响** —— 会话确实在跑）。
   */
  splashUp: boolean;
}

/**
 * composer 与列表**共用**的「是否在跑」判据（对齐 web 的单一 `busy`）。
 *
 * 顺序无关（纯或），与既有 `runningNow()` 的语义逐项对应：
 *   ① 尾部 live 行已在渲染在飞内容；
 *   ② 当前会话有带产出的 live 行；
 *   ③ 本地事件驱动的 busy；
 *   ④ 服务端权威 running（快照新鲜时兜底 —— 本地快路径漂移/迟到时的最后防线）。
 */
export function busyNow(o: BusySignals): boolean {
  return o.tailShowsIndicator || o.liveHasContent || o.localBusy || o.freshServerRunning;
}

/**
 * 列表是否必须渲染 busy 占位符（「思考中…」）。
 *
 * ⚠️ 必须由 `busyNow` 驱动（**不能**用 `localBusy`）—— 否则与 composer 的按钮分叉。
 * `loading && rowsLen===0` 时不叠加（骨架屏承担空态反馈）。
 * `splashUp` 时**一律不渲染**（用户 2026-10-16 亲报：splash 未消失就渲染「思考中」）——
 * splash 自己就是"正在准备"的反馈，见 `BusySignals.splashUp`。
 */
export function showsBusyPlaceholder(o: BusySignals): boolean {
  return !o.splashUp && busyNow(o) && !(o.loading && o.rowsLen === 0) && !o.tailShowsIndicator;
}

/**
 * 「↓ 回到最新」是否显示 —— **贴底不显示**、空列表不显示（对齐 web：仅在
 * follow 暂停、且确有内容时才给"回到底部"入口）。
 *
 * ★ 第三个参数 = **贴底位置闸门**（`atEnd?: boolean`，2026-10-12 用户真机亲报）：
 *   用户原话「药丸只在**刚好**在最下方才不渲染；容器有弹性，**向下过滚动时它还会出现**，
 *   自动回正之后才消失」。根因：`EdgeEffect.Spring` 的**弹性过滚动**期间，滚动帧会把
 *   「跟随」意图置为暂停（`onWillScroll` ⇒ `followBottom=false`），而此刻**视口其实还在末尾**
 *   （只是被拉过头），于是药丸**闪现**、回正后才消失。
 *   ⛔ `Scroller.isAtEnd()` **不足以**当这个闸门（实测：弹性过滚动期间它判**假**）⇒ 用页面在
 *   **滚动停止**时缓存的位置（`@State atEndUi`）当闸门：停止前的位置不变 ⇒ 过滚动/回弹全程
 *   闸门恒为"在底部"⇒ 药丸**不闪**。
 *   ⛔ 注意方向：这个闸门**只压制闪现**，绝不阻止"用户真的上滚后出药丸"——
 *   用户上滚**并停下**时 `atEndUi` 立刻变 false（同一 `onScrollStop` 里更新），药丸随即出现。
 */
export function showsJumpToLatest(atBottom: boolean, rowsLen: number, atEnd?: boolean): boolean {
  if (atEnd === true) {
    return false;
  }
  return !atBottom && rowsLen > 0;
}

/**
 * 骨架屏是否该出现 —— **唯一判据**（真机走查 P0，2026-10-11）。
 *
 * 只有「**正在拉历史** 且 尚无任何行」才用骨架屏；拉完仍无行 ⇒ 交给空态「开始对话」。
 * 与 `showsBusyPlaceholder` 里的 `!(o.loading && o.rowsLen === 0)` 是**同一条语义**。
 *
 * ⛔ 曾经的真机缺陷：`pages/Index.ets` 把这里的判据写成了 `!historyLoading && rows===0`
 *   （与 `BusySignals.loading` 的契约**恰好相反**）⇒ 空会话上骨架屏**永久残留** 4 行灰条，
 *   而且与空态**同时**渲染（星形 +「开始对话」+ 灰条并存）。判据收进本模块后由单测钉死。
 */
export function showsHistorySkeleton(loading: boolean, rowsLen: number): boolean {
  return loading && rowsLen === 0;
}

/**
 * 不变量自检：**在跑 ⟹ 有信号**（占位符 或 尾部 live 行自带信号）。
 * 供测试/断言使用；runtime 不必调用。
 */
export function hasRunningSignal(o: BusySignals): boolean {
  return showsBusyPlaceholder(o) || o.tailShowsIndicator;
}

/** 压缩阶段的 phase 值（服务端 `ProgressSnapshot.phase`；见 `core/progress_types.ts:18`）。 */
export const PHASE_COMPRESSING: string = 'compressing';

/** busy 占位文案：**压缩上下文**（web `MessageList.tsx:1679-1686` → `t('agent.compressing')`）。 */
export const BUSY_LABEL_COMPRESSING: string = '正在压缩上下文…';

/** busy 占位文案：**普通思考**（web `ShimmerThinking`，i18n `agent.thinking`）。 */
export const BUSY_LABEL_THINKING: string = '思考中…';

/**
 * busy 占位符的**文案**（纯函数 —— 唯一判据，组件层不得再自造）。
 *
 * web 权威：`web/src/components/agent/MessageList.tsx:1679-1686` 在 busy 占位里按
 * `liveProgress?.phase === 'compressing'` 二选一：
 *   · 压缩 ⇒ `Loader2` + `t('agent.compressing')`（「正在压缩上下文…」）；
 *   · 其余 ⇒ `<ShimmerThinking/>`（「思考中…」）。
 *
 * ⛔ 现状缺陷（本函数修的）：原生**透传了 `phase` 却无任何 UI 消费者** ⇒ 压缩期恒显示
 *   「思考中…」，与 web 分叉（压缩是一段可能很久、且**不产出思考**的阶段，用「思考中」
 *   描述它是误导）。判据收敛到此处，`pages/Index.ets` 的占位行只消费本返回值。
 *
 * @param phase 服务端 `ProgressSnapshot.phase`（`undefined`/`''` ⇒ 当作普通思考，与 web 同）
 */
export function busyLabel(phase: string | undefined): string {
  return t(phase === PHASE_COMPRESSING ? BUSY_LABEL_COMPRESSING : BUSY_LABEL_THINKING);
}

// ── 会话抽屉（侧边栏）空态判据 ────────────────────────────────────────────────
//
// 缺陷（`docs/REDESIGN-INPUT-STATES.md §F1`，2026-10-11）：抽屉的 `List` 直接
//   `ForEach(this.drawerGroups())`，**没有 `length === 0` 分支** ⇒ 无会话时用户看到
//   **空白抽屉**，不知道是"没会话"还是"没加载出来"。判据收进本模块（与
//   `showsHistorySkeleton` / `showsBusyPlaceholder` 同族）⇒ 可脱机单测、单一真源。
/** 抽屉不空（正常列表）。 */
export const DRAWER_EMPTY_NONE: string = '';
/** 一个会话都没有 ⇒ 需要「新建会话」引导动作。 */
export const DRAWER_EMPTY_NO_SESSIONS: string = 'no-sessions';
/** 有会话、但当前筛选/渠道把它们全滤掉了 ⇒ 需要「清除筛选」出口。 */
export const DRAWER_EMPTY_NO_MATCH: string = 'no-match';

/**
 * 抽屉空态档位（**唯一判据**；⛔ 页面不得另写一套 `if`）。
 *
 * @param total    会话总数（`sessions.length`，**未**筛选）
 * @param filtered 当前搜索词 × 渠道过滤后的会话数（`filteredSessions().length`）
 */
export function drawerEmptyKind(total: number, filtered: number): string {
  if (total === 0) { return DRAWER_EMPTY_NO_SESSIONS; }
  if (filtered === 0) { return DRAWER_EMPTY_NO_MATCH; }
  return DRAWER_EMPTY_NONE;
}

/** 抽屉**空态**文案（单一真源；`title` 主行 + `hint` 副行）。空态无文案 ⇒ 返回空串。 */
export function drawerEmptyHint(kind: string): string {
  if (kind === DRAWER_EMPTY_NO_SESSIONS) { return t('还没有会话'); }
  if (kind === DRAWER_EMPTY_NO_MATCH) { return t('没有匹配的会话'); }
  return '';
}
