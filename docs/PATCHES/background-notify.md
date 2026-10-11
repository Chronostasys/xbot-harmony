# PATCHES/background-notify.md —— 后台「极轻量任务接收 agent 通知」决策 + 可直接施行的补丁

> 用户原话：「最好能后台注册一个**极其轻量**的任务接收 agent 通知」。
> 本文件是**决策材料 + 逐文件 patch（diff 级）**：等用户点头即可施行。
> ⛔ **本文不改任何真文件**（`module.json5` / 代码均未动）。所有 SDK 事实都标了 `file:line`
> （路径前缀 `~/ohos-cli/command-line-tools/sdk/default/openharmony/ets/api/`），门限 = `compatibleSdkVersion 6.0.1(21)`。

## 一句话结论

**SDK21 下要做到"实时后台接收"，必须动权限面（`module.json5`）**；**零权限的极限就是 A 档（现状）** ——
B 档（长时任务）能延长保活，但代价是**一条用户可见的常驻通知** + 新权限；C 档（WorkScheduler）**不是实时**。
⇒ **建议维持 A 档**；B/C 的 patch 已在下面备好，**改 `module.json5` 属"改权限面"，须用户明确同意**。

---

## 一、三档方案对照表

| 维度 | **A. 零权限（现状）** | **B. 长时任务 continuousTask** | **C. WorkScheduler 周期拉起** |
|---|---|---|---|
| 能做到什么 | 前台 + **短时任务窗（单次 ≤3 min）** 内实时收 SSE 事件并发通知 | 后台**保活一段时间**，SSE 可持续收到 | 系统**周期性唤起** App 跑一小段，跑完又被冻结 |
| 实时性 | ❌ App 被杀/冻结后**收不到**；仅窗内实时 | ✅ 保活期内实时 | ❌ **不是实时**（系统批处理，延迟不可预期） |
| 代价 | 无 | **必须挂一条常驻通知**（用户可见）；耗电 | 每次唤醒很短；被系统限频 |
| 需要的权限/配置 | **无** | `ohos.permission.KEEP_BACKGROUND_RUNNING` + ability `backgroundModes:["dataTransfer"]` | `extensionAbilities:[{type:"workScheduler"}]`（**无权限**，但要新建扩展） |
| 系统限制 | 单次 ≤3 min、有**当日配额**（`TransientTaskInfo.remainingQuota`） | 权限被拒抛 **201**；验证失败 9800005/9800006；**`DATA_TRANSFER` 连续 10 分钟无真实传输会被系统取消** | 最小间隔/延迟**由系统策略决定**（SDK 未给硬下限 ⇒ 不可预期） |
| 对用户的可见影响 | 无 | **状态栏多一条常驻通知**（"xx 正在运行"）；关掉 App 通知也未必能消 | 无可见通知，但提醒会**迟到数分钟** |
| 结论 | ✅ **建议维持**（够用：回合在服务端跑，回前台必补齐） | ⚠️ **需用户同意**（改权限面） | ⚠️ **需用户同意** + **非实时**，价值最低 |

### D. 其它路径（诚实标注）

| 路径 | 状态 | 说明 |
|---|---|---|
| **Push Kit**（App 死也能实时推） | **SDK 有；本工程不可用** | ⚠️ **更正（2026-10-11）**：本机 SDK **含** Push Kit —— `default/hms/ets/kits/@kit.PushKit.d.ts` + `default/hms/ets/api/@hms.core.push.*`（旧文只 grep 了 `default/openharmony/ets/api/` 子树 ⇒ 误判"不含"）。但 Push 必须 ① AGC 侧配置应用 + ② **服务端经华为推送通道下发**（本工程"⛔ 不许改服务端"）⇒ 现状**用不了**；这与"SDK 缺件"是两回事 |
| 常驻前台 Service（`ServiceExtensionAbility` 常驻） | **平台不开放给三方** | 与既有 `core/notify.ets` 顶注一致：三方拿不到常驻后台能力 |

### 各档 SDK 依据（file:line）

