/**
 * SelfCheckSheet —— 「渲染自检」（原 `pages/Index.ets` 的 `@Builder SelfCheckSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `geoRunning`（按钮文案）与**已合成的** `auditText`
 * （取证文本由页面从 `sessionStats()` + `geoText` 拼，判据留在页面）；`showSelfCheck`
 * 所有权留页面（弹层 flag 集中）。
 * ⛔ 左下 A–H 八组自检构件是**纯静态**样张（无状态），随本组件一起搬。
 */
import { Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, FS_TITLE, R_LG, R_XL, SP_2, SP_3 } from '../core/tokens';
import {
  PRESS_OPACITY, GAP_PILL, INSET_CARD_X, INSET_PILL_X, INSET_PILL_Y, RADIUS_CHIP, STROKE_HAIRLINE, SURFACE_CARD, hairlineOf, surfaceFillOf,
} from '../core/design';
import { fs, fw } from './SettingsRows';
import { MarkdownView } from './MarkdownView';

@Component
export struct SelfCheckSheet {
  @Prop theme: string = 'dark';
  /** 几何采集进行中（按钮文案「采集中…」）。 */
  @Prop geoRunning: boolean = false;
  /** 可直接长按复制的取证文本（页面 `auditText()`）。 */
  @Prop auditText: string = '';
  /** 采集各页版面几何（页面 `collectAllGeometry()`）。 */
  onCollect: () => void = () => {
  };
  /** 关闭（页面置 `showSelfCheck=false`）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column() {
      Row() {
        Text('渲染自检').fontSize(FS_TITLE).fontWeight(fw('type.headline'))
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17)
          .fontColor([this.pal().textSecondary]).padding(SP_2)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onClose();
          })
      }.width('100%')

      Button(this.geoRunning ? '采集中…' : '采集各页版面几何（数值，无需网络）')
        .width('100%').constraintSize({ minHeight: 40 }).backgroundColor(this.pal().accentSoft)
        .onClick(() => {
          this.onCollect();
        })
      Text('下方这一段可【长按复制】后直接粘贴给对方 —— 不必截图（零网络也能取证）')
        .fontSize(fs('type.caption')).fontColor(this.pal().warn).width('100%')
      Text(this.auditText)
        .fontSize(fs('type.caption')).fontColor(this.pal().successText).fontFamily('monospace')
        .width('100%').padding(SP_2)
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.raised')).borderRadius(R_LG)
        .copyOption(CopyOptions.LocalDevice)

      Scroll() {
        Column({ space: 10 }) {
          Column({ space: 6 }) {
            Text('A 纯文本（自动换行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。' })
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('B 行内样式（粗/斜/删除/行内码/链接）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。' })
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('C 标题 + 列表').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二' })
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('D 代码块（含超长行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```' })
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('E 表格').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            MarkdownView({ text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |' })
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('F 工具 pill 行（Flex 换行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(['已完成 Read', '已完成 Shell', '运行中 Grep', '已完成 Edit', '失败 Fetch'], (t: string) => {
                Text(t).fontSize(FS_CAPTION).fontColor(this.pal().successText)
                  .padding({ left: INSET_PILL_X, right: INSET_PILL_X, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
                  .margin(GAP_PILL).backgroundColor(surfaceFillOf(this.pal(), 'surface.raised')).borderRadius(RADIUS_CHIP)
                  .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
              }, (t: string) => t)
            }.width('100%')
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('G 长 URL（不可断词）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            Text('https://xbot.pivotlang.tech/api/files/download?key=uploads%2F4%2Faaef9711-1349-420d-97ea-94e70e2401e7.jpg&inline=1')
              .fontSize(FS_CAPTION).fontColor(this.pal().accentSoft).width('100%')
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })

          Column({ space: 6 }) {
            Text('H 顶栏内联布局').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
            Row() {
              SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(20)
                .fontColor([this.pal().textPrimary]).padding(10)
              Text('标题文本').fontSize(fs('type.body')).fontColor(this.pal().textPrimary).layoutWeight(1)
              SymbolGlyph($r('sys.symbol.square_grid_2x2')).fontSize(20)
                .fontColor([this.pal().textPrimary]).padding(10)
              SymbolGlyph($r('sys.symbol.gearshape')).fontSize(20)
                .fontColor([this.pal().textPrimary]).padding(10)
            }.width('100%').backgroundColor(surfaceFillOf(this.pal(), 'surface.raised'))
          }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
        }
        .width('100%')
        .padding(INSET_CARD_X)
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('94%').height('86%')
    .padding(SP_3)
    .backgroundColor(this.pal().appBg)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().borderStrong })
  }
}
