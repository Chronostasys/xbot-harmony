/**
 * 一行消息（`LazyForEach` 的**条目组件** —— `@Reusable` 唯一真正生效的层级）。
 *
 * 依据 harmony-next skill《应用体验与性能规范》：
 *   §2 「长列表务必 LazyForEach…结合 @Reusable 装饰器实现组件级复用，降低创建和销毁的开销」；
 *   §1 「主线程解放」：组件内**不做 IO**（拉更早区域 / 拉工具详情 / 取图字节全部经回调交回页面）。
 *
 * 实现要点：
 *   · `@ObjectLink row` + types 里 `@Observed class ChatRow`（@Prop 对**对象**是深拷贝 ⇒ 不用它）；
 *   · 与页面解耦：只接原始类型 + 回调，避免组件持有 store/页面引用；
 *   · 三个 @Builder（Assistant/Iteration/ToolPill）与 7 个 helper 由页面**整块搬入**（原样语义）。
 */
import { ChatRow, HistoryIteration, ToolProgress } from '../core/types';
import { WebCompaction, WebSubAgentProgress } from '../core/chattypes';
import {
  completedBlocks, displayContent, displayReasoning, foldPills, mergeToolRuns, rowIsEmpty,
} from '../core/streammerge';
import { runeCount } from '../core/typewriter';
import { Palette, paletteOf, Effects, effectsOf, shadowRadiusOf } from '../core/theme';
import { BUBBLE, withAlpha } from '../core/bubble';
import { R_MD, R_XL, R_LG, SP_1, SP_2, SP_3, FS_CAPTION, FS_META } from '../core/tokens';
// 语义令牌（`7841978` §4.6/§4.7/§6）：浮层宽 / 分隔条高 / 全圆角 / pill 间距与最大宽 / 按压。
import {
  ELEV_OVERLAY, GAP_PILL, INSET_PILL_Y, OVERLAY_ROW_H, PILL_MAX_W, POPOVER_W, POPOVER_W_OVERFLOW,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_FULL, SPACE_HAIR, colorOf, elevationColorOf, surfaceFillOf, HIT_TARGET_MIN,
} from '../core/design';
import {
  anchorsAt, COMPACTED_LABEL, compactionAnchors, splitMarker,
} from '../core/compaction';
import { MarkdownView } from './MarkdownView';
import { GenuiPanelCard } from './GenuiPanelCard';
import { genuiCardSubtitle, genuiCardTitle, genuiCode, genuiRenderable } from '../core/genui';
import { LiveTailView } from './LiveTailView';
import { ThinkingLine } from './ThinkingLine';
import { ToolPill, statusColorOf } from './ToolVisual';
import { SyntheticCard } from './SyntheticCard';
import { LlmErrorNotice } from './LlmErrorNotice';
import { isSyntheticToolName } from '../core/synthhints';
import { looksLikeLlmError } from '../core/llmerror';
import { isInFlight, renderKind, statusChip } from '../core/toolstatus';
import { AnsiSpan, ansiPaletteOf, ansiSpansIfAny } from '../core/ansi';
import {
} from '../core/rowsview';
import { ToolDetailVM, toolDetailVM, ToolOverflowList, ToolPopoverCard } from './ToolPopover';
import { SubAgentTree } from './SubAgentTree';
import { flattenSubAgents } from '../core/subagent';
import { SweepBand, sweepBandOf } from '../core/sweep';
import { animFast, animMsgIn } from './anim';
import { entryAnimates, entryStartDy, entryRestOpacity } from '../core/msgentry';
import { reasoningKey, liveIterationNo } from '../core/reasoningopen';

/** 压缩摘要正文的最大高度（web `max-h-[40vh] overflow-y-auto`；手机取 ~48% 视口）。 */
const COMPACT_BODY_MAX_H: number = 420;
/** 压缩分隔行两侧发丝线的不透明度（web `bg-border/70`）。 */
const COMPACT_LINE_ALPHA: number = 0.7;
/** 共享空锚定表（无压缩行 ⇒ 零分配、零渲染；调用方只读）。 */
const NO_ANCHORS: Map<number, WebCompaction[]> = new Map();

// ── 「空 / 失败」态的**唯一文案与判定**（逐字对齐 web，禁自创）──────────────────
/**
 * 空回复（本回合结束、assistant 产出为空）——**逐字**取自 web `agent.emptyAssistant`
 * （`web/src/i18n/zh-CN.ts:223`，en 为 `'(no text output)'`）。
 * 触发点见 web `AssistantMessage.tsx:150-152`：`!isStreaming && !finalContent &&
 * !emptyResponseWarning && iterations.length === 0 && !showProgress(progress)`。
 */
export const EMPTY_NOTICE_TEXT: string = '（无文本输出）';
/**
 * 服务端**明确标记**的空响应（`'(empty response)'` 哨兵）——**逐字**取自 web
 * `agent.emptyResponseWarning`（`web/src/i18n/zh-CN.ts:224`）。
 * web 的判定 = `isEmptyResponseContent()`（`AssistantMessage.tsx:169-171`：
 * `content.trim() === '(empty response)'`）；原生端同一份判据（下面 `EMPTY_RESPONSE_SENTINEL`）。
 *
 * ⚠️ 形态**刻意偏离** web：web 用一个填充红盒（`border-status-error/40 +
 * bg-status-error/10`，`AssistantMessage.tsx:173-179`），原生端按用户口令
 * 「一行小字 + 中性色，不是大红报错」⇒ 只保留一行 + 升一档的颜色（无填充/无边框/无发光）。
 */
export const FAILED_NOTICE_TEXT: string = 'LLM 本次没有返回文本内容，可能是模型输出异常或中途结束。';
/** 服务端空响应哨兵（与 web `AssistantMessage.tsx:170` 同字面量）。 */
export const EMPTY_RESPONSE_SENTINEL: string = '(empty response)';
/** 空态档：无产出（中性色）。 */
export const NOTICE_KIND_EMPTY: string = 'empty';
/** 异常态档：服务端标记的空/异常响应（升一档颜色 + 一枚状态图标）。 */
export const NOTICE_KIND_FAILED: string = 'failed';

