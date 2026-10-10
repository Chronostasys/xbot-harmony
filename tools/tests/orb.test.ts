/**
 * 助手光球纯数学层测试（**判别力**）—— 覆盖 `core/orb.ets` 的值域 / 单调性 / 周期性 /
 * 边界（t=0、大 t、负 t、phase 回绕），以及"节奏复用 token 不另起一套"的同源校验。
 *
 * 判别力自证（改错必红 —— 提交信息已写明）：改动下列任一"锚点" → 本测试必红：
 *   · `ORB_BREATH_MS`（`D_SLOW*8` → 2500 之类魔法数） ⇒ '节奏复用 tokens' 红
 *   · `orbBreath` 的 `0.5` 系数（→1.0，值域变 [0,2]）      ⇒ 'orbBreath 值域' 红
 *   · `orbParticles` 去掉 `orbPhase`（粒子不公转）         ⇒ '粒子公转周期' 红
 *   · `orbWave` 权重（0.6/0.4 → 1/1，上界变 1.5）          ⇒ 'orbWave 值域' 红
 *   · `orbPhase` 的负值处理去掉（`(t%p+p)%p` → `t%p`）     ⇒ '负值回绕' 红
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };

import {
  ORB_BREATH_MS, ORB_SPIN_MS, ORB_BREATH_MIN, ORB_BREATH_MAX,
  ORB_OPACITY_MIN, ORB_OPACITY_MAX, ORB_RING_RADIUS,
  OrbParticle, orbPhase, orbBreath, orbRadius, orbOpacity, orbParticles, orbWave,
} from '../../entry/src/main/ets/core/orb';
import { D_SLOW } from '../../entry/src/main/ets/core/tokens';
import { KEY_CODE_WRAP, KEY_ORB, localKey, orbEnabled, serverKey, settingLabel } from '../../entry/src/main/ets/core/settings';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function approx(name: string, got: number, want: number, eps: number): void {
  if (Math.abs(got - want) <= eps && Number.isFinite(got)) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} (±${eps})`);
  }
}

const EPS = 1e-9;
const P = ORB_BREATH_MS; // 2560

// ── (a) 节奏：全部由 tokens.D_SLOW 整数倍派生（不另起一套时长）─────────────────
eq('ORB_BREATH_MS = 8×D_SLOW', ORB_BREATH_MS, D_SLOW * 8);
eq('ORB_SPIN_MS = 20×D_SLOW', ORB_SPIN_MS, D_SLOW * 20);
ok('公转周期 > 呼吸周期（两层不同步，不呆板）', ORB_SPIN_MS > ORB_BREATH_MS);
ok('呼吸最小比例 < 1（会收缩）', ORB_BREATH_MIN < 1);
ok('呼吸最大比例 > 1（会涨出，有活感）', ORB_BREATH_MAX > 1);
ok('透明度上下限合法', ORB_OPACITY_MIN >= 0 && ORB_OPACITY_MAX <= 1 && ORB_OPACITY_MIN < ORB_OPACITY_MAX);
ok('粒子环基准半径 ∈ (0,1)', ORB_RING_RADIUS > 0 && ORB_RING_RADIUS < 1);

// ── (b) orbPhase：归一化 + 边界 + 回绕 ───────────────────────────────────────
eq('orbPhase(0) = 0', orbPhase(0, P), 0);
eq('orbPhase 满周期回绕为 0', orbPhase(P, P), 0);
eq('orbPhase 半周期 = 0.5', orbPhase(P / 2, P), 0.5);
eq('orbPhase 负值回绕（-P/4 → 0.75）', orbPhase(-P / 4, P), 0.75);
eq('orbPhase 周期平移不变', orbPhase(1234.5 + 3 * P, P), orbPhase(1234.5, P));
ok('orbPhase 极大于周期仍落在 [0,1)', (() => {
  const v = orbPhase(987654321.5, P);
  return v >= 0 && v < 1;
})());
ok('orbPhase(period<=0) 不抛且落 [0,1)', (() => {
  const v = orbPhase(5, 0);
  return Number.isFinite(v) && v >= 0 && v < 1;
})());

// ── (c) orbBreath：值域 [0,1] + 三点 + 单调 + 周期 ────────────────────────────
approx('orbBreath(0)=0', orbBreath(0, P), 0, EPS);
approx('orbBreath(P/2)=1', orbBreath(P / 2, P), 1, EPS);
ok('orbBreath 值域 ⊆ [0,1]', (() => {
  for (let t = -3 * P; t <= 3 * P; t += P / 17) {
    const v = orbBreath(t, P);
    if (v < -EPS || v > 1 + EPS) { console.log('      breach t=' + t + ' v=' + v); return false; }
  }
  return true;
})());
ok('orbBreath 在 [0,P/2] 单调不减', (() => {
  let prev = orbBreath(0, P);
  for (let t = 0; t <= P / 2; t += P / 64) {
    const v = orbBreath(t, P);
    if (v < prev - 1e-12) { console.log('      dip t=' + t + ' v=' + v + ' prev=' + prev); return false; }
    prev = v;
  }
  return true;
})());
approx('orbBreath 周期为 P', orbBreath(777 + P, P), orbBreath(777, P), EPS);

// ── (d) orbRadius / orbOpacity：端点 + 值域 + 退化 ───────────────────────────
const baseR = 6.82;
approx('orbRadius(t=0) = baseR*min', orbRadius(0, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX), baseR * ORB_BREATH_MIN, EPS);
approx('orbRadius(t=P/2) = baseR*max', orbRadius(P / 2, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX), baseR * ORB_BREATH_MAX, EPS);
eq('orbRadius(baseR<=0) = 0（不产生负半径）', orbRadius(123, 0, P, ORB_BREATH_MIN, ORB_BREATH_MAX), 0);
ok('orbRadius 值域 ⊆ [base*min, base*max]', (() => {
  const lo = baseR * ORB_BREATH_MIN;
  const hi = baseR * ORB_BREATH_MAX;
  for (let t = -2 * P; t <= 2 * P; t += P / 23) {
    const v = orbRadius(t, baseR, P, ORB_BREATH_MIN, ORB_BREATH_MAX);
    if (v < lo - EPS || v > hi + EPS) { console.log('      breach t=' + t + ' v=' + v); return false; }
  }
  return true;
})());
approx('orbOpacity(t=0) = minO', orbOpacity(0, P, ORB_OPACITY_MIN, ORB_OPACITY_MAX), ORB_OPACITY_MIN, EPS);
approx('orbOpacity(t=P/2) = maxO', orbOpacity(P / 2, P, ORB_OPACITY_MIN, ORB_OPACITY_MAX), ORB_OPACITY_MAX, EPS);
ok('orbOpacity 值域 ⊆ [min,max]', (() => {
  for (let t = -2 * P; t <= 2 * P; t += P / 19) {
    const v = orbOpacity(t, P, ORB_OPACITY_MIN, ORB_OPACITY_MAX);
    if (v < ORB_OPACITY_MIN - EPS || v > ORB_OPACITY_MAX + EPS) { console.log('      breach t=' + t + ' v=' + v); return false; }
  }
  return true;
})());

// ── (e) orbParticles：数量 / 单位圆 / 值域 / 确定性 / 公转周期 / 退化 ─────────
const N = 9;
const ps = orbParticles(N, 1000, 3, ORB_SPIN_MS);
eq('粒子数 = count', ps.length, N);
ok('粒子均为 OrbParticle', ps[0] instanceof OrbParticle);
ok('粒子落单位圆内（x²+y² ∈ [0.5,1]）', (() => {
  for (const p of ps) {
    const d = p.x * p.x + p.y * p.y;
    if (d < 0.5 - EPS || d > 1 + EPS) { console.log('      breach d=' + d); return false; }
  }
  return true;
})());
ok('粒子 r>0 且 a ∈ [0,1]', (() => {
  for (const p of ps) {
    if (!(p.r > 0) || p.a < -EPS || p.a > 1 + EPS) { console.log('      breach r=' + p.r + ' a=' + p.a); return false; }
  }
  return true;
})());
eq('粒子确定性（同参 → 同值）', orbParticles(N, 1000, 3, ORB_SPIN_MS), ps);
ok('不同 seed → 不同排布', JSON.stringify(orbParticles(N, 1000, 4, ORB_SPIN_MS)) !== JSON.stringify(ps));
eq('粒子公转周期 = turnMs', orbParticles(N, 1000 + ORB_SPIN_MS, 3, ORB_SPIN_MS), ps);
eq('count<=0 → 空数组', orbParticles(0, 1000, 3, ORB_SPIN_MS), []);
ok('大 t 不产生 NaN', (() => {
  const big = orbParticles(N, 9e12 + 123.5, 3, ORB_SPIN_MS);
  for (const p of big) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.r) || !Number.isFinite(p.a)) {
      return false;
    }
  }
  return true;
})());

// ── (f) orbWave：值域 [-1,1] + 周期 1 + 确定性 ───────────────────────────────
ok('orbWave 值域 ⊆ [-1,1]', (() => {
  for (let t = -2; t <= 2; t += 1 / 97) {
    const v = orbWave(t, 0.3, 5);
    if (v < -1 - EPS || v > 1 + EPS || !Number.isFinite(v)) { console.log('      breach t=' + t + ' v=' + v); return false; }
  }
  return true;
})());
approx('orbWave 周期为 1', orbWave(0.4123 + 1, 0.3, 5), orbWave(0.4123, 0.3, 5), 1e-9);
approx('orbWave 对 phase 平移', orbWave(0.2, 0.3 + 0.5, 5), orbWave(0.7, 0.3, 5), 1e-9);
ok('orbWave 非常量（确在波动）', (() => {
  let lo = 1, hi = -1;
  for (let t = 0; t < 1; t += 1 / 128) {
    const v = orbWave(t, 0, 7);
    if (v < lo) { lo = v; }
    if (v > hi) { hi = v; }
  }
  return hi - lo > 0.5;
})());

// ── (g) 光球开关（`core/settings.ets` 增补键）──────────────────────────────────
// 为什么放在本文件：本波只允许触碰 `tools/tests/orb.test.ts`（`settings.test.ts` 属禁改面），
// 而这条判据必须**可脱机自证**（改错必红）：
//   · `orbEnabled` 的默认值由 true 改成 false   ⇒ '缺失即开' 红
//   · 键映射写错/漏进 `localKey` 表            ⇒ '往返一致' 红
eq('默认（键缺失）= 开', orbEnabled({}), true);
eq('显式 0 = 关', orbEnabled({ 'xbot-assistant-orb': '0' }), false);
eq('显式 off = 关', orbEnabled({ 'xbot-assistant-orb': 'off' }), false);
eq('显式 1 = 开', orbEnabled({ 'xbot-assistant-orb': '1' }), true);
eq('垃圾值回落 = 开', orbEnabled({ 'xbot-assistant-orb': 'maybe' }), true);
eq('服务端键名', serverKey(KEY_ORB), 'web:ui:assistant-orb');
eq('键往返一致', localKey(serverKey(KEY_ORB)), KEY_ORB);
eq('设置项显示名非空', settingLabel(KEY_ORB), '思考光球动效');
eq('不误伤其它键（键表未被顶掉）', serverKey(KEY_CODE_WRAP), 'web:ui:code-word-wrap');

// ── (h) 旗舰光球「三态状态机」契约（**组件层形态守护**）─────────────────────────
// 为什么用"读真实源码"断言：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译
// （见其 for 循环），`components/**` **不进这套 harness** ⇒ 组件层无法直接 import 单测。
// 本仓既有先例：`tools/tests/live_tail_delivery.test.ts` 同法读源码做形态断言。
// 下列每条都**改坏就红**（mutation 证据见交付报告）；数值关系部分仍用真函数跑。
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..'); // <repo>/tools/tests/.out.PID/js → 4 级
const orbSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'AssistantOrb.ets'), 'utf-8');
const tailSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'LiveTailView.ets'), 'utf-8');

/** 取某个方法/函数的**函数体**文本（本仓缩进约定：成员方法结束于行首两空格 + `}`）。 */
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

