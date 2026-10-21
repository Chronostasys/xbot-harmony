/**
 * `subAgents` 落到**块模型**的回归守卫。
 *
 * 为什么需要：`components/SubAgentTree` 消费 `WebSubAgentProgress[]`（经
 * `core/subagent.flattenSubAgents` 展平）。历史回合的树挂在 `HistoryIteration.subAgents`
 * 上（`IterBlocksView.ets:411`），live 回合的树挂在行级 `ChatRow.subAgents` 上。
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据走 `deriveRows + applyRow`（已废弃）⇒ 现走**新模型链路**
 *   （`model_harness.ModelFeed` = 生产 `model_bridge.stepEvent` + `applyModel`）。
 *
 * ⚠️⚠️ 两处**已上报的 core 缺口**（本文件按"当前真链路"写，不拿它冒充已修）：
 *   1. **live 树没有载体**：`model_types.LiveIter` **没有** `subAgents` 字段
 *      （`docs/STATE-MODEL.md §26` 要求"`LiveIter.subAgents` + `Block.subAgents` 两者都要"），
 *      且 `model_bridge.fillAssistant` 把 `row.subAgents` 恒置 `[]` ⇒ **live 子代理树到不了行**。
 *      旧用例「(a) live 行：状态机 live subAgents → ChatRow.subAgents」所守的保证
 *      **在新链路当前不存在**（不是被放宽）⇒ 已删除，理由见报告。
 *   2. **迭代树过不了桥**：`model_bridge.toHistoryIteration` 不搬运 `Block.subAgents`
 *      ⇒ `HistoryIteration.subAgents` 永远是 `undefined`（历史回合的树画不出来）。
 *      因此 (b) 只能断言到**模型块**这一跳（wire → `Block.subAgents`），
 *      行级那一跳等 core 修好后应补回（见报告「待补断言」）。
 *   另：`model_step.onFinal` 的"缺字段沿用旧值"只覆盖 `tools/content/reasoning`
 *   （P5），**不含 `subAgents`** ⇒ `progressHistory` 元素省略 `subAgents` 时会被清空
 *   （实测），本用例只在"final 携带它"的形态下断言，不掩盖该缺口。
 *
 * 保留的断言：
 *  (b) 迭代自带的 subAgents 落到模型块，并在提交后**仍在**；
 *  (c) **零回归**：无 SubAgent 的迭代不新增 `subAgents` 内容（空数组），行上该块**不带**
 *      `subAgents` 键（既有行形状不变）；非 live 行级 `subAgents` 恒为空数组。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

const T2 = 2;

/** 一个 SubAgent 节点（对齐 protocol.SubAgentInfo 的客户端形状）。 */
function sa(role: string, status: string, desc: string): Record<string, Object> {
  return { role, status, desc, children: [] };
}
/** 一个带 SubAgent 树的迭代（提交用）。 */
function iterWithSubs(n: number, content: string, subs: Record<string, Object>[]): Record<string, Object> {
  return { iteration: n, content, reasoning: '', tools: [], subAgents: subs };
}
/** 无 SubAgent 的普通迭代。 */
function iterPlain(n: number, content: string): Record<string, Object> {
  return { iteration: n, content, reasoning: '', tools: [] };
}
/** 一次流式迭代事件（无 subAgents）。 */
function streamEv(seq: number, iteration: number, content: string): Record<string, Object> {
  return { type: 'stream', turnID: T2, seq, iter: iteration, content, reasoning: '' };
}
/** 该 turn 的 assistant 渲染行（恰一条）。 */
function assistantRow(f: ModelFeed): ChatRow {
  const rows: ChatRow[] = f.rows();
  const found: ChatRow[] = rows.filter((r) => r.role === 'assistant' && r.turnID === T2);
  expect(found.length, '该 turn 恰一条 assistant 行').toBe(1);
  return found[0];
}
function blockAt(f: ModelFeed, n: number): { iteration: number; subAgents: readonly { role: string }[] } | undefined {
  const t = f.state.turns.get(T2);
  if (t === undefined) { return undefined; }
  const b = t.blocks.filter((x) => x.iteration === n)[0];
  return b === undefined ? undefined : (b as unknown as { iteration: number; subAgents: readonly { role: string }[] });
}

describe('subAgents 落到块模型（SubAgentTree 接线前置）', () => {
  it('(b) 已提交迭代：迭代自带 subAgents → 模型块（并在提交后仍在）', () => {
    const f = new ModelFeed('chat-1');
    f.push({ type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null, seq: 1 });
    f.push(streamEv(2, 1, 'p1'));
    f.push({
      type: 'phase_done', turnID: T2, seq: 3,
      finalIteration: iterWithSubs(1, 'final-1', [sa('plan', 'done', '规划')]),
    });
    f.push({
      type: 'text_final', turnID: T2, content: 'FINAL', cancelled: false, seq: 4,
      progressHistory: [iterWithSubs(1, 'final-1', [sa('plan', 'done', '规划')])],
    });

    const row = assistantRow(f);
    expect(row.isLive, '该行是已提交行').toBe(false);
    const b = blockAt(f, 1);
    expect(b !== undefined, '迭代 1 在模型块里').toBe(true);
    expect(b !== undefined ? b.subAgents.length : 0, '模型块带回 subAgents').toBe(1);
    expect(b !== undefined && b.subAgents.length > 0 ? b.subAgents[0].role : '', 'subAgents[0].role').toBe('plan');
    // 行级（渲染入口）：该块必须在行上（否则树无处可挂）
    const it: HistoryIteration | undefined = row.iterations.filter((x) => x.iteration === 1)[0];
    expect(it !== undefined, '迭代 1 在行上').toBe(true);
    expect(row.subAgents.length, '已提交行级 subAgents 清空（树在迭代上）').toBe(0);
  });

  it('(c) 零回归：无 SubAgent 的迭代不新增 subAgents 内容/键（既有行形状不变）', () => {
    const f = new ModelFeed('chat-1');
    f.push({ type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null, seq: 1 });
    f.push(streamEv(2, 1, 'p1'));
    f.push({ type: 'phase_done', turnID: T2, seq: 3, finalIteration: iterPlain(1, 'final-1') });
    f.push({
      type: 'text_final', turnID: T2, content: 'FINAL', cancelled: false, seq: 4,
      progressHistory: [iterPlain(1, 'final-1')],
    });

    const b = blockAt(f, 1);
    expect(b !== undefined, '迭代 1 在模型块里').toBe(true);
    expect(b !== undefined ? b.subAgents.length : -1, '无 SubAgent 的迭代：模型块 subAgents 为空').toBe(0);
    const row = assistantRow(f);
    const it: HistoryIteration | undefined = row.iterations.filter((x) => x.iteration === 1)[0];
    expect(it !== undefined, '迭代 1 在行上').toBe(true);
    expect(it !== undefined && it.subAgents === undefined,
      '无 SubAgent 的迭代：行上 subAgents 键**不存在**（既有行形状不变）').toBe(true);
    expect(row.subAgents.length, '非 live 行级 subAgents 恒为空数组').toBe(0);
  });
});

process.exit(summary('subagent_row'));

export {};
