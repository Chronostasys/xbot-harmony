/**
 * AskUserSheet —— 「xbot 需要你确认」问答弹层（原 `pages/Index.ets` 的 `@Builder AskUserSheet()`，P2-3 抽出）。
 *
 * ── 分层铁律（同 StatusSheet / QueueSheet / PluginsSheet / MenuSheets）───────────
 *   · **判据不入组件**：本组件只吃**问题数组**（页面合成 `this.askUser.questions`）+ 回调；
 *     选中判定 / 选择切换 / 提交**全在页面**（那里才持有 `askSelections` 与 store）。
 *     `isSelected` / `onToggleOption` / `setOther` / `onSubmit` 四个回调 ⇄ 页面
 *     `isAskSelected` / `toggleAskOption` / `setAskOther` / `submitAsk`。
 *   · 唯一有真实状态逻辑的入参是「其他（自己填）」的文本 —— 其内联重建 `askSelections`
 *     的那段**逐字搬**到页面方法 `setAskOther(qid, v)`（搬而不改），组件只调 `setOther(qid, v)`。
 *   · **弹层开关所有权不搬**：挂载由页面 `if (this.askUser !== null)` 控制，本组件不持有 flag。
 *
 * ── 按新设计系统重排（2026-10-11 本波）────────────────────────────────────────
 *   旧实现把字号/内距/圆角/命中区全写死（`fontSize(15/14/13/12/11)`、`padding(8)`、
 *   `borderRadius(6/12)`、`minHeight(38/42)`），并**用一整条 warn 边框**立边界。
 *   本版按下法重排（与设置面 `SettingsPanel`/`SettingsRows` **同一套视觉语言**）：
 *     · 面 = `surfaceFillOf(p,'surface.overlay')`（浮层语义面）＋ 结构性发丝 `hairlineOf(p)`；
 *       ⛔ 不再用 `border({ color: pal().warn })` 做装饰性围边。
 *     · 字 = `type.*` 角色（`type.headline` 标题 / `type.body` 问题 / `type.subhead` 选项 /
 *       `type.callout` 说明 / `type.caption` 组头），⛔ 不再各写 15/14/13/12/11。
 *     · 内距 = `INSET_CARD_X/Y`（面板）/ `INSET_ROW_X/Y`（行）；
 *       圆角 = `RADIUS_CARD`（面板）/ `RADIUS_PILL`（选项/按钮）。
 *     · 选项行 `constraintSize({ minHeight: HIT_TARGET_MIN })`（≥44）；选中态 = 一枚
 *       `checkmark` 图标 + 面提升一档（`surface.overlayRowHover`），
 *       ⛔ 取代旧的「已选/未选」纯文本（同一信息两处）。
 *     · 关闭：面板**自带** `onClose`（`@Prop`，头部 X 走它）——
 *       见 `core/sheets.ets` 的 flag 所有权表（⛔ 不在面板内部写别的面板的 flag）。
 *     · 空态：`questions` 为空 ⇒ 一行小字（`textMuted`，无填充/无边框/无发光；§10）。
 *
 * ⛔ 会变的内容一律真 `@Component` + `@Prop`（禁带参 `@Builder`——参数是"调用那刻的快照"）。
 * ⛔ `@Prop` 名避开 `CustomComponent` 基类成员（`size`/`enabled`/`on*` 等，见 ARKTS-GOTCHAS）。
 * ⛔ 颜色只走 `core/design.ets`（`colorOf`/`surfaceFillOf`/`hairlineOf`）或 `pal()` 语义字段，
 *    组件内**零颜色字面量**（门禁 ⑥c 硬红）。
 */
import { Palette, paletteOf } from '../core/theme';
import { AskOption, AskQuestion } from '../core/types';
import {
  DISABLED_OPACITY, ELEV_OVERLAY, HIT_TARGET_MIN, INSET_CARD_X, INSET_ROW_X, INSET_ROW_Y,
  MARKER_SLOT, RADIUS_CARD, RADIUS_PILL, SPACE_HAIR, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XS,
  STROKE_HAIRLINE, SURFACE_COMPOSER, elevationColorOf, hairlineOf, surfaceFillOf,
} from '../core/design';
import { fs, fw, lh, tc, tk } from './SettingsRows';

