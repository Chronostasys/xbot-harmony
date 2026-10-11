/**
 * SplashOverlay —— **应用内开屏**（T1 标记入场 / T2 让位）。
 *
 * 位置：冷启动时**叠在页面之上**（由 `pages/Index.ets` 的根部 `Stack` 注入）。
 * 真源规格：`docs/SPLASH-SPEC.md`（阶段模型）；样张：`docs/mockups/splash.html`。
 * 判据**全部**来自 `core/splash.ets`（纯逻辑、已单测）—— 本组件**只画**，不自己写阶段 if。
 *
 * ⛔ 四条硬纪律（每条都有代价可查）：
 *   1. **真 `@Component` + `@Prop` / `@State`**，标记**直接内联在 `build()` 里**（不抽带参 `@Builder`）——
 *      `docs/ARKTS-GOTCHAS.md` 头号坑：带参 `@Builder` 的参数是"调用那一刻的快照"，子树不随参数重建
 *      ⇒ 会卡在首帧（品牌标记不出现 / 不动）。
 *   2. **动效只走底座** `components/anim.ets`（T1 = `animBase`、T2 = `animEaseOut` 具名工厂）⇒
 *      ⛔ 无字面量时长、⛔ 无 `Curve.Friction`。
 *      **曲线语义**（`core/splash.splashPhaseCurve` 是唯一判据）：**入场（T1）允许超调**（spring），
 *      **让位/退出（T2）不许超调**（`animEaseOut()` = `EASE_OUT_CSS`，`components/anim.ets:103`，
 *      已就绪）。`@ohos/curves` 只许在 `components/anim.ets` import，组件侧**不能自造曲线**。
 *   3. **颜色零字面量**：唯一入口 `colorOf(p, role)`；底色走 `core/splash.splashBrandCanvas()`
 *      （**恒定品牌深色**，= T0 系统开屏色）；标记**恒 `full`** —— 一枚预生成的品牌紫 PNG
 *      （`$r('app.media.start_icon')`，由 `tools/brand/emit.js` 用 `brandAccent()` 生成，**不走** `colorOf`）；
 *      判据 = `core/splash.splashBrandMarkLevel()`（**恒 full**，纯函数/可脱机单测）。
 *   3b. **T1 画布与标记恒**不随 `theme`**变化**（真机缺陷修复 2026-10-11，方案 (a)「品牌开屏恒深」）：
 *      本组件**不接 `theme`** —— 这是"画布不在展示期间翻色"的**结构性保证**（⛔ 不是靠调用方自觉）。
 *      画布 = `splashBrandCanvas()`（= T0 色 ⇒ T0→T1 **零跳色**）；品牌标记 = 品牌资产、恒紫
 *      （`docs/DESIGN-SYSTEM.md §13.6`，⛔ 不做浅色变体）；T1→T3 由 T2 **淡出**过渡到应用主题
 *      （是**渐隐**，不是硬切）。
 *   4. **在飞唯一性**：本组件**不启动光球**（T1/T2 是一次性过渡，不是"在飞"）——
 *      光球只可能在 T3 由页面/LiveTail 启动；判据 = `core/splash.splashOrbAllowed`（本组件不消费它，
 *      因为它恒为 false 直到 T3，而那时本组件已被 `onDone` 移除）。
 *
 * ⚠️ 新建组件的**孤儿风险**：ArkTS **不检查没有消费者的组件文件**（`docs/ARKTS-GOTCHAS.md` 批次13）
 *    ⇒ 本组件必须在 `pages/Index.ets` 接线后才真正进编译图（接线补丁见交付说明，归 `sidebar-ux`）。
 */
import { Palette, darkPalette } from '../core/theme';
import {
  HIT_TARGET_MIN, RADIUS_CHIP, SPACE_HAIR, SPACE_SM, SPACE_XL, colorOf, typeOf,
} from '../core/design';
import {
  SPLASH_HINT_DELAY_MS,
  SPLASH_HINT_ENTER_OPACITY,
  SPLASH_MARK_BOX_VP,
  SPLASH_MARK_ENTER_OPACITY,
  SPLASH_MARK_ENTER_SCALE,
  SPLASH_MARK_EXIT_LIFT_VP,
  SPLASH_MARK_SETTLED_OPACITY,
  SPLASH_MARK_SETTLED_SCALE,
  SPLASH_T1,
  SPLASH_T2,
  SPLASH_T3,
  splashBrandCanvas,
} from '../core/splash';
import { animBase, animEaseOut } from './anim';

