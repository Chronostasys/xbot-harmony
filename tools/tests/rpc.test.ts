/**
 * RPC 地基**契约测试** —— `POST /api/rpc {method, params}` 的序列化形状与 method 常量表。
 *
 * 为什么必须有：原生侧的 `RpcReq`（reqbody.ets:235）**只有 method、没有 params**，
 * 而 web 的全部设置面都是 `{method, params}`（web `lib/api.ts:29-33`）。
 * 形状错了不是"少个功能"，而是**服务端收不到参数**（静默按零值处理）——
 * 例如 `set_tool_enabled` 丢了 `enabled` 就恒等于"关闭该工具"。
 *
 * 断言分四组：
 *   ① 序列化形状（{method, params} / 空 params / 各具名 params 类的字段集）
 *   ② method 常量表完整性（具名常量都登记进 ALL、无重复、字面量与 web/服务端一致）
 *   ③ 工具归一 + MCP 分组（server_name → serverName 的**静默失效**根因守卫）
 *   ④ rpc<T>() 薄封装（路径 / body / 返回值解包；错误原样抛出）
 */
declare const process: { exit: (c: number) => void };

import {
  AGENT_KEY_ALLOW_SELF_COMPACT, AGENT_KEY_VISION_JPEG_QUALITY, AGENT_KEY_VISION_MAX_IMAGE_BYTES,
  AGENT_KEY_VISION_MAX_IMAGE_EDGE_PX, AGENT_KEY_VISION_OUTPUT_FORMAT, AGENT_SETTING_KEYS,
  boolSettingValue, buildToolsView, buildVisionWrites, BYTES_PER_MB, bytesToMbInput, clampSettingInt,
  countModelsForSub,
  DefaultSubscriptionParams, defaultSubscriptionId, displayApiKey,
  EmptyParams, ENTRY_MCP_HEAD, flattenToolsView, GetSettingsParams, isSubscriptionEnabled,
  mbInputToBytes, McpGroup, ModelEntryRow,
  normalizeToolSetting, normalizeToolsSettings, normalizeVisionFormat, providerLine, RawToolSetting,
  readableRpcError, rpc,
  RpcMethod, RpcParamsReq, RPC_GET_SETTINGS, RPC_GET_TOOLS_SETTINGS, RPC_PATH,
  RPC_GET_LLM_CONCURRENCY, RPC_GET_USER_THINKING_MODE,
  RPC_LIST_ALL_MODEL_ENTRIES, RPC_LIST_SUBSCRIPTIONS, RPC_RUNNER_LIST,
  RPC_SET_DEFAULT_SUBSCRIPTION, RPC_SET_LLM_CONCURRENCY, RPC_SET_SETTING,
  RPC_SET_SUBSCRIPTION_ENABLED, RPC_SET_TOOL_ENABLED, RPC_SET_USER_THINKING_MODE,
  RPC_WEB_PLUGIN_LIST, setToolsEnabled, settingIsTrue, settingValue, SetSettingParams,
  SETTINGS_NS_CLI, SettingWrite, stripScheme, SubscriptionEnabledParams, SubscriptionRow,
  ToolEnabledParams, ToolSettingRow, ToolsEntry, toolsEntryBusyKey, toolsEntryKey, ToolsSettingsData,
  VISION_DEFAULT_EDGE_PX, VISION_DEFAULT_JPEG_QUALITY, VISION_DEFAULT_MAX_IMAGE_MB,
  VISION_FORMATS, VISION_FORMAT_AUTO, VISION_FORMAT_JPEG,
} from '../../entry/src/main/ets/core/rpc';
import { XbotHttp } from '../../entry/src/main/ets/core/http';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① 序列化形状 ──────────────────────────────────────────────────────────────

// 最关键的形状守卫：body 必须是 `{method, params}` 两个键（web: postAPI('/api/rpc', {method, params})）
eq('RPC body 形状', Object.keys(JSON.parse(JSON.stringify(new RpcParamsReq('x'))) as object).sort(),
  ['method', 'params']);
