/**
 * SettingsPanel —— **设置面唯一容器**（全部分区 tab 聚合；`docs/REDESIGN.md` 的收敛落点）。
 *
 * 为什么要有它：
 *  1. **单一注入点**：`pages/Index.ets` 是热文件（5000+ 行，多线并行改）。设置面板全部收敛到
 *     这一个组件 ⇒ 入口接线只需一行 `SettingsPanel({ ... })`。
 *  2. **消孤儿 / 真编译覆盖**：`components/*.ets` 里没有任何其它文件引用的 `export struct`
 *     **不会被编进 ArkTS 依赖图**，它里面的 ArkTS 错误编译期不报（见 `docs/ARKTS-GOTCHAS.md`
 *     批次13、`tools/lint/orphan-components.sh`）。本组件**真实实例化**各分区面板 ⇒
 *     它们被真编译覆盖（不再是"假绿"）。
 *
 * ── 收敛（2026-10-11 用户亲报「两个设置面板」）────────────────────────────────
 *   决议：**唯一实现 = 本组件**；页面内联的 `PrefsSheet`（本地外观）与 `SettingsSheet`
 *   （服务端/账号）**删除**，入口（右上角 ⚙ / 侧边栏）都指向本组件。
 *   `PrefsSheet` 的本地外观项已逐条搬到 `components/SettingsAppearance.ets`（本组件的「外观」分区）。
 *   ⚠️ `pages/Index.ets` 归 `sidebar-ux`：入口收敛、删除两个页面 `@Builder`、把
 *      `onClose`/`settings`/… 注入**由它接**（见文件尾「注入契约」）。
 *
 * ── 关闭（P0 结构性防线）──────────────────────────────────────────────────────
 *   全屏面板的 **X 与返回都走 `onClose`**（真 `@Component` + `@Prop`，⛔ 不用带参全局 `@Builder`）
 *   ⇒ 面板**自己拥有**关闭入口，不再依赖"页面在别处画的 X 恰好写了对的 flag"
 *   （历史 P0：页面 X 写了别的面板的 flag ⇒ 点 X 无反应；`core/sheets.ets` 是同类扫描的判据源）。
 *
 * ⛔ 视觉只消费 `core/design.ets` 语义令牌 + `components/SettingsRows.ets` 共享原子（禁字面量）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import {
  INSET_CARD_X, INSET_CARD_Y, INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, RADIUS_PILL,
  STROKE_HAIRLINE, HIT_TARGET_MIN, SPACE_XS, SPACE_SM, SPACE_MD, SPACE_LG,
  hairlineOf, surfaceFillOf,
} from '../core/design';
import { SettingsAbout } from './SettingsAbout';
import { SettingsAccount } from './SettingsAccount';
import { SettingsAgent } from './SettingsAgent';
import { SettingsAppearance } from './SettingsAppearance';
import { SettingsDeveloper } from './SettingsDeveloper';
import { SettingsLlm } from './SettingsLlm';
import { SettingsStorage } from './SettingsStorage';
import { SettingsTools } from './SettingsTools';
import { SettingsWebUsers } from './SettingsWebUsers';
import { SettingsPlugins } from './SettingsPlugins';
import { SettingsChannels } from './SettingsChannels';
import { fallbackTabId, SettingsTabSpec, visibleTabs } from '../core/settingsplugins';
import { fs, fw, lh, SettingsErrorBar, SettingsPanelHeader, SettingsToolRow, tc, tk } from './SettingsRows';
// 面板**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不在本文件自造时长/曲线；E3 统一）。
import { sheetTransition } from './anim';
import { KEY_NOTIFY_DETAIL, notifyPrefValue, notifyPrefsFrom, settingLabel } from '../core/settings';
import {
  GetSettingsParams, readableRpcError, rpc, RPC_GET_SETTINGS, RPC_SET_SETTING, SETTINGS_NS_CLI, SetSettingParams,
} from '../core/rpc';

/** 分区 id（tab 顺序 = 此顺序）。 */
export const SETTINGS_TAB_APPEARANCE: string = 'appearance';
export const SETTINGS_TAB_TOOLS: string = 'tools';
export const SETTINGS_TAB_LLM: string = 'llm';
export const SETTINGS_TAB_AGENT: string = 'agent';
export const SETTINGS_TAB_STORAGE: string = 'storage';
export const SETTINGS_TAB_WEBUSERS: string = 'webusers';
export const SETTINGS_TAB_ABOUT: string = 'about';
export const SETTINGS_TAB_ACCOUNT: string = 'account';
/** 开发者分区（SSE 录制 + 连接状态；原生新增，对齐 web `SettingsDeveloper.tsx`）。 */
export const SETTINGS_TAB_DEVELOPER: string = 'developer';
/** 插件分区（配置读写 + 启停 + 重载；对齐 web `SettingsPlugins.tsx`）。 */
export const SETTINGS_TAB_PLUGINS: string = 'plugins';
/**
 * 「渠道」分区 —— 消息渠道配置（飞书等），逐条移植 web `SettingsChannels.tsx`。
 *
 * 已实现（`components/SettingsChannels.ets` + 纯逻辑 `core/channelscfg.ets`）⇒ `implemented=true`。
 */
