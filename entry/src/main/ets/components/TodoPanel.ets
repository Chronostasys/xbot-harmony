/**
 * TodoPanel —— 「Todo 拉出面板」（web `web/src/components/agent/TodoPullOut.tsx` 同构）。
 *
 * ── 为什么是它（波6 选型）─────────────────────────────────────────────────────
 *   `docs/WEB-PARITY.md` §10 里「Todo 拉出面板」是**用户最直观能感知**的未迁项：
 *   数据早已在 store 里（`ChatState.todos`），但原生**只显示一行文字**
 *   （`core/statusfmt.ets:43,57`）—— 用户看不到清单、不知道进度、无法勾选。
 *   本波交付纯逻辑 + 组件（**组件先行**，注入留给下一波）。
 *
 * ── 形态（以 web 为准）─────────────────────────────────────────────────────────
 *   · 收起态 = 一行（web `h-7`=28vp）：展开箭头 + **进度条**（`h-1.5 w-12`= 48×6）
 *     + `done/total` + 当前任务文本（全完成 ⇒ muted 文案）—— `TodoPullOut.tsx:88-112`
 *   · 展开态 = 清单（web `max-h-[240px] overflow-y-auto border-t px-2 py-1.5`）`:125-126`
 *   · 每行：状态图标（done→✓success / doing→◐accent / pending→○muted）+ 文本
 *     （done ⇒ 删除线、doing ⇒ medium）+ goal 徽标 + 触屏 `⋯` 菜单（编辑/删除）`:214-376`
 *   · 点状态图标 = 勾选/取消（`:225-245`）；点文本 = 就地编辑（`:247-261`）
 *   · `total === 0` ⇒ **整个面板不存在**（`:56` `if (total === 0) return null`）
 *
 * ⛔ 会变的内容一律走**真 `@Component` + `@Prop`/`@State`**（禁带参 @Builder）。
 * ⛔ 成员名避开 ArkUI `CustomComponent` 基类成员（`id`/`key`/`size`/`width`/`height`/`enabled`/…）。
 * ⛔ 颜色只用 `pal()` 语义色（**禁 hex**），浅色判据用 `isLightPalette`（**不按主题名硬判**），
 *    尺度用 `core/tokens.ets`，动效用 `components/anim.ets`。
 */
import { Palette, paletteOf, shadowRadiusOf } from '../core/theme';
import { FS_CAPTION, R_MD, R_SM, SP_1, SP_2, SP_3 } from '../core/tokens';
// 语义令牌（`7841978` §4.7/§4.8/§6）：进度条 / 清单高 / 菜单宽 / goal 行底纹 / 按压。
import {
  ELEV_OVERLAY, ICON_MD, ICON_SM, INSET_CHIP_X, INSET_CHIP_Y, LIST_MAX_H, MENU_W,
  PRESS_OPACITY, PROGRESS_H, PROGRESS_W, RADIUS_CHIP, STROKE_HAIRLINE, SURFACE_CARD, TYPE_CHIP,
  elevationColorOf, goalRowTintOf, hairlineOf, structuralRuleOf,
  surfaceFillOf, typeOf, colorOf, HIT_TARGET_MIN, } from '../core/design';
import { animBase, animFast, fadeTransition } from './anim';
import { TodoItem } from '../core/types';
import {
  hasTodos, isGoalTodo, todoCountLabel, todoPercent, todoRowKey, todoState,
  TodoState, todoStatusKind, todoText,
} from '../core/todos';
import {
  EMPHASIS_MEDIUM, MARK_CIRCLE_CHECK, MARK_CIRCLE_DASHED, StatusVisual,
  roleColorOf, todoVisual,
} from '../core/statusvisual';

// ── 尺寸/取色一律走语义令牌（`7841978`），组件不再自写魔数 ──────────────────────
// 旧魔数：HEADER_H=28、BAR_W/H=48/6、LIST_MAX_H=240、ICON=14、GOAL_TINT 深浅分叉、
//         PRESS_OPACITY=0.7（与 design.PRESS_OPACITY=0.6 冲突，本次统一到 0.6）、菜单 width(120)。

/**
 * 一行（真 `@Component` + `@Prop` —— `kind`/文本/徽标变化必须驱动重渲染）。
 *
 * ⛔ 父级 `ForEach` 的 key 由 `TodoPanel` 侧拼入**可变内容**（status/text/编辑态/徽标），
 *   否则 ArkUI「key 不变则不重建该项」会让勾选状态卡住（ARKTS-GOTCHAS §3）。
 */
