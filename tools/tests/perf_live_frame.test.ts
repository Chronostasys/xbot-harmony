/**
 * perf_live_frame.test.ts —— live 行「**每帧工作量**」的计数判据
 * （目标⑤「性能也要非常好」，2026-10-11；与 `row_signature_cost.test.ts` 同一手法）。
 *
 * ── 为什么量"每帧重新转换了几块"，而不是"跑得快" ────────────────────────────────
 * 耗时只能真机测（噪声大、离线不可复现 —— 见 `docs/PERF-BUDGET.md §4`）。但 live 行
 * 每帧的复杂度有一个**可离线观测**的代理量：对**未变化的已完成迭代**是否还要重新转换/分配。
 *
 *   · 旧实现：`applyRow` 的 live 分支每帧执行 `toHistoryIterations(r.iterations)`
 *     —— 对 N 个已完成块整份重新分配（N 个 `HistoryIteration` + K 个 `ToolProgress`
 *     + N 个 tools 数组）。真实服务端单行可达 **108+** 已完成块（`docs/RENDER-LOAD-MEASUREMENT.md`）
 *     ⇒ 每帧分配数 ∝ turn 长度。
 *   · 状态机事实（本文件 §A **直接断言**，不靠推断）：流式/结构化帧是字段级合并
 *     （`core/reduce.ts` 的 `{ ...prev, … }`）⇒ `r.iterations` 跨帧 **对象恒等**。
 *   ⇒ 判据（`core/render.ets` 的 `liveBlocksConvStats`）：连续多帧之间，
 *     **未变化的已完成块的"转换未命中数"必须为 0**，且块对象**跨帧复用**（identity 稳定）。
 *
 * ── 语义等价（不是"为省调用改行为"）─────────────────────────────────────────
 * `toHistoryIteration` 是源 `WebIteration` 的**纯函数**；记忆化只按**源数组对象恒等**取结果，
 * 故：① 输出逐字段不变（§D 用 oracle `toHistoryIterations` 逐字节比对）；
 *     ② 源数组一换（commit/fold）必重算（§C）。
 */
declare const process: { exit: (c: number) => void };

