/**
 * TaskDetailSheet —— **后台任务详情**（2026-10-12，目标④「任务管理做的很差」）。
 *
 * 用户原话：「终端和任务管理做的很差」。此前原生后台任务只有 `core/panels.ets:bgTaskLine()`
 * 的**一行字** —— **看不到输出、杀不掉、也不知道杀了以后怎样**。本组件补齐 web
 * `workspace/panels/BackgroundPanel.tsx` 的三件事：
 *   ① 标题（命令）+ 运行态短语（`bgTaskStatusText`）；
 *   ② **输出正文**（等宽、可滚、自动跟到底、支持 ANSI 着色）；
 *   ③ **终止按钮**（只在运行中出现 ⇒ 与 web `{running && <Button…/>}` 同口径）。
 *
 * 分层（同 `StatusSheet`/`FilesSheet`）：组件**只画**。所有字符串由页面用 `core/panels.ets`
 * 的纯函数算好传入 ⇒ 列表行与详情页**判据同源**（同一个 `bgTaskStatusText`/`bgTaskMetaText`），
 * 不可能出现"列表说运行中、详情说完成"。弹层开关所有权同样留页面（`core/overlays.topOverlay`）。
 *
 * ── 为什么是 `Text` 而不是 xterm ─────────────────────────────────────────────
 * web 用 xterm.js 是因为浏览器没有原生终端控件；原生只需「等宽 + 可滚 + 跟底 + ANSI 着色」。
 * ANSI 解析**复用 `core/ansi.ets`**（与工具 pill 浮层/实时尾同一份 `parseAnsi`，
 * ⛔ 不新造第二套转义表）；无转义的输出走纯文本路径，逐字节不变。
 */
import { AnsiSpan, ansiBgOf, ansiFgOf, ansiPaletteOf, ansiSpansIfAny, hasAnsi } from '../core/ansi';
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  colorOf, HIT_TARGET_MIN, ICON_MD, PRESS_OPACITY, RADIUS_SHEET, SPACE_MD, SPACE_SM, SPACE_XS,
  SURFACE_CARD, surfaceFillOf, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';

