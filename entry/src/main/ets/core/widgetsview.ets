/**
 * widgetsview.ets —— 插件 widget 的**纯视图模型**（`WidgetSnapshot`/原始载荷 → 可渲染视图）。
 *
 * 权威基准（web）：
 *   · `web/src/plugins/PluginWidgetProvider.tsx:63-74` —— 载荷 `{zones?, components?, revision?}`；
 *   · `web/src/plugins/WidgetZone.tsx:14-23,38-69` —— zone = `WebWidgetSpan[]`，
 *     span = `{text, style?, icon?, href?}`，style ∈ normal|dim|accent|success|warning|error|info|muted；
 *   · `web/src/plugins/components.tsx:236-259` —— 声明式组件 `renderDeclarativeComponent`，
 *     真有的类型：badge|progress|metric|sparkline|table|list|markdown；**未知类型 ⇒ 降级为文本徽标**；
 *   · `web/src/plugins/PluginComponentPanel.tsx:60-97` —— `component vs code vs src` 三分支
 *     （code/src 走 `SandboxedUI` iframe）。
 *   · 服务端：`plugin/web_widget.go:12-37,81-116`（zone 名单 / `WebWidgetSpan` / `WebUIComponent`；
 *     `validWebSlots` 见 `:87-96`）。
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒ 禁止 import ArkUI / `@ohos.*`。
 * ⛔ 判据与渲染同源：**所有**"该不该显示 / 怎么降级 / 用什么色"的判断都在这里；组件只画。
 * ⛔ **绝不静默**：坏载荷、未知类型、原生未实现的类型 ⇒ 一律产出**可见的降级视图 + reason**
 *    （对齐 `core/panels.ets` 的 `ok/reason` 契约）。
 */
import { arrOrEmpty } from './guards';
import { parseWidgetsPayload, WidgetSnapshot } from './panels';

// ── 事件名（复用 core/types.ets:236-237 的常量值，不另造字面量；此处只需字符串）──────────
/** 服务端推的两种 widget 事件（载荷同形）。 */
export const WIDGET_EVENT_WEB: string = 'web_widgets';
export const WIDGET_EVENT_PLUGIN: string = 'plugin_widgets';

/**
 * **渲染层已支持**（本轮新增）。
 *
 * ⛔ 与 `core/panels.ets:WIDGETS_RENDERABLE=false` 的关系（**必须一起改，否则自相矛盾**）：
 *   · `panels.WIDGETS_RENDERABLE` 的语义是"**原生有没有组件消费 zones/components**"，
 *     由 `widgets_parse.test.ts:74` 钉死为 `false`（当时的诚实状态：解析在、UI 缺）；
 *   · 本轮补上了 `components/PluginWidgets.ets` ⇒ 该状态**已变**，此常量表达"已支持"。
 *   ⚠️ 翻转 `WIDGETS_RENDERABLE` 需**其主**（`core/panels.ets` 有 owner）在同一提交里
 *      同步改 `widgets_parse.test.ts:74` —— 本模块**不改** panels（只在此声明事实）。
 */
export const WIDGETS_VIEW_SUPPORTED: boolean = true;

// ── 组件形态档（**判据**：组件据此选渲染分支；测试据此断言"未知 ⇒ 降级"）────────────────
export const KIND_BADGE: string = 'badge';
export const KIND_PROGRESS: string = 'progress';
export const KIND_METRIC: string = 'metric';
export const KIND_LIST: string = 'list';
export const KIND_MARKDOWN: string = 'markdown';
/** 降级档：可见占位 + `reason`（web **有**但我们没实现 / 未知 / code-src 沙箱）。 */
export const KIND_UNSUPPORTED: string = 'unsupported';

/** 原生**已实现**的声明式组件类型（= web `components.tsx` 的子集）。 */
export const SUPPORTED_KINDS: string[] = [KIND_BADGE, KIND_PROGRESS, KIND_METRIC, KIND_LIST, KIND_MARKDOWN];

// ── 原始载荷形状（web `types/shared.ts:700-722`）─────────────────────────────────
export interface RawWidgetSpan {
  text?: string;
  style?: string;
  icon?: string;
  href?: string;
}

export interface RawWidgetComponent {
  type?: string;
  props?: Record<string, Object>;
}

export interface RawWidgetDecl {
  widget_id?: string;
  title?: string;
  slot?: string;
  component?: RawWidgetComponent;
  code?: string;
  src?: string;
}

export interface RawWidgetPayload {
  zones?: Record<string, RawWidgetSpan[]>;
  components?: RawWidgetDecl[];
  revision?: number;
}

