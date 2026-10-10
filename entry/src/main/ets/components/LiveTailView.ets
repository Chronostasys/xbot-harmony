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
import { Palette, paletteOf } from '../core/theme';
import { MarkdownView } from './MarkdownView';

@Component
export struct LiveTailView {
  /** 已收到的正文（流式累积；未裁剪） */
  @Prop @Watch('onSource') text: string = '';
  /** 已收到的思考 */
  @Prop @Watch('onSource') reasoning: string = '';
  @Prop tools: ToolProgress[] = [];
  @Prop theme: string = 'dark';
  @Prop fontScale: number = 1;
  @Prop wrapCode: boolean = true;
  onImage: (src: string) => void = (src: string) => {
  };
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  onToolLongPress: (name: string) => void = (name: string) => {
  };

  @State vis: number = 0;
  @State visReason: number = 0;
  @State reasonOpen: boolean = false;
  @State openTool: string = '';
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

  private typingReason(): boolean {
    return this.reasonOpen && isTyping(this.visReason, this.reasonRunes.length);
  }

  private syncTimer(): void {
    const on: boolean = this.liveNow() && (this.typingText() || this.typingReason());
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

  /** 「还在跑」的判据：正文/思考还没追平，或工具里还有非终态。 */
  private liveNow(): boolean {
    for (let i = 0; i < this.tools.length; i++) {
      const st: string = this.tools[i].status !== undefined ? this.tools[i].status as string : '';
      if (st === 'running' || st === 'generating' || st === 'pending') {
        return true;
      }
    }
    return false;
  }

  private stopTimer(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private tick(): void {
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

  private icon(t: ToolProgress): string {
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

  private color(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    return this.pal().textSecondary;
  }

  private label(t: ToolProgress): string {
    const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
    const b: string = this.badge(t);
    return b.length > 0 ? `${base} ${b}` : base;
  }

  build() {
    Column({ space: 6 }) {
      if (this.reasoning.length > 0) {
        Row({ space: 6 }) {
          Text('✳').fontSize(11).fontColor(this.pal().textMuted)
          Text(`思考 ${runeCount(this.reasoning)} 字`).fontSize(11).fontColor(this.pal().textSecondary)
          Text(this.reasonOpen ? '▾' : '▸').fontSize(11).fontColor(this.pal().textMuted)
        }
        .padding({ top: 2, bottom: 2 })
        .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.reasonOpen = !this.reasonOpen;
          this.syncTimer();
        })
      }
      if (this.reasonOpen && this.reasoning.length > 0) {
        Text(this.shownReason())
          .width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor(this.pal().textSecondary).padding(8)
          .backgroundColor(this.pal().surfaceAlt).borderRadius(8)
          .copyOption(CopyOptions.LocalDevice)
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
          })
          if (this.typingText() || this.typingReason()) {
            Text('▍').fontSize(14).fontColor(this.pal().accent)
              .opacity(this.caretOn ? 1 : 0.2)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      if (this.tools.length > 0) {
        Column({ space: 4 }) {
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.tools, (t: ToolProgress, i: number) => {
              Stack() {
                Row({ space: 4 }) {
                  Text(this.icon(t)).fontSize(11).fontColor(this.color(t))
                  Text(this.label(t)).fontSize(12).fontColor(this.color(t))
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .padding({ left: 8, right: 8, top: 5, bottom: 5 })
              }
              // 硬约束宽度：生成中的 label 是**流式参数**（可能几百字符），
              // 不给上限就会撑得比屏幕还长（真机铁证）
              .constraintSize({ maxWidth: 240 })
              .margin(3)
              .clip(true)
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(6)
              .border({ width: 1, color: this.pal().border })
              .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.openTool = this.openTool === t.name ? '' : (t.name !== undefined ? t.name : '');
              })
              .gesture(LongPressGesture().onAction(() => {
                this.onToolLongPress(t.name);
              }))
            }, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.status}`)
          }
          .width('100%')
        }
        .width('100%')
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.pal().surface).borderRadius(14)
    .border({ width: 1, color: this.pal().border })
    .margin({ top: 4, bottom: 4 })
  }
}
