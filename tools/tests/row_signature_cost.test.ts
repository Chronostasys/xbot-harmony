/**
 * row_signature_cost.test.ts —— `rowSignature` / `applyRow` / `rebuildRows` 的**逐事件开销**
 * 判别力判据（用户亲报 `appfreeze THREAD_BLOCK_6S` 的取证后续，2026-10-11）。
 *
 * ── 为什么量的是"每事件**拷贝了几行**"而不是"耗时"──────────────────────────────
 * 耗时只能真机测（且噪声大、离线不可复现）。但本链路的**复杂度**有一个**可离线观测**的
 * 代理量：`applyRow` 的**早退**（`if (row.signature === sig) return false;`）——
 *   · 有早退 ⇒ 未变行**零拷贝**（只付一次 `rowSignature`）；一条流式 token 只改**1** 行
 *     ⇒ 每事件拷贝行数 == 1（**O(1)**，与行数 R 无关）。
 *   · 早退被拿掉 ⇒ 每事件**每行**都重拷 iterations/subAgents/compactions ⇒ 拷贝行数 == R
 *     ⇒ **O(R)** 且每行都是新数组（GC + ArkUI 全量 diff 的温床）。
 * ⇒ 判据：**一条 live 流式事件导致的"变化行数"必须恒为 1（不随总行数增长）**。
 *   判别力（mutation）：把早退拿掉 ⇒ 变化行数 == R ⇒ 必红（见文末 §C）。
 *
 * ── 与 `store.rebuildRows` 的关系（为什么不直接 new ChatStore）──────────────────
 * `rebuildRows` 是 private，且构造真 store 需要 mock HTTP/SSE。本文件**逐行复刻**它的循环
 * （`deriveRows` → 逐行 `rowCache` → `applyRow` → 收集 changed），消费的**全部是生产函数**
 * （`deriveRows` / `applyRow` 均为导出的生产实现）。⚠️ 复刻的是**循环形状**，被测量的是**真函数**。
 */
declare const process: { exit: (c: number) => void };

import { reduce } from '../../entry/src/main/ets/core/reduce';
import { deriveRows } from '../../entry/src/main/ets/core/derive';
import { applyRow } from '../../entry/src/main/ets/core/render';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow } from '../../entry/src/main/ets/core/types';
import type { WebIteration } from '../../entry/src/main/ets/core/chattypes';
import type { Row } from '../../entry/src/main/ets/core/derive';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

function iter(n: number, content: string, reasoning: string): WebIteration {
  return { iteration: n, content, reasoning, tools: [], toolCount: 0 };
}

/** 带守卫的 `reduce`（未处理的事件类型会让状态机返回 undefined ⇒ 显式炸出来，别静默）。 */
function rd(s: ChatState, e: DomainEvent): ChatState {
  const next: ChatState = reduce(s, e);
  if (next === undefined || next === null) {
    throw new Error(`reduce 对 type=${e.type} 返回 undefined（状态机缺该 case？）`);
  }
  return next;
}

/** 一个已提交的 turn（3 迭代）：turn_started → stream → iteration(commit) → phase_done → text_final。 */
function committedTurn(n: number, seqBase: number): DomainEvent[] {
  const T = turnID(n);
  const evs: DomainEvent[] = [
    { type: 'turn_started', turnID: T, requestID: `r${n}`, trigger: 'user', content: null },
  ];
  for (let k = 1; k <= 3; k++) {
    evs.push({
      type: 'stream', turnID: T, seq: eventSeq(seqBase + k * 2), iteration: iterNum(k),
      content: `p${k}`, reasoning: `r${k}`, streamingTools: undefined, genui: undefined, streamStats: undefined,
    } as DomainEvent);
    evs.push({
      type: 'iteration', turnID: T, iter: iterNum(k), seq: eventSeq(seqBase + k * 2 + 1),
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [iter(k, `final-${k}`, `think-${k}`)],
      todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    } as DomainEvent);
  }
  evs.push({ type: 'phase_done', turnID: T, seq: eventSeq(seqBase + 10), finalIteration: iter(3, 'final-3', 'think-3'), todos: undefined } as DomainEvent);
  evs.push({
    type: 'text_final', turnID: T, content: 'FINAL' as never,
    progressHistory: [iter(1, 'final-1', 'think-1'), iter(2, 'final-2', 'think-2'), iter(3, 'final-3', 'think-3')],
    cancelled: false,
  } as DomainEvent);
  return evs;
}

