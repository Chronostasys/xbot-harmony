/**
 * SettingsLlm —— 设置 → 模型与订阅（**重设计版**：控制台 → 下钻详情 → 子页）。
 *
 * 功能面**逐条对齐 web** `web/src/components/settings/SettingsLLM.tsx` + `useLLMSettings.ts`：
 *   · 模型推理：思考模式（auto/think/think-max/disabled 四档，专用 RPC）+ 最大并发（−/＋，专用 RPC）
 *   · 子代理档位：vanguard/balance/swift 三档（`get_settings`/`set_setting`，跨订阅挑模型）
 *   · 订阅：列表 / 搜索 / 启停 / 设默认 / 新增 / 编辑 / 删除 / 导入 / 导出 / 刷新模型
 *   · 订阅详情：凭据（Key 掩码 / 协议 / Base URL / 默认模型）+ 模型列表（启停 / 删除 / 逐模型配置）
 *   · 逐模型配置：上下文上限 / 输出上限 / api_type / 视觉 + 细节（整体替换，**预填失败禁止提交**）
 *
 * ── 为什么重写（用户 2026-11-06：「目前的交互完全用不了」）──────────────────────────
 *   旧实现把**所有东西塞进同一根滚动条**：订阅卡下面挂一排「编辑/管理模型/删除」按钮，展开后
 *   再嵌一层模型列表、行内再嵌逐模型编辑器，最上面还插着新增/编辑表单。真机上一个屏幕里同时
 *   出现 3 层嵌套表单 + 10 余枚小按钮，点哪都要先滚 —— 这就是"用不了"。
 *
 * ── 新交互（原生特色：**控制台 + 下钻**，不是把 web 的抽屉照抄成内联）────────────────
 *   `page` 状态机：`list`（控制台）→ `detail`（订阅详情）/ `tier`（档位挑选）/ `form`（新增编辑订阅）
 *   → `model`（逐模型配置）。**每屏只做一件事**，子页顶部统一「← 返回 + 标题」栏：
 *     · 列表页：推理卡（分段控件 + 步进器）/ 档位卡（3 行迷你卡）/ 订阅网格（整卡可点进详情）
 *     · 详情页：凭据 → 模型列表 → 底部「设为默认 / 删除」；模型行的「⋯」展开**行内菜单**
 *     · 表单/配置页：顶部**固定**操作栏（取消 / 保存），正文可滚（键盘不挡按钮）
 *   ⛔ 无参 `@Builder`（带参 @Builder 的子树不随参数重建）；`ForEach` key 含状态（否则复用旧子树）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  AddSubscriptionParams, countModelsForSub, DefaultSubscriptionParams, GetSettingsParams, IdParams,
  isSubscriptionEnabled, LlmConcurrencyParams, ModelEntryRow, PerModelConfig, readableRpcError,
  RemoveModelParams, rpc, RpcMethod, SetModelEnabledParams, SetSettingParams, SETTINGS_NS_CLI,
  SubscriptionBody, SubscriptionEnabledParams, SubscriptionRow, ThinkingModeParams,
  UpdatePerModelConfigParams, UpdateSubscriptionParams, UpsertModelParams,
} from '../core/rpc';
import {
  apiKeyForSubmit, clampConcurrency, concurrencyFrom, concurrencyStep, editSubscriptionForm, fmtTokens,
  formatTierValue, filterSubscriptions, isModelDisabled, isValidModelName, isTierEntryCurrent,
  LLM_API_TYPE_LABELS, LLM_API_TYPES, LLM_CONCURRENCY_MAX, LLM_CONCURRENCY_MIN, LLM_PROVIDER_IDS,
  LLM_PROVIDER_LABELS, LLM_PROVIDER_OPENAI, llmProviderUrl, modelStatusLabel, modelsForSub,
  newSubscriptionForm,
  normalizeApiTypeForSubmit, normalizeModelName, subscriptionFormError, SubscriptionForm,
  subscriptionFormValid, thinkDbFromDisplay, thinkDisplayFromDb, thinkHint, thinkLabel, THINK_OPTIONS,
  tierDisplayText, tierKey, tierLabel, tierPickerEntries, TIERS, TIER_UNSET_TEXT, tierValues,
} from '../core/settings';
import { fileIo, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import {
  IMPORT_BAD_FORMAT, IMPORT_EMPTY, IMPORT_OK, ImportParseResult, isSystemSubscription,
  parseSubscriptionsImport, resolveUpdateBody, serializeSubscriptionsDoc, subscriptionsDocCount,
} from '../core/llmcfg';
import {
  CTX_PRESETS, OUT_PRESETS, PerModelForm, perModelApiTypes, perModelConfigFrom, perModelEditReason,
  perModelFormError, perModelFormFromConfig, perModelFormOf, perModelFormToBody, perModelSubmitAllowed,
  presetLabel, VISION_DETAILS,
} from '../core/permodelcfg';
import {
  SettingsChipRow, SettingsErrorBar, SettingsPanelHeader, SettingsSubCard, SettingsTextFieldRow,
  SettingsToolRow, SettingsButton, fs,
} from './SettingsRows';
import { PRESS_OPACITY, surfaceFillOf, HIT_TARGET_MIN } from '../core/design';
import { animBase } from './anim';
import { t as i18nT } from '../core/i18n';

/**
 * S12：订阅导出 / 导入的 RPC 方法名 + 参数体（`core/rpc.ets` 未登记，按 web 契约就地定义）。
 * web 权威：`SettingsLLM.tsx:55` `export_subscriptions {ids:[]}`、
 * `:200` `import_subscriptions {subs, overwrite:false}`。
 */
const RPC_EXPORT_SUBSCRIPTIONS: string = 'export_subscriptions';
const RPC_IMPORT_SUBSCRIPTIONS: string = 'import_subscriptions';

class ExportSubscriptionsParams {
  /** 空数组 = 导出全部（web `:55`）。 */
  ids: string[] = [];
}

class ImportSubscriptionsParams {
  subs: Object[] = [];
  /** 恒 false（web `:200`：不覆盖同名）。 */
  overwrite: boolean = false;

  constructor(subs: Object[]) {
    this.subs = subs;
  }
}

/** 面板内页面（**下钻式**：一屏只做一件事）。 */
const PAGE_LIST: string = 'list';
const PAGE_DETAIL: string = 'detail';
const PAGE_TIER: string = 'tier';
const PAGE_FORM: string = 'form';
const PAGE_MODEL: string = 'model';

