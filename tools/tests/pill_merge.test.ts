/**
 * 判据：**折叠单元必须是"一次回复里连续的纯工具迭代"**，不能是单个迭代。
 *
 * 2026-10-25 用户 P0（截图：`Shell: cd ~/src/sglang-b300-glm52 …` 一路往下堆 20 行）：
 *   `foldPills`（>8 ⇒ 前 7 + `+N`，web `MergedPills` 同源）**按单个迭代**算，而服务端
 *   **一次工具调用 = 一个迭代** ⇒ 每组只有 1 枚 pill ⇒ 阈值永不触发 ⇒ 无限堆叠。
 *   ⇒ `core/pillmerge.mergeToolOnlyIterations` 先把连续纯工具迭代并成一个渲染块，
 *     再在该块上折叠（本次修复的就是这一层）。
 *
 * ⛔ mutation 自证：
 *   · 把 `mergeToolOnlyIterations` 改成恒等（不清并）⇒ 用例① 红（仍 20 块 / 不折叠）；
 *   · 去掉"正文空"判据（把带正文的迭代也并进来）⇒ 用例② / ④ 红（正文被吞、顺序错）；
 *   · 把折叠阈值改成 `>=8` ⇒ 用例③ 红（8 枚不该折叠，web 判据是 `> MAX`）。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;

import { HistoryIteration } from '../../entry/src/main/ets/core/types';
import { ToolProgress } from '../../entry/src/main/ets/core/types';
import { isToolOnlyIteration, mergeToolOnlyIterations, PillIterationLike } from '../../entry/src/main/ets/core/pillmerge';
import { foldPills, PILL_INLINE_HEAD, PILL_INLINE_MAX } from '../../entry/src/main/ets/core/streammerge';

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

function tool(i: number): ToolProgress {
  return { name: 'Shell', iteration: i, status: 'done' } as ToolProgress;
}
/** 一次 Shell 调用 = 一个迭代（服务端真实形状）。 */
function shellIter(i: number): HistoryIteration {
  return { iteration: i, content: '', reasoning: '', tools: [tool(i)] } as HistoryIteration;
}
function textIter(i: number, text: string): HistoryIteration {
  return { iteration: i, content: text, reasoning: '', tools: [] } as HistoryIteration;
}

// ── ① 20 个"每迭代 1 个工具" ⇒ 并成 1 块，并触发 `+N` ──────────────────────────
{
  const iters: HistoryIteration[] = [];
  for (let i = 1; i <= 20; i++) { iters.push(shellIter(i)); }
  const merged: PillIterationLike[] = mergeToolOnlyIterations(iters);
  eq('① 20 个纯工具迭代并成 1 个渲染块', merged.length, 1);
  eq('① 合并块里的工具数 = 20', (merged[0].tools as ToolProgress[]).length, 20);
  const slice = foldPills(merged[0].tools as ToolProgress[]);
  // ⛔ 2026-10-29（用户 P0「新工具完成后立刻从历史消失」）：折叠直出 = 前 7（稳定不变）
  eq('① 折叠后直出 = 前 7 枚（稳定，新工具只增加 +N）', slice.shown.length, PILL_INLINE_HEAD);
  // 20 枚 ⇒ 直出前 7，收起 13 枚
  eq('① `+N` = 13', slice.hideCount, 13);
  ok('① 顺序保持（先出现的在前）', (merged[0].tools as ToolProgress[])[0].iteration === 1
    && (merged[0].tools as ToolProgress[])[13].iteration === 14);
}

// ── ② 正文迭代必须隔断合并（正文与 pill 的顺序不能被吞）─────────────────────────
{
  const iters: HistoryIteration[] = [
    shellIter(1), shellIter(2), shellIter(3),
    textIter(4, '我来看看'),
    shellIter(5), shellIter(6),
  ];
  const merged: PillIterationLike[] = mergeToolOnlyIterations(iters);
  eq('② 三段：纯工具块 / 正文块 / 纯工具块', merged.length, 3);
  eq('② 第一段 3 枚', (merged[0].tools as ToolProgress[]).length, 3);
  eq('② 中间是正文块（正文保留）', merged[1].content, '我来看看');
  eq('② 第三段 2 枚', (merged[2].tools as ToolProgress[]).length, 2);
}

