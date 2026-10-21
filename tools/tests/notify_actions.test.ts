/**
 * 「专业级」通知 **动作按钮 + 优雅退化 + 字节边界** 门禁 —— `core/notify.ets` 的纯函数
 * （脱机可跑，不碰 SDK）。
 *
 * 守护的不变量：
 *   · `truncateBytesRaw`：按字节裁前缀、**不补省略号**、不劈开码点；
 *   · `bodyLinesDetailed`：行数组 + **truncated 标志**（区分"刚好 N 段"与"被砍"）；
 *   · `withMoreHint`：**优雅退化** —— 末行 `…` 换成"…完整内容见应用内"，且末行仍 ≤ 字节上限；
 *   · `notifyBodyPlan.degraded`：超容量 ⇒ true；容量内 ⇒ false（可证伪的判据）；
 *   · `clampTitle`：标题 ≤ MAX_TITLE_BYTES（SDK title 上限 1024 字节的保守版）；
 *   · `notifyActionsFor` / `notifyActionTitle` / `notifyActionFromParam`：**动作契约**
 *     （发射哪些 / 标题真值 / 外来参数白名单）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  MAX_TITLE_BYTES,
  MULTILINE_MAX_LINES,
  MULTILINE_MAX_LINE_BYTES,
  MULTILINE_TOTAL_BYTES,
  NOTIFY_ACTION_CONTINUE,
  NOTIFY_ACTION_OPEN,
  NOTIFY_ACTION_STOP,
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_TURN_DONE,
  NOTIFY_MAX_ACTIONS,
  NOTIFY_MORE_HINT,
  NotifyAction,
  bodyLinesDetailed,
  clampTitle,
  isKnownNotifyAction,
  notifyActionFromParam,
  notifyActionTitle,
  notifyActionsFor,
  notifyBodyPlan,
  truncateBytesRaw,
  truncateToBytes,
  utf8Bytes,
  withMoreHint,
} from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 字节预算常量自洽 ────────────────────────────────────────────────────────
eq('常量: 多行总量 = 3 行 × 1000 字节 = 3000', MULTILINE_TOTAL_BYTES, 3000);
eq('常量: 多行总量 ≤ text 上限 3072（自洽）', MULTILINE_TOTAL_BYTES <= 3072, true);
eq('常量: 标题上限 < 1024（留余量）', MAX_TITLE_BYTES < 1024, true);
eq('常量: 动作按钮上限 = 2（SDK: 最多两枚）', NOTIFY_MAX_ACTIONS, 2);

// ── truncateBytesRaw：按字节裁前缀、不补省略号 ──────────────────────────────
eq('raw: 未超限原样', truncateBytesRaw('abcdef', 10), 'abcdef');
eq('raw: 恰好等于上限原样', truncateBytesRaw('abcdef', 6), 'abcdef');
eq('raw: ASCII 截到 3 = abc（**无 …**）', truncateBytesRaw('abcdef', 3), 'abc');
eq('raw: 上限 0 ⇒ 空串', truncateBytesRaw('abcdef', 0), '');
eq('raw: CJK 截到 6 字节 = 中文（无 …）', truncateBytesRaw('中文测试', 6), '中文');
eq('raw: emoji 整对进，不劈开', truncateBytesRaw('🙂🙂', 4), '🙂');
eq('raw: 结果字节数 ≤ 上限', utf8Bytes(truncateBytesRaw('中文测试', 6)) <= 6, true);
// 与 truncateToBytes 的关系：后者 = 前者 + （若被裁）"…"
eq('raw vs 补省略号版：未裁不加', truncateToBytes('abc', 9), 'abc');
eq('raw vs 补省略号版：裁了才加', truncateToBytes('abcdef', 3), `${truncateBytesRaw('abcdef', 3)}…`);

// ── bodyLinesDetailed：行数组 + 截断标志 ────────────────────────────────────
const rEmpty = bodyLinesDetailed('', 3, 1000);
eq('多行明细: 空 ⇒ 空数组 + 未截断', `${rEmpty.lines.length}/${rEmpty.truncated}`, '0/false');

const rShort = bodyLinesDetailed('hello', 3, 1000);
eq('多行明细: 单行短 ⇒ 1 行 + 未截断', `${JSON.stringify(rShort.lines)}/${rShort.truncated}`, '["hello"]/false');

const rThree = bodyLinesDetailed('a\nb\nc', 3, 1000);
eq('多行明细: 恰好 3 段（= 上限）⇒ 未截断', `${JSON.stringify(rThree.lines)}/${rThree.truncated}`, '["a","b","c"]/false');

const rFour = bodyLinesDetailed('a\nb\nc\nd', 3, 1000);
eq('多行明细: 4 段 > 上限 ⇒ 取前 3 + 末段 … + truncated', `${JSON.stringify(rFour.lines)}/${rFour.truncated}`,
  '["a","b","c…"]/true');

const rLong = bodyLinesDetailed('x'.repeat(500), 3, 1000);
eq('多行明细: 单段 500 字（容量内）⇒ 零截断', `${rLong.lines.length}/${rLong.truncated}/${rLong.lines[0].length}`, '1/false/500');

const rOver = bodyLinesDetailed('中'.repeat(500), 3, 1000);
eq('多行明细: 单段 CJK 1500 字节 > 1000 ⇒ truncated', rOver.truncated, true);
eq('多行明细: 截断后单行字节 ≤ 1000+省略号', utf8Bytes(rOver.lines[0]) <= 1000 + 3, true);

// ── withMoreHint：优雅退化（末行换成"…完整内容见应用内"）────────────────────
eq('退化: 末行 … 被换成提示语', withMoreHint(['a…'], 1000), [`a${NOTIFY_MORE_HINT}`]);
eq('退化: 无 … 也照样加提示语', withMoreHint(['abc'], 1000), [`abc${NOTIFY_MORE_HINT}`]);
eq('退化: 空数组 ⇒ 空数组（不崩）', withMoreHint([], 1000), []);
const hLong = withMoreHint(['x'.repeat(2000)], 1000);
eq('退化: 超长行裁到"正文 + 提示语 ≤ 1000 字节"', utf8Bytes(hLong[0]), 1000);
eq('退化: 而且确实以提示语结尾', hLong[0].endsWith(NOTIFY_MORE_HINT), true);
eq('退化: 没劈开码点（提示语完整）', hLong[0].indexOf(NOTIFY_MORE_HINT) > 0, true);

// ── notifyBodyPlan.degraded：超容量才退化（可证伪）──────────────────────────
const pOk = notifyBodyPlan(NOTIFY_KIND_ASK, 'x'.repeat(500));
eq('规划: 500 字（容量内）⇒ multiline 且 **未退化**', `${pOk.shape}/${pOk.degraded}`, 'multiline/false');
eq('规划: 未退化时行内无提示语', pOk.lines[0].indexOf(NOTIFY_MORE_HINT) >= 0, false);

// 多段超容量 ⇒ multiline 退化（行数超上限；单段超容量改走 long_text，见 notify_content.test.ts）
const pDeg = notifyBodyPlan(NOTIFY_KIND_ASK,
  ['x'.repeat(1500), 'y'.repeat(1500), 'z'.repeat(1500), 'w'.repeat(1500)].join('\n'));
eq('规划: 多段超容量 ⇒ multiline 且 **退化**', `${pDeg.shape}/${pDeg.degraded}`, 'multiline/true');
eq('规划: 退化时末行是提示语', pDeg.lines[pDeg.lines.length - 1].endsWith(NOTIFY_MORE_HINT), true);
eq('规划: 退化时折叠摘要仍非空（摘要 + 更深层）', pDeg.preview.length > 0, true);
eq('规划: 退化时行数不超上限', pDeg.lines.length <= MULTILINE_MAX_LINES, true);
eq('规划: basic 形态永不退化', notifyBodyPlan(NOTIFY_KIND_TURN_DONE, 'ok').degraded, false);
eq('规划: 折叠摘要字节 ≤ text 上限', utf8Bytes(pDeg.preview) <= 3072, true);

// ── clampTitle：标题按字节夹取 ──────────────────────────────────────────────
eq('标题: 短标题原样', clampTitle('回合已完成 · 会话A'), '回合已完成 · 会话A');
eq('标题: 超长标题被裁 + …', clampTitle('x'.repeat(2000)), `${'x'.repeat(MAX_TITLE_BYTES)}…`);
eq('标题: 裁剪后 ≤ 上限 + 省略号', utf8Bytes(clampTitle('中'.repeat(2000))) <= MAX_TITLE_BYTES + 3, true);

// ── 动作按钮契约 ────────────────────────────────────────────────────────────
const acts = notifyActionsFor(NOTIFY_KIND_ASK);
eq('动作: ask 至少一枚按钮', acts.length >= 1, true);
eq('动作: 按钮数 ≤ SDK 上限 2', acts.length <= NOTIFY_MAX_ACTIONS, true);
eq('动作: 第一枚是「查看」且 id=open（**端到端可用**的那个）',
  `${acts[0].id}/${acts[0].title}`, `${NOTIFY_ACTION_OPEN}/去回答`);
eq('动作: 实例确实被构造（NotifyAction）', acts[0] instanceof NotifyAction, true);
eq('动作: turn_done 发「继续」（= continue ⇒ 页面 store.send(/continue)）', notifyActionsFor(NOTIFY_KIND_TURN_DONE)[0].id, NOTIFY_ACTION_CONTINUE);

eq('动作标题: open ⇒ 查看', notifyActionTitle(NOTIFY_ACTION_OPEN), '查看');
eq('⛔ ask 档不得发 continue（防误触发「接着干」）',
  notifyActionsFor(NOTIFY_KIND_ASK)[0].id === NOTIFY_ACTION_CONTINUE, false);
eq('⛔ turn_done 档不得发 open（本体点击已覆盖「查看」）',
  notifyActionsFor(NOTIFY_KIND_TURN_DONE)[0].id === NOTIFY_ACTION_OPEN, false);
eq('动作标题: stop ⇒ 停止', notifyActionTitle(NOTIFY_ACTION_STOP), '停止');
eq('动作标题: continue ⇒ 继续', notifyActionTitle(NOTIFY_ACTION_CONTINUE), '继续');
eq('动作标题: 未知 ⇒ 回落「查看」', notifyActionTitle('zzz'), '查看');

eq('白名单: open 合法', isKnownNotifyAction(NOTIFY_ACTION_OPEN), true);
eq('白名单: stop 合法（预留）', isKnownNotifyAction(NOTIFY_ACTION_STOP), true);
eq('白名单: 乱串非法', isKnownNotifyAction('rm -rf'), false);

eq('参数解析: open ⇒ open', notifyActionFromParam('open'), 'open');
eq('参数解析: stop ⇒ stop', notifyActionFromParam('stop'), 'stop');
eq('参数解析: 缺失 ⇒ 空串', notifyActionFromParam(undefined), '');
eq('参数解析: 非字符串 ⇒ 空串', notifyActionFromParam(123), '');
eq('参数解析: 白名单外 ⇒ 空串（防注入）', notifyActionFromParam('evil'), '');
eq('参数解析: 空串 ⇒ 空串', notifyActionFromParam(''), '');

if (fail > 0) { console.log(`  notify_actions: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_actions: ${pass} passed, 0 failed`);
process.exit(0);

export {};
