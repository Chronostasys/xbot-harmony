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

console.log('\n▶ §H 回合结束后的「会话级轻帧」不得复活 busy / 不得清工具（final-6 C1/C2）');
{
  // 一个"已 idle 但 activeTurn 仍指向 live 且 streaming=false"的回合（权威 idle 的形态）。
  let s: ChatState = started();
  s = reduce(s, { type: 'session', busy: false } as unknown as DomainEvent);
  const afterIdle = s;
  // 服务端回合收尾后改 todo：轻帧 = Phase:"" / Iteration:0 / 只有 todos（无 iteration 载荷）
  const evs = normalizeEvent({ type: 'progress_structured', progress: {
    chat_id: 'c', phase: '', turn_id: 0, seq: 50,
    todos: [{ text: 'a', status: 'pending' }],
  } }, 'c');
  let s2 = afterIdle;
  if (evs !== null) { for (const e of evs) { s2 = reduce(s2, e); } }
  ok('★H1 轻帧被归一成 `session_fields`（不是 iteration）',
    evs !== null && evs.length === 1 && evs[0].type === 'session_fields');
  ok('★H2 轻帧不得复活 busy', s2.sessionRunning === false);
  ok('★H3 轻帧仍应用 todos 三态', s2.todos.length === 1);
  // 工具列表不得被轻帧清空
  const withTools = reduce(s2, { type: 'stream', turnID: T, seq: eventSeq(60), iteration: iterNum(1),
    content: 'x', reasoning: '', streamingTools: [{ name: 'Shell', status: 'running' }],
    genui: undefined, streamStats: undefined } as unknown as DomainEvent);
  const evs2 = normalizeEvent({ type: 'progress_structured', progress: {
    chat_id: 'c', phase: '', turn_id: 0, seq: 61, todos: [{ text: 'b', status: 'pending' }],
  } }, 'c');
  let s3 = withTools;
  if (evs2 !== null) { for (const e of evs2) { s3 = reduce(s3, e); } }
  const t3 = s3.activeTurn !== null ? s3.turns.get(s3.activeTurn) : undefined;
  const tools3 = t3 !== undefined && t3.phase.kind === 'live' ? t3.phase.data.streamingTools.length : -1;
  ok('★H4 轻帧不得清空在飞工具', tools3 === 1);
}

console.log('\n▶ §I 显式空工具列表 = 清空；缺失 = 未携带（be-state-1 §1 契约）');
{
  // 后端已改为恒发非 nil（空即 `[]`）⇒ 客户端必须把「携带但为空」当**显式空**，
  // 否则同一迭代内 promote/取消后的 pill 会一直转圈。
  let s: ChatState = started();
  const liveTools = (): number => {
    const t = s.activeTurn !== null ? s.turns.get(s.activeTurn) : undefined;
    return t !== undefined && t.phase.kind === 'live' ? t.phase.data.activeTools.length : -1;
  };
  const e1 = normalizeEvent({ type: 'progress_structured', progress: {
    chat_id: 'c', phase: 'running', turn_id: 1, seq: 70, iteration: 2,
    active_tools: [{ name: 'Shell', label: 'Shell', status: 'running', iteration: 2 }],
  } }, 'c');
  if (e1 !== null) { for (const e of e1) { s = reduce(s, e); } }
  ok('★I1 帧带 active_tools ⇒ 在飞工具 1 条', liveTools() === 1);
  const e2 = normalizeEvent({ type: 'progress_structured', progress: {
    chat_id: 'c', phase: 'running', turn_id: 1, seq: 71, iteration: 2, active_tools: [],
  } }, 'c');
  if (e2 !== null) { for (const e of e2) { s = reduce(s, e); } }
  ok('★I2 显式空数组 ⇒ 清空（"无工具"可表达）', liveTools() === 0);
  // 对照组：字段**缺失** ⇒ 未携带 ⇒ 保持原值（不得清空）
  let s2: ChatState = started();
  if (e1 !== null) { for (const e of e1) { s2 = reduce(s2, e); } }
  const e3 = normalizeEvent({ type: 'progress_structured', progress: {
    chat_id: 'c', phase: 'running', turn_id: 1, seq: 72, iteration: 2, content: 'y',
  } }, 'c');
  if (e3 !== null) { for (const e of e3) { s2 = reduce(s2, e); } }
  const t2 = s2.activeTurn !== null ? s2.turns.get(s2.activeTurn) : undefined;
  const n2 = t2 !== undefined && t2.phase.kind === 'live' ? t2.phase.data.activeTools.length : -1;
  ok('★I3 字段缺失 ⇒ 未携带 ⇒ 保持（不清空）', n2 === 1);
}

console.log(`\n  state_invariants: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
