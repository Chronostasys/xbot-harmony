/**
 * brand —— 品牌标记（logo / 开屏标记）的**唯一真源**（纯逻辑，可脱机单测）。
 *
 * 为什么要有它：此前 `app_icon.svg`（AppScope + entry 两份）与 `start_icon.png` 是**各自手写/手跟**的，
 * SVG 源只存在于 `docs/BRAND.md` 的代码块里，`start_icon.png` 是**手改的二进制** ⇒ 改一处忘另一处、
 * 且无法追溯/复现（违反本仓「不要手改二进制」纪律）。本模块把**几何 + 配色 + SVG 生成**收敛到一处：
 *   · `tools/brand/gen.sh` 从这里**生成**资源（可重复 ⇒ 同样输入必得同样产物）；
 *   · `tools/tests/brand.test.ts` 断言几何/配色/安全区（改坏即红）。
 *
 * ⛔ 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*` / `@kit.*`。
 * ⛔ 颜色**只从设计系统 token 取**（`darkPalette().accent` / `.onAccent`），**禁止字面量**
 *    （`docs/BRAND.md §3` 的纪律；测试会断言"无六位十六进制字面量"）。
 *
 * 坐标系：一切几何以 **1024×1024 画布**表达（比例驱动，非像素驱动）；任何尺寸都从它等比缩放
 * （`docs/BRAND.md §2`）。改样式只改这里的常量，别去改生成的资源。
 */
import { Palette, darkPalette, isLightPalette } from './theme';

// ── 尺寸常量 ──────────────────────────────────────────────────────────────────

/** 几何坐标系边长（一切 path 坐标都在此画布内）。 */
export const BRAND_CANVAS: number = 1024;
/** 启动器图标（`app_icon`）源尺寸 —— 满幅方块，圆角由系统桌面遮罩施加。 */
export const APP_ICON_PX: number = 1024;
/** 开屏标记（`startWindowIcon`）位图尺寸 —— 系统开屏窗口居中绘制的常数倍。 */
export const START_ICON_PX: number = 512;

/** 圆形遮罩下图标可见半径（= 画布内切圆半径）。 */
export const ICON_INSCRIBED_RADIUS: number = BRAND_CANVAS / 2;
/**
 * 分层图标（adaptive / layered icon）的**前景安全区半径**。
 *
 * 取值依据：业界自适应图标契约 —— 108dp 总尺寸里，**保证可见的前景安全区是 66dp 圆**
 * ⇒ 半径占比 `33/108 = 30.56%` ⇒ `0.3056 × 1024 ≈ 313`。（HarmonyOS 分层图标的落地形式
 * 本仓尚未核实，见 `docs/BRAND.md §9`；此常量用作**保守检算**，当前图标是**单层**、
 * 不依赖它，但几何一旦越界就说明"将来做分层会被裁"。）
 */
export const LAYERED_SAFE_RADIUS: number = 313;

// ── 配色（全部取 token；无字面量）──────────────────────────────────────────────

/** 品牌主色 —— 与 `darkPalette().accent` **逐字一致**（品牌色不随主题变）。 */
export function brandAccent(): string {
  return darkPalette().accent;
}

/** 标记反色 —— 与 `darkPalette().onAccent` **逐字一致**。 */
export function brandOnAccent(): string {
  return darkPalette().onAccent;
}

