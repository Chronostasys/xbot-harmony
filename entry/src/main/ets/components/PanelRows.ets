/**
 * PanelRows —— 运行面板（任务管理）的**结构化行卡**（真实 @Component + @Prop）。
 *
 * ── 为什么是独立组件（而不是页面里的 `@Builder`）────────────────────────────────
 * ① 用户点名「终端和任务管理做的很差」：四类列表此前都是**单行纯文本**（页面 `@Builder` 里
 *    直接 `Text(bgTaskLine(...))`）—— 状态与元信息被长命令挤掉（真机实测：62 条后台任务全
 *    渲染成「完成 <长命令…>」，时长/id 被 `maxLines` 截掉）。改「主行 + 副行」必须**随数据更新**
 *    ⇒ ⛔ 不能用带参 `@Builder`（参数是调用那刻的快照 ⇒ 列表卡首帧，见 ARKTS-GOTCHAS），
 *    必须是真 `@Component` + `@Prop`。
 * ② 取色用 `paletteOf(this.theme)`（组件自带 theme）⇒ **不占页面性能预算**
 *    （`tools/perf/guard.sh` 只数 `this.pal()` / `this.palOnce()` 的**字面次数**，页面侧因此净减）。
 *
 * ── 形态（对齐 web `web/src/components/sidebar/TasksPanel.tsx`，⛔ 不是一比一复刻像素）──
 * 行卡 = `主行（标识）` + `副行（状态 · 元信息，按 tone 上色）` +（可选）尾部动作。
 * 主行**单行截断**（长命令不再挤掉后面的元信息 —— 元信息已独立成副行）。
 * ⛔ tone ⇒ 调色板 role 的映射**只在本文件**（`core/panels.ets` 只产 tone 字符串、不 import 主题）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  colorOf, structuralRuleOf, surfaceFillOf,
  HIT_TARGET_MIN, ICON_XL, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY, RADIUS_CARD,
  SPACE_HAIR, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD,
} from '../core/design';
import { fs, fw, lh } from './SettingsRows';
import { TONE_ERROR, TONE_MUTED, TONE_SUCCESS, LEAD_CRON, LEAD_FAIL, LEAD_KILLED, LEAD_OK, LEAD_RUNNING } from '../core/panels';
import { t as i18nT } from '../core/i18n';

/**
 * 尾部动作码 —— ⛔ 用**码**（字符串）而不是 `Resource`：`@Prop` 传 `Resource` 在 ArkTS 上要
 * 额外处理，而尾部动作只有这几种；组件内查表 → `$r('sys.symbol.*')`（唯一映射点）。
 */
export const ROW_TRAIL_NONE: string = 'none';
/** 可点进详情（后台任务 / 终端）。 */
export const ROW_TRAIL_CHEVRON: string = 'chevron';
/** 删除（定时任务）。 */
export const ROW_TRAIL_DELETE: string = 'delete';
/** 关闭（终端）。 */
export const ROW_TRAIL_CLOSE: string = 'close';
/**
 * **终止**（运行中的后台任务）—— web `TasksPanel.tsx:246-255` 的 `Square` 按钮同源：
 * 「正在跑的任务」在**列表里**一步可杀，不必先点进详情。
 *
 * ⛔ 为什么只给运行中的行：web 同样只在 `running` 时渲染该按钮（完成/失败的任务没有可终止的东西，
 *    给个永远无效的动作 = Apple 明令禁止的"看起来可点其实没用"）。判据在场外 = `core/panels.bgTaskRunning`。
 */
export const ROW_TRAIL_STOP: string = 'stop';

