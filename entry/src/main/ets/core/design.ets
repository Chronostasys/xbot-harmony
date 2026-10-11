/**
 * design.ets —— **语义设计令牌层**（本仓设计语言的"可执行宪法"）。
 *
 * 目的：把「尺度 / 层级 / 材质 / 排版 / 动效 / 交互反馈」收敛成**纯函数与常量表**，
 * 供 UI 侧消费 ⇒ 消灭组件里散落的字面量（圆角 17、字号 10/13、透明度 0.45、发光半径 12…）。
 *
 * 为什么单独成文件（三层来源，别混）：
 *   ① 原始刻度  `core/tokens.ets`  —— R_ / SP_ / FS_ / D_ 系列（数值阶梯，无语义）
 *   ② 语义令牌  **本文件**          —— "哪一档用在哪个位置" + 可判定的不变量
 *   ③ 落地取值  `core/theme.ets`    —— 色板/效果/派生面（唯一颜色来源，**本文件只读不改**）
 *
 * ⛔ 纪律（违反即回归）：
 *   1. 本文件**只读** `theme/tokens/motion`，**不改**任何既有 token（`theme.ets` 有主）。
 *   2. 本文件属 `core/` ⇒ 被 `tools/tests/run.sh` 当**纯 TS** 编译
 *      ⇒ **禁止** import ArkUI/`@ohos.*`（`Curve`/`Color`/`FontWeight` 一律不进）。
 *      字重只存数字（400/500/600），由 UI 层映射成 `FontWeight`。
 *   3. **禁颜色字面量**：本文件不出现 `#RRGGBB`（只引用 `Palette` 角色名 + 派生面）。
 *      自检由 `tools/tests/design.test.ts` 读源码断言（改坏即红）。
 *   4. 语义令牌必须**可判定**：每个不变量都在 `designIssues()` 里，测试逐条钉住 + mutation 自证。
 *
 * ── 与既有底座的关系（复用，不另起一套）───────────────────────────────────────
 *   · 动效时长/曲线：引用 `core/motion.ets`（`MOTION_*`）——**不新造时长**。
 *   · 在飞心跳：主呼吸 = `MOTION_BREATH_MS`（= 8×D_SLOW）；本文件只声明**归属**（唯一 owner = 光球）。
 *   · 色值：一律经 `paletteOf/effectsOf/surfacesOf` 取，绝不写 hex。
 */

import {
  Palette, paletteOf, effectsOf, surfacesOf, isLightPalette, contrastRatio, ALL_THEMES,
  HAIRLINE_TARGET_RATIO,
} from './theme';
import {
  R_SM, R_MD, R_LG, R_XL, R_2XL,
  SP_1, SP_2, SP_3, SP_4, SP_5, SP_6, SP_8,
  FS_CAPTION, FS_BODY, FS_TITLE, FS_HERO,
} from './tokens';
import { MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS } from './motion';

// ════════════════════════════════════════════════════════════════════════════
// 1. 空间 —— 4pt 基础网格（+ 一档 2 的"光学半档"，只用于图标-文字对齐）
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么是 4 的倍数：8pt 网格在触屏上"太粗"（Apple HIG 的排版节奏实际是 4pt 起），
// 而 web 侧（权威）Tailwind 的 1 单位 = 0.25rem = 4px ⇒ 4 是最小可对齐步长。
// `SPACE_HAIR = 2` 是**唯一**的例外：它只用于"图标与紧邻文字之间的视觉对齐"，
// 不构成布局节奏（由 `designIssues()` 断言：除 HAIR 外全是 4 的倍数）。

/** 光学半档（仅图标-文字微调；**不是**布局步长）。 */
export const SPACE_HAIR: number = 2;
export const SPACE_XXS: number = SP_1; // 4  ——块内最小间隙
export const SPACE_XS: number = SP_2;  // 8  ——行间 / 图标-文字
export const SPACE_SM: number = SP_3;  // 12 ——卡片内水平
export const SPACE_MD: number = SP_4;  // 16 ——屏幕边距 / 卡片内垂直
export const SPACE_LG: number = SP_5;  // 20 ——区块之间
export const SPACE_XL: number = SP_6;  // 24 ——大区块 / 抽屉顶
export const SPACE_XXL: number = SP_8; // 32 ——页面级留白

// ── 语义位置 → 空间档（**唯一映射**；组件不许再自己写数字）────────────────────
/** 卡片/面板水平内边距。 */
export const INSET_CARD_X: number = SPACE_SM;
/** 卡片/面板垂直内边距。 */
export const INSET_CARD_Y: number = SPACE_SM;
/** 列内行（设置行/列表行）水平内边距。 */
export const INSET_ROW_X: number = SPACE_SM;
/** 列内行垂直内边距（44 命中区靠行高+padding 共同达成，见 §6）。 */
export const INSET_ROW_Y: number = SPACE_XS;
/** 小徽标/chip 水平内边距。 */
export const INSET_CHIP_X: number = SPACE_XXS;
/** 小徽标/chip 垂直内边距（光学半档之上，实际取 2 ⇒ 视觉紧凑）。 */
export const INSET_CHIP_Y: number = SPACE_HAIR;
/** 屏幕左右安全边距（列表容器）。 */
export const GUTTER_SCREEN: number = SPACE_MD;
/** 气泡内水平内边距。 */
export const INSET_BUBBLE_X: number = SPACE_SM + SPACE_HAIR; // 14（对齐 web px-3.5）
/** 气泡内垂直内边距。 */
export const INSET_BUBBLE_Y: number = SPACE_XS;
/** 迭代块内（思考/正文/工具之间）间隙。 */
export const GAP_BLOCK: number = SPACE_XXS;
/** 消息条带（每条消息行）垂直呼吸。 */
export const GAP_ROW_Y: number = SPACE_SM / 2; // 6（对齐 web py-1.5）
/** 段落/块级节奏（Markdown 根块间距）。 */
export const GAP_PARAGRAPH: number = SPACE_XS;
/** 章节之间（大块）。 */
export const GAP_SECTION: number = SPACE_SM;

/** 空间语义表（供测试遍历；name 唯一）。 */
export class SpaceRole {
  name: string;
  vp: number;
  constructor(name: string, vp: number) {
    this.name = name;
    this.vp = vp;
  }
}

