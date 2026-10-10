"use strict";
// 逐字移植自 xbot web `web/src/components/agent/progressStore.ts`（normalizeWebTool* /
// normalizeWebSubAgent*）+ `web/src/types/agent.ts`（IterationSnapshot/IterationTool/
// ToolProgress）+ `web/src/components/agent/api.ts`（HistProgress）（逻辑一比一）。
//
// 为什么单独成模块：agent_normalize.ets / normalize.ets 都从它取规范化的类型与
// 归一函数（对齐 web：normalize.ts 从 progressStore/api/types 三处 import）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWebTool = normalizeWebTool;
exports.normalizeWebTools = normalizeWebTools;
exports.normalizeWebSubAgent = normalizeWebSubAgent;
exports.normalizeWebSubAgents = normalizeWebSubAgents;
function asRecord(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function normalizeUISurface(raw) {
    const s = asRecord(raw);
    if (!s)
        return undefined;
    return {
        kind: typeof s.kind === 'string' ? s.kind : undefined,
        title: typeof s.title === 'string' ? s.title : undefined,
        collapsible: typeof s.collapsible === 'boolean' ? s.collapsible : undefined,
        fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : undefined,
        defaultOpen: typeof s.default_open === 'boolean' ? s.default_open : undefined,
    };
}
/** Normalize a raw tool object（逐字取自 web `progressStore.ts:206`）。 */
function normalizeWebTool(raw) {
    const r = asRecord(raw);
    if (!r)
        return null;
    const uiLibs = Array.isArray(r.ui_libs)
        ? r.ui_libs.map((l) => String(l)).filter((l) => l.length > 0)
        : undefined;
    return {
        name: typeof r.name === 'string' ? r.name : '',
        label: typeof r.label === 'string' ? r.label : '',
        status: (typeof r.status === 'string' ? r.status : 'running'),
        elapsedMs: typeof r.elapsed_ms === 'number' ? r.elapsed_ms : 0,
        summary: typeof r.summary === 'string' ? r.summary : '',
        detail: typeof r.detail === 'string' ? r.detail : '',
        args: typeof r.args === 'string' ? r.args : '',
        toolHints: typeof r.tool_hints === 'string' ? r.tool_hints : '',
        iteration: typeof r.iteration === 'number' ? r.iteration : undefined,
        uiMode: typeof r.ui_mode === 'string' ? r.ui_mode : undefined,
        callID: typeof r.call_id === 'string' && r.call_id.length > 0 ? r.call_id : undefined,
        uiLibs: uiLibs !== undefined && uiLibs.length > 0 ? uiLibs : undefined,
        surface: normalizeUISurface(r.ui_surface),
        genChars: typeof r.gen_chars === 'number' ? r.gen_chars : undefined,
    };
}
/** Normalize an array of raw tool objects（逐字取自 web `progressStore.ts:305`）。 */
function normalizeWebTools(raw) {
    if (!raw || !Array.isArray(raw))
        return [];
    return raw.map((x) => normalizeWebTool(x)).filter((x) => x !== null);
}
/** Normalize a raw sub-agent node（逐字取自 web `progressStore.ts:310`）。 */
function normalizeWebSubAgent(raw) {
    const r = asRecord(raw);
    if (!r)
        return null;
    const role = typeof r.role === 'string' ? r.role : '';
    if (role.length === 0)
        return null;
    const children = Array.isArray(r.children)
        ? r.children.map((c) => normalizeWebSubAgent(c))
            .filter((c) => c !== null)
        : [];
    return {
        role,
        instance: typeof r.instance === 'string' ? r.instance : undefined,
        sessionKey: typeof r.session_key === 'string' ? r.session_key : undefined,
        status: typeof r.status === 'string' ? r.status : '',
        desc: typeof r.desc === 'string' ? r.desc : undefined,
        children,
        iteration: typeof r.iteration === 'number' && r.iteration > 0 ? r.iteration : undefined,
    };
}
/** Normalize an array of raw sub-agent nodes（逐字取自 web `progressStore.ts:329`）。 */
function normalizeWebSubAgents(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((x) => normalizeWebSubAgent(x))
        .filter((x) => x !== null);
}
