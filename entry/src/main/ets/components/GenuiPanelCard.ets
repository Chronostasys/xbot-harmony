/**
 * GenuiPanelCard —— GenUI（`display_html`）工具结果的**面板卡**。
 *
 * ── 为什么需要它（目标④ 用户原话）────────────────────────────────────────────
 * 「必须真的支持 web 的所有插件和功能…比如**统计插件的面板我们看不到**」。
 * web 把 `display_html` 的结果当**顶层面板**渲染（`GenUIPanel.tsx:36`：默认展开、
 * 标题 + 折叠 + 全屏），而不是一枚工具 pill；原生此前只画 pill ⇒ 面板"看不见"。
 *
 * ── 渲染策略（⛔ 原生**不解析**这段代码）──────────────────────────────────────
 * 面板源码是 LLM 生成的 **TSX**，web 用 `sucrase` 编译 + `new Function()` 求值 + React 挂载
 * （`SandboxedUI.tsx:33`）；**ArkTS 禁动态求值** ⇒ 原生不可能执行它。
 * 唯一与 web 一致的落地：把源码交给 web **自己的**分享渲染链（依据见 `core/genui.ets` 头注释），
 * 在 `WebSurface`（ArkWeb）里渲染 —— 且**只渲染这个面板**（`/s/<token>`，不是整个聊天应用）。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────────
 *   ⛔ **判据与渲染同源**：本文件**零判据** —— 标题/副标题/源码全部由 `core/genui.ets`
 *      的纯函数给出（`genuiCardTitle` / `genuiCardSubtitle`）。
 *   ⛔ 颜色**零字面量** + **唯一取色门** `col(role)`（全文件仅 1 处 `this.palOnce()`）
 *      ⇒ 对性能预算 `$n_pal_all` 的贡献**恒 1 处**（`tools/perf/guard.sh`）。
 *   ⛔ 必须是 **@Component + @Prop**（带参 `@Builder` 的子树不随参数重建 ——
 *      `docs/ARKTS-GOTCHAS.md`；`subtitle`/`live` 会随流式变化）。
 */
import { Palette, paletteOf } from '../core/theme';
import { pasteboard } from '@kit.BasicServicesKit';
import {
  HIT_TARGET_MIN, INSET_ROW_X, PRESS_OPACITY, RADIUS_CARD, SPACE_SM, SPACE_XS,
  STROKE_HAIRLINE, SURFACE_CARD, colorOf, hairlineOf, surfaceFillOf, typeOf,
} from '../core/design';
import {
  GENUI_OPEN_LABEL, SHARE_BUSY, SHARE_DONE, SHARE_ERR, SHARE_IDLE, shareLabelOf,
} from '../core/genui';
import { animBase } from './anim';

/** 指示器/图标尺寸（与同层 pill 视觉同档）。 */
const GENUI_ICON: number = 14;

@Component
export struct GenuiPanelCard {
  /** 卡片标题（`core/genui.genuiCardTitle` 的结果）。 */
  @Prop title: string = '';
  /** 卡片副标题（`core/genui.genuiCardSubtitle` 的结果；空 ⇒ 不渲染该行）。 */
  @Prop subtitle: string = '';
  /** 面板源码（`core/genui.genuiCode` 的结果）—— 点「打开面板」时原样交上层。 */
  @Prop code: string = '';
  /** 是否"在飞"（生成中）—— 决定指示器形态。 */
  @Prop live: boolean = false;
  @Prop theme: string = 'dark';
  /**
   * **生效主题的全局订阅**（§21.124 用户亲报「切主题后老文字颜色不变、新的才变」）。
   *
   * ⛔ 本组件挂在 `MessageRow` 的**带参 `@Builder` 子树**（`AssistantBlock(this.row)`）里 ——
   *   该子树在主题变化时**不重建**（参数是同一个 `ChatRow` 引用 ⇒ ArkUI V1 判「参数没变」，
   *   见 `docs/ARKTS-GOTCHAS.md §4/§37`）⇒ 子树里组件在**创建那刻**拿到的 `@Prop theme`
   *   会**永久冻结**（旧块停旧色板、新建块才用新色板 = 用户看到的「老的不变、新的才变」）。
   * ✅ 正解 = 本仓范式（同 `MessageRow.themeId()` / `MarkdownView`）：**组件自己订阅**
   *   `AppStorage('appTheme')` ⇒ 主题变更直接驱动本组件重绘，不经父级投递。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /** 生效主题：全局订阅优先，`@Prop theme` 仅兜底（同 `MessageRow.themeId()`）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }
  /** 打开面板（上层负责建分享 + 落 URL）—— 只上报，不自己发请求（分层铁律）。 */
  onOpen: (code: string, title: string) => void = (code: string, title: string) => {
  };
  /**
   * 分享（上层负责建分享链接并带回 URL）—— 与 `onOpen` 同一分层铁律：组件不自己发请求。
   * 对齐 web `genui/index.tsx:129-151`（`ctx.share.create` → `clipboard.writeText`）：
   * 返回非空 URL ⇒ 组件复制进系统剪贴板 + 落 done（『已复制链接』）；空串 ⇒ error（可重按重试）。
   */
  onShare: (code: string, title: string) => Promise<string> = (code: string, title: string): Promise<string> => {
    return Promise.resolve('');
  };
  /**
   * 分享 chip 的四态（判据与渲染同源：文案走 `core/genui.ets` 的 `shareLabelOf`，
   * state 字面量对齐 web `genui/index.tsx:126`）。**组件自持**（busy/done/error 是 chip
   * 自身的交互态，上层不管视觉）——同 `ShareablePanel` 的 useState。
   */
  @State shareState: string = SHARE_IDLE;

