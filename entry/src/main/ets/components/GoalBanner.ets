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
import { Palette, paletteOf } from '../core/theme';
import { R_MD, R_SM, SP_1 } from '../core/tokens';
// 语义令牌（`7841978`：goal 组 + 图标尺寸档）—— 组件不再自写 PAD/ICON/ALPHA/TINT 魔数。
import {
  PRESS_OPACITY, ICON_MD, INSET_CHIP_Y, INSET_GOAL_X, INSET_GOAL_Y, SPACE_XS, TYPE_CHIP, TYPE_GOAL,
  goalBadgeBgOf, goalBorderOf, typeOf, colorOf, } from '../core/design';
import { goalDisplay, GoalDisplay, goalEditCommit, goalEditable } from '../core/statusfmt';

// ── 尺寸/取色一律走语义令牌（`7841978` §4.7/§4.8）─────────────────────────────
// 旧魔数（PAD_X/PAD_Y=10/6、ICON=14、BORDER_ALPHA 深浅分叉、BADGE_TINT=0.15）已收进
// `core/design.ets`：`INSET_GOAL_X/Y`、`ICON_MD`、`goalBorderOf()`、`goalBadgeBgOf()`。

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

  /**
   * 卡片描边色：已完成走 success、进行中走 accent（web `:69-71`）—— 浅/深分叉在
   * `core/design.goalBorderOf`（`isLightSurface` 一处），组件不再自判主题、不再挑 alpha。
   */
  private bannerBorderColor(): string {
    return goalBorderOf(this.pal(), this.display().completed);
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
      Row({ space: SPACE_XS }) {
        // 图标（web `:78-85`）：已完成 → ✓；进行中 → 目标图标 + 呼吸点（原生用静态小圆点，
        // 见文件头 Pitfalls：不引入定时器，避免在列表行里开常驻动画）
        // ⛔ `sys.symbol.circle_badge_checkmark` **SDK 里不存在**（接线时 `10903329 Unknown
        //    resource name`）。web 用 lucide `Target`（`GoalBanner.tsx:16`）⇒ 取 HM Symbol 里
        //    语义/形态最贴近的 `dart_target`（靶心）；备选 `scope`（准星）/`circle_on_circle`
        //    （同心圆）/`record_circle`（圆+点）。存在性已对 `id_defined.json` 核实。
        Stack() {
          SymbolGlyph(this.display().completed
            ? $r('sys.symbol.checkmark')
            : $r('sys.symbol.dart_target'))
            .fontSize(ICON_MD)
            .fontColor([this.display().completed ? this.pal().success : this.pal().accent])
        }
        .width(ICON_MD).height(ICON_MD).alignContent(Alignment.Center)

        if (this.editing) {
          // 就地编辑（web 桌面分支 `:91-115`：Enter 保存 / 失焦保存）
          TextInput({ text: this.draft })
            .fontSize(typeOf(TYPE_GOAL).size)
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
            .fontSize(typeOf(TYPE_GOAL).size)
            .fontColor(this.pal().accent)
            .padding({ left: SPACE_XS, right: SPACE_XS, top: 3, bottom: 3 })
            .borderRadius(R_SM)
            .backgroundColor(goalBadgeBgOf(this.pal(), false))
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.commit();
            })
          Text('取消')
            .fontSize(typeOf(TYPE_GOAL).size)
            .fontColor(this.pal().textMuted)
            .padding({ left: SPACE_XS, right: SPACE_XS, top: 3, bottom: 3 })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.cancel();
            })
        } else {
          // 目标文本：单行截断；已完成 ⇒ muted + 删除线（web `:122-128`）
          Text(this.display().objective)
            .fontSize(typeOf(TYPE_GOAL).size)
            .fontColor(this.display().completed ? this.pal().textMuted : this.pal().textPrimary)
            .decoration(this.display().completed
              ? { type: TextDecorationType.LineThrough, color: this.pal().textMuted }
              : { type: TextDecorationType.None })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .wordBreak(WordBreak.BREAK_ALL)
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
            // press 反馈（统一口径 `PRESS_OPACITY`）——目标文本可点进编辑，此前**无任何按压回应**
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              // 已完成 ⇒ 不可编辑（web `:120`）
              if (goalEditable(this.display().completed)) {
                this.draft = this.objective;
                this.editing = true;
              }
            })

          // 状态徽标（web `:132-142`）
          Text(this.display().badge)
            .fontSize(typeOf(TYPE_CHIP).size)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.display().completed ? this.pal().success : this.pal().accent)
            .backgroundColor(goalBadgeBgOf(this.pal(), this.display().completed))
            .borderRadius(R_SM)
            .padding({ left: 6, right: 6, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })

          // 编辑入口：**仅进行中**（web `:145-154`）
          if (goalEditable(this.display().completed)) {
            SymbolGlyph($r('sys.symbol.square_and_pencil'))
              .fontSize(typeOf('type.caption').size)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.draft = this.objective;
                this.editing = true;
              })
          }

          // 清除（web `:157-167`；编辑态隐藏）
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(typeOf('type.caption').size)
            .fontColor([colorOf(this.pal(), 'iconMuted')])
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onClearGoal();
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: INSET_GOAL_X, right: INSET_GOAL_X, top: INSET_GOAL_Y, bottom: INSET_GOAL_Y })
      .backgroundColor(this.pal().surface)
      .borderRadius(R_MD)
      .border({ width: 1, color: this.bannerBorderColor() })
      .margin({ left: SP_1 + 2, right: SP_1 + 2, bottom: SP_1 })
      .clip(true)
    }
  }
}
