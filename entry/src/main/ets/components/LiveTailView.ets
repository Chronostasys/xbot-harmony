/**
 * live 进行中块（web 的 `LiveIteration` 同构）。
 *
 * ⚠️ 为什么单独成组件（真机教训）：打字机是 20Hz 的高频状态。若放在页面级 @State，
 * 每一拍都会让**整页**重跑 build（列表/合成器/系统 spinner 全被牵连）⇒ 用户看到
 * "spinner 半秒才动一次、卡得要死"。把它收进这个小组件后，高频刷新只重建这一棵子树。
 *
 * 打字机语义（用户明确要求）：
 *   · **正文任何时候都逐字**；追赶算法与 web 相同（50ms 一拍、gap/3、CJK 半速）；
 *   · **思考折叠时只让数字跳动**（不逐字）；**展开时逐字**；
 *   · 正文是 Markdown，逐字裁剪要按拍重解析整段文本（贵）⇒ 推进每拍做，
 *     **上屏节奏按文本长度自适应**（≤300 码点每拍；更长每 N 拍，N=ceil(len/300)）。
 */
import { ToolProgress } from '../core/types';
import { advanceVisible, clipRunes, isCJK, isTyping, runeCount, toRunes } from '../core/typewriter';
import { foldPills } from '../core/streammerge';
import { Palette, paletteOf, Effects, effectsOf } from '../core/theme';
import { BUBBLE } from '../core/bubble';
import { R_MD, R_XL, R_LG, SP_1, SP_2, SP_5, FS_CAPTION } from '../core/tokens';
import { MarkdownView } from './MarkdownView';
import { ThinkingLine } from './ThinkingLine';
import { AssistantOrb, ORB_MODE_THINKING, ORB_MODE_TOOL } from './AssistantOrb';
import { ToolPill } from './ToolVisual';
import { isLiveStatus, statusChip, toolStatusKind } from '../core/toolstatus';
import { ToolDetailVM, toolDetailVM, ToolOverflowList, ToolPopoverCard } from './ToolPopover';

/** 单工具浮层宽度（对齐 web 浮层 430px；手机端收窄）。 */
const LT_POP_W: number = 320;
/** "+N" 溢出浮层宽度。 */
const LT_OVER_W: number = 300;
/**
 * 旗舰在飞指示器（光球）的直径 —— 取**尺度 token** `SP_5`（20vp）。
 *
 * 为什么是 token 而不是裸数字：`AssistantOrb` 内部的全部几何都按 `size` 等比缩放
 * （`unit = s / ORB_DEFAULT_SIZE`，见 `AssistantOrb.draw()`），其默认 22vp 只是调校基准；
 * 20vp 与 22vp 相差 9%，不产生失真，却让尺寸落回设计系统的尺度表（见 `core/tokens.ets`）。
 */
const LT_ORB_SIZE: number = SP_5;
/** 光球相位种子：与同屏其它实例错开（本波同屏至多一枚，为多实例预留）。 */
const LT_ORB_SEED: number = 7;

@Component
export struct LiveTailView {
  /** 已收到的正文（流式累积；未裁剪） */
  @Prop @Watch('onSource') text: string = '';
  /** 已收到的思考 */
  @Prop @Watch('onSource') reasoning: string = '';
  @Prop tools: ToolProgress[] = [];
  /** 应用是否在后台（官方性能规范 §3：后台必须挂起非必要定时器/动画） */
  @Prop @Watch('onSource') paused: boolean = false;
  @Prop theme: string = 'dark';
  /** Markdown 主题 id（透传给 MarkdownView，只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';
  @Prop fontScale: number = 1;
  @Prop wrapCode: boolean = true;
  onImage: (src: string) => void = (src: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  onToolLongPress: (name: string) => void = (name: string) => {
  };
  /**
   * 是否渲染旗舰「思考中 / 生成中」光球（`components/AssistantOrb`）。
   *
   * 默认 `true` ⇒ 与接线前行为一致（只是把在飞指示升级为光球）。
   * 这是**设置开关的接线缝**：`core/settings.ets` 的 `orbEnabled(settings)` → 由
   * `MessageRowView` 投递（`pages/**` 与 `MessageRow.ets` 本波禁改 ⇒ 端到端投递见移交项）。
   */
  @Prop orb: boolean = true;

