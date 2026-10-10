/** 会话星标测试 —— 排序语义对齐 web `sortSessions`（星标唯一第一关键字）。 */
declare const process: { exit: (c: number) => void };

import { parseStarred, serializeStarred, isStarred, toggleStarred, starredFirst } from '../../entry/src/main/ets/core/stars';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// 解析：脏数据必须被吃掉（否则会把"空 id"当成一个会话）
eq('undefined ⇒ 空', parseStarred(undefined), []);
eq('空串 ⇒ 空', parseStarred(''), []);
eq('单值', parseStarred('a'), ['a']);
eq('多值', parseStarred('a,b,c'), ['a', 'b', 'c']);
eq('去空白', parseStarred(' a , b '), ['a', 'b']);
eq('去空项（连续逗号）', parseStarred('a,,b'), ['a', 'b']);
eq('去空白后为空的项目', parseStarred('a,  ,b'), ['a', 'b']);
eq('保序去重', parseStarred('b,a,b,a'), ['b', 'a']);

// 序列化往返
eq('序列化', serializeStarred(['a', 'b']), 'a,b');
eq('空数组序列化为空串', serializeStarred([]), '');
eq('往返一致', parseStarred(serializeStarred(['x', 'y'])), ['x', 'y']);

// 查询 / 切换
eq('isStarred 命中', isStarred(['a', 'b'], 'b'), true);
eq('isStarred 未命中', isStarred(['a', 'b'], 'z'), false);
eq('toggle 添加', toggleStarred(['a'], 'b'), ['a', 'b']);
eq('toggle 移除', toggleStarred(['a', 'b'], 'a'), ['b']);
eq('toggle 不改原数组', ((): boolean => {
  const src = ['a'];
  toggleStarred(src, 'b');
  return src.length === 1;
})(), true);
eq('toggle 两次回到原状（顺序可能变，故比集合）', ((): boolean => {
  const once = toggleStarred(['a', 'b'], 'a');
  const twice = toggleStarred(once, 'a');
  return twice.length === 2 && isStarred(twice, 'a') && isStarred(twice, 'b');
})(), true);

// 星标优先排序
eq('星标提前', starredFirst(['a', 'b', 'c'], ['c']), ['c', 'a', 'b']);
eq('多个星标保持相对顺序', starredFirst(['a', 'b', 'c', 'd'], ['d', 'b']), ['b', 'd', 'a', 'c']);
eq('无星标 ⇒ 原样', starredFirst(['a', 'b'], []), ['a', 'b']);
eq('全部星标 ⇒ 原样', starredFirst(['a', 'b'], ['a', 'b']), ['a', 'b']);
eq('星标了不存在的 id ⇒ 原样', starredFirst(['a', 'b'], ['zzz']), ['a', 'b']);
eq('不丢项也不多项', starredFirst(['a', 'b', 'c'], ['b']).length, 3);

console.log(`stars: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
