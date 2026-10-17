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
| **实况窗（LiveView）/ 灵动岛** | **已落地（2026-10-17）**：HMS `@kit.LiveViewKit`（`@since 4.1.0(11)`，本工程 SDK21 满足）—— `isLiveViewEnabled`/`startLiveView`/`updateLiveView`/`stopLiveView`；`LiveView.event` 15 个场景是**逐场景申请权限**制（不是封闭白名单；SDK 原文 "To use specific scenarios, you need to apply for corresponding permissions"），且 `LayoutType` 有 **`LAYOUT_TYPE_CUSTOM=100`+`CustomLayout`**；本仓用 `event='PROGRESS'` + `LAYOUT_TYPE_DEFAULT`（标题/两行内容/文字胶囊/系统计时器），落地件见 § 实况窗 / 灵动岛（`core/liveview.ets` + `components/LiveViewBridge.ets` + `pages/Index.ets:syncLiveView`） | ✅ **已实现并接线**（⛔ 2026-10-16 我曾判"平台性不可行"**是错的**，依据错在只读了样例的场景工具类、没读 SDK 枚举真源）。**待用户侧**：AGC 开通推送+实况窗权益（场景 `PROGRESS`）+ 正式签名 ⇒ 无需改代码即生效；未开通时自动降级并落一行应用日志 |

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

---

## § 服务端主动推送（Push Kit 插件 `xbot.harmony-push`）—— 2026-10-17 落地

**一句话**：服务端可以**主动**把通知推到装了 xbot 的华为手机上，用户不打开应用也能收到；
实现方式是**纯非侵入插件**（源码在本仓 `plugins/xbot-harmony-push/`，只把二进制投进
`${XBOT_HOME:-~/.xbot}/plugins/xbot.harmony-push/`，**服务端源码一行未改**，删目录即完全回原状）。

| 面 | 落地件 |
|---|---|
| 全渠道工具 | `push_harmony_noti`（`title/body` 必填；`level` info·warn·error、`category`、`ttl`、`silent`、`notifyId`（覆盖式进度更新）、`data`、`dryRun`）；回执 JSON 带 `sent/failed/devices/code/hint`，**失败给可执行中文** |
| 上下文注入 | enricher `harmony-push-hint`：提示 AI 在**长任务**（>60s / 多轮工具）收尾时主动通知；设置里可关 |
| 前端 RPC（11） | `status` `register_token` `unregister_token` `list_devices` `rename_device` `clear_devices` `send` `send_test` `log_recent` `settings_get` `settings_set` |
| 设置（13 项） | 走**配置协议**（`contributes.configuration`）⇒ 后端 `plugin_config{id}` 描述字段、`plugin_config_set{id,key,value}` 回写；App 的通用设置页**自动渲染**（⛔ 未写死任何 UI）。实测：协议写入后插件进程**立刻**看到（mtime 热读） |
| 可靠性 | 设备台账（幂等登记/原子落盘 0600）、投递日志（环形 200）、滑动窗口限流、同内容合并窗口、分批发送（100/批）、OAuth 令牌缓存（提前 5 分钟刷新） |
| 隐私 | 真 Push Token 只在插件 `data.json`；日志/RPC 回执/错误串**一律掩码**（前6…后4）；`client_secret` 从不明文下发 |

### 前置（缺一不可）

1. **AGC 开通「推送服务」权益**；**profile 必须含 `com.huawei.service.push.base_service`**
   （`openssl smime -verify -inform DER -in xxx.p7b -noverify` 可直接查；
   DevEco `File → Project Structure → Signing Configs → ☑ Automatically generate signature` 会重新生成）。
2. ⛔ **重新生成 profile 后开发证书指纹会变** ⇒ 覆盖安装报 `9568332 install sign info inconsistent`，
   必须 **先卸载再装**（会清应用数据：服务器地址 + 登录态；会话在服务端不丢）。
3. `module.json5` 无需额外权限（只需 `ohos.permission.INTERNET`，已有）。
4. ⛔ **`push_harmony_noti` 进入 LLM 工具表需重启一次后端**：
   host 的 `WirePluginToolsForTenant` 按租户**只挂一次**（`IsTenantWired/MarkTenantWired`），
   插件在启动后才装 ⇒ 老租户不会再挂。

### 客户端（App）侧只做「鸿蒙才做得了的那件事」

