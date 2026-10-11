/**
 * RPC 地基 —— `POST /api/rpc` 的**唯一构造入口**（纯逻辑，可脱机单测）。
 *
 * 为什么需要它：xbot 原生侧此前只有 `core/reqbody.ets` 的 `RpcReq`，而它**只有 method、没有 params**
 * （reqbody.ets:235-241）—— 只能驱动无参 RPC（`runner_list`、`web_plugin_list`）。
 * 而 web 的**整个设置面**都走带参数的 RPC：
 *   `postAPI('/api/rpc', { method, params })`（web `lib/api.ts:29-33`、`agent/api.ts:680-796`）。
 * 故这里补齐 `{method, params}` 这一层，并把 method 名**集中成常量表**（禁止调用点散落字符串）。
 *
 * ⚠️ 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译 ⇒
 * **禁止**引用 ArkUI / `@ohos.*` 全局类型（TS2307）。只依赖 `./http` 的 `XbotHttp`（其 @kit 依赖
 * 在脱机侧由 mocks/stubs 兜住）。
 *
 * 契约来源（逐条核对）：
 *   · `{method, params}` 请求形状 —— web `lib/api.ts:29-33` / `SettingsTools.tsx:31-33`
 *   · get_tools_settings → `{tools:[{name,description,enabled,server_name?}]}`（admin）
 *     服务端 `serverapp/rpc_table.go:699-701` + `agent/agent.go:4405-4413`
 *   · set_tool_enabled `{name,enabled}` → void（admin）—— `rpc_table.go:702-713`
 *   · list_subscriptions `{}` → `[]protocol.Subscription` —— `rpc_table.go:815` + `protocol/events.go:327-345`
 *   · list_all_model_entries `{}` → `[]protocol.ModelEntry` —— `rpc_table.go:754-761` + `events.go:394-403`
 *   · set_subscription_enabled `{sub_id,enabled}` → void —— `rpc_table.go:672-677`
 *   · set_default_subscription `{id,chat_id?,channel?}` → void —— `rpc_table.go:2696-2705`
 */
import { XbotHttp } from './http';
import { DemoRecord, EXPORT_BENCHMARK } from './export';

// ── 请求构造 ──────────────────────────────────────────────────────────────────

/** 空 params（服务端对 `{}` 与缺省一视同仁；这里显式发 `{}`，与 web 一致）。 */
export class EmptyParams {
}

/**
 * RPC 请求体 `{method, params}`。
 *
 * ⚠️ `params` 声明为 `Object`（而非 `Record<string, Object>`）：ArkTS 禁结构化类型
 * （`arkts-no-structural-typing`），具名参数类（ToolEnabledParams 等）**不可**赋给 `Record<...>`。
 * 用 `Object` 承载具名小类，`JSON.stringify` 仍按自有可枚举字段展开 —— 与既有 `RpcReq`
 * 走 `http.post` 的路径完全一致（store.ets:980）。
 */
export class RpcParamsReq {
  method: string = '';
  params: Object = new EmptyParams();

  constructor(method: string, params?: Object) {
    this.method = method;
    if (params !== undefined) {
      this.params = params;
    }
  }
}

/** `/api/rpc` 的路径常量（唯一引用点，别处勿再拼字面量）。 */
export const RPC_PATH: string = '/api/rpc';

// ── method 名常量表（集中定义，禁止调用点散落字符串）────────────────────────────

export const RPC_RUNNER_LIST: string = 'runner_list';
export const RPC_WEB_PLUGIN_LIST: string = 'web_plugin_list';
export const RPC_GET_TOOLS_SETTINGS: string = 'get_tools_settings';
export const RPC_SET_TOOL_ENABLED: string = 'set_tool_enabled';
export const RPC_LIST_SUBSCRIPTIONS: string = 'list_subscriptions';
export const RPC_LIST_ALL_MODEL_ENTRIES: string = 'list_all_model_entries';
export const RPC_SET_SUBSCRIPTION_ENABLED: string = 'set_subscription_enabled';
export const RPC_SET_DEFAULT_SUBSCRIPTION: string = 'set_default_subscription';
export const RPC_GET_SETTINGS: string = 'get_settings';
export const RPC_SET_SETTING: string = 'set_setting';

// ── llm 分区的「并发 / 思考模式」（波6；逐个核对服务端 rpc_table.go，非猜测）──────
//
// ⚠️ 这 4 个都是 **no-admin**（`rpc0`/`rpc1void` 直接注册，没有 `requireAdmin` 包裹）——
//    与 `get_tools_settings` 那类 admin 方法不同。见 `rpc_table.go:690-695, 714-729`。
/** `get_llm_concurrency`（无参 `rpc0`）→ `int` = 生效并发数。`rpc_table.go:714`。 */
export const RPC_GET_LLM_CONCURRENCY: string = 'get_llm_concurrency';
/** `set_llm_concurrency`（`rpc1void`）`{personal:int}` → void。`rpc_table.go:715-729`。 */
export const RPC_SET_LLM_CONCURRENCY: string = 'set_llm_concurrency';
/** `get_user_thinking_mode`（无参 `rpc0`）→ `string`（**空串 = auto**）。`rpc_table.go:690`。 */
export const RPC_GET_USER_THINKING_MODE: string = 'get_user_thinking_mode';
/** `set_user_thinking_mode`（`rpc1void`）`{mode:string}` → void。`rpc_table.go:691-695`。 */
export const RPC_SET_USER_THINKING_MODE: string = 'set_user_thinking_mode';

// ── llm 分区的「模型 / 订阅」增删改（波7；逐个核对服务端 rpc_table.go，非猜测）──────
//
// ⚠️ **这 8 个方法在服务端全部存在**（`rpc_table.go:839-970` 订阅 CRUD + `:653-651` 模型 CRUD
//    + `:762-769` 刷新）——此前"缺 10+ RPC"的结论**是原生缺常量与 UI，不是服务端没有**。
//    调用点（web）：`web/src/components/agent/api.ts:684-800`；逻辑编排 `useLLMSettings.ts:171-382`。
//    **全部 no-admin**（直接 `rpc1void` 注册，没有 `requireAdmin` 包裹）。
//
// 参数契约（逐字取自服务端 params struct 的 json tag）：
//   · `add_subscription`    `{sub:{id,name,provider,base_url,api_key,model,active,max_output_tokens,thinking_mode,api_type,per_model_configs}}`
//                            —— `rpc_table.go:839-852`；web `api.ts:696-709` 固定发 `id:''`。
//   · `update_subscription` `{id, sub:{name,provider,base_url,api_key,model,active,max_output_tokens,thinking_mode,api_type,per_model_configs}}`
//                            —— `rpc_table.go:2605-2618`。⛔ 服务端**逐字段选择性接受**（`:2644-2670`）：
//                            name/provider/base_url 掩码值会被忽略、api_key 掩码不覆盖真值 ⇒ **掩码回填是安全的**。
//   · `remove_subscription` `{id}` → void —— `rpc_table.go:927-951`。
//   · `upsert_model`        `{sub_id,model,max_context,max_output,api_type,thinking_mode}` → void —— `rpc_table.go:653-669`。
//   · `remove_model`        `{sub_id,model}` → void —— `rpc_table.go:639-651`。
//   · `set_model_enabled`   `{sub_id,model,enabled}` → void —— `rpc_table.go:631-637`。
//   · `update_per_model_config` `{id,model,config:{max_output_tokens,max_context,api_type,enabled,vision,vision_detail}}`
//                            —— `rpc_table.go:885-926`；`protocol/events.go:348-362`。
//   · `refresh_model_entries`（无参）→ `[]protocol.ModelEntry` —— `rpc_table.go:762-769`。
/** `add_subscription`（`rpc1void`）→ void。`rpc_table.go:839-883`；web `api.ts:696-709`。 */
export const RPC_ADD_SUBSCRIPTION: string = 'add_subscription';
/** `update_subscription`（`rpc1void`）→ void。`rpc_table.go:884,2605-2694`；web `api.ts:727-740`。 */
export const RPC_UPDATE_SUBSCRIPTION: string = 'update_subscription';
/** `remove_subscription`（`rpc1void`）`{id}` → void。`rpc_table.go:927-951`；web `api.ts:743-745`。 */
export const RPC_REMOVE_SUBSCRIPTION: string = 'remove_subscription';
/** `upsert_model`（`rpc1void`）→ void（登记/更新订阅下的一条模型）。`rpc_table.go:653-669`；web `api.ts:773-781`。 */
export const RPC_UPSERT_MODEL: string = 'upsert_model';
/** `remove_model`（`rpc1void`）`{sub_id,model}` → void（永久删模型）。`rpc_table.go:639-651`；web `api.ts:769-771`。 */
export const RPC_REMOVE_MODEL: string = 'remove_model';
/** `set_model_enabled`（`rpc1void`）`{sub_id,model,enabled}` → void。`rpc_table.go:631-637`；web `api.ts:765-767`。 */
export const RPC_SET_MODEL_ENABLED: string = 'set_model_enabled';
/** `update_per_model_config`（`rpc1void`）`{id,model,config}` → void。`rpc_table.go:885-926`；web `api.ts:761-763`。 */
export const RPC_UPDATE_PER_MODEL_CONFIG: string = 'update_per_model_config';
/** `refresh_model_entries`（无参 `rpc0err`）→ `[]protocol.ModelEntry`。`rpc_table.go:762-769`；web `api.ts:798-800`。 */
export const RPC_REFRESH_MODEL_ENTRIES: string = 'refresh_model_entries';

