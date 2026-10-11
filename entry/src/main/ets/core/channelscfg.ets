/**
 * core/channelscfg.ets —— 设置 →「消息渠道」分区的**纯逻辑**（脱机可单测；零 ArkUI/@ohos 依赖）。
 *
 * 为什么单独成文件：原生此前**完全没有**渠道分区，本文件承载其全部可测判据
 * （取值 / 校验 / 脏判 / 敏感掩码 / 就绪判定 / 飞书绑定状态机），
 * `components/SettingsChannels.ets` 只做渲染、不自造判据。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * web 权威（`/Users/bobli/src/xbot/web`，逐条核对）：
 *   · 数据源 `get_channel_config`：`SettingsChannels.tsx:145-153`（load）
 *   · 线格式：每条渠道 `{ enabled, ...values, _schema:"<json []SettingDefinition>", _builtin:"true"|"false" }`
 *     —— 头注 `SettingsChannels.tsx:3-8`；服务端 `serverapp/channel_config.go:12-70`
 *   · `parseSchema`：`SettingsChannels.tsx:54-65`
 *   · `isMetaKey`：`SettingsChannels.tsx:67-69`
 *   · 渠道排序（内置优先 + 名称）：`SettingsChannels.tsx:207-215`
 *   · 脏判：`SettingsChannels.tsx:221-226`
 *   · 保存：`SettingsChannels.tsx:228-247`（`set_channel_config {channel, values}`）
 *   · 字段过滤（去 enabled 与元键）：`SettingsChannels.tsx:342`
 *   · 飞书引导：`feishu_app_guide`（`SettingsChannels.tsx:250-269`）
 *   · 飞书绑定：`feishu_bind_start` / `feishu_bind_status`（`SettingsChannels.tsx:271-301` + 轮询 `:160-205`）
 *   · 轮询间隔 `FEISHU_BIND_POLL_MS = 2500`：`SettingsChannels.tsx:48`
 *   · 链接过期（本地兜底）：`SettingsChannels.tsx:197-205`
 * 服务端契约（权威，**不改服务端**）：
 *   · `serverapp/rpc_table.go:1886-1893`（get/set_channel_config）
 *   · `serverapp/feishu_bind.go:157-186`（feishu_bind_start/status/app_guide）
 *   · `serverapp/channel_config.go`（写入合并语义：仅覆盖出现的键）
 *
 * ## 判据之一：⛔ 一切「状态」以后端回包为准（不在本地乐观改后假装成功）
 *   保存成功 ⇒ `components/SettingsChannels` 重新 `get_channel_config`（写后回读）；
 *   飞书绑定**只有** `feishu_bind_status` 回报 `done` 才算成（`applyBindStatus` 把服务端
 *   文案原样带出，不在本地造 `done`）。
 *
 * ## 判据之二：⛔ 敏感字段不得回填/覆盖
 *   服务端对渠道字段**只覆盖出现的键**（`channel_config.go:81+` 的 `if v, ok := values[...]`）
 *   ⇒ 敏感值（`type == "password"`）**不得**把展示用的掩码当成真值回写。
 *   本文件用 `maskSecret()` 做展示掩码、`isSecretField()` 定类型；组件对未编辑的敏感字段
 *   保留服务端原值（draft 初值 = 服务端真值，与 web 一致）。
 */
import { isPresent } from './guards';

// ── RPC method 常量 + 具名 params 类 ──────────────────────────────────────────
// ⚠️ 放本文件而**不动** `core/rpc.ets`：该文件有主（parity-gap 线）。
//    （与 `core/settings.ets` 的 storage method 常量现状一致。）

