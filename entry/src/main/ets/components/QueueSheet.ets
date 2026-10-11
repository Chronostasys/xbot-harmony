/**
 * QueueSheet —— 「待发队列」面板（原 `pages/Index.ets` 的 `@Builder QueueSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：组件**只读已算好的数据**（`queue` 数组）+ 回调；
 * `showQueue` 所有权留页面（`core/overlays.topOverlay` 要求 flag 集中）；
 * store 调用（清空/上移/下移/插队/取消）由页面在回调里做 ⇒ 本文件不 import store。
 */
import { Palette, paletteOf } from '../core/theme';
import { QueueItem } from '../core/types';
import { PRESS_OPACITY, STROKE_HAIRLINE, SURFACE_CARD, hairlineOf, surfaceFillOf, ICON_LG, HIT_TARGET_MIN } from '../core/design';
import { FS_CAPTION, FS_TITLE, R_LG, R_MD, R_XL, SP_2, SP_3, SP_4 } from '../core/tokens';
import { fs, fw } from './SettingsRows';
// 弹层**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造时长/曲线/位移；E3 统一）。
import { sheetTransition } from './anim';

@Component
export struct QueueSheet {
  @Prop theme: string = 'dark';
  /** 待发队列（页面 `store.queue` 的镜像；判据与顺序都由页面负责）。 */
  @Prop queue: QueueItem[] = [];
  /** 清空（页面 `store.clearQueue()`）。 */
  onClear: () => void = () => {
  };
  /** 上移/下移（delta = -1 / +1）。 */
  onMove: (id: string, delta: number) => void = () => {
  };
  /** 插队发送（必须传**完整内容**，服务端 `preview` 会截断）。 */
  onInterject: (id: string, full: string) => void = () => {
  };
  /** 取消该条。 */
  onCancel: (id: string) => void = () => {
  };
  /** 关闭面板（页面置 `showQueue=false`）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 队列 id 兜底（`msg_id` 优先，其次 `id`）—— 与原实现逐字一致。 */
  private idOf(q: QueueItem): string {
    return q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
  }

  /** 展示文本（`content` 优先，回落 `text`）。 */
  private textOf(q: QueueItem): string {
    return q.content !== undefined && q.content.length > 0
      ? q.content
      : (q.text !== undefined ? q.text : '');
  }

  build() {
    Column({ space: SP_2 }) {
      Row() {
        Text(`待发队列 (${this.queue.length})`).fontSize(FS_TITLE).fontWeight(fw('type.headline'))
          .fontColor(this.pal().textPrimary).layoutWeight(1)
        Text('清空').fontSize(FS_CAPTION).fontColor(this.pal().dangerText)
          .padding({ left: SP_2, right: SP_2, top: 6, bottom: 6 })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            // 无 clear 端点（web 同款）：页面遍历逐个 cancel。
            this.onClear();
          })
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(ICON_LG)
          .fontColor([this.pal().textSecondary]).padding(SP_2)
          // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44)：视觉边长 = 图标 16 + 2×`SP_2`(8) = **32 < 44**
          //    ⇒ `responseRegion` 外扩、⛔ 不改布局/视觉尺寸（`PluginsSheet`/`AskUserSheet` 同款）。
          //    右邻 = 行尾（无），故只向**右**扩 12 即可到 44，不会抢左侧「清空」的命中区。
          .responseRegion({ x: 0, y: -6, width: HIT_TARGET_MIN, height: HIT_TARGET_MIN })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onClose();
          })
      }.width('100%')

      List() {
        ForEach(this.queue, (q: QueueItem) => {
          ListItem() {
            Row({ space: 6 }) {
              Text(this.textOf(q))
                .fontSize(fs('type.subhead')).fontColor(this.pal().textPrimary).layoutWeight(1).maxLines(3)
                .wordBreak(WordBreak.BREAK_ALL)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              // ⛔ 图标一致性：原先直写字形 `'↑'`/`'↓'` 当按钮 = 「图标即文本」的廉价感来源（审计命中）。
              //    改用本仓既有 symbol（`chevron_up/down` 已在别处使用 ⇒ 命名安全；语义=上/下移一格）。
              //    ⚠️ `SymbolGlyph` 的取色是**数组形态**（`fontColor([...])`），与 `Text` 的单值形态不同。
              // ⛔ 命中区：视觉边长 = 14 + 2×6 = 26 < 44 ⇒ 必须外扩（`hit_spacing_gate ①`：`responseRegion`
              //    的 width/height **必须 ≥ `HIT_TARGET_MIN`**，不允许"部分外扩"）。
              //    ⚠️ 本行 5 个元素**密集相邻**（间距 6）⇒ 44×44 的两者**必然部分重叠**（重叠区归后绘制者）。
              //    这是本仓门禁已接受的口径（`hit_spacing_gate ②`：容器内有 `layoutWeight` 元素即豁免）。
              SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(fs('type.callout')).fontColor([this.pal().accentSoft]).padding(6)
                .responseRegion({ x: -9, y: -9, width: HIT_TARGET_MIN, height: HIT_TARGET_MIN })
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onMove(this.idOf(q), -1);
                })
              SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(fs('type.callout')).fontColor([this.pal().accentSoft]).padding(6)
                .responseRegion({ x: -9, y: -9, width: HIT_TARGET_MIN, height: HIT_TARGET_MIN })
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onMove(this.idOf(q), 1);
                })
              // ⚡ 插队：must use the FULL content（server `preview` 截断到 ~80 runes ⇒ 会丢内容）
              Text('插队').fontSize(FS_CAPTION).fontColor(this.pal().warn).padding(6).onClick(() => {
                this.onInterject(this.idOf(q), this.textOf(q));
              })
              SymbolGlyph($r('sys.symbol.xmark')).fontSize(15)
                .fontColor([this.pal().dangerText]).padding(6)
                // ⛔ 命中区：视觉边长 = 15 + 2×6 = 27 < 44 ⇒ 外扩（行尾，右肩空 ⇒ 可向左右各扩 6）。
                .responseRegion({ x: -6, y: -9, width: HIT_TARGET_MIN, height: HIT_TARGET_MIN })
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onCancel(this.idOf(q));
                })
            }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
          }
        }, (q: QueueItem) => `${q.msg_id}#${q.content}#${q.text}`)
      }
      .height(300).width('100%')
      // ⛔ 用户报「滚动栏挡住交互」：**行内右侧就是可点图标**（上/下移、取消）⇒ 默认 `BarState.Auto`
      //    的滚动条叠在最右缘、参与命中测试 ⇒ 会抢掉右侧图标的点击。面板内短列表 ⇒ 显式关条。
      .scrollBar(BarState.Off)
    }
    .width('92%').padding(SP_4).backgroundColor(this.pal().appBg)
    .borderRadius(R_XL).border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }
}
