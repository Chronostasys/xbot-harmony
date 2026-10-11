/**
 * MenuSheets —— 三块「底部操作菜单」弹层（P2-2 抽出）。
 *
 * 来源：`pages/Index.ets` 的 `@Builder SessSheet()` / `SearchHitsSheet()` /
 * `ContextSheet()`，以及三者**共用**的 `@Builder CtxItem()`（原 `Index.ets:5078–5207`）。
 * ArkUI 允许同文件多 struct（同 `components/ToolPopover.ets`：`ToolPopoverCard` + `ToolOverflowList`）。
 *
 * ── 分层铁律（同 StatusSheet / QueueSheet / PluginsSheet）───────────────────────
 *   · **判据/派发不入组件**：三个 sheet 只吃**已算好的数据**（标题字符串、bool、数组）+
 *     一个回调 `onItem(code)`；`showSearchHits` / `sessMenuId` / `sessConfirmDelete` / `ctxOpen`
 *     等弹层 flag 所有权**留页面**（`core/overlays.topOverlay` 要求 flag 集中）。
 *   · **派发收敛**：CtxItem 的点击一律走 `onItem(code)`；原页面三分支
 *     （`cancel-hits` → 关搜索命中；`MOVE_*` / `rename` / `fork` / `delete` → `runSessAction`；
 *     其余 → `runCtxAction`）**逐字留在页面** `onSheetItem()`。
 *   · **`CtxItem` 刻意保持带参 `@Builder`**（不是 `@Component`）：它承载「确认删除（再点一次）」
 *     这类**会变的 label**，而带参 `@Builder` 的参数是"调用那一刻的快照"（`docs/ARKTS-GOTCHAS.md §4`）
 *     ⇒ 改成 `@Component`（`@Prop` 值变化通道）会**改变行为**。这是少数**刻意不响应更新**的地方。
 *     ⛔ ArkUI 的 `@Builder` **不能接函数/回调参数** ⇒ 三个 struct 各持一个同款的 `CtxItem`
 *     成员 @Builder（各自读本组件上的 `onItem` 成员回调，写法同 `ToolPopover.SectionHead` 读
 *     `this.onCopy`）—— **无法**用一份全局 builder 共享，只能各持一份。
 *   · 玻璃材质：`effectsOf(paletteOf(theme))` + `isDarkThemeName(theme)` —— 与页面
 *     `eff()` / `glassMode()` **同源**。
 */
