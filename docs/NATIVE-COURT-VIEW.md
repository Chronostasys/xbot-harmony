# 原生「通信视图」面板（web `/court` 的对等实现）

> 2026-10-22。用户：「网页端加了一个特别炫酷的页面，原生也要加上对应面板，确保功能正常」。

## 1. web 权威是什么

| web 文件 | 职责 |
|---|---|
| `web/src/pages/CourtPage.tsx` → `components/court/CourtConsole.tsx` | 页面骨架：群组 → 成员 → 消息 → 视图（时间轴 / Sankey）→ 线程 / 回放 |
| `components/court/OrgTree.tsx` | 左侧组织树：状态灯、待处理计数、任务摘要、进度条；点节点 = 过滤主视图 |
| `components/court/TimelineCanvas.tsx` / `SankeyView.tsx` | 时间轴画布 / 弧线视图（谁在什么时候对谁说了什么、kind 权重） |
| `components/court/ThreadPanel.tsx` | 右侧线程详情（按 `correlation_id` 把提问→回答→汇报→决策→动作折叠成一条线） |
| `components/court/PlaybackBar.tsx` | 回放条：把时间拨回某一刻，只看当时已发生的消息 |
| `components/court/{types,seed,api}.ts` | 类型/配色/文案、`deriveLanes`、`GET /api/groups*` + SSE `group.message` |

后端契约：`channel/web/web_group.go` + `protocol/group.go`
（`GET /api/groups`、`/api/groups/{id}/members`、`/api/groups/{id}/messages?cursor=&limit=&channel=&chat_id=`；
实时事件 `group.message`，载荷 `{result:{group_id,message}}`）。
⚠️ 真实页面**不伪造数据**：API 失败就显示错误 + 空态；只有 `/court-demo` 用内置 seed。

## 2. 原生实现（本仓）

| 层 | 文件 | 说明 |
|---|---|---|
| 纯逻辑 | `core/court.ets` | wire 类型、`deriveCourtLanes`（逐字对齐 web `seed.ts`）、`courtThreads`（`correlation_id`）、时间窗/回放切片、kind 角色/文案/权重、地址归一、SSE 载荷解析、按 id 幂等追加 |
| 数据/网络 | `core/store.ets`（`loadCourt` / `selectCourtGroup` / `openCourtLive` / `closeCourtLive`） | `GET /api/groups*`；**独立** `SseClient` 订阅 `group.message` |
| 面板 | `components/CourtSheet.ets` | 群组切换、时间窗、回放 Slider、组织树（横向卡片）、时间轴消息卡、线程视图 |
| 入口 | `pages/Index.ets`：**运行面板「代理」tab**（`panelTab === 'subs'` → `CourtSheet({ embedded: true })`） | 2026-10-22 用户要求：通信视图**代替**运行面板里的老子代理面板，⛔ 不再单独加顶栏按钮/独立浮层。生命周期 `openCourtData`/`closeCourtData`：进 tab 才 `loadCourt`+`openCourtLive`，离开/关面板 `closeCourtLive`（`closePanels()` 是关面板唯一出口） |
| i18n | `core/i18n_native.ets` | 新增 8 条（zh/en/ja 同步追加，保持三数组下标一致） |

### 手机形态的三个**有意的**对等取舍（信息不减）

1. **Sankey → 卡片方向行**：手机一屏放不下两条坐标轴；「谁→谁」由卡片的方向行 + kind 权重
   （左侧强调条粗细）表达，不画假画布。
2. **回放条 → Slider**：原生 `setTimeout/ setInterval` 有静态预算上限（`tools/perf/guard.sh`），
   回放改为"拖到某时刻"的纯本地切片（`replayCourtMessages`），零定时器。
3. **组织树 → 横向卡片条**：手机竖向空间优先给时间轴；点成员卡 = 过滤（再点一次取消）。

## 3. 为什么必须用**独立** SSE 连接

`SseClient.connect()` 是「一个 chat 一个订阅」：换目标会 `close()` 旧连接并清续传游标。
把面板的 `group.message` 复用到主 `this.sse` 会把聊天流踢掉。web 同理
（`components/court/api.ts:subscribeGroupMessages` 也另开一个 `EventSource`）。

## 4. 判据（可运行的机器口径）

`tools/tests/court.test.ts`（63 条）：

- 泳道推导：未回答 `ask_user` ⇒ `blocked` + 角标；同 `correlation_id` 的 `answer` 解除；
  `decision` 含 `approved` 才闭合进度；`left` ⇒ 0；无参与 ⇒ 基线 0.72（web 同式）。
- 线程：按 `correlation_id` 折叠、按最后活动时间降序、条数/标题、线程内按时间升序。
- 时间窗：**(now-window, now]** 左开右闭；`0` = 全部；文案与 web 逐字。
- 回放：只保留 `<= upto`；`0` = 实时。
- kind：6 种 kind 语义角色互不相同（颜色可区分）、文案/权重。
- 实时：`{result:{...}}` 与扁平两种载荷；坏 JSON / 缺 `message.id` ⇒ null（不猜）；同 id 追加返回**原引用**。
- 接线：store 用真实 `/api/groups*` + `group.message` + 独立 `SseClient`；页面 import/渲染/打开加载/
  关闭退订/返回键登记；面板自己不发网络、无颜色字面量、不 import seed/demo。
- 子代理新状态：`interrupted`/`unloaded` 不得显示成「完成」。

mutation 自证（都实测变红）：时间窗闭区间 / 去掉按 id 去重 / 关闭不退订。

## 5. 子代理相关（本期一并核对）

后端近期：`c14f2017`（interactive SubAgent 持久化 + 重启递归恢复，四态
`idle|running|interrupted|unloaded`）、`5dcfdc32`（SubAgent 真实层级）、`390e4ce6`（会话侧栏「群组」Tab）。
原生：层级早已按 `children` 递归展平（`core/subagent.ets`）；本期补上
`interrupted`/`unloaded` 的**文案**（`core/panels.ets:subagentSubText`），避免"中断/已卸载"被显示成「完成」。
这两态**都不是运行中**（`subAgentRowOf.running` 不含它们 —— 上一个进程的 goroutine 已消失）。
