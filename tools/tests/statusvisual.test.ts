/**
 * 「子代理 / 待办」状态→视觉语义的**唯一真源**契约测试（`core/statusvisual.ets`）。
 *
 * 病根（`docs/WEB-ALIGNMENT.md §16` #5「同一信息两处判据」）：改造前
 *   · `components/SubAgentTree.ets` 把 `kind` 判了**三段独立 if 链**（竖条色 / 图标 / 图标色）；
 *   · `components/TodoPanel.ets` 把 `kind` 判了**五处**（图标色 / 图标 / 字色 / 字重 / 删除线）。
 * 本测试钉死收敛结果，三条判别力：
 *   ① 同源：同一 kind 的视觉语义由 `subagentVisual`/`todoVisual` **唯一**给出（纯、确定）；
 *   ② 全集覆盖：`SUB_*` / `TODO_*` 每个档都产出**合法**语义（marker/role/emphasis 均在已知集合内）；
 *   ③ 组件确实在消费：读组件源码断言"旧 if 链已消失 + 已 import 唯一真源"。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { paletteOf, Palette } from '../../entry/src/main/ets/core/theme';
import { ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS } from '../../entry/src/main/ets/core/toolstatus';
import {
  ALL_EMPHASIS, ALL_MARKS, ALL_ROLES, EMPHASIS_MEDIUM, EMPHASIS_NORMAL,
  MARK_BULB, MARK_CIRCLE, MARK_CIRCLE_CHECK, MARK_CIRCLE_DASHED, MARK_CHECK, MARK_CROSS,
  ROLE_PRIMARY, ROLE_SECONDARY, StatusVisual, roleColorOf, subagentVisual, todoVisual,
} from '../../entry/src/main/ets/core/statusvisual';
import { SUB_DONE, SUB_ERROR, SUB_OTHER, SUB_RUNNING } from '../../entry/src/main/ets/core/subagent';
import { TODO_DONE, TODO_DOING, TODO_PENDING } from '../../entry/src/main/ets/core/todos';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const p: Palette = paletteOf('dark');

// ════════════════════════════════════════════════════════════════════════════
// ① 子代理：状态档 ⇒ 视觉语义（逐档钉值；对齐 web SubAgentProgressTree.tsx）
// ════════════════════════════════════════════════════════════════════════════
{
  const run: StatusVisual = subagentVisual(SUB_RUNNING);
  eq('running marker = bulb', run.marker, MARK_BULB);
  eq('running 竖条角色 = accent', run.toneRole, ROLE_ACCENT);
  eq('running 图标角色 = accent', run.iconRole, ROLE_ACCENT);
  eq('running 标签角色 = accent', run.labelRole, ROLE_ACCENT);
  eq('running 竖条不透明 = 1', run.markerAlpha, 1);

  const done: StatusVisual = subagentVisual(SUB_DONE);
  eq('done marker = check', done.marker, MARK_CHECK);
  eq('done 竖条 = accent（@30%）', done.toneRole, ROLE_ACCENT);
  eq('done 竖条不透明 = 0.3（web accent 30%）', done.markerAlpha, 0.3);
  eq('done 图标 = muted（成功要安静）', done.iconRole, ROLE_MUTED);
  eq('done 标签 = secondary', done.labelRole, ROLE_SECONDARY);

  const err: StatusVisual = subagentVisual(SUB_ERROR);
  eq('error marker = cross', err.marker, MARK_CROSS);
  eq('error 竖条 = danger', err.toneRole, ROLE_DANGER);
  eq('error 图标 = danger', err.iconRole, ROLE_DANGER);
  eq('error 标签 = secondary', err.labelRole, ROLE_SECONDARY);

  const other: StatusVisual = subagentVisual(SUB_OTHER);
  eq('other marker = bulb', other.marker, MARK_BULB);
  eq('other 竖条 = accent', other.toneRole, ROLE_ACCENT);
  eq('other 图标 = muted', other.iconRole, ROLE_MUTED);
  eq('other 标签 = secondary', other.labelRole, ROLE_SECONDARY);
  // 未知/空档 ⇒ 归 other（与 core/subagent.subStatusKind 同源；不抛）
  eq('未知档 ⇒ 同 other', JSON.stringify(subagentVisual('weird')), JSON.stringify(other));
  eq('空档 ⇒ 同 other', JSON.stringify(subagentVisual('')), JSON.stringify(other));
}

// ════════════════════════════════════════════════════════════════════════════
// ② 待办：状态档 ⇒ 视觉语义（逐档钉值；对齐 web TodoPullOut.tsx）
// ════════════════════════════════════════════════════════════════════════════
{
  const done: StatusVisual = todoVisual(TODO_DONE);
  eq('done marker = circleCheck', done.marker, MARK_CIRCLE_CHECK);
  eq('done 图标 = success', done.iconRole, ROLE_SUCCESS);
  eq('done 标签 = muted', done.labelRole, ROLE_MUTED);
  eq('done 删除线 = true', done.struck, true);
  eq('done 强调 = normal', done.emphasis, EMPHASIS_NORMAL);

  const doing: StatusVisual = todoVisual(TODO_DOING);
  eq('doing marker = circleDashed', doing.marker, MARK_CIRCLE_DASHED);
  eq('doing 图标 = accent', doing.iconRole, ROLE_ACCENT);
  eq('doing 标签 = primary', doing.labelRole, ROLE_PRIMARY);
  eq('doing 强调 = medium（加粗）', doing.emphasis, EMPHASIS_MEDIUM);
  eq('doing 删除线 = false', doing.struck, false);

  const pend: StatusVisual = todoVisual(TODO_PENDING);
  eq('pending marker = circle', pend.marker, MARK_CIRCLE);
  eq('pending 图标 = muted', pend.iconRole, ROLE_MUTED);
  eq('pending 标签 = primary', pend.labelRole, ROLE_PRIMARY);
  eq('pending 删除线 = false', pend.struck, false);
  // 未知/空 ⇒ pending（与 core/todos.todoStatusKind 同源）
  eq('未知档 ⇒ 同 pending', JSON.stringify(todoVisual('weird')), JSON.stringify(pend));
  eq('空档 ⇒ 同 pending', JSON.stringify(todoVisual('')), JSON.stringify(pend));
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 同源恒等 + 角色解析（唯一真源：同一角色 ⇒ 同一色；纯函数 ⇒ 可重复）
// ════════════════════════════════════════════════════════════════════════════
{
  // 子代理 error 的"竖条"与"图标"是**同一角色** ⇒ 必然同色（改造前是两段独立 if 链，可能分叉）
  eq('error 竖条色 == 图标色（同一角色）',
    roleColorOf(subagentVisual(SUB_ERROR).toneRole, p), roleColorOf(subagentVisual(SUB_ERROR).iconRole, p));
  // 纯函数：同输入同输出（两处调用恒等）
  eq('roleColorOf 确定（同角色同色）', roleColorOf(ROLE_DANGER, p), roleColorOf(ROLE_DANGER, p));
  eq('subagentVisual 确定', JSON.stringify(subagentVisual(SUB_DONE)), JSON.stringify(subagentVisual(SUB_DONE)));
  // 角色 ⇒ 主题色（本族口径：danger = statusError，**不是** dangerText）
  eq('accent → pal.accent', roleColorOf(ROLE_ACCENT, p), p.accent);
  eq('muted → pal.textMuted', roleColorOf(ROLE_MUTED, p), p.textMuted);
  eq('success → pal.successText', roleColorOf(ROLE_SUCCESS, p), p.successText);
  eq('danger → pal.statusError（web --status-error，非 dangerText）', roleColorOf(ROLE_DANGER, p), p.statusError);
  eq('primary → pal.textPrimary', roleColorOf(ROLE_PRIMARY, p), p.textPrimary);
  eq('secondary → pal.textSecondary', roleColorOf(ROLE_SECONDARY, p), p.textSecondary);
  ok('danger ≠ dangerText（角色不混淆）', p.statusError !== p.dangerText);
  eq('未知角色 ⇒ transparent（不猜色）', roleColorOf('nope', p), p.transparent);
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 全集覆盖（无遗漏 / 无越界）
// ════════════════════════════════════════════════════════════════════════════
{
  const subKinds: string[] = [SUB_RUNNING, SUB_DONE, SUB_ERROR, SUB_OTHER];
  const todoKinds: string[] = [TODO_DONE, TODO_DOING, TODO_PENDING];
  let subOk = true, todoOk = true;
  for (let i = 0; i < subKinds.length; i++) {
    const v: StatusVisual = subagentVisual(subKinds[i]);
    if (ALL_MARKS.indexOf(v.marker) < 0) { subOk = false; }
    if (ALL_ROLES.indexOf(v.toneRole) < 0 || ALL_ROLES.indexOf(v.iconRole) < 0
      || ALL_ROLES.indexOf(v.labelRole) < 0) { subOk = false; }
    if (ALL_EMPHASIS.indexOf(v.emphasis) < 0) { subOk = false; }
  }
  for (let i = 0; i < todoKinds.length; i++) {
    const v: StatusVisual = todoVisual(todoKinds[i]);
    if (ALL_MARKS.indexOf(v.marker) < 0) { todoOk = false; }
    if (ALL_ROLES.indexOf(v.toneRole) < 0 || ALL_ROLES.indexOf(v.iconRole) < 0
      || ALL_ROLES.indexOf(v.labelRole) < 0) { todoOk = false; }
    if (ALL_EMPHASIS.indexOf(v.emphasis) < 0) { todoOk = false; }
  }
  ok('子代理全集：marker/role/emphasis 均在已知集合内', subOk);
  ok('待办全集：marker/role/emphasis 均在已知集合内', todoOk);
  // 每个角色都必须能被解析成**非透明**色（= 没有漏掉的角色分支）
  let allResolvable = true;
  for (let i = 0; i < ALL_ROLES.length; i++) {
    if (roleColorOf(ALL_ROLES[i], p) === p.transparent) { allResolvable = false; }
  }
  ok('ALL_ROLES 每个角色都有色值（无遗漏分支）', allResolvable);
  // 子代理两个"非 running"档不得把标签判成 accent（否则"在看"的语义失真）
  ok('done/error 标签 ≠ accent（领读只属于 running）',
    subagentVisual(SUB_DONE).labelRole !== ROLE_ACCENT && subagentVisual(SUB_ERROR).labelRole !== ROLE_ACCENT);
}

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 组件确实在消费（读源码：旧 if 链已消失 + 已 import 唯一真源）
// ════════════════════════════════════════════════════════════════════════════
{
  const fsMod = require('fs');
  const pathMod = require('path');
  const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
  const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
  const treeSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'SubAgentTree.ets'), 'utf-8');
  const todoSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'TodoPanel.ets'), 'utf-8');

  // SubAgentTree：消费 subagentVisual / roleColorOf
  has(treeSrc, 'subagentVisual(this.kind)', 'SubAgentTree 消费 subagentVisual（唯一真源）');
  has(treeSrc, 'roleColorOf(v.toneRole, this.pal())', 'SubAgentTree 竖条色走 roleColorOf');
  has(treeSrc, 'roleColorOf(this.vis().iconRole, this.pal())', 'SubAgentTree 图标色走 roleColorOf');
  has(treeSrc, 'roleColorOf(this.vis().labelRole, this.pal())', 'SubAgentTree 标签色走 roleColorOf');
  // ⛔ 旧写法必须消失（回退即红）
  hasNot(treeSrc, 'if (this.kind === SUB_ERROR)', 'SubAgentTree 里"裸 kind if 链"已消失');
  hasNot(treeSrc, 'BAR_DONE_ALPHA', 'SubAgentTree 的 done 透明度已移入 StatusVisual.markerAlpha');

  // TodoPanel：消费 todoVisual / roleColorOf
  has(todoSrc, 'todoVisual(this.kind)', 'TodoPanel 消费 todoVisual（唯一真源）');
  has(todoSrc, 'roleColorOf(this.vis().iconRole, this.pal())', 'TodoPanel 图标色走 roleColorOf');
  has(todoSrc, 'roleColorOf(this.vis().labelRole, this.pal())', 'TodoPanel 标签色走 roleColorOf');
  has(todoSrc, 'this.vis().emphasis === EMPHASIS_MEDIUM', 'TodoPanel 字重走 emphasis');
  has(todoSrc, 'return this.vis().struck;', 'TodoPanel 删除线走 struck');
  hasNot(todoSrc, 'this.kind === TODO_DONE', 'TodoPanel 里"裸 kind 判"已消失（字色/删除线）');
  hasNot(todoSrc, 'this.kind === TODO_DOING', 'TodoPanel 里"裸 kind 判"已消失（字重）');
}

const total = pass + fail;
console.log(`\nstatusvisual.test: ${pass} passed / ${fail} failed (${total})`);
if (fail > 0) { process.exit(1); }
process.exit(0);

export {};
