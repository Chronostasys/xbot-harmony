/**
 * LlmErrorNotice —— LLM 调用失败的**摘要行 + 可展开详情**（对齐 web 的 status-error 语义，
 * 形态收窄 —— 见 `core/llmerror.ets` 头注「web 权威」一节）。
 *
 * ⛔ **判据与渲染同源**：本文件不写任何失败判定/解析 —— 全走 `core/llmerror.ets`
 *   的 `parseLlmError` / `llmErrorReasonOf` / `llmErrorRepeatLabel`。颜色**零字面量**：
 *   `colorOf` / `wellOf`。
 *
 * 形态（用户真机取证：全屏错误墙 ⇒ 首屏 1 行）：
 *   · **默认折叠**：一行 —— `✕ 模型调用失败 · 连接被拒绝   [重复 5 次]  详情 ▾`；
 *   · 点开才显示**原文详情**（等宽、限高内滚，`#1..#5` 全在，绝不丢内容）。
 *
 * ⛔ 必须是 **@Component + @Prop + @State**（带参 @Builder 的子树不随参数重建，
 *   见 `docs/ARKTS-GOTCHAS.md §4`）—— 展开态与会变的内容都靠真状态驱动。
 */
import { LlmError, llmErrorRepeatLabel, parseLlmError } from '../core/llmerror';
import { Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, R_LG, R_MD, SP_1, SP_2 } from '../core/tokens';
import { PRESS_OPACITY, RADIUS_CHIP, SPACE_HAIR, TYPE_CHIP, colorOf, typeOf, wellOf } from '../core/design';

/** 展开后的详情框最大高度（vp）—— 限高内滚，绝不把屏幕撑满。 */
const DETAIL_MAX_H: number = 260;

@Component
export struct LlmErrorNotice {
  /** 助手正文原文（含失败详情）。 */
  @Prop text: string = '';
  @Prop theme: string = 'dark';
  @State open: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private err(): LlmError | null {
    return parseLlmError(this.text);
  }

  private title(): string {
    const e: LlmError | null = this.err();
    return e !== null ? e.title : '模型调用失败';
  }

  private repeat(): string {
    const e: LlmError | null = this.err();
    return e !== null ? llmErrorRepeatLabel(e.attemptCount) : '';
  }

  private raw(): string {
    const e: LlmError | null = this.err();
    return e !== null ? e.raw : this.text;
  }

  build() {
    Column({ space: SP_1 }) {
      // ── 摘要行（**恒定 1 行**）—— 整行可点，展开/收起详情 ────────────────────────
      Row({ space: SP_1 }) {
        SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
          .fontSize(typeOf(TYPE_CHIP).size)
          .fontColor([colorOf(this.pal(), 'dangerText')])
          .flexShrink(0)
        Text(this.title())
          .fontSize(FS_CAPTION)
          .fontColor(colorOf(this.pal(), 'textSecondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.repeat().length > 0) {
          Text(this.repeat())
            .fontSize(typeOf(TYPE_CHIP).size)
            .fontColor(colorOf(this.pal(), 'textMuted'))
            .backgroundColor(wellOf(this.pal()))
            .padding({ left: SP_1, right: SP_1, top: SPACE_HAIR, bottom: SPACE_HAIR })
            .borderRadius(RADIUS_CHIP)
            .flexShrink(0)
        }
        Text(this.open ? '收起' : '详情')
          .fontSize(typeOf(TYPE_CHIP).size)
          .fontColor(colorOf(this.pal(), 'accentSoft'))
          .flexShrink(0)
        SymbolGlyph(this.open ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
          .fontSize(typeOf(TYPE_CHIP).size)
          .fontColor([colorOf(this.pal(), 'iconMuted')])
          .flexShrink(0)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      // press 反馈（全 App 统一口径 `PRESS_OPACITY`，与 pill/抄送按钮同款；此前**点了像没反应**）
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.open = !this.open;
      })

      // ── 详情（默认折叠）—— 等宽、限高内滚，保留 `#1..#5` 全部原文 ─────────────────
      if (this.open) {
        Scroll() {
          Text(this.raw())
            .fontSize(FS_CAPTION)
            .fontFamily('monospace')
            .fontColor(colorOf(this.pal(), 'textSecondary'))
            .width('100%')
            // 长 URL/标识符按词内断行（docs/ARKTS-GOTCHAS §15）—— 不折行会撑出屏幕
            .wordBreak(WordBreak.BREAK_ALL)
            .textAlign(TextAlign.Start)
            .copyOption(CopyOptions.LocalDevice)
        }
        .scrollBar(BarState.Auto)
        .width('100%')
        .constraintSize({ maxHeight: DETAIL_MAX_H })
        .padding(SP_2)
        .backgroundColor(wellOf(this.pal()))
        .borderRadius(R_MD)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
