/**
 * 语义色板（**全应用唯一颜色来源**）+ 多套主题色板 + 视觉手段 / 效果 token。
 *
 * 为什么必须先做这一步：改造前有 378 处硬编码颜色字面量散落在页面与组件里，
 * 直接"换个背景色"会得到一半深一半浅的破碎界面。正确做法是把颜色按**角色**收敛
 * （背景/卡片/正文/次要/边框/强调/成功/警告/危险），主题只决定这套角色的取值，
 * 换主题 = 换色板，不碰任何布局代码。
 *
 * 判据（可量化）：`theme.ets` 之外不再出现 `#RRGGBB` 字面量。
 *
 * 2026-10-10 扩展（不改既有 23 角色的取值/语义）：
 *  - 新增 `accentHover`（web `--accent-hover`）—— 唯一新增的**语义颜色角色**；
 *  - 新增两套霓虹深空主题 `aurora`（极光，主色 #34d3b4）/ `nebula`（星云，主色 #a78bfa），
 *    数值逐字取自 `.research/design-system.md` 的 xbot-aurora / xbot-nebula 表；
 *  - 新增 `Effects`（玻璃/光晕/渐变/层级）—— 由色板**派生**，跨主题自动一致，故单列结构
 *    （glassBlur 是数值，无法混进全 string 的 Palette）。
 *
 * 2026-10-11 扩展（**不改任何既有角色的取值** —— `darkPalette()`..`porcelainPalette()` 五套色板
 * 与 `paletteValues` 一字未动；只新增**派生结构**）：
 *  - 新增 `Surfaces`（`surfacesOf`）：补三处**语义缺失**，消掉"白色主题不割裂"的结构性根因 ——
 *    ① `hairline` 结构性发丝（浅色系从 `border` 压深到 `HAIRLINE_TARGET_RATIO`；深色族 = `border` 逐字节）；
 *    ② `sunken` 下沉内容面（**替代**历史上把阴影色 `Effects.elev1` 当块底色的误用，逐公式等价）；
 *    ③ `glassBase` 玻璃底基色（浅色系 `surface == appBg` 时改用 `surfaceAlt`，
 *       否则白底上玻璃面板恒等不可见 —— `effectsOf.glassBg` 已改用它）。
 *    ⚠️ 为什么进派生结构而不是 `Palette` 字段：`core/accent.ets` 的 `withAccent()` 逐字段复制，
 *    加字段会让"换强调色后的色板"多出空字段（`tools/tests/accent.test.ts:80` 会红）。详见 `Surfaces` 注释。
 *  - 门禁：`tools/tests/theme_contrast.test.ts`（WCAG 2.1）已把这三个角色纳入矩阵与台账。
 */

/** 一套语义色板。字段名就是"用途"，不是"颜色"—— 这样浅色主题才可能正确。 */
import {
  SHADOW_RADIUS_CARD, SHADOW_RADIUS_OVERLAY, SHADOW_RADIUS_HERO,
  SHADOW_RADIUS_RAISED, SHADOW_RADIUS_PILL, SHADOW_RADIUS_PANEL,
  SHADOW_RADIUS_DRAWER, LIGHT_SHADOW_DIFFUSION,
} from './tokens';

export class Palette {
  /** 最底背景（页面） */
  appBg: string = '';
  /** 卡片/输入框底色 */
  surface: string = '';
  /** 次级卡片底色（菜单项、pill） */
  surfaceAlt: string = '';
  /** 选中/高亮底色 */
  surfaceHi: string = '';
  /** 正文 */
  textPrimary: string = '';
  /** 次要文字 */
  textSecondary: string = '';
  /** 更弱的说明文字 */
  textMuted: string = '';
  /** 最弱一档文字（web `--foreground-3`）—— 时间戳/占位等"几乎不该被读到"的层级 */
  foreground3: string = '';
  /** 强调色背景（主按钮） */
  accent: string = '';
  /** 强调色的 hover 态（web `--accent-hover`） */
  accentHover: string = '';
  /** 强调色的浅色形态（链接、可点文字） */
  accentSoft: string = '';
  /** 强调色浅形态的**全透明**版本（流光/渐变的两端；跨主题都不突兀） */
  accentSoftFade: string = '';
  /** 强调色的深色形态（徽标/标签） */
  accentDeep: string = '';
  /** 强调色上的文字（标签内文字） */
  accentText: string = '';
  /** 主按钮上的文字 */
  onAccent: string = '';
  /** 用户气泡底色 */
  bubbleUser: string = '';
  /** 边框 */
  border: string = '';
  /** 更明显的边框（次要按钮） */
  borderStrong: string = '';
  /** 成功/开启 */
  success: string = '';
  /** 成功文字 */
  successText: string = '';
  /** 警告/注意 */
  warn: string = '';
  /** 警告底色（提示条） */
  warnBg: string = '';
  /** 危险按钮底 */
  dangerBg: string = '';
  /** 危险文字/图标 */
  dangerText: string = '';
  /** 运行中（web `--status-running`）—— 工具/进程"在飞"的语义色 */
  statusRunning: string = '';
  /** 等待/排队中（web `--status-waiting`） */
  statusWaiting: string = '';
  /** 空闲/已停（web `--status-idle`） */
  statusIdle: string = '';
  /** 出错（web `--status-error`，比 dangerText 更"状态机"） */
  statusError: string = '';
  /** 完全透明的占位（拱形/分隔用） */
  transparent: string = '';
}

export const THEME_DARK: string = 'dark';
export const THEME_LIGHT: string = 'light';
/** 霓虹深空：极光（极夜底 + 青绿，web xbot-aurora）。 */
export const THEME_AURORA: string = 'aurora';
/** 霓虹深空：星云（紫黑深空 + 霓虹紫，web xbot-nebula）。 */
export const THEME_NEBULA: string = 'nebula';
/** 极简白（**原生独享**，无 web 对应）：纯白画布 + 中性灰阶 + 极淡发丝 + 低透明扩散柔影。 */
export const THEME_PORCELAIN: string = 'porcelain';

/** 全部内置主题（测试用；顺序 = 展示顺序）。 */
export const ALL_THEMES: string[] = [THEME_DARK, THEME_LIGHT, THEME_AURORA, THEME_NEBULA, THEME_PORCELAIN];

// ════════════════════════════════════════════════════════════════════════════
// 强调色叠加（2026-10-11 从 `core/accent.ets` **下沉**到本文件）
//
// 为什么下沉：强调色必须在**唯一取色入口** `paletteOf` 上生效（否则 40 个组件共 80 处
// `paletteOf(this.theme)` 拿不到覆盖 —— 真机实证的「标签写湖蓝、按钮仍紫」）。
// 而 `accent.ets` import 本文件（不能反向 import）⇒ 这段数学必须住在本文件。
// `core/accent.ets` 仍**原样再导出**这些名字（既有 import 全部不变）。
// ════════════════════════════════════════════════════════════════════════════

/** web `types/theme.ts` 的 `DEFAULT_ACCENT_COLOR`。 */
export const DEFAULT_ACCENT: string = '#3388BB';

function accentHexDigit(n: number): string {
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

function toHexTriple(r: number, g: number, b: number): string {
  return `#${accentHexDigit(r)}${accentHexDigit(g)}${accentHexDigit(b)}`;
}

/** 规范化成 `#RRGGBB`；非法回落 `DEFAULT_ACCENT`（对齐 web 的 normalizeHex + 回落）。 */
export function normalizeAccent(v: string | undefined): string {
  if (v === undefined) { return DEFAULT_ACCENT; }
  const rgb: number[] | null = parseHex(v);
  if (rgb === null) { return DEFAULT_ACCENT; }
  return toHexTriple(rgb[0], rgb[1], rgb[2]);
}

/** 变亮（向白插值，t∈[0,1]）—— 对齐 web `lighten(color, 0.12)`。 */
export function lighten(hex: string, t: number): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return hex; }
  const k: number = t < 0 ? 0 : (t > 1 ? 1 : t);
  return toHexTriple(rgb[0] + (255 - rgb[0]) * k, rgb[1] + (255 - rgb[1]) * k, rgb[2] + (255 - rgb[2]) * k);
}

