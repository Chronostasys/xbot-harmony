/**
 * tools/perf/bench_core.ts —— 渲染/派生热路径的**确定性微基准**（离线，不碰设备）。
 *
 * 输出格式（每行一条，便于 `tools/perf/guard.sh` 解析并设阈值）：
 *   METRIC <name>=<value> <unit>
 *
 * 口径纪律：
 *   · 一律取 **min-of-N**（微基准里最小值最接近"无干扰真值"；均值会被宿主的编译/GC 抖动污染）。
 *   · 构造的输入规模**取自真实服务端实测**（单行 108 / 340 块，见
 *     `docs/RENDER-LOAD-MEASUREMENT.md` 与 `tools/perf/blocks_model.mjs`），不是拍的。
 *   · 只 import `core/**`（纯逻辑）—— 不 import 任何 ArkUI/组件，故可在 node 里真跑。
 *
 * 用法：bash tools/perf/bench_core.sh          （或 guard.sh）
 */
declare const process: {
  env?: Record<string, string>;
  exit: (c: number) => void;
  hrtime: { bigint: () => bigint };
};

import { paletteOf, effectsOf, surfacesOf, THEME_DARK } from '../../entry/src/main/ets/core/theme';
import {
  mergeTools, mergeToolRuns, completedBlocks, blocksSignature, buildBlocksSignature,
} from '../../entry/src/main/ets/core/streammerge';
import { parseMarkdown, parseMarkdownCached, parseInline, mdCacheStats } from '../../entry/src/main/ets/core/markdown';
import { runeCount, clipRunes } from '../../entry/src/main/ets/core/typewriter';
import { inFlightBlock } from '../../entry/src/main/ets/core/render';
import { springBezier, springParams } from '../../entry/src/main/ets/core/motion';
import {
  visibleBlocks as rvVisibleBlocks, hiddenBlockCount as rvHiddenBlockCount,
  estimatedNodes as rvEstimatedNodes, MSG_BLOCK_WINDOW, MSG_ROW_NODE_BUDGET,
} from '../../entry/src/main/ets/core/rowsview';
import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration, HistoryMessage, ToolProgress } from '../../entry/src/main/ets/core/types';
import type { LiveRowView } from '../../entry/src/main/ets/core/derive';
import type { WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

// ── 微基准工具：min-of-N（单位 µs；N 次里取最小）────────────────────────────────
// ⚠️ reps 越大越抗"宿主被多条线同时占用"的抖动（实测同一指标跨次可差 3×）。
//    昂贵的指标（274K 解析 / 流式增长）必须给更大的 reps，否则基线不可复现。
function benchUs(f: () => void, n: number, reps: number = 5): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) {
      f();
    }
    const t1 = process.hrtime.bigint();
    const us = Number(t1 - t0) / 1000 / n;
    if (us < best) {
      best = us;
    }
  }
  return best;
}
declare const process: {
  env?: Record<string, string>; exit: (c: number) => void;
  hrtime: { bigint: () => bigint };
};

const out: string[] = [];
function metric(name: string, value: number, unit: string): void {
  out.push(`METRIC ${name}=${value.toFixed(3)} ${unit}`);
  console.log(`METRIC ${name}=${value.toFixed(3)} ${unit}`);
}

// ── 输入构造（规模取自真实实测）────────────────────────────────────────────────
const N_BLOCKS_WORST = 340;    // chat_43C84E66B106（真实服务端最重单行）
const N_BLOCKS_FIXTURE = 108;  // chat_AAB719716889（稳定 fixture）
const BODY_CHARS = 2560;       // 单块正文 ≈ 2.5K（真实扫描的最大单块 18K 的常见档）

function mkIter(i: number, chars: number): HistoryIteration {
  return {
    iteration: i,
    content: `第${i}块 ` + '正文'.repeat(Math.floor(chars / 2)),
    reasoning: '',
    tools: [],
    tools_folded: false,
  };
}
function mkBlocks(n: number): HistoryIteration[] {
  const a: HistoryIteration[] = [];
  for (let i = 1; i <= n; i++) {
    a.push(mkIter(i, BODY_CHARS));
  }
  return a;
}
function mkTools(n: number): ToolProgress[] {
  const a: ToolProgress[] = [];
  for (let i = 0; i < n; i++) {
    a.push({
      name: 'Shell', label: i % 2 === 0 ? '运行命令' : undefined,
      status: i % 3 === 0 ? 'done' : 'running', elapsed_ms: i * 100,
      summary: undefined, detail: undefined, args: undefined,
      call_id: `c${i}`, ui_mode: undefined, gen_chars: undefined, tool_hints: undefined,
    });
  }
  return a;
}