`core/pushreg.ets`：`pushService.getToken()` 取 Token → 经 `web_plugin_rpc` 调插件的
`register_token` 上报。接线在**登录成功后**与 **`onPageShow`（回前台）**，fire-and-forget。

- ⛔ **先判插件 active 再请求**：用 `plugin_status` 探活（结果按 120s TTL 缓存；每启动最多一次，
  **不进启动关键路径**）⇒ 后端重启窗口里**不发请求**，也就不会撞 `plugin not active` 的 500。
- ⛔ **失败不弹 toast**：`http.post` 第 4 参 `notify=false`（该开关此前**只在注释里承诺**、
  无人遵守 ⇒ 后台静默调用失败也会弹红条，用户亲报「一进去就 500」；2026-10-17 补实现，
  默认 `true` ⇒ 既有调用点行为逐字节不变）。失败原因落应用日志（tag `push`）。
- 判据：`pushShouldRegister` —— token 变了**必报**、上次失败**必重试**、其余 ≥10 分钟一次。

### 实测证据（2026-10-17，本应用真实凭证，勿凭文档臆断）

| 接口版本 | 凭证组合 | 华为应答 | 结论 |
|---|---|---|---|
| **V1** | 应用级 appId + appSecret | `80300007` 全部 Push Token 无效 | **鉴权✓ 载荷✓ 已受理**（唯一失败项是"登记的 token 不是真 HMS token"——模拟器拿不到真 token） |
| V3 | 应用级 | `80200001` 访问令牌无效 | 本应用这套凭证不适用 V3 ⇒ **默认 V1** |
| V3 | 项目级 clientId+secret | HTTP 400 parameter invalid | 不适用 |
| 任一 | appId + 项目 secret / 项目 clientId + app secret | HTTP 400 invalid client_secret / parameter invalid | 交叉用一律 400 |

另两条硬证据（都踩过）：
- `payload.notification.category` **必填**：留空 ⇒ `80100003 Illegal payload, payload.notification.category should not empty`（插件已兜底 `IM`）。
- token 放置位置随版本变：V1 必须放 **`message.token`**（放 `target.token` ⇒ `80300010 token count should within 1 and 1,000`）；V3 才是 `target.token`。插件已按版本分别构造。

⛔ **模拟器不能作为推送验收对象**：OpenHarmony 模拟器可拿到一个 token（会成功登记进台账），但那不是真实 HMS 推送 token ⇒ 华为回 `80300007`。验收必须在**真机**上（真机 App 启动/回前台会自动登记）。

### 排障（按错误码走）

| 现象/错误 | 处置 |
|---|---|
| `1000900012`（取 Token） | 推送权益未开通 ⇒ 回前置 1、2 步 |
| `1000900010` | 应用身份非法：签名 profile 与包名不匹配 ⇒ 用该包名重签 |
| `plugin not active: xbot.harmony-push.*` | 后端在重启窗口 / 插件未激活（`plugin_status` 看 state）；`plugin_reload{id}` 或重启后端 |
| Push REST `80300002` | 无权限发送 ⇒ 权益 + `category` 与已开通场景不一致 |
| Push REST `80300007` | 全部 Token 无效 ⇒ 应用重装/清数据后 Token 会变，手机端重新登记 |
| Push REST `80200001/80200003` | 访问令牌失效 ⇒ 查 Client Secret / 系统时间 |

探针（不依赖 App）：
```bash
curl -s -b ck.txt -X POST -H 'Content-Type: application/json' \
  -d '{"method":"web_plugin_rpc","params":{"method":"xbot.harmony-push.send_test","params":{}}}' \
  http://127.0.0.1:8082/api/rpc
```

### 未做（诚实台账）

- **服务端远程更新实况窗**（Push Kit 的 `LiveViewPayload`）：本次只做通知类；实况窗走端侧
  `liveViewManager`（见上一节）。若日后要服务端驱动实况窗，需 AGC 侧另开实况窗权益并走 Push REST。
- **多用户隔离**：设备台账目前是"单操作者"模型（与当前 xbot 单用户身份一致）；
  多租户场景需按 `tenantID` 分账（插件协议当前只在工具调用里给 `toolName/input`，拿不到租户）。



