/**
 * bubble.ets —— 气泡 / 迭代间距样式的**唯一映射表**（web 类名 → 原生数值）。
 *
 * 用户 2026-10-10 ②：「现在这种气泡设计是不是有点丑？直接改一下」，要求**以 web 的类名
 * 为准逐条映射**（`web/src/components/agent/{AssistantMessage,UserMessage,IterationHistory,
 * TurnBody}.tsx` 及其容器 class）。本模块把那些 class **逐条**翻译成原生数值常量，
 * 页面/组件只引用这些常量 —— 于是「对齐 web」有唯一来源，可单测断言。
 *
 * 单位换算：Tailwind 的 1rem = 16px；原生 vp 与 web px 1:1。
 *
 * │ web class（来源文件）                     │ 值            │ 原生字段          │
 * │-------------------------------------------|---------------|-------------------|
 * │ `rounded-2xl`（UserMessage 气泡）          │ 1rem = 16px   │ userRadiusAll     │
 * │ `rounded-br-sm`（UserMessage 气泡右下角）  │ 0.125rem = 2  │ userRadiusBR      │
 * │ `px-3.5`（UserMessage 气泡）               │ 0.875rem = 14 │ userPadX          │
 * │ `py-2`（UserMessage 气泡）                 │ 0.5rem = 8    │ userPadY          │
 * │ `bg-accent/15`（UserMessage 气泡底）        │ accent @15%   │ userBubbleAlpha   │
 * │ `max-w-[85%]`（UserMessage 列）            │ 85%           │ userMaxWidthPct   │
 * │ `px-1`（AssistantMessage 外框）            │ 0.25rem = 4   │ assistantPadX     │
 * │ `.iter-block{margin-top:0.25rem}`（TurnBody）│ 4px         │ iterGap           │
 * │ `gap-1`（IterationGroup / LiveIteration）  │ 0.25rem = 4   │ blockInnerGap     │
 * │ `py-1.5`（MessageList `.virt-row`）        │ 0.375rem = 6  │ rowPadY           │
 *
 * ⛔ AssistantMessage 的容器是 `group/msg px-1` —— **没有** `bg-*` / `border*` /
 *   `rounded*` / `shadow*`（CopyTarget 不渲染任何可见 UI）。故原生助手容器同样**不带
 *   气泡 chrome**（无底色/边框/圆角/阴影），只保留 `px-1` 的水平内边距与 virt-row 的
 *   垂直间距。这就是「对齐 web」的结果，不是漏改。
 */
import { Palette } from './theme';

/** web 类名 → 原生数值（全部来自上述映射表）。 */
export class BubbleMetrics {
  /** `rounded-2xl`：用户气泡四角圆角（1rem）。 */
  userRadiusAll: number = 16;
  /** `rounded-br-sm`：用户气泡**右下角**单独收小（0.125rem）。 */
  userRadiusBR: number = 2;
  /** `px-3.5`：用户气泡水平内边距。 */
  userPadX: number = 14;
  /** `py-2`：用户气泡垂直内边距。 */
  userPadY: number = 8;
  /** `bg-accent/15`：用户气泡底色透明度（accent @15%）。 */
  userBubbleAlpha: number = 0.15;
  /** `max-w-[85%]`：用户气泡最大宽度（百分比）。 */
  userMaxWidthPct: number = 85;
  /** `px-1`：助手容器/用户外框水平内边距。 */
  assistantPadX: number = 4;
  /** `.iter-block{margin-top:.25rem}`：迭代块之间（及首个块之前）的间距。 */
  iterGap: number = 4;
  /** `gap-1`：迭代块内部（思考/正文/工具）之间间距。 */
  blockInnerGap: number = 4;
  /** `py-1.5`（`.virt-row`）：每条消息行的垂直间距。 */
  rowPadY: number = 6;
}

/** 唯一实例（组件只引用它）。 */
export const BUBBLE: BubbleMetrics = new BubbleMetrics();

/**
 * `'#RRGGBB'` + alpha(0..1) → `'#AARRGGBB'`（ArkUI 的 ARGB 字面量语义）。
 * 用于复现 web 的 `/15` 透明度修饰（`bg-accent/15`）。
 */
export function withAlpha(hex: string, alpha: number): string {
  const h: string = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  let a: number = Math.round(alpha * 255);
  if (a < 0) { a = 0; }
  if (a > 255) { a = 255; }
  const digits: string = '0123456789ABCDEF';
  const hi: string = digits.charAt(Math.floor(a / 16));
  const lo: string = digits.charAt(a % 16);
  return `#${hi}${lo}${h.slice(0, 6).toUpperCase()}`;
}

/** 用户气泡底色 = 主题 accent @15%（web `bg-accent/15`）。 */
export function userBubbleBg(p: Palette): string {
  return withAlpha(p.accent, BUBBLE.userBubbleAlpha);
}
