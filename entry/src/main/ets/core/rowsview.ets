/**
 * rowsview.ets —— 渲染行的**行内块窗口**纯逻辑（可脱机单测；不依赖任何 ArkUI 全局类型）。
 *
 * 为什么必须有（性能审计 TOP1，见 `docs/PERF-BUDGET.md §3 问题①`）：
 *   `List`/`LazyForEach` 的虚拟化是**行级**的 —— **行内不虚拟化**。一行 = 一个 `ListItem`
 *   ⇒ 该行内 N 个迭代块**全部实例化**（N 个 `MarkdownView` 子树 + N 组 pill/思考行）。
 *   真实服务端实测**单行最多 340 块**（`chat_43C84E66B106`；稳定 fixture `chat_AAB719716889`
 *   为 108 块）；按真机实测常数 **5.7 节点/块** 折算 ≈ **1938 节点**，超单行布局预算
 *   （`MSG_ROW_NODE_BUDGET`=600）的 **3.2×**。块多的一行实测**占屏节点 67%** ⇒ 它就是
 *   "长会话卡到没法用"的**主结构项**。
 *   ⇒ 行内做**块级窗口**：只渲染末尾 N 块，更早的折叠成**一行恒定高哨兵**（可见即自动放宽）。
 *
 * ⛔ 三条铁律（改这里必须同时满足）：
 *   1. **不丢内容**（用户规则：不能让内容静默消失）：`visibleBlocks ⊕ 隐藏部分` 必须还原
 *      **全部**块（`tools/tests/rowsview.test.ts` 有守护），且界面上必须有「还有 N 块」的
 *      **可见提示**（哨兵行）—— 显示可省，语义不可省。
 *   2. 交互与既有的「更早区域」（`regionsBefore`）**同构**：可见性即触发（`onVisibleAreaChange`），
 *      **绝不做"点击展开"**（用户 2026-10-10 明确禁止；见 `components/MessageRow.ets` 的同款注释）。
 *   3. 纯函数 + **O(limit)**：渲染路径禁止 `filter`/`indexOf` 这类 O(N) 扫描
 *      （`docs/ARKTS-GOTCHAS.md §11`：渲染路径不能做与规模成正比的重复计算）。
 */
import { HistoryIteration } from './types';

/**
 * 行内块窗口上界 = 末尾渲染多少块（超出部分折叠为哨兵行）。
 *
 * 取值依据：真机实测窗口化后单行 ≈ `(24+1)×5.7 ≈ 143` 节点，落在单行预算 600 内且
 * 一屏通常只完整显示 1~2 块 ⇒ 24 块足以覆盖"滚动时不会看到哨兵"的常见情形。
 */
export const MSG_BLOCK_WINDOW: number = 24;

/** 每次放宽的批量（哨兵可见时一次放开这么多 —— **必须成批**，不能每次 +1）。 */
export const MSG_BLOCK_BATCH: number = 24;

/** 哨兵行高度（vp，**恒定**）：三态不改布局 ⇒ 不抖、滚动条长度不失真。
 *  与 `MessageRow.REGION_ROW_H` 同一门手艺（既有代码已验证的形态）。 */
export const MSG_BLOCK_SENTINEL_H: number = 28;

/** 单行的**布局预算**（节点数）：超它就意味着一次 measure/layout 要遍历过多节点。 */
export const MSG_ROW_NODE_BUDGET: number = 600;

/** 真机实测的「每块节点成本」（`fix-todos` 那行 23 块 ⇒ dump 132 节点）。用于规模估算。 */
export const NODES_PER_BLOCK: number = 5.7;

/**
 * 末尾 `limit` 块（`limit <= 0` ⇒ 全部；`limit >= n` ⇒ 全部）。**O(limit)**。
 * 返回**新数组**（ArkUI 需要值变化才能察觉 —— 见 `MessageRow` 的 `@State` 契约）。
 */
export function visibleBlocks(bs: HistoryIteration[], limit: number): HistoryIteration[] {
  if (limit <= 0 || bs.length <= limit) {
    return bs.slice();
  }
  return bs.slice(bs.length - limit);
}

/** 被折叠（隐藏）的块数。`limit <= 0`（无窗口）或 `limit >= n` ⇒ 0。 */
export function hiddenBlockCount(n: number, limit: number): number {
  return (limit > 0 && n > limit) ? n - limit : 0;
}

/** 这一行是否需要块级窗口（块数超过窗口上界 ⇒ 需要渲染哨兵）。 */
export function needsBlockWindow(n: number, limit: number): boolean {
  return hiddenBlockCount(n, limit) > 0;
}

/** 放宽一档（哨兵可见时调用）—— 封顶到 `n`（**不无限增长**）；`batch <= 0` ⇒ 不动。 */
export function widenBlocks(limit: number, n: number, batch: number = MSG_BLOCK_BATCH): number {
  if (batch <= 0) {
    return limit;
  }
  const next: number = limit + batch;
  return next > n ? n : next;
}

/** 某块数在窗口化后的**估算节点数**（含 1 行哨兵）—— 用于预算断言/度量。 */
export function estimatedNodes(n: number, limit: number): number {
  const shown: number = (limit > 0 && n > limit) ? limit : n;
  const sentinel: number = needsBlockWindow(n, limit) ? 1 : 0;
  return Math.round((shown + sentinel) * NODES_PER_BLOCK);
}
