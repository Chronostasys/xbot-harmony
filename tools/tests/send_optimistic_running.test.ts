/**
 * P0（用户 2026-10-17）：「mid-turn idle 冻结」的**根因层**判别力测试。
 *
 * ── 症状 ──────────────────────────────────────────────────────────────────────
 *   turn 进行中，live 进度突然消失且**永不再更新**（同迭代 stream 被静默丢弃）。
 *
 * ── 根因（wiring，非状态机逻辑）────────────────────────────────────────────────
 *   `reduce.ts` 的粗粒度 idle 闸门是 `if (s.sessionRunning) return s`（与 web 逐字一致）；
 *   `store.ets` 的 `applyLocalIdle` 非权威闸门同理。它要求 **turn 进行中
 *   `state.sessionRunning === true`**。而原生此前**没有** web 的这一步：
 *   web `AgentPanel.tsx:177-180` 在发送成功后 `store.setStatus(selector,'running')`
 *   （受 `sendStartsTurn` 门控）⇒ sessionRunning 在 turn 中即为 true ⇒ 迟到/回放的
 *   `session(idle)` 被闸门忽略。原生缺它 ⇒ sessionRunning 恒 false ⇒ 一条迟到 idle
 *   就把在飞 turn 冻结（`noteTurndrop('idleFroze')`），后续同迭代 stream 被整批丢弃。
 *
 * ── 钉什么（端到端：真实 store 流水线，非 mock 状态机）──────────────────────────
 *   ① 发送成功后 **store.serverRunning 立刻为 true**（乐观置位）；← 缺它此用例红
 *   ② 迟到/回放的 coarse idle（`agent-idle`）**不得**冻结在飞 turn（hasLiveTurn 仍 true）；
 *   ③ 同迭代 stream 仍能更新 live 内容（未被静默丢弃）；
 *   ④ 命令回执（无 turn_id、未排队）**不得**乐观置位（否则永久卡 busy）；排队回执 ⇒ 置位。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { liveProgressFromState } from '../../entry/src/main/ets/core/integrate';
import type { ChatState } from '../../entry/src/main/ets/core/chat_types_full';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const CHAT = 'chat-1';

/** 接线：stub HTTP + 捕获 SSE listener（与 busy_indicator.test.ts 同款）。 */
function wire(store: ChatStore, msgAck: object): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _body: object): Promise<string> => {
    if (path === '/api/history') {
      return Promise.resolve(JSON.stringify({
        chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0,
      }));
    }
    return Promise.resolve(JSON.stringify(msgAck));
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

/** 直接从状态机快照取 live 流式内容（不依赖行派生的滞后）。 */
function streamContentOf(store: ChatStore): string {
  const st = (store as unknown as { state: ChatState }).state;
  return liveProgressFromState(st).streamContent;
}

function turnStarted(turn: number, rid: string): object {
  return {
    chat_id: CHAT,
    progress: {
      turn_id: turn, phase: 'turn_started', seq: 2,
      turn_start: { trigger: 'user', content: '你好', request_id: rid },
    },
  };
}

function stream(turn: number, iter: number, content: string): object {
  return {
    chat_id: CHAT,
    progress: { turn_id: turn, phase: '', iteration: iter, stream_content: content },
  };
}

async function main(): Promise<void> {
  // ── ① + ② + ③ 端到端：正常发送 ⇒ 乐观 running ⇒ mid-turn 迟到 idle 不冻结 ─────────
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store, { message_id: 7, turn_id: 5, queued: false });

  await store.send('你好');
  ok('① 发送成功后乐观置 running（serverRunning=true）', store.serverRunning === true);
  ok('① 乐观置位后 busy 立刻为 true（输入框 = cancel）', store.busy === true);

  w.emit('progress_structured', turnStarted(5, 'req-1'));
  w.emit('progress_structured', stream(5, 1, '初始输出'));
  ok('turn 进入 live', store.hasLiveTurn() === true);
  ok('live 内容已写入', streamContentOf(store).includes('初始输出'));

  // 迟到/回放的 coarse 会话级 `session(idle)` —— 它会产出 `session{busy:false}` 事件，
  // 命中 reduce 的粗粒度 idle 分支（`if (s.sessionRunning) return s`）—— turn 仍在跑 ⇒ 必须被忽略。
  w.emit('session', { chat_id: CHAT, session: { channel: 'web', chat_id: CHAT, action: 'idle' } });
  ok('② mid-turn 迟到 idle 不得冻结在飞 turn（仍 live）', store.hasLiveTurn() === true);
  ok('② 迟到 idle 后 busy 仍为 true（闸门生效）', store.busy === true);
  // 同样：coarse `agent-idle`（走 applyLocalIdle）也不得冻结在飞 turn。
  w.emit('session', { chat_id: CHAT, session: { channel: 'web', chat_id: CHAT, action: 'agent-idle' } });
  ok('②b agent-idle 同样不得冻结在飞 turn', store.hasLiveTurn() === true);

  // ③ 同迭代 stream 必须仍能更新 live 内容（否则就是"进度消失且永不再更新"）。
  w.emit('progress_structured', stream(5, 1, '继续输出'));
  ok('③ 同迭代 stream 仍被应用（未被静默丢弃）', streamContentOf(store).includes('继续输出'));

  // ── ④ 命令/失败回执（无 turn_id、未排队）⇒ 不乐观置位 ─────────────────────────
  const store2 = new ChatStore('http://127.0.0.1:9');
  wire(store2, { message_id: 8, queued: false, command: true });
  await store2.send('!pwd');
  ok('④ 命令回执（无 turn_id）不得乐观置 running', store2.serverRunning === false);

  const store3 = new ChatStore('http://127.0.0.1:9');
  wire(store3, { message_id: 9, turn_id: 11, queued: true });
  await store3.send('排队消息');
  ok('④b 排队回执（queued）乐观置 running（终将开启 turn）', store3.serverRunning === true);

  // ── ⑤ 权威 idle（cancel 成功）⇒ busy 必须退出（即使 live turn 保留）──────────────
  //   idle 新语义：只停 streaming、保留 activeTurn（为了不丢同迭代后续帧）。
  //   若 busy 仍以 activeTurn/内容为准，这里会永久卡 cancel（用户症状）。
  const store4 = new ChatStore('http://127.0.0.1:9');
  const w4 = wire(store4, { message_id: 11, turn_id: 7, queued: false });
  await store4.send('你好');
  w4.emit('progress_structured', turnStarted(7, 'req-7'));
  w4.emit('progress_structured', stream(7, 1, '进行中'));
  ok('⑤ 权威 idle 前 busy=true', store4.busy === true);
  await store4.cancel();
  ok('⑤ cancel（权威 idle）后 busy=false（不卡 cancel）', store4.busy === false);
  ok('⑤b live turn 仍保留（同迭代后续帧仍可应用）', store4.hasLiveTurn() === true);
  w4.emit('progress_structured', stream(7, 1, '进行中+续写'));
  ok('⑤c 停流后同迭代 stream 仍被应用（不冻结丢帧）', streamContentOf(store4).includes('续写'));

  console.log(`  send-optimistic-running: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
