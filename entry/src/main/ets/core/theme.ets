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
 */

/** 一套语义色板。字段名就是"用途"，不是"颜色"—— 这样浅色主题才可能正确。 */
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
  p.accentDeep = '#0f8b73';   // 派生（accent 压暗，徽标底）
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
  p.accentDeep = '#6d28d9';   // 派生（accent 压暗）
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
 *  - 正文/次级/更弱/最弱 = Apple label 四阶（#1D1D1F / #6E6E73 / #AEAEB2 / #C7C7CC），
 *    纯中性（无蓝灰），这是"干净"的关键；
 *  - 强调色用 Apple Blue #0071E3（科技感签名色；用户强调色仍可覆盖）；
 *  - 用户气泡同为 Apple 蓝（**不留 slate 浅色里的品牌紫**）。
 */
export function porcelainPalette(): Palette {
  const p: Palette = new Palette();
  p.appBg = '#FFFFFF';        // 纯白画布
  p.surface = '#FFFFFF';      // 卡片浮在画布上（靠发丝 + 柔影分层，非灰底）
  p.surfaceAlt = '#F6F6F7';   // 次级面（pill / 菜单行）
  p.surfaceHi = '#EDEDEF';    // 悬停 / 选中
  p.textPrimary = '#1D1D1F';  // Apple label
  p.textSecondary = '#6E6E73';// Apple secondaryLabel
  p.textMuted = '#AEAEB2';    // Apple tertiaryLabel
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

/** 取色板（未知主题回落深色 —— 深色是既有默认）。 */
export function paletteOf(theme: string): Palette {
  if (theme === THEME_LIGHT) { return lightPalette(); }
  if (theme === THEME_AURORA) { return auroraPalette(); }
  if (theme === THEME_NEBULA) { return nebulaPalette(); }
  if (theme === THEME_PORCELAIN) { return porcelainPalette(); }
  return darkPalette();
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

/** 由色板派生视觉效果 token（单一口径 —— 换主题即换效果）。
 *
 *  ⚠️ 深色主题的四个值（sheen/elev1..3）**逐字节不动**（其他线依赖其观感）；
 *  浅色主题（含 light / porcelain）走柔影分支：低透明 + 中性色相（正文色的极低 alpha），
 *  白底上不再出现"一圈脏影"。 */
export function effectsOf(p: Palette): Effects {
  const e: Effects = new Effects();
  const light: boolean = isLightPalette(p);
  e.glassBg = alphaHex(p.surface, 0.62);
  e.glassBorder = alphaHex(p.borderStrong, 0.55);
  e.glassBlur = 18;
  e.glow = alphaHex(p.accent, 0.45);
  e.glowSoft = alphaHex(p.accent, 0.22);
  e.gradientFrom = p.accent;
  e.gradientTo = p.accentSoft;
  if (light) {
    // 浅底：白高光物理上不可见 ⇒ 换"中性"（无色相偏移）的极淡黑，读作扫光中心。
    e.sheen = alphaHex('#000000', 0.06);
    // 柔影：中性（取正文色相 → 略带主题冷调）+ 低透明；扩散交给调用点的 radius。
    e.elev1 = alphaHex(p.textPrimary, 0.06);
    e.elev2 = alphaHex(p.textPrimary, 0.10);
    e.elev3 = alphaHex(p.textPrimary, 0.16);
  } else {
    e.sheen = alphaHex('#FFFFFF', 0.06);
    e.elev1 = alphaHex('#000000', 0.24);
    e.elev2 = alphaHex('#000000', 0.32);
    e.elev3 = alphaHex('#000000', 0.42);
  }
  return e;
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
