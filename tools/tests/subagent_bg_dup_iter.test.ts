/**
 * subagent_bg_dup_iter.test.ts —— **同一迭代被渲染两次**（用户 2026-11-14 P0
 * 「子代理的 shell 转后台之后，该迭代被重复渲染」，截图为同一个「思考 44 字」出现两遍，
 * 第二份还带着 `delivered_message` + 一条「执行中」的 Shell）。
 *
 * 现场机制（纯结构，不猜服务端）：
 *   后台工具让迭代号出现**缺口**（done(N) 到达时 `last < N-1`）⇒ 块进 `pending` 缓冲、
 *   `live` 仍指向 N（在飞快照）；随后缺口由 `done(N-1)` / `pullIter` 补齐、`drain` 把 N
 *   **提交成块** —— 但 `drain` 从不清理 `live` ⇒ 块 N **和** live N 同时存在 ⇒ 渲染出两份。
 *   第二份（live）还带着后续的 `delivered_message` / 新 Shell 状态 ⇒ 与截图逐项吻合。
 *
 * 判据（可观察保证）：**前沿唯一** —— live 指向的迭代一旦作为**有实质内容**的块落地，
 *   live 必须消失，且 live 里更完整的正文/思考/工具必须**并进块**（不丢数据）。
 *   ⛔ 反向必须保住：块是**空壳**（边界/取消快照）时 live 必须保留（否则正文整段闪没）。
 *
 * ⛔ mutation 自证：把 `absorbFrontier` 从 `step()` 里摘掉 ⇒ ① 红；
 *   让它在块为空壳时也清 live ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import type { Block, LiveIter, State, TurnRec } from '../../entry/src/main/ets/core/model_types';
import { emptyState, newTurn } from '../../entry/src/main/ets/core/model_types';
import { hydrate, WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';
import { applyModel } from '../../entry/src/main/ets/core/model_bridge';

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

function tool(name: string, iter: number, state: string): unknown {
  return { name, label: name, status: state, iteration: iter, callID: `${name}-${iter}` };
}

/** 行里出现某迭代号的次数（跨所有 assistant 行、含在飞块）。 */
function countIter(rows: ChatRow[], iter: number): number {
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    for (let k = 0; k < rows[i].iterations.length; k++) {
      if (rows[i].iterations[k].iteration === iter) n++;
    }
  }
  return n;
}

/** 该回合里按迭代号取块。 */
function blockOf(st: State, turn: number, iter: number): Block | undefined {
  const t = st.turns.get(turn as never);
  if (t === undefined) return undefined;
  for (let i = 0; i < t.blocks.length; i++) {
    if (t.blocks[i].iteration === iter) return t.blocks[i];
  }
  return undefined;
}

function dupRows(rows: ChatRow[], turnID: number, iter: number): number {
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    for (let k = 0; k < rows[i].iterations.length; k++) {
      const it = rows[i].iterations[k];
      if (it.iteration === iter) n++;
    }
  }
  return n;
}

