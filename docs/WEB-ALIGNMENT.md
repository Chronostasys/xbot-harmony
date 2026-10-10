# WEB-ALIGNMENT.md — 原生端 ↔ web 权威状态机 对照表

> 目的：证明原生端的实时渲染/状态行为与 web **由代码同一性保证一致**，而不是"照着理解再写"。
> 参照源：`/home/smith/src/xbot/web/src/chat/{reduce,derive,integrate,normalize}.ts`、
> `web/src/components/agent/{normalize,progressStore}.ts`、`web/src/hooks/useProgressStream.ts`、
> `web/src/workspace/panels/AgentPanel.tsx`。

## 0. 接入方式（为什么不再是"手写近似"）

- **端口件位置**：`entry/src/main/ets/core/{reduce,derive,integrate,normalize,agent_normalize,progress_types,chat_types_full,chattypes}.ts`
  —— 逐字移植自 web（每个文件首行标注来源）。以 **`.ts`** 形式存在：ArkTS 的严格规则
  （`arkts-no-spread` / `arkts-no-untyped-obj-literals` / `arkts-no-any-unknown` …）只对 `.ets`
  生效；`.ts` 走 TypeScript 语义，从而**原样保留移植代码**（对象展开、`as`、`unknown` 等），
  不必为迁就 ArkTS 而重写逻辑。
- **唯一事实源**：`ChatStore` 持有 `state: ChatState`（`initialChatState`），所有进度事件经
  `normalizeEvent → reduce` 落入它；渲染行 `rows` 由 `deriveRows(state)` + `core/render.ts` 适配
  得出；`busy` 由 AgentPanel 三元公式计算。`core/store.ets` 里原先手写的 live/rows 维护
  （`applyStreamProgress` / `applyStructuredProgress` / `foldStreamBuffers` / `liveRow` /
  `settleLiveOnIdle` / `onFinalText` / `streamText|streamReasoning|streamTools` 自造缓冲）**已全部删除**。
- **门禁**：`tools/tests/run.sh` 编译 `core/*.{ets,ts}` 并执行全部 `*.test.ts`（含 un-parked 的
  `reduce.test.ts`，78 项 —— 之前这份 2000 行转移表**零门禁**）。

## 1. 逐条对照

| web（文件:函数/case） | 原生端（文件:函数） | 状态 |
|---|---|---|
| `chat/types.ts` 全部类型（Brand/NonEmpty/TurnPhase/LiveSnapshot/ChatState/DomainEvent…） | `core/chat_types_full.ts` | 逐字一致 |
| `components/agent/progressStore.ts` 类型面 + `normalizeWebTool*`/`normalizeWebSubAgent*` | `core/progress_types.ts` | 逐字一致（`normalizeWebTool` 额外保留 `gen_chars`→`genChars`，理由见下） |
| `types/shared.ts` `ProgressSnapshot`/`EMPTY_PROGRESS_SNAPSHOT`/`ChatMessage`/`Web*` | `core/chattypes.ts` | 逐字一致（`WebToolProgress` 额外带可选 `genChars`） |
| `components/agent/normalize.ts`（`normalizeWebIteration`/`parseWebIterations`/`historyProgressToLive`/legacy normalizeIteration） | `core/agent_normalize.ts` | 逐字一致 |
| `chat/normalize.ts` `normalizeEvent`（每个 `case`：progress_structured→turn_started/iteration/phase_done/stream、stream_content、text、session、user_echo/inject_user、queue_state） | `core/normalize.ts` | 逐字一致（`HistProgress` 改为内联接口 —— `.ts` 禁止 import ArkTS `.ets`，字段与协议一致） |
| `chat/reduce.ts` `reduce`（case：session_idle/session_running/turn_started/iteration/stream/phase_done/text_final/session_fields/session/history_replaced/iterations_loaded/user_sent/user_echo/user_ack/user_fail/queue_state；不变量 I1–I6） | `core/reduce.ts` | 逐字一致 |
| `chat/derive.ts` `deriveRows`（UserRowView/LiveRowView/FrozenRowView/CommittedRowView + memo） | `core/derive.ts` | 逐字一致 |
| `chat/integrate.ts` `historyToReplaced`/`rowsToChatMessages`/`liveProgressFromState`/`snapshotToLive` | `core/integrate.ts` | 逐字一致 |
| `AgentPanel.tsx:713` busy 三元公式 `currentSession.running \|\| snapshot.streaming \|\| (activeTurn!==null)` | `core/store.ets` `get busy()` | 逐字一致（额外 `&& askUser===null`，见下） |
| `useChatMessages`：渲染行 = `rowsToChatMessages(deriveRows(state))` | `core/store.ets` `rebuildRows()` + `core/render.ts` `applyRow` | 逐字一致（就地更新保 @ObjectLink 恒等，等价 web 的对象恒等 memo） |
| `useChatMessages` history → `history_replaced` | `core/store.ets` `loadHistoryInner/loadMore`（`ChatStore.toChatMessages` + `historyToReplaced`） | 逐字一致 |
| `useProgressStream`：按 `msg.type` 派发 | `core/store.ets` `onSse`（`raw.type = eventName` → `normalizeEvent` → `reduce`） | 逐字一致（事件名 = 权威类型，绝不按载荷字段猜分类） |
| `MessageList`/`TurnBody`：live 行渲染**已完成迭代**，`liveProgress` 追加 `LiveIteration`（**同一气泡内**最后一块） | `MessageRow.ets`（`AssistantBlock` 渲染 `iterations` ⊕ 末尾在飞块）+ `core/render.ets` `liveIterations`（把在飞块折进行 `iterations`，`live:true`） | 逐字对齐（同气泡最后一块） |
| `LiveIteration` 渲染序 T→O→C + 空内容时 `ShimmerThinking` | `MessageRow.ets` `LiveIterationBlock` → `LiveTailView.ets`（思考头 → 正文打字机 → 工具 pill；**无自己的气泡 chrome**） | 语义一致 |
| `progressStore.fullReset`（切会话复位 store + `lastTurnID/lastIter`） | `core/store.ets` `openSession` → `this.state = initialChatState(chatId)` | 语义一致（整体重建 ⇒ 不可能漏字段） |

