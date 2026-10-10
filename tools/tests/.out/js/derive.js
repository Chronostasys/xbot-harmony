"use strict";
// 逐字移植自 xbot web `web/src/chat/derive.ts`（逻辑一比一：同一份规则，不做重写）
/**
 * derive.ts — 渲染模型：deriveRows : ChatState → readonly Row[]（纯函数）。
 *
 * 定理（design doc §5.3）：
 *   T1 total       —— 穷尽 switch + I2/I6 类型保证 ⇒ 无 TypeError 可达 ⇒ DOM 永不消失
 *   T4 无 ghost 行 —— 每 turn 恰经一次 assistantRow（判别联合三选一）⇒ 至多一行
 *   T5 线性一致    —— legacy 前缀 ⊕ turnID 升序 ⊕ (user < assistant)，纯函数
 *
 * 渲染组件只做 Row → DOM 映射；isPartial 语义收窄至 live/frozen（kind 判别，
 * 不再有 find(isPartial) 启发式 —— Bug 7 根治点）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveRows = deriveRows;
// [TURNDROP] 诊断去重（derive 每帧调用 —— 同一 turnID 的 hollow-frozen 跳过
// 只报告一次；生产保留 console.warn 以便用户复现时捕获触发链）。
const turndropReported = new Set();
// ─── deriveRows：ρ（T5 顺序 = legacy ⊕ turnID 升序 ⊕ user<assistant） ──
/**
 * 派生对象的**对象恒等 memo**（长 turn 卡顿回归的根因修复）：
 * 源对象引用不变 ⇒ 派生 Row 引用必须不变。
 *
 * 每个流式帧 `state` 都是新引用（reduce 的 `withTurn` 只改 active turn），
 * deriveRows 每帧执行；若每帧为**所有** turn 重建 Row，则下游
 * rowsToChatMessages → MessageItem（memo）逐帧全部失效 —— 每个 assistant 行
 * 内部是该 turn 的整棵迭代树，代价 ∝ 会话内全部已渲染迭代。
 * WeakMap 以源对象为键：未变更的 turn 直接复用上一帧的 Row（零分配、零比较）。
 *
 * 纯函数证据：assistantRow 只读 `t.id` / `t.phase`（都封装在 Turn 内，不可变）；
 * userRowOf 只读 `t.user`；legacy/pending 只读各自的消息对象。
 */
const assistantRowByTurn = new WeakMap();
const userRowByMsg = new WeakMap();
const legacyRowByMsg = new WeakMap();
function cachedAssistantRow(t) {
    const cached = assistantRowByTurn.get(t);
    if (cached !== undefined)
        return cached;
    const row = assistantRow(t);
    assistantRowByTurn.set(t, row);
    return row;
}
function cachedUserRow(t) {
    const u = t.user;
    const cached = userRowByMsg.get(u);
    if (cached !== undefined)
        return cached;
    const row = userRowOf(t);
    userRowByMsg.set(u, row);
    return row;
}
function cachedUserRowView(u) {
    const cached = userRowByMsg.get(u);
    if (cached !== undefined)
        return cached;
    const row = userRowView(u);
    userRowByMsg.set(u, row);
    return row;
}
function cachedLegacyRow(l) {
    const cached = legacyRowByMsg.get(l);
    if (cached !== undefined)
        return cached;
    const row = l.role === 'user'
        ? {
            kind: 'user',
            id: l.id,
            content: l.content,
            timestamp: l.timestamp,
            isNotification: false,
            queued: false,
            sending: false,
            dbID: l.dbID,
            turnID: 0,
            standalone: l.standalone,
            anchorTurnID: l.anchorTurnID,
        }
        : {
            kind: 'committed',
            id: l.id,
            turnID: 0,
            // standalone 段（命令回复）显式透传「无 turn」标记 —— `bindTurnIDs` 见到该
            // 标记就跳过绑定（否则会绑到 live turn、与 live 行撞虚拟键：CI 实证尺寸缓存
            // 串味 → 总高翻倍 → 命令输出被推到可视区之上）。
            standalone: l.standalone,
            anchorTurnID: l.anchorTurnID,
            isPartial: false,
            content: l.content,
            iterations: l.iterations,
            // 更早未下发的展示区域数（standalone/legacy 段同样可能带 —— 与
            // turn 行的 committed payload 同一来源语义）。
            regionsBefore: l.regionsBefore,
        };
    legacyRowByMsg.set(l, row);
    return row;
}
/** turn 顺序（deriveRows 的 T5 前提）：Map 插入序在真实事件流里已按 turnID 单调
 *  （withTurn 拷贝保持插入序、新 turn 追加），O(T) 检查通过即免去每帧 O(T log T) 排序。 */
