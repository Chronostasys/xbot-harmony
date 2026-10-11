# NOTIFY.md —— 通知能力专项（能力清点 / SDK 实证 / 后台接收明账）

> 用户原话：「通知功能支持：调研鸿蒙 OS 的通知能力，支持最专业的应用通知，最好能后台注册一个
> **极其轻量**的任务接收 agent 通知」。
>
> **权威依据**：本机 SDK 的 `.d.ts`（唯一真相）。路径前缀
> `~/ohos-cli/command-line-tools/sdk/default/openharmony/ets/api/`（OH 侧）与
> `~/ohos-cli/command-line-tools/sdk/default/hms/ets/`（HMS/PushKit 侧）。
> 门限 = `build-profile.json5` 的 `compatibleSdkVersion 6.0.1(21)`。
>
> 相关：`entry/src/main/ets/core/notify.ets`（实现）、`docs/PATCHES/background-notify.md`
> （B/C 档可落地 patch，本文与它互补、不重复）。

## 1. 一句话结论

- **原生端已落地「本地通知 + 短时任务兜底」（A 档）** —— web 端**没有**系统通知 ⇒ 原生做系统通知
  本身就是**超越 web**；用户切走之后仍能被"回合完成 / 智能体在等回答"叫回来。
- **后台「常驻接收」在本 SDK + 本工程约束下不可行**（证据见 §4）：三方无 `ServiceExtensionAbility`；
  `NotificationSubscriberExtensionAbility` 要 API ≥ 22（本工程 21）；`WorkScheduler` 非实时且由系统调度。
- **本次（2026-10-11）新增**：① 长文本形态 `LONG_TEXT`（单段长回复容量 1024→3072 字节，不再丢内容）；
  ② `wantAgent` since11 新字段 vs 旧字段的**退路**写清；③ 修正 `PATCHES` 文档"本 SDK 不含 Push Kit"的**误判**。

## 2. 现状能力清点（`core/notify.ets`）

| 能力 | 位置 | 说明 |
|---|---|---|
| 通知档位判定 | `notifyKindForSse:465` / `shouldNotify:450` | 与状态机**同源**（看 `normalizeEvent` 的 `phase_done`），脱机可测 |
| 前台抑制 | `appIsForeground:854` + `shouldNotifyWithPrefs:437` | 用户正看着屏幕 ⇒ 不发（安静） |
| 按会话通知 id | `notificationIdFor:141`（FNV-1a） | 同会话**更新**那一条、异会话**并存**（不互相覆盖） |
| 未读角标 | `UnreadCounter:192` + `syncBadge:233` + `badgeFromCounts:181` | 与系统 `getActiveNotificationCount` **对账**，通知↔角标同生共死 |
| 通知正文形态 | `notifyShapeFor:736` + `notifyBodyPlan:805` | basic / multiline / **long_text** 三档；超容量**优雅退化**（"…完整内容见应用内"） |
| 动作按钮 | `notifyActionsFor:355` + `NOTIFY_MAX_ACTIONS:331` | 「查看」= `START_ABILITY + parameters{chat_id}` 直达（≤2 枚） |
| slot 分级 | `slotTagFor:881` + `slotTypeOf:886` | ask → SOCIAL_COMMUNICATION（横幅+响铃）；turn_done → CONTENT_INFORMATION（静默） |
| 授权 | `ensureEnabled:944` / `notificationsEnabled:965` | 首次在 `loadContent` 后请求（需已就绪的 UIAbility 上下文） |
| 点击回跳 | `publishTurn:1022` 的 `wantAgent` + `EntryAbility.captureOpenChat` | 冷启动 `onCreate` / 热启动 `onNewWant` 都收 `chat_id` + `notify_action` |
| 清理 | `clearAll:1132` / `clearForChat:1160` / `reconcileOnForeground:1190` | 按分组/按会话清；回前台只清"用户即将看到的那条" |
| 短时任务兜底（A 档） | `beginTurnKeepAlive:1213` / `endTurnKeepAlive:1248` | `requestSuspendDelay`（≤3 分钟，免权限），兜住"发完消息立刻切后台" |