// ── 视图模型（class 而非 interface：ArkTS 禁空对象字面量；也便于就地填充）────────────────
/** 一个 styled span 的视图（`colorRole` 交给组件用 `colorOf(pal, role)` 取色）。 */
export class WidgetSpanView {
  text: string = '';
  style: string = 'normal';
  /** 语义色角色名（`core/design.ets:colorOf` 的入参；组件不得自己挑色）。 */
  colorRole: string = 'textPrimary';
  href: string = '';
}

/** 一个 zone（分区）的视图。 */
export class WidgetZoneView {
  /** 原始 zone 名（`titleBarLeft` … `toolHint`）。 */
  name: string = '';
  /** 显示名（人类可读；未知名回落原名）。 */
  label: string = '';
  spans: WidgetSpanView[] = [];
}

/** list 组件的一条（web `ListWidget` 的 `item`）。 */
export class WidgetItemView {
  key: string = '';
  value: string = '';
  tone: string = 'normal';
}

/** 一个声明式组件的视图（由 `kind` 决定用哪些字段；未用到的保持缺省）。 */
export class WidgetComponentView {
  widgetId: string = '';
  title: string = '';
  slot: string = '';
  /** 形态档：`KIND_*`（`unsupported` = 降级）。 */
  kind: string = '';
  /** 降级原因（`kind === unsupported` 时**恒非空**；其余为空串）。 */
  reason: string = '';
  /** 该组件按当前 props **渲染不出来**（如空 markdown）—— 不计入"可见内容"。 */
  empty: boolean = false;
  // badge
  badgeText: string = '';
  tone: string = 'normal';
  // progress
  progressValue: number = 0;
  progressMax: number = 100;
  progressLabel: string = '';
  showValue: boolean = true;
  // metric
  metricLabel: string = '';
  metricValue: string = '';
  metricDelta: string = '';
  // list
  listTitle: string = '';
  listItems: WidgetItemView[] = [];
  // markdown
  markdownText: string = '';
}

/** 整份 widget 载荷的视图模型。 */
export class WidgetsView {
  /** 载荷解析是否成功（复用 `core/panels.parseWidgetsPayload` 的唯一判据）。 */
  ok: boolean = false;
  /** 失败/降级原因（`ok === false` 时**恒非空**）。 */
  reason: string = '';
  /** 服务端单调修订号（缺省 -1）。 */
  revision: number = -1;
  /** 有内容的分区（空分区已剔除）。 */
  zones: WidgetZoneView[] = [];
  /** 组件（含降级占位）。 */
  components: WidgetComponentView[] = [];
  /** 是否应渲染（**空载荷 ⇒ false**：不产出空壳）。 */
  visible: boolean = false;
}

// ── 取值强制（props 来自插件 JSON，防御式强制，对齐 web `components.tsx:29-35`）──────────
function asStr(v: Object | undefined, dflt: string): string {
  return typeof v === 'string' ? v : dflt;
}

function asNum(v: Object | undefined, dflt: number): number {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : dflt;
  }
  if (typeof v === 'string') {
    const n: number = Number.parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  }
  return dflt;
}

