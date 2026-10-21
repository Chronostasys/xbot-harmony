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

## §4.4 第五轮（10 个同题盲审，2026-10-21 深夜）已修 / 未修

**已修**（按用户"做减法、不叠补丁"）：

| 项 | 缺陷 | 修法 |
|---|---|---|
| s0 | 被判陈旧的帧仍先写了 todos/goal（随后整帧丢弃）⇒ 回放帧打回旧值 | `reduceInner` 捕获入参 `s0`，丢弃帧返回 `s0`；会话级字段移到闸门之后 |
| 异步串台 | `rewindTo` / `loadEarlierRegions` / `fetchIterationDetail` / `loadCronTasks` / `loadBgTasks` await 后无身份校验 | 统一 `chatGen + currentChatId` 守卫 |
| dispose | 漏 15s fail-safe 定时器与 `sse.onState` | 补清理 + onState 置空 |
| seenTodos | REST todos 用"到达时"的 live 判据采信"请求时"的旧值 | 加 `seenTodos` 引用守卫（同 `seenGoal`） |
| historyLoading | 跨代无条件清标志 ⇒ 骨架屏提前退场 / 并发重载 | 只在"仍是当代"时清 |
| syncFrom | 页面缓存 `this.busy` 与 `store.busy` 两个口径 | 三处判定统一用 `store.busy` |
| 棘轮（后端） | 陈旧 `active_progress` 可作为 active 返回 ⇒ 已结束 turn 被复活成 live ⇒ busy 关不掉 | 服务端一条规则：快照 TurnID 必须仍是当前 turn，否则降级 `done` |
| 死代码 | `attachNotificationWhileLive`（零调用 + 语义与 REPRO 相反）、`LiveTailState`/`ChatRow.liveTail`/store 死字段 | 全部删除（-133 行），`AGENTS.md` 旧指引标注作废 |
| reset 看门狗 | `resetStateMachine` 保留 running 却清 activeTurn ⇒ 每 30s 重拉整段 history | 重置后 15s 内豁免看门狗（已知状态） |
| busy 镜像 | `withSessionRunning` 只写 `sessionRunning` ⇒ 与 `busy` 分叉 | 同写两者 |

**未修（明账，均有明确判据/复现路径）**：
1. `ChatState.busy` 字段本身未删（需改 14 处写点 + 测试夹具；已保证不分叉）。
2. ~~`rewindTo` 的 `resetStateMachine` 在 send 之前仍会清掉本地乐观行~~ ⇒ **已删**：`loadHistory()` 会用 `history_replaced` 整体替换，reset 只是先清空一帧（可见闪烁），语义等价（`7c8c50a`）。
3. 后端 `emitSessionIdleIfNoActiveRun` 的检查/发送仍非原子（客户端有 turn_started 单调门 +
   freshFrame + 探针三重兜底，最坏一次极短抖动）。
4. `stream_delta` / `reasoning_stream_delta` 仍不消费（后端 `delta_push` 默认关且恒发全量）。
5. 第五轮其余报告（fe-render-1 / fe-store-1 / be-state-1 / backend-state / gate-1/2/4/5/7/8/9/10）
   的窄边界条目尚未逐条落地 —— 每条都需要先写复现实验再改（用户要求不再"叠补丁"）。

## §4.5 后端状态字段审计（be-state-1）已修

| 缺陷 | 修法 | 判据 |
|---|---|---|
| `clone` 路径把 `[]` 折成 `nil`：`channel/cli/cli.go`（TUI 转发副本）、`agent/progress.go:StructuredProgress.Clone()` | 显式区分 nil / 空数组（`make`+`copy`） | `go test ./channel/cli/ ./agent/` |
| `turn_started` / `refreshStructuredTodos` 无 goal 墓碑 ⇒ 清除后帧里**没有 goal 键**，客户端学不到"已清除" | 两处补 `Tombstone()` 回退 | `go test ./agent/` |
| `notifyProgress` 的 todos 刷新在 `autoNotify` 早退**之后** ⇒ Web/CLI（`autoNotify=false`）的结构化帧永远带旧 todos | 刷新提到早退之前（仍在 `progressMu` 内） | 同上 |
| `ClearGoal` 帧携带 `GetTodos()` ⇒ 该键无 todos 时返回 `[]` ⇒ 客户端按「`[]`=清空」**清空 todo 面板** | 该帧不再携带 `todos` | 同上 |
| `emitBuiltinProgressDone` 是**唯一不 clone** 的 fan-out 点，而 CLI 的 `SendProgress` **就地改写** payload ⇒ 跨渠道污染 + 数据竞争 | 补 `cloneProgressEvent` | 同上 |
| goal 读取键有**三个来源**（`ch:chatID` / `todoKey()` / `s.sessionKey`）⇒ 跨渠道浏览时系统提醒读不到 goal | 统一 `s.todoKey()` | 同上 |
| `GetActiveProgress` 直接返回快照的 todos（副本）⇒ 重连后可能下发旧列表 | 以 `TodoManager` 刷新；管理器为空且快照非空时保留 | 同上 |
| `ActiveTools`/`CompletedTools` 是 `omitempty`，nil 时**键消失** ⇒ 「无工具」与「未携带」无法区分（同迭代内 promote/取消后 pill 一直转圈） | 恒发非 nil（空即 `[]`） | 同上 |

