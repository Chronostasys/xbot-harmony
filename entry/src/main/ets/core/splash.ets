/**
 * splash —— 开屏（splash）**阶段模型与判据**（纯逻辑，可脱机单测）。
 *
 * 真源规格：`docs/SPLASH-SPEC.md`（阶段模型 T0–T3 + 纯函数签名/真值表 + 时长台账）。
 * 样张：`docs/mockups/splash.html`。
 *
 * 为什么要有它：冷启动的"经历时间线"此前**没有任何应用内实现** ——
 * `EntryAbility.ets:53` 只 `loadContent('pages/Index')`，冷启动那一屏完全由
 * `module.json5:18-19` 的 `startWindowIcon/startWindowBackground` **静态**给出；
 * 之后直接跳到页面首帧。本模块把"什么时候显示什么、什么时候撤、什么时候才允许光球启动"
 * 收敛成**纯函数** ⇒ 可脱机单测、可 mutation、组件只消费（不自己写 if/else）。
 *
 * ⛔ 三条纪律：
 *   1. 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译
 *      ⇒ **禁止** import ArkUI / `@ohos.*` / `@kit.*`（无 `AnimateParam`/`Curve` 等）。
 *   2. **禁颜色字面量**：色值一律经 `core/theme` 的 `paletteOf/lightPalette/darkPalette`
 *      与 `core/brand` 的 `brandAccent()`；本文件不出现 `#RRGGBB`。
 *   3. **禁自造时长**：所有时长都从 `core/motion` + `core/design` 的既有常量**派生**
 *      （下面每个常量都标了来源；零裸数字）。缺档清单见 `docs/SPLASH-SPEC.md §11`。
 *
 * ⛔ "在飞"铁律（`docs/DESIGN-SYSTEM.md §8`）：同一时刻**只允许一个在飞动效 = 光球**。
 *    开屏 T1/T2 是**一次性过渡**，不是"在飞" ⇒ 光球在 T3 才允许启动（`splashOrbAllowed`）。
 */
import { Palette, paletteOf, lightPalette, darkPalette, isLightPalette } from './theme';
import { MOTION_BASE_MS, MOTION_SLOW_MS, MOTION_FAST_MS } from './motion';
import { ORB_BREATH_MS } from './orb';
import { EASE_SPRING_CSS, EASE_OUT_CSS } from './tokens';
import { SPACE_XXL } from './design';
import { BrandSurface, brandAccent, contrastRatio, markLevelFor } from './brand';

// ════════════════════════════════════════════════════════════════════════════
// 1. 标识（字符串常量 —— 与 `core/brand.ets: MARK_LADDER_*` / `AssistantOrb: ORB_MODE_*` 同法）
// ════════════════════════════════════════════════════════════════════════════

/** T0：系统开屏（`startWindow*`，**静态**、由系统绘制 ⇒ 不在本模块的时间线取值域内）。 */
export const SPLASH_T0: string = 'T0';
/** T1：应用内开屏 —— 品牌底 + 标记**入场**（一次性）。 */
export const SPLASH_T1: string = 'T1';
/** T2：标记**让位** + 首页内容淡入（一次性）。 */
export const SPLASH_T2: string = 'T2';
/** T3：交棒首页（光球**此时才**允许接管）。 */
export const SPLASH_T3: string = 'T3';

/** 冷启动（进程新建 ⇒ 有系统开屏 ⇒ 进 T1）。 */
export const LAUNCH_COLD: string = 'cold';
/** 热启动（进程活着、ability 再拉起 ⇒ **无**系统开屏 ⇒ 不进 T1）。 */
export const LAUNCH_WARM: string = 'warm';

