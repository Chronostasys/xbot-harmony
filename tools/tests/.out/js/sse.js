"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SseClient = void 0;
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
const _kit_NetworkKit_1 = require("@kit.NetworkKit");
const _kit_ArkTS_1 = require("@kit.ArkTS");
class SseClient {
    constructor(baseUrl) {
        this.baseUrl = '';
        this.req = null;
        this.stopped = true;
        this.chatId = '';
        this.channel = 'web';
        this.cookie = '';
        this.lastEventId = '';
        this.buffer = '';
        this.decoder = _kit_ArkTS_1.util.TextDecoder.create('utf-8');
        this.retry = 0;
        this.listener = null;
        this.reconnectTimer = -1;
        /**
         * 连接状态：`idle` | `connecting` | `open` | `reconnecting`。
         * 界面据此显示「连接断开，正在重连…」——弱网下用户必须知道"消息会不会丢"。
         */
        this.state = 'idle';
        /** 状态变化回调（页面订阅） */
        this.onState = (state) => {
        };
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    setState(next) {
        if (this.state === next) {
            return;
        }
        this.state = next;
        this.onState(next);
    }
    isOpen() {
        return this.req !== null;
    }
    /** 订阅（chatId 变化时必须重新订阅 —— 服务端按 route 单订阅）。 */
    connect(chatId, channel, cookie, listener) {
        this.close();
        this.chatId = chatId;
        this.channel = channel;
        this.cookie = cookie;
        this.listener = listener;
        this.stopped = false;
        this.retry = 0;
        this.setState('connecting');
        this.openStream();
    }
    close() {
        this.stopped = true;
        this.setState('idle');
        if (this.reconnectTimer >= 0) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = -1;
        }
        if (this.req !== null) {
            const r = this.req;
            this.req = null;
            r.off('dataReceive');
            r.off('dataEnd');
            r.off('headersReceive');
            r.destroy();
        }
    }
    openStream() {
        if (this.stopped) {
            return;
        }
        const req = _kit_NetworkKit_1.http.createHttp();
        this.req = req;
        this.buffer = '';
        let url = `${this.baseUrl}/api/sse?chat_id=${encodeURIComponent(this.chatId)}`
            + `&channel=${encodeURIComponent(this.channel)}`;
        if (this.lastEventId.length > 0) {
            url += `&last_event_id=${encodeURIComponent(this.lastEventId)}`;
        }
        req.on('dataReceive', (chunk) => {
            // 收到第一帧即视为已连上（心跳也算）
            this.setState('open');
            this.retry = 0;
            const text = this.decoder.decodeToString(new Uint8Array(chunk), { stream: true });
            this.buffer += text;
            this.drain();
        });
        req.on('dataEnd', () => {
            // 服务端关闭（重启/网络切换）→ 退避重连
            this.scheduleReconnect();
        });
        const headers = {
            'Accept': 'text/event-stream',
            // 刻意不声明 zstd/gzip：避免客户端解压负担（服务端按 Accept-Encoding 协商）
            'Accept-Encoding': 'identity',
            'Cookie': this.cookie,
        };
        req.requestInStream(url, {
            method: _kit_NetworkKit_1.http.RequestMethod.GET,
            header: headers,
            connectTimeout: 15000,
            readTimeout: 0,
        }, (err, code) => {
            if (err !== undefined && err !== null && err.code !== 0) {
                this.scheduleReconnect();
            }
        });
    }
    scheduleReconnect() {
        if (this.stopped) {
            return;
        }
        this.setState('reconnecting');
        if (this.req !== null) {
            const r = this.req;
            this.req = null;
            r.off('dataReceive');
            r.off('dataEnd');
            r.destroy();
        }
        this.retry = Math.min(this.retry + 1, 6);
        const delay = Math.min(1000 * Math.pow(2, this.retry - 1), 15000);
        if (this.reconnectTimer >= 0) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = -1;
            this.openStream();
        }, delay);
    }
    /** 解析缓冲区里完整的 SSE 帧（`\n\n` 分隔）。 */
    drain() {
        for (;;) {
            const idx = this.buffer.indexOf('\n\n');
            if (idx < 0) {
                return;
            }
            const block = this.buffer.substring(0, idx);
            this.buffer = this.buffer.substring(idx + 2);
            this.dispatch(block);
        }
    }
    dispatch(block) {
        const lines = block.split('\n');
        let event = 'message';
        let data = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length === 0 || line.startsWith(':')) {
                continue;
            }
            const colon = line.indexOf(':');
            const field = colon >= 0 ? line.substring(0, colon) : line;
            let value = colon >= 0 ? line.substring(colon + 1) : '';
            if (value.startsWith(' ')) {
                value = value.substring(1);
            }
            if (field === 'event') {
                event = value;
            }
            else if (field === 'data') {
                data = data.length === 0 ? value : `${data}\n${value}`;
            }
            else if (field === 'id') {
                this.lastEventId = value;
            }
        }
        if (data.length === 0) {
            return; // 纯注释/心跳保活块
        }
        const cb = this.listener;
        if (cb !== null) {
            cb(event, data);
        }
    }
}
exports.SseClient = SseClient;
