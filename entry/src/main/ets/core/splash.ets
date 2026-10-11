/**
 * splash —— 开屏（splash）**阶段模型与判据**（纯逻辑，可脱机单测）。
 *
 * 真源规格：`docs/SPLASH-SPEC.md`（阶段模型 T0–T3 + 纯函数签名/真值表 + 时长台账）。
 * 样张：`docs/mockups/splash.html`。
 *
 * 为什么要有它：冷启动的"经历时间线"此前**没有任何应用内实现** ——
 * `EntryAbility.ets:53` 只 `loadContent('pages/Index')`，冷启动那一屏完全由
 * `module.json5:18-19` 的 `startWindowIcon/startWindowBackground` **静态**给出；
 * 之后直接跳到页面首帧。本模块把"什么时候显示什么、什么时候撤、什么时候才允许光球启动"
 * 收敛成**纯函数** ⇒ 可脱机单测、可 mutation、组件只消费（不自己写 if/else）。
 *
 * ⛔ 三条纪律：
 *   1. 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译
 *      ⇒ **禁止** import ArkUI / `@ohos.*` / `@kit.*`（无 `AnimateParam`/`Curve` 等）。
 *   2. **禁颜色字面量**：色值一律经 `core/theme` 的 `darkPalette()` 与 `core/brand` 的
 *      `brandAccent()`；本文件不出现 `#RRGGBB`。
 *   3. **禁自造时长**：所有时长都从 `core/motion` + `core/design` 的既有常量**派生**
 *      （下面每个常量都标了来源；零裸数字）。缺档清单见 `docs/SPLASH-SPEC.md §11`。
 *
 * ⛔ "在飞"铁律（`docs/DESIGN-SYSTEM.md §8`）：同一时刻**只允许一个在飞动效 = 光球**。
 *    开屏 T1/T2 是**一次性过渡**，不是"在飞"；光球与开屏是**揭示式交接**
 *    （光球若在流式，可在覆盖层**背后**先跑，由 T2 淡出**揭示**）—— 见 `docs/SPLASH-SPEC.md §9`。
 */
import { darkPalette } from './theme';
import {
  MOTION_BASE_MS, MOTION_SLOW_MS, MOTION_FAST_MS,
  MOTION_MIN_DWELL_MS, MOTION_SPLASH_TIMEOUT_MS, MOTION_ENTER_SCALE,
} from './motion';
import { EASE_SPRING_CSS, EASE_OUT_CSS } from './tokens';
import { SPACE_SM, SPACE_XXL } from './design';
import { MARK_LADDER_FULL } from './brand';

// ════════════════════════════════════════════════════════════════════════════
// 1. 标识（字符串常量 —— 与 `core/brand.ets: MARK_LADDER_*` / `AssistantOrb: ORB_MODE_*` 同法）
// ════════════════════════════════════════════════════════════════════════════

/** T0：系统开屏（`startWindow*`，**静态**、由系统绘制 ⇒ 不在本模块的时间线取值域内）。 */
export const SPLASH_T0: string = 'T0';
/** T1：应用内开屏 —— 品牌底 + 标记**入场**（一次性）。 */
export const SPLASH_T1: string = 'T1';
/** T2：标记**让位** + 首页内容淡入（一次性）。 */
export const SPLASH_T2: string = 'T2';
/** T3：交棒首页（光球**此时才**允许接管）。 */
export const SPLASH_T3: string = 'T3';

/** 冷启动（进程新建 ⇒ 有系统开屏 ⇒ 进 T1）。 */
export const LAUNCH_COLD: string = 'cold';
/** 热启动（进程活着、ability 再拉起 ⇒ **无**系统开屏 ⇒ 不进 T1）。 */
export const LAUNCH_WARM: string = 'warm';

