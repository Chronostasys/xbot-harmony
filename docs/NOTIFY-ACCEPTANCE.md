# NOTIFY-ACCEPTANCE.md —— 通知真机验收清单（"不装机也能审" + "装了怎么验" 两用）

> 用途：本文件是**通知面**的验收判据。每项给 ① 操作步骤 ② 预期现象 ③ 判据（怎么算通过）
> ④ 失败时最可能的原因。
>
> ⛔ **本文件不碰设备**（设备归用户）。以下 `hdc`/`uitest` 只是**步骤模板**，由持设备者执行。
> 设备 `TARGET=127.0.0.1:5555`（模拟器 `xbot_phone`），包名 `com.chronostasys.xbot`。
>
> 相关：`docs/NOTIFY.md`（能力面 + 明账）、`core/notify.ets`（实现）、`EntryAbility.ets`（生命周期）。

## 0. 怎么"不装机也能审"

把每项的**③ 判据**当作静态可核对的不变量 —— 都能在源码/纯逻辑测试里查证（不需要设备）：

| 项 | 不装机可证的判据（源码/测试） |
|---|---|
| 1/2 点击回会话 | 纯判定：`notificationIdFor` 确定性、`notifyActionFromParam` 白名单、`publishTurn` 的 `wantAgent` 用 `START_ABILITY + parameters{chat_id}`（`notify.ets:991-1020`）；接线：`EntryAbility.captureOpenChat`（`EntryAbility.ets:128-151`）→ `Index.ets:731-752` |
| 3 slot 分级 | 纯判定：`slotTagFor`（`notify.ets:881`）→ ask=SOCIAL / done=CONTENT；SDK 依据 `@ohos.notificationManager.d.ts:1050-1117`（级别映射） |
| 4 长文本 | 纯判定：`notifyShapeFor`（`notify.ets:736`）+ `notifyBodyPlan`（`:805`）；测试 `tools/tests/notify_content.test.ts`（long_text 档 + 退化） |
| 5 角标对账 | 纯判定：`badgeFromCounts`（`notify.ets:181`）；测试 `tools/tests/notify.test.ts` |
| 6 短时任务 | 纯判定：`beginTurnKeepAlive`/`endTurnKeepAlive` 幂等（`notify.ets:1213/1248`）；测试 `tools/tests/notify*.test.ts` |
| 7 免打扰 | 源码：**全仓不出现** `bypassDnd` 赋值（`grep -rn bypassDnd entry/src` 应为空 ⇒ 尊重系统 DND） |

**⇒ 不装机时**：跑 `bash tools/gate.sh`（含 `tools/tests/notify*.test.ts` 五套）+ 上表源码核对，
即可"审"通知面的**逻辑**；下面 §1-§7 的"可见现象"则必须真机。

---

## 1. `wantAgent` 点击回会话 —— **冷启动**（App 未运行）

- **① 步骤**：`aa force-stop com.chronostasys.xbot` ⇒ 在**另一台设备/网页端**向某会话发消息触发回合 ⇒
  等回合结束（App 后台/未运行）⇒ 通知栏收到提醒 ⇒ **点通知本体**。
- **② 预期**：App 冷启动、**直接进入那条会话**（不是默认首会话）；`hilog` 有
  `notification wants chat: <chat_id> action: `。
- **③ 判据**：进入的会话 == 触发通知的那个 `chat_id`；`hilog` 上述行出现且 chat_id 一致。
- **④ 失败最可能原因**：`wantAgent` 字段口径（since11 `actionType`/`actionFlags` vs 旧字段，见
  `notify.ets:991` 退路）；`BundleName`/`AbilityName` 与 `module.json5` 不一致（`notify.ets:246-248`）；
  `EntryAbility.onCreate` 收到 want 但页面挂载晚于写值 ⇒ 需 `bootstrap` 末尾主动读初值（`Index.ets:827`）。

## 2. `wantAgent` 点击回会话 —— **热启动**（App 在后台运行）

