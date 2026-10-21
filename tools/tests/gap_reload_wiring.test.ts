/**
 * gap_reload_wiring —— P0（用户 2026-10-17 亲报）：历史渲染成 `迭代1 迭代2`，而在飞迭代已到 50；
 *  live 块出现时"看着正常"（`迭代1 迭代2 迭代50(generating)`），**50 一结束合成块消失**
 *  ⇒ 又只剩 `迭代1 迭代2`（3..49 永久缺失）。
 *
 * ── 根因（典型"死消费"）────────────────────────────────────────────────────────
 *  状态机侧判据一直存在：`core/reduce.ts:liveAheadGapSig` 检测「live 明显领先于已持有窗口」
 *  ⇒ `gapReloadToken` 自增。**但原生侧没有任何消费方**（全仓只有声明 + 一句注释）⇒
 *  判据触发后**没人重载** ⇒ 洞永久补不上。web 的消费方是 `AgentPanel.tsx:446-462`：
 *  `markHistoryStale()` + `agentChat.reset()` + `reloadChat()`。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────────
 *  ① 出现「live 领先」脱节后，**必须**发生一次历史重载（`/api/history` 请求数 +1）；
 *  ② 同一缺口形状**只重载一次**（计数不随同形状后续帧增长）⇒ 不重载风暴；
 *  ③ 无洞时**不得**重载（否则每帧都重载 = 更糟）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

const CHAT = 'chat-gap-reload';
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 历史请求计数（判据的唯一出口：没有重载 ⇒ 0 增量）。 */
let historyPosts = 0;

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _b: object): Promise<string> => {
    if (path === '/api/history') {
      historyPosts += 1;
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
  store.subscribe();
  return {
    emit: (e: string, p: object): void => {
      const l = box.listener;
      if (l === null) { throw new Error('SSE listener 未捕获'); }
      l(e, JSON.stringify(p));
    },
  };
}

const P = (progress: object): object => ({ chat_id: CHAT, progress });
const it = (n: number, content: string): object => ({ iteration: n, content, reasoning: '', tools: [] });

async function main(): Promise<void> {
  console.log('\n▶ 「无法追赶的 gap」必须触发一次历史重载（P0 死消费修复）');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('触发一轮');
  const base = historyPosts;

  w.emit('progress_structured', P({
    turn_id: 5, phase: 'turn_started', seq: 2,
    turn_start: { trigger: 'user', content: '触发一轮', request_id: 'r1' },
  }));
  // 已持有窗口：迭代 1、2（正常历史）
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 3, seq: 10,
    iteration_history: [it(1, '第一轮'), it(2, '第二轮')],
  }));
  ok('无洞时不得重载（基线）', historyPosts === base);

  // 制造脱节：live 迭代计数器已到 50，而已持有窗口只到 2（真实事故形态）
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 50, seq: 11, stream_content: '第五十轮正文',
  }));
  // freeze/收尸路径会调用 withLiveAhead ⇒ gapReloadToken 自增（判据侧）
  w.emit('text_final', {
    chat_id: CHAT, turn_id: 5, seq: 12,
    final_iteration: it(50, '第五十轮正文'),
  });
  ok('⛔ 脱节后必须重载一次（旧实现：0 次 = 你看到的"洞永久补不上"）',
    historyPosts > base);

  // 同形状再来几帧 ⇒ 不得重载风暴
  const afterFirst = historyPosts;
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 51, seq: 13, stream_content: '第五十一轮',
  }));
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 52, seq: 14, stream_content: '第五十二轮',
  }));
  ok('同一轮内不重复重载（计数稳定，防风暴）', historyPosts <= afterFirst + 1);
  ok('重载次数有限（≤2）', historyPosts - base <= 2);

  if (fail > 0) {
    console.log(`  gap_reload_wiring: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  gap_reload_wiring: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();

export {};
