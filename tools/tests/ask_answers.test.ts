/**
 * AskUser 答案拼装的判别力测试（`core/msgops.ets:mergeAskAnswers`）。
 *
 * 逐字对齐 web `web/src/components/agent/AskUserPanel.tsx:37,67-88`：
 *   · `MULTI_JOIN = '、'`（多选连接）；
 *   · `answers` 的**键 = 问题下标 `String(i)`**（不是 `q.id`！旧实现用 q.id ⇒ 服务端按 web 契约取不到）；
 *   · 优先级「**自由文本 > 其它输入 > 已选标签**」（web `:71-85` 三段 `continue`，逐字同序）；
 *   · 「其它」是**开关不是答案**（web `:82`）⇒ 合并时从已选里剔除（`ASK_OTHER_LABEL`）；
 *   · 无答案的题**不落键**；`askAnsweredFlags`/`askAllAnswered` 决定「提交」可用态（web `:90,:355`）。
 *
 * ⚠️ 结尾必须 process.exit（run.sh set -e 且逐文件 node）。
 */
declare const process: { exit: (c: number) => void };

import {
  AskAnswerInput, ASK_OTHER_LABEL, askAllAnswered, askAnsweredFlags, mergeAskAnswers, MULTI_JOIN,
} from '../../entry/src/main/ets/core/msgops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('MULTI_JOIN = 、', MULTI_JOIN, '、');

// ① ★ 键 = 问题下标（两题 ⇒ 键集合必须是 {"0","1"}）
{
  const out: Record<string, string> = mergeAskAnswers([
    new AskAnswerInput(['甲'], '', ''),
    new AskAnswerInput(['乙'], '', ''),
  ]);
  eq('键集合 = {0,1}', Object.keys(out).sort(), ['0', '1']);
  eq('第 0 题', out['0'], '甲');
  eq('第 1 题', out['1'], '乙');
}

// ② ★ 多选以 `、` 连接（旧实现用 `, ` 或 `；` ⇒ 红）
eq('多选以 、 连接', mergeAskAnswers([new AskAnswerInput(['A', 'B', 'C'], '', '')])['0'], 'A、B、C');

// ③ ★ "其它"独占答案（旧实现拼成 `甲；其它` ⇒ 红）
eq('其它独占（压过已选）', mergeAskAnswers([new AskAnswerInput(['甲'], '自定义', '')])['0'], '自定义');
eq('其它 = 空 ⇒ 用已选', mergeAskAnswers([new AskAnswerInput(['甲'], '   ', '')])['0'], '甲');

// ④ 空选择 ⇒ 不进 answers（与 web `Boolean(mergedAnswers[key])` 同）
{
  const out: Record<string, string> = mergeAskAnswers([new AskAnswerInput([], '', ''), new AskAnswerInput(['仅这题'], '', '')]);
  eq('空题不产出键', Object.keys(out), ['1']);
  eq('非空题在下标 1', out['1'], '仅这题');
}

// ⑤ 空输入
eq('空输入 ⇒ {}', mergeAskAnswers([]), {});

// ⑥ ★ 自由文本优先级**最高**（web `:71-75`：free 先 `continue`）—— 压过"其它"与已选
eq('自由文本压过其它与已选',
  mergeAskAnswers([new AskAnswerInput(['甲'], '自定义', '我要别的东西')])['0'], '我要别的东西');
eq('自由文本 = 纯空白 ⇒ 让位给其它',
  mergeAskAnswers([new AskAnswerInput(['甲'], '自定义', '   ')])['0'], '自定义');
eq('自由文本 = 纯空白且无其它 ⇒ 用已选',
  mergeAskAnswers([new AskAnswerInput(['甲'], '', '  ')])['0'], '甲');
eq('自由文本前后空白被 trim',
  mergeAskAnswers([new AskAnswerInput([], '', '  只有文本  ')])['0'], '只有文本');

// ⑦ ★ 「其它」是**开关不是答案**（web `:82 realPicks`）：只点不填 ⇒ 该题**无答案**
eq('只选「其它」不填 ⇒ 不落键（否则会提交出开关文案）',
  mergeAskAnswers([new AskAnswerInput([ASK_OTHER_LABEL], '', '')]), {});
eq('「其它」+ 真实已选（无其它文本）⇒ 只提交真实已选',
  mergeAskAnswers([new AskAnswerInput([ASK_OTHER_LABEL, '甲'], '', '')])['0'], '甲');
eq('ASK_OTHER_LABEL 文案与页面/组件同源', ASK_OTHER_LABEL, '其他（自己填）');

// ⑧ ★ 逐题已答标记（向导圆点三态 + 「提交」可用态，web `:90,:355`）
{
  const answers: Record<string, string> = mergeAskAnswers([
    new AskAnswerInput(['甲'], '', ''),
    new AskAnswerInput([], '', ''),
    new AskAnswerInput([], '', '自由'),
  ]);
  eq('已答标记逐题', askAnsweredFlags(answers, 3), [true, false, true]);
  eq('未全答 ⇒ 不可提交', askAllAnswered(askAnsweredFlags(answers, 3)), false);
  const all: Record<string, string> = mergeAskAnswers([
    new AskAnswerInput(['甲'], '', ''),
    new AskAnswerInput([], '自定义', ''),
  ]);
  eq('全答 ⇒ 可提交', askAllAnswered(askAnsweredFlags(all, 2)), true);
  eq('零问题 ⇒ 不可提交（空数组不许算"全答"）', askAllAnswered(askAnsweredFlags({}, 0)), false);
  eq('答案里的纯空白不算已答', askAnsweredFlags({ '0': '   ' }, 1), [false]);
}

if (fail > 0) { console.log(`  ask_answers: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ask_answers: ${pass} passed, 0 failed`);
process.exit(0);
