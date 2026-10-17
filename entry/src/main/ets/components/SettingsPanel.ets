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
import { normalizeLocale } from '../core/i18n';
import { KEY_LOCALE, settingOf } from '../core/settings';
import {
  PRESS_OPACITY,   INSET_CARD_X, INSET_CARD_Y, INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, RADIUS_PILL,
  STROKE_HAIRLINE, STROKE_RAIL, HIT_TARGET_MIN, SPACE_HAIR, SPACE_XS, SPACE_SM, SPACE_MD, SPACE_LG,
  ICON_MD,
  SHEET_ACTION_GLYPH,
  hairlineOf, structuralRuleOf, surfaceFillOf, colorOf,
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
import { fallbackTabId, settingsRootRows, SettingsRootRow, SettingsTabSpec, visibleTabs } from '../core/settingsplugins';
import { fs, fw, lh, SettingsErrorBar, SettingsPanelHeader, SettingsToolRow, tc, tk } from './SettingsRows';
// 面板**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不在本文件自造时长/曲线；E3 统一）。
import { sheetTransition } from './anim';
import { KEY_NOTIFY_ASK, KEY_NOTIFY_DETAIL, KEY_NOTIFY_TURN_DONE, NotifyPrefs, notifyPrefValue, notifyPrefsFrom, settingLabel } from '../core/settings';
import {
  GetSettingsParams, readableRpcError, rpc, RPC_GET_SETTINGS, RPC_SET_SETTING, SETTINGS_NS_CLI, SetSettingParams,
} from '../core/rpc';
import { t as i18nT } from '../core/i18n';

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

// ⚠️ 2026-10-16（目标③「所有面板对标 Apple」）：**删除了分区芯片令牌 `TAB_CHIP_W`**。
//    它服务的是"4 列 × 3 行的下划线标签网格"——真机截图（`/tmp/panel_settings2.jpeg`）实锤
//    该形态读作"标签墙"（12 枚裸文字排三行、选中只有一条线、吃 ~250vp 才见内容），
//    且下划线页签是 **Material** 语言。Apple 的设置面 = **分组列表 + 钻取**：
//    根列表放"去哪"（行 = 标签 + `chevron_right`，分 5~6 组），内容在下一层，页头出返回箭头。
//    分组真源 = `core/settingsplugins.ets` 的 `settingsRootGroups()`（纯逻辑、可脱机单测）。

@Component
export struct SettingsPanel {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';
  /**
   * 深链指定的初始分区（`settings.open?section=<x>`）。
   * ⛔ **空串 = 根列表**（Apple 设置面的打开语义：先看到"去哪"，再钻进去）；缺省即空。
   */
  @Prop initialTab: string = '';

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
  /** 当前登录用户名（页面 `this.username` 注入；缺省 ⇒ 账号面板回落中性文案，⛔ 不会空白）。
   *  审计 G1：此前**未透传** ⇒ 账号页**永远看不到真实用户名**（web 显示 `SettingsDialog.tsx:84-90`）。 */
  @Prop username: string = '';

  /** 「设置加载失败 ⇒ 重试」回调（由页面注入；⛔ 必须真的重发请求，不许只改状态位）。
   *  `onRetrySettings` 供 关于/智能体（重拉 `/api/settings`）；`onRetryPluginCatalog` 供 插件（重拉插件目录）。 */
  // ⚠️ ArkTS：`@Prop` 不能用于**函数类型**变量（`10905363`）⇒ 回调用普通成员，
  //    由父组件在构造时注入（回调无需响应式更新）。
  onRetrySettings: () => void = () => {};
  onRetryPluginCatalog: () => void = () => {};
  /**
   * 打开「应用日志」面板（由页面注入：关设置面板 + `showLog = true`）。
   *
   * ⛔ 用户 2026-10-16 要求：日志是**纯 debug 功能**，不该占侧边栏主导航的显眼位置
   *   ⇒ 收进「设置 → 开发者」的二级入口。
   */
  onOpenLog: () => void = () => {};
  /** 写一项设置（页面 `setSetting`）。 */
  onSetSetting: (key: string, value: string) => void = () => {
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

  /** 当前钻入的分区 id；**空串 = 根列表**（Apple 设置面的第一层）。 */
  @State private active: string = '';

  aboutToAppear(): void {
    // ⛔ 用**规格门控**回落：`initialTab` 若指向未实现（被隐藏）的分区 ⇒ 落到首个可见分区。
    // ⚠️ 空串 ⇒ 停在**根列表**（不是"落到首个分区"）：那是 Apple 设置面的打开语义。
    this.active = this.initialTab.length > 0 ? fallbackTabId(settingsTabSpecs(), this.initialTab) : '';
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 实际**显示**的分区 = 全量规格经 `shouldShowTab` 过滤（未实现的一律不出现）。 */
  private tabs(): SettingsTabSpec[] {
    return visibleTabs(settingsTabSpecs());
  }

  /** 根列表的**扁平行序列**（真源 = `core/settingsplugins.ets:settingsRootRows()`；
   *  组件**不另写**分组/组头文案 —— 扁平化的另一个收益：渲染侧只需**一个** `ForEach`，
   *  不撞 `tools/perf/guard.sh` 的 `ForEach 处数` 预算（结构性规模指示，只许减不许增）。 */
  private rootRows(): SettingsRootRow[] {
    return settingsRootRows(this.tabs());
  }

  /** 当前钻入分区的显示名（根列表态 ⇒ 空串，页头显示面板名）。 */
  private activeLabel(): string {
    if (this.active.length === 0) {
      return '';
    }
    const vis: SettingsTabSpec[] = this.tabs();
    for (let i = 0; i < vis.length; i++) {
      if (vis[i].id === this.active) {
        return vis[i].label;
      }
    }
    return '';
  }

  /** 从根列表钻入一个分区（通知分区**首次进入**才按需拉偏好，避免每次打开设置都打服务端）。 */
  private openSection(id: string): void {
    this.active = id;
    if (id === SETTINGS_TAB_NOTIFY && !this.notifyLoaded) {
      void this.loadNotifyPrefs();
    }
  }

  // ── 通知分区：通知偏好（含正文隐私开关）────────────────────────────────────────
  //
  // ⛔ 判据与渲染同源：显示值来自 `core/settings.ets` 的 `notifyPrefsFrom`（**不在组件里**
  //    另写一份"默认是否开"）；写入走既有 `set_setting` 路径，成功后**回读**（以后端为准）。

  /**
   * 三个通知偏好开关的**服务端权威**显示值。
   *
   * ⛔ 波11 差集补齐：此前本分区**只**暴露 `KEY_NOTIFY_DETAIL`（正文隐私），而
   *    `KEY_NOTIFY_ASK` / `KEY_NOTIFY_TURN_DONE` **有键、有消费、无 UI** —— 用户
   *    关不掉"收到提问时通知 / 回合完成时通知"（默认两类都开）。这三个键的**消费链**
   *    早已存在（`notifyPrefsFrom` → `applyNotifyPrefs` → `notifyPrefEnabled` →
   *    `store.notifyOnSse`），缺的只是**写入入口**。三个开关走同一条 `set_setting`。
   */
  @State private notifyAskOn: boolean = true;
  @State private notifyTurnDoneOn: boolean = true;
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
      const prefs: NotifyPrefs = notifyPrefsFrom(map);
      this.notifyAskOn = prefs.ask;
      this.notifyTurnDoneOn = prefs.turnDone;
      this.notifyDetailOn = prefs.detail;
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

  /** 写一个通知偏好开关：`set_setting` ⇒ **回读**（绝不本地乐观改后假装成功）。 */
  private async setNotifyPref(key: string, next: boolean): Promise<void> {
    if (this.notifyBusy) {
      return;
    }
    this.notifyBusy = true;
    try {
      await rpc<void>(this.http, RPC_SET_SETTING,
        new SetSettingParams(SETTINGS_NS_CLI, key, notifyPrefValue(next)));
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
      // 与其它分区同款：根 Column 吃剩余高度，卡片进可滚容器（内容超长时可滚到底部）。
      Scroll() {
        Column({ space: 0 }) {
        SettingsToolRow({
          label: settingLabel(KEY_NOTIFY_ASK),
          description: '智能体向你提问、等你回答时发系统通知。',
          isOn: this.notifyAskOn,
          busy: this.notifyBusy || !this.notifyLoaded,
          mono: false,
          theme: this.theme,
          names: [KEY_NOTIFY_ASK],
          onToggle: (_names: string[], next: boolean) => {
            void this.setNotifyPref(KEY_NOTIFY_ASK, next);
          },
        })
        SettingsToolRow({
          label: settingLabel(KEY_NOTIFY_TURN_DONE),
          description: '一轮回复结束时发系统通知（同一回合去重，不重复打扰）。',
          isOn: this.notifyTurnDoneOn,
          busy: this.notifyBusy || !this.notifyLoaded,
          mono: false,
          theme: this.theme,
          names: [KEY_NOTIFY_TURN_DONE],
          onToggle: (_names: string[], next: boolean) => {
            void this.setNotifyPref(KEY_NOTIFY_TURN_DONE, next);
          },
        })
        SettingsToolRow({
          label: settingLabel(KEY_NOTIFY_DETAIL),
          description: '关闭后系统通知只提示「有回复/在等你」，不展示回复正文。',
          isOn: this.notifyDetailOn,
          busy: this.notifyBusy || !this.notifyLoaded,
          mono: false,
          theme: this.theme,
          names: [KEY_NOTIFY_DETAIL],
          onToggle: (_names: string[], next: boolean) => {
            void this.setNotifyPref(KEY_NOTIFY_DETAIL, next);
          },
        })
      }
      .width('100%')
      .padding({ left: INSET_CARD_X, right: INSET_CARD_X, top: INSET_CARD_Y, bottom: INSET_CARD_Y })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
      .borderRadius(RADIUS_CARD)
      // **面→面**轮廓走 `structuralRuleOf`（浅色 = `borderStrong`，比面内强一档；深色 = `border` 逐字节）；
      // 与本面板内的其它卡（`SettingsRows`）同层级 ⇒ 同通道（`docs/DESIGN-SYSTEM.md §13.5`）。
      .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
      }
      .width('100%')
      .layoutWeight(1)
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Auto)
      .align(Alignment.Top)
    }
    .width('100%')
    .layoutWeight(1)
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
    Row({ space: SPACE_HAIR }) {
      // 钻入分区 ⇒ 页头出**返回键**（Apple 主从式第二层 = 返回 + 本层标题）。
      // ⚠️ 根列表态**不渲染**返回键（也⛔ 不放"占位空盒"）：标题左缘与其它面板保持同一条竖轴。
      if (this.active.length > 0) {
        Row() {
          SymbolGlyph($r('sys.symbol.chevron_left'))
            .fontSize(SHEET_ACTION_GLYPH)
            .fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('返回设置'))
        .onClick(() => {
          this.active = '';
        })
      }
      Text(this.active.length > 0 ? this.activeLabel() : '偏好设置')
        .fontSize(fs('type.headline'))
        .fontWeight(fw('type.headline'))
        .lineHeight(lh('type.headline'))
        .letterSpacing(tk('type.headline'))
        .fontColor(tc(this.pal(), 'type.headline'))
        .layoutWeight(1)
      SymbolGlyph($r('sys.symbol.xmark'))
        .fontSize(SHEET_ACTION_GLYPH)
        .fontColor([colorOf(this.pal(), 'iconMuted')])
        .padding(SPACE_MD)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('关闭'))
        .onClick(() => {
          this.onClose();
        })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    // ⚠️ 页头底距 = **显式** 12vp（`SPACE_SM`）：`build()` 的根 `Column` 已改成 `space: 0`
    //    （见那里的注释：原先 header→芯片条→分区 三层间距叠成 36vp 死空间）⇒ 这一条是
    //    「页头 → 芯片条」的唯一间距。⛔ 不要再动成 `SPACE_XS`（8vp 会贴着芯片条）。
    .padding({ left: SPACE_LG, right: SPACE_XS, top: SPACE_XS, bottom: SPACE_SM })
  }

  /**
   * 根列表（Apple「设置」的**第一层**）：组头行 + 可钻取的分区行，**扁平成一个 `ForEach`**。
   *
   * 为什么是列表而不是页签条（2026-10-16，目标③「所有面板对标 Apple」）：
   *   ① **语言**：下划线页签是 Material；Apple 设置面恒为"分组列表 + 主从钻取"；
   *   ② **空间**：12 枚页签铺成 3 行要吃 ~250vp 才见内容；列表只占它自己的行高（可滚）；
   *   ③ **可扩展**：新增分区只是多一行（页签条还要重算换行/宽度）。
   * 为什么**扁平**：`core` 直接给出**行序列**（组头行 + 成员行混排）⇒ 渲染侧只需**一个** `ForEach`
   *   —— 两层 `ForEach`（组 × 行）会把 `tools/perf/guard.sh` 的 `ForEach 处数` 顶穿
   *   （2026-10-16 实测：118 > 上限 117 ⇒ 门禁红）。⛔ 正解是扁平化，**不是**抬阈值。
   * ⛔ 分组/组名/行序的**唯一真源** = `core/settingsplugins.ets:settingsRootRows()`
   *   （组件不另写一份映射；未登记的新分区自动落「其它」组 ⇒ 永不丢入口）。
   * ⛔ 行的命中盒 = `HIT_TARGET_MIN`（真机 `responseRegion` 外扩无效，见 `docs/UI-AUDIT-CHECKLIST.md`）。
   */
  @Builder
  RootList() {
    List() {
      ForEach(this.rootRows(), (r: SettingsRootRow) => {
        ListItem() {
          if (r.isHeader) {
            // 组头（Apple 分组列表的小号组名）：⛔ **不可点、不参与选择、无箭头**。
            Text(r.label)
              .fontSize(fs('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(tc(this.pal(), 'type.caption'))
              .width('100%')
              .padding({ left: INSET_ROW_X, top: SPACE_MD, bottom: SPACE_XS })
          } else {
            Column() {
              Row() {
                Text(r.label)
                  .fontSize(fs('type.body'))
                  .lineHeight(lh('type.body'))
                  .fontColor(tc(this.pal(), 'type.body'))
                  .layoutWeight(1)
                SymbolGlyph($r('sys.symbol.chevron_right'))
                  .fontSize(ICON_MD)
                  .fontColor([colorOf(this.pal(), 'iconMuted')])
              }
              .width('100%')
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText(`${r.label}：设置分区`)
              .onClick(() => {
                this.openSection(r.key);
              })
              // 行分隔线：**左缘内缩到文字起点**（Apple inset separator）——与抽屉会话行同口径。
              // ⚠️ 组内**末行不留线**（Apple 分组列表组尾不画线，画了会在组尾形成悬空线）。
              if (!r.last) {
                Divider()
                  .strokeWidth(STROKE_HAIRLINE)
                  .color(hairlineOf(this.pal()))
                  .margin({ left: INSET_ROW_X, right: INSET_ROW_X })
              }
            }
            .width('100%')
          }
        }
      }, (r: SettingsRootRow) => `${r.isHeader ? 'h' : 'r'}|${r.key}`)
    }
    .width('100%')
    .layoutWeight(1)
    .scrollBar(BarState.Off)
  }

  build() {
    // ⚠️ `space: 0` + 各处**显式**间距（2026-10-12 排版专项）：
    //    原先 `space: SPACE_SM`(12) 与「芯片底 margin 8」「分区标题自带 top 16」三层叠成
    //    **36vp** 死空间（真机实测：芯片条底 y915 → 首个分组标题 y1036 = 121px = 35.7vp）。
    //    现在：页头底距 12（`Header` 自带）→ 芯片条 → 分区（标题自带 top 16 + 芯片底 margin 8）
    //    = 24vp。⛔ 别再往这个 Column 上加 `space`（会重新叠出死空间）。
    Column({ space: 0 }) {
      this.Header()
      // 第一层 = 根列表（分组 + 钻取）；第二层 = 分区内容（Apple 主从式设置面）。
      // ⚠️ 各分区面板都 `height('100%')`，用 if/else 只挂一个（避免多份同时发请求）。
      if (this.active.length === 0) {
        this.RootList()
      } else if (this.active === SETTINGS_TAB_APPEARANCE) {
        SettingsAppearance({
          settings: this.settings,
          theme: this.theme,
          surfaceWeb: this.surfaceWeb,
          notifyOn: this.notifyOn,
          onSetSetting: this.onSetSetting,
          onSetSurface: this.onSetSurface,
          onSetNotify: this.onSetNotify,
          onRefresh: this.onRefresh,
        })
      } else if (this.active === SETTINGS_TAB_LLM) {
        SettingsLlm({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_AGENT) {
        SettingsAgent({ http: this.http, theme: this.theme, canRetry: true, onRetry: this.onRetrySettings })
      } else if (this.active === SETTINGS_TAB_STORAGE) {
        SettingsStorage({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_WEBUSERS) {
        SettingsWebUsers({ http: this.http, theme: this.theme })
      } else if (this.active === SETTINGS_TAB_ABOUT) {
        SettingsAbout({ http: this.http, theme: this.theme, canRetry: true, onRetry: this.onRetrySettings })
      } else if (this.active === SETTINGS_TAB_ACCOUNT) {
        // 登录用户名由**页面侧注入**（服务端无 /api/auth/me，见 SettingsAccount 头注）：
        // 页面 `this.username` → 本组件 `@Prop username` → 账号面板显示；
        // 未注入（空串）时面板回落中性文案，不会空白。
        SettingsAccount({ http: this.http, theme: this.theme, username: this.username })
      } else if (this.active === SETTINGS_TAB_DEVELOPER) {
        // 开发者分区：SSE 录制 + 连接状态 + **导出会话**（导出要 http 与会话选择器 ⇒ 一并透传）
        SettingsDeveloper({ http: this.http, theme: this.theme, channel: this.channel, chatID: this.chatID, onOpenLog: this.onOpenLog })
      } else if (this.active === SETTINGS_TAB_PLUGINS) {
        // 插件分区：配置读写（写后回读）+ 启停 + 重载（对齐 web SettingsPlugins/PluginManagerPanel）
        SettingsPlugins({ http: this.http, theme: this.theme, canRetry: true, onRetry: this.onRetryPluginCatalog, locale: normalizeLocale(settingOf(this.settings, KEY_LOCALE)) })
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