// ── 用户级上下文上限（web `useSessionContext` 的 `max_context_tokens` 同族）────────────────
//
// ⛔ **为什么必须走 RPC**（2026-10-12 真机：设了 1M 上下文却显示「未设置」）：
//   服务端真正的读写入口是 `get_user_max_context`（`rpc0` → int）/ `set_user_max_context`
//   （`rpc1void` `{max_context}`）—— `serverapp/rpc_table.go:678-680`。
//   旧实现读 `GET /api/llm-config`（该路由注册为 **POST-only** ⇒ GET 恒 405 ⇒ 从来没取到过）、
//   写 `POST /api/llm-max-context`（`channel/web/web.go` 里**未注册**该路由 ⇒ 404）。
//   ⇒ 与 web 同源：改走上面两条 RPC。
/** `get_user_max_context`（无参）→ `int`（用户级上下文上限；0/负 = 未设置）。 */
export const RPC_GET_USER_MAX_CONTEXT: string = 'get_user_max_context';
/** `set_user_max_context`（`rpc1void`）`{max_context}` → void。 */
export const RPC_SET_USER_MAX_CONTEXT: string = 'set_user_max_context';

/**
 * `set_user_max_context` 的入参。
 *
 * ⚠️ 字段名**必须**是 `max_context`（服务端 `rpc_table.go:679-681` 的 json tag）。
 */
export class MaxContextParams {
  max_context: number = 0;

  constructor(n: number) {
    this.max_context = n;
  }
}

/** 归一化用户级上限：非有限数 / ≤0 ⇒ `0`（读作"未设置"，桌面端同口径）。 */
export function normalizeMaxContext(v: number | null | undefined): number {
  if (v === undefined || v === null) {
    return 0;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    return 0;
  }
  return v;
}

// ⛔ 2026-10-12 修「模型面板永久转圈」时：`list_all_model_entries` 的常量**早已定义在上方常量表**
//   （`RPC_LIST_ALL_MODEL_ENTRIES`，:63，且已登记进 `RpcMethod.ALL`）⇒ ⛔ 别在此处再定义一份
//   （会 `TS2451 Cannot redeclare`）。取模型列表**必须走 RPC `list_all_model_entries`**，
//   理由：服务端 `channel/web/web.go:918` 把 `/api/llm-config` 注册为 **`authenticatedPOST(...)`
//   （只收 POST）** ⇒ `GET` **恒 405**（实测 0.4ms `method not allowed`）⇒ 旧实现的
//   `http.getAs('/api/llm-config')` **永远拉不到模型列**（旧版还静默吞错 ⇒ **永久转圈**）。
//   web 侧同样从不走那条 REST（`useLLMSettings.ts:10`：All RPC calls go through `WSConnection.rpc`
//   → `POST /api/rpc`）⇒ RPC 才是"与 web 同源"的入口。**

// ── 会话级订阅查询（web `components/sidebar/SessionInfo.tsx` 的「订阅」行）─────────────
//
// ⚠️ **未登记进 `RpcMethod.ALL`**：`tools/tests/rpc.test.ts` 的 `NAMED` 是**硬编码清单**且断言
//    `ALL.length === NAMED.length` ⇒ 登记会让它红（与 `RPC_PLUGIN_CONFIG`/`RPC_GET_STORAGE_CONFIG`
//    等既有现状**同因**）。待 rpc.test.ts 归属线一并登记后再补。
//
// 契约（逐字核对服务端 `rpc_table.go:817-835`）：
//   · params `{chat_id, channel}`；⚠️ `channel` 缺省**回落 `"cli"`**（`rpc_table.go:820-822`）
//     ⇒ **web 会话必须显式传 `"web"`**，否则读到**错的租户行**（同一空格坑见
//     `docs/WEB-PARITY.md:371` 的 `set_default_subscription`）。
//   · 返回 `{subscription_id?, model?}`（两字段都可能缺；无租户行时回 `{}`）。
//   · 调用点 web `agent/api.ts:803`（`fetchSessionSubscription` `:270-275`，
//     params 走 `sessionBody` `:663-669`）；渲染方 `SessionInfo.tsx:57-80,191-193`。
/** `get_session_subscription`（`rpc1`）`{chat_id, channel}` → `{subscription_id?, model?}`。
 *  `rpc_table.go:817-835`；web `agent/api.ts:803`。 */
export const RPC_GET_SESSION_SUBSCRIPTION: string = 'get_session_subscription';

/**
 * `get_session_subscription` 的回包（服务端 `map[string]string`；两字段都可能缺）。
 *
 * ⚠️ 服务端**无租户行、且 LLMFactory 缓存里也没该会话**时回 `map[string]string{}`（空 map）
 *   ⇒ `subscription_id`/`model` **双双 undefined**。渲染侧必须按"空 ⇒ 不显示该行"处理
 *    （web `SessionInfo.tsx:191` 的 `subscription !== '—'`）。
 */
export interface SessionSubscription {
  subscription_id?: string;
  /** ⚠️ 与 `subscription_id` 可能**只有其一**（`rpc_table.go:826` 租户行分支 / `:831` 缓存回退分支）。 */
  model?: string;
}

/**
 * 取「订阅」显示串（纯逻辑，可脱机单测）。
 *
 * 逐字对齐 web `SessionInfo.tsx:80` 的 `sub?.subscription_id || sub?.subscription || '—'`：
 * 空串 / 缺字段 ⇒ `''`（调用方据此**不显示该行**，⛔ 不编造、不显示占位 `—`）。
 * ⚠️ 只读 `subscription_id`：`sub.subscription` 是 web 对**不在类型里的旧字段**的防御性回退，
 *    服务端 `rpc_table.go:826` 只发 `subscription_id` ⇒ 原生**不引入该无源回退**。
 */
export function sessionSubscriptionId(sub: SessionSubscription | undefined): string {
  if (sub === undefined || sub === null) {
    return '';
  }
  const id: string | undefined = sub.subscription_id;
  return id !== undefined && id !== null ? id : '';
}

