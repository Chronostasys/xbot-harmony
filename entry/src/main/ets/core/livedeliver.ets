/**
 * livedeliver.ets —— live **可见态投递的降频判据**（纯逻辑，可脱机单测）。
 *
 * ⛔ 用户亲报（2026-10-16）：「打开侧边栏或者菜单的时候，如果主视图还在 stream 就会**特别卡**。
 *    包括别的掉帧也和正在 stream 有关，**必须优化**」；同日定向：
 *    「最好**一旦 live iter 看不到就不渲染它了，只记录状态**，commit 的时候更新一下而不是做
 *      stream 高频更新。它**快进入视野的时候再挂载回来**」。
 *
 * 机制（与 §1.6f「滚动每帧整页 build」同族）：流式期间每个 SSE 帧都会把**页级可见态**
 * （`liveText`/`liveReasoning`/`liveTools`/`liveBlocks`/`liveSubAgents`）写进页面 `@State`
 * ⇒ **整页 `build()` 重跑** + live 行重新布局。当 live 行**看不见**（被浮层盖住，或用户上滚
 * 把它滚出视野）时，这些帧全是**无用功**，却与浮层入场动画/滚动抢同一帧预算。
 *
 * ⇒ **看不见就不做高频更新**（只记状态：SSE 照常累积进 store）：
 *   · `!busy` ⇒ **必投**（回合结束那一帧内容定型 —— ⛔ 防陈旧硬约束：最终内容绝不停在被丢弃的帧上）；
 *   · `!covered && visible` ⇒ **必投**（用户看得见 ⇒ 必须即时呈现，正确性优先）；
 *   · 其余（看不见且仍在流式）⇒ 最小间隔 `COVERED_DELIVER_MS` 降频；
 *   · 回到可见（关浮层 / 滚回视野 / 回合结束）⇒ 立即恢复全速投递 ⇒ 用户看到的是**最新内容**。
 *
 * ⛔ 判据是**纯函数**（判据与渲染同源）；页面只保留一个时间戳字段，⛔ 不新开定时器。
 * 判据测试：`tools/tests/livedeliver.test.ts`（含 mutation 自证）。
 */

/** 看不见时的最小投递间隔（毫秒）。≈2.5 次/秒 —— 反正看不见，只保证"状态不落后太多"。 */
export const COVERED_DELIVER_MS: number = 400;

/**
 * 这一帧是否该投递 live 可见态。
 *
 * @param covered 是否**有浮层覆盖聊天区**（页面 `anyModalOpen()`）
 * @param visible live 行是否**在视野内**（页面 `liveRowVisible`，`onVisibleAreaChange` 维护）
 * @param busy    回合是否仍在飞（页面 `this.busy`）
 * @param nowMs   当前时刻（`Date.now()`）
 * @param lastMs  上次投递时刻（无则传 0 ⇒ 首次必投）
 * @param minMs   看不见时的最小间隔（缺省 `COVERED_DELIVER_MS`）
 */
export function shouldDeliverLive(covered: boolean, visible: boolean, busy: boolean, nowMs: number,
  lastMs: number, minMs: number = COVERED_DELIVER_MS): boolean {
  if (!busy) {
    // 回合结束 ⇒ 内容定型 ⇒ **必投**（⛔ 即使看不见也必须落地，否则关浮层后是旧内容）。
    return true;
  }
  if (!covered) {
    // ⛔ 2026-10-17 P0（用户亲报「上滚一点滚回来，看到的 stream 和打字机就不正常了，
    //   判定逻辑有严重错误」）：原判据把「live 行滚出视口（visible=false）」与「浮层
    //   完全覆盖（covered）」混同 ⇒ 滚出视口时 400ms 限频 ⇒ @State 冻结在旧值 ⇒
    //   打字机/流式内容与实际进度脱节；滚回来后还要等下一次 delta 才恢复（错乱窗口）。
    //   修：**只有浮层完全覆盖才限频**（覆盖时整块区域看不见，400ms 降频肉眼无差别）；
    //   滚出视口照常投 —— 数据永远新鲜，滚回即正确（正确性 > 不可见时的少量 CPU）。
    return true;
  }
  return nowMs - lastMs >= minMs;
}
