/**
 * CronDetailSheet —— **定时任务详情**（2026-10-13，目标④「任务管理做的很差」的最后一块）。
 *
 * ── 为什么必须有它（对标 web 权威）──────────────────────────────────────────
 * web `components/sidebar/TasksPanel.tsx:120-172`：cron 行是**可点开的**（`expandedCronID`），
 * 展开区给出「调度 / 下次运行 / 目标(channel:chatID) / ID」四字段；该文件里还留着一句用户报告
 * 原文 —— "电脑 cron 也无法点开看详情"。
 * 本仓此前：cron 行**点按只把一行摘要复制进剪贴板**（`copyText(...)`），既不像"可进入"
 * （行尾只有删除 X、没有 chevron），更要命的是 —— 主行是 `.maxLines(1)`
 * （`components/PanelRows.ets`），**多行提示词只剩第一行，正文永久不可见**。
 * ⇒ 本组件补上「消息全文 + 四字段（+ 创建时间）」这一个目的地。
 *
 * ── 分层铁律（同 `StatusSheet`/`TaskDetailSheet`）：组件**只画** ─────────────────
 * 所有字符串由页面用 `core/panels.ets` 的纯函数算好传入（`cronMessageText` / `scheduleText` /
 * `cronTargetText` / `fmtDateTime`）⇒ 列表行与详情页**判据同源**，不可能"行里说 A、详情说 B"。
 * 开关所有权留页面（`showCronDetail`），组件不发任何 RPC。
 *
 * ── 为什么详情里**没有**「删除」/「复制」按钮 ──────────────────────────────────
 * ① 删除：列表行尾部已有唯一的删除入口（`ROW_TRAIL_DELETE`）——同一动作两处入口是"两个按钮"的噪声；
 * ② 复制：消息正文挂了 `copyOption(CopyOptions.LocalDevice)`（长按即复制），
 *    比"整行点了只得到一行摘要"更精确、也不丢能力。
 *
 * ── 尺寸：**内容驱动**（与 `StatusSheet` 同形，⛔ 不写死高度）────────────────────
 * 任务详情（`TaskDetailSheet`）要一屏输出 ⇒ 固定 80%；cron 详情内容短 ⇒ 让它贴合内容：
 * 外层 `SHEET_WIDTH` + 内容撑高，只有**消息块**封顶 `CRON_MSG_MAX_H` 并自带滚动
 * （提示词可达数百字符，不封顶会把面板顶出屏幕）。
 *
 * ── 性能（`docs/PERF-BUDGET.md`）：本文件**只留 2 处**调色板读取点 ────────────────
 * 面板级读取走 `palOnce()`（记忆化），且 `skin()` 把 5 个色值**一次取齐并缓存**
 * （overlay/hair/card/rule/icon）⇒ 不随 build 次数增长读取点（门禁 `perf/guard.sh` B 线）。
 * 字段行（子组件）按本仓既有形态直接 `paletteOf(this.theme)`（同 `components/PanelRows.ets`）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY, RADIUS_CARD,
  SHEET_ACTION_GLYPH, SHEET_WIDTH, SPACE_HAIR, SPACE_MD, SPACE_SM, SPACE_XS, STROKE_HAIRLINE,
  structuralRuleOf, surfaceFillOf, SURFACE_CARD,
} from '../core/design';
import { fs, fw, lh } from './SettingsRows';
// 弹层开合过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造第二套入场语言）。
import { sheetTransition } from './anim';
import { t as i18nT } from '../core/i18n';

/** 消息块高度上限（vp）—— `SPACE_SM × 35` = 280：约三分之一屏，超出在其内滚动。 */
const CRON_MSG_MAX_H: number = SPACE_SM * 35;

/** 详情页一次取齐的视觉令牌（`skin()` 的返回值；见文件头「性能」段）。 */
interface CronSkin {
  /** 浮层根面填充（内层内容盒 = 外层卡本体，同一色）。 */
  overlay: string;
  /** 结构性发丝（L1 浮层描边）。 */
  hair: string;
  /** 消息块底（L2 内嵌卡）。 */
  card: string;
  /** L2 面到面轮廓（⛔ L2 卡不许走 L1 的 `hairlineOf`）。 */
  rule: string;
  /** 图标弱色（关闭 X；`iconMuted` 是**计算型**角色，只能走 `colorOf`）。 */
  icon: string;
  /** 正文/标题主色（标题 + 消息全文共用）。 */
  text: string;
}

/**
 * 详情的一行（真实 `@Component` + `@Prop`，与 `StatusSheet.StatusInfoRow` 同一形态）。
 * ⛔ 不用带参 `@Builder`：参数是"调用那一刻的快照"，响应更新的子树必须落到 `@Prop`（见 ARKTS-GOTCHAS）。
 */
@Component
struct CronFieldRow {
  @Prop theme: string = 'dark';
  @Prop label: string = '';
  /** 字段值（空串 ⇒ 显示 `—`，与 web 的 `|| '—'` 同口径）。 */
  @Prop value: string = '';
  /** 标识类值用等宽字（调度表达式 / 目标 / ID）。 */
  @Prop mono: boolean = false;

