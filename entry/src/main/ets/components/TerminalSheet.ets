/**
 * TerminalSheet —— **原生终端面板**（2026-10-12，目标④「终端做的很差」的原生落地）。
 *
 * ── 为什么这么做 ─────────────────────────────────────────────────────────────
 * web 的终端 = xterm.js + `useTerminal` + `TerminalPanel`（Dockview 面板）+ `TerminalList`
 * （右栏列表）。原生**不许塞 WebView**（用户已否）⇒
 *   · 光标控制字节流（`\r`/`\x1b[H`/`\x1b[2J`…）由 `core/vt.ets` 的 VT 模拟器解释；
 *   · 线协议（REST + `/ws/terminal`）由 `core/termproto.ets` 负责（键名逐字对齐服务端）；
 *   · 本组件只做**两件事**：把模拟器产物渲染成 `Text`+`Span`；把用户按键/尺寸编码后发出去。
 *
 * ── 数据流 ───────────────────────────────────────────────────────────────────
 *   WS 文本帧 ──parseTermMsg──▶ stdout/stderr 的 b64 ──vtB64ToBytes──▶ `VtTerm.feed`
 *            └─▶（**合并刷新**，≤10fps）`screenLines/scrollbackLines` ──▶ `@State rows`
 *   键盘/快捷键 ──encodeStdin──▶ `{type:'stdin',data:<b64>}` ──▶ WS
 *   视口变化   ──encodeResize─▶ `{type:'resize',cols,rows}` ──▶ WS（+ 模拟器 resize）
 *
 * ⚠️ 合并刷新是**性能刚需**：`yes`/`find /` 会每秒吐几十帧，逐帧 setState 会把 UI 线程打死。
 * ⚠️ 取色 role 只走 `colorOf`（⛔ 写错 role 名 = 运行时静默不可见，见 `docs/DESIGN-SYSTEM.md §12`）。
 */
import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { display } from '@kit.ArkUI';

import { AnsiSpan, ansiFgOf, ansiPaletteOf } from '../core/ansi';
import { VtLine, VtTerm, vtArrowKeys, vtB64ToBytes } from '../core/vt';
import {
  encodeResize, encodeStdin, parseTermMsg, TERM_CLOSE_MSG, TERM_CLOSED, TERM_CONNECTED,
  TERM_CONNECTING, TERM_ERROR, TERM_EXITED, TermMsg, TerminalInfo, terminalStatusRole,
  terminalStatusText, terminalTitle, termWsUrl,
} from '../core/termproto';
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, PRESS_OPACITY, RADIUS_CHIP, RADIUS_PILL, RADIUS_SHEET,
  SHEET_ACTION_GLYPH, SPACE_MD,
  SPACE_SM, SPACE_XS, STROKE_HAIRLINE, surfaceFillOf, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';

/** 渲染上限：scrollback 尾巴 + 屏幕。⛔ 别无限增长（Text 节点数 = 性能）。 */
const TERM_MAX_LINES: number = 200;
/** 合并刷新间隔（ms）：≈10fps，够流畅且不会把 UI 线程打满。 */
const TERM_FLUSH_MS: number = 100;
/**
 * 面板里**非画布**部分的高度（vp）：标题行 + 状态行 + 输入行 + 键行 + 3 个间距。
 * 由 `xbot_phone`（1320×2848）实测标定：画布盒 ≈456vp、整板 ≈690vp ⇒ 其余 ≈202vp。
 * 只用于"视口 ⇒ 行数"；即使略偏，也只是多/少一行，不影响正确性。
 */
const TERM_CHROME_VP: number = 202;

