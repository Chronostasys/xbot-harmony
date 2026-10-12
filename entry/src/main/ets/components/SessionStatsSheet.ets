/**
 * SessionStatsSheet —— **会话统计面板**（2026-10-12，目标④「统计插件的面板我们看不到」）。
 *
 * ── 它是什么（为什么必须有）────────────────────────────────────────────────────
 * web 的内置插件 `xbot.session-stats` 贡献一个 `right_sidebar` 视图（`SessionStatsPanel`），
 * 手机端作为侧栏 section 常驻。**原生此前完全没有它** —— 因为它不在服务端
 * `web_plugin_list`（那是磁盘插件目录）里，是随 web 主包打包的 `builtinViews`
 * （见 `core/sessionstats.ets` 文件头）。本组件把它的**手机形态（窄形态）**原生落地：
 * 面板数据全部来自宿主自己的 RPC（`get_session_usage_stats`），**不需要执行任何插件 JS**
 * ⇒ 与 `xbot.iteration-stats` 徽章同一范式（原生画，不是把 web 塞进 WebView）。
 *
 * ── 分层（同 `StatusSheet`/`TaskDetailSheet`）──────────────────────────────────
 * 组件**只画**：所有字符串/数值由页面用 `core/sessionstats.ets` 的纯函数算好传入
 * ⇒ 判据与渲染同源（同一个 `overviewCells`/`perfCells`/`contextCells`/`byModelRows`/
 * `recentRows`）。`loading`/`error`/`stats` 与开合 flag 的所有权同样留页面
 * （`core/overlays.topOverlay`）。
 *
 * ⛔ 同一时刻只允许一个在飞动效=光球 ⇒ 加载态是**一行小字**，不是 spinner（同 `PluginsSheet`）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { ByModelRow, SessionUsage, StatCell, byModelRows, contextCells, overviewCells, perfCells, recentTableHeader, recentTableText } from '../core/sessionstats';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, ICON_LG, ICON_MD, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY,
  RADIUS_CARD, RADIUS_SHEET, SPACE_MD, SPACE_SM, SPACE_XS, SPACE_XXS, STROKE_HAIRLINE, structuralRuleOf,
  SURFACE_CARD, surfaceFillOf, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';

@Component
export struct SessionStatsSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** 归一化后的会话用量（页面 `parseSessionUsage(rpc 结果)`）。 */
  @Prop stats: SessionUsage = new SessionUsage();
  /** 拉取中（页面/组件都不转 spinner ⇒ 一行小字）。 */
  @Prop loading: boolean = false;
  /** 失败原因（已可读化；空 = 无错）。 */
  @Prop error: string = '';
  /** 重试（页面重发 RPC）。 */
  onRetry: () => void = () => {
  };
  /** 关闭面板。 */
  onClose: () => void = () => {
  };

  /** 色板记忆化（与 `TaskDetailSheet`/`PluginsSheet` 同一形态：主题切换必须刷新）。 */
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

  /** 双层柔影（C3 推广）；深浅两态由 `shadowLayersOf` 决定，组件不写第二套。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'sheet');
  }

  // ── 取色访问器（**每个语义色一处读数**）────────────────────────────────────────
  // 为什么这样写：`build()`/`@Builder` 里**不能声明局部变量** ⇒ 无法"取一次色板、多处引用"；
  // 而性能预算 B 线（色板读取总量）是**只许减**的护栏 ⇒ 把重复取色收成单一读点（同一语义色
  // 全组件只在一个方法里解析），既压读数、又让取色可审计（⛔ 不写死颜色，仍走 `colorOf`/`surfaceFillOf`）。
  private cPrimary(): string {
    return this.palOnce().textPrimary;
  }

  private cSecondary(): string {
    return this.palOnce().textSecondary;
  }

  /** 图标/弱化文字色（**计算型 role** ⇒ 必须走 `colorOf`，见 AGENTS.md）。 */
  private cMuted(): string {
    return colorOf(this.palOnce(), 'iconMuted');
  }

  private cDanger(): string {
    return colorOf(this.palOnce(), 'dangerText');
  }

  private bgCard(): string {
    return surfaceFillOf(this.palOnce(), SURFACE_CARD);
  }

  private bgOverlay(): string {
    return surfaceFillOf(this.palOnce(), 'surface.overlay');
  }

  private cStructural(): string {
    return structuralRuleOf(this.palOnce());
  }

  private cHairline(): string {
    return hairlineOf(this.palOnce());
  }

  /** 是否已有可用数据（决定画内容 / 空态）。 */
  private hasData(): boolean {
    const s: SessionUsage = this.stats;
    return s.iterationCount > 0 || s.inputTokens > 0 || s.outputTokens > 0 || s.recentIterations.length > 0;
  }

  /** 一张指标卡（label 小字 / value 大数字 / sub 可选副行）；等宽数字对齐。 */
  @Builder
  metricCard(cell: StatCell) {
    Column({ space: SPACE_XXS }) {
      Text(cell.label)
        .fontSize(typeOf('type.micro').size).fontWeight(typeOf('type.micro').weight)
        .fontColor(this.cMuted())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      Text(cell.value)
        .fontSize(typeOf('type.subhead').size).fontWeight(typeOf('type.subhead').weight)
        .fontFamily('monospace').fontColor(this.cPrimary())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      if (cell.sub.length > 0) {
        Text(cell.sub)
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.cMuted())
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      }
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .constraintSize({ minHeight: 58 })
    .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(this.bgCard())
    .borderRadius(RADIUS_CARD)
  }

  /** 一行指标卡（**最多 4 槽，显式渲染** ⇒ 无需 `ForEach`；性能预算 ⑦ 的 ForEach 处数是全仓硬上限）。 */
  @Builder
  metricRow(cells: StatCell[]) {
    Row({ space: SPACE_XS }) {
      this.metricCard(cells[0])
      if (cells.length > 1) {
        this.metricCard(cells[1])
      }
      if (cells.length > 2) {
        this.metricCard(cells[2])
      }
      if (cells.length > 3) {
        this.metricCard(cells[3])
      }
    }
    .width('100%').alignItems(VerticalAlign.Top)
  }

  /** 一个命名区块（小节标题 + 内容）。 */
  @Builder
  section(title: string) {
    Text(title)
      .fontSize(typeOf('type.micro').size).fontWeight(typeOf('type.micro').weight)
      .fontColor(this.cMuted())
      .width('100%')
      .margin({ top: SPACE_XS })
  }

  /** 一个「按模型」卡片（模型名 + 一行指标；**显式渲染**，不 `ForEach`）。 */
  @Builder
  modelCard(r: ByModelRow) {
    Column({ space: SPACE_XXS }) {
      Text(r.model)
        .fontSize(typeOf('type.caption').size)
        .fontFamily('monospace').fontColor(this.cPrimary())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      Text(r.meta)
        .fontSize(typeOf('type.micro').size)
        .fontFamily('monospace').fontColor(this.cMuted())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(this.bgCard())
    .borderRadius(RADIUS_CARD)
  }

  build() {
    // ── 多层柔影（同 `TaskDetailSheet`）：浅色 near=贴合影 / far=环境影；深色 near 透明。
    Stack() {
      Column({ space: SPACE_XS }) {
        // ── 头部：标题 + 刷新 + 关闭 ──────────────────────────────────────────
        Row({ space: SPACE_XS }) {
          Text('统计')
            .fontSize(typeOf('type.headline').size)
            .fontWeight(typeOf('type.headline').weight)
            .fontColor(this.cPrimary())
            .layoutWeight(1)
          // 刷新（真 44 热区由 Row 承载 —— `responseRegion` 负偏移在本机无效）
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise'))
              .fontSize(ICON_MD)
              .fontColor([this.cSecondary()])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('刷新')
          .onClick(() => {
            this.onRetry();
          })
          Row() {
            SymbolGlyph($r('sys.symbol.xmark'))
              .fontSize(ICON_LG)
              .fontColor([this.cSecondary()])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭统计')
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%').alignItems(VerticalAlign.Center)

        // ── 正文（可滚）────────────────────────────────────────────────────────
        Scroll() {
          Column({ space: SPACE_XS }) {
            if (this.error.length > 0) {
              // 失败：一行红字 + 重试（判据与写法同 `PluginsSheet` 三态）
              Row() {
                Text(this.error)
                  .fontSize(typeOf('type.callout').size)
                  .fontColor(this.cDanger())
                  .layoutWeight(1)
                  .wordBreak(WordBreak.BREAK_ALL)
              }
              .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
              .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
              .backgroundColor(this.bgCard())
              .borderRadius(RADIUS_CARD)
              .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onRetry();
              })
            } else if (this.loading && !this.hasData()) {
              // 加载态 = 一行小字（⛔ 不是 spinner —— 全局同一时刻只允许一个在飞动效）
              Text('加载中…')
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.cMuted())
                .width('100%').padding(SPACE_SM)
            } else if (!this.hasData()) {
              Text('暂无数据')
                .fontSize(typeOf('type.callout').size)
                .fontColor(this.cSecondary())
                .width('100%').padding(SPACE_SM)
            } else {
              // ① 用量四联卡（输入 / 输出 / 缓存命中 / LLM 时长）—— **2 列 × 2 行**（对齐 web
              //    窄形态 `grid-cols-2`：4 列挤一行时副标题「命中率 87.6%」「11 迭代 · 6 轮次」
              //    会被省略号截断 —— 真机实测确认过）
              this.metricRow(overviewCells(this.stats).slice(0, 2))
              this.metricRow(overviewCells(this.stats).slice(2, 4))
              // ② 性能三联网（Avg TTFT / Avg TPOT / Avg tok/s）
              this.metricRow(perfCells(this.stats))
              // ③ 上下文水位 + 当前模型
              this.metricRow(contextCells(this.stats))

              // ④ 按模型（>1 个模型才显示 —— 判据在 core，与 web 同口径；**显式最多 3 槽，
              //    无 `ForEach`** —— 性能预算 ⑦ 的 ForEach 处数是全仓硬上限、只许减）
              if (byModelRows(this.stats).length > 1) {
                this.section('按模型')
                Column({ space: SPACE_XS }) {
                  this.modelCard(byModelRows(this.stats)[0])
                  if (byModelRows(this.stats).length > 1) {
                    this.modelCard(byModelRows(this.stats)[1])
                  }
                  if (byModelRows(this.stats).length > 2) {
                    this.modelCard(byModelRows(this.stats)[2])
                  }
                }.width('100%').alignItems(HorizontalAlign.Start)
              }

              // ⑤ 最近迭代明细（尾部最新 —— 判据在 core `recentRows`）
              //    **单 `Text` 等宽表**（行由 `\n` 分隔、列用空格对齐）⇒ 一行不留 `ForEach`：
              //    最多 60 行 × 7 列若逐行 `ForEach` 要 ~480 节点，单 Text 只 1 个。
              if (recentTableText(this.stats).length > 0) {
                this.section('最近迭代')
                Column({ space: SPACE_XXS }) {
                  Text(recentTableHeader())
                    .fontSize(typeOf('type.micro').size)
                    .fontFamily('monospace').fontColor(this.cMuted())
                    .width('100%')
                  Text(recentTableText(this.stats))
                    .fontSize(typeOf('type.micro').size)
                    .fontFamily('monospace').fontColor(this.cPrimary())
                    .width('100%')
                    .copyOption(CopyOptions.LocalDevice)
                }
                .width('100%')
                .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
                .backgroundColor(this.bgCard())
                .borderRadius(RADIUS_CARD)
                .alignItems(HorizontalAlign.Start)
              }
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({ bottom: SPACE_SM })
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.TopStart)
        .scrollBar(BarState.Auto)
        .edgeEffect(EdgeEffect.Spring)
        // 纵向滚动容器：横向不溢出（H0 判据针对横向 Scroll；此处补 clip 亦无害且更稳）
        .clip(true)
      }
      .width('92%')
      .height('78%')
      .padding(SPACE_MD)
      .backgroundColor(this.bgOverlay())
      .borderRadius(RADIUS_SHEET)
      .border({ width: STROKE_HAIRLINE, color: this.cHairline() })
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    .width('100%').height('100%')
    .backgroundColor(this.bgOverlay())
    .borderRadius(RADIUS_SHEET)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    // 出入场过渡：与全站浮层同一个工厂（⛔ 不自造第二套入场语言）。
    .transition(sheetTransition())
  }
}
