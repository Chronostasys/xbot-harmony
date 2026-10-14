/**
 * SettingsWebUsers —— 设置 → Web 账号：创建 / 列出 / 删除 Web 登录账号。
 * 对齐 web `web/src/components/settings/SettingsWebUsers.tsx`。
 *
 * 契约（服务端 `serverapp/rpc_table.go:1935-1951`；结构 `channel/web/web_auth.go:116-122`）：
 *   · `list_web_users`（**admin**，无参）→ `{users: [{id, username, created_at}]}`（`rpc0err`）
 *   · `create_web_user`（**admin**）`{username}` → `{password}` —— ⚠️ **一次性明文**
 *   · `delete_web_user`（**admin**）`{username}` → void
 *
 * ⚠️ 通道 method 名**就地定义在 `core/settings.ets`**（`core/rpc.ets` 当前由别的线占用）；
 *    后续波折叠进 `RpcMethod` 表，见那里的注释。
 *
 * ⛔ 安全：`create_web_user` 返回的密码**只在内存里展示一次**（`@State`），
 *    **不落偏好、不落日志、不落任何持久化**（web 同款契约）。卸载组件即丢失。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { rpc, readableRpcError } from '../core/rpc';
import {
  isValidUsername, normalizeUsernameInput, OneTimePw, oneTimePasswordNotice, RPC_CREATE_WEB_USER,
  RPC_DELETE_WEB_USER, RPC_LIST_WEB_USERS, UsernameParams, WebUserRow, webUsersFrom, WebUsersData,
} from '../core/settings';
import { SettingsErrorBar, SettingsPanelHeader } from './SettingsRows';
import { colorOf, PRESS_OPACITY, HIT_TARGET_MIN } from '../core/design';

/** `create_web_user` 的 data（服务端 `map[string]string{"password": ...}`）。 */
interface CreatedUser {
  password?: string;
}

@Component
export struct SettingsWebUsers {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private users: WebUserRow[] = [];
  @State private loading: boolean = true;
  @State private error: string = '';
  @State private newUsername: string = '';
  @State private creating: boolean = false;
  @State private deleting: string = '';
  /**
   * 待确认删除的用户名（空 = 未处于确认态）—— **二次确认**，对齐 web
   * `SettingsWebUsers.tsx:81` 的 `window.confirm(t('settings.webUsers.deleteConfirm'))`。
   *
   * ⛔ 删除账号是**不可逆**操作（web 面板同样先确认）；旧实现点一下即发 `delete_web_user`。
   *    用「先武装、再确认」的两次点击（与 `SettingsAccount.ets` 的 `confirming` 同款）
   *    代替原生没有的 `window.confirm`。
   */
  @State private confirmDelete: string = '';
  /** ⚠️ 一次性明文密码 —— 只在内存，绝不持久化。 */
  @State private created: OneTimePw | undefined = undefined;

  aboutToAppear(): void {
    void this.refresh();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    try {
      const res: WebUsersData = await rpc<WebUsersData>(this.http, RPC_LIST_WEB_USERS);
      this.users = webUsersFrom(res);
      this.error = '';
    } catch (e) {
      // admin 不足必须给可读提示，不静默空白。
      this.error = readableRpcError((e as Error).message);
      this.users = [];
    } finally {
      this.loading = false;
    }
  }

  /**
   * 新建账号。
   * ⚠️ 方法名**不能叫 `create`** —— ArkTS 明令 `@Component` struct 的成员不可命名为
   * `create`（编译器 WARN：`cannot have name as 'create'`），与基类成员名黑名单同类。
   */
  private async createUser(): Promise<void> {
    const name: string = normalizeUsernameInput(this.newUsername);
    if (!isValidUsername(name) || this.creating) {
      return;
    }
    this.creating = true;
    try {
      const res: CreatedUser = await rpc<CreatedUser>(this.http, RPC_CREATE_WEB_USER, new UsernameParams(name));
      const pw: string = res !== undefined && res !== null && res.password !== undefined ? res.password : '';
      this.created = new OneTimePw(name, pw);
      this.newUsername = '';
      this.error = '';
      await this.refresh();
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.creating = false;
    }
  }

