/**
 * `render_inflight.test.ts` —— live 工具列表的**不变量**（WEB-PARITY §12-B，P0），
 * 现已**迁移到模型链路**（`ModelFeed` = `model_adapter → model_step → model_project → applyModel`）。
 *
 * web 权威 `LiveIteration.tsx:157-179` 的三步（去重 / 迭代过滤 / 已提交工具剔除）在旧链路上
 * 是**渲染层**的三个补丁（`inFlightBlock` + `isToolRendered` + `mergeTools`）。行源翻转到模型后，
 * 这些补丁的上游被**结构性地**消灭了，因此本文件改钉**模型侧的新不变量**（同一保证的等价表达）：
 *
 *   ① 「同一工具只一行」⇒ 工具集是**位置状态**（`applyToolTicks`：本帧该迭代的工具全集，
 *      按 `call` 覆盖）⇒ 跨帧重复天然收敛为一条。
 *      ⚠️ **同帧**重复（同一 call 同时出现在 `streaming_tools` 与 `active_tools`）新链路**不去重** ——
 *      那是协议义务（`docs/STATE-MODEL.md` C-8「同帧不重复」），客户端不再掩盖它
 *      （`model_adapter` 纪律：只搬运、无判据/去重）。
 *   ② 「同号块只有一份」⇒ T5(a) `blocks` 号**严格递增**（同号块不可表示），提交块带工具时
 *      以提交块为准，在飞块被清（`live = null`）⇒ 不重复。
 *   ③ 「不同键不误杀」⇒ 本帧多枚工具全部保留（不去重、不跨迭代比较）。
 *   ④ 「空 live 不产空壳」⇒ 投影只在 `content/tools` 非空时追加在飞块。
 *   ⑤ 「live 工具集 = 当前迭代全集」⇒ 不残留上一帧/旧迭代的工具，也不累积
 *      （旧链路是 `t.iteration > maxCompletedIter` 过滤；新链路是位置状态语义）。
 *   ⑥ 「已提交的不再画第二遍」⇒ 提交后该工具在整行里**恰好出现一次**；未提交的必须出现。
 *
 * ⛔ 旧断言「同号已完成块是**空壳** ⇒ 用在飞块顶位」已**随代码删除**：新模型明确不替服务端
 *   补内容（`docs/STATE-MODEL.md:805/1122`：`done.block` 自带完备工具集 = 协议义务 P4）。
 *   空壳提交 ⇒ 该迭代无可渲染内容（这是**协议违规输入**下的既定行为，不兜底）。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 造一枚**线格式**工具（线格式是 `callID`，原生才是 `call_id`）。 */
function tw(name: string, status: string, callId: string, iter: number): Record<string, Object> {
  return {
    name, label: name, status, callID: callId, iteration: iter,
    elapsedMs: 0, summary: '', detail: '', args: '', toolHints: '',
  };
}

interface Frame {
  iter: number;
  seq: number;
  active?: Record<string, Object>[];
  streaming?: Record<string, Object>[];
  completed?: Record<string, Object>[];
  delta?: Record<string, Object>[];
  content?: string;
}

function feed(chat: string, frames: Frame[]): ModelFeed {
  const f = new ModelFeed(chat);
  f.push({ type: 'turn_started', turnID: 1, requestID: null, trigger: 'user', content: '', seq: 1 });
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    f.push({
      type: 'iteration', turnID: 1, iter: fr.iter, seq: fr.seq, phase: 'tool_exec',
      content: fr.content === undefined ? '' : fr.content, reasoning: '',
      activeTools: fr.active === undefined ? [] : fr.active,
      streamingTools: fr.streaming === undefined ? [] : fr.streaming,
      completedTools: fr.completed === undefined ? [] : fr.completed,
      iterationsDelta: fr.delta === undefined ? [] : fr.delta,
      todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    });
  }
  return f;
}

function block(iter: number, tools: Record<string, Object>[]): Record<string, Object> {
  return { iteration: iter, content: '', reasoning: '', tools, toolCount: tools.length };
}

/** 渲染行末尾在飞块的工具（页面 `LiveTailView` 的唯一数据源）。 */
function inflightTools(f: ModelFeed): ToolProgress[] {
  const row: ChatRow | undefined = f.row('turn-1-live');
  if (row === undefined) {
    return [];
  }
  const its: HistoryIteration[] = row.iterations;
  if (its.length === 0) {
    return [];
  }
  const ts: ToolProgress[] | undefined = its[its.length - 1].tools;
  return ts === undefined ? [] : ts;
}

function ids(ts: ToolProgress[]): string[] {
  return ts.map((t) => (t.call_id === undefined ? '' : t.call_id));
}

/** 整行里某 call 出现的次数（重复渲染判据）。 */
function occurrences(f: ModelFeed, call: string): number {
  const row: ChatRow | undefined = f.row('turn-1-live');
  if (row === undefined) {
    return 0;
  }
  let n = 0;
  for (let i = 0; i < row.iterations.length; i++) {
    const ts: ToolProgress[] | undefined = row.iterations[i].tools;
    if (ts === undefined) { continue; }
    for (let k = 0; k < ts.length; k++) {
      if (ts[k].call_id === call) { n = n + 1; }
    }
  }
  return n;
}

