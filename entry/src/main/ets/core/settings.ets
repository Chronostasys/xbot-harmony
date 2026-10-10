/**
 * 设置的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web.go` + `web/src/lib/userSettings.ts`，逐字核对）：
 *   `POST /api/settings`（空体）      → `{ settings: Record<string,string> }`（也用作登录探针）
 *   `POST /api/settings {settings:{…}}` → 批量写
 * Web 的用户偏好就存在服务端，键形如 `xbot-*`（服务端名 `web:ui:*`）——
 * **原生端读写同一份 ⇒ 两端偏好天然一致**（项目要求「两边数据统一」）。
 */

// 本地键名（与服务端名一一对应；与 web `userSettings.ts` 的映射表一致）
export const KEY_MD_THEME: string = 'xbot-md-theme';
export const KEY_ACCENT: string = 'xbot-accent';
export const KEY_LOCALE: string = 'xbot-locale';
export const KEY_SEND_KEY: string = 'xbot-send-key-mode';
export const KEY_CODE_WRAP: string = 'xbot-code-word-wrap';
/**
 * 界面模式（服务端 `web:ui:ui-mode`）。
 *
 * ⚠️ **原生端不消费**：原生只有单一手机布局（无 web 的 desktop/mobile 双模式），
 * 因此本键既无 UI 也无读取点。映射**保留**只为两端 key 表一致 + 往返不被丢；
 * 服务端键 `web:ui:ui-mode` 由 web 侧拥有，**不要删**（删了会把 web 的设置弄丢）。
 */
export const KEY_UI_MODE: string = 'xbot-ui-mode';
export const KEY_STARRED: string = 'xbot-starred';
/** 原生端新增（web 不认也无害）：消息字号缩放，`0.9` / `1` / `1.15` */
export const KEY_FONT_SCALE: string = 'xbot-font-scale';
/** 新增：思考块默认是否展开（原生端偏好） */
export const KEY_REASONING_DEFAULT: string = 'xbot-reasoning-default';
/** 新增：应用主题深浅（原生端偏好；角色语义见 core/theme.ets） */
export const KEY_APP_THEME: string = 'xbot-app-theme';
/** 新增：聊天界面承载方式（`web` = 内嵌完整 web UI，与 web 一比一；`native` = 原生界面） */
export const KEY_SURFACE: string = 'xbot-surface';
/**
 * 会话列表分类（`path` / `status` / `time`）。
 *
 * 与 web **共用同一个键**（web `src/hooks/useSessionStore.ts:37` `CATEGORY_KEY`，
 * 服务端名见 `web/src/lib/userSettings.ts:42`）—— 两端偏好天然一致。
 * 取值与归一化（含历史 `time → path` 迁移）见 `core/sessiongroup.ets`。
 */
export const KEY_SESSION_CATEGORY: string = 'xbot:session-category';
/**
 * 旗舰「思考中 / 生成中」光球动效开关（`components/AssistantOrb`，消费点 `LiveTailView.orb`）。
 *
 * 原生端新增（web 不认也无害，与既有「字号/思考默认展开」同款做法 —— 只为键表一致）。
 * web 侧的在飞指示是 `ShimmerThinking` 文字扫光；本光球是原生端进一步的视觉，
 * 故**缺失即开**（见 `orbEnabled`：只有明确的假值才关）。
 */
export const KEY_ORB: string = 'xbot-assistant-orb';

/** 本地键 → 服务端键（web `userSettings.ts` 的同一张表）。 */
export function serverKey(localKey: string): string {
  if (localKey === KEY_MD_THEME) {
    return 'web:ui:md-theme';
  }
  if (localKey === KEY_ACCENT) {
    return 'web:ui:accent';
  }
  if (localKey === KEY_LOCALE) {
    return 'web:ui:locale';
  }
  if (localKey === KEY_SEND_KEY) {
    return 'web:ui:send-key-mode';
  }
  if (localKey === KEY_CODE_WRAP) {
    return 'web:ui:code-word-wrap';
  }
  if (localKey === KEY_UI_MODE) {
    return 'web:ui:ui-mode';
  }
  if (localKey === KEY_STARRED) {
    return 'web:session:starred';
  }
  if (localKey === KEY_FONT_SCALE) {
    return 'web:ui:font-scale';
  }
  if (localKey === KEY_REASONING_DEFAULT) {
    return 'web:ui:reasoning-default';
  }
  if (localKey === KEY_APP_THEME) {
    return 'web:ui:app-theme';
  }
  if (localKey === KEY_SURFACE) {
    return 'web:ui:surface';
  }
  if (localKey === KEY_SESSION_CATEGORY) {
    return 'web:session:category';
  }
  if (localKey === KEY_ORB) {
    return 'web:ui:assistant-orb';
  }
  return localKey;
}

