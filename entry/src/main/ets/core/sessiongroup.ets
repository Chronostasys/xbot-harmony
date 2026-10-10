/**
 * 会话列表「分组 / 分类 / 折叠」的**纯逻辑**（可脱机单测）。
 *
 * 权威基准：web `src/lib/session-grouping.ts`（逐函数移植）+ 分类的**持久化/迁移**
 * 语义取自 web `src/hooks/useSessionStore.ts:210-266`（loadCategory / persistCategory /
 * loadCollapsedGroups / persistCollapsedGroups）+ 组标题文案取自 web
 * `src/components/session/SessionGroup.tsx:184-208`（groupTitle/basename/statusKey）
 * 与 i18n `web/src/i18n/zh-CN.ts`。
 *
 * ⚠️ 铁律（见 AGENTS.md）：`core/*.ets` 会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒
 * 本文件**禁止 import ArkUI 全局类型或 `@ohos.*`**；也禁止用对象字面量作类型标注
 * （ArkTS 严格规则）⇒ 结构一律用 `class` 承载。
 *
 * 手工移植说明（不等于"重写规则"）：web 用 `Map`/`for…of`/对象字面量，这里改成
 * ArkTS 可接受的 `Map` + 下标循环 + `class`，**比较函数与键的生成逐字对应**。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. 分类（category）常量与归一化
// ─────────────────────────────────────────────────────────────────────────────

/** 分类：按项目（= 工作目录 `workDir`）。web `SESSION_CATEGORIES[0]`。 */
export const SESSION_CATEGORY_PATH: string = 'path';
/** 分类：按会话状态。web `SESSION_CATEGORIES[1]`。 */
export const SESSION_CATEGORY_STATUS: string = 'status';
/** 分类：按时间桶。web `SESSION_CATEGORIES[2]`。 */
export const SESSION_CATEGORY_TIME: string = 'time';

/**
 * 分类的展示顺序（**唯一来源**）。
 *
 * web `session-grouping.ts:72`：`['path', 'status', 'time']` —— `path` 排第一
 * 是因为它是**默认**组织方式；切换器直接按本数组渲染，组件里**不得**再列一遍分类。
 */
export const SESSION_CATEGORIES: string[] = [
  SESSION_CATEGORY_PATH, SESSION_CATEGORY_STATUS, SESSION_CATEGORY_TIME,
];

/** 默认分类：按项目（工作目录）。web `session-grouping.ts:75` DEFAULT_SESSION_CATEGORY。 */
export const DEFAULT_SESSION_CATEGORY: string = SESSION_CATEGORY_PATH;

/** 没有工作目录的会话归入这个特殊组键。web `session-grouping.ts:122` `'__unset__'`。 */
export const UNSET_WORK_PATH: string = '__unset__';

/** 判断任意值是否是已知分类。web `session-grouping.ts:78-80` isSessionCategory。 */
export function isSessionCategory(v: string | undefined): boolean {
  return v === SESSION_CATEGORY_TIME || v === SESSION_CATEGORY_STATUS || v === SESSION_CATEGORY_PATH;
}

/**
 * 归一化**存储值** ⇒ 生效分类（含历史 `time → path` 单向迁移）。
 *
 * 逐字对应 web `useSessionStore.ts:212-234` 的 `loadCategory()`：
 * ```
 * const raw = localStorage.getItem(CATEGORY_KEY)          // 这里 = v
 * if (isSessionCategory(raw)) {
 *   if (raw === 'time' && !localStorage.getItem(CATEGORY_MIGRATED_KEY)) {  // 这里 = !migrated
 *     localStorage.setItem(CATEGORY_MIGRATED_KEY, '1')     // ⇒ 调用方应置位 marker（见 needsCategoryMigration）
 *     localStorage.setItem(CATEGORY_KEY, DEFAULT)          // ⇒ 调用方应回写 DEFAULT
 *     return DEFAULT
 *   }
 *   return raw
 * }
 * return DEFAULT                                           // 非法/缺失 ⇒ 默认
 * ```
 *
 * 语义要点（web 注释 `214-219`）：`time` 曾是**硬编码默认值**，所以"存着 time 且从未
 * 迁移过"几乎必然是历史残留而非用户选择 ⇒ **一次性**迁到新默认 `path`；一旦用户显式
 * 写过（marker 置位）就永久尊重其选择。若同时写了服务端（web `225` 注释），迁移结果要
 * 同步到服务端，否则下次「服务端 → 本地」的同步会把 `time` 复活。
 *
 * @param v        存储里的原始值（可能缺失/脏）
 * @param migrated web 的 `CATEGORY_MIGRATED_KEY` 是否已置位；**默认 true**（= 已迁移过）。
 *                 ⚠️ 默认取 `true` 是**有意的保守值**：不确定时尊重已存的选择、不悄悄改写；
 *                 只有明确知道"这是本特性上线前的老存储"时才传 `false` 触发迁移。
 */