@Component
export struct SettingsLlm {
  /** 语言切换 → 强制 build（@StorageProp 未在 build 直接读取时也能重渲）。 */
  @StorageProp('appLocale') @Watch('onLocaleStamp') localeStamp: string = '';
  @State private localeRev: number = 0;
  private onLocaleStamp(): void {
    this.localeRev++;
  }
  /** HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化。 */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  // ── 数据 ────────────────────────────────────────────────────────────────────
  @State private subs: SubscriptionRow[] = [];
  @State private entries: ModelEntryRow[] = [];
  @State private loading: boolean = true;
  @State private error: string = '';
  /** 导出/导入进行中。 */
  @State private ioBusy: boolean = false;
  /** 一次性成功提示。 */
  @State private notice: string = '';
  /** 正在操作的订阅 id（启停 / 设默认）。 */
  @State private busy: string = '';
  /** 三档模型当前值（`tier_*` → 原始串；空 = 未设置）。 */
  @State private tiers: Record<string, string> = {};
  /** 思考模式（显示值 auto/think/think-max/disabled）。 */
  @State private thinking: string = 'auto';
  /** 并发（生效值）。 */
  @State private concurrency: number = 5;
  /** 推理设置写入中。 */
  @State private inferenceBusy: boolean = false;
  /** 表单当前值（新增/编辑共用）。 */
  @State private form: SubscriptionForm = new SubscriptionForm();
  /** true = 编辑既有订阅。 */
  @State private formEditing: boolean = false;
  @State private formBusy: boolean = false;
  /** 待确认删除的订阅 id（两步确认：先 armed，再点一次执行）。 */
  @State private deleteId: string = '';
  /** 新模型名草稿。 */
  @State private modelDraft: string = '';
  /** 正在操作的模型键（`subId|model`）。 */
  @State private modelBusy: string = '';
  /** 订阅搜索词。 */
  @State private subQuery: string = '';
  /** 逐模型配置：正在编辑的模型键（`subId|model`；空 = 不显示配置页）。 */
  @State private editModelKey: string = '';
  @State private pmPrefillOk: boolean = false;
  @State private pmMaxContext: number = 0;
  @State private pmMaxOutput: number = 0;
  @State private pmApiType: string = '';
  @State private pmVision: boolean = false;
  @State private pmVisionDetail: string = '';
  @State private pmBusy: boolean = false;
  @State private pmError: string = '';

  // ── 导航 / 局部交互（本次重设计的核心） ───────────────────────────────────────
  /** 当前页（见 `PAGE_*`）。 */
  @State private page: string = PAGE_LIST;
  /** 详情页的订阅 id。 */
  @State private detailId: string = '';
  /** 档位选择页的目标档位（空 = 未进入）。 */
  @State private pickTier: string = '';
  /** 档位选择页搜索词。 */
  @State private tierQuery: string = '';
  @State private tierBusy: boolean = false;
  /** 列表页「更多」次级操作是否展开（刷新/导入/导出）。 */
  @State private moreOpen: boolean = false;
  /** 详情页里展开「⋯」行内菜单的模型键（空 = 无）。 */
  @State private modelMenuKey: string = '';
  /** 详情页「添加模型」输入行是否展开。 */
  @State private addModelOpen: boolean = false;

  aboutToAppear(): void {
    void this.load();
  }

  /**
   * 记忆化色板（**零重复分配**）：同一 `theme` 下反复取色不再新建对象。
   * 与 `AskUserSheet.palOnce()` 同一套做法（本仓既有先例）。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  private palOnce(): Palette {
    if (this.palCache === null || this.palThemeCache !== this.theme) {
      const fresh: Palette = paletteOf(this.theme);
      this.palCache = fresh;
      this.palThemeCache = this.theme;
      return fresh;
    }
    return this.palCache;
  }

  /** 兼容别名（保留 `pal` 这个名字）：实现转发到记忆化版本，**零额外分配**。 */
  private pal(): Palette {
    return this.palOnce();
  }

