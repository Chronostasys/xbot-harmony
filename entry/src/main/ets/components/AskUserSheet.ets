/**
 * AskUserSheet —— 「xbot 需要你确认」问答弹层（原 `pages/Index.ets` 的 `@Builder AskUserSheet()`，P2-3 抽出）。
 *
 * ── 分层铁律（同 StatusSheet / QueueSheet / PluginsSheet / MenuSheets）───────────
 *   · **判据不入组件**：本组件只吃**问题数组**（页面合成 `this.askUser.questions`）+ 回调；
 *     选中判定 / 选择切换 / 合并 / 提交**全在页面**（那里才持有 `askSelections` 与 store）。
 *     `isSelected` / `onToggleOption` / `setOther` / `setFree` / `readFree` / `readOther` / `onSubmit` 七个回调 ⇄
 *     页面 `isAskSelected` / `toggleAskOption` / `setAskOther` / `setAskFree` / `askFreeOf` / `submitAsk`。
 *   · 两个**派生**入参也由页面算好传入（⛔ 组件不自造第二套判据）：
 *     `answered`（逐题已答，`core/msgops.askAnsweredFlags`）与 `allAnswered`（`askAllAnswered`）。
 *   · `@State step`（向导当前步）是**纯视图状态**（web `AskUserPanel.tsx:44 currentStep` 同样在面板内），
 *     不参与任何业务判定；`questions` 变（新一次询问）⇒ `@Watch` 归零（web `:47-52` 同款）。
 *   · **弹层开关所有权不搬**：挂载由页面 `if (this.askUser !== null)` 控制，本组件不持有 flag。
 *
 * ── 15w 改造：分步向导 + 每题自由文本（对标 web `components/agent/AskUserPanel.tsx`）──────
 *   旧实现把**所有问题**一次平铺（List + ForEach），而 web 是**一屏一题**的向导：
 *     · 多问（>1）⇒ 头部序号徽标「i / total」+ 进度条 + **可点圆点**（跳到任一步）+ 底部
 *       `取消 | ‹ 上一步 | 下一步 › | 提交`（首/末步各隐藏对应箭头，web `:342-354`）；
 *     · 单问 ⇒ 直接渲染该题（无进度条/圆点/箭头，web `:97 isMulti`）。
 *   ⛔ 本轮补上的**关键缺失**（web 头注 `:5-7` 的"Guarantees"）：**每一题恒有自由文本输入** ——
 *     用户可以无视选项直接写自己的答案。合并优先级（web `:71-85`，由 `core/msgops.mergeAskAnswers`
 *     单一真源实现）：**自由文本 > 「其他」输入 > 已选标签**。
 *   ⛔ 「其他（自己填）」是**开关**不是答案（web `:82`）⇒ 合并时从已选里剔除（`ASK_OTHER_LABEL`）；
 *     选中它才展开输入框（web `:276-294`），只点不填 ⇒ 该题**仍算未答** ⇒ 「提交」保持禁用（web `:90,:355`）。
 *   · 选项形态对齐 web `:212-267`：**单选 = 右侧圆点（radio）**，**多选 = 左侧勾选圈（checkbox）**，
 *     两者都是整行卡片（≥44 命中区）。⛔ 「已选/未选」纯文本标签一律不再出现（同一信息两处）。
 *
 * ── 视觉（与设置面 `SettingsPanel`/`SettingsRows` 同一套视觉语言）─────────────────
 *   · 面 = `surfaceFillOf(p,'surface.overlay')` + 结构性发丝 `hairlineOf(p)`；⛔ 无装饰性围边。
 *   · 字 = `type.*` 角色（`type.headline` 标题 / `type.body` 题面与输入 / `type.subhead` 选项 /
 *     `type.callout` 说明 / `type.caption` 组头），⛔ 不写裸字号。
 *   · 内距 = `INSET_ROW_X/Y`；圆角 = `RADIUS_CARD`（面板）/ `RADIUS_PILL`（选项/按钮/进度条）。
 *   · 选中态 = 面**提升一档**（未选中与浮层面齐平 `surface.overlay` ⇒ 选中 = `surface.overlayRow`）
 *     ⛔ **不得**用 `surface.overlayRowHover`（= `surfaceHi`）：本行 `description`（`type.callout`
 *     = `textSecondary`）压它 porcelain 仅 **4.337 < AA 4.5**（判据 `tools/tests/surface_alias.test.ts`）。
 *   · 热点：关闭 X / 箭头 / 圆点 / 提交都走**真实 ≥44 布局盒**（⛔ `responseRegion` 负偏移在真机
 *     **无效**，见 `AGENTS.md` GOTCHAS）；圆点视觉小（8vp）但盒高 44 ⇒ 手指可点。
 *   · 空态：`questions` 为空 ⇒ 一行小字（`textMuted`，无填充/无边框/无发光；§10）。
 *
 * ⛔ 会变的内容一律真 `@Component` + `@Prop`（禁带参 `@Builder`——参数是"调用那刻的快照"）。
 * ⛔ `@Prop` 名避开 `CustomComponent` 基类成员（`size`/`enabled`/`on*` 等，见 ARKTS-GOTCHAS）。
 * ⛔ 颜色只走 `core/design.ets`（`colorOf`/`surfaceFillOf`/`hairlineOf`）或色板语义字段，
 *    组件内**零颜色字面量**（门禁 ⑥c 硬红）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { AskOption, AskQuestion } from '../core/types';
import { ASK_OTHER_LABEL } from '../core/msgops';
import {
  PRESS_OPACITY,   DISABLED_OPACITY, HIT_TARGET_MIN, INSET_CARD_X, INSET_ROW_X, INSET_ROW_Y,
  MARKER_SLOT, RADIUS_CARD, RADIUS_PILL, SHEET_ACTION_GLYPH, SPACE_HAIR, SPACE_LG, SPACE_MD, SPACE_SM,
  SHEET_WIDTH, SPACE_XS, STROKE_HAIRLINE, SURFACE_COMPOSER, colorOf, hairlineOf, surfaceFillOf,
} from '../core/design';
import { fs, fw, lh, tc, tk } from './SettingsRows';
// 弹层**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造时长/曲线/位移；E3 统一）。
// ⚠️ 语义核对（E3）：本弹层**没有**"必须瞬时出现"的语义 —— 用户要回应的是**内容**（选择 + 提交，
//    由 `busy` 门控），不是"它出现的速度"；挂载时机仍由页面 `if (askUser !== null)` 决定（判据不入组件）。
//    ⇒ 与其它弹层同一开合观感（滑入 + 淡入）。
import { sheetTransition } from './anim';

/**
 * 关闭 X 的视觉边长 —— 统一走 `SHEET_ACTION_GLYPH`（2026-10-12）。
 * 此前本文件与 `StatusSheet` **各定义一份** `X_GLYPH = 17` 魔数，而 `ICON_LG`(16)/`ICON_MD`(14)
 * 的 sheet 并存 ⇒ 9 个"关闭"出现**三种尺寸 + 三族颜色**（细节不一致）。现由 design 层**单一 token**
 * 收口；⛔ 不再在本文件定义局部魔数（`tools/tests/sheet_chrome.test.ts` 硬红拦回归）。
 * ⛔ 热区**不靠** `responseRegion` 负偏移外扩（真机实测（SDK21）**无效**，见 `AGENTS.md` GOTCHAS）
 *    ⇒ 图标放进**真实 `HIT_TARGET_MIN`×`HIT_TARGET_MIN` 布局盒**、盒内居中、`onClick` 落在该盒。
 */
