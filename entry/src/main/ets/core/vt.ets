/**
 * core/vt.ets —— **VT/xterm 终端模拟器**（纯逻辑；无 ArkUI、无 `@ohos.*` import ⇒ 可脱机单测）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────────────
 * 原生要接服务端 PTY（`/ws/terminal?tid=`，见 `channel/web/web_pty.go`）。PTY 吐的是
 * **带光标控制的原始终端字节流**（`\r`、`\x1b[H`、`\x1b[2J`、`\x1b[K`…），**不是**"一行行日志"。
 * web 侧用 xterm.js 渲染；原生**不许塞 WebView**（用户已否），也**不能**只做"逐行追加"
 * （那样 shell 的行内重绘、清屏、进度条全错）⇒ 自己实现一个**够用**的网格模拟器。
 *
 * ── 覆盖范围（= 服务端 shell 与常见 CLI 真正会发的子集，够用优先）────────────
 *   · 可打印字符（UTF-8 增量解码，含 CJK **双宽**）
 *   · `\r` / `\n` / `\b` / `\t` / `\a`(忽略)
 *   · ESC：`7`/`8`（存/取光标）· `D`(IND) · `M`(RI) · `E`(NEL) · `c`(RIS 复位) ·
 *          `(`/`)`/`#`/`%`… 中间字符序列（吞掉）
 *   · CSI：A/B/C/D/E/F（相对移动）· G(CHA) · d(VPA) · H/f(CUP) · J(ED) · K(EL) ·
 *          m(SGR) · L(IL) · M(DL) · P(DCH) · @(ICH) · X(ECH) · S/T(滚屏) · r(DECSTBM)
 *   · 私有模式：`?25`（光标显隐）· `?1049`/`?47`（备用屏，进/出各存/取）· `?1`（DECCKM
 *              应用光标键 ⇒ 方向键发 SS3 还是 CSI，见 `vtArrowKeys`）· 其余忽略
 *   · OSC：`]0;T`/`]2;T`（窗口标题，取到即写 `title`），其余忽略
 *
 * ── 明确**不做**的（诚实记账）──────────────────────────
 *   · 鼠标上报（`?1000`/`?1002`/`?1003`）/ bracketed paste（`?2004`）：移动端**无鼠标**、
 *     粘贴走 `TextInput` ⇒ 原生不做。**⛔ 并非"web 抑制"** —— web 的 xterm.js **原生支持**
 *     这两者，且它们根本不是"查询应答"（web 只抑制查询应答，见下条）
 *   · DSR 应答（`CSI n` / `CSI ? n`）：web 侧 `core/terminalQueries` 的
 *     `suppressTerminalQueryReplies`（真源 `web/src/lib/terminalQueries.ts`）**同样抑制**
 *     ⇒ 原生一致不做 —— 上条与这条里**唯 DSR 与 web 一致**（应用光标键 DECCKM 已支持）
 *   · 连字（ligature）/ 复杂双向文本 / 组合字符的逐格合成（`\u0301` 等原样落格）
 *   · 真正的"字符宽度表"只覆盖常见区间（CJK/全角/emoji）；冷门区可能算成单宽
 *
 * ── 与渲染层同源 ─────────────────────────────────────────────────────────────
 * 产物是 `AnsiSpan[]`（**复用** `core/ansi.ets` 的 span 类型）⇒ 渲染层的取色**唯一出口**
 * `ansiFgOf`/`ansiBgOf`（含反色 swap）对本模块产物**同样成立**。
 * 色值一律**存成 spec 串**（`''`=默认 / `i<N>`=调色板索引 0-255 / `#rrggbb`），由渲染层用
 * `color256(n, ansiPaletteOf(paletteOf(theme)))` 解析 ⇒ 终端**随应用主题**变色，无需重解析。
 *
 * ⛔ 本文件属 `core/`：**禁止** import ArkUI / `@ohos.*`（`tools/tests/run.sh` 当纯 TS 编译）。
 * 对象一律用 class（ArkTS 禁对象字面量作类型标注）。
 */

import { AnsiSpan, ANSI_DARK_PALETTE, color256 } from './ansi';

/** SGR 属性位。 */
export const VT_BOLD: number = 1;
export const VT_DIM: number = 2;
export const VT_ITALIC: number = 4;
export const VT_UNDERLINE: number = 8;
export const VT_STRIKE: number = 16;
export const VT_INVERSE: number = 32;
/** 双宽字符的**尾格**标记（该格无独立字符，视觉位置由前一格的 CJK 占）。 */
export const VT_WIDE_TAIL: number = 64;

/** 一个字符格。 */
export class VtCell {
  /** 字符（`' '` = 空白；双宽尾格 `ch` 为空且带 `VT_WIDE_TAIL`）。 */
  ch: string = ' ';
  /** 前景 spec：`''`=默认 · `i<N>`=索引 0-255 · `#rrggbb`。 */
  fg: string = '';
  /** 背景 spec：同上；`''`=透明。 */
  bg: string = '';
  flags: number = 0;
}