/** 全部阶段（声明顺序 = 时间顺序；供测试遍历）。 */
export function splashPhases(): string[] {
  return [SPLASH_T0, SPLASH_T1, SPLASH_T2, SPLASH_T3];
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 时间常量 —— **全部由底座派生，零裸数字**（缺档见 `docs/SPLASH-SPEC.md §11`）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ 交付说明：`SPLASH_MIN_DWELL_MS` / `SPLASH_TIMEOUT_MS` / `SPLASH_MARK_BOX_VP` 三个是
//    **缺档**（底座没有同名常量）。此处以"底座常量的**派生表达式**"落地（无裸数字），
//    使本模块今日即可编译与单测；同时已把"提升到底座"的清单交调度者转 `orb-ux`
//    （`core/motion.ets` 现归其所有，本波**不改**）。

/** T1 时长 = `MOTION_BASE_MS`（220ms，`core/motion.ets:36`）⇒ `animBase()`。 */
export const SPLASH_ENTER_MS: number = MOTION_BASE_MS;
/** T2 时长 = `MOTION_SLOW_MS`（320ms，`core/motion.ets:43`）⇒ `animSlow()`。 */
export const SPLASH_EXIT_MS: number = MOTION_SLOW_MS;
/** T1+T2 总时长（默认档）= 540ms。 */
export const SPLASH_TOTAL_MS: number = SPLASH_ENTER_MS + SPLASH_EXIT_MS;
/**
 * **最短停留**（品牌不许"一闪而过"）= `MOTION_BASE_MS + MOTION_FAST_MS` = 220+180 = 400ms。
 * 缺档①：底座无此常量（建议 `orb-ux` 提升为 `MOTION_MIN_DWELL_MS`）。
 */
export const SPLASH_MIN_DWELL_MS: number = MOTION_BASE_MS + MOTION_FAST_MS;
/**
 * **超时兜底**（宁可显示首帧，也不无限停在开屏）= `MOTION_BREATH_MS` = 2560ms。
 * 缺档②：底座无此常量（建议提升为 `MOTION_SPLASH_TIMEOUT_MS`）。
 * 取值来源：`ORB_BREATH_MS`（`core/orb.ets:26` = `D_SLOW*8`）—— 与 `components/anim.ets:96`
 * 的 `MOTION_BREATH_MS` **同值**（UI 侧那个是 core 侧的转发；core 模块引 core 侧真源）。
 */
export const SPLASH_TIMEOUT_MS: number = ORB_BREATH_MS;

// ── 标记动效（**同语义、按元素变体**：标记 vs 光球各自具名，**不强行统一**）─────────
/**
 * 开屏**标记**的入场起始缩放 = `0.92`（设计输入 `docs/REDESIGN-INPUT-BRAND.md:145`）。
 * ⚠️ 与光球专属的 `ORB_ENTER_SCALE = 0.86`（`components/AssistantOrb.ets:94`）是**两个**具名常量：
 *    裁决（本波）= **不强行统一**（强行合并会把"开屏标记"与"光球"的动效参数人为耦合）。
 *    缺档③：底座暂无 `MOTION_ENTER_SCALE`（建议 `orb-ux` 提升并保留两值）。
 */
export const SPLASH_MARK_ENTER_SCALE: number = 0.92;
/** 标记入场起始不透明度。 */
export const SPLASH_MARK_ENTER_OPACITY: number = 0;
/** 标记静止位不透明度（入场终点 / reduceMotion 下的即时值）。 */
export const SPLASH_MARK_SETTLED_OPACITY: number = 1;
/** 标记静止位缩放（入场终点）。 */
export const SPLASH_MARK_SETTLED_SCALE: number = 1;

// ── 标记展示尺寸 ─────────────────────────────────────────────────────────────
/** 标记盒相对 `space.xxl` 的倍数（**布局档**，非动效时长）。 */
export const SPLASH_MARK_BOX_MULT: number = 5;
/**
 * 标记展示盒边长（vp）= `5 × space.xxl(32)` = **160vp**。
 * 缺档⑥：`spaceRoles()` 只到 `xxl=32`，无"开屏标记盒"档（建议提升为底座尺寸档）。
 */
export const SPLASH_MARK_BOX_VP: number = SPACE_XXL * SPLASH_MARK_BOX_MULT;

/** 判定标记档位时用的**参考边长**（vp）—— 开屏标记远大于 `MARK_MIN_GLYPH_VP`(24) ⇒ 不会退 wordmark。 */
export const SPLASH_MARK_REF_VP: number = SPLASH_MARK_BOX_VP;

// ════════════════════════════════════════════════════════════════════════════
// 2b. 每阶段用**哪条曲线** —— 入场允许超调；**让位/退出不许超调**（设计系统级约定）
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么必须区分（真实观感缺陷，不是洁癖）：
//   底座唯一的曲线是 **spring**（`cubic-bezier(0.34,1.56,0.64,1)`，**带超调**）。
//   超调用在**入场**（T1 标记进场）是对的 —— 有生气；
//   用在**让位/移交首页**（T2）却是错的 —— 元素冲过头再退回来，看着像"抖了一下"。
//   ⇒ **约定**：`enter`（进入视野）可用超调；`exit`（离开/移交）一律**无超调缓出**。
//   本约定把"用哪条曲线"变成**可测数据**（下方纯函数），mutation 可自证（把 T2 改回 spring ⇒ 必红）。
//
// ⚠️ 让位曲线的底座 token 已存在（`EASE_OUT_CSS`，`core/tokens.ets:56`，此前"已定义无消费者"）；
//    `orb-ux` 正在把它收成具名工厂 `animEaseOut()`（`components/anim.ets`，**本波不改该文件**）。
//    ⇒ T2 曲线 **TODO：待 `animEaseOut()` 就绪**（本模块的判据已先行钉死，工厂就绪后组件直接换）。

/** 曲线标识：**带超调**的 spring（= `animBase()` / `animSlow()`）。 */
export const SPLASH_CURVE_SPRING: string = 'spring';
/** 曲线标识：**无超调缓出**（= `EASE_OUT_CSS` / 待就绪的 `animEaseOut()`）。 */
export const SPLASH_CURVE_EASE_OUT: string = 'easeOut';
/** 无需本组件驱动的阶段（T0 由系统画；T3 = 已交棒）。 */
export const SPLASH_CURVE_NONE: string = '';

/**
 * 阶段 → 曲线（**唯一映射**）。
 * T1（入场）⇒ spring（**允许超调**）；T2（让位）⇒ ease-out（**不许超调**）；T0/T3 ⇒ 无。
 */
export function splashPhaseCurve(phase: string): string {
  if (phase === SPLASH_T1) {
    return SPLASH_CURVE_SPRING;
  }
  if (phase === SPLASH_T2) {
    return SPLASH_CURVE_EASE_OUT;
  }
  return SPLASH_CURVE_NONE;
}

/** 曲线标识 → 底座 CSS token（`core/tokens.ets:54/56`；`''` ⇒ 无曲线）。 */
export function curveCssOf(curve: string): string {
  if (curve === SPLASH_CURVE_SPRING) {
    return EASE_SPRING_CSS;
  }
  if (curve === SPLASH_CURVE_EASE_OUT) {
    return EASE_OUT_CSS;
  }
  return '';
}

/**
 * 曲线 CSS 是否**允许超调**（解析 `cubic-bezier(x1,y1,x2,y2)` 的两个 **y** 控制点；
 * 任一 `y > 1` ⇒ 会冲过终点 ⇒ 有超调）。非 `cubic-bezier` 形式按"无超调"处理（保守）。
 */
export function curveHasOvershoot(css: string): boolean {
  const i: number = css.indexOf('cubic-bezier(');
  if (i < 0) {
    return false;
  }
  const close: number = css.indexOf(')', i);
  const inner: string = css.substring(i + 'cubic-bezier('.length, close < 0 ? css.length : close);
  const parts: string[] = inner.split(',');
  if (parts.length !== 4) {
    return false;
  }
  const y1: number = Number.parseFloat(parts[1]);
  const y2: number = Number.parseFloat(parts[3]);
  if (Number.isNaN(y1) || Number.isNaN(y2)) {
    return false;
  }
  return y1 > 1 || y2 > 1;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 判据（纯函数 —— 真值表见 `docs/SPLASH-SPEC.md §4`）
// ════════════════════════════════════════════════════════════════════════════

/** 毫秒入参净化：`NaN` / 负值 ⇒ `0`（防御，**不抛**）。 */
function sanitizeMs(v: number): number {
  if (!(v > 0)) {
    return 0;
  }
  return v;
}

/**
 * ① 阶段推进：`elapsedMs` 自**应用内开屏挂载**起算（`0` ⇒ T1 起点；T0 不在取值域）。
 *
 * 默认档（`reduceMotion=false`，`[` 左闭右开）：
 *   `[0, 220)` ⇒ T1 ｜ `[220, 540)` ⇒ T2 ｜ `[540, ∞)` ⇒ T3
 * `reduceMotion=true`（**只降动效、不降可达性**）：T2 收起为 0 ⇒
 *   `[0, 400)` ⇒ T1（**静态**）｜ `[400, ∞)` ⇒ T3
 * `userDismissed=true`（用户中途点/滑）⇒ **立即 T3**（跳表；只允许一次，不回退）。
 */
export function splashPhaseAt(elapsedMs: number, reduceMotion: boolean, userDismissed: boolean = false): string {
  if (userDismissed) {
    return SPLASH_T3;
  }
  const t: number = sanitizeMs(elapsedMs);
  if (reduceMotion) {
    return t >= SPLASH_MIN_DWELL_MS ? SPLASH_T3 : SPLASH_T1;
  }
  if (t >= SPLASH_TOTAL_MS) {
    return SPLASH_T3;
  }
  if (t >= SPLASH_ENTER_MS) {
    return SPLASH_T2;
  }
  return SPLASH_T1;
}

/** 阶段起点的绝对毫秒（供页面定时器 / 测试；`reduceMotion` 下 T2 收起、T3 提前）。 */
export function splashPhaseStartMs(phase: string, reduceMotion: boolean): number {
  if (phase === SPLASH_T1) {
    return 0;
  }
  if (phase === SPLASH_T2) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_ENTER_MS;
  }
  if (phase === SPLASH_T3) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_TOTAL_MS;
  }
  return 0;
}

