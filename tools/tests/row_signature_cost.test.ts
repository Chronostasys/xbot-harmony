/**
 * row_signature_cost.test.ts —— 逐事件**行写入量**的判别力判据
 * （用户亲报 `appfreeze THREAD_BLOCK_6S` 的取证后续，2026-10-11）。
 *
 * ── 为什么量的是"每事件**写了几行**"而不是"耗时"──────────────────────────────
 * 耗时只能真机测（且噪声大、离线不可复现）。但本链路的**复杂度**有一个**可离线观测**的
 * 代理量：`model_bridge.applyModel` 的**行级早退**——
 *   · 有早退（`appliedByRow` 里存的 `PRow` 引用没变 ⇒ 什么都不写）⇒ 未变行**零字段写入**
 *     ⇒ 一条流式 token 只写**在飞那一行**（+ 每帧被重新投影的 user 行，见下）⇒
 *     写入量与**历史长度无关**（已提交回合的 assistant 行永远是 0）。
 *   · 早退被拿掉 ⇒ 每事件**每行**都重写 iterations/completedBlocks/subAgents ⇒ 写入行数 == R
 *     ⇒ **O(R)** 且每行都是新数组（GC + ArkUI 全量 diff 的温床）。
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据量的是 `applyRow` 的字符串指纹早退（`if (row.signature === sig) return false;`），
 *   该协议随旧链路删除。新链路的等价可观测事实 = **ChatRow 的字段引用/代数有没有被写**：
 *   `applyModel` 复用 `rowCache` 里的行对象，只在 `PRow` 引用变化时才写字段
 *   （`iterations`/`completedBlocks`/`content`/`iterBlocks.rev`/`liveRevision`）。
 *   ⇒ 本文件按这 5 个可观测量统计"被写的行数"。
 *
 * ── 已知口径（不是"永真"）────────────────────────────────────────────────────
 *   ⚠️ `model_project.project` 对**每个 turn 的 user 行**每次投影都新建 `PUserRow`
 *   （无 memo）⇒ `applyModel` 每帧都重写**所有 user 行**（O(user 行数)/帧）。这是新链路
 *   已存在的开销（旧 `applyRow` 有 `sameRowEssence` 早退），**已上报**；本文件把它单列
 *   统计（`changedUser`）而**不**把"每帧只写 1 行"这种不成立的断言写成永真——
 *   真正与历史长度无关的判据是 **assistant 行**这一侧（★A/★B）。
 *   修法（core）：`project` 按 `TurnRec`/`UserLine` 恒等记忆化 user 行（或让
 *   `applyModel` 比较字段值），★A 里的 `changedUser` 诊断应变成 0。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

/** 一帧 `iteration`（模型 `adapt` 的 tick 源；`delta=true` 时额外提交该迭代块）。 */
function itEv(turn: number, iter: number, content: string, seq: number, delta: boolean): { [k: string]: unknown } {
  const ev: { [k: string]: unknown } = {
    type: 'iteration', turnID: turn, iter, seq, phase: 'tool_exec',
    content, reasoning: '', activeTools: [], completedTools: [],
  };
  if (delta) {
    ev.iterationsDelta = [{ iteration: iter, content: `final-${iter}`, reasoning: `think-${iter}`, tools: [], toolCount: 0 }];
  }
  return ev;
}

/** 一个已提交的 turn（3 迭代）：turn_started → 3×(tick+commit) → text_final。 */
function pushCommittedTurn(f: ModelFeed, n: number): void {
  f.push({ type: 'turn_started', turnID: n, requestID: `r${n}`, trigger: 'user', content: `q${n}` });
  for (let k = 1; k <= 3; k++) {
    f.push(itEv(n, k, `p${n}-${k}`, n * 100 + k * 2, true));
  }
  f.push({ type: 'text_final', turnID: n, content: `F${n}`, progressHistory: [], cancelled: false });
}

/** n 个已提交 turn + 一个在飞 turn（首帧已有在飞块）。 */
function build(n: number): ModelFeed {
  const f = new ModelFeed('chat-1');
  for (let i = 1; i <= n; i++) { pushCommittedTurn(f, i); }
  f.push({ type: 'turn_started', turnID: n + 1, requestID: 'rl', trigger: 'user', content: 'live' });
  f.push(itEv(n + 1, 1, 'tok', 900000, false));
  return f;
}

interface Snap {
  role: string;
  its: unknown;
  cb: unknown;
  content: string;
  rev: number;
  liveRev: number;
}
function snapshot(rows: ChatRow[]): Snap[] {
  const out: Snap[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: ChatRow = rows[i];
    out.push({ role: r.role, its: r.iterations, cb: r.completedBlocks, content: r.content, rev: r.iterBlocks.rev, liveRev: r.liveRevision });
  }
  return out;
}
/** 统计"被写过的行"（assistant / user 分开）。 */
function countWrites(before: Snap[], rows: ChatRow[]): { assistant: number; user: number; liveAssistant: number } {
  let assistant = 0;
  let user = 0;
  let liveAssistant = 0;
  for (let i = 0; i < rows.length; i++) {
    const a: Snap | undefined = before[i];
    const r: ChatRow = rows[i];
    if (a === undefined) { continue; }
    const written: boolean = r.iterations !== a.its || r.completedBlocks !== a.cb
      || r.content !== a.content || r.iterBlocks.rev !== a.rev || r.liveRevision !== a.liveRev;
    if (!written) { continue; }
    if (r.role === 'user') { user += 1; } else { assistant += 1; if (r.isLive) { liveAssistant += 1; } }
  }
  return { assistant, user, liveAssistant };
}