/**
 * X 关闭图标的视觉边长（vp）—— 与 `type.headline` 字号一致。
 * ⚠️ **报备**：`core/design.ets` 无「图标按钮视觉边长」token；命中区靠 `responseRegion`
 * 外扩到 `HIT_TARGET_MIN`，⛔ 不改布局尺寸（`docs/REDESIGN.md` §5）。
 */
const X_GLYPH: number = 17;
/** 命中区外扩量（视觉 17 → `HIT_TARGET_MIN` 的正方形，居中）。 */
const X_PAD: number = (HIT_TARGET_MIN - X_GLYPH) / 2;
/**
 * 问题列表最大高（vp）。
 * ⚠️ **报备**：无 `list.maxHeight` token（仓内 QueueSheet/PluginsSheet 亦为字面量高度）。
 */
const LIST_MAX_H: number = 420;

@Component
export struct AskUserSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** 待确认的问题（页面 `askUser.questions`，空数组 = 无问题）。 */
  @Prop questions: AskQuestion[] = [];
  /** 是否正在提交（页面 `askBusy`；决定「提交」按钮文案与禁用态）。 */
  @Prop busy: boolean = false;
  /** 某个选项是否已选（页面 `isAskSelected`）。 */
  isSelected: (qid: string, label: string) => boolean = () => false;
  /** 切换某选项（页面 `toggleAskOption`；`multi` = 该题是否多选）。 */
  onToggleOption: (qid: string, label: string, multi: boolean) => void = () => {
  };
  /** 设置「其他（自己填）」的文本（页面 `setAskOther`）。 */
  setOther: (qid: string, v: string) => void = () => {
  };
  /** 提交（页面 `submitAsk`；`cancelled=true` = 用户点了「取消」）。 */
  onSubmit: (cancelled: boolean) => void = () => {
  };
  /**
   * 关闭面板（面板**自己**的关闭入口，头部 X 走它）。
   * ⛔ 默认页传的语义 = 「取消本次询问」（同 `onSubmit(true)`）——由页面接线负责。
   */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 问题 id 兜底（`q.id` 缺失时回落 `q${qi}`，与原实现逐字一致）。 */
  private qidOf(q: AskQuestion, qi: number): string {
    return q.id !== undefined ? q.id : `q${qi}`;
  }

  /** 选项标签兜底（`label` 缺失 ⇒ 空串）。 */
  private labelOf(opt: AskOption): string {
    return opt.label !== undefined ? opt.label : '';
  }

  build() {
    Column({ space: SPACE_SM }) {
      // ── 头部：标题（warn 表达「需要你确认」）+ 关闭 X（`responseRegion` 外扩到 44）──
      Row({ space: SPACE_XS }) {
        Text('xbot 需要你确认')
          .fontSize(fs('type.headline'))
          .fontWeight(fw('type.headline'))
          .lineHeight(lh('type.headline'))
          .letterSpacing(tk('type.headline'))
          .fontColor(this.pal().warn)
          .layoutWeight(1)
        SymbolGlyph($r('sys.symbol.xmark'))
          .fontSize(X_GLYPH)
          .fontColor([this.pal().textSecondary])
          .responseRegion({
            x: -X_PAD,
            y: -X_PAD,
            width: HIT_TARGET_MIN,
            height: HIT_TARGET_MIN,
          })
          .stateStyles({ pressed: { .opacity(DISABLED_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // ── 空态：一行小字（无填充 / 无边框 / 无发光；docs/DESIGN-SYSTEM.md §10）──────
      if (this.questions.length === 0) {
        Text('（没有待确认的问题）')
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        List({ space: SPACE_SM }) {
          ForEach(this.questions, (q: AskQuestion, qi: number) => {
            ListItem() {
              Column({ space: SPACE_XS }) {
                // 组头（`q.header`）：`type.caption`（次级），与设置面的分组头同档
                if (q.header !== undefined && q.header.length > 0) {
                  Text(q.header)
                    .fontSize(fs('type.caption'))
                    .fontWeight(fw('type.caption'))
                    .lineHeight(lh('type.caption'))
                    .letterSpacing(tk('type.caption'))
                    .fontColor(tc(this.pal(), 'type.caption'))
                    .width('100%')
                }
                // 问题正文：`type.body`（正文档，最重）
                Text(q.question !== undefined ? q.question : '')
                  .fontSize(fs('type.body'))
                  .fontWeight(fw('type.body'))
                  .lineHeight(lh('type.body'))
                  .fontColor(tc(this.pal(), 'type.body'))
                  .width('100%')

                // 选项行：选中 = 面提升一档 + 一枚勾（⛔ 不再是「已选/未选」纯文本）
                ForEach(q.options !== undefined ? q.options : [], (opt: AskOption, oi: number) => {
                  Row({ space: SPACE_XS }) {
                    // 选中标记槽（恒定 `MARKER_SLOT` ⇒ 所有选项左对齐）
                    Stack({ alignContent: Alignment.Center }) {
                      if (this.isSelected(this.qidOf(q, qi), this.labelOf(opt))) {
                        SymbolGlyph($r('sys.symbol.checkmark'))
                          .fontSize(fs('type.subhead'))
                          .fontColor([this.pal().accentText])
                      }
                    }
                    .width(MARKER_SLOT)
                    .height(MARKER_SLOT)

                    Column({ space: SPACE_HAIR }) {
                      Text(this.labelOf(opt))
                        .fontSize(fs('type.subhead'))
                        .fontWeight(fw('type.subhead'))
                        .lineHeight(lh('type.subhead'))
                        .fontColor(tc(this.pal(), 'type.subhead'))
                        .width('100%')
                      if (opt.description !== undefined && opt.description.length > 0) {
                        Text(opt.description)
                          .fontSize(fs('type.callout'))
                          .fontWeight(fw('type.callout'))
                          .lineHeight(lh('type.callout'))
                          .fontColor(tc(this.pal(), 'type.callout'))
                          .width('100%')
                      }
                    }
                    .alignItems(HorizontalAlign.Start)
                    .layoutWeight(1)
                  }
                  .width('100%')
                  .alignItems(VerticalAlign.Center)
                  .constraintSize({ minHeight: HIT_TARGET_MIN })
                  .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                  .backgroundColor(surfaceFillOf(this.pal(),
                    this.isSelected(this.qidOf(q, qi), this.labelOf(opt))
                      ? 'surface.overlayRowHover'
                      : 'surface.overlayRow'))
                  .borderRadius(RADIUS_PILL)
                  .onClick(() => {
                    this.onToggleOption(this.qidOf(q, qi), this.labelOf(opt), q.multi_select === true);
                  })
                }, (opt: AskOption, oi: number) => `o-${qi}-${oi}`)

                // 「其他（自己填）」：输入面 = `surface.input` + 发丝（与设置面输入行同款）
                if (q.allow_other === true) {
                  TextInput({ placeholder: '其他（自己填）' })
                    .onChange((v: string) => {
                      this.setOther(this.qidOf(q, qi), v);
                    })
                    .constraintSize({ minHeight: HIT_TARGET_MIN })
                    .fontSize(fs('type.body'))
                    .fontColor(tc(this.pal(), 'type.body'))
                    .placeholderColor(this.pal().textMuted)
                    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_COMPOSER))
                    .borderRadius(RADIUS_PILL)
                    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
                    .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }
          }, (q: AskQuestion, qi: number) => this.qidOf(q, qi))
        }
        .width('100%')
        .constraintSize({ maxHeight: LIST_MAX_H })
        .scrollBar(BarState.Off)
      }

      // ── 底部动作：取消（应答 cancelled）/ 提交（应答 answers）—— 命中区 ≥44 ──────
      Row({ space: SPACE_XS }) {
        Button('取消')
          .layoutWeight(1)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlayRow'))
          .borderRadius(RADIUS_PILL)
          .onClick(() => {
            this.onSubmit(true);
          })
        Button(this.busy ? '提交中…' : '提交')
          .layoutWeight(1)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .fontColor(this.pal().onAccent)
          .backgroundColor(this.pal().accent)
          .borderRadius(RADIUS_PILL)
          .opacity(this.busy ? DISABLED_OPACITY : 1)
          .onClick(() => {
            if (!this.busy) {
              this.onSubmit(false);
            }
          })
      }
      .width('100%')
    }
    .width('94%')
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_SM })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    .shadow({ radius: SPACE_LG, color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 })
  }
}
