/**
 * SettingsRows —— 设置面**共用的行/卡原子组件**（工具 / 模型 / 智能体 三个面板同一套视觉与交互）。
 *
 * 为什么单独成文件：
 *  1. **一致性优先**：三个面板的"标题+说明+控件"行必须长得完全一样；集中一处 ⇒ 改一次全生效。
 *  2. **消孤儿**：`components/*.ets` 里**没有任何其它文件引用**的 `export struct` 不会被编进
 *     ArkTS 依赖图（⇒ 它的 ArkTS 错误**编译期不报**，见 `docs/ARKTS-GOTCHAS.md` 批次13 /
 *     `tools/lint/orphan-components.sh`）。这些原子组件由各面板**跨文件真实实例化**，
 *     因此进入依赖图、被真编译覆盖。
 *
 * ⛔ 都是真 `@Component` + `@Prop`，**不用带参全局 `@Builder`**（参数是调用时刻的快照
 *    ⇒ 子树不随数据重建）。
 * ⛔ `@Prop` **不能叫 `enabled`**（ArkUI `CustomComponent` 基类成员，会判 10505001）⇒ 统一 `isOn`。
 */
import { Palette, paletteOf } from '../core/theme';
import { FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_6 } from '../core/tokens';
import { displayApiKey, providerLine, stripScheme } from '../core/rpc';

/** MCP 组头高度（vp）——组头与成员行的节奏差。 */
const HEAD_H: number = 44;
/** 数字输入框宽度（vp）——给足 5 位数（8192 / 4194304 的 MB 形态）不挤。 */
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
    Row({ space: SP_3 }) {
      Toggle({ type: ToggleType.Switch, isOn: this.isOn })
        .enabled(!this.busy)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: 2 }) {
        Text(this.label)
          .fontSize(FS_BODY)
          .fontFamily(this.mono ? 'monospace' : '')
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.description.length > 0) {
          Text(this.description)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({
      left: this.indented ? SP_6 : 0,
      right: SP_2,
      top: SP_2,
      bottom: SP_2,
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
    Row({ space: SP_3 }) {
      Toggle({ type: ToggleType.Switch, isOn: this.allEnabled })
        .enabled(!this.busy)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: 2 }) {
        Text(this.server)
          .fontSize(FS_BODY)
          .fontFamily('monospace')
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(`${this.count} 个工具`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .height(HEAD_H)
    .alignItems(VerticalAlign.Center)
    .padding({ right: SP_2 })
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
    Row({ space: SP_3 }) {
      Column({ space: 2 }) {
        Text(this.label)
          .fontSize(FS_BODY)
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.description.length > 0) {
          Text(this.description)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
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
          .fontSize(FS_BODY)
          .fontColor(this.pal().textPrimary)
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .padding({ left: SP_2, right: SP_2 })
          .onChange((v: string) => {
            this.onInput(v);
          })
        if (this.suffix.length > 0) {
          Text(this.suffix)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
        }
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({ right: SP_2, top: SP_2, bottom: SP_2 })
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
    Column({ space: SP_2 }) {
      Text(this.label)
        .fontSize(FS_BODY)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      if (this.description.length > 0) {
        Text(this.description)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.chips(), (opt: string) => {
          Text(this.labelOf(opt))
            .fontSize(FS_CAPTION)
            .fontColor(opt === this.value ? this.pal().onAccent : this.pal().textSecondary)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(opt === this.value ? this.pal().accent : this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .border({ width: 1, color: opt === this.value ? this.pal().accent : this.pal().border })
            .margin({ right: SP_2, bottom: SP_2 })
            .opacity(this.busy ? 0.5 : 1)
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
    .padding({ right: SP_2, top: SP_2, bottom: SP_2 })
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
    Column({ space: SP_1 }) {
      Text(this.label)
        .fontSize(FS_BODY)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      if (this.description.length > 0) {
        Text(this.description)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      TextInput({ text: this.value, placeholder: this.placeholder })
        .type(this.password ? InputType.Password : InputType.Normal)
        .enabled(!this.busy)
        .width('100%')
        .fontSize(FS_BODY)
        .fontColor(this.pal().textPrimary)
        .placeholderColor(this.pal().textMuted)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_LG)
        .border({ width: 1, color: this.pal().border })
        .padding({ left: SP_2, right: SP_2 })
        .onChange((v: string) => {
          this.onInput(v);
        })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ right: SP_2, top: SP_2, bottom: SP_2 })
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
    Column({ space: SP_2 }) {
      // 第一行：名称 + 默认徽标 + 启用开关
      Row({ space: SP_2 }) {
        Column({ space: 2 }) {
          Row({ space: SP_2 }) {
            Text(this.name.length > 0 ? this.name : this.subId)
              .fontSize(FS_BODY)
              .fontColor(this.pal().textPrimary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.isDefault) {
              Text('默认')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().accentText)
                .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                .backgroundColor(this.pal().accentDeep)
                .borderRadius(R_LG)
            }
          }
          Text(`${providerLine(this.provider, '')} · ${stripScheme(this.baseUrl)}`)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Toggle({ type: ToggleType.Switch, isOn: this.isOn })
          .enabled(!this.busy)
          .onChange((isOn: boolean) => {
            this.onToggle(this.subId, isOn);
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      // 第二行：模型 + 模型数
      Row({ space: SP_2 }) {
        Text(this.model.length > 0 ? this.model : '未指定默认模型')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textSecondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(`${this.modelCount} 个模型`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
      }
      .width('100%')

      // 第三行：掩码密钥（只读）+ 设默认
      Row({ space: SP_2 }) {
        Column({ space: 2 }) {
          Text('API Key（服务端掩码，只读）')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .width('100%')
          Text(displayApiKey(this.apiKey))
            .fontSize(FS_CAPTION)
            .fontFamily('monospace')
            .fontColor(this.pal().textSecondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (!this.isDefault) {
          Text('设为默认')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().accentSoft)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .borderRadius(R_LG)
            .border({ width: 1, color: this.pal().borderStrong })
            .opacity(this.busy ? 0.5 : 1)
            .onClick(() => {
              if (!this.busy) {
                this.onSetDefault(this.subId);
              }
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Bottom)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SP_4)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
  }
}

/** 面板顶部「标题 + 副标题」——三个面板统一用它，保证版式一致。 */
@Component
export struct SettingsPanelHeader {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Column({ space: SP_1 }) {
      Text(this.title)
        .fontSize(FS_BODY)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}

/** 面板内错误条（统一一行红字 + 底卡），三处复用。 */
@Component
export struct SettingsErrorBar {
  @Prop message: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Text(this.message)
      .fontSize(FS_CAPTION)
      .fontColor(this.pal().dangerText)
      .width('100%')
      .padding(SP_3)
      .backgroundColor(this.pal().surfaceAlt)
      .borderRadius(R_MD)
  }
}
