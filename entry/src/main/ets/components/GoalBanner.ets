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
  PRESS_OPACITY, ICON_MD, ICON_XL, INSET_CHIP_Y, INSET_GOAL_X, INSET_GOAL_Y, SPACE_XS, SPACE_XXS,
  TYPE_CHIP, TYPE_GOAL,
  goalBadgeBgOf, goalBorderOf, typeOf, colorOf, PILL_MAX_W, HIT_TARGET_MIN, } from '../core/design';
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
            // ⛔ 目标⑤：`accent` 是**非文本/图形** role（AA_NON_TEXT 3.0，供弧/环/图标用），
            //    此处是 12 的 **normal 字号文字** ⇒ 需 AA_TEXT 4.5。实算 porcelain 压
            //    `goalBadgeBgOf`(= accent@15% over `surface`) 只有 **3.83**（dark 3.84 亦不足）
            //    ⇒ 改走语义等价的**文字** role `accentText`（本仓为"强调文字/徽标字"定义的 4.5 档）：
            //    逐主题实算 porcelain 5.60 / dark 9.63 / light 7.01 / aurora 10.19 / nebula 8.55（全 ≥4.5）。
            .fontColor(this.pal().accentText)
            .padding({ left: SPACE_XS, right: SPACE_XS, top: 3, bottom: 3 })
            // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先只靠 padding 撑高（≈22）⇒ 低于阈值。
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .borderRadius(R_SM)
            .backgroundColor(goalBadgeBgOf(this.pal(), false))
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.commit();
            })
          Text('取消')
            .fontSize(typeOf(TYPE_GOAL).size)
            // ⛔ **B 类可见度**（2026-10-11 系统性审计）：这是**可点**元素，门槛是**非文本 3:1**；
            //    而 `textMuted` 在 porcelain 下**所有面**只有 2.17–2.54（它的批准档是 `AA_MUTED`=**2.0**，
            //    那是给**非交互元信息**的）⇒ 可点 UI 必须用 `textSecondary`（porcelain 4.74 ✓）。
            .fontColor(this.pal().textSecondary)
            .padding({ left: SPACE_XS, right: SPACE_XS, top: 3, bottom: 3 })
            // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先只靠 padding 撑高（≈22）⇒ 低于阈值。
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.cancel();
            })
        } else {
          // 目标文本：单行截断；已完成 ⇒ muted + 删除线（web `:122-128`）
          Text(this.display().objective)
            .constraintSize({ minHeight: HIT_TARGET_MIN })
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
            // ⛔ **水平溢出**：徽标文案长度不可控（模型生成）⇒ 加宽上限，否则顶出所在 Row。
            .constraintSize({ maxWidth: PILL_MAX_W })
            // ⛔ 目标⑤：徽标字（10 档）是 normal 字号文字 ⇒ 需 AA_TEXT 4.5。`accent` 是图形 role
            //    （3.0）⇒ 压 `goalBadgeBgOf`(= accent@15% over `surface`) porcelain 仅 **3.83**
            //    （dark 3.84 亦不足）⇒ 进行中分支改走文字 role `accentText`（porcelain 5.60 ✓）。
            //    `success` 分支保留（`success` 在 porcelain 已按 4.5 档取值，非本次越界项）。
            .fontColor(this.display().completed ? this.pal().success : this.pal().accentText)
            .backgroundColor(goalBadgeBgOf(this.pal(), this.display().completed))
            .borderRadius(R_SM)
            .padding({ left: 6, right: 6, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })

          // 动作键对（编辑 + 清除）—— ⛔ 两枚**必须同档、同盒、成对**放置：
          //   外层 Row 的 `space: SPACE_XS`(8) 只负责"信息区 → 动作区"那一段，
          //   两枚之间的间隙收成 `SPACE_XXS`(4)（原先是 8+8=16vp 双重间隙）。
          Row({ space: SPACE_XXS }) {
            // 编辑入口：**仅进行中**（web `:145-154`）
            if (goalEditable(this.display().completed)) {
              // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
              // ⚠️ 2026-10-13（用户亲报「删除按钮两边巨大空白，奇丑无比」）：46 盒里塞 `type.caption`(12)
              //    的图标 ⇒ **左右各 ~16vp 纯空气**，两枚相邻还叠 8vp 死区 ⇒ 读成"牌子上两粒小点"。
              //    首修 = 图标提到**动作字形档** `ICON_LG`(16) ⇒ 空气感降到 ~14vp/侧。
              // ⚠️ **2026-10-14 用户再报「删除按钮这么大空白」**（同一条，首修不够）：装机实测几何
              //    （`uitest dumpLayout`，density≈3.17）：编辑盒 `966..1115`、清除盒 `1169..1318`，
              //    字形仅 54px ⇒ **字形间距 ≈45vp**、每侧盒内空气 ≈15vp，外加盒间 16vp 双重间隙。
              //    二修 = ① 字形进 `ICON_XL`(20，本仓已批准的大图标档) ⇒ 盒内空气 15→12vp/侧；
              //           ② 两枚收进同一 `Row(space: SPACE_XXS)`、去掉 `margin.left` ⇒ 盒间 16→4vp。
              //    合计字形间距 45→28vp（=1.4× 字形，Apple 工具栏量级）；⛔ 44×44 命中盒**一个都不缩**。
              Row() {
                SymbolGlyph($r('sys.symbol.square_and_pencil'))
                  .fontSize(ICON_XL)
                  .fontColor([colorOf(this.pal(), 'iconMuted')])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText('编辑目标')
              .onClick(() => {
                this.draft = this.objective;
                this.editing = true;
              })
            }

            // 清除（web `:157-167`；编辑态隐藏）
            // ⛔ 命中区：同上 —— 真实 44×44 布局盒承载 `onClick`；两枚盒间仅 `SPACE_XXS`(4) 死区
            //    （原来是 8+8=16vp；两枚动作相反，保留最小死区避免误触）。
            Row() {
              SymbolGlyph($r('sys.symbol.xmark'))
                // 图标档位同「编辑」（`ICON_XL`）：两枚相邻动作键**必须同档**，否则一枚显大一码。
                .fontSize(ICON_XL)
                .fontColor([colorOf(this.pal(), 'iconMuted')])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText('清除目标')
            .onClick(() => {
              this.onClearGoal();
            })
          }
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      // ⚠️ 2026-10-13（用户亲报「删除按钮两边巨大空白」的**外侧**一半）：右内衬由 `INSET_GOAL_X`
      //    收到 0 —— 尾随**动作盒**自带 (44−16)/2 = **14vp 内部空气**，等效视觉内衬 ≈ 左缘文字
      //    内衬（光学对齐，Apple 工具栏惯例：图标按**图形边缘**对齐、不按盒边缘）。⛔ 文字侧内衬
      //    不变 ⇒ 目标正文左缘与原先逐字节一致。
      .padding({ left: INSET_GOAL_X, right: 0, top: INSET_GOAL_Y, bottom: INSET_GOAL_Y })
      .backgroundColor(this.pal().surface)
      .borderRadius(R_MD)
      .border({ width: 1, color: this.bannerBorderColor() })
      .margin({ left: SP_1 + 2, right: SP_1 + 2, bottom: SP_1 })
      .clip(true)
    }
  }
}
