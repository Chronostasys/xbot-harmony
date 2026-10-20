/**
 * demo_account —— AppGallery 审核账号：纯本地演示，不访问真实服务端。
 *
 * 判据：
 *  1. 固定账号/密码可识别；
 *  2. 登录后自动有 3 个 demo 会话；
 *  3. 打开 demo 会话有固定内容；
 *  4. 任意输入触发**完全相同**的演示回复（不依赖网络）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { DEMO_ANSWER, DEMO_PASSWORD, DEMO_USERNAME, isDemoLogin, demoSessions } from '../../entry/src/main/ets/core/demo';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

async function main(): Promise<void> {
  console.log('\n▶ AppGallery 演示账号');
  ok('固定账号可识别', isDemoLogin(DEMO_USERNAME, DEMO_PASSWORD));
  ok('错误密码不可识别', !isDemoLogin(DEMO_USERNAME, 'wrong'));
  ok('自动有 3 个 demo 会话', demoSessions().length === 3);
  ok('demo 文案包含 MIT 开源说明', DEMO_ANSWER.includes('MIT') && DEMO_ANSWER.includes('开源'));

  const store = new ChatStore('https://demo.local');
  store.enableDemo();
  await store.loadSessions();
  ok('loadSessions 自动下发 demo 会话', store.sessions.length === 3);
  await store.openSession('demo-welcome', 'web');
  ok('打开 demo 会话有固定消息', store.rows.length > 0);
  ok('demo 正文可渲染', store.rows.some((r) => String(r.content ?? '').includes('本地演示会话')));

  const before = store.rows.length;
  await store.send('任意输入都触发同样回复');
  ok('发送后新增用户/助手行', store.rows.length > before);
  const texts = store.rows.map((r) => String(r.content ?? '')).join('\n');
  ok('任意输入都得到同一段演示正文', texts.includes(DEMO_ANSWER));
  ok('demo 不进入 busy', store.busy === false);

  if (fail > 0) {
    console.log(`  demo_account: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  demo_account: ${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch((e: Error) => {
  console.log(`  demo_account: 异常 ${e.message}`);
  process.exit(1);
});
