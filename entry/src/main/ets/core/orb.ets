/**
 * 助手光球（Assistant Orb）—— 旗舰「思考中 / 生成中」指示器的**纯数学层**。
 *
 * 定位：把"光球怎么动"拆成**可脱机单测的纯函数/纯数据**（呼吸、半径、透明度、粒子环、
 * 伪噪声波形）。视觉层（`components/AssistantOrb.ets`）只消费这些产物，把它**画**出来。
 *
 * 分层铁律（与 `core/motion.ets` 同款）：本文件属 `core/`，会被 `tools/tests/run.sh`
 * **当纯 TS 在 Node 里编译** ⇒
 *   · **禁止** import ArkUI 全局类型（`CanvasRenderingContext2D` 等）或任何 `@ohos.*`；
 *   · **禁止**在任何地方（含返回结构）使用无类型对象字面量（ArkTS `arkts-no-untyped-obj-literals`）
 *     ⇒ 一律 `class`；
 *   · **颜色与主题不在此层** —— 本层只产出**数值**（半径比例 / 透明度 / 单位圆坐标），
 *     具体色值由组件从 `core/theme.ets` 的语义角色（`Palette` / `Effects`）取。
 *
 * 节奏来源（**复用 token，不另起一套时长**）：所有周期都由 `core/tokens.ets` 的
 * `D_SLOW`（320ms，"大块/抽屉"刻度）**整数倍**派生 —— 与 `core/motion.ets` 引用
 * `D_FAST/D_SLOW` 的口径一致：新节奏不是新体系，而是既有刻度的组合。
 *
 * 判据（可脱机、可变异自证）：见 `tools/tests/orb.test.ts` —— 值域 / 单调性 / 周期性 /
 * 边界（t=0、大 t、负 t、phase 回绕）。
 */
import { D_SLOW } from './tokens';

// ── 节奏（复用 tokens 刻度：均为 D_SLOW 的整数倍）─────────────────────────────
/** 呼吸周期 = 8×D_SLOW = 2560ms（宁可慢、不可急躁 —— "呼吸"而非"闪烁"）。 */
export const ORB_BREATH_MS: number = D_SLOW * 8;
/** 粒子环公转周期 = 20×D_SLOW = 6400ms（比呼吸更慢，两层节奏不同步 ⇒ 不呆板）。 */
export const ORB_SPIN_MS: number = D_SLOW * 20;

// ── 形态常数（值域边界；组件据此把"比例"换算成像素）───────────────────────────
/** 呼吸半径最小比例（相对基准半径）。 */
export const ORB_BREATH_MIN: number = 0.82;
/** 呼吸半径最大比例（略 >1 ⇒ 有"涨出来"的活感；不做大幅 overshoot，避免廉价）。 */
export const ORB_BREATH_MAX: number = 1.06;
/** 呼吸透明度下限。 */
export const ORB_OPACITY_MIN: number = 0.55;
/** 呼吸透明度上限。 */
export const ORB_OPACITY_MAX: number = 1.0;
/** 粒子环基准半径（单位圆比例；粒子在 [0.72,0.98] 上抖动，见 `orbParticles`）。 */
export const ORB_RING_RADIUS: number = 0.9;

/** 环绕光点（单位圆坐标 x/y ∈ [-1,1]；r = 尺寸因子；a = 透明度 [0,1]）。 */
export class OrbParticle {
  x: number = 0;
  y: number = 0;
  r: number = 0;
  a: number = 0;
  constructor(x: number, y: number, r: number, a: number) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.a = a;
  }
}

/**
 * 确定性 hash → `[0,1)`（**替代 `Math.random`**）。
 *
 * 为什么不用随机数：`Math.random` 每帧不同 ⇒ 粒子会"跳变"，且**无法脱机断言**
 * （测试不可复现）。这里用 GLSL 经典的 `fract(sin(n)*43758.5453)`：同一 `n` 恒得同一值，
 * 但取值在 [0,1) 上足够"散"（用于给每个粒子错开半径/大小/透明度/相位）。
 */
