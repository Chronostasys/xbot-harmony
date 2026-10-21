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
  applyStreamFrame, applyStructured, displayContent, displayReasoning, resolveRowReply, mergeToolRuns,
  isIdleAction, isBusyAction, shouldReloadHistory, hasFreshPhaseDone, stripInterruptedMarker,
  sendStartsTurn,
} from '../../entry/src/main/ets/core/streammerge';
import {
  HistoryIteration, IterList, ProgressEvent, ToolProgress,
} from '../../entry/src/main/ets/core/types';
import {
  DomainEvent, EventSeq, TurnID, eventSeq, iterNum, turnID,
} from '../../entry/src/main/ets/core/chat_types_full';

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

// ── ⑩b sendStartsTurn：**乐观置 running** 的适用条件（移植 web `src/lib/sendTurn.ts`）──
// 用户 2026-10-17 P0「mid-turn idle 冻结」的根因判据：只有"会开启 turn"的发送才可乐观置
// running（否则命令 `!cmd` 的乐观置位永远清不掉 ⇒ 永久卡 busy）。
ok('turn_id>0 ⇒ 开启 turn', sendStartsTurn(5, false));
ok('queued=true ⇒ 终将开启 turn', sendStartsTurn(undefined, true));
ok('turn_id 缺省且未排队 ⇒ 不置位（命令/失败）', !sendStartsTurn(undefined, false));
ok('turn_id=0 且未排队 ⇒ 不置位', !sendStartsTurn(0, false));
ok('turn_id=null 且未排队 ⇒ 不置位', !sendStartsTurn(null, false));
ok('负 turn_id ⇒ 不置位', !sendStartsTurn(-1, false));
ok('queued=false 显式给出仍是 turn_id 单独决定', !sendStartsTurn(undefined, false));

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

// ── ⑪b 症状④「有时所有工具都在排队」（**用户 2026-10-11 亲报**）─────────────────────
// 根因：rank 表曾把 `generating` 排在 0（**低于** `pending`=1）⇒ 多工具批次同时"生成中"时，
// 任何带 `pending` 的快照都会把整批**翻回「排队」**。
// web 权威把 generating **整体排除在比较之外**（`progressStore.ts:351-354`：
// `if (tool.status === 'generating') { result.push(tool); continue }`）⇒ 后到的 pending 永远盖不掉它。
// 本仓跨帧累积合并，只能在 rank 里等价表达 ⇒ 断言：同一 call_id 上 pending 不得覆盖 generating。
let genVsPending: ToolProgress[] = [];
genVsPending = mergeTools(genVsPending, [tool('Shell', 'c1', 'generating')]);
genVsPending = mergeTools(genVsPending, [tool('Shell', 'c1', 'pending')]);
eq('陈旧 pending 不得把 generating 翻回「排队」',
  genVsPending.map((t: ToolProgress) => t.status), ['generating']);
// 反向守卫：修法**不能过度保护** —— 真进入执行时 running 必须覆盖 generating。
let genVsRunning: ToolProgress[] = [];
genVsRunning = mergeTools(genVsRunning, [tool('Shell', 'c1', 'generating')]);
genVsRunning = mergeTools(genVsRunning, [tool('Shell', 'c1', 'running')]);
eq('running 仍必须覆盖 generating（不过度保护）',
  genVsRunning.map((t: ToolProgress) => t.status), ['running']);
// 单调推进全链：pending → generating → running → done 每一步都必须是"更能说明进展"的赢。
const chain: string[] = [];
let chainTools: ToolProgress[] = [];
for (const st of ['pending', 'generating', 'running', 'done']) {
  chainTools = mergeTools(chainTools, [tool('Shell', 'cx', st)]);
  chain.push(chainTools[0].status as string);
}
eq('同键状态单调推进（迟到者只能更终态）', chain, ['pending', 'generating', 'running', 'done']);

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

