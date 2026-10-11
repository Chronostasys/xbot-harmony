/**
 * sserec —— **SSE 事件录制器**（纯逻辑 + 环形缓冲 + 脱敏 + 统计；可脱机单测）。
 *
 * 为什么要有它（排障刚需，`docs/WEB-PARITY.md §11` C 域缺口第一条 = `Developer(SSE REC)`）：
 *  2026-10-11 排查「新建会话后一直在连接中」只能用 `hilog` + curl 盲猜 —— 最终靠 hilog 里
 *  一句 `errCode:2300023, RespCode:200, httpVer:3, reuse:1` 才锁定 HTTP/3 流式路径崩溃。
 *  **应用内自带 SSE 录制 + 连接状态面板** 让这类根因一眼可见（不再依赖抓日志）。
 *
 * 权威基准（取证，逐条对齐语义，**禁自造轮子**）：
 *   · web `src/hooks/useSSERecorder.ts:30-129` —— 记录每条 WS/SSE 消息（`id/event/data` 帧），
 *     STOP 时导出为 `.ev`（SSE wire 格式，供 replay 测试消费）；
 *   · web `src/hooks/useDeveloperMode.ts:1-40` —— 开发者模式**开关默认关**、本地持久化、
 *     跨组件广播（原生等价物 = 本模块的 `enabled` + `components/SettingsDeveloper` 的偏好读写）；
 *   · web `src/components/settings/SettingsDeveloper.tsx:20-40` —— 设置分区「Developer」+ 开关。
 *
 * ⛔ 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒
 *    **禁止** import ArkUI / `@ohos.*` / `@kit.*`（只用 JSON / Array / Object / RegExp 全局）。
 *
 * ⛔ 脱敏是**安全红线**：SSE 载荷里可能带真实凭据（api_key / token / …），而录制面板会被
 *    截图 / 分享 / 复制到 issue ⇒ **任何**入队的载荷都必须先过 `redact()`。
 */

// ── 数据结构 ──────────────────────────────────────────────────────────────────

/** 一条录制到的事件。 */
export class SseRecEntry {
  /** 单调递增序号（清空后从 0 重排）。 */
  seq: number = 0;
  /** 事件名（`event:<type>` 的 type，或生命周期名 `open`/`state`/…）。 */
  name: string = '';
  /** `lifecycle` | `frame`。 */
  kind: string = '';
  /** 事件时刻（注入的 `nowMs`）。 */
  atMs: number = 0;
  /** 本条占用字节（UTF-8 近似）。 */
  bytes: number = 0;
  /** 已**脱敏**的载荷文本。 */
  payload: string = '';
}

/**
 * SSE 连接状态快照 —— **原生增强**（web 的面板只统计录制条数，没有连接态）。
 *
 * 直接服务本次排障：`httpVer`（曾害我们每 ~1s 断一次的 HTTP/3）、`lastErrCode`
 * （hilog 里的 `errCode:2300023`）、`lastRespCode`、`reconnectCount`。
 * 字段来源见 `core/sse.ets` 的埋点。
 */
export class SseConnStatus {
  /** 请求协议（本客户端**强制** `HTTP/1.1`，见 `core/sse.ets` 的 `usingProtocol`）。 */
  httpVer: string = '';
  /** `idle` | `connecting` | `open` | `reconnecting` | `failed`。 */
  state: string = 'idle';
  /** 上次流式请求的 `BusinessError.code`（0 = 无）。 */
  lastErrCode: number = 0;
  /** 上次流式请求的 HTTP 响应码（`requestInStream` 回调的 `code`；0 = 未拿到）。 */
  lastRespCode: number = 0;
  /** 累计进入 `reconnecting` 的次数。 */
  reconnectCount: number = 0;
  /** 累计发起 `openStream` 的次数（含首次）。 */
  attemptCount: number = 0;
  /** 累计收到的**有效事件帧**数（纯心跳/注释块不计）。 */
  frameCount: number = 0;
  /** 本次连接**首帧到达**时刻（0 = 尚未连上）。 */
  connectedAtMs: number = 0;
  /** 最近一帧（含心跳）到达时刻（0 = 从未）。 */
  lastFrameAtMs: number = 0;
}

// ── 容量上限（性能优先的取值 + 理由）────────────────────────────────────────────

