"use strict";
/**
 * LLM 选择栏的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web_api.go` + `protocol/events.go`，逐字核对）：
 *   GET  /api/llm-config        → { ok, is_global, model, models[], model_entries[], max_context }
 *   POST /api/llm-config/model  → { sub_id, model }  切模型（按 sender 生效）
 *   POST /api/llm-max-context   → { max_context }
 * `model_entries[i]` = { sub_id, sub_name, model, status: normal|offline|disabled, vision }。
 *
 * ⚠️ 模型解析严禁用"裸模型名"（项目铁律）：切换必须带 `sub_id`，所以选择栏按订阅分组展示。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelGroup = void 0;
exports.groupModels = groupModels;
exports.statusLabel = statusLabel;
exports.selectable = selectable;
exports.modelLabel = modelLabel;
exports.currentModelText = currentModelText;
exports.contextText = contextText;
exports.contextPresets = contextPresets;
exports.parseContext = parseContext;
/** 订阅分组（同名合并；顺序 = 首次出现顺序，**不打乱服务端给的顺序**）。 */
class ModelGroup {
    constructor() {
        this.name = '';
        this.subId = '';
        this.entries = [];
    }
}
exports.ModelGroup = ModelGroup;
/** 按订阅分组（`sub_id` 相同即同组；名字取服务端给的 sub_name）。 */
function groupModels(entries) {
    const out = [];
    if (entries === undefined) {
        return out;
    }
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const subId = e.sub_id !== undefined ? e.sub_id : '';
        let g = undefined;
        for (let k = 0; k < out.length; k++) {
            if (out[k].subId === subId) {
                g = out[k];
            }
        }
        if (g === undefined) {
            g = new ModelGroup();
            g.subId = subId;
            g.name = e.sub_name !== undefined && e.sub_name.length > 0 ? e.sub_name : subId;
            out.push(g);
        }
        g.entries.push(e);
    }
    return out;
}
/** 状态角标（正常无角标，避免噪音）。 */
function statusLabel(status) {
    if (status === 'offline') {
        return '离线';
    }
    if (status === 'disabled') {
        return '已禁用';
    }
    return '';
}
/** 该模型能不能选（禁用的不给点）。 */
function selectable(e) {
    return e.status !== 'disabled';
}
/** 模型显示名（带视觉能力标记；视觉是**手动开关**，不是白名单 ⇒ 只作信息展示）。 */
function modelLabel(e) {
    const m = e.model !== undefined ? e.model : '';
    const badge = statusLabel(e.status);
    const vision = e.vision === true ? ' 🖼' : '';
    return badge.length > 0 ? `${m}（${badge}）${vision}` : `${m}${vision}`;
}
/** 当前模型一行（优先用服务端给的有效模型）。 */
function currentModelText(cfg, fallback) {
    if (cfg === undefined) {
        return fallback;
    }
    if (cfg.model !== undefined && cfg.model.length > 0) {
        return cfg.model;
    }
    return fallback;
}
/** 上下文上限显示（1.0M / 200k）。 */
function contextText(maxContext) {
    if (maxContext === undefined || maxContext <= 0) {
        return '';
    }
    if (maxContext >= 1000 * 1000) {
        return `${(maxContext / (1000 * 1000)).toFixed(1)}M`;
    }
    return `${Math.round(maxContext / 1000)}k`;
}
/** 常上下文预设（点选即可，不用手打数字）。 */
function contextPresets() {
    return [32000, 128000, 200000, 1000000];
}
/** 解析用户手输的上下文上限（支持 `200k` / `1m` / 数字；非法返回 0）。 */
function parseContext(input) {
    const s = input.trim().toLowerCase();
    if (s.length === 0) {
        return 0;
    }
    const last = s.substring(s.length - 1);
    let mult = 1;
    let num = s;
    if (last === 'k') {
        mult = 1000;
        num = s.substring(0, s.length - 1);
    }
    else if (last === 'm') {
        mult = 1000 * 1000;
        num = s.substring(0, s.length - 1);
    }
    const n = Number.parseFloat(num);
    if (!Number.isFinite(n) || n <= 0) {
        return 0;
    }
    const v = Math.round(n * mult);
    return v > 0 ? v : 0;
}