- **A**：`requestSuspendDelay(reason, callback): DelaySuspendInfo`（`@ohos.resourceschedule.backgroundTaskManager.d.ts:650`，since 9）；回调在到期前约 **6 秒**（`:635-636`）；`DelaySuspendInfo.actualDelayTime`（`:263-282`）；当日剩余配额 `TransientTaskInfo.remainingQuota`（`:290-298`，since 20）。
- **B**：`startBackgroundRunning(context, bgMode, wantAgent): Promise<void>`（`:734`，since 9）；**`@permission ohos.permission.KEEP_BACKGROUND_RUNNING`**（`:708`）；**`@throws 201 - Permission denied`**（`:718`）；成功后 *"there will be a notification message without prompt tone"*（`:702` ⇒ 常驻通知）；`BackgroundMode.DATA_TRANSFER = 1`（`:1133`）且 *"not for more than 10 minutes … will be canceled"*（`:1116-1133`）；`stopBackgroundRunning(context)`（`:940`）。
- **C**：`workScheduler.startWork(work: WorkInfo): void`（`@ohos.resourceschedule.workScheduler.d.ts:210`，since 9，`@stagemodelonly`）；`WorkInfo{bundleName, abilityName, repeatCycleTime?, isRepeat?, …}`（`:38-192`）；扩展 `WorkSchedulerExtensionAbility.onWorkStart(work)`（`@ohos.WorkSchedulerExtensionAbility.d.ts:47`，since 9）。
- **D**：`ls ~/ohos-cli/command-line-tools/sdk/default/hms/ets/kits/ | grep -i push` ⇒ **`@kit.PushKit.d.ts`**；`ls .../default/hms/ets/api/ | grep -i push` ⇒ `@hms.core.push.pushService.d.ts`、`@hms.core.push.PushExtensionAbility.d.ts`、`@hms.core.push.RemoteNotificationExtensionAbility.d.ts` 等。⇒ **本机 SDK 含 Push Kit**（`@since 4.1.0(11)`；`PushExtensionAbility` 明确 "available only to system apps"，但 `pushService.receiveMessage` / `RemoteNotificationExtensionAbility` 面向三方推送）。**不可用的是本工程**（未接 AGC + ⛔ 不改服务端），不是 SDK 缺件。（更正 2026-10-11：旧文只 grep 了 `openharmony/ets/api/` 子树。）

---

## 二、可直接施行的补丁（diff 级）

> ⛔ 以下**只是文档里的 patch**，真文件（`module.json5`、`EntryAbility.ets`、`core/notify.ets`）**未被修改**。
> patch 只涉及**我的文件**（`core/notify.ets`、`entryability/EntryAbility.ets`）+ `module.json5`（配置，patch-only）。

### patch A —— 现状（**无需任何改动**）

A 档已在 `core/notify.ets` 落地：`beginTurnKeepAlive()/endTurnKeepAlive()`（`requestSuspendDelay`）。
**无 patch**。若只想"确认它就是最轻方案"，跳到第四节验收。

---

### patch B —— 长时任务（continuousTask）

**B-1. `entry/src/main/module.json5`**（⚠️ **改权限面 ⇒ 必须用户同意**）

```diff
--- a/entry/src/main/module.json5
+++ b/entry/src/main/module.json5
@@
     "requestPermissions": [
       { "name": "ohos.permission.INTERNET" },
       { "name": "ohos.permission.GET_NETWORK_INFO" },
-      { "name": "ohos.permission.VIBRATE" }
+      { "name": "ohos.permission.VIBRATE" },
+      { "name": "ohos.permission.KEEP_BACKGROUND_RUNNING" }
     ]
@@ abilities[0]
       {
         "name": "EntryAbility",
         "srcEntry": "./ets/entryability/EntryAbility.ets",
+        "backgroundModes": ["dataTransfer"],
         "description": "$string:EntryAbility_desc",
```

**B-2. `core/notify.ets`**（新增两个函数 + 一个总开关常量）