- **① 步骤**：App 正在后台（`uitest uiInput keyEvent 3` 回 Home）⇒ 回合结束出通知 ⇒ **点通知本体**。
- **② 预期**：App 从后台**回到前台并切到该会话**；`hilog` 有 `notification wants chat: …`（走 `onNewWant`）。
- **③ 判据**：走到了目标会话；`onNewWant` 路径（`EntryAbility.ets:110-111`）被打中（日志可辨）。
- **④ 失败最可能原因**：`onNewWant` 未接线（历史 bug）；`@Watch` 因"值相同"不触发 ⇒ 靠
  `pendingOpenChatSeq` 变化兜住（`Index.ets:578-580`）。

## 3. slot 分级：`ask_user` 出横幅+响铃 / `turn_done` 静默

- **① 步骤**：分别触发两类。`ask_user`：让智能体提问（或让其等回答）；`turn_done`：普通回合结束。
  两次都要**先切后台**再等事件。拉通知栏：
  `hdc -t 127.0.0.1:5555 shell "uitest uiInput swipe 660 1 660 2400 30000"`。
- **② 预期**：`ask_user` ⇒ **横幅弹出 + 响铃 + 状态栏图标**；`turn_done` ⇒ **无横幅、无铃声**
  （仅通知中心 + 角标）。
- **③ 判据**：两种表现**不同**（ASK 明显更醒目）；系统设置里本应用的两条 channel 级别不同
  （SOCIAL=高 / CONTENT=低）。
- **④ 失败最可能原因**：slot 未建（`initSlots` 失败，`notify.ets:900`）⇒ 系统补建默认级别；
  用户关掉了响铃/横幅权限；分档判据走错（`kindFromNotifyTitle`，`notify.ets:507`）。

## 4. 长文本真按**整段**展开（而非 1024B 截断）

- **① 步骤**：让某会话产生**单段长回复**（>1000 字节、无换行，如让智能体输出一段长中文）⇒
  切后台 ⇒ 等回合结束 ⇒ 拉通知栏 ⇒ **展开**该通知。
- **② 预期**：展开后显示**一整段长文本**（上限 3072 字节），**不是**在一行后就被 `…` 掐断。
  若正文真的超 3072 字节，末行才是 `…完整内容见应用内`。
- **③ 判据**：展开正文长度 ≈ 原文（远大于折叠态一行）；无提前截断；`degraded` 仅当超 3072B。
  对应源码：`NOTIFY_SHAPE_LONG_TEXT`（`notify.ets:772`）/ `MAX_LONG_TEXT_BYTES=3000`（`:301`）。
- **④ 失败最可能原因**：该正文其实**含换行**（多段 ⇒ 走 multiLine 3 行，属预期，非缺陷）；
  正文 ≤1000 字节（走 multiLine 一行，属预期）；设备通知中心折叠态未展开（需手动下拉）。

## 5. 角标在**杀进程后不回假 0**

- **① 步骤**：制造 1 条通知（角标 +1）⇒ `aa force-stop com.chronostasys.xbot`（内存态清空）⇒
  重新冷启动 App（**不要**点那条通知）⇒ 看桌面图标角标。
- **② 预期**：角标仍反映**系统侧真实条数**（通知还在 ⇒ 角标非 0），而不是被内存归零。
- **③ 判据**：冷启动后角标 == 系统通知中心里本应用的条数（`getActiveNotificationCount` 读数优先）。
  源码：`badgeFromCounts(systemCount, localCount)`（`notify.ets:181`）。
- **④ 失败最可能原因**：`getActiveNotificationCount` 抛异常 ⇒ 回落本地记账（内存已清 ⇒ 0）；
  该 API 在目标设备/版本不可用；桌面启动器不显示角标（系统设置里需允许）。

## 6. 短时任务 3 分钟窗**不被冻结**

- **① 步骤**：App 前台发一条消息（回合开始）⇒ **立刻切后台** ⇒ 3 分钟内让回合结束 ⇒ 看通知。
  同时看日志：`hdc -t 127.0.0.1:5555 shell "hilog" | grep -i "xbot notify"`。
- **② 预期**：3 分钟内回合结束 ⇒ **收到实时通知**；临近超时有日志
  `短时任务即将到期（约 6s 后应用可能被冻结）…`。
