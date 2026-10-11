/**
 * Markdown 解析（ArkTS 原生实现，零依赖）。
 *
 * 为什么自己做：Web 版用 react-markdown + remark/rehype，生态无法移植到 ArkTS
 * （见 docs/ARCHITECTURE.md）。这里实现**聊天里真正会出现**的子集：
 *   块级：标题 / 段落 / 无序·有序列表 / 围栏代码块 / 引用 / 分隔线 / 表格
 *   行内：粗体 / 斜体 / 行内代码 / 链接 / 删除线
 * 复杂图表（mermaid）、公式（katex）不在原生范围 —— 那类消息走 ArkWeb 面板。
 */

export enum MdBlockKind {
  Paragraph = 0,
  Heading = 1,
  List = 2,
  Code = 3,
  Quote = 4,
  Divider = 5,
  Table = 6,
}

export class MdBlock {
  /**
   * 渲染用的稳定 key（**内容派生**，不含下标）。
   * 用下标做 key 时，流式内容增长会让块的 key 漂移 ⇒ ArkUI 复用/错位组件 ⇒ 视觉错乱。
   */
  key: string = '';
  /**
   * 本块在**源串**里的起始字符偏移（供流式"按块增量复用"定位重解析起点）。
   * 见 `parseMarkdownCached`：追加文本不可能改动除最后一个块之外的块 ⇒ 从其起点重解析尾部。
   */
  start: number = 0;
  kind: MdBlockKind = MdBlockKind.Paragraph;
  /** 标题级别 1..6；列表嵌套层级 0.. */
  level: number = 0;
  /** 有序列表？ */
  ordered: boolean = false;
  /** 段落/标题/引用/列表项的文本（行内语法待 parseInline 处理） */
  text: string = '';
  /** 列表项（已含各自的行内标记） */
  items: string[] = [];
  /**
   * 与 `items` 一一对应的**逐项嵌套级别**（0 = 顶层）。
   * ⚠️ 不能用 `level`（它只记首项）：`- A` / `  - A1` 这类嵌套列表此前所有项共用首项缩进
   *   ⇒ 嵌套被拍平（web 会真正缩进嵌套子列表）。修见 `parseMarkdown` 列表分支。
   */
  itemLevels: number[] = [];
  /**
   * 与 `items` 一一对应的**任务列表勾选态**（`-1` = 非任务项；`0` = `[ ]`；`1` = `[x]`）。
   * web 走 remark-gfm ⇒ `- [ ]`/`- [x]` 渲染成 checkbox（`MarkdownRenderer.tsx:31` 的 remarkGfm）；
   * 原生此前把 `[ ]` 当**字面文本**上屏（缺失）。修见 `parseMarkdown` 列表分支。
   */
  itemChecked: number[] = [];
  /** 代码围栏语言 */
  lang: string = '';
  /** 代码正文 */
  code: string = '';
  /** 表格：表头 + 行（单元格文本） */
  header: string[] = [];
  rows: string[][] = [];
}

export class MdSpan {
  text: string = '';
  bold: boolean = false;
  italic: boolean = false;
  code: boolean = false;
  strike: boolean = false;
  /** 非空表示这是一个链接（存 href） */
  link: string = '';
  /** 非空表示这是一张图片（存 src）——xbot 的图片引用是 cookie 鉴权端点，需自行取字节渲染 */
  image: string = '';
}

