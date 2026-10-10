"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUBBLE = exports.BubbleMetrics = void 0;
exports.withAlpha = withAlpha;
exports.userBubbleBg = userBubbleBg;
/** web 类名 → 原生数值（全部来自上述映射表）。 */
class BubbleMetrics {
    constructor() {
        /** `rounded-2xl`：用户气泡四角圆角（1rem）。 */
        this.userRadiusAll = 16;
        /** `rounded-br-sm`：用户气泡**右下角**单独收小（0.125rem）。 */
        this.userRadiusBR = 2;
        /** `px-3.5`：用户气泡水平内边距。 */
        this.userPadX = 14;
        /** `py-2`：用户气泡垂直内边距。 */
        this.userPadY = 8;
        /** `bg-accent/15`：用户气泡底色透明度（accent @15%）。 */
        this.userBubbleAlpha = 0.15;
        /** `max-w-[85%]`：用户气泡最大宽度（百分比）。 */
        this.userMaxWidthPct = 85;
        /** `px-1`：助手容器/用户外框水平内边距。 */
        this.assistantPadX = 4;
        /** `.iter-block{margin-top:.25rem}`：迭代块之间（及首个块之前）的间距。 */
        this.iterGap = 4;
        /** `gap-1`：迭代块内部（思考/正文/工具）之间间距。 */
        this.blockInnerGap = 4;
        /** `py-1.5`（`.virt-row`）：每条消息行的垂直间距。 */
        this.rowPadY = 6;
    }
    /** 用户气泡圆角对象（`rounded-2xl rounded-br-sm`）。 */
    userRadius() {
        return {
            topLeft: this.userRadiusAll, topRight: this.userRadiusAll,
            bottomLeft: this.userRadiusAll, bottomRight: this.userRadiusBR,
        };
    }
}
exports.BubbleMetrics = BubbleMetrics;
/** 唯一实例（组件只引用它）。 */
exports.BUBBLE = new BubbleMetrics();
/**
 * `'#RRGGBB'` + alpha(0..1) → `'#AARRGGBB'`（ArkUI 的 ARGB 字面量语义）。
 * 用于复现 web 的 `/15` 透明度修饰（`bg-accent/15`）。
 */
function withAlpha(hex, alpha) {
    const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    let a = Math.round(alpha * 255);
    if (a < 0) {
        a = 0;
    }
    if (a > 255) {
        a = 255;
    }
    const digits = '0123456789ABCDEF';
    const hi = digits.charAt(Math.floor(a / 16));
    const lo = digits.charAt(a % 16);
    return `#${hi}${lo}${h.slice(0, 6).toUpperCase()}`;
}
/** 用户气泡底色 = 主题 accent @15%（web `bg-accent/15`）。 */
function userBubbleBg(p) {
    return withAlpha(p.accent, exports.BUBBLE.userBubbleAlpha);
}