@Component
export struct PanelRowCard {
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') localeStamp: string = '';
  @Prop theme: string = 'dark';
  /** 主行（标识）——单行截断。 */
  @Prop primary: string = '';
  /** 副行（状态 · 元信息）——空串则不渲染该行。 */
  @Prop secondary: string = '';
  /** 语义 tone（`core/panels.ets` 的 `TONE_*`）——决定副行颜色。 */
  @Prop tone: string = 'muted';
  /**
   * **前导状态码**（`core/panels.ets` 的 `LEAD_*`；空串 ⇒ 不渲染前导字形）。
   * 为什么要有：真机实测 354 条任务一屏平铺 ⇒ 靠副行文字扫不出「哪条在跑 / 哪条失败」；
   * 前导字形让状态**一眼可扫**（Apple 列表行范式：状态字形恒在第一列，文字对齐不跳）。
   */
  @Prop lead: string = '';
  /** 尾部动作码（`ROW_TRAIL_*`）。 */
  @Prop trailing: string = 'none';
  /** 整卡是否可点（false ⇒ 不挂动作、不显示按压反馈 —— 如 Runner 行纯信息）。 */
  @Prop tappable: boolean = true;
  /** 整卡点击（行主体）。 */
  onTap: () => void = () => {
  };
  /** 尾部动作点击。 */
  onTrailing: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * tone ⇒ 副行颜色（**唯一映射点**）。
   * ⛔ 只取**一次**色板再分支：`this.pal()` 是**未记忆化分配**（每次 `withAccent` 重新分配调色板）
   *    ⇒ 每个分支各取一次会虚增性能预算 B 线（色板读取总量；`tools/perf/guard.sh`）。
   */
  private toneColor(): string {
    const p: Palette = this.pal();
    if (this.tone === TONE_SUCCESS) {
      return p.successText;
    }
    if (this.tone === TONE_ERROR) {
      return p.dangerText;
    }
    return p.textMuted;
  }

  /**
   * 前导状态字形的颜色（**唯一映射点**；⛔ 同 `toneColor` —— 只取一次色板）。
   * 形随状态（形已足够表达），**色只强调"需要动作"的两个状态**（运行中/失败）；
   * 完成/已终止保持中性（354 条的历史里，满屏彩色勾会变成噪声）。
   */
  private leadColor(): string {
    const p: Palette = this.pal();
    if (this.lead === LEAD_RUNNING) {
      return p.accentSoft;
    }
    if (this.lead === LEAD_FAIL) {
      return p.dangerText;
    }
    return colorOf(p, 'iconMuted');
  }

  /**
   * 尾部图标的**唯一**取色点。
   *
   * ⛔ 收成方法的理由 = 性能预算 **B 线**（`this.pal()` ∨ `this.palOnce()` 的**字面出现次数**，
   *    `tools/perf/guard.sh`）**顶格 1350、只许减不许增**：三段尾部动作（chevron / 删除·关闭 /
   *    终止）此前**各自**直读一次色板 ⇒ 补「终止」时新增第 4 处字面量 ⇒ 真门禁实测 **1351 真红**。
   *    收进本方法后：**+1（本方法）− 3（三处分支直读） = 净 −2** ⇒ 1351 → **1349**（留 1 格余量）。
   * ⚠️ 语义逐字节不变：`danger` ⇒ 破坏性动作色（删除 / 关闭 / 终止共用），否则弱化图标色（chevron）。
   */
  private trailColor(danger: boolean): string {
    const p: Palette = this.pal();
    return danger ? p.dangerText : colorOf(p, 'iconMuted');
  }