/** 该阶段时长（默认档；`reduceMotion` 下 T2 = 0 ⇒ 跳切）。 */
export function splashPhaseDurationMs(phase: string, reduceMotion: boolean): number {
  if (phase === SPLASH_T1) {
    return reduceMotion ? SPLASH_MIN_DWELL_MS : SPLASH_ENTER_MS;
  }
  if (phase === SPLASH_T2) {
    return reduceMotion ? 0 : SPLASH_EXIT_MS;
  }
  return 0;
}

/**
 * ② 开屏 overlay 是否仍应可见。
 *
 * 判据：`launchKind == cold` **且**（`t < minDwell` **或** 内容未就绪）**且** `t < timeout`；
 * `userDismissed=true` ⇒ **false**（用户不想等）。
 */
export function shouldShowSplash(launchKind: string, elapsedMs: number, contentReady: boolean,
  userDismissed: boolean = false): boolean {
  if (launchKind !== LAUNCH_COLD) {
    return false;
  }
  if (userDismissed) {
    return false;
  }
  const t: number = sanitizeMs(elapsedMs);
  if (t >= SPLASH_TIMEOUT_MS) {
    return false;
  }
  if (t < SPLASH_MIN_DWELL_MS) {
    return true;
  }
  return !contentReady;
}

/**
 * ③ T1 底色（纯函数，**不读全局**）。
 *
 * `followApplication=true` ⇒ 取**应用主题**的 `appBg`（与首帧画布**逐字节一致** ⇒ **零跳色**；
 * 需 `docs/BRAND.md §12.1` 的 `FOLLOW_APPLICATION` 配置补丁，**待用户拍板**）。
 * `false` ⇒ 取**基准画布**（跟**系统**深浅 —— 即当前 `color.json` base/dark 两个值）。
 */