// ── ③ 折叠阈值仍是 `> 8`（8 枚不折叠，web 同判据）──────────────────────────────
{
  const eight: ToolProgress[] = [];
  for (let i = 1; i <= PILL_INLINE_MAX; i++) { eight.push(tool(i)); }
  eq('③ 8 枚不折叠', foldPills(eight).hideCount, 0);
  eight.push(tool(9));
  // 9 枚 ⇒ 直出前 7，收起 2 枚
  eq('③ 9 枚折叠成 7 + 2', foldPills(eight).hideCount, 2);
}

// ── ④ 纯工具判据：带正文/推理的一律不合并 ─────────────────────────────────────
{
  ok('④ 带 content 的迭代不算纯工具', isToolOnlyIteration(
    { iteration: 1, content: 'x', tools: [tool(1)] } as HistoryIteration) === false);
  ok('④ 带 reasoning 的迭代不算纯工具', isToolOnlyIteration(
    { iteration: 1, reasoning: '想', tools: [tool(1)] } as HistoryIteration) === false);
  ok('④ 只有空白正文的算纯工具', isToolOnlyIteration(
    { iteration: 1, content: '  ', tools: [tool(1)] } as HistoryIteration) === true);
  ok('④ 没有工具的不算', isToolOnlyIteration({ iteration: 1, content: '' } as HistoryIteration) === false);
}

