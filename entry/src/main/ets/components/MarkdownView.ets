import { AuthImage } from './AuthImage';
import { pasteboard } from '@kit.BasicServicesKit';
import { Palette, paletteOf, Effects, effectsOf } from '../core/theme';
import { codeBgOf, codeFgOf, codeTone, CodeTone, normalizeMdTheme } from '../core/mdtheme';
import { R_SM, R_LG, SP_1, SP_2, SP_3 } from '../core/tokens';
import {
  MdBlock, MdBlockKind, MdSpan, parseInlineCached, parseMarkdownCached,
  TableField, tableRowFields, useTableGrid,
} from '../core/markdown';

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
  /** 由调用方按当前色板赋值（类字段默认值不能依赖主题） */
  color: string = '';
  bold: boolean = false;
  italic: boolean = false;
  strike: boolean = false;
  underline: boolean = false;
  mono: boolean = false;
  /** 背景（由调用方按当前色板赋值；空 = 无背景） */
  bg: string = '';
}

export function inlineStyles(text: string, pal: Palette, mdTheme: string): MdInlineStyle[] {
  const spans: MdSpan[] = parseInlineCached(text);
  const out: MdInlineStyle[] = [];
  const tone: CodeTone = codeTone(mdTheme);
  for (let i = 0; i < spans.length; i++) {
    const sp: MdSpan = spans[i];
    const st: MdInlineStyle = new MdInlineStyle();
    st.color = pal.textPrimary;
    st.bg = pal.transparent;
    if (sp.code) {
      st.text = ` ${sp.text} `;
      st.mono = true;
      st.size = 13;
      // 行内码：胶囊底用**所选 md 主题的行内码底**（与代码块同源，避免两种"代码"配色打架）
      st.color = pal.accentText;
      st.bg = tone.inlineBg;
    } else if (sp.link.length > 0) {
      st.text = sp.text;
      st.color = pal.accentSoft;
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
  /** 消息字号缩放（1 = 默认；由设置面板控制，范围 0.85–1.4 已在上游夹取） */
  @Prop fontScale: number = 1;
  /** 主题（由页面透传；语义色板见 core/theme.ets） */
  @Prop theme: string = 'dark';
  /** Markdown 主题 id（与 web 共享 `web:ui:md-theme`；只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';

  /** 当前语义色板（深浅两套，换主题只换取值） */
  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 视觉效果 token（玻璃/光晕/渐变/层级）—— 由色板派生，跨主题自动一致。 */
  private eff(): Effects {
    return effectsOf(this.pal());
  }
  /** 点击图片占位时的回调（参数是图片 src） */
  onImage: (src: string) => void = () => {
  };
  /** 取图片字节（带鉴权；页面持有 HTTP 客户端） */
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };
  /** 消息内图片最大高度（vp） */
  imageMaxHeight: number = 340;

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
            .fontSize(this.sz(this.headingSize(b.level)))
            .fontColor(this.pal().textPrimary)
        }, (s: MdSpan, i: number) => `h-${b.key}-${i}-${s.text.length}`)
      }
      .width('100%')
      .wordBreak(WordBreak.BREAK_ALL)
      .margin({ top: b.level <= 2 ? 8 : 4, bottom: 2 })
    } else if (b.kind === MdBlockKind.Code) {
      this.CodeBlock(b)
    } else if (b.kind === MdBlockKind.Divider) {
      Divider().color(this.pal().surfaceHi).strokeWidth(1).margin({ top: 6, bottom: 6 })
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
      .padding({ left: 11, right: SP_2, top: SP_2, bottom: SP_2 })
      // 引用块：左侧 3px accent 竖条 + 半透明玻璃底（竖条必须用 border，见上）
      .backgroundColor(this.eff().glassBg)
      .borderRadius(R_LG)
      .border({ width: { left: 3, top: 0, right: 0, bottom: 0 }, color: this.pal().accent })
    } else if (b.kind === MdBlockKind.List) {
      Column({ space: 3 }) {
        ForEach(b.items, (item: string, k: number) => {
          Row({ space: 6 }) {
            Text(b.ordered ? `${k + 1}.` : '•')
              .fontSize(14)
              .fontColor(this.pal().textSecondary)
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
      // 图片：xbot 的图片引用是 cookie 鉴权端点（ArkUI Image(url) 不带 cookie）
      // ⇒ 由页面取字节，AuthImage 负责解码/显示/缓存；点按交给查看器。
      ForEach(imagesIn(b.text), (src: string, k: number) => {
        AuthImage({
          src: src,
          load: this.loadImage,
          onOpen: this.onImage,
          maxHeight: this.imageMaxHeight,
          theme: this.theme,
        })
      }, (src: string, k: number) => `${b.key}-img${k}`)
    }
  }

  /** 段落/引用/列表项的行内渲染（零条件分支：样式全部预计算）。 */
  @Builder
  Inline(text: string) {
    Text() {
      ForEach(inlineStyles(text, this.pal(), this.mdTheme), (s: MdInlineStyle) => {
        Span(s.text)
          .fontSize(this.sz(s.size))
          .fontColor(s.color)
          .fontWeight(s.bold ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(s.italic ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(s.mono ? 'monospace' : 'sans-serif')
          // 行内码圆角胶囊（Span 的 backgroundColor 无圆角，改用 textBackgroundStyle 带 R_SM）
          .textBackgroundStyle({ color: s.bg, radius: R_SM })
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

  /** 统一字号缩放入口（所有正文/标题/代码都经这里，避免漏改一处导致大小不一致）。 */
  private sz(n: number): number {
    return n * this.fontScale;
  }

  @Builder
  CodeBlock(b: MdBlock) {
    Column() {
      Row() {
        Text(b.lang.length > 0 ? b.lang : 'code')
          .fontSize(11)
          .fontColor(this.pal().textSecondary)
          .layoutWeight(1)
        Text('复制')
          .fontSize(11)
          .fontColor(this.pal().accentSoft)
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
      .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_1 })
      .backgroundColor(this.pal().surfaceAlt)
      .borderRadius({ topLeft: R_LG, topRight: R_LG })
      // 顶部细条（语言标签条）与代码区之间一条玻璃分隔线
      .border({ width: { bottom: 1 }, color: this.eff().glassBorder })

      Text(b.code)
        .wordBreak(this.wrapCode ? WordBreak.BREAK_ALL : WordBreak.NORMAL)
        .fontFamily('monospace')
        .fontSize(13)
        .fontColor(codeFgOf(this.mdTheme))
        .width('100%')
        .padding(10)
        .textAlign(TextAlign.Start)
        // 行数上限只防极端（1000 行）；是否**词内折行**由上面的 wordBreak 决定。
        // 关闭换行时按 Clip 裁切（与 Web 端代码块不换行的表现一致；不做横向 Scroll 以免宽度/高度约束引入新的不确定性）。
        .maxLines(1000)
        .textOverflow({ overflow: TextOverflow.Clip })
    }
    .width('100%')
    // 代码块：**用所选 Markdown 主题的代码底/字**（与 web markdown-themes 同源；
    // 不跟随会退化成"23 套主题长得一模一样"的假功能）。圆角与描边保持全局语言。
    .backgroundColor(codeBgOf(this.mdTheme, this.pal()))
    .borderRadius(R_LG)
    .border({ width: 1, color: this.eff().glassBorder })
    .margin({ top: SP_1, bottom: SP_1 })
  }

  /**
   * 表格：**列数决定形态**。
   *
   * - ≤4 列：等宽网格（手机上每列仍可读）
   * - ≥5 列：堆叠成「字段: 值」—— 等宽网格在手机上会把每列压成 ~40dp 的**竖条**，
   *   中文完全不可读（实测真实会话里存在 5/7/8 列表格：`{2:544,3:490,5:267,4:218,8:6,7:5}`），
   *   这正是"渲染整个都是错乱的、完全用不了"的成因之一。
   *   堆叠形态只用 Column/Row/Text —— 都是真机已验证可渲染的构件（登录页已证明）。
   */
  @Builder
  TableBlock(b: MdBlock) {
    Column() {
      if (useTableGrid(b.header.length)) {
        Row() {
          ForEach(b.header, (h: string) => {
            Text(h)
              .wordBreak(WordBreak.BREAK_ALL)
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal().textPrimary)
              .layoutWeight(1)
              .padding(6)
          }, (h: string, k: number) => `${b.key}-th${k}`)
        }
        .width('100%')
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius({ topLeft: R_LG, topRight: R_LG })
        .padding({ left: 2, right: 2 })

        ForEach(b.rows, (row: string[], ri: number) => {
          Row() {
            ForEach(row, (cell: string, ci: number) => {
              Text(cell)
                .wordBreak(WordBreak.BREAK_ALL)
                .fontSize(13)
                .fontColor(this.pal().textPrimary)
                .layoutWeight(1)
                .padding(6)
            }, (cell: string, ci: number) => `${b.key}-td${ri}-${ci}`)
          }
          .width('100%')
          .border({ width: { top: 1 }, color: this.eff().glassBorder })
        }, (row: string[], ri: number) => `${b.key}-tr${ri}`)
      } else {
        Row() {
          Text(`📋 表格（${b.header.length} 列 · ${b.rows.length} 行）`)
            .fontSize(11).fontColor(this.pal().textSecondary)
        }
        .width('100%')
        .padding({ left: 8, right: 8, top: 6, bottom: 4 })

        ForEach(b.rows, (row: string[], ri: number) => {
          Column({ space: 3 }) {
            ForEach(tableRowFields(b.header, row), (f: TableField, fi: number) => {
              Row({ space: 6 }) {
                Text(f.label)
                  .fontSize(12).fontColor(this.pal().textSecondary)
                  .constraintSize({ minWidth: 84 })
                Text(f.value)
                  .wordBreak(WordBreak.BREAK_ALL)
                  .fontSize(13).fontColor(this.pal().textPrimary)
                  .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
            }, (f: TableField, fi: number) => `${b.key}-s${ri}-${fi}`)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          .border({ width: { top: ri === 0 ? 0 : 1 }, color: this.eff().glassBorder })
        }, (row: string[], ri: number) => `${b.key}-sr${ri}`)
      }
    }
    .width('100%')
    .border({ width: 1, color: this.eff().glassBorder })
    .borderRadius(R_LG)
    .clip(true)
    .margin({ top: SP_1, bottom: SP_1 })
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