## 2. 有差异的地方 + 理由（逐条）

1. **`tailOwnedIteration` / `MessageRowView.isTailOwned` 已删除**（bug1 根因）—— 且**在飞块
   不再有独立气泡**（bug2）。web 的 `TurnBody` 在**同一个气泡内**渲染 `iterations`（已完成）
   之后追加 `<LiveIteration>`（在飞）。native 一行 = 一条消息 = 一个气泡 ⇒ 等价做法是
   `core/render.ets` 的 `liveIterations` 把在飞内容（content/reasoning/activeTools/
   streamingTools）折成 `iterations` 的**最后一元素**（`live: true`），由 `MessageRowView`
   的同一套块渲染画出（仅最后一块带打字机 `LiveIterationBlock → LiveTailView`）。
   追加边界：`lastIter > maxCompleted`（正常流式的在飞迭代）**或**「同号已完成迭代是
   **空壳**」（服务端把在飞迭代记进 `iteration_history` 的情形 —— 见 §7）；同号已完成
   迭代**已有可见内容**时不追加（那是在飞字段对同一迭代的重复副本 ⇒ 会重复渲染 +
   块数回退）。字段级去重与 web `LiveIteration` 的 `effectiveStreamContent`/`effectiveReasoning`
   同判据（与任一已完成迭代相同 ⇒ 置空）。
   ⇒ 判据（isTailOwned/tailOwnedIteration）整个删掉；在飞内容与已完成迭代同一气泡、同一行。
2. **`get busy()` 额外 `&& this.askUser === null`**。对齐 AgentPanel 的
   `&& !askUser.prompt && currentSession?.status !== 'waiting_input'`（等待用户回答时 turn 是 PAUSED，
   输入框不得显示 generating/stop）。native 只有 `askUser`（无 `currentSession.status`），故取前一半。
3. **`WebToolProgress.genChars`**：web 无此字段（web 的 generating 角标只显示文字）；原生 pill 显示
   「生成中 N 字」（用户已见的形态，服务端 `protocol.ToolProgress.GenChars` 有值）⇒ 保留为可选扩展字段。
4. **同一份类型在 `.ts`/`.ets` 之间的边界**：`core/types.ets`（原生协议镜像，ArkTS）与
   `core/chattypes.ts`（web 形状，TS）并存；两者在 `core/render.ts` / `core/store.ets` 之间做受控映射
   （`WebIteration → HistoryIteration`、`WebToolProgress → ToolProgress`）。这是 ArkTS 工程混合 `.ets`/`.ts`
   的必然边界，不是逻辑差异。
