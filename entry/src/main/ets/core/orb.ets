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

