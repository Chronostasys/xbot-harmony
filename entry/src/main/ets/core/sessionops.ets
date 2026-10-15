/**
 * 会话管理（排序 / 筛选 / 搜索命中）的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web_rest.go`，逐字核对）：
 *   POST /api/chats/reorder        body { channel?, orders: { chatID: int>=0 } }
 *   POST /api/chats/fork           body { source_channel?, source_chat_id, label? } → { chat_id, channel }
 *   POST /api/chats/{id}/rename    body { channel?, chat_id, label }
 *   POST /api/chats/{id}/delete    body { channel?, chat_id }
 *   POST /api/search（legacy）→ GET /api/search?q=&limit= → { ok, results:[{id,role,created_at,snippet}] }
 *   ⚠️ 搜索只在**当前会话**的 tenant 内检索（服务端如此实现，不是全局搜索）。
 */

import { SearchHit, TodoItem } from './types';

export const MOVE_TOP: string = 'top';
export const MOVE_UP: string = 'up';
export const MOVE_DOWN: string = 'down';

/**
 * 计算移动后的**完整** orders 映射（chatID → 0..n-1 连续序号）。
 *
 * 为什么返回全量：服务端只写传入的那些键；传全量语义最明确（不会出现"两个会话同号"的歧义）。
 * 越界/未知 id 一律**原样返回**（不改动顺序），调用方可据此判断"什么也没发生"。
 */
export function moveOrders(ids: string[], id: string, dir: string): Record<string, number> {
  const order: string[] = ids.slice();
  const from: number = order.indexOf(id);
  if (from < 0) {
    return assign(order);
  }
  let to: number = from;
  if (dir === MOVE_TOP) {
    to = 0;
  } else if (dir === MOVE_UP) {
    to = from - 1;
  } else if (dir === MOVE_DOWN) {
    to = from + 1;
  }
  if (to < 0 || to >= order.length || to === from) {
    return assign(order);
  }
  order.splice(from, 1);
  order.splice(to, 0, id);
  return assign(order);
}

function assign(order: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < order.length; i++) {
    out[order[i]] = i;
  }
  return out;
}

/** 这个方向在当前位置还可不可用（用于置灰按钮）。 */
export function canMove(ids: string[], id: string, dir: string): boolean {
  const from: number = ids.indexOf(id);
  if (from < 0) {
    return false;
  }
  if (dir === MOVE_TOP) {
    return from > 0;
  }
  if (dir === MOVE_UP) {
    return from > 0;
  }
  if (dir === MOVE_DOWN) {
    return from < ids.length - 1;
  }
  return false;
}

/** 会话是否命中筛选词（按名字与 chat_id，大小写不敏感；空词全通过）。 */
export function sessionMatches(label: string, chatId: string, q: string): boolean {
  const needle: string = q.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return label.toLowerCase().indexOf(needle) >= 0 || chatId.toLowerCase().indexOf(needle) >= 0;
}

/** 搜索命中的角色显示名。 */
export function roleLabel(role: string): string {
  if (role === 'user') {
    return '你';
  }
  if (role === 'assistant') {
    return 'xbot';
  }
  return role;
}

/** 搜索命中摘要：`你：…片段…`（把换行压平，过长截断）。 */
export function hitLine(role: string, snippet: string, maxLen: number): string {
  const flat: string = snippet.replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
  const cut: string = flat.length > maxLen ? `${flat.substring(0, maxLen)}…` : flat;
  return `${roleLabel(role)}：${cut}`;
}

/**
 * 会话标题显示名（回落链：`label` → **末条消息预览** → `chat_id` 末段）。
 *
 * ⛔ 用户口径（2026-10-16）：「不要一比一复刻 web 排版，你是原生你要**超越** web」。
 *    现场丑点（真机截图实锤）：**无 label** 的会话把**原始会话键**当标题 ⇒ 列表里出现
 *    `web:chat_263F7E142E0B` 这种"看不懂的机器串"（Apple 列表绝不会这样）。
 * ✅ 服务端会话树自带 `preview`（末条消息摘要；实测 25/61 会话非空）⇒ 用它当标题比裸 id
 *    可读得多（仍**不是**发明数据：纯展示层选择更可读的既有字段）。
 * ⛔ 预览也空 ⇒ 才回落 `chat_id` 末段（保持既有行为，⛔ 不制造空标题）。
 */
