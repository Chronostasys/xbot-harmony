/**
 * turn_end_busy_resync —— 用户 2026-10-20 P0：
 *   「一个 turn 已经结束了，会话还是 busy ⇒ 一定要 resync；busy 只能是之后的 turn。」
 *
 * 根因：`text_final` 是该 turn 的权威 finalizer，但 reduce 在「turn 已 committed/
 * 已 frozen」时可能走幂等短路；如果此时 `sessionRunning` 仍为 true，busy 没有任何
 * 本地出路（只有等下一次 idle/30s 轮询）⇒ 用户看到回复结束仍在思考中。
 *
 * 判据：finalizer 落在「已无 activeTurn / activeTurn 仍是该 turn」时，必须发起一次
 * 权威 history 重载（resync）。已有后续 turn 时**不得**重载。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

const CHAT = 'chat-turn-end-busy';
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

let historyPosts = 0;

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _b: object): Promise<string> => {
    if (path === '/api/history') {
      historyPosts++;
      return Promise.resolve(JSON.stringify({
        chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0,
      }));
    }
    return Promise.resolve(JSON.stringify({ message_id: 7, turn_id: 5, queued: false }));
  };
  const sseAny = store.sse as unknown as {
    connect: (c: string, ch: string, ck: string, l: SseListener) => void;
  };
  sseAny.connect = (_c: string, _ch: string, _ck: string, l: SseListener): void => {
    box.listener = l;
  };
  store.currentChatId = CHAT;
  store.setResumeActive(true);
  store.subscribe();
  return {
    emit: (e: string, p: object): void => {
      const l = box.listener;
      if (l === null) { throw new Error('SSE listener 未捕获'); }
      l(e, JSON.stringify(p));
    },
  };
}

const FINAL = {
  chat_id: CHAT, turn_id: 5, seq: 20, content: '完成',
  final_iteration: { iteration: 1, content: '完成', reasoning: '', tools: [] },
};

async function main(): Promise<void> {
  console.log('\n▶ turn 结束但仍 busy ⇒ 必须 resync');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('触发');
  w.emit('progress_structured', {
    chat_id: CHAT,
    progress: {
      turn_id: 5, phase: 'turn_started', seq: 2,
      turn_start: { trigger: 'user', content: '触发', request_id: 'r1' },
    },
  });
  // 第一次 finalizer：正常收尾，activeTurn 清空、sessionRunning 应为 false。
  // ⛔ 不能用 store.busy 断言：发送意图窗（8s）也会让 busy=true，那是本地即时反馈。
  w.emit('text', { ...FINAL, seq: 3 });
  ok('正常 finalizer 后权威 sessionRunning=false', store.serverRunning === false);
  const base = historyPosts;

  // 模拟服务端还报 running（用户看到 busy），而 turn 已 committed。
  // 这是“迟到的 text_final / 已提交 turn 重放”会留下的不一致状态。
  (store as unknown as {
    pushEvent: (ev: object) => void;
  }).pushEvent({ type: 'session_running', running: true });

  w.emit('text', { ...FINAL, seq: 4 });
  // `resyncAfterResume` 可能排队（send-ack 的 resync 在飞）⇒ 让出一个 microtask/tick
  await new Promise<void>((resolve) => { setTimeout(resolve, 30); });
  ok('⛔ turn 已结束但仍 busy ⇒ 必须请求一次权威 resync', historyPosts > base);

  // 若已经有后续 turn 占有 activeTurn，则不得因旧 turn 的 finalizer 误重载。
  const store2 = new ChatStore('http://127.0.0.1:9');
  const w2 = wire(store2);
  await store2.send('触发2');
  w2.emit('progress_structured', {
    chat_id: CHAT,
    progress: {
      turn_id: 5, phase: 'turn_started', seq: 2,
      turn_start: { trigger: 'user', content: '触发2', request_id: 'r2' },
    },
  });
  w2.emit('text', { ...FINAL, seq: 3 });
  const before2 = historyPosts;
  (store2 as unknown as { pushEvent: (ev: object) => void })
    .pushEvent({ type: 'turn_started', turnID: 6, requestID: null, trigger: 'notification', content: '后续' });
  (store2 as unknown as { pushEvent: (ev: object) => void })
    .pushEvent({ type: 'session_running', running: true });
  w2.emit('text', { chat_id: CHAT, turn_id: 5, seq: 5, content: '旧回合补发' });
  ok('已有后续 turn 时，旧 finalizer 不得误触发 resync', historyPosts === before2);

  if (fail > 0) {
    console.log(`  turn_end_busy_resync: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  turn_end_busy_resync: ${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch((e: Error) => {
  console.log(`  turn_end_busy_resync: 异常 ${e.message}`);
  process.exit(1);
});
