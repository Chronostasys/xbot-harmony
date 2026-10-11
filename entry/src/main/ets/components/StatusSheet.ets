/**
 * StatusSheet —— 「会话状态」面板（原 `pages/Index.ets` 的 `@Builder StatusSheet()`，P1 抽出）。
 *
 * ── 为什么抽它（`docs/INDEX-SPLIT-PLAN.md` §5）────────────────────────────────
 *   Index.ets 6420 行里视觉与判据混住；它是**状态面最小**的一块（只读 4 项、2 个写点且都只是
 *   "跳去别的弹层"）⇒ 改成 `@Prop` 入 + 回调出即可，零 store / 零 scroller / 零弹层栈语义。
 *
 * ── 分层铁律（本文件不许违反）─────────────────────────────────────────────────
 *   · **不算任何东西**：用量/模型/上下文上限/路径/目标的**判据全在页面**（那里才拿得到 store 与
 *     `core/*` 的唯一判据函数）⇒ 本组件只吃**已算好的字符串**。⛔ 不许在这里 import store、
 *     不许自造第二套状态→文案映射。
 *   · **弹层开关所有权不搬**：`showStatus`/`showModel` 留在页面（`core/overlays.topOverlay`
 *     要求所有 flag 集中）⇒ 本组件只给 `onClose` / `onOpenModel` 回调，自己**不改**任何开关。
 *   · 动效走底座 `./anim` 的 `sheetTransition()`（唯一实现）；颜色只用 `pal()` 语义色（禁 hex）。
 *   · 会变的内容走真 `@Component` + `@Prop`（禁带参 @Builder —— 会冻在首帧）。
 *
 * ── 按新设计系统重排（2026-10-11 本波）────────────────────────────────────────
 *   旧实现把字号/内距/圆角全写死（`FS_TITLE`/`FS_CAPTION`、`padding(10)`、`.border(pal().border)`
 *   装饰性围边、X 的命中区仅 ~33），且用 `pal().appBg` 当浮层底。本版：
 *     · 面 = `surfaceFillOf(p,'surface.overlay')`（浮层语义面）＋ 结构性发丝 `hairlineOf(p)`
 *       ＋ 浮层柔影 `elevationColorOf(p, ELEV_OVERLAY)`；⛔ 不再 `pal().border` 围边。
 *     · 字 = `type.*` 角色（标题 `type.headline` / 行 `type.callout` / 目标 `type.caption`）。
 *     · 行 = `INSET_ROW_*` + `HIT_TARGET_MIN`（≥44）；层级 = **标签次级色 / 值主色**（同 web
 *       `SessionInfo.tsx` 的 `InfoRow`）。
 *     · 关闭：头部 X 走 `onClose`（面板**自己**的关闭入口；见 `core/sheets.ets` flag 所有权表）。
 *     · 空态：五路输入全空 ⇒ 一行小字（`textMuted`，无填充/无边框/无发光；§10）。
 *
 * ── 行为等价性（P1 三重证据之一）──────────────────────────────────────────────
 *   入参 = 原 `@Builder` 引用集合逐一对应：`pal()→theme`、`goalLine()→goalLine`、
 *   `usageText(this.usage)→usageText`、`currentModelName()→modelName`、`ctxText()→ctxText`、
 *   `this.cwd→cwd`；写点 `showStatus=false→onClose`、`showModel=true + store.loadLlmConfig()→onOpenModel`。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  ELEV_OVERLAY, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, SPACE_HAIR, SPACE_LG, SPACE_SM,
  SPACE_XS, STROKE_HAIRLINE, elevationColorOf, hairlineOf, surfaceFillOf, colorOf, } from '../core/design';
import { fs, fw, lh, tc, tk } from './SettingsRows';
import { sheetTransition } from './anim';

/**
 * X 关闭图标的视觉边长（vp，= `type.headline` 字号）。
 * ⚠️ **报备**：无「图标按钮视觉边长」token；命中区靠 `responseRegion` 外扩到 `HIT_TARGET_MIN`。
 */
const X_GLYPH: number = 17;
/** 命中区外扩量（视觉 17 → `HIT_TARGET_MIN` 的正方形，居中）。 */
const X_PAD: number = (HIT_TARGET_MIN - X_GLYPH) / 2;

/**
 * 一行「标签 + 值」——层级 = 标签次级色 / 值主色（web `SessionInfo.tsx` 的 `InfoRow`）。
 * ⚠️ 不复用 `SettingsValueRow`：那个原子的层级是「标题主色 / 值次级色」，与本面板语义**相反**。
 */
