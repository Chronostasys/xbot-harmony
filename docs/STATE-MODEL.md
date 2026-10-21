# STATE-MODEL —— 会话状态机与渲染管线的**最小模型**（重构方案，只建模、不实现）

> 状态：**方案（提案）**，不含实现。基线 `main@c2db530`（前端）+ `feat/court-orchestration@976e403b`（后端）。
> 目标：把"正确但混乱"的现状，替换为**由构造保证正确**的最小模型；**零外在表现差异**；每帧成本与
> 迭代数/行数**无关**；**不设任何兜底**（前提写进协议，而不是在客户端补救）。
>
> 本文的"删除清单"和"证明"是本文档的**主要内容**——不是"再来一层抽象"，而是**删掉 N 层**。

---

## 0. 结论摘要（先看这一节）

**现状的真实体量**：`pages/Index.ets` 13 214 行、`core/store.ets` 4 348 行、`core/reduce.ts` 2 850 行、
`core/streammerge.ets` 884 行、`core/render.ets` 836 行、`core/normalize.ts` 579 行、`derive.ts`（W3 已删除） 484 行
（合计 23 195 行，另有 395 个测试文件）。**其中"决定屏幕上画什么"的判据，被分散在 20+ 个互相兜底的函数里**。

**新模型的体量**（估算，不含 UI 组件本体）：一个 200 行的事件适配器 + 一个 350 行的 `step` + 一个 250 行的
`project` + 一个 150 行的 UI 绑定层 ≈ **950 行**，其余全部删除或退化为机械映射。

**三条根因**（全部 20+ 处混乱都是它们的分身）：

| # | 根因 | 表现（现状） |
|---|---|---|
| R1 | **同一事实多处判定**："这枚工具属于哪一轮 / 画过没有" 被 `isToolRendered`、`mergeTools`、`mergeToolRuns`、`dedupeIterationsByNumber`、`mergeIterations`、`inFlightBlock` 各判一次 | 修好一处、另一处立刻复发；"工具消失 / 工具重复"来回摆 |
| R2 | **缺失 ≠ 空集合**：`tools: []` vs 缺字段、`todos: nil` vs `[]`、goal 三态、`turnID=0` | 每个字段都要单独的"是否携带"判据与特例分支 |
| R3 | **没有唯一的新鲜度/顺序判据**：`seq` / `iteration` / `turn_id` / REST 对账 / 时间窗 混用 | `satisfyRunningInvariant`、`settleSendingInvariant`、`applyLocalIdle`、`scheduleIdleRetry`、15s 提示、无条件轮询、三种 gap 签名、`gapReloadToken`——**全是同一件事的补丁** |

**新模型的四句话**：

1. **一条有序的帧流**：每帧带 `(chat, seq, turn)`，`seq` 严格 +1。**唯一**新鲜度判据就是 `seq`；
   不连续 ⇒ **重新同步**（唯一一条恢复规则，不是兜底）。
2. **状态 = 已提交 turn 的映射 + 至多一个在飞迭代**：
   `S = (turns: TurnID ⇀ TurnRec, live: LiveIter?, sess, local)`，
   且恒有 **`live.iter = 已提交最大迭代号 + 1`**（在飞迭代永远是"下一号"，与提交块**结构上不可能同号**）。
3. **三种身份都是服务端盖的整数/不透明 id**：`turnID`、`iteration`、`callID`。
   客户端**从不推断归属**，因此"每个工具只属于一个迭代"是**输入的性质**，不是客户端的推理结果。
4. **渲染 = 纯投影**：`project(S) → Row[]`；每个迭代**恰好一块**、块的顺序即迭代号顺序；
   在飞块只承载"未提交迭代"。投影对未变化的 turn **返回同一个对象引用** ⇒ UI 层只做指针比较，
   所有字符串指纹（`rowsFp`/`structFp`/`tailKeySig`/`sessionsFp`/`queueFp`/`todosFp`）全部删除。

**"没有任何兜底"的含义（本文的定义）**：客户端**不存在**"如果 A 不成立就走 B"的分支。
所有曾经的"B"要么被证明在协议前提下不可达（⇒ 删除），要么被提升为协议前提（⇒ 由服务端保证）。
唯一的例外行为是 **按对象/整体取权威**：迭代不完整 ⇒ `pullIter`；回合未收尾 ⇒ `pullTurn`；
整体不可信（`epoch` 变化 / 断线）⇒ `snapshot`。`seq` 跳号**不触发恢复**（以最大为准、被跳号后到即丢），
`epoch` 变化 ⇒ 直接 `snapshot`）：它是模型对**所有**非法输入的唯一响应（单一出口），
不是补丁，且**不猜测**任何缺失内容。

### 0.1 一张图（数据流）

```
         ┌──────────── 服务端（唯一权威）─────────────┐
         │  会话状态机 + 每会话单调 seq(epoch)        │
         │  tick / done / final / session / keepalive │
         └───────────────┬───────────────────────────┘
                         │ 有序帧流（每帧带 epoch,seq,chat）
                         ▼
  adapter（纯 TS，15 种旧事件 → 6 种帧；后端改造后可退化为直通）   ← 可删除：normalize 的去重/合并
                         ▼
  step : (S, Frame) → S        单写者、纯函数、无定时器        ← 可删除：reduce.ts 的 15 分支 + 5 层补丁
                         ▼
        S = (turns, live, sess, local)  +  (epoch, seq)
                         ▼
  project : S → Row[]          引用稳定（WeakMap 恒等）        ← 可删除：render.ets 的在飞块判定/去重/缓存
                         ▼
  applyRows(next)              指针比较 ⇒ 只有变化的行被写     ← 可删除：7 个字符串指纹 + 两套投递机制
                         ▼
  ArkUI（组件结构与样式**不动**；会变的值由行对象/@StorageProp 订阅）
```

每帧成本：`adapter` O(载荷) → `step` O(1) → `project` O(1) → `applyRows` O(1)（只有一行变化）。
恢复路径：**按对象拉权威** —— `pullIter(turn, iter)`（缺某迭代）/ `pullTurn(turn)`（缺收尾）/ `snapshot`（整体不可信）；客户端零重建。

---

## 1. 诊断：混乱的结构性成因（不是 bug 清单）

> 说明：**当前逻辑是正确的**（用户已确认）。本节不主张存在缺陷，只指出"正确性由层层兜底维持"
> ——因此任何一处改动都可能破坏另一处的隐式前提。这正是重构的理由。

### 1.1 R1 — 同一事实多处判定

#### (a)「工具属于哪个迭代」——6 处独立判定，其中 2 处规则不同源

| 位置 | 规则 |
|---|---|
| `core/reduce.ts:237-238`（`foldKnownToolsIntoCommitted`） | `t.iteration ?? 当前提交号` |
| `core/reduce.ts:2718`（`foldInFlightToIterations`） | `t.iteration > 0 ? t.iteration : lastIter` |
| `derive.ts（W3 已删除）:473`（`foldToolsIntoIterations`，frozen 行） | **一律折进 `lastIter`**（不读 `tool.iteration`）← 与 reduce 侧不同源 |
| `core/agent_normalize.ts:191-210`（`historyProgressToLive`） | 按 `tool.iteration` 并回历史块，对不上留 live |
| `core/toolmerge.ts:109`（`detailIterationOf`） | `toolIter > 0 ? toolIter : blockIter` |
| `pages/Index.ets:4870 / 4888-4901`（详情/开关） | `detailIterationOf` + `it.iteration === want` + **名字全表兜底** |

#### (b)「工具的身份键」——5 份实现

| 位置 | 键 |
|---|---|
| `core/streammerge.ets:175`（`toolKey`） | `call_id`，**generating 时只用 `name`**，否则 `name#label` |
| `core/toolmerge.ts:48`（`activeToolKey`） | `call_id` → `name#label`（无 generating 特例） |
| `core/reduce.ts:266-269`（`mergeToolUnion` 内联） | 同上 |
| `core/reduce.ts:2742`（`sameToolKey`） | 同上 |
| `core/render.ets:105`（`isToolRendered`） | **整数号** `iteration <= maxCommitted`（完全不同类） |

#### (c)「同号迭代以谁为准」——4 套

`core/reduce.ts:141 mergeIterations`（同号四象限 + 工具并集）、`core/normalize.ts:539 dedupeIterationsByNumber`
（号 + "有无内容"含 tools 长度 + `toolsFolded`）、`core/render.ets:521 collapseSameNumberBlocks`（号 + 合并）、
`core/render.ets:486-503`（同号存在 ⇒ 丢弃 live / 三空顶位）。

#### (d)「工具状态单调性」——2 套 rank

`core/toolmerge.ts:26 toolRank`（error/done=4 > running=3 > generating=2 > pending=1）与
`core/streammerge.ets:206-210`（`mergeTools` 内联同一语义）——「只升不降」这个规则写了两遍。

**后果**：`name#label` 作为身份 ⇒ 连续同名 `Shell` 互相误杀（label 是截断前缀）；号作为身份 ⇒ 空壳窗口两边都不画。
两条判据各自"看起来"对，组合起来必然在某个窗口里全错。

⇒ 新模型：**归属由服务端盖章（`iteration` 字段），画过没有 = 该工具是否在 `turns[t].blocks[i].tools` 里**。
二者都是**存储位置**的性质（"工具存在哪个集合里"），不是计算出来的判据 ⇒ **只需要存在性，不需要比较**。

### 1.2 R2 — 缺失 ≠ 空集合（4 处）

- `iteration.toolsCarried?: boolean`（`chat_types_full.ts:433`）：为了区分"这帧没带工具字段"与"工具集合是空的"，
  引入了一个额外的布尔位；它本身又需要"缺省 = 携带"的约定（`undefined` 表示 `true`）。
- `agent_normalize`: `tools` 非空才用，否则退回 `completed_tools`（**两个字段的并集/优先关系**）。
- `goal?: GoalInfo | null`（`chat_types_full.ts:464`）：`null` = 显式清除、`undefined` = 未携带、
  `GoalInfo` = 更新 —— 三态，且后端用 `{objective:"",status:"cleared"}` 墓碑表达"清除"。
- `turnID(0)` / `iterNum(0)`：`chat_types_full.ts:34-36` 的构造函数把 `0` **伪造成 `1`**（兜底），
  使得"没有 turn"与"turn 1"在类型上不可区分。

⇒ 新模型：**协议层消除歧义**（P4/P5）：缺字段 = 未携带；`null` = 清除；`[]` = 空集合。
客户端只有**一个**通用三态更新函数（`patch`），不再有 4 处特例。

### 1.3 R3 — 没有唯一的新鲜度判据（5 套）

| 判据 | 用处 | 失效场景（现状靠别的判据兜） |
|---|---|---|
| `seq` | 增量帧重放检测（`reduce.ts:658 isStaleSeq`） | mock/REST 帧无 seq ⇒ `null` 分支 |
| `iteration` 号 | 内容归属、gap 判据（`lostIterGapSig:366`） | 服务端跳号/截断 ⇒ 三种 sig |
| `turn_id` | 回合归属 | 后端某些路径 `cfg.TurnID=0` ⇒ 回退 `activeTurn` |
| REST 对账（`session-tree.running`） | busy 权威 | `running` **已**改为必填（`channel/web/web.go:313-315` 注释明写"必须总是序列化"），但 **REST 与 SSE 谁权威**仍无判据 ⇒ 两个来源互相覆盖（本行原写"omitempty"是过期结论，已更正） |
| 时间窗（15s） | SSE 意图的过期 | 迟到帧 ⇒ `satisfyRunningInvariant` 复活 turn |

**这 5 套判据加上它们的组合**，产生了现状里最大的一坨代码：`satisfyRunningInvariant`、
`settleSendingInvariant`、`settlePendingSending`、`lazyAdoptLive`、`isHollowFrozen`、
`liveAheadGapSig`/`lostIterGapSig`/`unreachableGapSig`/`gapReloadToken`、`applyLocalIdle`、
`scheduleIdleRetry`、轮询定时器。

⇒ 新模型：**只用 `seq`**。迟到/乱序/重复 ⇒ 由 `seq` 直接判定（丢弃或重同步）。

### 1.4 R4 — 双缓存 / 双指纹（7 个）

`convertedBlocksMemo`（`render.ets:399`）+ `liveBlocksMemo`（`:393`）是**同一件事的两级缓存**；
`@Observed` 行对象（`syncIterBlocks` 的 `rev` 整数，`render.ets:32`）与页面的**字符串指纹**
（`rowsFp`/`structFp`/`tailKeySig`/`sessionsFp`/`queueFp`/`todosFp`，`Index.ets`）是**两套投递机制**。

⇒ 新模型：**投影对未变化的 turn 返回同一引用**；UI 层比较 `next !== prev`（指针），
一套机制（对象恒等）覆盖全部投递需求 ⇒ 7 个指纹与 1 个多余缓存全部删除。

### 1.5 R5 — "在飞"在状态机与渲染层各有一份

状态机侧：`LiveSnapshot` 的 `iterations` / `activeTools` / `streamingTools` / `completedTools` / `content` / `reasoning`；
渲染侧：`inFlightBlock` 重新判定"哪一块是在飞块"，并再次做去重、等长比较（`render.ets:253-295`，**逐字比较正文**）。

⇒ 新模型：**在飞只有一个表示**：`live: LiveIter?`，其 `iter` 恒为"下一号"。
投影里 `inflight` 直接就是它，**不需要任何判定**。

### 1.6 R6 — 双写者 / 多路恢复

`store.ets` 里 REST 回包、SSE、轮询、idle 重试、gap 重载都在写状态；每条路径都要带 `gen/chat` 守卫
（`stillSame(gen, chat)`）与"await 后比对代际"。守卫本身是对的（跨会话隔离），但**路径数**是混乱之源。

⇒ 新模型：**唯一写者是 `step`**。REST 只出现在两个构造点（`snapshot` / `resync`），
异步身份由 `(chatID, gen)` 一条规则表达（不是兜底，是身份语义）。

---

## 2. 协议前提（P1–P6）

> **本模型的正确性以这 6 条为前提。** 前提不成立时模型不"降级"，而是**拒绝进入**（唯一响应 = 重同步）。
> 用户已授权修改 `xbot` 后端与 `xbot/web`，因此这些前提是可落实的工程要求，不是愿望。

**P1（信封）**：每一帧都带 `(chat_id, seq)`；`seq` 按会话**严格 +1**、服务端**每帧盖章**、重连可从 `last_seq`
续传。**没有任何一帧可以不带 `seq`**。`seq` 的语义**只有一个**：会话内帧序号（起点 1，连续）。

> 现状缺口（实测事实，基线 `feat/court-orchestration@976e403b`；**已经过一轮盲审核对**）：
> - **服务端有两套都叫 `seq` 的东西，必须二选一**：
>   ① **transport seq**（`protocol/ws.go:102`，`omitempty`；由 `web_hub.go:305-313 sequenceEventLocked`
>   → `web.go:1186-1195 stampAndBuffer` → `web_eventstream.go:90-92 nextSeq`（`atomic.Uint64`）盖章，
>   写字节在 `web_sse.go:604-679`）；② **progress seq**（`protocol/events.go:127`，`omitempty`，
>   per-session 由 `agent.go:1660-1672 progressSeqFor` 自增，且**会被复制进 `iteration_history`**）。
>   客户端 `isStaleSeq` 比的是 ②，而 web 的 `normalize.ts:237` 也读 ②，顶层 `id:` 行才是 ①。
>   ⇒ **P1 指定 ①**（transport 序号）为唯一判据；② 降级为普通字段（或删除）。
> - **真正"没有任何 seq"的帧**：`writeSSEHeartbeat`（`web_sse.go:728-742`，裸 `event: heartbeat\ndata: {}`）
>   与 `writeSSEResyncRequired` 的 **payload**（`web_sse.go:786-795`，`Seq=0`）。
>   ⚠️ `sendHeartbeatLive`（`web_sse.go:754-774`）**会被盖章**（它走 `hub.sendSSEEventIf`）
>   —— 但它把**旧快照**（含旧的 progress seq）重发，这是"陈旧内容冒充新帧"，仍必须删除。
> - **不盖章的路径**：`agent/engine_wire.go:2309-2312 withLiveStats`（`stream_content`/`stream_tokens`/
>   `streaming_tools` 全从这里出）与 `:2079-2086`（迭代 checkpoint）、`:1984-1989 buildProgressPayload`
>   （直接用 `s.Seq`，可能为 0）。
> - **`seq` 现在是 per-route，不是 per-chat**（`web_eventstream.go:21-26 sessionRouteKey(channel, chatID)`）；
>   同一会话可能同时挂在 `web\0X` 与 `agent\0X` 两条 route 上（`web.go:656-665`）⇒ 两个计数器各自编号。
>   **必须改成 per-chat 单计数器**，否则客户端看到的序号必然重号/跳号。
> - **盖了号的帧不得被删除**：现有"stateless 帧 later-wins 合并"会把旧帧从环形缓冲里删掉
>   （`web_eventstream.go:114-127` + `:143-152 removeAt`）。⚠️ 客户端**不再依赖**"序号稠密"
>   （跳号即取最大，§3.4），但仍有一条硬约束：**合并必须有顺序保证**，即"先合并、后盖章"——
>   否则同一 chat 会被写入两条相同/更小的序号 ⇒ 客户端把新状态当迟到帧丢弃（§14 契约 C-2）。
> - `session` 事件的 `SessionEvent`（`events.go:500-522`）**结构体里没有 `seq`/`turn_id`**。
> - **seq 只在单次进程生命周期内单调**（重启归零，`web_sse.go:142-145` 已显式处理）⇒ 与 `epoch` 一起用。

⇒ 改造：**统一为 transport seq（per-chat 单计数器）**（删 `ProgressEvent.seq` 的判重语义）、
**所有出站帧都盖章（含保活帧与 stream 路径）**、**删除心跳快照帧**、`SessionEvent` 加 `seq`、
**合并只在盖章前**。`seq=0` 从此不可表示。
另外 `seq` 与 **`epoch`** 组成 `(epoch, seq)`：服务端进程重启 / 帧日志环形缓冲被重置时 `epoch + 1`
⇒ 客户端见到 epoch 变化直接取快照（否则"重启后 seq 归零"会被误判为"全是过期帧"）。

