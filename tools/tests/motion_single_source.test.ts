/**
 * 动效「单一来源」收敛判据 —— 2026-10-11 目标⑤（去重 + 收敛到唯一底座）。
 *
 * 守三条不变式（全部**逐值**，本波是"去重/收敛"不是"调参"）：
 *   ① **单一底座**：`core/splash.ets` 的开屏 3 常量**只许别名**引用 `core/motion.ets` 的真源
 *      （`MOTION_MIN_DWELL_MS` / `MOTION_SPLASH_TIMEOUT_MS` / `MOTION_ENTER_SCALE`），
 *      ⛔ 不许再复制表达式（`MOTION_BASE_MS + MOTION_FAST_MS` / `ORB_BREATH_MS` / `0.92`）；
 *      `core/design.ets` 的主呼吸/细节拍与 `components/anim.ets` **同源**
 *      （`ORB_BREATH_MS` / `D_SLOW * 2`），⛔ 不再各自派生第二套。
 *   ② **数值不变（回归防线）**：新旧逐态相等 —— 时长 400/2560、缩放 0.92、阶段边界 220/540、
 *      让位轨迹端点 1→0、呼吸 2560、细节拍 640 全部不变。
 *   ③ **唯一出口**：`animSpring()` 死工厂（0 消费者）已删；`SplashOverlay` 的本地
 *      `withTiming()` 已上移为底座具名工厂 `animEaseOutDelayed()`（组件侧不再就地改 `AnimateParam`）。
 *
 * ⛔ 判据纪律（`AGENTS.md`「判据 ≠ 信号」）：**只取调用片段/剥注释**、**零扫描判红**、
 *    **mutation 自证**（把任一别名改回复制数值 / 加回本地 withTiming ⇒ 必红，见提交信息）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
// ⛔ 必须：本文件若无 import/export，会被 TS 当作**全局脚本** ⇒ 顶层声明与兄弟测试在聚合编译里撞名。
export {};

import {
  SPLASH_MIN_DWELL_MS, SPLASH_TIMEOUT_MS, SPLASH_MARK_ENTER_SCALE,
  SPLASH_ENTER_MS, SPLASH_EXIT_MS, SPLASH_TOTAL_MS,
  SPLASH_HINT_DELAY_MS, SPLASH_HINT_FADE_MS,
  SPLASH_T1, SPLASH_T2, SPLASH_T3,
  splashPhaseStartMs, splashPhaseDurationMs, splashExitOpacityAt,
} from '../../entry/src/main/ets/core/splash';
import {
  MOTION_BASE_MS, MOTION_FAST_MS, MOTION_SLOW_MS,
  MOTION_MIN_DWELL_MS, MOTION_SPLASH_TIMEOUT_MS, MOTION_ENTER_SCALE,
} from '../../entry/src/main/ets/core/motion';
import {
  MOTION_BREATH_MS as DESIGN_BREATH_MS, MOTION_BEAT_MS as DESIGN_BEAT_MS,
  motionRoles, allowedDurations,
} from '../../entry/src/main/ets/core/design';
import { ORB_BREATH_MS } from '../../entry/src/main/ets/core/orb';
import { D_SLOW } from '../../entry/src/main/ets/core/tokens';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) { i++; }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components/anim.ets'))) { return p; }
  }
  return '';
}
const root: string = findRoot();
ok('探测到仓库根（含 components/anim.ets）', root.length > 0);

/** 读源码（剥注释）—— **零扫描判红**：读不到/读空即失败（防白绿）。 */
function readSrc(rel: string): string {
  const p: string = path.join(root, 'entry/src/main/ets', rel);
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { raw = ''; }
  ok(`读到 ${rel}（非空，实得 ${raw.length} 字节）`, raw.length > 0);
  return stripComments(raw);
}

// ════════════════════════════════════════════════════════════════════════════
// ① 单一底座：core/splash.ets 3 常量为**别名**（⛔ 不再复制数值 / 表达式）
// ════════════════════════════════════════════════════════════════════════════
const splashSrc: string = readSrc('core/splash.ets');
ok('splash.ets: SPLASH_MIN_DWELL_MS 是别名（= MOTION_MIN_DWELL_MS）',
  splashSrc.indexOf('export const SPLASH_MIN_DWELL_MS: number = MOTION_MIN_DWELL_MS;') >= 0);
ok('⛔ splash.ets: SPLASH_MIN_DWELL_MS 不再复制派生式（MOTION_BASE_MS + MOTION_FAST_MS）',
  splashSrc.indexOf('SPLASH_MIN_DWELL_MS: number = MOTION_BASE_MS') < 0);
ok('splash.ets: SPLASH_TIMEOUT_MS 是别名（= MOTION_SPLASH_TIMEOUT_MS）',
  splashSrc.indexOf('export const SPLASH_TIMEOUT_MS: number = MOTION_SPLASH_TIMEOUT_MS;') >= 0);
