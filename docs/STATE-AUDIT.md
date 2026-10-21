# 状态审计（STATE-AUDIT）—— 协议字段 × 状态迁移 × 对账清点

> 用户 2026-10-21 要求：**完整梳理状态问题、状态机设计、后端每一个接口每一个字段一个都不能漏**；
> 找漏传字段 / 错误状态变更；**尽量减少对账**（不靠对账兜底）；前后端一起修。
>
> 本文分四部分：
> §1 协议字段表（后端真源）· §2 前端映射表（逐字段对账）· §3 状态机迁移表（允许 / 禁止）
> · §4 对账与看门狗清点（只读 or 删除）。

---

## §1 协议字段表：`protocol.ProgressEvent`（`xbot/protocol/events.go`）

> 客户端 **唯一**消费的 progress 载荷形态。⛔ 任何字段只要"有时传有时不传"，
> 前端就必须按**三态**（缺失=不动 / null=显式清除 / 值=覆盖）处理 —— 否则就会出现
> 「goal 抽搐」「todos 延迟」这一类事故。

| JSON key | Go 类型 | omitempty | 语义 | 客户端消费 |
|---|---|---|---|---|
| `chat_id` | string | ✓ | 归属会话 | 路由过滤 |
| `seq` | uint64 | ✓ | per-run 单调序号（丢弃回放） | 乱序/回放门禁 |
| `phase` | string | ✓ | `turn_started` / `done` / `` (流式或结构帧) | 事件分类 |
| `turn_id` | uint64 | ✓ | 回合号（0=无回合，如命令/通知旁路） | 回合归属 |
| `turn_start` | TurnStartInfo | ✓ | `{trigger, content, request_id, sender_name}` | user 行物化 |
| `iteration` | int | ✗ | 迭代号（1 起） | 迭代归属/去重 |
| `content` | string | ✓ | 该迭代正文（结构帧） | 正文 |
| `reasoning` | string | ✓ | 该迭代思考（结构帧） | 思考 |
| `tool_calls` | []ToolCallSnapshot | ✓ | 结构快照里的工具调用 | 工具 |
| `active_tools` | []ToolProgress | ✓ | **在飞**工具（含"整批先标 pending"语义） | 在飞 pill |
| `completed_tools` | []ToolProgress | ✓ | 已完成工具 | 已提交 pill |
| `streaming_tools` | []ToolProgress | ✓ | 流式帧里的在飞工具 | 在飞 pill |
| `iteration_history` | []ProgressEvent | ✓ | 已提交迭代（可折叠 `tools_folded`） | 历史块 |
| `iteration_regions_before` | int | ✓ | 更早区域数（分页窗口） | 分区加载 |
| `tools_folded` | bool | ✓ | 历史块工具详情已折叠 | 轻量水合 |
| `todos` | []TodoItem | **✗（无 omitempty）** | **会话级** todo 列表 | 面板 |
| `goal` | *GoalInfo | ✓ | **会话级**目标；`{objective:"",status:"cleared"}` = 显式清除 | 横幅 |
| `token_usage` | *TokenUsage | ✓ | **会话级**用量 | 详情面板/环 |
| `cwd` | string | ✓ | **会话级**工作目录 | 详情面板 |
| `questions` | []AskUserQuestion | ✓ | ask_user 载荷 | 弹层 |
| `request_id` | string | ✓ | 乐观 user 行绑定键 | sending 结算 |
| `stream_content` | string | ✓ | 累积正文检查点 | 打字机 |
| `stream_delta` | string | ✓ | 正文增量 | 打字机 |
| `reasoning_stream_content` | string | ✓ | 累积思考检查点 | 打字机 |
| `reasoning_stream_delta` | string | ✓ | 思考增量 | 打字机 |
| `genui_content` | string | ✓ | GenUI 流式载荷 | GenUI 卡 |
| `stream_tokens` | int64 | ✓ | 流式 token 计数 | 指标 |
| `stream_stats` | *StreamStats | ✓ | tokens/s、TTFT、total | 指标徽章 |
| `history_compacted` | bool | ✓ | 历史被压缩 | 分区提示 |
| `resync_required` | bool | ✓ | 服务端要求重载 | 触发一次权威重载 |
| `elapsed_wall` | int64 | ✗ | 迭代耗时 | 详情 |

