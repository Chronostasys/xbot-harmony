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
/** 粒子环基准半径（单位圆比例；粒子落 `[ORB_PARTICLE_BAND_MIN, ORB_PARTICLE_BAND_MAX]`，见 `orbParticles`）。 */
export const ORB_RING_RADIUS: number = 0.9;

// ── 粒子环的「精度」量程（**收窄** ⇒ 读作"一圈**精确**的光点"，而非"随机噪点"）───────────
// 背景：用户口令「比 Siri 好看 / 极简 / 干净」。20vp 下，粒子的**抖动量程**决定它读作
// "精密的一圈光"还是"一团随机糊点"。原来 size 量程 0.6–2.2（**3.67×**）、alpha 量程
// 0.25–1.0（**4×**）⇒ 最小最暗的粒子几乎"脏点"。收窄到 ~2× 后，每枚都"亮着"、只是有
// 前后层次 —— 这是"克制与精度"的量化落点（门禁 `tools/tests/orb.test.ts` 钉住比值上限）。
/** 粒子径向带内缘（单位圆比例）。 */
export const ORB_PARTICLE_BAND_MIN: number = 0.78;
/** 粒子径向带外缘（单位圆比例）—— 环是**有宽度的带**，不是一条细线。 */
export const ORB_PARTICLE_BAND_MAX: number = 0.96;
/** 粒子尺寸因子下限（相对基准）。 */
export const ORB_PARTICLE_SIZE_MIN: number = 0.85;
/** 粒子尺寸因子上限（原 2.2 ⇒ 3.67× 量程；收窄到 1.75 ⇒ ~2.06×）。 */
export const ORB_PARTICLE_SIZE_MAX: number = 1.75;
/** 粒子透明度下限（原 0.25 ⇒ 过暗读作"脏"；提到 0.45）。 */
export const ORB_PARTICLE_ALPHA_MIN: number = 0.45;
/** 粒子透明度上限。 */
export const ORB_PARTICLE_ALPHA_MAX: number = 1.0;
/** 角偏移量：极小 ⇒ 打破"完全均匀"的机械感，但保持"精确的一圈"（原 0.15 偏散）。 */
export const ORB_PARTICLE_ANGLE_JITTER: number = 0.08;

// ── 绘制几何（渐变停靠点；**单一来源**，组件不再自带魔数；可脱机断言）────────────────
/**
 * 光核渐变的**实心亮心占比**：`0 → 该比例` 保持亮心色，之后才混向主色。
 * 为什么：原来 `亮心@0 → 主色@0.55` 是**从圆心立即**开始混色 ⇒ 20vp 下读作"一团糊光"；
 * 给亮心一小段"实心平台"⇒ 读作"**一颗有体积的实心核** + 一圈柔光晕"（更精确、更像珠子）。
 */
export const ORB_CORE_SOLID_STOP: number = 0.28;
/**
 * 光核渐变的**主色停靠点**：`实心平台 → 该比例` 由亮心混到主色，之后向全透明衰减。
 * 由旧 0.55 提到 0.68 ⇒ 外缘"尾巴"更短 ⇒ 核的边界更**锐利/收敛**（不是糊开一片）。
 */
export const ORB_CORE_MID_STOP: number = 0.68;
/**
 * 外光晕的衰减停靠点（< 1）：光晕在**画布边缘之前**就归零 ⇒ 留出干净的透明留白，
 * 不与邻接内容（文字/气泡）糊在一起（"干净"的关键；原实现光晕一直顶到画布边）。
 */
export const ORB_HALO_DECAY_STOP: number = 0.82;

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
 * 呼吸的**非对称比**：一个周期里"吸气（涨）"占的比例（其余为"呼气（收）"）。
 *
 * 为什么不是 0.5（= 对称正弦）：`0.5 - 0.5*cos(2πp)` 的升/降**完全镜像且等时** ⇒ 读作
 * **节拍器/呼吸机**（可预测 = 机械感），而不是"活物"。真实呼吸（与人眼觉得"自然"的
 * 缓动）都是**不对称**的：**快吸、慢呼**（`0.4 / 0.6`）⇒ 峰值来得果断、回落绵长，
 * 一眼读作"有肺、有惯性"。这是"比 Siri 好看"里**最廉价可得的**一档提升：
 * 只改**波形形状**，不动周期（`ORB_BREATH_MS` 仍是 8×D_SLOW）、不动幅度（MIN/MAX 不变）
 * ⇒ 刻度契约（`docs/DESIGN-SYSTEM.md §8.1`）不受影响。
 *
 * ⛔ 纪律：`0 < ORB_BREATH_INHALE < 1`（两端都留时长，否则退化成"锯齿/阶跃"）。
 * 判据见 `tools/tests/orb.test.ts`（峰值时刻 = `inhale × period`，且两段各自单调）。
 */