export function parseMarkdown(src: string): MdBlock[] {
  mdParseChars += src.length;
  const blocks: MdBlock[] = [];
  const lines: string[] = src.replace(/\r\n/g, '\n').split('\n');
  // 每行在 src 里的起始偏移（供"按块增量复用"定位重解析起点）
  const lineOff: number[] = [];
  {
    let acc: number = 0;
    for (let k = 0; k < lines.length; k++) {
      lineOff.push(acc);
      acc += lines[k].length + 1;
    }
  }
  let i: number = 0;
  let para: string[] = [];
  let paraStart: number = 0;
  /** 下一段行是否**另起一行**（上一行硬换行 ⇒ true）。软换行 ⇒ 折成空格（对齐 web/CommonMark）。 */
  let pendingHard: boolean = false;

  const flushPara = (): void => {
    if (para.length === 0) {
      return;
    }
    const b: MdBlock = new MdBlock();
    b.kind = MdBlockKind.Paragraph;
    b.text = para.join('\n');
    b.start = lineOff[paraStart];
    blocks.push(b);
    para = [];
    pendingHard = false;
  };

  while (i < lines.length) {
    const raw: string = lines[i];
    const line: string = raw.replace(/\s+$/, '');

    // 空行 → 段落结束
    if (line.trim().length === 0) {
      flushPara();
      i++;
      continue;
    }

    // 围栏代码块
    const fence: RegExpMatchArray | null = line.match(/^\s*(```+|~~~+)\s*([\w#+-]*)\s*$/);
    if (fence !== null) {
      flushPara();
      const marker: string = fence[1].charAt(0);
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Code;
      b.lang = fence[2] !== undefined ? fence[2] : '';
      b.start = lineOff[i];
      i++;
      const body: string[] = [];
      while (i < lines.length) {
        const l: string = lines[i];
        if (l.trim().startsWith(marker.repeat(3))) {
          i++;
          break;
        }
        body.push(l);
        i++;
      }
      b.code = body.join('\n');
      blocks.push(b);
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara();
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Divider;
      b.start = lineOff[i];
      blocks.push(b);
      i++;
      continue;
    }

    // 标题
    const h: RegExpMatchArray | null = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h !== null) {
      flushPara();
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Heading;
      b.level = h[1].length;
      b.text = h[2].trim();
      b.start = lineOff[i];
      blocks.push(b);
      i++;
      continue;
    }

    // 引用（连续行合并）
    if (/^\s{0,3}>\s?/.test(line)) {
      flushPara();
      const qStart: number = i;
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Quote;
      b.text = body.join('\n');
      b.start = lineOff[qStart];
      blocks.push(b);
      continue;
    }

    // 表格（表头 + 分隔行）
    if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushPara();
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Table;
      b.header = splitRow(line);
      b.start = lineOff[i];
      i += 2;
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim().length > 0) {
        b.rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(b);
      continue;
    }

    // 列表（- / * / + 或 1. ）
    const li: RegExpMatchArray | null = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li !== null) {
      flushPara();
      const lStart: number = i;
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.List;
      b.ordered = /\d/.test(li[2]);
      b.level = Math.floor(li[1].length / 2);
      b.start = lineOff[lStart];
      while (i < lines.length) {
        const m: RegExpMatchArray | null = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m === null) {
          break;
        }
        // 任务列表项（GFM）：`[ ]`/`[x]`/`[X]` 前缀 ⇒ 记勾选态并从正文剥掉前缀。
        // web 走 remark-gfm（`MarkdownRenderer.tsx:31`）渲染成 checkbox；原生此前当字面文本上屏。
        let text: string = m[3];
        let checked: number = -1;
        if (text.length >= 3 && text.charAt(0) === '[' && text.charAt(2) === ']') {
          const c: string = text.charAt(1);
          if (c === ' ' || c === 'x' || c === 'X') {
            checked = (c === 'x' || c === 'X') ? 1 : 0;
            text = text.substring(3).replace(/^\s+/, '');
          }
        }
        b.items.push(text);
        // 逐项嵌套级别（按缩进宽度 / 2）——不再只用首项级别（否则嵌套被拍平）。
        b.itemLevels.push(Math.floor(m[1].length / 2));
        b.itemChecked.push(checked);
        i++;
      }
      blocks.push(b);
      continue;
    }

    if (para.length === 0) {
      paraStart = i;
    }
    // ── 软换行 / 硬换行（对齐 web/CommonMark）────────────────────────────────
    // 段内换行默认是**软换行**（折成空格）；仅当上一行行尾有 **2+ 空格** 或 **反斜杠**
    // 才是硬换行（保留换行）。此前一律 `para.push(line.trim())` + `join('\n')` ⇒
    // 每个软换行都被当硬换行上屏（web 会折成空格）—— 这是"段落在手机上被切得比 web 碎"的成因。
    const trimmed: string = line.trim();
    const endsBackslash: boolean = trimmed.length > 1 && trimmed.endsWith('\\')
      && !trimmed.endsWith('\\\\');
    const body: string = endsBackslash ? trimmed.substring(0, trimmed.length - 1) : trimmed;
    if (para.length === 0) {
      para.push(body);
    } else if (pendingHard) {
      para.push(body);
    } else {
      para[para.length - 1] = para[para.length - 1] + ' ' + body;
    }
    // 本行是否硬换行：行尾 2+ 空格（看**原始**行，因为 `line` 已 strip 尾部空白）或反斜杠。
    pendingHard = /\s{2,}$/.test(lines[i]) || endsBackslash;
    i++;
  }
  flushPara();
  assignKeys(blocks);
  return blocks;
}

/**
 * 生成稳定 key（内容派生 + **全局下标**）。
 * ⚠️ 增量拼接后必须对**整体**重编号：尾部解析出来的下标从 0 起，
 * 若只给尾部编号就会与头部撞 key ⇒ ArkUI 复用错位（渲染错乱）。
 */
function assignKeys(blocks: MdBlock[]): void {
  for (let k = 0; k < blocks.length; k++) {
    const b: MdBlock = blocks[k];
    const sig: string = `${b.kind}|${b.level}|${b.text.length}|${b.items.length}|${b.code.length}|${b.header.length}|${b.rows.length}`;
    b.key = `md-${sig}-${k}`;
  }
}

function splitRow(line: string): string[] {
  let s: string = line.trim();
  if (s.startsWith('|')) {
    s = s.substring(1);
  }
  if (s.endsWith('|')) {
    s = s.substring(0, s.length - 1);
  }
  const cells: string[] = s.split('|');
  const out: string[] = [];
  for (let k = 0; k < cells.length; k++) {
    out.push(cells[k].trim());
  }
  return out;
}

/** 行内解析：粗体 / 斜体 / 行内码 / 删除线 / 链接。 */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  let buf: string = '';
  let i: number = 0;

  const pushPlain = (bold: boolean, italic: boolean, strike: boolean): void => {
    if (buf.length === 0) {
      return;
    }
    const s: MdSpan = new MdSpan();
    s.text = buf;
    s.bold = bold;
    s.italic = italic;
    s.strike = strike;
    spans.push(s);
    buf = '';
  };

  while (i < text.length) {
    // 行内代码
    if (text.charAt(i) === '`') {
      const end: number = text.indexOf('`', i + 1);
      if (end > i) {
        pushPlain(false, false, false);
        const s: MdSpan = new MdSpan();
        s.text = text.substring(i + 1, end);
        s.code = true;
        spans.push(s);
        i = end + 1;
        continue;
      }
    }
    // 图片 ![alt](src)
    if (text.charAt(i) === '!' && text.charAt(i + 1) === '[') {
      const close: number = text.indexOf(']', i + 2);
      if (close > i && text.charAt(close + 1) === '(') {
        const paren: number = text.indexOf(')', close + 2);
        if (paren > close) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan();
          s.text = text.substring(i + 2, close);
          s.image = text.substring(close + 2, paren);
          spans.push(s);
          i = paren + 1;
          continue;
        }
      }
    }
    // 链接 [text](href)
    if (text.charAt(i) === '[') {
      const close: number = text.indexOf(']', i + 1);
      if (close > i && text.charAt(close + 1) === '(') {
        const paren: number = text.indexOf(')', close + 2);
        if (paren > close) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan();
          s.text = text.substring(i + 1, close);
          s.link = text.substring(close + 2, paren);
          spans.push(s);
          i = paren + 1;
          continue;
        }
      }
    }
    // 粗体 **text** 或 __text__
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const marker: string = text.substring(i, i + 2);
      const end: number = text.indexOf(marker, i + 2);
      if (end > i) {
        pushPlain(false, false, false);
        const s: MdSpan = new MdSpan();
        s.text = text.substring(i + 2, end);
        s.bold = true;
        spans.push(s);
        i = end + 2;
        continue;
      }
    }
    // 删除线 ~~text~~
    if (text.startsWith('~~', i)) {
      const end: number = text.indexOf('~~', i + 2);
      if (end > i) {
        pushPlain(false, false, false);
        const s: MdSpan = new MdSpan();
        s.text = text.substring(i + 2, end);
        s.strike = true;
        spans.push(s);
        i = end + 2;
        continue;
      }
    }
    // 斜体 *text* 或 _text_
    const ch: string = text.charAt(i);
    if ((ch === '*' || ch === '_') && !text.startsWith(ch + ch, i)) {
      const end: number = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        pushPlain(false, false, false);
        const s: MdSpan = new MdSpan();
        s.text = text.substring(i + 1, end);
        s.italic = true;
        spans.push(s);
        i = end + 1;
        continue;
      }
    }
    buf += text.charAt(i);
    i++;
  }
  pushPlain(false, false, false);
  return spans;
}

