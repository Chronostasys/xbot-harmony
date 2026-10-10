/**
 * SettingsStorage —— 设置 → 存储：文件存储后端（本地 static / 阿里云 OSS / 腾讯云 COS / 七牛 / S3 兼容）。
 * 对齐 web `web/src/components/settings/SettingsStorage.tsx`。
 *
 * 契约（服务端；⚠️ 本分区的 method 名**就地定义在 `core/settings.ets`**，
 * 因为 `core/rpc.ets` 当前由别的线占用 —— 见那里顶部注释，后续波折叠进 `RpcMethod`）：
 *   · `get_storage_config`（**admin**，无参）→ `Record<string,string>`
 *       = 每个 schema 键的当前值 + `_schema`（`[]SettingDefinition` 的 JSON）+ `_active`（**正在运行**的 provider）
 *       （`serverapp/rpc_table.go:1927-1929`、`serverapp/storage_config.go:68-96`）
 *   · `set_storage_config`（**admin**）`{values}` → 写后回读的同形状 map
 *       （`rpc_table.go:1930-1934`、`storage_config.go:100+`）
 *
 * 表单由服务端 schema **驱动**（`channel/storage_defs.go:20-74`，唯一真值）：
 * provider 是 select；其余字段按 `depends_on_key`/`depends_on_values` **条件显示**
 * （如 `s3_*` 只在 provider ∈ {s3,aliyun,cos} 时出现）。
 *
 * ⛔ **secret 处理**（`storage_config.go:33-51`）：密文键读取时已打码（`前4位 + ****`）；
 *    提交**掩码原值**是安全的（服务端跳过含 `****` 的值 ⇒ 真凭据不动），
 *    但**绝不能**把它替换成空串（会被当成"用户清空了密钥"）。
 *    本面板只做只读回显 + 原样回传，**不**在日志/偏好里落任何值。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_LG, R_MD, R_XL, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { rpc, readableRpcError } from '../core/rpc';
import {
  buildStorageValues, editableStorageFields, isStorageMetaKey, liveStorageProvider,
  maskPasswordFields, maskSecretForDisplay, parseStorageSchema, RPC_GET_STORAGE_CONFIG,
  RPC_SET_STORAGE_CONFIG, SetStorageConfigParams, storageDirty, storageOptionLabel, StorageFieldDef,
  STORAGE_TYPE_PASSWORD, STORAGE_TYPE_SELECT, STORAGE_TYPE_TOGGLE, storageToggleOn,
} from '../core/settings';
import {
  SettingsChipRow, SettingsErrorBar, SettingsPanelHeader, SettingsTextFieldRow, SettingsToolRow,
} from './SettingsRows';

/** 不可变写入（换引用 ⇒ 触发 @State 重建；ArkTS 对对象字面量取值有约束故手抄）。 */
function withValue(map: Record<string, string>, key: string, value: string): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = map[keys[i]];
  }
  out[key] = value;
  return out;
}

@Component
export struct SettingsStorage {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private config: Record<string, string> = {};
  @State private draft: Record<string, string> = {};
  @State private schema: StorageFieldDef[] = [];
  @State private loading: boolean = true;
  @State private error: string = '';
  @State private busy: boolean = false;
  @State private savedNotice: string = '';

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** draft 优先（载入后 draft = config，等价于"当前编辑态"）。 */
  private fieldValue(key: string): string {
    const v: string | undefined = this.draft[key];
    return v !== undefined && v !== null ? v : '';
  }

  /** 已保存值（脏检测的对照面）。 */
  private savedOf(key: string): string {
    const v: string | undefined = this.config[key];
    return v !== undefined && v !== null ? v : '';
  }

  /** 当前可见的可编辑字段（schema 顺序；provider 单列）。 */
  private fields(): StorageFieldDef[] {
    return editableStorageFields(this.schema, (k: string) => this.fieldValue(k));
  }