// ── ⑤ 溢出浮层必须与徽标**同源**（2026-10-25 用户：点开 `+N` 是空白）─────────────
{
  const src: string = require('fs').readFileSync(
    require('path').join(process.cwd(), 'entry/src/main/ets/components/IterBlocksView.ets'), 'utf8');
  // 徽标画在合并块上 ⇒ 浮层取数也必须走 mergedBlocks()，否则查回单工具迭代 ⇒ hidden 为空 ⇒ 空白
  // ⚡ 2026-11-17：`overTools()` 现在只返回**点击那一刻捕获**的列表（`overList`），
  //   按块/组取数的入口搬到 `captureOverList()`（意图不变：必须走 `mergedBlocks()`，
  //   因为 `+N` 画在合并块上；⛔ 不得读 `iters.blocks` —— 那是"点开空白"的老根因）。
  const cap: RegExpMatchArray | null = src.match(/private captureOverList\(\): ToolProgress\[\] \{([\s\S]{0,800})/);
  ok('⑤ 找得到 captureOverList()', cap !== null);
  const body: string = cap !== null ? cap[1] : '';
  ok('⑤ 取数读 mergedBlocks()（与徽标同源）', body.indexOf('this.mergedBlocks()') >= 0);
  ok('⑤ 取数不得再读 iters.blocks（回归闸）', body.indexOf('this.iters.blocks') < 0);
  // ⚡ 2026-11-17：浮层成员仍是点击那一刻捕获的那一批（`overList`），对象按身份取最新的
  //   （`resolveByKeys`）⇒ 详情回填后立刻可见、而成员/条数不随流式漂移。
  // 2026-11-18: +N 改内联列表 => 取数 = 该组当前 hidden（同一 pillView）。
  ok('⑤b 内联列表取数 = 该组 hidden', src.indexOf('return pillView(group).hidden;') >= 0);
}

// ── ★P0 用户 2026-10-28：「不行，还是没合并，还是 1+2」────────────────────────
// 形态：迭代 A = 思考 + 1 枚工具；迭代 B = 纯工具 2 枚（无正文/思考）。
// web 规则（`TurnBody.mergeToolRuns`）：**头部可带 reasoning/content**，只有后续成员才要求
// "只有工具" ⇒ A 与 B 必须合成**一块**（3 枚同 Flex ⇒ 排成 2+1，而不是 1+2）。
// ⛔ 旧实现只合并"纯工具迭代" ⇒ A、B 各自成块 ⇒ 首行只剩一枚（本用例在旧实现下**红**）。
{
  const head: HistoryIteration = {
    iteration: 7, content: '', reasoning: '思考 46 字', tools: [tool(7)],
  } as HistoryIteration;
  const follower: HistoryIteration = {
    iteration: 8, content: '', reasoning: '', tools: [tool(8), tool(8)],
  } as HistoryIteration;
  const merged = mergeToolOnlyIterations([head, follower]);
  eq('★ 带思考的头部与后续纯工具迭代合成**一块**', merged.length, 1);
  eq('★ 合并后工具数 = 3（同一 Flex）', merged[0].tools === undefined ? 0 : merged[0].tools.length, 3);
  eq('★ 保留**头部**迭代号（web 同构：高度缓存 / key 稳定）', merged[0].iteration, 7);
  eq('★ 头部的思考内容不丢', merged[0].reasoning, '思考 46 字');
  // 反例：后续成员**带正文/思考** ⇒ 必须独立成块（文本不合并、不丢）
  const withText: HistoryIteration = {
    iteration: 9, content: '正文', reasoning: '', tools: [tool(9)],
  } as HistoryIteration;
  eq('★ 后续成员带正文 ⇒ 不吸收', mergeToolOnlyIterations([head, withText]).length, 2);
}

// ── ★★ 运行中的工具**独占一行**（用户 2026-10-28：「运行中的工具不会单独一行了」）──────
// 语义：`running/pending/…` 是"当前焦点" ⇒ 它所在迭代不得与任何相邻迭代合并（不挤进网格）。
{
  const runningHead: HistoryIteration = {
    iteration: 11, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 11, status: 'running' } as ToolProgress],
  } as HistoryIteration;
  const follower: HistoryIteration = shellIter(12);
  // ⛔ 2026-10-29 改判：**分组必须与状态无关**（否则 running→done 时分组变化 ⇒ 折叠阈值
  //   跨过 ⇒ 末尾 pill 被塞进 `+N` ⇒ "完成瞬间消失"）。
  eq('★ 头部含运行中工具也照常吸收（分组与状态无关）',
    mergeToolOnlyIterations([runningHead, follower]).length, 1);

  const memberRunning: HistoryIteration = {
    iteration: 13, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 13, status: 'running' } as ToolProgress],
  } as HistoryIteration;
  eq('★ 后续成员含运行中工具也照常吸收（分组稳定）',
    mergeToolOnlyIterations([shellIter(14), memberRunning]).length, 1);
  // 关键不变量：同一批迭代，无论工具状态怎么变，**分组结果必须一致**（否则会跳变/消失）
  const asDone: HistoryIteration = {
    iteration: 13, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 13, status: 'done' } as ToolProgress],
  } as HistoryIteration;
  eq('★ 状态变更不改变分组（running 与 done 结果相同）',
    mergeToolOnlyIterations([shellIter(14), memberRunning]).length,
    mergeToolOnlyIterations([shellIter(14), asDone]).length);
}

// ── ★★P0 没有 `call_id` 的同名工具**绝不能被当成"相邻重复"吞掉**（用户 2026-10-28）────────
// 现场：web 该块有 6 枚 pill（FileReplace/python3/2×ssh/task_wait/…），原生只剩 2 枚。
// 根因：`sameToolIdentity` 旧实现允许"名字+迭代号+label+状态"兜底，而合并块里的工具常常
//   **没有 `iteration`**（全是 0）且 label 都以 `Shell: ssh -o …` 开头 ⇒ 判成同一调用 ⇒
//   整批吸收 ⇒ "丢完了"。判据必须**只认 call_id 相等**。
{
  const a: HistoryIteration = {
    iteration: 20, content: '', reasoning: '',
    tools: [{ name: 'Shell', status: 'done', label: 'Shell: ssh -o …' } as ToolProgress],
  } as HistoryIteration;
  const b: HistoryIteration = {
    iteration: 21, content: '', reasoning: '',
    tools: [{ name: 'Shell', status: 'done', label: 'Shell: ssh -o …' } as ToolProgress],
  } as HistoryIteration;
  const merged = mergeToolOnlyIterations([a, b]);
  eq('★ 无 call_id 的同名工具全部保留（6 枚不许变 2 枚）', merged.length === 1 ? merged[0].tools!.length : 2, 2);

  // 有相同 call_id（服务端残留副本）仍要吸收
  const x: HistoryIteration = {
    iteration: 22, content: '', reasoning: '',
    tools: [{ name: 'Shell', status: 'done', call_id: 'c1', label: 'Shell: a' } as ToolProgress],
  } as HistoryIteration;
  const y: HistoryIteration = {
    iteration: 22, content: '', reasoning: '',
    tools: [{ name: 'Shell', status: 'done', call_id: 'c1', label: 'Shell: a' } as ToolProgress],
  } as HistoryIteration;
  const m2 = mergeToolOnlyIterations([x, y]);
  eq('★ 同 call_id 的残留副本仍被吸收', m2.length === 1 ? m2[0].tools!.length : 2, 1);
}