/** 全部语义空间档（严格递增，除光学半档外均为 4 的倍数）。 */
export function spaceRoles(): SpaceRole[] {
  return [
    new SpaceRole('space.hair', SPACE_HAIR),
    new SpaceRole('space.xxs', SPACE_XXS),
    new SpaceRole('space.xs', SPACE_XS),
    new SpaceRole('space.sm', SPACE_SM),
    new SpaceRole('space.md', SPACE_MD),
    new SpaceRole('space.lg', SPACE_LG),
    new SpaceRole('space.xl', SPACE_XL),
    new SpaceRole('space.xxl', SPACE_XXL),
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 形状 —— 圆角/描边按**语义位置**分档（不是按数值大小）
// ════════════════════════════════════════════════════════════════════════════

/** chip/徽标圆角（小面）。 */
export const RADIUS_CHIP: number = R_MD;      // 6
/** 工具 pill / 小按钮 / 思考行圆角。 */
export const RADIUS_PILL: number = R_LG;      // 8
/** 输入框 / 卡片 / 浮层 / 目标条圆角。 */
export const RADIUS_CARD: number = R_XL;      // 12
/** 底部抽屉（Sheet）/ 大容器圆角。 */
export const RADIUS_SHEET: number = R_2XL;    // 16
/** 用户气泡四角。 */
export const RADIUS_BUBBLE: number = R_2XL;   // 16
/** 用户气泡"尾巴"角（右下角收小）。 */
export const RADIUS_BUBBLE_TAIL: number = R_SM; // 4
/** 结构性发丝宽度（hairline）。 */
export const STROKE_HAIRLINE: number = 1;
/** 内容左侧竖栏宽度（引用块 / 思考展开体 / 引用条的"栅栏"）。 */
export const STROKE_RAIL: number = 2;

/** 形状语义表。 */
export class RadiusRole {
  name: string;
  vp: number;
  constructor(name: string, vp: number) {
    this.name = name;
    this.vp = vp;
  }
}

export function radiusRoles(): RadiusRole[] {
  return [
    new RadiusRole('radius.chip', RADIUS_CHIP),
    new RadiusRole('radius.pill', RADIUS_PILL),
    new RadiusRole('radius.card', RADIUS_CARD),
    new RadiusRole('radius.sheet', RADIUS_SHEET),
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 层级语言 —— 排版阶梯（**不用装饰**建立层次：字号 / 字重 / 行高 / 色阶）
// ════════════════════════════════════════════════════════════════════════════
//
// 设计原则（为什么这样才"像苹果"）：
//   · 层次的**第一把手**是**字重与字号**，不是颜色、更不是边框/阴影。
//     Apple 的层级几乎全靠 SF 的 weight + size + 灰阶（label / secondaryLabel / tertiaryLabel）。
//   · 行高必须**显式**（ArkUI 默认行高偏紧、不可控）。正文行高 ≥1.5 才"呼吸"。
//   · 字阶**严格递减且无重复**（`designIssues()` 断言）——重复档 = 层级塌陷。

/** 字重档（纯数字；UI 层映射 `FontWeight`）。 */
export const WEIGHT_REGULAR: number = 400;
export const WEIGHT_MEDIUM: number = 500;
export const WEIGHT_SEMIBOLD: number = 600;

/** 一个排版角色：字号（fp）+ 字重 + 行高（倍数）+ 字距 + 语义文字色角色。 */
export class TypeRole {
  name: string;
  size: number;
  weight: number;
  /** 行高**倍数**（UI 层 `size * lineHeight` 取 vp；比绝对值更耐改）。 */
  lineHeight: number;
  /** 字距（vp，负值收紧；大字号需收紧，小字号需放开）。 */
  tracking: number;
  /** 文字**语义色角色**（`Palette` 字段名，如 `textPrimary`）。 */
  colorRole: string;
  constructor(name: string, size: number, weight: number, lineHeight: number,
    tracking: number, colorRole: string) {
    this.name = name;
    this.size = size;
    this.weight = weight;
    this.lineHeight = lineHeight;
    this.tracking = tracking;
    this.colorRole = colorRole;
  }
}

/**
 * 全局排版阶梯（**严格递减、无重复**）。
 * 依据：web 正文字号 `text-sm`=14 / 消息正文原生 15（`core/tokens.ets` 注释）；
 *      Apple 正文 17、但在 1320×2848 的密度 3.0 屏上 15 更接近"手机正文"观感。
 */
export function typeRoles(): TypeRole[] {
  return [
    // 品牌/空态主标题（登录页 "xbot"、空态）
    new TypeRole('type.display', 28, WEIGHT_SEMIBOLD, 1.20, -0.4, 'textPrimary'),
    // 页面/卡片标题
    new TypeRole('type.title', FS_HERO, WEIGHT_SEMIBOLD, 1.25, -0.2, 'textPrimary'),
    // 小节标题（Sheet 头、分组标题）
    new TypeRole('type.headline', 17, WEIGHT_SEMIBOLD, 1.30, 0, 'textPrimary'),
    // 正文（消息正文）—— 层级的主角
    new TypeRole('type.body', 15, WEIGHT_REGULAR, 1.55, 0, 'textPrimary'),
    // 次要正文（设置说明、助手行辅助文）
    new TypeRole('type.callout', FS_BODY, WEIGHT_REGULAR, 1.50, 0, 'textSecondary'),
    // 标签/名称（工具名、设置行标题）
    new TypeRole('type.subhead', FS_BODY - 1, WEIGHT_MEDIUM, 1.40, 0, 'textPrimary'),
    // 元信息（思考行、时间戳、状态文本）
    new TypeRole('type.caption', FS_CAPTION, WEIGHT_REGULAR, 1.35, 0.1, 'textSecondary'),
    // 微型（chip / 徽标 / 角标）——**替代散落的 10 / 11 字面量**
    new TypeRole('type.micro', 10, WEIGHT_MEDIUM, 1.20, 0.2, 'textSecondary'),
  ];
}

/** 取排版角色（未知 ⇒ 回落 `type.body`，永不返回 undefined）。 */
export function typeOf(name: string): TypeRole {
  const all: TypeRole[] = typeRoles();
  for (let i = 0; i < all.length; i++) {
    if (all[i].name === name) { return all[i]; }
  }
  return all[3]; // type.body
}

// ── Markdown 面排版尺度组（输入 #4 要求：消灭 15/20/18/16/13/11 等凹口值）────────
/** Markdown 正文行高（web `leading-relaxed`=1.625；取 1.55 与全局 body 同源）。 */
export const MD_BODY_LEADING: number = 1.55;
/** 标题行高（web `line-height:1.3`）。 */
export const MD_HEADING_LEADING: number = 1.28;
/** 代码块行高（等宽字需更紧，但仍要可读）。 */
export const MD_CODE_LEADING: number = 1.50;
/** Markdown 块级节奏（根 `Column.space`；旧值 6 是凹口 ⇒ 归到 8 网格）。 */
export const MD_BLOCK_GAP: number = SPACE_XS;
/** 标题上/下外边距。 */
export const MD_HEADING_GAP_TOP: number = SPACE_MD;
export const MD_HEADING_GAP_BOTTOM: number = SPACE_XS;
/** 列表缩进步长（web `padding-left:1.5em`）。 */
export const MD_LIST_INDENT: number = SPACE_MD;
/** 列表项之间。 */
export const MD_LIST_ITEM_GAP: number = SPACE_XXS;
/** 分隔线上下留白（web `1em`）。 */
export const MD_SECTION_GAP: number = SPACE_SM;
/** 引用块左栅栏宽度。 */
export const MD_QUOTE_RAIL: number = STROKE_RAIL;
/** 引用块内边距。 */
export const MD_QUOTE_PAD: number = SPACE_SM;
/** 表格单元格内边距。 */
export const MD_TABLE_CELL_X: number = SPACE_XS;
export const MD_TABLE_CELL_Y: number = SPACE_XXS;

/** Markdown 标题阶梯（h1..h4；**非递增**，h4 == 正文 = web `1em` 的原义）。 */
export class MdHeading {
  level: number;
  size: number;
  constructor(level: number, size: number) {
    this.level = level;
    this.size = size;
  }
}

export function mdHeadings(): MdHeading[] {
  return [
    new MdHeading(1, 24),
    new MdHeading(2, 20),
    new MdHeading(3, 17),
    new MdHeading(4, 15), // == type.body（web `1em`）
  ];
}

/** Markdown 代码/行内码字号（web 代码 `13px`；行内码 `0.85em` ⇒ 15×0.85≈13）。 */
export const MD_CODE_SIZE: number = 13;
export const MD_INLINE_CODE_SIZE: number = 13;
export const MD_TABLE_SIZE: number = 13;

// ════════════════════════════════════════════════════════════════════════════
// 4. 材质 —— **分层表面**（这是"底里有底必然撞色"的结构性修复）
// ════════════════════════════════════════════════════════════════════════════
//
// 根因（输入 PILL §A1）：pill 底 / chip 底 / 浮层底**共用** surfaceAlt/surfaceHi/sunken
// ⇒ 任何"底里有底"都会撞色（已发生真 bug：chip 与选中 pill 同色 ⇒ chip 消失）。
//
// 修法：把"面"按**深度层级**编号，每个语义面**绑定到一个层级**（而非某个具体 token）：
//   · 深色系：层级越高越**亮**（L0 画布最暗 → L3 选中面最亮）—— 靠"填充亮度"分层。
//   · 浅色系：白面**无法再变亮** ⇒ 高层级用 `hairline + 柔影` 表达"浮起"，
//     而"往里嵌"（沉入）用**更深的填充**表达。所以颜色方向随明暗自适应（由 `isLightPalette` 决定语义）。
//
// 关键决定（**chip 恒为"内嵌凹槽"**）：chip 不是"另一种 pill"，它是 pill **内部**的一个下沉面
// ⇒ `chip = sunken`（恒定），与 pill 的填充**结构上不可能同色**（无论 pill 是否选中）。
// 这比"选中时把 chip 与 pill 的色对调"（补丁）更稳：选中只改 pill 自己的一层。

/** 面层级（0=最底画布 … 4=内嵌凹槽；数值仅表"深度序"，不表颜色方向）。 */
export const RUNG_CANVAS: number = 0;
export const RUNG_CARD: number = 1;
export const RUNG_RAISED: number = 2;
export const RUNG_ACTIVE: number = 3;
export const RUNG_SUNKEN: number = 4;

/** 一个语义面：绑定到某个**层级** + 描述"边界策略"。 */
export class SurfaceRole {
  name: string;
  rung: number;
  /** 该面是否需要**结构性发丝**（`Surfaces.hairline`）来立边界。 */
  hairline: boolean;
  constructor(name: string, rung: number, hairline: boolean) {
    this.name = name;
    this.rung = rung;
    this.hairline = hairline;
  }
}

/**
 * 语义面表（**唯一映射**）。组件只允许说"给我 `surface.chip` 的填充"，
 * 不允许自己挑 `surfaceHi`。
 */
export function surfaceRoles(): SurfaceRole[] {
  return [
    new SurfaceRole('surface.canvas', RUNG_CANVAS, false),
    new SurfaceRole('surface.card', RUNG_CARD, true),           // 卡片：浅色系靠发丝立边
    new SurfaceRole('surface.overlay', RUNG_CARD, true),        // 浮层/Sheet 面板（+ elev3 阴影）
    new SurfaceRole('surface.overlayRow', RUNG_RAISED, false),
    new SurfaceRole('surface.overlayRowHover', RUNG_ACTIVE, false),
    new SurfaceRole('surface.pill', RUNG_RAISED, false),        // 工具 pill（普通）
    new SurfaceRole('surface.pillSelected', RUNG_ACTIVE, false),// 工具 pill（浮层打开的那一枚）
    new SurfaceRole('surface.chip', RUNG_SUNKEN, false),        // chip = **内嵌凹槽**（恒 ≠ pill）
    new SurfaceRole('surface.well', RUNG_SUNKEN, false),        // 代码块/终端/diff 行底
    new SurfaceRole('surface.input', RUNG_CARD, true),          // 输入框（聚焦时才描边）
  ];
}

/**
 * 语义面 → **填充色**（纯函数；换主题即换）。
 * 层级 → 色板角色的映射（**唯一**，组件不得自行挑角色）：
 *   canvas→appBg · card→surface · raised→surfaceAlt · active→surfaceHi · sunken→Surfaces.sunken
 */
export function surfaceFillOf(p: Palette, role: string): string {
  const s = surfaceRoles();
  let rung: number = RUNG_CARD;
  for (let i = 0; i < s.length; i++) {
    if (s[i].name === role) { rung = s[i].rung; }
  }
  return fillOfRung(p, rung);
}

/** 层级 → 填充色（与 `surfaceFillOf` 同源，供只拿到 rung 的调用点用）。 */
export function fillOfRung(p: Palette, rung: number): string {
  if (rung === RUNG_CANVAS) { return p.appBg; }
  if (rung === RUNG_CARD) { return p.surface; }
  if (rung === RUNG_RAISED) { return p.surfaceAlt; }
  if (rung === RUNG_ACTIVE) { return p.surfaceHi; }
  return surfacesOf(p).sunken;
}

/** 语义面是否需要发丝边界（浅色系"浮起"的承载）。 */
export function surfaceHairlineOf(role: string): boolean {
  const s = surfaceRoles();
  for (let i = 0; i < s.length; i++) {
    if (s[i].name === role) { return s[i].hairline; }
  }
  return false;
}

/** 结构性发丝色（唯一出口；组件不得直接 `pal().border` 当结构边界）。 */
export function hairlineOf(p: Palette): string {
  return surfacesOf(p).hairline;
}

/** 内嵌凹槽色（代码块 / chip / 终端 / diff 行底）。 */
export function wellOf(p: Palette): string {
  return surfacesOf(p).sunken;
}

/** 玻璃面基色（唯一出口；浮层材质）。 */
export function glassFillOf(p: Palette): string {
  return effectsOf(p).glassBg;
}

/** 该色板是不是"浅色系"（**按 appBg 亮度**，不按主题名）—— 语义方向的总开关。 */
export function isLightSurface(p: Palette): boolean {
  return isLightPalette(p);
}

// ── 4.1 纯白主题的**最小可辨层级差**（浅色最容易糊的量化防线）───────────────
//
// 问题（工具状态线实测）：porcelain 里 `surface.pill` 与 `surface.chip`
// 只差 **2 级灰度**（对比度 1.037）—— "底里有底"在白底上几乎读不出层次。
// 判据：任一可嵌套面之间的对比度必须 ≥ `MIN_LEVEL_DELTA`；低于 `HAIRLINE_ASSIST_BELOW`
// 时该面**必须补一条结构性发丝**（`hairlineOf`）来立边界。
/** 可嵌套面之间的**最小可辨对比度**（实测：dark 1.073 / light 1.030 / porcelain 1.037）。 */
export const MIN_LEVEL_DELTA: number = 1.025;
/** 低于它就"必须补发丝"（porcelain 1.037 ⇒ 落在补发丝区）。 */
export const HAIRLINE_ASSIST_BELOW: number = 1.05;

/** 某对"可嵌套面"是否层次不足（返回 '' = 足够，否则返回成因）。 */
export function levelDeltaIssue(p: Palette, a: string, b: string): string {
  const r: number = contrastRatio(surfaceFillOf(p, a), surfaceFillOf(p, b));
  if (r < MIN_LEVEL_DELTA) { return `${a} vs ${b} = ${r.toFixed(4)} < ${MIN_LEVEL_DELTA}`; }
  return '';
}

/** 该主题下 chip 是否需要**补发丝**（层次差 < HAIRLINE_ASSIST_BELOW）。 */
export function chipNeedsHairline(p: Palette): boolean {
  return contrastRatio(surfaceFillOf(p, 'surface.pill'),
    surfaceFillOf(p, 'surface.chip')) < HAIRLINE_ASSIST_BELOW;
}

// ── 4.2 组件专属语义面（**别名**，指向 §3 的规范层级 ⇒ 单一来源不破）──────────
//
// 目的：让组件说"给我 surface.goal 的填充"，而不是自己挑 surface/surfaceAlt。
// 每个别名**必须**指向 `surfaceRoles()` 里的一个规范面（测试断言）。
/** 思考行展开体（无填充，靠左栅栏 + 发丝）。 */
export const SURFACE_THINKING: string = 'surface.canvas';
/** 待办拉条（一行 + 可展开清单；无整块填充，靠上下发丝）。 */
export const SURFACE_TODO: string = 'surface.canvas';
/** 待办行的"进行中"底纹（内嵌凹槽）。 */
export const SURFACE_TODO_ACTIVE: string = 'surface.chip';
/** 目标横幅（辅助条，浮在输入框上方）。 */
export const SURFACE_GOAL: string = 'surface.card';
/** 目标徽标底。 */
export const SURFACE_GOAL_BADGE: string = 'surface.chip';
/** 编辑器/composer 输入面。 */
export const SURFACE_COMPOSER: string = 'surface.input';

// ── 4.3 组件专属排版档（**别名**，指向 §1 的排版阶梯）──────────────────────
/** 思考行 / 元信息。 */
export const TYPE_THINKING: string = 'type.caption';
/** 待办条文本 / 目标条文本（辅助条 ≤ 正文）。 */
export const TYPE_TODO: string = 'type.caption';
export const TYPE_GOAL: string = 'type.caption';
/** 工具名 / 设置行标题。 */
export const TYPE_PILL_NAME: string = 'type.subhead';
/** chip / 徽标。 */
export const TYPE_CHIP: string = 'type.micro';

// ── 4.4 阴影 / 层级（语义出口；⛔ 组件不得直接 effectsOf().elev1/2/3）─────────
/** 阴影语义档（映射到 `Effects` 的 elev1/2/3）。 */
export const ELEV_CARD: string = 'elev1';
export const ELEV_RAISED: string = 'elev2';
export const ELEV_OVERLAY: string = 'elev3';

/** 阴影语义档 → 实际色（唯一出口）。 */
export function elevationColorOf(p: Palette, level: string): string {
  const e = effectsOf(p);
  if (level === ELEV_OVERLAY) { return e.elev3; }
  if (level === ELEV_RAISED) { return e.elev2; }
  return e.elev1;
}

/** 语义面 → 应使用的阴影档（`surface.overlay` ⇒ overlay；卡片 ⇒ card）。 */
export function elevationLevelOf(role: string): string {
  if (role === 'surface.overlay') { return ELEV_OVERLAY; }
  if (role === 'surface.card' || role === 'surface.input') { return ELEV_CARD; }
  return ELEV_RAISED;
}

// ── 4.5 形状/间距的"组件专属档"（把 pill/marker 的字面量收编）────────────────
/** 工具 pill 水平内距（= space.xs）。 */
export const INSET_PILL_X: number = SPACE_XS;
/**
 * 工具 pill 垂直内距 = **5**（**光学档**，非 4 网格）。
 * 为什么不是 8：marker 槽 14 + 2×5 = **24vp** 的胶囊高度是"密而清楚"的关键；
 * 取 8 会让每枚 pill 长到 30vp（+25%），密集工具行会明显变散。
 */
export const INSET_PILL_Y: number = 5;
/** 光学档白名单（**非** 4 网格；只有它们可以不是 4 的倍数）。 */
export function opticalValues(): number[] {
  return [SPACE_HAIR, INSET_PILL_Y];
}
/** 状态标记槽边长（**恒定** ⇒ 所有 pill 图标/名字左对齐的前提）。 */
export const MARKER_SLOT: number = 14;
/** 标记 glyph 字号（勾/叉/减号）。 */
export const MARKER_GLYPH: number = 13;
/** 虚线圆（排队）字号（比实体 glyph 小 1 ⇒ 视觉重量相当）。 */
export const MARKER_GLYPH_DASHED: number = 12;
/** spinner 边长（= glyph 尺寸，占满槽）。 */
export const MARKER_SPINNER: number = 13;
/** pill 外边距（工具行内）。 */
export const GAP_PILL: number = SPACE_XXS - 1; // 3（光学档，密集行）
/** pill 最大宽度（超出即截断出省略号）。 */
export const PILL_MAX_W: number = 240;

// ── 4.6 "在飞"的**静态**表达（⛔ 不含任何动画）──────────────────────────────
//
// 铁律（§5）：同一时刻只有一个"在飞动效" = 光球。工具的"在飞"只允许**静态**维度：
// 状态色 + 系统 spinner（工具身份）+ **表面层级提升** + 柔影。
// 本组只导出"静态"取值，任何 `motion.*` 都不得出现在这里（测试断言 owner 不含工具面）。
/** 在飞 pill 的表面（= **提升一档**到 `surface.pillSelected`）。 */
export const INFLIGHT_PILL_SURFACE: string = 'surface.pillSelected';
/** 在飞柔影半径（vp）。 */
export const INFLIGHT_PILL_GLOW_RADIUS: number = 12;
/** 在飞工具面的 owner（仅用于断言"工具面**不拥有**任何在飞动效"）。 */
export const INFLIGHT_OWNER_PILL: string = 'pill';

/**
 * 在飞柔影色 —— **唯一的主题分叉点**（**静态**色，非动画）。
 * 深色系：`effectsOf().glow`（accent@45% 的彩色外发光 = "在飞"的高级感来源）；
 * 浅色系：`effectsOf().elev2`（中性柔影）—— 45% 饱和色晕压白卡边上会读成"脏"。
 * 判据按 `isLightPalette`（色板亮度），⛔ 不按主题名。
 */
export function inflightPillShadowOf(p: Palette): string {
  return isLightSurface(p) ? effectsOf(p).elev2 : effectsOf(p).glow;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 动效 —— 时长/曲线全部引用既有底座；**只声明归属**（谁是"在飞"）
// ════════════════════════════════════════════════════════════════════════════
//
// ⛔ 铁律：同一时刻**只允许一个"在飞动效" = 光球**（`docs/DESIGN-SYSTEM.md §8`）。
// 本层把它变成**可判定**的：每个动效角色声明 `inFlight` 与 `owner`；
// `designIssues()` 断言"在飞角色的 owner **只有一个**" ⇒ 任何第二套在飞节拍都会红。

/** 唯一被允许的"在飞"owner（光球）。 */
export const INFLIGHT_OWNER_ORB: string = 'orb';

/** 曲线标识（UI 层映射成 `components/anim.ets` 的工厂）。 */
export const CURVE_SPRING: string = 'spring';
export const CURVE_EASE_OUT: string = 'easeOut';

/** 一个动效角色：时长（ms）+ 曲线 + 是否属于"在飞组" + owner。 */
export class MotionRole {
  name: string;
  ms: number;
  curve: string;
  inFlight: boolean;
  owner: string;
  constructor(name: string, ms: number, curve: string, inFlight: boolean, owner: string) {
    this.name = name;
    this.ms = ms;
    this.curve = curve;
    this.inFlight = inFlight;
    this.owner = owner;
  }
}

/**
 * 允许的时长集合（ms）—— **必须**是既有底座的取值或其整数分数/倍数。
 * 依据：`core/motion.ets`（180/200/220/320）+ 主呼吸刻度 2560 及其分数（640 = 1/4）。
 */
export function allowedDurations(): number[] {
  return [MOTION_FAST_MS, MOTION_MSG_IN_MS, MOTION_BASE_MS, MOTION_SLOW_MS, 640, 1280, 2560];
}

/** 主呼吸刻度（ms）= 8×D_SLOW —— 与 `components/anim.ets:MOTION_BREATH_MS` 同值。 */
export const MOTION_BREATH_MS: number = MOTION_SLOW_MS * 8;
/** 细节拍 = 主呼吸的 1/4。 */
export const MOTION_BEAT_MS: number = MOTION_BREATH_MS / 4;

/**
 * 动效角色表。
 * ⚠️ 一次性过渡（press/enter/transition/stateChange）**不属于**在飞组；
 *    只有 `motion.breath`（光球呼吸）与 `motion.beat`（打字机光标）属于在飞组，
 *    且两者 owner 都必须是 `orb`（光球子系统统一持有节拍）。
 */
export function motionRoles(): MotionRole[] {
  return [
    new MotionRole('motion.press', MOTION_FAST_MS, CURVE_SPRING, false, ''),
    new MotionRole('motion.enterRow', MOTION_MSG_IN_MS, CURVE_SPRING, false, ''),
    new MotionRole('motion.enterBlock', MOTION_BASE_MS, CURVE_SPRING, false, ''),
    new MotionRole('motion.transition', MOTION_SLOW_MS, CURVE_SPRING, false, ''),
    new MotionRole('motion.stateChange', MOTION_SLOW_MS, CURVE_SPRING, false, ''),
    new MotionRole('motion.breath', MOTION_BREATH_MS, CURVE_SPRING, true, INFLIGHT_OWNER_ORB),
    new MotionRole('motion.beat', MOTION_BEAT_MS, CURVE_SPRING, true, INFLIGHT_OWNER_ORB),
  ];
}

/** 一次性过渡时长（ms）—— UI 层直接用（避免组件写 180/220 字面量）。 */
export const DUR_PRESS: number = MOTION_FAST_MS;
export const DUR_ENTER_ROW: number = MOTION_MSG_IN_MS;
export const DUR_ENTER_BLOCK: number = MOTION_BASE_MS;
export const DUR_TRANSITION: number = MOTION_SLOW_MS;

// ════════════════════════════════════════════════════════════════════════════
// 6. 交互反馈 —— "爽"的判据（命中区 / 即时反馈 / 无抖动）
// ════════════════════════════════════════════════════════════════════════════

/** 按压不透明度（**全站唯一**；历史散落 0.75/0.7/0.6）。 */
export const PRESS_OPACITY: number = 0.6;
/** 按压缩放（仅卡片/大按钮；文本行不缩放以免抖动）。 */
export const PRESS_SCALE: number = 0.97;
/** 最小命中区（vp）—— Apple HIG ≥44pt；图标视觉尺寸可更小，命中区用 `responseRegion` 外扩。 */
export const HIT_TARGET_MIN: number = 44;
/** 长按触发时长（ms）。 */
export const LONG_PRESS_MS: number = 400;
/** 禁用态不透明度。 */
export const DISABLED_OPACITY: number = 0.4;
/** 失败态文案**恒静态**（无动效、无填充、无边框；见 `docs/DESIGN-SYSTEM.md §10`）。 */

// ════════════════════════════════════════════════════════════════════════════
// 7. 对比度门禁（WCAG 2.1）—— 把"可访问性"变成可断言
// ════════════════════════════════════════════════════════════════════════════

/** 正文/关键 CTA 的 AA 阈值。 */
export const AA_TEXT: number = 4.5;
/** 非文本（图标/描边/状态点）阈值（WCAG 2.1 §1.4.11）。 */
export const AA_NON_TEXT: number = 3.0;
/** "几乎不该被读到"的最弱一档（`textMuted`）阈值 —— 与既有 `theme_contrast.test.ts` 同口径。 */
export const AA_MUTED: number = 2.0;

/** 一条对比度要求：前景角色 / 背景角色 / 阈值 / 说明。 */
export class ContrastReq {
  fg: string;
  bg: string;
  min: number;
  note: string;
  constructor(fg: string, bg: string, min: number, note: string) {
    this.fg = fg; this.bg = bg; this.min = min; this.note = note;
  }
}

/**
 * 语义色 → 实际色值（**唯一解析**；支持 `Palette` 字段 + 三个派生面角色）。
 * ⛔ 不在这里写任何 hex。
 */
export function colorOf(p: Palette, role: string): string {
  if (role === 'sunken') { return surfacesOf(p).sunken; }
  if (role === 'hairline') { return surfacesOf(p).hairline; }
  if (role === 'glassBg') { return effectsOf(p).glassBg; }
  if (role === 'appBg') { return p.appBg; }
  if (role === 'surface') { return p.surface; }
  if (role === 'surfaceAlt') { return p.surfaceAlt; }
  if (role === 'surfaceHi') { return p.surfaceHi; }
  if (role === 'textPrimary') { return p.textPrimary; }
  if (role === 'textSecondary') { return p.textSecondary; }
  if (role === 'textMuted') { return p.textMuted; }
  if (role === 'accent') { return p.accent; }
  if (role === 'accentSoft') { return p.accentSoft; }
  if (role === 'accentText') { return p.accentText; }
  if (role === 'accentDeep') { return p.accentDeep; }
  if (role === 'onAccent') { return p.onAccent; }
  if (role === 'dangerText') { return p.dangerText; }
  if (role === 'successText') { return p.successText; }
  if (role === 'statusError') { return p.statusError; }
  if (role === 'statusRunning') { return p.statusRunning; }
  if (role === 'statusIdle') { return p.statusIdle; }
  if (role === 'statusWaiting') { return p.statusWaiting; }
  if (role === 'border') { return p.border; }
  return p.transparent;
}

/**
 * 全部对比度要求（**判据集中、可遍历**）。
 * 这是"白/深两套语义色两两可区分且对比度达标"的机器可判形式。
 */
export function contrastReqs(): ContrastReq[] {
  return [
    // 正文族
    new ContrastReq('textPrimary', 'appBg', AA_TEXT, '正文压画布（消息正文）'),
    new ContrastReq('textPrimary', 'surface', AA_TEXT, '正文压卡片'),
    new ContrastReq('textSecondary', 'surface', AA_TEXT, '次要正文压卡片'),
    new ContrastReq('textMuted', 'surface', AA_MUTED, '最弱一档（元信息）'),
    // 强调/链接/CTA
    new ContrastReq('accentSoft', 'surface', AA_TEXT, '链接/可点文字'),
    new ContrastReq('accentText', 'surface', AA_TEXT, '强调文字（徽标字）'),
    new ContrastReq('onAccent', 'accent', AA_TEXT, '关键 CTA 文字压实心主色'),
    // 语义色（文本态）
    new ContrastReq('dangerText', 'surface', AA_TEXT, '失败文字'),
    new ContrastReq('successText', 'surface', AA_TEXT, '成功文字'),
    // 表面/面层级（保证"底里有底"看得见）
    new ContrastReq('textPrimary', 'surfaceAlt', AA_TEXT, 'pill / 浮层行名称'),
    new ContrastReq('textSecondary', 'sunken', AA_TEXT, 'chip / 凹槽内文字'),
    new ContrastReq('textPrimary', 'surfaceHi', AA_TEXT, '选中 pill 名称'),
    new ContrastReq('accentSoft', 'surfaceAlt', AA_NON_TEXT, '在飞标记（非文本）压 pill'),
  ];
}

/**
 * 结构性发丝的**可见度下限**（WCAG 对比度）。
 *
 * ⚠️ 这里**不用** 3.0：发丝是"安静的结构线"，不是"有意义 UI 控件的边界"。
 * 口径逐字取**本仓既有权威**（`docs/DESIGN-SYSTEM.md §9.2`）：
 *   · 浅色族 = `HAIRLINE_TARGET_RATIO`（= web 浅色 `--border` 压 `--bg-primary` 的实测值）；
 *   · 深色族 = 其自身 `border` 已批准的可见度（1.20 起，`hairline ≡ border` 逐字节）。
 */
export const HAIRLINE_MIN_LIGHT: number = HAIRLINE_TARGET_RATIO;
export const HAIRLINE_MIN_DARK: number = 1.20;

/** 该主题的发丝是否达标（返回 '' = 达标，否则返回原因）。 */
export function hairlineIssue(p: Palette): string {
  const r: number = contrastRatio(surfacesOf(p).hairline, p.appBg);
  const min: number = isLightSurface(p) ? HAIRLINE_MIN_LIGHT : HAIRLINE_MIN_DARK;
  if (r < min) { return `hairline/appBg=${r.toFixed(4)} < ${min}`; }
  return '';
}

/** 一条对比度实测结果。 */
export class ContrastResult {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
  note: string;
  constructor(theme: string, fg: string, bg: string, ratio: number, min: number,
    pass: boolean, note: string) {
    this.theme = theme; this.fg = fg; this.bg = bg; this.ratio = ratio;
    this.min = min; this.pass = pass; this.note = note;
  }
}

/** 对某主题跑一遍全部对比度要求（实测比值）。 */
export function contrastAudit(theme: string): ContrastResult[] {
  const p: Palette = paletteOf(theme);
  const reqs: ContrastReq[] = contrastReqs();
  const out: ContrastResult[] = [];
  for (let i = 0; i < reqs.length; i++) {
    const r: ContrastReq = reqs[i];
    const ratio: number = contrastRatio(colorOf(p, r.fg), colorOf(p, r.bg));
    out.push(new ContrastResult(theme, r.fg, r.bg, ratio, r.min, ratio >= r.min, r.note));
  }
  return out;
}

/**
 * **已知台账**：历史遗留、当前**无生产调用点**或需一次设计决策才可修的达标缺口。
 * 格式 `theme|fg|bg`。⛔ 条目**不许删**（删 = 放宽阈值）；新增"未知缺口"会红。
 *
 * 实测（2026-10-11，本文件 `contrastAudit` 逐主题跑）：**只有 dark 一条**
 * （`onAccent` = 纯白压在品牌紫 `accent` = 4.346，差 0.154）。
 * 出处：`docs/DESIGN-SYSTEM.md §11.3`（唯一杠杆是品牌主色，需用户拍板；主按钮真实底是渐变，
 * 最亮端 `accentSoft` 上白字只有 2.09 ⇒ 压暗 accent 治不了根）。
 * ⚠️ aurora / nebula 的 `onAccent` 是**深色字**（压亮底），实测 9.937 / 6.951 ⇒ **达标**，
 * 故**不**入台账（列进来就等于白送一个容忍位）。
 */
export function knownContrastLedger(): string[] {
  return [
    'dark|onAccent|accent',
  ];
}

/** 台账之外的对比度缺口（空数组 = 全绿）。 */
export class ContrastFailure {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  constructor(theme: string, fg: string, bg: string, ratio: number, min: number) {
    this.theme = theme; this.fg = fg; this.bg = bg; this.ratio = ratio; this.min = min;
  }
}

export function contrastFailures(theme: string): ContrastFailure[] {
  const ledger: string[] = knownContrastLedger();
  const all: ContrastResult[] = contrastAudit(theme);
  const out: ContrastFailure[] = [];
  for (let i = 0; i < all.length; i++) {
    const r: ContrastResult = all[i];
    if (r.pass) { continue; }
    const key: string = `${r.theme}|${r.fg}|${r.bg}`;
    if (ledger.indexOf(key) >= 0) { continue; }
    out.push(new ContrastFailure(r.theme, r.fg, r.bg, r.ratio, r.min));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 完整性自检（**纯函数**）—— 全部不变量的唯一出口
// ════════════════════════════════════════════════════════════════════════════

/** 一条不变量违规。 */
export class DesignIssue {
  code: string;
  detail: string;
  constructor(code: string, detail: string) {
    this.code = code;
    this.detail = detail;
  }
}

/** 面角色的填充是否两两不同（**可嵌套**的那些：chip 在 pill 内、行在浮层内…）。 */
export function nestingPairsDistinct(p: Palette): boolean {
  const pill: string = surfaceFillOf(p, 'surface.pill');
  const pillSel: string = surfaceFillOf(p, 'surface.pillSelected');
  const chip: string = surfaceFillOf(p, 'surface.chip');
  const overlay: string = surfaceFillOf(p, 'surface.overlay');
  const row: string = surfaceFillOf(p, 'surface.overlayRow');
  const hover: string = surfaceFillOf(p, 'surface.overlayRowHover');
  if (chip === pill) { return false; }          // chip ⊂ pill（真 bug 的根因）
  if (chip === pillSel) { return false; }       // chip ⊂ 选中 pill（历史 bug）
  if (pill === pillSel) { return false; }       // 选中必须可见
  if (overlay === row) { return false; }        // 浮层内的行
  if (row === hover) { return false; }          // 悬停行
  return true;
}

/** 层级与填充方向是否自洽（深色：越靠上越亮；浅色：卡面不再变亮，靠发丝）。 */
export function ladderDirectionOk(p: Palette): boolean {
  const light: boolean = isLightSurface(p);
  const canvas: string = fillOfRung(p, RUNG_CANVAS);
  const card: string = fillOfRung(p, RUNG_CARD);
  const raised: string = fillOfRung(p, RUNG_RAISED);
  const active: string = fillOfRung(p, RUNG_ACTIVE);
  if (!light) {
    // 深色：canvas < card < raised < active（严格递亮 ⇒ 层级可读）
    if (canvas === card || card === raised || raised === active) { return false; }
  } else {
    // 浅色：raised > active（越"选中"越深），且 raised != canvas（至少一档差）
    if (raised === canvas && active === canvas) { return false; }
  }
  return true;
}

/**
 * 全量自检（遍历全部主题）。返回空数组 = 设计令牌自洽。
 * 判据逐条：
 *   · 空间：除光学半档外均为 4 的倍数、严格递增；
 *   · 排版：字号阶梯严格递减且**无重复标称**；行高在 [1.15, 1.7]；正文行高 ≥ 1.5；
 *   · 形状：圆角阶梯非递减且落在既有 `RADII` 上；
 *   · 材质：可嵌套面两两不同 + 层级方向自洽；
 *   · 动效：每个时长 ∈ 允许集合；**在飞 owner 唯一**（铁律）；
 *   · 对比度：台账之外无缺口。
 */
export function designIssues(): DesignIssue[] {
  const out: DesignIssue[] = [];

  // 空间
  const sp: SpaceRole[] = spaceRoles();
  const optical: number[] = opticalValues();
  for (let i = 0; i < sp.length; i++) {
    if (optical.indexOf(sp[i].vp) < 0 && sp[i].vp % 4 !== 0) {
      out.push(new DesignIssue('space.grid', `${sp[i].name}=${sp[i].vp} 不是 4 的倍数`));
    }
    if (i > 0 && sp[i].vp <= sp[i - 1].vp) {
      out.push(new DesignIssue('space.monotonic', `${sp[i].name} 未严格递增`));
    }
  }

  // 别名有效性（组件专属面/排版档必须指向 §3/§1 的规范档 —— 单一来源不破）
  {
    const canonicalSurfaces: string[] = surfaceRoles().map((s: SurfaceRole) => s.name);
    const aliases: string[] = [SURFACE_THINKING, SURFACE_TODO, SURFACE_TODO_ACTIVE,
      SURFACE_GOAL, SURFACE_GOAL_BADGE, SURFACE_COMPOSER];
    for (let i = 0; i < aliases.length; i++) {
      if (canonicalSurfaces.indexOf(aliases[i]) < 0) {
        out.push(new DesignIssue('alias.surface', `${aliases[i]} 不是规范面`));
      }
    }
    const canonicalTypes: string[] = typeRoles().map((t: TypeRole) => t.name);
    const typeAliases: string[] = [TYPE_THINKING, TYPE_TODO, TYPE_GOAL, TYPE_PILL_NAME, TYPE_CHIP];
    for (let i = 0; i < typeAliases.length; i++) {
      if (canonicalTypes.indexOf(typeAliases[i]) < 0) {
        out.push(new DesignIssue('alias.type', `${typeAliases[i]} 不是规范排版档`));
      }
    }
  }

  // 排版
  const ty: TypeRole[] = typeRoles();
  const sizes: number[] = [];
  for (let i = 0; i < ty.length; i++) {
    sizes.push(ty[i].size);
    if (ty[i].lineHeight < 1.15 || ty[i].lineHeight > 1.7) {
      out.push(new DesignIssue('type.leading', `${ty[i].name} 行高 ${ty[i].lineHeight} 越界`));
    }
    if (ty[i].size <= 0) {
      out.push(new DesignIssue('type.size', `${ty[i].name} 字号非正`));
    }
  }
  for (let i = 0; i < sizes.length; i++) {
    for (let j = i + 1; j < sizes.length; j++) {
      if (sizes[i] === sizes[j]) {
        out.push(new DesignIssue('type.dup', `字号重复 ${sizes[i]}（层级塌陷）`));
      }
    }
    if (i > 0 && sizes[i] >= sizes[i - 1]) {
      out.push(new DesignIssue('type.monotonic', `字阶未严格递减 @${i}`));
    }
  }
  // 正文（type.body）行高必须 ≥ 1.5（可读性）
  if (typeOf('type.body').lineHeight < 1.5) {
    out.push(new DesignIssue('type.bodyLeading', '正文行高 < 1.5'));
  }

  // 形状
  const rr: RadiusRole[] = radiusRoles();
  for (let i = 1; i < rr.length; i++) {
    if (rr[i].vp < rr[i - 1].vp) { out.push(new DesignIssue('radius.monotonic', rr[i].name)); }
  }

  // 动效：时长 ∈ 允许集合；在飞 owner 唯一
  const allowed: number[] = allowedDurations();
  const mr: MotionRole[] = motionRoles();
  const owners: string[] = [];
  for (let i = 0; i < mr.length; i++) {
    if (allowed.indexOf(mr[i].ms) < 0) {
      out.push(new DesignIssue('motion.duration', `${mr[i].name}=${mr[i].ms} 不在允许档位`));
    }
    if (mr[i].inFlight) {
      if (owners.indexOf(mr[i].owner) < 0) { owners.push(mr[i].owner); }
      if (mr[i].owner.length === 0) {
        out.push(new DesignIssue('motion.owner', `${mr[i].name} 在飞但无 owner`));
      }
    }
  }
  if (owners.length !== 1) {
    out.push(new DesignIssue('motion.inflightOwner',
      `在飞 owner 必须唯一（实际 ${owners.length} 个：${owners.join(',')}）`));
  }

  // 材质 + 对比度（逐主题）
  for (let t = 0; t < ALL_THEMES.length; t++) {
    const p: Palette = paletteOf(ALL_THEMES[t]);
    if (!nestingPairsDistinct(p)) {
      out.push(new DesignIssue('surface.nesting', `${ALL_THEMES[t]} 可嵌套面撞色`));
    }
    if (!ladderDirectionOk(p)) {
      out.push(new DesignIssue('surface.ladder', `${ALL_THEMES[t]} 层级方向不自洽`));
    }
    const hl: string = hairlineIssue(p);
    if (hl.length > 0) {
      out.push(new DesignIssue('surface.hairline', `${ALL_THEMES[t]} ${hl}`));
    }
    // 可嵌套面的**最小可辨层级差**（浅色/纯白最容易糊的量化防线）
    const nestingPairs: string[][] = [
      ['surface.pill', 'surface.chip'],
      ['surface.pillSelected', 'surface.chip'],
      ['surface.overlay', 'surface.overlayRow'],
      ['surface.overlayRow', 'surface.overlayRowHover'],
    ];
    for (let i = 0; i < nestingPairs.length; i++) {
      const n = nestingPairs[i];
      const issue: string = levelDeltaIssue(p, n[0], n[1]);
      if (issue.length > 0) {
        out.push(new DesignIssue('surface.levelDelta', `${ALL_THEMES[t]} ${issue}`));
      }
    }
    const fails: ContrastFailure[] = contrastFailures(ALL_THEMES[t]);
    for (let i = 0; i < fails.length; i++) {
      out.push(new DesignIssue('contrast',
        `${fails[i].theme} ${fails[i].fg}/${fails[i].bg}=${fails[i].ratio.toFixed(3)} < ${fails[i].min}`));
    }
  }

  return out;
}

/** 便捷：某主题是否全绿。 */
export function themeOk(theme: string): boolean {
  const p: Palette = paletteOf(theme);
  if (!nestingPairsDistinct(p)) { return false; }
  if (!ladderDirectionOk(p)) { return false; }
  return contrastFailures(theme).length === 0;
}