  private providerField(): StorageFieldDef | undefined {
    const all: StorageFieldDef[] = this.fields();
    for (let i = 0; i < all.length; i++) {
      if (all[i].key === 'provider') {
        return all[i];
      }
    }
    return undefined;
  }

  /** 除 provider 之外的字段（web `SettingsStorage.tsx:139` 同义）。 */
  private restFields(): StorageFieldDef[] {
    const all: StorageFieldDef[] = this.fields();
    const out: StorageFieldDef[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].key !== 'provider') {
        out.push(all[i]);
      }
    }
    return out;
  }

  private providerLabels(): string[] {
    const f: StorageFieldDef | undefined = this.providerField();
    const out: string[] = [];
    if (f === undefined || f.options === undefined) {
      return out;
    }
    for (let i = 0; i < f.options.length; i++) {
      const o = f.options[i];
      out.push(o.label !== undefined && o.label.length > 0 ? o.label : o.value);
    }
    return out;
  }

  private providerValues(): string[] {
    const f: StorageFieldDef | undefined = this.providerField();
    const out: string[] = [];
    if (f === undefined || f.options === undefined) {
      return out;
    }
    for (let i = 0; i < f.options.length; i++) {
      out.push(f.options[i].value);
    }
    return out;
  }

  private dirty(): boolean {
    return storageDirty(this.fields(), (k: string) => this.fieldValue(k), (k: string) => this.savedOf(k));
  }

  private activeLabel(): string {
    const live: string = liveStorageProvider(this.config);
    return storageOptionLabel(this.schema, 'provider', live);
  }

  private set(key: string, value: string): void {
    this.savedNotice = '';
    this.draft = withValue(this.draft, key, value);
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const res: Record<string, string> = await rpc<Record<string, string>>(this.http, RPC_GET_STORAGE_CONFIG);
      const raw: Record<string, string> = res !== undefined && res !== null ? res : {};
      const defs: StorageFieldDef[] = parseStorageSchema(raw['_schema']);
      // 防御性打码（服务端已打码；这里保证真凭据永远不会进渲染路径）
      const cfg: Record<string, string> = maskPasswordFields(raw, defs);
      this.config = cfg;
      this.draft = cfg;
      this.schema = defs;
      this.error = '';
    } catch (e) {
      // admin 不足（`admin only`）必须给可读提示，不静默空白。
      this.error = readableRpcError((e as Error).message);
      this.config = {};
      this.draft = {};
      this.schema = [];
    } finally {
      this.loading = false;
    }
  }

  private async save(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const values: Record<string, string> = buildStorageValues(this.fields(), (k: string) => this.fieldValue(k));
      const res: Record<string, string> = await rpc<Record<string, string>>(this.http, RPC_SET_STORAGE_CONFIG,
        new SetStorageConfigParams(values));
      // 写后回读：以服务端为准（含打码后的密文）。
      const cfgRaw: Record<string, string> = res !== undefined && res !== null ? res : {};
      if (Object.keys(cfgRaw).length > 0) {
        const defs: StorageFieldDef[] = parseStorageSchema(cfgRaw['_schema']);
        const cfg: Record<string, string> = maskPasswordFields(cfgRaw, defs);
        this.config = cfg;
        this.draft = cfg;
        this.schema = defs;
      }
      this.savedNotice = '已保存并热切换';
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** 一个 schema 字段（按 type 分支；switch 语义与 web 的 toggle/其它 二分一致）。 */
  @Builder
  FieldRow(f: StorageFieldDef) {
    if (f.type === STORAGE_TYPE_TOGGLE) {
      SettingsToolRow({
        label: f.label !== undefined && f.label.length > 0 ? f.label : f.key,
        description: f.description !== undefined ? f.description : '',
        isOn: storageToggleOn(this.fieldValue(f.key)),
        mono: false,
        busy: this.busy,
        theme: this.theme,
        names: [f.key],
        onToggle: (names: string[], next: boolean) => {
          this.set(f.key, next ? 'true' : 'false');
        },
      })
    } else if (f.type === STORAGE_TYPE_SELECT) {
      SettingsChipRow({
        label: f.label !== undefined && f.label.length > 0 ? f.label : f.key,
        description: f.description !== undefined ? f.description : '',
        value: this.fieldValue(f.key),
        options: this.optionValues(f),
        labels: this.optionLabels(f),
        busy: this.busy,
        theme: this.theme,
        onSelect: (v: string) => {
          this.set(f.key, v);
        },
      })
    } else {
      SettingsTextFieldRow({
        label: f.label !== undefined && f.label.length > 0 ? f.label : f.key,
        description: f.description !== undefined ? f.description : '',
        // ⛔ **不要**在渲染期打码：用户输入新密钥时草稿是明文，渲染期打码会把每个字符
        //    换成 `****`（第 5 个字符起永远打不进去）。载入期已由 `maskPasswordFields`
        //    做了纵深防御；输入框的视觉遮显交给 `InputType.Password`。
        value: this.fieldValue(f.key),
        placeholder: f.default_value !== undefined ? f.default_value : '',
        password: f.type === STORAGE_TYPE_PASSWORD,
        busy: this.busy,
        theme: this.theme,
        onInput: (v: string) => {
          this.set(f.key, v);
        },
      })
    }
  }

  private optionValues(f: StorageFieldDef): string[] {
    const out: string[] = [];
    if (f.options === undefined) {
      return out;
    }
    for (let i = 0; i < f.options.length; i++) {
      out.push(f.options[i].value);
    }
    return out;
  }

  private optionLabels(f: StorageFieldDef): string[] {
    const out: string[] = [];
    if (f.options === undefined) {
      return out;
    }
    for (let i = 0; i < f.options.length; i++) {
      const o = f.options[i];
      out.push(o.label !== undefined && o.label.length > 0 ? o.label : o.value);
    }
    return out;
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '存储',
        subtitle: '配置上传文件的后端。本地 static 无需配置；切到云存储后由 bucket 承载，'
          + '保存即热切换（无需重启）。密钥由服务端打码，留空修改不会覆盖真实凭据。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.schema.length === 0 && this.error.length === 0) {
        Text('服务端未下发存储 schema，暂无可配置项。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            // 正在生效的 provider（`_active`，可能与已保存值短暂不同）
            Row({ space: SP_2 }) {
              Text('当前生效')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textMuted)
              Text(this.activeLabel())
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textPrimary)
                .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                .backgroundColor(this.pal().surfaceAlt)
                .borderRadius(R_MD)
            }
            .width('100%')

            Column({ space: SP_2 }) {
              if (this.providerField() !== undefined) {
                SettingsChipRow({
                  label: '后端',
                  description: '本地 = 图片/文件留在本机；云存储 = bucket 为真值，图片不会过期。',
                  value: this.fieldValue('provider'),
                  options: this.providerValues(),
                  labels: this.providerLabels(),
                  busy: this.busy,
                  theme: this.theme,
                  onSelect: (v: string) => {
                    this.set('provider', v);
                  },
                })
              }
              ForEach(this.restFields(), (f: StorageFieldDef) => {
                this.FieldRow(f)
              }, (f: StorageFieldDef) => `f|${f.key}`)
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

            Row({ space: SP_3 }) {
              Blank()
              if (this.savedNotice.length > 0) {
                Text(this.savedNotice)
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().successText)
              }
              Text(this.busy ? '保存中…' : '保存')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().onAccent)
                .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                .backgroundColor(this.pal().accent)
                .borderRadius(R_LG)
                .opacity(this.dirty() && !this.busy ? 1 : 0.4)
                .onClick(() => {
                  void this.save();
                })
            }
            .width('100%')
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
}