ok('⛔ splash.ets: 不再引用 ORB_BREATH_MS（真源已换 MOTION_SPLASH_TIMEOUT_MS）',
  splashSrc.indexOf('ORB_BREATH_MS') < 0);
ok('splash.ets: SPLASH_MARK_ENTER_SCALE 是别名（= MOTION_ENTER_SCALE）',
  splashSrc.indexOf('export const SPLASH_MARK_ENTER_SCALE: number = MOTION_ENTER_SCALE;') >= 0);
ok('⛔ splash.ets: 不再有裸 0.92 字面量（复制数值）', splashSrc.indexOf('= 0.92;') < 0);

// ② core/design.ets 与 components/anim.ets **同源**（同一底座表达式，非"巧合同值"）
const designSrc: string = readSrc('core/design.ets');
ok('design.ets: MOTION_BREATH_MS 引用 ORB_BREATH_MS（同源）',
  designSrc.indexOf('export const MOTION_BREATH_MS: number = ORB_BREATH_MS;') >= 0);
ok('⛔ design.ets: MOTION_BREATH_MS 不再独立写 MOTION_SLOW_MS * 8',
  designSrc.indexOf('MOTION_BREATH_MS: number = MOTION_SLOW_MS * 8') < 0);
ok('design.ets: MOTION_BEAT_MS 引用 D_SLOW * 2（同源）',
  designSrc.indexOf('export const MOTION_BEAT_MS: number = D_SLOW * 2;') >= 0);
ok('⛔ design.ets: MOTION_BEAT_MS 不再独立写 MOTION_BREATH_MS / 4',
  designSrc.indexOf('MOTION_BEAT_MS: number = MOTION_BREATH_MS / 4') < 0);

// ════════════════════════════════════════════════════════════════════════════
// ③ 唯一出口：animSpring 死工厂已删；SplashOverlay 不再就地改 AnimateParam
// ════════════════════════════════════════════════════════════════════════════
const animSrc: string = readSrc('components/anim.ets');
ok('anim.ets: animSpring 死工厂已删（0 消费者）', animSrc.indexOf('export function animSpring(') < 0);
ok('anim.ets: springMotionCurve/springMotionMemo 已删',
  animSrc.indexOf('springMotionCurve') < 0 && animSrc.indexOf('springMotionMemo') < 0);
ok('anim.ets: 不再 import springParams（唯一消费链随 animSpring 移除）',
  animSrc.indexOf('springParams') < 0);