/** 变暗（向黑插值，t∈[0,1]）—— 对齐 web `darken(color, 0.1)`。 */
export function darken(hex: string, t: number): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return hex; }
  const k: number = t < 0 ? 0 : (t > 1 ? 1 : t);
  return toHexTriple(rgb[0] * (1 - k), rgb[1] * (1 - k), rgb[2] * (1 - k));
}

/** 对比前景色（黑或白）—— 对齐 web `contrastForeground`（用的相对亮度阈值）。 */
export function contrastForeground(hex: string): string {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) { return '#FFFFFF'; }
  // ⛔ **不再用 BT.601 的 `lum > 150` 二值阈值**（2026-10-11 实测：它**不保证 AA** —— 强调色叠加后
  //    `onAccent` 压 `accent` 有 **15 组**只有 **3.5–3.9**，例 `porcelain + #3388BB = 3.90`：
  //    因 BT.601 亮度与实际对比度非线性，阈值附近会选错候选）。
  // ⇒ 改为**在"深/浅两候选"中取对比度更高者**：口径 = WCAG 相对亮度（由 `contrastRatio` 实现，
  //    与全仓对比度判据**同源**），数学上**必然是两候选里的最优解**，且随 accent **连续**、无阈值跳变。
  // ⚠️ 候选与旧实现**同值**（`#0B0B0E` / `#FFFFFF`）⇒ 不是新造色值；只改"怎么选"。
  return contrastRatio(hex, FOREGROUND_CANDIDATE_DARK) >= contrastRatio(hex, '#FFFFFF')
    ? FOREGROUND_CANDIDATE_DARK
    : '#FFFFFF';
}

/** 前景候选（深/浅）——与旧 `contrastForeground` 的返回值**同值**，仅显式具名。 */
const FOREGROUND_CANDIDATE_DARK: string = '#0B0B0E';

/**
 * 把强调色套到色板上：**只覆盖 accent 家族**，其余角色原样返回。
 *
 * @param p   主题色板（`buildPalette` 的产物）
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
  next.foreground3 = p.foreground3;
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
  next.statusRunning = p.statusRunning;
  next.statusWaiting = p.statusWaiting;
  next.statusIdle = p.statusIdle;
  next.statusError = p.statusError;
  next.transparent = p.transparent;
  return next;
}

/** 深空仪表盘（dark）：**单一紫色系** + 每级约 8% 的真实亮度阶梯。
 *  设计纪律：底色与主色同色相（紫），不再 navy 底配紫主色；
 *  accentSoft 走紫（原先的浅蓝 #93C5FD 是蓝紫打架的根源）；
 *  border 与 surfaceHi 必须区分（原先是同一个 #1F2937）。 */
export function darkPalette(): Palette {
  const p: Palette = new Palette();
  p.appBg = '#0B0B0E';        // L0 画布（最深）
  p.surface = '#0E0E14';      // L1 面板
  p.surfaceAlt = '#14141C';   // L2 卡片 / 胶囊
  p.surfaceHi = '#1D1D28';    // L3 悬停 / 选中
  p.textPrimary = '#EDEDF2';
  p.textSecondary = '#9A9AAB';
  p.textMuted = '#63636F';
  p.foreground3 = '#4F4F4F';   // web dark --foreground-3（最弱一档）
  p.accent = '#7C5CFF';       // 唯一主色（紫）
  p.accentHover = '#8F73FF';
  p.accentSoft = '#B9A7FF';   // 紫系浅色（次级图标/文字统一用它）
  p.accentSoftFade = '#00B9A7FF';
  p.accentDeep = '#2A1F5C';   // 轨道/底色填充
  p.accentText = '#C9BCFF';
  p.onAccent = '#FFFFFF';
  p.bubbleUser = '#5B3FE0';
  p.border = '#20202B';       // 发丝线（可见但安静）
  p.borderStrong = '#2E2E3C';
  p.success = '#3DD68C';
  p.successText = '#86EFC4';
  p.warn = '#E8B44A';
  p.warnBg = '#241C0E';
  p.dangerBg = '#B03A3A';
  p.dangerText = '#FF7B7B';
  // web dark `--status-*`（逐值对齐 index.css）
  p.statusRunning = '#3388BB';
  p.statusWaiting = '#E6A700';
  p.statusIdle = '#858585';
  p.statusError = '#F48771';
  p.transparent = '#00000000';
  return p;
}

/** 浅色（同角色、反相取值；对比度按 WCAG AA 目标约 4.5:1 选值）。 */
export function lightPalette(): Palette {
  const p: Palette = new Palette();
  p.appBg = '#F8FAFC';
  p.surface = '#FFFFFF';
  p.surfaceAlt = '#F1F5F9';
  p.surfaceHi = '#E2E8F0';
  p.textPrimary = '#0F172A';
  p.textSecondary = '#475569';
  p.textMuted = '#94A3B8';
  p.foreground3 = '#BBBBBB';  // web light --foreground-3
  p.accent = '#6D28D9';
  p.accentHover = '#5B21B6';
  p.accentSoft = '#1D4ED8';
  p.accentSoftFade = '#001D4ED8';
  p.accentDeep = '#EDE9FE';
  p.accentText = '#5B21B6';
  p.onAccent = '#FFFFFF';
  p.bubbleUser = '#5B3FE0';   // 品牌紫：与深色保持一致（两种主题下合法相同的 3 处之一）
  p.border = '#E2E8F0';
  p.borderStrong = '#CBD5E1';
  p.success = '#047857';
  p.successText = '#065F46';
  p.warn = '#92400E';
  p.warnBg = '#FEF3C7';
  p.dangerBg = '#DC2626';
  p.dangerText = '#B91C1C';
  // web light `--status-*`（逐值对齐 index.css）
  p.statusRunning = '#3388BB';
  p.statusWaiting = '#E6A700';
  p.statusIdle = '#6B6B6B';
  p.statusError = '#D1242F';
  p.transparent = '#00000000';
  return p;
}

/**
 * ── 霓虹深色系的 `accentDeep`：`#04473a`(aurora) / `#4a1998`(nebula)（2026-10-11 波 C）──────
 * 背景：这两套的 `accentDeep` 原是"accent 压暗一档"（aurora `#0f8b73` L=0.198 /
 * nebula `#6d28d9` L=0.098），却被当**徽标/标签底**承载三处**真实**生产文字：
 *   · `textPrimary` —— `pages/Index.ets`「回到最新」pill（12fp，阈值 4.5）
 *   · `accentText`  —— `components/SettingsRows.ets`「默认」徽标 + `components/ToolPopover.ets` hunk 标记（阈值 4.5）
 *   · `textMuted`   —— `components/ToolPopover.ets` hunk 尾注（10fp，阈值 2.0）
 * 现值实测：aurora `textMuted` **1.07** / `accentText` 3.09 / `textPrimary` 3.33；
 *           nebula `textMuted` **1.77** / `accentText` 3.85 —— 三处都读不出来（对比度台账根因 C）。
 *
 * 取值口径（**两条约束一起解**，与 porcelain.textMuted 那次同法；阈值一个都没放宽）：
 *  · 约束 ①（不许更亮 = 可读性）：三条真实落点全部达标，且**最紧的一条**要留出与门禁 §F2 同
 *    刻度的**绝对余量 0.15** ⇒ 最紧 = `textMuted ≥ 2.15` ⇒ 亮度上界 `L ≤ 0.0740`(aurora) / `0.0718`(nebula)。
 *  · 约束 ②（不许更暗 = 填充仍可辨）：`accentDeep` 是**填充**，压过头会从卡片上消失。地板取
 *    **dark 主题已批准的徽标底**（`#2A1F5C` 压 dark.surfaceAlt `#14141C` = **1.2638**，WCAG 对比度）
 *    —— "不差于已批准观感"，不是新造尺度 ⇒ 亮度下界 `L ≥ 0.0284`(aurora) / `0.0229`(nebula)。
 *  · 窗口 = aurora `[0.0284, 0.0740]` / nebula `[0.0229, 0.0718]`；取**余量归一化最优的中点**：
 *      aurora `#04473a`（L=0.0484）：`textMuted` 2.710(+25%)、`accentText` 7.795、`textPrimary` 8.400、
 *                                    对 `surfaceAlt` 1.5817 / 对 `surface` 1.7263（均 ≥ 地板 1.2638）
 *      nebula `#4a1998`（L=0.0442）：`textMuted` 2.782(+29%)、`accentText` 6.039、`textPrimary` 9.082、
 *                                    对 `surfaceAlt` 1.6333 / 对 `surface` 1.7401
 *  ⚠️ 色相**不变**：取值 = 把原值在线性空间整体压深到目标亮度（三通道同比 ⇒ 保色相）。
 *  ⛔ 唯一改不掉的：`onAccent|accentDeep`（`#04150f`/`#150a2b` 是**深色字**，角色定义是"压在**实心**
 *    accent 上"）——它要 `accentDeep` **够亮**（L ≥ 0.20）才达标，与约束 ①**直接冲突** ⇒ **窗口为空，
 *    压暗无解**。该组合当前**无生产调用点**（唯一曾用它的一处已改用 `accentText`，见 `Index.ets`
 *    选中会话标签），台账保留当**回归护栏**；真要修在**消费者侧**（别把 `onAccent` 压在 accentDeep 上）。
 *  ⚠️ 本改动是**叶子**：`accentDeep` 不喂 `Effects`/`Surfaces`/`hairline`/`sunken` 任何派生
 *    ⇒ 这两套主题其余 27 个角色**逐字节不变**（门禁 §H4 逐值断言）。
 */

