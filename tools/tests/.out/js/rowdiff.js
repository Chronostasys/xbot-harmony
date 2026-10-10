"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowKey = rowKey;
exports.sameRowIds = sameRowIds;
exports.changedRowIndices = changedRowIndices;
exports.tailRows = tailRows;
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
