/**
 * core/termproto.ets —— **终端（PTY）线协议 + 列表行语义**（纯逻辑，可脱机单测）。
 *
 * 权威 = 服务端 `channel/web/web_pty.go`（本文件逐字对齐，⛔ 不臆造）：
 *   · REST（均 **POST**，统一信封 `{ok,data,error}`）：
 *       `POST /api/terminal/create`  body `{chatID, cwd}`      → data `{tid}`
 *       `POST /api/terminal/list`    body `{chat_id}`          → data `{terminals:[{tid,cwd,createdAt}]}`
 *       `POST /api/terminal/{tid}/delete` body `{}`            → data `{ok:true}`
 *   · WS `GET /ws/terminal?tid=<tid>`（**cookie 鉴权**，与 `/api/*` 同一会话 cookie）
 *       服务端→客户端：`{type:'stdout',data:<b64>}` · `{type:'stderr',data:<b64>}`
 *                      `{type:'exit',code}` · `{type:'error',message}`
 *       客户端→服务端：`{type:'stdin',data:<b64>}` · `{type:'resize',cols,rows}` · `{type:'close'}`
 *
 * ⚠️ 键名**大小写不统一**是服务端的既有事实（`chatID` vs `chat_id`）—— 照抄，别"统一"。
 *
 * ⛔ 本文件属 `core/`：禁止 import ArkUI / `@ohos.*`（`tools/tests/run.sh` 当纯 TS 编译）。
 */
import { vtBytesToB64, vtUtf8Encode } from './vt';

// ── 终端列表项（服务端 `ptySessionInfo`：`{tid,cwd,createdAt}`）───────────────
export class TerminalInfo {
  tid: string = '';
  cwd: string = '';
  createdAt: string = '';
}

/** 列表主标题：cwd 的末段（`/Users/x/proj` ⇒ `proj`）；空 cwd 回退 tid。 */
export function terminalTitle(t: TerminalInfo): string {
  const cwd: string = t.cwd !== undefined ? t.cwd : '';
  if (cwd.length === 0) { return t.tid; }
  const parts: string[] = cwd.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].length > 0) { return parts[i]; }
  }
  return cwd;
}

/** 存活时长（`12s` / `3m` / `2h` / `1d`）；无法解析时返回 `''`。 */
export function terminalAgeText(t: TerminalInfo, nowMs: number): string {
  const ms: number = Date.parse(t.createdAt);
  if (Number.isNaN(ms)) { return ''; }
  const sec: number = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (sec < 60) { return `${sec}s`; }
  if (sec < 3600) { return `${Math.floor(sec / 60)}m`; }
  if (sec < 86400) { return `${Math.floor(sec / 3600)}h`; }
  return `${Math.floor(sec / 86400)}d`;
}

/** 列表行文本：`proj · 3m`。 */
export function terminalLine(t: TerminalInfo, nowMs: number): string {
  const title: string = terminalTitle(t);
  const age: string = terminalAgeText(t, nowMs);
  return age.length > 0 ? `${title} · ${age}` : title;
}

// ── 数据通道状态（对齐 web `TerminalStatus`）────────────────────────────────
export const TERM_CONNECTING: string = 'connecting';
export const TERM_CONNECTED: string = 'connected';
export const TERM_EXITED: string = 'exited';
export const TERM_ERROR: string = 'error';
export const TERM_CLOSED: string = 'closed';

/** 状态文案（列表行/详情头共用同一份）。 */
export function terminalStatusText(status: string, exitCode: number): string {
  if (status === TERM_CONNECTING) { return '连接中'; }
  if (status === TERM_CONNECTED) { return '已连接'; }
  if (status === TERM_EXITED) { return exitCode >= 0 ? `已退出（${exitCode}）` : '已退出'; }
  if (status === TERM_ERROR) { return '连接失败'; }
  return '已关闭';
}

/**
 * 状态对应的取色 **role**（⛔ 只给 role 名，不给色值；由 UI 走 `colorOf`）。
 * `connecting`⇒`statusWaiting` · `connected`⇒`successText` · `error`⇒`dangerText` · 其余⇒`iconMuted`。
 */
export function terminalStatusRole(status: string): string {
  if (status === TERM_CONNECTING) { return 'statusWaiting'; }
  if (status === TERM_CONNECTED) { return 'successText'; }
  if (status === TERM_ERROR) { return 'dangerText'; }
  return 'iconMuted';
}

// ── WS 消息（解析 / 编码）────────────────────────────────────────────────────
export class TermMsg {
  /** `stdout` | `stderr` | `exit` | `error` | `unknown`。 */
  kind: string = 'unknown';
  /** stdout/stderr 的 base64 负载。 */
  data: string = '';
  /** exit 的退出码。 */
  code: number = 0;
  /** error 的消息。 */
  message: string = '';
}

/** 解析服务端一条 WS 文本帧（坏帧 ⇒ `kind='unknown'`，绝不抛）。 */
export function parseTermMsg(raw: string): TermMsg {
  const m: TermMsg = new TermMsg();
  let o: Record<string, Object> | null = null;
  try {
    o = JSON.parse(raw) as Record<string, Object>;
  } catch (e) {
    return m;
  }
  if (o === null) { return m; }
  const t: Object | undefined = o['type'];
  if (typeof t === 'string') { m.kind = t as string; }
  const d: Object | undefined = o['data'];
  if (typeof d === 'string') { m.data = d as string; }
  const c: Object | undefined = o['code'];
  if (typeof c === 'number') { m.code = c as number; }
  const em: Object | undefined = o['message'];
  if (typeof em === 'string') { m.message = em as string; }
  return m;
}

/** 用户输入 ⇒ `{type:'stdin',data:<b64 of UTF-8>}`。 */
export function encodeStdin(text: string): string {
  return `{"type":"stdin","data":"${vtBytesToB64(vtUtf8Encode(text))}"}`;
}

/** 尺寸变化 ⇒ `{type:'resize',cols,rows}`（服务端转发 `TIOCSWINSZ`）。 */
export function encodeResize(cols: number, rows: number): string {
  return `{"type":"resize","cols":${cols},"rows":${rows}}`;
}

/** 主动收线 ⇒ `{type:'close'}`。 */
export const TERM_CLOSE_MSG: string = '{"type":"close"}';

/**
 * 数据通道 URL：`http(s)://host` ⇒ `ws(s)://host/ws/terminal?tid=<tid>`。
 * （tid 由服务端生成，形如 `t-<nanos>`，字符集安全，无需转义。）
 */
export function termWsUrl(baseUrl: string, tid: string): string {
  let u: string = baseUrl;
  if (u.startsWith('https://')) { u = `wss://${u.substring(8)}`; }
  else if (u.startsWith('http://')) { u = `ws://${u.substring(7)}`; }
  return `${u}/ws/terminal?tid=${tid}`;
}