**⚠️ 第一条已确认缺陷（本审计前已修）**：`todos` 是**会话级**字段、**不带 omitempty**
（服务端总是给），但客户端 `normalize` 的**流式分支**（`stream_content` 等载荷存在时走
`streamEventFrom`）此前**没有读它** ⇒ turn 进行中几乎每帧都走流式分支 ⇒ todos 要等
`phase_done`（无流式载荷）才进状态机 ⇒ 用户亲报「todo_write 之后要等回合结束才更新」。
已修（`normalize.streamEventFrom` 现在带 `todos`/`goal`，`reduce` 的 `stream` 分支先应用）。

---

## §2 前端映射表（`entry/src/main/ets/core/normalize.ts`）

> **审计基准**：`protocol.ProgressEvent` 32 字段（§1）逐条对照。下表"未读"列 = 客户端**不消费**；
> 只有**带语义**的未读才列为缺陷（带 ⚠️）。

| 帧（分流） | 读 | 未读（⚠️ = 有语义，需处理） |
|---|---|---|
| `phase=turn_started` | `turn_id`、`seq`、`turn_start.turn_start.{trigger,request_id,content}` | todos/goal/token_usage（后端**本就不带**，见 §5-B1）；`iteration`（语义为 0，无意义） |
| `phase=''` + 流式载荷 | `turn_id`、`seq`、`iteration`、`stream_content`、`reasoning_stream_content`、`streaming_tools`、`genui_content`、`stream_stats`、**todos**、**goal**（2026-10-21 补） | ⚠️ `stream_delta`/`reasoning_stream_delta`（后端 `delta_push` 默认关，**恒发全量** ⇒ 安全；已在代码注释声明）；`stream_tokens`（仅指标，`stream_stats` 覆盖） |
| `phase='done'` | `turn_id`、`seq`、`iteration_history`、todos、goal | ⚠️ `token_usage`（回合末最后一次用量丢失，UI 由 REST 补）；`history_compacted`（前端不重建，靠 `history_replaced` 兜）；`resync_required`（SSE 帧上不可达，见 §5-B5） |
| `iteration`（结构帧） | `iteration`、`seq`、`content`、`reasoning`、`active_tools`、`completed_tools`、`iteration_history`、todos、goal、`sub_agents`、`token_usage`、`stream_stats`、`turn_id` | `tool_calls`（后端**无生产者**）、`elapsed_wall`（无生产者）、`questions`（走独立 ask_user 信封）、`request_id`（只在 turn_start 里）、`cwd`（走 REST）、`iteration_regions_before`/`tools_folded`（在 `agent_normalize.ts` 的**元素级**读取） |
| `stream_content`（旧信封） | 同流式帧 + **todos/goal**（2026-10-21 与其他流式入口同源） | 同上 |
| `text` | `turn_id`（顶层/metadata）、`metadata.command_reply`、`content`、`progress_history`、`cancelled` | `seq`（设计如此：text 不推进水位） |
| `session` | `action` → `busy/idle/agent-busy/agent-idle`（2026-10-21 起四值全认） | `history_rewound`/`subagent_*`/`renamed`（各自有专门信封路径） |
| `user_echo`/`inject_user` | `content`、`turn_id`、`request_id ?? id`、`is_notification` | 嵌套 `turn_id` |
| `queue_state` | `queue_state.items` | 每项字段归一（渲染层各自兜） |

## §3 状态机迁移表（允许 / 禁止）

### §3.1 `busy`（`ChatState.sessionRunning`）

| 迁移 | **唯一允许的触发** | 实现位置 |
|---|---|---|
| false → true | ① 本会话 SSE `turn_started`；② 本会话 SSE `stream`/`iteration`（lazy 采纳）；③ 用户发送后的**乐观** `session_running(true)`（意图窗口） | `reduce.ts` 各 case / `store.send` |
| true → false | ① **收到没有 toolcall 的迭代**（`phase_done` / `text_final` 收尾，`hasFreshPhaseDone` 按 turnID 校验）；② **后端明确 idle**（SSE `session`/`session_running(false)`） | `store.applyLocalIdle`（仅这两处） |

