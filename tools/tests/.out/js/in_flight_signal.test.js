"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const streammerge_1 = require("./streammerge");
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
/** 独立 oracle：末尾 `live:true` 块里是否有 思考/正文/工具（对齐渲染画法）。 */
function oracle(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        const it = row.iterations[i];
        if (it.live === true) {
            return (0, streammerge_1.displayReasoning)(it).length > 0 || (0, streammerge_1.displayContent)(it).length > 0
                || (it.tools !== undefined && it.tools.length > 0);
        }
    }
    return false;
}
function row(content, iterations) {
    const r = new types_1.ChatRow();
    r.role = 'assistant';
    r.content = content;
    r.iterations = iterations;
    return r;
}
function it(iteration, content, reasoning, tools) {
    return { iteration, content, reasoning, tools };
}
function live(iteration, content, reasoning, tools) {
    const b = it(iteration, content, reasoning, tools);
    b.live = true;
    return b;
}
const t1 = { name: 'Shell', status: 'running' };
const cases = [
    { name: '空行', row: row('', []) },
    { name: '仅顶层 content（iterations 空）无在飞块', row: row('你好', []) },
    { name: '仅已完成块（有正文）——空隙形态', row: row('', [it(1, '最终正文', '最终思考')]) },
    { name: '已完成块 + 在飞块（空壳）', row: row('', [it(1, 'a', ''), live(2, '', '')]) },
    { name: '已完成块 + 在飞块（正文）', row: row('', [it(1, 'a', ''), live(2, '在飞正文', '')]) },
    { name: '已完成块 + 在飞块（思考）', row: row('', [it(1, 'a', ''), live(2, '', '推理中')]) },
    { name: '已完成块 + 在飞块（工具）', row: row('', [it(1, 'a', ''), live(2, '', '', [t1])]) },
    { name: '在飞块带 stream_text（打字机草稿）', row: row('', [{ iteration: 1, content: '', reasoning: '', tools: [], live: true, stream_text: '流式' }]) },
    { name: '在飞块带 stream_reasoning', row: row('', [{ iteration: 1, content: '', reasoning: '', tools: [], live: true, stream_reasoning: '推' }]) },
];
for (const c of cases) {
    eq(`生产 == oracle：${c.name}`, (0, streammerge_1.rowHasInFlightSignal)(c.row), oracle(c.row));
}
// 显式钉死关键反例（红→绿的核心语义）
eq('空隙形态（仅已完成块）无在飞信号', (0, streammerge_1.rowHasInFlightSignal)(cases[2].row), false);
eq('在飞正文 ⇒ 有在飞信号', (0, streammerge_1.rowHasInFlightSignal)(cases[4].row), true);
eq('在飞空壳 ⇒ 无在飞信号', (0, streammerge_1.rowHasInFlightSignal)(cases[3].row), false);
if (fail > 0) {
    console.log(`  in_flight_signal: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  in_flight_signal: ${pass} passed, 0 failed`);
process.exit(0);