// ── 会话导出 / 导入（web `agent/api.ts`；服务端 `rpc_table.go`）──────────────────────
//
// ⚠️ "会话导出"在 web 侧**只有 2 个 RPC**（另 2 个导入是其逆操作）——**没有** markdown 专用方法：
//    · `export_session`       —— 返回整包 `ExportedSession`；native/openai/codex/multica 四种形态
//                                全由**前端本地**由该回包生成（web `api.ts:394-566`）；
//    · `export_session_jsonl` —— 返回 `{records, count}`（benchmark，HLE/mint-bench）；
//    · `import_session` / `import_session_jsonl` —— 上述两者的逆（web `import_session` 调用点 `api.ts:587`）。
// 参数统一是 `sessionBody(session)` = `{channel, chat_id}`（web `api.ts:663-669`）。
// 逐字取证：web `api.ts:332-337`（`export_session`）、`:385-388`（`export_session_jsonl`）、
//   `:585-590`（`import_session`）；服务端字面量 `agent/req_types.go:83-84`、
//   注册 `serverapp/rpc_table.go:1485`（export）/`:1542`（import）/`:1577`（export_jsonl）/`:1606`（import_jsonl）。

/** `export_session` → `ExportedSession`（web `api.ts:332-337`；服务端 `rpc_table.go:1485`）。 */
export const RPC_EXPORT_SESSION: string = 'export_session';
/** `export_session_jsonl` → `{records, count}`（web `api.ts:385-388`；服务端 `rpc_table.go:1577`）。 */
export const RPC_EXPORT_SESSION_JSONL: string = 'export_session_jsonl';
/** `import_session` —— `export_session` 的逆（web `api.ts:585-590`；服务端 `rpc_table.go:1542`）。 */
export const RPC_IMPORT_SESSION: string = 'import_session';
/** `import_session_jsonl` —— `export_session_jsonl` 的逆（服务端 `rpc_table.go:1606`；web 无调用点）。 */
export const RPC_IMPORT_SESSION_JSONL: string = 'import_session_jsonl';

/**
 * method 名常量表（静态访问形式：`RpcMethod.getToolsSettings`）。
 *
 * `ALL` 是**完整性清单**：`tools/tests/rpc.test.ts` 断言每个具名常量都在 `ALL` 里、
 * 且 `ALL` 无重复 —— 新增 method 时若忘了登记，测试红灯（防止常量表与调用点漂移）。
 */
export class RpcMethod {
  static readonly runnerList: string = RPC_RUNNER_LIST;
  static readonly webPluginList: string = RPC_WEB_PLUGIN_LIST;
  static readonly getToolsSettings: string = RPC_GET_TOOLS_SETTINGS;
  static readonly setToolEnabled: string = RPC_SET_TOOL_ENABLED;
  static readonly listSubscriptions: string = RPC_LIST_SUBSCRIPTIONS;
  static readonly listAllModelEntries: string = RPC_LIST_ALL_MODEL_ENTRIES;
  static readonly setSubscriptionEnabled: string = RPC_SET_SUBSCRIPTION_ENABLED;
  static readonly setDefaultSubscription: string = RPC_SET_DEFAULT_SUBSCRIPTION;
  static readonly getSettings: string = RPC_GET_SETTINGS;
  static readonly setSetting: string = RPC_SET_SETTING;
  static readonly getLlmConcurrency: string = RPC_GET_LLM_CONCURRENCY;
  static readonly setLlmConcurrency: string = RPC_SET_LLM_CONCURRENCY;
  static readonly getUserThinkingMode: string = RPC_GET_USER_THINKING_MODE;
  static readonly setUserThinkingMode: string = RPC_SET_USER_THINKING_MODE;
  static readonly addSubscription: string = RPC_ADD_SUBSCRIPTION;
  static readonly updateSubscription: string = RPC_UPDATE_SUBSCRIPTION;
  static readonly removeSubscription: string = RPC_REMOVE_SUBSCRIPTION;
  static readonly upsertModel: string = RPC_UPSERT_MODEL;
  static readonly removeModel: string = RPC_REMOVE_MODEL;
  static readonly setModelEnabled: string = RPC_SET_MODEL_ENABLED;
  static readonly updatePerModelConfig: string = RPC_UPDATE_PER_MODEL_CONFIG;
  static readonly refreshModelEntries: string = RPC_REFRESH_MODEL_ENTRIES;
  static readonly exportSession: string = RPC_EXPORT_SESSION;
  static readonly exportSessionJsonl: string = RPC_EXPORT_SESSION_JSONL;
  static readonly importSession: string = RPC_IMPORT_SESSION;
  static readonly importSessionJsonl: string = RPC_IMPORT_SESSION_JSONL;

  /** 全部 method（顺序 = 展示/文档顺序）。 */
  static readonly ALL: string[] = [
    RPC_RUNNER_LIST,
    RPC_WEB_PLUGIN_LIST,
    RPC_GET_TOOLS_SETTINGS,
    RPC_SET_TOOL_ENABLED,
    RPC_LIST_SUBSCRIPTIONS,
    RPC_LIST_ALL_MODEL_ENTRIES,
    RPC_SET_SUBSCRIPTION_ENABLED,
    RPC_SET_DEFAULT_SUBSCRIPTION,
    RPC_GET_SETTINGS,
    RPC_SET_SETTING,
    RPC_GET_LLM_CONCURRENCY,
    RPC_SET_LLM_CONCURRENCY,
    RPC_GET_USER_THINKING_MODE,
    RPC_SET_USER_THINKING_MODE,
    RPC_ADD_SUBSCRIPTION,
    RPC_UPDATE_SUBSCRIPTION,
    RPC_REMOVE_SUBSCRIPTION,
    RPC_UPSERT_MODEL,
    RPC_REMOVE_MODEL,
    RPC_SET_MODEL_ENABLED,
    RPC_UPDATE_PER_MODEL_CONFIG,
    RPC_REFRESH_MODEL_ENTRIES,
    RPC_EXPORT_SESSION,
    RPC_EXPORT_SESSION_JSONL,
    RPC_IMPORT_SESSION,
    RPC_IMPORT_SESSION_JSONL,
  ];
}

// ── 具名 params 类（ArkTS 禁无类型对象字面量 ⇒ 一律用具名类）────────────────────

/** `set_tool_enabled` 的 params（服务端 `rpc_table.go:702-705`）。 */
export class ToolEnabledParams {
  name: string = '';
  enabled: boolean = false;

  constructor(name: string, enabled: boolean) {
    this.name = name;
    this.enabled = enabled;
  }
}

/** `set_subscription_enabled` 的 params（服务端 `rpc_table.go:672-675`）。 */
export class SubscriptionEnabledParams {
  sub_id: string = '';
  enabled: boolean = false;

  constructor(subId: string, enabled: boolean) {
    this.sub_id = subId;
    this.enabled = enabled;
  }
}

/**
 * `set_default_subscription` 的 params（服务端 `rpc_table.go:2696-2705`）。
 *
 * ⚠️ 字段名是 **`id`**（不是 `sub_id`！）—— web `agent/api.ts:751-753` 传 `{id, chat_id}`。
 * `chat_id` 为空串 ⇒ 服务端走**全局默认**分支；非空则只切该会话（需要 `channel`）。
 * 本轮只做全局默认 ⇒ chat_id 恒为 ""。
 */
export class DefaultSubscriptionParams {
  id: string = '';
  chat_id: string = '';

  constructor(id: string) {
    this.id = id;
  }
}

/**
 * 会话选择器参数 `{channel, chat_id}` —— 会话导出/导入 4 个 RPC 共用的入参形状。
 * 逐字对齐 web `agent/api.ts:663-669 sessionBody`：`{ channel: session.channel, chat_id: session.chatID }`。
 * ⚠️ 键名是 **`chat_id`（下划线）**，不是 `chatID` —— 服务端 `json:"chat_id"`（`rpc_table.go:1489/1546/1580/1609`）。
 */
export class SessionSelectorParams {
  channel: string = '';
  chat_id: string = '';

  constructor(channel: string, chatID: string) {
    this.channel = channel;
    this.chat_id = chatID;
  }
}

