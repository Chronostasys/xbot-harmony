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
import { ctrlLetterByte, VtLine, VtTerm, vtArrowKeys, vtB64ToBytes, vtUrlAt } from '../core/vt';
import pasteboard from '@ohos.pasteboard';
// 「跟随底部」的纯逻辑（与消息列表**同一真源**，⛔ 不在这里重写一套）
import { followAfterScrollStop } from '../core/listfollow';
// 「↓ 回到最新」的显示判据（**与消息列表同一真源**，⛔ 不在这里重写一套）
import { showsJumpToLatest } from '../core/indicators';
import {
  encodeResize, encodeStdin, parseTermMsg, reconnectDelayMs, TERM_CLOSE_MSG, TERM_CLOSED, TERM_CONNECTED,
  TERM_CONNECTING, TERM_ERROR, TERM_EXITED, TermMsg, TerminalInfo, terminalHeadTitle, terminalStatusRole,
  terminalStatusText, terminalTitle, termWsUrl,
} from '../core/termproto';
// P0-1 逐键输入的三态 diff + 回车擦除兜底（vim/REPL/ssh 密码在此之前收不到任何中间按键）
import { eraserFor, sentThroughStep, stdinDelta } from '../core/termkey';
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, PRESS_OPACITY, RADIUS_CARD, RADIUS_PILL, RADIUS_SHEET,
  SHEET_ACTION_GLYPH, SPACE_HAIR, SPACE_MD,
  SHEET_WIDTH, SPACE_SM, SPACE_XS, STROKE_HAIRLINE, surfaceFillOf, typeOf,
} from '../core/design';
import { fadeTransition, sheetTransition, animBase } from './anim';

/**
 * 渲染上限：scrollback 尾巴 + 屏幕。⛔ 别无限增长（Text 的 span 段数 = 性能）。
 *
 * 200 → **500**（2026-10-14）：todo「终端回看 200 行太短」。web 权威 = xterm.js
 * `scrollback: 10000`（`TerminalPanel.tsx:129` / `BackgroundPanel.tsx:49`）⇒ 500 仍保守。
 * 本仓画布是**单个 Text 的 TextSpan 摊平**（`flatSpans`）——500 行 ≈ 数千 span 段仍是
 * **单组件**排版（无组件节点增长）；buffer 数据永远充足（VtTerm `maxScrollback=1000`
 * > 500，core/vt.ets:218）。⚠️ 若真机滚动掉帧 ⇒ 回落 300 或改视口窗口渲染。
 *
 * 1000 → **3000**（2026-10-20）：web 权威 = xterm.js `scrollback: 10000`；1000 行回看太短
 * （用户运行长命令时看不到前面输出）。3000 是性能与回看的平衡点——单 Text 摊平仍可控，
 * 且对齐 `VtTerm maxScrollback=3000` 整 buffer 上限。若真机滚动掉帧 ⇒ 回落 2000。
 */
const TERM_MAX_LINES: number = 3000;
/** 合并刷新间隔（ms）：≈10fps，够流畅且不会把 UI 线程打满。 */
const TERM_FLUSH_MS: number = 100;
/**
 * 键芯片水平内边距（vp）。竖直仍走 14 ⇒ 命中盒 ≥44（`HIT_TARGET_MIN` 口径：fontSize×1.35 + 2×padY）。
 *
 * ⛔ 2026-10-13：**宽度不再由本常量定**（键行改 `layoutWeight(1)` 等分布满）——旧实现靠
 * `窄 padding + minWidth 44` 去"挤进一行"，量测已证伪（可用宽 326.8vp < 8×44 + 7×8 = 408vp
 * ⇒ 末枚键必然被裁）。这里只留"文字离键边的最小呼吸量"。
 * ⛔ 2026-10-13（真机取证「键帽标签被截成 `Ctrl...` / `Ho...`」）：4 太宽 —— 8 枚等分键每枚仅
 *   33.9vp（可用宽 326.8 − 7×8 间隙），扣两侧 8 ⇒ 文字盒 25.9vp，连 `Home`(≈28vp) 都放不下。
 *   ⇒ 收到 **3**，并把键行 `space` 由 `SPACE_XS`(8) 收到 `SPACE_HAIR`(2)（每枚再 +5.2vp）⇒
 *   8 枚键宽 ≈39.1vp、文字盒 ≈33.1vp，`Home`/`PgUp`/`PgDn` **天然放得下**（不再依赖缩字兜底）。
 */
