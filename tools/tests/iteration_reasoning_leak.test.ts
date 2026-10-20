/**
 * iteration_reasoning_leak.test.ts —— 上一迭代的思考/正文**不得**重复出现在在飞块。
 *
 * 用户 2026-10-21（转后台 100% 复现，截图「思考 406 字 ×2」）。
 *
 * ⛔ 实现位置已收敛（审计 2026-10-21）：**只在渲染层**去重
 *   （`core/render.ets:inFlightBlock`：在飞文字与**任一**已提交块等长且全等 ⇒ 置空）。
 *   reduce 侧的等长丢弃会把**合法的 gap 修复/AskUser 收尾文本**一起清掉（`reduce.test.ts`
 *   的两条 REPRO 实证）⇒ 已撤销。本文件断言**页面会画出来的块**，与实现同源。
 */
declare const process: { exit: (c: number) => void };
import { reduce } from '../../entry/src/main/ets/core/reduce';
import { applyRow } from '../../entry/src/main/ets/core/render';
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive';
import { ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq } from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import type { WebIteration, WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } }

const T = turnID(1);
const REASON = 'R'.repeat(406);
const SHELL = { name: 'Shell', label: 'Shell', status: 'running', callID: 'c1', iteration: 1 } as unknown as WebToolProgress;

function started(): ChatState {
  return reduce(initialChatState('c'), { type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null } as unknown as DomainEvent);
}
function streamR(s: ChatState): ChatState {
  return reduce(s, { type: 'stream', turnID: T, seq: eventSeq(10), iteration: iterNum(1), content: '', reasoning: REASON, streamingTools: [SHELL], genui: undefined, streamStats: undefined } as unknown as DomainEvent);
}
function commitAndAdvance(s: ChatState, carry: boolean): ChatState {
  const it1 = { iteration: 1, content: '', reasoning: REASON, tools: [SHELL], toolCount: 1 } as unknown as WebIteration;
  const s1 = reduce(s, { type: 'iteration', turnID: T, iter: iterNum(1), seq: eventSeq(20), content: '', reasoning: carry ? REASON : '', activeTools: [], completedTools: [SHELL], iterationsDelta: [it1], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined } as unknown as DomainEvent);
  return reduce(s1, { type: 'iteration', turnID: T, iter: iterNum(2), seq: eventSeq(30), content: '', reasoning: carry ? REASON : '', activeTools: [], completedTools: [], iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined } as unknown as DomainEvent);
}
function liveOf(s: ChatState): LiveRowView {
  const rows: readonly Row[] = deriveRows(s);
  for (const r of rows) { if (r.kind === 'live') return r; }
  throw new Error('no live row');
}
function rendered(s: ChatState): HistoryIteration[] {
  const row = new ChatRow();
  applyRow(row, liveOf(s));
  return row.iterations;
}

console.log('\n▶ §A 转后台（推进帧带上一迭代思考）⇒ 页面只出现**一段** 406 字思考');
{
  const s = commitAndAdvance(streamR(started()), true);
  const blocks = rendered(s);
  let liveReason = '';
  let count = 0;
  for (const b of blocks) {
    const r = b.reasoning !== undefined ? b.reasoning : '';
    if (r === REASON) count++;
    if (b.live === true) liveReason = r;
  }
  ok('★A 前置：确实已推进到迭代 2', liveOf(s).lastIter === 2);
  ok('★A 已提交块保留 406 字（内容不丢）', liveOf(s).iterations.length === 1 && (liveOf(s).iterations[0].reasoning ?? '') === REASON);
  ok('★A 渲染结果里「406 字思考」只出现**一次**', count === 1);
  ok('★A 在飞块 reasoning 为空（截图里的第二段就是它）', liveReason === '');
}

console.log('\n▶ §B 服务端不带残留 ⇒ 行为不变');
{
  const blocks = rendered(commitAndAdvance(streamR(started()), false));
  let count = 0;
  for (const b of blocks) { if ((b.reasoning ?? '') === REASON) count++; }
  ok('★B 仍然只有一段 406 字思考', count === 1);
}

console.log('\n▶ §C 新迭代自己的思考照常显示（不吞内容）');
{
  const fresh = 'N'.repeat(97);
  let s = commitAndAdvance(streamR(started()), true);
  s = reduce(s, { type: 'stream', turnID: T, seq: eventSeq(40), iteration: iterNum(2), content: '', reasoning: fresh, streamingTools: undefined, genui: undefined, streamStats: undefined } as unknown as DomainEvent);
  const blocks = rendered(s);
  let liveReason = '';
  for (const b of blocks) { if (b.live === true) liveReason = b.reasoning !== undefined ? b.reasoning : ''; }
  ok('★C 新迭代的 97 字思考正常显示', liveReason === fresh);
}

console.log(`\n  iteration_reasoning_leak: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
