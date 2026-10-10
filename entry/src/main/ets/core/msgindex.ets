/**
 * msgindex.ets —— 「用户消息导航」（MessageUserNav）的**纯逻辑**：锚点抽取 + 当前锚点判定
 * + 前后跳转（边界正确）+ 面板预览文本。
 *
 * 权威基准（web）：
 *   · 组件 `web/src/components/agent/MessageUserNav.tsx`
 *        - `:20`  ACTIVE_ANCHOR_ROWS = 2（可视首行 + 容差）
 *        - `:35-48`  extractTurnPreview（user 全文 + 同 turn 首个非空 assistant 回复）
 *        - `:76-79`  turns = userRowIndexes → { rowIndex, seq: k+1 }（1-based 序号）
 *        - `:82-89`  activeSeq = 「userRowIndexes 中 ≤ visibleStart + 2 的个数」（顺序累加、
 *                    首个不满足即停）；0 = 无
 *        - `:138`   `if (turns.length < 2) return null`（**< 2 个锚点 ⇒ 整个导航不存在**）
 *   · 锚点来源 `web/src/components/agent/MessageList.tsx:656-662`
 *        - `userMessageIndices` = rows 中 `role === 'user'` 的**下标**（升序、单趟）
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒ **禁止** import
 *    ArkUI / `@ohos.*` 全局类型。`ChatRow` 是纯数据结构（`core/types.ets`），可安全引用。
 *
 * 边界行为（**以 web 为准**）：web 的导航是**列表面板**，没有"上一个/下一个"按钮；
 * 唯一的"当前项"概念是 `activeSeq`，它是**夹取（clamp）**语义、**不环绕**。故本模块的
 * `prevSeq/nextSeq` 同样取**不环绕**（越界停住）—— 与 `activeSeq` 的 clamp 同源。
 */
import { ChatRow } from './types';

/**
 * 可视首行容差（对齐 web `MessageUserNav.tsx:20`）。
 * 虚拟列表 overscan 不精确 ⇒ 少量容差防 active 抖动。
 */
export const ACTIVE_ANCHOR_ROWS: number = 2;

/** 一个用户消息导航锚点（web `TurnPreview` 的客户端形状）。 */
export interface NavAnchor {
  /** 1-based 用户消息序号（面板显示 01/02…；也用作 active 判据）。 */
  seq: number;
  /** 该用户消息在**行列表**中的下标（页面据此 `scrollToIndex`）。 */
  rowIndex: number;
  /** 该 turn 的用户消息全文（web `line-clamp-2`）。 */
  userText: string;
  /** 同 turn **首个**非空 assistant 回复（web `line-clamp-1`）；空串 = 面板不显示第二行。 */
  assistantText: string;
}

/**
 * 用户消息（role === 'user'）在行列表中的**下标**，升序 —— 对齐 web
 * `MessageList.tsx:656-662` 的 `userMessageIndices`（单趟、不额外过滤）。
 *
 * ⚠️ 与 web 一致：**不**额外排除 standalone 命令回显行（web 也只判 role）。
 */
export function userAnchorRows(rows: ChatRow[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'user') {
      out.push(i);
    }
  }
  return out;
}

/**
 * 当前（最近）锚点序号 —— 对齐 web `MessageUserNav.tsx:82-89` 的 `activeSeq`：
 * 顺序累加 `userRowIndexes` 中满足 `idx <= visibleStart + ACTIVE_ANCHOR_ROWS` 的个数，
 * **遇到第一个不满足即停**（输入升序时 = 该条件下的最后一个锚点）。
 *
 * @returns 1-based 序号；0 = 可视位置之前没有任何锚点。
 */
export function nearestSeq(userRowIndexes: number[], visibleStart: number): number {
  let seq: number = 0;
  for (let i = 0; i < userRowIndexes.length; i++) {
    if (userRowIndexes[i] <= visibleStart + ACTIVE_ANCHOR_ROWS) {
      seq++;
    } else {
      break;
    }
  }
  return seq;
}

/**
 * 上一个锚点序号 —— **不环绕**：已在首个（seq <= 1）⇒ 原样返回（web 的 clamp 语义）。
 * 总数为 0 ⇒ 返回 0（无锚点）。
 */
export function prevSeq(seq: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  if (seq <= 1) {
    return 1;
  }
  if (seq > total) {
    return total;
  }
  return seq - 1;
}

/**
 * 下一个锚点序号 —— **不环绕**：已在末个（seq >= total）⇒ 原样返回（web 的 clamp 语义）。
 * 总数为 0 ⇒ 返回 0（无锚点）。
 */
export function nextSeq(seq: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  if (seq < 1) {
    return 1;
  }
  if (seq >= total) {
    return total;
  }
  return seq + 1;
}

/**
 * 序号 → 行下标；越界/无锚点 ⇒ **-1**（调用方据此判定"无可跳转目标"，绝不误跳）。
 */
export function rowIndexAtSeq(userRowIndexes: number[], seq: number): number {
  if (seq < 1 || seq > userRowIndexes.length) {
    return -1;
  }
  return userRowIndexes[seq - 1];
}

/**
 * 面板条目（含预览文本）—— 对齐 web `MessageUserNav.tsx:35-48` 的 `extractTurnPreview`
 * 与 `:92-98` 的组装：
 *   · `userText`   = 该 user 行全文；
 *   · `assistantText` = 从该行**之后**、到**下一个 user 行**（末个锚点则到 rows 末尾）
 *     之间**第一个** role=assistant 且 content 非空的行；找不到则为空串。
 */
export function buildAnchors(rows: ChatRow[], userRowIndexes: number[]): NavAnchor[] {
  const out: NavAnchor[] = [];
  for (let k = 0; k < userRowIndexes.length; k++) {
    const rowIndex: number = userRowIndexes[k];
    const src: ChatRow | undefined = rows[rowIndex];
    const userText: string = src !== undefined ? src.content : '';
    const nextUserRow: number = k + 1 < userRowIndexes.length ? userRowIndexes[k + 1] : rows.length;
    let assistantText: string = '';
    for (let i = rowIndex + 1; i < nextUserRow && i < rows.length; i++) {
      if (rows[i].role === 'assistant' && rows[i].content.length > 0) {
        assistantText = rows[i].content;
        break;
      }
    }
    out.push({ seq: k + 1, rowIndex, userText, assistantText });
  }
  return out;
}

/**
 * 显示守卫：**< 2 个锚点 ⇒ 导航整体不渲染**（web `MessageUserNav.tsx:138`
 * `if (turns.length < 2) return null`）。组件直接用它做唯一判据（单一真源）。
 */
export function shouldShowNav(anchorCount: number): boolean {
  return anchorCount >= 2;
}

/** 序号文字（面板左侧）：1 → `01`（web `String(turn.seq).padStart(2, '0')` 的等价实现）。 */
export function seqLabel(seq: number): string {
  const s: string = `${seq}`;
  return s.length >= 2 ? s : `0${s}`;
}

/** 用户消息为空时的占位（web `turn.userText || '(empty)'`）。 */
export function userTextOrPlaceholder(userText: string): string {
  return userText.length > 0 ? userText : '(empty)';
}
