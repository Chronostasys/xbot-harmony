/**
 * 消息操作（长按菜单）的**纯逻辑**（可脱机单测）。
 *
 * 对齐 Web 的实现（`web/src/components/agent/MessageActions.tsx`）：
 * - 复制粒度四档：`reply`（正文）/ `thinking`（正文+思考）/ `tools`（正文+思考+工具）/ `raw`（原始 Markdown）；
 * - 工具级复制：原始输出 / 该命令参数；
 * - 打开链接的协议白名单：只放行 `http` / `https` / `mailto`（`javascript:`/`data:`/`file:` 一律拒绝）。
 */
export const COPY_REPLY: string = 'reply';
export const COPY_THINKING: string = 'thinking';
export const COPY_TOOLS: string = 'tools';
export const COPY_RAW: string = 'raw';
/** 一份可复制内容的各部分（由调用方从行/迭代/工具里取出）。 */
export class CopyParts {
    /** 正文（不含思考与工具） */
    reply: string = '';
    /** 思考 */
    thinking: string = '';
    /** 工具调用（名字+参数+结果） */
    tools: string = '';
    /** 原始 Markdown（服务端原文，未被展示层加工） */
    raw: string = '';
}
/** 只有一个空段时为真（用于过滤"没有内容的复制项"）。 */
function blank(s: string): boolean {
    return s.trim().length === 0;
}
/**
 * 按变体拼出复制文本。
 *
 * 语义与 Web 一致：`thinking` 在正文之外**追加**思考；`tools` 再追加工具；
 * `raw` 用原始 Markdown（拿不到则回落正文）。空段自动跳过，绝不输出多余空行。
 */
export function composeCopy(parts: CopyParts, variant: string): string {
    const segs: string[] = [];
    if (variant === COPY_RAW) {
        const raw: string = blank(parts.raw) ? parts.reply : parts.raw;
        return raw;
    }
    if (!blank(parts.reply)) {
        segs.push(parts.reply);
    }
    if (variant === COPY_THINKING || variant === COPY_TOOLS) {
        if (!blank(parts.thinking)) {
            segs.push(`【思考】\n${parts.thinking}`);
        }
    }
    if (variant === COPY_TOOLS) {
        if (!blank(parts.tools)) {
            segs.push(`【工具】\n${parts.tools}`);
        }
    }
    return segs.join('\n\n');
}
/** 工具一段的可复制文本（含名字、参数、输出；空段跳过）。 */
export function toolCopyText(name: string, args: string, result: string): string {
    const segs: string[] = [];
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
export function toolArgsOnly(args: string): string {
    return blank(args) ? '' : args;
}
export function toolResultOnly(result: string): string {
    return blank(result) ? '' : result;
}
// ─────────────────────────────────────────────────────────────────────────────
// 链接处理（打开链接 / 复制链接地址）
// ─────────────────────────────────────────────────────────────────────────────
/** 协议白名单：只放行 http/https/mailto（其余一律拒绝，含 javascript:/data:/file:）。 */
export function isOpenableScheme(href: string): boolean {
    const s: string = href.trim().toLowerCase();
    return s.indexOf('http://') === 0 || s.indexOf('https://') === 0 || s.indexOf('mailto:') === 0;
}
/**
 * 解析出可打开的绝对地址（相对地址按 base 拼成绝对地址；不在白名单返回空串）。
 *
 * 为什么要 base：消息里的 `/api/files/download?...` 是同源相对链接，直接交给浏览器会打不开。
 */
export function resolveOpenable(href: string, base: string): string {
    const h: string = href.trim();
    if (h.length === 0) {
        return '';
    }
    if (isOpenableScheme(h)) {
        return h;
    }
    if (h.indexOf('//') === 0) {
        // 协议相对（//host/path）：补上 base 的协议
        const scheme: string = base.indexOf('https://') === 0 ? 'https:' : 'http:';
        const abs: string = `${scheme}${h}`;
        return isOpenableScheme(abs) ? abs : '';
    }
    if (h.indexOf('/') === 0) {
        // 同源绝对路径
        const b: string = stripTrailingSlash(base);
        const abs: string = `${b}${h}`;
        return isOpenableScheme(abs) ? abs : '';
    }
    // 其余相对地址：不做拼接（宁可拒绝，也不要打开一个猜出来的地址）
    return '';
}
function stripTrailingSlash(s: string): string {
    let out: string = s;
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
export function linksIn(md: string): string[] {
    const out: string[] = [];
    let i: number = 0;
    while (i < md.length) {
        const open: number = md.indexOf('](', i);
        if (open < 0) {
            break;
        }
        // 图片：`](` 前一个字符是 `]` 且再前是 `!` 的情形 —— 用 `[` 的位置判断
        const close: number = md.indexOf(')', open + 2);
        if (close < 0) {
            break;
        }
        const url: string = md.substring(open + 2, close).trim();
        // 图片判定：回找与该 `]` 配对的 `[`，看它前一位是不是 `!`（`![alt](src)`）。
        // ⚠️ 不能用 `substring(open-2, open)`：中文 alt 时字符宽度不同，会误判（曾把图片当链接）。
        const lb: number = md.lastIndexOf('[', open - 1);
        const isImage: boolean = lb > 0 && md.charAt(lb - 1) === '!';
        if (!isImage && url.length > 0 && out.indexOf(url) < 0) {
            out.push(url);
        }
        i = close + 1;
    }
    return out;
}
/** 链接的显示名（去掉协议与查询串，太长时截断）。 */
export function linkLabel(url: string): string {
    let s: string = url;
    const q: number = s.indexOf('?');
    if (q > 0) {
        s = s.substring(0, q);
    }
    const stripped: string = s.replace('https://', '').replace('http://', '').replace('mailto:', '');
    return stripped.length > 48 ? `${stripped.substring(0, 45)}…` : stripped;
}
