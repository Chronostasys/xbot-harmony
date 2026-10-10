/**
 * SettingsLlm —— LLM 订阅面板（设置 → 模型），对齐 web
 * `web/src/components/settings/SettingsLLM.tsx` 的「列表 + 启停 + 设默认」子集。
 *
 * 本轮范围：**读 + 启停 + 设默认**（不做完整 CRUD / 导入导出）。
 *
 * 契约（逐条核对 web `agent/api.ts:680-796` + 服务端 `serverapp/rpc_table.go`）：
 *   · `list_subscriptions` `{}` → `[]protocol.Subscription`（web `api.ts:680-682` / 服务端 `rpc_table.go:815`）
 *     字段见 `protocol/events.go:327-345`：id/name/provider/base_url/api_key/model/…/active/enabled
 *   · `list_all_model_entries` `{}` → `[]protocol.ModelEntry`（web `api.ts:794-796` / `rpc_table.go:754-761`）
 *   · `set_subscription_enabled` `{sub_id,enabled}` → void（web `api.ts:755-757` / `rpc_table.go:672-677`）
 *   · `set_default_subscription` `{id,chat_id}` → void（web `api.ts:751-753` / `rpc_table.go:2696-2705`）
 *
 * ⛔ **密钥**：读路径 `api_key` 是**掩码**（`abcd****`；服务端 `rpc_table.go:2983` → `server.go:142`
 *    `maskAPIKey`）。本面板**只读展示**，不做回填、不做提交（掩码回填会把掩码写成真密钥）。
 *
 * ⚠️ **数据来源**：原生既有的 `ModelSheet` 走旧 REST `GET /api/llm-config`，与 `list_all_model_entries`
 *    同源但**字段形状不同**（旧接口是 `{subscriptions, models, max_context}` 的自定义形态）。
 *    本面板**统一走 RPC**，与 web 同源同字段（见 `core/rpc.ets` 顶部注释）。
 *
 * ⛔ **不用带参全局 `@Builder`**（参数快照 ⇒ 不重建）；卡片是真 `@Component` + `@Prop`。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, FS_TITLE, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  countModelsForSub, DefaultSubscriptionParams, defaultSubscriptionId, displayApiKey,
  isSubscriptionEnabled, ModelEntryRow, providerLine, readableRpcError, rpc, RpcMethod,
  stripScheme, SubscriptionEnabledParams, SubscriptionRow,
} from '../core/rpc';

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

@Component
export struct SettingsLlm {
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private subs: SubscriptionRow[] = [];
  @State private entries: ModelEntryRow[] = [];
  @State private loading: boolean = true;
  @State private error: string = '';
  /** 正在操作的订阅 id（切换开关 / 设默认）。 */
  @State private busy: string = '';

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const subs: SubscriptionRow[] = await rpc<SubscriptionRow[]>(this.http, RpcMethod.listSubscriptions);
      this.subs = subs !== undefined && subs !== null ? subs : [];
      // 模型条目用于「N 个模型」计数 —— 与 web 的 load() 同一对 RPC（useLLMSettings.ts:106-112）。
      const entries: ModelEntryRow[] = await rpc<ModelEntryRow[]>(this.http, RpcMethod.listAllModelEntries);
      this.entries = entries !== undefined && entries !== null ? entries : [];
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
      this.subs = [];
      this.entries = [];
    } finally {
      this.loading = false;
    }
  }

  /** 启停订阅：成功后用服务端权威状态刷新（失败也刷新，让开关回到真实值）。 */
  private async toggleEnabled(subId: string, next: boolean): Promise<void> {
    this.busy = subId;
    try {
      await rpc<void>(this.http, RpcMethod.setSubscriptionEnabled,
        new SubscriptionEnabledParams(subId, next));
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  /** 设为默认（全局）：服务端字段是 `id`（不是 sub_id），`chat_id` 空 = 全局默认。 */
  private async setDefault(subId: string): Promise<void> {
    this.busy = subId;
    try {
      await rpc<void>(this.http, RpcMethod.setDefaultSubscription, new DefaultSubscriptionParams(subId));
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  build() {
    Column({ space: SP_3 }) {
      Text('模型订阅')
        .fontSize(FS_TITLE)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      Text('启停订阅只影响模型选择器与可用范围，凭据保留；「默认」用于新会话的初始模型。')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')

      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
          .padding(SP_3)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_MD)
      }

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.subs.length === 0 && this.error.length === 0) {
        Text('还没有任何订阅。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            ForEach(this.subs, (s: SubscriptionRow) => {
              SettingsSubCard({
                subId: s.id,
                name: s.name,
                provider: s.provider,
                baseUrl: s.base_url,
                model: s.model,
                apiKey: s.api_key,
                isOn: isSubscriptionEnabled(s),
                isDefault: s.active === true,
                modelCount: countModelsForSub(this.entries, s.id),
                busy: this.busy === s.id,
                theme: this.theme,
                onToggle: (subId: string, next: boolean) => {
                  void this.toggleEnabled(subId, next);
                },
                onSetDefault: (subId: string) => {
                  void this.setDefault(subId);
                },
              })
            }, (s: SubscriptionRow) => `sub|${s.id}|${s.active === true ? 'd' : '-'}|${s.enabled === true ? 'on' : 'off'}`)
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
