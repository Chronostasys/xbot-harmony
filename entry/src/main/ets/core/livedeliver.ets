/**
 * livedeliver.ets —— live **可见态投递的降频判据**（纯逻辑，可脱机单测）。
 *
 * ⛔ 用户亲报（2026-10-16）：「打开侧边栏或者菜单的时候，如果主视图还在 stream 就会**特别卡**。
 *    包括别的掉帧也和正在 stream 有关，**必须优化**」。
 *
 * 机制（与 §1.6f「滚动每帧整页 build」同族）：流式期间每个 SSE 帧都会把**页级可见态**
 * （`liveText`/`liveReasoning`/`liveTools`/`liveBlocks`/`liveSubAgents`）写进页面 `@State`
 * ⇒ **整页 `build()` 重跑** + live 行重新布局。浮层（抽屉/面板/菜单）打开时，这些帧全是
 * **看不见的无用功**，却与浮层的入场动画抢同一帧预算 ⇒ "开侧边栏特别卡"。
 *
 * ⇒ 覆盖期把投递**降频**（不是停投）：
 *   · `covered && busy`：两次投递至少隔 `COVERED_DELIVER_MS`（≈2.5 次/秒，肉眼无差别）；
 *   · **其余一律立即投**（`!covered` 或 `!busy`）—— 这条是**防陈旧的关键**：回合结束那一帧
 *     `busy=false` ⇒ 必投 ⇒ **最终内容不可能停在被丢弃的那一帧上**（⛔ 不做"覆盖期完全冻结"）。
 *
 * ⛔ 判据是**纯函数**（判据与渲染同源）；页面只保留一个时间戳字段，⛔ 不新开定时器。
 * 判据测试：`tools/tests/livedeliver.test.ts`（含 mutation 自证）。
 */

/** 覆盖期最小投递间隔（毫秒）。≈2.5 次/秒 —— 聊天区被浮层盖住，肉眼分辨不出更低频率。 */
export const COVERED_DELIVER_MS: number = 400;

/**
 * 这一帧是否该投递 live 可见态。
 *
 * @param covered 是否**有浮层覆盖聊天区**（页面 `anyModalOpen()`）
 * @param busy    回合是否仍在飞（页面 `this.busy`）
 * @param nowMs   当前时刻（`Date.now()`）
 * @param lastMs  上次投递时刻（无则传 0 ⇒ 首次必投）
 * @param minMs   覆盖期最小间隔（缺省 `COVERED_DELIVER_MS`）
 */
export function shouldDeliverLive(covered: boolean, busy: boolean, nowMs: number, lastMs: number,
  minMs: number = COVERED_DELIVER_MS): boolean {
  if (!covered || !busy) {
    // ⛔ 未覆盖（看得见）或回合已结束（内容定型）⇒ **必投**：前者关系正确性，后者防陈旧。
    return true;
  }
  return nowMs - lastMs >= minMs;
}
