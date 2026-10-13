/**
 * 语法高亮 —— 用 **Prism4j**（`@hxa-atpc/noties_prism4j`）做分词，**不用自己写着色器**。
 *
 * 分工（这是本模块存在的意义）：
 *   · Prism4j 负责**语法解析**：输出 `Text` / `Syntax` 节点树，覆盖上百种语言
 *     （JSON / diff / bash / python / ArkTS …），我们**不重复实现词法**。
 *   · 本模块负责**把节点树摊平成可渲染的 span 序列**，并把 Prism 的 token 类型映射成
 *     **语义色键**（`comment`/`string`/`keyword`…），真正的颜色由 `Palette` 决定
 *     ⇒ 高亮配色与全站设计系统同源，换主题/换强调色自动一致。
 *
 * ⚠️ `tokenize()` 是**同步 CPU 计算**（库文档明确提示），故对输入长度做上限保护，
 *    超长文本退化为"不判语言 → 纯文本"，避免阻塞 UI 线程。
 *
 * 纯逻辑（映射表 + 语言别名）可脱机单测：`tools/tests/highlight.test.ts`。
 */
import {
  Prism4j, createAllLanguagesGrammarLocator, GrammarLocator, Grammar, Node, Text, Syntax,
} from '@hxa-atpc/noties_prism4j';

/** 超过这个字符数就不做语法分析（同步 CPU，防卡顿）。 */
export const MAX_HL_CHARS: number = 20000;

/** 一个可渲染片段：文本 + 语义色键（空串 = 普通文本）。 */
export class HlSpan {
  text: string = '';
  /** 语义色键，见 `tokenKey()`。空 = 默认前景色。 */
  key: string = '';
}

// ── 语义色键（**颜色不在这里定**，只给键；具体色值由 Palette 提供）─────────────
export const K_COMMENT: string = 'comment';
export const K_STRING: string = 'string';
export const K_KEYWORD: string = 'keyword';
export const K_NUMBER: string = 'number';
export const K_FUNC: string = 'func';
export const K_PROP: string = 'prop';
export const K_TYPE: string = 'type';
export const K_OP: string = 'op';
export const K_PUNCT: string = 'punct';
export const K_TAG: string = 'tag';
export const K_DIFF_ADD: string = 'diff-add';
export const K_DIFF_DEL: string = 'diff-del';

/**
 * Prism token 类型 ⇒ 语义色键。
 * 用**前缀匹配**（Prism 类型常带后缀，如 `string-interpolation` / `attr-name`），
 * 未识别的类型回落空串（默认前景色）——宁可不着色，也不要着错色。
 */
export function tokenKey(type: string): string {
  if (type.length === 0) { return ''; }
  const t: string = type.toLowerCase();
  if (t.indexOf('comment') === 0) { return K_COMMENT; }
  if (t.indexOf('string') === 0 || t.indexOf('attr-value') === 0 || t.indexOf('char') === 0) { return K_STRING; }
  if (t.indexOf('keyword') === 0 || t.indexOf('boolean') === 0 || t.indexOf('important') === 0) { return K_KEYWORD; }
  if (t.indexOf('number') === 0) { return K_NUMBER; }
  if (t.indexOf('function') === 0 || t.indexOf('method') === 0) { return K_FUNC; }
  if (t.indexOf('property') === 0 || t.indexOf('attr-name') === 0) { return K_PROP; }
  if (t.indexOf('class-name') === 0 || t.indexOf('builtin') === 0 || t.indexOf('namespace') === 0
    || t.indexOf('type') === 0) { return K_TYPE; }
  if (t.indexOf('operator') === 0) { return K_OP; }
  if (t.indexOf('punctuation') === 0) { return K_PUNCT; }
  if (t.indexOf('tag') === 0 || t.indexOf('selector') === 0) { return K_TAG; }
  if (t.indexOf('inserted') === 0) { return K_DIFF_ADD; }
  if (t.indexOf('deleted') === 0) { return K_DIFF_DEL; }
  return '';
}

