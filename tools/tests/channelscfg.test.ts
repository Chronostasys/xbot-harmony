/**
 * channelscfg.test.ts —— 设置 →「消息渠道」分区纯逻辑的**判别力测试**。
 *
 * 覆盖 `core/channelscfg.ets`（web 权威 `SettingsChannels.tsx:118-531` 的判据层）：
 *   A. 线格式解析（`_schema` / `get_channel_config` 回包 / 全容错）
 *   B. 字段口径（元键过滤 / 脏判 / 提交形状 / 不可变更新）
 *   C. 敏感掩码（展示掩码**不得**泄露原字符）
 *   D. 校验 / 就绪判定（端口静默改写的拦截 + 飞书凭据提示）
 *   E. 飞书引导与绑定状态机（形状守卫 / idle⇒失效 / 轮询与按钮文案 / 二次确认）
 *
 * ⛔ mutation 自证（把实现改回旧行为 ⇒ 下面必有真红）：
 *   · `isMetaKey` 去掉 `_` 前缀判断 ⇒ 「提交形状去元键」「脏判忽略元键」两组红；
 *   · `buildSaveValues` 不过滤元键 ⇒ `_schema`/`_builtin` 会进 values ⇒ 对应断言红；
 *   · `channelNames` 不把内置排前 ⇒ 排序断言红；
 *   · `applyBindStatus` 对 `idle` 不返回 `stale` ⇒ 「idle⇒链接失效」红；
 *   · `maskSecret` 返回原值（或含原字符）⇒ 掩码断言红；
 *   · `validatePort` 放宽（不判范围）⇒ 端口校验断言红；
 *   · `visibleFields` 不过滤 `enabled`/元键 ⇒ 字段过滤断言红。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import {
  applyBindStatus, bindButtonLabel, bindConfirmNeeded, bindFromStartResult, buildSaveValues,
  canSave, channelDescription, channelNames, channelTitle, channelTypeLabel, cloneChannelMap,
  channelRowKey, enabledValue, expirySeconds, fieldRowKey, fieldValue, isBuiltin, isDirty, isEnabled, isMetaKey,
  isSecretField, linkExpiryText, maskSecret, parseBindStatus, parseChannels, parseGuide, parseSchema,
  presetSummary, publicUrlNotice, readinessHints, saveButtonLabel, schemaRawOf, shouldPoll, showBound,
  bindErrorText,
  showOpenLink, showWaitingHint, visibleFields, withField, validateChannelDraft, validatePort,
  BIND_STATE_DONE, BIND_STATE_WAITING, FEISHU_BIND_DEFAULT_EXPIRES, RPC_FEISHU_BIND_START,
  RPC_FEISHU_BIND_STATUS, RPC_FEISHU_APP_GUIDE, RPC_GET_CHANNEL_CONFIG, RPC_SET_CHANNEL_CONFIG,
  ChannelField, FeishuGuide,
} from '../../entry/src/main/ets/core/channelscfg';

// ══ A. 线格式解析 ═════════════════════════════════════════════════════════════

describe('A. parseSchema：`_schema` → 字段（全容错）', () => {
  it('合法 JSON 数组 → 逐字段归一（label/description/type/default_value）', () => {
    const raw: string = JSON.stringify([
      { key: 'enabled', label: 'Enabled', type: 'toggle', default_value: 'false' },
      { key: 'port', label: 'Port', description: '监听端口', type: 'text', default_value: '8080' },
    ]);
    const fs: ChannelField[] = parseSchema(raw);
    expect(fs.length).toBe(2);
    expect(fs[1].key).toBe('port');
    expect(fs[1].label).toBe('Port');
    expect(fs[1].description).toBe('监听端口');
    expect(fs[1].defaultValue).toBe('8080');
  });

  it('非数组 / 坏 JSON / 空串 / undefined ⇒ 空数组（不崩）', () => {
    // mutation：parseSchema 去掉 Array.isArray 守卫 ⇒ 这几条必红
    expect(parseSchema('{"a":1}').length).toBe(0);
    expect(parseSchema('not json').length).toBe(0);
    expect(parseSchema('').length).toBe(0);
    expect(parseSchema(undefined).length).toBe(0);
    expect(parseSchema(null).length).toBe(0);
  });

  it('元素缺 string key ⇒ 跳过（web filter `typeof f.key === "string"`）', () => {
    const raw: string = JSON.stringify([{ label: 'no key' }, null, { key: 'host', label: 'Host' }]);
    const fs: ChannelField[] = parseSchema(raw);
    expect(fs.length).toBe(1);
    expect(fs[0].key).toBe('host');
  });
})

describe('A. isMetaKey / isBuiltin / schemaRawOf', () => {
  it('isMetaKey：`_` 前缀为真，其余为假（空串不算）', () => {
    expect(isMetaKey('_schema')).toBe(true);
    expect(isMetaKey('_builtin')).toBe(true);
    expect(isMetaKey('enabled')).toBe(false);
    expect(isMetaKey('app_secret')).toBe(false); // 中间有下划线但不以 _ 开头
    expect(isMetaKey('')).toBe(false);
  });

  it('isBuiltin：仅 "true" 为真（缺省/其它 = 插件）', () => {
    expect(isBuiltin({ _builtin: 'true' })).toBe(true);
    expect(isBuiltin({ _builtin: 'false' })).toBe(false);
    expect(isBuiltin({})).toBe(false);
    expect(isBuiltin(null)).toBe(false);
  });

  it('schemaRawOf：取 _schema 原始串，无则空', () => {
    expect(schemaRawOf({ _schema: '[{"key":"x"}]' })).toBe('[{"key":"x"}]');
    expect(schemaRawOf({})).toBe('');
    expect(schemaRawOf(undefined)).toBe('');
  });
})

describe('A. channelNames：内置优先 + 名称序（web `SettingsChannels.tsx:207-215`）', () => {
  it('内置排前，内置内部与插件内部分别按名称', () => {
    const ch: Record<string, Record<string, string>> = {
      slack: { _builtin: 'false' },
      web: { _builtin: 'true' },
      discord: { _builtin: 'false' },
      feishu: { _builtin: 'true' },
    };
    // mutation：不把内置排前 ⇒ 期望变 ['discord','feishu','slack','web'] ⇒ 红
    expect(channelNames(ch)).toEqual(['feishu', 'web', 'discord', 'slack']);
  });

  it('缺 _builtin ⇒ 当作插件渠道', () => {
    const ch: Record<string, Record<string, string>> = { zeta: {}, web: { _builtin: 'true' } };
    expect(channelNames(ch)).toEqual(['web', 'zeta']);
  });
})

describe('A. parseChannels / cloneChannelMap', () => {
  it('非字符串值归一为空串；null ⇒ 空表', () => {
    const raw: Record<string, Object> = { web: { enabled: 'true', port: 8080 } };
    const ch: Record<string, Record<string, string>> = parseChannels(raw);
    expect(ch['web']['enabled']).toBe('true');
    expect(ch['web']['port']).toBe(''); // 数字 8080 → ''
    expect(Object.keys(parseChannels(null)).length).toBe(0);
  });

  it('cloneChannelMap：克隆后改副本不影响原表（深一层）', () => {
    const a: Record<string, Record<string, string>> = { web: { enabled: 'true' } };
    const b: Record<string, Record<string, string>> = cloneChannelMap(a);
    b['web']['enabled'] = 'false';
    expect(a['web']['enabled']).toBe('true');
    expect(b['web']['enabled']).toBe('false');
  });
})

// ══ B. 字段口径 ═══════════════════════════════════════════════════════════════

describe('B. 取值 / 字段过滤', () => {
  it('fieldValue / isEnabled', () => {
    const d: Record<string, string> = { enabled: 'true', host: '0.0.0.0' };
    expect(fieldValue(d, 'host')).toBe('0.0.0.0');
    expect(fieldValue(d, 'missing')).toBe('');
    expect(isEnabled(d)).toBe(true);
    expect(isEnabled({ enabled: 'false' })).toBe(false);
    expect(isEnabled(null)).toBe(false);
  });

  it('visibleFields：排除 enabled 与元键，保留顺序', () => {
    const fs: ChannelField[] = [
      f('enabled'), f('host'), f('_schema'), f('port'), f('_builtin'),
    ];
    const vis: ChannelField[] = visibleFields(fs);
    expect(vis.map((x: ChannelField) => x.key)).toEqual(['host', 'port']);
  });
})

describe('B. 脏判 / 提交形状 / 不可变更新', () => {
  it('isDirty：忽略元键，只比非元键', () => {
    const orig: Record<string, string> = { enabled: 'true', _schema: 'x' };
    expect(isDirty(orig, { enabled: 'true', _schema: 'x' })).toBe(false);
    expect(isDirty(orig, { enabled: 'false', _schema: 'x' })).toBe(true);
    // 元键不同**不算脏**
    expect(isDirty(orig, { enabled: 'true', _schema: 'DIFFERENT' })).toBe(false);
  });

  it('buildSaveValues：**绝不**回传 _schema/_builtin', () => {
    const draft: Record<string, string> = { enabled: 'true', port: '8080', _schema: 'x', _builtin: 'true' };
    const values: Record<string, string> = buildSaveValues(draft);
    expect(values).toEqual({ enabled: 'true', port: '8080' });
    // mutation：不过滤元键 ⇒ 下面红
    expect(Object.prototype.hasOwnProperty.call(values, '_schema')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(values, '_builtin')).toBe(false);
  });

  it('withField：返回新表，原表不动', () => {
    const orig: Record<string, Record<string, string>> = { feishu: { enabled: 'false' } };
    const next: Record<string, Record<string, string>> = withField(orig, 'feishu', 'enabled', 'true');
    expect(next['feishu']['enabled']).toBe('true');
    expect(orig['feishu']['enabled']).toBe('false');
  });

  it('withField：目标渠道不存在时补建', () => {
    const next: Record<string, Record<string, string>> = withField({}, 'web', 'host', '1.2.3.4');
    expect(next['web']['host']).toBe('1.2.3.4');
  });

  it('enabledValue', () => {
    expect(enabledValue(true)).toBe('true');
    expect(enabledValue(false)).toBe('false');
  });
})

// ══ C. 敏感掩码 ═══════════════════════════════════════════════════════════════

describe('C. 敏感掩码不得泄露原字符', () => {
  it('isSecretField：仅 type=password', () => {
    const p: ChannelField = f('app_secret', 'password');
    const t: ChannelField = f('app_id', 'text');
    expect(isSecretField(p)).toBe(true);
    expect(isSecretField(t)).toBe(false);
  });

  it('maskSecret：空 ⇒ 空；非空 ⇒ 定长圆点且**不含**原字符', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
    const m: string = maskSecret('super-secret-app-token');
    // mutation：maskSecret 返回原值 ⇒ 下面红
    expect(m).not.toContain('super');
    expect(m).not.toContain('token');
    expect(m).toBe('••••••••');
  });
})

// ══ D. 校验 / 就绪判定 ═══════════════════════════════════════════════════════

describe('D. 端口校验（拦服务端静默改 0）', () => {
  it('合法：空串 / 1 / 65535 / 8080', () => {
    expect(validatePort('')).toBe('');
    expect(validatePort('1')).toBe('');
    expect(validatePort('65535')).toBe('');
    expect(validatePort('8080')).toBe('');
  });

  it('非法：非数字 / 越界 ⇒ 非空错误（mutation：放宽范围 ⇒ 红）', () => {
    expect(validatePort('abc').length).toBeGreaterThan(0);
    expect(validatePort('80a').length).toBeGreaterThan(0);
    expect(validatePort('0').length).toBeGreaterThan(0);
    expect(validatePort('70000').length).toBeGreaterThan(0);
    expect(validatePort('65536').length).toBeGreaterThan(0);
  });

  it('validateChannelDraft：带 label 的错误', () => {
    const fs: ChannelField[] = [f('enabled', 'toggle'), f('port', 'text', 'Port')];
    expect(validateChannelDraft('web', { port: '70000' }, fs)).toBe('Port：端口需在 1–65535 之间');
    expect(validateChannelDraft('web', { port: '8080' }, fs)).toBe('');
    expect(validateChannelDraft('feishu', { app_id: 'x' }, [f('app_id', 'text')])).toBe('');
  });

  it('readinessHints：飞书启用却缺凭据 ⇒ 提示；其余为空', () => {
    expect(readinessHints('feishu', { enabled: 'true' })).toHaveLength(2);
    expect(readinessHints('feishu', { enabled: 'true', app_id: 'a' })).toHaveLength(1);
    expect(readinessHints('feishu', { enabled: 'false' })).toHaveLength(0);
    expect(readinessHints('web', { enabled: 'true' })).toHaveLength(0);
  });

  it('canSave / saveButtonLabel', () => {
    expect(canSave(true, false, '')).toBe(true);
    expect(canSave(false, false, '')).toBe(false);
    expect(canSave(true, true, '')).toBe(false);
    expect(canSave(true, false, '有错')).toBe(false);
    expect(saveButtonLabel(true)).toBe('保存中…');
    expect(saveButtonLabel(false)).toBe('保存');
  });

  it('渠道标题/类型/说明', () => {
    expect(channelTypeLabel(true)).toBe('内置');
    expect(channelTypeLabel(false)).toBe('插件渠道');
    expect(channelTitle('feishu', true)).toBe('feishu · 内置');
    expect(channelDescription(true)).toBe('');
    expect(channelDescription(false).length).toBeGreaterThan(0);
  });
})

// ══ E. 飞书引导 + 绑定状态机 ═════════════════════════════════════════════════

describe('E. feishu_app_guide 形状守卫', () => {
  it('完整形状 → 引导（默认 url 兜底）', () => {
    const g: FeishuGuide | null = parseGuide({
      scopes: ['im:message'], events: ['im.message.receive_v1'], callbacks: ['card.action'],
      needs_public_url: false,
    });
    expect(g).not.toBeNull();
    expect(g!.scopes).toHaveLength(1);
    expect(g!.createAppUrl).toBe('https://open.feishu.cn/app');
    expect(publicUrlNotice(g!).indexOf('无需公网') >= 0).toBe(true);
  });

  it('缺任一数组 ⇒ null（不崩面板）', () => {
    // mutation：去掉形状守卫 ⇒ 这几条红
    expect(parseGuide({ events: [], callbacks: [] })).toBeNull();
    expect(parseGuide({ scopes: 'x', events: [], callbacks: [] })).toBeNull();
    expect(parseGuide(null)).toBeNull();
  });

  it('presetSummary 反映三组数量', () => {
    const g: FeishuGuide | null = parseGuide({ scopes: ['a', 'b'], events: ['e'], callbacks: [] });
    expect(presetSummary(g!)).toBe('自动配置的内容：2 项权限 · 1 个事件 · 0 个回调');
  });

  it('needs_public_url=true ⇒ 提示需要公网', () => {
    const g: FeishuGuide | null = parseGuide({ scopes: [], events: [], callbacks: [], needs_public_url: true });
    expect(publicUrlNotice(g!)).toBe('需要可公网访问的回调地址');
  });
})

describe('E. 绑定状态机（以后端回包为准）', () => {
  it('applyBindStatus：idle ⇒ bind=null + stale=true（链接失效）', () => {
    const r = applyBindStatus({ state: 'idle' });
    expect(r.bind).toBeNull();
    // mutation：idle 不判 stale ⇒ 红
    expect(r.stale).toBe(true);
  });

  it('applyBindStatus：waiting ⇒ 采用服务端状态（stale=false）', () => {
    const r = applyBindStatus({ state: 'waiting', url: 'https://x', expires_in: 600 });
    expect(r.stale).toBe(false);
    expect(r.bind).not.toBeNull();
    expect(r.bind!.state).toBe(BIND_STATE_WAITING);
    expect(r.bind!.url).toBe('https://x');
  });

  it('applyBindStatus：null/坏回包 ⇒ stale（不假成功）', () => {
    expect(applyBindStatus(null).stale).toBe(true);
    expect(applyBindStatus(undefined).stale).toBe(true);
  });

  it('parseBindStatus：state 缺省 = idle', () => {
    expect(parseBindStatus({})!.state).toBe('idle');
    expect(parseBindStatus(null)).toBeNull();
  });

  it('bindFromStartResult：进入 waiting（url/app_id/expires_in）', () => {
    const b = bindFromStartResult({ url: 'https://open.feishu.cn/x', expires_in: 600, app_id: 'cli_1' });
    expect(b.state).toBe(BIND_STATE_WAITING);
    expect(b.url).toBe('https://open.feishu.cn/x');
    expect(b.appId).toBe('cli_1');
  });

  it('expirySeconds：缺省 600', () => {
    expect(expirySeconds(bindFromStartResult({ url: 'u' }))).toBe(FEISHU_BIND_DEFAULT_EXPIRES);
    expect(expirySeconds(bindFromStartResult({ url: 'u', expires_in: 120 }))).toBe(120);
    expect(expirySeconds(null)).toBe(FEISHU_BIND_DEFAULT_EXPIRES);
  });

  it('shouldPoll / showOpenLink / showWaitingHint：waiting 且未过期', () => {
    const b = bindFromStartResult({ url: 'u', expires_in: 600 });
    expect(shouldPoll(b, false)).toBe(true);
    expect(shouldPoll(b, true)).toBe(false);
    expect(shouldPoll(null, false)).toBe(false);
    expect(showOpenLink(b, false)).toBe(true);
    expect(showOpenLink(b, true)).toBe(false);
    expect(showOpenLink(bindFromStartResult({}), false)).toBe(false); // 无 url
    expect(showWaitingHint(b, false)).toBe(true);
    expect(showWaitingHint(b, true)).toBe(false);
  });

  it('showBound / bindErrorText', () => {
    const done = parseBindStatus({ state: BIND_STATE_DONE, app_id: 'x' })!;
    expect(showBound(done)).toBe(true);
    expect(showBound(bindFromStartResult({}))).toBe(false);
    const err = parseBindStatus({ state: 'error', error: 'boom' })!;
    expect(bindErrorText(err)).toBe('boom');
    expect(bindErrorText(done)).toBe('');
  });

  it('bindButtonLabel：in-flight / 重新生成 / 首次', () => {
    expect(bindButtonLabel(true, null)).toBe('正在获取链接…');
    expect(bindButtonLabel(false, bindFromStartResult({ url: 'u' }))).toBe('重新生成链接');
    expect(bindButtonLabel(false, null)).toBe('一键绑定飞书智能体应用');
  });

  it('bindConfirmNeeded：已有 waiting ⇒ 需二次确认（顶替会作废旧链接）', () => {
    expect(bindConfirmNeeded(bindFromStartResult({ url: 'u' }))).toBe(true);
    expect(bindConfirmNeeded(parseBindStatus({ state: 'done' }))).toBe(false);
    expect(bindConfirmNeeded(null)).toBe(false);
  });

  it('linkExpiryText 替换秒数', () => {
    expect(linkExpiryText(600)).toBe('链接 600 秒内有效，仅可使用一次');
  });
})

// ══ F. RPC 常量 + ForEach key ═════════════════════════════════════════════════

describe('F. RPC 常量名（与服务端 rpc_table.go / feishu_bind.go 逐字）', () => {
  it('method 名精确', () => {
    expect(RPC_GET_CHANNEL_CONFIG).toBe('get_channel_config');
    expect(RPC_SET_CHANNEL_CONFIG).toBe('set_channel_config');
    expect(RPC_FEISHU_BIND_START).toBe('feishu_bind_start');
    expect(RPC_FEISHU_BIND_STATUS).toBe('feishu_bind_status');
    expect(RPC_FEISHU_APP_GUIDE).toBe('feishu_app_guide');
  });
})

describe('F. ForEach key 稳定身份 + 值指纹', () => {
  it('channelRowKey 只随身份/类型变', () => {
    expect(channelRowKey('feishu', true)).toBe('feishu|b');
    expect(channelRowKey('feishu', false)).toBe('feishu|p');
  });

  it('fieldRowKey 含值指纹（值变 ⇒ key 变）', () => {
    expect(fieldRowKey('feishu', 'app_id', 'a')).not.toBe(fieldRowKey('feishu', 'app_id', 'b'));
  });
})

// ── 夹具 ──────────────────────────────────────────────────────────────────────
function f(key: string, type?: string, label?: string): ChannelField {
  const field: ChannelField = new ChannelField();
  field.key = key;
  if (type !== undefined) { field.type = type; }
  if (label !== undefined) { field.label = label; }
  return field;
}

process.exit(summary('channelscfg'));

export {};
