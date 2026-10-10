import { Palette, paletteOf } from '../core/theme';
import {
  PluginCatalogGroup,
  PluginCatalogItem,
  PluginViewItem,
  PLUGIN_OPEN_DIRECT,
} from '../core/pluginhost';
import { WebSurface } from './WebSurface';

/**
 * PluginHost —— **插件目录 + 宿主页承载**（可注入组件）。
 *
 * ── 它解决什么 ───────────────────────────────────────────────────────────────
 * 波1b 之前，"打开插件"= 打开一个裸 ESM 地址（面板显示 JS 源码）；波1b 修成语义正确的
 * **权威宿主页**，但用户在宿主页里仍得**自己找**插件。本组件把服务端下发的
 * `web.contributes`（视图贡献点）渲染成**原生目录**：有哪些插件、各自能开什么视图、
 * 视图落在宿主 UI 的哪个位置（容器分组），点一下即打开宿主页。
 *
 * ── 为什么目录是原生的、插件 UI 仍是宿主页 ───────────────────────────────────
 * 插件产物是**同页 ESM 模块**，顶层就读宿主注入的 `window.React` / `window.__xbot_*`
 * （证据见 `core/pluginhost.ets` 文件头）⇒ 只有 web 应用本体（权威宿主页）能跑它们。
 * 原生能且**只该**做的是"目录 + 承载"：目录信息完全来自 `web_plugin_list` 的元数据。
 *
 * ── 注入契约（下一波在 `pages/Index.ets` 里接）────────────────────────────────
 * ```ts
 * const catalog = await store.loadPluginCatalog(this.locale);
 * PluginHost({
 *   items: catalog.items,          // 插件条目（名称/描述/版本/视图数/可打开 URL）
 *   groups: catalog.groups,        // 按容器（侧栏/信息栏/状态栏…）聚合的视图
 *   theme: this.themeName,
 *   panelUrl: this.panelUrl,       // 空 ⇒ 只显示目录；非空 ⇒ 承载宿主页
 *   onOpen: (url: string) => { this.panelUrl = url; },
 *   onClose: () => { this.panelUrl = ''; },
 * })
 * ```
 *
 * ⚠️ 组件成员契约（ArkUI 硬约束）：
 *   · 会变的内容一律 `@Prop`（`items`/`groups`/`theme`/`panelUrl`）—— 父组件赋新数组即重建列表；
 *   · **回调用普通成员**（`onOpen`/`onClose`）：ArkTS 的 `@Prop/@State` 承载函数类型不可靠
 *     （装饰器做值拷贝/观测，函数不是可观测数据），与 `WebSurface.ets:94-98` 的处理一致；
 *   · 行渲染**内联在 `ForEach` 闭包里**，不用带参 `@Builder`（`@Builder` 参数是"调用那刻的快照"
 *     ⇒ 会卡在首帧，见 `docs/ARKTS-GOTCHAS.md`）。
 */
@Component
export struct PluginHost {
  /** 插件条目（`store.loadPluginCatalog()` 产出；`@Prop` 承载整表 ⇒ 变化即重建）。 */
  @Prop items: PluginCatalogItem[] = [];
  /** 按容器聚合的视图分组（目录的"分区"）。 */
  @Prop groups: PluginCatalogGroup[] = [];
  @Prop theme: string = 'dark';
  /** 要承载的宿主页 URL（空 ⇒ 只显示目录）。 */
  @Prop panelUrl: string = '';

  /** 点"打开"：把目标 URL 交给上层（上层写进 `panelUrl` 或自行导航）。 */
  onOpen: (url: string) => void = () => {
  };
  /** 关闭宿主页（WebSurface 的"‹ 返回"）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 插件图标名 → HarmonyOS 符号。
   *
   * ⚠️ **真实的映射缺口**：清单里的 `icon` 是 **lucide** 名（`git-branch`/`server`/`chart`…，
   * 见 web `plugin-runtime/pluginIcons.ts`），与 HarmonyOS `sys.symbol.*` **不是一一对应**
   * ⇒ 这里只覆盖少数语义接近的，其余一律回落通用方块（`square_grid_2x2`）。
   * 符号名必须写成**字面量**（ArkTS 不允许 `$r('sys.symbol.' + x)` 这种拼装）。
   */
  private symbolFor(icon: string): Resource {
    if (icon === 'server' || icon === 'server-cog') {
      return $r('sys.symbol.rectangle_on_rectangle');
    }
    if (icon === 'git-branch' || icon === 'git' || icon === 'git-commit-horizontal') {
      return $r('sys.symbol.circle_dashed');
    }
    if (icon === 'chart' || icon === 'activity' || icon === 'sparkline') {
      return $r('sys.symbol.line_3_horizontal');
    }
    if (icon === 'tasks' || icon === 'files' || icon === 'code' || icon === 'terminal') {
      return $r('sys.symbol.doc_text');
    }
    return $r('sys.symbol.square_grid_2x2');
  }

