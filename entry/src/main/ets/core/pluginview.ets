/**
 * pluginview.ets —— **插件三个面的展示判据**（纯逻辑，零依赖，可脱机单测）。
 *
 * ── 为什么单独成模块（本仓铁律 §11「单一"状态 → 视图"管线」）──────────────────
 *   `components/{PluginHost,PluginWidgets,WebSurface}.ets` 之前各自在 `build()` 里**就地判**：
 *     · PluginHost：`if (p.state.length > 0 && p.state !== 'active')` + `if (v.dynamic)`；
 *     · PluginWidgets：`pct()` 的夹取、`deltaRole()` 的正负判、降级行的文案拼接、标题回落；
 *     组件不进离线 harness（`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译）⇒ **写在组件里 = 不可测**。
 *   本模块把这些判据收敛到 `core/`，组件**只画**（`docs/REDESIGN.md` §11）。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────────
 *   ⛔ 本文件属 `core/` ⇒ 被 `run.sh` 当**纯 TS** 编译：禁 import ArkUI / `@ohos.*`；
 *      禁无类型对象字面量（一律用 `class`）；无 `any`。
 *   ⛔ 这里**只产出角色名 / 文案 / 数值**，不产出颜色（颜色由组件经 `core/design.ets:colorOf` 解析）。
 *      ⇒ 产出的 `colorRole` 必须是 `colorOf` 的合法角色（`docs/DESIGN-SYSTEM.md §12`）。
 */
import { isPresent } from './guards';
// 能力面板「列表高度」估值要用到**同一套**间距/命中区常量（⛔ 别在本文件另抄一份数字）——
// `core/*.ets` 引用 `./design` 已有先例（`splash.ets`/`mdview.ets` 等）。`design.ets` 是纯数值表，
// 不含 ArkUI/`@ohos.*` ⇒ 本文件仍可被 `run.sh` 当纯 TS 编译。
import { GAP_ROW_Y, HIT_TARGET_MIN, INSET_ROW_Y } from './design';

// ══════════════════════════════════════════════════════════════════════════════
// ① 插件目录：状态徽标 / 视图徽标 / 计数 / 空态（`components/PluginHost.ets`）
// ══════════════════════════════════════════════════════════════════════════════

/** 服务端 `web_plugin_list` 的 `state` 里的"正常"档（`rpc_table.go` 的实测取值）。 */
export const PLUGIN_STATE_ACTIVE: string = 'active';

/** 服务端 `state` 里的"**激活失败**"档（2026-10-12 真机 + 审计日志实锤：`fork/exec ./bin/*:
 *  no such file or directory` ⇒ 该插件进程根本没起来 ⇒ 它的面板**不可能**工作）。 */
export const PLUGIN_STATE_ERROR: string = 'error';

/** 一个徽标的显示判据（是否显示 / 文案 / 语义色角色）。 */
export class PluginBadge {
  show: boolean = false;
  text: string = '';
  /** `colorOf` 合法角色（本模块**只产出**它支持的三种：textSecondary / dangerText / textMuted）。 */
  colorRole: string = 'textSecondary';

  constructor(show: boolean, text: string, colorRole: string) {
    this.show = show;
    this.text = text;
    this.colorRole = colorRole;
  }
}

