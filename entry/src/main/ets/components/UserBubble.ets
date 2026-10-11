/**
 * 用户气泡（从页面抽出的组件）。
 *
 * ⛔ 同上：@Reusable 的复用必须在 `aboutToReuse(params)` 里更新数据，否则复用实例会保留
 * **旧参数**（@Prop 也不会自动刷新）⇒ 跨会话串内容。先用无复用的正确版本。
 *
 * 依据 harmony-next skill 的《应用体验与性能规范》§2 帧率优化：
 * 「对于长列表，务必使用 `LazyForEach`…结合 `@Reusable` 装饰器实现组件级复用，
 *   降低创建和销毁的开销」；§1「主线程解放」。
 * 这里只接**原始类型**（text/theme）与回调，避免 @Prop 深拷贝对象（ArkUI @Prop 对对象是拷贝语义）。
 *
 * 样式**逐条映射 web**（`core/bubble.ets` 是唯一映射表）：
 *   · 气泡 `rounded-2xl rounded-br-sm` ⇒ 四角 16、右下 2；
 *   · `px-3.5 py-2` ⇒ 水平 14 / 垂直 8；
 *   · `bg-accent/15` ⇒ 主题 accent @15%；
 *   · `max-w-[85%]` ⇒ 最大宽度 85%；
 *   · 外层 `px-1` + `.virt-row py-1.5` ⇒ 水平 4 / 垂直 6。
 */
import { Palette, paletteOf } from '../core/theme';
import { BUBBLE } from '../core/bubble';
import { UserBubbleFace, userBubbleFace } from '../core/bubbleview';
// 普通用户消息走**与助手同一条** markdown 渲染（web `UserMessage.tsx:4-5`）⇒ 复用同一组件。
import { MarkdownView } from './MarkdownView';
import { GAP_ROW_Y, INSET_BUBBLE_X, INSET_BUBBLE_Y, RADIUS_BUBBLE, typeOf } from '../core/design';
import { annotatedMessagePlainText } from '../core/annotations';

/**
 * 批注展示的**文案表**（逐字对齐 web `i18n/zh-CN.ts:451-461` 的 `agent.annotations.*`）。
 *
 * ⛔ 为什么放在这里而不是 `core/i18n.ets`：原生 i18n 目前**只有 locale 清单、没有文案表**
 *   （全 UI 文案硬编码，见 `core/i18n.ets` 头注释）⇒ 这里只给展示函数注入它需要的 4 个 key，
 *   与"原生 UI 文案 = 硬编码中文"的现状同款；英/日在原生端尚未接入（与其余 UI 一致）。
 *
 * ⚠️ 必须逐字对齐 web：`feedbackHeading` 是**发给用户的显示文案**，若与 web 分叉，
 *   同一份信封在两端显示不同 ⇒ 本函数是"展示侧"的真源之一。
 */
function annotationLabel(key: string, num?: number): string {
  if (key === 'agent.annotations.item') { return `批注 ${num !== undefined ? num : 1}`; }
  if (key === 'agent.annotations.quote') { return '所选文本'; }
  if (key === 'agent.annotations.comment') { return '用户评论'; }
  if (key === 'agent.annotations.feedbackHeading') { return '针对本会话之前的回答，补充以下批注反馈：'; }
  return '';
}

