/**
 * 设置「llm → 模型 / 订阅 CRUD」的契约测试（波7）。
 *
 * 为什么必须有：订阅/模型的增删改**形状一错就是静默数据损坏**——
 *   · `add_subscription` 忘了 `sub` 外层、或字段名写错 ⇒ 服务端收不到 ⇒ 建出空订阅；
 *   · 编辑态把**掩码**当真 key 提交 ⇒ 会把掩码写进凭据（服务端已守卫，但客户端必须先归空）；
 *   · provider 切到 anthropic 仍带 `api_type` ⇒ 与服务端语义不符（anthropic 无此概念）。
 * 本测试逐条对齐 **web 权威基准**（`components/agent/api.ts:684-800` + `llm-console.tsx:403-494`
 * + `useLLMSettings.ts:171-382`）与服务端 params struct 的 json tag（`serverapp/rpc_table.go`）。
 */
declare const process: { exit: (c: number) => void };

import {
  AddSubscriptionParams, IdParams, RemoveModelParams, RPC_ADD_SUBSCRIPTION, RPC_REFRESH_MODEL_ENTRIES,
  RPC_REMOVE_MODEL, RPC_REMOVE_SUBSCRIPTION, RPC_SET_MODEL_ENABLED, RPC_UPDATE_PER_MODEL_CONFIG,
  RPC_UPDATE_SUBSCRIPTION, RPC_UPSERT_MODEL, RpcMethod, SetModelEnabledParams, SubscriptionBody,
  UpdateSubscriptionParams, UpsertModelParams,
} from '../../entry/src/main/ets/core/rpc';
import {
  API_TYPE_CHAT_COMPLETIONS, API_TYPE_RESPONSES, apiKeyForSubmit, editSubscriptionForm,
  filterSubscriptions, fmtTokens, isMaskedApiKey, isModelDisabled, isValidModelName,
  LLM_DEFAULT_BASE_URL, LLM_PROVIDER_ANTHROPIC, LLM_PROVIDER_IDS, LLM_PROVIDER_OPENAI,
  llmProviderLabel, llmProviderUrl, modelStatusLabel, modelsForSub, newSubscriptionForm,
  normalizeApiTypeForSubmit, normalizeModelName, subCardSubtitle, subscriptionFormError,
  subscriptionFormValid,
} from '../../entry/src/main/ets/core/settings';
import { ModelEntryRow, SubscriptionRow } from '../../entry/src/main/ets/core/rpc';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① method 字面量（服务端 / web 逐字一致；改名 ⇒ 404 unknown method）──────────────

eq('方法字面量（订阅 CRUD）', [RPC_ADD_SUBSCRIPTION, RPC_UPDATE_SUBSCRIPTION, RPC_REMOVE_SUBSCRIPTION],
  ['add_subscription', 'update_subscription', 'remove_subscription']);
eq('方法字面量（模型 CRUD）', [RPC_UPSERT_MODEL, RPC_REMOVE_MODEL, RPC_SET_MODEL_ENABLED,
  RPC_UPDATE_PER_MODEL_CONFIG, RPC_REFRESH_MODEL_ENTRIES],
  ['upsert_model', 'remove_model', 'set_model_enabled', 'update_per_model_config', 'refresh_model_entries']);
for (const m of [RPC_ADD_SUBSCRIPTION, RPC_UPDATE_SUBSCRIPTION, RPC_REMOVE_SUBSCRIPTION, RPC_UPSERT_MODEL,
  RPC_REMOVE_MODEL, RPC_SET_MODEL_ENABLED, RPC_UPDATE_PER_MODEL_CONFIG, RPC_REFRESH_MODEL_ENTRIES]) {
  ok(`ALL 登记了 ${m}`, RpcMethod.ALL.indexOf(m) >= 0);
}

// ── ② 请求形状（逐字段对齐服务端 json tag；web `api.ts:696-781`）──────────────────

const body = new SubscriptionBody();
body.name = 'My OpenAI';
body.provider = LLM_PROVIDER_OPENAI;
body.base_url = 'https://api.openai.com/v1';
body.api_key = 'sk-x';
body.model = 'gpt-5.2-turbo';
body.api_type = API_TYPE_CHAT_COMPLETIONS;
// add：外层必须是 `sub`（服务端 rpc_table.go:840 `Sub struct{...} \`json:"sub"\``）
eq('add_subscription 形状', JSON.stringify(new AddSubscriptionParams(body)),
  '{"sub":{"id":"","name":"My OpenAI","provider":"openai","base_url":"https://api.openai.com/v1",' +
  '"api_key":"sk-x","model":"gpt-5.2-turbo","active":false,"max_output_tokens":0,"thinking_mode":"",' +
  '"api_type":"chat_completions"}}');
// update：`{id, sub}`（服务端 :2606-2607）
eq('update_subscription 形状', JSON.stringify(new UpdateSubscriptionParams('sub-9', body)),
  '{"id":"sub-9","sub":{"id":"","name":"My OpenAI","provider":"openai","base_url":"https://api.openai.com/v1",' +
  '"api_key":"sk-x","model":"gpt-5.2-turbo","active":false,"max_output_tokens":0,"thinking_mode":"",' +
  '"api_type":"chat_completions"}}');
