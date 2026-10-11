/**
 * MenuSheets —— 三块「底部操作菜单」弹层（P2-2 抽出）。
 *
 * 来源：`pages/Index.ets` 的 `@Builder SessSheet()` / `SearchHitsSheet()` /
 * `ContextSheet()`，以及三者**共用**的 `@Builder CtxItem()`（原 `Index.ets:5078–5207`）。
 * ArkUI 允许同文件多 struct（同 `components/ToolPopover.ets`：`ToolPopoverCard` + `ToolOverflowList`）。
 *
 * ── 分层铁律（同 StatusSheet / QueueSheet / PluginsSheet）───────────────────────
 *   · **判据/派发不入组件**：三个 sheet 只吃**已算好的数据**（标题字符串、bool、数组）+
 *     回调；`showSearchHits` / `sessMenuId` / `sessConfirmDelete` / `ctxOpen`
 *     等弹层 flag 所有权**留页面**（`core/overlays.topOverlay` 要求 flag 集中）。
 *   · **派发收敛**：CtxItem 的动作项仍走 `onItem(code)`；原页面分支
 *     （`MOVE_*` / `rename` / `fork` / `delete` → `runSessAction`；其余 → `runCtxAction`）
 *     **逐字留在页面** `onSheetItem()`。
 *   · **`CtxItem` 刻意保持各 struct 自持的带参 `@Builder`**（不是 `@Component`，也**不可**抽成
 *     全局 builder）：它承载「确认删除（再点一次）」这类**会变的 label**，label 由
 *     `@Prop confirmDelete` 经**父组件重建**通道驱动（`docs/ARKTS-GOTCHAS.md §4`）。
 *     ⛔ ArkUI 的属性方法**不能挂到 `@Builder` 调用处**（只能写在 builder 体内的元素上）
 *     ⇒ 三个 struct 各持一份同款 `CtxItem`（沿用抽取前的既有形态，不新造共享机制）。
 *
 * ── 关闭路径统一（P0 结构性防线，2026-10-11 本波）──────────────────────────────
 *   **每个 sheet 自带 `onClose`（`@Prop`）**，末位「取消 / 关闭」项**只**调 `onClose()`。
 *   旧实现让取消项回调 `onItem('cancel')`，落到页面 `runCtxAction('cancel')` ——
 *   **写的是 `ctxOpen`（长按菜单的 flag）**，而 SessSheet 的 flag 是 `sessMenuId`
 *   ⇒ 会话菜单的「取消」**关不掉自己**（与 `PrefsSheet` 的 X 写错 flag 同类事故）。
 *   `onClose` 让每个面板**只**关自己（页面注入各自的 flag 写入，见交付补丁）。
 *
 * ── 按新设计系统重排（2026-10-11 本波）────────────────────────────────────────
 *   旧实现走玻璃材质（`effectsOf().glassBg` + `backgroundBlurStyle` + `glassBorder` 围边），
 *   字号/内距全写死（`fontSize(14/13/12)`、`padding({left:16,top:11})`）。
 *   本版按宪法 §3.1「`surface.overlay` = Sheet / 菜单面板」重排：
 *     · 面 = `surfaceFillOf(p,'surface.overlay')`（**不透明**浮层语义面）＋ **上边一条结构性
 *       发丝** `hairlineOf(p)` ＋ 浮层柔影 `elevationColorOf(p, ELEV_OVERLAY)`；
 *       `RADIUS_SHEET` 只收上两角（贴底）。⛔ 不再用 `glassBorder` 做装饰性围边。
 *     · 菜单行 `constraintSize({ minHeight: HIT_TARGET_MIN })`（≥44）；按压 = 面提升一档
 *       （`surface.overlayRowHover`）；不可点的项给 `DISABLED_OPACITY` 且不派发。
 *     · 字 = `type.*` 角色（菜单项 `type.callout` / 组头与元信息 `type.caption`）。
 *     · 空态：搜索命中为 0 ⇒ 一行小字（`textMuted`，无填充/无边框/无发光；§10）。
 *
 * ⛔ 会变的内容走真 `@Component` + `@Prop`；颜色只走 `core/design.ets`（零字面量，⑥c 硬红）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { SearchHit } from '../core/types';
import { hitLine, MOVE_DOWN, MOVE_TOP, MOVE_UP } from '../core/sessionops';
import { linkLabel } from '../core/msgops';
import { CtxMenuItem, iterMenuItems, toolsMenuItems, userMenuItems } from '../core/ctxmenu';
import {
  PRESS_OPACITY,   DISABLED_OPACITY, HIT_TARGET_MIN, ICON_MD, INSET_ROW_X, INSET_ROW_Y, RADIUS_CHIP, RADIUS_SHEET,
  SPACE_LG, SPACE_SM, SPACE_XS, SPACE_XXS, STROKE_HAIRLINE, colorOf, hairlineOf, surfaceFillOf,
} from '../core/design';
import { fs, fw, lh, tc } from './SettingsRows';
import { sheetTransition } from './anim';

/** 浮层档（`overlay`）的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
function overlayLayers(p: Palette): ShadowLayer[] {
  return shadowLayersOf(p, 'overlay');
}

/**
 * 「关闭本面板」的哨兵码 —— `CtxItem` 收到它即走 `onClose()`，⛔ **不进 `onItem` 派发**
 * （旧实现把取消塞进 `onItem('cancel')`，导致"关错人"）。
 */
