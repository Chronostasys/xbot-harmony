/** 状态栏格式化测试（数字算错会误导用户，必须钉死）。 */
declare const process: { exit: (c: number) => void };

import {
  humanTokens, usageText, todoProgress, currentTodo, goalText, modelText,
} from '../../entry/src/main/ets/core/statusfmt';
import { todoState } from '../../entry/src/main/ets/core/todos';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ⚠️ 2026-10-11（§12-L）口径统一：humanTokens 委托 ctxTokensAsK（web `formatTokensAsK`）
// ⇒ 这些期望值按 web 权威更新（大写 K、无 M 档、无 `.0`）：999→1K、1234567→1234.6K。
eq('小数字（web：0 ⇒ 0K）', humanTokens(0), '0K');
eq('三位数（web：999 ⇒ 1K）', humanTokens(999), '1K');
eq('千级保留一位', humanTokens(1234), '1.2K');
eq('万级（web：一位小数）', humanTokens(123456), '123.5K');
eq('百万级（web 无 M 档 ⇒ 1234.6K）', humanTokens(1234567), '1234.6K');

// usageText：**绝不在拿不到真实值时估算** ⇒ available=false / 无 max 一律空串
eq('无 usage', usageText(undefined), '');
eq('available=false 不显示', usageText({ available: false, prompt_tokens: 100, max_context_tokens: 1000 }), '');
eq('无 max 不显示', usageText({ available: true, prompt_tokens: 100 }), '');
eq('正常用量（§12-L/M 后：大写 K + 无 M 档 + 环的取整口径）', usageText({ available: true, prompt_tokens: 12300, max_context_tokens: 1000000, usage_percent: 1.23 }), '12.3K/1000K 1.23%');
eq('无 usage_percent 时按真实值算', usageText({ available: true, prompt_tokens: 500000, max_context_tokens: 1000000 }), '500K/1000K 50%');

eq('无 todos', todoProgress(undefined), '');
eq('空列表', todoProgress([]), '');
eq('进度', todoProgress([{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]), '1/3');
eq('全部完成', todoProgress([{ status: 'completed' }, { status: 'completed' }]), '2/2');

// ⛔ H9：currentTodo 与面板**同源**（web useTodos.ts:41 = 第一条非 done，含 pending）
eq('当前 todo（第一条非 done）', currentTodo([{ status: 'completed', text: 'A' }, { status: 'in_progress', text: 'B' }]), 'B');
{
  const h9 = [{ status: 'pending', text: 'A' }, { status: 'doing', text: 'B' }];
  eq('H9：pending 先于 doing ⇒ 取 A（含 pending）', currentTodo(h9), 'A');
  eq('H9：currentTodo 与面板同源（恒相等）', currentTodo(h9), todoState(h9).currentText);
}
eq('全部完成 ⇒ 空', currentTodo([{ status: 'done', text: 'X' }]), '');

eq('无 goal', goalText(undefined), '');
eq('空文本 goal', goalText({ text: '' }), '');
eq('进行中 goal', goalText({ text: '发布 v1', status: 'active' }), '目标：发布 v1');
eq('已完成 goal', goalText({ text: '发布 v1', status: 'completed' }), '已完成：发布 v1');
// ⛔ H6：'done' 是**幽灵值**（服务端 goal 词汇是 active|completed）⇒ 不得当作已完成
eq('H6：幽灵 done 不算已完成', goalText({ text: '发布 v1', status: 'done' }), '目标：发布 v1');

eq('无模型', modelText(undefined), '');
eq('模型名', modelText({ model: 'glm-5.3-flash' }), 'glm-5.3-flash');

if (fail > 0) { console.log(`  statusfmt: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  statusfmt: ${pass} passed, 0 failed`);
process.exit(0);
