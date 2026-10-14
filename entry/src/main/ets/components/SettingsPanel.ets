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
import { fallbackTabId, SettingsTabSpec, visibleTabs } from '../core/settingsplugins';
import { fs, fw, lh, SettingsErrorBar, SettingsPanelHeader, SettingsToolRow, tc, tk } from './SettingsRows';
// 面板**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不在本文件自造时长/曲线；E3 统一）。
import { sheetTransition } from './anim';
import { KEY_NOTIFY_ASK, KEY_NOTIFY_DETAIL, KEY_NOTIFY_TURN_DONE, NotifyPrefs, notifyPrefValue, notifyPrefsFrom, settingLabel } from '../core/settings';
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

/**
 * 分区芯片的**统一宽度**（vp）—— 苹果式控件网格的关键：**所有芯片同宽**，行才齐。
 *
 * 派生（⛔ 不是就地字面量）：`4 × type.caption` + 两侧内距（`INSET_ROW_X × 2`）+ 发丝
 * = "4 个全角字宽"的预算。**不变式：每个标签的视觉宽度 ≤ 4 个全角字**（见
 * `tools/tests/settings_panel_wrap.test.ts` 的 ⑤：按 CJK=1 / ASCII=0.5 逐标签算宽度并判红）。
 * 真机（1320px / 3.386）：74vp = 250px ⇒ 内容宽 1186px 一行容 4 片（4×(250+27)=1108 ≤ 1186）
 * ⇒ 12 片 = **3 行 × 4 片**（⛔ 改造前是 167/208/248/262px 四种宽度、行尾参差 215/233/644px）。
 */
const TAB_CHIP_W: number = fs('type.caption') * 4.5 + INSET_ROW_X * 2;

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
  /** 当前登录用户名（页面 `this.username` 注入；缺省 ⇒ 账号面板回落中性文案，⛔ 不会空白）。
   *  审计 G1：此前**未透传** ⇒ 账号页**永远看不到真实用户名**（web 显示 `SettingsDialog.tsx:84-90`）。 */
  @Prop username: string = '';

  /** 「设置加载失败 ⇒ 重试」回调（由页面注入；⛔ 必须真的重发请求，不许只改状态位）。
   *  `onRetrySettings` 供 关于/智能体（重拉 `/api/settings`）；`onRetryPluginCatalog` 供 插件（重拉插件目录）。 */
  // ⚠️ ArkTS：`@Prop` 不能用于**函数类型**变量（`10905363`）⇒ 回调用普通成员，
  //    由父组件在构造时注入（回调无需响应式更新）。
  onRetrySettings: () => void = () => {};
  onRetryPluginCatalog: () => void = () => {};
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
    Row() {
      Text('偏好设置')
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
        .accessibilityText('关闭')
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
   * 分区切换条（与各面板的"片"同视觉语言）。
   * ⚠️ **改 `Flex(wrap)`（2026-10-12）**：原先横向 `Scroll` + `scrollBar(Off)` + `clip(true)`
   * 在 6 个分区时会**把末项（消息渠道）切在屏幕右缘**（无滚动提示 ⇒ 看起来"坏了"，真机截图确认）
   * ⇒ 用换行（`FlexWrap.Wrap`）保证**任何屏宽都不切字**，且无需隐藏滚动条这一"看不见的 affordance"。
   */
  @Builder
  TabBar() {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(this.tabs(), (t: SettingsTabSpec) => {
        // 2026-10-13（目标③「对标苹果」）：由「实心芯片网格」改 **下划线式页签**（文本强调 + 指示器）。
        //   装机走查（设置·外观）确认：12 枚同形实心块读起来是"按钮墙"，与 iOS 的分区页签语言不符。
        //   下划线式保住 **12 项同屏可见** 与 `HIT_TARGET_MIN` 命中下限，同时把视觉重量从
        //   "12 个色块"降到"1 条线"（Apple：选中 = 文字加重 + 一条指示线，不是填充块）。
        Column({ space: SPACE_HAIR }) {
          Text(t.label)
            .fontSize(fs('type.subhead'))
            .fontWeight(t.id === this.active ? FontWeight.Medium : fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            // ⛔ `accent` **不得**直接做文字色（该角色对底仅 4.05 < 4.5，仓内铁律见
            //    `tools/tests/accent_chrome.test.ts`）⇒ 文字走 `accentSoft`（5.57–12.0 全主题过线）。
            .fontColor(t.id === this.active ? this.pal().accentSoft : tc(this.pal(), 'type.caption'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Center)
            // ⛔ 这里**不能**给 `width('100%')`：外层 Column 是"按内容定宽"的 flex 子项，
            //    子项要 100% ⇒ 回环解析成**整行宽** ⇒ `Flex(wrap)` 每行只放得下 1 片（装机实测：
            //    12 个页签被排成单列）。居中由外层 Column 的 `alignItems(Center)` 负责。
          // 指示器：**仅选中项上色**（未选中 = 透明 ⇒ 失败方向安全：绝不让"状态缺失"读成"已选中"）。
          Row()
            .width(SPACE_LG)
            .height(STROKE_RAIL)
            .borderRadius(STROKE_RAIL)
            .backgroundColor(t.id === this.active ? this.pal().accent : this.pal().transparent)
        }
        // 统一宽度 + 文字居中（苹果式网格）——⛔ 必须**同时**有：只给 minWidth 而文字左对齐
        // 会让短标签（「存储」）在宽格位里贴左，看着像错位。
        .constraintSize({ minWidth: TAB_CHIP_W, minHeight: HIT_TARGET_MIN })
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .margin({ right: SPACE_XS, bottom: SPACE_XS })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.active = t.id;
          // 通知偏好**按需**拉取（首次进入该分区才发 RPC，避免每次打开设置都打服务端）
          if (t.id === SETTINGS_TAB_NOTIFY && !this.notifyLoaded) {
            void this.loadNotifyPrefs();
          }
        })
      }, (t: SettingsTabSpec) => `tab|${t.id}`)
    }
    .width('100%')
  }

  build() {
    // ⚠️ `space: 0` + 各处**显式**间距（2026-10-12 排版专项）：
    //    原先 `space: SPACE_SM`(12) 与「芯片底 margin 8」「分区标题自带 top 16」三层叠成
    //    **36vp** 死空间（真机实测：芯片条底 y915 → 首个分组标题 y1036 = 121px = 35.7vp）。
    //    现在：页头底距 12（`Header` 自带）→ 芯片条 → 分区（标题自带 top 16 + 芯片底 margin 8）
    //    = 24vp。⛔ 别再往这个 Column 上加 `space`（会重新叠出死空间）。
    Column({ space: 0 }) {
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
        SettingsDeveloper({ http: this.http, theme: this.theme, channel: this.channel, chatID: this.chatID })
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
