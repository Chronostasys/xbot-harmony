/**
 * AskUser 答案拼装的判别力测试（`core/msgops.ets:mergeAskAnswers`）。
 *
 * 逐字对齐 web `web/src/components/agent/AskUserPanel.tsx:37,67-88`：
 *   · `MULTI_JOIN = '、'`（多选连接）；
 *   · `answers` 的**键 = 问题下标 `String(i)`**（不是 `q.id`！旧实现用 q.id ⇒ 服务端按 web 契约取不到）；
 *   · "其它"输入**独占**该题答案（不是附加 `；other` 后缀）。
 *
 * ⚠️ 结尾必须 process.exit（run.sh set -e 且逐文件 node）。
 */
declare const process: { exit: (c: number) => void };

import { AskAnswerInput, mergeAskAnswers, MULTI_JOIN } from '../../entry/src/main/ets/core/msgops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('MULTI_JOIN = 、', MULTI_JOIN, '、');

// ① ★ 键 = 问题下标（两题 ⇒ 键集合必须是 {"0","1"}）
{
  const out: Record<string, string> = mergeAskAnswers([
    new AskAnswerInput(['甲'], ''),
    new AskAnswerInput(['乙'], ''),
  ]);
  eq('键集合 = {0,1}', Object.keys(out).sort(), ['0', '1']);
  eq('第 0 题', out['0'], '甲');
  eq('第 1 题', out['1'], '乙');
}

// ② ★ 多选以 `、` 连接（旧实现用 `, ` 或 `；` ⇒ 红）
eq('多选以 、 连接', mergeAskAnswers([new AskAnswerInput(['A', 'B', 'C'], '')])['0'], 'A、B、C');

// ③ ★ "其它"独占答案（旧实现拼成 `甲；其它` ⇒ 红）
eq('其它独占（压过已选）', mergeAskAnswers([new AskAnswerInput(['甲'], '自定义')])['0'], '自定义');
eq('其它 = 空 ⇒ 用已选', mergeAskAnswers([new AskAnswerInput(['甲'], '   ')])['0'], '甲');

// ④ 空选择 ⇒ 不进 answers（与 web `Boolean(mergedAnswers[key])` 同）
{
  const out: Record<string, string> = mergeAskAnswers([new AskAnswerInput([], ''), new AskAnswerInput(['仅这题'], '')]);
  eq('空题不产出键', Object.keys(out), ['1']);
  eq('非空题在下标 1', out['1'], '仅这题');
}

// ⑤ 空输入
eq('空输入 ⇒ {}', mergeAskAnswers([]), {});

if (fail > 0) { console.log(`  ask_answers: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ask_answers: ${pass} passed, 0 failed`);
process.exit(0);
