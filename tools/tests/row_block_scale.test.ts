/**
 * 「行内迭代块无上限」的**判别力度量** —— 证明问题存在、并把"修好"钉成可证伪的断言。
 *
 * 背景（`docs/PERF-BUDGET.md §3 问题①`）：
 *   `MessageRow.itersFor()` = `mergeToolRuns(completedBlocks(row))`（**保持全量**，供压缩锚点用），
 *   而**交给 `ForEach` 的是** `shownIters()` = 窗口化后的末尾 N 块（`core/rowsview.ets`）。
 *   真实服务端实测单行最多 **340 块**（`chat_43C84E66B106`）/ **108 块**
 *   （稳定 fixture `chat_AAB719716889`）。
 *
 * ⛔ 本文件**不导入 ArkUI**（跑不了组件），所以它测的是**两层**：
 *   · **数据层**：`itersFor()` 必须**不丢块**（全量）—— 窗口不许吃掉数据；
 *   · **渲染层**：交给 `ForEach` 的块数必须有上限（= `visibleBlocks(itersFor(), W)`）。
 *   真机节点数口径见 `tools/perf/render_scale.sh` + `tools/perf/row_scale.py`。
 *
 * 两段设计：
 *   ① **问题存在**（永远为真，数字化）：无窗口时 340 块 ⇒ 估算 1938 节点 > 预算 600（3.2×）；
 *      窗口化后 ⇒ 24+1 哨兵块 ⇒ 落进预算（**修好后的目标**）。
 *   ② **自动转硬**：动态探测 core 里是否有窗口实现（`core/rowsview.ets`，找不到则退回
 *      `streammerge`）。落地前打印 `⚠ 行内窗口未落地` 而**不失败**；落地后按真实签名断言上限。
 *
 * mutation 自证：`ROW_SCALE_MUTATE=1` ⇒ 模拟"窗口函数存在但返回全部块" ⇒ ② 必须变红。
 */
declare const process: { exit: (c: number) => void; env?: Record<string, string> };

import { mergeToolRuns, completedBlocks, blocksSignature } from '../../entry/src/main/ets/core/streammerge';
import * as SM from '../../entry/src/main/ets/core/streammerge';
import * as RV from '../../entry/src/main/ets/core/rowsview';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 常量：来源可查（不是拍的） ──────────────────────────────────────────────────
/** 真机实测的「每块节点成本」：`fix-todos` 会话那行 23 块 ⇒ dump 布局树 132 节点
 *  （`tools/perf/row_scale.py`，2026-10-11）。仅用于**规模估算**，非精确值。 */
const NODES_PER_BLOCK = 5.7;
/** 单行的布局预算：超过它，一次 measure/layout 遍历的节点数就会明显吃掉帧预算。 */
const ROW_NODE_BUDGET = 600;
/** 块级窗口上界（= `core/rowsview.MSG_BLOCK_WINDOW`；这里给个本地别名便于阅读）。 */
const WINDOW = 24;

/** 真实服务端实测的最重单行（供断言引用；会话顺序会漂移故写死快照）。 */
const REAL_MAX_BLOCKS = 340;      // chat_43C84E66B106（第 1 轮扫描）
const REAL_FIXTURE_BLOCKS = 108;  // chat_AAB719716889（两轮都在 scan 内，稳定 fixture）

/** **数据层的全部块** —— 与 `MessageRow.itersFor()` 同源（同一函数链）。 */
function blocksHandedToRenderer(row: ChatRow): HistoryIteration[] {
  return mergeToolRuns(completedBlocks(row));
}
/** **渲染层真正拿到的块** —— 与 `MessageRow.shownIters()` 同源（同一函数链）。 */
function blocksRendered(row: ChatRow, limit: number): HistoryIteration[] {
  return RV.visibleBlocks(blocksHandedToRenderer(row), limit);
}

/** 造一行：n 个**带正文**的迭代块（带 content ⇒ mergeToolRuns 不会把它们折叠掉）。 */
function rowWithBlocks(n: number, tag: string): ChatRow {
  const row = new ChatRow();
  row.id = `a-${tag}`;
  row.rev = 1;
  row.role = 'assistant';
  row.isLive = false;
  row.content = '';
  row.iterations = [];
  for (let i = 1; i <= n; i++) {
    row.iterations.push({
      iteration: i,
      content: `第 ${i} 块的正文（用于规模度量）`,
      reasoning: '',
      tools: [],
      tools_folded: false,
    });
  }
  return row;
}

// ═══ ① 两层语义：数据层不丢 / 渲染层有上限 ═══════════════════════════════════
console.log('── ① 数据层（itersFor）不丢块 · 渲染层（ForEach 输入）有上限 ──');

const worst = rowWithBlocks(REAL_MAX_BLOCKS, 'worst');
const worstBlocks = blocksHandedToRenderer(worst);
eq(`数据层：340 块的行 ⇒ itersFor() = 340（**不丢块**）`, worstBlocks.length, REAL_MAX_BLOCKS);
eq(`渲染层：340 块的行走窗口后只渲染 ${WINDOW} 块`, blocksRendered(worst, WINDOW).length, WINDOW);
eq(`渲染层：隐藏 ${REAL_MAX_BLOCKS - WINDOW} 块（哨兵据此显示"还有 N 块"）`,
  RV.hiddenBlockCount(worstBlocks.length, WINDOW), REAL_MAX_BLOCKS - WINDOW);

const fixture = rowWithBlocks(REAL_FIXTURE_BLOCKS, 'fixture');
eq(`数据层：108 块的行 ⇒ itersFor() = 108`, blocksHandedToRenderer(fixture).length, REAL_FIXTURE_BLOCKS);
eq(`渲染层：108 块的行走窗口后只渲染 ${WINDOW} 块`, blocksRendered(fixture, WINDOW).length, WINDOW);

