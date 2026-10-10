/**
 * 设置「存储 / Web 账号」分区的**纯逻辑契约测试**。
 *
 * 为什么必须有判别力（本文件对应用户明确要求"取值域校验 / 默认值回落 / 键映射"要自证）：
 *  1. **schema 驱动**：storage 表单完全由服务端 `_schema` 决定 ⇒ 解析/可见性算错 = 用户看到
 *     错误的字段集（例如切到 `aliyun` 却看不到 `s3_*`，或反过来把 qiniu 字段填进了 s3）。
 *  2. **条件可见**：`depends_on_key`/`depends_on_values` 是服务端契约
 *     （`channel/capability.go:26-31`，值形如 `"s3,aliyun,cos"`）——逗号拆分/trim 错就静默少字段。
 *  3. **掩码语义**：密文键读取时已打码（`前4位 + ****`，`storage_config.go:33-46`）；
 *     保存时**必须原样回传**（服务端跳过含 `****` 的值）。若本地把掩码换成空串 ⇒
 *     真凭据被清空（云存储直接不可用）⇒ 这里用断言把"不许清空"钉死。
 *  4. **键名/取值域**：`toggle` 契约就是 `"true"|"false"`（`storage_defs.go:71`），不许吃 `1/on/yes`。
 */
declare const process: { exit: (c: number) => void };

import {
  buildStorageValues, CONFIG_SURFACE_METHODS, editableStorageFields, isMaskedSecret, isStorageMetaKey,
  isValidUsername, liveStorageProvider, maskPasswordFields, maskSecretForDisplay,
  normalizeUsernameInput,
  oneTimePasswordNotice, OneTimePw, parseDependsOnValues, parseStorageSchema, RPC_CREATE_WEB_USER,
  RPC_DELETE_WEB_USER, RPC_GET_STORAGE_CONFIG, RPC_LIST_WEB_USERS, RPC_SET_STORAGE_CONFIG,
  SetStorageConfigParams, storageDirty, storageFieldVisible, storageOptionLabel, storageSaveApplied,
  StorageFieldDef, storageToggleOn, STORAGE_TYPE_PASSWORD, STORAGE_TYPE_SELECT, STORAGE_TYPE_TEXT,
  STORAGE_TYPE_TOGGLE, UsernameParams, webUsersFrom, WebUsersData,
} from '../../entry/src/main/ets/core/settings';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① RPC method 名（就地定义，待后续波折叠进 core/rpc.ets）──────────────────────

eq('storage methods', [RPC_GET_STORAGE_CONFIG, RPC_SET_STORAGE_CONFIG],
  ['get_storage_config', 'set_storage_config']);
eq('webusers methods', [RPC_LIST_WEB_USERS, RPC_CREATE_WEB_USER, RPC_DELETE_WEB_USER],
  ['list_web_users', 'create_web_user', 'delete_web_user']);
eq('就地登记清单', CONFIG_SURFACE_METHODS, ['get_storage_config', 'set_storage_config',
  'list_web_users', 'create_web_user', 'delete_web_user', 'get_system_info', 'check_update']);
eq('清单无重复', new Set(CONFIG_SURFACE_METHODS).size, CONFIG_SURFACE_METHODS.length);

// params 形状（服务端 rpc_table.go:1930-1933 / 1935-1951）
eq('set_storage_config params', JSON.stringify(new SetStorageConfigParams({ provider: 'local' })),
  '{"values":{"provider":"local"}}');
eq('username params', JSON.stringify(new UsernameParams('alice')), '{"username":"alice"}');

// ── ② schema 解析 ────────────────────────────────────────────────────────────