- **③ 判据**：窗内实时收到（无需回前台）；到期回调日志出现时刻 ≈ 申请后 3min − 6s。
  源码：`requestSuspendDelay`（`notify.ets:1213`）；SDK `backgroundTaskManager.d.ts:650`（免权限）。
- **④ 失败最可能原因**：**超过 3 分钟**（A 档定义：窗内实时、窗外靠回前台对账补齐）；
  低电量/系统策略缩短了 `actualDelayTime`；`beginTurnKeepAlive` 未被调（发送路径未接线）。

## 7. 免打扰**不绕系统 DND**

- **① 步骤**：系统开"勿扰/免打扰"模式 ⇒ 触发一次 `ask_user` 通知。
- **② 预期**：**遵守**系统免打扰（不响铃、不出横幅）—— 通知只静默落进通知中心。
- **③ 判据**：DND 开启时无声音/横幅；源码里**没有** `bypassDnd = true`（`notify.ets` 顶注 :809 明示）。
- **④ 失败最可能原因**：若未来有人给 slot 设了 `bypassDnd` ⇒ 会绕过 DND（**这是禁止项**，
  应回退）。`grep -rn bypassDnd entry/src` 必须为空。

---

## 8. 一键"通知面 30 秒验收"（装机后最快路径）

> 新建会话发一条**长回复** → 立刻切后台 → 30 秒内拉通知栏，核对：
> ① 长回复展开为**整段**（非截断）；② 问句=横幅响铃、回合完成=静默；③ 有「查看」且点击直达该会话；
> ④ 同会话连发两回合仍只有**一条**；⑤ 设置里关「通知显示回复内容」再发 ⇒ 正文只剩标题；
> ⑥ 点开通知 ⇒ 角标清零。

## 9. 诚实边界（**不算失败**）

- **切后台 >3 分钟**（或 `aa force-stop`）后回合才结束 ⇒ **收不到实时通知**，只会在**下次回前台**
  由 `sse.forceReconnect` + `/api/history` 对账补齐（A 档定义，不是 bug）。
- **动作按钮「停止 / 继续」**：需 `pages/Index.ets` 接线补丁落地后**才发射**（见 `docs/NOTIFY.md §7`）；
  未接线前通知**只发「查看」** —— 这是"不发射死键"的纪律，**不是**功能缺失。
- **后台常驻接收**：平台不提供（明账见 `docs/NOTIFY.md §4`），**不列为验收项**。

---

## 10. 后台化后「还有事件进来吗」—— 根因判定与实验（2026-10-11 只读审计）

> 现象：三轮真机（后台化 15s / 70s / 80s）**都没有通知**；发布侧三道审计下来**不像有 bug**
> （`publishTurn` / `ensureEnabled` / `createSlots` / `setAppForeground` 都完整，见顶部任务描述）。
> ⇒ 首要怀疑：**被后台化后 SSE 不再有事件进来** ⇒ `store.notifyOnSse`（`core/store.ets:1372`）**从未被调用**。
> 本节把"是否还有事件"**做成可判**，并给出路线（⛔ 本节**只判定 + 设计实验**，不改码、不动设备）。

### 10.1 逐条读码/SDK 依据

