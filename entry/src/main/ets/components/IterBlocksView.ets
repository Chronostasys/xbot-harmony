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
import { HistoryIteration, IterBlocks, ToolProgress } from '../core/types';
import { WebCompaction } from '../core/chattypes';
import { displayContent, displayReasoning, foldPills, PillSlice } from '../core/streammerge';
import { detailIterationOf } from '../core/toolmerge';
import { runeCount } from '../core/typewriter';
import { Palette, paletteOf, shadowRadiusOf } from '../core/theme';
import { BUBBLE, withAlpha } from '../core/bubble';
import { R_LG, SP_1, SP_2, SP_3, FS_CAPTION, FS_META } from '../core/tokens';
import {
  ELEV_OVERLAY, GAP_PILL, INSET_PILL_Y, PILL_MAX_W, POPOVER_W, POPOVER_W_OVERFLOW,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_FULL, SPACE_HAIR, colorOf, elevationColorOf, surfaceFillOf,
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
/** 共享空锚定表（无压缩行 ⇒ 零分配、零渲染；调用方只读）。 */
const NO_ANCHORS: Map<number, WebCompaction[]> = new Map();

@Component
export struct IterBlocksView {
  /** 已完成块列表 + 归属身份（只在块真正变化时替换 ⇒ 本组件零重建）。 */
  @ObjectLink iters: IterBlocks;
  /** 显式主题覆盖（测试/独立预览） */
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
  /** 当前打开 "+N" 溢出的迭代号（-1 = 无）。 */
  @State overIter: number = -1;
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

  /** 单枚 pill 的唯一键（`call_id` 优先，缺省用同迭代内原始下标兜底）。 */
  private pillKeyOf(it: HistoryIteration, t: ToolProgress, idx: number): string {
    const cid: string = t.call_id !== undefined && t.call_id.length > 0 ? t.call_id : `idx${idx}`;
    return `${this.toolKey(this.iters.turnID, it.iteration, t.name)}#${cid}`;
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

  /** 按原始顺序分组：连续真工具 → 一组；合成工具 → 单独一组。 */
  private toolGroupsOf(it: HistoryIteration): ToolProgress[][] {
    const all: ToolProgress[] = it.tools !== undefined ? it.tools : [];
    const groups: ToolProgress[][] = [];
    let current: ToolProgress[] = [];
    for (let i = 0; i < all.length; i++) {
      if (isSyntheticToolName(all[i].name)) {
        if (current.length > 0) { groups.push(current); current = []; }
        groups.push([all[i]]);
      } else {
        current.push(all[i]);
      }
    }
    if (current.length > 0) { groups.push(current); }
    return groups;
  }

  /** 真工具组内直出的 pill（foldPills 作用于单组）。 */
  private groupShownPills(group: ToolProgress[]): ToolProgress[] {
    return foldPills(group).shown;
  }

  private groupHideCount(group: ToolProgress[]): number {
    return foldPills(group).hideCount;
  }

  /** `+N` 里被收起的工具（打开徽标时按需取它们各自迭代的详情）。 */
  private groupHidden(group: ToolProgress[]): ToolProgress[] {
    const shown: number = foldPills(group).shown.length;
    const out: ToolProgress[] = [];
    for (let i = shown; i < group.length; i++) {
      out.push(group[i]);
    }
    return out;
  }

  /** 工具在 `it.tools` 里的**原始下标**（pill 唯一键的兜底）。 */
  private origIndex(it: HistoryIteration, t: ToolProgress): number {
    return it.tools !== undefined ? it.tools.indexOf(t) : -1;
  }

  /** 同一迭代内被 `+N` 收起的 pill。 */
  private hiddenPills(it: HistoryIteration): ToolProgress[] {
    const all: ToolProgress[] = it.tools !== undefined ? it.tools : [];
    const real: ToolProgress[] = [];
    for (let i = 0; i < all.length; i++) {
      if (!isSyntheticToolName(all[i].name)) { real.push(all[i]); }
    }
    const slice: PillSlice = foldPills(real);
    return slice.hidden;
  }

  /** 浮层里"当前工具"（按 `popKey` 唯一键从合并后的块里查）。 */
  private popTool(): ToolProgress | undefined {
    if (this.popKey.length === 0) {
      return undefined;
    }
    const bs: HistoryIteration[] = this.iters.blocks;
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

  private popVM(): ToolDetailVM {
    const t: ToolProgress | undefined = this.popTool();
    const color: string = t !== undefined ? statusColorOf(this.toolKind(t), this.themeId()) : this.pal().textMuted;
    const status: string = t !== undefined ? this.toolChip(t) : '';
    return toolDetailVM(t, color, status);
  }

  /** 溢出浮层里的工具列表（被 `+N` 收起的那些）。 */
  private overTools(): ToolProgress[] {
    const bs: HistoryIteration[] = this.iters.blocks;
    for (let i = 0; i < bs.length; i++) {
      if (bs[i].iteration === this.overIter) {
        return this.hiddenPills(bs[i]);
      }
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

  @Builder
  IterationBlock(it: HistoryIteration) {
    Column({ space: BUBBLE.blockInnerGap }) {
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
            if (this.groupShownPills(group).length > 0 || this.groupHideCount(group) > 0) {
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.groupShownPills(group), (t: ToolProgress, ti: number) => {
                  this.ToolItem(it, t, this.origIndex(it, t))
                }, (t: ToolProgress, ti: number) => `${this.toolKey(this.iters.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${this.origIndex(it, t)}`
                  + `#${t.status !== undefined ? t.status : ''}#${t.gen_chars !== undefined ? t.gen_chars : 0}`)
                if (this.groupHideCount(group) > 0) {
                  Row() {
                    Text(`+${this.groupHideCount(group)}`)
                      .fontSize(FS_CAPTION)
                      .fontColor(this.pal().textSecondary)
                  }
                    .padding({ left: SP_2, right: SP_2, top: INSET_PILL_Y, bottom: INSET_PILL_Y })
                    .margin(GAP_PILL)
                    .animation(animBase())
                    .backgroundColor(this.overIter === it.iteration ? surfaceFillOf(this.pal(), 'surface.card') : this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      this.overIter = this.overIter === it.iteration ? -1 : it.iteration;
                      // ⛔ 断点 C（web `ToolCardGated` 同义）：`+N` 里是**轻字段**（folded 详情未下发）
                      //   ⇒ 打开列表前先按"工具自己的号"逐迭代取详情，否则每行都显示「暂无详情」。
                      const hid: ToolProgress[] = this.groupHidden(group);
                      if (hid.length > 0) {
                        this.onToggleTool(detailIterationOf(hid[0].iteration, it.iteration), hid[0].name, hid[0].iteration);
                      }
                    })
                    .bindPopup(this.overIter === it.iteration, {
                      builder: this.OverflowPopBody,
                      placement: Placement.Bottom,
                      enableArrow: false,
                      mask: false,
                      popupColor: surfaceFillOf(this.pal(), 'surface.overlay'),
                      radius: RADIUS_CARD,
                      shadow: { radius: shadowRadiusOf(this.pal(), 'overlay'), color: elevationColorOf(this.pal(), ELEV_OVERLAY), offsetX: 0, offsetY: 0 },
                      width: POPOVER_W_OVERFLOW,
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
      ToolPill({
        label: this.toolLabelText(t),
        labelSpans: this.toolLabelSpans(t),
        kind: this.toolKind(t),
        chip: this.toolChip(t),
        live: this.toolLive(t),
        selected: this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti),
        theme: this.themeId(),
      })
      if (this.toolLive(t)) {
        Row()
          .width(46).height('100%')
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
    .constraintSize({ maxWidth: PILL_MAX_W })
    .clip(true)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onToggleTool(detailIterationOf(t.iteration, it.iteration), t.name, t.iteration);
      const key: string = this.pillKeyOf(it, t, ti);
      this.popKey = this.popKey === key ? '' : key;
    })
    .bindPopup(this.popKey.length > 0 && this.popKey === this.pillKeyOf(it, t, ti), {
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
      ForEach(this.iters.blocks, (it: HistoryIteration) => {
        this.IterationBlock(it)
        if (this.compactionsAt(it.iteration).length > 0) {
          ForEach(this.compactionsAt(it.iteration), (c: WebCompaction, ci: number) => {
            CompactionDividerRow({ body: splitMarker(c.content).body, theme: this.themeId() })
          }, (c: WebCompaction, ci: number) => `${this.iters.rowID}#cpt#${it.iteration}#${ci}`)
        }
        // ⚠️ 键**不含** `rev`：`live_key_stability` 判据要求"稳定身份"（rev 每帧内容变化都自增，
        //   放进键会让每个流式 tick 重建块 ⇒ 与"稳定身份"的既有契约冲突）。同号权威覆盖的
        //   刷新由 `applyRows`/行数据源通知负责，不靠键变化。
      }, (it: HistoryIteration) => `${this.iters.rowID}#${it.iteration}#${it.live === true ? 'L' : 'C'}`)
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