@Component
export struct MessageRowView {
  @ObjectLink row: ChatRow;
  /**
   * 显式主题覆盖（**测试 / 独立预览**用）。生产页面**不传**（留空）⇒ 走下面的 `appTheme` 订阅。
   */
  @Prop theme: string = 'dark';
  /**
   * 全局主题**订阅**（生产唯一真源）—— 修「浅色主题下历史正文白底白字」的根因。
   *
   * ⛔ 根因：历史行由 `LazyForEach` 承载，其 item builder **只在键（`id#rev`）变化时**才重新执行；
   *   主题变更**不改变任何行键** ⇒ `applyRows` 零通知 ⇒ 已存在行的 `@Prop theme` **冻结在创建那刻**
   *   （= `'dark'`）⇒ 取深色调色板 = 白字。live 行在 `LazyForEach` **之外**（页面 build 直驱，
   *   见 `pages/Index.ets` 的 `LiveRowBody`）⇒ 每次重建都拿当前主题 ⇒ 正常。这个"历史 vs live"的
   *   不对称正是用户看到的现象。
   * ⇒ 修法（**订阅式**）：行**自己订阅** AppStorage ⇒ 主题变更时**每个已存在组件实例各自重渲染**，
   *   与 `ForEach`/`LazyForEach` 的键语义**无关**（`@StorageProp` 是组件级订阅，不经列表重投递）。
   *   ⚠️ 装饰器参数字面量 `'appTheme'` 与页面 `pages/Index.ets` 的 `@StorageLink('appTheme')` 逐字一致。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** Markdown 主题 id（透传给 MarkdownView，只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';
  @Prop fontScaleV: number = 1;
  @Prop wrapCodeV: boolean = true;
  /** 运行中工具 pill 的流光位置（页面统一推进 ⇒ 每行不再各开定时器） */
  @Prop sweepX: number = 0;
  /** 应用是否在后台（打字机在后台挂起 —— 与 LiveTailView 同款） */
  @Prop paused: boolean = false;
  /**
   * 旗舰「思考中/生成中」光球开关（由 `core/settings.ets` 的 `orbEnabled` 派生）。
   * 由页面以 **@Prop 投递**，再透传给 `LiveTailView.orb`（设置面板的开关端到端接线）。
   */
  @Prop orb: boolean = true;
  /**
   * live 行「在飞内容」—— 由页面 `syncLiveTail()` 从 live 行末尾在飞块派生、
   * 以 **@Prop 投递**（普通行恒为空）。
   *
   * ⛔ 为什么必须是 @Prop 而不是"从行对象里读"（P55→P58 回归根因）：ArkUI V1 组件只在
   *   **收到的值发生变化**时重建；`ChatRow` 是就地更新的（引用恒定）⇒ 不构成值变化 ⇒
   *   组件永不重建 ⇒ 流式期间渲染输入冻结在创建那一瞬（真机「第一条 SSE 到达就消失、
   *   中间全空、commit 才一次性出现」）。这三项提供值变化（= 回归前 P54 的机制；web
   *   亦是把 live 快照当 prop 往下传）。
   */
  @Prop liveText: string = '';
  @Prop liveReasoning: string = '';
  @Prop liveTools: ToolProgress[] = [];
  /**
   * live 行**已完成迭代块列表** —— 由页面 `syncLiveTail()` 从 live 行
   * （`row.iterations` 去掉末尾在飞块；与渲染读**同一个** `completedBlocks`）
   * 以 **@Prop 投递**（普通行恒为空）。
   *
   * ⛔ 为什么必须也是 @Prop（真机 2026-10-10「iter1 的 tool call 完成后 iter1 消失、
   *   iter2 前面看不到 iter1」根因）：在飞块修好后（P58），**已完成块**仍走
   *   带参 @Builder `AssistantBlock(this.row)` 里的 `ForEach(this.itersFor(row))`
   *   —— 参数是同一个 `ChatRow` 引用（`core/render.ets:applyRow` 就地改它）。
   *   ArkUI V1 的「按值传参 @Builder」参数不变 ⇒ 其内 UI 不重建（docs/ARKTS-GOTCHAS
   *   §4）⇒ 已完成块区**冻结在创建那一瞬**（此刻为空）。于是：tool call 完成 →
   *   iter1 进 `iteration_history`（模型正确）、在飞块随 @Prop 清空 ⇒ 两个区都空 ⇒
   *   **iter1 从画面消失**；iter2 流式时已完成块区仍冻结为空 ⇒ **看不到 iter1**。
   *   ⇒ 已完成块也必须走「值变化」通道（对齐 web：`MessageList` 把整份 `liveProgress`
   *   快照当 prop 传给 `TurnBody`，而不是让 `TurnBody` 从可变对象里读）。
   */
  @Prop liveBlocks: HistoryIteration[] = [];
  /**
   * live 行的 **SubAgent 进度树**（web `LiveIteration.tsx:282`：`{hasSubAgents && <SubAgentProgressTree nodes={liveSubAgents} />}`）。
   *
   * ⛔ 与 `liveText`/`liveBlocks` **同款走值投递**：行对象是就地更新的（引用恒定）⇒
   *   在组件里读 `row.subAgents` 不产生「值变化」⇒ 树的增删/状态变化不会驱动重建
   *   （docs/ARKTS-GOTCHAS §4）。页面 `syncLiveTail()` 把它镜像进 `@State` 后投递。
   */
  @Prop liveSubAgents: WebSubAgentProgress[] = [];
  /**
   * 宿主是否提供「点开 SubAgent 会话」能力（决定展平行上 `openable`）。
   * 对齐 web `SubAgentProgressTree.tsx:65`：`onOpen={openTab ? openSubAgent : undefined}`
   * —— 无回调时卡片 `disabled`（点了无操作）。
   */
  @Prop subAgentOpenable: boolean = false;
  onImage: (src: string) => void = (src: string) => {
  };
  /** 点 SubAgent 行 → 宿主切到该 SubAgent 会话（web `openSubAgent`）。 */
  onOpenSubAgent: (sessionKey: string) => void = (sessionKey: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  onLoadMoreRegions: () => Promise<boolean> = async () => {
    return false;
  };
  onOpenCtx: (iter: number, toolName: string) => void = (iter: number, toolName: string) => {
  };
  /**
   * **工具组**长按（在 pill 行的**非 pill 区域**命中 ⇒ 弹"整个工具组"的菜单；单枚 pill 的
   * `LongPressGesture` 是**内层**、优先拦截 ⇒ 不会双触发）。判据/项集 = `core/ctxmenu.toolsMenuItems`。
   */
  onOpenToolsCtx: (iter: number) => void = (iter: number) => {
  };
  /**
   * 打开 **GenUI（`display_html`）面板**（页面负责建分享 + 落 `WebSurface` URL；组件不 IO）。
   * 面板源码原样上报 —— 判据/文案在 `core/genui.ets`（判据与渲染同源）。
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
  onToggleTool: (iter: number, toolName: string) => void = (iter: number, toolName: string) => {
  };
  onRowLongPress: () => void = () => {
  };
  /** 复制文本（页面对接系统剪贴板；组件不做 IO/系统调用） */
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };
  /** 复制反馈落地（页面品牌 toast；**透传**给两处 `MarkdownView` 与本组件的 `LiveTailView`）。 */
  onToast: (msg: string) => void = () => {
  };
  /**
   * 「转后台」动作（页面注入：RPC `promote_shell` + toast；入参 = `tool_call_id`，
   * 出参 = 新后台任务 id，失败抛错）。**透传**给两处 `ToolPopoverCard`（committed 侧本组件
   * 与 live 侧 `LiveTailView`）—— 用户插话「跟 web 一样支持 promote shell to background」。
   */
  onPromoteShell: (callId: string) => Promise<string> = async (callId: string) => {
    return '';
  };

  /** 「更早区域」自动加载的三态（对齐 web `RegionsDivider` 的 idle/loading/error）。
   *  ⛔ 触发源是**可见性**（`onVisibleAreaChange` 哨兵语义），**不是点击** ——
   *  用户 2026-10-10 明确禁止「点击加载更多」。 */
  @State regionStatus: string = 'idle';
  /** 当前**浮层**对应的工具的唯一键（空串 = 无浮层；非空 = 该 pill 的浮层打开）。
   *  ⛔ 对齐 web：点 pill **弹浮层**（`FoldedToolGroup.tsx:485-534`），**绝不内联展开**
   *  （内联会逐帧改行高 ⇒ 虚拟列表逐帧 relayout，见 `:4-8`）。
   *  ⛔ **不能用 `(迭代号, 工具名)` 当身份**：同一次迭代里同一工具可被调用多次
   *  （真机实测：一轮里两次 `FileReplace` ⇒ 两枚 pill 的判据同时成立 ⇒ 点一下弹**两个**浮层）。
   *  唯一键 = `pillKeyOf()`（含 `call_id`，缺失时用同迭代内下标兜底）。 */
  @State popKey: string = '';
  /** 当前 "+N" 溢出浮层对应的迭代（`>= 0` ⇒ 打开；对齐 web `OverflowPillsMenu`）。 */
  @State overIter: number = -1;

  /**
   * 生效主题：**生产走全局订阅**（`appTheme`），订阅缺失时（测试/独立预览）回落到显式 `@Prop theme`。
   * 单一真源：有 `appTheme` 时它是唯一来源，`@Prop theme` 不再参与（避免"两个真源"）。
   */
  private themeId(): string {
    // ⛔ 2026-10-17 白底白字终极修复：@StorageProp('appTheme') 在虚拟列表缓存 item 上
    //   **不触发重渲**（0152795+本轮插桩实证：frameKey 含 @theme、structural=true、reload
    //   全部执行但缓存 item 仍持旧色板）⇒ themeId() 读旧值 ⇒ 投给所有子组件
    //   （MarkdownView/ThinkingLine/ToolPill...）的 theme=旧 ⇒ 白字/黑字。
    //   唯一绕法：build 重跑时**直读 AppStorage.get()**（不建订阅）——配合 row.themeGen++
    //   （@Observed 赋值强制行重渲）⇒ 行重渲时此处必读到最新主题。
    const live: string = AppStorage.get<string>('appTheme') ?? '';
    return live.length > 0 ? live : (this.appTheme.length > 0 ? this.appTheme : this.theme);
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  /**
   * 行**出现过渡**（`TransitionEffect`）—— 入场动效的唯一实现（判据在 `core/msgentry.ets`）。
   *
   * ⛔ 静息态 = `entryRestOpacity()`（= 1，行内容自身的 `.opacity()`），过渡只描述"挂载那一下"
   *   从 `entryStartOpacity()`(=0) / `entryStartDy()`(=4vp) 到静息态的过程。
   *   过渡不跑 / 被打断 ⇒ 停在静息态（**可读**），不会像旧实现那样停在起始态（不可读）。
   *   这正是 web `@keyframes msgIn`（无 `forwards`）的语义。
   */
  private entryTransition(): TransitionEffect {
    if (!entryAnimates(this.row.isLive)) {
      // 历史行（随滚动创建）不播入场：恒等过渡 = 零副作用（旧实现的同款纪律：不逐行闪入）。
      return TransitionEffect.IDENTITY;
    }
    return TransitionEffect.OPACITY.animation(animMsgIn())
      .combine(TransitionEffect.translate({ y: entryStartDy() }).animation(animMsgIn()));
  }

  // ⛔ 入场动效**没有状态位**（见下方 `entryTransition()` 的长注释）：
  //   行内容的静息不透明度恒为 `entryRestOpacity()`（= 1），"挂载那一下"的 0→1 由**出现过渡**承载。

  /** 工具是否"在飞"（决定发光与扫光）——判据收敛在 `core/toolstatus.isInFlight`（committed ⇒ live=false）。 */
  private toolLive(t: ToolProgress): boolean {
    return isInFlight(this.toolKind(t), false);
  }

  /** 语义状态档 —— **唯一判据** `core/toolstatus.renderKind`（committed 块 ⇒ live=false）。 */
  private toolKind(t: ToolProgress): string {
    return renderKind(t.status, t.exit_code, false);
  }

  /** 状态 chip 文案（空 = 无 chip；running 带时长 —— 原生增强）。 */
  private toolChip(t: ToolProgress): string {
    return statusChip(this.toolKind(t), t.exit_code, t.gen_chars, t.elapsed_ms);
  }

  /** pill 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  private toolLabelText(t: ToolProgress): string {
    return t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  }

  /**
   * 工具 pill 标签的 **ANSI span**（终端输出携带 SGR 颜色码时逐 span 上色，不再泄漏 raw 转义）。
   *
   * ⛔ **判据与渲染同源**：`ansiSpansIfAny` = `hasAnsi` + `parseAnsi` 同一纯函数（`core/ansi` 是唯一入口，
   *   组件**不另写**任何 ANSI 判断）；**颜色零字面量** —— 取色由 `ToolPill` 走 `ansiFgOf`/`ansiBgOf`
   *   + 色板（`ansiPaletteOf(pal)`），此处只算 span。无转义 ⇒ 空数组 ⇒ pill 走原纯文本路径（零多余节点）。
   */
  private toolLabelSpans(t: ToolProgress): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(this.toolLabelText(t), ansiPaletteOf(this.pal()));
    return s !== null ? s : [];
  }

