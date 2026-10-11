/**
 * PluginsSheet —— 「能力面板」（原 `pages/Index.ets` 的 `@Builder PluginsSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `plugins` 列表 + 回调；`showPlugins` / `panelUrl`
 * 所有权留页面（前者是弹层 flag 必须集中，后者是 ArkWeb 承载状态、页面独占）。
 */
import { Palette, paletteOf } from '../core/theme';
import { PluginPanelInfo } from '../core/types';
import { FS_CAPTION, FS_TITLE, R_LG, R_XL, SP_2, SP_3, SP_4 } from '../core/tokens';
import { fs, fw } from './SettingsRows';

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
    Column({ space: SP_2 }) {
      Row() {
        Text('能力面板').fontSize(FS_TITLE).fontWeight(fw('type.headline'))
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17)
          .fontColor([this.pal().textSecondary]).padding(SP_2)
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
            Text('打开').fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
          }
          .width('100%').padding(SP_3).backgroundColor(this.pal().surfaceAlt).borderRadius(R_LG)
          .onClick(() => {
            this.onOpenPluginHost();
          })
        }
        // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
        ListItem() {
          Row() {
            Text('完整 Web UI').fontSize(fs('type.callout')).fontColor(this.pal().textPrimary).layoutWeight(1)
            Text('打开').fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
          }
          .width('100%').padding(SP_3).backgroundColor(this.pal().surfaceAlt).borderRadius(R_LG)
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
              Text('打开').fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
            }
            .width('100%').padding(SP_3).backgroundColor(this.pal().surfaceAlt).borderRadius(R_LG)
            .onClick(() => {
              this.onOpenPlugin(p);
            })
          }
        }, (p: PluginPanelInfo) => `${p.id}#${p.url}`)
      }
      .height(320).width('100%')
    }
    .width('92%').padding(SP_4).backgroundColor(this.pal().appBg)
    .borderRadius(R_XL).border({ width: 1, color: this.pal().border })
  }
}