⛔ **禁止**：会话树轮询（`/api/session-tree` 的 `running`，粗粒度全局态）、`history_replaced`
（DB 快照滞后）、任何看门狗（busy-without-live-turn / live-stall / probe）**写** busy。

**2026-10-21 定稿补充（F9）**：`session(idle)` 属于"②后端明确 idle" ⇒ **必须**让 busy 复位。
旧实现在 `sessionRunning` 为 true 时直接 `return s`（为绕服务端"旧轮迟到 idle"的 bug）——
一旦服务端只发 coarse idle，busy 就永不复位（幽灵 busy）。**服务端根因已修**
（`agent/session_idle_guard_test.go` 的 runGen 守卫）⇒ 客户端不再需要该 hack。
保留的安全边界：idle 只把 live 的 `streaming` 置 false，**绝不删除/冻结有产出的 live**
（下一帧 `stream`/`iteration` 会重新拉起 running/streaming ⇒ 自愈），因此"迟到 idle"最多造成
一次极短的 busy 抖动，不会再冻结内容。
（2026-10-21 修：对账不再 `pushEvent(session_running)`；`history_replaced` 只 `||` 打开；
`applyLocalIdle` 在发送意图窗口内直接 return。）

### §3.2 `sending`（`pendingUsers[].sending` / `turns[].user.sending`）

| 迁移 | **唯一允许的触发** |
|---|---|
| false → true | 本地 `user_sent`（乐观行入队） |
| true → false | 任一送达证据：`turn_started`（requestID / turnHint / **唯一未排队** / **内容匹配**）、任一 `iteration`、任一 `stream`、`text_final`、后端 idle、**权威历史快照里已有同内容 user 消息**；出口不变量：**有迭代/正文/思考的 turn 其 user 不得 sending**、**idle ⇒ 任何 sending 必须为 false** |

### §3.3 `goal`（`ChatState.goal`，**会话级**）

| 迁移 | 触发 |
|---|---|
| 置值/覆盖 | progress 帧携带非空 `goal.objective`（任意帧类型，含流式帧）；`get_goal` RPC 补写（打开会话 / resync / idle） |
| 清除 | **仅两处**：`status === "cleared"`（用户删除）由 `normalize.optGoal` → `applySessionFields(..., null)`；用户手点 ✕ → `clearGoalLocal()` |

⛔ 禁止：`liveProgress().goal`（turn 快照）、`history_replaced` 丢字段、`resetStateMachine` 清空、
`get_goal` 返回 `null` 时清空、空 objective 当清除。

### §3.4 `todos`（`ChatState.todos`）

| 迁移 | 触发 |
|---|---|
| 覆盖 | 任意 progress 帧（含流式帧）携带 `todos`（服务端无 omitempty ⇒ 每帧都有） |
| 本地乐观编辑 | 用户编辑 → `PendingEdit`（**3s TTL**，过期以服务端为准） |

### §3.5 `activeTurn`

| 迁移 | 触发 |
|---|---|
| 置值 | `turn_started`；lazy 采纳（`stream`/`iteration` 且无 activeTurn） |
| 清空 | `phase_done` / `text_final` / 后端 idle |

---

### §3.6 **空值 vs 无值**（严格三态，2026-10-21 用户硬要求）

每一处会写 `todos` / `goal` 的入口都必须回答"字段缺失"与"明确的空"的差别，⛔ 不得把二者混用：

| 入口 | 字段缺失 / `undefined` | 明确的空 | 有值 |
|---|---|---|---|
| `normalize.optTodos` | `undefined`（不动） | `[]`（清空） | 覆盖 |
| `normalize.optGoal` | `undefined`（不动） | `status:'cleared'` ⇒ `null`（用户显式删除） | 覆盖 |
| `applySessionFields` | 不动 | `[]` / `null` 清除 | 覆盖 |
| `history_replaced`（DB 快照） | `todosAuthoritative:false` 或 `goal:undefined` ⇒ **保留本地** | `todosAuthoritative:true + todos:[]` / `goal:null` ⇒ 清除 | 覆盖（**仅当无 live turn**） |
| `store.loadStatus`（REST） | `todos` 字段缺失 ⇒ `undefined`（保留） | `[]` ⇒ 清空 | 覆盖 |
| `store.loadGoal`（`get_goal`） | `null`/失败 ⇒ **不动**（不是"删除"） | 只有 progress 帧的 `cleared` 或用户手点 ✕ | 覆盖 |

