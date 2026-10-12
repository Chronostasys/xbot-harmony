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
 *     · 空态：八路输入全空 ⇒ 一行小字（`textMuted`，无填充/无边框/无发光；§10）。
 *
 * ── 会话信息补全（2026-10-11 目标④；对齐 web `SessionInfo.tsx`）────────────────────
 *   补 web 会话信息的缺失字段 + 把「工作路径」升级为**可编辑**（唯一写点，仍回调出页面）：
 *     · `sessionId`（web `:48`）/ `channel`（`:49`）/ `lastActive`（`:174-176`）新增为 `@Prop`，
 *       空串 ⇒ 不显示该行（⛔ 不编造、不估算）。
 *     · 「工作路径」行 `editable`（web `:138-173`）：点值就地改 ⇒ `TextInput` + 确认（真实 ≥44
 *       布局盒）/ Enter 提交 ⇒ `onSubmitCwd`（页面复用**既有** `set_cwd` 写路径，⛔ 组件不发 RPC）。
 *     · ⛔ 不加动效；编辑态是组件本地 `@State`（不进 store、不动任何弹层 flag）。
 *
 * ── 行为等价性（P1 三重证据之一）──────────────────────────────────────────────
 *   入参 = 原 `@Builder` 引用集合逐一对应：`pal()→theme`、`goalLine()→goalLine`、
 *   `usageText(this.usage)→usageText`、`currentModelName()→modelName`、`ctxText()→ctxText`、
 *   `this.cwd→cwd`；写点 `showStatus=false→onClose`、`showModel=true + store.loadLlmConfig()→onOpenModel`。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  PRESS_OPACITY, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, RADIUS_CHIP, SHEET_ACTION_GLYPH,
  SPACE_HAIR, SPACE_LG, SPACE_SM,
  SHEET_WIDTH, SPACE_XS, STROKE_HAIRLINE, hairlineOf, surfaceFillOf, colorOf, } from '../core/design';
import { fs, fw, lh, tc, tk } from './SettingsRows';
import { sheetTransition } from './anim';

/**
 * 关闭 X 的视觉边长 —— 统一走 `SHEET_ACTION_GLYPH`（2026-10-12，与 `AskUserSheet` 同一 token）。
 * 此前本文件与 `AskUserSheet` **各定义一份** `X_GLYPH = 17` 魔数 ⇒ 已并入 design 层单一 token；
 * ⛔ 不再在本文件定义局部魔数（`tools/tests/sheet_chrome.test.ts` 硬红拦回归）。
 * ⛔ 热区不靠 `responseRegion` 负偏移外扩（真机实测无效）⇒ 真实 44×44 布局盒承载 `onClick`。
 */

/**
 * 一行「标签 + 值」——层级 = 标签次级色 / 值主色（web `SessionInfo.tsx` 的 `InfoRow`）。
 * ⚠️ 不复用 `SettingsValueRow`：那个原子的层级是「标题主色 / 值次级色」，与本面板语义**相反**。
 *
 * `editable`（当前只有「工作路径」用）：值与 web `SessionInfo.tsx:138-173` 的 `<dd>` 等价 ——
 * 点值进**就地编辑**（单行 `TextInput` + 确认，Enter 提交）⇒ `onSubmitValue`。
 * ⛔ 编辑态是**本组件本地 `@State`**（不进 store、不改任何弹层开关、**不发 RPC** —— 写路径在页面）。
 * ⛔ 可点区靠**真实 ≥44 布局盒**承载 `onClick`（`responseRegion` 负偏移外扩真机实测无效）。
 */
@Component
struct StatusInfoRow {
  @Prop label: string = '';
  @Prop value: string = '';
  /** 值用等宽字（工作路径）。 */
  @Prop mono: boolean = false;
  /** 值可长按复制（工作路径）。 */
  @Prop valueCopyable: boolean = false;
  /** 值可点开**就地编辑**（仅工作路径；web `:138-173`）。 */
  @Prop editable: boolean = false;
  /** 提交编辑后的值（页面复用既有 `set_cwd` 写路径；组件**不发** RPC）。 */
  onSubmitValue: (v: string) => void = () => {
  };
  @Prop theme: string = 'dark';
  /** 编辑态输入草稿（`@State`，纯本地 UI 态）。 */
  @State private draft: string = '';
  /** 是否处于编辑态。 */
  @State private editing: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 进入编辑态：草稿预填当前值（web `:165-170`）。 */
  private beginEdit(): void {
    this.draft = this.value;
    this.editing = true;
  }

