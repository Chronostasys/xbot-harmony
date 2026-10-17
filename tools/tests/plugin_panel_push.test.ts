/**
 * plugin_panel_push —— 「插件声明式配置的原生渲染面板」对**鸿蒙推送插件**的判别力测试。
 *
 * 为什么用真实载荷：面板的渲染完全由 host `plugin_config` 的 schema 驱动（无任何写死的
 * 插件专属 UI）。所以"面板能不能改这个插件的配置"这件事，等价于：
 *   ① 这个插件的 schema 能被我方解析器 `parsePluginConfig` 正确吃下（键/类型/范围/选项/secret）；
 *   ② 每个字段的 `kind` 都落在 `isFieldEditable` 的可编辑集合里（否则面板只会显示"暂不支持编辑"）；
 *   ③ 写入路径的键就是 schema 的 `key`（面板用 `plugin_config_set{id,key,value}` 写回）。
 * 本文件的载荷 = 2026-10-17 本机 `plugin_config{id:"xbot.harmony-push"}` 的**真实返回**（逐字段抄录）。
 *
 * ⛔ 反例保护：若哪天有人把插件字段改成 `image`（不可编辑）或把 key 改得与 schema 不一致，
 *    本测试必须红 —— 那正是"面板改不了这个插件"的形态。
 */
declare const process: { exit: (c: number) => void };

import {
  PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_NUMBER, PLUGIN_FIELD_SELECT, PLUGIN_FIELD_STRING,
  PluginConfigCatalog, PluginConfigEntry, PluginConfigProperty, displayValue, entryOf,
  filterPluginCatalog, isFieldEditable, parsePluginConfig, pluginFieldHasRange, valueOfProp,
} from '../../entry/src/main/ets/core/settingsplugins';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 真实载荷（`plugin_config{id:"xbot.harmony-push"}`，2026-10-17 本机返回逐字段抄录）。 */
const RAW: Object = {
  plugins: [{
    id: 'xbot.harmony-push',
    name: '鸿蒙推送（Push Kit）',
    title: '鸿蒙推送（Push Kit）',
    runtime: 'stdio',
    enabled: true,
    properties: {
      agentHint: { type: 'boolean', label: '提示 AI 在长任务结束时通知我', default: true },
      apiVersion: {
        type: 'select', label: '推送接口版本', default: 'v1',
        options: [{ label: 'V3（HarmonyOS 5.x 及以上，推荐）', value: 'v3' }, { label: 'V1（HarmonyOS 3.x/4.x）', value: 'v1' }],
      },
      appId: { type: 'string', label: 'App ID', default: '' },
      clientId: { type: 'string', label: 'Client ID', default: '' },
      clientSecret: { type: 'string', label: 'Client Secret', default: '', secret: true },
      collapseWindowSec: { type: 'number', label: '相同内容合并窗口（秒）', default: 30, minimum: 0, maximum: 3600 },
      defaultCategory: { type: 'string', label: '默认消息分类（category）', default: '' },
      defaultLevel: {
        type: 'select', label: '默认提醒强度', default: 'info',
        options: [{ label: '普通（info）', value: 'info' }, { label: '重要（warn）', value: 'warn' }, { label: '紧急（error）', value: 'error' }],
      },
      defaultTtlDays: { type: 'number', label: '默认留存天数（ttl）', default: 7, minimum: 1, maximum: 30 },
      enabled: { type: 'boolean', label: '启用推送', default: true },
      maxPerMinute: { type: 'number', label: '每分钟最多发送条数', default: 12, minimum: 1, maximum: 60 },
      projectId: { type: 'string', label: 'Project ID', default: '' },
      quietHours: { type: 'string', label: '静音时段', default: '' },
    },
    values: {
      agentHint: true, apiVersion: 'v1', appId: '6917619242332815107', clientId: '6917619242332815107',
      clientSecret: '61aa2c0f182d24c8b8d54b63a89750871585ca56aa6c1a7e5169552b9940a36d',
      collapseWindowSec: 30, defaultCategory: '', defaultLevel: 'info', defaultTtlDays: 7,
      enabled: true, maxPerMinute: 12, projectId: '101653523865346944', quietHours: '',
    },
  }],
};

const cat: PluginConfigCatalog = parsePluginConfig(RAW);
const found: PluginConfigEntry | undefined = entryOf(cat, 'xbot.harmony-push');

