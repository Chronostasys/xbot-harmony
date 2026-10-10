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
 * `list_subscriptions` 的元素（`protocol/events.go:327-345`）。
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
  /** 是否当前默认订阅（服务端 `IsDefault`）。 */
  active: boolean;
  /** 订阅级启用开关（v40；`omitempty` ⇒ 缺省即 false）。 */
  enabled?: boolean;
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
