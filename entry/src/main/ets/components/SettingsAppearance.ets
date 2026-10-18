/**
 * SettingsAppearance —— 「外观」分区（**承接被删的页面 `PrefsSheet` 全部本地外观偏好**）。
 *
 * 为什么要有它（收敛决定，2026-10-11 用户亲报「两个设置面板」）：
 *   原生端此前有**两份**设置 UI：页面里内联的 `PrefsSheet`（本地外观）与 `SettingsSheet`
 *   （服务端/账号）。收敛决议：**唯一实现 = 全屏 `components/SettingsPanel`**；本文件把
 *   `PrefsSheet` 的本地外观项**逐条搬进**设置面，页面那份删除（`Index.ets` 归 sidebar-ux）。
 *
 * ── 承接清单（`pages/Index.ets` 旧 `PrefsSheet` 逐项，⛔ 一条不许丢）─────────────
 *   1. 聊天界面（原生 / 内嵌网页）  → 本文件「界面」组（`KEY_SURFACE`）
 *   2. 主题（**唯一一项** = markdown 主题）→ 「外观」组（`KEY_MD_THEME`）
 *   3. 字号                         → 「文字与阅读」组（`KEY_FONT_SCALE`）
 *   4. 代码换行                     → 「文字与阅读」组（`KEY_CODE_WRAP`）
 *   5. 思考默认展开                 → 「文字与阅读」组（`KEY_REASONING_DEFAULT`）
 *   6. 思考光球动效                 → 「文字与阅读」组（`KEY_ORB`）
 *   7. 通知提醒（系统授权）         → 「界面」组（系统真值，只申请/跳系统设置）
 *   8. 发送快捷键                   → 「界面」组（`KEY_SEND_KEY`）
 *   9. 强调色（预设 + 跟随主题）     → 「外观」组（`KEY_ACCENT`）
 *  10. Markdown 主题                → 「外观」组（`KEY_MD_THEME`）
 *  11. 语言（只读展示）             → 「外观」组（`KEY_LOCALE`）
 *  12. 刷新（重读设置）             → 「外观」组末（`onRefresh`）
 *
 * 分层铁律（`docs/REDESIGN.md` §11）：
 *   · 组件**只画**：显示值一律由 `@Prop` 注入的 `settings`（服务端权威）经 `core/settings`
 *     的**同一批判据**（`parseBool`/`fontScaleFrom`/`normalizeSendKey`/`orbEnabled`…）派生，
 *     ⛔ 不在组件里另写一份"默认值/回落"，⛔ 不直接改 store。
 *   · 任何写操作一律回调出去（页面 `setSetting`/`setSurface`/`setTheme`/`syncSystemTheme`）。
 *   · 行样式只消费 **共享原子**（`SettingsToolRow`/`SettingsChipRow`/`SettingsValueRow`/
 *     `SettingsActionRow`/`SettingsGroupHeader`）+ `core/design.ets` 语义令牌（⛔ 禁字面量）。
 */
import { Palette, paletteOf } from '../core/theme';
import {
  KEY_ACCENT, KEY_CODE_WRAP, KEY_FONT_SCALE, KEY_LOCALE, KEY_MD_THEME, KEY_ORB,
  KEY_REASONING_DEFAULT, KEY_SEND_KEY, fontScaleFrom, fontScaleLabel, fontScalePresets,
  normalizeSendKey, orbEnabled, parseBool, sendKeyLabel, settingLabel, settingOf,
  SEND_KEY_ENTER, SEND_KEY_MOD_ENTER,
} from '../core/settings';
import { ACCENT_PRESETS, accentLabel, contrastForeground, normalizeAccent, normalizeAccentOrNull } from '../core/accent';
import { mdThemePickerDescription, normalizeMdTheme } from '../core/mdtheme';
import { LOCALES, localeLabel, normalizeLocale } from '../core/i18n';
import {
  PRESS_OPACITY,   CONTROL_INPUT_H, HIT_TARGET_MIN, RADIUS_CHIP, SPACE_HAIR, SPACE_SM, SPACE_XS, SPACE_LG,
  STROKE_HAIRLINE, colorOf, hairlineOf,
} from '../core/design';
import {
  fs, fw, lh, SettingsActionRow, SettingsChipRow, SettingsGroupHeader, SettingsToolRow, SettingsValueRow, tc,
} from './SettingsRows';
import { SettingsMdThemePicker } from './SettingsMdTheme';
import { t as i18nT } from '../core/i18n';

