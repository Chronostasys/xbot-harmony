/**
 * court.ets —— 「Agent 通信视图」（web `/court`）的**纯逻辑**（可脱机单测）。
 *
 * 权威基准（web，逐条对齐）：
 *   · `web/src/components/court/types.ts`  —— wire 类型 + kind 配色/权重/文案 + 状态色 +
 *     `memberDisplayName` + `senderAddr`
 *   · `web/src/components/court/seed.ts`   —— `deriveLanes`（成员 → 泳道：状态/任务摘要/进度）
 *   · `web/src/components/court/ThreadPanel.tsx` —— `threadKey`（`correlation_id` 折叠线程）
 *   · `channel/web/web_group.go`           —— `GET /api/groups`、`/members`、`/messages`（keyset）
 *   · `protocol/group.go`                  —— `Group` / `GroupMember` / `GroupMessage` / `GroupMessageEvent`
 *
 * ⛔ 为什么配色在这里只出**语义角色名**、不出色值：原生禁止颜色字面量（门禁 ⑥c），
 *    组件用 `colorOf(paletteOf(theme), role)` 解析。web 用十六进制是因为浏览器没有主题层。
 *
 * ⚠️ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒ 禁止 import ArkUI / `@ohos.*`。
 */

import { arrOrEmpty, isPresent } from './guards';

// ─────────────────────────────────────────────────────────────────────────────
// 1. wire 形状（与 protocol/group.go 一一对应）
// ─────────────────────────────────────────────────────────────────────────────

export interface CourtGroup {
  id?: string;
  name?: string;
  owner?: string;
  created_at?: string;
  member_count?: number;
}

export interface CourtMember {
  group_id?: string;
  member_addr?: string;
  status?: string;
  joined_at?: string;
  name?: string;
  role?: string;
  instance?: string;
}

export interface CourtMessage {
  id?: number;
  group_id?: string;
  kind?: string;
  correlation_id?: string;
  sender_type?: string;
  sender_id?: string;
  sender_name?: string;
  role?: string;
  content?: string;
  to?: string[];
  payload?: Record<string, Object>;
  created_at?: string;
}

