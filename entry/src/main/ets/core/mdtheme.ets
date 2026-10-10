/**
 * Markdown 主题清单 —— 逐字对齐 web `src/types/markdown-theme.ts` 的
 * `MARKDOWN_THEMES`（id + 显示顺序 + mode）。
 *
 * 为什么要连 id 都对齐：该项通过 `web:ui:md-theme` **与 web 共享**，
 * id 不一致就会出现"网页选了 monokai、客户端显示未知主题"的错位。
 *
 * 纯数据 + 纯函数 ⇒ 可脱机单测（`tools/tests/mdtheme.test.ts`）。
 */
import { Palette, isLightPalette } from './theme';

/** web `DEFAULT_MARKDOWN_THEME`。 */
export const DEFAULT_MD_THEME: string = 'vscode-dark';

export class MdThemeItem {
  id: string = '';
  label: string = '';
  /** `dark` | `light`（web 用 mode 驱动 Monaco/xterm/Sonner 的二元明暗）。 */
  mode: string = 'dark';
}

/** 全部主题（顺序与 web `MARKDOWN_THEMES` 完全一致）。 */
export const MD_THEMES: MdThemeItem[] = [
  { id: 'vscode-dark', label: 'VS Code 深色', mode: 'dark' },
  { id: 'github-dark', label: 'GitHub 深色', mode: 'dark' },
  { id: 'github-light', label: 'GitHub 浅色', mode: 'light' },
  { id: 'solarized-light', label: 'Solarized 浅色', mode: 'light' },
  { id: 'one-light', label: 'One Light', mode: 'light' },
  { id: 'quiet-light', label: 'Quiet Light', mode: 'light' },
  { id: 'dracula', label: 'Dracula', mode: 'dark' },
  { id: 'one-dark', label: 'One Dark', mode: 'dark' },
  { id: 'monokai', label: 'Monokai', mode: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark' },
  { id: 'nord', label: 'Nord', mode: 'dark' },
  { id: 'solarized-dark', label: 'Solarized 深色', mode: 'dark' },
  { id: 'night-wolf-gray', label: 'Night Wolf 灰', mode: 'dark' },
  { id: 'night-wolf-blue', label: 'Night Wolf 蓝', mode: 'dark' },
  { id: 'tui-midnight', label: 'TUI 午夜', mode: 'dark' },
  { id: 'tui-ocean', label: 'TUI 海洋', mode: 'dark' },
  { id: 'tui-forest', label: 'TUI 森林', mode: 'dark' },
  { id: 'tui-sunset', label: 'TUI 黄昏', mode: 'dark' },
  { id: 'tui-rose', label: 'TUI 玫瑰', mode: 'dark' },
  { id: 'tui-mono', label: 'TUI 单色', mode: 'dark' },
  { id: 'tui-catppuccin', label: 'TUI Catppuccin', mode: 'dark' },
  { id: 'xbot-aurora', label: 'xbot 极光', mode: 'dark' },
  { id: 'xbot-nebula', label: 'xbot 星云', mode: 'dark' },
];

/** 规范化主题 id（未知回落默认）。 */
export function normalizeMdTheme(v: string | undefined): string {
  if (v === undefined) { return DEFAULT_MD_THEME; }
  for (let i = 0; i < MD_THEMES.length; i++) {
    if (MD_THEMES[i].id === v) { return v; }
  }
  return DEFAULT_MD_THEME;
}

/** 主题显示名。 */
export function mdThemeLabel(id: string): string {
  for (let i = 0; i < MD_THEMES.length; i++) {
    if (MD_THEMES[i].id === id) { return MD_THEMES[i].label; }
  }
  return id;
}

/** 该主题的明暗模式（`dark` | `light`）。 */
export function mdThemeMode(id: string): string {
  for (let i = 0; i < MD_THEMES.length; i++) {
    if (MD_THEMES[i].id === id) { return MD_THEMES[i].mode; }
  }
  return 'dark';
}

/**
 * 代码块配色 —— 只挑 web 每套主题里**最有辨识度**的 3 个角色
 * （代码底 / 代码字 / 行内码底），逐套给出。
 *
 * 说明：web 的 23 套主题定义在 `styles/markdown-themes.css`（每套 20+ 个 CSS 变量），
 * 原生端只消费这三个最能体现差异的角色（其余走全局色板），避免把 23×20 个变量硬搬进 ArkTS。
 * `[待验证]`：这三个值是**按各主题的官方配色**给出的近似，若某套观感不符再逐套校准。
 */
export class CodeTone {
  bg: string = '';
  fg: string = '';
  inlineBg: string = '';
}

export function codeTone(id: string): CodeTone {
  const t: CodeTone = new CodeTone();
  t.bg = '#1E1E1E'; t.fg = '#D4D4D4'; t.inlineBg = '#2A2A2A';   // vscode-dark
  if (id === 'github-dark') { t.bg = '#161B22'; t.fg = '#C9D1D9'; t.inlineBg = '#21262D'; }
  else if (id === 'github-light') { t.bg = '#F6F8FA'; t.fg = '#24292F'; t.inlineBg = '#EAEEF2'; }
  else if (id === 'solarized-light') { t.bg = '#EEE8D5'; t.fg = '#586E75'; t.inlineBg = '#E4DDC8'; }
  else if (id === 'one-light') { t.bg = '#F2F2F2'; t.fg = '#383A42'; t.inlineBg = '#E5E5E6'; }
  else if (id === 'quiet-light') { t.bg = '#F5F5F5'; t.fg = '#333333'; t.inlineBg = '#E8E8E8'; }
  else if (id === 'dracula') { t.bg = '#282A36'; t.fg = '#F8F8F2'; t.inlineBg = '#343746'; }
  else if (id === 'one-dark') { t.bg = '#282C34'; t.fg = '#ABB2BF'; t.inlineBg = '#31353F'; }
  else if (id === 'monokai') { t.bg = '#272822'; t.fg = '#F8F8F2'; t.inlineBg = '#35362E'; }
  else if (id === 'tokyo-night') { t.bg = '#1A1B26'; t.fg = '#A9B1D6'; t.inlineBg = '#24283B'; }
  else if (id === 'nord') { t.bg = '#2E3440'; t.fg = '#D8DEE9'; t.inlineBg = '#3B4252'; }
  else if (id === 'solarized-dark') { t.bg = '#002B36'; t.fg = '#93A1A1'; t.inlineBg = '#073642'; }
  else if (id === 'night-wolf-gray') { t.bg = '#1E1E1E'; t.fg = '#CCCCCC'; t.inlineBg = '#2A2A2A'; }
  else if (id === 'night-wolf-blue') { t.bg = '#12212E'; t.fg = '#C3D0DD'; t.inlineBg = '#1B2E3E'; }
  else if (id === 'tui-midnight') { t.bg = '#0F1720'; t.fg = '#C7D0D9'; t.inlineBg = '#18222D'; }
  else if (id === 'tui-ocean') { t.bg = '#0B1B24'; t.fg = '#BFD7E0'; t.inlineBg = '#12262F'; }
  else if (id === 'tui-forest') { t.bg = '#0E1A12'; t.fg = '#C2D6C4'; t.inlineBg = '#16261B'; }
  else if (id === 'tui-sunset') { t.bg = '#231407'; t.fg = '#E3C9AE'; t.inlineBg = '#33200F'; }
  else if (id === 'tui-rose') { t.bg = '#231018'; t.fg = '#E6C2CE'; t.inlineBg = '#331824'; }
  else if (id === 'tui-mono') { t.bg = '#141414'; t.fg = '#CCCCCC'; t.inlineBg = '#1F1F1F'; }
  else if (id === 'tui-catppuccin') { t.bg = '#1E1E2E'; t.fg = '#CDD6F4'; t.inlineBg = '#2A2A3C'; }
  else if (id === 'xbot-aurora') { t.bg = '#0B1A18'; t.fg = '#B8E6DC'; t.inlineBg = '#122724'; }
  else if (id === 'xbot-nebula') { t.bg = '#150F26'; t.fg = '#D6C9FF'; t.inlineBg = '#1E1734'; }
  return t;
}

/** 该主题是否为浅色（决定代码块旁的文字用深色还是浅色）。 */
export function isLightMdTheme(id: string): boolean {
  return mdThemeMode(id) === 'light';
}

/** 代码块底/字 —— 便利函数（`MarkdownView` 直接用）。 */
export function codeBgOf(id: string, p: Palette): string {
  const t: CodeTone = codeTone(id);
  const mode: string = mdThemeMode(id);
  // 跟随全局主题模式时（例如全局浅色却选了深色 md 主题）以 md 主题自己的模式为准，
  // 否则会出现"浅色代码块压在深色页面上"的割裂。
  if (mode === 'light') { return t.bg; }
  // 全局浅色（含新增的 porcelain）却选了深色 md 主题 ⇒ 统一用规范深底。
  // ⚠️ 判据必须是**按色板亮度**（isLightPalette），不能把 `lightPalette().appBg`（曾硬编码 '#F8FAFC'）
  //    当魔法常量 —— 否则换色板（porcelain 的 appBg 是 #FFFFFF）后该分支失效。
  if (isLightPalette(p)) { return '#1E1E1E'; }
  return t.bg;
}

export function codeFgOf(id: string): string {
  return codeTone(id).fg;
}
