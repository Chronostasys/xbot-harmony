/**
 * 思考折叠行 —— **live 迭代与 committed 迭代共用的唯一形态**（对齐 web `ThinkingLine.tsx`）。
 *
 * ⛔ 必须是 **@Component + @Prop**，**不能**用带参全局 `@Builder`：
 *   带参 `@Builder` 的参数是**调用那一刻的快照**，其子树**不随参数变化重建**
 *   （本项目已记录：`docs/ARKTS-GOTCHAS.md §4`）。用它承载"每拍都在变的思考字数"
 *   与"打字机正文"时，症状正是用户 2026-10-10 报的：
 *     · 新迭代的「思考 N 字」**卡住不变**（停在第一帧的值，如 99），结束时才跳变；
 *     · 正文打字机**不推进**；
 *     · **点它无法展开**（子树是冻结的）。
 *   ⇒ 改为组件后，`@Prop` 变化即重建（值变化通道）。
 *
 * 形态（逐项对齐 web）：
 *   · 头部 = **图标 + 标签**，`w-fit`（不撑满整行），**无展开箭头**（用户要求删除）；
 *   · 展开体 = 左侧 2px 竖线 + 缩进，muted 色 + 0.75 透明度（弱于正文）。
 *
 * ── 在飞动效：**同一时刻只有一个动效**（2026-10-11 波，用户报「两个思考 spinner」）──────
 * web 的在飞指示**只可能有一个**，且都是**文字微光（`SweepText`）**、绝非图形：
 *   · 空内容 ⇒ `ShimmerThinking`（"思考中…"微光**文字**，`LiveIteration.tsx:217-219`）；
 *   · 有思考 ⇒ 本行的 **label** 微光（`LiveIteration.tsx:240-246`），且**仅**在
 *     `reasoningInProgress`（无正文、无工具）窗口；有正文/工具时 label 是**静态**的
 *     `思考 N 字`（`LiveIteration.tsx:246`）。
 * 原生把"在飞指示"实现为**旗舰光球**（`components/AssistantOrb`，web 无此物）⇒ 它就是那
 * **唯一的动效主角**：本行**静态**（`live` 时**只改色** `accentSoft`、**不呼吸/不脉冲**）。
 *   ⛔ 旧 wave5e 的 `.opacity(0.72→1.0)` 呼吸是"第二个高亮源"，与光球同屏即用户 2026-10-11
 *     报的「两个思考 spinner」（截图里 ① 紫色呼吸点 + ② 光球）——本波把它去掉。
 *   ⛔ 光球开启时以**光球作前导图元**（取代灯泡图标），使"在飞"读作**这一行**在飞、
 *     而不是"行上方另飘着一个 spinner"。光球关闭（设置项）时回落灯泡图标，本行仍静态。
 *   ⚠️ 契约变更：`docs/DESIGN-SYSTEM.md §8.2/§8.3` 的「只有思考 ⇒ `思考 N 字` 呼吸强调」
 *      作废，改为「光球是唯一动效；`思考 N 字` 恒静态、只以颜色表达领读」。
 *
 * 图标说明：web 用 lucide `Brain`；HarmonyOS 符号集无 brain，取语义最近的 `lightbulb`。
 *   **图标只是提示符，不承载状态**（光球关闭时才出现）。
 */
import { paletteOf, surfacesOf, thinkingBodyColor } from '../core/theme';
import { FS_CAPTION, R_LG, SP_1, SP_5 } from '../core/tokens';
import { PRESS_OPACITY, RADIUS_PILL, SPACE_HAIR, STROKE_RAIL, colorOf, } from '../core/design';
import { getReasoningOpen, setReasoningOpen } from '../core/reasoningopen';
import { AssistantOrb, ORB_MODE_THINKING } from './AssistantOrb';
import { fadeTransition } from './anim';

/** 前导光球直径 = 尺度 token `SP_5`（20vp）—— 与 `LiveTailView` 块首的独立光球**同值**。 */
const ORB_LEAD_SIZE: number = SP_5;
/** 光球相位种子（本波同屏至多一枚，为多实例预留；与 LiveTailView 的种子一致）。 */
const ORB_LEAD_SEED: number = 7;

