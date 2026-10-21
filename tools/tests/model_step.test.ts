/**
 * `core/model/{step,project}.ts` 的判别力判据（`docs/STATE-MODEL.md` §4 T2–T5 / §9.1）。
 *
 * ⛔ mutation 自证（每条都能把判据打红）：
 *   · 删 `seq ≤ S.seq` 守卫        ⇒ ★seq 重复帧断言红；
 *   · `done` 无条件追加（去掉"缺口⇒pull"） ⇒ ★不完整迭代断言红；
 *   · `tick` 允许跳号直接应用      ⇒ ★迭代缺口断言红；
 *   · `done` 不盖工具号            ⇒ ★工具号 == 块号 断言红；
 *   · `project` 去掉 live 恒等 memo ⇒ ★引用稳定断言红。
 */
declare const process: { exit: (c: number) => void };

import { step, stepAll, applyText, lastBlockIter, isLegalTransition } from '../../entry/src/main/ets/core/model_step';
import { project, allToolCalls, lastIterOf } from '../../entry/src/main/ets/core/model_project';
import type { Block, DoneFrame, FinalFrame, OpenFrame, SessionFrame, State, TickFrame, ToolRec, UserLine } from '../../entry/src/main/ets/core/model_types';
import { emptyState } from '../../entry/src/main/ets/core/model_types';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const CHAT = 'c1';
const EPOCH = 7;

function st(seq = 0): State {
  return emptyState(CHAT, EPOCH, seq);
}
function tool(call: string, status: string, label?: string): ToolRec {
  return {
    call, iteration: 1,
    meta: { name: 'Shell', args: '', detail: '' },
    state: { status: status as ToolRec['state']['status'], label: label !== undefined ? label : 'Shell', genChars: 0, elapsedMs: 0 },
  };
}
function blk(iteration: number, tools: ToolRec[], content = ''): Block {
  return { iteration, content, reasoning: '', tools, subAgents: [], genui: '', cancelled: false };
}
function open(turn: number, seq: number): OpenFrame {
  const u: UserLine = { id: `u${turn}`, content: `hi${turn}`, timestamp: 't', isNotification: false, queued: false, sending: false, requestID: `r${turn}` };
  return { kind: 'open', epoch: EPOCH, seq, chat: CHAT, turn, user: u, requestID: u.requestID };
}
function tick(turn: number, iteration: number, seq: number, text?: string, tools: ToolRec[] = []): TickFrame {
  return {
    kind: 'tick', epoch: EPOCH, seq, chat: CHAT, turn, iteration, phase: 'thinking', streaming: true,
    content: text === undefined ? { kind: 'full', text: '' } : { kind: 'full', text },
    reasoning: { kind: 'full', text: '' },
    tools: tools.map((t) => ({ call: t.call, iteration: t.iteration, state: t.state, meta: t.meta })),
    genui: '',
  };
}
function done(turn: number, block: Block, seq: number): DoneFrame {
  return { kind: 'done', epoch: EPOCH, seq, chat: CHAT, turn, block };
}
function fin(turn: number, content: string, seq: number, blocks?: Block[]): FinalFrame {
  return { kind: 'final', epoch: EPOCH, seq, chat: CHAT, turn, content, cancelled: false, phase: 'done', blocks };
}

// ── ① 信封：重复帧幂等；跳号"以最大为准"，不重放、不补帧 ─────────────────────
{
  let s = st(0);
  let r = step(s, open(1, 5), '');
  s = r.state;
  eq('① open 推进水位', s.seq, 5);
  eq('① open 不产 effect', r.effects.length, 0);

  // 重复帧（seq ≤ 水位）⇒ 状态**原引用**（幂等）
  const again = step(s, tick(1, 1, 5, 'x'), '');
  ok('① 重复 seq ⇒ 状态不变（原引用）', again.state === s);

  // seq 跳号（7 > 5+1）⇒ 照常应用并把水位推到 7；**不产生**任何恢复 effect
  const jump = step(s, tick(1, 1, 7, 'hello'), '');
  eq('① 跳号：水位取最大', jump.state.seq, 7);
  eq('① 跳号：不产生恢复 effect', jump.effects.length, 0);
  eq('① 跳号帧内容照常应用', jump.state.live === null ? null : jump.state.live.content, 'hello');
}

// ── ② 迭代完整性：tick 跳迭代 ⇒ 拉权威、**不应用**；done 跳迭代 ⇒ 不入账 ──────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, 'a'), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 'done')], 'a'), 3), '').state;
  eq('② 迭代 1 已提交', s.turns.get(1)?.blocks.length, 1);

  // tick 直接跳到迭代 3（2 缺失）⇒ pullIter(2)，且**不开** live 3
  const r = step(s, tick(1, 3, 4, 'b'), '');
  eq('② 迭代缺口 ⇒ 只拉缺失那一号', r.effects.length, 1);
  eq('② effect 类型/参数', r.effects[0], { kind: 'pullIter', chat: CHAT, turn: 1, iteration: 2 });
  // ⛔ 用户口径：**补洞不能停 SSE 进度** ⇒ 缺口帧照常应用到 live
  eq('② 缺口帧仍推进 live（SSE 不停）', r.state.live === null ? null : r.state.live.iteration, 3);

  // done 直接跳到迭代 3 ⇒ pullIter(2)，**不入账**
  const r2 = step(s, done(1, blk(3, [], 'c'), 5), '');
  eq('② done 缺口 ⇒ 拉权威', r2.effects.length, 1);
  eq('② done 缺口不入账', r2.state.turns.get(1)?.blocks.length, 1);
}

