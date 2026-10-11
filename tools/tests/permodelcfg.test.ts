/**
 * `core/permodelcfg.ets` —— 逐模型配置判据的**判别力**回归守卫。
 *
 * 背景：这是 web LLM 控制台里**原生唯一缺失**的一块（`update_per_model_config`）。
 * 权威：web `SettingsLLM.tsx:150-160` + `llm-console.tsx`（`CTX_PRESETS`/`OUT_PRESETS`/vision）。
 *
 * ⚠️ **判别力自证（改坏任一锚点 ⇒ 本用例必红）**：
 *   · 把 `perModelVisionDetailForSubmit` 改成 `return form.visionDetail`（vision 关不清空）
 *     ⇒ "vision 关必须清空 detail" 红（会把上一次的 detail 带给服务端）。
 *   · 把 `perModelApiTypeForSubmit` 改成直接 `return form.apiType`（不走订阅级归一）
 *     ⇒ Anthropic + 'responses' 那条红（Anthropic 无 api_type 概念，必须空串）。
 *   · 把 `fmtTokens` 的 `<= 0 ⇒ 跟随默认` 去掉 ⇒ 0 值档红。
 *   · 把 `normalizeTokens` 的 `n > 0` 改成 `n >= 0`（负值不归零）⇒ 负值档红。
 */

declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import {
  CTX_PRESETS, OUT_PRESETS, VISION_DETAILS, FOLLOW_DEFAULT_LABEL,
  fmtTokens, presetLabel, normalizeTokens, perModelApiTypes, perModelApiTypeForSubmit,
  perModelVisionDetailForSubmit, perModelFormError, perModelFormOf, perModelSummary,
  perModelConfigFrom, perModelEditReason, perModelFormFromConfig, perModelSubmitAllowed, perModelFormToBody,
} from '../../entry/src/main/ets/core/permodelcfg';
import { PerModelConfig, SubscriptionRow } from '../../entry/src/main/ets/core/rpc';

describe('permodelcfg：token 显示 / 归零', () => {
  it('0（含负）⇒ 「跟随默认」', () => {
    expect(fmtTokens(0)).toBe(FOLLOW_DEFAULT_LABEL);
    expect(fmtTokens(-1)).toBe(FOLLOW_DEFAULT_LABEL);
  });
  it('K / M 档', () => {
    expect(fmtTokens(32000)).toBe('32K');
    expect(fmtTokens(200000)).toBe('200K');
    expect(fmtTokens(1000000)).toBe('1M');
    expect(fmtTokens(512)).toBe('512');
  });
  it('预设档的标签与预设表一一对应', () => {
    for (let i = 0; i < CTX_PRESETS.length; i++) {
      expect(presetLabel(CTX_PRESETS[i])).toBe(fmtTokens(CTX_PRESETS[i]));
    }
    for (let i = 0; i < OUT_PRESETS.length; i++) {
      expect(presetLabel(OUT_PRESETS[i])).toBe(fmtTokens(OUT_PRESETS[i]));
    }
  });
  it('负值归 0（0 = 跟随默认，负值无意义）', () => {
    expect(normalizeTokens(-5)).toBe(0);
    expect(normalizeTokens(0)).toBe(0);
    expect(normalizeTokens(10.9)).toBe(10);
    expect(normalizeTokens(8192)).toBe(8192);
  });
});

describe('permodelcfg：api_type 归一（复用订阅级同一条判据）', () => {
  it('Anthropic 无 api_type 概念 ⇒ 空数组 / 提交空串', () => {
    expect(perModelApiTypes('anthropic')).toEqual([]);
    const f = perModelFormOf(0, 0, 'responses', false, '');
    expect(perModelApiTypeForSubmit(f, 'anthropic')).toBe('');
  });
  it('OpenAI：空 ⇒ 默认 chat_completions；显式 responses 原样', () => {
    const empty = perModelFormOf(0, 0, '', false, '');
    expect(perModelApiTypeForSubmit(empty, 'openai')).toBe('chat_completions');
    const resp = perModelFormOf(0, 0, 'responses', false, '');
    expect(perModelApiTypeForSubmit(resp, 'openai')).toBe('responses');
    expect(perModelApiTypes('openai')).toEqual(['chat_completions', 'responses']);
  });
});

describe('permodelcfg：vision', () => {
  it('vision 关 ⇒ vision_detail 必须清空', () => {
    const off = perModelFormOf(0, 0, '', false, 'high');
    expect(perModelVisionDetailForSubmit(off)).toBe('');
  });
  it('vision 开 ⇒ detail 原样（含 auto = 空串）', () => {
    expect(perModelVisionDetailForSubmit(perModelFormOf(0, 0, '', true, 'low'))).toBe('low');
    expect(perModelVisionDetailForSubmit(perModelFormOf(0, 0, '', true, ''))).toBe('');
  });
});