/** 全部阶段（声明顺序 = 时间顺序；供测试遍历）。 */
export function splashPhases(): string[] {
  return [SPLASH_T0, SPLASH_T1, SPLASH_T2, SPLASH_T3];
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 时间常量 —— **全部由底座派生，零裸数字**（缺档见 `docs/SPLASH-SPEC.md §11`）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ 收敛说明（2026-10-11 动效「单一来源」）：`SPLASH_MIN_DWELL_MS` / `SPLASH_TIMEOUT_MS`
//    / `SPLASH_MARK_ENTER_SCALE` 已改为**引用底座真源**（`core/motion.ets` 的
//    `MOTION_MIN_DWELL_MS` / `MOTION_SPLASH_TIMEOUT_MS` / `MOTION_ENTER_SCALE`）——
//    本地名保留**只为兼容既有调用点**（`pages/Index.ets` / `SplashOverlay.ets`），⛔ 不再复制数值
//    （此前 3 处注释称"底座无此常量"，已过期；底座早已提升）。
//    `SPLASH_MARK_BOX_VP` 仍是底座**派生式**（`SPACE_XXL × SPLASH_MARK_BOX_MULT`）。

/** T1 时长 = `MOTION_BASE_MS`（220ms，`core/motion.ets:38`）⇒ `animBase()`。 */
export const SPLASH_ENTER_MS: number = MOTION_BASE_MS;
/** T2 时长 = `MOTION_SLOW_MS`（320ms，`core/motion.ets:45`）⇒ `animSlow()`。 */
export const SPLASH_EXIT_MS: number = MOTION_SLOW_MS;
/** T1+T2 总时长（默认档）= 540ms。 */
export const SPLASH_TOTAL_MS: number = SPLASH_ENTER_MS + SPLASH_EXIT_MS;
/**
 * **最短停留**（品牌不许"一闪而过"）= `MOTION_MIN_DWELL_MS` = 400ms。
 * ⛔ 真源 = `core/motion.ets:MOTION_MIN_DWELL_MS`（= `MOTION_BASE_MS + MOTION_FAST_MS`）；
 *    本名是**别名**（仅为兼容 `pages/Index.ets` / 测试的既有调用点），⛔ 不再复制数值。
 */
export const SPLASH_MIN_DWELL_MS: number = MOTION_MIN_DWELL_MS;
/**
 * **超时兜底**（宁可显示首帧，也不无限停在开屏）= `MOTION_SPLASH_TIMEOUT_MS` = 2560ms。
 * ⛔ 真源 = `core/motion.ets:MOTION_SPLASH_TIMEOUT_MS`（= `ORB_BREATH_MS`，在飞主呼吸 1×）；
 *    本名是**别名**，⛔ 不再复制数值。
 */
export const SPLASH_TIMEOUT_MS: number = MOTION_SPLASH_TIMEOUT_MS;
/**
 * **迟滞（免开屏窗口）** = `150ms`（**用户拍板 ≈150ms**）。
 *
 * ⚠️ **设计值**（无既有常量可派生 —— 同 `MOTION_ENTER_SCALE` 的处理方式；这是"策略阈值"，
 *   不是"动画时长"，故不进 `allowedDurations()`）。
 *
 * 语义（用户口径「尽可能快；加载慢就展示一下动画」）：
 *   自**应用启动**起算，若内容在**迟滞内**就绪 ⇒ **从 T0 系统开屏直接过渡到主界面，
 *   本开屏压根不出现**（快启动不因开屏多等一帧）；只有"迟滞已过仍未就绪"才让它出现
 *   （判定见 `shouldStartSplash`）。⇒ 迟滞是"要不要展示"的闸门；`minDwell` 是"一旦展示
 *   就保证动效不半截被切"的**下限**（两者语义不同，不可互相替代）。
 */
export const SPLASH_HYSTERESIS_MS: number = 150;

// ── 标记动效（**同语义、按元素变体**：标记 vs 光球各自具名，**不强行统一**）─────────
/**
 * 开屏**标记**的入场起始缩放 = `MOTION_ENTER_SCALE` = `0.92`（设计输入 `docs/REDESIGN-INPUT-BRAND.md:145`）。
 * ⚠️ 与光球专属的 `ORB_ENTER_SCALE = 0.86`（`components/AssistantOrb.ets:94`）是**两个**具名常量：
 *    裁决（本波）= **不强行统一**（强行合并会把"开屏标记"与"光球"的动效参数人为耦合）。
 * ⛔ 真源 = `core/motion.ets:MOTION_ENTER_SCALE`；本名是**别名**（仅为兼容既有调用点），⛔ 不再复制数值。
 */
export const SPLASH_MARK_ENTER_SCALE: number = MOTION_ENTER_SCALE;
/** 标记入场起始不透明度。 */
export const SPLASH_MARK_ENTER_OPACITY: number = 0;
/** 标记静止位不透明度（入场终点 / reduceMotion 下的即时值）。 */
export const SPLASH_MARK_SETTLED_OPACITY: number = 1;
/** 标记静止位缩放（入场终点）。 */
export const SPLASH_MARK_SETTLED_SCALE: number = 1;
/**
 * T2 **让位**时标记的**轻微上移**（vp，屏幕坐标取负）= `SPACE_SM` = **12vp**。
 *
 * 依据 `docs/SPLASH-SPEC.md §4.6`：T2 = "标记让位（`opacity 1→0`，**可 + 轻微上移**）"——
 * 只淡出会读作"整层被抠掉"；给一点**方向性**（向上"交棒"）才像"让位"。
 * 走向 `animEaseOut()`（**无超调**，见 `splashPhaseCurve(T2)===easeOut`）：让位不许"抖一下"。
 * ⛔ 量级刻意极小（12vp ≈ 标记盒 160vp 的 7.5%）—— 是"气息"，不是位移表演。
 * （2026-10-11 订正：此处曾写"8vp / 5%"，与 `SPACE_SM = SP_3 = 12` 不符；规格 §4.6 的 12vp/7.5% 才对。）
 */
export const SPLASH_MARK_EXIT_LIFT_VP: number = SPACE_SM;

/**
 * **跳过提示**延迟淡入的起点（ms）= `SPLASH_ENTER_MS`（= 220，标记入场结束）。
 *
 * 为什么需要：提示原先从**首帧**就满不透明度 ⇒ 第一眼看到的是"轻点跳过"、**品牌反而后到**
 * （标记 `opacity 0→1` 才入场）⇒ 顺序反了、也廉价。改为：先把**纯品牌**给足（入场时长），
 * 提示再**淡入**。⛔ 语义是"提示不抢品牌"，不是"提示出现得越晚越好"（太长会显得交互没反馈）。
 */
export const SPLASH_HINT_DELAY_MS: number = MOTION_BASE_MS;
/**
 * **跳过提示**淡入的**时长**（ms）= `MOTION_FAST_MS`（180）= 品牌**停驻窗**长度
 * （`SPLASH_MIN_DWELL_MS − SPLASH_HINT_DELAY_MS` = 400 − 220 = 180）。
 *
 * ── 为什么必须收进停驻窗（缺陷修复，`docs/SPLASH-SPEC.md §15 F2`）──────────────────
 *   渲染侧提示的不透明度**嵌在整层里**（`SplashOverlay.ets`：`.opacity(hintOpacity)` ⊂
 *   `.opacity(overlayOpacity)`）⇒ 用户真正看到的**有效 α = hintOpacity × overlayOpacity**。
 *   而整层退场**最早**由 `SPLASH_MIN_DWELL_MS`(400) 触发（生产锚点 = 两道闸门，见 §4.1/F1）
 *   ⇒ 若提示淡入窗 `[delay, delay+fade]` 跨过 400，提示就**永远到不了满显**（整层已在退场）：
 *     旧值 `delay=220 + fade=320` ⇒ 窗 `[220,540]`，**生产**有效 α 峰值仅 **0.8808**（永 < 1）。
 *   ⇒ 修法：把淡入**收进 `[0, SPLASH_MIN_DWELL_MS)` 内** —— `delay(220) + fade(180) = 400`
 *     ⇒ 提示恰在**退场开始的那一刻**达到满显（有效 α 峰值 = **1**），此后随整层一起淡出
 *     （物理正确：整层退场必须连提示一起淡）。
 *   ⛔ 不改 `MOTION_BASE_MS`/`MOTION_SLOW_MS`（T1/T2 时长）与弹簧/缓出曲线；⛔ 不把提示的
 *      opacity 从整层摘出。180 = `MOTION_FAST_MS`（底座唯一"快速"档），**零自造时长**。
 */
export const SPLASH_HINT_FADE_MS: number = MOTION_FAST_MS;
/** 跳过提示的**起始**不透明度（延迟窗内保持 0 ⇒ 不可见）。 */
export const SPLASH_HINT_ENTER_OPACITY: number = 0;

// ── 标记展示尺寸 ─────────────────────────────────────────────────────────────
/** 标记盒相对 `space.xxl` 的倍数（**布局档**，非动效时长）。 */
export const SPLASH_MARK_BOX_MULT: number = 5;
/**
 * 标记展示盒边长（vp）= `5 × space.xxl(32)` = **160vp**。
 * 缺档⑥：`spaceRoles()` 只到 `xxl=32`，无"开屏标记盒"档（建议提升为底座尺寸档）。
 */
export const SPLASH_MARK_BOX_VP: number = SPACE_XXL * SPLASH_MARK_BOX_MULT;

/** 判定标记档位时用的**参考边长**（vp）—— 开屏标记远大于 `MARK_MIN_GLYPH_VP`(24) ⇒ 不会退 wordmark。 */
export const SPLASH_MARK_REF_VP: number = SPLASH_MARK_BOX_VP;

// ════════════════════════════════════════════════════════════════════════════
// 2b. 每阶段用**哪条曲线** —— 入场允许超调；**让位/退出不许超调**（设计系统级约定）
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么必须区分（真实观感缺陷，不是洁癖）：
//   底座唯一的曲线是 **spring**（`cubic-bezier(0.34,1.56,0.64,1)`，**带超调**）。
//   超调用在**入场**（T1 标记进场）是对的 —— 有生气；
//   用在**让位/移交首页**（T2）却是错的 —— 元素冲过头再退回来，看着像"抖了一下"。
//   ⇒ **约定**：`enter`（进入视野）可用超调；`exit`（离开/移交）一律**无超调缓出**。
//   本约定把"用哪条曲线"变成**可测数据**（下方纯函数），mutation 可自证（把 T2 改回 spring ⇒ 必红）。
//
// ⚠️ 让位曲线的底座 token 已存在（`EASE_OUT_CSS`，`core/tokens.ets:68`，此前"已定义无消费者"）；
//    `orb-ux` 正在把它收成具名工厂 `animEaseOut()`（`components/anim.ets`，**本波不改该文件**）。
//    ⇒ T2 曲线 **TODO：待 `animEaseOut()` 就绪**（本模块的判据已先行钉死，工厂就绪后组件直接换）。

/** 曲线标识：**带超调**的 spring（= `animBase()` / `animSlow()`）。 */
export const SPLASH_CURVE_SPRING: string = 'spring';
/** 曲线标识：**无超调缓出**（= `EASE_OUT_CSS` / 待就绪的 `animEaseOut()`）。 */
export const SPLASH_CURVE_EASE_OUT: string = 'easeOut';
/** 无需本组件驱动的阶段（T0 由系统画；T3 = 已交棒）。 */
export const SPLASH_CURVE_NONE: string = '';

/**
 * 阶段 → 曲线（**唯一映射**）。
 * T1（入场）⇒ spring（**允许超调**）；T2（让位）⇒ ease-out（**不许超调**）；T0/T3 ⇒ 无。
 */
export function splashPhaseCurve(phase: string): string {
  if (phase === SPLASH_T1) {
    return SPLASH_CURVE_SPRING;
  }
  if (phase === SPLASH_T2) {
    return SPLASH_CURVE_EASE_OUT;
  }
  return SPLASH_CURVE_NONE;
}

/** 曲线标识 → 底座 CSS token（`core/tokens.ets:66/68`；`''` ⇒ 无曲线）。 */
export function curveCssOf(curve: string): string {
  if (curve === SPLASH_CURVE_SPRING) {
    return EASE_SPRING_CSS;
  }
  if (curve === SPLASH_CURVE_EASE_OUT) {
    return EASE_OUT_CSS;
  }
  return '';
}

/**
 * 曲线 CSS 是否**允许超调**（解析 `cubic-bezier(x1,y1,x2,y2)` 的两个 **y** 控制点；
 * 任一 `y > 1` ⇒ 会冲过终点 ⇒ 有超调）。非 `cubic-bezier` 形式按"无超调"处理（保守）。
 */
export function curveHasOvershoot(css: string): boolean {
  const i: number = css.indexOf('cubic-bezier(');
  if (i < 0) {
    return false;
  }
  const close: number = css.indexOf(')', i);
  const inner: string = css.substring(i + 'cubic-bezier('.length, close < 0 ? css.length : close);
  const parts: string[] = inner.split(',');
  if (parts.length !== 4) {
    return false;
  }
  const y1: number = Number.parseFloat(parts[1]);
  const y2: number = Number.parseFloat(parts[3]);
  if (Number.isNaN(y1) || Number.isNaN(y2)) {
    return false;
  }
  return y1 > 1 || y2 > 1;
}

// ── 2c. `cubic-bezier` 的**离线求值**（纯数值；供 T2 让位轨迹判据）──────────────────────
//
// ⛔ 为什么在 core 里自己算：`core/` 禁 import 曲线库 / ArkUI 类型（见文件头纪律 1），
//    但"T1→T3 是不是渐隐"必须**可脱机判**。⇒ 只解析同一个 CSS token（与渲染同源，非新造曲线），
//    用**二分法**求值（确定性、无 Newton 边界问题）。这不是"新曲线"—— 控制点全来自 `core/tokens.ets`。

/** 三次贝塞尔某一轴在参数 `u` 处的值（端点固定为 0/1）：`3(1-u)²u·a1 + 3(1-u)u²·a2 + u³`。 */
function bezierAxis(a1: number, a2: number, u: number): number {
  const m: number = 1 - u;
  return 3 * m * m * u * a1 + 3 * m * u * u * a2 + u * u * u;
}

/** 解析 `cubic-bezier(x1,y1,x2,y2)` → `[x1,y1,x2,y2]`；非法 ⇒ 线性 `[0,0,1,1]`（进度 = 时间比例）。 */
function parseBezier(css: string): number[] {
  const linear: number[] = [0, 0, 1, 1];
  const i: number = css.indexOf('cubic-bezier(');
  if (i < 0) {
    return linear;
  }
  const close: number = css.indexOf(')', i);
  const inner: string = css.substring(i + 'cubic-bezier('.length, close < 0 ? css.length : close);
  const parts: string[] = inner.split(',');
  if (parts.length !== 4) {
    return linear;
  }
  const out: number[] = [];
  for (let k: number = 0; k < 4; k++) {
    const v: number = Number.parseFloat(parts[k]);
    if (Number.isNaN(v)) {
      return linear;
    }
    out.push(v);
  }
  return out;
}

/** 二分迭代次数（24 次 ⇒ 参数误差 < 2⁻²⁴ ≈ 6e-8，远超观感/判据需要；确定性、无自造曲线）。 */
const SPLASH_BEZIER_SOLVE_ITERS: number = 24;

/**
 * `cubic-bezier` 的**归一化进度** `y(x)`（`x` = 归一化时间 ∈ `[0,1]`）——
 * 解析 CSS 控制点 → 二分解 `x(u)=x` → 取 `y(u)`。`x` 越界会被夹到 `[0,1]`。
 */
export function curveProgressAt(css: string, x: number): number {
  const c: number[] = parseBezier(css);
  const tx: number = !(x > 0) ? 0 : (x > 1 ? 1 : x);
  let lo: number = 0;
  let hi: number = 1;
  let u: number = tx;
  for (let k: number = 0; k < SPLASH_BEZIER_SOLVE_ITERS; k++) {
    const xu: number = bezierAxis(c[0], c[2], u);
    if (xu < tx) {
      lo = u;
    } else {
      hi = u;
    }
    u = (lo + hi) / 2;
  }
  return bezierAxis(c[1], c[3], u);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 判据（纯函数 —— 真值表见 `docs/SPLASH-SPEC.md §4`）
// ════════════════════════════════════════════════════════════════════════════

/** 毫秒入参净化：`NaN` / 负值 ⇒ `0`（防御，**不抛**）。 */
function sanitizeMs(v: number): number {
  if (!(v > 0)) {
    return 0;
  }
  return v;
}

/**
 * ① 阶段推进：`elapsedMs` 自**应用内开屏挂载**起算（`0` ⇒ T1 起点；T0 不在取值域）。
 *
 * 默认档（`reduceMotion=false`，`[` 左闭右开）：
 *   `[0, 220)` ⇒ T1 ｜ `[220, 540)` ⇒ T2 ｜ `[540, ∞)` ⇒ T3
 * `reduceMotion=true`（**只降动效、不降可达性**）：T2 收起为 0 ⇒
 *   `[0, 400)` ⇒ T1（**静态**）｜ `[400, ∞)` ⇒ T3
 * `userDismissed=true`（用户中途点/滑）⇒ **立即 T3**（跳表；只允许一次，不回退）。
 */
export function splashPhaseAt(elapsedMs: number, reduceMotion: boolean, userDismissed: boolean = false): string {
  if (userDismissed) {
    return SPLASH_T3;
  }
  const t: number = sanitizeMs(elapsedMs);
  if (reduceMotion) {
    return t >= SPLASH_MIN_DWELL_MS ? SPLASH_T3 : SPLASH_T1;
  }
  if (t >= SPLASH_TOTAL_MS) {
    return SPLASH_T3;
  }
  if (t >= SPLASH_ENTER_MS) {
    return SPLASH_T2;
  }
  return SPLASH_T1;
}

/** 阶段起点的绝对毫秒（供页面定时器 / 测试；`reduceMotion` 下 T2 收起、T3 提前）。 */
export function splashPhaseStartMs(phase: string, reduceMotion: boolean): number {
  if (phase === SPLASH_T1) {
    return 0;
  }
  if (phase === SPLASH_T2) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_ENTER_MS;
  }
  if (phase === SPLASH_T3) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_TOTAL_MS;
  }
  return 0;
}