**快照覆盖的第二判据（同一事实的"新旧"）**：`history_replaced` 是**持久化权威但可能滞后**——
只有当**没有 live turn**（即本地不可能有更新的编辑）时才采信快照的三态；有 live turn 时
本地更新（`todo_write` 刚发生）优先，否则面板会闪回旧列表（既有 REPRO 用例钉住）。

## §4 对账与看门狗清点

| 路径 | 位置 | 动作 | 是否写状态机 |
|---|---|---|---|
| 会话树 `running` 对账 | `store.loadSessions` | 只更新侧边栏 `sessions[i].running` | ❌（2026-10-21 起） |
| `history_replaced`（DB 快照） | `reduce.ts` | 行/迭代 union；running 只 `||` 打开 | 只打开 |
| `applyLocalIdle` | `store` | 仅 PhaseDone / SSE idle 两处调用 | ✅（合法） |
| `watchBusyWithoutLiveTurn` | `store` | 只读重载（静默 ≥3s + 30s 冷却） | ❌ |
| `checkLiveSignalStall` | `pages/Index` | 只读重载（静默 ≥3s） | ❌ |
| `probeActiveStall` | `store`（`core/liveprobe`） | 轻量 `get_active_progress` 判定 stall → 强制重载 | ⚠️ **仅在**「服务端明确无在飞 + 本地 busy + 事件静默 ≥3s」三条同时成立时收尾 busy（= 用户规则里的"后端明确 idle"，且是**本会话**权威快照，不是会话树） |

**原则**：对账只能带来「**更新内容**」，永远不能带来「**状态降级**」（唯一例外：**本会话**权威
快照 `get_active_progress` 明确说"无在飞" **且** 事件静默 ≥3s ⇒ 等价于"后端明确 idle"）。

⚠️ **已知失效契约（2026-10-21 审计）**：`intentIdleAt` 与 `runningAfterReconcile` 目前在
`loadSessions` 里被 `void` 掉（不再写状态机）—— 文中"15s SSE 意图窗抑制对账"的描述**已不适用**；
保留字段仅作后续可能的只读判定输入。

---

## §4.1 第三轮复验新增的修复（2026-10-21 夜间，均带判据）

| 编号 | 缺陷（代码可逐行验证） | 修法 |
|---|---|---|
| F1 | `lastEventAtMs` 只在单条 `pushEvent` 刷新，而主 SSE 入口是**批量** `pushEvents` | 批量入口也刷新 |
| F2 | `watchGapReload` 在 `resetStateMachine()`（内部已保留 running/goal/todos）后**又** `initialChatState()`；且其 `loadHistory()` 被自身在飞闸门丢弃 | 删除重复重建；在飞闸门改为**排队**并在 `finally` 消费 |
| F3 | `loadStatus` 无条件用 REST 快照覆盖 `state.todos`（REST 是请求发起时刻的旧值） | `hasLiveTurn()` 时不写 todos |
| F4 | `send` 的 ack 回包无身份守卫 ⇒ 跨会话把新会话标 busy | 回包落状态前校验 `chatGen + chatId` |
| F5 | `subscribe()` 在 `sse.state=open` 时直接 return 且不比对目标 chat ⇒ 新建/切会话仍订阅旧 chat | 订阅前 `sse.close()` |
| F6 | `disposed` 只声明不赋值 ⇒ 已淘汰 store 仍每 5/30s 轮询 | dispose 置位 + 轮询链自检 |
| F7 | 退役乐观行的"快照已有"计数取自**合并后** turns（含本地 live turn） | 只从 `ev.turns` 计数 |
| F8 | 任一 iteration/stream 清掉**所有** pending 的 `sending`（A 送达 ≠ B 送达） | 只结算 FIFO 第一条 |
| F9 | `turn_started` 绑定顺序让位置启发式优先于内容匹配 ⇒ 两条在飞消息内容对调 | 内容匹配提前 |
| F10 | busy 迁移日志 `wasBusy` 在赋值**之后**读 ⇒ 恒不触发 | 与 `lastLoggedBusy` 比较 |
| F11 | 切会话恢复 todos 的 `length > 0` 把"服务端明确清空"当"没有" | 按三态 |
| F12 | `sessions: null`（Go nil slice）被折成 `[]` ⇒ 侧栏瞬时清空 | null = 未携带，保留旧列表 |
| F13/F14 | 后端 goal/内置命令帧**整对象替换**权威快照；内置命令帧把 **nil** 写进快照（反向清掉 todos/goal） | 字段级 `updateSnapshotFields` + 填权威值 |
| F15 | 后端 `activeTurnID` 只写不复位 ⇒ 回合外事件带旧 turn 归属 | 收尾 `clearActiveTurn()` |
| F16 | goal 的 cleared 只在一次性事件，快照无 tombstone ⇒ 跨客户端/重载后清不掉 | `GoalManager` 墓碑 + 快照回填 |

