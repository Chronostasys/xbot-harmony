/**
 * 非 web 会话打开判据（2026-10-19 用户亲报：打开报 session not found）。
 *
 * 根因：`openSession` 在新建 store（`sessions` 为空）时按 `chatId.indexOf(':')` 猜渠道；
 * CLI 会话 id 本身带冒号（`/Users/bobli:Agent-swift-brook`）⇒ 误判成 `/Users/bobli`。
 * 现在页面必须把 `SessionItem.channel` 作为显式 hint 传进 `openSession`。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function raw(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}
const store = raw('entry/src/main/ets/core/store.ets');
const index = raw('entry/src/main/ets/pages/Index.ets');
const openStart = store.indexOf('async openSession(');
const openBody = openStart >= 0 ? store.substring(openStart, openStart + 2600) : '';

ok('openSession 接收显式 channelHint', /async openSession\(chatId: string, channelHint: string = ''\)/.test(store));
ok('openSession 优先使用 channelHint', /channelHint\.length > 0/.test(openBody));
ok('openSession 不再用 chatId 冒号猜渠道', openBody.replace(/\/\/[^\n]*/g, '').indexOf("chatId.indexOf(':')") < 0);
ok('drawer 行点击把 s.channel 传入 switchSession',
  /switchSession\(s\.chat_id,\s*s\.channel !== undefined \? s\.channel : ''\)/.test(index));
ok('switchSession 把 chHint 传入 openSession', /openSession\(chatId, chHint\)/.test(index));
ok('首开首会话传 first.channel',
  /openSession\(first\.chat_id,\s*first\.channel/.test(index));
console.log(`nonweb_session_open: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
