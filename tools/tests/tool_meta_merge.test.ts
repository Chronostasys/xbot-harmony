/**
 * 工具 `meta` **字段级合并**判据
 * （用户 2026-10-27 P0：「打开对话后，新的迭代所有 tool 完成后都无法看到参数和结果」）。
 *
 * 根因（本文件钉死）：wire 上 `args/detail/summary/tool_hints` **只在部分帧携带** ——
 *   流式的 `streaming_tools`/`completed_tools` 有，提交帧 `iterations_delta` 与
 *   `text_final.progress_history` 里的工具是**轻字段**。模型此前把 meta 当**整体替换**
 *   （`applyToolTicks` 的 `tk.meta !== undefined ? tk.meta : known.meta`、`onDone` 的
 *   `stampBlock(f.block)`）⇒ 迭代一提交，详情被轻 meta 覆盖 ⇒ 在飞能看到、完成后看不到。
 *   web `progressStore.dedupTools` 是对象展开合并 ⇒ 原生必须逐字段补。
 *
 * mutation 自证：把 `mergeToolMeta` 改回「整体替换」⇒ §1/§2/§3 全红。
 */
declare const process: { exit: (c: number) => void };

import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { Block, DoneFrame, FinalFrame, OpenFrame, State, TickFrame, ToolRec, UserLine } from '../../entry/src/main/ets/core/model_types';
import { mergeToolLists, mergeToolMeta, step } from '../../entry/src/main/ets/core/model_step';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

const CHAT = 'chat_M';
const EPOCH = 5;

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function richTool(call: string, args: string, detail: string): ToolRec {
  return {
    call, iteration: 1,
    meta: { name: 'Shell', args, detail, summary: '列目录', toolHints: '' },
    state: { status: 'running', label: 'Shell', genChars: 0, elapsedMs: 30, exitCode: 0 },
  };
}
function lightTool(call: string): ToolRec {
  return {
    call, iteration: 1,
    meta: { name: 'Shell', args: '', detail: '', summary: '', toolHints: '' },
    state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 42 },
  };
}
function open(turn: number, seq: number): OpenFrame {
  const u: UserLine = {
    id: `u${turn}`, content: 'hi', timestamp: 't', isNotification: false,
    queued: false, sending: false, requestID: `r${turn}`,
  };
  return { kind: 'open', epoch: EPOCH, seq, chat: CHAT, turn, user: u, requestID: u.requestID };
}
function tick(turn: number, iteration: number, seq: number, tools: ToolRec[]): TickFrame {
  return {
    kind: 'tick', epoch: EPOCH, seq, chat: CHAT, turn, iteration, phase: 'tool', streaming: true,
    content: { kind: 'full', text: '正文' },
    reasoning: { kind: 'full', text: '' },
    tools: tools.map((t) => ({ call: t.call, iteration: t.iteration, state: t.state, meta: t.meta })),
    genui: '',
  };
}
function done(turn: number, block: Block, seq: number): DoneFrame {
  return { kind: 'done', epoch: EPOCH, seq, chat: CHAT, turn, block };
}
function fin(turn: number, seq: number, blocks: Block[]): FinalFrame {
  return { kind: 'final', epoch: EPOCH, seq, chat: CHAT, turn, content: '正文', cancelled: false, phase: 'done', blocks };
}
function blk(iteration: number, tools: ToolRec[]): Block {
  return { iteration, content: '正文', reasoning: '', tools, subAgents: [], genui: '', cancelled: false };
}
function lastBlock(s: State, turn: number): Block {
  const t = s.turns.get(turn)!;
  return t.blocks[t.blocks.length - 1]!;
}

