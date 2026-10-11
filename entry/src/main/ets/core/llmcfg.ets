/**
 * core/llmcfg.ets —— 「LLM 订阅更新」的纯逻辑（脱机可单测；**零** ArkUI/@ohos 依赖）。
 *
 * 为什么单独成文件：`core/settings.ets`（llm 分区的其余纯逻辑）由 notify-pro 线独占，
 * 本文件承载「编辑订阅时不得用本地默认值覆盖服务端已有字段」这条 P0 判据所需的纯函数。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * P0 根因（2026-10-11 审计，原生 vs web 权威）：
 *
 *   服务端 `update_subscription` 对 `thinking_mode` / `max_output_tokens` 是
 *   **always accept**（`serverapp/rpc_table.go:2654` `dbSub.ThinkingMode = p.Sub.ThinkingMode`、
 *   `:2658` `dbSub.MaxOutputTokens = p.Sub.MaxOutputTokens`）—— 0 / '' 是"合法值"，
 *   会**直接落库覆盖真值**（只有 name/provider/base_url/api_key 有掩码/空值守卫）。
 *
 *   web 因此在 `web/src/hooks/useLLMSettings.ts:216-222` 用既有订阅合并：
 *     `max_output_tokens: sub.max_output_tokens ?? existing?.max_output_tokens ?? 0`
 *     `thinking_mode:    sub.thinking_mode    ?? existing?.thinking_mode    ?? ''`
 *
 *   原生 `SettingsLlm.submitForm` 之前**从不**设置这两个字段 ⇒ 恒发 `0` / `''`
 *   （`core/rpc.ets:300-301` 的 SubscriptionBody 默认值）⇒ **每次从原生保存编辑，
 *   都会把一条订阅的 max_output_tokens / thinking_mode 清零**（静默数据丢失）。
 *
 * 修法：提交前从 `this.subs` 里按 id 找到既有行，沿用其这两个字段（本文件的纯函数）。
 * 「保存后以后端为准」由 `SettingsLlm.submitForm` 的 `finally → await this.load()` 保证。
 */

import { SubscriptionBody, SubscriptionRow } from './rpc';

/** 按 id 查既有订阅（web `data.subscriptions.find(s => s.id === id)`，`useLLMSettings.ts:215`）。 */
export function findSubscriptionById(subs: SubscriptionRow[], id: string): SubscriptionRow | undefined {
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].id === id) {
      return subs[i];
    }
  }
  return undefined;
}

/**
 * 把既有订阅行的 `max_output_tokens` / `thinking_mode` 沿用进待提交的请求体
 * （逐字对齐 web `useLLMSettings.ts:219-220` 的 `?? existing?.X ?? 默认` 合并语义）。
 *
 * · `existing` 缺失（新增订阅 / 查不到）⇒ **保持请求体默认值**（0 / ''），与 web 一致（新增无既有值）。
 * · 字段为 `undefined`/`null`（服务端 `omitempty` 未下发）⇒ 保持默认值，不写 `undefined`。
 * · 就地修改并返回同一 `body`（便于链式）。
 *
 * ⛔ 判据：本函数返回后，`body.max_output_tokens === existing.max_output_tokens` 且
 *    `body.thinking_mode === existing.thinking_mode`（当两者均已下发时）。
 */
export function applyInheritedSubFields(body: SubscriptionBody, existing: SubscriptionRow | undefined): SubscriptionBody {
  if (existing !== undefined && existing !== null) {
    const mo: number | undefined = existing.max_output_tokens;
    if (mo !== undefined && mo !== null) {
      body.max_output_tokens = mo;
    }
    const tm: string | undefined = existing.thinking_mode;
    if (tm !== undefined && tm !== null) {
      body.thinking_mode = tm;
    }
  }
  return body;
}

/**
 * 一步到位：为「编辑订阅」构造**不会覆盖服务端字段**的请求体。
 *
 * 调用点（`SettingsLlm.submitForm`）在编辑态用它替换裸 `SubscriptionBody`
 * —— 新增态仍用裸体（无既有值可沿用）。
 */
export function resolveUpdateBody(body: SubscriptionBody, subs: SubscriptionRow[], id: string): SubscriptionBody {
  return applyInheritedSubFields(body, findSubscriptionById(subs, id));
}

