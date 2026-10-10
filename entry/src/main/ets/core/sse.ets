/**
 * SseClient —— xbot 的 SSE 事件流客户端（ArkTS 自研）。
 *
 * 为什么必须自研：**ArkTS 没有浏览器 `EventSource`**（`@kit.NetworkKit` 只提供
 * `http`/`rcp` 的流式接收）。服务端 `/api/sse`（`channel/web/web_sse.go`）的契约：
 *   · 必须带 `?chat_id=`；
 *   · 帧格式 `id:<seq>\nevent:<type>\ndata:<JSON>\n\n`，另有 `event: heartbeat`（15s）；
 *   · 断线重连用 `Last-Event-ID` **或** `?last_event_id=`（`sseResumeCursor`）；
 *   · 环形缓冲 512 条，淘汰时服务端发 `resync_required` ⇒ 客户端必须回退到
 *     `/api/history` 权威快照；
 *   · 响应可能带 `Content-Encoding: zstd|gzip`（按 Accept-Encoding 协商）——
 *     本客户端**不声明**这两个编码，让服务端回明文。
 */
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

export type SseListener = (event: string, data: string) => void;

// ── 强制探活的**判定层**（纯函数，无 `@ohos.*` 依赖 ⇒ 可脱机单测）──────────────
//
// 背景（真机契约）：`readTimeout: 0` ⇒ 连接被中间设备（NAT/运营商/系统）**静默掐死**时
// 客户端收不到 `dataEnd`，`dataEnd → scheduleReconnect` 那条路根本不会走 ⇒ 切后台再回
// 前台会出现"看着在连、其实早死了"（表现为消息不再更新）。因此需要页面在 `onPageShow`
// 调 `forceReconnect()`：**判定**（这里）与**动作**（客户端方法）分离，判定可测。

/**
 * 静默阈值：超过它没收到**任何**帧（含心跳）⇒ 认为底层连接已被静默掐死。
 *
 * 取值依据（不是拍的）：服务端心跳是 **15s**（见文件头契约）⇒ 45s = **连续 3 个心跳
 * 都没来**（容忍 2 个心跳的排队/调度抖动；真机切后台被冻结时静默会远超 45s，回前台
 * 必然触发）。取更小（如 20s）会把"后台 20s 但连接仍健康"的会话无谓掐断（多付一次
 * 重连 + 服务端重放 `sync_progress`）；取更大（如 60s）则回前台恢复更慢。
 */
export const SSE_SILENCE_THRESHOLD_MS: number = 45000;

/**
 * 强制探活的**节流窗口**：`onPageShow` 在快速切前后台时会连续触发。
 *
 * 取值依据：`scheduleReconnect` 的退避起步就是 1s（`1000 * 2^0`）⇒ 2s 窗口刚好覆盖
 * "上一次强制重连还没连上"的时段，避免连环拆连接（拆一次服务端就要多做一次订阅）。
 */
export const SSE_FORCE_RECONNECT_THROTTLE_MS: number = 2000;

/**
 * 是否该**强制重连**（纯函数）。
 *
 * 只有"**看着已连上、但久无帧**"才值得动手：
 *   · `state !== 'open'`（`connecting`/`reconnecting`/`idle`）⇒ `false`：
 *     连接尝试或重连已在进行 ⇒ 动手只会造成**双连接**；
 *   · 无底层连接（`connected === false`）⇒ `false`：既有 `dataEnd` 路径会接手；
 *   · `lastFrameAtMs <= 0`（标记着已连上却从无帧记录 —— 异常态）⇒ `true`：
 *     无法证明它活着，恢复优先（节流兜住重复调用）。
 *
 * @param state          `idle` | `connecting` | `open` | `reconnecting`
 * @param connected      是否持有底层 `HttpRequest`
 * @param lastFrameAtMs  最后一帧（含心跳）到达时刻；`0` = 本次订阅以来从未收到
 * @param nowMs          当前时刻（**注入** ⇒ 可测）
 * @param silenceMs      静默阈值（**注入** ⇒ 可测）
 */
export function shouldForceReconnect(
  state: string,
  connected: boolean,
  lastFrameAtMs: number,
  nowMs: number,
  silenceMs: number,
): boolean {
  if (state !== 'open') {
    return false;
  }
  if (!connected) {
    return false;
  }
  if (lastFrameAtMs <= 0) {
    return true;
  }
  return nowMs - lastFrameAtMs >= silenceMs;
}

