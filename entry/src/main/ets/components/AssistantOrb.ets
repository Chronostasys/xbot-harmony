/**
 * AssistantOrb —— 旗舰「思考中 / 生成中」动效指示器（**视觉层**）。
 *
 * 设计目标（用户口令）："比 Siri 还好看 / 极简 / 苹果那种科技感 / 干净 / 交互起来很爽"。
 * 视觉语言：**一枚会呼吸的发光核 + 一圈缓慢公转的光点**（halo → core → particles），
 * 并按**运行态**切换"动效语义"（下表）—— 不是一套循环用到黑。
 *
 * ── 三态状态机（本波核心；契约见 `docs/DESIGN-SYSTEM.md §7`）────────────────────
 *   | 态 | 呼吸/能量 | 公转相位 | 轨道 | 环色 | 帧率 | 读作 |
 *   |---|---|---|---|---|---|---|
 *   | `thinking` | 1.0（既有观感） | 1.0× | 1.0× | accentSoft | 30 | 在思考 / 在写 |
 *   | `tool`     | 0.9 | **2.2×** | **1.08×** | **statusRunning** | 30 | 工具在飞（一眼可辨） |
 *   | `idle`     | **0.25** | **0.0（冻结）** | 1.0× | accentSoft | **12** | 静默（**静止也是设计**） |
 *
 *   · 态由 `@Prop orbMode` 给出（调用方从状态机派生）；`idle` 还可由光球**自己**判定：
 *     `@Prop orbBeat`（活动心跳）超过 `ORB_QUIET_MS` 未再前进 ⇒ 转入 idle。
 *     ⚠️ **为什么"静默判定"必须在组件内**：父组件（`LiveTailView`）在流式期以 ≤20Hz 重建，
 *     任何"带时间的状态"放在父层都会抖（打字机每拍追平/落后）；光球本来就有 30fps 循环，
 *     由它自己数时间最省、最稳（父层不需要任何定时器/新状态）。
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
import { Palette, paletteOf, Effects, effectsOf, isLightPalette } from '../core/theme';
import {
  ORB_BREATH_MS, ORB_SPIN_MS, ORB_BREATH_MIN, ORB_BREATH_MAX,
  ORB_OPACITY_MIN, ORB_OPACITY_MAX, ORB_RING_RADIUS,
  OrbParticle, orbRadius, orbOpacity, orbParticles, orbWave,
} from '../core/orb';
import { animBase } from './anim';

/** 默认直径（vp）—— 与既有「思考中」文字行（FS_CAPTION 12fp）等高量级。 */
const ORB_DEFAULT_SIZE: number = 22;
/** 粒子数（环上光点）。9 枚在 22vp 下不糊、不空。 */
const ORB_PARTICLE_COUNT: number = 9;
/**
 * 重绘帧率（**可调性能参数**）：默认 30fps。惰性/低端机可降到 24；高端可升 60。
 * ⚠️ Canvas 是**全量重绘**（clearRect 后重画一切）—— 帧率是这里唯一的成本旋钮。
 */
const ORB_FPS: number = 30;
/** idle 降帧：呼吸幅度已压到 1/4、粒子冻结 ⇒ 12fps 已足够平滑，且"静止也是设计"。 */
const ORB_IDLE_FPS: number = 12;
/** 核半径比例（相对半尺寸）—— 呼吸在此基准上浮动。 */
const ORB_CORE_SCALE: number = 0.62;
/** 态过渡收敛时长 = 呼吸周期/8 = 320ms（= `core/tokens.D_SLOW`，与全站过渡同刻度）。 */
const ORB_EASE_MS: number = ORB_BREATH_MS / 8;
/** 静默判定窗口 = 呼吸周期/4 = 640ms（= 2×D_SLOW）—— 复用既有节奏，不新造时长。 */
const ORB_QUIET_MS: number = ORB_BREATH_MS / 4;
/** 外光晕不透明度（深色系 —— 既有值，观感不变）。 */
const ORB_HALO_ALPHA: number = 0.9;
/** 外光晕不透明度（浅色系：中性柔影已很淡，再收一点避免白底发灰雾）。 */
const ORB_HALO_ALPHA_LIGHT: number = 0.7;
/** 进场起始缩放（弹簧放大到 1）—— 与 `anim.ets` 的 spring 曲线配合。 */
const ORB_ENTER_SCALE: number = 0.86;