// ── ① 缺口 + drain 提交后，live 必须消失（前沿唯一），工具并进块 ───────────────
{
  const f = new ModelFeed('agent:web:chat_DUP/explore:i1');
  f.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'q', requestID: 'r1', seq: 1 });
  // 迭代 1 起头（思考 + 一条 Shell）⇒ live=1
  f.push({
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 2,
    content: '', reasoning: '查 rb14 + 103 进度。', streamingTools: [tool('Shell', 1, 'running')],
  });
  f.push({
    type: 'phase_done', turnID: 1, seq: 3,
    finalIteration: { iteration: 1, content: '', reasoning: '查 rb14 + 103 进度。', tools: [tool('Shell', 1, 'done')] },
  });
  // ⛔ 缺口：迭代 3 的流式帧（迭代 2 还没到）⇒ live=3
  f.push({
    type: 'iteration', turnID: 1, iter: 3, phase: 'tool_exec', seq: 4,
    content: '', reasoning: '执行。', streamingTools: [tool('Shell', 3, 'running')],
  });
  // 迭代 3 收尾 ⇒ 因为 last=1，3 > last+1 ⇒ 进 pending（live 仍是 3）
  f.push({
    type: 'phase_done', turnID: 1, seq: 5,
    finalIteration: { iteration: 3, content: '', reasoning: '执行。', tools: [tool('Shell', 3, 'done')] },
  });
  // 缺口补齐：迭代 2 落地 ⇒ drain 把 3 也提交成块
  f.push({
    type: 'phase_done', turnID: 1, seq: 6,
    finalIteration: { iteration: 2, content: '', reasoning: '中间一步。', tools: [] },
  });

  const st: State = f.state;
  const b3 = blockOf(st, 1, 3);
  ok('① 迭代 3 已作为块提交', b3 !== undefined);
  ok('①b live 不得再指向已提交的迭代 3（否则块 + 尾项重复渲染）',
    st.live === null || (st.live as LiveIter).iteration !== 3);
  ok('①c 工具没丢（块里仍有迭代 3 的 Shell）',
    b3 !== undefined && b3.tools !== undefined && b3.tools.length === 1 && b3.tools[0].meta.name === 'Shell');
  eq('①d 渲染层只有一份迭代 3', dupRows(f.rows(), 1, 3), 1);

  // ⛔ 后续帧（后台工具结果投递）必须并进**块**，不得再变出第二份
  f.push({
    type: 'iteration', turnID: 1, iter: 3, phase: 'tool_exec', seq: 7,
    content: '', reasoning: '执行。', streamingTools: [tool('delivered_message', 3, 'done'), tool('Shell', 3, 'running')],
  });
  const st2: State = f.state;
  ok('①e 迟到帧不得复活 live 副本', st2.live === null || (st2.live as LiveIter).iteration !== 3);
  eq('①f 渲染层仍只有一份迭代 3', dupRows(f.rows(), 1, 3), 1);
}

// ── ② 同一回合里 live 的正文比块更完整 ⇒ 并进块（不丢） ──────────────────────
{
  const f = new ModelFeed('agent:web:chat_DUP2/explore:i2');
  f.push({ type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 1, content: '半句', reasoning: '想' });
  f.push({
    type: 'phase_done', turnID: 1, seq: 2,
    finalIteration: { iteration: 1, content: '半', reasoning: '想', tools: [] },
  });
  const st: State = f.state;
  const b = blockOf(st, 1, 1);
  ok('② 块已提交', b !== undefined);
  eq('② live 更长 ⇒ 正文并进块（半句）', b !== undefined ? b.content : 'missing', '半句');
  ok('②b live 必须清掉', st.live === null || (st.live as LiveIter).iteration !== 1);
}

// ── ③ 反向：空壳块不得吞掉 live（cancel/边界快照）──────────────────────────────
{
  const f = new ModelFeed('agent:web:chat_DUP3/explore:i3');
  f.push({ type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 1, content: '', reasoning: '只想了一半' });
  // 空壳 done（无正文/思考/工具）—— 服务端的边界快照形态
  f.push({
    type: 'phase_done', turnID: 1, seq: 2,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [] },
  });
  const st: State = f.state;
  // 2026-11-18 修正：空壳 done 的 finalIteration 现在会从 live 吸收内容（enrichDoneBlock
  //   的 !isShellBlock 守卫改为 !block.cancelled）⇒ 内容在 committed 块里可见，live 被清。
  //   不变量：内容必须在某处可见（块或 live），不得两处都空。
  let visible3: boolean = false;
  st.turns.forEach((t: TurnRec) => {
    for (let i = 0; i < t.blocks.length; i++) {
      if (t.blocks[i].iteration === 1 && t.blocks[i].reasoning === '只想了一半') visible3 = true;
    }
  });
  if (!visible3 && st.live !== null) {
    const lv = st.live as LiveIter;
    visible3 = lv.iteration === 1 && lv.reasoning === '只想了一半';
  }
  ok('③ 空壳 done 后内容仍可见（块或 live）', visible3);
}