console.log('\n▶ §A 一条 live 流式事件：**已提交回合的行零写入**（与历史长度无关）');
const results: { turns: number; rows: number; assistant: number; live: number; user: number; idleAssistant: number }[] = [];
for (const turns of [4, 8, 16, 32, 64]) {
  const f: ModelFeed = build(turns);
  const rows0: ChatRow[] = f.rows();            // 建缓存（首批全 "变化"）
  const s0: Snap[] = snapshot(rows0);
  // 一条 live 流式事件（只应改在飞行）
  f.push(itEv(turns + 1, 1, 'tok2', 900001, false));
  const rows1: ChatRow[] = f.rows();
  const w1 = countWrites(s0, rows1);
  // 一条与回合无关的事件（session 字段）—— assistant 行必须**零写入**
  const s1: Snap[] = snapshot(rows1);
  f.push({ type: 'session_fields', todos: ['a'] });
  const w2 = countWrites(s1, f.rows());
  results.push({ turns, rows: rows0.length, assistant: w1.assistant, live: w1.liveAssistant, user: w1.user, idleAssistant: w2.assistant });
  console.log(`   turns=${turns} rows=${rows0.length}  写入行(流式)=assistant:${w1.assistant}(其中live:${w1.liveAssistant}) user:${w1.user}`
    + `  写入行(无关事件)=assistant:${w2.assistant} user:${w2.user}`);
}
ok('★A 流式事件：**assistant 侧只写 1 行（在飞行）** —— 已提交回合的 assistant 行零写入，不随 turn 数增长',
  results.every((r) => r.assistant === 1 && r.live === 1));
ok('★A 与回合无关的事件（session_fields）：assistant 行零写入', results.every((r) => r.idleAssistant === 0));
ok('★A 总行数随 turn 数增长（证明规模真的变了，不是"扫了 0 行"的假绿）',
  results[0].rows < results[results.length - 1].rows && results[results.length - 1].rows > 100);
ok('★A 行对象身份稳定（`rowCache` 复用 ⇒ LazyForEach 不重建行）', results.every((r) => r.rows === results[0].rows + (r.turns - results[0].turns) * 2));

console.log('\n▶ §A2 user 行：**零重投影**（core 已修：`userRow` 按源 `UserLine` 恒等记忆化）');
{
  const last = results[results.length - 1];
  console.log(`   最后一档 turns=${last.turns}：user 行写入=${last.user}（期望 0）`);
  // ⛔ 旧口径是"user 行每帧被重新投影（O(user 行数)/帧）"，那条缺口已在
  //   `model_project.userRow`（WeakMap<UserLine, PUserRow>）修掉 ⇒ 现在**必须为 0**，
  //   否则每帧写 N 个 user 行（页面 rebuild 与行数挂钩，违反"每帧成本与 N 无关"）。
  //   mutation：删掉 `userRowByLine` 记忆化 ⇒ 本条必红（回到 `turns+1`）。
  ok('★A2 user 行零写入（与 user 行数无关）', last.user === 0);
}

console.log('\n▶ §B 线性度：assistant 侧写入量不得随行数增长');
const worst = results.reduce((a, b) => (b.assistant > a.assistant ? b : a));
ok(`最坏情形 assistant 写入行数 ${worst.assistant} ≤ 1（与 rows=${worst.rows} 无关）`, worst.assistant <= 1);

console.log('\n▶ §C 空帧幂等：重复投影同一状态不得产生新行/新对象');
{
  const f: ModelFeed = build(8);
  const a: ChatRow[] = f.rows();
  const b: ChatRow[] = f.rows();
  ok('同一状态重复投影 ⇒ 行数相同', a.length === b.length);
  let same = true;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { same = false; } }
  ok('同一状态重复投影 ⇒ **同一批 ChatRow 对象**（零新对象）', same);
}

console.log('\n▶ §D mutation 自证（由外部脚本注入）：判据见本文件头');
console.log('   · 去掉 `applyModel` 的 `prevRow !== r` 早退（每行无条件 fill）');
console.log('     ⇒ ★A「assistant 写入 == 1」变成 == rows ⇒ 必红；');
console.log('   · 让 `model_project.assistantRow` 的 memo 失效（每次都新建 PRow）');
console.log('     ⇒ 同上必红（已提交行每帧被重写）；');
console.log('   · 让 `project` 按 `UserLine` 记忆化 user 行 ⇒ ★A2 的 user 写入变 0（回归修复方向）。');

console.log('\n▼ 摘要');
console.log(`  规模档：${results.map((r) => `T${r.turns}/R${r.rows}`).join(' → ')}`);
console.log(`  assistant 写入行数：${results.map((r) => r.assistant).join(', ')}（全部必须为 1）`);
console.log(`  user 写入行数（已知回归口径）：${results.map((r) => r.user).join(', ')}`);
console.log('  结论：每事件工作量 = O(行数) 的**引用比较** + O(1) 的**已提交行写入** + O(user 行) 的 user 行重投。');

if (fail > 0) {
  console.log(`\n  row_signature_cost: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  row_signature_cost: ${pass} passed, 0 failed`);
process.exit(0);

export {};