@Component
struct TodoRowView {
  @Prop label: string = '';
  /** 状态档（`pending|doing|done`，已由 `core/todos.ets` 归一）。 */
  @Prop kind: string = 'pending';
  /** 是否当前 goal（行尾徽标 + 底纹）。 */
  @Prop isGoal: boolean = false;
  /** 是否处于就地编辑（渲染输入框而非文本）。 */
  @Prop editing: boolean = false;
  /** 编辑草稿（仅 `editing` 时使用；由父组件 @State 持有 ⇒ 走 @Prop 值投递）。 */
  @Prop draft: string = '';
  /** 是否可编辑（宿主是否提供改名/删除回调）。 */
  @Prop editable: boolean = false;
  /**
   * 是否提供「设为目标」动作（web `TodoPullOut.tsx:300` 的 `{onSetGoalTodo && (…)}`：
   * 仅当宿主提供该回调时该项才出现在 `⋯` 菜单里 —— 与 `editable` 同构的"能力开关"）。
   */
  @Prop canSetGoal: boolean = false;
  @Prop theme: string = 'dark';
  onToggle: () => void = () => {
  };
  onStartEdit: () => void = () => {
  };
  /** 「设为目标」（web `:305` `onSetGoalTodo(todo.text)` —— 用本行文本设为目标）。 */
  onSetGoal: () => void = () => {
  };
  onDraft: (v: string) => void = (v: string) => {
  };
  onCommit: () => void = () => {
  };
  onCancel: () => void = () => {
  };
  onRemove: () => void = () => {
  };

  /** `⋯` 菜单开关（**在行内**持状态：把 popup 挂在 SymbolGlyph 上，
   *  而不是给"自定义组件调用"链 `.bindPopup` —— 后者在 ForEach 里不可靠）。 */
  @State menuOpen: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 本行的**全部视觉语义**（唯一真源：`core/statusvisual.ets:todoVisual`）。 */
  private vis(): StatusVisual {
    return todoVisual(this.kind);
  }

  /** 状态图标色 = 图标色角色（done → success，doing → accent，pending → muted）。 */
  private iconColor(): string {
    return roleColorOf(this.vis().iconRole, this.pal());
  }

  /** 标签文字色 = 标签角色（done → muted，其余 → 正文）。 */
  private labelColor(): string {
    return roleColorOf(this.vis().labelRole, this.pal());
  }

  /** 标签字重（doing ⇒ Medium）。 */
  private textWeight(): FontWeight {
    return this.vis().emphasis === EMPHASIS_MEDIUM ? FontWeight.Medium : FontWeight.Normal;
  }

  /** 标签是否加删除线（done ⇒ 是）。 */
  private struck(): boolean {
    return this.vis().struck;
  }

  /** 形态档 → `sys.symbol`（core 不能持 `Resource` ⇒ 映射留在组件，**唯一一处**）。 */
  private iconRes(): Resource {
    const marker: string = this.vis().marker;
    if (marker === MARK_CIRCLE_CHECK) {
      return $r('sys.symbol.checkmark_circle_fill');
    }
    if (marker === MARK_CIRCLE_DASHED) {
      return $r('sys.symbol.circle_dashed');
    }
    return $r('sys.symbol.circle');   // MARK_CIRCLE / 兜底
  }

  private goalTint(): string {
    return goalRowTintOf(this.pal());
  }

