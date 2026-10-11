/**
 * core/permodelcfg.ets —— **逐模型（per-model）配置**的纯逻辑（脱机可单测；零 ArkUI/@ohos 依赖）。
 *
 * 为什么需要它：这是 web LLM 控制台里**原生唯一缺失**的一块。
 *   web 权威：`SettingsLLM.tsx:150-160` `saveModel(...)` → `updatePerModelConfig(sid, model, cfg)`
 *   （`api.ts:761-763` RPC `update_per_model_config {id, model, config}`）；
 *   表单体在 `llm-console.tsx`（`CTX_PRESETS` / `OUT_PRESETS` / provider / `vision` + `vision_detail`）。
 *   原生 `components/SettingsLlm.ets` 覆盖了订阅 CRUD / 模型启停 / 删除 / 刷新 / tier / 思考 / 并发 /
 *   导入导出，**但没有** `update_per_model_config` 调用点（RPC 常量与 params 类早已就位，见
 *   `core/rpc.ets:114` / `:383-412`）。本模块把该表单的**全部判据**收成纯函数，供组件只画。
 *
 * ⛔ 语义（逐条对齐 web，勿凭记忆改）：
 *   · `max_context = 0` ⇒ **跟随默认**（系统默认 1M）；`max_output_tokens = 0` ⇒ 跟随订阅默认。
 *   · `api_type`：只有 OpenAI 有 `chat_completions`（默认）/ `responses`；Anthropic 无此概念 ⇒ 空串
 *     （复用 `core/settings.ets:normalizeApiTypeForSubmit`，**不另写一份**）。
 *   · `vision` 是**纯手动**开关（无模型名白名单）；关 ⇒ `vision_detail` 必须清空（`''`）。
 */

import { API_TYPE_CHAT_COMPLETIONS, fmtTokens, normalizeApiTypeForSubmit } from './settings';
import { PerModelConfig, PerModelConfigBody, SubscriptionRow } from './rpc';

/** `max_context` 预设（web `llm-console.tsx` `CTX_PRESETS`；0 = 跟随默认）。 */
export const CTX_PRESETS: number[] = [0, 32000, 64000, 128000, 200000, 1000000, 2000000];
/** `max_output_tokens` 预设（web `OUT_PRESETS`；0 = 跟随订阅默认）。 */
export const OUT_PRESETS: number[] = [0, 8192, 16384, 32768, 65536];
/** `vision_detail` 取值（OpenAI `image_url.detail`；`''` = auto）。 */
export const VISION_DETAILS: string[] = ['', 'low', 'high'];
/** 「跟随默认」显示文案（0 值）。 */
export const FOLLOW_DEFAULT_LABEL: string = '跟随默认';

/**
 * token 数的显示文案 —— ⛔ **复用 `core/settings.ets:fmtTokens`**（同语义：`<=0` ⇒
 * 「跟随默认」；K/M 档），本模块**不再自带一份**（避免"两份实现"）。
 */
export { fmtTokens };

/** 某一档预设的显示文案（供 chip/list 行）。 */
export function presetLabel(n: number): string {
  return fmtTokens(n);
}

/** 逐模型配置的表单模型（与 web `saveModel` 的 `cfg` 一一对应）。 */
export class PerModelForm {
  maxContext: number = 0;
  maxOutput: number = 0;
  apiType: string = '';
  vision: boolean = false;
  visionDetail: string = '';

  constructor(maxContext: number, maxOutput: number, apiType: string, vision: boolean, visionDetail: string) {
    this.maxContext = maxContext;
    this.maxOutput = maxOutput;
    this.apiType = apiType;
    this.vision = vision;
    this.visionDetail = visionDetail;
  }
}

/** 从既有值构造表单（保持字段不变形）。 */
export function perModelFormOf(
  maxContext: number, maxOutput: number, apiType: string, vision: boolean, visionDetail: string,
): PerModelForm {
  return new PerModelForm(maxContext, maxOutput, apiType, vision, visionDetail);
}

/** 负值一律归 0（0 的语义 = 跟随默认，负值无意义）。 */
export function normalizeTokens(n: number): number {
  return n > 0 ? Math.floor(n) : 0;
}

