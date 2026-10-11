/**
 * 通知**隐私开关**门禁 —— `KEY_NOTIFY_DETAIL`（"通知里是否展示回复/问题正文"）。
 *
 * 守护的不变量：
 *   · `NotifyPrefs.detail` **默认开**（缺失即开，口径同其它通知偏好）；
 *   · `notifyPrefsFrom` 能解析 `KEY_NOTIFY_DETAIL`（`0/false/off/no` ⇒ 关）；
 *   · `notifyBodyPlan(kind, detail, false)` ⇒ **正文绝不进系统可见面**：
 *     摘要回落兜底文案、无多行、无退化；`true`/缺省 ⇒ 正常展示；
 *   · 键表往返（`serverKey` / `localKey`）与展示名（`settingLabel`）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  KEY_NOTIFY_DETAIL,
  defaultNotifyPrefs,
  localKey,
  notifyPrefsFrom,
  serverKey,
  settingLabel,
} from '../../entry/src/main/ets/core/settings';
import {
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_TURN_DONE,
  NOTIFY_SHAPE_BASIC,
  notifyBodyPlan,
} from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const SECRET = '银行卡密码是 123456，请勿外传';

// ── 键表契约 ────────────────────────────────────────────────────────────────
eq('隐私键名（本地）', KEY_NOTIFY_DETAIL, 'xbot-notify-detail');
eq('隐私键 → 服务端键', serverKey(KEY_NOTIFY_DETAIL), 'web:ui:notify-detail');
eq('服务端键 → 本地键（往返）', localKey('web:ui:notify-detail'), KEY_NOTIFY_DETAIL);
eq('展示名（设置面板用）', settingLabel(KEY_NOTIFY_DETAIL), '通知显示回复内容');

// ── 默认值：缺失即开 ────────────────────────────────────────────────────────
eq('默认：展示正文（true）', defaultNotifyPrefs().detail, true);
eq('缺键 ⇒ 展示正文', notifyPrefsFrom({}).detail, true);
eq('垃圾值 ⇒ 回落展示正文（不静默变私密）', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: 'v2' }).detail, true);
eq('关：0', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: '0' }).detail, false);
eq('关：false', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: 'false' }).detail, false);
eq('关：off', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: 'off' }).detail, false);
eq('开：1', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: '1' }).detail, true);
eq('开：ON（大小写宽容）', notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: ' ON ' }).detail, true);
eq('隐私开关与事件开关互不影响',
  (() => { const p = notifyPrefsFrom({ [KEY_NOTIFY_DETAIL]: '0' }); return `${p.ask}/${p.turnDone}/${p.detail}`; })(),
  'true/true/false');

// ── 语义核心：关闭时正文**绝不**出现在通知可见面 ─────────────────────────────
const askHidden = notifyBodyPlan(NOTIFY_KIND_ASK, SECRET, false);
eq('关：ask 摘要 = 兜底文案（不含密文）', askHidden.preview, '智能体在等待你的输入');
eq('关：ask 摘要里没有密文', askHidden.preview.indexOf('123456') >= 0, false);
eq('关：无多行（lines 空）', askHidden.lines.length, 0);
eq('关：形态回落单行', askHidden.shape, NOTIFY_SHAPE_BASIC);
eq('关：不触发退化', askHidden.degraded, false);

const doneHidden = notifyBodyPlan(NOTIFY_KIND_TURN_DONE, 'x'.repeat(5000), false);
eq('关：超长正文也只给兜底文案', doneHidden.preview, '本轮回复已完成');
eq('关：超长正文也不进多行', doneHidden.lines.length, 0);

// ── 打开（缺省）时行为与上一轮**逐字一致** ───────────────────────────────────
const askShown = notifyBodyPlan(NOTIFY_KIND_ASK, SECRET, true);
eq('开：ask 摘要 = 原文', askShown.preview, SECRET);
const doneShown = notifyBodyPlan(NOTIFY_KIND_TURN_DONE, 'x'.repeat(500));
eq('开：长正文 ⇒ multiline（功能不受影响）', doneShown.shape, 'multiline');
eq('开：长正文保留全文（无 …）', doneShown.lines[0].length, 500);
eq('缺省第三参 = 展示（向后兼容）',
  JSON.stringify(notifyBodyPlan(NOTIFY_KIND_ASK, SECRET)),
  JSON.stringify(notifyBodyPlan(NOTIFY_KIND_ASK, SECRET, true)));

// ── 兜底文案本身不泄密 ──────────────────────────────────────────────────────
eq('兜底文案（ask）', notifyBodyPlan(NOTIFY_KIND_ASK, '', false).preview, '智能体在等待你的输入');
eq('兜底文案（turn_done）', notifyBodyPlan(NOTIFY_KIND_TURN_DONE, '', false).preview, '本轮回复已完成');

if (fail > 0) { console.log(`  notify_privacy: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_privacy: ${pass} passed, 0 failed`);
process.exit(0);
