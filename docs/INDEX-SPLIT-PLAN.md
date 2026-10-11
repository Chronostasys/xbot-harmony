# INDEX-SPLIT-PLAN —— `pages/Index.ets` 结构审计与拆分方案（阶段 0，只读审计）

> 目的：把 6420 行的 `pages/Index.ets` **安全地**拆开 —— 视觉与判据分离，但**不改变行为**。
> 所有行号/数字都是 `grep -n` / `wc -l` 实测（2026-10-11，HEAD 含 `fix(scroll)` 批次）。
> ⛔ 本文件是**方案**，不是执行记录；阶段 1 必须逐块批准、逐块提交、逐块回滚。

## 0. 度量（可数口径）

| 口径 | 值 | 取证 |
|---|---|---|
| 文件总行数 | **6420** | `wc -l entry/src/main/ets/pages/Index.ets` |
| `@State` 数量 | **117** | 全部 `@State`，无一个 `@StorageLink` |
| `@StorageProp` 数量 | **4** | `safeTopVp` / `safeBottomVp` / `pendingOpenChatId`(+`@Watch`) / `pendingOpenChatSeq`(+`@Watch`) |
| `@Builder`（视图块）数量 | **21** | 见 §1.2 表 |
| struct 方法数量 | **197** | 2 空格缩进成员定义 |
| 注释区块数量 | **59** | `// ──` 分隔（声明区 20 + 服务区 29 + 视图区（注释缩进 ≥6）10） |
| **可独立抽取单元** | **18** | 见 §1.3（这就是"能数得出来的块"） |

行数构成：**声明层 376 行（5.9%）· 服务层 ~3600 行（56%）· 视图层 ~2400 行（38%）**
—— 视觉与逻辑不是"混在一起"，而是**逻辑占多数**：真正该出去的不是 UI，而是服务层（§3 P6）。

## 1. 审计

### 1.1 声明层（294–669，376 行，19 个区块，0 方法）

| 行范围 | 行数 | 内容 |
|---|---|---|
| 294–304 | 11 | 引导/登录（`booted/loggedIn/errMsg/serverUrl/username/password/testMsg/testMsg/recentServers`） |
| 305–338 | 34 | 聊天数据（`sessions/rows/busy/currentChat/usage/cwd/connState/pulseOn`） |
| 339–384 | 46 | 弹层开关 15 个（`showDrawer/showSettings/showQueue/showPlugins/showSelfCheck/showStatus/showModel/showPrefs/showSettingsPanel/showPanels/showSearchHits/showPluginHost/...`） |
| 385–391 | 7 | 附件（`attachments`） |
| 392–406 | 15 | 会话状态栏（`todos/goalObjective/goalStatus/modelBusy`） |
| 407–416 | 10 | P11 输入体验（`draft/cmdItems/cmdToken/composerFocused`） |
| 417–431 | 15 | P9 设置（`settings/showPrefs`） |
| 432–441 | 10 | P8 面板（`cronTasks/bgTasks/subagents/runners/playwright`） |
| 442–453 | 12 | P7 会话管理（`sessQuery/sessMenuId/sessConfirmDelete/collapsedGroups`） |
| 454–495 | 42 | 长按菜单 P5（`ctxMenu/ctxTarget/ctxKind/...`） |
| 496–500 | 5 | AskUser（`askUser/askSelections/askBusy`） |
| 501–510 | 10 | 插件/ArkWeb（`plugins/panelUrl/showPluginHost/panelBusy`） |
| 511–514 | 4 | 图片查看（`imageUrl/imageBusy/imageScale/...`） |
| 515–550 | 36 | P14 弱网与健壮性（`connState/retryTick/...`） |
| 551–559 | 9 | ⚠️ `@StorageProp('pendingOpenChat*')` + `@Watch`（通知深链通道） |
| 560–612 | 53 | live turn（`liveRowRef/hasLiveRow/liveText/liveReasoning/liveTools/liveBlocks/liveSubAgents/liveSubAgentsFp`） |
| 613–624 | 12 | P12 查看器（`imgScale/imgTransX/imgTransY/imgW/imgH/viewH/viewW`） |
| 625–628 | 4 | 工具/迭代展开（`openToolKey/openReasonKey/showReasoning`） |
| 629–656 | 28 | 显示设置（`themeName/fontScale/wrapCode/orbEnabled/reduceMotion`） |