/**
 * 会话导出：格式 → RPC 方法（web `api.ts:383-394` 的分派，纯逻辑）。
 *
 * 只有 **`benchmark`** 走专用 RPC `export_session_jsonl`；其余（native/openai/codex/multica）
 * 都取 `export_session` 的整包后**由前端本地**生成（web `api.ts:394-566`）。
 * ⛔ 没有 markdown 形态 ⇒ 无 `export_session_markdown` 之类方法（见 `docs/WEB-PARITY.md` §11.5 ⑧）。
 */
export function exportRpcMethod(format: string): string {
  return format === EXPORT_BENCHMARK ? RPC_EXPORT_SESSION_JSONL : RPC_EXPORT_SESSION;
}

/** 设置命名空间常量（web 全程用 `'cli'`；服务端把它落到单操作员的 `cli_user` 行）。 */
export const SETTINGS_NS_CLI: string = 'cli';

/**
 * `get_settings` 的 params（服务端 `rpc_table.go:450-453`）→ `Record<string,string>`。
 *
 * ⚠️ `sender_id` 必须**显式发空串**：服务端忽略它（用 `cliSenderID`），
 * 但 web 的 `api.ts:836-841` 就是发 `{namespace, sender_id: ''}`，保持一致。
 */
export class GetSettingsParams {
  namespace: string = SETTINGS_NS_CLI;
  sender_id: string = '';

  constructor(namespace: string) {
    this.namespace = namespace;
  }
}

/**
 * `set_setting` 的 params（服务端 `rpc_table.go:506-511`）。
 * web `api.ts:843-845`：`{namespace, sender_id: '', key, value}` —— **逐键写**。
 */
export class SetSettingParams {
  namespace: string = SETTINGS_NS_CLI;
  sender_id: string = '';
  key: string = '';
  value: string = '';

  constructor(namespace: string, key: string, value: string) {
    this.namespace = namespace;
    this.key = key;
    this.value = value;
  }
}

/**
 * `set_llm_concurrency` 的 params（服务端 `rpc_table.go:715-717`）。
 *
 * ⚠️ 字段名是 **`personal`**（不是 `n`/`value`/`concurrency`）—— web `agent/api.ts:830-832`
 * 就是 `rpc('set_llm_concurrency', { personal })`。取值域 `1-100`（`setting_keys.go:154`）。
 */
export class LlmConcurrencyParams {
  personal: number = 0;

  constructor(personal: number) {
    this.personal = personal;
  }
}

/**
 * `set_user_thinking_mode` 的 params（服务端 `rpc_table.go:691-693`）。
 *
 * ⚠️ 服务端会把 `"auto"` **归一成空串**再落库（`agent/llm_config_handler.go:630-632`），
 * 取值域见 `setting_keys.go:105`：`|think|think-max|disabled|enabled`（**空串 = auto**）。
 * 传 `"enabled"` 是 web 的显示值 `think` 对应的库内形态（`SettingsLLM.tsx:120-121`）。
 */
export class ThinkingModeParams {
  mode: string = '';

  constructor(mode: string) {
    this.mode = mode;
  }
}

/**
 * 订阅的「请求体子结构」（`add_subscription` / `update_subscription` 的 `sub` 字段）。
 *
 * 字段集合逐字取自服务端 `rpc_table.go:840-852 / 2607-2617`（两层 struct 的 json tag）。
 * web `api.ts:696-709 / 727-740` 两个调用点都发这一组字段（add 固定 `id:''`）。
 *
 * ⚠️ ArkTS 禁无类型对象字面量 ⇒ 这个子结构也必须是**具名类**（不能写 `{...}`）。
 */
export class SubscriptionBody {
  id: string = '';
  name: string = '';
  provider: string = '';
  base_url: string = '';
  /**
   * ⛔ **掩码即安全**：编辑态服务端回的是掩码（`abcd****`）——服务端只接受
   * 非空且不以 `****` 结尾的 key（`rpc_table.go:2667-2670`）⇒ 原样回传**不会**弄坏真凭据。
   * 但"新增"必须传真 key（服务端不加校验，空 key 会存成一条无凭据的坏订阅，调用时才报错）。
   */
  api_key: string = '';
  model: string = '';
  active: boolean = false;
  max_output_tokens: number = 0;
  thinking_mode: string = '';
  /** "chat_completions"（默认）| "responses" —— 仅 openai 有意义。 */
  api_type: string = '';
}

/** `add_subscription` 的 params（服务端 `rpc_table.go:839-852`）。 */
export class AddSubscriptionParams {
  sub: SubscriptionBody = new SubscriptionBody();

  constructor(sub: SubscriptionBody) {
    this.sub = sub;
  }
}

/** `update_subscription` 的 params（服务端 `rpc_table.go:2605-2618`）。 */
export class UpdateSubscriptionParams {
  id: string = '';
  sub: SubscriptionBody = new SubscriptionBody();

  constructor(id: string, sub: SubscriptionBody) {
    this.id = id;
    this.sub = sub;
  }
}

/** `remove_subscription` 的 params（服务端 `rpc_table.go:927-929`）。 */
export class IdParams {
  id: string = '';

  constructor(id: string) {
    this.id = id;
  }
}

/**
 * `upsert_model` 的 params（服务端 `rpc_table.go:653-660`）。
 *
 * web 的"登记新模型"入口只传 `(sub_id, model, 0, 0, '')`（`api.ts:773-781`）——
 * 即其余字段填零值交给服务端默认。
 */
export class UpsertModelParams {
  sub_id: string = '';
  model: string = '';
  max_context: number = 0;
  max_output: number = 0;
  api_type: string = '';
  thinking_mode: string = '';

  constructor(subId: string, model: string, maxContext: number, maxOutput: number, apiType: string) {
    this.sub_id = subId;
    this.model = model;
    this.max_context = maxContext;
    this.max_output = maxOutput;
    this.api_type = apiType;
  }
}

/** `remove_model` 的 params（服务端 `rpc_table.go:639-642`）。 */
export class RemoveModelParams {
  sub_id: string = '';
  model: string = '';

  constructor(subId: string, model: string) {
    this.sub_id = subId;
    this.model = model;
  }
}

/** `set_model_enabled` 的 params（服务端 `rpc_table.go:631-635`）。 */
export class SetModelEnabledParams {
  sub_id: string = '';
  model: string = '';
  enabled: boolean = false;

  constructor(subId: string, model: string, enabled: boolean) {
    this.sub_id = subId;
    this.model = model;
    this.enabled = enabled;
  }
}

/** `update_per_model_config` 的 `config` 子结构（`protocol/events.go:348-362`）。 */
export class PerModelConfigBody {
  max_output_tokens: number = 0;
  max_context: number = 0;
  api_type: string = '';
  /** 写路径由 `set_model_enabled` 管理；这里恒 true（对齐 web `saveModel` 的 `enabled: true`）。 */
  enabled: boolean = true;
  vision: boolean = false;
  vision_detail: string = '';

  constructor(maxContext: number, maxOutput: number, apiType: string, vision: boolean, visionDetail: string) {
    this.max_context = maxContext;
    this.max_output_tokens = maxOutput;
    this.api_type = apiType;
    this.vision = vision;
    this.vision_detail = visionDetail;
  }
}

/** `update_per_model_config` 的 params（服务端 `rpc_table.go:885-889`）。 */
export class UpdatePerModelConfigParams {
  id: string = '';
  model: string = '';
  config: PerModelConfigBody = new PerModelConfigBody(0, 0, '', false, '');

  constructor(id: string, model: string, config: PerModelConfigBody) {
    this.id = id;
    this.model = model;
    this.config = config;
  }
}

// ── 薄封装 ────────────────────────────────────────────────────────────────────