  /** 视觉 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }

  /** 扫光三色（判据与渲染同源：`core/sweep.ets:sweepBandOf`）—— 按 theme 记忆化。 */
  private bandTheme: string = '';
  private bandCache: SweepBand = new SweepBand();

  private sweepBand(): SweepBand {
    if (this.bandTheme !== this.themeId()) {
      this.bandTheme = this.themeId();
      this.bandCache = sweepBandOf(this.pal());
    }
    return this.bandCache;
  }

  // ⛔ 已删除 `isTailOwned`（bug1「一个 running turn 被渲染两遍」的根因）：
  //   旧模型把在飞内容塞进 live 行的**最后一个迭代**，再让列表跳过它、由尾块渲染 ⇒
  //   两处必须严格互斥，稍有不一致就重复/丢失。web 模型里 live 行的 `iterations`
  //   **只含已完成迭代**、在飞内容（content/reasoning/tools）是独立字段由尾块渲染 ——
  //   二者天然不重叠。原生端对齐后（见 core/render.ets / store.liveProgress / 页面
  //   syncLiveTail），列表**渲染全部迭代**、尾块渲染在飞快照，无需任何归属判据。

  /**
   * 行是否有任何可见内容（正文/思考/工具）。无 ⇒ 不渲染气泡（空气泡守卫）。
   *
   * ⛔ bug2 根因之一（真机截图：几百 px 空盒里只有一行「Shell 生成中 N 字」）：
   * 该 turn 的可见内容此刻**全部**在飞（正文/思考/工具都在末尾在飞块里），列表里
   * 若照常渲染气泡就是一个只有边框/阴影的空盒。web 模型下不存在这个盒子。
   * ⇒ 空行为不渲染任何东西，可见内容由末尾在飞块（同气泡）承担。
   *
   * ⚠️ 逐块判定（rowIsEmpty 已含末尾在飞块）—— 不再用旧的
   * `isLive && iterations.length===0` 判据（在飞块现在**在 iterations 里**）。
   */
  private isEmptyBubble(): boolean {
    return rowIsEmpty(this.row);
  }

  /**
   * 是否显示「空回复」提示行（本波修复的真机空白屏）。
   *
   * ⛔ 与"在飞指示"**互斥**（不变量：任何时刻恰好一个指示器）：
   *   · 在飞（`row.isLive`）的空行 ⇒ **不显示**（由列表尾「思考中…」占位承担，
   *     见 `core/indicators.ets:showsBusyPlaceholder`）—— 否则同屏两个指示器；
   *   · 回合**已结束**（`!row.isLive`）且整行无产出 ⇒ **必须显示**：否则用户看到
   *     「自己发的气泡 + 下面一片空白」，以为消息没发出去/卡死了
   *     （2026-10-11 真机实测：`role=assistant len=0`，processing=False）。
   *   · 判据全部是**稳定信号**（行上的 `isLive` 与整行可见内容），不涉及任何动画/心跳。
   */
  private showsEmptyNotice(): boolean {
    return !this.row.isLive && this.isEmptyBubble();
  }

  /** 正文是否为服务端标记的**空响应哨兵**（`'(empty response)'`，与 web 同判据）。 */
  private isEmptyResponse(): boolean {
    return this.row.content.trim() === EMPTY_RESPONSE_SENTINEL;
  }

  private toolKey(turnID: number, iter: number, name: string): string {
    return `${turnID}:${iter}:${name}`;
  }

  /**
   * 单枚工具 pill 的**唯一键**（弹层开关的身份判据）。
   *
   * ⛔ 历史 bug（真机实测）：身份曾用 `(迭代号, 工具名)`，而**同一次迭代里同一工具可被调用多次**
   *    （一轮里两次 `FileReplace`）⇒ 两枚 pill 的判据同时成立 ⇒ 点一下弹**两个**浮层。
   *    这里把 `call_id` 纳入键；服务端未给 `call_id` 时用**同迭代内下标**兜底（仍唯一）。
   */
  private pillKeyOf(it: HistoryIteration, t: ToolProgress, idx: number): string {
    const cid: string = t.call_id !== undefined && t.call_id.length > 0 ? t.call_id : `idx${idx}`;
    return `${this.toolKey(this.row.turnID, it.iteration, t.name)}#${cid}`;
  }

  /** 浮层状态点颜色 —— 判据**同源**：走唯一映射 `ToolVisual.statusColorOf`（判据是 `core/toolstatus`）。 */
  private toolColor(t: ToolProgress): string {
    return statusColorOf(this.toolKind(t), this.themeId());
  }

  /**
   * 该行此刻要渲染的**已完成迭代块**（不含末尾在飞块）。
   *
   * live 行 = 页面投递的 `@Prop liveBlocks`（**值** —— 见其声明处的根因说明）；
   * 普通行 = 行对象里已完成块（普通行经带 key 的 `LazyForEach`，key 含 `rev`，
   * 内容变即换 key 重建，读取安全）。
   */
  private blocksFor(): HistoryIteration[] {
    return this.row.isLive ? this.liveBlocks : completedBlocks(this.row);
  }

  /**
   * 已完成块 → **跨迭代合并**后的块列表（连续「纯工具」迭代合成一块 ⇒ 渲染成一行 pill）。
   * 逐字对齐 web `TurnBody.mergeToolRuns`（`TurnBody.tsx:942-967`），逻辑在 `core/streammerge.ets`。
   */
  private mergedBlocks(): HistoryIteration[] {
    return mergeToolRuns(this.blocksFor());
  }

  /**
   * 该行要渲染的**全部**已完成块。
   *
   * ⛔ 照抄 web `TurnBody`（用户 2026-10-17 亲证「web 是没有这个 bug 的，照抄都抄好了」）：
   *    web **渲染全部迭代**（`content-visibility` 只做绘制窗口化，DOM 全在）——**没有**
   *    「折叠+哨兵+自动放宽」这套原生自创。它的「末尾 N 块」语义在每次 commit 时会把
   *    **已渲染的块挤出窗口**（消失几秒、widen 又出现）= 用户亲报的闪烁之一，**整段删除**。
   *    历史过长的性能由 `LazyForEach` 行级虚拟化 + `mergeToolRuns` 合并承担。
   */
  private itersFor(): HistoryIteration[] {
    return this.mergedBlocks();
  }

  /**
   * 交给 `ForEach` 的块 = **全部**（无窗口裁剪；保留独立方法名以稳定调用点）。
   */
  private shownIters(): HistoryIteration[] {
    return this.itersFor();
  }

  /** 压缩锚点缓存（按 `row.rev` 失效）—— 见 `compactionMap()`。 */
  private anchorsRev: number = -1;
  private anchorsCache: Map<number, WebCompaction[]> = new Map();