/** 该 provider 下可选的 `api_type`（Anthropic 无此概念 ⇒ 空数组 ⇒ UI 应隐藏该项）。 */
export function perModelApiTypes(provider: string): string[] {
  if (provider === 'anthropic') {
    return [];
  }
  return [API_TYPE_CHAT_COMPLETIONS, 'responses'];
}

/**
 * 提交用的 `api_type`（复用订阅级同一条归一：Anthropic ⇒ 空串；OpenAI 空 ⇒ 默认）。
 * ⛔ 不在此另写一份归一逻辑。
 */
export function perModelApiTypeForSubmit(form: PerModelForm, provider: string): string {
  return normalizeApiTypeForSubmit(provider, form.apiType);
}

/** 提交用的 `vision_detail`：`vision` 关 ⇒ 恒空串（否则会把上一次的 detail 带过去）。 */
export function perModelVisionDetailForSubmit(form: PerModelForm): string {
  return form.vision ? form.visionDetail : '';
}

/** 表单校验（返回 `''` = 合法；否则为可读原因）。 */
export function perModelFormError(form: PerModelForm, provider: string): string {
  if (form.maxContext < 0) {
    return '上下文上限不能为负（0 = 跟随默认）。';
  }
  if (form.maxOutput < 0) {
    return '输出上限不能为负（0 = 跟随订阅默认）。';
  }
  const types: string[] = perModelApiTypes(provider);
  if (types.length > 0 && form.apiType.length > 0) {
    let ok: boolean = false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === form.apiType) { ok = true; }
    }
    if (!ok) {
      return `api_type 非法：${form.apiType}`;
    }
  }
  if (form.vision) {
    let okDetail: boolean = false;
    for (let i = 0; i < VISION_DETAILS.length; i++) {
      if (VISION_DETAILS[i] === form.visionDetail) { okDetail = true; }
    }
    if (!okDetail) {
      return `vision_detail 非法：${form.visionDetail}`;
    }
  }
  return '';
}

/** 表单的展示摘要（订阅卡里的「当前配置」一行）。 */
export function perModelSummary(form: PerModelForm, provider: string): string {
  const parts: string[] = [];
  parts.push(`上限 ${fmtTokens(form.maxContext)}`);
  parts.push(`输出 ${fmtTokens(form.maxOutput)}`);
  const api: string = perModelApiTypeForSubmit(form, provider);
  parts.push(api.length > 0 ? api : 'api 默认');
  parts.push(form.vision ? `视觉 ${form.visionDetail.length > 0 ? form.visionDetail : 'auto'}` : '无视觉');
  return parts.join(' · ');
}

// ════════════════════════════════════════════════════════════════════════════
// 预填（**判据与渲染同源**）—— ⛔ 防"静默覆盖既有配置"（同类：commit 6fd4570 S-P0）
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么必须有这一层：`update_per_model_config` 是**整体替换**（服务端
// `serverapp/rpc_table.go:905 existing.PerModelConfigs[p.Model] = p.Config`），**不支持部分更新**
// ⇒ 提交前必须拿到**完整的既有值**。若拿不到却拿默认值 `0/0/''/false` 提交，就会把用户已配好的
// max_context / vision 全部抹掉 —— 这正是 `6fd4570` 那类"真数据丢失"。
// ⇒ 判据落成：**拿不到 ⇒ 编辑器禁用 + 说明原因**（绝不产 payload）。

/** 子字段"缺省或类型正确"（缺省合法：服务端六字段全 `omitempty`，零值不出现）。 */
function numOrMissing(v: Object | undefined): boolean {
  return v === undefined || v === null || typeof v === 'number';
}
function strOrMissing(v: Object | undefined): boolean {
  return v === undefined || v === null || typeof v === 'string';
}
function boolOrMissing(v: Object | undefined): boolean {
  return v === undefined || v === null || typeof v === 'boolean';
}

