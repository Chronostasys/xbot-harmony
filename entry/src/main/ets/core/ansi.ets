/**
 * ANSI SGR 着色解析 —— **逐字移植** web `src/components/agent/AnsiText.tsx`
 * 的 `parseAnsi()` / `applyCarriageReturns()` / `color256()`（本工程自己的代码，
 * 属"对齐"而非重造）。工具 pill 浮层里的 shell/终端输出是最高频呈现面，两端
 * 必须给出**同一套 span 切分与取色**，否则"对齐 webui"就是空话。
 *
 * ── web 支持的转义（= 本文件支持的全集）──────────────────────────────────
 *  · SGR（CSI 以 `m` 收尾）：
 *      - 属性：0 重置 / 1 加粗 / 2 暗淡 / 3 斜体 / 4 下划线 / 7 反色 / 9 删除线；
 *        关闭：21·22 关加粗暗淡 / 23 关斜体 / 24 关下划线 / 27 关反色 / 29 关删除线
 *      - 前景：30-37 基本色、90-97 亮色、39 复位；背景：40-47、100-107、49 复位
 *      - 256 色：38;5;N（前景）/ 48;5;N（背景）—— 走 xterm 立方 + 灰阶
 *      - truecolor：38;2;R;G;B / 48;2;R;G;B —— 原样 rgb
 *  · 其余任何 CSI（光标移动 `\x1b[C/A/J/B`、清屏 `2J`、私有模式 `?25l`…）、
 *    OSC（`\x1b]0;title` + BEL/ST）、以及任意单字符 ESC 序列(`\x1bX`) —— **一律丢弃**，
 *    绝不作为原始乱码到达渲染层。
 *
 * ── web 不支持（本文件同样不支持，**不自行加**）────────────────────────────
 *  · ITU T.416 用冒号分参的 truecolor（`\x1b[38:2::R:G:B m`）—— web 只认分号，
 *    冒号形式会**整段当纯文本保留**（见测试）。
 *  · 制表符展开：`\t` 原样保留（由渲染层决定制表位）—— web 也不展开。
 *  · 行截断：本文件**不做**任何长度截断（那是渲染层的事）。
 *
 * ── 与 web 的一处**等价改写**（务必让渲染层知道）────────────────────────────
 *  web 在 push 时就把反色（7）就地 swap 成 color/backgroundColor（`AnsiText.tsx:111-112`）。
 *  原生把这次 swap **下沉到渲染层**：span 里保留 raw `fg`/`bg` + `inverse` 标记，渲染层
 *  需按 `fg_eff = inverse ? bg : fg` 解析。两者**最终观感完全一致**；这样做的理由是
 *  `inverse` 成为**承重字段**（而非解析期一次性消费后不可见的副作用），单测能直接断言它。
 *  ⚠️ 因此：解析层**从不** swap，渲染层**必须** swap 恰好一次（别重复 swap）。
 *
 * ── 流式（增量）策略（关键）──────────────────────────────────────────────
 *  工具输出是流式的（逐 delta 追加）。本文件是**纯函数**：`parseAnsi(整段已累积文本)`
 *  —— 调用方（渲染层）每来一个 delta 就用**整段累积串**重跑一次，结果只由整段文本决定
 *  ⇒ 「切成 N 段逐字喂」与「一次喂」的**最终结果逐字一致**（测试已锁死）。
 *  ⚠️ 已知瞬态伪影（与 web 完全一致，未"修"）：某 delta 恰好切断一个转义时，末尾的
 *  残片会短暂当文本显示（如 `...\x1b[31` 显示 "31"、`...\x1b[31red` 显示 "ed"），
 *  等后续 delta 补齐即消失。若渲染层想消掉这个闪动，可在渲染前用 `incompleteTail()`
 *  求"尾部未完成转义的起点"，把该尾巴**推迟到下一个 delta 再渲染**（web 没有这一步，
 *  属**可选增强**；解析语义不受影响）。
 *
 * ── 两层色板（web 字节对齐 vs 本仓设计系统）──────────────────────────────
 *  ① **默认**（`parseAnsi(text, dark)`）：走 `ANSI_LIGHT/DARK_PALETTE` = **web 的 xterm/
 *     GitHub 原值**（逐字移植，用于与 webui 字节对齐）。这是与 web **行为一致**的默认。
 *  ② **本仓色板映射**（`ansiPaletteOf(paletteOf(theme))`）：把 16 槽经 `ANSI_COLOR_ROLES`
 *     表映射到 `colorOf(p, role)` 语义出口 ⇒ 终端输出随应用 5 套色板走。原生要"用本仓
 *     设计语言渲染"时，把结果作为 `parseAnsi` 第 3 参传入即可。见 `ANSI_COLOR_ROLES` 注释
 *     （含"同族槽有意折叠"的明记）。⛔ 映射表只写 role 名，**不写任何色值**。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/ansi.test.ts`）。本文件属 `core/`，会被
 * `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译 ⇒ **禁止** import ArkUI / `@ohos.*`；
 * 也须避开 ArkTS 严格规则（禁 `is` 类型谓词、禁对象字面量作类型标注 ⇒ 用 class）。
 */

