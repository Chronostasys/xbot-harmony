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

eq('有名字用名字', sessionLabel('发布 v1', 'chat_1'), '发布 v1');
eq('无名字回落 chat_id 末段', sessionLabel('  ', 'web/chat_9'), 'chat_9');
// ── 2026-10-16（目标③「超越 web」）：无 label ⇒ **用末条消息预览当标题**，⛔ 不裸 id ─────────
eq('无 label + 有预览 ⇒ 用预览当标题（⛔ 不是裸 chat_id）',
  sessionLabel('', 'web:chat_263F7E142E0B', '帮我看看这个 bug'), '帮我看看这个 bug');
eq('预览含换行/多空格 ⇒ 折叠成单行',
  sessionLabel('', 'web:chat_9', '第一行\n\n  第二行'), '第一行 第二行');
eq('预览首尾空白 ⇒ 裁掉', sessionLabel('', 'chat_9', '  hi  '), 'hi');
eq('预览超长 ⇒ 截断到 SESSION_LABEL_MAX', sessionLabel('', 'chat_9', 'x'.repeat(100)).length, 60);
eq('有 label 时预览**不参与**（label 优先）',
  sessionLabel('真名', 'chat_9', '预览串'), '真名');
eq('label 与预览都空 ⇒ 才回落 chat_id 末段（`/` 形 id 取末段）',
  sessionLabel('   ', 'web/chat_9', '   '), 'chat_9');
// mutation 自证（判别力）：若仍旧"裸 id 优先"（忽略预览）⇒ 上面第一条必红
function mutatedIdFirst(label: string, chatId: string, preview: string): string {
  const l: string = label.trim();
  if (l.length > 0) { return l; }
  const parts: string[] = chatId.split('/');
  return parts.length > 0 ? parts[parts.length - 1] : chatId;
}
eq('mutation：忽略预览的旧写法 ⇒ 第一条「用预览当标题」必红',
  mutatedIdFirst('', 'web:chat_263F7E142E0B', '帮我看看这个 bug') === '帮我看看这个 bug', false);
eq('mutation：现行实现同输入 ⇒ 判绿',
  sessionLabel('', 'web:chat_263F7E142E0B', '帮我看看这个 bug') === '帮我看看这个 bug', true);
// ── 服务端把 label **回声成原始会话键** ⇒ 视为无名（真机实测的现场丑点）────────────
eq('label === chat_id（回声）⇒ 视为无名 ⇒ 用预览',
  sessionLabel('web:chat_263F7E142E0B', 'web:chat_263F7E142E0B', '排队测试'), '排队测试');
eq('label === chat_id 末段（回声）⇒ 用预览',
  sessionLabel('chat_9', 'web/chat_9', '排队测试'), '排队测试');
eq('真名与 id 不同 ⇒ 仍用真名', sessionLabel('Agent-astute-cedar', 'chat_263F7E142E0B', '预览'), 'Agent-astute-cedar');
// mutation 自证：只看"label 非空"（不识别回声）⇒ 上两条必红
function mutatedLabelOnly(label: string, _chatId: string, _preview: string): string {
  const l: string = label.trim();
  return l.length > 0 ? l : _chatId;
}
eq('mutation：不识别回声的写法 ⇒ 「回声视为无名」必红',
  mutatedLabelOnly('web:chat_263F7E142E0B', 'web:chat_263F7E142E0B', '排队测试') === '排队测试', false);

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
eq('回声形态②（前缀 vs 裸 id）⇒ 用预览',
  sessionLabel('web:chat_263F7E142E0B', 'chat_263F7E142E0B', '排队测试'), '排队测试');
eq('回声形态② + 无预览 ⇒ 才落到 id 末段',
  sessionLabel('web:chat_263F7E142E0B', 'chat_263F7E142E0B', ''), 'chat_263F7E142E0B');

// ── 显示出口 `sessionTitle`：无名会话给**友好占位**（⛔ 不让机器串进列表）────────────────
//   引用 web 权威 `SessionItem.tsx:88` = `session.label || session.chatID`（**会把键当标题**）
//   ⇒ 本仓**有意超越 web**（用户定向「你是原生你要超越 web」）。
eq('sessionTitle：无名（无预览）⇒ 友好占位',
  sessionTitle('web:chat_263F7E142E0B', 'chat_263F7E142E0B'), SESSION_UNNAMED);
eq('sessionTitle：无名且无 label ⇒ 友好占位', sessionTitle('', 'chat_B6EF'), SESSION_UNNAMED);
eq('sessionTitle：有预览 ⇒ 预览（与 sessionLabel 同源）',
  sessionTitle('', 'chat_9', '排队测试'), '排队测试');
eq('sessionTitle：真名 ⇒ 真名', sessionTitle('harmony-ui-dev', 'chat_B6EF'), 'harmony-ui-dev');
// mutation 自证：拿"会显示机器串"的 sessionLabel 当出口 ⇒ 首条必红
eq('mutation：直接用 sessionLabel 当显示出口 ⇒ 首条「友好占位」必红',
  sessionLabel('web:chat_263F7E142E0B', 'chat_263F7E142E0B') === SESSION_UNNAMED, false);

if (fail > 0) { console.log(`  sessionops: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sessionops: ${pass} passed, 0 failed`);
process.exit(0);
