"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStreamOnly = isStreamOnly;
exports.hasStructured = hasStructured;
exports.liveIterationOf = liveIterationOf;
exports.upsertIteration = upsertIteration;
exports.mergeTools = mergeTools;
exports.toolsFromEvent = toolsFromEvent;
exports.applyStreamFrame = applyStreamFrame;
exports.applyStructured = applyStructured;
exports.displayContent = displayContent;
exports.isStaleSeqEvent = isStaleSeqEvent;
exports.tailOwnedIteration = tailOwnedIteration;
exports.rowIsEmpty = rowIsEmpty;
exports.displayReasoning = displayReasoning;
exports.isIdleAction = isIdleAction;
exports.isBusyAction = isBusyAction;
exports.shouldReloadHistory = shouldReloadHistory;
exports.streamStatsText = streamStatsText;
/** 该事件是否"只带流式字段"（与 服务端 isStreamOnlyProgress 同判据，但更宽松：不要求 iteration==0）。 */
function isStreamOnly(e) {
    const hasStream = nonEmpty(e.stream_content) || nonEmpty(e.stream_delta)
        || nonEmpty(e.reasoning_stream_content) || nonEmpty(e.reasoning_stream_delta)
        || (e.streaming_tools !== undefined && e.streaming_tools.length > 0);
    if (!hasStream) {
        return false;
    }
    // 只要带任一"结构化"字段，就不是纯流式（例如带 iteration_history 的收尾快照）
    return !hasStructured(e);
}
/** 是否携带结构化字段（迭代号/正文/推理/工具/历史）。 */
function hasStructured(e) {
    return (e.iteration !== undefined && e.iteration > 0)
        || nonEmpty(e.content) || nonEmpty(e.reasoning)
        || (e.active_tools !== undefined && e.active_tools.length > 0)
        || (e.completed_tools !== undefined && e.completed_tools.length > 0)
        || (e.tool_calls !== undefined && e.tool_calls.length > 0)
        || (e.iteration_history !== undefined && e.iteration_history.length > 0);
}
function nonEmpty(s) {
    return s !== undefined && s.length > 0;
}
/**
 * 取该行的**在飞迭代**（迭代号最大者；没有则按 1 建一个）。
 *
 * 为什么必须这样：`stream_content` 事件**按契约不带迭代号**（`iteration == 0`），
 * 直接按它写入就会造出幽灵「迭代 0」。
 */
function liveIterationOf(row) {
    let best = undefined;
    for (let i = 0; i < row.iterations.length; i++) {
        const it = row.iterations[i];
        if (best === undefined || it.iteration > best.iteration) {
            best = it;
        }
    }
    if (best === undefined) {
        nLiveCreated++; // 诊断：旧实现会在这里写迭代 0
        const created = { iteration: 1, content: '', reasoning: '', tools: [] };
        row.iterations.push(created);
        return created;
    }
    return best;
}
/** 按迭代号 upsert（升序插入），返回该迭代对象。 */
function upsertIteration(row, iteration) {
    for (let i = 0; i < row.iterations.length; i++) {
        if (row.iterations[i].iteration === iteration) {
            return row.iterations[i];
        }
    }
    const created = { iteration, content: '', reasoning: '', tools: [] };
    row.iterations.push(created);
    row.iterations.sort((a, b) => a.iteration - b.iteration);
    return created;
}
/** 工具去重合并（按 call_id 优先、否则按 name+label）：顺序 = 先 prev 后 next。 */
function mergeTools(prev, next) {
    const out = [];
    const seen = [];
    const take = (list) => {
        if (list === undefined) {
            return;
        }
        for (let i = 0; i < list.length; i++) {
            const t = list[i];
            const key = t.call_id !== undefined && t.call_id.length > 0
                ? t.call_id : `${t.name}#${t.label !== undefined ? t.label : ''}`;
            if (seen.indexOf(key) >= 0) {
                // 已存在 ⇒ 用新的替换（状态会从 running → done）
                for (let j = 0; j < out.length; j++) {
                    const o = out[j];
                    const ok = o.call_id !== undefined && o.call_id.length > 0
                        ? o.call_id : `${o.name}#${o.label !== undefined ? o.label : ''}`;
                    if (ok === key) {
                        out[j] = t;
                        break;
                    }
                }
                continue;
            }
            seen.push(key);
            out.push(t);
        }
    };
    take(prev);
    take(next);
    return out;
}
/** 事件里携带的工具（结构化优先 completed_tools，再 active_tools，再 tool_calls 形态）。 */
function toolsFromEvent(e) {
    const completed = e.completed_tools;
    const active = e.active_tools;
    const streaming = e.streaming_tools;
    if ((completed !== undefined && completed.length > 0)
        || (active !== undefined && active.length > 0)) {
        return mergeTools(completed, active);
    }
    if (streaming !== undefined && streaming.length > 0) {
        return streaming;
    }
    return undefined;
}
/**
 * 应用一个**流式帧**：增量追加、检查点整体替换；工具只增不减（流式帧不带工具时**绝不清空**）。
 *
 * ⚠️ 这条"只增不减"就是本模块存在的理由：违反它 = 工具 pill 在流式期间一闪就没。
 */