### 2.3 为什么"打字机"幂等、而"工具"不幂等（用户判断正确，这里是原因）

| 维度 | 打字机（正文/思考） | 工具（现状） |
|---|---|---|
| 帧语义 | **位置状态**：`content` 是该迭代累积全文，覆盖即可 | **增量 + 快照混用**：`active_tools` 是"本批"（整批先 `pending`，`engine_run_tools.go:47-65`），`completed_tools` 是"已完成累积"，`streaming_tools` 是"生成态"，**三者在同一帧里并列**，且旧迭代条目会**残留**（直到 `beginIteration` 清空，`engine_run.go:584`） |
| 身份 | 无需身份（一个迭代一个字符串） | 需要身份，但**生成态没有 `call_id`**（`engine_wire.go:2432-2445`）⇒ 客户端只能退化成 `name` / `name#label` |
| 幂等性 | ✅ 重放同一帧 = 同一结果 | ❌ 重放同一帧会**并集/叠加**；同一工具可能同时以"active 的 pending"和"completed 的 done"两种身份出现 |
| 抗丢包 | ✅ 丢一帧，下一帧覆盖 | ❌ 丢"工具完成"那一帧 ⇒ 该工具永远停在 running/pending（**没有后续帧纠正**，因为工具状态不是每帧全量） |

⇒ **P3 的实质就是"把工具也变成打字机"**：每个 `tick` 携带**当前迭代的全量 `tools[]`**（每项带稳定的
`call_id` 与当前 `status`）。此后：

- 重放幂等（覆盖）；
- 丢一帧 ⇒ 下一帧覆盖（丢的是"完成"状态也不怕，因为下一次 `tick` 或 `done` 会带上 true 状态）；
- 只有**迭代最后一帧**丢失才需要外部检测 —— 见 §2.4。

### 2.4 边界：**只有"最后一个帧"是完整副本，而它丢了**

这是用户点名的场景：`done(iter, block)` 是**该迭代唯一完整副本**（正文终稿 + 全部工具终态）；
它丢了，手上只剩若干 `tick` 预览。模型的处理链是：

| 情形 | 检测手段 | 修复手段（都是"取权威"，不是本地重建） |
|---|---|---|
| 中间丢帧 | 下一帧 `seq ≠ last+1` | `GET /api/frames?chat&since=last` **重放缺失帧**（服务端每会话保留环形帧日志） |
| **迭代最后一帧丢**（`done` 丢） | ① 该回合若还有下一迭代，其 `tick` 带 `iter > last+1`；② 同回合 `final` 的 `blocks` 与本地不一致；③ `session{running=false}` 时该 turn 的 `last < 已见过的最大 iter` | **`pullIter(turn, last+1 …)`** 取权威块 |
| `final` 也丢（回合末尾连续丢） | `session{running=false}` 且该 turn `final = ⊥`；或下一 turn 已 `open` | **`pullTurn(turn)`** |
| 会话彻底静默（长时间无帧） | 保活帧 `{epoch, seq}` 仍走（**不推进 seq**） | 不需要动作（无缺口可判）；用户再次交互时先 `snapshot` 亦可 |
| 断线 | 重连后序号不可续 | **`snapshot(chat)`**（整体权威；不依赖任何帧日志） |
| 服务端重启（帧日志丢失、seq 归零） | `epoch` 变化 | 快照 |
| 重复帧 / 乱序 | `seq ≤ last` ⇒ 丢弃；乱序由"服务端单写者串行盖章"从根上排除 | — |

**关键**：模型**从不**把 `tick` 预览"提升"为提交块（现状 `isShell`/三空顶位/`live` 折进块就是这种提升）。
预览的唯一归宿是"被 `done` 替换"或"被 `snapshot`/重放修正"。

**两级修复**（都取权威，粒度不同）：

```
gap = (last+1 .. new-1)
if 服务端帧日志仍覆盖 gap  → 重放这些帧（便宜、精确；等价于它们从未丢过）
else                       → snapshot(chat)   （慢路径，正确性兜底 —— 但仍是权威，不是猜测）
```

**P2（归属盖章）**：`turn_id`、`iteration`、`call_id` 全部由服务端分配：
- `turn_id`：每会话单调 +1，**永不复用**；**所有回合级帧都必须带**（`open`/`tick`/`done`/`final`）。
  会话级帧（`session`/`queue`）**不带**（它们与回合无关）。现状 `turn_id` 走 `omitempty`
  （`protocol/ws.go:118`、`events.go:180`）⇒ `0` 与"缺失"同形；且 `goal`/`todos`/`builtin` 这类
  会话级 payload 里写死 `Iteration: 0`（`agent.go:4697-4711`、`agent_backend_methods.go:538-556`）——
  **改造后这些帧全部变成不带 turn 的 `session` 帧**，`0` 号彻底消失。
- `iteration`：一次迭代 = 一次 LLM 调用 + 其工具执行（`engine.go:711-744`），1-based；
  **同一 turn 内严格递增**（允许跳号：resume 续号 `engine.go:708-712`、触顶早退 `717-733`）。
  现状只 `log` 不强制（`engine_run.go:555-573` 的 `ITER_ID_INVARIANT_VIOLATION`/`ITER_ID_GAP`）⇒ 升级为强制。
- `call_id`：工具调用的**不透明唯一 id**，**永不复用**，**从"开始生成"那一刻就有**（详见下）。
  ⛔ 现状：`streaming_tools`（参数还在生成）的条目**完全不设 `call_id`**
  （`engine_wire.go:2432-2445` 只给 `Name/Status/GenChars/Iteration/...`）——
  这正是客户端 `toolKey` 必须写"generating 时只用 `name`"特例的**唯一原因**。
  ⇒ 服务端在生成态就分配 id（本地计数器，或 provider id 一旦可用就锁定不变），**全生命周期同一个 id**；
  于是"工具身份"在客户端只剩 `call_id` 一种，`name#label` / `name` 退化键全部删除。

**P3（覆盖语义 / 位置状态）**：
- `tick` 帧的 `content`/`reasoning` = **本迭代内**的累积文本（服务端在迭代前进时**重置**）；
- `tick` 帧的 `tools` = **本迭代**当前工具集合的**全量快照**（单一数组，每项带 `status`），
  服务端**只发当前迭代的工具**（不再需要前端按 `iteration` 过滤陈旧项）。
> 事实核对（好消息）：**"正文按迭代重置"服务端已经是这样做的** —— `engine_run.go:581-589` 在
> `beginIteration` 里清 `ActiveTools/CompletedTools/**Content/Reasoning**/SubAgents`。
> ⇒ 客户端所有"搬运上一迭代文本 / 等长比较去重"的补丁**在处理位置状态时是可证明冗余的**。
> 真正缺的是**工具数组归一**：三个并行数组（`active_tools` 本批含 pending、
> `completed_tools` 已完成累积、`streaming_tools` 生成态）且**残留旧迭代条目**
> （`agent/engine_run_tools.go:47-65` 整批先 `pending`，`149-150` 才翻 `running`；
> `engine_wire.go:2436-2445` 原文承认"前端必须按 `iteration` 过滤"）。
> 改造后：**一个 `tools[]`，服务端按当前迭代过滤**，`status` 枚举覆盖
> `generating | pending | running | done | failed`（现 `streaming_tools` 的语义 = `generating`）。

**P3′（生成期的工具：会"慢慢长出来"）**：工具的**参数**是流式生成的（`gen_chars` 递增、`label` 是
`name + 参数截断`⇒ **也会增长**），而且 **`call_id` 在生成初期可能还没拿到**（provider 的 id 也是分片到达的）。
因此：

- `call_id` 由**服务端在"该工具第一次出现在任何帧之前"分配**，**此后永不改变**（provider 后来给出的 id
  只能作为 meta 字段，**不能**当身份）。⇒ 生成期的身份也稳定，客户端不需要 `name`/`name#label` 退化键。
- 工具的**展示字段分两类**：
  - **可变（每帧发）**：`status`、`label`（含随参数增长的部分）、`genChars`、`elapsedMs`；
  - **不可变（只在"首次出现"那一帧发一次）**：`name`、`uiMode`、`uiLibs`、`toolHints`，
    以及 **`args`/`detail`/`summary`（参数生成完成之后才发一次，此后不变）**。
- ⛔ 不许"先发一个占位 id、拿到真 id 再换"——那会让同一枚工具在 UI 上**重建/闪烁**。

**P4（提交唯一且完备）**：
- 每个**已开始**的迭代，最终**恰好有一条** `done(turn, iter, block)`，`block` 含该迭代**全部**可见内容
  （正文 / 思考 / 工具终态）。取消/失败的迭代同样有 `done`（带 `cancelled`/`error` 标志）。
- 每个 turn 结束**恰好一条** `final(turn, content, blocks?, droppedBefore?)`；`blocks` 若携带则**整体替换**
  该 turn 的块列表（服务端可头部截断并报 `droppedBefore`）。**空 turn 也必须有 `final`**。
- `done` 的 `iter` 必须 **> 该 turn 已提交的最大号**（允许跳号，不允许回退/重复）。
> 现状基础（可复用，不是从零）：服务端已有 `snapshotCompletedIteration`
> （`engine_run_tools.go:458-540`，把 `CompletedTools` 写进迭代记录）与 `recordFinalIteration`
> （`engine_wire.go:2058-2069`），落库走 `writeIterationHistory`（`engine_run_tools.go:553`）。
> 缺的是三件事：① 把它**独立成帧**（现在塞在 `progress` 的 `iteration_history`/增量里）；
> ② **取消路径**也写一条；③ `final` 对空 turn 也发。
> 这一条替代了现状里"服务端可能只记空壳 ⇒ 前端用 live 顶位"的全部补丁。

**P5（三态显式）**：可选字段的 JSON 语义固定为：
- **缺字段** = 未携带（不改）；
- **`null`** = 显式清除（仅对可清除字段有效：`goal`）；
- **`[]`** = 空集合（是值，会覆盖）。
> 现状缺口（**已核对**）：`protocol/events.go:132` 的 `Todos` **本来就没有** `omitempty`（`[]` 与 `nil`→`null`
> 可区分，但要区分"未携带"仍需 `*[]TodoItem`）；`ActiveTools/CompletedTools/StreamingTools`
> （`events.go:129/130/155`）、`goal`（`:133` `*GoalInfo,omitempty` ⇒ **`null` 根本发不出去**，
> 只能靠墓碑）、`TurnID`（`:180`）、`ToolProgress.Status/Iteration/CallID`（`:40/42/68`）全是 `omitempty`。
> ⇒ 至少 8 个 tag 要动，且**两端解析同步**（harmony `chat_types_full.ts`、web `normalize.ts`）。

**P6（单写者 + 单一权威）**：所有改变会话的帧（含 `session`/`queue`）都走同一条流、同一个 `seq`；
REST 只提供**带 `seq` 的快照**（`GET /api/session-state?chat=…` 返回 `(state, seq)`），不再参与"实时对账"。
> 这一条删掉：轮询定时器、15s 有界提示、`resync_required`、"REST 与 SSE 谁权威"的全部分支。

### 2.1 需要后端（`/Users/bobli/src/xbot`）的改动

| 改动 | 位置（`/Users/bobli/src/xbot`，基线 `976e403b`） | 影响 |
|---|---|---|
| **信封唯一化** | `protocol/ws.go:102`（`seq,omitempty`）→ 必填；`progress.seq`（`events.go:117-201`）**删除**其判重语义 | 只剩一套 seq |
| **每帧盖章 + per-chat 单写者锁** | `web_hub.go:305-313 sequenceEventLocked` 现在是 **per-route**（`web_eventstream.go:21-26 sessionRouteKey(channel, chatID)`）且 `seqMu` 是**全局单锁**（`web_hub.go:27`）⇒ 改成 **per-chat** 计数器 + per-chat 锁；`agent/engine_wire.go:2309-2312 withLiveStats`（`stream_content`/`stream_tokens`/`streaming_tools` 的唯一出口）与 `:2079-2086` checkpoint **当前完全不盖章**，必须补 | 消除 `seq=0` 与重号（A6/A10） |
| **合并必须在盖章前** | `web_eventstream.go:114-127`（stateless later-wins 合并）+ `:143-152 removeAt`：合并会**丢弃旧帧** | 只需保证"同一 chat 不出现序号回退/重号"（C-1/C-2）；客户端不再需要序号稠密 |
| **epoch** | 新增：进程启动时自增并持久化；随帧与快照下发 | 重启可检测（A8） |
| **chat_id 补齐** | `user_echo`（`web_inbound.go:268-286`）、`runner_status`（`web.go:1277-1290`）、`sync_progress`（`1293-1300`）、`group.message`（`web_group.go:215-220`）、插件广播（`rpc_table.go:113/135`） | 帧可归属（P1） |
| **删心跳快照** | `sendHeartbeatLive`（`web_sse.go:752-775`）、`heartbeat` 裸帧（`728-741`）⇒ 改为 `keepalive{epoch,seq}` | 消除"旧快照重发" |
| **工具数组归一** | `ProgressEvent.active_tools/completed_tools/streaming_tools`（`events.go:117-201`）⇒ 单一 `tools[]`，每项带 `status` + `call_id`；只含**当前迭代**（`engine_run_tools.go:47-65` 的整批 pending 与 `engine_wire.go:2436-2445` 的"前端自行过滤"负担随之消失） | 删掉三数组/去重/过滤 |
| **生成态即分配 `call_id`** | `engine_wire.go:2432-2445`（生成态条目现在**无** call_id）⇒ 生成时分配、全生命周期不变 | 删掉 `name`/`name#label` 退化键 |
| **meta 只发一次** | `ToolProgress`（`events.go:37-69`，**全部 `omitempty`**）拆成 `meta`（首发一次）与 `state`（每帧） | 带宽（§12） |
| **正文/思考增量** | `streamContentFunc`/`streamReasoningFunc`（`engine_wire.go:2287-2412`）从"全量累积"改为 `{base, chunk}`。⚠️ **"按迭代重置"已经做到了**（`engine_run.go:580-589` `beginIteration` 清 `Content/ReasoningContent/ActiveTools/CompletedTools`）⇒ 这条**不是**要改 `engine_run.go`；真正要清的是跨迭代残留：`agent/stream_state.go:37-61 mergeStreamState`（目标字段为空就填充）+ `Iteration:0` 的 todos/goal/builtin 帧（`agent.go:4702-4711/4737-4752/4770-4783`） | 带宽 100×（§12）；消除"老 content 贴到 0 号迭代" |
| **`done` 独立成帧（含取消）** | 主路径已有：`snapshotCompletedIteration`（`engine_run_tools.go:452-548`，`:543` 落库，调用点 `engine_run.go:1043/1247/2079`）。**取消路径缺三处**：① `engine_run.go:1001-1008`（`ctx.Err()` 早退，不 snapshot、不落库）；② `agent_process.go:443-554 handleCancelledRun`（注释自认 "No iteration_history writes"，只把 `user_cancelled` 伪工具塞进最后一行）；③ `engine_run_tools.go:518-532`（`snap.Tools` 只取 `CompletedTools` ⇒ 被中断的 `ActiveTools` **终态丢失**） | 删掉"空壳顶位"；否则取消后该迭代既无 `done` 也无完备块 ⇒ 触发丢弃/重同步（R4） |
| **`final` 完备** | 现有 text 收尾（`web.go:1085-1100`）⇒ 保证**每 turn 一条**（含空 turn/取消） | 投影可判定回合结束 |
| **会话字段归 `session` 帧** | `emitTodosProgress`/`emitGoalProgress`/`ClearGoal`/`emitBuiltinProgress`（`agent.go:4697-4711`、`4732-4751`、`4760-4790`；`agent_backend_methods.go:538-556`、`582-605`）现在写死 `Iteration:0` 混在 progress 里 ⇒ 改为不带 turn 的 `session` 帧 | 消除 `iteration=0` 帧 |
| **`omitempty` → 显式三态** | `goal`（`events.go:24-28`）⇒ `*GoalInfo` + 清除用 `null`（删 `{status:"cleared"}` 墓碑，`agent_backend_methods.go:598-601`）；`active_tools/completed_tools/iteration_history/questions`（全 `omitempty`）⇒ 恒出现或显式 `null` | 三态显式（P5） |
| **快照端点 + `(epoch, seq)`** | ⛔ `GET /api/session-state` **目前不存在**（全仓零命中）；`/api/session-tree`（`web_api.go:1566-1607`）是**侧边栏树**，不含 `(turns, live, sess)`；现成的状态权威是 `GetActiveProgress`（`agent_backend_methods.go:181-310`）+ `serverapp/callbacks.go:412-413/463-519` ⇒ **需新建端点**。⚠️ 不能用现有全局 `seqMu`（`web_hub.go:27`）包住 DB 读：`web_hub.go:192-195` 明写"prepare 不得获取应用锁"，且全局锁 + DB 读 = **全服帧被一次查询阻塞**（R2）⇒ 采用 **两阶段**：先在锁外读快照得 `(state, version)`，再在 **per-chat 锁**内取 `seq` 并校验 `version` 未变（变了重读） | REST 可作 `S0`（P6），且不拖慢流式 |
| **按对象拉权威的端点** | 现有 `resync_required{baseline_seq}`（`web_sse.go:519-527`、`785-801`）只是"要重载"的粗粒度信号 ⇒ 改为 **`GET /api/iteration?chat&turn&iter`**（单迭代权威，供 `pullIter`）与 **`GET /api/turn?chat&turn`**（回合权威），**不需要**帧环形日志/重放 | 缺迭代/缺收尾的精确修复（A3/A4） |
| **runGen 收尾守卫** | 已有（`agent.go:1677-1710`、`3583`/`3612`；判据 `agent/session_idle_guard_test.go`） | 保留（**权威信号仍在服务端**） |
| **迭代号强制** | `engine_run.go:555-573` 现在只 `log`（`ITER_ID_INVARIANT_VIOLATION`/`ITER_ID_GAP`）⇒ 升级为强制"同 turn 内严格递增" | T5(a) |

### 2.2 需要 web（`/Users/bobli/src/xbot/web`）的改动