/**
 * `POST /api/rpc` 并返回 `data` 的强类型视图。
 *
 * 错误/401 语义**完全沿用** `XbotHttp.post`（http.ets:196-294）：网络失败 / HTTP 非 2xx /
 * 信封 `ok=false` 均抛 `Error`，401 额外触发 `onUnauthorized`。此处不做二次包装，
 * 避免把「admin only」这类服务端可读原因吞掉（组件需要它来显示权限提示）。
 */
export async function rpc<T>(http: XbotHttp, method: string, params?: Object): Promise<T> {
  const body: RpcParamsReq = new RpcParamsReq(method, params);
  const raw: string = await http.post(RPC_PATH, body);
  return JSON.parse(raw) as T;
}

// ── 响应模型（服务端结构镜像）──────────────────────────────────────────────────

/** `get_tools_settings` 里的单条工具（服务端 `agent/agent.go:4405-4413`）。 */
export interface RawToolSetting {
  name: string;
  description?: string;
  enabled: boolean;
  /** 后端字段名（Go `json:"server_name,omitempty"`）—— 载入时归一化到 serverName。 */
  server_name?: string;
  /** 已归一化的形态（原生内部统一用它；兼容服务端将来改 camel 的情况）。 */
  serverName?: string;
}

/** `get_tools_settings` 的 data（`rpc_table.go:700`）。 */
export interface ToolsSettingsData {
  tools?: RawToolSetting[];
}

/** `list_all_model_entries` 的元素（`protocol/events.go:394-403`）。 */
export interface ModelEntryRow {
  sub_id?: string;
  sub_name?: string;
  model: string;
  status?: string;
  vision?: boolean;
}

/**
 * 逐模型（per-model）覆盖配置（`protocol/events.go:348-368` `PerModelConfig`）。
 *
 * ⚠️ **六个字段在服务端全部 `omitempty`**（`protocol/events.go:349-368`）⇒ 零值**会从 JSON 里消失**：
 *   · 订阅级 `per_model_configs` 为空 ⇒ 该**整个键**都不出现（`events.go:339` `omitempty`）；
 *   · 某个模型的条目里 `max_context=0` ⇒ 该**子字段**不出现。
 *   ⇒ 所以"条目在、子字段缺"是**正常形态**（缺 = 用默认），而"条目不在 / 整个键不在"才是
 *     **无法预填**（见 `core/permodelcfg.ets: perModelConfigFrom`）。⛔ 两者不可混为一谈。
 * ⚠️ `enabled` 是**读侧投影**（`subscription_models.enabled`）；写路径归 `set_model_enabled`，
 *    故 `update_per_model_config` 的提交体里恒 `true`（`core/rpc.ets:PerModelConfigBody`）。
 */
export class PerModelConfig {
  /** 0 = 跟随订阅默认。 */
  max_output_tokens?: number;
  /** 0 = 跟随默认（系统默认 1M）。 */
  max_context?: number;
  /** `''` = 跟随订阅默认；仅 OpenAI 有意义（`chat_completions` | `responses`）。 */
  api_type?: string;
  /** 该模型是否启用（读侧投影）。 */
  enabled?: boolean;
  /** 视觉（多模态）开关 —— **纯手动**，无模型名白名单。 */
  vision?: boolean;
  /** OpenAI `image_url.detail`：`''`(auto) | `low` | `high`。 */
  vision_detail?: string;
}

/**
 * `list_subscriptions` 的元素（`protocol/events.go:328-345`）。
 * ⚠️ `api_key` 是**掩码**（`abcd****`，`rpc_table.go:2983` → `maskAPIKey`）——只读展示，禁止回填/提交。
 */
export interface SubscriptionRow {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  max_output_tokens?: number;
  max_context?: number;
  thinking_mode?: string;
  api_type?: string;
  /**
   * 逐模型覆盖配置（模型名 → 配置）。
   *
   * ⚠️ **必须可选**：服务端 `omitempty`（`protocol/events.go:339`）⇒ 订阅**没有任何模型**时
   *    整键缺失；老版本服务端亦可能不回传。⛔ 缺失 ≠ 全零对象 —— 见
   *    `core/permodelcfg.ets: perModelConfigFrom`（缺失 ⇒ `null`，绝不伪造）。
   * 服务端填充链（只读取证）：`storage/sqlite/user_llm_subscription.go:95-114 loadPerModelConfigs`
   *    （v42，按 `subscription_models` **每模型一条**）→ `serverapp/rpc_table.go:2980 subToChannel`
   *    → `:2568 listSubscriptions`。
   */
  per_model_configs?: Record<string, PerModelConfig>;
  /** 是否当前默认订阅（服务端 `IsDefault`）。 */
  active: boolean;
  /** 订阅级启用开关（v40；`omitempty` ⇒ 缺省即 false）。 */
  enabled?: boolean;
}

/**
 * `export_session_jsonl` 的 data（web `api.ts:385`）—— benchmark JSONL 的逐条记录。
 * ⚠️ 只有 `benchmark` 形态走这个 RPC；`export_session` 的返回是整包 `ExportedSession`
 * （见 `core/export.ets`，本文件不重复声明）。
 */
export class ExportSessionJsonlData {
  records?: DemoRecord[];
  count?: number;
}

// ── 纯逻辑：工具归一 + 分组（可脱机单测）────────────────────────────────────────

/** 归一化后的工具行（serverName 恒为 camelCase）。 */
export class ToolSettingRow {
  name: string = '';
  description: string = '';
  enabled: boolean = false;
  /** MCP server 名（空 = 内置工具）。 */
  serverName: string = '';
}

/** 一个 MCP server 下的工具分组。 */
export class McpGroup {
  server: string = '';
  tools: ToolSettingRow[] = [];
  /** 该组是否全部启用（服务器级总开关的状态）。 */
  allEnabled: boolean = false;
}

/** 工具面板视图模型（= 判据与渲染同源的纯函数产物）。 */
export class ToolsView {
  builtin: ToolSettingRow[] = [];
  mcpGroups: McpGroup[] = [];
  activeCount: number = 0;
  totalCount: number = 0;
}

/**
 * 单条工具归一。
 *
 * ⛔ **MCP 分组静默失效的根因守卫**：后端字段是 snake_case `server_name`，
 * web 曾经直接读 `serverName` ⇒ 永远 `undefined` ⇒ MCP 分组/服务器总开关**静默消失**
 * （web `SettingsTools.tsx:44-46` 的注释就是那次的记录）。
 * 这里两者都认，**snake 优先**（与 web 的 `tool.server_name ?? tool.serverName` 同序）。
 */
export function normalizeToolSetting(raw: RawToolSetting): ToolSettingRow {
  const row: ToolSettingRow = new ToolSettingRow();
  row.name = raw.name !== undefined ? raw.name : '';
  row.description = raw.description !== undefined ? raw.description : '';
  row.enabled = raw.enabled === true;
  if (raw.server_name !== undefined && raw.server_name.length > 0) {
    row.serverName = raw.server_name;
  } else if (raw.serverName !== undefined && raw.serverName.length > 0) {
    row.serverName = raw.serverName;
  }
  return row;
}

/** 归一化整个 `{tools}` 载荷（容错：缺 `tools` ⇒ 空数组，绝不抛）。 */
export function normalizeToolsSettings(data: ToolsSettingsData | undefined): ToolSettingRow[] {
  if (data === undefined || data.tools === undefined) {
    return [];
  }
  const out: ToolSettingRow[] = [];
  for (let i = 0; i < data.tools.length; i++) {
    out.push(normalizeToolSetting(data.tools[i]));
  }
  return out;
}

/**
 * 由归一化行构造视图：内置工具 + 按 MCP server 分组（**首次出现顺序**，与 web Map 一致）。
 * `activeCount/totalCount` 供摘要行显示（web `SettingsTools.tsx:72,132-134`）。
 */
