/**
 * pluginhost.ets —— 插件面板的**宿主模型**（纯逻辑，零依赖，可脱机单测）。
 *
 * ── web 插件模型的权威事实（本文件每个判据的依据，全部 file:line 可查）────────────
 * 插件的前端产物是一个 **ESM 模块**，不是网页：
 *   · 服务端把它当静态资源挂在 `/plugins/<id>/web/<entry>`
 *     （`channel/web/web.go:979-980` 注册路由 → `:2074 handlePluginStatic` 落盘服务；
 *      路径解析与缓存策略见 `channel/web/web_plugin_static_test.go`）；
 *   · RPC `web_plugin_list` 下发的 `module_url` 就是这条资源路径
 *     （`serverapp/rpc_table.go:2260-2292`，字段 `ModuleURL json:"module_url"`）。
 * 宿主用**同页动态 import** 加载它，再当 React 组件渲染：
 *   · `web/src/plugin-runtime/loader.ts:29` `await import(entryUrl)`；
 *   · `web/src/plugin-runtime/usePluginRuntimeHost.ts:77` `await import(url?view=<id>...)`；
 *   · 渲染为同页组件（`web/src/plugin-runtime/PluginView.tsx`）—— **不是 iframe**
 *     （web 全仓仅 `SandboxedUI.tsx` 的 "src mode" 用 iframe 承载**外部 URL**）。
 * 该模块在**模块顶层**就读宿主注入的全局，因此**没有宿主页就跑不起来**：
 *   · 产物实证 `~/.xbot/plugins/builtin/xbot.iteration-stats/web/index.js` 首行即
 *     `var w = window; var { getGlobalLiveStats, ... } = w.__xbot_iteration__; var React = w.React;`
 *     （`xbot.genui` 用 `w.__xbot_ui__`；`xbot.git-fancy`/`xbot.ssh-runner` 用 `window.__xbot_session__`）；
 *   · 注入点：`web/src/plugins/SandboxedUI.tsx:41-42`（`__xbot_ui__` + `React`）、
 *     `web/src/plugin-runtime/iteration-render.tsx:26-28`（`__xbot_iteration__` + `React` + `__xbot_i18n__`）、
 *     `web/src/plugin-runtime/usePluginRuntimeHost.ts:388`（`__xbot_session__`）。
 *
 * ⇒ **结论（决定了本文件存在的意义）**：
 *   ① `module_url` 只能当**元数据 / import 目标**，**绝不能当文档 URL 交给 WebView**
 *      —— 那样只会显示 JS 源码或语法错误（这就是 2026-10-11 原生「打开插件面板」的缺陷）；
 *   ② 它也**不能**被"小型自研宿主页"跑起来：那需要 React + 上述全部宿主全局 + 完整 ctx
 *      （plugin-api 的 rpc/ui/config/i18n/state/events…）⇒ 等于重实现 web 的 plugin-runtime，
 *      属于用户明令禁止的"割裂/自造协议"；
 *   ③ 唯一与 web 一致的落地形态：面板交给**权威宿主页**（xbot web 应用本体）承载
 *      —— 那里插件按原生 web 语义加载，一致性 100%（它就是同一个前端）。
 *
 * 分层原因（铁律）：本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译
 * ⇒ 禁 import `@ohos.*` / ArkUI 全局；故只用**字符串处理**做 URL 判据（不引 `@ohos.url`）。
 */
import { PluginPanelInfo } from './types';

/** 服务端插件静态资源的路径前缀（`channel/web/web.go:980`）。 */
export const PLUGIN_ASSET_PREFIX: string = '/plugins/';

/** `/plugins/<id>/web/` 中段（`web.go:2086-2089` 要求 `parts[1] === "web"`）。 */
export const PLUGIN_ASSET_WEB_SEGMENT: string = '/web/';

/** `plugin.json` 的 `web.entry` 缺省值（与 web `pluginModuleURL` 无关，是原生旧实现既有兜底）。 */
export const PLUGIN_DEFAULT_ENTRY: string = 'index.js';

// ── 纯函数：URL 判据 ──────────────────────────────────────────────────────────