web 与新模型是**同一语义**（本仓的状态机本来就是 web 的逐字移植）。重构后：
`web/src/chat/reduce.ts` 与新 `step` **一一对应**（同名、同转移、同前置/后置），
差别只在**语言与 UI 层**。web 侧同样删除 `mergeIterations`/`dedupeIterationsByNumber`/
`completedIterKeys`/`shellSameNum` 等分支 ⇒ 两端由"语义同源"变成"**转移表同源**"。
> 判据：用同一份录制的 SSE 日志分别喂两端、比对投影（W5 的判据，见 §9.3；判据文件在 W5 落地时创建）。

---

## 3. 模型

### 3.1 词汇

| 记号 | 含义 | 类型 |
|---|---|---|
| `chat` | 会话 id | 不透明字符串 |
| `turn` | 回合号，每会话 +1，永不复用 | `Nat⁺` |
| `iter` | 迭代号（= 一次 LLM 调用），每回合 +1 | `Nat⁺` |
| `call` | 工具调用 id，全局唯一 | 不透明字符串 |
| `seq` | 帧序号，每会话 +1 | `Nat` |

**身份只用这 4 个。** 内容（正文/思考/参数/输出）**从不参与身份判定**（用户硬约束；也是性能要求）。

### 3.2 状态

```
S = { chat   : ChatID
      epoch  : Nat                       -- 服务端实例代号（重启 +1）
      seq    : Seq                       -- 已应用的最大帧号
      gen    : Nat                       -- 本机代数（换会话/重载时 +1）
      turns  : Map<TurnID, TurnRec>      -- 已提交回合，只增不改
      live   : LiveIter | ⊥              -- 至多一个在飞迭代（I3′）
      sess   : Session                   -- 会话级字段，字段级 LWW
      local  : Local }                   -- 本机意图（乐观 user 行）

TurnRec = { id      : TurnID
            user    : UserLine | ⊥           -- ⊥ = 无 user 行（notification/续跑）
            blocks  : Block[]                -- 严格递增的 iter，**恰好一块/迭代**
            final   : Final | ⊥              -- ⊥ = 回合尚未收尾
            -- ── 回合级进度（**不随 live 消失**：压缩/思考/上下文环在"迭代间隙"仍要显示）──
            phase    : string                -- 'thinking'|'tool_exec'|'compressing'…
            streaming: bool                  -- 本回合是否仍在产出
            streamStats : Stats | ⊥
            tokenUsage  : Usage | ⊥
            compactions : Compaction[]        -- 回合内压缩点（渲染成迭代之间的横线）
            droppedBefore : Nat              -- 服务端头部截断的块数（渲染"更早的 N 个"）
            regionsBefore : Nat              -- "更早区域"（可动态取回），与 droppedBefore 同源语义
            requestID : RequestID | ⊥ }

Block = { iter: IterNum, content: string, reasoning: string, tools: Tool[],
          subAgents: SubAgent[], genui: string, cancelled: bool }
        -- content/reasoning 可为空；tools 可空；但 **block 的 iter 唯一且严格递增**
        -- subAgents / genui：该迭代**冻结**的副产物（历史回合也要能展示）

Tool  = { call: CallID, iter: IterNum,
          meta  : ToolMeta,            -- **不可变**：name / uiMode / uiLibs / toolHints
                                       --            + args / detail / summary（参数生成完成后**一次性**）
          state : ToolState }          -- **每帧覆盖**：status / label / genChars / elapsedMs
        -- status ∈ generating | pending | running | done | failed
        -- ⛔ label **会随参数增长**（= name + 参数截断）⇒ 属于 state，不属于 meta
        -- ⛔ 取消/失败时，running 工具**必须**落成 `failed`（否则可见内容会凭空消失）
        -- ⛔ 恒有 tool.iter == 所属 Block.iter（构造时校验，见 T5）
        -- ⛔ `call` 在"首次出现前"已由服务端分配且终身不变（P3′）；meta 只在该帧携带

LiveIter = { turn: TurnID, iter: IterNum,     -- 恒 > turns[turn].blocks.last.iter（I3′）
             content: string, reasoning: string,   -- 客户端累积结果（帧里传增量 + base）
             tools: Tool[],                        -- 本迭代工具集（**位置状态**：数组即全集）
             genui: string }
             -- ⛔ 进度统计（phase/stats/tokenUsage/streaming）**不在 live 里**，在 TurnRec 上
             -- ⛔ 不变量：同一 tick 内 call_id 不重复（P2/P3 由服务端保证）⇒ 数组即集合，无需去重

Session = { running : bool
            todos   : Todo[]                 -- P5：[] 是值
            goal    : Goal | ⊥ | CLEARED     -- 三态（当前值 / 无 / 显式清除）
            queue   : QueueItem[] }

Local   = { pending : UserLine[] }           -- 未绑定的乐观 user 行（发送中/排队）
```

**与现状的对应**：`ChatState`（`chat_types_full.ts:295-379`）的 17 个字段中，
`gapReloadToken`/`unreachableGapSig`/`lostIterGapSig`/`liveAheadGapSig`（4 个）删除；
`busy`/`sessionRunning` 收敛为 `sess.running`（1 个）；`legacy`/`standalone` 保留（它们是**非 turn 行**，
语义独立，见 §3.6）；`turns`/`activeTurn`/`pendingUsers`/`todos`/`goal`/`queue`/`lastSeq` 保留（改名/改型）。
`LiveSnapshot` 的 16 个字段按**归属**拆分：正文/思考/工具/genui → `LiveIter`；
`phase/streaming/streamStats/tokenUsage` → `TurnRec`（回合级，迭代间隙不丢）；
`iterations` → `TurnRec.blocks`；`todos` → `sess.todos`。

### 3.3 帧语言（服务器 → 客户端，6 个构造子）

```
Envelope = (epoch, seq, chat)                 -- 每帧必带；P1

Frame = open   { env, turn, user: UserLine, requestID, ts }
      | tick   { env, turn, iter, phase, streaming, stats, usage, genui,
                 content  : { base: Nat, chunk: string },      -- 增量 + 整数锚（§12 带宽）
                 reasoning: { base: Nat, chunk: string },
                 tools    : ToolTick[] }                        -- 本迭代**全集**（位置状态）
      | done   { env, turn, iter, block: Block }               -- P4：恰好一条/迭代（**block 完备**）
      | final  { env, turn, content, cancelled, phase,
                 blocks?: Block[], droppedBefore? }             -- 回合收尾（空回合也必须发）
      | session{ env, running?, todos?, goal?, queue? }        -- 字段级三态（P5）
      | keepalive { env }                                      -- 不推进 seq；仅用于暴露丢帧

ToolTick = { call: CallID, iter: IterNum,
             state: ToolState,                 -- status/label/genChars/elapsedMs（每帧覆盖）
             meta?: ToolMeta }                 -- 仅"首次出现"那一帧携带（含生成完成后的 args/detail）
           -- ⛔ meta 必须在"该工具首次出现"的那一帧携带（无论 tick 还是 done），之后不再重发
           -- ⛔ `label` 每帧都发（它随参数增长）；客户端**不**缓存"第一次的 label"
```

**客户端本地意图（5 个，不经网络）**：

```
Intent = send  { requestID, content, ts }        -- 乐观行入 local.pending
       | ack   { requestID, kind: delivered|queued|command, turn?, dbID? }
                                                  -- 服务端已受理：delivered ⇒ 绑定 turn；
                                                  -- queued ⇒ 进 StagingTray（撤出 pending 显示）；
                                                  -- command ⇒ 该行是命令（**永不会有 turn**）⇒ 移入 standalone
       | fail  { requestID }                      -- 发送失败 ⇒ **移除**乐观行（与现状 user_fail 一致）
       | resync{ }                                -- 由 gap/epoch/断线触发（见 3.5）
```

> **为什么需要 `ack`（盲审补充）**：命令（`!cmd`/slash）**不走 `processMessage`、也没有 `turn_started`**
> （`agent/agent.go:4829`），排队消息也不会立刻 `open` ⇒ 若只有 `send`/`open` 两条路，
> 这两类乐观行会**永久停在"发送中"**（现状靠 `user_ack` 的 queued/command 分支处理，
> `core/reduce.ts:2537-2575`）。`ack` 就是那条缺失的路。

> **为什么是 6 而不是现状的 15**（`chat_types_full.ts:391` 的 `DomainEvent`）：
> `session_running` ⊂ `session`；`turn_started` = `open`；`iteration`/`stream` = `tick`（同一件事：
> "本迭代此刻的样子"）；`phase_done`/`iterations_loaded`/`history_replaced` 全部并入 `done`/`final`/`snapshot`；
> `session_fields`/`queue_state` ⊂ `session`；`user_sent`/`user_echo`/`user_ack`/`user_fail` 是**本机意图**
> （`send`/`ack`/`fail`），不是服务器事件 —— 现状把它们当事件混进同一个 `reduce`，
> 才需要 `pendingUsers` 与 `turns` 两套绑定逻辑反复对账。

### 3.4 转移 `step`

```
step : (S, Frame) → S ∪ { PULL, SNAPSHOT }

前置（**总函数，无例外分支**）：
  if f.chat ≠ S.chat      → S                     -- 别的会话的帧
  if f.epoch ≠ S.epoch    → SNAPSHOT              -- 服务端重启/日志重置
  if f.seq  ≤ S.seq       → S                     -- 重复 / 迟到（含"被跳过的号"）⇒ 一律丢弃
  if f.seq  > S.seq + 1   → **照常应用**，S.seq := f.seq
                            -- ⛔ **跳号以最大为准**：不重放、不补帧、不因此重同步
                            --    理由：帧是位置状态 ⇒ 被跳的号只承载"更旧的状态"，新帧已包含其结果
                            --    真正"唯一完整副本"的丢失，靠**对象级完整性**发现（见 tick/done 的 PULL）

后置（逐构造子，S' = S[seq := f.seq] 后应用一条规则）：

  open:    if turns[f.turn] ≠ ⊥ then          -- ⛔ 幂等：同一 turn 不会被"重开"
             turns[f.turn].user := f.user      --    只绑 user，**保留 blocks/final/phase**
             turns[f.turn].requestID := f.requestID
           else turns[f.turn] := { user: f.user, blocks: [], final: ⊥,
                                   phase: 'thinking', streaming: true, compactions: [], … }
           live := ⊥                            -- 新回合开启 ⇒ 无在飞迭代
           local.pending := local.pending \ {requestID = f.requestID}   -- 绑定（乐观行交给 turns）

  tick:    if f.iter ≤ turns[f.turn].blocks.last.iter → DROP    -- 已提交迭代的迟到帧
           if f.iter > turns[f.turn].blocks.last.iter + 1 → PULL  -- ⛔ 迭代前进了但**上一迭代还没提交**
                                              PULL(turn, blocks.last.iter+1 … f.iter-1)
                                              -- 本帧**不应用**（位置状态 ⇒ 下一帧会带回最新样子）
           if live ≠ ⊥ ∧ f.iter < live.iter → DROP              -- 更旧迭代的迟到帧（整数比较）
           if live = ⊥ ∨ live.turn ≠ f.turn ∨ f.iter > live.iter
             then live := { turn: f.turn, iter: f.iter, content: '', reasoning: '', tools: [], genui: '' }
           if f.content.base = len(live.content) then live.content += f.content.chunk else DROP
           if f.reasoning.base = len(live.reasoning) then live.reasoning += f.reasoning.chunk else DROP
           live.tools := f.tools（每项：meta 缺省 ⇒ 沿用已知 meta；state 覆盖）  -- 位置状态：数组即全集
           live.genui := f.genui
           -- 回合级进度（**与 live 无关**，迭代间隙照常生效）
           turns[f.turn].phase := f.phase; .streaming := f.streaming
           .streamStats := f.stats ?? 保持;  .tokenUsage := f.usage ?? 保持
           -- ⛔ 覆盖，不合并；⛔ 不搬运上一迭代的文本（P3）；⛔ base 不匹配即 DROP（不猜测）

  done:    t := turns[f.turn]
           if f.iter ≤ t.blocks.last.iter then DROP        -- 已提交/回退（T7-i）
           if f.iter > t.blocks.last.iter + 1 then PULL    -- ⛔ **不许跳过**：先把中间迭代拉齐
           else t.blocks := t.blocks ++ [f.block]          -- 只接受"紧邻"的完备块
           t.phase := f.block.phase ?? t.phase
           if live ≠ ⊥ ∧ live.turn = f.turn ∧ live.iter = f.iter then live := ⊥  -- 该迭代已提交

  final:   t := turns[f.turn]
           -- ⛔ 完备性：`final` 必须覆盖**所有**已开始的迭代
           if f.blocks ≠ ⊥ then t.blocks := f.blocks        -- 整体替换（服务端权威，含被取消的迭代）
           else t.blocks.last.iter < 最后一次 tick 的 iter ⇒ **pullIter 补齐**（不许静默结束）
           t.final := { content: f.content, cancelled: f.cancelled }
           t.phase := f.phase; t.streaming := false
           t.droppedBefore := f.droppedBefore ?? 0
           if live ≠ ⊥ ∧ live.turn = f.turn then live := ⊥   -- live 的迭代必已被 done 覆盖（P4）

  session: sess := patch(sess, f)      -- 字段级：缺字段=不动；null=清除（仅 goal）；[]/=值
  queue:   sess.queue := f.items

  send:    local.pending := local.pending ++ [row]
  ack:     delivered ⇒ local.pending \ {requestID}（其 user 行交给 turns[f.turn]）
           queued    ⇒ local.pending \ {requestID}（该行转入 sess.queue 的展示）
           command   ⇒ local.pending \ {requestID} + 追加到 standalone 段（**无 turn**）
  fail:    local.pending := local.pending \ {requestID}     -- ⛔ 移除（与现状 user_fail 删行一致），不重试、不超时
  resync:  S := snapshot(S.chat)       -- 见 3.5
```

**`final` 与 `live` 的关系（盲审 P0-2）**：`final` 清 `live` 的前提是"该迭代已有 `done`"（P4）。
服务端做不到时，`final` **必须带 `blocks`**（含被取消的那一迭代、`running` 工具标 `failed`）——
否则被取消的迭代既不在 `blocks` 也不在 `live` ⇒ 内容消失。这就是 P4 是硬前置的原因（§8）。

**关键性质（都将在 §4 证明）**：

- `step` 只依赖 `S` 与 `f`，**无隐藏状态、无时间、无随机** ⇒ 可重放、可差分测试。
- `tick` 是**幂等覆盖**：同一 `tick` 应用两次结果相同（因为它是位置状态，不是增量）。
- `done` 是**单调追加**：块的迭代号严格递增 ⇒ 历史只增不改 ⇒ "提交块权威"是**类型性质**。
- `live` 存在 ⇒ `live.iter > last(blocks).iter`；由于 `tick` 门控（`iter > last+1` 不建 live），实际上恒为 `= last+1`。
  `pullIter` 补齐后若出现 `live.iter ≤ last` ⇒ **清 live**（该迭代已被权威块覆盖）。
  ⇒ **在飞块与已提交块不可能同号**（现状需要 `collapseSameNumberBlocks`/`isShell`/三空特例，全部删除）。

### 3.5 恢复：**按对象拉权威**（一个概念，三种粒度）

```
snapshot   : ChatID → { S0, epoch, seq0 }                    -- GET /api/session-state?chat=…
pullIter   : (ChatID, turn, iter) → { block: Block } | ABSENT -- GET /api/iteration?chat&turn&iter
pullTurn   : (ChatID, turn) → { blocks, final, ... } | ABSENT -- GET /api/turn?chat&turn
```

**触发与出口**（不设"帧重放"——跳号以最大为准，见 §3.4 前置）：

| 缺口类型 | 发现方式 | 出口 |
|---|---|---|
| 迭代不完整（**核心**） | `tick/done` 的 `iter > blocks.last + 1`（迭代前进了但上一迭代没提交） | `pullIter(turn, last+1 … iter-1)`：**逐个**取权威块；`ABSENT` ⇒ 该号不存在（合法跳号，如 resume 续号），记下并前移；存在 ⇒ 当作 `done` 应用 |
| 回合未收尾 | `session{running=false}` 且该 turn `final = ⊥`；或 `open` 了下一个 turn | `pullTurn(turn)` ⇒ 补 `blocks` + `final` |
| 整体不可信 | `epoch` 变化 / 首次进入 / 断线后无法判断 | `snapshot(chat)`（完整原子快照，两阶段读取，见 §2.1） |

- `pullIter` 与 `snapshot` 都是**权威读取**；`ABSENT` 是**权威的"不存在"回答**，不是客户端的猜测。
- ⇒ 客户端**不需要**帧环形日志、不需要 `replay(since)`、不需要 `Last-Event-ID` 续传语义；
  `seq` 只用于**丢弃迟到帧**（幂等/乱序防护），不承担"检测丢包"的职责。
- ⇒ 也不再需要 `gapReloadToken`、"只触发一次"的签名、`resync_required`、重试退避、轮询。

**快照自洽性归一（盲审 P0-5）**：快照由两套存储拼出（内存态 `lastProgressSnapshot` +
DB `iteration_history`，`agent_backend_methods.go:181-232` 与 `engine_run_tools.go:527-537`），
在"`notifyProgress` 先、`beginIteration` 后"的窗口里可能读到不自洽的组合。客户端**必须**做一次**归一**
（不是猜测，而是把快照映射进模型的可表达状态）：

```
if live ≠ ⊥ ∧ live.iter ≤ blocks.last.iter      → live := ⊥        -- 与已提交同号 ⇒ 丢弃（不可表示）
if live ≠ ⊥ ∧ live.iter > blocks.last.iter + 1  → pullIter 补齐中间迭代
```

并把它写进后端 CI（"快照自洽"断言：`live.iter > blocks.last.iter` 且 `blocks` 的号连续/跳号有记录）。

> **为什么这不是兜底**：三种出口全是**读权威**（`pullIter` / `pullTurn` / `snapshot`），
> 且**都不构造内容**。兜底的定义是"用本地推断掩盖未知"；这里恰恰相反：**丢弃本地推断，取权威**。
> 模型**从不**把 `tick` 升格为提交块，也**从不**在"上一迭代不完整"时提交下一迭代。