/** 一行（渲染单元的容器；`spans` 已按样式切分）。 */
export class VtLine {
  spans: AnsiSpan[] = [];
  /** 纯文本（无样式，便于测试/复制）。 */
  text: string = '';
}

// ── 字符宽度（常见区间；冷门区按单宽）────────────────────────────────────────
function inRanges(cp: number, lo1: number, hi1: number, lo2: number, hi2: number): boolean {
  return (cp >= lo1 && cp <= hi1) || (cp >= lo2 && cp <= hi2);
}

/** 字符显示宽度：0/1/2。控制字符 0，CJK 等 2，其余 1。 */
export function vtCharWidth(cp: number): number {
  if (cp === 0) { return 0; }
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) { return 0; }
  // 组合记号（零宽）
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff)
    || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f)) { return 0; }
  if (inRanges(cp, 0x1100, 0x115f, 0x2e80, 0xa4cf)) { return 2; }
  if (cp === 0x303f) { return 1; } // 半角宽度标记（不属 CJK 宽区）
  if (inRanges(cp, 0xac00, 0xd7a3, 0xf900, 0xfaff)) { return 2; }
  if (inRanges(cp, 0xfe30, 0xfe6f, 0xff00, 0xff60)) { return 2; }
  if (inRanges(cp, 0xffe0, 0xffe6, 0x1f300, 0x1f64f)) { return 2; }
  if (inRanges(cp, 0x1f900, 0x1f9ff, 0x20000, 0x3fffd)) { return 2; }
  return 1;
}

/**
 * 方向键字节序列：`DECCKM`（`appCursor` = 应用光标键模式）**开** ⇒ SS3（`\x1bO A`）；
 * **关** ⇒ CSI（`\x1b[ A`）。真源 = xterm.js `Terminal._applicationCursorKeys`（web 侧
 * xterm.js 原生支持；⛔ 它**不属**"查询应答"，`core/terminalQueries` 不涉及）。
 * `final` ∈ `A`(↑) `B`(↓) `C`(→) `D`(←)。
 */
export function vtArrowKeys(appCursor: boolean, final: string): string {
  return (appCursor ? '\x1bO' : '\x1b[') + final;
}

/**
 * `Ctrl` + 字母 ⇒ 控制字符。真源 = web `TerminalPanel.handleAuxKey`（`workspace/panels/TerminalPanel.tsx`）：
 *   `sendToPty(String.fromCharCode(key.label.toUpperCase().charCodeAt(0) - 64))`
 * 即 `A`⇒`\x01`(行首) `C`⇒`\x03`(SIGINT) `D`⇒`\x04`(EOF) `E`⇒`\x05`(行尾) `L`⇒`\x0c`(clear)
 * `R`⇒`\x12`(反向搜索) `W`⇒`\x17`(删词) `Z`⇒`\x1a`(挂起)。**非单字母 ⇒ 空串**（调用点据此不渲染）。
 */
export function ctrlLetterByte(ch: string): string {
  if (ch.length !== 1) { return ''; }
  const c: number = ch.toUpperCase().charCodeAt(0);
  if (c < 65 || c > 90) { return ''; }
  return String.fromCharCode(c - 64);
}

/**
 * 大工程-1（2026-10-17）：URL 检测（web `WebLinksAddon`（`TerminalPanel.tsx:143`）的
 * 原生对应——Span 无 onClick ⇒ Text 容器级坐标反查：`vtUrlAt(rowText, col)`）。
 * 返回 col 所在的完整 URL（http/https 开头才识别；不在 URL 上 ⇒ 空串）。
 * 终止符 = 空白/引号/括号/尖括号/反引号（markdown 链接 `](url)` 的包裹符全覆盖）。
 */
export function vtUrlAt(rowText: string, col: number): string {
  if (col < 0 || col >= rowText.length) { return ''; }
  const STOP: string = ' \t"\'()[]{}<>`';
  let s: number = col;
  while (s > 0 && STOP.indexOf(rowText.charAt(s - 1)) < 0) { s--; }
  let e: number = col;
  while (e < rowText.length && STOP.indexOf(rowText.charAt(e)) < 0) { e++; }
  const word: string = rowText.substring(s, e);
  if (word.indexOf('http://') !== 0 && word.indexOf('https://') !== 0) { return ''; }
  return word;
}

// ── 编解码（纯 JS 实现；core 不许 import @ohos.util）──────────────────────────
/** code point ⇒ JS 字符串（含代理对）。 */
export function vtCpToString(cp: number): string {
  if (cp <= 0xffff) { return String.fromCharCode(cp); }
  const v: number = cp - 0x10000;
  return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
}

/** UTF-8 编码（测试/发送用）。 */
export function vtUtf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp: number = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo: number = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  const u: Uint8Array = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) { u[i] = out[i]; }
  return u;
}

const B64: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uint8Array ⇒ base64（服务端 `stdin` 通道要求）。 */
export function vtBytesToB64(b: Uint8Array): string {
  let out: string = '';
  for (let i = 0; i < b.length; i += 3) {
    const b0: number = b[i];
    const b1: number = i + 1 < b.length ? b[i + 1] : -1;
    const b2: number = i + 2 < b.length ? b[i + 2] : -1;
    out += B64.charAt(b0 >> 2);
    out += B64.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4));
    out += b1 < 0 ? '=' : B64.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6));
    out += b2 < 0 ? '=' : B64.charAt(b2 & 63);
  }
  return out;
}

