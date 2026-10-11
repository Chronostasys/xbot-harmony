/**
 * PluginWidgets — 插件 widget 的**渲染层**（web `PluginWidgetProvider` + `WidgetZone` + `components.tsx`
 * 的原生对应）。本组件**只画**：一切"该不该显示 / 怎么降级 / 用什么色"的判断在
 * `core/widgetsview.ets`（主判据）+ `core/pluginview.ets`（展示算术）里，组件不得自己再判一次
 * （判据与渲染同源 ⇒ `docs/REDESIGN.md §11`）。
 *
 * 权威基准（web）：
 *   · zones/span → `web/src/plugins/WidgetZone.tsx:14-23,38-69`（style→色，`href` 成链接，无内容不渲染）；
 *   · 声明式组件 → `web/src/plugins/components.tsx:37-259`（badge/progress/metric/list/markdown …）；
 *   · `code`/`src` → `PluginComponentPanel.tsx:72-87`（iframe 沙箱 ⇒ 原生**显式降级**）。
 *
 * ── 视觉重排（2026-10-11，`docs/REDESIGN.md`）─────────────────────────────────
 *   · 与 `SettingsPanel/SettingsRows` **同一套语言**：复用 `fs/fw/lh/tc`（排版角色 → 属性）；
 *     chip = `surface.chip`（内嵌凹槽），凹槽（进度轨）= `surface.well`，面 = `surface.card` + 发丝；
 *   · 颜色**一律**经 `colorOf` / `roleColorOf`（禁 `pal().xxx` 直取、禁 hex ⇒ 门禁 ⑥c）；
 *   · ⛔ 浅/深分叉只走 `isLightPalette`（本组件**不需要**分叉：全部走语义 token）；
 *   · ⛔ 唯一在飞动效 = 光球 ⇒ 本组件**零动效**（badge 的脉冲点在本版是**静态**点）。
 *
 * ⛔ 会变的内容一律 `@Prop`/`@State` 驱动；条目是**独立 `@Component`**（带参 `@Builder` 的子树
 *    不随参数重建 —— docs/ARKTS-GOTCHAS §4）。
 * ⛔ 显示判据唯一：`view.visible`（空载荷 ⇒ **零节点**，不产空壳）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, structuralRuleOf, surfaceFillOf, wellOf,
  GAP_ROW_Y, GAP_SECTION, INSET_CARD_X, INSET_CARD_Y, INSET_CHIP_X, INSET_CHIP_Y,
  INSET_ROW_X, INSET_ROW_Y, PILL_MAX_W, RADIUS_CARD, RADIUS_CHIP, RADIUS_PILL, SPACE_HAIR, SPACE_XS,
  STROKE_HAIRLINE, insetHairlineOf } from '../core/design';
import {
  KIND_BADGE, KIND_LIST, KIND_MARKDOWN, KIND_METRIC, KIND_PROGRESS,
  WIDGET_EVENT_WEB, WidgetComponentView, WidgetItemView, WidgetSpanView, WidgetsView,
  WidgetZoneView, toneColorRole, widgetsView,
} from '../core/widgetsview';
import {
  WIDGET_UNSUPPORTED_LABEL, widgetDegradeDetail, widgetDeltaRole, widgetLabel, widgetPercent,
} from '../core/pluginview';
import { fs, fw, lh } from './SettingsRows';

/** 进度条高度（vp）——纯几何常量（非颜色/时长，不进 design token）。 */
const BAR_H: number = 6;
/** badge 圆点边长（vp）。 */
const DOT: number = 6;

/**
 * 语义色角色 → 实际色。
 * ⛔ `warn`（"警告**文字**"角色，`theme_contrast.test.ts:127,450` 已登记、5 套主题全 ≥3:1）不在
 *    `core/design.ets:colorOf` 的解析表里 ⇒ 这里补一条（用的就是 `pal().warn`，**不新增颜色**）。
 *    ⛔ 这是**已知的缺 role**（应补进 `core/design.ets`，由令牌层持有者落；本组件不越界改）。
 *    其余一律走 `colorOf`（唯一解析）。⛔ 本函数**只解析角色**，不参与"该用什么角色"的判据
 *    —— 判据在 `core/widgetsview.ets` + `core/pluginview.ets`（判据与渲染同源）。
 */