eq('RPC body 字面量（空 params）', JSON.stringify(new RpcParamsReq('runner_list')),
  '{"method":"runner_list","params":{}}');
eq('空 params 类序列化为 {}', JSON.stringify(new EmptyParams()), '{}');

// 各具名 params 类的字段集 = 服务端结构的字段集（逐条对照 rpc_table.go）
eq('set_tool_enabled params', JSON.stringify(new ToolEnabledParams('Read', true)),
  '{"name":"Read","enabled":true}');
eq('set_subscription_enabled params', JSON.stringify(new SubscriptionEnabledParams('sub-1', false)),
  '{"sub_id":"sub-1","enabled":false}');
// ⚠️ set_default_subscription 的字段名是 `id`（不是 sub_id）—— web agent/api.ts:751-753
eq('set_default_subscription params', JSON.stringify(new DefaultSubscriptionParams('sub-1')),
  '{"id":"sub-1","chat_id":""}');
eq('RPC 路径常量', RPC_PATH, '/api/rpc');

// ── ② method 常量表完整性 ────────────────────────────────────────────────────

const NAMED: string[] = [
  RPC_RUNNER_LIST, RPC_WEB_PLUGIN_LIST, RPC_GET_TOOLS_SETTINGS, RPC_SET_TOOL_ENABLED,
  RPC_LIST_SUBSCRIPTIONS, RPC_LIST_ALL_MODEL_ENTRIES, RPC_SET_SUBSCRIPTION_ENABLED,
  RPC_SET_DEFAULT_SUBSCRIPTION, RPC_GET_SETTINGS, RPC_SET_SETTING,
  // 波6 新增（llm 分区：并发 / 思考模式）—— `rpc_table.go:690-695,714-729`
  RPC_GET_LLM_CONCURRENCY, RPC_SET_LLM_CONCURRENCY, RPC_GET_USER_THINKING_MODE,
  RPC_SET_USER_THINKING_MODE,
];
for (let i = 0; i < NAMED.length; i++) {
  ok(`ALL 登记了 ${NAMED[i]}`, RpcMethod.ALL.indexOf(NAMED[i]) >= 0);
}
eq('ALL 无重复', new Set(RpcMethod.ALL).size, RpcMethod.ALL.length);
eq('ALL 数量 = 具名常量数', RpcMethod.ALL.length, NAMED.length);
// 字面量必须与 web / 服务端逐字一致（改名服务端就 404 unknown method）
eq('字面量：tools', [RPC_GET_TOOLS_SETTINGS, RPC_SET_TOOL_ENABLED], ['get_tools_settings', 'set_tool_enabled']);
eq('字面量：llm', [RPC_LIST_SUBSCRIPTIONS, RPC_LIST_ALL_MODEL_ENTRIES, RPC_SET_SUBSCRIPTION_ENABLED,
  RPC_SET_DEFAULT_SUBSCRIPTION], ['list_subscriptions', 'list_all_model_entries',
  'set_subscription_enabled', 'set_default_subscription']);
eq('字面量：settings', [RPC_GET_SETTINGS, RPC_SET_SETTING], ['get_settings', 'set_setting']);
// 静态访问形式与具名常量同值
eq('静态表与常量一致', [RpcMethod.getToolsSettings, RpcMethod.setToolEnabled, RpcMethod.getSettings,
  RpcMethod.setSetting], [RPC_GET_TOOLS_SETTINGS, RPC_SET_TOOL_ENABLED, RPC_GET_SETTINGS, RPC_SET_SETTING]);

// settings 两个 method 的 params 形状（服务端 rpc_table.go:450-453 / 506-511）
eq('get_settings params', JSON.stringify(new GetSettingsParams(SETTINGS_NS_CLI)),
  '{"namespace":"cli","sender_id":""}');
eq('set_setting params', JSON.stringify(new SetSettingParams(SETTINGS_NS_CLI, 'k', 'v')),
  '{"namespace":"cli","sender_id":"","key":"k","value":"v"}');
