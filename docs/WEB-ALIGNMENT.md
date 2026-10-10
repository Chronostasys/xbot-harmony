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
| `MessageList`/`LiveIteration`：live 行渲染**已完成迭代**（在列表）+ 在飞快照（`liveProgress`） | `MessageRow.ets`（列表渲染全部迭代）+ `LiveTailView.ets`（尾块渲染 `store.liveProgress()`） | 语义一致 |
| `LiveIteration` 渲染序 T→O→C + 空内容时 `ShimmerThinking` | `LiveTailView.ets`（思考头 → 正文打字机 → 工具 pill） | 语义一致 |
| `progressStore.fullReset`（切会话复位 store + `lastTurnID/lastIter`） | `core/store.ets` `openSession` → `this.state = initialChatState(chatId)` | 语义一致（整体重建 ⇒ 不可能漏字段） |

## 2. 有差异的地方 + 理由（逐条）

1. **`tailOwnedIteration` / `MessageRowView.isTailOwned` 被删除**（bug1 根因）。
   web 的 live 行 `iterations` **只含已完成迭代**，在飞内容（content/reasoning/tools）是独立字段；
   原生旧实现把在飞内容折进"最后一个迭代"，再让列表跳过它、由尾块渲染 ⇒ 两处必须严格互斥，
   稍有不一致就"同一个 turn 渲染两遍"。对齐 web 后二者天然不重叠 ⇒ 判据整个删掉。
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
- 全部 35 个测试文件 `run.sh` 通过；release+debug 双产物 `EXIT=0`。
