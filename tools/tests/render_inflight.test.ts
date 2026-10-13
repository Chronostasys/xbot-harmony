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

import { inFlightBlock, isCurrentIterTool } from '../../entry/src/main/ets/core/render';
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

// ── ② 滤已提交：completed 迭代里已有同键工具 ⇒ live 不再重复渲染 ────────────────
{
  const done: HistoryIteration = hist(1, [
    { name: 'run_shell', label: 'run_shell', status: 'done', call_id: 'c1' } as unknown as ToolProgress,
  ]);
  const r: LiveRowView = lv(
    [tw('run_shell', 'running', 'c1'), tw('read_file', 'running', 'c2')], [], 2);
  const block: HistoryIteration | null = inFlightBlock(r, [done]);
  ok('★② 有产物（另一个工具还在）', block !== null);
  if (block !== null) {
    const bt: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    const ids: string[] = bt.map((t: ToolProgress) => t.call_id === undefined ? '' : t.call_id);
    eq('★② 已提交的 c1 被滤掉（只剩 c2）', ids.indexOf('c1') < 0, true);
    eq('★② 未提交的 c2 保留', ids.indexOf('c2') >= 0, true);
    eq('★② 总数 = 1', bt.length, 1);
  }
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
  (stale as unknown as { iteration?: number }).iteration = 2;
  // 当前项：属**未提交**的迭代 3，正在执行。
  const cur: WebToolProgress = tw('Read', 'running', 'cur-1');
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
  // 纯函数面：`isCurrentIterTool` 的边界（无 iteration ⇒ 视为当前，与 web 的 `undefined` 分支一致）。
  eq('★⑤ isCurrentIterTool(无 iteration) == true', isCurrentIterTool(tw('X', 'pending', 'k'), 2), true);
  eq('★⑤ isCurrentIterTool(iteration <= 已提交) == false', isCurrentIterTool(stale, 2), false);
  eq('★⑤ isCurrentIterTool(iteration > 已提交) == true', isCurrentIterTool(cur, 2), true);
  // ⛔ 2026-10-12 P0（用户实拍「迭代里 tool1(排队) tool2(排队)、没有任何 executing」）：
  //    **在飞**工具即便带**陈旧**迭代号也必须保留 —— 服务端整批先标 `pending` 且可能带上一迭代的号
  //    ⇒ 旧实现把号陈旧的 `running` 滤掉、只留号为空/陈旧的 `pending` ⇒ 画面上"清一色排队"。
  const rStale: WebToolProgress = tw('R', 'running', 'r-stale-1');
  (rStale as unknown as { iteration?: number }).iteration = 1;
  eq('★⑤ 在飞 running（号陈旧 ≤ max）**仍保留**', isCurrentIterTool(rStale, 2), true);
  const gStale: WebToolProgress = tw('G', 'generating', 'g-stale-1');
  (gStale as unknown as { iteration?: number }).iteration = 1;
  eq('★⑤ 在飞 generating（号陈旧）**仍保留**', isCurrentIterTool(gStale, 2), true);
  const eStale: WebToolProgress = tw('E', 'executing', 'e-stale-1');
  (eStale as unknown as { iteration?: number }).iteration = 1;
  eq('★⑤ 在飞 executing（号陈旧）**仍保留**', isCurrentIterTool(eStale, 2), true);
  const pStale: WebToolProgress = tw('P', 'pending', 'p-stale-1');
  (pStale as unknown as { iteration?: number }).iteration = 1;
  eq('★⑤ 非在飞 pending（号陈旧）仍**被滤掉**', isCurrentIterTool(pStale, 2), false);
}

// ── ⑥ 零样本防线：工具全被滤掉 ⇒ 只靠正文，且**绝不**产出「全是排队」的假象 ──────
{
  const done: HistoryIteration = hist(5, []);
  const onlyStale: WebToolProgress = tw('Bash', 'pending', 's');
  (onlyStale as unknown as { iteration?: number }).iteration = 5;
  const r: LiveRowView = lv([onlyStale], [], 5);
  // 无正文/思考 + 工具被滤光 ⇒ null（不渲染仅含陈旧 pending 的空壳）。
  eq('★⑥ 只剩陈旧 pending ⇒ null（不产「排队」空壳）', inFlightBlock(r, [done]), null);
}

// ── ⑦ ★ 用户亲报：一个迭代内多工具，**先完成的从 live 列表消失** ──────────────────
//   「一个迭代 agent 调用两个工具 filereplace 和 shell，filereplace 完成后会从原生
//    前端消失，只能看到 shell」。
//   根因：服务端把**完成**的工具从 `active_tools` 移入 **`completed_tools`**；web
//   `toolDeriv` 的 live 列表 = `streaming + active + **completed**`（三数组），本仓只并
//   了前两个 ⇒ 完成的工具从 live 列表消失（只剩仍在 activeTools 的那个 shell）。
//   修法：`inFlightBlock` 并入 `r.completedTools`（同一 `isCurrentIterTool` 过滤 +
//   `completedIterToolKeys` 去重）。
//   mutation 自证：删掉 `completedTools` 循环 ⇒ 本组「FileReplace 不消失」红。
{
  const shell: WebToolProgress = tw('Shell', 'running', 'shell-1');
  (shell as unknown as { iteration?: number }).iteration = 4;
  const frDone: WebToolProgress = tw('FileReplace', 'done', 'fr-1');
  (frDone as unknown as { iteration?: number }).iteration = 4;
  // FileReplace 完成后**只在** completedTools（已移出 activeTools），Shell 仍在 activeTools。
  const r: LiveRowView = lv([shell], [], 4, [frDone]);
  const block: HistoryIteration | null = inFlightBlock(r, []);
  ok('★⑦ 有产物', block !== null);
  if (block !== null) {
    const bt: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    const ids: string[] = bt.map((t: ToolProgress) => t.call_id === undefined ? '' : t.call_id);
    eq('★⑦ 已完成的 FileReplace（在 completedTools）**不消失**', ids.indexOf('fr-1') >= 0, true);
    eq('★⑦ 仍在跑的 Shell 保留', ids.indexOf('shell-1') >= 0, true);
    eq('★⑦ 两枚工具都在（用户原症状：只剩 shell）', bt.length, 2);
  }
  // 已提交迭代里的同键 completed 工具 ⇒ 仍被 completedIterToolKeys 滤掉（不进 live 列表，不双渲染）。
  const doneIter: HistoryIteration = hist(4, [
    { name: 'FileReplace', label: 'FileReplace', status: 'done', call_id: 'fr-1' } as unknown as ToolProgress,
  ]);
  const block2: HistoryIteration | null = inFlightBlock(r, [doneIter]);
  if (block2 !== null) {
    const bt2: ToolProgress[] = block2.tools === undefined ? [] : block2.tools;
    const ids2: string[] = bt2.map((t: ToolProgress) => t.call_id === undefined ? '' : t.call_id);
    eq('★⑦ 已提交进迭代的 FileReplace 仍被滤（不双渲染）', ids2.indexOf('fr-1') < 0, true);
  }
}

if (fail > 0) { console.log(`  render_inflight: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  render_inflight: ${pass} passed, 0 failed`);
process.exit(0);

export {};