eq('namespace 常量 = cli', SETTINGS_NS_CLI, 'cli');

// ── ③ 工具归一 + MCP 分组（静默失效根因守卫）────────────────────────────────

// 判别力自证：**未归一**时直接读 camelCase 字段就是 undefined（web 那次事故的确切形态）
const rawSnake: RawToolSetting = { name: 'mcp__fs__read', description: 'fs', enabled: true, server_name: 'fs' };
eq('自证：原始 camelCase 字段不存在', (rawSnake as RawToolSetting).serverName, undefined);
// 归一后必须拿到 serverName
eq('snake_case 归一 → serverName', normalizeToolSetting(rawSnake).serverName, 'fs');
eq('已归一形态兼容（camel 回退）',
  normalizeToolSetting({ name: 't', enabled: false, serverName: 'gh' }).serverName, 'gh');
eq('内置工具 serverName 为空', normalizeToolSetting({ name: 'Bash', enabled: true }).serverName, '');
eq('缺 server_name ⇒ 空（不炸）', normalizeToolSetting({ name: 'Bash', enabled: true }).description, '');
eq('enabled 非 true 即 false', normalizeToolSetting({ name: 'x', enabled: false as boolean } as RawToolSetting).enabled, false);
// 缺 tools 字段容错
eq('缺 tools ⇒ 空数组', normalizeToolsSettings(undefined).length, 0);
eq('缺 tools（对象在）⇒ 空数组', normalizeToolsSettings({} as ToolsSettingsData).length, 0);

const rows: ToolSettingRow[] = normalizeToolsSettings({
  tools: [
    { name: 'Bash', description: 'b', enabled: true },
    { name: 'mcp__fs__read', enabled: true, server_name: 'fs' },
    { name: 'mcp__fs__write', enabled: false, server_name: 'fs' },
    { name: 'mcp__gh__pr', enabled: true, server_name: 'gh' },
  ],
} as ToolsSettingsData);
eq('归一后行数', rows.length, 4);

const view = buildToolsView(rows);
eq('内置工具数', view.builtin.length, 1);
eq('内置工具名', view.builtin[0].name, 'Bash');
eq('MCP 组数', view.mcpGroups.length, 2);
eq('MCP 组顺序 = 首次出现顺序', view.mcpGroups.map((g: McpGroup) => g.server), ['fs', 'gh']);
eq('fs 组工具数', view.mcpGroups[0].tools.length, 2);
eq('fs 组非全开（read 开 write 关）', view.mcpGroups[0].allEnabled, false);
eq('gh 组全开', view.mcpGroups[1].allEnabled, true);
eq('摘要：启用数 / 总数', [view.activeCount, view.totalCount], [3, 4]);
// 空输入
const empty = buildToolsView([]);
eq('空视图', [empty.builtin.length, empty.mcpGroups.length, empty.activeCount, empty.totalCount], [0, 0, 0, 0]);

// ── ③c 扁平行 + LLM 展示辅助 ────────────────────────────────────────────────

const flat = flattenToolsView(view);
eq('扁平行数（1 内置 + 2 组头 + 3 成员）', flat.length, 6);
eq('扁平行 kind 序列', flat.map((e: ToolsEntry) => e.kind),
  ['builtin', 'mcpHead', 'mcpTool', 'mcpTool', 'mcpHead', 'mcpTool']);
eq('组头 label = server 名', flat[1].label, 'fs');
eq('组头 names = 全组（批量启停）', flat[1].names, ['mcp__fs__read', 'mcp__fs__write']);
eq('组头 enabled = 全开判据', [flat[1].enabled, flat[4].enabled], [false, true]);
eq('成员行缩进', [flat[2].indented, flat[0].indented], [true, false]);
eq('busy 键（单行）', toolsEntryBusyKey(flat[0]), 'Bash');
eq('busy 键（组头）', toolsEntryBusyKey(flat[1]), 'mcp__fs__read,mcp__fs__write');
eq('ForEach key 稳定唯一', [toolsEntryKey(flat[0]), toolsEntryKey(flat[2])], ['builtin|Bash', 'mcpTool|mcp__fs__read']);