  /**
   * 色板缓存（`theme` 变化才重算）。
   * ⛔ 两个缓存字段的**初值非取色**（`null`/空串）—— 否则 `tools/tests/staleness_audit.test.ts`
   *    的 R1 会硬红（"结构体字段初值里算色"）。形态与 `AskUserSheet.ets:157-158` 同款。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  /** 记忆化取色（分配 1 次/主题）—— ⛔ 全文件**唯一**的 `this.palOnce()` 读取点。 */
  private palOnce(): Palette {
    if (this.palCache === null || this.palThemeCache !== this.themeId()) {
      const fresh: Palette = paletteOf(this.themeId());
      this.palCache = fresh;
      this.palThemeCache = this.themeId();
      return fresh;
    }
    return this.palCache;
  }

  /**
   * **唯一取色门**（角色名 ⇒ 颜色）。所有取色都过这里：
   *   · `'title'`/`'sub'` = 文本两档；`'accent'`/`'accentSoft'` = 强调；
   *   · `'card'` = 卡片面（`surface.card`）；`'rule'` = 结构性发丝。
   */
  private col(role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'title') { return p.textPrimary; }
    if (role === 'sub') { return p.textMuted; }
    if (role === 'card') { return surfaceFillOf(p, SURFACE_CARD); }
    if (role === 'rule') { return hairlineOf(p); }
    return colorOf(p, role);
  }

  /**
   * 分享 chip 点按（web `genui/index.tsx:129-151` ShareablePanel.onShare 的对等物）。
   * ArkUI onClick **不冒泡**（子组件消费后不再触发整卡 onOpen）⇒ 无需 web :129 的
   * stopPropagation 对应物。busy 守卫（:131 同款：请求回来前重复点按无效）。
   * done **保持**（:142 同款：按钮持续『已复制链接』，无回落定时器）；error 可重按重试。
   */
  private shareClicked(): void {
    if (this.shareState === SHARE_BUSY) {
      return;
    }
    this.shareState = SHARE_BUSY;
    this.onShare(this.code, this.title).then((url: string) => {
      if (url.length === 0) {
        this.shareState = SHARE_ERR;
        return;
      }
      try {
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, url);
        pasteboard.getSystemPasteboard().setData(data);
      } catch (e) {
        // 剪贴板不可用（web :143-147 同款吞）：链接已建成不算失败，仍落 done。
      }
      this.shareState = SHARE_DONE;
    }).catch(() => {
      this.shareState = SHARE_ERR;
    });
  }

  build() {
    Row({ space: SPACE_SM }) {
      // ── 标记：生成中 = 会动的原生指示器；就绪 = 面板图标 ────────────────────────
      Stack() {
        if (this.live) {
          LoadingProgress().width(GENUI_ICON).height(GENUI_ICON).color(this.col('accent'))
        } else {
          SymbolGlyph($r('sys.symbol.rectangle_on_rectangle'))
            .fontSize(GENUI_ICON).fontColor([this.col('accentSoft')])
        }
      }.width(GENUI_ICON).height(GENUI_ICON)

      Column({ space: SPACE_XS }) {
        Text(this.title)
          .fontSize(typeOf('type.callout').size).fontWeight(typeOf('type.callout').weight)
          .fontColor(this.col('title'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          // 横向约束显式化（`Row` 内的可变长文本；同仓惯例见 `AskUserSheet`/`FilesSheet`）——
          // 外层 `Column` 已 `layoutWeight(1)`，这里声明文本自身也永不超宽（否则被
          // `tools/tests/horizontal_overflow_gate.test.ts` 的 H1 判为"Row 内无横向约束"）。
          .constraintSize({ maxWidth: '100%' })
          .width('100%')
        if (this.subtitle.length > 0) {
          Text(this.subtitle)
            .fontSize(typeOf('type.micro').size).fontColor(this.col('sub'))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: '100%' })
            .width('100%')
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)

      // ── 动作：分享 chip（web ShareablePanel:122-181；⚠️ 仅历史态显示——web 的流式路径
      //    GenUIPanel.tsx 不包 ShareablePanel，历史渲染路径 :204 才包）+「打开面板」提示。
      //    整卡仍可点（onOpen）；chip 独立 onClick（ArkUI 不冒泡，双触发不存在）。
      Row({ space: SPACE_XS }) {
        if (!this.live) {
          // 热区 = 真实 ≥44 布局盒（`responseRegion` 外扩真机无效 ⇒ 仓内铁律；hit_target_pad
          // 判 A 类：裸可点 Text 靠 padding 撑高 <44 ⇒ 必须有布局盒承载）。
          Row() {
            Text(shareLabelOf(this.shareState))
              .fontSize(typeOf('type.caption').size)
              // ⚡ 2026-10-20 丝滑动画：分享状态切换时文字颜色缓动
              .animation(animBase())
              // done=successText / error=dangerText（web：绿底 rgba(34,197,94,.15)+字 inherit、
              // error 字 #dc2626 —— 原生透明动作片用色字表达，色对权威 successText/dangerText 记档）
              .fontColor(this.shareState === SHARE_DONE ? this.col('successText')
                : (this.shareState === SHARE_ERR ? this.col('dangerText') : this.col('accentSoft')))
          }
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.shareClicked();
          })
        }
        Text(GENUI_OPEN_LABEL)
          .fontSize(typeOf('type.caption').size).fontColor(this.col('accentSoft'))
      }
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(this.col('card'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: this.col('rule') })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onOpen(this.code, this.title);
    })
  }
}