/**
 * 从订阅行里取**某个模型**的既有逐模型配置（**已消毒**）；无法安全取到 ⇒ `null`。
 *
 * 判据（三条，缺一即 `null`）：
 *   ① `per_model_configs` **整键缺失** ⇒ `null`（⛔ 不是"全零对象"；服务端 `omitempty`
 *      ⇒ 订阅无模型时整键不出现，与"有配置"必须区分）；
 *   ② 该模型**条目缺失** ⇒ `null`（服务端 `loadPerModelConfigs` 每模型一条 ⇒ 缺 = 异常）；
 *   ③ 条目在但**某字段类型不符** ⇒ `null`（⛔ 不猜、不抛）。
 * ⚠️ 条目在、某些**子字段**缺失 ⇒ **合法**（`max_context=0` 被 `omitempty` 省掉）⇒ 按 0/false/'' 落位。
 */
export function perModelConfigFrom(row: SubscriptionRow, model: string): PerModelConfig | null {
  const map: Record<string, PerModelConfig> | undefined = row.per_model_configs;
  if (map === undefined || map === null) {
    return null;
  }
  const raw: PerModelConfig | undefined = map[model];
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!numOrMissing(raw.max_context) || !numOrMissing(raw.max_output_tokens)) {
    return null;
  }
  if (!strOrMissing(raw.api_type) || !strOrMissing(raw.vision_detail)) {
    return null;
  }
  if (!boolOrMissing(raw.vision) || !boolOrMissing(raw.enabled)) {
    return null;
  }
  const out: PerModelConfig = new PerModelConfig();
  out.max_context = typeof raw.max_context === 'number' ? raw.max_context : 0;
  out.max_output_tokens = typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : 0;
  out.api_type = typeof raw.api_type === 'string' ? raw.api_type : '';
  out.enabled = raw.enabled === true;
  out.vision = raw.vision === true;
  out.vision_detail = typeof raw.vision_detail === 'string' ? raw.vision_detail : '';
  return out;
}

/**
 * 该模型的编辑器**是否可达**；`''` = 可达，否则为**给用户看的禁用原因**。
 *
 * ⛔ 硬要求：拿不到既有配置 ⇒ 必须**禁用并说明**，绝不允许用默认值提交。
 */
export function perModelEditReason(row: SubscriptionRow, model: string): string {
  const map: Record<string, PerModelConfig> | undefined = row.per_model_configs;
  if (map === undefined || map === null) {
    return '服务端未返回逐模型配置，无法安全编辑（保存会覆盖既有配置）。';
  }
  if (perModelConfigFrom(row, model) === null) {
    return '该模型的既有配置无法读取（缺失或类型异常），已禁用编辑以避免静默覆盖。';
  }
  return '';
}

/** 既有配置 → 编辑器表单（预填）。可选字段显式收窄（服务端 `omitempty` ⇒ 字段可能缺省）。 */
export function perModelFormFromConfig(cfg: PerModelConfig): PerModelForm {
  const ctx: number = typeof cfg.max_context === 'number' ? cfg.max_context : 0;
  const out: number = typeof cfg.max_output_tokens === 'number' ? cfg.max_output_tokens : 0;
  const api: string = typeof cfg.api_type === 'string' ? cfg.api_type : '';
  const detail: string = typeof cfg.vision_detail === 'string' ? cfg.vision_detail : '';
  return new PerModelForm(normalizeTokens(ctx), normalizeTokens(out), api, cfg.vision === true, detail);
}

/**
 * 提交闸门（★B）：**预填不成功 ⇒ 不许产 payload**。
 * 结构上把"拿默认值提交"这条路堵死 —— 调用方只有拿到非 `null` 的预填才可能过这道闸。
 */
export function perModelSubmitAllowed(prefill: PerModelConfig | null): boolean {
  return prefill !== null;
}

/** 表单 → `update_per_model_config` 的 `config` 体（`enabled` 恒 true：写路径归 `set_model_enabled`）。 */
export function perModelFormToBody(form: PerModelForm, provider: string): PerModelConfigBody {
  return new PerModelConfigBody(
    normalizeTokens(form.maxContext), normalizeTokens(form.maxOutput),
    perModelApiTypeForSubmit(form, provider), form.vision === true,
    perModelVisionDetailForSubmit(form),
  );
}
