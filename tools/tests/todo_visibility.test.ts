/**
 * 「待办拉条可见性」与「状态条 todos x/y」**必须同源**的守卫测试。
 *
 * 真机现象（指挥者取证）：某会话状态条显示 `todos 0/5`（5 条全 pending，0 完成），
 * 输入框上方**没有**待办拉条；同一设备另一会话 `todos 3/5` 则拉条在。
 * 唯一变量是"完成数 0 → 3" ⇒ 高度怀疑可见性判据含 `doneCount>0`。
 *
 * 结论（本测试钉死）：**不存在第二套判据** ——
 *   · 拉条可见性 = `core/todos.ets:hasTodos(todos)` = `todos.length > 0`（web `TodoPullOut.tsx:56` 同）；
 *   · 状态条 = `core/statusfmt.ets:todoProgress(todos)`（`total===0 ⇒ ''`）；
 *   两者读**同一个 `this.todos`**（`Index.syncFrom` 单一投影）。
 *   要求：**只要状态条能显示 `todos x/y`，拉条就必须在**。
 *   （见 `docs/WEB-ALIGNMENT.md §13.3`「同一状态只能有一处判据」）
 *
 * 判别力：把 `hasTodos` 改成 `todos.some(done)`（或 `doneCount>0`）⇒ 下面 ★ 断言**红**。
 */
declare const process: { exit: (c: number) => void };

import { hasTodos } from '../../entry/src/main/ets/core/todos';
import { todoProgress } from '../../entry/src/main/ets/core/statusfmt';
import { TodoItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function todosOf(statuses: string[]): TodoItem[] {
  const out: TodoItem[] = [];
  for (let i = 0; i < statuses.length; i++) {
    out.push({ id: `t${i}`, text: `任务${i}`, status: statuses[i] });
  }
  return out;
}

// ① ★ 全是 pending（完成数 0）⇒ 状态条 `todos 0/5` **且**拉条可见（同源硬要求）
{
  const t: TodoItem[] = todosOf(['pending', 'pending', 'pending', 'pending', 'pending']);
  eq('★ 全 pending ⇒ 拉条可见', hasTodos(t), true);
  eq('★ 全 pending ⇒ 状态条 0/5', todoProgress(t), '0/5');
}

// ② 有完成 ⇒ 仍然可见（不是 doneCount>0 才可见）
{
  const t: TodoItem[] = todosOf(['done', 'done', 'done', 'pending', 'pending']);
  eq('3/5 ⇒ 拉条可见', hasTodos(t), true);
  eq('3/5 ⇒ 状态条 3/5', todoProgress(t), '3/5');
}

// ③ 空 / undefined ⇒ 两者同时消失（可见性 = total>0 的同一判据）
eq('空数组 ⇒ 拉条不渲染', hasTodos([]), false);
eq('空数组 ⇒ 状态条空', todoProgress([]), '');
eq('undefined ⇒ 拉条不渲染', hasTodos(undefined), false);
eq('undefined ⇒ 状态条空', todoProgress(undefined), '');

// ④ 一致性：任何非空 todos，状态条非空 ⇔ 拉条可见
{
  const cases: string[][] = [
    ['pending'],
    ['done'],
    ['doing'],
    ['pending', 'doing', 'done'],
  ];
  for (let i = 0; i < cases.length; i++) {
    const t: TodoItem[] = todosOf(cases[i]);
    const bar: boolean = hasTodos(t);
    const status: boolean = todoProgress(t).length > 0;
    eq(`同源一致 case#${i}`, bar, status);
  }
}

if (fail > 0) { console.log(`  todo_visibility: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  todo_visibility: ${pass} passed, 0 failed`);
process.exit(0);
