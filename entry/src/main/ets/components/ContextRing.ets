/**
 * 上下文用量环（web `web/src/components/agent/ContextRing.tsx` 同构）。
 *
 * ── 为什么是 `ProgressType.Ring` 而不是自绘 Canvas / Stack 双 Circle ─────────────
 *   web 用的是一个 20×20 的 SVG（`ContextRing.tsx:47` `viewBox="0 0 20 20"`，`r=7.5`、
 *   `strokeWidth=2`、`strokeDasharray=100` + `strokeDashoffset=100-pct`、`rotate(-90)`），
 *   即「**从 12 点开始、顺时针的一圈弧**」。
 *   ArkUI 的 `ProgressType.Ring` 就是同一个语义（从 12 点起顺时针、`strokeWidth` 可调、
 *   `enableSmoothEffect` 对应 web 的 `transition duration-300`），**一个节点**即可；
 *   Canvas 则要自己画弧/自己处理像素密度（还得在数据变化时重绘），Circle+strokeDashArray
 *   要自己算周长与 dash 偏移（`r` 与 vp/px 换算易错）——两者都更贵且更易错。
 *   ⇒ 选 Ring：**最少代码、最贴近 web 视觉**，且天然带平滑动画。
 *
 * ── 为什么没有"中心数字" ────────────────────────────────────────────────────
 *   web 的环**没有**中心数字（`ContextRing.tsx:47-76` 只有两个 `<circle>`）：20px 的环里
 *   塞 `100%` 会挤到不可读，数字由紧邻的文本承担（web 端是 `ContextBar.tsx:112-119` 的
 *   `12.3K/200K` + `40%`；原生端是同一行的状态栏文本 `core/statusfmt.ets:usageText`）。
 *   ⇒ 这里保持 parity：环只做"一眼可见的水位 + 阈值变色"，数字在环的**浮层**（点击）与
 *     同一行文本里。
 *
 * ── 交互 ───────────────────────────────────────────────────────────────────
 *   web 是 `Tooltip`（hover / focus 显示 `{pct}% · {used} / {available}`，
 *   `ContextRing.tsx:79-81`）。原生端**无 hover** ⇒ 等价为**点击弹浮层**（同一份文案，
 *   由 `core/ctxring.ets:ctxLabel` 生成）。浮层底座用 ArkUI `bindPopup`（与
 *   `ToolVisual` / `LiveTailView` 的 pill 浮层同一套写法）。
 *
 * ⛔ 颜色一律走 `core/theme.ets` 的 `pal()` 语义色，**绝不硬编码 `#RRGGBB`**：
 *   弧 = `high ? pal().dangerText : pal().accent`（web `text-status-error` / `text-accent`，
 *   `ContextRing.tsx:70-73`）；轨道 = `pal().border`（web 轨道是 `currentColor`@0.22，
 *   而 `textMuted`@22% 合成后 ≈ 发丝边框色 —— 数值最接近的主题角色，见 `core/theme.ets` 的
 *   dark `textMuted #63636F`@22% ≈ `border #20202B`）。
 */
import { Palette, paletteOf } from '../core/theme';
import { FS_CAPTION, R_MD, SP_3, SP_5, SP_7, SP_1 } from '../core/tokens';
import {
  CTX_RING_STROKE, CTX_ROLE_DANGER, ctxColorRole, ctxDrawnPercent, ctxLevel,
} from '../core/ctxring';

/** 浮层宽度（web tooltip 自适应；这里按最长文案 `100% · 1000K / 1000K` 取窄板）。 */
const CTX_POP_W: number = 200;

@Component
export struct ContextRing {
  /**
   * 服务端**原始**百分比（`TokenUsage.usage_percent`）。
   * ⚠️ 调用方必须用 `core/ctxring.ets:ctxHasUsage()` 判过再挂载 —— 无数据时**不挂载**本组件，
   *    免得出现"0%"这种假值（web 画空轨道，原生端整行更安静）。
   */
  @Prop percent: number = 0;
  /** 明细文案（`core/ctxring.ets:ctxLabel`）—— web tooltip 的同一份字符串，点击浮层展示。 */
  @Prop label: string = '';
  /** 当前主题（色板来源）。 */
  @Prop theme: string = 'dark';

  /** 浮层开关（点环 = 开/关，对齐 web 的 hover 提示）。 */
  @State detailOpen: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 弧色：档位 → 语义角色 → 色板（对齐 web `ContextRing.tsx:70-73`：
   * `high ? 'text-status-error' : 'text-accent'`）。
   * ⚠️ 用的是主题的 **statusError** 角色（web `--status-error`，dark `#F48771`），
   *    不是 `dangerText` —— 两者是不同角色（"状态机出错" vs "危险按钮文字"）。
   */
  private arcColor(): string {
    return ctxColorRole(ctxLevel(this.percent)) === CTX_ROLE_DANGER ? this.pal().statusError : this.pal().accent;
  }

  build() {
    Stack() {
      // 一圈环：`backgroundColor` = 轨道，`color` = 进度弧。
      Progress({ value: ctxDrawnPercent(this.percent), total: 100, type: ProgressType.Ring })
        .width(SP_5).height(SP_5)             // web `svg size-5` = 20px
        .backgroundColor(this.pal().border)   // 轨道（≈ web currentColor@0.22）
        .color(this.arcColor())
        .style({ strokeWidth: CTX_RING_STROKE, enableSmoothEffect: true })  // web `strokeWidth="2"` + 300ms 过渡
    }
    .width(SP_7).height(SP_7)                 // web `span size-7` = 28px（= 点击热区）
    // web 是 `flex items-center justify-center` ⇒ ArkUI 的等价物是 Stack 的 **alignContent**
    // （⛔ Stack **没有** justifyContent —— 那是 Column/Row/Flex 的属性；写了会 ArkTS 编译失败，
    //   且离线门禁（run.sh/lint/typecheck，只编译 core/）抓不到 ⇒ 唯一真门禁是 hvigorw assembleHap）。
    .alignContent(Alignment.Center)
    .borderRadius(R_MD)                       // web `rounded-md`
    .stateStyles({ pressed: { .opacity(0.75) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.detailOpen = !this.detailOpen;
    })
    .bindPopup(this.detailOpen, {
      builder: this.DetailPop,
      placement: Placement.Top,
      enableArrow: false,
      mask: false,
      popupColor: this.pal().surface,
      radius: R_MD,
      width: CTX_POP_W,
      onWillDismiss: (action: DismissPopupAction) => {
        this.detailOpen = false;
      },
    })
  }

  /** 明细浮层（web tooltip 文案；等宽字体对齐 web `font-mono`）。 */
  @Builder
  DetailPop() {
    Text(this.label)
      .fontSize(FS_CAPTION)
      .fontColor(this.pal().textPrimary)
      .width('100%')
      .padding({ left: SP_3, right: SP_3, top: SP_1, bottom: SP_1 })
  }
}
