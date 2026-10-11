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

import {
  LAUNCH_COLD,
  LAUNCH_WARM,
  SPLASH_ENTER_MS,
  SPLASH_EXIT_MS,
  SPLASH_HYSTERESIS_MS,
  SPLASH_MARK_BOX_MULT,
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
import { SPACE_XXL } from '../../entry/src/main/ets/core/design';

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

// ── 汇总 ──────────────────────────────────────────────────────────────────
if (fail > 0) { console.log(`  splash: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  splash: ${pass} passed, 0 failed`);
process.exit(0);
