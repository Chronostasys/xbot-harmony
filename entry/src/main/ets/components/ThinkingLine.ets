/**
 * 思考折叠行 —— **live 迭代与 committed 迭代共用的唯一形态**（对齐 web `ThinkingLine.tsx`）。
 *
 * ⛔ 必须是 **@Component + @Prop**，**不能**用带参全局 `@Builder`：
 *   带参 `@Builder` 的参数是**调用那一刻的快照**，其子树**不随参数变化重建**
 *   （本项目已记录：`docs/ARKTS-GOTCHAS.md §4`）。用它承载"每拍都在变的思考字数"
 *   与"打字机正文"时，症状正是用户 2026-10-10 报的：
 *     · 新迭代的「思考 N 字」**卡住不变**（停在第一帧的值，如 99），结束时才跳变；
 *     · 正文打字机**不推进**；
 *     · **点它无法展开**（子树是冻结的）。
 *   ⇒ 改为组件后，`@Prop` 变化即重建（值变化通道）。
 *
 * 形态（逐项对齐 web）：
 *   · 头部 = **图标 + 标签**，`w-fit`（不撑满整行），**无展开箭头**（用户要求删除）；
 *   · 展开体 = 左侧 2px 竖线 + 缩进，muted 色 + 0.75 透明度（弱于正文）。
 *
 * 图标说明：web 用 lucide `Brain`；HarmonyOS 符号集无 brain（`sysResource.js` 4042 项无匹配），
 * 取语义最近的 `lightbulb`。**图标只是提示符，不承载状态**。
 */
import { paletteOf } from '../core/theme';
import { FS_CAPTION, R_LG, SP_1, SP_2 } from '../core/tokens';

@Component
export struct ThinkingLine {
  /** 头部标签（live = 流式字数；committed = 全量字数）。 */
  @Prop label: string = '';
  /** 展开体文本（live = 打字机裁剪后的前缀；committed = 全量思考）。 */
  @Prop body: string = '';
  /** 是否展开。 */
  @Prop open: boolean = false;
  @Prop theme: string = 'dark';
  /**
   * **是否由本行当"主高亮源"**（在飞视觉语言，见 `docs/DESIGN-SYSTEM.md §8`）。
   *
   * 同一时刻只允许一个主高亮源：有工具在飞 / 正在写正文时 = **光球**（本行静态弱化）；
   * 只有思考在流（无工具、无正文）时才轮到本行 ⇒ 图标+标签转 `accentSoft` 并按共享呼吸
   * 刻度做极弱强调。默认 `false` ⇒ **committed 迭代零行为变化**（永远 muted、永远静态）。
   */
  @Prop live: boolean = false;
  /**
   * 共享呼吸权重 ∈[0,1]（调用方按 `anim.ets` 的 `MOTION_BREATH_MS` 用 `orbBreath()` 算出）。
   * **会变** ⇒ 必须 `@Prop`（`@Builder` 参数是首帧快照）。非 live 时无意义（不参与渲染）。
   */
  @Prop emphasis: number = 1;
  /** 点击开合（状态由调用方持有 —— 同一语义两处共用）。 */
  onToggle: () => void = () => {
  };

  build() {
    Column({ space: 0 }) {
      // 头部：`w-fit` ⇒ 不设 width('100%')（点击热区只覆盖图标+文字，与 web 的 `w-fit` 一致）
      Row({ space: SP_1 }) {
        SymbolGlyph($r('sys.symbol.lightbulb'))
          .fontSize(FS_CAPTION)
          .fontColor([this.live ? paletteOf(this.theme).accentSoft : paletteOf(this.theme).textMuted])
        Text(this.label)
          .fontSize(FS_CAPTION)
          .fontColor(this.live ? paletteOf(this.theme).accentSoft : paletteOf(this.theme).textMuted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      // 主高亮时：按共享呼吸刻度做**极弱**强调（0.72→1.0），不是第二个发光体
      .opacity(this.live ? 0.72 + 0.28 * this.emphasis : 1)
      .padding({ left: SP_1, right: SP_1, top: 2, bottom: 2 })
      .borderRadius(R_LG)
      .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.onToggle();
      })

      if (this.open && this.body.length > 0) {
        Text(this.body)
          .fontSize(FS_CAPTION)
          .fontColor(paletteOf(this.theme).textMuted)
          .opacity(0.75)
          .width('100%')
          .wordBreak(WordBreak.BREAK_WORD)
          .padding({ left: SP_2, top: 2, bottom: 2 })
          .border({ width: { left: 2 }, color: paletteOf(this.theme).border })
          .copyOption(CopyOptions.LocalDevice)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