/**
 * 插件 `state` → 状态徽标。
 *
 * 规则（逐条对齐 web 权威基准 `plugins/manager/PluginManagerPanel.tsx:223`
 * `isActive ? 'bg-green-500' : 'bg-slate-400'`）：
 *   · 空 / `active` ⇒ **不显示**（成功要安静 —— 满屏绿点是最吵的噪音源，`REDESIGN.md §2.7`）；
 *   · **`error`（激活失败）⇒ 中文提示「未启动」+ `dangerText`**（见下）；
 *   · 其余未知档（`disabled`/`inactive`/…）⇒ **原样**显示该 state 文本，语气**中性**（`textSecondary`）。
 *   ⛔ 未知档不自造中文：web 没有这套文案，自造即背离"文案逐字取 web、禁自创"（**但已知档除外**，
 *      见下 ⚠️）；原样暴露也不会静默吞掉信息。
 *   ⛔ 不用 `statusWaiting`/`statusIdle` 等**状态标记/点色**当正文色（浅底仅 1.7–2.1:1，读不出）。
 *
 * ⚠️ 2026-10-12（用户拍板，覆盖此前"一律不翻中文"的口径）：用户原话「**加载失败的不管，ui 给个
 *    提示就行**」——`state=error` 的插件进程**根本没起来**（审计日志实锤 `fork/exec ./bin/*:
 *    no such file or directory`）⇒ 它的面板点了必然不工作。此时把英文 token `error` 直接当徽标
 *    显示，中文界面里**读不懂为什么点不开** ⇒ 改为**已知档**给中文提示「未启动」（语气 `dangerText`，
 *    与"失败要显眼、成功要安静"同一口径）。**未知档仍原样暴露**（不猜）。
 */
export function pluginStateBadge(state: string): PluginBadge {
  const s: string = isPresent(state) ? state.trim() : '';
  if (s.length === 0 || s === PLUGIN_STATE_ACTIVE) {
    return new PluginBadge(false, '', 'textSecondary');
  }
  if (s === PLUGIN_STATE_ERROR) {
    return new PluginBadge(true, '未启动', 'dangerText');
  }
  return new PluginBadge(true, s, 'textSecondary');
}

/**
 * 视图的 `dynamic` 旗标 → 徽标。
 *
 * web 语义（`plugin-api/manifest.ts:37-44`）：`dynamic:true` 的视图**只能由插件经
 * `ctx.ui.openViewTab(...)` 参数化打开**，目录里点不动 ⇒ 原生如实标注「按需」，
 * 绝不渲染一个"点了没反应"的行（诚实优先）。
 */
export function pluginViewBadge(dynamic: boolean): PluginBadge {
  return dynamic ? new PluginBadge(true, '按需', 'textSecondary') : new PluginBadge(false, '', 'textSecondary');
}

/** 视图数文案（`PluginCatalogItem.views` 长度 → 人类可读）。 */
export function pluginViewCountText(n: number): string {
  const count: number = typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
  return `${count} 个视图`;
}

/** 目录概览标题（`插件目录（N）`）。 */
export function pluginCatalogSummaryText(count: number): string {
  const n: number = typeof count === 'number' && isFinite(count) && count > 0 ? count : 0;
  return `插件目录（${n}）`;
}

/** 概览行右侧提示（web 侧插件 UI 一律在权威宿主页里运行，见 `core/pluginhost.ets` 文件头）。 */
export function pluginCatalogHint(): string {
  return '在宿主页里运行';
}

/** 目录空态文案（**不是**错误：服务端未启用插件系统，或插件都没有 `web.entry`）。 */
export function pluginCatalogEmptyNotice(): string {
  return '没有声明前端产物的插件（服务端未启用插件系统，或插件都没有 web.entry）';
}