function asBool(v: Object | undefined, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

// ── 纯映射表（**判据集中、可遍历**）──────────────────────────────────────────────
/**
 * zone 名 → 显示名（服务端 `plugin/web_widget.go:33` 的 7 个 zone 名单）。
 * 未知名回落原名（绝不丢弃 —— 服务端新增 zone 也要显示出来）。
 */
export function widgetZoneLabel(name: string): string {
  if (name === 'titleBarLeft') { return '标题左'; }
  if (name === 'titleBarRight') { return '标题右'; }
  if (name === 'statusBarLeft') { return '状态左'; }
  if (name === 'statusBarRight') { return '状态右'; }
  if (name === 'infoBar') { return '信息条'; }
  if (name === 'footer') { return '页脚'; }
  if (name === 'toolHint') { return '工具提示'; }
  return name;
}

/**
 * span 的 `style` → 语义色角色（对齐 web `WidgetZone.tsx:14-23` 的 StyleClass→Tailwind 表）。
 * 未知/缺省 ⇒ `normal`（= `textPrimary`），绝不置透明（免得"服务端推了却看不见"）。
 */
export function styleColorRole(style: string): string {
  if (style === 'dim' || style === 'muted') { return 'textMuted'; }
  if (style === 'accent' || style === 'info') { return 'accentSoft'; }
  if (style === 'success') { return 'successText'; }
  if (style === 'warning') { return 'statusWaiting'; }
  if (style === 'error') { return 'dangerText'; }
  return 'textPrimary';   // normal / 空串 / 未知
}

/** 组件的 `tone` → 语义色角色（对齐 web `components.tsx:16-24` 的 TONES 文字色）。 */
export function toneColorRole(tone: string): string {
  if (tone === 'success') { return 'successText'; }
  if (tone === 'warning') { return 'statusWaiting'; }
  if (tone === 'error') { return 'dangerText'; }
  if (tone === 'info' || tone === 'accent') { return 'accentSoft'; }
  if (tone === 'muted') { return 'textMuted'; }
  return 'textPrimary';   // normal / 空串 / 未知
}

/** 该声明式类型原生是否实现。 */
export function isSupportedKind(type: string): boolean {
  for (let i = 0; i < SUPPORTED_KINDS.length; i++) {
    if (SUPPORTED_KINDS[i] === type) { return true; }
  }
  return false;
}

/**
 * 降级原因（**恒非空**）—— web 有但我们没实现 / 未知类型 / 缺 type。
 * ⛔ 不与"未知类型"混为一谈：`sparkline`/`table` 是 **web 真有的类型**，原因是"原生未实现"。
 */
export function degradeReasonForType(type: string): string {
  if (type === 'sparkline') {
    return '原生暂未实现 sparkline（web 用 SVG 折线/柱）';
  }
  if (type === 'table') {
    return '原生暂未实现 table（web 用可点表格 + web_ui_action RPC）';
  }
  if (type.length === 0) {
    return '组件声明缺少 component.type';
  }
  return `未知组件类型 '${type}'（web 降级为文本徽标）`;
}

// ── 视图构建 ─────────────────────────────────────────────────────────────────
function spanViewOf(raw: RawWidgetSpan): WidgetSpanView {
  const v: WidgetSpanView = new WidgetSpanView();
  v.text = asStr(raw.text, '');
  v.style = asStr(raw.style, 'normal');
  v.colorRole = styleColorRole(v.style);
  v.href = asStr(raw.href, '');
  return v;
}

function zoneViewOf(name: string, spansRaw: RawWidgetSpan[] | undefined): WidgetZoneView {
  const z: WidgetZoneView = new WidgetZoneView();
  z.name = name;
  z.label = widgetZoneLabel(name);
  const spans: RawWidgetSpan[] = arrOrEmpty(spansRaw);
  for (let i = 0; i < spans.length; i++) {
    const s: RawWidgetSpan | null | undefined = spans[i];
    if (s !== undefined && s !== null) {
      z.spans.push(spanViewOf(s));
    }
  }
  return z;
}

function listItemsOf(props: Record<string, Object> | undefined): WidgetItemView[] {
  const out: WidgetItemView[] = [];
  if (props === undefined) { return out; }
  const raw: Object | undefined = props['items'];
  if (!Array.isArray(raw)) { return out; }
  const items: Object[] = raw as Object[];
  for (let i = 0; i < items.length; i++) {
    const it: Record<string, Object> | undefined = items[i] as Record<string, Object> | undefined;
    if (it === undefined || it === null) { continue; }
    const v: WidgetItemView = new WidgetItemView();
    v.key = asStr(it['key'], `item-${i}`);
    v.value = asStr(it['value'], '');
    v.tone = asStr(it['tone'], 'normal');
    out.push(v);
  }
  return out;
}

function componentViewOf(decl: RawWidgetDecl): WidgetComponentView {
  const v: WidgetComponentView = new WidgetComponentView();
  v.widgetId = asStr(decl.widget_id, '');
  v.title = asStr(decl.title, '');
  v.slot = asStr(decl.slot, '');
  // web `PluginComponentPanel.tsx:72-87`：code / src 走 iframe 沙箱（原生无对应能力）。
  const code: string = asStr(decl.code, '');
  const src: string = asStr(decl.src, '');
  if (code.length > 0) {
    v.kind = KIND_UNSUPPORTED;
    v.reason = 'code 模式需 iframe 沙箱（web `SandboxedUI`），原生不支持';
    return v;
  }
  if (src.length > 0) {
    v.kind = KIND_UNSUPPORTED;
    v.reason = 'src 模式需外部沙箱 iframe（web `SandboxedUI`），原生不支持';
    return v;
  }
  const comp: RawWidgetComponent | undefined = decl.component;
  if (comp === undefined || comp === null) {
    v.kind = KIND_UNSUPPORTED;
    v.reason = '组件声明缺少 component/code/src（web 也不渲染内容）';
    return v;
  }
  const type: string = asStr(comp.type, '');
  if (!isSupportedKind(type)) {
    // ⛔ 未知 / 未实现 ⇒ **显式降级**（可见占位 + reason），绝不静默丢、绝不崩。
    v.kind = KIND_UNSUPPORTED;
    v.reason = degradeReasonForType(type);
    return v;
  }
  v.kind = type;
  const props: Record<string, Object> | undefined = comp.props;
  if (type === KIND_BADGE) {
    v.badgeText = props !== undefined ? asStr(props['text'], '') : '';
    v.tone = props !== undefined ? asStr(props['tone'], 'normal') : 'normal';
  } else if (type === KIND_PROGRESS) {
    v.progressValue = props !== undefined ? asNum(props['value'], 0) : 0;
    v.progressMax = props !== undefined ? asNum(props['max'], 100) : 100;
    v.progressLabel = props !== undefined ? asStr(props['label'], '') : '';
    v.showValue = props !== undefined ? asBool(props['show_value'], true) : true;
  } else if (type === KIND_METRIC) {
    v.metricLabel = props !== undefined ? asStr(props['label'], '') : '';
    v.metricValue = props !== undefined ? asStr(props['value'], '') : '';
    v.metricDelta = props !== undefined ? asStr(props['delta'], '') : '';
  } else if (type === KIND_LIST) {
    v.listTitle = props !== undefined ? asStr(props['title'], '') : '';
    v.listItems = listItemsOf(props);
  } else if (type === KIND_MARKDOWN) {
    v.markdownText = props !== undefined ? asStr(props['content'], '') : '';
    // web `components.tsx:220-222`：`content` 为空 ⇒ `return null`（不产出节点）⇒ 标 empty。
    v.empty = v.markdownText.length === 0;
  }
  return v;
}

/** 是否有"渲染得出来"的组件（降级占位算，空 markdown 不算）。 */
function hasRenderableComponent(comps: WidgetComponentView[]): boolean {
  for (let i = 0; i < comps.length; i++) {
    if (!comps[i].empty) { return true; }
  }
  return false;
}

/**
 * 载荷 → 视图模型（**唯一入口**）。
 *
 * @param event   事件名（`WIDGET_EVENT_WEB` / `WIDGET_EVENT_PLUGIN`；复用 `parseWidgetsPayload` 判据）。
 * @param content 原始载荷 JSON（`{zones?, components?, revision?}`）。
 *
 * 可见性判据（**空壳不渲染**）：
 *   · 无载荷（`content` 空）⇒ `visible=false`（页面还没收到任何推送，不产空壳）；
 *   · 有载荷但解析失败 ⇒ `visible=true` + `reason`（**绝不静默**：显式降级行）；
 *   · 合法载荷但 zones 全空且无可渲染组件 ⇒ `visible=false`（不产空壳）；
 *   · 否则 ⇒ `visible=true`。
 */
export function widgetsView(event: string, content: string): WidgetsView {
  const out: WidgetsView = new WidgetsView();
  const snap: WidgetSnapshot = parseWidgetsPayload(event, content);
  out.ok = snap.ok;
  out.revision = snap.revision;
  if (!snap.ok) {
    out.reason = snap.reason;
    // 空载荷（页面还没收到推送）⇒ 不产空壳；非空但坏 ⇒ 显式降级行。
    out.visible = content.length > 0;
    return out;
  }
  let payload: RawWidgetPayload | null = null;
  try {
    payload = JSON.parse(content) as RawWidgetPayload;
  } catch (e) {
    payload = null;
  }
  if (payload === null) {
    out.ok = false;
    out.reason = '载荷为 null';
    out.visible = content.length > 0;
    return out;
  }
  const zonesRaw: Record<string, RawWidgetSpan[]> | undefined = payload.zones;
  if (zonesRaw !== undefined && zonesRaw !== null) {
    for (let i = 0; i < snap.zoneKeys.length; i++) {
      const name: string = snap.zoneKeys[i];
      const zv: WidgetZoneView = zoneViewOf(name, zonesRaw[name]);
      if (zv.spans.length > 0) {   // 空分区剔除（不产空行）
        out.zones.push(zv);
      }
    }
  }
  const comps: RawWidgetDecl[] = arrOrEmpty(payload.components);
  for (let i = 0; i < comps.length; i++) {
    const d: RawWidgetDecl | null | undefined = comps[i];
    if (d !== undefined && d !== null) {
      out.components.push(componentViewOf(d));
    }
  }
  out.visible = out.zones.length > 0 || hasRenderableComponent(out.components);
  return out;
}