/**
 * 极光（xbot-aurora）：极夜底 + 青绿主色。
 * 关键色值**逐字**采用 `.research/design-system.md` 的 xbot-aurora 表（源表为小写 hex，故此处保持小写）。
 * 映射：bg-primary→appBg · bg-secondary→surface · bg-tertiary→surfaceAlt ·
 *       border/border-strong→border/borderStrong · text-*→text* ·
 *       md-link→accentSoft · accent→accent · accent-hover→accentHover · accent-fg→onAccent。
 */
export function auroraPalette(): Palette {
  const p: Palette = new Palette();
  p.appBg = '#070c16';        // --bg-primary
  p.surface = '#0b1424';      // --bg-secondary
  p.surfaceAlt = '#111d31';   // --bg-tertiary
  p.surfaceHi = '#17253c';    // 派生（tertiary 提亮一档）
  p.textPrimary = '#d7e6f5';  // --text-primary
  p.textSecondary = '#9fb6cc'; // --text-secondary
  p.textMuted = '#6b8399';    // --text-muted
  p.foreground3 = '#47586b';  // 派生（textMuted 再压暗一档 —— 最弱层级）
  p.accent = '#34d3b4';       // --accent
  p.accentHover = '#45e2c4';  // --accent-hover
  p.accentSoft = '#63e6c8';   // --md-link
  p.accentSoftFade = '#0063e6c8'; // accentSoft 的全透明版（流光两端）
  p.accentDeep = '#04473a';   // 派生（accent 压暗到可读 —— 取值口径见上方「霓虹深色系的 accentDeep」）
  p.accentText = '#7ff0d6';   // 派生（accent 提亮文字）
  p.onAccent = '#04150f';     // --accent-fg
  p.bubbleUser = '#1f9e88';   // 派生（accent 系的用户气泡底）
  p.border = '#1d2f47';       // --border
  p.borderStrong = '#2b4368'; // --border-strong
  p.success = '#34d399';      // 沿用 web dark --success
  p.successText = '#a7f3d0';  // 沿用 web dark 成功文字
  p.warn = '#fbbf24';         // 沿用 web dark --warning
  p.warnBg = '#16233a';       // 派生（深空警示底）
  p.dangerBg = '#7f1d1d';     // 沿用 dark 危险底
  p.dangerText = '#f87171';   // 沿用 dark 危险文字
  // 状态四色（派生：running 走本主题主色相，waiting/error 沿用深空语义，idle 用中性灰）
  p.statusRunning = '#34d3b4';
  p.statusWaiting = '#fbbf24';
  p.statusIdle = '#6b8399';
  p.statusError = '#f87171';
  p.transparent = '#00000000';
  return p;
}

/**
 * 星云（xbot-nebula）：紫黑深空 + 霓虹紫主色。
 * 关键色值**逐字**采用 `.research/design-system.md` 的 xbot-nebula 表（源表为小写 hex，故此处保持小写）。
 */
export function nebulaPalette(): Palette {
  const p: Palette = new Palette();
  p.appBg = '#08060f';        // --bg-primary
  p.surface = '#0f0a1e';      // --bg-secondary
  p.surfaceAlt = '#171030';   // --bg-tertiary
  p.surfaceHi = '#221642';    // 派生（tertiary 提亮一档）
  p.textPrimary = '#ece4ff';  // --text-primary
  p.textSecondary = '#b9a8d9'; // --text-secondary
  p.textMuted = '#8577ad';    // --text-muted
  p.foreground3 = '#5b5077';  // 派生（textMuted 再压暗一档）
  p.accent = '#a78bfa';       // --accent
  p.accentHover = '#b9a1ff';  // --accent-hover
  p.accentSoft = '#d68bff';   // --md-link
  p.accentSoftFade = '#00d68bff'; // accentSoft 的全透明版
  p.accentDeep = '#4a1998';   // 派生（accent 压暗到可读 —— 取值口径见 aurora 上方同节）
  p.accentText = '#c4b5fd';   // 派生（accent 提亮文字）
  p.onAccent = '#150a2b';     // --accent-fg
  p.bubbleUser = '#8b5cf6';   // 派生（accent 系的用户气泡底）
  p.border = '#2c1f4d';       // --border
  p.borderStrong = '#3f2d6b'; // --border-strong
  p.success = '#34d399';
  p.successText = '#a7f3d0';
  p.warn = '#fbbf24';
  p.warnBg = '#1a1029';       // 派生
  p.dangerBg = '#7f1d1d';
  p.dangerText = '#f87171';
  // 状态四色（派生：running 走本主题主色相，其余沿用深空语义/中性灰）
  p.statusRunning = '#a78bfa';
  p.statusWaiting = '#fbbf24';
  p.statusIdle = '#8577ad';
  p.statusError = '#f87171';
  p.transparent = '#00000000';
  return p;
}

/**
 * 极简白（**原生独享**，无 web 对应 —— 不抄 web slate 浅色）：
 * 纯白画布 + 中性灰阶 + 极淡发丝分隔 + 低透明扩散柔影（阴影见 effectsOf 的浅色分支）。
 *
 * 设计口径（对齐 Apple 系统色）：
 *  - 画布/卡片同为纯白，靠**发丝线 + 柔影**分层（不是靠灰底，故不出现 slate 的蓝灰）；
 *  - 正文/次级/更弱/最弱 = 四阶文字（#1D1D1F / #6E6E73 / #A2A2A7 / #C7C7CC），
 *    中性（R=G，B=R+5 —— 与 Apple 自家 label 家族同族偏移，非纯无彩色）；"干净"的关键；
 *    ⚠️ `textMuted` **刻意不等于** Apple `tertiaryLabel #AEAEB2`：那一个值压在
 *    `surfaceHi #EDEDEF`(1.89) / `accentDeep #E8F1FD`(1.94) / `sunken #F2F2F2`(1.98) 三处
 *    都 < 2:1（"更弱的一档"在白底族上糊掉），故按**两条约束**重算（见下）；
 *  - 强调色用 Apple Blue #0071E3（科技感签名色；用户强调色仍可覆盖）；
 *  - 用户气泡同为 Apple 蓝（**不留 slate 浅色里的品牌紫**）。
 *
 * ── `textMuted = #A2A2A7` 的取值依据（2026-10-11，两条约束一起解，不是拍一个值）──────
 *  · 约束 ①（可读性下限）：对**每一个**白底族的面（`appBg`/`surface`/`surfaceAlt`/`surfaceHi`/
 *    `sunken`/`accentDeep`）都必须 ≥ 2.0:1（最弱文字档的门禁阈值，**不放宽**）。
 *      可行窗口的下缘（本约束最紧）= `#A8A8AD`（最紧面 `surfaceHi` = 2.025）。
 *  · 约束 ②（层级不许塌陷）：`textMuted` 与 `textSecondary` 的间距不得**小于其他四套主题的最小值**
 *    （= nebula 的 1.845:1），否则 porcelain 会成为"次级/更弱分不出"的异类（丢掉一级文字层级）。
 *      可行窗口的上缘（本约束最紧）= `#9C9CA1`（间距 1.856）。
 *  · 窗口 = `#A8A8AD`…`#9C9CA1`；取**min-max 归一化余量最优**的中点 = `#A2A2A7`：
 *    最紧面 2.174（余量 +8.7%）、层级间距 1.995（余量 +8.2%）—— 两边都不贴线。
 *    旁证：它的 BT.601 亮度阶梯 52.0 落在其余四套的 [49.3, 77.8] 区间内。
 *  · 门禁把这两条约束**都断言**（`tools/tests/theme_contrast.test.ts` §G），改坏任一条即红。
 */
