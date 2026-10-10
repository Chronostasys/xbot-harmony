/**
 * SettingsAgent —— 智能体行为开关（设置 → 智能体），对齐 web
 * `web/src/components/settings/SettingsAgent.tsx`。
 *
 * 契约（服务端 `serverapp/rpc_table.go`）：
 *   · 读 `get_settings` `{namespace:'cli', sender_id:''}` → `Record<string,string>`（`rpc_table.go:450-505`；
 *     会为 DB 里没有的键**注入 config 默认值**，如 `allow_self_compact` ← `rpc_table.go:501-502`）
 *   · 写 `set_setting` `{namespace:'cli', sender_id:'', key, value}` → void（`rpc_table.go:506-544`，**逐键**）
 *
 * 本面板的键 / 取值域 / 默认值**逐条取自 web**（权威基准），集中在 `core/rpc.ets` 的
 * `AGENT_KEY_*` 与 `buildVisionWrites()`：
 *   `allow_self_compact`（true|false，默认 false）/ `vision_max_image_edge_px`（256..8192，默认 1024）/
 *   `vision_max_image_bytes`（字节串；界面 MB，0<mb≤20，默认 4MB）/ `vision_output_format`（auto|jpeg，默认 auto）/
 *   `vision_jpeg_quality`（50..100，默认 85）
 *
 * ⚠️ 服务端 `set_setting` 对普通 user 级键**不做白名单/范围校验**（直接落 `user_settings`，
 *    `rpc_table.go:537`）⇒ **取值范围只在客户端把关**（与 web 完全一致）。
 *
 * ⛔ **不用带参全局 `@Builder`**（参数是调用时刻的快照 ⇒ 子树不随数据重建）；行组件来自
 *    `components/SettingsRows.ets`（真 `@Component` + `@Prop`）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_LG, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  AGENT_KEY_ALLOW_SELF_COMPACT, boolSettingValue, buildVisionWrites, bytesToMbInput,
  GetSettingsParams, normalizeVisionFormat, readableRpcError, rpc, RpcMethod,
  SetSettingParams, settingIsTrue, settingValue, SettingWrite, SETTINGS_NS_CLI,
  VISION_FORMATS, VISION_FORMAT_AUTO, VISION_FORMAT_JPEG,
} from '../core/rpc';
import { SettingsChipRow, SettingsErrorBar, SettingsNumberRow, SettingsPanelHeader, SettingsToolRow } from './SettingsRows';

@Component
export struct SettingsAgent {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private loaded: boolean = false;
  @State private error: string = '';

  /** `allow_self_compact`（布尔开关）。 */
  @State private selfCompact: boolean = false;
  @State private savingSelf: boolean = false;

  /** 视觉/图片处理（4 个键的表单值；空串 = 未填，界面显示 placeholder）。 */
  @State private edgePx: string = '';
  @State private maxImageMb: string = '';
  @State private outputFormat: string = VISION_FORMAT_AUTO;
  @State private jpegQuality: string = '';
  @State private savingVision: boolean = false;
  @State private visionDirty: boolean = false;

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private formats(): string[] {
    return VISION_FORMATS;
  }

  /** 片上的显示文案（与 `VISION_FORMATS` 一一对应；对齐 web 的 option label）。 */
  private formatLabels(): string[] {
    return ['自动（透明→PNG，其余 JPEG）', '统一 JPEG（体积最小）'];
  }

  private async load(): Promise<void> {
    try {
      const settings: Record<string, string> = await rpc<Record<string, string>>(
        this.http, RpcMethod.getSettings, new GetSettingsParams(SETTINGS_NS_CLI));
      // 逐键读法与 web `SettingsAgent.tsx:136-142` 一一对应（空值保持空 ⇒ 显示 placeholder）。
      this.selfCompact = settingIsTrue(settingValue(settings, AGENT_KEY_ALLOW_SELF_COMPACT));
      this.edgePx = settingValue(settings, 'vision_max_image_edge_px');
      this.maxImageMb = bytesToMbInput(settingValue(settings, 'vision_max_image_bytes'));
      const fmt: string = settingValue(settings, 'vision_output_format');
      this.outputFormat = fmt.length > 0 ? normalizeVisionFormat(fmt) : VISION_FORMAT_AUTO;
      this.jpegQuality = settingValue(settings, 'vision_jpeg_quality');
      this.visionDirty = false;
      this.error = '';
      this.loaded = true;
    } catch (e) {
      // 读失败 ⇒ 开关保持禁用（web 同：`disabled={!loaded}`），但**给出可读原因**，不静默。
      this.error = readableRpcError((e as Error).message);
      this.loaded = false;
    }
  }

  /** 布尔开关：乐观更新 + 失败回滚（web `SettingsAgent.tsx:151-161`）。 */
  private async applySelfCompact(next: boolean): Promise<void> {
    const prev: boolean = this.selfCompact;
    this.selfCompact = next;
    this.savingSelf = true;
    try {
      await rpc<void>(this.http, RpcMethod.setSetting,
        new SetSettingParams(SETTINGS_NS_CLI, AGENT_KEY_ALLOW_SELF_COMPACT, boolSettingValue(next)));
      this.error = '';
    } catch (e) {
      this.selfCompact = prev;
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.savingSelf = false;
    }
  }

  /** 视觉设置：一次「保存」把 4 个键**逐键写回**（web `SettingsAgent.tsx:167-200`）。 */
  private async saveVision(): Promise<void> {
    if (!this.visionDirty) {
      return;
    }
    this.savingVision = true;
    try {
      const writes: SettingWrite[] = buildVisionWrites(this.edgePx, this.maxImageMb, this.outputFormat, this.jpegQuality);
      for (let i = 0; i < writes.length; i++) {
        await rpc<void>(this.http, RpcMethod.setSetting,
          new SetSettingParams(SETTINGS_NS_CLI, writes[i].key, writes[i].value));
      }
      this.visionDirty = false;
      this.error = '';
      await this.load();
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.savingVision = false;
    }
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '智能体',
        subtitle: '行为开关与图片预处理。改动立即生效并持久化；视觉设置改动后点「保存」。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }

      if (!this.loaded) {
        Text(this.error.length > 0 ? '设置读取失败，开关暂不可用。' : '加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            // ── 智能体行为 ──
            Column({ space: 0 }) {
              SettingsToolRow({
                label: '允许智能体自行压缩上下文',
                description: '开启后智能体可调用 compact_context 按需压缩自己的上下文（阈值触发'
                  + '的自动压缩不受此开关影响）。',
                isOn: this.selfCompact,
                mono: false,
                busy: this.savingSelf,
                theme: this.theme,
                names: [AGENT_KEY_ALLOW_SELF_COMPACT],
                onToggle: (names: string[], next: boolean) => {
                  void this.applySelfCompact(next);
                },
              })
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

            // ── 视觉 / 图片处理 ──
            Text('视觉 / 图片处理')
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
              .width('100%')
            Text('控制发给 LLM API 的图片如何预处理（缩放 / 重编码）。只影响已开启 vision 的模型。')
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textMuted)
              .width('100%')

            Column({ space: SP_2 }) {
              SettingsNumberRow({
                label: '最长边上限',
                description: '超过此值自动缩放。1024 适合大多数 API；2048 保留更多细节。留空 = 默认 1024。',
                value: this.edgePx,
                placeholder: '1024',
                suffix: 'px',
                busy: this.savingVision,
                theme: this.theme,
                onInput: (v: string) => {
                  this.edgePx = v;
                  this.visionDirty = true;
                },
              })
              SettingsNumberRow({
                label: '单图大小上限',
                description: '预处理后超过此值降级为文本占位。留空 = 默认 4MB。',
                value: this.maxImageMb,
                placeholder: '4',
                suffix: 'MB',
                busy: this.savingVision,
                theme: this.theme,
                onInput: (v: string) => {
                  this.maxImageMb = v;
                  this.visionDirty = true;
                },
              })
              SettingsChipRow({
                label: '输出格式',
                description: 'JPEG 体积最小（推荐）；自动 = 有透明通道保留 PNG。',
                value: this.outputFormat,
                options: this.formats(),
                labels: this.formatLabels(),
                busy: this.savingVision,
                theme: this.theme,
                onSelect: (v: string) => {
                  this.outputFormat = v;
                  this.visionDirty = true;
                },
              })
              SettingsNumberRow({
                label: 'JPEG 质量',
                description: '85 是体积与质量的平衡点；70 更小但有可见压缩痕迹。留空 = 默认 85。',
                value: this.jpegQuality,
                placeholder: '85',
                suffix: '',
                busy: this.savingVision,
                theme: this.theme,
                onInput: (v: string) => {
                  this.jpegQuality = v;
                  this.visionDirty = true;
                },
              })

              Row() {
                Text(this.savingVision ? '保存中…' : '保存')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().onAccent)
                  .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                  .backgroundColor(this.pal().accent)
                  .borderRadius(R_LG)
                  .opacity(this.visionDirty && !this.savingVision ? 1 : 0.4)
                  .onClick(() => {
                    void this.saveVision();
                  })
              }
              .width('100%')
              .justifyContent(FlexAlign.End)
              .padding({ top: SP_1, right: SP_2 })
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })
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
