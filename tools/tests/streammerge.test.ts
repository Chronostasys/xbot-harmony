/**
 * 流式 / 结构化 两类进度事件的**合并语义**测试 —— 真机"渲染整个错乱"的直接根因，必须有守护。
 *
 * 契约来源（服务端）：`channel/web/web_hub.go` 的 normalizeSSEEvent + isStreamOnlyProgress
 * ⇒ 只带流式字段的消息改型为 `stream_content`，且此时 **iteration==0、content==""、tools 全空**；
 * 字段命名见 `protocol/events.go`（stream_content/stream_delta/reasoning_stream_content / reasoning_stream_delta / streaming_tools）。
 *
 * ⚠️ 这些断言在**旧实现上是红的**（旧代码：读 p.content、按 p.iteration??0 写入、整体替换 ⇒
 * 幽灵「迭代 0」+ 每个流式帧清空 tools/reasoning）。
 */
declare const process: { exit: (c: number) => void };

import {
  isStreamOnly, hasStructured, liveIterationOf, upsertIteration, mergeTools, toolsFromEvent,
  applyStreamFrame, applyStructured, displayContent, displayReasoning,
} from '../../entry/src/main/ets/core/streammerge';
import {
  HistoryIteration, IterList, ProgressEvent, ToolProgress,
} from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function row(iters: HistoryIteration[]): IterList {
  return { iterations: iters };
}
function tool(name: string, callId: string, status: string): ToolProgress {
  const t: ToolProgress = { name, status };
  t.call_id = callId;
  return t;
}

// ── ① 事件分类（与 服务端 isStreamOnlyProgress 对齐）──
const streamFrame: ProgressEvent = { stream_content: 'hello', chat_id: 'c1' };
ok('只带流内容 ⇒ 流式', isStreamOnly(streamFrame));
ok('流式帧不算结构化', !hasStructured(streamFrame));
const deltaFrame: ProgressEvent = { stream_delta: 'x' };
ok('只带增量 ⇒ 流式', isStreamOnly(deltaFrame));
const structuredFrame: ProgressEvent = { iteration: 3, content: 'abc', seq: 9 };
ok('带迭代号+正文 ⇒ 非流式', !isStreamOnly(structuredFrame));
const mixed: ProgressEvent = { iteration: 5, stream_content: 'tail', seq: 10 };
ok('同时带结构化字段 ⇒ 不按纯流式处理', !isStreamOnly(mixed));
ok('空事件 ⇒ 既非流式也非结构化', !isStreamOnly({}) && !hasStructured({}));

// ── ② 在飞迭代：流式帧没有迭代号 ⇒ 必须落到"号最大"的迭代，而不是幽灵 0 ──
const r1 = row([{ iteration: 2, tools: [] }, { iteration: 7, tools: [] }]);
eq('在飞迭代 = 号最大者', liveIterationOf(r1).iteration, 7);
applyStreamFrame(liveIterationOf(r1), { stream_content: 'A' });
eq('流式文本落到在飞迭代', r1.iterations[1].stream_text, 'A');
ok('没有产生幽灵「迭代 0」', r1.iterations.every((x: HistoryIteration) => x.iteration !== 0));
eq('迭代数不变（没多出块）', r1.iterations.length, 2);

const rEmpty = row([]);
eq('空行时在飞迭代按 1 建', liveIterationOf(rEmpty).iteration, 1);

// ── ③ 增量 vs 检查点 ──
const r2 = row([{ iteration: 1, tools: [] }]);
const it2 = liveIterationOf(r2);
applyStreamFrame(it2, { stream_delta: 'a' });
applyStreamFrame(it2, { stream_delta: 'b' });
eq('增量追加', it2.stream_text, 'ab');
applyStreamFrame(it2, { stream_content: 'abc' });
eq('检查点整体替换', it2.stream_text, 'abc');
applyStreamFrame(it2, { reasoning_stream_delta: 'R1' });
applyStreamFrame(it2, { reasoning_stream_delta: 'R2' });
eq('推理增量追加', it2.stream_reasoning, 'R1R2');
applyStreamFrame(it2, { reasoning_stream_content: 'R' });
eq('推理检查点替换', it2.stream_reasoning, 'R');

