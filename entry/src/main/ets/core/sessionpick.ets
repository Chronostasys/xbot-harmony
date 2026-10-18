/**
 * 会话选择相关的**纯逻辑**（可脱机单测）。
 *
 * 为什么单独成模块：这类判定一旦错了，表现是"功能不可用"而不是"样式不对"，
 * 且只能在真机上撞见（真机实测：切到飞书会话报 `HTTP 404 session not found`）。
 */
import { SessionItem } from './types';
import { t } from './i18n';

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

/**
 * 会话渠道**预建索引**（O(n) 建一次、O(1) 回查）。
 *
 * ⚡ A 线 A2a（2026-10-14）：行体每行调 `isCurrentSession` ×4-5 + `tabLabel`/`tabRunning`×1-2，
 * 每次内部都是 `channelForChat` **线性扫** ⇒ 开抽屉全量构建 = O(n²)（n≈684 ⇒ 4-5M 次字符串
 * 比较，秒级阻塞的成分之一）。预建 Map ⇒ 全量构建 O(n)。
 *
 * ⛔ 语义与 `channelForChat` **逐字等价**（首命中优先 ⇒ 重复 id 时同取首个）：`!idx.has` 才
 * set（与 `sessionIndex` 同惯例）；`channel` 缺失/空串 ⇒ `DEFAULT_CHANNEL`（与 `:24-27` 一致）。
 */
export function channelIndex(sessions: SessionItem[]): Map<string, string> {
  const idx: Map<string, string> = new Map<string, string>();
  for (let i = 0; i < sessions.length; i++) {
    const s: SessionItem = sessions[i];
    if (!idx.has(s.chat_id)) {
      idx.set(s.chat_id,
        s.channel !== undefined && s.channel.length > 0 ? s.channel : DEFAULT_CHANNEL);
    }
  }
  return idx;
}

/**
 * `channelForChat` 的**索引版**：先 O(1) 回查；未命中（真不存在 / 索引与 sessions 	View
 * 不同源）回落原线性扫 ⇒ 语义对任意输入逐字等价。消费点：`pages/Index.ets` 的页级缓存
 * `channelIdx()`（失效键 = `sessions` 引用恒等，同一 `loadSessions` 全换新数组惯例）。
 */
export function channelForChatIndexed(sessions: SessionItem[], idx: Map<string, string>,
  chatId: string): string {
  const hit: string | undefined = idx.get(chatId);
  if (hit !== undefined) {
    return hit;
  }
  return channelForChat(sessions, chatId);
}

/**
 * 会话 id 的**规范（裸）形态** —— 去掉**重复的渠道前缀**。
 *
 * ── 为什么必须有它（2026-10-13 服务端对照实验，铁证）───────────────────────────────
 * 服务端把会话键一律组装成 `channel + ":" + chat_id`（48 处，`agent/*.go`、`serverapp/*.go`），
 * 即 **`chat_id` 期望的是裸 id**（web 同款语义：`s.chatID` 是裸 id，`${channel}:${chatID}` 才是键）。
 * 而本仓 `store.currentChatId` 是**全键**（`/api/session-tree` 的 `is_current` 行 `chat_id` 字段
 * 本身就带渠道前缀 ⇒ 客户端原样收下）⇒ 出网时 `channel` + 全键被组装成 `web:web:chat_…`，
 * 落到一个**不存在的幽灵会话**上。实测（同一会话两种形态直接打服务端）：
 *
 *   | 端点 | 裸 id | 全键 |
 *   |---|---|---|
 *   | `/api/cron/list`    | ✅ 返回真实定时任务 | ❌ `tasks: null` |
 *   | `/api/tasks/list`   | ✅ 返回真实后台任务 | ❌ `[]` |
 *   | `/api/session/status` | ✅ 正确 cwd + todos | ❌ 空 todos + 默认 cwd `/Users/bobli` |
 *
 * ⇒ 用户可见：**定时/后台任务面板结构性永远空**（"任务管理做的很差"的真根因）、状态行 cwd 显示成
 * 默认目录、todos 丢失、开发者面板显示 `web:web:chat_…`。
 * ⛔ 修法**必须在出网边界规范化**（而不是改 `currentChatId` 本身）：会话树里 `/` 分隔的子代理
 * 行（`web:chat_X/explore:y`）本来就带前缀，且列表内各处比较都以树里的原值为准。
 */
export function canonicalChatId(channel: string, chatId: string): string {
  const c: string = (channel !== undefined && channel !== null) ? channel : '';
  const id: string = (chatId !== undefined && chatId !== null) ? chatId : '';
  if (c.length === 0 || id.length === 0) {
    return id;
  }
  const prefix: string = `${c}:`;
  // ⛔ 只剥**一层**：`web:web:chat_x`（已被写坏的值）也要能收敛回 `chat_x`。
  let out: string = id;
  while (out.startsWith(prefix)) {
    out = out.substring(prefix.length);
  }
  return out;
}

/** 该 id 是否**已带**渠道前缀（= 服务端/历史把它当成了键；用于识别畸形行与提示）。 */export function hasChannelPrefix(channel: string, chatId: string): boolean {
  const c: string = (channel !== undefined && channel !== null) ? channel : '';
  const id: string = (chatId !== undefined && chatId !== null) ? chatId : '';
  return c.length > 0 && id.startsWith(`${c}:`);
}

