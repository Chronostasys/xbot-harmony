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
  mergeTools, mergeToolRuns, completedBlocks, blocksSignature,
} from '../../entry/src/main/ets/core/streammerge';
import { parseMarkdown, parseMarkdownCached, parseInline, mdCacheStats } from '../../entry/src/main/ets/core/markdown';
import { springBezier, springParams } from '../../entry/src/main/ets/core/motion';
import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration, HistoryMessage, ToolProgress } from '../../entry/src/main/ets/core/types';

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

// ── 3. 每帧（每次 build）的 O(块数) 固定开销 ──────────────────────────────────
metric('completedBlocks_340_us', benchUs(() => { completedBlocks({ iterations: blocksWorst } as ChatRow); }, 2000), 'us/call');
metric('blocksSignature_340_us', benchUs(() => { blocksSignature(blocksWorst); }, 2000), 'us/call');
metric('mergeToolRuns_340_us', benchUs(() => { mergeToolRuns(blocksWorst); }, 2000), 'us/call');
metric('blocksSignature_24_us', benchUs(() => { blocksSignature(blocksSmall); }, 2000), 'us/call');
metric('mergeToolRuns_24_us', benchUs(() => { mergeToolRuns(blocksSmall); }, 2000), 'us/call');

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

console.log(`\n（共 ${out.length} 条 METRIC；基准口径 = min-of-N，详见 docs/PERF-BUDGET.md）`);
process.exit(0);