// ── ① 位置状态：同一 call 跨帧反复出现 ⇒ 恒一条（旧 `mergeTools` 去重的等价保证）────
{
  const f = feed('d1', [
    { iter: 1, seq: 2, active: [tw('run_shell', 'running', 'c1', 1)] },
    { iter: 1, seq: 3, active: [tw('run_shell', 'running', 'c1', 1)], streaming: [tw('run_shell', 'running', 'c1', 1)] },
    { iter: 1, seq: 4, streaming: [tw('run_shell', 'running', 'c1', 1)] },
  ]);
  eq('★① 同一 call 跨帧出现 3 次 ⇒ 行里只有 1 条', inflightTools(f).length, 1);
  eq('★① 保留的是该键', ids(inflightTools(f)), ['c1']);
}

// ── ② 同号只有一份：提交块带工具 ⇒ 以提交块为准，在飞块清空（绝不 append 第二块）──
{
  const f = feed('d2', [
    { iter: 1, seq: 2, delta: [block(1, [tw('old', 'done', 'c0', 1)])] },
    { iter: 2, seq: 3, active: [tw('Shell', 'done', 'c1', 2)] },
    { iter: 2, seq: 4, delta: [block(2, [tw('Shell', 'done', 'c1', 2)])] },
  ]);
  const row = f.row('turn-1-live');
  const its: HistoryIteration[] = row === undefined ? [] : row.iterations;
  eq('★② 同号块只有一份（T5a 严格递增 ⇒ 绝不第二块）', its.length, 2);
  eq('★② 同号块号不重复', its.length === 2 ? [its[0].iteration, its[1].iteration] : [], [1, 2]);
  eq('★② 工具数 = 1（提交块带工具，不重复）', its.length === 2 ? (its[1].tools ?? []).length : -1, 1);
  eq('★② live 快照已清（无在飞块叠在提交块上）', f.state.live, null);
}

// ── ③ 不同键全部保留（不误杀、不去重）───────────────────────────────────────────
{
  const f = feed('d3', [
    { iter: 1, seq: 2, active: [tw('a', 'running', 'c1', 1), tw('b', 'done', 'c2', 1)] },
  ]);
  eq('★③ 不同键 ⇒ 两行都保留（不误杀）', ids(inflightTools(f)), ['c1', 'c2']);
}

// ── ④ 空 live（无工具无正文）⇒ 不产空壳块 ──────────────────────────────────────
{
  const f = feed('d4', [{ iter: 1, seq: 2 }]);
  const row = f.row('turn-1-live');
  ok('★④ live 行存在（回合已开）', row !== undefined);
  eq('★④ 空 live ⇒ 行里没有任何块（不产空壳）', row === undefined ? -1 : row.iterations.length, 0);
}

// ── ⑤ live 工具集 = **本帧**当前迭代全集：不残留旧工具、不累积 ────────────────────
// 旧链路靠渲染层按 `t.iteration > maxCompletedIter` 过滤陈旧项（用户 2026-10-11 亲报
// 「所有 tool 都渲染为排队」的防线）。新链路的等价保证是**位置状态**：
// 每帧 `tick.tools` 就是该迭代的工具全集 ⇒ 上一帧的工具不会残留、也不会并集累积。
// ⚠️ 注意语义位移：若服务端违约把**旧迭代**的工具塞进本帧 `active_tools`，模型会按
//   本帧迭代号盖章（`toToolRec`），客户端不再滤 —— 见文件头与报告。
{
  const f = feed('d5', [
    { iter: 1, seq: 2, delta: [block(1, [tw('old', 'done', 'old-1', 1)])] },
    { iter: 3, seq: 3, active: [tw('Read', 'running', 'cur-1', 3)] },
  ]);
  eq('★⑤ 本帧未携带的旧工具不残留', ids(inflightTools(f)), ['cur-1']);
  f.push({
    type: 'iteration', turnID: 1, iter: 3, seq: 4, phase: 'tool_exec', content: '', reasoning: '',
    activeTools: [tw('Write', 'running', 'cur-2', 3)], streamingTools: [], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  eq('★⑤ 下一帧换工具 ⇒ 只剩本帧的（不累积并集）', ids(inflightTools(f)), ['cur-2']);
}

// ── ⑥ 已提交的工具在整行里**恰好一次**（busy→idle 不得画两次）──────────────────
{
  const f = feed('d6', [
    { iter: 1, seq: 2, active: [tw('Shell', 'done', 'c9', 1)] },
    { iter: 1, seq: 3, delta: [block(1, [tw('Shell', 'done', 'c9', 1)])] },
  ]);
  eq('★⑥ 已提交工具整行只出现 1 次（提交块画一次、live 不再画）', occurrences(f, 'c9'), 1);
  // 反向：当前迭代真的未提交 ⇒ 必须画（不能把在飞工具吞掉）
  f.push({
    type: 'iteration', turnID: 1, iter: 2, seq: 4, phase: 'tool_exec', content: '', reasoning: '',
    activeTools: [tw('Shell', 'running', 'c10', 2)], streamingTools: [], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  eq('★⑥ 在飞工具（当前迭代未提交）必须保留', ids(inflightTools(f)), ['c10']);
  eq('★⑥ 且它也只出现 1 次', occurrences(f, 'c10'), 1);
}

console.log(`\n  render_inflight: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