/**
 * 会话键的**裸 id** = 最后一个 `/` **或** `:` 之后的子串（两种真实复合形态都取：
 * `web/chat_9`（`/` 分隔）与 `web:chat_X`（`:` 分隔）⇒ 取最后一次出现的那个分隔符）。
 */
function idBareTail(s: string): string {
  const slash: number = s.lastIndexOf('/');
  const colon: number = s.lastIndexOf(':');
  const i: number = slash > colon ? slash : colon;
  return i >= 0 ? s.substring(i + 1) : s;
}

/** 是否含空白（` ` / `\t` / `\n` / `\r`）—— ⛔ 不用正则（保持纯逻辑、可脱机）。 */
function hasWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c: string = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      return true;
    }
  }
  return false;
}

/**
 * `label` 是否只是把**会话键原样回声**（⇒ 视为"无名"，走回落链）。
 *
 * ⛔ 为什么不能只比 `label === chatId`（2026-10-16 装机实测的漏网）：服务端把会话键组装成
 *   `channel + ":" + chat_id`（48 处），而会话树里的 `chat_id` 字段**可能带前缀也可能不带**
 *   ⇒ 两种真实形态都会出现：
 *     · `label === chatId`            （都带前缀，如 `web:chat_263F7E142E0B`）
 *     · `label === chatId` 的裸末段     （label 带前缀、chatId 裸：`web:chat_X` vs `chat_X`）
 *   ⇒ 判据落到**末段比对**（`:` 之后）两侧都覆盖。⛔ 前缀段必须是"无空白的渠道记号"
 *   （防把 `重构: 会话A` 这类**真标签**误判成回声 ⇒ 标题被吞）。
 *
 * ⛔ 2026-10-14 修复（用户亲报「侧边栏会话名字不对」，B 线审计 9/41 实锤）：旧版在
 *   **label 无 `/`/`:` 前缀** 时也判回声（`i < 0 → return true`）⇒ 服务端给 **CLI 渠道**
 *   起的真名（目录 basename，如 label=`xbot-harmony`、chat_id=`/Users/bobli/src/xbot-harmony`）
 *   天然满足「末段相等」⇒ **真名被整个吞掉**，列表显示「未命名会话」或漂移的末条消息预览。
 *   ⇒ 新规则：**label 无前缀分隔符 ⇒ 一律不是回声**（真名·CLI basename 形态）。
 *   真回声只剩两条：①全串相等；②label 带"无空白渠道记号"前缀 + 裸末段相等。
 */
export function isEchoLabel(label: string, chatId: string): boolean {
  const l: string = label.trim();
  if (l.length === 0) {
    return false;
  }
  if (l === chatId) {
    return true;
  }
  const lTail: string = idBareTail(l);
  const cTail: string = idBareTail(chatId);
  if (lTail.length === 0 || lTail !== cTail) {
    return false;
  }
  const slash: number = l.lastIndexOf('/');
  const colon: number = l.lastIndexOf(':');
  const i: number = slash > colon ? slash : colon;
  if (i < 0) {
    // label 无前缀 = 两种真实形态的正名之争：
    // ① CLI 目录键：chat_id 即**工作目录全路径**（恒以 `/` 开头，服务端有意配 label=basename）
    //    ⇒ 裸 label 是**真名**——放行（2026-10-14 用户亲报修复，B 线审计 9/41 实锤）。
    // ② web 复合键（如 `web/chat_9`）：裸 label = 键的裸末段回声（机器串）⇒ 仍判回声（旧行为）。
    return chatId.startsWith('/') ? false : true;
  }
  return !hasWhitespace(l.substring(0, i));
}

export function sessionLabel(label: string, chatId: string, preview: string = ''): string {
  // 与 web 对齐（2026-10-15 用户亲报「侧边栏会话名显示不对，要和 web 对齐」）：
  // web 的 `SessionItem.tsx:88` 是 `session.label || session.chatID`——
  // label 非空就显示 label，否则显示 chatID。不做回声检测、不做 preview 回退、不做"未命名"占位。
  const l: string = label.trim();
  if (l.length > 0) {
    return l;
  }
  return chatId;
}

/** 预览当标题时的最大字符数（超长截断；列表本身 `maxLines(1)` + 省略号）。 */
export const SESSION_LABEL_MAX: number = 60;

