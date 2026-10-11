import { Palette, paletteOf } from '../core/theme';
import {
  PluginCatalogGroup,
  PluginCatalogItem,
  PluginViewItem,
  normalizePluginIcon,
} from '../core/pluginhost';
import {
  PluginBadge,
  pluginCatalogEmptyNotice,
  pluginCatalogFootnote,
  pluginCatalogHint,
  pluginCatalogSummaryText,
  pluginViewBadge,
  pluginStateBadge,
  pluginViewCountText,
} from '../core/pluginview';
import {
  colorOf, hairlineOf, structuralRuleOf, surfaceFillOf,
  GAP_ROW_Y, GAP_SECTION, GUTTER_SCREEN, HIT_TARGET_MIN, INSET_CARD_X, INSET_CARD_Y,
  INSET_CHIP_X, INSET_CHIP_Y, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY, RADIUS_CARD, RADIUS_CHIP,
  RADIUS_PILL, SPACE_HAIR, SPACE_LG, SPACE_XS, STROKE_HAIRLINE, insetHairlineOf } from '../core/design';
import { fs, fw, lh, SettingsGroupHeader, tc } from './SettingsRows';
import { WIDGET_EVENT_WEB } from '../core/widgetsview';
import { PluginWidgets } from './PluginWidgets';
import { WebSurface } from './WebSurface';

/**
 * PluginHost —— **插件目录 + 宿主页承载**（可注入组件）。
 *
 * ── 它解决什么 ───────────────────────────────────────────────────────────────
 * 波1b 之前，"打开插件"= 打开一个裸 ESM 地址（面板显示 JS 源码）；波1b 修成语义正确的
 * **权威宿主页**，但用户在宿主页里仍得**自己找**插件。本组件把服务端下发的
 * `web.contributes`（视图贡献点）渲染成**原生目录**：有哪些插件、各自能开什么视图、
 * 视图落在宿主 UI 的哪个位置（容器分组），点一下即打开宿主页。
 *
 * ── 为什么目录是原生的、插件 UI 仍是宿主页 ───────────────────────────────────
 * 插件产物是**同页 ESM 模块**，顶层就读宿主注入的 `window.React` / `window.__xbot_*`
 * （证据见 `core/pluginhost.ets` 文件头）⇒ 只有 web 应用本体（权威宿主页）能跑它们。
 * 原生能且**只该**做的是"目录 + 承载"：目录信息完全来自 `web_plugin_list` 的元数据。
 *
 * ── 视觉重排（2026-10-11，`docs/REDESIGN.md`：层级/密度/发丝/命中区）───────────
 *   · 与 `components/SettingsPanel.ets` / `SettingsRows.ets` **同一套语言**：直接复用其
 *     `fs/fw/lh/tc`（排版角色 → ArkUI 属性）与 `SettingsGroupHeader`（`type.caption` + 发丝）；
 *   · 层级靠**字号/字重/灰阶/留白**（名字 `type.subhead`、说明 `type.callout`、元信息
 *     `type.caption`/`type.micro`），不再靠"到处描边 + 圆角 10 + 内距 12 手写"；
 *   · 卡片面 = `surfaceFillOf('surface.card')` + **结构性发丝** `hairlineOf` + `RADIUS_CARD`；
 *     徽标 = `surface.chip`（内嵌凹槽）+ `RADIUS_CHIP`；
 *   · 行命中区 ≥ `HIT_TARGET_MIN`（44）；按压走全站唯一 `PRESS_OPACITY`；
 *   · 颜色**一律**经 `colorOf`（禁 `pal().xxx` 直取、禁 hex ⇒ 门禁 ⑥c）。
 *
 * ── 判据与渲染同源 ───────────────────────────────────────────────────────────
 * "state 徽标该不该显示 / dynamic 该不该标「按需」/ 计数与空态文案"全部在
 * `core/pluginview.ets`（纯逻辑，可脱机单测）；本组件**只画**（`docs/REDESIGN.md §11`）。
 *
 * ⚠️ 组件成员契约（ArkUI 硬约束）：
 *   · 会变的内容一律 `@Prop`（`items`/`groups`/`theme`/`panelUrl`）—— 父组件赋新数组即重建列表；
 *   · **回调用普通成员**（`onOpen`/`onClose`）：ArkTS 的 `@Prop/@State` 承载函数类型不可靠
 *     （装饰器做值拷贝/观测，函数不是可观测数据），与 `WebSurface.ets:99` 的处理一致；
 *   · 行/卡是**真 `@Component` + `@Prop`**（`PluginCardRow`/`PluginViewRow`/`PluginBadgeChip`），
 *     ⛔ 不用带参 `@Builder`（参数是"调用那刻的快照" ⇒ 列表卡在首帧，见 `docs/ARKTS-GOTCHAS.md`）。
 */
