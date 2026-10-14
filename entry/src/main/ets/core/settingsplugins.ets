/**
 * settingsplugins.ets —— 「插件设置」分区与**设置分区门控**的**纯逻辑**（可脱机单测）。
 *
 * ## 权威基准（web）
 *  · 读写配置值：`web/src/components/settings/SettingsPlugins.tsx`
 *      - 读：`:74-75` `plugin_config`；写：`:510-513` `plugin_config_set {id,key,value}`；
 *      - 热更新：`:103-118` 监听 SSE `web_plugin_config_changed` 做**轻量合并**。
 *  · 启停：`web/src/plugins/manager/PluginManagerPanel.tsx:101` `plugin_set_enabled {id,enabled}`。
 *  · 字段类型：`plugin/plugin.go:268-310`（`ConfigProperty`/`ConfigOption`）——
 *      `type` ∈ `string|number|boolean|select|multiselect`；前端另有 `image`。
 *
 * ## 服务端契约（逐条核对 `serverapp/rpc_table.go`）
 *  · `plugin_config {id}` → `{plugins:[{id,name,title,runtime,enabled,properties,values}]}`
 *      （`:2370-2453`；`properties` 是 `map[string]propJSON`，`values` 是 `map[string]any` =
 *      **默认值已合并用户配置**）。
 *  · `plugin_config_set {id,key,value}` → void（`:2458-2515`）：
 *      ⛔ 服务端**按 schema 校验** —— 未知 key 报错；`boolean`/`number` **强校验类型**
 *      （发字符串 `"true"` 会被判 `expected boolean`）⇒ 必须发真 JSON 标量。
 *  · `plugin_set_enabled {id,enabled}` → `{status:"ok"}`（`:2213-2233`）。
 *
 * ## 为什么单独成模块
 * 本仓铁律：**判据与渲染必须同源**、每个纯逻辑模块都有**判别力测试**。而离线 harness
 * （`tools/tests/run.sh`）只把 `core/**` 拷进临时目录编译 ⇒ 组件层无法被单测 import。
 * 故「该不该显示这个分区」「这个值合不合法」「secret 怎么显示」全部收敛到这里，
 * 组件只消费结论；`components/SettingsPanel.ets` 与 `components/SettingsPlugins.ets` 不再自造判据。
 *
 * ⚠️ 本文件属 `core/` ⇒ 被 `run.sh` 当**纯 TS** 编译：**禁止** import ArkUI / `@ohos.*`；
 *    禁无类型对象字面量（一律用 `class`）；无 `any`/`unknown`（用联合类型 + `typeof` 收窄）。
 */
import { arrOrEmpty, isPresent } from './guards';
import { resolvePluginText } from './pluginhost';
import { AMBIENCE_UNSET, AmbienceValues } from './theme';

// ══════════════════════════════════════════════════════════════════════════════
// ① 字段类型
// ══════════════════════════════════════════════════════════════════════════════

export const PLUGIN_FIELD_BOOLEAN: string = 'boolean';
export const PLUGIN_FIELD_STRING: string = 'string';
export const PLUGIN_FIELD_NUMBER: string = 'number';
export const PLUGIN_FIELD_SELECT: string = 'select';
export const PLUGIN_FIELD_MULTISELECT: string = 'multiselect';
export const PLUGIN_FIELD_IMAGE: string = 'image';
/** 服务端声明了但我们不认识（协议新增）—— **显式成档**，不静默当成 string。 */
export const PLUGIN_FIELD_UNKNOWN: string = 'unknown';

/**
 * 服务端 `type` → 归一化 kind。空值/未知值 ⇒ `unknown`（**不猜**）。
 *
 * web 侧没有这一步（它直接 `switch(prop.type)` 并在 `default` 里落到文本控件）——
 * 原生把"未知"显式成档，是为了**不把未来新增的类型当成字符串默默写坏**。
 */
export function normalizeFieldType(t: string | null | undefined): string {
  const s: string = isPresent(t) ? t.trim().toLowerCase() : '';
  if (s === PLUGIN_FIELD_BOOLEAN) { return PLUGIN_FIELD_BOOLEAN; }
  if (s === PLUGIN_FIELD_STRING) { return PLUGIN_FIELD_STRING; }
  if (s === PLUGIN_FIELD_NUMBER) { return PLUGIN_FIELD_NUMBER; }
  if (s === PLUGIN_FIELD_SELECT) { return PLUGIN_FIELD_SELECT; }
  if (s === PLUGIN_FIELD_MULTISELECT) { return PLUGIN_FIELD_MULTISELECT; }
  if (s === PLUGIN_FIELD_IMAGE) { return PLUGIN_FIELD_IMAGE; }
  return PLUGIN_FIELD_UNKNOWN;
}

/**
 * 该类型本期原生端**可编辑**吗？
 *
 * ⛔ `image` 需要**文件选择 + 上传**（web `SettingsPlugins.tsx:221-355` 的
 *    `ImageSelectControl`，走 `/api/files/upload`）——本期不实现 ⇒ 返回 `false`，
 *    由 UI **明确禁用并说明**（绝不渲染一个点了没反应/假装成功的控件）。
 * ⛔ `unknown` 同理（连语义都不知道，不能编辑）。
 */
