/**
 * 动效底座测试（判别力）—— 断言 `core/motion.ets` 的数值与 web 权威基准**逐值相等**，
 * 并覆盖 spring 参数的物理合法性与"可比较结构"的纯函数。
 *
 * 判别力自证（必须做，见提交信息）：改动下列任一"锚点"值 → 本测试必红：
 *   · `MOTION_FAST_MS`（180→其它）        ⇒ '时长族 fast' 断言失败
 *   · `EASE_SPRING_P1Y`（1.56→1）          ⇒ '贝塞尔控制点 = web 值' 断言失败
 *   · `EASE_SPRING_DAMPING`（0.65→1.2）    ⇒ 'spring 有回弹' 断言失败
 * 这些锚点全部来自 web `index.css` 的实测值，不是自证式（改了什么测什么）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };

import {
  MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS, MOTION_SPRING_CSS,
  springBezier, springParams, durations, inRange, motionIssues,
  BezierPoints, SpringParams, Durations,
} from '../../entry/src/main/ets/core/motion';

// 旧 token 常量（theme_tokens.test.ts 也引用）；此处校验"新模块与旧常量同源不漂移"。
import {
  D_FAST, D_SLOW,
  EASE_SPRING_CSS, EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y,
  EASE_SPRING_RESPONSE, EASE_SPRING_DAMPING, EASE_SPRING_OVERLAP,
} from '../../entry/src/main/ets/core/tokens';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── (a) 时长族：与 web index.css 逐值相等 ────────────────────────────────────
eq('时长族 fast = 180（web transition-spring）', MOTION_FAST_MS, 180);
eq('时长族 base = 220（web sectionIn）', MOTION_BASE_MS, 220);
eq('时长族 msgIn = 200（web msgIn）', MOTION_MSG_IN_MS, 200);
eq('时长族 slow = 320', MOTION_SLOW_MS, 320);
ok('时长严格递增 fast<base<slow', MOTION_FAST_MS < MOTION_BASE_MS && MOTION_BASE_MS < MOTION_SLOW_MS);
// 与旧 token 同源校验：fast/slow 直接引用 tokens（改 tokens 会同步反映，不得漂移）
eq('fast 引用 tokens.D_FAST', MOTION_FAST_MS, D_FAST);
eq('slow 引用 tokens.D_SLOW', MOTION_SLOW_MS, D_SLOW);

// ── (b) 曲线：控制点 = web cubic-bezier(0.34,1.56,0.64,1) ────────────────────
eq('spring CSS 文本 = web 值', MOTION_SPRING_CSS, 'cubic-bezier(0.34, 1.56, 0.64, 1)');
eq('spring CSS 引用 tokens', MOTION_SPRING_CSS, EASE_SPRING_CSS);
const b = springBezier();
ok('springBezier 返回 BezierPoints', b instanceof BezierPoints);
eq('贝塞尔控制点 = web 值', [b.x1, b.y1, b.x2, b.y2], [0.34, 1.56, 0.64, 1]);
eq('贝塞尔控制点引用 tokens（不漂移）',
  [b.x1, b.y1, b.x2, b.y2],
  [EASE_SPRING_P1X, EASE_SPRING_P1Y, EASE_SPRING_P2X, EASE_SPRING_P2Y]);
// 回弹特征：y1 > 1（overshoot）—— 没有这条就丢了"苹果味"
ok('贝塞尔有 overshoot（y1>1）', b.y1 > 1);

// ── (c) 弹簧三参：与 tokens 一致 + 物理合法 ─────────────────────────────────
const s = springParams();
ok('springParams 返回 SpringParams', s instanceof SpringParams);
eq('spring.response = tokens 值', s.response, EASE_SPRING_RESPONSE);
eq('spring.dampingFraction = tokens 值', s.dampingFraction, EASE_SPRING_DAMPING);
eq('spring.overlapDuration = tokens 值', s.overlapDuration, EASE_SPRING_OVERLAP);
eq('spring 三参逐值', [s.response, s.dampingFraction, s.overlapDuration], [0.30, 0.65, 0.0]);
ok('spring 有回弹（0<damping<1）', s.dampingFraction > 0 && s.dampingFraction < 1);
ok('spring response > 0', s.response > 0);
ok('spring overlap ≥ 0', s.overlapDuration >= 0);

// ── (d) 纯函数与结构 ─────────────────────────────────────────────────────────
const d = durations();
ok('durations 返回 Durations', d instanceof Durations);
eq('durations 三元组', [d.fastMs, d.baseMs, d.slowMs], [180, 220, 320]);

ok('inRange 正常命中', inRange(0.5, 0, 1));
ok('inRange 越界判假', !inRange(1.5, 0, 1));
ok('inRange 拒绝 NaN', !inRange(NaN, 0, 1));

// 自检函数：当前配置必须"零问题"（否则说明常量被改坏）
eq('motionIssues 为空（参数自洽）', motionIssues().map((i) => i.field), []);

if (fail > 0) { console.log(`  motion: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion: ${pass} passed, 0 failed`);
process.exit(0);