export function porcelainPalette(): Palette {
  const p: Palette = new Palette();
  // 画布 = **极淡灰**（不是纯白）：让"白卡"浮在淡灰上 = 浅色专属的**白度差**分层（L2，
  // 见 `docs/DESIGN-SYSTEM.md §13.3`）。纯白画布上"白卡 + 发丝"两档面无白度差 ⇒ 层次只能靠描边。
  // ⚠️ 改了它 ⇒ `hairline`（`surfacesOf` 按 `HAIRLINE_TARGET_RATIO` **派生**）自动重算 ✓；
  //    四阶文字/链接对比度全部复核达标（见 `tools/tests/theme_contrast.test.ts`）。
  p.appBg = '#F7F7F8';        // 极淡灰画布（白卡浮于其上）
  p.surface = '#FFFFFF';      // 卡片浮在画布上（靠发丝 + 柔影分层，非灰底）
  p.surfaceAlt = '#F6F6F7';   // 次级面（pill / 菜单行）
  p.surfaceHi = '#EDEDEF';    // 悬停 / 选中
  p.textPrimary = '#1D1D1F';  // Apple label
  p.textSecondary = '#6E6E73';// Apple secondaryLabel
  p.textMuted = '#A2A2A7';    // 「更弱」一档：**不用 Apple tertiaryLabel #AEAEB2**（见下）
  p.foreground3 = '#C7C7CC';  // Apple quaternaryLabel（最弱一档）
  p.accent = '#0071E3';       // Apple Blue
  p.accentHover = '#0062C4';  // 浅色系 hover 压暗（与 withAccent 的 light 分支同向）
  p.accentSoft = '#0066CC';   // 链接/可点文字（白底可读）
  p.accentSoftFade = '#000066CC';
  p.accentDeep = '#E8F1FD';   // 徽标/标签浅底
  p.accentText = '#0057B8';   // 强调文字（深一档）
  p.onAccent = '#FFFFFF';
  p.bubbleUser = '#0071E3';   // Apple 蓝用户气泡（清除紫残留）
  p.border = '#ECECEE';       // 极淡发丝（几乎不可见但存在）
  p.borderStrong = '#D8D8DC'; // 次要按钮描边
  p.success = '#1E8E3E';
  p.successText = '#166534';
  p.warn = '#B26A00';
  p.warnBg = '#FFF4E5';
  p.dangerBg = '#D92D20';
  p.dangerText = '#B42318';
  // 状态四色（running 走主色 blue；waiting 压暗琥珀；idle 中性灰；error 苹果红）
  p.statusRunning = '#0071E3';
  p.statusWaiting = '#B26A00';
  p.statusIdle = '#8E8E93';
  p.statusError = '#D70015';
  p.transparent = '#00000000';
  return p;
}

/**
 * 主题 → Palette / Effects / Surfaces 的**记忆化**（纯缓存：语义零改动）。
 *
 * 为什么：`effectsOf` 实测 **2.1–3.3µs/次**、`surfacesOf` **1.7–5.7µs/次**（每次 `new` +
 * 十几次 `alphaHex` 颜色合成），而 `components/pages` 的 build 路径里有 **17 处**调用点
 * （`this.eff()` / `surfacesOf(this.pal())`）⇒ 每帧白算几十 µs。`paletteOf` 本身很便宜
 * （0.01µs），但它**每次都 new** ⇒ 只缓存 `effectsOf` 永远命中不了，故三者一起按输入记忆化。
 *
 * ⛔ 三条纪律：
 *   1. **纯语义不变**：缓存只做"同一输入复用同一结果"；键由输入唯一决定 ⇒ 不可能串味。
 *   2. **不得跨主题串味**：`paletteOf` 键 = 主题名；`effectsOf`/`surfacesOf` 键 = Palette
 *      **对象标识** —— 而 Palette 经 `paletteOf` 记忆化后每主题唯一 ⇒ 等价于按主题唯一。
 *   3. **有界**：手工 `new Palette()` 的调用方（`core/accent.ets`）会产生"一次性键"
 *      ⇒ 超上限即清空（宁可退化成不缓存，也不让 Map 无界增长）。
 *
 * ⛔ 因此：**调用方不得就地修改**取回的 Palette/Effects/Surfaces（全仓已核：无外部改字段；
 *    需要变体走 `core/accent.ets` 的 `new Palette()` 路径）。
 */
const PALETTE_MEMO: Map<string, Palette> = new Map<string, Palette>();
const EFFECTS_MEMO: Map<Palette, Effects> = new Map<Palette, Effects>();
const SURFACES_MEMO: Map<Palette, Surfaces> = new Map<Palette, Surfaces>();
/** 记忆化条目上限（正常只会用到"主题数"量级；上限只防"一次性键"泄漏）。 */
const MEMO_MAX_ENTRIES: number = 64;

/**
 * **应用级强调色覆盖**（`''` = 不覆盖 ⇒ 各主题用自己的强调色）。
 *
 * 为什么必须有它（2026-10-11 真机实证的**全局空操作**）：
 *   强调色叠加此前只发生在 `pages/Index.ets` 的 `pal()` 里（`withAccent(base, a, isDark)`），
 *   而**所有 40 个组件**共 80 处取色走的是 `paletteOf(this.theme)` —— 它不认识强调色
 *   ⇒ 真机上「设置面板标签写 `湖蓝`，但同一屏的按钮/chip 仍是主题紫」。
 * 现在把"叠加"下沉到 `paletteOf`（**唯一取色入口**）⇒ 任何组件、任何调用点自动一致。
 *
 * ⛔ 纪律：只有 `core/store.ets` 的 settings 落点会写它（`setAppAccent`），组件不得写。
 */
let APP_ACCENT: string = '';

/** 当前应用级强调色（`''` = 不覆盖）。 */
export function appAccentHex(): string {
  return APP_ACCENT;
}

/**
 * 设置应用级强调色（`''` = 取消覆盖 ⇒ 回到各主题本色）。
 * 变更即清色板缓存（缓存键含强调色，见 `paletteOf`）。
 */
export function setAppAccent(hex: string): void {
  const next: string = hex !== undefined && hex !== null ? hex.trim() : '';
  if (next === APP_ACCENT) {
    return;
  }
  APP_ACCENT = next;
  PALETTE_MEMO.clear();
}

/** 取色板的**构造实现**（未知主题回落深色 —— 深色是既有默认）。 */
function buildPalette(theme: string): Palette {
  if (theme === THEME_LIGHT) { return lightPalette(); }
  if (theme === THEME_AURORA) { return auroraPalette(); }
  if (theme === THEME_NEBULA) { return nebulaPalette(); }
  if (theme === THEME_PORCELAIN) { return porcelainPalette(); }
  return darkPalette();
}

/** 取色板（**记忆化**：同一 (主题, 强调色) 只构造一次）。返回**共享对象** —— 调用方不得就地修改。
 *
 *  ⚠️ 缓存键 = `主题|强调色`（2026-10-11）：强调色覆盖后返回的是**新对象**，
 *     `EFFECTS_MEMO`/`SURFACES_MEMO` 以 Palette 对象为键 ⇒ 自动跟着算，不会串味。 */