/** 目录脚注（诚实告知：为什么点开后在宿主页里运行）。 */
export function pluginCatalogFootnote(): string {
  return '说明：插件 UI 是浏览器 ESM 模块（需要 web 宿主的 React 与能力注入），'
    + '因此点击后在宿主页内运行；本目录只做"有哪些插件/视图"的索引。';
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 插件 widget：展示判据（`components/PluginWidgets.ets`）
// ══════════════════════════════════════════════════════════════════════════════
//
// ⚠️ "该不该显示 / 怎么降级 / 用什么色角色"的**主判据**在 `core/widgetsview.ets`；
//    本节只收编组件里**残留**的展示算术（百分比夹取 / delta 正负 / 标题回落 / 降级行拼接）。

/** 降级行的固定前缀（`kind` 未实现 / 未知 / code-src 沙箱 —— 一律可见，绝不静默）。 */
export const WIDGET_UNSUPPORTED_LABEL: string = '暂不支持';

/**
 * 进度百分比（**结果恒落在 [0,100] 且有限**；`max ≤ 0`/非有限 ⇒ 视作 100，`value` 非有限 ⇒ 0）。
 *
 * 判据与 web `ProgressWidget` 同义：进度条读的是**比例**，坏数据（NaN/负数/超上限）
 * 一律夹到合法区间，绝不让布局吃到负宽或 >100% 的宽。
 * ⚠️ 与旧组件内联实现的一处**有意修正**：旧的 `Infinity/100*100 > 100 ⇒ 100`（满格）；
 *    本版把"非有限 `value`"与 `NaN` **同档**（= 0，无数据），语义更一致（`core/widgetsview.ets`
 *    的 `asNum` 对非有限值也已回落缺省）。
 */
export function widgetPercent(value: number, max: number): number {
  const m: number = typeof max === 'number' && isFinite(max) && max > 0 ? max : 100;
  const v: number = typeof value === 'number' && isFinite(value) ? value : 0;
  let p: number = (v / m) * 100;
  if (!isFinite(p)) { p = 0; }
  if (p < 0) { p = 0; }
  if (p > 100) { p = 100; }
  return p;
}

/**
 * metric 的 delta → 语义色角色（web `plugins/components.tsx:78`：delta **不以 '-' 开头** ⇒ 正向绿）。
 * 空 delta ⇒ `textMuted`（没有 delta 就不该有颜色）。
 * 产出的角色都在 `colorOf` 合法集合内。
 */
export function widgetDeltaRole(delta: string): string {
  const d: string = isPresent(delta) ? delta : '';
  if (d.length === 0) { return 'textMuted'; }
  return d.startsWith('-') ? 'dangerText' : 'successText';
}

/** 声明式组件的标题：有 `title` 用它，否则回落 `widget_id`（两者都空 ⇒ 空串，调用方不画）。 */
export function widgetLabel(title: string, widgetId: string): string {
  const t: string = isPresent(title) ? title : '';
  if (t.length > 0) { return t; }
  return isPresent(widgetId) ? widgetId : '';
}

/** 降级行的明细文案：`kind · reason`（两者都空 ⇒ 空串）。修正了旧表达式在 `kind` 为空时的前导 ` · `。 */
export function widgetDegradeDetail(kind: string, reason: string): string {
  const k: string = isPresent(kind) ? kind.trim() : '';
  const r: string = isPresent(reason) ? reason.trim() : '';
  if (k.length === 0) { return r; }
  if (r.length === 0) { return k; }
  return `${k} · ${r}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ ArkWeb 承载面：加载 / 就绪 / 失败三态（`components/WebSurface.ets`）
// ══════════════════════════════════════════════════════════════════════════════
//
// ⛔ 状态条**恒静态**（`REDESIGN.md §4.1`：同一时刻只允许一个"在飞动效" = 光球）
//    ⇒ 这里只有文案与色角色，**没有任何时长/动画**；"加载中"是**一行小字**，不是 spinner。

/** 尚未开始加载（初始态 / 无人消费）。 */
export const WEB_PHASE_IDLE: string = 'idle';
/** 正在加载（`onPageBegin` / 切 URL）。 */
export const WEB_PHASE_LOADING: string = 'loading';
/** 页面已就绪（`onPageEnd`）。 */
export const WEB_PHASE_READY: string = 'ready';
/** 加载失败（`onErrorReceive`；`detail` 带内核给的原因）。 */
export const WEB_PHASE_ERROR: string = 'error';

/** 承载面状态条：是否显示 / 文案 / 色角色 / 是否给出"重试"。 */
export class WebStatus {
  show: boolean = false;
  text: string = '';
  /** `colorOf` 合法角色。 */
  colorRole: string = 'textMuted';
  canRetry: boolean = false;

  constructor(show: boolean, text: string, colorRole: string, canRetry: boolean) {
    this.show = show;
    this.text = text;
    this.colorRole = colorRole;
    this.canRetry = canRetry;
  }
}

/**
 * 承载面阶段 + 失败原因 → 状态条。
 *
 *   · `error`  ⇒ 显示「加载失败」+ 内核原因（有才拼），`dangerText`，**可重试**；
 *   · `loading`⇒ 显示「正在加载…」，`textMuted`，不可重试（**静态**，不是 spinner）；
 *   · 其余     ⇒ 不显示（`ready/idle` 都安静）。
 */
export function webStatusOf(phase: string, detail: string): WebStatus {
  const p: string = isPresent(phase) ? phase : WEB_PHASE_IDLE;
  if (p === WEB_PHASE_ERROR) {
    const d: string = isPresent(detail) ? detail.trim() : '';
    return new WebStatus(true, d.length > 0 ? `加载失败：${d}` : '加载失败', 'dangerText', true);
  }
  if (p === WEB_PHASE_LOADING) {
    return new WebStatus(true, '正在加载…', 'textMuted', false);
  }
  return new WebStatus(false, '', 'textMuted', false);
}

/**
 * 承载面顶栏的**人类标题**（纯函数）—— 原生 chrome **绝不**显示原始 URL。
 *
 * 用户亲报（2026-10-13）：「你开插件，上面有个地址是不是太丑了」—— 点开插件后顶栏是一条
 * `http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel`：丑、无信息量、还泄露了内网地址。
 *
 * 优先级（高 → 低）：
 *   ① `fallback` = **调用方**给的语义标签（插件名 / 「完整 Web UI」…）—— 宿主**打开时就知道**
 *      自己要展示什么，这是最权威的来源（内置 web 的 `document.title` 恒为 `xbot`，不可用）；
 *   ② `pageTitle` = 页面 `document.title`（`onTitleReceive`）—— 必须**否决**"看着像 URL /
 *      恰好等于 url"的值（有些页面把 `location.href` 当标题）；
 *   ③ 都不可用 ⇒ **空串**（组件据此不渲染该文本节点，而不是退回显示一条丑 URL）。
 */
export function webChromeLabel(pageTitle: string, url: string, fallback: string): string {
  const f: string = isPresent(fallback) ? fallback.trim() : '';
  if (f.length > 0) {
    return f;
  }
  const t: string = isPresent(pageTitle) ? pageTitle.trim() : '';
  if (t.length === 0 || t === url) {
    return '';
  }
  const lower: string = t.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('file://')) {
    return '';
  }
  return t;
}

/**
 * 内核错误（`WebResourceError.getErrorInfo()` / `getErrorCode()`）→ 展示明细。
 *   有 info 用 info；否则有非零 code 用 `错误码 N`；都没有 ⇒ 空串（调用方落回"加载失败"）。
 *   纯函数 ⇒ 可脱机断言（组件里只做"取内核值 → 交给它"）。
 */
export function webErrorDetail(info: string, code: number): string {
  const i: string = isPresent(info) ? info.trim() : '';
  if (i.length > 0) { return i; }
  const c: number = typeof code === 'number' && isFinite(code) && code !== 0 ? code : 0;
  return c !== 0 ? `错误码 ${c}` : '';
}

/**
 * **HTTP 层**错误（`onHttpErrorReceive`）→ 展示明细。
 *
 * 为什么需要它：`onErrorReceive` **只覆盖资源级**失败（DNS/连接/证书）；服务端返回
 * **4xx/5xx 状态码**（404 插件产物缺失 / 401 会话失效 / 5xx 后端挂）走的是 **HTTP 事件**
 * ⇒ 此前未接线 ⇒ 承载面显示一个**空壳页面且原生零解释**（白屏感，用户无从判断）。
 *
 * 纯函数 ⇒ 可脱机断言（组件只做"取内核值 → 交给它"）。产物形如：
 *   · `HTTP 404 Not Found`（有状态码 + 原因）；
 *   · `HTTP 500`（只有状态码）；
 *   · 原因原样（状态码缺/0 ⇒ 只给原因；都空 ⇒ 空串，调用方落回"加载失败"）。
 */
export function webHttpErrorDetail(statusCode: number, reason: string): string {
  const r: string = isPresent(reason) ? reason.trim() : '';
  const c: number = typeof statusCode === 'number' && isFinite(statusCode) && statusCode !== 0 ? statusCode : 0;
  if (c !== 0 && r.length > 0) { return `HTTP ${c} ${r}`; }
  if (c !== 0) { return `HTTP ${c}`; }
  return r;
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 能力面板：加载 / 空 / 失败三态（`components/PluginsSheet.ets`）
// ══════════════════════════════════════════════════════════════════════════════
//
// 派单背景（真问题）：入口接通前，`openPlugins()` 是"关抽屉 → `await` 拉 RPC → 再显示面板"，
// 慢网下**用户看不到任何反馈**；且数据层把 RPC 错误**吞成空目录**
// （`core/store.ets:loadPluginCatalog` catch ⇒ `new PluginCatalog()`）⇒ 面板**无法区分"空"与"失败"**。
// 本节的判据让面板能如实三分（web 权威：`settings/SettingsPlugins.tsx` 的 loading / error / empty 三分支）。
//
// ⛔ 与 ArkWeb 承载面（③）同纪律：状态行**恒静态**（一行字 + 语义色），**不是 spinner**
//    —— `REDESIGN.md §4.1`「同一时刻只允许一个在飞动效 = 光球」。

/** 有数据/无状态行。 */
export const PANEL_STATE_NONE: string = 'none';
/** 加载中。 */
export const PANEL_STATE_LOADING: string = 'loading';
/** 空（无插件且无视图）。 */
export const PANEL_STATE_EMPTY: string = 'empty';
/** 加载失败（可重试）。 */
export const PANEL_STATE_ERROR: string = 'error';

/** 能力面板的状态行（是否显示 / 文案 / 语义色角色 / 是否给"重试"）。 */
export class PluginPanelStatus {
  /** 见 `PANEL_STATE_*`。 */
  state: string = PANEL_STATE_NONE;
  show: boolean = false;
  text: string = '';
  /** `colorOf` 合法角色（本模块**只产出** textMuted / dangerText 两者）。 */
  colorRole: string = 'textMuted';
  canRetry: boolean = false;

  constructor(state: string, show: boolean, text: string, colorRole: string, canRetry: boolean) {
    this.state = state;
    this.show = show;
    this.text = text;
    this.colorRole = colorRole;
    this.canRetry = canRetry;
  }
}

/** 加载中文案（**静态一行字**，不是 spinner）。 */
export function pluginPanelLoadingText(): string {
  return '正在加载插件目录…';
}

/**
 * 失败文案：`插件目录加载失败：<可读原因>`。
 * ⚠️ `error` 必须由调用方先经 `core/rpc.ets:readableRpcError` **可读化**（本函数不解析原始 JSON/英文栈，
 *    避免把原始报文糊到用户脸上）。空串 ⇒ 只留前缀（不产出 `：` 悬空）。
 */
export function pluginPanelErrorText(error: string): string {
  const e: string = isPresent(error) ? error.trim() : '';
  return e.length > 0 ? `插件目录加载失败：${e}` : '插件目录加载失败';
}

/**
 * 空态文案 + 导向（与目录空态 `pluginCatalogEmptyNotice` **同语义**，但补一条"去哪装"）。
 * web 权威：`settings.plugins.none` 的"没有任何插件"语义（原生不抄英文 key —— 无 i18n 文案表）。
 */
export function pluginPanelEmptyText(): string {
  return '还没有可用插件。可在「完整 Web UI」里安装，或请管理员在服务端启用插件系统。';
}

/**
 * 面板状态行（**判据与渲染同源**的唯一出口；`components/PluginsSheet.ets` 只消费它）。
 *
 * 优先级（**失败 > 加载 > 空 > 有数据**）：
 *   · `errorText` 非空 ⇒ `dangerText` + **可重试**（即使 `loading` 仍真：失败就是失败）；
 *   · `loading`       ⇒ `textMuted`（静态一行字），**不可重试**（正在重试中，别给第二个按钮）；
 *   · 无插件且无视图   ⇒ 空态引导（`textMuted`）；
 *   · 有数据           ⇒ 不显示状态行（`state = none`）。
 *
 * @param loading     是否正在拉目录（`openPlugins`/`retry` 期间为真）。
 * @param pluginCount 目录里的插件数（`items.length`）。
 * @param groupCount  视图分组数（`groups.length`）—— 空态判据必须**同时**看这两者（有视图无插件也算有数据）。
 * @param errorText   **已可读化**的错误串（空 = 无错）。
 */
export function pluginPanelStatus(
  loading: boolean, pluginCount: number, groupCount: number, errorText: string,
): PluginPanelStatus {
  const err: string = isPresent(errorText) ? errorText.trim() : '';
  if (err.length > 0) {
    return new PluginPanelStatus(PANEL_STATE_ERROR, true, pluginPanelErrorText(err), 'dangerText', true);
  }
  if (loading === true) {
    return new PluginPanelStatus(PANEL_STATE_LOADING, true, pluginPanelLoadingText(), 'textMuted', false);
  }
  const p: number = typeof pluginCount === 'number' && isFinite(pluginCount) && pluginCount > 0 ? pluginCount : 0;
  const g: number = typeof groupCount === 'number' && isFinite(groupCount) && groupCount > 0 ? groupCount : 0;
  if (p === 0 && g === 0) {
    return new PluginPanelStatus(PANEL_STATE_EMPTY, true, pluginPanelEmptyText(), 'textMuted', false);
  }
  return new PluginPanelStatus(PANEL_STATE_NONE, false, '', 'textMuted', false);
}

/**
 * 插件行的**元信息行**（`v<版本> · <state>`；两者都无 ⇒ 空串，调用方不画）。
 * `state` 复用 `pluginStateBadge` 的判据（`active` 不显示 —— 成功要安静，同 `PluginHost` 卡片）。
 */
export function pluginMetaText(version: string, state: string): string {
  const v: string = isPresent(version) ? version.trim() : '';
  const parts: string[] = [];
  if (v.length > 0) { parts.push(`v${v}`); }
  const badge: PluginBadge = pluginStateBadge(state);
  if (badge.show) { parts.push(badge.text); }
  return parts.join(' · ');
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 能力面板：列表高度（内容自适应 + 上限；`components/PluginsSheet.ets` 消费）
// ══════════════════════════════════════════════════════════════════════════════
//
// 背景（2026-10-12 真机实锤缺陷）：面板的 `List` 此前是**硬编码 `.height(320)`** ⇒ 目录里
// 插件一多，靠后的行**被裁在折线外**（实测：后端 4 个插件，`xbot.ssh-runner` 的行**完全看不到**，
// 连"有这个插件"都无从得知）——用户亲报「插件的面板我们看不到」的同族症状。
// 面板是**菜单**：行少 ⇒ 卡片矮（观感不变）；行多 ⇒ 长到上限后**表内滚动** —— 不再有"有行却看不见"。
//
// ⛔ 行高只能**估值**（ArkUI 无运行时测量出口）：单行行 = `max(HIT_TARGET_MIN, 单行文本高)` +
//    `INSET_ROW_Y×2` + `GAP_ROW_Y`；插件行另有「名称/元信息 + 描述」两层文本（额外 `SPACE_XS`）。
//    估值**宁可略高**：高了只是卡片略高；**低了就会裁掉行**（正是旧缺陷）。

/**
 * 固定「入口行」行数（生产恒为 `PANEL_FIXED_ENTRY_ROWS`）—— **高度估值与真实行数同源**。
 *
 * ⚠️ 4 → 5（2026-10-13）：新增「Git 面板（原生）」入口（web 内置插件 `xbot.git-fancy` 的
 *   可选增强）。⛔ 这里改了就必须改 `components/PluginsSheet.ets` 的真实行数：两处失配 =
 *   13h 那个「第 N 行被裁」缺陷（高度估值少算一行 ⇒ 列表区放不下最后一行）。
 *
 * ⚠️ **§21.115**：值仍 = 5（原生目录 / 会话统计 / 技能 / Git 面板（原生）/ 完整 Web UI）；
 *   新增的**分组头「插件」不再折进本常量** —— 它由 `PANEL_SECTION_HEADER_H` **单独**计入
 *   `pluginPanelListHeight`（按真实 ≈ 半行高估值，⛔ 不再虚占一整行入口高）。
 */
export const PANEL_FIXED_ENTRY_ROWS: number = 5;
/** 「入口行」高度估值（vp）：单行文本，取命中区下限 + 上下内距 + 行间距。 */
export const PANEL_ENTRY_ROW_H: number = HIT_TARGET_MIN + 2 * INSET_ROW_Y + GAP_ROW_Y;
/** 「插件行」高度估值（vp）：入口行 + 描述那一层（两层文本）。 */
export const PANEL_PLUGIN_ROW_H: number = PANEL_ENTRY_ROW_H + 8;
/** 列表高度**下限**（vp）——行少时保持现状观感（与旧硬编码 320 对齐，不缩水）。 */
export const PANEL_LIST_MIN_H: number = 320;
/**
 * 列表高度**上限**（vp）——超出则表内滚动，卡片不再长高。
 * 取值：屏高 2848px / density 3.333 ≈ 854vp 的 ~77%（标题行 + 内距后仍留出上下留白）。
 *
 * ⚠️ 560 → 660（2026-10-13）：固定入口行 4 → 5（新增「Git 面板（原生）」）⇒ 真实装机形态
 *   （5 入口行 + 后端当前 4 个插件）= 626vp，旧上限 560 会**在常见形态就触顶**（用户看到的是
 *   "最后一行贴边 + 必须滚动"，而不是原来的"一屏看完"）。判据 `pluginview.test.ts` 的 ★H
 *   （"未触上限 ⇒ 恰为 N×入口行 + M×插件行"）正是一条**回归钉**，就是为了防这类"悄悄触顶"。
 */
export const PANEL_LIST_MAX_H: number = 660;

/** 计数归一化：非有限数/负数 ⇒ 0（防御服务端给了怪值）。 */
function panelRowCount(n: number): number {
  return typeof n === 'number' && isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 分组头行高度估值（vp；§21.115）—— 插件卡列表前的分组头「插件」。
 * 实际 ≈ 1 行 micro 文本 + 上内距 `SPACE_SM` + 下内距 `SPACE_XS` ≈ 26vp ⇒ 取 **30**（略高、安全方向）。
 * ⛔ 只在**有插件**（分组头才渲染）时计入 —— 与组件里 `if (this.plugins.length > 0)` 同源。
 */
export const PANEL_SECTION_HEADER_H: number = 30;

/**
 * 能力面板列表的高度（vp）——**夹在 `[PANEL_LIST_MIN_H, PANEL_LIST_MAX_H]`**。
 *
 * @param entryRows   固定入口行数（生产恒为 `PANEL_FIXED_ENTRY_ROWS`）
 * @param pluginCount 目录里的插件数（`plugins.length`）
 * @param statusRows  三态状态行占的行数（状态行本身 + 可能的「重试」行；无状态行传 0）
 */
export function pluginPanelListHeight(entryRows: number, pluginCount: number, statusRows: number): number {
  const nPlugins: number = panelRowCount(pluginCount);
  const h: number = panelRowCount(entryRows) * PANEL_ENTRY_ROW_H
    + nPlugins * PANEL_PLUGIN_ROW_H
    + panelRowCount(statusRows) * PANEL_ENTRY_ROW_H
    // 分组头只在有插件时渲染（与组件 `if (this.plugins.length > 0)` 同源）。
    + (nPlugins > 0 ? PANEL_SECTION_HEADER_H : 0);
  if (h > PANEL_LIST_MAX_H) {
    return PANEL_LIST_MAX_H;
  }
  return h > PANEL_LIST_MIN_H ? h : PANEL_LIST_MIN_H;
}