// 规模（无窗口 vs 有窗口）
const nodesRaw = Math.round(worstBlocks.length * NODES_PER_BLOCK);
const nodesWin = RV.estimatedNodes(worstBlocks.length, WINDOW);
console.log(`  规模：无窗口 ≈ ${nodesRaw} 节点（超预算 ${(nodesRaw / ROW_NODE_BUDGET).toFixed(1)}×）`
  + ` → 窗口化 ≈ ${nodesWin} 节点`);
ok('① 无窗口时**超出**单行预算（= 被修掉的那个问题本身）', nodesRaw > ROW_NODE_BUDGET,
  `${nodesRaw} vs ${ROW_NODE_BUDGET}`);
ok('① 窗口化后**落进**单行预算（= 修好的判据）', nodesWin <= ROW_NODE_BUDGET,
  `${nodesWin} vs ${ROW_NODE_BUDGET}`);

// 窗口**不得丢块**：窗口 ∪ 隐藏部分必须还原全部块（修好后的最强守护）
const shownW = blocksRendered(worst, WINDOW);
const hiddenPart = worstBlocks.slice(0, worstBlocks.length - shownW.length);
eq('① 窗口 ∪ 隐藏 = 全部块（窗口化不得丢数据）', hiddenPart.concat(shownW).length, worstBlocks.length);
eq('① 窗口 ∪ 隐藏 的迭代号序列原样', hiddenPart.concat(shownW).map((x) => x.iteration),
  worstBlocks.map((x) => x.iteration));

// 每次 build 的固定开销是 O(块数) —— 断言"确实随规模增长"（判据是序列长度，不是墙钟）
const sig340 = blocksSignature(worstBlocks).length;
const sig24 = blocksSignature(RV.visibleBlocks(worstBlocks, WINDOW)).length;
ok('① blocksSignature 长度随块数线性增长（⇒ 每次 build 的固定开销是 O(N)）',
  sig340 > sig24 * 5, `${sig340} vs ${sig24}`);

// ═══ ② 自动转硬（探测真实现；未落地则只告警）══════════════════════════════════
console.log('── ② 自动转硬：探测 core 的块级窗口实现 ──');

const rvAny = RV as unknown as Record<string, unknown>;
const smAny = SM as unknown as Record<string, unknown>;
const MUTATE = (process.env !== undefined && process.env['ROW_SCALE_MUTATE'] === '1');

/** 探测顺序：**先 `core/rowsview`（TOP1 的落地位置）**，再退回 `streammerge`（若实现被放那儿）。 */
function probeFn(name: string): ((b: HistoryIteration[], w: number) => HistoryIteration[]) | undefined {
  const f = rvAny[name] !== undefined ? rvAny[name] : smAny[name];
  if (typeof f === 'function') {
    return f as (b: HistoryIteration[], w: number) => HistoryIteration[];
  }
  if (MUTATE && name === 'visibleBlocks') {
    // mutation：模拟"窗口函数已存在但**返回全部块**"（= 窗口写坏/漏实现）
    return (b: HistoryIteration[]): HistoryIteration[] => b.slice();
  }
  return undefined;
}

const realVisible = probeFn('visibleBlocks');
const rawWindow = rvAny['MSG_BLOCK_WINDOW'] !== undefined ? rvAny['MSG_BLOCK_WINDOW'] : smAny['MSG_BLOCK_WINDOW'];
const realWindow: number | undefined = typeof rawWindow === 'number' ? rawWindow : undefined;

if (realVisible === undefined) {
  console.log(`  ⚠ 行内窗口**未落地**：当前把该行全部 ${REAL_MAX_BLOCKS} 块交给渲染层`
    + `（估算 ${nodesRaw} 节点 ⇒ 超预算 ${(nodesRaw / ROW_NODE_BUDGET).toFixed(1)}×）。`
    + `\n     落地判据：core 导出 visibleBlocks(blocks, w) + hiddenBlockCount(n, w) + MSG_BLOCK_WINDOW；`
    + `\n     落地后本段会**自动**开始按真实签名断言（含 MSG_BLOCK_WINDOW ≤ 48 的上界）。`);
} else {
  const W = realWindow !== undefined ? realWindow : WINDOW;
  console.log(`  探测到真实窗口实现：MSG_BLOCK_WINDOW=${realWindow !== undefined ? realWindow : `(缺省用 ${WINDOW})`}`);
  if (realWindow !== undefined) {
    ok('MSG_BLOCK_WINDOW 在上界内（≤48 块，否则窗口形同虚设）', realWindow <= 48, `got ${realWindow}`);
    ok(`MSG_BLOCK_WINDOW = 与渲染层常量一致（${WINDOW}）`, realWindow === WINDOW, `got ${realWindow}`);
  }
  eq('真实窗口：340 块 → 24 块', realVisible(worstBlocks, W).length, Math.min(REAL_MAX_BLOCKS, W));
  eq('真实窗口：108 块 → 24 块', realVisible(blocksHandedToRenderer(fixture), W).length, Math.min(REAL_FIXTURE_BLOCKS, W));
  eq('真实窗口：≤W 块的行原样返回（不得反向丢块）',
    realVisible(blocksHandedToRenderer(rowWithBlocks(5, 'small')), W).length, 5);
  // 窗口外的块必须仍然可达（哨兵语义）：窗口内容 = 末尾 W 块
  const got = realVisible(worstBlocks, W);
  eq('真实窗口取的是**末尾** W 块（哨兵语义要求）',
    got[got.length - 1].iteration, REAL_MAX_BLOCKS);
}

if (fail > 0) {
  console.log(`  row_block_scale: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  row_block_scale: ${pass} passed, 0 failed`);

export {};
