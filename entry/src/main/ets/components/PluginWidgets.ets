/**
 * PluginWidgets — 插件 widget 的**渲染层**（web `PluginWidgetProvider` + `WidgetZone` + `components.tsx`
 * 的原生对应）。本组件**只画**：一切"该不该显示 / 怎么降级 / 用什么色"的判断在
 * `core/widgetsview.ets`（纯逻辑，可脱机单测）里，组件不得自己再判一次（判据与渲染同源）。
 *
 * 权威基准（web）：
 *   · zones/span → `web/src/plugins/WidgetZone.tsx:14-23,38-69`（style→色，`href` 成链接，无内容不渲染）；
 *   · 声明式组件 → `web/src/plugins/components.tsx:37-259`（badge/progress/metric/list/markdown …）；
 *   · `code`/`src` → `PluginComponentPanel.tsx:72-87`（iframe 沙箱 ⇒ 原生**显式降级**）。
 *
 * ⛔ 视觉纪律：颜色只用 `core/design.ets:colorOf` + 语义面 token（禁 hex）；尺度只用 design token。
 * ⛔ 会变的内容一律 `@Prop`/`@State` 驱动；条目是**独立 `@Component`**（带参 `@Builder` 的子树
 *    不随参数重建 —— docs/ARKTS-GOTCHAS §4）。
 * ⛔ 显示判据唯一：`view.visible`（空载荷 ⇒ **零节点**，不产空壳）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, typeOf, wellOf,
  GAP_ROW_Y, GAP_SECTION, INSET_CARD_X, INSET_CARD_Y, INSET_CHIP_X, INSET_CHIP_Y,
  INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, RADIUS_CHIP, SPACE_HAIR, SPACE_XS,
} from '../core/design';
import {
  KIND_BADGE, KIND_LIST, KIND_MARKDOWN, KIND_METRIC, KIND_PROGRESS,
  WIDGET_EVENT_WEB, WidgetComponentView, WidgetItemView, WidgetSpanView, WidgetsView,
  WidgetZoneView, toneColorRole, widgetsView,
} from '../core/widgetsview';

/** 进度条高度（vp）——纯几何常量（非颜色/时长，不进 design token）。 */
const BAR_H: number = 6;
/** badge 圆点边长（vp）。 */
const DOT: number = 6;

/** 一个分区（zone）：显示名 + 其 styled spans 横向流（web `WidgetZone`）。 */
@Component
struct WidgetZoneRow {
  @Prop zone: WidgetZoneView = new WidgetZoneView();
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_XS }) {
      Text(this.zone.label)
        .fontSize(typeOf('type.micro').size)
        .fontColor(this.pal().textMuted)
        .flexShrink(0)
      Row({ space: SPACE_XS }) {
        ForEach(this.zone.spans, (s: WidgetSpanView, i: number) => {
          Text(s.text)
            .fontSize(typeOf('type.caption').size)
            .fontColor(colorOf(this.pal(), s.colorRole))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }, (s: WidgetSpanView, i: number) => `${i}#${s.colorRole}`)
      }
      .layoutWeight(1)
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }
}

/** 一个声明式组件（按 `kind` 分派；`unsupported` ⇒ 可见降级行）。 */
@Component
struct WidgetComponentCard {
  @Prop view: WidgetComponentView = new WidgetComponentView();
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private label(): string {
    return this.view.title.length > 0 ? this.view.title : this.view.widgetId;
  }