/** 该阶段时长（默认档；`reduceMotion` 下 T2 = 0 ⇒ 跳切）。 */
export function splashPhaseDurationMs(phase: string, reduceMotion: boolean): number {
  if (phase === SPLASH_T1) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_ENTER_MS;
  }
  if (phase === SPLASH_T2) {
    return reduceMotion ? 0 : SPLASH_EXIT_MS;
  }
  return 0;
}

/**
 * ② 开屏 overlay 是否仍应可见。
 *
 * 判据：`launchKind == cold` **且**（`t < minDwell` **或** 内容未就绪）**且** `t < timeout`；
 * `userDismissed=true` ⇒ **false**（用户不想等）。
 */
export function shouldShowSplash(launchKind: string, elapsedMs: number, contentReady: boolean,
  userDismissed: boolean = false): boolean {
  if (launchKind !== LAUNCH_COLD) {
    return false;
  }
  if (userDismissed) {
    return false;
  }
  const t: number = sanitizeMs(elapsedMs);
  if (t >= SPLASH_TIMEOUT_MS) {
    return false;
  }
  if (t < SPLASH_MIN_DWELL_MS) {
    return true;
  }
  return !contentReady;
}

/**
 * ②b **迟滞闸门：是否应当"让应用内开屏出现"**（自**应用启动**起算的 `elapsedMs`）。
 *
 * 与 `shouldShowSplash` 的分工（**用户口径「尽可能快；加载慢才播动画」**）：
 *   · 本函数答"**要不要展示**" —— 只在**迟滞到点**评估一次；
 *   · `shouldShowSplash` 答"**一旦展示了，这一帧还在不在**" —— `elapsedMs` 自**展示**起算。
 *
 * 真值：非 `cold`（热启动）⇒ `false`；`contentReady`（迟滞内已就绪）⇒ `false`
 *      ⇒ **从 T0 系统开屏直接过渡到主界面，开屏不出现**；迟滞未到 ⇒ `false`（观察窗内）；
 *      其余（迟滞已过且仍未就绪）⇒ `true` ⇒ 展示，并**完整播完**。
 */
