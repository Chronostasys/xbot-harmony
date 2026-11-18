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
import { Palette, paletteOf, Surfaces, surfacesOf } from '../core/theme';
import { R_LG, R_MD, R_SM, R_XL, SP_1, SP_2, SP_3, FS_BODY, FS_CAPTION } from '../core/tokens';
import {
  PRESS_OPACITY, RADIUS_CHIP, SPACE_HAIR, STROKE_HAIRLINE, SURFACE_CARD, TYPE_CHIP, hairlineOf, insetHairlineOf, structuralRuleOf, surfaceFillOf, typeOf, MARKER_GLYPH, ICON_SM, colorOf, HIT_TARGET_MIN } from '../core/design';
import { ToolProgress } from '../core/types';
import { renderKind, ST_DONE, ST_ERROR, toolStatusKind } from '../core/toolstatus';
import {
  NO_EXIT_CODE, SHELL_TOOL_NAME, ShellParsed, canPromoteShell, parseShellText, shellCommandOfLabel,
} from '../core/toolshell';
import { AnsiSpan, ansiBgOf, ansiFgOf, ansiPaletteOf, ansiSpansIfAny, hasAnsi } from '../core/ansi';
import { statusColorOf } from './ToolVisual';
import { fileArgFields, FileArgFields, isFileTool, langFromPath, pathFromLabel } from '../core/toolargs';
import {
  HlSpan, K_COMMENT, K_DIFF_ADD, K_DIFF_DEL, K_FUNC, K_KEYWORD, K_NUMBER, K_OP, K_PROP,
  K_PUNCT, K_STRING, K_TAG, K_TYPE, highlightCode, prismLangName,
} from '../core/highlight';
import {
  DIFF_ADD, DIFF_CTX, DIFF_DEL, DIFF_HUNK, DiffFile, DiffLine, HunkParts,
  extractDiffSource, hasDiffBody, parseUnifiedDiff, splitHunk,
} from '../core/diffparse';
import { animBase } from './anim';
import { t as i18nT } from '../core/i18n';
import { toolNeedsDetail } from '../core/toolmerge';
import { withToolDetail } from '../core/toollayer';

/** 状态点直径（折叠面板行首）。 */
/** 展开区的 loading 指示器尺寸（与状态点同档，视觉不抢内容）。 */
const LOADING_ICON: number = 16;
const OVERFLOW_DOT: number = 7;

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
  /** 原始工具名（`Shell` 等）—— `core/toolshell.canPromoteShell` 的输入。 */
  toolName: string;
  /** 语义状态档（`core/toolstatus.toolStatusKind`）—— `canPromoteShell` 的输入。 */
  kind: string;
  /** LLM tool_call id（转后台 RPC 的目标）；空 = 不可转。 */
  callId: string;
  /** 输出已被标记「已转后台」（`core/toolshell.parseShellText`）。 */
  promoted: boolean;
  /** 后台任务 id（解析自输出；空 = 无）。 */
  bgTask: string;
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
    toolName: '',
    kind: '',
    callId: '',
    promoted: false,
    bgTask: '',
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
  // ── Shell 工具：输出语义解析（web `ShellRender` × `parseShell`）──────────────────
  // ⛔ 只在**真剥掉了标记行**时才改写 `vm.detail`（普通输出逐字节不动 ⇒ 零回归）。
  vm.toolName = t.name !== undefined ? t.name : '';
  vm.kind = toolStatusKind(t.status, t.exit_code);
  vm.callId = t.call_id !== undefined ? t.call_id : '';
  if (vm.toolName === SHELL_TOOL_NAME) {
    const sp: ShellParsed = parseShellText(vm.detail,
      shellCommandOfLabel(t.label !== undefined ? t.label : ''));
    vm.promoted = sp.promoted;
    vm.bgTask = sp.bgTask;
    if (sp.promoted || sp.timeout || sp.exitCode !== NO_EXIT_CODE) {
      vm.detail = sp.output;
    }
  }
  // ⛔ 注入型工具（`background_task_result` / `bg_subagent_*` / `pre_turn_end` …）**没有**
  //   args/detail，只有 `tool_hints` 里的结构化载荷；而 hints 只在是 diff 时才被渲染
  //   ⇒ 用户点开永远「暂无详情」（2026-10-28 截图实证）。⇒ 非 diff 的 hints 直接当"输出"展示
  //   （宁可露出原始 JSON，也不能让浮层空着——那是"没有详情"的假象）。
  if (vm.detail.length === 0 && vm.args.length === 0 && vm.summary.length === 0
    && hints.length > 0 && !hasDiffBody(hints)) {
    vm.detail = hints;
  }
  // ⛔ **绝不出现「暂无详情」**（用户 2026-10-28：「有时候还是暂无详情，这是严重 bug」）：
  //   注入型工具（`background_task_result` / `bg:*` / `task_wait` …）常常只有 `label`
  //   （结构化载荷就在 label 里，如 `background_task_result: {}`），而 args/detail/hints 全空。
  //   ⇒ 兜底顺序：`tool_hints`（非 diff）→ **label**（它本身带载荷）→ 状态行。
  //   绝不会只剩一句"暂无详情"。
  if (vm.detail.length === 0 && vm.args.length === 0 && vm.summary.length === 0
    && vm.content.length === 0 && !hasDiffBody(hints)) {
    if (vm.title.length > 0) {
      vm.detail = vm.title;
    } else if (vm.status.length > 0) {
      vm.detail = vm.status;
    }
  }
  vm.hasAny = vm.args.length > 0 || vm.detail.length > 0 || vm.summary.length > 0
    || vm.content.length > 0 || hasDiffBody(hints);
  return vm;
}