  build() {
    Column() {
      if (this.panelUrl.length > 0) {
        // ── 承载宿主页：插件 UI 在这里按 web 语义运行（原生不再干预其内部）────────
        WebSurface({
          url: this.panelUrl,
          theme: this.theme,
          onClose: () => {
            this.onClose();
          },
        })
      } else {
        // ── 原生目录（数据全部来自 web_plugin_list 元数据，零猜测）──────────────
        Scroll() {
          Column({ space: 10 }) {
            Row() {
              Text(`插件目录（${this.items.length}）`)
                .fontSize(14)
                .fontColor(this.pal().textPrimary)
                .layoutWeight(1)
              Text('在宿主页里运行').fontSize(11).fontColor(this.pal().textMuted)
            }
            .width('100%')
            .padding({ left: 12, right: 12, top: 10, bottom: 4 })

            if (this.items.length === 0) {
              Text('没有声明前端产物的插件（服务端未启用插件系统，或插件都没有 web.entry）')
                .fontSize(12)
                .fontColor(this.pal().textMuted)
                .padding(12)
            }

            // ── 插件列表 ──────────────────────────────────────────────────────
            ForEach(this.items, (p: PluginCatalogItem) => {
              Column({ space: 4 }) {
                Row({ space: 8 }) {
                  SymbolGlyph(this.symbolFor(p.icon)).fontSize(16)
                    .fontColor([this.pal().accentSoft])
                  Text(p.name).fontSize(14).fontColor(this.pal().textPrimary).layoutWeight(1)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (p.version.length > 0) {
                    Text(`v${p.version}`).fontSize(10).fontColor(this.pal().textMuted)
                  }
                  if (p.state.length > 0 && p.state !== 'active') {
                    // 非 active（禁用/未激活）如实标注：不假装可用。
                    // 语气是**中性**，不是出错 —— web 权威基准 `PluginManagerPanel.tsx:223`
                    // (`isActive ? 'bg-green-500' : 'bg-slate-400'`) 非 active = 中性灰。
                    // 用 `textSecondary` 而非 `textMuted`：后者（porcelain `#AEAEB2`）叠在
                    // `surfaceAlt` 上对比度不足，10px 字读不清；`textSecondary` 五套主题都达标。
                    Text(p.state).fontSize(10).fontColor(this.pal().textSecondary)
                      .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                      .borderRadius(6)
                      .backgroundColor(this.pal().surfaceAlt)
                  }
                }
                .width('100%')

                if (p.description.length > 0) {
                  Text(p.description).fontSize(11).fontColor(this.pal().textSecondary)
                    .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
                }

                Row({ space: 6 }) {
                  Text(`${p.views.length} 个视图`).fontSize(11).fontColor(this.pal().textMuted)
                  Text(p.moduleUrl).fontSize(9).fontColor(this.pal().textMuted).layoutWeight(1)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text('打开').fontSize(12).fontColor(this.pal().accentSoft)
                }
                .width('100%')
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(10)
              .onClick(() => {
                this.onOpen(p.url);
              })
            }, (p: PluginCatalogItem) => `plugin#${p.id}#${p.url}`)

            // ── 视图分组（按容器：侧栏 / 信息栏 / 状态栏…，与 web 布局位对应）────
            ForEach(this.groups, (g: PluginCatalogGroup) => {
              Column({ space: 4 }) {
                Text(g.label).fontSize(12).fontColor(this.pal().textSecondary)
                  .width('100%').padding({ left: 4, top: 6 })
                ForEach(g.views, (v: PluginViewItem) => {
                  Row({ space: 8 }) {
                    SymbolGlyph(this.symbolFor(v.icon)).fontSize(14)
                      .fontColor([this.pal().accentSoft])
                    Column({ space: 1 }) {
                      Text(v.title).fontSize(13).fontColor(this.pal().textPrimary)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      Text(v.pluginName).fontSize(10).fontColor(this.pal().textMuted)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    if (v.dynamic) {
                      // 参数化视图（VSCode webviewPanel 语义）：只能由宿主内部 openViewTab 打开
                      Text('按需').fontSize(10).fontColor(this.pal().textMuted)
                        .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                        .borderRadius(6).backgroundColor(this.pal().appBg)
                    }
                    Text('打开').fontSize(12).fontColor(this.pal().accentSoft)
                  }
                  .width('100%')
                  .padding({ left: 12, right: 12, top: 8, bottom: 8 })
                  .backgroundColor(this.pal().surfaceAlt)
                  .borderRadius(8)
                  .onClick(() => {
                    // 直开（同源页面 URL）与"进宿主页"在 core 侧已判好，这里只执行
                    this.onOpen(v.openUrl);
                  })
                }, (v: PluginViewItem) => `view#${v.id}`)
              }
              .width('100%')
            }, (g: PluginCatalogGroup) => `group#${g.container}`)

            // 说明：为什么点开后是宿主页 —— 诚实告知用户与实现者
            Text('说明：插件 UI 是浏览器 ESM 模块（需要 web 宿主的 React 与能力注入），'
              + '因此点击后在宿主页内运行；本目录只做"有哪些插件/视图"的索引。')
              .fontSize(10)
              .fontColor(this.pal().textMuted)
              .padding({ left: 12, right: 12, top: 8, bottom: 12 })
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().appBg)
  }
}
