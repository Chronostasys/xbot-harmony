/**
 * live 行渲染模型测试 —— 真机 bug1「一个 running turn 被渲染两遍」的回归守卫。
 * （已迁移到模型链路：`ModelFeed` = `model_adapter → model_step → model_project → applyModel`）
 *
 * 不变量（与 web 同构）：**已完成迭代在列表里，在飞快照在末尾那一块**，二者互不重叠
 * ⇒ 同一内容绝不会被画两遍、也绝不会"每个迭代完成就消失"。
 *
 * 新链路的落点（`docs/STATE-MODEL.md` §3.6 三条纪律）：
 *   · 一块一迭代：`turn.blocks` 原样交给渲染（不吸收/不合并/不去重）；
 *   · 在飞只有一块且**必然在末尾**（`live = ⊥ ⇒ inflight = ⊥`，零判定）；
 *   · 引用稳定：未变化的 `TurnRec` ⇒ 同一个投影对象 ⇒ 组件零重建。
 *   ⇒ 旧模型里"live 行最后一个迭代 = 在飞迭代、列表跳过它、尾块渲染它"那套
 *     `tailOwnedIteration` 互斥判据**整体消失**（重复/丢失的根源随之消失）。
 *
 * mutation 自证：让 `model_bridge.fillAssistant` 也把 inflight 块塞进 `completedBlocks`
 * （= 双渲染）⇒ ①的"已完成块不含在飞正文"红；让投影不追加 inflight ⇒ ①的
 * "在飞正文在末尾块"红。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';

const TURN = 1;

function block(n: number, content: string): Record<string, Object> {
  return { iteration: n, content, reasoning: '', tools: [], toolCount: 0 };
}

/** 起 turn + 提交迭代 1（delta 进 blocks）+ 在迭代 2 流式。 */
function twoIters(): ModelFeed {
  const f = new ModelFeed('chat-1');
  f.push({ type: 'turn_started', turnID: TURN, requestID: null, trigger: 'user', content: '', seq: 1 });
  f.push({
    type: 'iteration', turnID: TURN, iter: 1, seq: 2, phase: 'tool_exec',
    content: undefined, reasoning: undefined, activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [block(1, 'iter-1-final')],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  f.push({
    // ⚠️ 在飞正文用 `iteration` 帧表达（adapter 读 `ev.iter`）；真实 `stream` 帧的编号字段是
    //   `iteration` 而 adapter 只读 `ev.iter` ⇒ `stream` 帧不会进模型（core 侧缺口，见报告）。
    type: 'iteration', turnID: TURN, iter: 2, seq: 3, phase: 'thinking',
    content: 'in-flight-text', reasoning: 'in-flight-reasoning', streamingTools: [],
    activeTools: [], completedTools: [], iterationsDelta: [],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
  return f;
}

function liveRow(f: ModelFeed): ChatRow | undefined {
  return f.row(`turn-${TURN}-live`);
}

describe('live 行：已完成迭代在列表、在飞快照在末尾块（互不重叠）', () => {
  it('已完成块与在飞块互不重叠（同一内容不得进两处）', () => {
    const f = twoIters();
    const live = liveRow(f);
    expect(live !== undefined, '必须有一行 live').toBe(true);
    if (live === undefined) {
      return;
    }
    const its: HistoryIteration[] = live.iterations;
    // ① 已完成迭代 1 在列表里（内容正确）
    expect(its.length, '已完成 1 块 + 在飞 1 块').toBe(2);
    expect(its[0].iteration, '第 1 块 = 已完成迭代 1').toBe(1);
    expect(its[0].content, '已完成迭代内容 = iter-1-final').toBe('iter-1-final');
    // ② 在飞块在**末尾**（新链路：末尾块 = live 快照）
    expect(its[1].iteration, '末块 = 在飞迭代 2').toBe(2);
    expect(its[1].content, '在飞正文在末尾块').toBe('in-flight-text');
    expect(its[1].reasoning, '在飞思考在末尾块').toBe('in-flight-reasoning');
    // ③ 已完成块**不携带**在飞文本（否则同一段文字画两遍）
    let completedHasInflight = false;
    for (let i = 0; i < its.length - 1; i++) {
      if (String(its[i].content).indexOf('in-flight') >= 0
        || String(its[i].reasoning).indexOf('in-flight') >= 0) {
        completedHasInflight = true;
      }
    }
    expect(completedHasInflight, '没有任何**已完成**块携带在飞文本').toBe(false);
    // ④ 行级正文 = 在飞正文（回合级），不与已完成块内容混淆
    expect(live.content, '行级正文 = 在飞正文').toBe('in-flight-text');
  });

  it('迭代完成（delta 到达）后：已完成内容进 blocks（在飞块让位）', () => {
    const f = new ModelFeed('chat-1');
    f.push({ type: 'turn_started', turnID: TURN, requestID: null, trigger: 'user', content: '', seq: 1 });
    f.push({
      type: 'iteration', turnID: TURN, iter: 1, seq: 2, phase: 'tool_exec',
      content: undefined, reasoning: undefined, activeTools: [], completedTools: [], streamingTools: [],
      iterationsDelta: [block(1, 'final-1')],
      todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
    });
    const live = liveRow(f);
    expect(live !== undefined, '必须有 live 行').toBe(true);
    if (live !== undefined) {
      expect(live.iterations.length, '只有那一块（无多余在飞块）').toBe(1);
      expect(live.iterations[0].content, '已完成内容 = final-1').toBe('final-1');
    }
  });
});

process.exit(summary('streammerge_row'));

export {};