// setToolsEnabled：不可变更新（新数组 + 指定项生效 + 其余不动）
const updated = setToolsEnabled(rows, ['mcp__fs__write'], true);
eq('不可变更新返回新数组', updated === rows, false);
eq('更新后 fs 组全开', buildToolsView(updated).mcpGroups[0].allEnabled, true);
eq('原数组未被改动（纯函数）', buildToolsView(rows).mcpGroups[0].allEnabled, false);
eq('批量关闭整组', buildToolsView(setToolsEnabled(rows, ['mcp__fs__read', 'mcp__fs__write'], false))
  .mcpGroups[0].allEnabled, false);
eq('未命中名字不动', setToolsEnabled(rows, ['Nope'], false)[0].enabled, true);

// LLM 展示辅助
const entries: ModelEntryRow[] = [{ sub_id: 's1', model: 'a' }, { sub_id: 's1', model: 'b' },
  { sub_id: 's2', model: 'c' }];
eq('模型计数', [countModelsForSub(entries, 's1'), countModelsForSub(entries, 's2'), countModelsForSub(entries, 'x')],
  [2, 1, 0]);
eq('provider 行（openai+responses）', providerLine('openai', 'responses'), 'openai · responses');
eq('provider 行（anthropic 忽略 api_type）', providerLine('anthropic', 'responses'), 'anthropic');
eq('provider 行（缺省）', providerLine('', ''), 'unknown');
eq('去协议前缀', [stripScheme('https://a.b'), stripScheme('http://a.b'), stripScheme('a.b')],
  ['a.b', 'a.b', 'a.b']);
// ⛔ 密钥展示：只读掩码；空 → 占位符（绝不回填/提交）
eq('掩码密钥原样展示', displayApiKey('abcd****'), 'abcd****');
eq('空密钥占位', displayApiKey(''), '—');
const subsForDefault: SubscriptionRow[] = [
  { id: 's1', name: 'A', provider: 'openai', base_url: '', api_key: 'ab****', model: 'm', active: false },
  { id: 's2', name: 'B', provider: 'openai', base_url: '', api_key: 'cd****', model: 'm', active: true },
];
eq('默认订阅 id', defaultSubscriptionId(subsForDefault), 's2');
eq('无默认 → 空串', defaultSubscriptionId([]), '');
eq('enabled 缺省即 false', [isSubscriptionEnabled(subsForDefault[0]), isSubscriptionEnabled({ id: 'x', name: '',
  provider: '', base_url: '', api_key: '', model: '', active: false, enabled: true })], [false, true]);

// ── ③d agent 分区（get_settings / set_setting，web SettingsAgent.tsx 为权威）─────────

// 键名 / 取值域 / 默认值逐条对齐 web（改错键名 ⇒ 服务端静默存一个没人读的键）
eq('agent 键清单', AGENT_SETTING_KEYS, ['allow_self_compact', 'vision_max_image_edge_px',
  'vision_max_image_bytes', 'vision_output_format', 'vision_jpeg_quality']);
eq('agent 键无重复', new Set(AGENT_SETTING_KEYS).size, AGENT_SETTING_KEYS.length);
ok('ALL 不存在于 agent 键里（method 与 setting key 是两套命名）',
  AGENT_SETTING_KEYS.indexOf('get_settings') < 0);
eq('键字面量', [AGENT_KEY_ALLOW_SELF_COMPACT, AGENT_KEY_VISION_MAX_IMAGE_EDGE_PX,
  AGENT_KEY_VISION_MAX_IMAGE_BYTES, AGENT_KEY_VISION_OUTPUT_FORMAT, AGENT_KEY_VISION_JPEG_QUALITY],
  ['allow_self_compact', 'vision_max_image_edge_px', 'vision_max_image_bytes',
    'vision_output_format', 'vision_jpeg_quality']);
