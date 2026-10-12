/**
 * files.ets —— **文件管理**的纯逻辑（目标④「文件管理也没有」）。
 *
 * 权威契约（**服务端源码逐字**，`channel/web/web_fs.go` + `web_rest.go`）：
 *   · `POST /api/fs/list` body `{path?, show_hidden?}` → `{entries:[{name,isDir,size,mode,modTime}]}`
 *     （handler 把 POST body 折成 GET query `showHidden=true` ⇒ 后端只认 `show_hidden` 这个键）
 *   · `POST /api/fs/read` body `{path, raw?}` → `{content, language, size, isBinary, encoding?}`
 *     （`raw:true` 走 `GET /api/fs/raw` 出字节流，图片预览用）
 *   · `POST /api/fs/search` body `{query, path?, limit?, show_hidden?}` → `{results:[{path,name,isDir}]}`
 *   ⛔ 端点前缀是 **`/api/fs/`**，不是 `/api/files/`（后者只有 upload/download/viewimg）——
 *      本仓 `core/reqbody.ets` 的注释曾把二者混写，本模块以**服务端源码**为准。
 *
 * 排序口径逐字对齐 web `hooks/useFileSystem.ts:96-99`：
 *   「directories first, then alphabetical」= `isDir` 降序 + `name.localeCompare`。
 *
 * ⛔ 本文件是**纯逻辑**（无 ArkUI/无 `@ohos.*`）⇒ 可被 `tools/tests/run.sh` 当纯 TS 编译，
 *    判据与渲染**同源**（组件的目录序/图标/大小文案全部读这里，⛔ 组件不自写第二套）。
 */

/** 一次 `/api/fs/list` 的条目（= 服务端 `fsListEntry`）。 */
export interface FsFileEntry {
  name: string;
  isDir: boolean;
  size: number;
  /** 权限串（如 `-rw-r--r--`）；服务端总是给，客户端按需用。 */
  mode?: string;
  /** RFC3339 时间串（服务端 `time.Time` 的 JSON）。 */
  modTime?: string;
}

/** `/api/fs/read` 的响应（= 服务端 `fsReadResponse`）。 */
export interface FsReadResult {
  content: string;
  language: string;
  size: number;
  isBinary: boolean;
  encoding?: string;
}

/** 预览种类（驱动图标 + 预览器选择；⛔ 单一判据，组件不再各写一份后缀判断）。 */
export const FK_DIR: string = 'dir';
export const FK_IMAGE: string = 'image';
export const FK_MARKDOWN: string = 'markdown';
export const FK_TEXT: string = 'text';

const IMAGE_EXT: string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const MARKDOWN_EXT: string[] = ['md', 'markdown'];

/** 小写化扩展名（无扩展名 ⇒ 空串）。`'a.b/c'` 这类路径片段不会被误判。 */
export function extOf(name: string): string {
  const i: number = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) {
    return '';
  }
  return name.slice(i + 1).toLowerCase();
}

/** 预览种类。目录优先；图片/`markdown` 各一档，其余一律文本（服务端 `isBinary` 再兜一道）。 */
export function fileKindOf(name: string, isDir: boolean): string {
  if (isDir) {
    return FK_DIR;
  }
  const e: string = extOf(name);
  for (let i = 0; i < IMAGE_EXT.length; i++) {
    if (IMAGE_EXT[i] === e) {
      return FK_IMAGE;
    }
  }
  for (let i = 0; i < MARKDOWN_EXT.length; i++) {
    if (MARKDOWN_EXT[i] === e) {
      return FK_MARKDOWN;
    }
  }
  return FK_TEXT;
}

/** 路径父级（posix；根的父仍是根）。空串 ⇒ 根。 */
export function parentPath(p: string): string {
  const s: string = p.length > 0 ? p : '/';
  if (s === '/') {
    return '/';
  }
  // 去掉尾部斜杠（`/a/b/` → `/a/b`），避免把空段当最后一段。
  let end: number = s.length;
  while (end > 1 && s.charAt(end - 1) === '/') {
    end = end - 1;
  }
  const trimmed: string = s.slice(0, end);
  const i: number = trimmed.lastIndexOf('/');
  if (i < 0) {
    return '/';            // 相对路径 `a/b` 的父是 `a`；`a` 的父是根
  }
  if (i === 0) {
    return '/';
  }
  return trimmed.slice(0, i);
}

/** 路径 basename（posix；尾斜杠先规整；空/根 ⇒ 原样）。 */
export function baseNameOf(p: string): string {
  let end: number = p.length;
  while (end > 1 && p.charAt(end - 1) === '/') {
    end = end - 1;
  }
  const trimmed: string = p.slice(0, end);
  const i: number = trimmed.lastIndexOf('/');
  return i >= 0 && i < trimmed.length - 1 ? trimmed.slice(i + 1) : trimmed;
}