/** 服务端键 → 本地键（读回来时反查；未知键原样保留）。 */
export function localKey(srvKey: string): string {
  const table: string[] = [KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_SEND_KEY, KEY_CODE_WRAP,
    KEY_UI_MODE, KEY_STARRED, KEY_FONT_SCALE, KEY_REASONING_DEFAULT, KEY_APP_THEME, KEY_SURFACE,
    KEY_SESSION_CATEGORY, KEY_ORB];
  for (let i = 0; i < table.length; i++) {
    if (serverKey(table[i]) === srvKey) {
      return table[i];
    }
  }
  return srvKey;
}

/** 宽松布尔解析（服务端存的是字符串）。 */
export function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) {
    return fallback;
  }
  const s: string = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') {
    return true;
  }
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') {
    return false;
  }
  return fallback;
}

/** 字号缩放的范围（0.85 – 1.4）—— 超出就夹住，绝不渲染成 0 号字或巨无霸。 */
export function clampFontScale(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    return 1;
  }
  if (n < 0.85) {
    return 0.85;
  }
  if (n > 1.4) {
    return 1.4;
  }
  return n;
}

/** 从设置值解析字号缩放（非法/缺失 ⇒ 1）。 */
export function fontScaleFrom(v: string | undefined): number {
  if (v === undefined || v.trim().length === 0) {
    return 1;
  }
  const n: number = Number.parseFloat(v);
  return clampFontScale(n);
}

/** 字号档位（小/中/大/特大）。 */
export function fontScalePresets(): number[] {
  return [0.9, 1, 1.15, 1.3];
}

/** 档位名。 */
export function fontScaleLabel(scale: number): string {
  if (scale < 0.95) {
    return '小';
  }
  if (scale < 1.1) {
    return '中';
  }
  if (scale < 1.25) {
    return '大';
  }
  return '特大';
}

/**
 * 发送键模式。取值域与**权威基准 web 逐字对齐**（`web/src/types/agent.ts:38-45`）：
 *   - `'ctrl-enter'`（默认）：Ctrl/⌘+Enter 发送，回车换行；
 *   - `'enter'`：回车发送，Shift/Ctrl+Enter 换行。
 *
 * `'mod-enter'` 是**原生端历史值**（旧版把它写进过服务端 `web:ui:send-key-mode`）——
 * 只在 normalize 读入时容忍（迁移兼容），**绝不作为输出**（否则又写回一个 web 不认的值 ⇒ 双向读错）。
 */
export const SEND_KEY_ENTER: string = 'enter';
export const SEND_KEY_MOD_ENTER: string = 'ctrl-enter';
/** 历史值（旧原生端写入服务端的值）：仅供读入迁移，新写入一律用 `ctrl-enter`。 */
export const LEGACY_SEND_KEY_MOD_ENTER: string = 'mod-enter';

export function sendKeyLabel(mode: string): string {
  return normalizeSendKey(mode) === SEND_KEY_MOD_ENTER ? 'Ctrl/⌘ + Enter 发送' : 'Enter 发送';
}

/**
 * 规范化发送键模式（与 web `useSendKeyMode.readStoredMode` **同语义**）：
 *   - `'enter'` 原样保留；
 *   - `'ctrl-enter'` / 历史 `'mod-enter'` ⇒ 统一 `'ctrl-enter'`；
 *   - 缺失 / 未知 ⇒ **web 默认 `'ctrl-enter'`**（不是 `enter`，否则与 web 默认相反）。
 */
