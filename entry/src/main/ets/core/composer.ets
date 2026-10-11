/**
 * 输入框补全与发送行为的**纯逻辑**（可脱机单测）。
 *
 * 两条补全（对齐 Web `useCompletion.ts`）：
 * - `/`：命令补全 —— 命令表由页面从服务端命令注册表镜像（`agent/command_builtin.go` 的 Register）；
 * - `@`：文件补全 —— 候选来自 `POST /api/fs/list {path}` → `{entries:[{name,isDir,size,mode,modTime}]}`。
 */

/** 候选上限（逐字对齐 web `useCompletion.ts:67` `const MAX_CANDIDATES = 20`）。 */
export const MAX_CANDIDATES: number = 20;

/** 一条命令候选。 */
export class CommandItem {
  name: string = '';
  desc: string = '';
}

/** 一个文件候选（服务端 `fsListEntry`）。 */
export class FsEntry {
  name: string = '';
  isDir: boolean = false;
  size: number = 0;
}

/**
 * 取当前光标前正在输入的那个 token（`/` 或 `@` 触发）。
 *
 * 规则（与 Web 一致）：从文本**末尾**往前扫，遇到空白就停；token 必须**以触发符开头**，
 * 且触发符前面是行首或空白（避免把邮箱 `a@b` 当成提及）。
 *
 * ⚠️ **命令（`/`）只在"首块"**（web `useCompletion.ts:244-252`：`isFirstBlock &&
 *   /^\s*$/.test(beforeWord)`）⇒ `/` 之前**不得有换行**；`@` 无此限制
 *   （web `detectAtPrefix` 允许 `\n` 前导，`:141-144`）。
 */
export function activeToken(text: string, trigger: string): string {
  let i: number = text.length;
  while (i > 0) {
    const ch: string = text.charAt(i - 1);
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      break;
    }
    i--;
  }
  const token: string = text.substring(i);
  if (token.length === 0 || token.charAt(0) !== trigger) {
    return '';
  }
  if (i > 0) {
    const prev: string = text.charAt(i - 1);
    if (prev !== ' ' && prev !== '\n' && prev !== '\t') {
      return '';
    }
  }
  // ⚠️ 命令补全只在首块（`/` 前有换行 ⇒ 不是命令，web `:244-251`）。
  if (trigger === '/' && text.substring(0, i).indexOf('\n') >= 0) {
    return '';
  }
  return token;
}

/** 命令候选（前缀匹配命令名；空查询返回全部）。 */
export function matchCommands(all: CommandItem[], token: string): CommandItem[] {
  const q: string = token.length > 0 ? token.substring(1).toLowerCase() : '';
  const out: CommandItem[] = [];
  for (let i = 0; i < all.length; i++) {
    const item: CommandItem = all[i];
    if (item.name.length === 0) {
      continue; // web `useCompletion.ts:254`：`!!cmd.name` 过滤空名
    }
    const name: string = item.name.toLowerCase();
    if (q.length === 0 || name.indexOf(`/${q}`) === 0) {
      out.push(item);
      if (out.length >= MAX_CANDIDATES) {
        break; // web `:262`：`.slice(0, MAX_CANDIDATES)`
      }
    }
  }
  return out;
}

/** 把正在输入的 token 替换成完整命令（保留 token 之前的内容）。 */
export function applyCommand(text: string, token: string, name: string): string {
  const head: string = token.length > 0 ? text.substring(0, text.length - token.length) : text;
  return `${head}${name} `;
}

/**
 * `@a/b` 的**过滤前缀** = 最后一个 `/` 之后的部分（web `useCompletion.ts:283-287` 的 `filterText`）。
 *
 * 为什么必须只取最后一段：`/api/fs/list` 返回的是**当前目录内**的相对名（如 `b.md`）——
 * 拿整个 `@a/b` 去做前缀匹配**永远命中不到**（条目名里没有 `a/` 前缀）⇒ 子目录下钻后补全会**全空**。
 */
export function mentionFilter(token: string): string {
  const body: string = token.length > 0 ? token.substring(1) : '';
  const slash: number = body.lastIndexOf('/');
  return slash >= 0 ? body.substring(slash + 1) : body;
}

/**
 * 文件候选。
 *
 * 逐字对齐 web `useCompletion.ts:295-302`：`name.toLowerCase().startsWith(filterText.toLowerCase())`
 * ⇒ **前缀**匹配（不是子串！），再 `.slice(0, MAX_CANDIDATES)`。
 *
 * ⚠️ **刻意偏离**：本仓把**目录排在前面**（web 保持 `/api/fs/list` 原序 = `os.ReadDir` 字母序，
 * 无目录优先，`web_fs.go:189`）—— 这是本文件既有的 UX 选择，保留并在测试里钉住。
 */
export function matchFiles(entries: FsEntry[], token: string): FsEntry[] {
  const q: string = mentionFilter(token).toLowerCase();
  const dirs: FsEntry[] = [];
  const files: FsEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: FsEntry = entries[i];
    // web `:296`：前缀匹配（原为 `indexOf(q) < 0` 子串匹配 ⇒ 会把 `localStorage.md` 匹到 `@stor`）。
    if (q.length > 0 && e.name.toLowerCase().indexOf(q) !== 0) {
      continue;
    }
    if (e.isDir) {
      dirs.push(e);
    } else {
      files.push(e);
    }
  }
  return dirs.concat(files).slice(0, MAX_CANDIDATES); // web `:297`
}