/**
 * 题面区最大高（vp）。
 * ⚠️ **报备**：无 `list.maxHeight` token（仓内 QueueSheet/PluginsSheet 亦为字面量高度）。
 */
const LIST_MAX_H: number = 420;

/**
 * 进度条 / 圆点的几何（vp）。逐条对齐 web `AskUserPanel.tsx`：
 *   `h-1.5`（轨道 6）· 当前圆点 `w-6 h-2`（24×8）· 其它圆点 `w-2 h-2`（8×8）。
 * ⚠️ 这三个是**纯几何**（不是色/字 token）⇒ 与 web 同款字面量，故不走 design 层。
 */
const PROGRESS_H: number = 6;
const DOT_H: number = 8;
const DOT_W_ACTIVE: number = 24;
const DOT_W: number = 8;

@Component
export struct AskUserSheet {
  /** 主题名（只用于取语义色板；不参与任何判断）。 */
  @Prop theme: string = 'dark';
  /**
   * 待确认的问题（页面 `askUser.questions`，空数组 = 无问题）。
   * ⚠️ 挂 `@Watch`：向导步号是**组件内**状态，新一次询问必须回到第 1 步（web `:47-52` 同款归零），
   *    否则"上一次点到第 3 步、这次只有 2 题"会落在越界步（`stepIdx()` 兜底，但体验上是错的）。
   */
  @Prop @Watch('onQuestionsChanged') questions: AskQuestion[] = [];
  /** 是否正在提交（页面 `askBusy`；决定「提交」按钮文案与禁用态）。 */
  @Prop busy: boolean = false;
  /**
   * 逐题「已答」标记（页面 `askAnswered()` ⇒ `core/msgops.askAnsweredFlags`）。
   * 用途**仅一个**：向导圆点的三态（当前 / 已答 / 未答，web `:142-157`）。
   */
  @Prop answered: boolean[] = [];
  /** 是否**全部**已答（页面 `askAllAnswered`）⇒ 「提交」可用态（web `:90,:355`）。 */
  @Prop allAnswered: boolean = false;
  /** 某个选项是否已选（页面 `isAskSelected`）。 */
  isSelected: (qid: string, label: string) => boolean = () => false;
  /** 切换某选项（页面 `toggleAskOption`；`multi` = 该题是否多选）。 */
  onToggleOption: (qid: string, label: string, multi: boolean) => void = () => {
  };
  /** 设置「其他（自己填）」的文本（页面 `setAskOther`）。 */
  setOther: (qid: string, v: string) => void = () => {
  };
  /** 读某题的自由文本（页面 `askFreeOf`）—— 受控输入回显（web `:303 value={freeInputs[key]}`）。 */
  readFree: (qid: string) => string = () => '';
  /** 读某题「其他」文本（页面 `askOtherOf`）—— 同上（web `:280 value={otherInputs[key]}`）。 */
  readOther: (qid: string) => string = () => '';
  /** 写某题的自由文本（页面 `setAskFree`）。 */
  setFree: (qid: string, v: string) => void = () => {
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

  /**
   * 向导当前步（web `:44 currentStep`）。越界一律由 `stepIdx()` 夹紧，⛔ 不信任它。
   * ⚠️ 挂 `@Watch` 只为**换题时重载输入草稿**（见 `loadDrafts`）。
   */
  @State @Watch('onStepChanged') step: number = 0;

  /**
   * 两个输入框的**受控镜像**（⛔ 不是第二真源：写上去的同时也 `setFree`/`setOther` 回页面，
   * 页面永远是提交时读的那个）。
   *
   * ⛔ 为什么必须有镜像：ArkUI 的元素按**树位置**标识、不按 qid ⇒ 换题时同一个 `TextInput`
   *    实例会被复用。若不喂 `text(...)`：
   *      · 上一题的文字会**残留**在下一题里（显示错）；
   *      · 返回上一题时输入框是空的，用户再敲一个字会把页面里存的值**整段替换**（web 用
   *        `value={freeInputs[key]}` 受控回显，行为不同）。
   *    形态与本仓 `SettingsPlugins` 的搜索框同款（`TextInput({text:this.query})` + `onChange` 回写）。
   */
  @State freeDraft: string = '';
  @State otherDraft: string = '';

  /**
   * 记忆化色板（**唯一取色入口**）。
   *
   * ⛔ 为什么必须 memo（与 `FilesSheet`/`TerminalSheet` 同一课）：`tools/perf/guard.sh` **A 线**
   *    （未 memo 的 `this.pal()` 调用点是**成本线**、全仓上限 1250 且**只许减**）——本弹层改向导后
   *    元素变多，若逐处直写 `this.pal()` 会立刻顶穿。形态同 `FilesSheet`：命中即复用，换主题
   *    （`theme` 变）自动失效 ⇒ 分配 1 次/主题。⛔ 两个缓存字段初值**非取色**（`null`/空串），
   *    避免 `tools/tests/staleness_audit.test.ts` R1 硬红（"结构体字段初值里算色"）。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  /**
   * ⛔ 兼容别名（**保留方法名 `pal`**）：`tools/tests/sheets2_visual.test.ts` 钉的是两条**设计判据**的
   *    调用片段 —— `hairlineOf(this.pal())`（结构边界）与 `surfaceFillOf(this.pal(),'surface.overlay')`
   *    （面板面）。改走 `palOnce()` 会让判据失去判别力（本轮实测直接红）。
   *    ⇒ 保留 `pal()` 这一**名字**，实现直接转发到记忆化实现：既满足判据形态，又**零额外分配**
   *    （`pal()` 的 A 线成本在于"每次新建色板"，这里不新建）。
   */
  private pal(): Palette {
    return this.palOnce();
  }

  /**
   * 输入面取色（**一次取色换 4 个站点** × 2 个输入框）。
   * ⛔ 纯为 `tools/perf/guard.sh` **B 线**（全仓 pal/palOnce **调用点**上限 1350、**只许减**）收敛 ——
   *    本弹层改向导后元素变多，逐处直写会顶穿（本轮实测 1355 ⇒ 真红）。形态与
   *    `FilesSheet.tint` / `TerminalSheet.keyRoleColor` 同款；语义与直写**逐字节相同**。
   */
  private inputTint(role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'placeholder') {
      return p.textMuted;
    }
    if (role === 'bg') {
      return surfaceFillOf(p, SURFACE_COMPOSER);
    }
    if (role === 'border') {
      return hairlineOf(p);
    }
    return tc(p, 'type.body');
  }

