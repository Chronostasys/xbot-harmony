"use strict";
/**
 * 语义色板（**全应用唯一颜色来源**）+ 深/浅双色板。
 *
 * 为什么必须先做这一步：改造前有 378 处硬编码颜色字面量散落在页面与组件里，
 * 直接"换个背景色"会得到一半深一半浅的破碎界面。正确做法是把颜色按**角色**收敛
 * （背景/卡片/正文/次要/边框/强调/成功/警告/危险），主题只决定这套角色的取值，
 * 换主题 = 换色板，不碰任何布局代码。
 *
 * 判据（可量化）：`theme.ets` 之外不再出现 `#RRGGBB` 字面量。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEME_LIGHT = exports.THEME_DARK = exports.Palette = void 0;
exports.darkPalette = darkPalette;
exports.lightPalette = lightPalette;
exports.paletteOf = paletteOf;
exports.normalizeTheme = normalizeTheme;
exports.themeLabel = themeLabel;
exports.toggleTheme = toggleTheme;
exports.paletteValues = paletteValues;
exports.paletteComplete = paletteComplete;
/** 一套语义色板。字段名就是"用途"，不是"颜色"—— 这样浅色主题才可能正确。 */
class Palette {
    constructor() {
        /** 最底背景（页面） */
        this.appBg = '';
        /** 卡片/输入框底色 */
        this.surface = '';
        /** 次级卡片底色（菜单项、pill） */
        this.surfaceAlt = '';
        /** 选中/高亮底色 */
        this.surfaceHi = '';
        /** 正文 */
        this.textPrimary = '';
        /** 次要文字 */
        this.textSecondary = '';
        /** 更弱的说明文字 */
        this.textMuted = '';
        /** 强调色背景（主按钮） */
        this.accent = '';
        /** 强调色的浅色形态（链接、可点文字） */
        this.accentSoft = '';
        /** 强调色的深色形态（徽标/标签） */
        this.accentDeep = '';
        /** 强调色上的文字（标签内文字） */
        this.accentText = '';
        /** 主按钮上的文字 */
        this.onAccent = '';
        /** 用户气泡底色 */
        this.bubbleUser = '';
        /** 边框 */
        this.border = '';
        /** 更明显的边框（次要按钮） */
        this.borderStrong = '';
        /** 成功/开启 */
        this.success = '';
        /** 成功文字 */
        this.successText = '';
        /** 警告/注意 */
        this.warn = '';
        /** 警告底色（提示条） */
        this.warnBg = '';
        /** 危险按钮底 */
        this.dangerBg = '';
        /** 危险文字/图标 */
        this.dangerText = '';
        /** 完全透明的占位（拱形/分隔用） */
        this.transparent = '';
    }
}
exports.Palette = Palette;
exports.THEME_DARK = 'dark';
exports.THEME_LIGHT = 'light';
/** 深色（改造前的既定观感，逐值保留 —— 换 token 不改观感）。 */
function darkPalette() {
    const p = new Palette();
    p.appBg = '#0B0F19';
    p.surface = '#0F172A';
    p.surfaceAlt = '#111827';
    p.surfaceHi = '#1F2937';
    p.textPrimary = '#E5E7EB';
    p.textSecondary = '#9CA3AF';
    p.textMuted = '#6B7280';
    p.accent = '#7C3AED';
    p.accentSoft = '#93C5FD';
    p.accentDeep = '#4C1D95';
    p.accentText = '#C4B5FD';
    p.onAccent = '#FFFFFF';
    p.bubbleUser = '#6D28D9';
    p.border = '#1F2937';
    p.borderStrong = '#374151';
    p.success = '#059669';
    p.successText = '#A7F3D0';
    p.warn = '#FCD34D';
    p.warnBg = '#1C1917';
    p.dangerBg = '#7F1D1D';
    p.dangerText = '#F87171';
    p.transparent = '#00000000';
    return p;
}
/** 浅色（同角色、反相取值；对比度按 WCAG AA 目标约 4.5:1 选值）。 */
function lightPalette() {
    const p = new Palette();
    p.appBg = '#F8FAFC';
    p.surface = '#FFFFFF';
    p.surfaceAlt = '#F1F5F9';
    p.surfaceHi = '#E2E8F0';
    p.textPrimary = '#0F172A';
    p.textSecondary = '#475569';
    p.textMuted = '#94A3B8';
    p.accent = '#6D28D9';
    p.accentSoft = '#1D4ED8';
    p.accentDeep = '#EDE9FE';
    p.accentText = '#5B21B6';
    p.onAccent = '#FFFFFF';
    p.bubbleUser = '#6D28D9';
    p.border = '#E2E8F0';
    p.borderStrong = '#CBD5E1';
    p.success = '#047857';
    p.successText = '#065F46';
    p.warn = '#92400E';
    p.warnBg = '#FEF3C7';
    p.dangerBg = '#DC2626';
    p.dangerText = '#B91C1C';
    p.transparent = '#00000000';
    return p;
}
/** 取色板（未知主题回落深色 —— 深色是既有默认）。 */
function paletteOf(theme) {
    return theme === exports.THEME_LIGHT ? lightPalette() : darkPalette();
}
/** 规范化主题名（未知值回落 dark）。 */
function normalizeTheme(v) {
    return v === exports.THEME_LIGHT ? exports.THEME_LIGHT : exports.THEME_DARK;
}
/** 主题显示名。 */
function themeLabel(theme) {
    return theme === exports.THEME_LIGHT ? '浅色' : '深色';
}
/** 切换主题。 */
function toggleTheme(theme) {
    return normalizeTheme(theme) === exports.THEME_LIGHT ? exports.THEME_DARK : exports.THEME_LIGHT;
}
/**
 * 色板的所有取值（**枚举而非反射**）。
 *
 * 为什么不用 `Object.keys` + 转型：ArkTS 禁止 `as unknown`（`arkts-no-any-unknown`）。
 * 新增字段必须加进这个列表 —— 测试里有「字段数 == 列表长度」的核对，漏加会红。
 */
function paletteValues(p) {
    return [
        p.appBg, p.surface, p.surfaceAlt, p.surfaceHi,
        p.textPrimary, p.textSecondary, p.textMuted,
        p.accent, p.accentSoft, p.accentDeep, p.accentText, p.onAccent, p.bubbleUser,
        p.border, p.borderStrong,
        p.success, p.successText, p.warn, p.warnBg, p.dangerBg, p.dangerText, p.transparent,
    ];
}
/** 色板是否完整（每个角色都有值 —— 防止新增字段忘了填两套色板）。 */
function paletteComplete(p) {
    const vs = paletteValues(p);
    for (let i = 0; i < vs.length; i++) {
        if (vs[i].length === 0) {
            return false;
        }
    }
    return true;
}
