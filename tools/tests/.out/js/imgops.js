"use strict";
/**
 * 图片查看器的**纯逻辑**（可脱机单测）：缩放与平移的夹取、双击档位、保存文件名。
 *
 * 为什么要夹取：不夹取的话双指缩放会把图缩到 0 或者放到几十倍、平移能把图拖出屏幕外
 * 再也找不回来（用户只能退出重开）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.minScale = minScale;
exports.maxScale = maxScale;
exports.clampScale = clampScale;
exports.nextZoom = nextZoom;
exports.panLimit = panLimit;
exports.clampOffset = clampOffset;
exports.saveImageName = saveImageName;
exports.scaleText = scaleText;
exports.isZoomed = isZoomed;
/** 允许的缩放范围。 */
function minScale() {
    return 0.5;
}
function maxScale() {
    return 6;
}
/** 夹取缩放（NaN/非正回落 1）。 */
function clampScale(s) {
    if (!Number.isFinite(s) || s <= 0) {
        return 1;
    }
    if (s < minScale()) {
        return minScale();
    }
    if (s > maxScale()) {
        return maxScale();
    }
    return s;
}
/** 双击档位：1 ↔ 2.5（再双击回 1）。 */
function nextZoom(current) {
    return Math.abs(current - 1) < 0.01 ? 2.5 : 1;
}
/** 可平移的最大位移（图未放大时不允许平移；放大后按放大倍数给出边界）。 */
function panLimit(scale, viewport, imageSize) {
    const s = clampScale(scale);
    if (s <= 1.01) {
        return 0;
    }
    const scaled = imageSize * s;
    return Math.max(0, (scaled - viewport) / 2);
}
/** 夹取位移（两个方向都用各自的上限）。 */
function clampOffset(v, limit) {
    if (!Number.isFinite(v) || limit <= 0) {
        return 0;
    }
    if (v < -limit) {
        return -limit;
    }
    if (v > limit) {
        return limit;
    }
    return v;
}
/** 保存到相册的文件名（带时间戳，避免重名覆盖）。 */
function saveImageName(nowMs) {
    const d = new Date(nowMs);
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    return `xbot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
/** 缩放百分比显示（`250%`）。 */
function scaleText(s) {
    return `${Math.round(clampScale(s) * 100)}%`;
}
/** 是否处于放大状态（决定要不要显示"复位"）。 */
function isZoomed(s) {
    return Math.abs(clampScale(s) - 1) > 0.01;
}