const SCHEMA_JSON = JSON.stringify([
  { key: 'provider', label: 'Storage backend', type: 'select', default_value: 'local',
    options: [{ label: 'Local static', value: 'local' }, { label: 'Alibaba Cloud OSS', value: 'aliyun' },
      { label: 'Tencent COS', value: 'cos' }, { label: 'Qiniu', value: 'qiniu' }, { label: 'S3', value: 's3' }] },
  { key: 'qiniu_access_key', label: 'Access key', type: 'text', default_value: '',
    depends_on_key: 'provider', depends_on_values: 'qiniu' },
  { key: 'qiniu_secret_key', label: 'Secret key', type: 'password', default_value: '',
    depends_on_key: 'provider', depends_on_values: 'qiniu' },
  { key: 's3_access_key', label: 'Access key', type: 'text', default_value: '',
    depends_on_key: 'provider', depends_on_values: 's3,aliyun,cos' },
  { key: 's3_secret_key', label: 'Secret key', type: 'password', default_value: '',
    depends_on_key: 'provider', depends_on_values: 's3,aliyun,cos' },
  { key: 's3_use_path_style', label: 'Path-style', type: 'toggle', default_value: 'false',
    depends_on_key: 'provider', depends_on_values: 's3,aliyun,cos' },
]);

const defs: StorageFieldDef[] = parseStorageSchema(SCHEMA_JSON);
eq('解析字段数', defs.length, 6);
eq('首字段 key', defs[0].key, 'provider');
eq('首字段类型', defs[0].type, STORAGE_TYPE_SELECT);
eq('provider 选项数', defs[0].options !== undefined ? defs[0].options.length : -1, 5);
// 容错：坏输入一律空数组（面板显示"无可用字段"，不得抛）
eq('空 schema', parseStorageSchema('').length, 0);
eq('undefined schema', parseStorageSchema(undefined).length, 0);
eq('坏 JSON', parseStorageSchema('{not json').length, 0);
eq('非数组 JSON', parseStorageSchema('{"a":1}').length, 0);
eq('数组内缺 key 的元素被剔除', parseStorageSchema('[{"label":"x"},{"key":"ok"}]').length, 1);
eq('类型常量', [STORAGE_TYPE_TEXT, STORAGE_TYPE_PASSWORD, STORAGE_TYPE_TOGGLE],
  ['text', 'password', 'toggle']);

// 元键（`_schema` / `_active` 不是用户字段）
eq('元键判定', [isStorageMetaKey('_schema'), isStorageMetaKey('_active'), isStorageMetaKey('provider'),
  isStorageMetaKey('')], [true, true, false, false]);

// ── ③ 条件可见（depends_on）─────────────────────────────────────────────────

eq('触发值拆分', parseDependsOnValues('s3,aliyun,cos'), ['s3', 'aliyun', 'cos']);
eq('触发值带空白', parseDependsOnValues(' s3 , aliyun '), ['s3', 'aliyun']);
eq('触发值空/未定义', [parseDependsOnValues(''), parseDependsOnValues(undefined)], [[], []]);

const noDep: StorageFieldDef = { key: 'provider', type: STORAGE_TYPE_SELECT };
eq('无依赖 ⇒ 可见', storageFieldVisible(noDep, () => 'anything'), true);
const s3Dep: StorageFieldDef = { key: 's3_bucket', depends_on_key: 'provider', depends_on_values: 's3,aliyun,cos' };
eq('命中（aliyun）⇒ 可见', storageFieldVisible(s3Dep, (k: string) => (k === 'provider' ? 'aliyun' : '')), true);
eq('命中（s3）⇒ 可见', storageFieldVisible(s3Dep, (k: string) => (k === 'provider' ? 's3' : '')), true);
eq('未命中（qiniu）⇒ 隐藏', storageFieldVisible(s3Dep, (k: string) => (k === 'provider' ? 'qiniu' : '')), false);
eq('未命中（local）⇒ 隐藏', storageFieldVisible(s3Dep, (k: string) => (k === 'provider' ? 'local' : '')), false);
const depNoValues: StorageFieldDef = { key: 'x', depends_on_key: 'provider', depends_on_values: '' };
eq('有 key 无 values ⇒ 视为无约束', storageFieldVisible(depNoValues, () => 'qiniu'), true);

// ── ④ 可编辑字段集（provider=aliyun 时）─────────────────────────────────────

