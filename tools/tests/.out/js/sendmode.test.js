"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sendmode_1 = require("./sendmode");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('排队 → 插话', (0, sendmode_1.toggleMode)(sendmode_1.MODE_QUEUE), sendmode_1.MODE_INTERRUPT);
eq('插话 → 排队', (0, sendmode_1.toggleMode)(sendmode_1.MODE_INTERRUPT), sendmode_1.MODE_QUEUE);
eq('排队名', (0, sendmode_1.modeLabel)(sendmode_1.MODE_QUEUE), '排队');
eq('插话名', (0, sendmode_1.modeLabel)(sendmode_1.MODE_INTERRUPT), '⚡ 插话');
eq('提示非空', (0, sendmode_1.modeHint)(sendmode_1.MODE_INTERRUPT).length > 0, true);
eq('忙碌时生效插话', (0, sendmode_1.effectiveMode)(true, sendmode_1.MODE_INTERRUPT), sendmode_1.MODE_INTERRUPT);
eq('空闲时回落排队（插话无意义）', (0, sendmode_1.effectiveMode)(false, sendmode_1.MODE_INTERRUPT), sendmode_1.MODE_QUEUE);
eq('忙碌排队仍是排队', (0, sendmode_1.effectiveMode)(true, sendmode_1.MODE_QUEUE), sendmode_1.MODE_QUEUE);
eq('忙碌+插话 = 插话发送', (0, sendmode_1.isInterruptSend)(true, sendmode_1.MODE_INTERRUPT), true);
eq('空闲+插话 = 普通发送', (0, sendmode_1.isInterruptSend)(false, sendmode_1.MODE_INTERRUPT), false);
eq('插话回执', (0, sendmode_1.sendToast)(true, true), '已插话到当前回合');
eq('排队回执', (0, sendmode_1.sendToast)(false, true), '已排队（当前回合结束后发送）');
eq('普通发送无回执', (0, sendmode_1.sendToast)(false, false), '');
if (fail > 0) {
    console.log(`  sendmode: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  sendmode: ${pass} passed, 0 failed`);
process.exit(0);