export const SETTINGS_TAB_CHANNELS: string = 'channels';
/**
 * 「通知」分区 —— 通知偏好（**含通知正文隐私开关** `KEY_NOTIFY_DETAIL`）。
 *
 * ⛔ 此前只有服务端偏好键与消费链路（`core/settings.ets` 的 `notifyPrefsFrom`/`notifyPrefValue`
 *    → `core/notify.ets`），**没有任何 UI 入口** ⇒ 用户关不掉"通知显示正文"。
 *    本分区是它的唯一入口；显示值**同源**于 `notifyPrefsFrom`，写入走既有 `set_setting`。
 */
export const SETTINGS_TAB_NOTIFY: string = 'notify';

/**
 * 全部分区规格（**唯一来源**：id + 显示名 + 是否已实现）。
 *
 * ⛔ 判据不在 build() 里散写：`build` 只消费 `shouldShowTab`
 *    （`core/settingsplugins.ets`，可脱机单测）—— 未实现的分区**一律不出现**，
 *    而不是渲染一个空壳让用户以为"坏了"。
 */
function settingsTabSpecs(): SettingsTabSpec[] {
  return [
    new SettingsTabSpec(SETTINGS_TAB_APPEARANCE, '外观', true),
    new SettingsTabSpec(SETTINGS_TAB_TOOLS, '工具', true),
    new SettingsTabSpec(SETTINGS_TAB_LLM, '模型', true),
    new SettingsTabSpec(SETTINGS_TAB_AGENT, '智能体', true),
    new SettingsTabSpec(SETTINGS_TAB_PLUGINS, '插件', true),
    new SettingsTabSpec(SETTINGS_TAB_CHANNELS, '消息渠道', true),
    new SettingsTabSpec(SETTINGS_TAB_STORAGE, '存储', true),
    new SettingsTabSpec(SETTINGS_TAB_WEBUSERS, 'Web 账号', true),
    new SettingsTabSpec(SETTINGS_TAB_DEVELOPER, '开发者', true),
    new SettingsTabSpec(SETTINGS_TAB_NOTIFY, '通知', true),
    new SettingsTabSpec(SETTINGS_TAB_ABOUT, '关于', true),
    new SettingsTabSpec(SETTINGS_TAB_ACCOUNT, '账号', true),
  ];
}

@Component
export struct SettingsPanel {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';
  /** 初始分区（可选；默认「外观」）。 */
  @Prop initialTab: string = SETTINGS_TAB_APPEARANCE;

  // ── 注入契约（由页面注入；`Index.ets` 侧归 sidebar-ux）────────────────────────
  /** 关闭面板（页面置 `showSettingsPanel = false`）。**X 与返回都走它。** */
  onClose: () => void = () => {
  };
  /** 服务端设置镜像（页面 `store.settings`）——「外观」分区显示值只从这里派生。 */
  @Prop settings: Record<string, string> = {};
  /** 聊天界面是否内嵌网页（页面 `useWebUI`）。 */
  @Prop surfaceWeb: boolean = false;
  /** 系统通知授权状态（页面 `notifyOn`）。 */
  @Prop notifyOn: boolean = false;
  /** 当前会话渠道（页面 `store.channel`）——「开发者 → 导出会话」要用（空 ⇒ 导出按钮禁用）。 */
  @Prop channel: string = '';
  /** 当前会话 id（页面 `store.currentChatId`）——同上。 */
  @Prop chatID: string = '';
  /** 写一项设置（页面 `setSetting`）。 */
  onSetSetting: (key: string, value: string) => void = () => {
  };
  /** 切换主题（页面：置 `themeName` + 落盘 + `syncSystemTheme`）。 */
  onSetTheme: (t: string) => void = () => {
  };
  /** 切换承载方式（页面 `setSurface`）。 */
  onSetSurface: (web: boolean) => void = () => {
  };
  /** 通知提醒开关（页面 `applyNotifyToggle`）。 */
  onSetNotify: (on: boolean) => void = () => {
  };
  /** 重读设置（页面重拉 `store.loadSettings()`）。 */
  onRefresh: () => void = () => {
  };

