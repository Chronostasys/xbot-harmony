/**
 * 乐观覆盖层（`core/msgops.ets:PendingEdit`）的判别力测试。
 *
 * 逐字对齐 web `hooks/usePendingEdit.ts:57-95` 的语义：本地编辑在服务端权威快照收敛前，
 * 不被**更旧的**快照盖掉（原生 `Index.syncFrom` 曾无条件 `this.todos = store.todos.slice()`
 * ⇒ 用户刚勾选就被旧快照回退）。
 */
declare const process: { exit: (c: number) => void };

import { PendingEdit } from '../../entry/src/main/ets/core/msgops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ① ★ 核心：snapshot=OLD → commit(NEW) → 再喂 snapshot=OLD ⇒ 仍保持本地覆盖（返回 true）
{
  const pe: PendingEdit = new PendingEdit();
  eq('初始未 pending', pe.isPending(), false);
  eq('无 pending 时快照可接受', pe.accepts('OLD'), false);
  pe.commit('NEW');
  eq('commit 后 pending', pe.isPending(), true);
  eq('旧快照被挡（保持本地覆盖）', pe.accepts('OLD'), true);
  eq('旧快照后仍 pending', pe.isPending(), true);
  // ② 收敛：喂到 NEW ⇒ 清 pending、返回 false
  eq('收敛快照可接受', pe.accepts('NEW'), false);
  eq('收敛后不再 pending', pe.isPending(), false);
}

// ③ gen 单调（防乱序）
{
  const pe: PendingEdit = new PendingEdit();
  const g1: number = pe.commit('A');
  const g2: number = pe.commit('B');
  eq('gen 单调递增', g2 > g1, true);
}

// ④ discard 放弃覆盖
{
  const pe: PendingEdit = new PendingEdit();
  pe.commit('X');
  pe.discard();
  eq('discard 后不 pending', pe.isPending(), false);
  eq('discard 后快照可接受', pe.accepts('X'), false);
}

// ⑤ 收敛后再 commit 一笔新的旧快照仍被挡（覆盖层可重用）
{
  const pe: PendingEdit = new PendingEdit();
  pe.commit('A');
  eq('收敛 A', pe.accepts('A'), false);
  pe.commit('B');
  eq('新一笔的旧快照仍被挡', pe.accepts('A'), true);
}

if (fail > 0) { console.log(`  pending_edit: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  pending_edit: ${pass} passed, 0 failed`);
process.exit(0);
