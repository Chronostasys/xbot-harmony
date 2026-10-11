/**
 * 「路径选择器」自动补全的**纯逻辑** —— 逐字移植 web `components/session/PathPicker.tsx`
 * 的 `parseInput`（`:209-224`）、目录过滤（`:59-63`）与下钻（`:88-97 navigateInto`）。
 *
 * 为什么单独一个模块（⛔ 不复用 `core/composer.parentDir`）：两者**语义不等价** ——
 *   · web `parseInput` 对 **尾斜杠** 有专门分支（`/root/` ⇒ 列 `/root` 的内容，prefix 空），
 *   · 原生 `parentDir` 也区分尾斜杠，但它的输出是「父目录」（`/a/b` → `/a`），
 *     而 web 要的是「**这个目录**」（`/a/b/` → `/a/b`）⇒ 直接在 `/a/b/` 上复用会**列错一层**。
 *   语义既然不同 ⇒ 用**自己的**纯函数（判据与渲染同源，见 `tools/tests/pathpick.test.ts`）。
 *
 * ⚠️ 与 web 的一处**有意差异**：web `listDir(dirPath, showHidden=true)`（`PathPicker.tsx:57`）
 *   会带 `show_hidden:true`；原生沿用既有的 `store.listFs(path)`（只发 `{path}`，不带 show_hidden）
 *   —— 与页面 `@` 文件补全**同一取数入口**（⛔ 不为此新开第二个 RPC / 不改 `listFs` 契约）。
 *   影响面：隐藏目录（如 `.config`）不进候选；非隐藏路径选择**逐字一致**。
 *
 * 纯函数 ⇒ 可脱机单测。本文件属 `core/`，被 `tools/tests/run.sh` 当**纯 TS** 编译
 * ⇒ **禁止** import ArkUI / `@ohos.*`。
 */

import { FsEntry } from './composer';

/** 路径输入解析结果：要列的目录 + 要按前缀过滤的名字段。 */
export class PathInput {
  dirPath: string = '/';
  prefix: string = '';

  constructor(dirPath: string, prefix: string) {
    this.dirPath = dirPath;
    this.prefix = prefix;
  }
}

/**
 * 把「路径输入框的值」解析成「列哪个目录 + 按什么前缀过滤」—— 逐字对齐 web `parseInput`
 * （`PathPicker.tsx:209-224`，VSCode 风格：「我在哪 + 我在打什么」）。
 *
 *   `/`           → dirPath=`/`, prefix=``         列 `/` 下全部
 *   `/r`          → dirPath=`/`, prefix=`r`        过滤 `/` 下以 r 开头的目录
 *   `/root/`      → dirPath=`/root`, prefix=``     列 `/root` 下全部
 *   `/root/Co`    → dirPath=`/root`, prefix=`Co`
 *
 * ⚠️ **web 自身的 doc/code 不符**（已逐字核对 `PathPicker.tsx:209-224` 原文）：
 *   其**头部注释**写 `"/r" → dirPath="/", prefix="r"`，但**代码** `if (lastSlash <= 0) return { dirPath: '/', prefix: trimmed }`
 *   ⇒ 实际 prefix = **`trimmed`（即 `'/r'`）**。本模块**镜像 web 代码（行为权威）**，
 *   ⛔ 不要"顺手修"成 `slice(1)`（那会与 web 分叉）；如要改，**两端一起改**并同步本注释。
 */
export function parsePathInput(input: string): PathInput {
  const trimmed: string = input.trim();
  if (trimmed.length === 0) {
    return new PathInput('/', '');
  }
  if (trimmed.endsWith('/')) {
    // `trimmed.replace(/\/+$/, '') || '/'`（⛔ 用循环剥尾斜杠，避免 ArkTS 正则面）
    let clean: string = trimmed;
    while (clean.length > 1 && clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    if (clean.length === 0 || clean === '/') {
      return new PathInput('/', '');
    }
    return new PathInput(clean, '');
  }
  const lastSlash: number = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) {
    return new PathInput('/', trimmed);
  }
  return new PathInput(trimmed.substring(0, lastSlash), trimmed.substring(lastSlash + 1));
}

/**
 * 从一次 `listFs(dirPath)` 的**原始条目**里取「子目录候选」并按前缀过滤
 * —— 逐字对齐 web `PathPicker.tsx:59-63`：
 *   `all.filter(e => e.isDir)` 后再 `name.toLowerCase().startsWith(prefix.toLowerCase())`（**前缀**匹配）。
 *
 * ⚠️ 只保留目录（web 同口径）；保持服务端下发顺序（web 亦不重排）。
 */
export function filterChildDirs(entries: FsEntry[], prefix: string): FsEntry[] {
  const q: string = prefix.toLowerCase();
  const out: FsEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: FsEntry = entries[i];
    if (!e.isDir) {
      continue;
    }
    if (q.length > 0 && e.name.toLowerCase().indexOf(q) !== 0) {
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * 下钻进一个候选目录后的**新输入值** —— 逐字对齐 web `navigateInto`（`PathPicker.tsx:90-91`）：
 *   `fullPath = entry.name === '/' ? '/' : \`${dirPath === '/' ? '' : dirPath}/${entry.name}\``
 *   然后 `onChange(fullPath + '/')`（**带尾斜杠** ⇒ 下一次解析即列该目录内容）。
 *
 * 例：`childPath('/', 'root')` = `'/root/'`；`childPath('/a', 'b')` = `'/a/b/'`。
 */
export function childPath(dirPath: string, name: string): string {
  const fullPath: string = name === '/'
    ? '/'
    : `${dirPath === '/' ? '' : dirPath}/${name}`;
  return `${fullPath}/`;
}
