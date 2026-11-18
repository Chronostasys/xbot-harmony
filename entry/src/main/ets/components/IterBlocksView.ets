/**
 * 一行消息里**已完成迭代块**的渲染器（从 `MessageRowView` 拆出的性能关键子树）。
 *
 * ⛔ 为什么必须独立成组件（2026-10-20 性能根因，见 `docs/PERF-BOUNDS.md §3`）：
 *   流式期间 live 行的 `ChatRow` **每个 SSE 事件都被 `applyRow` 写一次字段**
 *   （正文/迭代/代际 —— 这是值投递的唯一通道），而它被 `MessageRowView` 以
 *   `@ObjectLink` 订阅 ⇒ **行组件逐帧 rebuild**。旧实现把
 *   `ForEach(shownIters())` 直接写在行组件的 build 里 ⇒ 逐帧对**全部 N 个块**
 *   重算 key/对比数组 ⇒ 每帧成本 O(N)（N = 该 turn 的迭代块数，真实会话可达 340）。
 *   现在块列表只在**这里**渲染，本组件只订阅 `IterBlocks` 持有者
 *   （`core/types.ets`）：它只在块列表/压缩点**真正变化**时被替换 ⇒ 正文流式增长
 *   期间本组件**零重建** ⇒ 每帧成本与 N 无关（O(1)）。
 *
 * 纪律（与 `MessageRowView` 同源）：
 *   · 判据全部来自 `core/*`（折叠/合并/分组/状态档），本文件不新增判定；
 *   · 视觉与拆分前**逐字节一致**（`ForEach` 键、间距、取色口径全部原样搬运）。
 */
import { mergeToolOnlyIterations } from '../core/pillmerge';
import { HistoryIteration, IterBlocks, ToolProgress  } from '../core/types';
import { WebCompaction } from '../core/chattypes';
import { displayContent, displayReasoning, pillView, resolveByKeys, toolPillGroups } from '../core/streammerge';
import { detailIterationOf, toolNeedsDetail } from '../core/toolmerge';
import { runeCount } from '../core/typewriter';
import { Palette, paletteOf, shadowRadiusOf } from '../core/theme';
import { BUBBLE, withAlpha } from '../core/bubble';
import { R_LG, R_MD, SP_1, SP_2, SP_3, FS_CAPTION, FS_META } from '../core/tokens';
import {
  ELEV_OVERLAY, GAP_PILL, INSET_PILL_Y, PILL_HALF_W, POPOVER_W, POPOVER_W_OVERFLOW, STROKE_HAIRLINE, structuralRuleOf,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_FULL, SPACE_HAIR, colorOf, elevationColorOf, surfaceFillOf, typeOf,
} from '../core/design';
import { anchorsAt, COMPACTED_LABEL, compactionAnchors, splitMarker } from '../core/compaction';
import { MarkdownView } from './MarkdownView';
import { GenuiPanelCard } from './GenuiPanelCard';
import { genuiCardSubtitle, genuiCardTitle, genuiCode, genuiRenderable } from '../core/genui';
import { ThinkingLine } from './ThinkingLine';
import { ToolPill, statusColorOf } from './ToolVisual';
import { SyntheticCard } from './SyntheticCard';
import { LlmErrorNotice } from './LlmErrorNotice';
import { isSyntheticToolName } from '../core/synthhints';
import { looksLikeLlmError } from '../core/llmerror';
import { isInFlight, renderKind, statusChip } from '../core/toolstatus';
import { AnsiSpan, ansiPaletteOf, ansiSpansIfAny } from '../core/ansi';
import { ToolDetailVM, toolDetailVM, ToolOverflowList, ToolPopoverCard } from './ToolPopover';
import { SubAgentTree } from './SubAgentTree';
import { flattenSubAgents } from '../core/subagent';
import { SweepBand, sweepBandOf } from '../core/sweep';
import { animBase, animFast } from './anim';
import { reasoningKey } from '../core/reasoningopen';

/** 压缩摘要正文的最大高度（web `max-h-[40vh] overflow-y-auto`；手机取 ~48% 视口）。 */
const COMPACT_BODY_MAX_H: number = 420;
/** 压缩分隔行两侧发丝线的不透明度（web `bg-border/70`）。 */
const COMPACT_LINE_ALPHA: number = 0.7;
/** 徽标"预取中"转圈的尺寸。 */
const BADGE_SPINNER: number = 13;

/** 共享空锚定表（无压缩行 ⇒ 零分配、零渲染；调用方只读）。 */
const NO_ANCHORS: Map<number, WebCompaction[]> = new Map();

