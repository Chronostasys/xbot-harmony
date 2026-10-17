import { webview } from '@kit.ArkWeb';
import { Palette, paletteOf } from '../core/theme';
import { BusinessError, request } from '@kit.BasicServicesKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import {
  BridgeMessage, parseBridgeMessage, encodeBridgeMessage, encodeBridgeAck, makeBridgeMessage,
  BridgeHostAction, BRIDGE_ACTION_CLOSE, BRIDGE_ACTION_LOG, BRIDGE_ACTION_READY,
  BRIDGE_ACTION_CLIPBOARD, BRIDGE_ACTION_NAV, BRIDGE_ACTION_DIFF,
  hostActionFor, bridgeInitPayload, HostNavEvent, parseHostNavPayload,
  NEW_WINDOW_EXTERNAL, NEW_WINDOW_IN_WEB, newWindowAction,
  FILE_PICK_IMAGE, FILE_PICK_MAX_COUNT, filePickKindOf,
  downloadFileNameOf, sanitizeFileName,
} from '../core/webbridge';
// 文件名清洗复用 `core/attach.ets` 的 `baseName`（附件与页面文件选择必须是同一套命名语义）。
import { baseName } from '../core/attach';
import {
  WEB_PHASE_ERROR, WEB_PHASE_IDLE, WEB_PHASE_LOADING, WEB_PHASE_READY,
  WebStatus, webChromeLabel, webErrorDetail, webHttpErrorDetail, webStatusOf,
} from '../core/pluginview';
import { DiffBridgeRequest, hostPageUrl, isEmbeddedViewLink, nativeViewKind, parseXbotViewLink, parseDiffBridgePayload, sessionBootstrapJs } from '../core/pluginhost';
// 「新窗口代理」复用**消息层同一个**外链解析（⛔ 不另写白名单，避免两份分叉）。
import { resolveOpenable } from '../core/msgops';
import {
  PRESS_OPACITY,   colorOf, hairlineOf, surfaceFillOf,
  HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, RADIUS_PILL, SPACE_XS, STROKE_HAIRLINE,
} from '../core/design';
import { fs, fw, lh } from './SettingsRows';
import { hilog } from '@kit.PerformanceAnalysisKit';

// ── 早期注入探针（`runJavaScriptOnDocumentStart`）────────────────────────────────
// 目的：在不改 web 仓的前提下，验证**原生能否在页面脚本之前**往页面注入自己的 JS
//（目标②「插件全支持」的根问题是"桥由 web 自己注入、原生拿不到" —— 先证明注入这条路可行）。
// ⛔ 本补丁**只观测**：把 `window.__xbotProbe` 挂上去 + `console.log` 出 `window` 上所有
//    `/xbot/i` 的全局名 ⇒ web 侧 JS 加一行 `console.log(Object.keys(window).filter(...))`
//    就能观测到原生注入物。**不实现任何业务**（业务桥仍是 `window.xbotNative`）。
const PROBE_TAG: string = 'XBOTPROBE';
const PROBE_JS: string =
  '(function(){try{'
  + 'var all=Object.keys(window),keys=[],i=0;'
  + 'for(i=0;i<all.length;i++){if(/xbot/i.test(all[i])){keys.push(all[i]);}}'
  + 'window.__xbotProbe={t:Date.now(),readyState:document.readyState,'
  + 'hasHead:!!document.head,hasBody:!!document.body,'
  + 'nativeType:(typeof window.xbotNative),xbotKeys:keys};'
  + 'console.log("[XBOT-PROBE] xbotKeys="+JSON.stringify(keys));'
  // 会话身份三次采样（0.8s/2.5s/6s）：用于判定「原生注入到底有没有到页面、有没有被 web 覆盖」
  // ⇒ 真机 `hdc shell hilog | grep XBOTPROBE`。⛔ 只读，不改任何状态。
  + 'var rep=function(tag){try{console.log("[XBOT-SESSION] "+tag'
  + '+ " sess="+JSON.stringify(window.__xbot_session__||null)'
  + '+ " search="+location.search + " hash="+location.hash'
  + '+ " native="+(typeof window.xbotNative));}catch(e){/* probe only */}};'
  + 'setTimeout(function(){rep("t0.8");},800);'
  + 'setTimeout(function(){rep("t2.5");},2500);'
  + 'setTimeout(function(){rep("t6");},6000);'
  + '}catch(e){console.log("[XBOT-PROBE] fail "+e);}})();';

// ── 剪贴板垫片（`navigator.clipboard` polyfill；§21.122d 事件代理第二批）──────────────
/**
 * 为什么必须有（**实测语义**，不是可选增强）：
 *   web 源码里有 **9+ 处** `navigator.clipboard.writeText(...)`（复制消息正文/代码块/文件路径/
 *   渠道 URL…，见 `MessageActions.tsx:256`、`MarkdownRenderer.tsx:84`、`ToolRender.tsx:244`、
 *   `FileExplorer.tsx:380`、`SettingsChannels.tsx:319`…），而宿主 WebView 的源是
 *   **`http://10.0.2.2:8082` = 非 secure context** ⇒ 浏览器**不提供** `navigator.clipboard`
 *   ⇒ 这些 `await navigator.clipboard.writeText(...)` 全部落进各自的空 catch（web 侧**静默**）
 *   ⇒ 用户看到"点了复制，什么都没发生"。**这不是 web 的 bug，是宿主环境缺能力**。
 *
 * 修法（用户定向「代理一部分 web 原生的事件」）：在**页面脚本之前**注入垫片 ——
 *   ① 只在 `navigator.clipboard` 缺失时补（secure context / 有原生能力时**一律不动**，避免覆盖更好实现）；
 *   ② `writeText` 同步转发到既有 JS 桥 `xbotNative.postMessage({type:'clipboard', payload:原文})`
 *      （⛔ payload 即原文，不套 JSON：否则"复制一段 JSON 文本"会被误解析）；
 *   ③ 返回 `Promise.resolve()`（web 侧都是 `await`/`.then`，必须拿到 thenable，否则同步抛错）；
 *   ④ `readText` **不实现**（⛔ 读剪贴板涉及用户隐私与系统能力，本仓暂无消费点 ⇒ 显式 reject，
 *      比"假装返回空串"诚实：页面能区分"不支持"与"剪贴板为空"）。
 * 安全性：垫片不接受任何页面传入的目标/类型，只把文本交给既定桥；长度由 `core/webbridge.ets`
 *   （`BRIDGE_MAX_CLIPBOARD_LEN`）收敛，签名/白名单仍在原生侧。
 */