export function splashCanvasOf(theme: string, followApplication: boolean, systemDark: boolean): string {
  if (followApplication) {
    return paletteOf(theme).appBg;
  }
  return systemDark ? darkPalette().appBg : lightPalette().appBg;
}

/**
 * ④ T1 标记档位（**委托** `core/brand.ets:markLevelFor`，不另立判据）。
 *
 * 深浅判据用 `isLightPalette(paletteOf(theme))`（按 `appBg` 感知亮度，⛔ **不按主题名硬判**）；
 * 对比度用 `core/brand.ets:contrastRatio(brandAccent(), 承载面)`。
 * ⇒ porcelain（浅色面）= `solid`（实心品牌色 glyph on 中性白，**零发光**）。
 */
export function splashMarkLevelOf(theme: string, sizeVp: number, monochrome: boolean): string {
  const p: Palette = paletteOf(theme);
  const surface: string = p.appBg;
  const s: BrandSurface = new BrandSurface(!isLightPalette(p), monochrome, sizeVp,
    contrastRatio(brandAccent(), surface));
  return markLevelFor(s);
}

/**
 * ⑤ **「光球可启动」判据** —— 本仓铁律"同一时刻只允许一个在飞动效 = 光球"的**机器判据**。
 *
 * 开屏 T1/T2 是**一次性过渡**（不是"在飞"）⇒ 光球**不得**启动；
 * 只有进 **T3** 且首个会话在流式，才允许。⛔ 组件不得自行放宽这条判据。
 */
export function splashOrbAllowed(phase: string, streaming: boolean): boolean {
  return phase === SPLASH_T3 && streaming;
}

/** 开屏任一阶段是否**属于**"在飞"（**恒 false** —— 把铁律写成可断言的形式）。 */
export function splashPhaseIsInFlight(phase: string): boolean {
  return false;
}
