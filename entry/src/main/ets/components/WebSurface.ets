import { webview } from '@kit.ArkWeb';
import { Palette, paletteOf } from '../core/theme';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  BridgeMessage, parseBridgeMessage, encodeBridgeMessage, encodeBridgeAck, makeBridgeMessage,
} from '../core/webbridge';

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
   */
  @Prop chrome: boolean = true;
  /** 关闭回调（由页面清空 url 卸载本组件）。 */
  onClose: () => void = () => {
  };
  private controller: webview.WebviewController = new webview.WebviewController();
  @State title: string = '';

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
   * 把 `nativeBridge` 的回调接到 `onBridgeMessage`。
   * ⚠️ 必须在 `aboutToAppear`（早于 build / 页面加载）完成，确保页面第一次调
   *    `xbotNative.postMessage` 时回调已就位。
   */
  aboutToAppear(): void {
    this.nativeBridge.handler = (m: BridgeMessage): void => {
      this.onBridgeMessage(m);
    };
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
   * 页面侧监听 `xbot:bridge` 后 `JSON.parse(e.detail)` 即得信封（**波1b 负责页面侧接线**）。
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
    try {
      this.controller.loadUrl(this.url);
    } catch (e) {
      console.error('loadUrl failed');
    }
  }

  build() {
    Column() {
      if (this.chrome) {
        Row() {
          Text('‹ 返回').fontSize(15).fontColor(this.pal().accentSoft).padding(10).onClick(() => {
            this.onClose();
          })
          Text(this.title.length > 0 ? this.title : this.url)
            .fontSize(12)
            .fontColor(this.pal().textSecondary)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('⟳').fontSize(16).fontColor(this.pal().accentSoft).padding(10).onClick(() => {
            try {
              this.controller.refresh();
            } catch (e) {
              const err: BusinessError = e as BusinessError;
              console.error(`refresh failed: ${err.message}`);
            }
          })
        }
        .width('100%')
        .constraintSize({ minHeight: 48 })
        .backgroundColor(this.pal().surfaceAlt)
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
        //    「属性注册 vs 首次 src 导航的先后」以 ArkWeb 内核实现为准 —— **待真机验证**。
        // ⚠️ methodList 必须逐一列出要暴露的方法名；漏写则页面侧 `xbotNative.postMessage` 为 undefined。
        .javaScriptProxy({
          object: this.nativeBridge,
          name: 'xbotNative',
          methodList: ['postMessage'],
          controller: this.controller,
        })
        .onPageBegin((event) => {
          this.title = event !== undefined ? event.url : '';
        })
        .onErrorReceive((event) => {
          // ArkWeb 的错误对象在不同内核版本上暴露的成员不同 ⇒ 不假设方法存在
          try {
            if (event !== undefined && event.error !== undefined) {
              console.error(`web error: ${JSON.stringify(event.error)}`);
            }
          } catch (e) {
            console.error('web error (无法序列化)');
          }
        })
        .width('100%')
        .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().appBg)
  }
}
