/**
 * PluginsSheet —— 「能力面板」（原 `pages/Index.ets` 的 `@Builder PluginsSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `plugins` 列表 + 回调；`showPlugins` / `panelUrl`
 * 所有权留页面（前者是弹层 flag 必须集中，后者是 ArkWeb 承载状态、页面独占）。
 *
 * ── 三态（加载 / 空 / 失败，2026-10-11 本波新增）─────────────────────────────────
 * 此前本面板**只有"有数据"一种样子**：RPC 慢 ⇒ 用户看到的是"关抽屉后什么都没有"；
 * RPC 失败 ⇒ 数据层把错误吞成空目录（`core/store.ets:loadPluginCatalog`）⇒ 面板**分不清空与失败**。
 * 现在三态判据收敛到 `core/pluginview.ets:pluginPanelStatus`（纯逻辑、可脱机单测），
 * 本组件**只画**：加载 = 一行小字（⛔ 不是 spinner —— 同一时刻只允许一个在飞动效=光球）；
 * 失败 = 一行红字 + **重试**；空 = 引导文案（去「完整 Web UI」装 / 让管理员启用）。
 *
 * ── 信息层次（对齐 web 设置弹窗「插件」分区 `settings/SettingsPlugins.tsx`）────────
 * 每行 = **图标 + 名称 +（有则）`v<版本> · <state>` + 一句描述 + 「打开」**（名称/说明/元信息三层灰阶）。
 * 数据是 `PluginCatalogItem`（比 `PluginPanelInfo` 多 description/version/state/views ⇒ 行才画得出层次）。
 *
 * ── 视觉语言（2026-10-11，与 `PluginHost` 对齐）──────────────────────────────
 * 「能力面板」是 `PluginHost`（原生插件目录）的**入口载体** ⇒ 用同一套语义令牌：
 *   · 字阶 = 语义排版档 `type.*`（标题 `type.headline` / 行名 `type.callout` / 说明 `type.caption`）；
 *   · 行卡 = `surfaceFillOf(p, SURFACE_CARD)` + **结构性发丝** `hairlineOf(p)` + `RADIUS_CARD`；
 *   · 内距 = `INSET_ROW_X/Y`；行间距 = `GAP_ROW_Y`；
 *   · 按压走全站唯一 `PRESS_OPACITY`；行命中区 ≥ `HIT_TARGET_MIN`（`constraintSize`）；
 *   · 关闭按钮热区用 `responseRegion` 外扩（⛔ 不改布局/视觉尺寸）。
 * ⛔ 颜色不写 hex；状态行的色走 `pluginPanelStatus().colorRole`（`core/pluginview.ets` 产出的合法角色）；
 *    浅/深分叉只走 `isLightPalette(paletteOf(theme))`。
 */
import { Palette, paletteOf } from '../core/theme';
import { PluginCatalogItem } from '../core/pluginhost';
import { PluginPanelStatus, pluginMetaText, pluginPanelStatus } from '../core/pluginview';
// 插件图标映射**唯一出口** = `PluginHost` 的 `pluginSymbol`（19/19 覆盖 web `ICON_MAP`）——
// ⛔ 不在本面板再写一份副本（副本会腐烂 / 各写一份 ⇒ 同一插件两处图标不一致）。
import { pluginSymbol } from './PluginHost';
import {
  colorOf, GAP_ROW_Y, hairlineOf, structuralRuleOf, surfaceFillOf, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_SHEET, SPACE_MD, SPACE_SM, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD, ICON_LG } from '../core/design';
import { fs, fw } from './SettingsRows';
// 弹层**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造时长/曲线；E3 统一）。
import { sheetTransition } from './anim';

/**
 * 关闭 X 的命中盒 —— ⛔ 热区**不靠** `responseRegion` 负偏移外扩（真机实测（SDK21）**无效**，
 * 见 `AGENTS.md` GOTCHAS）⇒ 图标放进**真实 `HIT_TARGET_MIN`×`HIT_TARGET_MIN` 布局盒**、盒内居中。
 * 图标视觉尺寸不变（仍 `ICON_LG`=16）。
 */
/** 插件图标视觉边长（vp）—— 与 `PluginHost` 卡片（18）同档。 */
const PLUGIN_ICON: number = 18;

@Component
export struct PluginsSheet {
  @Prop theme: string = 'dark';
  /** 插件面板列表（页面 `pluginItems`；`PluginCatalogItem` 才有 description/version/state）。 */
  @Prop plugins: PluginCatalogItem[] = [];
  /** 视图分组数（空态判据要**同时**看 items 与 groups）。 */
  @Prop groupCount: number = 0;
  /** 是否正在拉目录（页面加载态）。 */
  @Prop loading: boolean = false;
  /** 加载失败原因（**已可读化**；空 = 无错）。 */
  @Prop error: string = '';
  /** 打开**原生**插件目录宿主页（页面 `openPluginHost()`）。 */
  onOpenPluginHost: () => void = () => {
  };
  /** 打开**完整 Web UI**（页面用自己的 serverUrl 置 `panelUrl`）。 */
  onOpenWebUi: () => void = () => {
  };
  /** 打开某个插件面板（页面置 `panelUrl = p.url`）。 */
  onOpenPlugin: (p: PluginCatalogItem) => void = () => {
  };
  /** 重试拉目录（页面 `loadPluginCatalog()`）。 */
  onRetry: () => void = () => {
  };
  /** 关闭面板（页面置 `showPlugins=false`）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 三态状态行（判据在 `core/pluginview.ets`；**判据与渲染同源**）。 */
  private status(): PluginPanelStatus {
    return pluginPanelStatus(this.loading, this.plugins.length, this.groupCount, this.error);
  }