/** 取 URL 的 origin（`scheme://host[:port]`）；非绝对 URL ⇒ 空串。纯字符串处理。 */
export function originOf(url: string): string {
  const u: string = url !== undefined && url !== null ? url.trim() : '';
  const schemeAt: number = u.indexOf('://');
  if (schemeAt <= 0) {
    return '';
  }
  const afterScheme: number = schemeAt + 3;
  const pathAt: number = u.indexOf('/', afterScheme);
  return pathAt < 0 ? u : u.substring(0, pathAt);
}

/** 是否同源（两者都能解析出 origin 且相等）。 */
export function sameOrigin(a: string, b: string): boolean {
  const oa: string = originOf(a);
  const ob: string = originOf(b);
  return oa.length > 0 && oa === ob;
}

/** 去掉 query/hash（判据只看路径）。 */
function pathOnly(url: string): string {
  let p: string = url;
  const q: number = p.indexOf('?');
  if (q >= 0) {
    p = p.substring(0, q);
  }
  const h: number = p.indexOf('#');
  if (h >= 0) {
    p = p.substring(0, h);
  }
  return p;
}

/**
 * 是不是"插件前端**模块资源**"（⇒ **不可**当文档打开）。
 *
 * 判据两条（任一命中即模块资源）：
 *   ① 路径以 `.js` / `.mjs` 结尾 —— 浏览器把 JS 当文档打开只会显示源码/触发下载；
 *   ② 路径落在 `/plugins/<id>/web/` 下 —— 服务端契约里这条路径**只**服务 ESM 产物
 *      （`web.go:2086-2089`；目录里只有 `index.js` 与 `chunk-*.js`，见 web_plugin_static_test.go）。
 */
export function isPluginModuleAsset(url: string): boolean {
  const u: string = url !== undefined && url !== null ? url.trim() : '';
  if (u.length === 0) {
    return false;
  }
  const path: string = pathOnly(u);
  const lower: string = path.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return true;
  }
  return path.indexOf(PLUGIN_ASSET_PREFIX) >= 0 && path.indexOf(PLUGIN_ASSET_WEB_SEGMENT) >= 0;
}

/**
 * 面板要打开的 URL（**修语义的核心判据**）。
 *
 * 规则：**只有"同源的页面 URL"才允许直接打开**，其余一律回落到权威宿主页：
 *   · `serverUrl` 是插件 ESM 资源（`.js`/`.mjs` 结尾，或路径落在 `/plugins/<id>/web/` 下）⇒ 回落宿主页
 *     （**这正是要根治的缺陷**：旧实现把 `module_url` 当页面 URL 交给了 WebView）；
 *   · `serverUrl` 跨源（第三方站点）⇒ 回落宿主页：本组件会把 `window.xbotNative`
 *     注入**所有 frame**（`WebSurface.ets` 的 `javaScriptProxy`），不该注给第三方页面；
 *   · `serverUrl` 为空 ⇒ 宿主页；
 *   · `serverUrl` 是同源页面（非模块资源）⇒ 用它（为将来声明式"URL 面板"留门，
 *     web 侧对应 `SandboxedUI.tsx` 的 src mode）。
 *
 * @param baseUrl   服务端根地址（权威宿主页）
 * @param serverUrl `web_plugin_list` 下发的候选 URL（今天恒为 `module_url`）
 */
export function pluginPanelUrl(baseUrl: string, serverUrl: string): string {
  const host: string = hostPageUrl(baseUrl);
  const cand: string = serverUrl !== undefined && serverUrl !== null ? serverUrl.trim() : '';
  if (cand.length === 0) {
    return host;
  }
  if (isPluginModuleAsset(cand)) {
    return host;
  }
  if (!sameOrigin(cand, host)) {
    return host;
  }
  return cand;
}

/**
 * 权威宿主页 URL：服务端根地址（规整尾斜杠；若误传了路径则只保留 origin，避免拼出坏地址）。
 * 为什么"宿主页 = 服务端根地址"是权威的：插件 UI 只在 web 应用页面里可运行（见文件头 ③）。
 */
export function hostPageUrl(baseUrl: string): string {
  const b: string = baseUrl !== undefined && baseUrl !== null ? baseUrl.trim() : '';
  if (b.length === 0) {
    return '';
  }
  const origin: string = originOf(b);
  return origin.length > 0 ? origin : b.replace(/\/+$/, '');
}