  @Builder
  CardBody() {
    Column({ space: GAP_ROW_Y }) {
      // 标题（有才画；web `PluginComponentPanel.tsx:67-69`）
      if (this.label().length > 0 && this.view.kind !== KIND_BADGE) {
        Text(this.label())
          .fontSize(typeOf('type.micro').size)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().textSecondary)
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      if (this.view.kind === KIND_BADGE) {
        // web `BadgeWidget`：圆角胶囊 + 语义色文字 + 可选脉冲点（此处**静态**：无常驻动效纪律）
        Row({ space: SPACE_HAIR }) {
          Row()
            .width(DOT).height(DOT)
            .backgroundColor(colorOf(this.pal(), toneColorRole(this.view.tone)))
            .borderRadius(DOT / 2)
          Text(this.view.badgeText)
            .fontSize(typeOf('type.micro').size)
            .fontWeight(FontWeight.Medium)
            .fontColor(colorOf(this.pal(), toneColorRole(this.view.tone)))
        }
        .padding({ left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
        .backgroundColor(wellOf(this.pal()))
        .borderRadius(RADIUS_CHIP)
      } else if (this.view.kind === KIND_PROGRESS) {
        // web `ProgressWidget`：label + 条 + 百分比
        if (this.view.progressLabel.length > 0) {
          Text(this.view.progressLabel)
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.pal().textSecondary)
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width(`${this.pct()}%`)
            .height(BAR_H)
            .backgroundColor(this.pal().accentSoft)
            .borderRadius(BAR_H / 2)
        }
        .width('100%').height(BAR_H)
        .backgroundColor(wellOf(this.pal()))
        .borderRadius(BAR_H / 2)
        if (this.view.showValue) {
          Text(`${Math.round(this.pct())}%`)
            .fontSize(typeOf('type.micro').size)
            .fontColor(this.pal().textMuted)
            .width('100%')
            .textAlign(TextAlign.End)
        }
      } else if (this.view.kind === KIND_METRIC) {
        // web `MetricWidget`：label + 大值 + delta
        Row({ space: SPACE_XS }) {
          Text(this.view.metricValue)
            .fontSize(typeOf('type.headline').size)
            .fontWeight(FontWeight.SemiBold)
            .fontColor(this.pal().textPrimary)
          if (this.view.metricDelta.length > 0) {
            Text(this.view.metricDelta)
              .fontSize(typeOf('type.micro').size)
              .fontColor(this.deltaRole() === 'textPrimary' ? this.pal().textMuted
                : colorOf(this.pal(), this.deltaRole()))
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Bottom)
        if (this.view.metricLabel.length > 0) {
          Text(this.view.metricLabel)
            .fontSize(typeOf('type.micro').size)
            .fontColor(this.pal().textMuted)
            .width('100%')
            .textAlign(TextAlign.Start)
        }
      } else if (this.view.kind === KIND_LIST) {
        // web `ListWidget`：title + key:value 行
        if (this.view.listTitle.length > 0) {
          Text(this.view.listTitle)
            .fontSize(typeOf('type.caption').size)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().textSecondary)
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        ForEach(this.view.listItems, (it: WidgetItemView, i: number) => {
          Row() {
            Text(it.key)
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.pal().textSecondary)
              .layoutWeight(1)
              .textAlign(TextAlign.Start)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(it.value)
              .fontSize(typeOf('type.caption').size)
              .fontWeight(FontWeight.Medium)
              .fontColor(colorOf(this.pal(), toneColorRole(it.tone)))
              .flexShrink(0)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }, (it: WidgetItemView, i: number) => `${i}#${it.key}`)
      } else if (this.view.kind === KIND_MARKDOWN) {
        // web `MarkdownWidget`：逐行渲染为段落（此处直接读 `markdownText`，行由 '\n' 分）
        Text(this.view.markdownText)
          .fontSize(typeOf('type.callout').size)
          .fontColor(this.pal().textPrimary)
          .width('100%')
          .textAlign(TextAlign.Start)
      } else {
        // 降级（未知 / web 有但原生未实现 / code-src 沙箱）——**可见占位 + reason**，绝不静默。
        Row({ space: SPACE_HAIR }) {
          Text('暂不支持')
            .fontSize(typeOf('type.micro').size)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().statusWaiting)
            .flexShrink(0)
          Text(this.view.kind.length > 0 && this.view.reason.length === 0
            ? this.view.kind : `${this.view.kind}${this.view.reason.length > 0 ? ' · ' + this.view.reason : ''}`)
            .fontSize(typeOf('type.micro').size)
            .fontColor(this.pal().textMuted)
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private pct(): number {
    const max: number = this.view.progressMax > 0 ? this.view.progressMax : 100;
    let p: number = (this.view.progressValue / max) * 100;
    if (p < 0) { p = 0; }
    if (p > 100) { p = 100; }
    return p;
  }

  private deltaRole(): string {
    // web `components.tsx:78`：delta 不以 '-' 开头 ⇒ 正向（绿），否则负向（红）。
    if (this.view.metricDelta.length === 0) { return 'textPrimary'; }
    return this.view.metricDelta.startsWith('-') ? 'dangerText' : 'successText';
  }

  build() {
    Column() {
      this.CardBody()
    }
    .width('100%')
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .backgroundColor(wellOf(this.pal()))
    .borderRadius(RADIUS_CHIP)
  }
}

/**
 * 插件 widget 面板（zones + 声明式组件）。
 *
 * ⚠️ 本组件**只负责自身渲染与降级表达**；把哪一次的 widget 载荷、放在页面何处由宿主注入
 *    （接线说明见交付；`pages/Index.ets` 归 `arch-split`）。
 */
@Component
export struct PluginWidgets {
  /** 最近一次 widget 载荷原文（`{zones?,components?,revision?}`；空 = 尚未收到）。 */
  @Prop @Watch('syncView') content: string = '';
  /** 事件名（`web_widgets` / `plugin_widgets`）——复用 `core/panels.isWidgetEvent` 判据。 */
  @Prop event: string = WIDGET_EVENT_WEB;
  @Prop theme: string = 'dark';
  /** 视图模型（判据唯一来源；`content`/`event` 变化时就地重建）。 */
  @State view: WidgetsView = new WidgetsView();

  aboutToAppear(): void {
    // @Prop 初值不触发 @Watch ⇒ 首帧手动同步一次。
    this.syncView();
  }

  private syncView(): void {
    this.view = widgetsView(this.event, this.content);
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    // ⛔ 唯一显示判据：空载荷 / 全空分区 ⇒ 零节点（不产空壳）。
    if (this.view.visible) {
      Column({ space: GAP_SECTION }) {
        Column({ space: GAP_SECTION }) {
          if (!this.view.ok) {
            // 坏载荷（非空）⇒ **显式降级行**（绝不静默丢）。
            Row({ space: SPACE_HAIR }) {
              Text('插件数据无效')
                .fontSize(typeOf('type.micro').size)
                .fontColor(this.pal().dangerText)
                .flexShrink(0)
              Text(this.view.reason)
                .fontSize(typeOf('type.micro').size)
                .fontColor(this.pal().textMuted)
                .layoutWeight(1)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
          } else {
            ForEach(this.view.zones, (z: WidgetZoneView, i: number) => {
              WidgetZoneRow({ zone: z, theme: this.theme })
            }, (z: WidgetZoneView, i: number) => z.name)
            ForEach(this.view.components, (c: WidgetComponentView, i: number) => {
              WidgetComponentCard({ view: c, theme: this.theme })
            }, (c: WidgetComponentView, i: number) => `${i}#${c.widgetId}`)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding({
        left: INSET_CARD_X, right: INSET_CARD_X, top: INSET_CARD_Y, bottom: INSET_CARD_Y,
      })
      .backgroundColor(this.pal().surface)
      .borderRadius(RADIUS_CARD)
      // 浅色系靠结构性发丝立边（`core/design.ets:surfaceRoles` 的 `surface.card` 契约）。
      .border({ width: SPACE_HAIR, color: hairlineOf(this.pal()) })
    }
  }
}