/** `get_channel_config`（`rpc0err`）→ `map[string]map[string]string`。`rpc_table.go:1886`。 */
export const RPC_GET_CHANNEL_CONFIG: string = 'get_channel_config';
/** `set_channel_config`（`rpc1`）`{channel, values}` → void。`rpc_table.go:1889`。 */
export const RPC_SET_CHANNEL_CONFIG: string = 'set_channel_config';
/** `feishu_bind_start`（`rpc1`）`{app_id}` → `{url, expires_in, app_id}`。`feishu_bind.go:157`。 */
export const RPC_FEISHU_BIND_START: string = 'feishu_bind_start';
/** `feishu_bind_status`（`rpc0`）→ `{state,app_id,url,error?,expires_in?}`。`feishu_bind.go:171`。 */
export const RPC_FEISHU_BIND_STATUS: string = 'feishu_bind_status';
/** `feishu_app_guide`（`rpc0`）→ `{scopes,events,callbacks,create_app_url,needs_public_url,link_lifetime}`。`feishu_bind.go:180`。 */
export const RPC_FEISHU_APP_GUIDE: string = 'feishu_app_guide';

/** `set_channel_config` 的 params（服务端 `rpc_table.go:1889-1892`）。 */
export class SetChannelConfigParams {
  channel: string = '';
  /** 只放**非元键**（不含 `_schema`/`_builtin`）；服务端按出现的键逐字段覆盖。 */
  values: Record<string, string> = {};

  constructor(channel: string, values: Record<string, string>) {
    this.channel = channel;
    this.values = values;
  }
}

/** `feishu_bind_start` 的 params（服务端 `feishu_bind.go:157-159`）。空串 ⇒ 新建应用。 */
export class FeishuBindStartParams {
  app_id: string = '';

  constructor(appId: string) {
    this.app_id = appId;
  }
}

// ── 常量（与 web / 服务端对齐）────────────────────────────────────────────────

/** 元键前缀（`_schema` / `_builtin` 等）——`SettingsChannels.tsx:67-69`。 */
export const CHANNEL_META_PREFIX: string = '_';
/** 启用开关的字段键（web `enabled`）。 */
export const CHANNEL_ENABLED_KEY: string = 'enabled';
/** 内置渠道标记值（服务端 `strconv.FormatBool(true)`）。 */
export const CHANNEL_BUILTIN_TRUE: string = 'true';
/** 飞书渠道名（引导/绑定仅对它出现）。 */
export const FEISHU_CHANNEL_NAME: string = 'feishu';
/** 绑定状态轮询间隔（ms）——`SettingsChannels.tsx:48`。 */
export const FEISHU_BIND_POLL_MS: number = 2500;
/** 链接有效期缺省（秒）——`SettingsChannels.tsx:203` 的 `expires_in ?? 600`。 */
export const FEISHU_BIND_DEFAULT_EXPIRES: number = 600;
/** 手动创建应用入口——`SettingsChannels.tsx:263`。 */
export const FEISHU_DEFAULT_CREATE_URL: string = 'https://open.feishu.cn/app';
/** 端口字段键（web 内置渠道唯一的数值口径）——`channel_defs.go:24`。 */
export const PORT_FIELD_KEY: string = 'port';

/** 绑定状态字面量（服务端 `feishu_bind.go:36-41`）。 */
export const BIND_STATE_IDLE: string = 'idle';
export const BIND_STATE_WAITING: string = 'waiting';
export const BIND_STATE_DONE: string = 'done';
export const BIND_STATE_ERROR: string = 'error';

// ── 线格式（服务端 JSON 形状；读字段一律 `isPresent`/`typeof` 收窄）─────────────

/** `_schema` 解码后单个字段（`SettingDefinition` 的客户端视图）。`channel/capability.go:16-27`。 */
interface ChannelFieldWire {
  key?: string;
  label?: string;
  description?: string;
  type?: string;
  default_value?: string;
}

/** `feishu_app_guide` 回包（`feishu_bind.go:180-195`）。 */
interface FeishuGuideWire {
  scopes?: string[];
  events?: string[];
  callbacks?: string[];
  create_app_url?: string;
  needs_public_url?: boolean;
}

/** `feishu_bind_status` 回包（`feishu_bind.go:130-152`）。 */
interface FeishuBindStatusWire {
  state?: string;
  url?: string;
  app_id?: string;
  error?: string;
  expires_in?: number;
}