export const ORB_BREATH_INHALE: number = 0.4;

/**
 * 呼吸值 ∈ `[0,1]`（**快吸慢呼的非对称波形**，`smoothstep` 光滑两端）。
 *
 *   · `orbBreath(0) = 0`；`orbBreath(inhale × periodMs) = 1`；周期 = `periodMs`；
 *   · `[0, inhale×P]` **单调不减**、`[inhale×P, P]` **单调不增**；
 *   · 峰值/谷值处导数为 0（`smoothstep`）⇒ 无折角（不"顿"）。
 */
export function orbBreath(t: number, periodMs: number): number {
  const p: number = orbPhase(t, periodMs);
  const u: number = p < ORB_BREATH_INHALE
    ? p / ORB_BREATH_INHALE
    : 1 - (p - ORB_BREATH_INHALE) / (1 - ORB_BREATH_INHALE);
  return u * u * (3 - 2 * u);
}

/**
 * 呼吸值 → 半径（**唯一映射**：单频 `orbRadius` 与双频 `orbRadiusFine` 共用 ——
 * ⛔ 不许在组件里再写一份（两份公式必然漂移），这正是"判据与渲染同源"的落点）。
 */
function radiusOf(breath: number, baseR: number, minScale: number, maxScale: number): number {
  const base: number = baseR > 0 ? baseR : 0;
  return base * (minScale + (maxScale - minScale) * breath);
}

/** 呼吸值 → 透明度（**唯一映射**，同上）。 */
function opacityOf(breath: number, minO: number, maxO: number): number {
  return minO + (maxO - minO) * breath;
}

/**
 * 呼吸半径：`baseR * (minScale + (maxScale-minScale)*orbBreath)`。
 * 值域 `[baseR*minScale, baseR*maxScale]`；`baseR<=0` 视为 0（不产生负半径）。
 */
export function orbRadius(
  t: number, baseR: number, periodMs: number, minScale: number, maxScale: number): number {
  return radiusOf(orbBreath(t, periodMs), baseR, minScale, maxScale);
}

/**
 * 呼吸透明度：`minO + (maxO-minO)*orbBreath`。值域 `[min(minO,maxO), max(minO,maxO)]`。
 */
export function orbOpacity(t: number, periodMs: number, minO: number, maxO: number): number {
  return opacityOf(orbBreath(t, periodMs), minO, maxO);
}

// ── 双频呼吸（主呼吸 + 次级起伏 —— "去机械感"的量化落点）──────────────────────────
/**
 * 次级起伏的**谐波倍数** = 2（整数倍 ⇒ 契约内；`docs/DESIGN-SYSTEM.md §8.1`：在飞组的呼吸/
 * 脉冲必须是主呼吸刻度的**整数分数或倍数**）⇒ **周期仍是 `periodMs`，不新造时长刻度**。
 *
 * 为什么需要它：主呼吸是"快吸慢呼"的**单峰**波形 —— 单峰且每周期完全一致 = **节拍器**
 * （可预测 = 机械感，是"像机器而不是像活物"的头号特征）。叠加一个 2× 谐波的**微弱**分量
 * （与真实心跳的"二次搏动"/dicrotic notch 同构）⇒ 波形不再是教科书式的单峰
 * ⇒ 一眼读作"有生命的呼吸"。
 * ⛔ 只改**波形形状**：周期（`ORB_BREATH_SWELL` 无关，仍是 `periodMs`）、端点值（谷 0 / 峰 1）
 * 与值域 `[0,1]` 全部不变 ⇒ 既有契约（`docs/DESIGN-SYSTEM.md §7.1.1`）与下游映射不受影响。
 */
export const ORB_BREATH_FINE_HARMONIC: number = 2;

/**
 * 次级起伏的深度（相对呼吸量程）。`0` ⇒ 退回单频 `orbBreath`（可关断）。
 * ⚠️ 取 0.18 的量纲依据：22vp 光球的主呼吸半径量程实测约 1.64vp ⇒ 起伏峰-峰 ≈ 0.30vp
 * （3× 屏 ≈ 0.9px）—— **够被眼睛读到"不是完美节拍"，又不至于读成"抖"**（克制）。
 */