export function isFieldEditable(kind: string): boolean {
  // ⚠️ 2026-10-11 裁决：`unknown` **改为可编辑**（对齐 web —— web 的 `default` 分支
  //    `SettingsPlugins.tsx:636-646` 对未知类型就是**可编辑文本框**）。本仓是 web 权威的移植，
  //    "不猜"的价值改由**保守写入**实现：读原值原样显示、写前 `validateValue` 不过就不发、
  //    服务端拒收则只报错**不覆盖**（`writeValue` 的既有行为）。⛔ image 仍不在此列（有专门上传值区）。
  return kind === PLUGIN_FIELD_BOOLEAN || kind === PLUGIN_FIELD_STRING
    || kind === PLUGIN_FIELD_NUMBER || kind === PLUGIN_FIELD_SELECT
    || kind === PLUGIN_FIELD_MULTISELECT || kind === PLUGIN_FIELD_UNKNOWN;
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 数据模型（消费 `plugin_config` 的响应）
// ══════════════════════════════════════════════════════════════════════════════

/** 一个字段的当前值（ArkTS 无 `any` ⇒ 显式四槽；由 `kind` 决定哪个槽有效）。 */
export class ConfigValue {
  b: boolean = false;
  n: number = 0;
  s: string = '';
  list: string[] = [];
}

/** `select`/`multiselect` 的一个可选项（`plugin.ConfigOption`）。 */
export class PluginConfigOption {
  label: string = '';
  value: string = '';

  constructor(label: string, value: string) {
    this.label = label;
    this.value = value;
  }
}

/** 一个配置字段的 schema（`plugin.ConfigProperty` + 原生派生字段）。 */
export class PluginConfigProperty {
  /** 配置键（写回时的 `key`）。 */
  key: string = '';
  /** 归一化类型（见 `normalizeFieldType`）。 */
  kind: string = PLUGIN_FIELD_UNKNOWN;
  label: string = '';
  description: string = '';
  /** 分组标题（web 按它分组；空 = 归入插件标题下）。 */
  section: string = '';
  secret: boolean = false;
  placeholder: string = '';
  required: boolean = false;
  hasMin: boolean = false;
  min: number = 0;
  hasMax: boolean = false;
  max: number = 0;
  options: PluginConfigOption[] = [];
  /** 默认值（服务端 `values` 已合并，这只是兜底/展示用）。 */
  def: ConfigValue = new ConfigValue();
  /** 本期可编辑（见 `isFieldEditable`）。 */
  editable: boolean = false;
}

/** 一个插件的配置区块。 */
export class PluginConfigEntry {
  id: string = '';
  name: string = '';
  title: string = '';
  runtime: string = '';
  /** 插件当前是否启用（`web_plugin_list` / `plugin_config` 的 `enabled`）。 */
  isOn: boolean = false;
  properties: PluginConfigProperty[] = [];
  values: Record<string, ConfigValue> = {};
}

/** `plugin_config` 的整体视图。 */
export class PluginConfigCatalog {
  entries: PluginConfigEntry[] = [];
}

// ── 外来 JSON 的线格式（本仓惯例：interface + 可选字段 + 三态守卫）──────────────
//
// ⚠️ `default` / `values` 的值**类型随 schema 而变** ⇒ 用**联合类型**（而非 `Object`），
//    这样 `typeof x === 'number'` 能直接**收窄**、无需 `as number` 这类强转
//    （`Object`→`number` 的强转在 ArkTS 侧有风险；本仓 `core/*.ets` 一律靠 typeof 收窄）。

interface PluginOptionWire {
  label?: string;
  value?: string;
}

interface PluginPropWire {
  type?: string;
  label?: string;
  description?: string;
  default?: boolean | number | string | string[];
  options?: PluginOptionWire[];
  section?: string;
  secret?: boolean;
  placeholder?: string;
  required?: boolean;
  /** Go `*float64` + `omitempty` ⇒ 缺失；防御性兼容显式 `null`。 */
  minimum?: number | null;
  maximum?: number | null;
}

interface PluginEntryWire {
  id?: string;
  name?: string;
  title?: string;
  runtime?: string;
  enabled?: boolean;
  properties?: Record<string, PluginPropWire>;
  values?: Record<string, boolean | number | string | string[]>;
}

interface PluginConfigWire {
  plugins?: PluginEntryWire[];
}

// ── 原始值读取（全部走 `typeof`/`Array.isArray` 收窄，无强转）────────────────────

function strListOf(raw: boolean | number | string | string[] | null | undefined): string[] {
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

/** 原始 JSON 值 → `ConfigValue`（**按 kind 归一**；类型不符 ⇒ 落到该类的空值）。 */
export function readValue(
  kind: string, raw: boolean | number | string | string[] | null | undefined,
): ConfigValue {
  const v: ConfigValue = new ConfigValue();
  if (kind === PLUGIN_FIELD_BOOLEAN) {
    v.b = typeof raw === 'boolean' ? raw : false;
    return v;
  }
  if (kind === PLUGIN_FIELD_NUMBER) {
    v.n = typeof raw === 'number' ? raw : 0;
    return v;
  }
  if (kind === PLUGIN_FIELD_MULTISELECT) {
    v.list = strListOf(raw);
    return v;
  }
  v.s = typeof raw === 'string' ? raw : '';
  return v;
}

function buildProperty(key: string, w: PluginPropWire): PluginConfigProperty {
  const p: PluginConfigProperty = new PluginConfigProperty();
  p.key = key;
  p.kind = normalizeFieldType(w.type);
  p.label = isPresent(w.label) ? w.label : '';
  p.description = isPresent(w.description) ? w.description : '';
  p.section = isPresent(w.section) ? w.section : '';
  p.secret = w.secret === true;
  p.placeholder = isPresent(w.placeholder) ? w.placeholder : '';
  p.required = w.required === true;
  if (typeof w.minimum === 'number') {
    p.hasMin = true;
    p.min = w.minimum;
  }
  if (typeof w.maximum === 'number') {
    p.hasMax = true;
    p.max = w.maximum;
  }
  const opts: PluginOptionWire[] = arrOrEmpty(w.options);
  for (let i = 0; i < opts.length; i++) {
    const o: PluginOptionWire | undefined = opts[i];
    if (!isPresent(o)) {
      continue;
    }
    p.options.push(new PluginConfigOption(
      isPresent(o.label) ? o.label : '', isPresent(o.value) ? o.value : ''));
  }
  p.def = readValue(p.kind, w.default);
  p.editable = isFieldEditable(p.kind);
  return p;
}

/**
 * `plugin_config` 响应 → 视图模型（**全容错**：null/缺字段/坏 options 都不炸）。
 *
 * · 无 `id` 的条目**跳过**（没有 id 就无法写回 ⇒ 宁可不出现在列表里，也不做一个点了报错的控件）；
 * · `properties` 按 **key 升序**（Go 的 map 序列化即按 key 升序 ⇒ 与服务端 JSON 顺序一致、确定性）；
 * · `values` 缺失的键 ⇒ 用 `default`（服务端其实已把默认合并进 values，这是兜底）。
 */
export function parsePluginConfig(raw: Object | null | undefined): PluginConfigCatalog {
  const catalog: PluginConfigCatalog = new PluginConfigCatalog();
  if (!isPresent(raw)) {
    return catalog;
  }
  const wire: PluginConfigWire = raw as PluginConfigWire;
  const entries: PluginEntryWire[] = arrOrEmpty(wire.plugins);
  for (let i = 0; i < entries.length; i++) {
    const e: PluginEntryWire | undefined = entries[i];
    if (!isPresent(e)) {
      continue;
    }
    const id: string = isPresent(e.id) ? e.id : '';
    if (id.length === 0) {
      continue;
    }
    const entry: PluginConfigEntry = new PluginConfigEntry();
    entry.id = id;
    entry.name = isPresent(e.name) && e.name.length > 0 ? e.name : id;
    entry.title = isPresent(e.title) ? e.title : '';
    entry.runtime = isPresent(e.runtime) ? e.runtime : '';
    entry.isOn = e.enabled === true;
    const props: Record<string, PluginPropWire> = isPresent(e.properties) ? e.properties : {};
    const vals: Record<string, boolean | number | string | string[]> =
      isPresent(e.values) ? e.values : {};
    const keys: string[] = Object.keys(props);
    keys.sort();
    for (let k = 0; k < keys.length; k++) {
      const key: string = keys[k];
      const pw: PluginPropWire | undefined = props[key];
      if (!isPresent(pw)) {
        continue;
      }
      const prop: PluginConfigProperty = buildProperty(key, pw);
      entry.properties.push(prop);
      entry.values[key] = readValue(prop.kind, vals[key]);
    }
    catalog.entries.push(entry);
  }
  return catalog;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑧ 环境（插件）值 → `core/theme` 的 `AmbienceValues`（2026-10-13）
//    web 权威：`web/src/plugins/xbot-ambience/index.ts:42-44` 读 `glassOpacity`/`wallpaperOpacity`/
//    `glassBlur`，交 `plugin-api/ambience` 由宿主渲染氛围层。原生同一份数据来自 `plugin_config`
//    （**不看 `Web.Entry`**，只按 `ConfigSchema` 门控 ⇒ `xbot.ambience` **在返回里**；实测见
//    `core/theme.ets` 的订正注释）。
// ══════════════════════════════════════════════════════════════════════════════

/** `xbot.ambience` 的插件 id（真源：`~/.xbot/plugins/builtin/xbot.ambience/plugin.json` 顶层 `id`）。 */
export const AMBIENCE_PLUGIN_ID: string = 'xbot.ambience';

/** 数值键取用（非 `number` ⇒ 哨兵；`undefined`/字符串/数组都不算"用户设了值"）。 */
function ambienceNumber(raw: boolean | number | string | string[] | undefined): number {
  return typeof raw === 'number' ? raw : AMBIENCE_UNSET;
}

/** 逐键判定"用户改过"：`values[k] !== properties[k].default` ⇒ 取值；否则哨兵。 */
function ambienceCustomized(
  props: Record<string, PluginPropWire>,
  vals: Record<string, boolean | number | string | string[]>,
  key: string,
): number {
  const p: PluginPropWire | undefined = props[key];
  if (!isPresent(p)) {
    return AMBIENCE_UNSET;
  }
  const v: number = ambienceNumber(vals[key]);
  if (v < 0) {
    return AMBIENCE_UNSET;
  }
  const d: number = ambienceNumber(p.default);
  return v === d ? AMBIENCE_UNSET : v;
}

/**
 * 环境（插件）值 → `AmbienceValues`（**纯函数**）。
 *
 * ⛔ **只把"用户真改过"的键置成值**，其余留 `AMBIENCE_UNSET`（⇒ 回落原生默认：浅 0.84 / 深 0.62、柔焦 18）。
 *   为什么：服务端 `values` **恒被 schema 默认值填满**（实测 `glassBlur:0, glassOpacity:0.82,
 *   wallpaperOpacity:1`）⇒ 原样套用会让**深色玻璃 0.62→0.82、柔焦 18→0** —— 即"缺省即变"事故。
 * ⛔ 无该插件 / 无 `values` / 两个**原生会消费**的键全未改 ⇒ 返回 `null` ⇒ `setAmbience(null)`
 *   ⇒ 观感**逐字节不变**。
 * ⚠️ `wallpaper*` 原生 N/A（无壁纸渲染）—— 仍解析以对齐 web 契约，但**不参与**"是否改过"的判定。
 */
export function ambienceFromPluginConfig(raw: Object | null | undefined): AmbienceValues | null {
  if (!isPresent(raw)) {
    return null;
  }
  const wire: PluginConfigWire = raw as PluginConfigWire;
  const entries: PluginEntryWire[] = arrOrEmpty(wire.plugins);
  for (let i = 0; i < entries.length; i++) {
    const e: PluginEntryWire | undefined = entries[i];
    if (!isPresent(e) || e.id !== AMBIENCE_PLUGIN_ID) {
      continue;
    }
    const props: Record<string, PluginPropWire> = isPresent(e.properties) ? e.properties : {};
    const vals: Record<string, boolean | number | string | string[]> = isPresent(e.values) ? e.values : {};
    const out: AmbienceValues = new AmbienceValues();
    out.glassOpacity = ambienceCustomized(props, vals, 'glassOpacity');
    out.glassBlur = ambienceCustomized(props, vals, 'glassBlur');
    out.wallpaperOpacity = ambienceCustomized(props, vals, 'wallpaperOpacity');
    if (out.glassOpacity < 0 && out.glassBlur < 0) {
      return null;
    }
    return out;
  }
  return null;
}

/** 按 id 找条目（不存在 ⇒ `undefined`，调用方据此不写回）。 */
export function entryOf(catalog: PluginConfigCatalog, id: string): PluginConfigEntry | undefined {
  for (let i = 0; i < catalog.entries.length; i++) {
    if (catalog.entries[i].id === id) {
      return catalog.entries[i];
    }
  }
  return undefined;
}

/** 取字段当前值（缺 ⇒ 默认值）—— UI 与判据共用同一入口。 */
export function valueOfProp(
  prop: PluginConfigProperty, values: Record<string, ConfigValue>,
): ConfigValue {
  const v: ConfigValue | undefined = values[prop.key];
  return isPresent(v) ? v : prop.def;
}

/**
 * 把一批**服务端值**就地并入条目（SSE `web_plugin_config_changed` 合并 / 写后回拉）。
 *
 * ⛔ **状态一律以后端为准**：本函数只接受"后端给的值"，不参与任何乐观改写；
 *    未知 key（不在 schema 里）**丢弃**（不往模型里塞幽灵字段）。
 */
export function setEntryValues(
  entry: PluginConfigEntry, values: Record<string, boolean | number | string | string[]>,
): void {
  for (let i = 0; i < entry.properties.length; i++) {
    const prop: PluginConfigProperty = entry.properties[i];
    const raw: boolean | number | string | string[] | undefined = values[prop.key];
    if (raw === undefined) {
      continue;
    }
    entry.values[prop.key] = readValue(prop.kind, raw);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 值：校验 / 展示 / 提交 / 交互
// ══════════════════════════════════════════════════════════════════════════════

/** 是否数值合法（有限数；NaN/Infinity 都拒）。 */
export function isFiniteNumber(n: number): boolean {
  return typeof n === 'number' && n === n && n !== Infinity && n !== -Infinity;
}

/**
 * 值合法性（`''` = 通过，否则是**给用户看的原因**）。
 *
 * 为什么必须有：服务端按 schema 校验并在客户端**静默**改写 UI 是"假装成功"的反面 ——
 * 本地先判，非法就**不发送**（`plugin_config_set` 对 `boolean`/`number` 强校验类型，
 * 发错会得到 `expected boolean` 这类英文报错）。
 */
export function validateValue(prop: PluginConfigProperty, v: ConfigValue): string {
  // ⛔ image 走"上传后写回 URL"路径（不是文本框编辑）⇒ 必须**先于** `!editable` 判，
  //    否则上传成功也写不回去（会被 `该类型原生端暂不支持编辑` 挡下）。
  //    服务端契约：值 = 上传返回的 url（web `SettingsPlugins.tsx:270`），走同一 `plugin_config_set`。
  if (prop.kind === PLUGIN_FIELD_IMAGE) {
    if (prop.required && v.s.trim().length === 0) {
      return '不能为空';
    }
    return '';
  }
  if (!prop.editable) {
    return '该类型原生端暂不支持编辑';
  }
  if (prop.kind === PLUGIN_FIELD_BOOLEAN) {
    return '';
  }
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    if (!isFiniteNumber(v.n)) {
      return '请输入数字';
    }
    if (prop.hasMin && v.n < prop.min) {
      return `不得小于 ${prop.min}`;
    }
    if (prop.hasMax && v.n > prop.max) {
      return `不得大于 ${prop.max}`;
    }
    return '';
  }
  if (prop.kind === PLUGIN_FIELD_MULTISELECT) {
    if (prop.required && v.list.length === 0) {
      return '至少选择一项';
    }
    for (let i = 0; i < v.list.length; i++) {
      if (!optionExists(prop, v.list[i])) {
        return `未知选项：${v.list[i]}`;
      }
    }
    return '';
  }
  if (prop.kind === PLUGIN_FIELD_SELECT) {
    if (prop.required && v.s.length === 0) {
      return '必须选择一项';
    }
    if (v.s.length > 0 && !optionExists(prop, v.s)) {
      return `未知选项：${v.s}`;
    }
    return '';
  }
  // string（以及 image/unknown 已被 editable 挡在前面）
  if (prop.required && v.s.trim().length === 0) {
    return '不能为空';
  }
  return '';
}

function optionExists(prop: PluginConfigProperty, value: string): boolean {
  if (prop.options.length === 0) {
    return true; // 没声明 options ⇒ 不设约束（服务端也不按 options 校验）
  }
  for (let i = 0; i < prop.options.length; i++) {
    if (prop.options[i].value === value) {
      return true;
    }
  }
  return false;
}

/** `select` 选项 value → 显示名（未知 value ⇒ 原样回显，便于暴露脏数据）。 */
export function optionLabel(prop: PluginConfigProperty, value: string): string {
  for (let i = 0; i < prop.options.length; i++) {
    if (prop.options[i].value === value) {
      const l: string = prop.options[i].label;
      return l.length > 0 ? l : value;
    }
  }
  return value;
}

/**
 * secret 的显示形式（`前2位****`；极短值不外露长度）。
 *
 * ⛔ 只用于**显示**；真值绝不落日志/偏好（web `SettingsPlugins.tsx` 的 secret 语义）。
 */
/**
 * secret 的**只读掩码**。
 *
 * ⛔ **绝不露任何原文字符**（2026-10-11 修）：旧实现 `return \`${s.substring(0,2)}****\`` 会泄露
 *    密钥/令牌的**前 2 位**；web 权威用 `<Input type="password">`（`SettingsPlugins.tsx:639`）
 *    —— 浏览器**一个字符都不显示**。两处对齐 ⇒ 非空即 `****`（长度也不泄露：极短/极长同形）。
 */
export function maskedSecret(s: string): string {
  return s.length === 0 ? '' : '****';
}

/** 只读展示文案（各类型统一口径）。 */
export function displayValue(prop: PluginConfigProperty, v: ConfigValue): string {
  if (prop.kind === PLUGIN_FIELD_BOOLEAN) {
    return v.b ? '开' : '关';
  }
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return `${v.n}`;
  }
  if (prop.kind === PLUGIN_FIELD_MULTISELECT) {
    if (v.list.length === 0) {
      return '';
    }
    const labels: string[] = [];
    for (let i = 0; i < v.list.length; i++) {
      labels.push(optionLabel(prop, v.list[i]));
    }
    return labels.join('、');
  }
  if (prop.kind === PLUGIN_FIELD_SELECT) {
    if (v.s.length === 0) {
      return '';
    }
    return optionLabel(prop, v.s);
  }
  if (prop.kind === PLUGIN_FIELD_UNKNOWN) {
    // 对齐 web：未知类型是**可编辑文本框** ⇒ **原值原样显示**（不再一刀切「不支持」）。
    return v.s.length > 0 ? v.s : '（未知类型，当前为空）';
  }
  return prop.secret ? maskedSecret(v.s) : v.s;
}

/** 文本输入框的初值（boolean/multiselect 不用文本框 ⇒ 给空串）。 */
export function textInputValue(prop: PluginConfigProperty, v: ConfigValue): string {
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return `${v.n}`;
  }
  if (prop.kind === PLUGIN_FIELD_STRING || prop.kind === PLUGIN_FIELD_SELECT
    || prop.kind === PLUGIN_FIELD_IMAGE || prop.kind === PLUGIN_FIELD_UNKNOWN) {
    return v.s;
  }
  return '';
}

/** 文本输入 → `ConfigValue`（number 不合法 ⇒ 保留 `NaN` 让 `validateValue` 报错，不静默取 0）。 */
export function valueFromText(prop: PluginConfigProperty, text: string): ConfigValue {
  const v: ConfigValue = new ConfigValue();
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    const t: string = text.trim();
    v.n = t.length === 0 ? NaN : Number.parseFloat(t);
    return v;
  }
  v.s = text;
  return v;
}

/** Toggle → `ConfigValue`。 */
export function valueFromToggle(on: boolean): ConfigValue {
  const v: ConfigValue = new ConfigValue();
  v.b = on;
  return v;
}

/** `select` 单选 → `ConfigValue`。 */
export function valueFromSingle(value: string): ConfigValue {
  const v: ConfigValue = new ConfigValue();
  v.s = value;
  return v;
}

/** `multiselect` 点一项（已在 ⇒ 移除；不在 ⇒ 追加，**保序**）—— 纯函数，返回**新值**。 */
export function toggleListValue(v: ConfigValue, optionValue: string): ConfigValue {
  const out: ConfigValue = new ConfigValue();
  let found: boolean = false;
  for (let i = 0; i < v.list.length; i++) {
    if (v.list[i] === optionValue) {
      found = true;
    } else {
      out.list.push(v.list[i]);
    }
  }
  if (!found && optionValue.length > 0) {
    out.list.push(optionValue);
  }
  return out;
}

/** `multiselect` 当前是否选中某项。 */
export function listHas(v: ConfigValue, optionValue: string): boolean {
  for (let i = 0; i < v.list.length; i++) {
    if (v.list[i] === optionValue) {
      return true;
    }
  }
  return false;
}

/** `ConfigValue` → 写回 `plugin_config_set` 的 `value`（**真 JSON 标量/数组**，不是字符串）。 */
export function submitValue(prop: PluginConfigProperty, v: ConfigValue): boolean | number | string | string[] {
  if (prop.kind === PLUGIN_FIELD_BOOLEAN) {
    return v.b;
  }
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return v.n;
  }
  if (prop.kind === PLUGIN_FIELD_MULTISELECT) {
    return v.list;
  }
  return v.s;
}

