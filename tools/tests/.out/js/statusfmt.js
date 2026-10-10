"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanTokens = humanTokens;
exports.usageText = usageText;
exports.todoProgress = todoProgress;
exports.currentTodo = currentTodo;
exports.goalText = goalText;
exports.modelText = modelText;
/** 大数缩写：1234 → 1.2k；1234567 → 1.2M。 */
function humanTokens(n) {
    if (n <= 0) {
        return '0';
    }
    if (n < 1000) {
        return `${n}`;
    }
    if (n < 1000 * 1000) {
        return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}k`;
    }
    return `${(n / (1000 * 1000)).toFixed(1)}M`;
}
/**
 * token 用量一行：`12.3k/1.0M 1%`。
 * 拿不到真实 usage（available=false 或没有 max）时返回空串 —— **绝不估算**（项目铁律）。
 */
function usageText(u) {
    if (u === undefined || u.available !== true) {
        return '';
    }
    const max = u.max_context_tokens !== undefined ? u.max_context_tokens : 0;
    const used = u.prompt_tokens !== undefined ? u.prompt_tokens : 0;
    if (max <= 0) {
        return '';
    }
    const pct = u.usage_percent !== undefined
        ? Math.round(u.usage_percent * 10) / 10
        : Math.round(used * 1000 / max) / 10;
    return `${humanTokens(used)}/${humanTokens(max)} ${pct}%`;
}
/** todos 进度：`3/7`（无 todo 返回空串）。 */
function todoProgress(todos) {
    if (todos === undefined || todos.length === 0) {
        return '';
    }
    let done = 0;
    for (let i = 0; i < todos.length; i++) {
        if (todos[i].status === 'completed') {
            done++;
        }
    }
    return `${done}/${todos.length}`;
}
/** 当前正在做的那条 todo（无则返回空串）。 */
function currentTodo(todos) {
    if (todos === undefined) {
        return '';
    }
    for (let i = 0; i < todos.length; i++) {
        if (todos[i].status === 'in_progress') {
            // 显式收窄：带变量下标的元素访问不做类型收窄（content?: string 的同类坑）
            const t = todos[i].text;
            return t !== undefined ? t : '';
        }
    }
    return '';
}
/** goal 一行（完成打 ✅；无 goal 返回空串）。 */
function goalText(g) {
    if (g === undefined || g.text === undefined || g.text.length === 0) {
        return '';
    }
    const done = g.status === 'completed' || g.status === 'done';
    return `${done ? '✅ ' : '🎯 '}${g.text}`;
}
/** 状态栏的模型名（拿不到返回空串）。 */
function modelText(u) {
    if (u === undefined || u.model === undefined || u.model.length === 0) {
        return '';
    }
    return u.model;
}