#### 3.5.1 三条**并发口径**（用户 2026-10-21 追加，实现已按此落地）

**R-G1（补洞不能停 SSE）**：缺口只是"中间有个洞"，**不是在飞进度的终点**。
⇒ `tick` 遇缺口**照常应用**（打字机/工具继续跑），只额外产出 `pullIter`；
`done` 遇缺口把块放进 `pending` 缓冲（**绝不让 `blocks` 出现洞**），补齐后按序 drain。
⇒ 否则"补洞期间停止应用"会把每一帧都变成新的缺口，形成**无限补洞**。

**R-G2（必须先订阅 SSE，再取快照）**：`snapshot` 返回 `(state, epoch, seq0)`；
客户端**先建立 SSE 订阅**，再取快照，随后丢弃所有 `seq ≤ seq0` 的帧。
⇒ 反过来（先取快照、后订阅）会在两步之间丢帧，客户端只能再取快照——这正是无限补洞的第二种来源。
⇒ 因此快照端点必须与发帧**共用 per-chat 临界区**（§2.1：两阶段读 + 版本校验）。

**R-G3（ABSENT 记账，同一号只问一次）**：`pullIter` 得到权威 `ABSENT`（该迭代号不存在，
例如 resume 续号）⇒ 记入 `absent`；**此后不再请求该号**，`drain` 直接越过它。
⇒ 否则每次遇到同一个空洞都发一次请求，也是无限补洞。

### 3.6 投影 `project`

```
project(S) → Row[]     -- 纯函数；对未变化的 turn 返回**同一对象引用**

Row = UserRow | AssistantRow

顺序（与现状逐字一致，`derive.ts:272`）：
  legacy ++ turns(按 turn 升序) ++ standalone ++ local.pending
  · legacy      = 无 turn 归属的 DB 历史（前缀，只读）
  · standalone  = 无 turn 归属的**实时**命令回复（`!cmd`/slash），排在 turns 之后
  · local.pending = 乐观 user 行，沉底（Infinity）

每个 Turns[t] 产出 ≤ 2 行：
  user 行     : t.user ≠ ⊥ ∧ ¬(t.regionsBefore > 0)        -- 折叠窗口期间 user 行不渲染（现状语义）
  assistant 行: **仅当** t.user ≠ ⊥ ∨ blocks ≠ ∅ ∨ inflight ≠ ⊥ ∨ final.content ≠ ''
                （否则该 turn 不产出 assistant 行 —— 空 turn 的"幽灵行"由**投影**过滤，
                  不再是状态机的"删槽"动作：现状 `session` 分支的 1871-1873 删槽逻辑删除）
  assistant.kind = 'live'      if t.final = ⊥         -- 回合在飞
                 | 'committed' if t.final ≠ ⊥         -- 含 cancelled（同 kind，带 cancelled 标记）

AssistantRow = { turn, kind, cancelled,
                 blocks   : Block[]        -- 原样：**每个迭代一块**（⛔ 不吸收、不合并）
                 inflight : Block | ⊥      -- = LiveBlock(live) **当且仅当** live ≠ ⊥ ∧ live.turn = turn
                 phase    : string         -- ← TurnRec.phase（**回合级**：迭代间隙仍显示"思考中/压缩中"）
                 streaming: bool           -- ← TurnRec.streaming
                 streamStats, tokenUsage   -- ← TurnRec（上下文环/吞吐）
                 compactions : Compaction[]
                 droppedBefore, regionsBefore }

LiveBlock(live) = { iter: live.iter, content, reasoning, tools: copy(live.tools),
                    subAgents: [], genui: live.genui, cancelled: false }
                  -- 其 iter 恒 > blocks.last.iter ⇒ 永远追加在最后（I3′）

-- ⛔ **不做的事**：`todos`/`goal`/`queue` **不进** AssistantRow（它们是会话级，见 §3.7 的独立通道）；
--   否则"改一个 todo"会让整行重建。
-- ⛔ **空在飞块不产出**：`live = ⊥` ⇒ `inflight = ⊥`（不构造空块；现状 `render.ets:351-357` 也是丢弃）
```

**投影的三条纪律**（这是"零表现差异 + 高性能"的全部秘密）：

1. **一块一迭代**：`blocks` 原样渲染（`syncIterBlocks` 直接赋值，`render.ets:35-41` 已是此语义）。
2. **在飞只有一块且必然在末尾**：`inflight` 由 `live` 直接给出，**没有任何判定**。
3. **引用稳定**：`project` 以 `TurnRec` 对象为键记忆化（`WeakMap`，`derive.ts:185` 已有此模式），
   未变化的 turn 返回上一帧的**同一个 Row 对象** ⇒ UI 层只需 `next !== prev`。

### 3.7 UI 绑定（ArkTS 侧，唯一的薄层）

```
RowStore = Map<RowKey, ChatRow>          -- ChatRow 是 @Observed class（现状已如此）
apply(next: Row[]):
  · 结构变化（turn 增加/结束/顺序变化）：把 keys 与 next 对齐 → DataSource 通知**变化的索引**
  · 内容变化（某个 Row 引用变了）：把 next 的字段**写入**对应 ChatRow（就地）→ 触发 @ObjectLink
  · 未变化的 Row：什么都不做（指针相等）
```

三条结构性规则（把已知 ArkTS 陷阱变成规则，而不是每次踩）：

- **R-UI1**：`LazyForEach` 的 item builder **不接收"会变的值"作为 `@Prop`**。会变的值一律
  （a）由行对象自身承载（`@Observed` + `@ObjectLink`），或（b）由组件自己订阅
  `@StorageProp('appLocale' | 'appTheme' | 'xbotIterBadge' | …)`。
- **R-UI1′（盲审 P1）**：`blocks` 与 `inflight` **分别**用独立 holder（`IterBlocks` / live holder），
  只写**引用变化**的那个；⛔ 不要每帧把 `inflight` 并进 `blocks` 再整体赋值（那是 O(D) 重建，
  正是已知的长回合掉帧形态）。
- **R-UI1″（盲审 P1）**：会话级字段（`todos`/`goal`/`queue`）**不放进任何行**，各自有独立 holder；
  改一个 todo 只让 todo 组件重建，不让消息行重建。
- **R-UI2**：静息态恒为可见值；入场只用 `transition`（门禁 ⑨）。
- **R-UI3**：滚动/触摸期由 `listfollow` 的整数位图挂起"内容投递"（挂起的是**投递**，不是状态机）。

---

## 4. 正确性证明

> 证明风格：**结构归纳 + 类型封闭**。每条定理都指出"由哪个构造/类型保证"，而不是"哪个测试覆盖"。

### T1（决定性 / 单写者）
**命题**：`S` 的演进只由 `(S0, f₁…fₙ)` 决定；不存在第二条写路径。
**证明**：`step` 的签名是 `(S, Frame) → S`，无外部读取（无时钟、无随机、无全局可变变量）；
`snapshot` 只在 `S0` 与 `RESYNC` 时被调用，二者都在 `step` 的语义内。UI 层只读 `project(S)`。
⇒ 任意两次相同输入序列得到相同最终状态（可重放）。这也是 §9.3 差分测试可行的前提。

### T2（幂等 / 重复投递无害）
**命题**：若 `f.seq ≤ S.seq`，则 `step(S, f) = S`。
**证明**：`step` 的第一个守卫即此；无需其他判据。归纳：任何重复帧都不改变状态 ⇒ 重复投递序列等价于去重后的序列。
> 现状对照：`isStaleSeq`（`reduce.ts:658`）+ `seq: EventSeq | null` 的 `null` 分支（"无 seq 则不判重"）
> ⇒ 存在"重复帧被应用"的窗口。新模型里 `seq` 非空是 P1 的前提，`null` 分支**不可表示**。

### T3（恰好一次渲染 —— 存在性与唯一性）
**命题**：对任意 `call`，`project(S)` 的输出中它的出现次数**恰好为 1**（在它被服务端产生之后）。
**证明**（对任意中间状态归纳）：
- 工具的**唯一存放处**是 `live.tools`（本迭代未提交）或 `turns[t].blocks[i].tools`（已提交）。
  `step` 的每个构造子：
  · `tick` **整体覆盖** `live.tools`（不是并集）⇒ 集合性成立，无重复项；
  · `done` **追加一个完备的 `f.block`**（P4：`block` 含该迭代全部工具终态）⇒ 该迭代的全部工具
    **一次性出现在 block 里**；随后同号 `live` 被置 `⊥` ⇒ 不存在"两边都有"或"两边都没有"的中间状态；
  · `final` 的 `blocks` **替换**（若携带）⇒ 与已有块的重叠被替换掉，不会叠加；
  · `open` **幂等**（已存在 turn 只绑 user，不清 blocks）⇒ 不会把已提交内容清空。
- 渲染：committed 块渲染 `blocks[i].tools`；在飞块渲染 `live.tools`。二者互斥（I3′：`live.iter > blocks.last.iter`
  且同一 `call` 只属于一个 `iter`，P2）⇒ 同一工具只被一条渲染路径取用 ⇒ 次数 = 1。∎
> ⛔ 严格条件（盲审 P0）：**`done.block` 必须完备**（含被中断的 `running` 工具，标 `failed`）。
> 服务端只折 `CompletedTools` 时（现状 `engine_run_tools.go:518-532`），取消场景会漏工具 —— 这是 P4 的义务，
> 不是模型的自由度。
> 这是 R1 的**根治**：现状"6 处判定"变成"1 处存放位置"。任何"消失/重复"都不可能由客户端的合并逻辑产生，
> 因为客户端**没有合并逻辑**。

### T4（提交不可回退 —— "提交块最权威"）
**命题**：`turns[t].blocks` 只增不改；已提交块的内容不会被后续帧修改（唯一例外：`final.blocks` 的整体替换，仍是权威值）。
**证明**：`Block` 在 `TurnRec` 中不可变（`readonly`）；`step` 对 `blocks` 只有 `++ [block]`（追加）与
`final.blocks`（整体替换为服务端权威值）两种写入。不存在"就地修改第 i 块"的路径。
⇒ 用户看到的已提交内容**不可能被在飞数据覆盖或删改**。∎

### T5（良构：块号严格递增、单 live、工具归属一致）
**命题**：任意可达状态下：
(a) `turns[t].blocks` 的 `iter` **严格递增**（⇒ 同号块不可表示；允许跳号）；
(b) `live = ⊥ ∨ live.iter > turns[live.turn].blocks.last.iter`；
(c) 每个 `tool.call` 唯一，且 `tool.iter = 所属 block.iter`（或 `= live.iter`）。
**证明**：
(a) `blocks` 只能通过 `done`（前置：`f.iter > last`，否则丢弃，见 T7）与
`final.blocks`（服务端权威，P4 保证严格递增；违反 ⇒ 丢弃该帧 + 请求重放）改变；
(b) 初始 `live = ⊥`（`snapshot` 须满足：live 存在 ⇒ 其 iter > 已提交最大号）；
三个改变 `live` 的构造子各自维持：`done` 把同号 `live` 置 `⊥`，随后 `tick` 用更大的号重建；
`open` 置 `⊥`（新回合 blocks 空）；`tick` 携带的 `iter` 由服务端盖章（P2），
若 `tick.iter ≤ last` ⇒ 协议违反 ⇒ 丢弃该帧并请求重放（不猜测内容）；
(c) `call` 由服务端保证唯一（P2），且**生成态即有 id**；`tool.iter` 由服务端盖章，`step` 在 `done` 时
校验并**丢弃**不一致项（T7）。
⇒ 三条都是归纳不变量。∎
> 注意：**迭代号跳号**（resume 续号 `engine.go:708-712`、触顶早退）客户端**不假设、也不拒绝** ——
> 一律先 `pullIter` 逐个补齐，权威 `ABSENT` 才算合法跳号（§3.5 / B1）。

### T6（收敛 / 有界）
**命题**：对任意有限帧序列，状态在最后一帧后**不再变化**（无挂起的定时器、无延迟写入）。
**证明**：`step` 是同步纯函数；模型中**不存在定时器/重试/延迟**（`fail` 不重试，`RESYNC` 由帧或断线触发）。
⇒ 没有任何"之后还会自己改一次"的路径。∎
> 现状对照：`scheduleIdleRetry`/`applyLocalIdle`/15s 提示/轮询都在"之后自己改一次"，
> 它们的存在恰恰说明"新鲜度判据不唯一"。

### T7（全函数性 / 唯一外行为）
**命题**：`step` 对任意 `Frame` 有定义；唯一的"非本地后果"是 `RESYNC`。
**证明**：守卫四分支（异会话 / epoch 变化 / 过期 / 不连续）与六个构造子的后置条件穷尽了所有输入；
构造子内部的前置条件违反（如 `done.iter ≤ last`、`tick` 的 `base` 不匹配）被**两条统一规则**处理：
（i）**已过时**（`iter ≤ last`、`seq ≤ last`、更旧迭代的 `tick`）⇒ **丢弃**（权威值已存在 ⇒ 丢弃不丢信息）；
（ii）**迭代不完整 / 收尾缺失**（`iter > last+1`、`final` 缺失）⇒ **按对象拉权威**（`pullIter`/`pullTurn`），
`ABSENT` 才算合法跳号；**`seq` 跳号本身不触发任何动作**（以最大为准，被跳号后到即丢弃）。
⇒ 没有"部分应用"的状态，也没有"猜测式修补"。∎
> 这就是"零兜底"的形式化：不存在"如果缺失就构造一个占位"的分支；缺失只有"重新取权威"一条路。

### T8（表现等价）—— 引理 + 差分判据
**命题**：对同一帧流，`project(S_new)` 与现状实现产出的行列表**逐字段相等**。
**证明策略**（不是纯形式证明，而是**可执行的证明**）：
1. **引理 L1（一块一迭代）**：现状 `syncIterBlocks` 已把 `blocks` 原样交给渲染（`render.ets:41`），
   新模型同样原样 ⇒ 块列表相同。
2. **引理 L2（在飞块位置）**：现状 `inFlightBlock` 在"存在未提交工具/文本"时必然非空（`render.ets:469`
   删掉早退门后的语义），其 `iter = r.lastIter`；新模型 `inflight.iter = live.iter = last+1`。
   两者相等当且仅当"现状的 `lastIter` 恒等于已提交最大号 + 1"——这正是**P4 完备性**的内容。
3. **引理 L3（工具集合）**：现状 = `activeTools ∪ streamingTools ∪ completedTools` 经
   `isToolRendered`（`iter ≤ maxCommitted` ⇒ 丢）+ `mergeTools`（按 `call_id` 去重）；
   新模型 = 服务端盖章的单一 `tools[]`（P2/P3）⇒ 同一集合。
4. **差分判据**（§9.3）：把已录制的真实 SSE（`core/sse_recorder.ts` 产物）同时喂给两端，断言
   `rows_old ≡ rows_new`（逐字段）。**录制集覆盖所有已修缺陷的现场**（含"纯工具迭代""同号双块"）⇒
   任何不一致都会被任一录制文件抓到。

> 结论：T8 的"证明"是 **L1–L3 的结构论证 + 全量录制回放的机器判定**。本文档不声称"形式化验证"，
> 但把"逐条肉眼对照"替换为"逐字段机器比对 + 缺陷现场全覆盖"。

---

## 5. 删除清单

> 口径：**删掉的每一行，都对应 §4 里的一条定理**。凡"删了以后谁保证"写不出定理的，就不删（那是真逻辑）。
> 行号 = 基线 `c2db530`。

**迁移期例外（盲审 P2-9，必须写进排期）**：下列删除**不能在 W2/W3 做**，因为它们的职责在 P4 落地前仍然必需，
只能由 **W2/W3 的适配层**承接（适配层是"旧事件 → 新帧"的形状转换，W4 后随直通一起删除）：

| 位置 | 为什么迁移期还要 |
|---|---|
| `render.ets:253-295`（同号/上一号**等长正文**比较） | 旧事件仍在"推进帧里回带上一迭代正文"（`reduce.ts:297-306` 的 `advanceCarriesCommittedCopy` 只在 `deltaLen===0` 时判副本） |
| `render.ets:486-503`、`508 collapseSameNumberBlocks` | 旧协议仍会把**在飞迭代的空壳**记进 `iteration_history`（`render.ets:448-454` 注释）⇒ 同号双块可达 |
| `derive.ts:356-363 / 457-462 / 466-484`（frozen 折工具 + `markError`） | 取消路径不写迭代记录（P4 缺口）⇒ 只能由 frozen 行保住"正在执行的工具"并标失败 |
| `normalize.ts:539 dedupeIterationsByNumber` | 旧协议在 `PhaseDone` 同时挂 `finalIteration` 与迭代历史（`engine_wire.go:2052-2076`）⇒ 同号重复可达；它还负责按号排序 |
| `store.ets:792-807`（假 idle 丢弃） | 旧协议的 idle 仍可能乱序；新模型靠"idle 不改回合相位"，但旧事件里 idle **会**改相位 |

### 5.1 `core/reduce.ts`（2 850 → 目标 ≈ 350）

