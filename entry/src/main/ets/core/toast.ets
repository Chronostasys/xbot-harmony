/**
 * toast —— **自绘 in-app toast** 的纯逻辑（时长档 / 文案 / 单槽语义）。可脱机单测。
 *
 * ── 为什么自绘（C4 裁决，2026-10-11）────────────────────────────────────────────
 * 系统 `promptAction.showToast` 的**底/字/圆角/字号/位置全由系统固定**，只随应用 `colorMode` 明暗，
 * ⛔ **不读** `pal()`/`effectsOf` ⇒ 半径/阴影/字族与 porcelain（"发丝 + 柔影 + token 半径"）**不同族**。
 * toast 是**最高频**的瞬时面（复制反馈是核心交互）⇒ 自绘（成本远低于 `bindPopup` 自绘 —— 无需锚点/翻转）。
 *
 * ── 两条**硬约束**（违反即门禁红）────────────────────────────────────────────────
 *   ① **`setTimeout` 预算 7/7 已满**（`docs/PERF-BUDGET.md §2-18`）⇒ dismiss **必须复用页面唯一出口
 *      `delay()`**（`pages/Index.ets:239-241`）—— ⛔ 本模块**不持有定时器**，只给"到点了该不该撤"的判据。
 *   ② **门禁 ⑨ A1 硬红"静息态 = 隐藏"**（`tools/lint/anim-opacity-gate.sh`）⇒ 可见性**必须是状态的函数**
 *      （`toastVisible`），⛔ 不许 `@State entered=false` + `.opacity(entered ? 1 : 0)`。
 *
 * ⛔ 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`。
 * ⛔ 颜色/时长**一律从既有底座派生**（本文件不出现 `#RRGGBB` 与裸时长）。
 */
import { COPY_FEEDBACK_MS, copyLabel } from './feedback';
import { ORB_BREATH_MS } from './orb';

// ── 类别（字符串常量，沿用本仓惯例；⛔ 不用 union 字面量类型）────────────────────
/** 复制类反馈（唯一文案由 `toastLabel` 统一）。 */
export const TOAST_KIND_COPY: string = 'copy';
/** 一般提示（链接失败 / 保存成功 / 附件上限 …）—— 文案由调用方给。 */
export const TOAST_KIND_NOTICE: string = 'notice';
/**
 * **notice 分场景档**（对齐 web 的两个 call site，把"一般提示"拆成成功/失败两支）：
 *   · `NOTICE_OK`  = 后台任务**成功**反馈（web `ToolRender.tsx:508 duration: 5000`）；
 *   · `NOTICE_ERR` = **失败/重试**反馈（web `ToolRender.tsx:514 duration: 4000`）。
 * ⚠️ 失败档**更短**（4000 < 5000）不是笔误 —— web 就这么写的（失败是打扰，少留一会儿）。
 */
export const TOAST_KIND_NOTICE_OK: string = 'notice-ok';
export const TOAST_KIND_NOTICE_ERR: string = 'notice-err';

// ── 时长档（**全部派生自底座**，零裸数字）─────────────────────────────────────
/**
 * 复制反馈时长 = `COPY_FEEDBACK_MS`（1200，`core/feedback.ets:16`）
 * —— 与 web `MarkdownRenderer.tsx:364` 的 1200ms **逐值一致**（复制反馈全 App 同一节拍）。
 */
export const TOAST_MS_COPY: number = COPY_FEEDBACK_MS;
/**
 * 一般提示时长 = `ORB_BREATH_MS`（2560 = 在飞主呼吸 1×，`core/orb.ets:26`）。
 * 取代原 4 处 call site 的**裸字面量** `2000/2500`（`Index.ets:1702` / `SettingsAbout.ets:232,240`）
 * ⇒ 沿用"刻度派生"口径（⛔ 不新造时长；近似值且唯一来源）。
 */
export const TOAST_MS_NOTICE: number = ORB_BREATH_MS;
/**
 * **notice-ok** 档 = 5000ms —— 与 web `ToolRender.tsx:508`（后台任务**成功** `duration: 5000`）逐值一致。
 */
