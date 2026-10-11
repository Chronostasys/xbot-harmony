/**
 * 迭代长按菜单「空项过滤」门禁 —— 判据 = `core/ctxmenu.iterMenuItems`（对齐 web
 * `MessageActions.tsx:298-301`「空项按设计过滤」）。
 *
 * 两条腿（双保险）：
 * ① **纯逻辑**：三 flag 组合 ⇒ 项集；**反面板**：全 false ⇒ **不产出**任何项（菜单只剩取消）。
 * ② **源码形态**（扫描器**自证** + **逐个 flag 的调用点计数** + **零扫描判红**）：
 *    `MenuSheets.ets` 必须 `ForEach(iterMenuItems(...))`（判据与渲染同源，组件内不另写过滤）；
 *    `Index.ets` 必须投递 3 个 flag。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 `pass/fail` 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

import { CtxMenuItem, ITER_REPLY, ITER_THINKING, ITER_TOOLS, iterMenuItems, toolsMenuItems } from '../../entry/src/main/ets/core/ctxmenu';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function codes(items: CtxMenuItem[]): string[] {
  return items.map((m: CtxMenuItem): string => m.code);
}

// ── ① 纯逻辑：三 flag 组合 ⇒ 项集（保序）─────────────────────────────────────────────
eq('全有 ⇒ 3 项（正文/含思考/含工具，保序）',
  codes(iterMenuItems(true, true, true)), [ITER_REPLY, ITER_THINKING, ITER_TOOLS]);
eq('全无 ⇒ **空**（反面板：菜单只剩取消）', codes(iterMenuItems(false, false, false)), []);
eq('仅正文 ⇒ 1 项', codes(iterMenuItems(true, false, false)), [ITER_REPLY]);
eq('仅思考 ⇒ 1 项（第 2 项，不串位）', codes(iterMenuItems(false, true, false)), [ITER_THINKING]);
eq('仅工具 ⇒ 1 项', codes(iterMenuItems(false, false, true)), [ITER_TOOLS]);
eq('无思考 ⇒ 跳过「含思考」但保留后两项',
  codes(iterMenuItems(true, false, true)), [ITER_REPLY, ITER_TOOLS]);
eq('无正文 ⇒ 跳过「正文」', codes(iterMenuItems(false, true, true)), [ITER_THINKING, ITER_TOOLS]);
// label 非空（渲染层直接用）
{
  const m: CtxMenuItem[] = iterMenuItems(true, false, false);
  eq('label 非空', m[0].label.length > 0, true);
  eq('label 是「正文」项', m[0].label.indexOf('正文') >= 0, true);
}

// ── ② 源码形态（扫描器自证 + 调用点计数 + 零扫描判红）─────────────────────────────────
const REPO: string = path.resolve(__dirname, '../../../..');
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
const MS: string = 'entry/src/main/ets/components/MenuSheets.ets';
const IX: string = 'entry/src/main/ets/pages/Index.ets';
const MR: string = 'entry/src/main/ets/components/MessageRow.ets';
const msSrc: string = stripComments(fs.readFileSync(path.join(REPO, MS), 'utf8'));
const ixSrc: string = stripComments(fs.readFileSync(path.join(REPO, IX), 'utf8'));
const mrSrc: string = stripComments(fs.readFileSync(path.join(REPO, MR), 'utf8'));
console.log(`  ctxmenu-scan files: ${MS}, ${IX}, ${MR}`);
const msIter: number = countOf(msSrc, 'iterMenuItems(');
const msImport: number = countOf(msSrc, "from '../core/ctxmenu'");
const msTools: number = countOf(msSrc, 'toolsMenuItems(');
const msToolNames: number = countOf(msSrc, 'toolNames');
const mrGroup: number = countOf(mrSrc, 'onOpenToolsCtx');
const mrToolCtx: number = countOf(mrSrc, 'onOpenCtx(');
const ixReply: number = countOf(ixSrc, 'canIterReply:');
const ixThinking: number = countOf(ixSrc, 'canIterThinking:');
const ixTools: number = countOf(ixSrc, 'canIterTools:');
console.log(`  ctxmenu-scan ${MS}: iterMenuItems(=${msIter} toolsMenuItems(=${msTools} import=${msImport} toolNames=${msToolNames}`);
console.log(`  ctxmenu-scan ${MR}: onOpenToolsCtx=${mrGroup} onOpenCtx(=${mrToolCtx}`);
console.log(`  ctxmenu-scan ${IX}: canIterReply:=${ixReply} canIterThinking:=${ixThinking} canIterTools:=${ixTools}`);
ok(`MenuSheets 真 import core/ctxmenu（${msImport} ≥ 1）`, msImport >= 1);
ok(`MenuSheets 用 iterMenuItems( 渲染（判据与渲染同源，${msIter} ≥ 1）`, msIter >= 1);
ok(`MenuSheets 用 toolsMenuItems( 渲染工具组菜单（${msTools} ≥ 1）`, msTools >= 1);
ok(`MenuSheets 有工具组项集入参 toolNames（${msToolNames} ≥ 1）`, msToolNames >= 1);
ok(`MessageRow 有组级回调 onOpenToolsCtx（${mrGroup} ≥ 1）`, mrGroup >= 1);
ok(`MessageRow 保留单枚 onOpenCtx（内层优先，${mrToolCtx} ≥ 2：声明 + 调用）`, mrToolCtx >= 2);
ok(`Index 投递 canIterReply（${ixReply} ≥ 1）`, ixReply >= 1);
ok(`Index 投递 canIterThinking（${ixThinking} ≥ 1）`, ixThinking >= 1);
ok(`Index 投递 canIterTools（${ixTools} ≥ 1）`, ixTools >= 1);
ok('零扫描判红：过滤接线调用点合计 > 0',
  msIter + msImport + msTools + msToolNames + mrGroup + mrToolCtx + ixReply + ixThinking + ixTools > 0);

// ── ①b 纯逻辑：**工具（组）**菜单项集（web `MessageActions.tsx:302-312`）──────────────────
eq('tools 全有 ⇒ 逐枚(2) + 组级(1)',
  codes(toolsMenuItems(['Shell', 'Read'], [true, true], true)),
  ['copy-tool:0', 'copy-tool:1', 'copy-all-tools']);
eq('tools 全空 ⇒ **空**（反面板）', codes(toolsMenuItems(['Shell', 'Read'], [false, false], false)), []);
eq('tools 仅首枚有文本 ⇒ 1 项（组级无）',
  codes(toolsMenuItems(['Shell', 'Read'], [true, false], false)), ['copy-tool:0']);
eq('tools 无逐枚但有组级 ⇒ 仅组级',
  codes(toolsMenuItems([], [], true)), ['copy-all-tools']);
eq('tools hasText 缺位 ⇒ 按 false（不越界）', codes(toolsMenuItems(['A', 'B'], [true], false)), ['copy-tool:0']);
{
  const m: CtxMenuItem[] = toolsMenuItems(['Shell'], [true], true);
  eq('tools 逐枚 label 含工具名', m[0].label.indexOf('Shell') >= 0, true);
  eq('tools 组级 label 非空', m[1].label.length > 0, true);
}

console.log(`  ctxmenu: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