const CLIPBOARD_SHIM_JS: string =
  '(function(){try{'
  + 'var n=navigator;'
  + 'if(n.clipboard&&n.clipboard.writeText){console.log("[XBOT-CLIP] native api present, shim skipped");return;}'
  + 'console.log("[XBOT-CLIP] shim installed");'
  + 'function send(t){try{'
  + 'if(window.xbotNative&&window.xbotNative.postMessage){'
  + 'window.xbotNative.postMessage(JSON.stringify({v:1,id:"clipboard",type:"clipboard",payload:String(t)}));'
  + '}}catch(e){console.log("[XBOT-CLIP] post failed "+e);}}'
  + 'var api={'
  + 'writeText:function(t){send(t);return Promise.resolve();},'
  + 'readText:function(){return Promise.reject(new Error("clipboard read unsupported by host"));},'
  + 'write:function(items){var a=items||[];for(var i=0;i<a.length;i++){if(a[i]&&a[i].getType&&a[i].getType()==="text/plain"){return a[i].text().then(function(t){send(t);});}}return Promise.reject(new Error("only text/plain supported"));}'
  + '};'
  + 'try{Object.defineProperty(n,"clipboard",{value:api,configurable:true,writable:false});}'
  + 'catch(e2){try{n.clipboard=api;}catch(e3){console.log("[XBOT-CLIP] install failed "+e3);}}'
  + '}catch(e){console.log("[XBOT-CLIP] shim failed "+e);}})();';


/**
 * 注入页面 `window.xbotNative` 的**原生代理对象**（ArkWeb `javaScriptProxy` 的 `object`）。
 *
 * 页面调用 `xbotNative.postMessage(json)` 时，会**同步**进到这里。本对象**只做两件事**：
 *   ① 解析信封（`parseBridgeMessage`，防御性，坏输入不抛）；
 *   ② 把合法消息回调给上层（`handler`，由 WebSurface 在 `aboutToAppear` 注入）。
 * **不做业务解释**（协议层对 payload 无知，见 core/webbridge.ets 头注释）。
 *
 * 返回值是**结构化回执**（`{"ok":true|false,"error":"..."}` 串）—— 页面可据此判断是否被接受。
 * 解析失败 / 上层回调抛错都**返回失败回执**，绝不把异常穿透回 ArkWeb。
 */
class NativeBridgeProxy {
  /** 上层消息回调（WebSurface 注入）。默认空实现 = 丢弃（未接线时安全）。 */
  handler: (m: BridgeMessage) => void = () => {
  };

  /**
   * 页面 → 原生入口。`json` 是桥信封串。
   * ⚠️ ArkWeb 同步桥方法在 **UI 主线程**执行 ⇒ 方法体必须极短（解析 + 入队），不得做重活。
   */
  postMessage(json: string): string {
    const m: BridgeMessage | null = parseBridgeMessage(json);
    if (m === null) {
      return encodeBridgeAck(false, 'invalid bridge message');
    }
    try {
      this.handler(m);
    } catch (e) {
      // 上层回调抛错不能外泄到 ArkWeb（同步桥抛错会影响页面脚本执行）
      return encodeBridgeAck(false, 'bridge handler failed');
    }
    return encodeBridgeAck(true, '');
  }
}

// ── chrome 的几何（vp）——**视觉可小、热区必 ≥44**（`REDESIGN.md §5`）──────────────
/** chrome 图标视觉字号（vp）。 */
const CHROME_GLYPH: number = 20;

/**
 * WebSurface —— **全能力逃生舱**（ArkWeb / `Web` 组件）。
 *
 * 为什么必须存在（这是"原生 + web 完整能力"这个组合的唯一自洽解）：
 *   xbot 前端有三类能力**结构性无法用 ArkTS 表达**：
 *     ① 插件 UI —— 插件产物是**浏览器 ESM bundle**（`plugin-runtime/loader.ts` 里
 *        `await import(entryUrl)`；xbot 已有 4 个带 web 产物的插件）；
 *     ② GenUI —— LLM 生成 TSX，运行时用 `sucrase` + `new Function()` 求值
 *        （`plugins/SandboxedUI.tsx`）；ArkTS 禁止动态求值；
 *     ③ 终端/代码编辑器 —— xterm.js / monaco（无 ArkTS 等价物）。
 *   ⇒ 这些面板交给 ArkWeb 承载（内核即 Chromium，能力 100% 保留），
 *     其余主链路（会话/消息/迭代/工具/输入）走原生 ArkUI。
 *
 * ── 视觉重排（2026-10-11，`docs/REDESIGN.md`）────────────────────────────────
 *   · chrome 的"返回/刷新"从**字符**（`‹` / `⟳`）改为**系统符号**
 *     （`chevron_left` / `arrow_clockwise`）—— 字符图标会走 emoji 字形、颜色不可控；
 *   · 图标视觉 20vp，热区落在**真实 44×44 布局盒**（⛔ 不用 `responseRegion` 负偏移外扩 —— 真机无效）；
 *   · 承载面加**恒静态**三态条（加载中 / 加载失败 + 重试）：判据在 `core/pluginview.ets`
 *     （`webStatusOf`），⛔ **不是 spinner**（唯一在飞动效 = 光球，见 §4.1）；
 *   · 颜色一律经 `colorOf`；面经 `surfaceFillOf`；边界经 `hairlineOf`（门禁 ⑥c）。
 *
 * ⚠️ ArkWeb 与系统浏览器同引擎 ⇒ 它**不改善**渲染性能，只解决"能力可得性"。
 *    见 docs/ARCHITECTURE.md 的取舍说明。
 */
@Component
export struct WebSurface {
  /** 要加载的 URL（通常就是 xbot 服务端根地址，带完整 web UI）。 */
  // ⚠️ 必须是 @Prop + @Watch：面板从插件 A 切到插件 B 时组件实例不会重建，
  // 若 url 只是普通成员，ArkWeb 仍停留在旧页面（表现为"点了没反应/显示上一个页面"）。
  @Prop @Watch('onUrlChanged') url: string = '';
  /** 主题（由上层透传；语义色板见 core/theme.ets） */
  @Prop theme: string = 'dark';

  /** 当前语义色板 */
  private pal(): Palette {
    return paletteOf(this.theme);
  }
  /**
   * 是否带顶部 chrome（"‹ 返回"那行）。
   * 全屏承载**完整 web UI** 时置 false —— 一行原生 UI 都不留，才叫"与 web 一比一"。
   * ⚠️ 即便 chrome=false，**加载失败**状态条仍会显示（否则失败被静默 ⇒ 用户面对白屏无从判断）。
   */
  @Prop chrome: boolean = true;
  /**
   * 会话 cookie（`xbot_session=<value>`，由页面透传应用级凭据）。
   *
   * ⛔ 为什么必须有（用户 2026-10-13 亲报「点开插件 git 面板直接 401」）：
   *   ArkWeb 的 cookie 存储**独立于**原生 `XbotHttp` 的 cookie jar ⇒ 内嵌 page 载入后，
   *   SPA 发出的每个 XHR 都**不带**会话 cookie ⇒ 服务端一律 401（页面本身 200——
   *   实测根路径与 `/plugins/&lt;id&gt;/web/&lt;entry&gt;.js` 在无 cookie 时也 200）⇒ 症状正是
   *   "页面出来了、接口全挂"。
   *   ArkWeb 侧唯一出口是 `WebCookieManager.configCookieSync(url, value)`（@since 11）。
   */
  @Prop sessionCookie: string = '';

