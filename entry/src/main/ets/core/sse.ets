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

export type SseListener = (event: string, data: string) => void;

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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  isOpen(): boolean {
    return this.req !== null;
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
    this.openStream();
  }

  close(): void {
    this.stopped = true;
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
    let url: string = `${this.baseUrl}/api/sse?chat_id=${encodeURIComponent(this.chatId)}`
      + `&channel=${encodeURIComponent(this.channel)}`;
    if (this.lastEventId.length > 0) {
      url += `&last_event_id=${encodeURIComponent(this.lastEventId)}`;
    }

    req.on('headersReceive', (header: object) => {
      const h: Record<string, string> = header as Record<string, string>;
      if (h !== undefined && h['content-type'] !== undefined) {
        // 说明服务端接受了订阅（text/event-stream）
      }
    });
    req.on('dataReceive', (chunk: ArrayBuffer) => {
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
    }, (err: Error) => {
      if (err !== undefined && err !== null) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
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
