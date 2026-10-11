/**
 * 动效底座（**UI 侧**）—— 把 `core/motion.ets` 的纯数值/纯函数，构造为 ArkUI 的
 * `AnimateParam`，供全仓界面统一调用。这是"苹果味"弹簧的唯一出口。
 *
 * 分层（铁律）：`@ohos.curves` 只能在这一层 import；`core/motion.ets` 保持纯 TS 可脱机单测。
 * 本文件**不**被 `tools/tests/run.sh` 单测覆盖（它 import ArkUI 全局），其正确性靠 hvigorw
 * 真编译 + 界面回归把关；其中用到的 SDK API 均有 d.ts 证据（见下）。
 *
 * 图标/SDK 依据：
 *   · `curves.cubicBezierCurve(x1,y1,x2,y2): ICurve` —— `api/@ohos.curves.d.ts:268`
 *     （x∈[0,1]，y 任意；用于精确复刻 web 的 `cubic-bezier(0.34,1.56,0.64,1)` 回弹曲线）；
 *   · `curves.springMotion(response,dampingFraction,overlapDuration): ICurve` —— `:371`
 *     （**物理弹簧**：duration 参数失效，时长由参数决定 —— `common.d.ts:3416`）；
 *   · `AnimateParam.curve?: Curve | string | ICurve` —— `component/common.d.ts`（declare interface AnimateParam）。
 */
import curves from '@ohos.curves';
import {
  MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS,
  springBezier, springParams,
} from '../core/motion';
import { ORB_BREATH_MS } from '../core/orb';
import { D_SLOW, EASE_OUT_CSS } from '../core/tokens';

/**
 * 精确复刻 web 的 spring 回弹曲线（`cubic-bezier(0.34,1.56,0.64,1)`）。
 * 用于需要**给定 duration** 的过渡（hover/状态切换/入场）。
 */
/**
 * 记忆化的 spring 曲线。
 *
 * 为什么：`curves.cubicBezierCurve(...)` 是**原生对象构造**，而 `animFast/Base/Slow/MsgIn`
 * 共 14 处调用点都在 build / 点击路径里 ⇒ 每次调用新建一条曲线是实测到的热点。
 * 曲线参数是**常量**（`springBezier()` 无入参）⇒ 全局只需要一条。
 *
 * ⛔ 只缓存 `ICurve`（原生对象）；`AnimateParam` 仍是便宜的 2 字段字面量 —— 不去共享那个
 *    可能被框架内部注解/复用的对象（保守做法，收益已全部拿到）。
 */
let springCurveMemo: ICurve | undefined = undefined;
function springCurve(): ICurve {
  if (springCurveMemo === undefined) {
    const b = springBezier();
    springCurveMemo = curves.cubicBezierCurve(b.x1, b.y1, b.x2, b.y2);
  }
  return springCurveMemo;
}

/** 快速过渡（180ms，hover/状态切换）—— 对齐 web `.transition-spring`。 */
export function animFast(): AnimateParam {
  return { duration: MOTION_FAST_MS, curve: springCurve() };
}

/** 章节/大块入场（220ms）—— 对齐 web `sectionIn`。 */
export function animBase(): AnimateParam {
  return { duration: MOTION_BASE_MS, curve: springCurve() };
}

/** 消息行入场（200ms）—— 对齐 web `msgIn`。 */
export function animMsgIn(): AnimateParam {
  return { duration: MOTION_MSG_IN_MS, curve: springCurve() };
}

/** 大块/抽屉（320ms）。 */
export function animSlow(): AnimateParam {
  return { duration: MOTION_SLOW_MS, curve: springCurve() };
}

/**
 * **物理弹簧**（"苹果手感"的核心）：时长为物理量，`duration` 无意义
 * （`common.d.ts:3416` 明确 springMotion 时 duration 失效）⇒ 这里**不设 duration**，
 * 只给 `curves.springMotion(...)`。参数取自 `core/motion.ets`（response/damping/overlap）。
 */
export function animSpring(): AnimateParam {
  return { curve: springMotionCurve() };
}

/**
 * 记忆化的物理弹簧曲线（参数取自 `core/motion.ets` 的 `springParams()`，**常量** ⇒ 全局一条）。
 * 同 `springCurve()`：`curves.springMotion(...)` 是原生对象构造，不该每次调用重造。
 */
let springMotionMemo: ICurve | undefined = undefined;
function springMotionCurve(): ICurve {
  if (springMotionMemo === undefined) {
    const s = springParams();
    springMotionMemo = curves.springMotion(s.response, s.dampingFraction, s.overlapDuration);
  }
  return springMotionMemo;
}

