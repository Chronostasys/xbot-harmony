# NOTIFY-BACKGROUND.md —— 目标①决策与落地：后台「极轻量接收 agent 通知」

> 用户原话（目标①）：「最好能后台注册一个**极其轻量**的任务接收 agent 通知」。
>
> 本文是**通知/后台能力面**的**收敛真源**：候选枚举 → 逐条能力边界（SDK `file:line`）→ 决策表 →
> 已落地实现 → 机器判据 → 诚实台账。**权威依据 = 本机 SDK 的 `.d.ts`**（唯一真相）：
> 路径前缀 `~/ohos-cli/command-line-tools/sdk/default/openharmony/ets/api/`（OH 侧）与
> `~/ohos-cli/command-line-tools/sdk/default/hms/ets/`（HMS/PushKit 侧）。门限 = **`compatibleSdkVersion 6.0.1(21)`**。
>
> 互补（不重复）：`docs/NOTIFY.md`（通知能力面）、`docs/NOTIFY-ACCEPTANCE.md`（真机验收清单）、
> `docs/PATCHES/background-notify.md`（B/C 档 **diff 级 patch，未落地**，需用户同意改权限面）。
> 机器判据：`tools/tests/notify_background.test.ts`（调用点计数 + 零扫描判红，已 mutation 自证）。

## 0. 一句话结论

**可以。** 在"**零权限 + 不改服务端**"两条约束下，"后台注册一个极其轻量的任务接收 agent 通知"的
**唯一最轻路径** = **`workScheduler` 延迟任务**：由系统按周期**批处理唤醒**一个
`WorkSchedulerExtensionAbility`，**只读**拉一次服务端快照、判定"有没有你没见过的已完成回合"，有就发一条通知。
它 **① 不需要任何权限**、**② 不挂常驻通知**、**③ 不碰前台主链路**；代价是**迟到**（系统调度、**不保证准时**）。

> ⛔ 要做到「**实时**且**杀进程也能收**」⇒ **必须服务端推送**（Push Kit，见 §2-D3）——**本仓做不到**（需 AGC + 服务端经华为通道下发）。本文件的结论是：**"后台注册"这件事本身可做且已做**；"实时"是另一件事。

## 1. 现状（已落地的两条后台路径，2026-10-11）

| 路径 | 代码位置 | 何时/如何触发 | 能力上限（诚实） |
|---|---|---|---|
| **短时任务窗（A 档）** | `core/notify.ets` `beginTurnKeepAlive`/`endTurnKeepAlive`（`requestSuspendDelay`） | **仅在"用户发消息"这一瞬**申请（调用点在 `pages/Index.ets`） | 后台 **≤3 分钟**内 SSE 仍活 ⇒ **实时**通知；窗外被冻结 |
| **延迟任务对账（本目标正向落地）** | 注册 `workreconcile/schedule.ets`；执行 `workreconcile/NotifyReconcileAbility.ets`；纯判定 `core/reconcile.ets` | 系统按 `repeatCycleTime = 15min` **批处理唤醒** | 唤醒时**只读** `POST /api/history` ⇒ 判"你不在时的已完成回合" ⇒ 发**一条聚合**通知（`summarizeMissed`） |

**接线与声明（3 处，均已落地）**

- `entryability/EntryAbility.ets:72` —— `ensureReconcileScheduled(this.context)`（在 `onCreate`，**旁路**：失败只记日志）。
- `entry/src/main/module.json5` —— `extensionAbilities[].type = "workScheduler"`（**无 `requestPermissions` 变更**）。
- `entry/src/main/ets/core/reconcile.ets` —— `RECONCILE_ABILITY`（扩展名，与 `module.json5` **逐字一致**）。

**本仓门禁保证的形态不变量**（`tools/tests/notify_background.test.ts` 逐条断言，见 §5）。

## 2. 候选枚举 + 能力边界（逐条 SDK `file:line`）