@Component
export struct TaskDetailSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** 命令（空串 ⇒ 显示「后台任务」）。 */
  @Prop title: string = '';
  /** 状态短语（页面 `bgTaskStatusText(t)`）。 */
  @Prop statusText: string = '';
  /** 副行（页面 `bgTaskMetaText(t, now)`）：`exit 0 · 3.2s · <id>`。 */
  @Prop metaText: string = '';
  /** 输出正文（页面 `bgTaskOutputText(t)`；空串 ⇒ 显示占位）。 */
  @Prop output: string = '';
  /** 是否运行中（决定终止按钮是否出现；判据 = 页面 `bgTaskRunning(t)`）。 */
  @Prop running: boolean = false;
  /** 终止该任务（页面调 `store.killBgTask(id)` + toast；组件**不发** RPC）。 */
  onKill: () => void = () => {
  };
  /** 关闭面板。 */
  onClose: () => void = () => {
  };

  /** 输出滚动容器（跟到底用）。 */
  private scroller: Scroller = new Scroller();
  /**
   * 色板记忆化（与 `FilesSheet`/`SelfCheckSheet` **同一形态**）：
   * 属性初始化器里 `paletteOf(...)` 只在构造那一次求值 ⇒ 主题切换不刷新（门禁 ⑥ 会抓）。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  private palOnce(): Palette {
    const c: Palette | null = this.palCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const fresh: Palette = paletteOf(this.theme);
    this.palCache = fresh;
    this.palThemeCache = this.theme;
    return fresh;
  }

  /** 输出正文的 ANSI span（⛔ 无转义 ⇒ 空数组 ⇒ 调用方走纯文本路径，逐字节不变）。 */
  private outSpans(): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(this.output, ansiPaletteOf(this.palOnce()));
    return s !== null ? s : [];
  }

  /** 滚到底（新输出到达 / 首次出现时）。 */
  private follow(): void {
    this.scroller.scrollEdge(Edge.Bottom);
  }

  build() {
    // ── 多层柔影（同 `SelfCheckSheet`）：浅色 near=贴合影 / far=环境影；深色 near 透明。
    Stack() {
      Column({ space: SPACE_SM }) {
        // ── 头部：命令 + 关闭 ─────────────────────────────────────────────────
        Row({ space: SPACE_XS }) {
          Column({ space: 2 }) {
            Text(this.title.length > 0 ? this.title : '后台任务')
              .fontSize(typeOf('type.headline').size)
              .fontWeight(typeOf('type.headline').weight)
              .fontColor(this.palOnce().textPrimary)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .wordBreak(WordBreak.BREAK_ALL)
              // 横向约束用 `constraintSize` 而非 `width('100%')`：本 Text 在 **Row 内**
              // （页头 = [标题块 layoutWeight(1)][终止 44][关闭 44]），必须显式声明"可收缩到 ≤100%"，
              // 否则长命令（`go test ./...` 那种）会把两个 44 热区挤出屏幕（门禁 H1 硬红抓的就是这个）。
              .constraintSize({ maxWidth: '100%' })
            Row({ space: SPACE_XS }) {
              Text(this.statusText)
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.running ? this.palOnce().accent : this.palOnce().textSecondary)
              Text(this.metaText)
                .fontSize(typeOf('type.caption').size)
                .fontColor(colorOf(this.palOnce(), 'iconMuted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }.width('100%').alignItems(VerticalAlign.Center)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          // 终止（仅运行中；真 44 热区由 Row 承载 —— `responseRegion` 负偏移在本机无效）
          if (this.running) {
            Row() {
              SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
                .fontSize(ICON_MD)
                .fontColor([this.palOnce().dangerText])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
            .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText('终止任务')
            .onClick(() => {
              this.onKill();
            })
          }
          Row() {
            SymbolGlyph($r('sys.symbol.xmark'))
              .fontSize(ICON_MD)
              .fontColor([colorOf(this.palOnce(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭任务详情')
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)

        // ── 输出正文（等宽 / 可滚 / 跟底）─────────────────────────────────────
        Scroll(this.scroller) {
          Column() {
            if (this.output.length === 0) {
              Text(this.running ? '（暂无输出）' : '（无输出）')
                .fontSize(typeOf('type.caption').size)
                .fontColor(colorOf(this.palOnce(), 'iconMuted'))
                .width('100%')
            } else if (hasAnsi(this.output)) {
              // 有转义：逐 span 上色（与工具 pill 浮层同一入口 `core/ansi`）
              Text() {
                ForEach(this.outSpans(), (sp: AnsiSpan, si: number) => {
                  Span(sp.text)
                    .fontColor(ansiFgOf(sp, this.palOnce().textPrimary))
                    .fontWeight(sp.bold ? FontWeight.Bold : FontWeight.Normal)
                    .fontStyle(sp.italic ? FontStyle.Italic : FontStyle.Normal)
                    .decoration({
                      type: sp.strike ? TextDecorationType.LineThrough
                        : (sp.underline ? TextDecorationType.Underline : TextDecorationType.None),
                      color: ansiFgOf(sp, this.palOnce().textPrimary),
                    })
                }, (sp: AnsiSpan, si: number) => `o${si}`)
              }
              .fontSize(typeOf('type.caption').size)
              .fontFamily('monospace')
              .wordBreak(WordBreak.BREAK_ALL)
              .width('100%')
              .copyOption(CopyOptions.LocalDevice)
            } else {
              Text(this.output)
                .fontSize(typeOf('type.caption').size)
                .fontFamily('monospace')
                .fontColor(this.palOnce().textPrimary)
                .wordBreak(WordBreak.BREAK_ALL)
                .width('100%')
                .copyOption(CopyOptions.LocalDevice)
                .onAreaChange(() => {
                  // 新输出改变内容高度 ⇒ 跟到底（`running` 时始终跟；结束后不动，用户可自由看）
                  if (this.running) {
                    this.follow();
                  }
                })
            }
          }
          .width('100%')
          .padding(SPACE_SM)
          .backgroundColor(surfaceFillOf(this.palOnce(), SURFACE_CARD))
          .borderRadius(RADIUS_SHEET)
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.TopStart)
        .scrollBar(BarState.Auto)
        .edgeEffect(EdgeEffect.Spring)
      }
      .width('94%')
      .height('80%')
      .padding(SPACE_MD)
      .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
      .borderRadius(RADIUS_SHEET)
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    .width('100%').height('100%')
    .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
    .borderRadius(RADIUS_SHEET)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    // 出入场过渡：与 `StatusSheet`/`SelfCheckSheet` **同一个工厂**（⛔ 不自造第二套入场语言）。
    .transition(sheetTransition())
  }

  /** 双层柔影（C3 推广）；深浅两态由 `shadowLayersOf` 决定，组件不写第二套。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'sheet');
  }
}