**接线**（页面侧，非本文件）：`pages/Index.ets` 消费 `pendingOpenChatId`/`pendingOpenChatSeq`、
发送时 `beginTurnKeepAlive()`、回合结束 `endTurnKeepAlive()`；`onPageShow` 调 `sse.forceReconnect()` 强制探活。

## 3. 「专业通知」能力面（SDK 实证）

| 专业点 | 本 SDK 依据（file:line） | 本项目状态 |
|---|---|---|
| **slot 分级**（决定状态栏图标/横幅/响铃） | `SlotType`（`@ohos.notificationManager.d.ts:1050-1117`）：SOCIAL_COMMUNICATION=LEVEL_HIGH、CONTENT_INFORMATION=LEVEL_MIN；`SlotLevel`（`:1198-1236`） | ✅ 按档位换 slot（`slotTagFor`） |
| **内容形态** | `ContentType`（`:1126-1188`）；`NotificationContent`（`notification/notificationContent.d.ts:446-502`） | ✅ basic / **long_text** / multiline 三档 |
| **长文本**（整段，≤3072 字节） | `NotificationLongTextContent`（`notificationContent.d.ts:96-125`） | ✅ **本次新增**（单段长回复不丢内容） |
| **多行**（≤3 行，每行 ≤1024 字节） | `NotificationMultiLineContent`（`notificationContent.d.ts:146-175`） | ✅ 多段正文走它（保用户行结构） |
| **动作按钮**（≤2 枚，各带 `wantAgent`） | `actionButtons`（`notification/notificationRequest.d.ts:291-298`，since 7） | ✅ 「查看」，直达会话 |
| **点击回跳**（`wantAgent`） | `WantAgentInfo`（`wantAgent/wantAgentInfo.d.ts:33-112`）：`actionType`/`actionFlags`（since 11）、旧 `operationType`/`wantAgentFlags`（deprecated since 11，:52-53/:81-82） | ✅ 用 since11 字段 + 注释写清退路（`startAbilityAgent:991`） |
| **分组折叠** | `groupName`（`notificationRequest.d.ts:331-340`，since 8） | ✅ 全部归 `xbot.chat` 一组 |
| **自动过期** | `autoDeletedTime`（`notificationRequest.d.ts`） | ✅ 10 分钟（`AUTO_DELETE_MS`） |
| **同 id 更新不重复响铃** | `isAlertOnce`（`notificationRequest.d.ts`） | ✅ turn_done 去重（phase_done + session idle 会各来一次） |
| **未读角标（与系统同源）** | `getActiveNotificationCount`（`@ohos.notificationManager.d.ts:556-572`；官方原文 "unread notification count prompt"）、`setBadgeNumber`（`:860-886`） | ✅ `syncBadge` 系统读数优先 |
| **按分组/按 id 清理** | `cancelGroup`（`:644-665`）、`cancel(id,label?)`（`:234`，缺 label 命中我们的通知） | ✅ 登出 `cancelGroup`；进会话 `cancel(id)` |
| **授权（读真值 + 请求）** | `isNotificationEnabled`（`:501-536`）、`requestEnableNotification(ctx)`（`:752-799`） | ✅ 设置开关反映**系统真值** |
| **免打扰（DND）** | `NotificationSlot.bypassDnd`（默认 false） | ⛔ **刻意不设** —— 尊重系统免打扰（不绕过） |
| **大图 / 实况窗（LiveView）** | `NotificationPictureContent`（`notificationContent.d.ts:196-221`）；`NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW`（`:1171-1179`，"三方不能直接创建"） | ➖ **不适用**：聊天提醒无合适大图；LiveView 三方受限 |

## 3.9 后台对账（`workScheduler` 延迟任务）—— 客户端上限方案（2026-10-11 落地）

判决见 `docs/NOTIFY-ACCEPTANCE.md §10`：后台被冻结 ⇒ SSE 进不来 ⇒ 既有链路必然无通知。
服务端推送（唯一能覆盖"被杀"）在**服务端仓**（本仓做不到）⇒ 客户端做到上限 = **"极其轻量的后台任务定期对账"**。