| # | 路径 | 是什么 | 能力边界（证据 = SDK `file:line`） |
|---|---|---|---|
| **A** | **短时任务** `requestSuspendDelay` | 申请"**单次**后台短窗"，窗内进程**不被冻结** | `@ohos.resourceschedule.backgroundTaskManager.d.ts:650`（**无 `@permission`**）；到期回调**提前约 6 秒**（`:636`）；`DelaySuspendInfo.actualDelayTime`（`:263`）——*"maximum duration …**3 minutes** in normal cases…low battery …**1 minute**"*（`:275-277`）；当日剩余配额 `TransientTaskInfo.remainingQuota`（`:298`，since 20，**配额制**） |
| **B** | **长时任务** `startBackgroundRunning`（continuousTask） | 后台**保活一段时间**（跨后台） | `backgroundTaskManager.d.ts:734`（`@permission ohos.permission.KEEP_BACKGROUND_RUNNING`，`:708`）；被拒抛 **201**、非系统应用 **202**（`:718-719`）；**成功即挂一条常驻通知**（*"there will be a notification message without prompt tone"*，`:702`）；`BackgroundMode`（`:1116`）**无"聊天/长连"档**，仅 `DATA_TRANSFER=1`(`:1133`)/`AUDIO_PLAYBACK=2`(`:1152`)/…；`DATA_TRANSFER` **10 分钟无进度更新即被系统取消**（`:1116` 区块注释） |
| **C** | **延迟任务** `workScheduler` | 系统**周期性唤起**扩展跑一小段 | `@ohos.resourceschedule.workScheduler.d.ts:210` `startWork`（**无 `@permission`**）；`WorkInfo`：`isPersisted`(`:73`)、`repeatCycleTime`(`:134`)、`isRepeat`(`:145`)、`earliestStartTime`(`:191`，**@since 22 ⇒ 本工程 21 不可用**)；扩展 `@ohos.WorkSchedulerExtensionAbility.d.ts:60` `onWorkStart` / `:71` `onWorkStop`（**超时 2 分钟**触发） |
| **D1** | `ServiceExtensionAbility` 常驻 | 常驻后台服务 | ⛔ **三方不可用**（平台策略；与 `core/notify.ets` 顶注一致）。SDK 里也只有 `AppServiceExtensionAbility`/广告类，无面向三方的常驻 SA 扩展 |
| **D2** | `NotificationSubscriberExtensionAbility` | 订阅**本机通知**（可穿戴伴侣转发） | ⛔ **本工程不可用**：`@since 22` > 本工程 pin 21（`@ohos.application.NotificationSubscriberExtensionAbility.d.ts:36`）；且用途是**转发本机通知**，非"接收 agent 消息" |
| **D3** | **Push Kit**（服务端推送） | App 死也能**实时**收推送 | ⚠️ **SDK 有；本工程现状不可用**。`hms/ets/kits/@kit.PushKit.d.ts`；`@hms.core.push.pushService.d.ts:123` `getToken` / `:228` `receiveMessage`（since 4.0.0(10)）。**必须** AGC 侧配置应用 + **服务端经华为通道下发**（⇒ **需服务端改动**）。`RemoteNotificationExtensionAbility` 是 *"lightweight, independent child process and is **not allowed to wake up the main process**…lasting **less than 10 seconds**"*（`:21-27`）⇒ 只能替换通知内容，**跑不了我们的逻辑**；`PushExtensionAbility` *"available only to **system apps**"*（`:34`） |
| **E** | **代理提醒** `reminderAgentManager` | 定时提醒（倒计时/日历/闹钟） | ⚠️ **不是事件驱动** ⇒ 不适用。`@ohos.reminderAgentManager.d.ts:26-27`（*"scheduled reminders for countdown timers, calendar events, and alarm clocks"*）；`ReminderType` 仅 `TIMER/CALENDAR/ALARM`（`:349-370`）；触发靠 `triggerTimeInSeconds`（`:886`）**定时**、需 `@permission ohos.permission.PUBLISH_AGENT_REMINDER`（`:43`）。它**不能**把"服务端来了新消息"这个**事件**送达应用 |
| **F** | `backgroundProcessManager` | 压制**子进程**优先级省电 | ⛔ **N/A**：*"take effect **only for the child processes** created through `OH_Ability_StartNativeChildProcess`"*（`@ohos.resourceschedule.backgroundProcessManager.d.ts:22-23`）⇒ 管不到我们的主 JS 进程 |
| **G** | `setProcessPriority` / `setPowerSaveMode` | 调进程优先级/省电模式 | ⛔ 同 F（子进程语义）；`setPowerSaveMode` 还需 `BACKGROUND_MANAGER_POWER_SAVE_MODE`（`:118`）。**不能**用来"免冻结"主进程 |

## 3. 决策表