@Component
export struct UserBubbleView {
  @Prop text: string = '';
  /** 显式主题覆盖（测试/独立预览）；生产页面留空 ⇒ 跟随 `appTheme` 订阅。 */
  @Prop theme: string = 'dark';
  /**
   * 全局主题**订阅**（生产唯一真源）—— 与 `MessageRowView` 同根因：用户气泡行也由 `LazyForEach`
   * 承载，主题变更不改变行键 ⇒ 已存在行的 `@Prop theme` 会冻结在创建那刻（浅色主题下取深色板 =
   * 白字）。⇒ 行**自己订阅** AppStorage，主题变更时每个已存在实例各自重渲染（与列表键语义无关）。
   */
  @StorageProp('appTheme') appTheme: string = '';
  /**
   * 该 user 行是否为**后台通知注入**（web `UserMessage.tsx:45` 的 `isNotification`）。
   *
   * 通知类 ⇒ **原样呈现**（web `UserMessage.notification.test.tsx:13/23`：shell 命令不得进
   * markdown ⇒ `nowrap` 会在手机上横向溢出）；普通用户消息 ⇒ 走**与助手同一条** markdown 渲染
   * （web `UserMessage.tsx:4-5` 原文 *"Content is rendered through the same MarkdownRenderer as
   * Agent output … ensuring identical markdown rendering"*）。
   */
  @Prop isNotification: boolean = false;
  /** Markdown 主题 id（与助手侧**同一口径**，由页面透传；只影响代码块/行内码配色）。 */
  @Prop mdTheme: string = 'vscode-dark';
  /** 点击图片（页面打开 Lightbox）—— 与助手侧**同一回调**。 */
  onImage: (src: string) => void = () => {
  };
  /** 取图片字节（带鉴权；页面持有 HTTP 客户端）—— 与助手侧**同一回调**。 */
  loadImage: (src: string) => Promise<ArrayBuffer> = async (s: string) => {
    return new ArrayBuffer(0);
  };

  /** 长按（页面据此弹"复制"菜单） */
  onLongPress: () => void = () => {
  };

  /**
   * 气泡里该显示的文本（**唯一出口**）。
   *
   * 后端/其它端发的**带批注 user 消息**其 content 是出站信封
   *（`# Response annotations:\n…<response-annotations>…</response-annotations>\n\n# My request:\n正文`）
   * ⇒ 直接渲染会把**裸 XML 上屏**。经 `core/annotations.annotatedMessagePlainText` 转成
   * **纯文本**（非信封 ⇒ 逐字原样，零回归）。该函数属 `core/`，纯函数、有脱机单测。
   * ⚠️ 收成一个方法是有意的：`user_bubble_annotations.test.ts` 断言本组件里
   * `annotatedMessagePlainText(` **调用点恒为 1**（两条渲染分支都消费同一出口）。
   */
  private displayText(): string {
    return annotatedMessagePlainText(this.text, annotationLabel);
  }

  /** 生效主题：生产走订阅，缺失时回落显式覆盖（单一口径，不产生两个真源）。 */
  private themeId(): string {
    return this.appTheme.length > 0 ? this.appTheme : this.theme;
  }

  private pal(): Palette {
    return paletteOf(this.themeId());
  }

  /**
   * 用户气泡的"面"（**唯一判据**：底色 + 与之配对的文字色）。
   *
   * ⛔ 底色**只此一处**：曾经这里 `.backgroundColor(...)` 与 `.linearGradient(...)` 叠了两层
   *   （后者不透明，盖住前者 ⇒ 屏幕上成饱和 accent 色块，与 web 的 `bg-accent/15` 不符）。
   *   现收敛到 `core/bubbleview.ets` 的 `userBubbleFace()`，web 权威见该文件头。
   */
  private face(): UserBubbleFace {
    return userBubbleFace(this.pal());
  }

