/**
 * **同一个 toolcall 绝不能同时出现在两个迭代里**（用户 2026-10-28 P0，反复回归）。
 *
 * ── 用户看到的确切形态（截图实证，连续两轮回归都是它）─────────────────────────────
 * ```
 * 行1: tool1
 * 行2: tool1 tool2
 * ```
 * 行1 与行2 是**两个容器**（已提交块的 `Flex` + 在飞块的 `Flex`）⇒ 说明同一枚 `tool1`
 * 同时存在于 **模型的两个迭代**：
 *   · 迭代 N（已提交块）里有它；
 *   · 迭代 N+1（在飞）里**又**有它 —— 服务端 `active_tools` 会**整批先标 pending 并把
 *    陈旧条目带进后续帧**（`agent/engine_run_tools.go:49-64`；其注释明确要求前端按
 *     `iteration` 过滤），残留副本保留**原始迭代号**。
 *
 * ── 为什么"渲染层去重"治不住（上两轮我踩的坑）──────────────────────────────────
 * 渲染层的去重只在**单个组件**内生效（`IterBlocksView` 的 `mergedBlocks()` / `LiveTailView`
 * 的 `shownList()`）。而这两枚 pill 分属**两个组件** ⇒ 任何"渲染前 dedupe"都不可能看见对方。
 * ⇒ **唯一正确的层是模型**：`live.tools` 里只允许 `iteration > 已提交块最大号` 的工具
 *   （= 与 web `LiveIteration.toolDeriv` 同一条判据）。
 *
 * ── 本文件是"先红后绿"的判据 ────────────────────────────────────────────────────
 * §1 复现用户的形态：`live.tools` 里出现**已提交迭代**的工具 ⇒ **必须红**（修复前）。
 * §2 修复后：`live.tools` 只剩当前在飞迭代的工具；已提交块仍保留自己那一枚。
 * §3 边界：同一迭代内多枚同名工具（迭代号相同、call_id 不同）**不得**被误删。
 * §4 在飞迭代推进（N+1 → N+2）：上一在飞迭代的工具不得跟进新迭代。
 */
declare const process: { exit: (c: number) => void };

import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { Block, DoneFrame, OpenFrame, State, TickFrame, ToolRec, ToolStatus, UserLine } from '../../entry/src/main/ets/core/model_types';
import { step } from '../../entry/src/main/ets/core/model_step';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

const CHAT = 'chat_L';
const EPOCH = 2;

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function tool(call: string, iteration: number, label: string): ToolRec {
  return {
    call, iteration,
    meta: { name: 'Shell', args: `{"cmd":"${label}"}`, detail: '', summary: '', toolHints: '' },
    state: { status: 'done', label, genChars: 0, elapsedMs: 10 },
  };
}
function blk(iteration: number, tools: ToolRec[]): Block {
  return { iteration, content: '', reasoning: '', tools, subAgents: [], genui: '', cancelled: false };
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
    content: { kind: 'full', text: '' },
    reasoning: { kind: 'full', text: '' },
    tools: tools.map((t) => ({ call: t.call, iteration: t.iteration, state: t.state, meta: t.meta })),
    genui: '',
  };
}
function done(turn: number, block: Block, seq: number): DoneFrame {
  return { kind: 'done', epoch: EPOCH, seq, chat: CHAT, turn, block };
}
/** `live.tools` 里各工具的 `标识@迭代号`（用于断言"哪些工具被带进了在飞列表"）。 */
function liveTags(s: State): string[] {
  if (s.live === null) { return []; }
  const out: string[] = [];
  for (let i = 0; i < s.live.tools.length; i++) {
    out.push(`${s.live.tools[i].call}@${s.live.tools[i].iteration}`);
  }
  return out;
}

// ── §1 复现用户形态（修复前必须红）────────────────────────────────────────────
// 迭代 1 提交（含 tool1）→ 服务端在迭代 2 的帧里**又把 tool1** 带回来（残留副本，
// 自带 iteration=1）+ 新的 tool2。当前实现会把它塞进 live ⇒ 两个容器各画一枚。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'ssh -o A')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'ssh -o A')]), 3), '').state;
  s = step(s, tick(1, 2, 4, [tool('c1', 1, 'ssh -o A'), tool('c2', 2, 'ssh -o B')]), '').state;
  eq('§1 在飞列表**不得**含已提交迭代（1）的工具（否则同一枚 pill 会被画两遍）',
    liveTags(s), ['c2@2']);
  eq('§1 已提交块里仍保留自己那一枚',
    s.turns.get(1)!.blocks[0].tools.length, 1);
}

