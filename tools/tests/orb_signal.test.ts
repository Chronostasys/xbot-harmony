/**
 * 光球「真实信号驱动动势」契约测试（波5j）。
 *
 * 分两部分（与 `tools/tests/orb.test.ts` 同法：组件层不进离线 harness ⇒ 读源码做形态断言）：
 *   A. 纯函数（`core/motion.ets` 的 `activityVitality` / `vitalityGain` / `clamp01`）—— 真函数跑数值；
 *   B. 组件源码形态契约（`components/AssistantOrb.ets`）—— 波5j 的**四条硬约束**：
 *      ① 动势必须由**真实信号**（`orbBeat` 增量 / 实际帧间隔）驱动，不得是常量或自嗨波形；
 *      ② 公转相位必须**累加**（`now × 缓动增益` 会在换态时跳相 —— 波5j 修掉的隐患）；
 *      ③ 收束动效只许碰 **transform/opacity**（不得出现 width/height/margin/padding/position/offset）；
 *      ④ 不引入新的 `setInterval` / 不在绘制路径写 `@State`（低端机门控）。
 *
 * ⚠️ 判别力自证（提交信息）：把动势改回常量、把相位改回 `now * spinCur`、或让收束去改 `width`
 *   ⇒ 本文件对应断言必红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  activityVitality, clamp01, MOTION_RATE_HALF, vitalityGain,
} from '../../entry/src/main/ets/core/motion';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ══ A. 纯函数：动势映射 ═══════════════════════════════════════════════════════

// (A1) clamp01
{
  eq('clamp01 负数 ⇒ 0', clamp01(-3), 0);
  eq('clamp01 NaN ⇒ 0', clamp01(Number.NaN), 0);
  eq('clamp01 >1 ⇒ 1', clamp01(1.7), 1);
  eq('clamp01 中间原样', clamp01(0.42), 0.42);
}

// (A2) activityVitality：边界 —— "没前进"就是没前进
{
  eq('零增量 ⇒ 0', activityVitality(0, 33), 0);
  eq('负增量（心跳回退/重置）⇒ 0', activityVitality(-5, 33), 0);
  eq('零间隔 ⇒ 0（不外推）', activityVitality(5, 0), 0);
  eq('负间隔 ⇒ 0', activityVitality(5, -1), 0);
  eq('两者皆为 0 ⇒ 0', activityVitality(0, 0), 0);
}

// (A3) activityVitality：半饱和点 / 值域 / 单调性
{
  // 半饱和点定义：rate == MOTION_RATE_HALF ⇒ 恰 0.5
  eq('rate = 半饱和点 ⇒ 恰 0.5', activityVitality(MOTION_RATE_HALF * 100, 100), 0.5);
  ok('值域 ⊆ [0,1)', activityVitality(1e9, 1) < 1 && activityVitality(1, 1) >= 0);
  ok('极大速率逼近但不到 1', activityVitality(1000, 1) > 0.99 && activityVitality(1000, 1) < 1);
  // 单调不减（同样间隔下增量越大越"有动势"）
  let prev = -1;
  let mono = true;
  for (let d = 0; d <= 20; d++) {
    const v = activityVitality(d, 100);
    if (v < prev) { mono = false; }
    prev = v;
  }
  ok('对增量单调不减', mono);
  // 同样增量下，间隔越长（速率越低）动势越低
  ok('间隔越长动势越低', activityVitality(5, 1000) < activityVitality(5, 10));
  // 常态量级：20 码点/秒（0.02/ms）应落在 0.5 附近（"常态在中点"是设计前提）
  const normal = activityVitality(20, 1000);
  ok('常态（20 字/秒）落 0.5 附近', normal > 0.45 && normal < 0.55);
  // 停顿的低速率应明显 < 0.2（"慢下来了"可被读出）
  ok('低速（2 字/秒）< 0.2', activityVitality(2, 1000) < 0.2);
}

// (A4) vitalityGain：**中点恰为 1.0**（保证既有观感逐值不变）+ 对称有界
{
  eq('vital=0.5 ⇒ 恰 1.0（既有观感不变）', vitalityGain(0.5, 0.18), 1);
  eq('vital=0 ⇒ 1-span', vitalityGain(0, 0.18), 1 - 0.18);
  eq('vital=1 ⇒ 1+span', vitalityGain(1, 0.18), 1 + 0.18);
  eq('span=0 ⇒ 恒 1（可关断）', vitalityGain(0.9, 0), 1);
  eq('负 span 视为 0', vitalityGain(0.9, -1), 1);
  // 越界 vital 被夹（不会放大出意外值）
  eq('vital>1 夹到 1', vitalityGain(9, 0.18), 1 + 0.18);
  eq('vital<0 夹到 0', vitalityGain(-9, 0.18), 1 - 0.18);
  // 对称性：0.5±d 的偏离互为反向、等量
  const up = vitalityGain(0.5 + 0.2, 0.5) - 1;
  const dn = 1 - vitalityGain(0.5 - 0.2, 0.5);
  ok('关于中点对称', Math.abs(up - dn) < 1e-12);
  ok('对 vital 单调递增', vitalityGain(0.8, 0.3) > vitalityGain(0.2, 0.3));
}

// ══ B. 组件源码形态契约 ═══════════════════════════════════════════════════════
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const orbSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'AssistantOrb.ets'), 'utf-8');
const motionSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'motion.ets'), 'utf-8');

/** 取方法体文本（缩进约定：成员方法结束于行首两空格 + `}`）。 */
function bodyOf(src: string, sig: string): string {
  const i = src.indexOf(sig);
  if (i < 0) { return ''; }
  const j = src.indexOf('\n  }', i);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const drawBody: string = bodyOf(orbSrc, 'private draw(): void {');
ok('draw() 函数体可定位（形态守护有效）', drawBody.length > 400);

// (B1) ① 动势由**真实信号**驱动（不是常量、不是自嗨波形）
has(drawBody, 'const dBeat: number = this.orbBeat - this.beatSample;',
  '动势分子 = orbBeat 的**增量**（真实信号）');
has(drawBody, 'const sdt: number = now - this.beatSampleAt;',
  '动势分母 = **实际帧间隔**（不是固定常数）');
has(drawBody, 'activityVitality(dBeat, sdt)', '动势经纯函数 activityVitality 映射');
has(drawBody, 'vitalityGain(this.vitalCur, ORB_VITAL_AMP_SPAN)', '呼吸幅度被动势调制');
has(drawBody, 'vitalityGain(this.vitalCur, ORB_VITAL_SPIN_SPAN)', '公转速度被动势调制');
has(drawBody, 'vitalityGain(this.vitalCur, ORB_VITAL_HALO_SPAN)', '光晕被动势调制');
has(drawBody, 'this.vitalCur = this.vitalCur + (vitalTarget - this.vitalCur) * k;',
  '动势按实际帧间隔平滑收敛（不跳变）');
hasNot(drawBody, 'Math.random(', '动势不得来自随机数（自嗨）');
// 动势必须在绘制前算好（三者都被真正用上，而不是算了不用）
has(drawBody, '* this.ampCur * vAmp', 'vAmp 真正作用于呼吸幅度');
has(drawBody, 'this.spinPhaseMs += dt * this.spinCur * vSpin;', 'vSpin 真正作用于相位推进');
has(drawBody, 'this.haloCur * vHalo', 'vHalo 真正作用于光晕');

// (B2) ② 相位**累加**（修掉 `now × 缓动增益` 的跳相）
hasNot(orbSrc, 'now * this.spinCur', '不再用 now×增益（换态会跳相）');
has(orbSrc, 'private spinPhaseMs: number = 0;', '存在相位累加器');
has(orbSrc, '用 `now * spinCur`', '跳相隐患的理由写在字段注释里（防回归）');

// (B3) ③ 收束：只动 transform/opacity
const settleBody: string = bodyOf(orbSrc, 'private applySettle(on: boolean): void {');
ok('applySettle() 函数体可定位', settleBody.length > 40);
has(settleBody, 'animateTo(animBase(), () => {', '收束复用既有动效底座 animBase()（不新造曲线/时长）');
hasNot(settleBody, '.width(', '收束不改 width（不 relayout）');
hasNot(settleBody, '.height(', '收束不改 height');
hasNot(settleBody, '.margin(', '收束不改 margin');
hasNot(settleBody, '.padding(', '收束不改 padding');
hasNot(settleBody, '.position(', '收束不改 position');
hasNot(settleBody, '.offset(', '收束不改 offset');
has(orbSrc, '@State settled: boolean = false;', '收束位是 @State（值变化通道）');
has(orbSrc, 'this.applySettle(!this.active);', '回合结束（active→false）触发收束');
has(orbSrc, '.opacity(this.visAlpha())', '可见不透明度走单一取值口（仅 opacity）');
has(orbSrc, '.scale({ x: this.visScale(), y: this.visScale() })', '可见缩放走单一取值口（仅 transform）');
// 可见属性口只被 opacity/scale 使用
const alphaBody: string = bodyOf(orbSrc, 'private visAlpha(): number {');
const scaleBody: string = bodyOf(orbSrc, 'private visScale(): number {');
ok('visAlpha() 可定位', alphaBody.length > 20);
ok('visScale() 可定位', scaleBody.length > 20);
hasNot(alphaBody, 'width', 'visAlpha 不涉及布局');
hasNot(scaleBody, 'width', 'visScale 不涉及布局');

// (B4) ④ 低端机：不新增定时器、绘制路径不写 @State
{
  const timerCount = orbSrc.split('setInterval(').length - 1;
  eq('全文件只有 1 处 setInterval（既有绘制循环）', timerCount, 1);
  hasNot(drawBody, 'this.settled =', 'draw() 不写 @State（每帧 setState 会整树重渲染）');
  hasNot(drawBody, 'this.entered =', 'draw() 不写 @State（entered）');
  hasNot(drawBody, 'animateTo(', 'draw() 不做动画（动画只在态切换时触发）');
  hasNot(drawBody, 'setInterval(', 'draw() 不起定时器');
  hasNot(drawBody, 'paletteOf(', 'draw() 内不调 paletteOf（每帧零解析 —— 与 orb.test.ts 同源）');
  hasNot(drawBody, 'effectsOf(', 'draw() 内不调 effectsOf');
  // 动势增益是**标量运算**，不引入对象分配
  hasNot(drawBody, 'new OrbParticle', 'draw() 不自造粒子对象（沿用既有 orbParticles）');
}

// (B5) 基类成员名黑名单（新增成员不得撞基类）
{
  const banned: string[] = ['size', 'width', 'height', 'position', 'offset', 'scale', 'rotate',
    'opacity', 'visibility', 'clip', 'zIndex', 'id', 'key', 'enabled'];
  for (let i = 0; i < banned.length; i++) {
    const b: string = banned[i];
    hasNot(orbSrc, `private ${b}:`, `基类成员名黑名单：private ${b}: 未出现`);
    hasNot(orbSrc, `@State ${b}:`, `基类成员名黑名单：@State ${b}: 未出现`);
  }
  // 新增成员确实用了安全名
  has(orbSrc, 'private vitalCur: number = ORB_VITAL_INIT;', '动势成员名安全（vitalCur）');
  has(orbSrc, 'private spinPhaseMs: number = 0;', '相位成员名安全（spinPhaseMs）');
}

// (B6) 纯逻辑在 core 层、组件只消费（分层不被击穿）
has(motionSrc, 'export function activityVitality(', 'activityVitality 在 core/motion.ets（可脱机单测）');
has(motionSrc, 'export function vitalityGain(', 'vitalityGain 在 core/motion.ets');
has(orbSrc, "import { activityVitality, vitalityGain } from '../core/motion';",
  '组件从 core/motion 引入（不在组件里重写映射）');
hasNot(orbSrc, 'export function activityVitality', '组件层不得自带一份映射实现（单一真源）');

// (B7) 既有契约未被顶掉（本波不得回退上一轮的数值/门控）
has(orbSrc, 'const ORB_TOOL_SPIN_GAIN: number = 2.2;', 'tool 公转 2.2× 仍在（未被本波改动）');
has(orbSrc, 'const ORB_EASE_MS: number = MOTION_BREATH_MS / 8;', '缓动刻度仍是主呼吸/8');
has(orbSrc, 'this.ready && this.active && !this.paused && !this.reduceMotion;',
  '停表门控仍含 paused + reduceMotion');

if (fail > 0) {
  console.log(`  orb_signal: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  orb_signal: ${pass} passed, 0 failed`);
process.exit(0);
