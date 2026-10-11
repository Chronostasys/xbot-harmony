/**
 * 命令路由 / 深链的**纯解析层** —— 移植 web `src/lib/commandRouter.ts` 的 `parseUri()`
 * （+ `SCHEME` / `HASH_COMMAND_PREFIX` 契约）。
 *
 * ── 为什么只做解析，不做执行（分层铁律）────────────────────────────────────────
 * 本文件属 `core/`，被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 不许 import ArkUI/`@ohos.*`。
 * web 的 `CommandRouter` 既解析又执行（handler 会开面板）；原生把两件事**分开**：
 *   · **解析/校验**（本文件，纯函数，可脱机单测）⇒ 产出「归一化动作对象」`CommandAction`；
 *   · **执行**（把 action.id 派发到"开设置/开会话/开面板"的页面逻辑）⇒ 留给 `pages/`。
 * 这样深链的**语义（能解析出什么）**与**副作用（打开什么）**解耦，前者可被测试钉死。
 *
 * ── 支持的 URI 形态（逐条对齐 web `parseUri`）──────────────────────────────────
 *   xbot://settings.open?section=llm     （标准 scheme）
 *   xbot:settings.open?section=llm       （单冒号）
 *   /command/settings.open?section=llm   （浏览器内深链前缀）
 *   ⛔ 非以上前缀 ⇒ null（调用方自行当普通 URL 处理）
 *   ⛔ 空前缀体 / 空 id ⇒ null（`xbot://`、`/command/`、`xbot://?x=1`）
 *   · id 去掉**尾部**斜杠（`xbot://settings.open/` ⇒ `settings.open`）
 *   · 参数按 **URL query** 解析：`&` 分隔、`key=value`、百分号解码、`+` 当空格（等价
 *     web 的 `URLSearchParams`；**自实现**以避开 ArkTS 是否提供该全局的不确定性）
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/command.test.ts`）。
 */

/** scheme 前缀（web `SCHEME`，逐字一致）。 */
export const COMMAND_SCHEME: string = 'xbot:';
/** 浏览器内深链前缀（web `HASH_COMMAND_PREFIX`，逐字一致）。 */
export const COMMAND_HASH_PREFIX: string = '/command/';

/** 归一化后的命令动作（解析产物；执行留给页面）。 */
export class CommandAction {
  /** 命令 id（点号命名空间，如 `settings.open`）。 */
  id: string = '';
  /** 参数（URL query 的字符串投影）。 */
  args: Record<string, string> = {};
  /** 原始 URI（便于日志/回退）。 */
  uri: string = '';
}

/** 百分号解码；非法序列**不抛**（回退原样，与 `URLSearchParams` 的宽松一致）。 */
function decodeComponent(s: string): string {
  const withSpaces: string = s.split('+').join(' ');
  try {
    return decodeURIComponent(withSpaces);
  } catch (e) {
    return withSpaces;
  }
}

/** 解析 query 串（不含 `?`）⇒ 参数表。空串 ⇒ 空表。 */
function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.length === 0) { return out; }
  const pairs: string[] = q.split('&');
  for (let i = 0; i < pairs.length; i++) {
    const pair: string = pairs[i];
    if (pair.length === 0) { continue; }
    const eq: number = pair.indexOf('=');
    const rawKey: string = eq < 0 ? pair : pair.substring(0, eq);
    const rawVal: string = eq < 0 ? '' : pair.substring(eq + 1);
    const key: string = decodeComponent(rawKey);
    if (key.length === 0) { continue; }
    out[key] = decodeComponent(rawVal);
  }
  return out;
}

/**
 * 解析命令 URI ⇒ `CommandAction`；**不是**命令 URI（无前缀 / 空 id）⇒ `null`。
 * 与 web `parseUri` 语义逐条一致（含"id 去尾斜杠""参数 URL 解码"）。
 */
export function parseCommandUri(uri: string): CommandAction | null {
  if (uri === undefined || uri === null) { return null; }
  let rest: string | null = null;
  if (uri.indexOf(COMMAND_SCHEME) === 0) {
    rest = uri.substring(COMMAND_SCHEME.length);
    // 吃掉 `//`（xbot://foo → foo）；`^\/+`
    rest = rest.replace(/^\/+/, '');
  } else if (uri.indexOf(COMMAND_HASH_PREFIX) === 0) {
    rest = uri.substring(COMMAND_HASH_PREFIX.length);
  }
  if (rest === null || rest.length === 0) { return null; }

  const qIndex: number = rest.indexOf('?');
  const rawId: string = qIndex >= 0 ? rest.substring(0, qIndex) : rest;
  const id: string = rawId.replace(/\/+$/, '');
  if (id.length === 0) { return null; }

  const action: CommandAction = new CommandAction();
  action.id = id;
  action.uri = uri;
  action.args = qIndex >= 0 ? parseQuery(rest.substring(qIndex + 1)) : {};
  return action;
}