## §4.2 第三轮盲审（10 个同题子代理）修复与本轮未闭环

**已修（均带判据/回归）**：

| 来源 | 缺陷 | 修法 |
|---|---|---|
| final-1 确证-1 | 用 `activeTurn === null` 当"没在跑"，而权威 idle 有意保留 `activeTurn` ⇒ 快照里的 todos/goal 永不采信 | 抽 `liveRunningIn()`（live && streaming，与 `store.hasLiveTurn` 同源） |
| final-1 确证-2 | `turn_started` 无单调门（无 seq 字段）⇒ 回放里旧 turn_started 收尸在跑回合 | `ev.turnID < lastTurnIDOf(s) ⇒ return s` |
| final-1 确证-3 | 被时间窗挡下的 idle 被**丢弃**（兜底又不能关 busy）⇒ 永久「思考中」 | `scheduleIdleRetry()` 2100ms 后补判一次 |
| final-1 确证-5（后端） | `ClearGoal` 顺手回写 todos（与 todo 无关的操作会清空面板） | 只写 goal 字段 |
| final-8 C1 | 出口不变量顺序反了 ⇒ 一次迟到 idle 后下一帧清掉**所有** pending 的 sending | 先 `satisfyRunningInvariant` 再 `settleSendingInvariant` |
| final-8 C2 | `session_idle` 与 `session` 不对称（前者不清 running）⇒ 永久 cancel | 对称复位 |
| final-8 C3 | `history_rewound` 用 `initialChatState` 清掉 goal/todos/running | 改走 `resetStateMachine()` |
| final-8 C4 | 探针用 `authoritative=true` 绕过 live-turn 闸 ⇒ 长工具期误关 busy | 改走非权威路径 |
| final-2 C1 | `user_sent` 当帧被"idle ⇒ 清所有 sending"抹掉 ⇒ **空闲后第一条**不显示「发送中」 | `user_sent` 当帧跳过该清理 |
| final-2 C2 | `history_replaced` 幂等短路漏比 `goal`/`standalone` ⇒ 目标更新被吞 | 加入短路条件 |
| final-5 F3 | `stream` 无条件 `streaming:true` ⇒ **重放帧**复活 busy（web 有 freshFrame 守卫） | `seq <= lastSeq` 不复活 |
| final-5 F5 | 快照采信用**旧** `activeTurn` ⇒ 切回运行中会话时旧快照覆盖新事件值（闪一下） | 用合并后的 `turns[activeTurn]` |
| final-5 F6 | `busy` 与 `sessionRunning` 可被写成相反值 | 同值 |
| final-9 / final-3 | **会话级字段帧（todos/goal）被当成 turn 活动事件** ⇒ 清空在飞工具 + 复活 busy | `normalize` 前置判定 → `session_fields` |

**本轮仍未闭环（明账）**：

