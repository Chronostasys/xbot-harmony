/**
 * live 迭代「同气泡内最后一个迭代块」模型测试 —— 真机 bug ①/② 的回归守卫。
 *
 * 用户原话（2026-10-10，真机）：
 *   ①「第二次发消息之后，每个迭代只有在 progressing 的时候显示，一旦迭代完成
 *     （commit）立刻消失，导致新 turn 永远只有 0-1 个迭代内容」
 *   ②「live 迭代是单独的气泡，这个也不对」
 *
 * 正确形态（逐字对齐 web `TurnBody`）：live 迭代是**该 turn 那条 assistant 消息
 * **内部的最后一个迭代块**，与已完成迭代在**同一个气泡**里（`LiveIteration` 就是
 * TurnBody 里 `iterations` 之后追加的那一块）。native 的 `ChatRow` 是一行 = 一条
 * 消息（一个气泡）⇒ 该行的 `iterations` 必须**含**在飞迭代块（`live: true`），
 * 由同一套块渲染器画出，只有最后那块带打字机/占位。
 *
 * 本测试驱动一条含 **3 个迭代**的真实事件序列（turn_started → iteration×3 →
 * phase_done → text_final，中间 stream_content 推进），断言：
 *  (a) 任意时刻该 turn 恰好一条 assistant 行，其 iterations 数**单调不减**；
 *  (b) 第 k 个迭代 commit 后它**仍在该行的 iterations 里**（不回退、不消失）；
 *  (c) **不存在**"独立 live 行/独立 live 气泡"—— 在飞内容由该行承载（最后一块）。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { deriveRows, type CommittedRowView, type FrozenRowView, type LiveRowView } from './derive';
import { applyRow } from './render';
import { liveProgressFromState } from './integrate';
import { reduce } from './reduce';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from './chat_types_full';
import { ChatRow, HistoryIteration } from './types';
import type { WebIteration } from './chattypes';

type ARow = LiveRowView | FrozenRowView | CommittedRowView;

const T2 = turnID(2);

function iter(n: number, content: string, reasoning: string): WebIteration {
  return { iteration: n, content, reasoning, tools: [], toolCount: 0 };
}

/** 该行当前承载的迭代块（含在飞块）。 */
function blocks(row: ChatRow): HistoryIteration[] {
  return row.iterations;
}

/**
 * 派生 + 就地适配（模拟 `store.rebuildRows` 的对象恒等缓存）：
 * 断言该 turn **恰一条** assistant 渲染行（绝无第二条 live 行）。
 */
class TurnRender {
  cache: Map<string, ChatRow> = new Map<string, ChatRow>();

  rowOf(s: ChatState): ChatRow {
    const rows = deriveRows(s);
    const assistants: ARow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind !== 'user' && r.turnID === 2) {
        assistants.push(r);
      }
      let row = this.cache.get(r.id);
      if (row === undefined) {
        row = new ChatRow();
        row.id = r.id;
        this.cache.set(r.id, row);
      }
      applyRow(row, r);
    }
    expect(assistants.length, '该 turn 恰一条 assistant 行（无独立 live 行/重复行）').toBe(1);
    return this.cache.get(assistants[0].id) as ChatRow;
  }
}

