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
import { D_SLOW } from '../core/tokens';

/**
 * 精确复刻 web 的 spring 回弹曲线（`cubic-bezier(0.34,1.56,0.64,1)`）。
 * 用于需要**给定 duration** 的过渡（hover/状态切换/入场）。
 */
function springCurve(): ICurve {
  const b = springBezier();
  return curves.cubicBezierCurve(b.x1, b.y1, b.x2, b.y2);
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
  const s = springParams();
  return { curve: curves.springMotion(s.response, s.dampingFraction, s.overlapDuration) };
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