/** 归一化入口：去前导斜杠；空值回落 `index.js`。 */
export function normalizePluginEntry(entry: string): string {
  const e: string = entry !== undefined && entry !== null ? entry.trim() : '';
  if (e.length === 0) {
    return PLUGIN_DEFAULT_ENTRY;
  }
  return e.startsWith('/') ? e.substring(1) : e;
}

/**
 * 插件 ESM 模块 URL（**仅元数据**：显示/诊断用；与 web `web_share.go:171-194 pluginModuleURL`
 * 以及服务端 `rpc_table.go:2289` 的拼法同构）。
 */
export function pluginModuleUrl(baseUrl: string, pluginId: string, entry: string): string {
  const host: string = hostPageUrl(baseUrl);
  const id: string = pluginId !== undefined && pluginId !== null ? pluginId.trim() : '';
  if (host.length === 0 || id.length === 0) {
    return '';
  }
  return `${host}${PLUGIN_ASSET_PREFIX}${id}${PLUGIN_ASSET_WEB_SEGMENT}${normalizePluginEntry(entry)}`;
}

/**
 * 把服务端可能给的**相对路径**资源 URL 补成绝对。
 *
 * 为什么需要：服务端 `rpc_table.go:2289` 拼的是**相对路径**（`/plugins/<id>/web/<entry>`），
 * 而 `module_url` 只用于**显示/诊断** —— 一条 `/plugins/...` 脱离服务器地址没有意义。
 * 已是绝对 URL（带 scheme）⇒ 原样返回。
 */
export function absoluteAssetUrl(baseUrl: string, urlOrPath: string): string {
  const u: string = urlOrPath !== undefined && urlOrPath !== null ? urlOrPath.trim() : '';
  if (u.length === 0) {
    return '';
  }
  if (originOf(u).length > 0) {
    return u;
  }
  const host: string = hostPageUrl(baseUrl);
  if (host.length === 0) {
    return u;
  }
  return u.startsWith('/') ? `${host}${u}` : `${host}/${u}`;
}

/** 归一化插件 id：服务端历史上给过两种字段名（`id` / `plugin_id`）。 */
export function normalizePluginId(id: string, pluginId: string): string {
  const a: string = id !== undefined && id !== null ? id.trim() : '';
  if (a.length > 0) {
    return a;
  }
  return pluginId !== undefined && pluginId !== null ? pluginId.trim() : '';
}

/** 归一化展示名：`name` → `label` → id。 */
export function normalizePluginName(name: string, label: string, id: string): string {
  const n: string = name !== undefined && name !== null ? name.trim() : '';
  if (n.length > 0) {
    return n;
  }
  const l: string = label !== undefined && label !== null ? label.trim() : '';
  return l.length > 0 ? l : id;
}

/**
 * 原生侧插件面板条目。
 *
 * ⚠️ 继承 `PluginPanelInfo`（`core/types.ets`）：**字段 `url` 的语义被修正为"可打开的宿主页 URL"**
 *    —— 消费方（`pages/Index.ets` 的"打开"按钮）无需改动即可从"打开裸 ESM"变成"打开权威宿主页"。
 *    ESM 模块 URL 迁到 `moduleUrl`（纯元数据，**永不**作为文档加载）。
 */