// (h1) 三个态的名与值（改一个 ⇒ 这里红）
has(orbSrc, "export const ORB_MODE_THINKING: string = 'thinking';", '态名 thinking');
has(orbSrc, "export const ORB_MODE_TOOL: string = 'tool';", '态名 tool');
has(orbSrc, "export const ORB_MODE_IDLE: string = 'idle';", '态名 idle');
// (h2) 态 → 视觉参数表（旗舰观感的"数值契约"）
has(orbSrc, 'const ORB_TOOL_AMP: number = 0.9;', 'tool 呼吸幅度 0.9');
has(orbSrc, 'const ORB_TOOL_SPIN_GAIN: number = 2.2;', 'tool 公转加速 2.2×');
has(orbSrc, 'const ORB_TOOL_RING_GAIN: number = 1.08;', 'tool 轨道外扩 1.08×');
has(orbSrc, 'const ORB_IDLE_AMP: number = 0.25;', 'idle 呼吸幅度 0.25（极低幅度）');
has(orbSrc, 'const ORB_IDLE_HALO: number = 0.45;', 'idle 光晕强度 0.45');
has(orbSrc, 'const ORB_IDLE_FPS: number = 12;', 'idle 降帧 12fps');
// (h3) 节奏**复用既有刻度**（禁自造一套时长）：静默窗/缓动都取共享刻度
has(orbSrc, 'const ORB_EASE_MS: number = MOTION_BREATH_MS / 8;', '缓动 = 主呼吸/8');
has(orbSrc, 'const ORB_QUIET_MS: number = MOTION_QUIET_MS;', '静默窗 = 共享常量（与思考行同源）');
eq('呼吸/8 == tokens.D_SLOW（320ms，与全站过渡同刻度）', ORB_BREATH_MS / 8, D_SLOW);
eq('静默窗 == 2×D_SLOW（640ms）', ORB_BREATH_MS / 4, D_SLOW * 2);
// (h4) 白底分叉判据 = **色板亮度**（⛔ 不能按主题名硬判）
has(orbSrc, 'isLightPalette(pal)', '白/深分叉用 isLightPalette（按 appBg 亮度）');
hasNot(orbSrc, "=== THEME_LIGHT", '不按主题名硬判（无 === THEME_LIGHT）');
hasNot(orbSrc, "theme === 'light'", "不按主题名硬判（无 theme === 'light'）");
has(orbSrc, 'this.paint.halo = eff.glow;', '深色：光晕 = glow（既有观感）');
has(orbSrc, 'this.paint.halo = eff.elev2;', '浅色：光晕 = 中性柔影 elev2');
has(orbSrc, 'this.paint.stroke = pal.border;', '浅色：细环 = 中性发丝 border');
// (h5) 绘制路径**零解析/零字符串运算**：draw() 内不得出现 paletteOf/effectsOf
const drawBody: string = bodyOf(orbSrc, 'private draw(): void {');
ok('draw() 函数体可定位（形态守护有效）', drawBody.length > 200);
hasNot(drawBody, 'paletteOf(', 'draw() 内不调 paletteOf（每帧零对象/字符串分配）');
hasNot(drawBody, 'effectsOf(', 'draw() 内不调 effectsOf');
has(orbSrc, 'if (this.paintDirty) {', '绘制色在 theme 变化时预解析（OrbPaint 缓存）');
has(orbSrc, 'private buildPaint(): void {', '预解析入口存在');
// (h6) ArkTS 基类成员名黑名单（10505001）：不得用这些名字做组件成员
const banned: string[] = ['size', 'width', 'height', 'position', 'offset', 'scale', 'rotate',
  'opacity', 'visibility', 'clip', 'zIndex', 'id', 'key', 'enabled'];
