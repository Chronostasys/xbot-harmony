/**
 * stale_live_iteration —— 用户 2026-10-20 P0：
 *   「倒数第二个迭代的思考无条件重复渲染到下一个迭代，直到那个迭代真实 SSE 到达」
 *
 * 根因：SSE 可能乱序。当前 live 已到 iter N+1，迟到的 iter N stream/iteration
 * 帧在旧逻辑里 `advanced=false`，于是它的 content/reasoning 被写进 N+1 的 live
 * 快照 ⇒ 上一迭代的「思考」被渲染到下一迭代。旧迭代帧必须整帧丢弃。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState, iterNum, turnID, ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';

const T1 = turnID(1);
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function run(events: readonly DomainEvent[], from: ChatState = initialChatState('chat-stale-iter')): ChatState {
  return events.reduce(reduce, from);
}

function liveOf(s: ChatState): { content: string; reasoning: string; iter: number } | null {
  const t = s.turns.get(T1);
  if (t === undefined || t.phase.kind !== 'live') return null;
  return {
    content: t.phase.data.content,
    reasoning: t.phase.data.reasoning,
    iter: t.phase.data.iter,
  };
}

const started: DomainEvent = {
  type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null,
};

const newIter: DomainEvent = {
  type: 'iteration', turnID: T1, iter: iterNum(2), seq: 10 as never,
  content: '新迭代正文' as never, reasoning: '新迭代思考' as never,
  activeTools: [], completedTools: [], iterationsDelta: [], todos: undefined,
  subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
};

const staleStream: DomainEvent = {
  type: 'stream', turnID: T1, seq: null, iteration: iterNum(1),
  content: '旧迭代正文' as never, reasoning: '旧迭代思考' as never,
  streamingTools: undefined, genui: undefined, streamStats: undefined,
};

const staleIteration: DomainEvent = {
  type: 'iteration', turnID: T1, iter: iterNum(1), seq: 9 as never,
  content: '旧迭代正文2' as never, reasoning: '旧迭代思考2' as never,
  activeTools: [], completedTools: [], iterationsDelta: [], todos: undefined,
  subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
};

function main(): void {
  console.log('\n▶ 迟到旧迭代的 SSE 不得污染当前 live 迭代');
  const s = run([started, newIter]);
  const before = liveOf(s);
  ok('前置：live 在 iter 2', before !== null && before.iter === 2);
  ok('前置：iter 2 有自己的思考', before !== null && before.reasoning === '新迭代思考');

  const afterStream = liveOf(run([staleStream], s));
  ok('旧 iter 1 的 stream 被丢弃', afterStream !== null
    && afterStream.iter === 2 && afterStream.content === '新迭代正文'
    && afterStream.reasoning === '新迭代思考');

  const afterIter = liveOf(run([staleIteration], s));
  ok('旧 iter 1 的 iteration 被丢弃', afterIter !== null
    && afterIter.iter === 2 && afterIter.content === '新迭代正文'
    && afterIter.reasoning === '新迭代思考');

  if (fail > 0) {
    console.log(`  stale_live_iteration: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  stale_live_iteration: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();

export {};
