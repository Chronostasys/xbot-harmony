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
  applyStreamFrame, applyStructured, displayContent, displayReasoning, mergeToolRuns,
  isIdleAction, isBusyAction, shouldReloadHistory,
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
// ⛔ 契约修正（真机 P0，2026-10-10）：服务端会给**流式帧**盖 iteration（用于切迭代边界），
//    "有迭代号"绝不能算结构化 —— 否则 stream_* 会被 applyStructured 静默丢弃、整段流式不渲染。
ok('流式帧盖 iteration ⇒ 仍按纯流式处理', isStreamOnly(mixed));
ok('真结构化载荷（正文）⇒ 非流式',
  !isStreamOnly({ iteration: 5, stream_content: 'tail', content: 'z' } as ProgressEvent));
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

// ── ⑩ 会话状态事件：服务端字段是 `action`（不是 `state`）──
// 曾误读 ev.state ⇒ 恒 undefined ⇒ 整条会话状态更新是死代码（收尾后界面停在"运行中/停止"）。
ok('idle ⇒ 非忙碌', isIdleAction('idle'));
ok('agent-idle ⇒ 非忙碌', isIdleAction('agent-idle'));
ok('busy ⇒ 忙碌', isBusyAction('busy'));
ok('agent-busy ⇒ 忙碌', isBusyAction('agent-busy'));
ok('history_rewound ⇒ 需重载历史', shouldReloadHistory('history_rewound'));
ok('user_msg 不改变忙碌态', !isIdleAction('user_msg') && !isBusyAction('user_msg'));
ok('空 action 不作判定', !isIdleAction('') && !isBusyAction(''));
ok('rewound 不等价于忙碌/空闲', !isIdleAction('history_rewound') && !isBusyAction('history_rewound'));

// ── ⑪ 工具去重：**终态优先**（移植 web `dedupTools`，用户 2026-09-14 / 2026-10-11 P0）──
// ⛔ 症状①「正在执行的工具被标排队」的根因：陈旧快照（仍 running/pending）后写入会把新状态盖掉。
//    修法 = rank 终态优先（error/done=3 > running=2 > pending=1 > 其它=0）。
eq('陈旧 running 不覆盖新的 done（后到者不再盲赢）',
  mergeTools([tool('Shell', 'c1', 'done')], [tool('Shell', 'c1', 'running')])[0].status, 'done');
eq('新 done 覆盖旧 running（终态胜出）',
  mergeTools([tool('Shell', 'c1', 'running')], [tool('Shell', 'c1', 'done')])[0].status, 'done');
eq('陈旧 pending 不覆盖新的 running（"executing 被当成排队"根因）',
  mergeTools([tool('Shell', 'c1', 'running')], [tool('Shell', 'c1', 'pending')])[0].status, 'running');
eq('新 running 覆盖旧 pending（排队 → 执行）',
  mergeTools([tool('Shell', 'c1', 'pending')], [tool('Shell', 'c1', 'running')])[0].status, 'running');
eq('新旧状态不同键时都保留（不同调用）',
  mergeTools([tool('A', 'c1', 'done')], [tool('A', 'c2', 'running')]).length, 2);
// ⛔ 症状③「同一个工具渲染成两行」：generating 的 label 每帧都在流式增长，
//    若把 label 纳入去重键 ⇒ 同一次调用被追加成多行。修法 = generating 用稳定键（name/call_id）。
let genTools: ToolProgress[] = [];
genTools = mergeTools(genTools, [{ name: 'Shell', status: 'generating', label: 'cd' } as ToolProgress]);
genTools = mergeTools(genTools, [{ name: 'Shell', status: 'generating', label: 'cd /home' } as ToolProgress]);
genTools = mergeTools(genTools, [{ name: 'Shell', status: 'generating', label: 'cd /home/smith' } as ToolProgress]);
eq('generating 标签流式增长 ⇒ 只一行', genTools.length, 1);
eq('generating 行取最新标签', genTools[0].label, 'cd /home/smith');
// toolsFromEvent(completed, active)：陈旧的 active 不得盖掉 completed 的终态。
eq('toolsFromEvent：completed(done) 不被陈旧 active(running) 盖',
  (toolsFromEvent({
    completed_tools: [tool('Shell', 'c1', 'done')],
    active_tools: [tool('Shell', 'c1', 'running')],
  }) || []).map((t: ToolProgress) => t.status), ['done']);
eq('toolsFromEvent：陈旧 active(pending) 不盖 running',
  (toolsFromEvent({
    active_tools: [tool('Shell', 'c1', 'running'), tool('Shell', 'c1', 'pending')],
  }) || []).map((t: ToolProgress) => t.status), ['running']);

// ── ⑫ 迭代归属：跨迭代合并**保留 head 迭代号**（工具不漂到错误迭代下）──────────────
// 服务端每个工具自带 `iteration`（`engine_run_tools.go:57`），落在**各自**迭代的 iteration_history。
// 渲染层的跨迭代合并（mergeToolRuns）把"纯工具"迭代吸收进前一个含工具迭代 ⇒ 必须保留 head 号，
// 否则同一工具会看起来挂在错误的迭代下（真机：FileCreate 出现在两个相邻迭代）。
const headIter: HistoryIteration = {
  iteration: 45, reasoning: 'r', tools: [tool('FileCreate', 'f1', 'done')],
};
const memberIter: HistoryIteration = { iteration: 46, tools: [tool('Shell', 's1', 'done')] };
const mergedIts = mergeToolRuns([headIter, memberIter]);
eq('跨迭代合并只产出一块', mergedIts.length, 1);
const mergedHead: HistoryIteration = mergedIts[0];
eq('保留 head 迭代号（归属不漂移）', mergedHead.iteration, 45);
const mergedNames: string[] = (mergedHead.tools !== undefined ? mergedHead.tools : [])
  .map((t: ToolProgress) => t.name);
eq('合并后工具并集（两个都保留）', mergedNames, ['FileCreate', 'Shell']);
// 含正文/reasoning 的迭代**不**被吸收 ⇒ 两次真实调用各自成块（不误合并）
const withReasoning = mergeToolRuns([
  { iteration: 1, reasoning: 'a', tools: [tool('X', 'x1', 'done')] },
  { iteration: 2, reasoning: 'b', tools: [tool('X', 'x2', 'done')] },
]);
eq('各带 reasoning 的迭代不被合并（两行是两次真实调用）', withReasoning.length, 2);

if (fail > 0) { console.log(`  streammerge: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  streammerge: ${pass} passed, 0 failed`);