```diff
--- a/entry/src/main/ets/core/notify.ets
+++ b/entry/src/main/ets/core/notify.ets
@@ 常量区
+/**
+ * 长时任务总开关（**默认 false = 零行为**）。开启它**必须**同时在 module.json5 加
+ * `ohos.permission.KEEP_BACKGROUND_RUNNING` + ability `backgroundModes:["dataTransfer"]`，
+ * 否则 `startBackgroundRunning` 抛 201（权限被拒）——见 docs/PATCHES/background-notify.md。
+ */
+export const ENABLE_CONTINUOUS_TASK: boolean = false;
+
+let continuousRunning: boolean = false;
+
+/** B 档：申请长时任务（保活 SSE）。**失败绝不静默**：返回 false + 记明确日志（UI 可据此提示）。 */
+export async function beginBackgroundRun(ctx: common.UIAbilityContext): Promise<boolean> {
+  if (!ENABLE_CONTINUOUS_TASK) {
+    return false;
+  }
+  try {
+    if (continuousRunning) {
+      return true;
+    }
+    const agent: Object = await startAbilityAgent({ 'chat_id': '' });
+    await backgroundTaskManager.startBackgroundRunning(
+      ctx, backgroundTaskManager.BackgroundMode.DATA_TRANSFER, agent);
+    continuousRunning = true;
+    return true;
+  } catch (e) {
+    // 201 权限被拒 / 9800005 验证失败 / 9800006 通知失败 ⇒ 降级到 A 档（短时任务），并**明确告警**
+    continuousRunning = false;
+    console.warn(`xbot notify: 长时任务申请失败（降级为短时任务）: ${describeError(e as Object)}`);
+    return false;
+  }
+}
+
+/** B 档：释放长时任务（回前台立即调用 ⇒ 省电 + 去掉常驻通知）。 */
+export async function endBackgroundRun(ctx: common.UIAbilityContext): Promise<boolean> {
+  if (!continuousRunning) {
+    return true;
+  }
+  try {
+    await backgroundTaskManager.stopBackgroundRunning(ctx);
+    return true;
+  } catch (e) {
+    console.warn(`xbot notify: 长时任务释放失败（忽略）: ${describeError(e as Object)}`);
+    return false;
+  } finally {
+    continuousRunning = false;
+  }
+}
```

**B-3. `entryability/EntryAbility.ets`**（注册/注销位置 = 后台/前台转场）

```diff
--- a/entry/src/main/ets/entryability/EntryAbility.ets
+++ b/entry/src/main/ets/entryability/EntryAbility.ets
@@ imports from '../core/notify'
   PENDING_ACTION_KEY,
   PENDING_CHAT_KEY,
   PENDING_CHAT_SEQ_KEY,
+  beginBackgroundRun,
+  endBackgroundRun,
   endTurnKeepAlive,
@@ onForeground
   onForeground(): void {
     setAppForeground(true);
+    // B 档：回前台立刻释放长时任务（省电 + 消掉常驻通知）
+    endBackgroundRun(this.context).catch(() => {});
     endTurnKeepAlive();
     reconcileOnForeground();
   }
@@ onBackground
   onBackground(): void {
     setAppForeground(false);
+    // B 档：切后台申请长时任务保活 SSE（ENABLE_CONTINUOUS_TASK=false 时是零行为 no-op）
+    beginBackgroundRun(this.context).catch(() => {});
   }
```

**B-4. 需要的用户可见解释文案**（放设置面板「后台接收」开关的说明，⛔ UI 接线在页面=你的活）

> 「**后台接收通知**：开启后，App 切到后台也能继续收到智能体的提醒，但**状态栏会常驻一条
> 「xbot 正在后台运行」提示**（系统强制），且会略微增加耗电。关闭时只在 App 前台/刚切后台的
> 3 分钟内提醒。可随时关闭。」

---

### patch C —— WorkScheduler 周期拉起（**非实时**）

**C-1. `module.json5`**（⚠️ **新增扩展 ⇒ 须用户同意 + 分配文件**）

```diff
--- a/entry/src/main/module.json5
+++ b/entry/src/main/module.json5
@@ module（与 abilities 同级）
     "abilities": [ { … } ],
+    "extensionAbilities": [
+      {
+        "name": "NotifyWorkScheduler",
+        "srcEntry": "./ets/notifywork/NotifyWorkScheduler.ets",
+        "type": "workScheduler"
+      }
+    ]
```

