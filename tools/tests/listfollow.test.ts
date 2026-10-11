/**
 * 「是否跟随到底部」判据的**判别力测试**（真机 P0：点工具 pill 被拽到最下方，2026-10-11）。
 *
 * 判别力从哪来（每条断言都要能"红了才算有用"）：
 *  · 把 `nextFollowBottom` 改成旧的"位置快照"写法（用户输入与非用户输入一视同仁）⇒ ①②④ 立即红；
 *  · 把 `listItemCount` 的头项判据退回 `hasMore || loadingMore`（丢掉 `hiddenRowCount>0`）⇒ ⑤ 立即红；
 *  · 把 `if (!userDriven) return prev` 删掉 ⇒ ② 红（程序滚动会清掉用户"往上滚"的意图）。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { listItemCount, nextFollowBottom } from '../../entry/src/main/ets/core/listfollow';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  try {
    expect(got).toBe(want);
    pass++;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

/** 便捷：用户输入的一帧。 */
function user(prev: boolean, end: number, n: number): boolean {
  return nextFollowBottom(prev, true, end, n);
}

/** 便捷：**程序滚动 / 内容钳位**的一帧（`scrollEdge(Bottom)` 自身、LazyForEach 增删引起的回调）。 */
function prog(prev: boolean, end: number, n: number): boolean {
  return nextFollowBottom(prev, false, end, n);
}

describe('nextFollowBottom：程序滚动绝不改写用户意图（① ②）', () => {
  // ① 项数变小 ⇒ 陈旧的 end 会突然满足 end >= n-1；**非用户输入**必须拒绝改判
  it('① 内容变短（陈旧的 end 落在新末项上）不得把 false 翻成 true', () => {
    eq('busy 占位符消失：end=5, n 由 7→6（end == n-1）', prog(false, 5, 6), false);
    eq('live 行折叠：end=5, n 由 7→5', prog(false, 5, 5), false);
    eq('行窗口放开后钳位到末项：end=11, n=12', prog(false, 11, 12), false);
  });

  // ② scrollEdge(Bottom) 自身会回调一次 onScrollIndex（end == n-1）——那一次不能把"往上滚"清掉
  it('② scrollEdge(Bottom) 触发的那一次回调不得把"用户往上滚"清掉', () => {
    eq('程序滚到底（end == n-1）⇒ 保持 false（用户仍在读历史）', prog(false, 9, 10), false);
    eq('程序滚到底（end 比 n-1 还大，越界）⇒ 仍保持 false', prog(false, 12, 10), false);
  });
});

describe('nextFollowBottom：跟随该跟随的（③ ④）', () => {
  // ③ 用户在真底部时，新内容到达（程序事件）⇒ 必须仍然跟随（否则"看不到进度"，另一个 P0）
  it('③ 在底部时新内容到达 ⇒ 仍跟随', () => {
    eq('内容增长（end 掉到 n-2）⇒ 仍 true', prog(true, 3, 5), true);
    eq('内容增长（end 未变）⇒ 仍 true', prog(true, 4, 4), true);
    eq('n 增大 ⇒ 仍 true', prog(true, 4, 9), true);
  });

  // ④ 用户输入才翻转
  it('④ 只有用户输入能翻转', () => {
    eq('用户滚到末项可见 ⇒ true', user(false, 9, 10), true);
    eq('用户滚到末项之后（end 越界）⇒ true', user(false, 12, 10), true);
    eq('用户往上滚离末项（end = n-2）⇒ false', user(true, 8, 10), false);
    eq('用户在底部又滚了一下 ⇒ 仍 true', user(true, 9, 10), true);
    eq('空列表：保持原值（无从判断）', user(true, 0, 0), true);
    eq('空列表 + prev=false：保持 false', user(false, 0, 0), false);
  });
});

describe('listItemCount：头项判据必须与渲染它的 if 同源（⑤）', () => {
  it('⑤ 行窗口被截断时头项必须计入（否则项数少算 1 ⇒ 提前一项判成贴底）', () => {
    // 真实渲染条件：hasMore || loadingMore || hiddenRowCount > 0
    // —— 全量历史已加载（hasMore=false）但窗口被截断 ⇒ 头项**仍然存在**
    eq('无头项、无 busy、无 live：10 行 ⇒ 10', listItemCount(false, false, 10, 0), 10);
    eq('有头项：10 行 + 头项 ⇒ 11', listItemCount(true, false, 10, 0), 11);
    eq('头项 + busy 指示器 ⇒ 12', listItemCount(true, true, 10, 0), 12);
    eq('头项 + live 行 ⇒ 12', listItemCount(true, false, 10, 1), 12);
    eq('头项 + live + busy ⇒ 13', listItemCount(true, true, 10, 1), 13);
    eq('无头项 + live + busy ⇒ 12', listItemCount(false, true, 10, 1), 12);
    // 端到端形态：长会话（窗口截断、hasMore=false）+ live + busy
    //   真项数 13（含头项）⇒ 末项下标 12；旧公式漏算头项 = 12 ⇒ 末项下标 11
    // 后果：用户停在**倒数第二项**（end=11，其实没到底）——旧判据会判成"贴底"，
    //       于是下一次 store 变更（流式事件 / 点工具 pill 拉详情）就把他拽到最下方。
    const nTrue: number = listItemCount(true, true, 10, 1);   // 13
    const nOldBuggy: number = 10 + 1 + 1;                     // 12 = 旧公式（漏了头项）
    eq('真项数 = 13（头项算在内）', nTrue, 13);
    eq('旧公式 = 12（少算 1）', nOldBuggy, 12);
    eq('end=11 在真判据下**不是**贴底 ⇒ 不跟随', nextFollowBottom(false, true, 11, nTrue), false);
    eq('end=11 在旧判据下被误判贴底 ⇒ 会跟随（P0 成因）', nextFollowBottom(false, true, 11, nOldBuggy), true);
  });
});

console.log(`  listfollow: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
