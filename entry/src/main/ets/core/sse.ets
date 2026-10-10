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
 * **自主看门狗**的巡检周期。
 *
 * 为什么要自主看门狗（2026-10-11 真机缺陷的根因）：`readTimeout: 0` ⇒ 连接被中间设备
 * **静默掐死**（没有 FIN/RST）时既不会有 `dataEnd`、也不会有 `err` ⇒ 客户端永远停在
 * `connecting`/`reconnecting`，界面**永久**显示"连接断开，正在重连…"，且**再也不重试**。
 * 权威基准（web `src/providers/sseConnection.ts:32,85-88,250-258`）正是用"**45s 半开看门狗**"
 * 兜住这件事，且**在 onerror 里也布防**（"onopen never fires ⇒ watchdog never armed"）。
 * 本类的看门狗等价于它，但由客户端自己周期性巡检（不依赖页面 `onPageShow`）。
 */
export const SSE_WATCHDOG_TICK_MS: number = 5000;

/**
 * 一次连接尝试的**挂死阈值**：超过它仍没收到任何帧（连心跳都没有）⇒ 判定这次尝试死了、重试。
 *
 * 取值依据：服务端心跳 **15s**（`channel/web/web_sse.go:24 sseHeartbeatInterval`）⇒ 健康连接
 * 最迟 ~15s 内必有第一帧；20s 覆盖"首个心跳 + 调度抖动"，同时比 `connectTimeout`(15s) 略长，
 * 因此**不会**与"TCP 层连接超时"打架（那种情况由 err 回调走既有退避）。
 */
export const SSE_ATTEMPT_STALL_MS: number = 20000;

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

/** 看门狗动作：一切正常，什么都不做。 */
export const WATCHDOG_IDLE: string = 'idle';
/** 看门狗动作：拆掉当前连接并走既有退避重连（半开连接 / 尝试挂死）。 */
export const WATCHDOG_RECONNECT: string = 'reconnect';
/** 看门狗动作：连接也没了、退避计时器也没了（异常态）⇒ 直接重开一次。 */
export const WATCHDOG_RESTART: string = 'restart';

/**
 * 看门狗的一次巡检决策（**纯函数**，可脱机单测）。
 *
 * 覆盖三种"没人管会永久卡住"的形态：
 *   ① `open` + 久无帧（≥ `silenceMs`）⇒ `reconnect`：半开连接（中间设备静默掐死，
 *      既无 `dataEnd` 也无 `err`）—— 这就是真机"永久显示正在重连"的那一类；
 *   ② `connecting`/`reconnecting` + 尝试已跑 ≥ `stallMs` 且**没有任何帧/错误**⇒ `reconnect`：
 *      尝试挂死（TCP 被中间设备接受但从不转发，`connectTimeout` 已过、`readTimeout:0` 永不超时）；
 *   ③ `connecting`/`reconnecting` + 既无底层连接、也无退避计时器 ⇒ `restart`（计时器丢失的异常态）。
 *
 * ⚠️ `retryPending === true`（退避计时器在跑）时**一律 IDLE**：不许和既有退避抢方向盘（否则重连风暴）。
 *
 * @param state        `idle` | `connecting` | `open` | `reconnecting`
 * @param reqHeld      是否持有底层 `HttpRequest`
 * @param attemptAtMs  本次尝试的开始时刻（`0` = 无尝试）
 * @param lastFrameAtMs 最后一帧到达时刻（`0` = 从未收到）
 * @param retryPending 退避计时器是否在跑
 */
