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
import { displayContent, displayReasoning, rowIsEmpty } from '../core/streammerge';
import { runeCount } from '../core/typewriter';
import { Palette, paletteOf } from '../core/theme';
import { MarkdownView } from './MarkdownView';
import { LiveTailView } from './LiveTailView';

/** 行内最多直出多少个迭代（其余折叠 —— 与页面原有窗口一致）。 */
const MAX_ITER_VISIBLE: number = 8;

@Component
export struct MessageRowView {
  @ObjectLink row: ChatRow;
  @Prop theme: string = 'dark';
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
  onImage: (src: string) => void = (src: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  onLoadMoreRegions: () => void = () => {
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
  @State openToolKey: string = '';
  @State expandedTurn: string = '';

  private pal(): Palette {
    return paletteOf(this.theme);
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

  private toolIcon(t: ToolProgress): string {
    if (t.status === 'generating') {
      return '◐';
    }
    if (t.status === 'running') {
      return '●';
    }
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return '✗';
    }
    if (t.status === 'pending') {
      return '○';
    }
    return '✓';
  }

  private toolColor(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    return this.pal().textSecondary;
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

  /** 已完成迭代（排除在飞块）—— 在飞块由 `LiveIterationBlock`（@Prop 直驱）单独渲染。 */
  private completedIters(row: ChatRow): HistoryIteration[] {
    const out: HistoryIteration[] = [];
    for (let i = 0; i < row.iterations.length; i++) {
      if (row.iterations[i].live !== true) {
        out.push(row.iterations[i]);
      }
    }
    return out;
  }

  private itersFor(row: ChatRow): HistoryIteration[] {
    const all: HistoryIteration[] = this.completedIters(row);
    if (this.expandedTurn === row.id || all.length <= MAX_ITER_VISIBLE) {
      return all;
    }
    return all.slice(all.length - MAX_ITER_VISIBLE);
  }

  private hiddenIterCount(row: ChatRow): number {
    if (this.expandedTurn === row.id) {
      return 0;
    }
    const total: number = this.completedIters(row).length;
    return total > MAX_ITER_VISIBLE ? total - MAX_ITER_VISIBLE : 0;
  }

  /** 在飞内容是否非空（@Prop 直驱 —— 与页面 `syncLiveTail` 的派生同源）。 */
  private hasLiveContent(): boolean {
    return this.liveText.length > 0 || this.liveReasoning.length > 0 || this.liveTools.length > 0;
  }

  @Builder
  AssistantBlock(row: ChatRow) {
    Column({ space: 6 }) {
      if (row.content.length > 0 && row.iterations.length === 0) {
        MarkdownView({
          text: row.content,
          onImage: (src: string) => {
            this.onImage(src);
          },
          loadImage: (src: string) => {
            return this.loadImage(src);
          },
          fontScale: this.fontScaleV,
          wrapCode: this.wrapCodeV,
          theme: this.theme,
        })
      }
      // 服务端折叠视图：更早的展示区域需按需取回（与 Web 端「⌃ 更早的 N 个区域」同源）
      if (row.regionsBefore > 0) {
        Row({ space: 6 }) {
          Text(`⌃ 更早的 ${row.regionsBefore} 个区域`).fontSize(11).fontColor(this.pal().warn)
          Text('（点击加载）').fontSize(11).fontColor(this.pal().textMuted)
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.onLoadMoreRegions();
        })
      }
      if (this.hiddenIterCount(row) > 0) {
        Row({ space: 6 }) {
          Text(`↑ 已折叠更早的 ${this.hiddenIterCount(row)} 个迭代`)
            .fontSize(11).fontColor(this.pal().accentSoft)
          Text('（点击展开全部）').fontSize(11).fontColor(this.pal().textMuted)
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.expandedTurn = row.id;
        })
      }
      // 已完成迭代（稳定 key：不随 rev 抖 —— 内容变化靠 @ObjectLink 就地更新，
      // 打字机块才能跨帧存活）。在飞块由下方 LiveIterationBlock 单独渲染。
      // ⛔ key 必须含 `live` 标记：在飞块可能与某个**已提交迭代同号**（服务端把
      //   在飞迭代记进 iteration_history 的场景 —— 见 core/render.ets.inFlightBlock），
      //   只按 `row.id#iteration` 会撞 key ⇒ ArkUI 复用错位（渲染错乱）。
      ForEach(this.itersFor(row), (it: HistoryIteration) => {
        this.IterationBlock(row, it)
      }, (it: HistoryIteration) => `${row.id}#${it.iteration}#${it.live === true ? 'L' : 'C'}`)
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
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.pal().surface)
    .borderRadius(14)
    .border({ width: 1, color: this.pal().border })
    .shadow({ radius: 10, color: '#14000000', offsetX: 0, offsetY: 2 })
    .margin({ top: 4, bottom: 4 })
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
    Column({ space: 6 }) {
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
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  IterationBlock(row: ChatRow, it: HistoryIteration) {
    Column({ space: 6 }) {
      // web 形态：**没有"迭代 N"这种标题**，只有一条可展开的「思考 N 字」
      if (displayReasoning(it).length > 0) {
        Row({ space: 6 }) {
          Text('✳').fontSize(11).fontColor(this.pal().textMuted)
          Text(`思考 ${runeCount(displayReasoning(it))} 字`)
            .fontSize(11).fontColor(this.pal().textSecondary)
          Text(this.openReasonKey === `${row.id}-${it.iteration}` ? '▾' : '▸')
            .fontSize(11).fontColor(this.pal().textMuted)
        }
        .padding({ top: 2, bottom: 2 })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          const key: string = `${row.id}-${it.iteration}`;
          this.openReasonKey = this.openReasonKey === key ? '' : key;
        })
      }

      if (displayReasoning(it).length > 0
        && this.openReasonKey === `${row.id}-${it.iteration}`) {
        Text(displayReasoning(it))
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(13).fontColor(this.pal().textSecondary).padding(8).width('100%')
          .backgroundColor(this.pal().surface).borderRadius(8)
          .copyOption(CopyOptions.LocalDevice)
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
        })
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(it.tools, (t: ToolProgress) => {
            this.ToolPill(row, it, t)
          }, (t: ToolProgress, ti: number) => `${this.toolKey(row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${ti}`)
        }
        .width('100%')
      }