@Component
export struct TerminalSheet {
  /** 主题名（只用于取语义色板）。 */
  @Prop theme: string = 'dark';
  /** 服务端终端 id（`POST /api/terminal/create` 返回的 `tid`）。 */
  @Prop tid: string = '';
  /** 起始工作目录（仅用于标题）。 */
  @Prop cwd: string = '';
  /** 服务端基址（`store.http.baseUrl`），用于拼 `ws://…`。 */
  @Prop baseUrl: string = '';
  /** 会话 Cookie 头（`store.http.cookieHeaderForStream()`）—— WS 与 `/api/*` 同一鉴权。 */
  @Prop cookie: string = '';
  /** 关闭面板（**不**负责删终端；删除走运行面板列表的删除键）。 */
  onClose: () => void = () => {
  };

  @State private status: string = TERM_CONNECTING;
  @State private exitCode: number = -1;
  /** 渲染上限：scrollback 尾巴 + 屏幕（摊平成一个 `Text`，见 `flatSpans`）。 */
  @State private flow: AnsiSpan[] = [];
  @State private input: string = '';
  @State private note: string = '';

  private term: VtTerm = new VtTerm(80, 24);
  private ws: webSocket.WebSocket | null = null;
  private flushTimer: number = -1;
  private dirty: boolean = false;
  private userClosed: boolean = false;
  private scroller: Scroller = new Scroller();
  /** 等宽字宽/行高（vp）——随字号推导，用于"视口 ⇒ 列/行"。 */
  private charW: number = 7.2;
  private lineH: number = 16.5;

  /** 色板记忆化（与 `TaskDetailSheet`/`SelfCheckSheet` 同一形态；属性初始化器只求值一次）。 */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  private palOnce(): Palette {
    const c: Palette | null = this.palCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const fresh: Palette = paletteOf(this.theme);
    this.palCache = fresh;
    this.palThemeCache = this.theme;
    return fresh;
  }

  private fs(): number {
    return typeOf('type.caption').size;
  }

