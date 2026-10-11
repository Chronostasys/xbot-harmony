/**
 * 「专业级」通知**正文形态**门禁 —— `core/notify.ets` 的纯函数（脱机可跑，不碰 SDK）。
 *
 * 守护的不变量（每条都对应一个**可证伪**的行为）：
 *   · `utf8Bytes`：按 UTF-8 计字节（系统上限以字节计；CJK=3、emoji=4）；
 *   · `truncateToBytes`：按字节截断且**不劈开码点**（emoji 不被切成半个），截断补 `…`；
 *   · `summarizeBody`：折叠态摘要（压换行/空白 + 截断）；
 *   · `bodyLines`：**长正文不被截断** —— 单段长正文零 `…`；超过 maxLines 段才在末段补 `…`；
 *   · `notifyShapeFor`：**给定长度 → 期望形态**（≤120 字 = 单行；>120 字 = 多行）；
 *   · `notifyBodyPlan`：把上面三件事合成一个规划（`publishTurn` 的唯一入口）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  COLLAPSED_MAX_CHARS,
  MULTILINE_MAX_LINES,
  MULTILINE_MAX_LINE_BYTES,
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_TURN_DONE,
  NOTIFY_SHAPE_BASIC,
  NOTIFY_SHAPE_MULTILINE,
  bodyLines,
  notifyBodyPlan,
  notifyShapeFor,
  summarizeBody,
  truncateToBytes,
  utf8Bytes,
} from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── utf8Bytes：UTF-8 字节计数 ───────────────────────────────────────────────
eq('utf8: 空串 = 0', utf8Bytes(''), 0);
eq('utf8: ASCII 逐字符 1 字节', utf8Bytes('abc'), 3);
eq('utf8: 拉丁重音（é）= 2 字节', utf8Bytes('é'), 2);
eq('utf8: CJK（中）= 3 字节', utf8Bytes('中'), 3);
eq('utf8: emoji（🙂，代理对）= 4 字节', utf8Bytes('🙂'), 4);
eq('utf8: 混合（中文 a）= 3+3+1', utf8Bytes('中文a'), 7);
eq('utf8: 两个 emoji = 8', utf8Bytes('🙂🙂'), 8);
eq('utf8: 与 TextEncoder 语义一致（中文测试 = 12）', utf8Bytes('中文测试'), 12);

// ── truncateToBytes：按字节截断、不劈开码点 ─────────────────────────────────
eq('截断: 未超限原样返回', truncateToBytes('abcdef', 10), 'abcdef');
eq('截断: 恰好等于上限原样', truncateToBytes('abcdef', 6), 'abcdef');
eq('截断: ASCII 截到 3 = abc…', truncateToBytes('abcdef', 3), 'abc…');
eq('截断: 上限 0 ⇒ 空串', truncateToBytes('abcdef', 0), '');
eq('截断: 上限负数 ⇒ 空串', truncateToBytes('abcdef', -1), '');
eq('截断: CJK 截到 6 字节 = 中文…', truncateToBytes('中文测试', 6), '中文…');
eq('截断: CJK 未超限 = 中文测试', truncateToBytes('中文测试', 12), '中文测试');
eq('截断: emoji 截到 4 字节 = 一个 emoji + …（不劈开）', truncateToBytes('🙂🙂', 4), '🙂…');
eq('截断: emoji 8 字节够装两个', truncateToBytes('🙂🙂', 8), '🙂🙂');
eq('截断: 结果必带省略号（超限时）', truncateToBytes('x'.repeat(50), 10), `${'x'.repeat(10)}…`);

// ── summarizeBody：折叠态摘要 ───────────────────────────────────────────────
eq('摘要: 压换行/制表/多空格为单空格', summarizeBody('a\n\n  b\tc ', 100), 'a b c');
eq('摘要: 纯空白 ⇒ 空串', summarizeBody('   \n  ', 100), '');
eq('摘要: 未超限不加省略号', summarizeBody('x'.repeat(COLLAPSED_MAX_CHARS), 120), 'x'.repeat(120));
eq('摘要: 超限截到 120 + 省略号', summarizeBody('x'.repeat(200), 120), `${'x'.repeat(120)}…`);
eq('摘要: 超 1 个字就截', summarizeBody('x'.repeat(121), 120), `${'x'.repeat(120)}…`);
eq('摘要: 上限 0 ⇒ 空串', summarizeBody('abc', 0), '');

// ── bodyLines：多行形态（**长正文不被截断**的核心）──────────────────────────
eq('多行: 空正文 ⇒ 空数组', bodyLines('', 3, 1000), []);
eq('多行: 纯空白 ⇒ 空数组', bodyLines(' \n \n', 3, 1000), []);
eq('多行: 单行短正文 ⇒ 一行', bodyLines('hello', 3, 1000), ['hello']);
eq('多行: 三段原样保留（保用户行结构）', bodyLines('第一行\n第二行\n第三行', 3, 1000), ['第一行', '第二行', '第三行']);
eq('多行: 空段被丢弃', bodyLines('a\n\n b \nc', 3, 1000), ['a', 'b', 'c']);

// ⭐ 核心：单段长正文（最典型的 turn_done 场景）**零截断**
const LONG500 = 'x'.repeat(500);
eq('多行: 单段 500 字 ⇒ 一行、**无省略号**（长回复不被截断）', bodyLines(LONG500, 3, 1000), [LONG500]);
eq('多行: 单段 500 字的结果里确实没有 …', bodyLines(LONG500, 3, 1000)[0].indexOf('…') >= 0, false);
// CJK 一段 500 字 = 1500 字节 > 1000 ⇒ 该段按字节截断（此时才出现 …）
eq('多行: 单段 CJK 500 字超 1000 字节 ⇒ 截断 + 省略号', bodyLines('中'.repeat(500), 3, 1000)[0].endsWith('…'), true);
eq('多行: 单段 CJK 截断后 ≤ 1000 字节内容（+省略号）', utf8Bytes(bodyLines('中'.repeat(500), 3, 1000)[0]), 999 + 3);

// 段数超过上限 ⇒ 只取前 N 段、末段补 …
eq('多行: 4 段但上限 3 ⇒ 取前 3 段、末段补 …', bodyLines('a\nb\nc\nd', 3, 1000), ['a', 'b', 'c…']);
eq('多行: 上限 1 ⇒ 只留第一段', bodyLines('a\nb\nc', 1, 1000), ['a…']);
eq('多行: 恰好 3 段（等于上限）不倒 …', bodyLines('a\nb\nc', 3, 1000), ['a', 'b', 'c']);
eq('多行: 上限 0（异常）按 1 处理', bodyLines('a\nb', 0, 1000), ['a…']);

// ── notifyShapeFor：给定长度 → 期望形态 ─────────────────────────────────────
eq('形态: 空串 ⇒ basic', notifyShapeFor(''), NOTIFY_SHAPE_BASIC);
eq('形态: 恰好 120 字 ⇒ basic', notifyShapeFor('x'.repeat(COLLAPSED_MAX_CHARS)), NOTIFY_SHAPE_BASIC);
eq('形态: 121 字 ⇒ multiline（阈值是 >120）', notifyShapeFor('x'.repeat(121)), NOTIFY_SHAPE_MULTILINE);
eq('形态: 500 字 ⇒ multiline', notifyShapeFor('x'.repeat(500)), NOTIFY_SHAPE_MULTILINE);
eq('形态: 形态标签本身（常量契约）', `${NOTIFY_SHAPE_BASIC}/${NOTIFY_SHAPE_MULTILINE}`, 'basic/multiline');
eq('形态: 多行上限 = 3（对齐 SDK lines ≤ 3）', MULTILINE_MAX_LINES, 3);
eq('形态: 每行字节上限 < SDK 的 1024（留余量）', MULTILINE_MAX_LINE_BYTES < 1024, true);

// ── notifyBodyPlan：合成规划（publishTurn 的唯一入口）───────────────────────
const pShort = notifyBodyPlan(NOTIFY_KIND_TURN_DONE, '');
eq('规划: 无细节 + 回合结束 ⇒ basic + 默认文案', `${pShort.shape}/${pShort.preview}`, 'basic/本轮回复已完成');
eq('规划: basic ⇒ lines 为空', pShort.lines.length, 0);

const pAsk = notifyBodyPlan(NOTIFY_KIND_ASK, '');
eq('规划: 无细节 + 待回答 ⇒ basic + 默认文案', `${pAsk.shape}/${pAsk.preview}`, 'basic/智能体在等待你的输入');

const pLong = notifyBodyPlan(NOTIFY_KIND_TURN_DONE, LONG500);
eq('规划: 500 字 ⇒ multiline', pLong.shape, NOTIFY_SHAPE_MULTILINE);
eq('规划: 500 字 ⇒ lines 保留全文（无 …）', pLong.lines, [LONG500]);
eq('规划: 500 字 ⇒ 折叠摘要 = 120 + …', pLong.preview, `${'x'.repeat(120)}…`);
eq('规划: 折叠摘要与展开正文是**两份**内容（摘要≠全文）', pLong.preview !== pLong.lines[0], true);

const segA = 'A'.repeat(40), segB = 'B'.repeat(40), segC = 'C'.repeat(40), segD = 'D'.repeat(40);
const pMulti = notifyBodyPlan(NOTIFY_KIND_ASK, `${segA}\n${segB}\n${segC}\n${segD}`);
eq('规划: 多段长问题（>120 字）⇒ multiline、取前 3 段', pMulti.lines, [segA, segB, `${segC}…`]);
eq('规划: 多段长问题的折叠摘要 = 压平 + 截到 120 + …',
  `${pMulti.preview.length}/${pMulti.preview.endsWith('…')}`, '121/true');
eq('规划: 多段但总长 ≤120 ⇒ 仍是 basic（形态看总长，与段数无关）',
  notifyBodyPlan(NOTIFY_KIND_ASK, '一\n二\n三\n四').shape, NOTIFY_SHAPE_BASIC);

// 空白细节 ⇒ 回落默认文案（与 notifyBody 同源）
eq('规划: 只有空白的细节 ⇒ 走默认文案', notifyBodyPlan(NOTIFY_KIND_ASK, '   ').preview, '智能体在等待你的输入');

if (fail > 0) { console.log(`  notify_content: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_content: ${pass} passed, 0 failed`);
process.exit(0);