/** 拼接子路径（posix）。`joinFsPath('/a/', 'b')` → `/a/b`；`dir` 为空 ⇒ `name`。 */
export function joinFsPath(dir: string, name: string): string {
  if (dir.length === 0) {
    return name;
  }
  const d: string = dir.charAt(dir.length - 1) === '/' ? dir : `${dir}/`;
  return `${d}${name}`;
}

/**
 * 目录列表排序 —— 逐字对齐 web `useFileSystem.ts:96-99`：
 * 「directories first, then alphabetical」（`a.isDir !== b.isDir ⇒ a.isDir ? -1 : 1`，
 * 同级 `name.localeCompare(b.name)`）。
 *
 * ⛔ 返回**新数组**（不改入参）；`localeCompare` 在 ArkTS 可用（ES 标准）；
 *    ⛔ 不区分大小写的"手工比较"会与 web 口径分叉 ⇒ 一律走 `localeCompare`。
 */
export function sortFsEntries(entries: readonly FsFileEntry[]): FsFileEntry[] {
  const out: FsFileEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    out.push(entries[i]);
  }
  out.sort((a: FsFileEntry, b: FsFileEntry): number => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * 目录列表**过滤**（内联搜索）—— 逐字对齐 web `sidebar/FileExplorer.tsx:124-131`：
 *   `q = query.trim().toLowerCase()`；空 ⇒ **不过滤**（返回全量，web 是"退出搜索态"）；
 *   否则 `name.toLowerCase().includes(q)`（大小写不敏感**子串**，非前缀、非模糊打分）。
 *
 * ⚠️ 只匹配 `name`：web 那一版还匹配 `path`，因为它的 `flatFiles` 是**递归平铺**的整棵树；
 *    本仓是**单目录**浏览器（`fsListBody` 一次只列一层）⇒ `path` 前缀恒等于当前目录，
 *    再拿它匹配只会让"当前目录里的每个条目都命中"（假命中）⇒ 这里**只按 name**，语义等价。
 *
 * ⛔ 返回**新数组**（不改入参）；已按调用方的既有排序传进来（本函数**不重排**）。
 */
export function filterFsEntries(entries: readonly FsFileEntry[], query: string): FsFileEntry[] {
  const q: string = query !== undefined && query !== null ? query.trim().toLowerCase() : '';
  if (q.length === 0) {
    const all: FsFileEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      all.push(entries[i]);
    }
    return all;
  }
  const out: FsFileEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: FsFileEntry = entries[i];
    const n: string = e.name !== undefined && e.name !== null ? e.name.toLowerCase() : '';
    if (n.indexOf(q) >= 0) {
      out.push(e);
    }
  }
  return out;
}

/** 过滤输入框的占位文案（web `sidebar.filterPlaceholder`）。 */
export function fsFilterPlaceholder(): string {
  return '按名称过滤（当前目录）';
}

/** 过滤无命中时的一行空态（⛔ 不静默：用户必须知道"是过滤没命中"而不是"目录是空的"）。 */
export function fsFilterEmptyText(query: string): string {
  const q: string = query !== undefined && query !== null ? query.trim() : '';
  return q.length === 0 ? '空目录' : `没有匹配「${q}」的条目`;
}

/**
 * 人类可读大小（Apple 风格：`1.5 KB` / `3.4 MB`）。
 * 进制用 **1024**（与 Finder/`du -h` 同族，用户可预期）；`1.0` 也保留一位小数
 * （`1.0 KB` > 裸 `1 KB`：数字列宽度一致，列表不抖）。
 */