describe('permodelcfg：表单校验与摘要', () => {
  it('负值 / 非法 api_type / 非法 detail 都能被指出', () => {
    expect(perModelFormError(perModelFormOf(-1, 0, '', false, ''), 'openai').length > 0).toBe(true);
    expect(perModelFormError(perModelFormOf(0, -1, '', false, ''), 'openai').length > 0).toBe(true);
    expect(perModelFormError(perModelFormOf(0, 0, 'chat_completions', false, ''), 'openai')).toBe('');
    expect(perModelFormError(perModelFormOf(0, 0, 'bogus', false, ''), 'openai').length > 0).toBe(true);
    expect(perModelFormError(perModelFormOf(0, 0, '', true, 'weird'), 'openai').length > 0).toBe(true);
    // Anthropic：空 api_type 合法（无此概念）
    expect(perModelFormError(perModelFormOf(0, 0, '', false, ''), 'anthropic')).toBe('');
  });
  it('摘要含四段（上限 / 输出 / api / 视觉）', () => {
    const s = perModelSummary(perModelFormOf(0, 0, '', true, 'high'), 'openai');
    expect(s).toContain('跟随默认');
    expect(s).toContain('chat_completions');
    expect(s).toContain('视觉 high');
    const s2 = perModelSummary(perModelFormOf(0, 0, '', false, ''), 'anthropic');
    expect(s2).toContain('无视觉');
    expect(s2).toContain('api 默认');
  });
  it('预设表非空且含 0（跟随默认）', () => {
    expect(CTX_PRESETS[0]).toBe(0);
    expect(OUT_PRESETS[0]).toBe(0);
    expect(VISION_DETAILS.length).toBe(3);
  });
});

describe('permodelcfg：预填判据（★A–★D，防静默覆盖）', () => {
  // 造一个最小 SubscriptionRow（只填判据关心的字段；其余按类型给中性值）
  const base = (pmc: Record<string, PerModelConfig> | undefined): SubscriptionRow => {
    const r: SubscriptionRow = {
      id: 's1', name: 'n', provider: 'openai', base_url: 'u', api_key: 'abcd****',
      model: 'gpt-4o', active: true,
    };
    r.per_model_configs = pmc;
    return r;
  };

  it('★C 整键缺失 ⇒ null（⛔ 绝不是"全零对象"）', () => {
    const row = base(undefined);
    const got = perModelConfigFrom(row, 'gpt-4o');
    expect(got).toBe(null);
    expect(perModelSubmitAllowed(got)).toBe(false);
    expect(perModelEditReason(row, 'gpt-4o').length > 0).toBe(true);
  });

  it('★A 条目缺失（map 在、模型不在）⇒ null（不伪造 0/false）', () => {
    const row = base({ 'other-model': { max_context: 128000 } });
    const got = perModelConfigFrom(row, 'gpt-4o');
    expect(got).toBe(null);
    expect(perModelSubmitAllowed(got)).toBe(false);
  });

  it('★B 预填不成功 ⇒ 提交闸门关闭（不产 payload）', () => {
    expect(perModelSubmitAllowed(null)).toBe(false);
    const ok = perModelConfigFrom(base({ 'gpt-4o': {} }), 'gpt-4o');
    expect(perModelSubmitAllowed(ok)).toBe(true);
  });

  it('★D 字段类型不符 ⇒ null，且不抛', () => {
    // 运行期形状异常（把 max_context 写成字符串）——⛔ 不许抛、也不许当 0 用
    const bad: Record<string, PerModelConfig> = {};
    bad['gpt-4o'] = { max_context: '128000' } as unknown as PerModelConfig;
    expect(perModelConfigFrom(base(bad), 'gpt-4o')).toBe(null);
    const bad2: Record<string, PerModelConfig> = {};
    bad2['gpt-4o'] = { vision: 'yes' } as unknown as PerModelConfig;
    expect(perModelConfigFrom(base(bad2), 'gpt-4o')).toBe(null);
  });

  it('条目在、子字段缺省 ⇒ **合法**，按 0/false/\'\' 落位（服务端 omitempty）', () => {
    const row = base({ 'gpt-4o': { max_context: 128000 } });
    const got = perModelConfigFrom(row, 'gpt-4o');
    expect(got !== null).toBe(true);
    if (got !== null) {
      expect(got.max_context).toBe(128000);
      expect(got.max_output_tokens).toBe(0);
      expect(got.api_type).toBe('');
      expect(got.vision).toBe(false);
      expect(got.vision_detail).toBe('');
    }
    expect(perModelEditReason(row, 'gpt-4o')).toBe('');
  });

  it('预填 → 表单 → 提交体（端到端同源）', () => {
    const row = base({ 'gpt-4o': { max_context: 200000, vision: true, vision_detail: 'high' } });
    const cfg = perModelConfigFrom(row, 'gpt-4o');
    expect(cfg !== null).toBe(true);
    if (cfg !== null) {
      const form = perModelFormFromConfig(cfg);
      expect(form.maxContext).toBe(200000);
      expect(form.vision).toBe(true);
      expect(form.visionDetail).toBe('high');
      const body = perModelFormToBody(form, 'openai');
      expect(body.max_context).toBe(200000);
      expect(body.max_output_tokens).toBe(0);
      expect(body.api_type).toBe('chat_completions');
      expect(body.vision).toBe(true);
      expect(body.vision_detail).toBe('high');
      expect(body.enabled).toBe(true);
    }
  });
});

process.exit(summary('permodelcfg'));
