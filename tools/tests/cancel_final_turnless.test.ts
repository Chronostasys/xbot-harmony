/**
 * 判据：**cancel 的收尾帧没有 turn_id 时，被取消的回合必须真的被收尾**（2026-10-22 用户 P0）。
 *
 * 现场（用户原话）：历史 `user1 assistant1（iter1-20, busy）` → cancel → 发 `user2`
 *   ⇒ 历史立刻变成 `user1 user2（iter1-20, busy）`（assistant1 不在原位，内容被当成在飞尾项
 *   挂在列表末尾，并且一直 busy）；几秒后才自愈。
 *
 * 根因链：
 *   ① 后端 cancel ack 的 `OutboundMsg` **不带 TurnID**（`agent/agent_process.go:handleCancelledRun`）
 *      ⇒ `normalizeText` 得到 `text_final{turnID: null, cancelled: true, content: ''}`；
 *   ② `core/model_adapter.ts` 的 `text_final` 分支把 `turn <= 0` 一律当"命令回复"丢弃
 *      （该规则只对 `commandReply === true` 成立）⇒ **被取消的回合永远没有 `final`**；
 *   ③ `model_project.assistantRow` 因此给出 `turn-N-live` + `finalized=false` ⇒ `ChatRow.isLive=true`；
 *   ④ 页面 `syncRowDs` 把 `isLive` 行**抽出列表当末尾在飞尾项** ⇒ `user1 user2` + 尾部
 *      `iter1-20 busy`（assistant1 不在原位）。
 *
 * ⛔ mutation 自证（每一条都能把本判据打红）：
 *   · `adapt` 恢复成 `if (turn <= 0) return []`（不分命令回复） ⇒ ①/② 红（行停在 `turn-1-live`）；
 *   · `endingTurnOf` 取"最晚仍未收尾" ⇒ ③ 红（会把**新轮** T2 标成 cancelled）；
 *   · `needsEndingTurn` 不排除 `commandReply` ⇒ ④ 红（命令回复被绑进某个 turn）。
 */
declare const process: { exit: (c: number) => void };
import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail !== undefined ? `\n      ${detail}` : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

function iters(from: number, to: number): unknown[] {
  const out: unknown[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ iteration: i, content: `c${i}`, reasoning: '', tools: [] });
  }
  return out;
}

function ids(rows: ChatRow[]): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(`${rows[i].role}:${rows[i].id}${rows[i].isLive ? '(L)' : ''}`);
  }
  return out.join(' | ');
}

/** 跑到 "iter 1..20，iter20 在飞" 的现场（与真机事件同形）。 */
function liveFeed(chat: string): ModelFeed {
  const f = new ModelFeed(chat);
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r1', trigger: 'user', content: 'user1' });
  f.push({
    type: 'iteration', turnID: 1, iter: 20, seq: 1, phase: 'thinking',
    content: 'c20', reasoning: '', iterationsDelta: iters(1, 19),
    activeTools: [], completedTools: [],
  });
  return f;
}

/** cancel：服务端补 `done(20)`（`emitIterationDone`） + **无 turn_id 的** `text` 收尾帧。 */
function cancel(f: ModelFeed, seq: number): void {
  f.push({
    type: 'iteration', turnID: 1, iter: 20, seq, phase: 'tool_exec',
    content: 'c20', reasoning: '',
    iterationsDelta: [{ iteration: 20, content: 'c20', reasoning: '', tools: [] }],
    activeTools: [], completedTools: [],
  });
  f.push({ type: 'text_final', turnID: null, content: '', cancelled: true, progressHistory: [] }, 1);
  f.push({ type: 'session', busy: false });
}

// ── ① cancel 之后：该轮必须已收尾（不是 live）────────────────────────────────
{
  const f = liveFeed('cancel_1');
  const before: ChatRow[] = f.rows();
  eq('① cancel 前：assistant 行是在飞行', before[before.length - 1].id, 'turn-1-live');
  ok('① cancel 前：assistant 行 isLive=true', before[before.length - 1].isLive === true);

  cancel(f, 2);
  const after: ChatRow[] = f.rows();
  const a = after[after.length - 1];
  eq('① cancel 后：assistant 行 id 必须变成已收尾的 turn-1-c', a.id, 'turn-1-c');
  ok('① cancel 后：assistant 行不得再是 live（否则页面把它当尾项搬到底部）', a.isLive === false,
    `rows=${ids(after)}`);
  eq('① cancel 后：20 个迭代一个不少', a.iterations.length, 20);
  eq('① cancel 后：行序不变', ids(after), 'user:turn-1-user | assistant:turn-1-c');
}

