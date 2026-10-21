/**
 * iteration_reasoning_leak.test.ts —— 上一迭代的思考/正文**不得**重复出现在在飞块。
 *
 * 用户 2026-10-21（转后台 100% 复现，截图「思考 406 字 ×2」）。
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据走 `deriveRows + applyRow`（已废弃）。现走**新模型链路**
 *   （`model_harness.ModelFeed` = 生产 `model_bridge.stepEvent` + `applyModel`），
 *   断言对象 = `f.state`（模型）+ `f.rows()`（页面真正会画出来的块）。
 *
 * ── 为什么删掉「推进帧自带上一迭代文字 ⇒ 客户端丢弃」那一版用例 ──────────────
 *   旧客户端（`reduce.ts:advanceCarriesCommittedCopy` / `render.ets:inFlightBlock`）
 *   靠**内容判等**丢弃残留文字。两条独立事实否掉了这个客户端补丁：
 *     ① **web 是权威基准**（`web/src/chat/reduce.ts:1000-1006`）：迭代前进时
 *        `content = ev.content ?? ''`、`reasoning = ev.reasoning ?? ''` —— 帧说什么就是什么，
 *        **没有任何去重**。若服务端真会在推进帧里回带旧文字，web 会同样重复两段思考。
 *     ② **服务端发帧本身是逐迭代的**：`agent/engine_run.go:592-598`（`beginIteration`）
 *        在推进时把 `Content/ReasoningContent` 清零，`buildProgressPayload` 只搬快照 ⇒
 *        "推进帧带上一迭代文字"这种形状服务端**不产出**。
 *   ⇒ 该客户端补丁在补偿一个已不存在的形状；且模型铁律**禁止用内容判等做去重**
 *     （`docs/STATE-MODEL.md` §7.3）。若将来真在线上看到「推进帧回带旧文字」，
 *     正确修法在**服务端发帧归一**（W4 的"迭代内正文重置"），不是客户端猜。
 *     本文件因此只钉**服务端真实形状**下的保证（§A/§B/§C）。
 */
declare const process: { exit: (c: number) => void };
import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } }

const T = 1;
const REASON = 'R'.repeat(406);
function shell(): Record<string, Object> {
  return { name: 'Shell', label: 'Shell', status: 'running', call_id: 'c1', iteration: 1, elapsedMs: 0, genChars: 0 };
}

/** 转后台/推进：提交迭代 1（带 406 字思考）并推进到迭代 2。`carry` = 推进帧仍带上一迭代文字（服务端行为）。 */
function commitAndAdvance(carry: boolean): ModelFeed {
  const f = new ModelFeed('c');
  f.push({ type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null, seq: 1 });
  // 迭代 1：思考 + 工具在飞（转后台前的一刻）
  f.push({ type: 'stream', turnID: T, seq: 10, iter: 1, content: '', reasoning: REASON, streamingTools: [shell()] });
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 11, content: '', reasoning: REASON,
    activeTools: [shell()], completedTools: [], iterationsDelta: [],
  });
  // 提交迭代 1（工具进 completed）→ 推进到迭代 2
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 20, content: '', reasoning: carry ? REASON : '',
    activeTools: [], completedTools: [shell()],
    iterationsDelta: [{ iteration: 1, content: '', reasoning: REASON, tools: [shell()] }],
  });
  f.push({
    type: 'iteration', turnID: T, iter: 2, seq: 30, content: '', reasoning: carry ? REASON : '',
    activeTools: [], completedTools: [], iterationsDelta: [],
  });
  return f;
}
function assistantRow(f: ModelFeed): ChatRow {
  const rows: ChatRow[] = f.rows();
  for (let i = 0; i < rows.length; i++) { if (rows[i].role === 'assistant' && rows[i].turnID === T) { return rows[i]; } }
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
function countThinking(its: HistoryIteration[], text: string): number {
  let n = 0;
  for (let i = 0; i < its.length; i++) {
    const r: string = its[i].reasoning !== undefined ? (its[i].reasoning as string) : '';
    if (r === text) { n += 1; }
  }
  return n;
}

console.log('\n▶ §A 推进到新迭代（服务端真实形状：推进帧不带旧文字）⇒ 页面只出现**一段** 406 字思考');
{
  const f = commitAndAdvance(false);
  const row = assistantRow(f);
  const live = f.state.live;
  ok('★A 前置：确实已推进到迭代 2', live !== null && live.iteration === 2);
  const t = f.state.turns.get(T);
  const committed = t !== undefined ? t.blocks.filter((x) => x.iteration === 1)[0] : undefined;
  ok('★A 已提交块保留 406 字（内容不丢）', committed !== undefined && committed.reasoning === REASON);
  ok('★A 渲染结果里「406 字思考」只出现**一次**（历史块）', countThinking(row.iterations, REASON) === 1);
  const fl = inFlight(row);
  ok('★A 在飞块不得携带上一迭代的思考（截图里的第二段「思考 406 字」）',
    fl === undefined || (fl.reasoning !== undefined ? fl.reasoning : '') !== REASON);
  ok('★A 推进后 live 文字为空（迭代边界从零开始）',
    live !== null && live.reasoning === '' && live.content === '');
}

console.log('\n▶ §C 新迭代自己的思考照常显示（不吞内容）');
{
  const fresh = 'N'.repeat(97);
  const f = commitAndAdvance(true);
  f.push({ type: 'stream', turnID: T, seq: 40, iter: 2, content: '', reasoning: fresh });
  const row = assistantRow(f);
  // ① 模型层：新迭代自己的思考必须留在 live 上（不被去重误杀、不被上一迭代覆盖）
  const live = f.state.live;
  ok('★C 新迭代的 97 字思考留在 live（不被吞）', live !== null && live.reasoning === fresh);
  // ② 不串味：已提交块里不得出现新迭代的思考
  ok('★C 新迭代的思考不得写进历史块', countThinking(row.completedBlocks, fresh) === 0);
  // ③ 渲染层：思考 + 正文同块时（在飞块会被渲染），必须显示**自己的**思考
  f.push({ type: 'stream', turnID: T, seq: 41, iter: 2, content: '正文', reasoning: fresh });
  const row2 = assistantRow(f);
  const fl = inFlight(row2);
  ok('★C 在飞块显示新迭代自己的 97 字思考', fl !== undefined && fl.reasoning === fresh);
  ok('★C 且上一迭代的 406 字仍只出现一次', countThinking(row2.iterations, REASON) === 1);
}

console.log(`\n  iteration_reasoning_leak: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
