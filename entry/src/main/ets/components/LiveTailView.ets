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
import { Palette, paletteOf, Effects, effectsOf, shadowRadiusOf } from '../core/theme';
import { BUBBLE } from '../core/bubble';
import { R_MD, R_XL, R_LG, SP_1, SP_2, SP_5, FS_CAPTION } from '../core/tokens';
import {
  ELEV_OVERLAY, GAP_PILL, INSET_PILL_Y, POPOVER_W_OVERFLOW, PRESS_OPACITY, RADIUS_CARD, RADIUS_PILL,
  SPACE_HAIR, SPACE_XXS, STROKE_RAIL, elevationColorOf, surfaceFillOf, SURFACE_CHIP, HIT_TARGET_MIN,
} from '../core/design';
import { animBase } from './anim';
import { MarkdownView } from './MarkdownView';
import { ThinkingLine } from './ThinkingLine';
import { AssistantOrb, ORB_MODE_THINKING, ORB_MODE_TOOL, ORB_MODE_SECONDARY } from './AssistantOrb';
import { ToolPill, statusColorOf } from './ToolVisual';
import { SyntheticCard } from './SyntheticCard';
import { GenuiPanelCard } from './GenuiPanelCard';
import { genuiCardSubtitle, genuiCardTitle, genuiCode, genuiRenderable } from '../core/genui';
import { LlmErrorNotice } from './LlmErrorNotice';
import { isSyntheticToolName } from '../core/synthhints';
import { looksLikeLlmError } from '../core/llmerror';
import { reasoningKey } from '../core/reasoningopen';
import { uiIsScrolling, appIsPaused, tailIsPaused } from '../core/listfollow';
import { isLiveStatus, isToolInProgress, renderKind, statusChip } from '../core/toolstatus';
import { AnsiSpan, ansiPaletteOf, ansiSpansIfAny } from '../core/ansi';
import { ToolDetailVM, toolDetailVM, ToolOverflowList, ToolPopoverCard } from './ToolPopover';
import { t as i18nT } from '../core/i18n';

/** 单工具浮层宽度（对齐 web 浮层 430px；手机端收窄）。 */
const LT_POP_W: number = 320;
/** "+N" 溢出浮层宽度（web 无对应；手机端窄板）。 */
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
/**
 * 单次打字机**追赶上限**（码点）。
 *
 * 休眠/后台期间 SSE 会一次回放大量文本；若从旧 `vis` 逐字追（50ms/字）会边追边渲染
 * 越来越长的 Markdown ⇒ 用户看到「恢复后打字机卡顿、和刚启动完全不一样」。
 * 超过上限直接快进到末尾附近，只让最后一段走打字机。
 */
const LT_MAX_CATCHUP: number = 240;
/**
 * 打字机**长度上限**：live 正文/思考超过该码点数后直接全量显示。
 * 原因：每 50ms 推进一个字并重新解析整段 Markdown，文本越长单帧越贵；一个长回合/休眠
 * 回放后会出现「打字机卡顿、和刚启动完全不一样」，而重启 App 走 committed 历史所以正常。
 */
const LT_TYPEWRITER_MAX_RUNES: number = 2000;

