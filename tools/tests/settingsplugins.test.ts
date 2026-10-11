/**
 * `core/settingsplugins.ets` 的**判别力测试**（任务2/3 落修）。
 *
 * 覆盖三组判据：
 *   A. `plugin_config` 线格式 → 视图模型（全容错 + 确定性）；
 *   B. 值语义：类型归一 / 校验 / **提交形状（真 JSON 标量，不是字符串）** / multiselect 交互；
 *   C. 设置分区门控 `shouldShowTab`（未实现的分区**不出现**）。
 *
 * ⛔ mutation 自证（改坏 ⇒ 真红）：
 *   · `isFieldEditable` 改成恒 `true` ⇒ image/unknown 那几条红；
 *   · `submitValue` 的 boolean 分支改成 `` `${v.b}` `` ⇒ 「提交形状」那几条红（这正是会被服务端
 *     拒的形态：`plugin_config_set` 对 boolean/number 强校验类型，见 `rpc_table.go:2489-2498`）；
 *   · `shouldShowTab` 改成恒 `true` ⇒ 门控那几条红；
 *   · `parsePluginConfig` 不排序 / 不跳过无 id 条目 ⇒ 对应条目红。
 */
declare const process: { exit: (c: number) => void };

import {
  ConfigValue, entryOf, groupBySection, isFieldEditable, listHas, maskedSecret,
  normalizeFieldType, parsePluginConfig, readValue, sameValue, setEntryValues,
  shouldShowTab, submitValue, textInputValue, toggleListValue, validateValue, valueFromText,
  valueFromToggle, visibleTabs, fallbackTabId, displayValue,
  configValueFingerprint, pluginEntryFingerprint, filterPluginCatalog, pluginPropMatches, pluginFieldHasRange,
  PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_IMAGE, PLUGIN_FIELD_MULTISELECT, PLUGIN_FIELD_NUMBER,
  PLUGIN_FIELD_SELECT, PLUGIN_FIELD_STRING, PLUGIN_FIELD_UNKNOWN,
  SettingsTabSpec, PluginConfigCatalog, PluginConfigEntry, PluginConfigProperty,
} from '../../entry/src/main/ets/core/settingsplugins';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ══ A. 线格式 → 视图模型 ══════════════════════════════════════════════════════

// 直接喂「服务端 plugin_config 的响应形状」（rpc_table.go:2400-2453 的 configJSON）
const WIRE: Object = {
  plugins: [
    {
      id: 'xbot.ambience', name: 'Ambience', title: '壁纸', runtime: 'script', enabled: true,
      properties: {
        wallpaperOpacity: { type: 'number', label: '壁纸不透明度', minimum: 0.1, maximum: 1.0, default: 1.0 },
        wallpaper: {
          type: 'select', label: '壁纸', default: '', secret: false, required: false,
          options: [
            { label: '无壁纸', value: '' },
            { label: '星夜极光', value: 'preset:aurora' },
          ],
        },
        glassOpacity: { type: 'number', minimum: 0.5, maximum: 1.0 },
      },
      values: { wallpaperOpacity: 1.0, wallpaper: 'preset:aurora' },
    },
    { id: '', name: '无 id 的坏条目', properties: { x: { type: 'string' } } },
  ],
};
const cat: PluginConfigCatalog = parsePluginConfig(WIRE);
eq('空载荷 ⇒ 空目录', parsePluginConfig(undefined).entries.length, 0);
eq('null 载荷 ⇒ 空目录', parsePluginConfig(null).entries.length, 0);
eq('无 plugins 字段 ⇒ 空目录', parsePluginConfig({} as Object).entries.length, 0);
eq('无 id 的条目被跳过', cat.entries.length, 1);
eq('条目 id', cat.entries[0].id, 'xbot.ambience');
eq('条目 runtime', cat.entries[0].runtime, 'script');
eq('条目 enabled ⇒ isOn', cat.entries[0].isOn, true);
eq('properties 按 key 升序（确定性）',
  cat.entries[0].properties.map((p) => p.key), ['glassOpacity', 'wallpaper', 'wallpaperOpacity']);
