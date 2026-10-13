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

import { AnsiSpan, ansiBgOf, ansiFgOf, ansiPaletteOf } from '../core/ansi';
import { ctrlLetterByte, VtLine, VtTerm, vtArrowKeys, vtB64ToBytes } from '../core/vt';
// 「跟随底部」的纯逻辑（与消息列表**同一真源**，⛔ 不在这里重写一套）
import { followAfterScrollStop } from '../core/listfollow';
import {
  encodeResize, encodeStdin, parseTermMsg, TERM_CLOSE_MSG, TERM_CLOSED, TERM_CONNECTED,
  TERM_CONNECTING, TERM_ERROR, TERM_EXITED, TermMsg, TerminalInfo, terminalHeadTitle, terminalStatusRole,
  terminalStatusText, terminalTitle, termWsUrl,
} from '../core/termproto';
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, PRESS_OPACITY, RADIUS_CHIP, RADIUS_PILL, RADIUS_SHEET,
  SHEET_ACTION_GLYPH, SPACE_MD,
  SHEET_WIDTH, SPACE_SM, SPACE_XS, STROKE_HAIRLINE, surfaceFillOf, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';

/** 渲染上限：scrollback 尾巴 + 屏幕。⛔ 别无限增长（Text 节点数 = 性能）。 */
const TERM_MAX_LINES: number = 200;
/** 合并刷新间隔（ms）：≈10fps，够流畅且不会把 UI 线程打满。 */
const TERM_FLUSH_MS: number = 100;
/**
 * 键芯片水平内边距（vp）。**必须**保证一行 8 枚键在 `xbot_phone`（1320px）上放得下 ——
 * 否则末枚（`→` / `-`）会被 `Scroll` 视口裁掉（真机实测：`SPACE_SM`=12 时行内容 ≈1348px > 可用 1128px）。
 * 竖直内边距仍走 14 ⇒ 命中盒 ≥44（`HIT_TARGET_MIN` 口径：fontSize×1.35 + 2×padY）。
 */
const KEY_PAD_X: number = 6;
/**
 * 键帽**统一最小宽度**（vp）：单字符键（`↑`/`~`/`|`/`C`）否则只有 ~20vp，
 * 与 `Ctrl-C` 并排时一宽一窄像"掉字"。44 = Apple HIG 最小命中，键帽据此对齐成"键盘感"。
 */