@Component
export struct ThinkingLine {
  /** 头部标签（live = 流式字数；committed = 全量字数）。 */
  @Prop label: string = '';
  /** 展开体文本（live = 打字机裁剪后的前缀；committed = 全量思考）。 */
  @Prop body: string = '';
  /**
   * 展开态共享键（`turnID:iteration`，用 `core/reasoningopen.reasoningKey()` 构造）。
   *
   * ⛔ live 与 committed 必须用**同一构造函数**——这是"live 迭代 commit 成历史后
   *   思考块**不自动收起**"的救活点（对齐 web `ThinkingLine.tsx:49-61` 的 `stateKey`）。
   */
  @Prop @Watch('onStateKeyChange') stateKey: string = '';
  /**
   * 是否展开 —— **本地 `@State`**（不是 `@Prop`）：初值从共享 store 取，点击写回 store。
   *
   * 为什么要本地 `@State`：思考块展开态存于 `core/reasoningopen.ts` 的**模块级单例**，
   * 而模块级变量**不触发 ArkUI 重绘** ⇒ 只改 store 会"点了没反应"。本地 `@State` 既驱动本次重绘，
   * 又是 remount 后从 store 恢复的落地值（web 即 `useState` + `setReasoningOpen` 同构）。
   */
  @State open: boolean = false;
  @Prop theme: string = 'dark';
  /**
   * **生效主题的全局订阅**（§21.124：用户亲报「切主题后老文字颜色不变、新的才变」）。
   *
   * ⛔ 为什么思考块必须自己订阅：本组件挂在 `MessageRow` 的**带参 `@Builder` 子树**
   *    （`AssistantBlock(this.row)`）里 —— 该子树在主题变化时**不重建**（参数是同一个
   *    `ChatRow` 引用 ⇒ ArkUI V1 认为"参数没变"，见 `docs/ARKTS-GOTCHAS.md §4/§37`）
   *    ⇒ 子树里组件在**创建那刻**拿到的 `@Prop theme` 会**永久冻结**（旧行停在旧色板，
   *    新建的块才用新色板 = 用户看到的"老的不变、新的才变"）。
   * ✅ 正解 = 本仓范式（同 `MessageRow.themeId()` / `MarkdownView`）：**组件自己订阅**
   *    `AppStorage('appTheme')` ⇒ 主题变更直接驱动本组件重绘，不经父级投递。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** 生效主题：全局订阅优先，`@Prop theme` 仅兜底（同 `MessageRow.themeId()`）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }
  /**
   * 展开体（**长散文** 12.5fp 正文）的前景色 = 纯函数 `core/theme.thinkingBodyColor`（判据/渲染同源）。
   *
   * 取值口径与取证见该函数头（2026-10-14 用户亲报「切主题后历史正文几乎不可见」）：
   * 旧写法 `textMuted × TEXT_DIM(0.75)`（与 web `ThinkingLine.tsx:72-73` 逐字同源）合成后
   * **light 1.90:1**（web 同款 1.87:1 —— 两仓同病，web 在此不是合法基准），连本仓
   * 「`AA_MUTED=2.0` 只给元信息、不外扩到正文」都违反；且"达标档再乘 0.75"同样不达标
   * （porcelain 2.97 < 3.0）⇒ 刻度改由**层级**表达：正文 `textSecondary`（五套色板全 ≥ AA 4.5），
   * ⛔ 不再叠 `.opacity()`。
   */
  private bodyColor(): string {
    return thinkingBodyColor(paletteOf(this.themeId()));
  }
  /**
   * **此刻本行是不是主高亮源**（= `LiveTailView.thinkingIsPrimary()`，与光球 `secondary` 同源）。
   *
   * ⛔ 只决定**颜色**（`accentSoft`），**不承载任何动效** —— 动效唯一属于光球（见文件头）。
   * 默认 `false` ⇒ committed 迭代零行为变化（永远 muted、永远静态）。
   */
  @Prop live: boolean = false;
  /**
   * 是否以**旗舰光球**作本行前导图元（取代灯泡图标）。
   * 由 `LiveTailView.orb`（设置开关，缺省开）投递；committed 迭代恒 `false`。
   */
  @Prop orb: boolean = false;
  /** 光球运行态（`thinking` / `tool` / `secondary` / `idle`）—— 由调用方从状态机派生。 */
  @Prop orbMode: string = ORB_MODE_THINKING;
  /** 光球活动心跳（正文+思考的码点长度和）—— 光球据此自判静默。 */
  @Prop orbBeat: number = 0;
  /** 应用是否在后台（光球必须停表）。 */
  @Prop paused: boolean = false;
  /** 降级（reduce motion）—— 光球停表 + 静息一帧（整组唯一开关，由调用方投递）。 */
  @Prop reduceMotion: boolean = false;
  /** 点击开合（状态由调用方持有 —— 同一语义两处共用）。 */
  onToggle: () => void = () => {
  };