import { Palette } from './theme';
import { colorOf } from './design';

/** 一段带样式的文本（对齐 web `AnsiSegment`，字段名 fg/bg ↔ web 的 color/backgroundColor）。 */
export class AnsiSpan {
  /** 文本内容（**不含**任何转义序列）。 */
  text: string = '';
  /** 解析出的**原始**前景色；'' = 未指定（渲染层用主题正文色 / 继承）。 */
  fg: string = '';
  /** 解析出的**原始**背景色；'' = 无背景。 */
  bg: string = '';
  bold: boolean = false;
  dim: boolean = false;
  italic: boolean = false;
  underline: boolean = false;
  /** 删除线（web `strikethrough`）。 */
  strike: boolean = false;
  /** 反色（SGR 7）。⚠️ fg/bg 为**原始值**，渲染层按此标记 swap（见文件头"等价改写"）。 */
  inverse: boolean = false;
}

/**
 * 16 色基本调色板（index 0-7 标准、8-15 亮色）。**web 原值**（readability-tuned，
 * GitHub 风）—— 浅色主题下 ANSI 深色系会看不清，故按主题给两套。
 * 调用方若要改用本仓 token，把自定义数组作为 `parseAnsi` 第 3 参传入即可。
 */
export const ANSI_LIGHT_PALETTE: string[] = [
  '#24292f', '#cf222e', '#116329', '#4d2d00',
  '#0550ae', '#8250df', '#1b7c83', '#6e7781',
  '#6e7781', '#a40e26', '#1a7f37', '#9a6700',
  '#0969da', '#8250df', '#3198a3', '#8c959f',
];
/** 同上，深色主题（本仓玻璃材质锁深色 ⇒ 默认应走这套）。 */
export const ANSI_DARK_PALETTE: string[] = [
  '#484f58', '#ff7b72', '#3fb950', '#d29922',
  '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
  '#6e7681', '#ffa198', '#56d364', '#e3b341',
  '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc',
];

/** xterm 256 色立方体的 6 级分量（16-231 段用）。 */
export const ANSI_CUBE: number[] = [0, 95, 135, 175, 215, 255];

/**
 * **到本仓色板的映射表**（ANSI 16 色槽 → 语义取色 role）。
 *
 * 为什么需要它：`ANSI_LIGHT/DARK_PALETTE` 是 **web 的 xterm/GitHub 原值**（逐字移植、
 * 用于与 web 字节对齐），**不跟本仓 5 套色板（dark/light/aurora/nebula/porcelain）走**。
 * 原生要"用本仓设计语言渲染终端输出"，就得有一条 **ANSI 槽 → `colorOf` 语义出口** 的映射
 * —— 这张表就是唯一出口（`ansiPaletteOf` 消费它）。⛔ 这里**不出现任何色值**（只写 role 名），
 * 遵从设计系统「颜色一律取自语义出口」。
 *
 * 语义优先于终端亮暗档：ANSI 的 16 槽里，`0-7`（标准）与 `8-15`（bright）**成对同族**
 * （如 1/9 = 红、2/10 = 绿）⇒ 本表**有意**让同族的两槽落到同一 role（本仓语义角色里没有
 * "更亮的那一档红"）。红=错误/绿=成功/黄=警示/蓝=品牌/青=运行 的**颜色语义保住了**，
 * 丢的只是终端特有的"亮/暗"微差 —— 这是"接本仓设计系统"的代价，已在此明记。
 */
