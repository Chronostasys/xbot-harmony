"use strict";
/**
 * xbot 协议类型（客户端侧镜像）。
 *
 * 权威来源：xbot 仓库 `protocol/ws.go`、`protocol/events.go`、`channel/web/web_api.go`。
 * 这里只声明**客户端真正读到**的字段；未声明字段在 ArkTS 下会被安全忽略
 * （JSON.parse 后按 interface 取值）。
 */
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
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
let ChatRow = (() => {
    let _classDecorators = [Observed];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ChatRow = _classThis = class {
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
             * 该 turn **更早未下发的展示区域数**（服务端 `regions_before`）。
             * REST 历史是折叠视图（`HistoryRegionWindow = 100`）：每个 turn 只下发尾部 100 个区域，
             * 更早的必须用 `POST /api/regions` 按需取回。缺省 0 = 已完整下发。
             */
            this.regionsBefore = 0;
        }
    };
    __setFunctionName(_classThis, "ChatRow");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ChatRow = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ChatRow = _classThis;
})();
exports.ChatRow = ChatRow;
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
