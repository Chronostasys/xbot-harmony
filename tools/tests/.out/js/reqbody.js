"use strict";
/**
 * 所有 REST 请求体的**唯一构造入口**（纯逻辑，可脱机单测）。
 *
 * ⚠️ 为什么必须集中：服务端 `decodeJSONBody(r, dst, allowEmpty)` 用的是
 * **`decoder.DisallowUnknownFields()`（严格模式）** —— 请求体里**多一个字段就直接 400
 * `invalid request body`**（真机事故：`/api/message` 带了服务端不存在的 `turn_id`，
 * 导致"你好"都发不出去，且约一半接口报 400）。
 *
 * 所以每个 body 的字段集必须与服务端结构**逐字一致**，并由 `reqbody.test.ts` 用
 * 契约测试钉死（多字段/少字段都红灯）。字段表来自服务端源码 grep：
 *   /api/message → protocol.WSClientMessage（**无 turn_id**）
 *   /api/history {channel, chat_id, limit, before_id}；/api/regions {channel, chat_id, turn_id, before_iteration, region_limit}
 *   /api/iteration_detail {channel, chat_id, turn_id, iteration}
 *   /api/queue/cancel {channel, chat_id, msg_id}；/api/queue/reorder {channel, chat_id, msg_ids}
 *   /api/ask-user/respond {channel, chat_id, question_id, answer, answers, cancelled}
 *   /api/rpc {method, params}；/api/search {query, limit}（**不是 channel/chat_id/q**）
 *   /api/chats/list {channel}；/api/chats/{id}/delete {channel}；/api/chats/{id}/rename {channel, label}
 *   /api/chats/fork {source_channel, source_chat_id, label}；/api/chats/reorder {channel, orders}
 *   /api/chats/create {label, subscription_id, model}
 *   /api/cron/list、/api/tasks/list → sessionBody {channel, chat_id}；/api/cron/remove {channel, chat_id, job_id}
 *   /api/files/list {path, show_hidden}；/api/llm-config/model {sub_id, model}；/api/llm-max-context {max_context}
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsReq = exports.ForkReq = exports.MaxContextReq = exports.LlmModelReq = exports.RpcReq = exports.FsListReq = exports.CronRemoveReq = exports.CreateChatReq = exports.RenameReq = exports.SearchReq = exports.QueueReorderReq = exports.QueueCancelReq = exports.AskRespondReq = exports.IterationDetailReq = exports.RegionsReq = exports.HistoryReq = exports.EmptyReq = exports.ChannelReq = exports.SessionReq = exports.MessageReq = void 0;
/**
 * `/api/message`（= `protocol.WSClientMessage` 的可用子集；**绝不含 turn_id**）。
 *
 * `id`（可选）= 客户端**乐观 user 行的 requestID**。必须是服务端 `WSClientMessage.ID`
 * 字段（`json:"id,omitempty"`，严格解码也认它），服务端据此把它原样回显到
 * `user_echo.ID` 与 `turn_started.turn_start.request_id` ⇒ reduce 用 requestID
 * 把乐观行与回声/历史**收敛为同一条 user 行**（web 的 `ws.send({id: rid})` 同源）。
 *
 * ⚠️ 不传 `id` 的后果（2026-10-10 真机 bug「你好渲染两次」根因）：服务端自生成
 * requestID（uuid）⇒ 回声 ID 与本地乐观行对不上 ⇒ `user_echo` 无法就地收敛、
 * 被当新 user 追加 ⇒ 同一句用户消息两条 user 行（一条绑进 turn 在回复之前、
 * 一条 pending 沉底在回复之后 —— 用户看到的"先并排、后前后各一个"）。
 */