const valueAliyun = (k: string): string => (k === 'provider' ? 'aliyun' : '');
const editableAliyun: StorageFieldDef[] = editableStorageFields(defs, valueAliyun);
eq('aliyun 下可编辑字段', editableAliyun.map((f: StorageFieldDef) => f.key),
  ['provider', 's3_access_key', 's3_secret_key', 's3_use_path_style']);
ok('aliyun 下不出现 qiniu 字段',
  editableAliyun.map((f: StorageFieldDef) => f.key).indexOf('qiniu_access_key') < 0);
const editableQiniu: StorageFieldDef[] = editableStorageFields(defs, (k: string) => (k === 'provider' ? 'qiniu' : ''));
eq('qiniu 下可编辑字段', editableQiniu.map((f: StorageFieldDef) => f.key),
  ['provider', 'qiniu_access_key', 'qiniu_secret_key']);
const editableLocal: StorageFieldDef[] = editableStorageFields(defs, (k: string) => (k === 'provider' ? 'local' : ''));
eq('local 下只有 provider', editableLocal.map((f: StorageFieldDef) => f.key), ['provider']);
// 元键与只读字段被剔除
const withMeta: StorageFieldDef[] = [
  { key: '_schema' }, { key: '_active' }, { key: 'readonly_x', read_only: true }, { key: 'ok_key' },
];
eq('剔除元键与只读', editableStorageFields(withMeta, () => '').map((f: StorageFieldDef) => f.key), ['ok_key']);

// ── ⑤ 掩码语义（**不许清空真凭据**的守卫）────────────────────────────────────

eq('掩码判定：含 ****', isMaskedSecret('AKID****'), true);
eq('掩码判定：明文', isMaskedSecret('AKIDREALSECRET'), false);
eq('掩码判定：空', isMaskedSecret(''), false);
eq('展示掩码：空 ⇒ 空', maskSecretForDisplay(''), '');
eq('展示掩码：≤4 位 ⇒ ****', maskSecretForDisplay('abc'), '****');
eq('展示掩码：长 ⇒ 前4位+****', maskSecretForDisplay('AKIDREALSECRET'), 'AKID****');
eq('展示掩码：已掩码则原样', maskSecretForDisplay('AKID****'), 'AKID****');
// ⛔ 关键不变量：回传掩码不得变成空串（服务端据此判断"跳过写入"）
const savedMasked: Record<string, string> = { provider: 'aliyun', s3_secret_key: 'AKID****' };
const payload: Record<string, string> = buildStorageValues(editableAliyun, (k: string) =>
  (k === 'provider' ? 'aliyun' : savedMasked[k] !== undefined ? savedMasked[k] : ''));
eq('载荷保留掩码原值', payload['s3_secret_key'] !== undefined ? payload['s3_secret_key'] : '', 'AKID****');
ok('载荷未把掩码清空', payload['s3_secret_key'] !== undefined && payload['s3_secret_key'].length > 0);

// 载荷只含当前可见字段（qiniu 字段不得出现在 aliyun 载荷里）
eq('载荷键集 = 可见可编辑字段', Object.keys(payload).sort(),
  ['provider', 's3_access_key', 's3_secret_key', 's3_use_path_style']);

// ── ⑥ 脏检测 / 回读判定 / provider 展示 ─────────────────────────────────────

const savedLocal: Record<string, string> = { provider: 'local', s3_use_path_style: 'false' };
eq('未改动 ⇒ 不脏', storageDirty(editableLocal, (k: string) => savedLocal[k] !== undefined ? savedLocal[k] : '',
  (k: string) => savedLocal[k] !== undefined ? savedLocal[k] : ''), false);
eq('改动 ⇒ 脏', storageDirty(editableLocal, (k: string) => (k === 'provider' ? 's3' : ''),
  (k: string) => savedLocal[k] !== undefined ? savedLocal[k] : ''), true);