/** 线格式工具（`inFlightBlock` 读 `callID`/`label`/`status`）。 */
function mkWebTool(i: number): WebToolProgress {
  return {
    name: 'Shell', label: '运行', status: 'running', elapsedMs: 0, summary: '', detail: '',
    args: '', toolHints: '', callID: `w${i}`,
  } as unknown as WebToolProgress;
}
/** K 个已完成迭代块，各含 1 枚**互不相同**的工具键（`inFlightBlock` 的 completedKeys 规模）。 */
function mkCompletedBlocks(k: number): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 1; i <= k; i++) {
    out.push({
      iteration: i, content: '', reasoning: '',
      tools: [{ name: 'Shell', label: '运行', status: 'done', call_id: `c${i}` } as unknown as ToolProgress],
      tools_folded: false,
    });
  }
  return out;
}
/** 一个 live 行视图：`kBlocks` 个已完成块 + `dLive` 枚在飞工具（`inFlightBlock` 在飞侧规模）。 */
function mkLiveView(kBlocks: number, dLive: number): LiveRowView {
  const active: WebToolProgress[] = [];
  for (let i = 0; i < dLive; i++) { active.push(mkWebTool(i)); }
  return {
    kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true,
    content: 'x'.repeat(200), reasoning: '', iterations: [], activeTools: active,
    streamingTools: [], genui: '', subAgents: [], todos: [], lastIter: 999,
  } as unknown as LiveRowView;
}

const blocksWorst = mkBlocks(N_BLOCKS_WORST);
const blocksFixture = mkBlocks(N_BLOCKS_FIXTURE);
const blocksSmall = mkBlocks(24);
const tools8 = mkTools(8);

// ── 1. 调色板/特效：每次调用新建对象（已知无记忆化）────────────────────────────
metric('paletteOf_us', benchUs(() => { paletteOf(THEME_DARK); }, 20000), 'us/call');
metric('effectsOf_us', benchUs(() => { effectsOf(paletteOf(THEME_DARK)); }, 20000), 'us/call');
metric('surfacesOf_us', benchUs(() => { surfacesOf(paletteOf(THEME_DARK)); }, 20000), 'us/call');

// ── 2. 流式：每事件的工具合并 ─────────────────────────────────────────────────
metric('mergeTools_8_us', benchUs(() => { mergeTools(tools8, tools8); }, 5000), 'us/call');

// ── 2b. 流式/打字机**纯逻辑热路径**（目标⑤ 2026-10-11：免分配计数/裁剪 + live 工具键集合）──
//   这三条度量**流式每拍/每帧**都走的纯函数：
//     · `components/LiveTailView` 每拍渲染调 `clipRunes`；每次源文本变化调 `toRunes`；
//     · `components/MessageRow` 每次 build 对每个块的思考文本调 `runeCount`（「思考 N 字」）；
//     · live 行**每帧**走 `inFlightBlock`（`core/render.ets:liveIterations`），其中含
//       「已提交工具键」集合的构造与在飞工具的成员过滤。
//   ⛔ 这三条是**新增度量**（不是放宽任何既有阈值）；口径与 `benchUs` 一致（min-of-N）。
const rnText = '中文正文'.repeat(2000);   // 8000 字符（≈ 一个长思考块）
metric('runeCount_8k_us', benchUs(() => { runeCount(rnText); }, 500, 9), 'us/call');
metric('clipRunes_8k_half_us', benchUs(() => { clipRunes(rnText, 4000); }, 500, 9), 'us/call');
const liveViewK54 = mkLiveView(54, 8);
const liveCompletedK54 = mkCompletedBlocks(54);
metric('inFlightBlock_K54_us', benchUs(() => { inFlightBlock(liveViewK54, liveCompletedK54); }, 2000, 9), 'us/call');
// 大在飞数档：`Set`（本节优化）相对 `Array.indexOf` 的收益在此档才显（D=8 时二者皆近 O(K)）。
const liveViewK54D64 = mkLiveView(54, 64);
metric('inFlightBlock_K54D64_us', benchUs(() => { inFlightBlock(liveViewK54D64, liveCompletedK54); }, 2000, 9), 'us/call');

// ── 3. 每帧（每次 build）的 O(块数) 固定开销 ──────────────────────────────────
metric('completedBlocks_340_us', benchUs(() => { completedBlocks({ iterations: blocksWorst } as ChatRow); }, 2000), 'us/call');
// ⚠️ 2026-10-11 round3：`blocksSignature` 已按**源数组对象恒等**记忆化 ⇒ 传同一数组会命中缓存（≈0）。
//    为量到**真 build** 成本（口径与历史可比、且无 `.slice()` 的 GC 噪声），这里直接调**未缓存内核**
//    `buildBlocksSignature`（`core/streammerge.ets`）。调用点形态（含记忆化收益）见下方 callerpat 行。
metric('blocksSignature_340_us', benchUs(() => { buildBlocksSignature(blocksWorst); }, 2000), 'us/call');
metric('mergeToolRuns_340_us', benchUs(() => { mergeToolRuns(blocksWorst); }, 2000), 'us/call');
metric('blocksSignature_24_us', benchUs(() => { buildBlocksSignature(blocksSmall); }, 2000), 'us/call');
metric('mergeToolRuns_24_us', benchUs(() => { mergeToolRuns(blocksSmall); }, 2000), 'us/call');
// 页面**真实调用点形态**：`blocksSignature(稳定对象) !== blocksSignature(每帧新数组)`（`pages/Index.ets`）
//   ⇒ 稳定侧命中缓存（省一次 O(块数) 拼串）。这是本波 `blocksSignature` 记忆化的收益口径。
const sigStable = blocksWorst.slice();
metric('blocksSignature_callerpat_340_us',
  benchUs(() => { if (blocksSignature(sigStable) !== blocksSignature(blocksWorst.slice())) { throw 1; } }, 2000), 'us/call');

