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
 *     （x∈[0,1]，y 任意；用于精确复刻 web 的 `cubic-bezier(0.34,1.56,0.64,1)` 回弹曲线）。
 *     ⚠️ 2026-10-11：`curves.springMotion(...)` 曾用于 `animSpring()`（**0 消费者**死工厂）—— **已删**。
 *   · `AnimateParam.curve?: Curve | string | ICurve` —— `component/common.d.ts`（declare interface AnimateParam）。
 */
import curves from '@ohos.curves';
import {
  MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS,
  MOTION_DRAWER_SLIDE_VP, MOTION_LIGHTBOX_ENTER_SCALE, MOTION_SHEET_SLIDE_VP,
  springBezier,
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

// ⛔ **已删死码**（2026-10-11 动效「单一来源」收敛）：此前的 `animSpring()`（物理弹簧，
//    `curves.springMotion`）及其记忆化曲线 `springMotionCurve()` / `springMotionMemo` —— **全仓 0 消费者**：
//    所有入场都走上面的 `cubicBezierCurve(springBezier())`（`springCurve()`），`springMotion` **从未被消费**。
//    ⇒ 删除（动效"只许减"；死工厂不得以"苹果味核心"的名义留着）。
//    ⚠️ `core/motion.ets` 的 `springParams()` / `SpringParams` 仍在（`tools/tests/motion.test.ts` 覆盖其
//    物理合法性），但**本文件**不再消费它（唯一的消费链随本工厂一并移除）。

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

/**
 * `animEaseOut()` 的**带延迟 / 显式时长**变体 —— 用于"先给足 X，再于 Y 内淡入"这类**时序**场景
 * （当前唯一消费者：开屏跳过提示的延迟淡入，`components/SplashOverlay.ets`）。
 *
 * ⛔ 曲线仍 = `EASE_OUT_CSS`（**无超调**，与 T2 让位同族）；本函数**不新造数值** ——
 *    `delayMs`/`durationMs` 由调用方从底座派生常量传入（如 `core/splash` 的
 *    `SPLASH_HINT_DELAY_MS`/`SPLASH_HINT_FADE_MS`，其真源是
 *    `core/motion.MOTION_BASE_MS`/`MOTION_FAST_MS`）。
 * 为什么收进底座：原先它是 `SplashOverlay.ets` 的私有 `withTiming()`（**就地**改
 *    `AnimateParam` 的时序字段）—— 动效构造只能有**一个**出口（见本文件头铁律），故上移为具名工厂。
 */
export function animEaseOutDelayed(delayMs: number, durationMs: number): AnimateParam {
  return { duration: durationMs, curve: EASE_OUT_CSS, delay: delayMs };
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
 * ✅ 滑入位移已 **token 化**（E3）：`y: MOTION_SHEET_SLIDE_VP`（`core/motion.ets` 的档常量）——
 *    此前是裸字面量 `y: 260`（"就地字面量"项）；判据 = `tools/tests/motion_uniform.test.ts`
 *    （任何 `translate({ x|y: <数字> })` 一律判红）。
 */
export function sheetTransition(): TransitionEffect {
  return TransitionEffect.translate({ y: MOTION_SHEET_SLIDE_VP })
    .animation({ duration: MOTION_BASE_MS, curve: sheetCurve() })
    .combine(TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS }));
}

/**
 * **in-app toast**（自绘小浮条）的出入场 —— 与 `sheetTransition()` **同族**（自下而上 + 淡入），
 * 但位移取**小档** `MOTION_TOAST_SLIDE_VP`（= 面板档 / 4）。
 *
 * ⛔ 时长/曲线/位移**全部来自底座**（`core/motion.ets` + `sheetCurve()`）—— 本函数是新造的**位移语义**
 *    不是新时长/新曲线；`tools/tests/motion_uniform.test.ts` 的规则 F 会抓"位移字面量"。
 * ⚠️ 用 `.transition()`（而非 `.opacity(三元)`）：静息态 = 组件自身属性 = **可见** ⇒ fail-safe
 *    （门禁 ⑨ 的正向形态；`tools/lint/anim-opacity-gate.sh`）。
 */