/** 承载方式（`KEY_SURFACE`）的两个取值（与页面 `setSurface` 同源）。 */
const SURFACE_NATIVE: string = 'native';
const SURFACE_WEB: string = 'web';

@Component
export struct SettingsAppearance {
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') localeStamp: string = '';
  /** 服务端权威设置镜像（页面 `store.settings`）——显示值**只**从这里派生。 */
  @Prop settings: Record<string, string> = {};
  /** 当前**已应用**的主题 id（页面 `themeName`）——也是本组件的取色色板。 */
  @Prop theme: string = 'dark';
  /** 聊天界面是否为内嵌网页（页面 `useWebUI`）。 */
  @Prop surfaceWeb: boolean = false;
  /** 系统通知授权状态（页面 `notifyOn`，**只读系统真值**）。 */
  @Prop notifyOn: boolean = false;

  /** 写一项服务端设置（页面 `setSetting`）。 */
  onSetSetting: (key: string, value: string) => void = () => {
  };
  /** 切换聊天界面承载方式（页面 `setSurface`）。 */
  onSetSurface: (web: boolean) => void = () => {
  };
  /** 通知提醒开关（页面 `applyNotifyToggle`：申请系统授权 / 提示去系统设置）。 */
  onSetNotify: (on: boolean) => void = () => {
  };
  /** 重新读取设置（页面重拉 `store.loadSettings()`）。 */
  onRefresh: () => void = () => {
  };

  /**
   * 自定义强调色输入框的**草稿**（本地 `@State` ⇒ 输错不写服务端，可回退）。
   * 初值留空 = "未编辑"（此时显示值仍由 `settings` 派生，判据同源）。
   */
  @State private hexDraft: string = '';
  /** 草稿是否非法（`normalizeAccentOrNull` 返回 null）⇒ 显示错误、**不**提交。 */
  @State private hexErr: boolean = false;

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  // ── 显示值：**判据与页面同源**（`core/settings` 唯一出口）──────────────────────
  private fontScale(): number {
    return fontScaleFrom(settingOf(this.settings, KEY_FONT_SCALE));
  }
  private wrapCode(): boolean {
    return parseBool(settingOf(this.settings, KEY_CODE_WRAP), true);
  }
  private reasoningDefault(): boolean {
    return parseBool(settingOf(this.settings, KEY_REASONING_DEFAULT), false);
  }
  private orbOn(): boolean {
    return orbEnabled(this.settings);
  }
  private sendKeyMode(): string {
    return normalizeSendKey(settingOf(this.settings, KEY_SEND_KEY));
  }
  private accentHex(): string {
    const raw: string = settingOf(this.settings, KEY_ACCENT);
    return raw.trim().length === 0 ? '' : normalizeAccent(raw);
  }
  private mdThemeId(): string {
    return normalizeMdTheme(settingOf(this.settings, KEY_MD_THEME));
  }
  private localeId(): string {
    return normalizeLocale(settingOf(this.settings, KEY_LOCALE));
  }

  // ── 候选（供 chip 行；⛔ 列表与标签都不手写）──────────────────────────────────
  private fontOptions(): string[] {
    const ps: number[] = fontScalePresets();
    const out: string[] = [];
    for (let i = 0; i < ps.length; i++) {
      out.push(`${ps[i]}`);
    }
    return out;
  }
  private fontLabels(): string[] {
    const ps: number[] = fontScalePresets();
    const out: string[] = [];
    for (let i = 0; i < ps.length; i++) {
      out.push(fontScaleLabel(ps[i]));
    }
    return out;
  }

  private localeOptions(): string[] {
    const out: string[] = [];
    for (let i = 0; i < LOCALES.length; i++) { out.push(LOCALES[i].id); }
    return out;
  }
  private localeLabels(): string[] {
    const out: string[] = [];
    for (let i = 0; i < LOCALES.length; i++) { out.push(LOCALES[i].label); }
    return out;
  }

