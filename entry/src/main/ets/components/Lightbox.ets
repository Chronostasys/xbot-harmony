/**
 * Lightbox —— **图片全屏查看器**（E5）。从 `pages/Index.ets` 的 `@Builder ImageViewer()` 抽出成
 * 真 `@Component`（页面侧只留"取字节 + 解码 + 显隐"这三件事）。
 *
 * ── web 权威（`/Users/bobli/src/xbot/web`，只读取证）──────────────────────────────
 *   · `src/components/agent/Lightbox.tsx`：markdown 图片点击 ⇒ 全屏浮层；关闭 = **Esc / 点遮罩**
 *     （`:42-44` 的 onKey + `:66` 的 onClick）、右上/底部一枚"Esc"按钮（`:88-95`）；
 *     容器 `bg-black/85 backdrop-blur-sm`（`:67`）、图 `max-h-[85vh] rounded-lg shadow-2xl`（`:74`）、
 *     图下**一行 caption**（alt 截断 + "Open original" 外链 + 关闭）。
 *   · `src/components/file/ImagePreview.tsx`：文件面板里的"点图放大"（走 Dialog）。
 *   ⇒ 本组件对齐"**点开全屏 + 点遮罩关 + 工具栏**"，并按本仓设计系统落面/发丝/柔影/字型。
 *   ⚠️ **原生补充**（web 没有的）：双指缩放 / 双击 1↔2.5 / 放大后单指平移（判据在 `core/imgops.ets`）
 *      + **下滑关闭**（`shouldDismissBySwipe`，仅在未放大时生效）。
 *
 * ── ⛔ 四条硬纪律（每条都有门禁可查）─────────────────────────────────────────────
 *   1. **可见性 = 页面状态的函数**：本组件**不持有**显隐 flag（挂载由页面 `if (pixel !== null || busy)` 定）
 *      ⇒ 本文件**无任何 `.opacity(三元)`**（门禁 ⑨ A1 结构上不可能命中；同 `Toast`/`SplashOverlay`）。
 *   2. **出入场只做装饰**：走 `.transition(lightboxTransition())`（`components/anim.ets` 具名工厂，
 *      时长/曲线/缩放起点全部来自 `core/motion.ets` + `tokens`）⇒ 动画被打断也不会"永久不可见"。
 *   3. **面/发丝/柔影/字型全走唯一口径**：`surfaceFillOf(p,'surface.canvas'|'surface.overlay')` /
 *      `hairlineOf(p)` / `shadowRadiusOf(p,'overlay') + elevationColorOf(p, ELEV_OVERLAY)` / `typeOf` 角色。
 *      ⛔ 无颜色字面量、⛔ 无裸字号/裸圆角（历史实现用的 `pal().border` 已换 `hairlineOf`）。
 *   4. **在飞唯一性**：本组件**不启动光球**、**无循环动画**（缩放/平移是手势跟随，不是"在飞"）。
 *
 * ⚠️ 孤儿风险：ArkTS 不检查无消费者的组件（`docs/ARKTS-GOTCHAS.md` 批次13）⇒ 必须由页面接线后才进编译图
 *    （接线 spec 见交付说明；`pages/Index.ets` 归主 agent）。
 */
import image from '@ohos.multimedia.image';
import { Palette, paletteOf, shadowRadiusOf } from '../core/theme';
import {
  ELEV_OVERLAY, PRESS_OPACITY, RADIUS_CARD, SPACE_SM, SPACE_XS, STROKE_HAIRLINE,
  colorOf, elevationColorOf, hairlineOf, surfaceFillOf, typeOf, ICON_LG } from '../core/design';
import {
  clampOffset, clampScale, isZoomed, nextZoom, panLimit, scaleText, shouldDismissBySwipe,
} from '../core/imgops';
import { lightboxTransition } from './anim';

/** 工具栏/说明的字型角色（`docs/DESIGN-SYSTEM.md §12` 合法表内）。 */
const TYPE_LABEL: string = 'type.body';
const TYPE_META: string = 'type.caption';

