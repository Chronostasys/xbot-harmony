/**
 * MessageNav — 「用户消息导航」（web `web/src/components/agent/MessageUserNav.tsx` 同构）。
 *
 * ── 形态（以 web 为准，**不是**侧条 / 上下按钮）────────────────────────────────
 *   消息区**右上角**一枚 32×32 的悬浮小按钮（web `absolute right-2 top-2 z-10`），
 *   点击展开用户消息列表面板（web 是 hover 展开 + click 持久展开；**原生无 hover**
 *   ⇒ 等价为点击切换 + 点浮层外收起 —— 与 `ContextRing` / `ToolVisual` 的浮层同款写法）。
 *   条目 = 序号 `01/02…` + 用户消息（2 行截断）+ 同 turn 首个 assistant 回复（1 行截断）。
 *
 * ── 显示条件 ──────────────────────────────────────────────────────────────────
 *   **< 2 个用户锚点 ⇒ 整个导航不存在**（web `:138` `if (turns.length < 2) return null`）——
 *   由 `core/msgindex.ets:shouldShowNav` 唯一判定 ⇒ 未满足时**不产出任何节点**。
 *
 * ── 当前项高亮 ────────────────────────────────────────────────────────────────
 *   `activeSeq`（1-based，0=无）由页面用 `core/msgindex.ets:nearestSeq(userRowIndexes,
 *   visibleStart)` 算出（= web `:82-89` 的 `visibleStart + ACTIVE_ANCHOR_ROWS` 容差判定）；
 *   高亮样式 = `bg-accent/10`（web `:190`）。面板打开时滚到 active 条目（web `:129-136`
 *   把它居中 ⇒ 这里 `scrollToIndex(seq-1, CENTER)`）。
 *
 * ── 边界行为 ──────────────────────────────────────────────────────────────────
 *   web 无"上一个/下一个"按钮（**不自己造形态**）；前/后跳转的边界语义在
 *   `core/msgindex.ets:prevSeq/nextSeq`（**不环绕**，与 `activeSeq` 的 clamp 同源）。
 *
 * ⛔ 会变的内容（activeSeq / anchors / open）一律走**真 `@Component` + `@Prop`/`@State`**：
 *   带参 `@Builder` 的参数是"调用那一刻的快照"、其子树不随参数重建（docs/ARKTS-GOTCHAS §4）
 *   ⇒ 高亮会卡在首帧。条目因此是**独立 `@Component`**（`NavItemView`），不是带参 @Builder。
 * ⛔ 颜色只用 `pal()/eff()` 语义色，尺度只用 `core/tokens.ets`，动效用 `components/anim.ets`
 *   —— **禁硬编码 hex / 时长**。
 */
import { Effects, effectsOf, Palette, paletteOf } from '../core/theme';
import { R_MD, R_LG, SP_1, SP_2, FS_CAPTION } from '../core/tokens';
import { withAlpha } from '../core/bubble';
import { animFast } from './anim';
import { NavAnchor, seqLabel, shouldShowNav, userTextOrPlaceholder } from '../core/msgindex';

/** 按钮边长（web `size-8` = 32px）。 */
const BTN: number = 32;
/** 图标边长（web `ListTree size-4` = 16px）。 */
const ICON: number = 16;
/** 面板宽度（web `w-[min(20rem,calc(100vw-1.5rem))]`；手机取 20rem = 320px）。 */
const PANEL_W: number = 320;
/** 面板最大高度（web `max-h-[60vh]`；屏 ≈949vp ⇒ 收敛到 420，不遮满屏）。 */
const PANEL_MAX_H: number = 420;
/** 按钮常态不透明度（web `opacity-40`；展开/激活时回到 1）。 */
const BTN_IDLE_ALPHA: number = 0.4;
/** accent 底纹不透明度（web `bg-accent/10`）。 */
const ACCENT_TINT: number = 0.1;
/** 按钮底/描边的不透明度（web `bg-bg-secondary/80` + `border-border/50`）。 */
const BTN_BG_ALPHA: number = 0.8;
const BTN_BORDER_ALPHA: number = 0.5;
/** 面板内边距（web `p-1.5` = 6px）。 */
const PANEL_PAD: number = 6;
/** 条目内边距（web `px-2 py-1.5` = 8 / 6）。 */
const ITEM_PAD_X: number = 8;
const ITEM_PAD_Y: number = 6;
/** 摘要行的缩进（web `pl-6` = 24px）。 */
const ITEM_INDENT: number = 24;
/** 序号/摘要字号（web `text-[10px]`）。 */
const FS_MICRO: number = 10;

