/**
 * turndrop.ts — mid-turn 收尾诊断（降噪：逐 turn 走 debug + burst 结束打**一条** warn 汇总）。
 *
 * 背景（perf-audit #5）：冷启动加载「cron/通知 turn」时，DB 快照里只有 user 行、
 * 没有 assistant 产出 ⇒ 旧 `derive` 造出 frozen 空壳并**正确**跳过它的 assistant 行
 * （幽灵行消除）。旧实现每 turnID 打一条 console.warn（一次冷启动可达 ~60 条），
 * 纯噪音且把 warn 级日志淹没。
 *
 * 现在：逐条走 `console.debug`；一轮诊断 burst 结束后由 `flushTurndropSummary`
 * 打**唯一**的 warn 级汇总。⚠️ 语义零改动：这里只改**日志**，不改任何丢弃/保留判据。
 *
 * ⚠️ 本文件从 `derive.ts` 拆出（行源已切模型后 `derive.ts` 被删除，但状态机的
 *    mid-turn 收尾事件仍需要这条诊断）。
 */
export type TurndropKind = 'hollowFrozen' | 'foldedLive' | 'lateText' | 'idleFroze' | 'idleDelete'

// 去重键（turn 粒度 —— 状态机事件重放靠它只计一次）。
const turndropSeen = new Set<string>()
const turndropCounts: Record<TurndropKind, number> = {
  hollowFrozen: 0,
  foldedLive: 0,
  lateText: 0,
  idleFroze: 0,
  idleDelete: 0,
}
let turndropTimer: ReturnType<typeof setTimeout> | null = null
/** burst 静默窗口：最后一条诊断后这么久没有新诊断就汇总（同一 burst 只汇总一次）。 */
const TURNDROP_QUIET_MS = 1200

/**
 * 记录一次 TURNDROP 诊断。同一 key（turn 粒度）只累计/打印一次；逐条 `console.debug`。
 * 唯一 warn 级输出由 burst 结束后的 `flushTurndropSummary` 打（或测试直接调用）。
 */
export function noteTurndrop(
  kind: TurndropKind,
  key: string,
  detail: Record<string, unknown>,
): void {
  if (!turndropSeen.has(key)) {
    turndropSeen.add(key)
    turndropCounts[kind] += 1
    console.debug(`[TURNDROP] ${kind}`, detail)
  }
  if (turndropTimer === null) {
    turndropTimer = setTimeout(flushTurndropSummary, TURNDROP_QUIET_MS)
  }
}

/**
 * 打**一条** warn 汇总并清零（burst 结束触发；测试可直接调用以获得确定性）。
 * 这是 TURNDROP 唯一的 warn 级输出 —— 逐 turn 明细已降级为 debug。
 */
export function flushTurndropSummary(): void {
  if (turndropTimer !== null) {
    clearTimeout(turndropTimer)
    turndropTimer = null
  }
  const c = turndropCounts
  const total = c.hollowFrozen + c.foldedLive + c.lateText + c.idleFroze + c.idleDelete
  if (total === 0) return
  console.warn(
    `[TURNDROP] 汇总：跳过 ${c.hollowFrozen} 个空壳 turn（无 assistant 产出，user 行保留）`
    + `；mid-turn 收尾 folded=${c.foldedLive} froze=${c.idleFroze} lateText=${c.lateText} delete=${c.idleDelete}`,
  )
  c.hollowFrozen = 0
  c.foldedLive = 0
  c.lateText = 0
  c.idleFroze = 0
  c.idleDelete = 0
  turndropSeen.clear()
}
