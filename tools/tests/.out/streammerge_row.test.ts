/** live 行"尾块互斥"判据测试（真机：每个迭代完成就消失的根因回归守卫）。 */
declare const process: { exit: (c: number) => void };

import { tailOwnedIteration } from './streammerge';
import { ChatRow, HistoryIteration } from './types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function row(live: boolean, iters: number[]): ChatRow {
  const r = new ChatRow();
  r.role = 'assistant';
  r.isLive = live;
  r.iterations = iters.map((n) => ({ iteration: n, content: 'x' } as HistoryIteration));
  return r;
}
const it = (n: number): HistoryIteration => ({ iteration: n, content: 'x' } as HistoryIteration);

eq('live 行的最后一个迭代由尾块承担', tailOwnedIteration(row(true, [1, 2, 3]), it(3)), true);
eq('live 行的**已完成**迭代仍由列表渲染（关键：否则"完成一个消失一个"）',
  tailOwnedIteration(row(true, [1, 2, 3]), it(1)), false);
eq('live 行的中间迭代也由列表渲染', tailOwnedIteration(row(true, [1, 2, 3]), it(2)), false);
eq('已提交行的任何迭代都不归尾块', tailOwnedIteration(row(false, [1, 2, 3]), it(3)), false);
eq('空迭代集的 live 行不归尾块', tailOwnedIteration(row(true, []), it(1)), false);
eq('单迭代 live 行：该迭代归尾块', tailOwnedIteration(row(true, [1]), it(1)), true);

if (fail > 0) { console.log(`  streammerge_row: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  streammerge_row: ${pass} passed, 0 failed`);
process.exit(0);