  /**
   * **当前会话 id**（插件面板的 cwd 由此决定）。
   *
   * ⛔ 用户 2026-10-17 P0「他们拿到的 pwd/cwd 都是错的」：web 插件的 cwd 来自 plugin RPC，
   *    而 RPC 的会话身份读的是宿主注入的 `window.__xbot_session__={channel,chatID}`
   *    （`web/src/plugin-runtime/usePluginRuntimeHost.ts:373-390`）。原生此前**从不注入**它。
   *    ⇒ 页面脚本之前注入本值；**会话切换**时（@Watch）原地重注入，不重载页面。
   */
  @Prop @Watch('onChatIdChanged') chatId: string = '';
  /** 会话渠道（本仓恒为 `web`；注入脚本用）。 */
  @Prop channel: string = 'web';
  /**
   * 顶栏的**人类标题**（调用方给的语义标签：插件名 / 「完整 Web UI」…）。
   *
   * ⛔ 为什么需要（用户 2026-10-13 亲报「你开插件，上面有个地址是不是太丑了」）：
   *   旧实现 `Text(title.length > 0 ? title : url)` 在标题未知时**直接显示原始 URL**
   *   （`http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel`）——丑、无信息量、泄露内网地址。
   *   现在一律经纯函数 `webChromeLabel(pageTitle, url, chromeLabel)`：**绝不**显示 URL。
   */
  @Prop chromeLabel: string = '';
  /** 关闭回调（由页面清空 url 卸载本组件）。 */
  onClose: () => void = () => {
  };
  private controller: webview.WebviewController = new webview.WebviewController();
  @State title: string = '';
  /** 承载面阶段（`core/pluginview.ets` 三态：idle/loading/ready/error）。 */
  @State phase: string = WEB_PHASE_IDLE;
  /** 失败明细（`webErrorDetail` 产出；仅 `phase === error` 时有意义）。 */
  @State loadErr: string = '';

  /**
   * JS 桥：注入页面的原生代理对象。**在 build 之前构造**（`javaScriptProxy` 属性在
   * `Web` 组件创建时使用它注册 `window.xbotNative`，见下方 `Web(...)` 链尾）。
   */
  private nativeBridge: NativeBridgeProxy = new NativeBridgeProxy();

  /**
   * 页面 → 原生的消息回调（**由调用方接线**，如页面把消息转交 store/rpc）。
   *
   * ⚠️ 用**普通成员**而非 `@Prop`（与本文件既有的 `onClose` 一致）：
   *    ArkTS 的 `@Prop/@State` 承载函数类型不可靠（装饰器会做值拷贝/观测，函数不是可观测数据），
   *    而回调只需"注册一次、可被覆盖"，普通成员字段是既有且正确的用法。
   *    默认空实现 ⇒ 未接线时消息被安全丢弃（不崩）。
   */
  onBridgeMessage: (m: BridgeMessage) => void = () => {
  };

  /**
   * 插件视图**深链导航**被拦截时的回调（`?xbot_view=<viewId>[&xbot_view_params=<json>]` ——
   * web 插件 `ctx.ui.openViewTab` 打开视图产生的导航）。由调用方接线，路由到原生面板
   * （`nativeViewKind` 非空的那类）。`params` = 深链里 `xbot_view_params` 解析出的参数
   * （如 git commit 的 `{ hash }`），供原生面板精确打开那一个视图。
   * ⛔ 默认空实现 ⇒ 未接线时 = 不拦截（`onLoadIntercept` 返回 false，放行 WebView 兜底）。
   * ⚠️ 普通成员而非 `@Prop`（同 `onBridgeMessage`/`onClose`：函数回调不是可观测数据）。
   */
  onOpenView: (viewId: string, title: string, url: string, params: Record<string, string>) => void = (viewId: string, title: string, url: string, params: Record<string, string>) => {
  };

  /**
   * 页面请求开**新窗口**且判定为**外部链接**时的回调（`onWindowNew` 代理）。
   *
   * 为什么必须有（用户定向「代理一部分 web 原生的事件」）：ArkWeb **不接** `onWindowNew`
   * ⇒ `window.open` / `<a target="_blank">` **整块静默失效**（点了没反应）。web 侧实证调用点：
   * `MessageActions.tsx:127`（消息「打开链接」）、`MarkdownRenderer.tsx:274/316`（正文里的链接）、
   * 9 处 `target="_blank"`。
   * 判定（同源/外链/拦截）在纯函数 `core/webbridge.ets:newWindowAction` 里；组件只执行副作用：
   *   · `external` ⇒ 调本回调（页面用 `openUrl` 交系统浏览器）；
   *   · `in-web`  ⇒ 在**同一个** WebView 里 `loadUrl`（同源页面就是同一份 SPA 的另一页）；
   *   · `block`   ⇒ 只拦不跳。
   * ⚠️ 普通成员而非 `@Prop`（同 `onBridgeMessage`/`onOpenView`：函数回调不是可观测数据）。
   */
  onOpenExternal: (url: string) => void = (url: string) => {
  };

  /**
   * 剪贴板写请求（§21.122d：页面 `navigator.clipboard.writeText` 的代理）。
   *
   * 为什么必须有：宿主 WebView 的源是 `http://10.0.2.2:8082` = **非 secure context** ⇒ 浏览器
   *   不提供 `navigator.clipboard`，而 web 侧有 **9+ 处** `writeText`（复制消息/代码/路径/URL）
   *   ⇒ 全部落进各自的空 catch（**静默**）⇒ 用户"点了复制没反应"。
   * 链路：页面 → `CLIPBOARD_SHIM_JS`（已注入的垫片）→ `xbotNative.postMessage({type:'clipboard'})`
   *   → `hostActionFor`（纯判定）→ **本回调** → 上层写系统剪贴板（`@ohos.pasteboard`）。
   * ⛔ 只在 `text` 非空时被调用（空文本会清空用户剪贴板，见 `applyHostAction` 注释）。
   * ⚠️ 普通成员而非 `@Prop`（同 `onBridgeMessage`/`onOpenExternal`：函数回调不是可观测数据）。
   */
  onClipboardWrite: (text: string) => void = (text: string) => {
  };