| 路径 | 可用性（本工程/SDK21） | 依赖 | 是否需服务端 | 需权限 | 用户可见副作用 | 实时性 | 建议 |
|---|---|---|---|---|---|---|---|
| **A 短时任务** | ✅ 已落地 | 无 | ❌ | **无** | 无 | 窗内**实时** | ✅ **维持** |
| **B 长时任务** | ⚠️ 能做但代价大 | `KEEP_BACKGROUND_RUNNING` + `backgroundModes` | ❌ | **有**（且用户可见） | **常驻通知** + 耗电；10min 无传输被取消 | 保活期实时 | ⚠️ **需用户拍板**（改权限面）；无"聊天"档 ⇒ 语义不符、有被挂起风险 |
| **C 延迟任务（workScheduler）** | ✅ **已落地** | 无 | ❌ | **无** | 无（迟到） | ❌ **不保证准时** | ✅ **本目标推荐并已落地** |
| **D1 常驻 Service** | ⛔ 三方不可用 | — | — | — | — | — | ⛔ 不可行 |
| **D2 通知订阅扩展** | ⛔ API22 > 21 | — | — | — | — | — | ⛔ 不可行 |
| **D3 Push Kit** | ⚠️ SDK 有，工程未接 | AGC + **服务端下发** | ✅ **必需** | AGC 配置 | 通知 | ✅ **实时（含被杀）** | ⚠️ **唯一能覆盖"被杀"，但属服务端/AGC 的活** |
| **E 代理提醒** | ⚠️ 存在但语义不符 | — | ❌ | `PUBLISH_AGENT_REMINDER` | 定时通知 | ❌ 定时非事件 | ⛔ 不适用 |
| **F/G 进程管理** | ⛔ 子进程语义 | — | — | — | — | — | ⛔ 不可行 |

**⇒ 推荐（且已落地）的一条**：**C 延迟任务对账**，与既有 **A 短时任务窗**叠加：
- **A 覆盖**："用户刚发消息就切后台"的 ≤3 分钟实时窗；
- **C 兜底**："冻结期/被杀期完成"的**迟到补发**（跨会话汇成一条摘要）；
- **D3 才能真正"实时 + 被杀也收"** ⇒ 需服务端，超出本仓。

## 4. 为什么**没有**落地"更强"的路（决策留痕）

| 被否选项 | 否决理由（可复核） |
|---|---|
| **B 长时任务保活 SSE** | 改 `module.json5` **权限面**（须用户同意）；**成功即挂常驻通知**（用户可见副作用）；`BackgroundMode` **无聊天档** ⇒ 只能用语义不符的 `DATA_TRANSFER`（10min 无真实传输被取消）；SDK 明确"检测到未实际执行对应业务会被 suspend"。**收益不抵代价** |
| **把短时任务窗挂到 `onBackground`（每次切后台都开窗）** | 技术上合法（零权限），能补"直接按 HOME"的窗。**BUT 否决**：短时任务是**当日配额制**（`TransientTaskInfo.remainingQuota`，`:298`）⇒ 频繁切后台会**耗尽配额**，反而**饿死已验证可用的"用户发消息"窗**（回归风险）；且无法在**不碰设备**的前提下验证配额余量。⇒ **记为"待设备验证后再议"，本轮不落地** |
| **把窗挂到"SSE 收到 busy 时"** | 逻辑自锁：应用被冻结后**根本收不到那个事件**（`docs/NOTIFY-ACCEPTANCE.md §10.5` 已论证） |
| **自绘常驻通知 + 前台服务组合** | 依赖 B 的权限面与常驻通知；且"前台服务"在三方无对应 SA 扩展 ⇒ 不可行 |

## 5. 判据（可红 · 已 mutation 自证）

`tools/tests/notify_background.test.ts`（离线、不碰设备）盯**接线与形态**，全部用**调用点计数**（钉"方法体存在"会假绿）：

- **零权限铁律**：`module.json5` **不含** `KEEP_BACKGROUND_RUNNING` / `PUBLISH_AGENT_REMINDER` / `backgroundModes`；声明权限数**恰 3**。
- **注册真接线**：`EntryAbility` 里 `ensureReconcileScheduled(` **恰 1 处**调用、落在 `onCreate` 内（防"只 import 不调用"）。
- **扩展名同源**：`module.json5` 的扩展 `name` 与 `core/reconcile` 的 `RECONCILE_ABILITY` 常量**逐字一致**；`type=workScheduler`；`srcEntry` 指向真实文件。
- **纯判定层纯度**：`core/reconcile.ets` **无** `@ohos.*`/`@kit.*` import、**无** ArkUI 装饰器。
- **注册参数**：`isRepeat: true` / `isPersisted: true` / `networkType` **各恰 1 处**；`workScheduler.startWork(` 恰 1 处。
- **A 档在线**：`requestSuspendDelay(` 恰 1 处；`endTurnKeepAlive` 在 EntryAbility 有消费点。
- **防门禁⑧假绿**：`reconcileDecision(`/`summarizeMissed(`/`turnKeyOf(` 在扩展里均有真实消费点。
- **尊重 DND**：通知面全仓**不出现** `bypassDnd`。
- **死消费 #1（前台记已见回合）**：`memo.ets` 里 `markSeen(memo,` **恰 1**；`markSeen` 全仓真消费点 **≥1**；
  `store.ets` 调 `noteForegroundSeen(` **恰 1**；`noteForegroundSeen` 真调端口 `foregroundSeenSink(`；
  `EntryAbility` 注册 `setForegroundSeenSink(` **恰 1** 且落在 `markForegroundSeen(`。
