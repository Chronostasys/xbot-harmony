/**
 * SubAgentTree — SubAgent 进度树（web `web/src/components/agent/SubAgentProgressTree.tsx` 同构）。
 *
 * ── 为什么是"扁平行数组"而不是树 ────────────────────────────────────────────────
 *   ArkUI 的 `@Component.build()` **不能递归**（组件无法自引用）⇒ 嵌套树必须由
 *   `core/subagent.ets:flattenSubAgents` **预展平**成带 `depth` 的一维行，再用一维 `ForEach`
 *   渲染。展平 + 可见性过滤 + 状态归档全在纯逻辑里（可脱机单测），本组件只"照着画"。
 *
 * ── 形态（以 web 为准）─────────────────────────────────────────────────────────
 *   · 深度 0 = **卡片**：左侧 2px 状态竖条 + 1px `border/50` 描边 + `bg-secondary/50` 底
 *     + `rounded-lg`；`web :107-118`
 *   · 深度 ≥1 = **子行**：虚线左边框 + 缩进（web `ml-3 pl-3`），无卡片 chrome；`web :156`
 *   · 状态图标：running → Sparkles(accent) / done → Check(muted) / error → AlertCircle(destructive)
 *     / 其它 → Sparkles(muted)；`web :127-135`（原生按 AGENTS「无 sparkles」用 `lightbulb`）
 *   · 竖条配色：running→accent、done→accent@30%、error→`--destructive`(= `--status-error`)；`web :95-99`
 *   · 标签 `role:instance`（`text-xs font-medium`）+ 描述单行截断（`text-text-muted`）；`web :138-151`
 *   · 顶层间距 `gap-1.5`（6vp）；`web :71`
 *
 * ⛔ 会变的行内容走**真 `@Component` + `@Prop`**（禁带参 @Builder）；`ForEach` 的 key 取
 *   `SubAgentRow.key`（= 身份 + 内容指纹，见 `core/subagent.ets` 的说明）—— ArkUI key 不变
 *   则不重建该项，key 不含内容会让状态图标/描述卡在首帧（ARKTS-GOTCHAS §3）。
 * ⛔ 颜色只用 `pal()` 语义色；尺度只用 `core/tokens.ets`。**禁硬编码 hex / 时长**。
 */
import { Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, R_LG, SP_1 } from '../core/tokens';
import { withAlpha } from '../core/bubble';
import {
  SUB_DONE, SUB_ERROR, SUB_RUNNING, SubAgentRow,
} from '../core/subagent';

/** 卡片内边距（web `py-1.5 pl-2.5 pr-2`）。 */
const CARD_PAD_L: number = 10;
const CARD_PAD_R: number = 8;
const CARD_PAD_Y: number = 6;
/** 卡片描边不透明度（web `border-border/50`）与底色不透明度（web `bg-bg-secondary/50`）。 */
const CARD_BORDER_ALPHA: number = 0.5;
const CARD_BG_ALPHA: number = 0.5;
/** 左侧状态竖条宽度（web `w-[2px]`）与 done 态的 accent 透明度（web `accent 30%`）。 */
const BAR_W: number = 2;
const BAR_DONE_ALPHA: number = 0.3;
/** 子行缩进（web `ml-3 pl-3` = 12 + 12）与图标边长（web `size-3.5`/`size-3`）。 */
const CHILD_INDENT: number = 12;
const ICON_TOP: number = 14;
const ICON_CHILD: number = 12;
/** 顶层行间距（web `gap-1.5`）。 */
const ROW_GAP: number = 6;
/** 图标-文字间距（web `gap-1.5`）。 */
const ICON_GAP: number = 6;

/**
 * 一行（深度 0 = 卡片；深度 ≥1 = 子行）。
 *
 * ⛔ 独立 `@Component` + `@Prop`（不是带参 @Builder）：`kind`/`desc` 变化必须驱动重渲染。
 */
@Component
struct SubAgentRowView {
  @Prop depth: number = 0;
  @Prop label: string = '';
  @Prop desc: string = '';
  /** 状态档（`SUB_*`，由 `core/subagent.ets:subStatusKind` 归一）。 */
  @Prop kind: string = 'other';
  /** 是否可点开（`sessionKey` 非空且有宿主回调）。 */
  @Prop openable: boolean = false;
  @Prop theme: string = 'dark';
  onOpen: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** running/other → accent；done → accent@30%；error → statusError（web `--destructive`）。 */
  private barColor(): string {
    if (this.kind === SUB_ERROR) {
      return this.pal().statusError;
    }
    if (this.kind === SUB_DONE) {
      return withAlpha(this.pal().accent, BAR_DONE_ALPHA);
    }
    return this.pal().accent;
  }

  /** 图标：running→lightbulb(accent) / done→checkmark(muted) / error→xmark_circle_fill(error)。 */
  private iconRes(): Resource {
    if (this.kind === SUB_DONE) {
      return $r('sys.symbol.checkmark');
    }
    if (this.kind === SUB_ERROR) {
      return $r('sys.symbol.xmark_circle_fill');
    }
    return $r('sys.symbol.lightbulb');
  }