// ── ④ 跨回合号漂移：同一条迭代不得在两个回合里各画一份 ────────────────────────
{
  const f = new ModelFeed('agent:web:chat_DUP4/explore:i4');
  const REASON = '查 rb14 + 103 进度。执行单次查询。';
  // dump/SSE 的第一套回合号：迭代 1 已提交
  f.push({
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 1,
    content: '', reasoning: REASON, streamingTools: [tool('Shell', 1, 'running')],
  });
  f.push({
    type: 'phase_done', turnID: 1, seq: 2,
    finalIteration: { iteration: 1, content: '', reasoning: REASON, tools: [tool('Shell', 1, 'done')] },
  });
  // 服务端用**另一个 turn 号**重放同一条迭代（后台 shell 转后台后的投递帧）
  f.push({
    type: 'iteration', turnID: 900, iter: 1, phase: 'tool_exec', seq: 3,
    content: '', reasoning: REASON,
    streamingTools: [tool('delivered_message', 1, 'done'), tool('Shell', 1, 'running')],
  });
  const st: State = f.state;
  eq('④ 不得为漂移的 turn 号另建回合（否则同一迭代画两份）', st.turns.size, 1);
  const b = blockOf(st, 1, 1);
  ok('④b 后台投递的工具并进了原块（delivered_message 不丢）',
    b !== undefined && b.tools !== undefined && b.tools.length === 2 && b.tools[1].meta.name === 'delivered_message');
  ok('④c live 不得再指向该迭代', st.live === null || (st.live as LiveIter).iteration !== 1);
  eq('④d 渲染层只有一份迭代 1', dupRows(f.rows(), 1, 1), 1);
}

// ── ⑤ 反向：内容不同 ⇒ 照旧建新回合（不得过度对齐）────────────────────────────
{
  const f = new ModelFeed('agent:web:chat_DUP5/explore:i5');
  f.push({
    type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 1,
    content: '', reasoning: '第一轮的思考',
  });
  f.push({
    type: 'phase_done', turnID: 1, seq: 2,
    finalIteration: { iteration: 1, content: '', reasoning: '第一轮的思考', tools: [] },
  });
  f.push({
    type: 'iteration', turnID: 900, iter: 1, phase: 'thinking', seq: 3,
    content: '', reasoning: '下一轮真正的新思考',
  });
  eq('⑤ 内容不同 ⇒ 允许建新回合', f.state.turns.size, 2);
}

// ── ⑥ 投影层兜底：同号块已在 ⇒ 不画 live 副本（最后一道闸）──────────────────
{
  const st: State = emptyState('agent:web:chat_DUP6/explore:i6', 1, 0);
  const t0: TurnRec = newTurn(1 as never, null, null);
  const blk: Block = {
    iteration: 1 as never, content: '', reasoning: '检查 rb52 状态。执行。',
    tools: [], subAgents: [], genui: '', cancelled: false,
  };
  const turn: TurnRec = { ...t0, blocks: [blk], final: null, streaming: true, phase: 'tool_exec' };
  const turns = new Map<number, TurnRec>();
  turns.set(1, turn);
  const live: LiveIter = {
    turn: 1 as never, iteration: 1 as never, content: '', reasoning: '检查 rb52 状态。执行。',
    tools: [], genui: '',
  };
  const state: State = { ...st, turns, live };
  const rows: ChatRow[] = applyModel(state, new Map());
  eq('⑥ 同一迭代不得画两份（块 + 在飞块）', countIter(rows, 1), 1);
}

// ── ⑦ 水合跨回合兜底：live 指向的回合与块所属回合不同 ⇒ 逐字相同即判副本 ──────
{
  // 前置：live 指向回合 9 的迭代 1（dump 派生的回合是 1）
  const base: State = emptyState('agent:web:chat_DUP7/explore:i7', 1, 0);
  const t9: TurnRec = newTurn(9 as never, null, null);
  const turns0 = new Map<number, TurnRec>();
  turns0.set(9, t9);
  const prev: State = {
    ...base, turns: turns0,
    live: { turn: 9 as never, iteration: 1 as never, content: '', reasoning: '检查 rb52 状态。', tools: [], genui: '' },
  };
  const wire: WireHistoryMessage[] = [
    { id: 'u1', role: 'user', content: 'q', turnID: 1 },
    {
      id: 'a1', role: 'assistant', content: '', turnID: 1,
      iterations: [{ iteration: 1, content: '', reasoning: '检查 rb52 状态。' }],
    },
  ];
  const after: State = hydrate(prev, wire, 5, null);
  ok('⑦ 跨回合的同号同文迭代 ⇒ live 必须清（否则两行各一份）', after.live === null);
  const rows: ChatRow[] = applyModel(after, new Map());
  eq('⑦b 渲染层只有一份迭代 1', countIter(rows, 1), 1);
}

