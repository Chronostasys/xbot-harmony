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
import { darkPalette } from './theme';

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
