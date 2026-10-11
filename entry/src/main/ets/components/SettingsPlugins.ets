/**
 * SettingsPlugins —— 设置 → 插件：**配置读写 + 启停 + 重载**（对齐 web）。
 *
 * ## web 权威（逐条核对）
 *  · 配置读：`components/settings/SettingsPlugins.tsx:74-75` `plugin_config`；
 *  · 配置写：`:510-513` `plugin_config_set {id,key,value}`（**服务端按 schema 强校验**）；
 *  · 启停：`plugins/manager/PluginManagerPanel.tsx:101` `plugin_set_enabled {id,enabled}`；
 *  · 重载：`plugin_reload {id}`（`serverapp/rpc_table.go:2099`）。
 *
 * ## 判据全部来自 `core/settingsplugins.ets`（纯逻辑，可脱机单测）
 *  线格式解析 / 类型归一 / 值校验 / 提交形状 / 可见性与门控 —— 组件**不自造判据**，只渲染。
 *
 * ## ⛔ 状态一律以后端为准（用户常驻要求）
 *  每次写入**成功**后都 `plugin_config` **重新拉取**并把服务端值作为唯一真值
 *  （web 是乐观更新 + SSE 合并；原生按用户要求收严为"写后回读"）。失败只报错、不改本地模型。
 *
 * ## ⛔ 不做半截（未实现的能力明确禁用，不假装成功）
 *  `image` 类型需文件选择 + 上传（web `SettingsPlugins.tsx:221-355`）⇒ 本期**禁用并说明**；
 *  `plugin_install`/`plugin_uninstall` 需文件/包输入 ⇒ 本期**不呈现**（见交付清单）。
 *
 * ArkUI 约束：行组件的会变内容走 `@Prop`（基础类型）；`ForEach` 的 key **带内容指纹**
 * （`core/settingsplugins` 的两个 fingerprint 函数）——key 不变则复用节点、不重估 @Prop。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  PluginConfigParams, PluginConfigSetParams, PluginReloadParams, PluginSetEnabledParams,
  readableRpcError, rpc, RPC_PLUGIN_CONFIG, RPC_PLUGIN_CONFIG_SET, RPC_PLUGIN_RELOAD,
  RPC_PLUGIN_SET_ENABLED,
} from '../core/rpc';
import {
  ConfigValue, PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_IMAGE, PLUGIN_FIELD_MULTISELECT,
  PLUGIN_FIELD_NUMBER, PLUGIN_FIELD_SELECT, PLUGIN_FIELD_STRING, PLUGIN_FIELD_UNKNOWN,
  PluginConfigCatalog,
  PluginConfigEntry, PluginConfigGroup, PluginConfigProperty, configValueFingerprint, displayValue,
  groupBySection, isFieldEditable, listHas, parsePluginConfig, pluginEntryFingerprint, readValue,
  submitValue, textInputValue, toggleListValue, validateValue, valueFromText, valueFromSingle,
  valueFromToggle, valueOfProp,
} from '../core/settingsplugins';
import { SettingsErrorBar, SettingsPanelHeader } from './SettingsRows';

/** 单字段的行高/内边距常量（与各设置面板同视觉语言）。 */
const FIELD_PAD_T: number = SP_2;
const FIELD_PAD_B: number = SP_2;

/** 一行字段的展示输入（全部**基础类型/数组** —— ArkTS `@Prop` 对复杂类的深拷贝不可靠）。 */
@Component
struct PluginFieldRow {
  @Prop kind: string = '';
  @Prop label: string = '';
  @Prop description: string = '';
  @Prop placeholder: string = '';
  @Prop secret: boolean = false;
  @Prop editable: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  /** boolean 值。 */
  @Prop b: boolean = false;
  /** string/select/image 的值（text/number 时为**草稿文本**）。 */
  @Prop s: string = '';
  /** multiselect 的已选值。 */
  @Prop list: string[] = [];
  /** select/multiselect 的候选（值/显示名，一一对应）。 */
  @Prop optValues: string[] = [];
  @Prop optLabels: string[] = [];
  /** 非编辑类型（image/unknown）的只读展示。 */
  @Prop display: string = '';