| # | 事实 | 依据（file:line / SDK 行号） |
|---|---|---|
| 1 | **进后台只写一个标志**，**不关 SSE**、不申请保活 | `entryability/EntryAbility.ets:103-105`：`onBackground(){ setAppForeground(false) }` |
| 2 | SSE 连接**只在切会话 / 停止时**关闭，**没有**面向后台的关闭逻辑 | `core/sse.ets:457` `connect()` / `:489` `close()`；调用点仅 `core/store.ets:554`（切会话）与 `:1251` |
| 3 | 短时任务**只有两处**开窗：**用户发消息**（`pages/Index.ets:2309`）与**点通知「继续」**（`:932`） | `beginTurnKeepAlive()` 定义 `core/notify.ets:1222`；调用点仅上述两处 |
| 4 | ⇒ **纯被动轮次**（他人/另一端/cron/subagent 触发）后台**没有任何窗** | 由上一条直接推出（没有第三处调用点；`grep -rn "beginTurnKeepAlive" entry/src` 仅 2 处） |
| 5 | 短时任务**上限 = 3 分钟**（低电量 **1 分钟**），到期回调**提前约 6 秒** | SDK `@ohos.resourceschedule.backgroundTaskManager.d.ts:272-282`（`actualDelayTime` 注释原文）、`:636`（"invoked 6 seconds before the timeout"） |
| 6 | 短时任务**不保活进程**，只保证窗内**不被冻结** | `core/notify.ets:1213-1216`（本仓注释）；SDK `:627-637`（Transient Task，免权限） |
| 7 | **长时任务**（`startBackgroundRunning`）可跨后台，但：需 `ohos.permission.KEEP_BACKGROUND_RUNNING`，且 **`BackgroundMode` 没有任何"聊天/长连"档** | SDK `:699/:734`（签名）、`:1133-1202`（枚举仅 `DATA_TRANSFER/AUDIO_PLAYBACK/AUDIO_RECORDING/LOCATION/BLUETOOTH_INTERACTION/MULTI_DEVICE_CONNECTION/VOIP`）、`:1053` 附近 `@permission` |
| 8 | 长时任务**也会被挂起**（系统检测到未实际执行对应业务 ⇒ 标记 suspended；挂起后**退后台即被挂起**） | SDK `:1046-1051`（`continuousTaskSuspend` 注释原文："the application will be suspended when switched to the background"） |
| 9 | 本应用**没有**申请该权限、**没有** `backgroundModes` | `entry/src/main/module.json5:30-34`（只有 `INTERNET` / `GET_NETWORK_INFO` / `VIBRATE`） |
| 10 | 服务端**无任何系统推送能力**（无 webpush/fcm/apns/厂商通道 SDK） | 只读遍历 `/Users/bobli/src/xbot`（`grep -rliE "webpush\|fcm\|apns\|getui\|jpush\|vapid" --include=*.go` ⇒ **0 命中**） |

### 10.2 明确预测（可判）

- **A. 有窗（先发消息/点继续 ⇒ `beginTurnKeepAlive` 成功）且 ≤3 分钟**：
  **应当**在后台仍能收到 SSE（心跳 15s 一条 + 回合事件）⇒ 回合结束**应当**出通知。
- **B. 无窗（直接按 HOME，或被动轮次）**：应用**被冻结** ⇒ JS 定时器与事件回调停摆
  ⇒ **后台期间不应再有任何 SSE 事件** ⇒ `notifyOnSse` 零调用 ⇒ **必然无通知**（**这不是发布侧 bug**）。
- **C. 有窗但 >3 分钟（或低电量 >1 分钟）**：窗到期后同 B。

> ⇒ 三轮真机若**都没先发消息**，现象与 B **完全吻合**，即：**根因 = 事件进不来，不是发布侧**。

### 10.3 设备可判实验（**先写好，等设备空**）

⛔ 纪律：先确认**没人在用设备**（多线并行会互相污染）；⛔ 不 `force-stop`；本实验**只需一次后台化**。

```bash
source ~/ohos-cli/env.sh; T=127.0.0.1:5555
hdc -t $T shell "hilog -r"                       # ① 清缓冲（防"旧日志当新事件"）

# ② 在设备上：某会话**发一条会长回复的消息**（这一步同时开 3 分钟窗）⇒ **立刻按 HOME**
#    ⛔ 别关应用、别切会话（会 close SSE）

# ③ 保持 60s（在窗内），然后一次性取回日志
hdc -t $T shell "hilog -x > /data/local/tmp/h.txt"
hdc -t $T file recv /data/local/tmp/h.txt /tmp/h.txt

# ④ 判据
grep -nE "xbot sse|xbot notify|requestSuspendDelay|短时任务|notify" /tmp/h.txt | tail -40
```
**判读（对照 §10.2 的预测）**

| 观测 | 结论 |
|---|---|
| 后台 60s 内**有** SSE 帧/心跳日志 ⇒ 但**没有** `xbot notify` 相关行 | **事件进来了、发布侧没发** ⇒ **才是发布侧 bug**（转 §10.4） |
| 后台期间 SSE 日志**完全静止**（最后一条 ≈ 进后台瞬间） | **应用被冻结 ⇒ 事件进不来** ⇒ 根因 = 挂起（走 §10.5 路线） |
| 完全无 `requestSuspendDelay` 成功日志 | 窗**没开**（没发消息 / 申请失败）⇒ 先复现"发消息"这一步 |