@Component
export struct LiveTailView {
  /**
   * 在飞正文/思考/工具（**@Prop 直投**）。
   *
   * ⛔ 2026-10-21 回滚说明：曾改成 `@ObjectLink LiveTailState` + `onDidBuild` 同步，
   *   实测出现「光球动画与『思考 N 字』一起静止数秒、N 卡在 3/39」的 P0（用户亲报，
   *   打字时不定时复现）⇒ 回到**此前长期验证过的**值投递通道（页面按投递节流写 @State，
   *   本组件 `@Prop @Watch('onSource')`）。⛔ 不要再为了"省一次页面 rebuild"改回持有者：
   *   正确性/流畅性优先于那一次 rebuild。
   */
  @Prop @Watch('onSource') text: string = '';
  @Prop @Watch('onSource') reasoning: string = '';
  @Prop tools: ToolProgress[] = [];
  /** 应用是否在后台（官方性能规范 §3：后台必须挂起非必要定时器/动画） */
  @Prop @Watch('onSource') paused: boolean = false;
  /**
   * 回前台代数（AppStorage）—— 休眠期间系统会冻结 setInterval；已有 LazyForEach 行又拿不到
   * 新的 `paused` @Prop。页面每次 pause/resume 递增，本组件收到后重建/停止 timer，
   * 否则会出现"休眠后打字机卡顿、重启 App 才恢复"（用户 2026-10-20 亲报）。
   */
  @StorageLink('xbotTailEpoch') @Watch('onTailEpoch') tailEpoch: number = 0;
  /** 显式主题覆盖（测试/独立预览）；生产走 `appTheme` 全局订阅（页面不传）。 */
  @Prop theme: string = 'dark';
  /**
   * 全局主题**订阅**（生产唯一真源）—— 与 MessageRowView/UserBubbleView/MarkdownView 同根因：
   * live 行虽在 `LazyForEach` 之外（本组件通常随页面 build 重建），但为与其它主题消费者**同一机制**
   * 并覆盖"live 行进 LazyForEach"的边界，这里也自行订阅 AppStorage。
   */
  @StorageProp('appTheme') appTheme: string = '';
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
   * 打开 **GenUI（`display_html`）面板**（页面负责建分享 + 落 `WebSurface` URL）。
   * 在飞面板 ⇒ 先落一个卡片（可见性），点开由 web 自己的 shareRenderer 渲染
   * （依据见 `core/genui.ets` 头注释）。
   */
  onOpenGenui: (code: string, title: string) => void = (code: string, title: string) => {
  };
  /**
   * GenUI 面板「分享」chip（web `genui/index.tsx:122-181` ShareablePanel 对等物）——
   * 与 `onOpenGenui` 同一透传链：上层（页面）建分享并带回 URL；空串 = 失败（卡片落 error 可重试）。
   */
  onShareGenui: (code: string, title: string) => Promise<string> = (code: string, title: string): Promise<string> => {
    return Promise.resolve('');
  };
  /** 复制反馈落地（页面品牌 toast；**透传**给内部 `MarkdownView` —— B6 落点统一）。 */
  onToast: (msg: string) => void = () => {
  };
  /**
   * 「转后台」动作（页面注入：RPC `promote_shell` + toast）—— 透传给工具浮层卡片
   * （`ToolPopoverCard.onPromote`）。用户插话「跟 web 一样支持 promote shell to background」。
   */
  onPromoteShell: (callId: string) => Promise<string> = async (callId: string) => {
    return '';
  };
  /**
   * 是否渲染旗舰「思考中 / 生成中」光球（`components/AssistantOrb`）。
   *
   * 默认 `true` ⇒ 与接线前行为一致（只是把在飞指示升级为光球）。
   * 这是**设置开关的接线缝**：`core/settings.ets` 的 `orbEnabled(settings)` → 由
   * `MessageRowView` 投递（`pages/**` 与 `MessageRow.ets` 本波禁改 ⇒ 端到端投递见移交项）。
   */
  @Prop orb: boolean = true;
  /**
   * live 当前**在飞迭代**的归属（`turnID` + 迭代号）—— 与 committed 侧（`MessageRow.row.turnID`
   * + `it.iteration`）**同构**，供 `reasoningKey()` 构造同一个共享键（live↔committed 展开态互通）。
   */
  @Prop turnID: number = 0;
  @Prop iteration: number = 0;

  @State vis: number = 0;
  @State visReason: number = 0;
  /** 当前**浮层**对应的 live pill 下标（-1 = 无）—— 对齐 web：点 pill 弹浮层，不内联展开。 */
  @State popIdx: number = -1;
  /** "+N" 溢出浮层开关。 */
  @State overOpen: boolean = false;
  // 2026-10-17：打字机光标已整体移除（用户要求：不单独闪；逐字显示即效果）
  // ⇒ `caretAlpha` 状态与每拍计算一并删除（否则是"算了但没人消费"的死代码，
  //   仍会让判据误以为存在第二个呼吸源）。
  private runes: string[] = [];
  private reasonRunes: string[] = [];
  private timer: number = -1;
  private skip: boolean = false;
  private advanceTick: number = 0;
  /** 最近一次 tick 的时间；用于识别"定时器被系统冻结后，新迭代来了却仍沿用旧 timer"。 */
  private lastTickAtMs: number = 0;
  private lastTextLen: number = -1;
  private lastReasonLen: number = -1;