function widgetRoleColorOf(p: Palette, role: string): string {
  if (role === 'warn') { return p.warn; }
  return colorOf(p, role);
}

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
        .fontSize(fs('type.micro'))
        .fontWeight(fw('type.micro'))
        .lineHeight(lh('type.micro'))
        .fontColor(colorOf(this.pal(), 'textMuted'))
        .flexShrink(0)
      Row({ space: SPACE_XS }) {
        ForEach(this.zone.spans, (s: WidgetSpanView, i: number) => {
          Text(s.text)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(widgetRoleColorOf(this.pal(), s.colorRole))
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

  /** 标题（有才画；web `PluginComponentPanel.tsx:67-69`）—— 判据在 `core/pluginview.ets`。 */
  private label(): string {
    return widgetLabel(this.view.title, this.view.widgetId);
  }

  @Builder
  CardBody() {
    Column({ space: GAP_ROW_Y }) {
      if (this.label().length > 0 && this.view.kind !== KIND_BADGE) {
        Text(this.label())
          .fontSize(fs('type.micro'))
          .fontWeight(fw('type.micro'))
          .lineHeight(lh('type.micro'))
          .fontColor(colorOf(this.pal(), 'textSecondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      if (this.view.kind === KIND_BADGE) {
        // web `BadgeWidget`：圆角胶囊 + 语义色文字 + 可选脉冲点（此处**静态**：无常驻动效纪律）
        Row({ space: SPACE_HAIR }) {
          Row()
            .width(DOT).height(DOT)
            .backgroundColor(widgetRoleColorOf(this.pal(), toneColorRole(this.view.tone)))
            .borderRadius(DOT / 2)
          Text(this.view.badgeText)
            .fontSize(fs('type.micro'))
            .fontWeight(fw('type.micro'))
            .lineHeight(lh('type.micro'))
            .fontColor(widgetRoleColorOf(this.pal(), toneColorRole(this.view.tone)))
            // ⛔ **水平溢出**（2026-10-11 用户亲报"字超出屏幕"）：徽标文本由**插件**提供（任意长）
            //    ⇒ 必须有宽上限，否则把所在 Row **顶出屏宽**。chip 档 = `PILL_MAX_W`。
            .constraintSize({ maxWidth: PILL_MAX_W })
        }
        .padding({ left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip'))
        .borderRadius(RADIUS_CHIP)
      .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
      } else if (this.view.kind === KIND_PROGRESS) {
        // web `ProgressWidget`：label + 条 + 百分比
        if (this.view.progressLabel.length > 0) {
          Text(this.view.progressLabel)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(colorOf(this.pal(), 'textSecondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width(`${widgetPercent(this.view.progressValue, this.view.progressMax)}%`)
            .height(BAR_H)
            .backgroundColor(colorOf(this.pal(), 'accentSoft'))
            .borderRadius(BAR_H / 2)
        }
        .width('100%').height(BAR_H)
        .backgroundColor(wellOf(this.pal()))
        .borderRadius(BAR_H / 2)
        if (this.view.showValue) {
          Text(`${Math.round(widgetPercent(this.view.progressValue, this.view.progressMax))}%`)
            .fontSize(fs('type.micro'))
            .fontWeight(fw('type.micro'))
            .lineHeight(lh('type.micro'))
            .fontColor(colorOf(this.pal(), 'textMuted'))
            .width('100%')
            .textAlign(TextAlign.End)
        }
      } else if (this.view.kind === KIND_METRIC) {
        // web `MetricWidget`：label + 大值 + delta
        Row({ space: SPACE_XS }) {
          Text(this.view.metricValue)
            .fontSize(fs('type.headline'))
            .fontWeight(fw('type.headline'))
            .lineHeight(lh('type.headline'))
            .fontColor(colorOf(this.pal(), 'textPrimary'))
          if (this.view.metricDelta.length > 0) {
            Text(this.view.metricDelta)
              .fontSize(fs('type.micro'))
              .fontWeight(fw('type.micro'))
              .lineHeight(lh('type.micro'))
              .fontColor(widgetRoleColorOf(this.pal(), widgetDeltaRole(this.view.metricDelta)))
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Bottom)
        if (this.view.metricLabel.length > 0) {
          Text(this.view.metricLabel)
            .fontSize(fs('type.micro'))
            .fontWeight(fw('type.micro'))
            .lineHeight(lh('type.micro'))
            .fontColor(colorOf(this.pal(), 'textMuted'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
      } else if (this.view.kind === KIND_LIST) {
        // web `ListWidget`：title + key:value 行
        if (this.view.listTitle.length > 0) {
          Text(this.view.listTitle)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(colorOf(this.pal(), 'textSecondary'))
            .width('100%')
            .textAlign(TextAlign.Start)
        }
        ForEach(this.view.listItems, (it: WidgetItemView, i: number) => {
          Row() {
            Text(it.key)
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), 'textSecondary'))
              .layoutWeight(1)
              .textAlign(TextAlign.Start)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(it.value)
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(widgetRoleColorOf(this.pal(), toneColorRole(it.tone)))
              .flexShrink(0)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }, (it: WidgetItemView, i: number) => `${i}#${it.key}`)
      } else if (this.view.kind === KIND_MARKDOWN) {
        // web `MarkdownWidget`：逐行渲染为段落（此处直接读 `markdownText`，行由 '\n' 分）
        Text(this.view.markdownText)
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(colorOf(this.pal(), 'textPrimary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      } else {
        // 降级（未知 / web 有但原生未实现 / code-src 沙箱）——**可见占位 + reason**，绝不静默。
        // ⛔ 配色纪律：文字一律**文字角色**（`textSecondary`）；"警告"语义由**非文字**的琥珀圆点承担
        //    （`pal().warn` 是"警告文字"角色、已登记且 5 套主题全 ≥3:1）——绝不再拿 `statusWaiting`
        //    （状态标记/点色，浅底仅 1.7–2.1:1）当正文色。
        Row({ space: SPACE_HAIR }) {
          Row()
            .width(DOT).height(DOT)
            .backgroundColor(widgetRoleColorOf(this.pal(), 'warn'))
            .borderRadius(DOT / 2)
            .flexShrink(0)
          Text(WIDGET_UNSUPPORTED_LABEL)
            .fontSize(fs('type.micro'))
            .fontWeight(fw('type.micro'))
            .lineHeight(lh('type.micro'))
            .fontColor(colorOf(this.pal(), 'textSecondary'))
            .flexShrink(0)
          Text(widgetDegradeDetail(this.view.kind, this.view.reason))
            .fontSize(fs('type.micro'))
            .fontWeight(fw('type.micro'))
            .lineHeight(lh('type.micro'))
            .fontColor(colorOf(this.pal(), 'textMuted'))
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

  build() {
    Column() {
      this.CardBody()
    }
    .width('100%')
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip'))
    .borderRadius(RADIUS_PILL)
  .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
  }
}

/**
 * 插件 widget 面板（zones + 声明式组件）。
 *
 * ⚠️ 本组件**只负责自身渲染与降级表达**；把哪一次的 widget 载荷、放在页面何处由宿主注入
 *    （接线说明见交付；`pages/Index.ets` 归 `sidebar-ux`）。
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
                .fontSize(fs('type.micro'))
                .fontWeight(fw('type.micro'))
                .lineHeight(lh('type.micro'))
                .fontColor(colorOf(this.pal(), 'dangerText'))
                .flexShrink(0)
              Text(this.view.reason)
                .fontSize(fs('type.micro'))
                .fontWeight(fw('type.micro'))
                .lineHeight(lh('type.micro'))
                .fontColor(colorOf(this.pal(), 'textMuted'))
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
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
      .borderRadius(RADIUS_CARD)
      // **面→面**轮廓 = `structuralRuleOf`（浅色 `borderStrong`，比面内强一档）；**面内**行分隔才是
      // `hairlineOf` —— 分工见 `docs/DESIGN-SYSTEM.md §13`（`SettingsRows` 的卡片为同一先例）。
      .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    }
  }
}
