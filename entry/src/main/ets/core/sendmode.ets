/**
 * 发送模式（排队 / ⚡ 插话）的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web_inbound.go` + `protocol/ws.go`，逐字核对）：
 *   `WSClientMessage.Interrupt`（json `interrupt`）为 true 时，消息**注入到正在跑的 turn**
 *   —— 不排队、不产生 user 行、不带 turn_id；代理在**下一个工具边界**把它作为合成
 *   `user_interrupt` 工具结果喂给模型；响应里 `interrupted=true`。
 *   **会话空闲时会自动退化为普通发送**（所以界面不需要在空闲时暴露插话）。
 *
 * ⚠️ 铁律（Web gotcha）：`interruptMode` 必须随 busy=false **自动复位** —— 否则下一轮
 * 用户以为在发普通消息，实际却插进了别人的回合。
 */

export const MODE_QUEUE: string = 'queue';
export const MODE_INTERRUPT: string = 'interrupt';

/** 切换模式（两态互斥）。 */
export function toggleMode(mode: string): string {
  return mode === MODE_INTERRUPT ? MODE_QUEUE : MODE_INTERRUPT;
}

/** 模式显示名。 */
export function modeLabel(mode: string): string {
  return mode === MODE_INTERRUPT ? '⚡ 插话' : '排队';
}

/** 模式说明（按钮 title 区不够放时用于 toast/提示）。 */
export function modeHint(mode: string): string {
  if (mode === MODE_INTERRUPT) {
    return '插话：直接注入当前回合的下一个工具边界（不排队）';
  }
  return '排队：等当前回合结束后再发';
}

/** 实际生效的模式（不忙时一律普通发送 —— 插话只对"正在跑"的会话有意义）。 */
export function effectiveMode(busy: boolean, mode: string): string {
  return busy ? mode : MODE_QUEUE;
}

/** 是不是插话发送。 */
export function isInterruptSend(busy: boolean, mode: string): boolean {
  return effectiveMode(busy, mode) === MODE_INTERRUPT;
}

/** 发送后的回执文案（服务端可能把插话退化成普通发送 ⇒ 文案必须反映真实结果）。 */
export function sendToast(interrupted: boolean, busyBefore: boolean): string {
  if (interrupted) {
    return '已插话到当前回合';
  }
  if (busyBefore) {
    return '已排队（当前回合结束后发送）';
  }
  return '';
}