@Component
export struct ToolPopoverCard {
  @Prop vm: ToolDetailVM;
  @Prop theme: string = 'dark';
  /**
   * **嵌入模式**（"+N" 溢出浮层内）—— ⛔ 不再自带外层 `Scroll`/限高：
   *   溢出浮层**本身**已是单一纵向 `Scroll`（对齐 web `ToolPopoverContent`），
   *   嵌入再套一层会导致嵌套滚动冲突 + 排版错乱（用户亲报「在 +x 里展开详情有严重排版 bug」）。
   */
  @Prop embedded: boolean = false;
  /**
   * **生效主题的全局订阅**（§21.124 用户亲报「切主题后老文字颜色不变、新的才变」）。
   *
   * ⛔ 本组件挂在 `MessageRow` 的**带参 `@Builder` 子树**（`AssistantBlock(this.row)`）里 ——
   *   该子树在主题变化时**不重建**（参数是同一个 `ChatRow` 引用 ⇒ ArkUI V1 判「参数没变」，
   *   见 `docs/ARKTS-GOTCHAS.md §4/§37`）⇒ 子树里组件在**创建那刻**拿到的 `@Prop theme`
   *   会**永久冻结**（旧块停旧色板、新建块才用新色板 = 用户看到的「老的不变、新的才变」）。
   * ✅ 正解 = 本仓范式（同 `MessageRow.themeId()` / `MarkdownView`）：**组件自己订阅**
   *   `AppStorage('appTheme')` ⇒ 主题变更直接驱动本组件重绘，不经父级投递。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** 生效主题：全局订阅优先，`@Prop theme` 仅兜底（同 `MessageRow.themeId()`）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };
  /**
   * 「转后台」回调（页面注入；入参 = `tool_call_id`，出参 = 新后台任务 id，失败抛错）。
   * 未注入 ⇒ 走默认空实现 ⇒ 按钮点了不会有副作用（**但按钮本身仍会显示** ——
   * 显示判据是 `canPromoteShell(vm…)`，与回调是否注入无关；生产页面必注入）。
   */
  onPromote: (callId: string) => Promise<string> = async (callId: string) => {
    return '';
  };

  /** 转后台的人机态：idle → promoting → done / error（web `PromoteState`）。 */
  @State promoteState: string = 'idle';
  /** 成功返回的后台任务 id（本地态；与 `vm.bgTask` 互为兜底）。 */
  @State promotedTaskID: string = '';

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  // ── 转后台（web `ShellRender:444-445` × `ShellPromoteBar`）────────────────────
  /** 是否显示「转后台」—— 逐字对齐 web 的显示+启用判据（见 `core/toolshell.canPromoteShell`）。 */
  private promotable(): boolean {
    return canPromoteShell(this.vm.toolName, this.vm.kind, this.vm.callId);
  }

  /** 已是「后台运行中」—— 本地成功态 **或** 输出里已有 `[PROMOTED to background…]` 标记。 */
  private bgDone(): boolean {
    return this.promoteState === 'done' || this.vm.promoted;
  }

  /** 展示用的后台任务 id（本地态优先；回落输出解析值）。 */
  private bgTaskId(): string {
    if (this.promotedTaskID.length > 0) { return this.promotedTaskID; }
    return this.vm.bgTask;
  }

  /** 条文案（四态合一）：done 优先（**权威态来自输出标记**，本地态只是即时反馈）。 */
  private promoteLabel(): string {
    if (this.bgDone()) {
      return this.bgTaskId().length > 0 ? '已在后台运行' : '已转入后台';
    }
    if (this.promoteState === 'promoting') { return '正在转后台…'; }
    if (this.promoteState === 'error') { return '转后台失败 · 重试'; }
    return '转后台';
  }

  /** 点「转后台」：RPC → 成功转 done 态；失败转 error 态（web 同款两态，错误文案由页面 toast 承担）。 */
  private doPromote(): void {
    if (this.promoteState === 'promoting' || !this.promotable()) { return; }
    this.promoteState = 'promoting';
    this.onPromote(this.vm.callId).then((taskId: string) => {
      this.promotedTaskID = taskId;
      this.promoteState = 'done';
    }).catch((e: Error) => {
      this.promoteState = 'error';
    });
  }

  /** 下沉内容面（代码块 / 终端块 / diff 行底）—— `Surfaces.sunken`（语义角色，非魔数、非阴影错位）。 */
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

  /** 本仓 16 色 ANSI 映射（按 theme 记忆化 —— 同一输出块里对每行各建一次 16 元数组是浪费）。 */
  private ansiTheme: string = '';
  private ansiPal: string[] = [];

  private ansiColors(): string[] {
    if (this.ansiTheme !== this.themeId()) {
      this.ansiTheme = this.themeId();
      this.ansiPal = ansiPaletteOf(this.pal());
    }
    return this.ansiPal;
  }

  /** 文本的 ANSI span 列表（判据与渲染同源：`ansiSpansIfAny` = `hasAnsi` + `parseAnsi` 同一纯函数）。 */
  private ansiSpans(text: string): AnsiSpan[] {
    const s: AnsiSpan[] | null = ansiSpansIfAny(text, this.ansiColors());
    return s !== null ? s : [];
  }

  /** 无背景时的兜底（ArkUI `textBackgroundStyle` 需一个合法色值；透明 = 视觉无背景）。 */
  /**
   * 输出块**真实底色** —— 既是 well 的 `backgroundColor`，也是 ANSI 取色的默认背景 `defBg`。
   * ⛔ 不能传 `transparent`：反色（SGR 7）会把它当作"字色" ⇒ 文字透明不可见。
   */
  private ansiBgFallback(): string {
    return surfaceFillOf(this.pal(), 'surface.well');
  }