function applyStreamFrame(it, e) {
    nStreamFrames++;
    if (nonEmpty(e.stream_content)) {
        it.stream_text = e.stream_content; // 检查点：整体替换累积文本
    }
    else if (nonEmpty(e.stream_delta)) {
        it.stream_text = `${it.stream_text !== undefined ? it.stream_text : ''}${e.stream_delta}`;
    }
    if (nonEmpty(e.reasoning_stream_content)) {
        it.stream_reasoning = e.reasoning_stream_content;
    }
    else if (nonEmpty(e.reasoning_stream_delta)) {
        it.stream_reasoning = `${it.stream_reasoning !== undefined ? it.stream_reasoning : ''}${e.reasoning_stream_delta}`;
    }
    if (e.streaming_tools !== undefined && e.streaming_tools.length > 0) {
        nToolMerges++;
        it.tools = mergeTools(it.tools, e.streaming_tools);
    }
}
/**
 * 应用一个**结构化帧**：只更新"事件里确实带了"的字段 —— 缺字段时**保留旧值**（绝不清空）。
 *
 * 权威性：结构化帧带 `content`/`reasoning` 时是**权威快照**，直接覆盖并清掉流式缓冲
 * （避免检查点与增量叠加出重复文本）。
 */
function applyStructured(it, e) {
    nStructuredFrames++;
    if (nonEmpty(e.content)) {
        it.content = e.content;
        it.stream_text = ''; // 权威快照接管，清掉流式缓冲
    }
    if (nonEmpty(e.reasoning)) {
        it.reasoning = e.reasoning;
        it.stream_reasoning = '';
    }
    const tools = toolsFromEvent(e);
    if (tools !== undefined) {
        nToolMerges++;
        it.tools = mergeTools(it.tools, tools);
    }
    if (e.tools_folded === true && tools === undefined) {
        it.tools_folded = true;
    }
}
/** 该迭代当前应显示的正文：流式缓冲优先（在飞时最新），否则落权威 content。 */
function displayContent(it) {
    if (nonEmpty(it.stream_text)) {
        return it.stream_text !== undefined ? it.stream_text : '';
    }
    return it.content !== undefined ? it.content : '';
}
/**
 * seq 重放判据（逐字移植 web `chat/reduce.ts` 的 `isStaleSeq`）。
 *
 * ⚠️ 背景（真机 P0：SSE 事件完全不渲染）：`ProgressEvent.Seq` 是 **per-Run** 水位 ——
 * 同一 turn 的 Run 重启后 **seq 从 1 重新计数**，而客户端保留的是旧 Run 的水位。
 * 若只按 `seq <= lastSeq` 丢弃，新 Run 的全部事件会被整批吞掉（live 行永远建不起来）。
 *
 * 证据标准（与遮蔽解除同源）：**迭代号在 turn 域内单调，后端绝不对更早的迭代重发更大号**
 * ⇒ 携带更大迭代号的事件不可能是"已应用过的重放"。
 *
 * 判据：`seq ≤ 水位` **且** 事件不携带任何新迭代信息（`p.iteration > maxKnownIter`，
 * 或 `iteration_history` 中含 `> maxKnownIter` 的迭代）才算重放。
 */
