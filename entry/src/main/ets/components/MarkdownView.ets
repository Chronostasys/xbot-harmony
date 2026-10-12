import { AuthImage } from './AuthImage';
import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { Palette, paletteOf, surfacesOf, Effects, effectsOf, contrastRatio, isLightPalette } from '../core/theme';
import { codeBgOf, codeFgOf, codeTone, CodeTone, isLightMdTheme, normalizeMdTheme } from '../core/mdtheme';
import { R_SM, R_MD, R_LG, SP_1, SP_2, SP_3 } from '../core/tokens';
// 排版节奏（本波「布局/层级」重做的主战场）：行高此前**全文一处都没有**（`docs/REDESIGN.md §1.2`）
// ⇒ ArkUI 默认行高偏紧、"呼吸"完全不可控。这里把尺度全部取自 `core/design.ets` 的 `MD_*` 组。
import {
  MD_BLOCK_GAP, MD_BODY_LEADING, MD_CODE_LEADING, MD_CODE_SIZE, MD_HEADING_GAP_BOTTOM,
  MD_HEADING_GAP_TOP, MD_HEADING_LEADING, MD_LIST_INDENT, MD_LIST_ITEM_GAP, MD_TABLE_CELL_X,
  MD_TABLE_CELL_Y, MD_TABLE_SIZE, MdHeading, mdHeadings, typeOf, SPACE_HAIR,
  // `#13` 视觉裁决（`docs/WEB-ALIGNMENT.md §16.2 #13`）：代码块底 = `surface.well`(sunken)、
  // 圆角 = `RADIUS_CARD`、边 = 结构性发丝 `hairlineOf`。
  PRESS_OPACITY, RADIUS_CARD, colorOf, hairlineOf, wellOf, ICON_SM } from '../core/design';
import { copyLabel } from '../core/feedback';
import {
  MdBlock, MdBlockKind, MdSpan, alignOf, parseInlineCached, parseMarkdownCached,
  TableField, tableRowFields, useTableGrid,
} from '../core/markdown';
// 渲染**判据**全在 core/mdview（纯逻辑、可脱机单测）：链接目标 / 溢出策略 / 代码 token 色 / 行内样式记忆化。
import {
  MdInlineStyle, MdInlineMemo, MdInlineMemoStats, mdInlineKey, codeOverflow, MdOverflow, codeTokenColor,
} from '../core/mdview';
import { HlSpan, highlightCode } from '../core/highlight';
import { resolveOpenable } from '../core/msgops';

/**
 * 行内样式的**模块级记忆化容器**（P1#5）。
 * 组件会被反复重建（流式期每拍），但"同一文本 + 同一主题"的样式是常量 ⇒ 只算一次。
 * 统计口径可经 `mdInlineStyleStats()` 读取（本文件导出，供自检/测试读取源码形态）。
 */
const mdInlineMemo: MdInlineMemo = new MdInlineMemo();

/** 行内样式记忆化统计（自检/测试用；与 `core/mdview.MdInlineMemo.stats()` 同源）。 */
export function mdInlineStyleStats(): MdInlineMemoStats {
  return mdInlineMemo.stats();
}

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

/** 行内码文本的正文阈值（WCAG AA）。 */
const INLINE_CODE_MIN_RATIO: number = 4.5;

/**
 * 行内码**文本色**——必须与**它自己的底**（md 主题的 `tone.inlineBg`）配对。
 *
 * ⛔ 为什么不能无条件用全局 `pal.accentText`：全局应用主题与 md 主题是**两条独立的明暗轴**
 *   （应用主题 = dark/light/aurora/nebula/porcelain；md 主题 = 23 套，各自有 mode）。
 *   二者**相反**时会把"深字压深底 / 浅字压浅底"：
 *     · 极简白/浅色应用 + 默认 `vscode-dark`（最常见的默认组合）⇒ 深 `accentText`
 *       压深 `inlineBg`，实测 **1.1 ~ 2.5:1**（正文阈值 4.5）—— 行内码几乎读不出；
 *     · 深色应用 + `github-light`/`solarized-light` 等浅色 md 主题 ⇒ 浅 `accentText`
 *       压浅底，实测 **1.28 ~ 1.49:1**。
 *   二者**同明暗**时（深色应用 + 深色 md 主题）`accentText` 已可读 ⇒ **原样保留（零回归）**。
 *
 * 取值规则（不新造色值，全部复用既有角色）：
 *   · `accentText` 对 `inlineBg` 已 ≥ 4.5 ⇒ 用它（保色相，观感不变）；
 *   · 否则退回 **md 主题自己的代码字色** `tone.fg` —— 它与 `inlineBg` **同族配对**
 *     （web `markdown-themes.css` 的 `--md-inline-code-text` 也是这么配的），故必然可读。
 */
