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
export class MessageReq {
  channel: string = '';
  chat_id: string = '';
  content: string = '';
  /** 客户端 requestID（乐观行 requestID）—— 服务端回声/回合按它精确匹配。 */
  id?: string;
  upload_keys?: string[];
  file_names?: string[];
  file_sizes?: number[];
  interrupt?: boolean;

  constructor(channel: string, chatId: string, content: string, uploadKeys?: string[],
    fileNames?: string[], fileSizes?: number[], interrupt?: boolean, requestID?: string) {
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

/** 需要"当前会话"的端点（session/status、queue、chats/list 等）。 */
export class SessionReq {
  channel: string = '';
  chat_id: string = '';

  constructor(channel: string, chatId: string) {
    this.channel = channel;
    this.chat_id = chatId;
  }
}

/** 只要 channel 的端点（`/api/chats/{id}/switch|delete`）。 */
export class ChannelReq {
  channel: string = '';

  constructor(channel: string) {
    this.channel = channel;
  }
}

/** 空体端点（`/api/session-tree`、`/api/settings`）。 */
export class EmptyReq {
}

export class HistoryReq {
  channel: string = '';
  chat_id: string = '';
  limit: number = 0;
  before_id: number = 0;

  constructor(channel: string, chatId: string, limit: number, beforeId: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.limit = limit;
    this.before_id = beforeId;
  }
}

export class RegionsReq {
  channel: string = '';
  chat_id: string = '';
  turn_id: number = 0;
  before_iteration: number = 0;
  region_limit: number = 0;

  constructor(channel: string, chatId: string, turnId: number, beforeIteration: number, limit: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.turn_id = turnId;
    this.before_iteration = beforeIteration;
    this.region_limit = limit;
  }
}

export class IterationDetailReq {
  channel: string = '';
  chat_id: string = '';
  turn_id: number = 0;
  iteration: number = 0;

  constructor(channel: string, chatId: string, turnId: number, iteration: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.turn_id = turnId;
    this.iteration = iteration;
  }
}

export class AskRespondReq {
  channel: string = '';
  chat_id: string = '';
  question_id: string = '';
  answer: string = '';
  answers: Record<string, string> = {};
  cancelled: boolean = false;

  constructor(channel: string, chatId: string, questionId: string, answer: string,
    answers: Record<string, string>, cancelled: boolean) {
    this.channel = channel;
    this.chat_id = chatId;
    this.question_id = questionId;
    this.answer = answer;
    this.answers = answers;
    this.cancelled = cancelled;
  }
}

export class QueueCancelReq {
  channel: string = '';
  chat_id: string = '';
  msg_id: string = '';

  constructor(channel: string, chatId: string, msgId: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.msg_id = msgId;
  }
}

export class QueueReorderReq {
  channel: string = '';
  chat_id: string = '';
  msg_ids: string[] = [];

  constructor(channel: string, chatId: string, ids: string[]) {
    this.channel = channel;
    this.chat_id = chatId;
    this.msg_ids = ids;
  }
}

/** `/api/search`：服务端只认 `query`/`limit`（作用是"当前会话内检索"）。 */
export class SearchReq {
  query: string = '';
  limit?: number;

  constructor(query: string, limit?: number) {
    this.query = query;
    if (limit !== undefined && limit > 0) {
      this.limit = limit;
    }
  }
}

/** `/api/chats/{id}/rename`：chat_id 在**路径**上，body 只有 channel + label。 */
export class RenameReq {
  channel: string = '';
  label: string = '';

  constructor(channel: string, label: string) {
    this.channel = channel;
    this.label = label;
  }
}

/** `/api/chats/create`：服务端结构是 {label, subscription_id, model}。 */
export class CreateChatReq {
  label?: string;
  subscription_id?: string;
  model?: string;

  constructor(label?: string) {
    if (label !== undefined && label.length > 0) {
      this.label = label;
    }
  }
}

export class CronRemoveReq {
  channel: string = '';
  chat_id: string = '';
  job_id: string = '';

  constructor(channel: string, chatId: string, jobId: string) {
    this.channel = channel;
    this.chat_id = chatId;
    this.job_id = jobId;
  }
}

export class FsListReq {
  path: string = '';

  constructor(path: string) {
    this.path = path.length > 0 ? path : '/';
  }
}

export class RpcReq {
  method: string = '';

  constructor(method: string) {
    this.method = method;
  }
}

export class LlmModelReq {
  sub_id: string = '';
  model: string = '';

  constructor(subId: string, model: string) {
    this.sub_id = subId;
    this.model = model;
  }
}

export class MaxContextReq {
  max_context: number = 0;

  constructor(n: number) {
    this.max_context = n;
  }
}

export class ForkReq {
  source_channel: string = '';
  source_chat_id: string = '';
  label?: string;

  constructor(channel: string, chatId: string, label?: string) {
    this.source_channel = channel;
    this.source_chat_id = chatId;
    if (label !== undefined && label.length > 0) {
      this.label = label;
    }
  }
}

export class SettingsReq {
  settings: Record<string, string> = {};

  constructor(settings: Record<string, string>) {
    this.settings = settings;
  }
}
