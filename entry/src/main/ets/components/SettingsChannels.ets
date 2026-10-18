/**
 * SettingsChannels —— 设置 →「消息渠道」：**整段对齐 web** 的新分区。
 *
 * ## 为什么需要它
 * 审计确证：原生此前**完全没有**渠道分区（0 命中 `get_channel_config`/`set_channel_config`/
 * `feishu_bind`），而 web 有 `src/components/settings/SettingsChannels.tsx:118-531`（约 400 行）
 * —— 这是与 web 最大的单块功能缺口之一。本文件逐条移植它。
 *
 * ## web 权威（逐条核对）
 *  · 读：`SettingsChannels.tsx:145-153` → `get_channel_config`
 *  · 写：`SettingsChannels.tsx:228-247` → `set_channel_config {channel, values}`
 *  · 飞书引导：`:250-269` → `feishu_app_guide`
 *  · 飞书绑定：`:271-301` → `feishu_bind_start`；轮询 `:160-205` → `feishu_bind_status`
 *  · 轮询间隔 `:48`；链接过期本地兜底 `:197-205`；`idle ⇒ 链接失效` `:174-181`
 *  · 渲染结构：`:338-527`（每渠道一卡：类型标题 + 启用开关 + 字段 + 飞书块 + 保存行）
 *
 * ## 判据全部来自 `core/channelscfg.ets`（纯逻辑，可脱机单测）
 * 本组件**不自造判据**：解析 / 排序 / 脏判 / 提交形状 / 掩码 / 校验 / 就绪 / 绑定状态机
 * 一律调 core 的函数。
 *
 * ## ⛔ 一切状态以后端为准（用户常驻要求）
 *  · 保存成功后**重新 `get_channel_config`**（写后回读），服务端值即唯一真值；
 *  · 飞书绑定**只有** `feishu_bind_status` 回报 `done` 才算成（`applyBindStatus` 原样采用服务端状态，
 *    绝不在本地乐观置 `done` / 假装成功）；失败在错误条可见。
 *
 * ## ⛔ 危险操作二次确认（原生增强，web 无）
 *  已有 `waiting` 尝试时点「重新生成链接」⇒ 服务端 `Start` 会 `cancel()` 旧尝试
 *  （`serverapp/feishu_bind.go:63-67`）⇒ 旧链接立即作废 ⇒ 先确认再顶替（`bindConfirmNeeded`）。
 *
 * ## ArkUI 约束（见 `docs/ARKTS-GOTCHAS.md`）
 *  · 会变的内容一律走**真 `@Component` + `@Prop`**（基础类型/数组）——**禁**带参全局 `@Builder`；
 *  · `ForEach` key 带**内容指纹**（`fieldRowKey` / `channelRowKey`）——key 不变则复用节点、不重估 @Prop；
 *  · 颜色只用 `paletteOf(theme)` 的角色，**无字面量**；
 *  · ⛔ **不做**基类成员名（`enabled`/`size`/…）：启用开关叫 `isOn`（同 `SettingsToolRow`）。
 */
import { common, Want } from '@kit.AbilityKit';
import { BusinessError, pasteboard } from '@kit.BasicServicesKit';
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, FS_BODY, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { readableRpcError, rpc } from '../core/rpc';
import {
  applyBindStatus, bindButtonLabel, bindConfirmNeeded, bindConfirmText, bindErrorText,
  bindFromStartResult, buildSaveValues, canSave, channelDescription, channelNames, channelRowKey,
  channelTitle, enabledValue, expirySeconds, fieldRowKey, fieldValue, isBuiltin, isDirty, isEnabled,
  isSecretField, linkExpiryText, maskSecret, parseChannels, parseGuide, parseSchema, presetSummary,
  publicUrlNotice, readinessHints, saveButtonLabel, schemaRawOf, SetChannelConfigParams,
  FeishuBindStartParams, showBound, showOpenLink, showWaitingHint, validateChannelDraft,
  visibleFields, CHANNEL_COPY_LINK, CHANNEL_LINK_EXPIRED, CHANNEL_LINK_STALE, CHANNEL_OPEN_FAILED,
  CHANNEL_OPEN_LINK, FEISHU_BIND_POLL_MS, FEISHU_CHANNEL_NAME, RPC_FEISHU_APP_GUIDE,
  RPC_FEISHU_BIND_START, RPC_FEISHU_BIND_STATUS, RPC_GET_CHANNEL_CONFIG, RPC_SET_CHANNEL_CONFIG,
  BIND_STATE_WAITING, BIND_STATE_DONE, FeishuBind, FeishuGuide, ChannelField,
} from '../core/channelscfg';
import { SettingsErrorBar, SettingsPanelHeader, SettingsButton } from './SettingsRows';
import { PRESS_OPACITY, HIT_TARGET_MIN } from '../core/design';
import { t as i18nT } from '../core/i18n';

