"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const streammerge_1 = require("./streammerge");
const indicators_1 = require("./indicators");
const CHAT = 'chat-1';
/** 独立 oracle：逐条复刻渲染层「到底画出多少字符」。 */
function renderVisibleChars(row) {
    let n = 0;
    // MessageRow.AssistantBlock：row.content 仅在 iterations 为空时画
    if (row.content.length > 0 && row.iterations.length === 0)
        n += row.content.length;
    let live = undefined;
    for (let i = 0; i < row.iterations.length; i++) {
        const it = row.iterations[i];
        if (it.live === true) {
            if (live === undefined)
                live = it;
            continue;
        }
        n += (0, streammerge_1.displayContent)(it).length
            + (it.tools !== undefined && it.tools.length > 0 ? 1 : 0)
            + ((0, streammerge_1.displayReasoning)(it).length > 0 ? 1 : 0);
    }
    if (live !== undefined) {
        // LiveTailView：reasoning>0 ⇒ 思考头(1)；text>0 ⇒ 正文；tools>0 ⇒ pill(1)
        n += ((0, streammerge_1.displayReasoning)(live).length > 0 ? 1 : 0) + (0, streammerge_1.displayContent)(live).length
            + (live.tools !== undefined && live.tools.length > 0 ? 1 : 0);
    }
    return n;
}
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
function liveRowOf(store) {
    for (let i = 0; i < store.rows.length; i++) {
        if (store.rows[i].isLive)
            return store.rows[i];
    }
    return undefined;
}
/** 页面 `busySignals()` 的同构（只读 store，不依赖 ArkUI）。 */
function pageSignals(store) {
    const live = liveRowOf(store);
    return {
        localBusy: store.busy,
        liveHasContent: store.hasLiveRowWithContent(),
        tailShowsIndicator: live !== undefined && !(0, streammerge_1.rowIsEmpty)(live),
        freshServerRunning: false,
        loading: false,
        rowsLen: store.rows.length,
    };
}
const P = (progress) => ({ chat_id: CHAT, progress });
const TS = {
    turn_id: 5, phase: 'turn_started', seq: 2,
    turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' },
};
let pass = 0;
let fail = 0;
function check(label, cond, detail) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${label}: ${detail}`);
    }
}
async function main() {
    console.log('\n▶ P0 联合不变量：尾部必须有可见「进行中」信号（判据 ∩ 渲染 同源）');
    const store = new store_1.ChatStore('http://127.0.0.1:9');
    const w = wire(store);
    await store.send('跑个长任务');
    let prevVisible = -1;
    let sawInFlightContent = false;
    const step = (label, atLeast, inFlight) => {
        const live = liveRowOf(store);
        const s = pageSignals(store);
        const visible = live !== undefined ? renderVisibleChars(live) : -1;
        const ph = (0, indicators_1.showsBusyPlaceholder)(s);
        const prod = live !== undefined && !(0, streammerge_1.rowIsEmpty)(live);
        console.log(`  [${label}] 渲染可见=${visible} 占位=${ph} 判据(非空)=${prod} busyNow=${(0, indicators_1.busyNow)(s)}`);
        // (I1) 尾部可见内容 > 0  ∨  占位出现
        // 无 live 行时：不在跑 ⇒ 无需信号；在跑 ⇒ 必须由占位符承担（列表空态的唯一信号）。
        const i1 = live === undefined ? (ph || !(0, indicators_1.busyNow)(s)) : (visible > 0 || ph);
        check(label, i1, `尾部可见内容=${visible} 占位=${ph} busyNow=${(0, indicators_1.busyNow)(s)}`
            + ` —— 绝不允许"两者皆假"（占位让位、渲染空白）`);
        // (I2) 同源：判据说"有内容" ⟺ 渲染确实画出内容
        check(label, prod === (visible > 0), `判据(非空)=${prod} 但渲染可见=${visible} —— 判据与渲染必须同源`);
        // (I2') 同源的最强形式：生产的「尾部可见内容量」纯函数 == 独立渲染 oracle
        if (live !== undefined) {
            check(label, (0, streammerge_1.rowVisibleChars)(live) === visible, `rowVisibleChars(${(0, streammerge_1.rowVisibleChars)(live)}) ≠ 渲染 oracle(${visible}) —— 判据函数必须与渲染逐字符同源`);
        }
        // (I3) **在飞期间**单调不减（commit 是权威快照替换在飞草稿，不在此列）
        if (inFlight) {
            check(label, visible >= prevVisible || visible < 0, `在飞期间可见内容量回退：${prevVisible} → ${visible}`);
        }
        if (visible > 0) {
            sawInFlightContent = true;
        }
        if (visible >= 0) {
            prevVisible = visible;
        }
        if (live !== undefined) {
            check(label, visible >= atLeast, `可见内容量应 ≥ ${atLeast}，实为 ${visible}`);
        }
    };
    step('send（乐观发出）', 0, true);
    w.emit('progress_structured', P(TS));
    step('turn_started（live 行空 ⇒ 占位）', 0, true);
    // ── 首条 SSE：服务端把「在飞迭代快照（空）」并入 iteration_history，随后流式帧推进 ──
    // （web_hub 的 structuredProgress 会在迭代边界/工具相变时把当前在飞迭代记进
    //   iteration_history；此时 iteration 号 == maxCompleted ⇒ 在飞块被 render.ets
    //   的 `lastIter > maxCompleted` 守卫挡掉 —— P0 的机制就在这里）
    w.emit('progress_structured', P({
        turn_id: 5, phase: 'iteration', seq: 3, iteration: 1,
        iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }],
    }));
    step('第一条 SSE（在飞迭代快照，空）', 0, true);
    w.emit('progress_structured', P({
        turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一',
    }));
    step('第二条 SSE（正文「思考一」到达 ⇒ 必须可见）', 1, true);
    w.emit('progress_structured', P({
        turn_id: 5, seq: 5, iteration: 1, stream_content: '思考一思考二',
    }));
    step('第三条 SSE（正文变长）', 1, true);
    w.emit('progress_structured', P({
        turn_id: 5, seq: 6, iteration: 1, reasoning_stream_content: '推理推理推理',
    }));
    step('第四条 SSE（推理流）', 1, true);
    // ── 迭代 commit：内容进 iterations（权威快照）──
    w.emit('progress_structured', P({
        turn_id: 5, phase: 'iteration', seq: 7, iteration: 1,
        iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
    }));
    step('iter1 commit（内容进迭代）', 1, false);
    w.emit('progress_structured', P({
        turn_id: 5, phase: 'done', seq: 8, iteration: 1,
        iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
    }));
    step('phase_done', 1, false);
    w.emit('text', { chat_id: CHAT, turn_id: 5, content: '最终回复' });
    console.log('  [text_final] live 行已提交（committed，内容在迭代内）');
    // (I3) 在飞期间必须真的见到过可见内容（不得 0 → commit 才跳变）
    check('I3-在飞可见', sawInFlightContent, '在飞期间从未出现可见内容（0 → commit 才跳变）');
    console.log(`  p0_tail_visibility: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