  /**
   * 压缩点锚定表（`afterIteration` → 实际渲染块）。
   *
   * 对齐 web `TurnBody.compactionByIter`（`TurnBody.tsx:992-1013`）：anchor =
   * 「已渲染（merged）迭代号中 ≤ afterIteration 的最大者」；0 = 第一个迭代之前。
   * 工具 only 迭代被折号后 anchor 会落到"最近的更早块"之后 —— 压缩点因此**不丢失**。
   *
   * ⛔ PERF（docs/ARKTS-GOTCHAS §11）：渲染路径不能逐块重复做与规模成正比的计算。
   *   这里是 O(1) 早退（绝大多数行没有压缩点）+ 按 `row.rev` memo（内容一变 rev 即自增，
   *    见 `core/rowdiff.ets:sessionScopedRowKey` 的同一契约）。
   */
  private compactionMap(): Map<number, WebCompaction[]> {
    const comps: WebCompaction[] = this.row.compactions;
    if (comps.length === 0) {
      return NO_ANCHORS;
    }
    if (this.anchorsRev === this.row.rev) {
      return this.anchorsCache;
    }
    const blocks: HistoryIteration[] = this.itersFor();
    const nums: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      nums.push(blocks[i].iteration);
    }
    this.anchorsCache = compactionAnchors(nums, comps);
    this.anchorsRev = this.row.rev;
    return this.anchorsCache;
  }

  /** 某迭代块（或 0 = turn 顶部）**之后**要渲染的压缩点。无 ⇒ 共享空数组（零渲染）。 */
  private compactionsAt(anchor: number): WebCompaction[] {
    return anchorsAt(this.compactionMap(), anchor);
  }

  /**
   * 自动加载更早区域（可见性触发的唯一入口）。
   *
   * ⛔ **不是"点击加载"**：由分隔条的 `onVisibleAreaChange` 在它进入视口时调用 ——
   *    体感等价"向上滚动自然加载更多"。`regionStatus === 'loading'` 时直接返回，
   *    防止同一次露出重复发请求（web `useRegionWindow` 的 arm/disarm 同源目的）。
   */
  private autoLoadRegions(): void {
    if (this.row.regionsBefore <= 0 || this.regionStatus === 'loading') {
      return;
    }
    this.regionStatus = 'loading';
    this.onLoadMoreRegions().then((ok: boolean) => {
      this.regionStatus = ok ? 'idle' : 'error';
    }).catch(() => {
      this.regionStatus = 'error';
    });
  }

  /**
   * 假工具（注入型通知 —— `bg_task`/`subagent`/`interrupt` 等）从 pill 行**摘出**，
   * 改渲染为卡片（对齐 web `ToolRender.tsx:136`（interrupt）/`:154-155`（其余假工具））。
   * 判据 `isSyntheticToolName` 在 `core/synthhints.ets`（判据与渲染同源）。
   */
  private synthToolsOf(it: HistoryIteration): ToolProgress[] {
    const all: ToolProgress[] = it.tools !== undefined ? it.tools : [];
    const out: ToolProgress[] = [];
    for (let i = 0; i < all.length; i++) {
      if (isSyntheticToolName(all[i].name)) { out.push(all[i]); }
    }
    return out;
  }

  /** 真工具（非假工具）—— pill 折叠/`+N` 只作用于它们（假工具已走卡片）。 */
  private realToolsOf(it: HistoryIteration): ToolProgress[] {
    const all: ToolProgress[] = it.tools !== undefined ? it.tools : [];
    const out: ToolProgress[] = [];
    for (let i = 0; i < all.length; i++) {
      if (!isSyntheticToolName(all[i].name)) { out.push(all[i]); }
    }
    return out;
  }

  /**
   * 工具在 `it.tools` 里的**原始下标**（pill 唯一键的兜底：某工具 `call_id` 缺失时用下标）。
   * ⛔ 必须用原始下标（不是过滤后的下标）—— 否则 `popTool()`（按原始下标查）与渲染的
   *    pill 键不一致 ⇒ 点 pill 打不开浮层。`indexOf` 对对象引用成立（过滤保留引用）。
   */
  private origIndex(it: HistoryIteration, t: ToolProgress): number {
    return it.tools !== undefined ? it.tools.indexOf(t) : -1;
  }

  /** 同一迭代内**直出**的 pill（≤8 全量；>8 前 7 枚）—— 对齐 web `MergedPills`。 */
  private shownPills(it: HistoryIteration): ToolProgress[] {
    return foldPills(this.realToolsOf(it)).shown;
  }

  /** 同一迭代内被收进 `+N` 的 pill（>8 时 = 第 8 枚起）。 */
  private hiddenPills(it: HistoryIteration): ToolProgress[] {
    return foldPills(this.realToolsOf(it)).hidden;
  }

  /** `+N` 的 N（收起枚数）。 */
  private hideCount(it: HistoryIteration): number {
    return foldPills(this.realToolsOf(it)).hideCount;
  }

  /** 在飞内容是否非空（@Prop 直驱 —— 与页面 `syncLiveTail` 的派生同源）。 */
  private hasLiveContent(): boolean {
    return this.liveText.length > 0 || this.liveReasoning.length > 0 || this.liveTools.length > 0;
  }

  /**
   * 助手气泡主体。
   *
   * ⛔ **无参**（读 `this.row` / `this.liveBlocks`）：带参 @Builder 的按值参数是
   *   「调用那一刻的快照」，参数引用不变时其内 UI 不重建（docs/ARKTS-GOTCHAS §4）。
   *   live 行的 `ChatRow` 是**就地更新**的（引用恒定）⇒ 若仍带参 `AssistantBlock(this.row)`，
   *   已完成块区的 `ForEach` 会冻结在创建那一瞬（= 空）⇒ 真机「iter1 的 tool call 完成后
   *   iter1 消失、iter2 前面看不到 iter1」。无参 + 值投递（`liveBlocks`）后，值变即重建。
   */
  @Builder
  AssistantBlock() {
    // ⛔ `Column()`（无 space）—— web `.iter-blocks` 是 `display:block`，块间间距由**块自身**
    //   `.iter-block{margin-top:0.25rem}` 提供（见下方 IterationBlock/LiveIterationBlock 的
    //   `.margin({ top: BUBBLE.iterGap })`）。用 Column 的 space 会在首块前留白、与 web 不符。
    Column() {
      // ── 「更早区域」分隔条：**必须是本 turn 最顶部的内容** ────────────────────────
      //    web `AssistantMessage`：`{regionWindow.enabled && <RegionsDivider/>}`
      //    **在 `<TurnBody>` 之前**，是 assistant 容器的第一个子节点 —— 原生照此把它放到
      //    最前（此前它排在正文之后，用户 2026-10-10 指出「divider 上方不能有任何内容」）。
      //
      //    ⛔ **自动加载**（可见性即触发，等价 web 的 IO 哨兵）：**绝不做「点击加载」**
      //    （用户明确禁止）。体感要与「向上滚动自然加载更多」一致，而不是"我们藏了东西
      //    让你点" —— 故文案用「正在加载更多…」，不用「折叠/展开」这类词。
      if (this.row.regionsBefore > 0) {
        Row({ space: 6 }) {
          if (this.regionStatus === 'loading') {
            LoadingProgress().width(13).height(13).color(this.pal().textMuted)
            Text('正在加载更多…').fontSize(FS_META).fontColor(this.pal().textMuted)
          } else if (this.regionStatus === 'error') {
            // 失败**不自动重试**（对齐 web `useRegionWindow`：避免弱网下的自动请求循环），
            // 只在此处提供手动重试（web `RegionsDivider` 的 error 态同样是可点按钮）。
            SymbolGlyph($r('sys.symbol.arrow_counterclockwise')).fontSize(12).fontColor([this.pal().warn])
            Text('加载失败 · 重试').fontSize(FS_META).fontColor(this.pal().warn)
          } else {
            // 图标取色走 `iconMuted`（弱图标专用角色；porcelain 下 `textMuted` 压 chip 仅 2.27:1 < 3）
            SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(12).fontColor([colorOf(this.pal(), 'iconMuted')])
            Text(`更早的 ${this.row.regionsBefore} 个区域`).fontSize(FS_META).fontColor(this.pal().textMuted)
          }
        }
        .width('100%')
        .height(OVERLAY_ROW_H)     // **恒定行高**（web `h-7`）：三态不改变布局，避免滚动跳变
        .justifyContent(FlexAlign.Center)
        // 可见性哨兵：滚到顶部露出本条 ⇒ 自动取更早一段（web `useRegionWindow` 的 IO 哨兵）
        .onVisibleAreaChange([0.0, 1.0], (isVisible: boolean) => {
          if (isVisible) {
            this.autoLoadRegions();
          }
        })
        // ⛔ 可点性被 `regionStatus` 守卫（仅 error 态可重试）⇒ 必须 `.enabled(同一判据)`：
        //    否则 idle 态照有 press 假反馈却点了没动作 = **交互死区**（判据 ⑤ 同一纪律）。
        .enabled(this.regionStatus === 'error')
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          // 仅 error 态允许点（重试）；idle 态点击无操作（不做"点击加载"）
          if (this.regionStatus === 'error') {
            this.autoLoadRegions();
          }
        })
      }
      if (this.row.content.length > 0 && this.row.iterations.length === 0) {
        if (this.isEmptyResponse()) {
          // 服务端**明确标记**的空响应（哨兵 `'(empty response)'`）⇒ 显示可读文案，
          // ⛔ 绝不把哨兵字面量当正文上屏（web 同款：先判 `isEmptyResponseContent` 再渲染，
          //   `AssistantMessage.tsx:147-149` + `:169-171`）。
          EmptyNotice({ kind: NOTICE_KIND_FAILED, theme: this.themeId() })
        } else if (looksLikeLlmError(this.row.content)) {
          // LLM 调用失败 ⇒ **摘要行 + 可展开详情**（判据与渲染同源：`core/llmerror.ets`）。
          // 真机取证：此前把整段 `#1..#5` 原样铺满屏 ⇒ 现在首屏仅 1 行，点开才看原文。
          LlmErrorNotice({ text: this.row.content, theme: this.themeId() })
        } else {
          MarkdownView({
            text: this.row.content,
            onImage: (src: string) => {
              this.onImage(src);
            },
            loadImage: (src: string) => {
              return this.loadImage(src);
            },
            // B6：复制反馈落点**透传**页面品牌 toast（与 live 侧、LiveTailView 同一落点）。
            onToast: this.onToast,
            fontScale: this.fontScaleV,
            wrapCode: this.wrapCodeV,
            theme: this.themeId(),
            mdTheme: this.mdTheme,
          })
        }
      }
      // ── turn 顶部（第一个迭代之前）的压缩点：`afterIteration === 0` ───────────────
      //    web `TurnBody.tsx:922-928`：leading 分隔渲染在**全部迭代块之前**（与迭代同级）。
      if (this.compactionsAt(0).length > 0) {
        ForEach(this.compactionsAt(0), (c: WebCompaction, ci: number) => {
          CompactionDividerRow({ body: splitMarker(c.content).body, theme: this.themeId() })
        }, (c: WebCompaction, ci: number) => `${this.row.id}#cpt#head#${ci}`)
      }
      // 已完成迭代。live 行的列表来自**值** `liveBlocks`（@Prop）；普通行走带 key 的
      // LazyForEach（key 含 rev）。在飞块由下方 LiveIterationBlock 单独渲染。
      // ⛔ key 必须含 `live` 标记：在飞块可能与某个**已提交迭代同号**（服务端把
      //   在飞迭代记进 iteration_history 的场景 —— 见 core/render.ets.inFlightBlock），
      //   只按 `row.id#iteration` 会撞 key ⇒ ArkUI 复用错位（渲染错乱）。
      ForEach(this.shownIters(), (it: HistoryIteration) => {
        this.IterationBlock(it)
        // ── 该迭代**之后**的压缩点（迭代之间、与迭代同级内联）──────────────────────
        //    web `TurnBody.tsx:225-228`：`compactions` 就挂在 IterationBlock 内部末尾。
        //    无压缩 ⇒ 空数组 ⇒ **不产出任何节点**（不留空行/占位）。
        if (this.compactionsAt(it.iteration).length > 0) {
          ForEach(this.compactionsAt(it.iteration), (c: WebCompaction, ci: number) => {
            CompactionDividerRow({ body: splitMarker(c.content).body, theme: this.themeId() })
          }, (c: WebCompaction, ci: number) => `${this.row.id}#cpt#${it.iteration}#${ci}`)
        }
      }, (it: HistoryIteration) => `${this.row.id}#${it.iteration}#${it.live === true ? 'L' : ('C#' + (it.tools ? it.tools.length : 0))}`)
      // ── 在飞迭代块：**同一气泡内的最后一块**（对齐 web TurnBody 的 LiveIteration）──
      // 真机 bug ② 根治点：live 迭代不再是自己一个气泡/一个 ListItem，而是这条
      // assistant 消息气泡里的最后一块，与已完成迭代共用同一套块渲染（仅带打字机）。
      // ⛔ 内容来自 **@Prop**（页面 `syncLiveTail` 派生）—— 不是"从被就地修改的行对象里读"
      //   （那条路不产生 ArkUI 能看见的「值变化」⇒ 组件永不重建 ⇒ 流式期间全空）。
      if (this.hasLiveContent()) {
        this.LiveIterationBlock()
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    // 对齐 web `AssistantMessage`：容器 `group/msg px-1` —— **无** 底色/边框/圆角/阴影
    // （CopyTarget 不渲染可见 UI）。垂直间距来自 `.virt-row py-1.5`（= rowPadY）。
    .padding({ left: BUBBLE.assistantPadX, right: BUBBLE.assistantPadX })
    .margin({ top: BUBBLE.rowPadY, bottom: BUBBLE.rowPadY })
    // ── 入场动效（对齐 web `msgIn`：opacity 0→1 + translateY 4px→0，200ms spring）──────
    // 复刻 web `index.css:683-714`：`.animate-msg-in > *` 用 CSS `@keyframes`，元素**自身**
    // 的 `opacity` 仍是 1、关键帧**没有** `forwards` ⇒ 动画没跑/被打断，元素停在 1（可读）。
    // ArkUI 的等价物 = **出现过渡**（`.transition()`）：静息态是组件自己的属性，过渡只是
    //   "挂载那一下"的装饰。
    //
    // ⛔ 为什么**不能**用"状态位 + onAppear"（旧实现，用户实证 2026-10-11 的真根因）：
    //   旧写法 `.opacity(entered ? 1 : 0)`（`entered` 初始 false）+ `.onAppear` 里 `animateTo`
    //   把**可读性押在动画上** —— `onAppear` 未触发（挂载时机 / 条件渲染跳过）⇒ `entered`
    //   永不置 true；后台冻结 / 20Hz 流式重建打断动画 ⇒ 渲染值停在半路。两者都让正文永久
    //   压在低不透明度上（用户截图：正文最暗 `#D4D4D6` 压 `#F2F2F2` = **1.32:1**（≈正文 @13%），
    //   同屏其它文字 21:1 正常）。判据/常量在 `core/msgentry.ets`（有判别力单测 + mutation 自证）。
    //
    // ⛔ **web 铁律**：入场动效只作用**行内层**（`.animate-msg-in > *`），**绝不改行自身的定位
    //   transform** —— 虚拟列表用 `translateY(item.start)` 定位行，动效里的 transform 会覆盖它
    //   ⇒ 行被画到容器原点、压在上一条上（web 2026-09-16 快速滚动抖动重叠的真根因，
    //   守护见 `web/src/index.test.ts` 的 virt-row 用例）。原生端行定位由 `List`/`ListItem`
    //   （pages/Index.ets）负责、不用 transform，但纪律同源：动效只挂在**行内容**上
    //   （即 ListItem 的直接子节点 = 本组件的 `AssistantBlock` 根 Column），不碰外层定位节点。
    //
    // 只给 **live 行**播入场（对齐 web `row.id === liveId`）：历史行不播，避免滚动时逐行闪入。
    .opacity(entryRestOpacity())
    .transition(this.entryTransition())
    // 长按整条 → 复制（回复 / 含思考 / 含工具 / 原始 Markdown）
    .gesture(LongPressGesture().onAction(() => {
      this.onRowLongPress();
    }))
  }

  /**
   * 在飞迭代块 —— 同气泡内的最后一块。内容走 `LiveTailView`（打字机 + 工具 pill
   * + 思考头），但**不带自己的气泡 chrome**（背景/边框/圆角/外边距都在外层
   * AssistantBlock 上）⇒ 与已完成迭代在同一个气泡里。
   *
   * ⛔ **无参**：内容全部读 `@Prop liveText/liveReasoning/liveTools`（页面 `@State` 投递）。
   *   绝不再从 `row.iterations` 里找那一块 —— 行对象就地更新、引用恒定，读它不产生
   *   「值变化」⇒ 组件不重建（P55 回归：流式期间全空）。
   */
  @Builder
  LiveIterationBlock() {
    Column({ space: BUBBLE.blockInnerGap }) {
      LiveTailView({
        text: this.liveText,
        reasoning: this.liveReasoning,
        tools: this.liveTools,
        paused: this.paused,
        theme: this.themeId(),
        fontScale: this.fontScaleV,
        wrapCode: this.wrapCodeV,
        orb: this.orb,
        // live 在飞迭代的归属（与 committed 侧同构 ⇒ `reasoningKey(turnID, iteration)` 同键）。
        turnID: this.row.turnID,
        iteration: liveIterationNo(this.row.iterations),
        onImage: (src: string) => {
          this.onImage(src);
        },
        loadImage: (src: string) => {
          return this.loadImage(src);
        },
        onToolLongPress: (name: string) => {
          this.onOpenCtx(this.row.turnID, name);
        },
        // B6：live 在飞正文里的代码块复制 —— 落点**透传**页面品牌 toast。
        onToast: this.onToast,
        // 转后台：live 侧 pill 的浮层里出现「转后台」条（透传页面 RPC 回调）。
        onPromoteShell: this.onPromoteShell,
        // GenUI（`display_html`）面板：live 在飞时也落卡片 —— 透传页面（建分享 + 落 URL）。
        onOpenGenui: this.onOpenGenui,
        // 分享 chip（web ShareablePanel 对等物）：同链透传（页面建分享 + 返 URL）。
        onShareGenui: this.onShareGenui,
      })
      // ── live 快照的 SubAgent 进度树（web `LiveIteration.tsx:282`：
      //    `{hasSubAgents && <SubAgentProgressTree nodes={liveSubAgents} />}` ——
      //    渲染在流式正文**之后**）。内容走 `@Prop liveSubAgents`（值投递，见其声明处）。
      if (this.liveSubAgents.length > 0) {
        SubAgentTree({
          rows: flattenSubAgents(this.liveSubAgents, this.subAgentOpenable),
          theme: this.themeId(),
          onOpen: (k: string) => {
            this.onOpenSubAgent(k);
          },
        })
      }
    }
    // `.iter-block{margin-top:0.25rem}`（TurnBody）—— 与已完成迭代块之间 4px 间距
    // （映射表 = 唯一 web 对齐来源；iterGap === SP_1 === 4）
    .margin({ top: BUBBLE.iterGap })
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  IterationBlock(it: HistoryIteration) {
    Column({ space: BUBBLE.blockInnerGap }) {
      // web 形态：**没有"迭代 N"这种标题**，只有一条可展开的「思考 N 字」
      if (displayReasoning(it).length > 0) {
        // ⛔ 与 live 块**共用同一组件**（web `ThinkingLine`：图标 + 标签、无箭头）。
        //    用组件而非带参 `@Builder`：后者子树不随参数重建（ARKTS-GOTCHAS §4）。
        ThinkingLine({
          label: `思考 ${runeCount(displayReasoning(it))} 字`,
          body: displayReasoning(it),
          // 与 live 侧同构的共享键（`turnID:iteration`）—— commit 后 remount 仍读到同一展开态。
          stateKey: reasoningKey(this.row.turnID, it.iteration),
          theme: this.themeId(),
        })
      }

      if (displayContent(it).length > 0) {
        if (looksLikeLlmError(displayContent(it))) {
          // 迭代内正文是 LLM 失败文本 ⇒ 摘要行 + 可展开详情（同 row 级判据，判据与渲染同源）。
          LlmErrorNotice({ text: displayContent(it), theme: this.themeId() })
        } else {
          MarkdownView({
            text: displayContent(it),
            onImage: (src: string) => {
              this.onImage(src);
            },
            loadImage: (src: string) => {
              return this.loadImage(src);
            },
            // B6：复制反馈落点**透传**页面品牌 toast（与 row 级、LiveTailView 同一落点）。
            onToast: this.onToast,
            fontScale: this.fontScaleV,
            wrapCode: this.wrapCodeV,
            theme: this.themeId(),
            mdTheme: this.mdTheme,
          })
        }
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        // ── 假工具（注入型通知：bg_task/subagent/interrupt…）⇒ 渲染为**卡片** ──────────
        // 对齐 web `ToolRender.tsx:136`（interrupt）/`:154-155`（其余假工具）：注入事件
        // 渲染成"看得懂的系统卡"，而不是一枚看不懂的 pill。判据 = `isSyntheticToolName`。
        ForEach(this.synthToolsOf(it), (t: ToolProgress) => {
          SyntheticCard({
            tool: t,
            theme: this.themeId(),
            onCopy: (text: string, what: string) => {
              this.onCopy(text, what);
            },
          })
        }, (t: ToolProgress) => `syn#${this.toolKey(this.row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${t.status !== undefined ? t.status : ''}`)
        // ── 真工具：**每工具一枚 pill**，塞进一个 flex-wrap 行；>8 枚时前 7 枚 + "+N" ──
        // （逐字对齐 web `FoldedToolGroup.tsx:541-574` 的 `MergedPills`；假工具已摘出）。
        if (this.shownPills(it).length > 0 || this.hideCount(it) > 0) {
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.shownPills(it), (t: ToolProgress, ti: number) => {
              this.ToolItem(it, t, this.origIndex(it, t))
            }, (t: ToolProgress, ti: number) => `${this.toolKey(this.row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${this.origIndex(it, t)}`
              // ⛔ 同 `LiveTailView` 的 live pill：key 必须含**会变的可见内容**（`status`+`gen_chars`），
              //    否则条目子树不随值重建 ⇒ 状态/字数冻在创建那一刻（AGENTS「最小通知键」同族）。
              + `#${t.status !== undefined ? t.status : ''}#${t.gen_chars !== undefined ? t.gen_chars : 0}`)
            if (this.hideCount(it) > 0) {
              this.OverflowBadge(it)
            }
          }
          .width('100%')
          // 组级长按（**手势分层**：内层单枚 pill 的 `LongPressGesture` 先命中并消费 ⇒
          // 只有落在 pill **间隙**的长按才到这里 ⇒ 弹"工具组"菜单，绝不双触发。
          .gesture(LongPressGesture().onAction(() => {
            this.onOpenToolsCtx(it.iteration);
          }))
        }
      }

      // ── 该迭代 spawn 的 SubAgent 进度树（web `TurnBody.tsx:222-224`：
      //    `{iter.subAgents && iter.subAgents.length > 0 && <SubAgentProgressTree nodes={iter.subAgents}/>}`
      //    —— 渲染在迭代组**之后**、与迭代同级）。可见性/展平全在 `core/subagent.ets`（判据与渲染同源）。
      if (it.subAgents !== undefined && it.subAgents.length > 0) {
        SubAgentTree({
          rows: flattenSubAgents(it.subAgents, this.subAgentOpenable),
          theme: this.themeId(),
          onOpen: (k: string) => {
            this.onOpenSubAgent(k);
          },
        })
      }

      // ⛔ 工具详情**不再内联**插入（web：点 pill 弹浮层，见 ToolPill 的 bindPopup）——
      //   内联会让折叠行逐帧改高 ⇒ `LazyForEach` 逐帧 relayout（web `:4-8` 的踩坑根因）。
    }
    // `.iter-block{margin-top:0.25rem}`（TurnBody）—— 块间（含首块前）间距 4px（=SP_1）
    .width('100%').alignItems(HorizontalAlign.Start)
    // ⛔ 不再加左边导轨（2px accent 半透明）：web `.iter-block` **只有 margin-top、无 rail**
    //    （2026-10-10 核对 `index.css:1416`）。live 块本就没有 rail ⇒ 保留会让"同一个迭代
    //    在 live 形态与 committed 形态长得不一样"（用户要求 iter 完全统一样式）。
    .margin({ top: BUBBLE.iterGap })
  }

  /**
   * 工具条目分发 —— GenUI（`display_html`）⇒ **面板卡**（`GenuiPanelCard`）；其余 ⇒ 既有 pill。
   *
   * ⛔ 判据只此一处（`core/genui.genuiRenderable`），两分支同源；颜色/文案全在 core/组件。
   * 为什么 card 而非 pill：web 把 `display_html` 结果当**顶层面板**（`GenUIPanel.tsx:36`），
   * 不是一枚工具条 —— 原生此前只画 pill ⇒ 用户「统计插件的面板我们看不到」。
   */
  @Builder
  ToolItem(it: HistoryIteration, t: ToolProgress, ti: number) {
    if (genuiRenderable(t)) {
      GenuiPanelCard({
        title: genuiCardTitle(t),
        subtitle: genuiCardSubtitle(t),
        code: genuiCode(t),
        live: this.toolLive(t),
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
      this.ToolPillItem(it, t, ti)
    }
  }

  @Builder
  ToolPillItem(it: HistoryIteration, t: ToolProgress, ti: number) {
    Stack() {
      // 与 live 块**共用同一套 pill 视觉**（web `FoldedToolGroup.toolPill`：状态标记 + 名称
      // + 状态 chip）—— 修"done 与 executing 没区别"（用户 2026-10-10）。
      ToolPill({
        label: this.toolLabelText(t),
        // ANSI 逐 span 上色（web `AnsiText.tsx:205` 的消费点；`core/ansi` 唯一入口）
        labelSpans: this.toolLabelSpans(t),
        kind: this.toolKind(t),
        chip: this.toolChip(t),
        live: this.toolLive(t),
        selected: this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti),
        theme: this.themeId(),
      })
      // 运行中：一道扫光（纯 transform ⇒ 不触发布局，触屏也稳），中心叠 sheen 高光。
      // 取色**唯一口径** = `core/sweep.ets:sweepBandOf`（判据与渲染同源）：深色 = 彩色 accent 扫光
      // （逐字节原值）；浅色 = 中性柔影（同 `Effects.glow/glowSoft` 口径，白底不出彩色脏光晕）。
      if (this.toolLive(t)) {
        Row()
          .width(46).height('100%')
          .linearGradient({ angle: 90, colors: [
            [this.sweepBand().fade, 0.0], [this.sweepBand().core, 0.35],
            [this.sweepBand().sheen, 0.5], [this.sweepBand().core, 0.65], [this.sweepBand().fade, 1.0],
          ] })
          .opacity(0.45)
          .translate({ x: this.sweepX })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .margin(GAP_PILL)
    // 与 live 块同款宽度上限（生成中的参数是流式文本，可能几百字符；无上限会撑破屏幕）
    .constraintSize({ maxWidth: PILL_MAX_W })
    .clip(true)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      // ① 保留既有能力：页面 `toggleTool` 负责折叠视图下 `fetchIterationDetail` 按需拉取。
      this.onToggleTool(it.iteration, t.name);
      // ② 打开**浮层**（对齐 web：点 pill 弹 Popover，绝不内联展开）；再点同枚 = 关闭。
      //    身份用唯一键（`pillKeyOf`），同迭代内多次调用同一工具**只开对应那一枚**。
      const key: string = this.pillKeyOf(it, t, ti);
      this.popKey = this.popKey === key ? '' : key;
    })
    /** 浮层：内容挂在**弹层节点**里（脱离 LazyForEach 布局树，同 web Portal）。
     *  返回键/点外部经 `onWillDismiss`（`DismissReason.PRESS_BACK`/`TOUCH_OUTSIDE`）关闭。 */
    .bindPopup(this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti), {
      builder: this.ToolPopBody,
      placement: Placement.Bottom,
      enableArrow: false,
      mask: false,
      // 浮层三件套走设计系统口径（C4 续）：面 = `surface.overlay`；圆角 = 语义档；柔影 = token。
      // ⚠️ 原为 `pal().surfaceAlt`（RUNG_RAISED）——与**同一组件**的 `OverflowBadge` 浮层（下）不一致；
      //    收敛到唯一浮层面（`surface.overlay`）= RUNG_CARD（深色下 #14141C→#0E0E14，**有意**的归一）。
      popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
      radius: RADIUS_CARD,
      shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
      width: POPOVER_W,
      onWillDismiss: (action: DismissPopupAction) => {
        this.popKey = '';
      },
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onOpenCtx(it.iteration, t.name);
    }))
  }

  /** "+N" 徽标：被收起的工具枚数（>8 时出现）—— 点击弹**溢出全量列表**浮层。 */
  @Builder
  OverflowBadge(it: HistoryIteration) {
    Text(`+${this.hideCount(it)}`)
      .constraintSize({ minHeight: HIT_TARGET_MIN })
      .fontSize(FS_CAPTION)
      // 可点（点开溢出全量浮层）⇒ 弱档 `textMuted` 压 overlay 仅 2.37:1 < 3 ⇒ 用达标档 `textSecondary`
      .fontColor(this.pal().textSecondary)
      .padding({ left: SP_2, right: SP_2, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
      .margin(GAP_PILL)
      // 展开态底 = `surface.card`（RUNG_CARD）—— ⛔ 原为 `pal().surfaceHi`（RUNG_ACTIVE）：
      // porcelain 下 `textSecondary` 压它仅 **4.337 < AA 4.5**（文字 role，FS_CAPTION=12）。
      // `surface.card` porcelain = **5.071 ✓**（light/dark/aurora/nebula 均达标）。
      // 语义 = 比常态 `surfaceAlt`(raised) **抬升一档**；⛔ 不再用 `surfaceHi`（porcelain 不达标）。
      .backgroundColor(this.overIter === it.iteration ? surfaceFillOf(this.pal(), 'surface.card') : this.pal().surfaceAlt)
      .borderRadius(R_LG)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.overIter = this.overIter === it.iteration ? -1 : it.iteration;
      })
      .bindPopup(this.overIter === it.iteration, {
        builder: this.OverflowPopBody,
        placement: Placement.Bottom,
        enableArrow: false,
        mask: false,
        // 浮层三件套走设计系统口径（C4 续）：面 = `surface.overlay`；圆角 = 语义档；柔影 = token。
        popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
        radius: RADIUS_CARD,
        shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
        width: POPOVER_W_OVERFLOW,
        onWillDismiss: (action: DismissPopupAction) => {
          this.overIter = -1;
        },
      })
  }

  /** 浮层里"当前工具"（按 `popKey` 唯一键从**合并后**的块里查 —— 被吸收进本块的成员工具
   *  也在 head 块里；详情懒加载回填后仍读到最新一份）。
   *  键的算法必须与 `ToolPill` 渲染时**完全一致**（都用 `pillKeyOf` + 同迭代内下标）。 */
  private popTool(): ToolProgress | undefined {
    if (this.popKey.length === 0) {
      return undefined;
    }
    const bs: HistoryIteration[] = this.mergedBlocks();
    for (let i = 0; i < bs.length; i++) {
      const it: HistoryIteration = bs[i];
      if (it.tools === undefined) {
        continue;
      }
      for (let k = 0; k < it.tools.length; k++) {
        if (this.pillKeyOf(it, it.tools[k], k) === this.popKey) {
          return it.tools[k];
        }
      }
    }
    return undefined;
  }

  /** 浮层 VM（模块级自由函数 + 类内包装 —— `@Builder` 里不能直接调自由函数）。 */
  private popVM(): ToolDetailVM {
    const t: ToolProgress | undefined = this.popTool();
    const color: string = t !== undefined ? this.toolColor(t) : this.pal().textMuted;
    const status: string = t !== undefined ? this.toolChip(t) : '';
    return toolDetailVM(t, color, status);
  }

  /** 溢出浮层里的工具列表（被 `+N` 收起的那些）—— 从**合并后**的块里取。 */
  private overTools(): ToolProgress[] {
    const bs: HistoryIteration[] = this.mergedBlocks();
    for (let i = 0; i < bs.length; i++) {
      if (bs[i].iteration === this.overIter) {
        return this.hiddenPills(bs[i]);
      }
    }
    return [];
  }

  /** 单工具浮层内容（对齐 web `ToolPopoverDetail`）。 */
  @Builder
  ToolPopBody() {
    ToolPopoverCard({
      vm: this.popVM(),
      theme: this.themeId(),
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
      // 转后台（仅进行中的 Shell 显示；判据在卡片内 = `core/toolshell.canPromoteShell`）
      onPromote: (callId: string) => {
        return this.onPromoteShell(callId);
      },
    })
  }

  /** "+N" 溢出浮层内容（对齐 web `ToolPopoverContent`）。 */
  @Builder
  OverflowPopBody() {
    ToolOverflowList({
      tools: this.overTools(),
      theme: this.themeId(),
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
    })
  }

  build() {
    if (!this.isEmptyBubble()) {
      this.AssistantBlock()
    } else if (this.showsEmptyNotice()) {
      // ── 「空回复」的诚实表达（本波修复的真机空白屏）────────────────────────────
      // 判据 = **回合已结束**（`!row.isLive`）且整行无产出（`rowIsEmpty`）—— 详见 showsEmptyNotice()。
      // 🖼 chrome 与 `AssistantBlock()` 完全一致（同一 `BUBBLE.assistantPadX/rowPadY`）⇒ 空态
      //    与正常回复在视觉上"同一列、同一左边界"，不会看起来像另一个东西。
      Column() {
        EmptyNotice({ kind: NOTICE_KIND_EMPTY, theme: this.themeId() })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: BUBBLE.assistantPadX, right: BUBBLE.assistantPadX })
      .margin({ top: BUBBLE.rowPadY, bottom: BUBBLE.rowPadY })
    }
  }
}

