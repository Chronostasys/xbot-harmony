/**
 * 后台休眠 / SSE 重连后的**权威 resync**接线判据（2026-10-18 P0）。
 *
 * 用户亲报：手机后台休眠期间来了通知，服务端处理完并 idle；用户恢复前台但
 * **不重新打开 App**，看不到新通知/消息。仅 probe/forceReconnect 不够：
 *   · SSE 可能仍显示 open（半开/进程冻结）；
 *   · 即使重连，ring 可能已淘汰事件，session-tree 也不带正文；
 * ⇒ 必须主动 `loadSessions` + `loadHistory`。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
export {};
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function raw(rel: string): string {
  const p = path.join(process.cwd(), rel);
  try { return cp.execFileSync('cat', [p], { encoding: 'utf8' }); } catch (e) { return ''; }
}
const store = raw('entry/src/main/ets/core/store.ets');
const index = raw('entry/src/main/ets/pages/Index.ets');
const ability = raw('entry/src/main/ets/entryability/EntryAbility.ets');

ok('store 暴露 resyncAfterResume', /resyncAfterResume\s*\(/.test(store));
ok('resync 先 loadSessions 再 loadHistory', /resyncAfterResume[\s\S]{0,2200}loadSessions\(\)[\s\S]{0,500}loadHistory\(\)/.test(store));
ok('resume resync 在飞守卫（三路触发只跑一份）', /resumeResyncInFlight/.test(store));
ok('resume resync 期间挂起行重建并在结束后释放', /resumeResyncInFlight[\s\S]{0,1600}suspendUiUpdates\(true\)[\s\S]{0,2200}suspendUiUpdates\(false\)/.test(store));
ok('loadHistory 同一 chatGen 在飞合并（不重复请求/解析）', /historyLoading\s*&&\s*this\.historyLoadGen === gen/.test(store));
ok('SSE reconnect 不再先 loadSessions 再 resync 重复会话树', /if \(reconnected && this\.resumeActive\)[\s\S]{0,500}resyncAfterResume\(['"]sse-reopen['"]\)[\s\S]{0,500}else[\s\S]{0,300}loadSessions\(\)/.test(store));
ok('SSE 重连（open 且断线过）触发 resync', /state === 'open'[\s\S]{0,900}resyncAfterResume\(['"]sse-reopen['"]\)/.test(store));
ok('断线标记只在曾 open 后置位', /sseOpenedOnce[\s\S]{0,200}sseHadDisconnect\s*=\s*true/.test(store));
ok('onPageShow 调用 resyncAfterResume(page-show)', /resyncAfterResume\(['"]page-show['"]\)/.test(index));
ok('页面订阅 appResumedAt 并 @Watch', /@StorageProp\('appResumedAt'\)\s*@Watch\('onAppResumed'\)/.test(index));
ok('onAppResumed 走同一 resync', /onAppResumed\(\)[\s\S]{0,800}resyncAfterResume\(['"]ability-foreground['"]\)/.test(index));
ok('EntryAbility.onForeground 写 appResumedAt', /onForeground\(\)[\s\S]{0,400}AppStorage\.setOrCreate<number>\('appResumedAt'/.test(ability));

console.log(`resume_resync_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
