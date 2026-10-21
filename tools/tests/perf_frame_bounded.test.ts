/**
 * perf_frame_bounded.test.ts —— **每帧成本与迭代块数 N 无关**的判别力判据
 * （2026-10-20；用户硬约束：「保证任何情况性能开销有界，无论历史多长开销都和 iter 数量无关」）。
 *
 * ── 为什么量"引用恒等"，而不是"跑得快" ─────────────────────────────────────────────
 * ArkUI V1 的组件只在**订阅到的值变化**时重建；`ForEach`/`build` 的重跑是 O(项数)。
 * 因此"每帧成本是否与 N 相关"完全由**每帧是否换掉了 N 长的那个数组对象**决定：
 *   · 页面把在飞正文写进 `ChatRow.liveTail`（`@Observed`）⇒ 只通知 `LiveTailView`；
 *   · 块列表 `ChatRow.iterBlocks`（`@Observed`）只在块**真正变化**时被替换
 *     ⇒ 订阅它的 `IterBlocksView`（内部 `ForEach(全部 N 块)`）**零重建**。
 * ⇒ 本文件直接断言这条**引用链**在 N=1..600 上都成立（首帧必换、流式帧必不换、
 *    迭代提交必换）。耗时只能真机测（噪声大），引用恒等是**可离线观测的复杂度代理**。
 *
 * ── 与既有判据的分工 ────────────────────────────────────────────────────────────
 *   · `perf_live_frame.test.ts`：已完成块的**转换**（`toHistoryIterations`）不重算；
 *   · 本文件：**渲染驱动**不重跑（块列表持有者 + 在飞持有者的替换次数）；
 *   · `perf_frame_bounded_wiring.test.ts`：钉住**调用点**（组件/页面里谁读谁写）。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };

import { applyRow } from '../../entry/src/main/ets/core/render';
import { liveBlocksConvStats } from '../../entry/src/main/ets/core/render';
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow, HistoryIteration, IterBlocks } from '../../entry/src/main/ets/core/types';
import type { WebIteration } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

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
    type: 'stream', turnID: T, seq: eventSeq(100000 + n * 7 + c.length), iteration: iterNum(n + 1),
    content: c, reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
}
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
function applyTo(row: ChatRow, s: ChatState): void {
  applyRow(row, liveViewOf(s));
}
function blocksConverted(): number { return liveBlocksConvStats().blocks; }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 块列表持有者：首帧必换、流式帧**零替换**（无论 N 多大）');
{
  const rows: string[] = [];
  let allOk = true;
  let allSane = true;
  for (const K of [0, 1, 8, 50, 108, 340, 600]) {
    const base: ChatState = buildLive(K);
    const row: ChatRow = new ChatRow();
    const holder: IterBlocks = row.iterBlocks;

    applyTo(row, base);                       // 帧 0：建行
    const blocks0: HistoryIteration[] = holder.blocks;
    const rev0: number = holder.rev;

    // 帧 1..3：正文持续增长（**已完成块没变**）
    let s: ChatState = base;
    let stable = true;
    let conv = 0;
    for (let f = 1; f <= 3; f++) {
      s = reduce(s, streamEv(K, 'x'.repeat(f * 3)));
      const w: number = blocksConverted();
      applyTo(row, s);
      conv += blocksConverted() - w;
      if (holder.blocks !== blocks0 || holder.rev !== rev0) { stable = false; }
    }
    // 零扫描防线：首帧确实产出了 K 块（不是"扫了 0 块"的假绿）
    const sane: boolean = holder.blocks.length === K && rev0 >= 1 && conv === 0;
    allOk = allOk && stable;
    allSane = allSane && sane;
    rows.push(`N=${String(K).padStart(4)} 首帧块数=${holder.blocks.length} 首帧rev=${rev0}`
      + ` 流式帧替换=${stable ? 0 : 1} 流式帧重转换=${conv}`);
  }
  for (let i = 0; i < rows.length; i++) { console.log(`   ${rows[i]}`); }
  ok('★A 流式帧里块列表持有者**引用与代数都不变**（⇒ IterBlocksView 零重建，每帧 O(1) 与 N 无关）', allOk);
  ok('★A 零扫描防线：首帧块数 == N 且 rev 自增过；流式帧的"重转换块数" == 0', allSane);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 缓存失效防线：迭代提交 ⇒ 块列表**必须**替换（绝不陈旧）');
{
  const K = 24;
  let s: ChatState = buildLive(K);
  const row: ChatRow = new ChatRow();
  applyTo(row, s);
  const rev0: number = row.iterBlocks.rev;
  s = reduce(s, streamEv(K, 'a'));
  applyTo(row, s);
  ok('★B 流式帧不换（前置条件）', row.iterBlocks.rev === rev0);
  const before: HistoryIteration[] = row.iterBlocks.blocks;
  s = reduce(s, itEv(K + 1));
  applyTo(row, s);
  ok('★B 提交新迭代 ⇒ 块列表换引用（订阅者重建一次，内容不复用旧的）',
    row.iterBlocks.blocks !== before);
  ok('★B 且块数 +1', row.iterBlocks.blocks.length === K + 1);
  ok('★B 且代数自增', row.iterBlocks.rev > rev0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 身份/压缩点：持有者由 core 维护（组件不自己算密钥）');
{
  const row: ChatRow = new ChatRow();
  row.id = 'turn-7-c';
  applyTo(row, buildLive(3));
  ok('★C 持有者 rowID == 行 id', row.iterBlocks.rowID === 'turn-7-c');
  ok('★C 持有者 turnID == 行 turnID', row.iterBlocks.turnID === 1);
  ok('★C live 行无压缩点（共享空数组，零渲染）', row.iterBlocks.compactions.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 在飞内容：**@Prop 值投递**（2026-10-21 回滚后的事实口径）');
{
  // ⛔ 历史：曾用独立 @Observed 持有者（`LiveTailState` + `@ObjectLink`）承载在飞内容，
  //   实测导致「光球与『思考 N 字』一起静止数秒、N 卡在 3/39」的 P0 ⇒ 回滚到 @Prop 值投递，
  //   死代码已删除（`ChatRow.liveTail` 不再存在）。本段钉住**回滚后**的形态。
  const req = require('fs');
  const path = require('path');
  const types = req.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/types.ets'), 'utf8') as string;
  const live = req.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/components/LiveTailView.ets'), 'utf8') as string;
  ok('★D `ChatRow.liveTail` 已删除（死代码清理后不得复活）', types.indexOf('liveTail: LiveTailState') < 0);
  ok('★D `LiveTailView` 用 `@Prop @Watch(\'onSource\') text` 值投递',
    /@Prop @Watch\('onSource'\) text: string = '';/.test(live));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E 空行/历史行不产生块列表（守卫不被持有者绕过）');
{
  const row: ChatRow = new ChatRow();
  applyTo(row, buildLive(0));
  ok('★E N=0 时块列表为空数组（不产出任何块节点）', row.iterBlocks.blocks.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §F mutation 自证（由外部脚本注入）：');
console.log('   · 把 `core/render.ets` 的 `syncIterBlocks` 改成"无条件重新合并并赋值"');
console.log('     ⇒ 流式帧的 `holder.blocks !== blocks0` ⇒ §A ★A 必红；');
console.log('   · 把 `mergeToolRuns` 的记忆化去掉（改成恒返回新数组）⇒ 同上必红；');
console.log('   · 把 `applyRow` 的 `syncIterBlocks` 整段删掉 ⇒ §B/§C 必红（块列表永不更新）。');

console.log(`\n  perf_frame_bounded: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);

export {};