      // 工具详情（点击 pill 展开）
      if (this.openToolKey.startsWith(`${row.turnID}:${it.iteration}:`) && it.tools !== undefined) {
        ForEach(it.tools, (t: ToolProgress) => {
          if (this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name)) {
            this.ToolDetail(t)
          }
        }, (t: ToolProgress, ti: number) => `d-${this.toolKey(row.turnID, it.iteration, t.name)}#${ti}`)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 4 })
  }

  @Builder
  ToolPill(row: ChatRow, it: HistoryIteration, t: ToolProgress) {
    Stack() {
      Row({ space: 4 }) {
      if (t.status === 'generating' || t.status === 'running') {
        // 原生指示器（会动）。之前用静态字符 "◐" —— 既不动、也是 TUI 观感（用户明确否掉）
        LoadingProgress().width(13).height(13).color(this.toolColor(t))
      } else {
        Text(this.toolIcon(t)).fontSize(11)
          .fontColor(this.toolColor(t))
      }
      Text(this.toolLabel(t))
        .fontSize(12)
        .fontColor(this.toolColor(t))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: 200 })
    }
    .padding({ left: 8, right: 8, top: 5, bottom: 5 })
    .margin(3)
      // 运行中：一道流光扫过（纯 transform ⇒ 不触发布局，触屏也稳）
      if (t.status === 'running' || t.status === 'generating') {
        Row()
          .width(46).height('100%')
          .linearGradient({ angle: 90, colors: [
            [this.pal().accentSoftFade, 0.0], [this.pal().accentSoft, 0.5], [this.pal().accentSoftFade, 1.0],
          ] })
          .opacity(0.35)
          .translate({ x: this.sweepX })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .clip(true)
    .backgroundColor(this.pal().surfaceAlt)
    .borderRadius(6)
    .border({ width: 1, color: this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name) ? this.pal().accent : this.pal().border })
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onToggleTool(it.iteration, t.name);
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onOpenCtx(it.iteration, t.name);
    }))
  }

  @Builder
  ToolDetail(t: ToolProgress) {
    Column({ space: 4 }) {
      if (t.summary !== undefined && t.summary.length > 0) {
        Text(t.summary).fontSize(12).fontColor(this.pal().textSecondary).width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      if (t.args !== undefined && t.args.length > 0) {
        Text('参数').fontSize(10).fontColor(this.pal().textMuted)
        Text(t.args)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textPrimary).fontFamily('monospace')
          .width('100%').padding(6).backgroundColor(this.pal().surfaceAlt).borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if (t.detail !== undefined && t.detail.length > 0) {
        Text('输出').fontSize(10).fontColor(this.pal().textMuted)
        Text(t.detail)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textPrimary).fontFamily('monospace')
          .width('100%').padding(6).backgroundColor(this.pal().surfaceAlt).borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if ((t.summary === undefined || t.summary.length === 0)
        && (t.args === undefined || t.args.length === 0)
        && (t.detail === undefined || t.detail.length === 0)) {
        Text('（详情加载中或该工具无详情）').fontSize(11).fontColor(this.pal().textMuted)
      }
      if (t.elapsed_ms !== undefined) {
        Text(`耗时 ${t.elapsed_ms} ms`).fontSize(10).fontColor(this.pal().textMuted)
      }
    }
    .width('100%').padding(8).backgroundColor(this.pal().surface).borderRadius(8)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    if (!this.isEmptyBubble()) {
      this.AssistantBlock(this.row)
    }
  }
}
