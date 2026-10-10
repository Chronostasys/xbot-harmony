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
   追加边界：仅当 `lastIter > maxCompleted`（迭代 commit 后不追加，块数**单调不减**）。
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