| 位置 | 现状作用 | 为何冗余 | 删除后由谁保证 |
|---|---|---|---|
| `mergeIterations:141` | 同号迭代四象限合并 + 工具并集 | 提交块只追加、不合并 | T4/T5（`blocks ++ [b]`） |
| `foldKnownToolsIntoCommitted:220` | 把 live 工具折进已提交块 | `done.block` 自带完备工具集 | P4 + T3 |
| `mergeToolUnion:265`、`sameToolKey:2742` | 工具并集 / 身份键 | 工具只在 `live.tools` 或 `block.tools` 之一；不在客户端并集 | T3 |
| `advanceCarriesCommittedCopy:297`、`iterFieldOf:309` | 迭代前进时"回带"上一迭代正文的去重 | 服务端按迭代重置正文（P3） | P3 |
| `sameTodos:322`、`sameGoal:332`、`sameCompactions:2822` | 结构相等以避免新建对象 | `patch` 单函数 + 引用恒等 | §6 第 13/14 项 |
| `maxHeldIteration:339` | gap 判据 | 判据是 `seq` | P1 + T2/T7 |
| `lostIterGapSig:366`、`liveAheadGapSig:406`、`withLiveAhead:420`、`unreachableGapSig:438`、`sameIterationShapes:476`、`joinSig:491`、`reuseIfSame:502`、`filterIfNeeded:509`、`sameItems:515`、`sameTurnMap:523` | 三种"洞"签名 + 一堆记忆化辅助 | 洞的判据 = `seq` 不连续；洞的修复 = `snapshot` | T7（唯一外行为） |
| `mergeStreamStats:543` | 合并时序 | `tick` 覆盖 | P3 |
| `hasOutput:566` | 第 4 份"有无产出"实现 | 只需一份（`liveHasOutput`），且投影只需要"是否全空" | §3.6 空行规则 |
| `lazyAdoptLive:588`、`isHollowFrozen:601` | 惰性采纳 / 空壳冻结 | turn 只有 2 态（live / committed） | §3.2 |
| `markToolsCompleted:618` | 服务端不保证终态时补标 | `done` 自带终态 | P4 |
| `hasStreamEvidence:626` | stream 复活判据 | `seq` | P1 |
| `isStaleSeq:658` **（保留 seq 规则；删除内部"新迭代信息"逃生舱）** | 陈旧判据 + 逃生舱 | 逃生舱存在的原因是没有 seq 保证 | P1 |
| `settleSendingInvariant:719`、`satisfyRunningInvariant:825`、`settlePendingSending:2624` | 两条"不变量修补"包装 | running 只由 `session` 帧改变；turn 相位只由 `open`/`final` 改变 ⇒ 不需要修补 | T1 + P6 |
| `foldInFlightToIterations:2687` | 收尾时把 live 折进块 | `done` 已提交；`final` 只做整体替换 | P4 |
| `mergeTurnData:2758` | history 合并 | `snapshot` 直接构造 | §3.5 |
| `foldPhase:2834` | 相位推导 | 2 态模型 | §3.2 |
| `applySessionFields:93` | 会话字段逐字段 setter | 通用 `patch` | P5 |
| `reduceInner` 的 15 分支 switch（1 767 行） | 事件处理 | 6 个构造子 | §3.3 |
| **保留**：`advanceSeq:847`（seq 单调）、`liveHasOutput`（唯一"有无产出"）、`commitViaText/Fold` 的 `NonEmpty` 纪律 | | | |

### 5.2 `core/render.ets`（836 → 目标 ≈ 200）

| 位置 | 现状作用 | 为何冗余 | 删除后由谁保证 |
|---|---|---|---|
| `isToolRendered:105` | 工具是否已画 | 工具的存放位置即答案 | T3 |
| `isShell:370`、`collapseSameNumberBlocks:521` | 空壳判定 / 同号块收敛 | 同号块不可表示 | T5(a) |
| `liveIterations:457` + `inFlightBlock:232`（含 253-295 **逐字正文比较**、486-503 同号丢弃/三空顶位） | 构造在飞块 | `inflight = LiveBlock(live)` | §3.6 第 2 条纪律 |
| `convertedBlocksMemo:399` / `liveBlocksMemo:393` | 两级缓存 | 一级（按 `TurnRec` 恒等）足够 | §3.6 第 3 条纪律 |
| `sameToolEssence:618`、`sameToolArr:639`、`sameRefArr:651`、`sameRowEssence:674` | 结构化 diff | 指针比较 | §3.7 |
| `applyRow:736`、`invalidateAppliedRow:720` | 逐字段写 + 结构比较 | 引用变了才写 | §3.7 |
| `liveConvHits/Misses/Blocks` 统计（`liveBlocksConvStats`） | 性能判据 | 判据改为"每帧 `project` 分配数" | §9.5 |
| **保留**：`toHistoryIteration` 的 `WeakMap` 恒等记忆化（`:167`）、`toToolProgress` 字段映射、`syncIterBlocks` 的"引用不变 ⇒ 零通知" | | | |

### 5.3 `core/streammerge.ets`（884 → 目标 ≈ 80：只剩 `foldPills`）

`mergeTools:188`、`toolKey:175`、`toolRank` 内联（`:206-210`）、`iterAbsorbable:658`、
`mergeToolRuns:711` / `mergeToolRunsUncached:729`、`completedBlocks:354` —— **全删**。
理由：前三者是 §1.1(b)(d) 的重复判据；"吸收相邻纯工具迭代"已被结构性废止（每迭代一块，用户指令）；
`completedBlocks` 与 `render.convertedBlocksMemo` 是同一件事的两个缓存。
保留 `foldPills:638`（**纯视图函数**：`tools.length > 8` ⇒ 折叠，与状态无关）。

### 5.4 其他 `core/*`

| 位置 | 处置 |
|---|---|
| `normalize.ts:539 dedupeIterationsByNumber`（O(N log N)）、`:294/:381` 调用点 | **删**（服务端"每迭代恰好一条 `done`" ⇒ 无需去重） |
| `normalize.ts` 的 `toolsCarried` 语义 | **删**（P5 三态） |
| `agent_normalize.ts:162-… historyProgressToLive`（含迭代边界 guard `:191`、按 `tool.iteration` 归块） | **删**（事件已是位置状态；只在 `snapshot` 里做形状转换） |
| `toolmerge.ts` 全文件（`toolRank:26`、`activeToolKey:48`、`mergeActiveStatus:75`、`detailIterationOf:109`、111 行） | **删**（状态单调由服务端状态本身保证；详情按 `(call)` 取，见 §6 第 5 项） |
| `chat_types_full.ts:34-36` `turnID()/iterNum()` 的 `0 → 1` 伪造 | **删**（P2：不存在 0 号；类型直接用 `Nat⁺`） |
| `chat_types_full.ts:135 TurnPhase` 三态 → 两态；`:279 liveRunningIn`、`:287 withSessionRunning` | **删/改**（`running` 与 turn 相位**正交**） |
| `chat_types_full.ts:391 DomainEvent` 15 → 6 | **改** |
| `state_invariants.ts`（135 行，9 条运行时体检） | **降级为 dev 断言**：只保留 T5 的三条（块号递增 / 单 live / 工具归属），在 `step` 里 `assert`（debug 构建），release 不跑 |

### 5.5 `core/store.ets`（4 348 → 目标 ≈ 2 000）

| 位置 | 现状作用 | 为何冗余 |
|---|---|---|
| `staleRunningFrame:792-807` | 意图窗内丢弃 `session_running(false)` | turn 相位不再由 idle 改变（§3.4） |
| `settleIntentOnAuthoritative:825` | 权威到达时结算本地意图窗 | 同上；绑定只靠 `requestID`（P2） |
| `applyLocalIdle` / `scheduleIdleRetry` / `watchBusyWithoutLiveTurn:851` / `resyncAfterResume:849` / `watchGapReload:853` | 各种"之后自己改一次" | T6（模型无定时器） |
| 会话轮询定时器（5s/30s）、15s 有界提示、`dispose` 的"摘 4 个回调" | 补 seq 缺失 | P1/P6 |
| `rebuildRows:967-1061`（每事件 `deriveRows` + 每行 `applyRow`） | 投影 | 改为"投影一次 + 指针比对"（§3.7） |
| **保留**：`beginSwitch`/`chatGen`/`stillSame`（跨会话身份）、SSE 连接与重连、`sse_recorder`、RPC/terminals/subscription 等**与状态机无关**的模块 | | |

### 5.6 `pages/Index.ets`（13 214 → 目标 ≈ 11 000；UI 组件与布局不动）

| 位置 | 现状（复杂度） | 处置 |
|---|---|---|
| `rowsFp`（`rowdiff.ets:105-111`） | O(rows) 拼串 + 比较/帧（busy 期置 `''` 规避） | **删**（指针比较） |
| `structFp`（`rowdiff.ets:125-135`） | O(rows) 拼串 | **删** |
| `sessionsFp:10008`、`queueFp:10017`、`todosFp:515`（**含正文全文**） | O(N) 拼串 | **删** |
| `tailKeySig:10032` | 每个 busy 帧 O(tail) 拼串 | **删** |
| `sessionScopedRowKey`（`rowdiff.ets:78-92`：`chat#id#locale#sending#queued`） | 行键把"会变的状态"编进 key ⇒ 键变即重建整行 | **改**：键 = `chat#rowID`；`sending/queued/locale` 走 R-UI1 的订阅通道 |
| `syncRowDs:10043`（busy 快路径 + 倒序找 live 行） / `feedRowDs` / `syncLiveTail:10253` / `syncLiveView:10131` | 两套投递机制 + 100ms 节流 + 可见性判断 | **改**：一个 `applyRows(next)`（结构通知 + 引用写回） |
| `navAnchors` 以 `structFp` 为 memo 键 | 结构变化 ⇒ O(rows) 重建 | 改以"turn 集合身份"为键 |

### 5.7 后端（`/Users/bobli/src/xbot`）删除清单

> 后端改动不是"加法"：模型把客户端的 20+ 判据搬回服务端后，服务端为"前端能过滤"而做的补丁同样消失。

| 位置 | 现状作用 | 处置 |
|---|---|---|
| `ProgressEvent.seq`（`events.go:117-201`，初值 UnixMilli） | agent 侧进度计数，被客户端当"陈旧判据" | **删**（信封 seq 唯一） |
| `sendHeartbeatLive`（`web_sse.go:752-775`）+ `heartbeat` 裸帧（`728-741`） | 周期性重发活动进度快照（内含旧 seq） | **删**，改 `keepalive{epoch,seq}` |
| `active_tools` / `completed_tools` / `streaming_tools` 三数组（`events.go:117-201`） | 三份并行语义 + 残留 | **合成** `tools[]`（位置状态） |
| `engine_run_tools.go:47-65`"整批先 `pending`" + `engine_wire.go:2436-2445`"前端必须按 iteration 过滤" | 服务端省事、客户端背锅 | 服务端只发当前迭代（§2.1） |
| `tools_folded`（`events.go:230-247`、`channel/region_view.go:208-211`） | 折叠投影的"详情已省略"标记；**live 恒 false**（`events.go:193-200`） | **删**（折叠是纯视图函数：`tools.length > 8`） |
| `ToolCallSnapshot` / `tool_calls` 字段（`events.go:6-12`） | 疑似遗留（Go 侧未见赋值点） | **删**（待确认后） |
| `iteration_history`（全量）+ `iterationsDelta`（增量）双通道 | 同一事实两条路，客户端必须"合并"（`mergeIterations` 的来源） | **合成** `done` 帧（每迭代一条） |
| `goal:{objective:"",status:"cleared"}` 墓碑（`agent_backend_methods.go:598-601`、`events.go:30-34`） | 表达"清除" | **删**，用显式 `null` |
| `emitGoalProgress`/`emitTodosProgress`/`emitBuiltinProgress` 里的 `Iteration: 0`（`agent.go:4697-4711` 等） | 无 turn 的 progress 帧 | **改**为 `session` 帧 |
| `resync_required` + `baseline_seq`（`web_sse.go:519-527`、`785-801`） | 粗粒度"要重载" | **删**；改由 `pullIter` / `pullTurn` / `snapshot` 三个权威读取承担（§3.5），不再需要"整会话重载"信号 |

### 5.8 净账（估算）

| 层 | 现在 | 之后 | 差 |
|---|---|---|---|
| `reduce.ts` | 2 850 | 350 | −2 500 |
| `streammerge.ets` | 884 | 80 | −800 |
| `render.ets` | 836 | 200 | −640 |
| `normalize.ts` | 579 | 200 | −380 |
| `agent_normalize.ts` | 269 | 80 | −190 |
| `toolmerge.ts` | 111 | 0 | −111 |
| `state_invariants.ts` | 135 | 30 | −105 |
| 新增 `model/step.ts` + `model/project.ts` + `model/adapter.ts` | 0 | ≈ 700 | +700 |
| `store.ets` | 4 348 | ≈ 2 000 | −2 300 |
| `Index.ets` | 13 214 | ≈ 11 000 | −2 200 |
| **合计** | **23 226** | **≈ 14 640** | **≈ −8 600** |

**判据数量同样下降**：`tools/tests/` 里以"合并/去重/兜底"为对象的测试（`merge*`/`dedupe*`/`fold*`/
`sameNum*`/`gap*`/`shell*`）可整体删除，替换为 §9.1–§9.4 的四类判据。

---

## 6. 零差异映射表（可观察行为 → 新模型位置）

> 逐条对照"用户能看见的东西"。每行都必须能指出**新模型里保证它的那一条**；指不出的，说明该行为
> 不是从状态机派生的（属于 UI/主题/平台），列在最后。

| # | 可观察行为 | 现状实现 | 新模型 |
|---|---|---|---|
| 1 | 每个迭代**单独一块**，块号 = 后端迭代号 | `syncIterBlocks` 直传 `blocks`（`render.ets:41`） | `project`：`blocks` 原样（§3.6 纪律 1） |
| 2 | 已提交内容**最权威**，不被在飞数据覆盖/合并 | `liveIterations:486-503` 丢弃 live 块 | T4（只追加 + `final` 整体替换） |
| 3 | **纯工具迭代不消失**（正文空、工具非空） | 删早退门 + `inFlightBlock` 三数组 | T3（工具在 `live.tools` 或 `block.tools`，二者互斥且完备） |
| 4 | 同一工具**只画一次** | `isToolRendered`（整数号） | T3（存放位置唯一） |
| 5 | 工具状态**只升不降**（executing 不被 pending 覆盖） | `mergeActiveStatus` + `toolRank`（两处） | P3：`tick.tools` 是**服务端状态快照**，客户端不合并 ⇒ 单调性是服务端状态的性质 |
| 6 | 迭代内**先完成**的工具不消失（`completed_tools`） | `inFlightBlock` ③′ 并入第三数组 | P3：`tools[]` 含 `status=done` 的项 |
| 7 | 工具数 > 8 折叠成 pill 组，可展开看详情 | `foldPills` + `PILL_INLINE_MAX` | 保留（**纯视图函数**）；详情按 `(call_id)` 取 |
| 8 | busy 期输入框显示 cancel、发送后立即 busy；**等待用户回答时不显示 cancel** | `busy` 三路 OR + 乐观 running + `askUser` 互斥（`store.ets:551`） | `(sess.running ∨ local.pending ≠ ∅) ∧ askUser = ⊥`（P6 + 本机意图） |
| 9 | 侧边栏 `running` 指示 | `sessionsFp` 比较 `running` | `sess.running`（指针比较） |
| 10 | **迟到 `idle` 不冻结在飞 turn** | `satisfyRunningInvariant` + `staleRunningFrame` + 15s 窗 | 结构性：`session{running}` **不改 turn 相位**（只改 `sess.running`）；相位只由 `open`/`final` 改 ⇒ 迟到帧无事可做 |
| 11 | 发送中/排队的 user 行沉底；**失败消息被移除**（不是留在列表里） | `pendingUsers`；`user_fail` **删行**（`reduce.ts:2611-2615`） | `local.pending`（投影末尾）；`fail` 意图 ⇒ **移除**（行为与现状一致） |
| 12 | 命令回复（`!cmd`/slash）作为**无 turn 独立行**排在 turns 之后 | `text_final.commandReply` → `standalone` 段 | `final(turn=∅, ...)` → `standalone`（`TurnRec` 之外的单列） |
| 13 | goal banner 三态（有 / 无 / 已清除） | `goal?: Goal \| null` + `{objective:"",status:"cleared"}` 墓碑 | P5 三态 + `patch`（`null` = 清除；删墓碑） |
| 14 | todos 跨 turn 存活 | `sess.todos` | `sess.todos`（`[]` 是值，P5） |
| 15 | 长 turn 顶部「更早的 N 个区域」分隔条（可动态取回） | `regionsBefore` + `POST /api/regions` | 保留字段（`TurnRec.regionsBefore`），**与模型正交** |
| 16 | 「更早的 N 个迭代」截断提示（turn 级 + legacy 前缀） | `iterationsTruncated`（turn）+ `LegacyRow.iterationsTruncated`（legacy） | `TurnRec.droppedBefore` + legacy 段的同名字段（两者都要） |
| 17 | 主题/字号/语言/迭代号徽标**即时**跟随 | `@StorageProp` 各组件自订阅 | R-UI1（同一机制，成为**规则**） |
| 18 | 滚动跟随 / 用户滚动时暂停 / 「回到最新」 | `core/listfollow` 整数位图 | 保留（与模型正交） |
| 19 | 切会话不串台（A 的内容不出现在 B） | `syncFrom` 首行 `store !== this.store` + `chatGen` | `(chat, gen)` 身份（T1 单写者） |
| 20 | 401 后**停止**轮询/重连 | `dispose` 清 4 个回调 | 无轮询（P6）⇒ 该类缺陷**不可表示** |
| 21 | SSE 全量录制 / REPLAY 页 | `sse_recorder` + `SseReplay` | 保留；REPLAY 直接喂 `step`（少一层 normalize） |
| 22 | 流式期滚动不卡（不掉帧） | 滚动期挂起 + 100ms 节流 | R-UI3 + 每帧 O(1)（§7） |
| 23 | 开发者「显示迭代号」开关 | `AppStorage('xbotIterBadge')` | 保留（R-UI1 通道） |
| 24 | 无输出的内部 turn 不产生"幽灵行" | `session` 分支删槽（`reduce.ts:1871`） | **投影过滤**（§3.6 空行规则）—— 从"改状态"变成"不改状态" |
| 25 | 通知 turn（notification trigger）的 user 行 | `turn_started` 的 **4 层绑定回退**（requestID→turnHint→内容匹配→唯一 sending） | `open(turn, user, requestID)` 必带三者 ⇒ **回退全部删除** |
| 26 | 子代理进度树（**live 与历史回合都要有**） | `LiveSnapshot.subAgents` + 每迭代冻结（`engine_run_tools.go:511-515`） | `LiveIter.subAgents` + `Block.subAgents`（两者都要，否则历史回合的树消失） |
| 29 | 回合内压缩点横线（迭代之间） | `CommittedPayload.compactions` + `IterBlocksView` | `TurnRec.compactions`（**模型必须有这个字段**，否则横线消失） |
| 30 | GenUI 面板卡片 | `LiveRowView.genui` + `GenuiPanelCard` | `LiveIter.genui` + `Block.genui` |
| 31 | 取消后**正在执行的工具显示为失败** | `frozen` 行折入 + `markError`（`derive.ts:356-363/457-462`） | `Tool.status = failed`（P4：取消时 running ⇒ failed）；行仍是 committed，只是带 `cancelled` |
| 32 | **迭代间隙**仍显示"思考中/正在压缩上下文…"与上下文环/吞吐 | `phase/streaming/tokenUsage` 挂在 live 上 | `TurnRec.phase/streaming/tokenUsage`（**回合级**，`live = ⊥` 时照样有值） |
| 33 | Staging Tray（排队消息的增删/重排） | `store.ets` 的 queue + `StagingTray`/`QueueSheet` | `sess.queue`（全量替换；`queue` 是**会话级**，不进行） |
| 34 | todo 列表 | 挂在 live 行上 | `sess.todos`（会话级独立通道；改 todo 不重建行） |
| 35 | 命令消息**永不会有 turn**（`!cmd`/slash 的乐观行必须能退役） | `user_ack` 的 command 分支（`reduce.ts:2547-2563`） | 意图 `ack{kind:'command'}` ⇒ 移入 `standalone` |
| 36 | 排队消息在发出后从"发送中"转为"排队中" | `user_ack` 的 queued 分支 | 意图 `ack{kind:'queued'}` ⇒ 撤出 `local.pending`、由 `sess.queue` 展示 |
| 27 | 进度相位提示（`thinking` / `tool_exec` / **`compressing`** 压缩提示） | `LiveSnapshot.progressPhase` 透传（`chat_types_full.ts:74` 记录了 M4 丢字段的回归） | `tick.phase` → `TurnRec.phase`（`done`/`final` 也带）⇒ 行直接读，**不再依赖 live 是否存在** |
| 28 | 上下文环 / token 用量 / 吞吐（tkps） | `LiveSnapshot.tokenUsage/streamStats` | `LiveIter.tokenUsage/streamStats`（`tick` 覆盖） |