// ── ⑧ 同回合内同号两份块（快照/重放并集残留）⇒ 投影只画一份 ──────────────────
{
  const st: State = emptyState('agent:web:chat_DUP8/explore:i8', 1, 0);
  const t0: TurnRec = newTurn(1 as never, null, null);
  const mk = (reasoning: string): Block => ({
    iteration: 1 as never, content: '', reasoning, tools: [], subAgents: [], genui: '', cancelled: false,
  });
  const turn: TurnRec = {
    ...t0, blocks: [mk('检查 rb52 状态。'), mk('检查 rb52 状态。执行。')],
    final: null, streaming: true, phase: 'tool_exec',
  };
  const turns = new Map<number, TurnRec>();
  turns.set(1, turn);
  const state: State = { ...st, turns, live: null };
  const rows: ChatRow[] = applyModel(state, new Map());
  eq('⑧ 同号迭代只画一份', countIter(rows, 1), 1);
  // 保留"更完整的那一份"（不得丢掉更长的思考）
  let kept = '';
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    for (let k = 0; k < rows[i].iterations.length; k++) {
      const it = rows[i].iterations[k];
      if (it.iteration === 1) kept = it.reasoning !== undefined ? it.reasoning : '';
    }
  }
  eq('⑧b 保留更完整的思考', kept, '检查 rb52 状态。执行。');
}

// ── ⑩ 反向闸：**普通会话**里两轮正文恰好相同 ⇒ 绝不能合并（用户 2026-11-18 冷启动错乱）──
{
  const base: State = emptyState('web:chat_NORMAL', 1, 0);
  const mk = (id: number, text: string): TurnRec => {
    const t0: TurnRec = newTurn(id as never,
      { id: 'u' + id, content: '继续', timestamp: '', isNotification: false, queued: false, sending: false } as never,'r' + id);
    const b: Block = {
      iteration: 1 as never, content: text, reasoning: '',
      tools: [], subAgents: [], genui: '', cancelled: false,
    };
    return { ...t0, blocks: [b], final: { content: text, cancelled: false }, streaming: false, phase: 'done' };
  };
  const turns0 = new Map<number, TurnRec>();
  turns0.set(1, mk(1, '同样的回答'));
  turns0.set(2, mk(2, '同样的回答'));
  const wire: WireHistoryMessage[] = [
    { id: 'u1', role: 'user', content: '继续', turnID: 1 },
    { id: 'a1', role: 'assistant', content: '', turnID: 1, iterations: [{ iteration: 1, content: '同样的回答', reasoning: '' }] },
    { id: 'u2', role: 'user', content: '继续', turnID: 2 },
    { id: 'a2', role: 'assistant', content: '', turnID: 2, iterations: [{ iteration: 1, content: '同样的回答', reasoning: '' }] },
  ];
  const after: State = hydrate({ ...base, turns: turns0 } as State, wire, 9, null);
  eq('⑩ 普通会话的两轮（正文相同）不得被合并成一轮', after.turns.size, 2);
}

// ── ⑨ 平行回合集（/api/history 的 DB 回合 vs dump 派生回合）⇒ 合并成一份 ────────
{
  const base: State = emptyState('agent:web:chat_DUP9/explore:i9', 1, 0);
  const t1127: TurnRec = newTurn(1127 as never,
    { id: 'u1', content: 'q', timestamp: '', isNotification: false, queued: false, sending: false } as never,
    'r1');
  const blk: Block = {
    iteration: 1 as never, content: '', reasoning: '检查 rb52 状态。',
    tools: [], subAgents: [], genui: '', cancelled: false,
  };
  const turnOld: TurnRec = {
    ...t1127, blocks: [blk], final: { content: '', cancelled: false }, streaming: false, phase: 'done',
  };
  const turns0 = new Map<number, TurnRec>();
  turns0.set(1127, turnOld);
  const prev: State = { ...base, turns: turns0, live: null };
  // dump 派生：同一段历史换了回合号（1）
  const wire: WireHistoryMessage[] = [
    { id: 'u1', role: 'user', content: 'q', turnID: 1 },
    {
      id: 'a1', role: 'assistant', content: '', turnID: 1,
      iterations: [{ iteration: 1, content: '', reasoning: '检查 rb52 状态。' }],
    },
  ];
  const after: State = hydrate(prev, wire, 5, null);
  eq('⑨ 两套回合号描述同一段历史 ⇒ 只留一份回合', after.turns.size, 1);
  const rows: ChatRow[] = applyModel(after, new Map());
  eq('⑨b 渲染层只有一份迭代 1', countIter(rows, 1), 1);
}

console.log(`subagent_bg_dup_iter: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