/** 复刻 `store.rebuildRows` 的循环形状（消费生产函数）。返回本轮**变化行数**。 */
class RowBuilder {
  cache: Map<string, ChatRow> = new Map<string, ChatRow>();
  rebuild(s: ChatState): number {
    const derived: readonly Row[] = deriveRows(s);
    let changed: number = 0;
    for (let i = 0; i < derived.length; i++) {
      const r: Row = derived[i];
      let row: ChatRow | undefined = this.cache.get(r.id);
      if (row === undefined) {
        row = new ChatRow();
        row.id = r.id;
        this.cache.set(r.id, row);
      }
      if (applyRow(row, r)) { changed += 1; }
    }
    return changed;
  }
}

/** 建 n 个已提交 turn 的 state。 */
function stateWithTurns(n: number): ChatState {
  let s: ChatState = initialChatState('chat-1');
  for (let i = 1; i <= n; i++) {
    for (const e of committedTurn(i, i * 100)) {
      const next: ChatState = reduce(s, e);
      if (next === undefined || next === null) {
        throw new Error(`reduce 返回 undefined：type=${e.type} turn=${i}`);
      }
      s = next;
    }
  }
  return s;
}

console.log('\n▶ §A 基线与规模：一条 live 流式事件的变化行数必须恒为 1');
const results: { turns: number; rows: number; changedLive: number; changedIdle: number }[] = [];
for (const turns of [4, 8, 16, 32, 64]) {
  const s0: ChatState = stateWithTurns(turns);
  const b = new RowBuilder();
  b.rebuild(s0);                                    // 建缓存（首批全 "变化"）
  const s1: ChatState = rd(s0, {
    type: 'turn_started', turnID: turnID(turns + 1), requestID: 'rl', trigger: 'user', content: null,
  } as DomainEvent);
  b.rebuild(s1);
  // 一条 live 流式事件（只改 live 行的正文）
  const s2: ChatState = rd(s1, {
    type: 'stream', turnID: turnID(turns + 1), seq: eventSeq(999999), iteration: iterNum(1),
    content: 'tok', reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as DomainEvent);
  const changedLive: number = b.rebuild(s2);
  // 一条**重复同一内容**的流式帧（服务端重传/合并 ⇒ 签名不变 ⇒ 不应改任何行）
  const s3: ChatState = rd(s2, {
    type: 'stream', turnID: turnID(turns + 1), seq: eventSeq(999999), iteration: iterNum(1),
    content: 'tok', reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  } as DomainEvent);
  const changedIdle: number = b.rebuild(s3);
  const rows: number = deriveRows(s0).length;
  results.push({ turns, rows, changedLive, changedIdle });
  console.log(`   turns=${turns} rows=${rows}  变化行数(流式)=${changedLive}  变化行数(无关事件)=${changedIdle}`);
}
ok('流式事件的变化行数恒为 1（不随行数增长 ⇒ applyRow 早退生效）',
  results.every((r) => r.changedLive === 1));
ok('与内容无关的事件不改任何行（changed === 0）',
  results.every((r) => r.changedIdle === 0));
ok('总行数随 turn 数增长（证明规模真的变了，不是"扫了 0 行"的假绿）',
  results[0].rows < results[results.length - 1].rows);

console.log('\n▶ §B 线性度：每事件的变化行数不得超线性（对比"行数"本身）');
const worst = results.reduce((a, b) => (b.changedLive > a.changedLive ? b : a));
ok(`最坏情形变化行数 ${worst.changedLive} ≤ 1（与 rows=${worst.rows} 无关）`, worst.changedLive <= 1);

console.log('\n▶ §C mutation 自证（由外部脚本注入）：判据见本文件头 —— 去掉 `applyRow` 早退 ⇒ 变化行数 == rows');

console.log('\n▼ 摘要');
console.log(`  规模档：${results.map((r) => `T${r.turns}/R${r.rows}`).join(' → ')}`);
console.log(`  流式事件变化行数：${results.map((r) => r.changedLive).join(', ')}（全部必须为 1）`);
console.log('  结论：每事件工作量 = O(行数) 的**签名比较** + O(1) 的**行拷贝**（早退生效）。');

if (fail > 0) {
  console.log(`\n  row_signature_cost: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  row_signature_cost: ${pass} passed, 0 failed`);
process.exit(0);

export {};