const MENU_CLOSE: string = '__close__';

/**
 * 搜索命中列表最大高（vp）。
 * ⚠️ **报备**：无 `list.maxHeight` token（仓内 QueueSheet/PluginsSheet 亦为字面量高度）。
 */
const HITS_MAX_H: number = 420;

/** 会话操作菜单（贴底；删除需二次确认）。 */
@Component
export struct SessSheet {
  @Prop theme: string = 'dark';
  /** 菜单标题（页面 `menuLabel()` 的产物）。 */
  @Prop title: string = '';
  /** 置顶/上移/下移是否可点（页面 `menuCanMove(...)`）。 */
  @Prop canTop: boolean = false;
  @Prop canUp: boolean = false;
  @Prop canDown: boolean = false;
  /** 是否已进入"确认删除（再点一次）"态（页面 `sessConfirmDelete === sessMenuId`）。 */
  @Prop confirmDelete: boolean = false;
  /** 当前会话是否已标星（页面 `isStarredChat(sessMenuId)`）—— 决定本项文案「标星/取消标星」。 */
  @Prop starred: boolean = false;
  /** 菜单项点击（页面 `onSheetItem(code)` —— 派发留页面）。 */
  onItem: (code: string) => void = () => {
  };
  /** 关闭本菜单（面板**自己**的关闭入口；页面写**本面板自己的** flag）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 菜单项图标（**按动作码映射**，`$r` 只能写字面量 ⇒ 用 switch 而非拼串）。
   * 字形名**逐个经字体真源核对**（`HMSymbolVF.ttf` 的 `post` 表）：置顶 `arrow_up_to_line`、
   * 上移 `arrow_up`、下移 `arrow_down`、标星 `star`/`star_fill`、重命名 `square_and_pencil`、
   * 分支 `split`、删除 `trash`、取消 `xmark`。
   */
  private iconOf(code: string): Resource {
    if (code === MOVE_TOP) {
      return $r('sys.symbol.arrow_up_to_line');
    }
    if (code === MOVE_UP) {
      return $r('sys.symbol.arrow_up');
    }
    if (code === MOVE_DOWN) {
      return $r('sys.symbol.arrow_down');
    }
    if (code === 'star') {
      return this.starred ? $r('sys.symbol.star_fill') : $r('sys.symbol.star');
    }
    if (code === 'rename') {
      return $r('sys.symbol.square_and_pencil');
    }
    if (code === 'fork') {
      return $r('sys.symbol.split');
    }
    if (code === 'delete') {
      return $r('sys.symbol.trash');
    }
    return $r('sys.symbol.xmark');
  }

  /** 破坏性动作（「删除 / 确认删除」）⇒ 图标与文字一律 `dangerText` 红（Apple 口径）。 */
  private dangerOf(code: string): boolean {
    return code === 'delete';
  }