  private async remove(username: string): Promise<void> {
    if (this.deleting.length > 0) {
      return;
    }
    this.deleting = username;
    try {
      await rpc<void>(this.http, RPC_DELETE_WEB_USER, new UsernameParams(username));
      this.error = '';
      this.confirmDelete = '';
      await this.refresh();
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.deleting = '';
      this.confirmDelete = '';
    }
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: 'Web 账号',
        subtitle: '允许他人用独立账号登录本服务的 Web 端（与主账号隔离）。新建时生成的密码只显示一次。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }

      // 一次性密码横幅（创建成功后立即显示；离开面板即消失）
      if (this.created !== undefined) {
        Column({ space: SP_1 }) {
          Text(oneTimePasswordNotice(this.created.username, this.created.password))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .fontFamily('monospace')
            .width('100%')
          Text('请立即复制保存。该密码不会再次显示，也不会保存在本机。')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .width('100%')
        }
        .width('100%')
        .padding(SP_3)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_MD)
        .border({ width: 1, color: this.pal().borderStrong })
      }

      // 新建
      Row({ space: SP_2 }) {
        TextInput({ text: this.newUsername, placeholder: '新账号用户名' })
          .enabled(!this.creating)
          .layoutWeight(1)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .padding({ left: SP_2, right: SP_2 })
          .onChange((v: string) => {
            this.newUsername = v;
          })
        Text(this.creating ? '创建中…' : '创建')
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().onAccent)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .backgroundColor(this.pal().accent)
          .borderRadius(R_LG)
          .opacity(isValidUsername(this.newUsername) && !this.creating ? 1 : 0.4)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            void this.createUser();
          })
      }
      .width('100%')

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.users.length === 0 && this.error.length === 0) {
        Text('还没有 Web 账号。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: 0 }) {
            ForEach(this.users, (u: WebUserRow) => {
              Row({ space: SP_2 }) {
                Column({ space: 2 }) {
                  Text(u.username)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                  if (u.created_at !== undefined && u.created_at.length > 0) {
                    Text(u.created_at)
                      .fontSize(FS_CAPTION)
                      .fontColor(this.pal().textMuted)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Text(this.deleting === u.username ? '…'
                  : (this.confirmDelete === u.username ? '确认删除？' : '删除'))
                  .constraintSize({ minHeight: HIT_TARGET_MIN })
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().dangerText)
                  .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                  .borderRadius(R_LG)
                  // 确认态用**危险底**强化（同一「武装」视觉，避免误触）
                  .backgroundColor(this.confirmDelete === u.username ? this.pal().dangerBg : this.pal().transparent)
                  .border({ width: 1, color: this.confirmDelete === u.username ? this.pal().dangerText : this.pal().borderStrong })
                  .opacity(this.deleting.length === 0 ? 1 : 0.5)
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    // 二次确认：第一下只**武装**，第二下（同一行）才真删；点别的行则改武装到该行。
                    if (this.confirmDelete === u.username) {
                      this.confirmDelete = '';
                      void this.remove(u.username);
                    } else if (this.deleting.length === 0) {
                      this.confirmDelete = u.username;
                    }
                  })
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
              .padding({ top: SP_2, bottom: SP_2 })
            }, (u: WebUserRow) => `u|${u.username}`)
          }
          .width('100%')
          .padding(SP_4)
          .backgroundColor(this.pal().surface)
          .borderRadius(R_XL)
          .border({ width: 1, color: this.pal().border })
        }
        .width('100%')
        .layoutWeight(1)
        .edgeEffect(EdgeEffect.Spring)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }

      // Invite-only 说明（对齐 web `SettingsWebUsers.tsx:182-186` 的 `inviteOnlyNote`）——
      // **纯信息、无交互**：删除账号不强制登出已有会话（Cookie 在有效期内仍有效）；移出访问 = 删除账号。
      Row({ space: SP_2 }) {
        SymbolGlyph($r('sys.symbol.info_circle'))
          .fontSize(FS_CAPTION)
          // ⛔ 图标**不许**直取 `textMuted`（porcelain 2.17–2.54 < 图标地板 3:1；判据 `role_surface_floor` §B 硬红）
          // ⇒ 走**图标专用计算型 role** `iconMuted`（浅色 = `textSecondary` 5.07 ✓；深色 = `textMuted` 逐字节）。
          // ⚠️ `iconMuted` **不是** `Palette` 字段（`pal().iconMuted` 会 ArkTS 硬红 10505001）——唯一出口是 `colorOf`。
          .fontColor([colorOf(this.pal(), 'iconMuted')])
        Text('删除账号不会强制登出已有会话（Cookie 保持有效直到过期）。移除访问 = 删除账号。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
    }
    .width('100%')
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
