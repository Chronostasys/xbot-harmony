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
import { NotifyPrefs, notifyPrefsFrom } from './settings';

// ── 常量（协议/契约值，调用点共用）──────────────────────────────────────────

/** 通知档位：不需要通知。 */
export const NOTIFY_KIND_NONE: string = '';
/** 通知档位：智能体在等用户回答（最高价值的一条）。 */
export const NOTIFY_KIND_ASK: string = 'ask_user';
/** 通知档位：回合结束。 */
export const NOTIFY_KIND_TURN_DONE: string = 'turn_done';

/**
 * 标题前缀（**契约值**）：`notifyTitle` 产出、`kindFromNotifyTitle` 反解 —— 二者共用同一对字面量。
 *
 * 为什么要反解：调用点（`core/store.ets` 的 `notifyOnSse`）只把 `notifyTitle(...)` 的**结果**传进
 * `publishTurn`，档位本身没跟随 ⇒ `publishTurn` 必须能从标题**确定地**还原档位（决定 slot /
 * 动作按钮 / 多行形态）。用同一对常量产出与解析，杜绝"改了一处忘了另一处"。
 */
export const NOTIFY_TITLE_HEAD_ASK: string = '需要你的回答';
export const NOTIFY_TITLE_HEAD_TURN_DONE: string = '回合已完成';

/** `AppStorage` 键：应用是否在前台（由 EntryAbility 的 onForeground/onBackground 维护）。 */
export const APP_FOREGROUND_KEY: string = 'appForeground';
/** `AppStorage` 键：通知点击带来的待打开会话（EntryAbility.onNewWant 写入）。 */
export const PENDING_CHAT_KEY: string = 'pendingOpenChatId';
/** `AppStorage` 键：上述待打开会话的**序号**（同一会话二次点击也要能被页面察觉）。 */
export const PENDING_CHAT_SEQ_KEY: string = 'pendingOpenChatSeq';
/**
 * `AppStorage` 键：通知**动作按钮**带来的动作 id（EntryAbility 从 `want.parameters.notify_action` 读）。
 *
 * 契约：动作按钮的 `WantAgent` 用 `START_ABILITY` + `parameters{chat_id, notify_action}`（见 `publishTurn`）。
 * 页面消费后应 `AppStorage.delete`（与 `PENDING_CHAT_KEY` 同款；**接线在页面**）。
 * 为什么走"拉起 App 带参数"而不是 `SEND_COMMON_EVENT`：后者要求 App **当时活着**才能收到
 * （三方无静态订阅者/常驻扩展），冷启动时按钮就成了死键 ⇒ 见交付里的方案对比。
 */
export const PENDING_ACTION_KEY: string = 'pendingNotifyAction';

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
 * 每个**会话**一个通知组：`${NOTIFY_GROUP_NAME}#${chatId}`。
 *
 * SDK 依据（`api/notification/notificationRequest.d.ts:331-340` 原文）：
 *   "When different notifications have the same **groupName**, these notifications will be
 *    displayed as a group. **The size does not exceed 202 bytes**, and the excess part will be truncated."
 *   ⇒ 系统**按 groupName 自动分组**；本文件**没有** `groupSummary` / `isGroupSummary` 之类的
 *     "显式摘要通知"字段（全文件 grep 无）⇒ 不需要另发一条 summary。
 *
 * 为什么从"全局一个组"改成"每会话一组"：原来所有会话堆在**同一簇**里，用户看到的是
 * "一堆混在一起的通知"；per-chat 后同一会话的 `turn_done`/`ask` 归一簇，**跨会话不混**。
 * ⚠️ 202 字节上限：`NOTIFY_GROUP_NAME` 是固定前缀，chatId 是服务端 id（约 17 字符）⇒ 远未逼近；
 *    仍写 `clampGroupName` 兜底（**不为未发生的输入编造裁剪逻辑之外的语义**：超限就截断，与 SDK 同行为）。
 */
export function notifyGroupOf(chatId: string): string {
  const c: string = chatId !== undefined && chatId !== null ? chatId : '';
  // 没有 chatId（理论不可达：publishTurn 恒带会话）⇒ 回落全局组，保持旧行为可辨识
  if (c.length === 0) {
    return NOTIFY_GROUP_NAME;
  }
  return clampGroupName(`${NOTIFY_GROUP_NAME}#${c}`);
}

/** groupName 字节上限（SDK 原文 202；按 UTF-8 字节裁，避免多字节被 SDK 从中间截断）。 */
export const GROUP_NAME_MAX_BYTES: number = 202;

/** 按**UTF-8 字节**截到 `GROUP_NAME_MAX_BYTES`（不抛；超限即截，与 SDK 的截断行为一致）。 */
export function clampGroupName(s: string): string {
  const src: string = s !== undefined && s !== null ? s : '';
  if (utf8Len(src) <= GROUP_NAME_MAX_BYTES) {
    return src;
  }
  let out: string = '';
  let used: number = 0;
  // 逐个码点累加，遇到下一个会越界就停（不切半个多字节字符）
  for (let i = 0; i < src.length; i++) {
    const ch: number = src.charCodeAt(i);
    const w: number = ch < 0x80 ? 1 : (ch < 0x800 ? 2 : 3);
    if (used + w > GROUP_NAME_MAX_BYTES) {
      break;
    }
    out += src.charAt(i);
    used += w;
  }
  return out;
}

/** UTF-8 字节长度（纯函数；用于 202 字节上限判据）。 */
export function utf8Len(s: string): number {
  const src: string = s !== undefined && s !== null ? s : '';
  let n: number = 0;
  for (let i = 0; i < src.length; i++) {
    const c: number = src.charCodeAt(i);
    n += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
  }
  return n;
}

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

// ── 未读角标：语义定义 + 计数 + 与系统对账 ─────────────────────────────────────
//
// 【什么是"未读"】**已发出系统通知、但用户尚未在应用里看过的那条会话提醒**。
//   它不是业务状态（后端才是消息/回合状态的权威），只是**本地提醒计数**：
//   · **+1（按会话去重）**：`publishTurn` 成功发出一条提醒时（只可能在应用**不在前台**时发生
//     —— 见 `shouldNotify` 的前台抑制；同一会话多次提醒仍只算 1 条未读）；
//   · **-1**：该会话的通知被清掉时（`clearForChat`）—— 入口是"用户进入了那个会话"
//     （`store.openSession` → `clearForChat`）；
//   · **归零**：`clearAll`（登出/换账号）；或与**系统对账**时系统侧已无活动通知。
//   ⚠️ 角标与通知**同生共死**：两者都从同一处派生（每次通知增/减后立刻重算），
//      因此不会出现"通知清了、角标还在"。
//
// 【为什么要与系统对账】本地计数是内存态，进程被系统杀掉后会归零，而通知中心里可能
//   还躺着通知 ⇒ 角标会假性为 0。`notificationManager.getActiveNotificationCount()`
//   （**公开 API，since 9，无需权限**；其文档原文就是 "suitable for scenarios where an
//   unread notification count prompt needs to be displayed"，
//   `@ohos.notificationManager.d.ts:540-572`）给出**系统侧权威条数** ⇒ 优先采用它，
//   读不到（异常/环境不支持）才回落到本地计数。