  /** 生效主题：生产走订阅，缺失时回落显式覆盖（单一口径，不产生两个真源）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  /** 视觉效果 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }

  /** 工具是否处于"在飞"（运行/生成中）—— 决定发光。判定收敛在 `core/toolstatus`。 */
  private live(t: ToolProgress): boolean {
return isLiveStatus(this.kind(t));
  }

  /**
   * 光球运行态（`AssistantOrb.orbMode`）。
   *
   * 在飞视觉语言的**优先级表**（见 `docs/DESIGN-SYSTEM.md §8`）：
   *   ① 任一工具在飞 ⇒ `tool`（光球=主高亮：轨道偏移+状态色）
   *   ② 只有思考在流（无工具、无正文）⇒ `secondary`（**让位**：`思考 N 字` 才是主高亮）
   *   ③ 其余在飞（正在写正文 / 刚起头）⇒ `thinking`
   * ⚠️ 只给"稳定信号"（工具在飞 ∥ 内容存在）。**不**把打字机每拍状态接进来 —— 那会让光球
   *   以 ≤20Hz 频率重建 Canvas 组件（新建 `RenderingContextSettings` + `setInterval`）。
   * ⚠️ `idle` **不在这里判**：它需要"多久没动静"（时间），父组件没有也不该有那个定时器
   *   ⇒ 交给光球按 `orbBeat` 自判（见其 `effectiveMode`，静默窗与 `思考 N 字` 同源）。
   */
  private orbMode(): string {
    if (this.hasLiveTool()) {
      return ORB_MODE_TOOL;
    }
    return this.thinkingIsPrimary() ? ORB_MODE_SECONDARY : ORB_MODE_THINKING;
  }

  /** 是否有工具在飞（稳定信号：整段工具执行期不变）。 */
  private hasLiveTool(): boolean {
    for (let i = 0; i < this.tools.length; i++) {
      if (this.live(this.tools[i])) {
        return true;
      }
    }
    return false;
  }

  /**
   * 「有工具在飞」—— **含 `pending`**（web `isToolInProgress`，`statusVisual.ts:20-22`）。
   *
   * ⛔ **只服务思考领读**（`thinkingIsPrimary` 的 `!hasToolInProgress`）：web 认为"哪怕工具还在
   *    排队，机器也已在干活" ⇒ 不该把眼睛引到「思考 N 字」。**不改 `live()`**（那是个 pill 的
   *    扫光/光球判据，`pending` 必须安静 —— 见 `core/toolstatus.ets:statusColorRole` 的 ⛔）。
   *    2026-10-11 修（WEB-PARITY §12-C）：此前用 `hasLiveTool()`（= `isLiveStatus`，不含 pending）
   *    ⇒ pending 窗口的领读身份与 web **相反**。
   */
  private hasToolInProgress(): boolean {
    for (let i = 0; i < this.tools.length; i++) {
      if (isToolInProgress(this.kind(this.tools[i]))) {
        return true;
      }
    }
    return false;
  }

  /**
   * 此刻**主高亮源**是不是 `思考 N 字` 行。
   *
   * 判据对齐 web 的 `reasoningInProgress`（`LiveIteration.tsx:186`）：
   * `streaming && phase === 'thinking' && !hasStreamContent && !hasToolInProgress`
   * ⇒ 原生等价物 = **有思考、无正文、无在飞工具**。
   * 只有这种"机器只在想、还没开始写"的窗口，眼睛才该落在思考行的字数上；其余时刻光球领读。
   */
  private thinkingIsPrimary(): boolean {
    return !this.hasToolInProgress() && this.reasoning.length > 0 && this.text.length === 0;
  }

  /**
   * 降级（reduce motion）—— **整组在飞动效的唯一开关**。
   *
   * 同一个值同时决定：光球是否停表（`AssistantOrb.reduceMotion`）、打字机光标是否呼吸
   * （固定 1 = 常亮）。**一个来源，两处生效**，不允许某个元素单独"还在动"。
   * （本波起 `思考 N 字` 已无动效 ⇒ 无需在此关断；它只是静态颜色，见 `ThinkingLine` 文件头。）
   * ⚠️ 本工程 `compatibleSdkVersion 21`：系统查询 `accessibility.isAnimationReduceEnabledSync()`
   *   是 **@since 23**（`sdk …/api/@ohos.accessibility.d.ts:658`）⇒ **当前拿不到系统值**，
   *   这里作为接线点暂时恒 false；将来 SDK 抬到 23 时只改这一个方法体。
   */
  private reduceMotion(): boolean {
    return false;
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
return renderKind(t.status, t.exit_code, true);
  }

