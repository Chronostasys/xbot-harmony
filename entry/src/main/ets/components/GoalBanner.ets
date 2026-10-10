/**
 * GoalBanner —— 「目标」横幅（web `web/src/components/agent/GoalBanner.tsx` 同构）。
 *
 * ── 为什么是它（波7 选型）──────────────────────────────────────────────────────
 *   `docs/WEB-PARITY.md` §10 的「Goal 横幅」行：原状态「部分（`core/statusfmt.ets:72` 状态行）」。
 *   实测比"部分"更糟 —— 原生**完全不显示 goal**：
 *     ① `core/types.ets:369` 的 `GoalInfo` 是 `{text?, status?}`，而真实数据来自
 *        `core/chattypes.ts:9` 的 `{objective, status, summary}`（`core/normalize.ts:83-94 optGoal`）
 *        ⇒ `goalText()` 读 `g.text` 永远 undefined；
 *     ② `core/store.ets:126` 的 `goal` 字段**从未被赋值**（全仓无赋值点）。
 *   本波交付「纯逻辑 + 组件」，并把这两处跨文件缺陷写进报告（不在我的文件范围）。
 *
 * ── 形态与交互（逐条对齐 web GoalBanner.tsx）─────────────────────────────────────
 *   · 卡片：`mx-1.5 mb-1 rounded-md border`，进行中 `border-accent/30`、已完成
 *     `border-green-500/30`（`:66-73`）
 *   · 图标：进行中 `Target`(accent) + 呼吸点；已完成 `Check`(green)（`:78-85`）
 *   · 文本：单行**截断**；已完成 ⇒ `text-muted` + 删除线；进行中 ⇒ 可点进编辑
 *     （`title` = 「点击编辑目标」）（`:117-129`）
 *   · 状态徽标：`进行中` / `已完成`（`:132-142`）
 *   · 编辑按钮：**仅进行中且非编辑态**（`:145-154`）；清除按钮：非编辑态恒显示（`:157-167`）
 *   · 就地编辑：Enter 保存（`:104-106`）；**trim 空串或未变更 ⇒ 不提交**（`:52-58`）
 *   · 已完成的目标**不可编辑**（`:120`）
 *
 * ⛔ 只吃**原始字符串** `objective`/`status`（**不**吃 `GoalInfo`）：两个同名 `GoalInfo` 的
 *    命名碰撞见上；接线方从 `progress.goal.objective` / `.status` 直接取串即可绕开。
 * ⛔ 唯一注入点（下一波）：`pages/Index.ets` 的 composer **正上方**，web 里紧邻 TodoPullOut
 *    （`MessageInput.tsx:722-731`）；原生即 `TodoPanel` 的**上一条**（同一列、同一间距）。
 * ⛔ 会变的文本走**真 `@Component` + `@Prop`/`@State`**（禁带参 @Builder）；成员名避开
 *    `CustomComponent` 基类（`id`/`key`/`size`/`width`/`height`/`enabled`/`on*` 等）。
 * ⛔ 颜色只用 `pal()` 语义色（禁 hex），浅色判据用 `isLightPalette`（不按主题名），
 *    尺度用 `core/tokens.ets`。
 */
import { isLightPalette, Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, R_MD, R_SM, SP_1, SP_2, SP_3 } from '../core/tokens';
import { withAlpha } from '../core/bubble';
import { goalDisplay, GoalDisplay, goalEditCommit, goalEditable } from '../core/statusfmt';

/** 卡片内边距（web `px-2.5 py-1.5`）。 */
const PAD_X: number = 10;
const PAD_Y: number = 6;
/** 图标字号（web `size-3.5` = 14px）。 */
const ICON: number = 14;
/** 徽标字号（web `text-[10px]`）。 */
const BADGE_FS: number = 10;
/** 进行中目标的强调色描边不透明度（web `border-accent/30`）；浅色底需更实才看得见。 */
const BORDER_ALPHA_DARK: number = 0.3;
const BORDER_ALPHA_LIGHT: number = 0.5;
/** 徽标底纹不透明度（web `bg-accent/15` / `bg-green-500/15`）。 */
const BADGE_TINT: number = 0.15;

/**
 * 目标横幅。`objective` 为空 ⇒ **不产出任何节点**（`goalDisplay(...).visible === false`）。
 */
@Component
export struct GoalBanner {
  /** 目标原文（web `goal.objective`）。空 ⇒ 零渲染。 */
  @Prop objective: string = '';
  /** 目标状态（web `goal.status`；只认 `'completed'` 为完成）。 */
  @Prop status: string = '';
  @Prop theme: string = 'dark';
  /** 保存编辑后的目标（**已 trim、非空、且与原值不同**才会回调）。 */
  onEditGoal: (objective: string) => void = (objective: string) => {
  };
  /** 清除目标。 */
  onClearGoal: () => void = () => {
  };

