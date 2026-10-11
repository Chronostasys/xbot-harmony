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

import { SearchHit } from './types';

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

/** 会话显示名（无名字时回落到 chat_id 末段）。 */
export function sessionLabel(label: string, chatId: string): string {
  const l: string = label.trim();
  if (l.length > 0) {
    return l;
  }
  const parts: string[] = chatId.split('/');
  return parts.length > 0 ? parts[parts.length - 1] : chatId;
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
