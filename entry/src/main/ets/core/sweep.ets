/**
 * 「运行中」工具 pill 扫光的**取色口径**（纯函数 —— 判据与渲染同源）。
 *
 * 现状（波5 前）：`components/MessageRow.ets:732-736` 直接把
 * `accentSoftFade → accentSoft → sheen → accentSoft → accentSoftFade` 铺成一道横向渐变带
 * （`.translate({ x: sweepX })` 逐帧推进）。深色主题下这是**观感来源**（彩色 accent 扫光）；
 * 但浅色主题（`light` / `porcelain`）下，彩色 accent 压在纯白上读作**彩色脏光晕** —— 与
 * `1ae9def` 定下的口径「浅色不得出现彩色脏光晕」冲突（`docs/PORCELAIN-AUDIT.md §3-🟡-3`）。
 *
 * 本模块把"该用哪三色"收敛成一个纯函数 `sweepBandOf(p)`（判据与渲染同源：渲染层只调它）：
 *   · **深色** ⇒ **逐字节 = 原值**（`Palette.accentSoftFade` / `Palette.accentSoft` / `Effects.sheen`）；
 *   · **浅色** ⇒ 落**中性**，与 `Effects.glow`（= `textPrimary@16%`）/ `Effects.glowSoft`（= `textPrimary@10%`）
 *     **同口径** —— 加色光压在纯白上物理不可见，中性柔影才是正确读法：
 *       `glowSoft`（淡出端）→ `glow`（色带主体）→ `sheen`（黑色微高光）。
 *
 * ⛔ **零色字面量**：全部取 `Palette` 字段 / `effectsOf` 派生口，颜色一律来自语义出口。
 * ⛔ **判据用 `isLightPalette`**（按 `appBg` 感知亮度），**不按主题名硬判**（新色板/改 appBg 自动成立）。
 *
 * ⚠️ 与 web 的关系（诚实记账）：web 对应实现是 `SweepText.tsx`（消费点
 *   `FoldedToolGroup.tsx:289` / `LiveIteration.tsx:206`；CSS `index.css:716-745`），它是**字符级**
 *   （逐字 opacity 或文字渐变），取色 = 工具**分类色**（`statusColorVar`）—— web **在浅色下也保留
 *   彩色**、并**不做**中性化。⇒ 本模块的"浅色落中性"是**本仓设计系统口径**（`1ae9def` +
 *   `docs/PORCELAIN-AUDIT.md §3-🟡-3` 的 design-lead 裁决），**不是** web 对齐项；深色保持彩色
 *   扫光即保留了与 web 同源的"运行中=分类色扫光"语义。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/sweep.test.ts`）。本文件属 `core/`，会被 `tools/tests/run.sh`
 * 当**纯 TS** 在 Node 里编译 ⇒ **禁止** import ArkUI / `@ohos.*`；也须避开 ArkTS 严格规则
 * （禁 `is` 类型谓词、禁对象字面量作类型标注 ⇒ 用 class）。
 */

import { Effects, Palette, effectsOf, isLightPalette } from './theme';

/** 扫光渐变带的三色（对应 `linearGradient` 的三档 stop：0.0·1.0 / 0.35·0.65 / 0.5）。 */
export class SweepBand {
  /** 淡出端（stop 0.0 / 1.0）—— 色带到两端淡出。 */
  fade: string = '';
  /** 色带主体（stop 0.35 / 0.65）。 */
  core: string = '';
  /** 中心高光（stop 0.5）。 */
  sheen: string = '';
}

/**
 * 由色板派生「运行中」扫光的三色（**唯一取色口径**）。
 * @param p `paletteOf(theme)` 得到的色板。
 */
export function sweepBandOf(p: Palette): SweepBand {
  const e: Effects = effectsOf(p);
  const b: SweepBand = new SweepBand();
  if (isLightPalette(p)) {
    // 浅色：落中性（同 `Effects.glow/glowSoft` 口径 —— textPrimary 的极低 alpha）。
    // 强弱序保持（core=`glow`(16%) 强于 fade=`glowSoft`(10%)，与深色 core 强于 fade 同向）。
    b.fade = e.glowSoft;
    b.core = e.glow;
    b.sheen = e.sheen;
  } else {
    // 深色：**逐字节不变**（彩色 accent 扫光 = 观感来源，其他线依赖它）。
    b.fade = p.accentSoftFade;
    b.core = p.accentSoft;
    b.sheen = e.sheen;
  }
  return b;
}
