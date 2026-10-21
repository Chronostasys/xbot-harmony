/**
 * `activeChannel` 本地持久化的键/默认/回落判别力测试（`core/sessionpick.ets` 的纯函数）。
 *
 * 对齐 web 权威 `hooks/useSessionStore.ts:45 ACTIVE_CHANNEL_KEY='xbot:active-channel'`、
 * `:137 activeChannel`、`:289-308 loadActiveChannel/persistActiveChannel`。
 * ⚠️ web 存 localStorage，原生存 @kit.ArkData preferences（`core/config.ets`）——
 *    容器不同、**键字符串一致**；读（init）与写（saveActiveChannel）共用同一归一化函数。
 */
declare const process: { exit: (c: number) => void };

import {
  ACTIVE_CHANNEL_KEY, DEFAULT_ACTIVE_CHANNEL, normalizeActiveChannel,
} from '../../entry/src/main/ets/core/sessionpick';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ① ★ 键字符串与 web 逐字一致（改一个字符即与 web 脱钩 ⇒ 本断言红）
eq('★ 键 = xbot:active-channel', ACTIVE_CHANNEL_KEY, 'xbot:active-channel');

// ② 默认 = 空串（= 全部）
eq('默认 = 空串（全部）', DEFAULT_ACTIVE_CHANNEL, '');

// ③ ★ 读盘归一化：null/undefined/纯空白 ⇒ 默认
eq('null ⇒ 默认', normalizeActiveChannel(null), '');
eq('undefined ⇒ 默认', normalizeActiveChannel(undefined), '');
eq('纯空白 ⇒ 默认', normalizeActiveChannel('   '), '');

// ④ 正常值保留（并 trim）
eq('普通渠道保留', normalizeActiveChannel('feishu'), 'feishu');
eq('两端空白被 trim', normalizeActiveChannel('  web  '), 'web');

// ⑤ ★ 非法值回落：给了候选集而值不在其中（渠道已消失）⇒ 默认（避免列表恒空）
eq('★ 不在候选集 ⇒ 回落全部', normalizeActiveChannel('telegram', ['web', 'cli', 'feishu']), '');
eq('在候选集 ⇒ 保留', normalizeActiveChannel('cli', ['web', 'cli', 'feishu']), 'cli');
eq('候选集为空 ⇒ 不校验（保留）', normalizeActiveChannel('telegram', []), 'telegram');

// ⑥ 读、写共用同一函数（写路径也走 normalizeActiveChannel）
eq('写路径归一（空 ⇒ 默认）', normalizeActiveChannel(''), '');
eq('写路径归一（空白 ⇒ 默认）', normalizeActiveChannel('  '), '');

if (fail > 0) { console.log(`  active_channel_pref: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  active_channel_pref: ${pass} passed, 0 failed`);
process.exit(0);

export {};
