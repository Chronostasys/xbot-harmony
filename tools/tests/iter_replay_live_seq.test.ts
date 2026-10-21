/**
 * 重放真机日志序列（turn=1038 / iter 138→140，2026-10-21 16:50）并看**渲染结果**。
 * 目的：把用户报的「一个 Shell 消失」变成可复现的离线用例（先确认问题，再修）。
 *
 * 日志逐帧（[ITER-APPLY]）：
 *   evIter=139 delta=[138:Shell@138] active=[]      completed=[]        carried=false
 *   evIter=139 delta=[]              active=[]      completed=[]        carried=false ×3
 *   evIter=139 delta=[]              active=[Shell@139] completed=[]    carried=true  ×3
 *   evIter=139 delta=[]              active=[]      completed=[Shell@139] carried=true
 *   evIter=140 delta=[139:Shell@139] active=[]      completed=[]        carried=false
 *   evIter=140 delta=[]              active=[]      completed=[]        carried=false ×3
 *   evIter=140 delta=[]              active=[task_wait@140] completed=[] carried=true ×2
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   行源已翻转到新模型：判据只能用 `model_harness.ModelFeed`（= 生产 `model_bridge.stepEvent`
 *   + `applyModel`）。旧的 `deriveRows` / `applyRow` / `reduce` 链路**已废弃**。
 *   · `f.state`  = 模型（`turns.get(1).blocks` / `live.tools`）
 *   · `f.rows()` = 页面真正渲染的行（`ChatRow.iterations`，在飞块在末尾）
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import { stepEvent } from '../../entry/src/main/ets/core/model_bridge';
import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { Effect, State } from '../../entry/src/main/ets/core/model_types';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++ } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`) }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${name}`) }
}

let seq = 1000;
function tool(name: string, iter: number, status: string): Record<string, Object> {
  return { name, label: name, status, iteration: iter, call_id: `${name}-${iter}`, elapsedMs: 0, genChars: 0 };
}
/** 把工具塞进「该迭代的快照」形状（delta 里迭代条目带的 tools）。 */
function iterSnap(n: number, tools: Record<string, Object>[]): Record<string, Object> {
  return { iteration: n, content: '', reasoning: '', tools };
}
function ev(evIter: number, delta: Record<string, Object>[], active: Record<string, Object>[],
  completed: Record<string, Object>[], carried: boolean, turn: number = 1): Record<string, Object> {
  seq += 1;
  return {
    type: 'iteration', turnID: turn, iter: evIter, seq: seq,
    activeTools: active, completedTools: completed, iterationsDelta: delta, toolsCarried: carried,
  };
}
/** 行内某迭代块的工具名。 */
function names(its: HistoryIteration[], n: number): string[] {
  const b: HistoryIteration | undefined = its.filter((x) => x.iteration === n)[0];
  const ts = b !== undefined && b.tools !== undefined ? b.tools : [];
  return ts.map((t) => t.name);
}

// ① 基线：live turn 1，已持有迭代 1..137（每块无工具）—— 对齐日志 heldMax=137。
const f = new ModelFeed('chat-1');
f.push({ type: 'turn_started', turnID: 1, requestID: null, trigger: 'user', content: 'go', seq: ++seq });
const base: Record<string, Object>[] = [];
for (let i = 1; i <= 137; i++) base.push(iterSnap(i, []));
f.push({
  type: 'iteration', turnID: 1, iter: 138, seq: ++seq,
  activeTools: [], completedTools: [], iterationsDelta: base,
});

// ② 逐帧重放日志
const sh138 = tool('Shell', 138, 'done');
const sh139 = tool('Shell', 139, 'done');
const tw140 = tool('task_wait', 140, 'running');
f.push(ev(139, [iterSnap(138, [sh138])], [], [], false));
f.push(ev(139, [], [], [], false));
f.push(ev(139, [], [tool('Shell', 139, 'running')], [], true));
f.push(ev(139, [], [tool('Shell', 139, 'running')], [], true));
f.push(ev(139, [], [], [sh139], true));
f.push(ev(140, [iterSnap(139, [sh139])], [], [], false));
f.push(ev(140, [], [], [], false));
f.push(ev(140, [], [tw140], [], true));

// ③ 状态层断言（模型）
{
  const t = f.state.turns.get(1);
  ok('重放后回合仍在飞（无 final）', t !== undefined && t.final === null);
  if (t !== undefined) {
    const it138 = t.blocks.filter((x) => x.iteration === 138)[0];
    const it139 = t.blocks.filter((x) => x.iteration === 139)[0];
    ok('state: iter138 存在且带 Shell',
      it138 !== undefined && it138.tools.length === 1 && it138.tools[0].meta.name === 'Shell');
    ok('state: iter139 存在且带 Shell',
      it139 !== undefined && it139.tools.length === 1 && it139.tools[0].meta.name === 'Shell');
  }
  const live = f.state.live;
  ok('state: 在飞工具是 task_wait@140',
    live !== null && live.turn === 1 && live.iteration === 140
    && live.tools.length === 1 && live.tools[0].meta.name === 'task_wait');
}