5. **`useProgressStream` 的 finalize guard（finalizedRef/phaseDoneRef/turnCommittedRef/finalizedTurnIDRef）未逐字搬**。
   这些 guard 在 web 里是为**两个独立 store**（useChatMessages 的 messages + progressStore 的 live 快照）
   之间的竞态兜底；原生端只保留**一个**状态机（ChatState 内含 live/frozen/committed 三态互斥），
   reduce 的 `text_final`/`session`/`turn_started` 分支本身幂等且自带陈旧 turn 守卫 ⇒ 不需要重复的 ref guard。
   （其**语义**——旧 turn 迟到事件不污染新 turn、text 前已有内容不丢——由 `reduce.test.ts` 的对应用例守护。）
6. **`core/store.ets` 保留 `pruneEmptyLiveRowIfIdle()` 接口（返回 false 空实现）**：旧调用点仍在，
   但空壳 live 行的收尾现由 reduce 的 `session(idle)` 分支承担（web 同源），故此步不再需要。

## 3. 行为一致性证据

- `tools/tests/reduce.test.ts`（78 项）：un-parked 的状态机转移表测试，覆盖 web
  `chat/reduce.test.ts` 与 `p0-*.test.ts` 的关键序列 —— busy 不变量、live 迭代不消失、
  重启 resume/seq 重启、notification 行、重复 key、last-iteration、gap、in-flight 工具折叠。
- `tools/tests/streammerge_row.test.ts`（2 项）：live 行「已完成迭代在列表 / 在飞快照在尾块，
  **互不重叠**」的不变量（bug1 回归守卫）。
- `tools/tests/live_iteration_inline.test.ts`（2 项）：**2026-10-10 真机 bug ①/② 回归守卫** ——
  驱动含 3 迭代的真实事件序列（turn_started→iteration×3→phase_done→text_final，中间 stream
  推进），断言：该 turn 恰一条 assistant 行、其 `iterations` 数**单调不减**、第 k 个迭代
  commit 后**仍在该行**、在飞块是该行**最后一个迭代块**（同气泡，非独立行/气泡）。
- `tools/tests/rowdiff.test.ts`：行数据源 diff 语义（含 `changedByKeys` 键快照 diff ——
  bug ① 的页面侧根因：就地更新的行对象 ⇒ 新旧数组同一引用 ⇒ 直接比 `rev` 恒相等 ⇒ 零通知）。
- `tools/tests/user_row_integrity.test.ts`（7 项）：**一条用户消息恰一条 user 行** ——
  端到端驱动 `ChatStore.send()`（打桩 HTTP/SSE），覆盖「乐观发送 → 回声/回合开始 →
  最终文本」以及「历史合并」「通知 turn 回声」三类路径（bug2「你好渲染两次」回归守卫）。
- 全部 36 个测试文件 `run.sh` 通过；release+debug 双产物 `EXIT=0`。

## 4. requestID 传输契约（一条用户消息恰一条 user 行的**前提**）

reduce/derive 的「乐观行 ⇄ 回声/回合/历史 收敛」**靠 requestID 精确匹配**。web 侧由
`useChatMessages.sendMessage` 把乐观行的 requestID 作为 `id` 发进 `ws.send(...)` 保证；
原生端走 REST `/api/message`，因此 **`MessageReq` 必须带 `id`**（服务端
`protocol.WSClientMessage.ID json:"id,omitempty"`，严格解码认它）——
`ChatStore.send()` 现在把 `nextRowID('req')` 生成的 requestID 传进去。

- 服务端据此把它原样回显到 `user_echo.ID`（`normalizeUserEcho` 读 `env.request_id ?? env.id`）
  与 `turn_started.turn_start.request_id`，`reduce` 的 `user_echo`/`turn_started` 分支
  即可就地收敛（**不新增任何去重逻辑** —— 用 web 既有转移规则）。
- 缺 `id` 的后果（2026-10-10 真机 bug）：服务端自生成 uuid ⇒ 回声 ID 与乐观行对不上 ⇒
  `user_echo` 被当新 user 追加进 `pendingUsers` ⇒ 同一句用户消息渲染两条 user 行
  （一条绑进 turn 在回复之前、一条 pending 沉底在回复之后）。