/**
 * 无名会话（无 label、无预览）的**友好占位**。
 *
 * ⛔ 为什么不让 `sessionLabel` 的末段（原始会话键）进列表（2026-10-16 装机截图）：那会让一行读成
 *   `chat_263F7E142E0B`（机器串）—— 正是用户点名的丑点。会话键对用户无信息量（真实身份由
 *   行内相对时间 + `⋯` 菜单承载）⇒ 显示层一律换成这句人话。
 * ⚠️ 引用 web 权威：web 的 `SessionItem.tsx:88` 是 `session.label || session.chatID`（**会把键
 *   当标题**）⇒ **本仓在此处有意超越 web**（用户定向「不要一比一复刻 web，你是原生你超越 web」）。
 */
export const SESSION_UNNAMED: string = '未命名会话';

/**
 * 会话标题的**显示文案**（列表/菜单/分支名 —— 唯一出口）。
 *
 * = `sessionLabel(...)`；仅当它回落到了**会话键**（即无名）时，换成 `SESSION_UNNAMED`。
 * ⛔ 单一真源：本函数只包一层，⛔ 不复写回声/预览/截断逻辑（否则两处会腐烂）。
 */
export function sessionTitle(label: string, chatId: string, preview: string = ''): string {
  // 与 web 对齐：直接返回 sessionLabel（label || chatID），不做回声检测/未命名占位。
  return sessionLabel(label, chatId, preview);
}

// ── 消息搜索（`POST /api/search`）的**请求契约**纯逻辑 ─────────────────────────────
//
// 权威 = 服务端（web **没有**会话内消息搜索功能，`grep "/api/search" web/src` 零命中；
//   web 的"搜索"只是会话列表前端过滤 `SessionList.tsx:215-229` 与文件搜索）。
//   · 路由：`channel/web/web.go:915` `POST /api/search` → `handleSearchPOST`（`web_rest.go:432-449`）
//     → `handleSearch`（`web_api.go:1094-1155`）。
//   · 入参**只认** `{query, limit}`，且解码器 `DisallowUnknownFields()`（`web_rest.go:35`）
//     ⇒ 多发 `channel`/`chat_id`/`q` 一律 **400**（⛔ 本仓 `store.ets` 曾误发这三个键 ⇒ 按钮恒失败）。
//   · `limit` 语义（`web_api.go:1108-1113`）：缺省 **20**；显式值需 `1..100`，否则回落 20。
//   · 返回 `{ok, results?: [{id, role, created_at?, snippet}]}`（`web_api.go:1080-1084/1086-1091`）；
//     命中按 `ORDER BY id DESC`（最新在前）、大小写不敏感 LIKE、只搜 `user`/`assistant`（`:1135-1142`）。

/** 搜索条数默认值（= 服务端默认 20，`web_api.go:1108`）。 */
export const SEARCH_LIMIT_DEFAULT: number = 20;
/** 搜索条数上限（服务端 `1..100`，超界回落默认，`web_api.go:1110-1112`）。 */
export const SEARCH_LIMIT_MAX: number = 100;
/** 搜索条数下限（服务端要求 `n > 0`）。 */
export const SEARCH_LIMIT_MIN: number = 1;

/**
 * 归一化搜索条数为服务端**可接受**的取值（镜像 `web_api.go:1108-1113`）：
 * `1..100` 原样；其余（`0`/负数/`>100`/非整数）⇒ 回落 `SEARCH_LIMIT_DEFAULT`。
 * ⛔ 不夹到边界：服务端是"非法即用默认"，不是"非法即夹到 100"。
 */
export function normalizeSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return SEARCH_LIMIT_DEFAULT;
  }
  if (limit < SEARCH_LIMIT_MIN || limit > SEARCH_LIMIT_MAX) {
    return SEARCH_LIMIT_DEFAULT;
  }
  return Math.floor(limit);
}

/**
 * `/api/search` 的请求体 —— **只有这两个键**。
 * ⛔ 服务端 `DisallowUnknownFields`（`web_rest.go:35`）：多一个键就 400。
 */
export class SearchBody {
  query: string = '';
  limit: number = SEARCH_LIMIT_DEFAULT;
}