### 1.2 视图层：21 个 `@Builder`（= 21 个天然抽取单元）

| `@Builder` | 起始行 | 行数 | 引用 @State 数 | 写点数 | 备注 |
|---|---|---|---|---|---|
| `LoadingView` | 2626 | 8 | 0 | 0 | 纯静态 |
| `LoginView` | 2634 | 174 | 9 | 7 | 内含"深空底/顶部光晕/玻璃表单卡"（2636–3011 注释） |
| `RewindEditBar` | 2808 | 22 | 0 | 0 | 纯静态 |
| `ChatView` | 2830 | 607 | 75 | 95 | 主界面（含 live 行/Goal/Todo 区）；**最大风险块** |
| `PrefsSheet` | 4694 | 207 | 4 | 2 | `notifyOn/showSettings/themeName/useWebUI` |
| `PanelsSheet` | 4902 | 111 | 7 | 2 | 定时/后台/子代理/Runner |
| `SessSheet` | 5014 | 26 | 2 | 0 | |
| `SearchHitsSheet` | 5041 | 35 | 2 | 1 | |
| `CtxItem` | 5077 | 20 | 1 | 1 | |
| `ContextSheet` | 5098 | 46 | 1 | 0 | |
| `ChatRowBody` | 5145 | 64 | 4 | 0 | 行渲染包装 |
| `LiveRowBody` | 5210 | 130 | 14 | 0 | live 行包装（@State 直驱通道） |
| `DrawerSheet` | 5341 | 252 | 11 | 10 | 会话抽屉 |
| `SettingsSheet` | 5594 | 106 | 9 | 11 | |
| `ModelSheet` | 5701 | 167 | 5 | 6 | |
| `StatusSheet` | 5869 | 80 | 4 | 2 | ⭐ 最小、最干净（见 §5） |
| `SelfCheckSheet` | 5950 | 99 | 2 | 1 | |
| `QueueSheet` | 6050 | 59 | 2 | 1 | |
| `PluginsSheet` | 6110 | 63 | 4 | 5 | |
| `AskUserSheet` | 6174 | 73 | 3 | 1 | |
| `ImageViewer` | 6248 | 173 | 10 | 19 | 写点最多 |

> ⚠️ 上表"行数"= 到下一个 `@Builder` 标记前的行数，**含夹在中间的顶层服务方法**
> （例：`ChatView` 之后的 3437–4873 全是服务方法）⇒ 抽取时以**块的真实首尾**为准，逐块核对。

### 1.3 服务层：30 个注释区块 / 197 方法（670–4873 + 5829–6106 + 末尾数据源）

| 行范围 | 行数 | 方法数 | 职责 |
|---|---|---|---|
| 670–1041 | 372 | 16 | 通知深链（冷/热启动消费 `AppStorage`）+ `bootstrap` |
| 1042–1433 | 392 | 8 | **状态装配 `syncFrom()`**（唯一 store→@State 管线；含 `followBottom` 守卫） |
| 1434–1523 | 90 | 3 | 登录/登出 |
| 1524–1735 | 212 | 11 | 会话（切换/新建/删除/重命名/分组） |
| 1736–1918 | 183 | 13 | 发送/取消/分页/附件上传 |
| 1919–2121 | 203 | 10 | goal/todo 写操作 |
| 2122–2193 | 72 | 4 | 消息导航（`navAnchors/navActiveSeq/navToRow`） |
| 2194–2231 | 38 | 3 | 工具详情/迭代展开 |
| 2232–2290 | 59 | 3 | AskUser 提交 |
| 2291–2326 | 36 | 2 | 插件面板 |
| 2327–2390 | 64 | 3 | 图片（cookie 鉴权取字节） |
| 3437–4873 | 1437 | ~40 | P7 会话/会话分组/P11 输入体验/P9 设置/P8 面板/帧内变更判定/live 同步/P5 长按/rewind/主题/Markdown 主题/i18n |
| 5829–6106 | 278 | 12 | `@Builder` 可用的包装（`currentModelName/ctxText/statusBarText/pal()/eff()` …） |
| 6350–6419 | 70 | 6 | 内联 `class ChatRowDataSource implements IDataSource`（LazyForEach 数据源；因引用 ArkUI 全局类型而不能放 `core/`） |

