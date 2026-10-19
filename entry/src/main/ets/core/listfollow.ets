/**
 * 消息列表「是否跟随到底部」的**纯逻辑**（可脱机单测；不依赖任何 ArkUI 全局类型）。
 *
 * 为什么要抽成纯函数：这个开关上的真机 P0（2026-10-11「有时候点击工具 pill 自动把视角跳到
 * 最下方」）此前是 `pages/Index.ets` 里的**行内表达式**，测不到 ⇒ 只能靠真机撞。抽出来后
 * ArkUI 侧只做"取值 → 调本函数 → 写 @State"，判据本身由 `tools/tests/listfollow.test.ts` 钉死。
 *
 * ⛔ 铁律（与 xbot Web 端 `userScrolledUp` 同源）：**"是否跟随"是用户意图，不是位置快照。**
 *    只有**用户输入**（手指拖动/惯性/过卷/滚轮/滚动条）能翻转它；**程序滚动**（`Scroller` 成员
 *    方法如 `scrollEdge`/`scrollToIndex`）与**内容增删引起的钳位、索引回调**一律不得置位 ——
 *    否则"用户往上读历史"的意图会被一次程序动作改写，表现为"点一下工具 pill 就被拽到最下方"。
 */

/**
 * 全局“用户正在滚动”标志（模块级、非响应式）。
 *
 * ⛔ 为什么必须有它（2026-10-17 用户 P0「流式期滚动高度不断抖动」）：
 *   `LazyForEach` 的 item builder 只在**新建**时执行 ⇒ 页面把 `paused` 作为参数传给
 *   已有 `LiveTailView` 条目时，`userScrolling` 变化**不会**重新投递 `@Prop` ⇒ 打字机定时器
 *   继续每 50ms 推进 `vis/visReason` ⇒ 在飞行高度持续变化（即使用户在滚动）。
 *   `LiveTailView.tick` 直接读本标志（定时器本来就每 50ms 跑一次），零响应式开销；
 *   滚动停止后自动恢复（不 stopTimer，避免“没人再拉起”）。
 */
let uiScrollActive: boolean = false;
export function setUiScrolling(active: boolean): void {
  uiScrollActive = active;
}
export function uiIsScrolling(): boolean {
  return uiScrollActive;
}

/**
 * 应用是否在后台（模块级）。
 *
 * ⛔ 为什么不能只靠 `LiveTailView` 的 `paused` @Prop：`LazyForEach` 的 item builder 只在
 *   **新建**时执行 ⇒ 页面把 `appPaused` 作为 prop 传给已有条目时，休眠再恢复**不会**
 *   重新投递 @Prop ⇒ 该行永远停在 `paused=true`，打字机定时器不再推进 ⇒ 用户看到
 *   「跑久/休眠后 stream 更新频率变低，重启 App 才恢复」。
 *   与 `uiIsScrolling` 同款：组件 tick 直接读模块级标志，零响应式开销；
 *   onPageHide/onPageShow 切换即可，现有行也能立即恢复。
 */
let appPausedActive: boolean = false;
export function setAppPaused(active: boolean): void {
  appPausedActive = active;
}
export function appIsPaused(): boolean {
  return appPausedActive;
}

/**
 * 「是否跟随到底部」状态机的下一步（纯函数）。
 *
 * @param prev      当前开关（true = 跟随；用户往上滚之后为 false）
 * @param userDriven 这一帧的滚动是否来自**用户输入**（ArkUI 侧由 `ScrollSource` 映射，见页面）
 * @param endIndex  `onScrollIndex` 的 `end`（**列表项**下标，含可选的"加载更早"头项/尾项）
 * @param itemCount 当前**列表项**总数（必须含头项/尾项，见 `listItemCount`）
 * @returns 新的开关
 *
 * 不变量（由判别力测试钉死）：
 *  ① `userDriven === false` ⇒ **恒等于 prev**（程序滚动/内容钳位绝不改写用户意图）；
 *  ② 用户在真底部（`prev === true`）时新内容到达 ⇒ 仍为 true（**不能**为了修 bug 把跟随弄没）；
 *  ③ 只有用户输入把列表滚到"末项可见"才置 true，用户往上滚离末项 ⇒ false；
 *  ④ 空列表（`itemCount <= 0`）无从判断 ⇒ 保持 prev。
 */
