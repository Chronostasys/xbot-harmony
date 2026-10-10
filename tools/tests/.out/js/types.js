"use strict";
/**
 * xbot 协议类型（客户端侧镜像）。
 *
 * 权威来源：xbot 仓库 `protocol/ws.go`、`protocol/events.go`、`channel/web/web_api.go`。
 * 这里只声明**客户端真正读到**的字段；未声明字段在 ArkTS 下会被安全忽略
 * （JSON.parse 后按 interface 取值）。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginPanelInfo = exports.ChatRow = exports.SseEventType = void 0;
/** SSE 事件名（与 web 前端白名单一致，`web/src/providers/sseConnection.ts`）。 */
class SseEventType {
}
exports.SseEventType = SseEventType;
SseEventType.text = 'text';
SseEventType.progressStructured = 'progress_structured';
SseEventType.streamContent = 'stream_content';
SseEventType.userEcho = 'user_echo';
SseEventType.session = 'session';
SseEventType.heartbeat = 'heartbeat';
SseEventType.askUser = 'ask_user';
SseEventType.askUserResolved = 'ask_user_resolved';
SseEventType.syncProgress = 'sync_progress';
SseEventType.resyncRequired = 'resync_required';
SseEventType.queueState = 'queue_state';
SseEventType.runnerStatus = 'runner_status';
SseEventType.webWidgets = 'web_widgets';
SseEventType.pluginWidgets = 'plugin_widgets';
let ChatRow = class ChatRow {
    constructor() {
        this.id = '';
        this.role = 'assistant';
        this.turnID = 0;
        this.content = '';
        this.iterations = [];
        this.isLive = false;
        /** 渲染版本：每次内容变化自增，参与 ForEach key */
        this.rev = 0;
        /**
         * 派生行内容指纹（`core/render.ets` 写入）—— 与上一帧相同则**不更新字段**、
         * 不自增 rev（保住 @ObjectLink 恒等 + 避免无谓重建）。⚠️ 纯内部状态，不参与 UI。
         */
        this.signature = '';
        /**
         * 该 turn **更早未下发的展示区域数**（服务端 `regions_before`）。
         * REST 历史是折叠视图（`HistoryRegionWindow = 100`）：每个 turn 只下发尾部 100 个区域，
         * 更早的必须用 `POST /api/regions` 按需取回。缺省 0 = 已完整下发。
         */
        this.regionsBefore = 0;
    }
};
exports.ChatRow = ChatRow;
exports.ChatRow = ChatRow = __decorate([
    Observed
], ChatRow);
/** UI 用的插件面板条目（id/名字/可打开的 URL）。 */
class PluginPanelInfo {
    constructor() {
        this.id = '';
        this.name = '';
        this.url = '';
        this.icon = '';
    }
}
exports.PluginPanelInfo = PluginPanelInfo;
