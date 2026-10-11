/**
 * `core/askuser.ets` 的判别力测试（§12-G 定案：应答键恒为下标 + 多选连接符 `、` + web 的答案优先级）。
 *
 * 权威链（双端）：服务端 `protocol/ws.go:85`（`question index -> answer`，且 `web_inbound.go:447-453`
 * 只做 `Q<键>: <值>` **原样回显** ⇒ 键全由客户端定）；web `AskUserPanel.tsx:37/70/67-88/90`。
 *
 * ⛔ mutation 自证（改坏 ⇒ 真红）：
 *   · `askUserAnswerKeys` 改成用 `q.id`（缺省 `q{i}`）      ⇒ 「带 id 仍必须是下标」红；
 *   · `ASKUSER_MULTI_JOIN` 改成 `', '`                      ⇒ 「连接符 = 、」+ 反面板红；
 *   · `mergeAskUserAnswer` 去掉「减 otherLabel」             ⇒ 「Other 标签不算答案」红；
 *   · `mergeAskUserAnswer` 优先级调换（先 picks 后 other）   ⇒ 「Other 输入 > 已选项」红。
 */
declare const process: { exit: (c: number) => void };

import {
  ASKUSER_MULTI_JOIN, AskUserQuestionLike, askUserAnswered, askUserAnswerKeys, joinMultiAnswer,
  mergeAskUserAnswer,
} from '../../entry/src/main/ets/core/askuser';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── A. 应答键：**恒为下标** ──────────────────────────────────────────────────
{
  eq('★A 3 题 ⇒ [0,1,2]', askUserAnswerKeys([{}, {}, {}]), ['0', '1', '2']);
  eq('★A 空数组 ⇒ []', askUserAnswerKeys([]), []);
  eq('★A undefined ⇒ []（安全）', askUserAnswerKeys(undefined), []);
  // ⛔ 反面板：问题**带 id** ⇒ 键**仍**必须是下标（服务端契约是 index，不是 id）
  const withIds: AskUserQuestionLike[] = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }];
  eq('★A 带 id 的问题 ⇒ 键仍是下标（反面板）', askUserAnswerKeys(withIds), ['0', '1', '2']);
  ok('★A 键里绝不出现 id', askUserAnswerKeys(withIds).join(',').indexOf('alpha') < 0);
}

// ── B. 多选连接符恒为 `、` ──────────────────────────────────────────────────
{
  eq('★B 连接符常量 = 、（web MULTI_JOIN）', ASKUSER_MULTI_JOIN, '、');
  eq('★B 两项 ⇒ A、B', joinMultiAnswer(['A', 'B']), 'A、B');
  eq('★B 三项 ⇒ A、B、C', joinMultiAnswer(['A', 'B', 'C']), 'A、B、C');
  eq('★B 单项 ⇒ 原样', joinMultiAnswer(['A']), 'A');
  eq('★B 空/未选 ⇒ 空串', joinMultiAnswer([]), '');
  eq('★B undefined ⇒ 空串（安全）', joinMultiAnswer(undefined), '');
  eq('★B 空白项被丢弃', joinMultiAnswer(['A', '  ', 'B']), 'A、B');
  // ⛔ 反面板：**绝不**产出 `, `（旧实现的连接符）
  ok('★B 不得产出 ", "', joinMultiAnswer(['A', 'B']).indexOf(', ') < 0);
  ok('★B 不得产出半角逗号', joinMultiAnswer(['A', 'B']).indexOf(',') < 0);
}

// ── C. 单题最终答案优先级（web :67-88）────────────────────────────────────────
{
  const OTHER: string = '其他';
  // ① 自由文本最优先
  eq('★C 自由文本 > 一切', mergeAskUserAnswer('手写', '其他输入', ['A', 'B'], OTHER), '手写');
  // ② Other 输入 > 已选项
  eq('★C Other 输入 > 已选项', mergeAskUserAnswer('', '其他输入', ['A', 'B'], OTHER), '其他输入');
  // ③ 已选项（**减 Other 标签**）用 、 连接
  eq('★C 已选项用 、 连接', mergeAskUserAnswer('', '', ['A', 'B'], OTHER), 'A、B');
  // ④ Other 标签**不是答案**（被剔除）
  eq('★C 只选了 Other 标签（无输入）⇒ 空（未作答）',
    mergeAskUserAnswer('', '', [OTHER], OTHER), '');
  eq('★C Other 标签从多选里被剔除', mergeAskUserAnswer('', '', ['A', OTHER, 'B'], OTHER), 'A、B');
  // ⑤ 全空 ⇒ 空串
  eq('★C 全空 ⇒ 空串', mergeAskUserAnswer('', '', [], OTHER), '');
  eq('★C 全空(undefined picks) ⇒ 空串', mergeAskUserAnswer('', '', undefined, OTHER), '');
  // 空白 trim
  eq('★C 自由文本 trim 后为空 ⇒ 落到下一档', mergeAskUserAnswer('   ', '', ['A'], OTHER), 'A');

  // ★C 与 askUserAnswered 串起来（web :90）：只有非空才算作答
  ok('★C 空串 ⇒ 未作答', askUserAnswered('') === false);
  ok('★C 纯空白 ⇒ 未作答', askUserAnswered('   ') === false);
  ok('★C 非空 ⇒ 已作答', askUserAnswered('A、B') === true);
}

if (fail > 0) { console.log(`  askuser: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  askuser: ${pass} passed, 0 failed`);
process.exit(0);

export {};
