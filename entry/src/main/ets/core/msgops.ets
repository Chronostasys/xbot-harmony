/**
 * 消息操作（长按菜单）的**纯逻辑**（可脱机单测）。
 *
 * 对齐 Web 的实现（`web/src/components/agent/MessageActions.tsx`）：
 * - 复制粒度四档：`reply`（正文）/ `thinking`（正文+思考）/ `tools`（正文+思考+工具）/ `raw`（原始 Markdown）；
 * - 工具级复制：原始输出 / 该命令参数；
 * - 打开链接的协议白名单：只放行 `http` / `https` / `mailto`（`javascript:`/`data:`/`file:` 一律拒绝）。
 */

import { ChatMessage } from './chattypes';

export const COPY_REPLY: string = 'reply';
export const COPY_THINKING: string = 'thinking';
export const COPY_TOOLS: string = 'tools';
export const COPY_RAW: string = 'raw';

/** 一份可复制内容的各部分（由调用方从行/迭代/工具里取出）。 */
export class CopyParts {
  /** 正文（不含思考与工具） */
  reply: string = '';
  /** 思考 */
  thinking: string = '';
  /** 工具调用（名字+参数+结果） */
  tools: string = '';
  /** 原始 Markdown（服务端原文，未被展示层加工） */
  raw: string = '';
}

/** 只有一个空段时为真（用于过滤"没有内容的复制项"）。 */
function blank(s: string): boolean {
  return s.trim().length === 0;
}

/**
 * 按变体拼出复制文本。
 *
 * 语义与 Web 一致：`thinking` 在正文之外**追加**思考；`tools` 再追加工具；
 * `raw` 用原始 Markdown（拿不到则回落正文）。空段自动跳过，绝不输出多余空行。
 */
export function composeCopy(parts: CopyParts, variant: string): string {
  const segs: string[] = [];
  if (variant === COPY_RAW) {
    const raw: string = blank(parts.raw) ? parts.reply : parts.raw;
    return raw;
  }
  if (!blank(parts.reply)) {
    segs.push(parts.reply);
  }
  if (variant === COPY_THINKING || variant === COPY_TOOLS) {
    if (!blank(parts.thinking)) {
      segs.push(`【思考】\n${parts.thinking}`);
    }
  }
  if (variant === COPY_TOOLS) {
    if (!blank(parts.tools)) {
      segs.push(`【工具】\n${parts.tools}`);
    }
  }
  return segs.join('\n\n');
}

/** 工具一段的可复制文本（含名字、参数、输出；空段跳过）。 */
export function toolCopyText(name: string, args: string, result: string): string {
  const segs: string[] = [];
  if (!blank(name)) {
    segs.push(name);
  }
  if (!blank(args)) {
    segs.push(`参数：${args}`);
  }
  if (!blank(result)) {
    segs.push(`输出：${result}`);
  }
  return segs.join('\n');
}

/** 工具的参数/输出单取（Web 的工具级复制项）。 */
export function toolArgsOnly(args: string): string {
  return blank(args) ? '' : args;
}