const propOpacity = cat.entries[0].properties[0];
eq('number 的 minimum 生效', [propOpacity.hasMin, propOpacity.min, propOpacity.hasMax, propOpacity.max],
  [true, 0.5, true, 1]);
const propWallpaper = cat.entries[0].properties[1];
eq('select 的 options 解析', propWallpaper.options.map((o) => o.value), ['', 'preset:aurora']);
eq('select 的 option label', propWallpaper.options[1].label, '星夜极光');
eq('values 合入 model', cat.entries[0].values['wallpaper'].s, 'preset:aurora');
eq('缺 values 的键 ⇒ 默认值（number 的 default=1.0）',
  cat.entries[0].values['wallpaperOpacity'].n, 1.0);
eq('缺 values 且缺 default ⇒ 该类型空值（glassOpacity）',
  cat.entries[0].values['glassOpacity'].n, 0);
ok('entryOf 命中', entryOf(cat, 'xbot.ambience') !== undefined);
ok('entryOf 未命中 ⇒ undefined', entryOf(cat, 'nope') === undefined);

// 坏 options / 缺 type 的容错
const bad: PluginConfigCatalog = parsePluginConfig({
  plugins: [{
    id: 'p', properties: { a: { type: 'nope' }, b: { options: [null, { label: 'L' }] } },
  }],
} as Object);
eq('未知 type ⇒ unknown（不猜成 string）', bad.entries[0].properties[0].kind, PLUGIN_FIELD_UNKNOWN);
eq('未知 type 不可编辑', bad.entries[0].properties[0].editable, false);
eq('缺 type ⇒ unknown', bad.entries[0].properties[1].kind, PLUGIN_FIELD_UNKNOWN);
eq('option 为 null ⇒ 跳过（不炸）', bad.entries[0].properties[1].options.length, 1);
eq('option 缺 value ⇒ 空串', bad.entries[0].properties[1].options[0].value, '');

// ══ B. 值语义 ═════════════════════════════════════════════════════════════════

eq('类型归一：大小写/空白', normalizeFieldType('  BOOLEAN '), PLUGIN_FIELD_BOOLEAN);
eq('类型归一：未知 ⇒ unknown', normalizeFieldType('table'), PLUGIN_FIELD_UNKNOWN);
eq('类型归一：空 ⇒ unknown', normalizeFieldType(''), PLUGIN_FIELD_UNKNOWN);
eq('类型归一：undefined ⇒ unknown', normalizeFieldType(undefined), PLUGIN_FIELD_UNKNOWN);
eq('可编辑性：boolean/string/number/select/multiselect 都可编辑',
  [PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_STRING, PLUGIN_FIELD_NUMBER, PLUGIN_FIELD_SELECT,
    PLUGIN_FIELD_MULTISELECT].map(isFieldEditable), [true, true, true, true, true]);
eq('可编辑性：image 不可编辑（本期无上传）', isFieldEditable(PLUGIN_FIELD_IMAGE), false);
eq('可编辑性：unknown 不可编辑', isFieldEditable(PLUGIN_FIELD_UNKNOWN), false);

eq('readValue：boolean 只认真 bool', readValue(PLUGIN_FIELD_BOOLEAN, 'true').b, false);
eq('readValue：boolean 真值', readValue(PLUGIN_FIELD_BOOLEAN, true).b, true);
eq('readValue：number 只认真 num', readValue(PLUGIN_FIELD_NUMBER, '5').n, 0);
eq('readValue：number 真值', readValue(PLUGIN_FIELD_NUMBER, 5).n, 5);
eq('readValue：multiselect 过滤非字符串', readValue(PLUGIN_FIELD_MULTISELECT, ['a', 3] as unknown as string[]).list, ['a']);
eq('readValue：string', readValue(PLUGIN_FIELD_STRING, 'x').s, 'x');

