/**
 * 本地通知 —— **SDK 封装 + 纯判定**。
 *
 * ## 为什么需要它
 * web 端**没有系统通知**（服务端只会注入"通知行"到会话里）；原生端补的是"用户切走之后
 * 还能被叫回来"这一档能力：回合结束 / 智能体在等回答时发一条系统通知，点通知回到对应会话。
 *
 * ## 设计取舍（与主方案一致）
 * - **不保活**：只发通知 + 回前台对账（`appForeground` 标志）。三方应用没有
 *   `ServiceExtensionAbility`，`NOTIFICATION_CONTROLLER` 也拿不到 ⇒ 后台常驻不可行。
 * - **前台抑制**：用户正看着屏幕时**不发**（否则是吵闹）；判据由纯函数
 *   `shouldNotify(appIsForeground(), kind)` 给出，与调用点**同源**。
 * - **绝不影响主链路**：所有 SDK 调用都 `try/catch` 兜底并返回 `boolean`；
 *   通知失败最多是"没提醒"，**不能让聊天崩**。
 * - **备1 短时任务**：`beginTurnKeepAlive()/endTurnKeepAlive()` 用
 *   `requestSuspendDelay`（≤3 分钟）兜住"发完消息立刻切后台"（本轮只提供函数与
 *   生命周期，不接页面）。
 *
 * ⚠️ 本文件被 `tools/tests/run.sh` 当**纯 TS** 编译并**真跑**（node）⇒ 三个
 *    `@ohos.*` 依赖必须同时有：
 *   ① `tools/typecheck/stubs/notification.d.ts`（编译期声明）+ ② `tools/tests/mocks/notify_sdk.js`（运行期实现）。
 *   同理 `AppStorage` 在脱机环境不存在 ⇒ 读取必须 `try/catch`（见 `appIsForeground`）。
 */
import notificationManager from '@ohos.notificationManager';
import wantAgent from '@ohos.app.ability.wantAgent';
import backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';
import type { common } from '@kit.AbilityKit';
import type { BusinessError } from '@kit.BasicServicesKit';
import type { DomainEvent } from './chat_types_full';
import { describeError } from './http';

// ── 常量（协议/契约值，调用点共用）──────────────────────────────────────────

/** 通知档位：不需要通知。 */
export const NOTIFY_KIND_NONE: string = '';
/** 通知档位：智能体在等用户回答（最高价值的一条）。 */
export const NOTIFY_KIND_ASK: string = 'ask_user';
/** 通知档位：回合结束。 */
export const NOTIFY_KIND_TURN_DONE: string = 'turn_done';

/** `AppStorage` 键：应用是否在前台（由 EntryAbility 的 onForeground/onBackground 维护）。 */
export const APP_FOREGROUND_KEY: string = 'appForeground';
/** `AppStorage` 键：通知点击带来的待打开会话（EntryAbility.onNewWant 写入）。 */
export const PENDING_CHAT_KEY: string = 'pendingOpenChatId';
/** `AppStorage` 键：上述待打开会话的**序号**（同一会话二次点击也要能被页面察觉）。 */
export const PENDING_CHAT_SEQ_KEY: string = 'pendingOpenChatSeq';

// ── 通知 id：按会话派生（多会话的提醒**并存**，而不是互相覆盖）──────────────────
//
// 为什么：固定 id ⇒ 同 id 的通知会被**更新**（SDK：`NotificationRequest.id` "If a notification
// with the same ID exists, the notification is [updated]"，`notification/notificationRequest.d.ts:74-105`）
// ⇒ A 会话的提醒会被 B 会话的提醒冲掉，用户只能看到最后一条。微信/飞书都是按会话区分的。

/**
 * `chat_id` 缺失/为空时的**回落 id**（无归属的提醒只需要一条）。
 * 取 `0x7862`（"xb"）而不是 1/1000：一眼能认出这是降级形态，且不易与真实会话撞。
 */
export const NOTIFY_ID_FALLBACK: number = 0x7862;

/**
 * 通知 id 合法上界：掩到 **31 位**（`0x7FFFFFFF`）。
 *
 * 依据（SDK 声明，不是猜的）：
 *   · `NotificationRequest.id?: number`，文档只说"同 id 会**更新**该通知；**默认值 0**"
 *     （`notification/notificationRequest.d.ts:74-105`）——没写区间；
 *   · 平台侧通知 id 是 **32 位有符号整数**，且 **0 = 默认/未指定**。
 * ⇒ 我们只产出 `[1, 0x7FFFFFFF]`：**非负**、**避开 0**（不占用"默认值"语义）。
 */