const ORB_BREATH_FINE_AMP: number = 0.18;

/**
 * 双频呼吸值 ∈ `[0,1]`：`orbBreath`（主，快吸慢呼）+ 一个 2× 谐波的**窗口化**微弱分量。
 *
 * 窗口 `4·b·(1−b)` 在两端（`b=0` / `b=1`）**恰为 0** ⇒ **端点逐值不变**
 * （谷仍 = 0、峰仍 = 1，"满量程不塌"与"峰值 = 1"两条既有契约自动成立）；
 * 起伏只发生在中段（真正"在呼吸"的那一段）。末尾夹紧 ⇒ 值域仍 ⊆ `[0,1]`。
 */
export function orbBreathFine(t: number, periodMs: number): number {
  const b: number = orbBreath(t, periodMs);
  const w: number = 4 * b * (1 - b);                 // ∈[0,1]，两端恰 0
  const ripple: number = Math.sin(2 * Math.PI * ORB_BREATH_FINE_HARMONIC * orbPhase(t, periodMs));
  const v: number = b + ORB_BREATH_FINE_AMP * w * ripple;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/** 双频呼吸半径（与 `orbRadius` **同一映射**，只是喂 `orbBreathFine`）。 */
export function orbRadiusFine(
  t: number, baseR: number, periodMs: number, minScale: number, maxScale: number): number {
  return radiusOf(orbBreathFine(t, periodMs), baseR, minScale, maxScale);
}

/** 双频呼吸透明度（与 `orbOpacity` **同一映射**，只是喂 `orbBreathFine`）。 */
export function orbOpacityFine(t: number, periodMs: number, minO: number, maxO: number): number {
  return opacityOf(orbBreathFine(t, periodMs), minO, maxO);
}

/**
 * 公转角速度的**周期缓动深度**（`0` = 匀速）。判据：`0 < c < 1`（见下方 `orbSpinWarp`）。
 *
 * 为什么需要它：`spin = orbPhase(t, turnMs)` 是**线性**推进 ⇒ 粒子环**永恒匀速**旋转。
 * 匀速圆周是"机械/廉价"的头号特征（像 loading 圈）；真轨道/真惯性**在一个周期内会快慢交替**。
 * 这里让角速度在一个公转周期内按 `1 ± c` 起伏（c=0.35 ⇒ `0.65× ~ 1.35×`），
 * 环读作"**转得起来、且有余势**"，而不是"被电机带着转"。
 *
 * ⛔ 纪律：**只改"相位 → 角度"的映射形状**，不改周期（`ORB_SPIN_MS` 不变）、不新增时长刻度
 *   ⇒ `orbParticles(t + turnMs) === orbParticles(t)`（周期性）与"tool 加速 = 用更短周期跑
 *   同一函数"的等价关系**都仍然成立**（测试逐条钉住）。
 */
export const ORB_SPIN_EASE: number = 0.35;

/**
 * 把 `[0,1)` 的相位映射成**非匀速但周期不变**的角参数：
 * `g(s) = s - c/(2π)·sin(2π s)`。
 *
 * 性质（测试钉住）：`g(0)=0`、`g(1)=1` ⇒ 对相位取模后**周期不变**；
 * `g'(s) = 1 - c·cos(2π s) ∈ [1-c, 1+c]` ⇒ `c < 1` 时**严格单调**（角度永不倒退）。
 */
function orbSpinWarp(phase: number): number {
  return phase - (ORB_SPIN_EASE / (2 * Math.PI)) * Math.sin(2 * Math.PI * phase);
}

/**
 * 粒子环（单位圆）：`count` 枚光点，绕原点公转。
 *
 *   · 公转：角参数 = `orbSpinWarp(orbPhase(t, turnMs))`（**非匀速**，见 `ORB_SPIN_EASE`）；
 *     仍是 `t` 的周期函数、周期 = `turnMs`；
 *   · 抖动：用 `hash01(seed, i)` 给每枚错开半径、尺寸因子、透明度与角偏移
 *     （`seed` 相同 ⇒ 每帧结果一致，可复现）；
 *   · `count<=0` ⇒ 空数组（不抛）。
 */
export function orbParticles(count: number, t: number, seed: number, turnMs: number): OrbParticle[] {
  const n: number = count > 0 ? Math.floor(count) : 0;
  const out: OrbParticle[] = [];
  const spin: number = orbSpinWarp(orbPhase(t, turnMs));
  for (let i = 0; i < n; i++) {
    const hA: number = hash01(seed * 7.1 + i * 1.7);
    const hR: number = hash01(seed * 3.3 + i * 2.9);
    const hS: number = hash01(seed * 5.7 + i * 4.1);
    const angle: number = (i / n + spin + hA * ORB_PARTICLE_ANGLE_JITTER) * 2 * Math.PI;
    const radius: number =
      ORB_PARTICLE_BAND_MIN + (ORB_PARTICLE_BAND_MAX - ORB_PARTICLE_BAND_MIN) * hR;
    out.push(new OrbParticle(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      ORB_PARTICLE_SIZE_MIN + (ORB_PARTICLE_SIZE_MAX - ORB_PARTICLE_SIZE_MIN) * hS,
      ORB_PARTICLE_ALPHA_MIN + (ORB_PARTICLE_ALPHA_MAX - ORB_PARTICLE_ALPHA_MIN) * hA,
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

// ── 轨道景深（"近大远小" ⇒ 环读作**倾斜的三维轨道**，而非平面的一圈点）──────────────
/**
 * 景深：把粒子在**单位圆上的纵向位置** `y`（画布坐标：y 向下）映射成"远近度" ∈ `[0,1]`
 * （`0` = 环的后缘/最远，`1` = 环的前缘/最近）。
 *
 * 为什么这是"提升一档"而不是"加特效"：**等大等亮的一圈光点 = 2D loading 圈**的头号特征；
 * 人眼读空间靠的正是"近大远小 + 亮度差"。给同一圈光点一个**纵向深度权重**
 * ⇒ 环立刻读作"绕着一颗核在倾斜的轨道上转"（有体积、有前后），而**一个像素都没多画**。
 * 性质（测试钉住）：`y=-1 ⇒ 0`、`y=0 ⇒ 0.5`、`y=+1 ⇒ 1`、对 `y` 单调不减；
 * 非有限输入 ⇒ `0.5`（中性，不倒向任一端 —— fail-safe）；输入越界 ⇒ 夹到 `[0,1]`。
 */
export function orbDepthNear(y: number): number {
  if (!(y === y)) { return 0.5; }   // NaN ⇒ 中性
  if (y <= -1) { return 0; }
  if (y >= 1) { return 1; }
  return (y + 1) / 2;
}

/**
 * 景深增益：近端 `near`、远端 `far`，按 `k ∈ [0,1]`（**该态的景深强度**）插值到 `1`。
 * `k = 0` ⇒ **恒 1**（该态无景深 ⇒ 退化为既有**平面**环 —— 可关断、可回退）。
 *
 * 性质（测试钉住）：对 `y` 单调不减（`near > far` 时 ⇒ **近层 > 远层**）；`k` 单调；
 * 有界 `⊆ [min(1,far), max(1,near)]`。⛔ 两端均为**正数** ⇒ 远粒子**也看得见**（只是更小更弱）
 * ——"任何态不得出现静止不可见"。
 */
export function orbDepthGain(y: number, near: number, far: number, k: number): number {
  const d: number = orbDepthNear(y);
  const base: number = far + (near - far) * d;
  const kk: number = k > 1 ? 1 : (k > 0 ? k : 0);
  return 1 + (base - 1) * kk;
}

/** 近端尺寸增益（环前缘）。 */
export const ORB_DEPTH_SIZE_NEAR: number = 1.28;
/** 远端尺寸增益（环后缘）—— 必须 > 0（远粒子也要看得见）。 */
export const ORB_DEPTH_SIZE_FAR: number = 0.78;
/** 近端不透明度增益（环前缘）。 */
export const ORB_DEPTH_ALPHA_NEAR: number = 1.15;
/** 远端不透明度增益（环后缘）—— 必须 > 0（"任何态不可见"的防线）。 */
export const ORB_DEPTH_ALPHA_FAR: number = 0.72;

// ── 帧率策略（**纯策略**：可脱机单测、可变异自证）──────────────────────────────
/**
 * 主态 = **`tool`**（有工具在飞）帧率 = 30fps。
 *
 * ⛔ 纪律："**丝滑**"是用户的硬要求 ⇒ `tool` 态（用户正盯着工具在跑）**永不降频**。
 *    降频只允许发生在三类情形："看不见"（滚出屏幕）、"不是主角"（`secondary`）、
 *    或**慢波形**态（`idle` 12fps / `thinking` 20fps —— 见各自常量的理由）。
 */
export const ORB_FPS_MAIN: number = 30;
/**
 * 思考态（`thinking`）帧率 = 20fps。
 *
 * 为什么可以降：`thinking` 是**最常见**的流式态（正在吐正文 / 刚起头），但此刻波形是
 * **慢波形**（整周期 `ORB_BREATH_MS` = 2560ms）⇒ 20fps 对慢波形足够平滑，肉眼与 30fps 无差；
 * 而帧率是 Canvas 光球的**唯一成本旋钮**（每帧 `clearRect` + 全量重画）。
 *   真机实测（同机 7s 窗口，`hidumper --cpuusage`）：**流式期 app CPU 4.4–4.7%**、
 *   空态仅 **0.05%** ⇒ 那 4.7% 正是"定时器驱动重绘"的地板，按帧率等比下降。
 *
 * ⛔ 只降**采样率**，绝不改呼吸**周期/幅度**：相位由 `Date.now()` 喂纯函数算
 *    （见 `components/AssistantOrb.draw()`），缓动用**真实帧间隔** ⇒ 观感速度与帧率无关。
 *    `docs/DESIGN-SYSTEM.md §8.1` 的刻度契约（呼吸/脉冲必须是主呼吸刻度的整数分数/倍数）
 *    不受影响 —— 帧率是采样密度，不是刻度。
 */
export const ORB_FPS_THINKING: number = 20;
/**
 * 让位态（`secondary`）帧率 = 18fps。
 *
 * 为什么可以降：让位态的呼吸/公转**都已减半**（慢动作）⇒ 18fps 对慢动作已足够平滑；
 * 而它"退到背景"的定位决定了它不是眼睛的焦点（此刻主高亮源是别处，见 DESIGN-SYSTEM §8.2）。
 */
export const ORB_FPS_SECONDARY: number = 18;
/** 静默态（`idle`）帧率 = 12fps（呼吸幅度 0.25、粒子冻结 ⇒ "静止也是设计"）。 */
export const ORB_FPS_IDLE: number = 12;

/** 让位态名（与 `components/AssistantOrb.ets` 的 `ORB_MODE_SECONDARY` **同字面量**；测试断言两者一致）。 */
const MODE_SECONDARY: string = 'secondary';
/** 静默态名（同上，与 `ORB_MODE_IDLE` 同字面量）。 */
const MODE_IDLE: string = 'idle';
/** 思考态名（同上，与 `components/AssistantOrb.ets` 的 `ORB_MODE_THINKING` 同字面量）。 */
const MODE_THINKING: string = 'thinking';
/** 工具在飞态名（同上，与 `ORB_MODE_TOOL` 同字面量）。 */
const MODE_TOOL: string = 'tool';

/**
 * 光球的目标帧率（**纯策略**；`0` = 不该跑 / 停表）。
 *
 * 为什么单独成一层：Canvas 是**全量重绘**（`clearRect` 后重画一切）⇒ 帧率是唯一的成本旋钮。
 * 把"该跑多快"收敛成一个可脱机断言的纯函数 ⇒ 性能策略有判据、可变异自证，而不是散在
 * 组件里的魔数（改坏 ⇒ `tools/tests/orb.test.ts` 红）。
 *
 * 策略：
 *   · `visible === false`（完全滚出屏幕）⇒ **0**（停表；回来立即恢复）—— 不可见的不该烧电；
 *   · `idle` ⇒ 12fps（呼吸幅度 0.25、粒子冻结）；
 *   · `secondary` ⇒ 18fps（呼吸/公转已减半，且不是主角）；
 *   · `thinking` ⇒ 20fps（**最常见**的流式态；慢波形 ⇒ 肉眼与 30fps 无差，但省 1/3 重绘）；
 *   · `tool` ⇒ **30fps 恒定**（主态，"丝滑"不因任何优化而妥协）；
 *   · 未知态 ⇒ 回落 `ORB_FPS_MAIN`（宁可多画，不静默降级）。
 *
 * ⚠️ `active=false` / `paused=true`（后台）/ `reduceMotion=true` 的"停表"仍由组件侧
 *    `shouldRun()` 决定 —— 那三者的语义是"**不画**"，不只是"降频"。
 */
export function orbTargetFps(mode: string, visible: boolean): number {
  if (!visible) {
    return 0;
  }
  if (mode === MODE_IDLE) {
    return ORB_FPS_IDLE;
  }
  if (mode === MODE_SECONDARY) {
    return ORB_FPS_SECONDARY;
  }
  if (mode === MODE_THINKING) {
    return ORB_FPS_THINKING;
  }
  return ORB_FPS_MAIN;
}

/**
 * **有效态**（纯函数）—— 把"调用方给的态"与"静默自判"折算成**真正生效的态**。
 *
 * 为什么必须是一个**纯函数**而不是组件里的一串 `if`：优先级一旦散在 `build`/`draw` 路径里，
 * 就会出现"某一路径漏判 ⇒ 该态**永远不可达**"的静默缺陷（本仓真实发生过：`secondary`
 * 在 `orbTargetFps`/`orbStateOf` 里都有分支，但组件侧的折算把它整条吞掉 ⇒ 让位态从未生效，
 * 见下方 `⛔ 事故`）。收成纯函数后，"优先级"有**唯一的判据**、可脱机断言、可变异自证。
 *
 * 优先级（高 → 低）：**tool > idle（显式）> idle（静默自判）> secondary > thinking**
 *   · `tool`（有工具在飞）：最高 —— 工具在跑时不谈"静默"，也不让位；
 *   · `idle`（显式）：调用方说没人了 ⇒ 静默（"静止也是设计"）；
 *   · `quiet === true`（心跳停摆超过静默窗）：**任何非 tool 态都降为 idle**；
 *   · `secondary`（让位）：机器仍在动，但**这次不是它领读** ⇒ 保留"让位"参数（呼吸/光晕/
 *     公转减半 + 18fps），**不**被折成 thinking；
 *   · 其余（含未知/空/`thinking`）⇒ `thinking`（宁可满幅，不静默降级）。
 *
 * ⛔ 事故（2026-10-11 审计）：旧组件实现只认 `tool`/`idle` 两个显式态，其余一律回落
 *   `quiet ? idle : thinking` ⇒ **`secondary` 不可达**（`LiveTailView` 传了也让位不了），
 *   而 `core/orb.ets` 里 `ORB_FPS_SECONDARY(18)` 与 `ST_SECONDARY` 两处参数**白写**：
 *   光球在"该让位"时仍满幅呼吸 ⇒ 与 `思考 N 字` 争主高亮（正是用户报的"两个 spinner"同源问题）。
 */
export function orbEffectiveMode(orbMode: string, quiet: boolean): string {
  if (orbMode === MODE_TOOL) {
    return MODE_TOOL;
  }
  if (orbMode === MODE_IDLE) {
    return MODE_IDLE;
  }
  if (quiet) {
    return MODE_IDLE;
  }
  if (orbMode === MODE_SECONDARY) {
    return MODE_SECONDARY;
  }
  return MODE_THINKING;
}

// ── 态 → 景深强度（"深度 = 在场感"）────────────────────────────────────────────
/**
 * 态 → 轨道景深强度（`0` = 平面/最平，`1` = 最立体）。
 *
 * 为什么把这条策略也上收本层：它与 `orbTargetFps` / `orbEffectiveMode` **同类** —— 都是
 * "态 × 策略 ⇒ 数值"的**纯映射**。散在组件里就会各自漂移；收在这里则可脱机单测、可变异自证。
 * 组件只负责喂 `mode`（不写第二份 `if` 链）。
 *
 * 设计语义（为什么不只是"幅度不同"）：景深是一条**与颜色/速度都无关的静态形态维度**
 * —— `porcelain`/`light` 下 `tool` 与 `thinking` 的环**同为 `#0071E3`**（`core/theme.ets`）
 * ⇒ 颜色维度静帧不可辨；深度给"工具在飞"又一个**静帧可辨**的线索（§7.2 的另一半）。
 * `idle` 收到接近平面 ⇒ "静止也是设计"（克制）；未知态回落 `thinking`（宁可满档，不静默降级）。
 */
export const ORB_DEPTH_THINKING: number = 0.85;
/** `tool`（工具在飞、光球领读）：最立体。 */
export const ORB_DEPTH_TOOL: number = 1;
/** `secondary`（让位）：收一半（退到中景）。 */
export const ORB_DEPTH_SECONDARY: number = 0.45;
/** `idle`（静默）：接近平面。 */
export const ORB_DEPTH_IDLE: number = 0.2;

/** 态 → 景深强度（纯函数；未知态回落 `thinking`）。 */
export function orbDepthOf(mode: string): number {
  if (mode === MODE_TOOL) {
    return ORB_DEPTH_TOOL;
  }
  if (mode === MODE_IDLE) {
    return ORB_DEPTH_IDLE;
  }
  if (mode === MODE_SECONDARY) {
    return ORB_DEPTH_SECONDARY;
  }
  return ORB_DEPTH_THINKING;
}