  build() {
    // 内容长（12 项 + 5 个分组头）⇒ **必须可滚动**，否则超出部分被裁切
    // （与其余分区同款：`Scroll` 承载 + `layoutWeight(1)`）。
    Scroll() {
      Column({ space: 0 }) {
      // ═══ 外观 ═══════════════════════════════════════════════════════════════
      SettingsGroupHeader({ title: '外观', theme: this.theme })

      // ⛔ **没有**独立的「应用主题」行：主题只有**一项**（下面的 markdown 主题），
      //    应用明暗由它**派生**（web 权威 `providers/theme.tsx:101` `modeForTheme(mdTheme)`）。
      //    历史：本行曾并列「深色/浅色/极光/星云/极简白」⇒ 两套主题互相打脸（用户亲报）。

      // 强调色：预设色板 + 「跟随主题」；颜色圆点不是文本 chip ⇒ 单列一段（无对应原子）
      SettingsValueRow({
        label: settingLabel(KEY_ACCENT),
        description: '只覆盖强调色家族，亮度阶梯不变。',
        value: this.accentHex().length > 0 ? accentLabel(this.accentHex()) : '跟随主题',
        theme: this.theme,
      })
      this.AccentSwatches()
      this.AccentCustomInput()

      SettingsMdThemePicker({
        theme: this.theme,
        label: settingLabel(KEY_MD_THEME),
        description: mdThemePickerDescription(),
        value: this.mdThemeId(),
        onSelect: (id: string) => {
          this.onSetSetting(KEY_MD_THEME, id);
        },
      })

      SettingsValueRow({
        label: settingLabel(KEY_LOCALE),
        description: '界面文案语言（与 Web 端共用同一份 i18n 表）。',
        value: localeLabel(this.localeId()),
        theme: this.theme,
      })
      SettingsChipRow({
        label: '语言 / Language',
        description: '切换后立即生效；写入 `xbot-locale`，与 Web 端同步。',
        value: this.localeId(),
        options: this.localeOptions(),
        labels: this.localeLabels(),
        theme: this.theme,
        onSelect: (v: string) => { this.onSetSetting(KEY_LOCALE, normalizeLocale(v)); },
      })

      // ═══ 文字与阅读 ═════════════════════════════════════════════════════════
      SettingsGroupHeader({ title: '文字与阅读', theme: this.theme })

      SettingsChipRow({
        label: settingLabel(KEY_FONT_SCALE),
        description: '消息正文的整体缩放。',
        value: `${this.fontScale()}`,
        options: this.fontOptions(),
        labels: this.fontLabels(),
        theme: this.theme,
        onSelect: (v: string) => {
          this.onSetSetting(KEY_FONT_SCALE, v);
        },
      })

      SettingsToolRow({
        label: settingLabel(KEY_CODE_WRAP),
        description: '代码块超出宽度时自动换行（关闭则横向滚动）。',
        isOn: this.wrapCode(),
        mono: false,
        theme: this.theme,
        onToggle: (_names: string[], next: boolean) => {
          this.onSetSetting(KEY_CODE_WRAP, next ? '1' : '0');
        },
      })

      SettingsToolRow({
        label: settingLabel(KEY_REASONING_DEFAULT),
        description: '新会话默认展开思考过程。',
        isOn: this.reasoningDefault(),
        mono: false,
        theme: this.theme,
        onToggle: (_names: string[], next: boolean) => {
          this.onSetSetting(KEY_REASONING_DEFAULT, next ? '1' : '0');
        },
      })

      SettingsToolRow({
        label: settingLabel(KEY_ORB),
        description: '助手在飞时的光球指示（关闭后为静态）。',
        isOn: this.orbOn(),
        mono: false,
        theme: this.theme,
        onToggle: (_names: string[], next: boolean) => {
          this.onSetSetting(KEY_ORB, next ? '1' : '0');
        },
      })

      // ═══ 界面 ═══════════════════════════════════════════════════════════════
      SettingsGroupHeader({ title: '界面', theme: this.theme })

      // §21.122bu（用户定向 2026-10-16）：**「聊天界面承载」行已降级**到「维护」组末尾 ——
      // 用户原话「保留，但是这个入口不该显眼。这个主要调试用和 fallback」。
      // 日常形态**唯一** = 原生渲染（见 `core/surfaces.surfaceOf`，聊天面恒为 native）。
      SettingsChipRow({
        label: settingLabel(KEY_SEND_KEY),
        description: '输入框内的发送快捷键。',
        value: this.sendKeyMode(),
        options: [SEND_KEY_ENTER, SEND_KEY_MOD_ENTER],
        labels: [sendKeyLabel(SEND_KEY_ENTER), sendKeyLabel(SEND_KEY_MOD_ENTER)],
        theme: this.theme,
        onSelect: (v: string) => {
          this.onSetSetting(KEY_SEND_KEY, v);
        },
      })

      // 通知提醒：开关反映**系统授权状态**（应用不能自行开关系统通知，只能申请/提示）
      SettingsToolRow({
        label: '通知提醒',
        description: '开关反映系统授权状态；应用只能申请或跳转系统设置。',
        isOn: this.notifyOn,
        mono: false,
        theme: this.theme,
        onToggle: (_names: string[], next: boolean) => {
          this.onSetNotify(next);
        },
      })

      // ═══ 维护 ═══════════════════════════════════════════════════════════════
      SettingsGroupHeader({ title: '维护', theme: this.theme })
      SettingsActionRow({
        label: '重新读取设置',
        description: '从服务端重拉全部偏好（排障用）。',
        action: '刷新',
        theme: this.theme,
         onAction: () => {
         this.onRefresh();
        },
      })

      // §21.122bu：**调试 / fallback** 专用 —— 「聊天界面承载」从「界面」组降级到这里。
      // 用户定向：「保留，但是这个入口不该显眼。这个主要调试用和 fallback」。
      SettingsChipRow({
        label: '聊天界面（调试）',
        description: '调试 / fallback：整页切成内嵌 Web UI（与 web 逐字同源）。日常请保持「原生」。',
        value: this.surfaceWeb ? SURFACE_WEB : SURFACE_NATIVE,
        options: [SURFACE_NATIVE, SURFACE_WEB],
        labels: ['原生', '内嵌网页'],
        theme: this.theme,
        onSelect: (v: string) => {
         this.onSetSurface(v === SURFACE_WEB);
        },
      })
    }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ bottom: SPACE_LG })
      }
      .width('100%')
      .layoutWeight(1)
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Auto)
      .align(Alignment.Top)
  }

  /**
   * 强调色色板（预设 + 「跟随主题」）。
   *
   * ⚠️ 颜色圆点不是文本 chip，`SettingsChipRow` 覆盖不了 ⇒ 这是**唯一**一段无对应原子的控件；
   *    其尺寸/命中区仍取令牌（`HIT_TARGET_MIN` 圆点、`STROKE_HAIRLINE` 描边、`hairlineOf`）。
   * ⚠️ **改 `Flex(wrap)`（2026-10-12）**：原 `Row` 单行 + 末尾向右 `padding`，在 6 预设 + 「跟随主题」
   *    时会**把第 7 个圆点切在屏幕右缘**（真机截图确认）⇒ 换行保证不切。
   */
  @Builder
  AccentSwatches() {
    Row() {
      ForEach(ACCENT_PRESETS, (hex: string) => {
        Stack({ alignContent: Alignment.Center }) {
          if (this.accentHex().toUpperCase() === hex) {
            SymbolGlyph($r('sys.symbol.checkmark'))
              .fontSize(SPACE_SM)
              .fontColor([contrastForeground(hex)])
          }
        }
        .width(HIT_TARGET_MIN)
        .height(HIT_TARGET_MIN)
        .borderRadius(HIT_TARGET_MIN / 2)
        .backgroundColor(hex)
        .border({
          width: this.accentHex().toUpperCase() === hex ? 2 : STROKE_HAIRLINE,
          color: this.accentHex().toUpperCase() === hex ? this.pal().textPrimary : hairlineOf(this.pal()),
        })
        .margin({ bottom: SPACE_XS })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('强调色 ') + hex)
        .onClick(() => {
          this.onSetSetting(KEY_ACCENT, hex);
        })
      }, (hex: string) => `ac-${hex}`)
      // 「跟随主题」：清空该项 ⇒ 页面 `pal()` 原样返回主题色板
      Stack({ alignContent: Alignment.Center }) {
        SymbolGlyph($r('sys.symbol.arrow_counterclockwise'))
          .fontSize(SPACE_SM)
          .fontColor([this.pal().textSecondary])
      }
      .width(HIT_TARGET_MIN)
      .height(HIT_TARGET_MIN)
      .borderRadius(HIT_TARGET_MIN / 2)
      .backgroundColor(this.pal().surfaceAlt)
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      .margin({ bottom: SPACE_XS })
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('跟随主题'))
      .onClick(() => {
        this.onSetSetting(KEY_ACCENT, '');
      })
    }
    .width('100%')
    // ⚠️ 2026-10-13（目标③）：由 `Flex(wrap)` 改 **`Row` + `SpaceBetween`**。
    //    真机量测（`uitest dumpLayout`，密度 149px = 44vp）：色板可用宽 **350vp**；
    //    原实现每圆点 = 44 + 右 margin 8 = **52vp 步距** ⇒ 7 枚 = **364vp > 350vp** ⇒ 必然换行，
    //    第 7 枚（「跟随主题」）**独占第二行** = 视觉孤儿（截图可见）。
    //    ⛔ 不能靠缩小圆点修（44 = `HIT_TARGET_MIN` 是**真机命中的下限**，见 AGENTS.md）；
    //    ⇒ 去掉逐项右 margin、改由 `SpaceBetween` 分配：7 × 44 = **308vp ≤ 350vp** ⇒ **恒一行**，
    //    且首尾与上方标签对齐（"调色板一行到底" = Apple palette 行的口径）。
    .justifyContent(FlexAlign.SpaceBetween)
    .padding({ left: SPACE_SM, right: SPACE_SM })
  }

  /**
   * **自定义强调色**输入框（对齐 web `SettingsAppearance.tsx:166-195` 的 accent hex input）。
   *
   * 判据与渲染**同源**：合法性**只**由 `core/accent.ets:normalizeAccentOrNull` 判定
   * （⛔ 组件里不写第二份正则）；非法 ⇒ 显示错误且**不写**服务端（web 是 blur 回退，此处同义）。
   * 提交时机 = **回车** 或点「应用」—— ⛔ 不做逐字符提交（那会按字写服务端）。
   */
  @Builder
  AccentCustomInput() {
    Column({ space: SPACE_HAIR }) {
      // web `SettingsAppearance.tsx:164-168` 的 `settings.accentCustom`（同译法「自定义颜色」）
      Text(i18nT('自定义颜色'))
        .fontSize(fs('type.caption'))
        .fontWeight(fw('type.caption'))
        .fontColor(colorOf(this.pal(), 'textMuted'))
        .width('100%')
      Row({ space: SPACE_XS }) {
        TextInput({ text: this.hexDraft, placeholder: i18nT('#RRGGBB（如 #7C3AED）') })   // allow-color-literal: 占位文案里的**格式示例**，不是取色（唯一取色入口仍是 colorOf）
          .placeholderColor(colorOf(this.pal(), 'textMuted'))
          .fontColor(colorOf(this.pal(), 'textPrimary'))
          .backgroundColor(colorOf(this.pal(), 'surfaceAlt'))
          .border({
            width: STROKE_HAIRLINE,
            color: this.hexErr ? colorOf(this.pal(), 'dangerText') : hairlineOf(this.pal()),
          })
          .borderRadius(RADIUS_CHIP)
          .constraintSize({ minHeight: CONTROL_INPUT_H })
          .layoutWeight(1)
          .onChange((v: string) => {
            this.hexDraft = v;
            this.hexErr = false;
          })
          .onSubmit(() => {
            this.commitHex();
          })
        Text(i18nT('应用'))
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .fontColor(colorOf(this.pal(), 'onAccent'))
          .backgroundColor(colorOf(this.pal(), 'accent'))
          .borderRadius(RADIUS_CHIP)
          .padding({ left: SPACE_SM, right: SPACE_SM })
          .constraintSize({ minHeight: CONTROL_INPUT_H, minWidth: HIT_TARGET_MIN })
          .textAlign(TextAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.commitHex();
          })
      }
      .width('100%')

      if (this.hexErr) {
        Text(i18nT('颜色无效：支持 #RGB / #RRGGBB（可省略 #）'))
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(colorOf(this.pal(), 'dangerText'))
          .width('100%')
      }
    }
    .width('100%')
    .padding({ left: SPACE_SM, right: SPACE_SM, bottom: SPACE_XS })
  }

  /** 提交自定义 hex：合法 ⇒ 规范化后落 `KEY_ACCENT`；非法 ⇒ 只置错误位，**不写**。 */
  private commitHex(): void {
    const norm: string | null = normalizeAccentOrNull(this.hexDraft);
    if (norm === null) {
      this.hexErr = true;
      return;
    }
    this.hexErr = false;
    this.onSetSetting(KEY_ACCENT, norm);
  }
}
