"use strict";
/**
 * 输入框补全与发送行为的**纯逻辑**（可脱机单测）。
 *
 * 两条补全（对齐 Web `useCompletion.ts`）：
 * - `/`：命令补全 —— 命令表由页面从服务端命令注册表镜像（`agent/command_builtin.go` 的 Register）；
 * - `@`：文件补全 —— 候选来自 `POST /api/fs/list {path}` → `{entries:[{name,isDir,size,mode,modTime}]}`。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FsEntry = exports.CommandItem = void 0;
exports.activeToken = activeToken;
exports.matchCommands = matchCommands;
exports.applyCommand = applyCommand;
exports.matchFiles = matchFiles;
exports.applyMention = applyMention;
exports.parentDir = parentDir;
exports.joinPath = joinPath;
exports.enterSends = enterSends;
exports.maxComposerLines = maxComposerLines;
/** 一条命令候选。 */
class CommandItem {
    constructor() {
        this.name = '';
        this.desc = '';
    }
}
exports.CommandItem = CommandItem;
/** 一个文件候选（服务端 `fsListEntry`）。 */
class FsEntry {
    constructor() {
        this.name = '';
        this.isDir = false;
        this.size = 0;
    }
}
exports.FsEntry = FsEntry;
/**
 * 取当前光标前正在输入的那个 token（`/` 或 `@` 触发）。
 *
 * 规则（与 Web 一致）：从文本**末尾**往前扫，遇到空白就停；token 必须**以触发符开头**，
 * 且触发符前面是行首或空白（避免把邮箱 `a@b` 当成提及）。
 */
function activeToken(text, trigger) {
    let i = text.length;
    while (i > 0) {
        const ch = text.charAt(i - 1);
        if (ch === ' ' || ch === '\n' || ch === '\t') {
            break;
        }
        i--;
    }
    const token = text.substring(i);
    if (token.length === 0 || token.charAt(0) !== trigger) {
        return '';
    }
    if (i > 0) {
        const prev = text.charAt(i - 1);
        if (prev !== ' ' && prev !== '\n' && prev !== '\t') {
            return '';
        }
    }
    return token;
}
/** 命令候选（前缀匹配命令名；空查询返回全部）。 */
function matchCommands(all, token) {
    const q = token.length > 0 ? token.substring(1).toLowerCase() : '';
    const out = [];
    for (let i = 0; i < all.length; i++) {
        const name = all[i].name.toLowerCase();
        if (q.length === 0 || name.indexOf(`/${q}`) === 0) {
            out.push(all[i]);
        }
    }
    return out;
}
/** 把正在输入的 token 替换成完整命令（保留 token 之前的内容）。 */
function applyCommand(text, token, name) {
    const head = token.length > 0 ? text.substring(0, text.length - token.length) : text;
    return `${head}${name} `;
}
/** 文件候选（姓名包含查询即命中；目录优先排在前面）。 */
function matchFiles(entries, token) {
    const q = token.length > 0 ? token.substring(1).toLowerCase() : '';
    const dirs = [];
    const files = [];
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (q.length > 0 && e.name.toLowerCase().indexOf(q) < 0) {
            continue;
        }
        if (e.isDir) {
            dirs.push(e);
        }
        else {
            files.push(e);
        }
    }
    return dirs.concat(files);
}
/** 把 `@token` 换成 `@路径`（目录补 `/`，便于继续往下钻）。 */
function applyMention(text, token, name, isDir) {
    const head = token.length > 0 ? text.substring(0, text.length - token.length) : text;
    return `${head}@${name}${isDir ? '/' : ' '}`;
}
/** 当前目录的父目录（`/a/b/` → `/a/b`；`/` → `/`）。 */
function parentDir(path) {
    let p = path.length === 0 ? '/' : path;
    // 以 `/` 结尾 ⇒ 用户想列的就是这个目录本身（`/a/b/` → `/a/b`）；
    // 否则上跳一级（`/a/b` → `/a`）。两种语义必须区分，否则补全列错一层。
    const endedWithSlash = p.length > 1 && p.endsWith('/');
    while (p.length > 1 && p.endsWith('/')) {
        p = p.substring(0, p.length - 1);
    }
    if (endedWithSlash) {
        return p;
    }
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.substring(0, i);
}
/** 把候选目录拼成完整路径（用于列下一层）。 */
function joinPath(dir, name) {
    const d = dir.endsWith('/') ? dir : `${dir}/`;
    return `${d}${name}`;
}
/**
 * 回车键在该模式下应不应该「发送」。
 *
 * - `enter` 模式：回车发送（软键盘 Enter 键类型设为 Send）；
 * - `mod-enter` 模式：回车换行（Enter 键类型设为 NewLine），发送靠按钮/快捷键。
 */
function enterSends(mode) {
    return mode !== 'mod-enter';
}
/** 输入框高度上限（行数）—— 超过就内部滚动，绝不把消息区挤没。 */
function maxComposerLines() {
    return 6;
}