ok('anim.ets: 具名工厂 animEaseOutDelayed(delayMs, durationMs) 在位',
  /export function animEaseOutDelayed\(delayMs: number, durationMs: number\): AnimateParam \{/.test(animSrc));
// 取**调用片段**（只截函数体，剥掉上方文档注释 —— 注释里也写着常量名，不能当"消费者"证据）。
const mDelayed = animSrc.match(/export function animEaseOutDelayed\([\s\S]*?\n\}/);
ok('animEaseOutDelayed() 函数体可定位', mDelayed !== null);
const delayedBody: string = mDelayed === null ? '' : mDelayed[0];
ok('animEaseOutDelayed 的 curve 取自 tokens.EASE_OUT_CSS（不写字面量）',
  delayedBody.indexOf('curve: EASE_OUT_CSS') >= 0);
ok('⛔ animEaseOutDelayed 不含 spring / 裸 bezier（无超调缓出；mutation：改 springCurve() ⇒ 必红）',
  delayedBody.indexOf('spring') < 0 && delayedBody.indexOf('cubic-bezier') < 0);

const overlaySrc: string = readSrc('components/SplashOverlay.ets');
ok('⛔ SplashOverlay: 本地 withTiming 函数已删（就地改 AnimateParam 属越层）',
  overlaySrc.indexOf('function withTiming') < 0);
ok('SplashOverlay: 消费底座具名工厂 animEaseOutDelayed(SPLASH_HINT_DELAY_MS, SPLASH_HINT_FADE_MS)',
  overlaySrc.indexOf('animEaseOutDelayed(SPLASH_HINT_DELAY_MS, SPLASH_HINT_FADE_MS)') >= 0);
ok('SplashOverlay: 不 import @ohos/curves（曲线唯一出口 = components/anim.ets）',
  overlaySrc.indexOf("from '@ohos/curves'") < 0);

// ════════════════════════════════════════════════════════════════════════════
// ④ 数值不变（回归防线 —— 本波不许改任何观感：逐态新旧相等）
// ════════════════════════════════════════════════════════════════════════════
// 别名 == 底座真源（同源），且值 = 旧实现的逐字值。
eq('SPLASH_MIN_DWELL_MS === MOTION_MIN_DWELL_MS', SPLASH_MIN_DWELL_MS, MOTION_MIN_DWELL_MS);
eq('SPLASH_MIN_DWELL_MS = 400（旧值不变）', SPLASH_MIN_DWELL_MS, 400);
eq('SPLASH_TIMEOUT_MS === MOTION_SPLASH_TIMEOUT_MS', SPLASH_TIMEOUT_MS, MOTION_SPLASH_TIMEOUT_MS);
eq('SPLASH_TIMEOUT_MS = 2560（旧值不变）', SPLASH_TIMEOUT_MS, 2560);
eq('SPLASH_MARK_ENTER_SCALE === MOTION_ENTER_SCALE', SPLASH_MARK_ENTER_SCALE, MOTION_ENTER_SCALE);
eq('SPLASH_MARK_ENTER_SCALE = 0.92（旧值不变）', SPLASH_MARK_ENTER_SCALE, 0.92);
eq('MOTION_MIN_DWELL_MS = 400（底座真源不变）', MOTION_MIN_DWELL_MS, 400);
eq('MOTION_SPLASH_TIMEOUT_MS = 2560（底座真源不变）', MOTION_SPLASH_TIMEOUT_MS, 2560);
eq('MOTION_ENTER_SCALE = 0.92（底座真源不变）', MOTION_ENTER_SCALE, 0.92);
// 呼吸/细节拍：同源 + 值不变。
eq('design.MOTION_BREATH_MS === ORB_BREATH_MS（同源）', DESIGN_BREATH_MS, ORB_BREATH_MS);
eq('design.MOTION_BREATH_MS = 2560（旧值不变）', DESIGN_BREATH_MS, 2560);
eq('design.MOTION_BEAT_MS === D_SLOW * 2（同源）', DESIGN_BEAT_MS, D_SLOW * 2);
eq('design.MOTION_BEAT_MS = 640（旧值不变）', DESIGN_BEAT_MS, 640);
// 开屏阶段/轨迹：行为逐态不变（证明"只换名称、不动观感"）。
eq('T1 时长 = MOTION_BASE_MS = 220（不变）', SPLASH_ENTER_MS, MOTION_BASE_MS);
eq('T2 时长 = MOTION_SLOW_MS = 320（不变）', SPLASH_EXIT_MS, MOTION_SLOW_MS);
eq('T1+T2 总时长 = 540（不变）', SPLASH_TOTAL_MS, 540);
eq('提示延迟 = 220（不变）', SPLASH_HINT_DELAY_MS, MOTION_BASE_MS);
eq('提示淡入 = 180（不变）', SPLASH_HINT_FADE_MS, MOTION_FAST_MS);
eq('阶段边界 T2 起点 = 220（不变）', splashPhaseStartMs(SPLASH_T2, false), 220);
eq('阶段边界 T3 起点 = 540（不变）', splashPhaseStartMs(SPLASH_T3, false), 540);
eq('reduceMotion T3 起点 = 400（不变）', splashPhaseStartMs(SPLASH_T3, true), 400);
eq('reduceMotion T2 时长 = 0（不变）', splashPhaseDurationMs(SPLASH_T2, true), 0);
eq('让位轨迹起点 α = 1（不变）', splashExitOpacityAt(0, false), 1);
eq('让位轨迹终点 α = 0（不变）', splashExitOpacityAt(SPLASH_EXIT_MS, false), 0);
eq('reduceMotion 让位即时 0（不变）', splashExitOpacityAt(0, true), 0);
// 在飞档位集合仍在（呼吸 2560 / 细节拍 640 ∈ 允许档），且呼吸 owner 唯一 = orb。
const inFlight = motionRoles().filter((m) => m.inFlight);
eq('在飞角色恰好 2 个（breath / beat）', inFlight.length, 2);
ok('breath/beat 时长 ∈ allowedDurations()',
  allowedDurations().indexOf(DESIGN_BREATH_MS) >= 0 && allowedDurations().indexOf(DESIGN_BEAT_MS) >= 0);

// 零扫描判红：确实扫到了 4 个源文件（防"文件挪走/正则失效"式白绿）。
ok(`零扫描判红：splash/design/anim/SplashOverlay 源码均非空`,
  splashSrc.length > 0 && designSrc.length > 0 && animSrc.length > 0 && overlaySrc.length > 0);
ok(`已复核 slug，T1/T2/T3 常量可解析：${SPLASH_T1}/${SPLASH_T2}/${SPLASH_T3}`,
  SPLASH_T1 === 'T1' && SPLASH_T2 === 'T2' && SPLASH_T3 === 'T3');

if (fail > 0) { console.log(`  motion_single_source: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion_single_source: ${pass} passed, 0 failed`);
process.exit(0);
