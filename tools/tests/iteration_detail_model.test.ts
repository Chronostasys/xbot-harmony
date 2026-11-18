/**
 * `/api/iteration_detail` 的模型侧接线判据
 * （用户 2026-10-27 P0：「历史工具调用打开全是暂无详情，只有最后一个工具能看参数和结果」）。
 *
 * 根因（本文件钉死）：**行源是模型**（`applyModel`），而 `adapt` 此前对 `iterations_loaded`
 *   **没有分支**（落 `default` ⇒ 丢弃）⇒ 详情拉回来了，只有旧管线 `reduce` 收到，
 *   模型块永远没有 `args/detail` ⇒ 浮层恒「暂无详情」；只有最后一个工具因为在飞帧里
 *   带过完整 `meta` 才可见。修法 = `iterations_loaded → {kind:'detail'}` + `onDetail`
 *   **按号覆盖**已提交块（只补不抹）。
 *
 * mutation 自证：删掉 `adapt` 的 `iterations_loaded` 分支 ⇒ §2 红；
 *   删掉 `step` 的 `case 'detail'` ⇒ §1/§3 红。
 */
declare const process: { exit: (c: number) => void };

import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { Block, DoneFrame, OpenFrame, State, ToolRec, UserLine } from '../../entry/src/main/ets/core/model_types';
import { step } from '../../entry/src/main/ets/core/model_step';
import { adapt } from '../../entry/src/main/ets/core/model_adapter';

const CHAT = 'chat_T';
const EPOCH = 3;

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function lightTool(call: string): ToolRec {
  return {
    call, iteration: 1,
    // 折叠视图的典型形态：轻字段齐全，详情字段**全空**
    meta: { name: 'Shell', args: '', detail: '', summary: '', toolHints: '' },
    state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 12 },
  };
}
function lightBlock(iteration: number, content: string): Block {
  return { iteration, content, reasoning: '', tools: [lightTool('c1')], subAgents: [], genui: '', cancelled: false };
}
function open(turn: number, seq: number): OpenFrame {
  const u: UserLine = {
    id: `u${turn}`, content: `hi${turn}`, timestamp: 't', isNotification: false,
    queued: false, sending: false, requestID: `r${turn}`,
  };
  return { kind: 'open', epoch: EPOCH, seq, chat: CHAT, turn, user: u, requestID: u.requestID };
}
function done(turn: number, block: Block, seq: number): DoneFrame {
  return { kind: 'done', epoch: EPOCH, seq, chat: CHAT, turn, block };
}
/** 已收尾的 turn（块 = 轻字段形态）。 */
function committed(): State {
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, lightBlock(1, '旧正文'), 2), '').state;
  return s;
}
function blkOf(s: State, turn: number, iteration: number): Block | undefined {
  const t = s.turns.get(turn);
  if (t === undefined) { return undefined; }
  for (let i = 0; i < t.blocks.length; i++) {
    if (t.blocks[i].iteration === iteration) { return t.blocks[i]; }
  }
  return undefined;
}

// ── §1 详情输入真的进模型（同号覆盖，工具带上 args/detail）───────────────────
{
  const before = committed();
  eq('前置：轻字段块的 args 为空', blkOf(before, 1, 1)!.tools[0].meta.args, '');
  const full: Block = {
    iteration: 1, content: '旧正文', reasoning: '',
    tools: [{
      call: 'c1', iteration: 1,
      meta: { name: 'Shell', args: '{"cmd":"ls -la"}', detail: 'total 0\ndrwxr-xr-x', summary: '列目录', toolHints: '' },
      state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 12 },
    }],
    subAgents: [], genui: '', cancelled: false,
  };
  const r = step(before, { kind: 'detail', turn: 1, blocks: [full] }, '');
  const after = blkOf(r.state, 1, 1)!;
  eq('① 参数已落进模型块', after.tools[0]!.meta.args, '{"cmd":"ls -la"}');
  ok('① 输出已落进模型块', (after.tools[0]!.meta.detail ?? '').indexOf('total 0') === 0);
  eq('① 摘要已落进模型块', after.tools[0]!.meta.summary, '列目录');
  eq('① 不产生 effect（这是 hydrate，不是网络触发）', r.effects.length, 0);
  eq('① 块数不变（不产生新块）', r.state.turns.get(1)!.blocks.length, 1);
}

