import { pasteboard } from '@kit.BasicServicesKit';
import { MdBlock, MdBlockKind, MdSpan, parseInlineCached, parseMarkdownCached } from '../core/markdown';

/**
 * MarkdownView —— 把 Markdown 渲染成原生 ArkUI（零 WebView）。
 *
 * 覆盖聊天里真会出现的子集（标题/段落/列表/代码块/引用/分隔线/表格 + 内联样式 + 图片占位）。
 * 代码块自带复制；图片走 `onImage` 回调（xbot 的图片端点是 cookie 鉴权，需由页面用
 * `XbotHttp.getBinary()` 取字节再解码 —— ArkUI 的 Image(url) 不会带会话 cookie）。
 */
/**
 * 取出文本里的图片 src（供页面用 cookie 鉴权拉字节渲染）。
 *
 * ⚠️ 必须是**模块级函数**，不能写成 struct 的 static 方法：ArkUI 的 struct 不是普通类，
 * 真机上静态成员会解析成 undefined，调用直接抛 "undefined is not callable"
 * （2026-10-09 真机登录报错根因）。同理见 pages/Index.ets 的 selectionsFor。
 */
export function imagesIn(text: string): string[] {
  const out: string[] = [];
  const spans: MdSpan[] = parseInlineCached(text);
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].image.length > 0) {
      out.push(spans[i].image);
    }
  }
  return out;
}

/**
 * 行内片段的**预计算样式**。
 *
 * 为什么在 TS 侧算好：ArkUI 的 `Text` 只接受 Span 类子组件，在 `Text(){ForEach(){ if/else }}`
 * 里做条件渲染不保证支持 —— 这正是"渲染错乱"的典型来源。改成一维 ForEach + 纯属性赋值，
 * 分支逻辑全部提前算完。
 */
export class MdInlineStyle {
  text: string = '';
  size: number = 15;
  color: string = '#E5E7EB';
  bold: boolean = false;
  italic: boolean = false;
  strike: boolean = false;
  underline: boolean = false;
  mono: boolean = false;
  bg: string = '#00000000';
}

export function inlineStyles(text: string): MdInlineStyle[] {
  const spans: MdSpan[] = parseInlineCached(text);
  const out: MdInlineStyle[] = [];
  for (let i = 0; i < spans.length; i++) {
    const sp: MdSpan = spans[i];
    const st: MdInlineStyle = new MdInlineStyle();
    if (sp.code) {
      st.text = ` ${sp.text} `;
      st.mono = true;
      st.size = 13;
      st.color = '#FCA5A5';
      st.bg = '#1F2937';
    } else if (sp.link.length > 0) {
      st.text = sp.text;
      st.color = '#60A5FA';
      st.underline = true;
    } else {
      st.text = sp.text;
      st.bold = sp.bold;
      st.italic = sp.italic;
      st.strike = sp.strike;
    }
    out.push(st);
  }
  return out;
}

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
      // 走缓存：流式期间整行会反复重建，没缓存就要反复解析几百 KB（见 core/markdown.ets 注释）
      ForEach(parseMarkdownCached(this.text), (b: MdBlock, idx: number) => {
        this.Block(b, idx)
      }, (b: MdBlock, idx: number) => b.key)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  Block(b: MdBlock, idx: number) {
    if (b.kind === MdBlockKind.Heading) {
      Text() {
        ForEach(parseInlineCached(b.text), (s: MdSpan) => {
          Span(s.text)
            .fontWeight(FontWeight.Bold)
            .fontSize(this.headingSize(b.level))
            .fontColor('#F3F4F6')
        }, (s: MdSpan, i: number) => `h-${b.key}-${i}-${s.text.length}`)
      }
      .width('100%')
      .wordBreak(WordBreak.BREAK_ALL)
      .margin({ top: b.level <= 2 ? 8 : 4, bottom: 2 })
    } else if (b.kind === MdBlockKind.Code) {
      this.CodeBlock(b)
    } else if (b.kind === MdBlockKind.Divider) {
      Divider().color('#374151').strokeWidth(1).margin({ top: 6, bottom: 6 })
    } else if (b.kind === MdBlockKind.Quote) {
      // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
      // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
      // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
      // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
      Column() {
        this.Inline(b.text)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 11, right: 8, top: 8, bottom: 8 })
      .backgroundColor('#0F172A')
      .borderRadius(6)
      .border({ width: { left: 3, top: 0, right: 0, bottom: 0 }, color: '#6B7280' })
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
        }, (item: string, k: number) => `${b.key}-li${k}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (b.kind === MdBlockKind.Table) {
      this.TableBlock(b)
    } else {
      this.Inline(b.text)
      // 图片：xbot 的图片引用是 cookie 鉴权端点 ⇒ 用回调交给页面取字节渲染
      ForEach(imagesIn(b.text), (src: string, k: number) => {
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
      }, (src: string, k: number) => `${b.key}-img${k}`)
    }
  }

  /** 段落/引用/列表项的行内渲染（零条件分支：样式全部预计算）。 */
  @Builder
  Inline(text: string) {
    Text() {
      ForEach(inlineStyles(text), (s: MdInlineStyle) => {
        Span(s.text)
          .fontSize(s.size)
          .fontColor(s.color)
          .fontWeight(s.bold ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(s.italic ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(s.mono ? 'monospace' : 'sans-serif')
          .backgroundColor(s.bg)
          .decoration({
            type: s.strike ? TextDecorationType.LineThrough
              : (s.underline ? TextDecorationType.Underline : TextDecorationType.None),
            color: s.color,
          })
      }, (s: MdInlineStyle, i: number) => `sp-${i}-${s.text.length}`)
    }
    .width('100%')
    .textAlign(TextAlign.Start)
    // 不可断超长 token（URL/代码/base64）在 ArkUI 里默认不在词内折行 ⇒ 横向撑破容器；
    // 与 xbot Web 端已定稿的教训同源（break-words 不够，必须 wrap-anywhere）。
    .wordBreak(WordBreak.BREAK_ALL)
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
        .wordBreak(this.wrapCode ? WordBreak.BREAK_ALL : WordBreak.NORMAL)
        .fontFamily('monospace')
        .fontSize(13)
        .fontColor('#E5E7EB')
        .width('100%')
        .padding(10)
        .textAlign(TextAlign.Start)
        // 行数上限只防极端（1000 行）；是否**词内折行**由上面的 wordBreak 决定。
        // 关闭换行时按 Clip 裁切（与 Web 端代码块不换行的表现一致；不做横向 Scroll 以免宽度/高度约束引入新的不确定性）。
        .maxLines(1000)
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
            .wordBreak(WordBreak.BREAK_ALL)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F3F4F6')
            .layoutWeight(1)
            .padding(6)
        }, (h: string, k: number) => `${b.key}-th${k}`)
      }
      .width('100%')
      .backgroundColor('#1F2937')

      ForEach(b.rows, (row: string[], ri: number) => {
        Row() {
          ForEach(row, (cell: string, ci: number) => {
            Text(cell)
              .wordBreak(WordBreak.BREAK_ALL)
              .fontSize(13)
              .fontColor('#E5E7EB')
              .layoutWeight(1)
              .padding(6)
          }, (cell: string, ci: number) => `${b.key}-td${ri}-${ci}`)
        }
        .width('100%')
        .border({ width: { top: 1 }, color: '#1F2937' })
      }, (row: string[], ri: number) => `${b.key}-tr${ri}`)
    }
    .width('100%')
    .border({ width: 1, color: '#1F2937' })
    .borderRadius(8)
    .clip(true)
    .margin({ top: 4, bottom: 4 })
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
