/**
 * ToolPopover —— 工具 pill 的**浮层详情卡**（对齐 web `components/agent/FoldedToolGroup.tsx` 的
 * `ToolPopoverDetail` + `DiffView.tsx`）。
 *
 * 设计规格见 `docs/TOOLPOPOVER-SPEC.md`（先设计后实现；本文件必须与规格一致）。
 *
 * 三个"不再自己造轮子"的点：
 *  1. **语法高亮** —— 交给 **Prism4j**（`core/highlight.ets`，上百种语言），
 *     本文件只把语义色键映射成 `Palette` 的颜色。
 *  2. **diff** —— 解析逐字移植 web `DiffView.tsx`（`core/diffparse.ets`），
 *     渲染照它的信息结构：`@@` 块头徽标 / 双列行号 / 增绿删红。
 *  3. **弹层底座** —— 交给 `bindPopup`（ArkUI 原生），本文件不做浮层定位。
 */
import { Palette, paletteOf, Surfaces, surfacesOf, Effects, effectsOf } from '../core/theme';
import { R_LG, R_MD, R_SM, R_XL, SP_1, SP_2, SP_3, FS_BODY, FS_CAPTION } from '../core/tokens';
import { ToolProgress } from '../core/types';
import { fileArgFields, FileArgFields, isFileTool, langFromPath, pathFromLabel } from '../core/toolargs';
import {
  HlSpan, K_COMMENT, K_DIFF_ADD, K_DIFF_DEL, K_FUNC, K_KEYWORD, K_NUMBER, K_OP, K_PROP,
  K_PUNCT, K_STRING, K_TAG, K_TYPE, highlightCode, prismLangName,
} from '../core/highlight';
import {
  DIFF_ADD, DIFF_CTX, DIFF_DEL, DIFF_HUNK, DiffFile, DiffLine, HunkParts,
  extractDiffSource, hasDiffBody, parseUnifiedDiff, splitHunk,
} from '../core/diffparse';

/** 内容区最大高度（vp）—— 屏 ≈844vp；限制在 ~1/3 ⇒ 浮层朝上朝下都放得下。 */
const BODY_MAX_H: number = 260;
/** 单块最多渲染的行数（超出只显示**尾部** —— 输出"最后出错"，尾部信息量最大）。 */
const MAX_LINES: number = 200;
/** diff 块最多渲染的行数。 */
const MAX_DIFF_LINES: number = 240;
/** 行号列宽（web 是 `w-9` = 36px；我们按等宽 10px 字号取 30vp 够放 4 位数）。 */
const LN_W: number = 30;

export interface ToolDetailVM {
  title: string;
  status: string;
  statusColor: string;
  summary: string;
  args: string;
  detail: string;
  /** 工具提示（含 ```diff 围栏）；用于渲染 diff 卡。 */
  hints: string;
  /** 参数的语言（用于高亮；工具参数几乎都是 JSON）。 */
  argsLang: string;
  /** 文件类工具的目标路径（FileCreate/FileReplace）。 */
  path: string;
  /** 文件**新内容**（FileCreate 的 `content` 字段）——按文件语言高亮。 */
  content: string;
  /** 内容高亮语言（由 `path` 扩展名推断；空 = 纯文本）。 */
  contentLang: string;
  hasExit: boolean;
  exitCode: number;
  elapsedMs: number;
  hasAny: boolean;
}