// ★ 提交形状：boolean/number 必须是**真标量**（服务端强校验类型，字符串会被拒）
const bProp = cat.entries[0].properties[1]; // select，借来改 kind 不优雅 ⇒ 直接用专门构造
const cat2: PluginConfigCatalog = parsePluginConfig({
  plugins: [{
    id: 'p2',
    properties: {
      flag: { type: 'boolean' },
      num: { type: 'number', minimum: 1, maximum: 10 },
      name: { type: 'string', required: true },
      mode: { type: 'select', required: true, options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      tags: { type: 'multiselect', required: true, options: [{ label: 'T1', value: 't1' }, { label: 'T2', value: 't2' }] },
    },
    values: { flag: true, num: 3, name: 'hi', mode: 'a', tags: ['t1'] },
  }],
} as Object);
const e2: PluginConfigEntry = cat2.entries[0];
/** 按 key 取字段（properties 已按 key 排序 ⇒ **不能用位置下标**，必须按 key 查）。 */
function propOf(e: PluginConfigEntry, key: string): import('../../entry/src/main/ets/core/settingsplugins').PluginConfigProperty {
  for (let i = 0; i < e.properties.length; i++) {
    if (e.properties[i].key === key) { return e.properties[i]; }
  }
  throw new Error(`no property ${key}`);
}
const pFlag = propOf(e2, 'flag');
const pNum = propOf(e2, 'num');
const pName = propOf(e2, 'name');
const pMode = propOf(e2, 'mode');
const pTags = propOf(e2, 'tags');
eq('按 key 取到的类型正确', [pFlag.kind, pNum.kind, pName.kind, pMode.kind, pTags.kind],
  [PLUGIN_FIELD_BOOLEAN, PLUGIN_FIELD_NUMBER, PLUGIN_FIELD_STRING, PLUGIN_FIELD_SELECT,
    PLUGIN_FIELD_MULTISELECT]);

const vFlag: ConfigValue = valueFromToggle(true);
const sub: unknown = submitValue(pFlag, vFlag);
eq('提交形状：boolean ⇒ typeof boolean', typeof sub, 'boolean');
eq('提交形状：boolean 值', sub, true);
eq('提交形状：number ⇒ typeof number', typeof submitValue(pNum, e2.values['num']), 'number');
eq('提交形状：string ⇒ typeof string', typeof submitValue(pName, e2.values['name']), 'string');
eq('提交形状：multiselect ⇒ array', submitValue(pTags, e2.values['tags']), ['t1']);

eq('校验：number 越界（< min）', validateValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 0)) !== '', true);
eq('校验：number 越界（> max）', validateValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 99)) !== '', true);
eq('校验：number 合法', validateValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 5)), '');
eq('校验：number NaN ⇒ 报错', validateValue(pNum, valueFromText(pNum, '')), '请输入数字');
eq('校验：string required 空 ⇒ 报错', validateValue(pName, valueFromText(pName, '  ')), '不能为空');
eq('校验：string required 非空 ⇒ 过', validateValue(pName, valueFromText(pName, 'x')), '');
const unknownPick: ConfigValue = new ConfigValue();
unknownPick.s = 'zzz';
eq('校验：select 未知选项 ⇒ 报错', validateValue(pMode, unknownPick) !== '', true);
eq('校验：multiselect required 空 ⇒ 报错',
  validateValue(pTags, readValue(PLUGIN_FIELD_MULTISELECT, [])) !== '', true);
eq('校验：image 不可编辑 ⇒ 明确报错',
  validateValue(parsePluginConfig({ plugins: [{ id: 'i', properties: { img: { type: 'image' } } }] } as Object)
    .entries[0].properties[0], readValue(PLUGIN_FIELD_STRING, 'u')) !== '', true);

const tagsVal: ConfigValue = readValue(PLUGIN_FIELD_MULTISELECT, ['t1']);
eq('multiselect：listHas', [listHas(tagsVal, 't1'), listHas(tagsVal, 't2')], [true, false]);
eq('multiselect：追加保序', toggleListValue(tagsVal, 't2').list, ['t1', 't2']);
eq('multiselect：再点即移除', toggleListValue(tagsVal, 't1').list, []);
eq('multiselect：空 value 不入列', toggleListValue(tagsVal, '').list, ['t1']);
eq('dirty 判定：同值 ⇒ true', sameValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 3), e2.values['num']), true);
eq('dirty 判定：异值 ⇒ false', sameValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 4), e2.values['num']), false);

eq('展示：boolean 开/关', [displayValue(pFlag, valueFromToggle(true)),
  displayValue(pFlag, valueFromToggle(false))], ['开', '关']);
