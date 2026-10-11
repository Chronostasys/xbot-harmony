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
  /**
   * 服务端随 session-tree 下发的 **SubAgent 子树**（`channel/web/web.go:288` 的
   * `Children []UserChatWithPreview json:"children,omitempty"`；递归同形）。
   * web 用它把子会话归到父渠道名下（`SessionSidebar.tsx:99-106`）。
   */
  children?: ChannelSource[];
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
 *
 * ⚠️ 只比**会话自身的 channel**（字符串级）。要按"会话属于哪个渠道"过滤（含父子渠道），
 *    用 {@link sessionInChannel} —— 本函数保留给纯字符串场景/既有调用点。
 */
export function channelFilterMatches(channel: string, active: string): boolean {
  if (active.length === 0) {
    return true;
  }
  return channel === active;
}

/** 子树里**任一**节点的 `parent_channel` 命中 active（递归 —— 含孙子，不是只看直接子）。 */
function subtreeHasParentChannel(s: ChannelSource, active: string): boolean {
  const kids: ChannelSource[] | undefined = s.children;
  if (kids === undefined || kids === null) {
    return false;
  }
  for (let i = 0; i < kids.length; i++) {
    const c: ChannelSource = kids[i];
    if (c.parent_channel === active) {
      return true;
    }
    if (subtreeHasParentChannel(c, active)) {
      return true;
    }
  }
  return false;
}

/**
 * **"该会话属于哪个渠道"** —— 逐字对齐 web 权威
 * `components/session/SessionSidebar.tsx:99-106`：
 * ```
 * s.channel === active || s.parentChannel === active
 *   || (s.children || []).some(c => c.parentChannel === active)
 * ```
 * 即：会话自身的渠道 **∪** 它的父渠道 **∪** 它的子会话（SubAgent）所归的父渠道。
 * （子会话的渠道是 `agent`，但它的 `parent_channel` 指向真实渠道 ⇒ 选中真实渠道时
 *   子会话必须出现；否则用户选得到渠道、却筛出**空列表**。）
 *
 * · `active` 为空串 = **全部**（与 web `if (!store.activeChannel) return store.sessions` 同）；
 * · 缺失渠道的会话在 `active` 非空时不命中（与 web 同）；
 * · children 递归到任意深度（web 只比直接子；本仓 session-tree 的 children 是**嵌套**树，
 *   递归才能覆盖"孙子的 parent_channel"，需求明确要求"不看直接父"）。
 *
 * @param s      会话行（`SessionItem`；服务端已随行下发 `channel`/`parent_channel`/`children`）
 * @param active 当前筛选渠道（空串 = 全部）
 */
export function sessionInChannel(s: SessionItem, active: string): boolean {
  if (active.length === 0) {
    return true;
  }
  const src: ChannelSource = s as ChannelSource;
  if (src.channel === active) {
    return true;
  }
  if (src.parent_channel === active) {
    return true;
  }
  return subtreeHasParentChannel(src, active);
}

/** 当前筛选的展示名（空 = 「全部」；否则复用 `channelLabel` 与抽屉标注同源）。 */
export function activeChannelLabel(active: string): string {
  return active.length === 0 ? '全部' : channelLabel(active);
}

// ─────────────────────────────────────────────────────────────────────────────
// 渠道过滤的**本地持久化**（键 / 默认 / 非法值回落：读、写共用同一对纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * activeChannel 的本地偏好键 —— **与 web 逐字一致**
 * （`hooks/useSessionStore.ts:45 ACTIVE_CHANNEL_KEY = 'xbot:active-channel'`）。
 *
 * ⚠️ web 存 `localStorage`，原生存 `@kit.ArkData` preferences（`core/config.ets`）
 *    —— 容器不同、**键字符串保持一致**（便于跨端诊断/未来同步）。
 * ⚠️ 纯逻辑住在本文件（channel 域、无 `@kit` 依赖、可脱机单测）；IO 住 `core/config.ets`
 *    —— 与本仓既有惯例一致（`config.ets` 头注释：地址规则住 `core/endpoint.ets`）。
 */
export const ACTIVE_CHANNEL_KEY: string = 'xbot:active-channel';

/** 默认值：空串 = **全部**（对齐 web `activeChannel: null`）。 */
export const DEFAULT_ACTIVE_CHANNEL: string = '';

/**
 * 归一化 activeChannel —— **读、写共用同一函数**（键名/默认/非法值回落单点）。
 *
 * · `null` / `undefined` / 纯空白 ⇒ 默认（全部）；
 * · 给定 `candidates` 且值不在其中（该渠道已消失）⇒ 默认（全部）——
 *   否则重启后列表会因"筛一个不存在的渠道"而**恒空**。
 *
 * ⚠️ 不校验是否在 `ALL_CHANNEL_ORDER`（web 也不校验；未知渠道可被筛出，见
 *    `channelFilterMatches` 注释）—— 只在调用方给候选集时才做存在性回落。
 */
export function normalizeActiveChannel(raw: string | null | undefined, candidates?: string[]): string {
  if (raw === null || raw === undefined) {
    return DEFAULT_ACTIVE_CHANNEL;
  }
  const t: string = raw.trim();
  if (t.length === 0) {
    return DEFAULT_ACTIVE_CHANNEL;
  }
  if (candidates !== undefined && candidates.length > 0 && candidates.indexOf(t) < 0) {
    return DEFAULT_ACTIVE_CHANNEL;
  }
  return t;
}
