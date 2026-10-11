/**
 * 消息行**入场动效**的纯逻辑（可脱机单测；不 import ArkUI / `@ohos.*`）。
 *
 * ── 本文件存在的唯一理由（可读性地板）──────────────────────────────────────────
 * **消息正文的可读性，不得是入场动画的函数。**
 *
 * web 权威（`web/src/index.css:683-714`）天然满足这条：
 *   ```css
 *   .animate-msg-in > * { animation: msgIn 200ms cubic-bezier(0.34,1.56,0.64,1); }
 *   @keyframes msgIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
 *   ```
 *   · 元素**自身**的 `opacity` 仍是 `1`（关键帧只描述 `from`→`to` 的**过程**）；
 *   · 关键帧**没有** `forwards` ⇒ 动画放完 / 没跑 / 被打断，元素都停在自身值 `1`。
 *   ⇒ CSS 的 keyframe 入场是**天然 fail-safe** 的：最坏情况只是"没有动画"，绝不是"看不见"。
 *
 * 本仓的宿主移植曾把这条**写反**（`components/MessageRow.ets` 旧实现）：
 *   把**静息态**写成 `.opacity(entered ? 1 : 0)`（`entered` 初始 `false`），再靠
 *   `.onAppear` 里的 `animateTo` 把它拉起来 ⇒ **可读性押在动画上**：
 *     · `onAppear` 未触发（挂载时机 / 条件渲染 / 复用路径跳过）⇒ `entered` 永不置 true；
 *     · 动画被**后台冻结**（HOME 后回前台）或 **20Hz 流式重建**打断 ⇒ 渲染值停在半路。
 *   两者都把正文永久压在低不透明度上。用户实证（2026-10-11，极简白主题，真机截图）：
 *   正文最暗 `#D4D4D6` 压底 `#F2F2F2` ⇒ **1.32:1**（≈ `textPrimary @13%`），而同屏其它
 *   文字 21:1 正常 —— 即"同一帧里有人清晰、有人被淡化"。
 *
 * ── 修法（本文件给出判据，组件按它接线）──────────────────────────────────────────
 * ArkUI 里 CSS keyframe 入场的**等价物是「出现过渡」**（`TransitionEffect`）：
 *   静息态 = 组件自己的属性（= `entryRestOpacity()` = 1），过渡只是"挂载那一下"的装饰。
 *   ⇒ 过渡不跑 / 被打断 ⇒ 停在静息态（可读），**不需要任何状态位、任何 onAppear 释放**。
 *
 * `entryRestOpacity()` 是**可读性地板的唯一取值出口**：组件的行内容必须用它收口，
 * 不允许再出现第二个"把静息不透明度写成 0"的地方（判据见
 * `tools/tests/msg_entry_contrast.test.ts`，含 mutation 自证）。
 */

/**
 * 入场**起始**不透明度（= web `@keyframes msgIn` 的 `from{opacity:0}`）。
 * ⚠️ 它**只允许**出现在"出现过渡"的起点，绝不允许成为任何状态位的静息取值。
 */
export const ENTRY_FROM_OPACITY: number = 0;

/** 入场**起始**下沉量（vp，= web `from{transform:translateY(4px)}`）。 */
export const ENTRY_FROM_DY: number = 4;

/**
 * 行内容**静息**不透明度 —— **可读性地板**。
 *
 * ⛔ 这是本模块最重要的常量：没动画 / 动画被打断 / 动画跑完，取的都是它。
 *    任何把它调小（"半透明看着更柔和"之类）的改动都会直接把正文压进不可读区，
 *    门禁 `msg_entry_contrast.test.ts` 会用真实对比度算出来并判红。
 */
export const ENTRY_REST_OPACITY: number = 1;

/** 正文可读性地板（WCAG AA 正文级，与 `theme_contrast` 台账同一阈值）。 */
export const BODY_CONTRAST_FLOOR: number = 4.5;

/**
 * 该行是否播入场动效 —— **唯一判据**（组件不得自带第二套）。
 *
 * 对齐 web `TurnBody`：只有**在飞（live）行**播（`row.id === liveId`）；
 * 历史行随滚动创建，逐行闪入会读成"滚动时在抖"（web 同款纪律）。
 */
export function entryAnimates(isLive: boolean): boolean {
  return isLive;
}

/** 行内容**静息**不透明度（唯一出口）。 */
export function entryRestOpacity(): number {
  return ENTRY_REST_OPACITY;
}

/** 入场起始不透明度（唯一出口）。 */
export function entryStartOpacity(): number {
  return ENTRY_FROM_OPACITY;
}

/** 入场起始下沉（唯一出口）。 */
export function entryStartDy(): number {
  return ENTRY_FROM_DY;
}

/**
 * 把"不透明度"折进颜色，得到 ArkUI/WCAG 帮助函数都认的 `#AARRGGBB` 字面量。
 *
 * 为什么放在这里：**判据与渲染同源** —— 门禁要算的正是"正文在某个不透明度下压在该主题
 * 画布上"的真实对比度，而不是另写一份 alpha 数学。纯字符串运算，无 SDK 依赖。
 */
export function withOpacity(hex: string, opacity: number): string {
  const digits: string = '0123456789ABCDEF';
  let a: number = opacity;
  if (!(a >= 0)) { a = 0; }
  if (a > 1) { a = 1; }
  const byte: number = Math.round(a * 255);
  const hi: string = digits.charAt(Math.floor(byte / 16));
  const lo: string = digits.charAt(byte % 16);
  const body: string = hex.charAt(0) === '#' ? hex.substring(1) : hex;
  const rgb: string = body.length === 8 ? body.substring(2) : body;
  return `#${hi}${lo}${rgb.toUpperCase()}`;
}

/**
 * **判据本体**：给定主题画布色与"行内容此刻的不透明度"，正文（`textPrimary`）是否仍达
 * 正文可读性地板。
 *
 * 组件侧用它接线的方式是"恒取 `entryRestOpacity()`"；门禁侧则对**所有主题**复算它，
 * 并对"把静息态写成 0（旧实现）"这类改动判红（见 mutation 自证）。
 *
 * @param textPrimary 该主题的正文前景色（`Palette.textPrimary`）
 * @param canvas      该主题下正文实际压着的底（`Palette.surface`）
 * @param opacity     行内容此刻的不透明度（0..1）
 * @param contrastRatioFn 对比度实现（**必须传 `core/theme.ets` 的唯一实现**，不许另写）
 * @param compositeOverFn 半透明合成实现（**必须传 `core/theme.ets` 的唯一实现**）
 */
export function bodyReadableAt(
  textPrimary: string,
  canvas: string,
  opacity: number,
  contrastRatioFn: (a: string, b: string) => number,
  compositeOverFn: (top: string, bottom: string) => string): boolean {
  const effective: string = opacity >= 1
    ? textPrimary
    : compositeOverFn(withOpacity(textPrimary, opacity), canvas);
  return contrastRatioFn(effective, canvas) >= BODY_CONTRAST_FLOOR;
}
