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

/** 通知 id 固定 ⇒ 后发通知**替换**前一条（不堆叠成一串）。 */
const NOTIFY_ID: number = 0x7862;
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
      id: NOTIFY_ID,
      content: content,
      wantAgent: agent,
      notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
      autoDeletedTime: Date.now() + AUTO_DELETE_MS,
      tapDismissed: true,
      // 同一 id 的更新不重复响铃（phase_done 与 session idle 会各来一次）
      isAlertOnce: true,
    };
    await notificationManager.publish(request);
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

/** 清掉本应用的通知（回前台对账：用户已经看到内容了）。 */
export async function clearAll(): Promise<boolean> {
  try {
    await notificationManager.cancelAll();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 回前台对账：清角标 + 清通知。
 * "三档状态"里"前台"这一档的收尾动作（后台/未知档由通知本身承担）。
 */
export async function reconcileOnForeground(): Promise<void> {
  await setBadge(0);
  await clearAll();
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