/** 角标数 = 还有几条未读提醒（纯函数：负数/NaN 归零、取整）。 */
export function badgeFor(remaining: number): number {
  if (remaining === undefined || remaining === null || !(remaining > 0)) {
    return 0;
  }
  return Math.floor(remaining);
}

/**
 * 角标决策（纯函数）：**系统读数优先**，读不到（<0）回落到本地记账。
 * @param systemCount 系统侧活动通知数；**负数 = 没读到**（异常/不支持）
 * @param localCount  本地记账（未读会话数）
 */
export function badgeFromCounts(systemCount: number, localCount: number): number {
  if (systemCount !== undefined && systemCount !== null && systemCount >= 0) {
    return badgeFor(systemCount);
  }
  return badgeFor(localCount);
}

/**
 * 未读提醒计数（**可脱机单测**）：内部是"会话集合"，因此**不可能为负**，
 * 且同一会话反复提醒只算 1 条未读（这正是"按会话"而非"按次数"）。
 */
export class UnreadCounter {
  private ids: Set<string> = new Set<string>();

  /** 记一个"有未读提醒"的会话（幂等；空 id 忽略）。 */
  add(chatId: string): void {
    if (chatId !== undefined && chatId !== null && chatId.length > 0) {
      this.ids.add(chatId);
    }
  }

  /** 该会话的未读已消费（用户看过 / 通知已清）。 */
  remove(chatId: string): void {
    if (chatId !== undefined && chatId !== null && chatId.length > 0) {
      this.ids.delete(chatId);
    }
  }

  has(chatId: string): boolean {
    return this.ids.has(chatId);
  }

  /** 归零（登出/换账号）。 */
  clear(): void {
    this.ids.clear();
  }

  /** 未读**会话数**（集合语义 ⇒ 恒 ≥ 0）。 */
  count(): number {
    return this.ids.size;
  }
}

/** 本地未读记账（模块级单例）。 */
const unread: UnreadCounter = new UnreadCounter();
/** 最近一次发出提醒的会话（`reconcileOnForeground` 未显式给 chatId 时清它）。 */
let lastNotifiedChatId: string = '';

/**
 * 与系统对账 → 重算角标。**所有**通知增/减路径都走它（角标与通知同生共死）。
 * 系统读数不可得时回落到本地记账（见 `badgeFromCounts`）。
 */
async function syncBadge(): Promise<void> {
  let systemCount: number = -1;
  try {
    systemCount = await notificationManager.getActiveNotificationCount();
  } catch (e) {
    // 读不到不是错误路径：回落到本地记账（脱机测试也在这一支）
  }
  await setBadge(badgeFromCounts(systemCount, unread.count()));
}

/** 通知自动过期（10 分钟）：过期的提醒不该一直躺在通知中心。 */
const AUTO_DELETE_MS: number = 10 * 60 * 1000;
/** 目标应用（与 `AppScope/app.json5` 的 bundleName 一致）。 */
const BUNDLE_NAME: string = 'com.chronostasys.xbot';
/** 目标 ability（与 `module.json5` 的 EntryAbility 一致）——点击通知拉起它。 */
const ABILITY_NAME: string = 'EntryAbility';
/** 短时任务 reason（系统侧可见，写清楚用途）。 */
const KEEP_ALIVE_REASON: string = 'xbot 回合进行中';

// ── 「专业级」正文形态（纯常量 + 纯判据；全部有 SDK 依据，见各条注释）──────────────
//
// 背景：系统通知的正文分三种形态（`notification/notificationContent.d.ts`）：
//   · BASIC_TEXT（`normal`）：折叠态只显示一行 title + text；
//   · MULTILINE（`multiLine`）：展开后按 `lines` 显示**最多 3 行**；
//   · LONG_TEXT（`longText`）：展开后显示一整段长文本。
// 我们只在前两者之间选：MULTILINE 更贴合"回合回复"的**结构化多行**语义，且 3 行 × 1024 字节
// 的容量远大于任何一次回复摘要 ⇒ **在容量内绝不需要 `…` 截断**（见 notifyShapeFor）。

/** 折叠态正文（`normal.text`）字数：**超过**它就把正文升级为多行形态（见 `notifyShapeFor`）。 */
export const COLLAPSED_MAX_CHARS: number = 120;

/**
 * 多行形态最多行数。依据（SDK）：`NotificationMultiLineContent.lines` ——
 * "supports up to three lines"（`notification/notificationContent.d.ts:167-174`）。
 */
export const MULTILINE_MAX_LINES: number = 3;

/**
 * 多行形态**每行字节**上界。依据（SDK）：每行 "size does not exceed 1024 bytes"
 * （`notification/notificationContent.d.ts:168`）。留 24 字节余量以容纳多字节字符本位的口径差。
 */
export const MULTILINE_MAX_LINE_BYTES: number = 1000;

/**
 * 标题字节上界。依据（SDK）：`NotificationBasicContent.title` —— "The size does not exceed
 * **1024 bytes**, and the excess part will be truncated."（`notification/notificationContent.d.ts:38-46`）。
 * 留 24 字节余量（多字节字符的字节口径差）。
 */
export const MAX_TITLE_BYTES: number = 1000;

/**
 * 折叠态正文（`normal.text`）字节上界。依据（SDK）：`NotificationBasicContent.text` ——
 * "The size does not exceed **3072 bytes**"（`notification/notificationContent.d.ts:47-55`）。
 */
export const MAX_TEXT_BYTES: number = 3000;

/**
 * 多行总量上界 = 行数 × 每行字节（3 × 1000 = 3000 ≤ 3072 的 `text` 上限，自洽）。
 * 超过它 ⇒ 触发"优雅退化"（见 `NOTIFY_MORE_HINT`）。
 */
export const MULTILINE_TOTAL_BYTES: number = MULTILINE_MAX_LINES * MULTILINE_MAX_LINE_BYTES;

/**
 * 长文本形态（`NotificationLongTextContent.longText`）的字节上界。依据（SDK）：`longText` ——
 * "The size does not exceed **3072 bytes**, and the excess part will be truncated."
 * （`notification/notificationContent.d.ts:96-105`）。留 72 字节余量（多字节字符的字节口径差
 * + 退化提示语 `NOTIFY_MORE_HINT`）。
 */
export const MAX_LONG_TEXT_BYTES: number = 3000;

/**
 * **优雅退化的提示语**：正文塞不下 3 行时，末行改用它 —— 告诉用户"更多内容在应用内"，
 * 而不是丢半句话让人费解。点通知/动作按钮即深链进会话看全部。
 */
export const NOTIFY_MORE_HINT: string = '…完整内容见应用内';