  build() {
    Row({ space: SP_2 }) {
      // 状态图标（点击 = 勾选/取消；web `data-testid="todo-status"`）
      // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`；
      //    图标视觉尺寸不变（仍 `ICON_MD`=14，盒内居中）。⚠️ 行首盒 14→44 ⇒ 标签可用宽 -30（`layoutWeight` 吸收）。
      Row() {
        SymbolGlyph(this.iconRes())
          .fontSize(ICON_MD)
          .fontColor([this.iconColor()])
      }
      .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
      .accessibilityText(this.struck() ? '标记未完成' : '标记完成')
      .onClick(() => {
        this.onToggle();
      })

      if (this.editing) {
        // 就地编辑（web 桌面分支 `:188-210`：Enter 保存 / Esc 取消）
        TextInput({ text: this.draft })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.raised'))
          .borderRadius(R_SM)
          .padding({ left: SP_2, right: SP_2 })
          .layoutWeight(1)
          .onChange((v: string) => {
            this.onDraft(v);
          })
          .onSubmit(() => {
            this.onCommit();
          })
          // ⛔ 失焦即收敛（2026-10-14 用户亲报「编辑 todo 进入编辑态之后，点击别的位置不会自动
          //    回到非编辑态，这也是 bug」）：此前**只有** Enter（`onSubmit`）才会退出编辑态
          //    ⇒ 点别的行 / 点面板空白 / 点输入框都停在编辑态，行永久是一个悬空的输入框
          //    （用户读成"卡住了"）。Apple 语义 = 编辑态是**焦点态**：焦点一离开就落定
          //    （`onCommit()` 内部已按 web 语义处理"空串/未变 ⇒ 不回调、保持原文本"）。
          //    ⚠️ 与服务端写路径无关：`commitEdit()` 只在**有效且变化**时才回调 `onRenameTodo`。
          .onBlur(() => {
            this.onCommit();
          })
      } else {
        Text(this.label)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          // 字色 / 字重 / 删除线全部来自唯一真源（`StatusVisual`），组件不再就地判 `this.kind`
          .fontColor(this.labelColor())
          .fontWeight(this.textWeight())
          // done ⇒ 删除线（web `line-through`）
          .decoration(this.struck()
            ? { type: TextDecorationType.LineThrough, color: this.pal().textMuted }
            : { type: TextDecorationType.None })
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL)
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
          // ⛔ 编辑入口被 `editable` 守卫 ⇒ 必须把该 flag 接到 `.enabled()`（".enabled(this.<guard>)"）：
          //    否则它照常有 press 反馈、点了却没动作 = **交互死区**（web `TodoPullOut` 同义）。
          //    ⚠️ 刻意**只**禁这一处 —— 本行内还有**未被守卫**的状态勾选（`:133 onToggle`），
          //    若把 `.enabled(this.editable)` 加到整行会把勾选一起禁掉。
          .enabled(this.editable)
          .onClick(() => {
            if (this.editable) {
              this.onStartEdit();
            }
          })
      }

      // goal 徽标（web `data-testid="todo-goal-badge"`）
      if (this.isGoal) {
        Text('goal')
          .fontSize(typeOf(TYPE_CHIP).size)
          // ⛔ 目标⑤：徽标字（`TYPE_CHIP`=10，normal 字号）是**文字** ⇒ 需 AA_TEXT 4.5。
          //    `accent` 是**非文本/图形** role（3.0）⇒ 压本行 goal 底纹（`accent@14% over 已 tint 行`
          //    = 双层 tint）+ 卡片面，实算 porcelain 仅 **3.25**、light **4.54**（贴线）⇒ 不足/不稳
          //    ⇒ 改走文字 role `accentText`（porcelain 4.75 / dark 9.77 / light 5.74 / aurora 10.44 /
          //    nebula 8.77，全 ≥4.5）。底纹 `goalRowTintOf` 不动（观感意图保持）。
          .fontColor(this.pal().accentText)
          .backgroundColor(goalRowTintOf(this.pal()))
          .borderRadius(RADIUS_CHIP)
          .padding({ left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
      }

      // 触屏操作菜单（web 触屏分支只留一个 `⋯`：编辑 / 删除；桌面是三枚 hover 图标）
      if (this.editable) {
        // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
        Row() {
          SymbolGlyph($r('sys.symbol.line_3_horizontal'))
            .fontSize(ICON_MD)
            .fontColor([this.pal().textSecondary])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
        .accessibilityText('更多操作')
        .onClick(() => {
          this.menuOpen = !this.menuOpen;
        })
          .bindPopup(this.menuOpen, {
            builder: this.RowMenu,
            placement: Placement.BottomRight,
            enableArrow: false,
            mask: false,
            // 浮层三件套走设计系统口径（C4 续）：面 = `surface.overlay`；圆角 = 语义档；柔影 = token。
            popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
            radius: RADIUS_CHIP,
            shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
            onWillDismiss: (action: DismissPopupAction) => {
              this.menuOpen = false;
            },
          })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: SP_1, right: SP_1, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
    .borderRadius(RADIUS_CHIP)
    // ⚡ 2026-10-20 丝滑动画：目标切换时背景色缓动
    .animation(animBase())
    .backgroundColor(this.isGoal ? this.goalTint() : this.pal().transparent)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
  }

  /** `⋯` 菜单（web 触屏 Popover：**设为目标 / 编辑 / 删除**——`TodoPullOut.tsx:300-321` 三项同构）。 */
  @Builder
  RowMenu() {
    Column() {
      // 「设为目标」仅当宿主提供回调（web `:300` 的 `{onSetGoalTodo && (…)}`）
      if (this.canSetGoal) {
        Text('设为目标')
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .width('100%')
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.menuOpen = false;
            this.onSetGoal();
          })
      }
      Text('编辑')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .width('100%')
        .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.menuOpen = false;
          this.onStartEdit();
        })
      Text('删除')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().dangerText)
        .width('100%')
        .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.menuOpen = false;
          this.onRemove();
        })
    }
    .width(MENU_W)
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * Todo 拉出面板。
 *
 * ⚠️ 本组件**只负责画 + 交互**：统计与行变换全在 `core/todos.ets`（"判据与渲染同源"）。
 *    持久化由宿主负责 —— 契约见 `core/todos.ets` 头部（RPC `set_todos`）。
 */