export const NOTIFY_ID_MAX: number = 0x7FFFFFFF;

/**
 * 全部聊天提醒共用的**分组名**（系统会把同组通知折叠展示，而不是拉成一长条）。
 * 依据（SDK）：`NotificationRequest.groupName?: string` —— "When different notifications have the
 * same groupName, these notifications will be displayed as a group"（`notificationRequest.d.ts:331-340`，since 8）。
 */
export const NOTIFY_GROUP_NAME: string = 'xbot.chat';

/**
 * FNV-1a 32 位哈希（纯函数，确定性）。
 *
 * ⚠️ **刻意不用 `Math.imul`**：它虽是 ES2015 标准，但本模块的 ArkTS 侧我无法在本轮编译验证，
 *    不赌它存在。改用移位展开 FNV 质数 `16777619 = 2^24 + 2^8 + 147`：
 *      `x * prime ≡ (x<<24) + (x<<8) + x*147  (mod 2^32)`
 *    三项（各 `< 2^32`）之和 `< 2^53` ⇒ IEEE754 双精度**精确**，`>>> 0` 即"模 2^32 取无符号"。
 *    正确性不靠人眼：`tools/tests/notify.test.ts` 用 `Math.imul` 的教科书实现**逐字节对拍**。
 */
export function fnv1a32(text: string): number {
  let h: number = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const mixed: number = (h ^ text.charCodeAt(i)) >>> 0;
    h = ((mixed << 24) + (mixed << 8) + mixed * 147) >>> 0;
  }
  return h >>> 0;
}

/**
 * 32 位哈希 → 通知 id（纯函数）。
 * 取低 31 位保证非负；**让开** `0`（SDK 默认值）与回落 id（否则"无归属"的提醒会和某会话互相覆盖）。
 */
export function notificationIdFromHash(hash: number): number {
  const low: number = hash & NOTIFY_ID_MAX;
  if (low === 0 || low === NOTIFY_ID_FALLBACK) {
    return low + 1;
  }
  return low;
}

/**
 * 会话 → 通知 id（纯函数：**确定性** ⇒ 同一会话永远同一 id）。
 *
 * 语义（正是"专业"的部分）：
 *   · 同一会话的新提醒 ⇒ **更新**那一条（不堆叠）；
 *   · 不同会话 ⇒ **不同 id ⇒ 并存**（各自的提醒都留在通知中心）。
 *
 * ⚠️ **碰撞取舍（已知并接受）**：31 位空间（≈2.1e9），"同时挂着未读提醒的会话数"现实中
 *    是个位/十位数。以 100 个会话估算，碰撞概率 ≈ n²/2^32 ≈ **2.3e-6**；即便真撞上，后果是
 *    **两条提醒合并展示**（后到的更新前者，会话数据本身在应用里完好，不会丢消息）。
 *    可接受的另一个原因：确定性哈希是**跨进程重启稳定**的 —— 换成"启动后顺序分配 id"虽然零碰撞，
 *    但重启后同一会话换 id ⇒ 旧通知不被更新而**堆叠**，比极低概率的合并更糟。
 */
export function notificationIdFor(chatId: string): number {
  const id: string = chatId !== undefined && chatId !== null ? chatId : '';
  if (id.length === 0) {
    return NOTIFY_ID_FALLBACK;
  }
  return notificationIdFromHash(fnv1a32(id));
}

/** 角标数 = 还有几条未读提醒（纯函数：负数/NaN 归零、取整）。 */
export function badgeFor(remaining: number): number {
  if (remaining === undefined || remaining === null || !(remaining > 0)) {
    return 0;
  }
  return Math.floor(remaining);
}

// ── 模块级记账（内存态）：哪些会话"现在挂着未读提醒"────────────────────────────
//
// 用途：① 角标 = 未读提醒**条数**（不是"有/无"）；② 回前台只清"用户即将看到的那条"。
// ⚠️ 进程重启后为空：重启前留下的通知不在集合里 ⇒ 此时角标按 0 处理（与波1 行为一致），
//    不去猜"系统里还躺着几条"（系统侧查询 API 拿不到"属于哪个会话"这个维度）。
const pendingNotifyChats: Set<string> = new Set<string>();
/** 最近一次发出提醒的会话（`reconcileOnForeground` 未显式给 chatId 时清它）。 */
let lastNotifiedChatId: string = '';

