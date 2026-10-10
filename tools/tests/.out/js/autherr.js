"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTP_NOT_FOUND = exports.CODE_UNAUTHORIZED = exports.HTTP_UNAUTHORIZED = void 0;
exports.isUnauthorized = isUnauthorized;
exports.loadErrTitle = loadErrTitle;
exports.loadErrHint = loadErrHint;
exports.needsRelogin = needsRelogin;
exports.isNotFound = isNotFound;
exports.needsSessionRefresh = needsSessionRefresh;
/**
 * 鉴权/加载错误的**分类逻辑**（可脱机单测）。
 *
 * 为什么必须分类：把 401 当成"网络不通"会把人引向完全错误的方向
 * （真实事故：web 明明能访问、会话完全有效，客户端却提示"手机到服务端网络不通（代理/防火墙），
 * 或服务端地址填错" —— 用户只能反复检查网络，永远找不到真正的原因）。
 */
exports.HTTP_UNAUTHORIZED = 'HTTP 401';
exports.CODE_UNAUTHORIZED = 'unauthorized';
/** 错误信息里是否表达了"会话失效"（401 / unauthorized）。 */
function isUnauthorized(msg) {
    const s = msg.toLowerCase();
    return s.indexOf(exports.HTTP_UNAUTHORIZED.toLowerCase()) >= 0 || s.indexOf(exports.CODE_UNAUTHORIZED) >= 0;
}
/** 加载失败时的标题。 */
function loadErrTitle(msg) {
    if (isUnauthorized(msg)) {
        return '登录已过期';
    }
    if (isNotFound(msg)) {
        return '会话已不存在';
    }
    return '加载会话失败';
}
/** 加载失败时的下一步建议（与标题同一判据，避免自相矛盾）。 */
function loadErrHint(msg) {
    if (isUnauthorized(msg)) {
        return '会话凭据已失效，请重新登录（不是网络问题）。';
    }
    if (isNotFound(msg)) {
        return '该会话在服务端已不存在（可能已在网页端或别的设备删除）。刷新会话列表后另选一个即可。';
    }
    if (msg.indexOf('HTTP 5') >= 0) {
        return '服务端出错（5xx），可稍后重试；若持续出现请看服务端日志。';
    }
    return '常见原因：手机到服务端网络不通（代理/防火墙），或服务端地址填错。';
}
/** 该错误是否需要"重新登录"按钮（而不是"重试"）。 */
function needsRelogin(msg) {
    return isUnauthorized(msg);
}
/**
 * 「会话不存在」（404）—— 与 401 完全不同的处置：
 * 400/404 说明这个 chat 在服务端已经不在了（多为在网页端/别的设备删掉了），
 * 正确反应是**刷新会话列表并另选一个**，而不是让用户对着一个永远打不开的会话重试。
 */
exports.HTTP_NOT_FOUND = 'HTTP 404';
/** 错误信息是否表达了"会话不存在"。 */
function isNotFound(msg) {
    const s = msg.toLowerCase();
    return s.indexOf(exports.HTTP_NOT_FOUND.toLowerCase()) >= 0 || s.indexOf('session not found') >= 0;
}
/** 该错误是否需要"刷新会话列表"（而不是重试/重新登录）。 */
function needsSessionRefresh(msg) {
    return isNotFound(msg) && !isUnauthorized(msg);
}