export function paletteOf(theme: string): Palette {
  const key: string = `${theme}|${APP_ACCENT}`;
  const hit: Palette | undefined = PALETTE_MEMO.get(key);
  if (hit !== undefined) {
    return hit;
  }
  let p: Palette = buildPalette(theme);
  if (APP_ACCENT.length > 0) {
    // ⛔ 深浅必须走**亮度口径**（`isLightPalette(p)`），**不按主题名硬判**（本仓铁律）。
    //    此处 `p` 已是 `Palette`（下一行才叠加 accent）⇒ 直接判它；
    //    ⛔ 不可写 `isLightPalette(paletteOf(theme))`（会递归进本函数）。
    p = withAccent(p, APP_ACCENT, !isLightPalette(p));
  }
  if (PALETTE_MEMO.size >= MEMO_MAX_ENTRIES) {
    PALETTE_MEMO.clear();
  }
  PALETTE_MEMO.set(key, p);
  return p;
}

/** 规范化主题名（未知值回落 dark）。 */
export function normalizeTheme(v: string | undefined): string {
  if (v === THEME_LIGHT) { return THEME_LIGHT; }
  if (v === THEME_AURORA) { return THEME_AURORA; }
  if (v === THEME_NEBULA) { return THEME_NEBULA; }
  if (v === THEME_PORCELAIN) { return THEME_PORCELAIN; }
  return THEME_DARK;
}

/** 主题显示名。 */
export function themeLabel(theme: string): string {
  if (theme === THEME_LIGHT) { return '浅色'; }
  if (theme === THEME_AURORA) { return '极光'; }
  if (theme === THEME_NEBULA) { return '星云'; }
  if (theme === THEME_PORCELAIN) { return '极简白'; }
  return '深色';
}

/** 该主题是否「深色系」（决定强调色的 hover 方向：深色系变亮 / 浅色系变暗，对齐 web）。
 *  浅色系 = light + porcelain；未知主题一律算深色（与 normalizeTheme 的回落一致）。 */
export function isDarkThemeName(theme: string): boolean {
  return theme !== THEME_LIGHT && theme !== THEME_PORCELAIN;
}

/** 该主题是否「浅色系」—— `isDarkThemeName` 的反面。 */
export function isLightThemeName(theme: string): boolean {
  return !isDarkThemeName(theme);
}

/**
 * 色板是否为浅色 —— 按 `appBg` 的感知亮度（ITU-R BT.601）判定，**不看主题名**。
 *
 * 为什么需要它：`effectsOf` / `mdtheme.codeBgOf` 只拿得到 `Palette`（调用点在
 * `components/`，本波不能改签名），用主题名判会漏掉"新色板改了 appBg"以及"强调色覆盖"
 * 等情况；亮度判据对**任何**色板（含未来新增主题）都成立。
 */
export function isLightPalette(p: Palette): boolean {
  const rgb: number[] = hexToRgb(p.appBg);
  const lum: number = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return lum > 128;
}

/** 解析 `#RRGGBB`（非法按黑处理，保证 isLightPalette 不抛）。 */
function hexToRgb(hex: string): number[] {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length !== 6) { return [0, 0, 0]; }
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** 切换主题（深/浅二态；霓虹主题由设置页直接选，不走这枚开关）。 */
export function toggleTheme(theme: string): string {
  return isLightThemeName(theme) ? THEME_DARK : THEME_LIGHT;
}

/**
 * 色板的所有取值（**枚举而非反射**）。
 *
 * 为什么不用 `Object.keys` + 转型：ArkTS 禁止 `as unknown`（`arkts-no-any-unknown`）。
 * 新增字段必须加进这个列表 —— 测试里有「字段数 == 列表长度」的核对，漏加会红。
 */
export function paletteValues(p: Palette): string[] {
  return [
    p.appBg, p.surface, p.surfaceAlt, p.surfaceHi,
    p.textPrimary, p.textSecondary, p.textMuted, p.foreground3,
    p.accent, p.accentHover, p.accentSoft, p.accentSoftFade, p.accentDeep, p.accentText, p.onAccent,
    p.bubbleUser,
    p.border, p.borderStrong,
    p.success, p.successText, p.warn, p.warnBg, p.dangerBg, p.dangerText,
    p.statusRunning, p.statusWaiting, p.statusIdle, p.statusError,
    p.transparent,
  ];
}

/** 色板是否完整（每个角色都有值 —— 防止新增字段忘了填两套色板）。 */
export function paletteComplete(p: Palette): boolean {
  const vs: string[] = paletteValues(p);
  for (let i = 0; i < vs.length; i++) {
    if (vs[i].length === 0) {
      return false;
    }
  }
  return true;
}

/**
 * `'#RRGGBB'` + alpha(0..1) → `'#AARRGGBB'`（ArkUI 的 ARGB 字面量语义）。
 * 与 `core/bubble.ets` 的 `withAlpha` 同语义；这里另置一份是为了**避免 theme↔bubble 循环 import**
 * （bubble.ets 已 import theme）。
 */
function alphaHex(hex: string, alpha: number): string {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  let a: number = Math.round(alpha * 255);
  if (a < 0) { a = 0; }
  if (a > 255) { a = 255; }
  const digits: string = '0123456789ABCDEF';
  const hi: string = digits.charAt(Math.floor(a / 16));
  const lo: string = digits.charAt(a % 16);
  return `#${hi}${lo}${h.slice(0, 6).toUpperCase()}`;
}

/**
 * 玻璃拟态面的**基色**（`effectsOf.glassBg` 由它派生，`Surfaces.glassBase` 也暴露它）。
 *
 * 为什么需要单独一层：玻璃底是 `基色 @62%`，压在**画布**上。若基色与画布同色
 * （`porcelain` 的 `surface == appBg == #FFFFFF`），合成结果 = 画布本身 ⇒
 * **玻璃面板在白底上恒等不可见**（实测对比度 1.0000，受影响点：`MarkdownView` 引用块底色）。
 * 深/浅分支此前只覆盖了 `sheen/elev*`，没覆盖玻璃底 —— 这里补上：
 * 浅色系若 `surface` 与画布同色，改用**次级面** `surfaceAlt`（"次级面口径"），
 * 于是白底上也能看出"这是一块面板"。**深色四套逐字节不变**（surface ≠ appBg ⇒ 直接返回 surface）。
 */
function glassBaseOf(p: Palette): string {
  if (isLightPalette(p) && p.surface === p.appBg) { return p.surfaceAlt; }
  return p.surface;
}

/**
 * 层级阴影 1（`elev1`）的**唯一**公式 —— `Effects` 与 `Surfaces.sunken` 共用。
 *
 * 为什么要抽出来：`elev*` 本是"阴影色"，却被 5 处当**块底色**用
 * （`ToolPopover` 的代码块/终端块/diff 行底）。新增的 `sunken`（下沉内容面）
 * 必须与旧观感**逐字节等价**，否则就是未授权的视觉回归 ⇒ 共用同一个公式，
 * 等价性由**构造**保证（测试里再逐字节复核 `compositeOver(elev1, surface) === sunken`）。
 * 公式本身**逐字未改**：浅色 = 正文色 @6%，深色 = 黑 @24%。
 */
function legacyElev1Of(p: Palette): string {
  return isLightPalette(p) ? alphaHex(p.textPrimary, 0.06) : alphaHex('#000000', 0.24);
}

/**
 * 视觉手段 token（玻璃拟态 / 光晕 / 渐变 / 层级阴影）。
 *
 * 为什么单列结构而非塞进 Palette：
 *  - `glassBlur` 是**数值**，而 `paletteValues` 是 `string[]`（穷尽性不变式），混入即破；
 *  - 这些 token 全部可由语义色板**派生**，单列后跨主题零重复、永不与主色脱节。
 * 颜色一律是 ArkUI 的 `#AARRGGBB`（可直接喂 `.shadow({ color })` / `.backgroundColor()`）。
 */
export class Effects {
  /** 玻璃拟态底：半透明面板色（配 `.backgroundBlurStyle` 使用）。 */
  glassBg: string = '';
  /** 玻璃拟态描边：半透明边框。 */
  glassBorder: string = '';
  /** 玻璃模糊半径（vp）—— `backgroundBlurStyle(BlurStyle, {…})` / `backdropBlur(number)` 可用（SDK common.d.ts 已确认）。 */
  glassBlur: number = 0;
  /** accent 发光（强）：用于主按钮/输入聚焦的彩色阴影。 */
  glow: string = '';
  /** accent 发光（弱）：用于状态点/运行指示。 */
  glowSoft: string = '';
  /** 渐变起点（= 主色）。 */
  gradientFrom: string = '';
  /** 渐变终点（= 强调浅形态）。 */
  gradientTo: string = '';
/** 扫光高光色（sheen）——深色=白@6%（微提亮）；浅色=中性黑@6%（浅底无法再提亮，
 *  6% 黑在纯白上仍可见，且中心near-transparent 相对 accent 色带读作高光）。 */
  sheen: string = '';
  /** 层级阴影 1（最轻）。 */
  elev1: string = '';
  /** 层级阴影 2。 */
  elev2: string = '';
  /** 层级阴影 3（最重）。 */
  elev3: string = '';
}