export function normalizeSendKey(v: string | undefined): string {
  if (v === SEND_KEY_ENTER) {
    return SEND_KEY_ENTER;
  }
  return SEND_KEY_MOD_ENTER;
}

/** 把服务端返回的 `{服务端键: 值}` 映射本地化。 */
export function toLocalSettings(server: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(server);
  for (let i = 0; i < keys.length; i++) {
    out[localKey(keys[i])] = server[keys[i]];
  }
  return out;
}

/** 取一个值（缺失返回空串）。 */
export function settingOf(map: Record<string, string>, key: string): string {
  const v: string | undefined = map[key];
  return v !== undefined ? v : '';
}

/** 设置项的显示名（面板用）。 */
export function settingLabel(key: string): string {
  if (key === KEY_FONT_SCALE) {
    return '消息字号';
  }
  if (key === KEY_CODE_WRAP) {
    return '代码自动换行';
  }
  if (key === KEY_SEND_KEY) {
    return '发送快捷键';
  }
  if (key === KEY_REASONING_DEFAULT) {
    return '思考默认展开';
  }
  if (key === KEY_APP_THEME) {
    return '应用主题';
  }
  if (key === KEY_SURFACE) {
    return '聊天界面';
  }
  if (key === KEY_MD_THEME) {
    return 'Markdown 主题';
  }
  if (key === KEY_ACCENT) {
    return '强调色';
  }
  if (key === KEY_LOCALE) {
    return '语言';
  }
  if (key === KEY_UI_MODE) {
    return '界面模式';
  }
  if (key === KEY_ORB) {
    return '思考光球动效';
  }
  return key;
}

/**
 * 取「思考光球动效」开关（消费点：`components/LiveTailView` 的 `@Prop orb`）。
 *
 * 默认 **true**：键缺失/垃圾值一律回落"开" —— 它是视觉增强，默认开启才与接线前的
 * 在飞指示等价；只有明确的假值（`0`/`false`/`off`/`no`）才关闭。
 */