  @State vis: number = 0;
  @State visReason: number = 0;
  @State reasonOpen: boolean = false;
  /** 当前**浮层**对应的 live pill 下标（-1 = 无）—— 对齐 web：点 pill 弹浮层，不内联展开。 */
  @State popIdx: number = -1;
  /** "+N" 溢出浮层开关。 */
  @State overOpen: boolean = false;
  @State caretOn: boolean = true;
  private runes: string[] = [];
  private reasonRunes: string[] = [];
  private timer: number = -1;
  private skip: boolean = false;
  private advanceTick: number = 0;
  private lastTextLen: number = -1;
  private lastReasonLen: number = -1;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 视觉效果 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }

  /** 工具是否处于"在飞"（运行/生成中）—— 决定发光。判定收敛在 `core/toolstatus`。 */
  private live(t: ToolProgress): boolean {
    return isLiveStatus(toolStatusKind(t.status, t.exit_code));
  }

  /**
   * 光球运行态（`AssistantOrb.orbMode`）：**任一工具在飞 ⇒ `tool`，否则 `thinking`**。
   *
   * ⚠️ 只给"稳定信号"：这两个值在整段流式里都不会抖。**不**把打字机的每拍状态
   *   （`typingText()/typingReason()`，流式期 ≤20Hz 翻转）接进来 —— 那会让光球以同样频率
   *   重建 Canvas 组件（新建 `RenderingContextSettings` + `setInterval`），正是要避免的抖动。
   * ⚠️ `idle` **不在这里判**：它需要"多久没动静"（时间），父组件没有也不该有那个定时器
   *   ⇒ 交给光球按 `orbBeat` 自判（见其 `effectiveMode`）。
   */
  private orbMode(): string {
    for (let i = 0; i < this.tools.length; i++) {
      if (this.live(this.tools[i])) {
        return ORB_MODE_TOOL;
      }
    }
    return ORB_MODE_THINKING;
  }

  /**
   * 光球活动心跳（`AssistantOrb.orbBeat`）：正文+思考的**码点长度和**。
   *
   * 只在"内容真的前进"时变化 ⇒ 光球据此把静默计时重置；工具期内容不前进也无妨
   * （那时 `orbMode === 'tool'`，光球不判静默）。复用已算好的码点表（`runes/reasonRunes`），
   * 本方法只是两次 `.length`，零额外开销。
   */
  private orbBeat(): number {
    return this.runes.length + this.reasonRunes.length;
  }

  /**
   * 语义状态档 —— **一律以后端 `status` 为准**。
   *
   * ⛔ 不做任何"私有改判"（曾试过把 `pending` 当执行中，已回退）：工具有些并行、有些串行
   *   （服务端整批先建为 `pending`，各 goroutine 启动时逐条翻 `running`），`pending` 就是
   *   真的排队 —— 私自改判会让"排队"这一档消失，反而失真（用户 2026-10-10 明确要求
   *   「以后端数据为准」）。
   */
  private kind(t: ToolProgress): string {
    return toolStatusKind(t.status, t.exit_code);
  }

  /** 状态 chip 文案（空 = 无 chip）。 */
  private chip(t: ToolProgress): string {
    return statusChip(this.kind(t), t.exit_code, t.gen_chars);
  }

  /** pill 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  private labelText(t: ToolProgress): string {
    return t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  }

  aboutToAppear(): void {
    this.onSource();
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  /** 源文本变化：重算码点表 + 按需启动追赶。 */
  onSource(): void {
    if (this.text.length !== this.lastTextLen) {
      this.lastTextLen = this.text.length;
      this.runes = toRunes(this.text);
    }
    if (this.reasoning.length !== this.lastReasonLen) {
      this.lastReasonLen = this.reasoning.length;
      this.reasonRunes = toRunes(this.reasoning);
    }
    this.syncTimer();
  }

  private typingText(): boolean {
    return isTyping(this.vis, this.runes.length);
  }

  /**
   * 思考打字机是否在追赶 —— **不看展开态**。
   *
   * web `LiveIteration` 的 `reasoningStreaming = isLive`（与展开无关），字数由
   * `rw.visibleChars` 平滑增长：**思考折叠时只有数字在跳动**（展开才逐字）。
   * 此前这里要求 `reasonOpen` ⇒ 折叠时定时器不启动 ⇒ **数字不跳、只在结束时突变**
   * （用户 2026-10-10 实测：「新迭代反复显示思考 N 字符、不会变化，直到思考彻底完成后
   * 跳变为真实值」）。
   */
  private typingReason(): boolean {
    return isTyping(this.visReason, this.reasonRunes.length);
  }

  /** 思考字数（对齐 web `reasoningCount`：追赶中显示**可见**字数，否则全长）。 */
  private reasonCount(): number {
    return this.typingReason() ? this.visReason : this.reasonRunes.length;
  }

  private syncTimer(): void {
    // 后台挂起：不推进、不重渲染（回前台时 @Watch 重新拉起）
    // ⛔ 打字机**绝不能**被"工具是否非终态"门控（原 `liveNow()`）：纯文本/思考回复
    //   （没有工具，最常见）会让 on=false ⇒ 定时器永不启动 ⇒ shownText() 走"安全回退"
    //   直接显示全文 ⇒ **没有打字机特效**（真机症状，2026-10-10）。只有"追赶未完成"决定开关。
    const on: boolean = !this.paused && (this.typingText() || this.typingReason());
    if (on && this.timer < 0) {
      this.timer = setInterval(() => {
        this.tick();
      }, 50);
      return;
    }
    if (!on && this.timer >= 0) {
      this.stopTimer();
    }
  }

  private stopTimer(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private tick(): void {
    if (this.paused) {
      this.stopTimer();
      return;
    }
    const skip: boolean = this.skip;
    this.skip = !this.skip;
    this.caretOn = !this.caretOn;
    // 思考：展开时逐字（纯 Text，便宜）
    if (this.typingReason()) {
      const rc: number = this.reasonRunes.length > 0
        ? this.reasonRunes[Math.min(this.visReason, this.reasonRunes.length - 1)].codePointAt(0) as number : 0;
      this.visReason = advanceVisible(this.visReason, this.reasonRunes.length, skip && isCJK(rc));
    }
    // 正文：推进每拍（web 同款 gap/3）；上屏节奏按长度自适应（解析贵）
    if (this.typingText()) {
      const tc: number = this.runes.length > 0
        ? this.runes[Math.min(this.vis, this.runes.length - 1)].codePointAt(0) as number : 0;
      const next: number = advanceVisible(this.vis, this.runes.length, skip && isCJK(tc));
      this.advanceTick = this.advanceTick + 1;
      const renderEvery: number = Math.max(1, Math.ceil(this.runes.length / 300));
      if (this.advanceTick >= renderEvery || next >= this.runes.length) {
        this.advanceTick = 0;
        this.vis = next;
      }
    }
    if (!this.typingText() && !this.typingReason()) {
      // 追平后：把最后一段补全上屏，并停表（无内容可打时不留定时器）
      if (this.vis < this.runes.length) {
        this.vis = this.runes.length;
      }
      if (this.visReason < this.reasonRunes.length) {
        this.visReason = this.reasonRunes.length;
      }
      this.stopTimer();
    }
  }

  /** 可见正文（安全回退：定时器未跑 ⇒ 全文，绝不让内容不可见）。 */
  private shownText(): string {
    if (this.timer < 0 || this.vis >= this.runes.length) {
      return this.text;
    }
    return clipRunes(this.text, this.vis);
  }

  private shownReason(): string {
    if (this.timer < 0 || this.visReason >= this.reasonRunes.length) {
      return this.reasoning;
    }
    return clipRunes(this.reasoning, this.visReason);
  }

  /** 工具状态角标（generating 带字数 / running 带时长 / error 带 exit）。 */
  private badge(t: ToolProgress): string {
    if (t.status === 'generating') {
      const n: number = t.gen_chars !== undefined ? t.gen_chars : 0;
      return n > 0 ? `生成中 ${n} 字` : '生成中…';
    }
    if (t.status === 'running') {
      const ms: number = t.elapsed_ms !== undefined ? t.elapsed_ms : 0;
      return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '运行中';
    }
    if (t.status === 'error') {
      return t.exit_code !== undefined && t.exit_code !== 0 ? `失败 exit ${t.exit_code}` : '失败';
    }
    if (t.status === 'pending') {
      return '排队';
    }
    return '';
  }

  private color(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    if (t.status === 'pending') {
      return this.pal().textMuted;
    }
    // 成功：语义色浅形态（降低饱和）
    return this.pal().successText;
  }

  private label(t: ToolProgress): string {
    const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
    const b: string = this.badge(t);
    return b.length > 0 ? `${base} ${b}` : base;
  }

  // ── 工具 pill 折叠 / 浮层（对齐 web `MergedPills` + `LazyPillPopover`）──────────

  /** 直出的 pill（≤8 全量；>8 前 7 枚）。 */
  private shownList(): ToolProgress[] {
    return foldPills(this.tools).shown;
  }

  /** `+N` 的 N（收起枚数）。 */
  private hideN(): number {
    return foldPills(this.tools).hideCount;
  }

  /** 当前浮层对应的工具（按下标从 shown 里取 —— 与 pill 的下标一致）。 */
  private popTool(): ToolProgress | undefined {
    const shown: ToolProgress[] = this.shownList();
    return this.popIdx >= 0 && this.popIdx < shown.length ? shown[this.popIdx] : undefined;
  }

  private popVM(): ToolDetailVM {
    const t: ToolProgress | undefined = this.popTool();
    const c: string = t !== undefined ? this.color(t) : this.pal().textMuted;
    const b: string = t !== undefined ? this.badge(t) : '';
    return toolDetailVM(t, c, b);
  }

  /** 单工具浮层内容（对齐 web `ToolPopoverDetail`）。 */
  @Builder
  ToolPopBody() {
    ToolPopoverCard({
      vm: this.popVM(),
      theme: this.theme,
    })
  }

  /** "+N" 徽标：被收起的工具枚数（点击弹溢出全量列表）。 */
  @Builder
  OverflowBadge() {
    Text(`+${this.hideN()}`)
      .fontSize(FS_CAPTION)
      .fontColor(this.pal().textMuted)
      .padding({ left: SP_2, right: SP_2, top: 5, bottom: 5 })
      .margin(3)
      .backgroundColor(this.overOpen ? this.eff().glassBorder : this.eff().glassBg)
      .borderRadius(R_LG)
      .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.overOpen = !this.overOpen;
      })
      .bindPopup(this.overOpen, {
        builder: this.OverflowPopBody,
        placement: Placement.Bottom,
        enableArrow: false,
        mask: false,
        popupColor: this.pal().surface,
        radius: R_XL,
        width: LT_OVER_W,
        onWillDismiss: (action: DismissPopupAction) => {
          this.overOpen = false;
        },
      })
  }

  /** "+N" 溢出浮层内容：被收起的工具全量列表。 */
  @Builder
  OverflowPopBody() {
    ToolOverflowList({
      tools: foldPills(this.tools).hidden,
      theme: this.theme,
    })
  }

  build() {
    // `gap-1`（web `LiveIteration` 的 `flex flex-col gap-1`）—— 思考/正文/工具之间 4px
    Column({ space: BUBBLE.blockInnerGap }) {
      // ── 旗舰「思考中 / 生成中」指示器（在飞块的最前面）──────────────────────────
      // 位置对齐 web：`LiveIteration` 把在飞指示（`ShimmerThinking`）作为块的**首个**
      // 元素渲染（`web/src/components/agent/LiveIteration.tsx:217-219`）。
      //
      // ⛔ 必须走**真 `@Component` + `@Prop`**（`AssistantOrb`）：带参全局 `@Builder`
      //    的参数是"调用那一刻的快照"、其子树不随参数重建（docs/ARKTS-GOTCHAS §4 ——
      //    本项目已两次栽在这：字数卡住、点不开）。
      //
      // 可见性判据 = 「本组件被挂载」本身（**不是**打字机每拍状态）：
      //   · `MessageRowView` 只在 live 行末尾在飞块**确有内容**时才建 `LiveTailView`
      //     （`MessageRow.ets:301-303 hasLiveContent` → `:387-389`）；
      //   · 回合离开 live 路径时页面清空 `liveText/liveReasoning/liveTools`
      //     （`pages/Index.ets:3420-3446 syncLiveTail`）⇒ 本组件被删除 ⇒ 光球随之消失。
      //   ⇒ 挂载 ⟺ 尾部确有在飞信号（与 `core/streammerge.ets:360 rowHasInFlightSignal`
      //     同源）⇒ **已提交/历史迭代不走这条路径，永远不会出现光球**。
      //
      // 性能取舍（为什么**不**做"每帧 @State 推进"，也不把可见性绑到 `typingText()`）：
      //   · 绑打字机状态 ⇒ 该状态流式期以 ≤20Hz 翻转（每拍追平/落后），每次翻转都会
      //     **卸载再重建** Canvas 组件（`new RenderingContextSettings` + `setInterval`）
      //     ⇒ 抖 + 浪费，正是要避免的那种卡顿；
      //   · 绑挂载生命周期 ⇒ 一个在飞块内 Canvas 与定时器**只创建一次**；30fps 的
      //     `clearRect + 重绘` 全发生在 `AssistantOrb` 自己的画布里（其 `draw()`），
      //     **不产生任何 ArkUI 树重建**；父组件 20Hz 的重建只用**同值**重新求值这里的
      //     `if` 与 `@Prop` ⇒ 复用既有节点，画布不受打扰。
      //   · 后台（`paused`）⇒ 光球按契约**立即停表**并画一帧静息态（官规 §3）。
      if (this.orb) {
        Row() {
          AssistantOrb({
            theme: this.theme,
            orbSize: LT_ORB_SIZE,
            active: true,
            paused: this.paused,
            seed: LT_ORB_SEED,
            // 运行态（稳定信号：工具在飞 ⇒ tool，否则 thinking；idle 由光球按心跳自判）
            orbMode: this.orbMode(),
            // 活动心跳（正文+思考的码点长度和）—— 光球据此在静默 >640ms 后转入 idle
            orbBeat: this.orbBeat(),
            // 降级（reduce motion）接线点：本工程 API 21 无系统查询 API（`isAnimationReduceEnabledSync`
            // 是 @since 23，见 AssistantOrb 的 @Prop 注释）⇒ 暂无可信来源，显式传 false 占位。
            reduceMotion: false,
          })
        }
        .padding({ left: SP_1 })
      }
      if (this.reasoning.length > 0) {
        // ⛔ 必须是**组件**（`@Prop` 值变化通道）——带参 `@Builder` 的参数是"调用那一刻的快照"，
        //    其子树**不随参数重建**（docs/ARKTS-GOTCHAS §4）⇒ 症状正是用户 2026-10-10 报的：
        //    字数卡住不变、打字机不推进、**点它无法展开**。
        ThinkingLine({
          label: `思考 ${this.reasonCount()} 字`,
          body: this.shownReason(),
          open: this.reasonOpen,
          theme: this.theme,
          onToggle: () => {
            this.reasonOpen = !this.reasonOpen;
            this.syncTimer();
          },
        })
      }
      if (this.text.length > 0) {
        Column({ space: 2 }) {
          MarkdownView({
            text: this.shownText(),
            onImage: this.onImage,
            loadImage: this.loadImage,
            fontScale: this.fontScale,
            wrapCode: this.wrapCode,
            theme: this.theme,
            mdTheme: this.mdTheme,
          })
          if (this.typingText() || this.typingReason()) {
            // 打字机光标：accent 色 + glow 发光的细竖条（替代纯文本 `▍`）
            Row()
              .width(2).height(14)
              .backgroundColor(this.pal().accent)
              .borderRadius(1)
              .shadow({ radius: 6, color: this.eff().glow, offsetX: 0, offsetY: 0 })
              .opacity(this.caretOn ? 1 : 0.2)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      if (this.tools.length > 0) {
        Column({ space: 4 }) {
          // 同一迭代内：**每工具一枚 pill**；>8 枚时前 7 枚 + "+N"（对齐 web `MergedPills`）。
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.shownList(), (t: ToolProgress, i: number) => {
              Stack() {
                // 与 committed 块**共用同一套 pill 视觉**（状态标记 + 名称 + 状态 chip）。
                // ⛔ 组件（@Prop 值变化通道）—— 带参 @Builder 会冻在第一帧（状态永不更新）。
                ToolPill({
                  label: this.labelText(t),
                  kind: this.kind(t),
                  chip: this.chip(t),
                  live: this.live(t),
                  selected: this.popIdx === i,
                  theme: this.theme,
                })
              }
              // 硬约束宽度：生成中的 label 是**流式参数**（可能几百字符），
              // 不给上限就会撑得比屏幕还长（真机铁证）
              .constraintSize({ maxWidth: 240 })
              .margin(3)
              .clip(true)
              .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
              .onClick(() => {
                // 点 pill **弹浮层**（对齐 web），再点同枚 = 关闭。
                this.popIdx = this.popIdx === i ? -1 : i;
              })
              .bindPopup(this.popIdx === i, {
                builder: this.ToolPopBody,
                placement: Placement.Bottom,
                enableArrow: false,
                mask: false,
                popupColor: this.pal().surface,
                radius: R_XL,
                width: LT_POP_W,
                onWillDismiss: (action: DismissPopupAction) => {
                  this.popIdx = -1;
                },
              })
              .gesture(LongPressGesture().onAction(() => {
                this.onToolLongPress(t.name);
              }))
            }, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.status}`)
            if (this.hideN() > 0) {
              this.OverflowBadge()
            }
          }
          .width('100%')
        }
        .width('100%')
      }
    }
    // ⚠️ **无自己的气泡 chrome**（无背景/边框/圆角/外边距）：它是「同气泡内最后一个
    //    迭代块」的内容渲染器 —— 气泡由外层 MessageRowView.AssistantBlock 提供。
    //    （真机 bug ②「live 迭代是单独的气泡」的根治点：此前它自带 chrome 且是独立
    //    ListItem，于是画成第二个气泡。）
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
