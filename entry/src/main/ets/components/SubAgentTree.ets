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
 *
 * ── 「状态 → 视觉」唯一真源（2026-10-11 收敛）──────────────────────────────────
 *   改造前本组件把 `kind` 判了**三段独立 if 链**（竖条色 / 图标 / 图标色）+ 一处标签三元。
 *   现全部改由 `core/statusvisual.ets:subagentVisual(kind)` 的**单一产物** `StatusVisual` 驱动：
 *     · 竖条色 = `roleColorOf(v.toneRole, pal)` × `v.markerAlpha`；
 *     · 图标色 = `roleColorOf(v.iconRole, pal)`；标签色 = `roleColorOf(v.labelRole, pal)`；
 *     · 图标   = `v.marker` → `sys.symbol`（core 不能持 `Resource`，映射留本组件**一处**）。
 *   ⇒ 改一个状态只改 `statusvisual` 一处；组件"结构上不可能分叉"。
 */
import { Palette, paletteOf, isLightPalette } from '../core/theme';
import { withAlpha } from '../core/bubble';
import {
  RADIUS_CARD, STROKE_RAIL, STROKE_HAIRLINE, HIT_TARGET_MIN,
  SPACE_HAIR, SPACE_SM, SPACE_XXS, INSET_ROW_X, INSET_ROW_Y,
  colorOf, surfaceFillOf, SURFACE_CARD, hairlineOf, ICON_MD, ICON_SM,
} from '../core/design';
import { fs, lh, fw } from './SettingsRows';
import { SubAgentRow } from '../core/subagent';
import {
  MARK_CHECK, MARK_CROSS, StatusVisual, roleColorOf, subagentVisual,
} from '../core/statusvisual';

/**
 * 卡片描边不透明度（web `border-border/50`）与底色不透明度（web `bg-bg-secondary/50`）。
 * ⚠️ **保留 50%**（既有深色观感已批准、不回归）；色**源**仍走语义层
 * （底色 = `surfaceFillOf(p,'surface.card')`，描边 = `pal().border` —— 后者由 `moment_polish`
 *  契约定死，见交付"被 pin 阻塞项"）。透明只作用于语义色，不是"自己挑一个色"。
 */
