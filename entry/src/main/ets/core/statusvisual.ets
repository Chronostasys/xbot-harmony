/**
 * statusvisual.ets —— **子代理 / 待办** 两个面的「状态 → 视觉语义」**唯一真源**（纯逻辑，可脱机单测）。
 *
 * 为什么单独成模块（与 `core/toolvisual.ets` 同一手法、同一理由）：
 *   改造前，"某个状态长什么样"被判在**组件里、且散成多段 if 链**：
 *     · `components/SubAgentTree.ets`：`barColor()` / `iconRes()` / `iconColor()` 三段独立 if 链
 *       各判一次 `this.kind`（竖条色 / 图标 / 图标色）；
 *     · `components/TodoPanel.ets`：`iconColor()` / `iconRes()` + 行内三处三元（字色 / 字重 / 删除线）
 *       共 5 处各判一次 `this.kind`。
 *   同一状态被反复判 ⇒ **改一处忘一处**（用户 2026-10-11 报的"打脸组合"根因，见
 *   `docs/WEB-ALIGNMENT.md §16` 病根 #5）。本模块把判据**下沉、集中、可单测**：
 *   组件只"照着 `StatusVisual` 画" ⇒ 结构上不可能分叉。
 *
 * ── 复用而非复刻（⛔ 纪律）──────────────────────────────────────────────────────
 *   · **语义色角色词汇**直接 reuse `core/toolstatus.ets` 的 `ROLE_*`（工具族已是唯一源）——
 *     本模块**不新造**一套同名角色。
 *   · 本模块只补工具族**没有**的两样：① 文字层级角色（`ROLE_PRIMARY/SECONDARY`）；
 *     ② 本族的**形态档**（marker）与**强调档**（emphasis）。
 *   · ⛔ `core/` 禁止 import ArkUI / `@ohos.*` ⇒ 这里只出**档位字符串**与**角色名**，
 *     "档 → `sys.symbol`"、"角色 → 色值"的解析分别在组件（`Resource`）与
 *     `roleColorOf()`（返回色值字符串）里。
 *
 * ── 与 `core/toolvisual.ets` 的关系（诚实声明）─────────────────────────────────
 *   toolvisual 的 `statusColorOf` 把 role 解析成色值（内联四分支，**未导出成 role→色函数**）。
 *   本模块需要一个**同语义**的 role→色解析（`roleColorOf`）。因为本波**禁改** `toolvisual.ets`，
 *   这里按**本族自己的色值口径**重述一遍（见 `roleColorOf` 注释；**与 toolvisual 唯一的差异是
 *   `danger` 取 `statusError` 而非 `dangerText`** —— 这正是 `ContextRing`/`SubAgentTree` 既有观感）。
 *   ⚠️ 待统一项：把 role→色解析收敛成 `core/` 里**一个**导出函数，两族共用（已记入交付的
 *   "缺 token 清单"，需 `design-lead` 拍板角色台账后再动）。
 */
import { Palette } from './theme';
// 语义色角色词汇：**复用**工具族唯一源，不新造。
import { ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS } from './toolstatus';
import { SUB_DONE, SUB_ERROR, SUB_RUNNING } from './subagent';
import { TODO_DONE, TODO_DOING } from './todos';

// ── 形态档（marker）—— 组件的唯一输入；"档 → sys.symbol" 由组件解析（core 不能持 Resource）──
/** 提示符（子代理 running/other）：灯泡（HarmonyOS 无 brain/sparkles）。 */
export const MARK_BULB: string = 'bulb';
/** 勾（完成）：子代理用裸勾，待办用圈中勾。 */
export const MARK_CHECK: string = 'check';
export const MARK_CIRCLE_CHECK: string = 'circleCheck';
/** 叉（失败）：圈中叉。 */
export const MARK_CROSS: string = 'cross';
/** 等待（待办 pending）：空心圆。 */
export const MARK_CIRCLE: string = 'circle';
/** 进行中（待办 doing）：虚线圆。 */
export const MARK_CIRCLE_DASHED: string = 'circleDashed';
/** 全部形态档（测试用穷尽性）。 */
export const ALL_MARKS: string[] = [
  MARK_BULB, MARK_CHECK, MARK_CIRCLE_CHECK, MARK_CROSS, MARK_CIRCLE, MARK_CIRCLE_DASHED,
];

// ── 文字强调档 ────────────────────────────────────────────────────────────────
/** 常规字重（默认）。 */
export const EMPHASIS_NORMAL: string = 'normal';
/** 强调字重（待办 doing ⇒ `FontWeight.Medium`）。 */
export const EMPHASIS_MEDIUM: string = 'medium';
/** 全部强调档（测试用穷尽性）。 */
export const ALL_EMPHASIS: string[] = [EMPHASIS_NORMAL, EMPHASIS_MEDIUM];

// ── 本族补的文字层级角色（toolstatus 没有"文字层级"角色）────────────────────────
/** 一级正文（待办 pending/doing 的标签色）。 */
export const ROLE_PRIMARY: string = 'primary';
/** 次级文字（子代理 done/error/other 的标签色）。 */
export const ROLE_SECONDARY: string = 'secondary';
/** 全部角色（本族 role→色解析所需的穷尽集；测试据此核对无遗漏）。 */
export const ALL_ROLES: string[] = [
  ROLE_ACCENT, ROLE_DANGER, ROLE_SUCCESS, ROLE_MUTED, ROLE_PRIMARY, ROLE_SECONDARY,
];