/** 渐变**端色**对 `onAccent`（压在其上的字）要求的最低对比度 —— WCAG AA 正文级，
 *  与 `tools/tests/theme_contrast.test.ts` 的 `T_BODY` 同值（判据与渲染同源）。 */
export const GRADIENT_TEXT_MIN_RATIO: number = 4.5;

/**
 * 渐变**端色**（主按钮 / 徽标的 `gradientFrom`/`gradientTo`）：保证 `onAccent` 压在它上面
 * ≥ `GRADIENT_TEXT_MIN_RATIO`。
 *
 * 为什么不能直接用 `accent`/`accentSoft`：真按钮底色是**渐变**（不是纯 `accent`），最坏面在
 * **最亮端** `accentSoft` —— dark 实测白字压 `accent #7C5CFF` = **4.35**、压 `accentSoft #B9A7FF`
 * 仅 **2.09**（连大字 3:1 都过不了）⇒ 只压 `accent` 是"让测试变绿、真按钮仍不达标"。
 *
 * 口径（与 `deepenToRatio` 同一手法）：**只压深、不改色相**（线性空间三通道等比缩放，取满足目标
 * 的**最小**压深 ⇒ 尽量保留品牌观感）；**已达标的端逐字节不动**（浅色/霓虹主题原本就达标）。
 * ⛔ 只动**派生** `gradientFrom/To`，**不动** `accent`/`accentSoft`/`onAccent` 本身
 * ⇒ 品牌标记 `brandAccent()`、发光 token（`glow` = `accent@45%`）、链接色**全不受牵连**。
 */
function gradientEndOf(color: string, onAccent: string): string {
  if (contrastRatio(color, onAccent) >= GRADIENT_TEXT_MIN_RATIO) {
    return color;
  }
  return deepenToRatio(color, [onAccent], GRADIENT_TEXT_MIN_RATIO);
}

/** 由色板派生视觉效果 token（单一口径 —— 换主题即换效果）。
 *
 *  ⚠️ 深色主题的四个值（sheen/elev1..3）**逐字节不动**（其他线依赖其观感）；
 *  浅色主题（含 light / porcelain）走柔影分支：低透明 + 中性色相（正文色的极低 alpha），
 *  白底上不再出现"一圈脏影"。 */
function buildEffects(p: Palette): Effects {
  const e: Effects = new Effects();
  const light: boolean = isLightPalette(p);
  e.glassBlur = 18;
  // 渐变端色走**对比度护航**（真按钮底色是渐变，不是纯 accent —— 见 `gradientEndOf`）
  e.gradientFrom = gradientEndOf(p.accent, p.onAccent);
  e.gradientTo = gradientEndOf(p.accentSoft, p.onAccent);
  if (light) {
    // ── 浅色玻璃（L4，`docs/DESIGN-SYSTEM.md §13.3`）──────────────────────────────
    // 深色玻璃 = **透光**（露出后面的彩色 ⇒ 低不透明度才"活"）；浅色玻璃 = **磨砂白**
    // （透出灰会"脏"）⇒ 不透明度必须**更高**、边界必须**更明确**（靠描边立边界，不靠对比）。
    // 深色臂逐字节保留原 0.62/0.55（见下 `else`）——本次只改**浅色**档。
    e.glassBg = alphaHex(glassBaseOf(p), 0.80);
    e.glassBorder = alphaHex(p.borderStrong, 0.70);
    // 浅底：白高光物理上不可见 ⇒ 换"中性"（无色相偏移）的极淡黑，读作扫光中心。
    e.sheen = alphaHex('#000000', 0.06);
    // 柔影：中性（取正文色相 → 略带主题冷调）+ 低透明；扩散交给调用点的 radius。
    e.elev1 = legacyElev1Of(p);
    // ⚠️ `elev2` 由 @10% 降到 @7%（L3）：浅色下**分层交给"白度差"**（L2：`appBg` 淡灰 + 白卡），
    //    柔影退为"贴边暗示"⇒ 影更克制、结构更清楚（⛔ 不是"深色去掉发光"，是**重组**分层手段）。
    //    ⚠️ 副作用（已知并接受）：`elev2` 同时是浅色 `inflightHaloOf`（光球外光晕）与 `glowSoft`
    //    ⇒ 光球在纯白上的外光晕同步变淡（@10%→@7%）；契约已按新值更新（`orb_porcelain_motion.test.ts`）。
    e.elev2 = alphaHex(p.textPrimary, 0.07);
    e.elev3 = alphaHex(p.textPrimary, 0.16);
    // ── 发光（E2，2026-10-11）：浅色系**不出辉光** ⇒ `glow` 透明（短路）────────────────────
    // 判据（「辉光能不能被读成光」）= **① 中心对底 ≥1.5:1 且 ② 含色彩语义（chroma > 0）**。
    // 实测：浅色旧值 `textPrimary@16%` 合成后对底 **1.383:1（porcelain）/1.394（light）**、**chroma = 0**
    // ⇒ **两条都不满足** ⇒ 不是"光"，是"脏灰团"（深色 = `accent` 紫 1.771、chroma > 0 ✅）。
    // 备选（已实测否掉）：浅色改 `accent@16%` 只有 1.238、`@10%` 1.14，要到 ≥24% 才够 1.5 ⇒ 变"脏彩"。
    // ⇒ **浅色一律不出**（`glow = p.transparent`）；层次由**发丝/白度差/柔影(§13)** 负责 ——
    //   星形图案 + 文案本身已足够表达空态。
    // ⚠️ 调用点影响（`pages/Index.ets`，**归 main agent**，本波只改 theme 侧口径）：
    //    `:3176/:3191/:3283/:3949` 把 glow 当**投影**用 ⇒ 浅色下会变成"无投影"（透明的 shadow）。
    //    若要保留浅色柔影，请把那几处改走 `elevationColorOf(p, …)`（`elev*` 是**正确的**投影档）。
    e.glow = p.transparent;
    // ⚠️ `glowSoft` **本波不动**（V6 冻结：等用户真机截图定夺"灰团"是否要调）——它同样零 chroma，
    //    若定夺采纳，同法改透明（或并入本判据）。
    e.glowSoft = alphaHex(p.textPrimary, 0.10);
  } else {
    // 深色玻璃：**逐字节不变**（原公共段的值搬进本臂，浅色臂另给档 —— 见上 L4 注释）。
    e.glassBg = alphaHex(glassBaseOf(p), 0.62);
    e.glassBorder = alphaHex(p.borderStrong, 0.55);
    e.sheen = alphaHex('#FFFFFF', 0.06);
    e.elev1 = legacyElev1Of(p);
    e.elev2 = alphaHex('#000000', 0.32);
    e.elev3 = alphaHex('#000000', 0.42);
    // 深色：彩色 accent 发光 = 观感来源，**逐字节不变**（其他线依赖它）。
    e.glow = alphaHex(p.accent, 0.45);
    e.glowSoft = alphaHex(p.accent, 0.22);
  }
  return e;
}

/**
 * 由色板派生视觉效果 token（**记忆化**：键 = Palette 对象标识 ⇒ 不可能跨主题串味）。
 * 纯缓存 ⇒ 与 `buildEffects` 逐字段等价（`tools/tests/theme_memo.test.ts` 有等价性断言）。
 */
export function effectsOf(p: Palette): Effects {
  const hit: Effects | undefined = EFFECTS_MEMO.get(p);
  if (hit !== undefined) {
    return hit;
  }
  const e: Effects = buildEffects(p);
  if (EFFECTS_MEMO.size >= MEMO_MAX_ENTRIES) {
    EFFECTS_MEMO.clear();
  }
  EFFECTS_MEMO.set(p, e);
  return e;
}