// ── ④ 核心回归：流式帧**绝不能清空** structured 数据（工具 pill 不能闪没）──
const r3 = row([{ iteration: 4, content: '', reasoning: 'why', tools: [tool('Shell', 'c1', 'running')] }]);
const it3 = liveIterationOf(r3);
applyStreamFrame(it3, { stream_content: 'streaming…' });
eq('流式帧后 reasoning 仍在', it3.reasoning, 'why');
eq('流式帧后 tools 仍在', (it3.tools !== undefined ? it3.tools.length : 0), 1);
eq('流式帧后工具状态未被清空', it3.tools !== undefined ? it3.tools[0].status : '', 'running');

// ── ⑤ 结构化帧：带了才覆盖，没带就保留 ──
const r4 = row([{ iteration: 5, content: 'old', reasoning: 'r-old', tools: [tool('Read', 'k1', 'done')] }]);
const it4 = liveIterationOf(r4);
applyStructured(it4, { iteration: 5, seq: 11 });          // 什么都没带
eq('结构化帧缺字段时保留正文', it4.content, 'old');
eq('结构化帧缺字段时保留推理', it4.reasoning, 'r-old');
eq('结构化帧缺字段时保留工具', (it4.tools !== undefined ? it4.tools.length : 0), 1);
applyStructured(it4, { iteration: 5, content: 'new', seq: 12 });
eq('结构化帧带正文则覆盖', it4.content, 'new');
eq('权威快照接管后清掉流式缓冲', it4.stream_text, '');
applyStructured(it4, { iteration: 5, completed_tools: [tool('Shell', 'c9', 'done')], seq: 13 });
eq('工具并集（不丢旧工具）', (it4.tools !== undefined ? it4.tools.length : 0), 2);

// ── ⑥ 工具合并：同 call_id 用新的替换（running → done），不会重复 ──
const merged = mergeTools([tool('Shell', 'c1', 'running')], [tool('Shell', 'c1', 'done')]);
eq('同 call_id 去重并更新状态', merged.length, 1);
eq('状态被新值覆盖', merged[0].status, 'done');
const merged2 = mergeTools([tool('A', 'c1', 'done')], [tool('B', 'c2', 'done'), tool('C', 'c3', 'done')]);
eq('不同工具全部保留', merged2.map((t: ToolProgress) => t.name), ['A', 'B', 'C']);
eq('无 call_id 时按 name#label 去重', mergeTools([{ name: 'X', label: 'x' }], [{ name: 'X', label: 'x' }]).length, 1);

// ── ⑦ toolsFromEvent 取值优先级 ──
eq('completed+active 合并', (toolsFromEvent({ completed_tools: [tool('done', 'a', 'done')], active_tools: [tool('run', 'b', 'running')] }) || []).length, 2);
eq('只有 streaming_tools 时用它', (toolsFromEvent({ streaming_tools: [tool('s', 'c', 'running')] }) || []).length, 1);
eq('都没有 ⇒ undefined（调用方不得清空）', toolsFromEvent({ iteration: 1 }), undefined);

// ── ⑧ 显示取值：在飞时优先流式缓冲，收尾后落权威正文 ──
eq('流式优先', displayContent({ iteration: 1, content: 'final', stream_text: 'partial' }), 'partial');
eq('无流式则用正文', displayContent({ iteration: 1, content: 'final' }), 'final');
eq('推理同理', displayReasoning({ iteration: 1, reasoning: 'r', stream_reasoning: 's' }), 's');
eq('空流式回落正文', displayContent({ iteration: 1, content: 'final', stream_text: '' }), 'final');

// ── ⑨ upsert 保持升序（折叠视图前插/收尾补记都靠它）──
const r5 = row([{ iteration: 3, tools: [] }, { iteration: 9, tools: [] }]);
upsertIteration(r5, 5);
eq('按号插入并升序', r5.iterations.map((x: HistoryIteration) => x.iteration), [3, 5, 9]);

if (fail > 0) { console.log(`  streammerge: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  streammerge: ${pass} passed, 0 failed`);