function sortedTurns(turns) {
    const out = [];
    let last = -1;
    let ordered = true;
    for (const t of turns.values()) {
        if (t.id < last)
            ordered = false;
        last = t.id;
        out.push(t);
    }
    return ordered ? out : out.sort((a, b) => a.id - b.id);
}
/** turn 的区域窗口声明（committed 从 payload、live/frozen 从 data 读 —— 语义同源）。 */
function turnRegionsBefore(t) {
    if (t.phase.kind === 'committed')
        return t.phase.payload.regionsBefore;
    return t.phase.data.regionsBefore;
}
function deriveRows(s) {
    const turnRows = [];
    for (const t of sortedTurns(s.turns)) {
        // 用户规则（2026-10-01 回归修复，用户原话：「如果用户看到了一个用户输入，那么
        // 这个用户输入之后的所有消息就必须是完整的，不能是接下来动态加载的。所以这种
        // 情况如果需要动态加载，你不能渲染那个用户的输入」）——
        // **任何 phase**（live/frozen/committed）的 regionsBefore > 0（更早区域待动态
        // 加载）时 user 行不渲染：否则「user 输入悬在折叠内容上方」破坏对话时间线的因果
        // 视觉（修改前全量视图从不存在此形态）。2026-10-02 生产截图第二次点名（live
        // turn 540 迭代、regionsBefore=166，user「继续」悬在「⌃ 更早的 166 个区域」上
        // 方）：「加载更多前面不能渲染任何东西，加载更多一定在顶部」—— 此前的 live
        // 豁免（「正在生成的对话不能藏用户刚发的消息」）不成立：折叠窗口只在长 turn
        // （≥100 区域）才激活，「刚发的消息」场景 regionsBefore 缺省、user 行照常渲染。
        // 过滤走 turn 的实时值（不走缓存 row）：段加载完成 regionsBefore 归零后
        // derive 重跑 ⇒ user 行自然出现，与内容一起构成完整时间线。
        const rb = turnRegionsBefore(t);
        // > 0 才隐藏：段加载完成后服务端显式下发 regions_before: 0（权威归零声明），
        // 此时 user 行必须立刻随完整内容一起出现（!== undefined 会把归零误判成未完成）。
        const userHiddenByFold = rb !== undefined && rb > 0;
        if (t.user && !userHiddenByFold)
            turnRows.push(cachedUserRow(t));
        const ar = cachedAssistantRow(t);
        if (ar !== null)
            turnRows.push(ar);
    }
    // pendingUsers（未绑定的乐观行）：沉到底部（发送中/排队 —— 归属 turn 未知）。
    const pending = s.pendingUsers.map(cachedUserRowView);
    // legacy 段保持 DB 顺序：user/assistant 交错（非 turn 模型 —— 直接按原序映射）。
    const legacySorted = s.legacy.map(cachedLegacyRow);
    // standalone 段（无 turn 归属的**实时**回复：命令 `!cmd`/slash 的输出）——
    // 排在 turns 之后（用户视角的最新消息）。若与 legacy 混用，命令输出会跑到
    // 会话顶部（derive 的 legacy 前缀段），用户仍会觉得"没有输出"。
    const standaloneRows = s.standalone.map(cachedLegacyRow);
    return [...legacySorted, ...turnRows, ...standaloneRows, ...pending];
}
// ─── assistantRow：穷尽 switch（T4：每 turn 至多一行） ─────────
function assistantRow(t) {
    switch (t.phase.kind) {
        case 'live': {
            const d = t.phase.data;
            return {
                kind: 'live',
                id: `turn-${t.id}-live`,
                turnID: t.id,
                isPartial: true,
                streaming: d.streaming,
                content: d.content,
                reasoning: d.reasoning,
                iterations: d.iterations,
                activeTools: d.activeTools,
                streamingTools: d.streamingTools,
                genui: d.genui,
                subAgents: d.subAgents,
                todos: d.todos,
                lastIter: d.iter,
                regionsBefore: d.regionsBefore,
            };
        }
        case 'frozen': {
            // 空壳 frozen（完全无产出）不出行 —— Bug 6/8 的"幽灵行"根治点。
            if (!hasVisibleOutput(t.phase.data)) {
                // [TURNDROP] 诊断：空壳 frozen 被 derive 跳过 —— turn 从渲染层消失
                // （"整个 turn 的 assistant 消息完全消失"的渲染层形态）。每个 turnID
                // 只打一次（derive 每帧调用，Set 去重防刷屏）。
                turndropReported.add(`hollow-frozen:${t.id}`);
                console.warn('[TURNDROP] derive skipped hollow frozen (turn vanishes from render)', {
                    turnID: t.id,
                });
                return null;
            }
            const d = t.phase.data;
            // cancel 时正在执行的工具折进最后迭代 —— rowsToChatMessages 不向渲染层
            // 传 activeTools（liveProgress 在 frozen 时为空），TurnBody 从 iterations 读
            // 工具。保证"已渲染内容永不消失"（cancel 后正在执行的 tool 保留在最新迭代
            // —— 用户/测试要求）。
            // F1（Loop2）：streamingTools（参数流式生成中，generating）与 activeTools
            // 同折 —— 只折 activeTools 会让 generating 工具在 cancel/text 丢失定格时
            // 从 frozen 行消失（text_final/reduce 的 foldInFlightToIterations 同原则：
            // activeTools + streamingTools 都是"从未完成、不在 iteration_history"的
            // in-flight 工具）。markError 对 done 工具恒等（既有语义：activeTools 里
            // 已完成的工具也保留折入 —— SSE 丢迭代 delta 时 frozen 渲染的最后防线）。
            const errTools = [...d.activeTools, ...d.streamingTools].map(markError);
            const iterations = foldToolsIntoIterations(d.iterations, errTools, d.iter);
            return {
                kind: 'frozen',
                id: `turn-${t.id}`,
                turnID: t.id,
                isPartial: true,
                content: d.content,
                reasoning: d.reasoning,
                iterations,
                activeTools: errTools,
                genui: d.genui,
                lastIter: d.iter,
                regionsBefore: d.regionsBefore,
            };
        }
        case 'committed': {
            // I2：payload 必可渲染（via text → content 非空；via fold → iterations 非空）。
            // via 仅区分构造路径的 I2 保证，消费侧无差异 —— content 两分支同源
            //（恒等三元已删，F#7）。
            return {
                kind: 'committed',
                id: `turn-${t.id}-c`,
                turnID: t.id,
                isPartial: false,
                content: t.phase.payload.content,
                iterations: t.phase.payload.iterations,
                iterationsTruncated: t.phase.payload.iterationsTruncated ?? 0,
                // turn 内压缩点：透传引用（payload 引用稳定 ⇒ memo 不失效）。
                compactions: t.phase.payload.compactions,
                // 更早未下发的展示区域数（D1 线的 RegionsDivider 消费；>0 渲染分隔条）。
                regionsBefore: t.phase.payload.regionsBefore,
            };
        }
    }
}
function userRowOf(t) {
    const u = t.user;
    return {
        kind: 'user',
        id: u.id,
        content: u.content,
        timestamp: u.timestamp,
        isNotification: u.isNotification,
        queued: u.queued,
        sending: u.sending,
        dbID: u.dbID,
        turnID: t.id,
    };
}
function userRowView(u) {
    return {
        kind: 'user',
        id: u.id,
        content: u.content,
        timestamp: u.timestamp,
        isNotification: u.isNotification,
        queued: u.queued,
        sending: u.sending,
        dbID: u.dbID,
        turnID: Number.MAX_SAFE_INTEGER,
    };
}
function hasVisibleOutput(d) {
    return (d.content !== '' ||
        d.reasoning !== '' ||
        d.iterations.length > 0 ||
        d.genui !== '' ||
        d.activeTools.length > 0 ||
        d.streamingTools.length > 0);
}
/** frozen 的进行中工具标 error（cancel 语义 —— "已渲染内容永不误导"）。 */
function markError(t) {
    return t.status === 'running' || t.status === 'generating' || t.status === 'pending'
        ? { ...t, status: 'error' }
        : t;
}
/** cancel 时正在执行的工具折进最后迭代（渲染层从 iterations 读工具）。
 *  最后迭代已存在 → 合并 tools；不存在（iterations 空）→ 追加含工具的迭代。 */
function foldToolsIntoIterations(its, tools, lastIter) {
    if (tools.length === 0)
        return its;
    const arr = [...its];
    const idx = arr.findIndex((it) => it.iteration === lastIter);
    if (idx >= 0) {
        arr[idx] = {
            ...arr[idx],
            tools: [...arr[idx].tools, ...tools],
            toolCount: (arr[idx].toolCount ?? 0) + tools.length,
        };
    }
    else {
        arr.push({ iteration: lastIter, content: '', reasoning: '', tools: [...tools], toolCount: tools.length });
    }
    return arr;
}
