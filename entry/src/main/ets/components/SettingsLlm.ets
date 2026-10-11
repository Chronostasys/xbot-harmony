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
  AddSubscriptionParams, countModelsForSub, DefaultSubscriptionParams, GetSettingsParams, IdParams,
  isSubscriptionEnabled, LlmConcurrencyParams, ModelEntryRow, readableRpcError, RemoveModelParams,
  rpc, RpcMethod, SetModelEnabledParams, SetSettingParams, SETTINGS_NS_CLI, SubscriptionBody,
  SubscriptionEnabledParams, SubscriptionRow, ThinkingModeParams, UpdateSubscriptionParams,
  UpsertModelParams,
} from '../core/rpc';
import {
  apiKeyForSubmit, clampConcurrency, concurrencyFrom, concurrencyStep, editSubscriptionForm, fmtTokens,
  formatTierValue, filterSubscriptions, isModelDisabled, isValidModelName, isTierEntryCurrent,
  LLM_API_TYPE_LABELS, LLM_API_TYPES, LLM_CONCURRENCY_MAX, LLM_CONCURRENCY_MIN, LLM_PROVIDER_IDS,
  LLM_PROVIDER_LABELS, LLM_PROVIDER_OPENAI, llmProviderUrl, modelStatusLabel, modelsForSub,
  newSubscriptionForm,
  normalizeApiTypeForSubmit, normalizeModelName, subscriptionFormError, SubscriptionForm,
  subscriptionFormValid, thinkDbFromDisplay, thinkDisplayFromDb, thinkHint, thinkLabel, THINK_OPTIONS,
  tierDisplayText, tierHint, tierKey, tierLabel, tierPickerEntries, TIERS, TIER_UNSET_TEXT, tierValues,
} from '../core/settings';
import { resolveUpdateBody } from '../core/llmcfg';
import {
  SettingsChipRow, SettingsErrorBar, SettingsPanelHeader, SettingsSubCard, SettingsTextFieldRow,
} from './SettingsRows';

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
  /** 思考模式（**显示值**：auto/think/think-max/disabled）。 */
  @State private thinking: string = 'auto';
  /** 并发（生效值）。 */
  @State private concurrency: number = 5;
  /** 推理设置写入中。 */
  @State private inferenceBusy: boolean = false;
  /** 新增/编辑订阅表单是否展开。 */
  @State private formOpen: boolean = false;
  /** 表单当前值（新增/编辑共用；详见 `core/settings.ets` 的 `SubscriptionForm`）。 */
  @State private form: SubscriptionForm = new SubscriptionForm();
  /** true = 编辑既有订阅；false = 新增。 */
  @State private formEditing: boolean = false;
  /** 表单提交中。 */
  @State private formBusy: boolean = false;
  /** 待确认删除的订阅 id（`''` = 无）。 */
  @State private deleteId: string = '';
  /** 正在管理模型的订阅 id（`''` = 未展开）。 */
  @State private manageSubId: string = '';
  /** 新模型名输入草稿。 */
  @State private modelDraft: string = '';
  /** 正在操作的模型键（`subId|model`；用于禁用态）。 */
  @State private modelBusy: string = '';
  /** 订阅搜索词。 */
  @State private subQuery: string = '';

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
      // 思考模式 / 并发走**专用 RPC**（`rpc_table.go:690,714`；与 web `useLLMSettings.ts:106-112` 同源）：
      // 并发读走它才拿得到**生效值**（`get_settings` 对未设置过的 `max_concurrency` **不下发**，
      // 见 `rpc_table.go:486-492` 的注释），思考模式读走它拿的是**库内规范形态**（空串 = auto）。
      const mode: string = await rpc<string>(this.http, RpcMethod.getUserThinkingMode);
      this.thinking = thinkDisplayFromDb(mode);
      const conc: number = await rpc<number>(this.http, RpcMethod.getLlmConcurrency);
      this.concurrency = concurrencyFrom(conc);
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

  /**
   * 写思考模式：**显示值 → 库值**（`think`→`enabled`，`auto` 原样交给服务端归一成空串）。
   *
   * 服务端 `SetUserThinkingMode`（`agent/llm_config_handler.go:629-643`）会做
   * `auto → ""` 归一 + `InvalidateSender` —— 那正是**不能**用 `set_setting` 代劳的原因
   * （`set_setting` 不做归一会把字面 `"auto"` 落库，而域里没有它，见 `setting_keys.go:105`）。
   */
  private async commitThinking(display: string): Promise<void> {
    if (this.inferenceBusy) {
      return;
    }
    this.inferenceBusy = true;
    const prev: string = this.thinking;
    this.thinking = display;
    try {
      await rpc<void>(this.http, RpcMethod.setUserThinkingMode,
        new ThinkingModeParams(thinkDbFromDisplay(display)));
      this.error = '';
    } catch (e) {
      this.thinking = prev;   // 失败回滚，绝不留一个"看起来已生效"的假值
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.inferenceBusy = false;
      const mode: string = await rpc<string>(this.http, RpcMethod.getUserThinkingMode);
      this.thinking = thinkDisplayFromDb(mode);
    }
  }

  /** 写并发：`set_llm_concurrency {personal}`（域 1-100，见 `setting_keys.go:154`）。 */
  private async commitConcurrency(next: number): Promise<void> {
    if (this.inferenceBusy) {
      return;
    }
    const want: number = clampConcurrency(next);
    this.inferenceBusy = true;
    const prev: number = this.concurrency;
    this.concurrency = want;
    try {
      await rpc<void>(this.http, RpcMethod.setLlmConcurrency, new LlmConcurrencyParams(want));
      this.error = '';
    } catch (e) {
      this.concurrency = prev;
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.inferenceBusy = false;
      const conc: number = await rpc<number>(this.http, RpcMethod.getLlmConcurrency);
      this.concurrency = concurrencyFrom(conc);
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

  // ── 订阅 CRUD（新增 / 编辑 / 删除）────────────────────────────────────────────
  //
  // 逐条对齐 web：表单默认与校验见 `core/settings.ets` 顶部注释；提交构造见
  // `SubFormModal`（`llm-console.tsx:481-486`）→ `addSubscription`/`updateSubscription`
  // （`useLLMSettings.ts:171-234`）。⛔ 编辑态 api_key 若仍是掩码 ⇒ 归空串交服务端保留真值。

  private cloneForm(v: SubscriptionForm): SubscriptionForm {
    const f: SubscriptionForm = new SubscriptionForm();
    f.id = v.id;
    f.name = v.name;
    f.provider = v.provider;
    f.baseUrl = v.baseUrl;
    f.apiKey = v.apiKey;
    f.model = v.model;
    f.apiType = v.apiType;
    return f;
  }

  /** 打开「新增订阅」表单（web `SettingsLLM.tsx:267`）。 */
  private openAdd(): void {
    this.form = newSubscriptionForm();
    this.formEditing = false;
    this.formOpen = true;
    this.error = '';
  }

  /** 打开「编辑订阅」表单（web `SettingsLLM.tsx:427-430`）。 */
  private openEdit(s: SubscriptionRow): void {
    this.form = editSubscriptionForm(s);
    this.formEditing = true;
    this.formOpen = true;
    this.error = '';
  }

  /** 提交表单：`add_subscription` / `update_subscription`。 */
  private async submitForm(): Promise<void> {
    if (this.formBusy) {
      return;
    }
    const editing: boolean = this.formEditing;
    if (!subscriptionFormValid(this.form, editing)) {
      this.error = subscriptionFormError(this.form, editing);
      return;
    }
    this.formBusy = true;
    const body: SubscriptionBody = new SubscriptionBody();
    body.name = this.form.name.trim();
    body.provider = this.form.provider;
    body.base_url = this.form.baseUrl.trim();
    body.api_key = apiKeyForSubmit(this.form.apiKey);
    body.model = this.form.model.trim();
    body.api_type = normalizeApiTypeForSubmit(this.form.provider, this.form.apiType);
    // ⛔ P0（真数据丢失）：表单**不含** `max_output_tokens`/`thinking_mode`，服务端对这两字段
    // 是 always-accept（0/'' 会直接落库覆盖真值）⇒ 编辑态必须从既有订阅**继承**这两个字段，
    // 否则每次从原生保存编辑都会把它们清零。逐字对齐 web `useLLMSettings.ts:219-220` 的
    // `?? existing?.X ?? 默认` 合并语义（见 core/llmcfg.ets）。
    const submitBody: SubscriptionBody = editing
      ? resolveUpdateBody(body, this.subs, this.form.id)
      : body;
    try {
      if (editing) {
        await rpc<void>(this.http, RpcMethod.updateSubscription,
          new UpdateSubscriptionParams(this.form.id, submitBody));
      } else {
        await rpc<void>(this.http, RpcMethod.addSubscription, new AddSubscriptionParams(body));
      }
      this.error = '';
      this.formOpen = false;
      this.deleteId = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.formBusy = false;
      await this.load();
    }
  }

  /** 删除订阅（web `SettingsLLM.tsx:137-141`；先弹确认）。 */
  private async doDelete(subId: string): Promise<void> {
    if (this.deleteId !== subId) {
      this.deleteId = subId;
      return;
    }
    this.busy = subId;
    try {
      await rpc<void>(this.http, RpcMethod.removeSubscription, new IdParams(subId));
      this.error = '';
      this.deleteId = '';
      if (this.manageSubId === subId) {
        this.manageSubId = '';
      }
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  // ── 模型 CRUD（新增 / 启停 / 删除）───────────────────────────────────────────
  //
  // 逐条对齐 web：`AddModelModal`（`llm-console.tsx:298-321`）→ `upsertModel`；
  // `toggleModel`（`SettingsLLM.tsx:142-145`）→ `setModelEnabled`；
  // `removeModelById`（`SettingsLLM.tsx:146-149`）→ `removeModel`。

  private modelKey(subId: string, model: string): string {
    return `${subId}|${model}`;
  }

  private async addModel(subId: string): Promise<void> {
    const name: string = normalizeModelName(this.modelDraft);
    if (!isValidModelName(name)) {
      this.error = '请输入模型名';
      return;
    }
    this.modelBusy = this.modelKey(subId, name);
    try {
      await rpc<void>(this.http, RpcMethod.upsertModel, new UpsertModelParams(subId, name, 0, 0, ''));
      this.error = '';
      this.modelDraft = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.modelBusy = '';
      await this.load();
    }
  }

  private async toggleModel(subId: string, model: string, enabled: boolean): Promise<void> {
    this.modelBusy = this.modelKey(subId, model);
    try {
      await rpc<void>(this.http, RpcMethod.setModelEnabled,
        new SetModelEnabledParams(subId, model, enabled));
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.modelBusy = '';
      await this.load();
    }
  }

  private async removeModelEntry(subId: string, model: string): Promise<void> {
    this.modelBusy = this.modelKey(subId, model);
    try {
      await rpc<void>(this.http, RpcMethod.removeModel, new RemoveModelParams(subId, model));
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.modelBusy = '';
      await this.load();
    }
  }

  /** 刷新模型条目（`refresh_model_entries`；web `SettingsLLM.tsx:255`）。 */
  private async refreshModels(): Promise<void> {
    this.loading = true;
    try {
      const entries: ModelEntryRow[] = await rpc<ModelEntryRow[]>(this.http, RpcMethod.refreshModelEntries);
      this.entries = entries !== undefined && entries !== null ? entries : [];
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.loading = false;
    }
  }

  /** 展开/收起某订阅的模型管理（`''` = 收起）。 */
  private toggleManage(subId: string): void {
    this.manageSubId = this.manageSubId === subId ? '' : subId;
    this.modelDraft = '';
  }

  private visibleSubs(): SubscriptionRow[] {
    return filterSubscriptions(this.subs, this.entries, this.subQuery);
  }

  /**
   * 某订阅下模型状态的「签名」——供 `ForEach` key 用。
   *
   * ⛔ 为什么必须进 key：ArkUI `ForEach` 对**未变 key** 的项**不重建**（复用旧子树）。
   * 模型启停只改 `entries`（数组引用变了），条目 key 若不含状态 ⇒ 复用旧子树 ⇒ **状态药丸不刷新**。
   * 把每模型的状态拼进 key，状态一变 key 就变 ⇒ 强制重建。
   */
  private subModelSig(subId: string): string {
    const ms: ModelEntryRow[] = modelsForSub(this.entries, subId);
    let sig: string = '';
    for (let i = 0; i < ms.length; i++) {
      const st: string | undefined = ms[i].status;
      sig += `${ms[i].model}:${st !== undefined && st !== null ? st : ''};`;
    }
    return sig;
  }

  build() {
    Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '模型订阅',
        subtitle: '启停订阅只影响模型选择器与可用范围，凭据保留；「默认」用于新会话的初始模型。',
        theme: this.theme,
      })

      // ── 工具栏：搜索 / 刷新模型 / 新增订阅（web `SettingsLLM.tsx:254-271`）──────
      Row({ space: SP_2 }) {
        TextInput({ text: this.subQuery, placeholder: '搜索订阅 / 模型' })
          .layoutWeight(1)
          .height(34)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textPrimary)
          .placeholderColor(this.pal().textMuted)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .onChange((v: string) => {
            this.subQuery = v;
          })
        Text('刷新模型')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textSecondary)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            void this.refreshModels();
          })
        Text('新增订阅')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().accentSoft)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.openAdd();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }

      // ── 新增 / 编辑订阅表单（web `SubFormModal`，`llm-console.tsx:403-494`）────────
      if (this.formOpen) {
        Column({ space: SP_1 }) {
          Text(this.formEditing ? '编辑订阅' : '新增订阅')
            .fontSize(FS_BODY)
            .fontColor(this.pal().textPrimary)
            .width('100%')
          Text('协议、Base URL、凭据与默认模型；编辑时凭据留空或保持掩码则不改动。')
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .width('100%')

          SettingsChipRow({
            label: '协议',
            description: '仅支持 OpenAI / Anthropic（其它值按 OpenAI 处理）。',
            value: this.form.provider,
            options: LLM_PROVIDER_IDS,
            labels: LLM_PROVIDER_LABELS,
            busy: this.formBusy,
            theme: this.theme,
            onSelect: (v: string) => {
              const f: SubscriptionForm = this.cloneForm(this.form);
              f.provider = v;
              f.baseUrl = llmProviderUrl(v);   // 切协议 ⇒ base_url 重置为该协议默认（web :421-424）
              this.form = f;
            },
          })

          if (this.form.provider === LLM_PROVIDER_OPENAI) {
            SettingsChipRow({
              label: 'API 类型',
              description: 'OpenAI 专用：Chat Completions（默认）或 Responses。',
              value: this.form.apiType,
              options: LLM_API_TYPES,
              labels: LLM_API_TYPE_LABELS,
              busy: this.formBusy,
              theme: this.theme,
              onSelect: (v: string) => {
                const f: SubscriptionForm = this.cloneForm(this.form);
                f.apiType = v;
                this.form = f;
              },
            })
          }

          SettingsTextFieldRow({
            label: '名称', description: '', value: this.form.name, placeholder: '如 My OpenAI',
            password: false, busy: this.formBusy, theme: this.theme,
            onInput: (v: string) => {
              const f: SubscriptionForm = this.cloneForm(this.form);
              f.name = v;
              this.form = f;
            },
          })
          SettingsTextFieldRow({
            label: 'Base URL', description: '', value: this.form.baseUrl, placeholder: 'https://…',
            password: false, busy: this.formBusy, theme: this.theme,
            onInput: (v: string) => {
              const f: SubscriptionForm = this.cloneForm(this.form);
              f.baseUrl = v;
              this.form = f;
            },
          })
          SettingsTextFieldRow({
            label: 'API Key',
            description: this.formEditing ? '留空或保持掩码则保留原凭据（服务端不覆盖）' : '新增订阅必填',
            value: this.form.apiKey, placeholder: this.formEditing ? '保持掩码则不修改' : 'sk-…',
            password: true, busy: this.formBusy, theme: this.theme,
            onInput: (v: string) => {
              const f: SubscriptionForm = this.cloneForm(this.form);
              f.apiKey = v;
              this.form = f;
            },
          })
          SettingsTextFieldRow({
            label: '默认模型', description: '', value: this.form.model, placeholder: 'model-name',
            password: false, busy: this.formBusy, theme: this.theme,
            onInput: (v: string) => {
              const f: SubscriptionForm = this.cloneForm(this.form);
              f.model = v;
              this.form = f;
            },
          })

          if (!subscriptionFormValid(this.form, this.formEditing)) {
            Text(subscriptionFormError(this.form, this.formEditing))
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().warn)
              .width('100%')
          }

          Row({ space: SP_2 }) {
            Text(this.formBusy ? '保存中…' : '保存')
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().onAccent)
              .padding({ left: SP_4, right: SP_4, top: SP_2, bottom: SP_2 })
              .backgroundColor(this.pal().accent)
              .borderRadius(R_LG)
              .opacity(this.formBusy || !subscriptionFormValid(this.form, this.formEditing) ? 0.5 : 1)
              .onClick(() => {
                void this.submitForm();
              })
            Text('取消')
              .fontSize(FS_CAPTION)
              .fontColor(this.pal().textSecondary)
              .padding({ left: SP_4, right: SP_4, top: SP_2, bottom: SP_2 })
              .backgroundColor(this.pal().surfaceAlt)
              .borderRadius(R_LG)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.formOpen = false;
              })
          }
          .width('100%')
        }
        .width('100%')
        .padding(SP_4)
        .backgroundColor(this.pal().surface)
        .borderRadius(R_XL)
        .border({ width: 1, color: this.pal().border })
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
            // ── 模型推理：思考模式 + 最大并发 ──
            // web `SettingsLLM.tsx:278-303`（thinkingMode 四档开关 + maxConcurrency −/＋ 步进）。
            // 读写走专用 RPC（`get/set_user_thinking_mode`、`get/set_llm_concurrency`）。
            Column({ space: SP_2 }) {
              Text('模型推理')
                .fontSize(FS_BODY)
                .fontColor(this.pal().textPrimary)
                .width('100%')

              Text('思考模式')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textPrimary)
                .width('100%')
              Text(thinkHint(this.thinking))
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textMuted)
                .width('100%')
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(THINK_OPTIONS, (mode: string) => {
                  Text(thinkLabel(mode))
                    .fontSize(FS_CAPTION)
                    .fontColor(mode === this.thinking ? this.pal().onAccent : this.pal().textSecondary)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(mode === this.thinking ? this.pal().accent : this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: mode === this.thinking ? this.pal().accent : this.pal().border })
                    .margin({ right: SP_2, bottom: SP_2 })
                    .opacity(this.inferenceBusy ? 0.5 : 1)
                    .onClick(() => {
                      if (!this.inferenceBusy && mode !== this.thinking) {
                        void this.commitThinking(mode);
                      }
                    })
                }, (mode: string) => `think|${mode}`)
              }
              .width('100%')

              Row({ space: SP_2 }) {
                Column({ space: 2 }) {
                  Text('最大并发')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textPrimary)
                    .width('100%')
                  Text(`同时进行的 LLM 调用 / 会话回合上限（${LLM_CONCURRENCY_MIN}-${LLM_CONCURRENCY_MAX}）`)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textMuted)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Row({ space: SP_2 }) {
                  Text('−')
                    .fontSize(FS_BODY)
                    .fontColor(this.pal().textPrimary)
                    .padding({ left: SP_3, right: SP_3, top: SP_1, bottom: SP_1 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .opacity(this.inferenceBusy || this.concurrency <= LLM_CONCURRENCY_MIN ? 0.4 : 1)
                    .onClick(() => {
                      if (!this.inferenceBusy && this.concurrency > LLM_CONCURRENCY_MIN) {
                        void this.commitConcurrency(concurrencyStep(this.concurrency, -1));
                      }
                    })
                  Text(`${this.concurrency}`)
                    .fontSize(FS_BODY)
                    .fontFamily('monospace')
                    .fontColor(this.pal().textPrimary)
                    .width(36)
                    .textAlign(TextAlign.Center)
                  Text('＋')
                    .fontSize(FS_BODY)
                    .fontColor(this.pal().textPrimary)
                    .padding({ left: SP_3, right: SP_3, top: SP_1, bottom: SP_1 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .opacity(this.inferenceBusy || this.concurrency >= LLM_CONCURRENCY_MAX ? 0.4 : 1)
                    .onClick(() => {
                      if (!this.inferenceBusy && this.concurrency < LLM_CONCURRENCY_MAX) {
                        void this.commitConcurrency(concurrencyStep(this.concurrency, 1));
                      }
                    })
                }
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })

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

            if (this.visibleSubs().length === 0) {
              Text(this.subQuery.length > 0 ? '没有匹配的订阅' : '还没有任何订阅。')
                .fontSize(FS_CAPTION)
                .fontColor(this.pal().textMuted)
                .width('100%')
            }
            ForEach(this.visibleSubs(), (s: SubscriptionRow) => {
              Column({ space: SP_2 }) {
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

                // ── 操作行：编辑 / 管理模型 / 删除（web `ActionSheet`，`SettingsLLM.tsx:540-548`）──
                Row({ space: SP_2 }) {
                  Text('编辑')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().accentSoft)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().borderStrong })
                    .opacity(this.busy === s.id ? 0.5 : 1)
                    .onClick(() => {
                      this.openEdit(s);
                    })
                  Text(this.manageSubId === s.id ? '收起模型' : '管理模型')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.pal().textSecondary)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().border })
                    .onClick(() => {
                      this.toggleManage(s.id);
                    })
                  Text(this.deleteId === s.id ? '确认删除' : '删除')
                    .fontSize(FS_CAPTION)
                    .fontColor(this.deleteId === s.id ? this.pal().onAccent : this.pal().dangerText)
                    .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                    .backgroundColor(this.deleteId === s.id ? this.pal().statusError : this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().border })
                    .opacity(this.busy === s.id ? 0.5 : 1)
                    .onClick(() => {
                      void this.doDelete(s.id);
                    })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)

                // ── 模型管理（展开态）：登记 / 启停 / 删除（web `detailModels`，`SettingsLLM.tsx:455-482`）──
                if (this.manageSubId === s.id) {
                  Column({ space: SP_2 }) {
                    Row({ space: SP_2 }) {
                      TextInput({ text: this.modelDraft, placeholder: '模型名，如 gpt-5.2-turbo' })
                        .layoutWeight(1)
                        .height(34)
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textPrimary)
                        .placeholderColor(this.pal().textMuted)
                        .backgroundColor(this.pal().surfaceAlt)
                        .borderRadius(R_LG)
                        .border({ width: 1, color: this.pal().border })
                        .onChange((v: string) => {
                          this.modelDraft = v;
                        })
                      Text('登记')
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().accentSoft)
                        .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
                        .backgroundColor(this.pal().surfaceAlt)
                        .borderRadius(R_LG)
                        .border({ width: 1, color: this.pal().borderStrong })
                        .opacity(isValidModelName(this.modelDraft) ? 1 : 0.5)
                        .onClick(() => {
                          void this.addModel(s.id);
                        })
                    }
                    .width('100%')
                    .alignItems(VerticalAlign.Center)

                    if (modelsForSub(this.entries, s.id).length === 0) {
                      Text('该订阅下还没有模型，先「刷新模型」或手动登记。')
                        .fontSize(FS_CAPTION)
                        .fontColor(this.pal().textMuted)
                        .width('100%')
                    } else {
                      ForEach(modelsForSub(this.entries, s.id), (e: ModelEntryRow) => {
                        Row({ space: SP_2 }) {
                          Text(modelStatusLabel(e.status))
                            .fontSize(FS_CAPTION)
                            .fontColor(isModelDisabled(e.status) ? this.pal().textMuted : this.pal().successText)
                          Text(e.model)
                            .fontSize(FS_CAPTION)
                            .fontFamily('monospace')
                            .fontColor(isModelDisabled(e.status) ? this.pal().textMuted : this.pal().textPrimary)
                            .layoutWeight(1)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                          Text(isModelDisabled(e.status) ? '启用' : '禁用')
                            .fontSize(FS_CAPTION)
                            .fontColor(this.pal().accentSoft)
                            .padding({ left: SP_2, right: SP_2 })
                            .opacity(this.modelBusy === this.modelKey(s.id, e.model) ? 0.5 : 1)
                            .onClick(() => {
                              void this.toggleModel(s.id, e.model, isModelDisabled(e.status));
                            })
                          Text('删除')
                            .fontSize(FS_CAPTION)
                            .fontColor(this.pal().dangerText)
                            .padding({ left: SP_2, right: SP_2 })
                            .opacity(this.modelBusy === this.modelKey(s.id, e.model) ? 0.5 : 1)
                            .onClick(() => {
                              void this.removeModelEntry(s.id, e.model);
                            })
                        }
                        .width('100%')
                        .alignItems(VerticalAlign.Center)
                        .padding({ top: SP_1, bottom: SP_1 })
                      }, (e: ModelEntryRow) => `m|${s.id}|${e.model}|${e.status !== undefined ? e.status : ''}`)
                    }
                  }
                  .width('100%')
                  .padding(SP_3)
                  .backgroundColor(this.pal().surfaceAlt)
                  .borderRadius(R_LG)
                  .border({ width: 1, color: this.pal().border })
                }
              }
              .width('100%')
            }, (s: SubscriptionRow) => `sub|${s.id}|${s.active === true ? 'd' : '-'}|${s.enabled === true ? 'on' : 'off'}|${this.manageSubId === s.id ? 'M' : '-'}|${this.deleteId === s.id ? 'D' : '-'}|${this.busy === s.id ? 'B' : '-'}|${this.subModelSig(s.id)}`)
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