/** base64 ⇒ Uint8Array（服务端 `stdout` 通道）。 */
export function vtB64ToBytes(s: string): Uint8Array {
  const clean: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c: string = s.charAt(i);
    if (c === '=') { break; }
    if (B64.indexOf(c) >= 0) { clean.push(c); }
  }
  const out: number[] = [];
  let acc: number = 0;
  let bits: number = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  const u: Uint8Array = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) { u[i] = out[i]; }
  return u;
}

// ── 解析器状态 ───────────────────────────────────────────────────────────────
const ST_NORMAL: number = 0;
const ST_ESC: number = 1;
const ST_CSI: number = 2;
const ST_OSC: number = 3;
const ST_OSC_ESC: number = 4; // OSC 里遇 ESC，等 `\`
const ST_ESC_MID: number = 5; // ESC 中间字符，吞一个字节

export class VtTerm {
  cols: number = 80;
  rows: number = 24;
  /** 窗口标题（OSC 0/2）。 */
  title: string = '';
  cursorX: number = 0;
  cursorY: number = 0;
  cursorVisible: boolean = true;
  /**
   * DECCKM **应用光标键**模式（`CSI ? 1 h/l`）：开启后方向键应发 SS3（`\x1bO A`）而非
   * CSI（`\x1b[ A`）。见 `vtArrowKeys`；xterm.js 同款（其 `_applicationCursorKeys`）。
   */
  appCursorKeys: boolean = false;
  /** 滚动区（0-based，含端点）。 */
  scrollTop: number = 0;
  scrollBottom: number = 23;

  private grid: VtCell[][] = [];
  private scrollback: VtCell[][] = [];
  private maxScrollback: number = 1000;

  private state: number = ST_NORMAL;
  private params: number[] = [];
  private curParam: number = -1; // -1=该槽还没数字
  private priv: string = '';
  private osc: string = '';
  // 当前 SGR 样式（写格时用）
  private curFg: string = '';
  private curBg: string = '';
  private curFlags: number = 0;
  // 保存的光标（ESC 7 / 备用屏切换）
  private savedX: number = 0;
  private savedY: number = 0;
  private savedFg: string = '';
  private savedBg: string = '';
  private savedFlags: number = 0;
  // 自动换行：光标已停在末列、下一个字符要先换行
  private wrapPending: boolean = false;
  // 备用屏
  private altActive: boolean = false;
  private mainGrid: VtCell[][] = [];
  // 增量 UTF-8 的残余字节
  private pending: number[] = [];

  constructor(cols?: number, rows?: number) {
    this.cols = cols !== undefined && cols > 0 ? cols : 80;
    this.rows = rows !== undefined && rows > 0 ? rows : 24;
    this.reset();
  }

  /** 全部复位（RIS / 构造）。 */
  reset(): void {
    this.grid = this.blankGrid(this.rows, this.cols);
    this.scrollback = [];
    this.cursorX = 0;
    this.cursorY = 0;
    this.cursorVisible = true;
    this.appCursorKeys = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.curFg = '';
    this.curBg = '';
    this.curFlags = 0;
    this.state = ST_NORMAL;
    this.params = [];
    this.curParam = -1;
    this.priv = '';
    this.osc = '';
    this.wrapPending = false;
    this.altActive = false;
    this.mainGrid = [];
    this.pending = [];
  }

  private blankGrid(rows: number, cols: number): VtCell[][] {
    const g: VtCell[][] = [];
    for (let y = 0; y < rows; y++) {
      g.push(this.blankRow(cols));
    }
    return g;
  }

  private blankRow(cols: number): VtCell[] {
    const r: VtCell[] = [];
    for (let x = 0; x < cols; x++) { r.push(new VtCell()); }
    return r;
  }

