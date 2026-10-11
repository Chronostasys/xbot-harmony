/**
 * AssistantOrb —— 旗舰「思考中 / 生成中」动效指示器（**视觉层**）。
 *
 * 设计目标（用户口令）："比 Siri 还好看 / 极简 / 苹果那种科技感 / 干净 / 交互起来很爽"。
 * 视觉语言：**一枚会呼吸的发光核 + 一圈缓慢公转的光点**（halo → core → particles），
 * 并按**运行态**切换"动效语义"（下表）—— 不是一套循环用到黑。
 *
 * ── 四态状态机（本波核心；契约见 `docs/DESIGN-SYSTEM.md §7`）────────────────────
 *   | 态 | 呼吸/能量 | 公转相位 | 轨道 | 景深 | 环色 | 帧率 | 读作 |
 *   |---|---|---|---|---|---|---|---|
 *   | `thinking` | 1.0（既有观感） | 1.0× | 1.0× | 0.85 | accentSoft | 30 | 在思考 / 在写 |
 *   | `tool`     | 0.9 | **2.2×** | **1.08×** | **1.0（最立体）** | **statusRunning** | 30 | 工具在飞（一眼可辨） |
 *   | `secondary`| **0.5** | **0.5×** | 1.0× | 0.45 | accentSoft | **18** | 让位（别处才是主角） |
 *   | `idle`     | **0.25** | **0.0（冻结）** | 1.0× | **0.2（近平面）** | accentSoft | **12** | 静默（**静止也是设计**） |
 *
 *   · **呼吸 = 双频**（`core/orb.ets:orbBreathFine`）：主呼吸（快吸慢呼，非对称）× 一个
 *     **2× 谐波**的微弱分量（端点逐值不变、周期不变、值域仍 `[0,1]`）—— 单峰波形读作
 *     **节拍器**（机械感的头号特征），叠加二次搏动后才读作"有生命的呼吸"。
 *   · **景深 = 一条静态形态维度**（`core/orb.ets:orbDepthOf` / `orbDepthGain`）：逐粒子按
 *     纵向位置给"近大远小 + 亮度差" ⇒ 平面的一圈点读作**倾斜的三维轨道**。
 *     ⛔ 与颜色无关 ⇒ `porcelain`/`light` 下 `tool`/`thinking` 环**同为 `#0071E3`** 时，
 *     "工具在飞"仍**静帧可辨**（配合 §7.2 的细环变亮线索）。
 *
 *   ⚠️ 帧率列**以 `core/orb.ets` 的 `ORB_FPS_*` 为准**：`tool` 30 / **`thinking` 20** /
 *      `secondary` 18 / `idle` 12。`thinking` **确实**走 `orbTargetFps` 的 `ORB_FPS_THINKING`(20)
 *      降频分支（`core/orb.ets`，`a3f0cc1`「慢波形降频」引入；`orb.test.ts` 钉死 20）。
 *      此处曾一度"订正"成 30（并称"thinking 不在降频分支里"）—— **那是错的**，2026-10-11 按代码回正。
 *
 *   · 态由 `@Prop orbMode` 给出（调用方从状态机派生）；`idle` 还可由光球**自己**判定：
 *     `@Prop orbBeat`（活动心跳）超过 `ORB_QUIET_MS` 未再前进 ⇒ 转入 idle。
 *     ⚠️ **为什么"静默判定"必须在组件内**：父组件（`LiveTailView`）在流式期以 ≤20Hz 重建，
 *     任何"带时间的状态"放在父层都会抖（打字机每拍追平/落后）；光球本来就有 30fps 循环，
 *     由它自己数时间最省、最稳（父层不需要任何定时器/新状态）。
 *   · ⛔ **优先级的唯一判据** = `core/orb.ets:orbEffectiveMode(orbMode, quiet)` 纯函数
 *     （`tool > idle(显式) > idle(静默) > secondary > thinking`）。组件**不得**自己再写一份
 *     `if` 链：旧实现漏判 `secondary` ⇒ 让位态**从未生效**（与"两个高亮源打架"同源）。
 *   · 态之间**不硬切**：全部参数按**实际帧间隔**缓动到目标（`ORB_EASE_MS` = 呼吸周期/8
 *     = 320ms = `core/tokens.D_SLOW`，与全站过渡同刻度），环色用**双色交叉淡出**
 *     ⇒ 换态无跳变（Apple 式），且即便 `orbMode` 高频翻转也被缓动吸收。
 *
 * ── 深浅 / 白色主题（⛔ 按**色板亮度**判，绝不按主题名硬判）─────────────────────
 *   深色系：光晕 `eff().glow`（accent@45%）· 核 accentSoft→accent · 环 accentSoft ·
 *           细环 `eff().glowSoft` —— **既有观感逐字节不变**。
 *   浅色系（含原生独享的 `porcelain` 纯白 `#FFFFFF`）：白底上 45% 饱和色晕会读成"脏"
 *           ⇒ 光晕改 `eff().elev2`（正文色相@10% 的**中性柔影**）、核与环用**更饱和的实体色**
 *           `pal().accent`、细环改 `pal().border`（中性发丝）= "白底 + 一颗实心 Apple 蓝光核"。
 *   判据 `isLightPalette(paletteOf(theme))`（按 `appBg` 感知亮度 —— `core/theme.ets` 注释明示
 *   它对新增色板/强调色覆盖都成立）⇒ 未来再加主题也不会漏。
 *
 * ── 性能（⚠️ 流式期每帧都在跑）──────────────────────────────────────────────
 *   · 重绘节流：thinking/tool 30fps、idle 12fps（呼吸是慢动作，60fps 无肉眼收益却双倍功耗）；
 *   · ⛔ **绘制路径零额外分配、零字符串运算**：`paletteOf/effectsOf`（每次都会新建 ~31 个
 *     字符串 + 9 次 `alphaHex` 字符串运算）**只在 `theme` 变化时预解析一次**（`OrbPaint`），
 *     逐帧只读字段。每帧不可避免的分配只剩 2 个 `CanvasGradient` + `core/orb.ets` 的粒子数组
 *     （Canvas API 与既有纯函数的形态，本层不复制其实现）。
 *   · 停表条件：`active=false` / `paused=true`（后台，官规 §3）/ `reduceMotion=true`（降级）
 *     ⇒ **立即停表**并补画一帧静息态，绝不空转。
 *   · 进场用既有动效底座 `components/anim.ets` 的 `animBase()`（220ms + 全站 spring 曲线），
 *     opacity 0→1 + scale 0.86→1 —— **不新造曲线/时长**。
 *
 * ⛔ 为什么是 `@Component` 而非带参全局 `@Builder`：本组件的可见内容**随时间与态变化**，
 *   而带参 `@Builder` 的参数是"调用那一刻的快照"、子树不随参数重建（项目头号铁律，
 *   见 `docs/ARKTS-GOTCHAS.md §4`）⇒ 必须用 `@Component` + `@Prop`。
 *
 * ⛔ 为什么用 `Canvas` 而不是 `Shape/Path`：光球 = 两层径向渐变 + N 个动态光点，
 *   逐帧变化的渐变色标无法用声明式 `Shape` 表达；`Canvas` 一次 `clearRect + 重绘` 即可。
 */
