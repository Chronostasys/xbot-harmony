/**
 * resume.ets —— **连续性判据**：后台→前台、SSE 重连，两个触发源共用一处判断。
 *
 * 用户 2026-10-22 定向（原话）：
 *   「转后台要记录当前 iter + turn id，转回来要请求一下 live 的信息对比，如果有 gap 要补 hole，
 *     如果 turn 都不同了要重加载」+「重新连接也必须看情况触发 resync」。
 *
 * 为什么必须有这一层（而不是继续"一律整表重载"）：
 *   · 重历史（`/api/history` 100 行 + 全量水合）慢、会让屏幕闪；而服务端**已有** O(1) 轻量快照
 *     `get_active_progress`（`ProgressEvent`：`turn_id` / `iteration` / `phase` / `iteration_history`）
 *     ⇒ 能不能只补洞、要不要整表重载，**是可以在纯逻辑里判死**的；
 *   · 只靠"回前台时的本地状态"比不行：进程被冻结期间本地状态可能被丢帧污染，
 *     分不清"我落后"与"服务端没进展" ⇒ 必须用**转后台那一刻的基线**（`ResumeMark`）。
 *
 * 判据（唯一出口，按优先级）：
 *   ① `resyncRequired`（服务端唯一权威"你必须重载"）      ⇒ RELOAD
 *   ② 没有基线（`mark === null`，如首次进前台/冷启）        ⇒ NONE（交给既有 `probeActiveStall`）
 *   ③ 服务端**无**在飞：
 *        · 基线里有回合（`mark.turnID > 0`）⇒ 该轮在后台期间跑完了，final/尾部可能全丢 ⇒ RELOAD
 *        · 基线里没有回合 ⇒ NONE（本来就是空闲）
 *   ④ 服务端在飞，但**换轮**：
 *        · `live.turnID > mark.turnID` ⇒ 错过了整轮的开始 ⇒ RELOAD
 *        · `live.turnID < mark.turnID` ⇒ 本地领先（快照滞后）⇒ NONE（**绝不反向清本地**）
 *   ⑤ 同一轮且落后（`live.iter > mark.iter`）              ⇒ GAP（补 `[mark.iter+1 .. live.iter]`）
 *   ⑥ 其余（一致 / 本地领先）                              ⇒ NONE
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 禁止 import ArkUI / `@ohos.*`。
 */

/** 转后台（或断线）那一刻的**连续性基线**：回合 + 迭代（用户点名要的两个字段）。 */
export class ResumeMark {
  /** 当前在飞回合 id（0 = 当时没有在飞回合）。 */
  turnID: number = 0;
  /** 当时本地最后落地的迭代号（0 = 无）。 */
  iter: number = 0;
  /** 记录时刻（诊断用，**不参与判据**）。 */
  atMs: number = 0;
}

/** 服务端轻量快照（`get_active_progress`）的判据投影。 */
export interface ResumeLive {
  /** `turn_id`（0 = 无）。 */
  turnID: number;
  /** `iteration`（0 = 无）。 */
  iter: number;
  /** 是否有在飞回合（快照存在且 `phase` 非 done）。 */
  active: boolean;
  /** `resync_required`（服务端明确要求重载）。 */
  resyncRequired: boolean;
}

export const RESUME_NONE: string = 'none';
export const RESUME_GAP: string = 'gap';
export const RESUME_RELOAD: string = 'reload';

/** 结论（`class`：ArkTS 禁空对象字面量）。 */
export class ResumeVerdict {
  /** `none` | `gap` | `reload` */
  action: string = RESUME_NONE;
  /** GAP 的补洞区间（含端点；`toIter >= fromIter` 才有效）。 */
  fromIter: number = 0;
  toIter: number = 0;
  /** 判据原因（日志/判据可比，**不参与渲染**）。 */
  reason: string = '';
}

function verdictOf(action: string, fromIter: number, toIter: number, reason: string): ResumeVerdict {
  const v: ResumeVerdict = new ResumeVerdict();
  v.action = action;
  v.fromIter = fromIter;
  v.toIter = toIter;
  v.reason = reason;
  return v;
}

/**
 * 连续性判定（纯函数）。
 *
 * @param mark          转后台/断线那一刻的基线（`null` = 没有基线）
 * @param live          服务端轻量快照投影（`null` = 请求失败/旧服务端 ⇒ 无从判断）
 * @param localMaxTurn  本地已知的最大回合号（用于区分"本地领先"）
 */
export function resumeVerdict(mark: ResumeMark | null, live: ResumeLive | null,
  localMaxTurn: number): ResumeVerdict {
  // ① 服务端明确要求重载（增量窗口都覆盖不了 ⇒ 只有权威历史能补）
  if (live !== null && live.resyncRequired) {
    return verdictOf(RESUME_RELOAD, 0, 0, 'server-resync-required');
  }
  // 没有基线：不能拿"当前本地状态"冒充基线（丢帧后它本身不可信）⇒ 交给既有探针
  if (mark === null) {
    return verdictOf(RESUME_NONE, 0, 0, 'no-baseline');
  }
  // 快照拿不到（弱网/旧服务端）：保守 NONE（不重历史；SSE 重连本身会补齐 ring 内事件）
  if (live === null) {
    return verdictOf(RESUME_NONE, 0, 0, 'no-snapshot');
  }
  // ③ 服务端明确"无在飞"
  if (!live.active) {
    if (mark.turnID > 0) {
      return verdictOf(RESUME_RELOAD, 0, 0, 'run-ended-while-away');
    }
    return verdictOf(RESUME_NONE, 0, 0, 'idle');
  }
  // ④ 换轮
  if (live.turnID !== mark.turnID) {
    if (live.turnID > mark.turnID) {
      return verdictOf(RESUME_RELOAD, 0, 0, 'turn-advanced');
    }
    // 快照比本地旧（本地已进入更新的一轮）⇒ 绝不反向清本地。
    //   `mark.turnID >= localMaxTurn` ⇒ 基线就是本地最新 ⇒ 纯"快照滞后"（local-ahead）；
    //   否则本地还有更新的回合（异常态）⇒ snapshot-behind，同样 NONE。
    if (localMaxTurn <= 0 || mark.turnID >= localMaxTurn) {
      return verdictOf(RESUME_NONE, 0, 0, 'local-ahead');
    }
    return verdictOf(RESUME_NONE, 0, 0, 'snapshot-behind');
  }
  // ⑤ 同一轮：落后 ⇒ 补洞
  if (live.iter > mark.iter) {
    const from: number = mark.iter > 0 ? mark.iter + 1 : 1;
    return verdictOf(RESUME_GAP, from, live.iter, 'iter-gap');
  }
  // ⑥ 一致或本地领先
  return verdictOf(RESUME_NONE, 0, 0, 'in-sync');
}
