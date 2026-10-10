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

/** 行内最多直出多少个迭代（其余折叠 —— 与页面原有窗口一致）。 */
const MAX_ITER_VISIBLE: number = 8;

@Component
@Reusable
export struct MessageRowView {
  @ObjectLink row: ChatRow;
  @Prop theme: string = 'dark';
  @Prop fontScaleV: number = 1;
  @Prop wrapCodeV: boolean = true;
  /** 运行中工具 pill 的流光位置（页面统一推进 ⇒ 每行不再各开定时器） */
  @Prop sweepX: number = 0;
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

  private itersFor(row: ChatRow): HistoryIteration[] {
    const all: HistoryIteration[] = row.iterations;
    if (this.expandedTurn === row.id || all.length <= MAX_ITER_VISIBLE) {
      return all;
    }
    return all.slice(all.length - MAX_ITER_VISIBLE);
  }

  private hiddenIterCount(row: ChatRow): number {
    if (this.expandedTurn === row.id) {
      return 0;
    }
    return row.iterations.length > MAX_ITER_VISIBLE ? row.iterations.length - MAX_ITER_VISIBLE : 0;
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
      ForEach(this.itersFor(row), (it: HistoryIteration) => {
        this.IterationBlock(row, it)
      }, (it: HistoryIteration) => `${row.id}#${row.rev}-${it.iteration}`)
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
      Text(this.toolIcon(t)).fontSize(11)
        .fontColor(this.toolColor(t))
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
    this.AssistantBlock(this.row)
  }
}