export function normalizeSessionCategory(v: string | undefined, migrated: boolean = true): string {
  if (!isSessionCategory(v)) {
    return DEFAULT_SESSION_CATEGORY;
  }
  if (v === SESSION_CATEGORY_TIME && !migrated) {
    return DEFAULT_SESSION_CATEGORY;
  }
  return v as string;
}

/**
 * 读入该值时是否**需要一次性迁移写盘**（web `220-227` 的三个 setItem 分支）。
 *
 * 调用方据此决定是否落盘 `DEFAULT` + 置位 migrated marker（并同步服务端）。
 * 与 `normalizeSessionCategory(v, migrated)` 的迁移条件严格同源，避免"判据与写盘两套规则"。
 */
export function needsCategoryMigration(v: string | undefined, migrated: boolean): boolean {
  return v === SESSION_CATEGORY_TIME && !migrated;
}

/**
 * 分组折叠键：`<category>:<groupKey>`。
 *
 * web `session-grouping.ts:89-91` collapseKey。**必须带分类前缀**：组键在不同分类下会
 * 撞名（时间桶 `today` vs 名叫 today 的目录），不带前缀会让折叠状态串味。
 * 项目维度因此 = `collapseKey('path', workDir)` ——「按项目记住折叠」。
 */
export function collapseKey(category: string, groupKey: string): string {
  return `${category}:${groupKey}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 会话输入结构（class 承载 —— ArkTS 禁无类型对象字面量）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 分组/排序的输入条目。
 *
 * 字段与 web `SessionInfo`（`web/src/types/shared.ts:82-120`）**子集同构**：
 * 只保留分组/排序判定真正读到的字段。服务端下发的 `SessionItem`
 * （`entry/src/main/ets/core/types.ets:32`）字段较少，缺失字段保持默认值即可
 * （缺 `type/parentChatId` ⇒ 判不出 SubAgent ⇒ 视作主会话，与 web 对普通会话一致）。
 */
export class GroupSession {
  /** 会话 id（web `chatID`；服务端 `chat_id`）。 */
  chatId: string = '';
  /** 渠道（web 缺失时按 `'web'` 处理，见 sessionKey）。 */
  channel: string = '';
  /** 显示名（仅备用，分组/排序不读）。 */
  label: string = '';
  /** RFC3339 最后活跃时间 —— **时间分桶的唯一依据**（web `session-grouping.ts:149`）。 */
  lastActive: string = '';
  /** RFC3339 创建时间 —— 无 sortOrder 时的**排序回落键**（web `191`）。 */
  createdAt: string = '';
  /** 用户自定义排序（0 = 未设；>0 = 越小越靠前）。web `180-189`。 */
  sortOrder: number = 0;
  /** 状态（`running`/`waiting_input`/`pending`/`unread`/`idle`/`error`）。web `98`。 */
  status: string = 'idle';
  /** 服务端持久化的工作目录（path 分组的首选依据）。web `112`。 */
  workDir: string = '';
  /** `'main'` / `'agent'`（`'agent'` ⇒ SubAgent）。web `22`。 */
  type: string = '';
  /** SubAgent 的父会话 id（有值 ⇒ SubAgent）。 */
  parentChatId: string = '';
  /** SubAgent 的父会话渠道。 */
  parentChannel: string = '';
  /** TUI 交互式 SubAgent 全键 `<parent-channel>:<parent-chat-id>/<role>[:instance]`。 */
  fullKey: string = '';
  /** 持久化的 agent tenant chatID（历史 SubAgent 行）。 */
  agentChatId: string = '';
  /** 是否历史遗留行（web `SessionGroup.tsx:181` 只对 SubAgent 渲染读它）。 */
  historical: boolean = false;
}

/** 一个分组（web `SessionGroup` `session-grouping.ts:195-198`）。 */
export class SessionGroup {
  /** 组键：path = 完整工作目录 / `__unset__`；time = 桶名；status = 状态名。 */
  key: string = '';
  /** 已排好序的组成员（**不含** SubAgent —— 它们由父行嵌套渲染）。 */
  sessions: GroupSession[] = [];
}

/** SubAgent 全键的解析结果（web `ParsedAgentChatID` `session-grouping.ts:33-38`）。 */
export class ParsedAgentChatID {
  parentChannel: string = '';
  parentChatID: string = '';
  role: string = '';
  instance: string = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 会话身份 & SubAgent 判定（web `session-grouping.ts:13-62`）
// ─────────────────────────────────────────────────────────────────────────────

/** 会话唯一键 `channel:chatID`（web `13-15`；channel 缺失按 `'web'`）。 */
export function sessionKey(s: GroupSession): string {
  const ch: string = s.channel.length > 0 ? s.channel : 'web';
  return `${ch}:${s.chatId}`;
}

/** 两个会话是否同一个（web `17-19`）。 */
export function sameSession(a: GroupSession | undefined, b: GroupSession | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  const ca: string = a.channel.length > 0 ? a.channel : 'web';
  const cb: string = b.channel.length > 0 ? b.channel : 'web';
  return ca === cb && a.chatId === b.chatId;
}

/**
 * 解析 TUI 交互式 SubAgent tenant 键 `<parent-channel>:<parent-chat-id>/<role>[:instance]`。
 *
 * web `47-62`：父 chatID 里可能含 `:` 和 `/`，所以**从最后一个 `/` 切**、
 * 父 channel **只按第一个 `:` 切**。解析不出返回 `undefined`（web 返回 null）。
 */
export function parseAgentChatID(chatID: string): ParsedAgentChatID | undefined {
  const slash: number = chatID.lastIndexOf('/');
  if (slash <= 0 || slash === chatID.length - 1) {
    return undefined;
  }
  const parent: string = chatID.substring(0, slash);
  const roleInstance: string = chatID.substring(slash + 1);
  const channelSep: number = parent.indexOf(':');
  if (channelSep <= 0 || channelSep === parent.length - 1) {
    return undefined;
  }
  const roleSep: number = roleInstance.lastIndexOf(':');
  const hasInstance: boolean = roleSep > 0 && roleSep < roleInstance.length - 1;
  const out: ParsedAgentChatID = new ParsedAgentChatID();
  out.parentChannel = parent.substring(0, channelSep);
  out.parentChatID = parent.substring(channelSep + 1);
  out.role = hasInstance ? roleInstance.substring(0, roleSep) : roleInstance;
  out.instance = hasInstance ? roleInstance.substring(roleSep + 1) : '';
  return out;
}

/** web `25-31` isInteractiveSubAgentTenant。 */
export function isInteractiveSubAgentTenant(channel: string | undefined, chatID: string): boolean {
  const ch: string = channel !== undefined && channel.length > 0 ? channel : 'web';
  if (ch === 'agent' || chatID.startsWith('agent:')) {
    return true;
  }
  if (parseAgentChatID(chatID) !== undefined) {
    return true;
  }
  const prefix: string = `${ch}:`;
  return chatID.startsWith(prefix) && chatID.substring(prefix.length).indexOf('/') >= 0;
}

/**
 * 是否 SubAgent 会话（web `21-23`）。SubAgent **不进主分组** —— 它们由父行
 * 嵌套渲染（web `SessionGroup.tsx:112` childrenForParent）。
 */
export function isSubAgentSession(s: GroupSession): boolean {
  if (s.type === 'agent') {
    return true;
  }
  if (s.parentChatId.length > 0) {
    return true;
  }
  const full: string = s.fullKey.length > 0 ? s.fullKey : (s.agentChatId.length > 0 ? s.agentChatId : s.chatId);
  return isInteractiveSubAgentTenant(s.channel, full);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 分组键：time 桶 / status / path（web `93-161`）
// ─────────────────────────────────────────────────────────────────────────────

/** 时间桶（顺序即展示顺序）：web `session-grouping.ts:146` `TIME_BUCKETS`。 */
export const TIME_BUCKETS: string[] = ['today', 'yesterday', 'earlier'];

/** 状态分组顺序（UI 直接遍历它保证稳定序）：web `143` `STATUS_ORDER`。 */
export const STATUS_ORDER: string[] = ['running', 'waiting_input', 'pending', 'unread', 'idle', 'error'];

/**
 * 时间分桶（web `149-161` timeBucket，**本地时区**）。
 *
 * 规则逐条抄录：
 *   1. `Date.parse(lastActive)` 解析失败（NaN）⇒ `'earlier'`；
 *   2. 时间戳 >= **今天 0 点**（`setHours(0,0,0,0)` 本地时区）⇒ `'today'`；
 *   3. 时间戳 >= **昨天 0 点** ⇒ `'yesterday'`；
 *   4. 否则 ⇒ `'earlier'`。
 *
 * ⚠️ web 用本地时区，原生端保持同样语义（不改成 UTC），否则跨端在时区边界上分组不一致。
 */
export function timeBucket(lastActive: string): string {
  const ts: number = Date.parse(lastActive);
  if (Number.isNaN(ts)) {
    return 'earlier';
  }
  const now: Date = new Date(ts);
  const startOfToday: Date = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (now.getTime() >= startOfToday.getTime()) {
    return 'today';
  }
  const startOfYesterday: Date = new Date(startOfToday.getTime());
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (now.getTime() >= startOfYesterday.getTime()) {
    return 'yesterday';
  }
  return 'earlier';
}

/**
 * path 分组的组键（完整工作目录）。web `111-123` pathBucket：
 *   1. 优先用持久化的 `workDir`（`normalizeWorkDir` 去尾部斜杠）；
 *   2. 否则若是有父会话的 SubAgent ⇒ **继承父会话的 path 组**（递归）；
 *   3. 否则 CLI 会话从 chatID 里抽 `/path/to/workdir:session-name` 的目录部分；
 *   4. 都不行 ⇒ `__unset__`。
 */
export function pathBucket(s: GroupSession): string {
  const explicit: string = normalizeWorkDir(s.workDir);
  if (explicit.length > 0) {
    return explicit;
  }
  if (s.parentChatId.length > 0 && s.parentChannel.length > 0) {
    const parent: GroupSession = new GroupSession();
    parent.chatId = s.parentChatId;
    parent.channel = s.parentChannel;
    parent.workDir = '';
    return pathBucket(parent);
  }
  if (s.channel === 'cli') {
    const workDir: string = extractWorkDir(s.chatId);
    if (workDir.length > 0) {
      return normalizeWorkDir(workDir);
    }
  }
  return UNSET_WORK_PATH;
}

/** 从 CLI 风格 chatID `/path/to/workdir:session-name` 里抽工作目录（web `126-134`）。 */
export function extractWorkDir(chatID: string): string {
  const idx: number = chatID.lastIndexOf(':');
  const candidate: string = idx > 1 && idx < chatID.length - 1 ? chatID.substring(0, idx) : chatID;
  // 必须"像路径"：以 `/` 开头 / 盘符 `C:\` / 以 `~` 开头
  if (candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('~')) {
    return candidate;
  }
  return '';
}

/** 去尾部斜杠（web `136-140` normalizeWorkDir；根目录本身不去）。 */
function normalizeWorkDir(path: string): string {
  const trimmed: string = path.trim();
  if (trimmed === '/' || /^[A-Za-z]:[\\/]$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/[\\/]+$/, '');
}

/** 单条会话 ⇒ 当前分类下的组键（web `94-103` sessionGroupKey）。 */
export function sessionGroupKey(s: GroupSession, category: string): string {
  if (category === SESSION_CATEGORY_TIME) {
    return timeBucket(s.lastActive);
  }
  if (category === SESSION_CATEGORY_STATUS) {
    return s.status;
  }
  return pathBucket(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 排序（web `163-193` sortSessions）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 排序：星标优先 → 自定义 sortOrder（>0 的按升序排在 0 之前）→ createdAt 升序。
 *
 * 逐条对应 web `174-192`：
 *   1. **先过滤掉 SubAgent**（`176`：`filter(!isSubAgentSession)`）；
 *   2. 星标档（`177-179`）：`(a 星标?1:0) - (b 星标?1:0)` 取负 ⇒ 星标在前；
 *   3. sortOrder 档（`180-189`）：都有 >0 则按升序；只有一个 >0 的排前；都=0 落到下一档；
 *   4. createdAt 升序（`191`，字符串 `localeCompare`；缺失按 `''`）——**最稳定**，
 *      所以"切换会话不会重排列表"。
 *
 * ⚠️ web 头注释写的是 "lastActive-desc"，但**代码**实际按 `createdAt` 升序（`191`）。
 * 以**代码**为准（注释过时）。原生端保持同码语义。
 *
 * @param starredIds 星标会话键（`sessionKey` 形态）列表；web 按 chatID 查表，
 *                   原生端沿用既有 `core/stars.ets` 的 chat_id 语义 ⇒ 这里两种都能命中：
 *                   命中 `sessionKey(s)` 或 `s.chatId` 都算星标。
 */
export function sortSessions(sessions: GroupSession[], starredIds: string[]): GroupSession[] {
  const pool: GroupSession[] = [];
  for (let i = 0; i < sessions.length; i++) {
    if (!isSubAgentSession(sessions[i])) {
      pool.push(sessions[i]);
    }
  }
  // ↓ 稳定排序：比较函数与 web 逐字对应（同比较结果保持传入顺序）
  return pool.sort((a: GroupSession, b: GroupSession): number => {
    const sa: number = isStarred(starredIds, a) ? 1 : 0;
    const sb: number = isStarred(starredIds, b) ? 1 : 0;
    if (sa !== sb) {
      return sb - sa;
    }
    const oa: number = a.sortOrder;
    const ob: number = b.sortOrder;
    if (oa > 0 && ob > 0) {
      if (oa !== ob) {
        return oa - ob;
      }
    } else if (oa > 0) {
      return -1; // a 有自定义序，b 没有 ⇒ a 前
    } else if (ob > 0) {
      return 1; // b 有自定义序，a 没有 ⇒ b 前
    }
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function isStarred(starredIds: string[], s: GroupSession): boolean {
  const key: string = sessionKey(s);
  for (let i = 0; i < starredIds.length; i++) {
    const id: string = starredIds[i];
    if (id === key || id === s.chatId) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 分组（web `200-236` groupSessions）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 分组 + 排序。**组间顺序**（web `200-207` 注释 + `222-234` 代码）：
 *   - `time`：`today → yesterday → earlier`（`TIME_BUCKETS` 过滤空桶）；
 *   - `status`：`STATUS_ORDER` 过滤空桶；
 *   - `path`：按**完整目录**字母序，`__unset__` **永远排最后**。
 *
 * **组内顺序**：完整排序（星标优先 → sortOrder → createdAt 升序）—— 所以星标项在
 * 自己组内也浮到顶部。SubAgent 被 `sortSessions` 过滤掉，不出现在任何组里。
 *
 * @param sessions   输入会话（会被排序，但不会就地改动；返回的是新数组）
 * @param category   分类（未知值按 `path` 处理，与 `normalizeSessionCategory` 安全回落一致）
 * @param starredIds 星标键（可省；默认无星标）
 */
export function groupSessions(
  sessions: GroupSession[], category: string, starredIds: string[] = [],
): SessionGroup[] {
  const cat: string = isSessionCategory(category) ? category : DEFAULT_SESSION_CATEGORY;
  const sorted: GroupSession[] = sortSessions(sessions, starredIds);
  const map: Map<string, GroupSession[]> = new Map<string, GroupSession[]>();
  for (let i = 0; i < sorted.length; i++) {
    const s: GroupSession = sorted[i];
    const key: string = sessionGroupKey(s, cat);
    const arr: GroupSession[] | undefined = map.get(key);
    if (arr !== undefined) {
      arr.push(s);
    } else {
      map.set(key, [s]);
    }
  }
  const out: SessionGroup[] = [];
  if (cat === SESSION_CATEGORY_STATUS) {
    for (let i = 0; i < STATUS_ORDER.length; i++) {
      pushIfPresent(out, map, STATUS_ORDER[i]);
    }
    // ⚠️ 未知状态的会话在 web 里会被**丢弃**（web `224` 只按 STATUS_ORDER 取键）。
    //    原生端保持一致（不臆造额外组），但用注释显式点出这个静默面。
  } else if (cat === SESSION_CATEGORY_TIME) {
    for (let i = 0; i < TIME_BUCKETS.length; i++) {
      pushIfPresent(out, map, TIME_BUCKETS[i]);
    }
  } else {
    const keys: string[] = [];
    map.forEach((_v: GroupSession[], k: string) => {
      keys.push(k);
    });
    keys.sort((a: string, b: string): number => {
      if (a === UNSET_WORK_PATH) {
        return 1;
      }
      if (b === UNSET_WORK_PATH) {
        return -1;
      }
      return a.localeCompare(b);
    });
    for (let i = 0; i < keys.length; i++) {
      pushIfPresent(out, map, keys[i]);
    }
  }
  return out;
}

function pushIfPresent(out: SessionGroup[], map: Map<string, GroupSession[]>, key: string): void {
  const arr: GroupSession[] | undefined = map.get(key);
  if (arr === undefined) {
    return;
  }
  const g: SessionGroup = new SessionGroup();
  g.key = key;
  g.sessions = arr;
  out.push(g);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 组标题文案（web `SessionGroup.tsx:184-208` groupTitle/basename/statusKey）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * status 键 ⇒ i18n 键的映射（web `205-208` statusKey：`waiting_input → waiting`）。
 * 只在 `waiting_input` 上改写，其余原样。
 */
export function statusGroupKey(key: string): string {
  return key === 'waiting_input' ? 'waiting' : key;
}

/** 时间桶的中文标题（web `i18n/zh-CN.ts:176-180` time.today/yesterday/earlier）。 */
export function timeBucketLabel(key: string): string {
  if (key === 'today') {
    return '今天';
  }
  if (key === 'yesterday') {
    return '昨天';
  }
  if (key === 'earlier') {
    return '更早';
  }
  return key;
}

/** 状态组的中文标题（web `i18n/zh-CN.ts` session.status.*）。 */
export function statusGroupLabel(key: string): string {
  const k: string = statusGroupKey(key);
  if (k === 'running') {
    return '运行中';
  }
  if (k === 'waiting') {
    return '等待输入';
  }
  if (k === 'pending') {
    return '等待中';
  }
  if (k === 'unread') {
    return '未读';
  }
  if (k === 'idle') {
    return '空闲';
  }
  if (k === 'error') {
    return '异常';
  }
  return key;
}

/**
 * 目录末段（web `199-203` basename）：根目录（`/` 或 `C:\`）原样返回，否则取最后一个
 * `/` 或 `\` 之后的部分。
 */
export function basename(path: string): string {
  if (path === '/' || /^[A-Za-z]:[\\/]$/.test(path)) {
    return path;
  }
  const slash: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.substring(slash + 1) : path;
}

/**
 * 组标题（web `184-197` groupTitle，逐分支对应）：
 *   - `time`   → 今天/昨天/更早；
 *   - `status` → 运行中/…；
 *   - `path`   → `__unset__` ⇒「未设置工作路径」（web `i18n/zh-CN.ts:112`
 *                `session.unsetWorkPath`），否则目录末段（完整路径留给 tooltip 消歧 —— web
 *                `SessionGroup.tsx:82` 的 `title=` 属性）。
 */
export function groupTitle(key: string, category: string): string {
  if (category === SESSION_CATEGORY_TIME) {
    return timeBucketLabel(key);
  }
  if (category === SESSION_CATEGORY_STATUS) {
    return statusGroupLabel(key);
  }
  return key === UNSET_WORK_PATH ? '未设置工作路径' : basename(key);
}

/** path 组的完整路径 tooltip（web `SessionGroup.tsx:82`：仅 path 分类且非 unset 时给出）。 */
export function pathGroupTooltip(key: string, category: string): string {
  return category === SESSION_CATEGORY_PATH && key !== UNSET_WORK_PATH ? key : '';
}