import { Palette, paletteOf, Effects, effectsOf, isDarkThemeName } from '../core/theme';
import { SearchHit } from '../core/types';
import { hitLine, MOVE_DOWN, MOVE_TOP, MOVE_UP } from '../core/sessionops';
import { linkLabel } from '../core/msgops';
import { R_2XL } from '../core/tokens';
import { sheetTransition } from './anim';

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
  /** 菜单项点击（页面 `onSheetItem(code)` —— 三分支派发）。 */
  onItem: (code: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  private glassMode(): ThemeColorMode {
    return isDarkThemeName(this.theme) ? ThemeColorMode.DARK : ThemeColorMode.LIGHT;
  }

  /**
   * 菜单里的一项（**带参 @Builder** —— 见文件头"CtxItem 刻意保持 @Builder"）。
   * ⛔ 不要改成 `@Component`：「确认删除（再点一次）」的 label 依赖"冻结在调用那一刻"的既有语义。
   */
  @Builder
  CtxItem(label: string, code: string) {
    Text(label)
      .fontSize(14).fontColor(this.pal().textPrimary)
      .width('100%').padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .stateStyles({ pressed: { .backgroundColor(this.pal().surfaceAlt) }, normal: { .backgroundColor(this.pal().appBg) } })
      .onClick(() => {
        this.onItem(code);
      })
  }

  build() {
    Column({ space: 0 }) {
      Text(this.title)
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      this.CtxItem(this.canTop ? '置顶' : '置顶（已在顶部）', MOVE_TOP)
      this.CtxItem(this.canUp ? '上移' : '上移（已在顶部）', MOVE_UP)
      this.CtxItem(this.canDown ? '下移' : '下移（已在底部）', MOVE_DOWN)
      this.CtxItem('重命名', 'rename')
      this.CtxItem('分支（fork 出新会话）', 'fork')
      this.CtxItem(this.confirmDelete ? '确认删除（再点一次）' : '删除', 'delete')
      Divider().color(this.pal().surfaceHi).margin({ top: 4 })
      this.CtxItem('取消', 'cancel')
    }
    .width('100%')
    .backgroundColor(this.eff().glassBg)
    .backgroundBlurStyle(BlurStyle.Thin, { colorMode: this.glassMode() })
    .borderRadius({ topLeft: R_2XL, topRight: R_2XL })
    .border({ width: 1, color: this.eff().glassBorder })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
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
  /** 菜单项点击（页面 `onSheetItem(code)`；`'cancel-hits'` 关面板）。 */
  onItem: (code: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  private glassMode(): ThemeColorMode {
    return isDarkThemeName(this.theme) ? ThemeColorMode.DARK : ThemeColorMode.LIGHT;
  }

  /** 带参 @Builder（同 `SessSheet.CtxItem`；⛔ 不要改成 `@Component`）。 */
  @Builder
  CtxItem(label: string, code: string) {
    Text(label)
      .fontSize(14).fontColor(this.pal().textPrimary)
      .width('100%').padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .stateStyles({ pressed: { .backgroundColor(this.pal().surfaceAlt) }, normal: { .backgroundColor(this.pal().appBg) } })
      .onClick(() => {
        this.onItem(code);
      })
  }

  build() {
    Column({ space: 0 }) {
      Text(`本会话命中 ${this.hits.length} 条（点一条复制片段）`)
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })
      List({ space: 6 }) {
        ForEach(this.hits, (h: SearchHit, i: number) => {
          ListItem() {
            Text(hitLine(h.role !== undefined ? h.role : '', h.snippet !== undefined ? h.snippet : '', 120))
              .fontSize(13).fontColor(this.pal().textPrimary)
              .width('100%').padding(10)
              .backgroundColor(this.pal().surface).borderRadius(6)
              .maxLines(3).wordBreak(WordBreak.BREAK_ALL)
              .onClick(() => {
                this.onPickHit(h.snippet !== undefined ? h.snippet : '');
              })
          }
        }, (h: SearchHit, i: number) => `hit-${h.id}#${i}`)
      }
      .constraintSize({ maxHeight: 420 }).width('100%')
      Divider().color(this.pal().surfaceHi).margin({ top: 6 })
      this.CtxItem('关闭', 'cancel-hits')
    }
    .width('100%')
    .backgroundColor(this.eff().glassBg)
    .backgroundBlurStyle(BlurStyle.Thin, { colorMode: this.glassMode() })
    .borderRadius({ topLeft: R_2XL, topRight: R_2XL })
    .border({ width: 1, color: this.eff().glassBorder })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
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
  /** 菜单项点击（页面 `onSheetItem(code)`）。 */
  onItem: (code: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  private glassMode(): ThemeColorMode {
    return isDarkThemeName(this.theme) ? ThemeColorMode.DARK : ThemeColorMode.LIGHT;
  }

  /** 带参 @Builder（同 `SessSheet.CtxItem`；⛔ 不要改成 `@Component`）。 */
  @Builder
  CtxItem(label: string, code: string) {
    Text(label)
      .fontSize(14).fontColor(this.pal().textPrimary)
      .width('100%').padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .stateStyles({ pressed: { .backgroundColor(this.pal().surfaceAlt) }, normal: { .backgroundColor(this.pal().appBg) } })
      .onClick(() => {
        this.onItem(code);
      })
  }

  build() {
    Column({ space: 0 }) {
      Text(this.ctxKind === 'tool' ? '工具操作' : (this.ctxKind === 'iter' ? '迭代操作' : '消息操作'))
        .fontSize(12).fontColor(this.pal().textSecondary)
        .width('100%').padding({ left: 16, top: 12, bottom: 6 })

      if (this.ctxKind === 'user') {
        this.CtxItem('复制文本', 'user-text')
        this.CtxItem('编辑并重发', 'user-rewind')
      } else if (this.ctxKind === 'tool') {
        this.CtxItem('复制输出', 'tool-out')
        this.CtxItem('复制参数', 'tool-args')
        this.CtxItem('复制全部（名字+参数+输出）', 'tool-all')
      } else if (this.ctxKind === 'iter') {
        this.CtxItem('复制该迭代正文', 'iter-reply')
        this.CtxItem('复制该迭代（含思考）', 'iter-thinking')
        this.CtxItem('复制该迭代（含工具）', 'iter-tools')
      } else {
        this.CtxItem('复制回复', 'row-reply')
        this.CtxItem('复制（含思考）', 'row-thinking')
        this.CtxItem('复制（含工具）', 'row-tools')
        this.CtxItem('复制原始 Markdown', 'row-raw')
      }

      // 链接（命中链接时才有 —— 与 Web 的落点语义一致）
      if (this.ctxKind !== 'tool') {
        ForEach(this.links, (l: string, i: number) => {
          this.CtxItem(`打开链接 ${linkLabel(l)}`, `open-link:${i}`)
          this.CtxItem(`复制链接地址 ${linkLabel(l)}`, `copy-link:${i}`)
        }, (l: string, i: number) => `ctx-link-${i}`)
      }

      Divider().color(this.pal().surfaceHi).margin({ top: 4 })
      this.CtxItem('取消', 'cancel')
    }
    .width('100%')
    .backgroundColor(this.eff().glassBg)
    .backgroundBlurStyle(BlurStyle.Thin, { colorMode: this.glassMode() })
    .borderRadius({ topLeft: R_2XL, topRight: R_2XL })
    .border({ width: 1, color: this.eff().glassBorder })
    .padding({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    .transition(sheetTransition())
  }
}