// ── ⑬ hasFreshPhaseDone：PhaseDone ⇒ 立刻本地置 idle 的**新鲜性守卫** ────────────────
// 用户 2026-10-12：*"iter 结束如果最后没 tool … 应该立刻进入 idle"* —— 服务端 PhaseDone 是
// 最快权威信号（`session(idle)` 要等 Run() 退出）。但回放的上一回合 PhaseDone 不得误伤在跑回合。
// 判据（web `useProgressStream.ts:1166-1176`）：① 有 phase_done；② 不陈旧（seq > 水位或缺 seq）；
// ③ 指向当前 activeTurn（turnID 缺失回退 activeTurn）。三条守卫**任一去掉 ⇒ 对应断言必红**。
const TID = turnID(7);
const OTHER = turnID(9);
function pd(tid: TurnID | null, seq: EventSeq | null): DomainEvent {
  return { type: 'phase_done', turnID: tid, seq, finalIteration: null, todos: undefined };
}
const iterEv = {
  type: 'iteration', turnID: TID, iter: iterNum(1), seq: eventSeq(5),
  content: undefined, reasoning: undefined, activeTools: [], completedTools: [],
  iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
} as DomainEvent;

eq('新鲜 phase_done（seq>水位 且属 activeTurn）⇒ true', hasFreshPhaseDone([pd(TID, eventSeq(10))], eventSeq(5), TID), true);
eq('evs=null ⇒ false', hasFreshPhaseDone(null, eventSeq(5), TID), false);
eq('空事件数组 ⇒ false', hasFreshPhaseDone([], eventSeq(5), TID), false);
eq('无 phase_done（只 iteration）⇒ false', hasFreshPhaseDone([iterEv], eventSeq(5), TID), false);
// 守卫②：陈旧（seq ≤ 水位）⇒ 跳过
eq('陈旧 phase_done（seq==水位）⇒ false（回放不得误伤）', hasFreshPhaseDone([pd(TID, eventSeq(5))], eventSeq(5), TID), false);
eq('陈旧 phase_done（seq<水位）⇒ false', hasFreshPhaseDone([pd(TID, eventSeq(3))], eventSeq(5), TID), false);
// 守卫②宽容：seq/lastSeq 缺失 ⇒ 照常（后端 mock/首帧）
eq('seq 缺失 ⇒ 宽容放行 true', hasFreshPhaseDone([pd(TID, null)], eventSeq(5), TID), true);
eq('水位缺失（null）⇒ 宽容放行 true', hasFreshPhaseDone([pd(TID, eventSeq(10))], null, TID), true);
// 守卫③：属别的 turn ⇒ 不动本会话
eq('phase_done 属别的 turn ⇒ false', hasFreshPhaseDone([pd(OTHER, eventSeq(10))], eventSeq(5), TID), false);
// 守卫③b：**有 live turn 时 turnID 缺失 ⇒ 不得宽容放行**（2026-10-16 收紧，见 impl 注释）——
// 缺失 turnID 的 phase_done 会把在跑的 turn 误置 idle ⇒ 冻结 ⇒ 在飞工具被标 error（用户 P0
// 「长工具突然变成失败、过一会又恢复执行中」）。
eq('turnID 缺失但有 live turn ⇒ false（收紧：不得误冻在跑 turn）', hasFreshPhaseDone([pd(null, eventSeq(10))], eventSeq(5), TID), false);
eq('turnID=0 但有 live turn ⇒ false（同上，0 视为缺失）', hasFreshPhaseDone([pd(0 as TurnID, eventSeq(10))], eventSeq(5), TID), false);
eq('turnID 缺失且无 live turn ⇒ 宽容放行 true（无 turn 可误伤）', hasFreshPhaseDone([pd(null, eventSeq(10))], eventSeq(5), null), true);
eq('activeTurn 为 null（无法证伪）⇒ true', hasFreshPhaseDone([pd(TID, eventSeq(10))], eventSeq(5), null), true);
// 混合批：前面的 iteration 不干扰，找到 phase_done 即判
eq('混合 [iteration, 新鲜 phase_done] ⇒ true', hasFreshPhaseDone([iterEv, pd(TID, eventSeq(11))], eventSeq(5), TID), true);
eq('混合 [陈旧 phase_done, 无其它] ⇒ false', hasFreshPhaseDone([iterEv, pd(TID, eventSeq(2))], eventSeq(5), TID), false);

