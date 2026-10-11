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
  MOTION_MIN_DWELL_MS, MOTION_SPLASH_TIMEOUT_MS, MOTION_ENTER_SCALE, MOTION_SPLASH_MARK_VP,
  springBezier, springParams, durations, inRange, motionIssues,
  BezierPoints, SpringParams, Durations,
} from '../../entry/src/main/ets/core/motion';
// 开屏超时兜底 = 在飞主呼吸 1×（同源校验用）。
import { ORB_BREATH_MS } from '../../entry/src/main/ets/core/orb';
// 判据：`MOTION_MIN_DWELL_MS` 是"停留"不是"动画时长" ⇒ 必须**不在**允许集合里。
import { allowedDurations } from '../../entry/src/main/ets/core/design';

// 旧 token 常量（theme_tokens.test.ts 也引用）；此处校验"新模块与旧常量同源不漂移"。
import {
  D_FAST, D_SLOW, SP_8,
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

// ── (e) 开屏/冷启动 4 个底座常量（`147b412` 交回；**派生式**，非裸数字）────────────────────
// ① 值断言（改错因子 ⇒ 值变 ⇒ 红）
eq('MOTION_MIN_DWELL_MS = MOTION_BASE_MS + MOTION_FAST_MS', MOTION_MIN_DWELL_MS, MOTION_BASE_MS + MOTION_FAST_MS);
eq('MOTION_MIN_DWELL_MS 值 = 400', MOTION_MIN_DWELL_MS, 400);
ok('⛔ MOTION_MIN_DWELL_MS 是"停留"非"动画时长" ⇒ 不在 allowedDurations()',
  allowedDurations().indexOf(MOTION_MIN_DWELL_MS) < 0);
eq('MOTION_SPLASH_TIMEOUT_MS = ORB_BREATH_MS', MOTION_SPLASH_TIMEOUT_MS, ORB_BREATH_MS);
eq('MOTION_SPLASH_TIMEOUT_MS 值 = 2560', MOTION_SPLASH_TIMEOUT_MS, 2560);
eq('MOTION_ENTER_SCALE 值 = 0.92', MOTION_ENTER_SCALE, 0.92);
ok('MOTION_ENTER_SCALE ∈ (0,1)（入场起点，非 0/1）', MOTION_ENTER_SCALE > 0 && MOTION_ENTER_SCALE < 1);
eq('MOTION_SPLASH_MARK_VP = SP_8 × 5', MOTION_SPLASH_MARK_VP, SP_8 * 5);
eq('MOTION_SPLASH_MARK_VP 值 = 160', MOTION_SPLASH_MARK_VP, 160);

// ② 源码形态断言：**必须仍是派生式**（mutation：改回 `= 400` / `= 2560` / `= 160` 字面量 ⇒ 红）
declare const __dirname: string;
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
const motionSrc: string = require('fs').readFileSync(
  require('path').join(__dirname, '..', '..', '..', '..', 'entry', 'src', 'main', 'ets', 'core', 'motion.ets'),
  'utf-8');
function hasSrc(needle: string, name: string): void { ok(name, motionSrc.indexOf(needle) >= 0); }
function hasNotSrc(needle: string, name: string): void { ok(name, motionSrc.indexOf(needle) < 0); }
hasSrc('export const MOTION_MIN_DWELL_MS: number = MOTION_BASE_MS + MOTION_FAST_MS;',
  'MIN_DWELL 派生式在位（改回裸数字 ⇒ 红）');
hasSrc('export const MOTION_SPLASH_TIMEOUT_MS: number = ORB_BREATH_MS;',
  'SPLASH_TIMEOUT 派生式在位（改回 2560 ⇒ 红）');
hasSrc('export const MOTION_SPLASH_MARK_VP: number = SP_8 * 5;',
  'SPLASH_MARK_VP 派生式在位（改回 160 ⇒ 红）');
hasSrc('export const MOTION_ENTER_SCALE: number = 0.92;', 'MOTION_ENTER_SCALE 设计值常量在位');
hasNotSrc('MOTION_MIN_DWELL_MS: number = 400', '⛔ MIN_DWELL 无裸 400 字面量');
hasNotSrc('MOTION_SPLASH_MARK_VP: number = 160', '⛔ MARK_VP 无裸 160 字面量');

if (fail > 0) { console.log(`  motion: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion: ${pass} passed, 0 failed`);
process.exit(0);

// ⛔ `export {}` 让本文件成为 module（顶层 declare/const/function 收进模块作用域），
//    否则 `__dirname` / `require` / `hasSrc` 会与同批编译的兄弟测试顶层声明相撞（TS2451/TS6200）。
export {};