import { Palette, paletteOf, Effects, effectsOf, isLightPalette, relativeLuminance } from '../core/theme';
import { hairlineOf, inflightHaloOf } from '../core/design';
import {
  ORB_SPIN_MS, ORB_BREATH_MIN, ORB_BREATH_MAX,
  ORB_OPACITY_MIN, ORB_OPACITY_MAX, ORB_RING_RADIUS,
  ORB_CORE_SOLID_STOP, ORB_CORE_MID_STOP, ORB_HALO_DECAY_STOP,
  ORB_FPS_MAIN, ORB_FPS_SECONDARY, ORB_FPS_IDLE, orbTargetFps, orbEffectiveMode,
  ORB_DEPTH_THINKING, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR,
  ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR, orbDepthOf, orbDepthGain,
  OrbParticle, orbRadiusFine, orbOpacityFine, orbParticles, orbWave,
} from '../core/orb';
import { animBase, MOTION_BREATH_MS, MOTION_QUIET_MS } from './anim';
import { activityVitality, vitalityGain } from '../core/motion';

/** 默认直径（vp）—— 与既有「思考中」文字行（FS_CAPTION 12fp）等高量级。 */
const ORB_DEFAULT_SIZE: number = 22;
/** 粒子数（环上光点）。9 枚在 22vp 下不糊、不空。 */
const ORB_PARTICLE_COUNT: number = 9;
// 帧率策略集中在 `core/orb.ets:orbTargetFps`（"态 × 可见性"的**纯函数**：主态恒 `ORB_FPS_MAIN`、
// 让位态 `ORB_FPS_SECONDARY`、静默态 `ORB_FPS_IDLE`、不可见 = 停表）。本组件**不复制第二份帧率**，
// 逐帧用 `orbTargetFps(mode, visible)` 取目标值（见 `draw()`）。
/** 核半径比例（相对半尺寸）—— 呼吸在此基准上浮动。 */
const ORB_CORE_SCALE: number = 0.62;
/** 态过渡收敛时长 = 主呼吸/8 = 320ms（= `core/tokens.D_SLOW`，与全站过渡同刻度）。 */
const ORB_EASE_MS: number = MOTION_BREATH_MS / 8;
/**
 * 静默判定窗口：**直接取 `anim.ets` 的共享常量**（`思考 N 字` 用的是同一个值）
 * ⇒ 整组对"机器还在动吗"的判断必然一致，不会一个还在呼吸、另一个已经定格。
 */
const ORB_QUIET_MS: number = MOTION_QUIET_MS;
/** 外光晕不透明度（深色系 —— 既有值，观感不变）。 */
const ORB_HALO_ALPHA: number = 0.9;
/** 外光晕不透明度（浅色系：中性柔影已很淡，再收一点避免白底发灰雾）。 */
const ORB_HALO_ALPHA_LIGHT: number = 0.7;
/**
 * `tool` 态：细环（"仪器环"）的强度增益（0 = 不变）。
 *
 * 为什么需要它：**porcelain/light 主题下 `statusRunning` 与 `accent` 同为 `#0071E3`**
 * （`core/theme.ets:343` / `:170`）⇒ `tool` 与 `thinking` 的**环色相同**，"工具在跑"只剩
 * "公转快 2.2×"这一个**动态**线索 —— **静帧下不可辨**（违反"一眼可辨"）。
 * 这里让细环在 `tool` 态**变亮**（一个**静态**、与颜色无关的维度）作为补充线索，
 * 且强度由已缓动的 `colorMix` 驱动 ⇒ 换态不硬切（见 `draw()`）。
 * ⛔ 不是新造动效：细环本身在既有 30/20fps 循环里画，只是"画得更亮"。
 */
const ORB_TOOL_STROKE_SPAN: number = 0.8;
/** 进场起始缩放（弹簧放大到 1）—— 与 `anim.ets` 的 spring 曲线配合。 */
const ORB_ENTER_SCALE: number = 0.86;

