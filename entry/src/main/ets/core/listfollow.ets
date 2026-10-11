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
  itemCount: number): boolean {
  if (!userDriven) {
    return prev;
  }
  if (itemCount <= 0) {
    return prev;
  }
  return endIndex >= itemCount - 1;
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
