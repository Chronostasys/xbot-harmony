"use strict";
/**
 * 发送模式（排队 / ⚡ 插话）的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web_inbound.go` + `protocol/ws.go`，逐字核对）：
 *   `WSClientMessage.Interrupt`（json `interrupt`）为 true 时，消息**注入到正在跑的 turn**
 *   —— 不排队、不产生 user 行、不带 turn_id；代理在**下一个工具边界**把它作为合成
 *   `user_interrupt` 工具结果喂给模型；响应里 `interrupted=true`。
 *   **会话空闲时会自动退化为普通发送**（所以界面不需要在空闲时暴露插话）。
 *
 * ⚠️ 铁律（Web gotcha）：`interruptMode` 必须随 busy=false **自动复位** —— 否则下一轮
 * 用户以为在发普通消息，实际却插进了别人的回合。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODE_INTERRUPT = exports.MODE_QUEUE = void 0;
exports.toggleMode = toggleMode;
exports.modeLabel = modeLabel;
exports.modeHint = modeHint;
exports.effectiveMode = effectiveMode;
exports.isInterruptSend = isInterruptSend;
exports.sendToast = sendToast;
exports.MODE_QUEUE = 'queue';
exports.MODE_INTERRUPT = 'interrupt';
/** 切换模式（两态互斥）。 */
function toggleMode(mode) {
    return mode === exports.MODE_INTERRUPT ? exports.MODE_QUEUE : exports.MODE_INTERRUPT;
}
/** 模式显示名。 */
function modeLabel(mode) {
    return mode === exports.MODE_INTERRUPT ? '⚡ 插话' : '排队';
}
/** 模式说明（按钮 title 区不够放时用于 toast/提示）。 */
function modeHint(mode) {
    if (mode === exports.MODE_INTERRUPT) {
        return '插话：直接注入当前回合的下一个工具边界（不排队）';
    }
    return '排队：等当前回合结束后再发';
}
/** 实际生效的模式（不忙时一律普通发送 —— 插话只对"正在跑"的会话有意义）。 */
function effectiveMode(busy, mode) {
    return busy ? mode : exports.MODE_QUEUE;
}
/** 是不是插话发送。 */
function isInterruptSend(busy, mode) {
    return effectiveMode(busy, mode) === exports.MODE_INTERRUPT;
}
/** 发送后的回执文案（服务端可能把插话退化成普通发送 ⇒ 文案必须反映真实结果）。 */
function sendToast(interrupted, busyBefore) {
    if (interrupted) {
        return '已插话到当前回合';
    }
    if (busyBefore) {
        return '已排队（当前回合结束后发送）';
    }
    return '';
}