eq('默认值常量', [VISION_DEFAULT_EDGE_PX, VISION_DEFAULT_JPEG_QUALITY, VISION_DEFAULT_MAX_IMAGE_MB, BYTES_PER_MB],
  [1024, 85, 4, 1048576]);
eq('格式取值域', VISION_FORMATS, ['auto', 'jpeg']);

// 布尔读法：web 只认字符串 'true'（SettingsAgent.tsx:136）
eq('读布尔 true', settingIsTrue('true'), true);
eq('读布尔 false', settingIsTrue('false'), false);
eq('读布尔 undefined', settingIsTrue(undefined), false);
eq('读布尔 1（非 true 一律 false）', settingIsTrue('1'), false);
eq('写布尔', [boolSettingValue(true), boolSettingValue(false)], ['true', 'false']);

// 整数档：空/非法/越界 ⇒ 默认（与 web 的 else 分支同义）
eq('整数：正常', clampSettingInt('2048', 256, 8192, 1024), 2048);
eq('整数：空 ⇒ 默认', clampSettingInt('', 256, 8192, 1024), 1024);
eq('整数：空白 ⇒ 默认', clampSettingInt('   ', 256, 8192, 1024), 1024);
eq('整数：非数字 ⇒ 默认', clampSettingInt('abc', 256, 8192, 1024), 1024);
eq('整数：过小 ⇒ 默认', clampSettingInt('255', 256, 8192, 1024), 1024);
eq('整数：过大 ⇒ 默认', clampSettingInt('8193', 256, 8192, 1024), 1024);
eq('整数：边界内', [clampSettingInt('256', 256, 8192, 1024), clampSettingInt('8192', 256, 8192, 1024)],
  [256, 8192]);
eq('质量：越界/非法 ⇒ 85', [clampSettingInt('49', 50, 100, 85), clampSettingInt('101', 50, 100, 85),
  clampSettingInt('x', 50, 100, 85), clampSettingInt('70', 50, 100, 85)], [85, 85, 85, 70]);

// 字节 ↔ MB（web SettingsAgent.tsx:140 / :180）
eq('字节 → MB 输入', bytesToMbInput('4194304'), '4');
eq('字节 → MB（小数）', bytesToMbInput('2097152'), '2');
eq('字节 → MB 空', bytesToMbInput(''), '');
eq('字节 → MB 非法', bytesToMbInput('abc'), '');
eq('MB → 字节', mbInputToBytes('4'), '4194304');
eq('MB → 字节（小数）', mbInputToBytes('1.5'), '1572864');
eq('MB → 字节：空 ⇒ 4MB 默认', mbInputToBytes(''), '4194304');
eq('MB → 字节：0 ⇒ 默认', mbInputToBytes('0'), '4194304');
eq('MB → 字节：>20 ⇒ 默认', mbInputToBytes('21'), '4194304');
eq('格式归一', [normalizeVisionFormat('jpeg'), normalizeVisionFormat('auto'), normalizeVisionFormat(''),
  normalizeVisionFormat('weird')], ['jpeg', 'auto', 'auto', 'auto']);

// buildVisionWrites：顺序 + 回落（web saveVisionSettings 的 writes 顺序逐条一致）
const w1 = buildVisionWrites('2048', '2', VISION_FORMAT_JPEG, '70');
eq('视觉写入顺序', w1.map((w: SettingWrite) => w.key), ['vision_max_image_edge_px', 'vision_max_image_bytes',
  'vision_output_format', 'vision_jpeg_quality']);
eq('视觉写入值（全填）', w1.map((w: SettingWrite) => w.value), ['2048', '2097152', 'jpeg', '70']);
const w2 = buildVisionWrites('', '', '', '');
eq('视觉写入值（全空 ⇒ 默认）', w2.map((w: SettingWrite) => w.value),
  ['1024', '4194304', 'auto', '85']);
const w3 = buildVisionWrites('100', '99', 'jpeg', '10');
eq('视觉写入值（越界 ⇒ 默认，格式仍生效）', w3.map((w: SettingWrite) => w.value),
  ['1024', '4194304', 'jpeg', '85']);
