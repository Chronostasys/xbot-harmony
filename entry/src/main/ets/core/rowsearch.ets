/**
 * rowsearch — 「输出搜索」纯函数（对话内全行查找）。
 *
 * ── 定位 ────────────────────────────────────────────────────────────────────
 *   web **没有**对话内搜索（2026-10-17 核查 `web/src`：零命中消息搜索 UI）⇒ 这是
 *   原生的**超越性功能**（goal：排版/功能超越 web）。落点 = `MessageNav` 面板顶部
 *   搜索框：空查询 = 现行「用户消息锚点列表」（web 同构）；非空 = 全行搜索结果。
 *
 * ── 设计约束 ────────────────────────────────────────────────────────────────
 *   · ⛔ 不 import `@Observed` 类（ChatRow）：`core/*.ets` 被脱机 harness 当纯 TS
 *     编译，装饰器有风险 ⇒ 用**最小结构契约** `SearchRow`（AGENTS.md 合法修法），
 *     调用点（MessageNav/Index）传 `ChatRow[]` 结构化兼容。
 *   · 大小写不敏感（双方 toLowerCase 后比对；snippet 保留原文大小写）。
 *   · `SNIPPET_PAD` 字符的上下文窗口；命中段在 snippet 内的位置由 `at` 给出
 *     （UI 侧用它拆 Span 高亮，不重复找）。
 *   · 空查询/全空白 ⇒ 空结果（UI 据此回落锚点列表模式）。
 *   · 多命中同一行（如反复出现的词）：每行只出**首个**命中（导航语义是「跳到行」，
 *     行内多命中无增量价值；与 `msgindex` 一行一锚点同口径）。
 */

/** 搜索输入的最小结构契约：有 `role` 与 `content` 即可（ChatRow 结构化兼容）。 */
export interface SearchRow {
  role: string;
  content: string;
}

/** 一条命中：行索引 + 角色 + 片段 + 命中段在片段内的起始偏移。 */
export interface SearchHit {
  index: number;
  role: string;
  snippet: string;
  at: number;
}


/** 片段窗口：命中点前后各取的**字符**数（中英同权，肉眼可读即可）。 */
export const SNIPPET_PAD: number = 28;

function lower(s: string): string {
  return s !== undefined && s !== null ? s.toLowerCase() : '';
}

/**
 * 查询是否为空（trim 后 0 字符）——UI 的「锚点列表模式 ↔ 搜索模式」唯一判据。
 */
export function isEmptyQuery(query: string): boolean {
  const q: string = query !== undefined && query !== null ? query.trim() : '';
  return q.length === 0;
}

/**
 * 全行搜索：返回所有含 `query`（大小写不敏感）的行的命中列表（行序保持原顺序）。
 */
export function rowSearchHits(rows: readonly SearchRow[] | null | undefined, query: string): SearchHit[] {
  const out: SearchHit[] = [];
  if (rows === undefined || rows === null) {
    return out;
  }
  const q: string = lower(query).trim();
  if (q.length === 0) {
    return out;
  }
  for (let i: number = 0; i < rows.length; i++) {
    const r: SearchRow | undefined = rows[i];
    if (r === undefined || r === null) {
      continue;
    }
    const hay: string = lower(r.content);
    const at: number = hay.indexOf(q);
    if (at < 0) {
      continue;
    }
    out.push(new SearchHitT(i, r.role, snippetAround(r.content, at, q.length), at));
  }
  return out;
}

/** `SearchHit` 的可构造实现（ArkTS interface 无 new ⇒ 伴生 class；导出供测试断言字段）。 */
export class SearchHitT implements SearchHit {
  index: number;
  role: string;
  snippet: string;
  at: number;
  constructor(index: number, role: string, snippet: string, at: number) {
    this.index = index;
    this.role = role;
    this.snippet = snippet;
    this.at = at;
  }
}

/**
 * 片段窗口（纯函数）：以命中点为中心、前后各 `SNIPPET_PAD` 字符；窗口越界按原文
 * 收敛（开头/结尾不足不补空白）。返回 [snippet, 命中段在 snippet 内的偏移]。
 * 首尾各给一个 `…` 提示被截（命中点紧贴原文边界时不给）。
 */
export function snippetAround(
  content: string,
  hitAt: number,
  hitLen: number,
): string {
  const s: string = content !== undefined && content !== null ? content : '';
  const start: number = Math.max(0, hitAt - SNIPPET_PAD);
  const end: number = Math.min(s.length, hitAt + hitLen + SNIPPET_PAD);
  const headEll: string = start > 0 ? '…' : '';
  const tailEll: string = end < s.length ? '…' : '';
  return `${headEll}${s.slice(start, end)}${tailEll}`;
}

/**
 * 命中段在**片段**内的起始偏移（UI 拆 Span 高亮用）：片段起点即窗口起点
 * （`start = max(0, hitAt - SNIPPET_PAD)`）⇒ 片段内偏移 = `hitAt - start + 头省略号`。
 * 与 `snippetAround` 同源计算，UI 不重复找。
 */
export function hitOffsetInSnippet(hitAt: number): number {
  const start: number = Math.max(0, hitAt - SNIPPET_PAD);
  return hitAt - start + (start > 0 ? 1 : 0);
}