eq('remove_subscription 形状', JSON.stringify(new IdParams('sub-9')), '{"id":"sub-9"}');
// upsert_model：web `api.ts:774-780` 发 sub_id/model/max_context/max_output/api_type（thinking_mode 走零值）
eq('upsert_model 形状', JSON.stringify(new UpsertModelParams('sub-9', 'o4-mini', 0, 0, '')),
  '{"sub_id":"sub-9","model":"o4-mini","max_context":0,"max_output":0,"api_type":"","thinking_mode":""}');
eq('remove_model 形状', JSON.stringify(new RemoveModelParams('sub-9', 'o4-mini')),
  '{"sub_id":"sub-9","model":"o4-mini"}');
eq('set_model_enabled 形状', JSON.stringify(new SetModelEnabledParams('sub-9', 'o4-mini', false)),
  '{"sub_id":"sub-9","model":"o4-mini","enabled":false}');
// 判别力自证：字段名必须是 snake（`sub_id` 而非 `subId`）——写错服务端静默收零值
ok('upsert 字段名是 sub_id（非 subId）', JSON.stringify(new UpsertModelParams('s', 'm', 0, 0, '')).indexOf('"sub_id"') >= 0);

// ── ③ provider / api_type 取值域（web `llm-console.tsx:24-32`）──────────────────────

eq('provider 取值域', LLM_PROVIDER_IDS, ['openai', 'anthropic']);
eq('provider 显示名', [llmProviderLabel('openai'), llmProviderLabel('anthropic')], ['OpenAI', 'Anthropic']);
eq('provider 未知值透传', llmProviderLabel('deepseek'), 'deepseek');
eq('provider 空 → OpenAI', llmProviderLabel(''), 'OpenAI');
eq('provider 默认 URL', [llmProviderUrl('openai'), llmProviderUrl('anthropic'), llmProviderUrl('weird')],
  ['https://api.openai.com/v1', 'https://api.anthropic.com', LLM_DEFAULT_BASE_URL]);

// api_type 归一：openai 空兜底 chat_completions；anthropic 一律 ''
eq('api_type 归一（openai 显式）', normalizeApiTypeForSubmit('openai', 'responses'), 'responses');
eq('api_type 归一（openai 空 ⇒ 默认）', normalizeApiTypeForSubmit('openai', ''), API_TYPE_CHAT_COMPLETIONS);
eq('api_type 归一（anthropic ⇒ 空）', normalizeApiTypeForSubmit('anthropic', 'responses'), '');
eq('api_type 常量', [API_TYPE_CHAT_COMPLETIONS, API_TYPE_RESPONSES], ['chat_completions', 'responses']);

// ── ④ 表单默认值 / 校验（web `llm-console.tsx:411-426`）────────────────────────────

const nf = newSubscriptionForm();
eq('新增表单默认：协议/URL/api_type', [nf.provider, nf.baseUrl, nf.apiType],
  ['openai', 'https://api.openai.com/v1', 'chat_completions']);
eq('新增表单默认：空字段', [nf.id, nf.name, nf.apiKey, nf.model], ['', '', '', '']);

const editSub: SubscriptionRow = {
  id: 'sub-1', name: 'X', provider: 'anthropic', base_url: 'https://api.anthropic.com',
  api_key: 'abcd****', model: 'claude', active: true, enabled: true, api_type: 'responses',
};
const ef = editSubscriptionForm(editSub);
eq('编辑表单从订阅行填充', [ef.id, ef.name, ef.provider, ef.baseUrl, ef.model],
  ['sub-1', 'X', 'anthropic', 'https://api.anthropic.com', 'claude']);
eq('编辑表单回填掩码 key（显示用）', ef.apiKey, 'abcd****');
// api_type 缺失时回落到 chat_completions
const efNoApi = editSubscriptionForm({ id: 's', name: 'n', provider: 'openai', base_url: 'u', api_key: '', model: '', active: false });
eq('编辑表单 api_type 缺失 ⇒ 默认', efNoApi.apiType, 'chat_completions');

// 校验：name + base_url 必填；新增必需 key；编辑可空 key
eq('校验：新增缺 name 无效', subscriptionFormValid(Object.assign(newSubscriptionForm(), { baseUrl: 'u', apiKey: 'k' }), false), false);
const validNew = newSubscriptionForm();
validNew.name = 'N';
validNew.baseUrl = 'https://x';
validNew.apiKey = 'sk-1';
ok('校验：新增齐备通过', subscriptionFormValid(validNew, false));
const noKey = newSubscriptionForm();
noKey.name = 'N';
noKey.baseUrl = 'https://x';
eq('校验：新增缺 key 无效', subscriptionFormValid(noKey, false), false);
ok('校验：编辑缺 key 通过（不动凭据）', subscriptionFormValid(noKey, true));
const blankName = newSubscriptionForm();
blankName.baseUrl = 'https://x';
blankName.apiKey = 'k';
eq('校验：name 全空白无效', subscriptionFormValid(blankName, false), false);
const blankUrl = newSubscriptionForm();
blankUrl.name = 'N';
blankUrl.baseUrl = '   ';   // 覆盖默认 URL 为全空白
blankUrl.apiKey = 'k';
eq('校验：base_url 全空白无效', subscriptionFormValid(blankUrl, false), false);