> ⛔ **纠错**：我在 2026-10-16 判"平台性不可行"，**依据错了** —— 我只读了**样例仓库里按场景
> 写的工具类**（Delivery/Taxi/Flight/…），就把它当成"封闭白名单"，**没读 SDK 枚举与接口真源**。
> 用户 2026-10-16 深夜亲报并给了官方样例链接后，逐条重读 SDK：
> **① `LiveView.event` 的 15 个场景是"逐场景申请权限"制（不是封闭），SDK 原文即
> "To use specific scenarios, you need to apply for corresponding permissions"；
> ② `LayoutType` 里有 `LAYOUT_TYPE_CUSTOM = 100` + `CustomLayout`（自定义卡片）；
> ⇒ "AI chat 能做"是对的，我之前的判决作废。**

**真源（逐条读，非转述）**：`$SDK/default/hms/ets/api/@hms.core.liveview.liveViewManager.d.ts`
- 三 API：`isLiveViewEnabled(): Promise<boolean>`（`:172`）、`startLiveView`（`:200`）、
  `updateLiveView`（`:227`）、`stopLiveView`（`:256`），返回 `LiveViewResult{resultCode,message}`。
- `LiveView{ id, event, sequence?, isMute?, timer?, liveViewData }`（`:378`）；`sequence` 在 update/stop
  时必须**严格递增**否则被拒；`timer` 由**系统每秒自刷**（`isCountdown:false` ⇒ 正计时）。
- `PrimaryData{ title?, content: RichText[], layoutData?, keepTime?, clickAction? }`（`:608`）；
  `layoutData?: ProgressLayout | PickupLayout | FlightLayout | ScoreLayout | NavigationLayout | CustomLayout`（`:717`）。
- `LayoutType{ DEFAULT=-1, PROGRESS=3, PICKUP=4, FLIGHT=5, SCORE=7, NAVIGATION=8, **CUSTOM=100** }`（`:749`）。

**本仓落地（2026-10-17）**：
| 件 | 职责 |
|---|---|
| `core/liveview.ets` | **纯逻辑**：`liveViewSnapshotOf`（turn 状态 → 标题/两行内容/胶囊文案）+ `shouldPushLiveView`（**起/止恒推**、内容按 1s 节流）+ `fmtClock`/`lvStatusWord`。⛔ 不 import `@kit.*`（`core/**` 被 run.sh 当纯 TS 编译） |
| `components/LiveViewBridge.ets` | **全仓唯一** `@kit.LiveViewKit` 引用点：探测 `isLiveViewEnabled` + start/update/stop + `sequence` 自增 + 可重入闸 + **降级** + 应用日志 |
| `pages/Index.ets` | `syncFrom()` 每帧 → `syncLiveView()`：从**已有真实信号**折入参（`busy`/在飞块迭代号/在飞工具/字数/本 turn 起算时刻） |
| `tools/tests/liveview.test.ts` | 39 条判别力单测（未知状态不许说成"执行中"、结束态不带内容、**起止恒推不受节流**、逐字段差分） |

**场景选择**：`event = 'PROGRESS'`（进度展示）——一轮 agent turn 就是"一个进行中的服务"；
`layoutData = LAYOUT_TYPE_DEFAULT`（标题 + 两行内容 + 文字胶囊 + 系统计时器）。
⛔ **不画假进度条**：`ProgressLayout.progress` 必填，而 LLM 一轮的剩余量**不可知**，编百分比是骗人。
（想要完全自定义外观 ⇒ `LAYOUT_TYPE_CUSTOM` + 自建 `LiveViewCardExtensionAbility`，属下一步。）

**降级（fail-safe，不是失败）**：`1003500004`（LiveView is not enabled：未申请场景权益 / 用户关了
系统开关）与 `1003500003`（连不上服务）⇒ 一次即置 `cap=NO`，此后**零成本不再调用**，
**只落一行应用日志**（设置→开发者→应用日志，tag `liveview`）说明原因；其余错误码逐条记录、照常重试。

**要生效需要你（用户）做的**（我做不到的部分，其余我都做完了）：
1. 在 AGC 为 `com.chronostasys.xbot` 开通**推送服务权益 + 实况窗权益**，场景选 **PROGRESS（进度展示）**
   —— 官方步骤：`developer.huawei.com/consumer/cn/doc/harmonyos-guides/liveview-preparations`；
2. 用**该包名对应的正式签名**打包（官方样例 `README.md:92` 同款要求）；
`module.json5` 无需额外权限（只需 `ohos.permission.INTERNET`，已具备）。
申请下来后**无需改一行代码**：下一轮 turn 会自动出现在状态栏胶囊里（日志会从"未启用"变成"已启用"）。


