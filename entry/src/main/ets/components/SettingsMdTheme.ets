/**
 * SettingsMdTheme —— Markdown 主题的**长枚举**选择器（23 项 ⇒ 列表 + 分组折叠 + 预览）。
 *
 * 为什么不是 chip 行（用户真机截图里"像垃圾"最直观的来源）：
 *   23 个 chip 平铺 ⇒ 一片糊、不可扫读。**单选项就该用列表**，且这一项在设置里是"长枚举"：
 *   ① 按 `MdThemeItem.mode` **分组**（深色 / 浅色）；
 *   ② **折叠**：默认只展开**当前主题所在**的那一组，另一组一行可点开；
 *   ③ 组内 = **单选列表行**（`SettingsRadioRow`：左主题名 / 右打勾）；
 *   ④ 列表上方 = **当前主题预览**（底 / 代码字 / 行内码底 三个真实色块，取 `codeTone(id)`）。
 *
 * 分层铁律：
 *   · 组件**只画**：候选来自 `core/mdtheme.ets`（`MD_THEMES` / `mdThemeMode` / `codeTone`），
 *     ⛔ 不在这里另列主题清单；选中值由 `@Prop value` 注入，改动一律回调出去。
 *   · 视觉只消费共享原子 + `core/design.ets` 令牌。
 *
 * ⚠️ **报备（缺数据）**：拍板要的第三个色块是「**注释色**」，但 `core/mdtheme.ets:CodeTone`
 *    只提供 `bg / fg / inlineBg`（web 每套 20+ 变量，原生端只挑 3 个）——「注释色」**表里没有**，
 *    ⛔ 不新造 ⇒ 预览用现有三值：**底 / 代码字 / 行内码底**。要注释色请先在 `core/mdtheme.ets` 补字段。
 */
import { Palette, paletteOf } from '../core/theme';
import { CodeTone, codeTone, MD_THEMES, MdThemeItem, mdThemeLabel, mdThemeMode } from '../core/mdtheme';
import {
  HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, RADIUS_CHIP, SPACE_HAIR, SPACE_SM, SPACE_XS,
  SPACE_XL, STROKE_HAIRLINE, hairlineOf,
} from '../core/design';
import { fs, fw, lh, SettingsRadioRow, tc } from './SettingsRows';

/** 两种明暗模式（与 `MdThemeItem.mode` 同值）。 */
export const MD_MODE_DARK: string = 'dark';
export const MD_MODE_LIGHT: string = 'light';
/** 预览色块边长（vp）。 */
const SWATCH: number = SPACE_XL;

/** 预览里的一个色块（标签 + 真实色值）。真 `@Component` + `@Prop` ⇒ 随选中主题更新。 */
@Component
export struct SettingsMdSwatch {
  @Prop label: string = '';
  @Prop color: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_HAIR }) {
      Stack()
        .width(SWATCH)
        .height(SWATCH)
        .backgroundColor(this.color)
        .borderRadius(RADIUS_CHIP)
        .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      Text(this.label)
        .fontSize(fs('type.micro'))
        .fontWeight(fw('type.micro'))
        .fontColor(tc(this.pal(), 'type.micro'))
    }
    .alignItems(HorizontalAlign.Center)
  }
}

