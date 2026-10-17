/**
 * SessionLoadingSplash —— **切会话加载态**（`switchSession` 的真网络等待窗口）。
 *
 * 唯一消费方：`pages/Index.ets`（`this.switchSplash && !this.showSplash`）+
 * 预览页 `pages/SplashPreview.ets`（开发期确定性渲染，不再靠真机连拍碰运气）。
 *
 * ⛔ 为什么抽出组件（用户 2026-10-16 亲报三连）：
 *   原实现是 `Index.ets` 里内联的一段 `Column{spinner+一行字}`，三个缺陷：
 *     ① **不居中**（`padding top` ⇒ 顶在列表顶部，用户原话「还没有竖直居中」）；
 *     ② **元素太寡**（只有一个 spinner + 一行字，「只有个光球+加载中」）；
 *     ③ 与冷启动遮罩**叠加**（冷启动时 `openSession` 也置 `switchSplash` ⇒ 冷遮罩先撤、
 *        本层后撤 = 用户原话「加载完毕后光球消失还比黑色遮罩慢」）—— 该闸门由调用方负
 *        （Index 侧 `&& !this.showSplash`）。
 *
 * **质感**（用户 2026-10-16：「必须比苹果好看，让人觉得比苹果的设计还高级」）：
 *   · 品牌标记背后一层**柔和径向辉光**（`effectsOf().glowSoft` ⇒ 深色彩色微光/浅色极轻，
 *     ⛔ 颜色全部来自令牌，零字面量；中心到边缘自然衰减 ⇒ 不是"贴一个圆"）；
 *   · 层次 = 光晕 → 标记 → 指示器 → 主文案 → 副文案（5 层，间距按 token 递进）；
 *   · 文案分工：主文案给"是什么"，副文案给"为什么慢"（⛔ 不写"请稍候"这类空话）。
 *   · 静息态**恒可见**（门禁⑨：可读性不得是动画的函数）——本组件不含入场动画。
 */
import { Palette, paletteOf, effectsOf } from '../core/theme';
import { SP_1, SP_2, SP_4, SP_8 } from '../core/tokens';
import { typeOf } from '../core/design';

/**
 * 品牌标记边长（vp）—— 视觉锚点。
 * ⛔ 用户 2026-10-16 三次亲报「logo 小」：56 → 72 → 96 → **120**。
 *    （PNG 自带留白+尾巴 ⇒ 实际可见宽度 ≈ 盒子的 77%：120 ⇒ 可见 ≈ 92vp。）
 */
const LOADING_MARK_VP: number = 120;
/**
 * 辉光直径（vp）。
 * ⛔ **不参与布局**（见 build：Stack 的宽高 = 标记边长，辉光作为**溢出**子节点）——
 *    上一版把辉光当 280vp 的盒子，直接把下方文案顶下去 ⇒ 用户亲报
 *    「logo 和文字之间留那么大的间隙」。溢出不占位 ⇒ 间隙回归 `Column space`。
 */
const LOADING_GLOW_VP: number = 320;

@Component
export struct SessionLoadingSplash {
  /** 应用主题名（⛔ 本层**跟随应用主题**，与开屏的恒定品牌深色不同 —— 它是应用内态）。 */
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SP_4 }) {
      // ── 光晕 + 品牌标记（辉光**溢出**、不占布局 ⇒ 与文字的间隙 = `Column space`）──
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(LOADING_GLOW_VP).height(LOADING_GLOW_VP)
          .borderRadius(LOADING_GLOW_VP / 2)
          .radialGradient({
            center: ['50%', '50%'],
            radius: LOADING_GLOW_VP / 2,
            colors: [[effectsOf(this.pal()).glowSoft, 0.0], [this.pal().transparent, 1.0]],
          })
        Image($r('app.media.start_icon'))
          .width(LOADING_MARK_VP).height(LOADING_MARK_VP)
          .objectFit(ImageFit.Contain)
      }
      // ⛔ 盒子 = **标记**尺寸（不是辉光尺寸）：辉光溢出显示、不把下方文案顶开。
      .width(LOADING_MARK_VP).height(LOADING_MARK_VP)

      // ── 指示器 + 文案 ──
      Column({ space: SP_2 }) {
        LoadingProgress().width(24).height(24).color(this.pal().accent)
        Text('会话加载中…')
          .fontSize(typeOf('type.subhead').size)
          .fontWeight(typeOf('type.subhead').weight)
          .fontColor(this.pal().textPrimary)
          .margin({ top: SP_1 })
        Text('正在同步历史与运行状态')
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.pal().textMuted)
      }
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    // ⛔ 用户 2026-10-16 亲报「整个 logo 和文字有一点点靠上方」：几何居中 ≠ **视觉**居中
    //    （上方是重锚点 logo、下方是轻文字 ⇒ 光学重心偏高）。`justifyContent(Center)` 下
    //    加**上内边距** = 把内容整体下移 `padding/2`（SP_8 = 32 ⇒ 下移 16vp），纯布局手段、
    //    不引入魔法偏移量。
    .padding({ top: SP_8 })
    .id('xbot-session-splash')
  }
}
