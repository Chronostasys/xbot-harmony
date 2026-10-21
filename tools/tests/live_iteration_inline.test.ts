/**
 * live 迭代「同气泡内最后一个迭代块」模型测试 —— 真机 bug ①/② 的回归守卫。
 *
 * 用户原话（2026-10-10，真机）：
 *   ①「第二次发消息之后，每个迭代只有在 progressing 的时候显示，一旦迭代完成
 *     （commit）立刻消失，导致新 turn 永远只有 0-1 个迭代内容」
 *   ②「live 迭代是单独的气泡，这个也不对」
 *
 * 正确形态（逐字对齐 web `TurnBody`）：live 迭代是**该 turn 那条 assistant 消息
 * **内部的最后一个迭代块**，与已完成迭代在**同一个气泡**里。native 的 `ChatRow` 是一行
 * = 一条消息（一个气泡）⇒ 该行的 `iterations` 必须**含**在飞迭代块（末尾那块），
 * 由同一套块渲染器画出，只有最后那块带打字机/占位。
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据走 `deriveRows + applyRow`（已废弃），且依赖已删除的
 *   `core/integrate.ts:liveProgressFromState`。现走**新模型链路**
 *   （`model_harness.ModelFeed` = 生产 `model_bridge.stepEvent` + `applyModel`）：
 *   页面的打字机数据源就是该行 `iterations` 的末尾块（`Index.ets:10320-10341`），
 *   不再有"独立的 live 快照"对象。
 *
 * 断言：
 *  (a) 任意时刻该 turn 恰好一条 assistant 行，其 iterations 数**单调不减**；
 *  (b) 第 k 个迭代 commit 后它**仍在该行的 iterations 里**（不回退、不消失）；
 *  (c) **不存在**"独立 live 行/独立 live 气泡"—— 在飞内容由该行承载（最后一块）。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

const T2 = 2;

function iter(n: number, content: string, reasoning: string): Record<string, Object> {
  return { iteration: n, content, reasoning, tools: [] };
}
function streamEv(seq: number, iteration: number, content: string, reasoning: string): Record<string, Object> {
  return { type: 'stream', turnID: T2, seq, iter: iteration, content, reasoning };
}
/** 该行当前承载的迭代块（含末尾在飞块）。 */
function blocks(row: ChatRow): HistoryIteration[] {
  return row.iterations;
}
/** 该 turn 的 assistant 行 —— 断言**恰一条**（绝无第二条 live 行/独立气泡）。 */
function assistantRow(f: ModelFeed, label: string): ChatRow {
  const rows: ChatRow[] = f.rows();
  const found: ChatRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: ChatRow = rows[i];
    if (r.role === 'assistant' && r.turnID === T2) { found.push(r); }
  }
  expect(found.length, `${label}: 该 turn 恰一条 assistant 行（无独立 live 行/重复行）`).toBe(1);
  return found[0];
}

