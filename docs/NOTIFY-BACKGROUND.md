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

**mutation 自证（改坏必红；已实测）**

| 注入 | 期望 | 结果 |
|---|---|---|
| `module.json5` 加 `KEEP_BACKGROUND_RUNNING` | '零权限' 红 | ✅ 红 |
| `EntryAbility` 注掉 `ensureReconcileScheduled(this.context)` | '注册恰 1 处' 红 | ✅ 红 |
| `schedule.ets` 把 `isPersisted: true` → `false` | 'isPersisted 恰 1 处' 红 | ✅ 红 |
| `reconcile.ets` 改 `RECONCILE_ABILITY` 常量值 | '扩展名同源' 红 | ✅ 红 |
| `reconcile.ets` 加 `import … from '@ohos.x'` | 'core 无 @ohos import' 红 | ✅ 红 |
| 上述全部回退（不注入） | 全绿 | ✅ 绿 |

## 6. 诚实台账

### 6.1 已知缺口（本线**只上报，不改** —— 修复点不在本线域内）

| 缺口 | 证据 | 影响 | 修复点（**越界**） |
|---|---|---|---|
| **`markSeen` 全仓 0 消费点** | `core/reconcile.ets:130` 定义；`grep -rn 'markSeen' entry/src` 仅命中定义本身 | ⛔ **前台从不记录"亲眼见过的回合"** ⇒ 备忘里的 `lastSeenTurnKey` 只由扩展自己维护 ⇒ 用户**前台读完再切后台**，首次对账会把**已看过**的回合**误报**成"新消息"（假阳性）。这正是本仓"死消费"血教训（钉"方法体存在"会假绿） | `core/reconcile.ets` / `workreconcile/**` / `pages/Index.ets`（**均不在本线域**）。⇒ 见 §7 越界声明 |
| **`cancelReconcileScheduled` 全仓 0 调用点** | `workreconcile/schedule.ets:83` 定义；全仓仅定义处 | 登出后后台对账**未取消**（会继续按 15min 唤醒、拉一次 `history`，最坏是"已登出仍排任务"） | `pages/Index.ets`（登出路径）/ 或某 core 登出点 |

> 测试里对这两项打 **`⚠ [known-gap]`** 日志（不判红——真树当前就是 0 消费；修好会自动翻绿），保证"缺口不会被静默"。

### 6.2 待设备验证（**未验**，只读核实过）

| 项 | 为什么只能真机 |
|---|---|
| 系统**实际唤醒间隔**是否接近 15min | 受 Doze/省电/内存策略影响，SDK **未承诺**周期 |
| 扩展进程能否读到前台写入的 `xbot_settings` 仓里的 cookie | 跨进程 `preferences` 可读性未验 |
| `askId` 后台能否判定 | 本期恒传空串（前台 `askUser` 来自 SSE 事件，后台无该事件；从 `/api/history` 单独推待答**未验证**） |
| 短时任务**当日配额**（`remainingQuota`）实际值与"每次切后台开窗"的可行性 | 需设备读数（不碰设备，本轮未做） |
| `onWorkStop` 超时 2 分钟语义 | `@ohos.WorkSchedulerExtensionAbility.d.ts:71` 注释原文，未实机观察 |

## 7. 越界声明

| 项 | 说明 |
|---|---|
| **改动文件** | 仅 `tools/tests/notify_background.test.ts`（新建）+ `docs/NOTIFY-BACKGROUND.md`（新建）。**未改**任何 `core/*`、`entryability/*`、`module.json5`、`workreconcile/*` |
| **发现但未修（越界）** | ① `markSeen` 0 消费点（修复点 = `core/reconcile.ets`/`workreconcile`/`pages/Index.ets`，**非本线域**）；② `cancelReconcileScheduled` 0 调用点（同上）。二者**均需另行派单** |
| **不动设备** | 全程无 `hdc`/`uitest`/`deploy.sh`/装机/`aa start`；需设备项一律记入 §6.2 |
| **未 push** | 仅本地 `commit`（严格 pathspec） |