// ── 动作按钮契约（**纯 id + 标题**；SDK 枚举与 WantAgent 在边界处才出现）──────────
//
// 依据（SDK）：`NotificationRequest.actionButtons?: Array<NotificationActionButton>`，**最多 2 枚**
//   （`notificationRequest.d.ts:291-298`，since 7）；每枚 = `{title, wantAgent}`
//   （`notificationActionButton.d.ts:30-66`）。按钮点击 ⇒ 执行它的 `WantAgent`。
//
// ⚠️ **只发射"今天真能用"的按钮**（避免"点了没用的死键"）：
//   · `open`（「查看」）= `START_ABILITY` + `parameters{chat_id}` ⇒ 深链到会话，**端到端已通**
//     （`EntryAbility.captureOpenChat` → `pendingOpenChatId` → 页面消费，上一轮真机验过）；
//   · `stop` / `continue` = 需要**页面执行**对应的能力（停止在跑的回合 / 继续排队）⇒
//     deep-link 通道已就绪（连带 `notify_action` 参数一起投递，EntryAbility 已捕获），
//     但"执行"那一步在 `pages/Index.ets`（**我的禁改区**）⇒ 见交付的接线清单，暂不发射。
export const NOTIFY_ACTION_OPEN: string = 'open';
export const NOTIFY_ACTION_STOP: string = 'stop';
export const NOTIFY_ACTION_CONTINUE: string = 'continue';

/**
 * 通知最多几枚动作按钮。依据（SDK）：`NotificationRequest.actionButtons` ——
 * "A notification can contain **a maximum of two buttons**. Since API version 16, a notification can contain a
 * maximum of three buttons for wearables."（`notificationRequest.d.ts:291-298`）。
 * ⇒ 手机取 2。
 */
export const NOTIFY_MAX_ACTIONS: number = 2;

/** 已知动作 id（白名单：外来 `want` 参数只认这些，避免注入任意串）。 */
export function isKnownNotifyAction(id: string): boolean {
  return id === NOTIFY_ACTION_OPEN || id === NOTIFY_ACTION_STOP || id === NOTIFY_ACTION_CONTINUE;
}

/** 动作按钮描述（纯值对象：`title` 给系统渲染，`id` 随 `want` 带回）。 */
export class NotifyAction {
  id: string;
  title: string;

  constructor(id: string, title: string) {
    this.id = id;
    this.title = title;
  }
}

/**
 * 档位 → **要发射的**动作按钮（纯函数）。
 *
 * 现只发射「查看」（端到端可用）。`stop`/`continue` 见上面契约注释 —— 需要页面执行，
 * 一旦页面接线，把这里改成 `push(new NotifyAction(NOTIFY_ACTION_STOP, '停止'))` 即可（一行）。
 */
export function notifyActionsFor(kind: string): NotifyAction[] {
  // **按档位发射真实可用的按钮**（手机上限 2 枚，`notification/notificationRequest.d.ts:291-298`）。
  // 「查看」不再占按钮位 —— 点通知**本体**已走同一条 `START_ABILITY + parameters` 直达链路。
  // ⛔ 纪律：只发射「今天真能执行」的动作。两个 id 都已在页面侧接线
  //    （`pages/Index.ets` 的 `consumePendingAction` → `store.cancel()` / `store.send('/continue')`，`de25ae1`）：
  //    · `ask_user`  = 智能体在等回答 ⇒ 按钮「去回答」= 直达会话（`open`）
  //    · `turn_done` = 回合结束       ⇒ 按钮「继续」  = 让智能体接着干（`continue`）
  if (kind === NOTIFY_KIND_ASK) {
    return [new NotifyAction(NOTIFY_ACTION_OPEN, '去回答')];
  }
  return [new NotifyAction(NOTIFY_ACTION_CONTINUE, '继续')];
}

/** 动作 id → 按钮标题（展示文案的**单一真值**）。 */
export function notifyActionTitle(id: string): string {
  if (id === NOTIFY_ACTION_STOP) {
    return '停止';
  }
  if (id === NOTIFY_ACTION_CONTINUE) {
    return '继续';
  }
  return '查看';
}

/** 外来 `want.parameters.notify_action` → 白名单动作 id（纯函数；非法/缺失 ⇒ 空串）。 */
export function notifyActionFromParam(raw: Object | undefined): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw !== 'string') {
    return '';
  }
  const s: string = raw as string;
  return isKnownNotifyAction(s) ? s : '';
}

/**
 * 同一回合的多个"结束"信号（`phase_done` 与 `session idle` 会先后到达）只提醒一次。
 * ⚠️ 这是**体验取舍**：若用户 10 秒内又发一条并立刻切后台，第二条提醒会被吃掉
 * （此时他刚在应用里 ⇒ 见 `shouldNotify` 的前台抑制，本来也不该提醒）。
 */
export const TURN_DONE_DEDUPE_MS: number = 10000;

// ── 纯判定（可脱机单测；无 SDK 依赖）────────────────────────────────────────

// ── 通知偏好（哪些事件才打扰）：模块级缓存 + 纯判据 ────────────────────────────
//
// 偏好来自设置表（`core/settings.ets` 的 `KEY_NOTIFY_ASK` / `KEY_NOTIFY_TURN_DONE`），由页面在
// 设置加载/变更时调 `applyNotifyPrefs(settings)` 投进来（**接线清单**在交付里给，本文件不碰 UI）。
// 缓存在模块级而不是每次都读设置表：`shouldNotify` 在 SSE 热路径上被调用，读设置表要走
// `AppStorage`/RPC，代价不必要；缓存的更新点是**离散**的（用户改开关时）。
//
// 默认 = `notifyPrefsFrom({})`（两类都开）⇒ 未接线/脱机单测时与"接线前"逐字等价，不会少发。

/** 当前通知偏好（模块级单例；默认两类都开）。 */
let currentPrefs: NotifyPrefs = notifyPrefsFrom({});

/**
 * 用设置表刷新偏好（UI 接线点：设置加载后 / 任一通知开关变更后调用）。
 * 纯逻辑在 `settings.notifyPrefsFrom`，这里只做缓存 + 返回真值（便于页面/测试断言）。
 */
export function applyNotifyPrefs(settings: Record<string, string>): NotifyPrefs {
  currentPrefs = notifyPrefsFrom(settings !== undefined && settings !== null ? settings : {});
  return currentPrefs;
}

/** 当前偏好（只读快照；测试用）。 */
export function notifyPrefsSnapshot(): NotifyPrefs {
  return currentPrefs;
}

/** 档位 × 偏好 → 该类事件是否被允许（纯函数）。 */
export function notifyPrefEnabled(prefs: NotifyPrefs, evKind: string): boolean {
  if (evKind === NOTIFY_KIND_ASK) {
    return prefs.ask;
  }
  if (evKind === NOTIFY_KIND_TURN_DONE) {
    return prefs.turnDone;
  }
  return false;
}

/**
 * 判定"这个事件该不该发通知"（**在给定偏好下**的纯判据；与调用点同源）。
 *
 * @param appForeground 应用是否在前台（前台 ⇒ 用户正看着 ⇒ 不发）
 * @param evKind        `notifyKindForSse(...)` 给出的档位
 * @param prefs         哪个档位才打扰（`notifyPrefEnabled`）
 */
export function shouldNotifyWithPrefs(appForeground: boolean, evKind: string, prefs: NotifyPrefs): boolean {
  if (appForeground) {
    return false;
  }
  return notifyPrefEnabled(prefs, evKind);
}

