"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_shim_1 = require("./vitest_shim");
const indicators_1 = require("./indicators");
const store_1 = require("./store");
const streammerge_1 = require("./streammerge");
function sig(over) {
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
(0, vitest_shim_1.describe)('P0 不变量：composer busy ⟹ 列表有可见"进行中"信号', () => {
    (0, vitest_shim_1.it)('穷举信号组合：busyNow ⟹ (占位符 ∨ 尾部自带信号)', () => {
        const bools = [false, true];
        for (const localBusy of bools) {
            for (const liveHasContent of bools) {
                for (const tailShowsIndicator of bools) {
                    for (const freshServerRunning of bools) {
                        const o = sig({
                            localBusy, liveHasContent, tailShowsIndicator, freshServerRunning,
                        });
                        const running = (0, indicators_1.busyNow)(o);
                        const signal = (0, indicators_1.hasRunningSignal)(o);
                        (0, vitest_shim_1.expect)(signal || !running, `busy(${JSON.stringify(o)}) 时必须有信号（placeholder=${(0, indicators_1.showsBusyPlaceholder)(o)}, tail=${tailShowsIndicator}）`)
                            .toBe(true);
                    }
                }
            }
        }
    });
    (0, vitest_shim_1.it)('回归场景：服务端已 running、本地 turn_started 未到 ⇒ 占位符必须出现', () => {
        // 按钮=停止：runningNow() 因「新鲜的服务端 running」为真。
        const o = sig({ localBusy: false, freshServerRunning: true });
        (0, vitest_shim_1.expect)((0, indicators_1.busyNow)(o), 'composer 显示停止（服务端权威 running）').toBe(true);
        // 列表必须给信号（这里是占位符「思考中…」）。
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(o), '占位符必须出现（不能只有按钮是停 止）').toBe(true);
    });
    (0, vitest_shim_1.it)('恰好一个指示器：尾部 live 行自带信号时占位符让位', () => {
        const o = sig({ localBusy: true, tailShowsIndicator: true });
        (0, vitest_shim_1.expect)((0, indicators_1.busyNow)(o), '在跑').toBe(true);
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(o), '尾部自带信号 ⇒ 占位符让位（不并存）').toBe(false);
        (0, vitest_shim_1.expect)((0, indicators_1.hasRunningSignal)(o), '仍有恰好一个信号（尾部 live 行）').toBe(true);
    });
    (0, vitest_shim_1.it)('骨架屏期间不叠加占位符（loading 且 0 行）', () => {
        const o = sig({ localBusy: true, loading: true, rowsLen: 0 });
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(o), '空态骨架屏承担反馈').toBe(false);
    });
});
// ── 端到端：真实 store 流水线（send → turn_started → stream）──
// 确保「页面把 store 信号喂给判据后」不变量恒成立。
const CHAT = 'chat-1';
function wire(store) {
    const box = { listener: null };
    const httpAny = store.http;
    httpAny.post = (path, _body) => {
        if (path === '/api/history') {
            return Promise.resolve(JSON.stringify({
                chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0,
            }));
        }
        return Promise.resolve(JSON.stringify({ message_id: 7, turn_id: 5, queued: false }));
    };
    const sseAny = store.sse;
    sseAny.connect = (_c, _ch, _ck, l) => {
        box.listener = l;
    };
    store.currentChatId = CHAT;
    store.subscribe();
    return {
        emit: (e, p) => {
            const l = box.listener;
            if (l === null) {
                throw new Error('SSE listener 未捕获');
            }
            l(e, JSON.stringify(p));
        },
    };
}
/** 页面会喂给判据的信号（strictly 从 store 派生，不依赖 ArkUI）。 */
function signalsOf(store, freshServerRunning) {
    const live = store.rows.filter((r) => r.isLive);
    const hasLiveRow = live.length > 0;
    return {
        localBusy: store.busy,
        liveHasContent: store.hasLiveRowWithContent(),
        // 与生产 `busySignals().tailShowsIndicator` 同源（在飞信号，非「行非空」）。
        tailShowsIndicator: hasLiveRow && (0, streammerge_1.rowHasInFlightSignal)(live[0]),
        freshServerRunning,
        loading: false,
        rowsLen: store.rows.length,
    };
}
(0, vitest_shim_1.describe)('P0 端到端：真实 store 流水线上不变量恒成立', () => {
    (0, vitest_shim_1.it)('turn_started（live 行空）→ 占位符出现；stream → 让位给在飞内容', async () => {
        const store = new store_1.ChatStore('http://127.0.0.1:9');
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
        (0, vitest_shim_1.expect)((0, indicators_1.busyNow)(s1), 'turn_started 后在跑').toBe(true);
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(s1), 'live 行为空 ⇒ 渲染「思考中…」占位').toBe(true);
        w.emit('progress_structured', {
            chat_id: CHAT,
            progress: { turn_id: 5, phase: 'iteration', seq: 3, iteration: 1, stream_content: 'p1', reasoning: '' },
        });
        const s2 = signalsOf(store, false);
        (0, vitest_shim_1.expect)((0, indicators_1.busyNow)(s2), '在跑').toBe(true);
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(s2), '在飞内容出现 ⇒ 占位让位').toBe(false);
        (0, vitest_shim_1.expect)(s2.tailShowsIndicator, 'live 行自带在飞信号').toBe(true);
    });
    (0, vitest_shim_1.it)('服务端 running 但本地未到 ⇒ 占位符（客户端不得像 idle）', async () => {
        const store = new store_1.ChatStore('http://127.0.0.1:9');
        wire(store);
        await store.send('你好');
        // 尚无任何 SSE 事件：本地 busy=false，但服务端会话树报 running。
        const s = signalsOf(store, true);
        (0, vitest_shim_1.expect)((0, indicators_1.busyNow)(s), 'composer 显示停止').toBe(true);
        (0, vitest_shim_1.expect)((0, indicators_1.showsBusyPlaceholder)(s), '列表必须给占位符（真机 P0 根治点）').toBe(true);
    });
});
process.exit((0, vitest_shim_1.summary)('busy_indicator'));
