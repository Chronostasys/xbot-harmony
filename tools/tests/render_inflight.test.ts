/**
 * `core/render.ets` 的 `inFlightBlock` —— live 工具列表的**两步**（WEB-PARITY §12-B，P0）。
 *
 * web 权威 `LiveIteration.tsx:157-179`：
 *   ① `dedupTools([...streaming, ...active, ...filteredCompleted])` —— 按 toolKey 去重；
 *   ② `completedIterToolKeys` 过滤 —— **剔掉已提交迭代里**的同名同标签工具。
 * 原生此前两步都缺 ⇒ 真机「同一工具两行」（陈旧 active/streaming 与刚提交的迭代各一枚 pill）。
 *
 * ⛔ mutation 自证（改坏 ⇒ 真红）：
 *   · 去掉 `mergeTools`（退回 `tools.push` 裸拼）⇒ 「同一 call_id 只一行」红；
 *   · 去掉 `completedKeys` 过滤               ⇒ 「已提交的同键工具被滤掉」红。
 */
declare const process: { exit: (c: number) => void };

import { inFlightBlock, isToolRendered, liveIterations } from '../../entry/src/main/ets/core/render';
import { historyProgressToLive } from '../../entry/src/main/ets/core/agent_normalize';
import type { HistProgress } from '../../entry/src/main/ets/core/progress_types';
import type { ProgressSnapshot, WebIteration } from '../../entry/src/main/ets/core/chattypes';
import { HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';
import { LiveRowView } from '../../entry/src/main/ets/core/derive';
import { WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 造一枚**线格式**工具（只填判据用得到的字段；注意线格式是 `callID`，原生才是 `call_id`）。 */
function tw(name: string, status: string, callId: string): WebToolProgress {
  return {
    name, label: name, status, elapsedMs: 0, summary: '', detail: '', args: '', toolHints: '',
    callID: callId,
  } as unknown as WebToolProgress;
}

/** 造一个 live 行视图（只填 inFlightBlock 读的字段）。 */
function lv(active: WebToolProgress[], streaming: WebToolProgress[], lastIter: number, completed: WebToolProgress[] = []): LiveRowView {
  return {
    kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true,
    content: '', reasoning: '', iterations: [], activeTools: active, streamingTools: streaming,
    completedTools: completed,
    genui: '', subAgents: [], todos: [], lastIter,
  } as unknown as LiveRowView;
}

/** 造一个已提交迭代（带工具）。 */
function hist(iter: number, tools: ToolProgress[]): HistoryIteration {
  return { iteration: iter, content: '', reasoning: '', tools, tools_folded: false };
}

// ── ① 去重：同一 call_id 出现在 active + streaming ⇒ 只留一行 ──────────────────
{
  const r: LiveRowView = lv([tw('run_shell', 'running', 'c1')], [tw('run_shell', 'running', 'c1')], 1);
  const block: HistoryIteration | null = inFlightBlock(r, []);
  ok('★① inFlightBlock 有产物', block !== null);
  if (block !== null) {
    const bt: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    eq('★① 同一 call_id（active+streaming）**只一行**（web dedupTools）', bt.length, 1);
    eq('★① 保留的是该键', bt.length > 0 ? bt[0].call_id : '', 'c1');
  }
}

// ── ② 同号择一（**绝不合并**）：提交块带工具 ⇒ 丢弃在飞块；提交块是空壳 ⇒ 用在飞块替换 ──
{
  const done: HistoryIteration = hist(2, [
    { name: 'Shell', label: 'Shell', status: 'done', call_id: 'c1' } as unknown as ToolProgress,
  ]);
  const r: LiveRowView = lv([{ name: 'Shell', label: 'Shell', status: 'done', callID: 'c1', iteration: 2 } as unknown as WebToolProgress], [], 2);
  const out: HistoryIteration[] = liveIterations(r);
  const blk = out.filter((b: HistoryIteration) => b.iteration === 2)[0];
  ok('★② 同号块只有一份（绝不 append 第二个）', out.filter((b: HistoryIteration) => b.iteration === 2).length === 1);
  eq('★② 提交块带工具 ⇒ 用它（工具数 = 1，不重复）', blk.tools !== undefined ? blk.tools.length : -1, 1);
  // 空壳情形：提交块没有工具 ⇒ 用在飞块替换（1 枚，不重复）
  const shell: HistoryIteration = hist(2, []);
  const out2: HistoryIteration[] = liveIterations(r);
  const blk2 = out2.filter((b: HistoryIteration) => b.iteration === 2)[0];
  eq('★② 空壳提交块 ⇒ 用在飞块（工具数 = 1）', blk2.tools !== undefined ? blk2.tools.length : -1, 1);
}

// ── ③ 边界：completed 为空时，不同键全部保留 ─────────────────────────────────
{
  const r: LiveRowView = lv([tw('a', 'running', 'c1'), tw('b', 'done', 'c2')], [], 1);
  const block: HistoryIteration | null = inFlightBlock(r, []);
  if (block !== null) {
    const bt: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    eq('★③ 不同键 ⇒ 两行都保留（不误杀）', bt.length, 2);
  } else {
    ok('★③ 不该为 null', false);
  }
}

// ── ④ 边界：无工具 + 无正文 ⇒ null（空壳不渲染）─────────────────────────────
{
  const r: LiveRowView = lv([], [], 1);
  eq('★④ 空 live ⇒ null（不产空壳）', inFlightBlock(r, []), null);
}

// ── ⑤ 迭代过滤（web `toolDeriv`：`t.iteration > maxCompletedIter`）──────────────
// ⛔ 用户 2026-10-11 亲报：「所有 tool 都渲染为排队 / **executing 的 tool 被渲染成排队**」。
//    根因：服务端整批派发时把 `active_tools` **全部先标 `pending`**
//    （`agent/engine_run_tools.go:49-64`，到 goroutine 启动才翻 `running`）；
//    这些条目会残留进后续帧 ⇒ 缺迭代过滤时，**过去迭代的 pending 工具永久渲染在最新在飞块**。
//    web 用 `t.iteration > maxCompletedIter` 滤掉它们；服务端亦点名此步必须由前端承担
//    （`agent/engine_wire.go:2436-2445`）。
{
  const done: HistoryIteration = hist(2, [
    { name: 'run_shell', label: 'run_shell', status: 'done', call_id: 'old' } as unknown as ToolProgress,
  ]);
  // 陈旧项：属**已提交**的迭代 2，且状态是服务端整批先标的 `pending`。
  const stale: WebToolProgress = tw('Write', 'pending', 'stale-1');
  (stale as unknown as { iteration?: number }).iteration = 1;   // 更老迭代的残留 pending
  // 当前项：属**未提交**的迭代 3，正在执行。
  const cur: WebToolProgress = tw('Read', 'running', 'cur-1');
  // 本轮 P0 的形态：**已完成**（done）且号 == 当前在飞迭代号 —— 必须保留（曾经被滤掉）。
  const cur2: WebToolProgress = tw('Shell', 'done', 'cur-2');
  cur2.iteration = 2;
  (cur as unknown as { iteration?: number }).iteration = 3;
  const r: LiveRowView = lv([stale, cur], [], 3);
  const block: HistoryIteration | null = inFlightBlock(r, [done]);
  ok('★⑤ 有产物（当前工具还在）', block !== null);
  if (block !== null) {
    const bt: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    const ids: string[] = bt.map((t: ToolProgress) => t.call_id === undefined ? '' : t.call_id);
    eq('★⑤ 陈旧 pending（迭代 2 < maxCompleted 2）**被滤掉**', ids.indexOf('stale-1') < 0, true);
    eq('★⑤ 当前 executing（迭代 3）保留 —— 不会被渲染成「排队」', ids.indexOf('cur-1') >= 0, true);
    eq('★⑤ 总数 = 1（不是「所有 tool 都排队」）', bt.length, 1);
  }
  // 纯函数面：`isToolRendered` —— **纯整数判据**：迭代号 ≤ 已提交块最大号 ⇒ 已在块里画过。
  // ⛔ 零字符串比较（用户硬约束）；⛔ 提交块最权威（用户三连定性）。
  const blk2: HistoryIteration = hist(2, [
    { name: 'Shell', label: 'Shell', status: 'done', call_id: 'c2' } as unknown as ToolProgress,
  ]);
  const blk3: HistoryIteration = hist(3, [
    { name: 'Shell', label: 'Shell', status: 'done', call_id: 'c3' } as unknown as ToolProgress,
  ]);
  const t2: WebToolProgress = tw('Shell', 'done', 'c2');
  (t2 as unknown as { iteration?: number }).iteration = 2;
  const t4: WebToolProgress = tw('Shell', 'running', 'c4');
  (t4 as unknown as { iteration?: number }).iteration = 4;
  eq('★⑤ 迭代号 == 最大提交号 ⇒ 已在块里（live 不再画）', isToolRendered(t2, [blk2]), true);
  eq('★⑤ 迭代号 < 最大提交号 ⇒ 已在块里（live 不再画）', isToolRendered(t2, [blk3]), true);
  eq('★⑤ 迭代号 > 最大提交号（真正在飞）⇒ live 必须画', isToolRendered(t4, [blk3]), false);
  eq('★⑤ 未盖号 ⇒ 交给 live', isToolRendered(tw('Shell', 'done', 'x'), [blk3]), false);
}