/**
 * 判定"这个事件该不该发通知"（**线上入口**，调用点 `store.notifyOnSse` 用它）。
 *
 * = 前台抑制 + 当前偏好。偏好取自模块级缓存（见 `applyNotifyPrefs`）——
 * 未接线时缓存是默认值（两类都开）⇒ 行为与接线前**逐字相同**。
 */
export function shouldNotify(appForeground: boolean, evKind: string): boolean {
  return shouldNotifyWithPrefs(appForeground, evKind, currentPrefs);
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
  const head: string = kind === NOTIFY_KIND_ASK ? NOTIFY_TITLE_HEAD_ASK : NOTIFY_TITLE_HEAD_TURN_DONE;
  const l: string = label !== undefined && label !== null ? label.trim() : '';
  return l.length > 0 ? `${head} · ${l}` : head;
}

/**
 * 标题 → 档位（纯函数，`notifyTitle` 的**逆**）。
 *
 * 未知标题 → `turn_done`（保守：不因看不出档位就把它当"最高价值"去弹横幅/响铃）；
 * 但要**先判 ask**（ask 头与 turn_done 头互不为前缀，顺序其实无关，这里写死更清楚）。
 */
export function kindFromNotifyTitle(title: string): string {
  const t: string = title !== undefined && title !== null ? title : '';
  return t.startsWith(NOTIFY_TITLE_HEAD_ASK) ? NOTIFY_KIND_ASK : NOTIFY_KIND_TURN_DONE;
}

/**
 * 通知正文（纯函数）：优先用细节（问题原文等）；无细节回落默认文案。
 *
 * ⚠️ **这里不再按字数截断**（旧版到 120 字砍断）—— 截断/形态是**下游** `notifyBodyPlan` 的职责：
 *    长正文会升级为多行形态（`lines`）而**保留全文**，只有真的塞不进 3 行时才在**最后一行**省略。
 *    若在这里先砍到 120 字，多行形态永远看不到超过 120 字的内容（多行就成了摆设）。
 */
export function notifyBody(kind: string, detail: string): string {
  const d: string = detail !== undefined && detail !== null ? detail.trim() : '';
  if (d.length > 0) {
    return d;
  }
  return kind === NOTIFY_KIND_ASK ? '智能体在等待你的输入' : '本轮回复已完成';
}

/** 默认正文（纯函数）：无细节时的兜底文案（`notifyBody` 与形态规划共用）。 */
export function defaultNotifyBody(kind: string): string {
  return kind === NOTIFY_KIND_ASK ? '智能体在等待你的输入' : '本轮回复已完成';
}

/** 文本的 UTF-8 字节数（纯函数）。系统上限都以**字节**计（title 1024 / text 3072 / 行 1024）。 */
export function utf8Bytes(text: string): number {
  const s: string = text !== undefined && text !== null ? text : '';
  let n: number = 0;
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      // 代理对（emoji 等）：一个码点 4 字节，且跳过低位代理
      n += 4;
      i += 1;
    } else {
      n += 3;
    }
  }
  return n;
}

/**
 * 按**字节**截断（纯函数；不切开码点，**不补省略号**）—— 返回能装下的最长前缀。
 * 是 `truncateToBytes` 与"退化提示行"（`withMoreHint`）共用的底座。
 */
export function truncateBytesRaw(text: string, maxBytes: number): string {
  const s: string = text !== undefined && text !== null ? text : '';
  if (maxBytes <= 0) {
    return '';
  }
  if (utf8Bytes(s) <= maxBytes) {
    return s;
  }
  // 逐 UTF-16 单元累积，遇到"再加这个单元就超字节"时停下；代理对整对进（不劈开 emoji）
  let used: number = 0;
  let end: number = 0;
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    let add: number = 1;
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      add = 4;
    } else if (c >= 0x80 && c < 0x800) {
      add = 2;
    } else if (c >= 0x800) {
      add = 3;
    }
    if (used + add > maxBytes) {
      break;
    }
    used += add;
    end = i + 1;
    if (add === 4) {
      i += 1;
      end = i + 1;
    }
  }
  return s.substring(0, end);
}

/**
 * 按**字节**截断（纯函数；不切开码点，**截断则补 `…`**）。
 * 用于真塞不下的兜底（长正文 > 3 行的总容量），正常路径不触发（见 `bodyLines`）。
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  const s: string = text !== undefined && text !== null ? text : '';
  if (maxBytes <= 0) {
    return '';
  }
  const raw: string = truncateBytesRaw(s, maxBytes);
  return raw.length === s.length ? s : `${raw}…`;
}

/**
 * 折叠态正文摘要（纯函数）：把换行/连续空白压成单空格 → 截到 `maxChars`（够长才补 `…`）。
 * 用在 `normal.text` / `briefText`（系统只在折叠态渲染它们，越干净越好）。
 */
