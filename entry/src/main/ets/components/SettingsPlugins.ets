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
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  PluginConfigParams, PluginConfigSetParams, PluginReloadParams, PluginSetEnabledParams,
  PluginStatusParams,
  readableRpcError, rpc, RPC_PLUGIN_CONFIG, RPC_PLUGIN_CONFIG_SET, RPC_PLUGIN_RELOAD,
  RPC_PLUGIN_SET_ENABLED, RPC_PLUGIN_STATUS,
} from '../core/rpc';
import {
  ConfigValue, PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_IMAGE, PLUGIN_FIELD_MULTISELECT,
  PLUGIN_FIELD_NUMBER, PLUGIN_FIELD_SELECT, PLUGIN_FIELD_STRING, PLUGIN_FIELD_UNKNOWN,
  PluginConfigCatalog,
  PluginConfigEntry, PluginConfigGroup, PluginConfigProperty, configValueFingerprint, displayValue,
  filterPluginCatalog, groupBySection, isFieldEditable, listHas, parsePluginConfig,
  pluginEntryFingerprint, pluginFieldHasRange, pluginSliderStep, pluginSliderValue, readValue,
  PLUGIN_CTRL_CHIPS, PLUGIN_CTRL_IMAGE, PLUGIN_CTRL_STATIC, PLUGIN_CTRL_TEXT,
  PLUGIN_INPUT_DECIMAL, PLUGIN_INPUT_SECRET,
  pluginControlKind, pluginInputMode,
  PLUGIN_IMG_UPLOADED, pluginFilenameFromUri, pluginImagePreviewUrl, pluginImageValueKind,
  pluginUploadErrorText,
  pluginUploadMime, pluginUploadPath, pluginUploadStatusFromMessage, pluginUploadUrlFromMeta,
  submitValue, textInputValue, toggleListValue, validateValue, valueFromText, valueFromSingle,
  valueFromToggle, valueOfProp,
  PLUGIN_INSTALL_MAX_BYTES, PLUGIN_INSTALL_MIME, PLUGIN_INSTALL_PATH,
  PluginInstallResult, parsePluginInstallResult, pluginInstallErrorText,
  pluginInstallFilenameFromUri, pluginInstallSizeOk, pluginInstallSuccessText,
  PluginStatusEntry, PluginStatusList, parsePluginStatus, pluginStatusIsActive,
  pluginStatusMetaText, pluginStatusSummaryText,
} from '../core/settingsplugins';
import { PRESS_OPACITY, CONTROL_INPUT_H, colorOf, hairlineOf, HIT_TARGET_MIN } from '../core/design';
import { SettingsErrorBar, SettingsPanelHeader } from './SettingsRows';
import { AuthImage } from './AuthImage';

