/**
 * 用户气泡（从页面抽出的组件）。
 *
 * ⛔ 同上：@Reusable 的复用必须在 `aboutToReuse(params)` 里更新数据，否则复用实例会保留
 * **旧参数**（@Prop 也不会自动刷新）⇒ 跨会话串内容。先用无复用的正确版本。
 *
 * 依据 harmony-next skill 的《应用体验与性能规范》§2 帧率优化：
 * 「对于长列表，务必使用 `LazyForEach`…结合 `@Reusable` 装饰器实现组件级复用，
 *   降低创建和销毁的开销」；§1「主线程解放」。
 * 这里只接**原始类型**（text/theme）与回调，避免 @Prop 深拷贝对象（ArkUI @Prop 对对象是拷贝语义）。
 *
 * 样式**逐条映射 web**（`core/bubble.ets` 是唯一映射表）：
 *   · 气泡 `rounded-2xl rounded-br-sm` ⇒ 四角 16、右下 2；
 *   · `px-3.5 py-2` ⇒ 水平 14 / 垂直 8；
 *   · `bg-accent/15` ⇒ 主题 accent @15%；
 *   · `max-w-[85%]` ⇒ 最大宽度 85%；
 *   · 外层 `px-1` + `.virt-row py-1.5` ⇒ 水平 4 / 垂直 6。
 */
import { Palette, paletteOf } from '../core/theme';
import { BUBBLE } from '../core/bubble';
import { UserBubbleFace, userBubbleFace } from '../core/bubbleview';
import { GAP_ROW_Y, INSET_BUBBLE_X, INSET_BUBBLE_Y, RADIUS_BUBBLE, typeOf } from '../core/design';

@Component
export struct UserBubbleView {
  @Prop text: string = '';
  @Prop theme: string = 'dark';
  /** 长按（页面据此弹"复制"菜单） */
  onLongPress: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 用户气泡的"面"（**唯一判据**：底色 + 与之配对的文字色）。
   *
   * ⛔ 底色**只此一处**：曾经这里 `.backgroundColor(...)` 与 `.linearGradient(...)` 叠了两层
   *   （后者不透明，盖住前者 ⇒ 屏幕上成饱和 accent 色块，与 web 的 `bg-accent/15` 不符）。
   *   现收敛到 `core/bubbleview.ets` 的 `userBubbleFace()`，web 权威见该文件头。
   */
  private face(): UserBubbleFace {
    return userBubbleFace(this.pal());
  }

  build() {
    Row() {
      Blank()
      Text(this.text)
        .wordBreak(WordBreak.BREAK_ALL)
        // 字号走语义层 `type.body`（15fp）；文字色 = 与淡色底配对的 `textPrimary`（web `text-text-primary`）。
        // ⛔ 不再用 `onAccent`（那是"实心 accent 之上的字"的角色，与 accent@15% 淡底不匹配）。
        .fontSize(typeOf('type.body').size).fontColor(this.face().textColor)
        // 内距 = 语义令牌 `INSET_BUBBLE_X/Y`（14/8，**值 ==** 原映射表 `px-3.5 py-2`）⇒ 等值迁移。
        .padding({
          left: INSET_BUBBLE_X, right: INSET_BUBBLE_X,
          top: INSET_BUBBLE_Y, bottom: INSET_BUBBLE_Y,
        })
        .constraintSize({ maxWidth: `${BUBBLE.userMaxWidthPct}%` })
        // 底色**唯一来源**：主题 accent @15%（映射表 `core/bubble.ets` / web `bg-accent/15`）。
        // ⛔ 不再叠渐变：web 气泡没有渐变，叠加会变成 web 之外的第二种底色。
        .backgroundColor(this.face().bg)
        // 四角 16 = 语义令牌 `RADIUS_BUBBLE`（等值）；右下角单独收小 —— 原 `BUBBLE.userRadiusBR`=2，
        // 令牌 `RADIUS_BUBBLE_TAIL`=4 **值不等** ⇒ 保留原值，见交付的"待裁决"清单。
        .borderRadius({
          topLeft: RADIUS_BUBBLE, topRight: RADIUS_BUBBLE,
          bottomLeft: RADIUS_BUBBLE, bottomRight: BUBBLE.userRadiusBR,
        })
        // ⛔ 不再叠 `.shadow(...)`：web `UserMessage.tsx` 的用户气泡**无阴影**（`docs/REDESIGN.md §7.1`
        //   也把气泡定义为"**有面**：着色底 + 圆角 + 右对齐 + 右下小角" —— 靠**填充**区分，
        //   不靠投影）。原实现是一记字面量投影（`radius:12 / offsetY:2`，未进 token）⇒ 既非
        //   web 语言、又与"助手容器无阴影"（`bubble_style.test.ts` 同款守卫）不一致。
        //   ⇒ 删除投影，回到"只有面"的极简语言（纯白主题下也没有需要柔影分离的浮层语义）。
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    // 外层 `px-1` + `.virt-row py-1.5`（与助手行同一条带）；垂直间距 = 语义令牌 `GAP_ROW_Y`
    // （6，**值 ==** 原 `BUBBLE.rowPadY`）⇒ 等值迁移。
    .padding({
      left: BUBBLE.assistantPadX, right: BUBBLE.assistantPadX,
      top: GAP_ROW_Y, bottom: GAP_ROW_Y,
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onLongPress();
    }))
  }
}