/**
 * 一个状态档的**全部视觉语义**（由状态唯一决定）。
 *
 * ⚠️ 为什么竖条色与图标色要**分开两档**（`toneRole` vs `iconRole`）：子代理 `done` 是
 *    "竖条 = accent@30%（告知'这条已收束'）、图标 = muted（完成要安静）"——**同一状态、两种色**，
 *    合并成一个字段就会丢信息（改造前 `barColor()`/`iconColor()` 本就是两个判断）。
 */
export class StatusVisual {
  /** 形态档（组件据此选 glyph）。 */
  marker: string = MARK_BULB;
  /** **标记主色**角色：子代理 = 左侧 2px 竖条；待办 = 图标（= `iconRole`）。 */
  toneRole: string = ROLE_ACCENT;
  /** **图标**色角色（子代理卡片图标；待办与 `toneRole` 同值）。 */
  iconRole: string = ROLE_ACCENT;
  /** **标签文字**色角色。 */
  labelRole: string = ROLE_SECONDARY;
  /** 标记**不透明度**（1 = 实色；子代理 `done` 的 accent 竖条 = 0.3）。 */
  markerAlpha: number = 1;
  /** 文字强调档（`EMPHASIS_*`）。 */
  emphasis: string = EMPHASIS_NORMAL;
  /** 标签是否加**删除线**（待办 `done` ⇒ `line-through`）。 */
  struck: boolean = false;
}

/**
 * 子代理状态档（`core/subagent.ets:SUB_*`）⇒ 视觉语义（**唯一映射**）。
 *
 * 对齐 web `SubAgentProgressTree.tsx`：竖条 running/other→accent、done→accent@30%、error→`--destructive`
 * （`web :95-99`）；图标 running→Sparkles(accent) / done→Check(muted) / error→AlertCircle(destructive)
 * / 其它→Sparkles(muted)（`web :127-135`，原生按 AGENTS「无 sparkles」换 bulb）；
 * 标签 running→accent、其余→text-secondary（`web :138-151`）。
 */
export function subagentVisual(kind: string): StatusVisual {
  const v: StatusVisual = new StatusVisual();
  if (kind === SUB_DONE) {
    v.marker = MARK_CHECK;
    v.toneRole = ROLE_ACCENT;      // 竖条 accent…
    v.markerAlpha = 0.3;           // …@30%（web `accent 30%`）
    v.iconRole = ROLE_MUTED;       // 图标 muted（成功要安静）
    v.labelRole = ROLE_SECONDARY;
    return v;
  }
  if (kind === SUB_ERROR) {
    v.marker = MARK_CROSS;
    v.toneRole = ROLE_DANGER;      // 竖条 & 图标同走 statusError（web `--destructive`）
    v.iconRole = ROLE_DANGER;
    v.labelRole = ROLE_SECONDARY;
    return v;
  }
  // running / other：竖条 accent，图标 running 用 accent、其余 muted
  v.marker = MARK_BULB;
  v.toneRole = ROLE_ACCENT;
  v.iconRole = kind === SUB_RUNNING ? ROLE_ACCENT : ROLE_MUTED;
  v.labelRole = kind === SUB_RUNNING ? ROLE_ACCENT : ROLE_SECONDARY;
  return v;
}

/**
 * 待办状态档（`core/todos.ets:TODO_*`）⇒ 视觉语义（**唯一映射**）。
 *
 * 对齐 web `TodoPullOut.tsx`：图标 done→✓success / doing→◐accent / pending→○muted
 * （`web :239-243`）；标签 done→muted + 删除线、doing→medium、pending→正文
 * （`web :214-376`）。
 */
export function todoVisual(kind: string): StatusVisual {
  const v: StatusVisual = new StatusVisual();
  if (kind === TODO_DONE) {
    v.marker = MARK_CIRCLE_CHECK;
    v.toneRole = ROLE_SUCCESS;     // 图标 = success
    v.iconRole = ROLE_SUCCESS;
    v.labelRole = ROLE_MUTED;      // 完成 ⇒ 弱化
    v.struck = true;               // 删除线
    return v;
  }
  if (kind === TODO_DOING) {
    v.marker = MARK_CIRCLE_DASHED;
    v.toneRole = ROLE_ACCENT;
    v.iconRole = ROLE_ACCENT;
    v.labelRole = ROLE_PRIMARY;
    v.emphasis = EMPHASIS_MEDIUM;  // 进行中 ⇒ 加粗
    return v;
  }
  // pending（含未知值）：空心圆 + muted 图标 + 正文
  v.marker = MARK_CIRCLE;
  v.toneRole = ROLE_MUTED;
  v.iconRole = ROLE_MUTED;
  v.labelRole = ROLE_PRIMARY;
  return v;
}

/**
 * 角色 → 主题色值（本族**唯一**解析）。
 *
 * ⚠️ 与 `core/toolvisual.statusColorOf` 语义同源；差异**只有一处**：`danger` 取 `p.statusError`
 *    （web `--status-error`），而非 `dangerText`（"危险按钮文字"角色）—— 这是 `SubAgentTree`
 *    与 `ContextRing` 的既有观感（web `--destructive` = `--status-error`）。⛔ 别在这里顺手改成
 *    `dangerText`（那会改变观感，且与 `ContextRing.ets` 的注释矛盾）。
 * 未知角色 ⇒ `transparent`（不猜色；与 `design.colorOf` 的兜底同向）。
 */
export function roleColorOf(role: string, p: Palette): string {
  if (role === ROLE_ACCENT) { return p.accent; }
  if (role === ROLE_DANGER) { return p.statusError; }
  if (role === ROLE_SUCCESS) { return p.successText; }
  if (role === ROLE_MUTED) { return p.textMuted; }
  if (role === ROLE_PRIMARY) { return p.textPrimary; }
  if (role === ROLE_SECONDARY) { return p.textSecondary; }
  return p.transparent;
}
