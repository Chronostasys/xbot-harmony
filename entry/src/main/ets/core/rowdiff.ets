/**
 * 列表行的**纯 diff 逻辑**（可脱机单测；不依赖任何 ArkUI 全局类型）。
 *
 * 背景：`List` + `ForEach` 会**一次性构建全部行**，每行又含多个迭代块 × Markdown
 * ⇒ 几十行就是几千个节点（真机「很卡、交互差」的主因）。改用 `LazyForEach` 后，
 * 只有可视区附近的行会被构建，但**数据源必须准确告诉框架"哪一行变了"**：
 * 整表 reload 会丢掉滚动锚点与复用，漏通知则内容不更新。故 diff 逻辑单独抽出来钉死。
 */
import { ChatRow, HistoryIteration } from './types';
import { getLocale } from './i18n';

/** 一行的稳定键：内容每次变化 `rev` 自增（参与键 ⇒ 内容变了就重建该行）。 */
export function rowKey(r: ChatRow): string {
  return `${r.id}#${r.rev}`;
}

/** 行的**身份**序列是否一致（长度 + id 顺序）。身份变了必须整表 reload。 */
export function sameRowIds(a: ChatRow[], b: ChatRow[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) {
      return false;
    }
  }
  return true;
}

/** 内容发生变化（键不同）的行下标 —— 身份一致时只通知这些行。 */
export function changedRowIndices(a: ChatRow[], b: ChatRow[]): number[] {
  const out: number[] = [];
  const n: number = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    if (rowKey(a[i]) !== rowKey(b[i])) {
      out.push(i);
    }
  }
  return out;
}

/**
 * 内容发生变化的下标 —— 用**上一帧的键快照**比较（**必须**用它，不要用 changedRowIndices）。
 *
 * ⛔ 真机严重事故（bug ①「迭代 commit 后消失，新 turn 永远只有 0-1 个迭代」的根因之一）：
 * `rows` 里的 `ChatRow` 是**就地更新**的（保 @ObjectLink 恒等，见 core/render.ets）——
 * 数据源持有的旧数组与新数组是**同一批对象引用**，`changedRowIndices(old, new)` 对每个
 * 下标比较的都是**同一个对象**的 `rev`（已自增过）⇒ 恒相等 ⇒ **零通知** ⇒
 * `LazyForEach` 永不重建该行 ⇒ live 行的已完成迭代/内容更新**永远不显示**。
 * 修法：数据源在每次 `applyRows` 时把**当时的 `id#rev` 键**快照下来；下次用快照比。
 */
export function changedByKeys(prevKeys: string[], next: ChatRow[]): number[] {
  const out: number[] = [];
  const n: number = prevKeys.length < next.length ? prevKeys.length : next.length;
  for (let i = 0; i < n; i++) {
    if (prevKeys[i] !== rowKey(next[i])) {
      out.push(i);
    }
  }
  return out;
}

/** 末尾 N 行（行窗口：只让数据源持有最近 N 行）。 */
export function tailRows(rows: ChatRow[], limit: number): ChatRow[] {
  if (limit <= 0 || rows.length <= limit) {
    return rows.slice();
  }
  return rows.slice(rows.length - limit);
}

/**
 * 行的**会话作用域键** —— `LazyForEach` 必须用它（不能只用 `rowKey`）。
 *
 * ⛔ 真机严重事故（2026-10-10「所有会话都渲染了第一个打开的会话的迭代」）：行 id 是**每个 store
 * 独立计数**的（`live-1` / `u-1` / `a-2` …），`rev` 也都从 1 起, 两个**不同会话**的行可以拿到
 * **逐字相同**的裸键。`LazyForEach` 以键认条目, 第二会话的行会被当成同一条复用已渲染的旧条目。
 */