export function buildToolsView(rows: ToolSettingRow[]): ToolsView {
  const view: ToolsView = new ToolsView();
  const order: string[] = [];
  const byServer: Map<string, McpGroup> = new Map<string, McpGroup>();
  let active: number = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: ToolSettingRow = rows[i];
    if (row.enabled) {
      active++;
    }
    if (row.serverName.length === 0) {
      view.builtin.push(row);
      continue;
    }
    let group: McpGroup | undefined = byServer.get(row.serverName);
    if (group === undefined) {
      const g: McpGroup = new McpGroup();
      g.server = row.serverName;
      byServer.set(row.serverName, g);
      order.push(row.serverName);
      group = g;
    }
    group.tools.push(row);
  }
  for (let i = 0; i < order.length; i++) {
    const g: McpGroup | undefined = byServer.get(order[i]);
    if (g === undefined) {
      continue;
    }
    let allOn: boolean = g.tools.length > 0;
    for (let j = 0; j < g.tools.length; j++) {
      if (!g.tools[j].enabled) {
        allOn = false;
        break;
      }
    }
    g.allEnabled = allOn;
    view.mcpGroups.push(g);
  }
  view.activeCount = active;
  view.totalCount = rows.length;
  return view;
}

/**
 * 不可变更新：返回一份把 `names` 里工具置为 `enabled` 的**新数组**（其余原样）。
 *
 * 为什么必须"新数组"：ArkUI 的 `@State` 对**数组内元素字段的原地修改不敏感**
 * ⇒ 必须替换数组引用来触发重建（`docs/ARKTS-GOTCHAS.md`）。用于开关的乐观更新 + 失败回滚。
 */
export function setToolsEnabled(rows: ToolSettingRow[], names: string[], enabled: boolean): ToolSettingRow[] {
  const want: Map<string, boolean> = new Map<string, boolean>();
  for (let i = 0; i < names.length; i++) {
    want.set(names[i], true);
  }
  const out: ToolSettingRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const src: ToolSettingRow = rows[i];
    const row: ToolSettingRow = new ToolSettingRow();
    row.name = src.name;
    row.description = src.description;
    row.serverName = src.serverName;
    row.enabled = want.has(src.name) ? enabled : src.enabled;
    out.push(row);
  }
  return out;
}

/** 该组全部工具的名字（服务器级总开关批量启停用；与 web `SettingsTools.tsx:145` 同义）。 */
export function groupToolNames(group: McpGroup): string[] {
  const out: string[] = [];
  for (let i = 0; i < group.tools.length; i++) {
    out.push(group.tools[i].name);
  }
  return out;
}

export const ENTRY_BUILTIN: string = 'builtin';
export const ENTRY_MCP_HEAD: string = 'mcpHead';
export const ENTRY_MCP_TOOL: string = 'mcpTool';

/**
 * 工具面板的**扁平化行**模型。
 *
 * 为什么要扁平：ArkUI 的 ForEach 嵌套 ForEach（组 → 组内工具）在 `@Prop` 传递类数组时
 * 容易踩"子组件不重建"的坑；把（内置行 / MCP 组头 / MCP 成员行）铺成**一层**，
 * 由一个 `@Component + @Prop` 行组件消费，语义与 web 的「builtin 列表 + 分组区块」等价。
 */
export class ToolsEntry {
  /** ENTRY_BUILTIN | ENTRY_MCP_HEAD | ENTRY_MCP_TOOL */
  kind: string = '';
  /** 显示名：工具名（builtin/mcpTool）或 server 名（mcpHead）。 */
  label: string = '';
  description: string = '';
  enabled: boolean = false;
  indented: boolean = false;
  /** 该开关作用的工具名集合（组头 = 全组；单行 = 自身）。 */
  names: string[] = [];
}

/** ForEach key（稳定 + 唯一）。 */
export function toolsEntryKey(e: ToolsEntry): string {
  return `${e.kind}|${e.label}`;
}

/** busy 判据的键（组头是逗号串，与 web `names.join(',')` 同形）。 */
export function toolsEntryBusyKey(e: ToolsEntry): string {
  return e.names.join(',');
}

/** 视图 → 扁平行（内置工具在前，MCP 分组在后，组头紧邻其成员）。 */
export function flattenToolsView(view: ToolsView): ToolsEntry[] {
  const out: ToolsEntry[] = [];
  for (let i = 0; i < view.builtin.length; i++) {
    const row: ToolSettingRow = view.builtin[i];
    const e: ToolsEntry = new ToolsEntry();
    e.kind = ENTRY_BUILTIN;
    e.label = row.name;
    e.description = row.description;
    e.enabled = row.enabled;
    e.names = [row.name];
    out.push(e);
  }
  for (let i = 0; i < view.mcpGroups.length; i++) {
    const g: McpGroup = view.mcpGroups[i];
    const head: ToolsEntry = new ToolsEntry();
    head.kind = ENTRY_MCP_HEAD;
    head.label = g.server;
    head.description = `${g.tools.length} 个工具`;
    head.enabled = g.allEnabled;
    head.names = groupToolNames(g);
    out.push(head);
    for (let j = 0; j < g.tools.length; j++) {
      const row: ToolSettingRow = g.tools[j];
      const e: ToolsEntry = new ToolsEntry();
      e.kind = ENTRY_MCP_TOOL;
      e.label = row.name;
      e.description = row.description;
      e.enabled = row.enabled;
      e.indented = true;
      e.names = [row.name];
      out.push(e);
    }
  }
  return out;
}

// ── 纯逻辑：LLM 订阅展示 ──────────────────────────────────────────────────────

/** 某订阅下的模型条目数（`list_all_model_entries` 里 `sub_id` 匹配的条数）。 */
export function countModelsForSub(entries: ModelEntryRow[], subId: string): number {
  let n: number = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].sub_id === subId) {
      n++;
    }
  }
  return n;
}

/**
 * 订阅副标题：`provider · 协议`（web `SettingsLLM.tsx:366-368` 同义）。
 * `responses` 只在 openai 下有意义（anthropic 忽略 api_type）。
 */
export function providerLine(provider: string, apiType: string): string {
  const p: string = provider.length > 0 ? provider : 'unknown';
  if (p === 'openai' && apiType === 'responses') {
    return `${p} · responses`;
  }
  return p;
}

/** base_url 去协议前缀（web 的 `s.base_url.replace(/^https?:\/\//, '')`）。 */
export function stripScheme(url: string): string {
  if (url.startsWith('https://')) {
    return url.substring(8);
  }
  if (url.startsWith('http://')) {
    return url.substring(7);
  }
  return url;
}

/**
 * 密钥展示：服务端**已掩码**（`abcd****`，`rpc_table.go:2983` → `maskAPIKey`）。
 *
 * ⛔ 这里只做**展示兜底**：空串显示占位符；**绝不**尝试回填或提交（本轮不做增删改）。
 */
export function displayApiKey(masked: string): string {
  return masked !== undefined && masked !== null && masked.length > 0 ? masked : '—';
}

/** 当前默认订阅的 id（`active` 即服务端 `IsDefault`）；无则空串。 */
export function defaultSubscriptionId(subs: SubscriptionRow[]): string {
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].active === true) {
      return subs[i].id;
    }
  }
  return '';
}

/** 订阅是否启用（服务端 `enabled,omitempty` ⇒ 缺省即 false）。 */
export function isSubscriptionEnabled(sub: SubscriptionRow): boolean {
  return sub.enabled === true;
}