/**
 * 上下文压缩点分隔行 —— turn **内部**的压缩位置提示（迭代之间、与迭代**同级**内联，
 * Cursor 式 "context summarized"）。解释"上下文为何骤降"，避免用户误判丢消息。
 *
 * 逐条对齐 web `CompactionDivider.tsx:30-64`（**权威**）：
 *   · 容器 `flex flex-col gap-1.5 py-1`（Column，垂直内边距 4vp，展开区与胶囊间距 6vp）；
 *   · 一行 `flex items-center gap-2`：左发丝线 + 虚线圆角胶囊（`Archive` 图标 + 文案
 *     "上下文已压缩" + 有正文时的 `ChevronDown`）+ 右发丝线；
 *   · 点击胶囊展开摘要正文：`max-h-[40vh] overflow-y-auto rounded-lg border
 *     border-border bg-bg-secondary p-3 text-xs whitespace-pre-wrap text-text-secondary`。
 *
 * ⛔ **必须是真 `@Component` + `@Prop`/`@State`**（项目铁律）：带参全局 `@Builder`
 *   的参数是"调用那一刻的快照"、子树不随参数重建（docs/ARKTS-GOTCHAS §4）⇒ 展开态与
 *    正文会卡在首帧。`body`（不同压缩点不同、异步到达）正是"会变的内容"。
 *
 * ⛔ 无正文（body 为空）时**不显示箭头、点击也不展开** —— 对齐 web `:51-53`/`:57-61`。
 *    颜色一律取自 `pal()` 语义色，间距/圆角取自 `core/tokens.ets`，**无硬编码 hex**。
 */
