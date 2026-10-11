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

import { inFlightBlock } from '../../entry/src/main/ets/core/render';
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
function lv(active: WebToolProgress[], streaming: WebToolProgress[], lastIter: number): LiveRowView {
  return {
    kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true,
    content: '', reasoning: '', iterations: [], activeTools: active, streamingTools: streaming,
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

if (fail > 0) { console.log(`  render_inflight: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  render_inflight: ${pass} passed, 0 failed`);
process.exit(0);

export {};
