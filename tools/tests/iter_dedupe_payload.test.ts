/**
 * 回归判据：**纯工具迭代（只有 toolcall）不得被同号空壳覆盖**（用户 2026-10-21：
 * 「{turnID:1041, iteration:195} 这后面的 iter 196 197 等都消失了」+「只有toolcall的迭代一定消失」）。
 *
 * 真因（静态分析，`normalize.dedupeIterationsByNumber`）：
 *   "有没有内容"只判 content/reasoning ⇒ 纯工具迭代恒 `prevHas === curHas === false` ⇒
 *   落到"轻/完整"分支；而先到的**空壳**（工具未完成）`tools_folded=false` 被当成"完整"、
 *   后到的**真条目**（旧后端一律 `tools_folded=true`）被当成"轻" ⇒ `keep prev` ⇒ **工具永久丢**。
 *   ⇒ 判据必须把 `tools` 计入 payload。
 *
 * mutation 自证：把 payload 判据里的 tools 去掉 ⇒ 本用例必红。
 */
declare const process: { exit: (c: number) => void };

import { dedupeIterationsByNumber } from '../../entry/src/main/ets/core/normalize';
import type { WebIteration, WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++ } else { fail++; console.log(`  ✗ ${name}\n      got ${g} want ${w}`) }
}

const shell: WebToolProgress = { name: 'Shell', label: 'Shell', status: 'done', iteration: 195, callID: 'call_195' } as unknown as WebToolProgress;
const shell2: WebToolProgress = { name: 'Shell', label: 'Shell', status: 'done', iteration: 196, callID: 'call_196' } as unknown as WebToolProgress;

// 先到的空壳（工具还没完成；无 tools ⇒ 后端不会置 tools_folded）
const shellIt: WebIteration = { iteration: 195, content: '', reasoning: '', tools: [], toolsFolded: false, toolCount: 0 } as unknown as WebIteration;
// 后到的真条目（带工具；旧后端对有工具的迭代一律 tools_folded=true）
const realIt: WebIteration = { iteration: 195, content: '', reasoning: '', tools: [shell], toolsFolded: true, toolCount: 1 } as unknown as WebIteration;

const out = dedupeIterationsByNumber([shellIt, realIt]);
eq('同号条目数 = 1', out.length, 1);
eq('★纯工具迭代的 tools 不得被空壳覆盖', out[0].tools.length, 1);

// 反向：真条目在前、空壳在后（真实时序也可能如此）⇒ 同样不得丢
const out2 = dedupeIterationsByNumber([realIt, shellIt]);
eq('★顺序反过来也不得丢', out2[0].tools.length, 1);

// 相邻两个纯工具迭代各自保留
const n196: WebIteration = { iteration: 196, content: '', reasoning: '', tools: [shell2], toolsFolded: true, toolCount: 1 } as unknown as WebIteration;
const out3 = dedupeIterationsByNumber([shellIt, realIt, n196]);
eq('★195/196 两条纯工具迭代都保留', out3.length, 2);
eq('★195 有工具', out3[0].tools.length, 1);
eq('★196 有工具', out3[1].tools.length, 1);

console.log(`  iter_dedupe_payload: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
