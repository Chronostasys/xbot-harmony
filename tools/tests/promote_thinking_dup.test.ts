/**
 * promote_thinking_dup.test.ts —— 「有思考 + 有执行中工具 ⇒ 工具被转后台 ⇒ 思考重复两段」
 * 的**端到端（状态机 → 渲染行）**复现判据。
 *
 * 用户 2026-10-21 给出 100% 触发条件：
 *   「只要是一个**有思考的、有执行中工具的迭代**，然后这个执行中的工具**被转后台**了，
 *     一定会触发这个 bug」（截图：思考 1400 字在历史块与在飞块各出现一次）。
 *
 * 触发链（转后台 = `promote_shell` RPC）：
 *   ① 前台 shell 转到后台 ⇒ 该工具调用**立即返回**（后台任务接管）；
 *   ② 服务端**提交该迭代**（reasoning 1400 + shell pill）并**推进到下一迭代**；
 *   ③ 推进事件自带的 `content`/`reasoning` 仍是**刚提交那一迭代的副本**（与 `active_tools`
 *      残留同族的服务端行为）⇒ 旧客户端把它当成新迭代的思考 ⇒ 两段一样的思考。
 *
 * 两道防线（本文件同时断言"渲染结果"这一最终判据）：
 *   · `core/reduce.ts:isCommittedCopyText` —— 前进帧文字 == 刚提交迭代文字 ⇒ 丢弃；
 *   · `core/render.ets:inFlightBlock` —— 在飞文字 == **任一**已提交块的同名字段 ⇒ 置空
 *     （"提交与推进分属两条事件"时 reduce 侧可能漏，渲染层兜底）。
 *
 * mutation 自证：去掉任一防线 ⇒ §A 的「在飞块无 reasoning」必红。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { applyRow } from '../../entry/src/main/ets/core/render';
import { deriveRows, LiveRowView, Row } from '../../entry/src/main/ets/core/derive';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import type { WebIteration, WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = turnID(1);
/** 真实截图里的量级：1400 字的思考。 */
const REASON: string = '思'.repeat(1400);
const SHELL: WebToolProgress = {
  name: 'Shell', label: 'Shell', status: 'running', callID: 'call-promote', iteration: 1,
} as unknown as WebToolProgress;