### 1.4 跨文件耦合（"谁在改它"）——决定能不能抽

按"被 `components/**` 或 `entryability/**` 提到的次数"排序（实测）：

| @State | 声明 | 本页写点 | 本页引用 | 外部文件数 | 结论 |
|---|---|---|---|---|---|
| `settings` | L428 | 2 | 17 | **13** | 跨模块契约 ⇒ 名字不能随意改 |
| `busy` | L308 | 3 | 16 | **8** | 同上 |
| `rows` | L307 | 7 | 35 | **6** | 同上 |
| `password` | L300 | 1 | 3 | 4 | 登录态，别塞进组件 |
| `draft` | L316 | 11 | 17 | 3 | composer 契约 |
| `plugins` | L502 | 1 | 2 | 3 | |
| `username` | L299 | 3 | 11 | 2 | 登录态 |
| `liveText/liveReasoning/liveTools` | L580–582 | 1 each | 3 each | 2 each | 值变化通道，**不可挪出页面** |
| `liveBlocks/liveSubAgents` | L595/487 | 1 | 3/2 | 1 | 同上 |

## 2. 拆分方案

### 2.1 目标拓扑（三层）

```
L0  core/**               纯逻辑 + 唯一判据（已存在；⛔ 本重构不新增任何判据）
      toolstatus · streammerge · listfollow · indicators · bubble · overlays · sessionpick …
L1  components/**         @Component：@Prop 入 / 回调出。**无 store、无 scroller、无弹层栈所有权**
      StatusSheet · QueueSheet · AskUserSheet · ModelSheet · DrawerSheet · MessageListView(?)
L2  pages/Index.ets       仅四件事：① 状态装配（syncFrom/VM）② 生命周期与路由（通知深链）
                          ③ 弹层栈所有权（OverlayState 的所有 flag）④ 滚动所有权（listScroller+rowDs+follow*）
```

### 2.2 单一状态 → 视图管线（关键约束）

1. **判据唯一**：任何"状态/颜色/文案/可见性"判断**只能**来自 L0 既有函数：
   `core/toolstatus`（`renderKind/statusChip/statusColorOf`）、`core/streammerge`（`rowHasInFlightSignal/completedBlocks/displayContent`）、
   `core/indicators`（`busyNow/showsBusyPlaceholder/showsJumpToLatest`）、`core/listfollow`（`nextFollowBottom/listItemCount`）、
   `core/overlays`（`topOverlay`）。⛔ 组件内**禁止**自造第二套。
2. **入参唯一**：L1 组件的 `@Prop` 一律是**基础类型或 VM 对象**，回调是
   `onXxx: (…) => void`；**禁止**把 `ChatStore` / `Scroller` / 弹层开关所有权传进组件。
3. **判据同源的可检验口径**（每阶段都要做）：
   - `grep -c "statusChip(" <新组件>` 与旧 `@Builder` 内的调用**计数相等且入参组相同**（例：`LiveTailView.chip` 必须与 `MessageRow.toolChip` 同 4 参 —— 上一个提交刚修过这条）；
   - 新组件的 `@Prop` 集合 == 旧 `@Builder` 里引用的 `@State/参数` 集合（逐项对照表，多一个少一个都算行为变化）；
   - 纯逻辑判据改动才配单测（`tools/tests/*.test.ts`）；UI 搬运不写新判据。
4. **弹层栈所有权不搬**：`core/overlays.topOverlay` 依赖"所有 flag 在同一处"才能算 z 序与返回键语义
   ⇒ 弹层组件只吃 `visible: @Prop(bool)` + `onClose: () => void`，**flag 永远留在页面**。

## 3. 分阶段计划（每阶段 1 提交 · 独立回滚 · 不得改行为）