1. **F1（final-5）** `normalize` 把缺失的 `active_tools`/`completed_tools` 折成 `[]`（三态丢失）。
   现状：真正缺这两个字段的帧（todos/goal-only）已被上表最后一条**分流到 `session_fields`**，
   不再进入 `iteration` 分支；引擎侧结构帧恒填这两个数组 ⇒ 当前无可达触发路径。
   若将来有新发射点不带这两个字段，需把 `normalize` 改为保留 `undefined`、`reduce` 走 `prev`。
2. **F2（final-5/final-10 C1）** `attachNotificationWhileLive`（通知 turn 不得抢 activeTurn）
   **结论：按设计不接线（不是漏修）**。
   · 服务端保证只在**回合收尾后** drain 通知/排队消息（`agent/agent.go` 的 drain 点都以 busy
     为闸门），期间注入走 tool message；
   · 本仓 `reduce.test.ts` 的 REPRO 2026-10-18 明确钉住"回合结束后 dequeue 的通知 turn
     **必须**接管 activeTurn 并物化 user 行"——这正是旧实现（用该函数冻结）造成的 P0；
   · 因此若主 turn 真在流式中收到 notification `turn_started`，那是**服务端 bug**
     （按用户规则：后端乱发就修后端），客户端不应以冻结主 turn 的方式兜底。
   若将来服务端引入"回合中注入"，必须先在协议上加显式 `mid_turn` 标记再接线。
3. **F4（final-5）** reduce 侧粗粒度 idle 的 `if (s.sessionRunning) return s` 闸门**有意不恢复**：
   与用户 2026-10-21 的硬规则「后端明确 idle 必须复位 busy」冲突。迟到的旧轮 idle 由
   ①`turn_started` 单调门 ②`stream` freshFrame 守卫 ③探针三重条件（服务端无在飞 + busy + 静默 3s）
   共同兜住，最坏只造成一次极短抖动（下一帧自愈）。
4. **final-10 C3** `settlePendingSending` 在非 turn-end 分支清"第一条"、尾部收编"最后一条"
   （顺序不一致）。当前影响局限于"两条同发 + ack 缺失"的极少见组合。**未修**（需先补判别力用例）。

## §4.3 **收敛后的唯一契约表**（2026-10-21 夜间定稿，一次性收敛，不再打补丁）

> 用户要求「不要一直叠补丁」。下面把此前来回改过的地方**一次定死** —— 每个事实只有一个真源、
> 一张写入者表；实现只有一处。⛔ 以后任何改动必须先改这张表，再改代码。

| 事实 | 唯一真源 | **全部**写入者（穷举） | 明确禁止 |
|---|---|---|---|
| `busy` | `ChatState.sessionRunning` | ① `turn_started` / `stream`（fresh）/ `iteration` ⇒ 开（出口的不变量统一开）；② `phase_done`/`text_final`（同 turn）⇒ 关；③ 后端 idle（`session`/`session_idle`/`session_running(false)`）⇒ 关（发送意图/静默窗口内**排队**补判，不丢弃）；④ `history_replaced` ⇒ `ev.active !== null`（**快照权威**，无 OR）；⑤ 发送乐观 `session_running(true)` | 会话树轮询、看门狗、`resync`、`resetStateMachine`（同会话保留）**均不得**写 |
| `sending` | `pendingUsers[].sending` / `turns[].user.sending` | 开：仅 `user_sent`；关：任一送达证据（`turn_started` 四条绑定 / `iteration` / `stream` / `text_final` / 后端 idle / 权威快照里已有同内容 user）+ 出口不变量 ①（有产出的 turn 的 user 不得 sending）。**非 turn-end 只结算 FIFO 第一条** | 不得 map 全清；不得在 `user_sent` 当帧清 |
| `goal` | `ChatState.goal`（会话级） | ① progress 帧（含流式/turn_started）三态；② `get_goal` 补写（`seenGoal` 守卫，**null 不清**）；③ 用户 ✕（`clearGoalLocal`）；④ 快照 `history_replaced`（仅无 live-streaming 时采信） | ⛔ `liveProgress().goal`、`resetStateMachine`、空 objective 当清除 |
| `todos` | `ChatState.todos` | ① progress 帧三态（含流式帧）；② `get_goal` 同款的 REST 补写（`seenTodos` 守卫、无 live 才采信）；③ 本地编辑闸（3s TTL）；④ 快照（仅无 live-streaming，`todosAuthoritative` 才采信） | ⛔ 缺字段折成 `[]`；⛔ 有 live turn 时被 REST/快照覆盖 |
| `activeTurn` | `ChatState.activeTurn` | `turn_started`（单调门：更旧整帧丢弃）/ lazy 采纳；清：`phase_done`/`text_final`/后端 idle | 快照不得把**已结束**的 turn 复活成 live（棘轮） |