// ── ★★P0 连续纯工具迭代：**服务端 call_id 会跨迭代复用**，不得互相吸收 ─────────────
// 用户 2026-10-29：「连续的纯工具迭代，新的迭代如果也是纯工具，它执行完之后会直接消失」。
// 机理：`sameToolIdentity` 只比 `call_id`，而服务端每迭代都从 `call_0` 重新编号
//   ⇒ 第二个迭代的工具被当成"第一个的残留副本"吸收 ⇒ 完成瞬间 pill 消失。
// 不变量：**同一次调用 = 同迭代 + 同 call_id**（残留副本保留原始迭代号，仍能被吸收）。
{
  const i1: HistoryIteration = {
    iteration: 30, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 30, status: 'done', call_id: 'call_0' } as ToolProgress],
  } as HistoryIteration;
  const i2: HistoryIteration = {
    iteration: 31, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 31, status: 'done', call_id: 'call_0' } as ToolProgress],
  } as HistoryIteration;
  const merged = mergeToolOnlyIterations([i1, i2]);
  eq('★ 跨迭代同 call_id 的两枚工具都必须保留', merged.length === 1 ? merged[0].tools!.length : 2, 2);

  // 同迭代 + 同 call_id = 残留副本 ⇒ 吸收
  const dupA: HistoryIteration = {
    iteration: 32, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 32, status: 'done', call_id: 'call_0' } as ToolProgress],
  } as HistoryIteration;
  const dupB: HistoryIteration = {
    iteration: 32, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 32, status: 'done', call_id: 'call_0' } as ToolProgress],
  } as HistoryIteration;
  const m2 = mergeToolOnlyIterations([dupA, dupB]);
  eq('★ 同迭代同 call_id 的残留副本仍被吸收', m2.length === 1 ? m2[0].tools!.length : 2, 1);
}

// ── ★★P0 内容去重必须**删除**（用户 2026-10-29：「新的工具完成后立刻从历史消失」）──────────
// 旧实现在去重里还有一条"内容级"判据（name+args+detail 相同就算同一调用）⇒ 只要两次工具
//   写出**同样的内容**（同名同参数的 grep / 同内容的 FileReplace），后一个一提交就被吞
//   ⇒ 表现"完成瞬间消失、和之前一模一样"。
// 不变量（用户口径）：**宁留重复，不吞真调用** —— 只按「同迭代 + 同 call_id」判同一调用。
{
  const a: HistoryIteration = {
    iteration: 40, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 40, status: 'done', args: '{"cmd":"grep -A10 x"}', detail: 'out' } as ToolProgress],
  } as HistoryIteration;
  const b: HistoryIteration = {
    iteration: 41, content: '', reasoning: '',
    tools: [{ name: 'Shell', iteration: 41, status: 'done', args: '{"cmd":"grep -A10 x"}', detail: 'out' } as ToolProgress],
  } as HistoryIteration;
  const merged = mergeToolOnlyIterations([a, b]);
  eq('★ 两次"内容相同"的真实调用都必须保留',
    merged.length === 1 ? merged[0].tools!.length : 2, 2);
}

console.log(`pill_merge: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
