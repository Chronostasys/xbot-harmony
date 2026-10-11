/**
 * 工具 pill —— **live 块与 committed 块共用的唯一视觉**（对齐 web `FoldedToolGroup.toolPill`）。
 *
 * ⛔ 必须是 **@Component + @Prop**，**不能**用带参全局 `@Builder`：
 *   带参 `@Builder` 的参数是"调用那一刻的快照"，其子树**不随参数变化重建**
 *   （`docs/ARKTS-GOTCHAS.md §4`）。用它承载"每帧都在变的状态"时症状是：
 *   **状态永远停在第一帧**（真机实测：批量工具刚创建时服务端全是 `pending` ⇒ 所有 pill
 *   永远显示「排队」，done/executing 都不更新 —— 用户 2026-10-10「tool done 和 tool
 *   executing 没区别」的真正根因）。
 *
 * 分工（本波收敛）：
 *   · **判据**（raw status ⇒ 语义档）在 `core/toolstatus.ets`（唯一，纯函数）；
 *   · **视觉映射**（语义档 ⇒ 颜色/底色/柔影）在 `core/toolvisual.ets`（纯函数，**可脱机单测**）；
 *   · 本文件**只管画** —— 不再自持任何颜色映射（此前 `statusColorOf/pillTextColorOf/
 *     liveShadowColorOf` 三个私有实现散在这里，无法单测）。
 *
 * 状态一律以后端为准（`pending` 就是排队，不许私自改判）。
 *
 * 布局用 `Flex(NoWrap)` + `flexShrink`（与 web `inline-flex` 同构）：名称可收缩、状态标记与
 * chip 不可收缩 ⇒ 「执行中」chip 永不被长参数挤掉。
 *
 * ⛔ 本文件**不新增任何动效**：同一时刻只允许一个在飞动效（= 光球，`docs/DESIGN-SYSTEM.md §8`）；
 *    pill 的"在飞"只用**静态**语言（状态色 + 柔影；扫光由调用方提供）。
 *    排队态的符号缩放呼吸是批次22 已定稿的**纯附加**，本波不动（要动先问）。
 */
import { R_LG, R_SM, FS_CAPTION, SP_1, SP_2 } from '../core/tokens';
import { ST_DONE } from '../core/toolstatus';
import {
  PILL_MARKER_SLOT, PILL_LIVE_GLOW_RADIUS,
  SHAPE_CHECK, SHAPE_CROSS, SHAPE_MINUS, SHAPE_RING,
  chipBgOf, glowColorOf, markerShape, pillBgOf,
  pillTextColorOf as corePillTextColorOf, statusColorOf as coreStatusColorOf,
} from '../core/toolvisual';

/**
 * 状态 → 语义色 —— **兼容旧导入点**（`components/MessageRow.ets` / `components/ToolPopover.ets`
 * 从本文件取 `statusColorOf`）。实现已迁到 `core/toolvisual.ets`（可单测），此处只转发。
 */
export function statusColorOf(kind: string, theme: string): string {
  return coreStatusColorOf(kind, theme);
}

/** pill 文本色（转发 `core/toolvisual`；保留导出以免破坏既有导入点）。 */
export function pillTextColorOf(kind: string, theme: string): string {
  return corePillTextColorOf(kind, theme);
}

@Component
export struct ToolPill {
  /** 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  @Prop label: string = '';
  /** 语义状态档：done / error / running / pending / killed（**由后端 status 判定**）。 */
  @Prop kind: string = ST_DONE;
  /** 状态 chip 文案（空 = 不渲染 —— 成功态安静）。 */
  @Prop chip: string = '';
  /** 是否"在飞"（运行/生成中）—— 决定扫光/柔影（**由调用方用 `isInFlight` 判好**）。 */
  @Prop live: boolean = false;
  /** 是否是当前打开浮层的那一枚（提亮一档）。 */
  @Prop selected: boolean = false;
  @Prop theme: string = 'dark';

  build() {
    Flex({ direction: FlexDirection.Row, alignItems: ItemAlign.Center }) {
      // ── 状态标记：**恒定 14px 槽、不可收缩** ────────────────────────────────
      // 恒定槽宽是"所有 pill 的图标/名字左对齐"的前提（web 实测要求）。
      Stack() {
        if (markerShape(this.kind) === SHAPE_CHECK) {
          // 成功：**描边绿勾**（安静，不喧哗）
          SymbolGlyph($r('sys.symbol.checkmark_circle'))
            .fontSize(13).fontColor([coreStatusColorOf(this.kind, this.theme)])
        } else if (markerShape(this.kind) === SHAPE_CROSS) {
          SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
            .fontSize(13).fontColor([coreStatusColorOf(this.kind, this.theme)])
        } else if (markerShape(this.kind) === SHAPE_MINUS) {
          SymbolGlyph($r('sys.symbol.minus_circle'))
            .fontSize(13).fontColor([coreStatusColorOf(this.kind, this.theme)])
        } else if (markerShape(this.kind) === SHAPE_RING) {
          // 排队态：静态虚线圆 → 加一记**符号缩放呼吸**（Apple 式）。**纯附加**（原先无动效），
          // 不触碰"执行中/生成中"的 `LoadingProgress`（真机已定稿：执行中必须是**会动的原生
          // 指示器**，静态字符被用户明确否掉 ⇒ 不拿可能静默的符号动效去替换它）。
          // ⚠️ 本波不动（批次22 定稿；要动先问）。
          SymbolGlyph($r('sys.symbol.circle_dashed'))
            .fontSize(12).fontColor([coreStatusColorOf(this.kind, this.theme)])
            .symbolEffect(new ScaleSymbolEffect(EffectScope.WHOLE, EffectDirection.UP), true)
        } else {
          // 运行/生成中（SHAPE_SPINNER）：**会动的**原生指示器（静态字符是 TUI 观感，用户明确否掉）
          LoadingProgress().width(13).height(13).color(coreStatusColorOf(this.kind, this.theme))
        }
      }
      .width(PILL_MARKER_SLOT).height(PILL_MARKER_SLOT)
      .flexShrink(0)

      Text(this.label)
        .fontSize(FS_CAPTION)
        .fontColor(corePillTextColorOf(this.kind, this.theme))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ left: SP_1 })
        // 名称**可收缩**（长参数截断出省略号），状态标记/chip 不可收缩 ⇒ chip 永不被挤掉
        .flexShrink(1)

      if (this.chip.length > 0) {
        Text(this.chip)
          .fontSize(10)
          .fontColor(coreStatusColorOf(this.kind, this.theme))
          // ⛔ chip 底色**恒 ≠ pill 底色**（否则选中 pill 上 chip"消失"）—— 见 `core/toolvisual.chipBgOf`
          .backgroundColor(chipBgOf(this.kind, this.selected, this.theme))
          .padding({ left: SP_1, right: SP_1, top: 1, bottom: 1 })
          .borderRadius(R_SM)
          .margin({ left: SP_1 })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .flexShrink(0)
      }
    }
    .padding({ left: SP_2, right: SP_2, top: 5, bottom: 5 })
    .backgroundColor(pillBgOf(this.kind, this.selected, this.theme))
    .borderRadius(R_LG)
    .clip(true)
    .shadow({
      radius: this.live ? PILL_LIVE_GLOW_RADIUS : 0,
      color: glowColorOf(this.kind, this.live, this.theme),
      offsetX: 0, offsetY: 0,
    })
  }
}