  // ── 尺寸 ──────────────────────────────────────────────────────────────────
  /** 改变网格尺寸（保留左上内容；PTY 尺寸由调用方另发 `resize`）。 */
  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) { return; }
    const nc: number = cols > 0 ? cols : this.cols;
    const nr: number = rows > 0 ? rows : this.rows;
    const ng: VtCell[][] = [];
    for (let y = 0; y < nr; y++) {
      const src: VtCell[] | undefined = this.grid[y];
      const row: VtCell[] = [];
      for (let x = 0; x < nc; x++) {
        const cell: VtCell | undefined = src !== undefined && x < this.cols ? src[x] : undefined;
        row.push(cell !== undefined ? cell : new VtCell());
      }
      ng.push(row);
    }
    this.grid = ng;
    this.cols = nc;
    this.rows = nr;
    this.scrollTop = 0;
    this.scrollBottom = nr - 1;
    if (this.cursorX >= nc) { this.cursorX = nc - 1; }
    if (this.cursorY >= nr) { this.cursorY = nr - 1; }
    this.wrapPending = false;
  }

  // ── 输入 ──────────────────────────────────────────────────────────────────
  /** 喂一段 UTF-8 字节（WS `stdout` 解 base64 后的原始字节）。 */
  feed(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) { this.pending.push(bytes[i]); }
    let i: number = 0;
    const p: number[] = this.pending;
    while (i < p.length) {
      const b0: number = p[i];
      let need: number = 0;
      if (b0 < 0x80) { need = 1; }
      else if (b0 >= 0xc2 && b0 <= 0xdf) { need = 2; }
      else if (b0 >= 0xe0 && b0 <= 0xef) { need = 3; }
      else if (b0 >= 0xf0 && b0 <= 0xf4) { need = 4; }
      else { // 非法首字节 ⇒ REPLACEMENT，前进 1
        this.consume(0xfffd);
        i++;
        continue;
      }
      if (i + need > p.length) { break; } // 不完整，留待下一 chunk
      let cp: number = 0;
      let ok: boolean = true;
      if (need === 1) {
        cp = b0;
      } else {
        cp = b0 & (0xff >> (need + 1));
        for (let k = 1; k < need; k++) {
          const bk: number = p[i + k];
          if ((bk & 0xc0) !== 0x80) { ok = false; break; }
          cp = (cp << 6) | (bk & 0x3f);
        }
      }
      if (!ok) {
        this.consume(0xfffd);
        i++;
        continue;
      }
      this.consume(cp);
      i += need;
    }
    this.pending = i >= p.length ? [] : p.slice(i);
  }

  /** 便捷：喂一段字符串（测试用）。 */
  feedText(s: string): void {
    this.feed(vtUtf8Encode(s));
  }

  // ── 状态机 ────────────────────────────────────────────────────────────────
  private consume(cp: number): void {
    if (this.state === ST_NORMAL) { this.normal(cp); return; }
    if (this.state === ST_ESC) { this.esc(cp); return; }
    if (this.state === ST_CSI) { this.csi(cp); return; }
    if (this.state === ST_OSC) { this.oscInput(cp); return; }
    if (this.state === ST_OSC_ESC) {
      this.state = cp === 0x5c ? ST_NORMAL : ST_OSC; // `\` 结束，否则回到 OSC
      if (this.state === ST_NORMAL) { this.applyOsc(); }
      return;
    }
    // ST_ESC_MID：吞掉一个中间字符
    this.state = ST_NORMAL;
  }

  private normal(cp: number): void {
    if (cp === 0x1b) { this.state = ST_ESC; return; }
    if (cp === 0x0a || cp === 0x0b || cp === 0x0c) { this.linefeed(); this.wrapPending = false; return; }
    if (cp === 0x0d) { this.cursorX = 0; this.wrapPending = false; return; }
    if (cp === 0x08) { if (this.cursorX > 0) { this.cursorX--; } this.wrapPending = false; return; }
    if (cp === 0x09) {
      const nx: number = (Math.floor(this.cursorX / 8) + 1) * 8;
      this.cursorX = nx >= this.cols ? this.cols - 1 : nx;
      this.wrapPending = false;
      return;
    }
    if (cp === 0x07) { return; } // BEL
    if (cp < 0x20) { return; }
    this.putChar(cp);
  }

  private esc(cp: number): void {
    if (cp === 0x5b) { this.state = ST_CSI; this.params = []; this.curParam = -1; this.priv = ''; return; }
    if (cp === 0x5d) { this.state = ST_OSC; this.osc = ''; return; }
    if (cp === 0x37) { this.saveCursor(); this.state = ST_NORMAL; return; } // ESC 7
    if (cp === 0x38) { this.restoreCursor(); this.state = ST_NORMAL; return; } // ESC 8
    if (cp === 0x44) { this.linefeed(); this.state = ST_NORMAL; return; } // IND
    if (cp === 0x4d) { this.reverseLinefeed(); this.state = ST_NORMAL; return; } // RI
    if (cp === 0x45) { this.cursorX = 0; this.linefeed(); this.state = ST_NORMAL; return; } // NEL
    if (cp === 0x63) { this.reset(); return; } // RIS
    if (cp === 0x28 || cp === 0x29 || cp === 0x2a || cp === 0x2b || cp === 0x2d
      || cp === 0x2e || cp === 0x2f || cp === 0x23 || cp === 0x25 || cp === 0x20) {
      this.state = ST_ESC_MID; // 吞掉后续一个字符（字符集选择等）
      return;
    }
    this.state = ST_NORMAL; // 其余单字符 ESC（=、>、7…）忽略
  }

  private csi(cp: number): void {
    if (cp >= 0x30 && cp <= 0x39) {
      this.curParam = (this.curParam < 0 ? 0 : this.curParam) * 10 + (cp - 0x30);
      return;
    }
    if (cp === 0x3b) { // ';'
      this.params.push(this.curParam < 0 ? 0 : this.curParam);
      this.curParam = -1;
      return;
    }
    if (cp === 0x3a) { // ':' —— SGR truecolor 冒号形式（web 同样不支持）⇒ 当分隔符
      this.params.push(this.curParam < 0 ? 0 : this.curParam);
      this.curParam = -1;
      return;
    }
    if (cp === 0x3f || cp === 0x3e || cp === 0x3c || cp === 0x3d || cp === 0x21) {
      this.priv = vtCpToString(cp);
      return;
    }
    if (cp < 0x40 || cp > 0x7e) { return; } // 非法中间字节：忽略
    // 终止字节
    this.params.push(this.curParam < 0 ? 0 : this.curParam);
    const final: string = vtCpToString(cp);
    const priv: string = this.priv;
    const params: number[] = this.params;
    this.state = ST_NORMAL;
    this.dispatchCsi(final, priv, params);
  }

  private oscInput(cp: number): void {
    if (cp === 0x07) { this.applyOsc(); this.state = ST_NORMAL; return; }
    if (cp === 0x1b) { this.state = ST_OSC_ESC; return; }
    if (this.osc.length < 512) { this.osc += vtCpToString(cp); }
  }

  private applyOsc(): void {
    const s: string = this.osc;
    this.osc = '';
    const semi: number = s.indexOf(';');
    if (semi < 0) { return; }
    const code: string = s.substring(0, semi);
    if (code === '0' || code === '2') {
      this.title = s.substring(semi + 1);
    }
  }

  // ── CSI 分派 ──────────────────────────────────────────────────────────────
  private dispatchCsi(final: string, priv: string, params: number[]): void {
    const p0: number = params.length > 0 ? params[0] : 0;
    const n1: number = p0 > 0 ? p0 : 1;
    if (priv === '?') {
      this.privateMode(final, params);
      return;
    }
    if (final === 'A') { this.moveY(-n1); return; }
    if (final === 'B') { this.moveY(n1); return; }
    if (final === 'C') { this.moveX(n1); return; }
    if (final === 'D') { this.moveX(-n1); return; }
    if (final === 'E') { this.cursorX = 0; this.moveY(n1); return; }
    if (final === 'F') { this.cursorX = 0; this.moveY(-n1); return; }
    if (final === 'G') { this.setX(p0 > 0 ? p0 - 1 : 0); return; }
    if (final === 'd') { this.setY(p0 > 0 ? p0 - 1 : 0); return; }
    if (final === 'H' || final === 'f') {
      const r: number = params.length > 0 && params[0] > 0 ? params[0] - 1 : 0;
      const c: number = params.length > 1 && params[1] > 0 ? params[1] - 1 : 0;
      this.setY(r);
      this.setX(c);
      return;
    }
    if (final === 'J') { this.eraseDisplay(params.length > 0 ? params[0] : 0); return; }
    if (final === 'K') { this.eraseLine(params.length > 0 ? params[0] : 0); return; }
    if (final === 'm') { this.sgr(params); return; }
    if (final === 'L') { this.insertLines(n1); return; }
    if (final === 'M') { this.deleteLines(n1); return; }
    if (final === 'P') { this.deleteChars(n1); return; }
    if (final === '@') { this.insertChars(n1); return; }
    if (final === 'X') { this.eraseChars(n1); return; }
    if (final === 'S') { this.scrollUp(n1); return; }
    if (final === 'T') { this.scrollDown(n1); return; }
    if (final === 'r') {
      const top: number = params.length > 0 && params[0] > 0 ? params[0] - 1 : 0;
      const bot: number = params.length > 1 && params[1] > 0 ? params[1] - 1 : this.rows - 1;
      if (bot > top) { this.scrollTop = top; this.scrollBottom = bot; this.setX(0); this.setY(top); }
      return;
    }
    // 其余 CSI（DA/DSR/设备控制…）静默丢弃
  }

  private privateMode(final: string, params: number[]): void {
    // 只有 `h`/`l` 是"设置/清位"；其余 final（如 DECRQM `CSI ? … $ p` 的查询）**不得**改模式
    // —— 否则一个 `CSI ? 25 $ p` 查询会把光标显隐/DECCKM 误清（解析器把 `$` 当非法中间字节
    // 丢弃、仍以 `p` 作 final 走到这里，故必须在**此处**兜住）。
    if (final !== 'h' && final !== 'l') { return; }
    const on: boolean = final === 'h';
    for (let i = 0; i < params.length; i++) {
      const m: number = params[i];
      if (m === 1) { this.appCursorKeys = on; } // DECCKM 应用光标键
      else if (m === 25) { this.cursorVisible = on; }
      else if (m === 1049 || m === 47 || m === 1047) {
        if (on && !this.altActive) { this.enterAlt(); }
        else if (!on && this.altActive) { this.exitAlt(); }
      }
      // 其余（1000/1002/1003 鼠标 · 2004 bracketed paste · 1004 焦点事件…）忽略：
      // 移动端无鼠标 / 无硬件按键流，粘贴走 `TextInput`。
    }
  }

  private enterAlt(): void {
    this.mainGrid = this.grid;
    this.savedX = this.cursorX;
    this.savedY = this.cursorY;
    this.grid = this.blankGrid(this.rows, this.cols);
    this.cursorX = 0;
    this.cursorY = 0;
    this.altActive = true;
    this.wrapPending = false;
  }

  private exitAlt(): void {
    if (this.mainGrid.length === this.rows) { this.grid = this.mainGrid; }
    this.mainGrid = [];
    this.cursorX = this.savedX;
    this.cursorY = this.savedY;
    this.altActive = false;
    this.wrapPending = false;
  }

  // ── SGR ───────────────────────────────────────────────────────────────────
  private sgr(params: number[]): void {
    const ps: number[] = params.length === 0 ? [0] : params;
    let i: number = 0;
    while (i < ps.length) {
      const p: number = ps[i];
      if (p === 0) { this.curFg = ''; this.curBg = ''; this.curFlags = 0; }
      else if (p === 1) { this.curFlags |= VT_BOLD; }
      else if (p === 2) { this.curFlags |= VT_DIM; }
      else if (p === 3) { this.curFlags |= VT_ITALIC; }
      else if (p === 4) { this.curFlags |= VT_UNDERLINE; }
      else if (p === 7) { this.curFlags |= VT_INVERSE; }
      else if (p === 9) { this.curFlags |= VT_STRIKE; }
      else if (p === 21 || p === 22) { this.curFlags &= ~(VT_BOLD | VT_DIM); }
      else if (p === 23) { this.curFlags &= ~VT_ITALIC; }
      else if (p === 24) { this.curFlags &= ~VT_UNDERLINE; }
      else if (p === 27) { this.curFlags &= ~VT_INVERSE; }
      else if (p === 29) { this.curFlags &= ~VT_STRIKE; }
      else if (p >= 30 && p <= 37) { this.curFg = `i${p - 30}`; }
      else if (p === 39) { this.curFg = ''; }
      else if (p >= 40 && p <= 47) { this.curBg = `i${p - 40}`; }
      else if (p === 49) { this.curBg = ''; }
      else if (p >= 90 && p <= 97) { this.curFg = `i${p - 90 + 8}`; }
      else if (p >= 100 && p <= 107) { this.curBg = `i${p - 100 + 8}`; }
      else if (p === 38 || p === 48) {
        const isFg: boolean = p === 38;
        if (i + 1 < ps.length && ps[i + 1] === 5 && i + 2 < ps.length) {
          const idx: number = ps[i + 2];
          if (isFg) { this.curFg = `i${idx}`; } else { this.curBg = `i${idx}`; }
          i += 2;
        } else if (i + 1 < ps.length && ps[i + 1] === 2 && i + 4 < ps.length) {
          const r: number = clamp255(ps[i + 2]);
          const g: number = clamp255(ps[i + 3]);
          const b: number = clamp255(ps[i + 4]);
          const hex: string = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
          if (isFg) { this.curFg = hex; } else { this.curBg = hex; }
          i += 4;
        }
      }
      i++;
    }
  }

  // ── 写入 ──────────────────────────────────────────────────────────────────
  private putChar(cp: number): void {
    const w: number = vtCharWidth(cp);
    if (w === 0) { return; }
    if (this.wrapPending) {
      this.cursorX = 0;
      this.linefeed();
      this.wrapPending = false;
    }
    if (w === 2) {
      if (this.cursorX >= this.cols - 1) {
        this.cursorX = 0;
        this.linefeed();
      }
      this.writeCell(this.cursorX, cp, 0);
      this.writeCell(this.cursorX + 1, 0, VT_WIDE_TAIL);
      this.cursorX += 2;
    } else {
      this.writeCell(this.cursorX, cp, 0);
      this.cursorX += 1;
    }
    if (this.cursorX >= this.cols) {
      this.cursorX = this.cols - 1;
      this.wrapPending = true;
    }
  }

  private writeCell(x: number, cp: number, extra: number): void {
    if (x < 0 || x >= this.cols) { return; }
    const row: VtCell[] = this.grid[this.cursorY];
    if (row === undefined) { return; }
    const c: VtCell = row[x];
    c.ch = cp === 0 ? '' : vtCpToString(cp);
    c.fg = this.curFg;
    c.bg = this.curBg;
    c.flags = this.curFlags | extra;
  }

  private linefeed(): void {
    if (this.cursorY === this.scrollBottom) {
      this.scrollUp(1);
    } else if (this.cursorY < this.rows - 1) {
      this.cursorY++;
    }
    this.wrapPending = false;
  }

  private reverseLinefeed(): void {
    if (this.cursorY === this.scrollTop) {
      this.scrollDown(1);
    } else if (this.cursorY > 0) {
      this.cursorY--;
    }
    this.wrapPending = false;
  }

  /** 区内上滚：顶行入 scrollback（仅主屏整屏滚动时），底补空行。 */
  private scrollUp(n: number): void {
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      const gone: VtCell[] | undefined = this.grid[this.scrollTop];
      if (gone !== undefined && this.scrollTop === 0 && !this.altActive) {
        this.scrollback.push(gone);
        if (this.scrollback.length > this.maxScrollback) { this.scrollback.shift(); }
      }
      this.grid.splice(this.scrollTop, 1);
      this.grid.splice(this.scrollBottom, 0, this.blankRow(this.cols));
    }
  }

  private scrollDown(n: number): void {
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      this.grid.splice(this.scrollBottom, 1);
      this.grid.splice(this.scrollTop, 0, this.blankRow(this.cols));
    }
  }

  private insertLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) { return; }
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      this.grid.splice(this.cursorY, 0, this.blankRow(this.cols));
      this.grid.splice(this.scrollBottom + 1, 1);
    }
    this.cursorX = 0;
  }

  private deleteLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) { return; }
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      this.grid.splice(this.cursorY, 1);
      this.grid.splice(this.scrollBottom, 0, this.blankRow(this.cols));
    }
    this.cursorX = 0;
  }

  private insertChars(n: number): void {
    const row: VtCell[] = this.grid[this.cursorY];
    if (row === undefined) { return; }
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      row.splice(this.cursorX, 0, this.blankStyled());
      row.splice(this.cols, 1);
    }
  }

  private deleteChars(n: number): void {
    const row: VtCell[] = this.grid[this.cursorY];
    if (row === undefined) { return; }
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      row.splice(this.cursorX, 1);
      row.splice(this.cols - 1, 0, this.blankStyled());
    }
  }

  private eraseChars(n: number): void {
    const row: VtCell[] = this.grid[this.cursorY];
    if (row === undefined) { return; }
    const count: number = Math.max(1, n);
    for (let k = 0; k < count; k++) {
      const x: number = this.cursorX + k;
      if (x >= this.cols) { break; }
      this.setBlank(row[x]);
    }
  }

  private eraseLine(mode: number): void {
    const row: VtCell[] = this.grid[this.cursorY];
    if (row === undefined) { return; }
    if (mode === 0) {
      for (let x = this.cursorX; x < this.cols; x++) { this.setBlank(row[x]); }
    } else if (mode === 1) {
      for (let x = 0; x <= this.cursorX && x < this.cols; x++) { this.setBlank(row[x]); }
    } else {
      for (let x = 0; x < this.cols; x++) { this.setBlank(row[x]); }
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2) {
      for (let y = 0; y < this.rows; y++) { this.eraseRowFull(y); }
      return;
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursorY; y++) { this.eraseRowFull(y); }
      this.eraseLine(1);
      return;
    }
    this.eraseLine(0);
    for (let y = this.cursorY + 1; y < this.rows; y++) { this.eraseRowFull(y); }
  }

  private eraseRowFull(y: number): void {
    const row: VtCell[] = this.grid[y];
    if (row === undefined) { return; }
    for (let x = 0; x < this.cols; x++) { this.setBlank(row[x]); }
  }

  /** 抹成一个"带当前样式"的空白格（xterm 的 BCE 语义）。 */
  private blankStyled(): VtCell {
    const c: VtCell = new VtCell();
    this.setBlank(c);
    return c;
  }

  private setBlank(c: VtCell): void {
    c.ch = ' ';
    c.fg = this.curFg;
    c.bg = this.curBg;
    c.flags = this.curFlags;
  }

  // ── 光标/滚动区 ────────────────────────────────────────────────────────────
  private setX(x: number): void {
    this.cursorX = x < 0 ? 0 : (x >= this.cols ? this.cols - 1 : x);
    this.wrapPending = false;
  }

  private setY(y: number): void {
    this.cursorY = y < 0 ? 0 : (y >= this.rows ? this.rows - 1 : y);
    this.wrapPending = false;
  }

  private moveX(dx: number): void {
    this.setX(this.cursorX + dx);
  }

  private moveY(dy: number): void {
    this.setY(this.cursorY + dy);
  }

  private saveCursor(): void {
    this.savedX = this.cursorX;
    this.savedY = this.cursorY;
    this.savedFg = this.curFg;
    this.savedBg = this.curBg;
    this.savedFlags = this.curFlags;
  }

  private restoreCursor(): void {
    this.cursorX = this.savedX;
    this.cursorY = this.savedY;
    this.curFg = this.savedFg;
    this.curBg = this.savedBg;
    this.curFlags = this.savedFlags;
    this.wrapPending = false;
  }

  // ── 产出（渲染用）────────────────────────────────────────────────────────
  /**
   * 屏幕可见行的 span（`rows` 行，自顶向下）。
   * @param palette 16 色调色板（索引 0-15 映射到此；256/truecolor 与调色板无关）。
   *   由**渲染层**传入（`ansiPaletteOf(paletteOf(theme))`）⇒ 终端内容随应用主题变色，
   *   且**无需**重建模拟器（重调本函数即可）。缺省 = web 的 xterm 深色原值。
   */
  screenLines(palette?: string[]): VtLine[] {
    const pal: string[] = palette !== undefined ? palette : ANSI_DARK_PALETTE;
    const out: VtLine[] = [];
    for (let y = 0; y < this.rows; y++) {
      // #7-2（2026-10-17）：光标格渲染参数化——y===cursorY 的行走 cursorX（其余 -1 不动）。
      out.push(this.renderRow(this.grid[y], pal, y === this.cursorY ? this.cursorX : -1));
    }
    return out;
  }

  /** 最近 `n` 行 scrollback 的 span（老→新）。 */
  scrollbackLines(n: number, palette?: string[]): VtLine[] {
    const pal: string[] = palette !== undefined ? palette : ANSI_DARK_PALETTE;
    const out: VtLine[] = [];
    const from: number = Math.max(0, this.scrollback.length - n);
    for (let y = from; y < this.scrollback.length; y++) {
      out.push(this.renderRow(this.scrollback[y], pal));
    }
    return out;
  }

  /** scrollback 行数。 */
  scrollbackCount(): number {
    return this.scrollback.length;
  }

  /** 整屏（含 scrollback）的纯文本（测试/复制用）。 */
  dumpText(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.scrollback.length; y++) {
      lines.push(this.rowText(this.scrollback[y]));
    }
    for (let y = 0; y < this.rows; y++) {
      lines.push(this.rowText(this.grid[y]));
    }
    return lines.join('\n');
  }

  private rowText(row: VtCell[] | undefined): string {
    if (row === undefined) { return ''; }
    let s: string = '';
    for (let x = 0; x < this.cols; x++) {
      const c: VtCell = row[x];
      if ((c.flags & VT_WIDE_TAIL) !== 0) { continue; }
      s += c.ch.length > 0 ? c.ch : ' ';
    }
    return trimEnd(s);
  }

  /** 一行 ⇒ span 列表（相邻同格样式合并；行尾默认空白裁掉）。 */
  /**
   * #7-2（2026-10-17）：`cursorAt` = 本行光标列（-1 ⇒ 无）——渲染层 `inverse` **异或**翻转
   * （不动活 cell；原 inverse 格上光标显示为正色——xterm 同语义）。空白尾保护：光标落在
   * 被 trim 的空白区 ⇒ `end` 保到光标列（vim/less 光标常在行尾空白，�⛔ 不能不可见）。
   */
  private renderRow(row: VtCell[] | undefined, palette: string[], cursorAt: number = -1): VtLine {
    const line: VtLine = new VtLine();
    if (row === undefined) { return line; }
    let end: number = this.cols;
    while (end > 0) {
      const c: VtCell = row[end - 1];
      if (c.ch === ' ' && c.fg === '' && c.bg === '' && c.flags === 0) { end--; } else { break; }
    }
    // ★ 内容终点（`line.text` 只统计到这里——光标占位不进 text：复制/测试口径与内容语义不变）。
    const contentEnd: number = end;
    if (cursorAt >= end && cursorAt < this.cols) { end = cursorAt + 1; }
    let i: number = 0;
    let full: string = '';
    while (i < end) {
      const c: VtCell = row[i];
      if ((c.flags & VT_WIDE_TAIL) !== 0) { i++; continue; }
      const text: string = c.ch.length > 0 ? c.ch : ' ';
      if (i < contentEnd) { full += text; }
      const sp: AnsiSpan = new AnsiSpan();
      sp.text = text;
      sp.fg = resolveSpec(c.fg, palette);
      sp.bg = resolveSpec(c.bg, palette);
      sp.bold = (c.flags & VT_BOLD) !== 0;
      sp.dim = (c.flags & VT_DIM) !== 0;
      sp.italic = (c.flags & VT_ITALIC) !== 0;
      sp.underline = (c.flags & VT_UNDERLINE) !== 0;
      sp.strike = (c.flags & VT_STRIKE) !== 0;
      sp.inverse = ((c.flags & VT_INVERSE) !== 0) !== (i === cursorAt);
      line.spans.push(sp);
      i++;
    }
    line.text = full;
    if (line.spans.length === 0) {
      // 空行也**必须**产出一个 span：否则渲染层 `Text()` 无子节点 ⇒ 盒高 0 ⇒ 整屏行距错乱。
      const blank: AnsiSpan = new AnsiSpan();
      blank.text = ' ';
      line.spans.push(blank);
    }
    return line;
  }
}

/**
 * 把格的色 **spec** 解析成渲染层能直接用的颜色串。
 *   `''`      ⇒ `''`（无显式色；渲染层继承/回退，见 `ansiFgOf`）
 *   `#rrggbb` ⇒ 原样（truecolor）
 *   `i<N>`    ⇒ `color256(N, palette)`（0-15 走调色板，16+ 走 xterm 立方/灰阶）
 */
function resolveSpec(spec: string, palette: string[]): string {
  if (spec.length === 0) { return ''; }
  if (spec.charAt(0) === '#') { return spec; }
  const n: number = parseInt(spec.substring(1), 10);
  return color256(Number.isNaN(n) ? 7 : n, palette);
}

function clamp255(v: number): number {
  if (v < 0) { return 0; }
  if (v > 255) { return 255; }
  return v;
}

function hex2(v: number): string {
  const s: string = clamp255(v).toString(16);
  return s.length === 1 ? `0${s}` : s;
}

function trimEnd(s: string): string {
  let e: number = s.length;
  while (e > 0 && s.charAt(e - 1) === ' ') { e--; }
  return s.substring(0, e);
}