// ── ①e `resolveRowReply`（整条消息的「回复」取文）—— 逐字对齐 web
//    `MessageActions.resolveCopyText`（`:31-41`）：顶层 content → 否则**从末迭代往前扫**
//    （正文优先，再退一步推理）。用户 2026-10-13 亲报「长按复制会提示没有可复制的内容」
//    的**取文侧根因** = 旧实现只看**最后一个迭代** ⇒ 末迭代「工具收尾/仅思考」时 reply 为空。
{
  const mk = (iteration: number, content?: string, reasoning?: string): HistoryIteration => {
    const it: HistoryIteration = { iteration };
    if (content !== undefined) { it.content = content; }
    if (reasoning !== undefined) { it.reasoning = reasoning; }
    return it;
  };
  eq('顶层 content 非空 ⇒ 直取（不理迭代）', resolveRowReply('顶层', [mk(1, '迭代1正文')]), '顶层');
  eq('顶层空 + 末迭代有正文 ⇒ 取末迭代', resolveRowReply('', [mk(1, 'A'), mk(2, 'B')]), 'B');
  // ★ 旧实现红：末迭代是「工具收尾」（无正文无推理）⇒ 旧实现 reply=''；
  //   权威语义必须**回退到更早的迭代**。
  eq('★末迭代工具收尾 ⇒ 回退取更早迭代的正文', resolveRowReply('', [mk(1, '早正文'), mk(2)]), '早正文');
  eq('★全部无正文但更早迭代有推理 ⇒ 回退取推理', resolveRowReply('', [mk(1, undefined, '早推理'), mk(2)]), '早推理');
  eq('单趟语义：末迭代只有推理 ⇒ 取该推理（不继续往前找正文）',
    resolveRowReply('', [mk(1, '早正文'), mk(2, undefined, '末推理')]), '末推理');
  eq('同一迭代内正文优先于推理', resolveRowReply('', [mk(1, '有正文', '有推理'), mk(2)]), '有正文');
  eq('全空 ⇒ 空串（调用方据此隐藏「复制回复」项）', resolveRowReply('', [mk(1), mk(2)]), '');
  eq('无迭代 + 顶层空 ⇒ 空串', resolveRowReply('', []), '');
  {
    const live: HistoryIteration = { iteration: 3 };
    live.stream_text = '流式中';
    eq('流式迭代（`stream_text`）也被取到（displayContent 语义）', resolveRowReply('', [live]), '流式中');
  }
}

// ── ⑭ stripInterruptedMarker：取消后的 `[interrupted]` 标记**不是**用户可见正文 ──────────
// 真机缺陷（2026-10-14）：服务端 cancel 时把标记**前置进 assistant 正文**
//（`agent/interactive.go:1452`；无正文 `:2296-2300`；亦有恰好等于标记的落库行），
// 本仓此前对 `displayOnly`/标记**零消费** ⇒ 中文界面漏出裸英文 token（截图 `/tmp/s3_chat.jpeg`）。
// 判据（判别力）：① 只剥**开头**那一处；② 其余字符**逐字**保留（⛔ 不许改写/翻译服务端文案）；
//   ③ 不以标记开头 ⇒ 原样返回（零副作用，防"误伤正常正文"）。
{
  eq('① 标记 + 正文 ⇒ 剥标记留正文', stripInterruptedMarker('[interrupted] 半句正文'), '半句正文');
  eq('① 恰好等于标记 ⇒ 空串（调用方据此跳行）', stripInterruptedMarker('[interrupted]'), '');
  eq('① 标记 + 服务端原句 ⇒ 只去标记（不翻译、不改写）',
    stripInterruptedMarker('[interrupted] Agent was interrupted.'), 'Agent was interrupted.');
  eq('① 标记后紧跟换行 ⇒ 换行也吃掉', stripInterruptedMarker('[interrupted]\n正文'), '正文');
  eq('③ 不以标记开头 ⇒ 原样返回（含**正文中间**出现该串也不动）',
    stripInterruptedMarker('前文 [interrupted] 后文'), '前文 [interrupted] 后文');
  eq('③ 大小写/近似串不误伤', stripInterruptedMarker('[Interrupted] x'), '[Interrupted] x');
  eq('③ 空串安全', stripInterruptedMarker(''), '');
  // ⭐ 不变量：剥除后**绝不以标记开头**，且长度单调不增（防"越剥越长"）
  {
    const samples: string[] = ['[interrupted] a', '[interrupted]', 'a', '', '[interrupted]\n\nb', ' [interrupted]'];
    eq('不变量：剥除后不以标记开头', samples.every((s) => !stripInterruptedMarker(s).startsWith('[interrupted]')), true);
    eq('不变量：长度不减则不增', samples.every((s) => stripInterruptedMarker(s).length <= s.length), true);
  }
}

if (fail > 0) { console.log(`  streammerge: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  streammerge: ${pass} passed, 0 failed`);

export {};