/** 一个可折叠的主题分组（组头 + 展开时的单选行）。 */
@Component
export struct SettingsMdThemeGroup {
  @Prop mode: string = MD_MODE_DARK;
  @Prop label: string = '';
  @Prop ids: string[] = [];
  @Prop selected: string = '';
  @Prop expanded: boolean = false;
  @Prop theme: string = 'dark';
  /** 点组头（展开/收起由父级决定"同时只开一组"）。 */
  onToggle: () => void = () => {
  };
  onPick: (id: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: 0 }) {
      Row({ space: SPACE_XS }) {
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(fs('type.caption'))
          .fontColor([this.pal().textSecondary])
          .rotate({ angle: this.expanded ? 90 : 0 })
        Text(this.label)
          .fontSize(fs('type.caption'))
          .fontWeight(fw('type.caption'))
          .lineHeight(lh('type.caption'))
          .fontColor(tc(this.pal(), 'type.caption'))
        Text(`${this.ids.length}`)
          .fontSize(fs('type.micro'))
          .fontWeight(fw('type.micro'))
          .fontColor(this.pal().textMuted)
          .padding({ left: SPACE_XS, right: SPACE_XS, top: SPACE_HAIR, bottom: SPACE_HAIR })
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(RADIUS_CHIP)
        Blank()
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .constraintSize({ minHeight: HIT_TARGET_MIN })
      .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
      .stateStyles({ pressed: { .opacity(0.6) }, normal: { .opacity(1) } })
      .onClick(() => {
        this.onToggle();
      })

      Divider()
        .strokeWidth(STROKE_HAIRLINE)
        .color(hairlineOf(this.pal()))
        .width('100%')

      if (this.expanded) {
        ForEach(this.ids, (id: string) => {
          SettingsRadioRow({
            label: mdThemeLabel(id),
            isSelected: id === this.selected,
            theme: this.theme,
            onSelect: () => {
              this.onPick(id);
            },
          })
        }, (id: string) => `md-${id}`)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * Markdown 主题选择器：预览 + 两个可折叠分组（深色 / 浅色）。
 *
 * `openMode` 为空 ⇒ 跟随**当前主题所在的组**（"默认只展开当前主题那一组"）；
 * 用户点过组头后即固定为所点的那组（"另一组一行可点开"）。
 */
@Component
export struct SettingsMdThemePicker {
  /** 当前应用色板（取色用）。 */
  @Prop theme: string = 'dark';
  /** 行的标题 / 说明（文案由调用方注入，与其它设置行同款）。 */
  @Prop label: string = '';
  @Prop description: string = '';
  /** 当前选中的 md 主题 id。 */
  @Prop value: string = '';
  onSelect: (id: string) => void = () => {
  };

  @State private openMode: string = '';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private tone(): CodeTone {
    return codeTone(this.value);
  }

  private effectiveOpenMode(): string {
    return this.openMode.length > 0 ? this.openMode : mdThemeMode(this.value);
  }

  private idsOf(mode: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < MD_THEMES.length; i++) {
      const t: MdThemeItem = MD_THEMES[i];
      if (t.mode === mode) {
        out.push(t.id);
      }
    }
    return out;
  }

  build() {
    Column({ space: SPACE_SM }) {
      if (this.label.length > 0) {
        Text(this.label)
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .width('100%')
      }
      if (this.description.length > 0) {
        Text(this.description)
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(tc(this.pal(), 'type.callout'))
          .width('100%')
      }
      this.Preview()

      SettingsMdThemeGroup({
        mode: MD_MODE_DARK,
        label: '深色主题',
        ids: this.idsOf(MD_MODE_DARK),
        selected: this.value,
        expanded: this.effectiveOpenMode() === MD_MODE_DARK,
        theme: this.theme,
        onToggle: () => {
          this.openMode = MD_MODE_DARK;
        },
        onPick: (id: string) => {
          this.onSelect(id);
        },
      })

      SettingsMdThemeGroup({
        mode: MD_MODE_LIGHT,
        label: '浅色主题',
        ids: this.idsOf(MD_MODE_LIGHT),
        selected: this.value,
        expanded: this.effectiveOpenMode() === MD_MODE_LIGHT,
        theme: this.theme,
        onToggle: () => {
          this.openMode = MD_MODE_LIGHT;
        },
        onPick: (id: string) => {
          this.onSelect(id);
        },
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 当前主题的一行预览（无参 `@Builder` ⇒ 读 `this`，随选中值重建）。 */
  @Builder
  Preview() {
    Column({ space: SPACE_HAIR }) {
      Text(mdThemeLabel(this.value))
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(tc(this.pal(), 'type.subhead'))
        .width('100%')
      Row({ space: SPACE_SM }) {
        SettingsMdSwatch({ label: '底', color: this.tone().bg, theme: this.theme })
        SettingsMdSwatch({ label: '代码字', color: this.tone().fg, theme: this.theme })
        SettingsMdSwatch({ label: '行内码底', color: this.tone().inlineBg, theme: this.theme })
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}