/** 构造 `/api/search` 请求体（字段序 = `query`、`limit`；limit 已归一）。 */
export function searchBody(q: string, limit: number): SearchBody {
  const b: SearchBody = new SearchBody();
  b.query = q;
  b.limit = normalizeSearchLimit(limit);
  return b;
}

/**
 * 解析 `/api/search` 响应为命中数组（防御 `results` 缺失/`null`/非数组 —— 服务端空结果回 `{ok:true}` 无 `results`）。
 * ⚠️ 服务端已按 `id DESC` 排序并算好 `snippet`，客户端**不重排、不重算**。
 */
export function parseSearchHits(data: Object): SearchHit[] {
  if (data === undefined || data === null) {
    return [];
  }
  const raw: Object | undefined = (data as Record<string, Object>)['results'];
  if (raw === undefined || raw === null || !Array.isArray(raw)) {
    return [];
  }
  return (raw as SearchHit[]);
}

// ── 会话切换（`POST /api/chats/{chatID}/switch`）的**请求/响应契约**纯逻辑 ─────────────
//
// 权威 = 服务端：路由 `web.go:946` → `handleChatSwitchPOST`（`web_rest.go:706-720`）
//   → `handleChatSwitch`（`web_api.go:1459-1504`）。
//   · 语义：把 `wc.userCurrentSession[senderID]` 设为 `{channel, chatID}` —— 这是服务端
//     **"当前会话"的唯一写入点**。读它的地方（`GetCurrentSession`，`web_api.go:1666-1672`）：
//       `handleSearch` `:1120`（搜消息）、会话树 `:1443`、上下文用量 `:78`、终端 `web_pty.go:557`、
//       WS 缺省路由/cancel `web.go:1686/1701/1801/1859/1922`、inbound 路由 `web_inbound.go:116`、
//       SSE `web_sse.go:208`；缺省回落 `{Channel:"web", ChatID:senderID}`（伪会话）。
//     ⛔ 原生切会话若不发本请求 ⇒ 服务端仍指向上一次（web/别人）设的会话 ⇒ **搜消息查错会话**（真机复现）。
//   · 入参：`channel` 走 **body** `{channel}`（`handleChatSwitchPOST` 把它转成 query；缺省 `web`，
//     `web_api.go:1475-1478`）。⛔ 直接在 URL 上发 `?channel=` 会被 `handleChatSwitchPOST` 用 body
//     **重建** query 覆盖掉（`web_rest.go:713-717`）⇒ 客户端**必须**把 channel 放 body。
//   · 非 web 通道仅**管理员**可切（`web_api.go:1481-1484`）；本仓 web 登录恒为管理员（`:1670`），
//     故非 web 会话（飞书等）也能切。
//   · 返回 `{ok, chat_id, channel, todos}`（`web_api.go:1503`）——`todos` 供切会话即刻恢复 TODO 列表。

/** `/api/chats/{chatID}/switch` 的路径（chatID **URL-encode**，杜绝裸拼路径注入）。 */
export function chatSwitchPath(chatID: string): string {
  return `/api/chats/${encodeURIComponent(chatID)}/switch`;
}

/** 切会话用的 channel（空串 ⇒ `web`，镜像服务端缺省 `web_api.go:1475-1478`）。 */
export function chatSwitchChannel(channel: string): string {
  return channel.length > 0 ? channel : 'web';
}

/** `switch` 响应（服务端 `web_api.go:1503` `{ok, chat_id, channel, todos}`）。 */
export class ChatSwitchResult {
  ok: boolean = false;
  chatID: string = '';
  channel: string = '';
  todos: TodoItem[] = [];
}

/** 解析 `switch` 响应（防御字段缺失/类型不符；`todos` 非数组 ⇒ `[]`）。 */
export function parseChatSwitch(data: Object): ChatSwitchResult {
  const out: ChatSwitchResult = new ChatSwitchResult();
  if (data === undefined || data === null) {
    return out;
  }
  const o: Record<string, Object> = data as Record<string, Object>;
  out.ok = o['ok'] === true;
  const cid: Object | undefined = o['chat_id'];
  out.chatID = typeof cid === 'string' ? (cid as string) : '';
  const ch: Object | undefined = o['channel'];
  out.channel = typeof ch === 'string' ? (ch as string) : '';
  const todos: Object | undefined = o['todos'];
  out.todos = Array.isArray(todos) ? (todos as TodoItem[]) : [];
  return out;
}