// ── §1 纯函数：字段级合并（新值优先、空则保留旧值）──────────────────────────
{
  const rich = richTool('c1', '{"cmd":"ls"}', 'out').meta;
  const light = lightTool('c1').meta;
  const m1 = mergeToolMeta(rich, light);
  eq('① 轻 meta 不抹 args', m1.args, '{"cmd":"ls"}');
  eq('① 轻 meta 不抹 detail', m1.detail, 'out');
  eq('① 轻 meta 不抹 summary', m1.summary, '列目录');
  ok('① 纯函数幂等（同输入两次同值）', mergeToolMeta(rich, m1).args === m1.args);

  const rich2 = richTool('c1', '{"cmd":"ls -la"}', 'out2').meta;
  eq('① 新值优先（参数增长可见）', mergeToolMeta(rich, rich2).args, '{"cmd":"ls -la"}');

  // 列表合并：返回原引用 = 零变化（幂等，防每帧重建）
  const a: ToolRec[] = [richTool('c1', 'x', 'y')];
  ok('① 列表合并零变化 ⇒ 原引用', mergeToolLists(a, [richTool('c1', 'x', 'y')]) === a);
  const mergedList = mergeToolLists(a, [lightTool('c1')]);
  eq('① 列表合并保住 args', mergedList[0].meta.args, 'x');
  eq('① 列表合并取新状态（done）', mergedList[0].state.status, 'done');
  eq('① 状态合并保留 exitCode（轻帧不带它）', mergedList[0].state.exitCode, 0);
}

// ── §2 流式帧：后到的轻帧不得抹掉已拿到的详情 ───────────────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [richTool('c1', '{"cmd":"ls"}', 'total 0')]), '').state;
  eq('② 前置：rich 帧已带来 args', s.live!.tools[0].meta.args, '{"cmd":"ls"}');
  // 同一工具的后一帧只带状态（meta 全空）——服务端 completed_tools 的常见形态
  s = step(s, tick(1, 1, 3, [lightTool('c1')]), '').state;
  eq('② 轻帧后 args 仍在', s.live!.tools[0].meta.args, '{"cmd":"ls"}');
  eq('② 轻帧后 detail 仍在', s.live!.tools[0].meta.detail, 'total 0');
  eq('② 状态确实前进了', s.live!.tools[0].state.status, 'done');
}

// ── §3 提交帧（轻字段）不得抹掉在飞拿到的详情（本次 P0 的精确复现）────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [richTool('c1', '{"cmd":"pwd"}', '/root')]), '').state;
  // 提交帧：同一迭代、同名工具、call 缺 id（回落到 iter#idx）⇒ 靠下标+同名兜底
  const lightSubmit: ToolRec = {
    call: '1#0', iteration: 1,
    meta: { name: 'Shell', args: '', detail: '', summary: '', toolHints: '' },
    state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 42 },
  };
  s = step(s, done(1, blk(1, [lightSubmit]), 3), '').state;
  const b = lastBlock(s, 1);
  eq('③ 提交后 args 仍在（在飞→提交不丢详情）', b.tools[0].meta.args, '{"cmd":"pwd"}');
  eq('③ 提交后 detail 仍在', b.tools[0].meta.detail, '/root');
  eq('③ 提交帧的状态生效', b.tools[0].state.status, 'done');
}

// ── §4 text_final 的 progressHistory（轻字段）同样不得抹掉 ────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [richTool('c1', '{"cmd":"date"}', 'Mon')]), '').state;
  s = step(s, done(1, blk(1, [richTool('c1', '{"cmd":"date"}', 'Mon')]), 3), '').state;
  s = step(s, fin(1, 4, [blk(1, [lightTool('c1')])]), '').state;
  eq('④ final 轻块不抹 args', lastBlock(s, 1).tools[0].meta.args, '{"cmd":"date"}');
  eq('④ final 轻块不抹 detail', lastBlock(s, 1).tools[0].meta.detail, 'Mon');
}