/**
 * **无超调缓出**（`cubic-bezier(0, 0, 0.2, 1)`）—— 用于**退场 / 让位**（如开屏 T2「标记移交首页」）。
 *
 * 为什么需要"无超调"这一档：本文件其余 `anim*()` 全走 **spring 回弹**
 * （`cubic-bezier(0.34, 1.56, 0.64, 1)`，带 overshoot）—— 那对**入场**是对的（有生气），
 * 但用在**退场/让位**上会"冲过头再退回来"，读作**抖了一下**（观感错误）。
 *
 * 机制：直接消费 `core/tokens.ets:EASE_OUT_CSS`（本仓对 web `.animate-*` 的逐值对齐）。
 * SDK 明确支持 `AnimateParam.curve` 传 CSS 串（`component/common.d.ts`：`curve?: Curve | string | ICurve`，
 * string 形如 `"cubic-bezier(0.42, 0.0, 0.58, 1.0)"`）；等价的枚举是 `Curve.LinearOutSlowIn`
 * （= `cubic-bezier(0.0, 0.0, 0.2, 1.0)`，见 `component/enums.d.ts` 曲线表）。
 * 时长 = `MOTION_SLOW_MS`(320)（= 开屏 T2 借的 `motion.transition` 刻度）。
 * ⛔ 只**新增**工厂，不改任何既有动效（既有 `anim*()` / `sheetTransition` 行为不变）。
 */
export function animEaseOut(): AnimateParam {
  return { duration: MOTION_SLOW_MS, curve: EASE_OUT_CSS };
}

// ── 「在飞」呼吸刻度（**整组唯一心跳**；波5e 共享语言，契约见 `docs/DESIGN-SYSTEM.md §8`）──
/**
 * 主呼吸刻度 = **直接引用 `core/orb.ets` 的 `ORB_BREATH_MS`**（8×D_SLOW = 2560ms）——
 * 不复制数值、不新造时长。谁用它：光球的呼吸、`思考 N 字` 的强调脉冲、静默窗的基准。
 * ⛔ 纪律：在飞组里任何"呼吸/脉冲/闪烁"都必须是这个刻度的整数分数/倍数
 *   （1× = 主呼吸、1/4 = 静默窗、1/8 = 态过渡），否则就是"新造了一套时长"。
 */
export const MOTION_BREATH_MS: number = ORB_BREATH_MS;
/** 细节拍 = 2×D_SLOW = 640ms：打字机光标闪烁（同源刻度里最细的一档）。 */
export const MOTION_BEAT_MS: number = D_SLOW * 2;
/**
 * 静默判定窗口 = 主呼吸的 1/4 = 640ms（= 2×D_SLOW）。
 * 光球与 `思考 N 字` **共用这一个值** ⇒ 两边对"机器还在动吗"的判断必然一致
 * （不会出现"一个还在呼吸、另一个已经定格"的打架）。
 */
export const MOTION_QUIET_MS: number = MOTION_BREATH_MS / 4;

// ── 面板/弹层出入场（**唯一实现**）─────────────────────────────────────────────
/**
 * 抽屉/弹层出入场的**唯一曲线** = 系统 `Curve.Friction`。
 *
 * 为什么收进具名出口：`anim.ets` 是全仓唯一允许 import `@ohos/curves` 的层，曲线构造也归它 ——
 * 把 enum 字面量收敛到**一处**，调用方只认语义化的 `sheetTransition()`。
 * ⛔ **不用** `@ohos/curves` 自算贝塞尔：`Curve.Friction` 自带系统阻尼手感，换成自算曲线会**改观感**。
 */
function sheetCurve(): Curve {
  return Curve.Friction;
}

/**
 * 面板/弹层的统一出入场：从下滑入 + 淡入（只用 transform/opacity，不触发布局）。
 *
 * 原先它是 `pages/Index.ets` 的私有方法（`this.sheetTransition()`）；随 P1（抽 `StatusSheet`）
 * 搬到这里 —— 动效只能有**一个**出口（见本文件头：`@ohos.curves` 与 UI 侧动效构造只在这一层），
 * 否则"新的弹层组件"就要复制一份同样的数值（两份时长就开始漂移）。页面与组件一律调它。
 *
 * ⚠️ 时长**零行为变更**：`220 ≡ MOTION_BASE_MS`、`180 ≡ MOTION_FAST_MS`（值逐一相等；本波只把
 *    字面量换成基常量，曲线原样走 `sheetCurve()`）。
 * 🔸 仍未 token 化：滑入位移 `y: 260`（`core/design.ets` 无"滑入位移"档 —— 报备，未自造）。
 */
export function sheetTransition(): TransitionEffect {
  return TransitionEffect.translate({ y: 260 })
    .animation({ duration: MOTION_BASE_MS, curve: sheetCurve() })
    .combine(TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS }));
}