/**
 * 本项目语言名 ⇒ Prism4j 语法名。
 * Prism4j 的语言名有自己的别名表（`realLanguageName`），但**不完全等价**于我们
 * 从服务端/标注里拿到的那套写法（如 `ArkTS`/`shell`/`yml`），故显式映射一遍。
 */
export function prismLangName(lang: string): string {
  const l: string = lang.trim().toLowerCase();
  if (l.length === 0) { return ''; }
  if (l === 'arkts' || l === 'ets' || l === 'typescript' || l === 'ts' || l === 'tsx') { return 'typescript'; }
  if (l === 'js' || l === 'jsx' || l === 'javascript' || l === 'node') { return 'javascript'; }
  if (l === 'shell' || l === 'sh' || l === 'zsh' || l === 'console' || l === 'bash') { return 'bash'; }
  if (l === 'yml') { return 'yaml'; }
  if (l === 'py') { return 'python'; }
  if (l === 'c++' || l === 'cc' || l === 'cxx') { return 'cpp'; }
  if (l === 'c#') { return 'csharp'; }
  if (l === 'htm') { return 'markup'; }
  if (l === 'text' || l === 'plain' || l === 'plaintext' || l === 'txt') { return ''; }
  return l;
}

let engineRef: Prism4j | null = null;

/** 懒建引擎（`AllLanguagesGrammarLocator` 覆盖全部内置语言）。 */
function engine(): Prism4j {
  if (engineRef === null) {
    const loc: GrammarLocator = createAllLanguagesGrammarLocator();
    engineRef = new Prism4j(loc);
  }
  return engineRef;
}

/** 该语言名 Prism4j 是否认得（不认得就别硬着色）。 */
export function supportsLang(lang: string): boolean {
  const name: string = prismLangName(lang);
  if (name.length === 0) { return false; }
  try {
    const g: Grammar | null = engine().grammar(name);
    return g !== null;
  } catch (e) {
    return false;
  }
}

/** 把节点树摊平成 span 序列（`inherited` = 外层语法类型，内层覆盖它）。 */
function flatten(nodes: ReadonlyArray<Node>, out: HlSpan[], inherited: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const n: Node = nodes[i];
    if (n.isSyntax()) {
      const s: Syntax = n as Syntax;
      // `alias` 若存在则优先（Prism 用它把泛型 token 语义化，如 `language-diff` 里的 `inserted`）
      const alias: string | null = s.alias();
      const t: string = alias !== null && alias.length > 0 ? alias : s.type();
      flatten(s.children(), out, t);
    } else {
      const tx: Text = n as Text;
      const sp: HlSpan = new HlSpan();
      sp.text = tx.literal();
      sp.key = tokenKey(inherited);
      out.push(sp);
    }
  }
}

/**
 * 高亮结果**记忆化**（LRU）。
 *
 * 为什么必须缓存（用户 2026-10-13 亲报「往上加载特别多内容后明细特别卡」+ 长期要求「性能也要非常好」）：
 * `highlightCode()` 每次调用都要跑一遍 Prism4j 分词，而**行视图每次重建都会重跑它**
 * ——`LazyForEach` 的整表 reload（放开行窗口/加载更早历史）、主题变更、流式期间 live 行逐帧重建
 * 全都算"重建"。同一 `(语言, 代码)` 的高亮结果是**纯函数**（只取决于这两个入参）⇒ 缓存即正确，
 * 重建代价从"分词"降到"查表"。
 *
 * ⛔ 键 = `语法名\x00代码全文`：**逐字做键、不做数值哈希**。哈希碰撞会把 A 的配色/文本渲染成 B
 *    （"内容错了但看不出来"的最坏一类事故）；逐字键不可能碰撞，且键里已含全文 ⇒ 不再另存副本。
 * 上限双闸（条目数 + 总字符数）：超大代码块不至于把内存吃光；超限按**插入序**淘汰最旧。
 */
