/**
 * 危险操作「两段式确认」的**唯一状态机 + 语义色角色**（纯逻辑，可脱机单测）。
 *
 * 为什么必须收进 `core/`：`components/**` 不进离线 harness（`tools/tests/run.sh` 只把 `core/**`
 * 当纯 TS 编译）⇒ 判据写在组件里就**测不到**。本仓既有 5 份各自为政的实现
 * （`SettingsAccount:42` / `SettingsLlm:118` / `SettingsPlugins:221` / `SettingsWebUsers:51` /
 * `SettingsAbout:394`，4 种取色），`SettingsWebUsers.ets:48-49` 只能靠**注释**维持一致。
 * 本文件把"第一下武装、第二下才执行、可取消、可过期"收成**一个纯函数**，并把取色收成**一张表**。
 *
 * 语义（与迁移前逐条等价，**不得改用户可感知行为**）：
 *   · 第一下：只武装（`Arm`），不执行；
 *   · 第二下（同一目标）：执行（`Commit`）；
 *   · 点了**别的**目标：把武装改到新目标（`Arm`），不执行原来的；
 *   · 忙碌中：不接受武装也不执行（`None`）；
 *   · 取消 / 执行完：回到 idle（组件置空武装键）。
 *
 * ⚠️ 迁移的两个面板**都没有超时**（武装态一直留到取消/执行）⇒ 调用方传 `DANGER_NO_EXPIRY`
 *    保持语义不变；`ttlMs > 0` 的过期路径由本模块提供并被单测覆盖（供将来显式启用）。
 *
 * ⛔ **有意零消费（S3-a 裁决，2026-10-11）**：本模块**当前不接线**。理由经只读取证 ——
 *    **web 没有"两步确认"这个模式**，其破坏性动作一律是**单击直执行 + busy/错误提示**：
 *      · 退出登录 `web/src/components/settings/SettingsDialog.tsx:66-99`（单击 `await logout()`，无 confirm）；
 *      · 恢复默认面板布局 `web/src/components/settings/SettingsLayout.tsx:43-56`（单击清 `localStorage`
 *        + POST `user_settings`，只有 `resetting`/`resetErr`）；
 *      · 全 web 搜 `再次点击`/`再点一次`/`click again`/`armed` **只命中无关用途**
 *        （`MessageList.tsx:571 loadMoreArmedRef` 加载哨兵、`PanelLayout.tsx:427` 占位面板语义）。
 *    ⇒ 接它 = **主动背离 web + 用户没要求**。保留本模块的价值 = 把既有 **5 份各自为政**的组件内实现
 *      收敛成**一张表 + 一个纯函数**（判据可脱机测）；已在 `tools/tests/orphan_core_module.test.ts`
 *      的 `UNCONSUMED` 台账**显式登记"有意零消费"**。⛔ 若将来用户点名要两步确认，再开 S3-b 接线。
 */

import { Palette, contrastRatio } from './theme';

/** 危险度 —— `warnBg` vs `dangerBg` 的**裁决点**（见 `docs/REDESIGN-INPUT-SETTINGS.md` §F1）。 */
export enum DangerSeverity {
  /** 不可逆 / 破坏性（删除、退出登录） */
  Danger = 0,
  /** 可恢复 / 只是"打断正在进行的动作"（例：重载插件——**疑点**，见文件尾注） */
  Warning = 1,
}

/** 永不超时（= 迁移前的既有语义）。 */
export const DANGER_NO_EXPIRY: number = 0;

/** 一次点击的结论。 */
export enum DangerPress {
  /** 不武装、不执行（忙碌中） */
  None = 0,
  /** 仅武装（第一下 / 改武装到新目标） */
  Arm = 1,
  /** 真执行（第二下） */
  Commit = 2,
}

/**
 * 当前**有效**的武装键（已扣除过期；空串 = idle）。
 *
 * 过期语义：`armedAtMs + ttlMs <= nowMs` ⇒ 视为未武装（组件据此把武装态收回 idle）。
 */
export function armedKeyNow(armedKey: string, armedAtMs: number, nowMs: number, ttlMs: number): string {
  if (armedKey.length === 0) {
    return '';
  }
  if (ttlMs > DANGER_NO_EXPIRY && nowMs - armedAtMs >= ttlMs) {
    return '';
  }
  return armedKey;
}