// ── 真实信号 → 动势（波5j：由"内容前进速率"驱动，而非定时器自嗨）────────────────
/**
 * 呼吸幅度受动势影响的**跨度**：`±0.18`。
 * `vital=0.5 ⇒ ×1.0`（既有观感逐值不变）；高速 ⇒ ×1.18（更"有劲"）；停顿 ⇒ ×0.82（收敛）。
 */
const ORB_VITAL_AMP_SPAN: number = 0.18;
/** 公转速度受动势影响的跨度：`±0.5`（高速明显转得快 ⇒ "它在赶活"一眼可辨）。 */
const ORB_VITAL_SPIN_SPAN: number = 0.5;
/** 光晕受动势影响的跨度：`±0.25`（高速更亮，停顿更暗）。 */
const ORB_VITAL_HALO_SPAN: number = 0.25;
/**
 * 动势初值 = **0.5（中性）**：首帧（还没有心跳采样）⇒ 倍数恰为 1.0
 * ⇒ 与上一轮验收过的静帧观感**逐值一致**（不会"开场先弱一下"）。
 */
const ORB_VITAL_INIT: number = 0.5;

// ── 收束（回合结束的"落地感"）────────────────────────────────────────────────
/** 收束静止位的缩放（略收 ⇒ 读作"落到停稳"，而不是"被掐断")。 */
const ORB_SETTLE_SCALE: number = 0.9;
/** 收束静止位的不透明度。 */
const ORB_SETTLE_ALPHA: number = 0.72;

// ── 态常数（**导出**：调用方与契约文档引用同一份字符串）────────────────────────
/** 思考中 / 生成中：呼吸 + 能量脉动（既有观感）。 */
export const ORB_MODE_THINKING: string = 'thinking';
/** 工具调用中：粒子环加速公转 + 轨道外扩 + 环色转"运行中"语义色（一眼可辨）。 */
export const ORB_MODE_TOOL: string = 'tool';
/** 空闲：极低幅度（呼吸 ×0.25、光晕 ×0.45、粒子冻结）+ 降帧 —— "静止也是设计"。 */
export const ORB_MODE_IDLE: string = 'idle';
/**
 * 让位态：**此刻别处才是主高亮源**（典型 = `思考 N 字` 的强调脉冲，见
 * `docs/DESIGN-SYSTEM.md §8`）⇒ 光球仍在（呼吸/公转都减半），但一眼看去明显不是主角。
 * 与 `idle` 的区别：`idle` = "机器没动静"；`secondary` = "机器在动，但这次不是它领读"。
 */
export const ORB_MODE_SECONDARY: string = 'secondary';

// ── 态 → 视觉参数 ────────────────────────────────────────────────────────────
/** tool 态：呼吸幅度（略收 —— 注意力交给"轨道/色彩"，不靠抖）。 */
const ORB_TOOL_AMP: number = 0.9;
/**
 * tool 态：公转相位加速倍数。
 * ⚠️ 这是**同一套 `orbParticles`/`ORB_SPIN_MS` 的相位推进加快**（等价于把周期按此倍数缩短），
 * 不是"新造一套时长"—— 时钟仍然只有 `core/orb.ets` 那两个周期。
 */
const ORB_TOOL_SPIN_GAIN: number = 2.2;
/** tool 态：粒子轨道外扩比例（"轨道偏移"，让两态在静帧下也能区分）。 */
const ORB_TOOL_RING_GAIN: number = 1.08;
/** idle 态：呼吸/透明度幅度缩放（0.25 ⇒ 只剩一丝"还活着"）。 */
const ORB_IDLE_AMP: number = 0.25;
/** idle 态：光晕强度缩放。 */
const ORB_IDLE_HALO: number = 0.45;
/** 让位态：呼吸幅度减半（还在呼吸，但明显不是主角）。 */
const ORB_SECONDARY_AMP: number = 0.5;
/** 让位态：光晕减半。 */
const ORB_SECONDARY_HALO: number = 0.55;
/** 让位态：公转减半（慢下来，"退到背景"）。 */
const ORB_SECONDARY_SPIN: number = 0.5;

/**
 * 一个态的视觉参数（**纯数据**）。
 * 模块级**常量实例**持有 ⇒ 逐帧 `orbStateOf()` 只返回既有对象，**零分配**。
 */
export class OrbState {
  /** 呼吸/透明度幅度（1 = 既有幅度）。 */
  amp: number = 1;
  /** 外光晕强度（1 = 既有强度）。 */
  halo: number = 1;
  /** 公转相位增益（0 = 冻结）。 */
  spin: number = 1;
  /** 粒子轨道半径增益。 */
  ring: number = 1;
  /** 环色是否转 `pal().statusRunning`（工具在飞）。 */
  ringTool: boolean = false;

  constructor(amp: number, halo: number, spin: number, ring: number, ringTool: boolean) {
    this.amp = amp;
    this.halo = halo;
    this.spin = spin;
    this.ring = ring;
    this.ringTool = ringTool;
  }
}

// ⚠️ 帧率**不在** `OrbState` 里：它是"态 × 可见性"的纯策略，且必须与 `core/orb.ets` 的
//    `orbTargetFps` **同源**（避免"两处各写一份帧率"）。组件每帧用 `orbTargetFps(mode, visible)`
//    取目标帧率（见 `draw()`）。
const ST_THINKING: OrbState = new OrbState(1, 1, 1, 1, false);
const ST_TOOL: OrbState = new OrbState(ORB_TOOL_AMP, 1, ORB_TOOL_SPIN_GAIN, ORB_TOOL_RING_GAIN, true);
const ST_IDLE: OrbState = new OrbState(ORB_IDLE_AMP, ORB_IDLE_HALO, 0, 1, false);
const ST_SECONDARY: OrbState = new OrbState(ORB_SECONDARY_AMP, ORB_SECONDARY_HALO, ORB_SECONDARY_SPIN, 1, false);