**对照实验（判"窗"的价值）**：把 ② 换成"**不发消息，直接 HOME**"重跑 ⇒ 预测**零 SSE 事件**。
A/B 结果**不同** ⇒ 证明 3 分钟窗确实是后台存活的唯一来源；**相同** ⇒ 窗也没用（需重估）。

### 10.4 若日志显示"事件进来了但没通知" ⇒ 发布侧排查点（`core/notify.ets` 是本线归属）

按 SSE 事件实际到达顺序查三处（都有 file:line，便于定点）：
1. `notifyKindForSse(...)` 是否把该事件映射成了"可通知的 kind"（映射表在 `core/notify.ets` 的 kind 段）；
2. `shouldNotify(appIsForeground(), kind)`（`core/notify.ets:457`）是否因 `appIsForeground()` **错读为 true** 而抑制
   —— ⚠️ **最可疑的一条**：`AppStorage` 写入失败/读取回落（`appIsForeground()` 的兜底是**返回"前台"**，`core/notify.ets:861`）
   ⇒ 后台化时若写失败，会**静默抑制所有通知**；
3. `publishTurn`（`:1031`）返回 false 时的失败日志（授权/slot/内容超限）。

### 10.5 若根因是"挂起，事件进不来" ⇒ 路线与代价（**都是架构选择，等拍板**）

| 路线 | 做法 | 代价 / 风险 |
|---|---|---|
| **① 服务端系统推送**（唯一"杀进程也能收"） | 服务端接**华为 Push Kit**（HMS），轮次结束时由**服务端**发；客户端只注册 token | 服务端**当前零推送能力**（§10.1-10）⇒ 要接厂商 SDK + 账号/证书 + token 生命周期；**属 web/server 仓的活**（本任务禁改） |
| **② 长时任务保活**（客户端可做） | `startBackgroundRunning(ctx, 'dataTransfer', wantAgent)` 保 WS/SSE | 需 `KEEP_BACKGROUND_RUNNING` 权限 + **`BackgroundMode` 无"聊天"档**（§10.1-7）⇒ 只能用 `dataTransfer` 等**语义不符**的档 ⇒ 有**审核/被挂起**风险（§10.1-8）；且要常驻通知栏 |
| **③ 现状：短时任务窗 + 回前台对账** | 只在"用户刚发消息"开 ≤3min 窗；窗外回前台对齐 | 零平台成本；**被动轮次完全无窗**（§10.1-3/4）⇒ "最专业的通知"达不到 |
| **④ ①+③ 组合（推荐方向）** | 服务端推送兜底"不依赖进程存活"；窗内走实时 SSE | 成本集中在服务端；但**这是唯一能覆盖"应用被杀/被冻结"的** |

⚠️ **不建议**：把窗申请挂到"SSE 收到 busy 时"—— 应用被冻结后**根本收不到那个事件**，逻辑上自锁（无效）。

### 10.6 本节结论（一句话）

**发布侧不是首要嫌疑**：`onBackground` 不关连接，但**没有任何机制在后台**（除"用户刚发消息"的 ≤3min 短时任务窗）
**维持 JS/网络活动**；应用被冻结后 SSE 事件**进不来** ⇒ `notifyOnSse` 零调用 ⇒ 无通知。
⇒ 目标①的**正解是架构选择**（§10.5），不是发布侧打补丁；**先跑 §10.3 把"有没有事件"钉死**再定方向。

---

## 11. 本波新增能力（2026-10-11）—— 验收面补全

> 纪律同前：**不碰设备**（设备是多线共用的），本节只给**操作步骤 / 预期 / 判据 / 失败最可能原因**。
> 每条都给出**代码位置**与**已有判据**（可先离线复核，再上设备）。

### 11.1 品牌小图标（`a193a67`）

- **它解决什么**：`NotificationRequest.smallIcon` **默认留空 ⇒ 通知显示系统默认应用图标**
  （SDK `api/notification/notificationRequest.d.ts:300-310` 原文）。现在换成品牌资产。