/**
 * 按**色板**取品牌标记色（开屏 / 标记的**主题感知**入口；2026-10-11 ①）。
 *
 * 为什么需要它：`brandAccent()`（= `darkPalette().accent` = `#7C5CFF`）对**纯白底**实测仅 **4.35**，
 * 低于 WCAG AA 文本线 4.5（`docs/mockups/splash.html` 的实调）—— 而白主题下开屏/标记正是
 * 用户"第一眼"看到的东西。⛔ 深色品牌主色 `#7C5CFF` **不动**（不牵连图标 / 深色 / web 对齐）。
 * ⇒ 浅色面（`isLightPalette`）改用**该主题自己的** `accent`：porcelain = Apple Blue **`#0071E3`**
 * （对白 **4.70** 达标，且与白主题界面同色系）、light = `#6D28D9`（对白 7.10）。
 *
 * 判据按 `isLightPalette`（色板 `appBg` 亮度），⛔ **不按主题名硬判**。
 * 消费方：`core/splash.splashMarkLevelOf` 的标记色 / 开屏实现 / 样张（本入口是唯一出口）。
 *
 * ── 给 `brand-impl` 的**一行切法**（`core/splash.ets` 的 `splashMarkLevelOf`，本波不改该文件）──
 * 函数签名 `brandAccentFor(p: Palette): string`；该函数内已有 `const p: Palette = paletteOf(theme);`
 * ⇒ 只需把 `contrastRatio(brandAccent(), surface)` 改成：
 *   `contrastRatio(brandAccentFor(p), surface)`          // 标记色（同时把 BrandSurface 的对比度按它算）
 * 若标记**渲染**也要主题化（当前是静态 PNG `$r('app.media.start_icon')`，由 `tools/brand/emit.js`
 * 用 `brandAccent()` 预生成）⇒ 需为浅色面单独生成一份资源（`splashMarkSvg(brandAccentFor(p), …)`），
 * 这一层属 `brand-impl` 的资源决策（本入口只保证"取色"唯一、可判）。
 */
export function brandAccentFor(p: Palette): string {
  return isLightPalette(p) ? p.accent : brandAccent();
}

/** 按色板取标记**反色**（星芒）—— 与 `brandAccentFor` **成对**（浅色面用该主题的 `onAccent`）。 */
export function brandOnAccentFor(p: Palette): string {
  return isLightPalette(p) ? p.onAccent : brandOnAccent();
}

// ── 几何常量（1024 画布）──────────────────────────────────────────────────────

/** 气泡主体外框（圆角方）。 */
export const BUBBLE_X0: number = 224;
export const BUBBLE_Y0: number = 232;
export const BUBBLE_X1: number = 800;
export const BUBBLE_Y1: number = 700;
/** 气泡圆角半径（≈ 气泡高 468 的 31.6%，squircle 观感）。 */
export const BUBBLE_R: number = 148;

/** 尾巴：底边内侧起点 x。 */
export const TAIL_BASE_X: number = 476;
/** 尾巴尖点。 */
export const TAIL_TIP_X: number = 300;
export const TAIL_TIP_Y: number = 844;
/** 尾巴尖的倒圆半径（锐角 → 柔性收尾；0 = 保持原锐角）。 */
export const TAIL_TIP_ROUND: number = 28;

/** 星芒（四角星）中心 —— 与气泡主体同心。 */
export const STAR_CX: number = 512;
export const STAR_CY: number = 466;
/** 星芒臂长（尖点距中心）。 */
export const STAR_R: number = 130;

// ── path 生成（确定性字符串）──────────────────────────────────────────────────