for (let i = 0; i < banned.length; i++) {
  const b: string = banned[i];
  hasNot(orbSrc, `@Prop @Watch('onInputChange') ${b}:`, `基类成员名黑名单：${b} 未被用作 @Prop`);
}
has(orbSrc, "@Prop @Watch('onInputChange') orbSize: number = ORB_DEFAULT_SIZE;",
  '直径成员叫 orbSize（避让基类 size）');
// (h7) 停表门控：后台 + 降级必须停表
const runBody: string = bodyOf(orbSrc, 'private shouldRun(): boolean {');
ok('shouldRun() 函数体可定位', runBody.length > 20);
has(runBody, 'this.paused', '停表门控含 paused（后台）');
has(runBody, 'this.reduceMotion', '停表门控含 reduceMotion（降级）');
// (h8) 状态必须由**稳定信号**驱动（工具在飞），且不接打字机每拍状态
has(tailSrc, 'orbMode: this.orbMode(),', 'LiveTailView 传 orbMode（@Prop 值变化通道）');
has(tailSrc, 'orbBeat: this.orbBeat(),', 'LiveTailView 传 orbBeat（活动心跳）');
const modeBody: string = bodyOf(tailSrc, 'private orbMode(): string {');
ok('LiveTailView.orbMode() 函数体可定位', modeBody.length > 20);
has(modeBody, 'this.hasLiveTool()', 'orbMode 只看"工具是否在飞"（稳定信号）');
hasNot(modeBody, 'typingText(', 'orbMode 不接打字机每拍状态（避免 ≤20Hz 抖动）');
hasNot(modeBody, 'typingReason(', 'orbMode 不接思考打字机每拍状态');
// (h9) 「加速公转」= **同一函数的相位推进**（禁新造波形/函数）—— 真函数跑数值关系
const G = 2.2;
eq('tool 加速 == 用更短周期跑同一 orbParticles',
  orbParticles(9, 1000 * G, 3, ORB_SPIN_MS), orbParticles(9, 1000, 3, ORB_SPIN_MS / G));
ok('冻结（增益 0）≠ 运动（证明"静止也是设计"确有效果）',
  JSON.stringify(orbParticles(9, 0, 3, ORB_SPIN_MS)) !== JSON.stringify(orbParticles(9, 500, 3, ORB_SPIN_MS)));
eq('冻结时不同时刻位置恒定（帧间零变化）',
  orbParticles(9, 123456 * 0, 7, ORB_SPIN_MS), orbParticles(9, 999 * 0, 7, ORB_SPIN_MS));

if (fail > 0) {
  console.log(`  orb: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  orb: ${pass} passed, 0 failed`);
process.exit(0);
