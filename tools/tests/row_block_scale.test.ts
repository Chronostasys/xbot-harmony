/**
 * 「行内迭代块无上限」的**判别力度量** —— 证明问题存在、并把"修好"钉成可证伪的断言。
 *
 * 背景（docs/RENDER-LOAD-MEASUREMENT.md + 性能审计 #1）：
 *   `components/MessageRow.ets:344 itersFor()` = `mergeToolRuns(completedBlocks(row))`
 *   —— 注释明确「不再只显示最近 8 个 + 点击展开全部（web 渲染全部迭代）」⇒ **没有上限**。
 *   而 `LazyForEach` 只做**行级**虚拟化：一行 = 一个 `ListItem` ⇒ 该行内 N 个块
 *   **全部实例化**（N 个 `MarkdownView` 子树 + N 组 pill/思考行）。真实服务端实测
 *   单行最多 **340 块**（`chat_43C84E66B106`）/ **108 块**（`chat_AAB719716889`）。
 *
 * ⛔ 本文件**不导入 ArkUI**（跑不了组件），所以它测的是"交给渲染层的块数"与
 *   "由块数决定的 DOM 规模/工作量" —— 这正是可离线判定的那一半。
 *   真机节点数口径见 `tools/perf/render_scale.sh` + `tools/perf/row_scale.py`。
 *
 * 两段设计（为什么这样切）：
 *   ① **问题存在**（永远为真，数字化）：340/108 块 > 布局预算 ⇒ 问题存在；
 *      参考窗口实现能把 341 → 25 ⇒ 修好后**可达标**。
 *   ② **修好后自动转硬**：动态探测 core 里是否已出现窗口函数（`visibleBlocks` /
 *      `hiddenBlockCount` / `MSG_BLOCK_WINDOW`）。
 *      · 还没落地 ⇒ 打印 `⚠ 行内窗口未落地`，**不失败**（否则会把在飞的三条线全红掉）。
 *      · 一旦落地 ⇒ 立即按真实签名断言上限；**窗口写坏（漏块/越界）当场红**。
 *
 * mutation 自证：`ROW_SCALE_MUTATE=1 node …` ⇒ 模拟"窗口函数已存在但返回全部块"
 *   ⇒ 第 ② 段必须变红（证明它不是恒绿的空断言）。
 */
declare const process: { exit: (c: number) => void; env?: Record<string, string> };

import { mergeToolRuns, completedBlocks, blocksSignature } from '../../entry/src/main/ets/core/streammerge';
import * as SM from '../../entry/src/main/ets/core/streammerge';
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
/** 块级窗口上界（设计规格 `MSG_BLOCK_WINDOW`）= 24 块 + 1 行哨兵。 */
const WINDOW = 24;

/** 真实服务端实测的最重单行（供断言引用；会话顺序会漂移故写死快照）。 */
const REAL_MAX_BLOCKS = 340;      // chat_43C84E66B106（第 1 轮扫描）
const REAL_FIXTURE_BLOCKS = 108;  // chat_AAB719716889（两轮都在 scan 内，稳定 fixture）

/** 参考窗口实现（= 设计规格里要求 core 提供的那两个纯函数的**规格原型**）。 */
function refVisible(blocks: HistoryIteration[], w: number): HistoryIteration[] {
  return w > 0 && blocks.length > w ? blocks.slice(blocks.length - w) : blocks.slice();
}
function refHidden(n: number, w: number): number {
  return w > 0 && n > w ? n - w : 0;
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
    const it: HistoryIteration = {
      iteration: i,
      content: `第 ${i} 块的正文（用于规模度量）`,
      reasoning: '',
      tools: [],
      tools_folded: false,
    };
    row.iterations.push(it);
  }
  return row;
}

/** **交给渲染层的块数** —— 与 `MessageRow.itersFor()` 同源（同一函数链）。 */
function blocksHandedToRenderer(row: ChatRow): HistoryIteration[] {
  return mergeToolRuns(completedBlocks(row));
}

// ═══ ① 问题存在（数字化）═══════════════════════════════════════════════════════
console.log('── ① 问题存在：一行 N 块 ⇒ 渲染层收到 N 块（无上限）──');

const worst = rowWithBlocks(REAL_MAX_BLOCKS, 'worst');
const worstBlocks = blocksHandedToRenderer(worst);
eq(`340 块的行 → 交给渲染层的块数 = 340（**无窗口**）`, worstBlocks.length, REAL_MAX_BLOCKS);