// ── §5 详情（iteration_detail）仍能补全，且轻详情不抹已完整的数据 ────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [lightTool('c1')]), 2), '').state;
  const rich: Block = { iteration: 1, content: '', reasoning: '', tools: [richTool('c1', '{"cmd":"ps"}', 'PID')], subAgents: [], genui: '', cancelled: false };
  s = step(s, { kind: 'detail', turn: 1, blocks: [rich] }, '').state;
  eq('⑤ 详情补全 args', lastBlock(s, 1).tools[0].meta.args, '{"cmd":"ps"}');
  const lightDetail: Block = { iteration: 1, content: '', reasoning: '', tools: [lightTool('c1')], subAgents: [], genui: '', cancelled: false };
  // 轻详情**允许**推进"可变状态"（status/elapsed），但绝不能抹掉详情字段
  s = step(s, { kind: 'detail', turn: 1, blocks: [lightDetail] }, '').state;
  eq('⑤ 轻详情不抹 args', lastBlock(s, 1).tools[0].meta.args, '{"cmd":"ps"}');
  eq('⑤ 轻详情不抹 detail', lastBlock(s, 1).tools[0].meta.detail, 'PID');
  eq('⑤ 轻详情仍推进状态（done）', lastBlock(s, 1).tools[0].state.status, 'done');
  const settled = s;
  s = step(s, { kind: 'detail', turn: 1, blocks: [lightDetail] }, '').state;
  ok('⑤ 同号同内容重复应用 ⇒ 原 state 引用（幂等）', s === settled);
}

// ── §6 源码接线（回退即红）────────────────────────────────────────────────
declare const require: (m: string) => { readFileSync: (p: string, e: string) => string };
declare const __dirname: string;
const fs = require('fs');
const root = __dirname + '/../../../..';
const src: string = fs.readFileSync(root + '/entry/src/main/ets/core/model_step.ts', 'utf8');
ok('⑥ tick 路径走字段级合并', src.indexOf('mergeToolMeta(known !== undefined ? known.meta : undefined, tk.meta)') >= 0);
// 2026-10-28：提交前先丢弃**外来迭代**的工具（`dropForeignTools`），再富化（P0 去重的一条腿）
// ⛔ 2026-10-28 改判：模型层**绝不删工具**（删数据 = 「tool 不见了」P0）⇒ 只剩富化；
//   重复吸收在渲染层（`MessageRow.committedHasSameIterCall` / `pillmerge` 带迭代号的键）。
ok('⑥ 提交路径只富化、不删工具',
  src.indexOf('enrichDoneBlock(s, f.turn, dropForeignTools(f.block))') >= 0
  && src.indexOf('function dropForeignTools(') >= 0
  && src.indexOf('dropAssignedCalls') < 0);
ok('⑥ final 路径走 mergeToolLists', src.indexOf('mergeToolLists(\n          prev !== undefined ? mergeToolLists(liveTools, prev.tools) : liveTools, inc.tools)') >= 0);
ok('⑥ ⛔ 旧的"tk.meta 整体优先"已移除', src.indexOf('tk.meta !== undefined ? tk.meta : (known !== undefined ? known.meta') < 0);