// ── 视图模型（ArkTS 禁结构化类型 ⇒ 用具名类）────────────────────────────────

/** 一个渠道字段（`_schema` 元素）。 */
export class ChannelField {
  key: string = '';
  label: string = '';
  description: string = '';
  /** `text` / `number` / `password` / …（`capability.go:38-45`）。 */
  type: string = '';
  defaultValue: string = '';
}

/** 飞书引导（要创建的应用长什么样）。 */
export class FeishuGuide {
  scopes: string[] = [];
  events: string[] = [];
  callbacks: string[] = [];
  createAppUrl: string = FEISHU_DEFAULT_CREATE_URL;
  needsPublicUrl: boolean = false;
}

/** 飞书绑定的一次尝试的客户端视图（`feishu_bind_status` 的镜像）。 */
export class FeishuBind {
  /** `idle`/`waiting`/`done`/`error`。 */
  state: string = BIND_STATE_IDLE;
  url: string = '';
  appId: string = '';
  error: string = '';
  /** 仅 `waiting` 时服务端下发（秒）。 */
  expiresIn: number = 0;
}

/** `feishu_bind_status` 一次轮询的结果：要么拿到新状态，要么判定「链接已失效」。 */
export class BindPollResult {
  bind: FeishuBind | null = null;
  /** 服务端 `state == idle` ⇒ 本次尝试已死（重启/被顶替）⇒ 面板重置并提示重新生成。 */
  stale: boolean = false;
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

function strListOf(raw: string[] | null | undefined): string[] {
  const out: string[] = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  for (let i = 0; i < raw.length; i++) {
    const x: string = raw[i];
    if (typeof x === 'string' && x.length > 0) {
      out.push(x);
    }
  }
  return out;
}

/** 值存在且非空串。 */
function nonEmpty(v: string | null | undefined): boolean {
  return isPresent(v) && v.length > 0;
}

// ── 线格式 → 视图模型 ─────────────────────────────────────────────────────────

/**
 * `_schema`（JSON 字符串）→ 字段描述数组。**全容错**：
 * 空/非数组/坏 JSON ⇒ `[]`；元素非对象或缺 `key` ⇒ 跳过（`SettingsChannels.tsx:55-65`）。
 */
export function parseSchema(raw: string | null | undefined): ChannelField[] {
  const out: ChannelField[] = [];
  if (!nonEmpty(raw)) {
    return out;
  }
  let parsed: Object;
  try {
    parsed = JSON.parse(raw as string) as Object;
  } catch (e) {
    return out;
  }
  if (!Array.isArray(parsed)) {
    return out;
  }
  const arr: Object[] = parsed as Object[];
  for (let i = 0; i < arr.length; i++) {
    const el: Object = arr[i];
    if (!isPresent(el)) {
      continue;
    }
    const w: ChannelFieldWire = el as ChannelFieldWire;
    if (typeof w.key !== 'string') {
      continue;
    }
    const f: ChannelField = new ChannelField();
    f.key = w.key;
    f.label = isPresent(w.label) ? w.label : '';
    f.description = isPresent(w.description) ? w.description : '';
    f.type = isPresent(w.type) ? w.type : '';
    f.defaultValue = isPresent(w.default_value) ? w.default_value : '';
    out.push(f);
  }
  return out;
}

/** 键是否**传输用元键**（`_` 前缀）——不得进入表单。`SettingsChannels.tsx:67-69`。 */
export function isMetaKey(key: string): boolean {
  return key.length > 0 && key.indexOf(CHANNEL_META_PREFIX) === 0;
}

/** 渠道条目是否**内置**（服务端 `_builtin == "true"`）。`SettingsChannels.tsx:340`。 */
export function isBuiltin(entry: Record<string, string> | null | undefined): boolean {
  if (!isPresent(entry)) {
    return false;
  }
  return entry[CHANNEL_BUILTIN_TRUE_FIELD] === CHANNEL_BUILTIN_TRUE;
}

/** `_builtin` 键名（单独抽常量，避免字面量散落）。 */
const CHANNEL_BUILTIN_TRUE_FIELD: string = '_builtin';
/** `_schema` 键名。 */
const CHANNEL_SCHEMA_FIELD: string = '_schema';

/** 取某渠道的 `_schema` 原始串（无则空）。 */
export function schemaRawOf(entry: Record<string, string> | null | undefined): string {
  if (!isPresent(entry)) {
    return '';
  }
  const v: string | undefined = entry[CHANNEL_SCHEMA_FIELD];
  return isPresent(v) ? v : '';
}

/**
 * 渠道名排序：**内置优先**，其次按名称（`SettingsChannels.tsx:207-215` 逐字）。
 * 缺条目/缺 `_builtin` 视为**插件渠道**。
 */
export function channelNames(channels: Record<string, Record<string, string>>): string[] {
  const names: string[] = Object.keys(channels);
  names.sort((a: string, b: string): number => {
    const ab: boolean = isBuiltin(channels[a]);
    const bb: boolean = isBuiltin(channels[b]);
    if (ab !== bb) {
      return ab ? -1 : 1;
    }
    return a.localeCompare(b);
  });
  return names;
}

/**
 * `get_channel_config` 回包 → 规范化渠道表（`SettingsChannels.tsx:145-153` 的 `data ?? {}`）。
 * 非字符串值一律归一为 `''`（web 把它当选文本渲染）。
 */
export function parseChannels(raw: Object | null | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!isPresent(raw)) {
    return out;
  }
  const obj: Record<string, Object> = raw as Record<string, Object>;
  const names: string[] = Object.keys(obj);
  for (let i = 0; i < names.length; i++) {
    const n: string = names[i];
    const src: Record<string, Object> | undefined = obj[n] as Record<string, Object> | undefined;
    const vals: Record<string, string> = {};
    if (isPresent(src)) {
      const ks: string[] = Object.keys(src);
      for (let j = 0; j < ks.length; j++) {
        const v: Object | undefined = src[ks[j]];
        vals[ks[j]] = typeof v === 'string' ? (v as string) : '';
      }
    }
    out[n] = vals;
  }
  return out;
}

