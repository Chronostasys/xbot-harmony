"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toToolProgress = toToolProgress;
exports.toNativeTools = toNativeTools;
exports.toHistoryIteration = toHistoryIteration;
exports.toHistoryIterations = toHistoryIterations;
exports.applyRow = applyRow;
exports.emptyIterList = emptyIterList;
/** WebToolProgress（web 形状）→ 原生 ToolProgress（渲染层形状）。 */
function toToolProgress(t) {
    const out = {
        name: t.name,
        label: t.label,
        status: t.status,
        elapsed_ms: t.elapsedMs,
        summary: t.summary,
        detail: t.detail,
        args: t.args,
        call_id: t.callID,
        ui_mode: t.uiMode,
        gen_chars: t.genChars,
    };
    if (t.uiLibs !== undefined) {
        out.ui_libs = t.uiLibs;
    }
    return out;
}
/** WebToolProgress[] → ToolProgress[]（页面 live 尾块的工具列表用）。 */
function toNativeTools(ws) {
    const out = [];
    for (let i = 0; i < ws.length; i++) {
        out.push(toToolProgress(ws[i]));
    }
    return out;
}
/** WebIteration（web 形状）→ HistoryIteration（渲染层形状）。 */
function toHistoryIteration(w) {
    const tools = [];
    for (let i = 0; i < w.tools.length; i++) {
        tools.push(toToolProgress(w.tools[i]));
    }
    const out = {
        iteration: w.iteration,
        content: w.content,
        reasoning: w.reasoning,
        tools,
        tools_folded: w.toolsFolded === true,
    };
    return out;
}
/** WebIteration[] → HistoryIteration[]。 */
function toHistoryIterations(ws) {
    const out = [];
    for (let i = 0; i < ws.length; i++) {
        out.push(toHistoryIteration(ws[i]));
    }
    return out;
}
/**
 * live 行的**在飞迭代块** —— 从 live Row 的在飞字段（content/reasoning/
 * activeTools/streamingTools）折叠出的最后一个迭代块。
 *
 * 对齐 web：`TurnBody` 在渲染完 `iterations`（已完成）之后，**在同一气泡内**
 * 追加 `<LiveIteration progress=…>`；native 的一行 = 一条消息 = 一个气泡 ⇒
 * 等价做法是把这块并进 `ChatRow.iterations` 的**末尾**（`live: true`），
 * 由同一套块渲染器画出（只有它带打字机/占位）。**不是**第二个气泡/第二行 ——
 * 这正是真机 bug ②「live 迭代是单独的气泡」的根治点。
 *
 * 语义边界（与 reduce 的迭代 commit 语义严格对齐）：
 *   仅当在飞迭代号 **大于** 已完成迭代的最大号（`lastIter > maxCompleted`）
 *   才追加 —— 迭代 commit 后其内容已进 `iterations`（`lastIter <= maxCompleted`），
 *   此时**不追加**（否则同一迭代号出现两块 = 重复渲染，且会让块数回退）。
 */
