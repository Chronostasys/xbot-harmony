/**
 * 动效底座（**纯数值 / 纯函数**）—— "苹果味"三件套之①：弹簧。
 *
 * 分层原因（铁律）：本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译
 * ⇒ **禁止** import `@ohos.curves` 或任何 ArkUI 全局类型（`AnimateParam`/`ICurve`/`Curve`）。
 * 所以这里只放"可脱机单测"的数值与纯函数；把参数**变成** ArkUI 动画对象的活由
 * `components/anim.ets` 干（那一层才 import `@ohos.curves`）。
 *
 * ── 与 `core/tokens.ets` 的关系（不要删旧常量）───────────────────────────────
 * tokens.ets 已定义 `EASE_SPRING_*`（曲线控制点 + springMotion 三参），且被
 * `tools/tests/theme_tokens.test.ts` 引用 ⇒ **保留不删**。本模块**引用**它们（不复制数值），
 * 再补上 web 的时长族与"可比较结构"的纯函数，作为界面层统一入口（`components/anim.ets`）。
 *
 * ── 对齐来源（web = 权威基准）────────────────────────────────────────────────
 *   · 过渡 spring 曲线 `cubic-bezier(0.34, 1.56, 0.64, 1)`，180ms —— `web/src/index.css:690-692`
 *   · 入场 `sectionIn` 220ms 同曲线 —— `web/src/index.css:669`
 *   · 入场 `msgIn`   200ms 同曲线 —— `web/src/index.css:684`
 *   · 抽屉/大块 320ms —— 见下方 MOTION_SLOW_MS 注释（web 无逐值，取 tokens.D_SLOW）
 */

// spring 曲线控制点 + springMotion 三参：**引用 tokens.ets 的既有常量，不复制**。
import {
  D_FAST, D_SLOW, SP_8,
  EASE_SPRING_CSS,
  EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y,
  EASE_SPRING_RESPONSE, EASE_SPRING_DAMPING, EASE_SPRING_OVERLAP,
} from './tokens';
// 开屏「超时兜底」= 在飞主呼吸 1×（`core/orb.ets` 只 import `./tokens` ⇒ **不成环**）。
import { ORB_BREATH_MS } from './orb';

// ── 时长族（ms）───────────────────────────────────────────────────────────────
/** 过渡/hover/状态切换：web `.transition-spring` 180ms（`index.css:690`）。= tokens.D_FAST。 */
export const MOTION_FAST_MS: number = D_FAST; // 180
/**
 * 章节/大块入场：web `sectionIn` 220ms（`index.css:669`）。
 * ⚠️ 与 tokens.`D_BASE`（=240，"常规入场"）**故意不同**：本族以 web 实际 keyframe 为准。
 */
export const MOTION_BASE_MS: number = 220;
/** 消息行入场：web `msgIn` 200ms（`index.css:684`）。 */
export const MOTION_MSG_IN_MS: number = 200;
/**
 * 抽屉/大块：web 无逐值（Sheet 300~500ms 区间），取 tokens.`D_SLOW`=320 保持既有设计口径。
 * = tokens.D_SLOW。
 */
export const MOTION_SLOW_MS: number = D_SLOW; // 320

// ── 曲线 ──────────────────────────────────────────────────────────────────────
/** web 统一 spring 过渡的 CSS 文本（= tokens.EASE_SPRING_CSS）。 */
export const MOTION_SPRING_CSS: string = EASE_SPRING_CSS;

/**
 * 把 spring 参数映射成**可比较的结构**（ArkTS 禁 untyped obj literal ⇒ 用 class）。
 * 纯数据，无副作用；供单测/日志/调试逐字段比对。
 */
export class BezierPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  constructor(x1: number, y1: number, x2: number, y2: number) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }
}

/**
 * springMotion 三参（**秒**）—— 纯数据。
 *   · response：一次完整弹跳的响应时长（秒）；
 *   · dampingFraction：阻尼比（<1 ⇒ 有 overshoot，才有"苹果回弹"）；1=临界阻尼。
 *   · overlapDuration：动画叠加时长（秒，0=不叠加）。
 */
export class SpringParams {
  response: number;
  dampingFraction: number;
  overlapDuration: number;
  constructor(response: number, dampingFraction: number, overlapDuration: number) {
    this.response = response;
    this.dampingFraction = dampingFraction;
    this.overlapDuration = overlapDuration;
  }
}