// ── ③ 工具：块内工具号 == 块号（T5-c）；同一 call 恰好一处 ────────────────────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  const t1 = tool('c1', 'running');
  t1.iteration; // 故意不盖号（缺号/旧号）
  const bad: ToolRec = { call: 'c1', iteration: 99, meta: t1.meta, state: t1.state };
  s = step(s, done(1, blk(1, [bad], 'x'), 2), '').state;
  const b = s.turns.get(1)?.blocks[0];
  eq('③ 折叠后工具号被盖成块号', b === undefined ? -1 : b.tools[0].iteration, 1);
  eq('③ 投影里每个 call 恰好一次', allToolCalls(s), ['c1']);
}

// ── ④ final：带 blocks ⇒ 整体替换；不带且落后 ⇒ 拉权威；清 live ───────────────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [], 'first'), 2), '').state;      // 迭代 1 已提交
  s = step(s, tick(1, 2, 3, 'live-text'), '').state;           // 迭代 2 在飞
  // final 不带 blocks，而 live 已到迭代 2 ⇒ 必须拉迭代 2（不许静默结束）
  const r = step(s, fin(1, 'answer', 4), '');
  eq('④ final 落后 ⇒ 拉齐缺失迭代', r.effects.length, 1);
  eq('④ effect = 缺失的那一号', r.effects[0], { kind: 'pullIter', chat: CHAT, turn: 1, iteration: 2 });
  eq('④ final 清 live', r.state.live, null);
  eq('④ final 落盘', r.state.turns.get(1)?.final?.content, 'answer');

  // final 带 blocks ⇒ 整段替换（权威），不再拉
  const r2 = step(s, fin(1, 'answer', 5, [blk(1, [tool('c9', 'done')], 'x'), blk(2, [], 'y')]), '');
  eq('④ final 带 blocks ⇒ 无 effect', r2.effects.length, 0);
  eq('④ final 整体替换（2 块）', r2.state.turns.get(1)?.blocks.length, 2);
}

// ── ⑤ open 幂等：已存在 turn 再 open ⇒ 保留 blocks/final ─────────────────────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [], 'x'), 2), '').state;
  s = step(s, open(1, 3), '').state;
  eq('⑤ 重复 open 不清已提交块', s.turns.get(1)?.blocks.length, 1);
}

// ── ⑥ session：三态（缺省=不动 / null=清除 / 值=覆盖）────────────────────────
{
  let s = st(0);
  const sf = (seq: number, goal: SessionFrame['goal'], todos?: readonly string[]): SessionFrame =>
    ({ kind: 'session', epoch: EPOCH, seq, chat: CHAT, goal, todos });
  s = step(s, sf(1, { objective: 'g1', status: 'doing' }, ['a']), '').state;
  eq('⑥ 写入 goal', (s.sess.goal as { objective?: string }).objective, 'g1');
  s = step(s, sf(2, undefined), '').state;
  eq('⑥ 未携带 ⇒ 不动', (s.sess.goal as { objective?: string }).objective, 'g1');
  eq('⑥ 未携带 todos ⇒ 不动', s.sess.todos.length, 1);
  s = step(s, sf(3, null, []), '').state;
  eq('⑥ null ⇒ 显式清除', s.sess.goal.kind, 'cleared');
  eq('⑥ [] ⇒ 是值（清空）', s.sess.todos.length, 0);
}

// ── ⑦ 投影：引用稳定（未变化的 turn 返回同一 Row 对象）─────────────────────────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [], 'a'), 2), '').state;
  const r1 = project(s);
  const r2 = project(s);
  ok('⑦ 同一 state 两次投影 ⇒ 同一 Row 引用', r1[1] === r2[1]);
  // 新的 tick（只影响 live）⇒ 历史块引用不变
  const s2 = step(s, tick(1, 2, 3, 'b'), '').state;
  const r3 = project(s2);
  eq('⑦ 历史块数组引用不变', r3[1].kind === 'assistant' && r1[1].kind === 'assistant' ? (r3[1] as { blocks: unknown }).blocks === (r1[1] as { blocks: unknown }).blocks : false, true);
  eq('⑦ 在飞块出现', (r3[1] as { inflight: unknown }).inflight !== null, true);
  eq('⑦ 最后迭代号', lastIterOf(s2, 1), 2);
}

// ── ⑧ 文本补丁：delta 锚不匹配 ⇒ 丢弃（不拼接、不清空）───────────────────────
{
  eq('⑧ delta 命中', applyText('abc', { kind: 'delta', base: 3, chunk: 'd' }), 'abcd');
  eq('⑧ delta 失配 ⇒ null', applyText('abc', { kind: 'delta', base: 2, chunk: 'X' }), null);
  eq('⑧ full 覆盖', applyText('abc', { kind: 'full', text: 'z' }), 'z');
}

// ── ⑨ 工具状态只前进（契约 C-8）──────────────────────────────────────────────
{
  ok('⑨ generating→running 合法', isLegalTransition('generating', 'running'));
  ok('⑨ running→pending 非法', !isLegalTransition('running', 'pending'));
  ok('⑨ running→failed 合法', isLegalTransition('running', 'failed'));
}

// ── ⑩ stepAll：同批 effect 去重（同一事实只请求一次）──────────────────────────
{
  let s = st(0);
  s = step(s, open(1, 1), '').state;
  const r = stepAll(s, [tick(1, 3, 2, 'a'), tick(1, 3, 3, 'b'), done(1, blk(3, [], ''), 4)], '');
  eq('⑩ 同一 (turn,iter) 只请求一次', r.effects.length, 2);
}

console.log(`\nmodel_step: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