@Component
export struct Lightbox {
  /** 应用主题名（与全仓组件同口径）。 */
  @Prop theme: string = 'dark';
  /** 已解码位图（页面负责取字节 + 解码）；`null` 且 `busy=false` ⇒ 页面不该挂载本组件。 */
  @Prop pixel: image.PixelMap | null = null;
  /** 解码中（显示 loading + 文案）。 */
  @Prop busy: boolean = false;
  /** 说明行（文件名 / alt；空 ⇒ 只留工具栏）。 */
  @Prop label: string = '';
  /** 关闭（页面据此收起：`pixel=null; busy=false`）。 */
  onClose: () => void = () => {
  };
  /** SaveButton 授权成功后触发（页面做"存相册"的实际动作）。 */
  onSave: () => void = () => {
  };
  /** 轻提示（如"需要授权才能保存到相册"）—— 走页面已有的自绘 toast。 */
  onToast: (msg: string) => void = () => {
  };

  // ── 视口 / 图片尺寸（平移边界要用；`onAreaChange` 与页面解码结果喂进来）──
  @State private viewW: number = 0;
  @State private viewH: number = 0;
  private imgW: number = 0;
  private imgH: number = 0;
  // ── 手势状态（**组件内部**：缩放/平移是视图瞬态，页面不该关心）──
  // ⛔ 成员名**不能**叫 `scale` —— `CustomComponent` 基类已有 `scale` ⇒ ArkTS `10505001
  //    Property 'scale' … not assignable to the same property in base type 'CustomComponent'`
  //    （`docs/ARKTS-GOTCHAS.md` 已入库的同款坑）。⇒ 用 `zoom`。
  @State private zoom: number = 1;
  @State private tx: number = 0;
  @State private ty: number = 0;
  @State private dragY: number = 0;
  private baseScale: number = 1;
  private baseX: number = 0;
  private baseY: number = 0;
  private dragging: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 复位（双击回 1 / 点"复位" / 关闭前）—— 单一出口。 */
  private resetView(): void {
    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;
    this.dragY = 0;
  }

  aboutToAppear(): void {
    // 每次挂载都是"干净的一份"（对齐旧实现的"下次打开是干净的"）。
    this.resetView();
  }

