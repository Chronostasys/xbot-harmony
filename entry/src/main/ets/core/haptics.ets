/**
 * 触觉反馈的**数值底座**（E4）—— 由本仓**唯一入口** `pages/Index.ets: private buzz()` 消费。
 *
 * ── 依据（取证 2026-10-11）──────────────────────────────────────────────────────
 *   · **web 权威零触觉**：`/Users/bobli/src/xbot/web` 全仓 `vibrate|Vibrat|haptic` **0 命中**
 *     ⇒ 按 parity 与"别到处加"：⛔ **不引入新触觉点 / 新 API**。
 *   · 既有约定 = **单一 helper** `buzz()`（发送/停止等 6 处复用；无马达/无权限时**静默失败**）。
 *
 * ⚠️ `HAPTIC_TAP_MS` 是**设计值**（无既有常量可派生 —— 同 `MOTION_ENTER_SCALE` 的处理）：
 *   "极短轻点"量级；显著长于此会从"轻点确认"读成"来电/告警"。
 *
 * ⛔ 纯常量模块：`core/` 会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 本文件**不** import
 *   `@ohos.vibrator`（那是页面层的事），也不 import ArkUI。
 */
export const HAPTIC_TAP_MS: number = 12;
