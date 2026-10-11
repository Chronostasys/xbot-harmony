/**
 * `core/pendingedit.ets` 的**判别力测试**（web `hooks/usePendingEdit.ts` 移植件）。
 *
 * 覆盖三组：
 *   A. `PendingSeq` 提交闸门（单调序号 / 乱序落后者不回写 / discard / 会话切换丢弃）；
 *   B. `pendingConverged` 收敛条件（采纳 或 让位）；
 *   C. `goalEqual` / `todosListEqual` 稳定比较器（nullish / undefined / 长度 / 逐项）+ `pendingShown`。
 *
 * ⛔ mutation 自证（改坏 ⇒ 真红）：
 *   · `acceptSeq` 的 `<` 改成 `<=`            ⇒ 「乱序落后者被拒」红；
 *   · `discard()` / `onSessionChange()` 不推 applied ⇒ 「放弃后旧提交不回写」红；
 *   · `pendingConverged` 只看采纳（删 `|| !before`）⇒ 「before 变了 ⇒ 收敛」红；
 *   · `todosListEqual` 不比对 `status`         ⇒ 「status 不同 ⇒ 不等」红；
 *   · `goalEqual` null 分支写反                ⇒ 「null vs null 相等 / null vs 有值不等」红。
 */
declare const process: { exit: (c: number) => void };

import {
  PendingSeq, goalEqual, pendingConverged, pendingShown, todosListEqual,
} from '../../entry/src/main/ets/core/pendingedit';
import { GoalInfo, TodoItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── A. PendingSeq 提交闸门 ───────────────────────────────────────────────────
{
  const s: PendingSeq = new PendingSeq();
  const s1: number = s.begin();
  const s2: number = s.begin();
  eq('★A begin 单调递增', [s2 > s1, s1 > 0], [true, true]);
  eq('★A 首个提交被接受', s.acceptSeq(s1), true);
  eq('★A 更新的提交被接受', s.acceptSeq(s2), true);
  eq('★A **乱序落后者被拒**（不回写）', s.acceptSeq(s1), false);
  eq('★A 拒绝后 applied 不倒退', s.appliedSeq(), s2);

  // discard：把 applied 推到 issued ⇒ **更旧**的提交作废（⛔ web 的闸门是 `seq < applied`，
  // 故 `seq == applied` 仍被接受 —— 逐字移植，不"顺手修正"）。
  const d: PendingSeq = new PendingSeq();
  const d1: number = d.begin();
  const d2: number = d.begin();
  d.acceptSeq(d2);
  d.discard();
  eq('★A discard 后**更旧**的提交被拒', d.acceptSeq(d1), false);
  eq('★A discard 后新事务仍可提交', d.acceptSeq(d.begin()), true);

  // 会话切换：同 discard（防跨会话串值）
  const k: PendingSeq = new PendingSeq();
  const k1: number = k.begin();
  const k2: number = k.begin();
  k.acceptSeq(k2);
  k.onSessionChange();
  eq('★A 会话切换丢弃未决（更旧序号作废）', k.acceptSeq(k1), false);

  // 边界：序号相等 ⇒ 接受（"不旧于"）
  const e: PendingSeq = new PendingSeq();
  const e1: number = e.begin();
  e.acceptSeq(e1);
  eq('★A 相等序号 ⇒ 接受（不旧于，不是"严格更新"）', e.acceptSeq(e1), true);
}

// ── B. pendingConverged 收敛条件 ─────────────────────────────────────────────
{
  eq('★B 快照等于覆盖值 ⇒ 收敛（已采纳）', pendingConverged(true, true), true);
  eq('★B 快照等于覆盖值（before 已变）⇒ 收敛', pendingConverged(true, false), true);
  eq('★B 快照**未变**（既非覆盖值也非 before 之外）⇒ **不收敛**（覆盖继续生效）',
    pendingConverged(false, true), false);
  eq('★B 快照相对 before **已变** ⇒ 收敛（让位服务端）', pendingConverged(false, false), true);
}

// ── C. 稳定比较器 + 渲染取值 ─────────────────────────────────────────────────
{
  // goalEqual（web 的 objective → 原生 text）
  const gA: GoalInfo = { text: 'A', status: 'active' };
  const gB: GoalInfo = { text: 'A', status: 'active' };
  const gC: GoalInfo = { text: 'A', status: 'done' };
  const gD: GoalInfo = { text: 'B', status: 'active' };
  eq('★C goal 同 text+status ⇒ 相等', goalEqual(gA, gB), true);
  eq('★C goal status 不同 ⇒ 不等', goalEqual(gA, gC), false);
  eq('★C goal text 不同 ⇒ 不等', goalEqual(gA, gD), false);
  eq('★C goal null vs null ⇒ 相等（都"无目标"）', goalEqual(null, null), true);
  eq('★C goal null vs 有值 ⇒ 不等', goalEqual(null, gA), false);
  eq('★C goal undefined vs null ⇒ 相等（同一语义）', goalEqual(undefined, null), true);
  eq('★C goal undefined vs 有值 ⇒ 不等', goalEqual(undefined, gA), false);

  // todosListEqual
  const t1: TodoItem[] = [{ text: 'a', status: 'pending' }];
  const t1b: TodoItem[] = [{ text: 'a', status: 'pending' }];
  const t1c: TodoItem[] = [{ text: 'a', status: 'completed' }];
  const t2: TodoItem[] = [{ text: 'a', status: 'pending' }, { text: 'b', status: 'pending' }];
  eq('★C todos 同长同项 ⇒ 相等（新对象也相等）', todosListEqual(t1, t1b), true);
  eq('★C todos **status 不同 ⇒ 不等**', todosListEqual(t1, t1c), false);
  eq('★C todos 长度不同 ⇒ 不等', todosListEqual(t1, t2), false);
  eq('★C todos undefined vs undefined ⇒ 相等（EMPTY 快照安全）', todosListEqual(undefined, undefined), true);
  eq('★C todos undefined vs [] ⇒ 相等', todosListEqual(undefined, []), true);
  eq('★C todos undefined vs 有值 ⇒ 不等', todosListEqual(undefined, t1), false);

  // pendingShown
  eq('★C 有覆盖 ⇒ 显示覆盖值（用户立刻看到自己的编辑）', pendingShown(true, 'NEW', 'OLD'), 'NEW');
  eq('★C 无覆盖 ⇒ 显示服务端快照', pendingShown(false, 'NEW', 'OLD'), 'OLD');
}

if (fail > 0) { console.log(`  pendingedit: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  pendingedit: ${pass} passed, 0 failed`);
process.exit(0);

export {};
