/**
 * SettingsRows —— 设置面**共用的行/卡原子组件**（全部 `Settings*` 面板同一套视觉与交互）。
 *
 * 为什么单独成文件：
 *  1. **一致性优先**：所有面板的"标题+说明+控件"行必须长得完全一样；集中一处 ⇒ 改一次全生效。
 *  2. **消孤儿**：`components/*.ets` 里**没有任何其它文件引用**的 `export struct` 不会被编进
 *     ArkTS 依赖图（⇒ 它的 ArkTS 错误**编译期不报**，见 `docs/ARKTS-GOTCHAS.md` 批次13 /
 *     `tools/lint/orphan-components.sh`）。这些原子组件由各面板**跨文件真实实例化**，
 *     因此进入依赖图、被真编译覆盖。
 *
 * ── 视觉重排（2026-10-11，`docs/REDESIGN.md` §7.6 设置行规范）─────────────────
 *   旧实现把行内距/字号写死为 `SP_2`/`FS_BODY`/`FS_CAPTION` 等**原始刻度**；本版改为消费
 *   `core/design.ets` 的**语义令牌**：
 *     · 行内距 = `INSET_ROW_X/Y`（12/8）；卡片内距 = `INSET_CARD_X/Y`（12/12）；
 *     · 行高/命中区 ≥ `HIT_TARGET_MIN`（44，Apple HIG）；
 *     · 字号/字重/行高/字距/文字色**整套**取 `type.*` 角色（`type.subhead` 标题、
 *       `type.callout` 说明、`type.caption` 分组头、`type.micro` 徽标）——不再各写 13/12/10；
 *     · 卡片边界 = **结构性发丝** `hairlineOf(p)`（⛔ 不是装饰性 `pal().border`）；
 *     · 卡片面 = `surfaceFillOf(p,'surface.card')`；圆角 = `RADIUS_CARD`/`RADIUS_PILL`/`RADIUS_CHIP`。
 *   ⚠️ 仍未 token 化的量已在文件内**显式报备**（见 `INPUT_W` 注释与交付清单）。
 *
 * ⛔ 都是真 `@Component` + `@Prop`，**不用带参全局 `@Builder`**（参数是调用时刻的快照
 *    ⇒ 子树不随数据重建）。
 * ⛔ `@Prop` **不能叫 `enabled`**（ArkUI `CustomComponent` 基类成员，会判 10505001）⇒ 统一 `isOn`。
 */
import { Palette, paletteOf } from '../core/theme';
import { SP_1 } from '../core/tokens';
import { animBase } from './anim';
import {
  PRESS_OPACITY, INSET_CARD_X, INSET_CARD_Y, INSET_CHIP_X, INSET_CHIP_Y, INSET_ROW_X, INSET_ROW_Y,
  RADIUS_CARD, RADIUS_CHIP, RADIUS_PILL, STROKE_HAIRLINE, HIT_TARGET_MIN, SURFACE_COMPOSER,
  SPACE_HAIR, SPACE_XS, SPACE_SM, SPACE_MD, SPACE_XL,
  typeOf, colorOf, hairlineOf, surfaceFillOf, structuralRuleOf, } from '../core/design';
import { displayApiKey, providerLine, stripScheme } from '../core/rpc';
import { t as i18nT } from '../core/i18n';

// ── 排版令牌 → ArkUI 属性（**唯一映射**；组件只读角色名，不写数值）──────────────
// `core/design.ets` 只存数字（400/500/600），字重→`FontWeight` 的映射是 **UI 层职责**（本处）。
/** 角色字号（fp）。 */
export function fs(name: string): number {
  return typeOf(name).size;
}
/** 角色行高（vp，= 字号 × 倍数）。 */
export function lh(name: string): number {
  const t = typeOf(name);
  return t.size * t.lineHeight;
}
/**
 * 角色字重 → 可直接喂 `.fontWeight()` 的值。
 *
 * ⚠️ 本 SDK（API 21）的 `FontWeight` 枚举**只有** Lighter/Normal/Regular/Medium/Bold/Bolder
 *   —— **没有 SemiBold**（设计令牌的 600 档）。故这里**原样传数字**（ArkUI `fontWeight`
 *   接受 `number`，100–900 语义与 HIG 一致），而不是硬映射成 `Bold`(700) 抬重。
 *   （已核：`FontWeight.SemiBold` 在 `CompileArkTS` 被判 `10505001`。）
 */