eq('展示：multiselect 用「、」拼 label',
  displayValue(pTags, readValue(PLUGIN_FIELD_MULTISELECT, ['t1', 't2'])), 'T1、T2');
eq('展示：secret 掩码（前2位****）', maskedSecret('abcdefgh'), 'ab****');
eq('展示：secret 极短值不露长度', maskedSecret('ab'), '****');
eq('展示：secret 空串仍空', maskedSecret(''), '');
eq('文本初值：number', textInputValue(pNum, readValue(PLUGIN_FIELD_NUMBER, 3)), '3');

// ── 内容指纹（ArkUI ForEach key 必须随内容变，否则写完重拉后界面停在旧值）────────────
eq('指纹：boolean', configValueFingerprint(pFlag, valueFromToggle(true)), '1');
eq('指纹：number', configValueFingerprint(pNum, readValue(PLUGIN_FIELD_NUMBER, 3)), '3');
eq('指纹：multiselect', configValueFingerprint(pTags, readValue(PLUGIN_FIELD_MULTISELECT, ['t1', 't2'])), 't1,t2');
eq('指纹：string 带长度前缀（消歧义）',
  configValueFingerprint(pName, readValue(PLUGIN_FIELD_STRING, 'ab')), '2:ab');
ok('指纹判别力：值变 ⇒ 指纹变',
  configValueFingerprint(pNum, readValue(PLUGIN_FIELD_NUMBER, 3))
    !== configValueFingerprint(pNum, readValue(PLUGIN_FIELD_NUMBER, 4)));
const fp0 = pluginEntryFingerprint(e2);
ok('条目指纹含 id + 启用态', fp0.indexOf('p2#0') === 0);
ok('条目指纹含各字段值', fp0.indexOf('num=3') >= 0 && fp0.indexOf('tags=t1') >= 0);
const e3: PluginConfigEntry = parsePluginConfig({
  plugins: [{ id: 'p2', properties: { num: { type: 'number' } }, values: { num: 999 } }],
} as Object).entries[0];
ok('条目指纹判别力：值变 ⇒ 指纹变', pluginEntryFingerprint(e2) !== pluginEntryFingerprint(e3));

// section 分组保首次出现顺序
const groups = groupBySection([
  { key: 'a', section: 'S1' } as unknown as never, { key: 'b', section: '' } as unknown as never,
  { key: 'c', section: 'S1' } as unknown as never,
]);
eq('分组：顺序 = 首次出现', groups.map((g) => g.section), ['S1', '']);
eq('分组：同 section 归并', groups[0].props.length, 2);

// 后端为准的合并（未知 key 丢弃）
setEntryValues(e2, { num: 7, __ghost: 1, tags: ['t2'] } as unknown as Record<string, never>);
eq('setEntryValues：已知 key 更新', e2.values['num'].n, 7);
eq('setEntryValues：未知 key 不塞进模型', Object.keys(e2.values).indexOf('__ghost'), -1);
eq('setEntryValues：multiselect 更新', e2.values['tags'].list, ['t2']);

// ══ C. 设置分区门控 ═══════════════════════════════════════════════════════════

const SPECS: SettingsTabSpec[] = [
  new SettingsTabSpec('tools', '工具', true),
  new SettingsTabSpec('plugins', '插件', true),
  new SettingsTabSpec('channels', '渠道', false),
  new SettingsTabSpec('about', '关于', true),
];
eq('shouldShowTab：已实现 ⇒ true', shouldShowTab(SPECS[0]), true);
eq('shouldShowTab：未实现 ⇒ false（不装样子）', shouldShowTab(SPECS[2]), false);
eq('visibleTabs：过滤未实现', visibleTabs(SPECS).map((t) => t.id), ['tools', 'plugins', 'about']);
eq('fallbackTabId：active 已被隐藏 ⇒ 回落首个可见',
  fallbackTabId(SPECS, 'channels'), 'tools');
eq('fallbackTabId：active 可见 ⇒ 原样', fallbackTabId(SPECS, 'plugins'), 'plugins');
eq('fallbackTabId：全隐藏 ⇒ 空串', fallbackTabId([new SettingsTabSpec('x', 'x', false)], 'x'), '');

