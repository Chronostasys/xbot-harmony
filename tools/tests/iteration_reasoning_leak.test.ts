/**
 * iteration_reasoning_leak.test.ts —— 「上一迭代的思考泄露到下一迭代」的判别力判据。
 *
 * 用户 2026-10-21 亲报（**100% 复现**）：
 *   「把前台长 shell 手动『转后台』之后，被我转到后台的那个迭代的**思考直接跑到了下一个迭代**，
 *     出现**两段完全一样的思考**（截图：思考 406 字 ×2），直到下一个迭代的真实 SSE 到达才恢复。」
 *
 * 根因（状态机层）：转后台 ⇒ 该工具立即返回 ⇒ 服务端**提交该迭代并推进到下一迭代**，
 * 而推进事件自带的 `content`/`reasoning` 仍是**刚提交那一迭代的文本**（与 `active_tools`
 * 残留同族的服务端行为）。旧实现 `advanced ? (ev.reasoning ?? '')` 直接采信 ⇒ 新迭代的在飞块
 * 把上一迭代的思考再画一遍（历史块里已有一份）。
 *
 * 修法：`core/reduce.ts:isLeftoverText` —— 前进事件自带的文字与**上一帧同名字段等长** ⇒ 视为
 * 残留副本、丢弃（新迭代从空开始）。只比长度（禁止全文比较去重的同一纪律）。
 *
 * mutation 自证：把 `isLeftoverText` 改回恒 `false`（即采信 ev.reasoning）⇒ §A 必红。
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
const REASON = 'R'.repeat(406);
const SHELL: WebToolProgress = {
  name: 'Shell', label: 'Shell', status: 'running', callID: 'call-1', iteration: 1,
} as unknown as WebToolProgress;

function started(): ChatState {
  return reduce(initialChatState('c'), {
    type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null,
  } as unknown as DomainEvent);
}
/** 迭代 1 流式产出思考（转后台前）。 */
function withReasoning(s: ChatState): ChatState {
  return reduce(s, {
    type: 'stream', turnID: T, seq: eventSeq(10), iteration: iterNum(1),
    content: '', reasoning: REASON, streamingTools: [SHELL], genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
/**
 * 服务端提交迭代 1（工具转后台 ⇒ 工具调用立即返回），再推进到迭代 2。
 *  `cContent/cReason` = 提交进 `iteration_history` 的内容；`aContent/aReason` = 推进事件自带的文字
 *  （生产里常是上一迭代的副本 —— 正是本 bug 的形态）。
 */
function commitThenAdvance(s: ChatState, cContent: string, cReason: string,
  aContent: string, aReason: string): ChatState {
  const commit: DomainEvent = {
    type: 'iteration', turnID: T, iter: iterNum(1), seq: eventSeq(20),
    content: cContent, reasoning: cReason, activeTools: [], completedTools: [SHELL],
    iterationsDelta: [{
      iteration: 1, content: cContent, reasoning: cReason, tools: [SHELL], toolCount: 1,
    } as unknown as WebIteration],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
  const s1: ChatState = reduce(s, commit);
  const advance: DomainEvent = {
    type: 'iteration', turnID: T, iter: iterNum(2), seq: eventSeq(30),
    content: aContent, reasoning: aReason, activeTools: [], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined,
    tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
  return reduce(s1, advance);
}

function liveOf(s: ChatState): LiveRowView {
  const rows: readonly Row[] = deriveRows(s);
  for (let i = 0; i < rows.length; i++) {
    const r: Row = rows[i];
    if (r.kind === 'live') { return r; }
  }
  throw new Error('没有 live 行（构造器坏了 —— 零扫描防线）');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 转后台：推进事件带上一迭代 reasoning ⇒ 新迭代在飞块必须**不带**它');
{
  const s: ChatState = commitThenAdvance(withReasoning(started()), '', REASON, '', REASON);
  const live: LiveRowView = liveOf(s);
  ok('★A 迭代号已推进到 2（前置条件：确实发生了前进）', live.lastIter === 2);
  ok('★A 新迭代的在飞 reasoning 为空（否则就是「思考 406 字」重复渲染）', live.reasoning === '');
  ok('★A 已提交的迭代 1 仍保留完整思考（内容不丢）',
    live.iterations.length === 1 && (live.iterations[0].reasoning ?? '') === REASON);
  ok('★A 零扫描防线：已提交块带该思考（不是"两处都没了"）',
    (live.iterations[0].reasoning ?? '').length === 406);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 不误伤：前进事件带**新**文本（长度不同）⇒ 必须保留');
{
  const fresh = 'N'.repeat(120);
  const s: ChatState = commitThenAdvance(withReasoning(started()), '', REASON, '', fresh);
  const live: LiveRowView = liveOf(s);
  ok('★B 新迭代拿到了自己的思考（120 字）', live.reasoning === fresh);
  ok('★B 已提交的迭代 1 仍是 406 字的旧思考',
    live.iterations.length === 1 && (live.iterations[0].reasoning ?? '').length === 406);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 正文同理（转后台时正文也可能被复制到新迭代）');
{
  const body = 'B'.repeat(200);
  const s: ChatState = commitThenAdvance(withReasoning(started()), body, REASON, body, REASON);
  const live: LiveRowView = liveOf(s);
  ok('★C 新迭代的在飞正文为空（不重复历史块里的正文）', live.content === '');
  ok('★C 已提交的迭代 1 保留正文', (live.iterations[0].content ?? '') === body);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 同一迭代内的 stream 帧不受影响（不清空正常流式文本）');
{
  let s: ChatState = withReasoning(started());
  s = reduce(s, {
    type: 'stream', turnID: T, seq: eventSeq(40), iteration: iterNum(1),
    content: 'hello', reasoning: REASON + 'more', streamingTools: undefined,
    genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
  const live: LiveRowView = liveOf(s);
  ok('★D 未前进的流式帧照常采用新文本', live.reasoning === REASON + 'more');
}

console.log('\n▶ §E mutation 自证（外部注入）：把 `isLeftoverText` 改成恒 false ⇒ §A/§C 必红');

console.log(`\n  iteration_reasoning_leak: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
