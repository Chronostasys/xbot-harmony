/**
 * send_state_settle.test.ts —— 「消息已回复却仍显示**发送中…**」的端到端复现判据。
 *
 * 用户 2026-10-21 真机（截图）：最后几条 user 气泡全部挂着「发送中…」，而**回复已经渲染**、
 * 顶栏还写着「运行中…」，输入框显示「处理中 — 消息将排队…」。
 * 用户原话：「不是说好了只要新迭代的 SSE 到了就代表一定发送成功了吗？」
 *
 * 不变量（本文件钉死）：
 *   **任何送达证据（turn_started / 任一 iteration / 任一 stream / text_final / idle）
 *     ⇒ 该 user 行的 `sending` 必须为 false。**
 *   `sending` 只允许在"乐观行已入队、服务端还没给任何证据"的窗口里为 true。
 *
 * 覆盖两条路径（都是 store 真实产生的事件序列）：
 *   · R1：requestID 精确绑定（正常路径）；
 *   · R2：无 requestID / ack 丢失（`turn_started` 只带 trigger=user）—— 真机最常见。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { deriveRows, Row } from '../../entry/src/main/ets/core/derive';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq, UserRow,
} from '../../entry/src/main/ets/core/chat_types_full';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const T = turnID(1);
const RID = 'req-1';

function pendingRow(content: string, sending: boolean, requestID: string | null): UserRow {
  return {
    id: 'u-1', content: content, timestamp: '2026-10-21T01:00:00Z',
    isNotification: false, queued: false, sending: sending,
    requestID: requestID, turnHint: undefined, dbID: undefined,
  } as unknown as UserRow;
}

function userSent(s: ChatState, row: UserRow): ChatState {
  return reduce(s, { type: 'user_sent', row } as unknown as DomainEvent);
}
function sessionRunning(s: ChatState, running: boolean): ChatState {
  return reduce(s, { type: 'session_running', running } as unknown as DomainEvent);
}
function turnStarted(s: ChatState, requestID: string | null): ChatState {
  return reduce(s, {
    type: 'turn_started', turnID: T, requestID: requestID, trigger: 'user', content: null,
  } as unknown as DomainEvent);
}
function streamEv(s: ChatState, content: string): ChatState {
  return reduce(s, {
    type: 'stream', turnID: T, seq: eventSeq(10), iteration: iterNum(1),
    content: content, reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as unknown as DomainEvent);
}
function textFinal(s: ChatState, content: string): ChatState {
  return reduce(s, {
    type: 'text_final', turnID: T, content: content, seq: eventSeq(20),
    progressHistory: [], reasoning: '',
  } as unknown as DomainEvent);
}

/** 页面上会看到的所有 user 行（含 pendingUsers 段）。 */
function userRows(s: ChatState): Row[] {
  const rows: readonly Row[] = deriveRows(s);
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'user') { out.push(rows[i]); }
  }
  return out;
}
function anySending(s: ChatState): boolean {
  const us: Row[] = userRows(s);
  for (let i = 0; i < us.length; i++) {
    const r = us[i];
    if (r.kind === 'user' && r.sending) { return true; }
  }
  return false;
}
function countUserRows(s: ChatState): number { return userRows(s).length; }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 正常路径（requestID 精确绑定）：回复到达后不得残留「发送中」');
{
  let s: ChatState = initialChatState('c');
  s = sessionRunning(s, true);          // 合法窗口：会话在跑
  s = userSent(s, pendingRow('你好', true, RID));
  ok('★A busy 窗口里乐观行**确实**显示发送中（前置条件）', anySending(s));
  s = turnStarted(s, RID);
  s = streamEv(s, '你好');
  ok('★A 第一帧 stream 到达后**不再**显示发送中（用户的原话：SSE 到了就代表发送成功）', !anySending(s));
  s = textFinal(s, '你好！');
  ok('★A 回合结束后仍不显示发送中', !anySending(s));
  ok('★A 且只有**一条** user 行（乐观行被收编，没有幽灵副本）', countUserRows(s) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B ack 丢失路径（turn_started 不带 requestID）：同样必须清掉');
{
  let s: ChatState = initialChatState('c');
  s = sessionRunning(s, true);
  s = userSent(s, pendingRow('你好', true, null));
  s = turnStarted(s, null);                 // 真机常见：ack 没回来
  s = streamEv(s, '你好');
  ok('★B 送达证据到达后不再显示发送中', !anySending(s));
  s = textFinal(s, '你好！');
  ok('★B 回合结束后仍不显示发送中', !anySending(s));
  ok('★B 只有一条 user 行', countUserRows(s) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 连续发两条（第二条排队）：第一条必须已结算，第二条只允许"排队"不算发送中');
{
  let s: ChatState = initialChatState('c');
  s = sessionRunning(s, true);
  s = userSent(s, pendingRow('第一条', true, 'req-a'));
  s = turnStarted(s, 'req-a');
  s = streamEv(s, '收到');
  ok('★C 第一条在第二条入队前已结算', !anySending(s));
  s = userSent(s, pendingRow('第二条', true, 'req-b'));
  // 第二条处于"已发送但服务端还没给证据"的窗口 ⇒ 允许 sending=true（唯一合法窗口）
  ok('★C 第二条的 sending=true 是合法窗口（服务端尚无证据）', anySending(s));
  ok('★C 此时 total user 行 = 2（第一条已绑定 turn + 第二条 pending）', countUserRows(s) === 2);
  s = textFinal(s, '收到');
  ok('★C 第一条回合结束后，第二条仍只允许 pending（不得凭空变两条已发送）', countUserRows(s) === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E **权威历史快照**到达（DB 里已有该消息与回复）：乐观行的 sending 必须结算');
{
  // 真机形态：断线期间发出消息（turn_started/stream 全丢），重连后 history_replaced
  // 直接把"user + 回复"从 DB 灌进来 —— 此时本地那条 pending 仍挂着 sending=true。
  let s: ChatState = initialChatState('c');
  s = userSent(s, pendingRow('你好', true, 'req-lost'));
  // 权威快照：一个已完成的 turn（user 内容相同 + assistant 有回复），无 active
  const hist: DomainEvent = {
    type: 'history_replaced',
    turns: [{
      id: T,
      user: {
        id: 'db-1', content: '你好', timestamp: '2026-10-21T01:00:00Z',
        isNotification: false, queued: false, sending: false,
        requestID: null, turnHint: undefined, dbID: 11,
      },
      phase: {
        kind: 'committed',
        payload: {
          content: '你好！', iterations: [], compactions: [], regionsBefore: 0,
          iterationsTruncated: 0, via: 'text',
        },
      },
      requestID: null,
    }],
    legacy: [], pendingUsers: [], active: null, lastSeq: 0, todos: [], goal: undefined,
    standalone: [],
  } as unknown as DomainEvent;
  s = reduce(s, hist);
  ok('★E 快照到达后不再显示「发送中」', !anySending(s));
  ok('★E 且不出现重复的 user 行（DB 行取代乐观行）', countUserRows(s) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §F **排队出队**形态（后端 agent.go:4647-4668：queued 消息出队时 trigger=user + content）');
{
  // 真机形态（只有该会话复现）：busy 期间连发两条同内容「你好」→ 都进队列 ⇒
  // 出队时 turn_started 带 trigger=user + content，而本地 pending 行是 queued=true。
  let s: ChatState = initialChatState('c');
  const queuedRow: UserRow = {
    id: 'u-q', content: '你好', timestamp: '2026-10-21T01:16:17Z',
    isNotification: false, queued: true, sending: true,
    requestID: 'req-q', turnHint: undefined, dbID: undefined,
  } as unknown as UserRow;
  s = userSent(s, queuedRow);
  // 出队：turn_started 只带 content（不带 requestID 的匹配）
  s = reduce(s, {
    type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: '你好',
  } as unknown as DomainEvent);
  ok('★F 出队后不再显示发送中（内容兜底收编）', !anySending(s));
  ok('★F 且只有一条 user 行（没有幽灵 pending 副本）', countUserRows(s) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §G **出口不变量**：会话 idle ⇒ 任何 user 行都不得 sending（任何未来路径都不会漏）');
{
  let s: ChatState = initialChatState('c');
  s = userSent(s, pendingRow('你好', true, 'req-x'));
  // 一条与送达无关的事件（queue 变更）之后仍然是 idle ⇒ sending 必须被收敛
  s = reduce(s, { type: 'session_fields', todos: [], goal: undefined } as unknown as DomainEvent);
  ok('★G idle 下 sending 被收敛为 false（不变量兜底）', !anySending(s));
}

console.log('\n▶ §D mutation 自证（外部注入）');
console.log('   · 删掉 `settlePendingSending` 里 `!atTurnEnd` 的 pending 清理 ⇒ §A/§B 在 stream 后必红');
console.log('   · 删掉 `atTurnEnd` 的"清所有 turn 的 user.sending" ⇒ §A/§B 在 text_final 后必红');
console.log('   · `turn_started` 收编时不写 `sending: false` ⇒ §A 前置断言后仍红');

console.log(`\n  send_state_settle: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