/** 两值是否等价（dirty 判定 / 回包对账用）。 */
export function sameValue(prop: PluginConfigProperty, a: ConfigValue, b: ConfigValue): boolean {
  if (prop.kind === PLUGIN_FIELD_BOOLEAN) {
    return a.b === b.b;
  }
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return a.n === b.n;
  }
  if (prop.kind === PLUGIN_FIELD_MULTISELECT) {
    if (a.list.length !== b.list.length) {
      return false;
    }
    for (let i = 0; i < a.list.length; i++) {
      if (a.list[i] !== b.list[i]) {
        return false;
      }
    }
    return true;
  }
  return a.s === b.s;
}

/**
 * 一个字段当前值的**内容指纹**（供 ArkUI `ForEach` 的 key 用）。
 *
 * ⛔ 为什么 key 必须带内容：ArkUI 的 `ForEach` **key 不变则复用节点、不重估 `@Prop`**
 *    （`docs/ARKTS-GOTCHAS.md` §3/§4）—— 后端写成功后我们**重新拉取**配置（值变了但 id/key 没变），
 *    若 key 只含 id/key，界面会**停在旧值**（"写完看不出变化"）。指纹变化 ⇒ key 变化 ⇒ 该项重建。
 * ⛔ key 里**不得**出现状态类字段名（`tools/lint/criteria-single-source.sh` 规则 A 会命中）；
 *    本函数返回的是**值**，与那些名字无关。
 */
export function configValueFingerprint(prop: PluginConfigProperty, v: ConfigValue): string {
  if (prop.kind === PLUGIN_FIELD_BOOLEAN) {
    return v.b ? '1' : '0';
  }
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return `${v.n}`;
  }
  if (prop.kind === PLUGIN_FIELD_MULTISELECT) {
    return v.list.join(',');
  }
  return `${v.s.length}:${v.s}`;
}

/** 一个插件卡片的**内容指纹**（id + 启用态 + 各字段值指纹）—— 供 `ForEach` key 用（同上理由）。 */
export function pluginEntryFingerprint(e: PluginConfigEntry): string {
  let fp: string = `${e.id}#${e.isOn ? '1' : '0'}`;
  for (let i = 0; i < e.properties.length; i++) {
    const p: PluginConfigProperty = e.properties[i];
    fp += `#${p.key}=${configValueFingerprint(p, valueOfProp(p, e.values))}`;
  }
  return fp;
}

/** 按 `section` 分组后的一个组（组名空串 = 无分组的头部区）。 */
export class PluginConfigGroup {
  section: string = '';
  props: PluginConfigProperty[] = [];
}

