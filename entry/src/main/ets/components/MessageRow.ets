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
import {
  completedBlocks, displayContent, displayReasoning, foldPills, mergeToolRuns, rowIsEmpty,
} from '../core/streammerge';
import { runeCount } from '../core/typewriter';
import { Palette, paletteOf, Effects, effectsOf } from '../core/theme';
import { BUBBLE } from '../core/bubble';
import { R_MD, R_XL, R_LG, SP_1, SP_2, SP_3, FS_CAPTION } from '../core/tokens';
import { MarkdownView } from './MarkdownView';
import { LiveTailView } from './LiveTailView';
import { ThinkingLine } from './ThinkingLine';
import { ToolPill } from './ToolVisual';
import { isLiveStatus, statusChip, toolStatusKind } from '../core/toolstatus';
import { ToolDetailVM, toolDetailVM, ToolOverflowList, ToolPopoverCard } from './ToolPopover';
import { animMsgIn } from './anim';

/** 「更早区域」分隔条行高（vp）—— web `h-7` = 28px。三态**恒定**，避免加载前后布局跳变。 */
const REGION_ROW_H: number = 28;
/** 浮层宽度（对齐 web `FoldedToolGroup` 的 `POPOVER_CLASS` 宽 430px；手机端收窄到 340vp）。 */
const POP_W: number = 340;
/** "+N" 溢出浮层宽度。 */
const OVER_W: number = 320;

@Component
export struct MessageRowView {
  @ObjectLink row: ChatRow;
  @Prop theme: string = 'dark';
  /** Markdown 主题 id（透传给 MarkdownView，只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';
  @Prop fontScaleV: number = 1;
  @Prop wrapCodeV: boolean = true;
  /** 运行中工具 pill 的流光位置（页面统一推进 ⇒ 每行不再各开定时器） */
  @Prop sweepX: number = 0;
  /** 应用是否在后台（打字机在后台挂起 —— 与 LiveTailView 同款） */
  @Prop paused: boolean = false;
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
  onImage: (src: string) => void = (src: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  onLoadMoreRegions: () => Promise<boolean> = async () => {
    return false;
  };
  onOpenCtx: (iter: number, toolName: string) => void = (iter: number, toolName: string) => {
  };
  onToggleTool: (iter: number, toolName: string) => void = (iter: number, toolName: string) => {
  };
  onRowLongPress: () => void = () => {
  };
  /** 复制文本（页面对接系统剪贴板；组件不做 IO/系统调用） */
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };

  @State openReasonKey: string = '';
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
   * 行入场动效的进度位：`false` = 起始态（透明 + 下沉 4px），`true` = 终态。
   *
   * 复刻 web `msgIn`（`index.css:705`：`opacity 0→1`、`translateY 4px→0`、200ms spring）。
   * ⛔ **web 铁律**：入场动效只作用**行内层**（`.animate-msg-in > *`），**绝不改行自身的定位
   *   transform** —— 虚拟列表用 `translateY(item.start)` 定位行，动效里的 transform 会覆盖它
   *   ⇒ 行被画到容器原点、压在上一条上（web 2026-09-16 快速滚动抖动重叠的真根因，
   *   守护见 `web/src/index.test.ts` 的 virt-row 用例）。原生端行定位由 `List`/`ListItem`
   *   （pages/Index.ets）负责、不用 transform，但纪律同源：动效只挂在**行内容**上
   *   （即 ListItem 的直接子节点 = 本组件的 `AssistantBlock` 根 Column），不碰外层定位节点。
   *
   * 只给 **live 行**播入场（对齐 web `row.id === liveId`）：历史行不播，避免滚动时逐行闪入。
   */
  @State entered: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  aboutToAppear(): void {
    // 非 live 行直接到终态（不动画，随滚动创建的历史行不闪入）；live 行保持起始态，
    // 由行根的 `onAppear` 用 `animMsgIn()` 播一次 spring 入场。
    this.entered = !this.row.isLive;
  }

  /** 工具是否处于"在飞"（运行/生成中）—— 决定发光与扫光。判定收敛在 `core/toolstatus`。 */
  private toolLive(t: ToolProgress): boolean {
    return isLiveStatus(toolStatusKind(t.status, t.exit_code));
  }

  /** 语义状态档（done/error/running/pending/killed）—— 与 live 块同源判定。 */
  private toolKind(t: ToolProgress): string {
    return toolStatusKind(t.status, t.exit_code);
  }

  /** 状态 chip 文案（空 = 无 chip）。 */
  private toolChip(t: ToolProgress): string {
    return statusChip(this.toolKind(t), t.exit_code, t.gen_chars);
  }

  /** pill 展示文本（名称/标签，**不含**状态 badge —— 状态由 chip 表达）。 */
  private toolLabelText(t: ToolProgress): string {
    return t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  }