/**
 * 面板里的**一个条目**（web `MessageUserNav.tsx:173-204`）。
 *
 * ⛔ 独立 `@Component` + `@Prop`（不是带参 @Builder）：`active` 变化必须驱动重渲染，
 *   否则高亮卡在首帧（ARKTS-GOTCHAS §4）。父级 ForEach 的 key 同时把 `active` 编进去
 *   —— ArkUI 的 ForEach **key 不变则不重建该项**（§3），@Prop 更新依赖父级重新执行 item
 *   builder，故 key 必须随 active 变化（与 `rowdiff.sessionScopedRowKey` 的 rev 同源手法）。
 */
@Component
struct NavItemView {
  /** 序号文字（`01`/`02`…）。 */
  @Prop seqLabel: string = '';
  /** 用户消息全文（显示 2 行截断）。 */
  @Prop userText: string = '';
  /** 同 turn 首个 assistant 回复（1 行截断；空 ⇒ 不显示该行）。 */
  @Prop assistantText: string = '';
  /** 是否为"当前可视"条目（高亮 `bg-accent/10`）。 */
  @Prop active: boolean = false;
  @Prop theme: string = 'dark';
  /** 点击 → 页面跳转（并收起面板）。 */
  onPick: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column() {
      Row({ space: SP_1 + 2 }) {   // web `gap-1.5` = 6px
        Text(this.seqLabel)
          .fontSize(FS_MICRO)
          .fontFamily('monospace')   // web `font-mono`
          .fontColor(this.pal().textMuted)
        Text(userTextOrPlaceholder(this.userText))
          .fontSize(FS_CAPTION)      // web `text-xs`
          .fontColor(this.pal().textPrimary)
          .maxLines(2)               // web `line-clamp-2`
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL)   // web `break-all`（长 URL 不撑破）
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      if (this.assistantText.length > 0) {
        Text(this.assistantText)
          .fontSize(FS_MICRO)
          .fontColor(this.pal().textMuted)
          .maxLines(1)               // web `line-clamp-1`
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .wordBreak(WordBreak.BREAK_ALL)
          .textAlign(TextAlign.Start)
          .width('100%')
          .padding({ left: ITEM_INDENT })   // web `pl-6`
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: ITEM_PAD_X, right: ITEM_PAD_X, top: ITEM_PAD_Y, bottom: ITEM_PAD_Y })
    // 当前项高亮（web `bg-accent/10`）；其余透明
    .backgroundColor(this.active ? withAlpha(this.pal().accent, ACCENT_TINT) : this.pal().transparent)
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onPick();
    })
  }
}

/**
 * 用户消息导航（右上角悬浮按钮 + 浮层列表）。
 *
 * ⚠️ 本组件**只负责自身视觉与交互**；右上角定位、`anchors` / `activeSeq` 的派生、
 *    `scrollToIndex` 的实际执行由页面（`pages/Index.ets`）注入 —— 见文件头说明。
 */
@Component
export struct MessageNav {
  /**
   * 用户消息锚点（由页面用 `core/msgindex.ets:buildAnchors(rows, userAnchorRows(rows))` 生成）。
   * 长度 < 2 ⇒ **不渲染任何节点**。
   */
  @Prop anchors: NavAnchor[] = [];
  /** 当前可视锚点序号（1-based；0 = 无）—— `core/msgindex.ets:nearestSeq`。 */
  @Prop activeSeq: number = 0;
  /** 跳转回调：页面收到行下标后 `scrollToIndex` 并解除贴底跟随。 */
  onNavigate: (rowIndex: number) => void = (rowIndex: number) => {
  };
  @Prop theme: string = 'dark';