@Component
export struct PluginHost {
  /** 插件条目（`store.loadPluginCatalog()` 产出；`@Prop` 承载整表 ⇒ 变化即重建）。 */
  @Prop items: PluginCatalogItem[] = [];
  /** 按容器聚合的视图分组（目录的"分区"）。 */
  @Prop groups: PluginCatalogGroup[] = [];
  @Prop theme: string = 'dark';
  /** 要承载的宿主页 URL（空 ⇒ 只显示目录）。 */
  @Prop panelUrl: string = '';
  /**
   * 本会话的插件 widget 载荷（`web_widgets` / `plugin_widgets` 的原始 JSON；空 = 未收到）。
   *
   * 为什么由**本组件**承载：`PluginWidgets`（插件 widget 渲染层）此前是**孤儿组件**
   * （`tools/lint/orphan-components.sh` 的唯一命中）⇒ 它不进 ArkTS 依赖图、其 ArkTS 错误
   * **编译期不报**（`docs/ARKTS-GOTCHAS.md` 批次13 的"假绿"）。本组件是"插件面"的**唯一注入点**，
   * 由它真实实例化 `PluginWidgets` ⇒ 该组件恢复**真编译覆盖**（与 `SettingsPanel` 消设置面板孤儿同理）。
   * ⚠️ 载荷来源（store 的 SSE 捕获）见交付的接线补丁；未接线时**恒为空** ⇒ 本段**零节点**（不产空壳）。
   */
  @Prop widgetContent: string = '';
  /** widget 事件名（`web_widgets` / `plugin_widgets`）。 */
  @Prop widgetEvent: string = WIDGET_EVENT_WEB;

  /** 点"打开"：把目标 URL 交给上层（上层写进 `panelUrl` 或自行导航）。 */
  onOpen: (url: string) => void = () => {
  };
  /** 关闭宿主页（WebSurface 的"‹ 返回"）。 */
  onClose: () => void = () => {
  };