// ── §2 同一迭代里多枚同名工具不得被误删 ───────────────────────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('a1', 1, 'ssh -o X'), tool('a2', 1, 'ssh -o X')]), '').state;
  eq('§2 同一迭代的两枚同名调用都保留', liveTags(s), ['a1@1', 'a2@1']);
}

// ── §3 在飞推进（2 → 3）：上一在飞迭代的工具不得跟进 ─────────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  s = step(s, tick(1, 2, 4, [tool('c2', 2, 'b')]), '').state;
  s = step(s, tick(1, 3, 5, [tool('c2', 2, 'b'), tool('c3', 3, 'c')]), '').state;
  eq('§3 迭代 3 的在飞列表只含自己的工具（c2 属于已提交？未提交——见断言语义）',
    liveTags(s), ['c3@3']);
}

// ── §4 详情补水（onDetail）不得把旧迭代工具塞回在飞列表 ───────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  s = step(s, tick(1, 2, 4, [tool('c2', 2, 'b')]), '').state;
  const detailOld: Block = {
    iteration: 1, content: '', reasoning: '',
    tools: [tool('c1', 1, 'a')], subAgents: [], genui: '', cancelled: false,
  };
  s = step(s, { kind: 'detail', turn: 1, blocks: [detailOld] }, '').state;
  eq('§4 旧迭代详情只补块、不进在飞列表', liveTags(s), ['c2@2']);
}

// ── §5 提交帧带残留副本：块内只留自己的迭代（另一条腿，堵住"块 × 块"重复）──────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  // 迭代 2 的提交帧里又带回 c1（iteration=1，残留）
  s = step(s, done(1, blk(2, [tool('c1', 1, 'a'), tool('c2', 2, 'b')]), 4), '').state;
  // ⛔ 2026-10-28 改判：模型层**绝不删工具**（删数据就是「tool 不见了」）。
  //   重复吸收下沉到渲染层：`MessageRow.committedHasSameIterCall`（同迭代同 call）+ `pillmerge`。
  // 工具号被 `stampBlock` 归一成块号（T5-c），但**数据本身一枚不少**（绝不删）
  eq('§5 模型保留全部工具（绝不因"看起来重复"而删数据）',
    s.turns.get(1)!.blocks[1].tools.map((t) => `${t.call}@${t.iteration}`), ['c1@2', 'c2@2']);
  eq('§5 块 1 仍保留自己的工具', s.turns.get(1)!.blocks[0].tools.length, 1);
}

// ── §6 全消息级不变量：同一 (call) 不得出现在两个块里 ─────────────────────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  s = step(s, done(1, blk(2, [tool('c2', 2, 'b')]), 4), '').state;
  s = step(s, tick(1, 3, 5, [tool('c1', 1, 'a'), tool('c3', 3, 'c')]), '').state;
  const seen: string[] = [];
  const turn = s.turns.get(1)!;
  for (let i = 0; i < turn.blocks.length; i++) {
    for (let k = 0; k < turn.blocks[i].tools.length; k++) {
      seen.push(turn.blocks[i].tools[k].call);
    }
  }
  for (let i = 0; i < (s.live === null ? 0 : s.live.tools.length); i++) {
    seen.push(s.live!.tools[i].call);
  }
  eq('§6 整轮的 call 集合不重复（块 ∪ 在飞）', seen, ['c1', 'c2', 'c3']);
}

// ── §7 残留副本被**重新盖章**成新迭代号时，仍须按 call 身份吸收 ──────────────
// （服务端可能把旧条目改写 iteration 后带进新一帧 ⇒ 只按迭代号分不开，必须用 call 兜底）
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  // 迭代 2 的提交帧：同一 call `c1` 被盖章成 iteration=2（残留 + 重盖章）
  s = step(s, done(1, blk(2, [tool('c1', 2, 'a'), tool('c2', 2, 'b')]), 4), '').state;
  eq('§7 模型不删（渲染层吸收），块 2 保留两枚数据', s.turns.get(1)!.blocks[1].tools.length, 2);
}

