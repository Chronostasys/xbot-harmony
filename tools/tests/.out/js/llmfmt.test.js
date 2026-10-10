"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const llmfmt_1 = require("./llmfmt");
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
const entries = [
    { sub_id: 'sub-a', sub_name: 'A 订阅', model: 'glm-5.3-flash', status: 'normal' },
    { sub_id: 'sub-a', sub_name: 'A 订阅', model: 'glm-5.3', status: 'normal', vision: true },
    { sub_id: 'sub-b', sub_name: 'B 订阅', model: 'gpt-5', status: 'offline' },
    { sub_id: 'sub-b', sub_name: 'B 订阅', model: 'old-model', status: 'disabled' },
];
const groups = (0, llmfmt_1.groupModels)(entries);
eq('分组数', groups.length, 2);
eq('组名', groups.map((g) => g.name), ['A 订阅', 'B 订阅']);
eq('组内条数', groups.map((g) => g.entries.length), [2, 2]);
eq('组带 sub_id（切换必须用它）', groups.map((g) => g.subId), ['sub-a', 'sub-b']);
eq('空输入', (0, llmfmt_1.groupModels)(undefined).length, 0);
eq('正常无角标', (0, llmfmt_1.statusLabel)('normal'), '');
eq('离线角标', (0, llmfmt_1.statusLabel)('offline'), '离线');
eq('禁用角标', (0, llmfmt_1.statusLabel)('disabled'), '已禁用');
eq('禁用不可选', (0, llmfmt_1.selectable)({ status: 'disabled' }), false);
eq('离线可选', (0, llmfmt_1.selectable)({ status: 'offline' }), true);
eq('模型名', (0, llmfmt_1.modelLabel)({ model: 'm1', status: 'normal' }), 'm1');
eq('离线模型名', (0, llmfmt_1.modelLabel)({ model: 'm1', status: 'offline' }), 'm1（离线）');
eq('视觉标记', (0, llmfmt_1.modelLabel)({ model: 'm1', status: 'normal', vision: true }), 'm1 🖼');
eq('当前模型取服务端值', (0, llmfmt_1.currentModelText)({ model: 'm9' }, 'fallback'), 'm9');
eq('无配置回落', (0, llmfmt_1.currentModelText)(undefined, 'fallback'), 'fallback');
eq('空模型回落', (0, llmfmt_1.currentModelText)({ model: '' }, 'fallback'), 'fallback');
eq('上下文 1M', (0, llmfmt_1.contextText)(1000000), '1.0M');
eq('上下文 200k', (0, llmfmt_1.contextText)(200000), '200k');
eq('上下文缺失', (0, llmfmt_1.contextText)(undefined), '');
eq('预设', (0, llmfmt_1.contextPresets)().length, 4);
eq('解析 200k', (0, llmfmt_1.parseContext)('200k'), 200000);
eq('解析 1m', (0, llmfmt_1.parseContext)('1M'), 1000000);
eq('解析纯数字', (0, llmfmt_1.parseContext)(' 32768 '), 32768);
eq('非法输入', (0, llmfmt_1.parseContext)('abc'), 0);
eq('空输入', (0, llmfmt_1.parseContext)(''), 0);
eq('负数非法', (0, llmfmt_1.parseContext)('-5'), 0);
if (fail > 0) {
    console.log(`  llmfmt: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  llmfmt: ${pass} passed, 0 failed`);
process.exit(0);