  /** 视觉 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
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

  private toolColor(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    if (t.status === 'pending') {
      return this.pal().textMuted;
    }
    // 成功：**中性色**（几十个绿点是全局最花的配色噪音；颜色只留给"运行中/失败"）
    return this.pal().textMuted;
  }

  private toolStatusBadge(t: ToolProgress): string {
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

  private toolLabel(t: ToolProgress): string {
    const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
    const badge: string = this.toolStatusBadge(t);
    return badge.length > 0 ? `${base} ${badge}` : base;
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
   * ⛔ 不再「只显示最近 8 个 + 点击展开全部」（原生自创）：web `TurnBody` 渲染**全部**迭代，
   *    靠 `content-visibility` 做窗口化，**没有"点击展开"这种交互**（用户 2026-10-10 明确
   *    禁止）。历史过长时的性能由 ArkUI 的 `LazyForEach`/`@Reusable` 承担。
   */
  private itersFor(): HistoryIteration[] {
    return this.mergedBlocks();
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

  /** 同一迭代内**直出**的 pill（≤8 全量；>8 前 7 枚）—— 对齐 web `MergedPills`。 */
  private shownPills(it: HistoryIteration): ToolProgress[] {
    return foldPills(it.tools !== undefined ? it.tools : []).shown;
  }

  /** 同一迭代内被收进 `+N` 的 pill（>8 时 = 第 8 枚起）。 */
  private hiddenPills(it: HistoryIteration): ToolProgress[] {
    return foldPills(it.tools !== undefined ? it.tools : []).hidden;
  }

  /** `+N` 的 N（收起枚数）。 */
  private hideCount(it: HistoryIteration): number {
    return foldPills(it.tools !== undefined ? it.tools : []).hideCount;
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
            Text('正在加载更多…').fontSize(11).fontColor(this.pal().textMuted)
          } else if (this.regionStatus === 'error') {
            // 失败**不自动重试**（对齐 web `useRegionWindow`：避免弱网下的自动请求循环），
            // 只在此处提供手动重试（web `RegionsDivider` 的 error 态同样是可点按钮）。
            SymbolGlyph($r('sys.symbol.arrow_counterclockwise')).fontSize(12).fontColor([this.pal().warn])
            Text('加载失败 · 重试').fontSize(11).fontColor(this.pal().warn)
          } else {
            SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(12).fontColor([this.pal().textMuted])
            Text(`更早的 ${this.row.regionsBefore} 个区域`).fontSize(11).fontColor(this.pal().textMuted)
          }
        }
        .width('100%')
        .height(REGION_ROW_H)     // **恒定行高**（web `h-7`）：三态不改变布局，避免滚动跳变
        .justifyContent(FlexAlign.Center)
        // 可见性哨兵：滚到顶部露出本条 ⇒ 自动取更早一段（web `useRegionWindow` 的 IO 哨兵）
        .onVisibleAreaChange([0.0, 1.0], (isVisible: boolean) => {
          if (isVisible) {
            this.autoLoadRegions();
          }
        })
        .onClick(() => {
          // 仅 error 态允许点（重试）；idle 态点击无操作（不做"点击加载"）
          if (this.regionStatus === 'error') {
            this.autoLoadRegions();
          }
        })
      }
      if (this.row.content.length > 0 && this.row.iterations.length === 0) {
        MarkdownView({
          text: this.row.content,
          onImage: (src: string) => {
            this.onImage(src);
          },
          loadImage: (src: string) => {
            return this.loadImage(src);
          },
          fontScale: this.fontScaleV,
          wrapCode: this.wrapCodeV,
          theme: this.theme,
          mdTheme: this.mdTheme,
        })
      }
      // 已完成迭代。live 行的列表来自**值** `liveBlocks`（@Prop）；普通行走带 key 的
      // LazyForEach（key 含 rev）。在飞块由下方 LiveIterationBlock 单独渲染。
      // ⛔ key 必须含 `live` 标记：在飞块可能与某个**已提交迭代同号**（服务端把
      //   在飞迭代记进 iteration_history 的场景 —— 见 core/render.ets.inFlightBlock），
      //   只按 `row.id#iteration` 会撞 key ⇒ ArkUI 复用错位（渲染错乱）。
      ForEach(this.itersFor(), (it: HistoryIteration) => {
        this.IterationBlock(it)
      }, (it: HistoryIteration) => `${this.row.id}#${it.iteration}#${it.live === true ? 'L' : 'C'}`)
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
    // 入场动效（web `msgIn`：opacity 0→1 + translateY 4px→0，200ms spring）—— 只挂在行内容上
    // （本 Column = ListItem 的直接子节点，等价 web `.animate-msg-in > *`），不动外层定位节点。
    // 见 `entered` 声明处的铁律说明。`.translate` 是渲染变换、不参与 List 布局，触屏也稳。
    .opacity(this.entered ? 1 : 0)
    .translate({ y: this.entered ? 0 : 4 })
    .onAppear(() => {
      if (!this.entered) {
        animateTo(animMsgIn(), () => {
          this.entered = true;
        });
      }
    })
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
        theme: this.theme,
        fontScale: this.fontScaleV,
        wrapCode: this.wrapCodeV,
        onImage: (src: string) => {
          this.onImage(src);
        },
        loadImage: (src: string) => {
          return this.loadImage(src);
        },
        onToolLongPress: (name: string) => {
          this.onOpenCtx(this.row.turnID, name);
        },
      })
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
          open: this.openReasonKey === `${this.row.id}-${it.iteration}`,
          theme: this.theme,
          onToggle: () => {
            const key: string = `${this.row.id}-${it.iteration}`;
            this.openReasonKey = this.openReasonKey === key ? '' : key;
          },
        })
      }

      if (displayContent(it).length > 0) {
        MarkdownView({
          text: displayContent(it),
          onImage: (src: string) => {
            this.onImage(src);
          },
          loadImage: (src: string) => {
            return this.loadImage(src);
          },
          fontScale: this.fontScaleV,
          wrapCode: this.wrapCodeV,
          theme: this.theme,
          mdTheme: this.mdTheme,
        })
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        // 同一迭代内：**每工具一枚 pill**，全部塞进一个 flex-wrap 行；>8 枚时前 7 枚 + "+N"
        // （逐字对齐 web `FoldedToolGroup.tsx:541-574` 的 `MergedPills`）。
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.shownPills(it), (t: ToolProgress, ti: number) => {
            this.ToolPillItem(it, t, ti)
          }, (t: ToolProgress, ti: number) => `${this.toolKey(this.row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${ti}`)
          if (this.hideCount(it) > 0) {
            this.OverflowBadge(it)
          }
        }
        .width('100%')
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

  @Builder
  ToolPillItem(it: HistoryIteration, t: ToolProgress, ti: number) {
    Stack() {
      // 与 live 块**共用同一套 pill 视觉**（web `FoldedToolGroup.toolPill`：状态标记 + 名称
      // + 状态 chip）—— 修"done 与 executing 没区别"（用户 2026-10-10）。
      ToolPill({
        label: this.toolLabelText(t),
        kind: this.toolKind(t),
        chip: this.toolChip(t),
        live: this.toolLive(t),
        selected: this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti),
        theme: this.theme,
      })
      // 运行中：一道 accent 扫光（纯 transform ⇒ 不触发布局，触屏也稳），中心叠 sheen 高光
      if (this.toolLive(t)) {
        Row()
          .width(46).height('100%')
          .linearGradient({ angle: 90, colors: [
            [this.pal().accentSoftFade, 0.0], [this.pal().accentSoft, 0.35],
            [this.eff().sheen, 0.5], [this.pal().accentSoft, 0.65], [this.pal().accentSoftFade, 1.0],
          ] })
          .opacity(0.45)
          .translate({ x: this.sweepX })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .margin(3)
    // 与 live 块同款宽度上限（生成中的参数是流式文本，可能几百字符；无上限会撑破屏幕）
    .constraintSize({ maxWidth: 240 })
    .clip(true)
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
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
      popupColor: this.pal().surfaceAlt,
      radius: R_XL,
      width: POP_W,
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
      .fontSize(FS_CAPTION)
      .fontColor(this.pal().textMuted)
      .padding({ left: SP_2, right: SP_2, top: 5, bottom: 5 })
      .margin(3)
      .backgroundColor(this.overIter === it.iteration ? this.pal().surfaceHi : this.pal().surfaceAlt)
      .borderRadius(R_LG)
      .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.overIter = this.overIter === it.iteration ? -1 : it.iteration;
      })
      .bindPopup(this.overIter === it.iteration, {
        builder: this.OverflowPopBody,
        placement: Placement.Bottom,
        enableArrow: false,
        mask: false,
        popupColor: this.pal().surface,
        radius: R_XL,
        width: OVER_W,
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
    const status: string = t !== undefined ? this.toolStatusBadge(t) : '';
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
      theme: this.theme,
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
    })
  }

  /** "+N" 溢出浮层内容（对齐 web `ToolPopoverContent`）。 */
  @Builder
  OverflowPopBody() {
    ToolOverflowList({
      tools: this.overTools(),
      theme: this.theme,
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
    })
  }

  build() {
    if (!this.isEmptyBubble()) {
      this.AssistantBlock()
    }
  }
}
