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
import { listItemCount, nextFollowBottom, shouldAutoScroll, followSuppressUntil, FOLLOW_SUPPRESS_MS, markUserScrollFrame, followAfterScrollStop } from '../../entry/src/main/ets/core/listfollow';

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

describe('shouldAutoScroll：程序滚到底的三条闸门（真机 P0：点工具 pill 被拽到最下方）', () => {
  // ④ 正常流式：跟随 + 内容增长 + 无抑制 ⇒ **必须**滚（不能为了修 bug 把"跟随"弄没）
  it('④ 流式新增（三条都满足）⇒ 滚', () => {
    eq('无抑制窗（0）', shouldAutoScroll(true, true, 1000, 0), true);
    eq('抑制窗已过', shouldAutoScroll(true, true, 2000, 1500), true);
  });

  // ① 用户已往上滚（意图 false）⇒ 任何情况都不许抢滚动位置
  it('① 用户已往上滚 ⇒ 不滚（即使内容在长）', () => {
    eq('', shouldAutoScroll(false, true, 1000, 0), false);
  });

  // ② 纯 UI 状态变更（行指纹未变：选中/浮层/位置快照类）⇒ 不滚
  it('② 内容没变（纯 UI 状态变更）⇒ 不滚', () => {
    eq('', shouldAutoScroll(true, false, 1000, 0), false);
  });

  // ③ ⭐ 本次 P0 的判据：用户自己点开工具 ⇒ 这一帧内容确实变了（rev 自增）、followBottom 也是 true，
  //    但**变化是他造成的** ⇒ 抑制窗内不许滚（否则展开后更高的卡片把他刚点的 pill 顶出视口）。
  it('③ 用户就地展开工具后的抑制窗内 ⇒ 不滚（P0 修复判据）', () => {
    const t0: number = 1000;
    const until: number = followSuppressUntil(t0, FOLLOW_SUPPRESS_MS);
    eq('窗口 = now + FOLLOW_SUPPRESS_MS', until, t0 + FOLLOW_SUPPRESS_MS);
    eq('刚点下（t=now）', shouldAutoScroll(true, true, t0, until), false);
    eq('窗口内（t=until-1）', shouldAutoScroll(true, true, until - 1, until), false);
    eq('左闭右开：t=until 恢复跟随', shouldAutoScroll(true, true, until, until), true);
  });

  // 反例（旧实现的等价式）：只看 followBottom ⇒ 在"点 pill"这一帧判成"滚" ⇒ 正是 P0
  it('反例：旧实现（只看 followBottom）在同一帧判成"滚"', () => {
    const followBottom: boolean = true;
    const oldImplRolls: boolean = followBottom;                      // 旧代码：if (this.followBottom)
    const newImplRolls: boolean = shouldAutoScroll(true, true, 1000, followSuppressUntil(1000, FOLLOW_SUPPRESS_MS));
    eq('旧实现 = 滚（P0 行为）', oldImplRolls, true);
    eq('新判据 = 不滚（修复行为）', newImplRolls, false);
  });
});