  /**
   * 页面请求**原生 diff 面板**（`{type:'diff', payload:'{"path","commit"}'}`）。
   *
   * ⛔ 通用协议：**零插件特判** —— git-fancy 也好、未来的任何 web 插件也好，同一出口；
   *    原生只要实现"能按 path(+commit) 打开自己的 diff 面板"就够了。
   *    返回栈语义（用户要求）：原生 diff 是覆盖层 ⇒ 返回关掉它回到 web view；再返回才退出面板。
   */
  onOpenDiff: (path: string, commit: string) => void = (path: string, commit: string) => {
  };

  /**
   * 页面触发的下载已完成（§21.122d 事件代理第三批：`onDownloadStart` 的完成回执）。
   *
   * 为什么必须有：ArkWeb 不接 `onDownloadStart` 时**不会**自行下载 ⇒ 页面里"导出/下载"
   *   的链接点了没反应（web 侧实证：文件面板 `/api/files/download`、插件/skill 导出 zip 等）。
   * 链路：页面下载请求 → `onDownloadStart` → `downloadFileNameOf`（纯函数推导文件名，
   *   ⛔ 先信服务端 `Content-Disposition`，再退 URL 路径，最后兜底）→ `request.downloadFile`
   *   落进沙箱 → 完成后回调**本函数**（上层给用户可见反馈：toast / 提示）。
   * ⚠️ 普通成员而非 `@Prop`（同 `onBridgeMessage`/`onClipboardWrite`：函数回调不是可观测数据）。
   *
   * @param name 落盘文件名（已清洗，见 `core/webbridge.ets:sanitizeFileName`）
   * @param path 沙箱绝对路径（`<cacheDir>/webdl/<name>`），供上层展示/分享
   */
  onDownloadDone: (name: string, path: string) => void = (name: string, path: string) => {
  };

  /**
   * **面板导航意图**代理（§21.122f；web `src/workspace/hostBridge.ts` 的 `nav` 消息）。
   *
   * 为什么必须有：嵌入模式（`?xbot_panel=<id>&xbot_embed=1`）下 web 只渲**面板本体**，
   *   面板里的"用户想往外走"的动作不再由 web 自己完成（web 已经没有那层 chrome/work 视图可跳）
   *   —— 它们被代理给宿主，由宿主决定：chrome 标题（`title`）/ 触发**原生 UI**（`openFile`）。
   *   用户原话：「这种嵌套 web view 应该**代理原 web 的导航事件**…然后文件面板应该
   *   **代理后触发原生 ui**」。
   * 链路：页面 → `xbotNative.postMessage({type:'nav',payload:'{"kind","text"}'})` →
   *   `hostActionFor`（信封级判定）→ `parseHostNavPayload`（**纯函数**：白名单 + 截断）→ 本回调。
   * ⛔ 只在 payload 合法（kind 在白名单）时被调用；坏包在纯函数里就被丢弃（fail-closed）。
   * ⚠️ 普通成员而非 `@Prop`（同 `onBridgeMessage`/`onDownloadDone`：函数回调不是可观测数据）。
   */
  onHostNav: (ev: HostNavEvent) => void = (ev: HostNavEvent) => {
  };

  /**
   * 把 `nativeBridge` 的回调接到 `onBridgeMessage`，并执行**宿主 chrome 级动作**。
   * ⚠️ 必须在 `aboutToAppear`（早于 build / 页面加载）完成，确保页面第一次调
   *    `xbotNative.postMessage` 时回调已就位。
   *
   * 两条路径分工（判定在 `core/webbridge.ets:hostActionFor` 这个纯函数里，组件只执行副作用）：
   *   · `applyHostAction` —— 组件自己能闭环的：`close`（关承载页）/ `log`（转原生日志）/
   *     `ready`（握手 ⇒ 回 `init` 下发主题）；
   *   · `onBridgeMessage` —— 业务消息交给**上层**（由调用方接线；未接线时安全丢弃）。
   */
  // ══════════════════════════════════════════════════════════════════════════════
  // §21.122d 余项：`<input type=file>`（页面文件选择）与页面下载的**代理**
  //
  // 两条都属"ArkWeb 自己不做、宿主不接就整块静默失效"的能力（同 `onWindowNew`/`navigator.clipboard`）。
  // 判定一律放在纯函数里（`core/webbridge.ets:filePickKindOf` / `downloadFileNameOf` /
  // `sanitizeFileName`），本组件只执行**副作用**（弹选择器、复制文件、发下载任务、回话）。
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * 处理页面文件选择请求（`onShowFileSelector`）。
   * ⛔ **无论成功、失败、还是用户取消，都必须回话**（`event.result.handleFileList(...)`）：
   *    不回则该请求永久挂着，页面 `onChange` 永不触发。
   */
  private async handleFileSelector(event: OnShowFileSelectorEvent): Promise<void> {
    let forWeb: string[] = [];
    try {
      const mode: number = event.fileSelector.getMode();
      const accept: string[] = event.fileSelector.getAcceptType();
      const picked: string[] = await this.pickUrisForWeb(mode, accept);
      forWeb = await this.copyPickedToSandbox(picked);
    } catch (e) {
      const be: BusinessError = e as BusinessError;
      hilog.error(0x0000, PROBE_TAG, 'file-selector fail %{public}s', be.message);
      forWeb = [];
    }
    try {
      // 取消/失败 ⇒ 空列表（页面据此走"用户取消"分支）
      event.result.handleFileList(forWeb);
    } catch (e) {
      const be: BusinessError = e as BusinessError;
      hilog.error(0x0000, PROBE_TAG, 'handleFileList fail %{public}s', be.message);
    }
  }

  /** 按 `accept` + 模式弹选择器，返回用户选中的原始 URI（取消 ⇒ 空数组）。 */
  private async pickUrisForWeb(mode: number, accept: string[]): Promise<string[]> {
    const cap: number = mode === FileSelectorMode.FileOpenMultipleMode ? FILE_PICK_MAX_COUNT : 1;
    if (mode === FileSelectorMode.FileSaveMode) {
      // 页面要走"另存为"时给保存对话框（web 侧导出类入口用得到）。
      const opt: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      opt.newFileNames = ['xbot-export'];
      const saved: string[] = await new picker.DocumentViewPicker().save(opt);
      return saved !== undefined ? saved : [];
    }
    if (mode === FileSelectorMode.FileOpenFolderMode) {
      // ⛔ web 侧实测**没有任何** `webkitdirectory` 消费点（全仓 grep 0 处）⇒ 不假装能选目录：
      //    回空列表（页面按"用户取消"处理）比"给一个文件却当目录"诚实。
      hilog.info(0x0000, PROBE_TAG, 'folder-pick requested — unsupported (no web consumer)');
      return [];
    }
    if (filePickKindOf(accept) === FILE_PICK_IMAGE) {
      const opt: picker.PhotoSelectOptions = new picker.PhotoSelectOptions();
      opt.MIMEType = picker.PhotoViewMIMETypes.IMAGE_TYPE;
      opt.maxSelectNumber = cap;
      const res: picker.PhotoSelectResult = await new photoAccessHelper.PhotoViewPicker().select(opt);
      return res !== undefined ? res.photoUris : [];
    }
    const opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
    opt.maxSelectNumber = cap;
    const res: string[] = await new picker.DocumentViewPicker().select(opt);
    return res !== undefined ? res : [];
  }