function inlineCodeFg(pal: Palette, tone: CodeTone): string {
  if (contrastRatio(pal.accentText, tone.inlineBg) >= INLINE_CODE_MIN_RATIO) {
    return pal.accentText;
  }
  return tone.fg;
}

/**
 * 行内片段的**预计算样式** —— 类与"按文本记忆化"容器在 `core/mdview.ets`（纯逻辑，可脱机单测）。
 * 本文件只保留"读取当前色板 → 产出样式数组"这一步（色彩是 UI 侧职责）。
 */

/**
 * 行内片段的**预计算样式**。
 *
 * 为什么在 TS 侧算好：ArkUI 的 `Text` 只接受 Span 类子组件，在 `Text(){ForEach(){ if/else }}`
 * 里做条件渲染不保证支持 —— 这正是"渲染错乱"的典型来源。改成一维 ForEach + 纯属性赋值，
 * 分支逻辑全部提前算完。
 *
 * `baseColor` = **普通文字**（非行内码 / 非链接）的前景色，默认 `pal.textPrimary`。
 * 引用块传 `pal.textSecondary` —— 对齐 web `index.css:190 --md-blockquote-text: var(--text-secondary)`
 * 与 `:567`（引用块整体弱一档），使引用在层次上**弱于正文**（原先引用文字与正文同色 ⇒ 层次塌陷，
 * 引用只剩一条 3px 竖条在表达"这是引用"）。行内码 / 链接的颜色由各自分支覆盖，不受它影响。
 */
export function inlineStyles(text: string, pal: Palette, mdTheme: string, baseColor?: string): MdInlineStyle[] {
  // ── 按文本记忆化（P1#5）───────────────────────────────────────────────────
  // 为什么：此函数此前**每次 build** 对全部行内文本重算（`MdInlineStyle[]` + `codeTone()` +
  // `contrastRatio` 数学），完全不进缓存 ⇒ 96KB 文档实测**单帧 960 次**。流式期组件反复重建
  // ⇒ 这份开销每次都白付。键含**主题 + 调色板**（`mdInlineKey`）⇒ 换主题/换强调色不会命中旧色。
  const bc: string = baseColor !== undefined ? baseColor : '';
  return mdInlineMemo.getOrCompute(mdInlineKey(text, pal, mdTheme, bc),
    () => computeInlineStyles(text, pal, mdTheme, baseColor));
}

