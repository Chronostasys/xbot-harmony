/**
 * 回归判据：**详情请求的迭代号 = 工具自带号**（web `FoldedToolGroup.tsx:564` 逐字）。
 *
 * 事故（用户 2026-10-21）：`mergeToolRuns` 把相邻的纯工具迭代并成一块，块的号只是 head；
 * 旧实现用**块号**既当查找键又当请求键 ⇒ ①查找找不到（一次请求都不发）②请求打到别的迭代
 * ⇒ 用户看到「只有第一个工具能看详情、折叠组里全『暂无详情』」。
 *
 * mutation 自证：把 `detailIterationOf` 改成恒返回 `blockIter` ⇒ 断言必红。
 */
declare const process: { exit: (c: number) => void };

import { detailIterationOf } from '../../entry/src/main/ets/core/toolmerge';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++ } else { fail++; console.log(`  ✗ ${name}\n      got ${g} want ${w}`) }
}

eq('★工具自带号优先（web 语义）', detailIterationOf(138, 140), 138);
eq('★缺失工具号 ⇒ 回落块号', detailIterationOf(undefined, 140), 140);
eq('★0/负号视为缺失 ⇒ 回落块号', detailIterationOf(0, 140), 140);
eq('★head 工具（号==块号）不变', detailIterationOf(140, 140), 140);

console.log(`  tool_detail_iter: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