/** 一致性问题清单（纯函数）—— 给自检/单测用，空数组=全部合法。 */
export class MotionIssue {
  field: string;
  reason: string;
  constructor(field: string, reason: string) {
    this.field = field;
    this.reason = reason;
  }
}

/** spring 贝塞尔控制点（对齐 web `cubic-bezier(0.34,1.56,0.64,1)`）。 */
export function springBezier(): BezierPoints {
  return new BezierPoints(
    EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y);
}

/** springMotion 三参对象（供 `components/anim.ets` 构造 `curves.springMotion(...)`）。 */
export function springParams(): SpringParams {
  return new SpringParams(EASE_SPRING_RESPONSE, EASE_SPRING_DAMPING, EASE_SPRING_OVERLAP);
}

/** 时长族对象（快速取用；顺序 fast/base/slow）。 */
export class Durations {
  fastMs: number;
  baseMs: number;
  slowMs: number;
  constructor(fastMs: number, baseMs: number, slowMs: number) {
    this.fastMs = fastMs;
    this.baseMs = baseMs;
    this.slowMs = slowMs;
  }
}

/** 时长族（fast=180 / base=220 / slow=320）。 */
export function durations(): Durations {
  return new Durations(MOTION_FAST_MS, MOTION_BASE_MS, MOTION_SLOW_MS);
}

// ── 开屏 / 冷启动（brand-impl 交付时**以派生式先行**，本波按裁决**收进底座**；⛔ 零裸数字）──────
/**
 * 开屏「**最短停留**」= `MOTION_BASE_MS + MOTION_FAST_MS` = 220 + 180 = **400ms**。
 *
 * ⚠️ **语义是"一段 hold"，不是"动画时长"** ⇒ **不进** `allowedDurations()` —— 那个集合管的是
 *   "过渡/关键帧的动画时长"（`design.ets:motionRoles` 的取值域）；本值是把两档动画时长**相加**
 *   得到的**停留策略**，进集合反而会把它变成"合法动画时长"，稀释档位口径。
 */
export const MOTION_MIN_DWELL_MS: number = MOTION_BASE_MS + MOTION_FAST_MS;
/**
 * 开屏「**超时兜底**」= 在飞主呼吸 1× = `ORB_BREATH_MS` = **2560ms**
 * （宁可显示首帧，也不无限停在开屏）。
 */
export const MOTION_SPLASH_TIMEOUT_MS: number = ORB_BREATH_MS;
/**
 * 开屏**标记入场起点缩放**（`scale 0.92 → 1`）—— 设计输入 `docs/REDESIGN-INPUT-BRAND.md:145`。
 * ⚠️ 这是**设计值**（无既有常量可派生）；⛔ **不**与光球专属的 `ORB_ENTER_SCALE(0.86)` 合并（裁决）。
 */
export const MOTION_ENTER_SCALE: number = 0.92;
/**
 * 开屏**标记展示尺寸**（vp）= `SPACE_XXL × 5` = 32 × 5 = **160**。
 * ⚠️ 用 `tokens.SP_8`（=32，`SPACE_XXL` 的**源**）而**非** `design.SPACE_XXL`：`core/design.ets`
 *   **import 了本文件**（`design.ets:37`），反引会**成环**（顶层读到 undefined ⇒ NaN）。
 *   `design.spaceRoles()` 最高档即 `xxl = SP_8 = 32`。
 */
export const MOTION_SPLASH_MARK_VP: number = SP_8 * 5;

/**
 * 面板/弹层**滑入位移**（vp）= **260** —— `components/anim.ets: sheetTransition()` 的
 * `TransitionEffect.translate({ y })`（进/出场的起始偏移）。
 *
 * ⚠️ **设计值**（无既有常量可派生 —— 同 `MOTION_ENTER_SCALE` / `SPLASH_HYSTERESIS_MS` 的处理）；
 *    它**不是**动画时长 ⇒ **不进** `allowedDurations()`（口径同 `MOTION_MIN_DWELL_MS`）。
 * 语义：弹层自屏幕下方**滑入**的距离。取整屏高度量级的一小段（≈ 面板自身高度档）——
 *   过大 ⇒ 读作"从很远处飘来"（拖沓）；过小 ⇒ 读作"原地淡入"（丢失"抽屉"的方向感）。
 * ⛔ 收进底座**唯一出口**：此前它是 `anim.ets` 里的裸字面量 `y: 260`（E3 审计的"就地字面量"项），
 *    判据 = `tools/tests/motion_uniform.test.ts`（`translate({ y: <数字> })` 一律判红）。
 */