/** `inlineStyles` 的实际计算（只在缓存未命中时执行）。 */
function computeInlineStyles(text: string, pal: Palette, mdTheme: string, baseColor?: string): MdInlineStyle[] {
  const spans: MdSpan[] = parseInlineCached(text);
  const out: MdInlineStyle[] = [];
  const tone: CodeTone = codeTone(mdTheme);
  for (let i = 0; i < spans.length; i++) {
    const sp: MdSpan = spans[i];
    const st: MdInlineStyle = new MdInlineStyle();
    st.color = baseColor !== undefined ? baseColor : pal.textPrimary;
    st.bg = pal.transparent;
    if (sp.code) {
      st.text = ` ${sp.text} `;
      st.mono = true;
      st.size = 13;
      // 行内码：胶囊底用**所选 md 主题的行内码底**（与代码块同源，避免两种"代码"配色打架）；
      // 文本色必须与**这个底**配对，见 `inlineCodeFg`。
      st.color = inlineCodeFg(pal, tone);
      st.bg = tone.inlineBg;
    } else if (sp.link.length > 0) {
      st.text = sp.text;
      // 链接色 = **app 层** `accent`（web `index.css:188/292 --md-link: var(--accent)`）。
      // 此前用 `accentSoft`（偏浅）—— 与 web 的 app 级链接 token 不一致，对齐之。
      st.color = pal.accent;
      st.underline = true;
      // 可点击目标：组件据它给该 Span 挂 `onClick`（旧实现没有 ⇒ 链接点不开，P0#1）。
      st.link = sp.link;
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
  /** 显式主题覆盖（测试/独立预览）；生产走 `appTheme` 全局订阅（页面不传）。 */
  @Prop theme: string = 'dark';
  /**
   * 全局主题**订阅**（生产唯一真源）—— 正文实际取色点。历史行由 `LazyForEach` 承载，主题变更
   * 不改变行键 ⇒ 只靠 `@Prop` 投递会**冻结在创建那刻**（浅色主题下取深色板 = 白底白字）。
   * 本组件**自己订阅** AppStorage ⇒ 主题变更时每个已存在实例各自重渲染（与列表键语义无关）。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** Markdown 主题 id（与 web 共享 `web:ui:md-theme`；只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';
  /**
   * 链接相对地址的解析基准（服务端地址）。空 = 只放行绝对地址（`http/https/mailto`）。
   * 对齐 web 的浏览器行为：相对链接按**同源**解析（`MarkdownRenderer.tsx:311-321` 是真 `<a href>`）。
   * 原生端由页面把服务端地址透传进来（未透传时相对链接会被白名单拒绝 —— 宁可拒绝也不猜地址）。
   */
  @Prop linkBase: string = '';

  /** 生效主题：生产走订阅，缺失时回落显式覆盖（单一口径，不产生两个真源）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }

  /** 当前语义色板（深浅两套，换主题只换取值） */
  private pal(): Palette {
    return paletteOf(this.themeId());
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
  /**
   * 复制反馈的**落地回调**（参数 = 已算好的展示文案）—— 由页面注入**品牌 toast**
   * （`components/Toast.ets`，其头注明言"取代系统 `promptAction.showToast`"）。
   *
   * ⛔ 为什么改成注入回调：代码块「复制」此前用系统 `promptAction.showToast`，而页面级复制走自绘
   *    `Toast` ⇒ **同一动作两种落点**（`polish-audit` B6）。系统 toast **不读** `pal()`/`effectsOf`
   *    ⇒ 面/字/圆角/位置与设计系统**不同族**。本回调让代码块复制与消息级复制**同一落点**。
   * ⛔ 回调缺省 = 空实现（同本组件既有 `onImage`/`loadImage` 口径）—— 未接线的宿主（如自检 sheet）
   *    不会误弹系统 toast；也已**移除**组件内的 `promptAction` 与 `setTimeout`（见 copy 处）。
   */
  onToast: (msg: string) => void = () => {
  };
  /** 消息内图片最大高度（vp） */
  imageMaxHeight: number = 340;
  /**
   * **内容定宽**模式（用户气泡用）：根容器与行内正文改用 `LayoutPolicy.wrapContent`
   * （`width` 的 `Length | LayoutPolicy` 重载，API 20+）⇒ 组件**随内容收窄**、上限由父的
   * `constraintSize` 约束。默认 `false` = 撑满父宽（助手正文）。
   *
   * ⛔ 为什么需要：用户气泡此前是 `Row{ Column{MarkdownView}.layoutWeight(1) }` ⇒ 气泡恒撑满
   *   `max-w-[85%]`（web 是 `flex` 内容定宽 ⇒ 短消息自动收窄）。根 + 段落 `Text` 的 `width('100%')`
   *   是"必然撑满"的根因；`LayoutPolicy.wrapContent` 是 ArkUI 原生解法（无需复制属性链）。
   * ⚠️ 只对**全段落**消息开启（见 `UserBubble.fitWidth()`）：含代码块/表格等 `matchParent` 子块时，
   *   `wrapContent` 父会被折叠成 0（SDK 原文：无确定尺寸子项 ⇒ 容器与子项均 (0,0)）。
   */
  @Prop fitContent: boolean = false;

  build() {
    // 块级节奏 = `MD_BLOCK_GAP`(8)（`core/design.ets`；旧凹口值 6）。web 靠 margin 折叠、原生
    // `Column.space` 不折叠 ⇒ 8 是与下方各块自身 margin 相加后最接近 `MarkdownRenderer` 的节奏。
    Column({ space: MD_BLOCK_GAP }) {
      // 走缓存：流式期间整行会反复重建，没缓存就要反复解析几百 KB（见 core/markdown.ets 注释）
      ForEach(parseMarkdownCached(this.text), (b: MdBlock, idx: number) => {
        this.Block(b, idx)
      }, (b: MdBlock, idx: number) => b.key)
    }
    // 撑满父宽（助手正文）；`fitContent` ⇒ 随内容收窄（用户气泡，见该 @Prop 注释）。
    .width(this.fitContent ? LayoutPolicy.wrapContent : '100%')
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
      // 标题行高显式（web `index.css:540 line-height:1.3`）；旧实现无 `.lineHeight`。
      .lineHeight(this.sz(this.headingSize(b.level)) * MD_HEADING_LEADING)
      // 标题上/下外边距进 token（`MD_HEADING_GAP_TOP/BOTTOM`；旧凹口值 `top:8|4 / bottom:2`）。
      .margin({ top: MD_HEADING_GAP_TOP, bottom: MD_HEADING_GAP_BOTTOM })
    } else if (b.kind === MdBlockKind.Code) {
      this.CodeBlock(b)
    } else if (b.kind === MdBlockKind.Divider) {
      // 分隔线用**结构性发丝**（`Surfaces.hairline`）；原先误用 `surfaceHi`（那是"悬停/选中底色"，
      // 语义是 L3 填充不是分隔）⇒ 主题一变分隔线就与底色打架，且深浅下都不"安静"。
      // 深色族 `hairline ≡ border` 逐字节零变化；浅色/极简白下比 `border` 清楚（承载"分段"信息）。
      Divider().color(surfacesOf(this.pal()).hairline).strokeWidth(1)
        // web `index.css:583` `hr { margin: 1em 0 }`（正文 14px ⇒ 上下各 14）。
        // ArkUI 的 `Column({space:6})` **不做 margin 折叠**（web 会折叠）⇒ 这里取 SP_2(8)，
        // 合计 8+6=14 ≈ web 的 1em；原为 6 ⇒ 分隔线上下过挤、读作"粘连"。
        .margin({ top: SP_2, bottom: SP_2 })
    } else if (b.kind === MdBlockKind.Quote) {
      // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
      // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
      // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
      // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
      Column() {
        // 引用正文走 textSecondary（web `index.css:190/567`）—— 层次**弱于正文**，
        // 让 3px accent 竖条成为唯一的"强调"，而不是引用块里外都是同一档字色。
        this.Inline(b.text, this.pal().textSecondary)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      // 对齐 web `index.css:566` `padding: 0 0.75em`（左右 12，上下 0）；原生端给上下各 SP_1(4)
      // 留一点呼吸（web 靠 margin 折叠、原生 Column 不折叠）⇒ 原 SP_2(8)+8 过厚、玻璃块显得笨重。
      .padding({ left: 11, right: SP_3, top: SP_1, bottom: SP_1 })
      // 引用块：左侧 3px accent 竖条 + 半透明玻璃底（竖条必须用 border，见上）
      .backgroundColor(this.eff().glassBg)
      // 圆角对齐 web `index.css:569` `border-radius: 0 4px 4px 0`：**只有右侧**两角圆角，
      // 左侧贴 3px 竖条保持方角（原为四角 8vp ⇒ 竖条两端"翘"出圆角，读作描边而非结构边界）。
      .borderRadius({ topRight: R_SM, bottomRight: R_SM })
      .border({ width: { left: 3, top: 0, right: 0, bottom: 0 }, color: this.pal().accent })
    } else if (b.kind === MdBlockKind.List) {
      Column({ space: MD_LIST_ITEM_GAP }) {
        ForEach(b.items, (item: string, k: number) => {
          Row({ space: 6 }) {
            if (this.liChecked(b, k) >= 0) {
              // 任务列表（GFM）：勾选态用符号（**系统符号，禁 emoji/字符图标**）。
              // 对齐 web remark-gfm 的 checkbox；此前 `[ ]`/`[x]` 被当字面文本上屏（缺失）。
              SymbolGlyph(this.liChecked(b, k) === 1
                ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.circle'))
                .fontSize(typeOf('type.callout').size)
                .fontColor([this.liChecked(b, k) === 1 ? this.pal().successText : colorOf(this.pal(), 'iconMuted')])
                .margin({ top: SPACE_HAIR })
                .flexShrink(0)
            } else {
              Text(b.ordered ? `${k + 1}.` : '•')
                .fontSize(typeOf('type.callout').size)
                .fontColor(this.pal().textSecondary)
                .margin({ top: SPACE_HAIR })
                .flexShrink(0)
            }
            // ⛔ P0（用户报「含列表项时该行最后若干字符超出屏宽」的真因）：
            //    `Inline(...)` 内部是 `.width('100%')` 的 `Text`，**直接放进 `Row` 里**
            //    ⇒ 子弹头宽度 + `space:6` 之外**还要再占满父 Row 的 100%** ⇒ 每行右侧稳定
            //    溢出 (`子弹头+6`)。正文段落无此病（495-509 已修同类：Text 在 Column 里，
            //    100% 即父宽）。修 = 用 `layoutWeight(1)` 容器吃掉"剩余宽度"，
            //    内层 Text 的 100% 于是 = 剩余宽 ✓（本仓既有范式：第 438/638 行）。
            Column() {
              this.Inline(item, this.pal().textPrimary)
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
          // 逐项嵌套级别（不再用 `b.level` 首项级别 ⇒ 嵌套子列表真正缩进，对齐 web）
          .padding({ left: this.liLevel(b, k) * MD_LIST_INDENT })
        }, (item: string, k: number) => `${b.key}-li${k}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (b.kind === MdBlockKind.Table) {
      this.TableBlock(b)
    } else {
      this.Inline(b.text, this.pal().textPrimary)
      // 图片：xbot 的图片引用是 cookie 鉴权端点（ArkUI Image(url) 不带 cookie）
      // ⇒ 由页面取字节，AuthImage 负责解码/显示/缓存；点按交给查看器。
      ForEach(imagesIn(b.text), (src: string, k: number) => {
        AuthImage({
          src: src,
          load: this.loadImage,
          onOpen: this.onImage,
          maxHeight: this.imageMaxHeight,
          theme: this.themeId(),
        })
      }, (src: string, k: number) => `${b.key}-img${k}`)
    }
  }

  /** 段落/引用/列表项的行内渲染（零条件分支：样式全部预计算）。
   *  `baseColor` 透传给 `inlineStyles`（引用传 textSecondary，其余传 textPrimary）。 */
  @Builder
  Inline(text: string, baseColor: string) {
    Text() {
      ForEach(inlineStyles(text, this.pal(), this.mdTheme, baseColor), (s: MdInlineStyle) => {
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
          // ── 链接可点击（P0#1）──────────────────────────────────────────────
          // 旧实现把链接渲染成"带下划线的彩色 Span"却**没有任何 onClick** ⇒ 链接根本点不开。
          // web 权威是渲染真 `<a target="_blank" href>`（`MarkdownRenderer.tsx:311-321`）；
          // 原生对应"交给系统按 viewData 打开"（与页面 `Index.ets:4543 openUrl` 同一手段）。
          // ⛔ Span 只支持 onClick/onHover 两个通用事件（SDK `span.d.ts:108-110`）。
          // 非链接 span 也挂 onClick，但内部判空为 no-op（ArkUI 无法在属性链里条件省略）。
          .onClick(() => {
            if (s.link.length > 0) {
              this.openLink(s.link);
            }
          })
      }, (s: MdInlineStyle, i: number) => `sp-${i}-${s.text.length}`)
    }
    // `fitContent`（用户气泡）⇒ 随内容收窄；否则撑满（助手正文）。
    .width(this.fitContent ? LayoutPolicy.wrapContent : '100%')
    .textAlign(TextAlign.Start)
    // 正文字行高显式（`MD_BODY_LEADING`=1.55 × `type.body` 15fp）——本仓此前正文**无一处**
    // `.lineHeight()`（`docs/REDESIGN.md §1.2`），行高由 ArkUI 默认值接管、不可控。
    .lineHeight(this.sz(typeOf('type.body').size) * MD_BODY_LEADING)
    // 不可断超长 token（URL/代码/base64）在 ArkUI 里默认不在词内折行 ⇒ 横向撑破容器；
    // 与 xbot Web 端已定稿的教训同源（break-words 不够，必须 wrap-anywhere）。
    .wordBreak(WordBreak.BREAK_ALL)
  }

  /** 统一字号缩放入口（所有正文/标题/代码都经这里，避免漏改一处导致大小不一致）。 */
  private sz(n: number): number {
    return n * this.fontScale;
  }

  /**
   * 打开消息里的链接（P0#1）—— "点击后发生什么"：交给**系统按 viewData 打开**（浏览器/邮件客户端）。
   *
   * - 协议白名单复用 `core/msgops.resolveOpenable`（http/https/mailto，相对地址按 `linkBase` 解析）；
   * - 与页面 `pages/Index.ets:4543 openUrl` 同一手段（`startAbility({action:'ohos.want.action.viewData'})`）；
   * - 白名单拒绝（`javascript:`/`data:`/未知相对地址）⇒ **什么都不做**（不打开、不猜测）。
   *
   * ⚠️ 做成组件内自足实现（而非新增调用方回调）：避免为接线去改 `MessageRow/LiveTailView/Index`
   *   三个**并行 agent 正在改**的文件（冲突风险）；`linkBase` 已留作页面透传入口。
   */
  private openLink(href: string): void {
    const abs: string = resolveOpenable(href, this.linkBase);
    if (abs.length === 0) {
      return;
    }
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      ctx.startAbility({ action: 'ohos.want.action.viewData', uri: abs }).catch(() => {
        // 有意吞：`startAbility` 异步失败无处可提示（打开链接由系统选择器接管，用户已见系统 UI）；
        // 此处失败不改变页面状态 ⇒ 只吞。（同步异常由外层 try 记 `console.error`。）
      });
    } catch (e) {
      console.error('open link failed');
    }
  }

  /**
   * 代码块**语言条**（语言标签 + 「复制」）的取色：是否必须**跟随代码底**。
   *
   * 语言条是代码块的 chrome，但它的底此前写死 `pal().surfaceAlt`（全局次级面），
   * 而代码区底是 `codeBgOf(mdTheme, pal)`（所选 md 主题）——**两条独立的明暗轴**。
   * 二者**相反**时（最常见：极简白/浅色应用 + 默认 `vscode-dark`）会得到
   * "近白语言条压在全黑代码块上"的割裂，且标签色 `textMuted`（全局）对那个底也不配对。
   *
   * 判据：`isLightPalette(pal) !== isLightMdTheme(mdTheme)` ⇒ 跟随代码底（同明暗时**零回归**）。
   * ⛔ 一律按**亮度**判（色板用 `isLightPalette`，md 主题用 `isLightMdTheme`），不按主题名硬判。
   */
  private codeChromeOnTone(): boolean {
    return isLightPalette(this.pal()) !== isLightMdTheme(this.mdTheme);
  }

  /** 语言条底色：同明暗 = 全局次级面（既有观感）；相反 = 与代码区同底的 md 主题代码底。 */
  private codeStripBg(): string {
    return this.codeChromeOnTone() ? codeBgOf(this.mdTheme, this.pal()) : this.pal().surfaceAlt;
  }

  /** 「复制」色：同明暗 = 全局 `accentSoft`（既有观感）；相反 = md 主题代码字色（与其底配对）。
   *  ⚠️ 语言标签**刻意不跟随**：`textMuted` 是**中调灰**（浅色系 #94A3B8/#A2A2A7、深色系 #63636F），
   *  压在浅底与深底上都读得出（实测：浅色族恒 ≥2.34、深色族恒 ≥3.09）⇒ 保持既有的
   *  "语言标签 = textMuted"（web `index.css:199 --md-code-lang-text`）语义与源码形态不变。 */
  private codeStripAction(): string {
    return this.codeChromeOnTone() ? codeFgOf(this.mdTheme) : this.pal().accentSoft;
  }

  @Builder
  CodeBlock(b: MdBlock) {
    Column() {
      Row() {
        // 语言标签：对齐 web `MarkdownRenderer.tsx:214`（`font-mono text-[11px]`）+
        // `index.css:199 --md-code-lang-text: var(--text-muted)`。原为 textSecondary 且非等宽
        // ⇒ 标签比"语言名"该有的分量更抢眼，且与代码区的等宽字不同族。
        Text(b.lang.length > 0 ? b.lang : 'code')
          .fontSize(11)
          .fontFamily('monospace')
          .fontColor(this.pal().textMuted)
          .layoutWeight(1)
        Text('复制')
          .fontSize(11)
          .fontColor(this.codeStripAction())
          // press 反馈：全 App 统一口径 `PRESS_OPACITY`（此前**点了像没反应**——无任何反馈）
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            // 剪贴板：用 pasteboard（`getContext(this).getApplicationContext().getPasteboard()` 不是 ArkTS API）
            try {
              const data: pasteboard.PasteData =
                pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, b.code);
              pasteboard.getSystemPasteboard().setData(data);
              // 可见反馈 = **品牌 toast**（落点由页面经 `onToast` 注入 ⇒ 与消息级复制**同一落点**）。
              // ⛔ 文案**不变**（`copyLabel('复制', true)` = 「已复制」）—— 本单**只改落点**，不改文案。
              // ⛔ 不再用系统 `promptAction.showToast`（不跟设计系统）；⛔ 不用组件内 `setTimeout`
              //    （性能预算 ⑦ 的 `setTimeout` 调用点已用满 7，见 `docs/PERF-BUDGET.md §2-18`）。
              this.onToast(copyLabel('复制', true));
            } catch (e) {
              // 失败：**不撒谎**（不弹「已复制」），只记日志（与既有"失败静默"一致）
              console.error('copy failed');
            }
          })
      }
      .width('100%')
      .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_1 })
      .backgroundColor(this.codeStripBg())
      // 语言条上圆角 = `RADIUS_CARD`（`#13`：与块体同档，设计系统语义圆角）。
      .borderRadius({ topLeft: RADIUS_CARD, topRight: RADIUS_CARD })
      // 顶部细条（语言标签条）与代码区之间一条**结构性发丝**（`#13`：边 = hairline，
      // 不再用 `eff().glassBorder` —— 玻璃是"浮层面板"材质，用在内容面上是语义错位）。
      .border({ width: { bottom: 1 }, color: hairlineOf(this.pal()) })

      // ── 代码区：Prism4j 高亮 + 溢出策略 ──────────────────────────────────────
      // 溢出（P0#2）：换行模式 ⇒ 词内折行；不换行模式 ⇒ **横向滚动**。
      // ⛔ 旧的 `maxLines(1000) + TextOverflow.Clip` 会**静默裁掉**超长行（丢数据）；
      //    web 权威 = `overflow-x-auto whitespace-pre`（`MarkdownRenderer.tsx:226`）。
      // 高亮（P0#3）：复用既有引擎（`core/highlight.ets`，Prism4j）+ `ToolPopover` 同一份
      //    语义色映射（`codeTokenColor`，对代码底做对比度护栏）⇒ 全 App 只有一套"代码"长相。
      // 四周内边距 = SP_3(12)：web `MarkdownRenderer.tsx:223` `<pre className="p-3 pt-7 …">` 的 `p-3`。
      if (codeOverflow(this.wrapCode) === MdOverflow.Scroll) {
        // 不换行：外层横向滚动；内层 Text **不设 width('100%')**（宽度 = 最长行宽 ⇒ 溢出即横滑）。
        Scroll() {
          Text() {
            ForEach(highlightCode(b.code, b.lang), (sp: HlSpan, si: number) => {
              Span(sp.text).fontColor(codeTokenColor(sp.key, this.pal(), this.mdTheme))
            }, (sp: HlSpan, si: number) => `hl-${b.key}-${si}-${sp.text.length}`)
          }
          .wordBreak(WordBreak.NORMAL)
          .fontFamily('monospace')
          .fontSize(MD_CODE_SIZE)
          // 代码行高显式（`MD_CODE_LEADING`=1.5；等宽字需更紧但仍要可读）——旧实现无 `.lineHeight`。
          .lineHeight(MD_CODE_SIZE * MD_CODE_LEADING)
          .padding(SP_3)
          .textAlign(TextAlign.Start)
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Auto)
        .width('100%')
        // ⛔ H0 硬红（contrast-ux 复核 + 用户截图证据）：横向滚动区**自身必须 `clip`**，
        //    否则内容按最长行撑宽父级 ⇒ 整条消息列超出视口（`.width('100%')` 只在父级有确定宽时才是约束）。
        .clip(true)
        .align(Alignment.TopStart)
      } else {
        Text() {
          ForEach(highlightCode(b.code, b.lang), (sp: HlSpan, si: number) => {
            Span(sp.text).fontColor(codeTokenColor(sp.key, this.pal(), this.mdTheme))
          }, (sp: HlSpan, si: number) => `hl-${b.key}-${si}-${sp.text.length}`)
        }
        .wordBreak(WordBreak.BREAK_ALL)
        .fontFamily('monospace')
        .fontSize(MD_CODE_SIZE)
        .width('100%')
        .padding(SP_3)
        .textAlign(TextAlign.Start)
      }
    }
    .width('100%')
    // ⛔ 横向溢出护栏（2026-10-11 用户截图：代码块长行把**整条消息列**撑出视口右缘）：
    //    Scroll 模式下内层 Text 的固有宽度 = 最长行宽 ⇒ 若容器不设上界/不裁剪，**父级**会被顶宽。
    //    `constraintSize({maxWidth:'100%'})` 把宽度锁死在父级（不参与"被内容反推"），`clip(true)`
    //    保证任何残余超宽只在块内被裁（横向滚动由内层 Scroll 负责）⇒ 绝不溢出。
    .constraintSize({ maxWidth: '100%' })
    .clip(true)
    // 代码块底 = `surface.well`(sunken)（`#13` 视觉裁决：视觉以设计系统为权威，不再跟随 md 主题底；
    // md 主题降级为"语法色覆盖项"，见 `docs/REDESIGN.md §7.9`）。圆角 = `RADIUS_CARD`、边 = 发丝。
    .backgroundColor(wellOf(this.pal()))
    .borderRadius(RADIUS_CARD)
    .border({ width: 1, color: hairlineOf(this.pal()) })
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
  /**
   * 表格单元格：**行内解析 + 列对齐**（对齐 web）。
   * web 的 `COMPONENTS` 只覆盖 `code`/`a`/`img`（`MarkdownRenderer.tsx:319-338`）⇒ `td`/`th` 走
   * react-markdown **默认渲染**（单元格内的 `**粗体**`/`` `码` ``/链接**照常解析**）；
   * GFM 列对齐（`remark-gfm`，`:31`）同理。原生此前用裸 `Text(cell)` ⇒ 单元格内标记**原样上屏**。
   * ⛔ 字号用 `MD_TABLE_SIZE`（单元格自己的尺度），不能用 `MdInlineStyle.size`（默认 15=正文）。
   */
  @Builder
  TableCellSpan(text: string, ci: number, b: MdBlock, head: boolean) {
    Text() {
      ForEach(inlineStyles(text, this.pal(), this.mdTheme, this.pal().textPrimary), (s: MdInlineStyle, i: number) => {
        Span(s.text)
          .fontSize(MD_TABLE_SIZE)
          .fontColor(s.color)
          .fontWeight((s.bold || head) ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(s.italic ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(s.mono ? 'monospace' : 'sans-serif')
          .textBackgroundStyle({ color: s.bg, radius: R_SM })
          .decoration({
            type: s.strike ? TextDecorationType.LineThrough
              : (s.underline ? TextDecorationType.Underline : TextDecorationType.None),
            color: s.color,
          })
          .onClick(() => {
            if (s.link.length > 0) {
              this.openLink(s.link);
            }
          })
      }, (s: MdInlineStyle, i: number) => `tc-${b.key}-${ci}-${i}-${s.text.length}`)
    }
    .wordBreak(WordBreak.BREAK_ALL)
    .fontSize(MD_TABLE_SIZE)
    .fontColor(this.pal().textPrimary)
    .textAlign(this.ta(alignOf(b.aligns, ci)))
    .layoutWeight(1)
    .padding({ left: MD_TABLE_CELL_X, right: MD_TABLE_CELL_X, top: MD_TABLE_CELL_Y, bottom: MD_TABLE_CELL_Y })
  }

  /** 列对齐码（`0`=左 / `1`=中 / `2`=右）⇒ `TextAlign`。 */
  private ta(n: number): TextAlign {
    if (n === 1) { return TextAlign.Center; }
    if (n === 2) { return TextAlign.End; }
    return TextAlign.Start;
  }

  @Builder
  TableBlock(b: MdBlock) {
    Column() {
      if (useTableGrid(b.header.length)) {
        Row() {
          ForEach(b.header, (h: string, k: number) => {
            this.TableCellSpan(h, k, b, true)
          }, (h: string, k: number) => `${b.key}-th${k}`)
        }
        .width('100%')
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius({ topLeft: R_LG, topRight: R_LG })
        .padding({ left: 2, right: 2 })

        ForEach(b.rows, (row: string[], ri: number) => {
          Row() {
            ForEach(row, (cell: string, ci: number) => {
              this.TableCellSpan(cell, ci, b, false)
            }, (cell: string, ci: number) => `${b.key}-td${ri}-${ci}`)
          }
          .width('100%')
          .border({ width: { top: 1 }, color: hairlineOf(this.pal()) })
        }, (row: string[], ri: number) => `${b.key}-tr${ri}`)
      } else {
        Row({ space: SP_1 }) {
          // 图标走系统符号（项目纪律：禁 emoji/字符图标；`square_grid_2x2` 语义 = 网格/表格，
          // 已在仓内其它处使用过，符号名已核实存在于 sys.symbol 资源）。
          SymbolGlyph($r('sys.symbol.square_grid_2x2'))
            .fontSize(ICON_SM).fontColor([this.pal().textSecondary])
            .flexShrink(0)
          Text(`表格（${b.header.length} 列 · ${b.rows.length} 行）`)
            .fontSize(11).fontColor(this.pal().textSecondary)
            // 依据：本站点内容是**纯数字标签**（列/行计数，无 URL/长 token），但仍统一走 `BREAK_ALL`
            // ⇒ 与正文/标题同口径（本文件正文级 Text 一律 BREAK_ALL，除代码块**横滑**那处有意 NORMAL）。
            .wordBreak(WordBreak.BREAK_ALL)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ left: 8, right: 8, top: 6, bottom: 4 })

        ForEach(b.rows, (row: string[], ri: number) => {
          Column({ space: 3 }) {
            ForEach(tableRowFields(b.header, row), (f: TableField, fi: number) => {
              Row({ space: 6 }) {
                Text(f.label)
                  // ⛔ 层级纪律（2026-10-11 审计）：这里是**阶梯里的 caption 档值(12)** 却写成字面量
                  //    ⇒ 绕过排版阶梯。改为走档（同号 ⇒ 1.0 下视觉零变化，但换档/审计都跟着走）。
                  .fontSize(typeOf('type.caption').size).fontColor(this.pal().textSecondary)
                  .constraintSize({ minWidth: 84 })
                  // 依据：表头标签来自 markdown 表格首行（用户内容，可能含长 token）⇒ 必须 BREAK_ALL
                  // （`BREAK_WORD` 对"无空格超长串"无效 —— 与 `Inline` 正文同一条理由，web 亦为 break-words）。
                  .wordBreak(WordBreak.BREAK_ALL)
                Text(f.value)
                  .wordBreak(WordBreak.BREAK_ALL)
                  .fontSize(MD_TABLE_SIZE).fontColor(this.pal().textPrimary)
                  .layoutWeight(1)
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
            }, (f: TableField, fi: number) => `${b.key}-s${ri}-${fi}`)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          .border({ width: { top: ri === 0 ? 0 : 1 }, color: hairlineOf(this.pal()) })
        }, (row: string[], ri: number) => `${b.key}-sr${ri}`)
      }
    }
    .width('100%')
    .border({ width: 1, color: hairlineOf(this.pal()) })
    .borderRadius(R_LG)
    .clip(true)
    .margin({ top: SP_1, bottom: SP_1 })
  }

  /**
   * 标题字号（h1..h4）—— 取自**唯一尺度源** `core/design.ets:mdHeadings()`（24/20/17/15），
   * 不再用组件私有凹口值（旧 `20/18/16/15`）。h4 == 正文（web `1em` 原义）。
   */
  private headingSize(level: number): number {
    const hs: MdHeading[] = mdHeadings();
    for (let i = 0; i < hs.length; i++) {
      if (hs[i].level === level) {
        return hs[i].size;
      }
    }
    return hs[hs.length - 1].size;
  }

  /** 列表项 k 的嵌套级别（数组长度兜底 ⇒ 老数据/异常不越界）。 */
  private liLevel(b: MdBlock, k: number): number {
    return k < b.itemLevels.length ? b.itemLevels[k] : b.level;
  }

  /** 列表项 k 的勾选态（`-1` = 非任务项）。 */
  private liChecked(b: MdBlock, k: number): number {
    return k < b.itemChecked.length ? b.itemChecked[k] : -1;
  }
}
