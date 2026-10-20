/**
 * busy 且无 live 信号 ⇒ 必须请求权威 resync（"思考中" 占位卡死 / 新迭代无投影的恢复路径）。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const index = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
const start = index.indexOf('private checkLiveSignalStall(): void {');
const end = index.indexOf('  /**\n   * 运行面板', start);
const body = start >= 0 && end > start ? index.substring(start, end) : '';

ok('pulse 每拍检查 live 信号不变量', /checkLiveSignalStall\(\)/.test(index));
ok('回前台重启 pulse（冻结的 timer 不能复用）', /restartPulse\(\)/.test(index)
  && (index.match(/this\.restartPulse\(\)/g) || []).length >= 2);
ok('连续 3 拍无信号才请求（不是任意一拍）', /liveWaitTicks >= 3/.test(body));
ok('请求 live-stall 权威 resync', /resyncAfterResume\('live-stall'\)/.test(body));
ok('有 live 信号时退出等待态', /this\.liveWaitTicks = 0/.test(body));
ok('in-flight resync 请求排队而不是丢弃', /resumeResyncPending = true/.test(store));
ok('release 后跑排队的 resync', /resumeResyncPending[\s\S]{0,300}resyncAfterResume/.test(store));
console.log(`live_stall_resync: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
