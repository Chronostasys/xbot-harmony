/**
 * Markdown **渲染判据层**（纯逻辑，零 ArkUI 依赖，可脱机单测）。
 *
 * 为什么单独一层：`components/MarkdownView.ets` 是 ArkUI 组件，**不进离线 harness**
 * （`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译）⇒ 判据写在组件里就**测不到**。
 * 把"链接目标 / 溢出策略 / 代码 token 色 / 行内样式记忆化"这些**纯判据**搬到 core：
 *   ① 判据与渲染同源（本仓铁律）；
 *   ② 可被 `tools/tests/mdview_perf.test.ts` 用真函数 + 真数值断言（回退即红）；
 *   ③ 组件退化为"只做属性赋值"的哑渲染器。
 *
 * ⛔ 本文件属 `core/`：**禁止** import ArkUI / `@ohos.*`（`tools/tests/run.sh` 会 TS2307）。
 */

import { Palette, contrastRatio } from './theme';
// `#13` 视觉裁决：代码块底 = `surface.well`(sunken)（palette 驱动）⇒ token 色的结对底改为 `wellOf`。
import { wellOf } from './design';
import { MdSpan, parseInlineCached } from './markdown';
import {
  K_COMMENT, K_STRING, K_KEYWORD, K_NUMBER, K_FUNC, K_PROP, K_TYPE, K_TAG, K_OP, K_PUNCT,
  K_DIFF_ADD, K_DIFF_DEL,
} from './highlight';

// ── 溢出策略（P0#2）──────────────────────────────────────────────────────────
/**
 * 块的溢出策略。
 * - `Wrap`：词内折行（正文/表格/代码"换行模式"）
 * - `Scroll`：**横向滚动**（代码"不换行模式"）—— 对齐 web `MarkdownRenderer.tsx:226`
 *   `overflow-x-auto whitespace-pre`（原生旧实现是 `maxLines(1000)` + `Clip` ⇒ **静默裁掉长行**）。
 */
export enum MdOverflow {
  Wrap = 0,
  Scroll = 1,
}

/**
 * 代码块的溢出策略（纯函数，供组件直接消费）。
 * @param wrapCode 用户设置里的"代码换行"开关（设置面板，与 web 共享 `web:ui:code-word-wrap`）。
 */
export function codeOverflow(wrapCode: boolean): MdOverflow {
  return wrapCode ? MdOverflow.Wrap : MdOverflow.Scroll;
}

// ── 链接（P0#1）──────────────────────────────────────────────────────────────
/** 文本里的一个链接节点：显示文本 + 可点击目标（href）。 */
export class MdLink {
  text: string = '';
  href: string = '';
}

/**
 * 抽取文本里的**链接节点**（纯函数）—— 供组件把它们渲染成**可点击**的 span。
 *
 * 为什么需要它：原生旧实现把链接渲染成"带下划线 + accentSoft 的 Span"，**没有任何 onClick**
 * ⇒ 链接根本点不开（web 权威 `<a target="_blank" href>`，`MarkdownRenderer.tsx:311-321`）。
 */
export function linksOf(text: string): MdLink[] {
  const out: MdLink[] = [];
  const spans: MdSpan[] = parseInlineCached(text);
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].link.length > 0) {
      const l: MdLink = new MdLink();
      l.text = spans[i].text;
      l.href = spans[i].link;
      out.push(l);
    }
  }
  return out;
}

// ── 代码 token 配色（P0#3）───────────────────────────────────────────────────
/**
 * 代码 token 文本色对**代码块底**的最低对比度。
 * 正文阈值是 4.5（WCAG AA）；token 是 13fp 的短片段，取 3.0（与图标/大字同档）。
 */
export const CODE_TOKEN_MIN_RATIO: number = 3.0;

/**
 * 语义色键 ⇒ 主题色（**与 `ToolPopover.keyColor` 逐条同源** —— 全 App 只有一套语法色）。
 * 返回空串 = 无对应角色（调用方退回默认前景）。
 */
export function codeRoleColor(key: string, pal: Palette): string {
  if (key === K_COMMENT) { return pal.textMuted; }
  if (key === K_STRING) { return pal.successText; }
  if (key === K_KEYWORD) { return pal.accentText; }
  if (key === K_NUMBER) { return pal.warn; }
  if (key === K_FUNC) { return pal.accentSoft; }
  if (key === K_PROP) { return pal.accentText; }
  if (key === K_TYPE) { return pal.textPrimary; }
  if (key === K_TAG) { return pal.accentSoft; }
  if (key === K_OP || key === K_PUNCT) { return pal.textMuted; }
  if (key === K_DIFF_ADD) { return pal.successText; }
  if (key === K_DIFF_DEL) { return pal.dangerText; }
  return '';
}

/**
 * 代码 token 的最终文本色 —— **双层保证**：
 *  ① 与 `ToolPopover` 同一份语义角色映射（不新造第二套语法色）；
 *  ② 代码块底 = `surface.well`(sunken)（`#13` 视觉裁决：palette 驱动，非 md 主题）⇒ 对角色色加
 *     **对比度护栏**：不达标就退回**同族 palette 前景** `pal.textPrimary`（与 sunken 必然可读）。
 *
 * ⚠️ 为什么不再是 `codeFgOf(mdTheme)`：旧底的结对色是 md 主题的代码字色；底改成 `surface.well`
 *    （palette）后，二者成"两条独立明暗轴"⇒ 会出现"浅字压浅底"（例：porcelain + 默认 `vscode-dark`
 *    ⇒ `#D4D4D4` 压 `#F2F2F2`，实测 ≈1.13，代码**整块不可见**）。护栏与回退一律按**真实底**取。
 * `mdTheme` 形参**保留**（调用点与既有测试的签名兼容；语义上不再使用）。
 */