  /**
   * 菜单里的一项（**各 struct 自持的带参 @Builder** —— 见文件头；⛔ 不要改成 `@Component`）。
   * `dim = true` ⇒ 当前不可点（如已在顶部的「置顶」）：`DISABLED_OPACITY` + 不派发。
   *
   * 排版（对标 iOS 上下文菜单）：`图标 + 文字`，图标 20vp 定宽列（无图标也占位以对齐文字基线）。
   * 破坏性项（删除）走 `dangerText`；其余文字 `textPrimary`、图标 `iconMuted`（弱色，走 `colorOf`）。
   */
  @Builder
  CtxItem(label: string, code: string, dim: boolean) {
    Row({ space: SPACE_SM }) {
      SymbolGlyph(this.iconOf(code))
        .fontSize(ICON_MD)
        .fontColor([this.dangerOf(code) ? colorOf(this.pal(), 'dangerText') : colorOf(this.pal(), 'iconMuted')])
      Text(label)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.callout'))
        .lineHeight(lh('type.callout'))
        .fontColor(this.dangerOf(code) ? colorOf(this.pal(), 'dangerText') : this.pal().textPrimary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .opacity(dim ? DISABLED_OPACITY : 1)
    .stateStyles({ pressed: { .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRowHover')) } })
    .onClick(() => {
      if (dim) {
        return;
      }
      if (code === MENU_CLOSE) {
        this.onClose();
        return;
      }
      this.onItem(code);
    })
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（小半径）、far = 环境影（大半径）；深色：near 透明、far = 原值（逐字节不变）。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: 0 }) {
        Text(this.title)
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(tc(this.pal(), 'type.caption'))
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_XS })
        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X })
        this.CtxItem(this.canTop ? '置顶' : '置顶（已在顶部）', MOVE_TOP, !this.canTop)
        this.CtxItem(this.canUp ? '上移' : '上移（已在顶部）', MOVE_UP, !this.canUp)
        this.CtxItem(this.canDown ? '下移' : '下移（已在底部）', MOVE_DOWN, !this.canDown)
        // 标星：**唯一**交互入口（行体只留一枚小标记 ⇒ 标题不再被 44 热区挤掉；对齐 web
        // `SessionItem.tsx` 把 star 放进 context menu 的口径）。文案随状态（web `session.star/unstar`）。
        this.CtxItem(this.starred ? '取消标星' : '标星', 'star', false)
        this.CtxItem('重命名', 'rename', false)
        this.CtxItem('分支（fork 出新会话）', 'fork', false)
        this.CtxItem(this.confirmDelete ? '确认删除（再点一次）' : '删除', 'delete', false)
        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        this.CtxItem('取消', MENU_CLOSE, false)
      }
      .width('100%')
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
      .borderWidth({ top: STROKE_HAIRLINE })
      .borderColor(hairlineOf(this.pal()))
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: overlayLayers(this.pal())[0].radius,
        color: overlayLayers(this.pal())[0].color,
        offsetX: 0, offsetY: overlayLayers(this.pal())[0].offsetY,
      })
      .padding({ bottom: SPACE_XS })
      .alignItems(HorizontalAlign.Start)
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev3`/`glow`，逐字节不变）。
    .width('100%')
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
    .shadow({
      radius: overlayLayers(this.pal())[1].radius,
      color: overlayLayers(this.pal())[1].color,
      offsetX: 0, offsetY: overlayLayers(this.pal())[1].offsetY,
    })
    .transition(sheetTransition())
  }
}

/** 会话内消息搜索结果（点一条复制该片段；只覆盖当前会话）。 */
@Component
export struct SearchHitsSheet {
  @Prop theme: string = 'dark';
  /** 当前会话的搜索命中（页面 `searchHits`）。 */
  @Prop hits: SearchHit[] = [];
  /** 点一条命中（页面：复制该片段 + 关面板）。 */
  onPickHit: (snippet: string) => void = () => {
  };
  /** 菜单项点击（页面 `onSheetItem(code)` —— 派发留页面）。 */
  onItem: (code: string) => void = () => {
  };
  /** 关闭本面板（面板**自己**的关闭入口）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 带参 @Builder（同 `SessSheet.CtxItem`；⛔ 不要改成 @Component）。 */
  @Builder
  CtxItem(label: string, code: string, dim: boolean) {
    Row() {
      Text(label)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.callout'))
        .lineHeight(lh('type.callout'))
        .fontColor(this.pal().textPrimary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .opacity(dim ? DISABLED_OPACITY : 1)
    .stateStyles({ pressed: { .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRowHover')) } })
    .onClick(() => {
      if (dim) {
        return;
      }
      if (code === MENU_CLOSE) {
        this.onClose();
        return;
      }
      this.onItem(code);
    })
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（小半径）、far = 环境影（大半径）；深色：near 透明、far = 原值（逐字节不变）。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: 0 }) {
        Text(`本会话命中 ${this.hits.length} 条（点一条复制片段）`)
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(tc(this.pal(), 'type.caption'))
          .width('100%')
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_XS })
        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X })

        if (this.hits.length === 0) {
          // ── 空态：一行小字（无填充/无边框/无发光；§10）─────────────────────────
          Text('当前会话里没有匹配的消息')
            .fontSize(fs('type.callout'))
            .fontWeight(fw('type.callout'))
            .lineHeight(lh('type.callout'))
            .fontColor(this.pal().textMuted)
            .width('100%')
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        } else {
          List({ space: SPACE_XS }) {
            ForEach(this.hits, (h: SearchHit, i: number) => {
              ListItem() {
                Text(hitLine(h.role !== undefined ? h.role : '', h.snippet !== undefined ? h.snippet : '', 120))
                  .fontSize(fs('type.callout'))
                  .fontWeight(fw('type.callout'))
                  .lineHeight(lh('type.callout'))
                  .fontColor(this.pal().textPrimary)
                  .width('100%')
                  .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                  .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))
                  .borderRadius(RADIUS_CHIP)
                  .constraintSize({ minHeight: HIT_TARGET_MIN })
                  .maxLines(3)
                  // ⛔ `maxLines` 必须配 `textOverflow`：不配 = 默认 `Clip` ⇒ 第 4 行起**静默消失**
                  //    （连 `…` 都没有，用户不知道还有内容）。搜素命中行是**动态长文本**，正是这类。
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .wordBreak(WordBreak.BREAK_ALL)
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    this.onPickHit(h.snippet !== undefined ? h.snippet : '');
                  })
              }
            }, (h: SearchHit, i: number) => `hit-${h.id}#${i}`)
          }
          .constraintSize({ maxHeight: HITS_MAX_H })
          .width('100%')
          // ⛔ 用户报「滚动栏挡住交互」：命中行**整行可点**（`onClick`），默认 `BarState.Auto` 的滚动条
          //    叠在行右缘、参与命中测试 ⇒ 会抢掉行右侧的点击。面板内短列表 ⇒ 显式关条
          //    （本仓浮层口径：`AskUserSheet`/`PluginHost`/`QueueSheet` 同为 `Off`）。
          .scrollBar(BarState.Off)
        }

        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        this.CtxItem('关闭', MENU_CLOSE, false)
      }
      .width('100%')
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
      .borderWidth({ top: STROKE_HAIRLINE })
      .borderColor(hairlineOf(this.pal()))
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: overlayLayers(this.pal())[0].radius,
        color: overlayLayers(this.pal())[0].color,
        offsetX: 0, offsetY: overlayLayers(this.pal())[0].offsetY,
      })
      .padding({ bottom: SPACE_XS })
      .alignItems(HorizontalAlign.Start)
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev3`/`glow`，逐字节不变）。
    .width('100%')
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
    .shadow({
      radius: overlayLayers(this.pal())[1].radius,
      color: overlayLayers(this.pal())[1].color,
      offsetX: 0, offsetY: overlayLayers(this.pal())[1].offsetY,
    })
    .transition(sheetTransition())
  }
}

/** 长按操作菜单（底部弹出，贴手指易点区）。 */
@Component
export struct ContextSheet {
  @Prop theme: string = 'dark';
  /** 长按目标类型（页面 `ctxKind`：`'user'` / `'tool'` / `'iter'` / 其余=消息）。 */
  @Prop ctxKind: string = '';
  /** 目标里的链接（页面 `ctxLinks()` 的产物，已截断 ≤3）。 */
  @Prop links: string[] = [];
  /**
   * 迭代菜单的**空项过滤**开关（判据 = `core/ctxmenu.iterMenuItems`，对齐 web
   * `MessageActions.tsx:298-301`）。**缺省 `true`（向后兼容：不投递时行为不变）。**
   */
  @Prop canIterReply: boolean = true;
  @Prop canIterThinking: boolean = true;
  @Prop canIterTools: boolean = true;
  /**
   * **工具（组）**菜单（`ctxKind === 'tools'`，对齐 web `MessageActions.tsx:302-312`）：
   * 逐枚工具名 + 逐枚"可复制文本非空"标记 + 组级拼接是否非空。判据 = `core/ctxmenu.toolsMenuItems`。
   */
  @Prop toolNames: string[] = [];
  @Prop toolHasText: boolean[] = [];
  @Prop toolsAllHasText: boolean = false;
  /**
   * 该 user 消息此刻**是否可 rewind**（`ctxKind === 'user'`）—— 判据 = `core/ctxmenu.userMenuItems`
   * （不可 ⇒ 「编辑并重发」**置灰**，对齐 web `UserMessage.tsx:322 disabled={editDisabled}`）。
   * **缺省 `true`（向后兼容：不投递时行为不变）。**
   */
  @Prop canRewind: boolean = true;
  /** 菜单项点击（页面 `onSheetItem(code)` —— 派发留页面）。 */
  onItem: (code: string) => void = () => {
  };
  /** 关闭本面板（面板**自己**的关闭入口）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 带参 @Builder（同 `SessSheet.CtxItem`；⛔ 不要改成 @Component）。 */
  @Builder
  CtxItem(label: string, code: string, dim: boolean) {
    Row() {
      Text(label)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.callout'))
        .lineHeight(lh('type.callout'))
        .fontColor(this.pal().textPrimary)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .opacity(dim ? DISABLED_OPACITY : 1)
    .stateStyles({ pressed: { .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRowHover')) } })
    .onClick(() => {
      if (dim) {
        return;
      }
      if (code === MENU_CLOSE) {
        this.onClose();
        return;
      }
      this.onItem(code);
    })
  }

  private headerLabel(): string {
    return this.ctxKind === 'tool' ? '工具操作' : (this.ctxKind === 'iter' ? '迭代操作' : '消息操作');
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（小半径）、far = 环境影（大半径）；深色：near 透明、far = 原值（逐字节不变）。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: 0 }) {
        Text(this.headerLabel())
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(tc(this.pal(), 'type.caption'))
          .width('100%')
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_XS })
        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X })

        if (this.ctxKind === 'user') {
          // 判据与渲染同源 = `core/ctxmenu.userMenuItems`（不可 rewind ⇒ 「编辑并重发」置灰、派发被拒；
          // 对齐 web `UserMessage.tsx:322 disabled={editDisabled}` —— 是**可见的禁用**，不隐藏）。
          ForEach(userMenuItems(this.canRewind), (m: CtxMenuItem, i: number) => {
            this.CtxItem(m.label, m.code, m.dim)
          }, (m: CtxMenuItem, i: number) => `ctx-user-${i}-${m.code}`)
        } else if (this.ctxKind === 'tool') {
          this.CtxItem('复制输出', 'tool-out', false)
          this.CtxItem('复制参数', 'tool-args', false)
          this.CtxItem('复制全部（名字+参数+输出）', 'tool-all', false)
        } else if (this.ctxKind === 'tools') {
          // 工具**组**级菜单（对齐 web `MessageActions.tsx:302-312`）：逐枚 + 组级「复制全部工具输出」，
          // 空项同样按设计过滤。判据与渲染同源 = `core/ctxmenu.toolsMenuItems`。
          ForEach(toolsMenuItems(this.toolNames, this.toolHasText, this.toolsAllHasText),
            (m: CtxMenuItem, i: number) => {
              this.CtxItem(m.label, m.code, false)
            }, (m: CtxMenuItem, i: number) => `ctx-tools-${i}-${m.code}`)
        } else if (this.ctxKind === 'iter') {
          // 空项按设计过滤（对齐 web `MessageActions.tsx:298-301`）：判据与渲染同源
          // = `core/ctxmenu.iterMenuItems`（服务端会把"还是空壳的在飞迭代"记进历史 ⇒ 旧实现恒 3 项、
          // 点「正文」只得一个"没有可复制的内容" toast）。
          ForEach(iterMenuItems(this.canIterReply, this.canIterThinking, this.canIterTools),
            (m: CtxMenuItem, i: number) => {
              this.CtxItem(m.label, m.code, false)
            }, (m: CtxMenuItem, i: number) => `ctx-iter-${i}-${m.code}`)
        } else {
          this.CtxItem('复制回复', 'row-reply', false)
          this.CtxItem('复制（含思考）', 'row-thinking', false)
          this.CtxItem('复制（含工具）', 'row-tools', false)
          this.CtxItem('复制原始 Markdown', 'row-raw', false)
        }

        // 链接（命中链接时才有 —— 与 Web 的落点语义一致）
        if (this.ctxKind !== 'tool') {
          ForEach(this.links, (l: string, i: number) => {
            this.CtxItem(`打开链接 ${linkLabel(l)}`, `open-link:${i}`, false)
            this.CtxItem(`复制链接地址 ${linkLabel(l)}`, `copy-link:${i}`, false)
          }, (l: string, i: number) => `ctx-link-${i}`)
        }

        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        this.CtxItem('取消', MENU_CLOSE, false)
      }
      .width('100%')
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
      .borderWidth({ top: STROKE_HAIRLINE })
      .borderColor(hairlineOf(this.pal()))
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: overlayLayers(this.pal())[0].radius,
        color: overlayLayers(this.pal())[0].color,
        offsetX: 0, offsetY: overlayLayers(this.pal())[0].offsetY,
      })
      .padding({ bottom: SPACE_XS })
      .alignItems(HorizontalAlign.Start)
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev3`/`glow`，逐字节不变）。
    .width('100%')
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius({ topLeft: RADIUS_SHEET, topRight: RADIUS_SHEET })
    .shadow({
      radius: overlayLayers(this.pal())[1].radius,
      color: overlayLayers(this.pal())[1].color,
      offsetX: 0, offsetY: overlayLayers(this.pal())[1].offsetY,
    })
    .transition(sheetTransition())
  }
}
