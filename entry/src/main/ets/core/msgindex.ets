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
 * 锚点**按 `rows` 对象恒等**的记忆化容器（性能；沿用本仓 `liveBlocksMemo`/`blocksSignature`
 * 的同款手法：源数组恒等 ⇒ 复用上一次结果）。
 *
 * 为什么必须有（真根因，2026-10-15 定位）：
 *   `pages/Index.ets` 的 `MessageNav({ anchors: this.navAnchors(), … })` 在**页面 build** 里取锚点，
 *   而 `onScrollIndex` 每次可见索引区间变化都写一个**页级 `@State`** ⇒ 页面 build **每次滚动**
 *   重跑 ⇒ `buildAnchors` 每次都重建整个数组、并把**每条消息的完整正文**（`userText`/`assistantText`）
 *   复制一遍 ⇒ 每帧工作量与**历史长度**成正比（历史越长越卡），GC 压力同步上去。
 *   锚点只取决于 `rows`（`userAnchorRows` + `buildAnchors` 都是 `rows` 的纯函数）⇒ 只按
 *   `rows` 恒等记忆化即可：**滚动引起的重建**与**同 `rows` 的重复 build** 都退化为 O(1)。
 *
 * ⛔ 语义等价：同 `rows`（同一对象）⇒ 逐字节同结果；`rows` 换了对象（新 sync / 切会话 /
 *   加载更早）⇒ 必重算。⛔ 不引入任何「按内容比较」的近似（那会漏判"正文变了"）。
 */
export class AnchorsMemo {
  private rows: ChatRow[] = [];
  private sig: string = '';
  private hasKey: boolean = false;
  private out: NavAnchor[] = [];
  /** 内核实际执行次数（**判据用**：滚动 N 次 / 流式 N 帧而**结构**未变 ⇒ 必须仍是 1）。 */
  public builds: number = 0;

  /** 取（必要时重算）当前 `rows` 的锚点表。**O(1)**（命中）或 O(行数)（未命中一次）。 */
  public of(rows: ChatRow[]): NavAnchor[] {
    if (this.hasKey && this.rows === rows) {
      return this.out;
    }
    this.out = buildAnchors(rows, userAnchorRows(rows));
    this.rows = rows;
    this.hasKey = true;
    this.builds = this.builds + 1;
    return this.out;
  }

  /**
   * 按**结构签名**取锚点表（⛔ 流式期的主路径）。
   *
   * ⛔ 为什么不能只按 `rows` **数组恒等**（用户 2026-10-16 亲报「掉帧还是严重，看不出来你修了
   *    任何东西」+「stream 时滚历史，整个历史窗口一直抖动」）：页面 `rowsFp` 含行内容的 `rev`
   *    ⇒ 流式期**每个 SSE 帧**都会 `this.rows = store.rows.slice()` 换一个新数组
   *    ⇒ 恒等失配 ⇒ **每帧重建整份锚点表**（`buildAnchors` 是 O(行数) 且**复制每条消息的完整
   *    正文**）。真机计数取证：`sync/s≈33 · anchorsBuilds/s≈33`（1:1）⇒ 正是掉帧主因。
   *
   * 语义（不发明、只增口径）：锚点表只由**结构**决定（哪些行、每行多少迭代、末迭代是否在飞）
   * —— 行内**在飞正文**的增长不改变导航锚点集合与预览的**身份**（预览只是同 turn 首条
   * assistant 的展示串）。故：**结构签名相同 ⇒ 复用上一份锚点表**（⛔ 不重算），签名变了
   * （新行 / 迭代 commit / turn 结束）⇒ 重算一次。
   */
  public ofSig(rows: ChatRow[], sig: string): NavAnchor[] {
    if (this.hasKey && this.sig === sig) {
      // 结构未变 ⇒ 复用（只把 `rows` 引用换上，供下次恒等快路径）。
      this.rows = rows;
      return this.out;
    }
    this.out = buildAnchors(rows, userAnchorRows(rows));
    this.rows = rows;
    this.sig = sig;
    this.hasKey = true;
    this.builds = this.builds + 1;
    return this.out;
  }
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