- **死消费 #2（登出/清场取消对账）**：`cancelReconcileScheduled` 全仓真调用点 **恰 1**；
  `EntryAbility` 调 `cancelReconcileScheduled();` **恰 1** + 注册 `setSessionClearedHook(` **恰 1**；
  `clearAll` 函数体内调 `sessionClearedHook()` **恰 1**；`clearAll` 仍有真实调用方（`store.ets`）。
- ⛔ 计数类断言一律走 **`readS()`（read + 剥注释）**：否则"把调用注释掉"仍会被算进去（**假绿**，本笔实测踩到并修正）。

**mutation 自证（改坏必红；已实测）**

| 注入 | 期望 | 结果 |
|---|---|---|
| `module.json5` 加 `KEEP_BACKGROUND_RUNNING` | '零权限' 红 | ✅ 红 |
| `EntryAbility` 注掉 `ensureReconcileScheduled(this.context)` | '注册恰 1 处' 红 | ✅ 红 |
| `schedule.ets` 把 `isPersisted: true` → `false` | 'isPersisted 恰 1 处' 红 | ✅ 红 |
| `reconcile.ets` 改 `RECONCILE_ABILITY` 常量值 | '扩展名同源' 红 | ✅ 红 |
| `reconcile.ets` 加 `import … from '@ohos.x'` | 'core 无 @ohos import' 红 | ✅ 红 |
| `store.ets` 注掉 `noteForegroundSeen(...)` | '前台侧恰 1 处' 红 | ✅ 红 |
| `memo.ets` 注掉 `markSeen(memo, …)` | 'markSeen 恰 1 处真调用' 红 | ✅ 红 |
| `notify.ets` 注掉 `clearAll` 里的 `sessionClearedHook()` | 'clearAll 真的调了端口' 红 | ✅ 红 |
| `EntryAbility` 注掉 `cancelReconcileScheduled();` | '恰 1 调用点' 红 | ✅ 红 |
| `EntryAbility` 注掉 `setForegroundSeenSink(` 注册 | '注册恰 1 处' 红 | ✅ 红 |
| 上述全部回退（不注入） | 全绿（40 passed） | ✅ 绿 |

> **判别力边界（诚实）**：本判据是**形态/接线**级。改*语义*（如把 `if (sessionClearedHook !== null)`
  改成 `if (false)`）**测不出来** —— 调用文本仍在。这类必须靠**真机行为**验收（§6.4）。

## 6. 诚实台账

### 6.1 两条「死消费」缺口 —— **已修**（2026-10-11，`6d07587`）

| 缺口 | 后果 | 修法（端口式，`core/` 仍无 `@ohos.arkdata` 依赖） |
|---|---|---|
| **`core/reconcile.markSeen` 全仓 0 消费** | 前台从不记录"用户亲眼见过的回合" ⇒ 备忘 `lastSeenTurnKey` 只由扩展自维护 ⇒ 用户**前台读完再切后台**，首次对账把**已看过**的回合**误报**成"新消息"（假阳性） | `core/store.ets`（`applyHistoryMeta`，**唯一**同时握有 `chat_id`+`last_seq` 的既有事件）→ `core/notify.noteForegroundSeen(chatId, lastSeq)`（端口 + 前台闸）→ `EntryAbility` 注册的 sink → `workreconcile/memo.markForegroundSeen` → **`markSeen`** → 落盘 |
| **`workreconcile/schedule.cancelReconcileScheduled` 全仓 0 调用** | 登出/换账号后后台对账仍带着旧会话空跑（读不到 cookie 只是静默跳过 —— 非设计意图） | `core/notify.clearAll`（本仓"整机清场"**唯一既有出口**；`store.ets` 在 401 时调它）→ 端口 `sessionClearedHook()` → `EntryAbility` 注册 → `cancelReconcileScheduled()` |

