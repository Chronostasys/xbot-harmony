/** 打字机纯逻辑测试（算法与 web/TUI 必须一致：gap/3、CJK 半速、码点安全）。 */
declare const process: { exit: (c: number) => void };

import {
  advanceVisible, catchUpTicks, clipRunes, isCJK, isTyping, runeCount, toRunes, TICK_MS,
  CJK_SLOW_ADVANCE_MAX, CJK_SLOW_GAP_MAX,
} from '../../entry/src/main/ets/core/typewriter';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('tick 间隔 50ms（与 web 一致）', TICK_MS, 50);

eq('CJK 汉字', isCJK('汉'.codePointAt(0) as number), true);
eq('CJK 全角标点', isCJK('，'.codePointAt(0) as number), true);
eq('ASCII 不是 CJK', isCJK('a'.codePointAt(0) as number), false);
eq('换行不是 CJK', isCJK(10), false);

eq('码点切分：ASCII', toRunes('abc'), ['a', 'b', 'c']);
eq('码点切分：emoji 算一个', toRunes('a👍b').length, 3);
eq('码点计数 = 1（emoji）', runeCount('👍'), 1);
eq('JS length 是 2（对照组）', '👍'.length, 2);
eq('中文计数', runeCount('思考中'), 3);

eq('裁剪 0', clipRunes('abc', 0), '');
eq('裁剪 2', clipRunes('abc', 2), 'ab');
eq('裁剪超长返回原串', clipRunes('abc', 9), 'abc');
eq('裁剪不切坏 emoji', clipRunes('a👍b', 2), 'a👍');

eq('已追平不再前进', advanceVisible(5, 5, false), 5);
eq('gap=1 前进 1', advanceVisible(0, 1, false), 1);
eq('gap=3 前进 1', advanceVisible(0, 3, false), 1);
eq('gap=9 前进 3（gap/3）', advanceVisible(0, 9, false), 3);
eq('gap=10 前进 3（取整）', advanceVisible(0, 10, false), 3);
eq('gap=2 至少前进 1', advanceVisible(0, 2, false), 1);
eq('不会超过目标', advanceVisible(8, 9, false), 9);
// ── CJK 半速门限（对齐 web `useTypewriter.ts:98-113`）：**仅近追平**才隔拍跳过，跳过 = 0 ──
eq('门限常量 = web（advance<=3 && gap<=20）', [CJK_SLOW_ADVANCE_MAX, CJK_SLOW_GAP_MAX], [3, 20]);
// ⛔ 本波修的缺陷：旧实现在**任意 gap** 都半速、且跳过时前进 gap/6 ⇒ (0,300,true) 得 25。
eq('大 gap 全速（不再无脑半速）', advanceVisible(0, 300, true), 100);
eq('大 gap 全速 ≠ 旧实现的 25', advanceVisible(0, 300, true) !== 25, true);
eq('gap=30 > 20 ⇒ 不跳，全速 gap/3', advanceVisible(0, 30, true), 10);
eq('gap=21 > 20 ⇒ 不跳', advanceVisible(0, 21, true), 7);
eq('gap=20 但 advance=6 > 3 ⇒ 不跳', advanceVisible(0, 20, true), 6);
eq('近追平才跳：gap=9 ⇒ 本拍前进 0', advanceVisible(0, 9, true), 0);
eq('近追平才跳：gap=6 ⇒ 本拍前进 0', advanceVisible(0, 6, true), 0);
eq('跳过的拍原样返回（含小 gap）', advanceVisible(8, 9, true), 8);
eq('非跳过拍正常前进（gap=9）', advanceVisible(0, 9, false), 3);
eq('已追平时跳过拍返回 target', advanceVisible(9, 9, true), 9);

eq('是否还在打字', isTyping(1, 2), true);
eq('已追平', isTyping(2, 2), false);

eq('gap=1 一拍追平', catchUpTicks(1), 1);
eq('gap=8 六拍追平（step=max(1,floor(gap/3)) 逐拍验算）', catchUpTicks(8), 6);
eq('gap=100 在对数级（<=20 拍）', catchUpTicks(100) <= 20, true);
eq('gap=1000 仍在对数级（<=30 拍）', catchUpTicks(1000) <= 30, true);
eq('gap=0 无需追赶', catchUpTicks(0), 0);

if (fail > 0) { console.log(`  typewriter: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  typewriter: ${pass} passed, 0 failed`);
process.exit(0);

export {};