  build() {
    Row() {
      Blank()
      // 内容分支（**web 同源判据**，见文件头 props 注释）：
      //   · **通知类**（`isNotification`）⇒ 原样纯文本（web `UserMessage.notification.test.tsx:13/23`）；
      //   · **普通用户消息** ⇒ 走**与助手同一条** markdown 渲染（web `UserMessage.tsx:4-5`）。
      //     ⇒ 发送图片时被追加的 `![image.png](/api/files/…)` 引用因此渲染成**图片**，
      //       而不是把裸 markdown 漏成文本（真机截图实测的缺陷：气泡里显示一整条 URL）。
      // ⚠️ 两条分支样式**有意重复**：ArkUI 属性链无法跨分支复用；改一处必须改两处。
      if (this.isNotification) {
        Text(this.displayText())
          .wordBreak(WordBreak.BREAK_ALL)
          // 字号走语义层 `type.body`（15fp）；文字色 = 与淡色底配对的 `textPrimary`（web `text-text-primary`）。
          // ⛔ 不再用 `onAccent`（那是"实心 accent 之上的字"的角色，与 accent@15% 淡底不匹配）。
          .fontSize(typeOf('type.body').size).fontColor(this.face().textColor)
          // 内距 = 语义令牌 `INSET_BUBBLE_X/Y`（14/8，**值 ==** 原映射表 `px-3.5 py-2`）⇒ 等值迁移。
          .padding({
            left: INSET_BUBBLE_X, right: INSET_BUBBLE_X,
            top: INSET_BUBBLE_Y, bottom: INSET_BUBBLE_Y,
          })
          .constraintSize({ maxWidth: `${BUBBLE.userMaxWidthPct}%` })
          // 底色**唯一来源**：主题 accent @15%（映射表 `core/bubble.ets` / web `bg-accent/15`）。
          // ⛔ 不再叠渐变：web 气泡没有渐变，叠加会变成 web 之外的第二种底色。
          .backgroundColor(this.face().bg)
          // 四角 16 = 语义令牌 `RADIUS_BUBBLE`（等值）；右下角单独收小 —— 原 `BUBBLE.userRadiusBR`=2，
          // 令牌 `RADIUS_BUBBLE_TAIL`=4 **值不等** ⇒ 保留原值，见交付的"待裁决"清单。
          .borderRadius({
            topLeft: RADIUS_BUBBLE, topRight: RADIUS_BUBBLE,
            bottomLeft: RADIUS_BUBBLE, bottomRight: BUBBLE.userRadiusBR,
          })
          // ⛔ 不再叠 `.shadow(...)`：web `UserMessage.tsx` 的用户气泡**无阴影**（`docs/REDESIGN.md §7.1`
          //   也把气泡定义为"**有面**：着色底 + 圆角 + 右对齐 + 右下小角" —— 靠**填充**区分，
          //   不靠投影）。原实现是一记字面量投影（`radius:12 / offsetY:2`，未进 token）⇒ 既非
          //   web 语言、又与"助手容器无阴影"（`bubble_style.test.ts` 同款守卫）不一致。
          //   ⇒ 删除投影，回到"只有面"的极简语言（纯白主题下也没有需要柔影分离的浮层语义）。
          .copyOption(CopyOptions.LocalDevice)
      } else {
        // 外层 `Column` 承载气泡样式（⛔ 不把 `constraintSize` 等通用属性直接挂在自定义组件上）。
        Column() {
          MarkdownView({
            text: this.displayText(),
            mdTheme: this.mdTheme,
            onImage: this.onImage,
            loadImage: this.loadImage,
          })
        }
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: INSET_BUBBLE_X, right: INSET_BUBBLE_X,
          top: INSET_BUBBLE_Y, bottom: INSET_BUBBLE_Y,
        })
        .constraintSize({ maxWidth: `${BUBBLE.userMaxWidthPct}%` })
        .backgroundColor(this.face().bg)
        .borderRadius({
          topLeft: RADIUS_BUBBLE, topRight: RADIUS_BUBBLE,
          bottomLeft: RADIUS_BUBBLE, bottomRight: BUBBLE.userRadiusBR,
        })
      }
    }
    .width('100%')
    // 外层 `px-1` + `.virt-row py-1.5`（与助手行同一条带）；垂直间距 = 语义令牌 `GAP_ROW_Y`
    // （6，**值 ==** 原 `BUBBLE.rowPadY`）⇒ 等值迁移。
    .padding({
      left: BUBBLE.assistantPadX, right: BUBBLE.assistantPadX,
      top: GAP_ROW_Y, bottom: GAP_ROW_Y,
    })
    .gesture(LongPressGesture().onAction(() => {
      this.onLongPress();
    }))
  }
}
