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
  return kind === PLUGIN_FIELD_BOOLEAN || kind === PLUGIN_FIELD_STRING
    || kind === PLUGIN_FIELD_NUMBER || kind === PLUGIN_FIELD_SELECT
    || kind === PLUGIN_FIELD_MULTISELECT;
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
export function maskedSecret(s: string): string {
  if (s.length === 0) {
    return '';
  }
  if (s.length <= 4) {
    return '****';
  }
  return `${s.substring(0, 2)}****`;
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
    return '（不支持的类型）';
  }
  return prop.secret ? maskedSecret(v.s) : v.s;
}

/** 文本输入框的初值（boolean/multiselect 不用文本框 ⇒ 给空串）。 */
export function textInputValue(prop: PluginConfigProperty, v: ConfigValue): string {
  if (prop.kind === PLUGIN_FIELD_NUMBER) {
    return `${v.n}`;
  }
  if (prop.kind === PLUGIN_FIELD_STRING || prop.kind === PLUGIN_FIELD_SELECT
    || prop.kind === PLUGIN_FIELD_IMAGE) {
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

/**
 * 该 number 字段是否该用**滑条**（对齐 web `SettingsPlugins.tsx:410-415` 的 `hasRange`）：
 * 声明了 `min` **且**声明了 `max` **且** `max > min` ⇒ 用滑条；否则用文本框。
 * ⛔ 判据与渲染同源（组件**不得**自己写这段判断）。
 */
export function pluginFieldHasRange(p: PluginConfigProperty): boolean {
  return p.hasMin === true && p.hasMax === true && p.max > p.min;
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