export function fw(name: string): number {
  return typeOf(name).weight;
}
/** 角色语义文字色（经 `colorOf` 解析 `Palette` 角色名 —— `colorRole` 恒为 `textPrimary`/`textSecondary`，均在 `colorOf` 白名单内）。 */
export function tc(p: Palette, name: string): string {
  return colorOf(p, typeOf(name).colorRole);
}
/** 角色字距（vp）。 */
export function tk(name: string): number {
  return typeOf(name).tracking;
}

/** 数字输入框宽度（vp）——给足 5 位数（8192 / 4194304 的 MB 形态）不挤。
 *  ⚠️ **报备**：`core/design.ets` 尚无 `control.input.width.num`；待 design-lead 增后迁移。 */
const INPUT_W: number = 96;

/**
 * 一行「标题 + 说明 + 开关」。
 * 内置工具行 / MCP 组成员行 / MCP 组头（`emphasized`）/ 智能体开关 都用它 —— 同一套视觉。
 */
@Component
export struct SettingsToolRow {
  @Prop label: string = '';
  @Prop description: string = '';
  /** ⛔ 不能叫 `enabled` —— ArkUI `CustomComponent` 的基类成员（`.enabled()` 修饰符），
   *  同名会被判 10505001（与已知的 `size` 同类坑，见 `docs/ARKTS-GOTCHAS.md` 批次13）。 */
  @Prop isOn: boolean = false;
  @Prop indented: boolean = false;
  @Prop busy: boolean = false;
  /** 标签用等宽字（工具名 / server 名是标识符；开关类文案用正文体）。 */
  @Prop mono: boolean = true;
  @Prop theme: string = 'dark';
  /** 用户切换开关（乐观更新由面板负责）。 */
  onToggle: (names: string[], next: boolean) => void = () => {
  };
  /** 该行开关作用的键集合（单行 = 自身；组头 = 全组）。 */
  names: string[] = [];

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Toggle({ type: ToggleType.Switch, isOn: this.isOn })
        .enabled(!this.busy)
        .opacity(this.busy ? 0.5 : 1)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: SPACE_HAIR }) {
        Text(i18nT(this.label))
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .letterSpacing(tk('type.subhead'))
          .fontFamily(this.mono ? 'monospace' : '')
          .fontColor(tc(this.pal(), 'type.subhead'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.description.length > 0) {
          Text(i18nT(this.description))
            .fontSize(fs('type.callout'))
            .fontWeight(fw('type.callout'))
            .lineHeight(lh('type.callout'))
            .letterSpacing(tk('type.callout'))
            .fontColor(tc(this.pal(), 'type.callout'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({
      left: this.indented ? SPACE_XL : 0,
      right: INSET_ROW_X,
      top: INSET_ROW_Y,
      bottom: INSET_ROW_Y,
    })
  }
}

/** 一个 MCP server 的组头（总开关 = 批量启停该组全部工具）。 */
@Component
export struct SettingsMcpHead {
  @Prop server: string = '';
  @Prop count: number = 0;
  @Prop allEnabled: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onToggle: (names: string[], next: boolean) => void = () => {
  };
  names: string[] = [];

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Toggle({ type: ToggleType.Switch, isOn: this.allEnabled })
        .enabled(!this.busy)
        .opacity(this.busy ? 0.5 : 1)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: SPACE_HAIR }) {
        Text(this.server)
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontFamily('monospace')
          .fontColor(tc(this.pal(), 'type.subhead'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(`${this.count} 个工具`)
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .alignItems(VerticalAlign.Center)
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
  }
}

/** 一行「标题 + 说明 + 数字输入 + 单位」。 */
@Component
export struct SettingsNumberRow {
  @Prop label: string = '';
  @Prop description: string = '';
  /** 当前输入值（空串 = 未填，界面显示 placeholder）。 */
  @Prop value: string = '';
  @Prop placeholder: string = '';
  @Prop suffix: string = '';
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  /** 输入变化（受控：由面板持有值）。 */
  onInput: (v: string) => void = (v: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Column({ space: SPACE_HAIR }) {
        Text(i18nT(this.label))
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.description.length > 0) {
          Text(i18nT(this.description))
            .fontSize(fs('type.callout'))
            .fontWeight(fw('type.callout'))
            .lineHeight(lh('type.callout'))
            .fontColor(tc(this.pal(), 'type.callout'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Row({ space: SP_1 }) {
        TextInput({ text: this.value, placeholder: this.placeholder })
          .type(InputType.Number)
          .enabled(!this.busy)
          .width(INPUT_W)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(fs('type.body'))
          .fontColor(this.pal().textPrimary)
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(surfaceFillOf(this.pal(), SURFACE_COMPOSER))
          .borderRadius(RADIUS_PILL)
          .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .onChange((v: string) => {
            this.onInput(v);
          })
        if (this.suffix.length > 0) {
          Text(this.suffix)
            .fontSize(fs('type.subhead'))
            .fontColor(tc(this.pal(), 'type.caption'))
            // H1（contrast-ux）：`Row` 内的**可变长值**（后缀/单位/状态值）必须有宽度上限
            // ⇒ `constraintSize` 上限 + 截断。
            // ⛔ **绝不可**给这里加 `layoutWeight(1)`：它会让**内层 `Row`** 吃掉整行剩余宽度，
            //    并把**同为 `layoutWeight(1)` 的标签列压到 ~41px**。2026-10-13 真机 `dumpLayout`
            //    铁证（智能体面板 `最长边上限`/`单图大小上限` 两行）：标签与描述的 Text 节点
            //    **整段从布局树消失** ⇒ 两个数字行**完全没有标签**，用户看不懂 `1024`/`1` 是什么；
            //    同时单位被推到行尾、离输入框 560px（观感也断）。
            //    本行注释第一版写的正是「不加 `layoutWeight`，靠 `maxWidth`」，代码却写了
            //    `layoutWeight` ⇒ 又一次"注释与实现相反"。
            .constraintSize({ maxWidth: INPUT_W })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

/**
 * 一行「标题 + 说明 + 枚举片」。
 *
 * 刻意**不用 ArkUI `Select`**：`Select(options: SelectOption[])` 需要构造 `SelectOption` 对象字面量，
 * 在 ArkTS 严格模式下是已知的类型雷区；两个选项用可点片更稳，且与"设为默认"按钮同一视觉语言。
 */
@Component
export struct SettingsChipRow {
  @Prop label: string = '';
  @Prop description: string = '';
  /** 当前选中值。 */
  @Prop value: string = '';
  /** 候选值（与 `labels` 一一对应）。 */
  @Prop options: string[] = [];
  /** 候选显示文案（与 `options` 一一对应）。 */
  @Prop labels: string[] = [];
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onSelect: (v: string) => void = (v: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private labelOf(v: string): string {
    for (let i = 0; i < this.options.length; i++) {
      if (this.options[i] === v) {
        return i < this.labels.length ? this.labels[i] : v;
      }
    }
    return v;
  }

  private chips(): string[] {
    return this.options;
  }

  build() {
    Column({ space: SPACE_HAIR }) {
      Text(i18nT(this.label))
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(tc(this.pal(), 'type.subhead'))
        .width('100%')
      if (this.description.length > 0) {
        Text(i18nT(this.description))
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(tc(this.pal(), 'type.callout'))
          .width('100%')
      }
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.chips(), (opt: string) => {
          Text(this.labelOf(opt))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            // ⚡ 2026-10-20 丝滑动画：选中态文字/背景/边框颜色缓动
            .animation(animBase())
            .fontColor(opt === this.value ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
            .backgroundColor(opt === this.value ? this.pal().accent : this.pal().surfaceAlt)
            .borderRadius(RADIUS_PILL)
            .border({ width: STROKE_HAIRLINE, color: opt === this.value ? this.pal().accent : hairlineOf(this.pal()) })
            .margin({ right: SPACE_XS, bottom: SPACE_XS })
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .opacity(this.busy ? 0.5 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              if (!this.busy) {
                this.onSelect(opt);
              }
            })
        }, (opt: string) => `chip|${opt}`)
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

/** 一行「标题 + 说明 + 单行输入（可选密码遮显）」。 */
@Component
export struct SettingsTextFieldRow {
  @Prop label: string = '';
  @Prop description: string = '';
  @Prop value: string = '';
  @Prop placeholder: string = '';
  /** true ⇒ 密码遮显（`InputType.Password`）。 */
  @Prop password: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onInput: (v: string) => void = (v: string) => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_HAIR }) {
      Text(i18nT(this.label))
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(tc(this.pal(), 'type.subhead'))
        .width('100%')
      if (this.description.length > 0) {
        Text(i18nT(this.description))
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(tc(this.pal(), 'type.callout'))
          .width('100%')
      }
      TextInput({ text: this.value, placeholder: this.placeholder })
        .type(this.password ? InputType.Password : InputType.Normal)
        .enabled(!this.busy)
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .fontSize(fs('type.body'))
        .fontColor(this.pal().textPrimary)
        .placeholderColor(this.pal().textMuted)
        .backgroundColor(surfaceFillOf(this.pal(), 'surface.input'))
        .borderRadius(RADIUS_PILL)
        .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
        .padding({ left: SPACE_XS, right: SPACE_XS })
        .onChange((v: string) => {
          this.onInput(v);
        })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

/** 一张订阅卡（名称 / 提供方 / base_url / 默认徽标 / 启用开关 / 掩码密钥 / 设默认）。 */
@Component
export struct SettingsSubCard {
  @Prop subId: string = '';
  @Prop name: string = '';
  @Prop provider: string = '';
  @Prop baseUrl: string = '';
  @Prop model: string = '';
  @Prop apiKey: string = '';
  /** ⛔ 不能叫 `enabled`（ArkUI `CustomComponent` 基类成员，10505001）——同 `SettingsToolRow.isOn`。 */
  @Prop isOn: boolean = false;
  @Prop isDefault: boolean = false;
  @Prop modelCount: number = 0;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onToggle: (subId: string, next: boolean) => void = () => {
  };
  onSetDefault: (subId: string) => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_XS }) {
      // 第一行：名称 + 默认徽标 + 启用开关
      Row({ space: SPACE_XS }) {
        Column({ space: SPACE_HAIR }) {
          Row({ space: SPACE_XS }) {
            Text(this.name.length > 0 ? this.name : this.subId)
              .fontSize(fs('type.subhead'))
              .fontWeight(fw('type.subhead'))
              .lineHeight(lh('type.subhead'))
              .fontColor(tc(this.pal(), 'type.subhead'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.isDefault) {
              Text(i18nT('默认'))
                .fontSize(fs('type.micro'))
                .fontWeight(fw('type.micro'))
                .fontColor(this.pal().accentText)
                .padding({ left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
                .backgroundColor(this.pal().accentDeep)
                .borderRadius(RADIUS_CHIP)
            }
          }
          Text(`${providerLine(this.provider, '')} · ${stripScheme(this.baseUrl)}`)
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontColor(tc(this.pal(), 'type.caption'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Toggle({ type: ToggleType.Switch, isOn: this.isOn })
          .enabled(!this.busy)
          .opacity(this.busy ? 0.5 : 1)
          .onChange((isOn: boolean) => {
            this.onToggle(this.subId, isOn);
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      // 第二行：模型 + 模型数
      Row({ space: SPACE_XS }) {
        Text(this.model.length > 0 ? this.model : '未指定默认模型')
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(this.pal().textSecondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(`${this.modelCount} 个模型`)
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.caption'))
      }
      .width('100%')

      // 第三行：掩码密钥（只读）+ 设默认
      Row({ space: SPACE_XS }) {
        Column({ space: SPACE_HAIR }) {
          Text(i18nT('API Key（服务端掩码，只读）'))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontColor(tc(this.pal(), 'type.caption'))
            .width('100%')
          Text(displayApiKey(this.apiKey))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .lineHeight(lh('type.subhead'))
            .fontFamily('monospace')
            .fontColor(this.pal().textSecondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (!this.isDefault) {
          Text(i18nT('设为默认'))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .fontColor(this.pal().accentSoft)
            .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
            .borderRadius(RADIUS_PILL)
            .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .opacity(this.busy ? 0.5 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              if (!this.busy) {
                this.onSetDefault(this.subId);
              }
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: INSET_CARD_X, right: INSET_CARD_X, top: INSET_CARD_Y, bottom: INSET_CARD_Y })
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))
    .borderRadius(RADIUS_CARD)
    // **面→面**轮廓走 `structuralRuleOf`（浅色 = 更强轮廓，深色 = `border` 逐字节）；
    // 面**内**行分隔/控件边仍走 `hairlineOf`（⛔ 不混用，见 `docs/DESIGN-SYSTEM.md §13.5`）。
    .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
  }
}

/** 面板顶部「标题 + 副标题」——所有面板统一用它，保证版式一致。 */
@Component
export struct SettingsPanelHeader {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_HAIR }) {
      Text(i18nT(this.title))
        .fontSize(fs('type.headline'))
        .fontWeight(fw('type.headline'))
        .lineHeight(lh('type.headline'))
        .letterSpacing(tk('type.headline'))
        .fontColor(tc(this.pal(), 'type.headline'))
        .width('100%')
      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .fontSize(fs('type.callout'))
          .fontWeight(fw('type.callout'))
          .lineHeight(lh('type.callout'))
          .fontColor(tc(this.pal(), 'type.callout'))
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * 分区标题 —— **层级 + 结构性发丝**（`docs/REDESIGN.md` §7.6：分组头 `type.caption`，
 * 分组**靠发丝**而不是描边立边界）。
 *
 * ⛔ 这里用的是**结构性**发丝（`hairlineOf`），不是装饰性 `pal().border`。
 */
@Component
export struct SettingsGroupHeader {
  @Prop title: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_XS }) {
      Text(i18nT(this.title))
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .letterSpacing(tk('type.subhead'))
        .fontColor(tc(this.pal(), 'type.caption'))
        .width('100%')
      Divider()
        .strokeWidth(STROKE_HAIRLINE)
        .color(hairlineOf(this.pal()))
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    // ⚠️ 2026-10-13（目标③「对标苹果」·真机逐像素量测）：**组标题与内容必须同轴**。
    //    实测（1320×2848 装机帧）：组标题左缘 **69px**（= 容器内缩 `SPACE_LG`20vp），
    //    而它下面的**行内容**左缘 **110px**（= 20 + `INSET_ROW_X`12）⇒ 同一段里标题/发丝
    //    与内容**差 12vp**，眼睛读成"标题浮在左边"。
    //    web 权威 `components/settings/SettingsSection.tsx:30-37`：标题与 children **同在一个
    //    `px-4` 的卡里**（不是各缩各的）⇒ 本仓按同一口径把标题与发丝一起移到**内容轴**。
    //    ⛔ 行内缩不动（`INSET_ROW_X` 是全仓 8+ 处的既有口径：`SettingsRows` 各行 / `PluginHost` 各行）。
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_MD, bottom: SPACE_XS })
  }
}

/**
 * 一行「标题 + **只读值**」（例：语言 / 当前强调色名）—— 无控件的展示行。
 * 与 `SettingsToolRow` 同一套内距/字阶/命中区，只是右槽是文字而非控件。
 */
@Component
export struct SettingsValueRow {
  @Prop label: string = '';
  @Prop value: string = '';
  @Prop description: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Column({ space: SPACE_HAIR }) {
        Text(i18nT(this.label))
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .width('100%')
        if (this.description.length > 0) {
          Text(i18nT(this.description))
            .fontSize(fs('type.callout'))
            .fontColor(tc(this.pal(), 'type.callout'))
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(this.value)
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(this.pal().textMuted)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

/** 一行「标题 + 可点动作」（例：重新读取设置）。命中区 ≥44。 */
@Component
export struct SettingsActionRow {
  @Prop label: string = '';
  @Prop action: string = '';
  @Prop description: string = '';
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onAction: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Column({ space: SPACE_HAIR }) {
        Text(i18nT(this.label))
          .fontSize(fs('type.subhead'))
          .fontWeight(fw('type.subhead'))
          .lineHeight(lh('type.subhead'))
          .fontColor(tc(this.pal(), 'type.subhead'))
          .width('100%')
        if (this.description.length > 0) {
          Text(i18nT(this.description))
            .fontSize(fs('type.callout'))
            .fontColor(tc(this.pal(), 'type.callout'))
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text(this.action)
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .fontColor(this.pal().accentSoft)
        .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
        // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先只靠 padding 撑高（≈32）⇒ 低于阈值。
        //    本行**已**声明 `constraintSize({ minHeight: HIT_TARGET_MIN })`（见 build 末尾）⇒ 抬到 44 不改变行高。
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .borderRadius(RADIUS_PILL)
        .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
        .opacity(this.busy ? 0.5 : 1)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          if (!this.busy) {
            this.onAction();
          }
        })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
  }
}

/**
 * **设置面统一按钮**（用户 2026-10-17：「按钮全他妈丑的要死」）。
 *
 * ⛔ 为什么必须有：此前各面板**手搓** `Text(label)` + padding + `surfaceAlt` + border +
 *   `stateStyles`，仅 `SettingsLlm` 就有 **16 处**复制粘贴 ⇒ 高度/圆角/字阶/按压态各不相同、
 *   改一次要改 16 处（还漏）。统一到本组件后：**一种语义 = 一种视觉**。
 *
 * 语义（`kind`）：
 *   · `primary`  —— 主操作（新增/保存/登录态）：`accent` 底 + `onAccent` 字，无描边；
 *   · `secondary`—— 常规操作（刷新/导入/导出/编辑/管理）：`surfaceAlt` 底 + 发丝描边 + 主文字色；
 *   · `ghost`    —— 弱操作（取消/收起）：透明底 + 次文字色，无描边；
 *   · `danger`   —— 破坏性（删除）：常规态 `dangerText` 字，`armed` 态反色实底（确认删除）。
 *
 * 尺寸纪律：命中区恒 ≥ `HIT_TARGET_MIN`(44, Apple HIG)；圆角 `RADIUS_PILL`（与 chip/行内动作同族）；
 * 内距 `INSET_CHIP_X/Y`；字阶 `type.caption`；按压 `PRESS_OPACITY`（统一过渡 `animBase`）。
 */
@Component
export struct SettingsButton {
  @Prop label: string = '';
  /** `primary` | `secondary` | `ghost` | `danger` */
  @Prop kind: string = 'secondary';
  /** 忙碌（禁用点击 + 降透明度）；`label` 由调用方决定是否替换成「…」。 */
  @Prop busy: boolean = false;
  /** 仅 `danger` 用：已"上膛"（再次点击即执行）。 */
  @Prop armed: boolean = false;
  @Prop theme: string = 'dark';
  onTap: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private isPrimary(): boolean {
    return this.kind === 'primary';
  }

  private isGhost(): boolean {
    return this.kind === 'ghost';
  }

  private isDanger(): boolean {
    return this.kind === 'danger';
  }

  private bg(): ResourceColor {
    if (this.isPrimary()) {
      return this.pal().accent;
    }
    if (this.isDanger() && this.armed) {
      return this.pal().statusError;
    }
    if (this.isGhost()) {
      return this.pal().transparent;
    }
    return this.pal().surfaceAlt;
  }

  private fg(): ResourceColor {
    if (this.isPrimary() || (this.isDanger() && this.armed)) {
      return this.pal().onAccent;
    }
    if (this.isDanger()) {
      return this.pal().dangerText;
    }
    if (this.isGhost()) {
      return this.pal().textMuted;
    }
    return this.pal().textPrimary;
  }

  build() {
    Text(i18nT(this.label))
      .fontSize(fs('type.subhead'))
      .fontWeight(this.isPrimary() ? fw('type.subhead') : fw('type.subhead'))
      .fontColor(this.fg())
      .textAlign(TextAlign.Center)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .padding({ left: INSET_CHIP_X, right: INSET_CHIP_X, top: INSET_CHIP_Y, bottom: INSET_CHIP_Y })
      .constraintSize({ minHeight: HIT_TARGET_MIN })
      .backgroundColor(this.bg())
      .borderRadius(RADIUS_PILL)
      .border(this.isGhost() || this.isPrimary()
        ? { width: 0, color: this.pal().transparent }
        : { width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      // ⚡ 语义切换（danger 上膛/忙碌）走统一过渡，避免"啪一下"跳色
      .animation(animBase())
      .opacity(this.busy ? 0.5 : 1)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .onClick(() => {
        if (!this.busy) {
          this.onTap();
        }
      })
  }
}

/**
 * 一行「单选列表项」（左标签 + 选中打勾）—— 用于**长枚举**的单选（如 Markdown 主题）。
 *
 * 为什么不复用 `SettingsChipRow`：chip 只适合 2–5 个选项；23 项平铺成 chip 是一片糊。
 * 单选项就该是**列表行**（可扫读、可扩展、可预览）。内距/字阶/命中区与 `SettingsToolRow` 同款。
 */
@Component
export struct SettingsRadioRow {
  @Prop label: string = '';
  /** ⛔ 不叫 `selected`（避免与 ArkUI 基类成员潜在同名，同 `isOn` 之于 `enabled`）。 */
  @Prop isSelected: boolean = false;
  @Prop theme: string = 'dark';
  onSelect: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SPACE_SM }) {
      Text(i18nT(this.label))
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(tc(this.pal(), 'type.subhead'))
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.isSelected) {
        SymbolGlyph($r('sys.symbol.checkmark'))
          .fontSize(fs('type.subhead'))
          .fontColor([this.pal().accent])
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onSelect();
    })
  }
}

/**
 * 面板内错误条（统一一行红字）。
 *
 * `docs/REDESIGN.md` §5 / §10 有意分歧 ②：失败态 = **一行小字 + 语义色，无填充、无边框、无发光**
 * ⇒ 旧实现的红底卡（`backgroundColor(surfaceAlt)` + 圆角）**删除**。
 */
@Component
export struct SettingsErrorBar {
  @Prop message: string = '';
  @Prop theme: string = 'dark';
  /** 是否给「重试」入口（**由页面经 SettingsPanel 注入的真回调**驱动，⛔ 不是状态位）。 */
  @Prop canRetry: boolean = false;
  /** 点「重试」时调用（重发**该分区自己的**请求；⛔ 空实现 = 假重试）。 */
  onRetry: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SPACE_HAIR }) {
      Text(this.message)
        .fontSize(fs('type.subhead'))
        .fontWeight(fw('type.subhead'))
        .lineHeight(lh('type.subhead'))
        .fontColor(this.pal().dangerText)
        .width('100%')
      // 重试入口（2026-10-11）：三态模板照 `PluginsSheet.ets:155-170`。
      // ⛔ `canRetry` 为真才渲染；⛔ 只渲染不接线 = 假重试 ⇒ 判据 `settings_error_retry.test.ts`
      //    另断"目标分区必须把 onRetry 透传进来"（回调由页面经 SettingsPanel 注入）。
      if (this.canRetry) {
        Row() {
          Text(i18nT('重试'))
            .fontSize(fs('type.subhead'))
            .fontWeight(fw('type.subhead'))
            .fontColor(colorOf(this.pal(), 'accentSoft'))
        }
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        // press 反馈走统一口径（同 `PluginsSheet.ets:114` / 本文件 `:334` 的既有写法）
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onRetry();
        })
      }
    }
    .width('100%')
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .alignItems(HorizontalAlign.Start)
  }
}
