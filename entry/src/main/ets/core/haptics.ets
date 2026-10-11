/**
 * 触觉反馈的**数值底座 + 事件→档位纯映射**（E4 起，目标⑤ 阶段 1 扩为多档）。
 *
 * ── 谁消费 ────────────────────────────────────────────────────────────────────
 *   · `pages/Index.ets: private buzz()` —— 本仓**唯一** `startVibration` 调用点（单一入口，
 *     由 `tools/tests/haptics.test.ts` ① 钉死）。阶段 2 起它传**事件名**给 `buzz(event)`，
 *     再由 `hapticFor(event)` 取档位。
 *
 * ── 依据（取证 2026-10-11，另见 `docs/WEB-ALIGNMENT.md §19`）──────────────────────
 *   · **web 权威零触觉**：`/Users/bobli/src/xbot/web` 全仓 `vibrate|Vibrat|haptic` **0 命中**
 *     ⇒ 触觉是**纯原生增强**；且"别到处加" ⇒ **不改单入口 / 不加组件层触觉**（见下 ⛔）。
 *   · 平台：`@ohos.vibrator.startVibration` **@since 9**、`VibrateTime` **@since 9**、
 *     `VibrateAttribute.usage` 必填（@since 9）；权限 `ohos.permission.VIBRATE` 已在
 *     `module.json5` 声明。SDK 门限 = `6.0.1(21)` ⇒ 全部可用、**无需抬 SDK**。
 *
 * ── 档位（ms）────────────────────────────────────────────────────────────────
 *   `HAPTIC_TAP_MS` 是**既有 E4 单档的设计值**（不变）："极短轻点"；显著长于此会从
 *   "轻点确认"读成"来电/告警"。多档只是把"同一轻点量级"细分为 轻/中 二档。
 *   ⚠️ **数值均属"手感"⇒ 只能真机验证**（模拟器无马达，离线不可判）。
 *
 * ── ⛔ 纪律 ────────────────────────────────────────────────────────────────────
 *   · 纯常量/纯函数模块：`core/` 会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 本文件
 *     **不** import `@ohos.vibrator`（那是页面层的事），也不 import ArkUI。
 *   · **未登记事件 ⇒ 不动**（`HAPTIC_NONE_MS`）：安全默认，抄错事件名不会误震。
 *   · ⛔ 别在 `components/**` 里自己震（`haptics.test.ts` ②：触觉属页面级交互）。
 */

/**
 * 既有单档时长（E4）。**取值与语义保持不变** —— 仍由 `pages/Index.ets: buzz()` 消费。
 * ⚠️ 设计值（无既有常量可派生，同 `MOTION_ENTER_SCALE` 的处理）。
 */
export const HAPTIC_TAP_MS: number = 12;

/** 轻档：选择 / 开关类（同既有轻点量级）。 */
export const HAPTIC_LIGHT_MS: number = HAPTIC_TAP_MS;

/**
 * 中档：发送 / 停止等高"确定感"动作。
 * ⚠️ 仍属**轻点**量级（< 50ms）；再长会读成告警/来电，与"日常操作确认"语义冲突。
 */
export const HAPTIC_MEDIUM_MS: number = 20;

/**
 * **不动**的哨兵值（= 不发起振动）。
 * `vibrator.startVibration` 的 `duration` 值域是 `(0, 1800000]` ⇒ **0 非法**
 * ⇒ 用它当"不振动"哨兵不会与任何合法时长撞车。
 */
export const HAPTIC_NONE_MS: number = 0;

// ── 事件名（登记表：这里是"哪些事件有触觉"的**唯一真源**）────────────────────
//   ⛔ 新增事件 = 新增触觉点 ⇒ 必须显式登记（`haptics.test.ts` 的"决定加触觉本身要留痕"）。

/** 发送消息。 */
export const HAPTIC_EVENT_SEND: string = 'send';
/** 停止生成（打断）。 */
export const HAPTIC_EVENT_STOP: string = 'stop';
/** 选中一条候选（`/` 命令、`@` 文件）。 */
export const HAPTIC_EVENT_SELECT: string = 'select';
/** 切换开关（星标会话、主题）。 */
export const HAPTIC_EVENT_TOGGLE: string = 'toggle';
/** 一次动作**成功**的确认（如回退并重发完成）。 */
export const HAPTIC_EVENT_CONFIRM: string = 'confirm';

/**
 * 事件 → 振动时长（ms）的**纯函数**。
 *
 * ⛔ **未登记事件 ⇒ `HAPTIC_NONE_MS`（不动）** —— 安全默认：
 *   拼错/新造的事件名**只会静默不震**，绝不会误震或抛错。
 *   匹配是**严格相等**（大小写敏感、不 trim）⇒ `'SEND'` / `' send'` 一律落默认。
 *
 * @param event 事件名（见 `HAPTIC_EVENT_*`）
 * @returns 时长 ms；`HAPTIC_NONE_MS`(0) 表示**不振动**
 */
export function hapticFor(event: string): number {
  switch (event) {
    case HAPTIC_EVENT_SEND:
      return HAPTIC_MEDIUM_MS;
    case HAPTIC_EVENT_STOP:
      return HAPTIC_MEDIUM_MS;
    case HAPTIC_EVENT_SELECT:
      return HAPTIC_LIGHT_MS;
    case HAPTIC_EVENT_TOGGLE:
      return HAPTIC_LIGHT_MS;
    case HAPTIC_EVENT_CONFIRM:
      return HAPTIC_LIGHT_MS;
    default:
      return HAPTIC_NONE_MS;
  }
}