export function sessionScopedRowKey(chatId: string, r: ChatRow): string {
  // ⛔ 2026-10-17 照抄 web（用户亲证「web 没有闪烁，照抄都抄好了」）：键**不含 rev** ——
  //    迭代 commit（rev++）不再换键 ⇒ 行**不重建** ⇒ 已渲染的块纹丝不动（ForEach 按稳定键
  //    diff，新块追加）。行内容更新走 **@Observed 属性刷新**：ChatRow 是 @Observed、
  //    render.applyRow 对 iterations/rev 等**赋值替换引用** ⇒ @ObjectLink 组件自动重渲 ——
  //    与 web 的 React 状态更新同语义。rev 仍留在 applyRows 的键快照里做「行变了」的
  //    内部判据，但不再进框架键（同键重建正是闪烁的根源）。
  // 发送中/排队中状态会**就地**改变 `sending/queued`；UserBubbleView 只接 @Prop 原始值，
  // LazyForEach 的 item builder 不会因父级字段变化重跑（只有 @ObjectLink 组件才会）。
  // ⇒ 把这两个布尔放进键：ack/turn_started 清 sending 时该行重建一次，彻底消除
  // 「第一个迭代都跑了还永久显示发送中」（用户 2026-10-18 真机 P0）。
  // 其余时间键稳定（不含 rev/theme），不引入流式闪烁。
  return chatId + '#' + r.id + '#' + getLocale()
    + (r.sending ? '#sending' : '') + (r.queued ? '#queued' : '');
}

/**
 * **会话作用域指纹**：`chatId|n|p1,p2,…`（rows / sessions / queue / todos 同一契约）。
 *
 * ⛔ 同一事故的第二处：指纹用于判「要不要把 store 的数据重新投影到界面」。不含会话身份时,
 * 两个会话的同形数据指纹相等, 切会话被判「没变」, 界面永不刷新（一直显示上一个会话的内容）。
 */
export function scopedFingerprint(chatId: string, parts: string[]): string {
  return chatId + '|' + parts.length + '|' + parts.join(',');
}

/** 行集合的会话作用域指纹（`id#rev` 序列 + 会话身份）。 */
export function rowsFpOf(rows: ChatRow[], chatId: string): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    parts.push(rows[i].id + '#' + rows[i].rev);
  }
  return scopedFingerprint(chatId, parts);
}

/**
 * 行集合的**结构**指纹 —— **不含行内容的 `rev`**：`id#isLive#迭代数#末迭代在飞` 序列 + 会话身份。
 *
 * ⛔ 为什么要与 `rowsFpOf` 分开（用户 2026-10-16 亲报「掉帧还是严重」+「stream 时滚历史，整个
 *    历史窗口一直抖动」）：`rowsFpOf` 含 `rev` ⇒ **流式期每个 SSE 帧**都变 ⇒ 页面每帧
 *    `this.rows = store.rows.slice()`（新数组）⇒ 按数组恒等记忆化的**导航锚点表每帧重建**
 *    （O(行数) + 复制每条消息完整正文）。真机计数取证：`sync/s≈33 · anchorsBuilds/s≈33`。
 *
 * 结构指纹只表达"**哪些行 / 每行多少迭代 / 末迭代是否在飞**" —— 正是锚点集合与导航显示所需
 * 的全部信息（行内在飞正文的增长不改锚点身份）。真实结构变化（新行、迭代 commit、turn 收尾）
 * 都能被它捕获 ⇒ **既不漏刷新，也不为不可见的内容增长付账**。
 */
export function structRowsFpOf(rows: ChatRow[], chatId: string): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: ChatRow = rows[i];
    const its: HistoryIteration[] | undefined = r.iterations;
    const n: number = its !== undefined ? its.length : 0;
    const lastLive: number = n > 0 && its[n - 1].live === true ? 1 : 0;
    parts.push(`${r.id}#${r.isLive === true ? 1 : 0}#${n}#${lastLive}`);
  }
  return scopedFingerprint(chatId, parts);
}

/** 会话身份是否变化（变化则所有指纹必须作废，且身份必须先落定再投影）。 */
export function identityChanged(prevChatId: string, nextChatId: string): boolean {
  return prevChatId !== nextChatId;
}

/**
 * 数据源骨架是否必须**整表重建**：会话身份变化 **或** 行 id 序列变化。
 *
 * ⛔ 真机严重事故的第三处（最致命）：`applyRows` 原本只看 `sameRowIds`（纯 id 序列）。
 * 两个会话同形（id 都是 `live-1`/`u-1`/`a-2`…）, 判「骨架未变」, `changedRowIndices` 为空,
 * **一条变更通知都不发**, `LazyForEach` 保留第一个会话已构建的条目, 于是切到任何会话都显示
 * **第一个打开的会话**的内容。会话身份必须参与该判据。
 */
export function needsFullReload(prev: ChatRow[], next: ChatRow[],
                                prevChatId: string, nextChatId: string): boolean {
  return prevChatId !== nextChatId || !sameRowIds(prev, next);
}