  /** 图标色：只有 running 与 error 用强调/危险色，其余 muted（web `:127-135`）。 */
  private iconColor(): string {
    if (this.kind === SUB_ERROR) {
      return this.pal().statusError;
    }
    if (this.kind === SUB_RUNNING) {
      return this.pal().accent;
    }
    return this.pal().textMuted;
  }

  private isChild(): boolean {
    return this.depth > 0;
  }

  build() {
    Row({ space: ICON_GAP }) {
      SymbolGlyph(this.iconRes())
        .fontSize(this.isChild() ? ICON_CHILD : ICON_TOP)
        .fontColor([this.iconColor()])
      Text(this.label)
        .fontSize(FS_CAPTION)                      // web `text-xs`
        .fontWeight(FontWeight.Medium)             // web `font-medium`
        .fontColor(this.kind === SUB_RUNNING ? this.pal().accent : this.pal().textSecondary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.desc.length > 0) {
        Text(this.desc)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL)         // 长参数/长路径不撑破（ARKTS-GOTCHAS §15）
          .layoutWeight(1)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    // ── 深度 0：卡片（左侧 2px 状态竖条 + 其余 1px 描边；web 是 absolute 竖条 + 1px 全边框，
    //    用**逐边边框**表达等价视觉，少一层节点）──────────────────────────────────────
    .padding(this.isChild()
      ? { left: CHILD_INDENT, top: 2, bottom: 2 }                    // 子行：只留左缩进
      : { left: CARD_PAD_L, right: CARD_PAD_R, top: CARD_PAD_Y, bottom: CARD_PAD_Y })
    .margin(this.isChild() ? { left: CHILD_INDENT } : {})
    .backgroundColor(this.isChild() ? this.pal().transparent
      : withAlpha(this.pal().surface, CARD_BG_ALPHA))
    .borderRadius(this.isChild() ? 0 : R_LG)
    .border(this.isChild()
      // 子行：仅左侧 1px **虚线**（web `border-l border-dashed`）
      ? {
          width: { left: 1, top: 0, right: 0, bottom: 0 },
          color: { left: this.pal().border, top: this.pal().border, right: this.pal().border, bottom: this.pal().border },
          style: { left: BorderStyle.Dashed, top: BorderStyle.Solid, right: BorderStyle.Solid, bottom: BorderStyle.Solid },
        }
      // 卡片：左 2px = 状态色，其余 1px = 发丝边框
      : {
          width: { left: BAR_W, top: 1, right: 1, bottom: 1 },
          color: {
            left: this.barColor(),
            top: withAlpha(this.pal().border, CARD_BORDER_ALPHA),
            right: withAlpha(this.pal().border, CARD_BORDER_ALPHA),
            bottom: withAlpha(this.pal().border, CARD_BORDER_ALPHA),
          },
        })
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      // 不可点（无 sessionKey / 无宿主回调）⇒ 点击无操作（web `disabled`）
      if (this.openable) {
        this.onOpen();
      }
    })
  }
}

/**
 * SubAgent 进度树（扁平行渲染）。
 *
 * ⚠️ 本组件**只负责画**：可见性过滤（只渲染 running/pending 顶层）、状态归档、树展平
 *    全在 `core/subagent.ets`（页面调用 `flattenSubAgents(row.subAgents, true)` 后传入）。
 *    这样"判据与渲染同源"（AGENTS 关键约定），也让宿主可以自由决定取哪棵树
 *    （`WebIteration.subAgents` 或 live 快照的 `subAgents`）。
 */
@Component
export struct SubAgentTree {
  /** 已展平的行（空 ⇒ **不产出任何节点**，web `:70` `return null`）。 */
  @Prop rows: SubAgentRow[] = [];
  /** 点某行 → 宿主打开该 SubAgent 会话（web `openSubAgent`）。 */
  onOpen: (sessionKey: string) => void = (sessionKey: string) => {
  };
  @Prop theme: string = 'dark';

  build() {
    // 空 ⇒ 什么都不画（不留空行/占位）
    if (this.rows.length > 0) {
      Column({ space: ROW_GAP }) {
        ForEach(this.rows, (r: SubAgentRow) => {
          SubAgentRowView({
            depth: r.depth,
            label: r.label,
            desc: r.desc,
            kind: r.kind,
            openable: r.openable,
            theme: this.theme,
            onOpen: () => {
              this.onOpen(r.sessionKey);
            },
          })
        },
          // ⛔ key 用 `r.key`（= 身份 + kind/desc 指纹）：ArkUI key 不变则不重建该项，
          //   内容变了 key 必须变（ARKTS-GOTCHAS §3）。
          (r: SubAgentRow) => r.key)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ top: SP_1 })      // 与上一块（迭代正文/工具）拉开 4vp
    }
  }
}
