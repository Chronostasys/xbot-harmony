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
import { WebSurface } from './WebSurface';

/** 指示器/图标尺寸（与同层 pill 视觉同档）。 */
const GENUI_ICON: number = 14;

/**
 * 内联面板高度（vp）。同 web `GenUIPanel.tsx:203` 的 `max-h-[70vh] overflow-auto`：
 * **有界**高度 + 面板内部自己滚动 ⇒ 不把消息流撑爆（长表格/图表也不会顶穿一行）。
 */
const GENUI_INLINE_H: number = 320;

/**
 * 同时**内联挂载**的面板上限。
 *
 * 为什么必须有：一个 ArkWeb 实例是重资源（独立渲染进程/内存）。历史会话里可能有十几张
 * `display_html` 面板 —— 全部"免点击自动展示"会把内存和滚动都拖死。超限的卡片退回紧凑卡
 * （仍可点「打开面板」全屏看），**不是丢功能**。
 */
const GENUI_INLINE_MAX: number = 12;
let genuiInlineMounted: number = 0;

/**
 * **归还全部内联名额**（切会话 / 页面重建时调用）。
 *
 * ⛔ 用户 2026-11-18：「切会话再切回来渲染面板就看不到了」。根因是名额计数只增不减 ——
 *   `aboutToDisappear` 在切会话（Index 页不销毁、LazyForEach 回收不保证回调）时不被调用
 *   ⇒ `genuiInlineMounted` 单调上涨 ⇒ 撞上限后所有面板永久退化成紧凑卡（只看得到 header bar）。
 */
export function resetGenuiInlineBudget(): void {
  genuiInlineMounted = 0;
}

@Component
export struct GenuiPanelCard {
  /** 卡片标题（`core/genui.genuiCardTitle` 的结果）。 */
  @Prop title: string = '';
  /** 卡片副标题（`core/genui.genuiCardSubtitle` 的结果；空 ⇒ 不渲染该行）。 */
  @Prop subtitle: string = '';
  /** 面板源码（`core/genui.genuiCode` 的结果）—— 点「打开面板」时原样交上层。 */
  /**
   * 面板源码。
   *
   * ⛔ `@Watch` 是刚需：切会话重建行时 `@Prop` 可能**后于** `aboutToAppear` 到位，
   *   只尝试一次就会永远停在紧凑卡（用户 2026-11-18：「只看得到 header bar，看不到内容」）。
   */
  @Prop @Watch('onCodeChanged') code: string = '';
  /** 是否"在飞"（生成中）—— 决定指示器形态。 */
  @Prop @Watch('onLiveChanged') live: boolean = false;
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

  // ── 免点击直接展示（用户 2026-11-06：「display html 画出的窗口，不需要用户点开就能展示」）──
  /**
   * 面板在**本卡片内**内联渲染的地址（空 = 还没准备好，落 compact 卡片 + 「打开面板」）。
   * web 的对应行为：`GenUIPanel.tsx:196-203` 把 `SandboxedUI` **直接挂在消息流里**
   * （`max-h-[70vh] overflow-auto`），不是"一枚按钮"。
   */
  @State private inlineUrl: string = '';
  /** 正在建分享（首帧/重建时短促；文案走 `GENUI_PREPARING_LABEL`）。 */
  @State private preparing: boolean = false;

  /**
   * 组件挂载即**自动**准备面板（不点也展示）。
   * ⛔ 分层铁律不变：组件**不发请求** —— 只调上层给的 `onShare`（页面建分享 + 进程级 cookie），
   *    页面按 `genuiPanelKey(code)` 缓存 ⇒ 反复挂载只建一次分享。
   */
  aboutToAppear(): void {
    this.ensureInline();
  }

  /** `live → false`（提交）后自动准备 —— 生成中的半截源码不建分享。 */
  private onLiveChanged(): void {
    this.ensureInline();
  }

  /**
   * **唯一的 `onShare` 调用点**（分享 chip 与「免点击自动准备」共用）。
   *
   * ⛔ 为什么收敛成一处：分层铁律是"组件不 IO" —— 这里只是把上层回调转成 Promise；
   *    而 `tools/tests/genui_share.test.ts` 钉「onShare 回调**恰 1 处调用**」以防它被写成
   *    死消费。自动展示若另起一处调用会破坏该判据的判别力 ⇒ 两条路径都走本方法。
   */
  private requestUrl(): Promise<string> {
    return this.onShare(this.code, this.title);
  }

  /** `code` 到位/变化 ⇒ 重新尝试内联（幂等：已有 url / preparing / live 都会早退）。 */
  private onCodeChanged(): void {
    this.ensureInline();
  }

