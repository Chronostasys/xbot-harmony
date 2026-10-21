/**
 * render.ets —— 「块列表持有者」维护（`ChatRow.iterBlocks`，`@Observed`）。
 *
 * ⛔ 行源已是**模型**（`core/model_bridge.ets` 的 `applyModel`）：本模块只剩一个职责 ——
 *   把块列表 / 压缩点交给 `IterBlocks` 持有者，**只在引用真正变化时赋值** ⇒ 订阅它的
 *   `IterBlocksView`（内部 `ForEach(全部 N 块)`）零重建 ⇒ 每帧成本与块数 N 无关。
 *
 * 旧链路（`applyRow`：`deriveRows` 的 `Row` 判别联合 → `ChatRow`、`sameRowEssence`
 * 渲染等价比较、`inFlightBlock`/`liveIterations` 的在飞块折叠）已随
 * `docs/STATE-MODEL.md` §5 的删除清单**整批删除**（W3，2026-10-21）。
 */
import { ChatRow, HistoryIteration, IterBlocks } from './types';
import { WebCompaction } from './chattypes';
import { completedBlocks } from './streammerge';

/** 共享空压缩点列表（live/user 行无压缩点 ⇒ 零分配）。 */
const NO_COMPACTIONS: WebCompaction[] = [];

/**
 * 维护「已完成块列表」持有者（`ChatRow.iterBlocks`，`@Observed`）。
 *
 * ⛔ 判据/不变量（见 `docs/PERF-BOUNDS.md §3`）：**只在块列表/压缩点真正变化时赋值**。
 *   等价性是**引用判等**（`completedBlocks` 按源数组恒等记忆化）⇒ 没有字符串指纹、
 *   没有 O(N) 比较。
 */
function syncIterBlocks(row: ChatRow, blocks: HistoryIteration[], comps: WebCompaction[],
  turnID: number): void {
  const holder: IterBlocks = row.iterBlocks;
  // ⛔ 2026-10-21 **不吸收相邻纯工具迭代**（用户：「每个 tool 是一个单独的迭代」）：
  //   每个迭代一块、块号即界面上可见的号，归属与丢失一眼可判。
  const merged: HistoryIteration[] = blocks;
  if (holder.blocks !== merged) {
    holder.blocks = merged;
    holder.rev = holder.rev + 1;
  }
  if (holder.compactions !== comps) {
    holder.compactions = comps;
    holder.rev = holder.rev + 1;
  }
  if (holder.rowID !== row.id) {
    holder.rowID = row.id;
  }
  if (holder.turnID !== turnID) {
    holder.turnID = turnID;
  }
}

/** 页面 `liveBlocks` 的「空」哨兵（引用判等用；⛔ 不是容器，不要往里 push）。 */
export const EMPTY_BLOCKS: HistoryIteration[] = [];

/**
 * 供**桥接**复用：按行种类填充 `iterBlocks`。
 *
 * ⛔ 为什么必须调它：`row.iterBlocks` 是 `IterBlocksView` 的唯一数据源；桥接写完
 *   `row.iterations/completedBlocks` 后必须调一次，否则视图拿到空块列表 ⇒ **整屏空白**
 *   （真机实证）。live 行只交**已完成块**（在飞内容由页面 `liveText/liveReasoning/liveTools`
 *   从 `row.iterations` 末尾的 `live: true` 块派生）。
 */
export function syncRowBlocks(row: ChatRow, live: boolean, turnID: number): void {
  if (live) {
    syncIterBlocks(row, row.completedBlocks, NO_COMPACTIONS, turnID);
  } else {
    syncIterBlocks(row, completedBlocks(row), row.compactions, turnID);
  }
}
