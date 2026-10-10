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
import { SettingsLlm } from './SettingsLlm';
import { SettingsStorage } from './SettingsStorage';
import { SettingsTools } from './SettingsTools';
import { SettingsWebUsers } from './SettingsWebUsers';

/** 分区 id（tab 顺序 = 此顺序）。 */
export const SETTINGS_TAB_TOOLS: string = 'tools';
export const SETTINGS_TAB_LLM: string = 'llm';
export const SETTINGS_TAB_AGENT: string = 'agent';
export const SETTINGS_TAB_STORAGE: string = 'storage';
export const SETTINGS_TAB_WEBUSERS: string = 'webusers';
export const SETTINGS_TAB_ABOUT: string = 'about';
export const SETTINGS_TAB_ACCOUNT: string = 'account';

/** tab 定义（id + 显示名）——用数组而非 Map，保持 ArkTS 友好与顺序稳定。 */
class SettingsTab {
  id: string = '';
  label: string = '';

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }
}

/** 全部分区（web 设置弹窗的服务端配置面；原生按此顺序落地）。 */
function settingsTabs(): SettingsTab[] {
  return [
    new SettingsTab(SETTINGS_TAB_TOOLS, '工具'),
    new SettingsTab(SETTINGS_TAB_LLM, '模型'),
    new SettingsTab(SETTINGS_TAB_AGENT, '智能体'),
    new SettingsTab(SETTINGS_TAB_STORAGE, '存储'),
    new SettingsTab(SETTINGS_TAB_WEBUSERS, 'Web 账号'),
    new SettingsTab(SETTINGS_TAB_ABOUT, '关于'),
    new SettingsTab(SETTINGS_TAB_ACCOUNT, '账号'),
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
    this.active = this.tabs().some((t: SettingsTab) => t.id === this.initialTab)
      ? this.initialTab
      : SETTINGS_TAB_TOOLS;
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private tabs(): SettingsTab[] {
    return settingsTabs();
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
      } else {
        SettingsTools({ http: this.http, theme: this.theme })
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_3 })
  }
}