export function shouldStartSplash(launchKind: string, elapsedMs: number, contentReady: boolean): boolean {
  if (launchKind !== LAUNCH_COLD) {
    return false;
  }
  if (contentReady) {
    return false;
  }
  return sanitizeMs(elapsedMs) >= SPLASH_HYSTERESIS_MS;
}

/**
 * ③ 品牌开屏画布（**恒定**，方案 (a)「品牌开屏恒深」—— 2026-10-11 真机缺陷修复）。
 *
 * ── 为什么**不读 theme**（真机证据 2026-10-11，逐帧可查）─────────────────────────
 *   旧实现 `splashCanvasOf(theme, followApplication=true, …)` = `paletteOf(theme).appBg`，
 *   而画布绑在 `SplashOverlay` 的 `@Prop theme`（← `pages/Index.ets` 的 `this.themeName`）上 ——
 *   `themeName` 的**初值是字面量 `'dark'`**（`pages/Index.ets:600`），服务端 settings 到达后才被
 *   `normalizeTheme` 覆盖（`pages/Index.ets:1392-1394`）⇒ 浅色主题用户在**同一段开屏展示期间**
 *   看到画布从 `#0B0B0E` 翻成白 —— 且 T0 系统开屏**恒**为 `#0B0B0E`
 *   （`base`/`dark` 两处 `start_window_background` 同值；`FOLLOW_APPLICATION` 真机不生效，
 *    见 `docs/BRAND.md §12.1`）⇒ 取主题色**必然**引入跳变（无论起始值如何）。
 *
 * ⇒ **判据 = 品牌开屏恒深**：画布 = `darkPalette().appBg`，与 T0 **逐字节同色** ⇒ T0→T1 **零跳色**；
 *   T1→T3 由既有的 T2 淡出（`animEaseOut()`，零超调）过渡到应用主题（**是渐隐，不是硬切**）。
 * ⛔ 本函数**无 theme 入参** —— "T1 期间画布不随主题变化"是**结构性保证**（机器判据见
 *   `tools/tests/splash.test.ts §①`：本函数值恒定 + `SplashOverlay` 源码不含 `this.theme`）。
 */
