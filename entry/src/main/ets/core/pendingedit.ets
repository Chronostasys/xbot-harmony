/**
 * 会话级字段（goal / todos）的**用户编辑乐观覆盖** —— web `hooks/usePendingEdit.ts` 的**逐字移植**。
 *
 * ⛔ 本文件是 web 状态机的移植件：**不要重写语义**。要改先改 web 侧同一处（`web/src/hooks/usePendingEdit.ts`）
 *    再把同一改动跟过来；本文件只放**纯逻辑**（无 ArkUI / 无 `@ohos.*`，可脱机单测）。
 *
 * 派单背景（`docs/WEB-PARITY.md` §11 F 行，**P1 正确性缺口**）：原生此前 goal/todos **无乐观覆盖层**
 * —— 用户勾选/改名后，若一条**旧** progress 快照先到，UI 会**回退旧清单**（web 有 begin/commit/discard
 * + 单调序号防乱序）。web 的根因记录在其文件头（快照压过覆盖 / 快照有值即清覆盖 / todos 无乐观副本）。
 *
 * 语义（服务端仍是唯一权威，覆盖只是"用户刚改过"的暂态）：
 *   · `begin()` 发单调序号 → RPC 成功后 `acceptSeq(seq)`（**只接受不旧于已应用序号的**，乱序落后者不回写）
 *     → 调用方存 `{value, before}`（`before` = 提交那一刻的服务端快照）；
 *   · `discard()` 放弃覆盖（发送失败 / 取消 / 服务端拒绝）；
 *   · 收敛（清除）条件（任一）：`pendingConverged(...)` —— 快照**等于覆盖值**（已采纳）或
 *     快照**相对 before 已变**（push 收敛到别的值 / agent 改了值，一律以服务端为准）。
 *
 * 三条来自 web CR 的硬约束（都必须保留）：
 *   1. **会话身份**：`key`（channel:chatID:agentChatID）变化 ⇒ `onSessionChange()` 丢弃（防跨会话串值）；
 *   2. **提交序号**：见 `acceptSeq`；
 *   3. **比较器必须稳定**：用本文件的模块级 `goalEqual` / `todosListEqual`（⛔ 别内联箭头函数）。
 */
import { GoalInfo, TodoItem } from './types';

/**
 * 提交序号的**纯簿记**（不含渲染/载荷；载荷由调用方自己存）。
 * 逐字对齐 web 的 `seqRef` / `appliedSeqRef` 两个 ref 的交互。
 */
export class PendingSeq {
  /** 已发放的最大序号（`begin()` 递增）。 */
  private issued: number = 0;
  /** 已应用的提交序号（单调）。 */
  private applied: number = 0;

  /** 进入一次编辑事务（分配单调序号）。 */
  begin(): number {
    this.issued += 1;
    return this.issued;
  }

  /**
   * RPC 成功后的提交闸门。
   * @returns true = 接受（调用方写入覆盖）；false = 丢弃（**乱序 RPC 的落后者不得回写**）。
   */
  acceptSeq(seq: number): boolean {
    if (seq < this.applied) {
      return false;
    }
    this.applied = seq;
    return true;
  }

  /** 放弃覆盖（发送失败 / 取消 / 服务端拒绝）：把 applied 推到 issued ⇒ 旧提交全部作废。 */
  discard(): void {
    this.applied = this.issued;
  }

  /** 会话切换：丢弃覆盖（同上）。web `usePendingEdit.ts` 的 key effect。 */
  onSessionChange(): void {
    this.applied = this.issued;
  }

  /** 供测试/诊断：已应用序号。 */
  appliedSeq(): number {
    return this.applied;
  }
}

/**
 * 服务端快照变化时，覆盖是否应**收敛**（清除）。
 * 逐字对齐 web：`equal(snapshot, pending.value) || !equal(snapshot, pending.before)`。
 * @param snapshotEqualsValue  快照是否**等于覆盖值**（已采纳 ⇒ 覆盖无意义）。
 * @param snapshotEqualsBefore 快照是否**等于提交前的值**（未变 ⇒ 覆盖继续生效；变了 ⇒ 让位给服务端）。
 */
export function pendingConverged(snapshotEqualsValue: boolean, snapshotEqualsBefore: boolean): boolean {
  return snapshotEqualsValue || !snapshotEqualsBefore;
}

/**
 * goal 相等：`text` + `status`（nullish 表示"无目标"）。
 * ⚠️ 字段名映射：web 的 `GoalInfo.objective` → 原生 `GoalInfo.text`（两端同一语义）。
 */
export function goalEqual(a: GoalInfo | null | undefined, b: GoalInfo | null | undefined): boolean {
  const an: GoalInfo | null = a === undefined ? null : a;
  const bn: GoalInfo | null = b === undefined ? null : b;
  if (an === null || bn === null) {
    return an === bn;
  }
  return (an.text ?? '') === (bn.text ?? '') && (an.status ?? '') === (bn.status ?? '');
}

/** todos 相等：长度 + 每项 `text`/`status`。对 `undefined` 安全（EMPTY 快照）。web 同源。 */
export function todosListEqual(a: TodoItem[] | undefined, b: TodoItem[] | undefined): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }
  const an: TodoItem[] = a === undefined ? [] : a;
  const bn: TodoItem[] = b === undefined ? [] : b;
  if (an.length !== bn.length) {
    return false;
  }
  for (let i = 0; i < an.length; i++) {
    if ((an[i].text ?? '') !== (bn[i].text ?? '') || (an[i].status ?? '') !== (bn[i].status ?? '')) {
      return false;
    }
  }
  return true;
}

/** 渲染用值：有未决覆盖 ⇒ 显示覆盖值（用户立刻看到自己的编辑），否则显示服务端快照。 */
export function pendingShown<T>(active: boolean, pendingValue: T, snapshot: T): T {
  return active ? pendingValue : snapshot;
}