/**
 * 条数上限 = **512**。
 *
 * 取值依据：服务端 `/api/sse` 的**环形缓冲就是 512 条**（`channel/web/web_sse.go`；
 * 见 `core/sse.ets` 文件头契约）—— 淘汰时服务端发 `resync_required`，客户端回退
 * `/api/history`。客户端录制窗口与服务端权威窗口**对齐**：凡是掉出服务端窗口的事件，
 * 录制里留着也无法与 `/api/history` 对账，留着只会占内存。
 */
export const SSEE_MAX_ENTRIES: number = 512;

/**
 * 字节上限 = **512 KiB**。
 *
 * 取值依据：条数封顶**不足以**封内存 —— 一条 `tool_result` / 大 diff 事件可达数百 KB
 * ⇒ 512 条最坏能到 ~100MB（手机进程直接 OOM 风险）。512KiB 是移动端可长期持有、
 * 截图前自觉无压力的量级（≈ 1 张中分辨率截图），且远超"复现一个 bug 所需的上下文"。
 *
 * 淘汰策略：**先入先出**（最老的先丢）；两条上限任一越界就丢最老的。
 * ⚠️ 单条载荷本身超限时**保留该条**（否则刚记录的最新事件会被自己丢掉，反而丢证据）。
 */
export const SSEE_MAX_BYTES: number = 512 * 1024;

// ── 事件 kind（用于按类型计数 / 面板分组）──────────────────────────────────────

/** 连接生命周期事件（open/close/state/error/reconnect）—— 由 `core/sse.ets` 主动埋点。 */
export const SSEE_KIND_LIFECYCLE: string = 'lifecycle';
/** 一帧真实事件（服务端 `event:<type>` + `data:<JSON>`）。 */
export const SSEE_KIND_FRAME: string = 'frame';

/** 生命周期事件名（面板据此高亮；其余一律按 `frame` 计）。 */
export const SSEE_EV_OPEN: string = 'open';
export const SSEE_EV_CLOSE: string = 'close';
export const SSEE_EV_STATE: string = 'state';
export const SSEE_EV_ERROR: string = 'error';
export const SSEE_EV_RECONNECT: string = 'reconnect';

/** 脱敏后的占位值（面板/导出里可见，一眼看出"这里被抹了"）。 */
export const SSEE_REDACTED: string = '***';

// ── 脱敏（安全红线）────────────────────────────────────────────────────────────

/**
 * 敏感键判定 —— **大小写不敏感的子串匹配**。
 *
 * 覆盖：api_key / apikey / token（含 access_token / refresh_token）/ password / passwd /
 * pwd / secret / authorization / credential / cookie / bearer。
 *
 * ⚠️ **已知代价（刻意选择）**：子串匹配会把 `max_tokens` 这类"含 token 子串但非凭据"的键
 *    也脱敏。安全红线面前**宁可多抹不可漏**；且 SSE 事件里几乎不出现 `max_tokens`
 *    （那是 LLM 请求体字段，不是进度事件字段）。要精确就用 `_`/驼峰边界，反而会漏掉
 *    `refreshToken`（驼峰无分隔符）—— 那就是真的泄漏了。
 */
const SENSITIVE_KEY_RE: RegExp = /(api[_-]?key|apikey|token|password|passwd|pwd|secret|authorization|credential|cookie|bearer)/i;

/**
 * 递归脱敏一个 JSON 值：**返回新对象，绝不修改入参**（入参由调用方继续使用）。
 *
 * 规则：
 *   · 数组 ⇒ 逐元素递归；
 *   · 普通对象 ⇒ 逐键递归，键命中 `SENSITIVE_KEY_RE` 则值替换为 `***`（不再往里看）；
 *   · 基础类型（string/number/boolean/null）⇒ 原样返回。
 *
 * @param value 任意 JSON 值（`JSON.parse` 的产物或调用方构造的对象）
 */
export function redact(value: Object): Object {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    const src: Object[] = value as Object[];
    const out: Object[] = [];
    for (let i = 0; i < src.length; i++) {
      out.push(redact(src[i]));
    }
    return out;
  }
  if (typeof value !== 'object') {
    return value; // 基础类型：无可递归
  }
  const src: Record<string, Object> = value as Record<string, Object>;
  const out: Record<string, Object> = {};
  const keys: string[] = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const k: string = keys[i];
    out[k] = SENSITIVE_KEY_RE.test(k) ? SSEE_REDACTED : redact(src[k]);
  }
  return out;
}

