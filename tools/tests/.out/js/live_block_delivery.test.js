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
    const root = path.join(__dirname, '..', '..', '..', '..');
    const indexSrc = fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
    const rowSrc = fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');
    return {
        pageBlocksState: /@State\s+liveBlocks\s*:\s*HistoryIteration\[\]/.test(indexSrc),
        rowBlocksProp: /@Prop\s+liveBlocks\s*:\s*HistoryIteration\[\]/.test(rowSrc),
        rendersBlocksFromValue: /blocksFor\s*\(\s*\)/.test(rowSrc) && /this\.liveBlocks/.test(rowSrc),
    };
}
// ─────────────── 模型/渲染辅助（独立 oracle）───────────────────────────────
/** 该行承载的**已完成**迭代块（排除末尾在飞块 `live:true`）。 */
function completedOf(row) {
    const out = [];
    for (let i = 0; i < row.iterations.length; i++) {
        if (row.iterations[i].live !== true) {
            out.push(row.iterations[i]);
        }
    }
    return out;
}
/** 该行的**在飞块**（`live:true`，末尾）。 */
function liveBlockOf(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            return row.iterations[i];
        }
    }
    return undefined;
}
/** 块列表的**值指纹**（页面 @State 镜像的判据：结构/长度变化才换值）。 */
function blocksSig(bs) {
    let s = `${bs.length}`;
    for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        s += `|${b.iteration}:${(b.content ?? '').length}:${(b.reasoning ?? '').length}`
            + `:${b.tools !== undefined ? b.tools.length : 0}`;
    }
    return s;
}
function iterOf(bs, n) {
    for (let i = 0; i < bs.length; i++) {
        if (bs[i].iteration === n) {
            return bs[i];
        }
    }
    return undefined;
}
/**
 * ArkUI V1 `MessageRowView`（live 行）的**重建模型** —— 忠实复刻生产接线：
 *
 *   · 「已完成块」区：只有**驱动它的值**变化才重算。
 *     - value-prop 形态：驱动值 = 页面投递的块列表（`this.liveBlocks`）⇒ 值变即刷新。
 *     - row-object 形态（HEAD）：驱动值 = `@Builder` 的按值参数 `row`（同一引用）⇒
 *       流式期间**永不刷新**，冻结在创建那一瞬（此刻为空）。
 *   · 「在飞块」区：由 `@Prop liveText/liveReasoning/liveTools` 驱动 ⇒ 每帧随值刷新
 *     （P58 已修）。
 *   · 组件每帧**渲染出的块列表** = 已完成块（可能冻结） ⊕ 在飞块（若在飞内容非空）。
 */