@Component
struct StatusInfoRow {
  @Prop label: string = '';
  @Prop value: string = '';
  /** 值用等宽字（工作路径）。 */
  @Prop mono: boolean = false;
  /** 值可长按复制（工作路径）。 */
  @Prop valueCopyable: boolean = false;
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_XS }) {
      Text(this.label)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.callout'))
        .lineHeight(lh('type.callout'))
        .fontColor(tc(this.pal(), 'type.callout'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(this.value)
        .fontSize(fs('type.callout'))
        .fontWeight(fw('type.body'))
        .lineHeight(lh('type.callout'))
        .fontFamily(this.mono ? 'monospace' : '')
        .fontColor(tc(this.pal(), 'type.body'))
        .layoutWeight(1)
        .textAlign(TextAlign.End)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .copyOption(this.valueCopyable ? CopyOptions.LocalDevice : CopyOptions.None)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

@Component
export struct StatusSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /** goal 行（空串 = 不显示；判据在页面 `goalLine()`）。 */
  @Prop goalLine: string = '';
  /** 用量文本（空串 ⇒ 显示 `—`，与抽取前逐字一致）。 */
  @Prop usageText: string = '';
  /** 当前模型名（页面 `currentModelName()`）。 */
  @Prop modelName: string = '';
  /** 上下文上限文本（空串 = 不显示该行）。 */
  @Prop ctxText: string = '';
  /** 工作路径（空串 = 不显示该行）。 */
  @Prop cwd: string = '';
  /** 关闭面板（面板**自己**的关闭入口，头部 X 走它）。 */
  onClose: () => void = () => {
  };
  /** 打开「模型 / 上下文上限」选择栏（页面置 `showModel=true` + 拉 llm-config）。 */
  onOpenModel: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 五路输入全空 ⇒ 空态（避免用户看到"点开了但什么都没有"）。 */
  private isEmpty(): boolean {
    return this.goalLine.length === 0 && this.usageText.length === 0
      && this.modelName.length === 0 && this.ctxText.length === 0 && this.cwd.length === 0;
  }

  build() {
    Column({ space: 0 }) {
      // ── 头部：标题（`type.headline`）+ 关闭 X（`responseRegion` 外扩到 44）────────
      Row({ space: SPACE_XS }) {
        Text('会话状态')
          .fontSize(fs('type.headline'))
          .fontWeight(fw('type.headline'))
          .lineHeight(lh('type.headline'))
          .letterSpacing(tk('type.headline'))
          .fontColor(tc(this.pal(), 'type.headline'))
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
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })

      if (this.isEmpty()) {
        // ── 空态：一行小字（无填充 / 无边框 / 无发光；docs/DESIGN-SYSTEM.md §10）──────
        Text('（暂无会话状态）')
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(this.pal().textMuted)
          .width('100%')
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, bottom: SPACE_XS })
      } else {
        // ── 目标行（页面已算好前缀「目标：/已完成：」）——`type.caption` + warn ────────
        if (this.goalLine.length > 0) {
          Text(this.goalLine)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(this.pal().warn)
            .width('100%')
            .wordBreak(WordBreak.BREAK_ALL)
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, bottom: SPACE_HAIR })
        }

        // ── 只读信息行（标签次级 / 值主色；每项只出现一次）───────────────────────
        if (this.usageText.length > 0 || this.modelName.length > 0) {
          StatusInfoRow({
            label: '用量',
            value: this.usageText.length > 0 ? this.usageText : '—',
            theme: this.theme,
          })
        }
        StatusInfoRow({ label: '模型', value: this.modelName, theme: this.theme })
        if (this.ctxText.length > 0) {
          StatusInfoRow({ label: '上下文上限', value: this.ctxText, theme: this.theme })
        }
        if (this.cwd.length > 0) {
          StatusInfoRow({
            label: '工作路径',
            value: this.cwd,
            mono: true,
            valueCopyable: true,
            theme: this.theme,
          })
        }

        // ── 切换入口（模型 / 上下文上限）——发丝分隔 + 44 命中区的一整行 ───────────────
        Divider()
          .strokeWidth(STROKE_HAIRLINE)
          .color(hairlineOf(this.pal()))
          .margin({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        Row({ space: SPACE_XS }) {
          Text('切换模型 / 上下文上限')
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontColor(this.pal().accentSoft)
            .layoutWeight(1)
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .fontSize(fs('type.caption'))
            .fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onOpenModel();
        })
      }
    }
    .width('92%')
    .padding({ top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    .shadow({ radius: SPACE_LG, color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 })
    .transition(sheetTransition())
  }
}