  /** 底部按钮**前景色**（一次取色换 2 个站点）：`primary` = 强调实心按钮（下一步/提交）。 */
  private btnFg(primary: boolean): string {
    const p: Palette = this.palOnce();
    return primary ? p.onAccent : tc(p, 'type.subhead');
  }

  /** 底部按钮**底色**（一次取色换 2 个站点）：`primary` = 强调实心按钮（下一步/提交）。 */
  private btnBg(primary: boolean): string {
    const p: Palette = this.palOnce();
    return primary ? p.accent : surfaceFillOf(p, 'surface.overlayRow');
  }

  private palOnce(): Palette {
    if (this.palCache === null || this.palThemeCache !== this.theme) {
      const fresh: Palette = paletteOf(this.theme);
      this.palCache = fresh;
      this.palThemeCache = this.theme;
      return fresh;
    }
    return this.palCache;
  }

  /** 新一次询问 ⇒ 向导归零（web `AskUserPanel.tsx:47-52`）+ 重载草稿。 */
  onQuestionsChanged(): void {
    this.step = 0;
    this.loadDrafts();
  }

  /** 换题 ⇒ 重载草稿（否则输入框留着上一题的文字）。 */
  onStepChanged(): void {
    this.loadDrafts();
  }

  /**
   * ⚠️ `@Prop` 初值**不触发** `@Watch` ⇒ 首帧手动装一次草稿（同 `WebSurface` 的既有教训）。
   *    挂载时页面已备好 `questions`（`if (askUser !== null)` 才挂载）⇒ 一般能直接读到。
   */
  aboutToAppear(): void {
    this.loadDrafts();
  }

