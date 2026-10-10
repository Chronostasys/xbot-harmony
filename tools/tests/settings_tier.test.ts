/**
 * 设置「llm → SubAgent 三档模型（tier）」的**纯逻辑契约测试**。
 *
 * 为什么这三类必须有判别力（用户点名：取值域校验 / 默认值回落 / 键映射）：
 *  1. **键映射**：档位写的是 `tier_<档>`（`channel/setting_keys.go:112-114`）——
 *     拼错前缀就把值写进一个没人读的键（服务端 `set_setting` 对 user 级键**不校验白名单**，
 *     会静默落库 ⇒ 用户以为设好了，实际子代理永远用默认档）。
 *  2. **取值域**：档位值有两种合法形态 `subID|model` 与**裸模型名**
 *     （`setting_keys.go:114` `ValidValues: "subID|model or plain model name"`），
 *     解析时按 `indexOf('|')` 分叉（web `SettingsLLM.tsx:211-221`）——
 *     分叉错 ⇒ 显示成 `undefined · xxx` 或把整个 `sub|model` 当成模型名。
 *  3. **默认值回落**：空值表示"未设置"（DefaultValue `""`）⇒ 必须显示占位而不是空串；
 *     订阅/模型条目查不到时只显示模型名，不能显示 `·` 尾巴。
 *
 * 另：选择列表的过滤（web `llm-console.tsx:363-367`）——`status === 'disabled'` 的模型
 * **不可选**，且搜索按 `model + ' ' + sub_name` 大小写不敏感匹配。这是取值域校验的一部分。
 */
declare const process: { exit: (c: number) => void };