export function toolResultOnly(result: string): string {
  return blank(result) ? '' : result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 链接处理（打开链接 / 复制链接地址）
// ─────────────────────────────────────────────────────────────────────────────

/** 协议白名单：只放行 http/https/mailto（其余一律拒绝，含 javascript:/data:/file:）。 */
export function isOpenableScheme(href: string): boolean {
  const s: string = href.trim().toLowerCase();
  return s.indexOf('http://') === 0 || s.indexOf('https://') === 0 || s.indexOf('mailto:') === 0;
}

/**
 * 解析出可打开的绝对地址（相对地址按 base 拼成绝对地址；不在白名单返回空串）。
 *
 * 为什么要 base：消息里的 `/api/files/download?...` 是同源相对链接，直接交给浏览器会打不开。
 */
export function resolveOpenable(href: string, base: string): string {
  const h: string = href.trim();
  if (h.length === 0) {
    return '';
  }
  if (isOpenableScheme(h)) {
    return h;
  }
  if (h.indexOf('//') === 0) {
    // 协议相对（//host/path）：补上 base 的协议
    const scheme: string = base.indexOf('https://') === 0 ? 'https:' : 'http:';
    const abs: string = `${scheme}${h}`;
    return isOpenableScheme(abs) ? abs : '';
  }
  if (h.indexOf('/') === 0) {
    // 同源绝对路径
    const b: string = stripTrailingSlash(base);
    const abs: string = `${b}${h}`;
    return isOpenableScheme(abs) ? abs : '';
  }
  // 其余相对地址：不做拼接（宁可拒绝，也不要打开一个猜出来的地址）
  return '';
}

function stripTrailingSlash(s: string): string {
  let out: string = s;
  while (out.length > 0 && out.endsWith('/')) {
    out = out.substring(0, out.length - 1);
  }
  return out;
}

/**
 * 抽出一段 Markdown 里的链接地址（按出现顺序、去重）。
 *
 * 只认 `[text](url)`；图片 `![alt](src)` 不算链接（那是图片引用）。
 */
export function linksIn(md: string): string[] {
  const out: string[] = [];
  let i: number = 0;
  while (i < md.length) {
    const open: number = md.indexOf('](', i);
    if (open < 0) {
      break;
    }
    // 图片：`](` 前一个字符是 `]` 且再前是 `!` 的情形 —— 用 `[` 的位置判断
    const close: number = md.indexOf(')', open + 2);
    if (close < 0) {
      break;
    }
    const url: string = md.substring(open + 2, close).trim();
    // 图片判定：回找与该 `]` 配对的 `[`，看它前一位是不是 `!`（`![alt](src)`）。
    // ⚠️ 不能用 `substring(open-2, open)`：中文 alt 时字符宽度不同，会误判（曾把图片当链接）。
    const lb: number = md.lastIndexOf('[', open - 1);
    const isImage: boolean = lb > 0 && md.charAt(lb - 1) === '!';
    if (!isImage && url.length > 0 && out.indexOf(url) < 0) {
      out.push(url);
    }
    i = close + 1;
  }
  return out;
}

/** 链接的显示名（去掉协议与查询串，太长时截断）。 */
export function linkLabel(url: string): string {
  let s: string = url;
  const q: number = s.indexOf('?');
  if (q > 0) {
    s = s.substring(0, q);
  }
  const stripped: string = s.replace('https://', '').replace('http://', '').replace('mailto:', '');
  return stripped.length > 48 ? `${stripped.substring(0, 45)}…` : stripped;
}

// ─────────────────────────────────────────────────────────────────────────────
// AskUser 答案拼装
// ─────────────────────────────────────────────────────────────────────────────

/** 一个问题的选择（页面 `AskSelection` 的纯逻辑镜像）：已选标签 + "其它"输入。 */
export class AskAnswerInput {
  labels: string[] = [];
  other: string = '';

  constructor(labels: string[], other: string) {
    this.labels = labels;
    this.other = other;
  }
}

/** 多选连接符（逐字对齐 web `AskUserPanel.tsx:37 MULTI_JOIN`）。 */
export const MULTI_JOIN: string = '、';

/**
 * 选择 → 提交给服务端的 `answers`（逐字对齐 web `AskUserPanel.tsx:67-88`）。
 *
 * ⛔ 契约（web 权威，服务端按此解析）：
 *   · **键 = 问题下标** `String(i)`（不是 `q.id`！旧版用 q.id ⇒ 服务端按 web 契约取不到答案）；
 *   · 优先级：**"其它"输入 > 已选标签**（其它值独占该题答案，不是附加后缀）；
 *   · 多选以 `、`（`MULTI_JOIN`）连接。
 */
export function mergeAskAnswers(inputs: AskAnswerInput[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < inputs.length; i++) {
    const s: AskAnswerInput = inputs[i];
    const other: string = s.other.trim();
    if (other.length > 0) {
      out[String(i)] = other;
      continue;
    }
    if (s.labels.length > 0) {
      out[String(i)] = s.labels.join(MULTI_JOIN);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// rewind（消息编辑并重发 / 回退）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/history/rewind` 的请求体 —— 逐字对齐服务端 `channel/web/web_api.go:266-270`
 * （`{channel, chat_id, history_id:int64}`；`history_id<=0` 直接 400）。
 *
 * ⚠️ 项目约定 REST 请求体集中在 `core/reqbody.ets`（唯一构造入口；服务端用
 *    `DisallowUnknownFields` 严格解码，多一个字段就 400）。本波 `reqbody.ets` 属禁改文件，
 *    故与 rewind 纯逻辑同置于此 —— 后续应迁回 `reqbody.ets`。
 */
export class RewindReq {
  channel: string = '';
  chat_id: string = '';
  history_id: number = 0;

  constructor(channel: string, chatId: string, historyId: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.history_id = historyId;
  }
}

/**
 * rewind 的目标 user 行 —— 对应 web `rewind.ts` 的 `Pick<ChatMessage, 'role'|'turnID'|'content'>`。
 *
 * 用 class 而非 interface：页面在 ArkTS 下要 `new`（ArkTS 禁未类型化对象字面量作参数）。
 */
export class RewindTarget {
  role: string = 'user';
  turnID: number = 0;
  content: string = '';

  constructor(turnID: number, content: string, role?: string) {
    this.turnID = turnID;
    this.content = content;
    if (role !== undefined) {
      this.role = role;
    }
  }
}

/**
 * 从一份**新鲜历史快照**里解出某条 user 消息的 **DB id**（逐字移植 web
 * `rewind.ts:33 resolveUserMessageDBID`）。
 *
 * 为什么需要它：web/原生把 user 行从 `user_echo` SSE 渲染出来，而该回声在**入队时**就发出
 * （早于 agent loop 落库），因此回声带权威 `turnID` 却**没有** DB id（`session_messages` 自增 id
 * 只在落库时分配）。`dbID` 只随一次历史重载下发（`toChatMessages → dbID: m.id`）。
 * 而 rewind 必须用这个 DB id，故当回声行缺 dbID 时从新鲜重载里解析。
 *
 * 匹配规则：
 * - `turnID>0`：`turnID + content` **精确**匹配。回声 content 等于落库 content
 *   （agent loop 落的是同一串展开文本），不匹配即"不是这条" ⇒ 返回"不可用"，
 *   **绝不**跨 turn 猜。
 * - `turnID=0`（附件展开回声）：无 turnID 可匹配 ⇒ 退回按 content。`rows` 按 DB id 升序，
 *   故**反向**扫以命中**最近**一次出现 —— rewind 语义上针对最新一条同内容消息；
 *   正向扫会命中最早的同内容行，内容重复时回退到错误位置。
 *
 * @param rows   新鲜历史行（必须带 dbID）
 * @param target 用户想 rewind 的那条回声行
 * @returns 匹配到的 DB id；**0 表示"没找到/尚未落库"**（web 返回 undefined —— 原生用 0 做哨兵，
 *          因为服务端 `history_id<=0` 本就非法，0 是无歧义的"不可用"值，调用方据此提示）。
 */
export function rewindTargetDBID(rows: ChatMessage[], target: RewindTarget): number {
  if (target.turnID > 0) {
    for (let i = 0; i < rows.length; i++) {
      const m: ChatMessage = rows[i];
      if (m.role !== 'user') {
        continue;
      }
      const db: number | undefined = m.dbID;
      if (db === undefined) {
        continue;
      }
      if (m.turnID === target.turnID && m.content === target.content) {
        return db;
      }
    }
    return 0;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const m: ChatMessage = rows[i];
    if (m.role !== 'user') {
      continue;
    }
    const db: number | undefined = m.dbID;
    if (db === undefined) {
      continue;
    }
    if (m.content.length > 0 && m.content === target.content) {
      return db;
    }
  }
  return 0;
}
