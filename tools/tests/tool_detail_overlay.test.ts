/**
 * tool_detail_overlay.test.ts —— 「`+N` 第一次点开看不到参数/输出，关闭再打开才有」
 * （用户 2026-11-17）的**机制判据**。
 *
 * 根因：`+N` 浮层是 `bindPopup` 的 builder —— **内容在打开那一刻构建**；`/api/iteration_detail`
 *   回来、模型换了新的工具对象，**浮层子树不会重建** ⇒ 只能关闭重开（重新构建一次）。
 *
 * 修法：详情落到模型就按**身份键**写进 `core/toollayer` 的覆盖层；浮层组件订阅
 *   `AppStorage('toolDetailGen')` 自渲染，并用 `withToolDetail` 把覆盖层合到手上那份（旧的）工具上。
 *
 * ⛔ mutation 自证：让 `withToolDetail` 直接返回入参 ⇒ ② 红（详情永远补不上）；
 *   让覆盖层覆盖已有非空字段 ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { detailKey, rememberToolDetail, ToolDetailLike, withToolDetail } from '../../entry/src/main/ets/core/toollayer';

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

function tp(iter: number, call: string, extra?: Partial<ToolDetailLike>): ToolDetailLike {
  const out: ToolDetailLike = { name: 'Shell', iteration: iter, call_id: call, status: 'done' };
  if (extra !== undefined) {
    if (extra.args !== undefined) out.args = extra.args;
    if (extra.detail !== undefined) out.detail = extra.detail;
    if (extra.summary !== undefined) out.summary = extra.summary;
  }
  return out;
}

// ── ① 身份键：同迭代 + 同 call_id 才算同一枚；跨迭代/换 call 必须区分 ───────────
{
  ok('① 同迭代同 call ⇒ 同键', detailKey(tp(3, 'call_0')) === detailKey(tp(3, 'call_0')));
  ok('①b 跨迭代 ⇒ 不同键', detailKey(tp(3, 'call_0')) !== detailKey(tp(4, 'call_0')));
  ok('①c 换 call ⇒ 不同键', detailKey(tp(3, 'call_0')) !== detailKey(tp(3, 'call_1')));
}

// ── ② 详情回填：旧对象（轻字段）合并后能看到参数/输出 ─────────────────────────
{
  rememberToolDetail(tp(5, 'call_7', { args: '{"cmd":"ls"}', detail: 'ok\n' }));
  const stale: ToolDetailLike = tp(5, 'call_7');            // 浮层手里那份（打开时的轻字段）
  const merged: ToolDetailLike = withToolDetail(stale);
  eq('② 参数补上', merged.args, '{"cmd":"ls"}');
  eq('②b 输出补上', merged.detail, 'ok\n');
  ok('②c 不改原对象', stale.args === undefined);
}

// ── ③ 不覆盖已有非空值（本地已有更权威的数据时不得被覆盖层盖掉）───────────────
{
  rememberToolDetail(tp(6, 'call_1', { args: 'OLD', detail: 'OLD' }));
  const local: ToolDetailLike = tp(6, 'call_1', { args: 'NEW' });
  const merged: ToolDetailLike = withToolDetail(local);
  eq('③ 已有非空 args 不被覆盖', merged.args, 'NEW');
  eq('③b 缺失的 detail 仍然补上', merged.detail, 'OLD');
}

// ── ④ 轻字段不入覆盖层（无正文 ⇒ 不产生"看似有详情"的假象）───────────────────
{
  rememberToolDetail(tp(7, 'call_2', { summary: '' }));
  const t: ToolDetailLike = tp(7, 'call_2');
  ok('④ 无覆盖 ⇒ 返回同一对象（零重建）', withToolDetail(t) === t);
}

// ── ⑤ 幂等：同一条详情记两次，结果一致 ───────────────────────────────────────
{
  const d: ToolDetailLike = tp(8, 'call_3', { args: 'A', detail: 'D' });
  rememberToolDetail(d);
  rememberToolDetail(d);
  const merged: ToolDetailLike = withToolDetail(tp(8, 'call_3'));
  eq('⑤ 幂等', [merged.args, merged.detail], ['A', 'D']);
}

console.log(`tool_detail_overlay: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
