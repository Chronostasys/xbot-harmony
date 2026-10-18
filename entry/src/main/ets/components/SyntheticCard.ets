/**
 * SyntheticCard —— 注入型「假工具」通知的卡片（对齐 web
 * `components/agent/SyntheticToolCard.tsx` 的 `SyntheticToolCard` + `InterruptCard`）。
 *
 * ⛔ **判据与渲染同源**：本文件**不做任何** kind/形态判断 —— 全部走 `core/synthhints.ets`
 *   的纯函数（`syntheticKindOf` / `syntheticForm` / `syntheticRoleOf` / `syntheticTitleOf`
 *   / `syntheticSubject` / `syntheticBodyOf`）。颜色**零字面量**：`colorOf` / `surfaceFillOf`
 *   / `hairlineOf`。本文件**无任何动效**（发光体只允许光球一枚，见 `docs/DESIGN-SYSTEM.md §8`）
 *   ⇒ 自然满足「浅色不得出现彩色脏光晕」。
 *
 * 形态（`syntheticForm`）：
 *   · 专用 3 种：`bg_task`（终端输出）/ `subagent`（子代理）/ `interrupt`（用户插话）；
 *   · 通用变体：其余已知 + 任何未知 kind —— 中性配色 + 中性标题，**绝不白板/错位/崩**。
 *
 * ⛔ 必须是 **@Component + @Prop**（不是带参 @Builder）：卡片内容随工具对象变化，
 *   带参 @Builder 的子树不随参数重建（`docs/ARKTS-GOTCHAS.md §4`）。
 */
