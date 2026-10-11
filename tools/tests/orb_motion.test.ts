/**
 * `orb_motion` —— 光球「动效再提升一档」的**纯逻辑判据**（目标⑤"比苹果官方 Siri 还好看"）。
 *
 * 覆盖三件事（⛔ 不占设备、纯逻辑；`run.sh` 只把 `core/**` 当纯 TS 编译 ⇒ 纯函数可**真跑数值**）：
 *   ① **双频呼吸**（`orbBreathFine` / `orbRadiusFine` / `orbOpacityFine`）：
 *      主呼吸（快吸慢呼）+ 一个 2× 谐波的窗口化微弱分量 ⇒ 端点逐值不变、值域 ⊆ [0,1]、
 *      **周期不变**（谐波是整数倍 ⇒ 不新造时长刻度）、且**确实非常量**（去机械感）、起伏有界（克制）。
 *   ② **轨道景深**（`orbDepthNear` / `orbDepthGain`）：近层 > 远层（对 y 单调）、有界、
 *      `k=0` 恒 1（可关断 ⇒ 退化平面环）、⛔ 两端增益为**正** ⇒ **任何态都不会"静止不可见"**。
 *   ③ **态 → 景深强度**（`orbDepthOf`）：四态有序（tool > thinking > secondary > idle）、有界、
 *      未知态回落 thinking ⇒ "深度 = 在场感"，且**与颜色无关**（porcelain 下 tool/thinking 环同色）。
 *
 * 形态契约（组件层读**真实源码** —— 组件不进离线 harness，`run.sh` 的 for 循环只收 `core/**`；
 * 本仓既有先例 `tools/tests/orb.test.ts` / `one_inflight_motion.test.ts` 同法）：
 *   · 组件**必须真消费**新纯函数（⛔ 防"死消费"：函数全仓 0 调用点、却"看起来改好了"）；
 *   · **不新增动效面**（`animateTo(` 仍 2 处、`.transition(`/`.animation(` 仍 0 处 —— 与
 *     `tools/tests/motion_budget.test.ts` 的台账同源）；**不新增定时器**（`setInterval(` 仍 1 处）；
 *   · 新频率一律**由底座的相位函数派生**（`ORB_BREATH_FINE_HARMONIC × orbPhase(t, periodMs)`），
 *     ⛔ 不得写成毫秒字面量（那是"自造一套时长"）。
 *
 * ── mutation 自证（必红；实测见交付报告）────────────────────────────────────────
 *   · `ORB_BREATH_FINE_AMP` → 0                      ⇒ ①"确实有次级起伏"红；
 *   · `ORB_DEPTH_IDLE` → 0                            ⇒ ③"四态都 > 0 / 有序"红；
 *   · 把 `orbDepthOf('idle')` 改成 1（或打乱次序）     ⇒ ③"有序"红；
 *   · 把 ripple 频率写成毫秒字面量（`orbPhase(t, 1280)`）⇒ ④"频率由底座派生"红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  ORB_BREATH_MS, ORB_BREATH_MIN, ORB_BREATH_MAX, ORB_OPACITY_MIN, ORB_PARTICLE_ALPHA_MIN,
  ORB_BREATH_FINE_HARMONIC, orbBreath, orbBreathFine, orbRadius, orbRadiusFine, orbOpacity, orbOpacityFine,
  ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR,
  ORB_DEPTH_THINKING, ORB_DEPTH_TOOL, ORB_DEPTH_SECONDARY, ORB_DEPTH_IDLE,
  orbDepthNear, orbDepthGain, orbDepthOf,
} from '../../entry/src/main/ets/core/orb';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function approx(name: string, got: number, want: number, eps: number): void {
  if (Math.abs(got - want) <= eps && Number.isFinite(got)) { pass++; }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} (±${eps})`); }
}

const EPS = 1e-9;
const P = ORB_BREATH_MS;              // 2560
const PEAK = P * 0.4;                 // = ORB_BREATH_INHALE × P

// ════════════════════════════════════════════════════════════════════════════
// ① 双频呼吸
// ════════════════════════════════════════════════════════════════════════════
{
  // ①a 谐波是**整数倍**（⇒ 周期仍是主呼吸刻度，不新造时长）+ 设计值 = 2
  ok(`① 谐波倍数是整数 ≥2（周期仍是 periodMs；实得 ${ORB_BREATH_FINE_HARMONIC}）`,
    Number.isInteger(ORB_BREATH_FINE_HARMONIC) && ORB_BREATH_FINE_HARMONIC >= 2);
  eq('① 谐波倍数 = 2（设计值；改成 1 = 退回单频，改成 3 = 换波形）', ORB_BREATH_FINE_HARMONIC, 2);

  // ①b 端点**逐值不变**（窗口在 b=0/1 处恰为 0）—— 既有"峰值 = 1 / 谷值 = 0"契约自动成立
  approx('① 谷值不变：orbBreathFine(0) = 0', orbBreathFine(0, P), 0, EPS);
  approx('① 峰值不变：orbBreathFine(inhale×P) = 1', orbBreathFine(PEAK, P), 1, EPS);
  approx('① 端点同值（单频 vs 双频：t=0）', orbBreathFine(0, P), orbBreath(0, P), EPS);
  approx('① 端点同值（单频 vs 双频：峰值）', orbBreathFine(PEAK, P), orbBreath(PEAK, P), EPS);

  // ①c 周期**不变**（谐波整数倍 ⇒ 叠加后仍以 periodMs 为周期）
  ok('① 周期不变：orbBreathFine(t+P) = orbBreathFine(t)', (() => {
    for (let t = 0; t < P; t += P / 37) {
      if (Math.abs(orbBreathFine(t + P, P) - orbBreathFine(t, P)) > 1e-9) {
        console.log(`      breach t=${t}`); return false;
      }
    }
    return true;
  })());

  // ①d 值域 ⊆ [0,1]（下游 orbRadiusFine/orbOpacityFine 的值域契约不受影响）
  ok('① 值域 ⊆ [0,1]', (() => {
    for (let t = -2 * P; t <= 2 * P; t += P / 61) {
      const v = orbBreathFine(t, P);
      if (!Number.isFinite(v) || v < -EPS || v > 1 + EPS) { console.log(`      breach t=${t} v=${v}`); return false; }
    }
    return true;
  })());

  // ①e **确实非常量**（否则"双频"是白做）+ **起伏有界**（克制，不是抖动）
  let maxDev = 0;
  for (let t = 0; t <= P; t += P / 512) {
    const d = Math.abs(orbBreathFine(t, P) - orbBreath(t, P));
    if (d > maxDev) { maxDev = d; }
  }
  ok(`① 确实有次级起伏（非常量；实测峰值偏差 ${maxDev.toFixed(4)} > 0.05）`, maxDev > 0.05);
  ok(`① 起伏有界且克制（实测 ${maxDev.toFixed(4)} ≤ 0.25；"呼吸"不是"抖"）`, maxDev <= 0.25);

  // ①f 半径/透明度映射与单频**同源**（端点一致 ⇒ 同一映射；只是喂不同的呼吸值）
  const baseR = 6.82;
  approx('① orbRadiusFine(端点) = orbRadius(端点)（同一映射）',
    orbRadiusFine(0, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX),
    orbRadius(0, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX), EPS);
  approx('① orbOpacityFine(谷) = ORB_OPACITY_MIN',
    orbOpacityFine(0, P, ORB_OPACITY_MIN, 1), ORB_OPACITY_MIN, EPS);
  ok('① 双频半径值域 ⊆ [base×min, base×max]', (() => {
    const lo = baseR * ORB_BREATH_MIN, hi = baseR * ORB_BREATH_MAX;
    for (let t = -P; t <= 2 * P; t += P / 53) {
      const v = orbRadiusFine(t, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX);
      if (v < lo - EPS || v > hi + EPS) { console.log(`      breach t=${t} v=${v}`); return false; }
    }
    return true;
  })());
  ok('① 双频透明度值域 ⊆ [ORB_OPACITY_MIN, 1]', (() => {
    for (let t = -P; t <= 2 * P; t += P / 47) {
      const v = orbOpacityFine(t, P, ORB_OPACITY_MIN, 1);
      if (v < ORB_OPACITY_MIN - EPS || v > 1 + EPS) { console.log(`      breach t=${t} v=${v}`); return false; }
    }
    return true;
  })());
}

// ════════════════════════════════════════════════════════════════════════════
// ② 轨道景深（近大远小）
// ════════════════════════════════════════════════════════════════════════════
{
  // ②a 远近度映射：端点/中点/单调/非有限输入 fail-safe
  eq('② orbDepthNear(-1) = 0（环后缘/最远）', orbDepthNear(-1), 0);
  eq('② orbDepthNear(0) = 0.5（侧向）', orbDepthNear(0), 0.5);
  eq('② orbDepthNear(1) = 1（环前缘/最近）', orbDepthNear(1), 1);
  eq('② orbDepthNear(NaN) = 0.5（中性 fail-safe，不倒向任一端）', orbDepthNear(Number.NaN), 0.5);
  eq('② 越界夹紧（y=-2 ⇒ 0）', orbDepthNear(-2), 0);
  eq('② 越界夹紧（y=2 ⇒ 1）', orbDepthNear(2), 1);
  ok('② 对 y 单调不减', (() => {
    let prev = orbDepthNear(-1);
    for (let y = -1; y <= 1; y += 1 / 64) {
      const v = orbDepthNear(y);
      if (v < prev - 1e-12) { console.log(`      dip y=${y} v=${v} prev=${prev}`); return false; }
      prev = v;
    }
    return true;
  })());

  // ②b 两端增益为正（"任何态不得静止不可见"）+ 近 > 远
  ok('② 远端增益为正（远粒子也看得见，只是更小更弱）', ORB_DEPTH_SIZE_FAR > 0 && ORB_DEPTH_ALPHA_FAR > 0);
  ok('② 近端增益 > 远端（尺寸）', ORB_DEPTH_SIZE_NEAR > ORB_DEPTH_SIZE_FAR);
  ok('② 近端增益 > 远端（亮度）', ORB_DEPTH_ALPHA_NEAR > ORB_DEPTH_ALPHA_FAR);

  // ②c k=0 ⇒ 恒 1（可关断 ⇒ 退化平面环；也是"回退开关"）
  eq('② k=0 且 y=1 ⇒ 恰 1', orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 0), 1);
  eq('② k=0 且 y=-1 ⇒ 恰 1', orbDepthGain(-1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 0), 1);
  eq('② k=0 且 y=0 ⇒ 恰 1', orbDepthGain(0, ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR, 0), 1);

  // ②d 近层 > 远层（对 y 单调）+ 对 k 单调 + 有界
  ok('② 近层 > 远层（尺寸增益对 y 单调不减）', (() => {
    let prev = -1;
    for (let y = -1; y <= 1; y += 1 / 64) {
      const g = orbDepthGain(y, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 1);
      if (g < prev - 1e-12) { return false; }
      prev = g;
    }
    return true;
  })());
  ok('② 对强度 k 单调不减（越"在场"越立体）',
    orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 1) > orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 0.5));
  ok('② 有界 ⊆ [min(1,far), max(1,near)]（尺寸）', (() => {
    const lo = Math.min(1, ORB_DEPTH_SIZE_FAR) - EPS, hi = Math.max(1, ORB_DEPTH_SIZE_NEAR) + EPS;
    for (let k = 0; k <= 1; k += 1 / 16) {
      for (let y = -1; y <= 1; y += 1 / 16) {
        const g = orbDepthGain(y, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, k);
        if (g < lo || g > hi) { console.log(`      breach k=${k} y=${y} g=${g}`); return false; }
      }
    }
    return true;
  })());
  ok('② 有界 ⊆ [min(1,far), max(1,near)]（亮度）', (() => {
    const lo = Math.min(1, ORB_DEPTH_ALPHA_FAR) - EPS, hi = Math.max(1, ORB_DEPTH_ALPHA_NEAR) + EPS;
    for (let k = 0; k <= 1; k += 1 / 16) {
      for (let y = -1; y <= 1; y += 1 / 16) {
        const g = orbDepthGain(y, ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR, k);
        if (g < lo || g > hi) { console.log(`      breach k=${k} y=${y} g=${g}`); return false; }
      }
    }
    return true;
  })());
  ok('② k 越界或负值被夹（不放大出意外值）',
    orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, -3) === 1
    && orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 9) === orbDepthGain(1, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, 1));
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 态 → 景深强度（"深度 = 在场感"）
// ════════════════════════════════════════════════════════════════════════════
{
  const modes: string[] = ['thinking', 'tool', 'secondary', 'idle'];
  const ks: number[] = [ORB_DEPTH_THINKING, ORB_DEPTH_TOOL, ORB_DEPTH_SECONDARY, ORB_DEPTH_IDLE];
  ok('③ orbDepthOf 四态的取值与具名常量一致',
    orbDepthOf('thinking') === ORB_DEPTH_THINKING && orbDepthOf('tool') === ORB_DEPTH_TOOL
    && orbDepthOf('secondary') === ORB_DEPTH_SECONDARY && orbDepthOf('idle') === ORB_DEPTH_IDLE);
  ok('③ 四态景深 ∈ [0,1]', ks.every((v) => v >= 0 && v <= 1), `got [${ks.join(', ')}]`);
  ok(`③ ⛔ 任何态都不是"平面到看不见"（全部 > 0；实得 idle=${ORB_DEPTH_IDLE}）`,
    ORB_DEPTH_IDLE > 0 && ORB_DEPTH_SECONDARY > 0 && ORB_DEPTH_THINKING > 0 && ORB_DEPTH_TOOL > 0);
  ok(`③ 有序：tool(${ORB_DEPTH_TOOL}) > thinking(${ORB_DEPTH_THINKING}) > secondary(${ORB_DEPTH_SECONDARY}) > idle(${ORB_DEPTH_IDLE})`,
    ORB_DEPTH_TOOL > ORB_DEPTH_THINKING && ORB_DEPTH_THINKING > ORB_DEPTH_SECONDARY && ORB_DEPTH_SECONDARY > ORB_DEPTH_IDLE);
  eq('③ 未知/空态回落 thinking（宁可满档，不静默降级）', orbDepthOf('nope'), ORB_DEPTH_THINKING);
  eq('③ 空串回落 thinking', orbDepthOf(''), ORB_DEPTH_THINKING);

  // ③ 组合防线：**任一态**的最暗粒子（远端 + 最低透明度 + 最低呼吸透明度）都还必须看得见
  ok('③ ⛔ 任何态"静止不可见"都不可能（最暗远端粒子 α > 0.05）', (() => {
    for (let i = 0; i < modes.length; i++) {
      const dAlpha = orbDepthGain(-1, ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR, ks[i]);
      const minA = ORB_PARTICLE_ALPHA_MIN * ORB_OPACITY_MIN * dAlpha;
      if (!(minA > 0.05)) { console.log(`      breach mode=${modes[i]} minA=${minA}`); return false; }
    }
    return true;
  })());
  ok('③ 任何态的呼吸半径下限为正（base×ORB_BREATH_MIN > 0）',
    ORB_BREATH_MIN > 0 && ORB_BREATH_MAX > ORB_BREATH_MIN);
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 形态契约（读真实源码；组件不进离线 harness）
// ════════════════════════════════════════════════════════════════════════════
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const orbSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'AssistantOrb.ets'), 'utf-8');
const coreSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'orb.ets'), 'utf-8');

/** 计次（只数**调用片段**，不"取整行猜" —— 本仓 GOTCHA）。 */
function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}
/** 取含某子串的**那一行**（用于钉"频率由底座派生"，避免整文件范围误伤）。 */
function lineWith(src: string, needle: string): string {
  const lines: string[] = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(needle) >= 0) { return lines[i]; }
  }
  return '';
}

