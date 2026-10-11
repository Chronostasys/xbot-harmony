/**
 * llmcfg.test.ts —— S-P0 判别力测试：「编辑订阅不得覆盖未展示字段」。
 *
 * 背景（真数据丢失）：服务端 `update_subscription` 对 `thinking_mode`/`max_output_tokens`
 * 是 **always accept**（`serverapp/rpc_table.go:2654/2658`）⇒ 提交 0/'' 会直接落库覆盖真值。
 * 原生表单不含这两字段 ⇒ 旧实现恒发 0/'' ⇒ **每次保存编辑都清零**。
 * web 权威：`src/hooks/useLLMSettings.ts:219-220` 的 `?? existing?.X ?? 默认`。
 *
 * 本测试锁死 `core/llmcfg.ets` 的合并/保留语义。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { SubscriptionBody, SubscriptionRow } from '../../entry/src/main/ets/core/rpc';
import {
  applyInheritedSubFields,
  findSubscriptionById,
  isSystemSubscription,
  resolveUpdateBody,
} from '../../entry/src/main/ets/core/llmcfg';

function row(id: string, maxOutput?: number, thinking?: string): SubscriptionRow {
  const r: SubscriptionRow = {
    id, name: 'n', provider: 'openai', base_url: 'https://x', api_key: 'abcd****',
    model: 'm', active: false,
  };
  if (maxOutput !== undefined) r.max_output_tokens = maxOutput;
  if (thinking !== undefined) r.thinking_mode = thinking;
  return r;
}

/** 旧实现的裸体（无继承）——用于反证：任一新断言对裸体必红。 */
function bareBody(): SubscriptionBody {
  return new SubscriptionBody(); // max_output_tokens=0, thinking_mode=''
}

describe('S-P0：编辑订阅必须继承 max_output_tokens / thinking_mode', () => {
  it('继承既有值（真数据不丢）', () => {
    const subs: SubscriptionRow[] = [row('sub-1', 8192, 'think')];
    const body: SubscriptionBody = bareBody();
    body.name = 'edited';
    const out: SubscriptionBody = resolveUpdateBody(body, subs, 'sub-1');
    // 核心断言：不得被表单默认值清零。
    expect(out.max_output_tokens).toBe(8192);
    expect(out.thinking_mode).toBe('think');
  })

  it('findSubscriptionById：命中 / 未命中', () => {
    const subs: SubscriptionRow[] = [row('a', 1, 'auto'), row('b', 2, 'think')];
    expect(findSubscriptionById(subs, 'b')?.id).toBe('b');
    expect(findSubscriptionById(subs, 'zzz')).toBeUndefined();
  })

  it('新增（无既有行）⇒ 保持请求体默认（0 / \'\'），与 web 一致', () => {
    const subs: SubscriptionRow[] = [row('a', 8192, 'think')];
    const out: SubscriptionBody = resolveUpdateBody(bareBody(), subs, '');
    expect(out.max_output_tokens).toBe(0);
    expect(out.thinking_mode).toBe('');
  })

  it('既有行字段 omitempty 未下发（undefined）⇒ 不写 undefined，保持默认', () => {
    const subs: SubscriptionRow[] = [row('a')]; // 两字段均 undefined
    const out: SubscriptionBody = resolveUpdateBody(bareBody(), subs, 'a');
    expect(out.max_output_tokens).toBe(0);
    expect(out.thinking_mode).toBe('');
  })

  it('部分下发：只继承 max_output_tokens，thinking_mode 保持默认', () => {
    const subs: SubscriptionRow[] = [row('a', 4096)];
    const out: SubscriptionBody = resolveUpdateBody(bareBody(), subs, 'a');
    expect(out.max_output_tokens).toBe(4096);
    expect(out.thinking_mode).toBe('');
  })

  it('applyInheritedSubFields 就地返回同一对象（链式契约）', () => {
    const body: SubscriptionBody = bareBody();
    const out: SubscriptionBody = applyInheritedSubFields(body, row('a', 7, 'x'));
    expect(out).toBe(body);
    expect(out.max_output_tokens).toBe(7);
    expect(out.thinking_mode).toBe('x');
  })

  it('不污染其它字段（name/provider/base_url/model 原样）', () => {
    const body: SubscriptionBody = bareBody();
    body.name = 'N'; body.provider = 'openai'; body.base_url = 'https://y'; body.model = 'M'; body.api_type = 'responses';
    resolveUpdateBody(body, [row('a', 1, 'think')], 'a');
    expect(body.name).toBe('N');
    expect(body.provider).toBe('openai');
    expect(body.base_url).toBe('https://y');
    expect(body.model).toBe('M');
    expect(body.api_type).toBe('responses');
  })
})

describe('S7：is_system 订阅门控（编辑/删除/加模型）', () => {
  it('is_system=true ⇒ true（隐藏编辑/删除/登记）', () => {
    const r: SubscriptionRow = row('s', 1, 'think');
    (r as unknown as { is_system?: boolean }).is_system = true;
    expect(isSystemSubscription(r)).toBe(true);
  })

  it('is_system 缺省（omitempty 未下发）⇒ false（普通订阅照常可编辑）', () => {
    expect(isSystemSubscription(row('s', 1, 'think'))).toBe(false);
  })

  it('is_system=false 显式 ⇒ false（不得误判为非系统以外的真值）', () => {
    const r: SubscriptionRow = row('s');
    (r as unknown as { is_system?: boolean }).is_system = false;
    // mutation：把判据改成 `r.is_system !== undefined` ⇒ 此处返回 true ⇒ 必红。
    expect(isSystemSubscription(r)).toBe(false);
  })
})

process.exit(summary('llmcfg'));