const CARD_BORDER_ALPHA: number = 0.5;
const CARD_BG_ALPHA: number = 0.5;
/** 子行缩进（web `ml-3 pl-3` = 12 + 12）—— 走 4pt 网格语义档 `SPACE_SM`。 */
const CHILD_INDENT: number = SPACE_SM;
/** 图标边长（web `size-3.5` / `size-3`）—— 走语义图标档 `ICON_MD` / `ICON_SM`。 */
const ICON_TOP: number = ICON_MD;
const ICON_CHILD: number = ICON_SM;
/** 顶层行间距（web `gap-1.5`）与图标-文字间距。⚠️ 报备：无 6 档（介于 SPACE_XXS(4)/SPACE_XS(8)）。 */
const ROW_GAP: number = 6;
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

  /** 本行的**全部视觉语义**（唯一真源：`core/statusvisual.ets:subagentVisual`）。 */
  private vis(): StatusVisual {
    return subagentVisual(this.kind);
  }

  /** 竖条色 = 标记主色角色 × 不透明度（done = accent@30%，见 `subagentVisual.markerAlpha`）。 */
  private barColor(): string {
    const v: StatusVisual = this.vis();
    return withAlpha(roleColorOf(v.toneRole, this.pal()), v.markerAlpha);
  }

  /** 图标色 = 图标色角色（running/error 用强调/危险色，其余 muted）。 */
  private iconColor(): string {
    return roleColorOf(this.vis().iconRole, this.pal());
  }

  /** 标签文字色 = 标签角色（running ⇒ accent，其余 ⇒ secondary）。 */
  private labelColor(): string {
    return roleColorOf(this.vis().labelRole, this.pal());
  }

  /** 形态档 → `sys.symbol`（core 不能持 `Resource` ⇒ 映射留在组件，**唯一一处**）。 */
  private iconRes(): Resource {
    const marker: string = this.vis().marker;
    if (marker === MARK_CHECK) {
      return $r('sys.symbol.checkmark');
    }
    if (marker === MARK_CROSS) {
      return $r('sys.symbol.xmark_circle_fill');
    }
    return $r('sys.symbol.lightbulb');   // MARK_BULB / 兜底
  }

  /**
   * 卡片 1px 描边色（跨主题**结构性边界**）。
   *
   * web 是 `border-border/50`（`SubAgentProgressTree.tsx:108`）—— 深色族**逐字节保留** `border@50%`
   * （已批准的深色观感不动）；浅色族（light / **porcelain 纯白**）改用 `Surfaces.hairline`
   * （`core/theme.ets` 按 `HAIRLINE_TARGET_RATIO` 压深）：白底上 `border@50%` ≈ **不可见**，
   * 卡片的"层级"就整块读不出来（porcelain 的设计口径正是"靠发丝线 + 柔影分层，不靠灰底"）。
   * 判据按**色板亮度**（`isLightPalette`），**不按主题名硬判**。
   */
  private cardBorderColor(): string {
    if (isLightPalette(this.pal())) {
      return hairlineOf(this.pal());
    }
    return withAlpha(this.pal().border, CARD_BORDER_ALPHA);
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
        .fontSize(fs('type.subhead'))              // 列表标题档（13/500）—— web `text-xs font-medium`
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        // 标签色走唯一真源（running ⇒ accent，其余 ⇒ secondary）—— 不再就地判 `this.kind`
        .fontColor(this.labelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.desc.length > 0) {
        Text(this.desc)
          .fontSize(fs('type.caption'))            // web `text-xs`
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(colorOf(this.pal(), 'textMuted'))
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
      ? { left: CHILD_INDENT, top: SPACE_HAIR, bottom: SPACE_HAIR }   // 子行：只留左缩进
      : { left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .margin(this.isChild() ? { left: CHILD_INDENT } : {})
    // 命中区 ≥ `HIT_TARGET_MIN`（Apple HIG）：卡片行/子行按"可点行"给足高度（openable 时真可点）。
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .backgroundColor(this.isChild() ? this.pal().transparent
      : withAlpha(surfaceFillOf(this.pal(), SURFACE_CARD), CARD_BG_ALPHA))
    .borderRadius(this.isChild() ? 0 : RADIUS_CARD)
    .border(this.isChild()
      // 子行：仅左侧 1px **虚线**（web `border-l border-dashed`）
      ? {
          width: { left: STROKE_HAIRLINE, top: 0, right: 0, bottom: 0 },
          // 虚线连接线是**结构性边界** ⇒ 走 `hairline`：深色族 `hairline ≡ border`（**逐字节不变**），
          // 浅色/极简白下自动可见（web 是 `border-l` 默认色，白底同样需看得见）。
          color: { left: hairlineOf(this.pal()), top: this.pal().border, right: this.pal().border, bottom: this.pal().border },
          style: { left: BorderStyle.Dashed, top: BorderStyle.Solid, right: BorderStyle.Solid, bottom: BorderStyle.Solid },
        }
      // 卡片：左 2px = 状态色，其余 1px = 结构性发丝描边（浅色族自动加固，见 `cardBorderColor`）
      : {
          width: { left: STROKE_RAIL, top: STROKE_HAIRLINE, right: STROKE_HAIRLINE, bottom: STROKE_HAIRLINE },
          color: {
            left: this.barColor(),
            top: this.cardBorderColor(),
            right: this.cardBorderColor(),
            bottom: this.cardBorderColor(),
          },
        })
    // ⛔ 静息态**不写** `normal`（`normal` 会接管属性、盖掉动态值）——与 ThinkingLine / ContextRing
    //    同一「按压纪律」：只写 `pressed`（web 静息态无 opacity 规则，默认即 1）。
    .stateStyles({ pressed: { .opacity(0.75) } })
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
      .margin({ top: SPACE_XXS })      // 与上一块（迭代正文/工具）拉开 4vp
    }
  }
}
