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
  /**
   * 块公式 `$$…$$`（web `remark-math` + KaTeX 的 `math` 节点）。
   * ⛔ 原生**没有** JS 引擎 ⇒ 不跑 KaTeX：正文原样保存（`code`），渲染成等宽公式块。
   *    "能力对齐"= 结构/边界与 web 一致（识别、去定界符、流式裁剪），**不是**排版一致。
   */
  Math = 7,
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
  /**
   * 表格**逐列对齐**（GFM 分隔行 `:---`/`:---:`/`---:` ⇒ `0`=左 / `1`=中 / `2`=右；默认左）。
   * web 走 remark-gfm ⇒ `<th align>` / 内联 `style="text-align"`（`MarkdownRenderer.tsx:31`）；
   * 原生此前**忽略对齐**（一律左）。长度可能 < 列数 ⇒ 取值用 `alignOf` 兜底。
   */
  aligns: number[] = [];
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
  /**
   * 行内公式 `$…$`（web `remark-math` 的 `inlineMath`）。
   * ⛔ 不跑 KaTeX ⇒ 渲染成"等宽 + 强调底色"的公式片段（结构性对齐，排版不承诺）。
   */
  math: boolean = false;
}

/**
 * 剥掉**文档开头**的 YAML frontmatter（web `lib/markdown.ts:stripFrontmatter` 的对等物）。
 *
 * 为什么必须：SKILL.md / 一些模型输出以 `---\nkey: value\n---` 开头；CommonMark 会把
 * 文档中部的 `---` 当 setext 标题下划线 ⇒ frontmatter 被渲染成一个吞掉 YAML 的标题。
 * web 在解析前剥掉（`MarkdownRenderer.tsx:515` 的 `stripFrontmatter(content)`）⇒ 原生对齐。
 *
 * 口径与 web 一致：**只**认文档开头的成对 `---`；中部的 `---`（水平线）与未闭合的头部原样保留。
 */
export function stripFrontmatter(src: string): string {
  if (src === undefined || src === null) {
    return '';
  }
  const m: RegExpExecArray | null = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/.exec(src);
  if (m === null) {
    return src;
  }
  const rest: string = src.substring(m[0].length);
  // 块后通常还有一个空行（`---\n\n# 标题`）⇒ 吃掉一个，避免顶部多出一条空行
  return rest.startsWith('\n') ? rest.substring(1) : rest;
}

/**
 * TeX 定界符归一（web `normalizeMathDelimiters`，`MarkdownRenderer.tsx:351-375` 逐条对等）。
 *
 * 模型常写 `\(…\)` / `\[…\]`，而 remark-math 只认 `$…$` / `$$…$$` ⇒ web 在解析前统一。
 * **只**在代码围栏与行内代码**之外**替换（否则代码里的 `\(` 会被改写）。
 */
export function normalizeMathDelimiters(src: string): string {
  if (src === undefined || src === null || src.length === 0) {
    return '';
  }
  const lines: string[] = src.split('\n');
  let fence: string = '';
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line: string = lines[i];
    const nextFence: string = fenceAfterLine(line, fence);
    if (fence.length > 0 || nextFence.length > 0) {
      fence = nextFence;
      out.push(line);
      continue;
    }
    // 行内代码段按 `(`+`…`+`)` 切开：奇数下标是代码，原样保留
    const parts: string[] = line.split(/(`+[^`]*`+)/g);
    const rebuilt: string[] = [];
    for (let p = 0; p < parts.length; p++) {
      if (p % 2 === 1) {
        rebuilt.push(parts[p]);
        continue;
      }
      rebuilt.push(parts[p]
        .split('\\[').join('$$')
        .split('\\]').join('$$')
        .split('\\(').join('$')
        .split('\\)').join('$'));
    }
    out.push(rebuilt.join(''));
  }
  return out.join('\n');
}

/** 围栏状态推进（`fence` 为空 = 在围栏外；返回"处理完本行后"的围栏标记）。 */
function fenceAfterLine(line: string, fence: string): string {
  const m: RegExpExecArray | null = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (m === null) {
    return fence;
  }
  const marker: string = m[1];
  const suffix: string = m[2];
  if (fence.length === 0) {
    // 开围栏：``` 后紧跟反引号是非法的 info string（CommonMark）⇒ 不视为围栏
    return marker.charAt(0) === '`' && suffix.indexOf('`') >= 0 ? '' : marker;
  }
  const sameChar: boolean = marker.charAt(0) === fence.charAt(0);
  const longEnough: boolean = marker.length >= fence.length;
  const bare: boolean = /^[ \t]*$/.test(suffix);
  return sameChar && longEnough && bare ? '' : fence;
}