  onBool: (next: boolean) => void = (next: boolean) => {
  };
  onSelect: (value: string) => void = (value: string) => {
  };
  onMulti: (optionValue: string) => void = (optionValue: string) => {
  };
  onText: (text: string) => void = (text: string) => {
  };
  onCommit: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 该字段是否用文本框（string/number）。 */
  private isText(): boolean {
    return this.kind === PLUGIN_FIELD_STRING || this.kind === PLUGIN_FIELD_NUMBER;
  }

  @Builder
  LabelCol() {
    Column({ space: 2 }) {
      Text(this.label.length > 0 ? this.label : '（未命名）')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      if (this.description.length > 0) {
        Text(this.description)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
  }

  build() {
    Column({ space: SP_1 }) {
      Row({ space: SP_2 }) {
        this.LabelCol()
        if (!this.editable) {
          Text('暂不支持编辑')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
        } else if (this.kind === PLUGIN_FIELD_BOOLEAN) {
          Toggle({ type: ToggleType.Switch, isOn: this.b })
            .enabled(!this.busy)
            .onChange((on: boolean) => {
              this.onBool(on);
            })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // 非编辑类型：只读展示 + 明确说明（**不假装成功**）
      if (!this.editable) {
        Text(this.display.length > 0 ? this.display : '—')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textSecondary)
          .width('100%')
        Text(this.kind === PLUGIN_FIELD_IMAGE ? '该类型需上传文件，原生端本期暂不支持编辑（请在 Web UI 中设置）。'
          : '该类型原生端暂不支持编辑。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.isText()) {
        Row({ space: SP_2 }) {
          TextInput({ text: this.s, placeholder: this.placeholder })
            .enabled(!this.busy)
            .type(this.kind === PLUGIN_FIELD_NUMBER ? InputType.Number
              : (this.secret ? InputType.Password : InputType.Normal))
            .layoutWeight(1)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .placeholderColor(this.pal().textMuted)
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .border({ width: 1, color: this.pal().border })
            .padding({ left: SP_2, right: SP_2 })
            .onChange((v: string) => {
              this.onText(v);
            })
          Text(this.busy ? '…' : '保存')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().onAccent)
            .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
            .backgroundColor(this.pal().accent)
            .borderRadius(R_LG)
            .opacity(this.busy ? 0.5 : 1)
            .onClick(() => {
              this.onCommit();
            })
        }
        .width('100%')
      } else if (this.kind === PLUGIN_FIELD_SELECT || this.kind === PLUGIN_FIELD_MULTISELECT) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.optValues, (ov: string, oi: number) => {
            Text(this.optLabels[oi >= 0 && oi < this.optLabels.length ? oi : 0])
              .fontSize(FS_CAPTION)
              .fontColor(this.isChipOn(ov) ? this.pal().onAccent : this.pal().textSecondary)
              .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
              .margin(2)
              .backgroundColor(this.isChipOn(ov) ? this.pal().accent : this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .border({ width: 1, color: this.isChipOn(ov) ? this.pal().accent : this.pal().border })
              .onClick(() => {
                if (this.kind === PLUGIN_FIELD_SELECT) {
                  this.onSelect(ov);
                } else {
                  this.onMulti(ov);
                }
              })
          }, (ov: string) => `chip|${ov}`)
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: FIELD_PAD_T, bottom: FIELD_PAD_B })
  }

  /** 该 chip 是否选中（select = 值相等；multiselect = 在列表里）。 */
  private isChipOn(optionValue: string): boolean {
    if (this.kind === PLUGIN_FIELD_SELECT) {
      return this.s === optionValue;
    }
    const v: ConfigValue = new ConfigValue();
    v.list = this.list;
    return listHas(v, optionValue);
  }
}

@Component
export struct SettingsPlugins {
  /** HTTP 客户端（由页面注入 `store.http`）。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private catalog: PluginConfigCatalog = new PluginConfigCatalog();
  @State private loading: boolean = true;
  @State private error: string = '';
  @State private notice: string = '';
  /** 在飞的键（`<pid>` 用于启停/重载；`<pid>#<key>` 用于配置写）—— 与 web `busy` 同义。 */
  @State private busy: string = '';
  /** 文本/数字字段的**草稿**（键 = `<pid>#<key>`）—— 输入中途不发 RPC，点「保存」才提交。 */
  @State private drafts: Record<string, string> = {};
  /** 待确认重载的插件 id（二次确认，空 = 未武装）。 */
  @State private confirmReload: string = '';

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 草稿键（同时是 ForEach key 的一部分来源）。 */
  private fieldKey(pid: string, p: PluginConfigProperty): string {
    return `${pid}#${p.key}`;
  }

  private draftOf(pid: string, p: PluginConfigProperty): string {
    const k: string = this.fieldKey(pid, p);
    const d: string | undefined = this.drafts[k];
    return d !== undefined ? d : textInputValue(p, this.backendValue(pid, p));
  }

  private backendValue(pid: string, p: PluginConfigProperty): ConfigValue {
    const e: PluginConfigEntry | undefined = this.entryById(pid);
    if (e === undefined) {
      return new ConfigValue();
    }
    return valueOfProp(p, e.values);
  }

  private entryById(pid: string): PluginConfigEntry | undefined {
    for (let i = 0; i < this.catalog.entries.length; i++) {
      if (this.catalog.entries[i].id === pid) {
        return this.catalog.entries[i];
      }
    }
    return undefined;
  }

  private groupsOf(e: PluginConfigEntry): PluginConfigGroup[] {
    return groupBySection(e.properties);
  }

  /** 拉取（**唯一真值来源**）—— 写入成功后也走它（写后回读，后端为准）。 */
  private async load(): Promise<void> {
    this.loading = true;
    try {
      const raw: Object = await rpc<Object>(this.http, RPC_PLUGIN_CONFIG, new PluginConfigParams(''));
      this.catalog = parsePluginConfig(raw);
      this.drafts = {};
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
      this.catalog = new PluginConfigCatalog();
    } finally {
      this.loading = false;
    }
  }

  /** 写一个字段：**本地先校验**（非法则不发、不留假成功）⇒ 成功则**重拉**。 */
  private async writeValue(pid: string, p: PluginConfigProperty, v: ConfigValue): Promise<void> {
    const why: string = validateValue(p, v);
    if (why.length > 0) {
      this.error = `${p.label.length > 0 ? p.label : p.key}：${why}`;
      return;
    }
    this.busy = `${pid}#${p.key}`;
    try {
      await rpc<void>(this.http, RPC_PLUGIN_CONFIG_SET,
        new PluginConfigSetParams(pid, p.key, submitValue(p, v)));
      await this.load();
      this.notice = '已保存（已按服务端值刷新）';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
    }
  }

  private async setBool(pid: string, p: PluginConfigProperty, on: boolean): Promise<void> {
    await this.writeValue(pid, p, valueFromToggle(on));
  }

  private async setSingle(pid: string, p: PluginConfigProperty, value: string): Promise<void> {
    await this.writeValue(pid, p, valueFromSingle(value));
  }

  private async toggleMulti(pid: string, p: PluginConfigProperty, optionValue: string): Promise<void> {
    await this.writeValue(pid, p, toggleListValue(this.backendValue(pid, p), optionValue));
  }

  /** 文本/数字：只更新草稿（不发 RPC）。 */
  private onText(pid: string, p: PluginConfigProperty, text: string): void {
    const next: Record<string, string> = {};
    const keys: string[] = Object.keys(this.drafts);
    for (let i = 0; i < keys.length; i++) {
      next[keys[i]] = this.drafts[keys[i]];
    }
    next[this.fieldKey(pid, p)] = text;
    this.drafts = next;
  }

  private async commitText(pid: string, p: PluginConfigProperty): Promise<void> {
    const text: string = this.draftOf(pid, p);
    await this.writeValue(pid, p, valueFromText(p, text));
  }

  /** 启停（写后回读）。 */
  private async toggleEnabled(pid: string, next: boolean): Promise<void> {
    if (this.busy.length > 0) {
      return;
    }
    this.busy = pid;
    try {
      await rpc<Object>(this.http, RPC_PLUGIN_SET_ENABLED, new PluginSetEnabledParams(pid, next));
      await this.load();
      this.notice = next ? '插件已启用' : '插件已停用';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
    }
  }

  /** 重载（危险操作 ⇒ 二次确认；写后回读）。 */
  private async reload(pid: string): Promise<void> {
    if (this.busy.length > 0) {
      return;
    }
    this.busy = pid;
    this.confirmReload = '';
    try {
      await rpc<Object>(this.http, RPC_PLUGIN_RELOAD, new PluginReloadParams(pid));
      await this.load();
      this.notice = '插件已重载';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
    }
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '插件',
        subtitle: '插件的配置项直接写回服务端并即时生效；写入后会重新读取服务端值作为唯一真值。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }
      if (this.notice.length > 0) {
        Text(this.notice)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().successText)
          .width('100%')
      }

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.catalog.entries.length === 0) {
        Text('没有带配置声明的插件。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            ForEach(this.catalog.entries, (e: PluginConfigEntry) => {
              Column({ space: SP_2 }) {
                // 插件头：名称 + runtime + 启停 + 重载
                Row({ space: SP_2 }) {
                  Column({ space: 2 }) {
                    Text(e.name)
                      .fontSize(FS_CAPTION)
                      .fontColor(this.pal().textPrimary)
                      .width('100%')
                    Text(e.title.length > 0 ? e.title : e.runtime)
                      .fontSize(FS_CAPTION)
                      .fontColor(this.pal().textMuted)
                      .width('100%')
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)

                  Text(this.confirmReload === e.id ? '确认重载？' : '重载')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().warn)
                    .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
                    .backgroundColor(this.confirmReload === e.id ? this.pal().warnBg : this.pal().transparent)
                    .borderRadius(R_LG)
                    .onClick(() => {
                      if (this.confirmReload === e.id) {
                        void this.reload(e.id);
                      } else if (this.busy.length === 0) {
                        this.confirmReload = e.id;
                      }
                    })

                  Toggle({ type: ToggleType.Switch, isOn: e.isOn })
                    .enabled(this.busy.length === 0)
                    .onChange((on: boolean) => {
                      void this.toggleEnabled(e.id, on);
                    })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)

                // 各分组的字段
                ForEach(this.groupsOf(e), (g: PluginConfigGroup) => {
                  Column({ space: SP_1 }) {
                    if (g.section.length > 0) {
                      Text(g.section)
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textMuted)
                        .width('100%')
                    }
                    ForEach(g.props, (p: PluginConfigProperty) => {
                      PluginFieldRow({
                        kind: p.kind,
                        label: p.label.length > 0 ? p.label : p.key,
                        description: p.description,
                        placeholder: p.placeholder,
                        secret: p.secret,
                        editable: isFieldEditable(p.kind),
                        busy: this.busy === `${e.id}#${p.key}`,
                        theme: this.theme,
                        b: this.backendValue(e.id, p).b,
                        s: this.draftOf(e.id, p),
                        list: this.backendValue(e.id, p).list,
                        optValues: this.optValuesOf(p),
                        optLabels: this.optLabelsOf(p),
                        display: displayValue(p, this.backendValue(e.id, p)),
                        onBool: (on: boolean) => {
                          void this.setBool(e.id, p, on);
                        },
                        onSelect: (value: string) => {
                          void this.setSingle(e.id, p, value);
                        },
                        onMulti: (optionValue: string) => {
                          void this.toggleMulti(e.id, p, optionValue);
                        },
                        onText: (text: string) => {
                          this.onText(e.id, p, text);
                        },
                        onCommit: () => {
                          void this.commitText(e.id, p);
                        },
                      })
                    }, (p: PluginConfigProperty) => `${this.fieldKey(e.id, p)}#${configValueFingerprint(p, this.backendValue(e.id, p))}#${this.draftOf(e.id, p)}`)
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)
                }, (g: PluginConfigGroup) => `${e.id}|s|${g.section}`)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding(SP_3)
              .backgroundColor(this.pal().surface)
              .borderRadius(R_XL)
              .border({ width: 1, color: this.pal().border })
            }, (e: PluginConfigEntry) => pluginEntryFingerprint(e))
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }

  private optValuesOf(p: PluginConfigProperty): string[] {
    const out: string[] = [];
    for (let i = 0; i < p.options.length; i++) {
      out.push(p.options[i].value);
    }
    return out;
  }

  private optLabelsOf(p: PluginConfigProperty): string[] {
    const out: string[] = [];
    for (let i = 0; i < p.options.length; i++) {
      const l: string = p.options[i].label;
      out.push(l.length > 0 ? l : p.options[i].value);
    }
    return out;
  }
}