describe('live 迭代 = 同气泡内最后一个迭代块（真机 bug ①/②）', () => {
  it('3 迭代序列：iterations 单调不减 + commit 后不消失 + 在飞块在该行内', () => {
    const f = new ModelFeed('chat-1');
    let prevCount = 0;

    const check = (label: string): ChatRow => {
      const row = assistantRow(f, label);
      const n = blocks(row).length;
      expect(n >= prevCount, `${label}: iterations 数单调不减（${prevCount} → ${n}）`).toBe(true);
      prevCount = n;
      return row;
    };

    f.push({ type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null, seq: 1 });
    check('turn_started');

    // ── 迭代 1：在飞（stream）→ 完成（delta）──
    f.push(streamEv(2, 1, 'p1', 'r1'));
    const live1 = check('iter1 在飞');
    // (c) 在飞内容由**该行**承载（最后一块 = 在飞迭代），非独立行/独立气泡
    const b1 = blocks(live1);
    expect(b1.length > 0 && b1[b1.length - 1].iteration === 1, '在飞块是该行最后一个迭代块').toBe(true);
    expect(b1[b1.length - 1].content, '在飞块承载流式正文（同气泡）').toBe('p1');

    f.push({ type: 'iteration', turnID: T2, iter: 1, seq: 3, iterationsDelta: [iter(1, 'final-1', 'think-1')] });
    const rowAfter1 = check('iter1 commit');
    // (b) 迭代 1 commit 后仍在 iterations 里（不回退、不消失）
    const i1 = blocks(rowAfter1).find((x) => x.iteration === 1);
    expect(i1 !== undefined, '迭代 1 commit 后仍在该行 iterations').toBe(true);
    expect(i1 !== undefined ? i1.content : '', '迭代 1 内容保留 = final-1').toBe('final-1');

    // ── 迭代 2 ──
    f.push(streamEv(4, 2, 'p2', 'r2'));
    const live2 = check('iter2 在飞');
    const b2 = blocks(live2);
    expect(b2[b2.length - 1].iteration, '在飞块迭代号 = 2').toBe(2);
    expect(b2[b2.length - 1].content, '在飞块承载 iter2 流式正文').toBe('p2');
    expect(b2.find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在（累积）').toBe(true);

    f.push({ type: 'iteration', turnID: T2, iter: 2, seq: 5, iterationsDelta: [iter(2, 'final-2', 'think-2')] });
    const rowAfter2 = check('iter2 commit');
    const i2 = blocks(rowAfter2).find((x) => x.iteration === 2);
    expect(i2 !== undefined ? i2.content : '', '迭代 2 commit 后内容 = final-2').toBe('final-2');
    expect(blocks(rowAfter2).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);

    // ── 迭代 3 ──
    f.push(streamEv(6, 3, 'p3', 'r3'));
    const live3 = check('iter3 在飞');
    const b3 = blocks(live3);
    expect(b3[b3.length - 1].iteration, '在飞块迭代号 = 3').toBe(3);
    expect(b3[b3.length - 1].content, '在飞块承载 iter3 流式正文').toBe('p3');
    expect(blocks(live3).find((x) => x.iteration === 1) !== undefined, '迭代 1 仍在').toBe(true);
    expect(blocks(live3).find((x) => x.iteration === 2) !== undefined, '迭代 2 仍在').toBe(true);

    // ── 收尾 ──
    f.push({ type: 'phase_done', turnID: T2, seq: 7, finalIteration: iter(3, 'final-3', 'think-3') });
    check('phase_done');
    f.push({
      type: 'text_final', turnID: T2, content: 'FINAL', cancelled: false, seq: 8,
      progressHistory: [iter(1, 'final-1', 'think-1'), iter(2, 'final-2', 'think-2'), iter(3, 'final-3', 'think-3')],
    });
    const finalRow = check('text_final(committed)');
    // 提交后：3 个迭代全在（无洞、不消失）
    const nums = blocks(finalRow).map((x) => x.iteration).sort((a, b) => a - b);
    expect(nums.length, 'commit 后 3 个迭代全在').toBe(3);
    expect(nums[0]).toBe(1);
    expect(nums[1]).toBe(2);
    expect(nums[2]).toBe(3);
  });

  it('(c) 在飞内容只由该 turn 的 assistant 行承载 —— 无独立 live 行', () => {
    const f = new ModelFeed('chat-1');
    f.push({ type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null, seq: 1 });
    f.push(streamEv(2, 1, 'IN-FLIGHT', ''));

    // 数量：恰一条 assistant 行（不是"列表行 + 尾块"两条）
    const row = assistantRow(f, '在飞');
    // 该行承载在飞内容（同气泡）
    const has = blocks(row).some((x) => x.content === 'IN-FLIGHT');
    expect(has, '在飞正文由该 assistant 行承载（同气泡最后一个迭代块）').toBe(true);
    // 打字机数据源 = 该行末尾在飞块（页面 `syncLiveTail` 读同一处；旧 `liveProgressFromState` 已删）
    const its = blocks(row);
    const tail = its[its.length - 1];
    expect(tail !== undefined && tail.iteration === 1 && tail.content === 'IN-FLIGHT',
      '打字机读的末尾在飞块就是这条正文（同一数据源）').toBe(true);
  });
});

process.exit(summary('live_iteration_inline'));

export {};
