"use strict";
/**
 * indicators.ets —— 列表「进行中」信号的**唯一判据**（纯逻辑，可脱机单测）。
 *
 * 不变量（用户 2026-09-19 / 2026-10-10 真机两次点名）：
 *   **「只要输入框是 cancel（停止），列表尾部就必须有一个可见的『进行中』信号」**
 *   （「思考中…」占位，或 live 行自身渲染出的在飞内容）。
 *
 * 对齐 web（`web/src/components/agent/MessageList.tsx`）：
 *   · `liveId` 指向接收 liveProgress 的那一行（尾行是 live 行时才可能"自带信号"）；
 *   · `tailShowsIndicator = tailIsLiveRow && liveIterationInFlight(...)`；
 *   · `showBusyPlaceholder = busy && !(loading && rows.length===0) && !tailShowsIndicator && !tailIsLiveRow`。
 *   web 用**同一个 `busy`** 驱动 composer 的 cancel 与列表占位符 ⇒ 不变量按构造成立。
 *
 * ⛔ 真机 P0（2026-10-10「发送完了连思考中都没来」）：native 把 composer 的 busy
 *   （`runningNow()`：本地 busy ∥ live 内容 ∥ 新鲜的服务端 running）与列表占位符的
 *   busy（`this.busy` = store.busy，仅本地事件驱动）**分成两套判据**。服务端已 running
 *   但本地 turn_started 未到（SSE 延迟/错过/刚切到运行中会话）时，按钮=停止、列表=空
 *   ⇒ 不变量被破坏。修法：两者共用下面这个 `busyNow`（= web 的单一 busy 语义）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.busyNow = busyNow;
exports.showsBusyPlaceholder = showsBusyPlaceholder;
exports.showsJumpToLatest = showsJumpToLatest;
exports.hasRunningSignal = hasRunningSignal;
/**
 * composer 与列表**共用**的「是否在跑」判据（对齐 web 的单一 `busy`）。
 *
 * 顺序无关（纯或），与既有 `runningNow()` 的语义逐项对应：
 *   ① 尾部 live 行已在渲染在飞内容；
 *   ② 当前会话有带产出的 live 行；
 *   ③ 本地事件驱动的 busy；
 *   ④ 服务端权威 running（快照新鲜时兜底 —— 本地快路径漂移/迟到时的最后防线）。
 */
function busyNow(o) {
    return o.tailShowsIndicator || o.liveHasContent || o.localBusy || o.freshServerRunning;
}
/**
 * 列表是否必须渲染 busy 占位符（「思考中…」）。
 *
 * ⚠️ 必须由 `busyNow` 驱动（**不能**用 `localBusy`）—— 否则与 composer 的按钮分叉。
 * `loading && rowsLen===0` 时不叠加（骨架屏承担空态反馈）。
 */
function showsBusyPlaceholder(o) {
    return busyNow(o) && !(o.loading && o.rowsLen === 0) && !o.tailShowsIndicator;
}
/**
 * 「↓ 回到最新」是否显示 —— **贴底不显示**、空列表不显示（对齐 web：仅在
 * follow 暂停、且确有内容时才给"回到底部"入口）。
 */
function showsJumpToLatest(atBottom, rowsLen) {
    return !atBottom && rowsLen > 0;
}
/**
 * 不变量自检：**在跑 ⟹ 有信号**（占位符 或 尾部 live 行自带信号）。
 * 供测试/断言使用；runtime 不必调用。
 */
function hasRunningSignal(o) {
    return showsBusyPlaceholder(o) || o.tailShowsIndicator;
}
