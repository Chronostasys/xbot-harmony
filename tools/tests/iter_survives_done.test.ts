/**
 * iter_survives_done.test.ts —— 迭代完成后**不得从历史里消失**（用户 2026-11-18 回归）。
 *
 * 现场：新的迭代跑完（`phase_done`/`text_final` 到达）后，那一块立刻不见。
 * 该判据模拟真实 wire 形态：流式帧带正文/思考/工具，而**提交帧是轻字段**
 * （`progress_history` 里 content/reasoning 常为空、tools 只有 name/status）——
 * 完成后正文/思考必须仍然可见。
 *
 * ⛔ mutation 自证：让 `enrichDoneBlock` 不吸收同号 live ⇒ ② 红；让 `onFinal` 用轻快照
 *   覆盖正文 ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';
import type { TurnRec } from '../../entry/src/main/ets/core/model_types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function assistantIters(rows: ChatRow[]): { iter: number; content: string; reasoning: string; tools: number }[] {
  const out: { iter: number; content: string; reasoning: string; tools: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    for (let k = 0; k < rows[i].iterations.length; k++) {
      const it = rows[i].iterations[k];
      out.push({
        iter: it.iteration,
        content: it.content !== undefined ? it.content : '',
        reasoning: it.reasoning !== undefined ? it.reasoning : '',
        tools: it.tools !== undefined ? it.tools.length : 0,
      });
    }
  }
  return out;
}

// ── ① 流式有正文/思考 ⇒ `phase_done`（轻字段）后仍然可见 ───────────────────────
{
  const f = new ModelFeed('chat_keep1');
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r1', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 1, iter: 1, phase: 'stream', seq: 1, content: '', reasoning: '思考一段' });
  f.push({ type: 'iteration', turnID: 1, iter: 1, phase: 'stream', seq: 2, content: '正文一段', reasoning: '思考一段' });
  // 提交帧：**轻字段**（无 content/reasoning，只有一枚工具）
  f.push({
    type: 'phase_done', turnID: 1, seq: 3,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [{ name: 'Shell', label: 'Shell', status: 'done', iteration: 1 }] },
  });
  const list = assistantIters(f.rows());
  eq('① 完成块仍在', list.length, 1);
  eq('①b 正文没被轻快照抹掉', list.length > 0 ? list[0].content : 'MISSING', '正文一段');
  eq('①c 思考没被抹掉', list.length > 0 ? list[0].reasoning : 'MISSING', '思考一段');
  eq('①d 工具没丢', list.length > 0 ? list[0].tools : -1, 1);
}

// ── ② `text_final` 带 progress_history（轻字段）⇒ 同样不能抹掉正文 ─────────────
{
  const f = new ModelFeed('chat_keep2');
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 2, iter: 1, phase: 'stream', seq: 11, content: '第一段', reasoning: '想一' });
  f.push({
    type: 'phase_done', turnID: 2, seq: 12,
    finalIteration: { iteration: 1, content: '第一段', reasoning: '想一', tools: [] },
  });
  f.push({ type: 'iteration', turnID: 2, iter: 2, phase: 'stream', seq: 13, content: '第二段', reasoning: '想二' });
  f.push({
    type: 'text_final', turnID: 2, seq: 14, content: '第二段',
    blocks: [
      { iteration: 1, content: '', reasoning: '', tools: [] },
      { iteration: 2, content: '', reasoning: '', tools: [] },
    ],
  });
  const list = assistantIters(f.rows());
  eq('② 两个块都在', list.map((x) => x.iter), [1, 2]);
  eq('②b 首块正文保留', list[0].content, '第一段');
  eq('②c 末块正文保留（final 的轻快照不得覆盖）', list[1].content, '第二段');
}

// ── ③ 一组工具迭代完成后仍能被 `+N`/渲染层看到（不被合并丢块）──────────────────
{
  const f = new ModelFeed('chat_keep3');
  f.push({ type: 'turn_started', turnID: 3, requestID: 'r3', trigger: 'user', content: 'q' });
  for (let n = 1; n <= 3; n++) {
    f.push({
      type: 'iteration', turnID: 3, iter: n, phase: 'tool_exec', seq: 20 + n, content: '', reasoning: 'r' + n,
      streamingTools: [{ name: 'Shell', label: 'Shell ' + n, status: 'done', iteration: n }],
    });
    f.push({
      type: 'phase_done', turnID: 3, seq: 30 + n,
      finalIteration: { iteration: n, content: '', reasoning: 'r' + n, tools: [{ name: 'Shell', label: 'Shell ' + n, status: 'done', iteration: n }] },
    });
  }
  const list = assistantIters(f.rows());
  eq('③ 三个迭代都还在（合并只发生在渲染层）', list.length, 3);
}

// ── ⑤ 完成后紧接一条 （服务端权威空闲）⇒ 块不得消失 ──────────────
{
  const f = new ModelFeed('chat_keep5');
  f.push({ type: 'turn_started', turnID: 5, requestID: 'r5', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 5, iter: 1, phase: 'stream', seq: 51, content: '结果正文', reasoning: '想' });
  f.push({
    type: 'phase_done', turnID: 5, seq: 52,
    finalIteration: { iteration: 1, content: '结果正文', reasoning: '想', tools: [] },
  });
  f.push({ type: 'session', running: false, turnID: 5, seq: 53 });
  f.push({ type: 'text_final', turnID: 5, seq: 54, content: '结果正文' });
  const list = assistantIters(f.rows());
  eq('⑤ 完成后块仍在', list.length, 1);
  eq('⑤b 正文仍在', list.length > 0 ? list[0].content : 'MISSING', '结果正文');
}

// ── ⑥ 工具**执行完毕**（running→done）后，该迭代仍必须在历史里 ────────────────
{
  const f = new ModelFeed('chat_keep6');
  f.push({ type: 'turn_started', turnID: 6, requestID: 'r6', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 6, iter: 1, phase: 'tool_exec', seq: 61, content: '', reasoning: '思考 895 字',
    streamingTools: [{ name: 'Shell', label: 'Shell A', status: 'running', iteration: 1 }] });
  // 工具跑完（completedTools 到达）
  f.push({ type: 'iteration', turnID: 6, iter: 1, phase: 'tool_exec', seq: 62, content: '', reasoning: '思考 895 字',
    streamingTools: [], completedTools: [{ name: 'Shell', label: 'Shell A', status: 'done', iteration: 1 }] });
  // 提交（轻字段：只有工具）
  f.push({
    type: 'phase_done', turnID: 6, seq: 63,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [{ name: 'Shell', label: 'Shell A', status: 'done', iteration: 1 }] },
  });
  const list = assistantIters(f.rows());
  eq('⑥ 工具完成后该迭代仍在', list.length, 1);
  eq('⑥b 思考仍在', list.length > 0 ? list[0].reasoning : 'MISSING', '思考 895 字');
  eq('⑥c 工具仍在', list.length > 0 ? list[0].tools : -1, 1);
}

// ── ⑧ 详情回包（iteration_detail）到达后，块不得消失（昨天新增的覆盖层路径）───────
{
  const f = new ModelFeed('chat_keep8');
  const tools = [{ name: 'Shell', label: 'A', status: 'done', iteration: 1 }];
  f.push({ type: 'turn_started', turnID: 8, requestID: 'r8', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 8, iter: 1, phase: 'tool_exec', seq: 81, content: '', reasoning: '想甲',
    streamingTools: tools });
  f.push({ type: 'phase_done', turnID: 8, seq: 82,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools } });
  eq('⑧ 提交后块在', assistantIters(f.rows()).length, 1);
  // 详情回包（以 iterations_loaded 形式进管道）
  f.push({
    type: 'iterations_loaded', turnID: 8,
    iterations: [{ iteration: 1, content: '', reasoning: '', tools, regions_before: 0 }],
  });
  const after = assistantIters(f.rows());
  eq('⑧b 详情回包后块仍在', after.length, 1);
  eq('⑧c 思考仍在', after.length > 0 ? after[0].reasoning : 'MISSING', '想甲');
}

// ── ⑫ **投影缓存必须在已提交块变化时产出新 PRow**（真因 P0）────────────────
// ⛔ 用户 2026-11-18：「迭代完成就消失，idle 时才重新出现」。根因是  的 memo
//   只看 ：新块提交后 inflight 未变 ⇒ 返回旧 PRow ⇒ 桥接不写行 ⇒ liveRevision
//   不自增 ⇒ 页面 liveBlocks 不投递 ⇒ live 行的已提交块区冻结（空）。
{
  const f = new ModelFeed('chat_memo');
  f.push({ type: 'turn_started', turnID: 12, requestID: 'r12', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 12, iter: 1, phase: 'stream', seq: 121, content: '甲', reasoning: '想甲' });
  const before = f.rows();
  const a0 = before.filter((r) => r.role === 'assistant');
  const revBefore: number = a0.length > 0 ? a0[0].liveRevision : -1;
  // 提交 iter1 的块（live 仍可能前进）
  f.push({
    type: 'phase_done', turnID: 12, seq: 122,
    finalIteration: { iteration: 1, content: '甲', reasoning: '想甲', tools: [] },
  });
  const after = f.rows();
  const a1 = after.filter((r) => r.role === 'assistant');
  eq('⑫ 提交后行仍在', a1.length, 1);
  eq('⑫b 提交后可见块数必须包含新块', a1.length > 0 ? a1[0].iterations.filter((x) => x.iteration === 1).length : -1, 1);
  // 行对象由 cache 复用（身份稳定是设计）；**驱动 live 行刷新的信号是 liveRevision**
  ok('⑫c 提交块后 liveRevision 必须自增（否则 live 行 committed 区冻结）',
    a1.length > 0 && a1[0].liveRevision > revBefore);
}

console.log(`iter_survives_done: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
