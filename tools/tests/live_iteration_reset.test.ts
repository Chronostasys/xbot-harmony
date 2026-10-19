/**
 * live 投递降频状态的**生命周期**判据（2026-10-20 用户要求）。
 *
 * 不允许把 contentRev / lastDeliverAt / lastNonFollowAt / timer 放在页面全局字段里，
 * 再在"新迭代"时 reset；这些状态必须属于 per-iteration lane 对象：
 *   lane key 变化 ⇒ 旧对象 + timer 销毁，新对象构造。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const src = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const start = src.indexOf('private syncLiveTail(): void {');
const end = src.indexOf('  /**\n   * live turn 是否已有', start);
const body = start >= 0 && end > start ? src.substring(start, end) : '';

ok('存在 per-iteration LiveDeliveryLane', /class LiveDeliveryLane/.test(src));
ok('页面只有一个 liveLane 所有权字段', /private liveLane: LiveDeliveryLane \| null = null/.test(src));
ok('lane key 变化时销毁旧 lane（不是 reset 全局字段）',
  /lane\.key !== laneKey[\s\S]{0,200}disposeLiveLane\(\)[\s\S]{0,120}new LiveDeliveryLane\(laneKey\)/.test(body));
ok('无 live 行时销毁 lane', /if \(!this\.hasLiveRow\)[\s\S]{0,250}disposeLiveLane\(\)/.test(body));
ok('降频时间戳属于 lane', /lane\.lastNonFollowAtMs/.test(body) && /lane\.lastDeliverAtMs/.test(body));
ok('代际属于 lane', /lane\.contentRev/.test(body));
ok('timer 属于 lane 且校验 lane 身份', /lane\.timer = setTimeout/.test(body)
  && /this\.liveLane !== lane/.test(body));
ok('全局降频字段已删除', !/private (liveContentRev|liveDeliverAtMs|lastNonFollowLiveMs|liveDeliverTimer)\b/.test(src));
ok('不存在全局 liveContentRev = -1 的 reset 形态', !/this\.liveContentRev = -1/.test(src));
console.log(`live_iteration_reset: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
