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
 * 状态语义（判定/文案）在 `core/toolstatus.ets`（纯函数，可脱机单测）；本文件只管画。
 * **状态一律以后端为准**（有些工具并行、有些串行 ⇒ `pending` 就是真的排队，不许私自改判）。
 *
 * 布局用 `Flex(NoWrap)` + `flexShrink`（与 web `inline-flex` 同构）：名称可收缩、状态标记与
 * chip 不可收缩 ⇒ 「执行中」chip 永不被长参数挤掉。
 */
import { effectsOf, paletteOf, Palette, isLightPalette } from '../core/theme';
import { FS_CAPTION, R_LG, R_SM, SP_1, SP_2 } from '../core/tokens';
import { ST_DONE, ST_ERROR, ST_KILLED, ST_PENDING } from '../core/toolstatus';

/** 在飞 pill 的柔影半径（vp）—— 浅色系用它把"在飞"读作悬浮卡片而非发光体。 */
const LIVE_SHADOW_RADIUS: number = 12;

/** 状态 → 语义色（**一处定义，两端一致**）。 */
export function statusColorOf(kind: string, theme: string): string {
  const p: Palette = paletteOf(theme);
  if (kind === ST_ERROR) { return p.dangerText; }
  if (kind === ST_DONE) { return p.successText; }
  if (kind === ST_KILLED) { return p.textMuted; }
  return p.accentSoft;   // running / generating
}

/** pill 文本色：失败=红（吵闹，是它的语义）；其余=中性前景（成功要安静）。 */
export function pillTextColorOf(kind: string, theme: string): string {
  return kind === ST_ERROR ? paletteOf(theme).dangerText : paletteOf(theme).textPrimary;
}

/**
 * 在飞 pill 的阴影色（**唯一的主题分叉点**）。
 *
 * 为什么不一律用 `eff().glow`：`glow` = accent@45% 的**彩色外发光** —— 在深色底上它是
 * "在飞"的高级感来源；但在**白色主题**（`porcelain` / `light`）上，45% 饱和色晕压在白卡
 * 边上会读成"脏"，正是用户要的"干净"的反面。
 * `effectsOf` 的**浅色分支**已经备好中性柔影档（`elev1/2/3` = 正文色相 @6/10/16%），
 * 这里直接复用（不在组件里自造色值 —— `core/theme.ets` 是本波禁改面）。
 *
 * ⚠️ 深色系（dark/aurora/nebula）走 `glow`，**逐字节不变**（其它线依赖其观感）。
 * 判据用 `isLightPalette`（按 `appBg` 感知亮度，对新增色板/强调色覆盖都成立 —— 见其注释），
 * 不用主题名硬判。
 */
function liveShadowColorOf(theme: string, live: boolean): string {
  const p: Palette = paletteOf(theme);
  if (!live) {
    return p.transparent;
  }
  return isLightPalette(p) ? effectsOf(p).elev2 : effectsOf(p).glow;
}

@Component
export struct ToolPill {
  /** 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  @Prop label: string = '';
  /** 语义状态档：done / error / running / pending / killed（**由后端 status 判定**）。 */
  @Prop kind: string = ST_DONE;
  /** 状态 chip 文案（空 = 不渲染 —— 成功态安静）。 */
  @Prop chip: string = '';
  /** 是否"在飞"（运行/生成中）—— 决定扫光/发光。 */
  @Prop live: boolean = false;
  /** 是否是当前打开浮层的那一枚（提亮一档）。 */
  @Prop selected: boolean = false;
  @Prop theme: string = 'dark';

  build() {
    Flex({ direction: FlexDirection.Row, alignItems: ItemAlign.Center }) {
      // ── 状态标记：**恒定 14px 槽、不可收缩** ────────────────────────────────
      // 恒定槽宽是"所有 pill 的图标/名字左对齐"的前提（web 实测要求）。
      Stack() {
        if (this.kind === ST_DONE) {
          // 成功：**描边绿勾**（安静，不喧哗）
          SymbolGlyph($r('sys.symbol.checkmark_circle'))
            .fontSize(13).fontColor([statusColorOf(this.kind, this.theme)])
        } else if (this.kind === ST_ERROR) {
          SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
            .fontSize(13).fontColor([statusColorOf(this.kind, this.theme)])
        } else if (this.kind === ST_KILLED) {
          SymbolGlyph($r('sys.symbol.minus_circle'))
            .fontSize(13).fontColor([statusColorOf(this.kind, this.theme)])
        } else if (this.kind === ST_PENDING) {
          // 排队态：静态虚线圆 → 加一记**符号缩放呼吸**（Apple 式）。**纯附加**（原先无动效），
          // 不触碰"执行中/生成中"的 `LoadingProgress`（真机已定稿：执行中必须是**会动的原生
          // 指示器**，静态字符被用户明确否掉 ⇒ 不拿可能静默的符号动效去替换它）。
          // 依据（d.ts）：`symbolEffect(symbolEffect, isActive?)` —— symbolglyph.d.ts:761；
          //   `ScaleSymbolEffect(scope?, direction?)` —— :324；枚举 `EffectScope`/`EffectDirection`
          //   —— :197/:163。
          // ⚠️ 待验证：真机是否**循环**呼吸（d.ts 只保证"激活缩放动效"；SDK 符号配置里该动效是
          //   一记 spring 弹跳）。若不循环 ⇒ 等价一次性弹入，无副作用、不影响正确性。
          SymbolGlyph($r('sys.symbol.circle_dashed'))
            .fontSize(12).fontColor([statusColorOf(this.kind, this.theme)])
            .symbolEffect(new ScaleSymbolEffect(EffectScope.WHOLE, EffectDirection.UP), true)
        } else {
          // 运行/生成中：**会动的**原生指示器（静态字符是 TUI 观感，用户明确否掉）
          LoadingProgress().width(13).height(13).color(statusColorOf(this.kind, this.theme))
        }
      }
      .width(14).height(14)
      .flexShrink(0)

      Text(this.label)
        .fontSize(FS_CAPTION)
        .fontColor(pillTextColorOf(this.kind, this.theme))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ left: SP_1 })
        // 名称**可收缩**（长参数截断出省略号），状态标记/chip 不可收缩 ⇒ chip 永不被挤掉
        .flexShrink(1)

      if (this.chip.length > 0) {
        Text(this.chip)
          .fontSize(10)
          .fontColor(statusColorOf(this.kind, this.theme))
          .padding({ left: SP_1, right: SP_1, top: 1, bottom: 1 })
          .backgroundColor(paletteOf(this.theme).surfaceHi)
          .borderRadius(R_SM)
          .margin({ left: SP_1 })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .flexShrink(0)
      }
    }
    .padding({ left: SP_2, right: SP_2, top: 5, bottom: 5 })
    .backgroundColor(this.selected ? paletteOf(this.theme).surfaceHi : paletteOf(this.theme).surfaceAlt)
    .borderRadius(R_LG)
    .clip(true)
    .shadow({
      radius: this.live ? LIVE_SHADOW_RADIUS : 0,
      color: liveShadowColorOf(this.theme, this.live),
      offsetX: 0, offsetY: 0,
    })
  }
}
