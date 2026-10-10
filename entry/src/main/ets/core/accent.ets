/**
 * 强调色（accent）—— 逐字对齐 web `src/components/settings/SettingsAppearance.tsx` +
 * `src/types/theme.ts`（`DEFAULT_ACCENT_COLOR = '#3388BB'`、`ACCENT_PRESETS`）。
 *
 * 设计纪律：强调色**只覆盖 accent 家族**（accent/accentHover/accentSoft/accentText/onAccent），
 * 其余角色（底/面/文字/边框）保持主题原样 —— 这样"换强调色"不会破坏已建立的亮度阶梯。
 *
 * 纯函数、无 SDK 依赖 ⇒ 可脱机单测（`tools/tests/accent.test.ts`）。
 */
import { Palette } from './theme';

/** web `DEFAULT_ACCENT_COLOR`。 */
export const DEFAULT_ACCENT: string = '#3388BB';

/** web `ACCENT_PRESETS`（顺序保持一致）。 */
export const ACCENT_PRESETS: string[] = ['#3388BB', '#2563EB', '#7C3AED', '#DC2626', '#059669', '#EA580C'];

/** 强调色显示名（给设置面板的色板加无障碍标签）。 */
export function accentLabel(hex: string): string {
  const h: string = hex.toUpperCase();
  if (h === '#3388BB') { return '湖蓝'; }
  if (h === '#2563EB') { return '靛蓝'; }
  if (h === '#7C3AED') { return '紫罗兰'; }
  if (h === '#DC2626') { return '朱红'; }
  if (h === '#059669') { return '翠绿'; }
  if (h === '#EA580C') { return '橙'; }
  return hex;
}

function hexDigit(n: number): string {
  const d: string = '0123456789ABCDEF';
  let v: number = Math.round(n);
  if (v < 0) { v = 0; }
  if (v > 255) { v = 255; }
  return `${d.charAt(Math.floor(v / 16))}${d.charAt(v % 16)}`;
}

/** 解析 `#rgb` / `#rrggbb` / 无 `#` ⇒ `{r,g,b}`；非法返回 null。 */
export function parseHex(input: string): number[] | null {
  let h: string = input.trim();
  if (h.length === 0) { return null; }
  if (h.charAt(0) === '#') { h = h.slice(1); }
  if (h.length === 3) {
    h = `${h.charAt(0)}${h.charAt(0)}${h.charAt(1)}${h.charAt(1)}${h.charAt(2)}${h.charAt(2)}`;
  }
  if (h.length !== 6) { return null; }
  const digits: string = '0123456789abcdefABCDEF';
  for (let i = 0; i < 6; i++) {
    if (digits.indexOf(h.charAt(i)) < 0) { return null; }
  }
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  return `#${hexDigit(r)}${hexDigit(g)}${hexDigit(b)}`;
}

/** 规范化成 `#RRGGBB`；非法回落 `DEFAULT_ACCENT`（对齐 web 的 normalizeHex + 回落）。 */
export function normalizeAccent(v: string | undefined): string {
  if (v === undefined) { return DEFAULT_ACCENT; }
  const rgb: number[] | null = parseHex(v);
  if (rgb === null) { return DEFAULT_ACCENT; }
  return toHex(rgb[0], rgb[1], rgb[2]);
}

/** 变亮（向白插值，t∈[0,1]）—— 对齐 web `lighten(color, 0.12)`。 */
export function lighten(hex: string, t: number): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return hex; }
  const k: number = t < 0 ? 0 : (t > 1 ? 1 : t);
  return toHex(rgb[0] + (255 - rgb[0]) * k, rgb[1] + (255 - rgb[1]) * k, rgb[2] + (255 - rgb[2]) * k);
}

/** 变暗（向黑插值，t∈[0,1]）—— 对齐 web `darken(color, 0.1)`。 */
export function darken(hex: string, t: number): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return hex; }
  const k: number = t < 0 ? 0 : (t > 1 ? 1 : t);
  return toHex(rgb[0] * (1 - k), rgb[1] * (1 - k), rgb[2] * (1 - k));
}

/** 对比前景色（黑或白）—— 对齐 web `contrastForeground`（用的相对亮度阈值）。 */
export function contrastForeground(hex: string): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return '#FFFFFF'; }
  // 感知亮度（ITU-R BT.601）
  const lum: number = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return lum > 150 ? '#0B0B0E' : '#FFFFFF';
}

/**
 * 把强调色套到色板上：**只覆盖 accent 家族**，其余角色原样返回。
 *
 * @param p   主题色板（`paletteOf(themeName)`）
 * @param hex 强调色（会先 `normalizeAccent`）
 * @param isDark 深色系主题（决定 hover 是变亮还是变暗，对齐 web）
 */
export function withAccent(p: Palette, hex: string, isDark: boolean): Palette {
  const a: string = normalizeAccent(hex);
  const next: Palette = new Palette();
  next.appBg = p.appBg;
  next.surface = p.surface;
  next.surfaceAlt = p.surfaceAlt;
  next.surfaceHi = p.surfaceHi;
  next.textPrimary = p.textPrimary;
  next.textSecondary = p.textSecondary;
  next.textMuted = p.textMuted;
  next.accent = a;
  next.accentHover = isDark ? lighten(a, 0.12) : darken(a, 0.1);
  next.accentSoft = isDark ? lighten(a, 0.45) : darken(a, 0.18);
  next.accentSoftFade = `#00${a.slice(1)}`;
  next.accentDeep = isDark ? darken(a, 0.62) : lighten(a, 0.78);
  next.accentText = isDark ? lighten(a, 0.6) : darken(a, 0.22);
  next.onAccent = contrastForeground(a);
  next.bubbleUser = isDark ? darken(a, 0.18) : a;
  next.border = p.border;
  next.borderStrong = p.borderStrong;
  next.success = p.success;
  next.successText = p.successText;
  next.warn = p.warn;
  next.warnBg = p.warnBg;
  next.dangerBg = p.dangerBg;
  next.dangerText = p.dangerText;
  next.transparent = p.transparent;
  return next;
}
