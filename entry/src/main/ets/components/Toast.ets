/**
 * Toast —— **自绘 in-app toast**（品牌化，跟主题走设计系统；取代系统 `promptAction.showToast`）。
 *
 * ── 为什么要它（C4 裁决，2026-10-11）────────────────────────────────────────────
 * 系统 toast 的**底/字/圆角/字号/位置全由系统固定**，只随应用 `colorMode` 明暗 —— ⛔ **不读**
 * `pal()`/`effectsOf` ⇒ 半径/阴影/字族与 porcelain（"发丝 + 柔影 + token 半径"）**不同族**。
 * 本组件把它收进设计系统：面 / 发丝 / 柔影 / 字角色**全部走 token**（同 `AskUserSheet` 的浮层语言）。
 *
 * ── ⛔ 三条硬纪律（每条都有门禁可查）─────────────────────────────────────────────
 *   1. **可见性 = 页面状态的函数**：本组件**不持有**"显示/隐藏"状态、**不自持定时器** ——
 *      挂载由页面 `if (toastVisible(this.toast))` 决定（`core/toast.ets: toastVisible`）。
 *      ⇒ 门禁 ⑨（`tools/lint/anim-opacity-gate.sh`）A1 硬红的 "静息态 = 隐藏"
 *        （`@State entered=false` + `.opacity(entered ? 1 : 0)`）在本文件**结构上不可能出现**：
 *        ⛔ 本文件**没有任何** `.opacity(...)`。
 *   2. **出场动画只做装饰**：走 `.transition(toastTransition())`（`components/anim.ets` 具名工厂，
 *      时长/曲线/位移全部来自 `core/motion.ets` + `tokens`）—— 动画被打断也不会"永久不可读"
 *      （静息态 = 组件自身属性 = 可见 ⇒ **fail-safe**）。
 *   3. **颜色零字面量**：面 `surfaceFillOf(p,'surface.overlay')` / 发丝 `hairlineOf(p)` /
 *      柔影 `shadowRadiusOf(p,'overlay')` + `elevationColorOf(p, ELEV_OVERLAY)` / 字 `type.callout`
 *      角色（`tc/fs/fw/lh`）—— ⛔ 不出现 `#RRGGBB`、⛔ 不出现裸半径/时长/位移。
 *
 * ⚠️ 新组件的**孤儿风险**：ArkTS 不检查"无消费者"的组件文件（`docs/ARKTS-GOTCHAS.md` 批次13）
 *    ⇒ 必须由页面接线后才真正进编译图（接线 spec 见交付说明，`pages/Index.ets` 归主 agent）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  RADIUS_SHEET, SPACE_MD, SPACE_SM, SPACE_XL, STROKE_HAIRLINE,
  hairlineOf, surfaceFillOf,
} from '../core/design';
import { fs, fw, lh, tc } from './SettingsRows';
import { toastTransition } from './anim';

/** toast 的展示文案角色（`core/design.ets:typeRoles` 的既有档，⛔ 不自造字号）。 */
const TOAST_TYPE: string = 'type.callout';

@Component
export struct Toast {
  /** 应用主题名（决定色板；与全仓组件同口径）。 */
  @Prop theme: string = 'dark';
  /** 已算好的**展示文案**（由 `core/toast.ets: toastLabel` 统一产出；空 ⇒ 页面不该挂载本组件）。 */
  @Prop msg: string = '';
  /**
   * **底部让位高度**（vp）—— 页面传入的"输入区（composer + InfoBar）总高"。
   *
   * ⛔ 为什么必须要有它（2026-10-16 用户 P0「popup 提示直接遮挡用户输入框」）：本组件是
   *   **全屏 overlay + 贴底对齐**（`justifyContent(FlexAlign.End)`），而输入框就在页面底部 ⇒
   *   任何 toast（含点「排队/插队」的 `modeHint`）都**正好压在输入框上** ⇒ 挡住用户正在打的字。
   *   页面测出底部栏高度后从这里传入，toast 便浮在输入框**上方**。
   */
  @Prop bottomOffset: number = 0;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 本 toast 的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private toastLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'overlay');
  }

  build() {
    // 全屏透明容器 + **底对齐**（toast 贴底居中）；`hitTestBehavior(None)` ⇒ 不吃任何点击事件。
    Column() {
      // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
      // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
      // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
      // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
      Stack() {
        Text(this.msg)
          .fontSize(fs(TOAST_TYPE))
          .fontWeight(fw(TOAST_TYPE))
          .lineHeight(lh(TOAST_TYPE))
          .fontColor(tc(this.pal(), TOAST_TYPE))
          .textAlign(TextAlign.Center)
          // ⛔ 长**不可断**串（长 URL / 无空格长错误码）必须能断 —— 否则撑破 `maxWidth` 溢出屏幕。
          //    用 `BREAK_ALL` **换行**（⛔ 不设 `maxLines`：那会**截断信息**，与"不删信息"冲突）。
          .wordBreak(WordBreak.BREAK_ALL)
          .constraintSize({ maxWidth: '92%' })
          .padding({ left: SPACE_MD, right: SPACE_MD, top: SPACE_SM, bottom: SPACE_SM })
          .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
          .borderRadius(RADIUS_SHEET)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
          // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
          .shadow({
            radius: this.toastLayers()[0].radius,
            color: this.toastLayers()[0].color,
            offsetX: 0, offsetY: this.toastLayers()[0].offsetY,
          })
      }
      // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`elev3`/`glow`，逐字节不变）。
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius(RADIUS_SHEET)
      .shadow({
        radius: this.toastLayers()[1].radius,
        color: this.toastLayers()[1].color,
        offsetX: 0, offsetY: this.toastLayers()[1].offsetY,
      })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.End)
    .alignItems(HorizontalAlign.Center)
    // ⛔ 浮在**输入框上方**（`bottomOffset` = 页面测出的底部栏总高）—— 贴底会正好压在用户
    //    正在打的字上（2026-10-16 用户 P0）。
    .padding({ bottom: SPACE_XL + this.bottomOffset })
    .hitTestBehavior(HitTestMode.None)
    // 出入场 = 装饰（静息态不靠它）—— 具名工厂，时长/曲线/位移全部来自底座。
    .transition(toastTransition())
  }
}
