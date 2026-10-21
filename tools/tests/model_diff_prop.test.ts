/**
 * `model_diff_prop` —— 随机差分判据（docs/STATE-MODEL.md §9.2/§9.3）。
 *
 * 设备上没有 SSE 录制、真机会话又被登录态挡住 ⇒ 用**受控随机**覆盖状态空间：
 * 60 条随机会话 × 1..3 回合 × 1..3 迭代 × 0..2 工具 × 随机取消，
 * 逐行比较 旧(`reduce→deriveRows`) 与 新(`adapt→stepAll→applyModel`) 的
 * (role, turnID, 用户正文长度, 块数, 每块工具 call_id 序列)。
 *
 * 判别力：本判据曾钓出两个真缺陷（`call_id` 字段名、同事件多帧共享 seq 被丢）。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState } from '../../entry/src/main/ets/core/chat_types_full';
import type { ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';
import { deriveRows } from '../../entry/src/main/ets/core/derive';
import type { Row } from '../../entry/src/main/ets/core/derive';
import { adapt } from '../../entry/src/main/ets/core/model_adapter';
import type { WireEvent } from '../../entry/src/main/ets/core/model_adapter';
import { stepAll } from '../../entry/src/main/ets/core/model_step';
import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { State } from '../../entry/src/main/ets/core/model_types';
import { applyModel } from '../../entry/src/main/ets/core/model_bridge';
import { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { pass++; } else { fail++; console.log(`  \u2717 ${name} ${detail}`); }
}

interface HistIt { iteration: number; content: string; tools: readonly never[] }

let seed: number = 20261021;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n: number): number { return Math.floor(rnd() * n) % n; }

function genTurn(turn: number, seq0: number): WireEvent[] {
  const evs: WireEvent[] = [];
  let seq = seq0;
  evs.push({ type: 'turn_started', turnID: turn, trigger: 'user', content: `q${turn}`, requestID: `r${turn}`, seq: ++seq });
  const iters = 1 + ri(3);
  for (let it = 1; it <= iters; it++) {
    const tools: { name: string; label: string; status: string; call_id: string; iteration: number }[] = [];
    const nTools = ri(3);
    for (let k = 0; k < nTools; k++) {
      tools.push({ name: `T${k}`, label: `T${k}: x`, status: 'done', call_id: `c${turn}-${it}-${k}`, iteration: it });
    }
    evs.push({
      type: 'iteration', turnID: turn, iter: it, phase: 'tool_exec',
      content: `a${turn}.${it}`, reasoning: `r${turn}.${it}`,
      activeTools: tools, completedTools: [], streamingTools: [], seq: ++seq,
    });
    if (rnd() < 0.5) {
      evs.push({
        type: 'iteration', turnID: turn, iter: it,
        activeTools: [], completedTools: tools, streamingTools: [],
        iterationsDelta: [{ iteration: it, content: `a${turn}.${it}`, reasoning: `r${turn}.${it}`, tools }], seq: ++seq,
      });
    } else {
      evs.push({
        type: 'phase_done', turnID: turn, phase: 'done',
        finalIteration: { iteration: it, content: `a${turn}.${it}`, reasoning: `r${turn}.${it}`, tools }, seq: ++seq,
      });
    }
  }
  const hist: HistIt[] = [];
  for (let it = 1; it <= iters; it++) hist.push({ iteration: it, content: `a${turn}.${it}`, tools: [] });
  evs.push({
    type: 'text_final', turnID: turn, content: `a${turn}.${iters}`,
    progressHistory: hist as never, cancelled: rnd() < 0.15, seq: ++seq,
  });
  return evs;
}

function toDomain(e: WireEvent): DomainEvent {
  const turn = e.turnID === undefined || e.turnID === null ? 0 : e.turnID;
  switch (e.type) {
    case 'turn_started':
      return { type: 'turn_started', turnID: turn as never, requestID: e.requestID ?? null, trigger: 'user', content: e.content ?? null } as unknown as DomainEvent;
    case 'iteration':
      return {
        type: 'iteration', turnID: turn as never, iter: (e.iter ?? 1) as never, seq: null,
        phase: e.phase, content: e.content, reasoning: e.reasoning,
        activeTools: (e.activeTools ?? []) as never, completedTools: (e.completedTools ?? []) as never,
        streamingTools: (e.streamingTools ?? []) as never,
        iterationsDelta: (e.iterationsDelta ?? []) as never,
        todos: undefined, goal: undefined,
      } as unknown as DomainEvent;
    case 'phase_done':
      return { type: 'phase_done', turnID: turn as never, phase: e.phase, finalIteration: (e.finalIteration ?? null) as never } as unknown as DomainEvent;
    case 'text_final':
      return {
        type: 'text_final', turnID: turn as never, content: e.content as never,
        progressHistory: (e.progressHistory ?? []) as never, cancelled: e.cancelled === true,
      } as unknown as DomainEvent;
    default:
      return { type: 'session', busy: false } as unknown as DomainEvent;
  }
}

function ids(tools: readonly { call_id?: string }[] | undefined): string {
  if (tools === undefined) return '';
  const out: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    const cid: string | undefined = tools[i].call_id;
    out.push(cid !== undefined ? cid : '');
  }
  return out.join(',');
}

function sigNew(rows: ChatRow[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const calls: string[] = [];
    for (let k = 0; k < r.iterations.length; k++) {
      calls.push(`${r.iterations[k].iteration}(${ids(r.iterations[k].tools)})`);
    }
    out.push(`${r.role}|${r.turnID}|${r.content.length}|${calls.join(';')}`);
  }
  return out;
}

function sigOld(rows: readonly Row[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'user') { out.push(`user|${r.turnID}|${r.content.length}|`); continue; }
    const its = (r.kind === 'committed' || r.kind === 'live' || r.kind === 'frozen') ? r.iterations : [];
    const calls: string[] = [];
    for (let k = 0; k < its.length; k++) {
      calls.push(`${its[k].iteration}(${ids((its[k] as { tools?: { call_id?: string }[] }).tools)})`);
    }
    // 回合级正文：旧行 `content` = 该 turn 的最终文本；新行同名字段（commit 后同源）
    const turnText: string = r.kind === 'committed' ? r.content : (r.kind === 'live' ? r.content : '');
    out.push(`assistant|${r.turnID}|${turnText.length}|${calls.join(';')}`);
  }
  return out;
}

let mismatches = 0;
let firstDetail = '';
for (let c = 0; c < 60; c++) {
  const chat = `chat_${c}`;
  const turns = 1 + ri(3);
  const all: WireEvent[] = [];
  let seq = 0;
  for (let t = 1; t <= turns; t++) {
    const evs = genTurn(t, seq);
    seq = (evs[evs.length - 1].seq as number);
    for (const e of evs) all.push(e);
  }
  let oldState: ChatState = initialChatState(chat);
  for (const e of all) oldState = reduce(oldState, toDomain(e));
  const oldSig = sigOld(deriveRows(oldState));
  let newState: State = emptyState(chat, 1, 0);
  for (const e of all) newState = stepAll(newState, adapt(e, chat, 1), 't').state;
  const newSig = sigNew(applyModel(newState, new Map<string, ChatRow>()));
  if (JSON.stringify(oldSig) !== JSON.stringify(newSig)) {
    mismatches++;
    if (firstDetail === '') firstDetail = `\n      old=${JSON.stringify(oldSig)}\n      new=${JSON.stringify(newSig)}`;
  }
}
ok('① 60 条随机会话：旧/新行结构逐条一致', mismatches === 0, `mismatches=${mismatches}${firstDetail}`);

console.log(`\nmodel_diff_prop: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