**部件**（全部新增，⛔ 未改 `core/notify.ets` 任何导出）

| 部件 | 文件 | 职责 |
|---|---|---|
| 纯判定 | `core/reconcile.ets` | `reconcileDecision(mark, memo)` → `none/turn_done/ask`；`applyDecision`/`markSeen`/`turnKeyOf` |
| 执行体 | `workreconcile/NotifyReconcileAbility.ets` | `WorkSchedulerExtensionAbility`：读备忘 → 只读 `/api/history` → 判定 → 发布 → 落盘 |
| 注册 | `workreconcile/schedule.ets` | `ensureReconcileScheduled(ctx)`（幂等，`isRepeat+isPersisted`） |
| 声明 | `entry/src/main/module.json5` | `extensionAbilities[].type = "workScheduler"`（**无需权限**，也不加常驻通知栏） |
| 接线 | `entryability/EntryAbility.ets` `onCreate` | 一行 `ensureReconcileScheduled(this.context)`（旁路，失败只记日志） |

**判据（"见过没见过"优先于"忙不忙"）**：`turnKey = chatId#last_seq`；前台每次观测 ⇒ `markSeen`；
对账时**存在已完成且 `turnKey !== lastSeenTurnKey`** ⇒ 提醒。这条同时覆盖"冻结期完成"与"被杀期完成"
（用"忙→不忙"边沿会**漏掉被杀那条**）。冷启动闸：前台没看过（`initialized=false`）⇒ 不判完成，防误报。
`askId` 新值优先，且**有待答时本次判定只围绕它**（否则同一快照会重复报 `turn_done` —— 该缺陷由测试抓出并修复）。

**覆盖表（诚实）**

| 情形 | 现有机制是否覆盖 |
|---|---|
| 前台 | ✅ `notifyOnSse` 实时 |
| 后台 ≤3 分钟（且**刚发过消息**） | ✅ 短时任务窗内 SSE 仍活 |
| 后台 ≤3 分钟（**被动轮次**） | ❌ SSE 已被冻结（无窗） |
| 冻结 / 被杀 | ⚠️ **仅**能靠本扩展在系统唤醒时**补发**（迟到 15min 量级，且**不保证**被唤醒） |
| 待答（ask） | ⚠️ 后台**本期判不出**（`askId` 恒空：待答来自 SSE 事件；从 `/api/history` 单推**未验证**） |
| **不接受任何延迟** | ❌ 必须服务端推送（**本仓做不到**） |

**需要真机验证（未验证项）**：实际唤醒间隔是否接近 15min；扩展进程能否读到前台写的 cookie；
`askId` 后台判定；`onWorkStop` 超时 2 分钟语义。

## 4. 后台「极轻量接收」：可行 vs 不可行（明账，逐条带证据）