/**
 * 流式期裁掉**未闭合**的公式尾部（web `clipTrailingUnclosedMath`，
 * `MarkdownRenderer.tsx:397-467` 逐条对等）。
 *
 * 为什么：`$$` 未闭合时，web 的 remark-math 会把到结尾的内容全吞进 KaTeX；原生虽然不跑
 * KaTeX，但半截 TeX（`\begin{aligned}` / `&` / `\\`）会以纯文本一直往上堆 —— 同样难看。
 * web 的口径是"只显示**完整**公式"：裁到最后一个未配对的 `$$`（或末行未配对的 `$`）。
 *
 * ⛔ 绝不返回空串：`$$` 落在内容最前面时 `slice(0,0)===''` ⇒ 整条消息空白（web 的
 *    `:429-436` 踩过这个坑）⇒ 此时把定界符**转义成普通文本**，其余内容照常显示。
 */
export function clipTrailingUnclosedMath(src: string): string {
  if (src === undefined || src === null || src.length === 0) {
    return '';
  }
  const lines: string[] = src.split('\n');
  let fence: string = '';
  let openBlockAt: number = -1;
  let offset: number = 0;
  for (let i = 0; i < lines.length; i++) {
    const line: string = lines[i];
    const lineStart: number = offset;
    offset += line.length + 1;
    const nextFence: string = fenceAfterLine(line, fence);
    if (fence.length > 0 || nextFence.length > 0) {
      fence = nextFence;
      continue;
    }
    const parts: string[] = line.split(/(`+[^`]*`+)/g);
    let col: number = 0;
    for (let p = 0; p < parts.length; p++) {
      const part: string = parts[p];
      const partStart: number = lineStart + col;
      col += part.length;
      if (p % 2 === 1) {
        continue;
      }
      let idx: number = part.indexOf('$$');
      while (idx !== -1) {
        openBlockAt = openBlockAt === -1 ? partStart + idx : -1;
        idx = part.indexOf('$$', idx + 2);
      }
    }
  }
  if (openBlockAt !== -1) {
    const clipped: string = src.substring(0, openBlockAt);
    if (clipped.trim().length === 0) {
      return '\\$\\$' + src.substring(openBlockAt + 2);
    }
    return clipped;
  }
  // 没有未闭合的块公式 ⇒ 看**最后一行**有没有未闭合的行内 `$`（remark-math 只按行配对）
  const lastLine: string = lines.length > 0 ? lines[lines.length - 1] : '';
  const parts: string[] = lastLine.split(/(`+[^`]*`+)/g);
  let lastSingleDollar: number = -1;
  let col: number = 0;
  for (let p = 0; p < parts.length; p++) {
    const part: string = parts[p];
    const partStart: number = col;
    col += part.length;
    if (p % 2 === 1) {
      continue;
    }
    let idx: number = part.indexOf('$');
    while (idx !== -1) {
      if (part.startsWith('$$', idx)) {
        idx = part.indexOf('$', idx + 2);
        continue;
      }
      lastSingleDollar = partStart + idx;
      idx = part.indexOf('$', idx + 1);
    }
  }
  if (lastSingleDollar !== -1) {
    const cut: number = src.length - (lastLine.length - lastSingleDollar);
    const head: string = src.substring(0, cut);
    return head.endsWith('\n') ? head.substring(0, head.length - 1) : head;
  }
  return src;
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

    // 块公式 `$$…$$`（web `remark-math` 的 `math` 节点）—— 必须在"段落/分隔线"之前判，
    // 否则 `$$` 行会被当普通段落吞掉（原生此前就是纯文本上屏）。
    if (line.trim().startsWith('$$')) {
      flushPara();
      const b: MdBlock = new MdBlock();
      b.kind = MdBlockKind.Math;
      b.start = lineOff[i];
      const head: string = line.trim().substring(2);
      if (head.endsWith('$$') && head.length >= 2) {
        // 单行形态：`$$E=mc^2$$`
        b.code = head.substring(0, head.length - 2).trim();
        i++;
      } else {
        // 多行形态：收集到以 `$$` 结尾的行（未闭合 ⇒ 吃到文档尾，由流式裁剪兜底）
        const body: string[] = [];
        if (head.trim().length > 0) {
          body.push(head);
        }
        i++;
        while (i < lines.length) {
          const l: string = lines[i];
          if (l.trim().endsWith('$$')) {
            const cut: string = l.trim();
            const inner: string = cut.substring(0, cut.length - 2);
            if (inner.trim().length > 0) {
              body.push(inner);
            }
            i++;
            break;
          }
          body.push(l);
          i++;
        }
        b.code = body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
      }
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
      b.aligns = tableAlignsOf(lines[i + 1]);
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
 *
 * ⚠️ 增量拼接后，尾部解析出来的下标从 0 起 ⇒ 必须按**全局下标**重编号，否则与头部撞 key
 * ⇒ ArkUI 复用错位（渲染错乱）。
 *
 * ⛔ `from` 的语义（性能，2026-10-11 round3）：key 是 `(块内容, 下标)` 的**纯函数**
 *    （`sig` 只由块内容算，`k` 是下标）。增量路径里头部 `0..stable-1` 的块在**上一拍**已按
 *    **同一 (内容, 下标)** 写过 key ⇒ 跳过它们**逐字不变**（`assignKeys(blocks)` 与
 *    `assignKeys(blocks, stable)` 的最终状态相同）。`from=0`（默认）即旧行为。
 *    ⇒ 把"每拍对**全体**块重编号"（O(总块数)，随文档增长 = O(n²)）降为 O(尾部块数)。
 *    判据：`tools/tests/stream_perf_equiv.test.ts`（尾部重编号 ≡ 全量重编号，逐块 key 相等）。
 */
/**
 * 块**内容指纹**（FNV-1a，O(内容)；`assignKeys` 与解析同阶，不引入额外数量级）。
 *
 * ⛔ 为什么必须含逐项/逐格内容（用户 2026-10-27 亲报「打字机遇列表/表格漏字」）：
 *   旧 sig 只有 `items.length` / `rows.length` / `text.length` —— 列表项或表格单元格**内容增长**
 *   （条目数、行数、`text` 都不变）时块 key 一模一样 ⇒ ArkUI `ForEach` **复用旧子树、不重跑
 *   item builder** ⇒ 已经上屏的那一项/那一格永远停在旧文本，新打的字**不上屏**（= 漏字）。
 *   web 用「整篇解析成 DOM，只裁文本节点」（`MarkdownRenderer.tsx:clipTextNodes`）没有这个失效面。
 */
function blockContentHash(b: MdBlock): number {
  let h: number = 2166136261;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    h = (h ^ 0x1f) >>> 0;   // 段分隔（避免 ["ab",""] 与 ["a","b"] 同哈希）
  };
  feed(b.text);
  feed(b.code);
  feed(b.lang);
  for (let i = 0; i < b.items.length; i++) {
    feed(b.items[i]);
  }
  for (let i = 0; i < b.header.length; i++) {
    feed(b.header[i]);
  }
  for (let i = 0; i < b.rows.length; i++) {
    const r: string[] = b.rows[i];
    for (let k = 0; k < r.length; k++) {
      feed(r[k]);
    }
    feed('|');
  }
  return h;
}

function assignKeys(blocks: MdBlock[], from: number = 0): void {
  for (let k = from; k < blocks.length; k++) {
    const b: MdBlock = blocks[k];
    // 内容哈希覆盖 text/items/header/rows 的**实际字符**（见 `blockContentHash` 的漏字注释）；
    // `items.length`/`rows.length` 保留在 sig 里只为可读性（哈希已包含它们的产物）。
    const sig: string = `${b.kind}|${b.level}|${b.text.length}|${b.items.length}|${b.code.length}`
      + `|${b.header.length}|${b.rows.length}|${b.aligns.length}|${blockContentHash(b)}`;
    b.key = `md-${sig}-${k}`;
  }
}

/**
 * 找**等长**的反引号 run（CommonMark 的 code span 配对规则：开 n 个反引号就必须用 n 个闭合）。
 * 返回 run 的起始下标；找不到 ⇒ `-1`。
 */
function backtickRunAt(s: string, from: number, n: number): number {
  let i: number = from;
  while (i < s.length) {
    if (s.charCodeAt(i) !== 96) {
      i++;
      continue;
    }
    let run: number = 0;
    while (i + run < s.length && s.charCodeAt(i + run) === 96) {
      run++;
    }
    if (run === n) {
      return i;
    }
    i += run;
  }
  return -1;
}

/**
 * 切表格行（GFM）：**尊重行内代码**，`|` 只有**不在 code span 内**才是列分隔符。
 *
 * ⛔ 为什么必须这样（用户 2026-11-07 截图）：旧实现裸 `split('|')` —— 单元格里的
 *    `` `git diff --stat | head` `` 被切成两半，每半边只剩一个反引号 ⇒ **永远配不成对**
 *    ⇒ 反引号原样上屏（"inline code 有时候没渲染"的真因之一）。
 *    web 走 remark-gfm 的表格切分，**天然**不会在 code span 内切列。
 * 另外处理 GFM 的 `\|` 转义（单元格内的字面竖线）。
 */
function splitRow(line: string): string[] {
  let s: string = line.trim();
  if (s.startsWith('|')) {
    s = s.substring(1);
  }
  if (s.endsWith('|')) {
    s = s.substring(0, s.length - 1);
  }
  const cells: string[] = [];
  let cur: string = '';
  let i: number = 0;
  while (i < s.length) {
    const ch: string = s.charAt(i);
    // `\|` = 单元格内的字面 `|`（GFM 转义）⇒ 吃掉反斜杠，不切列
    if (ch === '\\' && i + 1 < s.length && s.charAt(i + 1) === '|') {
      cur += '|';
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n: number = 0;
      while (i + n < s.length && s.charAt(i + n) === '`') {
        n++;
      }
      const close: number = backtickRunAt(s, i + n, n);
      if (close >= 0) {
        // 整个 code span 原样并入当前单元格（其中的 `|` 不切列）
        cur += s.substring(i, close + n);
        i = close + n;
        continue;
      }
      cur += s.substring(i, i + n);
      i += n;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 表格**逐列对齐**（GFM）：解析分隔行（`| :--- | :---: | ---: |`）⇒ 每列
 * `0`=左（默认）/ `1`=中 / `2`=右。web 走 remark-gfm 的同一条规则
 * （`MarkdownRenderer.tsx:31`）；原生此前忽略对齐。
 */
export function tableAlignsOf(sep: string): number[] {
  const cells: string[] = splitRow(sep);
  const out: number[] = [];
  for (let k = 0; k < cells.length; k++) {
    const c: string = cells[k];
    const lead: boolean = c.startsWith(':');
    const trail: boolean = c.endsWith(':');
    if (lead && trail) { out.push(1); }
    else if (trail) { out.push(2); }
    else { out.push(0); }
  }
  return out;
}

/** 第 `ci` 列的对齐（数组不足/异常 ⇒ 左）。 */
export function alignOf(aligns: number[], ci: number): number {
  return ci >= 0 && ci < aligns.length ? aligns[ci] : 0;
}

/**
 * 裸链/尖括号 URL 的**终止字符**（GFM autolink literal 的边界口径）：
 * 空白、尖/引号、行内代码反引号、以及中文标点（中文正文里 URL 后面**不加空格**就接标点，
 * 不切断会把「，」「。」吃进链接 —— 用户截图里就出现过这类长串）。
 */
const URL_STOP: string = ' \t\r\n<>"\'`，。、；：！？）】》」』…—';

/** `i` 处是否是一个**裸链**起点（http:// / https:// / www.）且前一个字符是合法边界。 */
function urlStartAt(text: string, i: number): boolean {
  const prev: string = i === 0 ? '' : text.charAt(i - 1);
  const okPrev: boolean = prev === ''
    || ' \t\r\n([{<（【「《\'"“，。：；！？、'.indexOf(prev) >= 0;
  if (!okPrev) {
    return false;
  }
  return text.startsWith('https://', i) || text.startsWith('http://', i) || text.startsWith('www.', i);
}

/**
 * 从 `i` 扫到裸链结尾（不含），并削掉 GFM 会剥离的**尾随标点**：
 * `.,;:!?` 与**未配对**的右括号（`(https://a/x)` 的 `)` 不算 URL 的一部分）。
 * 返回 `-1` 表示这里不是合法裸链。
 */
function urlEndAt(text: string, i: number): number {
  if (!urlStartAt(text, i)) {
    return -1;
  }
  let end: number = i;
  while (end < text.length && URL_STOP.indexOf(text.charAt(end)) < 0) {
    end++;
  }
  // host 部分必须非空（`https://` 后面跟终止符 ⇒ 不是链接）
  const schemeLen: number = text.startsWith('https://', i) ? 8 : (text.startsWith('http://', i) ? 7 : 4);
  if (end <= i + schemeLen) {
    return -1;
  }
  while (end > i) {
    const ch: string = text.charAt(end - 1);
    if ('.,;:!?'.indexOf(ch) >= 0) {
      end--;
      continue;
    }
    if (ch === ')') {
      let open: number = 0;
      let close: number = 0;
      for (let k = i; k < end; k++) {
        const c2: string = text.charAt(k);
        if (c2 === '(') { open++; }
        if (c2 === ')') { close++; }
      }
      if (close > open) {
        end--;
        continue;
      }
    }
    break;
  }
  return end > i + schemeLen ? end : -1;
}

/** `<https://…>` / `<mailto:…>` 的括号内是否是可自动链接的绝对地址。 */
function isAngleAutolink(inner: string): boolean {
  if (inner.length === 0 || /\s/.test(inner)) {
    return false;
  }
  return inner.startsWith('https://') || inner.startsWith('http://') || inner.startsWith('mailto:');
}

/** 强调块内部的标记触发字符（只有含这些才递归解析；纯文本仍走"一个 span"快路径）。 */
const EMPH_NESTED: RegExp = /[`$]/;

/**
 * 强调内部**递归解析**（CommonMark：`**`x`**` = `<strong><code>x</code></strong>`）。
 *
 * ⛔ 根因（用户 2026-11-07 截图）：旧实现把 `**…**` / `~~…~~` / `*…*` 的内部文本整段吃成
 *    **一个纯文本 span** ⇒ 里面的 `` `x` `` 不解析、反引号原样上屏
 *    （截图里 `` `ebc178d0b2` `` 就是这样：模型把它加粗了）。
 */
function pushEmphasis(spans: MdSpan[], inner: string, kind: string): void {
  if (!EMPH_NESTED.test(inner)) {
    const s: MdSpan = new MdSpan();
    s.text = inner;
    if (kind === 'bold') {
      s.bold = true;
    } else if (kind === 'strike') {
      s.strike = true;
    } else {
      s.italic = true;
    }
    spans.push(s);
    return;
  }
  const sub: MdSpan[] = parseInline(inner);
  for (let k = 0; k < sub.length; k++) {
    const s: MdSpan = sub[k];
    if (kind === 'bold') {
      s.bold = true;
    } else if (kind === 'strike') {
      s.strike = true;
    } else {
      s.italic = true;
    }
    spans.push(s);
  }
}

/** 行内解析：粗体 / 斜体 / 行内码 / 删除线 / 链接 / **自动链接**。 */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  // ⛔ 廉价前置判据（**不改语义**，2026-10-11 round3）：文本里若**没有任何行内标记字符**
  //    （` ! [ * _ ~），则逐字符循环的每个分支都不会命中 ⇒ 唯一产物就是"整段一个纯文本 span"
  //    （`buf` 累积全文 + 末尾 `pushPlain`）。直接产出该结果、跳过 O(len) 分支扫描。
  //    空串仍返回 `[]`（旧实现末尾 `pushPlain` 因 `buf.length === 0` 不 push）⇒ 必须 `length > 0`。
  //    2026-11-06：新增自动链接后，含 `<scheme:…>` / `http(s)://` / `www.` 的文本也必须走扫描。
  if (text.length > 0 && !/[`!\[*_~$]/.test(text)
    && !/<[^\s<>]+:/.test(text) && text.indexOf('http://') < 0
    && text.indexOf('https://') < 0 && text.indexOf('www.') < 0) {
    const s: MdSpan = new MdSpan();
    s.text = text;
    spans.push(s);
    return spans;
  }
  // ── 逐字符扫描（2026-10-11 round4：charCode 快路径 + run-slice）─────────────────
  // ⛔ 为什么（实测热度）：真实单块正文 ≈2.5K 字符、含标记 ⇒ 本函数 **≈32 µs/次**
  //    （8K ⇒ ≈100 µs；对照纯文本早退 ≈2.5 µs/8K）。流式期最后一段正文每拍都在变 ⇒
  //    `parseInlineCached` 每拍未命中 ⇒ 这正是"每拍重解析"里非 Markdown 块级那一半。
  // 两处**语义不变**的改法：
  //   ① **charCode 快路径**：只有 `` ` ``(96) `!`(33) `[`(91) `*`(42) `_`(95) `~`(126)
  //      这 6 个字符可能开启任一分支；其余字符一定落进"普通文本" ⇒ 只判一次 charCode 就跳过，
  //      不再对每个字跑 7 个分支（`charAt`/`startsWith`/`indexOf`）。
  //   ② **run-slice**：普通文本段用 `(bufStart, i)` 记录区间、flush 时**一次 `substring`**，
  //      替代 `buf += text.charAt(i)` 的逐字符拼接与逐字符 `charAt` 分配。
  //    两者对任何输入都与旧实现产出**同一组 span**（旧算法即规格）—— 判据
  //    `tools/tests/stream_perf_equiv.test.ts` §11 用旧实现的**逐字复刻 oracle** 在语料上比对。
  let bufStart: number = 0;
  let i: number = 0;

  /** 把 `[bufStart, upTo)` 这段普通文本 flush 成一个 span（空段不产 span —— 与旧 `buf.length===0` 同）。 */
  const pushPlain = (upTo: number): void => {
    if (upTo <= bufStart) {
      return;
    }
    const s: MdSpan = new MdSpan();
    s.text = text.substring(bufStart, upTo);
    spans.push(s);
    bufStart = upTo;
  };

  while (i < text.length) {
    const c: number = text.charCodeAt(i);
    // ① 快路径：非标记字符（不可能开启任何分支）⇒ 原样并入当前普通文本段。
    //    2026-11-06 自动链接：`<`(60) 可能开 `<url>`；`h`(104)/`w`(119) 可能开裸链
    //    （只在 `http://`/`https://`/`www.` 且前字符是边界时才成链接，见 `urlEndAt`）。
    if (c !== 96 && c !== 33 && c !== 91 && c !== 42 && c !== 95 && c !== 126
      && c !== 60 && c !== 104 && c !== 119 && c !== 36) {
      i++;
      continue;
    }
    // 自动链接 ①：`<https://…>` / `<mailto:…>`（CommonMark autolink）
    if (c === 60) {
      const close: number = text.indexOf('>', i + 1);
      if (close > i + 1) {
        const inner: string = text.substring(i + 1, close);
        if (isAngleAutolink(inner)) {
          pushPlain(i);
          const s: MdSpan = new MdSpan();
          // `mailto:a@b` 的**上屏文本**是地址本身（与 CommonMark/GFM 一致），href 保留 scheme。
          s.text = inner.startsWith('mailto:') ? inner.substring(7) : inner;
          s.link = inner;
          spans.push(s);
          i = close + 1;
          bufStart = i;
          continue;
        }
      }
    }
    // 自动链接 ②：裸链（GFM autolink literal）—— `http://` / `https://` / `www.`
    if (c === 104 || c === 119) {
      const end: number = urlEndAt(text, i);
      if (end > i) {
        pushPlain(i);
        const raw: string = text.substring(i, end);
        const s: MdSpan = new MdSpan();
        s.text = raw;
        s.link = raw.startsWith('www.') ? 'http://' + raw : raw;
        spans.push(s);
        i = end;
        bufStart = i;
        continue;
      }
    }
    // 行内代码（CommonMark：开 n 个反引号 ⇒ 必须用 n 个闭合；支持 ``` ``a`b`` ``` 这种嵌套）
    if (c === 96) {
      let run: number = 0;
      while (i + run < text.length && text.charCodeAt(i + run) === 96) {
        run++;
      }
      const close: number = backtickRunAt(text, i + run, run);
      if (close > i) {
        pushPlain(i);
        let content: string = text.substring(i + run, close);
        // CommonMark：内容两端各有一个空格且不全为空格 ⇒ 各去掉一个（`` ` a ` `` ⇒ `a`）
        if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ')
          && content.trim().length > 0) {
          content = content.substring(1, content.length - 1);
        }
        const s: MdSpan = new MdSpan();
        s.text = content;
        s.code = true;
        spans.push(s);
        i = close + run;
        bufStart = i;
        continue;
      }
    }
    // 行内公式 `$…$`（web `remark-math` inlineMath）。
    // 配对口径对齐 remark-math：开括号后**不能**是空白；闭括号前不能是空白；
    // 闭括号后**不能是数字**（否则 `$5 元` 这类金额会被误判）。
    if (c === 36) {
      const nextCode: number = i + 1 < text.length ? text.charCodeAt(i + 1) : 32;
      const nextIsBlank: boolean = i + 1 >= text.length || nextCode === 32
        || nextCode === 9 || nextCode === 10;
      if (nextCode !== 36 && !nextIsBlank) {
        const end: number = text.indexOf('$', i + 1);
        if (end > i + 1) {
          const prevCh: string = text.charAt(end - 1);
          const after: string = end + 1 < text.length ? text.charAt(end + 1) : '';
          const okPrev: boolean = prevCh !== ' ' && prevCh !== '\t' && prevCh !== '\n';
          const okAfter: boolean = after.length === 0 || !/[0-9]/.test(after);
          if (okPrev && okAfter) {
            pushPlain(i);
            const s: MdSpan = new MdSpan();
            s.text = text.substring(i + 1, end);
            s.math = true;
            spans.push(s);
            i = end + 1;
            bufStart = i;
            continue;
          }
        }
      }
    }
    // 图片 ![alt](src)
    if (c === 33 && text.charAt(i + 1) === '[') {
      const close: number = text.indexOf(']', i + 2);
      if (close > i && text.charAt(close + 1) === '(') {
        const paren: number = text.indexOf(')', close + 2);
        if (paren > close) {
          pushPlain(i);
          const s: MdSpan = new MdSpan();
          s.text = text.substring(i + 2, close);
          s.image = text.substring(close + 2, paren);
          spans.push(s);
          i = paren + 1;
          bufStart = i;
          continue;
        }
      }
    }
    // 链接 [text](href)
    if (c === 91) {
      const close: number = text.indexOf(']', i + 1);
      if (close > i && text.charAt(close + 1) === '(') {
        const paren: number = text.indexOf(')', close + 2);
        if (paren > close) {
          pushPlain(i);
          const s: MdSpan = new MdSpan();
          s.text = text.substring(i + 1, close);
          s.link = text.substring(close + 2, paren);
          spans.push(s);
          i = paren + 1;
          bufStart = i;
          continue;
        }
      }
    }
    // 粗体 **text** 或 __text__（⛔ 只认**同一字符的偶对** `**`/`__`；`*_`/`_*` 不算 —— 与旧实现逐字一致）
    if ((c === 42 && text.charCodeAt(i + 1) === 42) || (c === 95 && text.charCodeAt(i + 1) === 95)) {
      const marker: string = text.substring(i, i + 2);
      const end: number = text.indexOf(marker, i + 2);
      if (end > i) {
        pushPlain(i);
        pushEmphasis(spans, text.substring(i + 2, end), 'bold');
        i = end + 2;
        bufStart = i;
        continue;
      }
    }
    // 删除线 ~~text~~
    if (c === 126 && text.startsWith('~~', i)) {
      const end: number = text.indexOf('~~', i + 2);
      if (end > i) {
        pushPlain(i);
        pushEmphasis(spans, text.substring(i + 2, end), 'strike');
        i = end + 2;
        bufStart = i;
        continue;
      }
    }
    // 斜体 *text* 或 _text_
    if (c === 42 || c === 95) {
      const ch: string = text.charAt(i);
      if (!text.startsWith(ch + ch, i)) {
        const end: number = text.indexOf(ch, i + 1);
        if (end > i + 1) {
          pushPlain(i);
          pushEmphasis(spans, text.substring(i + 1, end), 'italic');
          i = end + 1;
          bufStart = i;
          continue;
        }
      }
    }
    i++;
  }
  pushPlain(text.length);
  return spans;
}

/** 供预览/通知类场景用的纯文本化（去掉标记）。 */
export function markdownToPlain(src: string): string {
  const blocks: MdBlock[] = parseMarkdown(src);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b: MdBlock = blocks[i];
    if (b.kind === MdBlockKind.Code || b.kind === MdBlockKind.Math) {
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

/**
 * 渲染前的**源级预处理**（web `MarkdownRenderer.tsx:515-516` 的同一顺序）：
 *   ① 剥 frontmatter → ② TeX 定界符归一 → ③（仅流式）裁掉未闭合公式尾部。
 * ⛔ 顺序不能换：frontmatter 必须在 math 归一之前（YAML 里的 `$` 不当定界符，
 *    闭合的 `---` 会被当 setext 标题下划线）；裁剪必须在归一之后（`\[` 已变成 `$$` 才数得准）。
 */
export function prepareMarkdown(src: string, streaming: boolean): string {
  const normalized: string = normalizeMathDelimiters(stripFrontmatter(src));
  return streaming ? clipTrailingUnclosedMath(normalized) : normalized;
}

/** 解析 Markdown（带缓存 + **按块增量复用**）。渲染路径一律走这个。 */
export function parseMarkdownCached(src: string, streaming: boolean = false): MdBlock[] {
  // 预处理后的文本才是**解析真值**（缓存键也用它：同源必然同键）
  const prepared: string = prepareMarkdown(src, streaming);
  const hit: MdBlock[] | undefined = mdBlockCache.get(prepared);
  if (hit !== undefined) {
    mdCacheHits++;
    mdLastSrc = src;
    mdLastBlocks = hit;
    return hit;
  }
  mdCacheMisses++;
  // ⛔ **每次源串变化 ⇒ 全量重新解析**（用户 2026-10-17 亲报「SSE 更新时列表渲染漏字」，
  //    web 无此 bug）。
  //    旧实现做了"按块增量复用"：只从**最后一个块**起点重解析尾部（流式省字符）。
  //    但"追加只会改最后一个块"这个前提**不成立**：
  //      · 代码围栏闭合（``` 落行）会把**前面**的段落并入代码块；
  //      · 列表续行 / 嵌套、表格补行、Setext 标题（`---` 落行）、引用块延续……
  //    都会改写**更早**的块 ⇒ 复用旧前缀 ⇒ 前缀与新后缀拼在**同一份块表**里
  //    ⇒ 文本错位/**漏字**（用户所见）。
  //    web `MarkdownView` 每次都对**完整字符串**解析，故无此问题 ⇒ 对齐 web：
  //    只有**源串逐字相同**才复用上一次结果（`mdBlockCache` 命中），否则全量解析。
  let blocks: MdBlock[];
  blocks = parseMarkdown(prepared);
  mdLastSrc = prepared;
  mdLastBlocks = blocks;
  mdBlockCache.set(prepared, blocks);
  mdBlockOrder.push(prepared);
  mdBlockChars += prepared.length;
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