@Component
struct CompactionDividerRow {
  /** 摘要正文（可展开；空 ⇒ 不可展开）。由 `splitMarker(content).body` 派生。 */
  @Prop body: string = '';
  /** 显式主题覆盖（测试/独立预览）；生产留空 ⇒ 跟随 AppStorage 订阅。 */
  @Prop theme: string = 'dark';
  /** 全局主题订阅（生产唯一真源；主题变更时本组件各自重渲染，见 MessageRowView 的根因说明）。 */
  @StorageProp('appTheme') appTheme: string = '';

  /** 生效主题：生产走订阅，缺失时回落显式覆盖（单一口径，不产生两个真源）。 */
  private themeId(): string {
    // ⛔ 2026-10-17 白底白字终极修复：@StorageProp('appTheme') 在虚拟列表缓存 item 上
    //   **不触发重渲**（0152795+本轮插桩实证：frameKey 含 @theme、structural=true、reload
    //   全部执行但缓存 item 仍持旧色板）⇒ themeId() 读旧值 ⇒ 投给所有子组件
    //   （MarkdownView/ThinkingLine/ToolPill...）的 theme=旧 ⇒ 白字/黑字。
    //   唯一绕法：build 重跑时**直读 AppStorage.get()**（不建订阅）——配合 row.themeGen++
    //   （@Observed 赋值强制行重渲）⇒ 行重渲时此处必读到最新主题。
    const live: string = AppStorage.get<string>('appTheme') ?? '';
    return live.length > 0 ? live : (this.appTheme.length > 0 ? this.appTheme : this.theme);
  }
  /** 展开态（真 @State ⇒ 点击可切换、子树重建）。 */
  @State open: boolean = false;

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  build() {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        // 左发丝线（web `h-px flex-1 bg-border/70`）
        Divider()
          .strokeWidth(1)
          .color(withAlpha(this.pal().border, COMPACT_LINE_ALPHA))
          .layoutWeight(1)
        // 虚线胶囊（web `rounded-full border border-dashed border-border bg-bg-secondary
        //   px-2.5 py-0.5 text-[11px] text-text-muted`）
        Row({ space: 6 }) {
          // 图标取色走 `iconMuted`（弱图标专用；porcelain 下 `textMuted` < 3:1）
          SymbolGlyph($r('sys.symbol.archivebox')).fontSize(12).fontColor([colorOf(this.pal(), 'iconMuted')])
          Text(COMPACTED_LABEL).fontSize(FS_META).fontColor(this.pal().textMuted)
          if (this.body.length > 0) {
            // 同上：折叠指示图标走 `iconMuted`
            SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(12).fontColor([colorOf(this.pal(), 'iconMuted')])
              .rotate({ angle: this.open ? 180 : 0 })
              .animation(animFast())
          }
        }
        .padding({ left: 10, right: 10, top: SPACE_HAIR, bottom: SPACE_HAIR })
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(RADIUS_FULL)
        .border({ width: 1, color: this.pal().border, style: BorderStyle.Dashed })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          // 无正文 ⇒ 点击无操作（web：按钮存在但 `open && body` 才展开）
          if (this.body.length > 0) {
            this.open = !this.open;
          }
        })
        // 右发丝线
        Divider()
          .strokeWidth(1)
          .color(withAlpha(this.pal().border, COMPACT_LINE_ALPHA))
          .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // 展开的摘要正文（web `:57-61`：可滚动、保留换行、弱化文字）
      if (this.open && this.body.length > 0) {
        Scroll() {
          Text(this.body)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textSecondary)
            .textAlign(TextAlign.Start)
            .width('100%')
            // 正文可能含长 URL/长标识符 ⇒ 允许词内断行（docs/ARKTS-GOTCHAS §15）
            .wordBreak(WordBreak.BREAK_ALL)
        }
        .scrollBar(BarState.Auto)
        .width('100%')
        .clip(true)
        .constraintSize({ maxHeight: COMPACT_BODY_MAX_H })
        .padding(SP_3)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_LG)
        .border({ width: 1, color: this.pal().border })
      }
    }
    .width('100%')
    .padding({ top: SP_1, bottom: SP_1 })
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * 「空 / 失败」提示行 —— **这一类异常只有一种语言：一行、克制、静态**。
 * 契约正文见 `docs/DESIGN-SYSTEM.md §10`。
 *
 * 为什么必须有它（2026-10-11 真机空白屏）：`role=assistant len=0` 的回合此前被
 * `MessageRowView.build()` 的 `rowIsEmpty` 守卫**整块跳过** ⇒ 用户看到「自己发的气泡 +
 * 下面一片空白」，以为消息没发出去 / 卡住了。**「模型没返回内容」与「这个回合不存在」
 * 是两件事** —— 后者才该静默。
 *
 * 形态（依据用户口令「一行小字 + 中性色，不是大红报错」，**刻意偏离** web 的填充红盒
 * `AssistantMessage.tsx:173-179` 的 `border-status-error/40 + bg-status-error/10`）：
 *   · 一行：图标（仅失败档）+ 一行小字；**无填充、无边框、无阴影、无发光**；
 *   · 颜色只按**严重度升一档**：`empty` ⇒ `pal().textMuted`（中性，读者几乎不必看它）；
 *     `failed` ⇒ `pal().dangerText`。两者都是**语义角色** ⇒ 深浅色 / `porcelain` 纯白
 *     自动成立（白底上 `#B42318` 可见但不刺眼），**无需** `isLightPalette` 分叉、无外发光；
 *   · **零动画 / 静态**：它只出现在"回合已结束"之后，因此绝不会与"在飞主高亮源"
 *     （光球，见 §8）同屏争抢 —— 同一时刻仍然只有一个主角。
 *
 * ⛔ 必须是真 `@Component` + `@Prop`：`kind` 是会变的值（同一行可能从"空"变"失败"），
 *   带参全局 `@Builder` 的参数是首帧快照 ⇒ 子树不重建（本仓铁律，docs/ARKTS-GOTCHAS §4）。
 *
 * ⚠️ **刻意不加 `export`**：它只被本文件（`MessageRowView`）消费 —— 与同文件的
 *   `CompactionDividerRow` 同款。加了 `export` 就会被 `tools/lint/orphan-components.sh`
 *   当成"孤儿组件"（该脚本只扫**其它文件**里有没有这个名字）⇒ 报出一条**假警告**。
 *   本组件在 `MessageRowView` 里有 2 处真实消费，因此**会被 ArkTS 正常类型检查**。
 */
