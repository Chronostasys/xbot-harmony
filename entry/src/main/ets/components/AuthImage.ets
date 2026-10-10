/**
 * 需要鉴权的图片（xbot 的图片端点是 cookie/会话鉴权，ArkUI 的 `Image(url)` 不会带 cookie）。
 *
 * 由页面通过 `load` 回调取字节（页面持有 HTTP 客户端），这里负责解码 + 显示 + 缓存。
 * 缓存按 src 做（图片内容不可变），上限 24 张 —— 超出按插入顺序淘汰（避免长会话把内存吃满）。
 */
import image from '@ohos.multimedia.image';
import { Palette, paletteOf } from '../core/theme';

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
      Image(this.pm)
        .width('100%')
        .constraintSize({ maxHeight: this.maxHeight })
        .objectFit(ImageFit.Contain)
        .borderRadius(8)
        // 垫底用 **surfaceAlt**（`bg-tertiary` 语义）：透明 PNG / 深色截图在纯白主题底
        // （appBg，本主题里最浅的画布色）上几乎没有边界，垫一层次级面板色才能"看得见图"。
        // 深色主题下 surfaceAlt 与 appBg 同为近黑（亮度差 <8%），不改变既有深色观感。
        .backgroundColor(this.pal().surfaceAlt)
        .onClick(() => {
          this.onOpen(this.src);
        })
    } else if (this.loading) {
      Row({ space: 6 }) {
        LoadingProgress().width(14).height(14).color(this.pal().accent)
        Text('图片加载中…').fontSize(11).fontColor(this.pal().textMuted)
      }
      .padding(8)
      .backgroundColor(this.pal().surfaceAlt)
      .borderRadius(6)
    } else {
      Row({ space: 6 }) {
        // 图标走系统符号（项目纪律：禁字符图标；原先的 `▣` 是硬编码 dingbat）。
        SymbolGlyph($r('sys.symbol.picture')).fontSize(13)
          .fontColor([this.pal().accentSoft]).flexShrink(0)
        Text(this.failed ? '图片加载失败（点按重试）' : '查看图片').fontSize(12).fontColor(this.pal().accentSoft)
      }
      .padding({ left: 8, right: 8, top: 5, bottom: 5 })
      .margin({ top: 2, bottom: 2 })
      .backgroundColor(this.pal().surfaceAlt)
      .borderRadius(6)
      .border({ width: 1, color: this.pal().border })
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