| 阶段 | 抽什么 | 行数 | 风险 | 为什么最低风险 | 回滚 |
|---|---|---|---|---|---|
| **P1** | `StatusSheet` → `components/StatusSheet.ets` | 80 | ★ | 4 个只读 state（`usage/cwd/showStatus/showModel`）、2 个写点只是"跳转到其它弹层" ⇒ 改成回调即可；无 store 调用、无 scroller | `git revert <hash>`（新文件+页面 2 处） |
| **P2** | 其余"只读弹层"：`QueueSheet`(59) `PluginsSheet`(63) `AskUserSheet`(73) `SelfCheckSheet`(99) `ContextSheet`(46) `SessSheet`(26) `SearchHitsSheet`(35) | 401 | ★–★★ | state 数 ≤4、写点 ≤5，全部是"展示 + 关闭" | 同上 |
| **P3** | 大弹层：`ModelSheet`(167) `PrefsSheet`(207) `PanelsSheet`(111) `SettingsSheet`(106) `DrawerSheet`(252) | 843 | ★★ | state 数 ≤11，但与"设置写回 store"耦合 ⇒ 需要把写操作收敛成回调 | 同上 |
| **P4** | `LoginView`(174) + `LoadingView`(8) + `RewindEditBar`(22) | 204 | ★★ | 静态/表单为主；`LoginView` 9 state/7 写点全是本地输入 | 同上 |
| **P5** | `ImageViewer`(173) + `ChatRowBody`/`LiveRowBody` 的包装壳 | 367 | ★★★ | 写点最多（19）/ 与 live 值变化通道相邻 ⇒ 必须证明 `@Prop` 集合完全等价 | 同上 |
| **P6** | 服务层按域拆分（`pages/Index.ets:670–4873` 的 ~150 个方法）→ `core/*ops`（纯函数）+ `pages/controller` | ~3600 | ★★★★ | 这是**真正的大头**（占 56% 行数）：先把纯逻辑（无 `this`）搬去 `core/`，再搬带 `@State` 的编排层 | 逐域 `revert` |

**每阶段"门禁必绿"的固定动作**（照抄即可）：
1. 改完立刻 `bash tools/tests/run.sh` + `bash tools/typecheck/check.sh`（不等构建锁）；
2. 提交前跑**一次** `bash tools/gate.sh`，判据 = `✅ 真门禁全绿` 且 ④ `BUILD SUCCESSFUL` **十几秒级**（1 秒级 = 增量空转假绿）；
3. ⚠️ 新组件**接线后必须重跑** ④（批次13：无消费者的组件不被 ArkTS 类型检查 ⇒ "新组件 + 门禁全绿"可能是假绿）；
4. 严格 pathspec 提交（`git commit -o -F msg -- <paths>`），核 `git diff --name-only HEAD~1`；**不 push**；
5. 行为不变的三重证据：`@Prop` 集合对照表 + 判据调用点计数相等 + （设备允许时）只读 `dump`/截图对比。

## 4. 风险清单（**不能抽 / 最后抽**）

| 项 | 位置 | 理由 |
|---|---|---|
| `@StorageProp('pendingOpenChatId/Seq')` + `@Watch` | 551–559、670–1041 | 热启动深链路由，页面级生命周期语义；抽走会丢"未就绪不消费"的时序契约 |
| `safeTopVp/safeBottomVp` | 548–549 | 安全区布局，页面根容器专用 |
| **滚动所有权**：`listScroller` + `rowDs`(IDataSource) + `followBottom/userScrollFrame/listStart/rowLimit/hasHeadItem` | 560–612、2122–2193、3012–3278、6355–6420 | 若要抽必须是**整块**（组件同时持有 scroller + 数据源 + 跟随意图），否则"谁滚/谁判贴底"必然分叉；P0 刚在这条线上踩过 |
| `liveRowRef` + `liveText/liveReasoning/liveTools/liveBlocks/liveSubAgents` | 560–612、4301–4407 | 它们是 `syncFrom` 的**值变化投递通道**（V1 架构必需），与页面绑定；抽走会出现"live 行冻在首帧" |
| 弹层栈 flag 所有权（15 个 `show*`） | 339–384 | `core/overlays.topOverlay` 要求集中；组件只能吃 `visible/onClose` |
| `settings`(13 文件) / `busy`(8) / `rows`(6) | 428/308/307 | 跨模块契约名，重构期间**不改名**（改名要全仓 grep + 重跑门禁） |
| 长按菜单 + rewind | 454–495、4408–4810 | 跨 store/draft/滚动三处，最后抽 |
| `draft/attachments/cmdItems`（composer） | 407–416、3772–3873 | 与上传桥/补全/震动耦合 |
| `password/username` | 299–300 | 登录态，4 个外部文件引用 |

