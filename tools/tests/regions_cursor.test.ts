/**
 * 区域窗口取段游标（`core/msgops.ets:gapTopBefore`）的判别力测试。
 *
 * 逐字对齐 web `AssistantMessage.tsx:104-117`：`beforeIteration = gapTop ?? windowFirstIteration`。
 * 旧原生实现恒取 minIter ⇒ 有洞时请求到已持有的段、**洞永远填不上**（复现：
 * `iterations=[1..40]∪[52..90]` ⇒ web 请求 before=52、原生请求 before=1 ⇒ 原生拿到空段）。
 */
declare const process: { exit: (c: number) => void };

import { gapTopBefore } from '../../entry/src/main/ets/core/msgops';
import { HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function iters(nums: number[]): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < nums.length; i++) {
    out.push({ iteration: nums[i] } as unknown as HistoryIteration);
  }
  return out;
}
function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let n = a; n <= b; n++) { out.push(n); }
  return out;
}

// ① ★ 有洞 ⇒ 取洞的上边界（复现场景：[1..40] ∪ [52..90] ⇒ 52）
eq('有洞 ⇒ 洞上边界 52', gapTopBefore(iters(range(1, 40).concat(range(52, 90)))), 52);

// ② 无洞 ⇒ 最小迭代号（取更早一段）
eq('无洞 ⇒ 最小号 1', gapTopBefore(iters(range(1, 5))), 1);

// ③ 乱序输入 ⇒ 先排序
eq('乱序 ⇒ 排序后判洞', gapTopBefore(iters([90, 3, 52, 2, 1])), 52);

// ④ 去重
eq('重复迭代号去重', gapTopBefore(iters([1, 1, 2, 2, 3])), 1);

// ⑤ 空 ⇒ 0
eq('空 ⇒ 0', gapTopBefore(iters([])), 0);

// ⑥ 单元素 ⇒ 它自己
eq('单元素 ⇒ 自身', gapTopBefore(iters([7])), 7);

if (fail > 0) { console.log(`  regions_cursor: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  regions_cursor: ${pass} passed, 0 failed`);
process.exit(0);

export {};
