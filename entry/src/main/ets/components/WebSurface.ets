import { webview } from '@kit.ArkWeb';
import { Palette, paletteOf } from '../core/theme';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  BridgeMessage, parseBridgeMessage, encodeBridgeMessage, encodeBridgeAck, makeBridgeMessage,
  BridgeHostAction, BRIDGE_ACTION_CLOSE, BRIDGE_ACTION_LOG, BRIDGE_ACTION_READY,
  hostActionFor, bridgeInitPayload,
} from '../core/webbridge';
import {
  WEB_PHASE_ERROR, WEB_PHASE_IDLE, WEB_PHASE_LOADING, WEB_PHASE_READY,
  WebStatus, webErrorDetail, webHttpErrorDetail, webStatusOf,
} from '../core/pluginview';
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
  + '}catch(e){console.log("[XBOT-PROBE] fail "+e);}})();';

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
   * 把 `nativeBridge` 的回调接到 `onBridgeMessage`，并执行**宿主 chrome 级动作**。
   * ⚠️ 必须在 `aboutToAppear`（早于 build / 页面加载）完成，确保页面第一次调
   *    `xbotNative.postMessage` 时回调已就位。
   *
   * 两条路径分工（判定在 `core/webbridge.ets:hostActionFor` 这个纯函数里，组件只执行副作用）：
   *   · `applyHostAction` —— 组件自己能闭环的：`close`（关承载页）/ `log`（转原生日志）/
   *     `ready`（握手 ⇒ 回 `init` 下发主题）；
   *   · `onBridgeMessage` —— 业务消息交给**上层**（由调用方接线；未接线时安全丢弃）。
   */
  aboutToAppear(): void {
    this.nativeBridge.handler = (m: BridgeMessage): void => {
      this.onBridgeMessage(m);
      this.applyHostAction(m);
    };
    // `@Prop` 初值不触发 @Watch ⇒ 首帧手动置一次加载态（空 url 则由页面后续赋值触发）。
    if (this.url.length > 0) {
      this.phase = WEB_PHASE_LOADING;
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
            .onClick(() => {
              this.onClose();
            })
          Text(this.title.length > 0 ? this.title : this.url)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(colorOf(this.pal(), 'textSecondary'))
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .padding({ left: SPACE_XS })
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
        // ⚠️ `scriptRules: ['*']` = 所有来源；只**观测**，不下发任何业务数据。
        .runJavaScriptOnDocumentStart([{ script: PROBE_JS, scriptRules: ['*'] }])
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
        .onPageBegin((event) => {
          this.title = event !== undefined ? event.url : '';
          // 新导航开始 ⇒ 清掉上一次的失败态（否则失败后成功加载仍显示错误条）
          this.phase = WEB_PHASE_LOADING;
          this.loadErr = '';
        })
        .onPageEnd((event) => {
          // 失败后再来的 onPageEnd 不得把错误态刷成就绪（错误条要保持到用户重试/换页）
          if (this.phase !== WEB_PHASE_ERROR) {
            this.phase = WEB_PHASE_READY;
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
        .width('100%')
        .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(colorOf(this.pal(), 'appBg'))
  }
}