export const TOAST_MS_NOTICE_OK: number = 5000;
/**
 * **notice-err** 档 = 4000ms —— 与 web `ToolRender.tsx:514`（**失败/重试** `duration: 4000`）逐值一致。
 */
export const TOAST_MS_NOTICE_ERR: number = 4000;

/**
 * 类别 → 时长档（唯一映射）。
 * · `copy` ⇒ 复制档（1200）；· `notice-ok` ⇒ 5000；· `notice-err` ⇒ 4000；
 * · 其余（含旧 `notice` 与未知类别）⇒ 一般档 2560（**向后兼容**：老 call site 行为不变）。
 */
export function toastDurationMs(kind: string): number {
  if (kind === TOAST_KIND_COPY) { return TOAST_MS_COPY; }
  if (kind === TOAST_KIND_NOTICE_OK) { return TOAST_MS_NOTICE_OK; }
  if (kind === TOAST_KIND_NOTICE_ERR) { return TOAST_MS_NOTICE_ERR; }
  return TOAST_MS_NOTICE;
}

/**
 * toast 的**展示文案**（唯一出口）。
 * 复制类**恒**走 `copyLabel('复制', true)` = 「已复制」⇒ 与消息级/代码块级复制**同一句话**
 * （⛔ 不让各 call site 自造句式）；其余类别原样返回调用方文案。
 */
export function toastLabel(kind: string, msg: string): string {
  if (kind === TOAST_KIND_COPY) {
    return copyLabel('复制', true);
  }
  return msg === undefined || msg === null ? '' : msg;
}

// ── 单槽语义（**替换 + 版本号**，不排队）──────────────────────────────────────
/**
 * toast 状态（**单槽**）。用 class 承载（ArkTS 禁对象字面量作类型标注）。
 *
 * `seq` 是**版本号**：每次换内容自增 ⇒ 页面用它给 dismiss 计时器"装表"，
 * 到点时用 `toastExpired` 校验 ⇒ **陈旧计时器不会误杀新 toast**
 * （场景：A 显示中，B 覆盖 A；A 的计时器到点若无条件清空，会把 B 提前撤掉）。
 */
export class ToastState {
  msg: string = '';
  kind: string = '';
  seq: number = 0;
  constructor(msg: string, kind: string, seq: number) {
    this.msg = msg;
    this.kind = kind;
    this.seq = seq;
  }
}

/** 空态（未显示）。 */
export function emptyToast(): ToastState {
  return new ToastState('', '', 0);
}

/**
 * 收到一条新 toast：**单槽替换**（最新者胜）+ 版本自增。
 * 空文案 = **清空**（同样自增版本 ⇒ 使在飞的旧计时器失效，语义一致）。
 *
 * 为什么**不排队**：toast 是**瞬时反馈**，积压只会让后面的提示迟到（且用户并不需要 backlog）；
 * 单槽还天然防"提示风暴"把队列撑大。
 */
export function nextToast(cur: ToastState, kind: string, msg: string): ToastState {
  const text: string = toastLabel(kind, msg);
  if (text.trim().length === 0) {
    return new ToastState('', '', cur.seq + 1);
  }
  return new ToastState(text, kind, cur.seq + 1);
}

/**
 * **可见性判据（静息态）** = 文案非空。
 * ⛔ 与任何动画状态**无关** ⇒「可读性不是动画的函数」（门禁 ⑨ 的正向形态）：
 *    动画被打断/未触发，toast 依旧可见（fail-safe），不会停在"半透明不可读"。
 */
export function toastVisible(t: ToastState): boolean {
  return t.msg.length > 0;
}

/**
 * 计时器到点：**是否可撤**。只在"当前仍是装表时那一版"（`seq` 未变）且确实在显示时 ⇒ `true`。
 * （页面据此 `toast = emptyToast()`；`seq` 不符 ⇒ 不动，说明期间来了更新的 toast。）
 */
export function toastExpired(cur: ToastState, seqAtArm: number): boolean {
  return cur.msg.length > 0 && cur.seq === seqAtArm;
}
