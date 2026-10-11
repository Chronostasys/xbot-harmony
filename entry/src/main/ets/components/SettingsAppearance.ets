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
 *   2. 主题（5 套）                 → 「外观」组（`KEY_APP_THEME`）
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
import { Palette, paletteOf, ALL_THEMES, themeLabel } from '../core/theme';
import {
  KEY_ACCENT, KEY_APP_THEME, KEY_CODE_WRAP, KEY_FONT_SCALE, KEY_LOCALE, KEY_MD_THEME, KEY_ORB,
  KEY_REASONING_DEFAULT, KEY_SEND_KEY, fontScaleFrom, fontScaleLabel, fontScalePresets,
  normalizeSendKey, orbEnabled, parseBool, sendKeyLabel, settingLabel, settingOf,
  SEND_KEY_ENTER, SEND_KEY_MOD_ENTER,
} from '../core/settings';
import { ACCENT_PRESETS, accentLabel, contrastForeground, normalizeAccent } from '../core/accent';
import { MD_THEMES, mdThemeLabel, normalizeMdTheme } from '../core/mdtheme';
import { localeLabel, normalizeLocale } from '../core/i18n';
import {
  HIT_TARGET_MIN, SPACE_XS, SPACE_SM, STROKE_HAIRLINE, hairlineOf,
} from '../core/design';
import {
  SettingsActionRow, SettingsChipRow, SettingsGroupHeader, SettingsToolRow, SettingsValueRow,
} from './SettingsRows';

/** 承载方式（`KEY_SURFACE`）的两个取值（与页面 `setSurface` 同源）。 */
const SURFACE_NATIVE: string = 'native';
const SURFACE_WEB: string = 'web';

@Component
export struct SettingsAppearance {
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
  /** 切换主题（页面：置 `themeName` + 落盘 + `syncSystemTheme`）。 */
  onSetTheme: (t: string) => void = () => {
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
  private themeLabels(): string[] {
    const out: string[] = [];
    for (let i = 0; i < ALL_THEMES.length; i++) {
      out.push(themeLabel(ALL_THEMES[i]));
    }
    return out;
  }
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
  private mdOptions(): string[] {
    const out: string[] = [];
    for (let i = 0; i < MD_THEMES.length; i++) {
      out.push(MD_THEMES[i].id);
    }
    return out;
  }
  private mdLabels(): string[] {
    const ids: string[] = this.mdOptions();
    const out: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      out.push(mdThemeLabel(ids[i]));
    }
    return out;
  }

  build() {
    Column({ space: 0 }) {
      // ═══ 外观 ═══════════════════════════════════════════════════════════════
      SettingsGroupHeader({ title: '外观', theme: this.theme })

      SettingsChipRow({
        label: settingLabel(KEY_APP_THEME),
        description: '应用主题（含原生独享的「极简白」）。',
        value: this.theme,
        options: ALL_THEMES,
        labels: this.themeLabels(),
        theme: this.theme,
        onSelect: (v: string) => {
          this.onSetTheme(v);
        },
      })

      // 强调色：预设色板 + 「跟随主题」；颜色圆点不是文本 chip ⇒ 单列一段（无对应原子）
      SettingsValueRow({
        label: settingLabel(KEY_ACCENT),
        description: '只覆盖强调色家族，亮度阶梯不变。',
        value: this.accentHex().length > 0 ? accentLabel(this.accentHex()) : '跟随主题',
        theme: this.theme,
      })
      this.AccentSwatches()

      SettingsChipRow({
        label: settingLabel(KEY_MD_THEME),
        description: '仅作用于 Markdown 代码高亮；与 Web 端共用同一组 id。',
        value: this.mdThemeId(),
        options: this.mdOptions(),
        labels: this.mdLabels(),
        theme: this.theme,
        onSelect: (v: string) => {
          this.onSetSetting(KEY_MD_THEME, v);
        },
      })

      SettingsValueRow({
        label: settingLabel(KEY_LOCALE),
        description: '界面文案语言（当前随 Web 端设置；原生端暂只读展示）。',
        value: localeLabel(this.localeId()),
        theme: this.theme,
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

      SettingsChipRow({
        label: '聊天界面',
        description: '原生渲染，或内嵌完整 Web UI（插件 / GenUI / 终端）。',
        value: this.surfaceWeb ? SURFACE_WEB : SURFACE_NATIVE,
        options: [SURFACE_NATIVE, SURFACE_WEB],
        labels: ['原生', '内嵌网页'],
        theme: this.theme,
        onSelect: (v: string) => {
          this.onSetSurface(v === SURFACE_WEB);
        },
      })

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
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /**
   * 强调色色板（预设 + 「跟随主题」）。
   *
   * ⚠️ 颜色圆点不是文本 chip，`SettingsChipRow` 覆盖不了 ⇒ 这是**唯一**一段无对应原子的控件；
   *    其尺寸/命中区仍取令牌（`HIT_TARGET_MIN` 圆点、`STROKE_HAIRLINE` 描边、`hairlineOf`）。
   */
  @Builder
  AccentSwatches() {
    Row({ space: SPACE_XS }) {
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
      .onClick(() => {
        this.onSetSetting(KEY_ACCENT, '');
      })
    }
    .width('100%')
    .padding({ left: SPACE_SM, right: SPACE_SM, bottom: SPACE_XS })
  }
}
