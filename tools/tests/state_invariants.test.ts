/**
 * state_invariants.test.ts —— 用户 2026-10-21 定稿的**状态不变量**（单一守卫文件）。
 *
 * 规则来源（原话）：
 *  · 「busy 变 IDLE 必须要么收到**一个没有 toolcall 的迭代**，要么**后端告诉你 idle**；
 *    别的任何情况不能变」；
 *  · 「todo 还有 goal 不能有任何闪烁/频繁状态变化；**严格区分空值和无值**」；
 *  · 「看门狗触发了请求，请求结果带会话状态更新我认，但不能因为**触发了请求**就改状态」；
 *  · 「session tree 是整体粗粒度状态，**不能影响单个会话**（连变 busy 也不行）」。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';
import { ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq } from '../../entry/src/main/ets/core/chat_types_full';
import type { GoalInfo } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } }
const T = turnID(1);

function started(): ChatState {
  return reduce(initialChatState('c'), { type: 'turn_started', turnID: T, requestID: null, trigger: 'user', content: null } as unknown as DomainEvent);
}
function streamOnce(s: ChatState): ChatState {
  return reduce(s, { type: 'stream', turnID: T, seq: eventSeq(5), iteration: iterNum(1), content: 'x', reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined } as unknown as DomainEvent);
}
function noToolIteration(s: ChatState): ChatState {
  return reduce(s, { type: 'iteration', turnID: T, iter: iterNum(1), seq: eventSeq(9), content: 'fin', reasoning: '', activeTools: [], completedTools: [], iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined } as unknown as DomainEvent);
}
function textFinal(s: ChatState): ChatState {
  return reduce(s, { type: 'text_final', turnID: T, content: 'done', seq: eventSeq(20), progressHistory: [], reasoning: '' } as unknown as DomainEvent);
}
function hist(partial: Record<string, unknown>): DomainEvent {
  return {
    type: 'history_replaced', turns: [], legacy: [], pendingUsers: [], active: null,
    lastSeq: null, todos: [], standalone: [], ...partial,
  } as unknown as DomainEvent;
}

console.log('\n▶ §A busy：只允许「无 toolcall 迭代 / 后端 idle」两条路降级');
{
  const s = started();
  ok('★A turn_started 后 busy=true', s.sessionRunning);
  const viaFinal = textFinal(noToolIteration(s));
  ok('★A 收尾（无 toolcall 迭代 + text_final）⇒ busy=false', !viaFinal.sessionRunning);

  const viaIdle = reduce(streamOnce(s), { type: 'session', busy: false } as unknown as DomainEvent);
  ok('★A 后端 session(idle) ⇒ busy=false', !viaIdle.sessionRunning);
  const viaIdle2 = reduce(streamOnce(s), { type: 'session_idle' } as unknown as DomainEvent);
  ok('★A 后端 session_idle ⇒ busy=false', !viaIdle2.sessionRunning);

  // ⛔ 快照（DB 滞后）绝不能关 busy
  const snap = reduce(s, hist({}));
  ok('★A 无 active 的 DB 快照**不得**关 busy', snap.sessionRunning);
}

console.log('\n▶ §B 快照可以"打开"busy（只增不减）');
{
  const idle = initialChatState('c');
  const snap = reduce(idle, hist({ active: { turnID: T, snapshot: { content: 'x', reasoning: '', streaming: true, iter: 1, iterations: [], activeTools: [], completedTools: [], streamingTools: [], subAgents: [], genui: undefined, streamStats: undefined, todos: [], goal: null, tokenUsage: undefined, lastSeq: null } } }));
  ok('★B 快照带 active ⇒ busy=true', snap.sessionRunning);
}

console.log('\n▶ §C goal 严格三态（空值 ≠ 无值）');
{
  const withGoal = reduce(initialChatState('c'), { type: 'session_fields', todos: [], goal: { objective: 'G', status: 'active' } as GoalInfo } as unknown as DomainEvent);
  ok('★C 前置：goal 已存在', withGoal.goal !== null && withGoal.goal !== undefined);
  const keep1 = reduce(withGoal, { type: 'session_fields', todos: [], goal: undefined } as unknown as DomainEvent);
  ok('★C 字段缺失 ⇒ 保留', keep1.goal !== null && keep1.goal !== undefined);
  const keep2 = reduce(withGoal, { type: 'session_fields', todos: [], goal: { objective: '', status: 'active' } as GoalInfo } as unknown as DomainEvent);
  ok('★C 空 objective（无 cleared）⇒ 保留', keep2.goal !== null && keep2.goal !== undefined);
  const cleared = reduce(withGoal, { type: 'session_fields', todos: [], goal: null } as unknown as DomainEvent);
  ok('★C 显式清除（null / cleared）⇒ 消失', cleared.goal === null || cleared.goal === undefined);
  const completed = reduce(initialChatState('c'), { type: 'session_fields', todos: [], goal: { objective: 'G', status: 'completed' } as GoalInfo } as unknown as DomainEvent);
  ok('★C completed 照常保留（完成后仍显示）', completed.goal !== null && completed.goal !== undefined);
  // 流式帧也要带 goal（后端 turn 中进行中的帧）
  const evs = normalizeEvent({ type: 'progress_structured', progress: { chat_id: 'c', phase: '', turn_id: 1, seq: 3, stream_content: 'x', goal: { objective: 'G2', status: 'active' } } }, 'c');
  const s2 = evs === null ? withGoal : reduce(withGoal, evs[0]);
  ok('★C 流式帧携带的 goal 立即生效', s2.goal !== null && (s2.goal as unknown as { objective?: string }).objective === 'G2');
}

console.log('\n▶ §D todos 严格三态 + 快照新旧判据');
{
  const two = reduce(initialChatState('c'), { type: 'session_fields', todos: [{ text: 'a', status: 'pending' }, { text: 'b', status: 'pending' }], goal: undefined } as unknown as DomainEvent);
  ok('★D 前置：两条 todo', two.todos.length === 2);
  const keep = reduce(two, { type: 'session_fields', todos: undefined, goal: undefined } as unknown as DomainEvent);
  ok('★D 字段缺失 ⇒ 保留', keep.todos.length === 2);
  const empty = reduce(two, { type: 'session_fields', todos: [], goal: undefined } as unknown as DomainEvent);
  ok('★D 明确空数组 ⇒ 清空', empty.todos.length === 0);
  // 无 live turn：快照明确携带 [] ⇒ 清空
  const idleSnap = reduce(two, hist({ todos: [], todosAuthoritative: true }));
  ok('★D idle 时快照明确 [] ⇒ 清空', idleSnap.todos.length === 0);
  // 有 live turn：快照旧值不得覆盖本地（todo_write 刚落库）
  const live = streamOnce(started());
  const liveSnap = reduce(reduce(live, { type: 'session_fields', todos: [{ text: 'new', status: 'done' }], goal: undefined } as unknown as DomainEvent), hist({ todos: [{ text: 'old', status: 'pending' }], todosAuthoritative: true }));
  ok('★D 有 live turn 时快照旧值不得覆盖本地', liveSnap.todos.length === 1 && liveSnap.todos[0].text === 'new');
}

console.log('\n▶ §E 无对账写状态（形态判据）');
{
  const req = require('fs');
  const path = require('path');
  const store = req.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8') as string;
  const i = store.indexOf('session-tree');
  ok('★E store 不再从会话树 push `session_running`（只更新侧边栏）',
    !/runNode\.running[\s\S]{0,400}pushEvent\(\{\s*type: 'session_running'/.test(store));
  const idleGuarded = /if \(this\.sendIntentActive\(\)\) \{\s*\n\s*return;/.test(store);
  ok('★E `applyLocalIdle` 在发送意图窗口内直接返回（不因请求关 busy）', idleGuarded);
}

console.log('\n▶ §F 第三轮修复的接线判据（防回归）');
{
  const req2 = require('fs');
  const path2 = require('path');
  const st = req2.readFileSync(path2.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8') as string;
  const rd = req2.readFileSync(path2.join(process.cwd(), 'entry/src/main/ets/core/reduce.ts'), 'utf8') as string;
  const pg = req2.readFileSync(path2.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8') as string;
  ok('★F1 批量入口 `pushEvents` 也刷新 lastEventAtMs',
    /private pushEvents\(evs[\s\S]{0,600}lastEventAtMs = Date\.now\(\)/.test(st));
  ok('★F2b 在飞闸门排队重载（historyReloadPending）且在 finally 消费',
    /historyReloadPending = true/.test(st) && /if \(this\.historyReloadPending && !this\.disposed\)/.test(st));
  ok('★F3 loadStatus 有 live turn 时不写 todos',
    /this\.hasLiveTurn\(\) \? undefined : toStateTodos\(st\.todos\)/.test(st));
  ok('★F4 send 回包有身份守卫（sendGen/sendChat）',
    /const sendGen: number = this\.chatGen/.test(st) && /sendGen !== this\.chatGen \|\| sendChat !== this\.currentChatId/.test(st));
  ok('★F5 订阅前先关旧 SSE（sse.close）', /this\.sse\.close\(\);\s*\n\s*this\.subscribe\(\);/.test(st));
  ok('★F6 dispose 置 disposed + 轮询链自检',
    /this\.disposed = true;/.test(st)
    && /if \(this\.disposed\) \{\s*\n\s*return;/.test(st));
  ok('★F7 退役计数只来自快照 ev.turns', /for \(const t of ev\.turns\)/.test(rd));
  ok('★F9 内容匹配先于位置启发式',
    rd.indexOf('s.pendingUsers[i].content === content') < rd.indexOf('if (u.sending && !u.queued)'));
  ok('★F10 busy 日志与 lastLoggedBusy 比较', /const wasBusy: boolean = this\.lastLoggedBusy;/.test(pg));
  ok('★F12 sessions 缺字段/null 时保留旧列表',
    /if \(data\.sessions === null \|\| data\.sessions === undefined\) \{\s*\n\s*return;/.test(st));
}

console.log(`\n  state_invariants: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