/** `group.message` SSE 事件载荷（`protocol.GroupMessageEvent`）。 */
export interface CourtEventPayload {
  group_id: string;
  message: CourtMessage;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. kind（消息类型）：配色**角色名** + 权重 + 文案
// ─────────────────────────────────────────────────────────────────────────────

export const COURT_KIND_ASK: string = 'ask_user';
export const COURT_KIND_ANSWER: string = 'answer';
export const COURT_KIND_REPORT: string = 'report';
export const COURT_KIND_DECISION: string = 'decision';
export const COURT_KIND_ACTION: string = 'action';
export const COURT_KIND_TEXT: string = 'text';

/** kind → 设计系统**角色名**（web `KIND_COLORS` 的语义等价物；⛔ 返回的不是色值）。 */
export function courtKindRole(kind: string | null | undefined): string {
  const k: string = isPresent(kind) ? kind : COURT_KIND_TEXT;
  if (k === COURT_KIND_ASK) {
    return 'statusWaiting';
  }
  if (k === COURT_KIND_ANSWER) {
    return 'statusIdle';
  }
  if (k === COURT_KIND_REPORT) {
    return 'accent';
  }
  if (k === COURT_KIND_DECISION) {
    return 'accentDeep';
  }
  if (k === COURT_KIND_ACTION) {
    return 'statusRunning';
  }
  return 'textMuted';
}

/** kind → 文案（web `KIND_LABELS` 逐字）。 */
export function courtKindLabel(kind: string | null | undefined): string {
  const k: string = isPresent(kind) ? kind : COURT_KIND_TEXT;
  if (k === COURT_KIND_ASK) {
    return '提问';
  }
  if (k === COURT_KIND_ANSWER) {
    return '回答';
  }
  if (k === COURT_KIND_REPORT) {
    return '汇报';
  }
  if (k === COURT_KIND_DECISION) {
    return '决策';
  }
  if (k === COURT_KIND_ACTION) {
    return '动作';
  }
  return '消息';
}

/** kind → 视觉权重（web `KIND_WEIGHT`：决策/汇报最粗、text 最细）。 */
export function courtKindWeight(kind: string | null | undefined): number {
  const k: string = isPresent(kind) ? kind : COURT_KIND_TEXT;
  if (k === COURT_KIND_REPORT || k === COURT_KIND_DECISION) {
    return 2.5;
  }
  if (k === COURT_KIND_ASK || k === COURT_KIND_ANSWER) {
    return 1.8;
  }
  if (k === COURT_KIND_ACTION) {
    return 1.6;
  }
  return 1.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 身份归一：member_addr / sender_id
// ─────────────────────────────────────────────────────────────────────────────

/** 成员地址（缺省空串；`null` 当缺失）。 */
export function courtMemberAddr(m: CourtMember | null | undefined): string {
  if (m === null || m === undefined) {
    return '';
  }
  return isPresent(m.member_addr) ? m.member_addr : '';
}

/** 成员展示名（web `memberDisplayName`：name → `role/instance` → role → addr）。 */
export function courtMemberName(m: CourtMember | null | undefined): string {
  if (m === null || m === undefined) {
    return '';
  }
  const addr: string = courtMemberAddr(m);
  if (isPresent(m.name) && m.name !== addr) {
    return m.name;
  }
  if (addr.startsWith('agent:')) {
    const rest: string = addr.substring('agent:'.length);
    if (isPresent(m.instance)) {
      return isPresent(m.role) ? `${m.role}/${m.instance}` : rest;
    }
    if (isPresent(m.role)) {
      return m.role;
    }
    return rest;
  }
  return addr;
}

/** 发送者地址归一化（web `senderAddr`：agent 的 `sender_id` 可能是裸 `role/instance`）。 */
export function courtSenderAddr(msg: CourtMessage | null | undefined): string {
  if (msg === null || msg === undefined) {
    return '';
  }
  const id: string = isPresent(msg.sender_id) ? msg.sender_id : '';
  if (msg.sender_type === 'agent' && id.length > 0 && !id.startsWith('agent:')) {
    return `agent:${id}`;
  }
  return id;
}

/** 扇出目标（`to` 归一：缺失 ⇒ 空数组；元素去 `agent:` 前缀差异由调用方决定）。 */
export function courtTargets(msg: CourtMessage | null | undefined): string[] {
  if (msg === null || msg === undefined) {
    return [];
  }
  const src: string[] = arrOrEmpty(msg.to);
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i].length > 0) {
      out.push(src[i]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 泳道（组织树节点）：成员 → 状态 / 任务摘要 / 进度（web `deriveLanes` 逐字移植）
// ─────────────────────────────────────────────────────────────────────────────

export const COURT_LANE_USER: string = 'user';
export const COURT_LANE_AGENT: string = 'agent';

export const COURT_STATUS_IDLE: string = 'idle';
export const COURT_STATUS_BLOCKED: string = 'blocked';
export const COURT_STATUS_LEFT: string = 'left';

/** 泳道（组织树节点 / 时间轴分组）。`class`：ArkTS 禁空对象字面量。 */
export class CourtLane {
  /** 成员地址（= web `Lane.id`） */
  id: string = '';
  /** 展示名 */
  name: string = '';
  /** `user` | `agent` */
  type: string = COURT_LANE_USER;
  /** `idle` | `blocked` | `left` */
  status: string = COURT_STATUS_IDLE;
  /** 任务摘要（web：待处理时 `等待处理 · <最近一条内容>`，否则最近一条内容/暂无任务） */
  task: string = '';
  /** 进度 0..1（web 公式：`total == 0 ? (alive ? 0.72 : 0) : min(1, 0.35 + closed/total*0.65)`） */
  progress: number = 0;
  /** 未回答的 ask_user 条数（组织树角标） */
  pending: number = 0;
  /** 是否 `alive` 成员 */
  alive: boolean = true;
}

/** 泳道状态 → 设计系统角色名（web `STATUS_COLORS`）。 */
export function courtLaneRole(status: string): string {
  if (status === COURT_STATUS_BLOCKED) {
    return 'statusError';
  }
  if (status === COURT_STATUS_LEFT) {
    return 'textMuted';
  }
  if (status === COURT_STATUS_IDLE) {
    return 'statusIdle';
  }
  return 'statusRunning';
}

/** 由消息推导泳道（web `seed.ts:deriveLanes`，逐条对齐）。 */
export function deriveCourtLanes(
  members: CourtMember[] | null | undefined,
  messages: CourtMessage[] | null | undefined,
): CourtLane[] {
  const ms: CourtMessage[] = arrOrEmpty(messages);
  const answered: Set<string> = new Set<string>();
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].kind === COURT_KIND_ANSWER && isPresent(ms[i].correlation_id)) {
      answered.add(ms[i].correlation_id as string);
    }
  }
  const lastSeen: Map<string, string> = new Map<string, string>();
  const pendingBy: Map<string, number> = new Map<string, number>();
  for (let i = 0; i < ms.length; i++) {
    const m: CourtMessage = ms[i];
    const sender: string = courtSenderAddr(m);
    lastSeen.set(sender, isPresent(m.content) ? m.content as string : '');
    const corr: string = isPresent(m.correlation_id) ? m.correlation_id as string : '';
    if (m.kind === COURT_KIND_ASK && corr.length > 0 && !answered.has(corr)) {
      const to: string[] = courtTargets(m);
      for (let k = 0; k < to.length; k++) {
        const cur: number | undefined = pendingBy.get(to[k]);
        pendingBy.set(to[k], cur === undefined ? 1 : cur + 1);
      }
    }
  }
  const closed: Map<string, number> = new Map<string, number>();
  const total: Map<string, number> = new Map<string, number>();
  for (let i = 0; i < ms.length; i++) {
    const m: CourtMessage = ms[i];
    if (!isPresent(m.correlation_id)) {
      continue;
    }
    const sender: string = courtSenderAddr(m);
    const who: string[] = [sender];
    const to: string[] = courtTargets(m);
    for (let k = 0; k < to.length; k++) {
      who.push(to[k]);
    }
    const approved: boolean = m.kind === COURT_KIND_DECISION
      && courtDecisionApproved(m);
    for (let k = 0; k < who.length; k++) {
      const cw: number | undefined = total.get(who[k]);
      total.set(who[k], cw === undefined ? 1 : cw + 1);
      if (approved) {
        const cc: number | undefined = closed.get(who[k]);
        closed.set(who[k], cc === undefined ? 1 : cc + 1);
      }
    }
  }
  const src: CourtMember[] = arrOrEmpty(members);
  const out: CourtLane[] = [];
  for (let i = 0; i < src.length; i++) {
    const mb: CourtMember = src[i];
    const addr: string = courtMemberAddr(mb);
    const pending: number = pendingBy.get(addr) === undefined ? 0 : pendingBy.get(addr) as number;
    const totalN: number = total.get(addr) === undefined ? 0 : total.get(addr) as number;
    const closedN: number = closed.get(addr) === undefined ? 0 : closed.get(addr) as number;
    const alive: boolean = mb.status === 'alive';
    const lane: CourtLane = new CourtLane();
    lane.id = addr;
    lane.name = courtMemberName(mb);
    lane.type = addr.startsWith('agent:') ? COURT_LANE_AGENT : COURT_LANE_USER;
    lane.status = !alive ? COURT_STATUS_LEFT : (pending > 0 ? COURT_STATUS_BLOCKED : COURT_STATUS_IDLE);
    lane.alive = alive;
    lane.pending = pending;
    const last: string | undefined = lastSeen.get(addr);
    lane.task = pending > 0
      ? `等待处理 · ${last !== undefined ? last : '—'}`
      : (last !== undefined ? last : '暂无任务');
    lane.progress = totalN === 0
      ? (alive ? 0.72 : 0)
      : Math.min(1, 0.35 + (closedN / totalN) * 0.65);
    out.push(lane);
  }
  return out;
}

