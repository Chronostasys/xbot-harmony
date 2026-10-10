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

/** 判定「是否在跑」所需的全部信号（页面从 store + 会话树采集后传入）。 */
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
 */
export function showsBusyPlaceholder(o: BusySignals): boolean {
  return busyNow(o) && !(o.loading && o.rowsLen === 0) && !o.tailShowsIndicator;
}

/**
 * 「↓ 回到最新」是否显示 —— **贴底不显示**、空列表不显示（对齐 web：仅在
 * follow 暂停、且确有内容时才给"回到底部"入口）。
 */
export function showsJumpToLatest(atBottom: boolean, rowsLen: number): boolean {
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
