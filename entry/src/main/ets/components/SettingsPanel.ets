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

  /** 分区切换条（与各面板的"片"同视觉语言）。5 个分区 ⇒ 横向可滚，避免窄屏挤爆。 */
  @Builder
  TabBar() {
    Scroll() {
      Row({ space: SP_2 }) {
        ForEach(this.tabs(), (t: SettingsTab) => {
          Text(t.label)
            .fontSize(FS_CAPTION)
            .fontColor(t.id === this.active ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(t.id === this.active ? this.pal().accent : this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .border({ width: 1, color: t.id === this.active ? this.pal().accent : this.pal().border })
            .onClick(() => {
              this.active = t.id;
            })
        }, (t: SettingsTab) => `tab|${t.id}`)
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
