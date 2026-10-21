/**
 * 复现真机 dump（rec3，iter76..82 各 1 枚 Shell、call_id 各不同、tools_folded=true）：
 * 经 `mergeToolRuns` 后**必须**仍然看得到每一枚工具（用户：「这个 toolcall 后的连续几个 tool 都消失了」）。
 *
 * dump 已证：wire 上 iter76..82 每轮各 1 枚、call_id 唯一、delta==live ⇒ 丢失只可能在
 * 客户端合并/记忆化这一层 ⇒ 本判据直接钉它。
 */
declare const process: { exit: (c: number) => void };

import { mergeToolRuns, mergeToolRunsUncached } from '../../entry/src/main/ets/core/streammerge';
import type { HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++ } else { fail++; console.log(`  ✗ ${name}\n      got ${g} want ${w}`) }
}

const ids: string[] = [
  'call_A76', 'call_A78', 'call_A79', 'call_A80', 'call_A81', 'call_A82',
];
function it(n: number, callId: string): HistoryIteration {
  const t: ToolProgress = { name: 'Shell', label: `Shell: timeout 60 ssh 1101box 'F=/...`, status: 'done', call_id: callId };
  return { iteration: n, content: '', reasoning: '', tools: [t], tools_folded: true } as unknown as HistoryIteration;
}
const iters: HistoryIteration[] = [it(76, ids[0]), it(78, ids[1]), it(79, ids[2]), it(80, ids[3]), it(81, ids[4]), it(82, ids[5])];

const merged = mergeToolRunsUncached(iters);
eq('合并后块数 = 1（相邻纯工具迭代被吸收）', merged.length, 1);
const mergedIds: string[] = (merged[0].tools ?? []).map((t) => t.call_id ?? '');
eq('合并块必须包含全部 6 枚（call_id 各不相同，绝不塌缩）', mergedIds.length, 6);
for (const id of ids) {
  eq(`合并块含 ${id}`, mergedIds.indexOf(id) >= 0, true);
}
// 缓存入口必须与未缓存内核一致（memo 陈旧 = 界面少 pill 的直接来源）
const cached = mergeToolRuns(iters);
eq('缓存入口与内核一致（块数）', cached.length, merged.length);
eq('缓存入口与内核一致（工具数）', (cached[0].tools ?? []).length, mergedIds.length);

console.log(`  toolrun_merge_live: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