export class PluginHostInfo extends PluginPanelInfo {
  /** 插件前端 ESM 模块 URL —— **仅元数据**（显示/诊断），不是页面（见文件头）。 */
  moduleUrl: string = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// 插件目录模型（消费 `web.contributes`）—— 让用户"能看见、能选"插件
// ══════════════════════════════════════════════════════════════════════════════
//
// ── 真实数据勘察（2026-10-11 实测 ~/.xbot/plugins/builtin/*/plugin.json）───────
// ⚠️ 关键事实：`web_plugin_list` 下发的是 **`web.contributes`**（视图贡献点），
//    不是清单顶层的 `contributes`（那是后端能力声明：`configuration`/`channelProvider`…）：
//      · `serverapp/rpc_table.go:2306` → `Contributes: e.Manifest.Web.Contributes`；
//      · 顶层与 web 层的字段名撞车（都叫 contributes），**取错就得到一堆配置 schema**。
// 实测各插件（`web.contributes`，逐字抄）：
//   · xbot.git-fancy v0.3.5: [ {kind:view,id:"xbot.git-fancy.panel",container:"right_sidebar",
//       title:"view.panel.title",icon:"git-branch",entry:"index.js"},
//       {kind:view,id:"xbot.git-fancy.commit",container:"main",title:"view.commit.title",
//        icon:"git-commit-horizontal",entry:"commit.js",dynamic:true} ]
//   · xbot.ssh-runner v1.0.6: [ {…panel, container:"right_sidebar", icon:"server", entry:"index.js"},
//       {…bar, container:"info_bar", icon:"server", entry:"bar.js"} ]
//   · xbot.iteration-stats v1.0.0: [ {…badge, container:"status_bar_right", title:"view.badge.title",
//       entry:"index.js"} ]（**无 icon**）
//   · xbot.genui v1.0.0: `web.entry="index.js"`、**无 `web.contributes`**（视图由宿主内置渲染）
//   · xbot.ambience v0.3.0: **无 `web`**（纯后端插件）⇒ 服务端 `rpc_table.go:2294-2296` 已过滤
// 文本都是 **i18n key**：`name:"manifest.name"`、`title:"view.panel.title"`，
//   译文在 `web.i18n`（服务端 `:2307` 原样透传）⇒ 原生必须按同一套回退链解析。
//   web 侧规则：`plugin-runtime/i18n.ts:98-106 resolvePluginText`（key 命中⇒译文；
//   非 key 或没有表⇒原样返回），回退链见 `:16-45 lookup`（当前语言 → 同语言前缀 → en → 任意语言）。

/** `web.contributes` 里的一个视图贡献点（web `plugin-api/manifest.ts:19-45 ViewContribution`）。 */
export interface WebViewWire {
  kind?: string;
  id?: string;
  container?: string;
  title?: string;
  icon?: string;
  entry?: string;
  align?: string;
  dynamic?: boolean;
}

/** `web_plugin_list` 的单条（服务端 `rpc_table.go:2277-2291` 的 `webPluginJSON`）。 */
export interface WebPluginWire {
  id?: string;
  plugin_id?: string;
  name?: string;
  label?: string;
  version?: string;
  state?: string;
  enabled?: boolean;
  permissions?: string[];
  entry?: string;
  module_url?: string;
  contributes?: WebViewWire[];
  /** 插件自带文案表：locale → key → text（实现见 `plugin-runtime/i18n.ts` 与 `createPluginI18n`）。 */
  i18n?: Record<string, Record<string, string>>;
}

/** `web_plugin_list` 响应（服务端 `return map[string]any{"plugins": out}`）。 */
export interface WebPluginListWire {
  plugins?: WebPluginWire[];
}

/** 打开方式：只能进**权威宿主页**（视图是 ESM 模块或宿主内置声明式组件，宿主页里才跑得起来）。 */
export const PLUGIN_OPEN_HOST: string = 'host';
/** 打开方式：原生**可直接打开**（同源页面 URL；判据复用波1b，不新造第二套）。 */
export const PLUGIN_OPEN_DIRECT: string = 'direct';

/// 容器展示顺序（稳定；未知容器排最后）。
const CONTAINER_ORDER: string[] = [
  'right_sidebar', 'panel', 'main', 'bottom', 'info_bar', 'status_bar_right', 'iteration',
];

/**
 * 容器 → 展示分组名（未知容器回落容器名本身，便于暴露协议新增值而不是静默吞掉）。
 *
 * ⚠️ 用 if 链而不是 `Record<string,string>` 对象字面量：ArkTS 的
 * `arkts-no-untyped-obj-literals` 会拒绝这种字面量（真门禁 ④ 实测：
 * `Object literal must correspond to some explicitly declared class or interface`）。
 */
export function containerLabel(container: string): string {
  const c: string = container !== undefined && container !== null ? container.trim() : '';
  if (c === 'right_sidebar') {
    return '侧栏';
  }
  if (c === 'panel') {
    return '面板';
  }
  if (c === 'bottom') {
    return '底部';
  }
  if (c === 'info_bar') {
    return '信息栏';
  }
  if (c === 'status_bar_right') {
    return '状态栏';
  }
  if (c === 'iteration') {
    return '迭代内嵌';
  }
  if (c === 'main') {
    return '主区';
  }
  return c.length > 0 ? c : '其他';
}

/** 容器展示次序（用于分组排序；未知容器排最后但仍展示）。 */
export function containerRank(container: string): number {
  const i: number = CONTAINER_ORDER.indexOf(container);
  return i >= 0 ? i : CONTAINER_ORDER.length;
}

/** 语言标签归一化（`zh_CN` → `zh-CN`；与 web `i18n.ts:16-18 normalizeLocale` 同规则）。 */
function normalizeLocaleTag(tag: string): string {
  return tag !== undefined && tag !== null ? tag.trim().replace(/_/g, '-') : '';
}

/** 单语言精确查表（含"同语言前缀"回落：`zh-CN` 可用 `zh-Hans`/`zh` 的表）。 */
function lookupLocale(
  table: Record<string, Record<string, string>>,
  locale: string,
  key: string,
): string | undefined {
  const l: string = normalizeLocaleTag(locale);
  const exact: Record<string, string> | undefined = table[l];
  if (exact !== undefined && exact[key] !== undefined) {
    return exact[key];
  }
  const dash: number = l.indexOf('-');
  const prefix: string = dash > 0 ? l.substring(0, dash) : '';
  if (prefix.length > 0) {
    const keys: string[] = Object.keys(table);
    for (let i = 0; i < keys.length; i++) {
      const cand: string = keys[i];
      if (cand === prefix || cand.startsWith(`${prefix}-`)) {
        const t: Record<string, string> | undefined = table[cand];
        if (t !== undefined && t[key] !== undefined) {
          return t[key];
        }
      }
    }
  }
  return undefined;
}

/**
 * 解析"插件清单文本"（i18n key 或裸文本）—— 与 web `plugin-runtime/i18n.ts:98-106` **同规则**：
 * 空 ⇒ 空；没有表 ⇒ 原样；命中 ⇒ 当前语言译文；未命中 ⇒ **原样返回 key**（web 的 `t(key, key)`）。
 */
export function resolvePluginText(
  table: Record<string, Record<string, string>> | undefined,
  keyOrText: string,
  locale: string,
): string {
  const k: string = keyOrText !== undefined && keyOrText !== null ? keyOrText : '';
  if (k.length === 0) {
    return '';
  }
  if (table === undefined || table === null) {
    return k;
  }
  const exact: string | undefined = lookupLocale(table, locale, k);
  if (exact !== undefined) {
    return exact;
  }
  const en: string | undefined = lookupLocale(table, 'en', k);
  if (en !== undefined) {
    return en;
  }
  // 任何语言提供的该 key 都优于"完全没有"（web i18n.ts:38-44 同规则）
  const locales: string[] = Object.keys(table);
  for (let i = 0; i < locales.length; i++) {
    const t: Record<string, string> | undefined = table[locales[i]];
    if (t !== undefined && t[k] !== undefined) {
      return t[k];
    }
  }
  return k;
}

/** 只在表里查 key（**未命中返回空串**）：用于 `manifest.name`/`manifest.description`
 *  这类"本身就是 key 的清单字段"——未命中时不能把 `manifest.description` 当文案显示。 */
export function resolveManifestKey(
  table: Record<string, Record<string, string>> | undefined,
  key: string,
  locale: string,
): string {
  const v: string = resolvePluginText(table, key, locale);
  return v === key ? '' : v;
}

/** 视图/插件的打开目标。 */
export class PluginTarget {
  mode: string = PLUGIN_OPEN_HOST;
  url: string = '';