// 线性度（O(N²) 回归会把这两个比值顶起来）
const sig340 = blocksSignature(blocksWorst).length;
const sig24 = blocksSignature(blocksSmall).length;
metric('signature_len_ratio_340_24', sig340 / (sig24 > 0 ? sig24 : 1), 'x');
metric('mergeToolRuns_time_ratio_340_24',
  benchUs(() => { mergeToolRuns(blocksWorst); }, 500) / (benchUs(() => { mergeToolRuns(blocksSmall); }, 500) || 1), 'x');

// ── 4. 一个完整事件：history → reduce → deriveRows → applyRow（340 块）────────
function histMessage(nBlocks: number): HistoryMessage {
  const its: HistoryIteration[] = [];
  for (let i = 1; i <= nBlocks; i++) {
    its.push(mkIter(i, BODY_CHARS));
  }
  return { id: 1, role: 'assistant', content: '', turn_id: 1, timestamp: '', iterations: its, regions_before: 0 };
}
const msgWorst = histMessage(N_BLOCKS_WORST);
let rowsOut: ChatRow[] = [];
metric('rowsFromHistory_340_ms', benchUs(() => {
  rowsOut = ChatStore.rowsFromHistory([msgWorst]);
}, 50) / 1000, 'ms/event');
metric('rowsFromHistory_rows', rowsOut.length, 'rows');

// ── 5. MarkdownView 的解析成本（渲染路径里唯一与文本长度成正比的计算）─────────
const para = '这是一段中文正文，带 `inline code`、**粗体** 与 https://example.com/' + 'x'.repeat(40) + '\n\n';
let big = '';
while (big.length < 274 * 1024) {
  big += para;
}
const eightK = big.slice(0, 8 * 1024);
metric('parseMarkdown_8k_us', benchUs(() => { parseMarkdown(eightK); }, 50, 9), 'us/call');
metric('parseMarkdown_274k_ms', benchUs(() => { parseMarkdown(big); }, 3, 9) / 1000, 'ms/call');
metric('parseInline_us', benchUs(() => { parseInline('**粗体** 与 `code` 和 https://a.b/' + 'y'.repeat(30)); }, 2000, 9), 'us/call');
// 纯文本（无行内标记字符）⇒ 命中前置早退（round3 新增）。对照：`parseInline_us` 用的是**含标记**
// 文本（早退不触发）⇒ 那条**不变**；这条才体现早退收益。
metric('parseInline_plain_us', benchUs(() => { parseInline('这是一段没有任何行内标记的纯文本正文' + 'x'.repeat(40)); }, 20000, 9), 'us/call');

// 缓存：**同一文本重复解析必须全命中**（防"重构把缓存拆了"）
const before = mdCacheStats();
for (let i = 0; i < 1000; i++) {
  parseMarkdownCached(eightK);
}
const after = mdCacheStats();
const hitDelta = after.hits - before.hits;
const missDelta = after.misses - before.misses;
metric('mdCache_repeat_hits', hitDelta, 'hits/1000');
metric('mdCache_repeat_misses', missDelta, 'misses/1000');

// 流式增长（键=原文 ⇒ 结构性不命中；这里只**记录**该事实，不设"必须命中"的阈值）
let acc = '';
const t0 = process.hrtime.bigint();
for (let i = 0; i < 120; i++) {
  acc += big.slice(i * 40, i * 40 + 40);
  parseMarkdownCached(acc);
}
metric('streamingGrowth_120ticks_ms', Number(process.hrtime.bigint() - t0) / 1e6, 'ms/120ticks');

// ── 6. 动效底座的纯数值部分（组件侧每条曲线还会多一次 new）─────────────────────
metric('motion_springBezier_us', benchUs(() => { springBezier(); springParams(); }, 20000), 'us/call');

// ── 7. 行内块窗口（TOP1 的护栏：块数/估算节点必须在上限内）────────────────────
//    这三条是**确定性计数**（不是墙钟）⇒ 可以把阈值设成硬值：窗口被拆/上限被取消 ⇒ 立刻红。
metric('blocks_rendered_340', rvVisibleBlocks(blocksWorst, MSG_BLOCK_WINDOW).length, 'blocks');
metric('hidden_blocks_340', rvHiddenBlockCount(N_BLOCKS_WORST, MSG_BLOCK_WINDOW), 'blocks');
metric('est_nodes_340_windowed', rvEstimatedNodes(N_BLOCKS_WORST, MSG_BLOCK_WINDOW), 'nodes');
metric('row_node_budget', MSG_ROW_NODE_BUDGET, 'nodes');

console.log(`\n（共 ${out.length} 条 METRIC；基准口径 = min-of-N，详见 docs/PERF-BUDGET.md）`);
process.exit(0);