/** 深拷贝一层渠道表（草稿与真值解耦 —— `@State` 赋新对象才会触发重建）。 */
export function cloneChannelMap(
  channels: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const names: string[] = Object.keys(channels);
  for (let i = 0; i < names.length; i++) {
    const src: Record<string, string> = channels[names[i]];
    const cp: Record<string, string> = {};
    const ks: string[] = Object.keys(src);
    for (let j = 0; j < ks.length; j++) {
      cp[ks[j]] = src[ks[j]];
    }
    out[names[i]] = cp;
  }
  return out;
}

// ── 取值 / 字段过滤 ───────────────────────────────────────────────────────────

/** 草稿里某字段的值（缺 ⇒ 空串）。`SettingsChannels.tsx:354` 的 `draft[f.key] ?? ''`。 */
export function fieldValue(draft: Record<string, string> | null | undefined, key: string): string {
  if (!isPresent(draft)) {
    return '';
  }
  const v: string | undefined = draft[key];
  return isPresent(v) ? v : '';
}

/** 启用开关：`draft.enabled === 'true'`。`SettingsChannels.tsx:341`。 */
export function isEnabled(draft: Record<string, string> | null | undefined): boolean {
  return fieldValue(draft, CHANNEL_ENABLED_KEY) === CHANNEL_BUILTIN_TRUE;
}

/**
 * 需要在表单里渲染的字段：排除 `enabled`（单独开关）与元键。`SettingsChannels.tsx:342`。
 * 顺序**原样保留**（服务端 schema 顺序 = 设计顺序）。
 */