/**
 * 给底座工厂返回的 `AnimateParam` 补一个 `delay`（`AnimateParam.delay`，`common.d.ts`）。
 *
 * ⛔ 曲线**仍由底座工厂给**（本函数**不构造任何 curve**，只补一个延迟字段）：
 *    `components/anim.ets` 不在本波文件边界，故不加"带 delay 的工厂变体"。
 *    用途：跳过提示**延迟淡入**（先把纯品牌给足，提示再淡入）。
 */
function withDelay(p: AnimateParam, delayMs: number): AnimateParam {
  p.delay = delayMs;
  return p;
}

@Component
export struct SplashOverlay {
  /**
   * 当前阶段（由页面按 `core/splash.splashPhaseAt` 推进后投递）。
   * ⛔ 本组件**不接 `theme`**（见文件头纪律 3b）：画布/标记恒不随应用主题变化。
   */
  @Prop @Watch('onPhaseChange') phase: string = SPLASH_T1;
  /** 无障碍降级：**只降动效、不降可达性**（标记静态可见，停留到 minDwell）。 */
  @Prop reduceMotion: boolean = false;
  /** 开屏结束（页面据此置 `showSplash=false` 把它移除）。 */
  onDone: () => void = () => {
  };
  /** 用户中途轻点（页面据此立即跳 T3，见 `core/splash.splashPhaseAt` 的 `userDismissed`）。 */
  onSkip: () => void = () => {
  };

  /** 整层不透明度（T2 让位 ⇒ `animSlow` 工厂淡出，揭示首页首帧）。 */
  @State private overlayOpacity: number = 1;
  /** 标记不透明度（T1 入场：0→1，**一次**）。 */
  @State private markOpacity: number = SPLASH_MARK_ENTER_OPACITY;
  /** 标记缩放（T1 入场：0.92→1，**一次**）。 */
  @State private markScale: number = SPLASH_MARK_ENTER_SCALE;
  /** 标记**让位上移量**（T2：0 → `SPLASH_MARK_EXIT_LIFT_VP`，屏幕向上为负）。 */
  @State private markLift: number = 0;
  /**
   * 跳过提示不透明度（**延迟**淡入：先给纯品牌，`SPLASH_HINT_DELAY_MS` 后才淡入）。
   * ⛔ 原来它从首帧就满不透明 ⇒ 第一眼是"轻点跳过"、品牌反而后到（顺序反 + 廉价）。
   */
  @State private hintOpacity: number = SPLASH_HINT_ENTER_OPACITY;

  /** 开屏承载面色板（**恒定深色** —— 与 `canvasColor()` 同面；⛔ 不读 `theme`）。 */
  private pal(): Palette {
    return darkPalette();
  }

  /** T1 底色（唯一判据在 core/splash；⛔ 不读 `theme`；= T0 系统开屏色 ⇒ T0→T1 零跳色）。 */
  private canvasColor(): string {
    return splashBrandCanvas();
  }

  // ⛔ 不再有 `level()`：档位**恒 `full`**（`core/splash.splashBrandMarkLevel()`，纯判据/可单测）
  //    ⇒ 组件侧没有"挑档"这件事（原先 `WORDMARK`/`OUTLINE` 两分支永不可达，已删死码）。

  aboutToAppear(): void {
    if (this.reduceMotion) {
      // ⛔ 只降动效、不降可达性：标记**立即**到静止位（静态一帧）——不许退化成空白。
      this.markOpacity = SPLASH_MARK_SETTLED_OPACITY;
      this.markScale = SPLASH_MARK_SETTLED_SCALE;
      // 提示也**立即**可见（延迟淡入属于"动效"，降级时去掉；但"可跳过"这条线索必须还在）。
      this.hintOpacity = SPLASH_MARK_SETTLED_OPACITY;
    }
  }

  /**
   * 阶段变化（唯一消费 `core/splash` 的判据）。
   * T2 ⇒ `animEaseOut` 工厂（`MOTION_SLOW_MS` + `EASE_OUT_CSS`，**无超调**）淡出让位；
   * T3 ⇒ `onDone()` 交棒（reduceMotion 下无 T2 ⇒ **跳切**，无淡出）。
   */
  private onPhaseChange(): void {
    const ph: string = this.phase;
    if (ph === SPLASH_T3) {
      if (this.reduceMotion) {
        this.overlayOpacity = 0;
      }
      this.onDone();
      return;
    }
    if (ph === SPLASH_T2) {
      if (this.reduceMotion) {
        this.overlayOpacity = 0;
        return;
      }
      // 让位**不许超调**（`core/splash.splashPhaseCurve(T2) === easeOut`）：走底座具名工厂
      // `animEaseOut()`（`components/anim.ets:103` = `MOTION_SLOW_MS` + `EASE_OUT_CSS`），**零超调**。
      // ⛔ 不得在此自造曲线 / import `@ohos/curves`（唯一出口是 components/anim.ets）。
      // 让位 = 淡出 **+ 轻微上移**（`docs/SPLASH-SPEC.md:38` 的"可 + 轻微上移"；纯数值在 core/splash）。
      animateTo(animEaseOut(), () => {
        this.overlayOpacity = 0;
        this.markOpacity = 0;
        this.markLift = SPLASH_MARK_EXIT_LIFT_VP;
      });
    }
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // ── 品牌底：`canvasColor()` 由 core/splash.splashBrandCanvas 判出 ─────────────
      //    **恒定** = T0（系统开屏）色 ⇒ T0→T1 **零跳色**（方案 (a)「品牌开屏恒深」；§12.1）。
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.canvasColor())