// ── 态常数（**导出**：调用方与契约文档引用同一份字符串）────────────────────────
/** 思考中 / 生成中：呼吸 + 能量脉动（既有观感）。 */
export const ORB_MODE_THINKING: string = 'thinking';
/** 工具调用中：粒子环加速公转 + 轨道外扩 + 环色转"运行中"语义色（一眼可辨）。 */
export const ORB_MODE_TOOL: string = 'tool';
/** 空闲：极低幅度（呼吸 ×0.25、光晕 ×0.45、粒子冻结）+ 降帧 —— "静止也是设计"。 */
export const ORB_MODE_IDLE: string = 'idle';

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
  /** 目标帧率（idle 降帧）。 */
  fps: number = ORB_FPS;

  constructor(amp: number, halo: number, spin: number, ring: number, ringTool: boolean, fps: number) {
    this.amp = amp;
    this.halo = halo;
    this.spin = spin;
    this.ring = ring;
    this.ringTool = ringTool;
    this.fps = fps;
  }
}

const ST_THINKING: OrbState = new OrbState(1, 1, 1, 1, false, ORB_FPS);
const ST_TOOL: OrbState = new OrbState(ORB_TOOL_AMP, 1, ORB_TOOL_SPIN_GAIN, ORB_TOOL_RING_GAIN, true, ORB_FPS);
const ST_IDLE: OrbState = new OrbState(ORB_IDLE_AMP, ORB_IDLE_HALO, 0, 1, false, ORB_IDLE_FPS);