export const ANSI_COLOR_ROLES: string[] = [
  'textMuted',       // 0  黑
  'statusError',     // 1  红
  'successText',     // 2  绿
  'statusWaiting',   // 3  黄（警示）
  'accent',          // 4  蓝（品牌）
  'accentDeep',      // 5  品红
  'statusRunning',   // 6  青（运行）
  'textPrimary',     // 7  白
  'textSecondary',   // 8  bright 黑（淡灰）
  'dangerText',      // 9  bright 红
  'successText',     // 10 bright 绿（与 2 同族）
  'statusWaiting',   // 11 bright 黄（与 3 同族）
  'accentSoft',      // 12 bright 蓝
  'accentText',      // 13 bright 品红
  'statusRunning',   // 14 bright 青（与 6 同族）
  'textPrimary',     // 15 bright 白（与 7 同族）
];

/**
 * 由本仓色板构造 16 色 ANSI 调色板（**到本仓色板的映射**，纯函数）。
 * 渲染层应把结果作为 `parseAnsi` 的第 3 参（`palette`）传入，即可让终端输出随应用主题走。
 * @param p `paletteOf(theme)` 得到的色板。
 */
export function ansiPaletteOf(p: Palette): string[] {
  const out: string[] = [];
  for (let i = 0; i < ANSI_COLOR_ROLES.length; i++) {
    out.push(colorOf(p, ANSI_COLOR_ROLES[i]));
  }
  return out;
}

/**
 * **渲染层的启用判据**：文本是否含"需要转义渲染"的内容（ESC 或裸 `\r`）。
 *
 * ⛔ 这是「判据与渲染同源」的**唯一出口** —— `parseAnsi` 的快路径（无 ESC 且无 `\r` ⇒
 *   单段不复制的原样 span）**直接调用本函数**，渲染层也用本函数决定"走 span 还是走纯文本"。
 *   两边**逐字同源** ⇒ 不可能出现"组件走了 span 分支、parseAnsi 却给了单段原样"（或反之）
 *   这种判据分叉。（本仓铁律：同一个纯函数既判又渲。）
 *
 * 为什么把裸 `\r` 也算进来（而非只认 `\x1b[`）：`\r` 是**进度条**的核心语义（同行后写覆盖
 *   前写，如 `10%\r20%\r100%`），它与颜色码无关却同样需要解析 —— web 的快路径判据也是
 *   `!includes('\x1b') && !includes('\r')`（`AnsiText.tsx:100-101`）。⇒ 只认 `\x1b` 会让
 *   纯 `\r` 的进度输出在原生端**漏掉**覆盖折叠（与 web 分叉）。
 *
 * ⚠️ 纯文本（无 ESC、无 `\r`）一律 `false` ⇒ 调用方走**纯文本快路径**，不引入任何多余节点。
 */
export function hasAnsi(text: string): boolean {
  return text.indexOf('\x1b') >= 0 || text.indexOf('\r') >= 0;
}

/**
 * **渲染计划**（判据 + 数据**同一个纯函数**）：无转义 ⇒ `null`（调用方走纯文本快路径）；
 * 有转义 ⇒ 解析出的 span 列表（16 色已按 `palette` 映射到本仓语义出口，逐段带样式）。
 *
 * 渲染层只调这一个函数即可同时拿到"要不要渲染"与"渲染成什么"：
 *   `const spans = ansiSpansIfAny(text, ansiPaletteOf(this.pal()))`
 *   `if (spans === null) { <纯文本> } else { <逐 span 上色> }`
 * 这样"判"与"渲"不可能分叉（判据来自 `hasAnsi`，数据来自同一 `parseAnsi`）。
 *
 * @param text    待渲染文本（含或含 `\r`/ESC）。
 * @param palette `ansiPaletteOf(paletteOf(theme))` —— 本仓色板映射后的 16 色。
 */
export function ansiSpansIfAny(text: string, palette: string[]): AnsiSpan[] | null {
  if (!hasAnsi(text)) { return null; }
  return parseAnsi(text, true, palette);
}