## 4.5 服务层按域拆的候选切面（P6 的输入，先把"大块"变成"可数的域"）

服务层 = 3600 行（56%）/ ~150 方法，散落在 670–4873。按"操作域"切成 **17 个候选域**：

| 域 | 行范围 | 行数 | 方法 | 依赖（读/写 @State） | 抽出后的落点（建议） |
|---|---|---|---|---|---|
| D1 通知深链 | 670–1041 | 372 | 16 | `pendingChatId/Seq`(Storage)+`currentChat/rows/booted/loggedIn` | **留在页面**（时序契约）｜纯解析部分 → `core/deeplinkops` |
| D2 状态装配 `syncFrom` | 1042–1433 | 392 | 8 | 117 个中的 ~60 个（写 40+） | **留在页面**（唯一 store→@State 管线）｜派生计算 → `core/pagevm`（新，纯函数） |
| D3 登录/登出 | 1434–1523 | 90 | 3 | `serverUrl/username/password/loggedIn` | `core/authops`（纯）+ 页面持有凭据 |
| D4 会话域 | 1524–1735 | 212 | 11 | `sessions/currentChat/sessQuery/...` | `core/sessionops` |
| D5 发送/取消/分页/附件 | 1736–1918 | 183 | 13 | `draft/attachments/sendMode/busy/rows` | `core/sendops` + 页面持 composer 状态 |
| D6 goal/todo 写 | 1919–2121 | 203 | 10 | `goalObjective/goalStatus/todos/pendingTodos/addingGoal` | `core/goalops` |
| D7 消息导航 | 2122–2193 | 72 | 4 | `listStart/rowLimit/hasHeadItem/rows/hasLiveRow` | ⛔ **与滚动所有权同搬**（D13/§4 第一条） |
| D8 工具/迭代展开 | 2194–2231 | 38 | 3 | `openToolKey/store` | `core/toolops` |
| D9 AskUser 提交 | 2232–2290 | 59 | 3 | `askUser/askSelections/askBusy` | `core/askops` |
| D10 插件面板 | 2291–2326 | 36 | 2 | `plugins/panelUrl/panelBusy` | `core/panelops` |
| D11 图片取字节 | 2327–2390 | 64 | 3 | `imageUrl/imageBusy/imgW/imgH/viewW/viewH` | `core/imgops`（已部分存在） |
| D12 会话管理/分组 | 3437–3771 | 335 | ~12 | `sessions/collapsedGroups/mediaOnly/...` | `core/sessionops`（与 D4 合并） |
| D13 输入体验 | 3772–3873 | 102 | ~6 | `draft/cmdItems/cmdToken/composerFocused` | `core/composerops`（与 D5 同组） |
| D14 设置域 | 3874–4026 | 153 | ~8 | `settings/showPrefs/themeName/...` | `core/settingsops`（⚠️ `settings` 是 13 文件契约名，**不改名**） |
| D15 面板域（定时/后台/子代理/Runner） | 4027–4259 | 233 | ~9 | `cronTasks/bgTasks/subagents/runners/panelTab` | `core/panelsops` |
| D16 帧内变更判定 | 4260–4300 | 41 | ~2 | 无（纯） | ✅ **已可立刻直搬** `core/framediff`（零风险样板） |
| D17 live 同步（`syncRowDs/syncLiveTail`） | 4301–4407 | 107 | ~4 | `rows/hasLiveRow/liveRowRef/liveText/.../rowDs` | ⛔ **与滚动所有权同搬** |
| D18 消息操作（长按） | 4408–4620 | 213 | ~10 | `ctxMenu/ctxTarget/draft/...` | `core/msgops`（已是契约文件，谨慎） |
| D19 rewind | 4621–4810 | 190 | ~7 | `rewindEditRowId/draft/rows` | `core/rewindops` |
| D20 主题/强调色/MD 主题/i18n | 4811–4873 | 63 | ~6 | `themeName/accent/fontScale/localeId` | `core/themeops` |
| D21 `@Builder` 入参包装 | 5829–6106 | 278 | 12 | 只读（`currentModelName/ctxText/statusBarText/pal`…） | ✅ **并入 L1 组件的 `@Prop` 装配**，不必单独成模块 |

