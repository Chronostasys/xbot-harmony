"use strict";
/**
 * 消息操作（长按菜单）的**纯逻辑**（可脱机单测）。
 *
 * 对齐 Web 的实现（`web/src/components/agent/MessageActions.tsx`）：
 * - 复制粒度四档：`reply`（正文）/ `thinking`（正文+思考）/ `tools`（正文+思考+工具）/ `raw`（原始 Markdown）；
 * - 工具级复制：原始输出 / 该命令参数；
 * - 打开链接的协议白名单：只放行 `http` / `https` / `mailto`（`javascript:`/`data:`/`file:` 一律拒绝）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyParts = exports.COPY_RAW = exports.COPY_TOOLS = exports.COPY_THINKING = exports.COPY_REPLY = void 0;
exports.composeCopy = composeCopy;
exports.toolCopyText = toolCopyText;
exports.toolArgsOnly = toolArgsOnly;
exports.toolResultOnly = toolResultOnly;
exports.isOpenableScheme = isOpenableScheme;
exports.resolveOpenable = resolveOpenable;
exports.linksIn = linksIn;
exports.linkLabel = linkLabel;
exports.COPY_REPLY = 'reply';
exports.COPY_THINKING = 'thinking';
exports.COPY_TOOLS = 'tools';
exports.COPY_RAW = 'raw';
/** 一份可复制内容的各部分（由调用方从行/迭代/工具里取出）。 */
class CopyParts {
    constructor() {
        /** 正文（不含思考与工具） */
        this.reply = '';
        /** 思考 */
        this.thinking = '';
        /** 工具调用（名字+参数+结果） */
        this.tools = '';
        /** 原始 Markdown（服务端原文，未被展示层加工） */
        this.raw = '';
    }
}
exports.CopyParts = CopyParts;
/** 只有一个空段时为真（用于过滤"没有内容的复制项"）。 */
function blank(s) {
    return s.trim().length === 0;
}
/**
 * 按变体拼出复制文本。
 *
 * 语义与 Web 一致：`thinking` 在正文之外**追加**思考；`tools` 再追加工具；
 * `raw` 用原始 Markdown（拿不到则回落正文）。空段自动跳过，绝不输出多余空行。
 */
function composeCopy(parts, variant) {
    const segs = [];
    if (variant === exports.COPY_RAW) {
        const raw = blank(parts.raw) ? parts.reply : parts.raw;
        return raw;
    }
    if (!blank(parts.reply)) {
        segs.push(parts.reply);
    }
    if (variant === exports.COPY_THINKING || variant === exports.COPY_TOOLS) {
        if (!blank(parts.thinking)) {
            segs.push(`【思考】\n${parts.thinking}`);
        }
    }
    if (variant === exports.COPY_TOOLS) {
        if (!blank(parts.tools)) {
            segs.push(`【工具】\n${parts.tools}`);
        }
    }
    return segs.join('\n\n');
}
/** 工具一段的可复制文本（含名字、参数、输出；空段跳过）。 */
function toolCopyText(name, args, result) {
    const segs = [];
    if (!blank(name)) {
        segs.push(name);
    }
    if (!blank(args)) {
        segs.push(`参数：${args}`);
    }
    if (!blank(result)) {
        segs.push(`输出：${result}`);
    }
    return segs.join('\n');
}
/** 工具的参数/输出单取（Web 的工具级复制项）。 */
function toolArgsOnly(args) {
    return blank(args) ? '' : args;
}
function toolResultOnly(result) {
    return blank(result) ? '' : result;
}
// ─────────────────────────────────────────────────────────────────────────────
// 链接处理（打开链接 / 复制链接地址）
// ─────────────────────────────────────────────────────────────────────────────
/** 协议白名单：只放行 http/https/mailto（其余一律拒绝，含 javascript:/data:/file:）。 */
function isOpenableScheme(href) {
    const s = href.trim().toLowerCase();
    return s.indexOf('http://') === 0 || s.indexOf('https://') === 0 || s.indexOf('mailto:') === 0;
}
/**
 * 解析出可打开的绝对地址（相对地址按 base 拼成绝对地址；不在白名单返回空串）。
 *
 * 为什么要 base：消息里的 `/api/files/download?...` 是同源相对链接，直接交给浏览器会打不开。
 */
function resolveOpenable(href, base) {
    const h = href.trim();
    if (h.length === 0) {
        return '';
    }
    if (isOpenableScheme(h)) {
        return h;
    }
    if (h.indexOf('//') === 0) {
        // 协议相对（//host/path）：补上 base 的协议
        const scheme = base.indexOf('https://') === 0 ? 'https:' : 'http:';
        const abs = `${scheme}${h}`;
        return isOpenableScheme(abs) ? abs : '';
    }
    if (h.indexOf('/') === 0) {
        // 同源绝对路径
        const b = stripTrailingSlash(base);
        const abs = `${b}${h}`;
        return isOpenableScheme(abs) ? abs : '';
    }
    // 其余相对地址：不做拼接（宁可拒绝，也不要打开一个猜出来的地址）
    return '';
}
function stripTrailingSlash(s) {
    let out = s;
    while (out.length > 0 && out.endsWith('/')) {
        out = out.substring(0, out.length - 1);
    }
    return out;
}
/**
 * 抽出一段 Markdown 里的链接地址（按出现顺序、去重）。
 *
 * 只认 `[text](url)`；图片 `![alt](src)` 不算链接（那是图片引用）。
 */
function linksIn(md) {
    const out = [];
    let i = 0;
    while (i < md.length) {
        const open = md.indexOf('](', i);
        if (open < 0) {
            break;
        }
        // 图片：`](` 前一个字符是 `]` 且再前是 `!` 的情形 —— 用 `[` 的位置判断
        const close = md.indexOf(')', open + 2);
        if (close < 0) {
            break;
        }
        const url = md.substring(open + 2, close).trim();
        // 图片判定：回找与该 `]` 配对的 `[`，看它前一位是不是 `!`（`![alt](src)`）。
        // ⚠️ 不能用 `substring(open-2, open)`：中文 alt 时字符宽度不同，会误判（曾把图片当链接）。
        const lb = md.lastIndexOf('[', open - 1);
        const isImage = lb > 0 && md.charAt(lb - 1) === '!';
        if (!isImage && url.length > 0 && out.indexOf(url) < 0) {
            out.push(url);
        }
        i = close + 1;
    }
    return out;
}
/** 链接的显示名（去掉协议与查询串，太长时截断）。 */
function linkLabel(url) {
    let s = url;
    const q = s.indexOf('?');
    if (q > 0) {
        s = s.substring(0, q);
    }
    const stripped = s.replace('https://', '').replace('http://', '').replace('mailto:', '');
    return stripped.length > 48 ? `${stripped.substring(0, 45)}…` : stripped;
}