@Component
struct EmptyNotice {
  /** 档位：`empty`（回合结束但无产出）| `failed`（服务端标记的空/异常响应）。 */
  @Prop kind: string = NOTICE_KIND_EMPTY;
  /** 显式主题覆盖（测试/独立预览）；生产留空 ⇒ 跟随 AppStorage 订阅。 */
  @Prop theme: string = 'dark';
  /** 全局主题订阅（生产唯一真源；主题变更时本组件各自重渲染，见 MessageRowView 的根因说明）。 */
  @StorageProp('appTheme') appTheme: string = '';

  /** 生效主题：生产走订阅，缺失时回落显式覆盖（单一口径，不产生两个真源）。 */
  private themeId(): string {
    // ⛔ 2026-10-17 白底白字终极修复：@StorageProp('appTheme') 在虚拟列表缓存 item 上
    //   **不触发重渲**（0152795+本轮插桩实证：frameKey 含 @theme、structural=true、reload
    //   全部执行但缓存 item 仍持旧色板）⇒ themeId() 读旧值 ⇒ 投给所有子组件
    //   （MarkdownView/ThinkingLine/ToolPill...）的 theme=旧 ⇒ 白字/黑字。
    //   唯一绕法：build 重跑时**直读 AppStorage.get()**（不建订阅）——配合 row.themeGen++
    //   （@Observed 赋值强制行重渲）⇒ 行重渲时此处必读到最新主题。
    const live: string = AppStorage.get<string>('appTheme') ?? '';
    return live.length > 0 ? live : (this.appTheme.length > 0 ? this.appTheme : this.theme);
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  /** 是否失败档：唯一加重手段 = 升一档颜色 + 一枚状态图标。 */
  private failed(): boolean {
    return this.kind === NOTICE_KIND_FAILED;
  }

  build() {
    Row({ space: SP_1 }) {
      if (this.failed()) {
        // 图标只在失败档出现（符号名已在仓内其它处用过：`ToolVisual` 的失败态 ⇒ 存在性已核实）
        SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
          .fontSize(FS_CAPTION)
          .fontColor([this.pal().dangerText])
          .flexShrink(0)
      }
      Text(this.failed() ? FAILED_NOTICE_TEXT : EMPTY_NOTICE_TEXT)
        .fontSize(FS_CAPTION)
        .fontColor(this.failed() ? this.pal().dangerText : this.pal().textMuted)
        .wordBreak(WordBreak.BREAK_WORD)
        .layoutWeight(1)
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }
}