@Component
export struct TodoPanel {
  /** 清单（空 ⇒ **不产出任何节点**，web `TodoPullOut.tsx:56`）。 */
  @Prop todos: TodoItem[] = [];
  /** 当前 goal 文本（用于行尾徽标；空 ⇒ 不标）—— web `TodoPullOut.tsx:24,128`。 */
  @Prop goalText: string = '';
  /**
   * 是否已有 goal（web `MessageInput.tsx:730` 的 `hasGoal={!!goal || addingGoal}`）。
   * 决定折叠行右侧是否出现 🎯「设为目标」按钮（web `TodoPullOut.tsx:113-121`：仅**无 goal** 时）。
   */
  @Prop hasGoal: boolean = false;
  @Prop theme: string = 'dark';
  /** 「设为目标」入口（web `TodoPullOut.tsx:114-121` `onClick={onSetGoal}`）。 */
  onSetGoal: () => void = () => {
  };
  /**
   * 「用**本行文本**设为目标」（web `TodoPullOut.tsx:305` `onSetGoalTodo(todo.text)`）。
   * ⚠️ 与 `canSetGoalTodo` 成对：⛔ 不要像 `editable()` 那样"靠回调是否为 `undefined` 判能力"
   *    —— 属性默认值是非 `undefined` 的 no-op ⇒ 该判据恒真、守卫永不生效（本仓已有的坑）。
   *    能力开关一律走**显式 `@Prop` 布尔**。
   */
  onSetGoalTodo: (text: string) => void = (text: string) => {
  };
  /** 宿主是否提供「设为目标」动作（web `TodoPullOut.tsx:300` `{onSetGoalTodo && (…)}`）。 */
  @Prop canSetGoalTodo: boolean = false;
  /** 勾选/取消（宿主做乐观覆盖 + `set_todos` 持久化）。 */
  onToggleTodo: (index: number) => void = (index: number) => {
  };
  /** 改名（**已 trim**；仅当文本有效且变化时才会被调用）。 */
  onRenameTodo: (index: number, text: string) => void = (index: number, text: string) => {
  };
  /** 删除。 */
  onRemoveTodo: (index: number) => void = (index: number) => {
  };

  /** 展开态（web `expanded`）。 */
  @State expanded: boolean = false;
  /** 正在编辑的行索引（-1 = 无）—— web `editingIndex`。 */
  @State editingIndex: number = -1;
  /** 编辑草稿 ── web `draft`。 */
  @State draft: string = '';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private state(): TodoState {
    return todoState(this.todos);
  }

  /** 宿主是否提供编辑能力（web `editable = typeof onUpdateTodos === 'function'`）。 */
  private editable(): boolean {
    return this.onRenameTodo !== undefined && this.onRemoveTodo !== undefined;
  }

  private startEdit(i: number): void {
    this.editingIndex = i;
    this.draft = todoText(this.todos[i]);
  }

  /** 提交编辑：**只**在文本有效且变化时回调（web `commitEdit` `:66-74` 的语义）。 */
  private commitEdit(): void {
    const i: number = this.editingIndex;
    if (i < 0) {
      return;
    }
    const text: string = this.draft.trim();
    this.editingIndex = -1;
    if (text.length === 0 || text === todoText(this.todos[i])) {
      return;   // 空串会静默丢条目 ⇒ 保持原文本（web 同）
    }
    this.onRenameTodo(i, text);
  }