  private ensureInline(): void {
    if (this.live || this.inlineUrl.length > 0 || this.preparing) {
      return;
    }
    if (this.code.length === 0) {
      return;
    }
    // 并发内联上限（ArkWeb 是重资源；超限退回紧凑卡，仍可手动全屏）
    if (genuiInlineMounted >= GENUI_INLINE_MAX) {
      return;
    }
    this.preparing = true;
    this.requestUrl().then((url: string) => {
      this.preparing = false;
      // 失败（空串）⇒ 保持紧凑卡片，用户仍可点「打开面板」重试（可见失败，不静默）。
      if (url.length > 0) {
        this.inlineUrl = url;
        genuiInlineMounted++;
      }
    }).catch(() => {
      this.preparing = false;
    });
  }

  /** 卸载时归还内联名额（列表回收/切会话）。 */
  aboutToDisappear(): void {
    if (this.inlineUrl.length > 0) {
      genuiInlineMounted = genuiInlineMounted > 0 ? genuiInlineMounted - 1 : 0;
    }
  }

  /**
 * 内联面板 —— **只有 web 自带的那一个 header**（用户 2026-11-18：「看起来有两个 header」）。
 *
 * ⛔ 原生标题行已删除：web 分享页自带「🎨 UI rendered … Shared from xbot」标题栏，
 *   再叠一行原生标题（同样的 title + 「打开面板」）就是**双 header** 的观感来源。
 *   动作移到**内容下方一行**（不遮挡面板，也不与 web header 打架）：
 *   左「复制链接」四态（busy/ok/err/idle）+ 右「打开面板」。
 */
  @Builder
  InlinePanel() {
    Column({ space: SPACE_XS }) {
      // ⚠️ 高度**有界**（同 web 的 `max-h-[70vh]`）：面板自己滚动，不把消息流撑爆。
      WebSurface({
        url: this.inlineUrl,
        theme: this.themeId(),
        chrome: false,
        chatId: '',
        channel: 'web',
      })
        .width('100%')
        .height(GENUI_INLINE_H)
        .borderRadius(RADIUS_CARD)
        .clip(true)

      // ── 动作行（原先在原生 header 里；现在不遮挡面板内容）─────────────────
      Row({ space: SPACE_SM }) {
        this.ShareChip()
        Blank()
        Row() {
          Text(GENUI_OPEN_LABEL)
            .fontSize(typeOf('type.caption').size).fontColor(this.col('accentSoft'))
        }
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onOpen(this.code, this.title);
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
    .backgroundColor(this.col('card'))
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: this.col('rule') })
    .alignItems(HorizontalAlign.Start)
  }

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
    this.requestUrl().then((url: string) => {
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
      // ⛔ 用户 2026-11-18：「希望无论什么时候 display_html 都渲染 inline 面板」。
      //   建链成功说明 URL 可用 ⇒ 紧凑卡就地切成内联（不必再点一次「打开面板」）。
      if (this.inlineUrl.length === 0 && genuiInlineMounted < GENUI_INLINE_MAX) {
        this.inlineUrl = url;
        genuiInlineMounted++;
      }
      this.shareState = SHARE_DONE;
    }).catch(() => {
      this.shareState = SHARE_ERR;
    });
  }

  /**
   * **分享 chip 的唯一实现**（紧凑卡与内联态共用）。
   *
   * ⛔ 同一视觉只许一份实现（仓规）：两处各写一遍会让文案/色/热区/动效漂移，
   *   而且 `motion_budget` 台账会把 `animation` 记成两次。
   * ⛔ 热区 = 真实 ≥44 布局盒（`responseRegion` 外扩真机无效 ⇒ 仓内铁律）。
   */
  @Builder
  ShareChip() {
    Row() {
      Text(shareLabelOf(this.shareState))
        .fontSize(typeOf('type.caption').size)
        // 丝滑动画：分享状态切换时文字颜色缓动
        .animation(animBase())
        // done=successText / error=dangerText（语义 role，非自造色）
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

  /** 紧凑卡（未就绪 / 生成中 / 建链接失败）—— 保留「打开面板」逃生口。 */
  @Builder
  CompactCard() {
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
          // 唯一实现见 `ShareChip()`（文案/色/热区/动效同源）。
          this.ShareChip()
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

  build() {
    // 免点击展示：URL 就绪 ⇒ 直接在内联 `WebSurface` 里渲染面板；
    // 否则落紧凑卡（生成中 / 建链接中 / 建链接失败可重试）。
    if (this.inlineUrl.length > 0) {
      this.InlinePanel()
    } else {
      this.CompactCard()
    }
  }
}