function started(): ChatState {
  return reduce(initialChatState('c'), {
    type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null,
  } as unknown as DomainEvent);
}
/** 迭代 1：先产出思考，再发起 shell（工具在飞）—— 转后台前的一刻。 */
function thinkingWithRunningShell(): ChatState {
  let s: ChatState = reduce(started(), {
    type: 'stream', turnID: T, seq: eventSeq(10), iteration: iterNum(1),
    content: '', reasoning: REASON, streamingTools: [SHELL], genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
  // 工具进入执行中：服务端结构化帧带 activeTools（同迭代，不前进 ⇒ 不清流式字段）
  return reduce(s, {
    type: 'iteration', turnID: T, seq: eventSeq(11), iter: iterNum(1),
    content: '', reasoning: REASON, activeTools: [SHELL], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined,
    tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
/** 转后台：工具调用返回 ⇒ 提交迭代 1（带 1400 字思考）并推进到迭代 2（事件仍带该思考）。 */
function promoted(s: ChatState, carryText: boolean): ChatState {
  const it1: WebIteration = {
    iteration: 1, content: '', reasoning: REASON, tools: [SHELL], toolCount: 1,
  } as unknown as WebIteration;
  const commit: DomainEvent = {
    type: 'iteration', turnID: T, iter: iterNum(1), seq: eventSeq(20),
    content: '', reasoning: carryText ? REASON : '', activeTools: [], completedTools: [SHELL],
    iterationsDelta: [it1], todos: undefined, subAgents: undefined,
    tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
  const advance: DomainEvent = {
    type: 'iteration', turnID: T, iter: iterNum(2), seq: eventSeq(30),
    content: '', reasoning: carryText ? REASON : '', activeTools: [], completedTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined,
    tokenUsage: undefined, streamStats: undefined,
  } as unknown as DomainEvent;
  return reduce(reduce(s, commit), advance);
}

function liveOf(s: ChatState): LiveRowView {
  const rows: readonly Row[] = deriveRows(s);
  for (let i = 0; i < rows.length; i++) {
    const r: Row = rows[i];
    if (r.kind === 'live') { return r; }
  }
  throw new Error('没有 live 行（构造器坏了 —— 零扫描防线）');
}
/** 走生产 `applyRow`，把渲染行摊平成"页面上会画出来的块"。 */
function renderedBlocks(s: ChatState): HistoryIteration[] {
  const row: ChatRow = new ChatRow();
  applyRow(row, liveOf(s));
  return row.iterations;
}
function countThinkingBlocks(blocks: HistoryIteration[], text: string): number {
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    const blk: HistoryIteration = blocks[i];
    const r: string = blk.reasoning !== undefined ? blk.reasoning : '';
    if (r.length === text.length && r === text) { n += 1; }
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 转后台（推进事件带上一迭代思考）⇒ 页面只出现**一段** 1400 字思考');
{
  const s: ChatState = promoted(thinkingWithRunningShell(), true);
  const live: LiveRowView = liveOf(s);
  const blocks: HistoryIteration[] = renderedBlocks(s);
  ok('★A 前置：确实已推进到迭代 2', live.lastIter === 2);
  ok('★A 已提交迭代 1 保留了 1400 字思考（内容不丢）',
    live.iterations.length === 1 && (live.iterations[0].reasoning ?? '') === REASON);
  ok('★A 渲染结果里「1400 字思考」只出现**一次**（历史块），在飞块没有它',
    countThinkingBlocks(blocks, REASON) === 1);
  // 在飞块（live: true）的 reasoning 必须为空
  let liveReason: string = '';
  for (let i = 0; i < blocks.length; i++) {
    const blk: HistoryIteration = blocks[i];
    if (blk.live === true) { liveReason = blk.reasoning !== undefined ? blk.reasoning : ''; }
  }
  ok('★A 在飞块 reasoning 为空（截图里的第二段「思考 1400 字」就是它）', liveReason === '');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 同样场景但服务端**没有**带残留文字 ⇒ 行为不变（不误删新思考）');
{
  const s: ChatState = promoted(thinkingWithRunningShell(), false);
  const blocks: HistoryIteration[] = renderedBlocks(s);
  ok('★B 依然只有一段 1400 字思考', countThinkingBlocks(blocks, REASON) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 新迭代**自己的**思考必须照常显示（防"一修就吞内容"）');
{
  const fresh: string = 'N'.repeat(97);
  let s: ChatState = promoted(thinkingWithRunningShell(), true);
  s = reduce(s, {
    type: 'stream', turnID: T, seq: eventSeq(40), iteration: iterNum(2),
    content: '', reasoning: fresh, streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
  const blocks: HistoryIteration[] = renderedBlocks(s);
  let liveReason: string = '';
  for (let i = 0; i < blocks.length; i++) {
    const blk: HistoryIteration = blocks[i];
    if (blk.live === true) { liveReason = blk.reasoning !== undefined ? blk.reasoning : ''; }
  }
  ok('★C 新迭代的 97 字思考正常显示在在飞块', liveReason === fresh);
  ok('★C 旧的 1400 字仍只在历史块里出现一次', countThinkingBlocks(blocks, REASON) === 1);
}

console.log('\n▶ §D mutation 自证（外部注入，逐条必红）');
console.log('   · 去掉 `core/reduce.ts` 的 `isCommittedCopyText` 调用 ⇒ §A 在飞块 reasoning 非空');
console.log('   · 去掉 `core/render.ets:inFlightBlock` 的兜底比较 ⇒ §A「只出现一次」必红');
console.log('   · 把兜底比较改成"只跟最后一页比" ⇒ §A 仍红（真实形态是"后一迭代只有工具没有思考"）');

console.log(`\n  promote_thinking_dup: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