/**
 * 判定一次点击的结论 —— **两段式的唯一判据**。
 *
 * @param armedKey  当前武装键（组件 `@State`）
 * @param armedAtMs 武装时刻（组件 `@State`）
 * @param key       本次点击的目标键（删除某行 = 用户名；退出登录 = 固定键）
 * @param nowMs     当前时刻（`Date.now()`，由调用方注入 ⇒ 纯函数可测）
 * @param ttlMs     过期时长；`DANGER_NO_EXPIRY` = 永不超时
 * @param busy      该动作是否正在执行（执行中不接受武装/执行）
 */
export function dangerPress(
  armedKey: string, armedAtMs: number, key: string, nowMs: number, ttlMs: number, busy: boolean,
): DangerPress {
  if (busy) {
    return DangerPress.None;
  }
  const armed: string = armedKeyNow(armedKey, armedAtMs, nowMs, ttlMs);
  if (armed.length > 0 && armed === key) {
    return DangerPress.Commit;
  }
  return DangerPress.Arm;
}

/** 一件危险控件的**取色结果**（三件套 + 不透明度）。 */
export class DangerVisual {
  bg: string = '';
  fg: string = '';
  border: string = '';
  /** 忙碌/禁用不透明度。 */
  opacity: number = 1;
}

/**
 * 危险实心底上的文字最低对比度。
 * 取值 3.0：与 `core/mdview.codeTokenColor` 同口径（非正文的大字/图标档，WCAG 1.4.11）。
 */
export const DANGER_ARMED_MIN_RATIO: number = 3.0;

/** 危险度 ⇒ **静息**文字/描边角色（唯一映射）。 */
function dangerAccentOf(severity: number, pal: Palette): string {
  return severity === DangerSeverity.Warning ? pal.warn : pal.dangerText;
}

/** 危险度 ⇒ **武装**态的实心底角色（唯一映射）。 */
function dangerFillOf(severity: number, pal: Palette): string {
  return severity === DangerSeverity.Warning ? pal.warnBg : pal.dangerBg;
}

/**
 * 危险度的**唯一取色表**（组件不得再自挑角色）。
 *
 * ⚠️ **报备（缺角色）**：现有色板**没有**"危险实心底上的文字"这一角色 —— `pal.onAccent` 在
 *   `aurora`(#04150f)/`nebula`(#150a2b) 是**深色**（因为它们的 accent 是亮青/亮紫），压在
 *   深红 `dangerBg`(#7f1d1d) 上读不出。故这里**不新造角色**，而是在**既有角色**里按
 *   `DANGER_ARMED_MIN_RATIO` 挑达标的（`onAccent` → `textPrimary`），并由单测在**全 5 主题**
 *   上复核 `contrastRatio(fg, bg) >= 3.0`。
 *   ⇒ 正解是 `core/design.ets` 增一个 `state.danger.fg` 角色（归 `design-lead`）；在此之前本函数
 *     是**唯一的临时口径**（组件不再各写一份）。
 */
export function dangerVisualOf(severity: number, armed: boolean, busy: boolean, pal: Palette): DangerVisual {
  const v: DangerVisual = new DangerVisual();
  const accent: string = dangerAccentOf(severity, pal);
  if (armed) {
    const fill: string = dangerFillOf(severity, pal);
    v.bg = fill;
    v.border = accent;
    // 实心底上的文字：在既有角色里挑达标的（见上方"报备"）
    if (contrastRatio(pal.onAccent, fill) >= DANGER_ARMED_MIN_RATIO) {
      v.fg = pal.onAccent;
    } else if (contrastRatio(pal.textPrimary, fill) >= DANGER_ARMED_MIN_RATIO) {
      v.fg = pal.textPrimary;
    } else {
      v.fg = accent; // 兜底（全主题单测会复核；当前 5 套主题都不会走到这里）
    }
  } else {
    // 静息：不填充（只靠危险字色 + 强描边）——与 `SettingsAccount` 既有观感一致
    v.bg = pal.surfaceAlt;
    v.fg = accent;
    v.border = pal.borderStrong;
  }
  v.opacity = busy ? 0.5 : 1;
  return v;
}

// ── 待裁决的疑点（不是代码，是记录）──────────────────────────────────────────
// `SettingsPlugins.ets:414` 的「重载插件」用的是 `warnBg`（**警告**色）却做的是不可逆动作
// （写后回读）。它到底属 `DangerSeverity.Danger` 还是 `.Warning`？
// ⛔ 本模块**不替它决定**：两个枚举都提供，接线时按**现状**（warnBg ⇒ Warning）传参，
//    待 design-lead 裁决后改一个枚举值即可（见交付说明 §④）。
