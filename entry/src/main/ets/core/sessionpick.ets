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

// ─────────────────────────────────────────────────────────────────────────────
// 渠道过滤（ChannelPicker 的**纯逻辑**）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 已知渠道的展示顺序（逐字对齐 web `ChannelPicker.tsx:47 ALL_CHANNEL_ORDER`）。
 * 不在表内的渠道名次 = 999（排末尾，同秩保持首见顺序）。
 */
export const ALL_CHANNEL_ORDER: string[] = ['web', 'cli', 'feishu', 'qq', 'napcat'];

/** 内部渠道：**永不**作为筛选项展示（web `availableChannels` 的 `!== 'agent'`）。 */
export const INTERNAL_CHANNEL: string = 'agent';

/**
 * 会话行的最小渠道形状 —— `SessionItem` 的元素级**加宽**读出（服务端 `parent_channel`
 * 已随 session-tree 下发，但 `core/types.ets` 的 `SessionItem` 是欠声明类型、本波禁改）。
 * 目标接口多出的字段**全部可选** ⇒ `SessionItem` → 本接口两个方向都成立、元素级 `as` 合法
 * （与 `core/sessiongroup.ets:664` 读取 `work_dir`/`status` 同一手法）。
 */
export interface ChannelSource {
  channel?: string;
  /** 服务端字段名（snake_case）：SubAgent 行标注的父会话渠道。 */
  parent_channel?: string;
}

/** 渠道名次（未知 = 999，排末尾）。 */
function channelRank(ch: string): number {
  const i: number = ALL_CHANNEL_ORDER.indexOf(ch);
  return i === -1 ? 999 : i;
}

/** 去重加入（空串/未定义/内部渠道一律跳过）。 */
function addChannel(out: string[], ch: string | undefined): void {
  if (ch === undefined || ch.length === 0 || ch === INTERNAL_CHANNEL) {
    return;
  }
  if (out.indexOf(ch) < 0) {
    out.push(ch);
  }
}

/**
 * 由会话列表推导可筛选的渠道（逐字对齐 web `ChannelPicker.tsx:53 availableChannels`）。
 *
 * 规则：取每个会话的 `channel` 与 `parent_channel`（后者让 SubAgent 行的父渠道也进候选），
 * **排除内部渠道 `agent`**；按 `ALL_CHANNEL_ORDER` 排序、未知渠道排末尾。
 *
 * ⚠️ 纯客户端派生 —— **不新增任何 RPC/SSE**。过滤只作用于列表视图，绝不改
 *    `channelForChat` 的"按会话取渠道"语义（见本文件顶部真机事故说明）。
 */
export function availableChannels(sessions: SessionItem[]): string[] {
  const seen: string[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const s: ChannelSource = sessions[i] as ChannelSource;
    addChannel(seen, s.channel);
    addChannel(seen, s.parent_channel);
  }
  // 稳定排序（ES2019+ Array.sort 稳定）：同秩保持"首见顺序"，与 web `Set + sort` 同款。
  return seen.sort((a: string, b: string): number => channelRank(a) - channelRank(b));
}

/**
 * 渠道筛选判据：`active` 为空串 = **全部**（不过滤）；否则**精确相等**。
 *
 * "未知渠道"也能按原值筛出（`availableChannels` 把未知渠道也列进去了，选中它即
 * `channel === active`）。返回 true = 该会话应显示在列表里。
 */
export function channelFilterMatches(channel: string, active: string): boolean {
  if (active.length === 0) {
    return true;
  }
  return channel === active;
}

/** 当前筛选的展示名（空 = 「全部」；否则复用 `channelLabel` 与抽屉标注同源）。 */
export function activeChannelLabel(active: string): string {
  return active.length === 0 ? '全部' : channelLabel(active);
}