**C-2. 新文件 `entry/src/main/ets/notifywork/NotifyWorkScheduler.ets`**（⚠️ **越我当前边界**，需你分配/由你落）

```ts
import { WorkSchedulerExtensionAbility } from '@kit.BackgroundTasksKit';
import workScheduler from '@ohos.resourceschedule.workScheduler';
import { reconcileOnForeground } from '../core/notify';

export default class NotifyWorkScheduler extends WorkSchedulerExtensionAbility {
  onWorkStart(work: workScheduler.WorkInfo): void {
    // 系统只给很短的一次运行窗口：这里做"补一次对账/发一条汇总提醒"，绝不假设能常驻
    reconcileOnForeground().catch(() => {});
  }
  onWorkStop(work: workScheduler.WorkInfo): void {}
}
```

**C-3. `core/notify.ets`**（登记/取消周期任务；`repeatCycleTime` 只是**请求值**，实际由系统定）

```diff
+export const ENABLE_WORK_SCHEDULER: boolean = false;   // 默认关
+const NOTIFY_WORK_ID: number = 0x5862;
+
+export function scheduleNotifyWork(): boolean {
+  if (!ENABLE_WORK_SCHEDULER) { return false; }
+  try {
+    workScheduler.startWork({
+      workId: NOTIFY_WORK_ID,
+      bundleName: BUNDLE_NAME,
+      abilityName: 'NotifyWorkScheduler',
+      isRepeat: true,
+      repeatCycleTime: 15 * 60 * 1000,     // 请求 15 分钟；**实际间隔由系统策略决定，非承诺**
+      networkType: workScheduler.NetworkType.NETWORK_TYPE_ANY,
+      isPersisted: true,
+    });
+    return true;
+  } catch (e) {
+    console.warn(`xbot notify: startWork 失败（降级）: ${describeError(e as Object)}`);
+    return false;
+  }
+}
```

---

## 三、风险与回滚

### 降级行为（**⛔ 不许静默失败**）

| 触发 | 必须的行为 |
|---|---|
| B：`startBackgroundRunning` 抛 **201**（权限被拒/用户撤权） | 记 `console.warn`（含 errorcode）+ 返回 `false`；**降级到 A**（短时任务照常）；设置面板显示"后台接收不可用：权限被拒"，不许静默 |
| B：`9800005/9800006`（连续任务验证/通知失败） | 同上（降级 + 可见提示） |
| B：`DATA_TRANSFER` 10 分钟无真实传输被系统取消 | 之后 `continuousRunning` 已失效 ⇒ 下次 `onBackground` 重试；用户短时任务窗仍在 |
| C：`startWork` 抛 `9700001~9700005` | 记日志 + 返回 false + 设置面板标记不可用；**不影响 A 档** |
| 任何档：App 在窗口内被冻结 | 回合在**服务端**继续；回前台由 `sse.forceReconnect` + `/api/history` 对账补齐 ⇒ `phase_done`/`ask_user` **照样补发通知**（判据 `notifyKindForSse` 同源） |
| **通用底线** | 通知仍是旁路：全部 `try/catch` + 返回 `boolean`，**失败最多"没提醒"**，绝不影响聊天主链路（既有设计，不许破） |

> **核心保证**：无论 B/C 是否可用，**应用内**（前台）通知与"回前台对账补发"**始终可用** —— A 档不被破坏。

### 回滚步骤

1. **只回配置**（最快）：撤掉 `module.json5` 的对应 hunk（权限/`backgroundModes`/`extensionAbilities`）⇒
   `bash tools/gate.sh` ⇒ 重装。代码侧的 `ENABLE_CONTINUOUS_TASK=false` / `ENABLE_WORK_SCHEDULER=false`
   已是**零行为**，无需改代码。
2. **回代码**：`git revert <patch 提交>`。
3. **只回 App**：`hdc -t 127.0.0.1:5555 install -r <旧 entry-default-signed.hap>`（见 `docs/RELEASE.md` 四）。

