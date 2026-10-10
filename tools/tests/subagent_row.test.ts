/**
 * `subAgents` 落到**行模型**的回归守卫。
 *
 * 为什么需要：`components/SubAgentTree` 需要 `WebSubAgentProgress[]`（经
 * `core/subagent.flattenSubAgents` 展平）。此前它只存在于状态机
 * （`derive.ts` 的 `LiveRowView.subAgents` / `WebIteration.subAgents`），
 * 页面消费的渲染模型（`HistoryIteration` / `ChatRow`）**取不到** ⇒ 无法接线。
 * 本波把通路打通：状态机 → `core/render.ets`（`applyRow` / `toHistoryIteration`）
 * → 行模型（`ChatRow.subAgents` / `HistoryIteration.subAgents`）。
 *
 * 本测试**喂真实事件序列**（`turn_started → iteration → text_final`）断言：
 *  (a) live 行：状态机的 live subAgents 落到 `ChatRow.subAgents`；
 *  (b) 已提交行：迭代自带的 subAgents 落到 `HistoryIteration.subAgents`；
 *  (c) **零回归**：无 SubAgent 的迭代**不新增** `subAgents` 键（既有行形状不变）；
 *  (d) subAgents 变化必须让 `applyRow` 判"行变了"（否则树冻结在首帧）。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { deriveRows, type CommittedRowView, type FrozenRowView, type LiveRowView } from '../../entry/src/main/ets/core/derive';
import { applyRow } from '../../entry/src/main/ets/core/render';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID, eventSeq,
} from '../../entry/src/main/ets/core/chat_types_full';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import type { WebIteration, WebSubAgentProgress } from '../../entry/src/main/ets/core/chattypes';

type ARow = LiveRowView | FrozenRowView | CommittedRowView;

const T2 = turnID(2);

/** 一个 SubAgent 节点（对齐 protocol.SubAgentInfo 的客户端形状）。 */
function sa(role: string, status: string, desc: string): WebSubAgentProgress {
  const n: WebSubAgentProgress = { role, status, desc, children: [] };
  return n;
}

/** 一个带 SubAgent 树的迭代（提交用）。 */
function iterWithSubs(n: number, content: string, subs: WebSubAgentProgress[]): WebIteration {
  return { iteration: n, content, reasoning: '', tools: [], toolCount: 0, subAgents: subs };
}

/** 无 SubAgent 的普通迭代。 */
function iterPlain(n: number, content: string): WebIteration {
  return { iteration: n, content, reasoning: '', tools: [], toolCount: 0 };
}

/** turn 2 的 assistant 派生行（恰一条）。 */
function assistantRow(s: ChatState): ARow {
  const rows = deriveRows(s);
  const found: ARow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind !== 'user' && r.turnID === 2) {
      found.push(r);
    }
  }
  expect(found.length, '该 turn 恰一条 assistant 行').toBe(1);
  return found[0];
}

/** 把派生行适配到 `ChatRow`（就地更新）。 */
function toRow(s: ChatState): ChatRow {
  const r: ARow = assistantRow(s);
  const row = new ChatRow();
  row.id = r.id;
  applyRow(row, r);
  return row;
}

/** 一个"流式迭代"事件（无 subAgents）。 */
function streamEv(seq: number, iteration: number, content: string): DomainEvent {
  return {
    type: 'stream', turnID: T2, seq: eventSeq(seq), iteration: iterNum(iteration),
    content, reasoning: '', streamingTools: undefined, genui: undefined, streamStats: undefined,
  };
}