  /**
   * 是否允许**出现过渡**（commit 交接那一刻挂载 ⇒ 必须禁止，否则展开体淡入 = 用户看到的闪烁）。
   *
   * ⛔ 用户亲报（2026-10-16）：「stream 下一个迭代的内容的时候，如果我展开上一个迭代的思考，
   *    上一个迭代展开的思考区域**可能时不时闪烁**」「这闪烁是不是代表**重建渲染树**？」
   *
   * 真机探针实证（`aboutToAppear`/`aboutToDisappear` + hilog；同一 `stateKey` 的事件序列）：
   *   `appear live=true key=13:1 → disappear live=false key=13:1 → appear live=false key=13:1`
   *   （13:2 / 13:3 同形）⇒ **迭代 commit 那一刻，思考块在「live 槽（`LiveTailView`）↔ 已完成槽
   *   （`MessageRow.ForEach → IterationBlock`）」之间换了位置** ⇒ 旧实例销毁 + 新实例挂载。
   *   新实例挂载时 `open` 从共享 store（`core/reasoningopen`）恢复为 `true` ⇒ 展开体那条
   *   `.transition(fadeTransition())` 被当"插入"**重放** ⇒ 展开区淡入一下 = 用户看到的闪烁
   *   （且**恰好**发生在"下一迭代开始 stream 的那一刻"——上一迭代刚 commit，与用户描述逐字吻合）。
   *
   * ⇒ 初次值 = `!this.open`（在 `aboutToAppear` 里定，**先于 build**）：挂载时**已是展开态**
   *   就不播过渡（交接零闪烁）；挂载时是收起的（正常 committed 块）⇒ 允许，用户首次点开**有**动画；
   *   用户一交互即置 `true`（此后开合都有动画）。
   * ⛔ 不用 `setTimeout`（门禁 ⑨ 有计时器预算，A 级 ≤7 处）；⛔ 更不用"状态位驱动 `.opacity()`"
   *   （静息态必须可见 —— 见 :190-222 与门禁 ⑨ 的正向形态）。
   */
  @State private animReady: boolean = false;

  /** remount（live → committed）时从共享 store 恢复展开态 —— 用户展开的块不自动收起。 */
  aboutToAppear(): void {
    this.open = this.storedOpen(this.stateKey);
    // 挂载即展开（= commit 交接恢复）⇒ 挂载那一帧不播过渡（零闪烁）；否则允许（首次点击有动画）。
    this.animReady = !this.open;
  }

  /** `stateKey` 变化（如 live 迭代号推进）⇒ 读新 key 的 store 值（web 每迭代一个新组件；原生同实例复用）。 */
  onStateKeyChange(): void {
    this.open = this.storedOpen(this.stateKey);
  }

  /** store 里该 key 的展开态（无记录 ⇒ `false`，即缺省收起）。 */
  private storedOpen(key: string): boolean {
    if (key.length === 0) {
      return false;
    }
    const v: boolean | undefined = getReasoningOpen(key);
    return v !== undefined && v;
  }