/** 供预览/通知类场景用的纯文本化（去掉标记）。 */
export function markdownToPlain(src: string): string {
  const blocks: MdBlock[] = parseMarkdown(src);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b: MdBlock = blocks[i];
    if (b.kind === MdBlockKind.Code) {
      out.push(b.code);
    } else if (b.kind === MdBlockKind.List) {
      out.push(b.items.join(' '));
    } else if (b.kind === MdBlockKind.Table) {
      out.push(b.header.join(' '));
    } else if (b.text.length > 0) {
      const spans: MdSpan[] = parseInline(b.text);
      let line: string = '';
      for (let k = 0; k < spans.length; k++) {
        line += spans[k].text;
      }
      out.push(line);
    }
  }
  return out.join('\n');
}


// ── 解析结果缓存（纯优化：同样的文本必然解析出同样的结果）─────────────────────────────
/**
 * 为什么必须有：`MarkdownView.build()` 在**渲染路径里**直接调 parseMarkdown / parseInline，
 * 而行级 ForEach 的 key 含 `row.rev`（数据一变就换 key ⇒ 整行重建）⇒ 流式期间每来一个
 * SSE 事件都要把该 turn **全部**迭代块的 Markdown 重新解析一遍。实测单行正文可达 274 KB
 * （108 个迭代块）⇒ 这就是"卡到完全没法用"的直接机制。
 *
 * 键 = **原文本身**（不是 hash、不是长度）：同样的文本必然得到同样的结果，所以
 * ① 不存在碰撞导致的错内容；② 内容一变键就变 ⇒ 不存在陈旧结果。缓存是**纯优化，不改语义**。
 * 容量按总字符数封顶，超限按插入顺序淘汰最早的。
 */
