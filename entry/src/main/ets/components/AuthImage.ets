/**
 * 需要鉴权的图片（xbot 的图片端点是 cookie/会话鉴权，ArkUI 的 `Image(url)` 不会带 cookie）。
 *
 * 由页面通过 `load` 回调取字节（页面持有 HTTP 客户端），这里负责解码 + 显示 + 缓存。
 * 缓存按 src 做（图片内容不可变），上限 24 张 —— 超出按插入顺序淘汰（避免长会话把内存吃满）。
 */
import image from '@ohos.multimedia.image';
import { Palette, paletteOf } from '../core/theme';
import {
  PRESS_OPACITY,
  RADIUS_PILL, RADIUS_CHIP, STROKE_HAIRLINE, HIT_TARGET_MIN,
  SPACE_XXS, SPACE_XS, SPACE_SM, SPACE_HAIR,
  colorOf, surfaceFillOf, hairlineOf, SURFACE_CHIP, MARKER_GLYPH } from '../core/design';
import { fs, lh, fw, tc } from './SettingsRows';

const PM_CACHE: Map<string, image.PixelMap> = new Map<string, image.PixelMap>();
const PM_ORDER: string[] = [];

/** 缓存上限（张）。 */
const PM_CACHE_MAX: number = 24;

@Component
export struct AuthImage {
  /** 图片地址（服务端返回的引用 URL） */
  src: string = '';
  /** 取字节（带鉴权） */
  load: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  /** 点按打开大图（查看器） */
  onOpen: (src: string) => void = (src: string) => {
  };
  /** 最大显示高度（vp） */
  maxHeight: number = 340;
  /** 主题（由上层透传；语义色板见 core/theme.ets） */
  @Prop theme: string = 'dark';

  /** 当前语义色板 */
  private pal(): Palette {
    return paletteOf(this.theme);
  }
  @State pm: image.PixelMap | undefined = undefined;
  @State failed: boolean = false;
  @State loading: boolean = true;

  aboutToAppear(): void {
    this.ensure();
  }

  private async ensure(): Promise<void> {
    const hit: image.PixelMap | undefined = PM_CACHE.get(this.src);
    if (hit !== undefined) {
      this.pm = hit;
      this.loading = false;
      return;
    }
    try {
      const buf: ArrayBuffer = await this.load(this.src);
      if (buf.byteLength === 0) {
        throw new Error('空响应');
      }
      const srcObj: image.ImageSource = image.createImageSource(buf);
      const pm: image.PixelMap = await srcObj.createPixelMap();
      this.remember(this.src, pm);
      this.pm = pm;
      this.loading = false;
    } catch (e) {
      this.failed = true;
      this.loading = false;
    }
  }

  private remember(key: string, pm: image.PixelMap): void {
    PM_CACHE.set(key, pm);
    PM_ORDER.push(key);
    while (PM_ORDER.length > PM_CACHE_MAX) {
      const old: string | undefined = PM_ORDER.shift();
      if (old !== undefined) {
        PM_CACHE.delete(old);
      }
    }
  }

  build() {
    if (this.pm !== undefined) {
      // 已就绪：图片本体。垫底走语义面 `surface.chip`（内嵌凹槽）—— 透明 PNG / 深色截图在
      // 纯白画布上几乎没有边界，垫一层次级面才"看得见图"；面/色全部经 `colorOf`/`surfaceFillOf`。
      Image(this.pm)
        .width('100%')
        .constraintSize({ maxHeight: this.maxHeight, minHeight: HIT_TARGET_MIN })
        .objectFit(ImageFit.Contain)
        .borderRadius(RADIUS_PILL)
        .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CHIP))
        // press 反馈（全 App 统一口径 `PRESS_OPACITY`）——图片可点（打开大图），此前**无任何反馈**。
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onOpen(this.src);
        })
    } else if (this.loading) {
      // ── 加载态（§F1：空白区域必须有解释）──────────────────────────────────────
      // 一行骨架 = 系统 spinner + 文案；字号/行高/字色走 `type.caption` 角色（不再各写 11）。
      Row({ space: SPACE_XS }) {
        LoadingProgress().width(14).height(14).color(colorOf(this.pal(), 'accent'))
        Text('图片加载中…')
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(tc(this.pal(), 'type.caption'))
      }
      .padding(SPACE_XS)
      .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CHIP))
      .borderRadius(RADIUS_CHIP)
    } else {
      // ── 失败态 / 兜底「查看图片」──────────────────────────────────────────────
      // 一行小字 + 一枚图标 + **结构性发丝**边界；可点（失败 ⇒ 重试；否则 ⇒ 打开大图）
      // ⇒ 命中区 ≥ `HIT_TARGET_MIN`（视觉仍小，靠 `minHeight` 达成；不放大图标）。
      Row({ space: SPACE_XS }) {
        SymbolGlyph($r('sys.symbol.picture'))
          .fontSize(MARKER_GLYPH)
          .fontColor([colorOf(this.pal(), 'accentSoft')])
          .flexShrink(0)
        Text(this.failed ? '图片加载失败（点按重试）' : '查看图片')
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(colorOf(this.pal(), 'accentSoft'))
      }
      .constraintSize({ minHeight: HIT_TARGET_MIN })
      .padding({ left: SPACE_XS, right: SPACE_XS })
      .margin({ top: SPACE_HAIR, bottom: SPACE_HAIR })
      .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CHIP))
      .borderRadius(RADIUS_CHIP)
      // 图片卡描边是**结构性边界**（承载"这是一张可点的图"的信息）⇒ `hairlineOf` 唯一出口。
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      // press 反馈（统一口径）——失败「重试」/兜底「查看图片」都可点，此前**无任何反馈**。
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        if (this.failed) {
          this.failed = false;
          this.loading = true;
          this.ensure();
        } else {
          this.onOpen(this.src);
        }
      })
    }
  }
}
