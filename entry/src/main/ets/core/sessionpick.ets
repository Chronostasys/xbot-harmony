/**
 * 会话选择相关的**纯逻辑**（可脱机单测）。
 *
 * 为什么单独成模块：这类判定一旦错了，表现是"功能不可用"而不是"样式不对"，
 * 且只能在真机上撞见（真机实测：切到飞书会话报 `HTTP 404 session not found`）。
 */
import { SessionItem } from './types';

/** 创建新会话时使用的渠道（Web 端新建的都是 web）。 */
export const DEFAULT_CHANNEL: string = 'web';

/**
 * 取某个会话**自己的渠道**。
 *
 * ⚠️ 为什么必须这样：`/api/session-tree` 返回**所有渠道**的会话（含飞书 `oc_*` / `ou_*`），
 * 而 `/api/history` 等接口要求 `channel` 与会话实际所属渠道一致 —— 客户端曾把 channel 恒设为
 * `'web'`，于是点开任何非 web 会话都得到 `{"code":"not_found","message":"session not found"}`
 * （真机截图实证）。找不到会话时回落 `web`（新会话/历史遗留调用点的安全值）。
 */
export function channelForChat(sessions: SessionItem[], chatId: string): string {
  for (let i = 0; i < sessions.length; i++) {
    const s: SessionItem = sessions[i];
    if (s.chat_id === chatId) {
      if (s.channel !== undefined && s.channel.length > 0) {
        return s.channel;
      }
      return DEFAULT_CHANNEL;
    }
  }
  return DEFAULT_CHANNEL;
}

/** 渠道的展示名（抽屉里标注来源，避免"这个会话为什么打不开"的困惑）。 */
export function channelLabel(channel: string): string {
  if (channel === 'web') {
    return 'Web';
  }
  if (channel === 'feishu') {
    return '飞书';
  }
  if (channel === 'cli') {
    return 'CLI';
  }
  return channel.length > 0 ? channel : '未知';
}

/**
 * 首屏最多渲染的消息行数。
 *
 * 为什么要有上限：`List` + `ForEach` 会**一次性构建全部行**，而单行最多 16 个迭代块 × 每块
 * Markdown ⇒ 几十行就是几千个节点（真机表现："渲染很卡、交互也很差"）。
 * 更早的行由「显示更早」按钮按批放开。
 */
export const MAX_ROWS_VISIBLE: number = 12;

/** 当前应渲染的行窗口（返回末尾 N 行；N 由用户点上方的「显示更早」增大）。 */
export function visibleRows<T>(rows: T[], limit: number): T[] {
  if (limit <= 0 || rows.length <= limit) {
    return rows;
  }
  return rows.slice(rows.length - limit);
}

/** 被行窗口挡住的条数（0 表示全展示）。 */
export function hiddenRowCount(total: number, limit: number): number {
  if (limit <= 0 || total <= limit) {
    return 0;
  }
  return total - limit;
}