/**
 * **投影口径**（唯一出口）—— 给"把 `glow` 当投影用"的调用点用（2026-10-11，A 项）。
 *
 * 背景：`eff().glow` 的语义是**发光**，浅色系已按 E2 定为"**不出辉光**"（= 透明，见 §13.7）。
 * 但有几处把它当**投影/阴影**用（`shadow({color: eff().glow})`）⇒ 浅色下变成"**没有投影**"。
 * 投影与发光是**两件事**：投影该走 `elev*`（真正的中性柔影档）。
 *
 * | 主题 | 返回 | 语义 |
 * |---|---|---|
 * | 深色系 | `effectsOf(p).glow`（**逐字节不变**） | 深色"彩色发光 = 观感来源"，当投影用即既有观感 |
 * | 浅色系 | `tier==='overlay' ? elev3 : elev2` | 真投影档（中性柔影；非透明、chroma 近中性） |
 *
 * ⛔ 只在**浅色臂**分叉（深色逐字节）；判据按 `isLightPalette(p)`（色板亮度），⛔ 不按主题名。
 * ⚠️ 本函数**不能**调 `core/design.ets` 的 `elevationColorOf`（design → theme 是单向依赖，反向会成环）
 *    ⇒ 直接读 `effectsOf`（同一真源）。
 *
 * @param tier `'overlay'` ⇒ elev3（浮层级）；其余（默认）⇒ elev2（抬升级）
 */
/**
 * **投影半径口径**（唯一出口，B）—— 与 `shadowColorOf` 成对：一个给色、一个给半径。
 *
 * 洞见：**浅色柔影 = 更大半径 + 更低 alpha**（HIG 的"软影"）；深色柔影 = 更小半径 + 更高 alpha。
 * 此前半径是**调用点字面量**（深浅同半径）⇒ 浅色"没手感"。⇒ 令牌化 + 浅色**扩散系数**。
 *
 * | 主题 | 返回 |
 * |---|---|
 * | 深色系 | `SHADOW_RADIUS_*`（**基础档，逐字节不变**） |
 * | 浅色系 | `round(SHADOW_RADIUS_* × LIGHT_SHADOW_DIFFUSION)`（**更大**） |
 *
 * 档名 → 基础：`panel`28 / `hero`26 / `drawer`24 / `overlay`20 / `raised`18 / `pill`14 / 其余 `card`10。
 * ⛔ 判据按 `isLightPalette(p)`；⛔ 深色臂不乘扩散。
 */
export function shadowRadiusOf(p: Palette, tier: string): number {
  const base: number = shadowRadiusBaseOf(tier);
  return isLightPalette(p) ? Math.round(base * LIGHT_SHADOW_DIFFUSION) : base;
}

/** 档名 → 基础半径（⛔ 每个档的深色值 = 迁移前调用点的**原字面量**）。 */
function shadowRadiusBaseOf(tier: string): number {
  if (tier === 'hero') { return SHADOW_RADIUS_HERO; }        // 26
  if (tier === 'raised') { return SHADOW_RADIUS_RAISED; }    // 18
  if (tier === 'pill') { return SHADOW_RADIUS_PILL; }        // 14
  if (tier === 'panel') { return SHADOW_RADIUS_PANEL; }      // 28
  if (tier === 'drawer') { return SHADOW_RADIUS_DRAWER; }    // 24
  if (tier === 'overlay') { return SHADOW_RADIUS_OVERLAY; }  // 20
  return SHADOW_RADIUS_CARD;                                 // 10（默认）
}

export function shadowColorOf(p: Palette, tier: string): string {
  const e: Effects = effectsOf(p);
  if (!isLightPalette(p)) {
    return e.glow;
  }
  return tier === 'overlay' ? e.elev3 : e.elev2;
}