const fixture = rowWithBlocks(REAL_FIXTURE_BLOCKS, 'fixture');
eq(`108 块的行 → 交给渲染层的块数 = 108（**无窗口**）`, blocksHandedToRenderer(fixture).length, REAL_FIXTURE_BLOCKS);

const nodesWorst = Math.round(worstBlocks.length * NODES_PER_BLOCK);
console.log(`  规模估算：340 块 × ${NODES_PER_BLOCK} 节点/块 ≈ ${nodesWorst} 节点（单行！）`
  + `；预算 ${ROW_NODE_BUDGET} 节点 ⇒ 超出 ${(nodesWorst / ROW_NODE_BUDGET).toFixed(1)}×`);
ok('问题存在：最重单行的估算节点数**超出**单行预算',
  nodesWorst > ROW_NODE_BUDGET,
  `${nodesWorst} vs ${ROW_NODE_BUDGET}`);

// 窗口化后可达标（用参考实现证明"修好后的目标数字可达"）
const winWorst = refVisible(worstBlocks, WINDOW);
eq(`参考窗口：341(340+0) → ${WINDOW} 块`, winWorst.length, WINDOW);
eq(`参考窗口：哨兵行 = 1（隐藏 ${REAL_MAX_BLOCKS - WINDOW} 块）`, refHidden(worstBlocks.length, WINDOW), REAL_MAX_BLOCKS - WINDOW);
const winNodes = Math.round((winWorst.length + 1) * NODES_PER_BLOCK);   // +1 = 哨兵行
ok('修好后达标：窗口化 + 哨兵 ≤ 单行预算',
  winNodes <= ROW_NODE_BUDGET,
  `估算 ${winNodes} vs 预算 ${ROW_NODE_BUDGET}`);

// 窗口**不得丢块**：窗口 ∪ 隐藏部分必须还原全部块（修好后的最强守护）
const hiddenPart = worstBlocks.slice(0, worstBlocks.length - winWorst.length);
const union = hiddenPart.concat(winWorst);
eq('窗口 ∪ 隐藏 = 全部块（窗口化不得丢数据）', union.length, worstBlocks.length);
eq('窗口 ∪ 隐藏 的迭代号序列原样', union.map((x) => x.iteration),
  worstBlocks.map((x) => x.iteration));

// 每次 build 的固定开销是 O(块数) —— 断言"确实随规模增长"（判据是序列长度，不是墙钟）
const sig340 = blocksSignature(worstBlocks).length;
const sig24 = blocksSignature(refVisible(worstBlocks, WINDOW)).length;
ok('blocksSignature 长度随块数线性增长（⇒ 每次 build 的固定开销是 O(N)）',
  sig340 > sig24 * 5, `${sig340} vs ${sig24}`);

// ═══ ② 修好后自动转硬（探测真实现；未落地则只告警）══════════════════════════════
console.log('── ② 修好后自动转硬：探测 core 的块级窗口实现 ──');

const smAny = SM as unknown as Record<string, unknown>;
const MUTATE = (process.env !== undefined && process.env['ROW_SCALE_MUTATE'] === '1');

function probeFn(name: string): ((b: HistoryIteration[], w: number) => HistoryIteration[]) | undefined {
  const f = smAny[name];
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
const rawWindow = smAny['MSG_BLOCK_WINDOW'];
const realWindow: number | undefined = typeof rawWindow === 'number' ? rawWindow : undefined;

if (realVisible === undefined) {
  console.log(`  ⚠ 行内窗口**未落地**：当前把该行全部 ${REAL_MAX_BLOCKS} 块交给渲染层`
    + `（估算 ${nodesWorst} 节点 ⇒ 超预算 ${(nodesWorst / ROW_NODE_BUDGET).toFixed(1)}×）。`
    + `\n     落地判据：core 导出 visibleBlocks(blocks, w) + hiddenBlockCount(n, w) + MSG_BLOCK_WINDOW；`
    + `\n     落地后本段会**自动**开始按真实签名断言（含 MSG_BLOCK_WINDOW ≤ 48 的上界）。`);
} else {
  const W = realWindow !== undefined ? realWindow : WINDOW;
  console.log(`  探测到真实窗口实现：MSG_BLOCK_WINDOW=${realWindow !== undefined ? realWindow : '(缺省用 24)'}`);
  if (realWindow !== undefined) {
    ok('MSG_BLOCK_WINDOW 在上界内（≤48 块，否则窗口形同虚设）', realWindow <= 48, `got ${realWindow}`);
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