eq('SettingWrite 键集', Object.keys(JSON.parse(JSON.stringify(new SettingWrite('k', 'v'))) as object).sort(),
  ['key', 'value']);

// settingValue：缺键/undefined 载荷都要安全
eq('取值：命中', settingValue({ a: '1' } as Record<string, string>, 'a'), '1');
eq('取值：缺键', settingValue({ a: '1' } as Record<string, string>, 'b'), '');
eq('取值：undefined 载荷', settingValue(undefined, 'a'), '');

// ── ③b 权限错误可读化 ────────────────────────────────────────────────────────

ok('admin only → 中文可读', readableRpcError('admin only').indexOf('管理员') >= 0);
eq('其它错误原样透传', readableRpcError('subscription not found'), 'subscription not found');
eq('空错误兜底', readableRpcError('').length > 0, true);

// ── ④ rpc<T>() 薄封装 ────────────────────────────────────────────────────────

interface FakeCall { path: string; body: string; }
const calls: FakeCall[] = [];
function fakeHttp(response: string): XbotHttp {
  const f = {
    post: async (path: string, body: object): Promise<string> => {
      calls.push({ path, body: JSON.stringify(body) });
      return response;
    },
  };
  return f as unknown as XbotHttp;
}

(async (): Promise<void> => {
  const http = fakeHttp(JSON.stringify({ tools: [{ name: 'Bash', enabled: true }] } as ToolsSettingsData));
  const data = await rpc<ToolsSettingsData>(http, RpcMethod.getToolsSettings);
  eq('rpc 走 /api/rpc', calls[0].path, '/api/rpc');
  eq('rpc body 形状', calls[0].body, '{"method":"get_tools_settings","params":{}}');
  eq('rpc 解包 data.tools', normalizeToolsSettings(data).length, 1);

  // 带参：params 必须真的发出去（丢参 = 服务端按零值处理，静默失效）
  const http2 = fakeHttp('{}');
  await rpc<void>(http2, RpcMethod.setToolEnabled, new ToolEnabledParams('Bash', false));
  eq('rpc 带参 body', calls[1].body, '{"method":"set_tool_enabled","params":{"name":"Bash","enabled":false}}');

  // 订阅列表：数组形态解包（服务端 data 直接是 []Subscription）
  const subs: SubscriptionRow[] = [{ id: 's1', name: 'A', provider: 'openai', base_url: 'https://x',
    api_key: 'abcd****', model: 'gpt', active: true, enabled: true }];
  const http3 = fakeHttp(JSON.stringify(subs));
  const gotSubs = await rpc<SubscriptionRow[]>(http3, RpcMethod.listSubscriptions);
  eq('订阅数组解包', [gotSubs.length, gotSubs[0].id, gotSubs[0].api_key], [1, 's1', 'abcd****']);

  // 模型条目
  const entries: ModelEntryRow[] = [{ sub_id: 's1', sub_name: 'A', model: 'gpt-4o', status: 'normal' }];
  const http4 = fakeHttp(JSON.stringify(entries));
  const gotEntries = await rpc<ModelEntryRow[]>(http4, RpcMethod.listAllModelEntries);
  eq('模型条目解包', [gotEntries.length, gotEntries[0].model], [1, 'gpt-4o']);

  // 错误必须原样抛出（不能被吞成空数据 —— 那正是"静默空白"的来源）
  const failing = { post: async (): Promise<string> => { throw new Error('admin only'); } } as unknown as XbotHttp;
  let threw = '';
  try {
    await rpc<ToolsSettingsData>(failing, RpcMethod.getToolsSettings);
  } catch (e) {
    threw = (e as Error).message;
  }
  eq('错误透传（供 UI 可读化）', threw, 'admin only');
  ok('错误可读化后可展示', readableRpcError(threw).indexOf('管理员') >= 0);

  console.log(`\n${fail === 0 ? '✅' : '❌'} rpc 契约测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
