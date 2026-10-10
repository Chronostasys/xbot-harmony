/**
 * live 行渲染模型测试 —— 真机 bug1「一个 running turn 被渲染两遍」的回归守卫。
 *
 * 模型（逐字对齐 web）：live 行的 `iterations` **只含已完成迭代**；在飞内容
 * （content/reasoning/activeTools/streamingTools）是**独立字段**，由列表尾的
 * LiveTailView（读 `liveProgressFromState`）渲染 —— 二者**天然不重叠**，
 * 因此同一内容绝不会被画两遍、也绝不会"每个迭代完成就消失"。
 *
 * 旧模型（已删）：live 行最后一个迭代 = 在飞迭代，列表跳过它、尾块渲染它 ⇒
 * 需要 `tailOwnedIteration` 判据做互斥，稍有不一致就重复/丢失。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { deriveRows } from './derive';
import { liveProgressFromState } from './integrate';
import { reduce } from './reduce';
import {
  ChatState, DomainEvent, initialChatState, iterNum, turnID,
} from './chat_types_full';
import type { WebIteration } from './chattypes';

const T1 = turnID(1);

function iterDelta(n: number, content: string): WebIteration {
  return { iteration: n, content, reasoning: '', tools: [], toolCount: 0 };
}

describe('live 行：已完成迭代在列表、在飞快照在尾块（互不重叠）', () => {
  it('在飞内容绝不进 iterations（否则与尾块重复渲染）', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null });
    // 迭代 1 完成（delta 进 iteration_history）
    s = reduce(s, {
      type: 'iteration', turnID: T1, iter: iterNum(1), seq: null as never,
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [iterDelta(1, 'iter-1-final')], todos: undefined,
      subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    });
    // 迭代 2 在飞（流式正文，尚未完成）
    s = reduce(s, {
      type: 'stream', turnID: T1, seq: null as never, iteration: iterNum(2),
      content: 'in-flight-text', reasoning: 'in-flight-reasoning', streamingTools: undefined,
      genui: undefined, streamStats: undefined,
    });

    // ① 派生行：live 行的 iterations 只有已完成的迭代 1
    const rows = deriveRows(s);
    const live = rows.find((r) => r.kind === 'live');
    expect(live, '必须有一行 live').toBeTruthy();
    if (live !== undefined && live.kind === 'live') {
      expect(live.iterations.length, 'iterations 只含已完成迭代').toBe(1);
      expect(live.iterations[0].iteration, '已完成迭代号 = 1').toBe(1);
      expect(live.iterations[0].content, '已完成迭代内容 = iter-1-final').toBe('iter-1-final');
      // 在飞内容在 live 行的独立字段上，绝不在 iterations 里
      expect(live.content, '在飞正文在 live 行 content 字段').toBe('in-flight-text');
      expect(live.reasoning, '在飞思考在 live 行 reasoning 字段').toBe('in-flight-reasoning');
      for (let i = 0; i < live.iterations.length; i++) {
        expect(live.iterations[i].content, '没有任何迭代携带在飞文本').not.toContain('in-flight');
      }
    }

    // ② 尾块快照：liveProgressFromState 输出在飞内容（尾块渲染这一份）
    const snap = liveProgressFromState(s);
    expect(snap.streamContent, '尾块快照的 streamContent = 在飞正文').toBe('in-flight-text');
    expect(snap.reasoningStreamContent, '尾块快照的思考 = 在飞思考').toBe('in-flight-reasoning');
    expect(snap.iterationHistory.length, '快照 iterationHistory = 已完成迭代数').toBe(1);
  });

  it('迭代完成（delta 到达）后：已完成内容进 iterations', () => {
    let s: ChatState = initialChatState('chat-1');
    s = reduce(s, { type: 'turn_started', turnID: T1, requestID: null, trigger: 'user', content: null });
    s = reduce(s, {
      type: 'iteration', turnID: T1, iter: iterNum(1), seq: null as never,
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
      iterationsDelta: [iterDelta(1, 'final-1')], todos: undefined,
      subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    });
    const rows = deriveRows(s);
    const live = rows.find((r) => r.kind === 'live');
    if (live !== undefined && live.kind === 'live') {
      expect(live.iterations.length).toBe(1);
      expect(live.iterations[0].content).toBe('final-1');
    }
  });
});

process.exit(summary('streammerge_row'));
