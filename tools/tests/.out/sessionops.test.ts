/** 会话管理纯逻辑测试（排序越界必须原样返回、筛选大小写不敏感）。 */
declare const process: { exit: (c: number) => void };

import {
  canMove, hitLine, MOVE_DOWN, MOVE_TOP, MOVE_UP, moveOrders, roleLabel, sessionLabel, sessionMatches,
} from './sessionops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
const ids = ['a', 'b', 'c'];

eq('置顶', moveOrders(ids, 'c', MOVE_TOP), { c: 0, a: 1, b: 2 });
eq('上移', moveOrders(ids, 'b', MOVE_UP), { b: 0, a: 1, c: 2 });
eq('下移', moveOrders(ids, 'b', MOVE_DOWN), { a: 0, c: 1, b: 2 });
eq('已在顶部再上移 = 原序', moveOrders(ids, 'a', MOVE_UP), { a: 0, b: 1, c: 2 });
eq('已是最底再下移 = 原序', moveOrders(ids, 'c', MOVE_DOWN), { a: 0, b: 1, c: 2 });
eq('未知 id 原样', moveOrders(ids, 'zzz', MOVE_TOP), { a: 0, b: 1, c: 2 });
eq('空列表', moveOrders([], 'a', MOVE_TOP), {});
eq('序号连续', Object.values(moveOrders(['x', 'y', 'z'], 'z', MOVE_TOP)).sort(), [0, 1, 2]);

eq('顶部不能再上移', canMove(ids, 'a', MOVE_UP), false);
eq('顶部可以下移', canMove(ids, 'a', MOVE_DOWN), true);
eq('底部不能再下移', canMove(ids, 'c', MOVE_DOWN), false);
eq('中间可以置顶', canMove(ids, 'b', MOVE_TOP), true);
eq('已在顶部不能置顶', canMove(ids, 'a', MOVE_TOP), false);
eq('未知 id 不可移动', canMove(ids, 'zzz', MOVE_UP), false);

eq('空词全通过', sessionMatches('任意', 'chat_1', ''), true);
eq('按名字命中（忽略大小写）', sessionMatches('My Chat', 'chat_1', 'my chat'), true);
eq('按 id 命中', sessionMatches('x', 'chat_abc', 'abc'), true);
eq('不命中', sessionMatches('x', 'y', 'zzz'), false);
eq('空白词全通过', sessionMatches('x', 'y', '   '), true);

eq('角色名 user', roleLabel('user'), '你');
eq('角色名 assistant', roleLabel('assistant'), 'xbot');
eq('其他角色原样', roleLabel('system'), 'system');

eq('命中行压平换行', hitLine('user', 'a\nb\r\nc', 50), '你：a b  c');
eq('命中行截断', hitLine('assistant', 'x'.repeat(20), 5), 'xbot：xxxxx…');
eq('短摘要不截断', hitLine('user', 'hi', 50), '你：hi');

eq('有名字用名字', sessionLabel('发布 v1', 'chat_1'), '发布 v1');
eq('无名字回落 chat_id 末段', sessionLabel('  ', 'web/chat_9'), 'chat_9');

if (fail > 0) { console.log(`  sessionops: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sessionops: ${pass} passed, 0 failed`);
process.exit(0);