export function orbEnabled(map: Record<string, string>): boolean {
  return parseBool(settingOf(map, KEY_ORB), true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 服务端「配置面」RPC —— **就地定义**（待后续波折叠进 `core/rpc.ets` 的 `RpcMethod` 表）
// ═══════════════════════════════════════════════════════════════════════════════
//
// 背景：`tools`（rpc_table.go:699-713）与 `agent`（:450-544）的参数化 RPC 已进
// `core/rpc.ets` 的常量表；但 `storage` / `webusers` 两个分区本波才落地，而
// `core/rpc.ets` 当前由别的线占用 ⇒ 这里**就地定义常量与 params 类**，组件直接消费。
// ⚠️ 后续波把下面 5 个 method 名并入 `RpcMethod.ALL` 时，**删掉这里的副本**并改 import，
//   否则会出现两份真值（`tools/tests/rpc.test.ts` 的"常量表完整性"断言能抓重复）。

/** `get_storage_config`（**admin**，无参）→ `Record<string,string>`（含 `_schema` / `_active`）。 */
export const RPC_GET_STORAGE_CONFIG: string = 'get_storage_config';
/** `set_storage_config`（**admin**）`{values}` → 同形状的 `Record<string,string>`。 */
export const RPC_SET_STORAGE_CONFIG: string = 'set_storage_config';
/** `list_web_users`（**admin**，无参）→ `{users: WebUserRow[]}`。 */
export const RPC_LIST_WEB_USERS: string = 'list_web_users';
/** `create_web_user`（**admin**）`{username}` → `{password}`（**一次性明文**）。 */
export const RPC_CREATE_WEB_USER: string = 'create_web_user';
/** `delete_web_user`（**admin**）`{username}` → void。 */
export const RPC_DELETE_WEB_USER: string = 'delete_web_user';
/** `get_system_info`（**admin**，无参）→ `SystemInfoRow`（版本/提交/构建时间/平台/托管方式）。 */
export const RPC_GET_SYSTEM_INFO: string = 'get_system_info';
/** `check_update`（**admin**，无参）→ `UpdateCheckRow`（**只读**：只查 GitHub Releases）。 */
export const RPC_CHECK_UPDATE: string = 'check_update';

/** 就地登记的全部 method（契约测试遍历用）。 */
export const CONFIG_SURFACE_METHODS: string[] = [
  RPC_GET_STORAGE_CONFIG,
  RPC_SET_STORAGE_CONFIG,
  RPC_LIST_WEB_USERS,
  RPC_CREATE_WEB_USER,
  RPC_DELETE_WEB_USER,
  RPC_GET_SYSTEM_INFO,
  RPC_CHECK_UPDATE,
];

/** `set_storage_config` 的 params（服务端 `rpc_table.go:1930-1933` `Values map[string]string`）。 */
export class SetStorageConfigParams {
  values: Record<string, string> = {};

  constructor(values: Record<string, string>) {
    this.values = values;
  }
}

/** `create_web_user` / `delete_web_user` 的 params（服务端 `rpc_table.go:1935-1951`）。 */
export class UsernameParams {
  username: string = '';

  constructor(username: string) {
    this.username = username;
  }
}

// ── storage 分区：schema 驱动表单的纯逻辑 ──────────────────────────────────────
//
// 契约（服务端 `serverapp/storage_config.go` + `channel/storage_defs.go`）：
//   · `get_storage_config`（admin，无参）→ `Record<string,string>`：
//       每个 schema 键一个当前值 + `_schema`（`[]SettingDefinition` 的 JSON 串）+
//       `_active`（**正在运行**的 provider，可能与 config.json 短暂不同）。
//   · `set_storage_config`（admin）`{values: Record<string,string>}` → 同形状（写后回读）。
//   · ⚠️ 密文键（`channel.StorageSecretKeys()` = qiniu/s3 的 secret/access key）**读取时打码**
//       （`maskStorageSecret` = 前 4 位 + `****`，`storage_config.go:33-46`）；
//       **回写掩码值会被跳过**（`isMaskedStorageValue` 查 `****`，`:48-51`）⇒ 真凭据不受损。

/** schema 字段（客户端镜像 `channel.SettingDefinition`，`channel/capability.go:16-32`）。 */
export interface StorageFieldOption {
  label?: string;
  value: string;
  description?: string;
}

export interface StorageFieldDef {
  key: string;
  label?: string;
  description?: string;
  /** `text` | `password` | `toggle` | `select` | `textarea`（`capability.go:37-44`）。 */
  type?: string;
  default_value?: string;
  category?: string;
  /** true ⇒ 只读展示（不可编辑）。 */
  read_only?: boolean;
  options?: StorageFieldOption[];
  /** 条件可见：仅当 `depends_on_key` 的当前值命中 `depends_on_values` 之一时显示。 */
  depends_on_key?: string;
  /** 逗号分隔的触发值（服务端原样给出，如 `"s3,aliyun,cos"`）。 */
  depends_on_values?: string;
}

export const STORAGE_TYPE_TEXT: string = 'text';
export const STORAGE_TYPE_PASSWORD: string = 'password';
export const STORAGE_TYPE_TOGGLE: string = 'toggle';
export const STORAGE_TYPE_SELECT: string = 'select';
export const STORAGE_TYPE_TEXTAREA: string = 'textarea';

/** schema 里以 `_` 开头的元键（`_schema` / `_active`）——**不是**用户字段。 */
export function isStorageMetaKey(key: string): boolean {
  return key.length > 0 && key.charAt(0) === '_';
}

/**
 * 解析 `_schema`（服务端 `json.Marshal(channel.StorageSchema())`）。
 * 容错：非 JSON / 非数组 / 元素缺 `key` ⇒ 一律返回空数组，**绝不抛**（面板显示"无可用字段"）。
 */
export function parseStorageSchema(raw: string | undefined): StorageFieldDef[] {
  const s: string = raw !== undefined && raw !== null ? raw : '';
  if (s.length === 0) {
    return [];
  }
  let parsed: Object;
  try {
    parsed = JSON.parse(s) as Object;
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const arr: Object[] = parsed as Object[];
  const out: StorageFieldDef[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item: StorageFieldDef = arr[i] as StorageFieldDef;
    if (item === undefined || item === null) {
      continue;
    }
    const k: string = item.key !== undefined && item.key !== null ? item.key : '';
    if (k.length === 0) {
      continue;
    }
    out.push(item);
  }
  return out;
}

/** 条件可见的触发值列表（逗号分隔 → trim → 去空）。空 = 无约束（总是可见）。 */
export function parseDependsOnValues(raw: string | undefined): string[] {
  const s: string = raw !== undefined && raw !== null ? raw : '';
  if (s.length === 0) {
    return [];
  }
  const parts: string[] = s.split(',');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const t: string = parts[i].trim();
    if (t.length > 0) {
      out.push(t);
    }
  }
  return out;
}

/**
 * 字段当前是否可见（对齐 web `SettingsStorage.tsx:88-98` 的 `isVisible`）。
 * `valueOf` 是"取某键当前输入值"的取值器（传函数而非 map，便于逐字段用 draft 覆盖 config）。
 */
export function storageFieldVisible(f: StorageFieldDef, valueOf: (key: string) => string): boolean {
  const depKey: string = f.depends_on_key !== undefined && f.depends_on_key !== null ? f.depends_on_key : '';
  if (depKey.length === 0) {
    return true;
  }
  const want: string[] = parseDependsOnValues(f.depends_on_values);
  if (want.length === 0) {
    return true;
  }
  return want.indexOf(valueOf(depKey)) >= 0;
}

/**
 * 可编辑字段（schema 顺序）：去元键、去只读、按当前值过滤条件可见（对齐 web `:82-85,118`）。
 */
export function editableStorageFields(defs: StorageFieldDef[], valueOf: (key: string) => string): StorageFieldDef[] {
  const out: StorageFieldDef[] = [];
  for (let i = 0; i < defs.length; i++) {
    const f: StorageFieldDef = defs[i];
    if (isStorageMetaKey(f.key)) {
      continue;
    }
    if (f.read_only === true) {
      continue;
    }
    if (!storageFieldVisible(f, valueOf)) {
      continue;
    }
    out.push(f);
  }
  return out;
}

/** 掩码密文判定（服务端 `isMaskedStorageValue`：含 `****`）。 */
export function isMaskedSecret(v: string | undefined): boolean {
  const s: string = v !== undefined && v !== null ? v : '';
  return s.indexOf('****') >= 0;
}

/** 掩码展示（空 ⇒ 空串；≤4 位 ⇒ `****`；否则前 4 位 + `****`）——与 `maskStorageSecret` 同规则。 */
export function maskSecretForDisplay(v: string | undefined): string {
  const s: string = v !== undefined && v !== null ? v : '';
  if (s.length === 0) {
    return '';
  }
  if (isMaskedSecret(s)) {
    return s;
  }
  if (s.length <= 4) {
    return '****';
  }
  return `${s.substring(0, 4)}****`;
}

/**
 * 脏检测（对齐 web `:99-102`）：任一可编辑字段的当前值 ≠ 已保存值。
 * `valueOf` 已含 draft 覆盖语义（由调用方实现为 `draft[k] ?? config[k] ?? ''`）。
 */
export function storageDirty(fields: StorageFieldDef[], valueOf: (key: string) => string,
  savedOf: (key: string) => string): boolean {
  for (let i = 0; i < fields.length; i++) {
    const f: StorageFieldDef = fields[i];
    if (valueOf(f.key) !== savedOf(f.key)) {
      return true;
    }
  }
  return false;
}

/**
 * 保存载荷（对齐 web `:130-134`）：**只含当前可见的可编辑字段**。
 *
 * ⚠️ 掩码密文**原样回传**是安全的（服务端跳过含 `****` 的值 ⇒ 真凭据不动）；
 * 但**不要**主动把掩码替换成空串 —— 那会被当成"用户清空了密钥"而写坏配置。
 */
export function buildStorageValues(fields: StorageFieldDef[], valueOf: (key: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    const k: string = fields[i].key;
    out[k] = valueOf(k);
  }
  return out;
}

/** 正在运行的 provider（`_active`；缺失/空 ⇒ `local`，与服务端默认一致）。 */
export function liveStorageProvider(config: Record<string, string> | undefined): string {
  if (config === undefined || config === null) {
    return 'local';
  }
  const v: string | undefined = config['_active'];
  return v !== undefined && v !== null && v.length > 0 ? v : 'local';
}

/**
 * 载入期的**防御性打码**：把所有 `password` 型字段的值过一遍 `maskSecretForDisplay`。
 *
 * 为什么在**载入期**做、而不是渲染期：
 *  - 服务端已经打码（`storage_config.go:80-87`），这里是纵深防御 —— 万一服务端漏打，
 *    真凭据也**绝不会被渲染出来**；
 *  - ⛔ **渲染期打码是错的**：用户开始输入新密钥时，草稿里是明文 ⇒ 渲染时再打码会把
 *    用户刚敲的字符直接替换成 `****`（第 5 个字符起就永远打不进去）。输入框只靠
 *    `InputType.Password` 做视觉遮显。
 *  - 载入期打码还有一个好处：用户不动该字段时，回传的就是掩码 ⇒ 服务端跳过写入 ⇒ 真凭据不变。
 */
export function maskPasswordFields(config: Record<string, string>, defs: StorageFieldDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(config);
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = config[keys[i]];
  }
  for (let i = 0; i < defs.length; i++) {
    const f: StorageFieldDef = defs[i];
    if (f.type !== STORAGE_TYPE_PASSWORD) {
      continue;
    }
    const cur: string | undefined = out[f.key];
    if (cur !== undefined && cur !== null && cur.length > 0 && !isMaskedSecret(cur)) {
      out[f.key] = maskSecretForDisplay(cur);
    }
  }
  return out;
}

/** provider 的显示名（从 schema 的 select options 里找；找不到回落原值）。 */
export function storageOptionLabel(defs: StorageFieldDef[], key: string, value: string): string {
  for (let i = 0; i < defs.length; i++) {
    const f: StorageFieldDef = defs[i];
    if (f.key !== key) {
      continue;
    }
    const opts: StorageFieldOption[] | undefined = f.options;
    if (opts === undefined) {
      continue;
    }
    for (let j = 0; j < opts.length; j++) {
      if (opts[j].value === value) {
        const l: string | undefined = opts[j].label;
        return l !== undefined && l.length > 0 ? l : value;
      }
    }
  }
  return value;
}

/**
 * toggle 字段的取值判定（服务端默认值也是字符串 `"false"`，`storage_defs.go:71`）。
 * 只有明确的 `true` 才算开（与 `parseBool` 不同：这里**不吃** `1/on/yes`，因为 schema 契约就是 `true|false`）。
 */
export function storageToggleOn(v: string | undefined): boolean {
  return v === 'true';
}

/** 保存后是否成功（对齐 web `setSaved(true)`）—— 判据是服务端回读了值。 */
export function storageSaveApplied(returned: Record<string, string> | undefined, key: string, want: string): boolean {
  if (returned === undefined || returned === null) {
    return false;
  }
  return returned[key] === want;
}

// ── webusers 分区：纯逻辑 ─────────────────────────────────────────────────────
//
// 契约（服务端 `serverapp/rpc_table.go:1935-1951`；结构 `channel/web/web_auth.go:116-122`）：
//   · `list_web_users`（**admin**，无参）→ `{users: [{id, username, created_at}]}`
//   · `create_web_user`（**admin**）`{username}` → `{password}` —— ⚠️ **一次性明文**
//   · `delete_web_user`（**admin**）`{username}` → void

/** web 账号行（`channel/web/web_auth.go:116-122` WebUserInfo）。 */
export interface WebUserRow {
  id?: number;
  username: string;
  created_at?: string;
}

/** `list_web_users` 的 data。 */
export interface WebUsersData {
  users?: WebUserRow[];
}

/** 用户名输入归一（去首尾空白；服务端按原样建号，故客户端必须先 trim）。 */
export function normalizeUsernameInput(raw: string | undefined): string {
  const s: string = raw !== undefined && raw !== null ? raw : '';
  return s.trim();
}

/** 用户名是否可提交（非空即可 —— 服务端没有额外字符约束，别自造规则）。 */
export function isValidUsername(raw: string | undefined): boolean {
  return normalizeUsernameInput(raw).length > 0;
}

/** 容错解包 `{users}`（缺字段/非数组 ⇒ 空数组，绝不抛）。 */
export function webUsersFrom(data: WebUsersData | undefined): WebUserRow[] {
  if (data === undefined || data === null || data.users === undefined || !Array.isArray(data.users)) {
    return [];
  }
  return data.users as WebUserRow[];
}

/** 一次性密码提示（**只在内存里拼**；绝不写偏好/日志）。 */
export function oneTimePasswordNotice(username: string, password: string): string {
  return `账号 ${username} 已创建：${password}`;
}

/**
 * 一次性明文密码（`create_web_user` 的返回）。
 *
 * ⛔ 只允许存在于内存（组件 `@State`）——**绝不**落偏好/日志/文件；
 *    组件销毁即随引用消失（web 同款契约：shown ONCE, never stored）。
 */
export class OneTimePw {
  username: string = '';
  password: string = '';

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }
}