  private headTitle(): string {
    const t: TerminalInfo = new TerminalInfo();
    t.tid = this.tid;
    t.cwd = this.cwd;
    t.createdAt = '';
    return terminalTitle(t);
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────
  aboutToAppear(): void {
    this.fsToMetrics();
    this.applyDisplaySize();
    this.connect();
  }

  aboutToDisappear(): void {
    this.teardown();
  }

  /**
   * 等宽字格尺寸（vp）——由**真机实测标定**（`xbot_phone` 1320×2848）：
   *   `fontSize` 12vp 时实测字宽 ≈7.0vp（比 0.583）、行高 ≈18.4vp（比 1.53）。
   * 这两个比值**只用于"视口 ⇒ 列/行"**，不参与渲染（渲染的 `fontSize` 仍走 `typeOf` 真源）。
   */
  private fsToMetrics(): void {
    const f: number = this.fs();
    this.charW = f * 0.583;
    this.lineH = f * 1.53;
  }

  /** `Area.width/height` 是 `Length`（number|string|Resource）⇒ 一律经此归一化，⛔ 别直接 `Number()`。 */
  private toVp(v: Object): number {
    if (typeof v === 'number') {
      const n: number = v as number;
      return Number.isFinite(n) ? n : 0;
    }
    const n2: number = parseFloat(`${v}`);
    return Number.isFinite(n2) ? n2 : 0;
  }

  /**
   * 首次尺寸：由**屏幕尺寸 × 面板占比**推画布盒（**确定性**，不依赖 `onAreaChange` 是否触发）。
   * 面板 = 94% 宽 × 82% 高（见 `build`）；扣掉自身 padding 与 `TERM_CHROME_VP`。
   */
  private applyDisplaySize(): void {
    let w: number = 0;
    let h: number = 0;
    try {
      const d: display.Display = display.getDefaultDisplaySync();
      w = px2vp(d.width);
      h = px2vp(d.height);
    } catch (e) {
      return;
    }
    if (w <= 0 || h <= 0) {
      return;
    }
    this.applySize(w * 0.94 - 2 * SPACE_MD - 2 * SPACE_XS, h * 0.82 - 2 * SPACE_MD - TERM_CHROME_VP);
  }

  // ── WS ────────────────────────────────────────────────────────────────────
  private connect(): void {
    const url: string = termWsUrl(this.baseUrl, this.tid);
    let ws: webSocket.WebSocket;
    try {
      ws = webSocket.createWebSocket();
    } catch (e) {
      this.status = TERM_ERROR;
      this.note = `createWebSocket 失败`;
      return;
    }
    this.ws = ws;
    this.status = TERM_CONNECTING;

    ws.on('open', (err: BusinessError, value: Object) => {
      this.status = TERM_CONNECTED;
      this.sendResize();
      this.scheduleFlush(true);
    });
    ws.on('message', (err: BusinessError, value: string | ArrayBuffer) => {
      if (typeof value === 'string') {
        this.onData(value as string);
      }
    });
    ws.on('close', (err: BusinessError, value: webSocket.CloseResult) => {
      if (this.status !== TERM_EXITED && this.status !== TERM_ERROR) {
        this.status = this.userClosed ? TERM_CLOSED : TERM_CLOSED;
      }
      this.scheduleFlush(true);
    });
    ws.on('error', (err: BusinessError) => {
      this.status = TERM_ERROR;
      this.note = err.message !== undefined ? err.message : '';
      this.scheduleFlush(true);
    });

    const hdr: Record<string, string> = {};
    if (this.cookie.length > 0) {
      hdr['Cookie'] = this.cookie;
    }
    const opts: webSocket.WebSocketRequestOptions = { header: hdr };
    ws.connect(url, opts, (err: BusinessError, ok: boolean) => {
      if (ok !== true) {
        this.status = TERM_ERROR;
        this.note = err !== undefined && err.message !== undefined ? err.message : '';
        this.scheduleFlush(true);
      }
    });
  }

  private teardown(): void {
    if (this.flushTimer >= 0) {
      clearTimeout(this.flushTimer);
      this.flushTimer = -1;
    }
    const ws: webSocket.WebSocket | null = this.ws;
    this.ws = null;
    if (ws !== null) {
      try {
        ws.close((err: BusinessError, ok: boolean) => {
        });
      } catch (e) {
        // 忽略：关闭路径不应抛到 UI
      }
    }
  }

  private raw(msg: string): void {
    const ws: webSocket.WebSocket | null = this.ws;
    if (ws === null) {
      return;
    }
    try {
      ws.send(msg, (err: BusinessError, ok: boolean) => {
      });
    } catch (e) {
      // 忽略：发送失败由 close/error 事件反映
    }
  }

  private onData(raw: string): void {
    const m: TermMsg = parseTermMsg(raw);
    if (m.kind === 'stdout' || m.kind === 'stderr') {
      this.term.feed(vtB64ToBytes(m.data));
      this.scheduleFlush(false);
      return;
    }
    if (m.kind === 'exit') {
      this.exitCode = m.code;
      this.status = TERM_EXITED;
      this.scheduleFlush(true);
      return;
    }
    if (m.kind === 'error') {
      this.status = TERM_ERROR;
      this.note = m.message;
      this.scheduleFlush(true);
    }
  }

  // ── 合并刷新 ──────────────────────────────────────────────────────────────
  private scheduleFlush(force: boolean): void {
    this.dirty = true;
    if (force) {
      if (this.flushTimer >= 0) {
        clearTimeout(this.flushTimer);
        this.flushTimer = -1;
      }
      this.flush();
      return;
    }
    if (this.flushTimer >= 0) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = -1;
      this.flush();
    }, TERM_FLUSH_MS);
  }

  private flush(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    const pal: Palette = this.palOnce();
    const colors: string[] = ansiPaletteOf(pal);
    const sb: VtLine[] = this.term.scrollbackLines(TERM_MAX_LINES, colors);
    const sc: VtLine[] = this.term.screenLines(colors);
    const all: VtLine[] = sb.concat(sc);
    const cut: VtLine[] = all.length > TERM_MAX_LINES ? all.slice(all.length - TERM_MAX_LINES) : all;
    this.flow = this.flatSpans(cut);
    this.follow();
  }

  /**
   * 若干行 ⇒ 一串 span（行间插一个 `'\n'` span）。
   *
   * ⛔ 为什么摊平：性能预算 ⑦ 的 `ForEach(` 处数是**全仓硬上限**（≤107）⇒ 终端体只允许**一处**
   *   `ForEach`。摊平后整屏就是**一个 `Text`** + N 个 `Span`（节点数比"每行一个 Text"更少）。
   */
  private flatSpans(lines: VtLine[]): AnsiSpan[] {
    const out: AnsiSpan[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        const nl: AnsiSpan = new AnsiSpan();
        nl.text = '\n';
        out.push(nl);
      }
      const ss: AnsiSpan[] = lines[i].spans;
      for (let j = 0; j < ss.length; j++) {
        out.push(ss[j]);
      }
    }
    return out;
  }

  private follow(): void {
    this.scroller.scrollEdge(Edge.Bottom);
  }

  // ── 发送 ──────────────────────────────────────────────────────────────────
  private sendKey(seq: string): void {
    if (this.status !== TERM_CONNECTED) {
      return;
    }
    this.raw(encodeStdin(this.resolveKey(seq)));
  }

  /**
   * 方向键哨兵（`@A`..`@D`）在**发送那一刻**按当前 `DECCKM` 解析 —— ⛔ 不能在 `build()` 时定字节：
   * `@Builder` 的参数是"调用那一刻的快照"，`?1h/l` 变化**不会**重投 ⇒ 会把方向键永久卡在初值
   * （本仓 `@Builder` 快照陷阱，见 `docs/ARKTS-GOTCHAS.md`）。真源 = `vtArrowKeys`（`core/vt.ets`）。
   */
  private resolveKey(seq: string): string {
    if (seq.length === 2 && seq.charAt(0) === '@') {
      return vtArrowKeys(this.term.appCursorKeys, seq.charAt(1));
    }
    return seq;
  }

  private submitInput(): void {
    const t: string = this.input;
    this.input = '';
    if (this.status !== TERM_CONNECTED) {
      return;
    }
    this.raw(encodeStdin(t.length > 0 ? `${t}\r` : '\r'));
  }

  private sendResize(): void {
    this.raw(encodeResize(this.term.cols, this.term.rows));
  }

  /** 视口变化 ⇒ 重算列/行（并告知服务端 PTY，否则 shell 换行错乱）。 */
  private applySize(w: number, h: number): void {
    if (w <= 0 || h <= 0) {
      return;
    }
    const cols: number = Math.max(20, Math.floor(w / this.charW));
    const r: number = Math.max(4, Math.floor(h / this.lineH));
    if (cols === this.term.cols && r === this.term.rows) {
      return;
    }
    this.term.resize(cols, r);
    this.sendResize();
    this.scheduleFlush(true);
  }

  private closeSelf(): void {
    this.userClosed = true;
    this.raw(TERM_CLOSE_MSG);
    this.teardown();
    this.onClose();
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  @Builder
  keyChip(label: string, seq: string) {
    // 命中区：靠**对称竖直 padding** 把盒子顶到 ≥44（判据真源口径：fontSize×1.35 + 2×padY ≥ 44）
    Text(label)
      .fontSize(typeOf('type.caption').size)
      .fontColor(this.palOnce().textSecondary)
      .padding({ left: SPACE_SM, right: SPACE_SM, top: 14, bottom: 14 })
      .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.input'))
      .borderRadius(RADIUS_PILL)
      // 按压反馈：全站唯一口径 `PRESS_OPACITY`（门禁 `interactive_feedback` 硬红要求）
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.sendKey(seq);
      })
  }

  build() {
    Column({ space: SPACE_SM }) {
      // ── 头部：标题 + 状态点 + 尺寸 + 关闭 ──
      Row({ space: SPACE_XS }) {
        Column({ space: 3 }) {
          Text(this.headTitle())
            .fontSize(typeOf('type.subhead').size)
            .fontWeight(typeOf('type.subhead').weight)
            .fontColor(this.palOnce().textPrimary)
            .constraintSize({ maxWidth: '100%' })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Start)
          Row({ space: 6 }) {
            // 状态圆点：用 `Circle()`（ToolPopover 的状态点同款）⇒ ⛔ 零数值 borderRadius。
            Circle()
              .width(8).height(8)
              .fill(colorOf(this.palOnce(), terminalStatusRole(this.status)))
            Text(terminalStatusText(this.status, this.exitCode))
              .fontSize(typeOf('type.micro').size)
              .fontColor(colorOf(this.palOnce(), 'iconMuted'))
            Text(`${this.term.cols}×${this.term.rows}`)
              .fontSize(typeOf('type.micro').size)
              .fontColor(colorOf(this.palOnce(), 'iconMuted'))
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(SHEET_ACTION_GLYPH)
            .fontColor([colorOf(this.palOnce(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .borderRadius(RADIUS_PILL)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('关闭终端')
        .onClick(() => {
          this.closeSelf();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      // ── 终端画布（整屏一个 `Text` + N 个 `Span`；等宽；跟底）──
      Scroll(this.scroller) {
        Text() {
          // ⚠️ 键**必须含内容**：ArkUI `ForEach` 对"键未变"的项**不重建** ⇒ 只按索引做键
          //    会让终端"卡在第一帧"（流式输出到死都不刷新）。这是本仓踩过的同类坑。
          ForEach(this.flow, (sp: AnsiSpan, si: number) => {
            Span(sp.text)
              .fontSize(this.fs())
              .fontFamily('monospace')
              .fontColor(ansiFgOf(sp, this.palOnce().textPrimary))
          }, (sp: AnsiSpan, si: number) => `${si}:${sp.text}`)
        }
        .fontSize(this.fs())
        .fontFamily('monospace')
        .width('100%')
        .textAlign(TextAlign.Start)
        .padding(SPACE_XS)
      }
      .layoutWeight(1)
      .width('100%')
      .align(Alignment.TopStart)
      .scrollBar(BarState.Off)
      .clip(true)
      .backgroundColor(colorOf(this.palOnce(), 'sunken'))
      .borderRadius(RADIUS_CHIP)
      .onAreaChange((oldArea: Area, newArea: Area) => {
        this.applySize(this.toVp(newArea.width), this.toVp(newArea.height));
      })

      if (this.note.length > 0) {
        Text(this.note)
          .fontSize(typeOf('type.micro').size)
          .fontColor(colorOf(this.palOnce(), 'dangerText'))
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

      // ── 输入行 ──
      Row({ space: SPACE_XS }) {
        TextInput({ text: this.input, placeholder: '输入命令，回车发送' })
          .layoutWeight(1)
          .fontSize(this.fs())
          .fontFamily('monospace')
          .fontColor(this.palOnce().textPrimary)
          .placeholderColor(colorOf(this.palOnce(), 'iconMuted'))
          .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.input'))
          .borderRadius(RADIUS_CHIP)
          .enterKeyType(EnterKeyType.Send)
          .enabled(this.status === TERM_CONNECTED)
          .onChange((v: string) => {
            this.input = v;
          })
          .onSubmit(() => {
            this.submitInput();
          })
      }
      .width('100%')

      // ── 常用键（软键盘发不出的控制序列）──
      Scroll() {
        Row({ space: SPACE_XS }) {
          this.keyChip('Ctrl-C', '\x03')
          this.keyChip('Tab', '\t')
          this.keyChip('Esc', '\x1b')
          // 方向键用哨兵 `@<final>`：发送时按 DECCKM 解析（CSI/SS3），见 `resolveKey`
          this.keyChip('↑', '@A')
          this.keyChip('↓', '@B')
          this.keyChip('←', '@D')
          this.keyChip('→', '@C')
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .clip(true)
      .width('100%')
    }
    .width('94%')
    .height('82%')
    .padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
    .borderRadius(RADIUS_SHEET)
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.palOnce()) })
    .alignItems(HorizontalAlign.Start)
    .transition(sheetTransition())
  }
}
