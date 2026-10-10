/**
 * P0 不变量（用户 2026-10-10 真机回归）：
 *   「现在彻底看不到所有进度了，发送完了连思考中都没来」
 *   —— 形式化：**composer 显示"停止"（busy）⟹ 列表尾部必须有一个可见的
 *      "进行中"信号**（「思考中…」占位，或 live 行自身渲染出的在飞内容）。
 *
 * 根因（页面层，非 store 层）：
 *   · composer 的「停止/发送」按钮用 `runningNow()`
 *     = 本地 busy ∥ 有产出的 live 行 ∥ **新鲜的服务端 running**；
 *   · 列表占位符却用 `this.busy`（= store.busy，**仅本地事件驱动**）。
 *   两个 busy 判据分叉 ⇒ 服务端已 running 但本地 turn_started 未到（SSE 延迟 /
 *   错过 / 刚切到运行中的会话）时，按钮=停止、列表却一片空白 ⇒ 不变量被破坏。
 *   修法（对齐 web）：两者共用 `busyNow`（web 的单一 busy 语义）。
 *
 * 本用例把「composer busy」与「列表是否有信号」钉在同一组信号上，穷举组合断言
 * 不变量；并对真实 store 流水线（send → turn_started → stream）做端到端校验。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import {
  BusySignals,
  busyNow,
  hasRunningSignal,
  showsBusyPlaceholder,
} from './indicators';
import { ChatStore } from './store';
import { rowIsEmpty } from './streammerge';
import { ChatRow } from './types';
import type { SseListener } from './sse';

function sig(over: Partial<BusySignals>): BusySignals {
  return {
    localBusy: false,
    liveHasContent: false,
    tailShowsIndicator: false,
    freshServerRunning: false,
    loading: false,
    rowsLen: 3,
    ...over,
  };
}

describe('P0 不变量：composer busy ⟹ 列表有可见"进行中"信号', () => {
  it('穷举信号组合：busyNow ⟹ (占位符 ∨ 尾部自带信号)', () => {
    const bools: boolean[] = [false, true];
    for (const localBusy of bools) {
      for (const liveHasContent of bools) {
        for (const tailShowsIndicator of bools) {
          for (const freshServerRunning of bools) {
            const o: BusySignals = sig({
              localBusy, liveHasContent, tailShowsIndicator, freshServerRunning,
            });
            const running = busyNow(o);
            const signal = hasRunningSignal(o);
            expect(signal || !running,
              `busy(${JSON.stringify(o)}) 时必须有信号（placeholder=${showsBusyPlaceholder(o)}, tail=${tailShowsIndicator}）`)
              .toBe(true);
          }
        }
      }
    }
  });

  it('回归场景：服务端已 running、本地 turn_started 未到 ⇒ 占位符必须出现', () => {
    // 按钮=停止：runningNow() 因「新鲜的服务端 running」为真。
    const o: BusySignals = sig({ localBusy: false, freshServerRunning: true });
    expect(busyNow(o), 'composer 显示停止（服务端权威 running）').toBe(true);
    // 列表必须给信号（这里是占位符「思考中…」）。
    expect(showsBusyPlaceholder(o), '占位符必须出现（不能只有按钮是停 止）').toBe(true);
  });

  it('恰好一个指示器：尾部 live 行自带信号时占位符让位', () => {
    const o: BusySignals = sig({ localBusy: true, tailShowsIndicator: true });
    expect(busyNow(o), '在跑').toBe(true);
    expect(showsBusyPlaceholder(o), '尾部自带信号 ⇒ 占位符让位（不并存）').toBe(false);
    expect(hasRunningSignal(o), '仍有恰好一个信号（尾部 live 行）').toBe(true);
  });

  it('骨架屏期间不叠加占位符（loading 且 0 行）', () => {
    const o: BusySignals = sig({ localBusy: true, loading: true, rowsLen: 0 });
    expect(showsBusyPlaceholder(o), '空态骨架屏承担反馈').toBe(false);
  });
});

// ── 端到端：真实 store 流水线（send → turn_started → stream）──
// 确保「页面把 store 信号喂给判据后」不变量恒成立。
const CHAT = 'chat-1';

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _body: object): Promise<string> => {
    if (path === '/api/history') {
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

/** 页面会喂给判据的信号（strictly 从 store 派生，不依赖 ArkUI）。 */
function signalsOf(store: ChatStore, freshServerRunning: boolean): BusySignals {
  const live = store.rows.filter((r: ChatRow) => r.isLive);
  const hasLiveRow = live.length > 0;
  return {
    localBusy: store.busy,
    liveHasContent: store.hasLiveRowWithContent(),
    tailShowsIndicator: hasLiveRow && !rowIsEmpty(live[0]),
    freshServerRunning,
    loading: false,
    rowsLen: store.rows.length,
  };
}

describe('P0 端到端：真实 store 流水线上不变量恒成立', () => {
  it('turn_started（live 行空）→ 占位符出现；stream → 让位给在飞内容', async () => {
    const store = new ChatStore('http://127.0.0.1:9');
    const w = wire(store);
    await store.send('你好');

    w.emit('progress_structured', {
      chat_id: CHAT,
      progress: {
        turn_id: 5, phase: 'turn_started', seq: 2,
        turn_start: { trigger: 'user', content: '你好', request_id: 'req-1' },
      },
    });
    const s1 = signalsOf(store, false);
    expect(busyNow(s1), 'turn_started 后在跑').toBe(true);
    expect(showsBusyPlaceholder(s1), 'live 行为空 ⇒ 渲染「思考中…」占位').toBe(true);

    w.emit('progress_structured', {
      chat_id: CHAT,
      progress: { turn_id: 5, phase: 'iteration', seq: 3, iteration: 1, stream_content: 'p1', reasoning: '' },
    });
    const s2 = signalsOf(store, false);
    expect(busyNow(s2), '在跑').toBe(true);
    expect(showsBusyPlaceholder(s2), '在飞内容出现 ⇒ 占位让位').toBe(false);
    expect(s2.tailShowsIndicator, 'live 行自带在飞信号').toBe(true);
  });

  it('服务端 running 但本地未到 ⇒ 占位符（客户端不得像 idle）', async () => {
    const store = new ChatStore('http://127.0.0.1:9');
    wire(store);
    await store.send('你好');
    // 尚无任何 SSE 事件：本地 busy=false，但服务端会话树报 running。
    const s = signalsOf(store, true);
    expect(busyNow(s), 'composer 显示停止').toBe(true);
    expect(showsBusyPlaceholder(s), '列表必须给占位符（真机 P0 根治点）').toBe(true);
  });
});

process.exit(summary('busy_indicator'));
