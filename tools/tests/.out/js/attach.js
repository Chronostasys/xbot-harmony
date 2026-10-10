"use strict";
/**
 * 附件相关的**纯逻辑**（可脱机单测）。
 *
 * 为什么单独成模块：文件名/MIME 的推导错了，后果是"上传成功但服务端类型不对/名字乱码"，
 * 只能在真机上撞见。纯函数便于钉死行为。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseName = baseName;
exports.extensionOf = extensionOf;
exports.mimeOf = mimeOf;
exports.humanSize = humanSize;
/** 取路径/URI 的文件名（`file://docs/1/报告.pdf` → `报告.pdf`）。 */
function baseName(uri) {
    const q = uri.indexOf('?');
    const clean = q >= 0 ? uri.substring(0, q) : uri;
    const slash = clean.lastIndexOf('/');
    const name = slash >= 0 ? clean.substring(slash + 1) : clean;
    return name.length > 0 ? name : 'file';
}
/** 取扩展名（小写，不含点；无扩展名返回空串）。 */
function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) {
        return '';
    }
    return name.substring(dot + 1).toLowerCase();
}
/**
 * 由文件名推 MIME。
 *
 * 服务端 `expandUploadKeys` 会按 `file_names`/`file_sizes` 生成内容引用，
 * 而 MIME 只在 multipart 头里用到（决定服务端保存时的类型）；未知类型回落
 * `application/octet-stream`（显式回落，不猜）。
 */
function mimeOf(name) {
    const ext = extensionOf(name);
    if (ext === 'png') {
        return 'image/png';
    }
    if (ext === 'jpg' || ext === 'jpeg') {
        return 'image/jpeg';
    }
    if (ext === 'gif') {
        return 'image/gif';
    }
    if (ext === 'webp') {
        return 'image/webp';
    }
    if (ext === 'pdf') {
        return 'application/pdf';
    }
    if (ext === 'txt' || ext === 'md' || ext === 'log') {
        return 'text/plain';
    }
    if (ext === 'json') {
        return 'application/json';
    }
    if (ext === 'zip') {
        return 'application/zip';
    }
    if (ext === 'hap') {
        return 'application/octet-stream';
    }
    return 'application/octet-stream';
}
/** 人类可读的体积（附件 chip 用）。 */
function humanSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