@Component
export struct IterBlocksView {
  /** 已完成块列表 + 归属身份（只在块真正变化时替换 ⇒ 本组件零重建）。 */
  @ObjectLink iters: IterBlocks;
  /**
   * **值投递**的已完成块快照（live 行专用）。
   *
   * ⛔ 用户 2026-11-18 P0：「迭代完成就消失，idle 后才全部出现」。真机日志（`[ITR] view`）证明确切：
   *   `@ObjectLink iters` 的赋值在该行**没有驱动 `build()`**（整个回合期间 `mergedBlocks()` 只跑过 1 次，
   *   还是回合结束后）⇒ live 行的已提交块区**冻结在创建那一瞬（空）**。
   *   页面本来就有 `liveBlocks`（`syncLiveTail` 每代际投递的 `@State`，注释写明它是本 bug 的根治项），
   *   但 `IterBlocksView` 早已只读 `this.iters.blocks` ⇒ 投递链路断了。
   *   ⇒ 非空时**以它为准**：`@Prop` 是值语义 ⇒ 值变即重建（不依赖 @Observed 通知）。
   */
  @Prop blocksOverride: HistoryIteration[] = [];
  /** 显式主题覆盖（测试/独立预览） */
  /** 迭代号标记开关（开发者设置；默认关 = 与改造前逐像素一致）。 */
  @StorageProp('xbotIterBadge') iterBadgeOn: boolean = false;
  @Prop theme: string = 'dark';
  /** 全局主题订阅（生产唯一真源；与 MessageRowView 同根因同机制）。 */
  @StorageProp('appTheme') appTheme: string = '';
  @Prop mdTheme: string = 'vscode-dark';
  @Prop fontScaleV: number = 1;
  @Prop wrapCodeV: boolean = true;
  /** SubAgent 树是否可点开（透传页面设置）。 */
  @Prop subAgentOpenable: boolean = false;
  onImage: (src: string) => void = (src: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string): Promise<ArrayBuffer> => {
    return new ArrayBuffer(0);
  };
  onToast: (msg: string) => void = () => {
  };
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };
  onOpenCtx: (iter: number, toolName: string) => void = (iter: number, toolName: string) => {
  };
  onOpenToolsCtx: (iter: number) => void = (iter: number) => {
  };
  onToggleTool: (iter: number, toolName: string, toolIter?: number) => void = (iter: number, toolName: string, toolIter?: number) => {
  };
  /** 只取数、不改展开态（折叠面板 `+N` 里逐枚工具用；见页面 `ensureToolDetails`）。 */
  /** 异步版本（浮层里批量取数要 await）：默认转发到同步回调（页面只实现一处）。 */
  onEnsureToolDetailAsync: (iter: number, toolName: string, toolIter?: number) => Promise<void> =
    (iter: number, toolName: string, toolIter?: number): Promise<void> => {
      this.onEnsureToolDetail(iter, toolName, toolIter);
      return Promise.resolve();
    };
  onEnsureToolDetail: (iter: number, toolName: string, toolIter?: number) => void = (iter: number, toolName: string, toolIter?: number) => {
  };
  onOpenSubAgent: (sessionKey: string) => void = (sessionKey: string) => {
  };
  onOpenGenui: (code: string, title: string) => void = (code: string, title: string) => {
  };
  onShareGenui: (code: string, title: string) => Promise<string> = (code: string, title: string): Promise<string> => {
    return Promise.resolve('');
  };
  onPromoteShell: (callId: string) => Promise<string> = async (callId: string): Promise<string> => {
    return '';
  };

  /** 当前打开浮层的工具唯一键（行内状态 —— 不跨行走）。 */
  @State popKey: string = '';
  /**
   * 浮层的**渲染槽位**（`rowID#块号#块内下标`）—— `bindPopup` 的开合只认它。
   *
   * ⛔ 用户 2026-10-28：「点一个 badge 弹出两个详情」。`bindPopup` 的条件曾是
   *   `popKey === pillKeyOf(...)`：只要**两枚 pill 算出同一个键**（服务端 `active_tools`
   *   跨帧残留 ⇒ 同一调用出现在相邻迭代 ⇒ 合并块里两枚同 call_id 的工具），两个浮层会
   *   **同时**打开（截图实证：两张一模一样的详情卡上下错位叠着）。
   *   ⇒ 绑定改用**槽位**（渲染下标，逐枚唯一）；`popKey` 只负责"查哪枚工具"。
   */
  @State popAt: string = '';
  /**
   * 正在**为该槽位预取详情**（`bindPopup` 的子树只构建一次 ⇒ 必须"先取数再打开"，
   * 与 `+N` 的 `toggleOverflow` 完全同源；用户 2026-11-18：「普通的工具 pill 也有这个问题」）。
   */
  @State popPendingSlot: string = '';
  /** 当前打开 "+N" 溢出的迭代号（-1 = 无）。 */
  @State overIter: number = -1;
  /** 溢出浮层对应的**组**下标（同一块里可能有多组：假工具会切断分组）—— `+N` 与浮层必须同组。 */
  @State overGroup: number = 0;
  /**
   * 打开浮层那一刻**捕获**的"被收起工具"快照 —— 浮层只渲染它。
   *
   * ⛔ 为什么不实时重算（用户 2026-11-17「有时候 `+N` 这个数字 N 会多 1 个」）：
   *   徽标 N 与浮层列表若在**两个时刻**各自重算，中间只要来一帧（工具完成/合并块变化/
   *   分组重算）就会出现"数字与列表差一条"。捕获同一份 `pillView(...).hidden` 后，
   *   「看到的 N」与「展开的条数」在**同一次点击**里恒等。
   */
  @State overList: ToolProgress[] = [];
  /** 溢出列表的数据持有者（`@Observed`，浮层用 `@ObjectLink` 订阅 ⇒ 源变了浮层会刷新）。 */
  /** 正在为 `+N` 预取详情（徽标转圈；`allSettled` 后必定关闭）。 */
  @State overPending: boolean = false;
  /**
   * 详情代数（`store.fetchIterationDetail` 每批 +1）。
   *
   * ⛔ 用户 2026-11-18 P0：「点开的加载中（正在获取参数与输出）永远不会结束，要第二次点开才正常」。
   *   根因：`bindPopup` 的子内容**在打开那一刻构建**，之后详情回来也**不会重建** ⇒ 我上一版把
   *   loading 画在浮层里 = 永久转圈。⇒ 改成 **先取数、后打开**：点击时若还有工具缺详情，
   *   徽标转圈（不打开），等 `toolGen` 变化（详情落库）再自动打开 —— 打开时数据已就绪。
   */

  /** 扫光带（按主题记忆化） */
  private bandTheme: string = '';
  private bandCache: SweepBand = new SweepBand();
  /** 压缩点锚定表（按 `iters.rev` 记忆化） */
  private anchorsRev: number = -1;
  private anchorsCache: Map<number, WebCompaction[]> = new Map();

  private themeId(): string {
    const live: string = AppStorage.get<string>('appTheme') ?? '';
    return live.length > 0 ? live : (this.appTheme.length > 0 ? this.appTheme : this.theme);
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  private sweepBand(): SweepBand {
    const t: string = this.themeId();
    if (this.bandTheme !== t) {
      this.bandTheme = t;
      this.bandCache = sweepBandOf(this.pal());
    }
    return this.bandCache;
  }

  private toolLive(t: ToolProgress): boolean {
    return isInFlight(this.toolKind(t), false);
  }

  private toolKind(t: ToolProgress): string {
    return renderKind(t.status, t.exit_code, false);
  }

  private toolChip(t: ToolProgress): string {
    return statusChip(this.toolKind(t), t.exit_code, t.gen_chars, t.elapsed_ms);
  }

  private toolLabelText(t: ToolProgress): string {
    return t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  }

  private toolLabelSpans(t: ToolProgress): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(this.toolLabelText(t), ansiPaletteOf(this.pal()));
    return s !== null ? s : [];
  }

  private toolKey(turnID: number, iter: number, name: string): string {
    return `${turnID}:${iter}:${name}`;
  }

  /**
   * 单枚 pill 的**稳定键**。
   *
   * ⛔ 用户 2026-10-28：「点开有时有详情、有时没有（随机）」——根因是旧键含 **块号 + 数组下标**：
   *   合并块（`pillM…` 把连续纯工具迭代并成一块）的 `iteration` 取**最后一个成员**、`tools`
   *   会随新工具到达而变长 ⇒ 同一次点击之后块号/下标漂移 ⇒ `popKey` 再也匹配不上任何工具
   *   ⇒ 浮层退化成「工具 / 暂无详情」。
   *   ⇒ 键只用**工具自己的**稳定身份：`turn : 工具自带迭代号 : 名字 # call_id（缺省用同迭代内
   *   同名序号）`。合并/追加都不改变它 ⇒ 浮层永远查得到同一枚工具。
   */
  private pillKeyOf(it: HistoryIteration, t: ToolProgress, idx: number): string {
    const ownIter: number = t.iteration !== undefined && t.iteration !== null && t.iteration > 0
      ? t.iteration : it.iteration;
    const cid: string = t.call_id !== undefined && t.call_id.length > 0
      ? t.call_id : `o${this.sameNameOrdinal(it, t, idx)}`;
    return `${this.toolKey(this.iters.turnID, ownIter, t.name)}#${cid}`;
  }

  /** 渲染槽位（唯一）：`rowID#块号#块内下标`。 */
  private slotOf(it: HistoryIteration, ti: number): string {
    return `${this.iters.rowID}#${it.iteration}#${ti}`;
  }

  /** 同迭代内**同名**工具的出现序号（缺 call_id 时的稳定身份；与渲染顺序一致）。 */
  private sameNameOrdinal(it: HistoryIteration, t: ToolProgress, idx: number): number {
    const all: ToolProgress[] = it.tools !== undefined ? it.tools : [];
    const ownIter: number = t.iteration !== undefined && t.iteration !== null && t.iteration > 0
      ? t.iteration : it.iteration;
    let n: number = 0;
    for (let i = 0; i < all.length && i <= idx; i++) {
      const o: ToolProgress = all[i];
      const oIter: number = o.iteration !== undefined && o.iteration !== null && o.iteration > 0
        ? o.iteration : it.iteration;
      if (o.name === t.name && oIter === ownIter) {
        if (i === idx) {
          return n;
        }
        n++;
      }
    }
    return n;
  }

  /**
   * 压缩点锚定表（`afterIteration` → 实际渲染块）—— 对齐 web `TurnBody.compactionByIter`。
   * ⛔ 按 `iters.rev` 记忆化：块列表未变 ⇒ 零重算（O(1) 早退在无压缩点时）。
   */
  private compactionMap(): Map<number, WebCompaction[]> {
    const comps: WebCompaction[] = this.iters.compactions;
    if (comps.length === 0) {
      return NO_ANCHORS;
    }
    if (this.anchorsRev === this.iters.rev) {
      return this.anchorsCache;
    }
    const blocks: HistoryIteration[] = this.iters.blocks;
    const nums: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      nums.push(blocks[i].iteration);
    }
    this.anchorsCache = compactionAnchors(nums, comps);
    this.anchorsRev = this.iters.rev;
    return this.anchorsCache;
  }

  private compactionsAt(anchor: number): WebCompaction[] {
    return anchorsAt(this.compactionMap(), anchor);
  }

  /** 按原始顺序分组（**与折叠/浮层同源**：`core/streammerge.toolPillGroups`，按 tools 身份记忆化）。 */
  private toolGroupsOf(it: HistoryIteration): ToolProgress[][] {
    return toolPillGroups(it.tools !== undefined ? it.tools : []);
  }

  /** 真工具组内直出的 pill（foldPills 作用于单组）。 */
  /**
   * 渲染单元 = **合并后的块**（2026-10-25 用户 P0：`Shell` pill 一路往下堆 20 行）。
   *
   * ⛔ 折叠（`foldPills`：>8 ⇒ 前 7 + `+N`）必须作用在**一次回复里连续的纯工具迭代**上，
   *   而不是单个迭代上 —— 服务端**一次工具调用就是一个迭代**，按迭代折叠时每组只有 1 枚
   *   ⇒ 阈值永不触发 ⇒ 无限堆叠。合并规则在 `core/pillmerge.ts`（纯逻辑、可单测）。
   */
  private mergedBlocks(): HistoryIteration[] {
    // ⛔ 派生视图必须**有界**（`perf_frame_bounded_wiring ★D`）：只读持有者的 blocks 并归并
    //   （块数只减不增）。⛔ **不做任何跨容器合并**：live 迭代**永远单独一行**渲染
    //   （用户 2026-10-28 硬性口径：「live iter 永远单独一行；在折叠里渲染 live 太傻逼」）。
    // live 行以**值投递**为准（见 `blocksOverride` 的 P0 注释）；普通行仍走 `@ObjectLink` 持有者。
    const src: HistoryIteration[] = this.blocksOverride.length > 0 ? this.blocksOverride : this.iters.blocks;
    const out: HistoryIteration[] = mergeToolOnlyIterations(src);
    return out;
  }


  /**
   * 组内直出的 pill / 徽标 N / 溢出列表 —— **全部来自同一次 `pillView`**。
   *
   * ⛔ 用户 2026-11-14 P0（「`+N` 的工具列表里的工具是错的，和真实的对不上」）：
   *   旧实现三处各算一遍（直出 = fold 后去重；徽标 = fold 不去重；溢出 = 整块重算再切片）
   *   ⇒ 组里只要有一枚同一调用的残留副本，三处就对不上（数字比列表多、列表里冒出已直出的那枚、
   *   真工具被挤出列表）。`core/streammerge.pillView` 是唯一口径（去重 → 折叠，按 tools 身份记忆化）。
   */
  private groupShownPills(group: ToolProgress[]): ToolProgress[] {
    return pillView(group).shown;
  }

  private groupHideCount(group: ToolProgress[]): number {
    return pillView(group).hideCount;
  }

  /** `+N` 里被收起的工具（打开徽标时按需取它们各自迭代的详情）。 */
  private groupHidden(group: ToolProgress[]): ToolProgress[] {
    return pillView(group).hidden;
  }

  /** 工具在 `it.tools` 里的**原始下标**（pill 唯一键的兜底）。 */
  private origIndex(it: HistoryIteration, t: ToolProgress): number {
    return it.tools !== undefined ? it.tools.indexOf(t) : -1;
  }

  /**
   * 单枚 pill 的浮层开合。
   *
   * ⛔ 与 `toggleOverflow` 同源（用户 2026-11-18：「普通的工具 pill 也有这个问题」）：
   *   `bindPopup` 的子树只构建一次 + 载荷里工具/详情是**打开那一刻**的对象 ⇒ 详情后到也刷不进。
   *   ⇒ 点击时先 `await` 该迭代的详情（页面 → `/api/iteration_detail`），取回后**再**打开；
   *     期间 pill 显示转圈（`popPendingSlot`）。取数失败也照常打开（不阻塞交互）。
   */
  private toggleToolPop(it: HistoryIteration, t: ToolProgress, ti: number): void {
    const key: string = this.pillKeyOf(it, t, ti);
    const slot: string = this.slotOf(it, ti);
    const opening: boolean = this.popAt !== slot;
    if (!opening) {
      this.popKey = '';
      this.popAt = '';
      this.popPendingSlot = '';
      return;
    }
    const want: number = detailIterationOf(t.iteration, it.iteration);
    this.onToggleTool(want, t.name, t.iteration);
    this.popPendingSlot = slot;
    this.onEnsureToolDetailAsync(want, t.name, t.iteration)
      .catch((): void => {
      })
      .then((): void => {
        // ⛔ 严禁轮询（用户 2026-11-18 批注）：`store.fetchIterationDetail` 现在在 `pushEvent` 后
        //   **同步** `rebuildRows()` ⇒ 这里 `mergedBlocks()` 已是最新 ⇒ 直接打开。
        this.popKey = key;
        this.popAt = slot;
        this.popPendingSlot = '';
      });
  }

  /**
   * 在合并块里按 (迭代号, 名字) 找当前那一枚（用于"详情是否已落地"的判定）。
   *
   * ⛔ 用户 2026-11-18：「第一次点开工具还是这样」（只有"输出"、没有参数）：旧实现要求
   *   `bs[i].iteration === iter`，但**合并块的 head 号 ≠ 被合并工具的自带号** ⇒ 永远找不到 ⇒
   *   轮询立即超时 ⇒ 用旧对象打开（第一张截图）。⇒ 改为**遍历全部块、按名字 + 工具自带号匹配**，
   *   工具自带号缺失时只按名字取第一枚（宁可宽松，也不能拿旧对象）。
   */
  private findLiveTool(iter: number, name: string): ToolProgress | undefined {
    const bs: HistoryIteration[] = this.mergedBlocks();
    let loose: ToolProgress | undefined = undefined;
    for (let i = 0; i < bs.length; i++) {
      const ts: ToolProgress[] | undefined = bs[i].tools;
      if (ts === undefined) {
        continue;
      }
      for (let k = 0; k < ts.length; k++) {
        if (ts[k].name !== name) {
          continue;
        }
        // ArkTS 严格性：先把可空收窄成局部确定值，再做三元（否则 number|undefined 不可赋给 number）
        const rawIter: number | undefined = ts[k].iteration;
        const own: number = rawIter !== undefined && rawIter !== null && rawIter > 0 ? rawIter : bs[i].iteration;
        if (iter <= 0 || own === iter) {
          return ts[k];
        }
        if (loose === undefined) {
          loose = ts[k];
        }
      }
    }
    return loose;
  }

  /** 浮层里"当前工具"（按 `popKey` 唯一键从合并后的块里查）。 */
  private popTool(): ToolProgress | undefined {
    if (this.popKey.length === 0) {
      return undefined;
    }
    // ⛔ 必须查 `mergedBlocks()`（**与 pill 渲染同一数据源**）：pill 的键用的是
    //   `origIndex(mergedIt, t)`（合并块 `tools` 数组里的下标），而这里曾查 `iters.blocks`
    //   （原始块，每块 1 枚工具）⇒ 下标错位 ⇒ 查不到 ⇒ 浮层标题退化成「工具」、正文「暂无详情」
    //   （用户 2026-10-28 截图实证）。⛔ 别再改回 `iters.blocks`。
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
    // 兜底：键漂移（老数据/极端竞态）时按 `turn:iter:name` 前缀找回**唯一**匹配；
    // 多枚同名时取第一个（宁可展示近似项，也不能弹「暂无详情」的空壳）。
    const head: string = this.popKey.substring(0, this.popKey.indexOf('#'));
    let hit: ToolProgress | undefined = undefined;
    for (let i = 0; i < bs.length; i++) {
      const it: HistoryIteration = bs[i];
      if (it.tools === undefined) {
        continue;
      }
      for (let k = 0; k < it.tools.length; k++) {
        const t: ToolProgress = it.tools[k];
        const ownIter: number = t.iteration !== undefined && t.iteration !== null && t.iteration > 0
          ? t.iteration : it.iteration;
        if (`${this.toolKey(this.iters.turnID, ownIter, t.name)}` === head) {
          if (hit === undefined) {
            hit = t;
          }
        }
      }
    }
    return hit;
  }

  private popVM(): ToolDetailVM {
    const t: ToolProgress | undefined = this.popTool();
    const color: string = t !== undefined ? statusColorOf(this.toolKind(t), this.themeId()) : this.pal().textMuted;
    const status: string = t !== undefined ? this.toolChip(t) : '';
    return toolDetailVM(t, color, status);
  }

  /**
   * 溢出浮层里的工具列表（被 `+N` 收起的那些）。
   *
   * ⛔ 必须与**徽标同源**：徽标是画在 `mergedBlocks()` 的**合并块**上的（`iteration` = 该段最后
   *   一个迭代），而 `this.iters.blocks` 里同一个 `iteration` 只有**那一枚**工具 ⇒
   *   `foldPills(1)` 的 `hidden` 恒为空 ⇒ **点开是空白浮层**（2026-10-25 用户实测截图）。
   *   ⇒ 取数也走 `mergedBlocks()`，保证"看到的 N" = "展开后的条数"。
   */
  /**
   * 溢出浮层里的工具：**成员 = 打开那一刻捕获的那批**（冻结，避免条数漂移），
   * **对象 = 当前模型里同身份的最新一份**（详情一到就是新的 —— 用户 2026-11-18：
   * 「他早就获取到了，但是你的 ui 不更新」）。
   *
   * ⛔ 关键：详情合并会替换块对象 ⇒  变化 ⇒ 本组件（以及它的 popup 子树）重建 ⇒
   *   这里重新 resolve 就能拿到新对象；若这里返回**冻结的旧对象**，界面就永远停在 loading。
   */
  private overTools(): ToolProgress[] {
    return resolveByKeys(this.blockToolsAll(), this.overList);
  }

  /** 合并块里**全部**工具（跨组；仅用于按身份取最新对象）。 */
  private blockToolsAll(): ToolProgress[] {
    const bs: HistoryIteration[] = this.mergedBlocks();
    const out: ToolProgress[] = [];
    for (let i = 0; i < bs.length; i++) {
      const ts: ToolProgress[] | undefined = bs[i].tools;
      if (ts === undefined) {
        continue;
      }
      for (let k = 0; k < ts.length; k++) {
        out.push(ts[k]);
      }
    }
    return out;
  }

  /**
   * 徽标上显示的 N。
   *
   * ⛔ 用户 2026-11-17：「有时候 `+N` 这个数字 N 会多 1 个」。根因：**浮层内容是打开那一刻
   *   构建的**（ArkUI popup builder 不随外部状态逐帧重建），而徽标数字是每帧重算的 ——
   *   浮层开着的时候有新工具完成/合并块变化 ⇒ 徽标 +1，列表却还是旧的那份 ⇒ 差 1。
   *   ⇒ 浮层打开期间，徽标**显示浮层里那一份的长度**（`overList`），两者恒等；关闭后回到实时值。
   */
  private badgeCount(group: ToolProgress[], it: HistoryIteration, gi: number): number {
    const open: boolean = this.overIter === it.iteration && this.overGroup === gi;
    // ⛔ 只有"这一组浮层确实开着"时才用冻结值（徽标与列表同长）；否则一律实时值 ——
    //   新工具完成 ⇒ 数字立刻 +1（用户 2026-11-18）。
    return open && this.overList.length > 0 ? this.overList.length : this.groupHideCount(group);
  }

  /** 打开浮层时按**被点的那一组**取 hidden（与徽标同一次 `pillView`）。 */
  private captureOverList(): ToolProgress[] {
    const bs: HistoryIteration[] = this.mergedBlocks();
    for (let i = 0; i < bs.length; i++) {
      const it: HistoryIteration = bs[i];
      if (it.iteration !== this.overIter) {
        continue;
      }
      // ⛔ 必须按**被点的那一组**取数（同一合并块里假工具会把组切断）：旧实现按整块
      //   `foldPills(块内全部)` 重算 ⇒ 列表里混进别组的工具 / 与徽标数字对不上
      //   （用户 2026-11-14：「+N 的工具列表里的工具是错的，和真实的对不上」）。
      const groups: ToolProgress[][] = this.toolGroupsOf(it);
      if (this.overGroup < 0 || this.overGroup >= groups.length) {
        return [];
      }
      return pillView(groups[this.overGroup]).hidden;
    }
    return [];
  }

  @Builder
  ToolPopBody() {
    ToolPopoverCard({
      vm: this.popVM(),
      theme: this.themeId(),
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
      onPromote: (callId: string) => {
        return this.onPromoteShell(callId);
      },
    })
  }

  /**
   * `+N` 徽标点击。
   *
   * ⛔ 用户 2026-11-18（两次截图对照）：「第一次打开必须就是第二次打开那张图的样子」。
   *   第二次打开之所以对，是因为它**重新捕获**了数据；第一次打开捕获的是打开瞬間的轻字段。
   *   而 `bindPopup` 的子树一旦构建就**不会再重建**（平台行为，无法靠 @State/@ObjectLink 绕过）
   *   ⇒ 唯一正确做法：**先把这一组的详情取回来（全部 settle），再打开浮层** —— 打开时捕获到的
   *     就是"已经带摘要"的那一批。取数期间徽标显示转圈（`overPending`），不会永久卡住：
   *     `Promise.allSettled` 保证无论成功/失败都会继续打开。
   */
  private toggleOverflow(it: HistoryIteration, gi: number, group: ToolProgress[]): void {
    const same: boolean = this.overIter === it.iteration && this.overGroup === gi;
    if (same) {
      this.overIter = -1;
      this.overGroup = 0;
      this.overList = [];
      this.overPending = false;
      return;
    }
    const hid: ToolProgress[] = pillView(group).hidden;
    this.overPending = true;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < hid.length; i++) {
      const t: ToolProgress = hid[i];
      jobs.push(this.onEnsureToolDetailAsync(detailIterationOf(t.iteration, it.iteration),
        t.name, t.iteration));
    }
    // ⛔ `allSettled` 语义（ArkTS 无此 API ⇒ 逐条 catch）：任何一条失败都不能阻止打开
    const settle: Promise<void>[] = [];
    for (let i = 0; i < jobs.length; i++) {
      settle.push(jobs[i].catch((): void => {
      }));
    }
    Promise.all(settle).then((): void => {
      // ⛔ **等模型落地再打开**（用户 2026-11-18：「第一次打开必须就是第二次打开的样子」）：
      //   `fetchIterationDetail` 的 pushEvent 同步，但**页面行 flush 在下一拍** ⇒ 立刻重新捕获
      //   拿到的仍是旧对象（= 第一张截图）。⇒ 等这一组"已有详情"再捕获/打开，最多 ~120ms。
      // 同上：`rebuildRows()` 已同步 ⇒ 直接按当前块重新捕获并打开（不等待、不轮询）。
      const freshBlocks: HistoryIteration[] = this.mergedBlocks();
      let opened: boolean = false;
      for (let i = 0; i < freshBlocks.length; i++) {
        if (freshBlocks[i].iteration !== it.iteration) {
          continue;
        }
        const gs: ToolProgress[][] = this.toolGroupsOf(freshBlocks[i]);
        this.overIter = it.iteration;
        this.overGroup = gi < gs.length ? gi : 0;
        this.overList = gi < gs.length ? pillView(gs[gi]).hidden : hid;
        this.overPending = false;
        opened = true;
        break;
      }
      if (!opened) {
        this.overIter = it.iteration;
        this.overGroup = gi;
        this.overList = hid;
        this.overPending = false;
      }
    });
  }

  @Builder
  OverflowPopBody() {
    ToolOverflowList({
      tools: this.overTools(),
      theme: this.themeId(),
      onCopy: (text: string, what: string) => {
        this.onCopy(text, what);
      },
      onEnsure: (iter: number, name: string, toolIter?: number): Promise<void> => {
        // 子组件 await 后自增代数刷新自己（popup 子树只认真实状态变化）。
        return this.onEnsureToolDetailAsync(iter, name, toolIter);
      },

    })
  }

  @Builder
  IterationBlock(it: HistoryIteration) {
    Column({ space: BUBBLE.blockInnerGap }) {
      // ── 迭代号标记（开发者设置开关；关 = 完全不渲染，与改造前逐像素一致）──
      if (this.iterBadgeOn) {
      // 目的：真机上一眼看出「哪一块是哪一轮、带几枚工具、是否在飞」，不必依赖日志/重放。
      // 形态：极弱色小字，放在块首、不占独立行高（与思考行同基线附近）。
      Row({ space: SPACE_HAIR }) {
        Text(`#${it.iteration}`)
          .fontSize(typeOf('type.micro').size)
          .fontColor(colorOf(this.pal(), 'iconMuted'))
        if (it.live === true) {
          Text('live')
            .fontSize(typeOf('type.micro').size)
            .fontColor(colorOf(this.pal(), 'accentSoft'))
        }
        if (it.tools !== undefined && it.tools.length > 0) {
          Text(`${it.tools.length}t`)
            .fontSize(typeOf('type.micro').size)
            .fontColor(colorOf(this.pal(), 'iconMuted'))
        }
      }
      .width('100%')
      }
      if (displayReasoning(it).length > 0) {
        ThinkingLine({
          label: `思考 ${runeCount(displayReasoning(it))} 字`,
          body: displayReasoning(it),
          stateKey: reasoningKey(this.iters.turnID, it.iteration),
          theme: this.themeId(),
        })
      }

      if (displayContent(it).length > 0) {
        if (looksLikeLlmError(displayContent(it))) {
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
            onToast: this.onToast,
            fontScale: this.fontScaleV,
            wrapCode: this.wrapCodeV,
            theme: this.themeId(),
            mdTheme: this.mdTheme,
          })
        }
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        ForEach(this.toolGroupsOf(it), (group: ToolProgress[], gi: number) => {
          if (group.length === 1 && isSyntheticToolName(group[0].name)) {
            SyntheticCard({
              tool: group[0],
              theme: this.themeId(),
              onCopy: (text: string, what: string) => {
                this.onCopy(text, what);
              },
            })
          } else {
            if (this.groupShownPills(group).length > 0 || this.badgeCount(group, it, gi) > 0) {
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.groupShownPills(group), (t: ToolProgress, ti: number) => {
                  // 一律等宽（⛔ builder 体内不得声明局部量：ArkTS 10905209）
                  this.ToolItem(it, t, this.origIndex(it, t), false)
                }, (t: ToolProgress, ti: number) => `${this.toolKey(this.iters.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${this.origIndex(it, t)}`
                  + `#${t.status !== undefined ? t.status : ''}#${t.gen_chars !== undefined ? t.gen_chars : 0}`)
                  // ⛔ key 必须含 status/gen_chars（`tool-pill-key` 判据：否则 ForEach 复用旧节点
                  //   ⇒ pending→running 不重绘、字数冻结）。"消失一瞬间"的**真因不是 key**，
                  //   而是模型在分桶帧里把工具丢了（已修：`applyToolTicks` 同迭代内只增不减）。
                if (this.groupHideCount(group) > 0) {
                  Row() {
                    if (this.overPending) {
                      LoadingProgress()
                        .width(BADGE_SPINNER)
                        .height(BADGE_SPINNER)
                        .color(this.pal().textSecondary)
                    } else {
                      Text(`+${this.badgeCount(group, it, gi)}`)
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textSecondary)
                    }
                  }
                    .padding({ left: SP_2, right: SP_2, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
                    .margin(GAP_PILL)
                    .animation(animBase())
                    .backgroundColor(this.overIter === it.iteration && this.overGroup === gi
                      ? surfaceFillOf(this.pal(), 'surface.card') : this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.toggleOverflow(it, gi, group);
                    })                    .bindPopup(this.overIter === it.iteration && this.overGroup === gi, {
                      builder: this.OverflowPopBody,
                      placement: Placement.Bottom,
                      enableArrow: false,
                      mask: false,
                      popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
                      radius: RADIUS_CARD,
                      shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
                      width: POPOVER_W_OVERFLOW,
                      // ⛔ **必须**配套 `onWillDismiss`（用户 2026-11-18：「新工具完成了它数字还是老的，
                      //   我点开后才变对；点一下变一下、再点回来」）：点外部/按返回关闭时若不清 `overIter`，
                      //   `badgeCount()` 会一直认为"浮层还开着"⇒ 数字永远取**冻结的 `overList.length`**。
                      onWillDismiss: (action: DismissPopupAction) => {
                        this.overIter = -1;
                        this.overGroup = 0;
                        this.overList = [];
                        this.overPending = false;
                      },
                    })

                }
              }
              .width('100%')
              .gesture(LongPressGesture().onAction(() => {
                this.onOpenToolsCtx(it.iteration);
              }))
            }
          }
        }, (group: ToolProgress[], gi: number) => `grp#${this.iters.rowID}#${it.iteration}#${gi}`)
      }

      if (it.subAgents !== undefined && it.subAgents.length > 0) {
        SubAgentTree({
          rows: flattenSubAgents(it.subAgents, this.subAgentOpenable),
          theme: this.themeId(),
          onOpen: (k: string) => {
            this.onOpenSubAgent(k);
          },
        })
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .margin({ top: BUBBLE.iterGap })
  }

  @Builder
  ToolItem(it: HistoryIteration, t: ToolProgress, ti: number, wide: boolean) {
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
      this.ToolPillItem(it, t, ti, wide)
    }
  }

  @Builder
  ToolPillItem(it: HistoryIteration, t: ToolProgress, ti: number, wide: boolean) {
    Stack() {
      ToolPill({
        label: this.toolLabelText(t),
        labelSpans: this.toolLabelSpans(t),
        kind: this.toolKind(t),
        chip: this.toolChip(t),
        live: this.toolLive(t),
        selected: this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti),
        pending: this.popPendingSlot.length > 0 && this.popPendingSlot === this.slotOf(it, ti),
        theme: this.themeId(),
      })
      // ⛔ 扫光带**只在真正的 live 块**里画，且**绝不用百分比高度**（2026-10-25 用户再次实测
      //   「cancel 的一瞬间 tool 高度占满整个屏幕」）：
      //   cancel 后这一块被收尸进 `LazyForEach` 列表，而工具状态还没降级成 failed
      //   （`iteration done` 未到 ⇒ `toolLive()` 仍 true）⇒ 原来的 `height('100%')` 在
      //   `ListItem` 的**无界高度约束**里解析（百分比解析的是父级 constraint，不是兄弟 pill 的
      //   实际高度）⇒ 扫光带被拉到一整屏 ⇒ pill 只剩一条色块、高度占满屏幕。
      //   两层收口：① 已提交块里的扫光本是静态装饰（不推进、无信息量）⇒ 不画；
      //            ② 高度改用 token 推导的**确定值**，任何约束下都不会被拉伸。
      if (it.live === true && this.toolLive(t)) {
        Row()
          .width(46).height(typeOf('type.caption').size + 2 * INSET_PILL_Y)
          .linearGradient({ angle: 90, colors: [
            [this.sweepBand().fade, 0.0], [this.sweepBand().core, 0.35],
            [this.sweepBand().sheen, 0.5], [this.sweepBand().core, 0.65], [this.sweepBand().fade, 1.0],
          ] })
          .opacity(0.45)
          // 已提交块里的扫光不推进（运行中那一枚属于 live 块）：恒定相位 = **不加 translate**
          // 就是零位移（原先写 `.translate({ x: 0 })` 是空操作，还引入了裸数字位移面 ——
          // motion_uniform 明确要求位移只能来自底座档常量）。
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .margin(GAP_PILL)
    // ⛔ **一律等宽**（用户 2026-10-28：「首先，工具不等宽了」）：落单的那一枚也保持半宽，
    //   否则同一屏里出现"满宽 + 半宽"两种 pill ⇒ 观感不齐（`wide` 参数保留但恒 false）。
    .width(PILL_HALF_W)
    .clip(true)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.toggleToolPop(it, t, ti);
    })
    .bindPopup(this.popAt.length > 0 && this.popAt === this.slotOf(it, ti), {
      builder: this.ToolPopBody,
      placement: Placement.Bottom,
      enableArrow: false,
      mask: false,
      popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
      radius: RADIUS_CARD,
      shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
      width: POPOVER_W,
      onWillDismiss: (action: DismissPopupAction) => {
        this.popKey = '';
        this.popAt = '';
      },
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onOpenCtx(it.iteration, t.name);
    }))
  }

  build() {
    Column() {
      // ── turn 顶部（第一个迭代之前）的压缩点：`afterIteration === 0` ───────────────
      if (this.compactionsAt(0).length > 0) {
        ForEach(this.compactionsAt(0), (c: WebCompaction, ci: number) => {
          CompactionDividerRow({ body: splitMarker(c.content).body, theme: this.themeId() })
        }, (c: WebCompaction, ci: number) => `${this.iters.rowID}#cpt#head#${ci}`)
      }
      ForEach(this.mergedBlocks(), (it: HistoryIteration) => {
        this.IterationBlock(it)
        if (this.compactionsAt(it.iteration).length > 0) {
          ForEach(this.compactionsAt(it.iteration), (c: WebCompaction, ci: number) => {
            CompactionDividerRow({ body: splitMarker(c.content).body, theme: this.themeId() })
          }, (c: WebCompaction, ci: number) => `${this.iters.rowID}#cpt#${it.iteration}#${ci}`)
        }
        // ⚠️ 键**不含** `rev`：`live_key_stability` 判据要求"稳定身份"（rev 每帧内容变化都自增，
        //   放进键会让每个流式 tick 重建块 ⇒ 与"稳定身份"的既有契约冲突）。同号权威覆盖的
        //   刷新由 `applyRows`/行数据源通知负责，不靠键变化。
      // ⛔ key 必须含**工具数**（用户 2026-10-29 P0：「连续纯工具迭代从 tool2 开始 done 就消失」）：
      //   合并块的 iteration 不变（取 head 号）⇒ 不含工具数时 key 恒定 ⇒ ArkUI ForEach
      //   **不重跑 item builder** ⇒ 新并进来的工具永远不渲染。
      }, (it: HistoryIteration) => `${this.iters.rowID}#${it.iteration}#${it.live === true ? 'L' : 'C'}#${it.tools !== undefined ? it.tools.length : 0}`)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
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
