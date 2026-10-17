/**
 * SettingsAccount —— 设置 → 账号：显示当前登录账号 + 退出登录。
 * 对齐 web `SettingsDialog.tsx:69-105` 的 `SettingsAccountPanel`（用户名 + 登出按钮）。
 *
 * 契约：
 *   · **不需要任何新 RPC** —— 登出走既有 `XbotHttp.logout()`（`core/http.ets:405-411`：
 *     `POST /api/auth/logout` + 无条件 `clearSession()`），与页面抽屉里的登出同一条路径。
 *   · ⚠️ 用户名**没有服务端端点可查**：web 的 `AuthProvider.tsx:5` 明确写着
 *     "the backend has no `/api/auth/me` endpoint"，用户名由登录表单留在本地。
 *     原生把它存在页面私有的 `ConfigStore`（`core/config.ets:18,47`，`pages/Index.ets:481`
 *     是页面局部实例，**不是单例**）⇒ 本面板用**可选 `@Prop username`** 接收；
 *     未注入时回落中性文案（`accountDisplayName`），**不显示空白也不猜**。
 *
 * ⛔ 退出登录是**不可逆**的会话动作 ⇒ 本面板做**两步确认**（点一次变"确认退出？"），
 *    避免在设置面板里误触把用户踢下线。
 * ⛔ 登出后必须让页面知道 ⇒ `onLoggedOut` 回调（未接线时也不会静默：
 *    `logout()` 已清 cookie，后续任何请求 401 会触发 `onUnauthorized` 退回登录页）。
 *
 * 主题：颜色全部走 `paletteOf(theme)` 语义 token（无字面量）；危险色用 `dangerText`
 *      （porcelain 白底上取值 `#C0392B` 一档，对比度足够）。
 */
import { Palette, paletteOf, isLightPalette } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { accountDisplayName } from '../core/settings';
import { SettingsPanelHeader, SettingsButton } from './SettingsRows';
import { PRESS_OPACITY, HIT_TARGET_MIN } from '../core/design';
import { t as i18nT } from '../core/i18n';

@Component
export struct SettingsAccount {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';
  /**
   * 当前登录用户名（可选）。页面可从自己的 `ConfigStore.username` 注入
   * （`core/config.ets:18,47`）；未注入时显示中性文案。
   */
  @Prop username: string = '';
  /** 登出完成后回调（页面据此退回登录页）。未接线时靠 401 → onUnauthorized 兜底。 */
  onLoggedOut: () => void = () => {
  };

  @State private confirming: boolean = false;
  @State private busy: boolean = false;
  @State private error: string = '';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private secondaryText(): string {
    return isLightPalette(this.pal()) ? this.pal().textSecondary : this.pal().textMuted;
  }

  private async doLogout(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.http.logout();
      this.error = '';
      this.onLoggedOut();
    } catch (e) {
      // logout 内部已 clearSession()（finally），但网络失败仍要告诉用户"本地已登出"
      const msg: string = e !== undefined && e !== null && (e as Error).message !== undefined
        ? (e as Error).message : '未知错误';
      this.error = `退出登录请求失败（本地会话已清除）：${msg}`;
    } finally {
      this.busy = false;
      this.confirming = false;
    }
  }

  build() {
    // ⛔ **整页唯一滚动容器**（用户 2026-10-17：「别的设置二级面板也丑、也有交互问题」——
    //    根因之一是面板内容超出屏幕却**没有滚动**，底部条目永远够不到）。
    Scroll() {
      Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '账号',
        subtitle: '当前登录到本服务端的账号。退出后需要重新登录。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
          .padding(SP_3)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_MD)
      }

      Column({ space: SP_3 }) {
        Row({ space: SP_2 }) {
          Text(i18nT('账号'))
            .fontSize(FS_CAPTION)
            .fontColor(this.secondaryText())
          Text(accountDisplayName(this.username))
            .fontSize(FS_BODY)
            .fontColor(this.pal().textPrimary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        if (this.confirming) {
          Column({ space: SP_2 }) {
            Text(i18nT('确认退出登录？退出后需要重新输入账号密码。'))
              .fontSize(FS_CAPTION)
              .fontColor(this.secondaryText())
              .width('100%')
            Row({ space: SP_2 }) {
              Blank()
              SettingsButton({
                label: '取消',
                kind: 'secondary',
                theme: this.theme,
                onTap: () => {
                  this.confirming = false;
                },
              })
              SettingsButton({
                label: this.busy ? '退出中…' : '确认退出',
                kind: 'danger',
                busy: this.busy,
                theme: this.theme,
                onTap: () => {
                  void this.doLogout();
                },
              })
            }
            .width('100%')
          }
          .width('100%')
          .padding(SP_3)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
        } else {
          Row() {
            Blank()
            Text(i18nT('退出登录'))
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().dangerText)
              .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .border({ width: 1, color: this.pal().borderStrong })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.confirming = true;
              })
          }
          .width('100%')
        }
      }
      .width('100%')
      .padding(SP_4)
      .backgroundColor(this.pal().surface)
      .borderRadius(R_XL)
      .border({ width: 1, color: this.pal().border })

      Blank()
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Auto)
    .align(Alignment.Top)
  }
}