/**
 * 字段按 `section` 分组，**保持首次出现顺序**（web `SettingsPlugins.tsx:199-207` 的
 * `groupBySection` 是 Map 插入序 ⇒ 同一语义）。
 */
export function groupBySection(props: PluginConfigProperty[]): PluginConfigGroup[] {
  const out: PluginConfigGroup[] = [];
  for (let i = 0; i < props.length; i++) {
    const p: PluginConfigProperty = props[i];
    let g: PluginConfigGroup | undefined = undefined;
    for (let j = 0; j < out.length; j++) {
      if (out[j].section === p.section) {
        g = out[j];
        break;
      }
    }
    if (g === undefined) {
      g = new PluginConfigGroup();
      g.section = p.section;
      out.push(g);
    }
    g.props.push(p);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 设置分区门控（本轮「未实现的分区不要装样子」）
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么放在本文件：本波只允许新增**一个** core 纯逻辑文件（`core/settingsplugins.ets`），
// 而「哪些分区该出现」与插件分区同属**设置面规格** ⇒ 同址，供 `components/SettingsPanel.ets` 消费。

/** 一个设置分区的规格（`implemented=false` ⇒ 不出现，且**不产生空壳**）。 */
export class SettingsTabSpec {
  id: string = '';
  label: string = '';
  /**
   * 该分区**是否已实现**（有真实内容）。未实现的分区**一律不显示** ——
   * ⛔ 用户亲报的失败模式：点进去是空壳 ⇒ 以为"坏了"。
   */
  implemented: boolean = false;

  constructor(id: string, label: string, implemented: boolean) {
    this.id = id;
    this.label = label;
    this.implemented = implemented;
  }
}

/** 唯一门控判据：只有**已实现**的分区才渲染。 */
export function shouldShowTab(spec: SettingsTabSpec): boolean {
  return spec.implemented === true;
}

/** 全部分区 → 实际显示的分区（顺序原样保留）。 */
export function visibleTabs(all: SettingsTabSpec[]): SettingsTabSpec[] {
  const out: SettingsTabSpec[] = [];
  for (let i = 0; i < all.length; i++) {
    if (shouldShowTab(all[i])) {
      out.push(all[i]);
    }
  }
  return out;
}

/** 当前 `active` 是否仍然可见（切分区间/规格变化时用它回落，避免落到隐藏分区）。 */
export function fallbackTabId(all: SettingsTabSpec[], active: string): string {
  const vis: SettingsTabSpec[] = visibleTabs(all);
  for (let i = 0; i < vis.length; i++) {
    if (vis[i].id === active) {
      return active;
    }
  }
  return vis.length > 0 ? vis[0].id : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 设置**根列表**的分组规格（2026-10-16；目标③「所有面板对标 Apple」）
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么改：12 个分区原先被画成 **4 列 × 3 行的下划线标签网格**（`Flex(wrap)` + 指示线），
//   真机截图（`/tmp/panel_settings2.jpeg`）实锤：12 枚裸文字排成三行、选中态只有一条线，
//   **进面板要吃掉 ~250vp 才看到第一项内容**；且"下划线页签"是 Material 语言 ——
//   Apple 的设置面是**分组列表 + 钻取**（根列表只回答"去哪"，内容在下一层，页头出返回箭头）。
//
// ⛔ 本函数**只做呈现分组**，不含任何门控：入参 = `visibleTabs()` 的产物（未实现的分区
//   早已被 `shouldShowTab` 滤掉）。新增分区若忘了登记分组 ⇒ 落进尾部「其它」组
//   ⇒ **永不丢分区**（fail-open：「不静默丢入口」）。
// ⛔ 判据 = `tools/tests/settings_root_list.test.ts`（钉：分组并集 == 传入集合、无重项、
//   未知 id 落 `misc`、空组丢弃、组序恒为声明序；并有组件侧形态断言 + 白绿防线）。

/** 根列表的一个分组（`items` 非空才应由 `settingsRootGroups` 产出）。 */
export class SettingsGroupSpec {
  key: string = '';
  title: string = '';
  items: SettingsTabSpec[] = [];
  constructor(key: string, title: string, items: SettingsTabSpec[]) {
    this.key = key;
    this.title = title;
    this.items = items;
  }
}

/** 组 key 的**声明顺序**（唯一真源；根列表按它排序）。 */
export function settingsGroupKeys(): string[] {
  return ['personal', 'model', 'connect', 'advanced', 'about', 'misc'];
}

/** 组 key → 组头文案（唯一真源；⛔ 组件不另写一份）。 */
export function settingsGroupTitle(key: string): string {
  if (key === 'personal') { return '个性化'; }
  if (key === 'model') { return '模型与智能体'; }
  if (key === 'connect') { return '连接与账号'; }
  if (key === 'advanced') { return '高级'; }
  if (key === 'about') { return '关于'; }
  return '其它';
}

/** 分区 id → 组 key（**唯一真源**；未登记 ⇒ `misc` ⇒ 永不丢项）。 */
export function settingsGroupKeyOfTab(tabId: string): string {
  if (tabId === 'appearance' || tabId === 'notify') { return 'personal'; }
  if (tabId === 'llm' || tabId === 'agent' || tabId === 'tools') { return 'model'; }
  if (tabId === 'channels' || tabId === 'webusers' || tabId === 'account' || tabId === 'storage') {
    return 'connect';
  }
  if (tabId === 'plugins' || tabId === 'developer') { return 'advanced'; }
  if (tabId === 'about') { return 'about'; }
  return 'misc';
}

/** 全部分区 → 根列表分组（**空组自动丢弃**；组内顺序 = 传入顺序）。
 *
 *  ⛔ 本函数**自带门控**（内部先过 `shouldShowTab`）：这样"未实现的分区 ⇒ 不出现"与
 *    "不留空组头"是同一条不变式，调用方忘了先 `visibleTabs()` 也不会渲出空壳。
 *    （与 `shouldShowTab` 同源，所以幂等：传 `visibleTabs()` 的结果进来也逐字节相同。）
 */
export function settingsRootGroups(all: SettingsTabSpec[]): SettingsGroupSpec[] {
  const keys: string[] = settingsGroupKeys();
  const vis: SettingsTabSpec[] = visibleTabs(all);
  const out: SettingsGroupSpec[] = [];
  for (let k = 0; k < keys.length; k++) {
    const key: string = keys[k];
    const items: SettingsTabSpec[] = [];
    for (let i = 0; i < vis.length; i++) {
      if (settingsGroupKeyOfTab(vis[i].id) === key) {
        items.push(vis[i]);
      }
    }
    if (items.length > 0) {
      out.push(new SettingsGroupSpec(key, settingsGroupTitle(key), items));
    }
  }
  return out;
}

/**
 * 根列表的**一行**（扁平模型）。
 *
 * 为什么扁平：渲染侧因此只需**一个** `ForEach`（组头行 + 分区行混排）——
 * `tools/perf/guard.sh` 的 `ForEach 处数` 是**结构性规模指示**、只许减不许增
 * （⚠️ 2026-10-16 实测：两层 `ForEach`（组 × 行）会把 118 > 上限 117 ⇒ 门禁红）。
 * ⛔ 正解是扁平化，**不是**抬阈值。
 */
export class SettingsRootRow {
  /** `true` = 组头（⛔ 不可点、不参与选择）；`false` = 可钻取的分区行。 */
  isHeader: boolean = false;
  /** 组头 ⇒ 组 key；分区行 ⇒ 分区 id。 */
  key: string = '';
  /** 组头 ⇒ 组名；分区行 ⇒ 分区名。 */
  label: string = '';
  /** 分区行专用：是否**组内最后一行**（Apple 分组列表：组尾不画分隔线）。 */
  last: boolean = false;
  constructor(isHeader: boolean, key: string, label: string, last: boolean) {
    this.isHeader = isHeader;
    this.key = key;
    this.label = label;
    this.last = last;
  }
}

/** 全部分区 → 根列表的**扁平行序列**（组头行 + 其成员行；空组不产生任何行）。 */
export function settingsRootRows(all: SettingsTabSpec[]): SettingsRootRow[] {
  const groups: SettingsGroupSpec[] = settingsRootGroups(all);
  const out: SettingsRootRow[] = [];
  for (let g = 0; g < groups.length; g++) {
    out.push(new SettingsRootRow(true, groups[g].key, groups[g].title, false));
    for (let i = 0; i < groups[g].items.length; i++) {
      const isLast: boolean = i === groups[g].items.length - 1;
      out.push(new SettingsRootRow(false, groups[g].items[i].id, groups[g].items[i].label, isLast));
    }
  }
  return out;
}

/**
 * 该 number 字段是否该用**滑条**（对齐 web `SettingsPlugins.tsx:410-415` 的 `hasRange`）：
 * 声明了 `min` **且**声明了 `max` **且** `max > min` ⇒ 用滑条；否则用文本框。
 * ⛔ 判据与渲染同源（组件**不得**自己写这段判断）。
 */
export function pluginFieldHasRange(p: PluginConfigProperty): boolean {
  return p.hasMin === true && p.hasMax === true && p.max > p.min;
}

/**
 * 滑条**定位值**：把草稿文本解析成钳制在 `[min,max]` 的数。
 *
 * 逐字对齐 web `SettingsPlugins.tsx:417-420`：
 *   `const n = Number(draft); const sliderValue = Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))`
 * （web 用 `Number()`；原生等价物是 `parseFloat` —— 两者对 `"0.82"` 都是 0.82，对 `"082"` 都是 82）。
 *
 * ⛔ **这个函数存在就是因为真机缺陷**（2026-10-11）：旧实现把它内联在组件里，而值框用了
 *    `InputType.Number`（SDK 原文 "decimals are not supported"）⇒ `0.82` 被滤成 `082`
 *    ⇒ `parseFloat("082") = 82` ⇒ 钳到 `max` ⇒ **滑条跳到最右**（值框 `082` / 滑条在最右，同源同因）。
 *    抽成纯函数后：① 可脱机测（组件不进 harness）；② 钳制/回落语义单点（判据与渲染同源）。
 */
export function pluginSliderValue(text: string, min: number, max: number): number {
  const lo: number = isFiniteNumber(min) ? min : 0;
  const hi: number = isFiniteNumber(max) && max > lo ? max : lo;
  const n: number = Number.parseFloat(isPresent(text) ? text : '');
  const v: number = isFiniteNumber(n) ? n : lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 滑条**步长**（对齐 web `SettingsPlugins.tsx:449`）：
 *   两端皆整数 ⇒ `1`；否则按跨度自适应（`≤2` ⇒ 0.01、`≤20` ⇒ 0.1、其余 ⇒ 1）。
 * ⛔ 必须 > 0（ArkUI `Slider` 的 `step` 为 0 会不生效/异常）。
 */
export function pluginSliderStep(min: number, max: number): number {
  const lo: number = isFiniteNumber(min) ? min : 0;
  const hi: number = isFiniteNumber(max) ? max : 0;
  if (Number.isInteger(lo) && Number.isInteger(hi)) {
    return 1;
  }
  const span: number = hi - lo;
  if (span <= 2) {
    return 0.01;
  }
  if (span <= 20) {
    return 0.1;
  }
  return 1;
}

// ══════════════════════════════════════════════════════════════════════════════
// ③c 字段类型 ⇒ 控件 / 输入档（**唯一映射表**；组件只把角色名映射到 ArkUI）
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么要有这张表：真机抓到一类"字段类型 ↔ 控件"错配（2026-10-11）——
//   number 字段用了 `InputType.Number`（**整数档**，本机 SDK 原文 "Digit input mode.
//   Negative numbers and decimals are not supported."）⇒ 服务端默认 `0.82` 被滤成 `082`
//   ⇒ `parseFloat("082")=82` ⇒ 滑条钳到 max（跳到最右）。
// 结论：**输入档不能由组件各自拍**，必须单点判定、可脱机测、并被源码守卫钉死（禁 `InputType.Number`）。

/** 输入档角色：纯文本（ArkUI `InputType.Normal`）。 */
export const PLUGIN_INPUT_TEXT: string = 'text';
/** 输入档角色：**小数档**（ArkUI `InputType.NUMBER_DECIMAL` = web `inputMode="decimal"`）。 */
export const PLUGIN_INPUT_DECIMAL: string = 'decimal';
/** 输入档角色：遮蔽（ArkUI `InputType.Password`）。 */
export const PLUGIN_INPUT_SECRET: string = 'secret';

/** 控件档角色：只读展示（image / unknown）。 */
export const PLUGIN_CTRL_STATIC: string = 'static';
/** 控件档角色：开关（boolean）。 */
export const PLUGIN_CTRL_SWITCH: string = 'switch';
/** 控件档角色：候选 chips（select / multiselect）。 */
export const PLUGIN_CTRL_CHIPS: string = 'chips';
/** 控件档角色：文本框（string / number；number 有范围时组件**附带**滑条）。 */
export const PLUGIN_CTRL_TEXT: string = 'text';
/** 控件档角色：**图片上传值区**（image：预览 + 选图 + 上传 + 失败可读 + Web UI 兜底）。 */
export const PLUGIN_CTRL_IMAGE: string = 'image';

/**
 * 字段 ⇒ **控件档**（唯一映射；组件不得自己 if/else 判控件）。
 *   · image / unknown ⇒ `static`（只读展示 + 说明；`isFieldEditable` 已表达这条）；
 *   · boolean ⇒ `switch`；select / multiselect ⇒ `chips`；其余（number / string）⇒ `text`
 *     （number 且 `pluginFieldHasRange` ⇒ 组件在 `text` 里**附带**滑条，对齐 web `SettingsPlugins.tsx:464-477`）。
 */
export function pluginControlKind(kind: string): string {
  if (!isFieldEditable(kind)) {
    // ⚠️ image 例外：它**不是**"只读"—— 有专门的上传值区（预览/选图/上传/失败可读）。
    // 2026-10-11 修：此前本表对 image 误返回 `static`（"只读展示"），而组件已渲染可编辑值区
    // ⇒ **映射表与渲染分叉**。现在 image 单列一档（判据与渲染同源）。
    return kind === PLUGIN_FIELD_IMAGE ? PLUGIN_CTRL_IMAGE : PLUGIN_CTRL_STATIC;
  }
  if (kind === PLUGIN_FIELD_BOOLEAN) {
    return PLUGIN_CTRL_SWITCH;
  }
  if (kind === PLUGIN_FIELD_SELECT || kind === PLUGIN_FIELD_MULTISELECT) {
    return PLUGIN_CTRL_CHIPS;
  }
  return PLUGIN_CTRL_TEXT;
}

/**
 * 字段 ⇒ **输入档**（值框 `InputType` 的唯一判据；组件只做"角色名 → ArkUI 枚举"的机械映射）。
 *
 * ⛔ **number 一律 `decimal`，永不整数档**。依据两条（都可复核）：
 *   ① **web 权威**：`SettingsPlugins.tsx:437-438` 对所有 number 都是
 *      `type="number" inputMode="decimal"` —— **没有整数特例**；
 *   ② **schema 无法证明"只可能整数"**：`plugin.json` 的 number 只有 `minimum/maximum/default`
 *      （实测 5 个内置插件：`wallpaperOpacity 0.1..1.0`、`glassOpacity 0.5..1.0`、
 *      `glassBlur 0..24`、`defaultLogLimit 1..100`），**没有 `step`** ⇒ 整数性不可判
 *      ⇒ 用整数档必然存在丢小数点的风险；小数档是**信息无损超集**（整数照样能输）。
 *   · `secret`（string）⇒ `secret`；其余可编辑文本 ⇒ `text`；boolean/chips/static 不走值框（调用方不读）。
 */
export function pluginInputMode(kind: string, secret: boolean): string {
  if (kind === PLUGIN_FIELD_NUMBER) {
    return PLUGIN_INPUT_DECIMAL;
  }
  if (secret === true) {
    return PLUGIN_INPUT_SECRET;
  }
  return PLUGIN_INPUT_TEXT;
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 插件图片字段：上传契约 / 值分类 / 预览 URL（`components/SettingsPlugins.ets` 只消费）
// ══════════════════════════════════════════════════════════════════════════════
//
// 服务端契约（**逐条取证**，⛔ 不改服务端）：
//   · 路由：`channel/web/web.go:898` `POST /api/plugin-files/upload`（`authMiddleware(postOnly(...))`）；
//     `:899` `/api/plugin-files/{id}[/{filename}]`（GET 列表/serve、DELETE 删）。
//   · 请求：**multipart/form-data**，字段 `plugin_id`（`web_files.go:128` `r.FormValue("plugin_id")`）
//     + `file`（`:134` `r.FormFile("file")`）；**大小无上限**（`:120-123` 注释 + 不包 MaxBytesReader）。
//   · 响应：`{ok:true,data:{filename,url,size,contentType,modTime}}`（`:179-188` 的 `PluginFileMeta`），
//     `url = /api/plugin-files/{id}/{filename}`（`:179`）。
//   · **写回方式**：图片字段的值 = 该 `url`，走**既有** `plugin_config_set`
//     （web 权威 `web/SettingsPlugins.tsx:270` `await onChange(propKey, json.data.url)`）——
//     **没有**专门的"图片 set"路由。
//   · 命名校验：`pluginFileIDRe`/`pluginFileNameRe`（`web_files.go:35-36`）—— 本模块**镜像**它们。

/** 上传端点（相对路径；绝对化由 `XbotHttp` 的 baseUrl 负责）。 */
export const PLUGIN_UPLOAD_PATH: string = '/api/plugin-files/upload';
/** 插件文件 URL 前缀（与服务端 `web_files.go:179` 同构）。 */
export const PLUGIN_FILES_PREFIX: string = '/api/plugin-files/';
/** multipart 字段名：插件 id（服务端 `web_files.go:128`）。 */
export const PLUGIN_UPLOAD_FIELD_ID: string = 'plugin_id';
/** multipart 字段名：文件本体（服务端 `web_files.go:134`）。 */
export const PLUGIN_UPLOAD_FIELD_FILE: string = 'file';

/** 值分类：空（无图）。 */
export const PLUGIN_IMG_EMPTY: string = 'empty';
/** 值分类：内置预设（`preset:*`，随插件分发，不可删）。 */
export const PLUGIN_IMG_PRESET: string = 'preset';
/** 值分类：本站上传的插件文件（`/api/plugin-files/...`）。 */
export const PLUGIN_IMG_UPLOADED: string = 'uploaded';
/** 值分类：外部 URL 或其它（原样显示，不拼 baseUrl）。 */
export const PLUGIN_IMG_EXTERNAL: string = 'external';

/** 服务端 `pluginFileIDRe`（`web_files.go:35`）的**客户端镜像**（拒脏 id，避免拿 400）。 */
const PLUGIN_ID_RE: RegExp = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
/** 服务端 `pluginFileNameRe`（`web_files.go:36`）的镜像：首字符字母数字 + `.` + 1..10 位扩展。 */
const PLUGIN_FILE_NAME_RE: RegExp = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}\.[a-zA-Z0-9]{1,10}$/;

/** 插件 id 是否通过服务端同款校验（含禁 `..`）。 */
export function pluginIdIsValid(id: string): boolean {
  const s: string = isPresent(id) ? id : '';
  return PLUGIN_ID_RE.test(s) && s.indexOf('..') < 0;
}

/** 上传文件名是否通过服务端同款校验（含禁 `..`）。 */
export function pluginUploadFilenameIsValid(name: string): boolean {
  const s: string = isPresent(name) ? name : '';
  return PLUGIN_FILE_NAME_RE.test(s) && s.indexOf('..') < 0;
}

/**
 * 上传路径（**带 `plugin_id` 走 query**）。
 *
 * ⛔ 为什么可以走 query：服务端读的是 **`r.FormValue("plugin_id")`**（`web_files.go:128`），
 *    而 Go 的 `FormValue` 会**同时**读 URL query 与 POST form（`ParseMultipartForm` 后查 `r.Form`）
 *    ⇒ query 形态与 web 的 form 形态**服务端等价**。这样能**复用既有** `XbotHttp.uploadBytes`
 *    （它只发 `file` 一个 part）⇒ **不必改共享的 `core/http.ets`**。
 * ⚠️ 若将来服务端改用 `r.PostFormValue`，本函数要同步改为"在 form 里多发一个 part"。
 */
export function pluginUploadPath(pluginId: string): string {
  const id: string = isPresent(pluginId) ? pluginId : '';
  return `${PLUGIN_UPLOAD_PATH}?${PLUGIN_UPLOAD_FIELD_ID}=${id}`;
}

/** 上传返回的**相对** URL（与服务端 `web_files.go:179` 逐字同构）。 */
export function pluginFileUrl(pluginId: string, filename: string): string {
  return `${PLUGIN_FILES_PREFIX}${pluginId}/${filename}`;
}

/** 图片字段的值 → 分类（驱动"预览 / 可否删 / 兜底"分支）。 */
export function pluginImageValueKind(value: string): string {
  const v: string = isPresent(value) ? value.trim() : '';
  if (v.length === 0) {
    return PLUGIN_IMG_EMPTY;
  }
  if (v.startsWith('preset:')) {
    return PLUGIN_IMG_PRESET;
  }
  if (v.startsWith(PLUGIN_FILES_PREFIX)) {
    return PLUGIN_IMG_UPLOADED;
  }
  return PLUGIN_IMG_EXTERNAL;
}

/**
 * 预览用的**绝对** URL：上传值 ⇒ 拼 baseUrl（去尾斜杠）；外部 ⇒ 原样；
 * preset（随插件分发的样式，非图片 URL）/空 ⇒ **空串**（调用方不画预览，退化为文字）。
 */
export function pluginImagePreviewUrl(baseUrl: string, value: string): string {
  const kind: string = pluginImageValueKind(value);
  if (kind === PLUGIN_IMG_UPLOADED) {
    const b: string = isPresent(baseUrl) ? baseUrl.replace(/\/+$/, '') : '';
    const v: string = isPresent(value) ? value.trim() : '';
    return `${b}${v}`;
  }
  if (kind === PLUGIN_IMG_EXTERNAL) {
    return isPresent(value) ? value.trim() : '';
  }
  return '';
}

/**
 * 上传失败文案（HTTP 码 + 原因；与 `core/pluginview.ets:webHttpErrorDetail` 同风格）。
 * 纯函数 ⇒ 可脱机断言（组件只做"取值 → 交给它"）。
 */
export function pluginUploadErrorText(status: number, reason: string): string {
  const r: string = isPresent(reason) ? reason.trim() : '';
  const c: number = typeof status === 'number' && isFinite(status) && status !== 0 ? status : 0;
  if (c !== 0 && r.length > 0) {
    return `图片上传失败：HTTP ${c} ${r}`;
  }
  if (c !== 0) {
    return `图片上传失败：HTTP ${c}`;
  }
  return r.length > 0 ? `图片上传失败：${r}` : '图片上传失败';
}

/**
 * 从选中文档 URI 抽文件名（**必须**过 `pluginUploadFilenameIsValid`；否则用 `fallback`）。
 *
 * 为什么必须归一：picker 给的 URI 形如 `file://media/Photo/12/IMG_001/IMG_2024.jpg?x=1`
 * —— 含 query、且原文件名可能不满足服务端正则（首字符 / 扩展名长度）⇒ 直接用会被 400。
 * `fallback` 由调用方给（含时间戳，保证唯一），例如 `image-1712345.png`。
 */
export function pluginFilenameFromUri(uri: string, fallback: string): string {
  const u: string = isPresent(uri) ? uri.trim() : '';
  const slash: number = Math.max(u.lastIndexOf('/'), u.lastIndexOf('\\'));
  let name: string = slash >= 0 ? u.substring(slash + 1) : u;
  const q: number = name.indexOf('?');
  if (q >= 0) {
    name = name.substring(0, q);
  }
  const h: number = name.indexOf('#');
  if (h >= 0) {
    name = name.substring(0, h);
  }
  if (pluginUploadFilenameIsValid(name)) {
    return name;
  }
  return pluginUploadFilenameIsValid(fallback) ? fallback : 'image-1.png';
}

/**
 * 上传响应（`XbotHttp.uploadBytes` 已剥掉信封 ⇒ 入参是 `data` 即 `PluginFileMeta` 的 JSON 串）
 * → 服务端返回的 **url**。⛔ 服务端会**改名**（`web_files.go:141-149`）⇒ **必须**用返回的 url，
 * 不许客户端自己拼。解析失败/缺 url ⇒ 空串（调用方报错，绝不静默用坏值）。
 */
export function pluginUploadUrlFromMeta(metaJson: string): string {
  try {
    const raw: string = isPresent(metaJson) ? metaJson : '';
    if (raw.length === 0) {
      return '';
    }
    const obj: Record<string, string> = JSON.parse(raw) as Record<string, string>;
    if (obj === null || obj === undefined) {
      return '';
    }
    const url: string = typeof obj.url === 'string' ? obj.url : '';
    return url.startsWith(PLUGIN_FILES_PREFIX) ? url : '';
  } catch (e) {
    return '';
  }
}

/**
 * 从 `XbotHttp` 抛出的错误文案里抽 **HTTP 状态码**（`uploadBytes` 抛的是 `HTTP <code>: <body>`，
 * 见 `core/http.ets:365`）。抽不到 ⇒ 0（调用方落回"只有原因"的文案）。
 */
export function pluginUploadStatusFromMessage(message: string): number {
  const m: string = isPresent(message) ? message : '';
  const hit: RegExpExecArray | null = /HTTP\s+(\d{3})/.exec(m);
  if (hit === null) {
    return 0;
  }
  const n: number = Number.parseInt(hit[1], 10);
  return isFiniteNumber(n) ? n : 0;
}

/**
 * 文件名的 MIME（镜像服务端 `contentTypeFor`，`web_files.go:79-97` 的图片部分）。
 * 未知扩展 ⇒ `application/octet-stream`（服务端会自动落 `.bin`，但**文件名不安全时才改名**）。
 */
export function pluginUploadMime(filename: string): string {
  const f: string = isPresent(filename) ? filename.toLowerCase() : '';
  const dot: number = f.lastIndexOf('.');
  const ext: string = dot >= 0 ? f.substring(dot) : '';
  if (ext === '.png') { return 'image/png'; }
  if (ext === '.jpg' || ext === '.jpeg') { return 'image/jpeg'; }
  if (ext === '.webp') { return 'image/webp'; }
  if (ext === '.gif') { return 'image/gif'; }
  if (ext === '.svg') { return 'image/svg+xml'; }
  return 'application/octet-stream';
}

// ══════════════════════════════════════════════════════════════════════════════
// ③b 搜索过滤（对齐 web `SettingsPlugins.tsx:133-155`）
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么要有它：web 插件分区顶部有搜索框（按 `key`/`label`/`description` 大小写不敏感过滤，
// 并**丢掉过滤后一个字段都不剩的插件**）；本仓此前没有 ⇒ 插件一多只能滚动找。
// ⛔ 判据与渲染同源：过滤**只**在这里实现，组件不得自己写 `includes`。

/** 查询串是否命中一个字段（`key` / `label` / `description`，均大小写不敏感）。空串 ⇒ 全命中。 */export function pluginPropMatches(p: PluginConfigProperty, query: string): boolean {
  const q: string = query.trim().toLowerCase();
  if (q.length === 0) { return true; }
  return p.key.toLowerCase().indexOf(q) >= 0
    || p.label.toLowerCase().indexOf(q) >= 0
    || p.description.toLowerCase().indexOf(q) >= 0;
}

/**
 * 按查询串过滤整个插件目录（web `SettingsPlugins.tsx:133-155` 同语义）：
 * 每个插件只保留**命中的字段**；过滤后**一个字段都不剩的插件整块丢掉**。
 * 空串 ⇒ **原样返回同一目录**（不复制 ⇒ 引用相等，UI 无谓重渲染）。
 */
export function filterPluginCatalog(cat: PluginConfigCatalog, query: string): PluginConfigCatalog {
  const q: string = query.trim().toLowerCase();
  if (q.length === 0) {
    return cat;
  }
  const out: PluginConfigCatalog = new PluginConfigCatalog();
  for (let i = 0; i < cat.entries.length; i++) {
    const e: PluginConfigEntry = cat.entries[i];
    const kept: PluginConfigProperty[] = [];
    for (let j = 0; j < e.properties.length; j++) {
      if (pluginPropMatches(e.properties[j], q)) { kept.push(e.properties[j]); }
    }
    if (kept.length === 0) { continue; }
    const ne: PluginConfigEntry = new PluginConfigEntry();
    ne.id = e.id;
    ne.name = e.name;
    ne.title = e.title;
    ne.runtime = e.runtime;
    ne.isOn = e.isOn;
    ne.properties = kept;
    ne.values = e.values;
    out.entries.push(ne);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 插件安装（`.zip` 上传 `POST /api/plugin/install-file`）—— `components/SettingsPlugins.ets` 只消费
// ══════════════════════════════════════════════════════════════════════════════
//
// 权威基准 = **服务端**（只读核实 `/Users/bobli/src/xbot`，file:line 可查），web 侧调用点对齐：
//   · web 调用点：`web/src/plugins/manager/PluginManagerPanel.tsx:129-143 onPickZip`
//     （`<input type="file" accept=".zip">`）→ `web/src/components/agent/api.ts:644-649 installPluginFile`
//     → `postAPI('/api/plugin/install-file', form)`（`FormData`，无 `Content-Type` 手写 ⇒ 浏览器补 boundary）。
//   · 路由：`channel/web/web.go:971`
//     `mux.HandleFunc("/api/plugin/install-file", wc.authenticatedPOST(wc.handlePluginInstallFile))`
//     ⇒ **POST** + **cookie 鉴权**（与本仓 `XbotHttp` 既有语义一致 ⇒ 直用 `uploadBytes`）。
//   · 处理器 `channel/web/web_api.go:563-625`（逐条证据）：
//       – RPC 未配置 ⇒ **503** `{ok:false,error:"RPC handler not configured"}`（`:564-567`）；
//       – 无 senderID ⇒ **401** `unauthorized`（`:573-576`）；
//       – **管理员限定** **403** `admin required`（`:577-580`；注释原文：`rpcCall` 用
//         `RPCIdentity{SenderID:"web_admin"}` **绕过 RPC 层鉴权** ⇒ 管理员检查**只在此处**）；
//       – multipart 上限 `r.ParseMultipartForm(32 << 20)`（`:582`）= **32 MiB**（超限 Go 侧报错 ⇒ **400**）；
//       – **文件字段名 `file`**（`:587` `r.FormFile("file")`）—— 与 `XbotHttp.uploadBytes`
//         （`core/http.ets:332` 硬编码 `name="file"`）**一致** ⇒ 可直接复用，无需新增上传器；
//       – 落临时文件（`:594-606`）→ RPC `plugin_install_file{zip_path}`（`:614-616`）→ 成功 **200** `{ok:true,id,dir}`（`:621-625`）；
//         RPC 失败（zip 内缺 `plugin.json` / 清单非法）⇒ **500** + RPC 错误原文（`:617-619`）。
//   · 信封：`channel/web/web_auth.go:511-535 writeJSON` 包成 `{ok,data,error}`（成功时 `data` = 去掉
//     `ok`/`error` 的 payload）⇒ `XbotHttp.uploadBytes` **已剥信封**（`core/http.ets:380-385`）
//     ⇒ 其返回值就是 `{"id":…,"dir":…}` 的 JSON 串。
//   · zip 形态：`plugin.json` 在**根**或**单层目录内**（`web_api.go:558-560`，由解压侧判定）—— 客户端不解释。
//   · **文件名服务端不看**（`web_api.go:608` `_ = header // filename is informational`）⇒ 本节的
//     "文件名"判据只用于**挡明显选错的**与日志可读性，⛔ 不是安全边界。
// ⛔ 本机**无设备** ⇒ 全节为纯逻辑 + 契约核对；"上传是否真成功"标**待设备验证**。

/** 安装端点（`channel/web/web.go:971`）。 */
export const PLUGIN_INSTALL_PATH: string = '/api/plugin/install-file';
/** multipart 文件字段名（`web_api.go:587`）—— 与 `XbotHttp.uploadBytes` 的硬编码一致。 */
export const PLUGIN_INSTALL_FIELD_FILE: string = 'file';
/** 服务端 multipart 上限（`web_api.go:582` 的 `32 << 20`）—— 客户端**先判**，别传完才被拒。 */
export const PLUGIN_INSTALL_MAX_BYTES: number = 32 * 1024 * 1024;
/** 安装包 MIME（zip）。 */
export const PLUGIN_INSTALL_MIME: string = 'application/zip';

/** 是否 `.zip`（**提示性预检**：服务端不看文件名 ⇒ 这里只挡明显选错的）。 */
export function pluginInstallFilenameIsValid(name: string): boolean {
  const n: string = isPresent(name) ? name.trim().toLowerCase() : '';
  return n.length > 4 && n.substring(n.length - 4) === '.zip';
}

/**
 * 文件字节数是否在上限内（`0 < bytes <= PLUGIN_INSTALL_MAX_BYTES`）。
 * 非有限 / 负数 / 0 / 超限 ⇒ false（宁可本地先报错，也不把坏值发给服务端）。
 */
export function pluginInstallSizeOk(bytes: number): boolean {
  return typeof bytes === 'number' && isFinite(bytes) && bytes > 0 && bytes <= PLUGIN_INSTALL_MAX_BYTES;
}

/**
 * 选中的文档 URI → multipart **filename**。
 * ⛔ 服务端**不看**文件名（`web_api.go:608`）⇒ 这里只保证：① 去掉 query/hash（picker URI 常带 `?x=1`）
 * ② 以 `.zip` 结尾（服务端日志/排查可读）。抽不出合法名 ⇒ 用调用方给的 `fallback`（含时间戳），
 * 再不行 ⇒ 固定 `plugin.zip`。
 */
export function pluginInstallFilenameFromUri(uri: string, fallback: string): string {
  const u: string = isPresent(uri) ? uri.trim() : '';
  const slash: number = Math.max(u.lastIndexOf('/'), u.lastIndexOf('\\'));
  let name: string = slash >= 0 ? u.substring(slash + 1) : u;
  const q: number = name.indexOf('?');
  if (q >= 0) { name = name.substring(0, q); }
  const h: number = name.indexOf('#');
  if (h >= 0) { name = name.substring(0, h); }
  if (pluginInstallFilenameIsValid(name)) { return name; }
  const fb: string = isPresent(fallback) ? fallback.trim() : '';
  return pluginInstallFilenameIsValid(fb) ? fb : 'plugin.zip';
}

/** 安装结果（`ok` 以**服务端返回的插件 id** 为准 —— 有 id 才算装上）。 */
export class PluginInstallResult {
  id: string = '';
  dir: string = '';
  constructor(id: string, dir: string) {
    this.id = id;
    this.dir = dir;
  }

  /** 服务端是否确认安装成功。 */
  ok(): boolean {
    return this.id.length > 0;
  }
}

/**
 * 解析安装响应（`XbotHttp.uploadBytes` 已剥信封 ⇒ 入参即 `data` 的 JSON 串）。
 * 全容错：空串 / 坏 JSON / `null` / 缺 `id` ⇒ `PluginInstallResult('','')`
 * （调用方据此报错，⛔ 绝不静默当成功）。
 */
export function parsePluginInstallResult(metaJson: string): PluginInstallResult {
  try {
    const raw: string = isPresent(metaJson) ? metaJson : '';
    if (raw.length === 0) {
      return new PluginInstallResult('', '');
    }
    const obj: Record<string, string> = JSON.parse(raw) as Record<string, string>;
    if (obj === null || obj === undefined) {
      return new PluginInstallResult('', '');
    }
    const id: string = typeof obj.id === 'string' ? obj.id.trim() : '';
    const dir: string = typeof obj.dir === 'string' ? obj.dir.trim() : '';
    return new PluginInstallResult(id, dir);
  } catch (e) {
    return new PluginInstallResult('', '');
  }
}

/** 安装成功提示（含插件 id）。 */
export function pluginInstallSuccessText(id: string): string {
  const i: string = isPresent(id) ? id.trim() : '';
  return i.length > 0 ? `已安装插件 ${i}（已按服务端值刷新）` : '插件已安装（已按服务端值刷新）';
}

/**
 * 安装失败文案（可读）。HTTP 码语义**逐条对齐 `web_api.go` 的真实分支**（⛔ 不凭空加码）：
 *   · 401 `:573-576` 未登录/会话失效；403 `:577-580` 非管理员；400 `:582-591` multipart 非法 /
 *     缺 `file` 字段 / 超 32 MiB；500 `:594-619` 临时文件或 RPC `plugin_install_file` 失败
 *     （zip 内缺 `plugin.json` / 清单非法）；503 `:564-567` RPC 未配置（服务端未启用插件系统）。
 */
export function pluginInstallErrorText(status: number, reason: string): string {
  const r: string = isPresent(reason) ? reason.trim() : '';
  const c: number = typeof status === 'number' && isFinite(status) && status !== 0 ? status : 0;
  let hint: string = '';
  if (c === 401) {
    hint = '未登录或会话已失效';
  } else if (c === 403) {
    hint = '需要管理员权限（插件安装会执行插件代码）';
  } else if (c === 400) {
    hint = '上传被拒（multipart 非法 / 缺 file 字段 / 超过 32 MiB）';
  } else if (c === 500) {
    hint = '服务端安装失败（zip 内缺 plugin.json 或清单非法）';
  } else if (c === 503) {
    hint = '服务端未启用插件系统';
  }
  const head: string = '插件安装失败';
  if (hint.length > 0 && r.length > 0) { return `${head}：${hint}（${r}）`; }
  if (hint.length > 0) { return `${head}：${hint}`; }
  return r.length > 0 ? `${head}：${r}` : head;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 后端插件**全量**（`plugin_status`）—— `components/SettingsPlugins.ets` 只消费
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么需要（波12 差集 P1-b，本波新增）：本仓此前**只**通过两条口看插件 ——
//   · `web_plugin_list`：**有 web 产物**的插件（`core/store.ets:1042`）；
//   · `plugin_config`：**带配置声明**的插件（`rpc_table.go:2370-2453`）。
// ⇒ **纯后端插件**（script/grpc 运行时 / 无 web 产物 / 无 config）在原生端**完全不可见**，
//   用户也**管不了**（看不到 ⇒ 无从启停/重载）。这不是"没做"，是**没有第三只眼**。
// 权威基准：web `plugins/manager/PluginManagerPanel.tsx:52-76` —— 它用 `plugin_status {rescan:true}`
//   列**后端 Go 插件系统全量**（文件头注释原文：`pm.ListPlugins()`；script/grpc runtime）。
// 服务端契约（只读核实 `serverapp/rpc_table.go:2011-2053`）：
//   · params `{rescan:bool}`；`rescan:true` ⇒ `Discover()` + `ActivateAll()`（**只激活新发现的**；
//     注释明言**不用** `ReloadAll` —— `DeactivateAll` 可能超时 30s ⇒ 会阻塞几十秒）；激活失败只记日志、不阻断；
//   · 返回 `{plugins:[{id,name,version,state,runtime}], active:int, total:int}`；
//   · 插件系统不可用 ⇒ RPC 报错 `plugin system not available`（`:2015-2017`）⇒ 调用方**可读化**展示。
//   ⛔ 启停/重载**复用既有** RPC（`plugin_set_enabled` `:2213-2233` / `plugin_reload` `:2099-2133`）
//      —— 本节**不新增**任何服务端交互、不发新方法。

/** `plugin_status` 响应里的单条（服务端 `pluginJSON`，`rpc_table.go:2031-2037`）。 */
interface PluginStatusEntryWire {
  id?: string;
  name?: string;
  version?: string;
  state?: string;
  runtime?: string;
}

/** `plugin_status` 响应整体。 */
interface PluginStatusWire {
  plugins?: PluginStatusEntryWire[];
  active?: number;
  total?: number;
}

/** `plugin_status` 的一条（视图模型）。 */
export class PluginStatusEntry {
  id: string = '';
  name: string = '';
  version: string = '';
  /** 服务端 `state`（`active`/`error`/…）—— **仅展示 + 决定开关初始态**，不做任何门控。 */
  state: string = '';
  /** 运行时（`script`/`grpc`/…）—— 纯后端插件才有的信息（`web_plugin_list` 里看不到）。 */
  runtime: string = '';

  constructor(id: string, name: string, version: string, state: string, runtime: string) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.state = state;
    this.runtime = runtime;
  }
}

/** `plugin_status` 的整体视图。 */
export class PluginStatusList {
  entries: PluginStatusEntry[] = [];
  /** 服务端 `active`（启用数）。 */
  active: number = 0;
  /** 服务端 `total`（总数）。 */
  total: number = 0;
}

/**
 * `state` 是否"已启用"（开关初始态）。
 * ⛔ 不 import `core/pluginview.ets:PLUGIN_STATE_ACTIVE`：本模块与 pluginview 无既有依赖，
 *    为一个字面量引依赖会把"纯逻辑模块"的图变复杂；此处逐字对齐该常量值（`'active'`）。
 */
export function pluginStatusIsActive(state: string): boolean {
  return isPresent(state) && state.trim() === 'active';
}

/**
 * `plugin_status` 响应 → 视图模型（**全容错**：null / 缺字段 / 坏数组都不炸）。
 * · 无 `id` 的条目**跳过**（没有 id 就启停/重载不了 ⇒ 宁可不显示，也不做一个点了报错的控件）；
 * · `name` 空 ⇒ 回落 `id`（⛔ 不画空标题）；`active`/`total` 非有限 ⇒ 用条目数兜底。
 */
/** `web_plugin_list` 的单条（只取解析文本要用的 `i18n` 表；见 `core/rpc.ets:RPC_WEB_PLUGIN_LIST`）。 */
interface WebPluginDeclWire {
  id?: string;
  i18n?: Record<string, Record<string, string>>;
}

/** `web_plugin_list` 响应整体。 */
interface WebPluginDeclListWire {
  plugins?: WebPluginDeclWire[];
}

/**
 * 抽 `pluginId → i18n 表`（web `PluginManagerPanel.tsx:66-70` 同款）。
 *
 * ⛔ 为什么必须拉这张表：服务端 `plugin_status` 的 `name` **原样是 i18n key**
 * （实测 `name:"manifest.name"`，2026-10-13 现场取证）——不解析就会在设置里直接显示
 * `manifest.name`（用户报「插件都打不开」时看到的正是它）。
 */
export function parsePluginI18nTables(
  raw: Object | null | undefined,
): Map<string, Record<string, Record<string, string>>> {
  const out: Map<string, Record<string, Record<string, string>>> = new Map();
  if (!isPresent(raw)) {
    return out;
  }
  const wire: WebPluginDeclListWire = raw as WebPluginDeclListWire;
  const list: WebPluginDeclWire[] = arrOrEmpty(wire.plugins);
  for (let i = 0; i < list.length; i++) {
    const d: WebPluginDeclWire | undefined = list[i];
    if (!isPresent(d)) {
      continue;
    }
    const id: string = isPresent(d.id) ? d.id.trim() : '';
    if (id.length === 0 || !isPresent(d.i18n)) {
      continue;
    }
    out.set(id, d.i18n as Record<string, Record<string, string>>);
  }
  return out;
}

/**
 * `key` 形状判据：形如 `manifest.name` / `view.badge.title` 的**点分小写标识**。
 * 用来区分"**没解析出来的 i18n key**"与"真的就叫这个名字"（人名/产品名极少长这样）。
 * ⛔ 含空格或大写开头 ⇒ 判为**自然文本**（如 `Ambience`、`Git Fancy`）。
 */
export function looksLikeI18nKey(s: string): boolean {
  const t: string = isPresent(s) ? s.trim() : '';
  if (t.length === 0 || t.indexOf(' ') >= 0 || t.indexOf('（') >= 0) {
    return false;
  }
  const dot: number = t.indexOf('.');
  if (dot <= 0 || dot >= t.length - 1) {
    return false;
  }
  for (let i = 0; i < t.length; i++) {
    const c: string = t.charAt(i);
    const ok: boolean = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-';
    if (!ok) {
      return false;
    }
  }
  return true;
}

/**
 * `plugin_status` 响应 → 视图模型（**全容错**：null / 缺字段 / 坏数组都不炸）。
 * · 无 `id` 的条目**跳过**（没有 id 就启停/重载不了 ⇒ 宁可不显示，也不做一个点了报错的控件）；
 * · `name` 是 **i18n key** ⇒ 用该插件的 `i18n` 表解析；解析不出来（表缺失/未命中）⇒ **回落 `id`**
 *   （⛔ 绝不把 `manifest.name` 当显示名——web 权威 `PluginManagerPanel.tsx:226` 的同一语义）；
 * · `active`/`total` 非有限 ⇒ 用条目数兜底。
 *
 * @param tables `web_plugin_list` 抽出的 `pluginId → i18n 表`（缺省 `{}` ⇒ 全部回落 id）
 * @param locale 语言（`zh-CN` 等；缺省空串 ⇒ 解析器走"任意语言"兜底链）
 */
export function parsePluginStatus(
  raw: Object | null | undefined,
  tables?: Map<string, Record<string, Record<string, string>>>,
  locale?: string,
): PluginStatusList {
  const out: PluginStatusList = new PluginStatusList();
  if (!isPresent(raw)) {
    return out;
  }
  const wire: PluginStatusWire = raw as PluginStatusWire;
  const list: PluginStatusEntryWire[] = arrOrEmpty(wire.plugins);
  const loc: string = locale !== undefined ? locale : '';
  const tbl: Map<string, Record<string, Record<string, string>>> = tables !== undefined ? tables : new Map();
  for (let i = 0; i < list.length; i++) {
    const e: PluginStatusEntryWire | undefined = list[i];
    if (!isPresent(e)) {
      continue;
    }
    const id: string = isPresent(e.id) ? e.id.trim() : '';
    if (id.length === 0) {
      continue;
    }
    const rawName: string = isPresent(e.name) ? e.name.trim() : '';
    // ① 先按 i18n 表解析（命中 ⇒ 译文；非 key 或没有表 ⇒ 原样返回）
    let name: string = resolvePluginText(tbl.get(id), rawName, loc);
    // ② 仍是"没解析出来的 key"（或压根没名字）⇒ 回落 id，绝不把 manifest.name 当显示名
    if (name.length === 0 || looksLikeI18nKey(name)) {
      name = id;
    }
    out.entries.push(new PluginStatusEntry(
      id, name,
      isPresent(e.version) ? e.version : '',
      isPresent(e.state) ? e.state : '',
      isPresent(e.runtime) ? e.runtime : ''));
  }
  const a: number = typeof wire.active === 'number' && isFinite(wire.active) ? wire.active : -1;
  const t: number = typeof wire.total === 'number' && isFinite(wire.total) ? wire.total : -1;
  out.active = a >= 0 ? a : out.entries.length;
  out.total = t >= 0 ? t : out.entries.length;
  return out;
}

/** 概览文案（`全部插件（启用 M / 共 N）`）—— 与 `pluginCatalogSummaryText` 同风格。 */
export function pluginStatusSummaryText(active: number, total: number): string {
  const a: number = typeof active === 'number' && isFinite(active) && active > 0 ? active : 0;
  const t: number = typeof total === 'number' && isFinite(total) && total > 0 ? total : 0;
  return `全部插件（启用 ${a} / 共 ${t}）`;
}

/** 行内元信息（`v<版本> · <runtime> · <state>`；空段自动省略，全空 ⇒ 空串，调用方不画）。 */
/** 状态的中文标签（服务端 `state` 是英文枚举：`active`/`error`/…；直译对用户无意义）。 */
export function pluginStateLabel(state: string): string {
  const s: string = isPresent(state) ? state.trim() : '';
  if (s === 'active') {
    return '已启用';
  }
  if (s === 'error') {
    // 实测失败原因（后端原文）：`activation failed: start plugin process: fork/exec ./bin/<x>-plugin:
    // no such file or directory` ⇒ 多半缺 sidecar 二进制；开关时会由 `readableRpcError` 给出全文。
    return '启动失败';
  }
  if (s === 'disabled') {
    return '已停用';
  }
  if (s === 'loading') {
    return '加载中';
  }
  return s;
}

export function pluginStatusMetaText(e: PluginStatusEntry): string {
  const parts: string[] = [];
  if (isPresent(e.version) && e.version.length > 0) { parts.push(`v${e.version}`); }
  if (isPresent(e.runtime) && e.runtime.length > 0) { parts.push(e.runtime); }
  if (isPresent(e.state) && e.state.length > 0) { parts.push(pluginStateLabel(e.state)); }
  return parts.join(' · ');
}
