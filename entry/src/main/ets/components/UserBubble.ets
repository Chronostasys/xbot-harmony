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
import { Palette, paletteOf, Effects, effectsOf } from '../core/theme';
import { BUBBLE, userBubbleBg } from '../core/bubble';

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

  /** 视觉效果 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }

  build() {
    Row() {
      Blank()
      Text(this.text)
        .wordBreak(WordBreak.BREAK_ALL)
        .fontSize(15).fontColor(this.pal().onAccent)
        .padding({
          left: BUBBLE.userPadX, right: BUBBLE.userPadX,
          top: BUBBLE.userPadY, bottom: BUBBLE.userPadY,
        })
        .constraintSize({ maxWidth: `${BUBBLE.userMaxWidthPct}%` })
        // 映射表底色（accent @15%）+ 设计系统渐变叠层（accent → accentSoft，135°）
        .backgroundColor(userBubbleBg(this.pal()))
        .linearGradient({
          angle: 135,
          colors: [[this.eff().gradientFrom, 0.0], [this.eff().gradientTo, 1.0]],
        })
        // `rounded-2xl rounded-br-sm`：四角 16、右下角单独收小（"气泡尾巴"感）
        .borderRadius({
          topLeft: BUBBLE.userRadiusAll, topRight: BUBBLE.userRadiusAll,
          bottomLeft: BUBBLE.userRadiusAll, bottomRight: BUBBLE.userRadiusBR,
        })
        .shadow({ radius: 12, color: this.eff().elev1, offsetX: 0, offsetY: 2 })
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    // 外层 `px-1` + `.virt-row py-1.5`（与助手行同一条带）
    .padding({
      left: BUBBLE.assistantPadX, right: BUBBLE.assistantPadX,
      top: BUBBLE.rowPadY, bottom: BUBBLE.rowPadY,
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onLongPress();
    }))
  }
}