// ── about 分区：纯逻辑（只读）──────────────────────────────────────────────────
//
// 契约（`serverapp/rpc_table.go:1963-1990`；结构 `internal/selfupdate`）：
//   · `get_system_info`（**admin**，无参 `rpc0err`）→ SystemInfo
//     web 侧镜像 `SettingsAbout.tsx:26-38`：
//     version / commit / buildTime / channel / goVersion / os / arch / exePath /
//     managedBy('systemd'|'launchd'|'supervisord'|'docker'|'none'|…) / devBuild
//   · `check_update`（**admin**，无参 `rpc0err`）→ UpdateCheck（**只读**，仅查 GitHub Releases）
//     web 侧镜像 `SettingsAbout.tsx:40-50`：
//     current / latest / tag / hasUpdate / channel / url / skipped / reason
//   ⚠️ 本波**不做** `apply_update` / `restart_server`：前者会原子替换服务端二进制，
//      后者会真的重启服务 —— 手机端误触代价高且本波无法真机验证（见回报⑤）。
//
// ⚠️ `check_update` 的契约里 **`skipped=true` 是正常返回**（dev 构建 / 网络离线 /
//    渠道不匹配都会这样），不是错误 ⇒ UI 必须把 `reason` 显示出来，不能只显示"无更新"。

