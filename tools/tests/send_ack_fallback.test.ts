/**
 * 发送 ack 的权威落点：requestID 被 echo/turn_started 折叠丢失时，ack 不能静默 return。
 * （2026-10-20 用户：发送成功仍永久显示发送中。）
 */
declare const process: { exit: (c: number) => void };
import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState, nonEmptyStr, UserRow } from '../../entry/src/main/ets/core/chat_types_full';
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); }
}
const row: UserRow = {
  id: 'local-r1', content: '你好' as never, timestamp: 't', isNotification: false,
  queued: false, sending: true, requestID: 'r1', turnHint: undefined, dbID: undefined,
};
let s = initialChatState('chat');
s = reduce(s, { type: 'user_sent', row });
ok('发送后 pending sending=true', s.pendingUsers.length === 1 && s.pendingUsers[0].sending === true);
// 模拟 requestID 在 echo/turn_started 折叠中丢失后的迟到 ack。
s = reduce(s, { type: 'user_ack', requestID: 'different', dbID: 1, queued: false, command: false });
ok('requestID 失配时 ack 仍必须清掉最早的 sending（FIFO 权威）',
  s.pendingUsers.length === 1 && s.pendingUsers[0].sending === false);
console.log(`send_ack_fallback: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