// ── ⛔ 用户滚动意图标志：**只置位、不清位**（用户 2026-10-11 亲报「流式时滚不动」）──────
// 流式期间每帧都有程序滚动（`shouldAutoScroll` 命中 ⇒ `scrollEdge(Edge.Bottom)`，
// 打字机/工具 pill 每 ~50ms 长大一次）。用户上滑的帧序：
//   ① onWillScroll(DRAG) → 置位；② **onScrollIndex 之前**来一次流式程序滚动
//   → 旧写法在此清位 ⇒ ③ onScrollIndex 读到 userDriven=false ⇒ followBottom 恒 true
//   ⇒ 自动滚动继续把视角拽回底部 ⇒ 用户根本滚不动。
describe('markUserScrollFrame（只置位、不清位）', () => {
  it('★ 用户帧 ⇒ 置位；程序帧 ⇒ **不清位**', () => {
    eq('用户帧：false → true', markUserScrollFrame(false, true), true);
    eq('程序帧**不得**清掉用户刚置的位（核心修复）', markUserScrollFrame(true, false), true);
    eq('程序帧且无在途意图 ⇒ 仍 false', markUserScrollFrame(false, false), false);
  });

  it('★ 连来 N 个程序帧也吞不掉用户意图（用户上滑不会被拽回底部）', () => {
    let pending: boolean = markUserScrollFrame(false, true);   // 用户 DRAG
    for (let i = 0; i < 100; i++) {
      pending = markUserScrollFrame(pending, false);           // 流式自动滚动帧 ×100
    }
    eq('100 个程序帧后仍为 true（等 onScrollIndex 消费）', pending, true);
  });

  it('★ 与 nextFollowBottom 串联：用户上滑 ⇒ followBottom 真的翻掉', () => {
    // 帧序：用户上滑 → 流式程序帧 → onScrollIndex（end < 末项）
    let pending: boolean = markUserScrollFrame(false, true);
    pending = markUserScrollFrame(pending, false);              // 旧写法在这里归零 ⇒ 修复点
    const userDriven: boolean = pending;
    pending = false;                                            // onScrollIndex 一次性消费
    const next: boolean = nextFollowBottom(true, userDriven, 3, 10);
    eq('userDriven 被保住 ⇒ followBottom 翻成 false', next, false);
    eq('标志已复位（不泄漏到后续程序帧）', pending, false);
  });

  it('反例：旧实现（无条件赋值）在同一帧序下丢意图（P0 行为）', () => {
    let old: boolean = false;
    old = true;                                                 // ① onWillScroll(DRAG)
    old = false;                                                // ② onWillScroll(SCROLLER) —— 旧写法无条件赋值
    eq('旧实现：userDriven=false（意图被吃掉）', old, false);
    eq('旧实现：followBottom 保持 true ⇒ 被拽回底部', nextFollowBottom(true, old, 3, 10), true);
  });
});

// ── 用户 2026-10-12 真机亲报：「思考中数字滚动的时候，用户滚开会立马被拉回最下方」──────────
// 根因：`userScrollFrame` 是**单布尔**，**任一** `onScrollIndex` 都会消费它；流式期间程序滚动
//   （`scrollEdge(Bottom)`）与用户拖动**交错** ⇒ 程序滚动的索引回调**抢先消费**用户刚置的 flag，
//   且此刻 `end` 恰为 `itemCount-1` ⇒ `nextFollowBottom` 把 `followBottom` 判回 `true`
//   ⇒ 自动滚动继续 ⇒ 用户被拽回底部。
// 修复（页 `pages/Index.ets`）：① 用户帧在 `onWillScroll` **立即** `followBottom=false`
//   （web `pauseFollowing()`：与方向/位置无关）；② `onScrollIndex` 只在 `lastScrollWasUser`
//   时判定恢复（程序帧**绝不**改写意图）；③ 30ms 延迟程序滚动派发后**复查** `followBottom`。
describe('程序滚动抢 flag 的竞态（2026-10-12 真机缺陷）', () => {
  it('旧行为复现：程序回调抢先消费 flag 且 end 在底部 ⇒ 被判回 true（用户被拽回）', () => {
    let pending: boolean = markUserScrollFrame(false, true);          // ① 用户上滑
    // ② 程序滚动的 onScrollIndex 抢先到达（此刻视图被钉在底部：end === itemCount-1）
    const userDriven: boolean = pending;                             // 旧：单布尔，程序回调也消费
    pending = false;
    eq('旧行为：followBottom 被判回 true（拽回底部）', nextFollowBottom(true, userDriven, 9, 10), true);
  });

  it('★ 修复：用户帧**立即暂停** ⇒ 程序帧不再置回；用户滚回底部才恢复', () => {
    let follow = true;
    // ① 用户上滑 ⇒ onWillScroll(user) **立即**暂停（不等索引回调按位置算）
    follow = false;
    let pending: boolean = markUserScrollFrame(false, true);
    // ② 程序滚动帧：lastScrollWasUser=false ⇒ 索引回调**不判定** ⇒ 保持暂停
    const lastScrollWasUser = false;
    const userDriven = pending && lastScrollWasUser;
    pending = false;
    eq('程序帧：userDriven=false（不判定）', userDriven, false);
    eq('程序帧不改写意图 ⇒ 保持暂停（用户**不被**拽回）', follow, false);
    // ③ 用户把列表滚回底部（用户帧）⇒ 恢复跟随（web `checkBottomAndResume()` 同义）
    eq('用户滚回底部 ⇒ 恢复跟随', nextFollowBottom(follow, true, 9, 10), true);
    // ④ 用户只是往上滚、未到底（用户帧）⇒ 仍暂停
    eq('用户未到底 ⇒ 仍暂停', nextFollowBottom(false, true, 3, 10), false);
  });
});