export function summarizeBody(text: string, maxChars: number): string {
  const s: string = text !== undefined && text !== null ? text : '';
  const collapsed: string = s.replace(/\s+/g, ' ').trim();
  if (maxChars <= 0) {
    return '';
  }
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.substring(0, maxChars)}…`;
}

/**
 * 多行投递结果（纯值对象）：行数组 + **是否发生了截断**（供"优雅退化"判断）。
 * 为什么要把 `truncated` 单列：`lines` 只有 3 行，光看数组长度分不清"刚好 3 段"与"被砍了"。
 */
export class NotifyLines {
  lines: string[];
  truncated: boolean;

  constructor(lines: string[], truncated: boolean) {
    this.lines = lines;
    this.truncated = truncated;
  }
}

/**
 * 正文 → 多行形态（纯函数，**带截断标志**）。
 *
 * 规则（**最大程度保结构、不轻言截断**）：
 *   · 先按**换行**切段（空段丢弃、逐段压空白并 trim）—— 保留用户自己的行结构；
 *   · 段数 **≤ maxLines** ⇒ 原样保留（每个长段独立成行；**只要单段 ≤ 字节容量就零 `…`**）；
 *   · 段数 > maxLines ⇒ 只取**前 maxLines 段**，末段补 `…`（系统只显示 3 行的硬上限）；
 *   · 单段字节超 `maxLineBytes` ⇒ 该段按字节截断（补 `…`）。
 * `truncated = true` 当且仅当"有内容被丢弃"（段数超限或单段超字节）。
 *
 * ⚠️ "单段长正文"正是最典型的 `turn_done` 场景 ⇒ 走第一分支、零截断、`truncated=false`。
 */
export function bodyLinesDetailed(text: string, maxLines: number, maxLineBytes: number): NotifyLines {
  const s: string = text !== undefined && text !== null ? text : '';
  const raw: string[] = s.split('\n');
  const segs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t: string = raw[i].replace(/\s+/g, ' ').trim();
    if (t.length > 0) {
      segs.push(t);
    }
  }
  if (segs.length === 0) {
    return new NotifyLines([], false);
  }
  const limit: number = maxLines > 0 ? maxLines : 1;
  const out: string[] = [];
  let truncated: boolean = false;
  for (let i = 0; i < segs.length && out.length < limit; i++) {
    const seg: string = segs[i];
    const clamped: string = truncateToBytes(seg, maxLineBytes);
    if (clamped.length !== seg.length) {
      truncated = true; // 单段超字节 ⇒ 截断
    }
    out.push(clamped);
  }
  if (segs.length > limit) {
    truncated = true; // 段数超限 ⇒ 后面的段被丢弃
    const last: string = out[out.length - 1];
    if (!last.endsWith('…')) {
      out[out.length - 1] = `${last}…`;
    }
  }
  return new NotifyLines(out, truncated);
}

/** 正文 → 多行形态的 `lines`（纯函数；兼容入口，丢弃截断标志）。 */
export function bodyLines(text: string, maxLines: number, maxLineBytes: number): string[] {
  return bodyLinesDetailed(text, maxLines, maxLineBytes).lines;
}

/**
 * **优雅退化**：把末行的 `…` 换成更明确的 `NOTIFY_MORE_HINT`（"…完整内容见应用内"），
 * 且保证该行仍在 `maxLineBytes` 字节内（超了就先把正文前缀裁到放得下）。
 *
 * 为什么要有它：`…` 只是"话没说完"，用户不知道去哪看全部；这句提示直接告诉他**点开 App**。
 */
export function withMoreHint(lines: string[], maxLineBytes: number): string[] {
  if (lines === undefined || lines === null || lines.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
  }
  const lastIdx: number = out.length - 1;
  const bare: string = out[lastIdx].endsWith('…')
    ? out[lastIdx].substring(0, out[lastIdx].length - 1)
    : out[lastIdx];
  const room: number = maxLineBytes - utf8Bytes(NOTIFY_MORE_HINT);
  const head: string = truncateBytesRaw(bare, room > 0 ? room : 0);
  out[lastIdx] = `${head}${NOTIFY_MORE_HINT}`;
  return out;
}

/**
 * **长文本形态的优雅退化**：把正文按 `MAX_LONG_TEXT_BYTES` 夹住后追加 `NOTIFY_MORE_HINT`
 * （"…完整内容见应用内"）。与 `withMoreHint`（多行版）**同款语义**，只是这里正文是一整段
 * （`NotificationLongTextContent.longText`）而不是行数组。
 */
export function withMoreHintLongText(body: string): string {
  const s: string = body !== undefined && body !== null ? body : '';
  const room: number = MAX_LONG_TEXT_BYTES - utf8Bytes(NOTIFY_MORE_HINT);
  const head: string = truncateBytesRaw(s, room > 0 ? room : 0);
  return `${head}${NOTIFY_MORE_HINT}`;
}

/**
 * 正文形态（纯函数）：**给定正文 → 期望形态**。
 *
 * 三档（都对应 SDK 的 `ContentType`，见 `publishTurn`）：
 *   · 空串 / `≤ COLLAPSED_MAX_CHARS` 字 ⇒ `'basic'`（折叠态一行足够，不折腾展开）；
 *   · 更长且**多段**（有换行分段）⇒ `'multiline'`：保留用户行结构，展开显示最多 3 行
 *     （`NotificationMultiLineContent.lines`，`notification/notificationContent.d.ts:167-174`）；
 *   · 更长且**单段**、且**超过多行单行容量**（> `MULTILINE_MAX_LINE_BYTES` 字节）⇒ `'long_text'`：
 *     单段长正文若塞进 multiLine 只能占 1 行、被 1024 字节硬截断（丢 2/3 容量）；改走
 *     `NotificationLongTextContent.longText`（**3072 字节**，`notification/notificationContent.d.ts:96-105`）
 *     才能整段展示 ⇒ 这是"长回复不丢内容"的关键一档。
 *
 * ⚠️ 阈值用**字符数**判"要不要展开"（`COLLAPSED_MAX_CHARS` 是折叠一行的可读性阈值），
 *    用**字节数**判"单段该用 multiLine 还是 longText"（容量是字节口径）—— 两者都不猜，见下。
 */
export function notifyShapeFor(bodyText: string): string {
  const s: string = bodyText !== undefined && bodyText !== null ? bodyText : '';
  if (s.length <= COLLAPSED_MAX_CHARS) {
    return NOTIFY_SHAPE_BASIC;
  }
  if (!hasMultipleSegments(s) && utf8Bytes(s) > MULTILINE_MAX_LINE_BYTES) {
    return NOTIFY_SHAPE_LONG_TEXT;
  }
  return NOTIFY_SHAPE_MULTILINE;
}

/**
 * 正文是否**多段**（纯函数）：按换行切分、丢弃纯空白段后，非空段数 ≥ 2 ⇒ true。
 * 判据与 `bodyLinesDetailed` 的切分**同源**（都先 `\n` 切、再逐段压空白 trim、空段丢弃）
 * ⇒ "多段 ⇒ multiLine、单段 ⇒ 可能 longText"的判定与真正渲染的行数一致。
 */
export function hasMultipleSegments(text: string): boolean {
  const s: string = text !== undefined && text !== null ? text : '';
  const raw: string[] = s.split('\n');
  let n: number = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].replace(/\s+/g, ' ').trim().length > 0) {
      n += 1;
      if (n >= 2) {
        return true;
      }
    }
  }
  return false;
}

/** 形态标签（**不可达 SDK 的纯值**）：单行。 */
export const NOTIFY_SHAPE_BASIC: string = 'basic';
/** 形态标签：多行（最多 3 行）。 */
export const NOTIFY_SHAPE_MULTILINE: string = 'multiline';
/** 形态标签：长文本（展开为一整段，容量 3072 字节）。 */
export const NOTIFY_SHAPE_LONG_TEXT: string = 'long_text';

/**
 * 正文规划（纯值对象）：`publishTurn` 据此拼 SDK content，脱机可断言。
 *   · `shape`：`NOTIFY_SHAPE_BASIC` / `NOTIFY_SHAPE_MULTILINE` / `NOTIFY_SHAPE_LONG_TEXT`
 *   · `preview`：折叠态正文（`normal.text` / `briefText`），已按 `MAX_TEXT_BYTES` 夹住
 *   · `lines`：多行形态的行数组（basic / long_text 形态为空）
 *   · `longText`：长文本形态的展开正文（basic / multiline 形态为空串）
 *   · `degraded`：**是否优雅退化**（正文塞不下系统容量 ⇒ 末/尾为 `NOTIFY_MORE_HINT`，
 *     完整内容在应用内）
 */
export class NotifyBodyPlan {
  shape: string;
  preview: string;
  lines: string[];
  degraded: boolean;
  longText: string;

  constructor(shape: string, preview: string, lines: string[], degraded: boolean, longText: string = '') {
    this.shape = shape;
    this.preview = preview;
    this.lines = lines;
    this.degraded = degraded;
    this.longText = longText;
  }
}

/**
 * 正文 → 规划（纯函数）：把"截断/摘要/形态/退化/隐私"一次算清（`publishTurn` 唯一入口）。
 *
 * @param showDetail 是否把正文放进系统可见面（隐私开关，默认 true）。`false` ⇒ **只留标题 +
 *        兜底文案**（回复/问题正文绝不进锁屏与通知栏），形态回落单行、无多行/长文本、无退化。
 */
export function notifyBodyPlan(kind: string, detail: string, showDetail: boolean = true): NotifyBodyPlan {
  if (showDetail !== true) {
    return new NotifyBodyPlan(NOTIFY_SHAPE_BASIC, defaultNotifyBody(kind), [], false);
  }
  const d: string = detail !== undefined && detail !== null ? detail.trim() : '';
  const body: string = d.length > 0 ? d : defaultNotifyBody(kind);
  const preview: string = truncateToBytes(summarizeBody(body, COLLAPSED_MAX_CHARS), MAX_TEXT_BYTES);
  const shape: string = notifyShapeFor(body);
  if (shape === NOTIFY_SHAPE_LONG_TEXT) {
    // 单段长正文 ⇒ 展开用**整段**（longText ≤ 3072 字节）；真超容量才优雅退化（尾加"完整内容见应用内"）
    const over: boolean = utf8Bytes(body) > MAX_LONG_TEXT_BYTES;
    const longText: string = over ? withMoreHintLongText(body) : body;
    return new NotifyBodyPlan(shape, preview, [], over, longText);
  }
  if (shape === NOTIFY_SHAPE_MULTILINE) {
    const res: NotifyLines = bodyLinesDetailed(body, MULTILINE_MAX_LINES, MULTILINE_MAX_LINE_BYTES);
    const lines: string[] = res.truncated
      ? withMoreHint(res.lines, MULTILINE_MAX_LINE_BYTES)
      : res.lines;
    return new NotifyBodyPlan(shape, preview, lines, res.truncated);
  }
  return new NotifyBodyPlan(NOTIFY_SHAPE_BASIC, preview, [], false);
}

/**
 * 标题夹取（纯函数）：按 `MAX_TITLE_BYTES` 字节截断（SDK 超限也是截断，我们先做更可控的）。
 * 应用在 `publishTurn`：标题 = `notifyTitle(kind, 会话名)`，会话名再长也不该撑爆 1024 字节。
 */
export function clampTitle(title: string): string {
  const s: string = title !== undefined && title !== null ? title : '';
  return truncateToBytes(s, MAX_TITLE_BYTES);
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

// ── slot 档位（**纯判据**：档位 → 该用哪种 slot；SDK 枚举在边界处才出现）──────────
//
// 为什么按档位换 slot：系统里**每种 slot 类型有固定的 SlotLevel**，而 SlotLevel 决定
// "状态栏图标 / 横幅 / 响铃"（`@ohos.notificationManager.d.ts:1198-1236`）：
//   · SOCIAL_COMMUNICATION → LEVEL_HIGH（图标 + **横幅** + **响铃**，:1060-1068）；
//   · CONTENT_INFORMATION  → LEVEL_MIN （**无图标、无横幅、无响铃**，:1078-1086）。
// ⇒ `ask_user`（智能体在等你，必须叫醒你）用 SOCIAL_COMMUNICATION；`turn_done`（回合结束，
//    多数时候"看一眼即可"）用 CONTENT_INFORMATION（**静默**，仍在通知中心 + 角标可查）。
// ⚠️ **不绕过免打扰**：`NotificationSlot.bypassDnd` 我们**一律不设**（默认 false，尊重系统免打扰）。
// ⚠️ SlotLevel 是**只读**（`readonly enabled`）且 `addSlot` 只有"按类型"一种签名
//    （`@ohos.notificationManager.d.ts:294-318`，无 `addSlot(slot)` 重载）⇒ 只能"换类型"来换级别。

/** slot 标签（不可达 SDK 的纯值）：社交沟通（LEVEL_HIGH = 横幅 + 响铃）。 */
export const NOTIFY_SLOT_SOCIAL: string = 'social';
/** slot 标签：内容资讯（LEVEL_MIN = 静默，仅在通知中心/角标可见）。 */
export const NOTIFY_SLOT_CONTENT: string = 'content';

/** 档位 → slot 标签（纯函数；SDK 枚举映射见 `slotTypeOf`）。 */
export function slotTagFor(kind: string): string {
  return kind === NOTIFY_KIND_ASK ? NOTIFY_SLOT_SOCIAL : NOTIFY_SLOT_CONTENT;
}

/** slot 标签 → SDK 枚举（**唯一**把纯标签翻成 SDK 值的地方）。 */
function slotTypeOf(tag: string): notificationManager.SlotType {
  return tag === NOTIFY_SLOT_SOCIAL
    ? notificationManager.SlotType.SOCIAL_COMMUNICATION
    : notificationManager.SlotType.CONTENT_INFORMATION;
}

// ── SDK 封装（全部 try/catch + 返回 boolean；失败绝不外抛）───────────────────

/**
 * 建槽（幂等）：确保**本应用用到的两种** slot 都存在。
 *   ① SOCIAL_COMMUNICATION（`ask_user`，LEVEL_HIGH）；② CONTENT_INFORMATION（`turn_done`，LEVEL_MIN）。
 * 用 `getSlots()` 先查而不是无脑 `addSlot()`——"同一类型只能建一个"，重复建在部分版本上会报错。
 * 查询失败不阻断（继续尝试 `addSlot`；系统在 publish 时也会自动补建，见 SDK addSlot 注释）。
 */
export async function initSlots(): Promise<boolean> {
  const want: notificationManager.SlotType[] = [
    notificationManager.SlotType.SOCIAL_COMMUNICATION,
    notificationManager.SlotType.CONTENT_INFORMATION,
  ];
  let existing: notificationManager.SlotType[] = [];
  try {
    const slots: notificationManager.NotificationSlot[] = await notificationManager.getSlots();
    for (let i = 0; i < slots.length; i++) {
      const t: notificationManager.SlotType | undefined = slots[i].notificationType;
      if (t !== undefined) {
        existing.push(t);
      }
    }
  } catch (e) {
    // 查询失败不阻断：下面对每个缺的 slot 仍会尝试 addSlot
  }
  let ok: boolean = true;
  for (let i = 0; i < want.length; i++) {
    let has: boolean = false;
    for (let j = 0; j < existing.length; j++) {
      if (existing[j] === want[i]) {
        has = true;
        break;
      }
    }
    if (has) {
      continue;
    }
    try {
      await notificationManager.addSlot(want[i]);
    } catch (e) {
      console.warn(`xbot notify: addSlot(${want[i]}) 失败（忽略）: ${describeError(e as Object)}`);
      ok = false;
    }
  }
  return ok;
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
 * **只读**系统通知授权状态（**不弹框**）—— 设置面板的「通知提醒」开关据此反映**系统真值**
 * （不自己另记一份状态）。读取口径与 `ensureEnabled` 同一个 `isNotificationEnabled`。
 * 失败conservatively取 false（宁可显示"关"，也不谎报"开"）。
 */
export async function notificationsEnabled(): Promise<boolean> {
  try {
    return await notificationManager.isNotificationEnabled();
  } catch (e) {
    return false;
  }
}

/**
 * 构造「拉起本应用并带参数」的 WantAgent。
 *
 * 依据（SDK `wantAgent/wantAgentInfo.d.ts`，**逐字段带行号**）：
 *   · `actionType?: abilityWantAgent.OperationType`（**since 11**，:63）—— 本轮用的字段；
 *   · `actionFlags?: Array<abilityWantAgent.WantAgentFlags>`（**since 11**，:92）—— 本轮用的字段；
 *   · 旧字段 `operationType?: wantAgent.OperationType`（:55）与 `wantAgentFlags?`（:84）在
 *     **API 11 起已 deprecated**（`@deprecated since 11` / `@useinstead …actionType|actionFlags`，
 *     :52-53 / :81-82）。
 *
 * ⚠️ **退路（写清以便基线漂移时不用重新调研）**：本工程 pin `compatibleSdkVersion 6.0.1(21)` ≥ 11
 *   ⇒ 新字段正确。**若将来把基线下探到 API < 11**：把下面两行换成
 *   `operationType: wantAgent.OperationType.START_ABILITY` / `wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]`，
 *   并把枚举来源由 `@ohos.app.ability.wantAgent` 换回 `@ohos.wantAgent`（语义等价）。
 *   `requestCode: 0` + `actionFlags:[UPDATE_PRESENT_FLAG]`：点击后**更新已有的 present** 而非堆叠新的。
 *
 * → 点击时以 `wants[0].parameters` 拉起目标 ability（EntryAbility.onCreate / onNewWant 收到）。
 */
async function startAbilityAgent(params: Record<string, Object>): Promise<Object> {
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
  return await wantAgent.getWantAgent(info);
}

/**
 * 发一条通知（待回答 / 回合结束）。点击**通知本体**或**动作按钮**都会拉起本应用并带参数
 * （EntryAbility.onCreate/onNewWant 接收 → `pendingOpenChatId` / `pendingNotifyAction`）。
 *
 * 「专业级」体现在六处（都不破坏既有链路）：
 *   ① **动作按钮**（`notifyActionsFor` → 「查看」，最多 2 枚）：与通知本体**共用同一套
 *      `START_ABILITY + parameters` 直达链路**，不另造一套；
 *   ② **长正文不截断**（`notifyBodyPlan`）：三档形态 —— 折叠态一行（basic）/ 多段走多行
 *      （multiline，≤3 行）/ **单段长正文走长文本**（long_text，整段 ≤3072 字节）；真塞不下
 *      时**优雅退化**（尾 = "…完整内容见应用内"，见 `withMoreHint`/`withMoreHintLongText`）；
 *   ③ **档位化 slot**：`ask_user` → SOCIAL_COMMUNICATION（横幅+响铃），`turn_done` →
 *      CONTENT_INFORMATION（静默）—— 让"需要回答"比"回合完成"更醒目；
 *   ④ **按会话分组 + 替换**：`groupName` 归一组、`id` 按会话派生 ⇒ 同会话更新、异会话并存；
 *   ⑤ **标题夹取**（`clampTitle`）：会话名再长也不撑爆 1024 字节；
 *   ⑥ **点击回跳链路**（`startAbilityAgent`）：本体与按钮共用 `START_ABILITY + parameters`。
 * ⚠️ 全程 try/catch：通知是旁路，失败最多"没提醒"，绝不让聊天崩。
 */
/**
 * 「通知装饰」**不透明钩子**（端口）。
 *
 * ⛔ 为什么是"不透明 + 在 ArkTS 侧 cast"：小图标字段是 `smallIcon?: image.PixelMap`
 *   （SDK `notificationRequest.d.ts:310`，**不是 Resource**），而本文件属 `core/`
 *   **不许 import `@ohos.*`**（`run.sh` 当纯 TS 编译）⇒ **无法**在此声明/转换 `PixelMap`。
 *   故本层只留一个 `(request: Object) => void` 的端口；解码与 cast 都在 ArkTS 侧
 *   （`entry/src/main/ets/workreconcile/icons.ets`）。
 * 语义：**调用方实现必须自己 try/catch**；本层再兜一层 ⇒ 装饰失败绝不影响发通知。
 */
export type NotifyDecorator = (request: Object) => void;

/** 已注册的装饰器（同一时刻至多一个；`null` = 不装饰）。 */
let notifyDecorator: NotifyDecorator | null = null;

/** 注册装饰器（幂等；由 `entryability/EntryAbility.ets` 启动时调一次）。 */
export function setNotifyDecorator(fn: NotifyDecorator): void {
  notifyDecorator = fn;
}

export async function publishTurn(title: string, text: string, chatId: string): Promise<boolean> {
  try {
    const kind: string = kindFromNotifyTitle(title);
    // ⭐ 隐私开关（`KEY_NOTIFY_DETAIL`）：关掉时正文不进系统可见面（见 notifyBodyPlan）
    const plan: NotifyBodyPlan = notifyBodyPlan(kind, text, currentPrefs.detail);
    const safeTitle: string = clampTitle(title);
    const agent: Object = await startAbilityAgent({ 'chat_id': chatId });
    const bodyText: string = plan.preview.length > 0 ? plan.preview : defaultNotifyBody(kind);
    let content: notificationManager.NotificationContent;
    if (plan.shape === NOTIFY_SHAPE_LONG_TEXT) {
      // ⭐ 长文本形态：折叠态 = `normal`（title/text）；展开 = `longText`（≤3072 字节，整段）。
      //    `NotificationLongTextContent` **继承** `NotificationBasicContent` ⇒ `title`/`text`/`briefText`
      //    /`expandedTitle` 都是必填（SDK `notification/notificationContent.d.ts:96-125`）。
      content = {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_LONG_TEXT,
        normal: { title: safeTitle, text: bodyText },
        longText: {
          title: safeTitle,
          text: bodyText,
          longText: plan.longText.length > 0 ? plan.longText : bodyText,
          briefText: bodyText,
          expandedTitle: safeTitle,
        },
      };
    } else if (plan.shape === NOTIFY_SHAPE_MULTILINE) {
      const lines: string[] = plan.lines.length > 0 ? plan.lines : [bodyText];
      // ⚠️ `NotificationMultiLineContent` **继承** `NotificationBasicContent` ⇒ `title`/`text`
      //    也是必填（SDK `notification/notificationContent.d.ts:146-175`）：折叠态就渲染它们。
      content = {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_MULTILINE,
        normal: { title: safeTitle, text: bodyText },
        multiLine: {
          title: safeTitle,
          text: bodyText,
          lines: lines,
          longTitle: safeTitle,
          briefText: bodyText,
        },
      };
    } else {
      content = {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: { title: safeTitle, text: bodyText },
      };
    }
    // 动作按钮：只发射 `notifyActionsFor` 给出的"今天真能用"的那些（当前 = 「查看」）
    const wanted: NotifyAction[] = notifyActionsFor(kind);
    const buttons: notificationManager.NotificationActionButton[] = [];
    for (let i = 0; i < wanted.length && buttons.length < NOTIFY_MAX_ACTIONS; i++) {
      const a: NotifyAction = wanted[i];
      // 「查看」复用本体 agent（同一条 chat_id 直达）；其它动作额外带 `notify_action` 参数
      const btnAgent: Object = a.id === NOTIFY_ACTION_OPEN
        ? agent
        : await startAbilityAgent({ 'chat_id': chatId, 'notify_action': a.id });
      buttons.push({ title: a.title, wantAgent: btnAgent });
    }
    const request: notificationManager.NotificationRequest = {
      // ⭐ 按会话派生 id：同会话**更新**那一条，不同会话**并存**（见 notificationIdFor 的碰撞取舍）
      id: notificationIdFor(chatId),
      content: content,
      wantAgent: agent,
      actionButtons: buttons,
      // ⭐ 档位化 slot：ask = 横幅+响铃（更醒目），turn_done = 静默（见 slotTagFor 的 SDK 依据）
      notificationSlotType: slotTypeOf(slotTagFor(kind)),
      // 同一应用的所有聊天提醒归一组 ⇒ 系统可折叠展示（SDK since 8 支持）
      // ⛔ 必须经派生函数：**每会话一组**（改回常量直传 ⇒ 判据红，见 notify_group.test.ts）
      groupName: notifyGroupOf(chatId),
      autoDeletedTime: Date.now() + AUTO_DELETE_MS,
      tapDismissed: true,
      // 同一 id 的更新是否重复响铃：turn_done 去重（phase_done 与 session idle 会各来一次），
      // ask_user 允许重响（新问题就该再提醒一次；若用固定 id 覆盖更新也仍会提示）。
      isAlertOnce: kind !== NOTIFY_KIND_ASK,
    };
    // 品牌小图标等**装饰**：端口在 ArkTS 侧实现（见 `setNotifyDecorator` 注释）。
    // ⛔ 解析/解码**不在这里**——本调用路径必须保持"零解码"（否则每次发通知都解码）。
    if (notifyDecorator !== null) {
      try {
        notifyDecorator(request);
      } catch (e) {
        // 装饰是旁路：失败 ⇒ 不设该字段 ⇒ 回落系统默认图标（绝不因装饰失败而丢通知）
      }
    }
    await notificationManager.publish(request);
    // 记账：该会话现在有未读提醒（按会话去重）⇒ 角标与通知同步重算
    unread.add(chatId);
    if (chatId !== undefined && chatId !== null && chatId.length > 0) {
      lastNotifiedChatId = chatId;
    }
    await syncBadge();
    return true;
  } catch (e) {
    console.warn(`xbot notify: publish 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/**
 * 直接设置角标（低层入口，一般不用）。
 * ⚠️ 正常路径请走"通知增/减 → `syncBadge()`"：角标与通知必须同生共死，
 *    单独调它会出现"通知还在、角标已清零"的不一致。
 */
