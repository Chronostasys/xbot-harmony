/**
 * pill_over_resolve.test.ts —— `+N` 浮层的**成员稳定 + 数据保鲜**（用户 2026-11-17：
 * 「有时候 tool 那个 +N 列表第一次点开看不到详细参数和输出，再关闭打开一次才有」）。
 *
 * 现场（两层原因）：
 *   ① 打开 `+N` 时列表里拿到的是**轻字段**工具对象（`args/detail` 为空），详情要等
 *      `/api/iteration_detail` 回来才补上；若浮层把**当时那批对象**冻住（捕获快照），
 *      回调到了也渲染不到 ⇒ 必须**关闭再打开**重新捕获才看得到（正是用户描述）。
 *   ② 反过来，如果浮层**实时重算**成员，则流式期间新增工具会挤进/挤出列表 ⇒ 徽标 N 与
 *      列表条数对不上（2026-11-17 上一条「N 多 1 个」）。
 *
 * 正解（两者同时满足）：**捕获"身份集合"而不是对象**——
 *   · 成员/顺序/条数 = 点击那一刻的那批工具（`keys` 派生自捕获对象，永不随流式变化）；
 *   · 每帧用这批身份去**当前**工具表里取最新对象（详情到了立刻显示，无需重开）。
 *
 * ⛔ mutation 自证：把 `resolveByKeys` 改成"直接返回 captured" ⇒ ② 红（详情永远不更新）；
 *   改成"直接返回 current" ⇒ ① 红（成员随流式漂移）。
 */
export {};

declare const process: { exit: (c: number) => void };

import { pillIdentityKey, resolveByKeys } from '../../entry/src/main/ets/core/streammerge';
import type { ToolProgress } from '../../entry/src/main/ets/core/types';

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

function t(name: string, iter: number, call: string, args?: string, detail?: string): ToolProgress {
  const out: ToolProgress = { name, iteration: iter, call_id: call, status: 'done' } as ToolProgress;
  if (args !== undefined) out.args = args;
  if (detail !== undefined) out.detail = detail;
  return out;
}

function keys(list: ToolProgress[]): string[] {
  return list.map((x: ToolProgress) => pillIdentityKey(x));
}

// ── ① 成员稳定：当前表新增了工具 ⇒ 捕获的那一批不得被挤进/挤出 ─────────────────
{
  const captured: ToolProgress[] = [t('A', 1, 'call_0'), t('B', 1, 'call_1'), t('C', 2, 'call_0')];
  const current: ToolProgress[] = [
    t('NEW', 3, 'call_0'), t('A', 1, 'call_0'), t('B', 1, 'call_1'), t('C', 2, 'call_0'),
  ];
  const out = resolveByKeys(current, captured);
  eq('① 条数不变', out.length, 3);
  eq('①b 身份与顺序不变', keys(out), keys(captured));
}

// ── ② 数据保鲜：详情回填后必须用**新对象**（无需关闭重开）──────────────────────
{
  const captured: ToolProgress[] = [t('Shell', 5, 'call_0')];                 // 轻字段
  const fresh: ToolProgress[] = [t('Shell', 5, 'call_0', '{"cmd":"ls"}', 'out')];
  const out = resolveByKeys(fresh, captured);
  eq('② 取到新对象（有参数/输出）', [out[0].args, out[0].detail], ['{"cmd":"ls"}', 'out']);
}

// ── ③ 找不到同身份 ⇒ 退回捕获对象（不得丢行）────────────────────────────────
{
  const captured: ToolProgress[] = [t('Gone', 9, 'call_x')];
  const out = resolveByKeys([t('Other', 1, 'call_0')], captured);
  eq('③ 未命中时保留捕获那一份', [out.length, out[0].name], [1, 'Gone']);
}

// ── ④ 无 call_id 的兜底身份也稳定（同迭代 + 名字 + label）─────────────────────
{
  const a: ToolProgress = { name: 'Shell', iteration: 1, status: 'done' } as ToolProgress;
  const b: ToolProgress = { name: 'Shell', iteration: 2, status: 'done' } as ToolProgress;
  ok('④ 不同迭代 ⇒ 不同身份', pillIdentityKey(a) !== pillIdentityKey(b));
  const out = resolveByKeys([b, a], [a]);
  eq('④b 仍能命中同名同迭代的那一枚', out.length, 1);
}

// ── ⑤ 同一身份在当前表出现两份（残留副本）⇒ 取**更完整**的那份 ────────────────
{
  const captured: ToolProgress[] = [t('Shell', 1, 'call_0')];
  const light: ToolProgress = t('Shell', 1, 'call_0');
  const rich: ToolProgress = t('Shell', 1, 'call_0', 'args', 'detail');
  const out = resolveByKeys([light, rich], captured);
  eq('⑤ 取信息更全的那一份', [out[0].args, out[0].detail], ['args', 'detail']);
}

console.log(`pill_over_resolve: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