eq('_active 缺失 ⇒ local', liveStorageProvider({}), 'local');
eq('_active 空串 ⇒ local', liveStorageProvider({ _active: '' }), 'local');
eq('_active 命中', liveStorageProvider({ _active: 'aliyun' }), 'aliyun');
eq('config 未定义 ⇒ local', liveStorageProvider(undefined), 'local');
eq('provider 显示名', storageOptionLabel(defs, 'provider', 'aliyun'), 'Alibaba Cloud OSS');
eq('provider 显示名缺选项 ⇒ 原值', storageOptionLabel(defs, 'provider', 'weird'), 'weird');
eq('option label 缺失 ⇒ 回落 value',
  storageOptionLabel([{ key: 'k', options: [{ value: 'v' }] }], 'k', 'v'), 'v');

// toggle 契约是 "true"|"false"（**不吃** 1/on/yes —— 与 parseBool 不同）
eq('toggle 读：true', storageToggleOn('true'), true);
eq('toggle 读：false', storageToggleOn('false'), false);
eq('toggle 读：1 不算开', storageToggleOn('1'), false);
eq('toggle 读：空', storageToggleOn(undefined), false);

eq('回读判定：命中', storageSaveApplied({ provider: 's3' }, 'provider', 's3'), true);
eq('回读判定：未命中', storageSaveApplied({ provider: 'local' }, 'provider', 's3'), false);
eq('回读判定：无返回', storageSaveApplied(undefined, 'provider', 's3'), false);

// 载入期防御性打码（纵深防御：真凭据绝不进渲染路径）
const maskedCfg: Record<string, string> = maskPasswordFields(
  { provider: 'aliyun', s3_secret_key: 'REALSECRET', s3_access_key: 'AKID', _active: 'aliyun' }, defs);
eq('密码字段被打码', maskedCfg['s3_secret_key'], 'REAL****');
eq('非密码字段不动', maskedCfg['s3_access_key'], 'AKID');
eq('元键保留', maskedCfg['_active'], 'aliyun');
// 幂等：已打码的再打一次不变
eq('打码幂等', maskPasswordFields({ s3_secret_key: 'AKID****' }, defs)['s3_secret_key'], 'AKID****');
// 空值不打码（保持空 ⇒ placeholder 生效）
eq('空密码字段保持空', maskPasswordFields({ s3_secret_key: '' }, defs)['s3_secret_key'], '');
// 非密码 schema 不受影响
eq('无 password 字段时原样', maskPasswordFields({ provider: 'local' }, [{ key: 'provider', type: 'select' }])['provider'],
  'local');
// ⛔ 关键：打完码后回传的就是掩码 ⇒ 服务端跳过写入 ⇒ 真凭据不变
eq('打码后回传载荷 = 掩码', buildStorageValues(editableAliyun, (k: string) =>
  (k === 'provider' ? 'aliyun' : maskedCfg[k] !== undefined ? maskedCfg[k] : ''))['s3_secret_key'], 'REAL****');
ok('回传形态含 ****（服务端因此跳过）', isMaskedSecret(maskedCfg['s3_secret_key']));

// ── ⑦ webusers 纯逻辑 ────────────────────────────────────────────────────────

eq('用户名归一 trim', normalizeUsernameInput('  alice  '), 'alice');
eq('用户名归一 undefined', normalizeUsernameInput(undefined), '');
eq('可提交：正常', isValidUsername('alice'), true);
eq('可提交：纯空白拒绝', isValidUsername('   '), false);
eq('可提交：空拒绝', isValidUsername(''), false);
eq('解包 users', webUsersFrom({ users: [{ username: 'a' }] }).length, 1);
eq('解包缺 users ⇒ 空', webUsersFrom({} as WebUsersData).length, 0);
eq('解包非数组 ⇒ 空', webUsersFrom({ users: 'oops' as unknown as never }).length, 0);
eq('解包 undefined ⇒ 空', webUsersFrom(undefined).length, 0);
eq('一次性密码提示', oneTimePasswordNotice('alice', 'pw-123'), '账号 alice 已创建：pw-123');
eq('一次性密码对象', JSON.stringify(new OneTimePw('alice', 'pw')), '{"username":"alice","password":"pw"}');

console.log(`\n${fail === 0 ? '✅' : '❌'} settings 配置面契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
