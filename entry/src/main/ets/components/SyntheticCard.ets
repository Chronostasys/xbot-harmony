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
import { Effects, effectsOf, Palette, paletteOf, shadowRadiusOf } from '../core/theme';
import { FS_BODY, FS_CAPTION, R_LG, R_XL, SP_1, SP_2, SP_3 } from '../core/tokens';
import {
  RADIUS_CHIP, SPACE_HAIR, SURFACE_CHIP, SURFACE_PILL, TYPE_CHIP,
  colorOf, hairlineOf, surfaceFillOf, typeOf,
} from '../core/design';
import {
  FORM_BG_TASK, FORM_GENERIC, FORM_INTERRUPT, FORM_SUBAGENT, SyntheticHints,
  formatDuration, parseSyntheticHints, syntheticBodyOf, syntheticContinuityOf, syntheticForm,
  syntheticKindOf, syntheticRoleOf, syntheticStatusOf, syntheticStatusRoleOf, syntheticSubject,
  syntheticTitleOf,
} from '../core/synthhints';

/** 头像直径（web `size-6` = 24px；手机端同号）。 */
const AVATAR: number = 24;

@Component
export struct SyntheticCard {
  /** 假工具（含 `name` / `tool_hints` / `summary` / `detail` / `label` / `elapsed_ms`）。 */
  @Prop tool: ToolProgress;
  @Prop theme: string = 'dark';
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
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
      SymbolGlyph($r('sys.symbol.dart_target')).fontSize(13).fontColor([this.kindColor()])
    } else if (this.form() === FORM_INTERRUPT) {
      SymbolGlyph($r('sys.symbol.paperplane_fill')).fontSize(13).fontColor([this.kindColor()])
    } else {
      SymbolGlyph($r('sys.symbol.rectangle_on_rectangle')).fontSize(13).fontColor([this.kindColor()])
    }
  }

  build() {
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
      if (this.body().length > 0) {
        Text(this.body())
          .fontSize(this.form() === FORM_BG_TASK ? FS_CAPTION : FS_BODY)
          .fontFamily(this.form() === FORM_BG_TASK ? 'monospace' : 'sans-serif')
          .fontColor(this.form() === FORM_BG_TASK ? this.pal().textSecondary : this.pal().textPrimary)
          .width('100%')
          .wordBreak(WordBreak.BREAK_WORD)
          .textAlign(TextAlign.Start)
          .copyOption(CopyOptions.LocalDevice)
      } else {
        Text('历史记录未包含结构化详情')
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
          .wordBreak(WordBreak.BREAK_WORD)
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
    .border({ width: 1, color: hairlineOf(this.pal()) })
    // 中性柔影（`elev1` 深浅均**中性** ⇒ 白底不出彩色脏影；与 1ae9def/2ba1b67 同口径）
    .shadow({ radius: shadowRadiusOf(this.pal(), 'card'), color: this.eff().elev1, offsetX: 0, offsetY: 2 })
  }
}