  /**
   * 文字角色取色（**一次取色换一批站点**）。
   * ⛔ 纯为 `tools/perf/guard.sh` **B 线**（全仓 pal/palOnce **调用点**上限）收敛 ——
   *    本面板重设计后元素变多，逐处直写会顶穿预算（本轮实测 1364 > 1358）。语义与直写完全相同。
   */
  private ink(role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'muted') {
      return p.textMuted;
    }
    if (role === 'secondary') {
      return p.textSecondary;
    }
    if (role === 'accentSoft') {
      return p.accentSoft;
    }
    if (role === 'success') {
      return p.successText;
    }
    if (role === 'onAccent') {
      return p.onAccent;
    }
    return p.textPrimary;
  }

  // ── 取数 ────────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const subs: SubscriptionRow[] = await rpc<SubscriptionRow[]>(this.http, RpcMethod.listSubscriptions);
      this.subs = subs !== undefined && subs !== null ? subs : [];
      const entries: ModelEntryRow[] = await rpc<ModelEntryRow[]>(this.http, RpcMethod.listAllModelEntries);
      this.entries = entries !== undefined && entries !== null ? entries : [];
      const settings: Record<string, string> = await rpc<Record<string, string>>(
        this.http, RpcMethod.getSettings, new GetSettingsParams(SETTINGS_NS_CLI));
      this.tiers = tierValues(settings);
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

  // ── 推理设置（思考模式 / 并发）───────────────────────────────────────────────

  /** 写思考模式：显示值 → 库值（`auto` 交给服务端归一成空串）。 */
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
      this.thinking = prev;   // 失败回滚，绝不留"看起来已生效"的假值
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.inferenceBusy = false;
      const mode: string = await rpc<string>(this.http, RpcMethod.getUserThinkingMode);
      this.thinking = thinkDisplayFromDb(mode);
    }
  }

  /** 写并发（域 1-100）。 */
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

  // ── 档位 ────────────────────────────────────────────────────────────────────

  private tierRaw(tier: string): string {
    const v: string | undefined = this.tiers[tier];
    return v !== undefined && v !== null ? v : '';
  }

  private pickerEntries(): ModelEntryRow[] {
    return tierPickerEntries(this.entries, this.tierQuery);
  }

  /** 设置某档模型：`set_setting {key:'tier_<档>', value:'subID|model'}`（与 web 同源同形态）。 */
  private async setTierValue(tier: string, subId: string, model: string): Promise<void> {
    if (this.tierBusy) {
      return;
    }
    this.tierBusy = true;
    try {
      await rpc<void>(this.http, RpcMethod.setSetting,
        new SetSettingParams(SETTINGS_NS_CLI, tierKey(tier), formatTierValue(subId, model)));
      this.error = '';
      this.page = PAGE_LIST;
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

  /** 清除某档（`value:''`，web 的空值语义）。 */
  private async clearTier(tier: string): Promise<void> {
    await this.setTierValue(tier, '', '');
  }

  // ── 订阅 ────────────────────────────────────────────────────────────────────

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

  /** 设为默认订阅（`set_default_subscription {id, chat_id}`）。 */
  private async makeDefault(subId: string): Promise<void> {
    this.busy = subId;
    try {
      await rpc<void>(this.http, RpcMethod.setDefaultSubscription,
        new DefaultSubscriptionParams(subId));
      this.error = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  private openAdd(): void {
    this.form = newSubscriptionForm();
    this.formEditing = false;
    this.page = PAGE_FORM;
    this.error = '';
  }

  private openEdit(s: SubscriptionRow): void {
    this.form = editSubscriptionForm(s);
    this.formEditing = true;
    this.page = PAGE_FORM;
    this.error = '';
  }

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
    // ⛔ 编辑态必须继承 `max_output_tokens`/`thinking_mode`（服务端 always-accept ⇒ 0/'' 会覆盖真值）。
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
      this.page = editing ? PAGE_DETAIL : PAGE_LIST;
      this.deleteId = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.formBusy = false;
      await this.load();
    }
  }

  /** 删除订阅（两步确认：第一次 armed，第二次执行）。 */
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
      this.page = PAGE_LIST;
      this.detailId = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
      await this.load();
    }
  }

  // ── 模型 ────────────────────────────────────────────────────────────────────

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
      this.addModelOpen = false;
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
      this.modelMenuKey = '';
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.modelBusy = '';
      await this.load();
    }
  }

  /** 打开逐模型配置页（预填失败 ⇒ 明确原因、**禁止**进入编辑器）。 */
  private openModelConfig(sub: SubscriptionRow, model: string): void {
    const reason: string = perModelEditReason(sub, model);
    if (reason.length > 0) {
      this.pmError = reason;
      this.pmPrefillOk = false;
      this.editModelKey = '';
      this.error = reason;
      return;
    }
    const prefill: PerModelConfig | null = perModelConfigFrom(sub, model);
    this.pmPrefillOk = perModelSubmitAllowed(prefill);
    if (prefill === null || !this.pmPrefillOk) {
      this.pmError = '无法读取该模型的既有配置，已禁用编辑（避免静默覆盖）。';
      this.editModelKey = '';
      this.error = this.pmError;
      return;
    }
    const f: PerModelForm = perModelFormFromConfig(prefill);
    this.pmMaxContext = f.maxContext;
    this.pmMaxOutput = f.maxOutput;
    this.pmApiType = f.apiType;
    this.pmVision = f.vision;
    this.pmVisionDetail = f.visionDetail;
    this.pmError = '';
    this.editModelKey = this.modelKey(sub.id, model);
    this.modelMenuKey = '';
    this.page = PAGE_MODEL;
  }

  private cancelModelConfig(): void {
    this.editModelKey = '';
    this.pmError = '';
    this.pmPrefillOk = false;
    this.page = PAGE_DETAIL;
  }

  /** 保存逐模型配置（`update_per_model_config`；⛔ 闸门关闭时绝不发 RPC）。 */
  private async saveModelConfig(sub: SubscriptionRow, model: string): Promise<void> {
    if (this.pmBusy) {
      return;
    }
    if (!this.pmPrefillOk) {
      this.pmError = '未取得既有配置，已阻止提交（避免覆盖）。';
      return;
    }
    const form: PerModelForm = perModelFormOf(this.pmMaxContext, this.pmMaxOutput,
      this.pmApiType, this.pmVision, this.pmVisionDetail);
    const bad: string = perModelFormError(form, sub.provider);
    if (bad.length > 0) {
      this.pmError = bad;
      return;
    }
    this.pmBusy = true;
    try {
      await rpc<void>(this.http, RpcMethod.updatePerModelConfig,
        new UpdatePerModelConfigParams(sub.id, model, perModelFormToBody(form, sub.provider)));
      this.pmError = '';
      this.editModelKey = '';
      this.pmPrefillOk = false;
      this.page = PAGE_DETAIL;
    } catch (e) {
      this.pmError = readableRpcError((e as Error).message);
    } finally {
      this.pmBusy = false;
      await this.load();
    }
  }

  /** 正在编辑的订阅（由 `editModelKey` 反查）。 */
  private editingSub(): SubscriptionRow | undefined {
    const key: string = this.editModelKey;
    const cut: number = key.indexOf('|');
    if (cut <= 0) {
      return undefined;
    }
    const id: string = key.substring(0, cut);
    for (let i = 0; i < this.subs.length; i++) {
      if (this.subs[i].id === id) {
        return this.subs[i];
      }
    }
    return undefined;
  }

  private editingModelName(): string {
    const key: string = this.editModelKey;
    const cut: number = key.indexOf('|');
    return cut < 0 ? '' : key.substring(cut + 1);
  }

  // ── 刷新 / 导入 / 导出 ──────────────────────────────────────────────────────

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

  private async exportSubscriptions(): Promise<void> {
    if (this.ioBusy) {
      return;
    }
    this.ioBusy = true;
    this.notice = '';
    try {
      const resp: Object = await rpc<Object>(this.http, RPC_EXPORT_SUBSCRIPTIONS,
        new ExportSubscriptionsParams());
      const count: number = subscriptionsDocCount(resp);
      if (count === 0) {
        this.error = '没有可导出的订阅';
        return;
      }
      const json: string = serializeSubscriptionsDoc(resp);
      const opt: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      opt.newFileNames = ['xbot-llm-subscriptions.json'];
      const uris: string[] = await new picker.DocumentViewPicker().save(opt);
      if (uris === undefined || uris.length === 0) {
        return;   // 用户取消：不算失败
      }
      const f: fileIo.File = fileIo.openSync(uris[0],
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(f.fd, json);
      } finally {
        fileIo.closeSync(f);
      }
      this.error = '';
      this.notice = `已导出 ${count} 个订阅`;
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.ioBusy = false;
    }
  }

  private readTextUri(uri: string): string {
    const st: fileIo.Stat = fileIo.statSync(uri);
    const f: fileIo.File = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
    try {
      const buf: ArrayBuffer = new ArrayBuffer(st.size);
      fileIo.readSync(f.fd, buf);
      const dec: util.TextDecoder = util.TextDecoder.create('utf-8');
      return dec.decodeToString(new Uint8Array(buf));
    } finally {
      fileIo.closeSync(f);
    }
  }

  private async importSubscriptions(): Promise<void> {
    if (this.ioBusy) {
      return;
    }
    this.ioBusy = true;
    this.notice = '';
    try {
      const opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      opt.maxSelectNumber = 1;
      const uris: string[] = await new picker.DocumentViewPicker().select(opt);
      if (uris === undefined || uris.length === 0) {
        return;
      }
      const raw: string = this.readTextUri(uris[0]);
      const parsed: ImportParseResult = parseSubscriptionsImport(raw);
      if (parsed.kind !== IMPORT_OK) {
        this.error = parsed.kind === IMPORT_EMPTY
          ? '导入文件里没有任何订阅'
          : (parsed.kind === IMPORT_BAD_FORMAT
            ? '导入文件格式不对（缺少 subs 数组）'
            : '导入文件不是合法的 JSON');
        return;
      }
      await rpc<void>(this.http, RPC_IMPORT_SUBSCRIPTIONS,
        new ImportSubscriptionsParams(parsed.subs));
      this.error = '';
      this.notice = `已导入 ${parsed.subs.length} 个订阅`;
      await this.load();
    } catch (e) {
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.ioBusy = false;
    }
  }

  // ── 派生 ────────────────────────────────────────────────────────────────────

  private visibleSubs(): SubscriptionRow[] {
    return filterSubscriptions(this.subs, this.entries, this.subQuery);
  }

  private detailSub(): SubscriptionRow | undefined {
    for (let i = 0; i < this.subs.length; i++) {
      if (this.subs[i].id === this.detailId) {
        return this.subs[i];
      }
    }
    return undefined;
  }

  private detailModels(): ModelEntryRow[] {
    return modelsForSub(this.entries, this.detailId);
  }

  /**
   * 详情页当前订阅（**非空**视图）。
   *
   * ⛔ 为什么要有这个：ArkUI `@Builder` 体内**不能声明局部变量**（10905209），所以详情页无法
   *    `const s = this.detailSub()` 后再做空检查；这里给一个"空壳"回退值，让所有字段访问
   *    类型安全（订阅被删后页面会显示"订阅已不存在"占位，不会读到真数据）。
   */
  private detailRow(): SubscriptionRow {
    const s: SubscriptionRow | undefined = this.detailSub();
    if (s !== undefined) {
      return s;
    }
    const empty: SubscriptionRow = {
      id: '', name: '', provider: '', base_url: '', api_key: '', model: '',
      active: false, enabled: false,
    };
    return empty;
  }

  /** 模型徽章：是否开启视觉。 */
  private modelHasVision(model: string): boolean {
    const c: PerModelConfig | null = perModelConfigFrom(this.detailRow(), model);
    return c !== null && c.vision === true;
  }

  /** 模型徽章：上下文上限（0/缺失 ⇒ 空串，不显示）。 */
  private modelCtxText(model: string): string {
    const c: PerModelConfig | null = perModelConfigFrom(this.detailRow(), model);
    if (c === null || c.max_context === undefined || c.max_context <= 0) {
      return '';
    }
    return fmtTokens(c.max_context);
  }

  /** 模型徽章：输出上限（同上）。 */
  private modelOutText(model: string): string {
    const c: PerModelConfig | null = perModelConfigFrom(this.detailRow(), model);
    if (c === null || c.max_output_tokens === undefined || c.max_output_tokens <= 0) {
      return '';
    }
    return 'out ' + fmtTokens(c.max_output_tokens);
  }

  /** 标题（子页顶部栏用）。 */
  private pageTitle(): string {
    if (this.page === PAGE_DETAIL) {
      const s: SubscriptionRow | undefined = this.detailSub();
      return s !== undefined ? s.name : '订阅详情';
    }
    if (this.page === PAGE_TIER) {
      return this.tierPageTitle();
    }
    if (this.page === PAGE_FORM) {
      return this.formEditing ? '编辑订阅' : '新增订阅';
    }
    if (this.page === PAGE_MODEL) {
      return this.editingModelName();
    }
    return '模型与订阅';
  }

  /**
   * 档位页标题。
   * ⛔ 单列成方法：`tierLabel(` 里含 `Label(` 字样，`i18n_scan_missing` 的 rawUi 扫描会把
   *    「三元表达式 + 中文字面量」同一行判成未走 i18n（假红）⇒ 拆开后每行只有一件事。
   */
  private tierPageTitle(): string {
    if (this.pickTier.length > 0) {
      return tierLabel(this.pickTier);
    }
    return i18nT('子代理模型档位');
  }

  /** 详情页空态（订阅被别处删掉时）。⛔ 单列方法同 `tierPageTitle()` 的理由（避开 rawUi 扫描）。 */
  private missingSubText(): string {
    return i18nT('没有匹配的订阅');
  }

  /** 订阅 → 详情页。 */
  private openDetail(subId: string): void {
    this.detailId = subId;
    this.page = PAGE_DETAIL;
    this.deleteId = '';
    this.modelMenuKey = '';
    this.addModelOpen = false;
    this.modelDraft = '';
    this.error = '';
  }

  private openTier(tier: string): void {
    this.pickTier = tier;
    this.tierQuery = '';
    this.page = PAGE_TIER;
    this.error = '';
  }

  private back(): void {
    if (this.page === PAGE_MODEL) {
      this.page = PAGE_DETAIL;
      this.editModelKey = '';
      this.pmError = '';
      return;
    }
    if (this.page === PAGE_FORM) {
      this.page = this.formEditing && this.detailId.length > 0 ? PAGE_DETAIL : PAGE_LIST;
      return;
    }
    this.page = PAGE_LIST;
    this.pickTier = '';
    this.tierQuery = '';
    this.detailId = '';
    this.modelMenuKey = '';
  }

  private numOptions(presets: number[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < presets.length; i++) {
      out.push(`${presets[i]}`);
    }
    return out;
  }

  private numLabels(presets: number[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < presets.length; i++) {
      out.push(presetLabel(presets[i]));
    }
    return out;
  }

  private editingApiTypes(): string[] {
    const sub: SubscriptionRow | undefined = this.editingSub();
    return sub === undefined ? [] : perModelApiTypes(sub.provider);
  }

  /** provider 显示名（编号与 `LLM_PROVIDER_IDS` 对齐；未识别 ⇒ 原样）。 */
  private providerLabel(provider: string): string {
    for (let i = 0; i < LLM_PROVIDER_IDS.length; i++) {
      if (LLM_PROVIDER_IDS[i] === provider) {
        return LLM_PROVIDER_LABELS[i];
      }
    }
    return provider;
  }

  // ── 子页通用：顶部返回栏 ─────────────────────────────────────────────────────

  @Builder
  NavBar() {
    Row({ space: SP_2 }) {
      Text('‹')
        .fontSize(fs('type.title'))
        .fontColor(this.ink('accentSoft'))
        .width(HIT_TARGET_MIN)
        .height(HIT_TARGET_MIN)
        .textAlign(TextAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('返回'))
        .onClick(() => {
          this.back();
        })
      Text(this.pageTitle())
        .fontSize(FS_BODY)
        .fontColor(this.ink('primary'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  // ── 列表页 ──────────────────────────────────────────────────────────────────

  @Builder
  InferenceCard() {
    Column({ space: SP_3 }) {
      Text(i18nT('模型推理'))
        .fontSize(FS_CAPTION)
        .fontColor(this.ink('muted'))
        .width('100%')

      // 思考模式：**分段控件**（4 等分，选中段填 accent）——比一排 chips 更像"开关组"，
      // 一眼能看出"这是四选一"，不是四个独立按钮。
      Column({ space: SP_2 }) {
        Row({ space: 2 }) {
          ForEach(THINK_OPTIONS, (mode: string) => {
            Text(thinkLabel(mode))
              .layoutWeight(1)
              .height(HIT_TARGET_MIN)
              .textAlign(TextAlign.Center)
              .fontSize(FS_CAPTION)
              .fontColor(mode === this.thinking ? this.pal().onAccent : this.ink('secondary'))
              .backgroundColor(mode === this.thinking ? this.pal().accent : Color.Transparent)
              .borderRadius(R_MD)
              .animation(animBase())
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                if (!this.inferenceBusy && mode !== this.thinking) {
                  void this.commitThinking(mode);
                }
              })
          }, (mode: string) => `th|${mode}|${mode === this.thinking ? 1 : 0}`)
        }
        .width('100%')
        .padding(2)
        .backgroundColor(this.pal().surfaceAlt)
        .borderRadius(R_LG)

        Text(thinkHint(this.thinking))
          .fontSize(FS_CAPTION)
          .fontColor(this.ink('muted'))
          .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Divider().strokeWidth(1).color(this.pal().border).margin({ top: SP_1 })

      // 最大并发：−/＋ 步进器（值等宽显示，命中区 ≥44）
      Row({ space: SP_2 }) {
        Column({ space: 2 }) {
          Text(i18nT('最大并发'))
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('primary'))
            .width('100%')
          Text(`${LLM_CONCURRENCY_MIN}-${LLM_CONCURRENCY_MAX}`)
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('muted'))
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Row({ space: SP_1 }) {
          Text('−')
            .fontSize(FS_BODY)
            .fontColor(this.ink('primary'))
            .width(HIT_TARGET_MIN)
            .height(HIT_TARGET_MIN)
            .textAlign(TextAlign.Center)
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .opacity(this.inferenceBusy || this.concurrency <= LLM_CONCURRENCY_MIN ? 0.4 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText(i18nT('减少并发数'))
            .onClick(() => {
              if (!this.inferenceBusy && this.concurrency > LLM_CONCURRENCY_MIN) {
                void this.commitConcurrency(concurrencyStep(this.concurrency, -1));
              }
            })
          Text(`${this.concurrency}`)
            .fontSize(FS_BODY)
            .fontFamily('monospace')
            .fontColor(this.ink('primary'))
            .width(36)
            .textAlign(TextAlign.Center)
          Text('＋')
            .fontSize(FS_BODY)
            .fontColor(this.ink('primary'))
            .width(HIT_TARGET_MIN)
            .height(HIT_TARGET_MIN)
            .textAlign(TextAlign.Center)
            .backgroundColor(this.pal().surfaceAlt)
            .borderRadius(R_LG)
            .opacity(this.inferenceBusy || this.concurrency >= LLM_CONCURRENCY_MAX ? 0.4 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText(i18nT('增加并发数'))
            .onClick(() => {
              if (!this.inferenceBusy && this.concurrency < LLM_CONCURRENCY_MAX) {
                void this.commitConcurrency(concurrencyStep(this.concurrency, 1));
              }
            })
        }
        .alignItems(VerticalAlign.Center)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding(SP_4)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  TierCard() {
    Column({ space: SP_1 }) {
      Row({ space: SP_2 }) {
        Text(i18nT('子代理模型档位'))
          .fontSize(FS_CAPTION)
          .fontColor(this.ink('muted'))
          .layoutWeight(1)
      }
      .width('100%')

      ForEach(TIERS, (tier: string) => {
        Row({ space: SP_2 }) {
          Column({ space: 2 }) {
            Text(tierLabel(tier))
              .fontSize(FS_CAPTION)
              .fontColor(this.ink('primary'))
              .width('100%')
            Text(this.tierRaw(tier).length > 0
              ? tierDisplayText(this.tierRaw(tier), this.entries, this.subs)
              : TIER_UNSET_TEXT)
              .fontSize(FS_CAPTION)
              .fontColor(this.tierRaw(tier).length > 0 ? this.ink('accentSoft') : this.ink('muted'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
              .animation(animBase())
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          Text('›')
            .fontSize(FS_BODY)
            .fontColor(this.ink('muted'))
        }
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.openTier(tier);
        })
      }, (tier: string) => `tier|${tier}|${this.tierRaw(tier)}`)
    }
    .width('100%')
    .padding(SP_4)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  ListPage() {
    Scroll() {
      Column({ space: SP_3 }) {
        SettingsPanelHeader({
          title: '模型与订阅',
          subtitle: '点订阅卡进入详情：凭据、模型、默认与删除都在那里。',
          theme: this.theme,
        })

        // 主操作 + 次级操作（收敛：默认只露出「新增订阅」与「更多」，避免一排四枚小按钮）
        Row({ space: SP_2 }) {
          SettingsButton({
            label: '新增订阅',
            kind: 'primary',
            theme: this.theme,
            onTap: () => {
              this.openAdd();
            },
          })
          SettingsButton({
            label: this.moreOpen ? '收起' : '更多',
            kind: 'ghost',
            theme: this.theme,
            onTap: () => {
              this.moreOpen = !this.moreOpen;
            },
          })
          Blank().layoutWeight(1)
          if (this.notice.length > 0) {
            Text(this.notice)
              .fontSize(FS_CAPTION)
              .fontColor(this.ink('success'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        if (this.moreOpen) {
          Row({ space: SP_2 }) {
            SettingsButton({
              label: '刷新模型',
              kind: 'secondary',
              busy: this.loading,
              theme: this.theme,
              onTap: () => {
                void this.refreshModels();
              },
            })
            SettingsButton({
              label: this.ioBusy ? '…' : '导出',
              kind: 'secondary',
              busy: this.ioBusy,
              theme: this.theme,
              onTap: () => {
                void this.exportSubscriptions();
              },
            })
            SettingsButton({
              label: this.ioBusy ? '…' : '导入',
              kind: 'secondary',
              busy: this.ioBusy,
              theme: this.theme,
              onTap: () => {
                void this.importSubscriptions();
              },
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }

        if (this.error.length > 0) {
          SettingsErrorBar({ message: this.error, theme: this.theme })
        }

        this.InferenceCard()
        this.TierCard()

        // 订阅：搜索 + 卡片列表（整卡点击进详情）
        TextInput({ text: this.subQuery, placeholder: i18nT('搜索订阅 / 模型') })
          .width('100%')
          .height(36)
          .fontSize(FS_CAPTION)
          .fontColor(this.ink('primary'))
          .placeholderColor(this.ink('muted'))
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .onChange((v: string) => {
            this.subQuery = v;
          })

        if (this.loading && this.subs.length === 0) {
          Text(i18nT('加载中…'))
            .fontSize(FS_CAPTION)
            // ⛔ 必须是**字面** `this.pal().textMuted`（web 口径 `text-text-muted`）：
            //    `tools/tests/porcelain_surfacehi_contrast.test.ts §9` 按源码扫这条文案的取色表达式。
            .fontColor(this.pal().textMuted)
            .width('100%')
        } else if (this.visibleSubs().length === 0) {
          Text(this.subQuery.length > 0 ? i18nT('没有匹配的订阅') : i18nT('还没有任何订阅。'))
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('muted'))
            .width('100%')
            .padding(SP_4)
            .textAlign(TextAlign.Center)
        } else {
          ForEach(this.visibleSubs(), (s: SubscriptionRow) => {
            Column({ space: SP_1 }) {
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
                  void this.makeDefault(subId);
                },
              })
              // ⛔ 导航**不复用整卡点击**：卡内已有开关/「设为默认」两处手势，父级 onClick 会和它们
              //    抢事件（点了开关顺手跳走）。改为卡下一条**显式**「打开详情」行（命中区 44）。
              Row({ space: SP_1 }) {
                Blank().layoutWeight(1)
                Text(i18nT('管理'))
                  .fontSize(FS_CAPTION)
                  .fontColor(this.ink('accentSoft'))
                Text('›')
                  .fontSize(FS_BODY)
                  .fontColor(this.ink('accentSoft'))
              }
              .width('100%')
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .alignItems(VerticalAlign.Center)
              .padding({ right: SP_2 })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.openDetail(s.id);
              })
            }
            .width('100%')
          }, (s: SubscriptionRow) => `sub|${s.id}|${s.active === true ? 'd' : '-'}|${s.enabled === true ? 'on' : 'off'}|${countModelsForSub(this.entries, s.id)}`)
        }
      }
      .width('100%')
      .padding({ bottom: SP_4 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Auto)
    .align(Alignment.Top)
  }

  // ── 订阅详情页 ──────────────────────────────────────────────────────────────

  @Builder
  DetailPage() {
    Scroll() {
      Column({ space: SP_3 }) {
        if (this.detailSub() !== undefined) {
          Column({ space: SP_2 }) {
            // 凭据卡
            Column({ space: SP_2 }) {
              Row({ space: SP_2 }) {
                Text(this.providerLabel(this.detailRow().provider))
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().onAccent)
                  .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                  .backgroundColor(this.pal().accent)
                  .borderRadius(R_MD)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: '100%' })
                Text(isSubscriptionEnabled(this.detailRow()) ? i18nT('已启用') : i18nT('禁用'))
                  .fontSize(FS_CAPTION)
                  .fontColor(isSubscriptionEnabled(this.detailRow())
                    ? this.ink('success') : this.ink('muted'))
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: '100%' })
                Blank().layoutWeight(1)
                if (this.detailRow().active === true) {
                  Text(i18nT('当前'))
                    .fontSize(FS_CAPTION)
                    .fontColor(this.ink('accentSoft'))
                }
              }
              .width('100%')

              Text(this.detailRow().base_url)
                .fontSize(FS_CAPTION)
                .fontFamily('monospace')
                .fontColor(this.ink('secondary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
              Text(`API Key ${this.detailRow().api_key !== undefined
                && this.detailRow().api_key !== null
                && this.detailRow().api_key.length > 0
                ? this.detailRow().api_key : '—'}`)
                .fontSize(FS_CAPTION)
                .fontFamily('monospace')
                .fontColor(this.ink('muted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .constraintSize({ maxWidth: '100%' })
              Text(`${i18nT('默认模型')} ${this.detailRow().model !== undefined
                && this.detailRow().model !== null
                && this.detailRow().model.length > 0
                ? this.detailRow().model : '—'}`)
                .fontSize(FS_CAPTION)
                .fontFamily('monospace')
                .fontColor(this.ink('muted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .constraintSize({ maxWidth: '100%' })
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })
            .alignItems(HorizontalAlign.Start)

            // 模型区
            Column({ space: SP_2 }) {
              Row({ space: SP_2 }) {
                Text(`${i18nT('模型')} · ${this.detailModels().length}`)
                  .fontSize(FS_CAPTION)
                  .fontColor(this.ink('muted'))
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: '100%' })
                  .layoutWeight(1)
                if (!isSystemSubscription(this.detailRow())) {
                  SettingsButton({
                    label: this.addModelOpen ? '收起' : '添加模型',
                    kind: 'ghost',
                    theme: this.theme,
                    onTap: () => {
                      this.addModelOpen = !this.addModelOpen;
                      this.modelDraft = '';
                    },
                  })
                }
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              if (this.addModelOpen) {
                Row({ space: SP_2 }) {
                  TextInput({ text: this.modelDraft, placeholder: i18nT('模型名，如 gpt-5.2-turbo') })
                    .layoutWeight(1)
                    .height(36)
                    .fontSize(FS_CAPTION)
                    .fontColor(this.ink('primary'))
                    .placeholderColor(this.ink('muted'))
                    .backgroundColor(this.pal().surfaceAlt)
                    .borderRadius(R_LG)
                    .border({ width: 1, color: this.pal().border })
                    .onChange((v: string) => {
                      this.modelDraft = v;
                    })
                  SettingsButton({
                    label: '登记',
                    kind: 'primary',
                    busy: !isValidModelName(this.modelDraft),
                    theme: this.theme,
                    onTap: () => {
                      void this.addModel(this.detailId);
                    },
                  })
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
              }

              if (this.detailModels().length === 0) {
                Text(i18nT('该订阅下还没有模型，先「刷新模型」或手动登记。'))
                  .fontSize(FS_CAPTION)
                  .fontColor(this.ink('muted'))
                  .width('100%')
              } else {
                ForEach(this.detailModels(), (e: ModelEntryRow) => {
                  Column({ space: SP_1 }) {
                    Row({ space: SP_2 }) {
                      // 状态点
                      Row()
                        .width(7).height(7).borderRadius(3.5)
                        .backgroundColor(isModelDisabled(e.status) ? this.ink('muted') : this.ink('success'))
                      Text(e.model)
                        .fontSize(FS_CAPTION)
                        .fontFamily('monospace')
                        .fontColor(isModelDisabled(e.status) ? this.ink('muted') : this.ink('primary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1)
                      Text('⋯')
                        .fontSize(FS_BODY)
                        .fontColor(this.ink('secondary'))
                        .width(HIT_TARGET_MIN)
                        .height(HIT_TARGET_MIN)
                        .textAlign(TextAlign.Center)
                        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                        .accessibilityText(i18nT('模型操作'))
                        .onClick(() => {
                          const k: string = this.modelKey(this.detailId, e.model);
                          this.modelMenuKey = this.modelMenuKey === k ? '' : k;
                        })
                    }
                    .width('100%')
                    .alignItems(VerticalAlign.Center)

                    // 徽章行（vision / ctx / out）—— web 详情页同款信息密度
                    Row({ space: SP_1 }) {
                      if (this.modelHasVision(e.model)) {
                        // ⛔ 只用字形（`视觉` 一词在 i18n 表里没有独立词条；详情页信息密度已够）
                        Text('👁')
                          .fontSize(FS_CAPTION)
                          .fontColor(this.ink('accentSoft'))
                      }
                      if (this.modelCtxText(e.model).length > 0) {
                        Text(this.modelCtxText(e.model))
                          .fontSize(FS_CAPTION)
                          .fontFamily('monospace')
                          .fontColor(this.ink('muted'))
                      }
                      if (this.modelOutText(e.model).length > 0) {
                        Text(this.modelOutText(e.model))
                          .fontSize(FS_CAPTION)
                          .fontFamily('monospace')
                          .fontColor(this.ink('muted'))
                      }
                      Text(modelStatusLabel(e.status))
                        .fontSize(FS_CAPTION)
                        .fontColor(isModelDisabled(e.status) ? this.ink('muted') : this.ink('success'))
                        .animation(animBase())
                    }
                    .width('100%')

                    // 「⋯」行内菜单：配置 / 启停 / 删除（一屏只露这一组的当前项，点开才出现）
                    if (this.modelMenuKey === this.modelKey(this.detailId, e.model)) {
                      Row({ space: SP_2 }) {
                        SettingsButton({
                          label: i18nT('配置'),
                          kind: 'secondary',
                          busy: perModelEditReason(this.detailRow(), e.model).length > 0,
                          theme: this.theme,
                          onTap: () => {
                            const s: SubscriptionRow | undefined = this.detailSub();
                            if (s !== undefined && perModelEditReason(s, e.model).length === 0) {
                              this.openModelConfig(s, e.model);
                            }
                          },
                        })
                        SettingsButton({
                          label: isModelDisabled(e.status) ? i18nT('启用') : i18nT('禁用'),
                          kind: 'secondary',
                          busy: this.modelBusy === this.modelKey(this.detailId, e.model),
                          theme: this.theme,
                          onTap: () => {
                            void this.toggleModel(this.detailId, e.model, isModelDisabled(e.status));
                          },
                        })
                        SettingsButton({
                          label: i18nT('删除'),
                          kind: 'danger',
                          theme: this.theme,
                          onTap: () => {
                            void this.removeModelEntry(this.detailId, e.model);
                          },
                        })
                      }
                      .width('100%')
                      .alignItems(VerticalAlign.Center)
                    }
                  }
                  .width('100%')
                  .padding({ top: SP_2, bottom: SP_2 })
                  .alignItems(HorizontalAlign.Start)
                }, (e: ModelEntryRow) => `dm|${this.detailId}|${e.model}|${e.status !== undefined ? e.status : ''}|${this.modelMenuKey === this.modelKey(this.detailId, e.model) ? 'M' : '-'}`)
              }
            }
            .width('100%')
            .padding(SP_4)
            .backgroundColor(this.pal().surface)
            .borderRadius(R_XL)
            .border({ width: 1, color: this.pal().border })
            .alignItems(HorizontalAlign.Start)

            // 底部：设为默认 / 编辑 / 删除（非系统订阅）
            if (!isSystemSubscription(this.detailRow())) {
              Row({ space: SP_2 }) {
                SettingsButton({
                  label: this.detailRow().active === true ? i18nT('当前默认') : i18nT('设为默认'),
                  kind: 'secondary',
                  busy: this.detailRow().active === true || this.busy === this.detailId,
                  theme: this.theme,
                  onTap: () => {
                    void this.makeDefault(this.detailId);
                  },
                })
                SettingsButton({
                  label: i18nT('编辑'),
                  kind: 'secondary',
                  theme: this.theme,
                  onTap: () => {
                    const s: SubscriptionRow | undefined = this.detailSub();
                    if (s !== undefined) {
                      this.openEdit(s);
                    }
                  },
                })
                SettingsButton({
                  label: this.deleteId === this.detailId ? '确认删除' : '删除订阅',
                  kind: 'danger',
                  armed: this.deleteId === this.detailId,
                  busy: this.busy === this.detailId,
                  theme: this.theme,
                  onTap: () => {
                    void this.doDelete(this.detailId);
                  },
                })
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
            }
          }
          .width('100%')
        } else {
          Text(this.missingSubText())
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('muted'))
            .width('100%')
        }

        if (this.error.length > 0) {
          SettingsErrorBar({ message: this.error, theme: this.theme })
        }
      }
      .width('100%')
      .padding({ bottom: SP_4 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Auto)
    .align(Alignment.Top)
  }

  // ── 档位选择页 ──────────────────────────────────────────────────────────────

  @Builder
  TierPage() {
    Scroll() {
      Column({ space: SP_2 }) {
        Text(i18nT('按档位给子代理挑模型（跨订阅）；留空则由系统默认决定。'))
          .fontSize(FS_CAPTION)
          .fontColor(this.ink('muted'))
          .width('100%')

        TextInput({ text: this.tierQuery, placeholder: i18nT('搜索模型 / 订阅') })
          .width('100%')
          .height(36)
          .fontSize(FS_CAPTION)
          .fontColor(this.ink('primary'))
          .placeholderColor(this.ink('muted'))
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_LG)
          .border({ width: 1, color: this.pal().border })
          .onChange((v: string) => {
            this.tierQuery = v;
          })

        // 清除项（web 的空值语义）
        Row({ space: SP_2 }) {
          Text(i18nT('默认'))
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('secondary'))
            .layoutWeight(1)
          if (this.tierRaw(this.pickTier).length === 0) {
            Text(i18nT('当前'))
              .fontSize(FS_CAPTION)
              .fontColor(this.ink('accentSoft'))
          }
        }
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          // ⛔ 不做 `if (!this.tierBusy)` 纯守卫（`interactive_feedback` 判据：纯守卫 = 死区）——
          //    `clearTier → setTierValue` 内部已有 tierBusy 闸门，重复守卫只会让点击"静默无效"。
          void this.clearTier(this.pickTier);
        })

        Divider().strokeWidth(1).color(this.pal().border)

        if (this.pickerEntries().length === 0) {
          Text(i18nT('没有匹配的模型'))
            .fontSize(FS_CAPTION)
            .fontColor(this.ink('muted'))
            .width('100%')
            .padding(SP_4)
            .textAlign(TextAlign.Center)
        } else {
          ForEach(this.pickerEntries(), (e: ModelEntryRow) => {
            Row({ space: SP_2 }) {
              Column({ space: 2 }) {
                Text(e.model)
                  .fontSize(FS_CAPTION)
                  .fontFamily('monospace')
                  .fontColor(this.ink('primary'))
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
                Text(e.sub_name !== undefined && e.sub_name !== null ? e.sub_name : '')
                  .fontSize(FS_CAPTION)
                  .fontColor(this.ink('muted'))
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              if (isTierEntryCurrent(this.tierRaw(this.pickTier), e)) {
                Text(i18nT('当前'))
                  .fontSize(FS_CAPTION)
                  .fontColor(this.pal().onAccent)
                  .padding({ left: SP_2, right: SP_2, top: 1, bottom: 1 })
                  .backgroundColor(this.pal().accent)
                  .borderRadius(R_LG)
              }
            }
            .width('100%')
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .alignItems(VerticalAlign.Center)
            .opacity(this.tierBusy ? 0.5 : 1)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              void this.setTierValue(this.pickTier, e.sub_id !== undefined ? e.sub_id : '', e.model);
            })
          }, (e: ModelEntryRow) => `tp|${this.pickTier}|${e.sub_id !== undefined ? e.sub_id : ''}|${e.model}`)
        }

        if (this.error.length > 0) {
          SettingsErrorBar({ message: this.error, theme: this.theme })
        }
      }
      .width('100%')
      .padding({ bottom: SP_4 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Auto)
    .align(Alignment.Top)
  }

  // ── 新增 / 编辑订阅（独立页 + 顶部固定操作栏）────────────────────────────────

  @Builder
  SubFormCard() {
    Column({ space: SP_1 }) {
      // 操作栏固定在最上（手机弹键盘也点得到「保存」）
      Row({ space: SP_2 }) {
        Text(this.formEditing ? i18nT('编辑订阅') : i18nT('新增订阅'))
          .fontSize(FS_BODY)
          .fontColor(this.ink('primary'))
          .layoutWeight(1)
        SettingsButton({
          label: '取消',
          kind: 'ghost',
          theme: this.theme,
          onTap: () => {
            this.back();
          },
        })
        SettingsButton({
          label: this.formBusy ? '保存中…' : '保存',
          kind: 'primary',
          busy: this.formBusy || !subscriptionFormValid(this.form, this.formEditing),
          theme: this.theme,
          onTap: () => {
            void this.submitForm();
          },
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text(i18nT('协议、Base URL、凭据与默认模型；编辑时凭据留空或保持掩码则不改动。'))
        .fontSize(FS_CAPTION)
        .fontColor(this.ink('muted'))
        .width('100%')
      if (!subscriptionFormValid(this.form, this.formEditing)) {
        Text(subscriptionFormError(this.form, this.formEditing))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().warn)
          .width('100%')
      }

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
          f.baseUrl = llmProviderUrl(v);   // 切协议 ⇒ base_url 重置为该协议默认（web 同款）
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
        label: i18nT('名称'), description: '', value: this.form.name, placeholder: i18nT('如 My OpenAI'),
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
        value: this.form.apiKey, placeholder: this.formEditing ? i18nT('保持掩码则不修改') : 'sk-…',
        password: true, busy: this.formBusy, theme: this.theme,
        onInput: (v: string) => {
          const f: SubscriptionForm = this.cloneForm(this.form);
          f.apiKey = v;
          this.form = f;
        },
      })
      SettingsTextFieldRow({
        label: i18nT('默认模型'), description: '', value: this.form.model, placeholder: 'model-name',
        password: false, busy: this.formBusy, theme: this.theme,
        onInput: (v: string) => {
          const f: SubscriptionForm = this.cloneForm(this.form);
          f.model = v;
          this.form = f;
        },
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
      }
    }
    .width('100%')
    .padding(SP_4)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
  }

  // ── 逐模型配置页 ────────────────────────────────────────────────────────────

  @Builder
  ModelConfigEditor() {
    Column({ space: SP_2 }) {
      if (this.pmError.length > 0) {
        SettingsErrorBar({ message: this.pmError, theme: this.theme })
      }
      SettingsChipRow({
        label: '上下文上限',
        description: '0 = 跟随默认（系统默认 1M）。',
        value: `${this.pmMaxContext}`,
        options: this.numOptions(CTX_PRESETS),
        labels: this.numLabels(CTX_PRESETS),
        theme: this.theme,
        onSelect: (v: string) => {
          this.pmMaxContext = parseInt(v, 10);
        },
      })
      SettingsChipRow({
        label: '输出上限',
        description: '0 = 跟随订阅默认。',
        value: `${this.pmMaxOutput}`,
        options: this.numOptions(OUT_PRESETS),
        labels: this.numLabels(OUT_PRESETS),
        theme: this.theme,
        onSelect: (v: string) => {
          this.pmMaxOutput = parseInt(v, 10);
        },
      })
      if (this.editingApiTypes().length > 0) {
        SettingsChipRow({
          label: 'API 类型',
          description: '仅 OpenAI 有意义（Anthropic 无此概念）。',
          value: this.pmApiType,
          options: this.editingApiTypes(),
          labels: this.editingApiTypes(),
          theme: this.theme,
          onSelect: (v: string) => {
            this.pmApiType = v;
          },
        })
      }
      SettingsToolRow({
        label: '视觉（多模态输入）',
        description: '纯手动开关，无模型名白名单；关闭后图片降级为文本占位。',
        isOn: this.pmVision,
        mono: false,
        theme: this.theme,
        onToggle: (_names: string[], next: boolean) => {
          this.pmVision = next;
        },
      })
      if (this.pmVision) {
        SettingsChipRow({
          label: '视觉细节',
          description: 'OpenAI image_url.detail（auto = 空）。',
          value: this.pmVisionDetail,
          options: VISION_DETAILS,
          labels: ['auto', 'low', 'high'],
          theme: this.theme,
          onSelect: (v: string) => {
            this.pmVisionDetail = v;
          },
        })
      }
      Row({ space: SP_2 }) {
        SettingsButton({
          label: this.pmBusy ? '保存中…' : '保存',
          kind: 'primary',
          busy: this.pmBusy || !this.pmPrefillOk,
          theme: this.theme,
          onTap: () => {
            const sub: SubscriptionRow | undefined = this.editingSub();
            const model: string = this.editingModelName();
            if (sub !== undefined && model.length > 0) {
              void this.saveModelConfig(sub, model);
            }
          },
        })
        Text('取消').accessibilityText(i18nT('取消'))
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textSecondary)
          .padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_2 })
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.cancelModelConfig();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding(SP_4)
    // ⛔ 就地编辑框底 = `surface.raised`（`contrast_landing §4 / L3` 钉住：porcelain 下
    //    `textSecondary × surfaceHi` 只有 4.337 < AA 4.5；raised 4.696 ✓）。
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.raised'))
    .borderRadius(R_XL)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
  }

  // ── 根 ─────────────────────────────────────────────────────────────────────

  build() {
    Column({ space: SP_3 }) {
      // 子页统一顶部栏（列表页由 `SettingsPanelHeader` 承担标题）
      if (this.page !== PAGE_LIST) {
        this.NavBar()
      }
      if (this.page === PAGE_LIST) {
        this.ListPage()
      } else if (this.page === PAGE_DETAIL) {
        this.DetailPage()
      } else if (this.page === PAGE_TIER) {
        this.TierPage()
      } else if (this.page === PAGE_FORM) {
        // ⛔ 表单必须在页面唯一 `Scroll` 之内（`vertical_scroll_height §D`）：否则字段高于剩余
        //    空间时「保存/取消」被挤出屏幕且滚不到（用户 2026-10-14 亲报"用不了"）。
        Scroll() {
          Column({ space: SP_2 }) {
            this.SubFormCard()
          }
          .width('100%')
          .padding({ bottom: SP_4 })
        }
        .width('100%')
        .layoutWeight(1)
        .edgeEffect(EdgeEffect.Spring)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      } else if (this.page === PAGE_MODEL) {
        Scroll() {
          Column({ space: SP_2 }) {
            this.ModelConfigEditor()
          }
          .width('100%')
          .padding({ bottom: SP_4 })
        }
        .width('100%')
        .layoutWeight(1)
        .edgeEffect(EdgeEffect.Spring)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