  /** 提交（Enter 或点确认）：退出编辑态，把去掉首尾空白的值交给页面。 */
  private commit(): void {
    const v: string = this.draft.trim();
    this.editing = false;
    this.onSubmitValue(v);
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
      if (this.editable && this.editing) {
        // ── 编辑态（web `:139-155`）：单行输入（等宽）+ 确认；Enter 提交 ───────────────
        TextInput({ text: this.draft, placeholder: '工作路径' })
          .fontSize(fs('type.callout'))
          .fontColor(tc(this.pal(), 'type.body'))
          .placeholderColor(this.pal().textMuted)
          .fontFamily('monospace')
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.input'))
          .borderRadius(RADIUS_CHIP)
          .layoutWeight(1)
          .onChange((v: string) => {
            this.draft = v;
          })
          .onSubmit(() => {
            this.commit();
          })
        // 确认（图标-only ⇒ 真实 ≥44 布局盒承载 `onClick` + 读屏文案；⛔ 不用 `responseRegion`）
        Row() {
          SymbolGlyph($r('sys.symbol.checkmark'))
            .fontSize(fs('type.callout'))
            .fontColor([colorOf(this.pal(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('保存工作路径')
        .onClick(() => {
          this.commit();
        })
      } else if (this.editable) {
        // ── 显示态（可点进编辑；web `:156-172` 的 `<dd onClick>`）─────────────────────
        // 值空 ⇒ 显示 `—`（web `<dd>{displayCwd ?? '—'}</dd>`），仍可点进编辑设路径。
        Row() {
          Text(this.value.length > 0 ? this.value : '—')
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
        .layoutWeight(1)
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.beginEdit();
        })
      } else {
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
  /** 会话 ID（空串 = 不显示该行；web `SessionInfo.tsx:48`）。 */
  @Prop sessionId: string = '';
  /** 渠道（空串 = 不显示该行；web `:49`）。 */
  @Prop channel: string = '';
  /** 最后活跃（空串 = 不显示该行；web `:174-176` truthy 才显示）。 */
  @Prop lastActive: string = '';
  /** 订阅串（空串 = 不显示该行；web `SessionInfo.tsx:191-193` 的 `subscription !== '—'` 口径）。 */
  @Prop subscription: string = '';
  /** 关闭面板（面板**自己**的关闭入口，头部 X 走它）。 */
  onClose: () => void = () => {
  };
  /** 打开「模型 / 上下文上限」选择栏（页面置 `showModel=true` + 拉 llm-config）。 */
  onOpenModel: () => void = () => {
  };
  /** 提交新的工作路径（页面复用既有 `set_cwd` 写路径；组件**不发** RPC）。 */
  onSubmitCwd: (dir: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 八路输入全空 ⇒ 空态（避免用户看到"点开了但什么都没有"）。 */
  private isEmpty(): boolean {
    return this.goalLine.length === 0 && this.usageText.length === 0
      && this.modelName.length === 0 && this.ctxText.length === 0 && this.cwd.length === 0
      && this.sessionId.length === 0 && this.channel.length === 0 && this.lastActive.length === 0
      && this.subscription.length === 0;
  }

  /** 本弹层的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'overlay');
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: 0 }) {
        // ── 头部：标题（`type.headline`）+ 关闭 X（真实 44 布局盒）────────────────────
        Row({ space: SPACE_XS }) {
          Text('会话状态')
            .fontSize(fs('type.headline'))
            .fontWeight(fw('type.headline'))
            .lineHeight(lh('type.headline'))
            .letterSpacing(tk('type.headline'))
            .fontColor(tc(this.pal(), 'type.headline'))
            .layoutWeight(1)
          // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`；
          //    图标视觉尺寸不变（仍 17，盒内居中）。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark'))
              .fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭')
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })

        if (this.isEmpty()) {
          // ── 空态：一行小字（无填充 / 无边框 / 无发光；docs/DESIGN-SYSTEM.md §10）──────
          Text('暂无会话状态')
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

          // ── 会话标识行（web `SessionInfo.tsx:48-49`：id / channel；空串 = 不显示该行）────
          if (this.sessionId.length > 0) {
            StatusInfoRow({ label: '会话 ID', value: this.sessionId, mono: true, theme: this.theme })
          }
          if (this.channel.length > 0) {
            StatusInfoRow({ label: '渠道', value: this.channel, theme: this.theme })
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
          // ── 订阅（web `SessionInfo.tsx:191-193` 的「订阅」行；空串 ⇒ 不显示该行）──────────
          // 标签 = web 硬编码 `"Subscription"`（原生按本仓中文面板惯例取「订阅」）；
          // 值走 mono（同 web `<InfoRow ... mono />`）；空串 ⇒ 不显示（同 web `!== '—'` 口径）。
          // ⚠️ web 源码把此行（连同 `Tokens`/`Context`）额外门在 `focusedSession?.channel === 'agent'`；
          //   本仓**既有**「用量 / 上下文上限」两行已按"值非空即显示"落地（web 那两行同样 agent-only）
          //   ⇒ 本行沿用**同一**原生惯例（否则原生会话恒为 `web` 渠道 ⇒ 该行**永不显示**=死行）。
          if (this.subscription.length > 0) {
            StatusInfoRow({ label: '订阅', value: this.subscription, mono: true, theme: this.theme })
          }
          if (this.ctxText.length > 0) {
            StatusInfoRow({ label: '上下文上限', value: this.ctxText, theme: this.theme })
          }

          // ── 工作路径（**可编辑**：点值就地改，Enter / 确认提交；web `:138-173`）────────────
          // ⚠️ `sessionId` 在场 ⇒ 即便 `cwd` 为空也保留该行（值显示 `—`），与 web 一致（`activeId`
          //    在场即渲染 workPath 行）——否则用户在此面板里**无法给无 cwd 的会话设路径**。
          if (this.sessionId.length > 0 || this.cwd.length > 0) {
            StatusInfoRow({
              label: '工作路径',
              value: this.cwd,
              mono: true,
              valueCopyable: true,
              editable: true,
              onSubmitValue: (dir: string) => {
                this.onSubmitCwd(dir);
              },
              theme: this.theme,
            })
          }
          // ── 最后活跃（web `:174-176`：truthy 才显示）──────────────────────────────
          if (this.lastActive.length > 0) {
            StatusInfoRow({ label: '最后活跃', value: this.lastActive, theme: this.theme })
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
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onOpenModel();
          })
        }
      }
      .width('100%')
      .padding({ top: SPACE_XS, bottom: SPACE_XS })
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
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev3`/`glow`，逐字节不变）。
    .width(SHEET_WIDTH)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    .transition(sheetTransition())
  }
}
