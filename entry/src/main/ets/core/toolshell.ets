/**
 * Shell 工具的输出语义 + 「转后台」（promote-to-background）判定 —— 纯函数，可脱机单测。
 *
 * 移植自 web `components/agent/ToolRender.tsx`：
 *   · `parseShell()`（349-394）—— 从输出文本抽 `promoted` / `bgTask` / 退出码 / 超时；
 *   · `ShellPromoteBar`（483-551）—— 转后台按钮的**显示与启用**判据。
 *
 * 用户插话（2026-10-12）：「**跟 web 一样支持用户 promote shell to background**」——
 * 前台 shell 执行中可一键转入后台，agent 迭代不再阻塞等待它。
 * 服务端 RPC：`serverapp/rpc_table.go:1854` `promote_shell{session_key, tool_call_id}`
 * → `{ok, task_id}`（实现 `tools.PromoteForegroundShell`，`tools/shell_promote.go`）。
 *
 * ⛔ **task id 提取必须锚定首行、且在剥头部标记行之前**（web 注释原文，`ToolRender.tsx:357-363`）：
 *    promote / timeout / background-start 三种格式都把 `[task_id: "xxx"]` 放在**首行**、
 *    与标题同一行；不锚定会把普通命令输出里出现的字面量误判成后台任务。
 */
import { isToolInProgress } from './toolstatus';

/** web `ToolRender.tsx:133` 的 Shell 工具名（`case 'Shell'`）。 */
export const SHELL_TOOL_NAME: string = 'Shell';

/** 无退出码哨兵（web 用 `null`；ArkTS 侧用 -1，避免联合类型）。 */
export const NO_EXIT_CODE: number = -1;

/** shell 输出的语义解析结果（web `ShellParsed` 的 promote 相关子集 + 剥头后的正文）。 */
export class ShellParsed {
  /** 输出以 `[PROMOTED to background…]` 开头 ⇒ 该工具**已被用户转后台**。 */
  promoted: boolean = false;
  /** 后台任务 id（`bg:xxx` 或裸 id；空 = 无）。 */
  bgTask: string = '';
  /** 退出码；`NO_EXIT_CODE` = 未知。 */
  exitCode: number = NO_EXIT_CODE;
  /** 输出以 `[TIMEOUT after …]` 开头。 */
  timeout: boolean = false;
  /** 剥掉头部标记行后的正文（渲染用；**绝不吞正文**——只剥已知标记行）。 */
  output: string = '';
}

/** 首行锚定取后台任务 id（web `ToolRender.tsx:364-372` 两条正则逐字移植）。 */
function bgTaskOfFirstLine(firstLine: string): string {
  const m: RegExpMatchArray | null = firstLine.match(/\[task_id: "([A-Za-z0-9-]+)"\]/);
  if (m !== null && m.length > 1) { return m[1]; }
  // 旧格式（promote 之前的历史结果）：`Background task running: bg:xxx`
  const legacy: RegExpMatchArray | null =
    firstLine.match(/Background task running: (bg:[A-Za-z0-9-]+)/);
  return legacy !== null && legacy.length > 1 ? legacy[1] : '';
}

/**
 * 从工具标签取命令 —— web `ToolRender.tsx:60-66` `shellCommand()` 的标签分支。
 * 原生 `ToolProgress.label` 形态 = `"Shell: <command>"`（与 web 同款）；无前缀则原样返回。
 *
 * 用途：`parseShellText` 靠它剥掉 `[EXIT n] <command>` 里**尾随同一行的命令**
 * （web 的 `text.slice(0, nl).trim() === command.trim()`）。
 */
export function shellCommandOfLabel(label: string): string {
  const l: string = label !== undefined && label !== null ? label : '';
  const prefix: string = `${SHELL_TOOL_NAME}: `;
  return l.indexOf(prefix) === 0 ? l.substring(prefix.length) : l;
}

/**
 * 解析 shell 工具的输出文本（web `parseShell` 的语义等价物）。
 *
 * `text` 由调用方按 web 的回退链给（`detail || summary || ''`）；
 * `command` 用于剥掉 `[EXIT 1] <command>` **同一行尾随的命令**
 * （web：`text.slice(0, nl).trim() === command.trim()`）。
 */
