/**
 * 列表行的**纯 diff 逻辑**（可脱机单测；不依赖任何 ArkUI 全局类型）。
 *
 * 背景：`List` + `ForEach` 会**一次性构建全部行**，每行又含多个迭代块 × Markdown
 * ⇒ 几十行就是几千个节点（真机「很卡、交互差」的主因）。改用 `LazyForEach` 后，
 * 只有可视区附近的行会被构建，但**数据源必须准确告诉框架"哪一行变了"**：
 * 整表 reload 会丢掉滚动锚点与复用，漏通知则内容不更新。故 diff 逻辑单独抽出来钉死。
 */
import { ChatRow } from './types';

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

/** 末尾 N 行（行窗口：只让数据源持有最近 N 行）。 */
export function tailRows(rows: ChatRow[], limit: number): ChatRow[] {
  if (limit <= 0 || rows.length <= limit) {
    return rows.slice();
  }
  return rows.slice(rows.length - limit);
}