// 错误文案（按钮禁用时的提示）
eq('错误：缺名称', subscriptionFormError(blankName, false).length > 0, true);
eq('错误：新增缺 key', subscriptionFormError(noKey, false).indexOf('API Key') >= 0, true);
eq('错误：齐备为空', subscriptionFormError(validNew, false), '');

// ── ⑤ 掩码 key 归一（web `useLLMSettings.ts:213` / `api.ts:854-856`）────────────────

ok('掩码判定：含 ****', isMaskedApiKey('abcd****'));
ok('掩码判定：真 key 非掩码', !isMaskedApiKey('sk-1234567890'));
eq('提交：掩码 → 空串', apiKeyForSubmit('abcd****'), '');
eq('提交：真 key 原样（trim）', apiKeyForSubmit('  sk-1  '), 'sk-1');
eq('提交：空 → 空', apiKeyForSubmit(''), '');
eq('提交：undefined → 空', apiKeyForSubmit(undefined), '');

// ── ⑥ 模型条目展示（web `SettingsLLM.tsx:349,463-466` / `llm-console.tsx:89-96`）──────

eq('模型禁用判定', [isModelDisabled('disabled'), isModelDisabled('normal'), isModelDisabled(undefined)],
  [true, false, false]);
eq('模型状态名', [modelStatusLabel('normal'), modelStatusLabel('offline'), modelStatusLabel('disabled')],
  ['可用', '离线', '已禁用']);
eq('模型状态名：未知透传', modelStatusLabel('weird'), 'weird');
eq('fmtTokens：0 ⇒ 跟随默认', fmtTokens(0), '跟随默认');
eq('fmtTokens：1M', fmtTokens(1000000), '1M');
eq('fmtTokens：2M', fmtTokens(2000000), '2M');
eq('fmtTokens：1.5M', fmtTokens(1500000), '1.5M');
eq('fmtTokens：128K', fmtTokens(128000), '128K');
eq('fmtTokens：小值原样', fmtTokens(512), '512');

const entries: ModelEntryRow[] = [
  { sub_id: 's1', sub_name: 'A', model: 'gpt-5.2-turbo', status: 'normal' },
  { sub_id: 's1', sub_name: 'A', model: 'o4-mini', status: 'disabled' },
  { sub_id: 's2', sub_name: 'B', model: 'claude', status: 'normal' },
];
eq('某订阅下的模型', modelsForSub(entries, 's1').map((e: ModelEntryRow) => e.model), ['gpt-5.2-turbo', 'o4-mini']);
eq('无匹配订阅模型', modelsForSub(entries, 'x').length, 0);

// ── ⑦ 搜索过滤（web `SettingsLLM.tsx:108-113`）─────────────────────────────────────

const subs: SubscriptionRow[] = [
  { id: 's1', name: 'My OpenAI', provider: 'openai', base_url: 'u', api_key: '', model: '', active: false },
  { id: 's2', name: 'Anthropic', provider: 'anthropic', base_url: 'u', api_key: '', model: '', active: false },
];
eq('搜索：空 ⇒ 全返回', filterSubscriptions(subs, entries, '').length, 2);
eq('搜索：命中名称（大小写不敏感）', filterSubscriptions(subs, entries, 'openai').map((s: SubscriptionRow) => s.id), ['s1']);
eq('搜索：命中 provider', filterSubscriptions(subs, entries, 'ANTHROP').map((s: SubscriptionRow) => s.id), ['s2']);
eq('搜索：命中模型名（跨订阅）', filterSubscriptions(subs, entries, 'claude').map((s: SubscriptionRow) => s.id), ['s2']);
eq('搜索：命中模型名（s1 的 o4-mini）', filterSubscriptions(subs, entries, 'o4').map((s: SubscriptionRow) => s.id), ['s1']);
eq('搜索：无命中', filterSubscriptions(subs, entries, 'zzz').length, 0);

// ── ⑧ 新模型名 / 副标题 ────────────────────────────────────────────────────────────

eq('模型名归一', [normalizeModelName('  o4-mini  '), normalizeModelName(undefined)], ['o4-mini', '']);
eq('模型名校验', [isValidModelName(' x '), isValidModelName('   '), isValidModelName('')], [true, false, false]);
eq('副标题：openai + responses', subCardSubtitle('https://api.openai.com/v1', 'openai', 'responses'),
  'api.openai.com/v1 · responses');
eq('副标题：openai 默认不提 responses', subCardSubtitle('https://api.openai.com/v1', 'openai', 'chat_completions'),
  'api.openai.com/v1');
eq('副标题：anthropic 忽略 api_type', subCardSubtitle('https://api.anthropic.com', 'anthropic', 'responses'),
  'api.anthropic.com');

console.log(`\n设置 llm CRUD：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