export function visibleFields(schema: ChannelField[]): ChannelField[] {
  const out: ChannelField[] = [];
  for (let i = 0; i < schema.length; i++) {
    const f: ChannelField = schema[i];
    if (f.key === CHANNEL_ENABLED_KEY) {
      continue;
    }
    if (isMetaKey(f.key)) {
      continue;
    }
    out.push(f);
  }
  return out;
}

// ── 脏判 / 保存形状 ───────────────────────────────────────────────────────────

/**
 * 是否**有未保存修改**：只看草稿里存在的、**非元键**且与服务端原值不同的键
 * （`SettingsChannels.tsx:221-226` 逐字）。
 */
export function isDirty(
  original: Record<string, string> | null | undefined,
  draft: Record<string, string> | null | undefined,
): boolean {
  if (!isPresent(original) || !isPresent(draft)) {
    return false;
  }
  const ks: string[] = Object.keys(draft);
  for (let i = 0; i < ks.length; i++) {
    const k: string = ks[i];
    if (!isMetaKey(k) && draft[k] !== original[k]) {
      return true;
    }
  }
  return false;
}

/**
 * 提交形状：只保留**非元键**（`SettingsChannels.tsx:231-236` 的 `values` 构造）。
 * `_schema`/`_builtin` 绝不可回传给服务端。
 */
export function buildSaveValues(draft: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPresent(draft)) {
    return out;
  }
  const ks: string[] = Object.keys(draft);
  for (let i = 0; i < ks.length; i++) {
    const k: string = ks[i];
    if (!isMetaKey(k)) {
      out[k] = draft[k];
    }
  }
  return out;
}

/** 不可变更新：给某渠道的某字段赋新值，返回**新表**（`SettingsChannels.tsx:217-219` 语义）。 */
export function withField(
  channels: Record<string, Record<string, string>>, channel: string, key: string, value: string,
): Record<string, Record<string, string>> {
  const next: Record<string, Record<string, string>> = cloneChannelMap(channels);
  const cur: Record<string, string> | undefined = next[channel];
  const entry: Record<string, string> = isPresent(cur) ? cur : {};
  entry[key] = value;
  next[channel] = entry;
  return next;
}

/** 启用开关 → 字符串值（web `v ? 'true' : 'false'`）。`SettingsChannels.tsx:349`。 */
export function enabledValue(on: boolean): string {
  return on ? CHANNEL_BUILTIN_TRUE : 'false';
}

// ── 敏感掩码 ─────────────────────────────────────────────────────────────────
// 服务端把 `app_secret`/`encrypt_key` 声明为 `type: "password"`（`channel_defs.go:29-30`）。
// 原生不依赖输入框的视觉掩码，而是**显式**给出"显示真值 / 隐藏"两种展示口径的可测函数。

/** 是否敏感字段（`type == "password"`）。 */
export function isSecretField(field: ChannelField): boolean {
  return field.type === 'password';
}

/**
 * 敏感值 → 展示掩码。空 ⇒ 空串；非空 ⇒ 定长圆点（**不泄露任何原字符**）。
 *
 * ⛔ 掩码**仅供展示**：组件在"隐藏"态渲染它，在"编辑"态渲染真值；
 * 保存时提交的是 draft 真值（未编辑的敏感字段 = 服务端原值），**不是**掩码。
 */
export function maskSecret(value: string | null | undefined): string {
  if (!nonEmpty(value)) {
    return '';
  }
  return '••••••••';
}

// ── 校验 / 就绪判定 ───────────────────────────────────────────────────────────

function isAllDigits(s: string): boolean {
  if (s.length === 0) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}

/**
 * 端口校验。**为什么拦**：服务端 `set_channel_config` 对 `port` 走
 * `strconv.Atoi`（`channel_config.go:104` 附近）——非法串**静默变 0**（原始数据丢失，
 * 与 `core/settings.ets` 的"越界数字不得写默认值"同源）。空串 ⇒ 合法（表示"不改该键"）。
 */