class MessageReq {
    constructor(channel, chatId, content, uploadKeys, fileNames, fileSizes, interrupt, requestID) {
        this.channel = '';
        this.chat_id = '';
        this.content = '';
        this.channel = channel;
        this.chat_id = chatId;
        this.content = content;
        if (requestID !== undefined && requestID.length > 0) {
            this.id = requestID;
        }
        if (uploadKeys !== undefined && uploadKeys.length > 0) {
            this.upload_keys = uploadKeys;
            this.file_names = fileNames;
            this.file_sizes = fileSizes;
        }
        if (interrupt === true) {
            this.interrupt = true;
        }
    }
}
exports.MessageReq = MessageReq;
/** 需要"当前会话"的端点（session/status、queue、chats/list 等）。 */
class SessionReq {
    constructor(channel, chatId) {
        this.channel = '';
        this.chat_id = '';
        this.channel = channel;
        this.chat_id = chatId;
    }
}
exports.SessionReq = SessionReq;
/** 只要 channel 的端点（`/api/chats/{id}/switch|delete`）。 */
class ChannelReq {
    constructor(channel) {
        this.channel = '';
        this.channel = channel;
    }
}
exports.ChannelReq = ChannelReq;
/** 空体端点（`/api/session-tree`、`/api/settings`）。 */
class EmptyReq {
}
exports.EmptyReq = EmptyReq;
class HistoryReq {
    constructor(channel, chatId, limit, beforeId) {
        this.channel = '';
        this.chat_id = '';
        this.limit = 0;
        this.before_id = 0;
        this.channel = channel;
        this.chat_id = chatId;
        this.limit = limit;
        this.before_id = beforeId;
    }
}
exports.HistoryReq = HistoryReq;
class RegionsReq {
    constructor(channel, chatId, turnId, beforeIteration, limit) {
        this.channel = '';
        this.chat_id = '';
        this.turn_id = 0;
        this.before_iteration = 0;
        this.region_limit = 0;
        this.channel = channel;
        this.chat_id = chatId;
        this.turn_id = turnId;
        this.before_iteration = beforeIteration;
        this.region_limit = limit;
    }
}
exports.RegionsReq = RegionsReq;
class IterationDetailReq {
    constructor(channel, chatId, turnId, iteration) {
        this.channel = '';
        this.chat_id = '';
        this.turn_id = 0;
        this.iteration = 0;
        this.channel = channel;
        this.chat_id = chatId;
        this.turn_id = turnId;
        this.iteration = iteration;
    }
}
exports.IterationDetailReq = IterationDetailReq;
class AskRespondReq {
    constructor(channel, chatId, questionId, answer, answers, cancelled) {
        this.channel = '';
        this.chat_id = '';
        this.question_id = '';
        this.answer = '';
        this.answers = {};
        this.cancelled = false;
        this.channel = channel;
        this.chat_id = chatId;
        this.question_id = questionId;
        this.answer = answer;
        this.answers = answers;
        this.cancelled = cancelled;
    }
}
exports.AskRespondReq = AskRespondReq;
class QueueCancelReq {
    constructor(channel, chatId, msgId) {
        this.channel = '';
        this.chat_id = '';
        this.msg_id = '';
        this.channel = channel;
        this.chat_id = chatId;
        this.msg_id = msgId;
    }
}
exports.QueueCancelReq = QueueCancelReq;
class QueueReorderReq {
    constructor(channel, chatId, ids) {
        this.channel = '';
        this.chat_id = '';
        this.msg_ids = [];
        this.channel = channel;
        this.chat_id = chatId;
        this.msg_ids = ids;
    }
}
exports.QueueReorderReq = QueueReorderReq;
/** `/api/search`：服务端只认 `query`/`limit`（作用是"当前会话内检索"）。 */
class SearchReq {
    constructor(query, limit) {
        this.query = '';
        this.query = query;
        if (limit !== undefined && limit > 0) {
            this.limit = limit;
        }
    }
}
exports.SearchReq = SearchReq;
/** `/api/chats/{id}/rename`：chat_id 在**路径**上，body 只有 channel + label。 */
class RenameReq {
    constructor(channel, label) {
        this.channel = '';
        this.label = '';
        this.channel = channel;
        this.label = label;
    }
}
exports.RenameReq = RenameReq;
/** `/api/chats/create`：服务端结构是 {label, subscription_id, model}。 */
class CreateChatReq {
    constructor(label) {
        if (label !== undefined && label.length > 0) {
            this.label = label;
        }
    }
}
exports.CreateChatReq = CreateChatReq;
class CronRemoveReq {
    constructor(channel, chatId, jobId) {
        this.channel = '';
        this.chat_id = '';
        this.job_id = '';
        this.channel = channel;
        this.chat_id = chatId;
        this.job_id = jobId;
    }
}
exports.CronRemoveReq = CronRemoveReq;
class FsListReq {
    constructor(path) {
        this.path = '';
        this.path = path.length > 0 ? path : '/';
    }
}
exports.FsListReq = FsListReq;
class RpcReq {
    constructor(method) {
        this.method = '';
        this.method = method;
    }
}
exports.RpcReq = RpcReq;
class LlmModelReq {
    constructor(subId, model) {
        this.sub_id = '';
        this.model = '';
        this.sub_id = subId;
        this.model = model;
    }
}
exports.LlmModelReq = LlmModelReq;
class MaxContextReq {
    constructor(n) {
        this.max_context = 0;
        this.max_context = n;
    }
}
exports.MaxContextReq = MaxContextReq;
class ForkReq {
    constructor(channel, chatId, label) {
        this.source_channel = '';
        this.source_chat_id = '';
        this.source_channel = channel;
        this.source_chat_id = chatId;
        if (label !== undefined && label.length > 0) {
            this.label = label;
        }
    }
}
exports.ForkReq = ForkReq;
class SettingsReq {
    constructor(settings) {
        this.settings = {};
        this.settings = settings;
    }
}
exports.SettingsReq = SettingsReq;
