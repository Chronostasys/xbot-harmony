/**
 * 通知 / 短时任务 SDK 的**最小声明** —— 只服务 `tools/typecheck/check.sh` 与
 * `tools/tests/run.sh`（两者把 `core/*.ets` 当**纯 TS** 编译，解析不到 SDK 的
 * `@ohos.*` 声明）⇒ 没有本文件就是 TS2307。
 *
 * ⚠️ 本文件**不参与 App 构建**（真机走 SDK 自带的 d.ts）；这里只按
 *    `core/notify.ets` 与 `core/store.ets` 实际用到的 API 面声明。
 *    口径与 `kits.d.ts` / `prism4j.d.ts` 一致：**只声明用到的方法**，签名照官方 d.ts 抄。
 *
 * ⚠️ 结构必须照官方：**`namespace X { … }` + `export default X`**。
 *    写成 `export default { …对象字面量… }` 会让 `X.SomeType` 这类**类型限定名**
 *    解析不到（`import X from …` 只能当值用）——本文件第一版就栽在这里。
 */
declare module '@ohos.notificationManager' {
  export namespace notificationManager {
    export enum SlotType {
      UNKNOWN_TYPE = 0,
      SOCIAL_COMMUNICATION = 1,
      SERVICE_INFORMATION = 2,
      CONTENT_INFORMATION = 3,
      LIVE_VIEW = 4,
      CUSTOMER_SERVICE = 5,
      OTHER_TYPES = 0xFFFF,
    }
    export enum ContentType {
      NOTIFICATION_CONTENT_BASIC_TEXT = 0,
      NOTIFICATION_CONTENT_LONG_TEXT = 1,
      NOTIFICATION_CONTENT_PICTURE = 2,
      NOTIFICATION_CONTENT_CONVERSATION = 3,
      NOTIFICATION_CONTENT_MULTILINE = 4,
      NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW = 5,
    }
    export interface NotificationBasicContent {
      title: string;
      text: string;
      additionalText?: string;
    }
    export interface NotificationContent {
      notificationContentType?: ContentType;
      normal?: NotificationBasicContent;
    }
    export interface NotificationSlot {
      notificationType?: SlotType;
      desc?: string;
      badgeFlag?: boolean;
      readonly enabled?: boolean;
    }
    export interface NotificationRequest {
      id?: number;
      content: NotificationContent;
      notificationSlotType?: SlotType;
      isOngoing?: boolean;
      isUnremovable?: boolean;
      tapDismissed?: boolean;
      autoDeletedTime?: number;
      wantAgent?: Object;
      isAlertOnce?: boolean;
      badgeNumber?: number;
      label?: string;
      groupName?: string;
    }
    function addSlot(type: SlotType): Promise<void>;
    function getSlots(): Promise<Array<NotificationSlot>>;
    function getActiveNotificationCount(): Promise<number>;
    function isNotificationEnabled(): Promise<boolean>;
    function isNotificationEnabledSync(): boolean;
    function requestEnableNotification(context: Object): Promise<void>;
    function publish(request: NotificationRequest): Promise<void>;
    function cancel(id: number, label?: string): Promise<void>;
    function cancelAll(): Promise<void>;
    function setBadgeNumber(badgeNumber: number): Promise<void>;
  }
  export default notificationManager;
}

declare module '@ohos.app.ability.wantAgent' {
  export namespace wantAgent {
    export enum OperationType {
      UNKNOWN_TYPE = 0,
      START_ABILITY = 1,
      START_ABILITIES = 2,
      START_SERVICE = 3,
      SEND_COMMON_EVENT = 4,
    }
    export enum WantAgentFlags {
      ONE_TIME_FLAG = 0,
      NO_BUILD_FLAG = 1,
      CANCEL_PRESENT_FLAG = 2,
      UPDATE_PRESENT_FLAG = 3,
      CONSTANT_FLAG = 4,
    }
    export interface WantAgentInfo {
      wants: Array<Object>;
      actionType?: OperationType;
      requestCode: number;
      actionFlags?: Array<WantAgentFlags>;
      extraInfos?: Record<string, Object>;
    }
    function getWantAgent(info: WantAgentInfo): Promise<Object>;
  }
  export default wantAgent;
}

declare module '@ohos.resourceschedule.backgroundTaskManager' {
  export namespace backgroundTaskManager {
    export interface DelaySuspendInfo {
      requestId: number;
      actualDelayTime: number;
    }
    function requestSuspendDelay(reason: string, callback: () => void): DelaySuspendInfo;
    function cancelSuspendDelay(requestId: number): void;
  }
  export default backgroundTaskManager;
}

/**
 * ArkUI 全局 `AppStorage`（`core/notify.ets` 读"应用是否在前台"标志；应用侧的真身
 * 由 ArkUI 提供，这里只为脱机 tsc 声明）。签名照官方：
 * `AppStorage.get<T>(propName): T | undefined` / `setOrCreate<T>(propName, newValue)`。
 */
declare const AppStorage: {
  get<T>(propName: string): T | undefined;
  setOrCreate<T>(propName: string, newValue: T): void;
  has(propName: string): boolean;
  delete(propName: string): boolean;
};
