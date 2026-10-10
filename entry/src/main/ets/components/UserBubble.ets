/**
 * 用户气泡（从页面抽出的**可复用组件**）。
 *
 * 依据 harmony-next skill 的《应用体验与性能规范》§2 帧率优化：
 * 「对于长列表，务必使用 `LazyForEach`…结合 `@Reusable` 装饰器实现组件级复用，
 *   降低创建和销毁的开销」；§1「主线程解放」。
 * 这里只接**原始类型**（text/theme）与回调，避免 @Prop 深拷贝对象（ArkUI @Prop 对对象是拷贝语义）。
 */
import { Palette, paletteOf } from '../core/theme';

@Component
@Reusable
export struct UserBubbleView {
  @Prop text: string = '';
  @Prop theme: string = 'dark';
  /** 长按（页面据此弹"复制"菜单） */
  onLongPress: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row() {
      Blank()
      Text(this.text)
        .wordBreak(WordBreak.BREAK_ALL)
        .fontSize(15).fontColor(this.pal().textPrimary).padding(12)
        .constraintSize({ maxWidth: '78%' })
        .backgroundColor(this.pal().bubbleUser).borderRadius(12)
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%').padding({ top: 6, bottom: 6 })
    .gesture(LongPressGesture().onAction(() => {
      this.onLongPress();
    }))
  }
}
