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
export const KIND_SPARKLINE: string = 'sparkline';
export const KIND_TABLE: string = 'table';
export const KIND_LIST: string = 'list';
export const KIND_MARKDOWN: string = 'markdown';
/** 降级档：可见占位 + `reason`（未知 / code-src 沙箱）。 */
export const KIND_UNSUPPORTED: string = 'unsupported';

/**
 * 原生**已实现**的声明式组件类型（= web `components.tsx:236-259` 的**全部 7 种**）。
 * ⚠️ 2026-10-11 补齐 `sparkline`/`table` ⇒ 与 web 的 7 种**一一对应**（不再有"web 有而原生没有"的档）。
 */
export const SUPPORTED_KINDS: string[] = [
  KIND_BADGE, KIND_PROGRESS, KIND_METRIC, KIND_SPARKLINE, KIND_TABLE, KIND_LIST, KIND_MARKDOWN,
];

// ── sparkline / table 的**几何与阈值常量**（逐字对齐 web `components.tsx`，非设计 token）──────
//
// ⛔ 这些是**数据可视化几何**（画布坐标系里的偏移），不是 UI 尺寸 token ⇒ 不进 `core/design.ets`。
//    集中命名以免组件里出现魔法数字（判据与渲染同源：几何全在 core 算好，组件只 `points()`/`.height()`）。
//
/** 归一坐标系宽（web `components.tsx:105 const w = 100`）——组件用 `Shape.viewPort` 等比缩放到实宽。 */
export const SPARK_VIEW_W: number = 100;
/** 画布高缺省（web `components.tsx:102 num(props.height,48)`）。 */
export const SPARK_DEFAULT_HEIGHT: number = 48;
/** 画布高下限 / 上限（web `Math.max(16, Math.min(200, …))`）。 */
export const SPARK_MIN_HEIGHT: number = 16;
export const SPARK_MAX_HEIGHT: number = 200;
/** 折线顶留白（web `height - 4 - …`）。 */
export const SPARK_LINE_INSET_TOP: number = 4;
/** 折线值域（web `* (height - 10)`）——与顶留白一起构成 `[4, height-6]` 的绘制带。 */
export const SPARK_LINE_RANGE: number = 10;
/** 面积多边形底线（web `${height-2}`）。 */
export const SPARK_AREA_BASELINE: number = 2;
/** 柱值域（web `(v/max) * (height - 8)`）。 */
export const SPARK_BAR_RANGE: number = 8;
/** 表体最大高的缺省 / 下限（web `Math.max(60, num(props.max_height,260))`）。 */
export const TABLE_DEFAULT_MAX_HEIGHT: number = 260;
export const TABLE_MIN_MAX_HEIGHT: number = 60;
/**
 * sparkline **空数据**文案（web `components.tsx:106` 渲染一行 `no data`；本仓按中文 UI 落地）。
 * ⛔ 这是**可见内容**（web 也产出节点）⇒ 不标 `empty`（见 `componentViewOf`）。
 */
export const SPARK_EMPTY_LABEL: string = '无数据';

/**
 * sparkline 画布高（web `components.tsx:102`：`Math.max(16, Math.min(200, num(props.height,48)))`）。
 * 非有限 / 非数 ⇒ 缺省 48（`asNum` 判据），再夹取到 `[16,200]`。
 */
export function sparkHeightOf(raw: Object | undefined): number {
  const h: number = asNum(raw, SPARK_DEFAULT_HEIGHT);
  if (h < SPARK_MIN_HEIGHT) { return SPARK_MIN_HEIGHT; }
  if (h > SPARK_MAX_HEIGHT) { return SPARK_MAX_HEIGHT; }
  return h;
}

/** 表体最大高（web `components.tsx:141`：`Math.max(60, num(props.max_height,260))`）。 */
export function tableMaxHeightOf(raw: Object | undefined): number {
  const h: number = asNum(raw, TABLE_DEFAULT_MAX_HEIGHT);
  return h < TABLE_MIN_MAX_HEIGHT ? TABLE_MIN_MAX_HEIGHT : h;
}

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

