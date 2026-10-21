/**
 * diag.ts —— **核心逻辑的用户可见诊断通道**（纯 TS，可被 core/*.ts 使用）。
 *
 * ⛔ 为什么需要（用户 2026-10-21 亲报「我在真机的日志窗口没看到任何相关日志」）：
 *   `core/*.ts`（reduce/normalize/...）是**纯 TS**（`run.sh` 当 TS 编，禁 import .ets），
 *   而应用内日志面板在 `core/applog.ets`（环形缓冲）。于是核心里的诊断只能写
 *   `console.info` → 系统 hilog，**永远进不了面板**；排查时"我这边没日志/你那边说有"
 *   就是这么来的（两套通道互不相通）。
 *   ⇒ 本文件只做一件事：暴露一个**sink 注册点**。谁拥有面板（applog）就在启动时注册；
 *     核心代码一律 `diag(tag, msg)` ⇒ 同时进面板 + hilog（未注册时只进 hilog）。
 *
 * 用法（唯一）：
 *   diag('iter', `iter=${n} tools=${k}`)   // 低频、只打计数/状态，⛔ 不进逐帧热路径
 */
export type DiagSink = (tag: string, msg: string) => void;

let sink: DiagSink | null = null;

/** 注册面板 sink（由 applog/store 在启动时调用一次；重复调用以最后一次为准）。 */
export function setDiagSink(fn: DiagSink): void {
  sink = fn;
}

/** 记录一条诊断（面板可见 + hilog 可见）。 */
export function diag(tag: string, msg: string): void {
  if (sink !== null) {
    sink(tag, msg);   // 面板（applog 内部自己会再打 hilog）
    return;
  }
  console.info(`[xbot][${tag}] ${msg}`);
}