export const MOTION_SHEET_SLIDE_VP: number = 260;

/**
 * **侧栏抽屉**（左侧滑出）的横向入场位移（vp）。
 *
 * ⛔ 为什么单开一个 token（而不是复用 `MOTION_SHEET_SLIDE_VP`）：
 *   · 后者是**纵向**档（面板自下而上），抽屉是**横向**语义 —— 轴不同、读法不同
 *     （同 `lightboxTransition` 不复用 sheet 的理由：语义不对）；
 *   · 值取 `88% × 屏宽` 量级的保守整档（抽屉实宽 = `88%`，见 `DrawerSheet` 的 `.width('88%')`）
 *     ⇒ 起始位置在屏外左侧，滑动全程可见、无"跳一下"。
 *   ⛔ 位移**只许**从这里取：`tools/tests/motion_uniform.test.ts` 规则 F 把任何
 *     `translate({ x|y: <数字> })` 字面量判红。
 */
export const MOTION_DRAWER_SLIDE_VP: number = 340;

/**
 * ⛔ **未采纳**（见 `components/anim.ets` 同名注释）：popup 类**不是**用 `sheetTransition()` 的
 * （`TodoPanel`/`MessageNav` 是 `.animation(animFast())`；`ToolPopover`/`ContextRing` 系统绘制）
 * ⇒ 不新增 `MOTION_POPUP_ENTER_SCALE`（零消费者 = 死常量）。
 */

/**
 * 图片 lightbox（全屏浮层）的**入场缩放起点** = **0.96**（`1 → 0.96` 的"收一下再展开"）。
 * ⚠️ **设计值**（无既有常量可派生 —— 同 `MOTION_ENTER_SCALE` / `MOTION_SHEET_SLIDE_VP` 的处理）。
 * 为什么不用 `sheetTransition()`：lightbox 是**全屏**浮层 ⇒ 从下滑入读作"抽屉"，语义不对；
 * 用**轻微缩放 + 淡入**表达"浮层弹起"。⛔ 不是动画时长 ⇒ 不进 `allowedDurations()`。
 */
export const MOTION_LIGHTBOX_ENTER_SCALE: number = 0.96;

/** 数值区间校验（纯函数）：`lo <= x <= hi`。 */
export function inRange(x: number, lo: number, hi: number): boolean {
  return typeof x === 'number' && x === x && x >= lo && x <= hi;
}

// ── 「苹果式」物理规格（2026-10-12 目标⑤◆）—— 把"回弹 / 收尾 / 时长"变成**可断言的物理量** ────
// 为什么落在这一层：本文件是动效**唯一真源**；规格若只写在文档里，下一次调数值就会**静默失效**
// （本仓"死消费 / 判据盲区"血债）。⇒ 物理不变量必须由 `motionIssues()` **机器断言**。
// 依据 = **公开的物理直觉**（二阶阻尼振子的峰值超调公式 / 人对位移·淡入的时长感知），
// ⛔ 未复制任何专有资源：
//   · 峰值超调 `overshoot = exp(-π·ζ/√(1-ζ²))`（ζ = 阻尼比）⇒ ζ 越接近 1 越"干净"；ζ=1 临界阻尼无回弹；
//   · 入场要**有生气但克制**：超调 ∈ (0, 15%] ⇒ ζ ≳ 0.52（当前曲线实测 ≈ 9.7% ⇒ 等效 ζ ≈ 0.60）；
//   · 曲线**末端不得再起浪**（`y2 ≤ 1`）—— 收尾"冲过头再退回来"读作抖（同 `animEaseOut` 一族的口径）；
//   · 单次过渡 **> ~600ms 读作拖沓**（几百 ms 内完成的位移/淡入才读作"即时"）。
/** 入场/过渡贝塞尔的**峰值超调上界**（无量纲）：≤ 15% ⇒ ζ ≳ 0.52 ——「有回弹但干净」。 */
export const MOTION_OVERSHOOT_MAX: number = 0.15;
/** 单次过渡/入场的**时长上界**（ms）：> 600 读作拖沓（同步动画的感知阈值远小于此）。 */
export const MOTION_DURATION_MAX_MS: number = 600;

