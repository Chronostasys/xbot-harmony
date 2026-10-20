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

## §4 对账与看门狗清点

| 路径 | 位置 | 动作 | 是否写状态机 |
|---|---|---|---|
| 会话树 `running` 对账 | `store.loadSessions` | 只更新侧边栏 `sessions[i].running` | ❌（2026-10-21 起） |
| `history_replaced`（DB 快照） | `reduce.ts` | 行/迭代 union；running 只 `||` 打开 | 只打开 |
| `applyLocalIdle` | `store` | 仅 PhaseDone / SSE idle 两处调用 | ✅（合法） |
| `watchBusyWithoutLiveTurn` | `store` | 只读重载（静默 ≥3s + 30s 冷却） | ❌ |
| `checkLiveSignalStall` | `pages/Index` | 只读重载（静默 ≥3s） | ❌ |
| `probeActiveStall` | `store`（`core/liveprobe`） | 轻量 `get_active_progress` 判定 stall → 强制重载 | ❌ |

**原则**：对账只能带来「**更新内容**」，永远不能带来「**状态降级**」。

---

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
