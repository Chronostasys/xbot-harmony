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
import { fs, fw, lh } from './SettingsRows';
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
          // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先只靠 `padding` 撑高（≈28~32）⇒ 低于阈值。
          //    ⚠️ 本行**零视觉变化**：同级已有 44×44 的关闭盒 ⇒ 行高已 = 44，本 `minHeight` 不改变布局。
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            // 无 clear 端点（web 同款）：页面遍历逐个 cancel。
            this.onClear();
          })
        // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
        Row() {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(ICON_LG)
            .fontColor([this.pal().textSecondary])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onClose();
        })
      }.width('100%')

      // ── 空态（2026-10-11 补）：队列可被「清空」清成 0 条（面板**仍然**开着）——
      //    原先只剩标题「待发队列 (0)」+ 一块 300 高的空白 `List` ⇒ 与 §10「空态 = 一行小字」
      //    口径不符（用户点「清空」后看到的是"一片空"，读不出"清干净了/这里本就没有"）。
      //    形态对齐同族弹层（`SearchHitsSheet`/`AskUserSheet`/`StatusSheet`）：`type.callout`
      //    + `textMuted`，无填充/无边框/无发光。
      if (this.queue.length === 0) {
        Text('当前没有待发消息')
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(this.pal().textMuted)
          .width('100%')
          .padding({ top: SP_3, bottom: SP_3 })
      } else {
      List() {
        ForEach(this.queue, (q: QueueItem) => {
          ListItem() {
            Row({ space: 6 }) {
              Text(this.textOf(q))
                .fontSize(fs('type.subhead')).fontColor(this.pal().textPrimary).layoutWeight(1).maxLines(3)
                .wordBreak(WordBreak.BREAK_ALL)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              // ⛔ 图标一致性：改用本仓既有 symbol（`chevron_up/down` 已在别处使用 ⇒ 命名安全；语义=上/下移一格）。
              //    ⚠️ `SymbolGlyph` 的取色是**数组形态**（`fontColor([...])`），与 `Text` 的单值形态不同。
              // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 每个按钮放进**真实 44×44 布局盒**
              //    承载 `onClick`（热区 = 布局盒本身）；图标视觉尺寸不变、盒内居中。
              //    ⚠️ **密集相邻取舍**：本行 5 个元素（文本 + 4 个按钮）间距 6；4×44 + 3×6 = 194vp 仍可容纳
              //    （文本 `layoutWeight(1)` 吸收余量）⇒ **相邻 44 盒不重叠**（保留 6vp 死区）。代价 = 条目行高
              //    26→44（`List` 固定 300 ⇒ 可见条目数变少）。这是"可靠 > 视觉密度"的取舍。
              Row() {
                SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(fs('type.callout')).fontColor([this.pal().accentSoft])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onMove(this.idOf(q), -1);
              })
              Row() {
                SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(fs('type.callout')).fontColor([this.pal().accentSoft])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onMove(this.idOf(q), 1);
              })
              // ⚡ 插队：must use the FULL content（server `preview` 截断到 ~80 runes ⇒ 会丢内容）
              Row() {
                Text('插队').fontSize(FS_CAPTION).fontColor(this.pal().warn)
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onInterject(this.idOf(q), this.textOf(q));
              })
              Row() {
                SymbolGlyph($r('sys.symbol.xmark')).fontSize(15).fontColor([this.pal().dangerText])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
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
    }
    .width('92%').padding(SP_4).backgroundColor(this.pal().appBg)
    .borderRadius(R_XL).border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }
}