  build() {
    Row({ space: SPACE_XS }) {
      Text(this.label)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.callout'))
        .lineHeight(lh('type.callout'))
        .fontColor(paletteOf(this.theme).textSecondary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        // 横向约束：本 Text 在 Row 内、`label` 是**变量**（门禁 H1 硬红：可变文本必须有横向约束）
        .constraintSize({ maxWidth: '100%' })
      Text(this.value.length > 0 ? this.value : '—')
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.body'))
        .lineHeight(lh('type.callout'))
        .fontFamily(this.mono ? 'monospace' : '')
        .fontColor(paletteOf(this.theme).textPrimary)
        .layoutWeight(1)
        .textAlign(TextAlign.End)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

@Component
export struct CronDetailSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** 消息全文（页面 `cronMessageText(job)`；空串 ⇒ 不渲染消息块）。 */
  @Prop message: string = '';
  /** 调度（页面 `scheduleText(job)` + 一次性后缀）。 */
  @Prop schedule: string = '';
  /** 下次运行（页面 `fmtDateTime(job.next_run)`；空串 ⇒ 组件显示 `—`）。 */
  @Prop nextText: string = '';
  /** 目标（页面 `cronTargetText(job)`；空串 ⇒ `—`）。 */
  @Prop targetText: string = '';
  /** 创建时间（页面 `fmtDateTime(job.created_at)`；空串 ⇒ 整行不渲染）。 */
  @Prop createdText: string = '';
  /** 任务 ID（空串 ⇒ `—`）。 */
  @Prop idText: string = '';
  /** 关闭详情（页面置 `showCronDetail=false`）。⛔ 回调**不加** `@Prop`（V1 装饰器不许标函数类型）。 */
  onClose: () => void = () => {
  };

  /**
   * 记忆化：`paletteOf(...)` 在属性初始化器里求值只在构造那一次发生 ⇒ 主题切换不刷新（门禁 ⑥ 会抓）。
   * 本组件用 `palOnce()` + `skin()` 两条缓存覆盖全部读取点（共 2 处，见文件头「性能」段）。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';
  private skinCache: CronSkin | null = null;

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

  /** 5 个色值一次取齐并随主题缓存（`this.palOnce()` 只在这里出现 1 次）。 */
  private skin(): CronSkin {
    const c: CronSkin | null = this.skinCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const p: Palette = this.palOnce();
    const s: CronSkin = {
      overlay: surfaceFillOf(p, 'surface.overlay'),
      hair: hairlineOf(p),
      card: surfaceFillOf(p, SURFACE_CARD),
      rule: structuralRuleOf(p),
      icon: colorOf(p, 'iconMuted'),
      text: p.textPrimary,
    };
    this.skinCache = s;
    return s;
  }

  /** 双层柔影（C3 推广）；深浅两态由 `shadowLayersOf` 决定，组件不写第二套。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

  build() {
    Stack() {
      Column({ space: SPACE_SM }) {
        // ── 头部：标题 + 关闭 ────────────────────────────────────────────────
        Row({ space: SPACE_XS }) {
          Text(i18nT('定时任务'))
            .fontSize(fs('type.headline'))
            .fontWeight(fw('type.headline'))
            .fontColor(this.skin().text)
            .layoutWeight(1)
          // 关闭 X：⛔ 热区不靠 `responseRegion` 负偏移外扩（真机实测 SDK21 无效）⇒ 真实 44 布局盒。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark'))
              .fontSize(SHEET_ACTION_GLYPH)
              .fontColor([this.skin().icon])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('关闭定时任务详情'))
          .onClick(() => {
            this.onClose();
          })
        }.width('100%').alignItems(VerticalAlign.Center)

        // ── 消息全文（保留换行；封顶高度 + 其内滚动；长按可复制）──────────────────
        if (this.message.length > 0) {
          Scroll() {
            Text(this.message)
              .fontSize(fs('type.callout'))
              .fontWeight(fw('type.body'))
              .lineHeight(lh('type.callout'))
              .fontColor(this.skin().text)
              .width('100%')
              // 长提示词里可能有不可断行的超长 token（URL / 命令）⇒ 必须允许任意位置折行
              .wordBreak(WordBreak.BREAK_ALL)
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .constraintSize({ maxHeight: CRON_MSG_MAX_H })
          .align(Alignment.TopStart)
          .scrollBar(BarState.Auto)
          .edgeEffect(EdgeEffect.Spring)
          .padding(SPACE_SM)
          .backgroundColor(this.skin().card)
          .borderRadius(RADIUS_CARD)
          .border({ width: STROKE_HAIRLINE, color: this.skin().rule })
        }

        // ── 字段（调度 / 下次运行 / 目标 / [创建时间] / ID）──────────────────────
        Column({ space: SPACE_HAIR }) {
          CronFieldRow({ label: '调度', value: this.schedule, mono: true, theme: this.theme })
          CronFieldRow({ label: '下次运行', value: this.nextText, mono: false, theme: this.theme })
          CronFieldRow({ label: '目标', value: this.targetText, mono: true, theme: this.theme })
          if (this.createdText.length > 0) {
            CronFieldRow({ label: '创建时间', value: this.createdText, mono: false, theme: this.theme })
          }
          CronFieldRow({ label: 'ID', value: this.idText, mono: true, theme: this.theme })
        }.width('100%')
      }
      // 内层 = 内容盒（尺寸由内容撑开）；贴合层（near）挂在它上面。
      .width('100%')
      .padding(SPACE_MD)
      .backgroundColor(this.skin().overlay)
      .borderRadius(RADIUS_CARD)
      .border({ width: STROKE_HAIRLINE, color: this.skin().hair })
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    // 外层 = 卡片本体（承载宽度 + 环境层 far 柔影）；⛔ 不是 `100%×100%`（全屏不透明会盖住整屏聊天）。
    .width(SHEET_WIDTH)
    .backgroundColor(this.skin().overlay)
    .borderRadius(RADIUS_CARD)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    .transition(sheetTransition())
  }
}
