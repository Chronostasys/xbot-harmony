"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ROWS_VISIBLE = exports.DEFAULT_CHANNEL = void 0;
exports.channelForChat = channelForChat;
exports.channelLabel = channelLabel;
exports.visibleRows = visibleRows;
exports.hiddenRowCount = hiddenRowCount;
/** 创建新会话时使用的渠道（Web 端新建的都是 web）。 */
exports.DEFAULT_CHANNEL = 'web';
/**
 * 取某个会话**自己的渠道**。
 *
 * ⚠️ 为什么必须这样：`/api/session-tree` 返回**所有渠道**的会话（含飞书 `oc_*` / `ou_*`），
 * 而 `/api/history` 等接口要求 `channel` 与会话实际所属渠道一致 —— 客户端曾把 channel 恒设为
 * `'web'`，于是点开任何非 web 会话都得到 `{"code":"not_found","message":"session not found"}`
 * （真机截图实证）。找不到会话时回落 `web`（新会话/历史遗留调用点的安全值）。
 */
function channelForChat(sessions, chatId) {
    for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.chat_id === chatId) {
            if (s.channel !== undefined && s.channel.length > 0) {
                return s.channel;
            }
            return exports.DEFAULT_CHANNEL;
        }
    }
    return exports.DEFAULT_CHANNEL;
}
/** 渠道的展示名（抽屉里标注来源，避免"这个会话为什么打不开"的困惑）。 */
function channelLabel(channel) {
    if (channel === 'web') {
        return 'Web';
    }
    if (channel === 'feishu') {
        return '飞书';
    }
    if (channel === 'cli') {
        return 'CLI';
    }
    return channel.length > 0 ? channel : '未知';
}
/**
 * 首屏最多渲染的消息行数。
 *
 * 为什么要有上限：`List` + `ForEach` 会**一次性构建全部行**，而单行最多 16 个迭代块 × 每块
 * Markdown ⇒ 几十行就是几千个节点（真机表现："渲染很卡、交互也很差"）。
 * 更早的行由「显示更早」按钮按批放开。
 */
exports.MAX_ROWS_VISIBLE = 12;
/** 当前应渲染的行窗口（返回末尾 N 行；N 由用户点上方的「显示更早」增大）。 */
function visibleRows(rows, limit) {
    if (limit <= 0 || rows.length <= limit) {
        return rows;
    }
    return rows.slice(rows.length - limit);
}
/** 被行窗口挡住的条数（0 表示全展示）。 */
function hiddenRowCount(total, limit) {
    if (limit <= 0 || total <= limit) {
        return 0;
    }
    return total - limit;
}