- **① 步骤**：发一条会出通知的消息（或用 §8 的 30 秒验收）⇒ **HOME** ⇒ 看通知栏该条通知的**左侧小图**。
- **② 预期**：小图 = **品牌描边标记**（`brand_mark_outline.svg`）；若 svg 解不出 ⇒ 自动退 **`start_icon.png`**。
- **③ 判据**：
  - 源码形态：`tools/tests/notify_icon.test.ts`（**14/23 条**）—— core 侧只有**不透明装饰钩子**
    `setNotifyDecorator`（`core/notify.ets`），**全仓唯一** `image.createImageSource(` 在
    `workreconcile/icons.ets`，且**装饰器回调体内不含解码**（防每次 publish 解码）；
  - 真机：`hilog -x | grep XBOTICON` ⇒ 应出现 **`品牌小图标已就绪并注册装饰器`**。
- **④ 失败最可能原因**：
  1. **`brand_mark_outline.svg` 不被 `createImageSource` 支持**（**本波未验**）⇒ 日志会打
     `svg 解不出 ⇒ 回退 start_icon.png`；若两路都失败 ⇒ `两路资产都解码失败 ⇒ 不设 smallIcon（回落系统默认图标）`
     —— **此时不是 bug，是降级**（要真品牌图标则需新导一份 **128×128 PNG**，SDK 推荐尺寸）；
  2. 通知**本身没发出来**（那是 §10 的链路问题，与本条无关）。

### 11.2 漏通知**聚合通知** + 点进路由（`a900919`）

- **它解决什么**：被冻结/被杀期间事件永久丢失 ⇒ 由 `workScheduler` 对账补发；文案**跨会话汇成一条**，
  而不是一串彼此无关的提醒。
- **① 步骤**：杀进程 → 让某个会话产生一轮回复（前台或另一客户端触发）→ 等后台对账唤醒（**不保证准时**）。
- **② 预期**：**一条**通知，正文形如 `有 1 条新消息（<会话名>）`（多会话 = `有 3 条新消息（A、B 等）`）。
- **③ 判据**（均已离线可跑）：
  - 文案唯一来源 = `core/reconcile.summarizeMissed`（`tools/tests/reconcile.test.ts`，**53/0**；
    含 `count==0 ⇒ text 空`、**最多点名 `MISSED_MAX_NAMED=2` 个 + "等" 收尾**、按 `turnKey` 去重）；
  - 真接线：`tools/tests/notify_icon.test.ts` 断言 **`summarizeMissed` 有真实消费方**（防门禁 ⑧ 零消费假绿）、
    **`sum.count > 0` 才发**、else 留 `summary count=0` 证据、**不再有硬编码文案**；
  - 点进路由：`wantAgent` 带 `parameters{chat_id, notify_action:'open'}` ⇒ 冷启由
    `EntryAbility.captureOpenChat(want)` 直达该会话（复用既有机制）。
- **④ 失败最可能原因**：**系统没唤醒**（`workScheduler` 不保证准时，见 §10.1-5/6）；或对账 HTTP 失败
  （`hilog` 打 `history http <code>` / `no snapshot`）⇒ 按 `reconcileIntervalMs` 退避；
  连续失败 5 次 ⇒ **放弃排任务**（`RECONCILE_GIVE_UP_FAILURES`）。

### 11.3 按会话分组（`cf7a486`）

- **它解决什么**：原先 `groupName` 是**全局一个组** ⇒ 所有会话堆一簇。现在 **`每会话一组`**。
- **① 步骤**：在**两个不同会话**各产生一条通知 ⇒ 拉通知栏。
- **② 预期**：**两簇**（各自可折叠），同一会话的多条（`turn_done` + `ask`）在**同一簇**里。
- **③ 判据**：`tools/tests/notify_group.test.ts`（**16/0**）—— 异 chatId 必异组 / 同 chatId 幂等 /
  `groupName: notifyGroupOf(chatId)` **恰 1 处** / `groupName: NOTIFY_GROUP_NAME` **恰 0 处** /
  **`cancelGroup(NOTIFY_GROUP_NAME)` 恰 0 处**；SDK 依据 `notificationRequest.d.ts:331-340`
  （同组名归一组、**202 字节**上限、**无** `groupSummary` 字段 ⇒ 不需要另发摘要通知）。