**不属于状态机的部分（本次不动）**：设计系统 `core/design.ets` / 主题 `theme.ets` / i18n / 通知
`notify.ets` / 插件宿主 `pluginhost.ets` / 终端与 SSH / markdown 渲染缓存 / 所有 ArkUI 组件的
**结构与样式**（只改它们的**数据来源**）。

---

## 7. 性能论证

### 7.1 每帧成本（新模型）

| 阶段 | 工作 | 上界 |
|---|---|---|
| 解析 | 一帧 JSON → `Frame` | O(载荷)。不可省。 |
| `step`（`tick`） | 4 个字段赋值 + 数组引用替换 + 回合级 5 个字段 | **O(1)**（`tools` 用引用替换，不逐项比较） |
| `step`（`done`） | 追加一块 + 不可变 `turns` 的 Map 拷贝 | **O(T_turns + D)/迭代**（`new Map(prev)` 是 O(T_turns)；现状 `withTurn` 亦然）。T_turns=2 000 时 ≈ 数千次指针拷贝 ≈ 数十微秒，每迭代一次 |
| `step`（`final`） | 若带 `blocks` 整体替换 O(D) + Map 拷贝 O(T_turns) | 每 turn 一次 |
| `project` | 遍历 turn 生成 `Row[]`（O(T) 指针比较/拷贝）；**只有 in-flight 那一行**需要新建（O(k)） | **O(T) 指针 + O(1) 行内容**（与"N 在循环里做重活"不同：T 只是数组搬运） |
| UI 投递 | `next !== prev` 指针比较；只有引用变的行写入 `ChatRow` 字段 | **O(T) 指针比较 + O(1) 写入** |

**结论（修正盲审 P1-6）**：流式帧的成本是 **O(T) 指针级 + O(1) 算术级**，**不含任何与 N（历史迭代数/块数）
成正比的"重活"**（无字符串拼接、无内容比较、无逐块重建）。T = 会话内回合数（数十量级；2 000 迭代的**单回合**
只让 `D` 变大，不影响 T）。若 T 本身很大（千级回合），`project` 的数组搬运仍是 O(T)——这是**任何列表模型
的下界**（现状 `deriveRows` 也是 O(T)），且可用"只重建变化的那一段"进一步优化（不属于本模型必需）。
`done` 的 `new Map` 可去掉（`turns` 改为单写者可变 + lint 保证，见 §9.6）。

**`project` 的 memo 键（盲审 P1-6 补充）**：**不能**只用 `TurnRec` 做键 —— 流式期 `TurnRec` 不变而 `live` 在变。
⇒ 键 = `(TurnRec, live)`：`live = ⊥` 或 `live.turn ≠ t.id` 时键退化为 `TurnRec`（历史行复用）；
在飞行的 turn 每帧重算（本来就只有一行）。

### 7.2 被删除的 O(N) / O(N log N) 路径（现状每帧或每事件）

| 现状路径 | 复杂度 | 触发频率 |
|---|---|---|
| `rowsFp` / `structFp` / `sessionsFp` / `queueFp` / `todosFp`（`todosFp` **拼正文全文**） | O(rows) 拼串 + O(len) 比较 | 每个非 busy 帧 |
| `tailKeySig` | O(tail) 拼串 | 每个 busy 帧 |
| `isStaleSeq`（内含 `maxHeldIteration`） | O(N) max 扫描 | 每个 `iteration`/`phase_done` |
| `sameIterationShapes` | O(N) | 每个 `phase_done`/`text_final` |
| `mergeIterations` | O(N) Map + 2×O(N) 引用比较 | 每个 `iteration`/`text_final`/`history_replaced` |
| `lostIterGapSig` | O(N) | 每个 `iteration`/`stream` 帧 |
| `dedupeIterationsByNumber` | O(N log N)（末尾 sort） | 每个 `phase_done`/`iteration` |
| `inFlightBlock` | O(工具数 × 已提交块数)（`isToolRendered` 线性扫 3 次） | 每个 live 帧 |
| `foldInFlightToIterations` / `foldKnownToolsIntoCommitted` | O(工具数 × 迭代数) + 内层 `findIndex` | 提交边界 |
| `applyRow` → `sameRowEssence` | O(块数 + 工具数)/行 | 每个 rebuild 的每行 |

全部随 §5 删除 ⇒ **模型里不存在"N 在循环里"的位置**（除 `project` 的 turn 遍历，见 7.1）。

### 7.3 为什么不用指纹/哈希/字符串

- **身份**：`turn`/`iter` 是整数，`call` 是不透明 id ⇒ 判等是整数比较或引用比较。
- **变化检测**：对象恒等（`next !== prev`）⇒ 没有"计算指纹再比较"这一步。
- **铁律（门禁化）**：**禁止用内容（正文/思考/参数/输出/label）判等**。§9.6 增加 lint 判据。

---

## 8. 迁移路径（每一波都能独立验证、独立回滚）

> 顺序原则：**先有"证明手段"（录制+差分），再换实现**；后端改动放在前端"适配器"之后，
> 使任一侧单独上线都不破。

| 波 | 内容 | 判据（必须全绿才进下一波） |
|---|---|---|
| **W0** | 固化**差分基线**：把 `sse_recorder` 的录制集（覆盖已修的 4 类 P0 现场）纳入 `tools/tests/replay/`；写 `replay_old.ts` 输出"行/块/工具"的规范化快照（golden） | `golden` 可复现；同输入两次输出字节一致 |
| **W1** | 新增 `core/model/{adapter,step,project}.ts`（纯 TS，无 ArkUI）：**旧 15 事件 → 6 帧**的适配器 + `step` + `project`。**影子模式**：`store` 里并行跑新旧两套，只记差分日志，不影响 UI | 差分日志零不一致（全部录制集）；`run.sh` 全绿 |
| **W2** | 切换 UI 到 `project`（新投影 + 指针投递），删页面指纹与 `applyRow` 结构比较 | 真机：26 条可观察行为逐条对照（§6）；性能判据（§9.5）达标 |
| **W3** | 切换状态机写者为 `step`，删 `reduce.ts`/`render.ets`/`streammerge.ets` 的 §5.1–5.3 全部条目；`state_invariants` 降级为 dev 断言 | `gate.sh` 全绿；差分仍是零不一致；旧测试的删除/迁移清单逐条勾掉 |
| **W4** | 后端：发帧归一（seq 盖章 / `tools[]` 单数组 / 每迭代 `done` / 迭代内正文重置 / `omitempty` → `null` / 快照带 `seq`）；前端适配器瘦身为**直通** | 后端 CI 新增 3 条判据（§10.2）；真机全量回归；`snapshot` 路径实测 |
| **W5** | web 同源化：`web/src/chat/reduce.ts` 换成同一转移表；删 web 的 `mergeIterations`/`dedupe*`/`completedIterKeys`/`shellSameNum` | `model_parity.test.ts`：同一录制集，两端投影逐字段相等 |

**双跑期纪律**：W1–W3 期间新模型**只旁听不写**（shadow），任何不一致都先修模型，**不允许**在旧实现上打补丁。

### 8.1 落地记录（2026-10-21）

| 波 | 状态 | 事实 |
|---|---|---|
| W1 | ✅ 完成 | `core/model_{types,adapter,step,project,hydrate}.ts` + `core/model_bridge.ets`；影子引擎在生产事件流上跑，差分日志零不一致 |
| W2 | ✅ 完成 | `store.rebuildRows` 行源切 `applyModel`（真机验证：正文/工具/思考/高度全对，提交 `59d5556`）；随后下线逐帧 ROWDIFF（`8259d2a`） |
| W3 | ✅ 完成 | 见下 |

**W3 落地（删旧层）**

1. **唯一入口收口**：`model_bridge.stepEvent(state, ev, chat)`（`history_replaced` 走 `hydrate` 水合，其余 `adapt → stepAll`）
   + `applyModel`。实时（`store.runShadowModel`/`rebuildRows`）与录制重放（`pages/SseReplay`）走**同一个函数**，
   不再各写一份事件翻译。
2. **删除**：`derive.ts`（W3 已删除）（`deriveRows`/`Row` 判别联合）、`core/render.ets` 的 `applyRow`/`rowSignature`
   家族（`sameRowEssence`/`sameToolEssence`/`sameToolArr`/`sameRefArr`/`appliedRowByRow`/`invalidateAppliedRow`）、
   `core/integrate.ts` 的 `rowsToChatMessages`/`rowToChatMessage`（零消费）。turndrop 诊断搬到 `core/turndrop.ts`。
3. **判据迁移**：所有 `deriveRows + applyRow` 的测试改为 `tools/tests/model_harness.ts` 的 `ModelFeed`
   （→ `stepEvent` → `applyModel`），**断言实质不变**；旧/新等价判据（`model_row_equiv`、`model_diff_prop`）随旧实现删除。
4. **桥接修正（真机等价面）**：在飞块必须带 `live: true`（页面 `syncLiveTail` 靠它找打字机块，
   `Index.ets:10320-10341`）；迭代块必须带 `subAgents`（子代理树）；行 `rev` 自增（诊断）。
   ⇒ 判据 `tools/tests/tool_status_rowrebuild.test.ts` 的 ①d/①e 钉住 live 标记。
5. **`/compress` 之后会话必须继续**：turn-less 命令（`/compress`、`/settings`…）从不进入 Run 循环，
   而 goal 的续跑只在 Run 内部（PreTurnEnd）⇒ 有 active goal 时命令执行完会永久 idle
   （用户 2026-10-21 亲报）。修在后端命令分发（`agent/agent.go` + `goal.resumeRunAfterCommand`）。


**硬前置（盲审得出，必须写进排期）**：

1. **P4 是 W3 的硬前置**：取消路径三处不补（`engine_run.go:1001-1008`、`agent_process.go:443-554`、
   `engine_run_tools.go:518-532`），被取消的迭代既没有 `done` 也没有完备块 ⇒ 新模型会按 T7 丢弃该迭代
   或触发重同步（用户可见："取消后刚跑完的内容消失"）。**W2/W3 期间由适配层负责**：把现有
   `iteration_history`/`phase_done`/最后一条 progress **合成** `done`（这是适配层的形状转换职责，
   不是模型兜底；W4 之后该合成分支随之删除）。
2. **`seq` 只需"不许回退/重号"（C-1）**，不再需要"稠密"：客户端跳号即取最大（§3.4 前置）。
   因此 W4 的这项改动比早前版本小得多（缺的是 per-chat 计数器 + 所有出站路径盖章）。
3. **`call_id` 从 generating 起就有（R3）必须与"工具数组归一"同批上线**：只做归一不补 id ⇒
   同名工具误杀会原样复发（这正是本轮 P0 的根因）。

---

## 9. 判据（每条都有判别力 + mutation 自证）

### 9.1 模型单测（纯 TS，`tools/tests/model_step.test.ts`）

1. **幂等**：同一帧应用两次 ⇒ `S` 不变（T2）。
2. **乱序/重复**：`f.seq ≤ S.seq` ⇒ `S` 不变；乱序到达不改变状态。
3. **seq 跳号**：`f.seq = S.seq + 2` ⇒ **照常应用并把水位推到 `S.seq+2`**（唯一响应就是这一条）；
   随后到达的 `seq = S.seq+1` 被丢弃（幂等）。**不发起任何恢复请求**。
8. **迭代不完整**：`done(iter = last+3)` ⇒ 触发 `pullIter(turn, last+1 … last+2)`；`ABSENT` 即合法跳号。
4. **单调追加**：任意帧序列后 `blocks` 的 `iter` **严格递增**（T5a）。
5. **单 live**：`live ≠ ⊥ ⇒ live.iter > 已提交最大号`（T5b）。
6. **`done` 提升工具**：`done` 后同一 `call` 不在 `live.tools` 中（T3）。
7. **`final` 替换**：`final.blocks` 覆盖本地块列表，不合并（T4）。

### 9.2 属性测试（随机帧序列，`model_property.test.ts`）

随机生成 `open/tick/done/final/session` 序列（含随机重复、乱序、丢帧），断言 **T3 + T5** 恒成立；
并对每次投影统计"每个 `call` 的出现次数 = 1"。**判别力来源**：把 `tick` 的"覆盖"改成"并集" ⇒ 立即红。

### 9.3 差分回放（T8 的机器判定，`model_equiv.test.ts`）

输入：`tools/tests/replay/*.jsonl`（真实 SSE 录制，含"纯工具迭代""同号双块""迟到 idle""切会话"现场）。
输出：两套实现的规范化行快照，**逐字段**比较。任何不一致 = 红灯，并打印首个差异路径。

### 9.4 Mutation 自证清单（每条必须"注入 ⇒ 红，撤销 ⇒ 绿"）

| # | 注入 | 应红判据 |
|---|---|---|
| M1 | 删掉 `seq` 守卫 | 9.1.2 |
| M2 | `done` 后不清理 `live` | 9.1.6 / 9.2（工具出现两次） |
| M3 | `tick` 从"覆盖"改成"并集" | 9.2 |
| M4 | `done` 丢掉"`iter > last`"前置校验（改成无条件追加） | 9.1.4 |
| M5 | `project` 去掉 `WeakMap` 恒等 memo | 9.5（每帧分配/转换数超标） |
| M6 | 把"空 turn 不产行"改成"总是产行" | 9.3（幽灵行） |

### 9.5 性能判据（`model_perf.test.ts`）

- 1 000 个已完成迭代 + 100 次 `tick` ⇒ 断言：`project` 的**新建对象数 = 100**（每帧 1 个 `LiveBlock`
  + 其工具数组），**转换块数 = 0**（历史块零重建）。
- 断言单帧 `step + project` 时间上界（基线机器上 < 0.1 ms/帧，取中位数，跑 1 000 次取 median）。
- 断言**没有** O(N) 循环：以"调用计数"代理（`project` 对历史块的回调次数 = 0）。

### 9.6 门禁新增两条

| 门禁 | 判据 |
|---|---|
| `tools/lint/state-single-writer.sh`（已有，**扩展**） | `core/**` 里能构造/改写 `ChatState`（现 `State`）的**只有** `model/step.ts` 与 `snapshot`；其它文件出现 `state.turns =` / `{...s, ` 之类即红 |
| 新增 lint 判据（W3 落地） | 禁止对 `content`/`reasoning`/`detail`/`output`/`label`/`summary` 使用 `===`/`!==`/`.length ===`/`localeCompare` 作为**判等**（`grep -o` 只取调用片段；零扫描判红；mutation 自证） |

---

## 10. 边界、风险与"银弹"的诚实回答

### 10.1 有没有银弹？

**没有"一行修好"的银弹，但有教科书级的唯一正解**——它由三条互相独立的性质组成，加起来不到 10 行守卫：

1. **每帧是"位置状态"而不是"增量"** ⇒ 重复/乱序**天然幂等**（不需要"精确一次"）。
2. **会话级单调 `seq`** ⇒ 丢包被**检测**出来（不需要猜、不需要轮询、不需要 15s 窗）。
3. **权威快照重取**（带 `seq`）⇒ 丢包的**修复**只有一条路（不需要任何本地重建）。

现状之所以"感觉极难"，是因为它同时是**(1) 的反面**：`iterationsDelta`（增量）+ `iterations`（快照）、
`active_tools`（增量）+ `completed_tools`（快照）**混在一帧里** ⇒ 客户端必须"猜合并" ⇒ 于是需要 20+ 条
互相兜底的判据。**把帧统一成位置状态之后，"一致性"就不再是难点，而是副产品。**

三条性质各自的代价：

| 性质 | 代价 | 备注 |
|---|---|---|
| 位置状态 | 带宽略增（每帧带当前迭代的完整工具集；每迭代 ≤ 数十字节 × 工具数） | 未压缩 SSE 下实测占比可忽略 |
| 单调 `seq` | 服务端每会话一个计数器 + 每帧盖章 | 约 10 行 Go |
| 快照带 `seq` | 一个 REST 字段 + 一次"读时取 seq"的临界区 | 需与发帧共用同一把锁（否则快照与流不对齐） |

