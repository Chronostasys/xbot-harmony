/** LLM 选择栏纯逻辑测试（切模型必须带 sub_id —— 项目铁律：禁用裸模型名解析）。 */
declare const process: { exit: (c: number) => void };

import {
  contextPresets, contextText, currentModelText, groupModels, modelLabel, parseContext, selectable,
  statusLabel,
} from '../../entry/src/main/ets/core/llmfmt';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const entries = [
  { sub_id: 'sub-a', sub_name: 'A 订阅', model: 'glm-5.3-flash', status: 'normal' },
  { sub_id: 'sub-a', sub_name: 'A 订阅', model: 'glm-5.3', status: 'normal', vision: true },
  { sub_id: 'sub-b', sub_name: 'B 订阅', model: 'gpt-5', status: 'offline' },
  { sub_id: 'sub-b', sub_name: 'B 订阅', model: 'old-model', status: 'disabled' },
];
const groups = groupModels(entries);
eq('分组数', groups.length, 2);
eq('组名', groups.map((g) => g.name), ['A 订阅', 'B 订阅']);
eq('组内条数', groups.map((g) => g.entries.length), [2, 2]);
eq('组带 sub_id（切换必须用它）', groups.map((g) => g.subId), ['sub-a', 'sub-b']);
eq('空输入', groupModels(undefined).length, 0);

eq('正常无角标', statusLabel('normal'), '');
eq('离线角标', statusLabel('offline'), '离线');
eq('禁用角标', statusLabel('disabled'), '已禁用');
eq('禁用不可选', selectable({ status: 'disabled' }), false);
eq('离线可选', selectable({ status: 'offline' }), true);

eq('模型名', modelLabel({ model: 'm1', status: 'normal' }), 'm1');
eq('离线模型名', modelLabel({ model: 'm1', status: 'offline' }), 'm1（离线）');
eq('视觉标记', modelLabel({ model: 'm1', status: 'normal', vision: true }), 'm1 🖼');

eq('当前模型取服务端值', currentModelText({ model: 'm9' }, 'fallback'), 'm9');
eq('无配置回落', currentModelText(undefined, 'fallback'), 'fallback');
eq('空模型回落', currentModelText({ model: '' }, 'fallback'), 'fallback');

eq('上下文 1M', contextText(1000000), '1.0M');
eq('上下文 200k', contextText(200000), '200k');
eq('上下文缺失', contextText(undefined), '');
eq('预设', contextPresets().length, 4);

eq('解析 200k', parseContext('200k'), 200000);
eq('解析 1m', parseContext('1M'), 1000000);
eq('解析纯数字', parseContext(' 32768 '), 32768);
eq('非法输入', parseContext('abc'), 0);
eq('空输入', parseContext(''), 0);
eq('负数非法', parseContext('-5'), 0);

if (fail > 0) { console.log(`  llmfmt: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  llmfmt: ${pass} passed, 0 failed`);
process.exit(0);