/**
 * 对一段"可能是 JSON"的载荷文本脱敏。
 *
 * 语义：只有当文本 trim 后以 `{` / `[` 开头且能成功 `JSON.parse` 成对象/数组时才脱敏；
 * 否则**原样返回**（`idle`、纯文本错误行、非 JSON 心跳体 —— 不做字符串级正则误伤，
 * 避免把正常内容打成马赛克而让排障更难）。
 */
export function redactPayloadText(text: string): string {
  const trimmed: string = text.trim();
  if (trimmed.length === 0) {
    return text;
  }
  const first: string = trimmed.charAt(0);
  if (first !== '{' && first !== '[') {
    return text;
  }
  try {
    const parsed: Object = JSON.parse(trimmed) as Object;
    if (parsed === null || typeof parsed !== 'object') {
      return text;
    }
    return JSON.stringify(redact(parsed));
  } catch (e) {
    return text; // 非法 JSON —— 原样（不吞、不改）
  }
}

/** UTF-8 字节数（`s.length` 是 UTF-16 code unit，不等于字节；代理对按 4 字节算）。 */
export function utf8ByteLen(s: string): number {
  let n: number = 0;
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4; // 高代理：与低代理合成一个 4 字节字符
      i += 1;
    } else {
      n += 3;
    }
  }
  return n;
}

/** 事件名 ⇒ kind（生命周期集合外的都是真实帧）。 */
export function kindForName(name: string): string {
  if (name === SSEE_EV_OPEN || name === SSEE_EV_CLOSE || name === SSEE_EV_STATE
    || name === SSEE_EV_ERROR || name === SSEE_EV_RECONNECT) {
    return SSEE_KIND_LIFECYCLE;
  }
  return SSEE_KIND_FRAME;
}

// ── 录制器 ────────────────────────────────────────────────────────────────────

/**
 * `SseRecorder` —— 有界 FIFO 事件缓冲 + 统计 + 连接状态快照。
 *
 * ⛔ **开关默认关**（对齐 web `useDeveloperMode` 默认 OFF）：`enabled === false` 时
 *    `push()` 立即返回（**不脱敏、不入队、不计数**）⇒ 关闭态**零额外开销**
 *    （不产生任何 `JSON.stringify` / 递归遍历），性能优先。
 */
export class SseRecorder {
  /** 总开关（默认关）。由 `components/SettingsDeveloper` 持久化并设置。 */
  enabled: boolean = false;
  /** 实际入队次数（测试用判别力锚点：关闭时**不许**增长）。 */
  pushCount: number = 0;

  private entries: SseRecEntry[] = [];
  private bytes: number = 0;
  private nextSeq: number = 0;
  /** 事件名 ⇒ 次数（按类型计数）。 */
  private counts: Record<string, number> = {};

  /** SSE 连接状态快照（原生增强 —— web 没有；由 `core/sse.ets` 实时更新）。 */
  status: SseConnStatus = new SseConnStatus();

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 入队一条事件（**仅开关打开时**）。
   *
   * @param name    事件名（`event:<type>` 里的 type，或生命周期名）
   * @param payload 载荷文本（JSON 字符串或纯文本；内部先脱敏再入队）
   * @param nowMs   事件时刻（**注入** ⇒ 可测）
   * @returns 是否真的入队（关闭 / 空名 ⇒ false）
   */
  push(name: string, payload: string, nowMs: number): boolean {
    if (!this.enabled) {
      return false; // ⛔ 关闭态：零开销（不脱敏、不 JSON.stringify、不入队）
    }
    if (name.length === 0) {
      return false;
    }
    const safe: string = redactPayloadText(payload);
    const entry: SseRecEntry = new SseRecEntry();
    entry.seq = this.nextSeq;
    this.nextSeq += 1;
    entry.name = name;
    entry.kind = kindForName(name);
    entry.atMs = nowMs;
    entry.payload = safe;
    entry.bytes = utf8ByteLen(safe) + utf8ByteLen(name);
    this.entries.push(entry);
    this.bytes += entry.bytes;
    const c: number = this.counts[name];
    this.counts[name] = (c === undefined ? 0 : c) + 1;
    this.evict();
    this.pushCount += 1;
    return true;
  }