**唯一无法被"银弹"消掉的东西**：服务端必须**真的**每迭代发一条完备的 `done`、每个 turn 发一条 `final`。
这是协议义务（P4），客户端无法替代——任何客户端替代方案（现状的"空壳顶位""live 折进块""三空特例"）
都是**这条义务缺失**的补丁。把义务补上，补丁全部消失。

### 10.2 前提不成立时的行为（不兜底，但也不能打爆服务器）

- **行为**：缺迭代 ⇒ `pullIter`；缺收尾 ⇒ `pullTurn`；整体不可信 ⇒ `snapshot`。
  若服务端**持续**违反前提（例如永远不发 `done`），恢复请求会被"同一事实只请求一次"的幂等去重挡住 ⇒
  界面停在"部分内容"，**缺陷显性化**（现状是"悄悄画错"，更难查）。
- **唯一抑制**：对**同一个触发**（`(chat, gen, turn, iter)`）只发**一次**恢复请求——这是
  "同一事实只请求一次"的**幂等去重**，不是时间退避，也不是兜底。
- **并发陷阱（盲审）**：绝不把"读快照"放进全局锁。现有 `web_hub.go:27 seqMu` 是全局单锁，且
  `:192-195` 明写"prepare 不得获取应用锁"⇒ 快照端点用**两阶段**（锁外读快照 + per-chat 锁内取 seq + 版本校验）。
- **后端发包义务与 CI 判据**：见 **§14**（契约 C-1…C-14 / 判据 G-1…G-11）。

### 10.3 已知边界（模型不管、但必须保留的东西）

| 边界 | 归属 |
|---|---|
| 长 turn 的区域窗口（`regionsBefore` / `POST /api/regions`） | 数据字段 + 视图，与模型正交 |
| 命令（`!cmd`/slash）无 turn 的实时输出 | `standalone` 单列（§6 第 12 项） |
| 通知 turn / 子代理进度 / 队列 | `open` 的载荷、`LiveIter.subAgents`、`sess.queue` |
| 多会话 | 每个 `chat` 一个 `S`（互不相见）；`gen` 标识本机代数 |
| 多端同时观看 | 各自独立 `S`（只读同一流） |
| 主题/字号/语言/动画/滚动 | UI 层（R-UI1..3） |
| 历史分页与 DB 顺序（legacy 段） | `snapshot` 的一个字段 |

**待裁决（盲审 B-10）**：`channel/region_view.go:124-160 RegionRuns` 会把**连续纯工具迭代吸收成一个区域**；
而本模型要求"`blocks` = 每迭代一块"。两者是**两套块定义**，必须明确规定：

- `blocks`（状态机/渲染块）= **迭代粒度**（与 DB 的 `iteration_history` 行一一对应，P4）；
- region（区域窗口）= **取回与计数单位**（`regionsBefore` / `POST /api/regions`），**不得**改变块粒度。
- ⇒ 若服务端某个历史路径曾把多次迭代写成一条 history 行，必须停止（P4 要求每迭代一条）。
  这不改变用户可见内容（渲染块仍按迭代号分隔），只改变"更早窗口"的边界计算。

### 10.4 本文档**不**声称的东西

- 不声称"移植现有代码即可零风险"：这是一次**替换**（`reduce` + `render` + `derive` 三件套换成
  `step` + `project`），因此必须有 W0 的差分基线与 W1–W3 的双跑。
- 不声称后端改动"很小"：P3/P4 是**发帧语义**的改动（工具数组归一、每迭代 `done`、正文按迭代重置），
  影响 `agent/engine_wire.go`、`engine_run.go`、`channel/web/web_sse.go` 三处主干。但它同时删掉了
  服务端为"前端能过滤"而做的多重盖章与残留下发（`engine_run_tools.go` 的整批 pending、`engine_wire.go`
  的 2436-2445 注释所描述的负担）。
- 不声称"没有回归"：零差异是靠 **28 条可观察行为 + 差分回放 + mutation + 性能判据** 一起守住的，
  不是靠"结构上等价"这句话。

---

## 11. 边界矩阵（"考虑一切情况"）

> 每行都必须有**检测手段**与**修复手段**，缺一不可；没有"未定义行为"。

### A. 传输层

| # | 情况 | 检测 | 修复 | 本地重建 |
|---|---|---|---|---|
| A1 | **`seq` 跳号**（任意原因） | `f.seq > last + 1` | **以最大为准**：`S.seq := f.seq`，本帧照常应用；**不重放、不补帧、不重同步** | — |
| A2 | 被跳过的号**后到**了 | `f.seq ≤ last` | **丢弃**（位置状态：新帧已包含其结果） | — |
| A3 | **迭代最后一帧丢**（唯一完整副本 = `done`） | 下一帧带 `iter > blocks.last + 1`（无论 tick 还是 done）；或 `final` 缺块 | `pullIter(turn, last+1 …)` 取权威块 | ❌ 无 |
| A4 | 回合收尾帧丢（`final`） | `session{running=false}` 且该 turn `final = ⊥`；或出现下一 turn 的 `open` | `pullTurn(turn)` | ❌ 无 |
| A5 | 重复帧 | `seq ≤ last` | 丢弃 | — |
| A6 | 乱序 | 服务端**单写者串行盖章**（per-chat 锁）⇒ 线上不会乱序；客户端仍以 `seq` 为准 | 迟到者按 A2 丢弃 | — |
| A7 | 断线 / 切后台 / 半开连接 | 连接状态；重连后 **`seq` 无法续** | `snapshot(chat)`（整体权威；不依赖帧日志） | ❌ |
| A8 | 服务端重启（seq 归零） | `epoch` 变化 | `snapshot`；**服务端启动时对所有"未收尾"的 turn 补发 `final(cancelled, recovered=true)`** | ❌ |
| A9 | 服务端崩溃时正在跑的 turn（客户端手里有 live） | epoch 变化 / 重连 | 同上 ⇒ 界面从"进行中"转"已中断"，**不会永久转圈** | ❌ |
| A10 | 多路并发推帧（主 agent / 子代理 / 通知 / 队列） | — | 全部经同一把 per-chat 锁 + 同一计数器 | — |
| A11 | 代理/CDN 批量延迟到达 | 客户端只看 `seq` 单调性（**延迟 ≠ 丢失**） | 无需动作 | — |
| A12 | 未知帧类型（协议演进） | type 不认识 | 推进 `seq` + 忽略载荷 + 记日志（前向兼容，不是兜底） | — |
| A13 | 服务端"同键帧合并"导致序号不稠密 | 已不再需要"稠密"这个性质（A1 以最大为准） | **无需修复**；但合并**仍必须在盖章前**完成（否则客户端会看到序号回退，见 §14 契约 C-2） | — |

### B. 回合 / 迭代

| # | 情况 | 处理 |
|---|---|---|
| B1 | **迭代号跳号**（resume 续号 `engine.go:708-712`、触顶早退） | 客户端**不假设**它合法：任何 `iter > last+1` 都先 `pullIter` 逐个补齐；权威回答 `ABSENT` ⇒ 该号确实不存在（合法跳号）⇒ 接受并前移。**绝不用号差直接判"丢包"或"合法"** |
| B2 | 取消（用户 stop）：进行中的迭代没有完成态 | P4：取消也发 `done`（partial），随后 `final(cancelled)` |
| B3 | 取消后立刻发新消息 | 顺序保证：`final(旧)` 必在 `open(新)` 之前（同一 seq 流，单写者） |
| B4 | 空回合（无任何输出） | `final` 必发；**投影**过滤空 assistant 行（§3.6） |
| B5 | 通知回合（后台任务完成） | 调度层确实串行（`agent.go:3353-3363` busy 不 drain；`:3757-3762` 收尾后才 drain），**但帧序不保证**：`text`→`final` 走**异步 bus**（`agent.go:4852`/`:4937`）而 `open` 直发 ⇒ `open` 可能先到。⇒ 由 **F-1 的 `open` 幂等**吸收（不清 blocks），客户端**不需要**"帧序串行"这个假设 |
| B6 | 子代理并发进度 | 属于当前回合的 `subAgents` 字段（同一 seq 流） |
| B7 | `WaitingUser`（ask_user 暂停） | **不发 idle**（现状正确）；回合保持 live，客户端显示等待态 |
| B8 | 旧迭代的迟到 `tick` | `f.iter < live.iter` ⇒ 丢弃（纯整数） |
| B9 | 同一回合内多个迭代的正文交错 | `tick` 带 `iter`，不同 `iter` 的正文互不干扰（每迭代独立的 chunk 序列） |
| B10 | 一个工具在"生成态"就已完成（极快工具） | 直接以 `done` 出现；`done` 必须带 meta（"首次出现即带全"） |
| B11 | 工具在 `tick` 与 `done` 之间切换 | `state` 覆盖；`meta` 沿用 |
| B12 | 迭代内工具集合**变少**（服务端移出某工具） | 位置状态：数组即全集 ⇒ 变少即消失（服务端只在"该工具被撤销"时这么做） |
| B13 | 超大工具参数（KB 级 args / detail） | meta 只发一次；快照发全量（一次性） |
| B14 | 发送失败（HTTP/WS 写失败） | 本机意图 `fail` ⇒ **整行移除**（与现状 `user_fail` 删行一致）；**不重试、不超时**（重试由用户决定） |
| B15 | 服务端排队（staging tray）后消息被丢弃 | `session{queue}` 全量替换 ⇒ 该行从队列消失；`local.pending` 以 `turnHint/requestID` 精确退役（不做内容匹配） |
| B17 | **工具在 generating 期陆续出现、参数慢慢增长**（用户点名） | 位置状态：`tools[]` 每帧是**全集** ⇒ 数组变长是正常的（不是缺口）；`label`/`genChars` 每帧覆盖（看起来就是"边生成边长"）；`call_id` 在首次出现前已分配且终身不变（P3′）；`meta.args` 在参数生成完成后一次性给出 |
| B18 | **迭代前进了，但上一迭代还不完整**（用户点名） | ⛔ **不许 commit**：`tick/done` 的 `iter > blocks.last + 1` ⇒ `pullIter(turn, last+1 … iter-1)` 拉权威；权威 `ABSENT` 才算合法跳号。期间**不应用**该帧（下一帧会带回最新位置状态） |

### C. 会话级

| # | 情况 | 处理 |
|---|---|---|
| C1 | 迟到的旧轮 `idle` | 服务端 `runGen` 守卫（`emitSessionIdleIfCurrent`，已修）；客户端**不因 idle 改回合相位** |
| C2 | 多会话切换 | `(chat, gen)` 守卫；每 chat 一个 `S` |
| C3 | 多端同时观看 | 各自独立 `S` |
| C4 | 队列（staging tray）增加/删除/重排 | `session{queue}` 全量替换（`items` 恒出现） |
| C5 | goal 清除 | `goal: null`（P5；删掉 `{status:"cleared"}` 墓碑） |
| C6 | todos 清空 | `todos: []`（是值） |
| C7 | 历史窗口（长回合）/ 区域取回 | `regionsBefore` + `POST /api/regions`（与模型正交） |
| C8 | 会话删除/重命名 | `session` 帧的非回合动作（`SessionEvent.Action`） |
| C9 | 历史分页到底 / 顶部加载 | `snapshot` 的窗口参数（`droppedBefore`） |

### D. 客户端

| # | 情况 | 处理 |
|---|---|---|
| D1 | 滚动/触摸期 | 挂起**投递**（`listfollow`），状态机照常（R-UI3） |
| D2 | 内存：2 000 迭代的会话 | `blocks` 只存状态机结构（指针 + 小对象）；渲染窗口由 `rowLimit` 控制（现状已有） |
| D3 | 主题/字号/语言/徽标切换 | 组件自订阅（R-UI1） |
| D4 | 401 / 鉴权过期 | **所有写者停止**（唯一写者 ⇒ 一处停即全停） |
| D5 | 客户端进程重启 | snapshot 重建（可选：持久化 `(epoch, seq, chat)` 用于续传） |
| D6 | 超长正文（MB 级） | chunk 增量 + markdown 分块缓存（现状机制） |
| D7 | 时区/相对时间 | UI 层（与模型正交） |

### E. 协议演进

| # | 情况 | 处理 |
|---|---|---|
| E1 | 新帧类型 | 见 A12 |
| E2 | 字段新增 | 缺字段 = 未携带（P5） |
| E3 | 协议版本不匹配 | `snapshot` 返回 `protocolVersion`；不匹配 ⇒ **显式报错**（不降级） |

---

## 12. 带宽模型

**目标**：每帧字节数与"当前内容总长"**无关**；静默期 ~O(1)/15s。

| # | 措施 | 效果 |
|---|---|---|
| W1 | 正文/思考走**增量 + 整数锚** `{base, chunk}` | 每帧 O(新增字节)；100 帧共 1 400 字的思考 ≈ **1.4 KB** 而非 140 KB（100×） |
| W2 | 工具 **meta 只发一次**（`name`/`ui*`/`toolHints` + 参数生成完成后一次性的 `args`/`detail`/`summary`），每帧只发 `state`（`status`/`label`/`genChars`/`elapsedMs`） | 工具体从"每帧 ~200–2 000 B × 工具数"降到"首次一次 + 每帧 ~40–120 B × 工具数"（`label` 会随参数增长，但它是**短截断**，远小于 `args`） |
| W3 | `session` 帧**只在字段变化时**发（字段级 LWW，服务端合并） | todos/goal/queue 抖动不再产生帧 |
| W4 | 服务端可**任意合并/节流 `tick`**（位置状态 ⇒ 合并语义无损）；建议 30–60 ms 合并窗 | token 速率高时限流，正确性不受影响 |
| W5 | 快照只发**窗口 + 计数**（`droppedBefore`/`regionsBefore`），不发全历史 | 2 000 迭代的会话也能秒开 |
| W6 | keepalive 只发 `{epoch, seq}`（~20 B / 15 s） | 静默期成本可忽略 |
| W7 | 禁止在同一帧里重复大字段（`args`/`detail` 只随 meta 或快照） | 消除 O(帧数) 的重复放大 |

**典型量级对比**（1400 字思考、8 枚工具、100 帧）：

| 项 | 现状（全量文本 + 三数组 + 大字段重复） | 新模型 |
|---|---|---|
| 正文/思考 | ≈ 140 KB（每帧全文） | ≈ 1.4 KB + 100×16 B 锚 |
| 工具 | ≈ 100 × Σ(meta ≈ 数百 B) ⇒ 数百 KB | ≈ 8 × meta（一次性）+ 100 × 8 × 40 B ≈ 32 KB |
| 合计 | 数百 KB 量级 | **≈ 35 KB 量级**（收敛到 O(内容) + O(状态变化)） |

**代价与边界**：增量文本的**安全**依赖"同一迭代的 chunk 序列不乱序"（C-9：`base` 必须接上）——
服务端按 per-chat 顺序发帧即天然成立；若某帧丢失，`base` 对不上 ⇒ **DROP 该帧**（不清空、不拼接），
该迭代的**权威内容**在 `done` 或 `pullIter` 里（一次性的 O(len)）。
⇒ 直播期最多"打字机少跳一格"，提交后一定完整。

---

## 13. 盲审记录（谁审的、发现了什么、文档怎么改的）

> 两份独立盲审（后端可行性 / 前端语义与性能）对本文档逐条核对代码后提出裁决。**下列修正已落进正文**；
> 未采纳项写明理由。

### 13.1 后端可行性盲审（已全部采纳）

| # | 发现 | 处置（正文位置） |
|---|---|---|
| B-1 | P1 点错了盖章位置：盖章在 Hub（`web_hub.go:305-313`），写字节在 `web_sse.go:604-679`；"心跳快照 Seq=0"**不成立**（`sendHeartbeatLive` 会盖章），真正无 seq 的是 `writeSSEHeartbeat`（`:728-742`）与 `writeSSEResyncRequired` 的 payload（`:786-795`） | §2 P1 全部重写；§2.1 行内改正 |
| B-2 | `engine_wire.go:2309-2312 withLiveStats`、`:2079-2086` checkpoint、`:1984-1989` 的 `s.Seq` **都不盖章** ⇒ "每帧盖章"的改动面比文档说的大 | §2.1「每帧盖章」行补全 |
| B-3 | `seq` 是 **per-route**（`web_eventstream.go:21-26`），同一 chat 可挂两条 route（`web.go:656-665`）⇒ 必须改成 **per-chat 单计数器** | §2 P1 + §2.1 |
| B-4 | stateless 帧的 later-wins 合并会删掉**已编号**的帧（`web_eventstream.go:114-127`、`:143-152`）⇒ `replayAfter` 的 suffix 天然有洞 ⇒ 弱网"重连—重同步"抖动 | §2 P1 规则"合并只在盖章前"；§11 A14；§10.2 第 4 条 CI 判据 |
| B-5 | **"正文按迭代重置"已经做到**（`engine_run.go:580-589`）；真正的跨迭代残留来自 `agent/stream_state.go:37-61 mergeStreamState` + `Iteration:0` 帧 | §2.1「正文/思考增量」行改正 |
| B-6 | P4 缺口的**准确位置**是取消路径三处：`engine_run.go:1001-1008`、`agent_process.go:443-554`、`engine_run_tools.go:518-532`（`snap.Tools` 只取 `CompletedTools`） | §2.1「`done` 独立成帧」行重写；§8「硬前置」第 1 条 |
| B-7 | `todos` **没有** `omitempty`（`events.go:132`）；`goal` 是 `*GoalInfo,omitempty` ⇒ `null` 发不出去（只能靠墓碑） | §2 P5 改正并列出 8 个 tag |
| B-8 | `/api/session-state` **不存在**；现有全局 `seqMu`（`web_hub.go:27`）若包住 DB 读会**全服帧串行**（`web_hub.go:192-195` 明写禁令） | §2.1「快照端点」行改为**两阶段读取 + per-chat 锁**；§10.2 并发陷阱 |
| B-9 | `streaming_tools` 的条目**没有 `call_id`**（`engine_wire.go:2432-2445`）⇒ 只做数组归一会让"同名工具误杀"复发 | §2 P2 已要求"生成态即分配 id"；§8「硬前置」第 3 条要求**同批上线** |
| B-10 | **区域粒度 vs 迭代粒度**：`channel/region_view.go:124-160 RegionRuns` 会把连续纯工具迭代**吸收成一个区域**；若 `blocks` 按"每迭代一块"发送，则"一块一迭代"与区域窗口是两套块定义 | §10.3 新增「待裁决」条目：`blocks` = **迭代**粒度（DB 记录粒度）；region 只是"更早窗口"的计数与取回单位。若某个历史路径曾把多次迭代写成一条 history 行，必须停止（P4 要求每迭代一条记录） |

