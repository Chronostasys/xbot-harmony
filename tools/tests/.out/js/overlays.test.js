"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_shim_1 = require("./vitest_shim");
const overlays_1 = require("./overlays");
const indicators_1 = require("./indicators");
function ov(over) {
    return {
        drawer: false, settings: false, queue: false, plugins: false, selfCheck: false,
        status: false, model: false, prefs: false, panels: false, sessMenu: false,
        searchHits: false, ctxMenu: false, image: false, webPanel: false,
        ...over,
    };
}
(0, vitest_shim_1.describe)('浮层栈：返回键先关最上层（web Esc 语义）', () => {
    (0, vitest_shim_1.it)('无浮层 ⇒ 返回键交还系统', () => {
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({}))).toBe('');
        (0, vitest_shim_1.expect)((0, overlays_1.hasOverlay)(ov({}))).toBe(false);
    });
    (0, vitest_shim_1.it)('单层浮层：每个开关都能被返回键关掉', () => {
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ drawer: true }))).toBe('drawer');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ settings: true }))).toBe('settings');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ queue: true }))).toBe('queue');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ plugins: true }))).toBe('plugins');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ selfCheck: true }))).toBe('selfCheck');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ status: true }))).toBe('status');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ model: true }))).toBe('model');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ prefs: true }))).toBe('prefs');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ panels: true }))).toBe('panels');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ sessMenu: true }))).toBe('sessMenu');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ searchHits: true }))).toBe('searchHits');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ ctxMenu: true }))).toBe('ctxMenu');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ image: true }))).toBe('image');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ webPanel: true }))).toBe('webPanel');
    });
    (0, vitest_shim_1.it)('多层叠加：返回键关【最后渲染】（z 序最上）那层，不被下层抢走', () => {
        // drawer 在最下层、webPanel 在最上层 ⇒ 先关 webPanel
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ drawer: true, settings: true, webPanel: true }))).toBe('webPanel');
        // 去掉最上层 ⇒ 轮到 image
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ drawer: true, settings: true, image: true }))).toBe('image');
        // 再逐层：ctxMenu > sessMenu > panels > prefs > model
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ drawer: true, ctxMenu: true, panels: true }))).toBe('ctxMenu');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ drawer: true, sessMenu: true, panels: true }))).toBe('sessMenu');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ panels: true, prefs: true }))).toBe('panels');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ prefs: true, model: true }))).toBe('prefs');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ model: true, status: true }))).toBe('model');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ status: true, selfCheck: true }))).toBe('status');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ selfCheck: true, plugins: true }))).toBe('selfCheck');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ plugins: true, queue: true }))).toBe('plugins');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ queue: true, settings: true }))).toBe('queue');
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(ov({ settings: true, drawer: true }))).toBe('settings');
    });
    (0, vitest_shim_1.it)('AskUser 不在浮层栈里（服务端权威必答，不允许返回键关掉）', () => {
        // OverlayState 根本没有 askUser 字段 ⇒ 无法被关（类型即约束）。
        const o = ov({});
        (0, vitest_shim_1.expect)((0, overlays_1.topOverlay)(o)).toBe('');
    });
});
(0, vitest_shim_1.describe)('「↓ 回到最新」判据：贴底/空列表都不显示', () => {
    (0, vitest_shim_1.it)('贴底 ⇒ 不显示', () => {
        (0, vitest_shim_1.expect)((0, indicators_1.showsJumpToLatest)(true, 5)).toBe(false);
    });
    (0, vitest_shim_1.it)('不在底部且有内容 ⇒ 显示', () => {
        (0, vitest_shim_1.expect)((0, indicators_1.showsJumpToLatest)(false, 5)).toBe(true);
    });
    (0, vitest_shim_1.it)('空列表 ⇒ 不显示（即使不在底部）', () => {
        (0, vitest_shim_1.expect)((0, indicators_1.showsJumpToLatest)(false, 0)).toBe(false);
    });
});
process.exit((0, vitest_shim_1.summary)('overlays'));