export function watchdogDecision(
  state: string,
  reqHeld: boolean,
  attemptAtMs: number,
  lastFrameAtMs: number,
  nowMs: number,
  silenceMs: number,
  stallMs: number,
  retryPending: boolean,
): string {
  if (state === 'idle') {
    return WATCHDOG_IDLE;
  }
  if (state === 'open') {
    if (!reqHeld) {
      return WATCHDOG_RECONNECT; // 自称已连上却没有连接（异常态）⇒ 立刻接管
    }
    return shouldForceReconnect(state, reqHeld, lastFrameAtMs, nowMs, silenceMs)
      ? WATCHDOG_RECONNECT
      : WATCHDOG_IDLE;
  }
  // connecting / reconnecting
  if (retryPending) {
    return WATCHDOG_IDLE; // 退避计时器在跑：交给它，别抢
  }
  if (!reqHeld) {
    return WATCHDOG_RESTART; // 无连接、无计时器 ⇒ 卡死态，直接重开
  }
  if (attemptAtMs > 0 && nowMs - attemptAtMs >= stallMs) {
    return WATCHDOG_RECONNECT;
  }
  return WATCHDOG_IDLE;
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
  /** 本次连接尝试的开始时刻（`0` = 无尝试）—— 看门狗判"尝试是否挂死"用。 */
  private attemptAt: number = 0;
  /** 看门狗是否已布防（自续期的 `setTimeout`，避免依赖 `setInterval` 可用性）。 */
  private watchdogArmed: boolean = false;
  /** 看门狗下一次巡检的定时器句柄（`-1` = 无）。 */
  private watchdogTimer: number = -1;

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
   * **自主看门狗**：布防一次周期巡检（自续期 `setTimeout`，不依赖 `setInterval` 可用性）。
   *
   * 为什么必须有它（真机 2026-10-11 缺陷根因）：`readTimeout: 0` ⇒ 中间设备（hdc 反向隧道/
   * NAT/系统）**静默**掐断长连接时，既没有 `dataEnd` 也没有 `err` ⇒ 客户端**永远**停在
   * `reconnecting`，界面永久显示"连接断开，正在重连…"，且**再也不重试**。权威基准 web
   * （`src/providers/sseConnection.ts:32,85-88,250-258`）用 45s 半开看门狗兜住同一件事。
   * 这里由客户端自己巡检（不依赖页面 `onPageShow` 调 `forceReconnect`）。
   */
  private armWatchdog(): void {
    if (this.watchdogArmed) {
      return;
    }
    this.watchdogArmed = true;
    this.scheduleWatchdogTick();
  }

  /** 停表（`close()` 时调用；避免切会话/退出后仍有定时器在跑）。 */
  private stopWatchdog(): void {
    this.watchdogArmed = false;
    if (this.watchdogTimer >= 0) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = -1;
    }
  }

  private scheduleWatchdogTick(): void {
    if (!this.watchdogArmed) {
      return;
    }
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = -1;
      this.watchdogTick(Date.now());
      if (this.watchdogArmed) {
        this.scheduleWatchdogTick(); // 自续期：一次巡检后安排下一次
      }
    }, SSE_WATCHDOG_TICK_MS);
  }

  /**
   * 巡检一次并按纯函数结论动作（判定在 `watchdogDecision`，这里只做副作用 + 不抛）。
   * @param nowMs 注入的当前时刻（脱机测试/页面可显式驱动；真实巡检传 `Date.now()`）
   * @returns 实际采取的动作（`WATCHDOG_IDLE`/`WATCHDOG_RECONNECT`/`WATCHDOG_RESTART`）
   */
  probeNow(nowMs: number): string {
    try {
      if (this.stopped) {
        this.stopWatchdog();
        return WATCHDOG_IDLE;
      }
      const action: string = watchdogDecision(
        this.state,
        this.req !== null,
        this.attemptAt,
        this.lastFrameAt,
        nowMs,
        SSE_SILENCE_THRESHOLD_MS,
        SSE_ATTEMPT_STALL_MS,
        this.reconnectTimer >= 0,
      );
      if (action === WATCHDOG_RECONNECT) {
        this.scheduleReconnect();
      } else if (action === WATCHDOG_RESTART) {
        this.openStream();
      }
      return action;
    } catch (e) {
      const err: Error = e as Error;
      console.warn(`xbot sse: watchdog 失败（已忽略）: ${err.message}`);
      return WATCHDOG_IDLE;
    }
  }

  /** 巡检（内部定时器用）。 */
  private watchdogTick(nowMs: number): void {
    this.probeNow(nowMs);
  }

  /**
   * 强制探活 / 重连 —— 供页面在 `onPageShow`（回前台）调用。
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
    this.attemptAt = 0;
    // 自主看门狗：只要订阅着就周期巡检（半开连接 / 尝试挂死 / 计时器丢失三种卡死态）
    this.armWatchdog();
    this.setState('connecting');
    this.openStream();
  }

  close(): void {
    this.stopped = true;
    this.setState('idle');
    this.stopWatchdog();
    this.attemptAt = 0;
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
    // 本次尝试的开始时刻（看门狗据此判"尝试挂死"：TCP 被中间设备接受却永不转发时，
    // connectTimeout 已过、readTimeout:0 永不超时 ⇒ 只有这里能救）
    this.attemptAt = Date.now();
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
