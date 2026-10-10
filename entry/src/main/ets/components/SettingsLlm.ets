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
 * ⛔ **不用带参全局 `@Builder`**（参数快照 ⇒ 不重建）；卡片来自 `components/SettingsRows.ets`
 *    的 `SettingsSubCard`（真 `@Component` + `@Prop`，跨文件真实引用 ⇒ 不是孤儿）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  countModelsForSub, DefaultSubscriptionParams, GetSettingsParams, isSubscriptionEnabled,
  ModelEntryRow, readableRpcError, rpc, RpcMethod, SetSettingParams, SETTINGS_NS_CLI,
  SubscriptionEnabledParams, SubscriptionRow,
} from '../core/rpc';
import {
  formatTierValue, isTierEntryCurrent, tierDisplayText, tierHint, tierKey, tierLabel,
  tierPickerEntries, TIERS, TIER_UNSET_TEXT, tierValues,
} from '../core/settings';
import { SettingsErrorBar, SettingsPanelHeader, SettingsSubCard } from './SettingsRows';

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
  /** SubAgent 三档模型当前值（`tier_vanguard`/`tier_balance`/`tier_swift` → 原始串；空 = 未设置）。 */
  @State private tiers: Record<string, string> = {};
  /** 当前展开选择器的档位（`''` = 未展开）。 */
  @State private pickTier: string = '';
  /** 选择器里的搜索词。 */
  @State private tierQuery: string = '';
  /** 档位写入中。 */
  @State private tierBusy: boolean = false;

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  /** 当前搜索词下的可选模型（web `TierPickerModal` 的过滤，`llm-console.tsx:363-367`）。 */
  private pickerEntries(): ModelEntryRow[] {
    return tierPickerEntries(this.entries, this.tierQuery);
  }

  /** 某档当前值（空串 = 未设置）。 */
  private tierRaw(tier: string): string {
    const v: string | undefined = this.tiers[tier];
    return v !== undefined && v !== null ? v : '';
  }

  private subRefs(): SubscriptionRow[] {
    return this.subs;
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const subs: SubscriptionRow[] = await rpc<SubscriptionRow[]>(this.http, RpcMethod.listSubscriptions);
      this.subs = subs !== undefined && subs !== null ? subs : [];
      // 模型条目用于「N 个模型」计数与档位选择 —— 与 web 的 load() 同一对 RPC（useLLMSettings.ts:106-112）。
      const entries: ModelEntryRow[] = await rpc<ModelEntryRow[]>(this.http, RpcMethod.listAllModelEntries);
      this.entries = entries !== undefined && entries !== null ? entries : [];
      // 三档模型走**既有** get_settings（`useLLMSettings.ts:111,118-120` 同源同字段）。
      const settings: Record<string, string> = await rpc<Record<string, string>>(
        this.http, RpcMethod.getSettings, new GetSettingsParams(SETTINGS_NS_CLI));
      this.tiers = tierValues(settings);
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
      this.subs = [];
      this.entries = [];
      this.tiers = {};
    } finally {
      this.loading = false;
    }
  }

  /**
   * 设置某档模型：`set_setting {key:'tier_<档>', value:'subID|model'}`。
   *
   * 与 web `useLLMSettings.setTier`（`:424-441`）**同一 RPC、同一取值形态**
   * （服务端 `setting_keys.go:112-114`：`subID|model or plain model name`）。
   * 成功/失败都回读一次 `get_settings`，保证**以后端为准**（不做本地真值）。
   */
  private async setTierValue(tier: string, subId: string, model: string): Promise<void> {
    if (this.tierBusy) {
      return;
    }
    this.tierBusy = true;
    try {
      await rpc<void>(this.http, RpcMethod.setSetting,
        new SetSettingParams(SETTINGS_NS_CLI, tierKey(tier), formatTierValue(subId, model)));
      this.error = '';
      this.pickTier = '';
      this.tierQuery = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.tierBusy = false;
      const settings: Record<string, string> = await rpc<Record<string, string>>(
        this.http, RpcMethod.getSettings, new GetSettingsParams(SETTINGS_NS_CLI));
      this.tiers = tierValues(settings);
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
      SettingsPanelHeader({
        title: '模型订阅',
        subtitle: '启停订阅只影响模型选择器与可用范围，凭据保留；「默认」用于新会话的初始模型。',
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
      } else if (this.subs.length === 0 && this.error.length === 0) {
        Text('还没有任何订阅。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Scroll() {
          Column({ space: SP_3 }) {
            // ── SubAgent 三档模型 ──
            // web `SettingsLLM.tsx:307-327`（tier 区块）+ `llm-console.tsx:353-398`（选择弹窗）；
            // 读写复用**既有** `get_settings` / `set_setting`（`useLLMSettings.ts:111,428`）。
            Column({ space: SP_2 }) {
              Text('子代理模型档位')
                .fontSize(FS_BODY)
                .fontColor(this.pal().textPrimary)
                .width('100%')
              Text('按档位给子代理挑模型（跨订阅）；留空则由系统默认决定。')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textMuted)
                .width('100%')
              ForEach(TIERS, (tier: string) => {
                Column({ space: SP_1 }) {
                  Row({ space: SP_2 }) {
                    Column({ space: 2 }) {
                      Text(tierLabel(tier))
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textPrimary)
                        .width('100%')
                      Text(tierHint(tier))
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textMuted)
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%')
                    }
                    .alignItems(HorizontalAlign.Start)
                    .layoutWeight(1)

                    Text(this.tierRaw(tier).length > 0
                      ? tierDisplayText(this.tierRaw(tier), this.entries, this.subs)
                      : TIER_UNSET_TEXT)
                      .fontSize(FS_CAPTION)
                      .fontColor(this.tierRaw(tier).length > 0 ? this.pal().accentSoft : this.pal().textMuted)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .alignItems(VerticalAlign.Top)
                  .onClick(() => {
                    this.pickTier = this.pickTier === tier ? '' : tier;
                    this.tierQuery = '';
                  })

                  if (this.pickTier === tier) {
                    Column({ space: SP_1 }) {
                      TextInput({ text: this.tierQuery, placeholder: '搜索模型 / 订阅' })
                        .enabled(!this.tierBusy)
                        .width('100%')
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textPrimary)
                        .placeholderColor(this.pal().textMuted)
                        .backgroundColor(this.pal().surfaceAlt)
                        .borderRadius(R_LG)
                        .border({ width: 1, color: this.pal().border })
                        .onChange((v: string) => {
                          this.tierQuery = v;
                        })
                      if (this.pickerEntries().length === 0) {
                        Text('没有匹配的模型')
                          .fontSize(FS_CAPTION)
                          .fontColor(this.pal().textMuted)
                          .width('100%')
                          .padding(SP_2)
                      } else {
                        ForEach(this.pickerEntries(), (e: ModelEntryRow) => {
                          Row({ space: SP_2 }) {
                            Column({ space: 2 }) {
                              Text(e.model)
                                .fontSize(FS_CAPTION)
                                .fontColor(this.pal().textPrimary)
                                .fontFamily('monospace')
                                .maxLines(1)
                                .textOverflow({ overflow: TextOverflow.Ellipsis })
                                .width('100%')
                              Text(e.sub_name !== undefined && e.sub_name !== null ? e.sub_name : '')
                                .fontSize(FS_CAPTION)
                                .fontColor(this.pal().textMuted)
                                .maxLines(1)
                                .textOverflow({ overflow: TextOverflow.Ellipsis })
                                .width('100%')
                            }
                            .alignItems(HorizontalAlign.Start)
                            .layoutWeight(1)

                            if (isTierEntryCurrent(this.tierRaw(tier), e)) {
                              Text('当前')
                                .fontSize(FS_CAPTION)
                                .fontColor(this.pal().onAccent)
                                .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                                .backgroundColor(this.pal().accent)
                                .borderRadius(R_LG)
                            }
                          }
                          .width('100%')
                          .alignItems(VerticalAlign.Center)
                          .padding({ top: SP_1, bottom: SP_1 })
                          .opacity(this.tierBusy ? 0.5 : 1)
                          .onClick(() => {
                            void this.setTierValue(tier, e.sub_id !== undefined ? e.sub_id : '', e.model);
                          })
                        }, (e: ModelEntryRow) => `te|${tier}|${e.sub_id !== undefined ? e.sub_id : ''}|${e.model}`)
                      }
                    }
                    .width('100%')
                    .padding(SP_2)
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().border })
                  }
                }
                .width('100%')
                .padding({ top: SP_2, bottom: SP_2 })
              }, (tier: string) => `tierrow|${tier}`)
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

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
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