export function validatePort(value: string): string {
  if (value.length === 0) {
    return '';
  }
  if (!isAllDigits(value)) {
    return '端口必须是数字';
  }
  const n: number = Number(value);
  if (n < 1 || n > 65535) {
    return '端口需在 1–65535 之间';
  }
  return '';
}

/**
 * 阻断保存的**校验**（返回非空 = 不让提交）。当前只覆盖"会被服务端静默改写"的字段
 * （端口）。其余字段与 web 一致：交给服务端裁决，不本地造假。
 */
export function validateChannelDraft(
  channel: string, draft: Record<string, string> | null | undefined, schema: ChannelField[],
): string {
  if (!isPresent(draft)) {
    return '';
  }
  for (let i = 0; i < schema.length; i++) {
    const f: ChannelField = schema[i];
    if (f.key === PORT_FIELD_KEY) {
      const why: string = validatePort(fieldValue(draft, f.key));
      if (why.length > 0) {
        return `${f.label.length > 0 ? f.label : f.key}：${why}`;
      }
    }
  }
  return '';
}

/**
 * **建议性**提示（不阻断保存）：启用飞书渠道却缺凭据时提醒。
 * 与 web 的差异点：web 不提示，直接让服务端启停失败；原生提前告知（诚实、不阻断）。
 */
export function readinessHints(
  channel: string, draft: Record<string, string> | null | undefined,
): string[] {
  const out: string[] = [];
  if (channel !== FEISHU_CHANNEL_NAME || !isPresent(draft)) {
    return out;
  }
  if (!isEnabled(draft)) {
    return out;
  }
  if (fieldValue(draft, 'app_id').length === 0) {
    out.push('已启用飞书渠道，但 App ID 为空 —— 渠道将无法登录');
  }
  if (fieldValue(draft, 'app_secret').length === 0) {
    out.push('已启用飞书渠道，但 App Secret 为空 —— 渠道将无法登录');
  }
  return out;
}

/** 保存按钮是否可用：有改动 **且** 不忙 **且** 无阻断校验错误。`SettingsChannels.tsx:490`。 */
export function canSave(dirty: boolean, busy: boolean, validationError: string): boolean {
  return dirty && !busy && validationError.length === 0;
}

/** 保存按钮文案。`SettingsChannels.tsx:492`（`saving` / `save`）。 */
export function saveButtonLabel(busy: boolean): string {
  return busy ? '保存中…' : '保存';
}

// ── 渠道标题 / 类型文案 ───────────────────────────────────────────────────────

/** 内置/插件标签（web i18n `settings.channels.builtin` / `plugin`）。 */
export function channelTypeLabel(builtin: boolean): string {
  return builtin ? '内置' : '插件渠道';
}

/** 分区标题：`<name> · <类型>`。`SettingsChannels.tsx:346`。 */
export function channelTitle(name: string, builtin: boolean): string {
  return `${name} · ${channelTypeLabel(builtin)}`;
}

/** 分区说明：内置 = 无（undefined），插件 = 提示。`SettingsChannels.tsx:347`。 */
export function channelDescription(builtin: boolean): string {
  return builtin ? '' : '由插件注册的渠道，字段来自该插件的配置声明。';
}

// ── 飞书引导（feishu_app_guide）──────────────────────────────────────────────

/**
 * `feishu_app_guide` 回包 → 引导（形状不完整 ⇒ `null`）。
 * web 权威：`SettingsChannels.tsx:250-269`（`scopes/events/callbacks` 必须都是数组，
 * 否则宁可不渲染 —— 旧服务端/测试 mock 不能崩面板）。
 */
export function parseGuide(raw: Object | null | undefined): FeishuGuide | null {
  if (!isPresent(raw)) {
    return null;
  }
  const w: FeishuGuideWire = raw as FeishuGuideWire;
  if (!Array.isArray(w.scopes) || !Array.isArray(w.events) || !Array.isArray(w.callbacks)) {
    return null;
  }
  const g: FeishuGuide = new FeishuGuide();
  g.scopes = strListOf(w.scopes);
  g.events = strListOf(w.events);
  g.callbacks = strListOf(w.callbacks);
  g.createAppUrl = nonEmpty(w.create_app_url) ? (w.create_app_url as string) : FEISHU_DEFAULT_CREATE_URL;
  g.needsPublicUrl = w.needs_public_url === true;
  return g;
}

