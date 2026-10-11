/**
 * bubbleview.ets —— **用户气泡的展示判据**（纯函数，可脱机单测）。
 *
 * 为什么单独抽出：`components/UserBubble.ets` 此前把"底色"写成**两个互相打架的来源**
 *   · `.backgroundColor(userBubbleBg(pal))` —— 映射表口径 = accent @15%（**对齐 web**）；
 *   · **又**叠了一层 `.linearGradient({colors:[[eff.gradientFrom,0],[eff.gradientTo,1]]})`
 *     —— 两端色是 `accent` / `accentSoft`，**全不透明** ⇒ 把下面那层盖住，屏幕上是
 *     "饱和 accent 色块"（真机实测：深色 = 饱和紫渐变）。web 的用户气泡**没有**渐变。
 * 文字色又误用了 `onAccent`（`Palette` 里它的角色是"**实心** accent 之上的字"），
 * 而真实底色是**淡色**（accent @15%）⇒ 对比角色不匹配（浅色系会白字压极浅底）。
 *
 * 本模块把「底色**一处**来源 + 文字色与底色配对」收敛成**唯一判据**，组件只消费它
 * ⇒ 语义可断言、可 mutation（改回旧行为必红）。
 *
 * ── web 权威（`web/src/components/agent/UserMessage.tsx`）─────────────────────────
 *   · `:266` 气泡 class `rounded-2xl rounded-br-sm px-3.5 py-2`（圆角/内边距，原生走 `core/bubble.ets`）；
 *   · `:272` **`bg-accent/15 text-text-primary`** —— 底色 = accent @15%，文字 = textPrimary；
 *   · `:234` 外层 `flex justify-end px-1`；`:235` `max-w-[85%]`；
 *   · 全篇**无** `linear-gradient`、**无** shadow ⇒ 原生**不得**再叠加渐变/新装饰。
 *
 * ⛔ 不做浅/深色分叉：web 对两种主题用的是**同一对** class（`bg-accent/15` + `text-text-primary`），
 *   而这两枚 token 本身**已经**随主题取值（浅色系 `textPrimary` 是深字、深色系是浅字）
 *   ⇒ 逐字对齐 web。**不引入** `isLightPalette` 分支（那会是 web 没有的"第二套判据"）。
 */
import { Palette } from './theme';
import { userBubbleBg } from './bubble';

/**
 * 用户气泡的"面" = 底色 + 与底色配对的正文色。**唯一来源**。
 * （类名**不能**叫 `UserBubbleView`：与 `components/UserBubble.ets` 的组件同名会撞 import。）
 */
export class UserBubbleFace {
  /** 底色 = 主题 accent @15%（web `bg-accent/15`）。 */
  bg: string = '';
  /** 正文色 = `textPrimary`（web `text-text-primary`）——**不是** `onAccent`。 */
  textColor: string = '';
}

/** 构造用户气泡的展示面（唯一判据；`components/UserBubble.ets` 只调它）。 */
export function userBubbleFace(p: Palette): UserBubbleFace {
  const f: UserBubbleFace = new UserBubbleFace();
  f.bg = userBubbleBg(p);        // accent @15%（唯一底色来源）
  f.textColor = p.textPrimary;   // 与淡色底配对的正文角色
  return f;
}