      // ── 标记（T1 入场）—— ⛔ 内联，不抽 @Builder（见文件头纪律 1）──────────────
      //    档位**恒 `full`**（`core/splash.splashBrandMarkLevel()`）：一枚**自带颜色**的开屏标记
      //    （品牌紫气泡 + 反色星芒，透明底）—— 见 `docs/BRAND.md §4.1`（深浅底上都可读，故**不**做两版）。
      //    ⚠️ 2026-10-11 删死码：原先的 `WORDMARK`（`size < 24`）/ `OUTLINE`（`monochrome`）两条分支
      //    在本组件**永不可达**（恒传 `monochrome=false`、`size = 160 ≫ 24`）⇒ 连同其资产引用一并删除。
      //    ⛔ `brand_mark_outline.svg` 的唯一消费者 = 通知小图标（`workreconcile/icons.ets`）——**不是**死资产。
      Image($r('app.media.start_icon'))
        .width(SPLASH_MARK_BOX_VP)
        .height(SPLASH_MARK_BOX_VP)
        .objectFit(ImageFit.Contain)
        .opacity(this.markOpacity)
        .scale({ x: this.markScale, y: this.markScale })
        .translate({ y: -this.markLift })

      // ── 跳过提示（视觉小 12–32vp；热区 ≥44 靠 `responseRegion` 外扩 ⇒ ⛔ 不改布局尺寸）──
      Column() {
        Text('轻点跳过')
          .fontSize(typeOf('type.caption').size)
          .fontWeight(typeOf('type.caption').weight)
          .letterSpacing(typeOf('type.caption').tracking)
          .fontColor(colorOf(this.pal(), 'textMuted'))
          .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_HAIR, bottom: SPACE_HAIR })
          .borderRadius(RADIUS_CHIP)
          .responseRegion({
            x: -SPACE_SM,
            y: -SPACE_HAIR,
            width: '100%',
            height: HIT_TARGET_MIN,
          })
          .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.onSkip();
          })
      }
      .width('100%')
      .height('100%')
      .padding({ bottom: SPACE_XL })
      .justifyContent(FlexAlign.End)
      .alignItems(HorizontalAlign.Center)
      .hitTestBehavior(HitTestMode.Transparent)
      // 提示的"登场"：延迟淡入（见 `hintOpacity` 与 onAppear）——⛔ 覆盖在**整栏**上，
      // 不用 `.opacity` 压内层 Text（那会和它的 `stateStyles` 按压不透明度打架）。
      .opacity(this.hintOpacity)
    }
    .width('100%')
    .height('100%')
    .opacity(this.overlayOpacity)
    // 任意处轻点 ⇒ 跳过（`docs/SPLASH-SPEC.md §4.2`：一次跳表到 T3，不回退）。
    .onClick(() => {
      this.onSkip();
    })
    // T1 入场：**一次**（`animBase` 工厂 220ms + 全站 spring；⛔ 无字面量时长）。
    .onAppear(() => {
      if (!this.reduceMotion) {
        // ① 标记入场：**一次**（`animBase` 工厂 220ms + 全站 spring；⛔ 无字面量时长）。
        animateTo(animBase(), () => {
          this.markOpacity = SPLASH_MARK_SETTLED_OPACITY;
          this.markScale = SPLASH_MARK_SETTLED_SCALE;
        });
        // ② 跳过提示**随后**淡入：先把纯品牌给足 `SPLASH_HINT_DELAY_MS`，提示再淡入
        //    （⛔ 否则第①帧是"轻点跳过"、品牌反而后到 → 顺序反 + 廉价）。
        //    延迟走 `AnimateParam.delay`（`common.d.ts` 的 AnimateParam 字段）——**曲线仍来自
        //    底座工厂**（`animEaseOut`，无超调）；本仓无 delay 先例，故此处显式注释来源。
        animateTo(withDelay(animEaseOut(), SPLASH_HINT_DELAY_MS), () => {
          this.hintOpacity = SPLASH_MARK_SETTLED_OPACITY;
        });
      }
    })
  }
}