// ── §7 在飞 iter 的详情补水（"最后一个完成的工具"就住在这里）──────────────────
// 一轮的**最后一次**迭代常常还挂在 live（提交只来轻快照）⇒ 旧 `onDetail` 只遍历 `t.blocks`
// ⇒ 详情被丢弃 ⇒ 该 pill 永远没有参数/输出（用户 2026-10-28 亲报）。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  // ⚠️ 工具必须带**在飞迭代号**（3）：旧的夹具写成 1，会被新增的"单一归属/本迭代"不变量
  //    正确过滤掉（那不是 bug，是判据在起作用）。
  const stale: ToolRec = lightTool('c9');
  const ownStage: ToolRec = {
    call: stale.call, iteration: 3, meta: stale.meta, state: stale.state,
  };
  s = step(s, tick(1, 3, 2, [ownStage]), '').state;
  eq('⑦ 前置：live 工具无 args', s.live!.tools[0].meta.args, '');
  const fresh: Block = {
    iteration: 3, content: '正文', reasoning: '',
    tools: [richTool('c9', '{"cmd":"tail -n 5 log"}', '最后 5 行')],
    subAgents: [], genui: '', cancelled: false,
  };
  s = step(s, { kind: 'detail', turn: 1, blocks: [fresh] }, '').state;
  eq('⑦ 在飞 iter 的详情落进 live.tools', s.live!.tools[0].meta.args, '{"cmd":"tail -n 5 log"}');
  eq('⑦ 输出也落进去', s.live!.tools[0].meta.detail, '最后 5 行');
  eq('⑦ 不凭空造块', s.turns.get(1)!.blocks.length, 0);
  const settled = s;
  s = step(s, { kind: 'detail', turn: 1, blocks: [fresh] }, '').state;
  ok('⑦ 重复应用幂等（原 state 引用）', s === settled);
}

// ── §8 在飞 pill 必须能触发按需拉详情（渲染路径不能"自己弹浮层、从不通知页面"）────
{
  const liveSrc: string = fs.readFileSync(root + '/entry/src/main/ets/components/LiveTailView.ets', 'utf8');
  const rowSrc: string = fs.readFileSync(root + '/entry/src/main/ets/components/MessageRow.ets', 'utf8');
  ok('⑧ LiveTailView 声明了 onNeedDetail 回调', liveSrc.indexOf('onNeedDetail: (iter: number, name: string') >= 0);
  ok('⑧ 打开 pill 时回调（仅打开那一刻）',
    liveSrc.indexOf('const opening: boolean = this.popIdx !== i;') >= 0
    && liveSrc.indexOf('this.onNeedDetail(this.iteration, t.name, t.iteration);') >= 0);
  ok('⑧ MessageRow 把回调接到 onToggleTool（唯一取数出口）',
    rowSrc.indexOf('onNeedDetail: (iter: number, name: string, toolIter?: number) => {') >= 0);
  ok('⑧ ⛔ 旧形态（只置 popIdx、不通知）已移除',
    liveSrc.indexOf('this.popIdx = this.popIdx === i ? -1 : i;') < 0);
}

// ── §9 busy→idle 的**权威重载**不得抹掉详情（用户 2026-10-28 P0：「必须修好」）──────
// idle 边沿会触发 `loadHistory` → `history_replaced` → `hydrate()`；历史载荷里的工具是
// **轻字段**（DB 只存 name/label/status）⇒ 旧实现整表替换 ⇒ 在飞期间拿到的 args/detail
// 在变 idle 那一刻被抹掉。修法：`hydrate` 用 `mergeSnapshotBlock` 逐字段补。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [richTool('c1', '{"cmd":"ls"}', 'total 0')]), '').state;
  s = step(s, done(1, blk(1, [richTool('c1', '{"cmd":"ls"}', 'total 0')]), 3), '').state;
  eq('⑨ 前置：块里有 args', lastBlock(s, 1).tools[0].meta.args, '{"cmd":"ls"}');

  // 权威快照：同一回合/迭代，但工具是轻字段（DB 形态）
  const snap: WireHistoryMessage[] = [{
    id: 'm2', role: 'assistant', content: '正文', turnID: 1, timestamp: 't',
    iterations: [{ iteration: 1, content: '正文', tools: [{ name: 'Shell', status: 'done' }] }],
  }];
  const after = hydrate(s, snap, 4);
  const b = lastBlock(after, 1);
  eq('⑨ 重载后 args 仍在（busy→idle 不丢详情）', b.tools[0].meta.args, '{"cmd":"ls"}');
  eq('⑨ 重载后 detail 仍在', b.tools[0].meta.detail, 'total 0');
  eq('⑨ 正文仍以快照为权威', b.content, '正文');
}

console.log(`tool_meta_merge: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
