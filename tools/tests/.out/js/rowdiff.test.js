"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rowdiff_1 = require("./rowdiff");
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
function row(id, rev) {
    const r = new types_1.ChatRow();
    r.id = id;
    r.rev = rev;
    r.role = 'assistant';
    return r;
}
eq('键含 rev', (0, rowdiff_1.rowKey)(row('a', 3)), 'a#3');
eq('同键', (0, rowdiff_1.rowKey)(row('b', 1)), 'b#1');
eq('空表相等', (0, rowdiff_1.sameRowIds)([], []), true);
eq('长度不同', (0, rowdiff_1.sameRowIds)([row('a', 1)], []), false);
eq('顺序不同 = 身份变了', (0, rowdiff_1.sameRowIds)([row('a', 1), row('b', 1)], [row('b', 1), row('a', 1)]), false);
eq('同身份（rev 不同仍算同身份）', (0, rowdiff_1.sameRowIds)([row('a', 1), row('b', 5)], [row('a', 9), row('b', 6)]), true);
eq('无变化', (0, rowdiff_1.changedRowIndices)([row('a', 1), row('b', 1)], [row('a', 1), row('b', 1)]), []);
eq('单行 rev 变化', (0, rowdiff_1.changedRowIndices)([row('a', 1), row('b', 1)], [row('a', 2), row('b', 1)]), [0]);
eq('两行变化', (0, rowdiff_1.changedRowIndices)([row('a', 1), row('b', 1)], [row('a', 2), row('b', 2)]), [0, 1]);
eq('长度不等时只比公共前缀（身份变化走 reload）', (0, rowdiff_1.changedRowIndices)([row('a', 1)], [row('a', 1), row('b', 1)]), []);
eq('窗口：limit 大于总长', (0, rowdiff_1.tailRows)([row('a', 1)], 5).length, 1);
eq('窗口：取末尾', (0, rowdiff_1.tailRows)([row('a', 1), row('b', 1), row('c', 1)], 2).map((r) => r.id), ['b', 'c']);
eq('窗口：limit=0 视为全量', (0, rowdiff_1.tailRows)([row('a', 1)], 0).length, 1);
eq('窗口不改原数组', (0, rowdiff_1.tailRows)([row('a', 1), row('b', 1)], 1).length + 2, 3);
if (fail > 0) {
    console.log(`  rowdiff: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  rowdiff: ${pass} passed, 0 failed`);
process.exit(0);