/** `get_system_info` 的返回（`internal/selfupdate.SystemInfo`；字段可选以防版本差）。 */
export interface SystemInfoRow {
  version?: string;
  commit?: string;
  buildTime?: string;
  channel?: string;
  goVersion?: string;
  os?: string;
  arch?: string;
  exePath?: string;
  managedBy?: string;
  devBuild?: boolean;
}

/** `check_update` 的返回（`internal/selfupdate.UpdateCheck`）。 */
export interface UpdateCheckRow {
  current?: string;
  latest?: string;
  tag?: string;
  hasUpdate?: boolean;
  channel?: string;
  url?: string;
  /** true ⇒ 本次检查被跳过（dev 构建 / 离线 / 渠道不适用），看 `reason`。 */
  skipped?: boolean;
  reason?: string;
}

/** 一条「标签 + 值」元信息行。 */
export class MetaLine {
  label: string = '';
  value: string = '';

  constructor(label: string, value: string) {
    this.label = label;
    this.value = value;
  }
}

/** 空/空白 ⇒ 占位符 `—`（**默认值回落**：面板永远不显示空白行）。 */
export function textOrDash(v: string | undefined): string {
  const s: string = v !== undefined && v !== null ? v.trim() : '';
  return s.length > 0 ? s : '—';
}

