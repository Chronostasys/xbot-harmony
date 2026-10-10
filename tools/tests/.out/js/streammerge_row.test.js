"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_shim_1 = require("./vitest_shim");
const derive_1 = require("./derive");
const integrate_1 = require("./integrate");
const reduce_1 = require("./reduce");
const chat_types_full_1 = require("./chat_types_full");
const T1 = (0, chat_types_full_1.turnID)(1);
function iterDelta(n, content) {
    return { iteration: n, content, reasoning: '', tools: [], toolCount: 0 };
}
(0, vitest_shim_1.describe)('live 行：已完成迭代在列表、在飞快照在尾块（互不重叠）', () => {
    (0, vitest_shim_1.it)('在飞内容绝不进 iterations（否则与尾块重复渲染）', () => {
        let s = (0, chat_types_full_1.initialChatState)('chat-1');
        s = (0, reduce_1.reduce)(s, { type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null });
        // 迭代 1 完成（delta 进 iteration_history）
        s = (0, reduce_1.reduce)(s, {
            type: 'iteration', turnID: T1, iter: (0, chat_types_full_1.iterNum)(1), seq: null,
            content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
            iterationsDelta: [iterDelta(1, 'iter-1-final')], todos: undefined,
            subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
        });
        // 迭代 2 在飞（流式正文，尚未完成）
        s = (0, reduce_1.reduce)(s, {
            type: 'stream', turnID: T1, seq: null, iteration: (0, chat_types_full_1.iterNum)(2),
            content: 'in-flight-text', reasoning: 'in-flight-reasoning', streamingTools: undefined,
            genui: undefined, streamStats: undefined,
        });
        // ① 派生行：live 行的 iterations 只有已完成的迭代 1
        const rows = (0, derive_1.deriveRows)(s);
        const live = rows.find((r) => r.kind === 'live');
        (0, vitest_shim_1.expect)(live, '必须有一行 live').toBeTruthy();
        if (live !== undefined && live.kind === 'live') {
            (0, vitest_shim_1.expect)(live.iterations.length, 'iterations 只含已完成迭代').toBe(1);
            (0, vitest_shim_1.expect)(live.iterations[0].iteration, '已完成迭代号 = 1').toBe(1);
            (0, vitest_shim_1.expect)(live.iterations[0].content, '已完成迭代内容 = iter-1-final').toBe('iter-1-final');
            // 在飞内容在 live 行的独立字段上，绝不在 iterations 里
            (0, vitest_shim_1.expect)(live.content, '在飞正文在 live 行 content 字段').toBe('in-flight-text');
            (0, vitest_shim_1.expect)(live.reasoning, '在飞思考在 live 行 reasoning 字段').toBe('in-flight-reasoning');
            for (let i = 0; i < live.iterations.length; i++) {
                (0, vitest_shim_1.expect)(live.iterations[i].content, '没有任何迭代携带在飞文本').not.toContain('in-flight');
            }
        }
        // ② 尾块快照：liveProgressFromState 输出在飞内容（尾块渲染这一份）
        const snap = (0, integrate_1.liveProgressFromState)(s);
        (0, vitest_shim_1.expect)(snap.streamContent, '尾块快照的 streamContent = 在飞正文').toBe('in-flight-text');
        (0, vitest_shim_1.expect)(snap.reasoningStreamContent, '尾块快照的思考 = 在飞思考').toBe('in-flight-reasoning');
        (0, vitest_shim_1.expect)(snap.iterationHistory.length, '快照 iterationHistory = 已完成迭代数').toBe(1);
    });
    (0, vitest_shim_1.it)('迭代完成（delta 到达）后：已完成内容进 iterations', () => {
        let s = (0, chat_types_full_1.initialChatState)('chat-1');
        s = (0, reduce_1.reduce)(s, { type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null });
        s = (0, reduce_1.reduce)(s, {
            type: 'iteration', turnID: T1, iter: (0, chat_types_full_1.iterNum)(1), seq: null,
            content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
            iterationsDelta: [iterDelta(1, 'final-1')], todos: undefined,
            subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
        });
        const rows = (0, derive_1.deriveRows)(s);
        const live = rows.find((r) => r.kind === 'live');
        if (live !== undefined && live.kind === 'live') {
            (0, vitest_shim_1.expect)(live.iterations.length).toBe(1);
            (0, vitest_shim_1.expect)(live.iterations[0].content).toBe('final-1');
        }
    });
});
process.exit((0, vitest_shim_1.summary)('streammerge_row'));