export function splashBrandCanvas(): string {
  return darkPalette().appBg;
}

/**
 * ④ 品牌开屏标记档位 —— **恒 `full`**（"满幅品牌色 + 反色 glyph" = 预生成的品牌紫 PNG
 * `$r('app.media.start_icon')`，由 `tools/brand/emit.js` 用 `brandAccent()` 生成）。
 *
 * 依据（2026-10-11 裁决）：T1 品牌开屏**恒深、恒品牌**（方案 (a)）⇒ 原先那两条降级路在开屏
 * **永不可达**：组件恒传 `monochrome=false`、`size = SPLASH_MARK_BOX_VP(160) ≫ MARK_MIN_GLYPH_VP(24)`
 * ⇒ `OUTLINE` / `WORDMARK` 是**死码**，**已删**（不留死分支）。
 * ⛔ **本函数不是"通用降级链"**：`core/brand.ets: markLevelFor(BrandSurface)` 仍是通用判据
 *    （服务**其它**消费者，如通知小图标选资产）；本函数只表达"开屏标记恒 full"这一条既定设计
 *    —— logo 是品牌资产、⛔ 不随主题/强调色/单色变（`docs/DESIGN-SYSTEM.md §13.6`）。
 * ⛔ 无入参（既不读 theme，也不读 size/monochrome）—— 判据：`tools/tests/splash.test.ts §②`。
 */
