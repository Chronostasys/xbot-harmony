/** 会话管理纯逻辑测试（排序越界必须原样返回、筛选大小写不敏感）。 */
declare const process: { exit: (c: number) => void };

import {
  canMove, hitLine, MOVE_DOWN, MOVE_TOP, MOVE_UP, moveOrders, roleLabel, sessionLabel, sessionMatches,
  isEchoLabel, sessionTitle, SESSION_UNNAMED,
} from '../../entry/src/main/ets/core/sessionops';

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

// ── sessionLabel：与 web 对齐（label || chatID，不做回声/preview/未命名）────────────
eq('有名字用名字', sessionLabel('发布 v1', 'chat_1'), '发布 v1');
eq('无名字用完整 chatId（与 web 对齐）', sessionLabel('  ', 'web/chat_9'), 'web/chat_9');
eq('label 空 + 有预览 ⇒ 仍用 chatId（与 web 对齐，不用预览）',
  sessionLabel('', 'web:chat_263F7E142E0B', '帮我看看这个 bug'), 'web:chat_263F7E142E0B');
eq('有 label 时预览不参与（label 优先）',
  sessionLabel('真名', 'chat_9', '预览串'), '真名');
eq('label === chatId（回声）⇒ 仍显示 label（与 web 对齐）',
  sessionLabel('web:chat_263F7E142E0B', 'web:chat_263F7E142E0B', '排队测试'), 'web:chat_263F7E142E0B');
eq('label 是 id 末段（回声）⇒ 仍显示 label（与 web 对齐）',
  sessionLabel('chat_9', 'web/chat_9', '排队测试'), 'chat_9');
eq('真名与 id 不同 ⇒ 仍用真名', sessionLabel('Agent-astute-cedar', 'chat_263F7E142E0B', '预览'), 'Agent-astute-cedar');
eq('CLI basename 真名 ⇒ 显示真名',
  sessionLabel('xbot-harmony', '/Users/bobli/src/xbot-harmony', ''), 'xbot-harmony');
// mutation 自证：旧写法（回声检测+preview回退）与 web 不一致
function mutatedOldWay(label: string, chatId: string, preview: string): string {
  const l: string = label.trim();
  if (l.length === 0) { return chatId; }
  // 旧写法：回声 label 被当成无名 ⇒ 回退 preview（或空）—— 与 web 不一致
  return l === chatId ? preview : l;
}
eq('mutation：旧写法把回声 label 变成 preview/无名 ⇒ 与 web 不一致必红',
  mutatedOldWay('web:chat_263F7E142E0B', 'web:chat_263F7E142E0B', '排队测试') === 'web:chat_263F7E142E0B', false);
eq('现行实现与 web 对齐 ⇒ 判绿',
  sessionLabel('web:chat_263F7E142E0B', 'web:chat_263F7E142E0B', '排队测试') === 'web:chat_263F7E142E0B', true);

// ── 回声的**第二种真实形态**（2026-10-16 装机截图实锤的漏网）：label 带**渠道前缀**、chat_id 裸 ──
//   服务端把会话键组装成 `channel + ":" + chat_id`，而会话树的 `chat_id` 字段可能**不带前缀**
//   ⇒ 旧判据（`label === chatId || label === 末段`）**两边都不命中** ⇒ 列表里照样显示
//   `web:chat_263F7E142E0B` 机器串（用户再次点名的丑点）。⟹ 判据改**末段比对**。
eq('isEchoLabel：label 带前缀 vs 裸 chat_id ⇒ 是回声',
  isEchoLabel('web:chat_263F7E142E0B', 'chat_263F7E142E0B'), true);
eq('isEchoLabel：双尖前缀（web:web:chat_X）也识别',
  isEchoLabel('web:web:chat_X', 'web:chat_X'), true);
eq('isEchoLabel：真名（`重构: 会话A` 有空白前缀）⇒ **不是**回声',
  isEchoLabel('重构: 会话A', '会话A'), false);
eq('isEchoLabel：真名与 id 无关 ⇒ 不是回声',
  isEchoLabel('harmony-ui-dev', 'chat_B6EF'), false);
// ── 2026-10-14 修复回归（B 线审计 9/41 实锤：CLI basename 真名被「无前缀⇒回声」误杀）──
eq('isEchoLabel：CLI basename 真名（目录路径键）⇒ **不是**回声（名字被吞=用户亲报）',
  isEchoLabel('xbot-harmony', '/Users/bobli/src/xbot-harmony'), false);
eq('isEchoLabel：家目录 basename 真名 ⇒ 不是回声',
  isEchoLabel('bobli', '/Users/bobli'), false);
eq('isEchoLabel：复合键的裸末段 label（web/chat_9）⇒ 仍是回声（机器串，旧行为保留）',
  isEchoLabel('chat_9', 'web/chat_9'), true);
eq('sessionLabel：CLI basename 真名 ⇒ 显示真名',
  sessionLabel('xbot-harmony', '/Users/bobli/src/xbot-harmony', ''), 'xbot-harmony');

// ── sessionTitle：与 web 对齐（= sessionLabel，不做未命名占位）────────────────────
eq('sessionTitle：CLI 会话标题 = 真名',
  sessionTitle('xbot-harmony', '/Users/bobli/src/xbot-harmony'), 'xbot-harmony');
eq('sessionTitle：回声 label ⇒ 显示 label（与 web 对齐，不用未命名占位）',
  sessionTitle('web:chat_263F7E142E0B', 'chat_263F7E142E0B'), 'web:chat_263F7E142E0B');
eq('sessionTitle：无 label ⇒ 显示 chatId（与 web 对齐）',
  sessionTitle('', 'chat_B6EF'), 'chat_B6EF');
eq('sessionTitle：有预览但无 label ⇒ 显示 chatId（与 web 对齐，不用预览）',
  sessionTitle('', 'chat_9', '排队测试'), 'chat_9');
eq('sessionTitle：真名 ⇒ 真名', sessionTitle('harmony-ui-dev', 'chat_B6EF'), 'harmony-ui-dev');

if (fail > 0) { console.log(`  sessionops: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sessionops: ${pass} passed, 0 failed`);
process.exit(0);

export {};