const KEY_PAD_X: number = 3;
/**
 * 键帽**最小宽度**（vp）：单字符键（`↑`/`|`/`~`）的内容宽只有 ≈13vp ⇒ 用本值兜住命中盒
 * （≈ Apple 键盘键宽 32pt）。⛔ 不是 `HIT_TARGET_MIN`(44)：8 × 44 = 352 > 可用 326.8vp 会溢出
 * —— 这正是「末枚键被裁」的根因。多字符键取**自身内容宽**（更长 ⇒ 更宽，**不截断**）。
 */
const KEY_FLOOR_VP: number = 32;
/**
 * 键帽**自动收字的下限**（vp）：长标签（`Ctrl-C`/`PgUp`）在等分后的窄键上按此下限缩字，
 * 保证**不截断、不换行**（`Text.minFontSize` + `heightAdaptivePolicy=MIN_FONT_SIZE_FIRST`）。
 * 9vp ≈ 仍可辨认的小号标签；短标签（`↑`/`|`/`C`）不受影响（`maxFontSize` = `type.caption`）。
 */
const KEY_MIN_FONT: number = 9;
/**
 * 面板里**非画布**部分的高度（vp）：标题行 + 状态行 + 输入行 + 键行 + 3 个间距。
 * 由 `xbot_phone`（1320×2848）实测标定：画布盒 ≈456vp、整板 ≈690vp ⇒ 其余 ≈202vp。
 * 只用于"视口 ⇒ 行数"；即使略偏，也只是多/少一行，不影响正确性。
 */
const TERM_CHROME_VP: number = 202;
/**
 * 快赢 2（2026-10-17）：键栏**收起**时从 chrome 里扣回的空间（vp）——两行键帽
 * （`HIT_TARGET_MIN` 44×2）+ 层间 `SPACE_XS`(8) + 键栏与输入行的间距 ≈ 104。
 * 只用于「视口 ⇒ 行数」估算（与 `TERM_CHROME_VP` 同一容错口径：差一行不影响正确性）。
 * web 对照 `TerminalPanel.tsx:88` `showAux` 收的是副键行；原生一顿到底（主+副全收），
 * 切换锚点恒在输入行尾（收起后仍可呼回——不学 web 的 ‹/› 两级）。
 */