/** 提交号短形态（前 12 位；空 ⇒ `—`）。 */
export function shortCommit(commit: string | undefined): string {
  const s: string = commit !== undefined && commit !== null ? commit.trim() : '';
  if (s.length === 0) {
    return '—';
  }
  return s.length > 12 ? s.substring(0, 12) : s;
}

/**
 * 构建时间可读化：ISO → `YYYY-MM-DD HH:MM`（**本地时区**）。
 * 解析失败**原样返回**（不吞信息），空 ⇒ `—`。
 */
export function formatBuildTime(raw: string | undefined): string {
  const s: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (s.length === 0) {
    return '—';
  }
  const d: Date = new Date(s);
  const ms: number = d.getTime();
  if (isNaN(ms)) {
    return s;
  }
  const p2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** `os/arch` 合并（缺一 ⇒ 只显示有的那个；都缺 ⇒ `—`）。 */
export function osArch(os: string | undefined, arch: string | undefined): string {
  const o: string = os !== undefined && os !== null ? os.trim() : '';
  const a: string = arch !== undefined && arch !== null ? arch.trim() : '';
  if (o.length === 0 && a.length === 0) {
    return '—';
  }
  if (o.length === 0) {
    return a;
  }
  if (a.length === 0) {
    return o;
  }
  return `${o}/${a}`;
}

/**
 * 托管方式 → 中文（**键映射**：服务端给的是 `managedBy` 枚举字面量，`SettingsAbout.tsx:35`）。
 * 未知值**原样透传**（未来服务端加新枚举时不至于显示空白）。
 */
export function managedByLabel(managedBy: string | undefined): string {
  const m: string = managedBy !== undefined && managedBy !== null ? managedBy.trim() : '';
  if (m.length === 0) {
    return '未知';
  }
  if (m === 'systemd') {
    return 'systemd 托管';
  }
  if (m === 'launchd') {
    return 'launchd 托管';
  }
  if (m === 'supervisord') {
    return 'supervisord 托管';
  }
  if (m === 'docker') {
    return 'Docker 容器';
  }
  if (m === 'none') {
    return '手动启动';
  }
  return m;
}

/** 系统信息 → 展示行（顺序 = 展示顺序；空字段走 `—` 回落，**不隐藏**）。 */
export function systemInfoLines(info: SystemInfoRow | undefined): MetaLine[] {
  if (info === undefined || info === null) {
    return [];
  }
  const out: MetaLine[] = [];
  out.push(new MetaLine('版本', textOrDash(info.version) + (info.devBuild === true ? '（开发构建）' : '')));
  out.push(new MetaLine('提交', shortCommit(info.commit)));
  out.push(new MetaLine('构建时间', formatBuildTime(info.buildTime)));
  out.push(new MetaLine('渠道', textOrDash(info.channel)));
  out.push(new MetaLine('运行时', textOrDash(info.goVersion)));
  out.push(new MetaLine('平台', osArch(info.os, info.arch)));
  out.push(new MetaLine('托管方式', managedByLabel(info.managedBy)));
  out.push(new MetaLine('程序路径', textOrDash(info.exePath)));
  return out;
}

/**
 * 更新检查 → 一句话状态（**取值域判定 + 默认值回落**）。
 *
 * 四种取值域，顺序即优先级：
 *   ① 未检查（`undefined`）② `skipped=true` ⇒ 说明**原因**（正常返回，不是错误）
 *   ③ `hasUpdate=true` ⇒ 报新版 ④ 其余 ⇒ 已是最新
 */
export function updateStatusText(chk: UpdateCheckRow | undefined): string {
  if (chk === undefined || chk === null) {
    return '尚未检查更新';
  }
  const cur: string = textOrDash(chk.current);
  if (chk.skipped === true) {
    const why: string = chk.reason !== undefined && chk.reason !== null && chk.reason.trim().length > 0
      ? chk.reason.trim() : '未说明原因';
    return `已跳过检查：${why}`;
  }
  if (chk.hasUpdate === true) {
    return `有新版本 ${textOrDash(chk.latest)}（当前 ${cur}）`;
  }
  return `已是最新（当前 ${cur}）`;
}

/** 账号显示名（**默认值回落**：页面未注入用户名时不显示空白）。 */
export function accountDisplayName(username: string | undefined): string {
  const s: string = username !== undefined && username !== null ? username.trim() : '';
  return s.length > 0 ? s : '当前登录账号';
}




