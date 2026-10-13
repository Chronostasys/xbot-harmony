/**
 * StagingTray —— 「待发队列托盘」（**输入区上方**的内联条；web `components/agent/StagingTray.tsx` 同构）。
 *
 * ── 为什么是它（目标④「必须真的支持 web 的所有插件和功能」）──────────────────────
 *   web 权威：`StagingTray` 排在 `MessageList` 与 `MessageInput` **之间**，队列非空才渲染。
 *   本仓此前只有**顶栏一枚 `队列 N` chip**（点了开 `components/QueueSheet.ets`）⇒ 用户在
 *   不看面板时**不知道**"后面还排着几条 / 下一条是什么"。本组件把队列提到输入区上方
 *   （与 `GoalBanner` / `TodoPanel` 同列、同层级），折叠态一行、展开态可逐条「插队 / 取消」。
 *
 * ── 分层铁律（同 QueueSheet / StatusSheet）──────────────────────────────────────
 *   · 组件只**画**：判据全在 `core/staging.ets`（可脱机单测）；`showQueue` / 队列数据 /
 *     store 动作（清空/插队/取消）**都在页面** ⇒ 本文件不 import store。
 *   · ⛔ 成员名避开 ArkUI `CustomComponent` 基类（`id`/`key`/`size`/`height`/…）。
 *   · 颜色只用 `paletteOf(theme)` 语义 token（**禁 hex**）；命中区用**真实 44×44 布局盒**
 *     （⛔ `responseRegion` 负偏移外扩在 SDK21 实测**无效**，见 AGENTS.md GOTCHA）。
 *   · 展开/折叠走**布局变化**（`animateTo` + 底座 `animFast()`），⛔ 不自造时长/曲线。
 *   · **性能预算纪律**（同 `FilesSheet`/`AskUserSheet`）：取色收敛到**唯一** `trayColor(role)`
 *     门（内含唯一 `this.palOnce()`）⇒ 本文件对该预算的读取点**恒 1 处**（⛔ 别逐处直写
 *     `this.pal().x`，会把 B 线读取点顶穿）。
 */
import { Palette, paletteOf } from '../core/theme';
import { QueueItem } from '../core/types';
import {
  colorOf, HIT_TARGET_MIN, INSET_ROW_X, PRESS_OPACITY, RADIUS_CARD,
  SPACE_HAIR, SPACE_SM, SPACE_XS, STROKE_HAIRLINE, surfaceFillOf, structuralRuleOf, typeOf,
} from '../core/design';
import { fs, fw, lh } from './SettingsRows';
import { animFast } from './anim';
import { stagingCountLabel, stagingHeadPreview, stagingItemId, stagingListHeight, stagingPreview, stagingText } from '../core/staging';

/** 折叠态「下一条」预览的最大码点数（单行，够辨识即可）。 */
const HEAD_PREVIEW_CP: number = 40;
/** 展开态每条预览的最大码点数（≤3 行）。 */
const ITEM_PREVIEW_CP: number = 120;

@Component
export struct StagingTray {
  @Prop theme: string = 'dark';
  /** 待发队列（页面 `store.queue` 的镜像；顺序与 id 判据都在页面/core）。 */
  @Prop queue: QueueItem[] = [];
  /** 展开态（组件本地 UI 状态 —— ⛔ 不进 store、不动任何弹层 flag）。 */
  @State private expanded: boolean = false;

  /** 打开 `QueueSheet`（重排 / 全量管理）—— 队列数据与动作留页面。 */
  onOpenManager: () => void = () => {
  };
  /** 插队发送某条（须传**完整内容**，服务端 `preview` 会截断）。 */
  onInterject: (id: string, full: string) => void = () => {
  };
  /** 取消某条。 */
  onCancel: (id: string) => void = () => {
  };