/** 通知自动过期（10 分钟）：过期的提醒不该一直躺在通知中心。 */
const AUTO_DELETE_MS: number = 10 * 60 * 1000;
/** 目标应用（与 `AppScope/app.json5` 的 bundleName 一致）。 */
const BUNDLE_NAME: string = 'com.chronostasys.xbot';
/** 目标 ability（与 `module.json5` 的 EntryAbility 一致）——点击通知拉起它。 */
const ABILITY_NAME: string = 'EntryAbility';
/** 短时任务 reason（系统侧可见，写清楚用途）。 */
const KEEP_ALIVE_REASON: string = 'xbot 回合进行中';
/** 通知正文上限（系统 3072 字节，这里按字符截断；够用且可测）。 */
const MAX_BODY_CHARS: number = 120;

/**
 * 同一回合的多个"结束"信号（`phase_done` 与 `session idle` 会先后到达）只提醒一次。
 * ⚠️ 这是**体验取舍**：若用户 10 秒内又发一条并立刻切后台，第二条提醒会被吃掉
 * （此时他刚在应用里 ⇒ 见 `shouldNotify` 的前台抑制，本来也不该提醒）。
 */
export const TURN_DONE_DEDUPE_MS: number = 10000;

// ── 纯判定（可脱机单测；无 SDK 依赖）────────────────────────────────────────

/**
 * 判定"这个事件该不该发通知"（**纯函数**，与调用点同源）。
 *
 * @param appForeground 应用是否在前台（前台 ⇒ 用户正看着 ⇒ 不发）
 * @param evKind        `notifyKindForSse(...)` 给出的档位
 */
export function shouldNotify(appForeground: boolean, evKind: string): boolean {
  if (appForeground) {
    return false;
  }
  return evKind === NOTIFY_KIND_ASK || evKind === NOTIFY_KIND_TURN_DONE;
}

/** `session` 事件里代表"会话空闲"的 action（与 store 既有判定同一份字面量）。 */
export function isIdleSessionAction(action: string): boolean {
  return action === 'idle' || action === 'agent-idle' || action === 'session_idle';
}

/**
 * 一条 SSE 消息 → 通知档位（纯函数）。
 *
 * 判据与状态机**同源**：turn 结束直接看 `normalizeEvent` 产出的 `phase_done`
 * （不再二次解析载荷，也不另立一套判断）。
 */
export function notifyKindForSse(
  event: string,
  sessionAction: string,
  evs: readonly DomainEvent[] | null,
): string {
  if (event === 'ask_user') {
    return NOTIFY_KIND_ASK;
  }
  if (evs !== null) {
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].type === 'phase_done') {
        return NOTIFY_KIND_TURN_DONE;
      }
    }
  }
  if (event === 'session' && isIdleSessionAction(sessionAction)) {
    return NOTIFY_KIND_TURN_DONE;
  }
  return NOTIFY_KIND_NONE;
}

/** 去重窗口：上次提醒发生在此窗口内 ⇒ 这次不发。 */
export function withinDedupeWindow(nowMs: number, lastAtMs: number, windowMs: number): boolean {
  if (lastAtMs <= 0) {
    return false;
  }
  return nowMs - lastAtMs < windowMs;
}

/** 通知标题（纯函数）：带上会话名，便于多会话下分辨。 */
export function notifyTitle(kind: string, label: string): string {
  const head: string = kind === NOTIFY_KIND_ASK ? '需要你的回答' : '回合已完成';
  const l: string = label !== undefined && label !== null ? label.trim() : '';
  return l.length > 0 ? `${head} · ${l}` : head;
}

/** 通知正文（纯函数）：优先用细节（问题原文等），过长截断。 */
export function notifyBody(kind: string, detail: string): string {
  const d: string = detail !== undefined && detail !== null ? detail.trim() : '';
  if (d.length > 0) {
    return d.length > MAX_BODY_CHARS ? `${d.substring(0, MAX_BODY_CHARS)}…` : d;
  }
  return kind === NOTIFY_KIND_ASK ? '智能体在等待你的输入' : '本轮回复已完成';
}

// ── 前台标志（AppStorage 唯一真值；脱机读不到时保守取"前台"）─────────────────

/** EntryAbility 在 onCreate/onForeground/onBackground 调用（单一写入点）。 */
export function setAppForeground(foreground: boolean): void {
  try {
    AppStorage.setOrCreate<boolean>(APP_FOREGROUND_KEY, foreground);
  } catch (e) {
    // 脱机/异常：无 ArkUI 时静默（此时 appIsForeground 会回落到"前台"）
  }
}

