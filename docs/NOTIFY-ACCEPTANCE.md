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
