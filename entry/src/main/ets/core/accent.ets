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
// ⚠️ ArkTS `arkts-no-misplaced-imports`：**所有** import 必须在其它语句之前 ⇒ 本行不能下移。
import { DEFAULT_ACCENT as ACCENT_DEFAULT, normalizeAccent as accentNormalize, parseHex as accentParseHex } from './theme';

/**
 * ⚠️ 2026-10-11：强调色家族叠加的**数学**已下沉到 `core/theme.ets`（因为必须在唯一取色入口
 * `paletteOf` 上生效；而本文件 import theme，不能反向 import）。这里**原样再导出**，
 * 既有 `import { ... } from '../core/accent'` 全部不变。
 */
export {
  DEFAULT_ACCENT,
  withAccent,
  normalizeAccent,
  parseHex,
  lighten,
  darken,
  contrastForeground,
} from './theme';

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

/**
 * 规范化成 `#RRGGBB`；**非法返回 `null`**（对齐 web `SettingsAppearance.tsx:43-52` 的 `normalizeHex`）。
 *
 * 为什么与 `normalizeAccent` 并存：`normalizeAccent` 是"读服务端值"的**回落**口径（垃圾值 ⇒ 默认强调色），
 * 而**自定义 hex 输入框**需要区分"用户还没输完"与"输错了" ⇒ 非法必须是 `null`（UI 据此显示错误、**不写**服务端）。
 * 判据与渲染同源：输入框的合法性判定**只**调本函数，⛔ 不在组件里另写一份正则。
 */
export function normalizeAccentOrNull(v: string | undefined): string | null {
  if (v === undefined) { return null; }
  if (accentParseHex(v) === null) { return null; }
  return accentNormalize(v);
}

/** 默认强调色（web `DEFAULT_ACCENT_COLOR`）—— 供本文件内引用，避免命名冲突。 */
export const DEFAULT_ACCENT_FALLBACK: string = ACCENT_DEFAULT;
