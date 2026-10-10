/**
 * SettingsAbout —— 设置 → 关于：服务端版本 / 构建 / 运行环境 + **只读**更新检查。
 * 对齐 web `web/src/components/settings/SettingsAbout.tsx` 的**只读子集**。
 *
 * 契约（服务端 `serverapp/rpc_table.go:1963-1990`，两者都是 `requireAdmin(rpc0err)`）：
 *   · `get_system_info` → `SystemInfoRow`（version/commit/buildTime/channel/goVersion/os/
 *     arch/exePath/managedBy/devBuild —— web 镜像见 `SettingsAbout.tsx:26-38`）
 *   · `check_update` → `UpdateCheckRow`（current/latest/tag/hasUpdate/channel/url/skipped/reason
 *     —— web 镜像见 `SettingsAbout.tsx:40-50`）
 *
 * ⚠️ method 名**就地定义在 `core/settings.ets`**（`core/rpc.ets` 本波由 notify-impl 占用）；
 *    后续波折叠进 `RpcMethod` 表，见那里的注释。
 *
 * ⛔ **本波刻意不做** `apply_update` 与 `restart_server`：
 *    · `apply_update` 会在服务端**原子替换二进制 + web dist + 内置插件**（`rpc_table.go:1978-1990`）；
 *    · `restart_server` 会**真的重启服务**（`rpc_table.go:1992+`）。
 *    两者都是不可逆/破坏性动作，且手机端误触代价高、本波无法真机验证 ⇒ 留待有真机验证条件的波次。
 *    `check_update` 是**纯只读**（只查 GitHub Releases），所以本波做。
 *
 * ⚠️ `check_update` 的 `skipped=true` 是**正常返回**（dev 构建 / 网络离线 / 渠道不适用），
 *    不是错误 ⇒ 必须把 `reason` 显示给用户（见 `updateStatusText`），不能只显示"无更新"。
 *
 * 主题：颜色全部走 `paletteOf(theme)` 的语义 token（**无任何字面量颜色**）；
 *      次级文字按 `isLightPalette()` 分叉（**不按主题名硬判**）—— 纯白画布（porcelain）
 *      上 `textMuted` 对比度偏低，浅色系统一升一档到 `textSecondary`。
 */
import { Palette, paletteOf, isLightPalette } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { readableRpcError, rpc } from '../core/rpc';
import {
  MetaLine, RPC_CHECK_UPDATE, RPC_GET_SYSTEM_INFO, systemInfoLines, SystemInfoRow,
  textOrDash, UpdateCheckRow, updateStatusText,
} from '../core/settings';
import { SettingsErrorBar, SettingsPanelHeader } from './SettingsRows';

@Component
export struct SettingsAbout {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private info: SystemInfoRow | undefined = undefined;
  @State private check: UpdateCheckRow | undefined = undefined;
  @State private loading: boolean = true;
  @State private checking: boolean = false;
  @State private error: string = '';

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 浅色系（含 porcelain 纯白）升一档对比度；深色系保持 muted。**按亮度判，不按主题名**。 */
  private secondaryText(): string {
    return isLightPalette(this.pal()) ? this.pal().textSecondary : this.pal().textMuted;
  }

  private lines(): MetaLine[] {
    return systemInfoLines(this.info);
  }

  private versionBadge(): string {
    return textOrDash(this.info !== undefined ? this.info.version : undefined);
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const res: SystemInfoRow = await rpc<SystemInfoRow>(this.http, RPC_GET_SYSTEM_INFO);
      this.info = res;
      this.error = '';
    } catch (e) {
      // admin 不足 / 服务端不可达 ⇒ 可读提示，不静默空白。
      this.error = readableRpcError((e as Error).message);
      this.info = undefined;
    } finally {
      this.loading = false;
    }
  }

  private async checkUpdate(): Promise<void> {
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      const res: UpdateCheckRow = await rpc<UpdateCheckRow>(this.http, RPC_CHECK_UPDATE);
      this.check = res;
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.checking = false;
    }
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '关于',
        subtitle: '服务端版本与运行环境。更新与重启是服务端的破坏性动作，请在桌面端执行。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.secondaryText())
          .width('100%')
      } else if (this.info === undefined) {
        Text(this.error.length > 0 ? '版本信息读取失败。' : '服务端未返回版本信息。')
          .fontSize(FS_CAPTION)
          .fontColor(this.secondaryText())
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            // 版本主卡：版本号徽标 + 元信息行
            Column({ space: SP_2 }) {
              Row({ space: SP_2 }) {
                Text('版本')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.secondaryText())
                Text(this.versionBadge())
                  .fontSize(FS_BODY)
                  .fontColor(this.pal().onAccent)
                  .fontFamily('monospace')
                  .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                  .backgroundColor(this.pal().accent)
                  .borderRadius(R_MD)
              }
              .width('100%')

              ForEach(this.lines(), (l: MetaLine) => {
                Row({ space: SP_2 }) {
                  Text(l.label)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.secondaryText())
                    .width(88)
                  Text(l.value)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .fontFamily('monospace')
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)
              }, (l: MetaLine) => `meta|${l.label}`)
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

            // 更新检查（只读）
            Column({ space: SP_2 }) {
              Text('更新')
                .fontSize(FS_BODY)
                .fontColor(this.pal().textPrimary)
                .width('100%')
              Text(updateStatusText(this.check))
                .fontSize(FS_CAPTION)
                .fontColor(this.secondaryText())
                .width('100%')
              Row() {
                Blank()
                Text(this.checking ? '检查中…' : '检查更新')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().textPrimary)
                  .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                  .backgroundColor(this.pal().surfaceAlt)
                  .borderRadius(R_LG)
                  .border({ width: 1, color: this.pal().borderStrong })
                  .opacity(this.checking ? 0.5 : 1)
                  .onClick(() => {
                    void this.checkUpdate();
                  })
              }
              .width('100%')
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