/**
 * 是否**抑制**这次强制重连（纯函数，节流）。
 * 从没强探活过（`lastForceAtMs <= 0`）⇒ 不抑制。
 */
export function shouldThrottleForceReconnect(
  nowMs: number,
  lastForceAtMs: number,
  throttleMs: number,
): boolean {
  if (lastForceAtMs <= 0) {
    return false;
  }
  return nowMs - lastForceAtMs < throttleMs;
}

/**
 * 拼事件流 URL（纯函数）。
 *
 * 为什么单独抽出来：**续传游标**（`last_event_id`）是"重连不丢事件"的唯一凭据 ——
 * 抽成纯函数后可以在脱机测试里直接钉死"带/不带游标"两种形态，不依赖真实运输层。
 *
 * @param lastEventId 空串 ⇒ 不带该 query（首次订阅）
 */
export function buildStreamUrl(
  baseUrl: string,
  chatId: string,
  channel: string,
  lastEventId: string,
): string {
  const base: string = baseUrl.replace(/\/+$/, '');
  let url: string = `${base}/api/sse?chat_id=${encodeURIComponent(chatId)}`
    + `&channel=${encodeURIComponent(channel)}`;
  if (lastEventId.length > 0) {
    url += `&last_event_id=${encodeURIComponent(lastEventId)}`;
  }
  return url;
}

export class SseClient {
  private baseUrl: string = '';
  private req: http.HttpRequest | null = null;
  private stopped: boolean = true;
  private chatId: string = '';
  private channel: string = 'web';
  private cookie: string = '';
  private lastEventId: string = '';
  private buffer: string = '';
  private decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  private retry: number = 0;
  private listener: SseListener | null = null;
  private reconnectTimer: number = -1;
  /** 最后一帧（含心跳）到达时刻 —— 强制探活的**静默判据**。0 = 本次订阅以来从未收到。 */
  private lastFrameAt: number = 0;
  /** 上次强制探活的发起时刻（节流用）。0 = 从未。 */
  private lastForceReconnectAt: number = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * 连接状态：`idle` | `connecting` | `open` | `reconnecting`。
   * 界面据此显示「连接断开，正在重连…」——弱网下用户必须知道"消息会不会丢"。
   */
  state: string = 'idle';
  /** 401（会话失效）回调：停止重连并交给页面退回登录（重连只会一直 401）。 */
  onUnauthorized: () => void = () => {
  };
  /** 状态变化回调（页面订阅） */
  onState: (state: string) => void = (state: string) => {
  };