// ── 纯逻辑：agent 分区（get_settings / set_setting，namespace `cli`）──────────────
//
// 键与取值域**逐条取自 web `components/settings/SettingsAgent.tsx`**（web 是权威基准）：
//   · allow_self_compact       : 「true」|「false」（设置页读 `=== 'true'`，写 `next ? 'true':'false'`）
//                                SettingsAgent.tsx:136 / :155
//   · vision_max_image_edge_px : 整数 256..8192，缺省/越界回落 **1024**   SettingsAgent.tsx:174-177
//   · vision_max_image_bytes   : **字节数字符串**；界面用 MB，`mb>0 && mb<=20`，缺省回落 **4MB=4194304**
//                                SettingsAgent.tsx:178-183
//   · vision_output_format     : 「auto」|「jpeg」，缺省回落 **auto**      SettingsAgent.tsx:184 / :249-252
//   · vision_jpeg_quality      : 整数 50..100，缺省/越界回落 **85**        SettingsAgent.tsx:185-190
//
// 服务端侧：`get_settings` 会为 DB 里没有的键注入 config 默认值（`rpc_table.go:501-502`
// 注入 allow_self_compact；`config/config.go:343` `AllowSelfCompact ... omitempty` ⇒ 默认 false）。
// `set_setting` 对普通 user 级键**不做白名单校验**（`rpc_table.go:537` 直接落 user_settings），
// ⇒ 上面的**取值范围只在客户端把关**（与 web 相同）。

export const AGENT_KEY_ALLOW_SELF_COMPACT: string = 'allow_self_compact';
export const AGENT_KEY_VISION_MAX_IMAGE_EDGE_PX: string = 'vision_max_image_edge_px';
export const AGENT_KEY_VISION_MAX_IMAGE_BYTES: string = 'vision_max_image_bytes';
export const AGENT_KEY_VISION_OUTPUT_FORMAT: string = 'vision_output_format';
export const AGENT_KEY_VISION_JPEG_QUALITY: string = 'vision_jpeg_quality';

/** agent 面板用的全部键（顺序 = 展示顺序；契约测试用它守完整性）。 */
export const AGENT_SETTING_KEYS: string[] = [
  AGENT_KEY_ALLOW_SELF_COMPACT,
  AGENT_KEY_VISION_MAX_IMAGE_EDGE_PX,
  AGENT_KEY_VISION_MAX_IMAGE_BYTES,
  AGENT_KEY_VISION_OUTPUT_FORMAT,
  AGENT_KEY_VISION_JPEG_QUALITY,
];

export const VISION_FORMAT_AUTO: string = 'auto';
export const VISION_FORMAT_JPEG: string = 'jpeg';
/** 输出格式取值域（web `SettingsAgent.tsx:249-252` 的两个 option）。 */
export const VISION_FORMATS: string[] = [VISION_FORMAT_AUTO, VISION_FORMAT_JPEG];

/** 默认值（web 的回落值，写回服务端时用）。 */
export const VISION_DEFAULT_EDGE_PX: number = 1024;
export const VISION_DEFAULT_JPEG_QUALITY: number = 85;
export const VISION_DEFAULT_MAX_IMAGE_MB: number = 4;
/** 字节/MB 换算（1024 进制；web 用 `1024*1024`）。 */
export const BYTES_PER_MB: number = 1048576;
export const VISION_MIN_EDGE_PX: number = 256;
export const VISION_MAX_EDGE_PX: number = 8192;
export const VISION_MIN_MB: number = 1;
export const VISION_MAX_MB: number = 20;
export const VISION_MIN_JPEG_QUALITY: number = 50;
export const VISION_MAX_JPEG_QUALITY: number = 100;

/** 一次设置写入（逐键 RPC 的一行）。 */
export class SettingWrite {
  key: string = '';
  value: string = '';

  constructor(key: string, value: string) {
    this.key = key;
    this.value = value;
  }
}

/** 布尔设置读法：web 只认字符串 `'true'`（`SettingsAgent.tsx:136`）——其余一律 false。 */
export function settingIsTrue(value: string | undefined): boolean {
  return value === 'true';
}

/** 布尔设置写法（`SettingsAgent.tsx:155`）。 */
export function boolSettingValue(on: boolean): string {
  return on ? 'true' : 'false';
}

/**
 * 设置面板里的整数档：**空/非法/越界 ⇒ 回落默认值**。
 *
 * ⚠️ **已不用于写回路径**（`buildVisionWrites` 改用 `settingIntOrDefaultOrSkip`）——
 *    因为它把"空"与"非空越界"**并成一档**，而 web 对非空越界是**跳过该键**（不写），
 *    写默认值会**覆盖后端已有值**（违反"状态一律以后端为准"）。保留仅为兼容既有断言。
 */
export function clampSettingInt(raw: string, min: number, max: number, fallback: number): number {
  const t: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (t.length === 0) {
    return fallback;
  }
  const n: number = parseInt(t, 10);
  if (isNaN(n) || n < min || n > max) {
    return fallback;
  }
  return n;
}

/**
 * 写回路径的整数档 —— **空 ⇒ 默认；非空但非法/越界 ⇒ `null`（= 本键不写，保留后端旧值）**。
 *
 * 权威：web `SettingsAgent.tsx:172-190` —— `else`（**只有空串**）才 push 默认；
 * 非空但 `n<min || n>max` ⇒ **该键不 push**（既不写值也不回默认）。
 * ⛔ 这正是"以后端为准"的硬要求：客户端不能因为用户输错一个数字就把服务端旧值改掉。
 */
export function settingIntOrDefaultOrSkip(
  raw: string, min: number, max: number, fallback: number,
): number | null {
  const t: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (t.length === 0) {
    return fallback;
  }
  const n: number = parseInt(t, 10);
  if (isNaN(n) || n < min || n > max) {
    return null;
  }
  return n;
}

/** 写回路径的 MB 档 —— 空 ⇒ 默认 4MB；非空但越界/非法 ⇒ `null`（不写）。web `SettingsAgent.tsx:178-183`。 */
export function mbToBytesOrDefaultOrSkip(raw: string): string | null {
  const t: string = raw !== undefined && raw !== null ? raw.trim() : '';
  const def: string = `${VISION_DEFAULT_MAX_IMAGE_MB * BYTES_PER_MB}`;
  if (t.length === 0) {
    return def;
  }
  const mb: number = parseFloat(t);
  if (isNaN(mb) || mb <= 0 || mb > VISION_MAX_MB) {
    return null;
  }
  return `${Math.round(mb * BYTES_PER_MB)}`;
}

/** 字节数 → MB 显示（保留 1 位小数；web `SettingsAgent.tsx:140`）。空/非法 ⇒ 空串（界面显示占位）。 */
export function bytesToMbInput(raw: string | undefined): string {
  const t: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (t.length === 0) {
    return '';
  }
  const n: number = parseInt(t, 10);
  if (isNaN(n)) {
    return '';
  }
  return `${Math.round(n / BYTES_PER_MB * 10) / 10}`;
}

/** MB 档 → 字节字符串（web `Math.round(mb * 1024 * 1024)`）；空/越界 ⇒ 默认 4MB。 */
export function mbInputToBytes(raw: string): string {
  const t: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (t.length === 0) {
    return `${VISION_DEFAULT_MAX_IMAGE_MB * BYTES_PER_MB}`;
  }
  const mb: number = parseFloat(t);
  if (isNaN(mb) || mb <= 0 || mb > VISION_MAX_MB) {
    return `${VISION_DEFAULT_MAX_IMAGE_MB * BYTES_PER_MB}`;
  }
  return `${Math.round(mb * BYTES_PER_MB)}`;
}

/** 输出格式归一：只认 auto/jpeg，其余 ⇒ auto（web `outputFormat || 'auto'`）。 */
export function normalizeVisionFormat(raw: string): string {
  return raw === VISION_FORMAT_JPEG ? VISION_FORMAT_JPEG : VISION_FORMAT_AUTO;
}

/**
 * 视觉设置 → **写入列表**（与 web `saveVisionSettings`（`SettingsAgent.tsx:167-200`）逐条同序同义）。
 *
 * 顺序即 web 的 `writes.push` 顺序：edge_px → bytes → output_format → jpeg_quality。
 *
 * ⛔ **空 vs 越界必须分开**（本波修的 P1，web `:172-190`）：
 *   · **空输入** ⇒ 写**默认值**（1024 / 4MB / 85）；
 *   · **非空但越界/非法** ⇒ **该键不写**（保留后端旧值）——
 *     旧实现无条件回落默认并写回 ⇒ 用户输错一个数字就把服务端原值**覆盖**成默认，
 *     违背用户常驻要求「状态一律以后端为准」。
 *   · `output_format` **恒写**（web 无条件 push；空 ⇒ `auto`）。
 */
