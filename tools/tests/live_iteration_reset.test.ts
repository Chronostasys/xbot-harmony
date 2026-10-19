/**
 * 新迭代必须重置 live 投递降频闸门（2026-10-20 用户亲报：极短迭代也会打字机低频）。
 *
 * `syncLiveTail` 有两条主动降频：100ms（lastNonFollowLiveMs）和浮层覆盖 400ms
 * （liveDeliverAtMs / shouldDeliverLive）。它们若跨迭代继承，新迭代首帧就被错误限频。
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
const start = index.indexOf('private syncLiveTail(): void {');
const end = index.indexOf('  /** 高频内容投递的**尾随补偿**', start);
const body = start >= 0 && end > start ? index.substring(start, end) : '';

ok('存在 liveIterationKeyNow（按 rowId#iteration 识别迭代）', /liveIterationKeyNow\(\)/.test(index));
ok('syncLiveTail 检测新迭代', /iterKey !== this\.liveIterationKey/.test(body));
ok('新迭代重置已投递代际', /this\.liveContentRev = -1/.test(body));
ok('新迭代重置 400ms covered 闸门', /this\.liveDeliverAtMs = 0/.test(body));
ok('新迭代重置 100ms throttle 闸门', /this\.lastNonFollowLiveMs = 0/.test(body));
ok('新迭代清掉尾随补偿 timer', /clearTimeout\(this\.liveDeliverTimer\)/.test(body));
console.log(`live_iteration_reset: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
