/**
 * live_iter_dedupe —— P0（用户 2026-10-17 亲报）：**迭代完成后突然变成两个一模一样的 iter，
 * 再下一个迭代时恢复正常**。
 *
 * ── 旧链路（已废弃）─────────────────────────────────────────────────────────────
 *  "同一个 iteration 号"在语义上**永远是同一个迭代**。旧渲染层两处会并排渲染两次：
 *   ① `liveIterations` 在「已提交同号块是空壳」分支直接 **append** 在飞块 ⇒ 同号两块；
 *   ② 上游任何路径（reduce merge / fold / finalizer / 增量 delta）让同一个号出现两次时，
 *      渲染层**没有任何兜底** ⇒ 修法是在渲染边界**就地合并且兜底收敛**
 *      （`collapseSameNumberBlocks`：工具按 key 并集、正文非空者胜、live 取或）。
 *
 * ── 新链路（本判据）────────────────────────────────────────────────────────────
 *  同号块**在模型里不可表示**（T5(a)：`blocks` 迭代号**严格递增**）：
 *   · `onDone` 对 `iteration <= 最后块号` 的块**整块丢弃**（不覆盖、不追加）；
 *   · 提交某迭代 ⇒ `live` 若同号即清空（`liveAt(...) !== null ⇒ live = null`）；
 *   · 投影「一块一迭代」原样交出（不合并/不去重）。
 *  ⇒ 旧的"合并语义"（工具并集 / 正文非空者胜）**整体消失** —— 不是被本测试放弃，而是
 *    不再需要：同号重复**根本进不来**，且提交块是权威（`docs/STATE-MODEL.md` T4/T5(a)）。
 *    本文件因此改钉**更强**的保证：同号重复输入 ⇒ 只有一个块，且**首块（权威）不被改写**。
 *
 * ⛔ mutation 自证：让 `onDone` 接受同号块（去掉 `iteration <= last ⇒ 丢弃`）⇒ ①② 必红。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';
import type { Block, TurnRec } from '../../entry/src/main/ets/core/model_types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const TURN = 1;

function tw(name: string, status: string, callId: string): Record<string, Object> {
  return { name, label: name, status, callID: callId, iteration: 0, elapsedMs: 0, summary: '', detail: '', args: '' };
}

function tick(seq: number, iter: number, content: string, active: Record<string, Object>[]): Record<string, unknown> {
  return {
    type: 'iteration', turnID: TURN, iter, seq, phase: 'tool_exec',
    content, reasoning: '', activeTools: active, completedTools: [], streamingTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  };
}

function commit(seq: number, iter: number, content: string, tools: Record<string, Object>[]): Record<string, unknown> {
  return {
    type: 'iteration', turnID: TURN, iter, seq, phase: 'tool_exec',
    content: '', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [{ iteration: iter, content, reasoning: '', tools, toolCount: tools.length }],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  };
}

function started(seq: number, turn: number = TURN): Record<string, unknown> {
  return { type: 'turn_started', turnID: turn, requestID: null, trigger: 'user', content: '', seq };
}

function blocksOf(f: ModelFeed, turn: number = TURN): Block[] {
  const t: TurnRec | undefined = f.state.turns.get(turn);
  return t === undefined ? [] : t.blocks.slice();
}

/** 渲染行里同号块的最大重复次数（>1 ⇒ 用户会看到两块一模一样的 iter）。 */
function maxSameNumber(rows: ChatRow[]): number {
  const m: Map<number, number> = new Map<number, number>();
  for (let r = 0; r < rows.length; r++) {
    const its: HistoryIteration[] = rows[r].iterations;
    for (let i = 0; i < its.length; i++) {
      const n: number = its[i].iteration;
      m.set(n, (m.get(n) ?? 0) + 1);
    }
  }
  let mx = 0;
  m.forEach((v: number) => { if (v > mx) { mx = v; } });
  return mx;
}