export function buildVisionWrites(edgePx: string, maxImageMb: string, format: string, jpegQuality: string): SettingWrite[] {
  const out: SettingWrite[] = [];
  const edge: number | null = settingIntOrDefaultOrSkip(edgePx, VISION_MIN_EDGE_PX, VISION_MAX_EDGE_PX,
    VISION_DEFAULT_EDGE_PX);
  if (edge !== null) {
    out.push(new SettingWrite(AGENT_KEY_VISION_MAX_IMAGE_EDGE_PX, `${edge}`));
  }
  const bytes: string | null = mbToBytesOrDefaultOrSkip(maxImageMb);
  if (bytes !== null) {
    out.push(new SettingWrite(AGENT_KEY_VISION_MAX_IMAGE_BYTES, bytes));
  }
  out.push(new SettingWrite(AGENT_KEY_VISION_OUTPUT_FORMAT, normalizeVisionFormat(format)));
  const quality: number | null = settingIntOrDefaultOrSkip(jpegQuality, VISION_MIN_JPEG_QUALITY,
    VISION_MAX_JPEG_QUALITY, VISION_DEFAULT_JPEG_QUALITY);
  if (quality !== null) {
    out.push(new SettingWrite(AGENT_KEY_VISION_JPEG_QUALITY, `${quality}`));
  }
  return out;
}

/** 从 `get_settings` 结果里取键（缺省 ⇒ 空串，调用方走各自的 placeholder/默认）。 */
export function settingValue(settings: Record<string, string> | undefined, key: string): string {
  if (settings === undefined || settings === null) {
    return '';
  }
  const v: string | undefined = settings[key];
  return v === undefined || v === null ? '' : v;
}

// ── 纯逻辑：权限错误可读化 ─────────────────────────────────────────────────────

/**
 * 把服务端错误文案转成**可读提示**。
 *
 * `requireAdmin` 对非管理员返回 `admin only`（`rpc_table.go:137-144`）——
 * 直接显示英文原文对用户无意义，而**静默空白**更糟（用户以为没数据）。
 */
export function readableRpcError(message: string): string {
  const m: string = message !== undefined && message !== null ? message : '';
  if (m.indexOf('admin only') >= 0) {
    return '需要管理员权限：当前账号无权查看或修改该设置';
  }
  if (m.length === 0) {
    return '请求失败（服务端未返回原因）';
  }
  return m;
}

// ── 插件：配置读写 / 启停 / 重载（插件设置分区用；逐条核对服务端 `rpc_table.go`）──────

/**
 * 本组 method 名**集中在此**（与 `ToolEnabledParams` 等既有 params 类同址，本仓约定）。
 *
 * ⚠️ 未登记进 `RpcMethod.ALL`：`tools/tests/rpc.test.ts` 的 `NAMED` 是**硬编码清单**
 *    （该文件不在本波改动面）⇒ 登记会让它红。与 `core/settings.ets` 的
 *    `RPC_GET_STORAGE_CONFIG` / `RPC_SET_STORAGE_CONFIG` 等（同样**不在** `ALL` 里）
 *    是**同一现状**；待其归属线把 NAMED 补上后再一并登记。
 */

/** `plugin_config`（`rpc1`）`{id}` → `{plugins:[{id,name,title,runtime,enabled,properties,values}]}`。
 *  `rpc_table.go:2370-2453`；web `components/settings/SettingsPlugins.tsx:74-75`。 */
export const RPC_PLUGIN_CONFIG: string = 'plugin_config';
/** `plugin_config_set`（`rpc1`）`{id,key,value}` → void（服务端按 schema 校验 key 与类型）。
 *  `rpc_table.go:2458-2515`；web `SettingsPlugins.tsx:510-513`。 */
export const RPC_PLUGIN_CONFIG_SET: string = 'plugin_config_set';
/** `plugin_set_enabled`（`rpc1`）`{id,enabled}` → `{status:"ok"}`（持久化 + 广播热启停）。
 *  `rpc_table.go:2213-2233`；web `plugins/manager/PluginManagerPanel.tsx:101`。 */
export const RPC_PLUGIN_SET_ENABLED: string = 'plugin_set_enabled';
/** `plugin_reload`（`rpc1`）`{id}` → `{status:"ok"}`。`rpc_table.go:2099-2133`。 */
export const RPC_PLUGIN_RELOAD: string = 'plugin_reload';
/**
 * `plugin_status`（`rpc1`）`{rescan}` → `{plugins:[{id,name,version,state,runtime}],active,total}`。
 * `rpc_table.go:2011-2053`；web `plugins/manager/PluginManagerPanel.tsx:60`。
 *
 * ⚠️ 与 `plugin_config` 的**关键区别**：`plugin_config` 只返回**带配置声明**的插件，`web_plugin_list`
 * 只返回**有 web 产物**的插件 ⇒ 两者都看不到**纯后端插件**（script/grpc 运行时）。
 * `plugin_status` 返回后端 Go 插件系统**全量**（`pm.ListPlugins()`）⇒ 它才是"看得到所有插件"的口。
 *
 * ⚠️ 未登记进 `RpcMethod.ALL`（同 `RPC_PLUGIN_CONFIG` 等既有插件 RPC 的现状）——`tools/tests/rpc.test.ts`
 * 的 `NAMED` 是**硬编码清单**且断言 `ALL.length === NAMED.length` ⇒ 登记会让它红。待其归属线一并登记。
 */
export const RPC_PLUGIN_STATUS: string = 'plugin_status';

/** `plugin_config` 的 params（`id` 省略/空串 ⇒ 返回**全部**带配置声明的插件）。 */
export class PluginConfigParams {
  id: string = '';

  constructor(id: string) {
    this.id = id;
  }
}

/**
 * `plugin_config_set` 的 params。
 *
 * ⚠️ `value` 的类型**随 schema 而变**：boolean/number/string/select/image ⇒ 标量；
 *    multiselect ⇒ `string[]`。故用**联合类型**（ArkTS 支持联合；纯 TS 亦合法）。
 * ⛔ 服务端 `value` 是 `json.RawMessage`，且对 `boolean`/`number` **强校验类型**
 *    （`rpc_table.go:2489-2498`）⇒ 必须发**真 JSON 标量**（`true`/`3`），
 *    **不得**发字符串 `"true"`（会被判 `expected boolean` 而拒）。
 */
export class PluginConfigSetParams {
  id: string = '';
  key: string = '';
  value: boolean | number | string | string[] = '';

  constructor(id: string, key: string, value: boolean | number | string | string[]) {
    this.id = id;
    this.key = key;
    this.value = value;
  }
}

/** `plugin_set_enabled` 的 params（`rpc_table.go:2213-2215`）。 */
export class PluginSetEnabledParams {
  id: string = '';
  enabled: boolean = false;

  constructor(id: string, enabled: boolean) {
    this.id = id;
    this.enabled = enabled;
  }
}

/** `plugin_reload` 的 params（`rpc_table.go:2099-2101`）。 */
export class PluginReloadParams {
  id: string = '';

  constructor(id: string) {
    this.id = id;
  }
}

/**
 * `plugin_status` 的 params。
 * `rescan:true` ⇒ 服务端 `Discover()` + `ActivateAll()`（**只激活新发现的**；注释明言**不用**
 * `ReloadAll`——`DeactivateAll` 可能超时 30s 阻塞，`rpc_table.go:2018-2029`）⇒ 装了新插件后
 * 想立刻看到，才需要 `true`；普通刷新用 `false`（便宜）。
 */
export class PluginStatusParams {
  rescan: boolean = false;

  constructor(rescan: boolean) {
    this.rescan = rescan;
  }
}