/** 态名 → 视觉参数（未知态回落 `thinking`；返回**共享常量**，无分配）。 */
export function orbStateOf(mode: string): OrbState {
  if (mode === ORB_MODE_TOOL) {
    return ST_TOOL;
  }
  if (mode === ORB_MODE_IDLE) {
    return ST_IDLE;
  }
  if (mode === ORB_MODE_SECONDARY) {
    return ST_SECONDARY;
  }
  return ST_THINKING;
}

/**
 * 预解析的绘制色（**每帧只读**）。
 *
 * 为什么需要它：`paletteOf()` / `effectsOf()` 每次调用都会新建 Palette/Effects（~31 个字符串）
 * 并跑 9 次 `alphaHex`（字符串切片/拼接）—— 那正是"绘制路径禁止字符串运算/对象分配"要禁掉的。
 * 现在只在 `theme` 变化时解析一次，逐帧只读这些字段。
 */
class OrbPaint {
  /** 外光晕（深色 = accent 发光；浅色 = 中性柔影）。 */
  halo: string = '';
  /** 核亮心色。 */
  coreInner: string = '';
  /** 核主色。 */
  coreOuter: string = '';
  /** 粒子环基准色。 */
  ring: string = '';
  /** 粒子环"工具在飞"色（与基准色交叉淡出）。 */
  ringTool: string = '';
  /** 细环描边色。 */
  stroke: string = '';
  /** 全透明（渐变终点）。 */
  clear: string = '';
  /** 光晕不透明度（深浅不同）。 */
  haloAlpha: number = ORB_HALO_ALPHA;
}

@Component
export struct AssistantOrb {
  /** 主题名（决定语义色板；未知值在 `paletteOf` 内回落深色）。 */
  @Prop @Watch('onInputChange') theme: string = 'dark';
  /**
   * 直径（vp）。
   *
   * ⛔ **绝不能命名为 `size`**：ArkUI 的 `CustomComponent` 基类已占用 `size`
   *   （自定义组件支持通用属性 `.size()`）⇒ 子类声明同名成员直接编译失败：
   *   `Property 'size' in type 'AssistantOrb' is not assignable to the same property
   *    in base type 'CustomComponent'`（2026-10-11 真机门禁实测，此前该组件无消费者
   *   ⇒ 从未被 ArkTS 类型检查过，接线后才暴露）。
   *
   *   同类需避开的基类成员名（`sdk …/ets/component/common.d.ts` 的
   *   `CommonAttribute` + `BaseCustomComponent` 实测清单）：
   *   `width` / `height` / `padding` / `margin` / `position` / `offset` / `scale` /
   *   `rotate` / `opacity` / `visibility` / `clip` / `zIndex` / `id` / `key` /
   *   `enabled` / `layout` / `measure` / `uniqueId` / `measureResult` / `align` /
   *   `direction` / `layoutWeight` / `constraintSize` / `stateStyles` / `transform` /
   *   `translate` / 一切 `on*`（`onAppear`/`onClick`/`onMeasure` …）。
   *   安全写法：语义化前缀（本处 `orbSize`）。
   */
  @Prop @Watch('onInputChange') orbSize: number = ORB_DEFAULT_SIZE;
  /** 是否正在思考/生成。false ⇒ 停表 + 画一帧静息态。 */
  @Prop @Watch('onInputChange') active: boolean = true;
  /** 应用是否在后台（官方性能规范：后台必须挂起非必要动画）。 */
  @Prop @Watch('onInputChange') paused: boolean = false;
  /** 实例种子：同屏多枚时错开相位（视觉不"齐步走"）。 */
  @Prop @Watch('onInputChange') seed: number = 0;
  /**
   * 运行态：`thinking` / `tool` / `idle`（见 `orbStateOf`）。
   * **会变** ⇒ 必须是 `@Prop`（带参 `@Builder` 会冻在首帧）。
   */
  @Prop @Watch('onInputChange') orbMode: string = ORB_MODE_THINKING;
  /**
   * 活动心跳：调用方每次"内容前进"给它一个新值（本仓 = 正文+思考的**码点长度和**）。
   * 光球据此**自己**判定静默（见 `ORB_QUIET_MS`），转 `idle` —— 父层不必持任何定时器。
   */
  @Prop @Watch('onInputChange') orbBeat: number = 0;
  /**
   * 降级（reduce motion）：静止呈现（画一帧）+ 停表。
   *
   * ⚠️ 本工程 `compatibleSdkVersion 21`：系统查询入口
   *   `accessibility.isAnimationReduceEnabledSync()` 是 **@since 23**
   *   （`sdk …/api/@ohos.accessibility.d.ts:658`，同族的 on/off 也是 23）⇒ **当前不可用**。
   *   故降级由这个 `@Prop` 承载（接线点见 `LiveTailView` 调用处）；将来 SDK 抬到 23 时，
   *   在此处读系统值取"或"即可，组件其余逻辑不用改。
   */
  @Prop @Watch('onInputChange') reduceMotion: boolean = false;