/** 效果 token 是否完整（穷尽性守卫：颜色非空、glassBlur 为正数）。 */
export function effectsComplete(e: Effects): boolean {
  if (e.glassBg.length === 0 || e.glassBorder.length === 0) { return false; }
  if (e.glow.length === 0 || e.glowSoft.length === 0) { return false; }
  if (e.gradientFrom.length === 0 || e.gradientTo.length === 0 || e.sheen.length === 0) { return false; }
  if (e.elev1.length === 0 || e.elev2.length === 0 || e.elev3.length === 0) { return false; }
  if (!(e.glassBlur > 0)) { return false; }
  return true;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 对比度（WCAG 2.1）—— 让「某套主题的前景色糊在某背景上」**离线可判**。
 *
 * 为什么放在这里而不是测试里：视觉缺陷（白底白字 / 浅底浅字）此前只能靠人眼在模拟器上
 * 发现（`docs/ARKTS-GOTCHAS.md` 批次 13/14 是同一类问题的两个面：门禁查不到、测不到）。
 * 把度量的**唯一实现**放进"全应用唯一颜色来源"里，任何主题改动都能被
 * `tools/tests/theme_contrast.test.ts` 用同一口径机械判定；同时未来若要让代码
 * **按对比度自动挑前景色**（如 `accentDeep` 上的文字），也只应调用这几个函数，不要再造一份。
 *
 * 口径（逐条按 WCAG 2.1 定义，**不是**简单亮度均值）：
 *  - sRGB 通道先线性化（分段函数，不是直接取 8bit 均值）；
 *  - 相对亮度 L = 0.2126R + 0.7152G + 0.0722B（线性化后）；
 *  - 对比度 = (L亮 + 0.05) / (L暗 + 0.05)，范围 1..21。
 *
 * ⚠️ 不要用 `isLightPalette` 的 BT.601 感知亮度（`core/accent.ets` 的 `contrastForeground`
 * 也是那一套）来当对比度判据 —— 那是"分档挑黑/白字"的近似启发式，不是可审计的比值。
 */
function srgbChannelLinear(c8: number): number {
  const c: number = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function isHexDigits(h: string): boolean {
  const digits: string = '0123456789abcdefABCDEF';
  for (let i = 0; i < h.length; i++) {
    if (digits.indexOf(h.charAt(i)) < 0) { return false; }
  }
  return true;
}

function byteHex(v0: number): string {
  const digits: string = '0123456789ABCDEF';
  let v: number = Math.round(v0);
  if (v < 0) { v = 0; }
  if (v > 255) { v = 255; }
  return `${digits.charAt(Math.floor(v / 16))}${digits.charAt(v % 16)}`;
}

/**
 * 解析 `#RRGGBB` / `#AARRGGBB` → `[r, g, b, a]`（各 0..255）。
 * 非法输入（长度不对/非十六进制）回落**不透明黑**，保证调用方永不拿到 NaN。
 * 与私有的 `hexToRgb` 不同：后者只认 6 位（`isLightPalette` 专用），本函数额外支持
 * ArkUI 的 8 位 ARGB 字面量（`Effects.glassBg` 等半透明 token）。
 */
export function parseColorRgba(hex: string): number[] {
  let h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length === 6) { h = `FF${h}`; }
  if (h.length !== 8 || !isHexDigits(h)) { return [0, 0, 0, 255]; }
  return [
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
    parseInt(h.substring(6, 8), 16),
    parseInt(h.substring(0, 2), 16),
  ];
}

/** WCAG 2.1 相对亮度（0 = 黑，1 = 白）。**忽略 alpha**（视为已合成的不透明色）。 */
export function relativeLuminance(hex: string): number {
  const c: number[] = parseColorRgba(hex);
  const r: number = srgbChannelLinear(c[0]);
  const g: number = srgbChannelLinear(c[1]);
  const b: number = srgbChannelLinear(c[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 对比度（1..21）。参数顺序无关。
 * 判据参考：正文 4.5:1（AA）/ 7:1（AAA）；大字与图形 3:1；装饰性最弱一档 2:1。
 */
export function contrastRatio(a: string, b: string): number {
  const la: number = relativeLuminance(a);
  const lb: number = relativeLuminance(b);
  const hi: number = Math.max(la, lb);
  const lo: number = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 把**半透明**的「上层色」合成到不透明底色上，返回 `#RRGGBB`。
 *
 * 用途：玻璃拟态的 `Effects.glassBg`（`surface @62%`）压在 `appBg` / `surface` 上时，
 * 真正决定文字可读性的是**合成后**的颜色，不是 `glassBg` 本身。直接拿带 alpha 的
 * `#AARRGGBB` 去算对比度是错的（alpha 会被当成第 4 个颜色通道丢掉）。
 */
export function compositeOver(top: string, bottom: string): string {
  const t: number[] = parseColorRgba(top);
  const b: number[] = parseColorRgba(bottom);
  const a: number = t[3] / 255;
  const r: number = t[0] * a + b[0] * (1 - a);
  const g: number = t[1] * a + b[1] * (1 - a);
  const bl: number = t[2] * a + b[2] * (1 - a);
  return `#${byteHex(r)}${byteHex(g)}${byteHex(bl)}`;
}

/**
 * 结构化「面」与「边界」（**由色板派生**，与 `Effects` 同一纪律）。
 *
 * 为什么单列结构而不是直接往 `Palette` 加字段（**这是本模块新增角色的既定纪律**）：
 *  1. 这些值**不必逐主题手写**，它们由色板**按规则**得出 ⇒ 派生后跨主题自动一致、
 *     新主题零重复（`Effects` 当初就是这么做的）；
 *  2. `core/accent.ets` 的 `withAccent()` 是**逐字段复制**建新色板（`:104-134`）——
 *     往 `Palette` 加字段会让"换强调色后的色板"多出空字段
 *     （`tools/tests/accent.test.ts:80`「换色后无空字段」会立刻红）。
 *     派生结构**天然规避**这个陷阱：换强调色不改 `border/surface/...` ⇒ 派生值不变。
 *  ⚠️ 若将来确实要把某个角色提升为 `Palette` 字段，**必须同时**给 `withAccent` 加复制行。
 */
export class Surfaces {
  /** **结构性发丝**：承载信息的边界 / 分隔线（`ThinkingLine` 左栅栏、`MarkdownView` 分隔线、
   *  缩略图卡与压缩卡描边）。与装饰性的 `border` 相对 —— 浅色系必须**真的看得见**。 */
  hairline: string = '';
  /** **下沉内容面**：比卡片更深一档的"内容块"底（代码块 / 终端块 / diff 行底）。
   *  ⛔ 替代历史上"把阴影色 `Effects.elev1` 当底色用"的误用；取值与旧观感**逐字节等价**。 */
  sunken: string = '';
  /** 玻璃拟态面的基色（`Effects.glassBg` 的派生源，见 `glassBaseOf`）。 */
  glassBase: string = '';
}

/**
 * 结构性发丝的**目标可见度**（WCAG 对比度）—— 逐字取 **web 权威基线**：
 * `web/src/index.css:160` 浅色 `--border: #e0e0e0` 压在 `--bg-primary: #ffffff`（`:153`）上的实测值。
 *
 * 为什么用 web 的浅色 border 当基准：原生浅色系的 `border`（light `#E2E8F0` 对画布 1.178、
 * porcelain `#ECECEE` 对画布 1.180）比 web 基线**弱约 11%** —— 这正是"白底上结构性边界糊掉"的
 * **量化根因**（另一条线在真机上认定、此处给出数字）。深色族**不受此约束**：它们沿用已批准的观感。
 */
export const HAIRLINE_TARGET_RATIO: number = 1.3201;

/** 线性（线性化后）→ sRGB 8bit 浮点（0..255；未量化）。 */
function linearToSrgb8(lin: number): number {
  const c: number = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  const v: number = c * 255;
  if (v < 0) { return 0; }
  if (v > 255) { return 255; }
  return v;
}

/** 候选色是否对 `bases` 里每个底都达到 `target` 对比度。 */
function meetsAllRatio(cand: string, bases: string[], target: number): boolean {
  for (let i = 0; i < bases.length; i++) {
    if (contrastRatio(cand, bases[i]) < target) { return false; }
  }
  return true;
}

/**
 * 把 `hex` 在**线性空间整体压深**，直到它对 `bases` 里每个底都达到 `target` 对比度。
 * 闭式（不做搜索 ⇒ 无渲染路径开销）：先求最严的底所要求的目标亮度 `lStar`，
 * 再按 `f = lStar / 当前亮度` 缩放**线性通道**（缩放线性通道 ≡ 保持色相、只改明度）。
 * 量化到 8bit 后可能差一点点，故末尾逐通道减 1 兜底（实测 1 步；上限 8 步）。
 * ⚠️ 注释里别写 `L*斜杠L(...)` 那种式子 —— `星号斜杠` 会提前终止块注释（本文件踩过一次）。
 */
function deepenToRatio(hex: string, bases: string[], target: number): string {
  let lStar: number = 2;
  for (let i = 0; i < bases.length; i++) {
    const need: number = (relativeLuminance(bases[i]) + 0.05) / target - 0.05;
    if (need < lStar) { lStar = need; }
  }
  const rgb: number[] = parseColorRgba(hex);
  const lum: number = relativeLuminance(hex);
  let f: number = lum > 0 ? lStar / lum : 0;
  if (f > 1) { f = 1; }   // 已经比目标更暗 ⇒ 不再压深（是否达标由门禁判定，不在这里偷偷加暗）
  if (f < 0) { f = 0; }
  const ch: number[] = [
    linearToSrgb8(srgbChannelLinear(rgb[0]) * f),
    linearToSrgb8(srgbChannelLinear(rgb[1]) * f),
    linearToSrgb8(srgbChannelLinear(rgb[2]) * f),
  ];
  let cand: string = `#${byteHex(ch[0])}${byteHex(ch[1])}${byteHex(ch[2])}`;
  let guard: number = 0;
  while (guard < 8 && !meetsAllRatio(cand, bases, target)) {
    ch[0] = ch[0] - 1;
    ch[1] = ch[1] - 1;
    ch[2] = ch[2] - 1;
    cand = `#${byteHex(ch[0])}${byteHex(ch[1])}${byteHex(ch[2])}`;
    guard++;
  }
  return cand;
}

/** 结构性发丝：深色族 = `border` 现值（**逐字节等价**，观感已批准不动）；
 *  浅色族 = 把 `border` 按 `HAIRLINE_TARGET_RATIO` 压深（保持各主题自己的色相：slate / 中性）。 */
function hairlineOf(p: Palette): string {
  if (!isLightPalette(p)) { return p.border; }
  return deepenToRatio(p.border, [p.appBg, p.surface], HAIRLINE_TARGET_RATIO);
}

/** 由色板派生「面 / 边界」token 的**构造实现**（单一口径 —— 换主题即换面）。 */
function buildSurfaces(p: Palette): Surfaces {
  const s: Surfaces = new Surfaces();
  s.hairline = hairlineOf(p);
  // 下沉内容面：**逐公式等价**于旧的"elev1 阴影色当底色"（同一公式 + 同一合成底 `surface`）
  s.sunken = compositeOver(legacyElev1Of(p), p.surface);
  s.glassBase = glassBaseOf(p);
  return s;
}

/** 由色板派生「面 / 边界」token（**记忆化**：键 = Palette 对象标识 ⇒ 无跨主题串味）。 */
export function surfacesOf(p: Palette): Surfaces {
  const hit: Surfaces | undefined = SURFACES_MEMO.get(p);
  if (hit !== undefined) {
    return hit;
  }
  const s: Surfaces = buildSurfaces(p);
  if (SURFACES_MEMO.size >= MEMO_MAX_ENTRIES) {
    SURFACES_MEMO.clear();
  }
  SURFACES_MEMO.set(p, s);
  return s;
}

/** 面 token 是否完整（穷尽性守卫，与 `effectsComplete` 同一纪律）。 */
export function surfacesComplete(s: Surfaces): boolean {
  if (s.hairline.length === 0 || s.sunken.length === 0 || s.glassBase.length === 0) { return false; }
  return true;
}

/** 记忆化占用（诊断用；照 `core/markdown.mdCacheStats` 的先例）—— 让"缓存有界"可断言。 */
export class ThemeMemoStats {
  palettes: number = 0;
  effects: number = 0;
  surfaces: number = 0;
}

/** 读取记忆化占用（只读；不影响缓存）。 */
export function themeMemoStats(): ThemeMemoStats {
  const st: ThemeMemoStats = new ThemeMemoStats();
  st.palettes = PALETTE_MEMO.size;
  st.effects = EFFECTS_MEMO.size;
  st.surfaces = SURFACES_MEMO.size;
  return st;
}
