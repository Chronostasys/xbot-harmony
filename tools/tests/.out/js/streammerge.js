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
exports.liveBlockOf = liveBlockOf;
exports.completedBlocks = completedBlocks;
exports.blocksSignature = blocksSignature;
exports.rowVisibleChars = rowVisibleChars;
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
/**
 * 是否携带**结构化载荷**（正文/推理/工具/历史）。
 *
 * ⛔ 迭代号**单独不能**作为判据：服务端会给**流式帧**盖 `iteration`
 * （`agent/engine_wire.go`：让前端在"新迭代只发流式事件、结构化边界事件被合并/丢失"时按迭代清状态）。
 * 若把"有迭代号"当成结构化，流式帧就会走 `applyStructured`，而该函数只认
 * `content/reasoning/tools` ⇒ `stream_content`/`stream_delta`/`reasoning_stream_*`/`streaming_tools`
 * 被**静默丢弃**，且还要过 `seq` 闸 ⇒ **整段流式（思考打字机/正文打字机/工具生成中）全不渲染**，
 * 只在收尾快照才蹦出完整迭代（真机 P0，2026-10-10）。
 */
function hasStructured(e) {
    return nonEmpty(e.content) || nonEmpty(e.reasoning)
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
// ⛔ 已删除 `tailOwnedIteration`（bug1「一个 running turn 被渲染两遍」的根因）。
//
// 旧模型：live 行的**最后一个迭代** = 在飞迭代（store 把流式内容折进它），列表跳过它、
// 由尾块渲染 ⇒ 两处必须严格互斥（否则同一迭代画两遍或两处都不画）。
// web 模型：live 行的 `iterations` **只含已完成迭代**；在飞内容（content/reasoning/
// activeTools/streamingTools）是**独立字段**，由 LiveIteration/尾块渲染 —— 二者天然
// 不重叠、无需任何归属判据。原生端已对齐（core/render.ets + store.liveProgress +
// 页面 syncLiveTail）：列表渲染**全部**迭代，尾块渲染在飞快照。
/**
 * 该行的**在飞迭代块**（`live: true` 的那一块；无则 undefined）。
 *
 * 渲染层（`MessageRowView`）与可见性判据（`rowVisibleChars`）读**同一个**函数 ——
 * 不允许两边各自找一遍（那正是"判据/渲染分叉"的温床）。
 */
function liveBlockOf(row) {
    for (let i = row.iterations.length - 1; i >= 0; i--) {
        if (row.iterations[i].live === true) {
            return row.iterations[i];
        }
    }
    return undefined;
}
/**
 * 该行承载的**已完成迭代块**（排除末尾在飞块 `live: true`）。
 *
 * 与 `liveBlockOf` 成对：`完成块 ⊕ 在飞块` 即该行要渲染的全部块。
 * ⛔ 页面（`syncLiveTail` 的已完成块镜像）与渲染层（`blocksFor`）必须读**同一个**
 *   函数 —— 投递源与判据/渲染同源，杜绝"投递的内容与画的内容分叉"。
 */
function completedBlocks(row) {
    const out = [];
    for (let i = 0; i < row.iterations.length; i++) {
        if (row.iterations[i].live !== true) {
            out.push(row.iterations[i]);
        }
    }
    return out;
}
/**
 * 块列表的**值指纹** —— 页面把 live 行的已完成块镜像进 `@State liveBlocks` 时用它
 * 判「结构/内容是否变化」：不变则不赋值（避免每帧新数组触发无谓重建）。
 *
 * 含每块的迭代号 / 正文长度 / 思考长度 / 工具数 —— 任一变化即换值（覆盖
 * "同号权威覆盖" 更新已提交迭代内容的场景）。
 */
function blocksSignature(bs) {
    let s = `${bs.length}`;
    for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        s += `|${b.iteration}:${(b.content ?? '').length}:${(b.reasoning ?? '').length}`
            + `:${b.tools !== undefined ? b.tools.length : 0}`;
    }
    return s;
}
/**
 * 「尾部可见内容量」—— 本行**渲染后会真正画出来**的字符数（工具 pill 计 1）。
 *
 * ⛔ 这是「可见性判据」与「渲染内容」的**唯一同源点**（用户 2026-10-10 P0 定稿：
 *   「发送后第一个 SSE 到达占位就消失、中间看不到任何进度」）。
 *   判据点：`rowIsEmpty`（→ `core/indicators.showsBusyPlaceholder` 的
 *   `tailShowsIndicator`）；渲染守卫点：`pages/Index.ChatRowBody` 与
 *   `components/MessageRow.MessageRowView.build`。两处**都**用它
 *   ⇒ 结构上不可能再出现"判据说有、渲染画不出"（占位让位 + 一行空白 = 全空）。
 *
 * 逐条对应 `components/MessageRow.ets` 的 `AssistantBlock`（**改渲染必须同步改这里**）：
 *   · `row.content` **仅当 `iterations` 为空时**才画（有迭代 ⇒ 内容在迭代内渲染，
 *     与 web `AssistantMessage.finalContent = !hasIterations && !liveHasContent` 同判据）；
 *   · 每个迭代块 → `IterationBlock`：思考头(displayReasoning>0) + 正文 + 工具 pill；
 *   · 末尾在飞块（`live:true`）→ `LiveTailView`：同上。
 *
 * ⚠️ 计数按**默认（折叠）态**与渲染逐条对齐：思考只计"头"1 个字符量（展开正文时
 *   渲染更多 —— 故这是**下界**，`>0` 判据不受影响）；正文计全部字符；工具 pill 计 1。
 *   测试 `p0_tail_visibility.test.ts` 用独立 oracle 断言本函数与渲染**逐字同源**。
 */
function rowVisibleChars(row) {
    let n = 0;
    if (row.content.length > 0 && row.iterations.length === 0) {
        n += row.content.length;
    }
    for (let i = 0; i < row.iterations.length; i++) {
        const it = row.iterations[i];
        if (displayReasoning(it).length > 0) {
            n += 1;
        }
        n += displayContent(it).length;
        if (it.tools !== undefined && it.tools.length > 0) {
            n += 1;
        }
    }
    return n;
}
/**
 * 行是否没有任何**可见**内容（渲染出来就是一张空气泡卡片 / 占位符该顶上）。
 *
 * ⛔ 必须是 `rowVisibleChars(row) === 0`（与渲染同源）—— 旧实现无条件把
 *   `row.content` 算作内容，而渲染层只在 `iterations` 为空时才画它 ⇒ 在飞内容
 *   落在 `row.content` 时，判据说"有"、渲染空白（P0）。
 */
function rowIsEmpty(row) {
    return rowVisibleChars(row) === 0;
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