/** 把 `@token` 换成 `@路径`（目录补 `/`，便于继续往下钻）。 */
export function applyMention(text: string, token: string, name: string, isDir: boolean): string {
  const head: string = token.length > 0 ? text.substring(0, text.length - token.length) : text;
  return `${head}@${name}${isDir ? '/' : ' '}`;
}

/** 当前目录的父目录（`/a/b/` → `/a/b`；`/` → `/`）。 */
export function parentDir(path: string): string {
  let p: string = path.length === 0 ? '/' : path;
  // 以 `/` 结尾 ⇒ 用户想列的就是这个目录本身（`/a/b/` → `/a/b`）；
  // 否则上跳一级（`/a/b` → `/a`）。两种语义必须区分，否则补全列错一层。
  const endedWithSlash: boolean = p.length > 1 && p.endsWith('/');
  while (p.length > 1 && p.endsWith('/')) {
    p = p.substring(0, p.length - 1);
  }
  if (endedWithSlash) {
    return p;
  }
  const i: number = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.substring(0, i);
}

/** 把候选目录拼成完整路径（用于列下一层）。 */
export function joinPath(dir: string, name: string): string {
  const d: string = dir.endsWith('/') ? dir : `${dir}/`;
  return `${d}${name}`;
}

/**
 * 回车键在该模式下应不应该「发送」。
 *
 * - `enter` 模式：回车发送（软键盘 Enter 键类型设为 Send）；
 * - `ctrl-enter` 模式：回车换行（Enter 键类型设为 NewLine），发送靠按钮/快捷键。
 *
 * ⚠️ 取值域与权威基准 web 对齐（`'ctrl-enter' | 'enter'`）。历史上原生用 `'mod-enter'`
 * 表示同一模式（同一份服务端 key `web:ui:send-key-mode`），这里一并容忍以防御旧内存状态，
 * 但**新代码一律用 `'ctrl-enter'`**（normalizeSendKey 已把历史值迁移掉）。
 */
export function enterSends(mode: string): boolean {
  return mode !== 'ctrl-enter' && mode !== 'mod-enter';
}

/** 输入框高度上限（行数）—— 超过就内部滚动，绝不把消息区挤没。 */
export function maxComposerLines(): number {
  return 6;
}

// ── 候选浮层的**选中态 / 键盘导航**（对齐 web `useCompletion.ts:369-397` handleKeyDown）──────
//
// 为什么单列：手机上软键盘没有方向键/Tab ⇒ 键盘导航是**外接键盘 + 无障碍**的补充路径；
// 但"选中索引在边界不越界"是**可脱机判定**的纯数值语义，必须与渲染同源（判据见
// `tools/tests/completion.test.ts`）。

/** 命令浮层最多渲染的行数（选中索引只在这之内环绕 ⇒ 不会选中"看不见的一行"）。 */
export const CMD_ROWS: number = 6;
/** 文件浮层最多渲染的行数（同上）。 */
export const FS_ROWS: number = 8;

/** 把选中索引夹回 `[0, count-1]`（空候选 ⇒ 0）。候选列表变化后必须调用。 */
export function clampSel(sel: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (sel < 0) {
    return 0;
  }
  if (sel >= count) {
    return count - 1;
  }
  return sel;
}

/** ↓：循环前进（末尾回 0）。逐字对齐 web `useCompletion.ts:375` 的 `(i + 1) % len`。 */
export function selNext(sel: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (clampSel(sel, count) + 1) % count;
}

/** ↑：循环后退（0 回末尾）。逐字对齐 web `useCompletion.ts:380` 的 `(i - 1 + len) % len`。 */
export function selPrev(sel: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (clampSel(sel, count) - 1 + count) % count;
}

/**
 * 键盘动作 → 语义（web `useCompletion.ts:369-397` 的判定部分）。
 *
 * 返回 `'next' | 'prev' | 'accept' | 'close' | ''`（`''` = 不消费，交回输入框）。
 * - `ArrowDown`/`ArrowUp` ⇒ 循环导航；
 * - `Tab` ⇒ 接受（命令 / 文件皆可）；
 * - `Enter` ⇒ **仅文件**接受（web `:383`），且 `shift` 时不接受（shift+Enter = 换行）；
 * - `Escape` ⇒ 关闭浮层。
 *
 * ⚠️ **一处刻意偏离**：web 的 Enter 还要求 `!ctrl && !meta`；本仓 Enter 走 `TextArea.onSubmit`
 * （拿不到修饰键）⇒ 只判 `shift`。手机上不存在 ctrl/meta+Enter，语义等价。
 */
export function completionKeyAction(key: string, isFile: boolean, shift: boolean): string {
  if (key === 'ArrowDown') {
    return 'next';
  }
  if (key === 'ArrowUp') {
    return 'prev';
  }
  if (key === 'Tab') {
    return 'accept';
  }
  if (key === 'Enter' && isFile && !shift) {
    return 'accept';
  }
  if (key === 'Escape') {
    return 'close';
  }
  return '';
}
