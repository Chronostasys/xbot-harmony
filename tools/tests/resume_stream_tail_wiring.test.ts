/**
 * 休眠恢复后 stream/打字机频率下降（用户 2026-10-20 亲报：跑久/休眠后变慢，重启 App 恢复）。
 *
 * 根因：`LiveTailView` 的 `paused` 是 @Prop，而 `LazyForEach` 的 item builder 只在新建时执行，
 * 已存在行不会收到 `appPaused=false` 的新值 ⇒ 该行永久 paused，打字机定时器不再推进。
 * 修法：与 `uiIsScrolling` 同款模块级标志，`tick/syncTimer` 直接读；页面 paused 不再包含 appPaused。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function raw(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}
const follow = raw('entry/src/main/ets/core/listfollow.ets');
const tail = raw('entry/src/main/ets/components/LiveTailView.ets');
const index = raw('entry/src/main/ets/pages/Index.ets');

ok('listfollow 提供模块级 setAppPaused/appIsPaused',
  /export function setAppPaused\(/.test(follow) && /export function appIsPaused\(/.test(follow));
ok('LiveTailView 引入 appIsPaused', /appIsPaused/.test(tail));
ok('LiveTailView syncTimer 受 appIsPaused 门控',
  /!this\.paused && !appIsPaused\(\)/.test(tail));
ok('LiveTailView tick 受 appIsPaused 门控', /this\.paused \|\| appIsPaused\(\)/.test(tail));
ok('onPageHide 置 setAppPaused(true)', /onPageHide\(\)[\s\S]{0,200}setAppPaused\(true\)/.test(index));
ok('onPageShow/onAppResumed 置 setAppPaused(false)',
  (index.match(/setAppPaused\(false\)/g) || []).length >= 2);
ok('页面传 LiveTailView 的 paused 不再包含 appPaused',
  !/paused:\s*this\.appPaused\s*\|\|/.test(index));
console.log(`resume_stream_tail_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