/**
 * 会话的**显示键**：`渠道:裸id`（web 权威 `SettingsDeveloper.tsx:62` 的 `${channel}:${chatID}` 同款）。
 *
 * ⛔ 不能写 `${channel}:${chatId}`（本仓 `chatId` 常已带前缀 ⇒ 显示 `web:web:chat_…`，真机实测）。
 */
export function sessionDisplayKey(channel: string, chatId: string): string {
  const c: string = (channel !== undefined && channel !== null) ? channel : '';
  const id: string = canonicalChatId(c, chatId);
  if (c.length === 0) {
    return id;
  }
  return `${c}:${id}`;
}

/**
 * 行的「信息量」打分 —— 幽灵行消除（`dedupeSessionItems`）的**唯一判据**。
 *
 * 为什么需要：服务端 `/api/session-tree` 会把**同一个会话的两行**并排下发（真机实测
 * `docs/WEB-ALIGNMENT.md §21.109`）—— 一行是**真身**（`chat_id='chat_X'`、label
 * `harmony-ui-dev`、19 个子代理、`running`、正确 cwd），另一行是历史 bug 造出的**幽灵**
 * （`chat_id='web:chat_X'`、**label 直接是这串原始键**、0 子节点、idle、默认 cwd）。
 * 抽屉列表按行渲染 ⇒ 用户看到一条名叫 `web:chat_026B326DE4C4` 的垃圾行（"丑"）。
 *
 * 打分顺序（**从强到弱**，⛔ 不要改顺序 —— 测试逐档钉住）：
 *   ① 有**真人可读名**（`+100000`）：幽灵行的 label 就是原始会话键 ⇒ 这一档最便宜也最准；
 *   ② 子代理个数（每个 `+10`，上限 999 个）：真身挂着整棵子树；
 *   ③ `running`（`+5`）/ ④ `preview` 非空（`+2`）/ ⑤ `last_active` 非空（`+1`）。
 */
export function sessionBodyScore(s: SessionItem): number {
  if (s === undefined || s === null) {
    return 0;
  }
  let n: number = 0;
  const ch: string = s.channel !== undefined && s.channel.length > 0 ? s.channel : DEFAULT_CHANNEL;
  const raw: string = s.chat_id !== undefined ? s.chat_id : '';
  const label: string = s.label !== undefined ? s.label : '';
  // ① 真人可读名：label 不是"原始会话键的变形"（`chat_X` / `web:chat_X` / 剥前缀后的裸 id）
  if (label.length > 0 && label !== raw && label !== `${ch}:${raw}`
    && label !== canonicalChatId(ch, raw)) {
    n += 100000;
  }
  // ② 子代理个数
  const kids: number = s.children !== undefined && s.children !== null ? s.children.length : 0;
  n += (kids > 999 ? 999 : kids) * 10;
  // ③④⑤ 其余"有内容"的信号
  if (s.running === true) {
    n += 5;
  }
  const preview: string = s.preview !== undefined ? s.preview.trim() : '';
  if (preview.length > 0) {
    n += 2;
  }
  if (s.last_active !== undefined && s.last_active.length > 0) {
    n += 1;
  }
  return n;
}

/**
 * **幽灵行消除**：同一 `channel` 下**规范化 id 相同**的行只保留信息量最大的那一行。
 *
 * ── 为什么按 `channel + canonicalChatId` 而不是只按 canonical id ────────────────────
 * `canonicalChatId` 的产物**与渠道无关**（`feishu:oc_1` ⇒ `oc_1`，子代理的 channel 还可能是
 * `agent`）⇒ 只比 canonical id 会把**不同渠道里恰好同名的两个真会话**（`web:chat_X` 与
 * `cli:chat_X`）误并成一个。这里要求**渠道也相同**，只有"同渠道 + 同规范 id"才是幽灵/真身关系。
 *
 * 保留**先出现的位置**（用真身原地替换幽灵）⇒ 行的顺序（服务端顺序 + 星标优先）不受影响。
 * ⛔ 只看**顶层行**：子代理挂在被保留那一行的 `children` 里，不做跨层合并。
 */
export function dedupeSessionItems(items: SessionItem[]): SessionItem[] {
  if (items === undefined || items === null || items.length === 0) {
    return items !== undefined && items !== null ? items : [];
  }
  const out: SessionItem[] = [];
  const slot: Map<string, number> = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const s: SessionItem = items[i];
    const ch: string = s.channel !== undefined && s.channel.length > 0 ? s.channel : DEFAULT_CHANNEL;
    const key: string = `${ch}\u0000${canonicalChatId(ch, s.chat_id)}`;
    const prev: number | undefined = slot.get(key);
    if (prev === undefined) {
      slot.set(key, out.length);
      out.push(s);
    } else if (sessionBodyScore(s) > sessionBodyScore(out[prev])) {
      out[prev] = s;
    }
  }
  return out;
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
  return active.length === 0 ? t('全部') : t(channelLabel(active));
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