/**
 * 渲染层取色的**唯一出口 —— 前景**：把 span 的 raw `fg`/`bg` + `inverse` 解析成最终前景色。
 * ⛔ `inverse`（SGR 7）**只在此 swap 恰好一次** —— 解析层从不 swap（见文件头"等价改写"），
 *    渲染层**必须**经由本函数取色、**绝不**自行 swap（重复 swap = 观感错）。
 * @param sp   `parseAnsi` 产出的 span（`fg`/`bg` 为**原始值**）。
 * @param base 无显式前景（且非反色）时继承的底色（渲染层的语义行色）。
 */
export function ansiFgOf(sp: AnsiSpan, base: string): string {
  const f: string = sp.inverse ? sp.bg : sp.fg;
  return f !== '' ? f : base;
}

/** 同上，**背景**：反色后无背景时返回 `fallback`（渲染层传 `p.transparent`）。 */
export function ansiBgOf(sp: AnsiSpan, fallback: string): string {
  const b: string = sp.inverse ? sp.fg : sp.bg;
  return b !== '' ? b : fallback;
}

/**
 * 256 色（0-255）→ 具体颜色串。
 *  0-15   ⇒ 取 `palette`（主题相关）；
 *  16-231 ⇒ xterm 6×6×6 立方；
 *  232-255⇒ 灰阶（8 + (n-232)*10）；
 *  越界   ⇒ 回退 palette[7]（与 web 一致）。
 */
