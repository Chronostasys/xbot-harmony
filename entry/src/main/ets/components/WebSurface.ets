import { webview } from '@kit.ArkWeb';
import { Palette, paletteOf } from '../core/theme';
import { BusinessError } from '@kit.BasicServicesKit';

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
