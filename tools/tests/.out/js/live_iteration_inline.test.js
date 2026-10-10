"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_shim_1 = require("./vitest_shim");
const derive_1 = require("./derive");
const render_1 = require("./render");
const integrate_1 = require("./integrate");
const reduce_1 = require("./reduce");
const chat_types_full_1 = require("./chat_types_full");
const types_1 = require("./types");
const T2 = (0, chat_types_full_1.turnID)(2);
function iter(n, content, reasoning) {
    return { iteration: n, content, reasoning, tools: [], toolCount: 0 };
}
/** 该行当前承载的迭代块（含在飞块）。 */
function blocks(row) {
    return row.iterations;
}
/**
 * 派生 + 就地适配（模拟 `store.rebuildRows` 的对象恒等缓存）：
 * 断言该 turn **恰一条** assistant 渲染行（绝无第二条 live 行）。
 */
class TurnRender {
    constructor() {
        this.cache = new Map();
    }
    rowOf(s) {
        const rows = (0, derive_1.deriveRows)(s);
        const assistants = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (r.kind !== 'user' && r.turnID === 2) {
                assistants.push(r);
            }
            let row = this.cache.get(r.id);
            if (row === undefined) {
                row = new types_1.ChatRow();
                row.id = r.id;
                this.cache.set(r.id, row);
            }
            (0, render_1.applyRow)(row, r);
        }
        (0, vitest_shim_1.expect)(assistants.length, '该 turn 恰一条 assistant 行（无独立 live 行/重复行）').toBe(1);
        return this.cache.get(assistants[0].id);
    }
}
(0, vitest_shim_1.describe)('live 迭代 = 同气泡内最后一个迭代块（真机 bug ①/②）', () => {
    (0, vitest_shim_1.it)('3 迭代序列：iterations 单调不减 + commit 后不消失 + 在飞块在该行内', () => {
        let s = (0, chat_types_full_1.initialChatState)('chat-1');
        const tr = new TurnRender();
        let prevCount = 0;
        const check = (label) => {
            const row = tr.rowOf(s);
            const n = blocks(row).length;
            (0, vitest_shim_1.expect)(n >= prevCount, `${label}: iterations 数单调不减（${prevCount} → ${n}）`).toBe(true);
            prevCount = n;
            return row;
        };
        s = (0, reduce_1.reduce)(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
        check('turn_started');
        // ── 迭代 1：在飞（stream）→ 完成（delta）──
        s = (0, reduce_1.reduce)(s, { type: 'stream', turnID: T2, seq: (0, chat_types_full_1.eventSeq)(2), iteration: (0, chat_types_full_1.iterNum)(1), content: 'p1', reasoning: 'r1', streamingTools: undefined, genui: undefined, streamStats: undefined });
        const live1 = check('iter1 在飞');
        // (c) 在飞内容由**该行**承载（最后一块 = 在飞迭代），非独立行/独立气泡
        const b1 = blocks(live1);
        (0, vitest_shim_1.expect)(b1.length > 0 && b1[b1.length - 1].iteration === 1, '在飞块是该行最后一个迭代块').toBe(true);
        (0, vitest_shim_1.expect)(b1[b1.length - 1].content, '在飞块承载流式正文（同气泡）').toBe('p1');
        s = (0, reduce_1.reduce)(s, { type: 'iteration', turnID: T2, iter: (0, chat_types_full_1.iterNum)(1), seq: (0, chat_types_full_1.eventSeq)(3), content: undefined, reasoning: undefined, activeTools: [], completedTools: [], iterationsDelta: [iter(1, 'final-1', 'think-1')], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined });
        const rowAfter1 = check('iter1 commit');
        // (b) 迭代 1 commit 后仍在 iterations 里（不回退、不消失）
        const i1 = blocks(rowAfter1).find((x) => x.iteration === 1);
        (0, vitest_shim_1.expect)(i1 !== undefined, '迭代 1 commit 后仍在该行 iterations').toBe(true);
        (0, vitest_shim_1.expect)(i1 !== undefined ? i1.content : '', '迭代 1 内容保留 = final-1').toBe('final-1');
        // ── 迭代 2 ──
        s = (0, reduce_1.reduce)(s, { type: 'stream', turnID: T2, seq: (0, chat_types_full_1.eventSeq)(4), iteration: (0, chat_types_full_1.iterNum)(2), content: 'p2', reasoning: 'r2', streamingTools: undefined, genui: undefined, streamStats: undefined });
        const live2 = check('iter2 在飞');
        const b2 = blocks(live2);
        (0, vitest_shim_1.expect)(b2[b2.length - 1].iteration, '在飞块迭代号 = 2').toBe(2);
        (0, vitest_shim_1.expect)(b2[b2.length - 1].content, '在飞块承载 iter2 流式正文').toBe('p2');
        (0, vitest_shim_1.expect)(b2.find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在（累积）').toBe(true);
        s = (0, reduce_1.reduce)(s, { type: 'iteration', turnID: T2, iter: (0, chat_types_full_1.iterNum)(2), seq: (0, chat_types_full_1.eventSeq)(5), content: undefined, reasoning: undefined, activeTools: [], completedTools: [], iterationsDelta: [iter(2, 'final-2', 'think-2')], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined });
        const rowAfter2 = check('iter2 commit');
        const i2 = blocks(rowAfter2).find((x) => x.iteration === 2);
        (0, vitest_shim_1.expect)(i2 !== undefined ? i2.content : '', '迭代 2 commit 后内容 = final-2').toBe('final-2');
        (0, vitest_shim_1.expect)(blocks(rowAfter2).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);
        // ── 迭代 3 ──
        s = (0, reduce_1.reduce)(s, { type: 'stream', turnID: T2, seq: (0, chat_types_full_1.eventSeq)(6), iteration: (0, chat_types_full_1.iterNum)(3), content: 'p3', reasoning: 'r3', streamingTools: undefined, genui: undefined, streamStats: undefined });
        const live3 = check('iter3 在飞');
        const b3 = blocks(live3);
        (0, vitest_shim_1.expect)(b3[b3.length - 1].iteration, '在飞块迭代号 = 3').toBe(3);
        (0, vitest_shim_1.expect)(b3[b3.length - 1].content, '在飞块承载 iter3 流式正文').toBe('p3');
        (0, vitest_shim_1.expect)(blocks(live3).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);
        (0, vitest_shim_1.expect)(blocks(live3).find((x) => x.iteration === 2) !== undefined, '迭代 2 仍在').toBe(true);
        // ── 收尾 ──
        s = (0, reduce_1.reduce)(s, { type: 'phase_done', turnID: T2, seq: (0, chat_types_full_1.eventSeq)(7), finalIteration: iter(3, 'final-3', 'think-3'), todos: undefined });
        check('phase_done');
        s = (0, reduce_1.reduce)(s, { type: 'text_final', turnID: T2, content: 'FINAL', progressHistory: [iter(1, 'final-1', 'think-1'), iter(2, 'final-2', 'think-2'), iter(3, 'final-3', 'think-3')], cancelled: false });
        const finalRow = check('text_final(committed)');
        // 提交后：3 个迭代全在（无洞、不消失）
        const nums = blocks(finalRow).map((x) => x.iteration).sort((a, b) => a - b);
        (0, vitest_shim_1.expect)(nums.length, 'commit 后 3 个迭代全在').toBe(3);
        (0, vitest_shim_1.expect)(nums[0]).toBe(1);
        (0, vitest_shim_1.expect)(nums[1]).toBe(2);
        (0, vitest_shim_1.expect)(nums[2]).toBe(3);
    });
    (0, vitest_shim_1.it)('(c) 在飞内容只由该 turn 的 assistant 行承载 —— 无独立 live 行', () => {
        let s = (0, chat_types_full_1.initialChatState)('chat-1');
        const tr = new TurnRender();
        s = (0, reduce_1.reduce)(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
        s = (0, reduce_1.reduce)(s, { type: 'stream', turnID: T2, seq: (0, chat_types_full_1.eventSeq)(2), iteration: (0, chat_types_full_1.iterNum)(1), content: 'IN-FLIGHT', reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined });
        const rows = (0, derive_1.deriveRows)(s);
        const assistants = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (r.kind !== 'user' && r.turnID === 2) {
                assistants.push(r);
            }
        }
        // 数量：恰一条 assistant 行（不是"列表行 + 尾块"两条）
        (0, vitest_shim_1.expect)(assistants.length, '该 turn 只有一条 assistant 行（无独立 live 行）').toBe(1);
        // 该行承载在飞内容（同气泡）
        const row = tr.rowOf(s);
        const has = blocks(row).some((x) => x.content === 'IN-FLIGHT');
        (0, vitest_shim_1.expect)(has, '在飞正文由该 assistant 行承载（同气泡最后一个迭代块）').toBe(true);
        // 尾块快照与行内块是**同一份内容**（不是第二个气泡的独立内容源）
        const snap = (0, integrate_1.liveProgressFromState)(s);
        (0, vitest_shim_1.expect)(snap.streamContent, '在飞快照仍是同一状态机导出（供打字机）').toBe('IN-FLIGHT');
    });
});
process.exit((0, vitest_shim_1.summary)('live_iteration_inline'));