export function nextFollowBottom(prev: boolean, userDriven: boolean, endIndex: number,
  itemCount: number, atEnd?: boolean): boolean {
  if (!userDriven) {
    return prev;
  }
  if (itemCount <= 0) {
    return prev;
  }
  // ★ 优先用**精确的位置判据**（`Scroller.isAtEnd()`，调用方从 `onScrollIndex` 传入）。
  //   为什么索引判据不够（用户 2026-10-12 亲报"流式时上滚被人机对抗、被强行拉回底下"）：
  //   `endIndex >= itemCount-1` 只说明"**末项可见**"，**不等于**"滚动位置到底"——
  //   流式期间**末项 = 在飞 live 行**（思考 + 打字机正文），它可以**高到占满整个视口**；
  //   用户在**它内部**往上滚时末项始终可见 ⇒ 索引判据恒 true ⇒ 误判"已回底" ⇒ 恢复跟随
  //   ⇒ 自动滚动随即把用户拽回底部（正是"人机对抗"）。`isAtEnd()` 判的是**偏移量到底**，
  //   与"末项是否可见"无关 ⇒ 只有当用户**真的滚到底**才恢复。
  //   `atEnd === undefined` 仅供**无 scroller 的纯逻辑/回归用例**回退到索引判据。
  if (atEnd !== undefined) {
    return atEnd;
  }
  return endIndex >= itemCount - 1;
}

/**
 * 滚动**停止**后的跟随开关（`onScrollStop` + `Scroller.isAtEnd()`，**位置式**判据）。
 *
 * ⛔ 为什么必须补这一路（用户 2026-10-12 真机亲报「滚回最下方，『回到最新』药丸不消失」；
 *    真机截图实证：列表已停在**末项**，药丸仍常驻）：
 *    `onWillScroll` 对**每一个用户帧**都置 `followBottom=false`（含**贴底之后**的回弹/惯性帧 ——
 *    `EdgeEffect.Spring` 在末尾仍产出用户源帧），而 `onScrollIndex` **只在可见索引区间变化时**
 *    才回调 ⇒ 最后一帧"已贴底但索引未变"时 **没有任何回调去复位** ⇒ 药丸常驻。
 *    `isAtEnd()` 判的是**滚动位置**（SDK `scroll.d.ts:552-566` 原文：Checks whether the component
 *    has scrolled to the bottom），与索引区间无关 ⇒ 恰好补上这个缺口。
 *
 * 不变量（判别力测试钉死）：
 *  ① 贴底（`atEnd === true`）⇒ **恒为 true**（恢复跟随 ⇒ 药丸消失、新内容继续跟随）；
 *  ② 未贴底 ⇒ **保持 prev**（⛔ 不把"用户刻意往上滚停在中途"也拽回底部）。
 */
export function followAfterScrollStop(prev: boolean, atEnd: boolean): boolean {
  return atEnd ? true : prev;
}

/**
 * `onWillScroll` 一帧之后，「用户滚动意图」标志的新值 —— **只置位、不清位**。
 *
 * ⛔ 为什么不能"这一帧不是用户滚动就清位"（真机缺陷，用户 2026-10-11 亲报
 *    「streaming 的时候也要允许用户正常滚动」）：
 *    流式期间**每帧都有程序滚动**（`shouldAutoScroll` 命中 ⇒ `scrollEdge(Edge.Bottom)`，
 *    打字机/工具 pill 每 ~50ms 长大一次）。用户手指上滑的帧序是：
 *      ① `onWillScroll(DRAG/FLING)` → 本函数收到 `thisFrameIsUser=true` → 置位；
 *      ② **在 `onScrollIndex` 消费之前**，一次流式自动滚动到达 ⇒ `onWillScroll(SCROLLER)`
 *         → 若此处清位 ⇒ **用户意图被吃掉**；
 *      ③ `onScrollIndex` 消费到 `userDriven=false` ⇒ `followBottom` 恒 `true`
 *         ⇒ 自动滚动继续把视角拽回底部 ⇒ 用户**根本滚不动**。
 *    清位只发生在 `onScrollIndex` 消费时（见页面：`nextFollowBottom` 之后立即复位）。
 *
 * 不变量（判别力测试钉死）：
 *  ① `thisFrameIsUser=false` ⇒ 恒等于 `pending`（**绝不清位**）；
 *  ② `thisFrameIsUser=true`  ⇒ 恒为 `true`；
 *  ③ 置位后即使来一万个程序帧，标志仍为 `true`（等待 `onScrollIndex` 消费）。
 */
export function markUserScrollFrame(pending: boolean, thisFrameIsUser: boolean): boolean {
  return pending || thisFrameIsUser;
}

/**
 * 消息列表的**列表项**总数 = [可选"加载更早"头项] + rows + [可选 live 行项] + [可选 busy 指示器项]。
 *
 * `onScrollIndex` 给的是**列表项**下标，而项数 ≠ rows.length ⇒ 必须显式算，用错就会误判贴底。
 *
 * ⛔ 头项判据必须与**渲染它的那个 `if`**（`List` 的第一个 ListItem）同源 —— 渲染条件除
 *    `hasMore || loadingMore` 外**还有** `hiddenRowCount(...) > 0`（行窗口被截断时头项也在，
 *    页面侧统一由 `hasHeadItem()` 给出）。本函数曾只判前两者 ⇒"全量历史已加载但行窗口被截断"
 *    （长会话的常态）时项数**少算 1** ⇒ `end >= n-1` 提前一项成立 ⇒"用户还差一项才到底"
 *    被判成贴底（同一 P0 的第二个成因）。
 */
