/**
 * 判据：**水合不得把"已经结束的旧回合"复活成在飞**（2026-10-22 用户亲报的 bug 根因）。
 *
 * 现场：断线/切后台期间回合跑完，**历史推进到下一个 turn**；重新连接后做权威重载 ⇒
 *   旧轮一直转（`final=null` / `streaming=true` / `phase='tool_exec'`）、`live` 仍指向它，
 *   而**新的那一轮（已经在历史里）不流式**。
 *
 * 根因（`core/model_hydrate.ts`）：在飞判定 `running = active.turnID === turn || prev.live.turn === turn`
 *   —— 第二条**无条件信本地记忆**。快照里已经出现比 `prev.live.turn` 更大的回合时，
 *   那一轮在服务端**必然已结束**，却被复活。
 *
 * 修法（单调性，纯结构）：`liveOvertaken = maxSnapTurn > prev.live.turn` ⇒
 *   · 该轮不再按 running 水合（`final` 落定、`streaming=false`）；
 *   · `live` 归 null（不再指向结束的旧轮）。
 *   ⛔ 反向必须保住：快照**没有**更新的回合时，仍保留 `prev.live`（这是 2026-10-22
 *   「cancel 后 agent 消息消失几秒又出现」那条修复的窗口，不能回退）。
 *
 * ⛔ mutation 自证：
 *   · 去掉 `&& !liveOvertaken`（恢复旧判定）⇒ ① 红；
 *   · 把 `live` 无条件保留（删掉 overtaken 判断）⇒ ② 红；
 *   · 让"没有更新回合"时也不保留 live ⇒ ③ 红（回归 cancel 窗口）。
 */
declare const process: { exit: (c: number) => void };

import { emptyState, LiveIter, newTurn, State, TurnRec } from '../../entry/src/main/ets/core/model_types';
import { hydrate, WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function liveIter(turn: number, iteration: number): LiveIter {
  return { turn, iteration, content: '', reasoning: '', tools: [], genui: '' } as LiveIter;
}

/** 前置状态：turn 1 在飞（2 块），live 指向 turn 1。 */
function prevLiveOnTurn1(): State {
  const base: State = emptyState('c1', 1, 0);
  const t: TurnRec = newTurn(1 as never, null, null);
  const flying: TurnRec = { ...t, blocks: [{ iteration: 1 }, { iteration: 2 }] as never, final: null, streaming: true, phase: 'tool_exec' };
  const turns = new Map<number, TurnRec>();
  turns.set(1, flying);
  return { ...base, turns, live: liveIter(1, 2) } as State;
}

function wire(turn2Present: boolean): WireHistoryMessage[] {
  const msgs: WireHistoryMessage[] = [
    { id: 'u1', role: 'user', content: 'user1', turnID: 1 },
    { id: 'a1', role: 'assistant', content: 'answer1', turnID: 1, iterations: [{ iteration: 1 }, { iteration: 2 }] },
  ];
  if (turn2Present) {
    msgs.push({ id: 'u2', role: 'user', content: 'user2', turnID: 2 });
  }
  return msgs;
}

// ── ① 历史推进到下一个 turn（active=null）⇒ 旧轮必须落定，live 归 null ──────────
{
  const st: State = hydrate(prevLiveOnTurn1(), wire(true), 9, null);
  const t1: TurnRec | undefined = st.turns.get(1 as never);
  ok('① 旧轮存在', t1 !== undefined);
  ok('① 旧轮必须落定（final 非空）', t1 !== undefined && t1.final !== null);
  eq('① 旧轮不得再标 streaming', t1 !== undefined ? t1.streaming : 'missing', false);
  eq('① 旧轮 phase 必须是 done', t1 !== undefined ? t1.phase : 'missing', 'done');
  eq('① live 必须归 null（不得仍指向已结束的旧轮）', st.live, null);
  ok('① 新轮（turn 2）已被水合', st.turns.get(2 as never) !== undefined);
}

// ── ② active 指向新轮 ⇒ 旧轮落定、live 指向新轮 ────────────────────────────────
{
  const st: State = hydrate(prevLiveOnTurn1(), wire(true), 9,
    { turnID: 2, snapshot: { iter: 1, content: 'x', reasoning: '' } });
  const t1: TurnRec | undefined = st.turns.get(1 as never);
  ok('② 旧轮落定（final 非空）', t1 !== undefined && t1.final !== null);
  ok('② live 指向新轮', st.live !== null && (st.live as LiveIter).turn === 2);
}

// ── ③ 反向（回归闸）：快照**没有**更新的回合 ⇒ 必须保留 live（cancel 窗口）────
{
  const st: State = hydrate(prevLiveOnTurn1(), wire(false), 9, null);
  const t1: TurnRec | undefined = st.turns.get(1 as never);
  ok('③ 没有更新回合时，旧轮仍按在飞水合（final 为空）', t1 !== undefined && t1.final === null);
  ok('③ live 仍指向该轮（否则 cancel 期间正文会闪没）', st.live !== null && (st.live as LiveIter).turn === 1);
}

console.log(`hydrate_liveness: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
