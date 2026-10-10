/**
 * seq 重放判据测试 —— 逐条对应 web `p0-resume-run-seq-restart.test.ts` 的 5 例
 * （真机 P0：Run 重启后 seq 从 1 计数，旧水位把新 Run 事件整批吞掉 ⇒ SSE 完全不渲染）。
 */
declare const process: { exit: (c: number) => void };

import { isStaleSeqEvent } from './streammerge';
import { ProgressEvent } from './types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ev(fields: Record<string, Object>): ProgressEvent {
  return fields as ProgressEvent;
}

// 场景：旧 Run 水位 12，live 行已持有迭代 1-3（maxKnownIter=3）
// ① 新 Run 的 iteration 事件（seq 1 ≤ 水位，但迭代 4 > 3）⇒ 必须应用（非重放）
eq('新 Run 的 iteration 必须应用', isStaleSeqEvent(12, 1, 3, ev({ iteration: 4 })), false);
// ② phase_done / 收尾快照携带更大迭代的 iteration_history ⇒ 必须应用
eq('携带更大迭代的 history 必须应用',
  isStaleSeqEvent(12, 2, 3, ev({ iteration_history: [{ iteration: 5 }] as Object[] })), false);
eq('history 含更大迭代（混在旧号里）',
  isStaleSeqEvent(12, 2, 3, ev({ iteration_history: [{ iteration: 2 }, { iteration: 6 }] as Object[] })), false);
// ③ 真重放：seq ≤ 水位、同迭代号、无新信息 ⇒ 丢弃
eq('同迭代号重放丢弃', isStaleSeqEvent(12, 3, 3, ev({ iteration: 3 })), true);
eq('更小迭代号重放丢弃', isStaleSeqEvent(12, 2, 3, ev({ iteration: 1 })), true);
eq('history 全为旧迭代号丢弃',
  isStaleSeqEvent(12, 2, 3, ev({ iteration_history: [{ iteration: 1 }, { iteration: 3 }] as Object[] })), true);
eq('无迭代字段且 seq≤水位丢弃', isStaleSeqEvent(12, 5, 3, ev({ phase: 'running' })), true);
// ④ 同 Run seq 单调：seq > 水位 ⇒ 永远应用
eq('seq 超过水位应用', isStaleSeqEvent(12, 13, 3, ev({ iteration: 3 })), false);
eq('无水位（0）应用', isStaleSeqEvent(0, 1, 0, ev({ iteration: 1 })), false);
eq('seq=0（流式帧）不经此闸', isStaleSeqEvent(12, 0, 3, ev({})), false);
// ⑤ 边界：无 live 行（maxKnownIter=0）⇒ 任何迭代号都是新信息
eq('无 live 行时任何迭代都是新信息', isStaleSeqEvent(12, 1, 0, ev({ iteration: 1 })), false);

if (fail > 0) { console.log(`  seqgate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  seqgate: ${pass} passed, 0 failed`);
process.exit(0);
