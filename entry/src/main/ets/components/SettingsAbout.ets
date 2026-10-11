/**
 * SettingsAbout —— 设置 → 关于：服务端版本 / 构建 / 运行环境 + 更新检查 + **应用内更新**
 * + **重启服务**（S9 补齐）。
 *
 * 对齐 web `web/src/components/settings/SettingsAbout.tsx`（**权威基准**）：
 *   · 版本信息            `:26-38`（SystemInfo）/ `:204-244`
 *   · 检查更新            `:127-140` / `:246-295`
 *   · 一键更新 apply_update `:146-158`（handler）/ `:262-274`（按钮门控）/ `:319-335`（结果渲染）
 *   · 重启 restart_server `:165-197`（两步确认 + 40s 轮询）/ `:358-421`（确认 UI / 失败 / 完成）
 *   · release notes 外链  `:297-317`（`current → latest · 发布说明`）
 *
 * 契约（服务端 `serverapp/rpc_table.go`，四个方法**全部 `requireAdmin`**）：
 *   · `get_system_info`  `:1963-1965` → SystemInfoRow
 *   · `check_update`     `:1971-1973` → UpdateCheckRow
 *   · `apply_update`     `:1978-1990` `{tag(必填), mirror?}` → ApplyResultRow（**原子替换二进制**）
 *   · `restart_server`   `:1998-2004` 无参 → `{managedBy}`（响应先 flush，重启 ~800ms 后触发）
 *
 * ⛔ **副作用安全（硬要求）**：
 *   · `apply_update` / `restart_server` 都是**不可撤销**动作 ⇒ **两步确认**（`core/aboutops.ets`
 *     的两个状态机：idle→confirming→…）；
 *   · **进行中态可见**（applying / restarting / polling 都有明确文案，按钮禁用防连点）；
 *   · **失败 / 超时必须可见**（`restartErrorText`：timedOut ⇒ 超时文案；failed ⇒ 服务端原文）；
 *   · 一律**以后端回包为准**（⛔ 不本地乐观置成功 —— `apply` 只在收到 ApplyResult 才置 applied；
 *     `restart` 只在**轮询到 `get_system_info` 成功**才置 succeeded）。
 *
 * ⛔ 判据与渲染**同源**：可用性/状态机/文案全部来自 `core/aboutops.ets` 的纯函数，
 *    本组件只消费其产物（`canApplyUpdate` / `applyReducer` / `restartReducer` / `applyButtonLabel`
 *    / `currentToLatestText` / `restartErrorText` / `releaseNotesUrl` / `restartHintText`）。
 *
 * 主题：颜色全部走 `paletteOf(theme)` 的语义 token（**无字面量颜色**）；次级文字按
 *      `isLightPalette()` 分叉（**不按主题名硬判**）。draft 视觉待设计系统统一（本轮只做功能与判据）。
 *
 * 外链：打开动作**复用仓内既有做法**（`pages/Index.ets:4557-4572`：协议白名单 +
 *      `common.UIAbilityContext.startAbility({action:'ohos.want.action.viewData', uri})`），
 *      地址规范化复用 `core/msgops.ets` 的 `resolveOpenable`（⛔ 不自造）。
 */
import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { Palette, paletteOf, isLightPalette } from '../core/theme';
import { XbotHttp } from '../core/http';
import {
  FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5,
} from '../core/tokens';
import { readableRpcError, rpc } from '../core/rpc';
import {
  MetaLine, RPC_CHECK_UPDATE, RPC_GET_SYSTEM_INFO, systemInfoLines, SystemInfoRow,
  textOrDash, UpdateCheckRow, updateStatusText,
} from '../core/settings';
import { resolveOpenable } from '../core/msgops';
import {
  APPLY_APPLYING, APPLY_DONE, APPLY_FAIL, APPLY_FAILED, APPLY_IDLE, APPLY_REQ_APPLY, APPLY_REQ_CANCEL,
  APPLY_REQ_CONFIRM, ApplyResultRow, ApplyUpdateParams, applyBusy, applyButtonLabel, applyReducer,
  applyShowConfirm, applySucceeded, canApplyUpdate, currentToLatestText, pollDeadline, pollExceeded,
  releaseNotesUrl, RESTART_FAIL, RESTART_FLUSH_DELAY_MS, RESTART_IDLE, RESTART_POLL_INTERVAL_MS,
  RESTART_POLL_OK, RESTART_REQ_CANCEL, RESTART_REQ_CONFIRM, RESTART_REQ_RESTART, RESTART_SENT,
  RESTART_TIMEOUT, RestartResultRow, restartBusy, restartErrorText, restartHintText, restartReducer,
  restartShowConfirm, restartSucceeded, restartSucceededText, RPC_APPLY_UPDATE, RPC_RESTART_SERVER,
} from '../core/aboutops';
import { SettingsErrorBar, SettingsPanelHeader } from './SettingsRows';
import { PRESS_OPACITY } from '../core/design';