| 路径 | 判定 | 证据（file:line） |
|---|---|---|
| **A. 本地通知 + 短时任务（现状）** | ✅ **可行（已落地）** | `requestSuspendDelay`（`default/openharmony/ets/api/@ohos.resourceschedule.backgroundTaskManager.d.ts:650`，**无 `@permission`**）；回调在到期前约 **6 秒**（`:635-636`） |
| **B. 长时任务 continuousTask** | ⚠️ 能做但**代价大**（须用户同意） | `startBackgroundRunning`（`:734`）**需** `ohos.permission.KEEP_BACKGROUND_RUNNING`（`:708`）+ ability `backgroundModes`；权限被拒抛 **201**、非系统应用 **202**（`:718-719`）；**成功即挂一条常驻通知**（`:666`）；`DATA_TRANSFER` **10 分钟无真实传输被系统取消**（`:1116-1133`）⇒ **不承诺"永久在线"** |
| **C. WorkScheduler 周期拉起** | ⛔ **不是实时**（价值最低） | `workScheduler.startWork`（`@ohos.resourceschedule.workScheduler.d.ts:210`，`@stagemodelonly`）；扩展 `WorkSchedulerExtensionAbility.onWorkStart`（`@ohos.WorkSchedulerExtensionAbility.d.ts:60`）。**由系统批处理调度、间隔不可预期** ⇒ 提醒会迟到，不能承诺"回合结束马上提醒" |
| **D1. `ServiceExtensionAbility` 常驻** | ⛔ **三方不可用** | 与 `core/notify.ets` 顶注一致：三方拿不到常驻后台能力（平台策略） |
| **D2. `NotificationSubscriberExtensionAbility`** | ⛔ **本工程不可用** | `@since 22`（`@ohos.application.NotificationSubscriberExtensionAbility.d.ts:36`）> 本工程 pin **21**；且用途是**可穿戴伴侣应用**转发本机通知（`:22-32`），非"接收 agent 消息" |
| **D3. Push Kit（App 死也能实时推）** | ⚠️ **SDK 有；本工程现状不可用** | **本机 SDK 含** Push Kit：`default/hms/ets/kits/@kit.PushKit.d.ts`、`default/hms/ets/api/@hms.core.push.pushService.d.ts`（`@since 4.0.0(10)`）等 —— 旧的 `PATCHES` 文档只 grep 了 `openharmony/ets/api/` 子树 ⇒ **误判"不含"**（本次已更正）。但 Push 必须 **AGC 配置 + 服务端经华为通道下发**（本工程"⛔ 不许改服务端"）⇒ 现状用不了 |

**⇒ 结论**：在"不改服务端 + 不新增长时任务权限"两条约束下，**A 档就是上限**；B/C/D 都需用户拍板或
超出范围。**"后台常驻接收"不是没做，是平台不提供**给三方。

## 5. 功耗与「什么条件下才启动」

- 硬预算：静止 CPU ≈ **0.9%**、PSS ≈ **245 MB**（旧版基线，见 `docs/PERF-BUDGET.md`）。
- 本方案**不加任何常驻后台**：通知是**事件驱动**（SSE 收到 `phase_done`/`ask_user` 才发一条）；
  短时任务**只在"发送成功"这一瞬**申请、回合结束/回前台立即释放（`beginTurnKeepAlive`/`endTurnKeepAlive`）。
- **启动条件**（缺一不发）：① 应用**不在前台**（`appIsForeground === false`）；② 档位开关**开**（设置里
  `xbot-notify-ask` / `xbot-notify-turn-done`）；③ `turn_done` 还要过 10 秒**去重窗**（`withinDedupeWindow`）。
- 切后台 >3 分钟（或 `aa force-stop`）后回合才结束 ⇒ **收不到实时提醒**，只会在**下次回前台**由
  `sse.forceReconnect` + `/api/history` 对账补齐（这是 A 档的定义，不是 bug）。

## 6. 需真机 / 签名才能验（当前**未验**，只读核实过）

| 项 | 为什么只能真机 |
|---|---|
| `wantAgent` 点击带 `chat_id` 回到该会话（冷启动 `onCreate` + 热启动 `onNewWant` 两条路） | `getWantAgent` + 系统拉起是平台行为，Node 单测只能验纯判定 |
| slot 分级真的出横幅/响铃 vs 静默 | 系统通知中心渲染，必须在设备上看 |
| 长文本展开是否真按整段显示（vs multiLine 3 行） | 设备通知中心 UI |
| 角标与系统对账（杀进程后不回假 0） | 需设备通知中心状态 |
| 短时任务 3 分钟窗内是否真不被冻结 | 需设备真实后台调度 |

## 7. 未做项（诚实台账）

| 项 | 状态 | 原因 |
|---|---|---|
| 动作按钮「停止 / 继续」 | **未发射** | deep-link 通道就绪（`notify_action` 参数已投递），但"执行"在 `pages/Index.ets`（**他线持有**）⇒ 页面接线后把 `notifyActionsFor` 改一行即可 |
| B 档长时任务 / C 档 WorkScheduler 落地 | **仅文档 patch** | 需用户同意（改 `module.json5` 权限面），见 `docs/PATCHES/background-notify.md` |
| 真机验收 | **未做** | 设备在跑用户会话，⛔ 不碰 |