  /**
   * 把选中的 URI 复制进应用沙箱（`<cacheDir>/webpick/`），返回 Web 引擎能读的 `file://` 路径。
   * ⛔ 必须复制：picker 给的是 `file://docs/…` 这类**文档 URI**，Web 引擎读不了；
   *    文件名一律过 `sanitizeFileName`（决定写哪个文件 = 安全边界）。
   */
  private async copyPickedToSandbox(uris: string[]): Promise<string[]> {
    const out: string[] = [];
    if (uris === undefined || uris.length === 0) {
      return out;
    }
    const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const dir: string = `${ctx.cacheDir}/webpick`;
    try {
      fileIo.mkdirSync(dir, true);
    } catch (e) {
      // 目录已存在（mkdirSync 无 ignore-existing 语义）—— 非错误，继续。
      hilog.info(0x0000, PROBE_TAG, 'webpick dir exists');
    }
    const stamp: number = Date.now();
    for (let i = 0; i < uris.length && i < FILE_PICK_MAX_COUNT; i++) {
      const name: string = sanitizeFileName(baseName(uris[i]));
      const dest: string = `${dir}/${stamp}_${i}_${name}`;
      try {
        const src: fileIo.File = fileIo.openSync(uris[i], fileIo.OpenMode.READ_ONLY);
        fileIo.copyFileSync(src.fd, dest);
        fileIo.closeSync(src);
        out.push(`file://${dest}`);
      } catch (e) {
        const be: BusinessError = e as BusinessError;
        hilog.error(0x0000, PROBE_TAG, 'webpick copy fail %{public}s', be.message);
      }
    }
    return out;
  }

  /** 页面下载请求 ⇒ 落进沙箱 `<cacheDir>/webdl/`，完成后回调 `onDownloadDone`。 */
  private startWebDownload(url: string, name: string): void {
    if (url === undefined || url.length === 0) {
      return;
    }
    const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const dir: string = `${ctx.cacheDir}/webdl`;
    try {
      fileIo.mkdirSync(dir, true);
    } catch (e) {
      // 目录已存在 —— 非错误，继续。
      hilog.info(0x0000, PROBE_TAG, 'webdl dir exists');
    }
    const dest: string = `${dir}/${name}`;
    try {
      request.downloadFile(ctx, { url: url, filePath: dest })
        .then((task: request.DownloadTask) => {
          task.on('complete', () => {
            this.onDownloadDone(name, dest);
          });
          task.on('fail', (code: number) => {
            hilog.error(0x0000, PROBE_TAG, 'download fail code=%{public}d', code);
          });
        })
        .catch((e: BusinessError) => {
          hilog.error(0x0000, PROBE_TAG, 'download start fail %{public}s', e.message);
        });
    } catch (e) {
      const be: BusinessError = e as BusinessError;
      hilog.error(0x0000, PROBE_TAG, 'download throw %{public}s', be.message);
    }
  }

  /**
   * 会话切换 ⇒ **原地重注入** `__xbot_session__`（不重载页面）。
   * ⛔ 漏了这一步，插件面板会继续用上一个会话的 chatID 取 cwd ⇒ 显示错会话的 git 状态。
   */
  onChatIdChanged(): void {
    if (this.chatId.length === 0) {
      return;
    }
    this.controller.runJavaScript(sessionBootstrapJs(this.channel, this.chatId)).catch((e: Error) => {
      // 注入失败不影响承载面（下一帧/下次切换会再试）；不弹错。
      console.warn(`[web-host] session inject failed: ${e.message}`);
    });
  }

  aboutToAppear(): void {
    this.nativeBridge.handler = (m: BridgeMessage): void => {
      this.onBridgeMessage(m);
      this.applyHostAction(m);
    };
    // ⛔ **先注入会话 cookie 再让页面开始发请求**（用户亲报「点开插件 git 面板直接 401」）：
    //    ArkWeb 的 cookie 存储独立于原生 cookie jar ⇒ 不注入则 SPA 的每个 XHR 都 401。
    this.syncSessionCookie();
    // `@Prop` 初值不触发 @Watch ⇒ 首帧手动置一次加载态（空 url 则由页面后续赋值触发）。
    if (this.url.length > 0) {
      this.phase = WEB_PHASE_LOADING;
    }
  }

  /**
   * 把应用级会话 cookie 写进 ArkWeb 的 cookie 存储（幂等；空 cookie / 非法 url 时静默跳过）。
   *
   * 判据是"**取 origin**"而不是整条 url：ArkWeb 的 `configCookieSync` 按 url 归域，写根路径
   * 才能覆盖该站点的全部请求（插件资源 `/plugins/...`、接口 `/api/...` 同在根路径下）。
   * 失败只记日志，绝不影响承载（旁路）。
   */
  private syncSessionCookie(): void {
    const cookie: string = this.sessionCookie.length > 0 ? this.sessionCookie : '';
    if (cookie.length === 0 || this.url.length === 0) {
      return;
    }
    try {
      const origin: string = hostPageUrl(this.url);
      webview.WebCookieManager.configCookieSync(origin, cookie, false);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      console.error(`xbot web: 注入会话 cookie 失败（已忽略）: ${err.message}`);
    }
  }

  /** 承载面状态条（判据在 core；本组件只消费）。 */
  private status(): WebStatus {
    return webStatusOf(this.phase, this.loadErr);
  }

  /** 刷新当前页（chrome 的 ⟳ 与失败态"重试"共用同一入口）。 */
  private refresh(): void {
    this.phase = WEB_PHASE_LOADING;
    this.loadErr = '';
    try {
      this.controller.refresh();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      console.error(`refresh failed: ${err.message}`);
    }
  }