describe('live 迭代 = 同气泡内最后一个迭代块（真机 bug ①/②）', () => {
  it('3 迭代序列：iterations 单调不减 + commit 后不消失 + 在飞块在该行内', () => {
    let s: ChatState = initialChatState('chat-1');
    const tr = new TurnRender();
    let prevCount = 0;

    const check = (label: string): ChatRow => {
      const row = tr.rowOf(s);
      const n = blocks(row).length;
      expect(n >= prevCount, `${label}: iterations 数单调不减（${prevCount} → ${n}）`).toBe(true);
      prevCount = n;
      return row;
    };

    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    check('turn_started');

    // ── 迭代 1：在飞（stream）→ 完成（delta）──
    s = reduce(s, { type: 'stream', turnID: T2, seq: eventSeq(2), iteration: iterNum(1), content: 'p1', reasoning: 'r1', streamingTools: undefined, genui: undefined, streamStats: undefined });
    const live1 = check('iter1 在飞');
    // (c) 在飞内容由**该行**承载（最后一块 = 在飞迭代），非独立行/独立气泡
    const b1 = blocks(live1);
    expect(b1.length > 0 && b1[b1.length - 1].iteration === 1, '在飞块是该行最后一个迭代块').toBe(true);
    expect(b1[b1.length - 1].content, '在飞块承载流式正文（同气泡）').toBe('p1');

    s = reduce(s, { type: 'iteration', turnID: T2, iter: iterNum(1), seq: eventSeq(3), content: undefined, reasoning: undefined, activeTools: [], completedTools: [], iterationsDelta: [iter(1, 'final-1', 'think-1')], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined });
    const rowAfter1 = check('iter1 commit');
    // (b) 迭代 1 commit 后仍在 iterations 里（不回退、不消失）
    const i1 = blocks(rowAfter1).find((x) => x.iteration === 1);
    expect(i1 !== undefined, '迭代 1 commit 后仍在该行 iterations').toBe(true);
    expect(i1 !== undefined ? i1.content : '', '迭代 1 内容保留 = final-1').toBe('final-1');

    // ── 迭代 2 ──
    s = reduce(s, { type: 'stream', turnID: T2, seq: eventSeq(4), iteration: iterNum(2), content: 'p2', reasoning: 'r2', streamingTools: undefined, genui: undefined, streamStats: undefined });
    const live2 = check('iter2 在飞');
    const b2 = blocks(live2);
    expect(b2[b2.length - 1].iteration, '在飞块迭代号 = 2').toBe(2);
    expect(b2[b2.length - 1].content, '在飞块承载 iter2 流式正文').toBe('p2');
    expect(b2.find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在（累积）').toBe(true);

    s = reduce(s, { type: 'iteration', turnID: T2, iter: iterNum(2), seq: eventSeq(5), content: undefined, reasoning: undefined, activeTools: [], completedTools: [], iterationsDelta: [iter(2, 'final-2', 'think-2')], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined });
    const rowAfter2 = check('iter2 commit');
    const i2 = blocks(rowAfter2).find((x) => x.iteration === 2);
    expect(i2 !== undefined ? i2.content : '', '迭代 2 commit 后内容 = final-2').toBe('final-2');
    expect(blocks(rowAfter2).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);

    // ── 迭代 3 ──
    s = reduce(s, { type: 'stream', turnID: T2, seq: eventSeq(6), iteration: iterNum(3), content: 'p3', reasoning: 'r3', streamingTools: undefined, genui: undefined, streamStats: undefined });
    const live3 = check('iter3 在飞');
    const b3 = blocks(live3);
    expect(b3[b3.length - 1].iteration, '在飞块迭代号 = 3').toBe(3);
    expect(b3[b3.length - 1].content, '在飞块承载 iter3 流式正文').toBe('p3');
    expect(blocks(live3).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);
    expect(blocks(live3).find((x) => x.iteration === 2) !== undefined, '迭代 2 仍在').toBe(true);

    // ── 收尾 ──
    s = reduce(s, { type: 'phase_done', turnID: T2, seq: eventSeq(7), finalIteration: iter(3, 'final-3', 'think-3'), todos: undefined });
    check('phase_done');
    s = reduce(s, { type: 'text_final', turnID: T2, content: 'FINAL' as never, progressHistory: [iter(1, 'final-1', 'think-1'), iter(2, 'final-2', 'think-2'), iter(3, 'final-3', 'think-3')], cancelled: false });
    const finalRow = check('text_final(committed)');
    // 提交后：3 个迭代全在（无洞、不消失）
    const nums = blocks(finalRow).map((x) => x.iteration).sort((a, b) => a - b);
    expect(nums.length, 'commit 后 3 个迭代全在').toBe(3);
    expect(nums[0]).toBe(1);
    expect(nums[1]).toBe(2);
    expect(nums[2]).toBe(3);
  });

  it('(c) 在飞内容只由该 turn 的 assistant 行承载 —— 无独立 live 行', () => {
    let s: ChatState = initialChatState('chat-1');
    const tr = new TurnRender();
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    s = reduce(s, { type: 'stream', turnID: T2, seq: eventSeq(2), iteration: iterNum(1), content: 'IN-FLIGHT', reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined });

    const rows = deriveRows(s);
    const assistants: ARow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind !== 'user' && r.turnID === 2) {
        assistants.push(r);
      }
    }
    // 数量：恰一条 assistant 行（不是"列表行 + 尾块"两条）
    expect(assistants.length, '该 turn 只有一条 assistant 行（无独立 live 行）').toBe(1);
    // 该行承载在飞内容（同气泡）
    const row = tr.rowOf(s);
    const has = blocks(row).some((x) => x.content === 'IN-FLIGHT');
    expect(has, '在飞正文由该 assistant 行承载（同气泡最后一个迭代块）').toBe(true);
    // 尾块快照与行内块是**同一份内容**（不是第二个气泡的独立内容源）
    const snap = liveProgressFromState(s);
    expect(snap.streamContent, '在飞快照仍是同一状态机导出（供打字机）').toBe('IN-FLIGHT');
  });
});

process.exit(summary('live_iteration_inline'));
