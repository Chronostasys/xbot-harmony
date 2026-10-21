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
  IMPORT_BAD_FORMAT,
  IMPORT_EMPTY,
  IMPORT_OK,
  IMPORT_PARSE_ERROR,
  ImportParseResult,
  isSystemSubscription,
  parseSubscriptionsImport,
  resolveUpdateBody,
  serializeSubscriptionsDoc,
  subscriptionsDocCount,
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

describe('S12：订阅导出/导入（往返等价 + 校验可见失败）', () => {
  const doc: Object = {
    version: 1,
    subs: [
      { id: 'a', name: 'A', provider: 'openai', base_url: 'https://a', api_key: 'k', model: 'm1', max_output_tokens: 8192, thinking_mode: 'think' },
      { id: 'b', name: 'B', provider: 'anthropic', base_url: 'https://b', api_key: 'k2', model: 'm2' },
    ],
  }

  it('往返等价：serialize → parse 后 subs 与原文逐字相等', () => {
    const json: string = serializeSubscriptionsDoc(doc);
    const parsed: ImportParseResult = parseSubscriptionsImport(json);
    expect(parsed.kind).toBe(IMPORT_OK);
    expect(parsed.subs.length).toBe(2);
    // 深比较（JSON 往返后逐字相同）—— 这就是「导出→导入闭环」的判据。
    expect(JSON.stringify(parsed.subs)).toBe(JSON.stringify((doc as Record<string, Object>)['subs']));
  })

  it('serialize 是 2 空格缩进（web :65 `null, 2`）', () => {
    const json: string = serializeSubscriptionsDoc({ version: 1, subs: [{ id: 'x' }] });
    expect(json.indexOf('\n  "version"') >= 0).toBe(true);
  })

  it('subscriptionsDocCount：有 subs / 无 subs / subs 非数组', () => {
    expect(subscriptionsDocCount(doc)).toBe(2);
    expect(subscriptionsDocCount({ version: 1 })).toBe(0);
    expect(subscriptionsDocCount({ subs: 'oops' })).toBe(0);
  })

  it('坏 JSON ⇒ parseError（不静默半导入）', () => {
    // mutation：把 try/catch 去掉（直接 JSON.parse）⇒ 抛异常 ⇒ 必红。
    expect(parseSubscriptionsImport('not-json{').kind).toBe(IMPORT_PARSE_ERROR);
  })

  it('顶层缺 subs / subs 非数组 ⇒ badFormat', () => {
    expect(parseSubscriptionsImport('{"version":1}').kind).toBe(IMPORT_BAD_FORMAT);
    // mutation：删掉 Array.isArray(subs) 校验 ⇒ 此例返回 ok ⇒ 必红。
    expect(parseSubscriptionsImport('{"subs":"nope"}').kind).toBe(IMPORT_BAD_FORMAT);
    expect(parseSubscriptionsImport('123').kind).toBe(IMPORT_BAD_FORMAT);
  })

  it('subs 为空数组 ⇒ empty（可见失败）', () => {
    expect(parseSubscriptionsImport('{"version":1,"subs":[]}').kind).toBe(IMPORT_EMPTY);
  })
})

process.exit(summary('llmcfg'));

export {};