function hash01(n: number): number {
  const s: number = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 归一化相位 ∈ `[0,1)`：`t` 对 `periodMs` 取模并**处理负值与回绕**。
 * `orbPhase(t + k*periodMs) === orbPhase(t)`（周期性）；`periodMs<=0` 退化为周期 1（不抛）。
 */
export function orbPhase(t: number, periodMs: number): number {
  const p: number = periodMs > 0 ? periodMs : 1;
  return (((t % p) + p) % p) / p;
}

/**
 * 呼吸值（弦波光滑）∈ `[0,1]`：`0.5 - 0.5*cos(2π·phase)`。
 * `orbBreath(0)=0`；`orbBreath(period/2)=1`；周期 = `periodMs`；在 `[0, period/2]` 上**单调不减**。
 */
export function orbBreath(t: number, periodMs: number): number {
  return 0.5 - 0.5 * Math.cos(orbPhase(t, periodMs) * 2 * Math.PI);
}

/**
 * 呼吸半径：`baseR * (minScale + (maxScale-minScale)*orbBreath)`。
 * 值域 `[baseR*minScale, baseR*maxScale]`；`baseR<=0` 视为 0（不产生负半径）。
 */
export function orbRadius(
  t: number, baseR: number, periodMs: number, minScale: number, maxScale: number): number {
  const base: number = baseR > 0 ? baseR : 0;
  const b: number = orbBreath(t, periodMs);
  return base * (minScale + (maxScale - minScale) * b);
}

/**
 * 呼吸透明度：`minO + (maxO-minO)*orbBreath`。值域 `[min(minO,maxO), max(minO,maxO)]`。
 */
export function orbOpacity(t: number, periodMs: number, minO: number, maxO: number): number {
  return minO + (maxO - minO) * orbBreath(t, periodMs);
}

/**
 * 粒子环（单位圆）：`count` 枚光点，绕原点公转。
 *
 *   · 公转：角位置随 `orbPhase(t, turnMs)` 线性推进 ⇒ 周期 = `turnMs`；
 *   · 抖动：用 `hash01(seed, i)` 给每枚错开半径 `[0.72,0.98]`、尺寸因子 `[0.6,2.2]`、
 *     透明度 `[0.25,1.0]` 与角偏移（`seed` 相同 ⇒ 每帧结果一致，可复现）；
 *   · `count<=0` ⇒ 空数组（不抛）。
 */
export function orbParticles(count: number, t: number, seed: number, turnMs: number): OrbParticle[] {
  const n: number = count > 0 ? Math.floor(count) : 0;
  const out: OrbParticle[] = [];
  const spin: number = orbPhase(t, turnMs);
  for (let i = 0; i < n; i++) {
    const hA: number = hash01(seed * 7.1 + i * 1.7);
    const hR: number = hash01(seed * 3.3 + i * 2.9);
    const hS: number = hash01(seed * 5.7 + i * 4.1);
    const angle: number = (i / n + spin + hA * 0.15) * 2 * Math.PI;
    const radius: number = 0.72 + 0.26 * hR;
    out.push(new OrbParticle(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.6 + 1.6 * hS,
      0.25 + 0.75 * hA,
    ));
  }
  return out;
}

/**
 * 伪噪声波形 ∈ `[-1,1]`（三正弦叠加，**确定性**，非随机）。
 *
 * 三个频率（1/2/3）互成整数倍 ⇒ 对 `t` 的周期 = 1（`orbWave(t+1,...) === orbWave(t,...)`）；
 * 幅度上界 `(|a| + 0.6|b| + 0.4|c|) / 2 = 1`（权重和恰为 2）。`phase` 用于错开多实例。
 */
export function orbWave(t: number, phase: number, seed: number): number {
  const s: number = seed * 0.37;
  const u: number = t + phase;
  const a: number = Math.sin(2 * Math.PI * u + s);
  const b: number = Math.sin(2 * Math.PI * 2 * u + s * 1.7);
  const c: number = Math.sin(2 * Math.PI * 3 * u + s * 2.3);
  return (a + 0.6 * b + 0.4 * c) / 2.0;
}
