/**
 * 会话星标（收藏）—— 对齐 web `src/lib/session-grouping.ts` 的 `sortSessions` 语义
 * （星标优先，其余保持原有顺序）与 `web:session:starred` 这个**共享设置键**。
 *
 * 存储格式：逗号分隔的 chat_id（与 web 的 `starredIds: string[]` 同构；
 * 存字符串是为了复用项目既有的 "设置项都是 string" 的通道，避免为此单开一条持久化路径）。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/stars.test.ts`）。
 */

/** 解析存储串 ⇒ id 列表（去空白、去空项、**保序去重**）。 */
export function parseStarred(v: string | undefined): string[] {
  if (v === undefined) { return []; }
  const parts: string[] = v.split(',');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const id: string = parts[i].trim();
    if (id.length === 0) { continue; }
    let dup: boolean = false;
    for (let j = 0; j < out.length; j++) {
      if (out[j] === id) { dup = true; break; }
    }
    if (!dup) { out.push(id); }
  }
  return out;
}

/** 序列化 ⇒ 存储串。 */
export function serializeStarred(ids: string[]): string {
  return ids.join(',');
}

/** 是否已星标。 */
export function isStarred(ids: string[], chatId: string): boolean {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === chatId) { return true; }
  }
  return false;
}

/** 切换星标（返回新数组；不改原数组）。 */
export function toggleStarred(ids: string[], chatId: string): string[] {
  const out: string[] = [];
  let removed: boolean = false;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === chatId) { removed = true; } else { out.push(ids[i]); }
  }
  if (!removed) { out.push(chatId); }
  return out;
}

/**
 * 星标优先排序 —— 对齐 web `sortSessions` 的**第一关键字**：
 * 星标的排前面，同组内保持传入顺序（web 后面接 sortOrder/createdAt；
 * 原生端会话顺序由服务端下发且已带 custom order，故这里只做"星标提前"这一层，
 * 不重排其余项 —— 避免与既有的置顶/上移/下移功能打架）。
 *
 * @param order   已按界面顺序排好的 chat_id 列表
 * @param starred 星标 id 列表
 */
export function starredFirst(order: string[], starred: string[]): string[] {
  const head: string[] = [];
  const tail: string[] = [];
  for (let i = 0; i < order.length; i++) {
    if (isStarred(starred, order[i])) { head.push(order[i]); } else { tail.push(order[i]); }
  }
  return head.concat(tail);
}