/** 是否是一条命令 URI（等价 `parseCommandUri(uri) !== null`，供页面快速分流）。 */
export function isCommandUri(uri: string): boolean {
  return parseCommandUri(uri) !== null;
}

/** 命令 id 的命名空间（第一个 `.` 之前；无点 ⇒ 空串）。 */
export function commandNamespace(id: string): string {
  const dot: number = id.indexOf('.');
  return dot < 0 ? '' : id.substring(0, dot);
}

/**
 * 命令 id 的**形状校验**（页面派发前用；不校验"是否已注册"——那是页面的白名单事）。
 * 规则：非空、**必须**是点号命名空间（≥1 个点）、只含 `[A-Za-z0-9_-]` 与 `.`、
 * 不以点开头/结尾、无连续点。⛔ 宽松到能接受 web 的全部 id（`settings.open`/`panel.open`）。
 */
export function commandIdValid(id: string): boolean {
  if (id === undefined || id === null || id.length === 0) { return false; }
  if (id.charAt(0) === '.' || id.charAt(id.length - 1) === '.') { return false; }
  if (id.indexOf('.') < 0) { return false; }
  if (id.indexOf('..') >= 0) { return false; }
  return /^[A-Za-z0-9_.-]+$/.test(id);
}

/** 动作是否可派发（id 形状合法）。 */
export function commandActionValid(action: CommandAction | null): boolean {
  return action !== null && commandIdValid(action.id);
}

/** 取参数（缺省 ⇒ ''），省得页面到处判 undefined。 */
export function commandArg(action: CommandAction, key: string): string {
  const v: string | undefined = action.args[key];
  return v === undefined ? '' : v;
}

// ════════════════════════════════════════════════════════════════════════════
// 已注册命令（**白名单**）+ 待消费键 —— 深链的**唯一闸门**
// ════════════════════════════════════════════════════════════════════════════
//
// 逐条对应 web `layouts/AppShell.tsx:118-152` 的 `commands.registerAll([...])`（4 条）。
// ⛔ **形状合法 ≠ 已注册**：web `CommandRouter.execute()` 对未注册命令**抛错**
//    （`lib/commandRouter.ts:88-92`："拼错命令名应该立刻暴露，不静默"）。原生把这条语义落在
//    `EntryAbility` 的深链分支：**未注册 ⇒ `hilog.error` + 不派发**（⛔ 不静默；深链来自外部 ⇒ ⛔ 不崩）。

/** 打开设置（可选 `?section=<分类>`）。 */
export const COMMAND_SETTINGS_OPEN: string = 'settings.open';
/** 折叠/展开侧栏。 */
export const COMMAND_SIDEBAR_TOGGLE: string = 'sidebar.toggle';
/** 新建会话。 */
export const COMMAND_SESSION_NEW: string = 'session.new';
/** 聚焦输入框。 */
export const COMMAND_INPUT_FOCUS: string = 'input.focus';

/** 已注册命令 id（**唯一真源**；顺序 = web 注册顺序）。 */
export function registeredCommands(): string[] {
  return [COMMAND_SETTINGS_OPEN, COMMAND_SIDEBAR_TOGGLE, COMMAND_SESSION_NEW, COMMAND_INPUT_FOCUS];
}

/**
 * id 是否**已注册**（web `CommandRouter.has()` 的等价物）。
 * ⛔ 与 `commandIdValid`（**形状**）分工：形状合法也可能**未注册** ⇒ 派发方必须报错，⛔ 不静默吞。
 */
export function commandRegistered(id: string): boolean {
  const all: string[] = registeredCommands();
  for (let i: number = 0; i < all.length; i++) {
    if (all[i] === id) { return true; }
  }
  return false;
}

/**
 * **可派发？** = `null` 守卫 + 形状合法（`commandIdValid`）+ **已注册**（`commandRegistered`）。
 * 这是深链 / 命令面板的**唯一闸门**（⛔ 调用方不得自行放宽某一条）。
 */
export function commandDispatchable(action: CommandAction | null): boolean {
  if (action === null) { return false; }
  return commandIdValid(action.id) && commandRegistered(action.id);
}

/**
 * 深链命令的**待消费键**（AppStorage；页面 bootstrap 消费后 `delete`，与 `core/notify.ets` 的
 * `PENDING_CHAT_KEY` 同款——"EntryAbility 只投递、页面只消费"）。
 */
export const PENDING_COMMAND_KEY: string = 'pendingCommandUri';
/** 待消费**序号**（防"返回页面"重复触发；与 `PENDING_CHAT_SEQ_KEY` 同款）。 */
export const PENDING_COMMAND_SEQ_KEY: string = 'pendingCommandSeq';