  build() {
    // ⛔ 唯一显示判据（web `:56`）：无 todo ⇒ 不产出任何节点（无空行/占位）
    if (hasTodos(this.todos)) {
      Column() {
        // ── 收起态行：箭头 + 进度条 + done/total + 当前任务 ────────────────────────
        // ⛔ 结构对齐 web `TodoPullOut.tsx:88-121`：折叠开关是**左侧那一个**区域（内层 Row
        //    带 layoutWeight(1) + onClick），🎯 按钮是它的**兄弟** —— web 注释明确：
        //    带 onClick 的控件绝不能嵌进另一个 onClick 容器里（点击会同时触发两个动作）。
        Row({ space: SP_2 }) {
          Row({ space: SP_2 }) {
            SymbolGlyph($r('sys.symbol.chevron_right'))
              .fontSize(ICON_SM)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
              .rotate({ angle: this.expanded ? 90 : 0 })
              .animation(animFast())
            Progress({ value: todoPercent(this.state()), total: 100, type: ProgressType.Linear })
              .width(PROGRESS_W)
              .height(PROGRESS_H)
              .color(this.pal().accent)
              .backgroundColor(surfaceFillOf(this.pal(), 'surface.raised'))
              .style({ strokeWidth: PROGRESS_H, enableSmoothEffect: true })
            Text(todoCountLabel(this.state()))
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
            Text(this.state().currentText.length > 0 ? this.state().currentText : '全部完成')
              .fontSize(FS_CAPTION)
              // ⛔ 单次取板：`colorOf(p, role)` + 计算型 role —— 原本写成
              //    `cond ? this.pal().textPrimary : this.pal().textMuted` ⇒ **两次读板**（性能预算⑦按**调用点**计数）
              .fontColor(colorOf(this.pal(), this.state().currentText.length > 0 ? 'textPrimary' : 'textMuted'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
              .textAlign(TextAlign.Start)
          }
          // ⛔ **不得纵向填充**（2026-10-12 P0 白屏的根因）：本 `Row`（todo 条）在**输入框区的
          //    `Column`** 里，`.layoutWeight(1)` + `.height('100%')` 会让它**撑满整列**；而
          //    `f5d4003` 把其内容（图标/进度/文字）改成**真实 44×44 布局盒**、固有高变大 ⇒
          //    在**带 todo 的会话**上把聊天区（`layoutWeight(1)` 的 `Stack`）挤成 **0 高** ⇒
          //    `List` 无空间 ⇒ **整片白屏**（真机 dump：坏态聊天区 `Stack h=0`、本 Row `h=1836`；
          //    好态 `h=1996`；无 todo 的会话不受影响 ⇒ 用户报的"切**一部分**会话必白"）。
          //    ⇒ 高度**由内容决定**（本条约 ~30vp）。
          // ⛔ 命中区（2026-10-14 用户亲报「todo 展开和收起区域要大一点，现在展开了收起不好交互」）：
          //    本 `Row` 是**折叠开关**，此前命中盒 = 内容固有高（≈30vp，图标/进度/文字里最高的那个）
          //    ⇒ 展开后用户想收起时，点在文字上下的留白**没有反应**，必须瞄准那一条窄带。
          //    ⇒ 给**真实 ≥ `HIT_TARGET_MIN`(44) 布局盒 + 占满可用宽**（`layoutWeight(1)`）：
          //    整条横带都可点（Apple 折叠行惯例），且**不靠 `responseRegion`**（真机实测负偏移外扩无效）。
          //    ⚠️ 纵向**仍由内容决定上限**（本 Row 在输入区的 `Column` 里，⛔ 不得 `height('100%')`
          //    —— 那会把聊天区挤成 0 高，见下方那条 2026-10-12 白屏根因注释）。
          .layoutWeight(1)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .justifyContent(FlexAlign.Start)
          .alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(this.expanded ? '收起待办清单' : '展开待办清单')
          .onClick(() => {
            // ── 展开/收起动效（用户 2026-10-14：「展开收起加一下动画吧」）──────────────────
            // 走底座唯一动效出口（`components/anim.ets` 的 `animBase()` 工厂；组件内调用路径
            // 与 `StagingTray` 同款 `this.getUIContext().animateTo(…)`）：
            // **只把 `expanded` 的翻转包进 animateTo** ⇒ 其引发的子树增删按底座曲线过渡
            // （列表体的 `.transition(fadeTransition())` + chevron 的 `animFast()` 旋转同时生效）。
            // ⛔ 不新造时长/曲线、⛔ 不动不透明度作为"可读性前提"（门禁 ⑨：静息态恒可见）。
            this.getUIContext().animateTo(animBase(), () => {
              this.expanded = !this.expanded;
            });
          })

          // 🎯「设为目标」—— 仅**无 goal** 时（web `TodoPullOut.tsx:113-121`）
          if (!this.hasGoal) {
            // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`；
            //    图标视觉尺寸不变（仍 `ICON_MD`=14，盒内居中）。
            Row() {
              SymbolGlyph($r('sys.symbol.dart_target'))
                .fontSize(ICON_MD)
                .fontColor([colorOf(this.pal(), 'iconMuted')])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText('设为目标')
            .onClick(() => {
              this.onSetGoal();
            })
          }
        }
        .width('100%')
        // ⛔ 控制条抬到 `HIT_TARGET_MIN`(44)：内含可点「设为目标」图标，其命中盒 = **自身布局盒**，
        //    而布局盒受父高约束 ⇒ 父高 <44 时命中区仍会被裁到 28。可靠性 > 视觉密度（原 `CONTROL_ROW_H`=28）。
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SP_3, right: SP_3 })

        // ── 展开态：清单 ─────────────────────────────────────────────────────────
        if (this.expanded) {
          // ⛔ 可滚容器（web `TodoPullOut.tsx:126` = `max-h-[240px] overflow-y-auto`）：裸 `Column` +
          //    `constraintSize(maxHeight)` 只能**裁切** ⇒ 超出的待办滚不下去（真机缺陷同族）。
          Scroll() {
            Column() {
            ForEach(this.todos, (t: TodoItem, i: number) => {
              TodoRowView({
                label: todoText(t),
                kind: todoStatusKind(t.status),
                isGoal: isGoalTodo(todoText(t), this.goalText),
                editing: this.editingIndex === i,
                draft: this.draft,
                editable: this.editable(),
                canSetGoal: this.canSetGoalTodo,
                theme: this.theme,
                onToggle: () => {
                  this.onToggleTodo(i);
                },
                onSetGoal: () => {
                  // web `TodoPullOut.tsx:305`：`onSetGoalTodo(todo.text)` —— 直接把本行文本设为目标
                  const tx: string = todoText(t);
                  if (tx.length > 0) {
                    this.onSetGoalTodo(tx);
                  }
                },
                onStartEdit: () => {
                  this.startEdit(i);
                },
                onDraft: (v: string) => {
                  this.draft = v;
                },
                onCommit: () => {
                  this.commitEdit();
                },
                onCancel: () => {
                  this.editingIndex = -1;
                },
                onRemove: () => {
                  this.onRemoveTodo(i);
                },
              })
              // ⛔ key 走 `core/todos.ets:todoRowKey`（**唯一真源纯函数**）—— 组件侧不出现裸状态
              //   字段（判据单一性门禁规则 A 的处方形态）。ArkUI 的 ForEach「key 不变则不重建
              //   该项」（ARKTS-GOTCHAS §11）⇒ key 必须含可变内容，这条判据连同判别力测试
              //   一起收敛到 `todoRowKey` 里。
            }, (t: TodoItem, i: number) => todoRowKey(t, i, this.editingIndex === i, this.goalText))
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({ left: SP_2, right: SP_2, top: 6, bottom: 6 })
          .border({ width: { top: STROKE_HAIRLINE }, color: hairlineOf(this.pal()) })
          }
          .width('100%')
          .constraintSize({ maxHeight: LIST_MAX_H })
          .scrollBar(BarState.Auto)
          // ── 展开/收起 = **出现过渡**（对齐 web `TodoPullOut` 的 `AnimatedCollapse`：`opacity 180ms`）──
          // 与 `ThinkingLine` 的展开体**同一个**具名工厂（⛔ 不新造工厂/时长；语义 = "内容出现/消失"）。
          // 静息态 = 组件自身属性（可见）⇒ 过渡没跑/被打断仍可读（fail-safe；门禁 ⑨ 的正向形态）。
          // ⚠️ 高度**不补间**（ArkUI `TransitionEffect` 无尺寸档，SDK 实证；web 那半是 CSS grid）——
          //    不在本处为动画改结构，详见 `ThinkingLine.ets` 同段注释。
          .transition(fadeTransition())
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
      .borderRadius(R_MD)
      // **面→面**轮廓 = `structuralRuleOf`（浅色 `borderStrong`，比面内强一档；深色 `border` 逐字节）——
      // 与 `SettingsRows`/`PluginHost` 的卡片同层级 ⇒ 同通道（`docs/DESIGN-SYSTEM.md §13.5`）。
      .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
      .clip(true)
    }
  }
}