**内部行（`view_image` 注入）**：服务端 `/api/history` 已在
`channel.ConvertMessagesToHistory*` 里经 `filterInternalMessages` 丢弃
`llm.ChatMessage.Internal` 行（`channel/subscription.go`）⇒ 原生端历史里不会出现注入行，
无需再补过滤（`HistoryMessage` 也不带 `internal` 字段）。**通知行**保留为独立 user 行
（`isNotification`），`inject_user` 回声由 reduce ③.5 内容幂等收敛。

## 5. P0 回归：busy 判据分叉 ⇒「思考中…」不出现（2026-10-10）

**不变量**（用户两次点名）：**composer 显示"停止"（busy）⟹ 列表尾部必须有一个可见的
"进行中"信号**（「思考中…」占位 或 live 行自身渲染出的在飞内容）。

- **根因（页面层，非 store 层）**：`pages/Index.ets` 里 composer 的「停止/发送」按钮读
  `runningNow()`（= 本地 `store.busy` **∥ 有产出的 live 行 ∥ 新鲜的服务端 running**），
  而列表占位符读 `this.busy`（= `store.busy`，**仅本地事件驱动的快路径**）。两套判据分叉：
  服务端已 `running`（会话树权威）但本地 `turn_started` 尚未到达（SSE 延迟/错过/刚切到运行中
  会话）时，**按钮=停止、列表却一片空白** —— 用户看到的正是「发送完了连思考中都没来」。
  （store→rows→判据的纯逻辑本身正确，`tools/tests/busy_indicator.test.ts` 的端到端用例可证。）
- **修法（对齐 web 的"单一 busy"）**：新增 `core/indicators.ets`：
  `busyNow(signals)` = 与 `runningNow()` 逐项同源的统一判据；`showsBusyPlaceholder(signals)`
  强制由 `busyNow` 驱动（**不再用 `localBusy`**）。页面 `runningNow()` 与列表占位符
  （`if` 渲染 + `onScrollIndex` 的 `listItemCount` 项数）**全部改走这两个函数** ⇒ 不变量按构造成立。
  占位符文案改走 i18n（`$r('app.string.thinking_placeholder')`，对齐 web `t('agent.thinking')`）。
- **红→绿**：`tools/tests/busy_indicator.test.ts` 先红（穷举组合、「服务端 running 本地未到」
  两处 `expected false toBe true`，4 passed / 2 failed）→ 修后绿（6 passed）。

## 6. 交互对齐（2026-10-10，②）

| # | before（原生端现象/判据） | after（对齐 web 的哪段逻辑） |
|---|---|---|
| 1 | **返回键无处理** —— 任何浮层打开时按返回直接退出应用 | `onBackPress` = web 的 `Esc`：先关**最上层**浮层（`core/overlays.ets` `topOverlay`，顺序 = 渲染 z 序逆序），无浮层才交还系统。`AskUser` 是服务端权威必答，**故意不在此列**（web 同样不给 Esc 关闭入口） |
| 2 | **抽屉点空白无反应** —— 只能点 ✕ 收起 | 抽屉加 backdrop：点右侧空白/返回键收起（`closeDrawer` 一并复位改名态），对齐 web backdrop 点击关闭 |
| 3 | 设置/队列/插件/自检/状态/模型 六个 sheet **点空白无反应** | 统一加 backdrop tap-catcher（`Stack{ Row{Blank} + Sheet }`，保持居中），与 `Prefs/Panels/Sess/SearchHits/Ctx` 既有模式一致 |
| 4 | 「↓ 回到最新」判据内联 `!atBottom && rows.length>0` | 抽为 `indicators.showsJumpToLatest(atBottom, rowsLen)` —— **贴底不显示、空列表不显示**（web：仅 follow 暂停时给"回到底部"入口） |

**回归守卫**：`tools/tests/overlays.test.ts`（7 项）钉死 `topOverlay` 的 z 序（含多层叠加
"不被下层抢走"）与 `showsJumpToLatest` 的贴底/空列表判据；`tools/tests/busy_indicator.test.ts`
（6 项）钉死 busy 不变量（穷举 + 真实 store 流水线 + 服务端 running 场景）。

## 7. P0 回归：判据与渲染**不同源** ⇒「占位让位、渲染空白」（2026-10-10 第二次点名）