/** 「即时反馈」时长（已保存徽标 / 复制提示**共用**）——web `SettingsChannels.tsx:243` 为 2000ms。 */
const FLASH_MS: number = 2500;

// ══════════════════════════════════════════════════════════════════════════════
// ChannelFieldRow —— 一行渠道字段（真 @Component + @Prop 基础类型）
// ══════════════════════════════════════════════════════════════════════════════

/** 单字段输入行（web `SettingsChannels.tsx:353-368` 的 Input + Label + description）。 */
@Component
struct ChannelFieldRow {
  @Prop label: string = '';
  @Prop description: string = '';
  @Prop value: string = '';
  @Prop placeholder: string = '';
  /** 敏感字段（`type == "password"`）——未揭示时走 Password 掩码。 */
  @Prop secret: boolean = false;
  /** 敏感字段当前是否**揭示**真值。 */
  @Prop revealed: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';

  onText: (v: string) => void = (v: string) => {
  };
  onReveal: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SP_1 }) {
      Row({ space: SP_2 }) {
        Text(this.label)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .layoutWeight(1)
        if (this.secret) {
          Text(this.revealed ? '隐藏' : '显示')
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().accentSoft)
            .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onReveal();
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      TextInput({ text: this.value, placeholder: this.placeholder })
        .enabled(!this.busy)
        .type(this.secret && !this.revealed ? InputType.Password : InputType.Normal)
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .placeholderColor(this.pal().textMuted)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_LG)
        .border({ width: 1, color: this.pal().border })
        .padding({ left: SP_2, right: SP_2 })
        .onChange((v: string) => {
          this.onText(v);
        })

      if (this.description.length > 0) {
        Text(this.description)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      // 敏感字段：用**掩码**确认"已保存过值"，不泄露任何原字符（`maskSecret`）。
      if (this.secret && this.value.length > 0) {
        Text(`已保存：${maskSecret(this.value)}（编辑将覆盖）`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: SP_2, bottom: SP_2 })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ChannelCard —— 单个渠道（真 @Component + @Prop 基础类型/数组）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一个渠道的卡片。
 *
 * ⚠️ **只收基础类型与一维数组**：`@Prop` 对复杂类/嵌套对象的深拷贝不可靠
 *    （见 `SettingsPlugins` 头注），故字段用 6 个**平行数组**传递。
 */
@Component
struct ChannelCard {
  @Prop name: string = '';
  @Prop builtin: boolean = false;
  /** ⛔ 不叫 `enabled`（ArkUI `CustomComponent` 基类成员，10505001）——同 `SettingsToolRow.isOn`。 */
  @Prop isOn: boolean = false;
  @Prop dirty: boolean = false;
  @Prop busy: boolean = false;
  @Prop saved: boolean = false;
  @Prop validation: string = '';
  @Prop theme: string = 'dark';

  @Prop fieldKeys: string[] = [];
  @Prop fieldLabels: string[] = [];
  @Prop fieldDescs: string[] = [];
  @Prop fieldSecrets: boolean[] = [];
  @Prop fieldValues: string[] = [];
  @Prop fieldPlaceholders: string[] = [];
  /** 被揭示（显示真值）的敏感字段键。 */
  @Prop revealedKey: string = '';

  onToggle: (on: boolean) => void = (on: boolean) => {
  };
  onField: (key: string, text: string) => void = (key: string, text: string) => {
  };
  onReveal: (key: string) => void = (key: string) => {
  };
  onSave: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private descAt(i: number): string {
    return i >= 0 && i < this.fieldDescs.length ? this.fieldDescs[i] : '';
  }

  private valueAt(i: number): string {
    return i >= 0 && i < this.fieldValues.length ? this.fieldValues[i] : '';
  }

  private placeholderAt(i: number): string {
    return i >= 0 && i < this.fieldPlaceholders.length ? this.fieldPlaceholders[i] : '';
  }

  private labelAt(i: number): string {
    return i >= 0 && i < this.fieldLabels.length ? this.fieldLabels[i] : '';
  }

  private secretAt(i: number): boolean {
    return i >= 0 && i < this.fieldSecrets.length ? this.fieldSecrets[i] : false;
  }

  build() {
    Column({ space: SP_2 }) {
      // 标题：`<name> · 内置/插件渠道`（web `SettingsChannels.tsx:346`）
      Column({ space: 2 }) {
        Text(channelTitle(this.name, this.builtin))
          .fontSize(FS_BODY)
          .fontColor(this.pal().textPrimary)
          .width('100%')
        if (channelDescription(this.builtin).length > 0) {
          Text(channelDescription(this.builtin))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      // 启用开关（web `:345-351`）
      Row({ space: SP_2 }) {
        Text(i18nT('启用'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.isOn })
          .enabled(!this.busy)
          .onChange((on: boolean) => {
            this.onToggle(on);
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // 字段（去 enabled 与元键；顺序 = schema 顺序）
      ForEach(this.fieldKeys, (k: string, i: number) => {
        ChannelFieldRow({
          label: this.labelAt(i),
          description: this.descAt(i),
          value: this.valueAt(i),
          placeholder: this.placeholderAt(i),
          secret: this.secretAt(i),
          revealed: this.revealedKey === k,
          busy: this.busy,
          theme: this.theme,
          onText: (v: string) => {
            this.onField(k, v);
          },
          onReveal: () => {
            this.onReveal(k);
          },
        })
      }, (k: string, i: number) => fieldRowKey(this.name, k, this.valueAt(i)))

      // 阻断性校验错误（端口等）
      if (this.validation.length > 0) {
        Text(this.validation)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
      }

      // 保存行（web `:490-498`）
      Row({ space: SP_2 }) {
        Text(saveButtonLabel(this.busy))
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().onAccent)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .backgroundColor(this.pal().accent)
          .borderRadius(R_LG)
          .opacity(canSave(this.dirty, this.busy, this.validation) ? 1 : 0.4)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            if (canSave(this.dirty, this.busy, this.validation)) {
              this.onSave();
            }
          })
        if (this.saved) {
          Text(i18nT('已保存'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().successText)
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SP_3)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GuideListRow —— 引导清单分组（标签 + 计数 + 复制全部 + 内容）
// ══════════════════════════════════════════════════════════════════════════════

@Component
struct GuideListRow {
  @Prop label: string = '';
  @Prop items: string[] = [];
  @Prop theme: string = 'dark';

  onCopy: (text: string) => void = (text: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SP_1 }) {
      Row({ space: SP_2 }) {
        Text(`${this.label}（${this.items.length}）`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .layoutWeight(1)
        Text(i18nT('复制全部'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().accentSoft)
          // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先无竖直内距（视觉高≈16）⇒ 低于阈值。
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onCopy(this.items.join('\n'));
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      Text(this.items.join(', '))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textSecondary)
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FeishuBindPanel —— 飞书一键绑定（引导 + 生成链接 + 轮询 + 复制/打开）
// ══════════════════════════════════════════════════════════════════════════════

@Component
struct FeishuBindPanel {
  @Prop theme: string = 'dark';
  @Prop binding: boolean = false;
  @Prop bindState: string = '';
  @Prop bindUrl: string = '';
  @Prop bindAppId: string = '';
  @Prop bindError: string = '';
  @Prop bindExpiresIn: number = 0;
  @Prop expired: boolean = false;
  @Prop openFailed: boolean = false;
  /** 是否处于"二次确认顶替旧链接"态。 */
  @Prop confirmBind: boolean = false;
  @Prop hasGuide: boolean = false;
  @Prop guideScopes: string[] = [];
  @Prop guideEvents: string[] = [];
  @Prop guideCallbacks: string[] = [];
  @Prop guideCreateUrl: string = 'https://open.feishu.cn/app';
  @Prop guideNeedsPublicUrl: boolean = false;
  @Prop presetText: string = '';
  @Prop publicUrlText: string = '';

  @State private showPreset: boolean = false;

  onStartBind: () => void = () => {
  };
  onConfirmBind: () => void = () => {
  };
  onCancelBind: () => void = () => {
  };
  onCopy: (text: string) => void = (text: string) => {
  };
  onOpen: (url: string) => void = (url: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 绑定视图（供 core 判据消费）；无尝试（blank state）⇒ null。 */
  private bindOrNull(): FeishuBind | null {
    if (this.bindState.length === 0) {
      return null;
    }
    const b: FeishuBind = new FeishuBind();
    b.state = this.bindState;
    b.url = this.bindUrl;
    b.appId = this.bindAppId;
    b.error = this.bindError;
    b.expiresIn = this.bindExpiresIn;
    return b;
  }

  private waiting(): boolean {
    return this.bindState === BIND_STATE_WAITING;
  }

  build() {
    Column({ space: SP_2 }) {
      Text(i18nT('创建飞书应用（全新安装引导）'))
        .fontSize(FS_BODY)
        .fontColor(this.pal().textPrimary)
        .width('100%')

      Column({ space: SP_1 }) {
        Text(i18nT('1. 点下面的按钮生成链接（链接 10 分钟内有效）'))
          .fontSize(FS_CAPTION).fontColor(this.pal().textMuted).width('100%')
        Text(i18nT('2. 在飞书里打开它并确认 —— 应用会按下方清单自动创建'))
          .fontSize(FS_CAPTION).fontColor(this.pal().textMuted).width('100%')
        Text(i18nT('3. App ID / Secret 自动写入并启用本渠道，回来即可直接对话'))
          .fontSize(FS_CAPTION).fontColor(this.pal().textMuted).width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Text(i18nT('在飞书中打开下面的链接确认后，当前应用会获得智能体权限、事件订阅与卡片回调。'))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')

      // 自动配置清单（feishu_app_guide；形状不完整则不渲染）
      if (this.hasGuide) {
        Text(this.presetText)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().accentSoft)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.showPreset = !this.showPreset;
          })
        if (this.showPreset) {
          Column({ space: SP_2 }) {
            GuideListRow({
              label: '权限', items: this.guideScopes, theme: this.theme,
              onCopy: (t: string) => { this.onCopy(t); },
            })
            GuideListRow({
              label: '事件', items: this.guideEvents, theme: this.theme,
              onCopy: (t: string) => { this.onCopy(t); },
            })
            GuideListRow({
              label: '回调', items: this.guideCallbacks, theme: this.theme,
              onCopy: (t: string) => { this.onCopy(t); },
            })
          }
          .width('100%')
          .padding(SP_2)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_MD)
        }
        Text(this.publicUrlText)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
          // 2026-10-11 用户报"字超出屏幕"：URL 无空格断点 => 必须 BREAK_ALL，否则顶出屏。
          .wordBreak(WordBreak.BREAK_ALL)
        Text(i18nT('也可以在飞书开放平台手动创建应用 →'))
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().accentSoft)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onOpen(this.guideCreateUrl);
          })
      }

      // 二次确认（顶替等待中的链接 = 危险操作）
      if (this.confirmBind) {
        Text(bindConfirmText())
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().warn)
          .width('100%')
        Row({ space: SP_2 }) {
          Text(i18nT('确认重新生成'))
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().onAccent)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(this.pal().accent)
            .borderRadius(R_LG)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onConfirmBind();
            })
          SettingsButton({
            label: '取消',
            kind: 'ghost',
            theme: this.theme,
            onTap: () => {
              this.onCancelBind();
            },
          })
        }
        .width('100%')
      } else {
        Row({ space: SP_2 }) {
          Text(bindButtonLabel(this.binding, this.bindOrNull()))
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().onAccent)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(this.pal().accent)
            .borderRadius(R_LG)
            .opacity(this.binding ? 0.5 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              if (!this.binding) {
                this.onStartBind();
              }
            })
          if (showOpenLink(this.bindOrNull(), this.expired) && this.bindUrl.length > 0) {
            Text(CHANNEL_OPEN_LINK)
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
              .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onOpen(this.bindUrl);
              })
          }
          if (showBound(this.bindOrNull())) {
            Text(i18nT('已绑定'))
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
              .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(R_LG)
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }

      if (bindErrorText(this.bindOrNull()).length > 0) {
        Text(bindErrorText(this.bindOrNull()))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
      }
      if (showWaitingHint(this.bindOrNull(), this.expired)) {
        Text(i18nT('等待你在飞书中确认…（应用会自动创建并写回凭据）'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      if (this.openFailed) {
        Text(CHANNEL_OPEN_FAILED)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().warn)
          .width('100%')
      }
      if (this.expired && this.waiting()) {
        Text(CHANNEL_LINK_EXPIRED)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().warn)
          .width('100%')
      }

      // 链接展示 + 复制 + 有效期
      if (this.bindUrl.length > 0) {
        Column({ space: SP_1 }) {
          Text(this.bindUrl)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textSecondary)
            .width('100%')
            // 同上：绑定 URL 亦为不可断长串。
            .wordBreak(WordBreak.BREAK_ALL)
          Row({ space: SP_2 }) {
            Text(CHANNEL_COPY_LINK)
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
              .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onCopy(this.bindUrl);
              })
            Text(linkExpiryText(this.bindExpiresIn > 0 ? this.bindExpiresIn : 600))
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textMuted)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(SP_2)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_MD)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SP_3)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SettingsChannels —— 分区容器（拉取 + 草稿 + 保存 + 飞书绑定状态机）
// ══════════════════════════════════════════════════════════════════════════════

@Component
export struct SettingsChannels {
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') localeStamp: string = '';
  /** HTTP 客户端（由页面注入 `store.http`）。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  /** 服务端真值（`get_channel_config`）。 */
  @State private channels: Record<string, Record<string, string>> = {};
  /** 草稿（编辑中；保存成功后由 `load()` 覆盖）。 */
  @State private drafts: Record<string, Record<string, string>> = {};
  @State private loading: boolean = true;
  @State private error: string = '';
  @State private notice: string = '';
  /** 保存中的渠道名（空 = 无）。 */
  @State private busyChannel: string = '';
  /** 刚保存成功的渠道名（2s 后清）。 */
  @State private savedChannel: string = '';
  /** 被揭示（显示真值）的敏感字段键 `<ch>#<key>`。 */
  @State private revealed: string = '';

  // ── 飞书绑定（扁平基础类型 —— ArkUI 最稳）────────────────────────────────
  @State private binding: boolean = false;
  @State private bindState: string = '';
  @State private bindUrl: string = '';
  @State private bindAppId: string = '';
  @State private bindError: string = '';
  @State private bindExpiresIn: number = 0;
  @State private expired: boolean = false;
  @State private openFailed: boolean = false;
  @State private confirmBind: boolean = false;

  // ── 飞书引导（feishu_app_guide）──────────────────────────────────────────
  @State private hasGuide: boolean = false;
  @State private guide: FeishuGuide = new FeishuGuide();

  // 定时器集中管理（**唯一** `setTimeout`/`setInterval` 调用点在本组件的方法里；
  // 全部有清除路径：`aboutToDisappear` + 各自完成/切换时）。
  private pollTimer: number = -1;
  private expiryTimer: number = -1;
  /** 「即时反馈」定时器：已保存徽标 + 复制提示**共用一个**（到点一起清）。 */
  private flashTimer: number = -1;

  aboutToAppear(): void {
    void this.load();
    void this.loadGuide();
  }

  aboutToDisappear(): void {
    this.stopPoll();
    this.clearExpiry();
    if (this.flashTimer >= 0) {
      clearTimeout(this.flashTimer);
      this.flashTimer = -1;
    }
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * **唯一**的 `setTimeout` 调用点：所有一次性延时（链接过期 / 即时反馈）都经此，
   * 便于统一审计与清理（预算护栏 `tools/perf/guard.sh` 统计调用点）。
   */
  private scheduleOnce(ms: number, task: () => void): number {
    return setTimeout(task, ms);
  }

  // ── 拉取 ──────────────────────────────────────────────────────────────────

  /** 拉取渠道表（**唯一真值来源**；保存成功后也走它，写后回读）。 */
  private async load(): Promise<void> {
    this.loading = true;
    try {
      const raw: Object = await rpc<Object>(this.http, RPC_GET_CHANNEL_CONFIG);
      const ch: Record<string, Record<string, string>> = parseChannels(raw);
      this.channels = ch;
      this.drafts = ch;
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
      this.channels = {};
      this.drafts = {};
    } finally {
      this.loading = false;
    }
  }

  /** 拉取飞书引导（增强项；拿不到不影响绑定）。 */
  private async loadGuide(): Promise<void> {
    try {
      const raw: Object = await rpc<Object>(this.http, RPC_FEISHU_APP_GUIDE);
      const g: FeishuGuide | null = parseGuide(raw);
      if (g !== null) {
        this.guide = g;
        this.hasGuide = true;
      }
    } catch (e) {
      // 引导拿不到 ⇒ 不渲染引导块（按钮仍可用）
      this.hasGuide = false;
    }
  }

  // ── 派生（全部来自 core/channelscfg 的纯函数）─────────────────────────────

  private names(): string[] {
    return channelNames(this.channels);
  }

  private entryOf(name: string): Record<string, string> {
    const e: Record<string, string> | undefined = this.channels[name];
    return e !== undefined ? e : {};
  }

  private draftOf(name: string): Record<string, string> {
    const d: Record<string, string> | undefined = this.drafts[name];
    return d !== undefined ? d : {};
  }

  private schemaOf(name: string): ChannelField[] {
    return parseSchema(schemaRawOf(this.entryOf(name)));
  }

  private visibleOf(name: string): ChannelField[] {
    return visibleFields(this.schemaOf(name));
  }

  private dirtyOf(name: string): boolean {
    return isDirty(this.entryOf(name), this.draftOf(name));
  }

  private validationOf(name: string): string {
    return validateChannelDraft(name, this.draftOf(name), this.schemaOf(name));
  }

  private hintsOf(name: string): string[] {
    return readinessHints(name, this.draftOf(name));
  }

  // ── 编辑 ──────────────────────────────────────────────────────────────────

  private setField(name: string, key: string, value: string): void {
    const next: Record<string, Record<string, string>> = {};
    const ks: string[] = Object.keys(this.drafts);
    for (let i = 0; i < ks.length; i++) {
      const src: Record<string, string> = this.drafts[ks[i]];
      const cp: Record<string, string> = {};
      const fks: string[] = Object.keys(src);
      for (let j = 0; j < fks.length; j++) {
        cp[fks[j]] = src[fks[j]];
      }
      next[ks[i]] = cp;
    }
    const cur: Record<string, string> | undefined = next[name];
    const entry: Record<string, string> = cur !== undefined ? cur : {};
    entry[key] = value;
    next[name] = entry;
    this.drafts = next;
  }

  private toggleEnabled(name: string, on: boolean): void {
    this.setField(name, 'enabled', enabledValue(on));
  }

  private toggleReveal(name: string, key: string): void {
    const k: string = `${name}#${key}`;
    this.revealed = this.revealed === k ? '' : k;
  }

  private revealedKeyOf(name: string): string {
    const p: string = `${name}#`;
    if (this.revealed.indexOf(p) === 0) {
      return this.revealed.substring(p.length);
    }
    return '';
  }

  // ── 保存（写后回读，以后端为准）────────────────────────────────────────────

  private async save(name: string): Promise<void> {
    const values: Record<string, string> = buildSaveValues(this.draftOf(name));
    this.busyChannel = name;
    this.savedChannel = '';
    try {
      await rpc<void>(this.http, RPC_SET_CHANNEL_CONFIG, new SetChannelConfigParams(name, values));
      await this.load(); // ⛔ 写后回读：服务端值即唯一真值
      this.savedChannel = name;
      this.flash('已保存（已按服务端值刷新）');
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busyChannel = '';
    }
  }

  /**
   * 3s 的即时反馈（复制提示 / 已保存），到点同时清「已保存」徽标 ——
   * **共用同一个** `flashTimer`（减少常驻定时器；见 `docs/PERF-BUDGET.md`）。
   */
  private flash(msg: string): void {
    this.notice = msg;
    if (this.flashTimer >= 0) {
      clearTimeout(this.flashTimer);
      this.flashTimer = -1;
    }
    this.flashTimer = this.scheduleOnce(FLASH_MS, () => {
      this.notice = '';
      this.savedChannel = '';
      this.flashTimer = -1;
    });
  }

  // ── 飞书绑定 ──────────────────────────────────────────────────────────────

  /** 绑定视图（供 core 判据消费）：无尝试 ⇒ null。 */
  private bindOrNull(): FeishuBind | null {
    if (this.bindState.length === 0) {
      return null;
    }
    const b: FeishuBind = new FeishuBind();
    b.state = this.bindState;
    b.url = this.bindUrl;
    b.appId = this.bindAppId;
    b.error = this.bindError;
    b.expiresIn = this.bindExpiresIn;
    return b;
  }

  /** 点「一键绑定 / 重新生成」：有 waiting 尝试 ⇒ 先二次确认（不静默顶替）。 */
  private onClickBind(): void {
    if (bindConfirmNeeded(this.bindOrNull()) && !this.confirmBind) {
      this.confirmBind = true;
      return;
    }
    void this.startBind();
  }

  private async startBind(): Promise<void> {
    this.binding = true;
    this.error = '';
    this.notice = '';
    this.confirmBind = false;
    this.expired = false;
    this.openFailed = false;
    this.bindState = '';
    this.bindUrl = '';
    this.bindAppId = '';
    this.bindError = '';
    this.bindExpiresIn = 0;
    this.stopPoll();
    this.clearExpiry();
    const appId: string = fieldValue(this.draftOf(FEISHU_CHANNEL_NAME), 'app_id');
    try {
      const res: Object = await rpc<Object>(this.http, RPC_FEISHU_BIND_START, new FeishuBindStartParams(appId));
      const b: FeishuBind = bindFromStartResult(res);
      this.bindState = b.state;
      this.bindUrl = b.url;
      this.bindAppId = b.appId;
      this.bindExpiresIn = b.expiresIn;
      // 尽力打开授权页；失败 ⇒ 可见地提示走"复制链接"（web popupBlocked 的等价语义）
      if (b.url.length > 0) {
        this.openUrl(b.url);
      }
      this.startExpiry(expirySeconds(b));
      this.startPoll();
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.binding = false;
    }
  }

  private startPoll(): void {
    this.stopPoll();
    this.pollTimer = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const raw: Object = await rpc<Object>(this.http, RPC_FEISHU_BIND_STATUS);
          const r = applyBindStatus(raw);
          if (r.stale || r.bind === null) {
            // 服务端已不持有该尝试（重启/被顶替）⇒ 重置 + 如实提示
            this.resetBind();
            this.error = CHANNEL_LINK_STALE;
            return;
          }
          this.bindState = r.bind.state;
          this.bindUrl = r.bind.url.length > 0 ? r.bind.url : this.bindUrl;
          this.bindAppId = r.bind.appId;
          this.bindError = r.bind.error;
          this.bindExpiresIn = r.bind.expiresIn;
          if (r.bind.state !== BIND_STATE_WAITING) {
            this.stopPoll();
            this.clearExpiry();
          }
          if (r.bind.state === BIND_STATE_DONE) {
            // 后端已写回凭据 ⇒ 回读渠道配置（以后端为准）
            void this.load();
          }
        } catch (e) {
          this.resetBind();
          this.error = readableRpcError((e as Error).message);
        }
      })();
    }, FEISHU_BIND_POLL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer >= 0) {
      clearInterval(this.pollTimer);
      this.pollTimer = -1;
    }
  }

  private startExpiry(seconds: number): void {
    this.clearExpiry();
    const ms: number = Math.max(1, seconds) * 1000;
    this.expiryTimer = this.scheduleOnce(ms, () => {
      this.expired = true;
      this.stopPoll(); // 死链接不再轮询（web `:160-166`）
      this.expiryTimer = -1;
    });
  }

  private clearExpiry(): void {
    if (this.expiryTimer >= 0) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = -1;
    }
  }

  private resetBind(): void {
    this.stopPoll();
    this.clearExpiry();
    this.bindState = '';
    this.bindUrl = '';
    this.bindAppId = '';
    this.bindError = '';
    this.bindExpiresIn = 0;
    this.confirmBind = false;
  }

  // ── 打开 / 复制 ───────────────────────────────────────────────────────────

  private openUrl(url: string): void {
    try {
      const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url,
      };
      ctx.startAbility(want).then((): void => {
      }).catch((e: BusinessError): void => {
        this.openFailed = true;
      });
    } catch (e) {
      this.openFailed = true;
    }
  }

  private copyText(s: string): void {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, s);
      pasteboard.getSystemPasteboard().setData(data);
      this.flash('已复制到剪贴板');
    } catch (e) {
      this.error = '复制失败，请长按选择链接手动复制';
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '消息渠道',
        subtitle: '启用并配置机器人接入的渠道。内置渠道与插件注册的渠道在此统一管理；保存后按需热启停。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }
      if (this.notice.length > 0) {
        Text(this.notice)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().successText)
          .width('100%')
      }

      if (this.loading) {
        Text(i18nT('加载中…'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.names().length === 0) {
        Text(i18nT('没有可配置的渠道。'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            ForEach(this.names(), (name: string) => {
              // 每个渠道项 = **单根** Column（卡 + 就绪提示 + 飞书绑定面板）
              Column({ space: SP_2 }) {
              ChannelCard({
                name: name,
                builtin: isBuiltin(this.entryOf(name)),
                isOn: isEnabled(this.draftOf(name)),
                dirty: this.dirtyOf(name),
                busy: this.busyChannel === name,
                saved: this.savedChannel === name,
                validation: this.validationOf(name),
                theme: this.theme,
                fieldKeys: this.mapFields(name, 0),
                fieldLabels: this.mapFields(name, 1),
                fieldDescs: this.mapFields(name, 2),
                fieldSecrets: this.secretsOf(name),
                fieldValues: this.valuesOf(name),
                fieldPlaceholders: this.placeholdersOf(name),
                revealedKey: this.revealedKeyOf(name),
                onToggle: (on: boolean) => {
                  this.toggleEnabled(name, on);
                },
                onField: (key: string, text: string) => {
                  this.setField(name, key, text);
                },
                onReveal: (key: string) => {
                  this.toggleReveal(name, key);
                },
                onSave: () => {
                  void this.save(name);
                },
              })
              if (name === FEISHU_CHANNEL_NAME) {
                // 就绪提示（不阻断保存）：飞书启用却缺凭据时提前告知
                ForEach(this.hintsOf(name), (h: string) => {
                  Text(h)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().warn)
                    .width('100%')
                }, (h: string) => `hint|${name}|${h}`)
                FeishuBindPanel({
                  theme: this.theme,
                  binding: this.binding,
                  bindState: this.bindState,
                  bindUrl: this.bindUrl,
                  bindAppId: this.bindAppId,
                  bindError: this.bindError,
                  bindExpiresIn: this.bindExpiresIn,
                  expired: this.expired,
                  openFailed: this.openFailed,
                  confirmBind: this.confirmBind,
                  hasGuide: this.hasGuide,
                  guideScopes: this.guide.scopes,
                  guideEvents: this.guide.events,
                  guideCallbacks: this.guide.callbacks,
                  guideCreateUrl: this.guide.createAppUrl,
                  guideNeedsPublicUrl: this.guide.needsPublicUrl,
                  presetText: presetSummary(this.guide),
                  publicUrlText: publicUrlNotice(this.guide),
                  onStartBind: () => {
                    this.onClickBind();
                  },
                  onConfirmBind: () => {
                    void this.startBind();
                  },
                  onCancelBind: () => {
                    this.confirmBind = false;
                  },
                  onCopy: (text: string) => {
                    this.copyText(text);
                  },
                  onOpen: (url: string) => {
                    this.openFailed = false;
                    this.openUrl(url);
                  },
                })
              }
              }
              .width('100%')
            }, (name: string) => channelRowKey(name, isBuiltin(this.entryOf(name))))
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .edgeEffect(EdgeEffect.Spring)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }

  // ── 平行数组（把 schema + draft 摊平成 @Prop 友好的基础类型数组）─────────────

  private secretsOf(name: string): boolean[] {
    const out: boolean[] = [];
    const fs: ChannelField[] = this.visibleOf(name);
    for (let i = 0; i < fs.length; i++) {
      out.push(isSecretField(fs[i]));
    }
    return out;
  }

  private valuesOf(name: string): string[] {
    const out: string[] = [];
    const fs: ChannelField[] = this.visibleOf(name);
    const d: Record<string, string> = this.draftOf(name);
    for (let i = 0; i < fs.length; i++) {
      out.push(fieldValue(d, fs[i].key));
    }
    return out;
  }

  private placeholdersOf(name: string): string[] {
    const out: string[] = [];
    const fs: ChannelField[] = this.visibleOf(name);
    for (let i = 0; i < fs.length; i++) {
      out.push(fs[i].defaultValue);
    }
    return out;
  }

  /** 摊平 helper：0=key 1=label 2=description。 */
  private mapFields(name: string, which: number): string[] {
    const out: string[] = [];
    const fs: ChannelField[] = this.visibleOf(name);
    for (let i = 0; i < fs.length; i++) {
      const f: ChannelField = fs[i];
      out.push(which === 0 ? f.key : (which === 1 ? (f.label.length > 0 ? f.label : f.key) : f.description));
    }
    return out;
  }
}