  /** 先入先出淘汰（两条上限任一越界就丢最老的；单条超限时保留该条）。 */
  private evict(): void {
    while (this.entries.length > SSEE_MAX_ENTRIES) {
      this.dropOldest();
    }
    while (this.bytes > SSEE_MAX_BYTES && this.entries.length > 1) {
      this.dropOldest();
    }
  }

  private dropOldest(): void {
    const dropped: SseRecEntry | undefined = this.entries.shift();
    if (dropped !== undefined) {
      this.bytes -= dropped.bytes;
    }
  }

  /** 当前条数。 */
  count(): number {
    return this.entries.length;
  }

  /** 当前占用字节（UTF-8 近似，随淘汰实时递减）。 */
  totalBytes(): number {
    return this.bytes;
  }

  /** 某事件名出现次数（按类型计数）。 */
  countOf(name: string): number {
    const c: number = this.counts[name];
    return c === undefined ? 0 : c;
  }

  /** 最近 `limit` 条（**最老→最新**；`limit<=0` ⇒ 空）。 */
  recent(limit: number): SseRecEntry[] {
    if (limit <= 0) {
      return [];
    }
    const n: number = this.entries.length;
    const from: number = n > limit ? n - limit : 0;
    const out: SseRecEntry[] = [];
    for (let i = from; i < n; i++) {
      out.push(this.entries[i]);
    }
    return out;
  }

  /** 清空缓冲与统计（连接状态**不清** —— 那是实况快照，不是录制产物）。 */
  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.nextSeq = 0;
    this.counts = {};
    this.pushCount = 0;
  }

  /**
   * 导出为**确定性** JSON（字段顺序固定 ⇒ 同状态必得同串，便于测试/对账）。
   * 手工拼串而非 `JSON.stringify` 整个对象树：规避 ArkTS 对类实例枚举顺序的不确定性。
   */
  toJson(): string {
    const s: SseConnStatus = this.status;
    const parts: string[] = [];
    parts.push('{"status":{');
    parts.push('"state":' + JSON.stringify(s.state));
    parts.push(',"httpVer":' + JSON.stringify(s.httpVer));
    parts.push(',"lastErrCode":' + num(s.lastErrCode));
    parts.push(',"lastRespCode":' + num(s.lastRespCode));
    parts.push(',"reconnectCount":' + num(s.reconnectCount));
    parts.push(',"attemptCount":' + num(s.attemptCount));
    parts.push(',"frameCount":' + num(s.frameCount));
    parts.push(',"connectedAtMs":' + num(s.connectedAtMs));
    parts.push(',"lastFrameAtMs":' + num(s.lastFrameAtMs));
    parts.push('},"stats":{');
    parts.push('"count":' + num(this.entries.length));
    parts.push(',"bytes":' + num(this.bytes));
    parts.push(',"maxEntries":' + num(SSEE_MAX_ENTRIES));
    parts.push(',"maxBytes":' + num(SSEE_MAX_BYTES));
    parts.push('},"entries":[');
    for (let i = 0; i < this.entries.length; i++) {
      if (i > 0) {
        parts.push(',');
      }
      parts.push(entryJson(this.entries[i]));
    }
    parts.push(']}');
    return parts.join('');
  }
}

function num(n: number): string {
  return `${n}`;
}

function entryJson(e: SseRecEntry): string {
  return '{"seq":' + num(e.seq)
    + ',"name":' + JSON.stringify(e.name)
    + ',"kind":' + JSON.stringify(e.kind)
    + ',"atMs":' + num(e.atMs)
    + ',"bytes":' + num(e.bytes)
    + ',"payload":' + JSON.stringify(e.payload) + '}';
}

/**
 * **全局单例**：`core/sse.ets`（生产者，真实 SSE 通路）与
 * `components/SettingsDeveloper.ets`（消费者，录制面板）共用同一实例
 * （ES module 单例 ⇒ 两处 import 到同一个对象）。
 */
export const sseRecorder: SseRecorder = new SseRecorder();