**实现位置**：`reduce.ts:liveRunningIn`（唯一"真在飞"判据，`store.hasLiveTurn()` 同源）、
`reduce.ts:settleSendingInvariant`（唯一 sending 出口不变量）、
`reduce.ts:satisfyRunningInvariant`（唯一"活动 ⇒ 开 busy"出口）、
`store.ts:applyLocalIdle`（唯一"关 busy"路径，含排队补判）、
`normalize.ts`（唯一三态归一：缺失=undefined / 空=清空 / 值=覆盖）。

## §5 审计结论与本轮修复

### §5.1 后端（`fix/state-protocol-audit` 分支）

| # | 缺陷 | 位置 | 修法 |
|---|---|---|---|
| B1 | `turn_started` **覆盖** `lastProgressSnapshot` 却不带 todos/goal ⇒ 从 turn_started 到首个 iteration 的断线窗口里，`GetActiveProgress` 给 `todos:null` + 无 goal | `agent/agent.go:emitTurnStarted` | payload 补 `Todos`（`GetTodos`）+ `Goal`（`GoalManager.GoalInfo`） |
| B2 | 内置命令 `done`（`/compress`、`/new`）之后快照被删；合成 done 分支不带 todos ⇒ 清空后的列表学不到 | `agent/agent.go:emitBuiltinProgressDone` | payload 补 `Todos` |
| B3 | `cloneProgressEvent` 用 `append([]T(nil), src...)` ⇒ **空数组折成 `null`**；`Todos` 无 omitempty，客户端按 `null`=未携带 / `[]`=显式清空 区分 ⇒ `todo_write([])` 的清空语义在 fan-out 克隆路径**丢失** | `agent/interactive.go:cloneProgressEvent` | 显式区分 nil / 空数组（`make` + `copy`） |
| B4 | `session tree` 的 `running` 字段无 omitempty（false 显式 false）—— 客户端已按"粗粒度全局态，不写单会话状态机"处理（见 §4） | `serverapp/callbacks.go:996` | 客户端侧修（不改协议） |
| B5 | `ProgressEvent.resync_required` 只有 **CLI RPC**（`get_active_progress`）可达；web 的 SSE/REST 走 `FetchAll` ⇒ 该字段在 web 链路上**不可达**；web 的等价信号是**传输层** `MsgTypeResyncRequired` | `agent/agent_backend_methods.go:300-303` vs `serverapp/callbacks.go:299/355` | 客户端**两条都认**（payload 字段 + `resync_required` 事件名）；协议语义在本文 §1 注明 |
| B6 | `emitSessionIdleIfNoActiveRun` 的"无活跃 run"检查与 `emitSessionState` **非原子**（窄窗口内新 run 刚注册 ⇒ 旧轮 idle 落到新一轮） | `agent/agent.go:1758-1766` | 见下（本轮未改，登记为已知窄窗口；`runGen` 路径已覆盖正常收尾） |

**判据**：`agent/progress_session_fields_test.go`
· `TestEmitTurnStarted_CarriesSessionFields`（turn_started 必须带非 nil todos）
· `TestCloneProgressEvent_PreservesEmptyTodos`（`[]` 不得折成 `null`；`nil` 保持 nil）
（`go test ./agent/ ./protocol/` 全绿，22.5s / 1.4s。）

### §5.2 前端

