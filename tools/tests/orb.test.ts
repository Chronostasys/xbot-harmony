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

if (fail > 0) {
  console.log(`  orb: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  orb: ${pass} passed, 0 failed`);
process.exit(0);
