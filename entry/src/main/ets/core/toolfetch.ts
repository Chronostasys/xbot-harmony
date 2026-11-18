/**
 * 「按需取工具详情」的**目标解析**（纯逻辑，可脱机单测）。
 *
 * ⛔ 用户 2026-10-28：「折叠的 tool 点开不会自动加载」（`+N` 面板里点开仍「暂无详情」）。
 *   根因：`+N` 面板里的工具来自**合并块**（`mergeToolRuns`），合并进来的成员工具常常
 *   `iteration === undefined`（`ToolProgress.iteration` 是可选字段）。旧实现
 *   `want = detailIterationOf(toolIter, blockIter)` 直接拿**块头号**去拉 ⇒ 拉回来的是
 *   已经完整的那个迭代 ⇒ 目标那几枚永远空着（表现为"点了不加载"）。
 *   ⇒ 正确做法：**按工具名反查**该行里"确实缺详情"的那一枚，用**它自己的迭代号**去拉；
 *   反查不到才退回块号（宁可多拉一次，也不能"点了不加载"）。
 */

/** 内部形状（不导出：唯一消费者是本文件的 `detailTargets`）。 */
interface FetchToolLike {
  readonly name: string;
  readonly iteration?: number;
  readonly args?: string;
  readonly detail?: string;
}

interface FetchIterLike {
  readonly iteration: number;
  readonly tools?: readonly FetchToolLike[];
}

/** 该工具是否**缺详情**（`args` 与 `detail` 都空）。判据与 `core/toolmerge.toolNeedsDetail` 同义。 */
function lacksDetail(t: FetchToolLike): boolean {
  const a: string = t.args !== undefined && t.args !== null ? t.args : '';
  const d: string = t.detail !== undefined && t.detail !== null ? t.detail : '';
  return a.length === 0 && d.length === 0;
}

/**
 * 解析应当去拉详情的**迭代号列表**（当前实现最多 1 个）。
 *
 * 顺序：
 *   ① 工具自带号（`toolIter > 0`）⇒ 用它；
 *   ② 否则**按名字反查**第一个"缺详情"的迭代号；
 *   ③ 再否则退回 `fallbackIter`（块号）——宁可多拉一次，也不能"点了不加载"。
 */
export function detailTargets(iters: readonly FetchIterLike[], name: string,
  toolIter: number | undefined, fallbackIter: number): number[] {
  const own: number = toolIter !== undefined && toolIter !== null && toolIter > 0 ? toolIter : 0;
  if (own > 0) {
    // 自带号可用：但如果该迭代里这一枚**已经有详情** ⇒ 不必再拉（省一次请求）。
    for (let i = 0; i < iters.length; i++) {
      if (iters[i].iteration !== own) {
        continue;
      }
      const ts0: readonly FetchToolLike[] = iters[i].tools !== undefined && iters[i].tools !== null
        ? (iters[i].tools as readonly FetchToolLike[]) : [];
      let found: boolean = false;
      for (let k = 0; k < ts0.length; k++) {
        if (ts0[k].name !== name) {
          continue;
        }
        found = true;
        if (lacksDetail(ts0[k])) {
          return [own];
        }
      }
      return found ? [] : [own];
    }
    return [own];
  }
  for (let i = 0; i < iters.length; i++) {
    const ts: readonly FetchToolLike[] = iters[i].tools !== undefined && iters[i].tools !== null
      ? (iters[i].tools as readonly FetchToolLike[]) : [];
    for (let k = 0; k < ts.length; k++) {
      if (ts[k].name === name && lacksDetail(ts[k])) {
        return [iters[i].iteration];
      }
    }
  }
  return fallbackIter > 0 ? [fallbackIter] : [];
}
