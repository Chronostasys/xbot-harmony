/**
 * SettingsPanel —— **设置面唯一容器**（工具 / 模型 / 智能体 三个分区的 tab 聚合）。
 *
 * 为什么要有它：
 *  1. **单一注入点**：`pages/Index.ets` 是热文件（5000+ 行，多线并行改）。设置面板全部收敛到
 *     这一个组件 ⇒ 入口接线只需一行 `SettingsPanel({ http: store.http, theme: this.theme })`。
 *  2. **消孤儿 / 真编译覆盖**：`components/*.ets` 里没有任何其它文件引用的 `export struct`
 *     **不会被编进 ArkTS 依赖图**，它里面的 ArkTS 错误编译期不报（见 `docs/ARKTS-GOTCHAS.md`
 *     批次13、`tools/lint/orphan-components.sh`）。本组件**真实实例化**三个分区面板 ⇒
 *     它们被真编译覆盖（不再是"假绿"）。
 *
 * ⛔ 真 `@Component` + `@Prop`；**禁止**带参全局 `@Builder`（参数是调用那一刻的快照，子树不重建）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_LG, SP_2, SP_3, SP_5 } from '../core/tokens';
import { SettingsAbout } from './SettingsAbout';
import { SettingsAccount } from './SettingsAccount';
import { SettingsAgent } from './SettingsAgent';
import { SettingsDeveloper } from './SettingsDeveloper';
import { SettingsLlm } from './SettingsLlm';
import { SettingsStorage } from './SettingsStorage';
import { SettingsTools } from './SettingsTools';
import { SettingsWebUsers } from './SettingsWebUsers';
import { SettingsPlugins } from './SettingsPlugins';
import { fallbackTabId, SettingsTabSpec, visibleTabs } from '../core/settingsplugins';
import { SettingsErrorBar, SettingsPanelHeader, SettingsToolRow } from './SettingsRows';
import { KEY_NOTIFY_DETAIL, notifyPrefValue, notifyPrefsFrom, settingLabel } from '../core/settings';
import {
  GetSettingsParams, readableRpcError, rpc, RPC_GET_SETTINGS, RPC_SET_SETTING, SETTINGS_NS_CLI,
} from '../core/rpc';

/** 分区 id（tab 顺序 = 此顺序）。 */
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
 * 「渠道」分区 —— web 有（`SettingsChannels.tsx`）、原生**尚未实现**。
 *
 * ⛔ 显式登记为 `implemented=false`（⇒ 由 `shouldShowTab` 隐藏）：用户亲报的失败模式是
 *    「未实现的分区点进去是空壳 ⇒ 以为坏了」。落地后把 `implemented` 改 `true` 即出现。
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
 * ⛔ 判据不在 build() 里散写：`components/SettingsPanel.build` 只消费 `shouldShowTab`
 *    （`core/settingsplugins.ets`，可脱机单测）—— 未实现的分区**一律不出现**，
 *    而不是渲染一个空壳让用户以为"坏了"。
 */
function settingsTabSpecs(): SettingsTabSpec[] {
  return [
    new SettingsTabSpec(SETTINGS_TAB_TOOLS, '工具', true),
    new SettingsTabSpec(SETTINGS_TAB_LLM, '模型', true),
    new SettingsTabSpec(SETTINGS_TAB_AGENT, '智能体', true),
    new SettingsTabSpec(SETTINGS_TAB_PLUGINS, '插件', true),
    new SettingsTabSpec(SETTINGS_TAB_STORAGE, '存储', true),
    new SettingsTabSpec(SETTINGS_TAB_WEBUSERS, 'Web 账号', true),
    new SettingsTabSpec(SETTINGS_TAB_DEVELOPER, '开发者', true),
    new SettingsTabSpec(SETTINGS_TAB_NOTIFY, '通知', true),
    new SettingsTabSpec(SETTINGS_TAB_ABOUT, '关于', true),
    new SettingsTabSpec(SETTINGS_TAB_ACCOUNT, '账号', true),
    // ⛔ 未实现分区（登记但隐藏）：web 有渠道分区，原生尚未落地 ⇒ 不显示空壳。
    new SettingsTabSpec(SETTINGS_TAB_CHANNELS, '渠道', false),
  ];
}

@Component
export struct SettingsPanel {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';
  /** 初始分区（可选；默认「工具」）。 */
  @Prop initialTab: string = SETTINGS_TAB_TOOLS;

  @State private active: string = SETTINGS_TAB_TOOLS;

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
    Column({ space: SP_3 }) {
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
      .padding(SP_2)
      .backgroundColor(this.pal().surface)
      .borderRadius(R_XL)
      .border({ width: 1, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 分区切换条（与各面板的"片"同视觉语言）。5 个分区 ⇒ 横向可滚，避免窄屏挤爆。 */
  @Builder
  TabBar() {
    Scroll() {
      Row({ space: SP_2 }) {
        ForEach(this.tabs(), (t: SettingsTabSpec) => {
          Text(t.label)
            .fontSize(FS_CAPTION)
            .fontColor(t.id === this.active ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(t.id === this.active ? this.pal().accent : this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .border({ width: 1, color: t.id === this.active ? this.pal().accent : this.pal().border })
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
    Column({ space: SP_3 }) {
      this.TabBar()

      // ⚠️ 各分区面板都 `height('100%')`，用 if/else 只挂一个（避免多份同时发请求）。
      if (this.active === SETTINGS_TAB_LLM) {
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
        // 开发者分区：SSE 录制 + 连接状态（不依赖 http —— 纯本地录制器）
        SettingsDeveloper({ theme: this.theme })
      } else if (this.active === SETTINGS_TAB_PLUGINS) {
        // 插件分区：配置读写（写后回读）+ 启停 + 重载（对齐 web SettingsPlugins/PluginManagerPanel）
        SettingsPlugins({ http: this.http, theme: this.theme })
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
    .padding({ left: SP_5, right: SP_5, top: SP_3 })
  }
}
