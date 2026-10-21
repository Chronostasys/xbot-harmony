/**
 * 2026-10-20 状态审计：
 * ① 发送成功仍显示「发送中」——`applyRow` 在派生 Row **同引用就地改 sending/queued** 时必须刷新；
 * ② cancel 重复点击不能静默 resolve（复用同一个在飞 Promise）；
 * ③ 会话隔离：附件/goal 草稿/旧会话 draft timer 必须随切换作废。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
import { ChatRow } from '../../entry/src/main/ets/core/types';
import { applyRow } from '../../entry/src/main/ets/core/render';
import type { UserRowView } from '../../entry/src/main/ets/core/derive';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const index = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');

// ① 可变 Row：同一个派生对象上的 sending 从 true → false，必须触发 ChatRow 更新。
const row = new ChatRow();
const liveUser = {
  kind: 'user', id: 'u-1', content: '你好', timestamp: 't', isNotification: false,
  queued: false, sending: true, dbID: undefined, turnID: 0,
} as UserRowView;
applyRow(row, liveUser);
ok('发送中初始落行', row.sending === true);
(liveUser as unknown as { sending: boolean }).sending = false;
const changed = applyRow(row, liveUser);
ok('派生 Row 同引用改 sending ⇒ applyRow 返回 changed', changed === true);
ok('发送成功后 ChatRow.sending 必须变 false', row.sending === false);

// ② cancel 在飞复用同一个 Promise，不能 silent return。
ok('cancel 使用 cancelInFlight 复用 Promise',
  // ⛔ 锚点放宽（2026-10-21）：cancel 的早退现在带**会话/代数身份**守卫，返回的是局部变量
  //   `inFlight`（否则跨会话会把 B 的取消静默吞掉）⇒ 只钉"复用在飞 Promise"这个事实。
  /cancelInFlight[\s\S]{0,240}return (this\.cancelInFlight|inFlight)/.test(store));
ok('cancel 在 finally 清理 cancelInFlight', /cancelInFlight = null/.test(store));

// ③ 会话隔离：切会话清理页面级会话态。
const switchStart = index.indexOf('private async switchSession(');
const switchBody = switchStart >= 0 ? index.substring(switchStart, switchStart + 9000) : '';
ok('切会话清 attachments', /this\.attachments = \[\]/.test(switchBody));
ok('切会话清 goalDraft', /this\.goalDraft = ''/.test(switchBody));
ok('切会话取消旧 draft 防抖 timer', /this\.draftTimer = -1/.test(switchBody));
ok('busySignals 不再用页面 session-tree running 作为第二真源',
  /freshServerRunning: false/.test(index) && !/freshServerRunning: sameChat/.test(index));

console.log(`session_state_audit: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
