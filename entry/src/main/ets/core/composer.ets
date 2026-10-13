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

/**
 * 主输入框的**占位文案**（随 busy / 插话变化）—— 语义逐字移植 web
 * `MessageInput.tsx:214-221`：`interruptMode ? interject : busy ? busy : default`
 * （web 还有 `goalMode` 首分支与 `sendKeyMode` 末分支，**为何原生都没有**见下两段）。
 *
 * **为什么不是一句静态「发消息…」**（2026-10-14 面板审计钓出：web 分状态、原生恒一句）：
 *   · busy 时用户**看得见的下一条反馈**就是输入框本身；web 在这里明说「消息将排队」——
 *     原生只说「发消息」，用户按下去是排队还是打断**无从预判**（`core/sendmode.ets` 的 chip 只标模式名，
 *     且 chip 是 `busy` 才出现的次要控件）。
 *   · 插话语义**与普通发送相反**（注入当前回合、不排队、不产生 user 行）⇒ 必须提前说清，
 *     不能等用户点下去才用 toast 解释。
 *
 * ⛔ **两处与 web 的**有意**差异（都是"原生 ≠ 桌面"的适配，不是发明）**：
 *   ① **无 `goalMode` 分支**：原生「目标输入」是**独立字段**（`goalDraft`，「添加目标」内联输入），
 *      不共用本输入框 ⇒ 本输入框永处非 goal 态。
 *   ② **无 `sendKeyMode` 分支**（web 的 `（Ctrl+Enter 发送）` / `（Enter 发送）`）：**真机实测**
 *      输入框可用宽 = **240vp**（`type.body` 15vp），web 桌面文案（`给 Agent 发消息…（Ctrl+Enter 发送）`）
 *      需 ≈256vp ⇒ **换行成两行并被裁**（`v_busy.jpeg` 实测「…消息将排 / 队…」）。而"回车键什么行为"
 *      在原生平台本就有**专属机制** —— `enterKeyType(Send | NEW_LINE)`（软键盘回车键的**标签**本身就是
 *      「发送」/「换行」，见 `Index.ets` 同一输入框上那行）⇒ 把桌面按键提示塞进 placeholder 是
 *      **重复表达 + 必换行**，Apple 平台惯例也是走键盘键型。**故原生占位文案一律压到单行**。
 *
 * ⛔ **优先级顺序与 web 逐字一致**（`interject` 先于 `busy`）。两者实践中不同时为真
 *   （`interruptMode` 在 busy→false 时被复位，见 `Index.ets` 的复位分支 + `sendmode.test.ts`），
 *   但仍按 web 顺序判 —— 否则将来新增「离线排队」之类状态时语义会静默漂移。
 * ⛔ 本函数**不读 `pal()` / 主题 / 任何全局**（纯逻辑 ⇒ 可脱机单测；文案与颜色解耦）。
 * 判据：`tools/tests/composer.test.ts`（三态互异 + 优先级 + 单行预算）。
 */
export function composerPlaceholder(busy: boolean, interject: boolean): string {
  if (interject) {
    return '插话：立即注入当前回合…';
  }
  if (busy) {
    return '处理中 — 消息将排队…';
  }
  return '给 Agent 发消息…';
}

/**
 * 占位文案的**单行预算**（设备无关，单位 vp）—— 判据用，不参与渲染。
 *
 * 由来（2026-10-14 真机实测）：主输入框可用宽 = 屏宽 440vp − 附件/图片两枚图标 − 模式 chip −
 * 发送键 − 各处内边距 ≈ **240vp**。占位文案**超一行会被裁**（实测 `210vp` 的串已贴边，
 * 故留 ~12% 余量取 `210vp` 为上限）。⛔ 改文案时必须过这条闸，别只在脑子里估长度。
 */
export function composerPlaceholderBudgetVp(): number {
  return 210;
}