| # | 缺陷 | 修法 |
|---|---|---|
| F1 | `session` 帧只认 `busy/idle`，`agent-busy`/`agent-idle` 被丢 ⇒ 粗粒度 idle 到不了状态机（"有产出但 busy 不复位"死角） | 四值全认（`normalizeSession`），与 `streammerge.isIdleAction/isBusyAction` 同集合 |
| F2 | 两条流式入口不同源：`normalizeStream`（旧信封）漏 `todos/goal` | 补齐，与 `streamEventFrom` 一致 |
| F3 | `turn_started` 帧若并存流式载荷 ⇒ 整个流式部分被丢（与 done/iteration 不对称） | 返回 `[stream, turn_started]` |
| F4 | todos **两个来源**：页面读 REST `store.todos`，事件驱动的 `state.todos` 没有出口 ⇒ 「todo_write 立刻更新」看不见 | `state.todos` 成唯一真源：`store.todosNow()`；REST 快照经 `applySessionFields` 并入（`toStateTodos` 显式映射两套 `TodoItem`） |
| F5 | `hasLiveTurn()` 与看门狗判据不同源（"live 但已停流"被当在飞 ⇒ 幽灵「思考中…」） | 统一为 `streaming === true` |
| F6 | `resetStateMachine` 丢 `sessionRunning` ⇒ 断洞重载/rewind 顺手关 busy（违反"只有两种证据能关"） | 同一会话保留 running（`withSessionRunning`，.ts 提供唯一出口避开 .ets 的 spread 禁令） |
| F7 | `evIter < prev.iter ⇒ return s` 把 **gap 修复 delta** 一起丢掉 ⇒ 缺失迭代永远补不上 | 改为"**没有新迭代信息才丢**"；旧迭代帧只 union，不覆盖 live 正文/思考（`olderIter`） |
| F10 | `session_idle` 事件（同样属"后端明确 idle"）在 `sessionRunning` 为 true 时被忽略 | 与 F9 同一条规则：复位 running；只停 `streaming`，不删不冻 |
| F11 | 迟到/旧轮 idle 可能把 busy 关掉（服务端 `emitSessionIdleIfNoActiveRun` 的窄竞争窗口） | **running 自愈不变量**：`reduce` 出口检查「live 且 `streaming===true` ⇒ sessionRunning 必为 true」（活动类事件才生效，`session*` 事件豁免以免堵死 idle 闸门）⇒ 下一帧 `stream`/`iteration` 立刻把 busy 拉回 |
| F9 | `session(idle)` 在 `sessionRunning` 为 true 时被**直接忽略**（旧 hack）⇒ 服务端只发 coarse idle 时 busy 永不复位 | 删掉该 hack：**后端 idle 必须复位 busy**；只把 live 的 `streaming` 置 false（不删不冻，下一帧自愈）。服务端根因由 `session_idle_guard_test.go`（runGen）覆盖 |
| F8 | 转后台时上一迭代的思考重复渲染两段 | 只在**渲染层**去重（`render.ets:inFlightBlock`：与**任一**已提交块等长且全等 ⇒ 置空）。⛔ reduce 侧等长丢弃已撤销（会把合法的 gap 修复/AskUser 收尾文本清掉，`reduce.test.ts` 两条 REPRO 实证） |

**判据**：`todos_live_update`(3) · `send_state_settle`(16) · `goal_busy_stability`(16) ·
`live_probe`(18) · `iteration_continuity`(7) · `iteration_reasoning_leak`(6) ·
`promote_thinking_dup`(7) · `reduce`(82) · `streammerge`(101) · `resync_session_state`(14) ·
`perf_frame_bounded`(13) · `…_wiring`(21) · `render_inflight`(26) · `listfollow`(57)。

### §5.3 仍未闭环（明账，不隐瞒）

1. `token_usage` 在 `phase_done` 之外只有 REST 权威 ⇒ 回合末的精确用量可能慢一拍（UI 有 REST 兜底）。
2. `history_compacted` 前端不消费：压缩后的列表重建依赖 `history_replaced`（跑一次权威重载）。
3. B6 的窄窗口（旧轮 idle 落到新一轮）只在"AskUser 取消/陈旧自愈"两条出口上存在；正常收尾已由 `runGen` 守卫。
4. `stream_delta` 不支持：后端 `delta_push` 默认关且**恒发全量**（`agent/delta_push_test.go` 断言）。
   若将来打开，前端需同步实现增量拼接（本文登记为协议变更前置条件）。