// ══ D. 插件搜索过滤（对齐 web `SettingsPlugins.tsx:133-155`）════════════════════
// 判别力（mutation 必红）：
//   · filterPluginCatalog 空串分支改成"照样过滤" ⇒ 「空串原样返回」红（且引用不等）；
//   · 丢掉"0 命中插件"那条 `continue` 删掉 ⇒ 「不命中的插件整块消失」红。
{
  const mk = (key: string, label: string, desc: string): PluginConfigProperty => {
    const p = new PluginConfigProperty();
    p.key = key;
    p.label = label;
    p.description = desc;
    return p;
  };
  const mkEntry = (id: string, props: PluginConfigProperty[]): PluginConfigEntry => {
    const e = new PluginConfigEntry();
    e.id = id;
    e.name = id;
    e.properties = props;
    return e;
  };
  const cat = new PluginConfigCatalog();
  cat.entries = [
    mkEntry('a', [mk('api_key', 'API Key', '访问密钥'), mk('timeout', '超时', '秒')]),
    mkEntry('b', [mk('region', '区域', 'OSS region')]),
  ];

  eq('pluginPropMatches：命中 key', pluginPropMatches(mk('api_key', 'Key', 'd'), 'api_'), true);
  eq('pluginPropMatches：命中 label（大小写不敏感）', pluginPropMatches(mk('k', 'API Key', 'd'), 'api key'), true);
  eq('pluginPropMatches：命中 description', pluginPropMatches(mk('k', 'L', 'OSS region'), 'oss'), true);
  eq('pluginPropMatches：空查询恒命中', pluginPropMatches(mk('k', 'L', 'D'), '   '), true);
  eq('pluginPropMatches：不命中', pluginPropMatches(mk('api_key', 'API Key', 'dd'), 'zzz'), false);

  eq('空串 ⇒ 原样返回**同一**目录（引用相等，不复制）', filterPluginCatalog(cat, '  ') === cat, true);

  const f1 = filterPluginCatalog(cat, 'api');
  eq('命中 ⇒ 只保留命中的字段', f1.entries.length, 1);
  eq('  ⇒ 命中插件 id', f1.entries[0].id, 'a');
  eq('  ⇒ 只留命中字段', f1.entries[0].properties.map((p) => p.key), ['api_key']);

  const f2 = filterPluginCatalog(cat, 'oss');
  eq('另一查询只命中另一个插件', f2.entries.map((e) => e.id), ['b']);

  const f3 = filterPluginCatalog(cat, 'zzz');
  eq('零命中 ⇒ 空目录（插件整块消失）', f3.entries.length, 0);
  ok('零命中不是 undefined', f3.entries !== undefined);
}

// ══ E. number 字段是否用滑条（对齐 web `SettingsPlugins.tsx:410-415` 的 hasRange）══
// 判别力（mutation 必红）：把 pluginFieldHasRange 改成只看 hasMin ⇒ 「只有下界 ⇒ 文本框」红。
{
  const withRange = (hasMin: boolean, min: number, hasMax: boolean, max: number): PluginConfigProperty => {
    const p = new PluginConfigProperty();
    p.key = 'k';
    p.kind = PLUGIN_FIELD_NUMBER;
    p.hasMin = hasMin;
    p.min = min;
    p.hasMax = hasMax;
    p.max = max;
    return p;
  };
  eq('上下界都有且 min<max ⇒ 滑条', pluginFieldHasRange(withRange(true, 0, true, 10)), true);
  eq('只有下界 ⇒ 文本框', pluginFieldHasRange(withRange(true, 0, false, 0)), false);
  eq('只有上界 ⇒ 文本框', pluginFieldHasRange(withRange(false, 0, true, 10)), false);
  eq('上下界相等（max==min）⇒ 文本框（跨度为零）', pluginFieldHasRange(withRange(true, 5, true, 5)), false);
  eq('上界小于下界 ⇒ 文本框', pluginFieldHasRange(withRange(true, 10, true, 5)), false);
}

if (fail > 0) { console.log(`  settingsplugins: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  settingsplugins: ${pass} passed, 0 failed`);
process.exit(0);