**关键取证（turnKey 必须同源）**：`turnKey = turnKeyOf(chatId, lastSeq)`（`core/reconcile.ets:141`）。
扩展 `fetchMark` 的取数 = `/api/history` 响应的 `data.chat_id` + `data.last_seq`
（`workreconcile/NotifyReconcileAbility.ets`）⇒ **前台必须用同一对字段**才对得上；
`store.applyHistoryMeta(data)` 恰好同时持有二者（`store.ets:705`）。
⚠️ 备忘用 `last_seq` **不违反**既有的 "绝不写进 `ChatState.lastSeq`"（那是 **per-Run 事件水位**，
旧 P0 根因）—— 两者是**不同用途**，本笔只喂**对账备忘**。

### 6.2 仍存缺口：**显式登出未接线**（`pages/Index.ets` 独占 ⇒ 见 §6.3 patch）

`clearAll` 覆盖的是 **401 / 换账号**（`store.ets:322`）；**用户主动点"登出"**（`Index.ets: doLogout`）
**不经过** `clearAll` ⇒ 那条路径下后台对账不会被取消。最小 patch 见 §6.3。

### 6.3 给持 `pages/Index.ets` 者（`light-fix3`）的最小 patch

> 上下文：`Index.ets:1929 doLogout()`，`await this.config.clearSession();`（`:1939`）之后插 1 行。

```diff
--- a/entry/src/main/ets/pages/Index.ets
+++ b/entry/src/main/ets/pages/Index.ets
@@ 文件头 import 区（现有 `import { … } from '../core/notify';` 之后）
 import { beginTurnKeepAlive, endTurnKeepAlive, ensureEnabled, notificationsEnabled, PENDING_CHAT_KEY, PENDING_CHAT_SEQ_KEY, PENDING_ACTION_KEY, isKnownNotifyAction, NOTIFY_ACTION_STOP, NOTIFY_ACTION_CONTINUE } from '../core/notify';
+import { cancelReconcileScheduled } from '../workreconcile/schedule';
@@ private async doLogout()
     await this.config.clearSession();
+    // 目标①(a)：显式登出**也要**取消后台对账延迟任务（否则它带着旧会话继续空跑；幂等+失败静默）。
+    cancelReconcileScheduled();
     // 清空多会话池（每个 store 都要关 SSE，否则会留下后台连接）
     const poolKeys: string[] = Array.from(this.pools.keys());
```

**为什么不在 `clearAll` 里顺手补**：`clearAll` 只清**通知**，登出**未必**调它（现行为不调）
⇒ 不能假设"登出 = clearAll"。本 patch 直接调 `cancelReconcileScheduled()`（幂等、内部 try/catch，
登出页/登录页跳转时执行一次即可）。

### 6.4 待设备验证（**未验**，只读核实过）

| 项 | 为什么只能真机 |
|---|---|
| 系统**实际唤醒间隔**是否接近 15min | 受 Doze/省电/内存策略影响，SDK **未承诺**周期 |
| 扩展进程能否读到前台写入的 `xbot_settings` 仓里的 cookie | 跨进程 `preferences` 可读性未验 |
| **前台与扩展的 turnKey 真能对上**（`/api/history` 两处 `chat_id`/`last_seq` 同源） | 端点行为，只能真机/联调观察 |
| `askId` 后台能否判定 | 本期恒传空串（前台 `askUser` 来自 SSE 事件，后台无该事件） |
| 短时任务**当日配额**（`remainingQuota`）实际值与"每次切后台开窗"的可行性 | 需设备读数（不碰设备，本轮未做） |
| `onWorkStop` 超时 2 分钟语义 | `@ohos.WorkSchedulerExtensionAbility.d.ts:71` 注释原文，未实机观察 |

## 7. 越界声明

| 项 | 说明 |
|---|---|
| **改动文件（本续做笔 `6d07587`）** | `core/notify.ets`、`core/store.ets`、`entryability/EntryAbility.ets`、`workreconcile/NotifyReconcileAbility.ets`、**新增** `workreconcile/memo.ets`、`tools/tests/notify_background.test.ts`。⛔ **未改** `pages/Index.ets`（light-fix3 独占）、`module.json5` |
| **`core/store.ets` 越域说明** | 前台唯一同源取数点在 `applyHistoryMeta` ⇒ 只加 1 行调用（+1 import）。改动最小、可单独 revert |
| **交给 `light-fix3` 的 patch** | §6.3（显式登出取消对账），**我未落** |
| **不动设备** | 全程无 `hdc`/`uitest`/`deploy.sh`/装机/`aa start`；需设备项一律记入 §6.4 |
| **未 push** | 仅本地 `commit`（严格 pathspec） |