function inFlightBlock(r) {
    const tools = [];
    for (let i = 0; i < r.activeTools.length; i++) {
        tools.push(toToolProgress(r.activeTools[i]));
    }
    for (let i = 0; i < r.streamingTools.length; i++) {
        tools.push(toToolProgress(r.streamingTools[i]));
    }
    const out = {
        iteration: r.lastIter,
        content: r.content,
        reasoning: r.reasoning,
        tools,
        tools_folded: false,
        live: true,
    };
    return out;
}
/** live Row → 渲染块列表（已完成迭代 ⊕ 末尾在飞块，块数单调不减）。 */
function liveIterations(r) {
    const out = toHistoryIterations(r.iterations);
    let maxCompleted = 0;
    for (let i = 0; i < out.length; i++) {
        if (out[i].iteration > maxCompleted) {
            maxCompleted = out[i].iteration;
        }
    }
    if (r.lastIter > maxCompleted) {
        out.push(inFlightBlock(r));
    }
    return out;
}
/** 行内容变化指纹 —— 变了才自增 `rev`（参与 ForEach key）。 */
function rowSignature(r) {
    switch (r.kind) {
        case 'user':
            return `u#${r.content.length}#${r.turnID}#${r.sending ? 1 : 0}#${r.queued ? 1 : 0}#${r.isNotification ? 1 : 0}`;
        case 'live': {
            const last = r.iterations.length > 0
                ? r.iterations[r.iterations.length - 1] : undefined;
            const lastSig = last !== undefined
                ? `${last.iteration}:${last.content.length}:${last.reasoning.length}:${last.tools.length}` : '-';
            // ⚠️ 必须含**在飞字段**（content/reasoning/tools/lastIter）：在飞迭代块
            // 是由它们折叠出的最后一个迭代块，其内容每帧都变 —— 指纹不含它则
            // 行内容不刷新（"流式只在尾块更新、行内静止"）。含它 ⇒ 每帧 rev 自增、
            // 非懒尾行重渲染（打字机靠 @Prop 增量，不受 rev 影响）。
            return `l#${r.turnID}#${r.iterations.length}#${lastSig}#${r.streaming ? 1 : 0}`
                + `#${r.regionsBefore !== undefined ? r.regionsBefore : 0}`
                + `#${r.lastIter}#${r.content.length}#${r.reasoning.length}`
                + `#${r.activeTools.length}#${r.streamingTools.length}`;
        }
        case 'frozen': {
            const last = r.iterations.length > 0
                ? r.iterations[r.iterations.length - 1] : undefined;
            const lastSig = last !== undefined
                ? `${last.iteration}:${last.content.length}:${last.reasoning.length}:${last.tools.length}` : '-';
            return `f#${r.turnID}#${r.iterations.length}#${lastSig}#${r.content.length}#${r.reasoning.length}`;
        }
        case 'committed': {
            const last = r.iterations.length > 0
                ? r.iterations[r.iterations.length - 1] : undefined;
            const lastSig = last !== undefined
                ? `${last.iteration}:${last.content.length}:${last.tools.length}` : '-';
            return `c#${r.turnID}#${r.iterations.length}#${lastSig}#${r.content.length}#${r.regionsBefore !== undefined ? r.regionsBefore : 0}`;
        }
    }
}
/**
 * 把一个派生 Row 落到既有的 `ChatRow` 对象上（就地更新）。
 *
 * 就地更新（而非每帧 new）保住 `@ObjectLink` 的对象恒等 —— 未变化的行为 ArkUI
 * 复用同一组件实例（对齐 web `rowsToChatMessages` 的对象恒等 memo）。
 *
 * @returns 行内容是否变化（true ⇒ 调用方应自增 rev）
 */
function applyRow(row, r) {
    const sig = rowSignature(r);
    if (row.signature === sig) {
        return false;
    }
    row.signature = sig;
    switch (r.kind) {
        case 'user':
            row.role = 'user';
            row.turnID = r.turnID;
            row.content = r.content;
            row.iterations = [];
            row.isLive = false;
            row.regionsBefore = 0;
            break;
        case 'live':
            row.role = 'assistant';
            row.turnID = r.turnID;
            row.content = r.content;
            row.iterations = liveIterations(r);
            row.isLive = true;
            row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
            break;
        case 'frozen':
            row.role = 'assistant';
            row.turnID = r.turnID;
            row.content = r.content;
            row.iterations = toHistoryIterations(r.iterations);
            row.isLive = false;
            row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
            break;
        case 'committed':
            row.role = 'assistant';
            row.turnID = r.turnID;
            row.content = r.content;
            row.iterations = toHistoryIterations(r.iterations);
            row.isLive = false;
            row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
            break;
    }
    return true;
}
/** 空迭代列表（供迭代详情合并的兜底）。 */
function emptyIterList() {
    return { iterations: [] };
}