// ── 滚回底部「回到最新」药丸复位（2026-10-12 用户真机亲报）──────────────────────────
// 真机复现：上滑回历史（药丸出现）→ 滑回**末项**停手，药丸**仍在**（列表已贴底）。
// 根因：`onWillScroll` 对每个用户帧置 `followBottom=false`（含贴底的**回弹/惯性帧**），
//   而 `onScrollIndex` **只在可见索引区间变化**时回调 ⇒ 末帧"已贴底但索引未变"无人复位。
// 修法：`onScrollStop` + `Scroller.isAtEnd()`（**位置**判据，与索引区间无关）⇒ `followAfterScrollStop`。
// 判别力（mutation）：把 `followAfterScrollStop` 改成恒 `return prev` ⇒ 第 ① 条立即红。
describe('滚回底部 ⇒ 「回到最新」药丸复位（2026-10-12 用户真机亲报）', () => {
  it('贴底停止 ⇒ 恢复跟随（药丸消失）；停在中途 ⇒ 保持用户意图', () => {
    // ① 复现场景：用户滚回最底部停手 ⇒ 必须恢复跟随（否则药丸常驻）
    eq('贴底停止 ⇒ 恢复跟随（药丸消失）', followAfterScrollStop(false, true), true);
    // ② 反向：用户刻意停在中途（未贴底）⇒ ⛔ 不得被拽回底部、药丸保留
    eq('未贴底停止 ⇒ 保持暂停（药丸保留）', followAfterScrollStop(false, false), false);
    // ③ 已在跟随 ⇒ 不因停止滚动而反转
    eq('跟随时贴底停止 ⇒ 仍跟随', followAfterScrollStop(true, true), true);
    eq('跟随时未贴底停止 ⇒ 保持跟随意图', followAfterScrollStop(true, false), true);
  });
});

// ── 恢复跟随必须用精确位置判据（`Scroller.isAtEnd()`），索引判据会"人机对抗"（2026-10-12）──
// 真机场景：**流式**期间末项 = 在飞 live 行（思考 + 打字机正文），可**高到占满整个视口**
//   ⇒ 用户在该行**内部**往上滚时 `end === itemCount-1` 仍成立（末项始终可见）
//   ⇒ 索引判据误判"已回底" ⇒ 恢复跟随 ⇒ 自动滚动把用户**强行拉回底部**（用户亲报的"人机对抗"）。
//   `isAtEnd()` 判的是**偏移量到底**、与"末项是否可见"无关 ⇒ 只有真滚到底才恢复。
// 判别力（mutation）：删掉 `if (atEnd !== undefined) return atEnd;`（恒走索引判据）⇒ 第 ① 条红。
describe('恢复跟随用精确位置判据 isAtEnd（索引判据在"高 live 行"下会误判 ⇒ 人机对抗）', () => {
  it('① 末项可见但**未**真滚到底 ⇒ ⛔ 不得恢复跟随', () => {
    eq('索引判据说"到底"、位置说"没到底" ⇒ 不恢复（防人机对抗）',
      nextFollowBottom(false, true, 9, 10, false), false);
  });
  it('② 真的滚到底（isAtEnd()=true）⇒ 恢复跟随', () => {
    eq('位置判据说"到底" ⇒ 恢复', nextFollowBottom(false, true, 4, 10, true), true);
  });
  it('③ 程序滚动（userDriven=false）⇒ 无论位置如何都不改写用户意图', () => {
    eq('程序帧 + 到底 ⇒ 保持 prev=false', nextFollowBottom(false, false, 9, 10, true), false);
    eq('程序帧 + 未到底 ⇒ 保持 prev=true', nextFollowBottom(true, false, 3, 10, false), true);
  });
  it('④ 无 scroller（省略 atEnd）⇒ 回退索引判据（旧行为/回归用例不变）', () => {
    eq('省略 atEnd、末项可见 ⇒ 索引判据 true', nextFollowBottom(false, true, 9, 10), true);
    eq('省略 atEnd、未到底 ⇒ 暂停', nextFollowBottom(false, true, 3, 10), false);
  });
});

console.log(`  listfollow: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