describe('subAgents 落到行模型（SubAgentTree 接线前置）', () => {
  it('(a) live 行：状态机 live subAgents → ChatRow.subAgents', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    // 一次流式（让 live 行有内容）+ 一次结构化迭代事件携带 subAgents
    s = reduce(s, streamEv(2, 1, 'p1'));
    const subs: WebSubAgentProgress[] = [sa('explore', 'running', '找东西')];
    s = reduce(s, {
      type: 'iteration', turnID: T2, iter: iterNum(1), seq: eventSeq(3),
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [], todos: undefined, subAgents: subs, tokenUsage: undefined, streamStats: undefined,
    });

    const r: ARow = assistantRow(s);
    expect(r.kind, '该行是 live 行').toBe('live');

    const row: ChatRow = toRow(s);
    expect(row.subAgents.length, 'live 行的 subAgents 长度').toBe(1);
    expect(row.subAgents[0].role, 'subAgents[0].role').toBe('explore');
    expect(row.subAgents[0].status, 'subAgents[0].status').toBe('running');
    expect(row.subAgents[0].desc, 'subAgents[0].desc').toBe('找东西');
  });

  it('(b) 已提交行：迭代自带 subAgents → HistoryIteration.subAgents', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    s = reduce(s, streamEv(2, 1, 'p1'));
    s = reduce(s, {
      type: 'phase_done', turnID: T2, seq: eventSeq(3),
      finalIteration: iterWithSubs(1, 'final-1', [sa('plan', 'done', '规划')]), todos: undefined,
    });
    s = reduce(s, {
      type: 'text_final', turnID: T2, content: 'FINAL' as never,
      progressHistory: [iterWithSubs(1, 'final-1', [sa('plan', 'done', '规划')])], cancelled: false,
    });

    const r: ARow = assistantRow(s);
    expect(r.kind, '该行是已提交行').toBe('committed');

    const row: ChatRow = toRow(s);
    expect(row.subAgents.length, '已提交行级 subAgents 清空（树在迭代上）').toBe(0);
    const it: HistoryIteration | undefined = row.iterations.find((x) => x.iteration === 1);
    expect(it !== undefined, '迭代 1 在行上').toBe(true);
    const its: WebSubAgentProgress[] | undefined = it !== undefined ? it.subAgents : undefined;
    expect(its !== undefined, '迭代 1 带回 subAgents（新增字段）').toBe(true);
    expect(its !== undefined ? its.length : 0, 'subAgents 长度').toBe(1);
    expect(its !== undefined ? its[0].role : '', 'subAgents[0].role').toBe('plan');
  });

  it('(c) 零回归：无 SubAgent 的迭代**不新增** subAgents 键', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    s = reduce(s, streamEv(2, 1, 'p1'));
    s = reduce(s, {
      type: 'phase_done', turnID: T2, seq: eventSeq(3),
      finalIteration: iterPlain(1, 'final-1'), todos: undefined,
    });
    s = reduce(s, {
      type: 'text_final', turnID: T2, content: 'FINAL' as never,
      progressHistory: [iterPlain(1, 'final-1')], cancelled: false,
    });

    const row: ChatRow = toRow(s);
    const it: HistoryIteration | undefined = row.iterations.find((x) => x.iteration === 1);
    expect(it !== undefined, '迭代 1 在行上').toBe(true);
    expect(it !== undefined && it.subAgents === undefined,
      '无 SubAgent 的迭代：subAgents 键**不存在**（既有行形状不变）').toBe(true);
    expect(row.subAgents.length, '非 live 行级 subAgents 恒为空数组').toBe(0);
  });

  it('(d) subAgents 变化 ⇒ applyRow 判"行变了"（树不冻结在首帧）', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T2, requestID: 'r2', trigger: 'user', content: null });
    s = reduce(s, streamEv(2, 1, 'p1'));
    s = reduce(s, {
      type: 'iteration', turnID: T2, iter: iterNum(1), seq: eventSeq(3),
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [], todos: undefined, subAgents: [sa('explore', 'running', 'a')],
      tokenUsage: undefined, streamStats: undefined,
    });

    const row = new ChatRow();
    row.id = assistantRow(s).id;
    const changed1: boolean = applyRow(row, assistantRow(s));
    expect(changed1, '首次落行=有变化').toBe(true);
    const same: boolean = applyRow(row, assistantRow(s));
    expect(same, '同一状态重复落行=无变化（签名去重）').toBe(false);

    // 树变化（多一个子代理）⇒ 必须判"变了"
    s = reduce(s, {
      type: 'iteration', turnID: T2, iter: iterNum(1), seq: eventSeq(4),
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [],
      todos: undefined, subAgents: [sa('explore', 'running', 'a'), sa('qa', 'pending', 'b')],
      tokenUsage: undefined, streamStats: undefined,
    });
    const changed2: boolean = applyRow(row, assistantRow(s));
    expect(changed2, 'subAgents 变化 ⇒ 行重建（否则树冻结）').toBe(true);
    expect(row.subAgents.length, '变化后的 subAgents 长度').toBe(2);
  });
});

process.exit(summary('subagent_row'));
