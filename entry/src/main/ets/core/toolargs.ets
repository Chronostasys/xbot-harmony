/**
 * 工具参数里的**文件路径 / 语言推断 / 字段抽取** —— 纯函数，可脱机单测。
 *
 * 移植自 web `components/agent/ToolRender.tsx`：
 *   · `EXT_LANG` + `langFromPath()`  —— 扩展名 ⇒ 高亮语言 id；
 *   · `filePathFromLabel()`          —— 从标签/参数里取文件路径。
 *
 * 用途：FileCreate / FileReplace / Read 的浮层要按**文件语言**给内容着色
 * （用户 2026-10-10：「filecreate 也要高亮」），而不是把整段内容当 JSON 串显示。
 *
 * ⚠️ web 的 EXT_LANG 目标是 highlight.js 的语言 id；这里映射到 **Prism4j** 认得的
 *    语言名（`core/highlight.ets` 的 `prismLangName` 会再做一次归一）。Prism4j 未覆盖的
 *    语言返回其原 id ⇒ `supportsLang` 判否 ⇒ 退化为纯文本（绝不乱着色）。
 */

/** 扩展名 ⇒ 语言 id（值取 Prism4j 语言名；未覆盖的保持原名，靠 `supportsLang` 兜底）。 */
function extToLang(ext: string): string {
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts') { return 'typescript'; }
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') { return 'javascript'; }
  if (ext === 'go') { return 'go'; }
  if (ext === 'py') { return 'python'; }
  if (ext === 'rb') { return 'ruby'; }
  if (ext === 'rs') { return 'rust'; }
  if (ext === 'java') { return 'java'; }
  if (ext === 'kt' || ext === 'kts') { return 'kotlin'; }
  if (ext === 'swift') { return 'swift'; }
  if (ext === 'c' || ext === 'h') { return 'c'; }
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp') { return 'cpp'; }
  if (ext === 'cs') { return 'csharp'; }
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') { return 'bash'; }
  if (ext === 'json') { return 'json'; }
  if (ext === 'yaml' || ext === 'yml') { return 'yaml'; }
  if (ext === 'toml' || ext === 'ini') { return 'ini'; }
  if (ext === 'md' || ext === 'markdown') { return 'markdown'; }
  if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg') { return 'markup'; }
  if (ext === 'css') { return 'css'; }
  if (ext === 'sql') { return 'sql'; }
  if (ext === 'dart') { return 'dart'; }
  if (ext === 'scala') { return 'scala'; }
  if (ext === 'groovy') { return 'groovy'; }
  if (ext === 'clj' || ext === 'cljs') { return 'clojure'; }
  if (ext === 'tex') { return 'latex'; }
  if (ext === 'diff' || ext === 'patch') { return 'diff'; }
  if (ext === 'ets') { return 'typescript'; }  // ArkTS ≈ TS 语法
  return '';
}

/** 路径 ⇒ 语言 id（无扩展名/未知 ⇒ 空串 = 不着色）。 */
export function langFromPath(path: string): string {
  const s: string = path.trim();
  if (s.length === 0) { return ''; }
  const slash: number = s.lastIndexOf('/');
  const base: string = slash >= 0 ? s.substring(slash + 1) : s;
  const lower: string = base.toLowerCase();
  // 无扩展名的常见文件（web 同款特判）
  if (lower.indexOf('dockerfile') === 0) { return 'dockerfile'; }
  if (lower.indexOf('makefile') === 0) { return 'makefile'; }
  if (lower === 'gemfile' || lower === 'rakefile') { return 'ruby'; }
  const dot: number = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) { return ''; }
  return extToLang(base.substring(dot + 1).toLowerCase());
}

/** 从标签里取文件路径：`"FileCreate: /x/y.ts"` ⇒ `/x/y.ts`（无前缀则原样）。 */
export function pathFromLabel(l: string): string {
  const label: string = l.trim();
  if (label.length === 0) { return ''; }
  const colon: number = label.indexOf(': ');
  return colon > 0 ? label.substring(colon + 2).trim() : label;
}

/** 文件类工具的 args 字段（`FileCreate`/`FileReplace`/`Read` 的参数几乎都是这两个）。 */
export class FileArgFields {
  path: string = '';
  content: string = '';
}

/**
 * 从工具 args（JSON 串）里取 `path` / `content`。
 *
 * ⛔ 流式参数常被截断（不是合法 JSON）⇒ 解析失败返回空字段，调用方仍显示原始 args
 *    （**绝不吞内容**）。
 */
export function fileArgFields(argsJson: string): FileArgFields {
  const out: FileArgFields = new FileArgFields();
  const s: string = argsJson.trim();
  if (s.length === 0 || s.charAt(0) !== '{') { return out; }
  try {
    const o: FileArgFields = JSON.parse(s) as FileArgFields;
    out.path = typeof o.path === 'string' ? o.path : '';
    out.content = typeof o.content === 'string' ? o.content : '';
  } catch (e) {
    return out;
  }
  return out;
}

/** 该工具名是否是「文件类」（浮层按语言高亮其内容）。 */
export function isFileTool(name: string): boolean {
  return name === 'FileCreate' || name === 'FileReplace' || name === 'Write' || name === 'Read';
}
