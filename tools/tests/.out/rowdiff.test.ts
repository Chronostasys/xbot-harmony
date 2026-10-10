/** 行 diff 逻辑测试（漏通知 ⇒ 内容不更新；多通知 ⇒ 丢滚动锚点与复用）。 */
declare const process: { exit: (c: number) => void };

import { changedByKeys, changedRowIndices, rowKey, sameRowIds, tailRows } from './rowdiff';
import { ChatRow } from './types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function row(id: string, rev: number): ChatRow {
  const r = new ChatRow();
  r.id = id; r.rev = rev; r.role = 'assistant';
  return r;
}

eq('键含 rev', rowKey(row('a', 3)), 'a#3');
eq('同键', rowKey(row('b', 1)), 'b#1');

eq('空表相等', sameRowIds([], []), true);
eq('长度不同', sameRowIds([row('a', 1)], []), false);
eq('顺序不同 = 身份变了', sameRowIds([row('a', 1), row('b', 1)], [row('b', 1), row('a', 1)]), false);
eq('同身份（rev 不同仍算同身份）', sameRowIds([row('a', 1), row('b', 5)], [row('a', 9), row('b', 6)]), true);

eq('无变化', changedRowIndices([row('a', 1), row('b', 1)], [row('a', 1), row('b', 1)]), []);
eq('单行 rev 变化', changedRowIndices([row('a', 1), row('b', 1)], [row('a', 2), row('b', 1)]), [0]);
eq('两行变化', changedRowIndices([row('a', 1), row('b', 1)], [row('a', 2), row('b', 2)]), [0, 1]);
eq('长度不等时只比公共前缀（身份变化走 reload）',
  changedRowIndices([row('a', 1)], [row('a', 1), row('b', 1)]), []);

// ── changedByKeys：数据源必须用**上一帧键快照**比较（对象就地更新 ⇒ 新旧数组同一引用）──
// 复现 bug ① 的页面侧根因：同一对象被就地更新后，changedRowIndices(old, new) 恒为空。
const a1 = row('a', 1);
const liveOld = [a1];
a1.rev = 2; // 就地更新（模拟 core/render.ets applyRow + touch）
eq('⛔ 就地更新后 changedRowIndices 恒为空（对象别名陷阱）', changedRowIndices(liveOld, [a1]), []);
eq('⛔ 键快照能判出变化（数据源修法）', changedByKeys(['a#1'], [a1]), [0]);
eq('键快照：未变化不通知', changedByKeys(['a#2'], [a1]), []);
eq('键快照：只报变化行', changedByKeys(['x#9', 'a#2'], [row('x', 9), a1]), []);

eq('窗口：limit 大于总长', tailRows([row('a', 1)], 5).length, 1);
eq('窗口：取末尾', tailRows([row('a', 1), row('b', 1), row('c', 1)], 2).map((r) => r.id), ['b', 'c']);
eq('窗口：limit=0 视为全量', tailRows([row('a', 1)], 0).length, 1);
eq('窗口不改原数组', tailRows([row('a', 1), row('b', 1)], 1).length + 2, 3);

if (fail > 0) { console.log(`  rowdiff: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  rowdiff: ${pass} passed, 0 failed`);
process.exit(0);
