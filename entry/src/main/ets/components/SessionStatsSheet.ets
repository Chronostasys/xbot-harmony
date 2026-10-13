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
import { ByModelRow, DailyRow, DailyUsage, SessionUsage, StatCell, UsageBucket, UserUsage, byModelRows, contextCells, dailyRows, granularityLabel, granularityOptions, hasUserUsage, overviewCells, perfCells, recentTableHeader, recentTableText, trendSparkline, trendSummaryText, trendWindowText, userCells } from '../core/sessionstats';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, ICON_MD, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY,
  RADIUS_CARD, RADIUS_CHIP, RADIUS_SHEET, SHEET_ACTION_GLYPH, SPACE_MD, SPACE_SM, SPACE_XS, SPACE_XXS, STROKE_HAIRLINE,
  structuralRuleOf,
  SHEET_WIDTH, SURFACE_CARD, surfaceFillOf, typeOf,
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
  // ── 15i：web 面板有而原生此前缺的三块（目标④「统计插件的面板我们看不到」）──────────
  /** 用户累计（RPC `get_user_token_usage`；全 0 ⇒ 该块不渲染）。 */
  @Prop user: UserUsage = new UserUsage();
  /** 按日明细（已按日聚合，新 → 旧）。 */
  @Prop daily: DailyUsage[] = [];
  /** 趋势桶（按时间升序）。 */
  @Prop buckets: UsageBucket[] = [];
  /** 趋势粒度（`minute`/`hour`/`day`）。 */
  @Prop granularity: string = 'hour';
  /** 切换粒度（页面据此只重拉桶）。 */
  onGranularity: (g: string) => void = (g: string) => {
  };
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

  /**
   * 卡片底（L2 内嵌卡的面）。
   *
   * ⛔ **必须配 `.border({ width: STROKE_HAIRLINE, color: this.cStructural() })`** ——
   *    `surface.card` 与面板自身的面 `surface.overlay` **同属 `RUNG_CARD`**
   *    （`core/design.ets:345-346`：两者都 `fillOfRung(p, RUNG_CARD)`）⇒ **填充色逐字节相同**。
   *    所以"设了底色"本身**不足以**让卡片可见：缺那条结构性发丝时，卡片在面板底上**完全隐形**。
   *    真机像素实测（2026-10-13，s_stats）：卡内 / 卡间隙 / 面板底 三点同为 `(13,15,20)`，
   *    面板读作"一墙数字"而非"一组指标卡"。
   *    ⇒ 本组件所有 `bgCard()` 处**一律**加 `this.cStructural()` 立边（全仓同层级卡同通道：
   *    `PanelRows`/`SelfCheckSheet`/`QueueSheet`/`CronDetailSheet`/`SettingsPanel`/`PluginsSheet`）。
   */
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
    // L2 卡立边（⛔ 必需 —— 缺它卡片在面板底上不可见，见 `bgCard()` 注释）
    .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
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

  // ── 15i 新增三块的构造器（趋势 / 累计 / 按日）───────────────────────────────────

  /** 强调色（趋势 sparkline 用；数据可视化取强调色，与顶栏/发送键同一语义）。 */
  private cAccent(): string {
    return colorOf(this.palOnce(), 'accent');
  }

  /** 趋势 sparkline（判据在 core `trendSparkline`；空 ⇒ 空串 ⇒ 不渲染该块）。 */
  private sparkText(): string {
    return trendSparkline(this.buckets, this.granularity);
  }

  /** 趋势小结（`合计 … · 活跃 x/y 桶 · 峰值 …`）。 */
  private sparkMeta(): string {
    return trendSummaryText(this.buckets, this.granularity);
  }

  /** 「按日」行（最多 5 天，新 → 旧；显式槽位，无 `ForEach`）。 */
  private dayRows(): DailyRow[] {
    return dailyRows(this.daily, 5);
  }

  /** 粒度芯片（选中 = 强调底色 + 对比前景；**热区 ≥44 由 Row 布局盒承载**）。 */
  @Builder
  granChip(g: string) {
    Text(granularityLabel(g))
      .fontSize(typeOf('type.caption').size)
      .fontColor(this.granularity === g ? colorOf(this.palOnce(), 'onAccent') : this.cSecondary())
      .textAlign(TextAlign.Center)
      .width(56).height(HIT_TARGET_MIN)
      .backgroundColor(this.granularity === g ? this.cAccent() : this.bgCard())
      .borderRadius(RADIUS_CHIP)
      .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(`趋势粒度 ${granularityLabel(g)}`)
      .onClick(() => {
        this.onGranularity(g);
      })
  }

  /** 一行「按日」（日期 | 总量 | 元信息）。 */
  @Builder
  dayCard(r: DailyRow) {
    Row({ space: SPACE_SM }) {
      Text(r.day)
        .fontSize(typeOf('type.caption').size)
        .fontFamily('monospace').fontColor(this.cSecondary())
        .width(56)
      Text(r.total)
        .fontSize(typeOf('type.caption').size).fontWeight(typeOf('type.caption').weight)
        .fontFamily('monospace').fontColor(this.cPrimary())
        .layoutWeight(1)
      Text(r.meta)
        .fontSize(typeOf('type.micro').size)
        .fontColor(this.cMuted())
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.End)
        .layoutWeight(2)
    }
    .width('100%').alignItems(VerticalAlign.Center)
    .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(this.bgCard())
    .borderRadius(RADIUS_CARD)
    // L2 卡立边（⛔ 必需 —— 缺它卡片在面板底上不可见，见 `bgCard()` 注释）
    .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
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
    // L2 卡立边（⛔ 必需 —— 缺它卡片在面板底上不可见，见 `bgCard()` 注释）
    .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
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
              .fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.palOnce(), 'iconMuted')])
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
              // 空态（2026-10-13 对标 Apple）：字形 + 说明。⚠️ 本处**在 `Scroll` 内** ⇒ 不做
              // 垂直居中（`layoutWeight` 对 Scroll 子项无意义），只统一"字形 + 居中文字"形态。
              Column({ space: SPACE_SM }) {
                SymbolGlyph($r('sys.symbol.square_grid_2x2'))
                  .fontSize(typeOf('type.display').size)
                  // ⛔ 图标弱色走 `colorOf(p,'iconMuted')`（非文本档 ≥3）。
                  .fontColor([colorOf(this.palOnce(), 'iconMuted')])
                Text('暂无数据')
                  .fontSize(typeOf('type.subhead').size)
                  .fontColor(this.cSecondary())
                  .width('100%')
                  // ⚠️ 2026-10-13（目标③「对标苹果」·真机逐像素量测）：原**缺**这一行 ⇒ 字形被
                  //    容器 `alignItems(Center)` 居中、而文字 `width('100%')` 默认**左对齐**
                  //    （真机实测：字形中心 **660px**、主行中心 **237px**、提示行 **433px**
                  //    —— 同一个空态两套对齐，读作"渲染错位"）。本行与自身注释"字形 + **居中文字**"
                  //    冲突，属**实现与注释相反**。修法 = 与 `StatusSheet` 空态同口径（那边是对的）。
                  .textAlign(TextAlign.Center)
                // S2（对标 Apple 空态层级）：补**提示行**（怎么说才会有）——与运行面板 `PanelEmpty` 同形。
                // ⚠️ 走既有 memo 入口 `this.cMuted()`（其内部已是 `palOnce()`）⇒ **不新增**读取点。
                Text('本会话产生用量后会显示在这里')
                  .fontSize(typeOf('type.caption').size)
                  .fontColor(this.cMuted())
                  .width('100%')
                  .textAlign(TextAlign.Center)
              }
              .width('100%').padding(SPACE_SM)
              .alignItems(HorizontalAlign.Center)
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
                // L2 卡立边（⛔ 必需 —— 缺它卡片在面板底上不可见，见 `bgCard()` 注释）
                .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
                .alignItems(HorizontalAlign.Start)
              }

              // ⑥ 趋势（sparkline + 粒度分段控件）—— 判据在 core `trendSparkline`/`trendSummaryText`
              //    ⛔ 不画柱、不用 `ForEach`：单 `Text` 承载 8 级块字符（性能预算 ⑦ 约束）。
              if (this.sparkText().length > 0) {
                this.section(`token 趋势 · ${trendWindowText(this.granularity)}`)
                Column({ space: SPACE_XS }) {
                  Row({ space: SPACE_XS }) {
                    this.granChip(granularityOptions()[0])
                    this.granChip(granularityOptions()[1])
                    this.granChip(granularityOptions()[2])
                    Blank()
                  }
                  .width('100%')

                  Text(this.sparkText())
                    .fontSize(typeOf('type.callout').size)
                    .fontFamily('monospace')
                    .fontColor(this.cAccent())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')

                  if (this.sparkMeta().length > 0) {
                    Text(this.sparkMeta())
                      .fontSize(typeOf('type.micro').size)
                      .fontColor(this.cMuted())
                      .maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                  }
                }
                .width('100%').alignItems(HorizontalAlign.Start)
                .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
                .backgroundColor(this.bgCard())
                .borderRadius(RADIUS_CARD)
                // L2 卡立边（⛔ 必需 —— 缺它卡片在面板底上不可见，见 `bgCard()` 注释）
                .border({ width: STROKE_HAIRLINE, color: this.cStructural() })
              }

              // ⑦ 用户累计（全 0 ⇒ 不渲染空卡）
              if (hasUserUsage(this.user)) {
                this.section('累计')
                this.metricRow(userCells(this.user))
              }

              // ⑧ 按日（最多 5 天；显式槽位 ⇒ 无 `ForEach`）
              if (this.dayRows().length > 0) {
                this.section('按日')
                Column({ space: SPACE_XS }) {
                  this.dayCard(this.dayRows()[0])
                  if (this.dayRows().length > 1) {
                    this.dayCard(this.dayRows()[1])
                  }
                  if (this.dayRows().length > 2) {
                    this.dayCard(this.dayRows()[2])
                  }
                  if (this.dayRows().length > 3) {
                    this.dayCard(this.dayRows()[3])
                  }
                  if (this.dayRows().length > 4) {
                    this.dayCard(this.dayRows()[4])
                  }
                }.width('100%').alignItems(HorizontalAlign.Start)
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
      // 内层 = 卡片**内容盒**（100% 填满外层卡）；**尺寸由外层承载** —— 与 `PluginsSheet`/`StatusSheet` 同结构。
      .width('100%')
      .height('100%')
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
    // 外层 = **卡片本体**（承载尺寸 + far 环境影）；⛔ 不能是 `100%×100%` —— 实测「统计」面板曾因
    //   外层全屏不透明（`bgOverlay`）把聊天整屏盖住、far 柔影落在屏幕边缘，与 `PluginsSheet` 的
    //   「居中浮动卡 + 背后可见聊天」观感不一致（本轮真机复现并修）。
    .width(SHEET_WIDTH).height('78%')
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