/**
 * 订阅行是否**系统内置**（服务端 `is_system`）。
 *
 * `core/rpc.ets` 的 `SubscriptionRow` 欠声明该字段（服务端确实下发）⇒ 用元素级加宽读出，
 * 不越界改 rpc.ets（该文件有主）。
 */
export interface SystemFlaggedRow {
  is_system?: boolean;
}

/**
 * is_system 订阅**禁止编辑凭据 / 加模型 / 删除** —— 对齐 web `SettingsLLM.tsx:426/449/483`
 * 的 `!detailSub.is_system` 三处门控（编辑按钮 / 加模型按钮 / 底部「设为默认+删除」行）。
 * 启用开关与逐模型启停**不**受此门控（web 亦然）。
 */
export function isSystemSubscription(sub: SubscriptionRow): boolean {
  const r: SystemFlaggedRow = sub as SystemFlaggedRow;
  return r.is_system === true;
}

// ─── S12：订阅导出 / 导入（web `SettingsLLM.tsx:55-76` + `:179-209`）──────────────
//
// 契约：导出文档 = `import_subscriptions` 的入参（顶层 `{version, subs:[...]}`）⇒
// 「导出→导入」闭环。⛔ 导入必须**先校验、可见失败**，绝不静默半导入。

/** 导入解析档位（判别字符串，ArkTS 友好）。 */
export const IMPORT_OK: string = 'ok';
export const IMPORT_EMPTY: string = 'empty';
export const IMPORT_BAD_FORMAT: string = 'badFormat';
export const IMPORT_PARSE_ERROR: string = 'parseError';

/** 导入解析结果（判别联合的 class 形态）。 */
export class ImportParseResult {
  /** `ok` | `empty` | `badFormat` | `parseError`。 */
  kind: string = IMPORT_PARSE_ERROR;
  /** 解析出的订阅数组（仅 `ok` 时非空）。 */
  subs: Object[] = [];
}

/**
 * 导出序列化（web `SettingsLLM.tsx:65` `JSON.stringify(resp, null, 2)`）—— 2 空格缩进。
 * 内容原样透传（不解释字段），保证「导出文档 = 导入入参」的往返等价。
 */
export function serializeSubscriptionsDoc(resp: Object): string {
  return JSON.stringify(resp, null, 2);
}

/** 导出回包里的订阅条数（无 `subs` 数组 ⇒ 0 ⇒ UI 提示"没有可导出的订阅"，web `:61-64`）。 */
export function subscriptionsDocCount(resp: Object): number {
  const subs: Object | undefined = (resp as Record<string, Object>)['subs'];
  return Array.isArray(subs) ? (subs as Object[]).length : 0;
}

/**
 * 解析导入文档（web `SettingsLLM.tsx:187-198` 的校验分支，一比一）：
 *   · JSON 解析失败            ⇒ `parseError`（对 web 的 `importFailed: msg`）
 *   · 顶层不是对象 / `subs` 非数组 ⇒ `badFormat`（对 web 的 `importBadFormat`）
 *   · `subs` 为空数组          ⇒ `empty`
 *   · 否则                     ⇒ `ok` + subs
 *
 * ⛔ 这是"不静默半导入"的**唯一判据点**：非 `ok` 一律不发起 `import_subscriptions`。
 */
export function parseSubscriptionsImport(raw: string): ImportParseResult {
  let parsed: Object;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (e) {
    return new ImportParseResult(); // kind = parseError
  }
  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    const bad: ImportParseResult = new ImportParseResult();
    bad.kind = IMPORT_BAD_FORMAT;
    return bad;
  }
  const subsRaw: Object | undefined = (parsed as Record<string, Object>)['subs'];
  if (!Array.isArray(subsRaw)) {
    const bad: ImportParseResult = new ImportParseResult();
    bad.kind = IMPORT_BAD_FORMAT;
    return bad;
  }
  const subs: Object[] = subsRaw as Object[];
  const out: ImportParseResult = new ImportParseResult();
  if (subs.length === 0) {
    out.kind = IMPORT_EMPTY;
    return out;
  }
  out.kind = IMPORT_OK;
  out.subs = subs;
  return out;
}