@Component
export struct SettingsAbout {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';
  /** 是否给错误态「重试」入口（真值由页面经 SettingsPanel 注入）。 */
  @Prop canRetry: boolean = false;
  /** 点「重试」时调用 —— 重发**本分区自己的**请求（⛔ 空实现 = 假重试）。 */
  onRetry: () => void = () => {
  };

  @State private info: SystemInfoRow | undefined = undefined;
  @State private check: UpdateCheckRow | undefined = undefined;
  @State private loading: boolean = true;
  @State private checking: boolean = false;
  @State private error: string = '';

  // ── 应用内更新（apply_update）状态机 + 结果 ──
  @State private applyState: string = APPLY_IDLE;
  @State private applyResult: ApplyResultRow | undefined = undefined;
  @State private applyDetail: string = '';

  // ── 重启服务（restart_server）状态机 + 错误原文 ──
  @State private restartState: string = RESTART_IDLE;
  @State private restartDetail: string = '';

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
    // 新一轮检查：清掉上一轮的更新状态（web `:129-131` 同义，避免旧结果串味）。
    this.applyState = APPLY_IDLE;
    this.applyResult = undefined;
    this.applyDetail = '';
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

  // ── 应用内更新（两步确认 ⇒ 执行 ⇒ 以后端回包为准）────────────────────────────

  private confirmApply(): void {
    this.applyState = applyReducer(this.applyState, APPLY_REQ_CONFIRM);
  }

  private cancelApply(): void {
    this.applyState = applyReducer(this.applyState, APPLY_REQ_CANCEL);
  }

  private async doApply(): Promise<void> {
    if (applyBusy(this.applyState)) {
      return; // 防连点：进行中不接受重复提交（更新是不可撤销的重 IO）
    }
    if (!canApplyUpdate(this.check)) {
      return;
    }
    this.applyState = applyReducer(this.applyState, APPLY_REQ_APPLY);
    this.applyDetail = '';
    try {
      const tag: string = this.check !== undefined && this.check.tag !== undefined ? this.check.tag : '';
      const params: ApplyUpdateParams = new ApplyUpdateParams(tag);
      const res: ApplyResultRow = await rpc<ApplyResultRow>(this.http, RPC_APPLY_UPDATE, params);
      // 以后端回包为准置成功（⛔ 不本地乐观置）。
      this.applyResult = res;
      this.applyState = applyReducer(this.applyState, APPLY_DONE);
    } catch (e) {
      this.applyDetail = readableRpcError((e as Error).message);
      this.applyState = applyReducer(this.applyState, APPLY_FAIL);
    }
  }

  // ── 重启服务（两步确认 ⇒ 发指令 ⇒ 40s 轮询等回来）─────────────────────────────

  private confirmRestart(): void {
    this.restartState = restartReducer(this.restartState, RESTART_REQ_CONFIRM);
  }