/** 态名 → 视觉参数（未知态回落 `thinking`；返回**共享常量**，无分配）。 */
export function orbStateOf(mode: string): OrbState {
  if (mode === ORB_MODE_TOOL) {
    return ST_TOOL;
  }
  if (mode === ORB_MODE_IDLE) {
    return ST_IDLE;
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

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private timer: number = -1;
  /** 当前定时器间隔（ms）—— 用于"态变 ⇒ 帧率变"时只在**确实需要**时重启。 */
  private intervalMs: number = 0;
  private ready: boolean = false;

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
  /** 环色交叉淡出：0 = 基准色，1 = 工具色。 */
  private colorMix: number = 0;
  /** 当前生效帧率（态变时用于重设定时器）。 */
  private fpsCur: number = ORB_FPS;

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
    }
    this.syncLoop();
  }

  /** 是否应当持续重绘（后台/停用/降级 ⇒ 一律不跑）。 */
  private shouldRun(): boolean {
    return this.ready && this.active && !this.paused && !this.reduceMotion;
  }

  /** 依据 `active`/`paused`/`reduceMotion` 起停定时器；停时补画一帧静息态（绝不留旧帧）。 */
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
      this.draw();
    }
  }

  private intervalFor(fps: number): number {
    return Math.max(8, Math.round(1000 / (fps > 0 ? fps : ORB_FPS)));
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
   * 有效态（`tool` 最高优先：工具在飞时不谈"静默"；`idle` 可由心跳停摆自判）。
   * 纯判断，无分配。
   */
  private effectiveMode(now: number): string {
    if (this.orbMode === ORB_MODE_TOOL) {
      return ORB_MODE_TOOL;
    }
    if (this.orbMode === ORB_MODE_IDLE) {
      return ORB_MODE_IDLE;
    }
    return (now - this.lastBeatAt) > ORB_QUIET_MS ? ORB_MODE_IDLE : ORB_MODE_THINKING;
  }

  /** 预解析绘制色（只在 `theme` 变化时跑一次）。 */
  private buildPaint(): void {
    const pal: Palette = this.pal();
    const eff: Effects = this.eff();
    const light: boolean = isLightPalette(pal);
    this.paint.clear = pal.transparent;
    if (light) {
      // 白底：中性柔影光晕 + 更饱和的实体色核/环 + 中性发丝细环（"干净"的来源）
      this.paint.halo = eff.elev2;
      this.paint.haloAlpha = ORB_HALO_ALPHA_LIGHT;
      this.paint.coreInner = pal.accentSoft;
      this.paint.coreOuter = pal.accent;
      this.paint.ring = pal.accent;
      this.paint.ringTool = pal.statusRunning;
      this.paint.stroke = pal.border;
    } else {
      // 深色：既有观感（accent 发光 + accentSoft 环 + glowSoft 细环），逐值不变
      this.paint.halo = eff.glow;
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
    const st: OrbState = orbStateOf(this.effectiveMode(now));
    // 缓动：按**实际帧间隔**收敛（30fps 与 idle 的 12fps 拥有同一段墙钟收敛时间）
    let dt: number = now - this.lastFrameAt;
    if (!(dt > 0)) {
      dt = 1000 / ORB_FPS;
    }
    this.lastFrameAt = now;
    const k: number = Math.min(1, dt / ORB_EASE_MS);
    this.ampCur = this.ampCur + (st.amp - this.ampCur) * k;
    this.haloCur = this.haloCur + (st.halo - this.haloCur) * k;
    this.spinCur = this.spinCur + (st.spin - this.spinCur) * k;
    this.ringCur = this.ringCur + (st.ring - this.ringCur) * k;
    const mixTarget: number = st.ringTool ? 1 : 0;
    this.colorMix = this.colorMix + (mixTarget - this.colorMix) * k;
    if (st.fps !== this.fpsCur) {
      this.fpsCur = st.fps;
      this.retuneTimer(st.fps);
    }

    const s: number = this.orbSize > 0 ? this.orbSize : ORB_DEFAULT_SIZE;
    const c: number = s / 2;
    const paint: OrbPaint = this.paint;
    const ctx: CanvasRenderingContext2D = this.ctx;

    // 呼吸：只对**偏移量**做幅度缩放 ⇒ amp=1 时与既有实现逐值等价
    const baseR: number = c * ORB_CORE_SCALE;
    const rRaw: number = orbRadius(now, baseR, ORB_BREATH_MS, ORB_BREATH_MIN, ORB_BREATH_MAX);
    const coreR: number = baseR + (rRaw - baseR) * this.ampCur;
    const oRaw: number = orbOpacity(now, ORB_BREATH_MS, ORB_OPACITY_MIN, ORB_OPACITY_MAX);
    const op: number = 1 - (1 - oRaw) * this.ampCur;
    // 公转相位（spinCur=0 ⇒ 冻结在相位 0；tool=2.2× ⇒ 同一 `ORB_SPIN_MS` 的相位推进更快）
    const tSpin: number = now * this.spinCur;
    const wobble: number = orbWave(tSpin / ORB_SPIN_MS, this.seed * 0.1, this.seed);

    ctx.clearRect(0, 0, s, s);

    // ① 外发光：半透明光晕 → 全透明 的径向渐变（存在感来源；深浅色取值不同，见 buildPaint）
    const halo: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, paint.halo);
    halo.addColorStop(1, paint.clear);
    ctx.globalAlpha = op * paint.haloAlpha * this.haloCur;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // ② 发光核：亮心 → 主色 → 全透明 的径向渐变。
    const core: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, coreR);
    core.addColorStop(0, paint.coreInner);
    core.addColorStop(0.55, paint.coreOuter);
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
      this.paintParticles(ctx, ps, c, ringR, unit, op, baseW);
    }
    if (mix > 0.002) {
      ctx.fillStyle = paint.ringTool;
      this.paintParticles(ctx, ps, c, ringR, unit, op, mix);
    }

    // ④ 细环描边：极弱的一圈，给出"仪器感/科技感"（几乎不可见但存在）。
    ctx.globalAlpha = op * 0.5;
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = Math.max(1, unit * 0.6);
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  /** 粒子环一轮（基准色/工具色共用）；`weight` = 该遍颜色的权重（交叉淡出用）。 */
  private paintParticles(
    ctx: CanvasRenderingContext2D, ps: OrbParticle[], c: number,
    ringR: number, unit: number, op: number, weight: number): void {
    for (let i = 0; i < ps.length; i++) {
      const p: OrbParticle = ps[i];
      const px: number = c + p.x * ringR;
      const py: number = c + p.y * ringR;
      const pr: number = Math.max(0.6, p.r * unit * 0.9);
      ctx.globalAlpha = p.a * op * weight;
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
      // 进场：opacity 0→1 + scale 0.86→1（`anim.ets` 的 animBase = 220ms + 全站 spring 曲线）
      // ⚠️ 兜底：即使 `animateTo` 未生效，`entered` 也只会停在 false 一帧的场景不存在 ——
      //    `onAppear` 是同步回调，`animateTo` 只影响"怎么变"，不影响"变不变"。
      .opacity(this.entered ? 1 : 0)
      .scale({
        x: this.entered ? 1 : ORB_ENTER_SCALE,
        y: this.entered ? 1 : ORB_ENTER_SCALE,
      })
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
  }
}
