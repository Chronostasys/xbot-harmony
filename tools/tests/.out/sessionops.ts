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