// ④ **渲染层**断言（用户要求：看渲染结果）
//    页面 `syncLiveTail` 读的就是 `row.iterations`（在飞块在末尾）。
{
  const row: ChatRow | undefined = f.rows().filter((r: ChatRow) => r.turnID === 1 && r.role === 'assistant')[0];
  ok('有 live 渲染行（turn-1）', row !== undefined && row.isLive === true);
  if (row !== undefined) {
    const its: HistoryIteration[] = row.iterations;
    eq('渲染: iter138 块含 Shell', names(its, 138).indexOf('Shell') >= 0, true);
    eq('渲染: iter139 块含 Shell', names(its, 139).indexOf('Shell') >= 0, true);
    eq('渲染: 在飞块（末尾）含 task_wait@140', names(its, 140).indexOf('task_wait') >= 0, true);
    eq('渲染: 在飞块就是末尾那一块（同气泡最后一个迭代块）',
      its.length > 0 ? its[its.length - 1].iteration : -1, 140);
  }
}

// ⑤ 追加：`phase_done` 带同号 `finalIteration`（tools 为空）—— 是否**覆盖**掉已渲染的工具？
//    服务端 `snapshotCompletedIteration` 之后可能再组装一份"最后迭代"，若同号 incoming 权威覆盖
//    ⇒ tools:[] 会把工具抹掉（用户「完成后 Shell 消失」的形态）。
{
  f.push({ type: 'phase_done', turnID: 1, seq: seq + 100, finalIteration: iterSnap(139, []) });
  const t = f.state.turns.get(1);
  const b = (t !== undefined ? t.blocks : []).filter((x) => x.iteration === 139)[0];
  eq('state: phase_done(finalIteration=139,tools=[]) **不得**抹掉 iter139 的 Shell',
    b !== undefined && b.tools.map((x) => x.meta.name).indexOf('Shell') >= 0, true);
  const row: ChatRow | undefined = f.rows().filter((r: ChatRow) => r.turnID === 1 && r.role === 'assistant')[0];
  eq('渲染: 同上（行里 iter139 仍带 Shell）',
    row !== undefined && names(row.iterations, 139).indexOf('Shell') >= 0, true);
}

// ── ⑪ P0（2026-10-21 用户：「task_wait 完成后从历史消失」，必要条件 = 该迭代只有 toolcall）──
//   形态：工具已在 live 快照的 `completed_tools` 里 `done`，而对应迭代的 delta **还没到**
//   ⇒ 提交（text_final / 收尸）时这条工具不得**无补偿地**丢失。
//
//   链路差异（迁移说明）：旧 `reduce` 在提交时把它**就地折进块**（本地补全）；
//   新模型**禁止**客户端造块（`docs/STATE-MODEL.md` §3：位置状态 + 按对象拉权威）
//   ⇒ 等价保证 = 「要么块已存在，要么模型必须发出 `pullIter` 要求补拉该迭代」，
//   补拉结果落地后行里必须能看到它。`ModelFeed` 不暴露 effects ⇒ 这里直接走**同一个**
//   生产入口 `stepEvent`（`ModelFeed.push` 内部就是它），以便观察 effects。
{
  let st: State = emptyState('chat-1', 1, 0);
  let effects: readonly Effect[] = [];
  const feed = (e: Record<string, unknown>): void => {
    const r = stepEvent(st, e as never, st.chat);
    st = r.state;
    effects = r.effects;
  };
  feed({ type: 'turn_started', turnID: 1, requestID: null, trigger: 'user', content: 'go', seq: ++seq });
  const base77: Record<string, Object>[] = [];
  for (let n = 1; n <= 76; n++) base77.push(iterSnap(n, []));
  feed({ type: 'iteration', turnID: 1, iter: 77, seq: ++seq, activeTools: [], completedTools: [], iterationsDelta: base77 });
  // task_wait 在跑 → 完成（进 completed_tools），delta 尚未到
  feed({ type: 'iteration', turnID: 1, iter: 77, seq: ++seq, activeTools: [tool('task_wait', 77, 'running')], completedTools: [], iterationsDelta: [], toolsCarried: true });
  feed({ type: 'iteration', turnID: 1, iter: 77, seq: ++seq, activeTools: [], completedTools: [tool('task_wait', 77, 'done')], iterationsDelta: [], toolsCarried: true });
  // 提交（无正文、progressHistory 也没带 77）
  feed({ type: 'text_final', turnID: 1, content: '', progressHistory: [], cancelled: false, seq: ++seq });
  const t = st.turns.get(1);
  const has77: boolean = t !== undefined && t.blocks.some((x) => x.iteration === 77);
  const pulled: boolean = effects.some((e) => e.kind === 'pullIter' && e.iteration === 77);
  ok('★⑪ 提交时 completed_tools 里的 task_wait **不得无补偿丢失**（块存在，或已要求 pullIter(77)）',
    has77 || pulled);
  // 补拉结果（驱动层拿到的权威迭代）落地后，行里必须真的看得到它
  feed(ev(77, [iterSnap(77, [tool('task_wait', 77, 'done')])], [], [], false));
  const t2 = st.turns.get(1);
  const b77 = (t2 !== undefined ? t2.blocks : []).filter((x) => x.iteration === 77)[0];
  ok('★⑪b 权威补拉落地后，iter77 块里必须有 task_wait',
    b77 !== undefined && b77.tools.map((x) => x.meta.name).indexOf('task_wait') >= 0);
}

console.log(`  iter_replay_live_seq: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0)
export {}