export class MdCacheStats {
  /** 命中次数（省下的解析次数） */
  hits: number = 0;
  misses: number = 0;
  /** 当前缓存占用字符数 */
  chars: number = 0;
  /** 当前缓存条目数 */
  entries: number = 0;
  /**
   * **实际喂给解析器的字符总量**（每次 `parseMarkdown` 入参长度之和）。
   * 这是"流式重解析开销"的**唯一可测口径**：前缀链全量重解析 ⇒ ≈ 文档 × 渲染次数 / 2（近二次）；
   * 按块增量复用 ⇒ ≈ 文档规模（×1.x）。见 `tools/tests/mdview_perf.test.ts`。
   */
  parseChars: number = 0;
}

const MD_CACHE_MAX_CHARS: number = 2 * 1024 * 1024;

let mdBlockCache: Map<string, MdBlock[]> = new Map<string, MdBlock[]>();
let mdBlockOrder: string[] = [];
let mdBlockChars: number = 0;

let mdSpanCache: Map<string, MdSpan[]> = new Map<string, MdSpan[]>();
let mdSpanOrder: string[] = [];
let mdSpanChars: number = 0;

let mdCacheHits: number = 0;
let mdCacheMisses: number = 0;
/** 喂给解析器的字符总量（见 `MdCacheStats.parseChars`）。 */
let mdParseChars: number = 0;

/** 上一次解析的原文与其结果 —— 供**按块增量复用**（见 `parseMarkdownCached`）。 */
let mdLastSrc: string = '';
let mdLastBlocks: MdBlock[] = [];

/** 解析 Markdown（带缓存 + **按块增量复用**）。渲染路径一律走这个。 */
export function parseMarkdownCached(src: string): MdBlock[] {
  const hit: MdBlock[] | undefined = mdBlockCache.get(src);
  if (hit !== undefined) {
    mdCacheHits++;
    mdLastSrc = src;
    mdLastBlocks = hit;
    return hit;
  }
  mdCacheMisses++;
  let blocks: MdBlock[];
  if (mdLastBlocks.length > 1 && src.length > mdLastSrc.length && src.startsWith(mdLastSrc)) {
    // ── 按块增量复用（流式：src 是上一个 src 的**超集**）────────────────────────────
    // 解析器是**逐行顺序**的，且除**最后一个块**之外，每个块都由空行/构造终止符封闭
    // ⇒ 追加文本只可能改动"最后一个（仍在生长的）块"。故只从它的起点重解析尾部。
    // 效果：喂给解析器的字符量从"前缀求和（近二次）"降到 ≈ 文档规模。
    // 正确性由 `tools/tests/md_cache.test.ts`（内容一致）+ `mdview_perf.test.ts`（比值）守护。
    const stable: number = mdLastBlocks.length - 1;
    const rewind: number = mdLastBlocks[stable].start;
    const tail: MdBlock[] = parseMarkdown(src.substring(rewind));
    for (let k = 0; k < tail.length; k++) {
      tail[k].start += rewind;
    }
    blocks = mdLastBlocks.slice(0, stable).concat(tail);
    assignKeys(blocks);
  } else {
    blocks = parseMarkdown(src);
  }
  mdLastSrc = src;
  mdLastBlocks = blocks;
  mdBlockCache.set(src, blocks);
  mdBlockOrder.push(src);
  mdBlockChars += src.length;
  // 淘汰：至少保留刚写入的一条（单条超预算时不能把自己也删了）
  while (mdBlockChars > MD_CACHE_MAX_CHARS && mdBlockOrder.length > 1) {
    const oldest: string = mdBlockOrder[0];
    mdBlockOrder.splice(0, 1);
    mdBlockCache.delete(oldest);
    mdBlockChars -= oldest.length;
  }
  return blocks;
}