function n(v: number): string {
  // 统一数值格式：整数不带小数点，非整数保留一位 ⇒ 生成结果**逐字节确定**
  const r: number = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

/**
 * 气泡 + 尾巴的闭合 path（`fill-rule=nonzero` 单一子路径）。
 * 尾巴尖按 `TAIL_TIP_ROUND` 倒圆（`Q` 二次贝塞尔切角），锐角硬拐 → 柔性收尾。
 */
export function bubblePath(): string {
  const r: number = TAIL_TIP_ROUND;
  let tail: string;
  if (r <= 0) {
    tail = `L ${n(TAIL_TIP_X)} ${n(TAIL_TIP_Y)}`;
  } else {
    // 入射边（底边 → 尖点）方向单位向量；出射边（尖点 → 竖直向上）
    const dx: number = TAIL_TIP_X - TAIL_BASE_X;
    const dy: number = TAIL_TIP_Y - BUBBLE_Y1;
    const len: number = Math.sqrt(dx * dx + dy * dy);
    const ux: number = dx / len;
    const uy: number = dy / len;
    const ax: number = TAIL_TIP_X - r * ux; // 入射边上的切点
    const ay: number = TAIL_TIP_Y - r * uy;
    const bx: number = TAIL_TIP_X;          // 出射边（竖直）上的切点
    const by: number = TAIL_TIP_Y - r;
    tail = `L ${n(ax)} ${n(ay)} Q ${n(TAIL_TIP_X)} ${n(TAIL_TIP_Y)} ${n(bx)} ${n(by)}`;
  }
  return [
    `M ${n(BUBBLE_X0 + BUBBLE_R)} ${n(BUBBLE_Y0)}`,
    `H ${n(BUBBLE_X1 - BUBBLE_R)}`,
    `A ${n(BUBBLE_R)} ${n(BUBBLE_R)} 0 0 1 ${n(BUBBLE_X1)} ${n(BUBBLE_Y0 + BUBBLE_R)}`,
    `V ${n(BUBBLE_Y1 - BUBBLE_R)}`,
    `A ${n(BUBBLE_R)} ${n(BUBBLE_R)} 0 0 1 ${n(BUBBLE_X1 - BUBBLE_R)} ${n(BUBBLE_Y1)}`,
    `H ${n(TAIL_BASE_X)}`,
    tail,
    `L ${n(TAIL_TIP_X)} ${n(BUBBLE_Y1)}`,
    `H ${n(BUBBLE_X0 + BUBBLE_R)}`,
    `A ${n(BUBBLE_R)} ${n(BUBBLE_R)} 0 0 1 ${n(BUBBLE_X0)} ${n(BUBBLE_Y1 - BUBBLE_R)}`,
    `V ${n(BUBBLE_Y0 + BUBBLE_R)}`,
    `A ${n(BUBBLE_R)} ${n(BUBBLE_R)} 0 0 1 ${n(BUBBLE_X0 + BUBBLE_R)} ${n(BUBBLE_Y0)}`,
    'Z',
  ].join(' ');
}

/** 四角星芒闭合 path（四个尖点 + 控制点全在中心 ⇒ 凹边 sparkle）。 */
export function starPath(): string {
  const l: number = STAR_CX - STAR_R;
  const rr: number = STAR_CX + STAR_R;
  const t: number = STAR_CY - STAR_R;
  const b: number = STAR_CY + STAR_R;
  return [
    `M ${n(STAR_CX)} ${n(t)}`,
    `Q ${n(STAR_CX)} ${n(STAR_CY)} ${n(rr)} ${n(STAR_CY)}`,
    `Q ${n(STAR_CX)} ${n(STAR_CY)} ${n(STAR_CX)} ${n(b)}`,
    `Q ${n(STAR_CX)} ${n(STAR_CY)} ${n(l)} ${n(STAR_CY)}`,
    `Q ${n(STAR_CX)} ${n(STAR_CY)} ${n(STAR_CX)} ${n(t)}`,
    'Z',
  ].join(' ');
}

// ── SVG 生成（确定性）────────────────────────────────────────────────────────

const SVG_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * 启动器图标 SVG（满幅强调色底 + 白气泡 + 强调色星芒）。
 * 圆角交给系统桌面遮罩 ⇒ **不画圆角、不画边框、不用渐变**（见 `docs/BRAND.md §6.1`）。
 */
export function appIconSvg(accent: string, onAccent: string): string {
  return [
    SVG_HEAD,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${APP_ICON_PX}" height="${APP_ICON_PX}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}">`,
    `  <rect x="0" y="0" width="${BRAND_CANVAS}" height="${BRAND_CANVAS}" fill="${accent}"/>`,
    `  <path fill="${onAccent}" d="${bubblePath()}"/>`,
    `  <path fill="${accent}" d="${starPath()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * 开屏标记 SVG（**透明底**；强调色气泡 + 反色星芒）。
 * 透明底是因为开屏底色由 `startWindowBackground`（`$color:`）单独给 —— 见 `docs/BRAND.md §7`。
 */
export function splashMarkSvg(accent: string, onAccent: string): string {
  return [
    SVG_HEAD,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${START_ICON_PX}" height="${START_ICON_PX}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}">`,
    `  <path fill="${accent}" d="${bubblePath()}"/>`,
    `  <path fill="${onAccent}" d="${starPath()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

// ── 安全区（可测的几何检算）──────────────────────────────────────────────────

/** 轴对齐包围盒。 */
export class Bounds {
  x0: number = 0;
  y0: number = 0;
  x1: number = 0;
  y1: number = 0;
  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }
}

/** 标记（气泡含尾巴）的包围盒 —— 用**控制点包络**（含圆角切点）保守取值。 */
export function markBounds(): Bounds {
  const yMax: number = TAIL_TIP_Y;
  return new Bounds(BUBBLE_X0, BUBBLE_Y0, BUBBLE_X1, yMax);
}

/** 画布中心。 */
export function canvasCenter(): number[] {
  return [BRAND_CANVAS / 2, BRAND_CANVAS / 2];
}

/**
 * 标记到画布中心的**最大距离** —— 圆形/分层安全区的判定量。
 *
 * 取**真实边界极值点**（四条边中点 + 四个圆角弧上的最远点 + 尾巴尖），
 * 而不是包围盒四角（后者会把"并不存在的角落"也算进去 ⇒ 高估）。
 */
export function markMaxRadius(): number {
  const cx: number = BRAND_CANVAS / 2;
  const cy: number = BRAND_CANVAS / 2;
  const midY: number = (BUBBLE_Y0 + BUBBLE_Y1) / 2;
  const midX: number = (BUBBLE_X0 + BUBBLE_X1) / 2;
  const pts: number[][] = [
    [BUBBLE_X0, midY],            // 左缘中点
    [BUBBLE_X1, midY],            // 右缘中点
    [midX, BUBBLE_Y0],            // 上缘中点
    [midX, BUBBLE_Y1],            // 下缘中点
    [TAIL_TIP_X, TAIL_TIP_Y],     // 尾巴尖
  ];
  // 四个圆角弧：弧心已知，弧上离画布中心最远的点 = 弧心 + R·单位(弧心−画布中心)
  const corners: number[][] = [
    [BUBBLE_X0 + BUBBLE_R, BUBBLE_Y0 + BUBBLE_R],
    [BUBBLE_X1 - BUBBLE_R, BUBBLE_Y0 + BUBBLE_R],
    [BUBBLE_X1 - BUBBLE_R, BUBBLE_Y1 - BUBBLE_R],
    [BUBBLE_X0 + BUBBLE_R, BUBBLE_Y1 - BUBBLE_R],
  ];
  for (let i = 0; i < corners.length; i++) {
    const ax: number = corners[i][0];
    const ay: number = corners[i][1];
    const dx: number = ax - cx;
    const dy: number = ay - cy;
    const d: number = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) {
      pts.push([ax + BUBBLE_R, ay]);
    } else {
      pts.push([ax + BUBBLE_R * dx / d, ay + BUBBLE_R * dy / d]);
    }
  }
  let max: number = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx: number = pts[i][0] - cx;
    const dy: number = pts[i][1] - cy;
    const d: number = Math.sqrt(dx * dx + dy * dy);
    if (d > max) {
      max = d;
    }
  }
  return max;
}

/** 圆形遮罩（内切圆）下标记是否完整可见。 */
export function fitsInscribedCircle(): boolean {
  return markMaxRadius() <= ICON_INSCRIBED_RADIUS;
}

/** 分层图标前景安全区下标记是否完整可见（保守检算；当前单层图标不依赖它）。 */
export function fitsLayeredSafeZone(): boolean {
  return markMaxRadius() <= LAYERED_SAFE_RADIUS;
}

/**
 * 建议的标记最大半径（留白后）—— 样张绿圈（`docs/mockups/brand-splash.html §①`）。
 * 取 `0.8 ×` 圆形蒙版内切半径：小于它 ⇒ 任意蒙版下都有 ~20% 呼吸边，观感不"顶边"。
 */
export const SUGGESTED_MAX_RADIUS: number = Math.round(0.8 * ICON_INSCRIBED_RADIUS); // 410

// ── WCAG 对比度（纯函数；降级链与门禁共用同一口径）──────────────────────────────

/**
 * WCAG 2.1 相对亮度（0..1）。
 * 接受 `#RRGGBB` 或 8 位 `#AARRGGBB`（取末 6 位；如 `Effects.glowSoft`）；非法值按黑（0）处理，**不抛**。
 */
export function relativeLuminance(hex: string): number {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const six: string = h.length === 8 ? h.slice(2) : h;
  if (six.length !== 6) { return 0; }
  const chan: number[] = [
    parseInt(six.substring(0, 2), 16) / 255,
    parseInt(six.substring(2, 4), 16) / 255,
    parseInt(six.substring(4, 6), 16) / 255,
  ];
  const lin: number[] = [];
  for (let i = 0; i < 3; i++) {
    const v: number = chan[i];
    lin.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  }
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 2.1 对比度（≥ 1）。 */
export function contrastRatio(a: string, b: string): number {
  const la: number = relativeLuminance(a);
  const lb: number = relativeLuminance(b);
  const hi: number = la > lb ? la : lb;
  const lo: number = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

// ── 降级链（presentation ladder：满幅 → 实心 → 轮廓 → wordmark）────────────────
// 依据：`docs/mockups/brand-splash.html §③` 与 `docs/REDESIGN-INPUT-BRAND.md §3.3/§3.4`。
// 本段是**纯逻辑**：给定承载面（深/浅、是否无障碍单色、可用边长、品牌色对比度）⇒ 选一档。
// 组件层只许问"用哪一档"（`markLevelFor`），**不许**自己写 if/else 决定品牌呈现。

/** 档位标识（字符串常量；组件据此选取资源/渲染方式）。 */
export const MARK_LADDER_FULL: string = 'full';         // 满幅品牌色 + 反色 glyph（深色面 / 启动器图标）
export const MARK_LADDER_SOLID: string = 'solid';       // 实心品牌色 glyph on 中性白（浅色面；零发光）
export const MARK_LADDER_OUTLINE: string = 'outline';   // 单色轮廓（无障碍/黑白/低对比；零填充零发光）
export const MARK_LADDER_WORDMARK: string = 'wordmark'; // 纯文字 wordmark（几何标记太小）

/** 降级链（信息量从大到小；顺序即优先级）。 */
export function markLadder(): string[] {
  return [MARK_LADDER_FULL, MARK_LADDER_SOLID, MARK_LADDER_OUTLINE, MARK_LADDER_WORDMARK];
}

/** 几何标记可辨识的最小边长（vp）—— 小于它，气泡 + 星芒糊成一团 ⇒ 退到 wordmark。 */
export const MARK_MIN_GLYPH_VP: number = 24;
/** 品牌**图形**对承载面的对比度下限（WCAG 2.1 §1.4.11 非文本）。 */
export const MARK_GRAPHIC_MIN_RATIO: number = 3.0;

/** 承载面上下文（组件填；纯数据，供 `markLevelFor` 判据）。 */
export class BrandSurface {
  /** 承载面是否深色。 */
  dark: boolean = false;
  /** 无障碍 / 黑白 / 极低功耗 ⇒ 强制单色轮廓。 */
  monochrome: boolean = false;
  /** 可用边长（vp）；≤ 0 表示未知（不据此降级）。 */
  sizeVp: number = 0;
  /** 品牌色对承载面的实测对比度；≤ 0 表示未测（不据此降级）。 */
  contrast: number = 0;
  constructor(dark: boolean, monochrome: boolean, sizeVp: number, contrast: number) {
    this.dark = dark;
    this.monochrome = monochrome;
    this.sizeVp = sizeVp;
    this.contrast = contrast;
  }
}

/**
 * 选择标记档位（降级链的**唯一判据**）。
 *
 * 判据顺序（先强后弱）：
 *   1. 可用边长过小（> 0 且 < `MARK_MIN_GLYPH_VP`）⇒ `wordmark`（几何标记糊成一团）；
 *   2. 单色 / 无障碍 ⇒ `outline`（零填充零发光）；
 *   3. 品牌色对承载面对比度不足（已测且 < 3:1）⇒ `outline`（轮廓线仍可辨）；
 *   4. 深色面 ⇒ `full`（满幅品牌色 + 反色 glyph）；浅色面 ⇒ `solid`（实心 glyph on 中性白）。
 *
 * ⛔ 白色主题（浅色面）**永不**返回 `full`（禁用满幅色块）；呈现一律**不靠发光/渐变**（宪法 §3.1）。
 */
export function markLevelFor(s: BrandSurface): string {
  if (s.sizeVp > 0 && s.sizeVp < MARK_MIN_GLYPH_VP) { return MARK_LADDER_WORDMARK; }
  if (s.monochrome) { return MARK_LADDER_OUTLINE; }
  if (s.contrast > 0 && s.contrast < MARK_GRAPHIC_MIN_RATIO) { return MARK_LADDER_OUTLINE; }
  return s.dark ? MARK_LADDER_FULL : MARK_LADDER_SOLID;
}

// ── 降级链各档的资源生成（确定性）────────────────────────────────────────────

/** 单色轮廓的描边宽度（1024 画布）—— 居中描边 ⇒ 每侧外扩 1/2。 */
export const OUTLINE_STROKE_W: number = 28;

/** 轮廓标记的最大半径 = 几何最大半径 + 1/2 描边（居中描边外扩）。 */
export function outlineMaxRadius(): number {
  return markMaxRadius() + OUTLINE_STROKE_W / 2;
}

/**
 * 单色轮廓标记 SVG（降级链第 3 档）：**零填充、零发光、零渐变**，只有一根 `color` 描边。
 * 用途：无障碍 / 黑白 / 低功耗 / 品牌色对底色对比不足时（`markLevelFor` 命中 `outline`）。
 */
export function outlineMarkSvg(color: string): string {
  const stroke: string = `fill="none" stroke="${color}" stroke-width="${OUTLINE_STROKE_W}" stroke-linejoin="round"`;
  return [
    SVG_HEAD,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${START_ICON_PX}" height="${START_ICON_PX}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}">`,
    `  <path ${stroke} d="${bubblePath()}"/>`,
    `  <path ${stroke} d="${starPath()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

// ── 分层图标（adaptive / layered icon）：前景缩进安全区 ────────────────────────

/**
 * 分层图标前景的**缩放系数**：把标记整体缩到 `LAYERED_SAFE_RADIUS`（≤ 313）以内。
 * 标记当前最大半径 393.9 > 313 ⇒ 系数 < 1（前景缩进，避免被分层遮罩裁掉尾巴）。
 * 单层图标（当前形态）不经过这里 —— 它用整幅 393.9（< 内切圆 512，安全）。
 */
export function layeredForegroundScale(): number {
  const m: number = markMaxRadius();
  return m <= LAYERED_SAFE_RADIUS ? 1 : LAYERED_SAFE_RADIUS / m;
}

/** 缩放后前景标记的最大半径（≤ `LAYERED_SAFE_RADIUS`）。 */
export function foregroundMarkMaxRadius(): number {
  return markMaxRadius() * layeredForegroundScale();
}

/** 缩放系数格式（最多 6 位小数；整数不带小数点）—— 生成结果逐字节确定。 */
function scaleStr(v: number): string {
  return `${Math.round(v * 1000000) / 1000000}`;
}

/**
 * 分层图标**前景** SVG：品牌色 glyph 缩进到 313 安全区内（绕画布中心等比缩放）。
 * 配 `layeredBackgroundSvg()` 的满幅色底使用（分层图标 = 前景 + 背景两层，见 `docs/BRAND.md §9`）。
 */
export function layeredForegroundSvg(accent: string, onAccent: string): string {
  const c: number = BRAND_CANVAS / 2;
  const s: string = scaleStr(layeredForegroundScale());
  return [
    SVG_HEAD,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${APP_ICON_PX}" height="${APP_ICON_PX}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}">`,
    `  <g transform="translate(${c} ${c}) scale(${s}) translate(-${c} -${c})">`,
    `    <path fill="${accent}" d="${bubblePath()}"/>`,
    `    <path fill="${onAccent}" d="${starPath()}"/>`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

/** 分层图标**背景** SVG：满幅品牌色方块（前景叠在其上；圆角由系统遮罩施加）。 */
export function layeredBackgroundSvg(accent: string): string {
  return [
    SVG_HEAD,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${APP_ICON_PX}" height="${APP_ICON_PX}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}">`,
    `  <rect x="0" y="0" width="${BRAND_CANVAS}" height="${BRAND_CANVAS}" fill="${accent}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/** 分层图标前景是否落在安全区内（把缩放后半径钉死；生成后应恒为 true）。 */
export function foregroundFitsLayeredSafeZone(): boolean {
  return foregroundMarkMaxRadius() <= LAYERED_SAFE_RADIUS + 1e-9;
}
