/**
 * Fallback —— **最小兜底页**（只在 `EntryAbility.loadContent('pages/Index')` **两试均失败**时加载）。
 *
 * 依据：`docs/SPLASH-SPEC.md §10 ③`（"loadContent 失败 ⇒ 至少让一帧可读提示存在，而不是空白"）。
 * ⛔ **刻意极简**：一段可读文本 + 一句"可重试 / 反馈日志"提示。
 *   ⛔ 不引 store / http / 任何业务模块（兜底页自己再失败就越兜越糟）；
 *   ⛔ 不画复杂 UI、不加动效（连开屏那层都不需要 —— 此时**没有**可交棒的内容）。
 *
 * 颜色/字号**全走 token**（`colorOf(darkPalette(), …)` + `typeOf('type.*')`）⇒ ⛔ 无颜色字面量、
 * ⛔ 无裸字号。主题固定用**默认深色**（兜底态拿不到用户主题，且系统色板此时可能不可信）。
 */
import { darkPalette } from '../core/theme';
import { SPACE_MD, SPACE_SM, SPACE_XL, colorOf, typeOf } from '../core/design';

@Entry
@Component
struct Fallback {
  build() {
    Column({ space: SPACE_SM }) {
      Text('xbot')
        .fontSize(typeOf('type.title').size)
        .fontWeight(typeOf('type.title').weight)
        .fontColor(colorOf(darkPalette(), 'textPrimary'))

      Text('页面加载失败')
        .fontSize(typeOf('type.body').size)
        .fontColor(colorOf(darkPalette(), 'textSecondary'))

      Text('请退出应用后重新打开。若仍然失败，请在「开发者」里反馈日志（tag: xbot）。')
        .fontSize(typeOf('type.caption').size)
        .fontColor(colorOf(darkPalette(), 'textMuted'))
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ left: SPACE_XL, right: SPACE_XL, top: SPACE_MD, bottom: SPACE_MD })
    .backgroundColor(colorOf(darkPalette(), 'appBg'))
  }
}