  /** 进场弹簧的可见性（`onAppear` 后置 true；失败兜底见 `build()` 注释）。 */
  @State entered: boolean = false;
  /**
   * 收束静止位（回合结束的"落地感"）。
   * true ⇒ 可见属性缓动到 rest 值（`ORB_SETTLE_SCALE` / `ORB_SETTLE_ALPHA`），
   * 下一回合开始（`active` 回到 true）再弹回。
   * ⛔ 只影响 `.opacity()` / `.scale()`（**transform/opacity**）⇒ 不触发 relayout。
   */
  @State settled: boolean = false;

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private timer: number = -1;
  /** 当前定时器间隔（ms）—— 用于"态变 ⇒ 帧率变"时只在**确实需要**时重启。 */
  private intervalMs: number = 0;
  private ready: boolean = false;
  /**
   * 组件是否**可见**（`onVisibleAreaChange` 维护）。
   *
   * 为什么需要它：光球挂在消息列表的行里；一旦这一行**滚出屏幕**，30fps 的全量重绘就是
   * 纯浪费（用户看不到任何东西）。默认 `true` ⇒ **不改变任何既有行为**；只有真的收到
   * "完全滚出"事件才停表（回来立即恢复）。
   * ⛔ 用普通字段（不用 `@State`）：它不参与 build() 的可见内容，只影响"要不要跑定时器"
   *   ⇒ 进 `@State` 反而会引入无谓的重建。
   */
  private visible: boolean = true;

  // ── 绘制缓存（⛔ 逐帧路径只读，不解析、不分配）──────────────────────────────
  private paint: OrbPaint = new OrbPaint();
  private paintDirty: boolean = true;