### 13.2 前端语义盲审（发现 5 个 P0，已全部改进正文）

> 诚实记录：这一轮盲审**推翻了本文档初稿的若干断言**（尤其 T3 的覆盖面与"每帧 O(1)"）。

| # | 发现（反例） | 处置 |
|---|---|---|
| F-1 | **`open` 无条件清 `blocks`**：后端 resume 会**复用 turn id**（`agent.go:3481-3485` + `:3328`），且 text→final 走**异步 bus**（`agent.go:4852/4937`）而 `open` 直发 ⇒ `open` 可能早于上轮 `final`、旧 turn 的块被清 ⇒ 工具/正文渲染 0 次 | §3.4 `open` 改为**幂等**（已存在 turn 只绑 user、保留 blocks/final/phase）；§11 B16 统一；§8 硬前置补"禁止 resume 复用 id 或建模为续同 turn" |
| F-2 | **`final` 无条件清 `live`**：取消路径不写迭代记录（`engine_run.go:1001-1008`、`agent_process.go:443-554`、`engine_run_tools.go:518-532`）⇒ 被取消的迭代既不在 blocks 也不在 live ⇒ **静默丢内容**（且 seq 连续，不会触发 RECOVER，与"缺陷显性化"相反） | §3.4 `final` 增加完备性断言 + "`final` 必须带 `blocks`"的兜底路径（**协议义务**，不是客户端补丁）；`Tool.status` 增 `failed`；§6 增第 31 行 |
| F-3 | **`tick` 缺"已提交号"守卫**：转移表只与 `live.iter` 比，而 T5 文字要求与 `blocks.last` 比 —— 文档自相矛盾；现实里"delta 已 append 刚完成迭代、`ev.iter` 还停在 N"是**常态**（`reduce.ts:1216-1245`） | §3.4 `tick` 首行加 `f.iter ≤ blocks.last ⇒ DROP`（**丢弃、不 recover**）；T3 措辞改为"`done` 的 `f.block` 完备"（转移表从不迁移 `live.tools`） |
| F-4 | **迭代间隙的可见信号消失**：`live = ⊥` 时 phase/思考/压缩/上下文环/吞吐没有承载处（现状都在 live 上）；且"inflight 无判定"会造出空块 | §3.2 把 `phase/streaming/streamStats/tokenUsage` 提升为**回合级**（`TurnRec`）；§3.6 明确 `live = ⊥ ⇒ inflight = ⊥`；§6 增第 32 行 |
| F-5 | **快照不自洽无处理**：快照由内存态 + DB 拼出（`agent_backend_methods.go:181-232` vs `engine_run_tools.go:527-537`），窗口里可能读到 `live.iter ≤ last` 或中间缺块 | §3.5 增"快照自洽归一"（`≤ last ⇒ 丢 live`；`> last+1 ⇒ RECOVER`）+ 后端 CI"快照自洽"断言 |

P1 级（性能与零差异表）也全部采纳：
- `project` **不是** O(1)/帧（组装 `Row[]` 必然 O(T)）⇒ §7.1 改为"O(T) 指针 + O(1) 行内容"，
  并写明 `done` 的 `new Map(prev)` 是 O(T_turns + D)/迭代。
- **memo 键必须含 `live`**（流式期 `TurnRec` 不变）⇒ §7.1 补充；`todos/goal/queue` **不进行**（§3.6/§3.7）。
- `@Observed` 就地写若每帧重写 `blocks` 会 O(D) ⇒ §3.7 明确"blocks 与 inflight 分 holder，只写引用变化的字段"。
- §6 补齐 8 条缺失的可观察行为（compactions / genui / 每迭代 subAgents / staging tray /
  失败行语义 / AskUser×busy / legacy 截断 / 命令与排队的 `ack`）。
- 意图集补 **`ack{delivered|queued|command}`**：命令（不走 `processMessage`、无 `turn_started`）与排队消息
  永远不会 `open` ⇒ 缺 `ack` 会让乐观行永久"发送中"。
- ArkTS 硬约束：`core/*.ts` **不得 import `.ets`**（10605999）、`.ets` 禁 spread ⇒ 模型必须落在
  **`core/model/*.ts` 且类型自持**（§3.2 的类型定义就是 `.ts` 形状）。

### 13.3 W0 的阻塞项（升级：未确认项必须先取证）

| 项 | 为什么阻塞 | 取证方式 |
|---|---|---|
| web 端是否依赖"迭代边界 `content` 非空" | 决定 §12 的增量正文能否与现状同语义（若 web 依赖"上一迭代尾巴还在 content 里"，则增量必须带上一迭代的尾部） | 一份真 SSE 录制（含迭代推进边界），看边界帧的 `progress.content` |
| `writeSSEEvent*` 是否严格单 goroutine | 决定 P1 的"每帧盖章"是否需要额外加锁；否则 `client.lastSentSeq` 有数据竞争 | `grep` 全部调用点 + 一次 race 测试 |
| `ProgressEvent.Seq` 是否被复制进 `iteration_history`（`events.go:162`） | 若被复制，历史里的 seq 是**旧值**，客户端若拿它当水位会倒流 | 一次录制：看 `iteration_history[].seq` 与顶层 `id:` 的关系 |

### 13.4 用户口径修订（2026-10-21 20:0x，四次追加）

> 这一轮是**产品口径**，优先于前两轮盲审：模型的"检测丢包"方式被推翻，改为**以最大 seq 为准 + 按对象拉权威**。

| # | 用户要求 | 已落进正文 |
|---|---|---|
| U-1 | **工具在 generating 期会慢慢增加**（参数逐步生成、label 也随之变长） | §2 P3′、§3.2 `Tool`（`label` 归 state）、§3.3 `ToolTick`、§11 B17、§12 W2 |
| U-2 | **绝不能 commit 不完整的迭代**：发现迭代进步但上一迭代不完整 ⇒ **用拉 gap 的接口拉上一迭代权威内容** | §3.4 `tick`/`done` 的 `iter > last+1 ⇒ PULL`；§3.5 `pullIter`（`ABSENT` 才算合法跳号）；§11 B18、B1 |
| U-3 | **SSE 跳号以最大为准**，之后遇到被跳的号**直接丢弃** | §3.4 前置（`seq > last+1 ⇒ 照常应用 + 推进水位`；`seq ≤ last ⇒ 丢弃`）；§11 A1/A2；**删除整条 `replay(since)` 帧重放路径**（§3.5 重写） |
| U-4 | **系统强依赖后端正确性**：要保证后端不会乱发包导致闪烁 | 新增 **§14 后端发包契约 + 客户端防闪烁结构 + CI 判据** |

⚠️ 由此产生的**简化**（比之前更少的概念）：
- 不再需要"每会话帧环形日志"与 `GET /api/frames?since=` 重放（少一个组件、少一组 CI 判据）。
- 不再需要"`seq` 必须稠密"这个性质 ⇒ 合并/节流的位置约束降级为"不许序号回退"。
- `RECOVER` 这个笼统出口被拆成三个**按对象**的权威读取（`pullIter` / `pullTurn` / `snapshot`），
  每个都只说"取哪个对象"，不说"怎么补"。

---

## 14. 后端发包契约（防闪烁）与 CI 判据

> **前提**：本模型的正确性与"不闪烁"完全依赖服务端**只发合法帧**。
> 本节把这些义务写成**可执行判据**（后端 CI + review checklist），客户端**不为违例做补偿**。

### 14.1 契约条目（每条都对应一种"会闪烁/会丢内容"的违例）

| # | 契约 | 违例后果 |
|---|---|---|
| **C-1** | 每 chat **单写者、单计数器**：`seq` 严格 +1，**不许回退/重号**（同一 chat 挂在多条 route/连接上也共用一个计数器） | 序号回退 ⇒ 客户端把新状态当"迟到帧"丢弃 ⇒ 界面停在旧状态 |
| **C-2** | 帧的**合并/节流只允许发生在盖章之前**（合并后的帧才拿 seq） | 盖章后被合并丢弃 ⇒ 序号出现"合法空洞"（客户端容忍，但历史回放类工具会误判） |
| **C-3** | 每帧必带 `(epoch, seq, chat)`；**回合级帧必带 `turn`**；**迭代级帧必带 `iter`** | 缺字段 ⇒ 帧无法归属（模型里不可表示） |
| **C-4** | 同一 turn 内 `iter` **严格递增**；**不许改小、不许复用**；跳号只允许由 resume 造成，并会被 `pullIter` 的 `ABSENT` 确认 | 改小 ⇒ 被当迟到帧丢弃；复用 ⇒ 两段内容混进同一块 |
| **C-5** | `turn` 每 chat 单调 +1、**永不复用**（resume 要么"续同 turn 且不发 `open`"，要么分配**新** turn） | 复用 ⇒ `open` 幂等会把两次运行混成一个回合（历史内容被覆盖） |
| **C-6** | **每个已开始的迭代恰好一条完备 `done`**（含取消/失败/触顶）；`done.block.tools` 必须含该迭代**全部**工具 —— 被中断的 `running` 一律落成 `failed` | 缺 `done` ⇒ 客户端按 U-2 去拉权威（多一次 RTT）；`block` 不完整 ⇒ 工具在提交瞬间"消失" |
| **C-7** | **每个 turn 恰好一条 `final`**（含空 turn、取消、被重启回收的 turn），且 `final.blocks`（若携带）覆盖**全部**已开始迭代 | 缺 `final` ⇒ 回合永远"进行中"（转圈） |
| **C-8** | `tick.tools` 是该迭代当前工具的**全集**：`call_id` 从**首次出现前**分配、**终身不变**；同帧不重复；工具只增不减（除非明确撤销）；`status` **只前进**（generating→pending→running→done/failed），**不许倒退** | 换 id ⇒ pill 重建（闪烁）；status 倒退 ⇒ "执行中"变回"排队"（用户已报过的形态） |
| **C-9** | `tick.content/reasoning` 是**本迭代内**的增量 `{base, chunk}`：`base` 必须等于该迭代已推送的长度；**不许回退、不许重发同一段、不许把上一迭代的尾巴塞进新迭代** | `base` 不匹配 ⇒ 客户端 DROP 该帧 ⇒ 打字机卡一下；回带 ⇒ 同一段文字出现两次 |
| **C-10** | **不许把已 `done` 的迭代内容再作为 `tick` 发回**（"回带"是历史闪烁的根源） | 同一内容"提交块一次 + 在飞块一次" |
| **C-11** | 会话级帧**只在字段变化时**发；`goal` 清除用 `null`；`todos: []` 是**值**；`queue.items` 恒出现 | 反复发同一值 ⇒ 客户端无谓重建；三态混淆 ⇒ 状态错 |
| **C-12** | 快照**自洽**（`live.iter > blocks.last.iter`），并与发帧**共用 per-chat 临界区**（两阶段读 + 版本校验，**不得**用全局锁包 DB 读） | 同号块双画 / 全服帧被一次 DB 查询阻塞 |
| **C-13** | 服务端重启：`epoch + 1`，并对所有"未收尾"turn 补 `final(cancelled, recovered=true)` | 客户端永久转圈或误判"全是过期帧" |
| **C-14** | **不许交错两个 turn 的帧**（同一 chat 内按 turn 串行）。通知 turn 的 `open` 必须在该 chat 上一条 `final` **之后**入队（或干脆由 `open` 幂等吸收，见 §3.4） | 两个回合的行交错 ⇒ 内容串台 |

### 14.2 客户端侧的防闪烁结构（结构上不可能闪，而不是"闪了再修"）

| # | 规则 | 作用 |
|---|---|---|
| A-1 | `done` 应用时，**同一次 `step`** 内完成"追加块 + 清同号 live" ⇒ 投影看到的是一次原子替换 | 不会出现"先消失、再出现" |
| A-2 | `blocks` 与 `inflight` **分 holder**，但 UI **同一批** apply（同一次 `applyRows`） | 不会出现中间帧"既无块也无在飞" |
| A-3 | 内容只增长（`{base, chunk}` 校验），不匹配即 DROP（**不清空、不拼接**） | 不会闪白/回退 |
| A-4 | 已渲染块按**源对象恒等**复用（`rev` 不变 ⇒ 不重建） | 历史块零重建（性能 + 视觉稳定） |
| A-5 | 工具行按 `call_id` 做稳定 key；`label`/`genChars` 变化只更新**文本字段**，不重建 pill | 参数增长时"边生成边长"，不是"重画一个新 pill" |
| A-6 | 会话级字段（todos/goal/queue）与会话级指示（busy/phase/上下文环）走**独立 holder**，不进消息行 | 改 todo / 切 phase 不触发消息行重建 |
| A-7 | 主题/字号/语言/徽标由组件自订阅（R-UI1） | 非内容变化不重建行 |

### 14.3 后端 CI 判据（可执行，任一红 ⇒ 不允许合并）

| # | 判据 | 对应契约 |
|---|---|---|
| G-1 | 同一 chat 的帧流：`seq` 严格 +1、无重号；跨 route/连接共享计数器（构造"两条 route 同时订阅"的用例） | C-1 |
| G-2 | 合并/节流之后才盖章（断言"盖章后的帧不消失"；或至少在客户端视角"无序号回退"） | C-2 |
| G-3 | 枚举**所有**退出路径（正常/取消/触顶/panic/重启），断言"每个已开始迭代恰好一条 `done`" | C-6 |
| G-4 | 断言"每个 turn 恰好一条 `final`"，含空 turn 与取消 | C-7 |
| G-5 | `done.block.tools` 的 `call_id` 集合 = 该迭代出现过的 `call_id` 集合；取消时 `running ⇒ failed` | C-6 |
| G-6 | 同一 `call_id` 在连续帧中不变；`status` 序列**单调**（生成一条合法序列白名单，非白名单即红） | C-8 |
| G-7 | `tick.content.base` == 该迭代已推送长度（服务端自检）；每迭代第一次 `base = 0` | C-9 |
| G-8 | `tick.iter` 不得 `≤` 该 turn 已 `done` 的最大号（禁止回带） | C-10 |
| G-9 | 并发测试：一边推帧一边取快照（1 000 次），断言快照自洽 + 无死锁 + 延迟上界 | C-12 |
| G-10 | 重启测试：`epoch` 变化 + 未收尾 turn 收到 `final(recovered)` | C-13 |
| G-11 | 交错测试：通知 turn 与主 turn 并发触发，断言帧不交错 | C-14 |

### 14.4 契约违例时客户端做什么（唯一出口，不是兜底）

- **能定位到对象**（缺迭代 / 缺收尾）⇒ `pullIter` / `pullTurn`（读权威）。
- **定位不到**（epoch 变化、快照自洽被破坏）⇒ `snapshot`。
- **其余一律 DROP**（迟到帧、`base` 不匹配、`iter ≤ last`）——**不修补、不猜测、不重试**。
- ⇒ 违例的表现是"多一次 RTT 或一次快照"，而不是"屏幕上的错误内容"。**缺陷显性化**在 CI（G-1…G-11），
  不留给用户。

---

## 15. 落地状态（2026-10-22，分支 `feat/state-model-refactor`）

### 已完成并验证

| 层 | 内容 | 判据 |
|---|---|---|
| 后端 | `feat/state-model-refactor` → **PR #452** → `feat/court-orchestration`：per-chat `(epoch,seq)`、`tools[]` 单数组（生成态即分配 `call_id`）、每迭代一条完备 `done`（含取消）、每 turn 一条 `final`、三个拉权威端点、严格 dual-write | `go test ./agent ./channel/web ./protocol ./serverapp` 全绿 |
| 前端模型 | `model_types / model_step / model_project / model_adapter / model_hydrate` | `model_step 40` / `model_hydrate 15` / `model_row_equiv 7` / `model_diff_prop`（60 随机会话，0 差异） |
| 影子引擎 | `store` 在**单条 `pushEvent` 与批量 `pushEvents`** 两条入口都喂 `adapt → stepAll`（`history_replaced` 走 `hydrate`），只读 + 行级对照 `[MODEL-ROWDIFF]` | `assembleHap` BUILD SUCCESSFUL；装机 pid 2320 |
| ArkTS 桥接 | `model_bridge.ets`（`applyModel`），补了回合级 `content`、`compactions` 映射、在飞块拼接 | 编译通过 |

### 已知阻塞（W2 未落地）

`rebuildRows` 行源切换（`deriveRows+applyRow` → `applyModel(shadow)`）**已实现且编译通过**，
但 `demo_account` 的 4 条判据红（`store.rows` 为空）⇒ 已**回退**，分支保持绿。

- 现象：`enableDemo() → openSession('demo-welcome') → openDemoSession → demoRunTurn` 之后 `rows` 为空 ⇒
  影子在这条链上没有吃到事件。
- 定位入口：`store.demoRunTurn` 实际调用的推送方法（`pushEvent` 还是 `pushEvents`）与
  `runShadowModel` 的两条接线是否一一对应；以及 `openDemoSession` 是否在 push 之前重置了 `shadow`。
- 修好后：翻转 → `run.sh` 全绿 → `assembleHap` → 装机长回合对照（`[MODEL-ROWDIFF]` 应为 0）→
  删旧层（`reduce/render/streammerge/derive` ≈5k 行）→ `gate.sh`。

### 本轮钓出并修复的真缺陷（都有判据）

1. 适配层读 `callID` 而真 wire 是 `call_id` ⇒ 生产上工具身份会丢；
2. **同一 wire 事件派生多帧共享 `seq`** ⇒ 旧守卫把 `tick` 之后的 `done` 全丢 ⇒ 末迭代工具消失；
3. `final.blocks` 的"空工具/空正文"覆盖本地已有值 ⇒ 提交瞬间内容消失（P5：缺字段 = 未携带）；
4. 助手行缺**回合级 `content`** ⇒ 无迭代回合（demo／纯文本回复）正文为空。
