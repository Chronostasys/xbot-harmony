"use strict";
/**
 * Markdown 解析（ArkTS 原生实现，零依赖）。
 *
 * 为什么自己做：Web 版用 react-markdown + remark/rehype，生态无法移植到 ArkTS
 * （见 docs/ARCHITECTURE.md）。这里实现**聊天里真正会出现**的子集：
 *   块级：标题 / 段落 / 无序·有序列表 / 围栏代码块 / 引用 / 分隔线 / 表格
 *   行内：粗体 / 斜体 / 行内代码 / 链接 / 删除线
 * 复杂图表（mermaid）、公式（katex）不在原生范围 —— 那类消息走 ArkWeb 面板。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MdSpan = exports.MdBlock = exports.MdBlockKind = void 0;
exports.parseMarkdown = parseMarkdown;
exports.parseInline = parseInline;
exports.markdownToPlain = markdownToPlain;
var MdBlockKind;
(function (MdBlockKind) {
    MdBlockKind[MdBlockKind["Paragraph"] = 0] = "Paragraph";
    MdBlockKind[MdBlockKind["Heading"] = 1] = "Heading";
    MdBlockKind[MdBlockKind["List"] = 2] = "List";
    MdBlockKind[MdBlockKind["Code"] = 3] = "Code";
    MdBlockKind[MdBlockKind["Quote"] = 4] = "Quote";
    MdBlockKind[MdBlockKind["Divider"] = 5] = "Divider";
    MdBlockKind[MdBlockKind["Table"] = 6] = "Table";
})(MdBlockKind || (exports.MdBlockKind = MdBlockKind = {}));
class MdBlock {
    constructor() {
        this.kind = MdBlockKind.Paragraph;
        /** 标题级别 1..6；列表嵌套层级 0.. */
        this.level = 0;
        /** 有序列表？ */
        this.ordered = false;
        /** 段落/标题/引用/列表项的文本（行内语法待 parseInline 处理） */
        this.text = '';
        /** 列表项（已含各自的行内标记） */
        this.items = [];
        /** 代码围栏语言 */
        this.lang = '';
        /** 代码正文 */
        this.code = '';
        /** 表格：表头 + 行（单元格文本） */
        this.header = [];
        this.rows = [];
    }
}
exports.MdBlock = MdBlock;
class MdSpan {
    constructor() {
        this.text = '';
        this.bold = false;
        this.italic = false;
        this.code = false;
        this.strike = false;
        /** 非空表示这是一个链接（存 href） */
        this.link = '';
        /** 非空表示这是一张图片（存 src）——xbot 的图片引用是 cookie 鉴权端点，需自行取字节渲染 */
        this.image = '';
    }
}
exports.MdSpan = MdSpan;
function parseMarkdown(src) {
    const blocks = [];
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let para = [];
    const flushPara = () => {
        if (para.length === 0) {
            return;
        }
        const b = new MdBlock();
        b.kind = MdBlockKind.Paragraph;
        b.text = para.join('\n');
        blocks.push(b);
        para = [];
    };
    while (i < lines.length) {
        const raw = lines[i];
        const line = raw.replace(/\s+$/, '');
        // 空行 → 段落结束
        if (line.trim().length === 0) {
            flushPara();
            i++;
            continue;
        }
        // 围栏代码块
        const fence = line.match(/^\s*(```+|~~~+)\s*([\w#+-]*)\s*$/);
        if (fence !== null) {
            flushPara();
            const marker = fence[1].charAt(0);
            const b = new MdBlock();
            b.kind = MdBlockKind.Code;
            b.lang = fence[2] !== undefined ? fence[2] : '';
            i++;
            const body = [];
            while (i < lines.length) {
                const l = lines[i];
                if (l.trim().startsWith(marker.repeat(3))) {
                    i++;
                    break;
                }
                body.push(l);
                i++;
            }
            b.code = body.join('\n');
            blocks.push(b);
            continue;
        }
        // 分隔线
        if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
            flushPara();
            const b = new MdBlock();
            b.kind = MdBlockKind.Divider;
            blocks.push(b);
            i++;
            continue;
        }
        // 标题
        const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
        if (h !== null) {
            flushPara();
            const b = new MdBlock();
            b.kind = MdBlockKind.Heading;
            b.level = h[1].length;
            b.text = h[2].trim();
            blocks.push(b);
            i++;
            continue;
        }
        // 引用（连续行合并）
        if (/^\s{0,3}>\s?/.test(line)) {
            flushPara();
            const body = [];
            while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
                body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
                i++;
            }
            const b = new MdBlock();
            b.kind = MdBlockKind.Quote;
            b.text = body.join('\n');
            blocks.push(b);
            continue;
        }
        // 表格（表头 + 分隔行）
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
            flushPara();
            const b = new MdBlock();
            b.kind = MdBlockKind.Table;
            b.header = splitRow(line);
            i += 2;
            while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim().length > 0) {
                b.rows.push(splitRow(lines[i]));
                i++;
            }
            blocks.push(b);
            continue;
        }
        // 列表（- / * / + 或 1. ）
        const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (li !== null) {
            flushPara();
            const b = new MdBlock();
            b.kind = MdBlockKind.List;
            b.ordered = /\d/.test(li[2]);
            b.level = Math.floor(li[1].length / 2);
            while (i < lines.length) {
                const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
                if (m === null) {
                    break;
                }
                b.items.push(m[3]);
                i++;
            }
            blocks.push(b);
            continue;
        }
        para.push(line.trim());
        i++;
    }
    flushPara();
    return blocks;
}
function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) {
        s = s.substring(1);
    }
    if (s.endsWith('|')) {
        s = s.substring(0, s.length - 1);
    }
    const cells = s.split('|');
    const out = [];
    for (let k = 0; k < cells.length; k++) {
        out.push(cells[k].trim());
    }
    return out;
}
/** 行内解析：粗体 / 斜体 / 行内码 / 删除线 / 链接。 */
function parseInline(text) {
    const spans = [];
    let buf = '';
    let i = 0;
    const pushPlain = (bold, italic, strike) => {
        if (buf.length === 0) {
            return;
        }
        const s = new MdSpan();
        s.text = buf;
        s.bold = bold;
        s.italic = italic;
        s.strike = strike;
        spans.push(s);
        buf = '';
    };
    while (i < text.length) {
        // 行内代码
        if (text.charAt(i) === '`') {
            const end = text.indexOf('`', i + 1);
            if (end > i) {
                pushPlain(false, false, false);
                const s = new MdSpan();
                s.text = text.substring(i + 1, end);
                s.code = true;
                spans.push(s);
                i = end + 1;
                continue;
            }
        }
        // 图片 ![alt](src)
        if (text.charAt(i) === '!' && text.charAt(i + 1) === '[') {
            const close = text.indexOf(']', i + 2);
            if (close > i && text.charAt(close + 1) === '(') {
                const paren = text.indexOf(')', close + 2);
                if (paren > close) {
                    pushPlain(false, false, false);
                    const s = new MdSpan();
                    s.text = text.substring(i + 2, close);
                    s.image = text.substring(close + 2, paren);
                    spans.push(s);
                    i = paren + 1;
                    continue;
                }
            }
        }
        // 链接 [text](href)
        if (text.charAt(i) === '[') {
            const close = text.indexOf(']', i + 1);
            if (close > i && text.charAt(close + 1) === '(') {
                const paren = text.indexOf(')', close + 2);
                if (paren > close) {
                    pushPlain(false, false, false);
                    const s = new MdSpan();
                    s.text = text.substring(i + 1, close);
                    s.link = text.substring(close + 2, paren);
                    spans.push(s);
                    i = paren + 1;
                    continue;
                }
            }
        }
        // 粗体 **text** 或 __text__
        if (text.startsWith('**', i) || text.startsWith('__', i)) {
            const marker = text.substring(i, i + 2);
            const end = text.indexOf(marker, i + 2);
            if (end > i) {
                pushPlain(false, false, false);
                const s = new MdSpan();
                s.text = text.substring(i + 2, end);
                s.bold = true;
                spans.push(s);
                i = end + 2;
                continue;
            }
        }
        // 删除线 ~~text~~
        if (text.startsWith('~~', i)) {
            const end = text.indexOf('~~', i + 2);
            if (end > i) {
                pushPlain(false, false, false);
                const s = new MdSpan();
                s.text = text.substring(i + 2, end);
                s.strike = true;
                spans.push(s);
                i = end + 2;
                continue;
            }
        }
        // 斜体 *text* 或 _text_
        const ch = text.charAt(i);
        if ((ch === '*' || ch === '_') && !text.startsWith(ch + ch, i)) {
            const end = text.indexOf(ch, i + 1);
            if (end > i + 1) {
                pushPlain(false, false, false);
                const s = new MdSpan();
                s.text = text.substring(i + 1, end);
                s.italic = true;
                spans.push(s);
                i = end + 1;
                continue;
            }
        }
        buf += text.charAt(i);
        i++;
    }
    pushPlain(false, false, false);
    return spans;
}
/** 供预览/通知类场景用的纯文本化（去掉标记）。 */
function markdownToPlain(src) {
    const blocks = parseMarkdown(src);
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.kind === MdBlockKind.Code) {
            out.push(b.code);
        }
        else if (b.kind === MdBlockKind.List) {
            out.push(b.items.join(' '));
        }
        else if (b.kind === MdBlockKind.Table) {
            out.push(b.header.join(' '));
        }
        else if (b.text.length > 0) {
            const spans = parseInline(b.text);
            let line = '';
            for (let k = 0; k < spans.length; k++) {
                line += spans[k].text;
            }
            out.push(line);
        }
    }
    return out.join('\n');
}
