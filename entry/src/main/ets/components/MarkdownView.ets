import { pasteboard } from '@kit.BasicServicesKit';
import { MdBlock, MdBlockKind, MdSpan, parseInline, parseMarkdown } from '../core/markdown';

/**
 * MarkdownView —— 把 Markdown 渲染成原生 ArkUI（零 WebView）。
 *
 * 覆盖聊天里真会出现的子集（标题/段落/列表/代码块/引用/分隔线/表格 + 内联样式 + 图片占位）。
 * 代码块自带复制；图片走 `onImage` 回调（xbot 的图片端点是 cookie 鉴权，需由页面用
 * `XbotHttp.getBinary()` 取字节再解码 —— ArkUI 的 Image(url) 不会带会话 cookie）。
 */
@Component
export struct MarkdownView {
  @Prop text: string = '';
  /** 代码块是否换行（设置里可切） */
  @Prop wrapCode: boolean = true;
  /** 点击图片占位时的回调（参数是图片 src） */
  onImage: (src: string) => void = () => {
  };

  build() {
    Column({ space: 6 }) {
      ForEach(parseMarkdown(this.text), (b: MdBlock, idx: number) => {
        this.Block(b, idx)
      }, (b: MdBlock, idx: number) => `${idx}-${b.kind}`)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  Block(b: MdBlock, idx: number) {
    if (b.kind === MdBlockKind.Heading) {
      Text() {
        ForEach(parseInline(b.text), (s: MdSpan) => {
          Span(s.text)
            .fontWeight(FontWeight.Bold)
            .fontSize(this.headingSize(b.level))
            .fontColor('#F3F4F6')
        })
      }
      .width('100%')
      .margin({ top: b.level <= 2 ? 8 : 4, bottom: 2 })
    } else if (b.kind === MdBlockKind.Code) {
      this.CodeBlock(b)
    } else if (b.kind === MdBlockKind.Divider) {
      Divider().color('#374151').strokeWidth(1).margin({ top: 6, bottom: 6 })
    } else if (b.kind === MdBlockKind.Quote) {
      Row() {
        Divider().vertical(true).height('100%').color('#6B7280').strokeWidth(3)
        this.Inline(b.text)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .padding({ left: 8 })
      .backgroundColor('#0F172A')
      .borderRadius(6)
      .padding(8)
    } else if (b.kind === MdBlockKind.List) {
      Column({ space: 3 }) {
        ForEach(b.items, (item: string, k: number) => {
          Row({ space: 6 }) {
            Text(b.ordered ? `${k + 1}.` : '•')
              .fontSize(14)
              .fontColor('#9CA3AF')
              .margin({ top: 2 })
            this.Inline(item)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
          .padding({ left: b.level * 12 })
        }, (item: string, k: number) => `li-${idx}-${k}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (b.kind === MdBlockKind.Table) {
      this.TableBlock(b)
    } else {
      this.Inline(b.text)
      // 图片：xbot 的图片引用是 cookie 鉴权端点 ⇒ 用回调交给页面取字节渲染
      ForEach(MarkdownView.imagesIn(b.text), (src: string, k: number) => {
        Row({ space: 6 }) {
          Text('🖼').fontSize(14)
          Text('查看图片').fontSize(12).fontColor('#93C5FD')
        }
        .padding({ left: 8, right: 8, top: 5, bottom: 5 })
        .margin({ top: 2, bottom: 2 })
        .backgroundColor('#111827')
        .borderRadius(6)
        .border({ width: 1, color: '#1F2937' })
        .onClick(() => {
          this.onImage(src);
        })
      }, (src: string, k: number) => `img-${idx}-${k}`)
    }
  }

  /** 段落/引用/列表项的行内渲染。 */
  @Builder
  Inline(text: string) {
    Text() {
      ForEach(parseInline(text), (s: MdSpan) => {
        if (s.code) {
          Span(` ${s.text} `)
            .fontFamily('monospace')
            .fontSize(13)
            .fontColor('#FCA5A5')
            .backgroundColor('#1F2937')
        } else if (s.link.length > 0) {
          Span(s.text).fontColor('#60A5FA').decoration({ type: TextDecorationType.Underline, color: '#60A5FA' })
        } else {
          Span(s.text)
            .fontWeight(s.bold ? FontWeight.Bold : FontWeight.Normal)
            .fontStyle(s.italic ? FontStyle.Italic : FontStyle.Normal)
            .decoration(s.strike
              ? { type: TextDecorationType.LineThrough, color: '#9CA3AF' }
              : { type: TextDecorationType.None })
            .fontSize(15)
            .fontColor('#E5E7EB')
        }
      })
    }
    .width('100%')
    .textAlign(TextAlign.Start)
  }

  @Builder
  CodeBlock(b: MdBlock) {
    Column() {
      Row() {
        Text(b.lang.length > 0 ? b.lang : 'code')
          .fontSize(11)
          .fontColor('#9CA3AF')
          .layoutWeight(1)
        Text('复制')
          .fontSize(11)
          .fontColor('#93C5FD')
          .onClick(() => {
            // 剪贴板：用 pasteboard（`getContext(this).getApplicationContext().getPasteboard()` 不是 ArkTS API）
            try {
              const data: pasteboard.PasteData =
                pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, b.code);
              pasteboard.getSystemPasteboard().setData(data);
            } catch (e) {
              console.error('copy failed');
            }
          })
      }
      .width('100%')
      .padding({ left: 10, right: 10, top: 6, bottom: 2 })

      Text(b.code)
        .fontFamily('monospace')
        .fontSize(13)
        .fontColor('#E5E7EB')
        .width('100%')
        .padding(10)
        .textAlign(TextAlign.Start)
        .maxLines(this.wrapCode ? 1000 : 1000)
        .textOverflow({ overflow: TextOverflow.Clip })
    }
    .width('100%')
    .backgroundColor('#111827')
    .borderRadius(8)
    .border({ width: 1, color: '#1F2937' })
    .margin({ top: 4, bottom: 4 })
  }

  @Builder
  TableBlock(b: MdBlock) {
    Column() {
      Row() {
        ForEach(b.header, (h: string) => {
          Text(h)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F3F4F6')
            .layoutWeight(1)
            .padding(6)
        }, (h: string, k: number) => `th-${k}`)
      }
      .width('100%')
      .backgroundColor('#1F2937')

      ForEach(b.rows, (row: string[], ri: number) => {
        Row() {
          ForEach(row, (cell: string, ci: number) => {
            Text(cell)
              .fontSize(13)
              .fontColor('#E5E7EB')
              .layoutWeight(1)
              .padding(6)
          }, (cell: string, ci: number) => `td-${ri}-${ci}`)
        }
        .width('100%')
        .border({ width: { top: 1 }, color: '#1F2937' })
      }, (row: string[], ri: number) => `tr-${ri}`)
    }
    .width('100%')
    .border({ width: 1, color: '#1F2937' })
    .borderRadius(8)
    .clip(true)
    .margin({ top: 4, bottom: 4 })
  }

  /** 取出文本里的图片 src（供页面用 cookie 鉴权拉字节渲染）。 */
  static imagesIn(text: string): string[] {
    const out: string[] = [];
    const spans: MdSpan[] = parseInline(text);
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].image.length > 0) {
        out.push(spans[i].image);
      }
    }
    return out;
  }

  private headingSize(level: number): number {
    if (level <= 1) {
      return 20;
    }
    if (level === 2) {
      return 18;
    }
    if (level === 3) {
      return 16;
    }
    return 15;
  }
}