export function color256(n: number, palette: string[]): string {
  if (n >= 0 && n < 16) { return palette[n]; }
  if (n >= 16 && n < 232) {
    const i: number = n - 16;
    const r: number = ANSI_CUBE[Math.floor(i / 36)];
    const g: number = ANSI_CUBE[Math.floor(i / 6) % 6];
    const b: number = ANSI_CUBE[i % 6];
    return `rgb(${r},${g},${b})`;
  }
  if (n >= 232 && n <= 255) {
    const v: number = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  return palette[7];
}

/** 匹配 OSC（`…BEL`/`…ESC\`）、CSI、以及任意单字符 ESC 序列。 */
const ESCAPE_RE: RegExp = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b./g;
/** 只认"完整"的 CSI：`\x1b[` + 参数 + 单个终止字母。 */
const CSI_RE: RegExp = /^\x1b\[([0-9;?]*)([A-Za-z])$/;

/**
 * `\r` 语义（按行）：CRLF 只是行结束（先归一化）；**孤立 `\r`** 把光标退回行首 ⇒
 * 同一行后写覆盖前写（进度条），取最后一个 chunk；行尾单独一个 `\r` 不算重写，保留整行；
 * 重写 chunk 开头的 `ESC[K`（清行）显式去掉。
 */
function applyCarriageReturns(input: string): string {
  const normalized: string = input.replace(/\r\n/g, '\n');
  if (normalized.indexOf('\r') < 0) { return normalized; }
  return normalized
    .split('\n')
    .map((line: string): string => {
      if (line.indexOf('\r') < 0) { return line; }
      const chunks: string[] = line.split('\r');
      const last: string = chunks[chunks.length - 1];
      // 行尾孤立 \r（后面没东西）不是重写 —— 保留前一段
      if (last === '') { return chunks.length >= 2 ? chunks[chunks.length - 2] : ''; }
      return last.replace(/^(?:\x1b\[[0-9]*K)+/, '');
    })
    .join('\n');
}

/**
 * 解析 ANSI 文本 ⇒ 带样式的 span 列表（纯函数）。
 * @param text    待解析文本（可含 ESC / `\r`）。
 * @param dark    选 16 色调色板（true=深色主题）。256/truecolor **与主题无关**（与真实终端一致）。
 * @param palette 可选：覆盖 16 色调色板（如改映射到本仓 token）。缺省用 LIGHT/DARK。
 */
export function parseAnsi(text: string, dark: boolean, palette?: string[]): AnsiSpan[] {
  const pal: string[] = palette !== undefined ? palette
    : (dark ? ANSI_DARK_PALETTE : ANSI_LIGHT_PALETTE);
  // 快路径需**同时**无 ESC 且无 `\r`：纯 `\r` 重写（无颜色码的进度条）也要走 \r 处理。
  if (!hasAnsi(text)) {
    const only: AnsiSpan = new AnsiSpan();
    only.text = text;
    return [only];
  }

  const cleaned: string = applyCarriageReturns(text);
  const segments: AnsiSpan[] = [];
  let fg: string = '';
  let bg: string = '';
  let bold: boolean = false;
  let dim: boolean = false;
  let italic: boolean = false;
  let underline: boolean = false;
  let strike: boolean = false;
  let inverse: boolean = false;

  const push = (t: string): void => {
    if (t.length === 0) { return; }
    const s: AnsiSpan = new AnsiSpan();
    s.text = t;
    s.fg = fg;
    s.bg = bg;
    s.bold = bold;
    s.dim = dim;
    s.italic = italic;
    s.underline = underline;
    s.strike = strike;
    s.inverse = inverse;
    segments.push(s);
  };

  const applySgr = (paramStr: string): void => {
    const params: number[] = paramStr === ''
      ? [0]
      : paramStr.split(';').map((p: string): number => parseInt(p, 10));
    let i: number = 0;
    while (i < params.length) {
      const p: number = params[i];
      if (p === 0) {
        fg = '';
        bg = '';
        bold = false; dim = false; italic = false; underline = false; strike = false; inverse = false;
      } else if (p === 1) { bold = true; }
      else if (p === 2) { dim = true; }
      else if (p === 3) { italic = true; }
      else if (p === 4) { underline = true; }
      else if (p === 7) { inverse = true; }
      else if (p === 9) { strike = true; }
      else if (p === 21 || p === 22) { bold = false; dim = false; }
      else if (p === 23) { italic = false; }
      else if (p === 24) { underline = false; }
      else if (p === 27) { inverse = false; }
      else if (p === 29) { strike = false; }
      else if (p >= 30 && p <= 37) { fg = pal[p - 30]; }
      else if (p === 39) { fg = ''; }
      else if (p >= 40 && p <= 47) { bg = pal[p - 40]; }
      else if (p === 49) { bg = ''; }
      else if (p >= 90 && p <= 97) { fg = pal[p - 90 + 8]; }
      else if (p >= 100 && p <= 107) { bg = pal[p - 100 + 8]; }
      else if (p === 38 || p === 48) {
        const mode: number = params[i + 1];
        let consumed: number = 1;
        let color: string = '';
        if (mode === 5 && Number.isInteger(params[i + 2])) {
          color = color256(params[i + 2], pal);
          consumed = 3;
        } else if (mode === 2 && Number.isInteger(params[i + 2])
          && Number.isInteger(params[i + 3]) && Number.isInteger(params[i + 4])) {
          color = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
          consumed = 5;
        }
        if (color !== '') {
          if (p === 38) { fg = color; } else { bg = color; }
          i += consumed;
          continue;
        }
      }
      i++;
    }
  };

  let last: number = 0;
  ESCAPE_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ESCAPE_RE.exec(cleaned);
  while (m !== null) {
    const idx: number = m.index;
    if (idx > last) { push(cleaned.substring(last, idx)); }
    const raw: string = m[0];
    const csi: RegExpExecArray | null = CSI_RE.exec(raw);
    if (csi !== null && csi[2] === 'm') {
      applySgr(csi[1].split('?').join(''));
    }
    // 其余转义（光标移动、OSC…）直接丢弃
    last = idx + raw.length;
    m = ESCAPE_RE.exec(cleaned);
  }
  push(cleaned.substring(last));
  return segments;
}

/**
 * 找"尾部未完成转义"的起点索引（无则 -1）。供**渲染层可选**使用：把这段尾巴推迟到
 * 下一 delta 再渲染，即可消掉流式期间的瞬态残片闪动（如 `\x1b[31` 的 "31"）。
 * 注意：这不改变 `parseAnsi` 的语义，只是一个"该从哪切"的边界提示。
 */
export function incompleteTail(text: string): number {
  const esc: number = text.lastIndexOf('\x1b');
  if (esc < 0) { return -1; }
  const tail: string = text.substring(esc);
  // 完整序列 ⇒ 不是未完成
  if (CSI_RE.test(tail)) { return -1; }
  // 仍是 OSC 开头（未见 BEL / ST 收尾）
  if (/^\x1b\][^\x07]*$/.test(tail)) { return esc; }
  // 仍是 CSI 开头（未见终止字母）
  if (/^\x1b\[[0-9;?]*$/.test(tail)) { return esc; }
  // 孤立 ESC
  if (tail === '\x1b') { return esc; }
  return -1;
}