  @State private active: string = SETTINGS_TAB_APPEARANCE;

  aboutToAppear(): void {
    // ⛔ 用**规格门控**回落：`initialTab` 若指向未实现（被隐藏）的分区 ⇒ 落到首个可见分区。
    this.active = fallbackTabId(settingsTabSpecs(), this.initialTab);
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 实际**显示**的分区 = 全量规格经 `shouldShowTab` 过滤（未实现的一律不出现）。 */
  private tabs(): SettingsTabSpec[] {
    return visibleTabs(settingsTabSpecs());
  }

  // ── 通知分区：通知偏好（含正文隐私开关）────────────────────────────────────────
  //
  // ⛔ 判据与渲染同源：显示值来自 `core/settings.ets` 的 `notifyPrefsFrom`（**不在组件里**
  //    另写一份"默认是否开"）；写入走既有 `set_setting` 路径，成功后**回读**（以后端为准）。

  /** 是否展示通知正文（`KEY_NOTIFY_DETAIL`）。 */
  @State private notifyDetailOn: boolean = true;
  /** 是否已从服务端读过（按需拉取的守卫）。 */
  @State private notifyLoaded: boolean = false;
  @State private notifyBusy: boolean = false;
  @State private notifyErr: string = '';

  /** 读通知偏好（`get_settings`，namespace `cli` —— 与其它面板同一条设置路径）。 */
  private async loadNotifyPrefs(): Promise<void> {
    this.notifyBusy = true;
    try {
      const settings: Record<string, string> = await rpc<Record<string, string>>(
        this.http, RPC_GET_SETTINGS, new GetSettingsParams(SETTINGS_NS_CLI));
      const map: Record<string, string> = settings !== undefined && settings !== null ? settings : {};
      this.notifyDetailOn = notifyPrefsFrom(map).detail;
      this.notifyErr = '';
      this.notifyLoaded = true;
    } catch (e) {
      // 读失败给出可读原因（不静默），开关保持禁用态语义由 busy 表达。
      this.notifyErr = readableRpcError((e as Error).message);
      this.notifyLoaded = false;
    } finally {
      this.notifyBusy = false;
    }
  }

  /** 写通知正文开关：`set_setting` ⇒ **回读**（绝不本地乐观改后假装成功）。 */
  private async setNotifyDetail(next: boolean): Promise<void> {
    if (this.notifyBusy) {
      return;
    }
    this.notifyBusy = true;
    try {
      await rpc<void>(this.http, RPC_SET_SETTING,
        new SetSettingParams(SETTINGS_NS_CLI, KEY_NOTIFY_DETAIL, notifyPrefValue(next)));
      this.notifyBusy = false;
      await this.loadNotifyPrefs();
    } catch (e) {
      this.notifyErr = readableRpcError((e as Error).message);
      this.notifyBusy = false;
    }
  }

  /** 通知分区内容（无参 `@Builder` ⇒ 读 `this`，随状态重建）。 */
  @Builder
  NotifySection() {
    Column({ space: SPACE_SM }) {
      SettingsPanelHeader({
        title: '通知',
        subtitle: '控制系统通知的内容与触发（与 Web 端共用同一份服务端偏好）。',
        theme: this.theme,
      })
      if (this.notifyErr.length > 0) {
        SettingsErrorBar({ message: this.notifyErr, theme: this.theme })
      }
      Column({ space: 0 }) {
        SettingsToolRow({
          label: settingLabel(KEY_NOTIFY_DETAIL),
          description: '关闭后系统通知只提示「有回复/在等你」，不展示回复正文。',
          isOn: this.notifyDetailOn,
          busy: this.notifyBusy || !this.notifyLoaded,
          mono: false,
          theme: this.theme,
          onToggle: (_names: string[], next: boolean) => {
            void this.setNotifyDetail(next);
          },
        })
      }
      .width('100%')
      .padding({ left: INSET_CARD_X, right: INSET_CARD_X, top: INSET_CARD_Y, bottom: INSET_CARD_Y })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
      .borderRadius(RADIUS_CARD)
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /**
   * 面板头部（标题 + 关闭 X）。
   *
   * ⛔ X 走 `onClose`（面板**自己**的关闭入口）——见 `core/sheets.ets` 的 flag 所有权表。
   * ⚠️ 收敛后 `pages/Index.ets` **不再**画这层头部（原 `:2707-2714` 由 sidebar-ux 删）。
   */
  @Builder
  Header() {
    Row() {
      Text('偏好设置')
        .fontSize(fs('type.headline'))
        .fontWeight(fw('type.headline'))
        .lineHeight(lh('type.headline'))
        .letterSpacing(tk('type.headline'))
        .fontColor(tc(this.pal(), 'type.headline'))
        .layoutWeight(1)
      SymbolGlyph($r('sys.symbol.xmark'))
        .fontSize(fs('type.headline'))
        .fontColor([this.pal().textSecondary])
        .padding(SPACE_MD)
        .onClick(() => {
          this.onClose();
        })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: SPACE_LG, right: SPACE_XS, top: SPACE_XS, bottom: SPACE_XS })
  }

  /** 分区切换条（与各面板的"片"同视觉语言）。分区多 ⇒ 横向可滚，避免窄屏挤爆。 */
  @Builder
  TabBar() {
    Scroll() {
      Row({ space: SPACE_XS }) {
        ForEach(this.tabs(), (t: SettingsTabSpec) => {
          Text(t.label)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(t.id === this.active ? this.pal().onAccent : tc(this.pal(), 'type.caption'))
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
            .backgroundColor(t.id === this.active
              ? this.pal().accent
              : surfaceFillOf(this.pal(), 'surface.chip'))
            .borderRadius(RADIUS_PILL)
            .border({
              width: STROKE_HAIRLINE,
              color: t.id === this.active ? this.pal().accent : hairlineOf(this.pal()),
            })
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .onClick(() => {
              this.active = t.id;
              // 通知偏好**按需**拉取（首次进入该分区才发 RPC，避免每次打开设置都打服务端）
              if (t.id === SETTINGS_TAB_NOTIFY && !this.notifyLoaded) {
                void this.loadNotifyPrefs();
              }
            })
        }, (t: SettingsTabSpec) => `tab|${t.id}`)
      }
    }
    .width('100%')
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
  }

  build() {
    Column({ space: SPACE_SM }) {
      this.Header()
      this.TabBar()

      // ⚠️ 各分区面板都 `height('100%')`，用 if/else 只挂一个（避免多份同时发请求）。
      if (this.active === SETTINGS_TAB_APPEARANCE) {
        SettingsAppearance({
          settings: this.settings,
          theme: this.theme,
          surfaceWeb: this.surfaceWeb,
          notifyOn: this.notifyOn,
          onSetSetting: this.onSetSetting,
          onSetTheme: this.onSetTheme,
          onSetSurface: this.onSetSurface,
          onSetNotify: this.onSetNotify,
          onRefresh: this.onRefresh,
        })
      } else if (this.active === SETTINGS_TAB_LLM) {
        SettingsLlm({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_AGENT) {
        SettingsAgent({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_STORAGE) {
        SettingsStorage({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_WEBUSERS) {
        SettingsWebUsers({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_ABOUT) {
        SettingsAbout({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_ACCOUNT) {
        // ⚠️ 用户名需页面侧注入（服务端无 /api/auth/me，见 SettingsAccount 头注）；
        // 未注入时面板回落中性文案，不会空白。
        SettingsAccount({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_DEVELOPER) {
        // 开发者分区：SSE 录制 + 连接状态 + **导出会话**（导出要 http 与会话选择器 ⇒ 一并透传）
        SettingsDeveloper({ http: this.http, theme: this.theme, channel: this.channel, chatID: this.chatID })
      } else if (this.active === SETTINGS_TAB_PLUGINS) {
        // 插件分区：配置读写（写后回读）+ 启停 + 重载（对齐 web SettingsPlugins/PluginManagerPanel）
        SettingsPlugins({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_CHANNELS) {
        // 渠道分区：消息渠道配置（飞书等）—— 逐条移植 web `SettingsChannels.tsx`
        SettingsChannels({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_NOTIFY) {
        // 通知分区：通知偏好（含正文隐私开关 KEY_NOTIFY_DETAIL）
        this.NotifySection()
      } else if (this.active === SETTINGS_TAB_TOOLS) {
        SettingsTools({ http: this.http, theme: this.theme })
      }
      // ⛔ **没有兜底 else**：`active` 恒为 `visibleTabs` 里的 id（aboutToAppear 经
      //   `fallbackTabId` 归一、TabBar 只能点可见项）⇒ 不会有"未实现分区落到错误面板"。
      //   旧实现用 `else → SettingsTools` 兜底，若新增 tab 忘了写分支会**静默渲染工具面板**
      //   （用户看到的是"点插件出来工具"）。显式分支 + 无兜底 = 宁可空，也不错。
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SPACE_LG, right: SPACE_LG, top: SPACE_XS })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`（滑入 + 淡入，只用 transform/opacity）。
    .transition(sheetTransition())
  }
}