/** 单字段的行高/内边距常量（与各设置面板同视觉语言）。 */
const FIELD_PAD_T: number = SP_2;
const FIELD_PAD_B: number = SP_2;
/** image 预览框尺寸（vp）：宽固定 + 高上限（高度真上限由 `AuthImage.maxHeight` 兜）。 */
const PREVIEW_W: number = 120;
const PREVIEW_H: number = 90;

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
  /** number 字段是否声明了有效范围（`min < max`）⇒ 用**滑条**（web `SettingsPlugins.tsx:410-415`）。 */
  @Prop hasRange: boolean = false;
  /** number 滑条下界（`hasRange=false` 时无意义）。 */
  @Prop minv: number = 0;
  /** number 滑条上界。 */
  @Prop maxv: number = 0;
  /** image 字段的当前值（驱动预设选中态与「已上传」判断）。 */
  @Prop imgValue: string = '';
  /** image 字段：上传中 / 失败文案（空 = 无错）。 */
  @Prop uploading: boolean = false;
  @Prop uploadErr: string = '';
  /** image 字段的**预览用绝对 URL**（`pluginImagePreviewUrl` 产物；空 ⇒ 不画预览）。 */
  @Prop imgPreview: string = '';
  /**
   * 取图片字节（带鉴权；由父组件注入 `http.getBinary`）。
   * ⚠️ 用**普通成员**而非 `@Prop`（与 `onClose` 等回调同因：`@Prop` 承载函数不可靠）。
   */
  loadImage: (src: string) => Promise<ArrayBuffer> = async (src: string) => {
    return new ArrayBuffer(0);
  };

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
  /** image 字段：选图并上传（父组件实现 picker + 上传 + 写回）。 */
  onPickImage: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 控件档（判据在 `core/settingsplugins.ets:pluginControlKind`；组件**不自己判控件**）。 */
  private controlKind(): string {
    return pluginControlKind(this.kind);
  }

  /**
   * 值框的输入档 → ArkUI `InputType`（判据在 `core/settingsplugins.ets:pluginInputMode`）。
   * ⛔ **禁 `InputType.Number`**：它是整数档（SDK 原文 "decimals are not supported"）⇒ 会丢小数点
   *    （真机缺陷：`0.82` → `082` → 滑条钳到 max）。此处只做"角色名 → 枚举"的**机械映射**，
   *    判定逻辑一律在 core（`pluginInputMode`）。源码守卫见 `tools/tests/settingsplugins.test.ts`。
   */
  private inputType(): InputType {
    const mode: string = pluginInputMode(this.kind, this.secret);
    if (mode === PLUGIN_INPUT_DECIMAL) {
      return InputType.NUMBER_DECIMAL;
    }
    if (mode === PLUGIN_INPUT_SECRET) {
      return InputType.Password;
    }
    return InputType.Normal;
  }

  /** 滑条当前值（判据在 `core/settingsplugins.ets:pluginSliderValue` ⇒ 判据与渲染同源）。 */
  private sliderValue(): number {
    return pluginSliderValue(this.s, this.minv, this.maxv);
  }

  /** 滑条步长（判据同上 `pluginSliderStep`；两端皆整数 ⇒ 1，否则按跨度自适应）。 */
  private sliderStep(): number {
    return pluginSliderStep(this.minv, this.maxv);
  }

  /**
   * image 字段的值区：预设 + 当前值 + 「选择图片并上传」+ 失败可读 + Web UI 兜底。
   * 契约/判据全在 `core/settingsplugins.ets` ④（本组件只画 + 发回调）。
   */
  @Builder
  ImageSection() {
    Column({ space: SP_1 }) {
      if (this.optValues.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.optValues, (ov: string, oi: number) => {
            Text(this.optLabels[oi >= 0 && oi < this.optLabels.length ? oi : 0])
              .fontSize(FS_CAPTION)
              .fontColor(this.imgValue === ov ? this.pal().onAccent : this.pal().textSecondary)
              .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
              .margin(2)
              .backgroundColor(this.imgValue === ov ? this.pal().accent : this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .border({ width: 1, color: this.imgValue === ov ? this.pal().accent : this.pal().border })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                if (!this.busy && !this.uploading) {
                  this.onSelect(ov);
                }
              })
          }, (ov: string, oi: number) => `img-opt#${ov}#${oi}`)
        }
      }
      // 当前图片**小预览**（复用 `AuthImage`：自带字节缓存 + 鉴权下载 + 失败态 ⇒ 不新造下载器）。
      // ⛔ URL 由 `pluginImagePreviewUrl(baseUrl, value)` 产（纯逻辑）：uploaded ⇒ 拼 base；
      //    preset / 空 ⇒ 空串 ⇒ 此处不画（preset 是样式名，不是图片 URL）。
      if (this.imgPreview.length > 0) {
        AuthImage({
          src: this.imgPreview,
          load: this.loadImage,
          maxHeight: PREVIEW_H,
          theme: this.theme,
        })
          .width(PREVIEW_W)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
      }
      Text(this.imgValue.length > 0 ? this.imgValue : '（未设置图片）')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textSecondary)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      Row({ space: SP_2 }) {
        Text(this.uploading ? '上传中…' : '选择图片并上传')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().onAccent)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .backgroundColor(this.pal().accent)
          .borderRadius(R_LG)
          .opacity(this.uploading ? 0.5 : 1)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            if (!this.uploading && !this.busy) {
              this.onPickImage();
            }
          })
      }
      .width('100%')
      if (pluginImageValueKind(this.imgValue) === PLUGIN_IMG_UPLOADED) {
        Text('当前值 = 本站上传的图片（/api/plugin-files/…）。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      if (this.uploadErr.length > 0) {
        Text(this.uploadErr)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
      }
      Text('兜底：也可在「完整 Web UI」的设置 → 插件 里设置。')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
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
        if (this.controlKind() === PLUGIN_CTRL_STATIC) {
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
      if (this.controlKind() === PLUGIN_CTRL_IMAGE) {
        this.ImageSection()
      } else if (this.controlKind() === PLUGIN_CTRL_STATIC) {
        Text(this.display.length > 0 ? this.display : '—')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textSecondary)
          .width('100%')
        Text(this.kind === PLUGIN_FIELD_IMAGE ? '该类型需上传文件，原生端本期暂不支持编辑（请在 Web UI 中设置）。'
          : '该类型原生端暂不支持编辑。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.controlKind() === PLUGIN_CTRL_TEXT) {
        if (this.kind === PLUGIN_FIELD_NUMBER && this.hasRange) {
          // 声明了有效范围 ⇒ 滑条（对齐 web `SettingsPlugins.tsx:464-477`）；
          // 拖动**只**更新草稿，松手/点击才提交（⛔ 不逐帧写服务端）。
          Row({ space: SP_2 }) {
            Text(`${this.minv}`)
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textMuted)
            Slider({ value: this.sliderValue(), min: this.minv, max: this.maxv, step: this.sliderStep() })
              .enabled(!this.busy)
              .layoutWeight(1)
              .selectedColor(colorOf(this.pal(), 'accent'))
              .trackColor(colorOf(this.pal(), 'surfaceAlt'))
              .blockColor(colorOf(this.pal(), 'accent'))
              .onChange((value: number, mode: SliderChangeMode) => {
                this.onText(`${value}`);
                if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
                  this.onCommit();
                }
              })
            Text(`${this.maxv}`)
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textMuted)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }
        Row({ space: SP_2 }) {
          TextInput({ text: this.s, placeholder: this.placeholder })
            .enabled(!this.busy)
            // ⛔ 输入档**只**由 `core/settingsplugins.ets:pluginInputMode` 判（本组件不自己拍）。
            //    历史缺陷（2026-10-11）：这里曾直接写 `InputType.Number`（整数档，SDK 原文
            //    "decimals are not supported"）⇒ 服务端默认 `0.82` 被滤成 `082` ⇒ 滑条钳到 max。
            //    现由源码守卫钉死：本文件**不得出现** `InputType.Number`（见 settingsplugins 测试）。
            .type(this.inputType())
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
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onCommit();
            })
        }
        .width('100%')
      } else if (this.controlKind() === PLUGIN_CTRL_CHIPS) {
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
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
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
  /** 是否给错误态「重试」入口（真值由页面经 SettingsPanel 注入）。 */
  @Prop canRetry: boolean = false;
  /** 点「重试」时调用 —— 重发**本分区自己的**请求（⛔ 空实现 = 假重试）。 */
  onRetry: () => void = () => {
  };
  /** HTTP 客户端（由页面注入 `store.http`）。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private catalog: PluginConfigCatalog = new PluginConfigCatalog();
  @State private loading: boolean = true;
  @State private error: string = '';
  @State private notice: string = '';
  /** 在飞的键（`<pid>` 用于启停/重载；`<pid>#<key>` 用于配置写）—— 与 web `busy` 同义。 */
  @State private busy: string = '';
  /** image 上传中（`pid#key`；空 = 无）。 */
  @State private uploadBusy: string = '';
  /** image 上传失败文案（可读；空 = 无错）。 */
  @State private uploadErr: string = '';
  /** 文本/数字字段的**草稿**（键 = `<pid>#<key>`）—— 输入中途不发 RPC，点「保存」才提交。 */
  @State private drafts: Record<string, string> = {};
  /** 待确认重载的插件 id（二次确认，空 = 未武装）。 */
  @State private confirmReload: string = '';
  /**
   * 搜索串（对齐 web `SettingsPlugins.tsx:160-169` 的搜索框）。
   * 过滤**只**走核心纯函数 `filterPluginCatalog`（判据与渲染同源，⛔ 组件不写 `includes`）。
   */
  @State private query: string = '';
  /** 安装包（`.zip`）上传中 —— 与 web `installing` 同义。 */
  @State private installBusy: boolean = false;
  /** 安装失败文案（**已可读化**；空 = 无错）。 */
  @State private installErr: string = '';
  /** 后端插件**全量**（`plugin_status`；纯后端插件此前在原生端完全不可见 —— 见 `core/settingsplugins.ets` ⑥）。 */
  @State private backend: PluginStatusList = new PluginStatusList();
  /** 全量列表的错误（可读；空 = 无错）。插件系统不可用 ⇒ 服务端报 `plugin system not available`。 */
  @State private backendErr: string = '';

  aboutToAppear(): void {
    void this.load();
    void this.loadBackend();
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

  /** 搜索过滤后的目录（**唯一判据** = `core/settingsplugins.filterPluginCatalog`）。 */
  private filtered(): PluginConfigCatalog {
    return filterPluginCatalog(this.catalog, this.query);
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

  /**
   * 拉**后端插件全量**（`plugin_status`；见 `core/settingsplugins.ets` ⑥）。
   * ⛔ 与 `load()` **互不牵连**：插件系统不可用（服务端报 `plugin system not available`）时，
   *    配置面仍要能用 ⇒ 两条链各自记错，不互相清空。
   * `rescan:false` —— 普通刷新不必重扫磁盘（`rescan:true` 会走 `Discover+ActivateAll`，更贵）。
   */
  private async loadBackend(): Promise<void> {
    try {
      const raw: Object = await rpc<Object>(this.http, RPC_PLUGIN_STATUS, new PluginStatusParams(false));
      this.backend = parsePluginStatus(raw);
      this.backendErr = '';
    } catch (e) {
      this.backendErr = readableRpcError((e as Error).message);
      this.backend = new PluginStatusList();
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

  /** 取图片字节（`AuthImage.load` 的注入；null ⇒ 空 buffer ⇒ AuthImage 走失败态，可读）。 */
  private async loadImageBytes(src: string): Promise<ArrayBuffer> {
    const buf: ArrayBuffer | null = await this.http.getBinary(src);
    return buf === null ? new ArrayBuffer(0) : buf;
  }

  /**
   * image 字段：选图 → 读字节 → 上传 → 用**服务端返回的 url** 写回（`plugin_config_set`）。
   * 契约/判据全在 `core/settingsplugins.ets` ④；失败一律**可读**（HTTP 码 + 原因）。
   */
  private async pickAndUpload(pid: string, p: PluginConfigProperty): Promise<void> {
    const key: string = `${pid}#${p.key}`;
    if (this.uploadBusy.length > 0) {
      return;
    }
    this.uploadErr = '';
    try {
      const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
      const opt: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
      opt.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      opt.maxSelectNumber = 1;
      const res: photoAccessHelper.PhotoSelectResult = await picker.select(opt);
      const uris: string[] = res.photoUris;
      if (uris === undefined || uris.length === 0) {
        return; // 用户取消
      }
      const uri: string = uris[0];
      const name: string = pluginFilenameFromUri(uri, `image-${Date.now()}.png`);
      const f: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      let bytes: ArrayBuffer;
      try {
        const st: fileIo.Stat = fileIo.statSync(f.fd);
        bytes = new ArrayBuffer(st.size);
        fileIo.readSync(f.fd, bytes);
      } finally {
        fileIo.closeSync(f);
      }
      this.uploadBusy = key;
      const metaJson: string = await this.http.uploadBytes(
        pluginUploadPath(pid), name, bytes, pluginUploadMime(name));
      const url: string = pluginUploadUrlFromMeta(metaJson);
      if (url.length === 0) {
        throw new Error('上传响应缺少 url');
      }
      await this.writeValue(pid, p, valueFromText(p, url));
    } catch (e) {
      const msg: string = (e as Error).message;
      this.uploadErr = pluginUploadErrorText(pluginUploadStatusFromMessage(msg), msg);
    } finally {
      this.uploadBusy = '';
    }
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
      await this.loadBackend();
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
      await this.loadBackend();
      this.notice = '插件已重载';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
    }
  }

  /**
   * 安装插件（`.zip`）：选文件 → 读字节 → 上传 → 解析 → **刷新**。
   * 契约/判据全在 `core/settingsplugins.ets` ⑤（web 权威 + 服务端 file:line 逐条核对）。
   *
   * `POST /api/plugin/install-file`（`channel/web/web.go:971`），multipart 字段名 `file`
   * （`web_api.go:587`）—— 与 `XbotHttp.uploadBytes` 的硬编码一致 ⇒ **直接复用**该上传器
   * （信封也已由它剥好，`core/http.ets:380-385`）。
   * ⚠️ 该端点**管理员限定**（`web_api.go:577-580`）⇒ 非管理员拿 403，文案已给"需要管理员权限"。
   */
  private async installZip(): Promise<void> {
    if (this.installBusy) {
      return;
    }
    this.installErr = '';
    this.notice = '';
    try {
      const ctx: common.UIAbilityContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      opt.maxSelectNumber = 1;
      // 只列 zip（d.ts 契约：`'描述|.后缀'`，见 `@ohos.file.picker.d.ts:432-451`）。
      opt.fileSuffixFilters = ['插件包 (.zip)|.zip'];
      const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(ctx);
      const uris: string[] = await docPicker.select(opt);
      if (uris === undefined || uris.length === 0) {
        return; // 用户取消
      }
      const uri: string = uris[0];
      const name: string = pluginInstallFilenameFromUri(uri, `plugin-${Date.now()}.zip`);
      const f: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      let bytes: ArrayBuffer;
      let size: number = 0;
      try {
        const st: fileIo.Stat = fileIo.statSync(f.fd);
        size = st.size;
        bytes = new ArrayBuffer(size);
        fileIo.readSync(f.fd, bytes);
      } finally {
        fileIo.closeSync(f);
      }
      // 客户端**先判上限**（服务端 `32 << 20`，`web_api.go:582`）—— 别把整包传完才被 400 拒。
      if (!pluginInstallSizeOk(size)) {
        this.installErr = pluginInstallErrorText(400,
          `文件大小 ${size} 字节超出上限 ${PLUGIN_INSTALL_MAX_BYTES}`);
        return;
      }
      this.installBusy = true;
      const metaJson: string = await this.http.uploadBytes(
        PLUGIN_INSTALL_PATH, name, bytes, PLUGIN_INSTALL_MIME);
      const res: PluginInstallResult = parsePluginInstallResult(metaJson);
      if (!res.ok()) {
        throw new Error('安装响应缺少 id');
      }
      await this.load();
      this.notice = pluginInstallSuccessText(res.id);
    } catch (e) {
      const msg: string = (e as Error).message;
      this.installErr = pluginInstallErrorText(pluginUploadStatusFromMessage(msg), msg);
    } finally {
      this.installBusy = false;
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
        SettingsErrorBar({ message: this.error, theme: this.theme, canRetry: this.canRetry, onRetry: this.onRetry })
      }
      if (this.notice.length > 0) {
        Text(this.notice)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().successText)
          .width('100%')
      }

      // ── 安装插件（`.zip`）—— 对齐 web `PluginManagerPanel.tsx:150-172` 的"安装"按钮 ────────
      // ⛔ 放在三态分支**之前**：目录为空（还没有任何插件）时也**必须**能装第一个插件
      //    —— web 的安装按钮同样常驻（不随列表空/满出现消失）。
      Row() {
        Text(this.installBusy ? '安装中…' : '安装插件（.zip）')
          .fontSize(FS_CAPTION)
          .fontColor(this.installBusy ? this.pal().textMuted : this.pal().accentSoft)
          .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            void this.installZip();
          })
      }
      .width('100%')

      if (this.installErr.length > 0) {
        Text(this.installErr)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
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
        // ── 搜索框（对齐 web `SettingsPlugins.tsx:160-169`；过滤判据 = core `filterPluginCatalog`）──
        TextInput({ text: this.query, placeholder: '搜索配置项（key / 名称 / 说明）' })
          .placeholderColor(colorOf(this.pal(), 'textMuted'))
          .fontColor(colorOf(this.pal(), 'textPrimary'))
          .backgroundColor(colorOf(this.pal(), 'surfaceAlt'))
          .border({ width: 1, color: hairlineOf(this.pal()) })
          .borderRadius(R_LG)
          .constraintSize({ minHeight: CONTROL_INPUT_H })
          .width('100%')
          .onChange((v: string) => {
            this.query = v;
          })

        Scroll() {
          Column({ space: SP_3 }) {
            if (this.filtered().entries.length === 0) {
              Text('没有匹配的配置项。')
                .fontSize(FS_CAPTION)
                .fontColor(colorOf(this.pal(), 'textMuted'))
                .width('100%')
            } else {
              ForEach(this.filtered().entries, (e: PluginConfigEntry) => {
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
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
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
                        hasRange: pluginFieldHasRange(p),
                        minv: p.min,
                        maxv: p.max,
                        imgValue: this.backendValue(e.id, p).s,
                        imgPreview: pluginImagePreviewUrl(this.http.baseUrl, this.backendValue(e.id, p).s),
                        uploading: this.uploadBusy === `${e.id}#${p.key}`,
                        uploadErr: this.uploadErr,
                        loadImage: (s: string): Promise<ArrayBuffer> => this.loadImageBytes(s),
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
                        onPickImage: () => {
                          void this.pickAndUpload(e.id, p);
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
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }

      // ── 全部插件（后端**全量**，`plugin_status`）—— 对齐 web `PluginManagerPanel.tsx:206-256` ──
      // 为什么单列一张：`web_plugin_list` 只含**有 web 产物**的插件、`plugin_config` 只含
      // **带配置声明**的插件 ⇒ **纯后端插件**（script/grpc）在上面那个列表里**根本不出现**。
      // 判据全在 `core/settingsplugins.ets` ⑥；启停/重载**复用同一对方法**（服务端同一组 RPC）。
      Column({ space: SP_2 }) {
        Row({ space: SP_2 }) {
          Text(pluginStatusSummaryText(this.backend.active, this.backend.total))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .layoutWeight(1)
          Text('刷新')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().accentSoft)
            .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
            // ⛔ 命中区 ≥ `HIT_TARGET_MIN`(44, Apple HIG)：原先只靠 padding 撑高（≈24）⇒ 低于阈值。
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              void this.loadBackend();
            })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        if (this.backendErr.length > 0) {
          Text(this.backendErr)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().dangerText)
            .width('100%')
        } else if (this.backend.entries.length === 0) {
          Text('后端没有插件（插件系统未启用，或插件目录为空）。')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .width('100%')
        } else {
          ForEach(this.backend.entries, (e: PluginStatusEntry) => {
            Row({ space: SP_2 }) {
              Text(e.name)
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textPrimary)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
              Text(pluginStatusMetaText(e))
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textMuted)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.confirmReload === e.id ? '确认重载？' : '重载')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().warn)
                .padding({ left: SP_2, right: SP_2, top: SP_1, bottom: SP_1 })
                .backgroundColor(this.confirmReload === e.id ? this.pal().warnBg : this.pal().transparent)
                .borderRadius(R_LG)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  if (this.confirmReload === e.id) {
                    void this.reload(e.id);
                  } else if (this.busy.length === 0) {
                    this.confirmReload = e.id;
                  }
                })
              Toggle({ type: ToggleType.Switch, isOn: pluginStatusIsActive(e.state) })
                .enabled(this.busy.length === 0)
                .onChange((on: boolean) => {
                  void this.toggleEnabled(e.id, on);
                })
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
            .padding(SP_2)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })
          }, (e: PluginStatusEntry) => e.id)
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .layoutWeight(1)
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