---

## 四、验收方法（可验证 + 诚实边界）

> 设备 `TARGET=127.0.0.1:5555`；⛔ **只在自己新建的会话里做**，不碰用户会话。
> 以下判据分「**可见判据**（用户 30 秒能确认）」/「**日志判据**（`hdc`）」/「**诚实边界**（做不到什么）」。

### A 档（现状）

- **可见判据**：发一条消息 → 立刻 `key Home`（切后台）→ **3 分钟之内**回合结束 ⇒ 通知栏出现提醒 + 角标 +1。
- **日志判据**：`hdc -t 127.0.0.1:5555 shell "hilog" | grep -i "xbot notify"` —— 能看到 `publish` 相关与短时任务到期日志（`短时任务即将到期…`）。
- **诚实边界**：**切后台超过 3 分钟**（或 `aa force-stop`）后回合才结束 ⇒ **收不到实时通知**；只会在**下次回前台**由对账补齐（这是 A 档的定义，不是 bug）。

### B 档（长时任务）

- **可见判据（最权威）**：开启后切后台 ⇒ **状态栏出现一条常驻通知**（无提示音，SDK 原文 `:702`）；回前台 ⇒ **该常驻通知消失**。
- **日志判据**：`hilog | grep -i "xbot notify"` —— 成功无 warning；权限被拒时必有一条 `长时任务申请失败（降级为短时任务）: ... 201`。
- **配置判据**：`hdc -t 127.0.0.1:5555 shell "bm dump -n com.chronostasys.xbot"` —— 输出里应用的 `abilityInfos` 应含 `backgroundModes`（**该命令在 `docs/RELEASE.md` 已验证可用**）。
- **诚实边界**：**10 分钟无真实网络传输**时 `DATA_TRANSFER` 会被系统取消（SDK 原文 `:1116-1133`）⇒ 长连接可能仍被断；**不承诺"永久在线"**。`hidumper` 的具体 SA 号**我未在本机核实**，故**不作为判据**（避免给你一条跑不通的命令）。

### C 档（WorkScheduler）

- **可见判据**：**没有**（这正是 C 的问题：用户看不到"后台任务在跑"）。
- **日志判据**：`hilog | grep -i "NotifyWorkScheduler"` —— `onWorkStart` 每次被系统唤起会打日志；**观察两次之间的时间间隔**即"实际周期"。
- **诚实边界**：**不是实时**。系统按电量/负载批处理，`repeatCycleTime=15min` 只是**请求**；实测可能是几十分钟甚至更久，且**不保证**执行。⇒ 不能拿来承诺"回合结束马上提醒"。

---

## 五、通知面验收清单（≤150 字，供并入 `docs/RELEASE.md`）

> 新建会话发一条长回复 → 切后台 → 30 秒内拉通知栏，核对：①长回复展开多行、无 `…`；
> ②问句横幅响铃、回合完成静默；③有「查看」且点击直达该会话；④同会话连发两回合仍一条。
> 设置里关掉「通知显示回复内容」再发 ⇒ 正文只剩标题；点开通知 ⇒ 角标清零。

（拉通知栏：`hdc -t 127.0.0.1:5555 shell "uitest uiInput swipe 660 1 660 2400 30000"`）

---

## 六、未做项 / 边界（诚实台账）

| 项 | 状态 | 原因 |
|---|---|---|
| 真机验证 A 档（切后台 3 min 内收通知） | **未做** | 设备在跑用户会话，⛔ 不碰（只读 `dump` 已确认） |
| B / C 档 patch | **未落地** | 需用户同意（改 `module.json5` 权限面）+ 你的 patch 落地指令 |
| Push 推送 | **现状不可用** | ⚠️ **更正**：本机 SDK **含** Push Kit（`default/hms/ets/`，见上）；不可用的是本工程（未接 AGC + ⛔ 不改服务端），**不是** SDK 缺件 |
| `hidumper` 看瞬态/长时任务状态的具体 SA 号 | **未核实** | 不敢凭记忆给命令 ⇒ 只给已核实的 `bm dump` / `hilog` / 可见判据 |
