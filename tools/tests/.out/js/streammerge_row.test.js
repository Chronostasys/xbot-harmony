"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const streammerge_1 = require("./streammerge");
const types_1 = require("./types");
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
function row(live, iters) {
    const r = new types_1.ChatRow();
    r.role = 'assistant';
    r.isLive = live;
    r.iterations = iters.map((n) => ({ iteration: n, content: 'x' }));
    return r;
}
const it = (n) => ({ iteration: n, content: 'x' });
eq('live 行的最后一个迭代由尾块承担', (0, streammerge_1.tailOwnedIteration)(row(true, [1, 2, 3]), it(3)), true);
eq('live 行的**已完成**迭代仍由列表渲染（关键：否则"完成一个消失一个"）', (0, streammerge_1.tailOwnedIteration)(row(true, [1, 2, 3]), it(1)), false);
eq('live 行的中间迭代也由列表渲染', (0, streammerge_1.tailOwnedIteration)(row(true, [1, 2, 3]), it(2)), false);
eq('已提交行的任何迭代都不归尾块', (0, streammerge_1.tailOwnedIteration)(row(false, [1, 2, 3]), it(3)), false);
eq('空迭代集的 live 行不归尾块', (0, streammerge_1.tailOwnedIteration)(row(true, []), it(1)), false);
eq('单迭代 live 行：该迭代归尾块', (0, streammerge_1.tailOwnedIteration)(row(true, [1]), it(1)), true);
if (fail > 0) {
    console.log(`  streammerge_row: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  streammerge_row: ${pass} passed, 0 failed`);
process.exit(0);