// ── §8 在飞列表也不得出现"已被块占用的 call"（哪怕迭代号写成当前在飞号）──────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  s = step(s, tick(1, 2, 4, [tool('c1', 2, 'a'), tool('c2', 2, 'b')]), '').state;
  eq('§8 在飞列表只剩真正属于本迭代的新调用', liveTags(s), ['c2@2']);
}

// ── §9 **重连后**的权威重载（hydrate）同样必须满足单一归属 ─────────────────────
// 用户 2026-10-28：「红框里的重复了，好像是重连后…特殊情况还有」。
// 重连 = `history_replaced` → `hydrate()`：它按快照**重建**块，而快照里同样可能带残留
// （同一 call 出现在两个迭代）或与 prev.live 重复 ⇒ 旧实现不做单一归属过滤 ⇒ 重连后复发。
{
  const snap: WireHistoryMessage[] = [{
    id: 'm1', role: 'assistant', content: '正文', turnID: 1, timestamp: 't',
    iterations: [
      { iteration: 1, content: '正文', tools: [{ name: 'Shell', args: '{"cmd":"ssh -o A"}', label: 'ssh -o A' }] },
      // 迭代 2 又带回同一 call（残留；这里用同名同 args 表示"服务端重复派发/残留"）
      { iteration: 2, content: '', tools: [
        { name: 'Shell', args: '{"cmd":"ssh -o A"}', label: 'ssh -o A' },
        { name: 'Shell', args: '{"cmd":"ssh -o B"}', label: 'ssh -o B' },
      ] },
    ],
  }];
  const s = hydrate(emptyState(CHAT, EPOCH, 0), snap, 1);
  const blocks = s.turns.get(1)!.blocks;
  const calls: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let k = 0; k < blocks[i].tools.length; k++) {
      calls.push(blocks[i].tools[k].call);
    }
  }
  // 模型层只保证"迭代不重复（upsert）"与"数据不丢"；可见重复由渲染层吸收。
  eq('§9 重载后迭代不重复', blocks.length, 2);
  eq('§9 数据不丢（迭代 2 的工具都在）', blocks[1].tools.length, 2);
  eq('§9 整轮 call 数量 = 输入数量（无删除）', calls.length, 3);
}

// ── §10 重连时 live 快照与已提交块不得重叠 ────────────────────────────────────
{
  const snap: WireHistoryMessage[] = [{
    id: 'm1', role: 'assistant', content: '正文', turnID: 1, timestamp: 't',
    iterations: [{ iteration: 1, content: '正文', tools: [{ name: 'Shell', args: '{"cmd":"a"}', label: 'a' }] }],
  }];
  const withLive = hydrate(emptyState(CHAT, EPOCH, 0), snap, 1, {
    turnID: 1,
    snapshot: {
      iter: 2,
      content: '',
      reasoning: '',
      // 在飞快照里混入了迭代 1 的工具（残留）
      completedTools: [{ name: 'Shell', args: '{"cmd":"a"}', label: 'a' }],
      activeTools: [{ name: 'Shell', args: '{"cmd":"b"}', label: 'b' }],
      streamingTools: [],
    },
  });
  const live = withLive.live!;
  const liveCalls = live.tools.map((t) => t.call);
  const blockCalls: string[] = [];
  for (const b of withLive.turns.get(1)!.blocks) {
    for (const t of b.tools) { blockCalls.push(t.call); }
  }
  eq('§10 在飞列表不含迭代 1 的 call', liveCalls.filter((c) => blockCalls.indexOf(c) >= 0), []);
}

