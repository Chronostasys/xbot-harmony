/**
 * 历史工具详情判据（用户 2026-10-27 P0：「和历史工具交互看不到详情（包括参数都看不到）」）。
 *
 * 根因（本文件钉死）：`model_bridge.toHistoryIteration` 把 `tools_folded` **硬编码成 false**
 *   （模型 `Block` 不携带折叠标记），而 `Index.toggleTool` 旧判据是
 *   `it.tools_folded === true` ⇒ 历史折叠载荷（后端已省略 summary/args/detail/tool_hints）
 *   **永远不触发** `/api/iteration_detail` ⇒ 浮层空白。
 *   ⇒ 唯一可靠判据 = 「详情字段确实不在手上」（`core/toolmerge.toolNeedsDetail`），
 *      与 web `useIterationDetailGate`（按"这个迭代是不是轻字段"hydrate）语义等价。
 *
 * mutation 自证：`toolNeedsDetail` 改回「任一字段为空」或页面恢复 `tools_folded === true`
 *   门控 ⇒ 本条测试红。
 */
declare const process: { exit: (c: number) => void };
declare const __dirname: string;

import { toolNeedsDetail } from '../../entry/src/main/ets/core/toolmerge';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── §1 判据矩阵 ────────────────────────────────────────────────────────────
eq('空对象 ⇒ 缺详情（历史折叠载荷的典型形态）', toolNeedsDetail({}), true);
eq('undefined ⇒ false（没有工具不请求）', toolNeedsDetail(undefined), false);
eq('null ⇒ false', toolNeedsDetail(null as unknown as undefined), false);
eq('只有 name ⇒ 仍缺详情', toolNeedsDetail({ name: 'shell' } as unknown as { args?: string }), true);
eq('有 args ⇒ 不缺', toolNeedsDetail({ args: '{"cmd":"ls"}' }), false);
eq('有 detail ⇒ 不缺', toolNeedsDetail({ detail: 'output' }), false);
eq('只有 summary（主体仍缺）⇒ 仍要拉', toolNeedsDetail({ summary: '列目录' }), true);
eq('只有 tool_hints（主体仍缺）⇒ 仍要拉', toolNeedsDetail({ tool_hints: '```diff\n+x\n```' }), true);
eq('空串不算"有"', toolNeedsDetail({ args: '', detail: '', summary: '', tool_hints: '' }), true);
eq('null 值不算"有"（外来 JSON）',
  toolNeedsDetail({ args: null as unknown as string }), true);

// ── §2 源码接线判据（页面必须按"缺详情"拉取，且不得再用丢失的标记）──────────
declare const require: (m: string) => { readFileSync: (p: string, e: string) => string };
const fs = require('fs');
const root = __dirname + '/../../../..';
const idx: string = fs.readFileSync(root + '/entry/src/main/ets/pages/Index.ets', 'utf8');
const bridge: string = fs.readFileSync(root + '/entry/src/main/ets/core/model_bridge.ets', 'utf8');

ok('toggleTool 调用了 toolNeedsDetail 判据', idx.indexOf('!this.toolNeedsDetail(t)') >= 0);
ok('toggleTool 真的发 /api/iteration_detail（经 store 唯一入口）',
  idx.indexOf('store.fetchIterationDetail(row.turnID, itNum)') >= 0);
ok('⛔ 旧门控（tools_folded === true 才拉）已移除',
  idx.indexOf('it.tools_folded === true && (t.detail') < 0);
ok('in-flight 去重仍在（并发点同一迭代只发一次）', idx.indexOf('this.detailInFlight.has(flight)') >= 0);
// 根因留档：模型侧 Block 没有折叠标记（所以不能靠它当判据）
ok('根因仍在源码可见：toHistoryIteration 的 tools_folded 来自 Block（当前恒 false）',
  bridge.indexOf('tools_folded: false') >= 0);

console.log(`tool_detail_gate: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
