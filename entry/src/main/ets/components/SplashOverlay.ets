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
 *   3. **颜色零字面量**：唯一入口 `colorOf(p, role)`；底色走 `core/splash.splashCanvasOf`；
 *      标记色走 `core/brand.brandAccent()/brandOnAccent()`（**不走** `colorOf`）；
 *      深浅判据在 `core/splash.splashMarkLevelOf` 内（`isLightPalette`，⛔ 不按主题名硬判）。
 *   4. **在飞唯一性**：本组件**不启动光球**（T1/T2 是一次性过渡，不是"在飞"）——
 *      光球只可能在 T3 由页面/LiveTail 启动；判据 = `core/splash.splashOrbAllowed`（本组件不消费它，
 *      因为它恒为 false 直到 T3，而那时本组件已被 `onDone` 移除）。
 *
 * ⚠️ 新建组件的**孤儿风险**：ArkTS **不检查没有消费者的组件文件**（`docs/ARKTS-GOTCHAS.md` 批次13）
 *    ⇒ 本组件必须在 `pages/Index.ets` 接线后才真正进编译图（接线补丁见交付说明，归 `sidebar-ux`）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  HIT_TARGET_MIN, RADIUS_CHIP, SPACE_HAIR, SPACE_SM, SPACE_XL, colorOf, typeOf,
} from '../core/design';
import { MARK_LADDER_OUTLINE, MARK_LADDER_WORDMARK } from '../core/brand';
import {
  SPLASH_MARK_BOX_VP,
  SPLASH_MARK_ENTER_OPACITY,
  SPLASH_MARK_ENTER_SCALE,
  SPLASH_MARK_SETTLED_OPACITY,
  SPLASH_MARK_SETTLED_SCALE,
  SPLASH_T1,
  SPLASH_T2,
  SPLASH_T3,
  splashCanvasOf,
  splashMarkLevelOf,
} from '../core/splash';
import { animBase, animEaseOut } from './anim';

@Component
export struct SplashOverlay {
  /** 当前阶段（由页面按 `core/splash.splashPhaseAt` 推进后投递）。 */
  @Prop @Watch('onPhaseChange') phase: string = SPLASH_T1;
  /** 应用主题名（决定底色与标记档位）。 */
  @Prop theme: string = 'dark';
  /** 无障碍降级：**只降动效、不降可达性**（标记静态可见，停留到 minDwell）。 */
  @Prop reduceMotion: boolean = false;
  /**
   * T1 底色是否跟**应用**主题（`docs/BRAND.md §12.1` 的 `FOLLOW_APPLICATION`；**待用户拍板**）。
   * 默认 `false` = 跟**系统**（现状）—— 此时 T1 底色 = 系统开屏底色 ⇒ **零跳色**（方案 B）。
   */
  @Prop canvasFollowApp: boolean = false;
  /** 系统是否深色（仅 `canvasFollowApp=false` 时用于选基准画布）。 */
  @Prop systemDark: boolean = true;
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

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** T1 底色（唯一判据在 core/splash；本组件不自己挑色）。 */
  private canvasColor(): string {
    return splashCanvasOf(this.theme, this.canvasFollowApp, this.systemDark);
  }

  /** 标记档位（唯一判据在 core/brand.markLevelFor，经 core/splash 委托）。 */
  private level(): string {
    return splashMarkLevelOf(this.theme, SPLASH_MARK_BOX_VP, false);
  }

  aboutToAppear(): void {
    if (this.reduceMotion) {
      // ⛔ 只降动效、不降可达性：标记**立即**到静止位（静态一帧）——不许退化成空白。
      this.markOpacity = SPLASH_MARK_SETTLED_OPACITY;
      this.markScale = SPLASH_MARK_SETTLED_SCALE;
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
      animateTo(animEaseOut(), () => {
        this.overlayOpacity = 0;
        this.markOpacity = 0;
      });
    }
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // ── 品牌底：`canvasColor()` 由 core/splash.splashCanvasOf 判出 ──────────────
      //    T0（系统开屏）→ T1 底色**同色** ⇒ 冷启动**零跳色**（方案 B；方案 A 见 §12.1）。
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.canvasColor())

      // ── 标记（T1 入场）—— ⛔ 内联，不抽 @Builder（见文件头纪律 1）──────────────
      if (this.level() === MARK_LADDER_WORDMARK) {
        Text('xbot')
          .fontSize(typeOf('type.display').size)
          .fontWeight(typeOf('type.display').weight)
          .letterSpacing(typeOf('type.display').tracking)
          .fontColor(colorOf(this.pal(), 'textPrimary'))
          .opacity(this.markOpacity)
          .scale({ x: this.markScale, y: this.markScale })
      } else if (this.level() === MARK_LADDER_OUTLINE) {
        Image($r('app.media.brand_mark_outline'))
          .width(SPLASH_MARK_BOX_VP)
          .height(SPLASH_MARK_BOX_VP)
          .objectFit(ImageFit.Contain)
          .opacity(this.markOpacity)
          .scale({ x: this.markScale, y: this.markScale })
      } else {
        // `full` / `solid`：同一枚**自带颜色**的开屏标记（紫气泡 + 反色星芒，透明底）
        // —— 见 `docs/BRAND.md §4.1`（深浅底上都可读，故**不**做两版）。
        Image($r('app.media.start_icon'))
          .width(SPLASH_MARK_BOX_VP)
          .height(SPLASH_MARK_BOX_VP)
          .objectFit(ImageFit.Contain)
          .opacity(this.markOpacity)
          .scale({ x: this.markScale, y: this.markScale })
      }

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
        animateTo(animBase(), () => {
          this.markOpacity = SPLASH_MARK_SETTLED_OPACITY;
          this.markScale = SPLASH_MARK_SETTLED_SCALE;
        });
      }
    })
  }
}
