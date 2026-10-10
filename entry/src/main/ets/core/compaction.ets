/**
 * compaction.ets —— 「上下文压缩点」（compaction）的**纯逻辑**：摘要拆分 + 迭代锚定。
 *
 * 权威基准（web）：
 *   · 组件形态/文案：`web/src/components/agent/CompactionDivider.tsx`
 *        - `:20-27`  splitMarker(content) → { title, body }（正文可展开）
 *        - `:26`     title 兜底恒为 `'[Compacted context]'`
 *        - `:50`     胶囊文案 `t('agent.compacted')`
 *        - `web/src/i18n/zh-CN.ts:236`  compacted: '上下文已压缩'
 *   · 出现位置（锚定）：`web/src/components/agent/TurnBody.tsx:986-1013`（compactionByIter）
 *        - anchor = 「已渲染迭代号中 ≤ afterIteration 的**最大者**」；0 = 第一个迭代之前
 *        - `:996-1003` 窗口外挂起：afterIteration 落在已加载窗口**之前** ⇒ 不渲染
 *          （否则 anchor 会 fallback 到 0、冒充 turn 开头的压缩 —— 时间线错乱）
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒
 *    **禁止** import 任何 ArkUI / `@ohos.*` 全局类型（会 TS2307）。同时 ArkTS 禁
 *    「无类型对象字面量」⇒ 返回值一律用 `class`（不得用 `{...}` 字面量作类型）。
 */
import type { WebCompaction } from './chattypes';

/** 胶囊文案（web `i18n/zh-CN.ts:236` 的 `agent.compacted`）。原生端文案硬编码为中文。 */
export const COMPACTED_LABEL: string = '上下文已压缩';

/** 摘要标题兜底（web `CompactionDivider.tsx:26`）。 */
export const DEFAULT_MARKER_TITLE: string = '[Compacted context]';

/** 压缩标记的拆分结果（title + body）。ArkTS 禁无类型对象字面量 ⇒ class。 */
export class CompactMarker {
  /** 首行标题（空 ⇒ 兜底 `DEFAULT_MARKER_TITLE`）。 */
  title: string = DEFAULT_MARKER_TITLE;
  /** 其余行 = 可展开的摘要正文（空串 = 无正文 ⇒ 胶囊不可展开、不显示箭头）。 */
  body: string = '';
}

/**
 * 把 `"[Compacted context]\n\n<summary>"` 拆成 标题 + 正文 —— **逐字对齐** web
 * `CompactionDivider.tsx:20-27` 的 `splitMarker`（含"首行取标题、其余为正文"）。
 */
export function splitMarker(content: string | undefined): CompactMarker {
  const out: CompactMarker = new CompactMarker();
  const c: string = content !== undefined ? content : '';
  const trimmed: string = c.trimStart();
  const firstLineEnd: number = trimmed.indexOf('\n');
  const rawTitle: string = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd).trim();
  const body: string = firstLineEnd === -1 ? '' : trimmed.slice(firstLineEnd + 1).trim();
  out.title = rawTitle.length > 0 ? rawTitle : DEFAULT_MARKER_TITLE;
  out.body = body;
  return out;
}

/**
 * 迭代号 → 该迭代块**之后**要渲染的压缩点列表（对齐 web `TurnBody.compactionByIter`）。
 *
 * 关键点（逐条对齐 web `TurnBody.tsx:992-1013`）：
 *   ① anchor 只取**已渲染（merged）迭代号** —— 工具 only 迭代被折叠后迭代号会跳号，
 *      用 anchor 扫描可保证压缩点**不丢失**（落到"最近的更早块"之后）；找不到任何块
 *      ⇒ anchor=0（= 第一个迭代之前，即 turn 顶部）。
 *   ② 窗口外挂起：`afterIteration > 0` 且它落在**全部已渲染块之前** ⇒ 跳过（不渲染）。
 *      `afterIteration === 0`（真·turn 开头压缩）语义上就属于窗口顶，**不跳过**。
 *
 * @param iterNums   已渲染迭代号，**升序**（= `mergeToolRuns` 之后的块迭代号）。
 * @param compactions 该 turn 的压缩点（缺省 = 无 ⇒ 空 Map，调用方可据此零渲染）。
 * @returns anchor 迭代号 → 压缩点数组（anchor 0 = turn 顶部）。
 */
export function compactionAnchors(
  iterNums: number[],
  compactions: WebCompaction[] | undefined,
): Map<number, WebCompaction[]> {
  const map: Map<number, WebCompaction[]> = new Map();
  if (compactions === undefined || compactions.length === 0) {
    return map;
  }
  for (let i = 0; i < compactions.length; i++) {
    const c: WebCompaction = compactions[i];
    const after: number = c.afterIteration;
    // ② 窗口外挂起（web :1003）：压缩点属于未加载内容之间的分隔 ⇒ 不渲染。
    if (after > 0 && iterNums.length > 0 && iterNums[0] > after) {
      continue;
    }
    // ① anchor = max{ n ∈ iterNums | n ≤ after }（0 为下界兜底）。
    let anchor: number = 0;
    for (let j = 0; j < iterNums.length; j++) {
      const n: number = iterNums[j];
      if (n <= after && n > anchor) {
        anchor = n;
      }
    }
    const arr: WebCompaction[] | undefined = map.get(anchor);
    if (arr !== undefined) {
      arr.push(c);
    } else {
      map.set(anchor, [c]);
    }
  }
  return map;
}

/** 共享空数组（无压缩 ⇒ 渲染层零分配、零节点）。调用方**只读**，不得 push。 */
export const NO_COMPACTIONS: WebCompaction[] = [];

/** 某 anchor 的压缩点；缺省 = 共享空数组（**零渲染**：调用方只需判 `length > 0`）。 */
export function anchorsAt(
  anchors: Map<number, WebCompaction[]>,
  anchor: number,
): WebCompaction[] {
  const arr: WebCompaction[] | undefined = anchors.get(anchor);
  return arr !== undefined ? arr : NO_COMPACTIONS;
}

/**
 * 该压缩点是否有可展开的正文（决定胶囊是否显示展开箭头 / 可点）。
 * 对齐 web `CompactionDivider.tsx:51-53`（`body && <ChevronDown/>`）与 `:57-61`。
 */
export function hasExpandableBody(c: WebCompaction | undefined): boolean {
  if (c === undefined) {
    return false;
  }
  return splitMarker(c.content).body.length > 0;
}