/** 剥注释（⛔ 本仓 GOTCHA：注释里的毫秒数/API 提及不是代码）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ④a 零扫描判红（源码没读到 ⇒ 白绿防线判红）
ok(`④ 零扫描判红：读到 AssistantOrb.ets（${orbSrc.length} 字符 > 4000）`, orbSrc.length > 4000);
ok(`④ 零扫描判红：读到 core/orb.ets（${coreSrc.length} 字符 > 4000）`, coreSrc.length > 4000);

// ④b **死消费防线**：新纯函数必须真被组件消费（⛔ "方法体存在"会假绿 ⇒ 钉调用点计数）
ok('④ 组件消费 orbRadiusFine（双频半径接线）', count(orbSrc, 'orbRadiusFine(') >= 1);
ok('④ 组件消费 orbOpacityFine（双频透明度接线）', count(orbSrc, 'orbOpacityFine(') >= 1);
ok('④ 组件消费 orbDepthOf（态 → 景深策略上收 core）', count(orbSrc, 'orbDepthOf(') >= 1);
ok('④ 组件消费 orbDepthGain（景深增益；判据与渲染同源）', count(orbSrc, 'orbDepthGain(') >= 2);
ok('④ 组件从 core/orb 引入新符号（单一真源）', orbSrc.indexOf("from '../core/orb'") >= 0);
ok('④ 景深强度经缓动后传入粒子绘制（态变不硬切）',
  orbSrc.indexOf('this.paintParticles(ctx, ps, c, ringR, unit, op, baseW, this.depthCur);') >= 0);

// ④c **不新增动效面 / 不新增定时器**（与 motion_budget 台账、one_inflight_motion 同源）
eq('④ 不新增动画面：animateTo( 仍 2 处（入场 + 收束）', count(orbSrc, 'animateTo('), 2);
eq('④ 不新增过渡：.transition( 仍 0 处', count(orbSrc, '.transition('), 0);
eq('④ 不新增属性动画：.animation( 仍 0 处', count(orbSrc, '.animation('), 0);
eq('④ 不新增定时器：setInterval( 仍 1 处（既有绘制循环）', count(orbSrc, 'setInterval('), 1);

// ④d **时长/频率来底座**（形态）：谐波频率由相位函数 × 整数倍派生，⛔ 非毫秒字面量
//    ⚠️ 只在**剥注释后**的代码上查毫秒字面量：核心注释里合法地写着 "= 2560ms"（那是文档），
//       按原文查会把文档误判成"自造时长"（本仓"判据 ≠ 信号"的典型）。
const coreCode: string = stripComments(coreSrc);
ok('④ core 定义谐波倍数常量（可脱机断言的真源）',
  coreSrc.indexOf('export const ORB_BREATH_FINE_HARMONIC: number = 2;') >= 0);
const rippleLine: string = lineWith(coreSrc, 'const ripple:');
ok('④ 谐波频率由底座派生（相位函数 × 整数倍），非自造时长',
  rippleLine.indexOf('ORB_BREATH_FINE_HARMONIC') >= 0 && rippleLine.indexOf('orbPhase(t, periodMs)') >= 0,
  `ripple 行 = ${rippleLine.trim()}`);
ok('④ 呼吸周期仍唯一来自 periodMs（代码里无裸 2560 毫秒字面量）',
  coreCode.indexOf('2560') < 0);

// ④e 静息态 fail-safe（⑨ 的正向形态）：可见不透明度走单一取值口，不得写成三元隐藏
ok('④ 静息可见性走单一取值口 .opacity(this.visAlpha())',
  count(orbSrc, '.opacity(this.visAlpha())') >= 1);
// ⚠️ 只查**喂给 `.opacity(` 的三元**（`? 1 : 0` 在别处可能是**数值**三元，如
//    `const mixTarget = st.ringTool ? 1 : 0;` —— 按裸形态查会假红，本仓已踩过）。
const opacityLines: string[] = orbSrc.split('\n').filter((l: string) => l.indexOf('.opacity(') >= 0);
ok('④ ⛔ 不得出现"三元隐藏"的静息态（`.opacity(... ? 1 : 0)` / `? 0 : 1`）',
  opacityLines.every((l: string) => l.indexOf('? 1 : 0') < 0 && l.indexOf('? 0 : 1') < 0),
  `命中行 = ${opacityLines.join(' | ')}`);

if (fail > 0) {
  console.log(`  orb_motion: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  orb_motion: ${pass} passed, 0 failed`);
process.exit(0);