export async function setBadge(n: number): Promise<boolean> {
  try {
    await notificationManager.setBadgeNumber(Math.max(0, Math.floor(n)));
    return true;
  } catch (e) {
    console.warn(`xbot notify: setBadge 失败（忽略）: ${describeError(e as Object)}`);
    return false;
  }
}

/**
 * 清掉本应用**全部聊天提醒**（登出/换账号等"整机清场"场景）。
 *
 * ⚠️ **2026-10-11 变更（per-chat 分组后必须同步）**：`groupName` 已从"全局一个组"改为
 * `notifyGroupOf(chatId)` = **每会话一组** ⇒ 旧写法 `cancelGroup(NOTIFY_GROUP_NAME)`
 * **再也匹配不到任何通知**（静默失效！）。故这里改为 `cancelAll()` 为主（它本就兜底）。
 * 再兜一次 `cancelAll()`：万一将来有通知落在分组之外（或分组参数没生效），也不会留僵尸。
 * 两步都 try/catch（任一步失败不阻断另一步），最后与系统对账重算角标。
 */
export async function clearAll(): Promise<boolean> {
  let ok: boolean = false;
  // ⛔ 不再用 cancelGroup(全局名)：per-chat 分组下它匹配不到任何通知（静默失效）。
  try {
    await notificationManager.cancelAll();
    ok = true;
  } catch (e) {
    console.warn(`xbot notify: cancelAll 失败（忽略）: ${describeError(e as Object)}`);
  }
  unread.clear();
  lastNotifiedChatId = '';
  await syncBadge();
  return ok;
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
    unread.remove(chatId);
  }
  // 角标与通知同步重算（清了一个会话 ⇒ 若还有别的会话挂着提醒，角标不为 0）
  await syncBadge();
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
    await clearForChat(target); // 内部已与系统对账并重算角标
    return;
  }
  // 没有已知的待清会话（冷启动 / 从未发过提醒）⇒ 只与系统对账重算角标，**不动**其他会话的通知
  await syncBadge();
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
      // ⭐ 早退**也必须打点**（2026-10-11 实测教训）：否则"hilog 里没有成功日志"永远有
      //    **两种**解释 —— ①根本没调用；②已激活而早退 ⇒ "窗的开/关"**永远不可确证**。
      console.info('xbot notify: keep-alive 已激活（早退，requestId=' + keepAliveRequestId
        + '），本次不重复申请');
      return true;
    }
    const info: backgroundTaskManager.DelaySuspendInfo =
      backgroundTaskManager.requestSuspendDelay(KEEP_ALIVE_REASON, () => {
        // 【系统何时回调】短时任务**到期前约 6 秒**（SDK 原文："Callback used to notify the
        // application that the transient task is about to time out. Generally, the callback is
        // invoked 6 seconds before the timeout."，
        // @ohos.resourceschedule.backgroundTaskManager.d.ts:635-636）。
        //
        // 【我们做什么 —— 只有两件，都不臆造能力】
        //   ① 记一条**明确的日志**：这是"切后台后回合为什么停住"的唯一可观测信号
        //      （hilog 里能查到原因，否则用户只看到"消息不更新"）；
        //   ② 把句柄标记为失效：避免之后的 endTurnKeepAlive() 去 cancel 一个已被系统回收的 id。
        //
        // 【为什么不做"自动续期"】SDK **没有**延长接口；再申请是一次**新的**短时任务
        //   （消耗当日配额，且循环续期会被系统判为滥用）。而且**不需要**：回合在**服务端**
        //   继续执行（客户端只是订阅方），应用被冻结不会中断它；回前台由 SSE 强制探活
        //   （`sse.forceReconnect`）+ `/api/history` 对账把漏掉的事件补齐
        //   ⇒ 冻结前没有任何客户端状态需要抢救。
        keepAliveRequestId = -1;
        console.warn('xbot notify: 短时任务即将到期（约 6s 后应用可能被冻结）——'
          + ' 回合在服务端继续；回前台会由 SSE 强制探活 + history 对账补齐');
      });
    keepAliveRequestId = info.requestId;

    // ⭐ 成功路径**必须留一条日志**（2026-10-11 实测教训）：此前**只有**"到期前 ~6s"与"申请失败"
    //    两条告警 ⇒ **成功时静默** ⇒ 真机实验里"窗到底开没开"**在 hilog 上无从判断**
    //    （我 grep 到的 `requestSuspendDelay` 其实是**输入法**的）⇒ 无法把"后台是否冻结"
    //    归因到"有窗/无窗"。这一行是**唯一**能确证"窗已开"的可观测信号。
    console.info('xbot notify: 短时任务窗已开（≤3 分钟；requestId=' + info.requestId
      + '，actualDelayTime=' + info.actualDelayTime + 'ms）');
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