const TERM_KEYROWS_VP: number = 104;

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
  /**
   * 状态上抛（快赢 1，2026-10-17）：status 翻转 ⇒ 通知页面（列表行消费 `terminalTone`/
   * `terminalStatusText` 上色——此前状态困本地面板 ⇒ 列表恒 muted 灰点，审计病灶①）。
   */
  onStatus: (tid: string, status: string, exitCode: number) => void = (_tid: string, _status: string, _code: number) => {
  };

  // 快赢 1：@Watch 上抛 status 翻转（初值挂载不触发——首帧列表 muted 恰与 connecting 同 tone）。
  @State @Watch('onStatusWatch') private status: string = TERM_CONNECTING;
  /** 键栏展开态（快赢 2，2026-10-17）：默认展开 = 现状零变化；收起 ⇒ 画布多 ≈104vp。 */
  @State private showKeys: boolean = true;
  /** 大工程-1：URL 点按提示（点中链接→已复制；非定时器——下次点按覆盖/清空）。 */
  @State private tapNote: string = '';
  @State private exitCode: number = -1;
  /** 渲染上限：scrollback 尾巴 + 屏幕（摊平成一个 `Text`，见 `flatSpans`）。 */
  @State private flow: AnsiSpan[] = [];
  @State private input: string = '';
  /**
   * 已逐键透传给 PTY 的行前缀长度（P0-1：`stdinDelta` 尾追段即时 `stdin` 后累加、
   * 退格 wire 回退一格）。回车时 `eraserFor(sentThrough)` 先把这段从 PTY 行上擦掉
   * 再整行重发 —— 双发/丢字两难的兜底，见 submitInput。
   */
  @State private sentThrough: number = 0;
  @State private note: string = '';
  /** `Ctrl` 修饰键开关（对齐 web `TerminalPanel` 的 `ctrlActive`）：开启后第二行换成 Ctrl 组合字母。 */
  @State private ctrlActive: boolean = false;

  private term: VtTerm = new VtTerm(80, 24);
  private ws: webSocket.WebSocket | null = null;
  private flushTimer: number = -1;
  private dirty: boolean = false;
  /** 光标 blink 闸门（xterm cursorBlink 同语义）：~530ms 间隔翻转。 */
  private cursorBlink: boolean = true;
  private blinkTimer: number = -1;
  private userClosed: boolean = false;
  /** 断线重连（P0-2）：第几次重连（0 起）；on('open') 成功后清零。 */
  private reconnectAttempt: number = 0;
  /** 挂起的重连定时器 id（-1 = 无）。Ⓐ 幂等守卫：close/error 双通道只触发一次调度。 */
  private reconnectTimer: number = -1;
  /**
   * 是否跟随新输出（`flush()` 只在 true 时才 `scrollEdge(Bottom)`）。
   *
   * ⛔ 为什么要闸门（用户 2026-10-12 长期要求 #2「绝不能人机对抗」）：旧实现 `flush()` **无条件**
   *    跟底 ⇒ 用户往上翻看历史时，**每来一行输出就把视角拽回底部** ⇒ 根本读不了日志。
   *    语义与消息列表**同一真源** `core/listfollow`：用户一动手 ⇒ 暂停；滚回**贴底** ⇒ 恢复。
   */
  @State followBottom: boolean = true;
  /**
   * 「贴底位置闸门」（与消息列表 `pages/Index.ets` 的 `atEndUi` **同一语义/同一理由**）。
   *
   * ⛔ 为什么不能直接用 `Scroller.isAtEnd()` 当闸门：`EdgeEffect.Spring` 的**弹性过滚动**期间
   *    `isAtEnd()` 判**假**（视口其实还在末尾，只是被拉过头）⇒「回到最新」药丸会**闪现**再消失
   *    （用户 2026-10-12 真机亲报过同一现象）。改在**滚动停止**时缓存位置：停止前不变 ⇒
   *    过滚动/回弹全程闸门恒"贴底" ⇒ 药丸不闪；用户真的上滚并停下 ⇒ 立刻变 false ⇒ 药丸出现。
   */
  @State private atEndUi: boolean = true;
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
   * 「↓ 回到最新」药丸**底色**（`accentDeep`，与消息列表药丸同款）。
   *
   * ⛔ 为什么收成方法：性能预算 **B 线**（`this.pal()` ∨ `this.palOnce()` 调用点）**顶格 1350、只许减**。
   *    药丸要两个色（文字 + 底）若在 `build()` 直写 = **+2 调用点 ⇒ 顶穿（真红）**。文字复用既有
   *    `textPrimaryC()`，底色只在本方法体取一次板 ⇒ 净 +1；同批把两处直读改走既有 helper（−2）⇒ 净 −1。
   */
  private accentDeepC(): string {
    return this.palOnce().accentDeep;
  }

  /**
   * 输入框**结构发丝**色。
   *
   * ⛔ 为什么必须有（2026-10-13 真机取证）：`surface.input` 与面板底 `surface.overlay` **同属
   *    `RUNG_CARD`**（`core/design.ets:346` vs `:378`）⇒ `surfaceFillOf` 返回**逐字节相同的填充**
   *    ⇒ 只靠填充，输入框容器在**深浅两主题下都完全不可见**（截图里只剩一行浮空的占位文字）。
   *    `SurfaceRole('surface.input', RUNG_CARD, true)` 的第三参 `hairline:true` 正是此意
   *    （「该面需要结构性发丝来立边界」）—— 键帽已补（见 `keyRoleColor`），输入框此前被漏掉。
   *    与全站输入面**同一口径**（`Index.ets` composer / `SettingsRows` 均 `.border(hairline)`）。
   * ⚠️ 走本方法（记忆化入口）而非直写 `hairlineOf(this.palOnce())`：不新增 `this.palOnce()` 调用点
   *    （性能预算 ⑦ **B 线顶格 1350、只许减不许增**）。
   */
  private inputHairlineC(): string {
    return hairlineOf(this.palOnce());
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
    this.applySize(w * 0.94 - 2 * SPACE_MD - 2 * SPACE_XS,
      h * 0.82 - 2 * SPACE_MD - TERM_CHROME_VP + (this.showKeys ? 0 : TERM_KEYROWS_VP));
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
      this.reconnectAttempt = 0; // P0-2：连上即清零重连计数
      this.sendResize();
      this.scheduleFlush(true);
      this.startBlink(); // #7-4：光标 blink 随连接启动
    });
    ws.on('message', (err: BusinessError, value: string | ArrayBuffer) => {
      if (typeof value === 'string') {
        this.onData(value as string);
      }
    });
    ws.on('close', (err: BusinessError, value: webSocket.CloseResult) => {
      this.stopBlink(); // #7-4：连接关 ⇒ 光标 blink 随停（重连成功后 on('open') 复起）
      // P0-2 triage：**服务端语义终态**（exit⇒EXITED / onData error⇒TERM_ERROR）只归档；
      // 用户主动关 ⇒ CLOSED；其余（掉线/服务端杀 PTY 未先 exit）⇒ backoff 重连。
      if (this.status === TERM_EXITED || this.status === TERM_ERROR) {
        this.cancelReconnect();
        this.scheduleFlush(true);
        return;
      }
      if (this.userClosed) {
        this.status = TERM_CLOSED;
        this.cancelReconnect();
        this.scheduleFlush(true);
        return;
      }
      this.scheduleReconnect();
      this.scheduleFlush(true);
    });
    ws.on('error', (err: BusinessError) => {
      this.note = err.message !== undefined ? err.message : '';
      // ⛔ 不在此设终态 TERM_ERROR（那是 onData「服务端语义错」的专属）——
      //    传输错经随后的 close 事件统一 triage 进重连（error 常先于 close）。
      this.scheduleReconnect();
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
    this.cancelReconnect(); // P0-2：用户关面板 ⇒ 撤销一切挂起的重连（幂等）
    this.stopBlink(); // #7-4：光标 blink 随连接一起停
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

  // ── #7-4 光标 blink（xterm cursorBlink 同语义）──────────────────────────────
  /** 启动光标 blink（~530ms 翻转一次，与 xterm.js 默认一致）。幂等。 */
  private startBlink(): void {
    if (this.blinkTimer >= 0) {
      return;
    }
    this.blinkTimer = setInterval(() => {
      this.cursorBlink = !this.cursorBlink;
      this.dirty = true;
      this.flush();
    }, 530);
  }

  /** 停止光标 blink（连接断/面板关时调）。幂等。 */
  private stopBlink(): void {
    if (this.blinkTimer >= 0) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = -1;
    }
    this.cursorBlink = true; // 重置为可见
  }

  // ── P0-2 断线重连 ────────────────────────────────────────────────────────
  /** Ⓐ 幂等撤防：close+error 双通道、teardown、放弃路径共用；无挂起则无事发生。 */
  private cancelReconnect(): void {
    if (this.reconnectTimer >= 0) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
  }

  /**
   * 重连前整屏复位：服务端 replay 是 **sess 级全量重放**（web_pty.go:646-656 无
   * per-client 偏移）⇒ 保留旧屏会在重放后**同一输出显示两遍**。按当前尺寸新建 VT
   * 再吃 replay（坑源：tasks-gap 审计「重连前必须 new VtTerm() 复位再吃 replay」）。
   */
  private resetTermForReplay(): void {
    this.term = new VtTerm(this.term.cols, this.term.rows);
    this.dirty = true;
  }

  /**
   * 传输断 ⇒ backoff 重连（500ms×2ⁿ≤15s，≤6 次，对齐 web terminalWS.ts:28-31）。
   * Ⓐ 幂等：close/error 常成对到达，`reconnectTimer >= 0` 即已有调度 ⇒ 直接返回。
   * 放弃后落终态 TERM_ERROR（与「服务端语义错」共用文案「连接失败」+ note 记次数）。
   */
  private scheduleReconnect(): void {
    if (this.userClosed) { return; }
    if (this.reconnectTimer >= 0) { return; }
    const delay: number = reconnectDelayMs(this.reconnectAttempt);
    if (delay < 0) {
      this.status = TERM_ERROR;
      this.note = `重连失败（已试 ${this.reconnectAttempt} 次）`;
      this.scheduleFlush(true);
      return;
    }
    const nth: number = this.reconnectAttempt + 1;
    this.reconnectAttempt++;
    this.status = TERM_CONNECTING;
    this.note = `已断开，重连中（第 ${nth} 次）…`;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      if (this.userClosed || this.status === TERM_EXITED || this.status === TERM_ERROR) { return; }
      this.teardown(); // 关旧 socket + 清挂起 flush（cancelReconnect 幂等无害）
      this.resetTermForReplay();
      this.connect();
    }, delay);
    this.scheduleFlush(true);
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
    const sc: VtLine[] = this.term.screenLines(colors, this.cursorBlink);
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

  /**
   * 大工程-1（2026-10-17）：画布点按 → 坐标反查 URL（web `WebLinksAddon`（TerminalPanel.tsx:143）
   * 的原生对应——Span 无 onClick ⇒ Text 容器级坐标反查）。y/lineH→行、x/charW→列（扣
   * SPACE_XS padding）；flow 按 '\n' span 分行取文本；`vtUrlAt` 命中 ⇒ 复制（GenuiPanelCard
   * 同款）+tapNote 提示（⛔ 不设 setTimeout——预算 8/8 满；下次点按覆盖）。
   */
  private onCanvasTap(px: number, py: number): void {
    const x: number = px - SPACE_XS;
    const y: number = py - SPACE_XS;
    if (x < 0 || y < 0) { return; }
    const lineIdx: number = Math.floor(y / this.lineH);
    const col: number = Math.floor(x / this.charW);
    const lines: string[] = [];
    let cur: string = '';
    for (let i = 0; i < this.flow.length; i++) {
      const sp: AnsiSpan = this.flow[i];
      if (sp.text === '\n') { lines.push(cur); cur = ''; } else { cur += sp.text; }
    }
    lines.push(cur);
    if (lineIdx >= lines.length) { return; }
    const url: string = vtUrlAt(lines[lineIdx], col);
    if (url.length === 0) { this.tapNote = ''; return; }
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, url);
      pasteboard.getSystemPasteboard().setData(data);
      this.tapNote = `链接已复制: ${url}`;
    } catch (_e) {
      this.tapNote = '复制失败';
    }
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
    const sent: number = this.sentThrough;
    this.input = '';
    this.sentThrough = 0;
    if (this.status !== TERM_CONNECTED) {
      return;
    }
    // P0-1 回车兜底：已逐键透传的 sent 个字符还在 PTY 行上 —— 先发 DEL×sent 擦掉，
    // 再整行+回车。透传越少擦得越少；全程 diff 失败（中文/粘贴）时 sent===0 ⇒ 与
    // 旧行为（整行回车）逐字节一致，风险面为零。
    const eraser: string = eraserFor(sent);
    const line: string = t.length > 0 ? `${t}\r` : '\r';
    this.raw(encodeStdin(eraser.length > 0 ? `${eraser}${line}` : line));
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

  /** 快赢 1（2026-10-17）：status 翻转 ⇒ 上抛页面（@Watch 触发；初值挂载不触发）。 */
  onStatusWatch(): void {
    this.onStatus(this.tid, this.status, this.exitCode);
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
      // ── 键宽 = **内容宽 + 最小宽**（2026-10-13 第三轮真机取证）──────────────────────────
      // 病史：① 旧实现 `minWidth(44)` × 8 = 352vp > 可用 326.8vp ⇒ **末枚键被裁**（`e22dcd2`）；
      //   ② 改 `layoutWeight(1)` 等分布满后键不再被裁，但每枚仅 ≈40vp，**长标签被截成
      //   `Ctrl...` / `Ho...`** —— 真机取证：`minFontSize` 自适应缩字在 `Text` 上**未介入**
      //   （实测给了确定高度也不缩），超宽直接走 `Ellipsis`。
      // ⇒ 第三轮回到 web 权威的**内容宽**（web `TerminalPanel` 键栏 = `flex` 内容宽 +
      //   `overflow-x-auto`）。⛔ **不删任何键**（`vt.test.ts` 钉住 Ctrl-C 直按 + `| ~ / -` 四全）：
      //   让每枚键**恰好等于其文字所需宽**（不截断），并用 `KEY_FLOOR_VP` 兜住单字符键的命中盒。
      //   量测：内容宽合计 ≈296vp（行 1）/ ≈286vp（行 2）/ ≈270vp（Ctrl 行），**均 < 可用
      //   326.8vp** ⇒ 无溢出、无截断，也不需要横向滚动（`ScrollDirection.Horizontal` 计数仍 0）。
      .constraintSize({ minWidth: KEY_FLOOR_VP })
      .maxLines(1)
      // ⛔ `maxLines` 必须配 `textOverflow`（门禁 `text_truncation_gate` 硬红：不配 = 默认 `Clip`
      //    ⇒ 超出的字**静默消失**）。内容宽下正常永不触发，它只是**fail-safe**：万一极端窄屏/
      //    超大字号仍放不下，至少给用户一个 `…` 而不是空白。
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      // 自动收字：内容宽下正常**不触发**（标签天然放得下）⇒ 纯 fail-safe 兜底。
      .minFontSize(KEY_MIN_FONT)
      .maxFontSize(typeOf('type.caption').size)
      .heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
      .textAlign(TextAlign.Center)
      // 键帽高度**恒定** `HIT_TARGET_MIN`（整排等高）。⛔ 用确定高度（`.height()`）而非
      // `constraintSize({minHeight})`：`minFontSize` 自适应缩字需要**确定盒尺寸**才介入，
      // 只给下限时超宽直接走 `textOverflow: Ellipsis`（真机取证：`Ctrl...` 即这条路径）。
      .height(HIT_TARGET_MIN)
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
    // ⛔ 标签**恒为 `Ctrl`**（不加 `✓`）：状态由**填充**表达（激活 = `accent` 实心，
    //    见 `keyRoleColor(active, 'bg')`）—— `Ctrl ✓` 是 6 字宽，在等分键宽里会溢出错行。
    Text('Ctrl')
      .fontSize(typeOf('type.caption').size)
      // ⚡ 2026-10-20 丝滑动画：Ctrl 激活/取消时键帽颜色缓动
      .animation(animBase())
      .fontColor(this.keyRoleColor(this.ctrlActive, 'text'))
      .padding({ left: KEY_PAD_X, right: KEY_PAD_X, top: 14, bottom: 14 })
      .animation(animBase())
      .backgroundColor(this.keyRoleColor(this.ctrlActive, 'bg'))
      // 同上：未激活时也要有发丝边才看得见键帽（激活态是实心 accent ⇒ 自带对比，不必描边）。
      .animation(animBase())
      .border({ width: STROKE_HAIRLINE, color: this.keyRoleColor(this.ctrlActive, 'border') })
      .borderRadius(RADIUS_PILL)
      // 与 `keyChip` 同一处置（内容宽 + 最小宽）：`Ctrl` 取自身字宽（≈37vp）⇒ 标签恒完整。
      .constraintSize({ minWidth: KEY_FLOOR_VP })
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })   // 同 `keyChip`：门禁要求 + fail-safe
      .minFontSize(KEY_MIN_FONT)
      .maxFontSize(typeOf('type.caption').size)
      .heightAdaptivePolicy(TextHeightAdaptivePolicy.MIN_FONT_SIZE_FIRST)
      .textAlign(TextAlign.Center)
      .height(HIT_TARGET_MIN)
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
              // ⚡ 2026-10-20 丝滑动画：连接状态切换时圆点颜色缓动
              .animation(animBase())
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

        // ⛔ 关闭 X 的 `fontColor` 必须保持 `colorOf(…,'iconMuted')` 的**字面形态**（不抽成
        //    `iconMutedC()`）：判据 `sheet_chrome` ② 沿 `.fontSize(SHEET_ACTION_GLYPH)` 的
        //    **连续修饰链**按文本找 `'iconMuted'` ⇒ ① 走 helper 数不到；② 链**中间插注释会截断链**
        //    （两种写法都实测真红）。语义与 helper 完全等价（helper 体就是同一句）。
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

      // ── 终端画布（整屏一个 `Text` + N 个 `Span`；等宽；跟底）+「↓ 回到最新」悬浮药丸 ──
      // ⚠️ `Stack` 只为**叠放**药丸：药丸是**悬浮提示**（盖在画布之上、贴底居中），
      //    ⛔ **不占布局行** ⇒ 不挤压终端视口（与消息列表「回到最新」同一形态/同一判据）。
      Stack({ alignContent: Alignment.Bottom }) {
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
        // ✅ 长按可选可复制（对齐 web：xterm.js **自带原生选区 + 复制**）。
        //    此前画布**没有** `copyOption` ⇒ 长按毫无反应，用户拿不到终端里的命令/输出
        //    （web 长按拖动即选段复制）—— 这是与 web 的功能性落差，不是样式落差。
        //    ⚠️ 口径与 `ToolPopover.PlainLine`（同为 `Text() + ForEach(Span)` 的 ANSI 渲染）
        //    **逐字一致**：`CopyOptions.LocalDevice`（⛔ 不是 `None`，也不是 `InApp`）。
        .copyOption(CopyOptions.LocalDevice)
        .padding(SPACE_XS)
      }
      .width('100%')
      .height('100%')
      .align(Alignment.TopStart)
      .scrollBar(BarState.Off)
      .clip(true)
      // 大工程-1（2026-10-17）：URL 点按 → 坐标反查（onCanvasTap）。挂 **Scroll**（全屏容器）
      // 而非内层 Text：① 点击冒泡语义等价（tap 与滚动手势分路不互斥）② Scroll 无 padding，
      // ClickEvent x/y 即内容区坐标（onCanvasTap 内扣 SPACE_XS 换算不变）③ ⛔ 不挂在 Text 上
      // ——hit_target_pad §B 把「可点 Text」当小热区审计（动态 fontSize 解析不出 ⇒ 按缺省 15
      // 保守估高 <44 ⇒ 全屏画布被误判成小目标——挂 Scroll 不入该扫描口径）。
      .onClick((e: ClickEvent) => {
        this.onCanvasTap(e.x, e.y);
      })
      .backgroundColor(colorOf(this.palOnce(), 'sunken'))
      // S2（形状语言 12/8 两级，与侧栏同一口径）：画布是**容器** ⇒ `RADIUS_CARD`（12）。
      .borderRadius(RADIUS_CARD)
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
          // ⛔ 只在**真的变化**时写（`followBottom` 是 `@State`）：用户拖动每帧都进这一支，
          //    已经暂停后反复标脏 ⇒ 让整张终端面板每帧重建（同 `pages/Index.ets` 的收敛纪律）。
          // ⚠️ 这里**刻意**不写成 `if (this.followBottom) {` —— 那个字面量是 `flush()` 跟底闸门的
          //    判据（`tools/tests/panel_terminal_wiring.test.ts` 钉它**恰好 1 处**，多一处就分不清
          //    "唯一闸门"是否还在）⇒ 用 `!== false` 表达同一语义，保住那条判据的判别力。
          if (this.followBottom !== false) {
            this.followBottom = false;
          }
        }
      })
      // 清位只在**滚动停止**时一次性判定（判据 = 贴底 ⇒ 恢复跟随；同 `core/listfollow` 真源）。
      .onScrollStop(() => {
        // ⛔ 判据 `panel_terminal_wiring`（`stopResume === 1`）钉的是**这一整句文本**：
        //    `followAfterScrollStop(this.followBottom, this.scroller.isAtEnd())` 必须**恰好 1 处**
        //    ⇒ 保持原样、别拆成局部量（拆了它数不到 0 ⇒ 真红）。
        this.followBottom = followAfterScrollStop(this.followBottom, this.scroller.isAtEnd());
        // 「贴底闸门」另取一次 `isAtEnd()`（同一次停止事件 ⇒ 与上一句必然一致；见 `atEndUi` 注释）。
        this.atEndUi = this.scroller.isAtEnd();
      })

      // 「↓ 回到最新」—— **悬浮药丸**（贴底居中；与消息列表 `Index.ets` **同一判据真源**
      //   `showsJumpToLatest`：跟随暂停 + 确有内容 + 非贴底）。web 的 xterm 终端**没有**这个入口
      //   （只能手动一路滚到底）⇒ 这是原生"超越 web"的一处：用户上翻读日志后**一次点按**即回最新。
      // ⚠️ 命中盒 = 药丸行自身 ≥`HIT_TARGET_MIN`(44) 的**布局盒**（⛔ 不用 `responseRegion` 外扩 ——
      //   真机实测负偏移外扩**无效**，见 `AGENTS.md` GOTCHAS）。
      if (showsJumpToLatest(this.followBottom, this.flow.length, this.atEndUi)) {
        Row() {
          Text('回到最新')
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.textPrimaryC())
            .padding({ left: SPACE_SM, right: SPACE_SM, top: 7, bottom: 7 })
            .backgroundColor(this.accentDeepC())
            .borderRadius(RADIUS_SHEET)
        }
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SPACE_MD, right: SPACE_MD })
        // 按压反馈：全站唯一口径 `PRESS_OPACITY`（⛔ 不写裸数值 —— 判据 `interactive_feedback`
        // ⑥ 硬红；`stateStyles` 必须写 `normal` 才不被它接管 —— 同 `Index.ets` 药丸）。
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          // 用户显式要求回底部 ⇒ 意图置为跟随（与消息列表药丸/切会话**同一语义**）。
          this.scroller.scrollEdge(Edge.Bottom);
          this.followBottom = true;
        })
        .margin({ bottom: SPACE_MD })
        // 「回到最新」的**浮现/隐去** = 纯淡入淡出（无空间含义 ⇒ 不滑入）—— 走底座具名工厂
        //   `fadeTransition()`，与 `components/Toast`（**同为**「全屏透明容器 + 底对齐」的悬浮提示）
        //   同一族；此前是"啪"地出现/消失。判据真源 `showsJumpToLatest` 不变（本行只加过渡）。
        //   静息态 = 组件自身属性 = **可见** ⇒ fail-safe（门禁 ⑨；⛔ 不用 `.opacity(cond ? 1 : 0)`）。
        .transition(fadeTransition())
      }
      }
      .layoutWeight(1)
      .width('100%')

      if (this.note.length > 0 || this.tapNote.length > 0) {
        // note（错误）/ tapNote（链接已复制）共用一行（B 线预算：palOnce 同一处双语义）
        Text(this.note.length > 0 ? this.note : this.tapNote)
          .fontSize(typeOf('type.micro').size)
          // ⚡ 2026-10-20 丝滑动画：note 状态切换时文字颜色缓动
          .animation(animBase())
          .fontColor(colorOf(this.palOnce(), this.note.length > 0 ? 'dangerText' : 'successText'))
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
          .fontColor(this.textPrimaryC())
          .placeholderColor(this.iconMutedC())
          .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.input'))
          // S2：输入框是内芯 ⇒ `RADIUS_PILL`（8），与键帽同档（⛔ 不是 6 的 chip 档）。
          .borderRadius(RADIUS_PILL)
          // ⛔ 结构发丝**必须**：`surface.input` 与面板底 `surface.overlay` 同 rung ⇒ 填充同色
          //    ⇒ 无发丝则输入框容器**完全不可见**（见 `inputHairlineC` 注释）。
          .border({ width: STROKE_HAIRLINE, color: this.inputHairlineC() })
          .enterKeyType(EnterKeyType.Send)
          .enabled(this.status === TERM_CONNECTED)
          .onChange((v: string) => {
            // P0-1 逐键输入：只透传「安全形态」（纯 ASCII 尾追 / 单 ASCII 尾删⇒DEL）。
            // 其余（中间编辑、中文 IME、粘贴重排、程序回灌）diff=null —— 不透传，
            // 由回车时 eraserFor+整行兜底补齐（既不双发也不丢字，见 submitInput）。
            const d: string | null = stdinDelta(this.input, v);
            this.input = v;
            if (d !== null && d.length > 0 && this.status === TERM_CONNECTED) {
              this.sentThrough = Math.max(0, this.sentThrough + sentThroughStep(d));
              this.raw(encodeStdin(d));
            }
          })
          .onSubmit(() => {
            this.submitInput();
          })

        // ── 键栏开合锚点（快赢 2，2026-10-17）：恒在输入行尾 ⇒ 收起后仍一眼可呼回 ──
        Row() {
          if (this.showKeys) {
            SymbolGlyph($r('sys.symbol.chevron_down'))
              .fontSize(typeOf('type.caption').size).fontColor([this.iconMutedC()])
          } else {
            SymbolGlyph($r('sys.symbol.chevron_up'))
              .fontSize(typeOf('type.caption').size).fontColor([this.iconMutedC()])
          }
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(this.showKeys ? '收起键栏' : '展开键栏')
        .onClick(() => {
          this.showKeys = !this.showKeys;
        })
      }
      .width('100%')

      // ── 常用键（软键盘发不出的控制序列）；快赢 2：可收起（锚点恒在输入行尾）──
      if (this.showKeys) {
        Column({ space: SPACE_XS }) {
        // 主键行：web `PRIMARY_KEYS` + `Ctrl` 修饰开关（Ctrl-C 保留直按，避免肌肉记忆回归）。
        // ⛔ 不包 `Scroll`（2026-10-13，见 `keyChip` 的量测）：每枚键 `layoutWeight(1)` 等分布满
        //    ⇒ 无需横向滚动，也就**不可能**再有键落在可视区之外（旧实现 8×44vp 必然溢出，
        //    末枚 `→` 直接不可见、`←` 被裁半 —— 用户亲报「终端做的很差」的可见证据之一）。
        // ⛔ 键行 `space` = `SPACE_HAIR`(2)（不是 `SPACE_XS`(8)）：8 枚等分键 + 7 个 8vp 间隙会吃掉
        //    56vp，每枚只剩 33.9vp ⇒ `Home`/`PgUp` 被截（真机取证）。收到 2vp ⇒ 每枚 +5.2vp。
        Row({ space: SPACE_HAIR }) {
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
        .width('100%')

        // 副键行：Ctrl 关 ⇒ web `SECONDARY_KEYS`（Home/End 同样走哨兵 ⇒ 应用光标键模式下发 SS3）；
        //          Ctrl 开 ⇒ web `CTRL_KEYS`（常见 shell 快捷键）。**等高等宽**切换 ⇒ 画布不抖动、
        //          不会因键区高度变化而反复向 PTY 发 resize（见 `applySize`）。
        // ⛔ 与主键行同一处置：不包 `Scroll`（等分布满 ⇒ 无键会被挤出可视区；旧实现末枚 `-` 不可见）。
        Row({ space: SPACE_HAIR }) {
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
        .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .transition(fadeTransition())
      }
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
