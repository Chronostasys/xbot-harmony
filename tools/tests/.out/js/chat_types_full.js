"use strict";
/**
 * 状态机类型（逐字移植自 xbot web `web/src/chat/types.ts`）。
 * 品牌类型（Brand）、NonEmpty 下界、TurnPhase 判别联合、EMPTY_LIVE 等全部保留原语义。
 */
/**
 * types.ts — 类型驱动状态机（TDSM）的核心类型层。
 *
 * 设计原则（docs/agent/web-rewrite-design.md §3）：
 *   非法状态不可表示（illegal states unrepresentable）。
 *   - Turn 的 live/frozen/committed 三态互斥由判别联合保证（取代
 *     live 槽 + committed 槽并存 + frozen 标志的 2-bits-3-态组合）。
 *   - committed 数据必可渲染：content 非空或 iterations 非空，
 *     由 CommittedPayload 判别联合 + NonEmpty 构造函数保证。
 *   - ID 类数值经 Brand 防混用；空数据经 NonEmpty 表达下界。
 *
 * 本文件是纯类型 + 唯一构造函数。全项目仅允许在此文件内使用 `as`
 * 断言（构造函数内部）——渲染层/reducer 一律禁止（ESLint no-as 规则管 辖）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_LIVE = exports.eventSeq = exports.iterNum = exports.turnID = void 0;
exports.nonEmptyStr = nonEmptyStr;
exports.nonEmptyArr = nonEmptyArr;
exports.commitViaText = commitViaText;
exports.commitViaFold = commitViaFold;
exports.initialChatState = initialChatState;
const turnID = (n) => (n > 0 ? n : 1);
exports.turnID = turnID;
const iterNum = (n) => (n >= 1 ? n : 1);
exports.iterNum = iterNum;
const eventSeq = (n) => n;
exports.eventSeq = eventSeq;
function nonEmptyStr(s) {
    if (typeof s !== 'string' || s.length === 0)
        return null;
    return s;
}
function nonEmptyArr(xs) {
    if (!Array.isArray(xs) || xs.length === 0)
        return null;
    return xs;
}
exports.EMPTY_LIVE = {
    iter: (0, exports.iterNum)(1),
    streaming: true,
    progressPhase: 'thinking',
    content: '',
    reasoning: '',
    iterations: [],
    activeTools: [],
    streamingTools: [],
    genui: '',
    subAgents: [],
    todos: [],
    tokenUsage: null,
    streamStats: null,
};
/** 唯一合法的 committed 构造入口（reducer 内使用）。 */
function commitViaText(content, iterations, compactions, regionsBefore) {
    return { via: 'text', content, iterations, compactions, regionsBefore };
}
/** fold 构造：iterations 必须非空（类型强制）；content 可为空字符串。 */
function commitViaFold(iterations, content, iterationsTruncated = 0, compactions, regionsBefore) {
    return { via: 'fold', iterations, content, iterationsTruncated, compactions, regionsBefore };
}
function initialChatState(chatID) {
    return { chatID, turns: new Map(), legacy: [], standalone: [], activeTurn: null, lastSeq: null, busy: false, pendingUsers: [], todos: [], goal: null, queue: [], sessionRunning: false, gapReloadToken: 0, unreachableGapSig: '', lostIterGapSig: '' };
}