  private setState(next: string): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.onState(next);
  }

  isOpen(): boolean {
    return this.req !== null;
  }

  /**
   * **强制探活 / 重连** —— 供页面在 `onPageShow`（回前台）调用。
   *
   * 解决什么：`readTimeout: 0` ⇒ 连接被静默掐死时**收不到 `dataEnd`**，只看状态会一直
   * 以为"还连着"（消息不再更新）。这里用一个"久无帧"的判据主动拆掉旧连接重连。
   *
   * 语义（三条硬约束）：
   *   · **续传**：复用既有 `scheduleReconnect()` ⇒ `openStream()` 会带上 `last_event_id`
   *     （不丢事件、不清会话状态；本方法**不碰** `lastEventId`）；
   *   · **幂等**：`connecting`/`reconnecting`/`idle` 一律不动手（见 `shouldForceReconnect`）
   *     ⇒ 不可能产生双连接；
   *   · **静默**：任何异常只记日志并返回 false（探活是旁路，绝不影响聊天主链路）。
   *
   * 不改 `dataEnd` 既有行为（那条路仍然照旧退避重连）。
   *
   * @param nowMs 当前时刻（**可注入** ⇒ 脱机单测能模拟"静默很久"）
   * @returns 是否**真的发起**了强制重连
   */
  forceReconnect(nowMs: number = Date.now()): boolean {
    try {
      if (this.stopped || this.state === 'idle') {
        return false;
      }
      if (shouldThrottleForceReconnect(nowMs, this.lastForceReconnectAt, SSE_FORCE_RECONNECT_THROTTLE_MS)) {
        return false;
      }
      if (!shouldForceReconnect(this.state, this.req !== null, this.lastFrameAt, nowMs, SSE_SILENCE_THRESHOLD_MS)) {
        return false;
      }
      this.lastForceReconnectAt = nowMs;
      // 显式动作不继承退避：一次性把它归零，让 scheduleReconnect 从 1s 起步（而不是等满 15s）。
      this.retry = 0;
      this.scheduleReconnect();
      return true;
    } catch (e) {
      const err: Error = e as Error;
      console.warn(`xbot sse: forceReconnect 失败（已忽略）: ${err.message}`);
      return false;
    }
  }

  /** 订阅（chatId 变化时必须重新订阅 —— 服务端按 route 单订阅）。 */
  connect(chatId: string, channel: string, cookie: string, listener: SseListener): void {
    this.close();
    this.chatId = chatId;
    this.channel = channel;
    this.cookie = cookie;
    this.listener = listener;
    this.stopped = false;
    this.retry = 0;
    // 新订阅 ⇒ 探活计时从零开始（旧订阅的帧时刻/强探活时刻不属于它）
    this.lastFrameAt = 0;
    this.lastForceReconnectAt = 0;
    this.setState('connecting');
    this.openStream();
  }

  close(): void {
    this.stopped = true;
    this.setState('idle');
    if (this.reconnectTimer >= 0) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
    if (this.req !== null) {
      const r: http.HttpRequest = this.req;
      this.req = null;
      r.off('dataReceive');
      r.off('dataEnd');
      r.off('headersReceive');
      r.destroy();
    }
  }

  private openStream(): void {
    if (this.stopped) {
      return;
    }
    const req: http.HttpRequest = http.createHttp();
    this.req = req;
    this.buffer = '';
    // 续传游标由**纯函数**拼（`buildStreamUrl`）⇒ 脱机测试能直接钉死"带/不带 last_event_id"
    const url: string = buildStreamUrl(this.baseUrl, this.chatId, this.channel, this.lastEventId);

    req.on('dataReceive', (chunk: ArrayBuffer) => {
      // 最后一帧（含心跳）到达时刻 —— 强制探活的静默判据（只记录时刻，不改解析语义）
      this.lastFrameAt = Date.now();
      // 收到第一帧即视为已连上（心跳也算）
      this.setState('open');
      this.retry = 0;
      const text: string = this.decoder.decodeToString(new Uint8Array(chunk), { stream: true });
      this.buffer += text;
      this.drain();
    });
    req.on('dataEnd', () => {
      // 服务端关闭（重启/网络切换）→ 退避重连
      this.scheduleReconnect();
    });

    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      // 刻意不声明 zstd/gzip：避免客户端解压负担（服务端按 Accept-Encoding 协商）
      'Accept-Encoding': 'identity',
      'Cookie': this.cookie,
    };
    req.requestInStream(url, {
      method: http.RequestMethod.GET,
      header: headers,
      connectTimeout: 15000,
      readTimeout: 0,
    }, (err: BusinessError, code: number) => {
      if (code === 401) {
        // 会话失效：重连没有意义（只会一直 401）⇒ 停掉并让页面退回登录
        this.stopped = true;
        this.setState('idle');
        this.onUnauthorized();
        return;
      }
      if (err !== undefined && err !== null && err.code !== 0) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    this.setState('reconnecting');
    if (this.req !== null) {
      const r: http.HttpRequest = this.req;
      this.req = null;
      r.off('dataReceive');
      r.off('dataEnd');
      r.destroy();
    }
    this.retry = Math.min(this.retry + 1, 6);
    const delay: number = Math.min(1000 * Math.pow(2, this.retry - 1), 15000);
    if (this.reconnectTimer >= 0) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      this.openStream();
    }, delay);
  }

  /** 解析缓冲区里完整的 SSE 帧（`\n\n` 分隔）。 */
  private drain(): void {
    for (;;) {
      const idx: number = this.buffer.indexOf('\n\n');
      if (idx < 0) {
        return;
      }
      const block: string = this.buffer.substring(0, idx);
      this.buffer = this.buffer.substring(idx + 2);
      this.dispatch(block);
    }
  }

  private dispatch(block: string): void {
    const lines: string[] = block.split('\n');
    let event: string = 'message';
    let data: string = '';
    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i];
      if (line.length === 0 || line.startsWith(':')) {
        continue;
      }
      const colon: number = line.indexOf(':');
      const field: string = colon >= 0 ? line.substring(0, colon) : line;
      let value: string = colon >= 0 ? line.substring(colon + 1) : '';
      if (value.startsWith(' ')) {
        value = value.substring(1);
      }
      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data = data.length === 0 ? value : `${data}\n${value}`;
      } else if (field === 'id') {
        this.lastEventId = value;
      }
    }
    if (data.length === 0) {
      return; // 纯注释/心跳保活块
    }
    const cb: SseListener | null = this.listener;
    if (cb !== null) {
      cb(event, data);
    }
  }
}