/**
 * 估一条中文/拉丁混排串的**渲染宽度（vp）**—— 判据用（`type.body` 15vp 档）。
 *
 * 逐类计宽（实测标定，误差 ~±8%）：CJK/全角标点/`…` = **1.0em**；ASCII 字母数字 = **0.5em**；
 * 空格 = **0.25em**。⛔ 只求"能拦住换行"的判别力，不求像素级精确 —— 但**必须**比"目测"可靠。
 */
export function estimateTextWidthVp(text: string, fontSize: number): number {
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const c: number = text.charCodeAt(i);
    if (c === 32) {
      em += 0.25;                                   // 空格
    } else if (c < 128) {
      em += 0.5;                                    // ASCII
    } else {
      em += 1.0;                                    // CJK / 全角 / `…`
    }
  }
  return em * fontSize;
}

/**
 * 主按钮簇（**模式 chip + 唯一主按钮**）的同源语义 —— **纯逻辑**（可脱机单测）。
 *
 * ── 为什么必须抽成纯函数（本仓铁律「判据与渲染必须同源」，2026-10-15 审计实测）──────────
 *   此前页面里有**两套"回合在跑"判据**同时驱动同一个按钮簇：
 *     · 主按钮（图标/底色/阴影/无障碍/点击）= `runningNow()`（= `busyNow(busySignals())`
 *       —— 页面注释亲口记的**统一**判据，修的是 2026-10-10「按钮=停止、列表=空」那批 P0）；
 *     · 模式 chip（排队/⚡ 插话）= **裸 `this.busy`**（`store.busy` 投影）。
 *   两者在若干窗口内会分叉（如 `askUser-pending` 时 `store.busy` 因互斥为 false，而
 *   `busyNow(…)` 仍可为 true）⇒ 用户会看到「停止按钮 + 没有模式 chip」「占位文案说'发消息'
 *   而按钮是停止」这类**自相矛盾**的按钮簇。⇒ 收进本函数：**一个 `running` 入参**，
 *   所有消费者（chip / 按钮 / 占位文案）只准读它的产物。
 *
 * ⛔ 本函数**不读 `pal()` / 主题 / 任何全局**（纯逻辑 ⇒ 可脱机单测 + mutation 自证）。
 * 判据：`tools/tests/composer.test.ts`（不变量 + 判别力 + mutation）。
 */
export class ComposerButton {
  /** **唯一的"回合在跑"出口**（入参 `running` 的产物）—— chip 可见性、占位文案的 busy、
   *  按钮语义**全部**读它（⛔ 页面里不得再有第二个 busy 源）。 */
  running: boolean = false;
  /** 主按钮 = **停止**（回合在跑 **且** 没有可发送内容 —— 有内容时按钮让位给"发送"）。 */
  showStop: boolean = false;
  /** 主按钮 = 停止 **且** 取消请求在飞 ⇒ 转圈（web `MessageInput.tsx:938` `cancelling && !canSend && busy`）。 */
  cancelling: boolean = false;
  /** ⚡ 插话图标（回合在跑 **且** 有内容 **且** 插话模式 ⇒ 点的这一下会注入当前回合）。 */
  interject: boolean = false;
}

/**
 * @param running        "回合在跑"（页面唯一判据 `runningNow()` ⇒ 会话隔离 + `busyNow(busySignals())`）
 * @param hasContent     输入框有正文或待发附件（`composerCanSend`）
 * @param cancelInFlight `store.cancelling`（取消请求在飞）
 * @param interjectMode  `isInterruptSend(running, sendMode)`（不忙时恒为 false —— 插话只对在跑的回合有意义）
 */
export function composerButtonState(running: boolean, hasContent: boolean,
  cancelInFlight: boolean, interjectMode: boolean): ComposerButton {
  const b: ComposerButton = new ComposerButton();
  // ① 唯一的"回合在跑"出口 —— chip / 占位 / 按钮**全部**从这里取，⛔ 不设第二个 busy 源。
  b.running = running;
  b.showStop = running && !hasContent;
  b.cancelling = b.showStop && cancelInFlight;
  b.interject = running && hasContent && interjectMode;
  return b;
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
