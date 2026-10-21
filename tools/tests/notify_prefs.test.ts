/**
 * 通知**偏好**（哪些事件才打扰）+ 档位映射门禁 —— 覆盖 `core/settings.ets` 与 `core/notify.ets`
 * 的纯函数（脱机可跑，不碰 SDK）。
 *
 * 守护的不变量：
 *   · `notifyPrefsFrom`：**缺失即开**（默认两类都开）+ 宽松布尔归一 + 垃圾值不静默关提醒；
 *   · `notifyPrefEnabled`：档位 → 是否允许；
 *   · `shouldNotifyWithPrefs`：前台抑制 ∧ 偏好；
 *   · `shouldNotify`（线上入口）：未接线（模块级默认偏好）时 **与接线前逐字等价**（两类都发）；
 *   · `applyNotifyPrefs`：设置表 → 模块级缓存，且**立即生效**（`shouldNotify` 随之改变）；
 *   · `kindFromNotifyTitle`：标题 → 档位（`publishTurn` 用它决定 slot / 按钮 / 形态）；
 *   · `slotTagFor`：ask → social（横幅+响铃）、turn_done → content（静默）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  KEY_NOTIFY_ASK,
  KEY_NOTIFY_TURN_DONE,
  NotifyPrefs,
  defaultNotifyPrefs,
  notifyPrefValue,
  notifyPrefsFrom,
} from '../../entry/src/main/ets/core/settings';
import {
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_NONE,
  NOTIFY_KIND_TURN_DONE,
  NOTIFY_SLOT_CONTENT,
  NOTIFY_SLOT_SOCIAL,
  applyNotifyPrefs,
  kindFromNotifyTitle,
  notifyPrefEnabled,
  notifyPrefsSnapshot,
  notifyTitle,
  shouldNotify,
  shouldNotifyWithPrefs,
  slotTagFor,
} from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 键名契约（与服务端映射表一致）────────────────────────────────────────────
eq('偏好键名（本地）', `${KEY_NOTIFY_ASK}/${KEY_NOTIFY_TURN_DONE}`,
  'xbot-notify-ask/xbot-notify-turn-done');

// ── notifyPrefsFrom：默认值 + 迁移 + 宽容 ────────────────────────────────────
const dflt = notifyPrefsFrom({});
eq('默认值：两类都开（与接线前等价）', `${dflt.ask}/${dflt.turnDone}`, 'true/true');
eq('默认值常量与解析一致', `${defaultNotifyPrefs().ask}/${defaultNotifyPrefs().turnDone}`, 'true/true');

eq('缺 ask 键 ⇒ 开（缺失即开）', notifyPrefsFrom({ [KEY_NOTIFY_TURN_DONE]: '0' }).ask, true);
eq('缺 turn_done 键 ⇒ 开', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '0' }).turnDone, true);

eq('ask=0 ⇒ 关', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '0' }).ask, false);
eq('ask=false ⇒ 关', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: 'false' }).ask, false);
eq('ask=off ⇒ 关', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: 'off' }).ask, false);
eq('ask=no ⇒ 关', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: 'no' }).ask, false);
eq('ask=1 ⇒ 开', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '1' }).ask, true);
eq('turn_done=on ⇒ 开', notifyPrefsFrom({ [KEY_NOTIFY_TURN_DONE]: 'on' }).turnDone, true);
eq('ask=TRUE（大小写/空白宽容）⇒ 开', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '  TRUE ' }).ask, true);
eq('垃圾值（web 未来写入的未知串）⇒ 回落开，不静默关提醒',
  notifyPrefsFrom({ [KEY_NOTIFY_ASK]: 'v2' }).ask, true);
eq('空串 ⇒ 回落开', notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '' }).ask, true);
eq('两个都关', (() => {
  const p = notifyPrefsFrom({ [KEY_NOTIFY_ASK]: '0', [KEY_NOTIFY_TURN_DONE]: '0' });
  return `${p.ask}/${p.turnDone}`;
})(), 'false/false');

eq('写入值：开 = 1', notifyPrefValue(true), '1');
eq('写入值：关 = 0', notifyPrefValue(false), '0');

// ── notifyPrefEnabled：档位 × 偏好 ──────────────────────────────────────────
const both: NotifyPrefs = new NotifyPrefs(true, true);
const askOnly: NotifyPrefs = new NotifyPrefs(true, false);
const none: NotifyPrefs = new NotifyPrefs(false, false);
eq('偏好: 全开 + ask ⇒ 允许', notifyPrefEnabled(both, NOTIFY_KIND_ASK), true);
eq('偏好: 全开 + turn_done ⇒ 允许', notifyPrefEnabled(both, NOTIFY_KIND_TURN_DONE), true);
eq('偏好: 关 turn_done + turn_done ⇒ 拒绝', notifyPrefEnabled(askOnly, NOTIFY_KIND_TURN_DONE), false);
eq('偏好: 关 turn_done + ask ⇒ 仍允许', notifyPrefEnabled(askOnly, NOTIFY_KIND_ASK), true);
eq('偏好: 全关 ⇒ 都拒绝', `${notifyPrefEnabled(none, NOTIFY_KIND_ASK)}/${notifyPrefEnabled(none, NOTIFY_KIND_TURN_DONE)}`,
  'false/false');
eq('偏好: 无档位（NONE）⇒ 拒绝', notifyPrefEnabled(both, NOTIFY_KIND_NONE), false);
eq('偏好: 未知档位 ⇒ 拒绝（白名单）', notifyPrefEnabled(both, 'whatever'), false);

// ── shouldNotifyWithPrefs：前台抑制 ∧ 偏好（纯函数）─────────────────────────
eq('判据: 前台 + ask ⇒ 不发（抑制优先于偏好）', shouldNotifyWithPrefs(true, NOTIFY_KIND_ASK, both), false);
eq('判据: 后台 + ask + 允许 ⇒ 发', shouldNotifyWithPrefs(false, NOTIFY_KIND_ASK, both), true);
eq('判据: 后台 + turn_done + 禁止 ⇒ 不发', shouldNotifyWithPrefs(false, NOTIFY_KIND_TURN_DONE, askOnly), false);
eq('判据: 后台 + turn_done + 允许 ⇒ 发', shouldNotifyWithPrefs(false, NOTIFY_KIND_TURN_DONE, both), true);
eq('判据: 后台 + NONE ⇒ 不发', shouldNotifyWithPrefs(false, NOTIFY_KIND_NONE, both), false);

// ── shouldNotify（线上入口）：未接线 ⇒ 与接线前逐字等价 ──────────────────────
eq('入口: 未接线（默认偏好全开）+ 后台 + ask ⇒ 发', shouldNotify(false, NOTIFY_KIND_ASK), true);
eq('入口: 未接线 + 后台 + turn_done ⇒ 发', shouldNotify(false, NOTIFY_KIND_TURN_DONE), true);
eq('入口: 前台 ⇒ 不发', shouldNotify(true, NOTIFY_KIND_ASK), false);
eq('入口: 无档位 ⇒ 不发', shouldNotify(false, NOTIFY_KIND_NONE), false);

// ── applyNotifyPrefs：设置表 → 模块级缓存，**立即生效** ─────────────────────
const applied = applyNotifyPrefs({ [KEY_NOTIFY_TURN_DONE]: '0' });
eq('apply 返回解析结果', `${applied.ask}/${applied.turnDone}`, 'true/false');
eq('apply 后快照一致', `${notifyPrefsSnapshot().ask}/${notifyPrefsSnapshot().turnDone}`, 'true/false');
eq('apply 后：turn_done 被关 ⇒ 不发', shouldNotify(false, NOTIFY_KIND_TURN_DONE), false);
eq('apply 后：ask 不受影响 ⇒ 仍发', shouldNotify(false, NOTIFY_KIND_ASK), true);
// 复位（避免影响后续断言；测试进程内状态）
applyNotifyPrefs({});
eq('复位后：turn_done 恢复 ⇒ 发', shouldNotify(false, NOTIFY_KIND_TURN_DONE), true);

// ── kindFromNotifyTitle：标题 → 档位（publishTurn 的档位来源）───────────────
eq('反解: ask 标题 ⇒ ask', kindFromNotifyTitle(notifyTitle(NOTIFY_KIND_ASK, '会话A')), NOTIFY_KIND_ASK);
eq('反解: ask 标题（无会话名）⇒ ask', kindFromNotifyTitle(notifyTitle(NOTIFY_KIND_ASK, '')), NOTIFY_KIND_ASK);
eq('反解: turn_done 标题 ⇒ turn_done', kindFromNotifyTitle(notifyTitle(NOTIFY_KIND_TURN_DONE, '会话A')), NOTIFY_KIND_TURN_DONE);
eq('反解: 未知标题 ⇒ turn_done（保守）', kindFromNotifyTitle('随便什么标题'), NOTIFY_KIND_TURN_DONE);
eq('反解: 空标题 ⇒ turn_done', kindFromNotifyTitle(''), NOTIFY_KIND_TURN_DONE);
eq('反解: 与 notifyTitle 往返一致（ask）',
  kindFromNotifyTitle(notifyTitle(NOTIFY_KIND_ASK, 'x · y')), NOTIFY_KIND_ASK);

// ── slotTagFor：档位 → slot（ask 更醒目 / turn_done 静默）───────────────────
eq('slot: ask ⇒ social（LEVEL_HIGH：横幅 + 响铃）', slotTagFor(NOTIFY_KIND_ASK), NOTIFY_SLOT_SOCIAL);
eq('slot: turn_done ⇒ content（LEVEL_MIN：静默）', slotTagFor(NOTIFY_KIND_TURN_DONE), NOTIFY_SLOT_CONTENT);
eq('slot: 未知档位 ⇒ content（保守静默，不误弹横幅）', slotTagFor('z'), NOTIFY_SLOT_CONTENT);
eq('slot: 两个标签不同（保证 ask 比 turn_done 醒目）', NOTIFY_SLOT_SOCIAL !== NOTIFY_SLOT_CONTENT, true);

if (fail > 0) { console.log(`  notify_prefs: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_prefs: ${pass} passed, 0 failed`);
process.exit(0);

export {};
