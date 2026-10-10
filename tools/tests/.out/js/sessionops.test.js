"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sessionops_1 = require("./sessionops");
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
const ids = ['a', 'b', 'c'];
eq('置顶', (0, sessionops_1.moveOrders)(ids, 'c', sessionops_1.MOVE_TOP), { c: 0, a: 1, b: 2 });
eq('上移', (0, sessionops_1.moveOrders)(ids, 'b', sessionops_1.MOVE_UP), { b: 0, a: 1, c: 2 });
eq('下移', (0, sessionops_1.moveOrders)(ids, 'b', sessionops_1.MOVE_DOWN), { a: 0, c: 1, b: 2 });
eq('已在顶部再上移 = 原序', (0, sessionops_1.moveOrders)(ids, 'a', sessionops_1.MOVE_UP), { a: 0, b: 1, c: 2 });
eq('已是最底再下移 = 原序', (0, sessionops_1.moveOrders)(ids, 'c', sessionops_1.MOVE_DOWN), { a: 0, b: 1, c: 2 });
eq('未知 id 原样', (0, sessionops_1.moveOrders)(ids, 'zzz', sessionops_1.MOVE_TOP), { a: 0, b: 1, c: 2 });
eq('空列表', (0, sessionops_1.moveOrders)([], 'a', sessionops_1.MOVE_TOP), {});
eq('序号连续', Object.values((0, sessionops_1.moveOrders)(['x', 'y', 'z'], 'z', sessionops_1.MOVE_TOP)).sort(), [0, 1, 2]);
eq('顶部不能再上移', (0, sessionops_1.canMove)(ids, 'a', sessionops_1.MOVE_UP), false);
eq('顶部可以下移', (0, sessionops_1.canMove)(ids, 'a', sessionops_1.MOVE_DOWN), true);
eq('底部不能再下移', (0, sessionops_1.canMove)(ids, 'c', sessionops_1.MOVE_DOWN), false);
eq('中间可以置顶', (0, sessionops_1.canMove)(ids, 'b', sessionops_1.MOVE_TOP), true);
eq('已在顶部不能置顶', (0, sessionops_1.canMove)(ids, 'a', sessionops_1.MOVE_TOP), false);
eq('未知 id 不可移动', (0, sessionops_1.canMove)(ids, 'zzz', sessionops_1.MOVE_UP), false);
eq('空词全通过', (0, sessionops_1.sessionMatches)('任意', 'chat_1', ''), true);
eq('按名字命中（忽略大小写）', (0, sessionops_1.sessionMatches)('My Chat', 'chat_1', 'my chat'), true);
eq('按 id 命中', (0, sessionops_1.sessionMatches)('x', 'chat_abc', 'abc'), true);
eq('不命中', (0, sessionops_1.sessionMatches)('x', 'y', 'zzz'), false);
eq('空白词全通过', (0, sessionops_1.sessionMatches)('x', 'y', '   '), true);
eq('角色名 user', (0, sessionops_1.roleLabel)('user'), '你');
eq('角色名 assistant', (0, sessionops_1.roleLabel)('assistant'), 'xbot');
eq('其他角色原样', (0, sessionops_1.roleLabel)('system'), 'system');
eq('命中行压平换行', (0, sessionops_1.hitLine)('user', 'a\nb\r\nc', 50), '你：a b  c');
eq('命中行截断', (0, sessionops_1.hitLine)('assistant', 'x'.repeat(20), 5), 'xbot：xxxxx…');
eq('短摘要不截断', (0, sessionops_1.hitLine)('user', 'hi', 50), '你：hi');
eq('有名字用名字', (0, sessionops_1.sessionLabel)('发布 v1', 'chat_1'), '发布 v1');
eq('无名字回落 chat_id 末段', (0, sessionops_1.sessionLabel)('  ', 'web/chat_9'), 'chat_9');
if (fail > 0) {
    console.log(`  sessionops: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  sessionops: ${pass} passed, 0 failed`);
process.exit(0);