  /** 一行「跳转入口」（能力面板的两条固定入口：原生目录 / 完整 Web UI）。 */
  @Builder
  EntryRow(label: string, onClick: () => void) {
    Row() {
      Text(label).fontSize(fs('type.callout')).fontColor(this.pal().textPrimary).layoutWeight(1)
      Text('打开').fontSize(fs('type.caption')).fontColor(this.pal().accentSoft)
    }
    .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .margin({ bottom: GAP_ROW_Y })
    .onClick(() => {
      onClick();
    })
  }

  build() {
    Column({ space: SPACE_XS }) {
      Row() {
        Text('能力面板').fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
        Row() {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(ICON_LG)
            .fontColor([this.pal().textSecondary])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onClose();
        })
      }.width('100%')

      Text('原生渲染聊天主链路；下列能力由 ArkWeb 承载（与 Web 版同源、能力一致）：')
        .fontSize(fs('type.caption')).fontColor(this.pal().textSecondary).width('100%')

      List() {
        // 原生插件目录（components/PluginHost）：列出所有插件/视图贡献点，点开在宿主页运行
        ListItem() {
          this.EntryRow('插件目录（原生）', (): void => {
            this.onOpenPluginHost();
          })
        }
        // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
        ListItem() {
          this.EntryRow('完整 Web UI', (): void => {
            this.onOpenWebUi();
          })
        }

        // ── 三态状态行：加载 / 失败(+重试) / 空 ──────────────────────────────────
        if (this.status().show) {
          ListItem() {
            Column({ space: SPACE_SM }) {
              Text(this.status().text)
                .fontSize(fs('type.callout'))
                .fontWeight(fw('type.callout'))
                .fontColor(colorOf(this.pal(), this.status().colorRole))
                .width('100%')
                // ⛔ **水平溢出**（2026-10-11）：状态行会承载**失败详情/错误原文**（含 URL、路径、
                //    base64 这类**不可断串**）⇒ 必须允许任意字符处断行，否则一行顶出屏宽。
                .wordBreak(WordBreak.BREAK_ALL)
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
              if (this.status().canRetry) {
                Row() {
                  Text('重试').fontSize(fs('type.caption')).fontWeight(fw('type.caption'))
                    .fontColor(this.pal().accentSoft)
                }
                .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
                .borderRadius(RADIUS_CARD)
                .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onRetry();
                })
              }
            }
            .width('100%')
          }
        }

        // ── 插件行（图标 / 名称 / v版本·state / 描述 / 打开）──────────────────────
        // ⛔ 三态期间（加载/失败）不画空列表；有数据时才逐行渲染。
        ForEach(this.plugins, (p: PluginCatalogItem) => {
          ListItem() {
            Row({ space: SPACE_XS }) {
              SymbolGlyph(pluginSymbol(p.icon))
                .fontSize(PLUGIN_ICON)
                .fontColor([this.pal().accentSoft])
              Column({ space: SPACE_XS }) {
                Row({ space: SPACE_XS }) {
                  Text(p.name).fontSize(fs('type.callout')).fontColor(this.pal().textPrimary)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                  if (pluginMetaText(p.version, p.state).length > 0) {
                    Text(pluginMetaText(p.version, p.state))
                      .fontSize(fs('type.micro')).fontColor(this.pal().textMuted)
                      // ⚠️ 这一处原为 `flexShrink(0)` —— 但它是**文本**（版本/状态由插件给，可能很长）
                      // ⇒ 顶宽、把 `Row` 撑爆（全仓 11 处 `flexShrink(0)` 里唯一挂在文本上的）。
                      // ⇒ 改为**可收缩 + 单行省略**（`p.name` 那侧的 `layoutWeight(1)` 保持不动）。
                      .flexShrink(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                }.width('100%').alignItems(VerticalAlign.Center)
                if (p.description.length > 0) {
                  Text(p.description)
                    .fontSize(fs('type.caption')).fontColor(this.pal().textMuted)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                }
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('打开').fontSize(fs('type.caption')).fontColor(this.pal().accentSoft)
            }
            .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
            .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
            .borderRadius(RADIUS_CARD)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .margin({ bottom: GAP_ROW_Y })
            .onClick(() => {
              this.onOpenPlugin(p);
            })
          }
        }, (p: PluginCatalogItem) => `${p.id}#${p.url}`)
      }
      .height(320).width('100%')
    }
    .width('92%').padding(SPACE_MD).backgroundColor(this.pal().appBg)
    .borderRadius(RADIUS_SHEET).border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }
}