/** payload.decision 是否含 `approved`（web：`String(payload.decision).includes('approved')`）。 */
function courtDecisionApproved(m: CourtMessage): boolean {
  const p: Record<string, Object> | undefined = m.payload;
  if (p === undefined) {
    return false;
  }
  const v: Object | undefined = p['decision'];
  if (v === undefined) {
    return false;
  }
  return String(v).includes('approved');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 线程（`correlation_id` 折叠，web `ThreadPanel.threadKey`）
// ─────────────────────────────────────────────────────────────────────────────

/** 线程行（右侧线程面板的列表项）。 */
export class CourtThread {
  /** `correlation_id`（空串 = 无线程，不列出） */
  key: string = '';
  /** 标题 = 线程首条消息正文（单行截断交给组件） */
  title: string = '';
  /** 条数 */
  count: number = 0;
  /** 最后一条时间（epoch ms；解析失败 = 0） */
  lastAt: number = 0;
  /** 最后一条的 kind（配色） */
  kind: string = COURT_KIND_TEXT;
}

/** ISO 时间 → epoch ms（解析失败/缺失 ⇒ 0；不抛）。 */
export function courtTimeMs(iso: string | null | undefined): number {
  if (!isPresent(iso)) {
    return 0;
  }
  const n: number = Date.parse(iso as string);
  return Number.isNaN(n) ? 0 : n;
}

/** 按 `correlation_id` 折叠线程（有线程的排在前，按最后活动时间**降序**）。 */
export function courtThreads(messages: CourtMessage[] | null | undefined): CourtThread[] {
  const src: CourtMessage[] = arrOrEmpty(messages);
  const byKey: Map<string, CourtThread> = new Map<string, CourtThread>();
  for (let i = 0; i < src.length; i++) {
    const m: CourtMessage = src[i];
    const key: string = isPresent(m.correlation_id) ? m.correlation_id as string : '';
    if (key.length === 0) {
      continue;
    }
    const at: number = courtTimeMs(m.created_at);
    let t: CourtThread | undefined = byKey.get(key);
    if (t === undefined) {
      t = new CourtThread();
      t.key = key;
      t.title = isPresent(m.content) ? m.content as string : '';
      byKey.set(key, t);
    }
    t.count = t.count + 1;
    if (at >= t.lastAt) {
      t.lastAt = at;
      t.kind = isPresent(m.kind) ? m.kind as string : COURT_KIND_TEXT;
    }
  }
  const out: CourtThread[] = [];
  byKey.forEach((t: CourtThread) => {
    out.push(t);
  });
  out.sort((a: CourtThread, b: CourtThread) => {
    if (b.lastAt !== a.lastAt) {
      return b.lastAt - a.lastAt;
    }
    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
  });
  return out;
}

/** 某线程的全部消息（按时间升序、同时间按 id 升序）。 */
export function courtThreadMessages(
  messages: CourtMessage[] | null | undefined, key: string,
): CourtMessage[] {
  const src: CourtMessage[] = courtSorted(messages);
  const out: CourtMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    const k: string = isPresent(src[i].correlation_id) ? src[i].correlation_id as string : '';
    if (k === key) {
      out.push(src[i]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 时间轴：排序 / 时间窗 / 回放切片 / 泳道过滤
// ─────────────────────────────────────────────────────────────────────────────

/** 稳定排序：`created_at` 升序，同时间按 `id` 升序（缺 id/时间 ⇒ 视为 0，保持原序在前）。 */
export function courtSorted(messages: CourtMessage[] | null | undefined): CourtMessage[] {
  const out: CourtMessage[] = [];
  const src: CourtMessage[] = arrOrEmpty(messages);
  for (let i = 0; i < src.length; i++) {
    out.push(src[i]);
  }
  out.sort((a: CourtMessage, b: CourtMessage) => {
    const ta: number = courtTimeMs(a.created_at);
    const tb: number = courtTimeMs(b.created_at);
    if (ta !== tb) {
      return ta - tb;
    }
    const ia: number = a.id === undefined ? 0 : a.id;
    const ib: number = b.id === undefined ? 0 : b.id;
    return ia - ib;
  });
  return out;
}

/** 时间窗选项（web `WINDOW_OPTIONS`）：毫秒值。`0` = 全部。 */
export const COURT_WINDOW_15M: number = 15 * 60 * 1000;
export const COURT_WINDOW_1H: number = 60 * 60 * 1000;
export const COURT_WINDOW_6H: number = 6 * 60 * 60 * 1000;
export const COURT_WINDOW_DAY: number = 24 * 60 * 60 * 1000;
export const COURT_WINDOW_ALL: number = 0;

/** 时间窗文案（与 web 逐字）。 */
export function courtWindowLabel(ms: number): string {
  if (ms === COURT_WINDOW_15M) {
    return '15 分钟';
  }
  if (ms === COURT_WINDOW_1H) {
    return '1 小时';
  }
  if (ms === COURT_WINDOW_6H) {
    return '6 小时';
  }
  if (ms === COURT_WINDOW_DAY) {
    return '全天';
  }
  return '全部';
}

/**
 * 时间窗过滤：保留 `(nowMs - windowMs, nowMs]` 内的消息（`windowMs <= 0` = 全部）。
 * ⛔ 上限**不是** `nowMs` 而是"最新一条消息时间"由调用方决定：回放时 `nowMs` = 游标时刻。
 */
export function windowCourtMessages(
  messages: CourtMessage[] | null | undefined, nowMs: number, windowMs: number,
): CourtMessage[] {
  const src: CourtMessage[] = courtSorted(messages);
  if (windowMs <= 0) {
    return src;
  }
  const from: number = nowMs - windowMs;
  const out: CourtMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    const t: number = courtTimeMs(src[i].created_at);
    if (t > from && t <= nowMs) {
      out.push(src[i]);
    }
  }
  return out;
}

/**
 * 回放切片：只保留 `created_at <= uptoMs` 的消息（`uptoMs <= 0` = 全部）。
 * 组件用 Slider 拖到某一时刻（⛔ 不用定时器：原生 `setTimeout` 有静态预算上限）。
 */
export function replayCourtMessages(
  messages: CourtMessage[] | null | undefined, uptoMs: number,
): CourtMessage[] {
  const src: CourtMessage[] = courtSorted(messages);
  if (uptoMs <= 0) {
    return src;
  }
  const out: CourtMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    const t: number = courtTimeMs(src[i].created_at);
    if (t <= uptoMs) {
      out.push(src[i]);
    }
  }
  return out;
}

/** 泳道过滤（组织树点某成员 ⇒ 只看它参与的消息：发送者或接收者）。`''` = 不过滤。 */
export function filterCourtByLane(
  messages: CourtMessage[] | null | undefined, laneID: string,
): CourtMessage[] {
  const src: CourtMessage[] = courtSorted(messages);
  if (laneID.length === 0) {
    return src;
  }
  const out: CourtMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    const m: CourtMessage = src[i];
    if (courtSenderAddr(m) === laneID) {
      out.push(m);
      continue;
    }
    const to: string[] = courtTargets(m);
    let hit: boolean = false;
    for (let k = 0; k < to.length; k++) {
      if (to[k] === laneID) {
        hit = true;
        break;
      }
    }
    if (hit) {
      out.push(m);
    }
  }
  return out;
}

/** 当前视图快照里最晚的时间（= 回放滑块的上限）。无消息 ⇒ 0。 */
export function courtLatestMs(messages: CourtMessage[] | null | undefined): number {
  const src: CourtMessage[] = arrOrEmpty(messages);
  let max: number = 0;
  for (let i = 0; i < src.length; i++) {
    const t: number = courtTimeMs(src[i].created_at);
    if (t > max) {
      max = t;
    }
  }
  return max;
}

/** 时间戳 → `HH:mm`（本地时区；0/非法 ⇒ `--:--`）。纯函数：给列表右侧用。 */
export function courtClock(ms: number): string {
  if (ms <= 0) {
    return '--:--';
  }
  const d: Date = new Date(ms);
  const hh: number = d.getHours();
  const mm: number = d.getMinutes();
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 实时事件解析（SSE `group.message`）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析 `group.message` 的 SSE 载荷。
 *
 * 线上形状（`protocol.GroupMessageEvent` + SSE envelope）：
 *   `{ "result": { "group_id": "...", "message": {...} } }`
 * 兼容**扁平**形态（`{group_id, message}`，web `api.ts` 读的就是 `payload.result?.message`，
 * 但手动 POST /api/groups/{id}/messages 的响应是扁平 `{ok,message}`）。
 * ⛔ 只做结构解析：`group_id` 或 `message.id` 缺失 ⇒ null（**不猜**，也不伪造消息）。
 */
export function parseCourtEvent(raw: string): CourtEventPayload | null {
  if (raw.length === 0) {
    return null;
  }
  let root: Record<string, Object>;
  try {
    root = JSON.parse(raw) as Record<string, Object>;
  } catch (e) {
    return null;
  }
  if (root === null || root === undefined) {
    return null;
  }
  const res: Object | undefined = root['result'];
  let env: Record<string, Object> = root;
  if (res !== undefined && res !== null) {
    env = res as Record<string, Object>;
  }
  const gid: Object | undefined = env['group_id'];
  const msg: Object | undefined = env['message'];
  if (gid === undefined || gid === null || msg === undefined || msg === null) {
    return null;
  }
  const m: CourtMessage = msg as CourtMessage;
  if (m.id === undefined || m.id === null) {
    return null; // 无 id ⇒ 无法去重（客户端按 id 追加）
  }
  return { group_id: String(gid), message: m };
}

/**
 * 追加一条实时消息（按 `id` 幂等：已有同 id ⇒ **返回原数组引用**，零渲染）。
 * ⛔ 与历史拉取的去重只有这一条判据（不比内容、不比时间）。
 */
export function appendCourtMessage(
  messages: CourtMessage[] | null | undefined, msg: CourtMessage,
): CourtMessage[] {
  const src: CourtMessage[] = arrOrEmpty(messages);
  const id: number = msg.id === undefined ? 0 : msg.id;
  for (let i = 0; i < src.length; i++) {
    if ((src[i].id === undefined ? 0 : src[i].id) === id && id !== 0) {
      return src as CourtMessage[];
    }
  }
  const out: CourtMessage[] = [];
  for (let i = 0; i < src.length; i++) {
    out.push(src[i]);
  }
  out.push(msg);
  return out;
}

/** 群组展示名（空名 ⇒ 群 id；都空 ⇒ 「未命名群组」，与后端建群默认一致）。 */
export function courtGroupName(g: CourtGroup | null | undefined): string {
  if (g === null || g === undefined) {
    return '未命名群组';
  }
  if (isPresent(g.name) && (g.name as string).length > 0) {
    return g.name as string;
  }
  if (isPresent(g.id) && (g.id as string).length > 0) {
    return g.id as string;
  }
  return '未命名群组';
}
