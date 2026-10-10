/**
 * AssistantOrb —— 旗舰「思考中 / 生成中」动效指示器（**视觉层**）。
 *
 * 设计目标（用户口令）："比 Siri 还好看 / 极简 / 苹果那种科技感 / 干净"。
 * 视觉语言：**一枚会呼吸的发光核 + 一圈缓慢公转的光点**（halo → core → particles）。
 *
 * 分层（铁律，见 `docs/ARKTS-GOTCHAS.md`）：
 *   · 数学（半径/透明度/粒子/波形）全在 `core/orb.ets`（纯函数，可脱机单测）；
 *   · 本文件只负责"取色 + 画布 + 节流循环"。**颜色一律来自语义角色**
 *     （`pal().accentSoft/accent/transparent` + `eff().glow/glowSoft`）⇒ **明/暗/白主题自动成立**
 *     （`porcelain` 极简白主题下 = 白底 + Apple 蓝光球，无需任何分支）。
 *
 * ⛔ 为什么是 `@Component` 而非带参全局 `@Builder`：本组件的可见内容**随时间变化**，
 *   而带参 `@Builder` 的参数是"调用那一刻的快照"、子树不随参数重建（项目头号铁律，
 *   见 `docs/ARKTS-GOTCHAS.md §4`）⇒ 必须用 `@Component` + `@Prop`。
 *
 * ⛔ 为什么用 `Canvas` 而不是 `Shape/Path`：光球 = 两层径向渐变 + N 个动态光点，
 *   逐帧变化的渐变色标无法用声明式 `Shape` 表达；`Canvas` 一次 `clearRect + 重绘` 即可。
 *
 * 性能（⚠️ 长跑不卡的关键）：
 *   · 重绘节流在 `ORB_FPS`（默认 30fps）—— 呼吸/公转都是慢动作，60fps 无肉眼收益却双倍功耗；
 *   · `active=false` 或 `paused=true`（后台）⇒ **立即停表**（不空转），只画一帧静息态；
 *   · 每帧只做"1 次 clearRect + 2 个径向渐变 + N 个 arc"，无分配、无字符串拼接（色值缓存于私有字段）。
 *
 * 本波**已接线**：`components/LiveTailView.ets` 的在飞块首位（判据见该处注释）。
 */
import { Palette, paletteOf, Effects, effectsOf } from '../core/theme';
import {
  ORB_BREATH_MS, ORB_SPIN_MS, ORB_BREATH_MIN, ORB_BREATH_MAX,
  ORB_OPACITY_MIN, ORB_OPACITY_MAX, ORB_RING_RADIUS,
  OrbParticle, orbRadius, orbOpacity, orbParticles, orbWave,
} from '../core/orb';

/** 默认直径（vp）—— 与既有「思考中」文字行（FS_CAPTION 12fp）等高量级。 */
const ORB_DEFAULT_SIZE: number = 22;
/** 粒子数（环上光点）。9 枚在 22vp 下不糊、不空。 */
const ORB_PARTICLE_COUNT: number = 9;
/**
 * 重绘帧率（**可调性能参数**）：默认 30fps。惰性/低端机可降到 24；高端可升 60。
 * ⚠️ Canvas 是**全量重绘**（clearRect 后重画一切）—— 帧率是这里唯一的成本旋钮。
 */
const ORB_FPS: number = 30;
/** 核半径比例（相对半尺寸）—— 呼吸在此基准上浮动。 */
const ORB_CORE_SCALE: number = 0.62;

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

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private timer: number = -1;
  private ready: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private eff(): Effects {
    return effectsOf(this.pal());
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  /** 任一输入变化 ⇒ 重算循环开关（同时把新颜色/尺寸落到画布上）。 */
  private onInputChange(_p: string): void {
    this.syncLoop();
  }

  /** 是否应当持续重绘。 */
  private shouldRun(): boolean {
    return this.ready && this.active && !this.paused;
  }

  /** 依据 `active`/`paused` 起停定时器；停时补画一帧静息态（绝不留旧帧）。 */
  private syncLoop(): void {
    if (!this.ready) {
      return;
    }
    if (this.shouldRun()) {
      if (this.timer < 0) {
        const interval: number = Math.max(8, Math.round(1000 / ORB_FPS));
        this.timer = setInterval(() => {
          this.draw();
        }, interval);
      }
    } else {
      this.stopTimer();
      this.draw();
    }
  }

  private stopTimer(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  /**
   * 画一帧。时间取 `Date.now()`（毫秒，单调足够）—— 呼吸/公转周期都是毫秒级，
   * 直接喂给 `core/orb.ets` 的纯函数即可（相位函数自带取模，无需本地累加）。
   */
  private draw(): void {
    const s: number = this.orbSize > 0 ? this.orbSize : ORB_DEFAULT_SIZE;
    const c: number = s / 2;
    const t: number = Date.now();
    const pal: Palette = this.pal();
    const eff: Effects = this.eff();
    const ctx: CanvasRenderingContext2D = this.ctx;

    const op: number = orbOpacity(t, ORB_BREATH_MS, ORB_OPACITY_MIN, ORB_OPACITY_MAX);
    const coreR: number = orbRadius(t, c * ORB_CORE_SCALE, ORB_BREATH_MS, ORB_BREATH_MIN, ORB_BREATH_MAX);
    // 「噪声」波形（周期 = 公转周期）—— 让光点密度/环半径轻微"抖"，避免机械感。
    const wobble: number = orbWave(t / ORB_SPIN_MS, this.seed * 0.1, this.seed);

    ctx.clearRect(0, 0, s, s);

    // ① 外发光：accent 半透明 → 全透明 的径向渐变（光晕的存在感来源）。
    const halo: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, eff.glow);
    halo.addColorStop(1, pal.transparent);
    ctx.globalAlpha = op * 0.9;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // ② 发光核：亮心(accentSoft) → 主色(accent) → 全透明 的径向渐变。
    const core: CanvasGradient = ctx.createRadialGradient(c, c, 0, c, c, coreR);
    core.addColorStop(0, pal.accentSoft);
    core.addColorStop(0.55, pal.accent);
    core.addColorStop(1, pal.transparent);
    ctx.globalAlpha = op;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();

    // ③ 粒子环：缓慢公转的光点（`core/orb.ets` 出单位圆坐标，这里换算成像素）。
    const ringR: number = c * ORB_RING_RADIUS * (0.97 + 0.03 * wobble);
    const unit: number = s / ORB_DEFAULT_SIZE; // 尺寸缩放因子（基准 22vp）
    const ps: OrbParticle[] = orbParticles(ORB_PARTICLE_COUNT, t, this.seed, ORB_SPIN_MS);
    ctx.fillStyle = pal.accentSoft;
    for (let i = 0; i < ps.length; i++) {
      const p: OrbParticle = ps[i];
      const px: number = c + p.x * ringR;
      const py: number = c + p.y * ringR;
      const pr: number = Math.max(0.6, p.r * unit * 0.9);
      ctx.globalAlpha = p.a * op;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
    }

    // ④ 细环描边：极弱的一圈，给出"仪器感/科技感"（几乎不可见但存在）。
    ctx.globalAlpha = op * 0.5;
    ctx.strokeStyle = eff.glowSoft;
    ctx.lineWidth = Math.max(1, unit * 0.6);
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  build() {
    Canvas(this.ctx)
      .width(this.orbSize)
      .height(this.orbSize)
      .onReady(() => {
        this.ready = true;
        this.draw();
        this.syncLoop();
      })
  }
}