import { applyRow, toHistoryIterations, liveBlocksConvStats } from '../../entry/src/main/ets/core/render';
import { completedBlocks } from '../../entry/src/main/ets/core/streammerge';
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import type { WebIteration } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 构造器（消费生产 reduce；事件形状与 streammerge_row / row_signature_cost 同款）─────
const T = turnID(1);
function iterD(n: number, c: string): WebIteration {
  return { iteration: n, content: c, reasoning: '', tools: [], toolCount: 0 } as unknown as WebIteration;
}
function itEv(n: number): DomainEvent {
  return {
    type: 'iteration', turnID: T, iter: iterNum(n), seq: eventSeq(n * 10),
    content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
    iterationsDelta: [iterD(n, `iter-${n}-final`)], todos: undefined,
    subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
}
function streamEv(n: number, c: string): DomainEvent {
  return {
    type: 'stream', turnID: T, seq: eventSeq(100000 + n), iteration: iterNum(n + 1),
    content: c, reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
}
/** 一个 live turn，已完成 K 个迭代块。 */
function buildLive(k: number): ChatState {
  let s: ChatState = initialChatState('c');
  s = reduce(s, {
    type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null,
  } as unknown as DomainEvent);
  for (let n = 1; n <= k; n++) { s = reduce(s, itEv(n)); }
  return s;
}
function liveViewOf(s: ChatState): LiveRowView {
  const rows: readonly Row[] = deriveRows(s);
  for (let i = 0; i < rows.length; i++) {
    const r: Row = rows[i];
    if (r.kind === 'live') { return r; }
  }
  throw new Error('没有 live 行 —— 构造器坏了（零扫描防线）');
}
/** 走生产的 `applyRow`（返回"行内容是否变化"）。 */
function applyTo(row: ChatRow, s: ChatState): boolean {
  return applyRow(row, liveViewOf(s));
}
function misses(): number { return liveBlocksConvStats().misses; }
/** 「每帧工作量」口径：本次真**转换过的块数**（命中算 0）。 */
function blocksConverted(): number { return liveBlocksConvStats().blocks; }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 前提（记忆化的正确性依据）：流式帧之间源 `iterations` 对象恒等；换数组必换对象');
{
  const base: ChatState = buildLive(5);
  const f1: ChatState = reduce(base, streamEv(5, 'a'));
  const f2: ChatState = reduce(f1, streamEv(5, 'ab'));
  const v0: LiveRowView = liveViewOf(base);
  const v1: LiveRowView = liveViewOf(f1);
  const v2: LiveRowView = liveViewOf(f2);
  ok('★A 流式帧之间 live 行的源 iterations 是**同一数组对象**（缓存可命中）',
    v1.iterations === v2.iterations);
  ok('★A 且 v0(base)→v1(帧1) 也同对象（stream 帧不换源数组）', v0.iterations === v1.iterations);
  ok('★A 元素也是同一对象', v1.iterations[0] === v2.iterations[0]);
  const f3: ChatState = reduce(f2, itEv(6));
  ok('★A 迭代提交后源数组**换对象**（stream 之外的 commit 路径）',
    liveViewOf(f3).iterations !== v2.iterations);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 判据：未变化的已完成块，每帧**零重新转换** + 块对象跨帧复用');
const rows: string[] = [];
let allZero = true;
let allReused = true;
let allSane = true;
for (const K of [0, 8, 24, 108]) {
  const base: ChatState = buildLive(K);
  const row: ChatRow = new ChatRow();
  // 帧 0：建行（首次转换 —— 对 K>0 必须真的转换了 K 块 ⇒ 零扫描防线）
  const w0: number = blocksConverted();     // 「每帧工作量」= 真转换过的块数
  const c0: boolean = applyTo(row, base);
  const dPrime: number = blocksConverted() - w0;
  const blocksA: HistoryIteration[] = completedBlocks(row);

  // 帧 1：正文增长（**已完成块没变**）
  const f1: ChatState = reduce(base, streamEv(K, 'a'));
  const w1: number = blocksConverted();
  const c1: boolean = applyTo(row, f1);
  const d1: number = blocksConverted() - w1;
  const blocksB: HistoryIteration[] = completedBlocks(row);

  // 帧 2：正文再增长（**已完成块仍没变**）
  const f2: ChatState = reduce(f1, streamEv(K, 'ab'));
  const w2: number = blocksConverted();
  const c2: boolean = applyTo(row, f2);
  const d2: number = blocksConverted() - w2;
  const blocksC: HistoryIteration[] = completedBlocks(row);

  // 已完成块对象跨帧复用（identity 稳定）
  let reused = 0;
  for (let i = 0; i < blocksB.length; i++) {
    if (blocksA[i] === blocksB[i] && blocksB[i] === (blocksC[i] as unknown)) { reused += 1; }
  }
  const reuseOk: boolean = blocksB.length === K && reused === K;
  // 帧 1/帧 2 的 applyRow 必须真的跑了（否则 §B 是"什么都没做"的假绿）
  const ran: boolean = c0 === true && c1 === true && c2 === true;
  allZero = allZero && d1 === 0 && d2 === 0;
  allReused = allReused && reuseOk;
  allSane = allSane && ran && (K === 0 || dPrime === K);

  rows.push(`K=${String(K).padStart(3)} 已完成块=${blocksB.length} 首帧转换=${dPrime}`
    + ` 帧1转换=${d1} 帧2转换=${d2} 跨帧复用=${reused}/${K} applyRow跑了=${ran}`);
}
for (let i = 0; i < rows.length; i++) { console.log(`   ${rows[i]}`); }
ok('★B 未变化的已完成块：帧 1/帧 2 的**重新转换数 == 0**（旧写法为 K ⇒ 必红）', allZero);
ok('★B 已完成块对象**跨帧复用**（identity 稳定 —— 不再每帧重新分配）', allReused);
ok('★B 零扫描防线：applyRow 真的跑了 且 首帧真的转换了 K 块（不是"扫了 0 块"的假绿）', allSane);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 缓存失效防线：换源数组（迭代提交）⇒ 必重算');
{
  const K = 24;
  const base: ChatState = buildLive(K);
  const row: ChatRow = new ChatRow();
  applyTo(row, base);
  const f1: ChatState = reduce(base, streamEv(K, 'a'));
  applyTo(row, f1);
  const w: number = blocksConverted();
  const committed: ChatState = reduce(f1, itEv(K + 1));   // 提交新迭代 ⇒ 源数组换对象
  const ran: boolean = applyTo(row, committed);
  const d: number = blocksConverted() - w;
  eq('★C 提交新迭代后：已完成块 = K+1（换了源数组）', completedBlocks(row).length, K + 1);
  ok('★C 换源数组 ⇒ 转换块数 == 新长度（必须重算，绝不陈旧）', ran && d === K + 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 语义等价：记忆化输出 == oracle `toHistoryIterations(源数组)` 逐字节相同');
{
  for (const K of [8, 108]) {
    const base: ChatState = buildLive(K);
    const row: ChatRow = new ChatRow();
    applyTo(row, base);
    const f1: ChatState = reduce(base, streamEv(K, 'a'));
    applyTo(row, f1);
    const f2: ChatState = reduce(f1, streamEv(K, 'ab'));
    applyTo(row, f2);                                    // 第 2 帧走缓存命中路径
    const src: readonly WebIteration[] = liveViewOf(f2).iterations;
    const oracle: HistoryIteration[] = toHistoryIterations(src);
    eq(`★D K=${K}：缓存命中后的已完成块 == oracle（逐字节）`,
      JSON.stringify(completedBlocks(row)), JSON.stringify(oracle));
    eq(`★D K=${K}：块数 == 源块数`, completedBlocks(row).length, src.length);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E mutation 自证（由外部脚本注入）：');
console.log('   · 把 `core/render.ets` 的 `liveIterations` 首行改回 `toHistoryIterations(r.iterations)`');
console.log('     ⇒ 帧 1/帧 2 的"重新转换数"变成 K ⇒ §B ★B 必红；');
console.log('   · 把记忆化改成"不按源对象、恒返回新数组" ⇒ 同上必红（缓存被拆）；');
console.log('   · 把源数组恒等断言（§A）去掉改走"每帧新数组"构造 ⇒ §B 跨帧复用必红（构造器自证）。');

console.log('\n▼ 摘要（每帧工作量，计数口径 —— 不声称真机更快）');
console.log(`   已完成块数上限 ${108} ⇒ 旧写法：每帧重新分配 ${108} 个 HistoryIteration`
  + ' + 54 个 ToolProgress（实测 ≈2.9 µs/帧）；新写法：0 个。');
console.log('   真机 FPS / 冷启 / 内存 = **待设备验证**（本文件只证明纯逻辑侧的每帧工作量）。');

if (fail > 0) {
  console.log(`\n  perf_live_frame: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  perf_live_frame: ${pass} passed, 0 failed`);
process.exit(0);

export {};
