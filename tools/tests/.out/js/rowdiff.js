"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowKey = rowKey;
exports.sameRowIds = sameRowIds;
exports.changedRowIndices = changedRowIndices;
exports.tailRows = tailRows;
exports.sessionScopedRowKey = sessionScopedRowKey;
exports.scopedFingerprint = scopedFingerprint;
exports.rowsFpOf = rowsFpOf;
exports.identityChanged = identityChanged;
exports.needsFullReload = needsFullReload;
/** 一行的稳定键：内容每次变化 `rev` 自增（参与键 ⇒ 内容变了就重建该行）。 */
function rowKey(r) {
    return `${r.id}#${r.rev}`;
}
/** 行的**身份**序列是否一致（长度 + id 顺序）。身份变了必须整表 reload。 */
function sameRowIds(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id) {
            return false;
        }
    }
    return true;
}
/** 内容发生变化（键不同）的行下标 —— 身份一致时只通知这些行。 */
function changedRowIndices(a, b) {
    const out = [];
    const n = a.length < b.length ? a.length : b.length;
    for (let i = 0; i < n; i++) {
        if (rowKey(a[i]) !== rowKey(b[i])) {
            out.push(i);
        }
    }
    return out;
}
/** 末尾 N 行（行窗口：只让数据源持有最近 N 行）。 */
function tailRows(rows, limit) {
    if (limit <= 0 || rows.length <= limit) {
        return rows.slice();
    }
    return rows.slice(rows.length - limit);
}
/**
 * 行的**会话作用域键** —— `LazyForEach` 必须用它（不能只用 `rowKey`）。
 *
 * ⛔ 真机严重事故（2026-10-10「所有会话都渲染了第一个打开的会话的迭代」）：行 id 是**每个 store
 * 独立计数**的（`live-1` / `u-1` / `a-2` …），`rev` 也都从 1 起, 两个**不同会话**的行可以拿到
 * **逐字相同**的裸键。`LazyForEach` 以键认条目, 第二会话的行会被当成同一条复用已渲染的旧条目。
 */
function sessionScopedRowKey(chatId, r) {
    return chatId + '#' + r.id + '#' + r.rev;
}
/**
 * **会话作用域指纹**：`chatId|n|p1,p2,…`（rows / sessions / queue / todos 同一契约）。
 *
 * ⛔ 同一事故的第二处：指纹用于判「要不要把 store 的数据重新投影到界面」。不含会话身份时,
 * 两个会话的同形数据指纹相等, 切会话被判「没变」, 界面永不刷新（一直显示上一个会话的内容）。
 */
function scopedFingerprint(chatId, parts) {
    return chatId + '|' + parts.length + '|' + parts.join(',');
}
/** 行集合的会话作用域指纹（`id#rev` 序列 + 会话身份）。 */
function rowsFpOf(rows, chatId) {
    const parts = [];
    for (let i = 0; i < rows.length; i++) {
        parts.push(rows[i].id + '#' + rows[i].rev);
    }
    return scopedFingerprint(chatId, parts);
}
/** 会话身份是否变化（变化则所有指纹必须作废，且身份必须先落定再投影）。 */
function identityChanged(prevChatId, nextChatId) {
    return prevChatId !== nextChatId;
}
/**
 * 数据源骨架是否必须**整表重建**：会话身份变化 **或** 行 id 序列变化。
 *
 * ⛔ 真机严重事故的第三处（最致命）：`applyRows` 原本只看 `sameRowIds`（纯 id 序列）。
 * 两个会话同形（id 都是 `live-1`/`u-1`/`a-2`…）, 判「骨架未变」, `changedRowIndices` 为空,
 * **一条变更通知都不发**, `LazyForEach` 保留第一个会话已构建的条目, 于是切到任何会话都显示
 * **第一个打开的会话**的内容。会话身份必须参与该判据。
 */
function needsFullReload(prev, next, prevChatId, nextChatId) {
    return prevChatId !== nextChatId || !sameRowIds(prev, next);
}
