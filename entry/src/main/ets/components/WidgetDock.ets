/**
 * WidgetDock —— **常驻信息栏**：声明式插件 widget（`infoBar` zone）在**正常聊天路径**的落点。
 *
 * 为什么需要它（P0 缺口）：此前插件 widget 只在「插件目录」浮层里可见
 * （`components/PluginHost.ets:172-186` 是 `PluginWidgets` 的唯一挂载点）⇒ 正常聊天时
 * **完全看不到**插件推来的信息。
 *
 * 权威基准（web，逐条核对）：
 *   · **落点**：`web/src/layouts/MobileAppShell.tsx:483-487` —— 手机端在 `main` **下方**常驻
 *     `<InfoBar/>`（与桌面 `AppShell` 同位：底栏）；`MessageInput.test.tsx:206`
 *     「delegates the bottom safe area to the InfoBar below」印证它就在**输入框下方**。
 *   · **内容**：`web/src/plugins/InfoBar.tsx:15-27` —— `WidgetZone zone="infoBar"
 *     excludePrefixes={['git:']}`（同条的 SW 更新按钮原生无对应 ⇒ 不移植）。
 *   · **显示判据**：`web/src/plugins/WidgetZone.tsx:56-69` —— 无 span ⇒ 渲染 `empty`
 *     （InfoBar 未传 ⇒ 缺省 `null` ⇒ **零节点**）。
 *
 * ⛔ 判据与渲染同源：显示/过滤/取色角色**全部**来自 `core/widgetsview.ets`
 *    （`widgetDockView` 复用 `widgetsView` 的同一份载荷解析；本组件不含任何自己的判断）。
 * ⛔ 空态**零占位**：`view.visible === false` ⇒ **零节点 / 零高度**（不改变既有聊天页布局）。
 * ⛔ 颜色零字面量：只用 `colorOf`（role 由 `core/widgetsview.styleColorRole` 给，未知 role 静默不可见 ⇒ 由门禁 ⑥b 拦）。
 * ⛔ 无动效：本组件不引入任何 `.transition`/`animateTo`（唯一在飞动效 = 光球）。
 * ⛔ 会变的内容一律 `@Prop`/`@State` 驱动（`docs/ARKTS-GOTCHAS.md §4`）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, SPACE_SM, SPACE_XS, STROKE_HAIRLINE,
} from '../core/design';
import {
  WIDGET_EVENT_WEB, WidgetDockView, WidgetSpanView, widgetDockView,
} from '../core/widgetsview';
import { fs, fw, lh } from './SettingsRows';

/**
 * 信息栏高（vp）—— web `InfoBar.tsx:21` 的 `height: calc(1.5rem + var(--safe-area-bottom))`
 * = **24px 固定条**（恒定高度，web 注释明写"stable fixed-height strip keeps the layout rock-solid"）。
 * ⚠️ 纯几何常量（非颜色/时长）⇒ 不进 design token。
 */
const DOCK_H: number = 24;

/**
 * 插件的 `infoBar` widget：细条 + 横向可滚的语义色 span 流。
 *
 * 与 `PluginWidgets`（插件目录浮层里的**全量** widget 卡片：所有 zone + 声明式组件）分工明确：
 * 本组件**只**取 `infoBar` 这**一个** zone 的 spans（其余仍由浮层承载）。
 */
@Component
export struct WidgetDock {
  /** 最近一次 widget 载荷原文（`{zones?,components?,revision?}`；空 = 尚未收到）。 */
  @Prop @Watch('syncView') content: string = '';
  /** widget 事件名（`web_widgets` / `plugin_widgets`）—— 与 `content` 一起决定解析结果。 */
  @Prop @Watch('syncView') event: string = WIDGET_EVENT_WEB;
  @Prop theme: string = 'dark';
  /** 视图模型（判据唯一来源；`content`/`event` 变化时就地重建）。 */
  @State view: WidgetDockView = new WidgetDockView();

  aboutToAppear(): void {
    // @Prop 初值不触发 @Watch ⇒ 首帧手动同步一次（同 `PluginWidgets.aboutToAppear`）。
    this.syncView();
  }

  private syncView(): void {
    this.view = widgetDockView(this.event, this.content);
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    // ⛔ 唯一显示判据：没有 infoBar 内容 ⇒ **零节点**（空态零占位，不改变既有布局）。
    if (this.view.visible) {
      Scroll() {
        Row({ space: SPACE_XS }) {
          ForEach(this.view.spans, (s: WidgetSpanView, i: number) => {
            Text(s.text)
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), s.colorRole))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              // ⛔ 横向约束：`Row` 内文本由**插件**提供（长度不可控）⇒ 必须能收缩（门禁 H1）
              .constraintSize({ maxWidth: '100%' })
              .flexShrink(0)
          }, (s: WidgetSpanView, i: number) => `${i}#${s.text}#${s.colorRole}`)
        }
      }
      // 与 web 同形：横向 `overflow-x-auto`（门禁 H0：横向 Scroll 必须有宽度约束 + 自身裁切）
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .clip(true)
      .height(DOCK_H)
      .padding({ left: SPACE_SM, right: SPACE_SM })
      // web `InfoBar.tsx:20`：`border-t border-[var(--border)] bg-[var(--bg-elevated)]`。
      // `--bg-elevated = --bg-secondary-src`（`index.css:159`）⇒ 本仓映射 `bg-secondary→surface`
      // （`core/theme.ets:346`），故用 `surface`；分隔用**结构性发丝**（与本页顶栏同一支笔）。
      .backgroundColor(colorOf(this.pal(), 'surface'))
      .border({ width: { top: STROKE_HAIRLINE }, color: hairlineOf(this.pal()) })
      .id('xbot-widget-dock')
    }
  }
}
