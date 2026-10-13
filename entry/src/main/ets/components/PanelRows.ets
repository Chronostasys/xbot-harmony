/**
 * PanelRows —— 运行面板（任务管理）的**结构化行卡**（真实 @Component + @Prop）。
 *
 * ── 为什么是独立组件（而不是页面里的 `@Builder`）────────────────────────────────
 * ① 用户点名「终端和任务管理做的很差」：四类列表此前都是**单行纯文本**（页面 `@Builder` 里
 *    直接 `Text(bgTaskLine(...))`）—— 状态与元信息被长命令挤掉（真机实测：62 条后台任务全
 *    渲染成「完成 <长命令…>」，时长/id 被 `maxLines` 截掉）。改「主行 + 副行」必须**随数据更新**
 *    ⇒ ⛔ 不能用带参 `@Builder`（参数是调用那刻的快照 ⇒ 列表卡首帧，见 ARKTS-GOTCHAS），
 *    必须是真 `@Component` + `@Prop`。
 * ② 取色用 `paletteOf(this.theme)`（组件自带 theme）⇒ **不占页面性能预算**
 *    （`tools/perf/guard.sh` 只数 `this.pal()` / `this.palOnce()` 的**字面次数**，页面侧因此净减）。
 *
 * ── 形态（对齐 web `web/src/components/sidebar/TasksPanel.tsx`，⛔ 不是一比一复刻像素）──
 * 行卡 = `主行（标识）` + `副行（状态 · 元信息，按 tone 上色）` +（可选）尾部动作。
 * 主行**单行截断**（长命令不再挤掉后面的元信息 —— 元信息已独立成副行）。
 * ⛔ tone ⇒ 调色板 role 的映射**只在本文件**（`core/panels.ets` 只产 tone 字符串、不 import 主题）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, structuralRuleOf, surfaceFillOf,
  HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY, RADIUS_CARD,
  SPACE_HAIR, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD,
} from '../core/design';
import { fs, fw, lh } from './SettingsRows';
import { TONE_ERROR, TONE_MUTED, TONE_SUCCESS } from '../core/panels';

/**
 * 尾部动作码 —— ⛔ 用**码**（字符串）而不是 `Resource`：`@Prop` 传 `Resource` 在 ArkTS 上要
 * 额外处理，而尾部动作只有这几种；组件内查表 → `$r('sys.symbol.*')`（唯一映射点）。
 */
export const ROW_TRAIL_NONE: string = 'none';
/** 可点进详情（后台任务 / 终端）。 */
export const ROW_TRAIL_CHEVRON: string = 'chevron';
/** 删除（定时任务）。 */
export const ROW_TRAIL_DELETE: string = 'delete';
/** 关闭（终端）。 */
export const ROW_TRAIL_CLOSE: string = 'close';

@Component
export struct PanelRowCard {
  @Prop theme: string = 'dark';
  /** 主行（标识）——单行截断。 */
  @Prop primary: string = '';
  /** 副行（状态 · 元信息）——空串则不渲染该行。 */
  @Prop secondary: string = '';
  /** 语义 tone（`core/panels.ets` 的 `TONE_*`）——决定副行颜色。 */
  @Prop tone: string = 'muted';
  /** 尾部动作码（`ROW_TRAIL_*`）。 */
  @Prop trailing: string = 'none';
  /** 整卡是否可点（false ⇒ 不挂动作、不显示按压反馈 —— 如 Runner 行纯信息）。 */
  @Prop tappable: boolean = true;
  /** 整卡点击（行主体）。 */
  onTap: () => void = () => {
  };
  /** 尾部动作点击。 */
  onTrailing: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** tone ⇒ 副行颜色（**唯一映射点**）。 */
  private toneColor(): string {
    if (this.tone === TONE_SUCCESS) {
      return this.pal().successText;
    }
    if (this.tone === TONE_ERROR) {
      return this.pal().dangerText;
    }
    return this.pal().textMuted;
  }

  build() {
    Row({ space: SPACE_XS }) {
      Column({ space: SPACE_HAIR }) {
        Text(this.primary)
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.secondary.length > 0) {
          Text(this.secondary)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(this.toneColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.trailing === ROW_TRAIL_CHEVRON) {
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(fs('type.micro'))
          .fontColor([colorOf(this.pal(), 'iconMuted')])
      } else if (this.trailing === ROW_TRAIL_DELETE || this.trailing === ROW_TRAIL_CLOSE) {
        // ⛔ 热区**不靠** `responseRegion` 负偏移外扩（真机实测 SDK21 无效，见 AGENTS.md GOTCHAS）
        //    ⇒ 图标放进真实 `HIT_TARGET_MIN` 布局盒、盒内居中（图标视觉尺寸不变）。
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(fs('type.caption'))
            .fontColor([this.pal().dangerText])
        }
        .width(HIT_TARGET_MIN)
        .height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        // ⛔ 嵌套可点元素**必须自带** press（`interactive_feedback` ⑦ 口径；与 `QueueSheet` 行内移除同款）
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(this.trailing === ROW_TRAIL_DELETE ? '删除' : '关闭')
        .onClick(() => {
          this.onTrailing();
        })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({
      left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
    })
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
    // S2（形状语言 12/8 两级，与侧栏 `785a3fa` 同一口径）：**容器** = `RADIUS_CARD`（12）。
    .borderRadius(RADIUS_CARD)
    // L2 内嵌卡「面到面轮廓」= `structuralRuleOf`（门禁 ③ 硬红：L2 卡不许走 L1 的 `hairlineOf`）
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    // 不可点（纯信息行）⇒ `.enabled(false)`（ArkUI 同时禁掉点击与按压反馈；
    // ⛔ 别用 `tappable ? PRESS_OPACITY : 1` 的条件按压 —— 破坏 `interactive_feedback` 的
    //    "按压值必须取自 PRESS_OPACITY"口径，且守卫式 onClick 必须配 `.enabled(flag)`）
    .enabled(this.tappable)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      if (this.tappable) {
        this.onTap();
      }
    })
  }
}