  constructor(mode: string, url: string) {
    this.mode = mode;
    this.url = url;
  }
}

/**
 * 一个贡献点的打开目标（**判据复用波1b**：`isPluginModuleAsset` + `sameOrigin`，不新造第二套）。
 *
 * 事实（实测清单）：所有 view 都是 `entry`（ESM 模块，宿主页里 `import()`）或宿主内置声明式组件
 * ⇒ **一律 `host`**（进权威宿主页）。`direct` 分支留给"插件声明了**同源页面 URL**"的形态
 * （web 侧对应 `SandboxedUI.tsx:207-239` 的 src mode），判据与 `pluginPanelUrl` 完全相同。
 */
export function resolvePluginTarget(candidateUrl: string, baseUrl: string): PluginTarget {
  const host: string = hostPageUrl(baseUrl);
  const cand: string = candidateUrl !== undefined && candidateUrl !== null ? candidateUrl.trim() : '';
  if (cand.length > 0 && !isPluginModuleAsset(cand) && sameOrigin(cand, host)) {
    return new PluginTarget(PLUGIN_OPEN_DIRECT, cand);
  }
  return new PluginTarget(PLUGIN_OPEN_HOST, host);
}

/** 目录里的一个"视图"（= 一条 `kind:'view'` 的贡献点）。 */
export class PluginViewItem {
  id: string = '';
  pluginId: string = '';
  pluginName: string = '';
  container: string = '';
  containerLabel: string = '';
  /** 已按当前语言解析过的标题（清单里写的是 i18n key）。 */
  title: string = '';
  icon: string = '';
  entry: string = '';
  /** `dynamic:true` = 只能由 `ctx.ui.openViewTab` 参数化打开（web `manifest.ts:37-44`）。 */
  dynamic: boolean = false;
  align: string = '';
  /** `PLUGIN_OPEN_HOST` / `PLUGIN_OPEN_DIRECT`。 */
  openMode: string = PLUGIN_OPEN_HOST;
  openUrl: string = '';
}

/** 目录里的一个"插件"。 */
export class PluginCatalogItem extends PluginHostInfo {
  description: string = '';
  version: string = '';
  /** 服务端 `state`（`active`/…）——**仅展示**，不用它做任何门控。 */
  state: string = '';
  views: PluginViewItem[] = [];
}

/** 按容器聚合的一组视图（目录里的"分区"）。 */
export class PluginCatalogGroup {
  container: string = '';
  label: string = '';
  views: PluginViewItem[] = [];

