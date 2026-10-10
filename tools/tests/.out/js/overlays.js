"use strict";
/**
 * overlays.ets —— 浮层（sheet / 抽屉 / 弹层）栈的**纯逻辑**（可脱机单测）。
 *
 * 对齐 web：浏览器里 `Esc` 关闭最上层的 dialog/popover（Radix 的默认行为），
 * 在 HarmonyOS 上的平台等价物是**返回键**（`onBackPress`）。此前原生端**完全没有**
 * 返回键处理 —— 任何浮层打开时按返回都会直接退出应用（web 用户按 Esc 是"关弹窗"），
 * 语义不对。本模块把"该关哪一个"抽成纯函数，页面只做状态落地。
 *
 * ⛔ 顺序铁律：返回键先关**最上层**那个（= 渲染 z 序里最后渲染的）—— 与视觉一致。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.topOverlay = topOverlay;
exports.hasOverlay = hasOverlay;
/**
 * 返回键应先关闭的**最上层**浮层。
 *
 * 顺序 = 页面 build 里渲染顺序的**逆序**（后渲染者盖在上面）：
 *   drawer → settings → queue → plugins → selfCheck → status → model
 *   → prefs → panels → sessMenu → searchHits → ctxMenu → image → webPanel
 * 故从 webPanel 往回查。
 *
 * 注意：`askUser`（服务端权威的提问）**故意不在此列** —— 它必须等用户作答，
 * 不允许被返回键关掉（web 端同样不给 Esc 关闭入口）。
 */
function topOverlay(o) {
    if (o.webPanel)
        return 'webPanel';
    if (o.image)
        return 'image';
    if (o.ctxMenu)
        return 'ctxMenu';
    if (o.searchHits)
        return 'searchHits';
    if (o.sessMenu)
        return 'sessMenu';
    if (o.panels)
        return 'panels';
    if (o.prefs)
        return 'prefs';
    if (o.model)
        return 'model';
    if (o.status)
        return 'status';
    if (o.selfCheck)
        return 'selfCheck';
    if (o.plugins)
        return 'plugins';
    if (o.queue)
        return 'queue';
    if (o.settings)
        return 'settings';
    if (o.drawer)
        return 'drawer';
    return '';
}
/** 是否有任何浮层打开（返回键是否应被消费）。 */
function hasOverlay(o) {
    return topOverlay(o) !== '';
}