/** 三次贝塞尔 `y(t)`（纯数值；控制点 (x1,y1)/(x2,y2)、端点 (0,0)/(1,1) 的 y 分量）。 */
export function bezierY(y1: number, y2: number, t: number): number {
  const u: number = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

/**
 * 贝塞尔的**峰值超调**（`max y − 1`，下界夹 0）—— 纯采样、纯函数、可脱机单测。
 * 把"回弹有多冲"变成**可比较的数**（当前曲线实测 ≈ 0.0970 ⇒ 等效 ζ ≈ 0.60）。
 * ⚠️ 只在自检/单测里调用（**不在每帧路径**上）；1001 次采样是 O(1) 级开销。
 */
export function peakOvershoot(y1: number, y2: number): number {
  let peak: number = 0;
  for (let i = 0; i <= 1000; i++) {
    const y: number = bezierY(y1, y2, i / 1000);
    if (y > peak) { peak = y; }
  }
  const over: number = peak - 1;
  return over > 0 ? over : 0;
}

/** `springBezier()` 的峰值超调（= `peakOvershoot(b.y1, b.y2)`）。 */
export function springPeakOvershoot(): number {
  const b: BezierPoints = springBezier();
  return peakOvershoot(b.y1, b.y2);
}

/**
 * 超调 → **等效阻尼比 ζ**（`overshoot = exp(-π·ζ/√(1-ζ²))` 的解析反解）。
 * 用途：把曲线读成物理量（当前 ≈ 0.595 ⇒ "略带回弹、收得住"），供规格文档/单测复算。
 * 推导：`ln(1/overshoot) = π·ζ/√(1-ζ²)` ⇒ 令 `k = ln(1/overshoot)/π` ⇒ `ζ = k/√(1+k²)`。
 * `overshoot ≤ 0` ⇒ 返回 1（临界阻尼，无回弹）。
 */
export function dampingFromOvershoot(overshoot: number): number {
  if (!(overshoot > 0)) { return 1; }
  const k: number = Math.log(1 / overshoot) / Math.PI; // = ζ/√(1-ζ²)
  const k2: number = k * k;
  return Math.sqrt(k2 / (1 + k2));
}

/**
 * **曲线侧的物理判定**（参数化纯函数）—— 给自检/单测逐项判"是否物理上说得通"；空数组 = 合格。
 * ⛔ 刻意**参数化**（而非直接读模块常量）：判据必须能**注入坏样本自证判别力**（mutation）——
 *    `bezierIssues(0.34, 3.0, 0.64, 1.0, MOTION_OVERSHOOT_MAX)` 必非空。
 */
export function bezierIssues(x1: number, y1: number, x2: number, y2: number, overshootMax: number): MotionIssue[] {
  const out: MotionIssue[] = [];
  if (!inRange(x1, 0, 1)) { out.push(new MotionIssue('bezier.x1', '需 ∈ [0,1]')); }
  if (!inRange(x2, 0, 1)) { out.push(new MotionIssue('bezier.x2', '需 ∈ [0,1]')); }
  if (!(y1 > 1)) { out.push(new MotionIssue('bezier.y1', '需 > 1（入场须有 spring 回弹）')); }
  if (!(y1 <= 2)) { out.push(new MotionIssue('bezier.y1', '需 ≤ 2（回弹有界 ⇒ 不是乱弹）')); }
  if (!(y2 <= 1)) { out.push(new MotionIssue('bezier.y2', '需 ≤ 1（末端不得再起浪 ⇒ 干净收尾）')); }
  if (!(peakOvershoot(y1, y2) <= overshootMax)) { out.push(new MotionIssue('bezier.overshoot', '峰值超调超上界')); }
  return out;
}

/**
 * 自检（纯函数）：返回所有不合法项；空数组 ⇒ 参数自洽。
 * 判据（与 web 口径 / **物理意义**一致）：
 *   · 时长严格递增且为正，且单次过渡 ≤ `MOTION_DURATION_MAX_MS`；
 *   · 行入场（msgIn）不快于块入场（base）—— 更小的对象用更短的时长；
 *   · 贝塞尔 x∈[0,1]（SDK 只接受 [0,1]，超界会被夹到 0/1 —— `@ohos.curves.d.ts:256-260`）；
 *   · 贝塞尔**物理规格**（回弹有界 / 末端不起浪 / 峰值超调 ≤ `MOTION_OVERSHOOT_MAX`）—— 见 `bezierIssues`；
 *   · spring response>0、0<damping<1（有回弹）、overlap≥0。
 */
export function motionIssues(): MotionIssue[] {
  const out: MotionIssue[] = [];
  if (!(MOTION_FAST_MS > 0)) { out.push(new MotionIssue('MOTION_FAST_MS', '需 > 0')); }
  if (!(MOTION_BASE_MS > MOTION_FAST_MS)) { out.push(new MotionIssue('MOTION_BASE_MS', '需 > fast')); }
  if (!(MOTION_SLOW_MS > MOTION_BASE_MS)) { out.push(new MotionIssue('MOTION_SLOW_MS', '需 > base')); }
  if (!(MOTION_SLOW_MS <= MOTION_DURATION_MAX_MS)) { out.push(new MotionIssue('MOTION_SLOW_MS', '单次过渡需 ≤ 时长上界（更久读作拖沓）')); }
  if (!(MOTION_MSG_IN_MS <= MOTION_BASE_MS)) { out.push(new MotionIssue('MOTION_MSG_IN_MS', '行入场应 ≤ 块入场（更小的对象用更短的时长）')); }
  const b: BezierPoints = springBezier();
  const bi: MotionIssue[] = bezierIssues(b.x1, b.y1, b.x2, b.y2, MOTION_OVERSHOOT_MAX);
  for (let i = 0; i < bi.length; i++) { out.push(bi[i]); }
  const s = springParams();
  if (!(s.response > 0)) { out.push(new MotionIssue('spring.response', '需 > 0')); }
  if (!(s.dampingFraction > 0 && s.dampingFraction < 1)) { out.push(new MotionIssue('spring.dampingFraction', '需 ∈ (0,1) 才有回弹')); }
  if (!(s.overlapDuration >= 0)) { out.push(new MotionIssue('spring.overlapDuration', '需 ≥ 0')); }
  return out;
}

// ── 「真实信号 → 动势」—— 波5j：让在飞指示器由**内容实际前进速率**驱动 ─────────────
//
// 为什么放在这一层：动势映射必须是**可脱机单测的纯函数**（值域/单调/饱和/边界），
// 组件只负责"每帧把两个采样量喂进来"。这样"它是不是在真干活"这件事有**唯一的判据**，
// 而不是散在组件里的魔法系数。
//
// 输入信号：`deltaUnits`（自上一帧起"内容"前进了多少单位 —— 本仓 = 正文+思考的
// 码点长度和的增量）+ `dtMs`（实际帧间隔）。输出 = 速率（单位/毫秒）。

/**
 * 速率→动势的**半饱和点**（单位/毫秒）：速率等于它时动势恰为 0.5。
 * 取 0.02 单位/ms ≈ 20 码点/秒 —— 正是"模型正常吐字"的量级（中文 ~15-40 字/秒），
 * 所以**常态在 0.5 附近**、明显加速才 >0.7、停顿掉到 <0.2。
 */
export const MOTION_RATE_HALF: number = 0.02;

/** 夹到 `[0,1]`（NaN/负值 ⇒ 0；>1 ⇒ 1）。 */
export function clamp01(x: number): number {
  if (!(x > 0)) {
    return 0;
  }
  return x > 1 ? 1 : x;
}

/**
 * 动势 ∈ `[0,1)`：`rate / (rate + MOTION_RATE_HALF)`（饱和曲线）。
 *
 * 性质（测试逐条钉住）：`≤0` 的增量或 `≤0` 的间隔 ⇒ **0**（"没前进"就是没前进，
 * 不用旧值蒙混）；对 `rate` **严格单调递增**；上界 <1（永不到 1，避免"顶格"呆板）；
 * `rate = MOTION_RATE_HALF` ⇒ 恰 0.5（半饱和点的定义）。
 */
export function activityVitality(deltaUnits: number, dtMs: number): number {
  if (!(deltaUnits > 0) || !(dtMs > 0)) {
    return 0;
  }
  const rate: number = deltaUnits / dtMs;
  return rate / (rate + MOTION_RATE_HALF);
}

/**
 * 动势 → **倍数**（对称、有界、**在中点恰为 1**）：`1 + span * (vital - 0.5) * 2`。
 *
 * ⛔ 关键设计：`vital = 0.5` ⇒ 倍数 **恰为 1.0** ⇒ **既有观感逐值不变**。
 * 于是"动势"只在两端起作用：高速 ⇒ 略强（1+span）、停顿 ⇒ 略弱（1-span）。
 * 这条性质让本波的新增不会动到前一轮（`5ff1c7c`）已经验收过的静帧观感。
 */
export function vitalityGain(vital: number, span: number): number {
  const v: number = clamp01(vital);
  const sp: number = span > 0 ? span : 0;
  return 1 + sp * (v - 0.5) * 2;
}
