/**
 * PluginsSheet —— 「能力面板」（原 `pages/Index.ets` 的 `@Builder PluginsSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `plugins` 列表 + 回调；`showPlugins` / `panelUrl`
 * 所有权留页面（前者是弹层 flag 必须集中，后者是 ArkWeb 承载状态、页面独占）。
 *
 * ── 视觉语言（2026-10-11，与 `PluginHost` 对齐）──────────────────────────────
 * 「能力面板」是 `PluginHost`（原生插件目录）的**入口载体** ⇒ 用同一套语义令牌：
 *   · 字阶 = 语义排版档 `type.*`（标题 `type.headline` / 行名 `type.callout` / 说明 `type.caption`）；
 *   · 行卡 = `surfaceFillOf(p, SURFACE_CARD)` + **结构性发丝** `hairlineOf(p)` + `RADIUS_CARD`；
 *   · 内距 = `INSET_ROW_X/Y`；行间距 = `GAP_ROW_Y`；
 *   · 按压走全站唯一 `PRESS_OPACITY`；行命中区 ≥ `HIT_TARGET_MIN`（`constraintSize`）；
 *   · 关闭按钮热区用 `responseRegion` 外扩（⛔ 不改布局/视觉尺寸）。
 * ⛔ 颜色不写 hex；浅/深分叉只走 `isLightPalette(paletteOf(theme))`。
 */
import { Palette, paletteOf } from '../core/theme';
import { PluginPanelInfo } from '../core/types';
import {
  GAP_ROW_Y, hairlineOf, surfaceFillOf, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_SHEET, SPACE_MD, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD,
} from '../core/design';
import { fs, fw } from './SettingsRows';

/**
 * 关闭按钮**视觉**边长 ≈ 图标 17 + 2×`SPACE_XS`(8) = 33；热区靠 `responseRegion` 外扩到
 * `HIT_TARGET_MIN`(44) —— ⛔ 不改布局/视觉尺寸（同 `WebSurface` / `MessageNav` 的手艺）。
 */
const CLOSE_VISUAL: number = 33;
const CLOSE_HIT_PAD: number = (HIT_TARGET_MIN - CLOSE_VISUAL) / 2;

@Component
export struct PluginsSheet {
  @Prop theme: string = 'dark';
  /** 插件面板列表（页面 `plugins`）。 */
  @Prop plugins: PluginPanelInfo[] = [];
  /** 打开**原生**插件目录宿主页（页面 `openPluginHost()`）。 */
  onOpenPluginHost: () => void = () => {
  };
  /** 打开**完整 Web UI**（页面用自己的 serverUrl 置 `panelUrl`）。 */
  onOpenWebUi: () => void = () => {
  };
  /** 打开某个插件面板（页面置 `panelUrl = p.url`）。 */
  onOpenPlugin: (p: PluginPanelInfo) => void = () => {
  };
  /** 关闭面板（页面置 `showPlugins=false`）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_XS }) {
      Row() {
        Text('能力面板').fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17)
          .fontColor([this.pal().textSecondary]).padding(SPACE_XS)
          .responseRegion({
            x: -CLOSE_HIT_PAD, y: -CLOSE_HIT_PAD,
            width: CLOSE_VISUAL + CLOSE_HIT_PAD * 2, height: CLOSE_VISUAL + CLOSE_HIT_PAD * 2,
          })
          .onClick(() => {
            this.onClose();
          })
      }.width('100%')

      Text('原生渲染聊天主链路；下列能力由 ArkWeb 承载（与 Web 版同源、能力一致）：')
        .fontSize(fs('type.caption')).fontColor(this.pal().textSecondary).width('100%')

      List() {
        // 原生插件目录（components/PluginHost）：列出所有插件/视图贡献点，点开在宿主页运行
        ListItem() {
          Row() {
            Text('插件目录（原生）').fontSize(fs('type.callout')).fontColor(this.pal().textPrimary).layoutWeight(1)
            Text('打开').fontSize(fs('type.caption')).fontColor(this.pal().accentSoft)
          }
          .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
          .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
          .borderRadius(RADIUS_CARD)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .margin({ bottom: GAP_ROW_Y })
          .onClick(() => {
            this.onOpenPluginHost();
          })
        }
        // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
        ListItem() {
          Row() {
            Text('完整 Web UI').fontSize(fs('type.callout')).fontColor(this.pal().textPrimary).layoutWeight(1)
            Text('打开').fontSize(fs('type.caption')).fontColor(this.pal().accentSoft)
          }
          .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
          .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
          .borderRadius(RADIUS_CARD)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .margin({ bottom: GAP_ROW_Y })
          .onClick(() => {
            this.onOpenWebUi();
          })
        }
        ForEach(this.plugins, (p: PluginPanelInfo) => {
          ListItem() {
            Row() {
              Column() {
                Text(p.name).fontSize(fs('type.callout')).fontColor(this.pal().textPrimary)
                Text(p.url).fontSize(fs('type.micro')).fontColor(this.pal().textMuted).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('打开').fontSize(fs('type.caption')).fontColor(this.pal().accentSoft)
            }
            .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
            .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
            .borderRadius(RADIUS_CARD)
            .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .margin({ bottom: GAP_ROW_Y })
            .onClick(() => {
              this.onOpenPlugin(p);
            })
          }
        }, (p: PluginPanelInfo) => `${p.id}#${p.url}`)
      }
      .height(320).width('100%')
    }
    .width('92%').padding(SPACE_MD).backgroundColor(this.pal().appBg)
    .borderRadius(RADIUS_SHEET).border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
  }
}
