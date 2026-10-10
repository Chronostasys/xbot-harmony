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