export function splashBrandMarkLevel(): string {
  return MARK_LADDER_FULL;
}

// ⑤ **已废止**（2026-10-11 §15 F3 裁决）：曾经的 `splashOrbAllowed(phase, streaming)`
//    （"T1/T2 光球不得启动"铁律的机器判据）在生产 **0 消费点**（只被测试引用），且与**实际实现**冲突
//    —— 实际是**揭示式交接**（光球若在流式，已在覆盖层**背后**渲染，由 T2 淡出揭示）。
//    ⇒ **删除**（⛔ 不留"看似铁律、实则 0 消费"的死判据）。交接不变量改由
//    `tools/tests/handoff_motion.test.ts`（退隐非飞走 / 不重播光球 / 退场 ≥ 入场）守护；
//    `tools/tests/splash_continuity.test.ts` ★C 有一条"本符号不得复活"的守卫。

/** 开屏任一阶段是否**属于**"在飞"（**恒 false** —— 把铁律写成可断言的形式）。 */
export function splashPhaseIsInFlight(phase: string): boolean {
  return false;
}

/**
 * ⑥ T2 **让位的「整层不透明度」轨迹**（纯函数）—— **T1(品牌底) → T3(应用主题) 过渡的机器判据**。
 *
 * ── 口径**全部派生自底座**（⛔ 零自造）───────────────────────────────────────────
 *   · 时长 = `SPLASH_EXIT_MS`（= `MOTION_SLOW_MS` = 320，`core/motion.ets:45`）；
 *   · 曲线 = `EASE_OUT_CSS`（`core/tokens.ets:68` = `cubic-bezier(0,0,0.2,1)`）——
 *     与渲染侧 `components/anim.ets:104 animEaseOut()` **同一 token**（`SplashOverlay.ets:141`）。
 *
 * ── 观感模型（为什么这几条性质就是"渐隐 / 无硬切 / 无白闪"）──────────────────────
 *   渲染侧把 `overlayOpacity` 绑在**整层** `Stack`（`SplashOverlay.ets:204 .opacity(...)`），
 *   T2 由 1 → 0 ⇒ 品牌底以**均匀 α** 叠在应用页面上 ⇒ 合成色 = `α·品牌底 + (1-α)·应用底`。
 *     · **值域 [0,1]**（ease-out 无超调 ⇒ α 不越界）⇒ 合成色**永不亮于目的地** ⇒ **无"白闪一帧"**；
 *     · **单调不增** ⇒ 一致地朝目的地走（不来回抖）；
 *     · **存在中间态**（α ∈ (0,1)）⇒ 是**渐隐**，不是硬切；中间态是**灰**（品牌底⊕应用底），
 *       ⛔ **不是"半透明白"**（整层是同一 α，没有"白色蒙层"这一层）。
 *   `reduceMotion` ⇒ 即时 0（T2 收起 ⇒ 硬切）—— 这是"只降动效"的**既有裁决**
 *   （`docs/SPLASH-SPEC.md §5`），⛔ 不属本条"渐隐"要求的范围。
 *
 * ⛔ 组件**不能**消费它来"逐帧设值"（`animateTo` 由 ArkUI 驱动中间帧）—— 本函数是那条动画的
 *   **离线模型**，供判据/mutation 钉住"形状"。同源靠**同一 token**（时长 + 曲线），非靠调用。
 */
export function splashExitOpacityAt(elapsedMsMs: number, reduceMotion: boolean): number {
  if (reduceMotion) {
    return 0;
  }
  const t: number = sanitizeMs(elapsedMsMs);
  if (t >= SPLASH_EXIT_MS) {
    return 0;
  }
  return 1 - curveProgressAt(EASE_OUT_CSS, t / SPLASH_EXIT_MS);
}