export function listItemCount(headItem: boolean, busyPlaceholder: boolean, rowsLen: number,
  liveRows: number): number {
  let n: number = rowsLen + liveRows;
  if (headItem) {
    n += 1;
  }
  if (busyPlaceholder) {
    n += 1;
  }
  return n;
}

/** 用户就地操作（展开/折叠工具详情等）之后，抑制"程序滚到底"的时间窗（毫秒）。 */
export const FOLLOW_SUPPRESS_MS: number = 1200;

/**
 * 是否应当执行**程序滚动到底**（纯函数，可脱机单测）。
 *
 * 为什么需要它（真机 P0，2026-10-11 用户报"点最后一个迭代里的工具就自动滚到最下方"）：
 * `pages/Index.ets:syncFrom()` 此前是**任何 store 变化 + `followBottom` 为真**就
 * `scrollEdge(Edge.Bottom)`。而 `followBottom` 只是"用户**愿意**跟随新内容"的意图，
 * 它无法区分"尾部真的长出了新内容"与"用户在原地展开了一张卡片" —— 后者会命中同一条件：
 * 点工具 pill ⇒ 异步拉取迭代明细 ⇒ store 变更（行 `rev` 自增）⇒ 面板**无条件**滚到底
 * ⇒ 展开后更高的卡片把内容顶起，用户刚点的那颗 pill 被顶出视口（"我自己点一下，视角却被抢走"）。
 *
 * ⛔ 判据（三条**同时**成立才允许程序滚动）：
 *  ① `followBottom`：用户意图是跟随（往上滚过就为 false，见 `nextFollowBottom`）；
 *  ② `contentGrew`：本帧**尾部内容**真的变了（行指纹变化 ⇒ 流式新增/行增删）；
 *     —— 纯 UI 状态变更（展开、折叠、选中、浮层开关）不得移动视口；
 *  ③ 不在**用户就地操作抑制窗**内（`nowMs >= suppressUntilMs`，左闭右开）：
 *     用户刚点了展开/折叠，这一次内容变化是他自己造成的 ⇒ 不许抢滚动位置。
 *
 * @param followBottom 当前"是否跟随"意图（`nextFollowBottom` 的输出）
 * @param contentGrew 本帧尾部内容是否变化（行指纹 `!==` 上一帧）
 * @param nowMs 当前时刻（`Date.now()`）
 * @param suppressUntilMs 抑制窗结束时刻（0 = 无抑制）
 */
export function shouldAutoScroll(followBottom: boolean, contentGrew: boolean,
  nowMs: number, suppressUntilMs: number): boolean {
  if (!followBottom) {
    return false;
  }
  if (!contentGrew) {
    return false;
  }
  return nowMs >= suppressUntilMs;
}

/** 就地操作抑制窗的结束时刻（纯算术，供页面直接赋值）。 */
export function followSuppressUntil(nowMs: number, windowMs: number): number {
  return nowMs + windowMs;
}

/**
 * 行窗口**放开一批**之后，把「原本位于视口顶部的那一项」重新放回视口顶部所需的**新列表项下标**。
 *
 * ── 为什么必须有它（用户 2026-10-13 亲报）────────────────────────────────────
 *   「加载更多触发后，新内容应该接在**当前屏幕上方**（屏外），用户要继续往上滚才能看到；
 *     现在是加载之后**立刻视角跑到被加载的最上方**。」
 *   机制：放开行窗口（`rowLimit += MAX_ROWS_VISIBLE`）⇒ `syncRowDs()` 在数据源**头部插入**行。
 *   插入点 = **头项之后**（头项 = 列表第 0 项，此刻正可见）⇒ 插入落在**视口之内** ⇒ 框架的
 *   `List.maintainVisibleContentPosition`（只对"视口**之外**插入/删除"生效）**帮不上忙**；
 *   `List` 只能按**像素偏移**保位 ⇒ 同一个偏移此刻指向**新插入的行** ⇒ 视口跳到新内容顶部。
 *
 *   唯一确定的做法：**显式**把旧的首个可见项滚回视口顶部（`ScrollAlign.START`）——
 *   新放开的 `prepended` 行全部落在它**前面**，即屏幕**上方之外**。
 *
 * @param prevTopIndex 放开前**首个可见列表项**下标（页面 `@State listStart`，来自 `onScrollIndex`）
 * @param prepended 本次在数据源**头部**插入的项数（放开后 `rowDs.count()` 的增量）
 * @returns 新列表项下标（夹到 ≥0；放开前已在顶部则结果 = `prepended`，语义仍是"旧首项回顶部"）
 */
export function anchoredIndexAfterPrepend(prevTopIndex: number, prepended: number): number {
  const t: number = prevTopIndex + prepended;
  return t > 0 ? t : 0;
}