export function codeTokenColor(key: string, pal: Palette, mdTheme: string): string {
  const base: string = pal.textPrimary;
  if (key.length === 0) { return base; }
  const cand: string = codeRoleColor(key, pal);
  if (cand.length === 0) { return base; }
  return contrastRatio(cand, wellOf(pal)) >= CODE_TOKEN_MIN_RATIO ? cand : base;
}

// ── 行内样式（P1#5：按文本记忆化）────────────────────────────────────────────
/**
 * 行内片段的**预计算样式**。
 *
 * 为什么在 TS 侧算好：ArkUI 的 `Text` 只接受 Span 类子组件，在 `Text(){ForEach(){ if/else }}`
 * 里做条件渲染不保证支持 —— 这正是"渲染错乱"的典型来源。改成一维 ForEach + 纯属性赋值，
 * 分支逻辑全部提前算完。
 */
export class MdInlineStyle {
  text: string = '';
  size: number = 15;
  /** 由调用方按当前色板赋值（类字段默认值不能依赖主题） */
  color: string = '';
  bold: boolean = false;
  italic: boolean = false;
  strike: boolean = false;
  underline: boolean = false;
  mono: boolean = false;
  /** 背景（由调用方按当前色板赋值；空 = 无背景） */
  bg: string = '';
  /**
   * 非空 = 这是一个**链接**，值为可点击目标（href）。
   * 组件据它给该 Span 挂 `onClick`（原生旧实现没有这一步 ⇒ 链接点不开）。
   */
  link: string = '';
}

/**
 * 行内样式缓存键。
 * ⛔ **必须**把调色板与 md 主题纳入键：否则换主题后会命中"上一套主题的颜色"⇒ 陈旧结果。
 * 调色板不传 `theme` 名，而是取几个**代表色**拼键（调用点只拿得到 `Palette`，见 `MarkdownView.sz()` 同款约束）。
 */
export function mdInlineKey(text: string, pal: Palette, mdTheme: string, baseColor: string): string {
  return `${mdTheme}|${pal.appBg}|${pal.surfaceAlt}|${pal.textPrimary}|${pal.textSecondary}`
    + `|${pal.textMuted}|${pal.accent}|${pal.accentSoft}|${pal.accentText}|${baseColor}|${text}`;
}

/** 行内样式记忆化的统计。 */
export class MdInlineMemoStats {
  hits: number = 0;
  misses: number = 0;
  entries: number = 0;
  chars: number = 0;
}

const MD_INLINE_MAX_CHARS: number = 512 * 1024;

/**
 * 行内样式的**按文本记忆化**。
 *
 * 为什么必须有：`inlineStyles()` 此前在**每次 build** 里对全部行内文本重算（`new MdInlineStyle[]`
 * + `codeTone()` + `contrastRatio` 数学），完全不进缓存 —— 实测 96KB 文档**单次 build 960 次**重算。
 * 流式期组件会被反复重建 ⇒ 这份开销每次都白付。缓存后"同一文本 + 同一主题"只算一次。
 *
 * 键含主题与调色板（`mdInlineKey`）⇒ 换主题不会命中旧色；容量按字符数封顶，超限淘汰最早的。
 */
export class MdInlineMemo {
  private map: Map<string, MdInlineStyle[]> = new Map<string, MdInlineStyle[]>();
  private order: string[] = [];
  private chars: number = 0;
  private hitCount: number = 0;
  private missCount: number = 0;

  /** 命中则返回；未命中返回 undefined（由 `getOrCompute` 计算并写入）。 */
  get(key: string): MdInlineStyle[] | undefined {
    const hit: MdInlineStyle[] | undefined = this.map.get(key);
    if (hit !== undefined) {
      this.hitCount++;
    }
    return hit;
  }

  put(key: string, value: MdInlineStyle[], cost: number): void {
    this.missCount++;
    this.map.set(key, value);
    this.order.push(key);
    this.chars += cost;
    while (this.chars > MD_INLINE_MAX_CHARS && this.order.length > 1) {
      const oldest: string = this.order[0];
      this.order.splice(0, 1);
      const gone: MdInlineStyle[] | undefined = this.map.get(oldest);
      this.map.delete(oldest);
      this.chars -= gone !== undefined ? gone.length : 0;
    }
  }

  /** 命中即返回；未命中才调用 `compute`（**这是"第二次 build 不再重算"的判据载体**）。 */
  getOrCompute(key: string, compute: () => MdInlineStyle[]): MdInlineStyle[] {
    const hit: MdInlineStyle[] | undefined = this.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const v: MdInlineStyle[] = compute();
    this.put(key, v, v.length);
    return v;
  }

  stats(): MdInlineMemoStats {
    const st: MdInlineMemoStats = new MdInlineMemoStats();
    st.hits = this.hitCount;
    st.misses = this.missCount;
    st.entries = this.order.length;
    st.chars = this.chars;
    return st;
  }

  clear(): void {
    this.map = new Map<string, MdInlineStyle[]>();
    this.order = [];
    this.chars = 0;
    this.hitCount = 0;
    this.missCount = 0;
  }
}