**用户原话**：「发送后**思考中出现**，**第一个 SSE 到达就消失**，直到**这个 iter 结束**时迭代
**瞬间出现**，**中间看不到任何进度**」。

### 7.1 根因（两条，必须成对修）

**A. 判据与渲染读的不是同一件事（"判据说有、渲染画不出"）**
- `core/streammerge.ets` 的 `rowIsEmpty` 旧实现**无条件**把 `row.content` 算作可见内容；
- 而渲染层 `components/MessageRow.ets` 的 `AssistantBlock` **只在 `row.iterations.length === 0`
  时**才画 `row.content`（有迭代 ⇒ 内容在迭代内渲染，与 web `AssistantMessage.finalContent`
  同判据）。
⇒ live 行的在飞正文落在 `row.content` 时：判据说"有内容" ⇒ `tailShowsIndicator = true`
⇒ **占位被抑制**；渲染层却画不出它 ⇒ **列表全空**。

**B. 在飞内容没有渲染位（`core/render.ets.liveIterations`）**
- 旧实现**只在 `lastIter > maxCompleted` 时**追加在飞块。
- 但服务端会在迭代边界/工具相变时把**当前在飞迭代**（此刻往往还是**空壳**）记进
  `iteration_history` ⇒ `maxCompleted === lastIter` ⇒ 在飞块**永不追加**；
  而在飞内容（`content`/`reasoning`/`streamingTools`）照常落在 live Row 顶层字段 ⇒
  既进不了迭代块、又被 A 的渲染条件挡掉 ⇒ 直到迭代 commit 才由历史块一次性蹦出
  （正是症状 3+4）。

### 7.2 修法（逐条对齐 web，不做自创）

| 项 | 修法 | web 对应 |
|---|---|---|
| A | `core/streammerge.ets` 新增**「尾部可见内容量」纯函数** `rowVisibleChars(row)`：逐条复刻 `AssistantBlock`（`row.content` 仅当 `iterations` 为空 + 每块 思考头/正文/工具）。`rowIsEmpty` 改为 `rowVisibleChars(row) === 0`。**判据（`tailShowsIndicator`）与渲染守卫（`ChatRowBody`/`MessageRowView.build`）都调它** ⇒ 结构上不可能再"判据说有、渲染画不出" | web 的 `MessageList.tailShowsIndicator` 与 `LiveIteration` 的**空内容分支共用 `liveIterationInFlight`**（同一判据，互斥 ⇒ 恰好一个指示器） |
| B | `core/render.ets`：在飞块的出现条件 = `lastIter > maxCompleted` **或**「同号已完成迭代是空壳」；只要在飞字段有**尚未被历史渲染**的内容就追加（给它渲染位）。字段级去重（与**任一**已完成迭代的 content/reasoning 相同 ⇒ 置空） | web `LiveIteration` 的 `effectiveStreamContent`/`effectiveReasoning`（内容匹配抑制，逐字对齐）；`liveIterationInFlight` = `iteration > maxCompleted` |
| 键 | `MessageRow` 的迭代块 `ForEach` key 加 `live` 标记（在飞块可能与已提交迭代**同号**，只按 `row.id#iteration` 会撞 key ⇒ ArkUI 复用错位） | web 用 `hKey = turnID:iteration` + LiveIteration 独立挂载点（等价：保证同号两块不撞键） |

**唯一的故意差异（理由充分）**：native 的 `LiveTailView` **没有** web `LiveIteration` 的
空内容 `ShimmerThinking` 分支 —— 因为 native 的空在飞态由**列表尾「思考中…」占位**承担
（`showsBusyPlaceholder`），二者由同一判据驱动 ⇒ 仍是 web 的"恰好一个指示器"不变量
（只是空态指示器的落点是列表尾，而不是气泡内）。加内层 shimmer 会与占位**双渲染**
（web 自己也为此删过一处 `ShimmerThinking`，见 `AssistantMessage` 注释）。

### 7.3 红 → 绿证据

`tools/tests/p0_tail_visibility.test.ts`：真实 store 流水线（SSE → `normalizeEvent` → `reduce`
→ `deriveRows` → `applyRow`），**每一步**断言三条联合不变量：

- **(I1)** `尾部可见内容量 > 0` **或** `showsBusyPlaceholder === true`（绝不允许两者皆假）；
- **(I2)** 判据说"有内容" **⟺** 独立渲染 oracle 画出内容（同源）；且 `rowVisibleChars` 与
  oracle **逐字符相等**；