- **④ 失败最可能原因**：若清场失效（登出后通知残留）⇒ 有人把 `clearAll` 改回了 `cancelGroup(全局名)`
  —— **per-chat 分组后它匹配不到任何通知（静默失效）**，这正是本笔同修掉的连带缺陷，判据第 3 条守着它。

---

## 12. 主组实验「一次跑完」清单（任何人持设备都能跑）

> 脚本：`/tmp/xbot-notify-main.sh`（原子 6 步 + `trap` 清理）。
> 目的：判定**开了 3 分钟短时任务窗之后**，后台 60s 内 SSE 到底还进不进来（§10.2 的三种判读）。

**前置条件（缺一不可）**

| # | 前置 | 怎么确认 |
|---|---|---|
| 1 | **独占设备** | 没有别的线在用（并行会互相污染 —— 已被真实废掉过一次数据） |
| 2 | 服务端可达 + 已登录 | `curl -s -o /dev/null -w '%{http_code}' https://xbot.pivotlang.tech/api/auth/config` ⇒ 非 `000`；pref 里有 `session_cookie` |
| 3 | **一次性会话**建好 | 脚本自己 `POST /api/chats/create`；⚠️ 建完 **App 抽屉需刷新**才能看到 |
| 4 | **抽屉 dump 里 label 已知** | 先点开抽屉 → `uitest dumpLayout` → `python3 /tmp/xbot-notify-sel.py chat <json> '<名字>'` **预演一次**（一步，避免现场卡住） |
| 5 | 无需还原主题/会话 | 脚本只建/删**自己的**会话；不改主题、不 `force-stop` 用户会话 |
| 6 | 收尾自动 | `trap EXIT` ⇒ 删会话 + 把应用拉回前台 |

```bash
bash /tmp/xbot-notify-main.sh                       # composer 坐标自动取（选择器）
DRAWER_X=.. DRAWER_Y=.. CHAT_X=.. CHAT_Y=.. bash /tmp/xbot-notify-main.sh
```
产物：`/tmp/xbot-notify-main/{hilog.txt, notif.jpeg, verdict.txt}`。
判读三选一：`PUBLISH_BUG`（有 SSE 无 notify）· `FROZEN`（SSE 全静）· `SAMPLE_INVALID`（窗没开/坐标没定）。
⛔ 选择器**绝不盲点**：匹配不上即 `ABORT` 并打印取坐标命令。

---

## 13. 记档：**不做**的项

| 项 | 决定 | 理由 |
|---|---|---|
| **锁屏隐私双档**（锁屏只显示"新消息"、通知中心显示全文） | **不做** | ① **web 无对应设置项**（对齐基准里不存在该语义，自造就是分叉）；② 现有 `currentPrefs.detail` 已经提供"**正文开关**"这一档，用户可自行选择"只显示标题"；③ 平台层未提供"锁屏/通知中心分别设内容"的独立字段（如需，得再查 SDK）⇒ 收益低、语义来源缺。**若将来用户明确要求，再作为独立需求评估。** |

### 10.7 2026-10-11 更正：此前结论**作废**，发送路径实测通畅

1. **撤回**：此前"无窗冻结 / 连进入发送路径都没有 ⇒ UI 入口问题"的结论**作废** —— 根因是**测试脚本坐标失效（y=2633 落在 `xbot-composer` `[1306,1779]` 之外）** ⇒ 消息**从未发出** ⇒ **与 App 无关**。
2. **纠正后的实证**：用**真实坐标 `(1250,1543)`** 点击 ⇒ `xbot send: 进入发送路径（await 前）` + `xbot send: await 已 resolve` **各 1 次、失败 0 次** ⇒ **发送路径通畅**。⇒ 通知实验的**主组/对照组均需重做**（本轮未做）。
3. **判据纪律**：发送类实验**必须先断言"日志出现"再谈下游**；"覆盖层存在性"是假绿，要看**变化量**。