  @Builder
  Toolbar() {
    Row({ space: SPACE_XS }) {
      Text(this.label.length > 0 ? this.label : '图片')
        .fontSize(typeOf(TYPE_LABEL).size)
        .fontWeight(typeOf(TYPE_LABEL).weight)
        .fontColor(colorOf(this.pal(), 'textPrimary'))
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (isZoomed(this.zoom)) {
        Text(scaleText(this.zoom))
          .fontSize(typeOf(TYPE_META).size)
          .fontColor(colorOf(this.pal(), 'textSecondary'))
        Text('复位')
          .fontSize(typeOf(TYPE_META).size)
          .fontColor(colorOf(this.pal(), 'accentSoft'))
          .padding(SPACE_XS)
          // 按下反馈（统一口径：值取 `PRESS_OPACITY`；判据 = `interactive_feedback` ⑤/⑥/⑦）。
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.resetView();
          })
      }
      // 保存到相册：走系统安全组件（SaveButton）—— 用户授权后才有写权限 ⇒ 不申请相册写权限、不静默失败。
      // ⚠️ `SaveButton` 是**系统安全组件**：`SaveButtonAttribute` **不支持** `stateStyles`/`opacity`
      //    （实测编译红 `Property 'stateStyles' does not exist on type 'SaveButtonAttribute'`）
      //    ⇒ 按下反馈只能由**祖先容器**给（正是 `interactive_feedback` ⑦ 的"祖先覆盖"通道）。
      Row() {
        SaveButton({ icon: SaveIconStyle.FULL_FILLED, text: SaveDescription.SAVE_IMAGE, buttonType: ButtonType.Capsule })
          .onClick((event: ClickEvent, result: SaveButtonOnClickResult) => {
            if (result === SaveButtonOnClickResult.SUCCESS) {
              this.onSave();
            } else {
              this.onToast('需要授权才能保存到相册');
            }
          })
      }
      // 按下反馈（统一口径：值取 `PRESS_OPACITY`；与背板/关闭/复位同一常量）。
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      SymbolGlyph($r('sys.symbol.xmark')).fontSize(ICON_LG)
        .fontColor([colorOf(this.pal(), 'textSecondary')])
        .padding(SPACE_XS)
        // 按下反馈（统一口径；与复位/SaveButton 同一常量）。
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onClose();
        })
    }
    .width('100%')
    .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
    .shadow({
      radius: shadowRadiusOf(this.pal(), 'overlay'),
      color: elevationColorOf(this.pal(), ELEV_OVERLAY),
      offsetX: 0,
      offsetY: 0,
    })
  }

  @Builder
  Body() {
    if (this.busy) {
      Column() {
        LoadingProgress().width(32).height(32).color(colorOf(this.pal(), 'accent'))
        Text('加载图片…')
          .fontSize(typeOf(TYPE_META).size)
          .fontColor(colorOf(this.pal(), 'textSecondary'))
          .margin({ top: SPACE_XS })
      }
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
    } else if (this.pixel !== null) {
      Stack() {
        Image(this.pixel)
          .objectFit(ImageFit.Contain)
          .width('100%')
          .height('100%')
          .scale({ x: this.zoom, y: this.zoom })
          .translate({ x: this.tx, y: this.ty })
          .gesture(
            GestureGroup(GestureMode.Parallel,
              // 双指缩放：以手势开始时的缩放为基准（否则指数级失控）
              PinchGesture({ fingers: 2 })
                .onActionStart(() => {
                  this.baseScale = this.zoom;
                })
                .onActionUpdate((e: GestureEvent) => {
                  this.zoom = clampScale(this.baseScale * e.scale);
                  if (!isZoomed(this.zoom)) {
                    this.tx = 0;
                    this.ty = 0;
                  }
                }),
              // 单指拖动：**未放大 = 下滑关闭**（阈值判据在 core/imgops）；**放大 = 平移**（按倍数夹取）。
              PanGesture({ fingers: 1 })
                .onActionStart(() => {
                  this.dragging = true;
                  this.baseX = this.tx;
                  this.baseY = this.ty;
                })
                .onActionUpdate((e: GestureEvent) => {
                  if (!isZoomed(this.zoom)) {
                    this.dragY = Math.max(0, e.offsetY);   // 只认向下
                    return;
                  }
                  const limX: number = panLimit(this.zoom, this.viewW, this.imgW);
                  const limY: number = panLimit(this.zoom, this.viewH, this.imgH);
                  this.tx = clampOffset(this.baseX + e.offsetX, limX);
                  this.ty = clampOffset(this.baseY + e.offsetY, limY);
                })
                .onActionEnd(() => {
                  this.dragging = false;
                  if (shouldDismissBySwipe(this.dragY, this.viewH, this.zoom)) {
                    this.onClose();
                    return;
                  }
                  this.dragY = 0;   // 未达阈值 ⇒ 弹回
                }),
              // 双击：1 ↔ 2.5
              TapGesture({ count: 2 })
                .onAction(() => {
                  this.zoom = nextZoom(this.zoom);
                  if (!isZoomed(this.zoom)) {
                    this.tx = 0;
                    this.ty = 0;
                  }
                })
            )
          )
      }
      .layoutWeight(1)
      .width('100%')
      .clip(true)
      .onAreaChange((oldArea: Area, newArea: Area) => {
        this.viewW = Number(newArea.width);
        this.viewH = Number(newArea.height);
      })
    }
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // ── 背板：点它 = 关闭（web `Lightbox.tsx:66`）。色 = 唯一面口径的画布面（⛔ 不用裸 `pal().appBg`）。──
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.canvas'))
        // 按下反馈（"点任意处关闭"要**看得见**才算给到确认；与关闭/复位同一常量口径）。
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onClose();
        })

      // ── 内容：点它**不**关闭（= web 的 `stopPropagation`）；未达阈值时随下滑手势跟随 ──
      Column({ space: SPACE_SM }) {
        this.Toolbar()
        this.Body()
      }
      .width('100%')
      .height('100%')
      .padding({ left: SPACE_SM, right: SPACE_SM, top: SPACE_SM, bottom: SPACE_SM })
      .translate({ y: this.dragY })
      // ⛔ 用 **`HitTestMode.Block`** 表达 `stopPropagation`（挡住背板的命中测试）——**不是**可点元素：
      //    原先写 `onClick(() => {})` 会被 `interactive_feedback` ⑦ 当成"自定义可点元素却无 press"，
      //    而给它加 press 又会让**每次点图片（缩放/拖动）都整层闪一下**（错反馈）。
      //    Block = "自己参与命中、挡住其后的兄弟" ⇒ 语义精确、且不引入假 affordance。
      .hitTestBehavior(HitTestMode.Block)
    }
    .width('100%')
    .height('100%')
    // 出入场 = 装饰（静息态不靠它）：具名工厂，时长/曲线/缩放起点全部来自底座。
    .transition(lightboxTransition())
  }
}