- **(I3)** 在飞期间可见内容量**单调不减**，且**在飞期间真的出现过**可见内容（不得 0 → commit 才跳变）。

**红**（修前，`22 passed / 11 failed`）：

```
[turn_started]                  渲染可见=0 占位=true   ← ✓
[第一条 SSE（在飞迭代快照，空）]  渲染可见=0 占位=true   ← ✓
[第二条 SSE（正文到达）]          渲染可见=0 占位=false  ← ✗ 两者皆假 = 全空（P0）
   ✗ 尾部可见内容=0 占位=false —— 绝不允许"两者皆假"
   ✗ 判据(非空)=true 但渲染可见=0 —— 判据与渲染必须同源
[iter1 commit]                   渲染可见=8 占位=false ← "迭代结束才瞬间出现"
```

**绿**（修后，`37 passed / 0 failed`）：

```
[turn_started]                  渲染可见=0 占位=true
[第一条 SSE（在飞迭代快照，空）]  渲染可见=0 占位=true
[第二条 SSE（正文「思考一」）]     渲染可见=3 占位=false ← 内容到达即刻可见
[第三条 SSE（正文变长）]          渲染可见=6 占位=false ← 单调增长
[第四条 SSE（推理流）]            渲染可见=7 占位=false ← 单调增长（思考头）
[iter1 commit]                   渲染可见=5 占位=false ← 权威快照替换在飞草稿
[phase_done]                     渲染可见=5 占位=false
```

**回归守卫**：`rowempty.test.ts`（10）、`live_iteration_inline.test.ts`（2）、
`streammerge_row.test.ts`（2）、`busy_indicator.test.ts`（6）+ 全量 `tools/tests/run.sh` EXIT=0。


## 8. 回归修复（2026-10-10 第二批）：live 内容「投递机制」—— 值变化通道

**用户原话**：「发送后思考中出现，**第一个 SSE 到达就消失**，直到这个 iter 结束时迭代瞬间
出现，**中间看不到任何进度**」；用户定性为**回归**（「重复 user msg 修复之前，typer 是好的」）。

**回归窗口（git 证据）**：`0a17f76`(P54，最后可用) → `fa07632`(P55，罪魁)。
P54 的 live 尾块由页面 `@State liveText/liveReasoning/liveTools`（`syncLiveTail` 每帧赋值）
**直接**建 `LiveTailView`；P55 删除该机制，改为从**就地修改**的 `ChatRow` 里读。

**根因**：ArkUI V1 组件只在「收到的值发生变化」时重建；`ChatRow` 就地更新 ⇒ 引用恒定
⇒ 无值变化；live 行又经带参 `@Builder`（按值 = 快照）创建、且不在带 key 的 `LazyForEach`
里 ⇒ 整个流式期间组件重建 0 次 ⇒ 渲染输入冻结在创建那一刻（空）⇒ 全空，直到 commit 后
由 `LazyForEach` 重建才一次性出现。**数据层正常**（`rev`/`rowsFp` 每帧变）。

**修法（与 web 的对应）**：web 侧 `MessageList` 把 `liveProgress`（progressStore 快照）
作为 **prop** 传给 `TurnBody`/`LiveIteration` —— 原生端等价物 = 页面 `@State` 派生 + `@Prop`
投递：

| web | 原生端（本修复） |
|---|---|
| `useProgressStream` → `progressStore` 快照 | `pages/Index.syncLiveTail()`：从 live 行末尾在飞块派生（与 `rowIsEmpty` **同源**） |
| `liveProgress` 作为 prop 传给列表/`TurnBody` | `@State liveText/liveReasoning/liveTools` → `MessageRowView` 的 `@Prop` |
| 在同一气泡内 `iterations ⊕ <LiveIteration>` | `MessageRowView.AssistantBlock`：已完成迭代 ⊕ `LiveIterationBlock()`（**无参**，读 @Prop） |
| `liveId` 尾行由 React 正常渲染 | live 行由**无参** `@Builder LiveRowBody()` 创建（绕开带参 @Builder 的快照语义）|

**差异说明**：原 `render.ets.liveIterations` 仍把在飞内容折进行 `iterations` 的一块（`live:true`）——
保留它是为了让**可见性判据**（`rowVisibleChars/rowIsEmpty`）与**投递源**读**同一块**（同源），
渲染则由 `@Prop` 完成（`completedIters` 已排除 `live:true` 块 ⇒ 不会双渲染）。

