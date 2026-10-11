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
import { paletteOf, surfacesOf } from '../core/theme';
import { FS_CAPTION, R_LG, SP_1, SP_5 } from '../core/tokens';
import { PRESS_OPACITY, RADIUS_PILL, SPACE_HAIR, STROKE_RAIL, TEXT_DIM, colorOf, } from '../core/design';
import { getReasoningOpen, setReasoningOpen } from '../core/reasoningopen';
import { AssistantOrb, ORB_MODE_THINKING } from './AssistantOrb';

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

  /** remount（live → committed）时从共享 store 恢复展开态 —— 用户展开的块不自动收起。 */
  aboutToAppear(): void {
    this.open = this.storedOpen(this.stateKey);
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
            theme: this.theme,
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
            .fontColor([this.live ? paletteOf(this.theme).accentSoft : colorOf(paletteOf(this.theme), 'iconMuted')])
        }
        Text(this.label)
          .fontSize(FS_CAPTION)
          .fontColor(this.live ? paletteOf(this.theme).accentSoft : paletteOf(this.theme).textMuted)
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
        this.open = next;
        if (this.stateKey.length > 0) {
          setReasoningOpen(this.stateKey, next);
        }
        this.onToggle();
      })

      if (this.open && this.body.length > 0) {
        Text(this.body)
          .fontSize(FS_CAPTION)
          .fontColor(paletteOf(this.theme).textMuted)
          .opacity(TEXT_DIM)
          .width('100%')
          .wordBreak(WordBreak.BREAK_WORD)
          // 对齐 web `ThinkingLine.tsx:72`：展开体 = `mt-1`(4) 上间距 + `pl-2.5`(10) 左缩进。
          .margin({ top: SP_1 })
          .padding({ left: 10, right: 0, top: 0, bottom: 0 })
          // 左栅栏是**结构性边界**（承载"这是思考展开体"的信息）⇒ 走 `hairline`
          // （浅色/极简白下比 `border` 明显更清楚；深色族 `hairline ≡ border` 逐字节零变化）。
          .border({ width: { left: STROKE_RAIL }, color: surfacesOf(paletteOf(this.theme)).hairline })
          .copyOption(CopyOptions.LocalDevice)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
