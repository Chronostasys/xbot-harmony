"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const streammerge_1 = require("./streammerge");
const indicators_1 = require("./indicators");
const CHAT = 'chat-1';
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
function readWiring() {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..', '..', '..'); // <repo>/tools/tests/.out/js → 4 级
    const indexSrc = fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
    const smSrc = fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'ets', 'core', 'streammerge.ets'), 'utf-8');
    return {
        pageInFlight: /tailShowsIndicator:\s*this\.hasLiveRow\s*&&\s*rowHasInFlightSignal\(/.test(indexSrc),
        pageRowNonEmpty: /tailShowsIndicator:\s*this\.hasLiveRow\s*&&\s*!rowIsEmpty\(/.test(indexSrc),
        fnExists: /export\s+function\s+rowHasInFlightSignal\s*\(/.test(smSrc),
    };
}
// ─────────────── 独立 oracle（对齐渲染规则，不引用生产判据）─────────────────
/**
 * 尾部行是否正在渲染「在飞信号」—— 独立 oracle，逐条对齐 `MessageRow.ets` /
 * `LiveTailView.ets` 的画法：只有末尾 `live:true` 块里的 思考头/正文/工具 才是
 * 「进行中」可见信号；**已提交迭代块不算**（它们是历史）。
 */
function oracleInFlight(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        const it = row.iterations[i];
        if (it.live === true) {
            const hasReasoning = (0, streammerge_1.displayReasoning)(it).length > 0;
            const hasContent = (0, streammerge_1.displayContent)(it).length > 0;
            const hasTools = it.tools !== undefined && it.tools.length > 0;
            return hasReasoning || hasContent || hasTools;
        }
    }
    return false;
}
/** 独立渲染 oracle：这一行"到底画出多少字符"（与 p0_tail_visibility 同款）。 */
function renderVisibleChars(row) {
    let n = 0;
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
        n += ((0, streammerge_1.displayReasoning)(live).length > 0 ? 1 : 0) + (0, streammerge_1.displayContent)(live).length
            + (live.tools !== undefined && live.tools.length > 0 ? 1 : 0);
    }
    return n;
}
// ─────────────── store 接线 + 页面信号同构 ───────────────
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
/**
 * 页面 `busySignals()` 的同构 —— `tailShowsIndicator` 按生产**当前实际体现的语义**算：
 * 生产源码用「在飞信号」⇒ 用独立 oracle；仍用「行非空」⇒ 用 `!rowIsEmpty`（= 生产判据本身）。
 */
function pageSignals(store, w) {
    const live = liveRowOf(store);
    const hasLiveRow = live !== undefined;
    const tail = !hasLiveRow
        ? false
        : (w.pageInFlight ? oracleInFlight(live) : !(0, streammerge_1.rowIsEmpty)(live));
    return {
        localBusy: store.busy,
        liveHasContent: store.hasLiveRowWithContent(),
        tailShowsIndicator: tail,
        freshServerRunning: false,
        loading: false,
        rowsLen: store.rows.length,
    };
}
const P = (progress) => ({ chat_id: CHAT, progress });
async function main() {
    const w = readWiring();
    console.log('\n▶ ① 迭代空隙必须显示「思考中」（判据 = 尾部正在渲染在飞信号）');
    console.log(`   [源码判据] 页面用在飞信号=${w.pageInFlight} 页面仍用行非空=${w.pageRowNonEmpty}`
        + ` 生产 rowHasInFlightSignal=${w.fnExists}`);
    check('G1 生产 busySignals().tailShowsIndicator 采用「在飞信号」判据（非「行非空」）', w.pageInFlight && w.fnExists && !w.pageRowNonEmpty, `pageInFlight=${w.pageInFlight} fnExists=${w.fnExists} pageRowNonEmpty=${w.pageRowNonEmpty}`
        + ` —— 「行非空」含已提交迭代块 ⇒ 空隙时占位被抑制`);
    const store = new store_1.ChatStore('http://127.0.0.1:9');
    const w0 = wire(store);
    await store.send('跑个长任务');
    const step = (label, opts) => {
        const live = liveRowOf(store);
        const s = pageSignals(store, w);
        const visible = live !== undefined ? renderVisibleChars(live) : -1;
        const ph = (0, indicators_1.showsBusyPlaceholder)(s);
        console.log(`  [${label}] 渲染可见=${visible} 占位=${ph} 尾部信号=${s.tailShowsIndicator}`
            + ` busyNow=${(0, indicators_1.busyNow)(s)}`);
        // (G3) 不变量：有 live 行时必须「可见内容 > 0 或 占位」——绝不允许两者皆假。
        //      无 live 行时（不在跑 / 还没建行）由占位或非 busy 承担。
        const g3 = live === undefined ? (ph || !(0, indicators_1.busyNow)(s)) : (visible > 0 || ph);
        check(`G3 ${label}`, g3, `渲染可见=${visible} 占位=${ph} busyNow=${(0, indicators_1.busyNow)(s)}`
            + ` —— 绝不允许"两者皆假"`);
        if (opts.gap === true) {
            // (G2) 用户点名：迭代空隙期间「思考中」占位必须出现。
            check(`G2 ${label} 空隙必须显示「思考中」`, ph === true, `空隙期间占位=${ph}（尾部信号=${s.tailShowsIndicator}）—— 用户要求空隙显示「思考中」`);
        }
        if (opts.expectTail === true) {
            // (G4) 下一迭代在飞内容到达 ⇒ 占位让位（恰好一个指示器）。
            check(`G4 ${label} 在飞内容到达 ⇒ 占位让位`, ph === false && s.tailShowsIndicator === true, `占位=${ph} 尾部信号=${s.tailShowsIndicator} —— 在飞内容到达后必须由尾部承担信号`);
        }
    };
    w0.emit('progress_structured', P({
        turn_id: 5, phase: 'turn_started', seq: 2,
        turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' },
    }));
    step('turn_started', {});
    w0.emit('progress_structured', P({
        turn_id: 5, phase: 'iteration', seq: 3, iteration: 1,
        iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }],
    }));
    step('iter1 在飞快照（空）', {});
    w0.emit('progress_structured', P({
        turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一',
    }));
    step('iter1 正文流式', {});
    // ── iter1 commit：内容进 iterations（权威快照）⇒ 已完成块（历史），非在飞 ──
    w0.emit('progress_structured', P({
        turn_id: 5, phase: 'iteration', seq: 5, iteration: 1,
        iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
    }));
    step('iter1 commit', {});
    // ── 空隙：无任何 iter2 事件（用户在意的"迭代之间"）──
    step('空隙（iter1 完成、iter2 未到）', { gap: true });
    // ── iter2 首个 delta 到达 ──
    w0.emit('progress_structured', P({
        turn_id: 5, seq: 6, iteration: 2, stream_content: '第二段',
    }));
    step('iter2 正文到达', { expectTail: true });
    console.log(`\n  iter_gap_indicator: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