/** table 组件的一个单元格（web `components.tsx:167-180 renderCell`）。 */
export class WidgetCellView {
  /** 显示文本（对象单元取 `text`；原始值走 `String(v)`）。 */
  text: string = '';
  /** 语义色档（web `renderCell` 的 `tone`；非对象单元恒 `normal`）。 */
  tone: string = 'normal';
  /**
   * 是否是**徽标**单元（web：`typeof cell === 'object' && cell !== null` ⇒ 带底色的小 chip）。
   * ⚠️ 原生**不做** web 的单元格点击/`action`（`web_ui_action` RPC 架构性缺，见 `docs/WEB-PARITY.md §XII`）⇒ 只画不点。
   */
  badge: boolean = false;
}

/** table 组件的一行（列数与 `columns` 等长；缺列回落空串，对齐 web `String(cell ?? '')`）。 */
export class WidgetTableRowView {
  cells: WidgetCellView[] = [];
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
  // sparkline
  /** 柱状图（web `props.type === 'bar'`）；否则折线。 */
  sparkBar: boolean = false;
  /** 画布高（vp，已夹取到 `[16,200]`，缺省 48）。 */
  sparkHeight: number = SPARK_DEFAULT_HEIGHT;
  /** 无数据（web `data.length === 0` ⇒ 渲染一行 "no data" 文案）。 */
  sparkEmpty: boolean = false;
  /** 折线顶点（`SPARK_VIEW_W × sparkHeight` 归一坐标系）。 */
  sparkPoints: number[][] = [];
  /** 折线下方的面积多边形顶点（底线 + 折线顶点 + 底线，对齐 web `polygon`）。 */
  sparkArea: number[][] = [];
  /** 柱高（vp；下标与数据一一对应）。 */
  sparkBars: number[] = [];
  // table
  /** 列名（web `columns.map(str)`；空 ⇒ **整表不渲染**，见 `tableColumnsOf`）。 */
  tableColumns: string[] = [];
  /** 数据行（与 `tableColumns` 同宽）。 */
  tableRows: WidgetTableRowView[] = [];
  /** 表体最大高（vp，已夹取到 ≥60，缺省 260）。 */
  tableMaxHeight: number = TABLE_DEFAULT_MAX_HEIGHT;
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
 *
 * ⛔ `warning` 走 **`warn`（"警告文字"角色）**，**不是** `statusWaiting` —— 后者是
 *    **状态指示器/点色**（`theme_contrast.test.ts:315-325` 根因 F）：`light.statusWaiting #E6A700`
 *    压任一浅面只有 1.7–2.12:1，**当正文色读不出**。所有返回值必须是**文字角色**。
 */
export function styleColorRole(style: string): string {
  if (style === 'dim' || style === 'muted') { return 'textMuted'; }
  if (style === 'accent' || style === 'info') { return 'accentSoft'; }
  if (style === 'success') { return 'successText'; }
  if (style === 'warning') { return 'warn'; }   // 文字角色（非 statusWaiting）
  if (style === 'error') { return 'dangerText'; }
  return 'textPrimary';   // normal / 空串 / 未知
}

/**
 * 组件的 `tone` → 语义色角色（对齐 web `components.tsx:16-24` 的 TONES 文字色）。
 * ⛔ 同 `styleColorRole`：`warning` ⇒ **`warn`**（文字角色），不得用 `statusWaiting`（点色）。
 */
export function toneColorRole(tone: string): string {
  if (tone === 'success') { return 'successText'; }
  if (tone === 'warning') { return 'warn'; }   // 文字角色（非 statusWaiting）
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
 * 降级原因（**恒非空**）。
 *
 * ⚠️ **2026-10-11 收口**：`sparkline`/`table` 已落地 ⇒ 此函数**只**覆盖
 *    「缺 `type`」与「web 也不认识的未知类型」两档，不再有"web 有而原生没有"的档。
 */
export function degradeReasonForType(type: string): string {
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

// ── sparkline 几何（web `components.tsx:99-137 SparklineWidget`）────────────────────────
//
// web 在 `viewBox="0 0 100 height"` 的**归一坐标系**里算点（`w = 100`），再靠
// `preserveAspectRatio="none"` 拉到实宽。原生对应：`Shape.viewPort({width:100,height:H})`
// + `Polyline`/`Polygon`（见 `PluginWidgets.ets`）⇒ **这里算的点必须留在 100 宽坐标系**。

/** sparkline 数据序列（web：`Array.isArray(props.data) ? props.data.map(v => num(v,0)) : []`）。 */
export function sparkDataOf(props: Record<string, Object> | undefined): number[] {
  const out: number[] = [];
  if (props === undefined) { return out; }
  const raw: Object | undefined = props['data'];
  if (!Array.isArray(raw)) { return out; }
  const arr: Object[] = raw as Object[];
  for (let i = 0; i < arr.length; i++) {
    out.push(asNum(arr[i], 0));   // 非有限/非数 ⇒ 0（web `num(v,0)`）
  }
  return out;
}

/** 数据最大值（web `Math.max(...data, 1)`：**至少 1** ⇒ 除零安全、全 0 序列也有基线）。 */
export function sparkMaxOf(data: number[]): number {
  let m: number = 1;
  for (let i = 0; i < data.length; i++) {
    const v: number = data[i];
    if (Number.isFinite(v) && v > m) { m = v; }
  }
  return m;
}

/** 折线顶点（web `components.tsx:107`：`x=(i/(n-1))*w`，`y=height-4-(v/max)*(height-10)`）。 */
export function sparkLinePoints(data: number[], height: number): number[][] {
  const pts: number[][] = [];
  const n: number = data.length;
  if (n === 0) { return pts; }
  const max: number = sparkMaxOf(data);
  // ⚠️ web 对 `n === 1` 会 `(i/(n-1))` 除零 ⇒ `NaN`；原生**显式单点居中**（诚实修正，见测试）。
  const denom: number = n > 1 ? (n - 1) : 1;
  for (let i = 0; i < n; i++) {
    const x: number = n > 1 ? (i / denom) * SPARK_VIEW_W : SPARK_VIEW_W / 2;
    const y: number = height - SPARK_LINE_INSET_TOP - (data[i] / max) * (height - SPARK_LINE_RANGE);
    pts.push([x, y]);
  }
  return pts;
}

/** 面积多边形（web `components.tsx:124`：`0,${height-2} ${pts} ${w},${height-2}`）。 */
export function sparkAreaPoints(linePts: number[][], height: number): number[][] {
  const out: number[][] = [];
  if (linePts.length === 0) { return out; }
  out.push([0, height - SPARK_AREA_BASELINE]);
  for (let i = 0; i < linePts.length; i++) {
    out.push(linePts[i]);
  }
  out.push([SPARK_VIEW_W, height - SPARK_AREA_BASELINE]);
  return out;
}

/** 柱高（vp）。web `components.tsx:117-121`：`h = (v/max) * (height - 8)`（`height` 即画布高）。 */
export function sparkBarHeights(data: number[], height: number): number[] {
  const out: number[] = [];
  const max: number = sparkMaxOf(data);
  for (let i = 0; i < data.length; i++) {
    let h: number = (data[i] / max) * (height - SPARK_BAR_RANGE);
    if (!Number.isFinite(h) || h < 0) { h = 0; }   // 负值/NaN 一律 0（负高会反画，web 也不会）
    out.push(h);
  }
  return out;
}

// ── table 解析（web `components.tsx:138-180 TableWidget`）──────────────────────────────

/**
 * 列名（web `components.tsx:139`：`columns.map(c => str(c))` —— **只认字符串**，非字符串 ⇒ 空串）。
 * 空列 ⇒ 调用方判 `empty`（web `:142 if (columns.length === 0) return null`：**整表不渲染**）。
 */
export function tableColumnsOf(props: Record<string, Object> | undefined): string[] {
  const out: string[] = [];
  if (props === undefined) { return out; }
  const raw: Object | undefined = props['columns'];
  if (!Array.isArray(raw)) { return out; }
  const arr: Object[] = raw as Object[];
  for (let i = 0; i < arr.length; i++) {
    out.push(asStr(arr[i], ''));
  }
  return out;
}

/**
 * 一个单元格（web `components.tsx:182-197 renderCell`）：
 *   · 非空**对象** ⇒ 徽标单元（`{text?, tone?}`）；
 *   · 其余（string/number/bool/null/数组）⇒ 纯文本 `String(cell ?? '')`。
 * ⚠️ web 的单元格 `action` 点击走 `web_ui_action` RPC —— **原生架构性缺**（同 `code`/`src` 沙箱），
 *    这里**只取展示字段**，不产生任何交互（诚实：不假装能点）。
 */
export function tableCellOf(cell: Object | null | undefined): WidgetCellView {
  const v: WidgetCellView = new WidgetCellView();
  if (cell !== undefined && cell !== null && typeof cell === 'object' && !Array.isArray(cell)) {
    const o: Record<string, Object> = cell as Record<string, Object>;
    v.badge = true;
    v.text = asStr(o['text'], '');
    v.tone = asStr(o['tone'], 'normal');
    return v;
  }
  v.badge = false;
  v.tone = 'normal';
  v.text = cell === undefined || cell === null ? '' : String(cell);
  return v;
}

/** 数据行（web `:144 rows.map(row => columns.map(c => renderCell(row[c])))`）。 */
export function tableRowsOf(
  props: Record<string, Object> | undefined, columns: string[],
): WidgetTableRowView[] {
  const out: WidgetTableRowView[] = [];
  if (props === undefined || columns.length === 0) { return out; }
  const raw: Object | undefined = props['rows'];
  if (!Array.isArray(raw)) { return out; }
  const rows: Object[] = raw as Object[];
  for (let i = 0; i < rows.length; i++) {
    const rowRaw: Record<string, Object> | undefined = rows[i] as Record<string, Object> | undefined;
    const row: WidgetTableRowView = new WidgetTableRowView();
    for (let c = 0; c < columns.length; c++) {
      const cell: Object | undefined = (rowRaw === undefined || rowRaw === null)
        ? undefined : rowRaw[columns[c]];
      row.cells.push(tableCellOf(cell));
    }
    out.push(row);
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
  } else if (type === KIND_SPARKLINE) {
    const data: number[] = sparkDataOf(props);
    v.sparkBar = props !== undefined ? asStr(props['type'], '') === 'bar' : false;
    v.sparkHeight = sparkHeightOf(props !== undefined ? props['height'] : undefined);
    v.sparkEmpty = data.length === 0;
    if (!v.sparkEmpty) {
      v.sparkPoints = sparkLinePoints(data, v.sparkHeight);
      v.sparkArea = sparkAreaPoints(v.sparkPoints, v.sparkHeight);
      v.sparkBars = sparkBarHeights(data, v.sparkHeight);
    }
    // ⚠️ web `components.tsx:106`：空数据 ⇒ 渲染一行 "no data" 文案（**算可见内容**）。
    v.empty = false;
  } else if (type === KIND_TABLE) {
    v.tableColumns = tableColumnsOf(props);
    v.tableRows = tableRowsOf(props, v.tableColumns);
    v.tableMaxHeight = tableMaxHeightOf(props !== undefined ? props['max_height'] : undefined);
    // web `components.tsx:142`：`columns.length === 0` ⇒ `return null`（整表不渲染）⇒ 标 empty。
    v.empty = v.tableColumns.length === 0;
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

// ─────────────────────────────────────────────────────────────────────────────
// 常驻信息栏（infoBar dock）—— 声明式 widget 在**正常聊天路径**的落点
//
// 权威基准（web）：
//   · `web/src/layouts/MobileAppShell.tsx:483-487` —— 手机端在 `main` **下方**常驻 `<InfoBar/>`
//     （与桌面 `AppShell` 同位：底栏；`MessageInput.test.tsx:206` 印证"输入框不自己留安全区，
//      交给它下面的 InfoBar"）；
//   · `web/src/plugins/InfoBar.tsx:15-27` —— 条内容 = `WidgetZone zone="infoBar"
//     excludePrefixes={['git:']}`（+ SW 更新按钮，原生无对应 ⇒ 不移植）；
//   · `web/src/plugins/WidgetZone.tsx:56-69` —— **显示判据**：`spans.length === 0 ⇒ 渲染 empty`
//     （此处 `empty` 缺省 `null` ⇒ **零节点**）。
//
// ⛔ 与 `PluginWidgets`（插件目录浮层里的全量 widget 卡片）分工：
//   本落点**只**取 `infoBar` 这**一个** zone 的 spans，做成细条常驻；其余 zone / 声明式组件
//   仍由插件目录浮层承载。⛔ **空态零占位**：没有 infoBar 内容时**不产出任何节点**、不占高度
//   （web 是恒占一条 24px —— 原生刻意不跟随，见交付「与 web 的分叉」）。
// ─────────────────────────────────────────────────────────────────────────────

/** 常驻信息栏消费的 zone（web `InfoBar.tsx:24` 的 `zone="infoBar"`）。 */
export const DOCK_ZONE: string = 'infoBar';

/**
 * 常驻信息栏**排除**的 span 前缀（逐字对齐 web `InfoBar.tsx:24` 的 `excludePrefixes={['git:']}`）。
 *
 * 为什么要排除：`git:` 前缀的 span 是 `git-info` 脚本插件的原始数据，web 侧由 fancy 视图
 * （`plugins/git-info/GitStatusPanel.tsx:40-46`，从同一个 `zones['infoBar']` 里解析）渲染成
 * 带图标的徽章组；若信息栏再原样渲染一遍 ⇒ **同一条信息两处出现**（`AppShell.test.tsx:111-112`）。
 * 原生没有该 fancy 视图 ⇒ 排除后这条 git 信息在原生**不显示** —— 诚实跟随 web 的"分工"语义
 * （不假装渲染），而不是把原始 `git:` 文本塞进信息栏（那才是 web 明确排除的东西）。
 */
export const DOCK_EXCLUDE_PREFIXES: string[] = ['git:'];

/** 常驻信息栏的视图（**判据与渲染同源**：由 `widgetsView` 派生，不另解析一次载荷）。 */
export class WidgetDockView {
  /** 是否应渲染 —— **唯一显示判据**；空 ⇒ 调用方**零节点 / 零高度**。 */
  visible: boolean = false;
  /** `infoBar` zone 的 spans（已按 `DOCK_EXCLUDE_PREFIXES` 过滤；顺序保持服务端推送序）。 */
  spans: WidgetSpanView[] = [];
}

/** 该 span 文本是否被排除（web `WidgetZone.tsx:59` 的 `startsWith(p)` 同义）。 */
export function dockSpanExcluded(text: string): boolean {
  for (let i = 0; i < DOCK_EXCLUDE_PREFIXES.length; i++) {
    if (text.startsWith(DOCK_EXCLUDE_PREFIXES[i])) { return true; }
  }
  return false;
}

/**
 * 载荷 → 常驻信息栏视图（**唯一入口**）。
 *
 * ⛔ 判据与渲染同源：**复用** `widgetsView`（同一份解析 / 同一个 `ok`/`reason`/`visible` 判据），
 *    本函数只做"挑出 infoBar 这一个 zone + 过滤排除前缀"的**投影**，绝不第二次解析 JSON。
 * ⛔ 空态零占位：`spans` 为空 ⇒ `visible=false`（含：没收到载荷 / 载荷坏 / infoBar 无 span /
 *    infoBar 只有被排除的 span）。
 */
export function widgetDockView(event: string, content: string): WidgetDockView {
  const out: WidgetDockView = new WidgetDockView();
  const view: WidgetsView = widgetsView(event, content);
  for (let i = 0; i < view.zones.length; i++) {
    const z: WidgetZoneView = view.zones[i];
    if (z.name !== DOCK_ZONE) { continue; }
    for (let j = 0; j < z.spans.length; j++) {
      const s: WidgetSpanView = z.spans[j];
      if (!dockSpanExcluded(s.text)) { out.spans.push(s); }
    }
  }
  out.visible = out.spans.length > 0;
  return out;
}