  // ── 态与缓动（全部是**标量**，无对象/字符串）────────────────────────────────
  /** 上次活动心跳值（与 `orbBeat` 不等 ⇒ 刷新"最后活动时刻"）。 */
  private lastBeat: number = 0;
  /** 最后一次活动时刻（ms）—— 静默判定的基准。 */
  private lastBeatAt: number = 0;
  /** 上一帧时刻（ms）—— 缓动按**实际帧间隔**收敛（与帧率解耦）。 */
  private lastFrameAt: number = 0;
  /** 缓动中的当前值（初始 = thinking 的目标值 ⇒ 首帧即既有观感）。 */
  private ampCur: number = 1;
  private haloCur: number = 1;
  private spinCur: number = 1;
  private ringCur: number = 1;
  /**
   * 景深强度（缓动到 `orbDepthOf(mode)`）。
   * 初值 = `thinking` 档 ⇒ 首帧即常态（与其它 Cur 同一处理：不"开场先弱一下"）。
   */
  private depthCur: number = ORB_DEPTH_THINKING;
  /** 环色交叉淡出：0 = 基准色，1 = 工具色。 */
  private colorMix: number = 0;
  /** 当前生效帧率（态/可见性变化时用于重设定时器）。初值 = 主态（与既有行为一致）。 */
  private fpsCur: number = ORB_FPS_MAIN;
  /**
   * 公转相位累加器（ms）。
   * ⛔ **必须累加，不能用 `now * spinCur`**：增益缓动（1→2.2）时，"绝对时刻 × 缓动增益"
   *   会让相位**跳变**（`now` 是 1e12 量级，Δgain 0.1 就是 1e11 ms 的相位跳）⇒ 粒子环瞬移。
   *   累加 = 相位连续、速度平滑变化（物理上正确的"角速度积分"）。
   */
  private spinPhaseMs: number = 0;
  /** 上一帧采样的心跳值（算"内容前进速率"的分子）。 */
  private beatSample: number = 0;
  /** 上一帧采样时刻（算速率的分母）。 */
  private beatSampleAt: number = 0;
  /** 平滑后的**动势** ∈ [0,1]（0.5 = 常态 ⇒ 倍数恰 1.0；见 `vitalityGain`）。 */
  private vitalCur: number = ORB_VITAL_INIT;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  aboutToAppear(): void {
    this.lastBeatAt = Date.now();
    this.lastFrameAt = this.lastBeatAt;
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  /** 任一输入变化 ⇒ 重算缓存/循环开关（并把新颜色落进缓存）。 */
  private onInputChange(p: string): void {
    if (p === 'theme') {
      this.paintDirty = true;
    } else if (p === 'orbBeat') {
      // 心跳前进了 ⇒ 刷新静默计时（并把"从 idle 醒来"交给 syncLoop 重启定时器）
      this.lastBeat = this.orbBeat;
      this.lastBeatAt = Date.now();
    } else if (p === 'active') {
      // 回合结束/开始 ⇒ 收束/起势（只动 transform/opacity，见 applySettle）
      this.applySettle(!this.active);
    }
    this.syncLoop();
  }

  /**
   * 回合结束的**收束**（不"啪"地断掉）。
   *
   * 为什么需要：`active=false` 时旧实现是"立即停表 + 补画一帧" ⇒ 观感上光球在呼吸中途
   * **被掐断**（上一轮用户可见的最后一帧没有"落地"）。这里在切换的**那一瞬**用既有动效底座
   * `animBase()`（220ms + 全站 spring 曲线，曲线自带 overshoot ⇒ 天然"轻回弹后停稳"）
   * 把 `.opacity()` / `.scale()` 缓动到 rest 值；下一回合开始再弹回。
   *
   * ⛔ **只动 transform/opacity**：不碰 width/height/margin/padding/position ⇒ 不触发
   *   relayout，只走合成层（低端机也不掉帧）。
   * ⛔ **不是定时器驱动**：每次回合切换只跑 **1 次** `animateTo`，与 30fps 的绘制循环无关
   *   （绝不引入 `setInterval` 驱动的每帧 setState）。
   */
  private applySettle(on: boolean): void {
    if (on === this.settled) {
      return;
    }
    animateTo(animBase(), () => {
      this.settled = on;
    });
  }

  /** 可见缩放（**收束/进场** 都只在此处体现 ⇒ 属性变化仅限 transform）。 */
  private visScale(): number {
    if (!this.entered) {
      return ORB_ENTER_SCALE;
    }
    return this.settled ? ORB_SETTLE_SCALE : 1;
  }

  /** 可见不透明度（同上，仅 opacity）。 */
  private visAlpha(): number {
    if (!this.entered) {
      return 0;
    }
    return this.settled ? ORB_SETTLE_ALPHA : 1;
  }

  /** 是否应当持续重绘（后台/停用/降级/**不可见** ⇒ 一律不跑）。 */
  private shouldRun(): boolean {
    return this.ready && this.active && !this.paused && !this.reduceMotion && this.visible;
  }

  /** 依据 `active`/`paused`/`reduceMotion`/**可见性** 起停定时器；停时补画一帧静息态（绝不留旧帧）。 */
  private syncLoop(): void {
    if (!this.ready) {
      return;
    }
    if (this.shouldRun()) {
      if (this.timer < 0) {
        this.startTimer(this.intervalFor(this.fpsCur));
      }
    } else {
      this.stopTimer();
      // 不可见时**不补画**：那一帧画给谁也看不见（省一次全量重绘）；重新可见时定时器会
      // 立刻重启（首拍 ≤ 一帧间隔），观感无差异。
      if (this.visible) {
        this.draw();
      }
    }
  }

  /**
   * 可见性变化（`onVisibleAreaChange`）——"滚出屏幕 ⇒ 停表"。
   *
   * ⛔ 必须能**恢复**（批次曾出过"动效卡住不恢复"）：这里只是把 `visible` 写进去再走一遍
   *   `syncLoop()` ⇒ 重新可见时立刻重启定时器；且 `visible` 默认 `true`，
   *   **即使本回调一次都不触发，行为也与改动前完全一致**（不会出现"再也动不起来"）。
   */
  private onVisibility(isVisible: boolean): void {
    if (isVisible === this.visible) {
      return;
    }
    this.visible = isVisible;
    if (isVisible) {
      // 长时间停表后，把"上一帧时刻"归零 ⇒ 首帧的 `dt` 不会是一个巨大的墙钟差
      // （缓动本身有 `min(1, ...)` 上限，这里只是让首帧更干净）。
      this.lastFrameAt = Date.now();
    }
    this.syncLoop();
  }

  private intervalFor(fps: number): number {
    return Math.max(8, Math.round(1000 / (fps > 0 ? fps : ORB_FPS_MAIN)));
  }

  private startTimer(ms: number): void {
    this.intervalMs = ms;
    this.timer = setInterval(() => {
      this.draw();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
      this.intervalMs = 0;
    }
  }

  /** 态变导致目标帧率变 ⇒ 重启定时器（只在**确实不同**时；不打断画布内容）。 */
  private retuneTimer(fps: number): void {
    if (this.timer < 0) {
      return;
    }
    const want: number = this.intervalFor(fps);
    if (want === this.intervalMs) {
      return;
    }
    this.stopTimer();
    this.startTimer(want);
  }

  /**
   * 有效态（**判定全部在 `core/orb.ets:orbEffectiveMode` 纯函数里**，本方法只是喂两个采样量）。
   *
   * ⛔ 为什么不再在组件里写 `if` 链：旧实现只认 `tool`/`idle`，其余回落
   *   `quiet ? idle : thinking` ⇒ **`secondary`（让位）不可达** —— `LiveTailView` 传了也让不了位，
   *   光球在该退居背景时仍满幅呼吸，与 `思考 N 字` 争主高亮。判定上收纯函数后：
   *   优先级有唯一判据、可脱机单测、可变异自证（见 `tools/tests/orb.test.ts`）。
   * 纯判断，无分配（纯函数返回共享常量字符串）。
   */
  private effectiveMode(now: number): string {
    return orbEffectiveMode(this.orbMode, (now - this.lastBeatAt) > ORB_QUIET_MS);
  }

  /** 预解析绘制色（只在 `theme` 变化时跑一次）。 */
  private buildPaint(): void {
    const pal: Palette = this.pal();
    const eff: Effects = this.eff();
    const light: boolean = isLightPalette(pal);
    this.paint.clear = pal.transparent;
    if (light) {
      // 白底：中性柔影光晕 + 更饱和的实体色核/环 + 中性发丝细环（"干净"的来源）
      this.paint.halo = inflightHaloOf(pal);
      this.paint.haloAlpha = ORB_HALO_ALPHA_LIGHT;
      // 亮心必须**在里**（与深色同一读法："亮心 → 主色 → 全透明"）。
      // ⚠️ 不能写死 `inner=accentSoft`：浅色系的 `accentSoft` 相对 `accent` 的明暗**因主题而异**
      //    （porcelain 更暗、light 更亮）⇒ 按**相对亮度**取亮的那一个作亮心，否则 porcelain 的
      //    "发光核"会读成暗心（跟深色观感相反）。两个都是既有 token，不自造色值。
      const softBrighter: boolean = relativeLuminance(pal.accentSoft) >= relativeLuminance(pal.accent);
      this.paint.coreInner = softBrighter ? pal.accentSoft : pal.accent;
      this.paint.coreOuter = softBrighter ? pal.accent : pal.accentSoft;
      this.paint.ring = pal.accent;
      this.paint.ringTool = pal.statusRunning;
      // 细环是"弧/球有多大的**参照系**"，白底上必须真的看得见 ⇒ 用**结构性发丝** `hairline`
      // （浅色系由它压深到 web 基线；`border` 在白底只有 ~1.18，半透明再打对折后基本消失）。
      this.paint.stroke = hairlineOf(pal);
    } else {
      // 深色：既有观感（accent 发光 + accentSoft 环 + glowSoft 细环），逐值不变
      this.paint.halo = inflightHaloOf(pal);
      this.paint.haloAlpha = ORB_HALO_ALPHA;
      this.paint.coreInner = pal.accentSoft;
      this.paint.coreOuter = pal.accent;
      this.paint.ring = pal.accentSoft;
      this.paint.ringTool = pal.statusRunning;
      this.paint.stroke = eff.glowSoft;
    }
    this.paintDirty = false;
  }

  /**
   * 画一帧。时间取 `Date.now()`（毫秒，单调足够）—— 呼吸/公转周期都是毫秒级，
   * 直接喂给 `core/orb.ets` 的纯函数即可（相位函数自带取模，无需本地累加）。
   */
  private draw(): void {
    if (this.paintDirty) {
      this.buildPaint();
    }
    const now: number = Date.now();
    // 心跳后退（父层同值重赋不会触发 @Watch 的情况也兜住）⇒ 静默计时最准
    if (this.orbBeat !== this.lastBeat) {
      this.lastBeat = this.orbBeat;
      this.lastBeatAt = now;
    }
    const mode: string = this.effectiveMode(now);
    const st: OrbState = orbStateOf(mode);
    // 缓动：按**实际帧间隔**收敛（30fps 与 idle 的 12fps 拥有同一段墙钟收敛时间）
    let dt: number = now - this.lastFrameAt;
    if (!(dt > 0)) {
      dt = 1000 / ORB_FPS_MAIN;
    }
    this.lastFrameAt = now;
    const k: number = Math.min(1, dt / ORB_EASE_MS);
    this.ampCur = this.ampCur + (st.amp - this.ampCur) * k;
    this.haloCur = this.haloCur + (st.halo - this.haloCur) * k;
    this.spinCur = this.spinCur + (st.spin - this.spinCur) * k;
    this.ringCur = this.ringCur + (st.ring - this.ringCur) * k;
    // 景深强度：同款缓动（态变不硬切）。策略在 `core/orb.ets:orbDepthOf`（唯一判据，不在此写 if 链）。
    this.depthCur = this.depthCur + (orbDepthOf(mode) - this.depthCur) * k;
    const mixTarget: number = st.ringTool ? 1 : 0;
    this.colorMix = this.colorMix + (mixTarget - this.colorMix) * k;

    // ── 真实信号 → 动势（波5j）────────────────────────────────────────────────
    // 唯一连续的"真信号" = 内容**实际前进速率**（`orbBeat` 的增量 / 实际帧间隔）。
    // ⇒ "它在真干活"可被眼睛感知：吐字快 ⇒ 呼吸更大、公转更快、光晕更亮；
    //    停顿 ⇒ 同步收敛（在 640ms 静默窗判定 idle 之前就已"慢下来"，不会突兀）。
    // ⛔ 不用任何自嗨波形/随机数：动势**只能**由这两个采样量决定。
    const dBeat: number = this.orbBeat - this.beatSample;
    this.beatSample = this.orbBeat;
    const sdt: number = now - this.beatSampleAt;
    this.beatSampleAt = now;
    const vitalTarget: number = activityVitality(dBeat, sdt);
    this.vitalCur = this.vitalCur + (vitalTarget - this.vitalCur) * k;
    const vAmp: number = vitalityGain(this.vitalCur, ORB_VITAL_AMP_SPAN);
    const vSpin: number = vitalityGain(this.vitalCur, ORB_VITAL_SPIN_SPAN);
    const vHalo: number = vitalityGain(this.vitalCur, ORB_VITAL_HALO_SPAN);

    // 目标帧率 = "有效态 × 可见性"的**纯策略**（`core/orb.ets:orbTargetFps`）——
    // 主态恒 30（丝滑），让位态 18，静默态 12，不可见 0（但那时定时器已停，这里仍取 0 只作守卫）。
    const wantFps: number = orbTargetFps(mode, this.visible);
    if (wantFps !== this.fpsCur) {
      this.fpsCur = wantFps;
      this.retuneTimer(wantFps);
    }

    const s: number = this.orbSize > 0 ? this.orbSize : ORB_DEFAULT_SIZE;
    const c: number = s / 2;
    const paint: OrbPaint = this.paint;
    const ctx: CanvasRenderingContext2D = this.ctx;

    // 呼吸：只对**偏移量**做幅度缩放 ⇒ amp=1 且 vital=0.5 时与上一轮实现仅在"中段的
    // 2× 谐波细微起伏"上不同（端点逐值不变）。双频见 `core/orb.ets:orbBreathFine`。
    const baseR: number = c * ORB_CORE_SCALE;
    const rRaw: number = orbRadiusFine(now, baseR, MOTION_BREATH_MS, ORB_BREATH_MIN, ORB_BREATH_MAX);
    const coreR: number = baseR + (rRaw - baseR) * this.ampCur * vAmp;
    const oRaw: number = orbOpacityFine(now, MOTION_BREATH_MS, ORB_OPACITY_MIN, ORB_OPACITY_MAX);
    const op: number = 1 - (1 - oRaw) * this.ampCur * vAmp;
    // 公转相位：**按实际帧间隔累加**（`dt × 平滑增益`）—— 增益变化时相位连续、不跳（见字段注释）
    this.spinPhaseMs += dt * this.spinCur * vSpin;
    const tSpin: number = this.spinPhaseMs;
    const wobble: number = orbWave(tSpin / ORB_SPIN_MS, this.seed * 0.1, this.seed);

    ctx.clearRect(0, 0, s, s);

    // ① 外发光：半透明光晕 → 全透明 的径向渐变（存在感来源；深浅色取值不同，见 buildPaint）。
    //    衰减停靠点 `ORB_HALO_DECAY_STOP` < 1：光晕在画布边缘**之前**就归零 ⇒ 留干净留白。
    const halo: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, paint.halo);
    halo.addColorStop(ORB_HALO_DECAY_STOP, paint.clear);
    halo.addColorStop(1, paint.clear);
    ctx.globalAlpha = op * paint.haloAlpha * this.haloCur * vHalo;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // ② 发光核：实心亮心（平台）→ 主色 → 全透明（停靠点见 core/orb.ets，单一来源）。
    const core: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, coreR);
    core.addColorStop(0, paint.coreInner);
    core.addColorStop(ORB_CORE_SOLID_STOP, paint.coreInner);
    core.addColorStop(ORB_CORE_MID_STOP, paint.coreOuter);
    core.addColorStop(1, paint.clear);
    ctx.globalAlpha = op;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // ③ 粒子环：缓慢公转的光点（`core/orb.ets` 出单位圆坐标，这里换算成像素）。
    const ringR: number = c * ORB_RING_RADIUS * this.ringCur * (0.97 + 0.03 * wobble);
    const unit: number = s / ORB_DEFAULT_SIZE; // 尺寸缩放因子（基准 22vp）
    const ps: OrbParticle[] = orbParticles(ORB_PARTICLE_COUNT, tSpin, this.seed, ORB_SPIN_MS);
    // 环色**交叉淡出**：基准色权重 (1-mix) + "工具在飞"色权重 mix ⇒ 换态不跳色
    const mix: number = this.colorMix;
    const baseW: number = 1 - mix;
    if (baseW > 0.002) {
      ctx.fillStyle = paint.ring;
      this.paintParticles(ctx, ps, c, ringR, unit, op, baseW, this.depthCur);
    }
    if (mix > 0.002) {
      ctx.fillStyle = paint.ringTool;
      this.paintParticles(ctx, ps, c, ringR, unit, op, mix, this.depthCur);
    }

    // ④ 细环描边：极弱的一圈，给出"仪器感/科技感"（几乎不可见但存在）。
    //    `tool` 态下**变亮**（`ORB_TOOL_STROKE_SPAN` × 已缓动的 `colorMix`）—— 一个**静态**、
    //    与颜色无关的"工具在跑"线索（porcelain/light 下 tool 与 thinking 环**同色**，见常量注释）。
    ctx.globalAlpha = op * 0.5 * (1 + ORB_TOOL_STROKE_SPAN * this.colorMix);
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = Math.max(1, unit * 0.6);
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  /**
   * 粒子环一轮（基准色/工具色共用）；`weight` = 该遍颜色的权重（交叉淡出用）；
   * `depth` = 态景深强度（`core/orb.ets:orbDepthOf` 缓动而来）。
   *
   * **景深**（本轮的"层次"提升）：逐粒子按**纵向位置** `p.y` 给"近大远小 + 亮度差"
   * （近/远增益来自 `core/orb.ets:orbDepthGain` —— **判据与渲染同源**，组件不写第二份公式）。
   * ⛔ 两端增益均为正（`ORB_DEPTH_*_FAR > 0`）⇒ 远粒子**也看得见**，只是更小更弱。
   */
  private paintParticles(
    ctx: CanvasRenderingContext2D, ps: OrbParticle[], c: number,
    ringR: number, unit: number, op: number, weight: number, depth: number): void {
    for (let i = 0; i < ps.length; i++) {
      const p: OrbParticle = ps[i];
      const px: number = c + p.x * ringR;
      const py: number = c + p.y * ringR;
      const dSize: number = orbDepthGain(p.y, ORB_DEPTH_SIZE_NEAR, ORB_DEPTH_SIZE_FAR, depth);
      const dAlpha: number = orbDepthGain(p.y, ORB_DEPTH_ALPHA_NEAR, ORB_DEPTH_ALPHA_FAR, depth);
      const pr: number = Math.max(0.6, p.r * unit * 0.9 * dSize);
      const a: number = p.a * op * weight * dAlpha;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
    }
  }

  build() {
    Canvas(this.ctx)
      .width(this.orbSize)
      .height(this.orbSize)
      // 进场：opacity 0→1 + scale 0.86→1（`anim.ets` 的 animBase = 220ms + 全站 spring 曲线）；
      // 收束：回合结束 ⇒ opacity/scale 缓动到 rest（同样 animBase）—— **只有 transform/opacity**，
      // 无任何布局属性变化 ⇒ 不 relayout。
      // ⚠️ 兜底：即使 `animateTo` 未生效，`entered` 也只会停在 false 一帧的场景不存在 ——
      //    `onAppear` 是同步回调，`animateTo` 只影响"怎么变"，不影响"变不变"。
      .opacity(this.visAlpha())
      .scale({ x: this.visScale(), y: this.visScale() })
      .onAppear(() => {
        if (!this.entered) {
          animateTo(animBase(), () => {
            this.entered = true;
          });
        }
      })
      .onReady(() => {
        this.ready = true;
        this.lastFrameAt = Date.now();
        this.draw();
        this.syncLoop();
      })
      // 可见性：滚出屏幕 ⇒ 停表（不可见的东西不该烧电）；回来 ⇒ 立即恢复。
      // 判据用 `[0.0, 1.0]` 两个阈值 ⇒ 事件在"完全不可见(0)"与"完全可见(1)"两处触发；
      // `isVisible=false` 只在 ratio 归零时给出（`visible` 默认 true ⇒ 不触发即等于改动前行为）。
      .onVisibleAreaChange([0.0, 1.0], (isVisible: boolean, ratio: number) => {
        this.onVisibility(isVisible);
      })
  }
}