  /** 面板是否展开（点击切换；点浮层外由 `onWillDismiss` 收起）。 */
  @State open: boolean = false;
  /** 面板滚动器（展开时把 active 条目滚到中间 —— web `:129-136`）。 */
  private panelScroller: Scroller = new Scroller();

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  build() {
    // ⛔ 唯一显示判据（web `:138`）：< 2 个锚点 ⇒ 不产出任何节点（无占位、无空行）。
    if (shouldShowNav(this.anchors.length)) {
      Stack() {
        // web 用 lucide `ListTree`（消息目录）；HarmonyOS 无同名符号 ⇒ 取语义最近的
        // `list_bullet`（列表目录）。**不自造图形**。
        SymbolGlyph($r('sys.symbol.list_bullet'))
          .fontSize(ICON)
          .fontColor([this.open ? this.pal().accent : this.pal().textSecondary])
      }
      .width(BTN)
      .height(BTN)
      // web `flex items-center justify-center` ⇒ Stack 用 alignContent（Stack 无 justifyContent）
      .alignContent(Alignment.Center)
      .borderRadius(R_MD)                 // web `rounded-md`
      .backgroundColor(this.open
        ? withAlpha(this.pal().accent, ACCENT_TINT)          // web `bg-accent/10`
        : withAlpha(this.pal().surface, BTN_BG_ALPHA))        // web `bg-bg-secondary/80`
      .backdropBlur(this.eff().glassBlur)                    // web `backdrop-blur`
      .border({ width: 1, color: withAlpha(this.pal().border, BTN_BORDER_ALPHA) })
      .opacity(this.open ? 1 : BTN_IDLE_ALPHA)               // web `opacity-40` → 激活 100%
      .animation(animFast())                                 // web `transition-all`
      .onClick(() => {
        this.open = !this.open;
      })
      .bindPopup(this.open, {
        builder: this.PanelBody,
        placement: Placement.BottomRight,   // 右上角按钮 ⇒ 面板向左下展开
        enableArrow: false,
        mask: false,
        popupColor: this.pal().surface,     // web `bg-bg-elevated`（= bg-secondary-src）
        radius: R_MD,
        width: PANEL_W,
        onWillDismiss: (action: DismissPopupAction) => {
          this.open = false;
        },
      })
    }
  }

  /** 浮层内容：用户消息列表（web `:166-207` 的 panel）。无参 @Builder ⇒ 读 `this` 随状态重建。 */
  @Builder
  PanelBody() {
    List({ scroller: this.panelScroller }) {
      ForEach(this.anchors, (a: NavAnchor) => {
        ListItem() {
          NavItemView({
            seqLabel: seqLabel(a.seq),
            userText: a.userText,
            assistantText: a.assistantText,
            active: a.seq === this.activeSeq,
            theme: this.theme,
            onPick: () => {
              // 跳转后收起（web `:183-187`）
              this.onNavigate(a.rowIndex);
              this.open = false;
            },
          })
        }
      },
        // ⛔ key 必须含 active：ForEach key 不变 ⇒ 该项不重建 ⇒ @Prop `active` 不更新
        //   ⇒ 高亮卡在旧位置（ARKTS-GOTCHAS §3）。含 active 后仅"旧/新当前项"两项重建。
        (a: NavAnchor) => `${a.rowIndex}#${a.seq}#${a.seq === this.activeSeq ? 'A' : 'w'}`)
    }
    .width('100%')
    .constraintSize({ maxHeight: PANEL_MAX_H })   // web `max-h-[60vh]`
    .scrollBar(BarState.Auto)                     // web `overflow-y-auto`
    .padding(PANEL_PAD)                           // web `p-1.5`
    .onAppear(() => {
      // 展开时把当前条目滚到中间（web `:129-136`：`offsetTop - (clientHeight-h)/2`）。
      // ⚠️ 浮层刚创建时条目尚未完成布局 ⇒ 真机可能需要在下一帧再滚（见 Pitfalls）。
      if (this.activeSeq > 0 && this.activeSeq <= this.anchors.length) {
        this.panelScroller.scrollToIndex(this.activeSeq - 1, true, ScrollAlign.CENTER);
      }
    })
  }
}