/** 预设摘要文案（web i18n `feishuGuidePreset`）。`SettingsChannels.tsx:409-413`。 */
export function presetSummary(g: FeishuGuide): string {
  return `自动配置的内容：${g.scopes.length} 项权限 · ${g.events.length} 个事件 · ${g.callbacks.length} 个回调`;
}

/** 无需公网回调的说明（web `feishuGuideNoPublicUrl` / `feishuGuideNeedsPublicUrl`）。 */
export function publicUrlNotice(g: FeishuGuide): string {
  return g.needsPublicUrl
    ? '需要可公网访问的回调地址'
    : '无需公网回调地址：事件走长连接（WebSocket）';
}

// ── 飞书绑定状态机 ───────────────────────────────────────────────────────────

/** `feishu_bind_status` 回包 → 绑定视图（全容错；state 缺省 = `idle`）。 */
export function parseBindStatus(raw: Object | null | undefined): FeishuBind | null {
  if (!isPresent(raw)) {
    return null;
  }
  const w: FeishuBindStatusWire = raw as FeishuBindStatusWire;
  const b: FeishuBind = new FeishuBind();
  b.state = nonEmpty(w.state) ? (w.state as string) : BIND_STATE_IDLE;
  b.url = isPresent(w.url) ? w.url : '';
  b.appId = isPresent(w.app_id) ? w.app_id : '';
  b.error = isPresent(w.error) ? w.error : '';
  b.expiresIn = typeof w.expires_in === 'number' ? w.expires_in : 0;
  return b;
}

/**
 * 一次 `feishu_bind_status` 轮询 → 面板动作。web 权威 `SettingsChannels.tsx:172-183`：
 * `state == idle` ⇒ 服务端已不持有该尝试（重启/被顶替）⇒ 重置并提示链接失效；
 * 否则原样采用服务端状态。
 */
export function applyBindStatus(raw: Object | null | undefined): BindPollResult {
  const r: BindPollResult = new BindPollResult();
  const b: FeishuBind | null = parseBindStatus(raw);
  if (!isPresent(b) || b.state === BIND_STATE_IDLE) {
    r.bind = null;
    r.stale = true;
    return r;
  }
  r.bind = b;
  r.stale = false;
  return r;
}

/** `feishu_bind_start` 回包 → 进入 `waiting` 的绑定视图。`SettingsChannels.tsx:287-290`。 */
export function bindFromStartResult(raw: Object | null | undefined): FeishuBind {
  const b: FeishuBind = new FeishuBind();
  b.state = BIND_STATE_WAITING;
  if (isPresent(raw)) {
    const w: FeishuBindStatusWire = raw as FeishuBindStatusWire;
    b.url = isPresent(w.url) ? w.url : '';
    b.appId = isPresent(w.app_id) ? w.app_id : '';
    b.expiresIn = typeof w.expires_in === 'number' ? w.expires_in : 0;
  }
  return b;
}

/** 链接有效期（秒）：服务端未给则 600。`SettingsChannels.tsx:203`。 */
export function expirySeconds(bind: FeishuBind | null): number {
  if (!isPresent(bind) || bind.expiresIn <= 0) {
    return FEISHU_BIND_DEFAULT_EXPIRES;
  }
  return bind.expiresIn;
}

/** 是否应继续轮询：`waiting` 且未过期。`SettingsChannels.tsx:160-166`。 */
export function shouldPoll(bind: FeishuBind | null, expired: boolean): boolean {
  return isPresent(bind) && bind.state === BIND_STATE_WAITING && !expired;
}

