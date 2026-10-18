/**
 * QueueSheet —— 「待发队列」面板（原 `pages/Index.ets` 的 `@Builder QueueSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：组件**只读已算好的数据**（`queue` 数组）+ 回调；
 * `showQueue` 所有权留页面（`core/overlays.topOverlay` 要求 flag 集中）；
 * store 调用（清空/上移/下移/插队/取消）由页面在回调里做 ⇒ 本文件不 import store。
 *
 * ── 视觉语言（2026-10-11，L1 顶层弹层根面统一）──────────────────────────────
 * 根面 = `surfaceFillOf(p,'surface.overlay')`（浮层语义面）+ 结构性发丝 `hairlineOf(p)`
 * + **两层柔影** `shadowLayersOf(p,'overlay')` —— 与同层级 `StatusSheet`/`AskUserSheet`/`MenuSheets`
 * 同通道（web `bg-bg-elevated` = 浮层面；此前为裸 `pal().appBg` + 无柔影）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { QueueItem } from '../core/types';
import { PRESS_OPACITY, RADIUS_CARD, SHEET_WIDTH, STROKE_HAIRLINE, SURFACE_CARD, SHEET_ACTION_GLYPH, colorOf, hairlineOf, structuralRuleOf, surfaceFillOf, HIT_TARGET_MIN } from '../core/design';
import { FS_CAPTION, R_LG, R_MD, SP_2, SP_3, SP_4 } from '../core/tokens';
// ⛔ 列表高度判据**只此一处**（`core/panels.queueListHeight`）——组件不自己算高度。
import { queueListHeight } from '../core/panels';
// ⛔ 条目 id / 正文档**只此一处**（`core/staging`）—— 与输入区上方的 `StagingTray` **同一真源**
//    （原实现各有私有的 `idOf`/`textOf` 副本 ⇒ 两处口径会漂移）。
import { stagingItemId, stagingText } from '../core/staging';
import { fs, fw, lh } from './SettingsRows';
// 弹层**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造时长/曲线/位移；E3 统一）。
import { sheetTransition } from './anim';
import { t as i18nT } from '../core/i18n';

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

  /** 本弹层的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'overlay');
  }

  // （条目 id / 正文的取法已上移到 `core/staging` 的 `stagingItemId`/`stagingText` —— 与
  //  输入区上方的 `StagingTray` **同一真源**；本组件不再自持 `idOf`/`textOf` 副本。）

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: SP_2 }) {
        Row() {
          Text(`待发队列 (${this.queue.length})`).fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
            .fontColor(this.pal().textPrimary).layoutWeight(1)
          // ⛔ 清空 = **图标键**（web 权威 `src/components/agent/StagingTray.tsx:617-626`：`staging-clear`
          //    是 **Trash2 图标按钮、无文字**，`aria-label = agent.staging.clearQueue`；其注释原文
          //    「清空队列（独立动作，Trash2 图标按钮，无文字）」+ line 20「`Clear` 是 header 里与 toggle
          //    **不同动作**的**图标按钮**」）。此前为 `Text(i18nT('清空'))` **文字键** ⇒ ① 偏离 web 权威，
          //    ② 与本仓所有弹层页头（`SessionStatsSheet`/`GitPanelSheet`/`SkillsSheet`/`FilesSheet`…）的
          //    **图标键**形态不一致 ⇒ 统一为真 44×44 布局盒的图标键（`responseRegion` 负偏移外扩在
          //    真机 SDK21 **无效** ⇒ 热区 = 布局盒本身）。取色 `dangerText` = 破坏性动作，
          //    与 `TaskDetailSheet:135-146` 的「终止任务」**同通道**。
          Row() {
            SymbolGlyph($r('sys.symbol.trash')).fontSize(SHEET_ACTION_GLYPH).fontColor([this.pal().dangerText])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('清空队列'))
          .onClick(() => {
            // 无 clear 端点（web 同款）：页面遍历逐个 cancel。
            this.onClear();
          })
          // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('关闭'))
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
          Text(i18nT('当前没有待发消息'))
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
                Text(stagingText(q))
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
                .accessibilityText(i18nT('上移'))
                .onClick(() => {
                  this.onMove(stagingItemId(q), -1);
                })
                Row() {
                  SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(fs('type.callout')).fontColor([this.pal().accentSoft])
                }
                .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .accessibilityText(i18nT('下移'))
                .onClick(() => {
                  this.onMove(stagingItemId(q), 1);
                })
                // ⚡ 插队：must use the FULL content（server `preview` 截断到 ~80 runes ⇒ 会丢内容）
                Row() {
                  Text(i18nT('插队')).fontSize(FS_CAPTION).fontColor(this.pal().warn)
                }
                .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onInterject(stagingItemId(q), stagingText(q));
                })
                Row() {
                  SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH).fontColor([this.pal().dangerText])
                }
                .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .accessibilityText(i18nT('取消排队'))
                .onClick(() => {
                  this.onCancel(stagingItemId(q));
                })
              }.width('100%').padding(SP_2).backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD)).borderRadius(R_LG)
              // **面→面**轮廓 = `structuralRuleOf`（此前**裸面**：只靠填充差，porcelain 下几乎读不出层次）——
              // 与 `PluginsSheet` 的行卡同层级 ⇒ 同通道（`docs/DESIGN-SYSTEM.md §13.5`）。
              .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
            }
          }, (q: QueueItem) => `${q.msg_id}#${q.content}#${q.text}`)
        }
        // ⛔ 内容自适应高度（判据与渲染同源：`core/panels.queueListHeight`；此前硬编码 300 ⇒
        //    队列长时靠后的行看不到、只有 1 条时又留一大块空白）。
        .height(queueListHeight(this.queue.length)).width('100%')
        // ⛔ 用户报「滚动栏挡住交互」：**行内右侧就是可点图标**（上/下移、取消）⇒ 默认 `BarState.Auto`
        //    的滚动条叠在最右缘、参与命中测试 ⇒ 会抢掉右侧图标的点击。面板内短列表 ⇒ 显式关条。
        .scrollBar(BarState.Off)
        }
      }
      .width('100%').padding(SP_4)
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius(RADIUS_CARD)
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`glow`，逐字节不变）。
    .width(SHEET_WIDTH)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }
}