const HL_MEMO_MAX_ENTRIES: number = 64;
const HL_MEMO_MAX_CHARS: number = 256 * 1024;
const HL_MEMO: Map<string, HlSpan[]> = new Map<string, HlSpan[]>();
let hlMemoChars: number = 0;

/** 记忆化表当前条目数（诊断/判据用；非渲染路径）。 */
export function highlightMemoSize(): number {
  return HL_MEMO.size;
}

/** 记忆化表当前总字符数（诊断/判据用）。 */
export function highlightMemoChars(): number {
  return hlMemoChars;
}

/** 清空记忆化表（诊断/测试用）。 */
export function clearHighlightMemo(): void {
  HL_MEMO.clear();
  hlMemoChars = 0;
}

/** 超限时按插入序淘汰最旧（`Map` 保序 ⇒ 首个即最旧）。 */
function evictHighlightMemo(): void {
  if (HL_MEMO.size <= HL_MEMO_MAX_ENTRIES && hlMemoChars <= HL_MEMO_MAX_CHARS) {
    return;
  }
  const order: string[] = [];
  HL_MEMO.forEach((_v: HlSpan[], k: string) => {
    order.push(k);
  });
  for (let i = 0; i < order.length; i++) {
    if (HL_MEMO.size <= HL_MEMO_MAX_ENTRIES && hlMemoChars <= HL_MEMO_MAX_CHARS) {
      break;
    }
    const k: string = order[i];
    HL_MEMO.delete(k);
    hlMemoChars -= k.length;
  }
}

/**
 * 高亮入口：返回可直接渲染的 span 序列（**带记忆化**；返回值由调用方**只读**使用）。
 *
 * 任何异常/超长/未知语言都**退化为单段纯文本**（绝不吞内容 —— 用户至少要能看到原文）。
 */
export function highlightCode(code: string, lang: string): HlSpan[] {
  const name: string = prismLangName(lang);
  // 键必须含**语言**与**代码全文**：同一段代码在不同语言下着色不同（`''` = 纯文本退化）。
  const key: string = `${name}\u0000${code}`;
  const hit: HlSpan[] | undefined = HL_MEMO.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const out: HlSpan[] = highlightUncached(code, name);
  // 单条超字符上限 ⇒ 不缓存（否则刚写入就被淘汰，等于把整张表冲干净）
  if (key.length <= HL_MEMO_MAX_CHARS) {
    HL_MEMO.set(key, out);
    hlMemoChars += key.length;
    evictHighlightMemo();
  }
  return out;
}

/** 未缓存的高亮实现（纯函数；`name` 已由 `prismLangName` 归一）。 */
function highlightUncached(code: string, name: string): HlSpan[] {
  const plain: HlSpan[] = [];
  const whole: HlSpan = new HlSpan();
  whole.text = code;
  whole.key = '';
  plain.push(whole);
  if (code.length === 0 || code.length > MAX_HL_CHARS) { return plain; }
  if (name.length === 0) { return plain; }

  try {
    const g: Grammar | null = engine().grammar(name);
    if (g === null) { return plain; }
    const nodes: Node[] = engine().tokenize(code, g);
    const out: HlSpan[] = [];
    flatten(nodes, out, '');
    // 防御：摊平后内容必须与原串一致，否则宁可退回纯文本（保证零丢失）
    let acc: string = '';
    for (let i = 0; i < out.length; i++) { acc += out[i].text; }
    if (acc !== code) { return plain; }
    return out.length > 0 ? out : plain;
  } catch (e) {
    return plain;
  }
}

/** 从代码块围栏信息里猜语言（如 ```json / ```diff / ```bash）。 */
export function langFromFence(info: string): string {
  const t: string = info.trim().toLowerCase();
  if (t.length === 0) { return ''; }
  const sp: number = t.indexOf(' ');
  return sp > 0 ? t.substring(0, sp) : t;
}