/** 是否显示「打开链接」（waiting + 有 url + 未过期）。`SettingsChannels.tsx:465`。 */
export function showOpenLink(bind: FeishuBind | null, expired: boolean): boolean {
  return isPresent(bind) && bind.state === BIND_STATE_WAITING && bind.url.length > 0 && !expired;
}

/** 是否显示「等待确认」提示。`SettingsChannels.tsx:494`。 */
export function showWaitingHint(bind: FeishuBind | null, expired: boolean): boolean {
  return isPresent(bind) && bind.state === BIND_STATE_WAITING && !expired;
}

/** 是否显示「已绑定」徽标。`SettingsChannels.tsx:475`。 */
export function showBound(bind: FeishuBind | null): boolean {
  return isPresent(bind) && bind.state === BIND_STATE_DONE;
}

/** 绑定的错误文案（仅 `error` 态）。`SettingsChannels.tsx:478`。 */
export function bindErrorText(bind: FeishuBind | null): string {
  if (!isPresent(bind) || bind.state !== BIND_STATE_ERROR) {
    return '';
  }
  return bind.error;
}

/** 绑定按钮文案：in-flight / 重新生成 / 首次绑定。`SettingsChannels.tsx:458-462`。 */
export function bindButtonLabel(binding: boolean, bind: FeishuBind | null): string {
  if (binding) {
    return '正在获取链接…';
  }
  if (isPresent(bind) && bind.state === BIND_STATE_WAITING) {
    return '重新生成链接';
  }
  return '一键绑定飞书智能体应用';
}

/**
 * 触发绑定前是否需要**二次确认**（原生增强，web 无）：
 * 已有 `waiting` 尝试时，服务端 `Start` 会 `cancel()` 掉旧尝试（`feishu_bind.go:63-67`）
 * ⇒ 旧链接立即作废（危险操作）⇒ 先确认再顶替。
 */
export function bindConfirmNeeded(bind: FeishuBind | null): boolean {
  return isPresent(bind) && bind.state === BIND_STATE_WAITING;
}

/** 二次确认文案（配合 `bindConfirmNeeded`）。 */
export function bindConfirmText(): string {
  return '已有等待确认的绑定链接，重新生成会让旧链接立即失效。确认重新生成？';
}

/** 复制链接 / 打开链接的提示（web `copyLink` / `feishuOpenLink`）。 */
export const CHANNEL_COPY_LINK: string = '复制链接';
export const CHANNEL_OPEN_LINK: string = '打开链接';
export const CHANNEL_LINK_EXPIRY_TEMPLATE: string = '链接 {seconds} 秒内有效，仅可使用一次';

/** 过期提示（web `feishuLinkExpired`）。 */
export const CHANNEL_LINK_EXPIRED: string = '链接已过期，请重新生成';
/** 链接失效提示（web `feishuLinkStale`）。 */
export const CHANNEL_LINK_STALE: string = '授权链接已失效（服务已重启或已被新的绑定顶替），请重新生成';
/** 打开失败兜底提示（原生：外部打开可能被系统拒绝）。 */
export const CHANNEL_OPEN_FAILED: string = '无法直接打开链接，请点「复制链接」后在飞书中手动打开';

/** 有效期文案（web i18n `linkExpiry` 的 `{{seconds}}` 替换）。 */
export function linkExpiryText(seconds: number): string {
  return CHANNEL_LINK_EXPIRY_TEMPLATE.replace('{seconds}', `${seconds}`);
}

// ── ForEach key（含内容指纹，避免 ArkUI 复用陈旧节点）───────────────────────────

/** 渠道行的稳定身份 + 类型（key 必须稳定；类型变化 ⇒ 换节点）。 */
export function channelRowKey(name: string, builtin: boolean): string {
  return `${name}|${builtin ? 'b' : 'p'}`;
}

/** 字段行的 key：含**值指纹**（值变 ⇒ 重建该输入行，见 docs/ARKTS-GOTCHAS.md）。 */
export function fieldRowKey(name: string, key: string, value: string): string {
  return `${name}#${key}#${value}`;
}
