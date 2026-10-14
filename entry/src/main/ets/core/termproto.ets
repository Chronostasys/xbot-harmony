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
import { TONE_ERROR, TONE_MUTED, TONE_SUCCESS } from './panels';

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

/**
 * **详情页**头部标题：cwd 末段；空 cwd 回退**泛称「终端」**。
 *
 * ⛔ 与 `terminalTitle` 的唯一差别 = 空 cwd 的回落值：列表里要**唯一**（两行同名没法点）⇒ 回落 tid；
 *    详情页一次只显示一个 ⇒ 回落**用户语「终端」**（⛔ 用户面**不露内部 id**「t-17917…」—— 真机取证：
 *    新建终端（cwd 尚空）头部显示裸 tid，苹果不会这样）。
 */
export function terminalHeadTitle(t: TerminalInfo): string {
  const cwd: string = t.cwd !== undefined ? t.cwd.trim() : '';
  if (cwd.length === 0) { return '终端'; }
  return terminalTitle(t);
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

/**
 * 终端·列表主行（标识）= cwd 末段；**空 cwd ⇒ `终端 N`**（N = 行序号 + 1，`idx` 从 0 起）。
 *
 * ⛔ 批次10（2026-10-12）拆分：此前 `terminalLine` 单行 `proj · 3m`（标识 + 时长挤在一行）。
 *    拆成主行（标识）+ 副行（完整 cwd · 时长）—— ⛔ **不臆造状态**：终端连接状态只存在于
 *    `TerminalSheet` 的本地 `@State`（列表数据 `{tid,cwd,createdAt}` 里没有）⇒ 列表不显示状态。
 *
 * ⛔ 批次13d（2026-10-12）：空 cwd **不再回落裸 tid**（真机取证：列表行显示
 *    `t-1791790296656155000` —— 20 字符内部 id，用户面不可读）。web 权威命名 = `Terminal ${termSeq}`
 *    （`useTerminal.ts:146`，创建时**递增序号**；原生 `TerminalInfo` 无该字段）⇒ 用**渲染序号**近似
 *    （列表顺序稳定 ⇒ 序号稳定）。
 */
export function terminalPrimary(t: TerminalInfo, idx: number): string {
  const cwd: string = t.cwd !== undefined ? t.cwd.trim() : '';
  if (cwd.length > 0) { return terminalTitle(t); }
  return `终端 ${idx + 1}`;
}

/** 终端·副行 = `<完整 cwd> · <时长>`（缺项自动省略；cwd 与主行末段同源、信息更全）。 */
export function terminalSubText(t: TerminalInfo, nowMs: number): string {
  const parts: string[] = [];
  const cwd: string = t.cwd !== undefined ? t.cwd.trim() : '';
  if (cwd.length > 0) {
    parts.push(cwd);
  }
  const age: string = terminalAgeText(t, nowMs);
  if (age.length > 0) {
    parts.push(age);
  }
  return parts.join(' · ');
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

/**
 * 快赢 1（2026-10-17）：状态对应的**列表行 tone**（`TONE_*` 语义体系——`PanelRowCard` 的
 * `@Prop tone`；与上面的 role 体系并行：role 给详情头图标、tone 给列表行副行）。
 * web 对照 `TerminalList.tsx:27-33`（五态着色）的原生对应：connecting⇒muted（短暂）·
 * connected⇒success · error⇒error · exited/closed⇒muted。
 */
export function terminalTone(status: string): string {
  if (status === TERM_CONNECTED) { return TONE_SUCCESS; }
  if (status === TERM_ERROR) { return TONE_ERROR; }
  return TONE_MUTED;
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

// ── 断线重连（P0-2，2026-10-14）─────────────────────────────────────────────
/**
 * 第 attempt 次（0 起）重连的等待毫秒：`500 × 2^attempt`，封顶 15s；
 * attempt ≥ 6（约 31.5s 累计后）⇒ 返回 -1 = **放弃**。
 *
 * 对齐 web `terminalWS.ts:28-31`（500ms×2ⁿ、cap 15s、放弃上限）——
 * 真机已实证现状（2026-10-14 装机）：WS 断开后 `已连接`→`连接失败` 死态，
 * 无任何重连 ⇒ 本函数 + `TerminalSheet.scheduleReconnect` 是唯一通路。
 */
export function reconnectDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) { return -1; }
  if (attempt >= 6) { return -1; }
  const ms: number = 500 * Math.pow(2, attempt);
  return ms > 15000 ? 15000 : ms;
}