  /**
   * 执行宿主 chrome 级动作（纯判定见 `hostActionFor`；这里只做副作用 + 不崩）。
   * 业务类型（call/notify/…）判定为 `ignore` ⇒ 不在此"假装处理"。
   */
  private applyHostAction(m: BridgeMessage): void {
    try {
      const action: BridgeHostAction = hostActionFor(m);
      if (action.kind === BRIDGE_ACTION_CLOSE) {
        this.onClose();
        return;
      }
      if (action.kind === BRIDGE_ACTION_LOG) {
        console.log(`[web-host] ${action.text}`);
        return;
      }
      if (action.kind === BRIDGE_ACTION_READY) {
        // 页面就绪握手 ⇒ 下发 `init`（主题等宿主能力）。id 固定且合法（BRIDGE_ID_RE）。
        this.postToPageRaw('host-init', 'init', bridgeInitPayload(this.theme));
        return;
      }
      if (action.kind === BRIDGE_ACTION_CLIPBOARD) {
        // 剪贴板写代理（§21.122d）：**文本为空的请求直接丢弃** —— 页面拿到的是
        // `Promise.resolve()`（不抛错），若宿主此时真写剪贴板就会把用户已有内容清成空串。
        // ⛔ 该判据与 `clipboardTextOf` 同源（`text` 已收敛/截断），组件不另判一次。
        if (action.text.length > 0) {
          this.onClipboardWrite(action.text);
        }
        return;
      }
      if (action.kind === BRIDGE_ACTION_DIFF) {
        // 原生 diff 代理（通用协议）：坏包 ⇒ null ⇒ **什么都不做**（绝不开空 diff 骗用户）。
        const req: DiffBridgeRequest | null = parseDiffBridgePayload(action.text);
        if (req !== null) {
          this.onOpenDiff(req.path, req.commit);
        }
        return;
      }
      if (action.kind === BRIDGE_ACTION_NAV) {
        // 面板导航意图（§21.122f）：结构化解析在纯函数里（白名单 + 截断）；
        // 坏包（非 JSON / 未知 kind）⇒ null ⇒ **什么都不做**（fail-closed，不猜语义）。
        const ev: HostNavEvent | null = parseHostNavPayload(action.text);
        if (ev !== null) {
          this.onHostNav(ev);
        }
        return;
      }
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      console.error(`applyHostAction failed: ${err.message}`);
    }
  }

  /**
   * 原生 → 页面：**唯一的 JS 执行出口**。
   *
   * ⛔ 安全红线：`js` 由调用方拼好；**任何来自外部的字符串必须先经 `JSON.stringify` 转义**
   *    （见 `postToPage`），否则页面可控内容会二次注入成可执行 JS。本方法只负责"执行 + 不崩"。
   * ✅ `runJavaScript` 返回 Promise ⇒ 必须 `.catch`；同步调用处再 try/catch 兜底 BusinessError。
   */
  private evalToPage(js: string): void {
    try {
      this.controller.runJavaScript(js).catch((e: Error) => {
        console.error(`evalToPage failed: ${e.message}`);
      });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      console.error(`evalToPage threw: ${err.message}`);
    }
  }

  /**
   * 原生 → 页面：投递一条桥消息。
   *
   * 通路：`window.dispatchEvent(new CustomEvent('xbot:bridge', { detail: <信封JSON串> }))`。
   * 页面侧监听 `xbot:bridge` 后 `JSON.parse(e.detail)` 即得信封（**页面侧接线**见交付说明）。
   *
   * ⛔ 防注入：`encode` 得到的是 JSON 串，**再经 `JSON.stringify` 转义**成 JS 字符串字面量
   *    后才拼进代码（`JSON.stringify` 会转义 `"`/`\`/换行/控制字符 ⇒ 无法逃逸出字符串）。
   *    绝不把 `payload` 原样拼接。
   *
   * @returns 是否发出（信封非法 / 编码失败 ⇒ false，调用方应放弃）。
   */
  postToPage(msg: BridgeMessage): boolean {
    const env: string = encodeBridgeMessage(msg);
    if (env.length === 0) {
      return false;
    }
    const literal: string = JSON.stringify(env);
    this.evalToPage(
      `window.dispatchEvent(new CustomEvent('xbot:bridge', { detail: ${literal} }))`,
    );
    return true;
  }

  /** 便捷入口：按 (id, type, payload) 构造并发送（不合法的信封直接不发送）。 */
  postToPageRaw(id: string, type: string, payload: string): boolean {
    const m: BridgeMessage | null = makeBridgeMessage(id, type, payload);
    if (m === null) {
      return false;
    }
    return this.postToPage(m);
  }

  onUrlChanged(): void {
    if (this.url.length === 0) {
      return;
    }
    // 换了目标页（插件 A → B / 原生 ⇄ Web UI）⇒ 对新 origin 重注入会话 cookie（幂等）
    this.syncSessionCookie();
    this.phase = WEB_PHASE_LOADING;
    this.loadErr = '';
    try {
      this.controller.loadUrl(this.url);
    } catch (e) {
      this.phase = WEB_PHASE_ERROR;
      this.loadErr = '无法加载 URL';
      console.error('loadUrl failed');
    }
  }

