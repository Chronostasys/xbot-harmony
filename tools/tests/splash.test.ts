/**
 * 开屏门禁 —— `core/splash.ets` 的**阶段模型 / 边界 / reduceMotion / 在飞唯一性 / 超时·打断**。
 *
 * 为什么必须有守护：开屏是**用户第一眼**看到的东西，而它的判据全是**边界**（220 / 540 / 2560）
 * 与**铁律**（T1/T2 期间不得启动光球）。这些错都不会"编译报错"，只会表现为
 * "品牌一闪而过 / 白闪 / 两个在飞动效"——**只在真机才发现**。⇒ 全部钉成断言 + mutation 自证。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

import {
  LAUNCH_COLD,
  LAUNCH_WARM,
  SPLASH_ENTER_MS,
  SPLASH_EXIT_MS,
  SPLASH_HINT_DELAY_MS,
  SPLASH_HINT_ENTER_OPACITY,
  SPLASH_HYSTERESIS_MS,
  SPLASH_MARK_BOX_MULT,
  SPLASH_MARK_EXIT_LIFT_VP,
  SPLASH_MARK_BOX_VP,
  SPLASH_MARK_ENTER_OPACITY,
  SPLASH_MARK_ENTER_SCALE,
  SPLASH_MARK_REF_VP,
  SPLASH_MARK_SETTLED_OPACITY,
  SPLASH_MARK_SETTLED_SCALE,
  SPLASH_MIN_DWELL_MS,
  SPLASH_T0,
  SPLASH_T1,
  SPLASH_T2,
  SPLASH_T3,
  SPLASH_TIMEOUT_MS,
  SPLASH_TOTAL_MS,
  SPLASH_CURVE_EASE_OUT,
  SPLASH_CURVE_NONE,
  SPLASH_CURVE_SPRING,
  curveCssOf,
  curveHasOvershoot,
  shouldShowSplash,
  shouldStartSplash,
  splashCanvasOf,
  splashMarkLevelOf,
  splashOrbAllowed,
  splashPhaseAt,
  splashPhaseCurve,
  splashPhaseDurationMs,
  splashPhaseIsInFlight,
  splashPhaseStartMs,
  splashPhases,
} from '../../entry/src/main/ets/core/splash';
import { darkPalette, lightPalette, paletteOf } from '../../entry/src/main/ets/core/theme';
import { EASE_OUT_CSS, EASE_SPRING_CSS } from '../../entry/src/main/ets/core/tokens';
import { MOTION_BASE_MS, MOTION_FAST_MS, MOTION_SLOW_MS } from '../../entry/src/main/ets/core/motion';
import { ORB_BREATH_MS } from '../../entry/src/main/ets/core/orb';
import { MARK_LADDER_FULL, MARK_LADDER_OUTLINE, MARK_LADDER_SOLID, MARK_LADDER_WORDMARK, brandAccent, contrastRatio } from '../../entry/src/main/ets/core/brand';
import { SPACE_SM, SPACE_XXL } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ⓪ 常量：**全部由底座派生，零裸数字** ─────────────────────────────────────
{
  eq('SPLASH_ENTER_MS == MOTION_BASE_MS', SPLASH_ENTER_MS, MOTION_BASE_MS);
  eq('SPLASH_EXIT_MS == MOTION_SLOW_MS', SPLASH_EXIT_MS, MOTION_SLOW_MS);
  eq('SPLASH_TOTAL_MS == 220+320', SPLASH_TOTAL_MS, 540);
  eq('SPLASH_MIN_DWELL_MS == BASE+FAST', SPLASH_MIN_DWELL_MS, MOTION_BASE_MS + MOTION_FAST_MS);
  eq('SPLASH_MIN_DWELL_MS == 400', SPLASH_MIN_DWELL_MS, 400);
  eq('SPLASH_TIMEOUT_MS == ORB_BREATH_MS（core 侧真源）', SPLASH_TIMEOUT_MS, ORB_BREATH_MS);
  eq('SPLASH_TIMEOUT_MS == 2560', SPLASH_TIMEOUT_MS, 2560);
  eq('标记盒 = 5 × space.xxl = 160vp', SPLASH_MARK_BOX_VP, SPACE_XXL * SPLASH_MARK_BOX_MULT);
  eq('  即 160', SPLASH_MARK_BOX_VP, 160);
  eq('参考边长 = 标记盒边长', SPLASH_MARK_REF_VP, SPLASH_MARK_BOX_VP);
  // 缺档③ 裁决：标记与光球**各自具名、不强行统一**（光球那支在 components/AssistantOrb.ets:94 = 0.86）
  eq('SPLASH_MARK_ENTER_SCALE = 0.92（标记专属）', SPLASH_MARK_ENTER_SCALE, 0.92);
  ok('标记入场来自 0（opacity）', SPLASH_MARK_ENTER_OPACITY === 0);
  ok('标记静止位 = 1/1', SPLASH_MARK_SETTLED_OPACITY === 1 && SPLASH_MARK_SETTLED_SCALE === 1);
  ok('阶段顺序 T0<T1<T2<T3', JSON.stringify(splashPhases()) === JSON.stringify([SPLASH_T0, SPLASH_T1, SPLASH_T2, SPLASH_T3]));
}

// ── ★A 边界：0 ⇒ T1；220 / 540 的归属必须明确 ───────────────────────────────
{
  eq('t=0 ⇒ T1（**不是** T0/T2）', splashPhaseAt(0, false), SPLASH_T1);
  eq('t<0（-1）⇒ T1（防御，不抛）', splashPhaseAt(-1, false), SPLASH_T1);
  eq('t=NaN ⇒ T1（防御，不抛）', splashPhaseAt(Number.NaN, false), SPLASH_T1);
  eq('t=219.999 ⇒ T1', splashPhaseAt(219.999, false), SPLASH_T1);
  eq('t=220（恰好）⇒ T2（左闭）', splashPhaseAt(220, false), SPLASH_T2);
  eq('t=539.999 ⇒ T2', splashPhaseAt(539.999, false), SPLASH_T2);
  eq('t=540（恰好）⇒ T3（左闭）', splashPhaseAt(540, false), SPLASH_T3);
  eq('t=1e9（远超）⇒ T3', splashPhaseAt(1e9, false), SPLASH_T3);
  // 起点函数与常量同源
  eq('T1 起点 = 0', splashPhaseStartMs(SPLASH_T1, false), 0);
  eq('T2 起点 = 220', splashPhaseStartMs(SPLASH_T2, false), SPLASH_ENTER_MS);
  eq('T3 起点 = 540', splashPhaseStartMs(SPLASH_T3, false), SPLASH_TOTAL_MS);
  eq('默认档 T1 时长 = 220', splashPhaseDurationMs(SPLASH_T1, false), SPLASH_ENTER_MS);
  eq('默认档 T2 时长 = 320', splashPhaseDurationMs(SPLASH_T2, false), SPLASH_EXIT_MS);
}

// ── ★B reduceMotion：**只降动效、不降可达性**（绝不退化成空白/无反馈）──────────
{
  eq('reduceMotion t=0 ⇒ T1（**不跳过**品牌）', splashPhaseAt(0, true), SPLASH_T1);
  eq('reduceMotion t=399 ⇒ T1（静态停留中）', splashPhaseAt(399, true), SPLASH_T1);
  eq('reduceMotion t=400 ⇒ T3（T2 收起为 0）', splashPhaseAt(400, true), SPLASH_T3);
  // 同一 t 在默认档是 T2、在 reduceMotion 档仍是 T1 ⇒ 证明"T2 被收起"而不是"整个跳掉"
  eq('reduceMotion t=220 ⇒ 仍 T1（默认档在此是 T2）', splashPhaseAt(220, true), SPLASH_T1);
  ok('reduceMotion **不**把 T1 跳过（t=0 结果 ≠ T3）', splashPhaseAt(0, true) !== SPLASH_T3);
  // 可达性：T1 仍有 >0 的停留（标记可见），且 T2 收缩为 0
  eq('reduceMotion T1 时长 = minDwell(400) > 0 ⇒ 仍有反馈', splashPhaseDurationMs(SPLASH_T1, true), SPLASH_MIN_DWELL_MS);
  ok('  ⇒ T1 时长 > 0（非空白）', splashPhaseDurationMs(SPLASH_T1, true) > 0);
  eq('reduceMotion T2 时长 = 0（跳切）', splashPhaseDurationMs(SPLASH_T2, true), 0);
  eq('reduceMotion T3 起点 = minDwell', splashPhaseStartMs(SPLASH_T3, true), SPLASH_MIN_DWELL_MS);
  eq('reduceMotion T2 起点 = T3 起点（T2 无独立区间）', splashPhaseStartMs(SPLASH_T2, true), SPLASH_MIN_DWELL_MS);
}

// ── ★C 动效唯一性（铁律）：T1/T2 期间"光球可启动"**必须为 false** ─────────────
{
  eq('T0 + 流式中 ⇒ 光球**不可**启动', splashOrbAllowed(SPLASH_T0, true), false);
  eq('T1 + 流式中 ⇒ 光球**不可**启动', splashOrbAllowed(SPLASH_T1, true), false);
  eq('T2 + 流式中 ⇒ 光球**不可**启动', splashOrbAllowed(SPLASH_T2, true), false);
  eq('T3 + 非流式 ⇒ 光球**不**启动（无在飞）', splashOrbAllowed(SPLASH_T3, false), false);
  eq('T3 + 流式中 ⇒ 光球**才**启动', splashOrbAllowed(SPLASH_T3, true), true);
  // 阶段本身**永不**属于"在飞"（开屏是一次性过渡）
  for (let i = 0; i < splashPhases().length; i++) {
    eq(`${splashPhases()[i]} 不属于"在飞"`, splashPhaseIsInFlight(splashPhases()[i]), false);
  }
  // 交叉：T1/T2 期间 overlay 仍在显示（shouldShowSplash=true）而光球不可启动 ⇒ 结构上不可能并发
  ok('T1 期间 overlay 在 + 光球不可启动（不并发）',
    shouldShowSplash(LAUNCH_COLD, 100, false) === true && splashOrbAllowed(splashPhaseAt(100, false), true) === false);
  ok('T2 期间 overlay 在 + 光球不可启动（不并发）',
    shouldShowSplash(LAUNCH_COLD, 300, false) === true && splashOrbAllowed(splashPhaseAt(300, false), true) === false);
}

// ── ★D 超时兜底（2560ms）+ 用户交互打断（立即 T3）────────────────────────────
{
  eq('t=2559（超时前）⇒ 内容未就绪则继续显示', shouldShowSplash(LAUNCH_COLD, 2559, false), true);
  eq('t=2560（恰好超时）⇒ **强制撤下**', shouldShowSplash(LAUNCH_COLD, 2560, false), false);
  eq('t=9999 ⇒ 强制撤下', shouldShowSplash(LAUNCH_COLD, 9999, false), false);
  eq('超时点之后阶段 = T3', splashPhaseAt(2560, false), SPLASH_T3);
  // 交互打断：**立即** T3（不必等 T1/T2 走完）
  eq('交互打断：t=100（T1 中）⇒ 立即 T3', splashPhaseAt(100, false, true), SPLASH_T3);
  eq('交互打断：t=300（T2 中）⇒ 立即 T3', splashPhaseAt(300, false, true), SPLASH_T3);
  eq('交互打断：reduceMotion 下同样立即 T3', splashPhaseAt(100, true, true), SPLASH_T3);
  eq('交互打断 ⇒ overlay 撤下', shouldShowSplash(LAUNCH_COLD, 100, false, true), false);
  eq('交互打断 ⇒ overlay 撤下（内容已就绪也一样）', shouldShowSplash(LAUNCH_COLD, 100, true, true), false);
  // 不回退：打断后再以更小 elapsed 取值，仍是 T3
  eq('打断后不回退（elapsed=0 + dismissed）', splashPhaseAt(0, false, true), SPLASH_T3);
  // 热启动：不进 T1
  eq('热启动 ⇒ overlay 不显示', shouldShowSplash(LAUNCH_WARM, 0, false), false);
  eq('热启动（任意 t/内容态）⇒ 不显示', shouldShowSplash(LAUNCH_WARM, 5000, true), false);
  // 最短停留：内容秒就绪也要停满 minDwell
  eq('内容就绪但 t<minDwell ⇒ 仍显示（品牌不闪）', shouldShowSplash(LAUNCH_COLD, 100, true), true);
  eq('内容就绪且 t>=minDwell ⇒ 撤下', shouldShowSplash(LAUNCH_COLD, 400, true), false);
  eq('内容未就绪且 t>=minDwell ⇒ 继续显示（不闪白）', shouldShowSplash(LAUNCH_COLD, 400, false), true);
}

// ── ★Db 迟滞闸门（**用户口径「尽可能快；加载慢才播动画」**）─────────────────────
// 关键判据：**就绪时间 < 迟滞 ⇒ 压根不展示开屏**（T0 系统开屏直接过渡到主界面）。
// mutation 自证：把 `shouldStartSplash` 改成 `return true` ⇒ 下面第一条必红。
{
  eq('SPLASH_HYSTERESIS_MS == 150（用户拍板 ≈150ms）', SPLASH_HYSTERESIS_MS, 150);
  // ① 迟滞未到 ⇒ 不展示（还在"免开屏"观察窗内）
  eq('t=0（迟滞未到）⇒ 不展示', shouldStartSplash(LAUNCH_COLD, 0, false), false);
  eq('t=149（迟滞前 1ms）⇒ 不展示', shouldStartSplash(LAUNCH_COLD, 149, false), false);
  // ② ★核心：迟滞到点前内容已就绪 ⇒ **不展示**（快启动直接进主界面）
  eq('就绪时间 < 迟滞（t=100 已就绪）⇒ **不展示开屏**', shouldStartSplash(LAUNCH_COLD, 100, true), false);
  eq('就绪时间 == 迟滞（t=150 已就绪）⇒ 不展示', shouldStartSplash(LAUNCH_COLD, 150, true), false);
  // ③ 迟滞到点且仍未就绪 ⇒ 展示（并完整播完；撤下时机另由 shouldShowSplash 兜）
  eq('t=150 且未就绪 ⇒ 展示', shouldStartSplash(LAUNCH_COLD, 150, false), true);
  eq('t=500 且未就绪 ⇒ 展示', shouldStartSplash(LAUNCH_COLD, 500, false), true);
  // ④ 热启动 ⇒ 永不展示（无系统开屏，也不假装有）
  eq('热启动（迟滞到点、未就绪）⇒ 不展示', shouldStartSplash(LAUNCH_WARM, 500, false), false);
  eq('热启动（任意 t/内容态）⇒ 不展示', shouldStartSplash(LAUNCH_WARM, 9999, true), false);
  // ⑤ 两闸门**语义不同、不可互换**：迟滞管"要不要展示"，minDwell 管"展示后不半截被切"
  ok('迟滞 < minDwell（免开屏窗 ≪ 最短展示）', SPLASH_HYSTERESIS_MS < SPLASH_MIN_DWELL_MS);
}

// ── ★E 曲线语义：**入场可超调；让位/退出不许超调**（设计系统级约定）─────────────
{
  // 数据面：T1 ⇒ spring（带超调）；T2 ⇒ ease-out（**无超调**）；T0/T3 ⇒ 无曲线
  eq('T1 曲线 = spring', splashPhaseCurve(SPLASH_T1), SPLASH_CURVE_SPRING);
  eq('T2 曲线 = easeOut（**不许 spring**）', splashPhaseCurve(SPLASH_T2), SPLASH_CURVE_EASE_OUT);
  eq('T0 不由本组件驱动（无曲线）', splashPhaseCurve(SPLASH_T0), SPLASH_CURVE_NONE);
  eq('T3 已交棒（无曲线）', splashPhaseCurve(SPLASH_T3), SPLASH_CURVE_NONE);
  // 曲线标识 → 底座 token（同源，非字面量）
  eq('spring → EASE_SPRING_CSS', curveCssOf(SPLASH_CURVE_SPRING), EASE_SPRING_CSS);
  eq('easeOut → EASE_OUT_CSS', curveCssOf(SPLASH_CURVE_EASE_OUT), EASE_OUT_CSS);
  eq('无曲线 → 空', curveCssOf(SPLASH_CURVE_NONE), '');
  // 超调判据（由 CSS 控制点实解析，不是硬编码布尔）
  ok(`spring 有超调（${EASE_SPRING_CSS}）`, curveHasOvershoot(EASE_SPRING_CSS));
  ok(`ease-out **无**超调（${EASE_OUT_CSS}）`, !curveHasOvershoot(EASE_OUT_CSS));
  ok('非 cubic-bezier 形式按"无超调"处理（保守）', !curveHasOvershoot('Curve.Friction'));
  // ★ 核心断言：让位（T2）**不许**出现超调 —— 把 T2 改回 spring 即红
  ok('T1（入场）允许超调', curveHasOvershoot(curveCssOf(splashPhaseCurve(SPLASH_T1))));
  ok('T2（让位）**禁止**超调', !curveHasOvershoot(curveCssOf(splashPhaseCurve(SPLASH_T2))));
}

// ── ① 底色判据（与 docs/BRAND.md §12.1 的 FOLLOW_APPLICATION 衔接）───────────
{
  eq('A: porcelain 跟应用 ⇒ #FFFFFF', splashCanvasOf('porcelain', true, false), paletteOf('porcelain').appBg);
  eq('A: porcelain 跟应用 ⇒ 与首帧画布逐字节一致（零跳色）', splashCanvasOf('porcelain', true, false), '#FFFFFF');
  eq('A: dark 跟应用 ⇒ #0B0B0E', splashCanvasOf('dark', true, false), darkPalette().appBg);
  eq('A: 跟应用时**忽略**系统深浅', splashCanvasOf('porcelain', true, true), splashCanvasOf('porcelain', true, false));
  eq('B: 跟系统浅 ⇒ lightPalette().appBg', splashCanvasOf('porcelain', false, false), lightPalette().appBg);
  eq('  = #F8FAFC', splashCanvasOf('porcelain', false, false), '#F8FAFC');
  eq('B: 跟系统深 ⇒ darkPalette().appBg', splashCanvasOf('dark', false, true), darkPalette().appBg);
  eq('B: 跟系统时**忽略**主题名', splashCanvasOf('porcelain', false, true), splashCanvasOf('dark', false, true));
}

// ── ② 标记档位（委托 core/brand.markLevelFor；porcelain = solid，零发光）──────
{
  eq('porcelain 白主题 ⇒ SOLID', splashMarkLevelOf('porcelain', SPLASH_MARK_REF_VP, false), MARK_LADDER_SOLID);
  eq('dark ⇒ FULL', splashMarkLevelOf('dark', SPLASH_MARK_REF_VP, false), MARK_LADDER_FULL);
  eq('单色/无障碍 ⇒ OUTLINE', splashMarkLevelOf('porcelain', SPLASH_MARK_REF_VP, true), MARK_LADDER_OUTLINE);
  eq('边长过小 ⇒ WORDMARK', splashMarkLevelOf('porcelain', 20, false), MARK_LADDER_WORDMARK);
  // 与 brand.ets 的实调口径一致（porcelain 标记色 = brandAccent()，对比度 ≥ 非文本 3:1）
  const c: number = contrastRatio(brandAccent(), '#FFFFFF');
  ok(`porcelain 标记对比度 ≥ 3:1（非文本；实得 ${c.toFixed(4)}）`, c >= 3.0);
  ok('  且如实记录 < 4.5.1 文本阈值（已知未决项）', c < 4.5);
}

// ── ★G 观感打磨：T2 让位"轻微上移" + 跳过提示"延迟淡入"（SPEC:38 / 顺序与层次）──────────
//
// 两条都是"能跑≠好看"的观感修补，判据分两层：
//   ① 纯数值（core/splash.ets 的常量）—— 真函数断言；
//   ② 组件**源码形态**（组件层不进离线 harness，故按本仓先例读真实源码，见 orb.test.ts §2）
//      —— 钉住"T2 真用了上移量""提示真被延迟淡入绑定"，改坏即红。
{
  // ① 纯值
  eq('T2 上移量 == SPACE_SM（由底座尺寸档派生，零裸数字）', SPLASH_MARK_EXIT_LIFT_VP, SPACE_SM);
  ok('  ⇒ 上移量 > 0（让位有方向感，不是"整层被抠掉"）', SPLASH_MARK_EXIT_LIFT_VP > 0);
  ok(`  ⇒ 上移量是小档（SPACE_SM=${SPACE_SM} < 标记盒 ${SPLASH_MARK_BOX_VP} 的 1/10 ⇒ 是"气息"不是位移表演）`,
    SPLASH_MARK_EXIT_LIFT_VP < SPLASH_MARK_BOX_VP / 10);
  eq('提示延迟 == SPLASH_ENTER_MS（标记入场结束才提示）', SPLASH_HINT_DELAY_MS, SPLASH_ENTER_MS);
  ok('  ⇒ 提示延迟 > 0（先给纯品牌，⛔ 不再首帧满不透明）', SPLASH_HINT_DELAY_MS > 0);
  eq('提示起始不透明度 = 0', SPLASH_HINT_ENTER_OPACITY, 0);

  // ② 组件源码形态（读真实源码）
  let overlaySrc: string = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up, 'entry/src/main/ets/components/SplashOverlay.ets');
    if (fs.existsSync(p)) {
      overlaySrc = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  ok('读到 SplashOverlay.ets 源码', overlaySrc.length > 0);
  ok('T2 让位真用了上移量（markLift = SPLASH_MARK_EXIT_LIFT_VP）',
    overlaySrc.indexOf('this.markLift = SPLASH_MARK_EXIT_LIFT_VP') >= 0);
  ok('标记真绑定了上移（.translate({ y: -this.markLift })）',
    overlaySrc.indexOf('.translate({ y: -this.markLift })') >= 0);
  ok('提示栏真绑定延迟淡入（.opacity(this.hintOpacity)）',
    overlaySrc.indexOf('.opacity(this.hintOpacity)') >= 0);
  ok('提示的延迟**来自底座工厂 + delay**（withDelay(animEaseOut(), SPLASH_HINT_DELAY_MS)）',
    overlaySrc.indexOf('withDelay(animEaseOut(), SPLASH_HINT_DELAY_MS)') >= 0);
  ok('提示起始不透明度取自 core/splash（hintOpacity = SPLASH_HINT_ENTER_OPACITY）',
    overlaySrc.indexOf('SPLASH_HINT_ENTER_OPACITY') >= 0);
  // ⛔ 组件不得自造曲线：不许 import @ohos/curves（注释里**提到**它是允许的 ⇒ 只查 import 语句）
  ok('组件**不** import @ohos/curves（曲线唯一出口 = components/anim.ets）',
    overlaySrc.indexOf("from '@ohos/curves'") < 0);
}

// ── ★F T0 资源不变量（真机白闪修复；`FOLLOW_APPLICATION` 经真机证实**不生效**）────────
//
// 背景（真机证据，2026-10-11）：系统浅色 + 应用深色时，T0 系统开屏底色取的是 **base**
// 的 `start_window_background`（`#F8FAFC`）⇒ 白闪一帧再进深色主界面。
// `startWindowColorModeType: FOLLOW_APPLICATION` 在真机上**没有**让 T0 跟随应用主题
// （T0 由**系统**在应用代码运行**之前**绘制；运行时 `setColorMode` 改不动它）⇒ 只能让
// **base** 取与应用**默认主题**（dark）一致的画布色，才能让默认用户零跳色。
//
// mutation 自证：把 `base/element/color.json` 改回 `#F8FAFC` ⇒ 本条必红。
{
  // `run.sh`/`run-one.sh` 把测试编到 `<repo>/tools/tests/.out-*/` 下（层级随 harness 变化），
  // ⇒ 从 `__dirname` 向上探测到真正含 `entry/src/...` 的那层（⛔ 不硬编码层级）。
  let repo: string = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/resources/base/element/color.json'))) {
      repo = p;
      break;
    }
  }
  ok('探测到仓库根（用于读资源）', repo.length > 0, `__dirname=${__dirname}`);
  const baseJson: any = JSON.parse(fs.readFileSync(
    path.join(repo, 'entry/src/main/resources/base/element/color.json'), 'utf8'));
  const darkJson: any = JSON.parse(fs.readFileSync(
    path.join(repo, 'entry/src/main/resources/dark/element/color.json'), 'utf8'));
  const pick = (j: any, name: string): string => {
    for (const c of j.color) { if (c.name === name) { return c.value; } }
    return '';
  };
  eq('base 的 start_window_background == 应用默认主题(dark)画布色（T0 不白闪）',
    pick(baseJson, 'start_window_background').toUpperCase(), darkPalette().appBg.toUpperCase());
  eq('dark 的 start_window_background 同值（两分支一致 ⇒ FOLLOW_SYSTEM 也不闪）',
    pick(darkJson, 'start_window_background').toUpperCase(), darkPalette().appBg.toUpperCase());
  ok('  ⇒ base 不再是浅色 #F8FAFC（深色应用冷启零跳色）',
    pick(baseJson, 'start_window_background').toUpperCase() !== '#F8FAFC');
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
if (fail > 0) { console.log(`  splash: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  splash: ${pass} passed, 0 failed`);
process.exit(0);
