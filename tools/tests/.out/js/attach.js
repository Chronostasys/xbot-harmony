"use strict";
/**
 * 附件相关的**纯逻辑**（可脱机单测）。
 *
 * 为什么单独成模块：文件名/MIME 的推导错了，后果是"上传成功但服务端类型不对/名字乱码"，
 * 只能在真机上撞见。纯函数便于钉死行为。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachItem = exports.ATTACH_FAILED = exports.ATTACH_DONE = exports.ATTACH_UPLOADING = exports.MAX_ATTACH = void 0;
exports.baseName = baseName;
exports.extensionOf = extensionOf;
exports.mimeOf = mimeOf;
exports.humanSize = humanSize;
exports.isImageMime = isImageMime;
exports.isImageName = isImageName;
exports.downloadRef = downloadRef;
exports.attachmentRef = attachmentRef;
exports.hasRef = hasRef;
exports.appendRef = appendRef;
exports.attachChipText = attachChipText;
exports.pendingCount = pendingCount;
exports.doneKeys = doneKeys;
exports.doneNames = doneNames;
exports.doneSizes = doneSizes;
exports.doneRefs = doneRefs;
exports.removeAt = removeAt;
exports.patchByUid = patchByUid;
exports.removeByUid = removeByUid;
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
// ─────────────────────────────────────────────────────────────────────────────
// P3：多选 + 图片内联 + 引用生成（纯逻辑，可脱机单测）
// ─────────────────────────────────────────────────────────────────────────────
/** 一次最多选几个文件（体感上限，服务端无硬限制）。 */
exports.MAX_ATTACH = 9;
/** 是不是图片（按 MIME）。 */
function isImageMime(mime) {
    return mime.indexOf('image/') === 0;
}
/** 是不是图片（按文件名后缀）。 */
function isImageName(name) {
    const m = mimeOf(name);
    return isImageMime(m) && m !== 'application/octet-stream';
}
/**
 * 下载引用 URL。
 *
 * 与服务端一致：`/api/files/download?key=<urlencode>`（key 里含 `/` 必须编码，
 * 否则服务端按路径切分会拿到错误的 key）。
 */
function downloadRef(key, inline) {
    return `/api/files/download?key=${encodeURIComponent(key)}${inline ? '&inline=1' : ''}`;
}
/**
 * 往消息正文里插入的附件引用。
 *
 * - 图片 → Markdown 图片（内联显示）
 * - 其他 → 带 📎 前缀的链接（可点下载）
 */
function attachmentRef(key, name, mime) {
    if (isImageMime(mime)) {
        return `![${name}](${downloadRef(key, true)})`;
    }
    return `[📎 ${name}](${downloadRef(key, false)})`;
}
/**
 * 正文里是否已经引用了这个 key —— **防重复追加**。
 *
 * 背景：Web 上曾出现「粘贴图片后发送，图片变成两张」——同一引用被追加两次。
 * 判据：正文里出现该 key 的编码形态即可（编码后再比，避免 `%2F` 与 `/` 的差异漏判）。
 */
function hasRef(content, key) {
    return content.indexOf(encodeURIComponent(key)) >= 0;
}
/** 把引用追加到正文（空正文时不留下多余空行）。 */
function appendRef(content, ref) {
    if (ref.length === 0) {
        return content;
    }
    if (content.length === 0) {
        return ref;
    }
    if (content.endsWith('\n')) {
        return `${content}${ref}`;
    }
    return `${content}\n${ref}`;
}
/** 附件的上传状态机（只有这三种，界面文案一一对应）。 */
exports.ATTACH_UPLOADING = 'uploading';
exports.ATTACH_DONE = 'done';
exports.ATTACH_FAILED = 'failed';
/** 一条附件（含上传状态与失败原因）。 */
class AttachItem {
    constructor() {
        /** 本地唯一 id（上传是并发的，**不能按下标定位**：用户中途删除会让下标错位） */
        this.uid = '';
        /** 本地 URI（失败时重试用） */
        this.uri = '';
        this.key = '';
        this.name = '';
        this.size = 0;
        this.mime = '';
        /** uploading | done | failed */
        this.status = exports.ATTACH_UPLOADING;
        this.error = '';
    }
}
exports.AttachItem = AttachItem;
/** 附件 chip 的文案（状态 + 名字 + 体积）。 */
function attachChipText(it) {
    const icon = it.status === exports.ATTACH_DONE
        ? (isImageMime(it.mime) ? '🖼' : '📎')
        : (it.status === exports.ATTACH_FAILED ? '⚠' : '⏳');
    const size = it.size > 0 ? `（${humanSize(it.size)}）` : '';
    if (it.status === exports.ATTACH_FAILED) {
        return `${icon} ${it.name} 上传失败`;
    }
    if (it.status === exports.ATTACH_UPLOADING) {
        return `${icon} 上传中… ${it.name}${size}`;
    }
    return `${icon} ${it.name}${size}`;
}
/** 还在上传中的条数（>0 ⇒ 禁止发送，否则会发出没有 key 的空附件）。 */
function pendingCount(items) {
    let n = 0;
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === exports.ATTACH_UPLOADING) {
            n++;
        }
    }
    return n;
}
/** 已就绪的 key/name/size（发送载荷只取这些 —— 失败与上传中的不带）。 */
function doneKeys(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === exports.ATTACH_DONE && items[i].key.length > 0) {
            out.push(items[i].key);
        }
    }
    return out;
}
function doneNames(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === exports.ATTACH_DONE && items[i].key.length > 0) {
            out.push(items[i].name);
        }
    }
    return out;
}
function doneSizes(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === exports.ATTACH_DONE && items[i].key.length > 0) {
            out.push(items[i].size);
        }
    }
    return out;
}
/** 已就绪的引用列表（发送前写进正文，让用户看得见发的是什么）。 */
function doneRefs(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === exports.ATTACH_DONE && items[i].key.length > 0) {
            out.push(attachmentRef(items[i].key, items[i].name, items[i].mime));
        }
    }
    return out;
}
/** 删除第 i 条（返回新数组；越界返回原数组的副本）。 */
function removeAt(items, i) {
    const out = [];
    for (let k = 0; k < items.length; k++) {
        if (k !== i) {
            out.push(items[k]);
        }
    }
    return out;
}
/** 按 uid 定位并替换一条（并发的上传完成回调用它回填；找不到返回新数组副本）。 */
function patchByUid(items, uid, key, size, status, error) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        const src = items[i];
        if (src.uid !== uid) {
            out.push(src);
            continue;
        }
        const it = new AttachItem();
        it.uid = src.uid;
        it.uri = src.uri;
        it.name = src.name;
        it.mime = src.mime;
        it.key = key;
        it.size = size;
        it.status = status;
        it.error = error;
        out.push(it);
    }
    return out;
}
/** 按 uid 删除（返回新数组；uid 不存在返回副本）。 */
function removeByUid(items, uid) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].uid !== uid) {
            out.push(items[i]);
        }
    }
    return out;
}