  private cancelRestart(): void {
    this.restartState = restartReducer(this.restartState, RESTART_REQ_CANCEL);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  private async doRestart(): Promise<void> {
    if (restartBusy(this.restartState)) {
      return; // 防连点
    }
    this.restartState = restartReducer(this.restartState, RESTART_REQ_RESTART);
    this.restartDetail = '';
    try {
      await rpc<RestartResultRow>(this.http, RPC_RESTART_SERVER);
    } catch (e) {
      // 指令都没发出去 ⇒ 明确失败，不静默（web `:171-175`）。
      this.restartDetail = readableRpcError((e as Error).message);
      this.restartState = restartReducer(this.restartState, RESTART_FAIL);
      return;
    }
    this.restartState = restartReducer(this.restartState, RESTART_SENT);
    // 给响应留 flush 时间（重启 ~800ms 后才触发，web `:194-195`）。
    await this.sleep(RESTART_FLUSH_DELAY_MS);
    await this.pollUntilBack(pollDeadline(Date.now()));
  }

  /** 每 1.5s 探一次 `get_system_info`，直到服务回来（成功）或越过 40s 期限（超时可见失败）。 */
  private async pollUntilBack(deadline: number): Promise<void> {
    if (pollExceeded(Date.now(), deadline)) {
      this.restartState = restartReducer(this.restartState, RESTART_TIMEOUT);
      return;
    }
    try {
      await rpc<SystemInfoRow>(this.http, RPC_GET_SYSTEM_INFO);
      this.restartState = restartReducer(this.restartState, RESTART_POLL_OK);
      void this.load(); // 刷新版本（更新后重启即新版本，web `:188`）
      return;
    } catch (e) {
      await this.sleep(RESTART_POLL_INTERVAL_MS);
      await this.pollUntilBack(deadline);
    }
  }

  // ── release notes 外链（渲染出来且**可点**）───────────────────────────────────

  private async openReleaseNotes(): Promise<void> {
    const raw: string = releaseNotesUrl(this.check);
    const base: string = this.http.baseUrl;
    const abs: string = resolveOpenable(raw, base);
    if (abs.length === 0) {
      promptAction.showToast({ message: '该链接不能打开（仅支持 http/https/mailto）', duration: 2000 });
      return;
    }
    try {
      // 复用仓内既有做法（`pages/Index.ets:4557-4572`）。
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await ctx.startAbility({ action: 'ohos.want.action.viewData', uri: abs });
    } catch (e) {
      promptAction.showToast({ message: `打开失败: ${(e as Error).message}`, duration: 2500 });
    }
  }

  /** 已更新组件清单（web `:326` `components.join(', ')`；缺失 ⇒ `—`）。 */
  private componentsText(): string {
    const r: ApplyResultRow | undefined = this.applyResult;
    if (r === undefined || r.components === undefined || r.components.length === 0) {
      return '—';
    }
    return r.components.join(', ');
  }

  /** 非致命警告（web `:328-332`）。 */
  private warnings(): string[] {
    const r: ApplyResultRow | undefined = this.applyResult;
    if (r === undefined || r.warnings === undefined) {
      return [];
    }
    return r.warnings;
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '关于',
        subtitle: '服务端版本与运行环境。更新与重启是不可撤销的破坏性动作，请谨慎操作。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme, canRetry: this.canRetry, onRetry: this.onRetry })
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
            // ── 版本主卡：版本号徽标 + 元信息行 ──
            Column({ space: SP_2 }) {
              Row({ space: SP_2 }) {
                Text('版本')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.secondaryText())
                Text(this.versionBadge())
                  .fontSize(FS_BODY)
                  .fontColor(this.pal().onAccent)
                  .fontFamily('monospace')
                  // H1：版本号是**值语义**、在 `Row({space:SP_2})` 内且此前**无收缩手**
                  // ⇒ 长版本串（含 commit/构建号）会顶宽；补单行省略。
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
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

            // ── 更新卡（检查 + 应用内更新）──
            Column({ space: SP_2 }) {
              Text('更新')
                .fontSize(FS_BODY)
                .fontColor(this.pal().textPrimary)
                .width('100%')
              Text(updateStatusText(this.check))
                .fontSize(FS_CAPTION)
                .fontColor(this.secondaryText())
                .width('100%')

              // current → latest · 发布说明（外链，可点）
              if (this.check !== undefined && this.check.hasUpdate === true
                && !applySucceeded(this.applyState)) {
                Row({ space: SP_1 }) {
                  Text(currentToLatestText(this.check.current, this.check.latest))
                    .fontSize(FS_CAPTION)
                    .fontColor(this.secondaryText())
                  if (releaseNotesUrl(this.check).length > 0) {
                    Text('发布说明')
                      .fontSize(FS_CAPTION)
                      // ⛔ 目标⑤：这是**链接/可点文字**（FS_CAPTION=12，normal 字号）⇒ 需 AA_TEXT 4.5。
                      //    `accent` 是**非文本/图形** role（3.0）⇒ 压卡片面 `surface` 实算 dark 仅
                      //    **4.43**（porcelain 4.70 勉强）⇒ 不足 ⇒ 改走本仓为"链接/可点文字"定义的
                      //    `accentSoft`（4.5 档；porcelain 5.57 / dark 9.19 / light 6.70 / aurora 12.01 /
                      //    nebula 8.31，全 ≥4.5）。下划线用**同一 role** ⇒ 色相不劈叉。
                      .fontColor(this.pal().accentSoft)
                      .decoration({ type: TextDecorationType.Underline, color: this.pal().accentSoft })
                      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                      .onClick(() => {
                        void this.openReleaseNotes();
                      })
                  }
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
              }

              // 检查更新按钮
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
                  .enabled(!this.checking)
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    void this.checkUpdate();
                  })
              }
              .width('100%')

              // 更新按钮（有可用新版 + 未跳过 + tag 非空时出现）
              if (canApplyUpdate(this.check) && this.applyState === APPLY_IDLE) {
                Row() {
                  Blank()
                  Text(applyButtonLabel(false, this.check !== undefined ? this.check.latest : undefined))
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().onAccent)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().accent)
                    .borderRadius(R_LG)
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.confirmApply();
                    })
                }
                .width('100%')
              }

              // 二次确认（apply 也是不可撤销动作）
              if (applyShowConfirm(this.applyState)) {
                Text('确认更新到最新版本？此操作会在服务端原子替换二进制 / 网页资源 / 内置插件，不可撤销。')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().dangerText)
                  .width('100%')
                Row({ space: SP_2 }) {
                  Blank()
                  Text('取消')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.cancelApply();
                    })
                  Text('确认更新')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().dangerText)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().dangerText })
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      void this.doApply();
                    })
                }
                .width('100%')
              }

              // 进行中（可见 + 防连点）
              if (this.applyState === APPLY_APPLYING) {
                Text('更新中…（下载并校验，请勿关闭应用）')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().warn)
                  .width('100%')
              }

              // 失败（不静默）
              if (this.applyState === APPLY_FAILED) {
                Text(this.applyDetail.length > 0 ? this.applyDetail : '更新失败。')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().dangerText)
                  .width('100%')
              }

              // 成功（以后端回包为准展示组件清单 + 警告 + 需重启）
              if (applySucceeded(this.applyState)) {
                Text(`更新完成：${textOrDash(this.applyResult !== undefined ? this.applyResult.newVersion : undefined)}`)
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().success)
                  .width('100%')
                Text(`已更新组件：${this.componentsText()}`)
                  .fontSize(FS_CAPTION)
                  .fontColor(this.secondaryText())
                  .width('100%')
                ForEach(this.warnings(), (w: string) => {
                  Text(`⚠ ${w}`)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.secondaryText())
                    .width('100%')
                }, (w: string) => `warn|${w}`)
                Text('需要重启服务以生效。')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().textPrimary)
                  .width('100%')
              }
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

            // ── 重启卡（两步确认 + 40s 轮询 + 可见失败/超时）──
            Column({ space: SP_2 }) {
              Text('重启服务')
                .fontSize(FS_BODY)
                .fontColor(this.pal().textPrimary)
                .width('100%')
              Text(restartHintText(this.info !== undefined ? this.info.managedBy : undefined))
                .fontSize(FS_CAPTION)
                .fontColor(this.secondaryText())
                .width('100%')

              if (!restartShowConfirm(this.restartState)) {
                Row() {
                  Blank()
                  Text(restartBusy(this.restartState) ? '重启中…' : '重启服务')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .opacity(restartBusy(this.restartState) ? 0.5 : 1)
                    .enabled(!restartBusy(this.restartState))
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.confirmRestart();
                    })
                }
                .width('100%')
              } else {
                Text('确认重启服务？重启期间连接会短暂中断，且不可撤销。')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().dangerText)
                  .width('100%')
                Row({ space: SP_2 }) {
                  Blank()
                  Text('取消')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.cancelRestart();
                    })
                  Text(restartBusy(this.restartState) ? '重启中…' : '确认重启')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().dangerText)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().dangerText })
                    .enabled(!restartBusy(this.restartState))
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      void this.doRestart();
                    })
                }
                .width('100%')
              }

              // 轮询等待（进行中可见）
              if (restartBusy(this.restartState)) {
                Text('等待服务恢复（每 1.5 秒探测一次，最多 40 秒）…')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().warn)
                  .width('100%')
              }

              // 失败 / 超时（明确反馈，不静默）
              if (restartErrorText(this.restartState, this.restartDetail).length > 0) {
                Text(restartErrorText(this.restartState, this.restartDetail))
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().dangerText)
                  .width('100%')
              }

              // 成功
              if (restartSucceeded(this.restartState)) {
                Text(restartSucceededText())
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().success)
                  .width('100%')
              }
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
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
