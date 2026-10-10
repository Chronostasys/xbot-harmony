/**
 * todo **状态词汇**一致性回归（`core/statusfmt.ets`）—— 钉死 2026-10-11 修掉的真 bug。
 *
 * 事故（波6 发现）：`core/statusfmt.ets` 旧版用 `status === 'completed'` / `'in_progress'`
 * 判 todo 状态，而**服务端权威词汇是 `"pending" | "doing" | "done"`**
 * （`xbot/tools/todo.go:15`、`xbot/protocol/events.go:19`；web 侧同 `done`/`doing`，
 * `web/src/hooks/useTodos.ts:37-41`）
 * ⇒ 状态栏「todos N/M」**恒为 `0/N`**、`currentTodo()` **恒返回空串**。
 *
 * ⚠️ 判别力自证：把 `statusfmt` 的判据改回 `'completed'` / `'in_progress'` ⇒ 本文件**全红**。
 */
declare const process: { exit: (c: number) => void };

import { currentTodo, todoProgress } from '../../entry/src/main/ets/core/statusfmt';
import { TodoItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function td(text: string, status: string): TodoItem {
  return { text, status };
}

// ── ① 进度计数：只认服务端词汇 `done` ──
{
  eq('全 done ⇒ 2/2', todoProgress([td('a', 'done'), td('b', 'done')]), '2/2');
  eq('混合 ⇒ 1/3', todoProgress([td('a', 'done'), td('b', 'doing'), td('c', 'pending')]), '1/3');
  eq('全未完成 ⇒ 0/2', todoProgress([td('a', 'pending'), td('b', 'doing')]), '0/2');
  // ⛔ 事故值：`completed` 服务端**从不发** ⇒ 旧实现恒 0/N
  eq('completed 别名也认（容错）', todoProgress([td('a', 'completed'), td('b', 'pending')]), '1/2');
  eq('空列表 ⇒ 空串', todoProgress([]), '');
  eq('undefined ⇒ 空串', todoProgress(undefined), '');
  // 未知状态**不得**算完成（否则进度虚高）
  eq('未知状态不算 done', todoProgress([td('a', 'weird'), td('b', 'done')]), '1/2');
}

// ── ② 当前任务：**只认"进行中"**（doing）—— 原生既定语义 ──
{
  eq('doing 即当前任务', currentTodo([td('a', 'done'), td('b', 'doing')]), 'b');
  // ⛔ 原生**刻意**与 web 不同：web `useTodos.ts:41` 的 currentTask 取"第一条非 done"（含 pending），
  //    原生只服务状态栏「进行中：xxx」⇒ **pending 不算当前任务**。
  //    该语义由既有测试 `tools/tests/statusfmt.test.ts:33`（"无进行中"）钉死。
  eq('pending 不算当前任务（与 web 刻意不同）', currentTodo([td('a', 'done'), td('b', 'pending')]), '');
  eq('只有 pending ⇒ 空串', currentTodo([td('C', 'pending')]), '');
  eq('全完成 ⇒ 空串', currentTodo([td('a', 'done'), td('b', 'done')]), '');
  eq('空列表 ⇒ 空串', currentTodo([]), '');
  eq('undefined ⇒ 空串', currentTodo(undefined), '');
  // ⛔ 事故值：`in_progress` 服务端从不发 ⇒ 旧实现**恒空**（这才是本波修的 bug）
  eq('in_progress 别名也认（容错）', currentTodo([td('a', 'in_progress')]), 'a');
  eq('doing 是服务端真实值（旧实现漏判）', currentTodo([td('a', 'doing')]), 'a');
  // 文本缺失 ⇒ 空串（不返回 undefined）
  eq('文本缺失 ⇒ 空串', currentTodo([{ status: 'doing' }]), '');
  // 未知状态既不是 done 也不是 doing ⇒ 不算"进行中"
  eq('未知状态不算进行中', currentTodo([td('a', 'weird')]), '');
}

console.log(`\ntodo_vocab.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