  constructor(container: string, label: string, views: PluginViewItem[]) {
    this.container = container;
    this.label = label;
    this.views = views;
  }
}

/** 原生插件目录（组件直接消费）。 */
export class PluginCatalog {
  items: PluginCatalogItem[] = [];
  groups: PluginCatalogGroup[] = [];
}

/** 视图 id 的短名（`xbot.git-fancy.panel` → `panel`）—— i18n 未命中时的兜底显示名。 */
export function viewShortId(viewId: string): string {
  const v: string = viewId !== undefined && viewId !== null ? viewId : '';
  const dot: number = v.lastIndexOf('.');
  return dot >= 0 && dot < v.length - 1 ? v.substring(dot + 1) : v;
}

/**
 * 把 `web_plugin_list` 的响应构造成**原生目录模型**（纯函数，零依赖 ⇒ 可脱机单测）。
 *
 * 只消费 `kind:'view'` 的贡献点（目录要展示的就是"有哪些视图能开"）；其余 kind
 * （`command`/`toolbar`/`contextMenu`/`setting`/`eventHandler`/`theme`）是**宿主行为扩展**，
 * 原生没有等价承载面 ⇒ 不进目录（见报告 ⑤）。
 *
 * 安全：`permissions` **不参与任何门控**（不按插件自述信任）；`module_url` 只作元数据，
 * 页面 URL 一律走 `pluginPanelUrl`（模块资源/跨源已回落）。
 */
export function buildPluginCatalog(
  data: WebPluginListWire | undefined,
  locale: string,
  baseUrl: string,
): PluginCatalog {
  const catalog: PluginCatalog = new PluginCatalog();
  const raw: WebPluginWire[] = data !== undefined && data !== null && data.plugins !== undefined
    ? data.plugins : [];
  const host: string = hostPageUrl(baseUrl);
  for (let i = 0; i < raw.length; i++) {
    const p: WebPluginWire = raw[i];
    const id: string = normalizePluginId(
      p.id !== undefined ? p.id : '',
      p.plugin_id !== undefined ? p.plugin_id : '');
    if (id.length === 0) {
      continue;
    }
    const table: Record<string, Record<string, string>> | undefined = p.i18n;
    const rawName: string = p.name !== undefined ? p.name : '';
    let name: string = resolvePluginText(table, rawName, locale);
    if (name === rawName && rawName.indexOf('manifest.') === 0) {
      // `name` 是 key 但表里没有 ⇒ 别把 'manifest.name' 当显示名（回落 label → id）
      name = normalizePluginName('', p.label !== undefined ? p.label : '', id);
    } else if (name.length === 0) {
      name = normalizePluginName('', p.label !== undefined ? p.label : '', id);
    }
    const entry: string = normalizePluginEntry(p.entry !== undefined ? p.entry : '');
    const serverUrl: string = p.module_url !== undefined ? p.module_url : '';

    const item: PluginCatalogItem = new PluginCatalogItem();
    item.id = id;
    item.name = name;
    item.description = resolveManifestKey(table, 'manifest.description', locale);
    item.version = p.version !== undefined ? p.version : '';
    item.state = p.state !== undefined ? p.state : '';
    item.moduleUrl = absoluteAssetUrl(
      baseUrl, serverUrl.length > 0 ? serverUrl : pluginModuleUrl(baseUrl, id, entry));
    // 面板 URL：**恒为页面**（模块资源/跨源回落宿主页 —— 波1b 判据）
    item.url = pluginPanelUrl(baseUrl, serverUrl);

    const wireViews: WebViewWire[] = p.contributes !== undefined && p.contributes !== null
      ? p.contributes : [];
    const views: PluginViewItem[] = [];
    for (let j = 0; j < wireViews.length; j++) {
      const w: WebViewWire = wireViews[j];
      if (w.kind !== 'view') {
        continue;
      }
      const vid: string = w.id !== undefined ? w.id : '';
      if (vid.length === 0) {
        continue;
      }
      const container: string = w.container !== undefined ? w.container : '';
      const rawTitle: string = w.title !== undefined ? w.title : '';
      const t: PluginViewItem = new PluginViewItem();
      t.id = vid;
      t.pluginId = id;
      t.pluginName = name;
      t.container = container;
      t.containerLabel = containerLabel(container);
      const resolved: string = resolvePluginText(table, rawTitle, locale);
      // `view.*` 是 key 但未命中 ⇒ 用短 id 兜底（别把 'view.badge.title' 当标题）
      t.title = resolved === rawTitle && rawTitle.indexOf('view.') === 0
        ? viewShortId(vid) : (resolved.length > 0 ? resolved : viewShortId(vid));
      t.icon = w.icon !== undefined ? w.icon : '';
      t.entry = normalizePluginEntry(w.entry !== undefined && w.entry.length > 0 ? w.entry : entry);
      t.dynamic = w.dynamic === true;
      t.align = w.align !== undefined ? w.align : '';
      // 真实贡献点不带 URL（见 resolvePluginTarget 注释）⇒ 传空 ⇒ host；判据与波1b 同源
      const target: PluginTarget = resolvePluginTarget('', baseUrl);
      t.openMode = target.mode;
      t.openUrl = target.url.length > 0 ? target.url : host;
      views.push(t);
    }
    item.views = views;
    catalog.items.push(item);
  }

  // ── 按容器聚合（目录的"分区"）：顺序稳定，空分组不进 ──────────────────────
  const containers: string[] = [];
  for (let i = 0; i < catalog.items.length; i++) {
    const vs: PluginViewItem[] = catalog.items[i].views;
    for (let j = 0; j < vs.length; j++) {
      if (containers.indexOf(vs[j].container) < 0) {
        containers.push(vs[j].container);
      }
    }
  }
  containers.sort((a: string, b: string) => containerRank(a) - containerRank(b));
  for (let i = 0; i < containers.length; i++) {
    const c: string = containers[i];
    const grouped: PluginViewItem[] = [];
    for (let k = 0; k < catalog.items.length; k++) {
      const vs: PluginViewItem[] = catalog.items[k].views;
      for (let j = 0; j < vs.length; j++) {
        if (vs[j].container === c) {
          grouped.push(vs[j]);
        }
      }
    }
    if (grouped.length > 0) {
      catalog.groups.push(new PluginCatalogGroup(c, containerLabel(c), grouped));
    }
  }
  return catalog;
}
