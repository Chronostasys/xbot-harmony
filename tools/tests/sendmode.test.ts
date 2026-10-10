/** 发送模式纯逻辑测试（插话/排队互斥；busy=false 必须自动回落 —— 否则会误插别人的回合）。 */
declare const process: { exit: (c: number) => void };

import {
  effectiveMode, isInterruptSend, MODE_INTERRUPT, MODE_QUEUE, modeHint, modeLabel, sendToast, toggleMode,
} from '../../entry/src/main/ets/core/sendmode';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('排队 → 插话', toggleMode(MODE_QUEUE), MODE_INTERRUPT);
eq('插话 → 排队', toggleMode(MODE_INTERRUPT), MODE_QUEUE);

eq('排队名', modeLabel(MODE_QUEUE), '排队');
eq('插话名', modeLabel(MODE_INTERRUPT), '⚡ 插话');
eq('提示非空', modeHint(MODE_INTERRUPT).length > 0, true);

eq('忙碌时生效插话', effectiveMode(true, MODE_INTERRUPT), MODE_INTERRUPT);
eq('空闲时回落排队（插话无意义）', effectiveMode(false, MODE_INTERRUPT), MODE_QUEUE);
eq('忙碌排队仍是排队', effectiveMode(true, MODE_QUEUE), MODE_QUEUE);

eq('忙碌+插话 = 插话发送', isInterruptSend(true, MODE_INTERRUPT), true);
eq('空闲+插话 = 普通发送', isInterruptSend(false, MODE_INTERRUPT), false);

eq('插话回执', sendToast(true, true), '已插话到当前回合');
eq('排队回执', sendToast(false, true), '已排队（当前回合结束后发送）');
eq('普通发送无回执', sendToast(false, false), '');

if (fail > 0) { console.log(`  sendmode: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sendmode: ${pass} passed, 0 failed`);
process.exit(0);
