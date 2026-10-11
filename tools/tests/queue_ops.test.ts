/**
 * 队列操作（`core/store.ets` 的 `clearQueue` / `interjectQueued`）的判别力测试。
 *
 * 逐字对齐 web：
 *   · `useChatMessages.ts:899-920 interjectQueued`（先 `POST /api/queue/cancel`，再以 interrupt=true 重发）；
 *   · `AgentPanel.tsx:1108-1110 onClear`（遍历 queue 逐个 cancel —— 无 clear 端点）。
 * 用**注入式假 client**（打桩 `store.http.post/postAs`）断言**调用序列**与请求体。
 *
 * ⛔ 两个真坑：
 *   ① interject 必须用**完整 content**（不得用截断的 preview）；
 *   ② cancel 返回 `{cancelled:false, already_processing:true}` **不是错误**，必须继续 send。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { QueueItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

interface Call { path: string; body: Record<string, unknown>; }

/**
 * 打桩 `store.http`：POST `/api/queue/cancel` 恒返回 `{cancelled:false, already_processing:true}`
 * （服务端"已被 dequeue 正在处理"的真实回执 —— 必须**不**被当失败）；`/api/message` 返回 msgAck。
 */
function fakeHttp(store: ChatStore, msgAck: string): Call[] {
  const calls: Call[] = [];
  const h = store.http as unknown as {
    post: (p: string, b: object) => Promise<string>;
    postAs: (p: string, b: object) => Promise<object>;
  };
  h.post = (p: string, b: object): Promise<string> => {
    calls.push({ path: p, body: b as Record<string, unknown> });
    if (p === '/api/message') { return Promise.resolve(msgAck); }
    if (p === '/api/queue/cancel') {
      return Promise.resolve('{"cancelled":false,"already_processing":true}');
    }
    return Promise.resolve('{}');
  };
  h.postAs = (p: string, b: object): Promise<object> => {
    calls.push({ path: p, body: b as Record<string, unknown> });
    if (p === '/api/queue/list') { return Promise.resolve({ items: [] }); }
    return Promise.resolve({});
  };
  return calls;
}

async function main(): Promise<void> {
  // ① clearQueue：可寻址项**逐个** cancel（msg_id 优先，回落 id；不可寻址跳过）
  {
    const store = new ChatStore('http://127.0.0.1:9');
    store.currentChatId = 'chat_1';
    store.queue = [
      { msg_id: 'q1', content: 'c1' } as QueueItem,
      { id: 'q2', content: 'c2' } as QueueItem,      // msg_id 缺失 ⇒ 回落 id
      { msg_id: '', id: '', content: 'c3' } as QueueItem,  // 不可寻址 ⇒ 跳过
    ];
    const calls = fakeHttp(store, '{}');
    await store.clearQueue();
    const cancels = calls.filter((c) => c.path === '/api/queue/cancel');
    eq('clearQueue 逐个 cancel（可寻址 2 条）', cancels.map((c) => c.body.msg_id), ['q1', 'q2']);
    eq('每条 cancel 带 channel/chat_id',
      cancels.map((c) => [c.body.channel, c.body.chat_id]), [['web', 'chat_1'], ['web', 'chat_1']]);
  }

  // ② interjectQueued：先 cancel → （loadQueue）→ send(interrupt=true)，content 用完整内容
  {
    const store = new ChatStore('http://127.0.0.1:9');
    store.currentChatId = 'chat_1';
    const calls = fakeHttp(store, '{"interrupted":true}');
    const FULL = 'A'.repeat(120) + ' —— 完整内容（超过 server preview 的 ~80 runes 截断）';
    const got = await store.interjectQueued('q1', FULL);
    eq('interject 返回 interrupted=true', got, true);
    eq('调用序列：cancel → queue/list → message',
      calls.map((c) => c.path), ['/api/queue/cancel', '/api/queue/list', '/api/message']);
    const msg = calls.find((c) => c.path === '/api/message');
    ok('确实发出了 /api/message', msg !== undefined);
    eq('message.interrupt = true', msg !== undefined ? msg.body.interrupt : undefined, true);
    eq('message.content = 完整内容（非 preview）', msg !== undefined ? msg.body.content : undefined, FULL);
  }

  // ③ ★ already_processing=true 不是失败：cancelled=false 仍继续 send 并成功
  {
    const store = new ChatStore('http://127.0.0.1:9');
    store.currentChatId = 'chat_1';
    const calls = fakeHttp(store, '{"interrupted":true}');
    const r = await store.interjectQueued('q1', 'x');
    eq('already_processing 仍继续 send 并成功', r, true);
    ok('cancel 之后确实发出了 message', calls.some((c) => c.path === '/api/message'));
  }

  // ④ 会话空闲被服务端降级 ⇒ interrupted=false 如实返回（不是错误）
  {
    const store = new ChatStore('http://127.0.0.1:9');
    store.currentChatId = 'chat_1';
    fakeHttp(store, '{"interrupted":false}');
    eq('服务端降级 ⇒ 返回 false', await store.interjectQueued('q1', 'x'), false);
  }

  // ⑤ 空队列 ⇒ 一个 cancel 都不发
  {
    const store = new ChatStore('http://127.0.0.1:9');
    store.currentChatId = 'chat_1';
    store.queue = [];
    const calls = fakeHttp(store, '{}');
    await store.clearQueue();
    eq('空队列 ⇒ 无 cancel 请求', calls.filter((c) => c.path === '/api/queue/cancel').length, 0);
  }

  if (fail > 0) { console.log(`  queue_ops: ${pass} passed, ${fail} failed`); process.exit(1); }
  console.log(`  queue_ops: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();