// ── §11 同一迭代**不得重复出现**（P0「连续思考」）──────────────────────────────
// 用户 2026-10-28：「p0 bug，连续思考」（截图：思考 25 字 / 38 字 / 50 字 三条叠着）。
// 根因：`hydrate()` 把历史里**同一个 iteration** 的块**追加**了多次（同一条回合里多行
// assistant 快照 / 重连重放），于是同一迭代被画成多条「思考」行（字数递增=不同时刻的快照）。
// 不变量：一轮里 `iteration` 必须唯一（后到者合并/覆盖先到者，而不是再追加一条）。
{
  const snap: WireHistoryMessage[] = [
    { id: 'm1', role: 'assistant', content: '', turnID: 1, timestamp: 't',
      iterations: [{ iteration: 1, content: '', reasoning: '一二三' }] },
    { id: 'm2', role: 'assistant', content: '', turnID: 1, timestamp: 't',
      iterations: [{ iteration: 1, content: '', reasoning: '一二三四五' }] },
    { id: 'm3', role: 'assistant', content: '', turnID: 1, timestamp: 't',
      iterations: [{ iteration: 1, content: '', reasoning: '一二三四五六七' }] },
  ];
  const s = hydrate(emptyState(CHAT, EPOCH, 0), snap, 1);
  const blocks = s.turns.get(1)!.blocks;
  eq('§11 同一迭代只保留一块（不得出现"连续思考"）', blocks.length, 1);
  eq('§11 保留**最新**快照的思考内容', blocks[0].reasoning, '一二三四五六七');
}

// ── §12 已提交的迭代不得再有"在飞"副本（P0「思考后有思考中」）────────────────────
// 用户 2026-10-28 截图：`思考 29 字` 紧跟 `思考中…` —— 同一个迭代既在已提交块里
// （思考 29 字），又被当成在飞迭代画了一条"思考中…"。根因：`hydrate()` 用 `active.snapshot`
// 建了 `live`，而该 `iteration` **已经在块里**（已提交）⇒ 必须把 `live` 清掉。
// 不变量：`live.iteration` 必须**严格大于**该轮已提交块的最大迭代号（前沿唯一）。
{
  const snap: WireHistoryMessage[] = [{
    id: 'm1', role: 'assistant', content: '', turnID: 1, timestamp: 't',
    iterations: [{ iteration: 1, content: '', reasoning: '思考二十九字…' }],
  }];
  const s = hydrate(emptyState(CHAT, EPOCH, 0), snap, 1, {
    turnID: 1,
    snapshot: { iter: 1, content: '', reasoning: '', streamingTools: [], activeTools: [], completedTools: [] },
  });
  eq('§12 已提交的迭代不得残留 live（否则"思考 29 字 + 思考中…"同时出现）', s.live, null);
}

// ── §13 在飞快照迭代号 **小于** 已提交最大号 时同样必须丢弃 live ───────────────
{
  const snap: WireHistoryMessage[] = [{
    id: 'm1', role: 'assistant', content: '', turnID: 1, timestamp: 't',
    iterations: [
      { iteration: 1, content: '', reasoning: 'a' },
      { iteration: 2, content: '', reasoning: 'b' },
    ],
  }];
  const s = hydrate(emptyState(CHAT, EPOCH, 0), snap, 1, {
    turnID: 1,
    snapshot: { iter: 1, content: '', reasoning: '', streamingTools: [], activeTools: [], completedTools: [] },
  });
  eq('§13 落后的在飞快照不得复活 live', s.live, null);
}

// ── §14 工具完成后**不得消失**（P5：提交帧/快照"缺 tools"= 未携带，不是"空"）────────
// 用户 2026-10-28：「新的工具完成后直接消失了」。
// 根因：`mergeToolLists(prev, next)` 旧实现 `next.length === 0 ⇒ return next` ⇒ 用**空表**
//   覆盖已有工具。而 `done`/`final`/history 快照经常**不带 tools**（P5 缺字段形态）
//   ⇒ 工具在"完成"那一刻被清空。语义必须是：**next 为空 = 未携带 ⇒ 保留 prev**。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  // 提交帧**不带 tools**（轻快照/缺字段）
  s = step(s, done(1, blk(1, []), 3), '').state;
  eq('§14 done 缺 tools ⇒ 工具不消失', s.turns.get(1)!.blocks[0].tools.map((t) => t.call), ['c1']);
}
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('c1', 1, 'a')]), '').state;
  s = step(s, done(1, blk(1, [tool('c1', 1, 'a')]), 3), '').state;
  // final 的 progressHistory 也缺 tools ⇒ 仍不消失
  const finBlock: Block = {
    iteration: 1, content: 'fin', reasoning: '', tools: [], subAgents: [], genui: '', cancelled: false,
  };
  s = step(s, { kind: 'final', epoch: EPOCH, seq: 4, chat: CHAT, turn: 1, content: 'fin',
    cancelled: false, phase: 'done', blocks: [finBlock] } as never, '').state;
  eq('§14 final 缺 tools ⇒ 工具不消失', s.turns.get(1)!.blocks[0].tools.map((t) => t.call), ['c1']);
}