  /** 色板一次性读取（本文件**唯一** —— 见下方 `trayColor`）。 */
  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * **唯一取色门**：一次取色换 N 个站点（性能预算：全仓 `this.pal()`/`this.palOnce()`
   * 读取点**只许减**）。⛔ 别在 UI 里逐处直写 `this.pal().x` —— 会顶穿 B 线预算。
   */
  private trayColor(role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'fg') {
      return p.textPrimary;
    }
    if (role === 'hint') {
      return p.textMuted;
    }
    if (role === 'accentSoft') {
      return p.accentSoft;
    }
    if (role === 'icon') {
      return colorOf(p, 'iconMuted');
    }
    if (role === 'card') {
      return surfaceFillOf(p, 'surface.card');
    }
    if (role === 'rule') {
      return structuralRuleOf(p);
    }
    return p.textPrimary;
  }

  /** 折叠态的「下一条」预览（队首）。 */
  private headText(): string {
    return this.queue.length > 0 ? stagingHeadPreview(this.queue[0], HEAD_PREVIEW_CP) : '';
  }

  private toggle(): void {
    this.getUIContext().animateTo(animFast(), () => {
      this.expanded = !this.expanded;
    });
  }

  build() {
    // ⛔ 唯一显示判据（同 web `:56`）：队列为空 ⇒ **不产出任何节点**（无空行/占位）。
    if (this.queue.length > 0) {
      Column({ space: SPACE_HAIR }) {
        // ── 头部行：计数 + （折叠时）下一条预览 + 「管理」+ 展开箭头 ──────────────────
        Row({ space: SPACE_XS }) {
          SymbolGlyph($r('sys.symbol.list_bullet'))
            .fontSize(typeOf('type.subhead').size)
            .fontColor([this.trayColor('icon')])
          Text(stagingCountLabel(this.queue.length))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontColor(this.trayColor('fg'))
          // 折叠时才显示「下一条」——展开后列表本身就是全貌，再显示会重复。
          if (!this.expanded && this.headText().length > 0) {
            Text(this.headText())
              .fontSize(fs('type.caption'))
              .lineHeight(lh('type.caption'))
              .fontColor(this.trayColor('hint'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
          } else {
            Blank()
          }
          // 「管理」= 打开 QueueSheet（重排/清空是它独有的能力，⛔ 不在托盘里重造一份）。
          Text('管理')
            .fontSize(fs('type.caption'))
            .fontColor(this.trayColor('accentSoft'))
            .padding({ left: SPACE_XS, right: SPACE_XS })
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onOpenManager();
            })
          // 展开/折叠：真实 44×44 布局盒承载 onClick（⛔ 不用 responseRegion 外扩）。
          Row() {
            SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
              .fontSize(typeOf('type.subhead').size)
              .fontColor([this.trayColor('icon')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .accessibilityText(this.expanded ? '收起待发队列' : '展开待发队列')
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.toggle();
          })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        // ── 展开态：逐条（预览 + 插队 + 取消）。长队列由列表**内部滚动**容纳（有界 maxHeight）。──
        if (this.expanded) {
          List({ space: 0 }) {
            ForEach(this.queue, (q: QueueItem, i: number) => {
              ListItem() {
                Row({ space: SPACE_XS }) {
                  Text(stagingPreview(stagingText(q), ITEM_PREVIEW_CP))
                    .fontSize(fs('type.caption'))
                    .lineHeight(lh('type.caption'))
                    .fontColor(this.trayColor('fg'))
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .wordBreak(WordBreak.BREAK_ALL)
                    .layoutWeight(1)
                  // 插队（⚡）—— 真实 44 盒；语义 = 注入正在跑的回合。
                  Row() {
                    SymbolGlyph($r('sys.symbol.bolt_fill'))
                      .fontSize(typeOf('type.subhead').size)
                      .fontColor([this.trayColor('accentSoft')])
                  }
                  .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
                  .justifyContent(FlexAlign.Center)
                  .accessibilityText('插队发送')
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    this.onInterject(stagingItemId(q), stagingText(q));
                  })
                  // 取消（✕）
                  Row() {
                    SymbolGlyph($r('sys.symbol.xmark'))
                      .fontSize(typeOf('type.subhead').size)
                      .fontColor([this.trayColor('icon')])
                  }
                  .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
                  .justifyContent(FlexAlign.Center)
                  .accessibilityText('取消这一条')
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    this.onCancel(stagingItemId(q));
                  })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
              }
            }, (q: QueueItem, i: number) => `stg-${stagingItemId(q)}#${i}`)
          }
          .width('100%')
          .constraintSize({ maxHeight: stagingListHeight(this.queue.length) })
          // 整行不是点击目标（行内已有两枚按钮）⇒ 关条避免滚动条叠在按钮上抢命中。
          .scrollBar(BarState.Off)
        }
      }
      .width('100%')
      .padding({ left: INSET_ROW_X, right: SPACE_HAIR, top: SPACE_HAIR, bottom: SPACE_HAIR })
      .backgroundColor(this.trayColor('card'))
      .borderRadius(RADIUS_CARD)
      // 面→面轮廓走 `structuralRuleOf`（与同列 `TodoPanel`/`GoalBanner` 同通道）。
      .border({ width: STROKE_HAIRLINE, color: this.trayColor('rule') })
      .margin({ left: SPACE_SM, right: SPACE_SM, bottom: SPACE_XS })
    }
  }
}