**必须一起搬（否则判据分叉）的组**：
1. `{D1 通知深链, D2 状态装配}` —— "未就绪不消费 pending"的时序跨两者；
2. `{D7 消息导航, D17 live 同步, 滚动所有权(listScroller/rowDs/followBottom/rowLimit/hasHeadItem)}` —— `listStart`/`hasHeadItem`/`rowDs` 三者互为判据，分开必分叉；
3. `{D5 发送, D13 输入体验}` —— 共用 `draft/attachments/sendMode`；
4. `{D4 会话域, D12 会话管理/分组}` —— 共用 `sessions/currentChat` 与 `core/sessiongroup`；
5. `{D3 登录, D14 设置}` —— 登录成功后 `loadSettings()` 才使 `settings` 非空，`surfaceApplied`/`reasoningDefaultApplied` 的一次性语义跨两者。

**P6 拆完后的目录/类拓扑（目标形态）**：
```
core/                       纯逻辑（无 ArkUI 全局；run.sh 当纯 TS 编译）
  toolstatus · streammerge · listfollow · indicators · overlays · sessionpick · rowdiff · msgindex · statusfmt   （既有，唯一判据）
  pagevm.ets        ← 新：store → VM 的**纯**派生（statusBarText/ctxText/goalLine/currentModelName…）
  framediff.ets     ← 新（可由 D16 直接搬，零风险）
  sendops / sessionops / goalops / toolops / askops / panelops / settingsops / panelsops / rewindops / themeops  ← 新：域编排的**纯决策**部分
components/                  L1：@Component + @Prop 入/回调出（sheets/panels/viewers/message rows）
pages/Index.ets              L2：①生命周期+深链路由 ②调 core 的装配函数写 @State ③弹层栈所有权 ④滚动所有权
```
> ⚠️ `core/*.ets` **不许** import ArkUI 全局（`run.sh` 会 TS2307）；凡涉及 `Scroller/anim/transition/IDataSource` 的方法
> **只能**留在 L2 或搬进 L1 组件 ⇒ 上表里 D7/D17 的"同搬"目标是**一个组件**（`components/MessageListView`），不是 core 模块。
> P6 动手前需另出一份逐域方案（本表是切面清单，不是执行许可）。

## 5. 建议先抽：`StatusSheet`（`Index.ets:5869–5948`，80 行）

理由（都可由上表核对）：
- **状态面最小**：只读 4 个（`usage/cwd/showStatus/showModel`），写点只有 2 个（`showStatus=false`、`showModel=true`）；
- **零外部耦合**：不碰 store、不碰 `rows/busy/settings`，不在 §1.4 的跨文件名单里；
- **无滚动/无弹层栈语义**：可见性由页面给它 `visible`，返回键语义仍在页面（`topOverlay` 不动）；
- **可验证**：一张"详情"面板截图（打开/关闭）+ `dump` 文本对比即可证明行为不变；
- **可回滚**：新增 1 个文件 + 页面 2 处替换，`git revert` 一键还原。

阶段 1 的落地形状（待批准后执行）：
```ts
// components/StatusSheet.ets（新）
@Component export struct StatusSheet {
  @Prop visible: boolean; @Prop usage: UsageInfo; @Prop cwd: string;
  @Prop theme: string;  @Prop todoCount: number; @Prop goalLine: string;
  onOpenModel: () => void = () => {};   // ⛔ 不把 showModel 所有权搬进来
  onClose: () => void = () => {};
}
// pages/Index.ets：@Builder StatusSheet() → 删除；改为 StatusSheet({ visible: this.showStatus, … })
```