console.log('\n▶ ① schema 解析（面板的输入就是它）');
ok('解析出 xbot.harmony-push 条目', found !== undefined);
// ⛔ 非空收敛（ArkTS/tsc 严格模式）：缺失时用空条目 ⇒ 下面的逐字段断言会立刻红，
//    既可读又不会因为"没找到"而整文件编译不过。
const entry: PluginConfigEntry = found !== undefined ? found : new PluginConfigEntry();
eq('字段数 = 13', entry.properties.length, 13);
eq('插件名用于面板标题', entry.name, '鸿蒙推送（Push Kit）');
const byKey = (k: string): PluginConfigProperty => {
  for (let i = 0; i < entry.properties.length; i++) {
    if (entry.properties[i].key === k) { return entry.properties[i]; }
  }
  return new PluginConfigProperty(); // 空对象：kind='' 之类会让下面的断言立刻红
};
eq('enabled 是 boolean', byKey('enabled').kind, PLUGIN_FIELD_BOOLEAN);
eq('apiVersion 是 select', byKey('apiVersion').kind, PLUGIN_FIELD_SELECT);
eq('appId 是 string', byKey('appId').kind, PLUGIN_FIELD_STRING);
eq('quietHours 是 string', byKey('quietHours').kind, PLUGIN_FIELD_STRING);
eq('defaultTtlDays 是 number', byKey('defaultTtlDays').kind, PLUGIN_FIELD_NUMBER);
ok('clientSecret 标记为 secret（面板用遮蔽输入）', byKey('clientSecret').secret === true);
ok('appId 不是 secret（明文输入）', byKey('appId').secret !== true);
ok('label 非空（面板显示中文名，不是裸 key）', byKey('defaultTtlDays').label.length > 0);

console.log('\n▶ ② 面板**可编辑性**（isFieldEditable 是渲染开关）');
const allEditable: boolean = entry.properties.every((p: PluginConfigProperty) => p.editable === true);
ok('13 个字段**全部可编辑**（⛔ 任一为 false ⇒ 面板只会显示"暂不支持编辑"）', allEditable);
for (let i = 0; i < entry.properties.length; i++) {
  const p: PluginConfigProperty = entry.properties[i];
  if (!isFieldEditable(p.kind)) {
    console.log(`  ✗ 字段 ${p.key} 类型 ${p.kind} 不可编辑`);
  }
}
ok('isFieldEditable 对本次全部 kind 均放行', entry.properties.every((p: PluginConfigProperty) => isFieldEditable(p.kind)));

console.log('\n▶ ③ 控件所需元数据（范围/选项/默认值）');
ok('defaultTtlDays 带范围（面板做 1..30 校验）', pluginFieldHasRange(byKey('defaultTtlDays')));
ok('maxPerMinute 带范围', pluginFieldHasRange(byKey('maxPerMinute')));
ok('collapseWindowSec 带范围（0..3600）', pluginFieldHasRange(byKey('collapseWindowSec')));
ok('string 字段不带范围', !pluginFieldHasRange(byKey('appId')));
eq('apiVersion 有 2 个选项（面板渲染下拉）', byKey('apiVersion').options.length, 2);
eq('defaultLevel 有 3 个选项', byKey('defaultLevel').options.length, 3);
eq('选项带中文 label', byKey('defaultLevel').options[0].label, '普通（info）');
ok('enabled 默认值 true 被解析', byKey('enabled').def.b === true);
eq('defaultTtlDays 默认值 7', byKey('defaultTtlDays').def.n, 7);
eq('apiVersion 当前值 = v1（写回前展示的值）', valueOfProp(byKey('apiVersion'), entry.values).s, 'v1');

console.log('\n▶ ④ secret 展示遮蔽（⛔ 真密钥不得明文上屏）');
const secretProp: PluginConfigProperty = byKey('clientSecret');
const shown: string = displayValue(secretProp, valueOfProp(secretProp, entry.values));
ok('遮蔽文本不等于真密钥', shown !== '61aa2c0f182d24c8b8d54b63a89750871585ca56aa6c1a7e5169552b9940a36d');
ok('遮蔽文本非空（有值可辨认）', shown.length > 0);

console.log('\n▶ ⑤ 面板列表/搜索不把它滤掉');
ok('空查询保留该条目', filterPluginCatalog(cat, '').entries.some((e: PluginConfigEntry) => e.id === 'xbot.harmony-push'));
const narrowed: PluginConfigCatalog = filterPluginCatalog(cat, 'client');
ok('搜索 client 能命中该插件', narrowed.entries.some((e: PluginConfigEntry) => e.id === 'xbot.harmony-push'));
ok('搜索后字段被裁剪（只剩匹配项）', (narrowed.entries[0]?.properties.length ?? 99) < 13);

if (fail > 0) {
  console.log(`  plugin_panel_push: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  plugin_panel_push: ${pass} passed, 0 failed`);
process.exit(0);
