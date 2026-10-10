"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const statusfmt_1 = require("./statusfmt");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('小数字', (0, statusfmt_1.humanTokens)(0), '0');
eq('三位数', (0, statusfmt_1.humanTokens)(999), '999');
eq('千级保留一位', (0, statusfmt_1.humanTokens)(1234), '1.2k');
eq('万级取整', (0, statusfmt_1.humanTokens)(123456), '123k');
eq('百万级', (0, statusfmt_1.humanTokens)(1234567), '1.2M');
// usageText：**绝不在拿不到真实值时估算** ⇒ available=false / 无 max 一律空串
eq('无 usage', (0, statusfmt_1.usageText)(undefined), '');
eq('available=false 不显示', (0, statusfmt_1.usageText)({ available: false, prompt_tokens: 100, max_context_tokens: 1000 }), '');
eq('无 max 不显示', (0, statusfmt_1.usageText)({ available: true, prompt_tokens: 100 }), '');
eq('正常用量', (0, statusfmt_1.usageText)({ available: true, prompt_tokens: 12300, max_context_tokens: 1000000, usage_percent: 1.23 }), '12.3k/1.0M 1.2%');
eq('无 usage_percent 时按真实值算', (0, statusfmt_1.usageText)({ available: true, prompt_tokens: 500000, max_context_tokens: 1000000 }), '500k/1.0M 50%');
eq('无 todos', (0, statusfmt_1.todoProgress)(undefined), '');
eq('空列表', (0, statusfmt_1.todoProgress)([]), '');
eq('进度', (0, statusfmt_1.todoProgress)([{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]), '1/3');
eq('全部完成', (0, statusfmt_1.todoProgress)([{ status: 'completed' }, { status: 'completed' }]), '2/2');
eq('当前 todo', (0, statusfmt_1.currentTodo)([{ status: 'completed', text: 'A' }, { status: 'in_progress', text: 'B' }]), 'B');
eq('无进行中', (0, statusfmt_1.currentTodo)([{ status: 'pending', text: 'C' }]), '');
eq('无 goal', (0, statusfmt_1.goalText)(undefined), '');
eq('空文本 goal', (0, statusfmt_1.goalText)({ text: '' }), '');
eq('进行中 goal', (0, statusfmt_1.goalText)({ text: '发布 v1', status: 'active' }), '🎯 发布 v1');
eq('已完成 goal', (0, statusfmt_1.goalText)({ text: '发布 v1', status: 'completed' }), '✅ 发布 v1');
eq('无模型', (0, statusfmt_1.modelText)(undefined), '');
eq('模型名', (0, statusfmt_1.modelText)({ model: 'glm-5.3-flash' }), 'glm-5.3-flash');
if (fail > 0) {
    console.log(`  statusfmt: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  statusfmt: ${pass} passed, 0 failed`);
process.exit(0);