  build() {
    Column({ space: 0 }) {
      // 头部：`w-fit` ⇒ 不设 width('100%')（点击热区只覆盖图标+文字，与 web 的 `w-fit` 一致）
      Row({ space: SP_1 }) {
        if (this.orb) {
          // 旗舰光球 = 本行的**前导图元**（web 里在飞指示本就是思考行自身：其 label 微光；
          // 原生把整个光球并进这一行 ⇒ 一眼读作"这一行在飞"，且同屏**唯一**动效）。
          // ⛔ 真 `@Component` + `@Prop`（带参 @Builder 会冻在首帧）。
          AssistantOrb({
            theme: this.themeId(),
            orbSize: ORB_LEAD_SIZE,
            active: true,
            paused: this.paused,
            seed: ORB_LEAD_SEED,
            orbMode: this.orbMode,
            orbBeat: this.orbBeat,
            reduceMotion: this.reduceMotion,
          })
        } else {
          // 光球关闭（设置项）⇒ 回落灯泡提示符；committed 迭代恒走这条。
          SymbolGlyph($r('sys.symbol.lightbulb'))
            .fontSize(FS_CAPTION)
            .fontColor([this.live ? paletteOf(this.themeId()).accentSoft : colorOf(paletteOf(this.themeId()), 'iconMuted')])
        }
        Text(this.label)
          .fontSize(FS_CAPTION)
          .fontColor(this.live ? paletteOf(this.themeId()).accentSoft : paletteOf(this.themeId()).textMuted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          // ⛔ **水平溢出**：与左侧图标同一 Row，标签长度不可控 ⇒ 必须能收缩（否则顶出屏宽）。
          .layoutWeight(1)
      }
      // ⛔ 本行**静态**（不写任何随时间的 `.opacity()`）：同一时刻只有一个"在飞"动效 = 光球。
      //    仅以颜色（`accentSoft`）表达"此刻它在领读"，不引入第二个脉动源。
      //    静息态**不写** `stateStyles.normal`（`normal` 会接管属性、盖掉动态值）——本行已无动态值，
      //    仍只写 `pressed`，与 web 的按钮一致（web 静息态无 opacity 规则）。
      .padding({ left: SP_1, right: SP_1, top: SPACE_HAIR, bottom: SPACE_HAIR })
      .borderRadius(RADIUS_PILL)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) } })
      .onClick(() => {
        // 本地 @State 驱动本次重绘（"点一下立刻响应"）；store 承接 remount 后的恢复。
        const next: boolean = !this.open;
        // 用户交互 ⇒ 此后开合**一律**播过渡（挂载时若已是展开态则此前为禁止，见 `animReady`）。
        this.animReady = true;
        this.open = next;
        if (this.stateKey.length > 0) {
          setReasoningOpen(this.stateKey, next);
        }
        this.onToggle();
      })

      if (this.open && this.body.length > 0) {
        Text(this.body)
          .fontSize(FS_CAPTION)
          .fontColor(this.bodyColor())
          .width('100%')
          .wordBreak(WordBreak.BREAK_WORD)
          // 对齐 web `ThinkingLine.tsx:72`：展开体 = `mt-1`(4) 上间距 + `pl-2.5`(10) 左缩进。
          .margin({ top: SP_1 })
          .padding({ left: 10, right: 0, top: 0, bottom: 0 })
          // 左栅栏是**结构性边界**（承载"这是思考展开体"的信息）⇒ 走 `hairline`
          // （浅色/极简白下比 `border` 明显更清楚；深色族 `hairline ≡ border` 逐字节零变化）。
          .border({ width: { left: STROKE_RAIL }, color: surfacesOf(paletteOf(this.themeId())).hairline })
          .copyOption(CopyOptions.LocalDevice)
          // ── 展开/收起 = **出现过渡**（对齐 web `AnimatedCollapse`：`opacity 180ms ease-out`）────
          // ⛔ 为什么用 `.transition()` 而不是"状态位 + onAppear 的 animateTo"：`if` 门控的内容
          //    **静息态就是它自己的属性（可见）**，过渡只挂"插入/移除那一下" ⇒ 过渡没跑/被打断
          //    仍停在可见（fail-safe；门禁 ⑨ `tools/lint/anim-opacity-gate.sh` 的正向形态）。
          //    ⚠️ 反面教材见 `docs/ARKTS-GOTCHAS.md`（旧实现把静息态写成 `.opacity(0)` ⇒ 正文压到 13%）。
          // ⚠️ **诚实记账（不假称与 web 一致）**：web 的 `fold-container` 是 CSS `grid-template-rows
          //    0fr→1fr`（**高度补间**）+ opacity；ArkUI 的 `TransitionEffect` **没有任何尺寸档**
          //    （SDK 实证：仅 IDENTITY/OPACITY/SLIDE/SLIDE_SWITCH/translate/rotate/scale/move/asymmetric
          //    —— `component/common.d.ts:5329-5476`）⇒ 原生这边**高度不补间**，只做了 opacity 那一半
          //    （用现有具名工厂 `fadeTransition()`，语义本就是"内容出现/消失"，⛔ 不新造工厂/时长）。
          //    ⛔ 也不为此把结构改成"Scroll 视口量高 + 动画 height"：那是**为动画改结构**（且给每行
          //    挂一个 Scroll ⇒ 性能预算与手势嵌套双重风险），收益不抵代价。
          // ── 过渡**只给用户点击的开合**（挂载那一帧 `animReady=false` ⇒ IDENTITY = 无过渡）──────
          // ⛔ 挂载即播 = 用户亲报的「展开的思考区时不时闪烁」（commit 交接时新实例以 `open=true`
          //    挂载）。见 `animReady` 的完整取证与论证。
          .transition(this.animReady ? fadeTransition() : TransitionEffect.IDENTITY)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
