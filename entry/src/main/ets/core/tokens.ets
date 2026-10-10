/**
 * 尺寸 / 字阶 / 动效 token —— **纯数值，无副作用**（可被任何 .ets 引用，也可脱机单测）。
 *
 * 来源：`.research/design-system.md`（web 全量设计基线；web px 与原 vp 1:1）。
 * ArkTS 约束：本文件**不得**用对象字面量作类型标注（`arkts-no-untyped-obj-literals`）
 * ⇒ 一律 `const` 导出标量 + 数组常量（数组字面量合法）。
 * 另：本文件属 `core/`，会被 `tools/tests/run.sh` 当纯 TS 在 Node 里编译 ⇒
 * **禁止**引用 ArkUI 全局类型（`Curve` 等）。
 */

// ── 圆角阶梯 ────────────────────────────────────────────────────────────────
// 对齐 web：`--radius` 基准 = 8px（=Tailwind lg）；`--radius-md`=6px、`--radius-sm`=4px。
// 余下两档（12/16）取自组件实际硬编码：输入框 `rounded-xl`(12)、用户气泡 `rounded-2xl`(16)。
export const R_SM: number = 4;
export const R_MD: number = 6;
export const R_LG: number = 8;
export const R_XL: number = 12;
export const R_2XL: number = 16;
/** [R_SM, R_MD, R_LG, R_XL, R_2XL]（测试用；严格递增）。 */
export const RADII: number[] = [R_SM, R_MD, R_LG, R_XL, R_2XL];

// ── 间距刻度 ────────────────────────────────────────────────────────────────
// Tailwind 默认 1 单位 = 0.25rem = 4px（web 无自定义 scale）⇒ 本表 = 4 的倍数。
export const SP_1: number = 4;
export const SP_2: number = 8;
export const SP_3: number = 12;
export const SP_4: number = 16;
export const SP_5: number = 20;
export const SP_6: number = 24;
export const SP_7: number = 28;
export const SP_8: number = 32;
/** [SP_1 … SP_8]（测试用；严格递增、均为 4 的倍数）。 */
export const SPACING: number[] = [SP_1, SP_2, SP_3, SP_4, SP_5, SP_6, SP_7, SP_8];

// ── 字阶（fp） ──────────────────────────────────────────────────────────────
// 来源：web 正文 `text-sm`=14px、编辑器 14px；Markdown 标题阶梯 h1 1.4em≈21 / h3 1.1em≈16.5。
export const FS_CAPTION: number = 12; // 说明/徽标（web `text-xs`=12px）
export const FS_BODY: number = 14;    // 正文默认（web `text-sm`=14px；消息正文原生用 15）
export const FS_TITLE: number = 16;   // 小标题（≈ h3 16.5）
export const FS_HERO: number = 21;    // 主标题（≈ h1 1.4em）
/** [FS_CAPTION, FS_BODY, FS_TITLE, FS_HERO]（测试用；严格递增）。 */
export const FONT_SIZES: number[] = [FS_CAPTION, FS_BODY, FS_TITLE, FS_HERO];

// ── 动效时长（ms） ──────────────────────────────────────────────────────────
// 来源：web spring 过渡统一 180ms；入场 200~220ms；Sheet 300/500ms。
export const D_FAST: number = 180;   // hover / 状态过渡（web spring）
export const D_BASE: number = 240;   // 常规入场
export const D_SLOW: number = 320;   // 大块/抽屉
/** [D_FAST, D_BASE, D_SLOW]（测试用；严格递增）。 */
export const DURATIONS: number[] = [D_FAST, D_BASE, D_SLOW];

// ── 缓动 ────────────────────────────────────────────────────────────────────
// web 统一 spring 过渡曲线（`index.css:688-692`）。
export const EASE_SPRING_CSS: string = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
/** 折叠/展开用的 ease-out（web `.animate-*` 同源）。 */
export const EASE_OUT_CSS: string = 'cubic-bezier(0, 0, 0.2, 1)';
// spring 贝塞尔控制点（纯数值，供 ArkUI 端自算/校验）。
export const EASE_SPRING_P1X: number = 0.34;
export const EASE_SPRING_P1Y: number = 1.56;
export const EASE_SPRING_P2X: number = 0.64;
export const EASE_SPRING_P2Y: number = 1;

/**
 * ArkUI 侧确定性可行的等价曲线（**SDK d.ts 已确认**）：
 *
 *  web 的 spring = `cubic-bezier(0.34, 1.56, 0.64, 1)`（回弹 overshoot）。
 *  在 ArkUI 用 `curves.springMotion(response, dampingFraction, overlapDuration)` 复现
 *  （`@ohos.curves.d.ts:371`）—— 三个**建议参数**见下方常量。
 *  - `response`：秒，一次弹跳的响应时长（≈ web 180ms 过渡 ⇒ 取 0.30 略放宽手感）；
 *  - `dampingFraction`：阻尼比，<1 才有 overshoot（web 曲线回弹明显 ⇒ 取 0.65）；
 *  - `overlapDuration`：0 表示不叠加。
 *
 *  退化写法（若不便引入 `@ohos.curves`）：`animateTo({ duration: D_FAST, curve: Curve.Friction })`
 *  —— 已在 `pages/Index.ets:2645,2657` 使用（仓内确认可用）。
 */
export const EASE_SPRING_RESPONSE: number = 0.30;      // 秒（springMotion 第 1 参）
export const EASE_SPRING_DAMPING: number = 0.65;       // 阻尼比（<1 ⇒ 有回弹）
export const EASE_SPRING_OVERLAP: number = 0.0;        // 秒（不叠加）
/** 已确认的退化曲线名（不引入 @ohos.curves 时用）。 */
export const ARKUI_CURVE_SPRING_FALLBACK: string = 'Curve.Friction';