class LiveRowComponentModel {
    constructor() {
        this.capturedBlocksValue = undefined;
        this.capturedRowRef = undefined;
        this.completed = [];
        this.refreshes = 0;
    }
    /** 每帧投递（返回值 = 组件此刻**画出的块列表**）。 */
    render(row, byValue) {
        // ── 已完成块区（驱动值见类注释）──
        const now = completedOf(row);
        if (byValue) {
            const sig = blocksSig(now);
            if (sig !== this.capturedBlocksValue) {
                this.completed = now;
                this.capturedBlocksValue = sig;
                this.refreshes++;
            }
        }
        else {
            if (row !== this.capturedRowRef) {
                this.completed = now; // 创建/换引用那一次
                this.capturedRowRef = row;
                this.refreshes++;
            }
        }
        // ── 在飞块区（@Prop 直驱，与页面 syncLiveTail 同源）──
        const live = liveBlockOf(row);
        let inFlight = undefined;
        if (live !== undefined) {
            const hasContent = (0, streammerge_1.displayContent)(live).length > 0
                || (0, streammerge_1.displayReasoning)(live).length > 0
                || (live.tools !== undefined && live.tools.length > 0);
            if (hasContent) {
                inFlight = live;
            }
        }
        const out = this.completed.slice();
        if (inFlight !== undefined) {
            out.push(inFlight);
        }
        return out;
    }
}
// ─────────────── store 接线（同真实链路）──────────────────────────────────
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
        if (store.rows[i].isLive) {
            return store.rows[i];
        }
    }
    return undefined;
}
const P = (progress) => ({ chat_id: CHAT, progress });
// ─────────────── 主流程 ───────────────
async function main() {
    const w0 = readWiring();
    const byValue = w0.pageBlocksState && w0.rowBlocksProp && w0.rendersBlocksFromValue;
    const production = byValue ? 'value-prop' : 'row-object';
    console.log(`\n▶ live 已完成块投递回归：生产接线形态 = ${production}`);
    console.log(`   [源码判据] 页面@State(liveBlocks)=${w0.pageBlocksState}`
        + ` 行@Prop(liveBlocks)=${w0.rowBlocksProp} 由值渲染=${w0.rendersBlocksFromValue}`);
    // Part B：接线判据（生产必须把「已完成块」走**值变化**这条唯一可靠的投递路）
    check('B1 页面把 live 行的已完成块镜像进 @State（值变化通道）', w0.pageBlocksState, '已完成块没有任何「值变化」驱动 —— 只能从被就地改的对象里读（P58 之后的新回归根因）');
    check('B2 MessageRowView 以 @Prop 接收已完成块', w0.rowBlocksProp, '页面 @State 无法投递到渲染组件');
    check('B3 已完成块由**值**渲染（this.liveBlocks，paramless）', w0.rendersBlocksFromValue, '已完成块仍经带参 @Builder 从被就地修改的行对象读 —— 参数不变 ⇒ 其内 UI 不重建');
    // Part A：投递模型 —— 用**生产实际接线**驱动，断言渲染块列表跨迭代边界不塌陷
    console.log('▶ Part A：真实 store 事件序列下，渲染块列表必须单调不减且 iter1 始终在');
    const store = new store_1.ChatStore('http://127.0.0.1:9');
    const w = wire(store);
    await store.send('跑个长任务');
    const comp = new LiveRowComponentModel();
    let prevN = -1;
    let sawIter1Completed = false;
    let iter1ToolSeen = false;
    const step = (label) => {
        const live = liveRowOf(store);
        if (live === undefined) {
            return;
        }
        const rendered = comp.render(live, byValue);
        const n = rendered.length;
        // (M1) 渲染块列表单调不减（迭代边界前后都不许塌陷）
        check(label, n >= prevN, `渲染块列表回退：${prevN} → ${n}（iter1 从画面消失）`);
        // (M2) 模型一旦有已完成的 iter1，渲染列表就必须有它（且带 tool pill）
        const modelIter1 = iterOf(completedOf(live), 1);
        if (modelIter1 !== undefined) {
            sawIter1Completed = true;
            const got = iterOf(rendered, 1);
            check(label, got !== undefined, `已完成的 iter1 不在渲染块列表里（画面丢块）`);
            if (got !== undefined) {
                if ((got.tools ?? []).length > 0) {
                    iter1ToolSeen = true;
                }
                check(label, (got.tools ?? []).length === (modelIter1.tools ?? []).length, `iter1 块的 tool pill 数量不一致（渲染 ${(got.tools ?? []).length}`
                    + ` vs 模型 ${(modelIter1.tools ?? []).length}）`);
            }
        }
        console.log(`   [${label}] 模型块=${JSON.stringify(completedOf(live).map((b) => b.iteration))}`
            + ` 渲染块=${JSON.stringify(rendered.map((b) => `${b.iteration}${b.live === true ? '*' : ''}`))}`);
        prevN = n;
    };
    w.emit('progress_structured', P({ turn_id: 5, phase: 'turn_started', seq: 2, turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' } }));
    step('turn_started');
    // iter1 流式（正文）
    w.emit('progress_structured', P({ turn_id: 5, seq: 3, iteration: 1, stream_content: '正文一' }));
    step('iter1 stream正文');
    // 工具参数流式生成中
    w.emit('progress_structured', P({ turn_id: 5, seq: 4, iteration: 1, stream_content: '正文一', streaming_tools: [{ name: 'bash', status: 'generating', label: 'bash', gen_chars: 3 }] }));
    step('iter1 tool generating');
    // 工具执行中
    w.emit('progress_structured', P({ turn_id: 5, phase: 'tool_exec', seq: 5, iteration: 1, active_tools: [{ name: 'bash', status: 'running', label: 'bash', elapsed_ms: 12 }] }));
    step('iter1 tool running');
    // 工具完成 + iter1 记入 iteration_history（服务端权威快照）
    w.emit('progress_structured', P({ turn_id: 5, phase: 'iteration', seq: 6, iteration: 1, active_tools: [], completed_tools: [{ name: 'bash', status: 'done', label: 'bash' }], iteration_history: [{ iteration: 1, content: '正文一', reasoning: '', tools: [{ name: 'bash', status: 'done', label: 'bash' }] }] }));
    step('iter1 tool 完成 + commit（真机崩点）');
    // iter2 流式
    w.emit('progress_structured', P({ turn_id: 5, seq: 7, iteration: 2, stream_content: '正文二' }));
    step('iter2 stream（前面必须仍有 iter1）');
    check('A-E2E 模型确实产生过已完成的 iter1', sawIter1Completed, '事件序列未产生已完成的 iter1（用例前提不成立）');
    check('A-E2E 已完成的 iter1 必须在渲染块列表里存活', sawIter1Completed && iter1ToolSeen, 'iter1（含 tool pill）从未在渲染块列表里出现 —— 真机「tool call 完成后 iter1 消失」');
    console.log(`   已完成块区刷新次数=${comp.refreshes}（HEAD 形态恒为 1 = 仅创建那次）`);
    console.log(`\n  live_block_delivery: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