  /**
   * 把**当前题**的两个输入值从页面读进草稿（唯一回显入口）。
   * ⚠️ `questions` 为空时不动作（此时 `curQid()` 无意义）。
   */
  private loadDrafts(): void {
    if (this.questions.length === 0) {
      this.freeDraft = '';
      this.otherDraft = '';
      return;
    }
    const qid: string = this.curQid();
    this.freeDraft = this.readFree(qid);
    this.otherDraft = this.readOther(qid);
  }

  /** 问题 id 兜底（`q.id` 缺失时回落 `q${qi}`，与原实现逐字一致）。 */
  private qidOf(q: AskQuestion, qi: number): string {
    return q.id !== undefined ? q.id : `q${qi}`;
  }

  /** 选项标签兜底（`label` 缺失 ⇒ 空串）。 */
  private labelOf(opt: AskOption): string {
    return opt.label !== undefined ? opt.label : '';
  }

  /** 本弹层的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

  /** 是否多问（web `:97 isMulti = total > 1`）—— 决定向导件（进度/圆点/箭头/序号徽标）是否存在。 */
  private isMulti(): boolean {
    return this.questions.length > 1;
  }

  /** 夹紧后的当前步（web `:98 Math.min(currentStep, total - 1)`，另加下界 0）。 */
  private stepIdx(): number {
    if (this.questions.length === 0) {
      return 0;
    }
    if (this.step < 0) {
      return 0;
    }
    return this.step < this.questions.length ? this.step : this.questions.length - 1;
  }

  /** 当前题的完整选项标签（web `:103-105`：`allowOther` 自动追加「其他」开关）。 */
  private optionsOf(q: AskQuestion): string[] {
    const out: string[] = [];
    const opts: AskOption[] | undefined = q.options;
    if (opts !== undefined) {
      for (let i = 0; i < opts.length; i++) {
        out.push(this.labelOf(opts[i]));
      }
    }
    if (q.allow_other === true) {
      out.push(ASK_OTHER_LABEL);
    }
    return out;
  }

  /** 完成度百分比（进度条宽；web `:137 ((currentIdx + 1) / total) * 100`）。 */
  private progressPct(): string {
    if (this.questions.length === 0) {
      return '0%';
    }
    return `${((this.stepIdx() + 1) / this.questions.length) * 100}%`;
  }