const KEY_MIN_W: number = 44;
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
  /** `Ctrl` 修饰键开关（对齐 web `TerminalPanel` 的 `ctrlActive`）：开启后第二行换成 Ctrl 组合字母。 */
  @State private ctrlActive: boolean = false;

  private term: VtTerm = new VtTerm(80, 24);
  private ws: webSocket.WebSocket | null = null;
  private flushTimer: number = -1;
  private dirty: boolean = false;
  private userClosed: boolean = false;
  /**
   * 是否跟随新输出（`flush()` 只在 true 时才 `scrollEdge(Bottom)`）。
   *
   * ⛔ 为什么要闸门（用户 2026-10-12 长期要求 #2「绝不能人机对抗」）：旧实现 `flush()` **无条件**
   *    跟底 ⇒ 用户往上翻看历史时，**每来一行输出就把视角拽回底部** ⇒ 根本读不了日志。
   *    语义与消息列表**同一真源** `core/listfollow`：用户一动手 ⇒ 暂停；滚回**贴底** ⇒ 恢复。
   */
  @State followBottom: boolean = true;
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

  /** 图标弱色：⛔ 必须走 `colorOf`（`iconMuted` 是**计算型 role**，不是 `Palette` 字段）。 */
  private iconMutedC(): string {
    return colorOf(this.palOnce(), 'iconMuted');
  }

  /** 正文色（终端画布 spans / 标题 / 输入框共用）——取色记忆化入口，避免多处重复读板。 */
  private textPrimaryC(): string {
    return this.palOnce().textPrimary;
  }

  /**
   * 终端画布**真实底色** —— 既是画布 `Scroll` 的 `backgroundColor`，也是 ANSI 取色的默认背景
   * `defBg`（⛔ 不能传 `transparent`：反色（SGR 7）会把它当作"字色" ⇒ 文字透明不可见）。
   */
  private canvasBgC(): string {
    return colorOf(this.palOnce(), 'sunken');
  }

  private fs(): number {
    return typeOf('type.caption').size;
  }

  private headTitle(): string {
    const t: TerminalInfo = new TerminalInfo();
    t.tid = this.tid;
    t.cwd = this.cwd;
    t.createdAt = '';
    return terminalHeadTitle(t);
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
        // ⛔ 反例（2026-10-13 修）：曾写 `this.userClosed ? TERM_CLOSED : TERM_CLOSED` ——
        //    三元两侧同值 ⇒ `userClosed` 是**死标志**，且"意外断开"（网络掉线 / 服务端杀 PTY
        //    而**未**先发 `exit`）被误报成「已关闭」（像用户自己关的）。正确：只有用户主动关
        //    才 `closed`；否则 `error`（「连接失败」）——`userClosed` 由此真正有判别力。
        this.status = this.userClosed ? TERM_CLOSED : TERM_ERROR;
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
    // ⛔ **不无条件跟底**：用户上翻读历史时若每来一行就 `scrollEdge(Bottom)` ⇒ 根本读不了
    //    （"人机对抗"，用户长期要求 #2）。暂停/恢复判据走 `core/listfollow`（与消息列表同源）。
    if (this.followBottom) {
      this.follow();
    }
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

  /**
   * 键帽取色 —— **单一取色点**（`role` ∈ `text` / `bg` / `border`）。
   *
   * ⚠️ 为什么收成一个方法：性能预算 **B 线（`this.pal()` ∨ `this.palOnce()` 调用点总数）顶格 1350、
   *    只许减不许增**。两个键 builder 各有 3 个 role，逐处直写 = **6 个调用点**；本方法体只取一次色
   *    ⇒ 净 −4。⛔ 别为了"看着直白"再散回各 builder（会顶穿预算 —— 本轮实测 +3 ⇒ 1353 **真红**）。
   * ⚠️ `role` 是**本方法私有**的判别串（⛔ 不是 `colorOf` 的角色名）：三支分别落到
   *    `colorOf(...'textSecondary'|'onAccent'|'accent')`、`surfaceFillOf(..., 'surface.input')`、`hairlineOf`。
   */
  private keyRoleColor(active: boolean, role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'border') {
      return active ? colorOf(p, 'accent') : hairlineOf(p);
    }
    if (role === 'bg') {
      return active ? colorOf(p, 'accent') : surfaceFillOf(p, 'surface.input');
    }
    return colorOf(p, active ? 'onAccent' : 'textSecondary');
  }

  @Builder
  keyChip(label: string, seq: string) {
    // 命中区：靠**对称竖直 padding** 把盒子顶到 ≥44（判据真源口径：fontSize×1.35 + 2×padY ≥ 44）
    Text(label)
      .fontSize(typeOf('type.caption').size)
      .fontColor(this.keyRoleColor(false, 'text'))
      .padding({ left: KEY_PAD_X, right: KEY_PAD_X, top: 14, bottom: 14 })
      // ⚠️ 2026-10-12（目标③/④「终端做的很差」真机取证）：**浅色主题下 `surface.input` 填充
      //    与面板底 `surface.overlay` 近乎同色 ⇒ 键帽完全看不见、整排退化成"裸文本"**
      //    （深色主题因明暗差才勉强可辨）。设计系统原则：**浅色系靠结构性发丝立边**
      //    （与输入面 `.border(hairline)` 同一处置）⇒ 每个键补一条发丝边，键帽才成立。
      .backgroundColor(this.keyRoleColor(false, 'bg'))
      .border({ width: STROKE_HAIRLINE, color: this.keyRoleColor(false, 'border') })
      .borderRadius(RADIUS_PILL)
      // 统一最小键宽：`↑`/`~`/`|` 这类单字符键否则只有 ~20vp，与 `Ctrl-C` 并排像"掉字"。
      // 键区在水平 `Scroll` 内 ⇒ 溢出只滚动、不挤压。
      .constraintSize({ minWidth: KEY_MIN_W })
      .textAlign(TextAlign.Center)
      // 按压反馈：全站唯一口径 `PRESS_OPACITY`（门禁 `interactive_feedback` 硬红要求）
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.sendKey(seq);
      })
  }

  /**
   * `Ctrl` 修饰键开关（对齐 web `TerminalPanel` 的 `ctrlActive`）。
   * ⛔ **无参** builder 读 `this.ctrlActive`：`@Builder` 的参数是"调用那一刻的快照"，把开关态
   * 当参数传 ⇒ 芯片会永久卡在初值（本仓 `@Builder` 快照陷阱）。无参读 `this` 才会随 `@State` 刷新。
   */
  @Builder
  ctrlChip() {
    Text(this.ctrlActive ? 'Ctrl ✓' : 'Ctrl')
      .fontSize(typeOf('type.caption').size)
      .fontColor(this.keyRoleColor(this.ctrlActive, 'text'))
      .padding({ left: KEY_PAD_X, right: KEY_PAD_X, top: 14, bottom: 14 })
      .backgroundColor(this.keyRoleColor(this.ctrlActive, 'bg'))
      // 同上：未激活时也要有发丝边才看得见键帽（激活态是实心 accent ⇒ 自带对比，不必描边）。
      .border({ width: STROKE_HAIRLINE, color: this.keyRoleColor(this.ctrlActive, 'border') })
      .borderRadius(RADIUS_PILL)
      .constraintSize({ minWidth: KEY_MIN_W })
      .textAlign(TextAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.ctrlActive = !this.ctrlActive;
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
            .fontColor(this.textPrimaryC())
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
              .fontColor(this.iconMutedC())
            Text(`${this.term.cols}×${this.term.rows}`)
              .fontSize(typeOf('type.micro').size)
              .fontColor(this.iconMutedC())
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
              .fontColor(ansiFgOf(sp, this.textPrimaryC(), this.canvasBgC()))
              // ANSI **背景**（`\x1b[48;…m` / 反色 SGR 7）：以前只画前景 ⇒ vim/htop/less 这类
              // 全屏 TUI 与反色高亮全部花屏。默认背景 = 画布真实底色（反色时才 swap 得对）。
              // ⚠️ 需要在 `Span` 上用 `textBackgroundStyle`（Span 无 `backgroundColor`；同 `ToolPopover`）。
              .textBackgroundStyle({ color: ansiBgOf(sp, this.textPrimaryC(), this.canvasBgC()) })
          }, (sp: AnsiSpan, si: number) => `${si}:${sp.fg}:${sp.bg}:${sp.inverse ? 1 : 0}:${sp.text}`)
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
      // ⛔ 「用户滚动意图」标志 —— **只置位、不清位**（同 `core/listfollow.markUserScrollFrame`：
      //    流式期间每帧都有程序滚动，若在这里按"非用户"清位 ⇒ 清掉用户刚置的意图 ⇒ 滚不动）。
      //    ⚠️ 只认定 `SCROLLER`/`SCROLLER_ANIMATION`（`scroller.scrollEdge` 程序滚动）**不算**用户；
      //    其余一律算用户 —— 失败方向安全：误判只导致"暂停跟随"（可再滚回底部恢复），
      //    反向误判才会"人机对抗"（把用户拽回底部）。
      // ⚠️ `Scroll.onWillScroll` 的签名是 **4 参** `(xOffset, yOffset, scrollState, scrollSource)`
      //    （SDK `scroll.d.ts:1427 ScrollOnWillScrollCallback`）——**与 `List` 的 3 参不同**
      //    （照抄页面 `List` 的写法会 ArkTS 硬红 `10505001 ... not assignable`）。
      .onWillScroll((xOffset: number, yOffset: number, state: ScrollState, source: ScrollSource) => {
        if (source !== ScrollSource.SCROLLER && source !== ScrollSource.SCROLLER_ANIMATION) {
          this.followBottom = false;
        }
      })
      // 清位只在**滚动停止**时一次性判定（判据 = 贴底 ⇒ 恢复跟随；同 `core/listfollow` 真源）。
      .onScrollStop(() => {
        this.followBottom = followAfterScrollStop(this.followBottom, this.scroller.isAtEnd());
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
          .placeholderColor(this.iconMutedC())
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
      Column({ space: SPACE_XS }) {
        // 主键行：web `PRIMARY_KEYS` + `Ctrl` 修饰开关（Ctrl-C 保留直按，避免肌肉记忆回归）。
        Scroll() {
          Row({ space: SPACE_XS }) {
            this.keyChip('Ctrl-C', ctrlLetterByte('C'))
            this.keyChip('Tab', '\t')
            this.keyChip('Esc', '\x1b')
            this.ctrlChip()
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

        // 副键行：Ctrl 关 ⇒ web `SECONDARY_KEYS`（Home/End 同样走哨兵 ⇒ 应用光标键模式下发 SS3）；
        //          Ctrl 开 ⇒ web `CTRL_KEYS`（常见 shell 快捷键）。**等高等宽**切换 ⇒ 画布不抖动、
        //          不会因键区高度变化而反复向 PTY 发 resize（见 `applySize`）。
        Scroll() {
          Row({ space: SPACE_XS }) {
            if (this.ctrlActive) {
              // Ctrl 组合字母：字节真源 = `ctrlLetterByte`（web `handleAuxKey` 同源，可脱机单测）
              this.keyChip('C', ctrlLetterByte('C'))
              this.keyChip('D', ctrlLetterByte('D'))
              this.keyChip('L', ctrlLetterByte('L'))
              this.keyChip('A', ctrlLetterByte('A'))
              this.keyChip('E', ctrlLetterByte('E'))
              this.keyChip('W', ctrlLetterByte('W'))
              this.keyChip('R', ctrlLetterByte('R'))
              this.keyChip('Z', ctrlLetterByte('Z'))
            } else {
              this.keyChip('Home', '@H')
              this.keyChip('End', '@F')
              this.keyChip('PgUp', '\x1b[5~')
              this.keyChip('PgDn', '\x1b[6~')
              this.keyChip('|', '|')
              this.keyChip('~', '~')
              this.keyChip('/', '/')
              this.keyChip('-', '-')
            }
          }
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .clip(true)
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width(SHEET_WIDTH)
    .height('82%')
    .padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
    .borderRadius(RADIUS_SHEET)
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.palOnce()) })
    .alignItems(HorizontalAlign.Start)
    .transition(sheetTransition())
  }
}