export function formatElapsed(ms: number): string {
  if (ms <= 0) { return ''; }
  if (ms < 1000) { return `${Math.round(ms)}ms`; }
  const s: number = ms / 1000;
  if (s < 60) { return `${s.toFixed(s < 10 ? 1 : 0)}s`; }
  const m: number = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

/**
 * JSON 美化：能解析就缩进输出；不能解析（多半是被截断的参数）**原样返回** ——
 * 绝不吞内容，读原始串也比读空串强。
 */
export function prettyJson(raw: string): string {
  const s: string = raw.trim();
  if (s.length === 0) { return raw; }
  const c0: string = s.charAt(0);
  if (c0 !== '{' && c0 !== '[') { return raw; }
  try {
    const obj: Object = JSON.parse(s) as Object;
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return raw;
  }
}

/** 行语义分级（**终端输出**用；代码走 Prism4j，不用这套）。 */
export const LINE_PLAIN: number = 0;
export const LINE_OK: number = 1;
export const LINE_ERROR: number = 2;
export const LINE_HEAD: number = 3;

/**
 * 终端输出逐行语义判定（轻量启发式，**只影响颜色、绝不裁剪内容**）。
 * ⚠️ 这不属于"造高亮器的轮子"：终端输出不是任何编程语言，没有任何高亮器能处理它，
 *    而它的语义（成功/失败/标题）恰恰是读日志时最重要的信息。
 */
export function classifyLine(line: string): number {
  const s: string = line.toLowerCase();
  if (s.indexOf('error') >= 0 || s.indexOf('failed') >= 0 || s.indexOf('exception') >= 0
    || s.indexOf('traceback') >= 0 || s.indexOf('fatal') >= 0 || s.indexOf('denied') >= 0
    || s.indexOf('not found') >= 0 || line.indexOf('✗') >= 0) {
    return LINE_ERROR;
  }
  if (s.indexOf('success') >= 0 || s.indexOf('passed') >= 0 || s.indexOf(' ok') >= 0
    || line.indexOf('✓') >= 0 || line.indexOf('✅') >= 0) {
    return LINE_OK;
  }
  const t: string = line.trim();
  if (t.startsWith('===') || t.startsWith('---') || t.startsWith('#') || t.startsWith('$')) {
    return LINE_HEAD;
  }
  return LINE_PLAIN;
}

/** 把长文本切成行（超上限只保**尾部**，并给出省略提示）。 */
export function tailLines(text: string, max: number): string[] {
  const all: string[] = text.split('\n');
  if (all.length <= max) { return all; }
  const out: string[] = [`… 已省略前 ${all.length - max} 行 …`];
  for (let i = all.length - max; i < all.length; i++) {
    out.push(all[i]);
  }
  return out;
}

export function toolDetailVM(t: ToolProgress | undefined, statusColor: string, status: string): ToolDetailVM {
  const vm: ToolDetailVM = {
    title: '',
    status: status,
    statusColor: statusColor,
    summary: '',
    args: '',
    detail: '',
    hints: '',
    argsLang: 'json',
    path: '',
    content: '',
    contentLang: '',
    hasExit: false,
    exitCode: 0,
    elapsedMs: 0,
    hasAny: false,
  };
  if (t === undefined) { return vm; }
  vm.title = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
  vm.summary = t.summary !== undefined ? t.summary : '';
  vm.args = t.args !== undefined && t.args.length > 0 ? prettyJson(t.args) : '';
  vm.detail = t.detail !== undefined ? t.detail : '';
  // `tool_hints` 里带 ```diff 围栏（FileCreate/FileReplace）；抽出来交给 diff 渲染
  const hints: string = t.tool_hints !== undefined ? t.tool_hints : '';
  vm.hints = hints;
  // 文件类工具：抽 `path`/`content`，按**文件语言**高亮内容（用户 2026-10-10：「filecreate 也要高亮」）
  const rawArgs: string = t.args !== undefined ? t.args : '';
  if (isFileTool(t.name) || rawArgs.indexOf('"content"') >= 0) {
    const f: FileArgFields = fileArgFields(rawArgs);
    vm.path = f.path.length > 0 ? f.path : pathFromLabel(vm.title);
    vm.content = f.content;
    vm.contentLang = langFromPath(vm.path);
  }
  vm.hasExit = t.exit_code !== undefined;
  vm.exitCode = t.exit_code !== undefined ? t.exit_code : 0;
  vm.elapsedMs = t.elapsed_ms !== undefined ? t.elapsed_ms : 0;
  vm.hasAny = vm.args.length > 0 || vm.detail.length > 0 || vm.summary.length > 0
    || vm.content.length > 0 || hasDiffBody(hints);
  return vm;
}

@Component
export struct ToolPopoverCard {
  @Prop vm: ToolDetailVM;
  @Prop theme: string = 'dark';
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  /** 面 / 边界 token（**由色板派生**，与 `eff()` 同一纪律、同样无缓存薄访问器）。
   *  代码块 / 终端块 / diff 行底曾把**阴影 token** `eff().elev1` 当底色用——语义错位，
   *  现改用 `Surfaces.sunken`（其取值逐字节 ≡ `compositeOver(elev1, surface)`，见 theme.ets
   *  `legacyElev1Of`）⇒ 观感零变化、语义归位。 */
  private surf(): Surfaces {
    return surfacesOf(this.pal());
  }

  /** 语义色键 ⇒ 主题色（**高亮配色与全站设计系统同源**）。 */
  private keyColor(k: string): string {
    if (k === K_COMMENT) { return this.pal().textMuted; }
    if (k === K_STRING) { return this.pal().successText; }
    if (k === K_KEYWORD) { return this.pal().accentText; }
    if (k === K_NUMBER) { return this.pal().warn; }
    if (k === K_FUNC) { return this.pal().accentSoft; }
    if (k === K_PROP) { return this.pal().accentText; }
    if (k === K_TYPE) { return this.pal().textPrimary; }
    if (k === K_TAG) { return this.pal().accentSoft; }
    if (k === K_OP || k === K_PUNCT) { return this.pal().textMuted; }
    if (k === K_DIFF_ADD) { return this.pal().successText; }
    if (k === K_DIFF_DEL) { return this.pal().dangerText; }
    return this.pal().textSecondary;
  }

  private lineColor(kind: number): string {
    if (kind === LINE_ERROR) { return this.pal().dangerText; }
    if (kind === LINE_OK) { return this.pal().successText; }
    if (kind === LINE_HEAD) { return this.pal().accentSoft; }
    return this.pal().textSecondary;
  }

  /** 段头：小标签 + 右侧复制按钮（图标化，不用文字撑宽）。 */
  @Builder
  SectionHead(label: string, body: string, what: string) {
    Row({ space: SP_1 }) {
      Text(label).fontSize(10).fontColor(this.pal().textMuted).layoutWeight(1)
      SymbolGlyph($r('sys.symbol.rectangle_on_rectangle'))
        .fontSize(13)
        .fontColor([this.pal().textMuted])
        .padding({ left: SP_1, right: SP_1, top: 2, bottom: 2 })
        .stateStyles({ pressed: { .opacity(0.5) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onCopy(body, what);
        })
    }
    .width('100%')
  }

  /**
   * 一行**代码**：由 Prism4j 切好的 span 逐段上色。
   *
   * ⛔ **不折行**（`WordBreak.NORMAL` + 不设 `width('100%')`）：源代码按**原始行宽**渲染，
   *   溢出的横向滚由外层 `Scroll(Free)` 承担 —— 对齐 web 的 `whitespace-pre` +
   *   卡片 `overflow-auto`（用户 2026-10-10：「这种源代码要允许横向滚动，不要 hard wrap」）。
   *   `BREAK_ALL` 会把 `"command": "cd /Users/…` 从词中间劈成乱码墙（更早的真机反馈）。
   */
  @Builder
  HlLine(ln: string, li: number, lang: string) {
    Text() {
      ForEach(highlightCode(ln, lang), (sp: HlSpan, si: number) => {
        Span(sp.text).fontColor(this.keyColor(sp.key))
      }, (sp: HlSpan, si: number) => `s${li}_${si}`)
    }
    .fontSize(11)
    .fontFamily('monospace')
    .wordBreak(WordBreak.NORMAL)
    .maxLines(1)
    .textAlign(TextAlign.Start)
    .copyOption(CopyOptions.LocalDevice)
  }

  /** 一行**终端输出**（非代码）：按语义行着色。终端换行无意义 ⇒ 同样不折行。 */
  @Builder
  PlainLine(ln: string, li: number) {
    Text(ln.length > 0 ? ln : ' ')
      .wordBreak(WordBreak.NORMAL)
      .fontSize(11)
      .fontFamily('monospace')
      .fontColor(this.lineColor(classifyLine(ln)))
      .maxLines(1)
      .textAlign(TextAlign.Start)
      .copyOption(CopyOptions.LocalDevice)
  }

  /**
   * 代码块：**Prism4j 分词着色** + 限高内滚 + **横向滚动**（不折行）。
   * `lang` 传 Prism4j 认识的语言名（`json`/`typescript`/`diff`…）；未知语言退化为纯文本。
   */
  @Builder
  CodeBlock(label: string, body: string, what: string, lang: string) {
    Column({ space: SP_1 }) {
      this.SectionHead(label, body, what)
      Scroll() {
        Column({ space: 1 }) {
          ForEach(tailLines(body, MAX_LINES), (ln: string, li: number) => {
            this.HlLine(ln, li, lang)
          }, (ln: string, li: number) => `l${li}`)
        }
        // ⛔ 不设 `width('100%')`：列宽 = 最长行宽 ⇒ 长行溢出即横向滚动（web 卡片 `overflow-auto`）
        .alignItems(HorizontalAlign.Start)
      }
      .scrollable(ScrollDirection.Free)
      .scrollBar(BarState.Auto)
      .width('100%')
      .constraintSize({ maxHeight: BODY_MAX_H })
      .padding(SP_2)
      .backgroundColor(this.surf().sunken)
      .borderRadius(R_MD)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  /** 终端输出块（语义行着色，不是代码高亮）。 */
  @Builder
  OutBlock(label: string, body: string, what: string) {
    Column({ space: SP_1 }) {
      this.SectionHead(label, body, what)
      Scroll() {
        Column({ space: 1 }) {
          ForEach(tailLines(body, MAX_LINES), (ln: string, li: number) => {
            this.PlainLine(ln, li)
          }, (ln: string, li: number) => `o${li}`)
        }
        .width('100%').alignItems(HorizontalAlign.Start)
      }
      .scrollBar(BarState.Auto)
      .width('100%')
      .constraintSize({ maxHeight: BODY_MAX_H })
      .padding(SP_2)
      .backgroundColor(this.surf().sunken)
      .borderRadius(R_MD)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  // ── diff 渲染（对齐 web `DiffView.tsx`）─────────────────────────────────

  /** 单行 diff：双列行号 + 标记 + 内容；增行绿底、删行红底。 */
  @Builder
  DiffRow(ln: DiffLine) {
    Row() {
      // 双列行号（旧 / 新）—— 等宽、右对齐、不可选（与 web `LineNumbers` 一致）
      Text(ln.oldNum > 0 ? `${ln.oldNum}` : '')
        .width(LN_W).textAlign(TextAlign.End)
        .fontSize(10).fontFamily('monospace').fontColor(this.pal().textMuted)
      Text(ln.newNum > 0 ? `${ln.newNum}` : '')
        .width(LN_W).textAlign(TextAlign.End)
        .fontSize(10).fontFamily('monospace').fontColor(this.pal().textMuted)
        .margin({ right: SP_1 })
      Text(ln.kind === DIFF_ADD ? '+' : (ln.kind === DIFF_DEL ? '-' : ' '))
        .width(10).fontSize(12).fontFamily('monospace')
        .fontColor(ln.kind === DIFF_ADD ? this.pal().successText
          : (ln.kind === DIFF_DEL ? this.pal().dangerText : this.pal().textMuted))
      Text(ln.text.length > 0 ? ln.text : ' ')
        .fontSize(11).fontFamily('monospace')
        // ⛔ 不折行（web `whitespace-pre`）：长行由 diff 卡整体横向滚动承担
        .wordBreak(WordBreak.NORMAL)
        .maxLines(1)
        .fontColor(ln.kind === DIFF_ADD ? this.pal().successText
          : (ln.kind === DIFF_DEL ? this.pal().dangerText : this.pal().textSecondary))
        .copyOption(CopyOptions.LocalDevice)
    }
    .backgroundColor(ln.kind === DIFF_ADD ? this.surf().sunken
      : (ln.kind === DIFF_DEL ? this.pal().warnBg : this.pal().transparent))
  }

  /** `@@` 块头：accent 徽标 + 尾注（muted）。对齐 web `DiffLineRow` 的 hunk 分支。 */
  @Builder
  HunkRow(ln: DiffLine) {
    Row({ space: SP_2 }) {
      Text(splitHunk(ln.text).marker)
        .fontSize(10).fontFamily('monospace').fontColor(this.pal().accentText)
      if (splitHunk(ln.text).rest.length > 0) {
        Text(splitHunk(ln.text).rest)
          .fontSize(10).fontFamily('monospace').fontColor(this.pal().textMuted)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      }
    }
    .width('100%')
    .padding({ top: 2, bottom: 2 })
    .backgroundColor(this.pal().accentDeep)
  }

  /** 一个文件的 diff 卡：路径头（含 +N/−M 统计）+ 行。 */
  @Builder
  DiffFileCard(f: DiffFile) {
    Column({ space: 0 }) {
      Row({ space: SP_1 }) {
        SymbolGlyph($r('sys.symbol.doc_text')).fontSize(12).fontColor([this.pal().textMuted])
        Text(f.path.length > 0 ? f.path : '（未命名文件）')
          .fontSize(10).fontFamily('monospace').fontColor(this.pal().textSecondary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        Text(`+${f.adds}`).fontSize(10).fontColor(this.pal().successText)
        Text(`−${f.dels}`).fontSize(10).fontColor(this.pal().dangerText)
      }
      .width('100%').padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
      .backgroundColor(this.surf().sunken)

      ForEach(tailLinesOfFile(f, MAX_DIFF_LINES), (ln: DiffLine, li: number) => {
        if (ln.kind === DIFF_HUNK) {
          this.HunkRow(ln)
        } else {
          this.DiffRow(ln)
        }
      }, (ln: DiffLine, li: number) => `d${li}`)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    .borderRadius(R_MD)
    .clip(true)
    .backgroundColor(this.pal().surface)
  }

  /** diff 卡集合（可能多文件）。 */
  @Builder
  DiffBlock() {
    Column({ space: SP_1 }) {
      this.SectionHead('改动', this.vm.hints, 'diff')
      Scroll() {
        Column({ space: SP_2 }) {
          ForEach(parseUnifiedDiff(extractDiffSource(this.vm.hints)), (f: DiffFile, fi: number) => {
            this.DiffFileCard(f)
          }, (f: DiffFile, fi: number) => `f${fi}`)
        }
        // ⛔ 不设 width('100%')：列宽 = 最宽的一行 ⇒ 长行整体横向滚动（web 卡片 `overflow-auto`）
        .alignItems(HorizontalAlign.Start)
      }
      .scrollable(ScrollDirection.Free)
      .scrollBar(BarState.Auto)
      .width('100%')
      .constraintSize({ maxHeight: BODY_MAX_H })
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: SP_2 }) {
      // header：状态色点 + 名字 + 状态徽标 + 耗时
      Row({ space: SP_2 }) {
        Circle().width(8).height(8).fill(this.vm.statusColor)
        Text(this.vm.title.length > 0 ? this.vm.title : '工具')
          .fontSize(FS_BODY).fontColor(this.pal().textPrimary).fontWeight(FontWeight.Medium)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.vm.status.length > 0) {
          Text(this.vm.status)
            .fontSize(10).fontColor(this.vm.statusColor)
            .padding({ left: SP_1, right: SP_1, top: 2, bottom: 2 })
            .backgroundColor(this.surf().sunken).borderRadius(R_SM)
        }
        if (this.vm.elapsedMs > 0) {
          Text(formatElapsed(this.vm.elapsedMs)).fontSize(10).fontColor(this.pal().textMuted)
        }
      }
      .width('100%')

      if (this.vm.summary.length > 0 && this.vm.summary !== this.vm.detail) {
        Text(this.vm.summary)
          .wordBreak(WordBreak.BREAK_WORD)
          .fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
      }

      // 改动优先（web 的 FileCreate/FileReplace 走 diff 卡）；再给内容/参数/输出兜底
      if (hasDiffBody(this.vm.hints)) {
        this.DiffBlock()
      }
      // 文件类工具：按**文件语言**高亮「内容」（用户 2026-10-10：「filecreate 也要高亮」）。
      // 有内容时**不再重复**显示 `参数`（args 里就是同一份 content，重复即噪音；对齐 web
      // 的 `hideArgs`）。
      if (this.vm.content.length > 0) {
        this.CodeBlock(this.vm.contentLang.length > 0 ? `内容 · ${this.vm.contentLang}` : '内容',
          this.vm.content, 'content', this.vm.contentLang)
      } else if (this.vm.args.length > 0) {
        this.CodeBlock('参数', this.vm.args, 'args', this.vm.argsLang)
      }
      if (this.vm.detail.length > 0) {
        this.OutBlock('输出', this.vm.detail, 'output')
      }
      if (this.vm.hasExit) {
        Text(`退出码 ${this.vm.exitCode}`)
          .fontSize(10)
          .fontColor(this.vm.exitCode !== 0 ? this.pal().dangerText : this.pal().textMuted)
      }
      if (!this.vm.hasAny) {
        Text('（该工具无详情载荷）').fontSize(FS_CAPTION).fontColor(this.pal().textMuted)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    // ⛔ 卡片内边距：没有它内容会贴死边框（真机反馈"一点 padding 没有"）。
    .padding(SP_3)
    // 整卡限高：内容再长也不出屏幕（与内部 Scroll 组成"卡内滚动"）
    .constraintSize({ maxHeight: BODY_MAX_H + 150 })
  }
}

/** 文件行按上限裁切（保留尾部）。 */
function tailLinesOfFile(f: DiffFile, max: number): DiffLine[] {
  if (f.lines.length <= max) { return f.lines; }
  const out: DiffLine[] = [];
  const skip: DiffLine = f.lines[f.lines.length - max];
  const ell: DiffLine = new DiffLine();
  ell.kind = 'plain';
  ell.text = `… 已省略前 ${f.lines.length - max} 行 …`;
  out.push(ell);
  for (let i = f.lines.length - max; i < f.lines.length; i++) {
    out.push(f.lines[i]);
  }
  return out;
}

/**
 * "+N" 溢出浮层：被收纳工具的全量列表，点击一条**在浮层内**展开该工具详情卡
 * （对齐 web `ToolPopoverContent` + `ToolCardGated`：浮层内展开的行高变化不进入虚拟列表）。
 */
@Component
export struct ToolOverflowList {
  @Prop tools: ToolProgress[] = [];
  @Prop theme: string = 'dark';
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };

  @State sel: number = -1;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private dot(t: ToolProgress): string {
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return this.pal().dangerText;
    }
    if (t.status === 'running' || t.status === 'generating') {
      return this.pal().accentSoft;
    }
    return this.pal().textMuted;
  }

  private vmOf(t: ToolProgress): ToolDetailVM {
    return toolDetailVM(t, this.dot(t), '');
  }

  build() {
    Column() {
      Scroll() {
        Column() {
          ForEach(this.tools, (t: ToolProgress, i: number) => {
            Column() {
              Row({ space: SP_2 }) {
                Circle().width(8).height(8).fill(this.dot(t))
                Text(t.label !== undefined && t.label.length > 0 ? t.label : t.name)
                  .fontSize(FS_CAPTION).fontColor(this.pal().textPrimary).fontWeight(FontWeight.Medium)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
                if (t.elapsed_ms !== undefined && t.elapsed_ms > 0) {
                  Text(formatElapsed(t.elapsed_ms)).fontSize(10).fontColor(this.pal().textMuted)
                }
              }
              .width('100%').padding({ top: SP_1, bottom: SP_1 })
              .stateStyles({ pressed: { .opacity(0.7) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.sel = this.sel === i ? -1 : i;
              })
              if (this.sel === i) {
                ToolPopoverCard({
                  vm: this.vmOf(t),
                  theme: this.theme,
                  onCopy: this.onCopy,
                })
              }
            }
            .width('100%')
          }, (t: ToolProgress, i: number) => `${t.name}#${i}`)
        }
        .width('100%').alignItems(HorizontalAlign.Start)
      }
      .scrollBar(BarState.Auto)
      .width('100%')
      .constraintSize({ maxHeight: BODY_MAX_H })
      .padding(SP_3)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