// ── §15 `final` 的 progressHistory **不得丢本地已有的迭代**（P0「漏迭代」）──────────
// 用户 2026-10-28 P0：「漏迭代，重启之后历史迭代才完整」。
// 现象：busy 时某块只画 1 枚工具；重启（hydrate 全量历史）后同一块出现 5 枚。
// 根因：`text_final` 的 `progressHistory` 是**可能截断**的快照，旧实现 `blocks = stamped`
//   整表替换 ⇒ 本地已经提交、但快照里没有的迭代**被删掉**（漏迭代），直到下次 hydrate 才回来。
// 不变量：`final` 只能**更新/追加**，绝不能删除本地已有的迭代（按 iteration 并集）。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [tool('a1', 1, 'A')]), 2), '').state;
  s = step(s, done(1, blk(2, [tool('b1', 2, 'B')]), 3), '').state;
  // 快照只带迭代 1（截断）：迭代 2 绝不能消失
  const onlyOne: Block = blk(1, [tool('a1', 1, 'A')]);
  s = step(s, { kind: 'final', epoch: EPOCH, seq: 4, chat: CHAT, turn: 1, content: 'fin',
    cancelled: false, phase: 'done', blocks: [onlyOne] } as never, '').state;
  eq('§15 final 截断快照不得删掉本地迭代', s.turns.get(1)!.blocks.map((b) => b.iteration), [1, 2]);
}

// ── §16 缺口迭代（pending 缓冲）在 final 时必须落地（否则同样"漏迭代"）───────────
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [tool('a1', 1, 'A')]), 2), '').state;
  // 3 直接到（2 缺失）⇒ 进 pending，不显示
  s = step(s, done(1, blk(3, [tool('c1', 3, 'C')]), 3), '').state;
  eq('§16 缺口期间 3 先不入账', s.turns.get(1)!.blocks.length, 1);
  // final 证明 2 不存在（快照只有 1、3）⇒ 3 必须落地，不能永远卡在 pending
  s = step(s, { kind: 'final', epoch: EPOCH, seq: 4, chat: CHAT, turn: 1, content: 'fin',
    cancelled: false, phase: 'done', blocks: [blk(1, [tool('a1', 1, 'A')]), blk(3, [tool('c1', 3, 'C')])] } as never, '').state;
  eq('§16 final 后缺口迭代必须落地（不漏）', s.turns.get(1)!.blocks.map((b) => b.iteration), [1, 3]);
  eq('§16 落地后 pending 清空', s.pending.size, 0);
}

// ── §17 半截迭代（SSE 中断，只有 reasoning）必须落地成块，不能消失 ────────────────
// 用户 2026-10-28：「请求异常、SSE 只输出一半就结束，导致有些迭代只有 reasoning，
//   你好像不会显示这种迭代」。
// 根因：这类迭代**没有 `done` 帧**（中断在生成中）⇒ 内容只存在于 `live` 里；
//   `text_final` 的 `progressHistory` 又不包含它（服务端没落库）⇒ 旧实现清掉 live 后，
//   这段思考**彻底消失**。⇒ `final` 必须把 live 里"尚未成为块"的内容**落地成块**。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, done(1, blk(1, [tool('a1', 1, 'A')]), 2), '').state;
  // 迭代 2 只有思考（生成中被打断，没有 done）
  const partial: TickFrame = {
    kind: 'tick', epoch: EPOCH, seq: 3, chat: CHAT, turn: 1, iteration: 2, phase: 'thinking',
    streaming: true, content: { kind: 'full', text: '' },
    reasoning: { kind: 'full', text: '半截思考：正在分析…' }, tools: [], genui: '',
  };
  s = step(s, partial, '').state;
  eq('§17 前置：live 有半截思考', s.live === null ? '' : s.live.reasoning, '半截思考：正在分析…');
  // final 的 progressHistory 不含迭代 2（未落库）
  s = step(s, { kind: 'final', epoch: EPOCH, seq: 4, chat: CHAT, turn: 1, content: '中断',
    cancelled: true, phase: 'done', blocks: [blk(1, [tool('a1', 1, 'A')])] } as never, '').state;
  const blocks = s.turns.get(1)!.blocks;
  eq('§17 半截迭代必须落地成块（不得消失）', blocks.map((b) => b.iteration), [1, 2]);
  eq('§17 落地后保留思考内容', blocks[1].reasoning, '半截思考：正在分析…');
  eq('§17 live 已清空', s.live, null);
}