// ── §2 adapter：`iterations_loaded` 必须翻成 detail 输入（旧实现落 default ⇒ 丢弃）──
{
  const evs = adapt({
    type: 'iterations_loaded',
    turnID: 1,
    iterations: [{
      iteration: 2,
      content: '正文2',
      reasoning: '思考2',
      tools: [{ name: 'Shell', label: 'Shell', status: 'done', args: '{"cmd":"pwd"}', detail: '/root', summary: 'pwd' }],
    }],
  } as never, CHAT, EPOCH);
  eq('② 恰好一条模型输入', evs.length, 1);
  eq('② 输入类型 = detail', evs[0].kind, 'detail');
  const di = evs[0] as unknown as { turn: number; blocks: Block[] };
  eq('② 目标 turn', di.turn, 1);
  eq('② 块号保持服务端号', di.blocks[0].iteration, 2);
  eq('② 参数随块到达', di.blocks[0].tools[0].meta.args, '{"cmd":"pwd"}');
  eq('② 输出随块到达', di.blocks[0].tools[0].meta.detail, '/root');
  eq('② 工具号盖成块号（T5-c）', di.blocks[0].tools[0].iteration, 2);
}

// ── §3 幂等 + 只补不抹 ──────────────────────────────────────────────────────
{
  const before = committed();
  const full: Block = {
    iteration: 1, content: '', reasoning: '',
    tools: [{
      call: 'c1', iteration: 1,
      meta: { name: 'Shell', args: '{"cmd":"ls"}', detail: 'ok', summary: '', toolHints: '' },
      state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 12 },
    }],
    subAgents: [], genui: '', cancelled: false,
  };
  const once = step(before, { kind: 'detail', turn: 1, blocks: [full] }, '');
  const twice = step(once.state, { kind: 'detail', turn: 1, blocks: [full] }, '');
  ok('③ 重复应用同号详情 ⇒ 状态原引用（幂等）', twice.state === once.state);
  eq('③ 半截载荷（content 为空）不抹掉已有正文', blkOf(once.state, 1, 1)!.content, '旧正文');

  // 空 tools 的详情不得把已有 pills 抹掉
  const emptyTools: Block = { iteration: 1, content: '', reasoning: '', tools: [], subAgents: [], genui: '', cancelled: false };
  const r = step(once.state, { kind: 'detail', turn: 1, blocks: [emptyTools] }, '');
  eq('③ 空 tools 不抹已有工具', blkOf(r.state, 1, 1)!.tools.length, 1);
}

// ── §4 边界：不存在的 turn / 空块列表 ⇒ 不动 ────────────────────────────────
{
  const s = committed();
  const miss = step(s, { kind: 'detail', turn: 99, blocks: [lightBlock(1, 'x')] }, '');
  ok('④ 不存在的 turn ⇒ 状态原引用', miss.state === s);
  const empty = step(s, { kind: 'detail', turn: 1, blocks: [] }, '');
  ok('④ 空块列表 ⇒ 状态原引用', empty.state === s);
  const noTurn = adapt({ type: 'iterations_loaded', turnID: 0, iterations: [{ iteration: 1 }] } as never, CHAT, EPOCH);
  eq('④ turnID=0 ⇒ 不猜归属（无输入）', noTurn.length, 0);
}

// ── §5 源码接线（防止回退：adapter 分支 / step 分支必须都在）─────────────────
declare const require: (m: string) => { readFileSync: (p: string, e: string) => string };
declare const __dirname: string;
const fs = require('fs');
const root = __dirname + '/../../../..';
const adapterSrc: string = fs.readFileSync(root + '/entry/src/main/ets/core/model_adapter.ts', 'utf8');
const stepSrc: string = fs.readFileSync(root + '/entry/src/main/ets/core/model_step.ts', 'utf8');
ok('⑤ adapter 有 iterations_loaded 分支', adapterSrc.indexOf("case 'iterations_loaded'") >= 0);
ok('⑤ adapter 产出 detail 输入', adapterSrc.indexOf("kind: 'detail', turn, blocks") >= 0);
ok('⑤ step 有 detail 处理', stepSrc.indexOf("case 'detail': return onDetail(s, input)") >= 0);

console.log(`iteration_detail_model: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