/**
 * 应用是否在前台。
 * ⚠️ 读不到（脱机单测 / 异常）⇒ 返回 `true`（视为前台 ⇒ **抑制**通知）：
 *    宁可少发一条，也不要在测试或异常态里连发通知。
 */
export function appIsForeground(): boolean {
  try {
    const v: boolean | undefined = AppStorage.get<boolean>(APP_FOREGROUND_KEY);
    return v === true;
  } catch (e) {
    return true;
  }
}

// ── SDK 封装（全部 try/catch + 返回 boolean；失败绝不外抛）───────────────────

/**
 * 建槽（幂等）：已有 `SOCIAL_COMMUNICATION` 槽就直接返回，否则新建。
 * 用 `getSlots()` 先查而不是无脑 `addSlot()` ——"同一类型只能建一个"，重复建
 * 在部分版本上会报错；我们要求**幂等**。
 */
export async function initSlots(): Promise<boolean> {
  try {
    const slots: notificationManager.NotificationSlot[] = await notificationManager.getSlots();
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].notificationType === notificationManager.SlotType.SOCIAL_COMMUNICATION) {
        return true;
      }
    }
  } catch (e) {
    // 查询失败不阻断：继续尝试 addSlot（下面还会兜一次）
  }
  try {
    await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
    return true;
  } catch (e) {
    console.warn(`xbot notify: addSlot 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/**
 * 确保通知已授权；未授权则弹系统授权框。
 * ⚠️ **必须在 UI 加载完成后调用**（EntryAbility 的 `loadContent` 回调里）——
 *    授权框需要一个已就绪的 UIAbility 上下文。
 */
export async function ensureEnabled(ctx: common.UIAbilityContext): Promise<boolean> {
  try {
    const enabled: boolean = await notificationManager.isNotificationEnabled();
    if (enabled) {
      return true;
    }
    await notificationManager.requestEnableNotification(ctx);
    return true;
  } catch (e) {
    // 1600004（通知被禁用）/ 1600013（授权框已在展示）等都在此吞掉：
    // 用户拒过一次后系统不再弹框（需去设置页），这是平台语义，不是错误路径。
    console.warn(`xbot notify: 授权检查失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/**
 * 发一条通知（回合结束 / 待回答）。点击 → 拉起本应用并带 `parameters.chat_id`
 * （EntryAbility.onNewWant 接收）。
 */
export async function publishTurn(title: string, text: string, chatId: string): Promise<boolean> {
  try {
    const params: Record<string, Object> = { 'chat_id': chatId };
    const info: wantAgent.WantAgentInfo = {
      wants: [
        {
          bundleName: BUNDLE_NAME,
          abilityName: ABILITY_NAME,
          parameters: params,
        },
      ],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    };
    const agent: Object = await wantAgent.getWantAgent(info);
    const content: notificationManager.NotificationContent = {
      notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
      normal: { title: title, text: text },
    };
    const request: notificationManager.NotificationRequest = {
      // ⭐ 按会话派生 id：同会话**更新**那一条，不同会话**并存**（见 notificationIdFor 的碰撞取舍）
      id: notificationIdFor(chatId),
      content: content,
      wantAgent: agent,
      notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
      // 同一应用的所有聊天提醒归一组 ⇒ 系统可折叠展示（SDK since 8 支持）
      groupName: NOTIFY_GROUP_NAME,
      autoDeletedTime: Date.now() + AUTO_DELETE_MS,
      tapDismissed: true,
      // 同一 id 的更新不重复响铃（phase_done 与 session idle 会各来一次）
      isAlertOnce: true,
    };
    await notificationManager.publish(request);
    // 记账：该会话现在有未读提醒（角标计数 + 回前台"只清该会话"的依据）
    if (chatId !== undefined && chatId !== null && chatId.length > 0) {
      pendingNotifyChats.add(chatId);
      lastNotifiedChatId = chatId;
    }
    await setBadge(badgeFor(pendingNotifyChats.size));
    return true;
  } catch (e) {
    console.warn(`xbot notify: publish 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/** 角标（未读提醒数）。 */
export async function setBadge(n: number): Promise<boolean> {
  try {
    await notificationManager.setBadgeNumber(Math.max(0, Math.floor(n)));
    return true;
  } catch (e) {
    console.warn(`xbot notify: setBadge 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/** 清掉本应用**全部**通知（登出/换账号等"整机清场"场景）。 */
export async function clearAll(): Promise<boolean> {
  try {
    await notificationManager.cancelAll();
    pendingNotifyChats.clear();
    lastNotifiedChatId = '';
    await setBadge(0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 清掉**某一个会话**的提醒（进入该会话 / 回前台时调用）。
 *
 * 依据（SDK）：`cancel(id: number, label?: string): Promise<void>` —— 按 id（+label）取消单条通知；
 * `label` 缺省 = 空 label，而我们的 `publish` 不设 `label` ⇒ `cancel(id)` 恰好命中它
 * （`@ohos.notificationManager.d.ts:234`；`notificationRequest.d.ts` 的 `label` 默认空）。
 * ⚠️ 通知不存在时 SDK 抛 `1600007` —— 对我们**不是错误**（本来就该是空的）⇒ 静默视为成功。
 */
export async function clearForChat(chatId: string): Promise<boolean> {
  let ok: boolean = false;
  try {
    await notificationManager.cancel(notificationIdFor(chatId));
    ok = true;
  } catch (e) {
    const err: BusinessError = e as BusinessError;
    ok = err !== undefined && err.code === 1600007;
    if (!ok) {
      console.warn(`xbot notify: cancel 失败（忽略）: ${describeError(e as Object)}`);
    }
  }
  if (chatId !== undefined && chatId !== null && chatId.length > 0) {
    pendingNotifyChats.delete(chatId);
  }
  // 角标 = 剩余未读提醒数（只清了一个会话 ⇒ 其余会话的通知仍在，角标不为 0）
  await setBadge(badgeFor(pendingNotifyChats.size));
  return ok;
}

/**
 * 回前台对账：**只清"用户即将看到的那条"**，其余会话的提醒**保留**（专业语义）。
 *
 * 为什么不能像之前那样 `cancelAll()`：用户进的是 A 会话，B 会话的提醒还没看 ⇒ 不该被清掉。
 *
 * @param chatId 页面**当前**会话。缺省 ⇒ 用最近一次发出提醒的会话（`lastNotifiedChatId`）。
 *        ⚠️ `EntryAbility.onForeground` 拿不到页面当前会话 ⇒ 现在走缺省路径；
 *        **波3b-2** 可以在那里把 `store.currentChatId` 传进来（接口已支持），语义会更精确。
 *        另外"进入某会话"这条路径已由 `store.openSession` 调 `clearForChat` 覆盖。
 */
export async function reconcileOnForeground(chatId: string = ''): Promise<void> {
  const target: string = chatId !== undefined && chatId !== null && chatId.length > 0
    ? chatId
    : lastNotifiedChatId;
  if (target.length > 0) {
    await clearForChat(target); // 内部已同步角标
    return;
  }
  // 没有已知的待清会话（冷启动 / 从未发过提醒）⇒ 只归零角标，**不动**其他会话的通知
  await setBadge(badgeFor(pendingNotifyChats.size));
}

// ── 备1：短时任务兜底（≤3 分钟；本轮只提供函数与生命周期）────────────────────

/** 当前短时任务 requestId（<0 = 无）。模块级单例：同一时刻只申请一个。 */
let keepAliveRequestId: number = -1;

/**
 * 申请短时任务：覆盖"用户发完消息立刻切后台"（此时回合还没结束）。
 * ⚠️ 短时任务**不保活进程**，只保证这段时间内不被冻结（系统上限 3 分钟，
 *    低电量时更短，见 `DelaySuspendInfo.actualDelayTime`）。
 * 幂等：已有在手直接返回 true。
 */
export function beginTurnKeepAlive(): boolean {
  try {
    if (keepAliveRequestId >= 0) {
      return true;
    }
    const info: backgroundTaskManager.DelaySuspendInfo =
      backgroundTaskManager.requestSuspendDelay(KEEP_ALIVE_REASON, () => {
        // 系统在超时前 ~6 秒回调 ⇒ 句柄即将失效，标记为无（回合结算时会再 end 一次，幂等）
        keepAliveRequestId = -1;
      });
    keepAliveRequestId = info.requestId;
    return true;
  } catch (e) {
    console.warn(`xbot notify: requestSuspendDelay 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/** 结束短时任务（幂等）。入口：回合结束 / 回到前台。 */
export function endTurnKeepAlive(): void {
  try {
    if (keepAliveRequestId >= 0) {
      backgroundTaskManager.cancelSuspendDelay(keepAliveRequestId);
    }
  } catch (e) {
    // 取消失败无副作用（系统超时后自动回收）
  } finally {
    keepAliveRequestId = -1;
  }
}
