/**
 * 工具 pill 的**视觉解析**（纯逻辑，可脱机单测）—— 把 `core/toolstatus` 的**语义档**
 * 映射成一组**渲染 token**（形态档 / 状态色 / 名称色 / chip 底色 / pill 底色 / 在飞柔影）。
 *
 * 为什么单独成模块（两个理由）：
 *  1. **可测**：`components/ToolVisual.ets` 是 ArkUI 文件（`tools/tests/run.sh` 不编译它）
 *     ⇒ 视觉解析无法单测。搬到 `core/` 后即可断言"pending 的 chip 底色 ≠ pill 底色"
 *     "done 无在飞柔影"这类**不变量**（本仓纪律：判据/渲染同源，且要有判别力测试）。
 *  2. **性能**：`paletteOf/effectsOf` 每次都 `new Palette()/new Effects()`（**无记忆化**）——
 *     一枚 pill 的 build 里原本要构造 ~5 个色板对象。这里按**主题名**记忆化（色板是纯函数，
 *     主题名唯一决定取值）⇒ 稳态下 0 次构造。
 *
 * ⛔ 本模块**只做映射**，不含任何判据：语义档一律来自 `core/toolstatus`（`kind` 已由调用方算好）。
 * ⛔ 不许在此新增任何**动效**（本仓铁律：同一时刻只允许一个在飞动效 = 光球；
 *    `docs/DESIGN-SYSTEM.md §8`「工具 pill 不重复表达'整机在跑'」）。
 */
import { Palette, paletteOf, Effects, effectsOf, isLightPalette } from './theme';
import {
  ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS, ST_ERROR, statusColorRole,
} from './toolstatus';

/** 在飞 pill 的柔影半径（vp）—— 浅色系用它把"在飞"读作悬浮卡片而非发光体。 */
export const PILL_LIVE_GLOW_RADIUS: number = 12;

/** 状态标记槽边长（vp）——**恒定**是"所有 pill 的图标/名字左对齐"的前提（web 实测要求）。 */
export const PILL_MARKER_SLOT: number = 14;

// ── 主题 → Palette / Effects 记忆化（纯函数；主题名唯一决定取值）───────────────
const PALETTE_MEMO: Map<string, Palette> = new Map<string, Palette>();
const EFFECTS_MEMO: Map<string, Effects> = new Map<string, Effects>();

/** 取色板（记忆化）—— 等价 `paletteOf(theme)`，但同一主题只构造一次。 */
export function paletteMemo(theme: string): Palette {
  const hit: Palette | undefined = PALETTE_MEMO.get(theme);
  if (hit !== undefined) { return hit; }
  const p: Palette = paletteOf(theme);
  PALETTE_MEMO.set(theme, p);
  return p;
}

/** 取效果 token（记忆化）—— 等价 `effectsOf(paletteOf(theme))`，同一主题只构造一次。 */
export function effectsMemo(theme: string): Effects {
  const hit: Effects | undefined = EFFECTS_MEMO.get(theme);
  if (hit !== undefined) { return hit; }
  const e: Effects = effectsOf(paletteMemo(theme));
  EFFECTS_MEMO.set(theme, e);
  return e;
}

/**
 * 语义档 → 主题内的**语义色**（全项目唯一映射）。
 *
 * ⛔ 判据来自 `core/toolstatus.statusColorRole`（唯一）；本函数只是把 role 按**主题**取色。
 *    `pending` ⇒ `muted`（安静，**不是** accent）——曾落到 accent ⇒ 排队态"颜色说在飞、
 *    文案说排队"（真机物证：虚线空心 + accent 蓝 chip + 「排队」三信号打架）。
 */
export function statusColorOf(kind: string, theme: string): string {
  const p: Palette = paletteMemo(theme);
  const role: string = statusColorRole(kind);
  if (role === ROLE_DANGER) { return p.dangerText; }
  if (role === ROLE_SUCCESS) { return p.successText; }
  if (role === ROLE_MUTED) { return p.textMuted; }
  return p.accentSoft;   // accent：running / generating（需要注意力）
}

/** 名称色：失败=红（吵闹，是它的语义）；其余=中性前景（**成功要安静**）。 */
export function pillTextColorOf(kind: string, theme: string): string {
  return kind === ST_ERROR ? paletteMemo(theme).dangerText : paletteMemo(theme).textPrimary;
}

/** pill 底色：选中（浮层打开的那一枚）提亮一档。 */
export function pillBgOf(kind: string, selected: boolean, theme: string): string {
  const p: Palette = paletteMemo(theme);
  return selected ? p.surfaceHi : p.surfaceAlt;
}

/**
 * chip 底色 —— **必须与该 pill 的底色互不相同**。
 *
 * ⛔ 历史缺陷：chip 底色曾恒为 `surfaceHi`，而**选中** pill 的底色也是 `surfaceHi`
 *    ⇒ chip 与 pill 同色 ⇒ 浮层打开时 chip「消失」（只剩彩色文字）。
 *    修法：选中态用 `surfaceAlt`（与 `surfaceHi` 互异，且在所有主题里方向仍可辨）。
 */
export function chipBgOf(kind: string, selected: boolean, theme: string): string {
  const p: Palette = paletteMemo(theme);
  return selected ? p.surfaceAlt : p.surfaceHi;
}

/**
 * 在飞柔影色（**唯一的主题分叉点**）。
 *
 * 深色系走 `effectsOf().glow`（accent@45% 的彩色外发光 = "在飞"的高级感来源）；
 * 浅色系走 `elev2`（正文色相 @10% 的**中性柔影**）—— 45% 饱和色晕压在白卡边上会读成"脏"，
 * 正是用户要的"干净"的反面。**判据用 `isLightPalette`（按 appBg 感知亮度），不按主题名硬判**。
 */
export function glowColorOf(kind: string, live: boolean, theme: string): string {
  const p: Palette = paletteMemo(theme);
  if (!live) { return p.transparent; }
  return isLightPalette(p) ? effectsMemo(theme).elev2 : effectsMemo(theme).glow;
}

/**
 * 一枚 pill 的**全部渲染 token**（由 `kind` + `live` + `selected` + `theme` 唯一决定）。
 * 组件层只读它 ⇒ 形态/色/文案色/底色/柔影**结构上不可能分叉**。
 */
export interface PillVisual {
  /** 形态档（= 语义档；组件据此选"勾/叉/减号/虚线圆/spinner"）。 */
  marker: string;
  /** 状态标记 & chip 文字色（同一个值 ⇒ 两者不可能异色）。 */
  accent: string;
  /** 名称色（中性为主；只有失败才红）。 */
  textColor: string;
  /** pill 底色（选中提亮一档）。 */
  pillBg: string;
  /** chip 底色（**恒 ≠ pillBg**）。 */
  chipBg: string;
  /** 在飞柔影半径（0 = 无柔影）。 */
  glowRadius: number;
  /** 在飞柔影色。 */
  glowColor: string;
}

/** 解析一枚 pill 的全部渲染 token（纯函数）。 */
export function pillVisual(kind: string, live: boolean, selected: boolean,
  theme: string): PillVisual {
  const v: PillVisual = {
    marker: kind,
    accent: statusColorOf(kind, theme),
    textColor: pillTextColorOf(kind, theme),
    pillBg: pillBgOf(kind, selected, theme),
    chipBg: chipBgOf(kind, selected, theme),
    glowRadius: live ? PILL_LIVE_GLOW_RADIUS : 0,
    glowColor: glowColorOf(kind, live, theme),
  };
  return v;
}