  /** 段头：小标签 + 右侧复制按钮（图标化，不用文字撑宽）。 */
  @Builder
  SectionHead(label: string, body: string, what: string) {
    Row({ space: SP_1 }) {
      Text(label).fontSize(typeOf(TYPE_CHIP).size).fontColor(this.pal().textMuted)
        .fontWeight(FontWeight.Medium).layoutWeight(1)
      // ⛔ 命中区：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`
      //    （左邻 = 标签 `Text`（`layoutWeight(1)`，**不可点**）⇒ 盒宽 ≥44 不抢他人命中区）；
      //    图标视觉尺寸不变（仍 `MARKER_GLYPH`，盒内居中）。
      Row() {
        SymbolGlyph($r('sys.symbol.rectangle_on_rectangle'))
          .fontSize(MARKER_GLYPH)
          .fontColor([colorOf(this.pal(), 'iconMuted')])
      }
      .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('复制'))
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
    .fontSize(12)
    .fontFamily('monospace')
    .wordBreak(WordBreak.NORMAL)
    .maxLines(1)
    .textAlign(TextAlign.Start)
    .copyOption(CopyOptions.LocalDevice)
  }

  /**
   * 一行**终端输出**（非代码）：按语义行着色。终端换行无意义 ⇒ 同样不折行。
   *
   * ✅ **ANSI 接色**（web `AnsiText.tsx:205`，消费点 `ToolCallBlock.tsx:101` /
   *    `ToolRender.tsx:438` / `FoldedToolGroup.tsx:387`）：含转义（ESC 或裸 `\r`）时走
   *    `core/ansi.ets` 的解析 + `ansiPaletteOf(this.pal())` 取色，**逐 span 上色**。
   *    ⛔ **判据与渲染同源**：`hasAnsi` / `ansiSpansIfAny` 就是 `parseAnsi` 快路径用的同一个纯函数
   *    —— 组件**不另写**任何 ANSI 判断；**颜色零字面量**，全走色板映射（`ansiFgOf`/`ansiBgOf`）。
   *    ⛔ 无转义 ⇒ `hasAnsi` 为假 ⇒ 走**原纯文本路径**（不引入任何多余 Span 节点）。
   *    ⚠️ `dim`（SGR 2 / web `opacity:.65`）**未接**：ArkUI `Span` 无逐段不透明度，跳过而非伪造。
   */
  @Builder
  PlainLine(ln: string, li: number, fg: string) {
    // ⛔ 行色由**调用方按行算一次**后传入（`fg`）。为什么不用 builder 内局部量：ArkUI 的
    //    `@Builder` 体顶层**只允许 UI 组件语法**，`const` 会报
    //    `10905209 Only UI component syntax can be written here`（本波真编译实测）。
    //    为什么旧写法要改：ANSI 分支里 `this.lineColor(classifyLine(ln))` 按 **span 数**重复求值
    //    （`.fontColor` 与 `.decoration.color` 各一次）⇒ 单行 `2×spanCount+1` 次
    //    `classifyLine`（`toLowerCase` + 最多 8 次 `indexOf`）。改为传参后全文件恒 **1** 次/行，
    //    观感**零变化**（同一次 build 内 `ln` 不变 ⇒ 纯函数结果不变）。
    //    判据：`tools/tests/msgflow_visual.test.ts`（全文件 `classifyLine(` 只允许 1 处）+ mutation 自证。
    if (hasAnsi(ln)) {
      // 有转义：逐 span 上色。底色 = 语义行色（span 未给前景色时继承它）。
      Text() {
        ForEach(this.ansiSpans(ln), (sp: AnsiSpan, si: number) => {
          Span(sp.text)
            .fontColor(ansiFgOf(sp, fg, this.ansiBgFallback()))
            .fontWeight(sp.bold ? FontWeight.Bold : FontWeight.Normal)
            .fontStyle(sp.italic ? FontStyle.Italic : FontStyle.Normal)
            .decoration({
              type: sp.strike ? TextDecorationType.LineThrough
                : (sp.underline ? TextDecorationType.Underline : TextDecorationType.None),
              color: ansiFgOf(sp, fg, this.ansiBgFallback()),
            })
            .textBackgroundStyle({ color: ansiBgOf(sp, fg, this.ansiBgFallback()) })
        }, (sp: AnsiSpan, si: number) => `a${li}_${si}`)
      }
      .wordBreak(WordBreak.NORMAL)
      .fontSize(12)
      .fontFamily('monospace')
      // 整行底色（span 无显式前景时可见）；有背景的 span 由 `textBackgroundStyle` 覆盖其底色。
      .fontColor(fg)
      .maxLines(1)
      .textAlign(TextAlign.Start)
      .copyOption(CopyOptions.LocalDevice)
    } else {
      Text(ln.length > 0 ? ln : ' ')
        .wordBreak(WordBreak.NORMAL)
        // 等宽 12（web `ToolCallBlock.tsx:98` 输出块 `text-[12px]`）——与代码行同号，
        // 同一浮层里"代码/终端输出"的字号必须一致（原先 11 比 web 小 1 ⇒ 与代码块观感分叉）。
        .fontSize(12)
        .fontFamily('monospace')
        .fontColor(fg)
        .maxLines(1)
        .textAlign(TextAlign.Start)
        .copyOption(CopyOptions.LocalDevice)
    }
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
      // ⚡ 2026-10-20 浮层滚动修复：块内**只横滑**（⛔ 不再纵向限高）——
      //   整卡改为**单一纵向 Scroll**（对齐 web 根 `overflow-y-auto`）⇒ 纵向只一个滚动源、
      //   嵌套滚动冲突消除；代码长行仍横滑（内层 `Column` 不设宽 ⇒ 列宽 = 最长行）。
      .scrollable(ScrollDirection.Horizontal)
      // ⛔ 内层（横向）先消费手势：整卡外层是纵向 Scroll，ArkUI 默认嵌套里外层优先 ⇒ 右侧被裁却滑不动、滚动条也不出现（用户 2026-11-13）。
      .nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST, scrollBackward: NestedScrollMode.SELF_FIRST })
      .scrollBar(BarState.Auto)
      .width('100%')
      // ⛔ 内容短于视口时 `Scroll` 默认**居中**（用户 2026-11-18：task_wait 这类短输出居中不对）⇒ 一律 TopStart
      .align(Alignment.TopStart)
      // ⛔ 超宽内容**裁在块内**（长行/长 JSON/长路径 ⇒ 否则撑宽父级 ⇒ "字超出屏幕"）。
      .clip(true)
      // 内边距对齐 web `ToolCallBlock.tsx:66`（JSON 参数块 `px-2.5 py-1.5` = 左右 10 / 上下 6）
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.well'))
      .borderRadius(R_MD)
      // 深色 well 底与画布仅 1.0005（≈同色）⇒ 补**内凹发丝**（浅色返回 transparent ⇒ 逐字节不变）。
      .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  /** 终端输出块（语义行着色，不是代码高亮）。 */
  @Builder
  OutBlock(label: string, body: string, what: string) {
    Column({ space: SP_1 }) {
      this.SectionHead(label, body, what)
      // ⚡ 2026-10-20：去掉内层 Scroll（整卡已是单一纵向 Scroll）；块内只横滑长行。
      Scroll() {
        Column({ space: 1 }) {
          ForEach(tailLines(body, MAX_LINES), (ln: string, li: number) => {
            // 行色按**行**算一次后传入（见 `PlainLine` 头注释：builder 内不能声明局部量）
            this.PlainLine(ln, li, this.lineColor(classifyLine(ln)))
          }, (ln: string, li: number) => `o${li}`)
        }
        // ⛔ 不设 width('100%')：列宽 = 最长行 ⇒ 长行溢出即横向滚动
        .alignItems(HorizontalAlign.Start)
      }
      .scrollable(ScrollDirection.Horizontal)
      // ⛔ 内层（横向）先消费手势：整卡外层是纵向 Scroll，ArkUI 默认嵌套里外层优先 ⇒ 右侧被裁却滑不动、滚动条也不出现（用户 2026-11-13）。
      .nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST, scrollBackward: NestedScrollMode.SELF_FIRST })
      .scrollBar(BarState.Auto)
      .width('100%')
      // ⛔ 内容短于视口时 `Scroll` 默认**居中**（用户 2026-11-18：task_wait 这类短输出居中不对）⇒ 一律 TopStart
      .align(Alignment.TopStart)
      .clip(true)
      // 内边距对齐 web `ToolCallBlock.tsx:98`（终端输出块 `px-2.5 py-1.5` = 左右 10 / 上下 6）
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.well'))
      .borderRadius(R_MD)
      // 深色 well 底与画布仅 1.0005（≈同色）⇒ 补**内凹发丝**（浅色返回 transparent ⇒ 逐字节不变）。
      .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
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
        .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace').fontColor(this.pal().textMuted)
      Text(ln.newNum > 0 ? `${ln.newNum}` : '')
        .width(LN_W).textAlign(TextAlign.End)
        .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace').fontColor(this.pal().textMuted)
        .margin({ right: SP_1 })
      Text(ln.kind === DIFF_ADD ? '+' : (ln.kind === DIFF_DEL ? '-' : ' '))
        .width(10).fontSize(12).fontFamily('monospace')
        .fontColor(ln.kind === DIFF_ADD ? this.pal().successText
          : (ln.kind === DIFF_DEL ? this.pal().dangerText : this.pal().textMuted))
      Text(ln.text.length > 0 ? ln.text : ' ')
        .fontSize(typeOf('type.caption').size).fontFamily('monospace')
        // ⛔ 不折行（web `whitespace-pre`）：长行由 diff 卡整体横向滚动承担
        .wordBreak(WordBreak.NORMAL)
        .maxLines(1)
        // ⛔ **绝不 `layoutWeight(1)`**（用户 2026-11-18 P0：「diff 似乎强制换行了？代码不能这样」）：
        //   `layoutWeight` 把正文压成"视口剩余宽度" ⇒ 长行被挤到下一视觉行（读作 hard wrap，
        //   而代码折行 = **正确性**问题）。⇒ 正文按**自然宽度**渲染（行宽 = 最长行宽），
        //   横向溢出交给 `DiffBlock` 的横向 `Scroll`（与 web `whitespace-pre` + `overflow-auto` 同源）。
        .fontColor(ln.kind === DIFF_ADD ? this.pal().successText
          : (ln.kind === DIFF_DEL ? this.pal().dangerText : this.pal().textSecondary))
        .copyOption(CopyOptions.LocalDevice)
    }
    .backgroundColor(ln.kind === DIFF_ADD ? surfaceFillOf(this.pal(), 'surface.well')
      : (ln.kind === DIFF_DEL ? this.pal().warnBg : this.pal().transparent))
  }

  /** `@@` 块头：accent 徽标 + 尾注（muted）。对齐 web `DiffLineRow` 的 hunk 分支。 */
  @Builder
  HunkRow(ln: DiffLine) {
    Row({ space: SP_2 }) {
      Text(splitHunk(ln.text).marker)
        .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace').fontColor(this.pal().accentText)
      if (splitHunk(ln.text).rest.length > 0) {
        Text(splitHunk(ln.text).rest)
          .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace').fontColor(this.pal().textMuted)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      }
    }
    .width('100%')
    .padding({ top: SPACE_HAIR, bottom: SPACE_HAIR })
    .backgroundColor(this.pal().accentDeep)
  }

  /** 一个文件的 diff 卡：路径头（含 +N/−M 统计）+ 行。 */
  @Builder
  DiffFileCard(f: DiffFile) {
    Column({ space: 0 }) {
      Row({ space: SP_1 }) {
        // ⛔ **图标可见度**：同上 —— `textMuted` → `iconMuted`（图标专用档，≥3:1）。
        SymbolGlyph($r('sys.symbol.doc_text')).fontSize(ICON_SM).fontColor([colorOf(this.pal(), 'iconMuted')])
        Text(f.path.length > 0 ? f.path : i18nT('未命名文件'))
          .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace').fontColor(this.pal().textSecondary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        Text(`+${f.adds}`).fontSize(typeOf(TYPE_CHIP).size).fontColor(this.pal().successText)
        Text(`−${f.dels}`).fontSize(typeOf(TYPE_CHIP).size).fontColor(this.pal().dangerText)
      }
      .width('100%').padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.well'))
      .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })

      ForEach(tailLinesOfFile(f, MAX_DIFF_LINES), (ln: DiffLine, li: number) => {
        if (ln.kind === DIFF_HUNK) {
          this.HunkRow(ln)
        } else {
          this.DiffRow(ln)
        }
      }, (ln: DiffLine, li: number) => `d${li}`)
    }
    // ⛔ 不设 `width('100%')`：卡宽 = **最长行宽**（≥ 一屏）⇒ 长行由外层横向 Scroll 承担；
    //   100% 会把正文挤在视口内 ⇒ 被迫折行（用户 2026-11-18 P0）。
    .constraintSize({ minWidth: '100%' }).alignItems(HorizontalAlign.Start)
    .borderRadius(R_MD)
    .clip(true)
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
    // L2 卡立边（⛔ 必需 —— 本浮层 `popupColor` 是 `surface.overlay`，与 `surface.card` **同 rung**
    //   ⇒ 只设底色 = 卡片隐形。与同源孪生 `GitPanelSheet` 的 diff 卡（`skin().card` + `skin().rule`）
    //   逐项对齐见该文件 `DiffFileCard`）。
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
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
      .scrollable(ScrollDirection.Horizontal)
      // ⛔ 内层（横向）先消费手势：整卡外层是纵向 Scroll，ArkUI 默认嵌套里外层优先 ⇒ 右侧被裁却滑不动、滚动条也不出现（用户 2026-11-13）。
      .nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST, scrollBackward: NestedScrollMode.SELF_FIRST })
      .scrollBar(BarState.Auto)
      .width('100%')
      // ⛔ 内容短于视口时 `Scroll` 默认**居中**（用户 2026-11-18：task_wait 这类短输出居中不对）⇒ 一律 TopStart
      .align(Alignment.TopStart)
      // ⛔ 同 `CodeBlock`：**含横向滚动**必须把超宽内容**裁在块内**
      // （长行/长 JSON/长路径 ⇒ 否则撑宽父级 ⇒ "字超出屏幕"）。
      .clip(true)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }

  /**
   * 「转后台」条 —— web `ShellPromoteBar`（`ToolRender.tsx:483-551`）的原生落点。
   *
   * 只在**进行中的 Shell 工具**上出现（`promotable()` = web 的 `inProgress` ×
   * `callID !== ''`，见 `core/toolshell.canPromoteShell`）；
   * 四个态合一行为两条文案（idle/promoting/done/error），⛔ 不铺第二张脸。
   *
   * ⚠️ web 用 `FastForward` 图标 —— HarmonyOS 符号库**没有** `forward`/`forward_fill`
   *    （已查 SDK `sysResource.js` 真源）⇒ 取语义等价的 `arrow_down_and_rectangle_on_rectangle`
   *    （"落入叠层" = 转入后台任务层）。
   * ⛔ 命中盒靠**布局盒**（整行 `.height(HIT_TARGET_MIN)`），**不用** `responseRegion` 负偏移外扩
   *    （真机实测无效，见 `docs/UI-AUDIT-CHECKLIST.md`）。
   * ⛔ 取色一律用**已有值**（`vm.statusColor` / `statusColorOf`）—— 性能预算 B 线余量极小
   *    （`tools/perf/guard.sh`：`this.pal()` 按**字面次数**计），本条的色板读只有**面 + 发丝** 2 处。
   */
  @Builder
  PromoteBar() {
    Row({ space: SP_2 }) {
      if (this.bgDone()) {
        // 成功态：安静（不喧哗）—— 状态色勾（web `shell-promote-done` 的 CheckCircle2）
        SymbolGlyph($r('sys.symbol.checkmark_circle'))
          .fontSize(ICON_SM)
          .fontColor([statusColorOf(ST_DONE, this.themeId())])
      } else if (this.promoteState === 'promoting') {
        LoadingProgress().width(ICON_SM).height(ICON_SM).color(this.vm.statusColor)
      } else {
        SymbolGlyph($r('sys.symbol.arrow_down_and_rectangle_on_rectangle'))
          .fontSize(ICON_SM).fontColor([this.vm.statusColor])
      }
      Text(this.promoteLabel())
        .fontSize(FS_CAPTION)
        // ⚡ 2026-10-20 丝滑动画：错误态切换时文字颜色缓动
        .animation(animBase())
        .fontColor(this.promoteState === 'error' ? statusColorOf(ST_ERROR, this.themeId()) : this.vm.statusColor)
        .fontWeight(FontWeight.Medium).layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.bgDone() && this.bgTaskId().length > 0) {
        Text(this.bgTaskId())
          .fontSize(typeOf(TYPE_CHIP).size).fontFamily('monospace')
          .fontColor(this.vm.statusColor).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .flexShrink(0)
      }
    }
    .width('100%').height(HIT_TARGET_MIN)
    .padding({ left: SP_2, right: SP_2 })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.well'))
    .borderRadius(R_MD)
    .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.doPromote();
    })
  }

  /** 卡片内容（抽出为 @Builder：嵌入（+N 浮层）/ 独立浮层两条路复用同一内容）。 */
  @Builder
  CardBody() {
    Column({ space: SP_2 }) {
      // ⛔ **嵌入模式不画 header**（用户 2026-10-28：「展开后多了一个绿点还多一层缩进」）：
      //   `ToolOverflowList` 的父行已经渲染了「状态点 + 名字 + 耗时」，卡片再画一遍 = 双绿点；
      //   卡片自身的 `SP_3` 内边距再叠父层缩进 = 多一层缩进。⇒ 嵌入时只画**内容**（参数/输出）。
      if (!this.embedded) {
      // header：状态色点 + 名字 + 状态徽标 + 耗时
      Row({ space: SP_2 }) {
        Circle().width(8).height(8).fill(this.vm.statusColor)
        Text(this.vm.title.length > 0 ? this.vm.title : i18nT('工具'))
          .fontSize(FS_BODY).fontColor(this.pal().textPrimary).fontWeight(FontWeight.Medium)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.vm.status.length > 0) {
          Text(this.vm.status)
            .fontSize(typeOf(TYPE_CHIP).size).fontColor(this.vm.statusColor)
            .padding({ left: SP_1, right: SP_1, top: SPACE_HAIR, bottom: SPACE_HAIR })
            .backgroundColor(surfaceFillOf(this.pal(), 'surface.well')).borderRadius(RADIUS_CHIP)
            .border({ width: STROKE_HAIRLINE, color: insetHairlineOf(this.pal()) })
        }
        if (this.vm.elapsedMs > 0) {
          Text(formatElapsed(this.vm.elapsedMs)).fontSize(typeOf(TYPE_CHIP).size).fontColor(this.pal().textMuted)
        }
      }
      .width('100%')
      }

      // 转后台（仅**进行中的 Shell**）—— web `ShellRender:444-445` 的落点（终端卡之下）
      if (this.promotable()) {
        this.PromoteBar()
      }

      if (this.vm.summary.length > 0 && this.vm.summary !== this.vm.detail) {
        // 摘要取自命令输出**首行** ⇒ 可能携带 SGR 颜色码（web `FoldedToolGroup.tsx:387`
        // 同样用 `AnsiText` 渲染它，注释明写"vitest/ls 等"输出带颜色码）。判据/渲染同源同上。
        if (hasAnsi(this.vm.summary)) {
          Text() {
            ForEach(this.ansiSpans(this.vm.summary), (sp: AnsiSpan, si: number) => {
              Span(sp.text)
                .fontColor(ansiFgOf(sp, this.pal().textSecondary, this.ansiBgFallback()))
                .fontWeight(sp.bold ? FontWeight.Bold : FontWeight.Normal)
                .fontStyle(sp.italic ? FontStyle.Italic : FontStyle.Normal)
                .decoration({
                  type: sp.strike ? TextDecorationType.LineThrough
                    : (sp.underline ? TextDecorationType.Underline : TextDecorationType.None),
                  color: ansiFgOf(sp, this.pal().textSecondary, this.ansiBgFallback()),
                })
                .textBackgroundStyle({ color: ansiBgOf(sp, this.pal().textSecondary, this.ansiBgFallback()) })
            }, (sp: AnsiSpan, si: number) => `sm${si}`)
          }
          .wordBreak(WordBreak.BREAK_WORD)
          .fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
        } else {
          Text(this.vm.summary)
            .wordBreak(WordBreak.BREAK_WORD)
            .fontSize(FS_CAPTION).fontColor(this.pal().textSecondary)
            .width('100%')
            .copyOption(CopyOptions.LocalDevice)
        }
      }

      // 改动优先（web 的 FileCreate/FileReplace 走 diff 卡）；再给内容/参数/输出兜底
      if (hasDiffBody(this.vm.hints)) {
        this.DiffBlock()
      }
      // 文件类工具：按**文件语言**高亮「内容」（用户 2026-10-10：「filecreate 也要高亮」）。
      // 有内容时**不再重复**显示 `参数`（args 里就是同一份 content，重复即噪音；对齐 web
      // 的 `hideArgs`）。
      if (this.vm.content.length > 0) {
        this.CodeBlock(this.vm.contentLang.length > 0 ? `${i18nT('内容')} · ${this.vm.contentLang}` : i18nT('内容'),
          this.vm.content, 'content', this.vm.contentLang)
      } else if (this.vm.args.length > 0) {
        this.CodeBlock(i18nT('参数'), this.vm.args, 'args', this.vm.argsLang)
      }
      if (this.vm.detail.length > 0) {
        this.OutBlock(i18nT('输出'), this.vm.detail, 'output')
      }
      if (this.vm.hasExit) {
        Text(`${i18nT('退出码')} ${this.vm.exitCode}`)
          .fontSize(typeOf(TYPE_CHIP).size)
          // ⚡ 2026-10-20 丝滑动画：退出码颜色缓动
          .animation(animBase())
          .fontColor(this.vm.exitCode !== 0 ? this.pal().dangerText : this.pal().textMuted)
      }
      if (!this.vm.hasAny) {
        Text(i18nT('暂无详情')).fontSize(FS_CAPTION).fontColor(this.pal().textMuted)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start)
    // ⛔ 卡片内边距：没有它内容会贴死边框（真机反馈"一点 padding 没有"）。
    .padding(SP_3)
  }

  build() {
    // ⚡ 2026-10-20 浮层滚动修复：独立浮层 = 整卡**单一纵向 Scroll**（对齐 web 根
    //   `overflow-y-auto max-h-[min(60vh,480px)]`）。此前整卡不可滚 ⇒ 参数 + 输出等多块时
    //   下方内容被裁掉，用户无法查看完整参数/输出（用户亲报）。
    // ⛔ 嵌入模式（"+N" 溢出浮层内）**不再自带** Scroll/限高：外层浮层已是单一纵向 Scroll，
    //   再套一层 = 嵌套滚动冲突 + 排版错乱（用户亲报「在 +x 里展开详情有严重排版 bug」）。
    if (this.embedded) {
      this.CardBody()
    } else {
      Scroll() {
        this.CardBody()
      }
      .scrollBar(BarState.Auto)
      .width('100%')
      // ⛔ 内容短于视口时 `Scroll` 默认**居中**（用户 2026-11-18：task_wait 这类短输出居中不对）⇒ 一律 TopStart
      .align(Alignment.TopStart)
      .constraintSize({ maxHeight: BODY_MAX_H + 220 })
      .align(Alignment.TopStart)
    }
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
/** 一行预览：参数优先，其次输出（单行、去换行、超长省略）。空 ⇒ 空串（不占行）。 */
function toolPreviewLine(t: ToolProgress): string {
  const pick = (raw: string): string => {
    const one: string = raw.replace(/\s+/g, ' ').trim();
    return one.length > 72 ? `${one.substring(0, 72)}…` : one;
  };
  const args: string = t.args !== undefined && t.args.length > 0 ? pick(t.args) : '';
  if (args.length > 0) { return `→ ${args}`; }
  const out: string = t.detail !== undefined && t.detail.length > 0 ? pick(t.detail) : '';
  return out.length > 0 ? `← ${out}` : '';
}

/**
 * "+N" 溢出浮层：被收纳工具的全量列表（**折叠展开面板**）。
 *
 * 2026-10-28 用户：「折叠展开的样式设计太丑陋了，请重新设计折叠工具的展开面板」。
 * 形态（对齐 iOS inset-grouped 的**层级**，不是一堆平铺文字行）：
 *   · 头部：`工具` + 计数（弱色，说明"这里是什么"）；
 *   · 每行 = 状态点 + 名称（caption medium）+ **一行参数/输出预览**（micro、等宽、弱色）
 *     + 展开指示（`chevron_right` 旋转 90°）；行高 ≥44（可点性），行间只有发丝线；
 *   · 展开后：详情卡**缩进嵌在行下方**（左缘对齐名称列，带一点内边距），不再与行首混排；
 *   · 行展开时回调 `onEnsure` —— 被折叠的工具此前**从不发** `/api/iteration_detail`
 *     （用户 2026-10-28：「被折叠的工具，展开后无法看到详情」）。
 */
@Component
export struct ToolOverflowList {
  /**
   * 覆盖列表的工具。
   *
   * ⛔ 用户 2026-11-18 的口径：**打开前就把详情取回来**（`IterBlocksView.toggleOverflow` 里
   *   `await` 全部 settle 后才打开）⇒ 这里拿到的是"已带摘要"的那一批，"第一次打开 == 第二次打开"。
   *   不再在浮层内做"打开后再刷新"（`bindPopup` 子树不重建，那条路永远走不通）。
   */
  @Prop tools: ToolProgress[] = [];
  @Prop theme: string = 'dark';
  /**
   * **生效主题的全局订阅**（§21.124 用户亲报「切主题后老文字颜色不变、新的才变」）。
   *
   * ⛔ 本组件挂在 `MessageRow` 的**带参 `@Builder` 子树**（`AssistantBlock(this.row)`）里 ——
   *   该子树在主题变化时**不重建**（参数是同一个 `ChatRow` 引用 ⇒ ArkUI V1 判「参数没变」，
   *   见 `docs/ARKTS-GOTCHAS.md §4/§37`）⇒ 子树里组件在**创建那刻**拿到的 `@Prop theme`
   *   会**永久冻结**（旧块停旧色板、新建块才用新色板 = 用户看到的「老的不变、新的才变」）。
   * ✅ 正解 = 本仓范式（同 `MessageRow.themeId()` / `MarkdownView`）：**组件自己订阅**
   *   `AppStorage('appTheme')` ⇒ 主题变更直接驱动本组件重绘，不经父级投递。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** 生效主题：全局订阅优先，`@Prop theme` 仅兜底（同 `MessageRow.themeId()`）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }
  /** 这批工具是否来自**在飞块**（LiveTailView）—— 决定 live `pending` 是否按执行中着色。 */
  @Prop live: boolean = false;
  onCopy: (text: string, what: string) => void = (text: string, what: string) => {
  };
  /**
   * 取一次详情（`iter` = 工具自带迭代号；页面按 (turn, iter) 打 `/api/iteration_detail`）。
   *
   * ⛔ 返回 Promise：**本组件要 await**（打开浮层时批量拉、拉完自增代数刷新自己）。
   *   用户 2026-11-18：「我点开你就应该发 api，期间显示 loading 动画，然后 api 结束之后渲染摘要」。
   */
  onEnsure: (iter: number, name: string, toolIter?: number) => Promise<void> =
    (iter: number, name: string, toolIter?: number): Promise<void> => Promise.resolve();


  @State sel: number = -1;
  /**
   * 详情代数（`store.fetchIterationDetail` 每到一批就 +1）。
   *
   * ⛔ 本组件挂在 `bindPopup` 的 builder 里 ——**打开那一刻构建，之后父级数据变化不会重建**
   *   （用户 2026-11-17 实证：第一次点开看不到参数/输出，关闭再打开才有）。⇒ 自己订阅这个
   *   全局代数：详情回来 ⇒ 本组件自渲染 ⇒ `withToolDetail` 合上覆盖层 ⇒ 立刻可见。
   */
  @StorageProp('toolDetailGen') toolGen: number = 0;

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  /** 状态点颜色 —— 判据**同源**：走唯一映射 `ToolVisual.statusColorOf`（判据是 `core/toolstatus.renderKind`）。 */
  private dot(t: ToolProgress): string {
    return statusColorOf(renderKind(t.status, t.exit_code, this.live), this.themeId());
  }

  /**
   * 列表实际渲染的工具：把**打开之后才到的详情**（覆盖层，见 `core/toollayer`）合到手上这份上。
   *
   * ⛔ 为什么放在方法里而不是 ForEach 体内：ArkTS 禁止 builder 体内声明局部量（10905209）。
   *   `toolGen` 变化 ⇒ 本组件自渲染 ⇒ 这里重新合并 ⇒ 详情立刻可见（无需关闭重开）。
   */
  private shownTools(): ToolProgress[] {
    const out: ToolProgress[] = [];
    for (let i = 0; i < this.tools.length; i++) {
      out.push(withToolDetail(this.tools[i]));
    }
    return out;
  }

  private vmOf(t: ToolProgress): ToolDetailVM {
    return toolDetailVM(t, this.dot(t), '');
  }

  /** 折叠面板的**唯一取色入口**（性能预算 B 线：本文件的 `pal()/palOnce()` 调用点只许减）。
   *  返回 `[primary, secondary, muted, iconMuted, hairline]`，按主题 memo。 */
  private tintCache: string[] = [];
  private tintTheme: string = '';
  private tint(): string[] {
    const th: string = this.themeId();
    if (this.tintTheme === th && this.tintCache.length === 5) {
      return this.tintCache;
    }
    const p: Palette = this.pal();
    this.tintCache = [p.textPrimary, p.textSecondary, p.textMuted, colorOf(p, 'iconMuted'), hairlineOf(p)];
    this.tintTheme = th;
    return this.tintCache;
  }

  build() {
    Column() {
      // ── 头部：这里是什么 + 一共几枚（弱色小字；不抢内容层级）──
      Row({ space: SP_1 }) {
        SymbolGlyph($r('sys.symbol.list_bullet'))
          .fontSize(ICON_SM)
          .fontColor([this.tint()[3]])
        Text(i18nT('工具'))
          .fontSize(typeOf(TYPE_CHIP).size)
          .fontColor(this.tint()[1])
          .layoutWeight(1)
        Text(`${this.tools.length}`)
          .fontSize(typeOf(TYPE_CHIP).size)
          .fontColor(this.tint()[2])
      }
      .width('100%')
      .padding({ left: SP_1, right: SP_1, top: SP_1, bottom: SP_2 })
      .alignItems(VerticalAlign.Center)

      Scroll() {
        Column() {
          ForEach(this.shownTools(), (t: ToolProgress, i: number) => {
            Column() {
              Row({ space: SP_2 }) {
                // 状态点（唯一状态色出口 = `statusColorOf`，与 pill 同源）
                Row()
                  .width(OVERFLOW_DOT).height(OVERFLOW_DOT).borderRadius(OVERFLOW_DOT / 2)
                  .backgroundColor(this.dot(t))
                  .flexShrink(0)
                Column({ space: 2 }) {
                  Text(t.label !== undefined && t.label.length > 0 ? t.label : t.name)
                    .fontSize(typeOf(TYPE_CHIP).size)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.tint()[0])
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    // 横向约束（H1：Row 内动态文本无约束会顶出屏宽）
                    .constraintSize({ maxWidth: '100%' })
                    .width('100%')
                  if (toolPreviewLine(t).length > 0) {
                    Text(toolPreviewLine(t))
                      .fontSize(typeOf('type.micro').size)
                      .fontFamily('monospace')
                      .fontColor(this.tint()[2])
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                  }
                }
                .layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (t.elapsed_ms !== undefined && t.elapsed_ms > 0) {
                  Text(formatElapsed(t.elapsed_ms))
                    .fontSize(typeOf('type.micro').size)
                    .fontColor(this.tint()[2])
                    .flexShrink(0)
                }
                SymbolGlyph($r('sys.symbol.chevron_right'))
                  .fontSize(ICON_SM)
                  .fontColor([this.tint()[3]])
                  // ⛔ 不加 `.animation()`：本文件动效预算 2（`motion_budget` 只许缩短）
                  .rotate({ angle: this.sel === i ? 90 : 0 })
              }
              .width('100%')
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .padding({ left: SP_2, right: SP_1, top: SP_1, bottom: SP_1 })
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                const next: number = this.sel === i ? -1 : i;
                this.sel = next;
                if (next === i) {
                  // 展开 ⇒ 先在**这一行**显示 loading（`busyIdx`），拉完在 finally 里清掉
                  this.onEnsure(t.iteration !== undefined ? t.iteration : 0, t.name, t.iteration);
                }
              })

              // 展开区：详情卡**缩进嵌在行下方**（左缘对齐名称列），与行本身分层
              if (this.sel === i) {
                Column() {
                  // ⛔ 用户 2026-11-18：「没数据为什么不渲染 loading，而是这样渲染，丑死了」：
                  //   详情还没到（参数与输出都空）⇒ 渲染**紧凑 loading 行**，不要把 label 当正文铺开。
                  //   （浮层打开后若详情才到，父级会按 `toolDetailGen` 自动重开一次 ⇒ 换真卡片。）
                  // ⛔ 用户 2026-11-18：「有数据的时候列表都会显示参数的摘要」—— 只要这枚工具**有摘要/预览**
                  //   （label/summary/args 任一可显示），就必须渲染摘要，绝不能用 loading 盖住它。
                  //   loading 只留给"彻底空心"的工具（连预览行都没有），例如刚建的无输出合成工具。
                  ToolPopoverCard({
                    vm: this.vmOf(t),
                    theme: this.themeId(),
                    embedded: true,
                    onCopy: this.onCopy,
                  })
                }
                .width('100%')
                // 只留右侧/底部一点点呼吸；左/上交给卡片自身 `padding(SP_3)`
                .padding({ right: SP_2, bottom: SP_2 })
                .alignItems(HorizontalAlign.Start)
              }
              // 行间发丝线（最后一行不画 —— 与 iOS inset-grouped 同款）
              if (i < this.tools.length - 1) {
                Divider()
                  .strokeWidth(STROKE_HAIRLINE)
                  .color(this.tint()[4])
                  .margin({ left: SP_2 })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }, (t: ToolProgress, i: number) => `${t.name}#${t.call_id !== undefined ? t.call_id : ''}#${i}`)
        }
        .width('100%').alignItems(HorizontalAlign.Start)
      }
      .scrollBar(BarState.Off)
      .width('100%')
      // 与独立工具浮层同口径（web 根 `max-h-[min(60vh,480px)]`）——单一纵向滚动源。
      .constraintSize({ maxHeight: BODY_MAX_H + 220 })
      .align(Alignment.TopStart)
    }
    .width('100%').alignItems(HorizontalAlign.Start)
  }
}
