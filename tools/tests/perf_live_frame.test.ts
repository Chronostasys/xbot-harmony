/**
 * perf_live_frame.test.ts —— live 行「**每帧工作量**」的计数判据
 * （目标⑤「性能也要非常好」，2026-10-11；与 `row_signature_cost.test.ts` 同一手法）。
 *
 * ── 为什么量"每帧重新构造了几块"，而不是"跑得快" ────────────────────────────────
 * 耗时只能真机测（噪声大、离线不可复现 —— 见 `docs/PERF-BUDGET.md §4`）。但 live 行
 * 每帧的复杂度有一个**可离线观测**的代理量：对**未变化的已完成迭代**是否还要重新构造
 * `HistoryIteration` / `ToolProgress` / tools 数组。真实服务端单行可达 **108+** 已完成块
 * （`docs/RENDER-LOAD-MEASUREMENT.md`）⇒ 若每帧重建，分配数 ∝ turn 长度。
 *
 * ── 新链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   行源 = 模型投影（`model_step` + `model_bridge.applyModel`）：
 *     · 流式/结构化帧在模型里是**位置状态覆盖**（`live` 换新对象；`turns[i].blocks` **不换数组**
 *       —— 只有提交（`done`）才 append 新数组）；
 *     · `model_bridge.toHistoryIteration` 按**源 `Block` 对象恒等**记忆化 ⇒ 未变化的已完成块
 *       逐帧是**同一个 `HistoryIteration` 对象**（工具 `ToolProgress` 同样按 `ToolRec` 记忆化）。
 *   ⇒ 判据：连续多帧之间**已完成块对象逐元素恒等**（= 零重新转换/零重新分配），
 *     且换源数组（迭代提交）时只有尾巴长出新对象、前缀仍恒等。
 *   旧判据的"重转换块数计数器"（`core/render.ets:liveBlocksConvStats`）随旧链路删除；
 *   "转换发生与否"的可观测等价物就是**对象身份**（新建 ⇒ 新对象）。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';
import type { Block, TurnRec } from '../../entry/src/main/ets/core/model_types';

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

// ── 构造器（消费生产链路：模型步进 + 投影 + 桥接）─────────────────────────────────
const T = 1;
/** 一帧 `iteration`（模型 `adapt` 的 tick 源；`delta=true` 时额外提交该迭代块）。 */
function itEv(iter: number, content: string, seq: number, delta: boolean, tools?: readonly { name: string; status: string; call_id: string }[]): { [k: string]: unknown } {
  const ev: { [k: string]: unknown } = {
    type: 'iteration', turnID: T, iter, seq, phase: 'tool_exec',
    content, reasoning: '', activeTools: tools !== undefined ? tools : [], completedTools: [],
  };
  if (delta) {
    ev.iterationsDelta = [{
      iteration: iter, content: `iter-${iter}-final`, reasoning: '',
      tools: tools !== undefined ? tools : [], toolCount: tools !== undefined ? tools.length : 0,
    }];
  }
  return ev;
}
/** 一个 live turn：已完成 K 个迭代块 + 在飞第 K+1 迭代（正文可增长）。 */
function buildLive(K: number): ModelFeed {
  const f = new ModelFeed('c');
  f.push({ type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null });
  for (let n = 1; n <= K; n++) { f.push(itEv(n, `s-${n}`, n * 10, true)); }
  f.push(itEv(K + 1, 'x', (K + 1) * 10, false));
  return f;
}
function liveRow(f: ModelFeed): ChatRow {
  const rows: ChatRow[] = f.rows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === 'turn-1-live') { return rows[i]; }
  }
  throw new Error('没有 live 行 —— 构造器坏了（零扫描防线）');
}
/** 模型侧已提交块数组（判据的"源"，与行投影对照用）。 */
function modelBlocks(f: ModelFeed): readonly Block[] {
  const t = f.state.turns.get(T) as TurnRec;
  return t.blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 前提（记忆化的正确性依据）：流式帧之间模型 `blocks` **不换数组**；提交才换');
{
  const f: ModelFeed = buildLive(5);
  const b0: readonly Block[] = modelBlocks(f);
  f.push(itEv(6, 'a', 61, false));
  const b1: readonly Block[] = modelBlocks(f);
  f.push(itEv(6, 'ab', 62, false));
  const b2: readonly Block[] = modelBlocks(f);
  ok('★A 流式帧之间模型已提交块是**同一数组对象**（缓存可命中）', b0 === b1 && b1 === b2);
  f.push(itEv(6, 'ab', 63, true));
  const b3: readonly Block[] = modelBlocks(f);
  ok('★A 迭代提交后模型换数组（append 一条 ⇒ 新数组）', b3 !== b2);
  ok('★A 且前缀块对象仍恒等（只 append，不改历史块）', b3[0] === b2[0] && b3.length === b2.length + 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 判据：未变化的已完成块，每帧**零重新构造** + 块对象跨帧复用');
const lines: string[] = [];
let allZero = true;
let allReused = true;
let allSane = true;
for (const K of [0, 8, 24, 108]) {
  const f: ModelFeed = buildLive(K);
  const row: ChatRow = liveRow(f);
  const blocksA: HistoryIteration[] = row.completedBlocks.slice(0);
  // 帧 1/帧 2：在飞正文增长（已完成块没变）
  f.push(itEv(K + 1, 'a', (K + 1) * 10 + 1, false));
  f.rows();
  const blocksB: HistoryIteration[] = row.completedBlocks.slice(0);
  f.push(itEv(K + 1, 'ab', (K + 1) * 10 + 2, false));
  f.rows();
  const blocksC: HistoryIteration[] = row.completedBlocks.slice(0);

  // 已完成块对象跨帧复用（identity 稳定）
  let reused = 0;
  for (let i = 0; i < blocksB.length; i++) {
    if (blocksA[i] === blocksB[i] && blocksB[i] === blocksC[i]) { reused += 1; }
  }
  const reuseOk: boolean = blocksB.length === K && reused === K;
  // 零扫描防线：首帧确实展示了 K 块，且流式帧的**在飞块**确实在增长（不是"什么都没发生"）
  const liveIter: number = row.iterations.length > 0 ? row.iterations[row.iterations.length - 1].iteration : 0;
  const liveGrew: boolean = row.iterations.length === K + 1
    && row.iterations[row.iterations.length - 1].content === 'ab';
  const sane: boolean = blocksA.length === K && (K === 0 || reused === K) && liveGrew && liveIter === K + 1;
  allReused = allReused && reuseOk;
  allSane = allSane && sane;
  allZero = allZero && reused === K;
  lines.push(`K=${String(K).padStart(3)} 已完成块=${blocksB.length} 首帧块=${blocksA.length}`
    + ` 帧1/帧2重新构造=${reused === K ? 0 : K - reused}/${reused === K ? 0 : K - reused}`
    + ` 跨帧复用=${reused}/${K} 在飞块在长=${liveGrew}`);
}
for (let i = 0; i < lines.length; i++) { console.log(`   ${lines[i]}`); }
ok('★B 未变化的已完成块：帧 1/帧 2 的**重新构造数 == 0**（旧写法为 K ⇒ 必红）', allZero);
ok('★B 已完成块对象**跨帧复用**（identity 稳定 —— 不再每帧重新分配）', allReused);
ok('★B 零扫描防线：首帧真的展示了 K 块 且 在飞块逐帧增长（不是"什么都没发生"的假绿）', allSane);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 缓存失效防线：换源数组（迭代提交）⇒ 必长出新块');
{
  const K = 24;
  const f: ModelFeed = buildLive(K);
  const row: ChatRow = liveRow(f);
  const before: HistoryIteration[] = row.completedBlocks;
  const head: HistoryIteration = before[0];
  f.push(itEv(K + 1, 'a', (K + 1) * 10 + 1, false));
  f.rows();
  f.push(itEv(K + 1, 'a', (K + 1) * 10 + 2, true));      // 提交新迭代 ⇒ 源数组换对象
  f.rows();
  eq('★C 提交新迭代后：已完成块 = K+1', row.completedBlocks.length, K + 1);
  ok('★C 新块是**新对象**（不得复用旧对象 ⇒ 不陈旧）', before[K] === undefined && row.completedBlocks[K] !== undefined);
  ok('★C 前缀块对象仍恒等（只长出尾巴）', row.completedBlocks[0] === head);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 语义等价：缓存命中后的行块 == 模型块的 oracle 投影（逐字段）');
//   oracle 由**模型状态**推导（不调用被测的 `toHistoryIteration`）：迭代号/正文/思考/工具数。
function oracleOf(bs: readonly Block[]): string {
  return JSON.stringify(bs.map((b) => ({
    iteration: b.iteration, content: b.content, reasoning: b.reasoning,
    tools: b.tools.map((t: { meta: { name: string }; state: { status: string } }) => `${t.meta.name}:${t.state.status}`),
  })));
}
function actualOf(bs: HistoryIteration[]): string {
  return JSON.stringify(bs.map((b) => ({
    iteration: b.iteration, content: b.content, reasoning: b.reasoning,
    tools: (b.tools !== undefined ? b.tools : []).map((t: ToolProgress) => `${t.name}:${t.status}`),
  })));
}
{
  for (const K of [8, 108]) {
    const f: ModelFeed = buildLive(K);
    const row: ChatRow = liveRow(f);
    f.push(itEv(K + 1, 'a', (K + 1) * 10 + 1, false));
    f.rows();
    f.push(itEv(K + 1, 'ab', (K + 1) * 10 + 2, false));
    f.rows();                                    // 第 2 帧走缓存命中路径
    eq(`★D K=${K}：缓存命中后的已完成块 == 模型块的 oracle（逐字段）`,
      actualOf(row.completedBlocks), oracleOf(modelBlocks(f)));
    eq(`★D K=${K}：块数 == 模型块数`, row.completedBlocks.length, modelBlocks(f).length);
  }
  // 带工具的一档：工具对象也必须按 `ToolRec` 恒等（不重造）
  {
    const tools = [{ name: 'Shell', status: 'done', call_id: 'c1' }, { name: 'Read', status: 'done', call_id: 'c2' }];
    const f = new ModelFeed('c');
    f.push({ type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null });
    f.push(itEv(1, 'x', 10, true, tools));
    f.push(itEv(2, 'y', 20, false));
    const row: ChatRow = liveRow(f);
    const cb0: HistoryIteration[] = row.completedBlocks;
    const tools0: ToolProgress[] = cb0[0].tools !== undefined ? cb0[0].tools : [];
    const t0: ToolProgress = tools0[0];
    f.push(itEv(2, 'yy', 21, false));
    f.rows();
    const tools1: ToolProgress[] = row.completedBlocks[0].tools !== undefined ? row.completedBlocks[0].tools : [];
    const t1: ToolProgress = tools1[0];
    ok('★D 已完成块的 `ToolProgress` 对象也跨帧恒等（不重新构造工具数组）', t0 === t1);
    eq('★D 且工具内容正确（call_id/状态）', `${t1.call_id}:${t1.status}`, 'c1:done');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E mutation 自证（由外部脚本注入）：');
console.log('   · 把 `model_bridge.toHistoryIteration` 的 WeakMap 记忆化去掉（恒新建）');
console.log('     ⇒ 帧 1/帧 2 的"重新构造数"变成 K ⇒ §B ★B 必红；');
console.log('   · 把 `model_step.onDone` 改成"每帧都 append 全量块"⇒ §A ★A（同一数组对象）必红；');
console.log('   · 让 `model_adapter` 的 tick 把已完成块也当 `iterationsDelta` 提交 ⇒ §B 复用率下降 ⇒ 红。');

console.log('\n▼ 摘要（每帧工作量，计数口径 —— 不声称真机更快）');
console.log('   已完成块数上限 108 ⇒ 旧写法：每帧重新分配 108 个 HistoryIteration'
  + ' + 54 个 ToolProgress；新链路：0 个（对象恒等）。');
console.log('   真机 FPS / 冷启 / 内存 = **待设备验证**（本文件只证明纯逻辑侧的每帧工作量）。');

if (fail > 0) {
  console.log(`\n  perf_live_frame: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  perf_live_frame: ${pass} passed, 0 failed`);
process.exit(0);

export {};
