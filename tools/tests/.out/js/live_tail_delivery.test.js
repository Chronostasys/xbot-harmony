"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
const streammerge_1 = require("./streammerge");
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
    const rowSrc = fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');
    return {
        pageState: /@State\s+liveText\s*:\s*string/.test(indexSrc)
            && /@State\s+liveReasoning\s*:\s*string/.test(indexSrc)
            && /@State\s+liveTools\s*:\s*ToolProgress\[\]/.test(indexSrc),
        syncFn: /private\s+syncLiveTail\s*\(/.test(indexSrc),
        rowProps: /@Prop\s+liveText\s*:\s*string/.test(rowSrc)
            && /@Prop\s+liveReasoning\s*:\s*string/.test(rowSrc)
            && /@Prop\s+liveTools\s*:\s*ToolProgress\[\]/.test(rowSrc),
        rendersFromProp: /text:\s*this\.liveText/.test(rowSrc),
        paramlessBuilder: /LiveRowBody\s*\(\s*\)/.test(indexSrc)
            && /this\.LiveRowBody\s*\(\s*\)/.test(indexSrc),
    };
}
/**
 * ArkUI V1 组件（live 行）的**重建模型**：持「上次重建时捕获的值快照」；
 * 只有**收到的值**（对象引用 或 @Prop 值）变化时才重建 —— 重建时按当前数据重算。
 * 对同一对象引用的**就地修改**不构成值变化 ⇒ 不重建（R2/R3）。
 */
class LiveRowComponentModel {
    constructor() {
        this.capturedRowRef = undefined;
        this.capturedLive = undefined;
        this.renderedText = '';
        this.updates = 0;
    }
    update(inputs) {
        const liveTuple = inputs.liveText === undefined
            ? undefined
            : `${inputs.liveText}||${inputs.liveReasoning !== undefined ? inputs.liveReasoning : ''}`
                + `||${inputs.liveTools !== undefined ? inputs.liveTools.length : 0}`;
        const refChanged = inputs.rowRef !== this.capturedRowRef;
        const liveChanged = inputs.liveText !== undefined && liveTuple !== this.capturedLive;
        if (!refChanged && !liveChanged) {
            return false; // 无「值变化」⇒ 不重建（R1）
        }
        this.capturedRowRef = inputs.rowRef;
        this.capturedLive = liveTuple;
        this.renderedText = inputs.liveText !== undefined
            ? inputs.liveText
            : liveBlockTextOf(inputs.rowRef); // 重建时读**当前**数据
        this.updates++;
        return true;
    }
}
function liveBlockTextOf(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            return (0, streammerge_1.displayContent)(row.iterations[i]);
        }
    }
    return row.content;
}
function currentLiveText(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            return (0, streammerge_1.displayContent)(row.iterations[i]);
        }
    }
    return '';
}
function currentLiveReasoning(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            return (0, streammerge_1.displayReasoning)(row.iterations[i]);
        }
    }
    return '';
}
function currentLiveTools(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            const t = row.iterations[i].tools;
            return t !== undefined ? t : [];
        }
    }
    return [];
}
function wire(store) {
    const box = { listener: null };
    const httpAny = store.http;
    httpAny.post = (path, _body) => {
        if (path === '/api/history') {
            return Promise.resolve(JSON.stringify({ chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0 }));
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
        if (store.rows[i].isLive) {
            return store.rows[i];
        }
    }
    return undefined;
}
// ─────────────── 主流程 ───────────────
async function main() {
    const w0 = readWiring();
    const production = (w0.pageState && w0.syncFn && w0.rowProps && w0.rendersFromProp)
        ? 'page-state-prop' : 'row-object-only';
    console.log(`\n▶ live 行投递回归：生产接线形态 = ${production}`);
    console.log(`   [源码判据] 页面@State=${w0.pageState} syncLiveTail=${w0.syncFn}`
        + ` 行@Prop=${w0.rowProps} 由@Prop渲染=${w0.rendersFromProp} 无参Builder=${w0.paramlessBuilder}`);
    // Part B：接线判据（生产必须走「值变化」这条唯一可靠的投递路）
    check('B1 页面持有 @State liveText/liveReasoning/liveTools', w0.pageState, 'live 内容没有任何「值变化」驱动重建（P55 回归根因）');
    check('B2 页面每帧同步在飞内容（syncLiveTail）', w0.syncFn, '页面 @State 不会被更新');
    check('B3 MessageRowView 声明 @Prop liveText/liveReasoning/liveTools', w0.rowProps, '页面 @State 无法投递到渲染组件');
    check('B4 在飞块由 @Prop 渲染（LiveTailView 读 this.liveText）', w0.rendersFromProp, '仍在读被就地修改的行对象 —— 不产生「值变化」⇒ 组件不重建');
    check('B5 live 行由无参 @Builder 创建（避免 by-value 参数快照）', w0.paramlessBuilder, 'live 行仍经带参 @Builder（按值传参 = 调用瞬间快照）创建');
    // Part A：投递模型 —— 用**生产实际接线**驱动，断言渲染输入每帧跟上在飞内容
    console.log('▶ Part A：live 组件每帧的渲染输入必须 == 当前在飞内容');
    const store = new store_1.ChatStore('http://127.0.0.1:9');
    const w = wire(store);
    await store.send('跑个长任务');
    const P = (progress) => ({ chat_id: CHAT, progress });
    const comp = new LiveRowComponentModel();
    let sawContent = false;
    let staleFrames = 0;
    let contentFrames = 0;
    const frame = (label) => {
        const live = liveRowOf(store);
        if (live === undefined) {
            return;
        }
        const want = currentLiveText(live);
        if (production === 'page-state-prop') {
            comp.update({
                rowRef: live,
                liveText: currentLiveText(live),
                liveReasoning: currentLiveReasoning(live),
                liveTools: currentLiveTools(live),
            });
        }
        else {
            comp.update({ rowRef: live }); // HEAD：唯一内容输入是恒定引用
        }
        if (want.length > 0) {
            contentFrames++;
            if (comp.renderedText.length > 0) {
                sawContent = true;
            }
            if (comp.renderedText !== want) {
                staleFrames++;
            }
        }
        check(`A ${label}`, comp.renderedText === want, `live 组件渲染输入="${comp.renderedText}" ≠ 当前在飞正文="${want}"`
            + ` —— 内容已到达却画不出（真机「第一条 SSE 到达就消失、中间全空、commit 才出现」）`);
    };
    frame('send');
    w.emit('progress_structured', P({ turn_id: 5, phase: 'turn_started', seq: 2, turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' } }));
    frame('turn_started');
    w.emit('progress_structured', P({ turn_id: 5, phase: 'iteration', seq: 3, iteration: 1, iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }] }));
    frame('iter1-shell');
    w.emit('progress_structured', P({ turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一' }));
    frame('stream-1');
    w.emit('progress_structured', P({ turn_id: 5, seq: 5, iteration: 1, stream_content: '思考一思考二' }));
    frame('stream-2');
    w.emit('progress_structured', P({ turn_id: 5, seq: 6, iteration: 1, reasoning_stream_content: '推理推理推理' }));
    frame('reason-1');
    check('A-E2E 流式期间必须真的把在飞内容画出来（不得 0 → commit 才跳变）', sawContent && staleFrames === 0 && contentFrames > 0, `sawContent=${sawContent} staleFrames=${staleFrames} contentFrames=${contentFrames}`);
    console.log(`   live 组件重建次数=${comp.updates}（HEAD 形态恒为 1 = 仅创建那次）`);
    console.log(`\n  live_tail_delivery: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