function isStaleSeqEvent(lastSeq, seq, maxKnownIter, p) {
    if (lastSeq <= 0 || seq <= 0 || seq > lastSeq) {
        return false;
    }
    if (p.iteration !== undefined && p.iteration > maxKnownIter) {
        return false;
    }
    const hist = p.iteration_history;
    if (hist !== undefined) {
        for (let i = 0; i < hist.length; i++) {
            if (hist[i].iteration > maxKnownIter) {
                return false;
            }
        }
    }
    return true;
}
/**
 * 该迭代是否由"列表尾的 live 块"承担（= live 行的**最后一个迭代**，即进行中的那个）。
 *
 * ⛔ 真机事故（"每个迭代完成后都消失，永远只能看到最新的迭代"）：当时把 live 行
 * **整行排除**出列表，只让尾块渲染最后一个迭代 ⇒ live 行里**已完成的迭代**无处渲染，
 * 完成一个消失一个。修复 = live 行**留在列表**里渲染其已完成迭代，只有**最后一个**
 * 交给尾块 ⇒ 用本判据做互斥（同一迭代绝不画两遍）。
 */
function tailOwnedIteration(row, it) {
    const n = row.iterations.length;
    if (row.isLive !== true || n === 0) {
        return false;
    }
    return it.iteration === row.iterations[n - 1].iteration;
}
/** 行是否"完全空"（无正文、无思考、无工具 ⇒ 渲染出来就是一张空气泡卡片）。 */
function rowIsEmpty(row) {
    if (row.content.length > 0) {
        return false;
    }
    for (let i = 0; i < row.iterations.length; i++) {
        const it = row.iterations[i];
        if (displayContent(it).length > 0) {
            return false;
        }
        if (displayReasoning(it).length > 0) {
            return false;
        }
        if (it.tools !== undefined && it.tools.length > 0) {
            return false;
        }
    }
    return true;
}
/** 该迭代当前应显示的推理文本。 */
function displayReasoning(it) {
    if (nonEmpty(it.stream_reasoning)) {
        return it.stream_reasoning !== undefined ? it.stream_reasoning : '';
    }
    return it.reasoning !== undefined ? it.reasoning : '';
}
// ── 会话状态事件（`session`）的语义 ─────────────────────────────────────────
/**
 * 服务端 `SessionEvent` 的状态字段是 **`action`**（`protocol/events.go`：`Action string json:"action"`），
 * 取值实测含 `idle` / `busy` / `history_rewound` / `subagent_started|stopped` / `user_msg` /
 * `agent_msg` / `progress` / `sync_progress` …
 *
 * ⚠️ 客户端曾读 `ev.state` ⇒ 恒为 `undefined` ⇒ **整条会话状态更新是死代码**
 * （收尾后界面可能一直停在"运行中/停止"）。此处把判定抽成纯函数，由单测锁死。
 */
function isIdleAction(action) {
    return action === 'idle' || action === 'agent-idle';
}
function isBusyAction(action) {
    return action === 'busy' || action === 'agent-busy';
}
/** 历史被回退（rewind）⇒ 必须重载历史，否则界面停留在被撤销的内容上。 */
function shouldReloadHistory(action) {
    return action === 'history_rewound';
}
// ── 运行计数（诊断用：让一张自检页截图就能证明"两条路真的走对了"）──────────────
let nStreamFrames = 0; // 收到的流式帧数
let nStructuredFrames = 0; // 收到的结构化帧数
let nToolMerges = 0; // 工具合并次数（>0 说明工具没被清空过）
let nLiveCreated = 0; // 由流式帧首次建出"在飞迭代"的次数（旧实现会在此写 0）
/**
 * 一行计数摘要（自检页显示）。
 * 判读：**结构化帧数 > 0 且工具合并 > 0** = 工具 pill 走了正确的合并路径（不会被清空）；
 * 若"流式帧数 > 0 但结构化帧数 == 0"，说明只有流、没有结构化 ⇒ 需检查服务端是否在发 progress_structured。
 */
function streamStatsText() {
    return `流式帧=${nStreamFrames} 结构化帧=${nStructuredFrames} 工具合并=${nToolMerges}`
        + ` 在飞迭代新建=${nLiveCreated}`;
}