import { ToolProgress } from '../core/types';
import { Effects, effectsOf, Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { AnsiSpan, ansiBgOf, ansiFgOf, ansiPaletteOf, ansiSpansIfAny, hasAnsi } from '../core/ansi';
import { FS_BODY, FS_CAPTION, R_LG, R_XL, SP_1, SP_2, SP_3 } from '../core/tokens';
import {
  RADIUS_CHIP, SPACE_HAIR, SURFACE_CHIP, SURFACE_PILL, TYPE_CHIP,
  colorOf, hairlineOf, structuralRuleOf, STROKE_HAIRLINE, surfaceFillOf, typeOf, MARKER_GLYPH, PRESS_OPACITY } from '../core/design';
import {
  FORM_BG_TASK, FORM_GENERIC, FORM_INTERRUPT, FORM_SUBAGENT, SyntheticHints,
  formatDuration, parseSyntheticHints, syntheticBodyOf, syntheticContinuityOf, syntheticForm,
  syntheticKindOf, syntheticRoleOf, syntheticStatusOf, syntheticStatusRoleOf, syntheticSubject,
  syntheticTitleOf,
} from '../core/synthhints';
import { t as i18nT } from '../core/i18n';

/** 头像直径（web `size-6` = 24px；手机端同号）。 */
const AVATAR: number = 24;
/**
 * 正文折叠阈值（字符数）—— 对齐 web `SyntheticToolCard.tsx:426` 的 `clipped = body.length > 1500`。
 * ⛔ 用户亲报：默认把完整内容一次性渲染 ⇒ 卡片占屏过高。改成**默认折叠 + 点击展开**。
 */
const CLIP_CHARS: number = 1500;
/** 折叠态可视高（vp）—— 对齐 web `max-h-24`（96px）。 */
const CLIP_H: number = 120;
/** 展开态可视高（vp）—— 对齐 web `max-h-[420px]`。 */
const EXPANDED_H: number = 420;

@Component
export struct SyntheticCard {
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') localeStamp: string = '';
  /** 假工具（含 `name` / `tool_hints` / `summary` / `detail` / `label` / `elapsed_ms`）。 */
  @Prop tool: ToolProgress;
  @Prop theme: string = 'dark';
  /**
   * **生效主题的全局订阅**（§21.124 用户亲报「切主题后老文字颜色不变、新的才变」）。
   *
   * ⛔ 本组件挂在 `MessageRow` 的**带参 `@Builder` 子树**（`AssistantBlock(this.row)`）里 ——
   *   该子树在主题变化时**不重建**（参数是同一个 `ChatRow` 引用 ⇒ ArkUI V1 判「参数没变」，
   *   见 `docs/ARKTS-GOTCHAS.md §4/§37`）⇒ 子树里组件在**创建那刻**拿到的 `@Prop theme`
   *   会**永久冻结**（旧块停旧色板、新建块才用新色板 = 用户看到的「老的不变、新的才变」）。
   * ✅ 正解 = 本仓范式（同 `MessageRow.themeId()` / `MarkdownView`）：**组件自己订阅**
   *   `AppStorage('appTheme')` ⇒ 主题变更直接驱动本组件重绘，不经父级投递。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** 生效主题：全局订阅优先，`@Prop theme` 仅兜底（同 `MessageRow.themeId()`）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };
  /**
   * 正文是否展开 —— **默认折叠**（对齐 web `SyntheticToolCard.tsx:345/396` 的 `useState(false)`）。
   * ⛔ 用户亲报：subagent 完成等通知默认把完整内容一次性渲染 ⇒ 卡片占屏过高。
   */
  @State private open: boolean = false;

  /** 正文是否需要折叠（字符数超阈值 —— 同 web `clipped`）。 */
  private clipped(): boolean {
    return this.body().length > CLIP_CHARS;
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  private rawHints(): string {
    return this.tool.tool_hints !== undefined ? this.tool.tool_hints : '';
  }

  private hints(): SyntheticHints | null {
    return parseSyntheticHints(this.rawHints());
  }

  /** kind → 形态（唯一判据在 `core/synthhints.syntheticForm`）。 */
  private form(): string {
    return syntheticForm(syntheticKindOf(this.tool.name, this.rawHints()));
  }

  private kind(): string {
    return syntheticKindOf(this.tool.name, this.rawHints());
  }

  /** 种类主色（= 语义 role → 色板；零字面量）。 */
  private kindColor(): string {
    return colorOf(this.pal(), syntheticRoleOf(this.kind()));
  }

  private title(): string {
    return syntheticTitleOf(this.kind());
  }

  private subject(): string {
    const label: string = this.tool.label !== undefined ? this.tool.label : '';
    return syntheticSubject(this.tool.name, this.hints(), label);
  }

  /** 归一化后的 status（`cancel` 无显式 status 时视为 cancelled —— 对齐 web `:404`）。 */
  private statusRaw(): string {
    const h: SyntheticHints | null = this.hints();
    let st: string = h !== null ? h.status : '';
    if (st.length === 0 && this.kind() === 'cancel') { st = 'cancelled'; }
    return st;
  }

  private statusLabel(): string {
    return syntheticStatusOf(this.statusRaw());
  }

  private statusColor(): string {
    const role: string = syntheticStatusRoleOf(this.statusRaw());
    return role.length > 0 ? colorOf(this.pal(), role) : this.pal().textMuted;
  }

  private body(): string {
    const detail: string = this.tool.detail !== undefined ? this.tool.detail : '';
    const summary: string = this.tool.summary !== undefined ? this.tool.summary : '';
    return syntheticBodyOf(this.hints(), detail, summary);
  }

  /** 正文底色（无显式前景色的 span 继承它）—— 与纯文本路径**同源**。 */
  private bodyColor(): string {
    return this.form() === FORM_BG_TASK ? this.pal().textSecondary : this.pal().textPrimary;
  }

  /** ANSI 16 色（按 theme 记忆化）—— 颜色**零字面量**，全走 `ansiPaletteOf(pal)`。 */
  private ansiTheme: string = '';
  private ansiPal: string[] = [];

  private ansiColors(): string[] {
    if (this.ansiTheme !== this.themeId()) {
      this.ansiTheme = this.themeId();
      this.ansiPal = ansiPaletteOf(this.pal());
    }
    return this.ansiPal;
  }

  /**
   * 正文的 **ANSI span**（注入型假工具的 `output`/`message` 也可能带终端 SGR 颜色码）。
   * ⛔ **判据与渲染同源**：`ansiSpansIfAny` = `hasAnsi` + `parseAnsi` 同一纯函数（`core/ansi` 唯一入口，
   * 组件**不另写** ANSI 判断）；**颜色零字面量**（取色走 `ansiFgOf`/`ansiBgOf` + 色板）。
   */
  private bodySpans(): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(this.body(), this.ansiColors());
    return s !== null ? s : [];
  }

  private errorText(): string {
    const h: SyntheticHints | null = this.hints();
    return h !== null ? h.error : '';
  }

  private hasExit(): boolean {
    const h: SyntheticHints | null = this.hints();
    return h !== null && h.hasExit;
  }

  private exitCode(): number {
    const h: SyntheticHints | null = this.hints();
    return h !== null ? h.exitCode : 0;
  }

  private elapsed(): string {
    const h: SyntheticHints | null = this.hints();
    const ms: number = (h !== null && h.elapsedMs > 0)
      ? h.elapsedMs : (this.tool.elapsed_ms !== undefined ? this.tool.elapsed_ms : 0);
    return formatDuration(ms);
  }

  /**
   * 卡片**真实底色** —— 既是卡面 `backgroundColor`，也是 ANSI 取色的默认背景 `defBg`。
   * ⛔ 不能传 `transparent`：反色（SGR 7）会把它当作"字色" ⇒ 文字透明不可见。
   */
  private cardBgC(): string {
    return surfaceFillOf(this.pal(), SURFACE_PILL);
  }

  /** 小徽标（等宽小字 + chip 底）—— subject / 状态 / 退出码 / 耗时共用。 */
  @Builder
  Chip(text: string, color: string) {
    Text(text)
      .fontSize(typeOf(TYPE_CHIP).size)
      .fontColor(color)
      .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CHIP))
      .padding({ left: SP_1, right: SP_1, top: SPACE_HAIR, bottom: SPACE_HAIR })
      .borderRadius(RADIUS_CHIP)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }

  /** 头像图标（按形态选**仓内已证存在**的符号；未知形态 ⇒ 中性方块）。 */
  @Builder
  KindIcon() {
    if (this.form() === FORM_BG_TASK) {
      SymbolGlyph($r('sys.symbol.doc_text')).fontSize(13).fontColor([this.kindColor()])
    } else if (this.form() === FORM_SUBAGENT) {
      SymbolGlyph($r('sys.symbol.dart_target')).fontSize(MARKER_GLYPH).fontColor([this.kindColor()])
    } else if (this.form() === FORM_INTERRUPT) {
      SymbolGlyph($r('sys.symbol.paperplane_fill')).fontSize(MARKER_GLYPH).fontColor([this.kindColor()])
    } else {
      SymbolGlyph($r('sys.symbol.rectangle_on_rectangle')).fontSize(MARKER_GLYPH).fontColor([this.kindColor()])
    }
  }

  /** 本卡的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private cardLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'card');
  }

  /** 正文内容（ANSI 着色 / 纯文本两分支）—— 抽出为 @Builder：折叠/展开两条路复用同一内容。 */
  @Builder
  BodyContent() {
    if (hasAnsi(this.body())) {
      // 含终端 SGR 颜色码 ⇒ 逐 span 上色（对齐 web `AnsiText.tsx:205` 的消费点；
      // `core/ansi` 唯一入口、判据与渲染同源、颜色零字面量）。
      Text() {
        ForEach(this.bodySpans(), (sp: AnsiSpan, si: number) => {
          Span(sp.text)
            .fontSize(this.form() === FORM_BG_TASK ? FS_CAPTION : FS_BODY)
            .fontColor(ansiFgOf(sp, this.bodyColor(), this.cardBgC()))
            .fontWeight(sp.bold ? FontWeight.Bold : FontWeight.Normal)
            .fontStyle(sp.italic ? FontStyle.Italic : FontStyle.Normal)
            .decoration({
              type: sp.strike ? TextDecorationType.LineThrough
                : (sp.underline ? TextDecorationType.Underline : TextDecorationType.None),
              color: ansiFgOf(sp, this.bodyColor(), this.cardBgC()),
            })
            .textBackgroundStyle({ color: ansiBgOf(sp, this.bodyColor(), this.cardBgC()) })
        }, (sp: AnsiSpan, si: number) => `sb${si}`)
      }
      .fontSize(this.form() === FORM_BG_TASK ? FS_CAPTION : FS_BODY)
      .fontFamily(this.form() === FORM_BG_TASK ? 'monospace' : 'sans-serif')
      .fontColor(this.bodyColor())
      .width('100%')
      .wordBreak(WordBreak.BREAK_ALL)
      .textAlign(TextAlign.Start)
      .copyOption(CopyOptions.LocalDevice)
    } else {
      Text(this.body())
        .fontSize(this.form() === FORM_BG_TASK ? FS_CAPTION : FS_BODY)
        .fontFamily(this.form() === FORM_BG_TASK ? 'monospace' : 'sans-serif')
        .fontColor(this.form() === FORM_BG_TASK ? this.pal().textSecondary : this.pal().textPrimary)
        .width('100%')
        .wordBreak(WordBreak.BREAK_ALL)
        .textAlign(TextAlign.Start)
        .copyOption(CopyOptions.LocalDevice)
    }
  }

  build() {
    // ── 多层柔影（C3）：`shadowLayersOf` 恒返 [near, far] ──────────────────────────────
    // 浅色：near = 贴合影（小半径/1vp）、far = 环境影（大半径）⇒ 苹果式"落在纸面上"的层次；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()`（`common.d.ts:21070`）⇒ 外层 Stack 承载 far。
    Stack() {
      Column({ space: SP_2 }) {
      // ── 头部：头像 + 标题 + 徽标行 ────────────────────────────────────────────
      Row({ space: SP_2 }) {
        Stack() {
          Circle().width(AVATAR).height(AVATAR).fill(surfaceFillOf(this.pal(), SURFACE_CHIP))
          this.KindIcon()
        }
        .width(AVATAR).height(AVATAR)
        .flexShrink(0)

        Column({ space: SPACE_HAIR }) {
          Text(this.title())
            .fontSize(FS_BODY)
            .fontColor(this.pal().textPrimary)
            .fontWeight(FontWeight.Medium)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          Row({ space: SP_1 }) {
            if (this.subject().length > 0) {
              this.Chip(this.subject(), this.pal().textSecondary)
            }
            if (this.statusLabel().length > 0) {
              this.Chip(this.statusLabel(), this.statusColor())
            }
            if (this.hasExit()) {
              this.Chip(`退出码 ${this.exitCode()}`,
                this.exitCode() !== 0 ? this.pal().dangerText : this.pal().textMuted)
            }
            if (this.elapsed().length > 0) {
              this.Chip(this.elapsed(), this.pal().textMuted)
            }
          }
          .width('100%').flexShrink(1)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      // ── 承接说明：明确"这是此前就在跑的东西，现在结束了"（对齐 web `:486-488`）──────
      Text(syntheticContinuityOf(this.kind()))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')
        .wordBreak(WordBreak.BREAK_WORD)

      // ── 正文：结构化 output/message 优先；无 ⇒ 坦白说明（绝不空卡）────────────────
      // ⚡ 2026-10-20：**默认折叠**（对齐 web `clipped = body.length > 1500` + `max-h-24`）——
      //   用户亲报「subagent 完成等通知默认把完整内容一次性渲染 ⇒ 占屏过高」。
      //   折叠态：`clip` 到 CLIP_H；展开态：`Scroll`（`max-h-[420px]`）；点击「显示更多」切换。
      if (this.body().length > 0) {
        if (this.clipped() && !this.open) {
          Column() {
            this.BodyContent()
          }
          .constraintSize({ maxHeight: CLIP_H })
          .clip(true)
          .width('100%')
        } else if (this.clipped()) {
          Scroll() {
            this.BodyContent()
          }
          .constraintSize({ maxHeight: EXPANDED_H })
          .scrollBar(BarState.Auto)
          .width('100%')
          .align(Alignment.TopStart)
        } else {
          this.BodyContent()
        }
        if (this.clipped()) {
          Row({ space: 2 }) {
            Text(this.open ? '收起' : '显示更多')
              .fontSize(typeOf(TYPE_CHIP).size)
              .fontColor(this.pal().accentText)
            SymbolGlyph(this.open ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
              .fontSize(MARKER_GLYPH)
              .fontColor([this.pal().accentText])
          }
          .padding({ top: SPACE_HAIR })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.open = !this.open;
          })
        }
      } else {
        Text(i18nT('历史记录未包含结构化详情'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }

      // ── 错误段（对齐 web `:545-551`，红色段）────────────────────────────────
      if (this.errorText().length > 0) {
        Text(this.errorText())
          .fontSize(FS_CAPTION)
          .fontFamily('monospace')
          .fontColor(this.pal().dangerText)
          .width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
          .padding(SP_2)
          .backgroundColor(this.pal().dangerBg)
          .borderRadius(R_LG)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SP_3)
    // 卡片面 = 浮起面（`surface.pill`）+ 结构性发丝边界（浅色系"浮起"的承载）
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_PILL))
    .borderRadius(R_XL)
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
      // 贴合层（near）：浅色 = `elev1` 小半径贴合影（"接触影"）；深色 = 透明（不渲染 ⇒ 净观感不变）
      .shadow({
        radius: this.cardLayers()[0].radius,
        color: this.cardLayers()[0].color,
        offsetX: 0, offsetY: this.cardLayers()[0].offsetY,
      })
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev1` + 原半径/偏移，逐字节不变）
    .width('100%')
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_PILL))
    .borderRadius(R_XL)
    .shadow({
      radius: this.cardLayers()[1].radius,
      color: this.cardLayers()[1].color,
      offsetX: 0, offsetY: this.cardLayers()[1].offsetY,
    })
  }
}