/**
 * 清空全部解析缓存与计数器。
 * ⚠️ **仅供测试**从干净状态度量（生产路径不调用）。
 */
export function resetMdCache(): void {
  mdBlockCache = new Map<string, MdBlock[]>();
  mdBlockOrder = [];
  mdBlockChars = 0;
  mdSpanCache = new Map<string, MdSpan[]>();
  mdSpanOrder = [];
  mdSpanChars = 0;
  mdCacheHits = 0;
  mdCacheMisses = 0;
  mdParseChars = 0;
  mdLastSrc = '';
  mdLastBlocks = [];
}

/** 解析行内片段（带缓存）。 */
export function parseInlineCached(text: string): MdSpan[] {
  const hit: MdSpan[] | undefined = mdSpanCache.get(text);
  if (hit !== undefined) {
    mdCacheHits++;
    return hit;
  }
  mdCacheMisses++;
  const spans: MdSpan[] = parseInline(text);
  mdSpanCache.set(text, spans);
  mdSpanOrder.push(text);
  mdSpanChars += text.length;
  while (mdSpanChars > MD_CACHE_MAX_CHARS && mdSpanOrder.length > 1) {
    const oldest: string = mdSpanOrder[0];
    mdSpanOrder.splice(0, 1);
    mdSpanCache.delete(oldest);
    mdSpanChars -= oldest.length;
  }
  return spans;
}

/** 缓存统计（自检页显示，用于确认真机上也真的在命中）。 */
export function mdCacheStats(): MdCacheStats {
  const st: MdCacheStats = new MdCacheStats();
  st.hits = mdCacheHits;
  st.misses = mdCacheMisses;
  st.chars = mdBlockChars + mdSpanChars;
  st.entries = mdBlockOrder.length + mdSpanOrder.length;
  st.parseChars = mdParseChars;
  return st;
}


// ── 表格布局判定（纯函数：可脱离 SDK 单测）───────────────────────────────────
/**
 * 表格**等宽网格**能容忍的最大列数。
 *
 * 为什么是 4：手机可用宽度约 360–420dp，等宽网格下每列 ≈ 可用宽度 / 列数。
 * 实测真实会话里存在 5/7/8 列的表格（`{2:544, 3:490, 5:267, 4:218, 8:6, 7:5}`）——
 * 8 列时每列只有 ~40dp，中文会被压成**竖条**，这正是"渲染整个都是错乱的、完全用不了"的成因之一。
 * 超过该列数就改用**堆叠形态**（每行 = `字段: 值`），只用 Column/Row/Text（真机已验证可渲染）。
 */
export const TABLE_GRID_MAX_COLS: number = 4;

/** 该列数是否应使用等宽网格（否则用堆叠形态）。纯函数，便于单测锁死阈值。 */
export function useTableGrid(cols: number): boolean {
  return cols > 0 && cols <= TABLE_GRID_MAX_COLS;
}

/** 堆叠形态里的一行字段。 */
export class TableField {
  label: string = '';
  value: string = '';
}

/**
 * 把一行表格单元与表头配对成"字段: 值"列表（堆叠形态用）。
 *
 * 表头缺失时回落 `列N`（**显式**而非留空）；单元格少于表头时补空串；
 * 单元格多于表头时同样用 `列N` 兜底（不丢数据）。
 */
export function tableRowFields(header: string[], row: string[]): TableField[] {
  const out: TableField[] = [];
  const n: number = row.length > header.length ? row.length : header.length;
  for (let i = 0; i < n; i++) {
    const f: TableField = new TableField();
    const h: string | undefined = header[i];
    f.label = h !== undefined && h.length > 0 ? h : `列${i + 1}`;
    const c: string | undefined = row[i];
    f.value = c !== undefined ? c : '';
    out.push(f);
  }
  return out;
}