import {
  formatTierValue, isTierEntryCurrent, parseTierValue, tierDisplayText, tierEntrySelectable,
  tierHint, tierKey, tierLabel, tierPickerEntries, TIERS, TIER_BALANCE, TIER_SWIFT,
  TIER_UNSET_TEXT, TIER_VANGUARD, tierValues, TierRef,
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

// ── ① 键映射 ────────────────────────────────────────────────────────────────

eq('三档顺序', TIERS, ['vanguard', 'balance', 'swift']);
eq('档位键名', [tierKey(TIER_VANGUARD), tierKey(TIER_BALANCE), tierKey(TIER_SWIFT)],
  ['tier_vanguard', 'tier_balance', 'tier_swift']);
eq('档位中文名', [tierLabel(TIER_VANGUARD), tierLabel(TIER_BALANCE), tierLabel(TIER_SWIFT)],
  ['先锋', '均衡', '疾速']);
eq('未知档原样透传', tierLabel('weird'), 'weird');
ok('三档都有用途说明', TIERS.every((t: string) => tierHint(t).length > 0));
eq('未设置占位文案', TIER_UNSET_TEXT, '未设置');

// ── ② 取值域：`subID|model` vs 裸模型名 ─────────────────────────────────────

const composite: TierRef | undefined = parseTierValue('sub-1|gpt-4o');
ok('组合值已解析', composite !== undefined);
eq('组合值 subId', composite !== undefined ? composite.subId : '?', 'sub-1');
eq('组合值 model', composite !== undefined ? composite.model : '?', 'gpt-4o');
eq('组合值不是裸模型', composite !== undefined ? composite.plainModel : '?', false);
eq('组合值 raw 保真', composite !== undefined ? composite.raw : '?', 'sub-1|gpt-4o');

const plain: TierRef | undefined = parseTierValue('gpt-4o');
ok('裸模型已解析', plain !== undefined);
eq('裸模型 subId 为空', plain !== undefined ? plain.subId : '?', '');
eq('裸模型 model', plain !== undefined ? plain.model : '?', 'gpt-4o');
eq('裸模型标记', plain !== undefined ? plain.plainModel : '?', true);

// 默认值回落：空/空白/undefined ⇒ undefined（= 未设置）
eq('空值 ⇒ 未设置', parseTierValue(''), undefined);
eq('空白 ⇒ 未设置', parseTierValue('   '), undefined);
eq('undefined ⇒ 未设置', parseTierValue(undefined), undefined);
// 边界：多个 `|` 只按**第一个**切（web `indexOf` 语义）
const multi: TierRef | undefined = parseTierValue('sub|a|b');
eq('多分隔符只在第一个切', [multi !== undefined ? multi.subId : '?', multi !== undefined ? multi.model : '?'],
  ['sub', 'a|b']);
// 边界：空 subId（`|model`）
const emptySub: TierRef | undefined = parseTierValue('|gpt');
eq('空 subId', [emptySub !== undefined ? emptySub.subId : '?', emptySub !== undefined ? emptySub.model : '?',
  emptySub !== undefined ? emptySub.plainModel : '?'], ['', 'gpt', false]);

// 组装（web pickTier：`subID + '|' + model`）
eq('组装档位值', formatTierValue('sub-1', 'gpt-4o'), 'sub-1|gpt-4o');
eq('组装可往返', (() => {
  const r: TierRef | undefined = parseTierValue(formatTierValue('s', 'm'));
  return r !== undefined ? [r.subId, r.model] : [];
})(), ['s', 'm']);

// ── ③ 展示回落（查不到订阅/条目时不留 `·` 尾巴）────────────────────────────

const subs: SubscriptionRow[] = [
  { id: 'sub-1', name: '主力订阅', provider: 'openai', base_url: 'https://x', api_key: 'ab****',
    model: 'gpt-4o', active: true },
];
const entries: ModelEntryRow[] = [
  { sub_id: 'sub-1', sub_name: '主力订阅', model: 'gpt-4o', status: 'normal' },
  { sub_id: 'sub-2', sub_name: '备用订阅', model: 'claude-x', status: 'normal' },
  { sub_id: 'sub-2', sub_name: '备用订阅', model: 'dead-model', status: 'disabled' },
];

eq('未设置 ⇒ 空串（调用方显示占位）', tierDisplayText('', entries, subs), '');
eq('组合值命中订阅名', tierDisplayText('sub-1|gpt-4o', entries, subs), 'gpt-4o · 主力订阅');
eq('组合值订阅查不到 ⇒ 只显示模型', tierDisplayText('sub-9|ghost', entries, subs), 'ghost');
eq('裸模型命中条目 ⇒ 带出订阅名', tierDisplayText('claude-x', entries, subs), 'claude-x · 备用订阅');
eq('裸模型查不到 ⇒ 只显示模型', tierDisplayText('nobody', entries, subs), 'nobody');
eq('空订阅列表不炸', tierDisplayText('sub-1|gpt-4o', [], []), 'gpt-4o');

// ── ④ 选择列表过滤（取值域 + 搜索）─────────────────────────────────────────

eq('disabled 不可选', tierEntrySelectable('disabled'), false);
eq('normal 可选', tierEntrySelectable('normal'), true);
eq('offline 可选', tierEntrySelectable('offline'), true);
eq('缺 status 可选', tierEntrySelectable(undefined), true);

eq('无搜索词 ⇒ 全部可选（剔除 disabled）',
  tierPickerEntries(entries, '').map((e: ModelEntryRow) => e.model), ['gpt-4o', 'claude-x']);
eq('搜模型名（大小写不敏感）',
  tierPickerEntries(entries, 'CLAUDE').map((e: ModelEntryRow) => e.model), ['claude-x']);
eq('搜订阅名', tierPickerEntries(entries, '备用').map((e: ModelEntryRow) => e.model), ['claude-x']);
eq('搜不到 ⇒ 空', tierPickerEntries(entries, 'zzz').length, 0);
eq('搜索不得把 disabled 放回来',
  tierPickerEntries(entries, 'dead').length, 0);
eq('空白搜索词 = 无搜索', tierPickerEntries(entries, '   ').length, 2);

// 当前项判定（web `props.value === sub_id + '|' + model`）
eq('当前项：精确匹配', isTierEntryCurrent('sub-1|gpt-4o', entries[0]), true);
eq('当前项：同模型不同订阅 ⇒ 不匹配', isTierEntryCurrent('sub-2|gpt-4o', entries[0]), false);
eq('当前项：裸模型 ≠ 组合值', isTierEntryCurrent('gpt-4o', entries[0]), false);
eq('当前项：未设置 ⇒ 都不匹配', isTierEntryCurrent('', entries[0]), false);
eq('当前项：sub_id 缺失的条目', isTierEntryCurrent('|gpt-4o',
  { model: 'gpt-4o' } as ModelEntryRow), true);

// ── ⑤ 从 get_settings 取三档（默认值回落）──────────────────────────────────

const settings: Record<string, string> = {
  tier_vanguard: 'sub-1|gpt-4o',
  other_key: 'x',
};
const tv: Record<string, string> = tierValues(settings);
eq('取三档：命中', tv[TIER_VANGUARD], 'sub-1|gpt-4o');
eq('取三档：缺键 ⇒ 空', [tv[TIER_BALANCE], tv[TIER_SWIFT]], ['', '']);
eq('取三档：只含三档键', Object.keys(tv).sort(), ['balance', 'swift', 'vanguard']);
eq('取三档：undefined 载荷 ⇒ 全空', tierValues(undefined),
  { vanguard: '', balance: '', swift: '' });

console.log(`\n${fail === 0 ? '✅' : '❌'} settings tier 契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