// ── §20 工具集在**同一迭代内只增不减**；状态只许单向推进 ───────────────────────────
// 用户 2026-10-29：「generating 之后只能是 running 或者 done，**不能 tool 消失**」+「generating→running
//   期间整个 tool 消失一瞬间导致高度跳变」。
// 根因：`applyToolTicks` 把本帧的工具列表当**全集**重建；而服务端分桶下发
//   （`streaming_tools` / `active_tools` / `completed_tools` 可能分帧到达）⇒ 只带 A 桶的帧
//   会把 B 桶里的工具**抹掉** ⇒ pill 消失一瞬。
// 不变量：① 工具集单调增（同迭代内 prev ∪ next）；② 状态不回退（done 不会被 running 覆盖）。
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  s = step(s, tick(1, 1, 2, [tool('a', 1, 'A')]), '').state;
  eq('§20 前置：A 在列表里', liveTags(s), ['a@1']);
  // 下一帧只带 B（分桶到达）——A 绝不能消失
  s = step(s, tick(1, 1, 3, [tool('b', 1, 'B')]), '').state;
  const tags: string[] = liveTags(s);
  tags.sort();
  eq('§20 分桶帧不得抹掉已出现的工具', tags, ['a@1', 'b@1']);
}
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  const gen: ToolRec = {
    call: 'x', iteration: 1,
    meta: { name: 'Shell', args: '', detail: '', summary: '', toolHints: '' },
    state: { status: 'generating', label: 'Shell', genChars: 3, elapsedMs: 0 },
  };
  s = step(s, tick(1, 1, 2, [gen]), '').state;
  const running: ToolRec = {
    call: 'x', iteration: 1, meta: gen.meta,
    state: { status: 'running', label: 'Shell', genChars: 3, elapsedMs: 10 },
  };
  s = step(s, tick(1, 1, 3, [running]), '').state;
  eq('§20 generating→running 不许消失', liveTags(s), ['x@1']);
  eq('§20 状态推进到 running', s.live!.tools[0].state.status, 'running');
  const doneTool: ToolRec = {
    call: 'x', iteration: 1, meta: gen.meta,
    state: { status: 'done', label: 'Shell', genChars: 3, elapsedMs: 20 },
  };
  s = step(s, tick(1, 1, 4, [doneTool]), '').state;
  eq('§20 running→done 正常', s.live!.tools[0].state.status, 'done');
  // 迟到帧把状态写回 running ⇒ 不许回退
  s = step(s, tick(1, 1, 5, [running]), '').state;
  eq('§20 done 不得被迟到的 running 回退', s.live!.tools[0].state.status, 'done');
}

// ── §21 未知/中间状态不得阻断状态推进（用户 2026-10-29：「卡在生成中，即使已经 running」）──
{
  let s: State = emptyState(CHAT, EPOCH, 0);
  s = step(s, open(1, 1), '').state;
  const weird: ToolRec = {
    call: 'w', iteration: 1,
    meta: { name: 'Shell', args: '', detail: '', summary: '', toolHints: '' },
    state: { status: 'queued' as unknown as ToolStatus, label: 'Shell', genChars: 0, elapsedMs: 0 },
  };
  s = step(s, tick(1, 1, 2, [weird]), '').state;
  const running: ToolRec = {
    call: 'w', iteration: 1, meta: weird.meta,
    state: { status: 'running', label: 'Shell', genChars: 0, elapsedMs: 5 },
  };
  s = step(s, tick(1, 1, 3, [running]), '').state;
  eq('§21 未知状态(queued) 不阻断 → 能推进到 running', s.live!.tools[0].state.status, 'running');
  const doneT: ToolRec = {
    call: 'w', iteration: 1, meta: weird.meta,
    state: { status: 'done', label: 'Shell', genChars: 0, elapsedMs: 9 },
  };
  s = step(s, tick(1, 1, 4, [doneT]), '').state;
  eq('§21 再推进到 done', s.live!.tools[0].state.status, 'done');
}

console.log(`live_tools_no_stale: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
