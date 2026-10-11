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