function rowOf(f: ModelFeed): ChatRow | undefined {
  const rows: ChatRow[] = f.rows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'assistant') { return rows[i]; }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ ① 同号块不可表示（替代旧的 collapseSameNumberBlocks 兜底）');
{
  // ①-a 提交块带工具 + 在飞同号 ⇒ 提交后只剩一块
  const f = new ModelFeed('chat-iter-dedupe');
  f.push(started(1));
  f.push(tick(2, 1, 'A', [tw('Shell', 'running', 'c1')]));
  f.push(commit(3, 1, 'A', [tw('Shell', 'done', 'c1')]));
  eq('①a 提交后只有 1 块', blocksOf(f).length, 1);
  eq('①a 渲染行同号重复数 ≤ 1', maxSameNumber(f.rows()), 1);
  eq('①a live 已清（不与提交块并排）', f.state.live, null);
  eq('①a 正文来自提交块', blocksOf(f)[0].content, 'A');
  eq('①a 工具数 = 1', blocksOf(f)[0].tools.length, 1);

  // ①-b 同号重发（更少工具/不同正文）⇒ 整块丢弃，**首块不被改写**（不丢正文、不丢工具）
  f.push(commit(4, 1, 'B', [tw('Shell', 'done', 'c2')]));
  eq('①b 同号重发后仍只有 1 块', blocksOf(f).length, 1);
  eq('①b 正文未被改写', blocksOf(f)[0].content, 'A');
  eq('①b 工具未被改写（仍 c1，不并集、不覆盖）', blocksOf(f)[0].tools.map((t: { call: string }) => t.call), ['c1']);
  eq('①b 渲染行同号重复数 ≤ 1', maxSameNumber(f.rows()), 1);

  // ①-c 不同号原样保留（顺序不变）
  const g = new ModelFeed('chat-iter-dedupe2');
  g.push(started(1));
  g.push(commit(2, 1, 'a', []));
  g.push(commit(3, 2, 'b', []));
  g.push(commit(4, 3, 'c', []));
  eq('①c 不同号原样保留（顺序不变）', blocksOf(g).map((b) => b.iteration), [1, 2, 3]);
  eq('①c 渲染行同号重复数 = 1', maxSameNumber(g.rows()), 1);

  // ①-d 在飞与提交同号（转后台/推进帧带上一迭代正文的形态）⇒ 不并排两块
  const h = new ModelFeed('chat-iter-dedupe3');
  h.push(started(1));
  h.push(tick(2, 1, '真正文', []));
  h.push(commit(3, 1, '真正文', []));
  const row = rowOf(h);
  const its: HistoryIteration[] = row === undefined ? [] : row.iterations;
  eq('①d live 行只 1 块', its.length, 1);
  eq('①d 同号重复数 ≤ 1', maxSameNumber(h.rows()), 1);
  eq('①d 正文不丢', its.length > 0 ? its[0].content : '', '真正文');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ ② 黑盒：完成帧（提交 + text_final）前后，渲染行都不得出现同号重复');
{
  const f = new ModelFeed('chat-iter-dedupe4');
  const T = 5;
  f.push(started(2, T));
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 10, phase: 'tool_exec',
    content: '第一轮正文ABC', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  ok('流式期无同号', maxSameNumber(f.rows()) <= 1);
  // "完成"帧：同号迭代被提交（delta 带正文）
  f.push({
    type: 'iteration', turnID: T, iter: 1, seq: 11, phase: 'tool_exec',
    content: '第一轮正文ABC', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [{ iteration: 1, content: '第一轮正文ABC', reasoning: '', tools: [], toolCount: 0 }],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  // 权威收尾（progressHistory 再带一遍同一块）
  f.push({
    type: 'text_final', turnID: T, seq: 12, content: '第一轮正文ABC', cancelled: false,
    progressHistory: [{ iteration: 1, content: '第一轮正文ABC', reasoning: '', tools: [] }],
  });
  ok('⛔ 完成帧之后仍无同号（P0 回归判据）', maxSameNumber(f.rows()) <= 1);
  f.push({
    type: 'iteration', turnID: T, iter: 2, seq: 13, phase: 'tool_exec',
    content: '第二轮…', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  ok('下一迭代推进后无同号', maxSameNumber(f.rows()) <= 1);
  ok('已完成迭代正文仍在（收尾不吞内容）',
    f.rows().some((r: ChatRow) => r.iterations.some((b: HistoryIteration) => String(b.content).indexOf('第一轮正文ABC') >= 0)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ ③ 结构自证：模型层面**不存在**同号块（与渲染无关）');
{
  const f = new ModelFeed('chat-iter-dedupe5');
  f.push(started(1));
  f.push(tick(2, 1, 'x', []));
  f.push(commit(3, 1, 'x', []));
  f.push(commit(4, 1, 'y', []));
  f.push(commit(5, 2, 'z', []));
  f.push(commit(6, 2, 'w', []));
  const nums: number[] = blocksOf(f).map((b) => b.iteration);
  let strictlyIncreasing = true;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) { strictlyIncreasing = false; }
  }
  ok('③ 块号严格递增（T5a ⇒ 同号不可表示）', strictlyIncreasing);
  eq('③ 块号 = [1,2]', nums, [1, 2]);
  // 工具列表里也不允许有重复 call（一块内位置状态按 call 唯一）
  const ts: ToolProgress[] = [];
  const bs = blocksOf(f);
  for (let i = 0; i < bs.length; i++) {
    for (let k = 0; k < bs[i].tools.length; k++) { ts.push(bs[i].tools[k] as unknown as ToolProgress); }
  }
  ok('③ 行内工具 call 不重复', new Set(ts.map((t) => t.call_id)).size === ts.length);
}

console.log(`\n  live_iter_dedupe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
