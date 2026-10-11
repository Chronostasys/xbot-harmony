/**
 * StatusSheet —— 「会话状态」面板（原 `pages/Index.ets` 的 `@Builder StatusSheet()`，P1 抽出）。
 *
 * ── 为什么抽它（`docs/INDEX-SPLIT-PLAN.md` §5）────────────────────────────────
 *   Index.ets 6420 行里视觉与判据混住；它是**状态面最小**的一块（只读 4 项、2 个写点且都只是
 *   "跳去别的弹层"）⇒ 改成 `@Prop` 入 + 回调出即可，零 store / 零 scroller / 零弹层栈语义。
 *
 * ── 分层铁律（本文件不许违反）─────────────────────────────────────────────────
 *   · **不算任何东西**：用量/模型/上下文上限/路径/目标的**判据全在页面**（那里才拿得到 store 与
 *     `core/*` 的唯一判据函数）⇒ 本组件只吃**已算好的字符串**。⛔ 不许在这里 import store、
 *     不许自造第二套状态→文案映射。
 *   · **弹层开关所有权不搬**：`showStatus`/`showModel` 留在页面（`core/overlays.topOverlay`
 *     要求所有 flag 集中）⇒ 本组件只给 `onClose` / `onOpenModel` 回调，自己**不改**任何开关。
 *   · 动效走底座 `./anim` 的 `sheetTransition()`（唯一实现）；颜色只用 `pal()` 语义色（禁 hex）。
 *   · 会变的内容走真 `@Component` + `@Prop`（禁带参 @Builder —— 会冻在首帧）。
 *
 * ── 行为等价性（P1 三重证据之一）──────────────────────────────────────────────
 *   入参 = 原 `@Builder` 引用集合逐一对应：`pal()→theme`、`goalLine()→goalLine`、
 *   `usageText(this.usage)→usageText`、`currentModelName()→modelName`、`ctxText()→ctxText`、
 *   `this.cwd→cwd`；写点 `showStatus=false→onClose`、`showModel=true + store.loadLlmConfig()→onOpenModel`。
 */
import { Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, FS_TITLE, R_LG, R_XL, SP_2, SP_4 } from '../core/tokens';
import { sheetTransition } from './anim';

@Component
export struct StatusSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** goal 行（空串 = 不显示；判据在页面 `goalLine()`）。 */
  @Prop goalLine: string = '';
  /** 用量文本（空串 ⇒ 显示 `—`，与抽取前逐字一致）。 */
  @Prop usageText: string = '';
  /** 当前模型名（页面 `currentModelName()`）。 */
  @Prop modelName: string = '';
  /** 上下文上限文本（空串 = 不显示该行）。 */
  @Prop ctxText: string = '';
  /** 工作路径（空串 = 不显示该行）。 */
  @Prop cwd: string = '';
  /** 关闭面板（页面置 `showStatus=false`）。 */
  onClose: () => void = () => {
  };
  /** 打开「模型 / 上下文上限」选择栏（页面置 `showModel=true` + 拉 llm-config）。 */
  onOpenModel: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text('会话状态').fontSize(FS_TITLE).fontWeight(FontWeight.Bold)
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17)
          .fontColor([this.pal().textSecondary]).padding(SP_2)
          .onClick(() => {
            this.onClose();
          })
      }.width('100%')

      if (this.goalLine.length > 0) {
        Text(this.goalLine).fontSize(13).fontColor(this.pal().warn).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      // ⛔ 不整体渲染「模型 · 用量 · todos · cwd」四段拼接串：模型 / 工作路径在下方各有**专属行**
      //    ⇒ 同一信息两处。排版口径 = web `SessionInfo.tsx` 的 `InfoRow`：标签左（次级色）、
      //    值右（主色），每项只出现一次。
      Row() {
        Text('用量').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
        Text(this.usageText.length > 0 ? this.usageText : '—')
          .fontSize(FS_CAPTION).fontColor(this.pal().textPrimary)
          .layoutWeight(1).textAlign(TextAlign.End)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')

      Row() {
        Text('模型').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
        Text(this.modelName)
          .fontSize(FS_CAPTION).fontColor(this.pal().textPrimary)
          .layoutWeight(1).textAlign(TextAlign.End)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')

      if (this.ctxText.length > 0) {
        Row() {
          Text('上下文上限').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
          Text(this.ctxText)
            .fontSize(FS_CAPTION).fontColor(this.pal().textPrimary)
            .layoutWeight(1).textAlign(TextAlign.End)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }.width('100%')
      }

      if (this.cwd.length > 0) {
        Row() {
          Text('工作路径').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
          Text(this.cwd)
            .fontSize(11).fontColor(this.pal().textPrimary).fontFamily('monospace')
            .layoutWeight(1).textAlign(TextAlign.End)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .copyOption(CopyOptions.LocalDevice)
        }.width('100%')
      }

      // 切换入口（模型 / 上下文上限）—— 单独一行，与上面只读信息解耦
      Row({ space: SP_2 }) {
        Text('切换模型 / 上下文上限').fontSize(FS_CAPTION).fontColor(this.pal().accentSoft)
          .layoutWeight(1)
        Text('›').fontSize(14).fontColor(this.pal().accentSoft)
      }
      .width('100%').padding(10).backgroundColor(this.pal().surface).borderRadius(R_LG)
      .stateStyles({ pressed: { .opacity(0.7) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.onOpenModel();
      })

      // ⛔ 此处**不**渲染 todo 列表：web 取证——todo 的唯一挂载点是输入框上方的 `TodoPullOut`，
      //    状态/上下文弹层（`ContextBar`）里没有 todo 列表（且 `ContextBar` 在 web 已是死代码）。
      //    原生此前把全量 todo 放这里 ⇒ 同一信息两处，正是用户反馈「todo 点了才显示太丑」那处。
      //    todo 现在只由 `TodoPanel`（composer 上方）承载。
    }
    .width('92%').padding(SP_4).backgroundColor(this.pal().appBg)
    .borderRadius(R_XL).border({ width: 1, color: this.pal().border })
    .transition(sheetTransition())
  }
}
