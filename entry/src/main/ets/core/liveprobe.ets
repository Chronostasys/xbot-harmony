/**
 * liveprobe.ets —— 「从前台切回来/怀疑卡死时，用**轻量接口**判自己是否 stall」的纯逻辑。
 *
 * 用户 2026-10-21 定向（原话）：
 *   「只要从别的应用切回来**必须立刻检查会话状态**，后端应该有可以立刻拿到最新迭代的接口吧？
 *     是不是会有个 live 接口之类的，每次切回来必须要调这种**轻量接口** 检查自己是否 stall」。
 *
 * 背景（真机症状）：切后台一段时间后回来，界面停在「运行中…／思考中…」，SSE 早已断开，
 *   而**重历史重载**（`loadHistory`）很重、路径上还有节流/合并 —— 不能作为"立刻发现 stall"
 *   的判据。服务端有轻量快照 `get_active_progress`（`agent/agent_backend_methods.go:181`，
 *   返回最近一次的 `ProgressEvent`：`turn_id` / `iteration` / `streaming` / `phase`），
 *   ⇒ 切回来先打这一枪，**O(1) 级**判断本地视图是否已经落后/幽灵 busy，再决定要不要 resync。
 *
 * 判据（本函数，纯逻辑）：
 *   · 服务端**有**在飞快照、本地**不** busy      ⇒ stall（错过了 turn_started）
 *   · 服务端**无**在飞快照、本地 busy            ⇒ stall（幽灵 busy：回合已结束/事件全丢）
 *   · 双方都有，但 turn 不同 / 服务端迭代更靠前  ⇒ stall（错过了迭代/正文增量）
 *   · 其余（本地领先或一致）                     ⇒ ok（本地领先 = 快照滞后，绝不能反过来清本地）
 */

/** 探针结论（字符串常量，避免 ArkTS 枚举序列化歧义）。 */
export const PROBE_OK: string = 'ok';
export const PROBE_STALL: string = 'stall';

/**
 * 判定本地视图是否已经 stall。
 *
 * @param localBusy     本地是否认为回合在跑（页面 `busy`）
 * @param localTurn     本地 live turn（无则 0）
 * @param localIter     本地 live 迭代号（无则 0）
 * @param serverHasActive 服务端快照是否存在（`get_active_progress` 返回非 null 且 phase 非 done）
 * @param serverTurn    服务端快照的 `turn_id`（缺省 0）
 * @param serverIter    服务端快照的 `iteration`（缺省 0）
 */
export function liveProbeVerdict(localBusy: boolean, localTurn: number, localIter: number,
  serverHasActive: boolean, serverTurn: number, serverIter: number): string {
  if (serverHasActive && !localBusy) {
    return PROBE_STALL;
  }
  if (!serverHasActive && localBusy) {
    return PROBE_STALL;
  }
  if (!serverHasActive && !localBusy) {
    return PROBE_OK;
  }
  if (localTurn > 0 && serverTurn > 0 && serverTurn !== localTurn) {
    // 服务端已经开了新 turn（或快照落后于本地 turn）——只在**服务端更新**时判 stall。
    return serverTurn > localTurn ? PROBE_STALL : PROBE_OK;
  }
  if (serverIter > localIter) {
    return PROBE_STALL;
  }
  return PROBE_OK;
}

/**
 * 服务端快照的 `phase` 是否代表"回合仍在进行"。
 * 服务端在回合结束/无快照时会返回 `phase: "done"`（见 `GetActiveProgress` 的注释），
 * ⇒ 必须把 `done` 折成"没有在飞"，否则每次切回来都会误判成 stall（白白重载一次历史）。
 */
export function probePhaseActive(phase: string | undefined): boolean {
  if (phase === undefined || phase.length === 0) {
    // 缺 phase：保守当"有在飞"（只会多一次判定，不会漏 stall）。
    return true;
  }
  return phase !== 'done';
}