  build() {
    Column() {
      if (this.chrome) {
        Column() {
          Row() {
            // 返回：系统符号（⛔ 不用 `‹` 字符 —— 会走 emoji 字形/颜色不可控）
            // ⛔ 关闭/返回：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`；
            //    图标视觉尺寸不变（仍 `CHROME_GLYPH`，盒内居中）。
            Row() {
              SymbolGlyph($r('sys.symbol.chevron_left'))
                .fontSize(CHROME_GLYPH)
                .fontColor([colorOf(this.pal(), 'accentSoft')])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
            .justifyContent(FlexAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText('返回')
            .onClick(() => {
              this.onClose();
            })
          // 顶栏标题：**人类标签**，绝不显示原始 URL（`webChromeLabel` 纯函数，见 core/pluginview.ets）。
          // 取不到标签 ⇒ **不渲染**该文本节点（旧实现退回显示 `http://127.0.0.1:8082/?xbot_view=…`，丑）。
          if (webChromeLabel(this.title, this.url, this.chromeLabel).length > 0) {
            Text(webChromeLabel(this.title, this.url, this.chromeLabel))
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), 'textSecondary'))
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          } else {
            // 无标签 ⇒ 用空白撑住中间（保持「返回」在左、「刷新」在右的位置不漂移）。
            Blank().layoutWeight(1)
          }
          // 刷新：系统符号（⛔ 不用 `⟳` 字符）
          // ⛔ 刷新：同上 —— 真实 44×44 布局盒承载 `onClick`（`onClick` 落在盒上，不依赖越界扩展）。
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise'))
              .fontSize(CHROME_GLYPH)
              .fontColor([colorOf(this.pal(), 'accentSoft')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('刷新')
          .onClick(() => {
            this.refresh();
          })
        }
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .alignItems(VerticalAlign.Center)
        .padding({ left: SPACE_XS, right: SPACE_XS })
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))
          Divider()
            .strokeWidth(STROKE_HAIRLINE)
            .color(hairlineOf(this.pal()))
            .width('100%')
        }
        .width('100%')
      }

      // ── 承载面状态条（**恒静态**，不是 spinner）─────────────────────────────────
      // loading：只在带 chrome 时显示（全屏 web 模式"一行原生 UI 都不留"）；
      // error  ：**恒**显示（否则加载失败 = 白屏无解释，用户无从判断）。
      if (this.status().show && (this.chrome || this.status().canRetry)) {
        Row({ space: SPACE_XS }) {
          Text(this.status().text)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(colorOf(this.pal(), this.status().colorRole))
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.status().canRetry) {
            Text('重试')
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), 'accentSoft'))
              .padding({
                left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
              })
              .borderRadius(RADIUS_PILL)
              .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.refresh();
              })
          }
          // ⛔ **无 chrome**（全屏承载完整 web UI）时，错误条必须自带**退回原生**出口 ——
          //    否则坏 URL（404/401/离线且页面无自带返回）会把用户**困在空白 Web 里**，
          //    错误条上只有「重试」⇒ 只能杀进程。有 chrome 时顶部已有「‹ 返回」，不重复。
          if (!this.chrome) {
            Text('返回')
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), 'textSecondary'))
              .padding({
                left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
              })
              .borderRadius(RADIUS_PILL)
              .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onClose();
              })
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({
          left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
        })
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))
      }

      Web({ src: this.url, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .geolocationAccess(false)
        .mixedMode(MixedMode.All)
        .zoomAccess(true)
        .horizontalScrollBarAccess(false)
        .darkMode(WebDarkMode.Auto)
        // ── JS 桥：把 `window.xbotNative` 注入所有 frame ──────────────────────────
        // ⚠️ 注册时机：`javaScriptProxy` 是 `Web` 组件的**属性**，在组件创建（本 build 链）时
        //    完成注册，**先于页面导航**——所以页面第一批脚本就能看到 `window.xbotNative`。
        //    若页面**已加载后**再改代理，需走 `controller.registerJavaScriptProxy(...)` +
        //    `refresh()` 才生效（本组件用属性方式，随组件创建自动注册，无需手动 refresh）。
        //    「属性注册 vs 首次 src 导航的先后」——✅ **已真机证实**（2026-10-11，本机 SDK 21）：
        //    注入发生在**文档最早期**（`readyState="loading"` 且 `hasHead=false/hasBody=false`，
        //    即 `<head>` 尚未解析）时，`typeof window.xbotNative === "object"` ⇒ 属性式注册确实
        //    **先于页面脚本**。（探针原文与复现命令见 `docs/WEB-PARITY.md §8.7`；⚠️ 该节同时记录了
        //    "注入真桥前必须收窄 `scriptRules`" 的纪律 —— 探针不得直接放大成桥。）
        // ⚠️ methodList 必须逐一列出要暴露的方法名；漏写则页面侧 `xbotNative.postMessage` 为 undefined。
        .javaScriptProxy({
          object: this.nativeBridge,
          name: 'xbotNative',
          methodList: ['postMessage'],
          controller: this.controller,
        })
        // ── 早期注入探针：`runJavaScriptOnDocumentStart`（`@since 15`，`WebAttribute`）──────
        // 语义（SDK 原文）："after the root element (HTML Element) of the web page file is created,
        // but before any other content is loaded" ⇒ 这是**唯一**能在页面脚本前注入的官方能力。
        // ⚠️ `ScriptItem` 以字面量传入（形参类型已知 ⇒ ArkTS 允许，同 `Web({...})` 的 `WebOptions`）。
        // 两条脚本都在**页面脚本之前**执行：
        //   ① `CLIPBOARD_SHIM_JS` —— `navigator.clipboard` 垫片（§21.122d：非 secure context 下
        //      浏览器不提供该 API ⇒ web 侧 9+ 处"复制"全部静默失效；垫片把写操作转成 JS 桥消息）。
        //      ⛔ 必须在**业务脚本之前**装好：web 侧是启动时就取 `navigator.clipboard` 的形态。
        //   ② `PROBE_JS` —— 只观测（列出 window 上 /xbot/i 的全局名）。
        // ⚠️ `scriptRules: ['*']` = 所有来源。
        .runJavaScriptOnDocumentStart([
          { script: CLIPBOARD_SHIM_JS, scriptRules: ['*'] },
          { script: PROBE_JS, scriptRules: ['*'] },
          // ③ **会话身份注入**（用户 2026-10-17 P0「pwd/cwd 都是错的」）：必须在**页面脚本之前**，
          //    否则插件首次 RPC 就已经按"未就绪"走了兜底路径。会话 id 为空时注入空串（无害）。
          {
            script: this.chatId.length > 0 ? sessionBootstrapJs(this.channel, this.chatId) : '',
            scriptRules: ['*'],
          },
        ])
        // 页面 `console.*` → 原生日志（tag = PROBE_TAG）⇒ 真机 `hdc shell hilog` 可观测注入是否发生。
        // 返回 false = 不消费（不阻断页面自身的 console 行为）。
        .onConsole((event) => {
          try {
            if (event !== undefined && event.message !== undefined) {
              hilog.info(0x0000, PROBE_TAG, '%{public}s', event.message.getMessage());
            }
          } catch (e) {
            // 观测通路不得影响页面（console 取字段失败即放弃这条）
          }
          return false;
        })
        // ── 新窗口请求代理（`window.open(...)` / `<a target="_blank">`）─────────────────
        // ⛔ ArkWeb **不接**此回调 ⇒ 新窗口请求**整块静默失效**（点了没反应、无日志）。web 侧
        //    实证调用点：`MessageActions.tsx:127`（消息「打开链接」）、`MarkdownRenderer.tsx:274/316`
        //    （正文里的链接）、9 处 `target="_blank"` ⇒ 不代理 = 所有 WebView 里外链都是死的。
        //    判定在纯函数 `core/webbridge.ets:newWindowAction`（同源 ⇒ 本 WebView 内导航；
        //    非同源且在协议白名单内 ⇒ 系统浏览器；其余 ⇒ 只拦不跳）。组件只执行副作用。
        // ⛔ SDK 硬约束：本回调里**必须**调 `handler.setWebController(...)`（不开新窗传 null），
        //    **否则渲染进程阻塞** ⇒ 所以无论判定结果都回话，且只在 `external` 时交给上层。
        .onWindowNew((event) => {
          try {
            const abs: string = resolveOpenable(event.targetUrl, this.url);
            const act: string = newWindowAction(event.targetUrl, this.url, this.url);
            if (act === NEW_WINDOW_IN_WEB) {
              this.controller.loadUrl(abs);
            } else if (act === NEW_WINDOW_EXTERNAL) {
              this.onOpenExternal(abs);
            }
          } catch (e) {
            // 代理失败不得阻断导航（宁可只拦不跳）
          }
          event.handler.setWebController(null);
        })
        // ── §21.122d 余项①：`<input type=file>` 代理 ──────────────────────────────
        // ⛔ 必须处理且**必须回话**：ArkWeb 自身不弹选择器；不调
        //    `event.result.handleFileList(...)` 该请求会永久挂着（页面 `onChange` 永不触发）。
        // 返回值 true = 本宿主接管（异步的选择/复制/回话在 handleFileSelector 内完成）。
        .onShowFileSelector((event) => {
          this.handleFileSelector(event);
          return true;
        })
        // ── §21.122d 余项②：页面下载代理 ────────────────────────────────────────
        // ArkWeb 不接此回调时**不会**自行下载 ⇒ 页面"导出/下载"点了没反应。
        // 文件名推导（Content-Disposition → URL → 兜底 + 清洗）在纯函数里，本处只发任务。
        .onDownloadStart((event) => {
          this.startWebDownload(event.url,
            downloadFileNameOf(event.url, event.contentDisposition, event.mimetype));
        })
        .onPageBegin((event) => {
          // ⛔ 不再把 URL 当标题（旧实现 `this.title = event.url` 正是"顶栏显示一条丑 URL"的
          //    根因）。标题一律来自 `onTitleReceive`（页面 `document.title`）+ 调用方给的人类标签。
          this.title = '';
          // 新导航开始 ⇒ 清掉上一次的失败态（否则失败后成功加载仍显示错误条）
          this.phase = WEB_PHASE_LOADING;
          this.loadErr = '';
        })
        // 页面标题（`document.title`）→ 顶栏标签的**次选**来源（首选是调用方的 `chromeLabel`）。
        // 取不到（未触发/空串）⇒ 保持空串，由 `webChromeLabel` 决定最终展示（可能不展示）。
        // ⚠️ SDK 声明 `onTitleReceive(callback: Callback<OnTitleReceiveEvent>)`（`web.d.ts:6275`，
        //    `title: string` 非可选，@since 12）⇒ **不得**写 `event !== undefined` 之类的比较
        //    （ArkTS/TS 会给 TS2367「无重叠」）。取字段失败只可能来自内核异常 ⇒ try 兜住。
        .onTitleReceive((event) => {
          try {
            this.title = event.title;
          } catch (e) {
            this.title = '';
          }
        })
        .onPageEnd((event) => {
          // 失败后再来的 onPageEnd 不得把错误态刷成就绪（错误条要保持到用户重试/换页）
          if (this.phase !== WEB_PHASE_ERROR) {
            this.phase = WEB_PHASE_READY;
          }
          // ── **宿主身份再断言**（宿主权威；幂等）──────────────────────────────
          // 用户 2026-10-17 真机 P0「web 版 git 面板说不是 git 目录」：web 侧会话 store 启动时
          // 会按**缓存的会话树**自动选中一个 activeSession 并写回 `window.__xbot_session__`
          // （`useSessionStore.ts:945-949` + `usePluginRuntimeHost.ts`）⇒ **覆盖宿主身份** ⇒
          // 插件 RPC 带错会话 ⇒ 后端注入错 cwd（非 repo）。
          // web 侧已修成"嵌入 + 宿主已注入 ⇒ 不覆盖"，这里再加一道：页面加载完成后**再断言一次**
          // （任何第三方脚本在我们之后改写全局都会被拉回宿主身份）。⛔ 幂等、只写这一个全局。
          if (this.chatId.length > 0) {
            this.controller.runJavaScript(sessionBootstrapJs(this.channel, this.chatId)).catch((e: Error) => {
              hilog.warn(0x0000, PROBE_TAG, 'session re-assert fail %{public}s', e.message);
            });
          }
          // ── 探针回读（只观测）──────────────────────────────────────────────
          // 证明 `window.__xbotProbe` **真的留在了页面上**（含注入时机信号：readyState/hasHead/hasBody
          // + `nativeType` = 属性式 `javaScriptProxy` 是否早于页面脚本）。读不到 ⇒ 注入没生效。
          this.controller.runJavaScript('JSON.stringify(window.__xbotProbe || null)')
            .then((r: string) => {
              hilog.info(0x0000, PROBE_TAG, 'probe %{public}s', r);
            })
            .catch((e: Error) => {
              hilog.error(0x0000, PROBE_TAG, 'probe-read fail %{public}s', e.message);
            });
        })
        .onErrorReceive((event) => {
          // ⛔ 加载失败**必须可见**（旧实现只 console.error ⇒ 空白屏无解释）。
          //    ArkWeb 的 `WebResourceError` 用 getter 取原因（不同内核版本成员不同 ⇒ 走 API）。
          try {
            if (event !== undefined && event.error !== undefined) {
              const info: string = event.error.getErrorInfo();
              const code: number = event.error.getErrorCode();
              this.loadErr = webErrorDetail(info, code);
              this.phase = WEB_PHASE_ERROR;
              console.error(`web error: ${info} (${code})`);
            }
          } catch (e) {
            this.phase = WEB_PHASE_ERROR;
            console.error('web error (无法序列化)');
          }
        })
        .onHttpErrorReceive((event) => {
          // ⛔ **HTTP 层**错误（404 插件产物缺失 / 401 会话失效 / 5xx）：`onErrorReceive` 只覆盖
          //    **资源级**失败（DNS/连接/证书）⇒ 状态码错误此前**零处理** ⇒ 空壳页面且原生无解释。
          //    与 `onErrorReceive` 同一条状态条通道（`webStatusOf` 的 error 档 ⇒ 红字 + 重试）。
          try {
            if (event !== undefined && event.response !== undefined) {
              const code: number = event.response.getResponseCode();
              const reason: string = event.response.getReasonMessage();
              this.loadErr = webHttpErrorDetail(code, reason);
              this.phase = WEB_PHASE_ERROR;
              console.error(`web http error: ${code} ${reason}`);
            }
          } catch (e) {
            this.phase = WEB_PHASE_ERROR;
            console.error('web http error (无法序列化)');
          }
        })
        // ── 插件视图**深链导航拦截**（2026-10-13，目标④「支持 web 所有插件 + 未来插件」）──
        // web 插件 `ctx.ui.openViewTab` 打开视图时，宿主页会把视图映射成 `?xbot_view=<viewId>`
        // 深链导航；原生端据此拦截，路由到原生面板（`nativeViewKind` 非空的那类）。
        // ⛔ 返回 true = 拦截（不再让 WebView 加载）；false = 放行（无原生落地 ⇒ WebView 兜底）。
        // ⛔ **带「WebView 直渲」标记的深链一律放行**（用户 2026-10-14 定向：插件内容由 webview
        //    渲染插件自带 UI，原生只做外壳 + 事件代理；标记由宿主插件入口打，见 `embedPluginViewLink`）。
        .onLoadIntercept((event) => {
          try {
            const targetUrl: string = event.data.getRequestUrl();
            if (isEmbeddedViewLink(targetUrl)) {
              return false;
            }
            const link = parseXbotViewLink(targetUrl);
            if (link !== null && nativeViewKind(link.viewId).length > 0) {
              this.onOpenView(link.viewId, link.title, targetUrl, link.params);
              return true;
            }
          } catch (e) {
            // 拦截协议失败不得阻断导航（宁可放行走 WebView 兜底）
          }
          return false;
        })
        .width('100%')
        .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(colorOf(this.pal(), 'appBg'))
  }
}