⚠️ **这些后端修复需要重启后端才生效**（本地 launchd 托管）。客户端修复无需。

## §4.6 第六/七轮：门禁断言层修复 + 结构性收敛（2026-10-21）

**最重要的发现（根因级）**：`tools/tests/run.sh:56` 用**一个 tsc program** 编译全部测试副本，
而 **203 个 `*.test.ts` 没有 `export {}`**（是脚本不是模块）⇒ 顶层 `const fail/pass/require`
全落同一全局作用域、两两重名 ⇒ **编译失败** ⇒ 真门禁 ① 打印"共 0 个测试文件，0 个失败
（但编译失败 ⇒ 判红）"：**断言层从未执行**。补齐模块作用域后一次暴露 29 个失败文件。

结构性收敛（全部"减判据/减特例"，不是加守卫）：

| 改动 | 结构含义 | 判据 |
|---|---|---|
| 会话级字段（todos/goal）移到 `iteration`/`stream` 的**所有闸门之后** | 陈旧帧**零写入**；删掉"轻帧特例"（`normalize` 已把轻帧分流成 `session_fields`） | reduce 82 / state_invariants 36 |
| `sending` 只有 `user_ack`/`user_fail`/回合收尾三个证据 | 一条别的 turn 的帧不再结算"发送中" | send_state_settle 16 / send_optimistic_running 16 |
| 后端 `SessionEvent.turn_id` + 前端"idle 只对**它指向的那一轮**生效" | 旧轮迟到 idle 不再把新一轮降成 idle（同一个规则同时消除"卡 busy"与"idle 抽搐"） | 新增 ②c/②d 判据 |
| `GoalManager.Tombstone()` 用于 `turn_started`/`refreshStructuredTodos`/`GetActiveProgress`/**`GetGoal`** | "已清除"在协议上可表达；前端三态（`cleared` ⇒ 清除） | goal_busy_stability 16 |
| `resumeActive` 默认 **true** | standalone store 按定义 active；进池才显式置 false（少一个"必须记得置位"的隐式契约） | gap_reload_wiring / store_null / send_optimistic_running 转绿 |
| `syncLiveTail` 投递门控只留**整数代际**（`liveRevision`） | 删掉 `liveBlocks`/`liveTools` 的"数组恒等"第二道判据（正是"生成中 x 字不更新"的根因） | tools_signature ALL PASS |
| `LiveTailView`：暂停停表 **且** 回退判据改为"打字机从未启动" | 两个条件同时成立 ⇒ 暂停不再把正文打回全文（"滚动高度抖动"） | render_inflight 26 / resume_stream_tail_wiring 13 |
| `setTailPaused` 接通（onTouch） | 消除死消费（声明三路暂停、实际只接两路） | fe-render-1 #3 |
| `IterBlocksView` 删 `.translate({ x: 0 })` 空操作 | 位移只来自底座档常量 | motion_uniform 8 |

**判据漂移清单**（代码已迁移，判据没跟，全部改钉真实渲染者/函数边界，零扫描仍判红）：
`bubble_style` / `contrast_landing` / `reasoning_wiring` / `genui` / `live_key_stability` /
`flicker_guard` / `tool_pill_key` / `live_block_delivery` / `sidebar_view_state` /
`resume_resync_wiring` / `promote_tool_visibility` / `loadmore_resilience` / `tools_signature` /
`core_module_consumed`（台账改**上界**语义）/ `type_role_gate`（台账下调 4→3）。

**当前状态**：全量 388 个测试文件 **0 失败**；`bash tools/gate.sh` ⇒ `GATE_EXIT=0`（全绿）。

## §4.7 第七轮盲审（10 份）修复与**刻意保留的取舍**

第七轮 10 份独立盲审**全部**报出了确证项（⇒ 该轮不算通过）。已修：

| 来源 | 缺陷 | 修法 |
|---|---|---|
| 7-6 C1 | `history_replaced` 里 `busy` 与 `sessionRunning` 写成相反值（且不可自愈：`session(busy)` 幂等键用 `sessionRunning`） | 两者取同一权威值 |
| 7-6 C2 | `settlePendingSending(atTurnEnd=false)` 从未被调用（半死语义） | 删除（-19 行） |
| 7-6 C4 | 乐观行退役用**内容相等**当身份 ⇒ 「继续/好」等同文消息被误退役（气泡闪一下消失又出现） | 内容配对只认"快照里**最新那条** user 消息"；身份仍是 requestID/dbID |
| 7-1 C2 | 会话级轻帧丢掉服务端 `Seq` ⇒ 唯一没有排序闸门的状态写入（todo/goal 跳回旧值） | 轻帧带水位，陈旧零写入，与另外三条路径同源 |
| 7-2 A2 | `cancel()` 的乐观 idle 不带 turn 身份 ⇒ 取消 A 时把已 dequeue 的 B 判 idle | 只在"发起取消那一轮仍是当前轮"时推，并带 `turnID` |
| 7-8 C1 ★ | `sending` 出口不变量在**任何**非 `user_sent` 事件上收敛 ⇒ POST 途中被标"已发送"，失败后 `user_fail` 删行 = **消息静默消失** | 只允许"送达/收尾证据"事件触发兜底 |
| 7-8 C2 | `cancelInFlight` 跨会话单例、`beginSwitch` 不复位 ⇒ B 的取消请求根本没发 | 记 `chat+gen` 身份，切换时复位 |

### 刻意保留的取舍（不是漏修，是判据冲突下的选择）

**7-2 A1：无 `turn_id` 的 `session(idle)` 仍会降级正在流式的回合。**
理由：把它改成"无身份就不降级"会**打破 3 条既有判据**（`reduce` 跨会话 idle、`state_invariants`
的 idle 语义、`send_optimistic_running` ②），那些判据守的是**幽灵 busy**（更严重的用户症状：
永久「思考中」、输入框卡 cancel）。⇒ 正确方向是**让服务端每条 idle 都带 `turn_id`**
（`emitSessionIdleIfCurrent` 已带；`emitSessionIdleIfNoActiveRun` 按定义没有在跑轮次），
而不是在客户端放宽降级条件。已登记为服务端后续项。

## §4.8 **结构性收敛方案**（2026-10-21：把「不出新问题」从承诺变成机器判据）

背景（用户的原始质问：「为什么每次改完都有新 bug」）：前八轮都是**同一类**缺陷 ——
"某个路径忘了写 X"。根因不是修得少，而是**规则的存在形式**错了：

> 规则是**分散在几十个 handler/异步回包里的纪律**，每个新路径都必须重新记住全部规则。
> 只要"记住"依赖人，就必然会有下一个漏点。**盲审（10 个人读代码）是有限枚举，天花板就是
> 审计者的想象力。**

⇒ 结构性解法不是"再修一轮"，而是让**错误的形态不可表达**、让**漏点由机器穷举发现**。
四道机制（前三道已落地并已各自抓到确证缺陷）：

| # | 机制 | 落点 | 消灭的缺陷类 | 判据 |
|---|---|---|---|---|
| S1 | **不变量可执行化**：把"正确"写成纯函数，返回违反清单 | `core/state_invariants.ts`（I1–I9） | "某条规则没人执行/没人验" | `tools/tests/state_fuzz.test.ts` 每步断言 + 全部历史回归终态断言 |
| S2 | **机器穷举**（固定种子 fuzz，混合合法/非法帧） | `tools/tests/state_fuzz.test.ts` | "人想不到的组合"（乱序/迟到/重复/交错生命周期） | 每步 reduce 后 `invariantViolations` 必须为空；失败打印最短前缀 ⇒ 固化成回归 |
| S3 | **派生量不落库**：`busy` 只是 `sessionRunning` 的出口，不是第二个真源 | `reduce.ts` 唯一出口（R4） | "两处各写一半"（`busy=true / run=false`） | I1 + mutation（删出口归一必红） |
| S4 | **入口统一闸门**：带 seq 的帧在位次上落后 ⇒ **整帧零写入** | `reduce.ts: isStaleBySeq` | "新增一条路径就多一个陈旧帧漏点"（4 份 per-case `xxxStale` 各自写一遍） | fuzz 的「陈旧帧零写入」族（5 类帧、逐字段比较） |

### S1–S4 已抓到的确证缺陷（机器先于人）

| 来源 | 缺陷 | 修法 | 用户可见症状 |
|---|---|---|---|
| fuzz seed=32220 step=10 | `text_final` 只清 `sessionRunning`、不清 `busy` ⇒ 终态 `busy=true / run=false` | S3：出口把 `busy` 由 `sessionRunning` 派生 | **回复已显示完，输入框还挂着 cancel** |
| fuzz seed=32220 step=25 | goal 墓碑 `{objective:'',status:'cleared'}` 经 `session_fields` **漏进 state** | S4 同源：在 `applySessionFields`（写 goal 的**唯一**通道，6 条路径全覆盖）折成 `null` | GoalBanner 渲染一个空目标 |
| fuzz seed=40150 | **陈旧 `stream` 帧写正文**（覆盖语义的前缀 ⇒ 正文倒退） | S4：入口水位闸门，陈旧帧整帧丢弃 | 文字回跳/闪烁 |

### 尚未实施的两道（本方案的剩余部分）

| # | 机制 | 判据 |
|---|---|---|
| S5 | **单写入源门禁**：`busy/sessionRunning/sending/cancelling/todos/goal/activeTurn` 只允许在 `core/reduce.ts`（及 `store` 的**显式**入口）被赋值；新增第二写入点 ⇒ 门禁红 | `tools/lint/state-single-writer.sh` + allowlist（现状：`store.ets` 有 32 处直写，逐条收敛） |
| S6 | **协议双向覆盖**：`protocol/events.go` 的事件/字段集合 ⇔ `normalize.ts` 的解析分支，差集必须为空（新增后端字段而前端不解析 ⇒ 红） | `tools/tests/protocol_coverage.test.ts`（读 Go 源码的字面量 + 前端 switch 分支，双向差集） |

> 验收口径随之改变：**不再只依赖"10 份盲审零确证"**（有限枚举），而是
> `state_fuzz`（穷举）+ 全部不变量 + 盲审（语义/设计层）**三者同时绿**。
> 前者的天花板是机器的算力，后者是人的想象力 —— 只有前者能给出"不可能再出新问题"的
> 可信度承诺。

### S5/S6 落地（本轮完成）

| # | 机制 | 落点 | 判据 |
|---|---|---|---|
| S5 | **单写入源门禁**：会话生命周期字段（busy/sessionRunning/activeTurn/todos/goal/cancelling）只允许 `core/reduce.ts` 写 | `tools/lint/state-single-writer.sh` | 现状 187 文件 / 0 违规；`--self-test` 做 mutation 自证（注入 `state.busy = true` 必红） |
| S6 | **事件联合闭合覆盖**：DomainEvent ⇔ reduce 分支 ⇔ normalize 生产者的三方闭包 + 台账卫生 | `tools/tests/protocol_coverage.test.ts` | C1 闭包 / C2 生产者 / C3 反孤儿 / C4 台账不腐烂；扫到 0 处判红 |

> S6 第一次跑就抓到 **`session_idle` 是零生产者事件类型**：全仓没有任何生产路径会发它
> （后端 `agent-idle` 经 normalize 走的是 `session(busy=false)`），而它的分支里还有一条
> 与现行契约冲突的 `settlePendingSending(s, true)`（第 7-8 轮已判定「粗粒度 idle 不是送达
> 证据」）。⇒ **整个类型 + 分支删除**（-53 行），idle 只剩一个入口（`session(busy=false)`）。

### 第九轮（10 份盲审）后**结构性**修掉的项（不是补丁，都是单点收敛）

| 缺陷 | 结构性修法 | 症状 |
|---|---|---|
| `text_final` 在命令回复早退**之前**全局清 `sending` | 调到早退之后（唯一"用户回合终态"调用点） | `!cmd` 输出到达瞬间把在途消息标"已发送"，POST 失败后删行 = 消息消失 |
| idle 补判预算 3×2.1s **短于** 8s 发送意图窗 ⇒ 窗内权威 idle 被丢 | 窗内不消耗预算、等待按"窗剩多久"算（`SEND_INTENT_MS` 单源） | 极短回合/发送后立刻取消：输入框长期停在「停止/思考中」 |
| `GetTodos` 三条分支形状不一致（`[]` vs `nil`） | 一条契约：有记录（含空）⇒ 非 nil；无记录 ⇒ nil | 服务重启后 todo 面板**时清时不清** |
| `GetActiveProgress` 把「用户清空 todos」当「未水合」⇒ 回吐快照 | 判据改 `TodosHydrated`（管理器是否有记录） | 清空的列表又冒回来 |
| AskUser 取消后 `activeTurnID` 残留 ⇒ 守卫把 idle 挡掉 | 取消分支先清活动轮次，再发**带该轮 id** 的 idle | 取消 ask 后输入框停在「停止/思考中」，侧栏已是 idle |
| 点**当前会话**也走 dispose+重载（`storeFor` 每次新建） | `switchSession` 首行同会话早退 | 回合中在抽屉点自己：splash 一闪、按钮从「停止」翻回「发送」 |
| `historyLoading/hasMore/loadingMore` 镜像在滚动早退**之后** ⇒ 冻结副本 | 三项移进早退块（O(1) 布尔） | 滚动期历史已到但骨架屏不退/头项文案不更新 |
| `row.themeGen` 是**零写入者**的死字段（组件注释却宣称靠它重渲） | 删字段 + 删 `themableRowKey` 的死 `theme` 形参（-20 行） | 注释承诺的"切主题强制重渲"其实不存在 |

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
