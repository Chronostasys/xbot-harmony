/**
 * 行内块窗口（`core/rowsview.ets`）的判别力测试 —— 性能审计 TOP1 的守护。
 *
 * 契约来源：`docs/PERF-BUDGET.md §3 问题①`（单行最重 **340 块** ⇒ 估算 1938 节点，超预算 3.2×）。
 *
 * 四条断言 + 一段 mutation：
 *   ① 有上限：`visibleBlocks(340, 24)` 输 24 块，且 `hiddenBlockCount > 0`
 *   ② **不丢内容**：`visibleBlocks ⊕ 隐藏部分` 必须还原**全部**块的迭代号序列
 *   ③ 边界：limit = 0 / 负数 / ≥n / 恰好 n / 1
 *   ④ 放宽：`widenBlocks` 必须**封顶到 n**（不无限增长）且 batch ≤ 0 不动
 *   mutation（`ROWSVIEW_MUTATE=1`）：把上限换成"无上限" ⇒ ① 必须**真红**
 *             （证明这条断言不是恒绿的装饰）
 */
declare const process: { exit: (c: number) => void; env?: Record<string, string> };

import {
  visibleBlocks, hiddenBlockCount, needsBlockWindow, widenBlocks, estimatedNodes,
  MSG_BLOCK_WINDOW, MSG_BLOCK_BATCH, MSG_ROW_NODE_BUDGET,
} from '../../entry/src/main/ets/core/rowsview';
import { HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 造 n 个可辨认的块（iteration = 1..n）。 */
function blocks(n: number): HistoryIteration[] {
  const a: HistoryIteration[] = [];
  for (let i = 1; i <= n; i++) {
    a.push({ iteration: i, content: `第${i}块`, reasoning: '', tools: [], tools_folded: false });
  }
  return a;
}

// mutation 开关：模拟"上限被取消"（= 回到改动前的行为）
const MUTATE = (process.env !== undefined && process.env['ROWSVIEW_MUTATE'] === '1');
function limitUnderTest(limit: number): number {
  return MUTATE ? Number.MAX_SAFE_INTEGER : limit;
}

const REAL_MAX_BLOCKS = 340;      // chat_43C84E66B106（真实服务端实测最重单行）
const REAL_FIXTURE_BLOCKS = 108;  // chat_AAB719716889（稳定 fixture）

// ── ① 有上限 ──────────────────────────────────────────────────────────────────
const all340 = blocks(REAL_MAX_BLOCKS);
const shown340 = visibleBlocks(all340, limitUnderTest(MSG_BLOCK_WINDOW));
eq('① 340 块的行走窗口后只渲染 24 块', shown340.length, MSG_BLOCK_WINDOW);
ok('① hiddenBlockCount(340, 24) > 0（必有"还有 N 块"的可见提示）',
  hiddenBlockCount(all340.length, limitUnderTest(MSG_BLOCK_WINDOW)) > 0,
  `got ${hiddenBlockCount(all340.length, limitUnderTest(MSG_BLOCK_WINDOW))}`);
eq('① 隐藏块数 = 总数 - 窗口',
  hiddenBlockCount(all340.length, limitUnderTest(MSG_BLOCK_WINDOW)), REAL_MAX_BLOCKS - MSG_BLOCK_WINDOW);
ok('① needsBlockWindow(340, 24) = true', needsBlockWindow(all340.length, limitUnderTest(MSG_BLOCK_WINDOW)));

// 稳定 fixture（108 块）同样成立
eq('① 108 块 → 24 块', visibleBlocks(blocks(REAL_FIXTURE_BLOCKS), limitUnderTest(MSG_BLOCK_WINDOW)).length, MSG_BLOCK_WINDOW);

// 预算：窗口化后必须落进单行预算
ok(`① 窗口化后估算节点 ${estimatedNodes(REAL_MAX_BLOCKS, MSG_BLOCK_WINDOW)} ≤ 预算 ${MSG_ROW_NODE_BUDGET}`,
  estimatedNodes(REAL_MAX_BLOCKS, MSG_BLOCK_WINDOW) <= MSG_ROW_NODE_BUDGET);
ok('① 反证：无窗口时估算节点**超**预算（这就是问题本身）',
  estimatedNodes(REAL_MAX_BLOCKS, 0) > MSG_ROW_NODE_BUDGET,
  `${estimatedNodes(REAL_MAX_BLOCKS, 0)} vs ${MSG_ROW_NODE_BUDGET}`);

// ── ② 不丢内容（最强守护）────────────────────────────────────────────────────
const shown = visibleBlocks(all340, limitUnderTest(MSG_BLOCK_WINDOW));
const hidden = all340.slice(0, all340.length - shown.length);   // 被折叠的前段（界面显示为哨兵）
const union = hidden.concat(shown);
eq('② 窗口 ∪ 隐藏 = 全部块（**不得丢内容**）', union.length, all340.length);
eq('② 迭代号序列原样（顺序/不重不漏）', union.map((x) => x.iteration), all340.map((x) => x.iteration));
eq('② 窗口取的是**末尾** 24 块（末块号 = n）', shown.length > 0 ? shown[shown.length - 1].iteration : -1, REAL_MAX_BLOCKS);
// ⚠️ 必须防越界：mutation（取消上限）时 `hidden` 为空 ⇒ 直接取 [0] 会抛异常，
//    那样"变红"就变成"崩溃"，会把同一段里**其它**断言的结论一起吞掉（定位更难）。
eq('② 隐藏段是**最前面**的一段（首块号 = 1）', hidden.length > 0 ? hidden[0].iteration : -1, 1);

// ── ③ 边界 ────────────────────────────────────────────────────────────────────
if (!MUTATE) {
  eq('③ limit=0 ⇒ 全部（语义=不启用窗口）', visibleBlocks(all340, 0).length, REAL_MAX_BLOCKS);
  eq('③ limit=-5 ⇒ 全部（负值不得被当成"渲染 0 块"）', visibleBlocks(all340, -5).length, REAL_MAX_BLOCKS);
  eq('③ limit≥n ⇒ 全部', visibleBlocks(all340, 400).length, REAL_MAX_BLOCKS);
  eq('③ limit=n ⇒ 全部', visibleBlocks(all340, REAL_MAX_BLOCKS).length, REAL_MAX_BLOCKS);
  eq('③ limit=1 ⇒ 末尾 1 块', visibleBlocks(all340, 1).length, 1);
  eq('③ 空列表 ⇒ 空（不崩）', visibleBlocks(blocks(0), 24).length, 0);
  eq('③ hiddenBlockCount(0, 24) = 0', hiddenBlockCount(0, 24), 0);
  eq('③ hiddenBlockCount(340, 400) = 0（limit≥n ⇒ 不隐藏）', hiddenBlockCount(REAL_MAX_BLOCKS, 400), 0);
  eq('③ hiddenBlockCount(340, 0) = 0（未启用窗口 ⇒ 不隐藏）', hiddenBlockCount(REAL_MAX_BLOCKS, 0), 0);
  ok('③ needsBlockWindow(24, 24) = false（恰好等于窗口 ⇒ 不需要哨兵）',
    !needsBlockWindow(MSG_BLOCK_WINDOW, MSG_BLOCK_WINDOW));
  // 返回新数组（ArkUI 需要"值变化"才能察觉 —— 不能直接返回入参引用）
  const src = blocks(5);
  ok('③ 返回新数组（不是同一引用）', visibleBlocks(src, 0) !== src);
}

// ── ④ 放宽（哨兵可见时）──────────────────────────────────────────────────────
if (!MUTATE) {
  eq('④ widen: 24 → 48', widenBlocks(MSG_BLOCK_WINDOW, REAL_MAX_BLOCKS), MSG_BLOCK_WINDOW + MSG_BLOCK_BATCH);
  eq('④ widen **封顶到 n**（不无限增长）', widenBlocks(REAL_MAX_BLOCKS - 5, REAL_MAX_BLOCKS), REAL_MAX_BLOCKS);
  eq('④ widen 在 n 处不动', widenBlocks(REAL_MAX_BLOCKS, REAL_MAX_BLOCKS), REAL_MAX_BLOCKS);
  eq('④ batch=0 ⇒ 不动（防死循环）', widenBlocks(MSG_BLOCK_WINDOW, REAL_MAX_BLOCKS, 0), MSG_BLOCK_WINDOW);
  eq('④ batch<0 ⇒ 不动', widenBlocks(MSG_BLOCK_WINDOW, REAL_MAX_BLOCKS, -3), MSG_BLOCK_WINDOW);
  eq('④ 恰好差 1 块 ⇒ 放宽后 = n', widenBlocks(REAL_MAX_BLOCKS - 1, REAL_MAX_BLOCKS), REAL_MAX_BLOCKS);
}

if (fail > 0) {
  console.log(`  rowsview: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  rowsview: ${pass} passed, 0 failed`);