// ── ② cancel 后发 user2：assistant1 必须在 user2 **之前**，且唯一 live 是新一轮 ──
{
  const f = liveFeed('cancel_2');
  cancel(f, 2);
  f.push({
    type: 'user_sent',
    row: { id: 'u2', content: 'user2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnHint: 2, queued: false, command: false });
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'user2' });
  const rows: ChatRow[] = f.rows();
  eq('② 行序：user1 → assistant1(已收尾) → user2 → assistant2(在飞)', ids(rows),
    'user:turn-1-user | assistant:turn-1-c | user:turn-2-user | assistant:turn-2-live(L)');
  const liveRows: ChatRow[] = rows.filter((r) => r.isLive);
  eq('② 恰有 1 条在飞行（= 新一轮），cancel 过的那轮不得在飞', liveRows.length, 1);
  eq('② 在飞的是新一轮', liveRows.length === 1 ? liveRows[0].id : '', 'turn-2-live');
}

// ── ③ 竞争：cancel ack 晚于新一轮的 turn_started（不得误伤新轮）───────────────
{
  const f = liveFeed('cancel_3');
  f.push({
    type: 'iteration', turnID: 1, iter: 20, seq: 2, phase: 'tool_exec',
    content: 'c20', reasoning: '',
    iterationsDelta: [{ iteration: 20, content: 'c20', reasoning: '', tools: [] }],
    activeTools: [], completedTools: [],
  });
  // 用户点完 cancel 立刻发下一条：新一轮先 open（T1 仍无 final）
  f.push({
    type: 'user_sent',
    row: { id: 'u2', content: 'user2', timestamp: 't', isNotification: false, queued: false, sending: true, requestID: 'r2' },
  });
  f.push({ type: 'user_ack', requestID: 'r2', dbID: 22, turnHint: 2, queued: false, command: false });
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'user2' });
  // 迟到的 cancel ack（仍无 turn_id）
  f.push({ type: 'text_final', turnID: null, content: '', cancelled: true, progressHistory: [] }, 1);
  const rows: ChatRow[] = f.rows();
  const r1 = rows.filter((r) => r.turnID === 1 && r.role === 'assistant')[0];
  const r2 = rows.filter((r) => r.turnID === 2 && r.role === 'assistant')[0];
  ok('③ 迟到的 cancel ack 收尾的是**被取消的那一轮**（T1）',
    r1 !== undefined && r1.id === 'turn-1-c' && r1.isLive === false, `rows=${ids(rows)}`);
  ok('③ 新一轮（T2）不得被误收尾（仍是 live）',
    r2 !== undefined && r2.id === 'turn-2-live' && r2.isLive === true);
}

// ── ④ 命令回复（显式 commandReply，无 turn_id）仍然不进任何 turn ─────────────
{
  const f = liveFeed('cancel_4');
  // 命令回复到达时 T1 仍未收尾（旧实现会把它绑进去）
  f.push({ type: 'text_final', turnID: null, content: 'pwd: /tmp', commandReply: true, cancelled: false, progressHistory: [] });
  const rows: ChatRow[] = f.rows();
  const a = rows.filter((r) => r.role === 'assistant')[0];
  ok('④ 命令回复不得收尾在跑的那一轮（仍是 live）',
    a !== undefined && a.id === 'turn-1-live' && a.isLive === true, `rows=${ids(rows)}`);
}

// ── ⑤ 无任何未收尾回合时，无 turn_id 的 final 不得凭空造行 ────────────────────
{
  const f = new ModelFeed('cancel_5');
  f.push({ type: 'text_final', turnID: null, content: 'x', cancelled: true, progressHistory: [] });
  eq('⑤ 空会话里的无 turn 收尾帧不产行', f.rows().length, 0);
  eq('⑤ 空会话里的无 turn 收尾帧不造回合', f.state.turns.size, 0);
}

console.log(`cancel_final_turnless: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
