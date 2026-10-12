/**
 * SelfCheckSheet —— 「渲染自检」（原 `pages/Index.ets` 的 `@Builder SelfCheckSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `geoRunning`（按钮文案）与**已合成的** `auditText`
 * （取证文本由页面从 `sessionStats()` + `geoText` 拼，判据留在页面）；`showSelfCheck`
 * 所有权留页面（弹层 flag 集中）。
 * ⛔ 左下 A–H 八组自检构件是**纯静态**样张（无状态），随本组件一起搬。
 *
 * ── 视觉语言（2026-10-11，L1 顶层弹层根面统一）──────────────────────────────
 * 根面 = `surfaceFillOf(p,'surface.overlay')`（浮层语义面）+ 结构性发丝 `hairlineOf(p)`
 * + **两层柔影** `shadowLayersOf(p,'overlay')` —— 与同层级 `StatusSheet`/`AskUserSheet`/`MenuSheets`
 * 同通道（web `bg-bg-elevated` = 浮层面；此前为裸 `pal().appBg` + 无柔影）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { FS_CAPTION, R_LG, R_XL, SP_2, SP_3 } from '../core/tokens';
import {
  HIT_TARGET_MIN, PRESS_OPACITY, GAP_PILL, INSET_CARD_X, INSET_PILL_X, INSET_PILL_Y, RADIUS_CHIP, STROKE_HAIRLINE, SURFACE_CARD, hairlineOf, structuralRuleOf, surfaceFillOf, ICON_XL, ICON_LG } from '../core/design';
import { fs, fw } from './SettingsRows';
import { MarkdownView } from './MarkdownView';
import { sheetTransition } from './anim';

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

  /** 本弹层的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'overlay');
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column() {
        Row() {
          Text('渲染自检').fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
            .fontColor(this.pal().textPrimary).layoutWeight(1)
          // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`；
          //    图标视觉尺寸不变（仍 16，盒内居中）。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(ICON_LG)
              .fontColor([this.pal().textSecondary])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭')
          .onClick(() => {
            this.onClose();
          })
        }.width('100%')

        // ⛔ 命中区必须 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先写死 40 低于阈值（审计命中）。
        Button(this.geoRunning ? '采集中…' : '采集各页版面几何（数值，无需网络）')
          .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN }).backgroundColor(this.pal().accentSoft)
          .onClick(() => {
            this.onCollect();
          })
        Text('下方这一段可【长按复制】后直接粘贴给对方 —— 不必截图（零网络也能取证）')
          .fontSize(fs('type.caption')).fontColor(this.pal().warn).width('100%').wordBreak(WordBreak.BREAK_WORD)
        Text(this.auditText)
          .fontSize(fs('type.caption')).fontColor(this.pal().successText).fontFamily('monospace')
          // 溢出兜底（等宽**审计串**：含路径/命令等不可断内容 ⇒ 可断）
          .wordBreak(WordBreak.BREAK_ALL)
          .width('100%').padding(SP_2)
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.raised')).borderRadius(R_LG)
          .copyOption(CopyOptions.LocalDevice)

        Scroll() {
          Column({ space: 10 }) {
            Column({ space: 6 }) {
              Text('A 纯文本（自动换行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              MarkdownView({ text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。' })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('B 行内样式（粗/斜/删除/行内码/链接）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              MarkdownView({ text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。' })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('C 标题 + 列表').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              MarkdownView({ text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二' })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('D 代码块（含超长行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              MarkdownView({ text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```' })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('E 表格').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
              MarkdownView({ text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |' })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('F 工具 pill 行（Flex 换行）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(['已完成 Read', '已完成 Shell', '运行中 Grep', '已完成 Edit', '失败 Fetch'], (t: string) => {
                  Text(t).fontSize(FS_CAPTION).fontColor(this.pal().successText)
                    // 溢出兜底（pill 标签在 `Flex(wrap)` 里；不可断串也要能折行）
                    .wordBreak(WordBreak.BREAK_ALL)
                    .padding({ left: INSET_PILL_X, right: INSET_PILL_X, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
                    .margin(GAP_PILL).backgroundColor(surfaceFillOf(this.pal(), 'surface.raised')).borderRadius(RADIUS_CHIP)
                    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
                }, (t: string) => t)
              }.width('100%')
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('G 长 URL（不可断词）').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%').wordBreak(WordBreak.BREAK_WORD)
              Text('https://xbot.pivotlang.tech/api/files/download?key=uploads%2F4%2Faaef9711-1349-420d-97ea-94e70e2401e7.jpg&inline=1')
                .fontSize(FS_CAPTION).fontColor(this.pal().accentSoft).width('100%')
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })

            Column({ space: 6 }) {
              Text('H 顶栏内联布局').fontSize(FS_CAPTION).fontColor(this.pal().textSecondary).width('100%')
              Row() {
                SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(ICON_XL)
                  .fontColor([this.pal().textPrimary]).padding(10)
                Text('标题文本').fontSize(fs('type.body')).fontColor(this.pal().textPrimary).layoutWeight(1)
                SymbolGlyph($r('sys.symbol.square_grid_2x2')).fontSize(ICON_XL)
                  .fontColor([this.pal().textPrimary]).padding(10)
                SymbolGlyph($r('sys.symbol.gearshape')).fontSize(ICON_XL)
                  .fontColor([this.pal().textPrimary]).padding(10)
              }.width('100%').backgroundColor(surfaceFillOf(this.pal(), 'surface.raised'))
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
            .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
          }
          .width('100%')
          .padding(INSET_CARD_X)
        }
        .layoutWeight(1)
        .width('100%')
        // ⛔ 用户报「滚动栏挡住交互」：默认 `BarState.Auto` 的滚动条**叠在内容右缘并参与命中测试**。
        //    这里是**面板内部的短列表** ⇒ 显式关掉（本仓浮层口径：`AskUserSheet`/`PluginHost` 同款）。
        //    （`BarState.Off` 只关视觉条，**不关滚动**。）
        .scrollBar(BarState.Off)
      }
      .width('100%').height('100%').padding(SP_3)
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius(R_XL)
      // 顶层弹层根边界 = **结构性发丝**（与 `PluginsSheet`/`QueueSheet`/`StatusSheet` 等同层级 ⇒ 同通道）；
      // ⛔ 此前是手写的裸 `pal().borderStrong` + 裸宽 `1`（`docs/DESIGN-SYSTEM.md §13.5`）。
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`glow`，逐字节不变）。
    .width('94%').height('86%')
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(R_XL)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    // 出入场过渡（2026-10-12 穷举扫全仓 7 个浮层：**只有它与 `ToolPopover` 是 0 过渡**；
    // 后者走 `bindPopup`（系统绘制，改不到，见 `anim.ets:176`）⇒ 这里补齐。
    // 与 `StatusSheet` **同一个工厂**（`sheetTransition()`，不许自造第二套入场语言）。
    .transition(sheetTransition())
  }
}