  build() {
    Row({ space: SPACE_XS }) {
      // 前导状态字形（**固定槽宽** ⇒ 有/无字形的行文字仍然对齐；Apple 列表行范式）。
      // ⛔ 符号名一律实证过（SDK `resources.txt` 精确命中），不猜。
      if (this.lead.length > 0) {
        Row() {
          if (this.lead === LEAD_RUNNING) {
            SymbolGlyph($r('sys.symbol.arrow_2_circlepath'))
              .fontSize(fs('type.caption'))
              .fontColor([this.leadColor()])
          } else if (this.lead === LEAD_OK) {
            SymbolGlyph($r('sys.symbol.checkmark_circle'))
              .fontSize(fs('type.caption'))
              .fontColor([this.leadColor()])
          } else if (this.lead === LEAD_FAIL) {
            SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
              .fontSize(fs('type.caption'))
              .fontColor([this.leadColor()])
          } else if (this.lead === LEAD_KILLED) {
            SymbolGlyph($r('sys.symbol.stop_circle'))
              .fontSize(fs('type.caption'))
              .fontColor([this.leadColor()])
          } else if (this.lead === LEAD_CRON) {
            // 定时行的**常驻**⏰（web `TasksPanel.tsx:115` AlarmClock 同源）。
            // ⛔ 符号名用本面板空态**已装机实证**过的 `clock`（`Index.ets` 的 `PanelEmpty`），不猜新名。
            SymbolGlyph($r('sys.symbol.clock'))
              .fontSize(fs('type.caption'))
              .fontColor([this.leadColor()])
          }
        }
        .width(ICON_XL)
        .justifyContent(FlexAlign.Start)
        .alignItems(VerticalAlign.Center)
      }
      Column({ space: SPACE_HAIR }) {
        Text(this.primary)
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.secondary.length > 0) {
          Text(this.secondary)
            .fontSize(fs('type.caption'))
            .fontWeight(fw('type.caption'))
            .lineHeight(lh('type.caption'))
            .fontColor(this.toneColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.trailing === ROW_TRAIL_CHEVRON) {
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(fs('type.micro'))
          .fontColor([this.trailColor(false)])
      } else if (this.trailing === ROW_TRAIL_STOP) {
        // 运行中的后台任务：**行内终止**（web `TasksPanel.tsx:246-255` 的 `Square` 按钮同款）。
        // ⛔ 热区 = 真实 `HIT_TARGET_MIN` 布局盒（⛔ 不用 `responseRegion` 负偏移外扩 —— 真机实测无效）。
        // 图标取 `square_fill` = 本仓「停止」的既有字形（composer 的停止键同款）⇒ 与"已终止"的
        // **状态**字形（`stop_circle`，见 `LEAD_KILLED`）刻意区分：一个是动作、一个是状态。
        Row() {
          SymbolGlyph($r('sys.symbol.square_fill'))
            .fontSize(fs('type.caption'))
            .fontColor([this.trailColor(true)])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('终止任务'))
        .onClick(() => {
          this.onTrailing();
        })
      } else if (this.trailing === ROW_TRAIL_DELETE || this.trailing === ROW_TRAIL_CLOSE) {
        // ⛔ 热区**不靠** `responseRegion` 负偏移外扩（真机实测 SDK21 无效，见 AGENTS.md GOTCHAS）
        //    ⇒ 图标放进真实 `HIT_TARGET_MIN` 布局盒、盒内居中（图标视觉尺寸不变）。
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(fs('type.caption'))
            .fontColor([this.trailColor(true)])
        }
        .width(HIT_TARGET_MIN)
        .height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        // ⛔ 嵌套可点元素**必须自带** press（`interactive_feedback` ⑦ 口径；与 `QueueSheet` 行内移除同款）
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(this.trailing === ROW_TRAIL_DELETE ? '删除' : '关闭')
        .onClick(() => {
          this.onTrailing();
        })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({
      left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y,
    })
    .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
    // S2（形状语言 12/8 两级，与侧栏 `785a3fa` 同一口径）：**容器** = `RADIUS_CARD`（12）。
    .borderRadius(RADIUS_CARD)
    // L2 内嵌卡「面到面轮廓」= `structuralRuleOf`（门禁 ③ 硬红：L2 卡不许走 L1 的 `hairlineOf`）
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
    // 不可点（纯信息行）⇒ `.enabled(false)`（ArkUI 同时禁掉点击与按压反馈；
    // ⛔ 别用 `tappable ? PRESS_OPACITY : 1` 的条件按压 —— 破坏 `interactive_feedback` 的
    //    "按压值必须取自 PRESS_OPACITY"口径，且守卫式 onClick 必须配 `.enabled(flag)`）
    .enabled(this.tappable)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      if (this.tappable) {
        this.onTap();
      }
    })
  }
}
