/**
 * 2026-10-20 状态审计：
 * ① 发送成功仍显示「发送中」——**user 行的 sending 必须跟随模型状态结算**
 *    （旧链路：`applyRow` 在派生 Row 同引用就地改 sending/queued 时必须刷新；
 *      新链路：行源 = `model_bridge.applyModel`，`local.pending` 按 **requestID** 精确退役）；
 * ② cancel 重复点击不能静默 resolve（复用同一个在飞 Promise）；
 * ③ 会话隔离：附件/goal 草稿/旧会话 draft timer 必须随切换作废。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const index = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');

// ── ① 行源 = 模型投影：sending 必须随状态结算，且**同一行对象**要被就地刷新 ──────
// ⛔ 旧判据钉的是 `applyRow(row, sameView) === true`（布尔早退协议）；该协议随旧链路删除。
//   新链路里"同一行是否被刷新"的可观测等价物 = **ChatRow 对象恒等 + 字段已更新**
//   （`applyModel` 复用 `rowCache` 里的行对象，只写字段 ⇒ @ObjectLink 订阅者拿到新值）。
const feed = new ModelFeed('chat_audit');
feed.push({
  type: 'user_sent',
  row: {
    id: 'u-1', content: '你好', timestamp: 't', isNotification: false,
    queued: false, sending: true, requestID: 'req-1',
  },
});
const pendingRows: ChatRow[] = feed.rows();
ok('发送中初始落行', pendingRows.length === 1 && pendingRows[0].sending === true);

// 送达权威信号：turn_started 携带同一 requestID ⇒ pending 退役、user 行 sending=false。
feed.push({ type: 'turn_started', turnID: 1, requestID: 'req-1', trigger: 'user', content: '你好' });
const settled: ChatRow[] = feed.rows();
const userRows = settled.filter((r) => r.role === 'user');
ok('发送成功后 user 行 sending 必须变 false', userRows.length === 1 && userRows[0].sending === false);
ok('乐观 pending 行已退役（不残留幽灵 user 行）', settled.every((r) => r.id !== 'u-1'));

// 同一行 id 的 ChatRow **对象恒等**（LazyForEach 不重建行）且字段逐帧跟随。
// ⚠️ 帧形状用 `iteration`（带 `iter`，模型 `adapt` 的 tick 源）：老 wire 的 `stream`
//    事件用 `iteration` 字段（不是 `iter`），`adapt` 只认 `ev.iter` ⇒ 它不产生 tick。
feed.push({
  type: 'iteration', turnID: 1, iter: 1, seq: 10, phase: 'thinking',
  content: '第一段', reasoning: '', activeTools: [], completedTools: [],
});
const liveA = feed.rows().find((r) => r.turnID === 1 && r.role === 'assistant' && r.isLive === true) as ChatRow;
feed.push({
  type: 'iteration', turnID: 1, iter: 1, seq: 11, phase: 'thinking',
  content: '第一段+第二段', reasoning: '', activeTools: [], completedTools: [],
});
const liveB = feed.rows().find((r) => r.turnID === 1 && r.role === 'assistant' && r.isLive === true) as ChatRow;
ok('同一行 id ⇒ 同一 ChatRow 对象（身份稳定，不整表重建）', liveA === liveB);
ok(`同一行对象上的内容必须就地刷新（不得冻在首帧）[got=${JSON.stringify(liveB !== undefined ? liveB.content : null)}]`,
  liveA !== undefined && liveB !== undefined && liveB.content === '第一段+第二段' && liveA.content === liveB.content);

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
