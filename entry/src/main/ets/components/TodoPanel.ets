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
import { isLightPalette, Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, R_MD, R_SM, SP_1, SP_2, SP_3 } from '../core/tokens';
import { withAlpha } from '../core/bubble';
import { animFast } from './anim';
import { TodoItem } from '../core/types';
import {
  hasTodos, isGoalTodo, TODO_DONE, TODO_DOING, todoCountLabel, todoPercent, todoState, TodoState,
  todoStatusKind, todoText,
} from '../core/todos';

/** 收起态行高（web `h-7` = 28px）。 */
const HEADER_H: number = 28;
/** 进度条尺寸（web `h-1.5 w-12` = 6×48）。 */
const BAR_W: number = 48;
const BAR_H: number = 6;
/** 展开区最大高度（web `max-h-[240px]`）。 */
const LIST_MAX_H: number = 240;
/** 图标字号（web 触屏 `h-4 w-4` = 16，桌面 12）。 */
const ICON: number = 14;
/** goal 行底纹：深色 7%（web `bg-accent/[0.07]`）、浅色取 14%（白底 7% 不可见）。
 *  ⛔ 用 `isLightPalette` 判**色板亮度**，不按主题名。 */
const GOAL_TINT_DARK: number = 0.07;
const GOAL_TINT_LIGHT: number = 0.14;
/** 行按压反馈不透明度。 */
const PRESS_OPACITY: number = 0.7;

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
  @Prop theme: string = 'dark';
  onToggle: () => void = () => {
  };
  onStartEdit: () => void = () => {
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

  /** 状态图标色（web `:239-243`：done → `--status-success`，doing → accent，pending → muted）。 */
  private iconColor(): string {
    if (this.kind === TODO_DONE) {
      return this.pal().successText;
    }
    if (this.kind === TODO_DOING) {
      return this.pal().accent;
    }
    return this.pal().textMuted;
  }

  /** 状态图标（HarmonyOS 无 `Circle`/`Loader2` ⇒ `circle` / `circle_dashed` / `checkmark_circle_fill`）。 */
  private iconRes(): Resource {
    if (this.kind === TODO_DONE) {
      return $r('sys.symbol.checkmark_circle_fill');
    }
    if (this.kind === TODO_DOING) {
      return $r('sys.symbol.circle_dashed');
    }
    return $r('sys.symbol.circle');
  }

  private goalTint(): string {
    const alpha: number = isLightPalette(this.pal()) ? GOAL_TINT_LIGHT : GOAL_TINT_DARK;
    return withAlpha(this.pal().accent, alpha);
  }

  build() {
    Row({ space: SP_2 }) {
      // 状态图标（点击 = 勾选/取消；web `data-testid="todo-status"`）
      SymbolGlyph(this.iconRes())
        .fontSize(ICON)
        .fontColor([this.iconColor()])
        .onClick(() => {
          this.onToggle();
        })

      if (this.editing) {
        // 就地编辑（web 桌面分支 `:188-210`：Enter 保存 / Esc 取消）
        TextInput({ text: this.draft })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_SM)
          .padding({ left: SP_2, right: SP_2 })
          .layoutWeight(1)
          .onChange((v: string) => {
            this.onDraft(v);
          })
          .onSubmit(() => {
            this.onCommit();
          })
      } else {
        Text(this.label)
          .fontSize(FS_CAPTION)
          .fontColor(this.kind === TODO_DONE ? this.pal().textMuted : this.pal().textPrimary)
          .fontWeight(this.kind === TODO_DOING ? FontWeight.Medium : FontWeight.Normal)
          // done ⇒ 删除线（web `line-through`）
          .decoration(this.kind === TODO_DONE
            ? { type: TextDecorationType.LineThrough, color: this.pal().textMuted }
            : { type: TextDecorationType.None })
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL)
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
          .onClick(() => {
            if (this.editable) {
              this.onStartEdit();
            }
          })
      }

      // goal 徽标（web `data-testid="todo-goal-badge"`）
      if (this.isGoal) {
        Text('goal')
          .fontSize(9)
          .fontColor(this.pal().accent)
          .backgroundColor(withAlpha(this.pal().accent, isLightPalette(this.pal()) ? 0.18 : 0.15))
          .borderRadius(R_SM)
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
      }

      // 触屏操作菜单（web 触屏分支只留一个 `⋯`：编辑 / 删除；桌面是三枚 hover 图标）
      if (this.editable) {
        SymbolGlyph($r('sys.symbol.line_3_horizontal'))
          .fontSize(ICON)
          .fontColor([this.pal().textSecondary])
          .onClick(() => {
            this.menuOpen = !this.menuOpen;
          })
          .bindPopup(this.menuOpen, {
            builder: this.RowMenu,
            placement: Placement.BottomRight,
            enableArrow: false,
            mask: false,
            popupColor: this.pal().surface,
            radius: R_MD,
            onWillDismiss: (action: DismissPopupAction) => {
              this.menuOpen = false;
            },
          })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ left: SP_1, right: SP_1, top: 5, bottom: 5 })
    .borderRadius(R_SM)
    .backgroundColor(this.isGoal ? this.goalTint() : this.pal().transparent)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
  }

  /** `⋯` 菜单（web 触屏 Popover：编辑 / 删除）。 */
  @Builder
  RowMenu() {
    Column() {
      Text('编辑')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .width('100%')
        .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
        .onClick(() => {
          this.menuOpen = false;
          this.onStartEdit();
        })
      Text('删除')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().dangerText)
        .width('100%')
        .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
        .onClick(() => {
          this.menuOpen = false;
          this.onRemove();
        })
    }
    .width(120)
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
  @Prop theme: string = 'dark';
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
        Row({ space: SP_2 }) {
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .fontSize(12)
            .fontColor([this.pal().textMuted])
            .rotate({ angle: this.expanded ? 90 : 0 })
            .animation(animFast())
          Progress({ value: todoPercent(this.state()), total: 100, type: ProgressType.Linear })
            .width(BAR_W)
            .height(BAR_H)
            .color(this.pal().accent)
            .backgroundColor(this.pal().surfaceAlt)
            .style({ strokeWidth: BAR_H, enableSmoothEffect: true })
          Text(todoCountLabel(this.state()))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textSecondary)
          Text(this.state().currentText.length > 0 ? this.state().currentText : '全部完成')
            .fontSize(FS_CAPTION)
            .fontColor(this.state().currentText.length > 0 ? this.pal().textPrimary : this.pal().textMuted)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .height(HEADER_H)
        .padding({ left: SP_3, right: SP_3 })
        .onClick(() => {
          this.expanded = !this.expanded;
        })

        // ── 展开态：清单 ─────────────────────────────────────────────────────────
        if (this.expanded) {
          Column() {
            ForEach(this.todos, (t: TodoItem, i: number) => {
              TodoRowView({
                label: todoText(t),
                kind: todoStatusKind(t.status),
                isGoal: isGoalTodo(todoText(t), this.goalText),
                editing: this.editingIndex === i,
                draft: this.draft,
                editable: this.editable(),
                theme: this.theme,
                onToggle: () => {
                  this.onToggleTodo(i);
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
              // ⛔ key 含**可变内容**（状态/文本/编辑态/徽标）：ArkUI 的 ForEach「key 不变则
              //   不重建该项」（ARKTS-GOTCHAS §3）⇒ 勾选/改名后 UI 会卡在旧值。
            }, (t: TodoItem, i: number) =>
              `${i}#${todoStatusKind(t.status)}#${todoText(t)}#${this.editingIndex === i ? 'E' : ''}`
              + `#${isGoalTodo(todoText(t), this.goalText) ? 'G' : ''}`)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .constraintSize({ maxHeight: LIST_MAX_H })
          .padding({ left: SP_2, right: SP_2, top: 6, bottom: 6 })
          .border({ width: { top: 1 }, color: this.pal().border })
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .backgroundColor(this.pal().surface)
      .borderRadius(R_MD)
      .border({ width: 1, color: this.pal().border })
      .clip(true)
    }
  }
}