**回归守卫**：`tools/tests/live_tail_delivery.test.ts`（11 项）—— 读**真实源码**判定生产接线
形态，再用投递模型驱动真实 store 流水线，断言「live 组件每帧渲染输入 == 当前在飞内容」。
P55 形态必红（渲染输入恒为 ""，重建次数恒为 1）；本修复后绿。

## 9. 回归修复（2026-10-10 第三批）：live 行**已完成块**也走「值变化通道」

**用户原话**：「我发消息 → **iter 1 (streaming)** → iter 1 的 **tool call 完成**后，
**iter 1 直接消失** → 接着 **iter 2 (streaming)**，但它前面**看不到 iter 1** 了。」

**根因（第 8 节的遗留面）**：第 8 节只把「在飞块」接到了「值变化」通道；**已完成块**仍走
带参 `@Builder` `AssistantBlock(this.row)` 里的 `ForEach(this.itersFor(row))` —— 参数是
**同一个** `ChatRow` 引用（`core/render.ets:applyRow` **就地改**它）。ArkUI V1 的
「按值传参 @Builder」参数不变 ⇒ 其内 UI **不重建**（`ARKTS-GOTCHAS §4`）⇒ 已完成块区
**冻结在创建那一瞬（空）**。真机逐帧：

| 时刻 | 模型 `row.iterations`（正确） | 渲染（HEAD，已完成块区冻结为 `[]`） |
|---|---|---|
| iter1 流式 | `[iter1(live)]` | 在飞块（@Prop）画出 iter1 ✅ |
| **tool call 完成** | `[iter1]`（进 `iteration_history`）+ 在飞块清空 | **两个区都空 ⇒ iter1 消失** ❌ |
| iter2 流式 | `[iter1, iter2(live)]` | 只在飞块 ⇒ `[iter2]`，**前面看不到 iter1** ❌ |

**修法（对齐 web，非 hack / 非 tick / 无全局强制重建）**：web 的 `MessageList` 把**整份**
`liveProgress` 快照（含其 `iterations`）当 prop 传给 `TurnBody`。原生端等价物 = 把
**已完成块列表**也镜像进 `@State` 并以 `@Prop` 投递，同时让渲染它的 `@Builder` **无参**
（读值，参数不再冻结）：

| web | 原生端（本修复） |
|---|---|
| `liveProgress.iterationHistory`（已完成）随快照当 prop 传 `TurnBody` | `@State liveBlocks` = `completedBlocks(liveRowRef)`（`syncLiveTail` 按 `blocksSignature` 门控赋值）→ `MessageRowView` 的 `@Prop liveBlocks` |
| `TurnBody` 用 prop 里的 `iterations` 渲染已提交块 | `MessageRowView.blocksFor()`：live 行读 `this.liveBlocks`，普通行读行对象（普通行有 `id#rev` key 兜底） |
| React 每次 render 按 prop 重算 | `AssistantBlock()` / `IterationBlock(it)` / `ToolPill(it,t)` 改**无参**（读 `this.row`/值），绕开带参 @Builder 快照 |

**性能**：`liveBlocks` 按 `blocksSignature`（迭代号/正文长/思考长/工具数）门控 —— 流式期间
**不变不赋值**（在飞内容仍走 `liveText/liveReasoning/liveTools` 的既有通道），只有**迭代边界**
（commit）才换值 ⇒ 每轮新增 ≤ 迭代数次的重建，**不涉及**每帧重建整列表 / tick 硬刷。

**回归守卫**：`tools/tests/live_block_delivery.test.ts`（15 项）—— ①读**真实源码**判定
「已完成块」的投递形态（value-prop vs row-object）；②用真实 store（SSE → normalize →
reduce → deriveRows → applyRow）跑真实事件序列（iter1 流式 → 工具 generating/running →
工具完成 + iter1 commit → iter2 流式）；③以真实接线形态重建「组件每帧**渲染出的块列表**」，
断言 (M1) 单调不减、(M2) 已完成的 iter1（含 tool pill）始终在列表里。
HEAD 形态必红（`渲染块列表回退：1 → 0`、iter1 缺失：6 passed / 7 failed）；本修复后绿（15/0）。