  /** 状态 chip 文案（空 = 无 chip；running 带时长 —— **与 pill/committed 块同一组入参**）。 */
  private chip(t: ToolProgress): string {
    return statusChip(this.kind(t), t.exit_code, t.gen_chars, t.elapsed_ms);
  }

  /** pill 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  private labelText(t: ToolProgress): string {
    return t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  }

  /**
   * live pill 标签的 **ANSI span**（与 committed 侧 `MessageRow.toolLabelSpans()` **同款**：同一
   * `core/ansi` 入口 + 同一取色函数 ⇒ live/committed 视觉一致）。
   * ⛔ 无转义 ⇒ 空数组 ⇒ `ToolPill` 走**原纯文本路径**（逐字节不变）。
   */
  private toolLabelSpans(t: ToolProgress): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(this.labelText(t), ansiPaletteOf(this.pal()));
    return s !== null ? s : [];
  }

  aboutToAppear(): void {
    this.onSource();
    // ── 挂载即**显示当前全文**，只把**此后新增**的部分交给打字机（§21.122bx）───────────
    // ⛔ 为什么：用户定向「live iter 看不见就不渲染它……**快进入视野的时候再挂载回来**」+
    //    「重点是流畅 + **用户无感**」。`vis`/`visReason` 初值为 0 ⇒ 旧写法在**每次重新挂载**
    //    （列表虚拟化把尾部行回收后滚回来、或视图被覆盖后重挂）都会**从零重打**：用户看到整段
    //    文本"重播"（可感），而且那一刻要一次性追几百字（突发 CPU ⇒ 卡）。
    // ✅ 与「安全回退：定时器未跑 ⇒ 显示全文」同一原则（⛔ 绝不隐藏内容）：挂载时可见量 = 当前
    //    全文，后续增长照常逐字追赶 ⇒ 重挂载对用户**零感知**、且**零突发**。
    this.vis = this.runes.length;
    this.visReason = this.reasonRunes.length;
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  /**
   * 每帧（本组件 rebuild 后）同步源文本 —— 等价于旧实现的 `@Prop @Watch('onSource')`。
   *
   * ⛔ 为什么用 `onDidBuild`：`@ObjectLink` 的 `@Watch` 只在**引用**变化时触发，
   *   而持有者是「同一个对象、属性在变」⇒ 必须在这里按**内容长度**判定（`onSource` 自身
   *   有不变化的早退 ⇒ 恒等帧零成本）。
   */


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
    // 休眠回放/长回合：文本超过打字机上限 ⇒ 直接全量显示，避免每 50ms 重解析整段 Markdown。
    if (this.runes.length > LT_TYPEWRITER_MAX_RUNES || this.reasonRunes.length > LT_TYPEWRITER_MAX_RUNES) {
      this.vis = this.runes.length;
      this.visReason = this.reasonRunes.length;
      this.stopTimer();
      return;
    }
    // 新回合文本可能变短；避免 vis 越界。
    if (this.vis > this.runes.length) {
      this.vis = this.runes.length;
    }
    if (this.visReason > this.reasonRunes.length) {
      this.visReason = this.reasonRunes.length;
    }
    // 休眠回放的**大跳变**：不要从旧 vis 逐字追（50ms/字 + 每拍重渲染长 Markdown ⇒ 卡顿）。
    // 快进到末尾附近；正常流式增长通常只有几个码点，不受影响。
    if (this.runes.length - this.vis > LT_MAX_CATCHUP) {
      this.vis = this.runes.length - LT_MAX_CATCHUP;
    }
    if (this.reasonRunes.length - this.visReason > LT_MAX_CATCHUP) {
      this.visReason = this.reasonRunes.length - LT_MAX_CATCHUP;
    }
    // 新迭代/恢复后：timer 句柄可能仍是系统冻结前的旧值；它不会再 tick，但 syncTimer
    // 看到 handle>=0 会误判“已在跑”而不重建 ⇒ 更新频率永久变低。用最后 tick 时间
    // 判定失活，强制换新 timer（新迭代来了必须重置这个条件）。
    if (this.timer >= 0 && this.lastTickAtMs > 0 && Date.now() - this.lastTickAtMs > 500) {
      this.stopTimer();
    }
    this.syncTimer();
  }

  /** 后台/回前台切换：系统可能冻结过 setInterval ⇒ 必须 stop/start 一个新 timer。 */
  private onTailEpoch(): void {
    // ⛔ 不能只 syncTimer：旧 timer 句柄仍 >=0（系统冻结了回调）⇒ syncTimer 会认为
    //    “已在跑”而直接 return，于是恢复后仍是那个被节流的定时器（用户实测打字机卡顿）。
    this.stopTimer();
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
    const over: boolean = this.runes.length > LT_TYPEWRITER_MAX_RUNES
      || this.reasonRunes.length > LT_TYPEWRITER_MAX_RUNES;
    const on: boolean = !tailIsPaused() && !over && (this.typingText() || this.typingReason());
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
    // ⛔ `LazyForEach` 的 item builder 只在新建时执行 ⇒ 页面传进来的 `paused` 对**已有条目**
    //   不会随 `userScrolling` 更新（2026-10-17 高度抖动根因）。因此额外读模块级滚动标志：
    //   滚动期间**不推进** vis/visReason（行高不变），滚动结束自动继续（不 stopTimer，
    //   否则没有事件再拉起它）。
    if (tailIsPaused()) {
      return;
    }
    this.lastTickAtMs = Date.now();
    const skip: boolean = this.skip;
    this.skip = !this.skip;
    // 2026-10-17：光标已移除 ⇒ 这里不再有第二个呼吸权重（整组唯一动效是光球）。
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
      const renderEvery: number = 1; // 固定 20Hz；旧实现按总字数放大间隔 ⇒ 长文本"打字机变卡顿"
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

  /**
   * 工具状态色 —— **唯一配色表**在 `components/ToolVisual.ets:statusColorOf`（语义角色 → 主题色）。
   *
   * ⛔ 本组件**不再**自带第二套"状态→颜色"判据（批次22 审计：全项目曾有 **4 份**实现，
   *   其中 `killed` 在 live 浮层被画成**绿色**）。状态→文案同理 —— 一律走 `core/toolstatus`
   *   的 `statusChip`（见 `chip()`）；本文件原先的 `badge()`/`label()` 已删。
   */
  private color(t: ToolProgress): string {
    return statusColorOf(this.kind(t), this.themeId());
  }

  // ── 工具 pill 折叠 / 浮层（对齐 web `MergedPills` + `LazyPillPopover`）──────────

  /** 假工具（注入型通知）—— 摘出 pill 行，改渲染为卡片（判据在 `core/synthhints`）。 */
  private synthList(): ToolProgress[] {
    const out: ToolProgress[] = [];
    for (let i = 0; i < this.tools.length; i++) {
      if (isSyntheticToolName(this.tools[i].name)) { out.push(this.tools[i]); }
    }
    return out;
  }

  /** 真工具（非假工具）—— pill 折叠只作用于它们。 */
  private realList(): ToolProgress[] {
    const out: ToolProgress[] = [];
    for (let i = 0; i < this.tools.length; i++) {
      if (!isSyntheticToolName(this.tools[i].name)) { out.push(this.tools[i]); }
    }
    return out;
  }

  /** 直出的 pill（≤8 全量；>8 前 7 枚）。 */
  private shownList(): ToolProgress[] {
    return foldPills(this.realList()).shown;
  }

  /** `+N` 的 N（收起枚数）。 */
  private hideN(): number {
    return foldPills(this.realList()).hideCount;
  }

  /** 当前浮层对应的工具（按下标从 shown 里取 —— 与 pill 的下标一致）。 */
  private popTool(): ToolProgress | undefined {
    const shown: ToolProgress[] = this.shownList();
    return this.popIdx >= 0 && this.popIdx < shown.length ? shown[this.popIdx] : undefined;
  }

  private popVM(): ToolDetailVM {
    const t: ToolProgress | undefined = this.popTool();
    const c: string = t !== undefined ? this.color(t) : this.pal().textMuted;
    const b: string = t !== undefined ? this.chip(t) : '';
    return toolDetailVM(t, c, b);
  }

  /** 单工具浮层内容（对齐 web `ToolPopoverDetail`）。 */
  @Builder
  ToolPopBody() {
    ToolPopoverCard({
      vm: this.popVM(),
      theme: this.themeId(),
      // 转后台（仅进行中的 Shell 显示；判据在卡片内 = `core/toolshell.canPromoteShell`）
      onPromote: (callId: string) => {
        return this.onPromoteShell(callId);
      },
    })
  }

  /** "+N" 徽标：被收起的工具枚数（点击弹溢出全量列表）。 */
  @Builder
  OverflowBadge() {
    Text(`+${this.hideN()}`)
      .constraintSize({ minHeight: HIT_TARGET_MIN })
      .fontSize(FS_CAPTION)
      // 可点（点开溢出全量浮层）⇒ 弱档 `textMuted` 在 porcelain 对 chip 仅 2.27:1 < 3 ⇒ 用达标档 `textSecondary`
      .fontColor(this.pal().textSecondary)
      .padding({ left: SP_2, right: SP_2, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
      .margin(GAP_PILL)
      // 展开态底 = `surface.raised`（RUNG_RAISED）—— ⛔ 原为 `pal().surfaceHi`（RUNG_ACTIVE）：
      // porcelain 下 `textSecondary` 压它仅 **4.337 < AA 4.5**（文字 role，FS_CAPTION=12）。
      // `surface.raised` porcelain = **4.696 ✓**（light/dark/aurora/nebula 均达标）。
      // 语义 = 比常态 `surface.chip`(sunken) **抬升一档**；⛔ 不再用 `surfaceHi`（porcelain 不达标）。
      // ⚡ 2026-10-20 丝滑动画：展开/收起时背景色缓动
      .animation(animBase())
      .backgroundColor(this.overOpen ? surfaceFillOf(this.pal(), 'surface.raised') : surfaceFillOf(this.pal(), SURFACE_CHIP))
      .borderRadius(RADIUS_PILL)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.overOpen = !this.overOpen;
      })
      .bindPopup(this.overOpen, {
        builder: this.OverflowPopBody,
        placement: Placement.Bottom,
        enableArrow: false,
        mask: false,
        // 浮层三件套走设计系统口径（C4 续）：面 = `surface.overlay`；圆角 = 语义档；柔影 = token。
        popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
        radius: RADIUS_CARD,
        shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
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
      tools: foldPills(this.realList()).hidden,
      theme: this.themeId(),
      live: true,
    })
  }

  build() {
    // `gap-1`（web `LiveIteration` 的 `flex flex-col gap-1`）—— 思考/正文/工具之间 4px
    Column({ space: BUBBLE.blockInnerGap }) {
      // ── 旗舰「思考中 / 生成中」指示器（光球）────────────────────────────────────
      // 在飞视觉语言的**唯一主角**（见 `docs/DESIGN-SYSTEM.md §8`）：同屏**只有它一个动效**。
      //
      // ⛔ 光球挂载的判据 = 「本组件被挂载」本身（**不是**打字机每拍状态）：
      //   · `MessageRowView` 只在 live 行末尾在飞块**确有内容**时才建 `LiveTailView`
      //     （`MessageRow.ets:301-303 hasLiveContent` → `:387-389`）；
      //   · 回合离开 live 路径时页面清空 `liveText/liveReasoning/liveTools`
      //     （`pages/Index.ets:3420-3446 syncLiveTail`）⇒ 本组件被删除 ⇒ 光球随之消失。
      //   ⇒ 挂载 ⟺ 尾部确有在飞信号（与 `core/streammerge.ets:360 rowHasInFlightSignal`
      //     同源）⇒ **已提交/历史迭代不走这条路径，永远不会出现光球**。
      //
      // ⛔ 位置（2026-10-11 真机修正）：光球**不再**独占块首一行 —— 那是"消息中间飘着一个
      //    spinner"的根源（用户截图 ②）。改为：
      //     ① 有思考行 ⇒ 光球作该行的**前导图元**（并进 `ThinkingLine` 同一行，取代灯泡）
      //        —— web 的在飞指示本就是思考行自身（其 label 微光），从不是"行上方另挂一个"；
      //     ② 无思考行（正在写正文 / 工具在飞 / 刚起头）⇒ 光球才独占块首一行（回退位）。
      //   ⇒ 两种情形光球都在块首/行首，视觉锚点一致，不"跳"。
      //
      // 性能取舍（为什么**不**做"每帧 @State 推进"，也不把可见性绑到 `typingText()`）：
      //   · 绑打字机状态 ⇒ 该状态流式期以 ≤20Hz 翻转（每拍追平/落后），每次翻转都会
      //     **卸载再重建** Canvas 组件（`new RenderingContextSettings` + `setInterval`）
      //     ⇒ 抖 + 浪费，正是要避免的那种卡顿；
      //   · 绑挂载生命周期 ⇒ 一个在飞块内 Canvas 与定时器**只创建一次**；30fps 的
      //     `clearRect + 重绘` 全发生在 `AssistantOrb` 自己的画布里（其 `draw()`），
      //     **不产生任何 ArkUI 树重建**；父组件 20Hz 的重建只用**同值**重新求值这里的
      //     `if` 与 `@Prop` ⇒ 复用既有节点，画布不受打扰（思考行内的光球同理：`@Prop label`
      //     每拍变化驱动 ThinkingLine 重建，但光球的 `@Prop` 同值 ⇒ 复用节点）。
      //   · 后台（`paused`）⇒ 光球按契约**立即停表**并画一帧静息态（官规 §3）。
      if (this.reasoning.length > 0) {
        // ⛔ 必须是**组件**（`@Prop` 值变化通道）——带参 `@Builder` 的参数是"调用那一刻的快照"，
        //    其子树**不随参数重建**（docs/ARKTS-GOTCHAS §4）⇒ 症状正是用户 2026-10-10 报的：
        //    字数卡住不变、打字机不推进、**点它无法展开**。
        ThinkingLine({
          label: i18nT('思考 {{count}} 字').replace('{{count}}', String(this.reasonCount())),
          body: this.shownReason(),
          stateKey: reasoningKey(this.turnID, this.iteration),
          theme: this.themeId(),
          // 领读身份（只改色、不呼吸）—— 见 `thinkingIsPrimary()`
          live: this.thinkingIsPrimary(),
          // 旗舰光球作本行**前导图元**：同屏唯一动效（`orb` = 设置开关，缺省开）
          orb: this.orb,
          orbMode: this.orbMode(),
          orbBeat: this.orbBeat(),
          paused: this.paused,
          reduceMotion: this.reduceMotion(),
          onToggle: () => {
            // 展开态已由 ThinkingLine 自身写共享 store（`core/reasoningopen`）——
            // 这里只做 live 侧附带动作（打字机计时刷新）。
            this.syncTimer();
          },
        })
      } else if (this.orb) {
        // 无思考行时（正在写正文 / 工具在飞 / 刚起头）：光球仍作在飞指示，独占块首一行。
        // 与思考行内的光球**同值同种子**（尺寸/相位一致）⇒ 思考到来时"就地长出文字"，不跳位置/尺寸。
        Row() {
          AssistantOrb({
            theme: this.themeId(),
            orbSize: LT_ORB_SIZE,
            active: true,
            paused: this.paused,
            seed: LT_ORB_SEED,
            // 运行态（优先级表见 `orbMode()`：tool > secondary(让位) > thinking）
            orbMode: this.orbMode(),
            // 活动心跳（正文+思考的码点长度和）—— 光球据此在静默 >640ms 后转入 idle
            orbBeat: this.orbBeat(),
            // 降级：整组唯一开关（同一值也决定光球是否停表、光标是否呼吸）
            reduceMotion: this.reduceMotion(),
          })
        }
        .padding({ left: SP_1 })
      }
      if (this.text.length > 0) {
        Column({ space: SPACE_HAIR }) {
          if (looksLikeLlmError(this.shownText())) {
            // 在飞正文已是 LLM 失败文本 ⇒ 摘要行 + 可展开详情（判据与渲染同源，同 MessageRow）。
            LlmErrorNotice({ text: this.shownText(), theme: this.themeId() })
          } else {
            MarkdownView({
              text: this.shownText(),
              onImage: this.onImage,
              loadImage: this.loadImage,
              // B6：复制反馈落点**透传**页面品牌 toast（同 `MessageRow` 的两处 MarkdownView）。
              onToast: this.onToast,
              fontScale: this.fontScale,
              wrapCode: this.wrapCode,
              theme: this.themeId(),
              mdTheme: this.mdTheme,
            })
          }
          // 打字机光标已移除（用户要求：光标单独占一行闪烁→去掉光标，打字机逐字显示即效果）
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      if (this.tools.length > 0) {
        Column({ space: SPACE_XXS }) {
          // ── 假工具（注入型通知）⇒ 卡片（在飞时尤其可能是 `user_interrupt`）─────────
          ForEach(this.synthList(), (t: ToolProgress) => {
            SyntheticCard({ tool: t, theme: this.themeId() })
          }, (t: ToolProgress) => `lt-syn#${t.name}#${t.call_id !== undefined ? t.call_id : ''}`)
          // ── 真工具：每工具一枚 pill；>8 枚时前 7 枚 + "+N"（对齐 web `MergedPills`）──
          if (this.shownList().length > 0 || this.hideN() > 0) {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.shownList(), (t: ToolProgress, i: number) => {
                // ── GenUI（`display_html`）⇒ **面板卡**（不是 pill）────────────────
                //    面板是 LLM 生成的 TSX，原生不执行它（ArkTS 禁动态求值）；卡片给出
                //    "面板存在"的可见性 + 一个入口 ⇒ 点开由 web **自己的** shareRenderer
                //    在 ArkWeb 里渲染（依据见 `core/genui.ets` 头注释）。判据只此一处。
                if (genuiRenderable(t)) {
                  GenuiPanelCard({
                    title: genuiCardTitle(t),
                    subtitle: genuiCardSubtitle(t),
                    code: genuiCode(t),
                    live: this.live(t),
                    theme: this.themeId(),
                    onOpen: (code: string, title: string) => {
                      this.onOpenGenui(code, title);
                    },
                    onShare: (code: string, title: string): Promise<string> => {
                      return this.onShareGenui(code, title);
                    },
                  })
                  .margin(GAP_PILL)
                } else {
                Stack() {
                  // 与 committed 块**共用同一套 pill 视觉**（状态标记 + 名称 + 状态 chip）。
                  // ⛔ 组件（@Prop 值变化通道）—— 带参 @Builder 会冻在第一帧（状态永不更新）。
                  ToolPill({
                    label: this.labelText(t),
                    // live pill 也逐 span 上色（与 committed 侧同款 ⇒ live/committed 视觉一致）
                    labelSpans: this.toolLabelSpans(t),
                    kind: this.kind(t),
                    chip: this.chip(t),
                    live: this.live(t),
                    selected: this.popIdx === i,
                    theme: this.themeId(),
                  })
                }
                // 硬约束宽度：生成中的 label 是**流式参数**（可能几百字符），
                // 不给上限就会撑得比屏幕还长（真机铁证）
                .constraintSize({ maxWidth: 240 })
                .margin(GAP_PILL)
                .clip(true)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  // 点 pill **弹浮层**（对齐 web），再点同枚 = 关闭。
                  this.popIdx = this.popIdx === i ? -1 : i;
                })
                .bindPopup(this.popIdx === i, {
                  builder: this.ToolPopBody,
                  placement: Placement.Bottom,
                  enableArrow: false,
                  mask: false,
                  // 浮层三件套走设计系统口径（C4 续）：面 = `surface.overlay`；圆角 = 语义档；柔影 = token。
                  popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
                  radius: RADIUS_CARD,
                  shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
                  width: POPOVER_W_OVERFLOW,
                  onWillDismiss: (action: DismissPopupAction) => {
                    this.popIdx = -1;
                  },
                })
                .gesture(LongPressGesture().onAction(() => {
                  this.onToolLongPress(t.name);
                }))
                }
              }, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.call_id !== undefined ? t.call_id : ''}`
                // ⛔ key 必须含**会变的可见内容**（`status` + `gen_chars`）：`ForEach` 对同 key
                //    条目不重跑 item builder，`ToolPill` 的 `@Prop` 永远停在创建那一刻 ⇒ chip
                //    文字冻结（2026-10-16 用户亲报「生成中 x 字不更新」）。
                + `#${t.status !== undefined ? t.status : ''}#${t.gen_chars !== undefined ? t.gen_chars : 0}`)
              if (this.hideN() > 0) {
                this.OverflowBadge()
              }
            }
            .width('100%')
          }
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