  build() {
    Column() {
      if (this.panelUrl.length > 0) {
        // ── 承载宿主页：插件 UI 在这里按 web 语义运行（原生不再干预其内部）────────
        WebSurface({
          url: this.panelUrl,
          theme: this.theme,
          onClose: () => {
            this.onClose();
          },
        })
      } else {
        // ── 原生目录（数据全部来自 web_plugin_list 元数据，零猜测）────────────────
        Scroll() {
          Column({ space: GAP_SECTION }) {
            // 概览行：层级标题 + 中性提示
            Row() {
              Text(pluginCatalogSummaryText(this.items.length))
                .fontSize(fs('type.subhead'))
                .fontWeight(fw('type.subhead'))
                .lineHeight(lh('type.subhead'))
                .fontColor(tc(this.pal(), 'type.subhead'))
                .layoutWeight(1)
              Text(pluginCatalogHint())
                .fontSize(fs('type.caption'))
                .fontWeight(fw('type.caption'))
                .lineHeight(lh('type.caption'))
                .fontColor(colorOf(this.pal(), 'textMuted'))
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)

            // 空态：一行小字（无填充/无边框/无发光，同 `docs/DESIGN-SYSTEM.md §10` 语言）
            if (this.items.length === 0) {
              Text(pluginCatalogEmptyNotice())
                .fontSize(fs('type.callout'))
                .fontWeight(fw('type.callout'))
                .lineHeight(lh('type.callout'))
                .fontColor(colorOf(this.pal(), 'textMuted'))
                .width('100%')
                .padding({
                  left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
                })
            }

            // ── 插件列表（卡片）────────────────────────────────────────────────
            if (this.items.length > 0) {
              Column({ space: GAP_ROW_Y }) {
                ForEach(this.items, (p: PluginCatalogItem) => {
                  PluginCardRow({
                    item: p,
                    theme: this.theme,
                    onOpen: (url: string) => {
                      this.onOpen(url);
                    },
                  })
                }, (p: PluginCatalogItem) => `plugin#${p.id}#${p.url}`)
              }
              .width('100%')
            }

            // ── 视图分组（按容器：侧栏 / 信息栏 / 状态栏…，与 web 布局位对应）──────
            ForEach(this.groups, (g: PluginCatalogGroup) => {
              Column({ space: GAP_ROW_Y }) {
                SettingsGroupHeader({ title: g.label, theme: this.theme })
                ForEach(g.views, (v: PluginViewItem) => {
                  PluginViewRow({
                    view: v,
                    theme: this.theme,
                    onOpen: (url: string) => {
                      this.onOpen(url);
                    },
                  })
                }, (v: PluginViewItem) => `view#${v.id}`)
              }
              .width('100%')
            }, (g: PluginCatalogGroup) => `group#${g.container}`)

            // ── 本会话插件 widget（`PluginWidgets` —— 消孤儿的**真实消费者**）────────
            // ⚠️ 载荷未接时 `widgetContent` 恒空 ⇒ `PluginWidgets` 自身判 `visible=false` ⇒ **零节点**。
            //    这里再判一次 `length > 0` 只是为了连分区标题一起省掉（不产"空标题 + 空体"）。
            if (this.widgetContent.length > 0) {
              Column({ space: GAP_ROW_Y }) {
                SettingsGroupHeader({ title: '本会话插件 widget', theme: this.theme })
                PluginWidgets({
                  content: this.widgetContent,
                  event: this.widgetEvent,
                  theme: this.theme,
                })
              }
              .width('100%')
            }

            // 脚注：为什么点开后是宿主页 —— 诚实告知用户与实现者
            Text(pluginCatalogFootnote())
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(colorOf(this.pal(), 'textMuted'))
              .width('100%')
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({
            left: GUTTER_SCREEN, right: GUTTER_SCREEN, top: SPACE_XS, bottom: SPACE_LG,
          })
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }
}

/**
 * 一枚小徽标（`surface.chip` 内嵌凹槽 + `type.micro`）。
 * 语义色角色由调用方经 `core/pluginview.ets` 判据给出（本组件不自己判色）。
 */
@Component
struct PluginBadgeChip {
  @Prop text: string = '';
  @Prop role: string = 'textSecondary';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Text(this.text)
      .fontSize(fs('type.micro'))
      .fontWeight(fw('type.micro'))
      .lineHeight(lh('type.micro'))
      .fontColor(colorOf(this.pal(), this.role))
      .padding({
        left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y,
      })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.chip'))
      .borderRadius(RADIUS_CHIP)
  .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
  }
}

/** "打开"动作的视觉片（整卡可点 ⇒ 这里只是**可点性提示**，不再独立挂热区）。 */
@Component
struct PluginOpenAffordance {
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Text('打开')
      .fontSize(fs('type.caption'))
      .fontWeight(fw('type.caption'))
      .lineHeight(lh('type.caption'))
      .fontColor(colorOf(this.pal(), 'accentSoft'))
      .padding({
        left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
      })
      .borderRadius(RADIUS_PILL)
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
  }
}

/** 一张插件卡（图标 / 名称 / 版本 / 状态徽标 / 说明 / 视图数 / 模块 URL / 打开）。 */
@Component
struct PluginCardRow {
  @Prop item: PluginCatalogItem = new PluginCatalogItem();
  @Prop theme: string = 'dark';
  onOpen: (url: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 状态徽标判据（`core/pluginview.ets`；本组件不自己判）。 */
  private badge(): PluginBadge {
    return pluginStateBadge(this.item.state);
  }

  build() {
    Row({ space: SPACE_XS }) {
      SymbolGlyph(pluginSymbol(this.item.icon))
        .fontSize(18)
        .fontColor([colorOf(this.pal(), 'accentSoft')])

      Column({ space: SPACE_HAIR }) {
        Row({ space: SPACE_XS }) {
          Text(this.item.name)
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontColor(tc(this.pal(), 'type.subhead'))
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.item.version.length > 0) {
            Text(`v${this.item.version}`)
              .fontSize(fs('type.micro'))
              .fontWeight(fw('type.micro'))
              .lineHeight(lh('type.micro'))
              .fontColor(colorOf(this.pal(), 'textMuted'))
          }
          if (this.badge().show) {
            PluginBadgeChip({
              text: this.badge().text,
              role: this.badge().colorRole,
              theme: this.theme,
            })
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        if (this.item.description.length > 0) {
          Text(this.item.description)
            .fontSize(fs('type.callout'))
            .fontWeight(fw('type.callout'))
            .lineHeight(lh('type.callout'))
            .fontColor(tc(this.pal(), 'type.callout'))
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }

        Row({ space: SPACE_XS }) {
          Text(pluginViewCountText(this.item.views.length))
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(colorOf(this.pal(), 'textMuted'))
            .flexShrink(0)
          Text(this.item.moduleUrl)
            .fontSize(fs('type.micro'))
            .fontFamily('monospace')
            .fontColor(colorOf(this.pal(), 'textMuted'))
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          PluginOpenAffordance({ theme: this.theme })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({
      left: INSET_CARD_X, right: INSET_CARD_X, top: INSET_CARD_Y, bottom: INSET_CARD_Y,
    })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onOpen(this.item.url);
    })
  }
}

/** 一行视图（图标 / 标题 / 所属插件 / 「按需」徽标 / 打开）。 */
@Component
struct PluginViewRow {
  @Prop view: PluginViewItem = new PluginViewItem();
  @Prop theme: string = 'dark';
  onOpen: (url: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private badge(): PluginBadge {
    return pluginViewBadge(this.view.dynamic);
  }

  build() {
    Row({ space: SPACE_XS }) {
      SymbolGlyph(pluginSymbol(this.view.icon))
        .fontSize(16)
        .fontColor([colorOf(this.pal(), 'accentSoft')])

      Column({ space: SPACE_HAIR }) {
        Text(this.view.title)
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.view.pluginName)
          .fontSize(fs('type.micro'))
          .fontWeight(fw('type.micro'))
          .lineHeight(lh('type.micro'))
          .fontColor(colorOf(this.pal(), 'textMuted'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.badge().show) {
        PluginBadgeChip({ text: this.badge().text, role: this.badge().colorRole, theme: this.theme })
      }
      PluginOpenAffordance({ theme: this.theme })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({
      left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
    })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      // 直开（同源页面 URL）与"进宿主页"在 core 侧已判好，这里只执行
      this.onOpen(this.view.openUrl);
    })
  }
}

/**
 * 插件图标名 → `sys.symbol.*`（**文件级函数**：两张卡与目录共用同一张表，避免写两遍）。
 *
 * 名字来源：`view.icon` 声明的 **lucide 名**（web `plugin-runtime/pluginIcons.ts:30-56` 的
 * `ICON_MAP`）—— 先归一化（`normalizePluginIcon`：trim+小写，与 web `:63` 同规则），再查本表。
 * HarmonyOS `sys.symbol.*` 与 lucide **不是一一对应**，故只覆盖语义接近的，其余一律回落通用方块
 * （`square_grid_2x2`，对应 web 的 `Puzzle` 降级）。符号名必须是**字面量**（ArkTS 不允许
 * `$r('sys.symbol.' + x)` 拼装）。
 *
 * 覆盖 vs web `ICON_MAP` 19 键：已映射 14 键；`search`/`info`/`blocks`/`boxes`/`puzzle`
 * 无**已验证**的 `sys.symbol` 名可用（不猜名 —— 猜错会渲染空白）⇒ 回落通用方块。
 */
function pluginSymbol(icon: string): Resource {
  const k: string = normalizePluginIcon(icon);
  if (k === 'server' || k === 'server-cog') {
    return $r('sys.symbol.rectangle_on_rectangle');
  }
  if (k === 'git-branch' || k === 'git' || k === 'git-commit-horizontal') {
    return $r('sys.symbol.circle_dashed');
  }
  if (k === 'chart' || k === 'activity' || k === 'sparkline') {
    return $r('sys.symbol.line_3_horizontal');
  }
  if (k === 'tasks' || k === 'files' || k === 'code' || k === 'terminal') {
    return $r('sys.symbol.doc_text');
  }
  if (k === 'message') {
    return $r('sys.symbol.list_bullet');
  }
  if (k === 'sparkles') {
    return $r('sys.symbol.lightbulb');
  }
  if (k === 'wrench') {
    return $r('sys.symbol.gearshape');
  }
  return $r('sys.symbol.square_grid_2x2');
}
