import { runningAfterReconcile } from '../../entry/src/main/ets/core/streammerge';
declare const process: { exit: (c: number) => void };
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } }
ok('新鲜 idle 压过迟到 HTTP running', runningAfterReconcile(true, 0, 100, 200, 15000) === false);
ok('新鲜 busy（晚于 idle）仍可覆盖 HTTP idle', runningAfterReconcile(false, 200, 100, 300, 15000) === true);
ok('过期 idle 不压 HTTP running', runningAfterReconcile(true, 0, 0, 20000, 15000) === true);
console.log(`busy_reconcile: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