export function fmtSize(bytes: number): string {
  if (!(bytes > 0)) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.floor(bytes)} B`;
  }
  const units: string[] = ['KB', 'MB', 'GB', 'TB'];
  let v: number = bytes / 1024;
  let u: number = 0;
  while (v >= 1024 && u < units.length - 1) {
    v = v / 1024;
    u = u + 1;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

/** 相对时间（列表用）：<60s「刚刚」、<60m「N 分钟前」、<24h「N 小时前」、否则「N 天前」。 */
export function fmtAgo(ms: number, nowMs: number): string {
  const d: number = nowMs - ms;
  if (!(d > 0)) {
    return '刚刚';
  }
  const s: number = Math.floor(d / 1000);
  if (s < 60) {
    return '刚刚';
  }
  const m: number = Math.floor(s / 60);
  if (m < 60) {
    return `${m} 分钟前`;
  }
  const h: number = Math.floor(m / 60);
  if (h < 24) {
    return `${h} 小时前`;
  }
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 面包屑分段（从根到当前目录）—— 返回 `{label, path}` 序列，供原生面包屑组件渲染。
 * 根永远是第一段（`/`）；⛔ 组件不再自己 split（判据同源）。
 */
export interface FsCrumb {
  label: string;
  path: string;
}

export function fsCrumbs(path: string): FsCrumb[] {
  const s: string = path.length > 0 && path.charAt(0) === '/' ? path : `/${path}`;
  const out: FsCrumb[] = [{ label: '/', path: '/' }];
  const parts: string[] = s.split('/');
  let acc: string = '';
  for (let i = 0; i < parts.length; i++) {
    const seg: string = parts[i];
    if (seg.length === 0) {
      continue;
    }
    acc = `${acc}/${seg}`;
    out.push({ label: seg, path: acc });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 隐藏文件（`show_hidden`）—— web 契约里**已有**而原生此前未接的能力
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `POST /api/fs/list` 的请求体（= 服务端 `handleFsListPOST` 的匿名 body）。
 *
 * ⛔⛔ **键名是 `show_hidden`（下划线），不是 `showHidden`** —— 这是本能力的头号 footgun：
 *   服务端 **POST body** 认 `show_hidden`，随后 `query.Set("showHidden", "true")` 折成 GET query，
 *   而 `handleFsList` 读的是 query 键 **`showHidden`（驼峰）**。写错任一处 ⇒ 服务端**静默忽略**
 *   ⇒ 开关点了没反应（无报错、无日志），只有**真机点一次看有没有 dotfile** 才能发现。
 *   逐字取证：`channel/web/web_rest.go:448-461`（body 解码 + 折 query）、
 *   `channel/web/web_fs.go:203-210`（query 读取 + `isHidden` 过滤）。
 */
export interface FsListBody {
  path: string;
  show_hidden: boolean;
}

/** 组 `/api/fs/list` 请求体（**判据与请求同源**；空路径归一为根 `/`，同服务端 `rawPath == "" ⇒ "/"`）。 */
export function fsListBody(path: string, showHidden: boolean): FsListBody {
  return { path: path.length > 0 ? path : '/', show_hidden: showHidden };
}

/**
 * 隐藏文件开关的**可访问读法**（开关是颜色态 ⇒ 必须另有可读文本，⛔ 不许只靠颜色表达状态）。
 * 视觉标签固定「隐藏文件」，状态由这里补全（真机读屏 / UI 走查用）。
 */
export function fsHiddenToggleLabel(show: boolean): string {
  return show ? '不显示隐藏文件' : '显示隐藏文件';
}

// ══════════════════════════════════════════════════════════════════════════════
// 代码预览（非图片/非 markdown 的文本文件）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 代码预览的语言标识：**服务端 `language` 优先**（`/api/fs/read` 由后端按扩展名/内容判定），
 * 缺失时回落本仓 `extOf(name)`（大小写已归一）。两者都空 ⇒ 空串（`prismLangName` 会回落纯文本）。
 *
 * ⛔ 单一判据：组件**不自己**判断后缀（与 `fileKindOf` 同一模块）。
 */
export function fsCodeLanguage(name: string, language: string): string {
  const l: string = language !== undefined && language !== null ? language.trim() : '';
  if (l.length > 0) {
    return l.toLowerCase();
  }
  return extOf(name);
}

/**
 * 把文件内容包成 **markdown 围栏代码块**，用于复用聊天侧**同一套**代码渲染
 * （Prism4j 高亮 / 复制条 / `wrapCode` 溢出策略 / 圆角沉底）——⛔ 面板不另写一个"文件代码视图"。
 *
 * ⛔ **围栏长度必须自证安全**：内容里若自带 `` ``` `` 会把围栏提前闭合 ⇒ 后半段被当正文解析
 *   （最坏情况：整块高亮崩掉、行号错位）。`CommonMark` 规定「围栏长度 ≥ 内容中任意反引号串」
 *   ⇒ 这里取 `max(3, 最长连续反引号串 + 1)`，并统一用反引号（内容含 `~~~` 不影响）。
 */
export function fsCodeFence(name: string, language: string, content: string): string {
  const lang: string = fsCodeLanguage(name, language);
  const body: string = content !== undefined && content !== null ? content : '';
  let run: number = 0;
  let best: number = 0;
  for (let i = 0; i < body.length; i++) {
    if (body.charAt(i) === '`') {
      run = run + 1;
      if (run > best) {
        best = run;
      }
    } else {
      run = 0;
    }
  }
  let fenceLen: number = best + 1;
  if (fenceLen < 3) {
    fenceLen = 3;
  }
  let fence: string = '';
  for (let i = 0; i < fenceLen; i++) {
    fence = `${fence}\``;
  }
  const tail: string = body.length > 0 && body.charAt(body.length - 1) === '\n' ? '' : '\n';
  return `${fence}${lang}\n${body}${tail}${fence}\n`;
}
