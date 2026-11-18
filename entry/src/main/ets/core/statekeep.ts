/**
 * **重开同一会话时不得清模型**（用户 2026-10-29 P0：「重连后还是丢迭代」）。
 *
 * 机理：`store.openSession(chatId)` 无条件调用 `beginSwitch(chatId)`，而 `beginSwitch` 会把
 *   `shadow` 重置成空模型（本意是切会话时防串台）。重连 / 前台恢复 / 同会话重开走的也是
 *   `openSession` ⇒ 模型被清空 ⇒ 只能拿**窗口化**的 `/api/history`（默认 100 条）重建
 *   ⇒ 窗口之外的迭代直接消失（重启后才补齐）。
 *
 * 判据（纯函数，可脱单测）：**同一个 chat + 模型里已有回合** ⇒ 保留（只重连 SSE、照常拉历史做
 *   增量合并）；其余一律清空（切会话/未知 chat 仍然要彻底复位，防串台）。
 */
export function shouldKeepStateOnReopen(shadowChat: string, turnsCount: number, nextChat: string): boolean {
  if (nextChat === undefined || nextChat === null || nextChat.length === 0) {
    return false;
  }
  if (shadowChat !== nextChat) {
    return false;
  }
  return turnsCount > 0;
}