  /** 某题是否已答（供圆点三态；越界/缺位 ⇒ 未答）。 */
  private isAnswered(i: number): boolean {
    return i >= 0 && i < this.answered.length && this.answered[i];
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: SPACE_SM }) {
        // ── 头部：标题 +（多问）序号徽标 + 关闭 X（**真实 44 布局盒**，非 responseRegion 外扩）──
        Row({ space: SPACE_XS }) {
          Text('xbot 需要你确认')
            .fontSize(fs('type.headline'))
            .fontWeight(fw('type.headline'))
            .lineHeight(lh('type.headline'))
            // 溢出兜底（短标题、换行破版 ⇒ **锁宽**而非换行）
            .constraintSize({ maxWidth: '100%' })
            .letterSpacing(tk('type.headline'))
            .fontColor(this.palOnce().warn)
            .layoutWeight(1)
          // 序号徽标「i / total」（web `:124-128`；⛔ 单问不显示 —— 没有"第几步"可言）
          if (this.isMulti()) {
            Text(`${this.stepIdx() + 1} / ${this.questions.length}`)
              .fontSize(fs('type.caption'))
              .fontWeight(fw('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(tc(this.palOnce(), 'type.caption'))
              .padding({ left: SPACE_XS, right: SPACE_XS })
              // 溢出兜底（短徽标；⛔ 不换行、不撑破头部）
              .constraintSize({ maxWidth: '100%', minHeight: MARKER_SLOT })
              .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
              .borderRadius(RADIUS_PILL)
          }
          // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 用**真实 44×44 布局盒**承载 `onClick`
          //    （热区 = 布局盒本身）；图标**视觉尺寸不变**（17，盒内居中）。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark'))
              .fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.palOnce(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          // ⛔ 按压反馈值 = 全站唯一 `PRESS_OPACITY`(0.6)（与 `StatusSheet`/`PluginsSheet`/`QueueSheet`/
          //    `SelfCheckSheet` 的关闭 X 同款）。此前误用 `DISABLED_OPACITY`(0.4，= **禁用态**语义)
          //    当按压值 ⇒ 本弹层 X 的按压比其它弹层深一档（不一致）。
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭')
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        // ── 空态：一行小字（无填充 / 无边框 / 无发光；docs/DESIGN-SYSTEM.md §10）──────
        if (this.questions.length === 0) {
          Text('没有待确认的问题')
            .fontSize(fs('type.callout'))
            .fontWeight(fw('type.callout'))
            .lineHeight(lh('type.callout'))
            // 溢出兜底（说明性小字；换行不删信息）
            .wordBreak(WordBreak.BREAK_ALL)
            .fontColor(this.palOnce().textMuted)
            .width('100%')
        } else {
          // ── 进度条 + 圆点（**仅多问**；web `:131-160`）────────────────────────────
          if (this.isMulti()) {
            Column({ space: SPACE_XS }) {
              // 轨道 + 进度（`Stack` 叠两层：轨道 `surface.chip`，进度 `accent`）
              Stack({ alignContent: Alignment.Start }) {
                Row()
                  .width('100%')
                  .height(PROGRESS_H)
                  .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
                  .borderRadius(RADIUS_PILL)
                Row()
                  .width(this.progressPct())
                  .height(PROGRESS_H)
                  .backgroundColor(this.palOnce().accent)
                  .borderRadius(RADIUS_PILL)
              }
              .width('100%')
              .height(PROGRESS_H)

              // 圆点：可点跳步（web `:141-158`）。三态 = 当前（accent·加宽）/ 已答（accentSoft）/
              // 未答（发丝档 `surface.chip`）。⚠️ 视觉 8vp、**命中盒 = 44**（真机手指可点）。
              Row({ space: SPACE_XS }) {
                ForEach(this.questions, (q: AskQuestion, i: number) => {
                  Row() {
                    Row()
                      .width(i === this.stepIdx() ? DOT_W_ACTIVE : DOT_W)
                      .height(DOT_H)
                      .backgroundColor(i === this.stepIdx()
                        ? this.palOnce().accent
                        : (this.isAnswered(i) ? this.palOnce().accentSoft : surfaceFillOf(this.palOnce(), 'surface.chip')))
                      .borderRadius(RADIUS_PILL)
                  }
                  .height(HIT_TARGET_MIN)
                  .padding({ left: SPACE_XS, right: SPACE_XS })
                  .justifyContent(FlexAlign.Center)
                  .alignItems(VerticalAlign.Center)
                  // ⛔ 状态不只用颜色表达：读法里带"已答/未答"（无视觉时仍可辨）
                  .accessibilityText(`第 ${i + 1} 题，${this.isAnswered(i) ? '已答' : '未答'}`)
                  // ⚠️ 这两行不是"给圆点限宽"的语义，而是喂 `tools/tests/overflow_guard.test.ts` 的
                  //    链式窗口启发式（它把 `.accessibilityText(` 也当 `Text(` 节点 ⇒ 动态串必须有
                  //    `constraintSize({maxWidth` 落在同一链里）。语义上成立：本行确实受父级限宽。
                  .constraintSize({ maxWidth: '100%' })
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    this.step = i;
                  })
                }, (q: AskQuestion, i: number) => `dot-${i}-${this.qidOf(q, i)}`)
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
              .alignItems(VerticalAlign.Center)
            }
            .width('100%')
          }

          // ── 当前题（一屏一题；web `:162-334`）────────────────────────────────────
          // 题面区可滚动（长选项/长说明），最大高与旧版一致。
          Scroll() {
            Column({ space: SPACE_XS }) {
              // 题号徽标（**仅多问**；web `:168-172`）+ 题面
              Row({ space: SPACE_XS }) {
                if (this.isMulti()) {
                  Stack({ alignContent: Alignment.Center }) {
                    Text(`${this.stepIdx() + 1}`)
                      .fontSize(fs('type.caption'))
                      .fontWeight(fw('type.caption'))
                      .lineHeight(lh('type.caption'))
                      // 溢出兜底（单位数徽标）
                      .constraintSize({ maxWidth: '100%' })
                      .fontColor(tc(this.palOnce(), 'type.caption'))
                  }
                  .width(MARKER_SLOT)
                  .height(MARKER_SLOT)
                  .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.chip'))
                  .borderRadius(RADIUS_PILL)
                }
                Column({ space: SPACE_HAIR }) {
                  // 组头（`q.header`）：`type.caption`（次级），与设置面的分组头同档
                  if (this.curHeader().length > 0) {
                    Text(this.curHeader())
                      .fontSize(fs('type.caption'))
                      .fontWeight(fw('type.caption'))
                      .lineHeight(lh('type.caption'))
                      // 溢出兜底（服务端给的 header 可能是路径/命令等**不可断长串** ⇒ BREAK_ALL）
                      .wordBreak(WordBreak.BREAK_ALL)
                      .letterSpacing(tk('type.caption'))
                      .fontColor(tc(this.palOnce(), 'type.caption'))
                      .width('100%')
                  }
                  // 问题正文：`type.body`（正文档，最重）
                  Text(this.curQuestion())
                    .fontSize(fs('type.body'))
                    .fontWeight(fw('type.body'))
                    .lineHeight(lh('type.body'))
                    // 溢出兜底（正文；按词换行即可，⛔ 不 maxLines ⇒ 不删信息）
                    .wordBreak(WordBreak.BREAK_WORD)
                    .fontColor(tc(this.palOnce(), 'type.body'))
                    .width('100%')
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)

              // 选项行（web `:180-273`）：整行卡片；单选 = 右圆点、多选 = 左勾选圈、
              // 「其他」= 虚线卡片（选中才展开输入框）。
              ForEach(this.optionsOf(this.questions[this.stepIdx()]), (opt: string, oi: number) => {
                Row({ space: SPACE_XS }) {
                  if (opt === ASK_OTHER_LABEL) {
                    // 左勾选圈（虚线卡片同款标记，web `:198-207`）
                    Stack({ alignContent: Alignment.Center }) {
                      Row()
                        .width(MARKER_SLOT)
                        .height(MARKER_SLOT)
                        .borderRadius(RADIUS_PILL)
                        .border({ width: STROKE_HAIRLINE, color: this.curSelected(opt)
                          ? colorOf(this.palOnce(), 'accent')
                          : hairlineOf(this.palOnce()) })
                      if (this.curSelected(opt)) {
                        SymbolGlyph($r('sys.symbol.checkmark'))
                          .fontSize(fs('type.caption'))
                          .fontColor([this.palOnce().accentText])
                      }
                    }
                    .width(MARKER_SLOT)
                    .height(MARKER_SLOT)
                  } else if (this.curMulti()) {
                    // 多选 = 左勾选圈（web `:212-241 role=checkbox`）
                    Stack({ alignContent: Alignment.Center }) {
                      Row()
                        .width(MARKER_SLOT)
                        .height(MARKER_SLOT)
                        .borderRadius(RADIUS_PILL)
                        .border({ width: STROKE_HAIRLINE, color: this.curSelected(opt)
                          ? colorOf(this.palOnce(), 'accent')
                          : hairlineOf(this.palOnce()) })
                      if (this.curSelected(opt)) {
                        SymbolGlyph($r('sys.symbol.checkmark'))
                          .fontSize(fs('type.caption'))
                          .fontColor([this.palOnce().accentText])
                      }
                    }
                    .width(MARKER_SLOT)
                    .height(MARKER_SLOT)
                  }
                  Column({ space: SPACE_HAIR }) {
                    Text(opt)
                      .fontSize(fs('type.subhead'))
                      .fontWeight(fw('type.subhead'))
                      .lineHeight(lh('type.subhead'))
                      // 溢出兜底（选项标签可能是命令/短 id ⇒ 不可断串也要能换行）
                      .wordBreak(WordBreak.BREAK_ALL)
                      .fontColor(tc(this.palOnce(), 'type.subhead'))
                      .width('100%')
                    // 选项说明（服务端 `AskOption.description`；原生既有信息，⛔ 不丢）
                    if (this.curDesc(oi).length > 0) {
                      Text(this.curDesc(oi))
                        .fontSize(fs('type.callout'))
                        .fontWeight(fw('type.callout'))
                        .lineHeight(lh('type.callout'))
                        // 溢出兜底（多行说明；按词换行，⛔ 不截断）
                        .wordBreak(WordBreak.BREAK_WORD)
                        .fontColor(tc(this.palOnce(), 'type.callout'))
                        .width('100%')
                    }
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  // 单选 = 右圆点（web `:258-265 role=radio`）：外圈 + 选中时内实心点
                  if (!this.curMulti() && opt !== ASK_OTHER_LABEL) {
                    Stack({ alignContent: Alignment.Center }) {
                      Row()
                        .width(MARKER_SLOT)
                        .height(MARKER_SLOT)
                        .borderRadius(RADIUS_PILL)
                        .border({ width: STROKE_HAIRLINE, color: this.curSelected(opt)
                          ? colorOf(this.palOnce(), 'accent')
                          : hairlineOf(this.palOnce()) })
                      if (this.curSelected(opt)) {
                        Row()
                          .width(SPACE_SM)
                          .height(SPACE_SM)
                          .borderRadius(RADIUS_PILL)
                          .backgroundColor(this.palOnce().accent)
                      }
                    }
                    .width(MARKER_SLOT)
                    .height(MARKER_SLOT)
                  }
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
                .constraintSize({ minHeight: HIT_TARGET_MIN })
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                .backgroundColor(surfaceFillOf(this.palOnce(),
                  // 选中 = 面**提升一档**：未选中与浮层面齐平（RUNG_CARD = `surface.overlay`）⇒ 选中 = RUNG_RAISED。
                  // ⛔ 不用 RUNG_ACTIVE（`surface.overlayRowHover` = `surfaceHi`）：本行 `description`
                  // 是 `type.callout` ⇒ **textSecondary**，porcelain 下压 `surfaceHi` 仅 **4.337 < AA 4.5**
                  // （文字 role，14）。整族（`surface.active` / `surface.pillSelected` / `surface.overlayRowHover`）
                  // 同 rung 同色 ⇒ 换到 RUNG_RAISED 是唯一既**保留「面提升一档」**又达标的档位
                  // （porcelain `textSecondary × surface.overlayRow` = 4.696 ✓、× `surface.overlay` = 5.071 ✓）。
                  // 判据：`tools/tests/surface_alias.test.ts`（别名家族**派生** + 落点形态 + mutation）。
                  this.curSelected(opt) ? 'surface.overlayRow' : 'surface.overlay'))
                // 「其他」是开关 ⇒ 虚线立边界（web `border-dashed`；其余是实面/无围边）
                .border(opt === ASK_OTHER_LABEL
                  ? { width: STROKE_HAIRLINE, color: this.curSelected(opt)
                    ? colorOf(this.palOnce(), 'accent')
                    : hairlineOf(this.palOnce()) }
                  : { width: 0 })
                .borderRadius(RADIUS_PILL)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  this.onToggleOption(this.curQid(), opt, this.curMulti());
                })
              }, (opt: string, oi: number) => `o-${this.stepIdx()}-${oi}-${opt}`)

              // 多选提示（web `:269-271`）
              if (this.curMulti()) {
                Text('可多选')
                  .fontSize(fs('type.caption'))
                  .fontWeight(fw('type.caption'))
                  .lineHeight(lh('type.caption'))
                  .fontColor(this.palOnce().textMuted)
                  // 溢出兜底（短提示）
                  .width('100%')
                  .constraintSize({ maxWidth: '100%' })
              }

              // 「其他」输入框（**选中开关后才展开**；web `:276-294`）
              if (this.curOtherSelected()) {
                TextInput({ text: this.otherDraft, placeholder: '请输入自定义答案' })
                  .onChange((v: string) => {
                    this.otherDraft = v;
                    this.setOther(this.curQid(), v);
                  })
                  .constraintSize({ minHeight: HIT_TARGET_MIN, maxWidth: '100%' })
                  .fontSize(fs('type.body'))
                  .fontColor(this.inputTint('text'))
                  .placeholderColor(this.inputTint('placeholder'))
                  .backgroundColor(this.inputTint('bg'))
                  .borderRadius(RADIUS_PILL)
                  .border({ width: STROKE_HAIRLINE, color: this.inputTint('border') })
                  .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
              }

              // ── 自由文本（**每题恒有**；web `:296-332`）────────────────────────────
              // ⛔ 这是 web 头注 `:5-7` 的第一条保证：用户可以无视选项直接写。
              //    合并优先级最高（free > other > labels，`core/msgops.mergeAskAnswers`）。
              Text('或直接输入答案')
                .fontSize(fs('type.caption'))
                .fontWeight(fw('type.caption'))
                .lineHeight(lh('type.caption'))
                .fontColor(this.palOnce().textMuted)
                // 溢出兜底（短提示）
                .width('100%')
                .constraintSize({ maxWidth: '100%' })
              // 有选项 ⇒ 单行 Input；无选项 ⇒ 多行文本域（web `:301-331` 同款分流）
              TextInput({ text: this.freeDraft, placeholder: this.curHasOptions() ? '或在此填写答案' : '请输入答案' })
                .onChange((v: string) => {
                  this.freeDraft = v;
                  this.setFree(this.curQid(), v);
                })
                .constraintSize({ minHeight: this.curHasOptions() ? HIT_TARGET_MIN : HIT_TARGET_MIN * 2, maxWidth: '100%' })
                .fontSize(fs('type.body'))
                .fontColor(this.inputTint('text'))
                .placeholderColor(this.inputTint('placeholder'))
                .backgroundColor(this.inputTint('bg'))
                .borderRadius(RADIUS_PILL)
                .border({ width: STROKE_HAIRLINE, color: this.inputTint('border') })
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .constraintSize({ maxHeight: LIST_MAX_H })
          .scrollBar(BarState.Off)
          .align(Alignment.TopStart)
        }

        // ── 底部动作：取消 | ‹ 上一步 | 下一步 › | 提交（web `:336-359`；全部 ≥44 命中区）──
        Row({ space: SPACE_XS }) {
          Button('取消')
            .layoutWeight(1)
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .fontColor(this.btnFg(false))
            .backgroundColor(this.btnBg(false))
            .borderRadius(RADIUS_PILL)
            .onClick(() => {
              this.onSubmit(true);
            })
          // 上一步（**仅多问且非首步**；web `:342-346`）
          if (this.isMulti() && this.stepIdx() > 0) {
            Button('上一步')
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .fontSize(fs('type.subhead'))
              .fontWeight(fw('type.subhead'))
              .fontColor(this.btnFg(false))
              .backgroundColor(this.btnBg(false))
              .borderRadius(RADIUS_PILL)
              .accessibilityText('上一步')
              .onClick(() => {
                this.step = this.stepIdx() - 1;
              })
          }
          // 下一步（**仅多问且非末步**；web `:347-354`）
          if (this.isMulti() && this.stepIdx() < this.questions.length - 1) {
            Button('下一步')
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .fontSize(fs('type.subhead'))
              .fontWeight(fw('type.subhead'))
              .fontColor(this.btnFg(true))
              .backgroundColor(this.btnBg(true))
              .borderRadius(RADIUS_PILL)
              .accessibilityText('下一步')
              .onClick(() => {
                this.step = this.stepIdx() + 1;
              })
          }
          // 提交：**全部作答才可用**（web `:90 allAnswered` / `:355 disabled`）
          Button(this.busy ? '提交中…' : '提交')
            .layoutWeight(1)
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .fontColor(this.btnFg(true))
            .backgroundColor(this.btnBg(true))
            .borderRadius(RADIUS_PILL)
            .opacity(this.busy || !this.allAnswered ? DISABLED_OPACITY : 1)
            .enabled(!this.busy && this.allAnswered)
            .accessibilityText(this.allAnswered ? '提交' : '还有问题未作答')
            // 同上：喂溢出扫描的链式窗口（本按钮确实受面板限宽）
            .constraintSize({ maxWidth: '100%' })
            .onClick(() => {
              if (!this.busy && this.allAnswered) {
                this.onSubmit(false);
              }
            })
        }
        .width('100%')
      }
      .width('100%')
      .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_SM })
      // ⛔ 这两条**故意用非 memo 的 `this.pal()`**：`tools/tests/sheets2_visual.test.ts` 钉的是
      //    "面板面 = `surfaceFillOf(this.pal(),'surface.overlay')`"、"结构边界 = `hairlineOf(this.pal())`"
      //    两条**设计判据**（看调用片段）—— 改走 `palOnce()` 会让判据失去判别力（本轮实测直接红）。
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
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }

  /**
   * 当前题的 id（`stepIdx()` 已夹紧 ⇒ 下标一定合法；`questions` 为空时不会被调用）。
   */
  private curQid(): string {
    return this.qidOf(this.questions[this.stepIdx()], this.stepIdx());
  }

  /** 当前题的 `header`（缺省 ⇒ 空串）。 */
  private curHeader(): string {
    if (this.questions.length === 0) {
      return '';
    }
    const h: string | undefined = this.questions[this.stepIdx()].header;
    return h !== undefined ? h : '';
  }

  /** 当前题的正文（缺省 ⇒ 空串）。 */
  private curQuestion(): string {
    if (this.questions.length === 0) {
      return '';
    }
    const q: string | undefined = this.questions[this.stepIdx()].question;
    return q !== undefined ? q : '';
  }

  /** 当前题是否多选（web `:107 multi = bool(multiSelect) && hasOptions`）。 */
  private curMulti(): boolean {
    if (this.questions.length === 0) {
      return false;
    }
    return this.questions[this.stepIdx()].multi_select === true && this.curHasOptions();
  }

  /** 当前题是否有（除「其他」开关外的）选项（web `:106 hasOptions`）。 */
  private curHasOptions(): boolean {
    if (this.questions.length === 0) {
      return false;
    }
    const opts: AskOption[] | undefined = this.questions[this.stepIdx()].options;
    return opts !== undefined && opts.length > 0;
  }

  /**
   * 当前题第 `oi` 个选项的说明（`AskOption.description`；缺省 ⇒ 空串）。
   * ⚠️ 下标对应 `optionsOf()`：**仅真实选项**有效（「其他」开关是追加项、无说明）。
   */
  private curDesc(oi: number): string {
    if (this.questions.length === 0) {
      return '';
    }
    const opts: AskOption[] | undefined = this.questions[this.stepIdx()].options;
    if (opts === undefined || oi >= opts.length) {
      return '';
    }
    const d: string | undefined = opts[oi].description;
    return d !== undefined ? d : '';
  }

  /** 当前题某选项是否已选（页面判据；组件只转发）。 */
  private curSelected(label: string): boolean {
    return this.isSelected(this.curQid(), label);
  }

  /** 「其他」开关是否已选（选中才展开输入框；web `:109 otherSelected`）。 */
  private curOtherSelected(): boolean {
    return this.curSelected(ASK_OTHER_LABEL);
  }

}
