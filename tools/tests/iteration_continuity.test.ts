/**
 * iteration_continuity.test.ts —— 「迭代进入执行中后**消失了**」的判别力判据（P0 线性一致性）。
 *
 * 用户 2026-10-21 两张截图对照（重启前 / 重启后）：重启前**少了两个迭代**（两条 Shell pill），
 * 那两条他亲眼看到「进入执行中状态」，随后**消失**；重启后从 DB 重新水合又出现。
 * 用户原话：「每条消息都有迭代号，你只要保证它迭代号是连续的，它就不可能丢数据」。
 *
 * 根因（纯前端，数据在状态机里、只是没人画）：
 *   服务端**提交**某迭代时可能**只带迭代壳、不带 tools**（工具的权威副本此刻在
 *   `active_tools`/`completed_tools`/`streaming_tools` 里）；而渲染层对**在飞工具**按
 *   `iteration > maxCompletedIter` 过滤（这是防陈旧残留的必需判据）⇒ 该迭代的工具
 *   **两处都不画** ⇒ 整条迭代在界面上消失。
 *
 * 两道修法（本文件都钉住）：
 *   ① `core/reduce.ts:foldKnownToolsIntoCommitted` —— 提交边界把"客户端已知、属于该迭代"
 *      的工具**折进**提交块（只增不减）；
 *   ② `core/reduce.ts:mergeIterations` —— 同号覆盖时**保留** prev 已有的工具（并集）。
 *
 * mutation 自证：去掉 ① 或 ② ⇒ §A / §B 必红。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import type { WebIteration, WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = turnID(1);
function tool(callID: string, iter: number, status: string): WebToolProgress {
  return {
    name: 'Shell', label: 'Shell', status, callID, iteration: iter,
  } as unknown as WebToolProgress;
}
function started(): ChatState {
  return reduce(initialChatState('c'), {
    type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null,
  } as unknown as DomainEvent);
}
/** 结构化帧：某迭代有在飞工具（执行中），迭代号 = `iter`。 */
function running(s: ChatState, iter: number, t: WebToolProgress, seq: number): ChatState {
  return reduce(s, {
    type: 'iteration', turnID: T, seq: eventSeq(seq), iter: iterNum(iter),
    content: '', reasoning: '', activeTools: [t], completedTools: [], iterationsDelta: [],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
/** 提交某迭代：**只带迭代壳、不带 tools**（真实服务端形态）。 */
function commitShellOnly(s: ChatState, iter: number, seq: number): ChatState {
  const shell: WebIteration = {
    iteration: iter, content: '', reasoning: '', tools: [], toolCount: 0,
  } as unknown as WebIteration;
  return reduce(s, {
    type: 'iteration', turnID: T, seq: eventSeq(seq), iter: iterNum(iter),
    content: '', reasoning: '', activeTools: [], completedTools: [], iterationsDelta: [shell],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
function advance(s: ChatState, iter: number, seq: number): ChatState {
  return reduce(s, {
    type: 'iteration', turnID: T, seq: eventSeq(seq), iter: iterNum(iter),
    content: '', reasoning: '', activeTools: [], completedTools: [], iterationsDelta: [],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
function iterTools(s: ChatState, iter: number): number {
  const rows: readonly Row[] = deriveRows(s);
  for (let i = 0; i < rows.length; i++) {
    const r: Row = rows[i];
    if (r.kind !== 'live') { continue; }
    const its: readonly WebIteration[] = r.iterations;
    for (let k = 0; k < its.length; k++) {
      if (its[k].iteration === iter) {
        return its[k].tools !== undefined ? its[k].tools.length : 0;
      }
    }
  }
  return -1;
}
function iterNums(s: ChatState): number[] {
  const rows: readonly Row[] = deriveRows(s);
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: Row = rows[i];
    if (r.kind !== 'live') { continue; }
    for (let k = 0; k < r.iterations.length; k++) { out.push(r.iterations[k].iteration); }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 提交边界：迭代壳里没有 tools ⇒ 折入客户端已知的该迭代工具（不消失）');
{
  let s: ChatState = started();
  s = running(s, 1, tool('c1', 1, 'running'), 10);
  s = commitShellOnly(s, 1, 20);          // 服务端只提交壳
  s = advance(s, 2, 30);
  ok('★A 迭代 1 提交后**仍有 1 个工具**（旧实现 = 0 ⇒ pill 消失）', iterTools(s, 1) === 1);
  ok('★A 迭代号连续：[1]（没有因为"没工具"被整条丢掉）', iterNums(s).join(',') === '1');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 同号覆盖：后续帧再送"更少工具"的同一迭代 ⇒ 工具只增不减');
{
  let s: ChatState = started();
  s = running(s, 1, tool('c1', 1, 'running'), 10);
  s = commitShellOnly(s, 1, 20);
  // 再来一帧：同号、tools 为空（服务端重发轻快照）
  const again: WebIteration = {
    iteration: 1, content: '', reasoning: '', tools: [], toolCount: 0,
  } as unknown as WebIteration;
  s = reduce(s, {
    type: 'iteration', turnID: T, seq: eventSeq(40), iter: iterNum(1),
    content: '', reasoning: '', activeTools: [], completedTools: [], iterationsDelta: [again],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
  ok('★B 重发轻快照后工具**仍在**（1 个）', iterTools(s, 1) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 多迭代连续：3 个迭代各自的工具都在，号连续 [1,2,3]');
{
  let s: ChatState = started();
  for (let n = 1; n <= 3; n++) {
    s = running(s, n, tool(`c${n}`, n, 'running'), 10 * n);
    s = commitShellOnly(s, n, 10 * n + 1);
    s = advance(s, n + 1, 10 * n + 2);
  }
  ok('★C 迭代号连续 [1,2,3]', iterNums(s).join(',') === '1,2,3');
  ok('★C 每个迭代各保留 1 个工具', iterTools(s, 1) === 1 && iterTools(s, 2) === 1 && iterTools(s, 3) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 不误补：别的迭代的工具**不得**被折进本迭代');
{
  let s: ChatState = started();
  s = running(s, 1, tool('c1', 1, 'running'), 10);
  s = commitShellOnly(s, 1, 20);
  s = advance(s, 2, 30);
  s = running(s, 2, tool('c2', 2, 'running'), 40);
  s = commitShellOnly(s, 2, 50);
  ok('★D 迭代 1 只有 c1（1 个）', iterTools(s, 1) === 1);
  ok('★D 迭代 2 只有 c2（1 个）', iterTools(s, 2) === 1);
}

console.log('\n▶ §E mutation 自证（外部注入，逐条必红）');
console.log('   · 去掉 `foldKnownToolsIntoCommitted` 调用 ⇒ §A 的 iterTools(1) 变 0');
console.log('   · 去掉 `mergeIterations` 里的"保留 prev 工具"分支 ⇒ §B 变 0');
console.log('   · 把归属判据 `ti === num` 放宽成"全部工具" ⇒ §D 必红（跨迭代串工具）');

console.log(`\n  iteration_continuity: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
