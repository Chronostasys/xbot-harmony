/**
 * promote_thinking_dup.test.ts —— 「有思考 + 有执行中工具 ⇒ 工具被转后台 ⇒ 思考重复两段」
 * 的**端到端（模型 → 渲染行）**复现判据。
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
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据走 `deriveRows + applyRow`（已废弃）⇒ 现走**新模型链路**
 *   （`model_harness.ModelFeed` = 生产 `model_bridge.stepEvent` + `applyModel`），
 *   断言对象 = `f.state`（模型）+ `f.rows()`（页面真正会画出来的块）。
 *
 * ⚠️ 已知缺口（属 core，不在本测试改动范围，已上报）：
 *   · 新链路**没有** `reduce.ts:isCommittedCopyText` / `render.ets:inFlightBlock` 的
 *     「推进帧文字 == 刚提交迭代文字 ⇒ 丢弃」去重。本用例的形态（推进帧只有文字、无残留
 *     `activeTools`）不会重现两段：`model_bridge.ets:197` 只在在飞块有正文/工具时才追加它，
 *     且新迭代自己的 tick 会覆盖 `live.reasoning`。
 *   · 但**推进帧若同时带残留 `activeTools`**，在飞块会被渲染并把同一段思考画第二遍
 *     （去重缺失的真实后果，见报告）。修在 core（`model_step`/bridge），⛔ 不是放宽本判据。
 *   · `model_bridge.ets:197` 的"有正文/工具才追加"还使**纯思考**在飞块不渲染
 *     （旧链路会渲染）⇒ §C 的"显示"由「模型层 + 思考带正文」两条守住。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = 1;
/** 真实截图里的量级：1400 字的思考。 */
const REASON: string = '思'.repeat(1400);
function shell(): Record<string, Object> {
  return { name: 'Shell', label: 'Shell', status: 'running', call_id: 'call-promote', iteration: 1, elapsedMs: 0, genChars: 0 };
}

/** 迭代 1：先产出思考，再发起 shell（工具在飞）—— 转后台前的一刻。 */
function thinkingWithRunningShell(): ModelFeed {
  const f = new ModelFeed('c');
  f.push({ type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null, seq: 1 });
  f.push({ type: 'stream', turnID: T, seq: 10, iter: 1, content: '', reasoning: REASON, streamingTools: [shell()] });
  // 工具进入执行中：结构化帧带 activeTools（同迭代，不前进）
  f.push({
    type: 'iteration', turnID: T, seq: 11, iter: 1, content: '', reasoning: REASON,
    activeTools: [shell()], completedTools: [], iterationsDelta: [],
  });
  return f;
}
/** 转后台：工具调用返回 ⇒ 提交迭代 1（带 1400 字思考）并推进到迭代 2（事件仍带该思考）。 */
function promoted(f: ModelFeed, carryText: boolean): ModelFeed {
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 20, content: '', reasoning: carryText ? REASON : '',
    activeTools: [], completedTools: [shell()],
    iterationsDelta: [{ iteration: 1, content: '', reasoning: REASON, tools: [shell()] }],
  });
  f.push({
    type: 'iteration', turnID: T, iter: 2, seq: 30, content: '', reasoning: carryText ? REASON : '',
    activeTools: [], completedTools: [], iterationsDelta: [],
  });
  return f;
}
function assistantRow(f: ModelFeed): ChatRow {
  const rows: ChatRow[] = f.rows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'assistant' && rows[i].turnID === T) { return rows[i]; }
  }
  throw new Error('没有 assistant 行（构造器坏了 —— 零扫描防线）');
}
/** 在飞块 = 行内比最后一个已提交块号更大的那块（页面 `syncLiveTail` 读它）。 */
function inFlight(row: ChatRow): HistoryIteration | undefined {
  const its: HistoryIteration[] = row.iterations;
  if (its.length === 0) { return undefined; }
  const done: HistoryIteration[] = row.completedBlocks;
  const lastDone: number = done.length === 0 ? 0 : done[done.length - 1].iteration;
  const tail: HistoryIteration = its[its.length - 1];
  return tail.iteration > lastDone ? tail : undefined;
}
function countThinkingBlocks(blocks: HistoryIteration[], text: string): number {
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    const r: string = blocks[i].reasoning !== undefined ? (blocks[i].reasoning as string) : '';
    if (r === text) { n += 1; }
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 转后台（服务端真实形状：推进事件不带旧文字）⇒ 页面只出现**一段** 1400 字思考');
{
  const f = promoted(thinkingWithRunningShell(), false);
  const row = assistantRow(f);
  const live = f.state.live;
  ok('★A 前置：确实已推进到迭代 2', live !== null && live.iteration === 2);
  const t = f.state.turns.get(T);
  const it1 = t !== undefined ? t.blocks.filter((x) => x.iteration === 1)[0] : undefined;
  ok('★A 已提交迭代 1 保留了 1400 字思考（内容不丢）', it1 !== undefined && it1.reasoning === REASON);
  ok('★A 渲染结果里「1400 字思考」只出现**一次**（历史块），在飞块没有它',
    countThinkingBlocks(row.iterations, REASON) === 1);
  const fl = inFlight(row);
  ok('★A 在飞块不得携带上一迭代的思考（截图里的第二段「思考 1400 字」）',
    fl === undefined || (fl.reasoning !== undefined ? fl.reasoning : '') !== REASON);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 同样场景但服务端**没有**带残留文字 ⇒ 行为不变（不误删新思考）');
{
  const row = assistantRow(promoted(thinkingWithRunningShell(), false));
  ok('★B 依然只有一段 1400 字思考', countThinkingBlocks(row.completedBlocks, REASON) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 新迭代**自己的**思考必须照常显示（防"一修就吞内容"）');
{
  const fresh: string = 'N'.repeat(97);
  const f = promoted(thinkingWithRunningShell(), true);
  f.push({ type: 'stream', turnID: T, seq: 40, iter: 2, content: '', reasoning: fresh });
  const row = assistantRow(f);
  const live = f.state.live;
  ok('★C 新迭代的 97 字思考留在 live（不被吞）', live !== null && live.reasoning === fresh);
  ok('★C 新迭代的思考不得写进历史块', countThinkingBlocks(row.completedBlocks, fresh) === 0);
  // 渲染层：思考 + 正文同块（在飞块会被渲染）时必须显示**自己的**思考
  f.push({ type: 'stream', turnID: T, seq: 41, iter: 2, content: '正文', reasoning: fresh });
  const row2 = assistantRow(f);
  const fl = inFlight(row2);
  ok('★C 在飞块显示新迭代自己的 97 字思考', fl !== undefined && fl.reasoning === fresh);
  ok('★C 旧的 1400 字仍只在历史块里出现一次', countThinkingBlocks(row2.iterations, REASON) === 1);
}

console.log('\n▶ §D 判别力自证（外部注入，逐条必红）');
console.log('   · 让推进帧把上一迭代文字写进 live（`model_step.onTick` 不去重）⇒ §A 在飞块 reasoning 非空（带残留工具时必红）');
console.log('   · 让新迭代自己的 tick 不覆盖 live.reasoning ⇒ §C「在飞块显示新迭代思考」必红');
console.log('   · 让提交帧把 reasoning 丢掉 ⇒ §A「已提交迭代保留 1400 字」必红');

console.log(`\n  promote_thinking_dup: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