export function parseShellText(text: string, command: string = ''): ShellParsed {
  const out: ShellParsed = new ShellParsed();
  let s: string = text !== undefined && text !== null ? text : '';
  // ① task id：**首行锚定**，在剥头部之前（见文件头注）
  const firstNl: number = s.indexOf('\n');
  out.bgTask = bgTaskOfFirstLine(firstNl >= 0 ? s.substring(0, firstNl) : s);
  // ② 退出码 `[EXIT n] cmd\noutput…`
  const exitM: RegExpMatchArray | null = s.match(/^\[EXIT (-?\d+)\] /);
  if (exitM !== null && exitM.length > 1) {
    out.exitCode = parseInt(exitM[1], 10);
    s = s.substring(exitM[0].length);
    const nl: number = s.indexOf('\n');
    if (nl >= 0 && s.substring(0, nl).trim() === command.trim()) { s = s.substring(nl + 1); }
  }
  // ③ 超时（web：`text.startsWith('[TIMEOUT after ')`）
  if (s.indexOf('[TIMEOUT after ') === 0) {
    out.timeout = true;
    const nl: number = s.indexOf('\n');
    s = nl >= 0 ? s.substring(nl + 1) : '';
  }
  // ④ 已转后台
  if (s.indexOf('[PROMOTED to background') === 0) {
    out.promoted = true;
    const nl: number = s.indexOf('\n');
    s = nl >= 0 ? s.substring(nl + 1) : '';
  }
  out.output = s.replace(/\s+$/, '');
  return out;
}

/**
 * 该工具是否应显示「转后台」—— web `ShellRender:445`（`{inProgress && <ShellPromoteBar/>}`）
 * × `ShellPromoteBar:489`（`enabled = Boolean(session.chatID) && callID !== ''`）。
 *
 * ⛔ `inProgress` 必须与「卡片显示运行中模样」**同一个判据**（web 注释点名 2026-09-14 的 bug：
 *    「我确定是 running，没渲染转后台按钮」—— `pending`/`generating` 时卡片已是运行中观感，
 *    却因只用 `status === 'running'` 而没有按钮）。原生直接用 `core/toolstatus.isToolInProgress`
 *    （**含 pending + generating**），与 pill 的观感判据同源。
 *
 * ⚠️ 会话身份（web 的 `session.chatID`）由**页面**保证：转后台回调只在会话打开时注入；
 *    缺它会得到空 `task_id`（不静默做错事）。
 */
export function canPromoteShell(name: string, kind: string, callId: string): boolean {
  if (name !== SHELL_TOOL_NAME) { return false; }
  if (callId.length === 0) { return false; }
  return isToolInProgress(kind);
}

/**
 * 面板所见会话键 `channel:chatID`（web `ShellPromoteBar:497`
 * `${session.channel}:${session.chatID}`）。
 *
 * ⛔ 必须是**面板所见会话**——服务端按它查注册的 `ForegroundShellHandle`
 *    （`tools/shell.go:347` / `tools/shell_promote.go`）；用 shell 自身的 `ctx.SessionKey`
 *    在 physicalChannel override / SubAgent 场景下**不一致** ⇒ 落空报 `no running shell`
 *    （`docs/agent/gotchas-tools.md:18`；用户 2026-09-14「所有会话都要支持转后台」）。
 */
export function promoteSessionKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`;
}

/** `promote_shell` 的 RPC 参数（服务端 `serverapp/rpc_table.go:1854-1857` 读这两个字段）。 */
export class PromoteShellParams {
  session_key: string = '';
  tool_call_id: string = '';

  constructor(sessionKey: string, toolCallId: string) {
    this.session_key = sessionKey;
    this.tool_call_id = toolCallId;
  }
}

/** `promote_shell` 的响应（`{ok: true, task_id: "…"}`；`serverapp/rpc_table.go:1868`）。 */
export class PromoteShellResult {
  ok: boolean = false;
  task_id: string = '';
}
