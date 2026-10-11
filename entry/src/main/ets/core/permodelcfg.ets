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

import { API_TYPE_CHAT_COMPLETIONS, normalizeApiTypeForSubmit } from './settings';

/** `max_context` 预设（web `llm-console.tsx` `CTX_PRESETS`；0 = 跟随默认）。 */
export const CTX_PRESETS: number[] = [0, 32000, 64000, 128000, 200000, 1000000, 2000000];
/** `max_output_tokens` 预设（web `OUT_PRESETS`；0 = 跟随订阅默认）。 */
export const OUT_PRESETS: number[] = [0, 8192, 16384, 32768, 65536];
/** `vision_detail` 取值（OpenAI `image_url.detail`；`''` = auto）。 */
export const VISION_DETAILS: string[] = ['', 'low', 'high'];
/** 「跟随默认」显示文案（0 值）。 */
export const FOLLOW_DEFAULT_LABEL: string = '跟随默认';

/**
 * token 数的显示文案（web `llm-console.tsx:fmtTokens`）。
 * `<= 0` ⇒ 「跟随默认」；`>= 1e6` ⇒ `n M`；`>= 1000` ⇒ `n K`；否则原样。
 */
export function fmtTokens(n: number): string {
  if (!(n > 0)) {
    return FOLLOW_DEFAULT_LABEL;
  }
  if (n >= 1000000) {
    return `${Math.round(n / 100000) / 10}M`;
  }
  if (n >= 1000) {
    return `${Math.round(n / 100) / 10}K`;
  }
  return `${n}`;
}

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