export function toastTransition(): TransitionEffect {
  // ⛔ **纯淡入**（2026-10-11 动效冗余审计，用户口径"极简/干净"）：toast 是**瞬时提示**、**不来自任何方向**
  //    ⇒ `translate`/`scale` 是**纯装饰**（无状态含义、无空间含义）。
  //    web 对照：`web/src/components/agent/Lightbox.tsx`（最接近的浮层）**完全没有入场动画**。
  return TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS });
}

/**
 * ⛔ **未采纳**（2026-10-11 动效冗余审计 item 2 复核结论）：原计划给"popup 类"新增 `popupTransition()`
 * （纯淡入+极小缩放）替代 `sheetTransition()` —— **复核后不成立**：
 *   · `TodoPanel.ets:336` / `MessageNav.ets:331` 用的是 **`.animation(animFast())`（属性动画）**，
 *     **不是** `sheetTransition()` ⇒ 没有"从屏底滑入"可删；
 *   · `ToolPopover` / `ContextRing` 的 `bindPopup` 是**系统绘制**（`.transition(` 计数 = 0）⇒ 改不到。
 * ⇒ 造一个**零消费者**的工厂只会变成死码（判据 `motion_budget` 会要求"工厂必须被 ≥1 站点消费"）。
 *   若将来真出现"自绘 popup 从屏底滑入"的错配，再按本注释的思路落。
 */

/**
 * **图片 lightbox**（全屏浮层）的出入场 —— **轻微缩放 + 淡入**（`scale 0.96 → 1`）。
 *
 * 为什么不复用 `sheetTransition()`：lightbox 是**全屏**浮层（不是底部面板）⇒ 从下滑入读作"抽屉"，
 * 语义不对。⛔ 时长/曲线/缩放起点**全部来自底座**（`MOTION_BASE_MS` / `MOTION_FAST_MS` /
 * `MOTION_LIGHTBOX_ENTER_SCALE` / `sheetCurve()`）—— 本函数只组合，不自造数值。
 */
export function lightboxTransition(): TransitionEffect {
  return TransitionEffect.scale({ x: MOTION_LIGHTBOX_ENTER_SCALE, y: MOTION_LIGHTBOX_ENTER_SCALE })
    .animation({ duration: MOTION_BASE_MS, curve: sheetCurve() })
    .combine(TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS }));
}

/**
 * **侧栏抽屉**（左侧滑出，`DrawerSheet`）的出入场 —— **横向滑入 + 淡入**。
 *
 * 为什么不复用 `sheetTransition()`：后者从**屏底**滑入（纵向），抽屉在左侧 ⇒ 语义不对
 * （同 `lightboxTransition` 的理由）。⛔ 时长/曲线/位移**全部来自底座**
 * （`MOTION_BASE_MS` / `MOTION_FAST_MS` / `MOTION_DRAWER_SLIDE_VP` / `sheetCurve()`）—— 本函数只组合。
 *
 * ⚠️ 用 `.transition()` 而非 `.opacity(三元)`：静息态 = 组件自身属性 = **可见** ⇒ fail-safe
 *    （门禁 ⑨；`tools/lint/anim-opacity-gate.sh`）。
 */
export function drawerTransition(): TransitionEffect {
  return TransitionEffect.translate({ x: -MOTION_DRAWER_SLIDE_VP })
    .animation({ duration: MOTION_BASE_MS, curve: sheetCurve() })
    .combine(TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS }));
}

/**
 * **纯淡入淡出**（⛔ 无位移）—— 给「内容出现/消失」这类**无空间含义**的过渡。
 *
 * 现有消费点（同一个语义，⛔ 不为每处再造一个同名工厂）：
 *   · 会话抽屉的**遮罩（scrim）**：遮罩是平面，位移无空间含义 ⇒ 只淡；与抽屉本体的横向滑入
 *     同起同止（遮罩先「铺开」、抽屉再「滑上」）；
 *   · `AuthImage` **解码完成 ⇒ 图片淡入**（此前"啪"地弹出，且与 skeleton 的消失不同步）。
 *
 * 时长取快档（`MOTION_FAST_MS`）—— ⛔ 不自造数值（本函数只组合底座的时长常量）。
 */
export function fadeTransition(): TransitionEffect {
  return TransitionEffect.OPACITY.animation({ duration: MOTION_FAST_MS });
}