  /** 是否处于就地编辑（web `editing`）。 */
  @State editing: boolean = false;
  /** 编辑草稿（web `draft`）。 */
  @State draft: string = '';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private display(): GoalDisplay {
    return goalDisplay(this.objective, this.status);
  }

  /** 卡片描边色：已完成走 success，进行中走 accent（web `:69-71`）。 */
  private borderColor(): string {
    const alpha: number = isLightPalette(this.pal()) ? BORDER_ALPHA_LIGHT : BORDER_ALPHA_DARK;
    return withAlpha(this.display().completed ? this.pal().success : this.pal().accent, alpha);
  }

  /** 提交编辑（web `:52-58`）：空串/未变更 ⇒ 不回调、直接退出编辑。 */
  private commit(): void {
    const next: string | null = goalEditCommit(this.draft, this.objective);
    this.editing = false;
    if (next !== null) {
      this.onEditGoal(next);
    }
  }

  private cancel(): void {
    this.draft = this.objective;
    this.editing = false;
  }

  build() {
    // ⛔ 唯一显示判据：无目标 ⇒ 零节点（web 由父级 `{goal && <GoalBanner/>}` 条件挂载）
    if (this.display().visible) {
      Row({ space: SP_2 }) {
        // 图标（web `:78-85`）：已完成 → ✓；进行中 → 目标图标 + 呼吸点（原生用静态小圆点，
        // 见文件头 Pitfalls：不引入定时器，避免在列表行里开常驻动画）
        Stack() {
          SymbolGlyph(this.display().completed
            ? $r('sys.symbol.checkmark')
            : $r('sys.symbol.circle_badge_checkmark'))
            .fontSize(ICON)
            .fontColor([this.display().completed ? this.pal().success : this.pal().accent])
        }
        .width(ICON).height(ICON).alignContent(Alignment.Center)

        if (this.editing) {
          // 就地编辑（web 桌面分支 `:91-115`：Enter 保存 / 失焦保存）
          TextInput({ text: this.draft })
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(R_SM)
            .layoutWeight(1)
            .onChange((v: string) => {
              this.draft = v;
            })
            .onSubmit(() => {
              this.commit();
            })
          Text('保存')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().accent)
            .padding({ left: SP_2, right: SP_2, top: 3, bottom: 3 })
            .borderRadius(R_SM)
            .backgroundColor(withAlpha(this.pal().accent, BADGE_TINT))
            .onClick(() => {
              this.commit();
            })
          Text('取消')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .padding({ left: SP_2, right: SP_2, top: 3, bottom: 3 })
            .onClick(() => {
              this.cancel();
            })
        } else {
          // 目标文本：单行截断；已完成 ⇒ muted + 删除线（web `:122-128`）
          Text(this.display().objective)
            .fontSize(FS_CAPTION)
            .fontColor(this.display().completed ? this.pal().textMuted : this.pal().textPrimary)
            .decoration(this.display().completed
              ? { type: TextDecorationType.LineThrough, color: this.pal().textMuted }
              : { type: TextDecorationType.None })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .wordBreak(WordBreak.BREAK_ALL)
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
            .onClick(() => {
              // 已完成 ⇒ 不可编辑（web `:120`）
              if (goalEditable(this.display().completed)) {
                this.draft = this.objective;
                this.editing = true;
              }
            })

          // 状态徽标（web `:132-142`）
          Text(this.display().badge)
            .fontSize(BADGE_FS)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.display().completed ? this.pal().success : this.pal().accent)
            .backgroundColor(withAlpha(
              this.display().completed ? this.pal().success : this.pal().accent, BADGE_TINT))
            .borderRadius(R_SM)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })

          // 编辑入口：**仅进行中**（web `:145-154`）
          if (goalEditable(this.display().completed)) {
            SymbolGlyph($r('sys.symbol.square_and_pencil'))
              .fontSize(12)
              .fontColor([this.pal().textMuted])
              .onClick(() => {
                this.draft = this.objective;
                this.editing = true;
              })
          }

          // 清除（web `:157-167`；编辑态隐藏）
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(12)
            .fontColor([this.pal().textMuted])
            .onClick(() => {
              this.onClearGoal();
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: PAD_X, right: PAD_X, top: PAD_Y, bottom: PAD_Y })
      .backgroundColor(this.pal().surface)
      .borderRadius(R_MD)
      .border({ width: 1, color: this.borderColor() })
      .margin({ left: SP_1 + 2, right: SP_1 + 2, bottom: SP_1 })
      .clip(true)
    }
  }
}
