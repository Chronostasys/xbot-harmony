/**
 * `@ohos.notificationManager` 等通知/短时任务 SDK 的 **Node 实现**（只服务 `tools/tests/run.sh`）。
 *
 * 为什么需要它：`core/notify.ets` 在**模块顶层** import 了这三个 SDK 模块 ⇒
 * `import ... from './store'` 的任何单测都会 require 它们；缺这份实现就是
 * `MODULE_NOT_FOUND`（整批测试直接挂）。这与 NetworkKit.js / ArkTS.js / prism4j.js
 * 是同一套机制。
 *
 * ⚠️ 这里只做到"**能被 require 且不抛**"：脱机测试覆盖的是 `notify.ets` 的**纯判定**
 *    （shouldNotify / notifyKindForSse / …），SDK 调用路径只能在真机上验证。
 *    注意 `.default`：tsc 以 commonjs 编译 `import x from 'm'` ⇒ `require('m').default`。
 */
const noop = () => Promise.resolve();

module.exports = {
  default: {
    // ── @ohos.notificationManager ──
    SlotType: {
      UNKNOWN_TYPE: 0, SOCIAL_COMMUNICATION: 1, SERVICE_INFORMATION: 2,
      CONTENT_INFORMATION: 3, LIVE_VIEW: 4, CUSTOMER_SERVICE: 5, OTHER_TYPES: 0xFFFF,
    },
    ContentType: {
      NOTIFICATION_CONTENT_BASIC_TEXT: 0, NOTIFICATION_CONTENT_LONG_TEXT: 1,
      NOTIFICATION_CONTENT_PICTURE: 2, NOTIFICATION_CONTENT_CONVERSATION: 3,
      NOTIFICATION_CONTENT_MULTILINE: 4, NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW: 5,
    },
    addSlot: noop,
    getSlots: () => Promise.resolve([]),
    isNotificationEnabled: () => Promise.resolve(true),
    isNotificationEnabledSync: () => true,
    requestEnableNotification: noop,
    publish: noop,
    cancel: noop,
    cancelAll: noop,
    setBadgeNumber: noop,
    // ── @ohos.app.ability.wantAgent ──
    OperationType: { UNKNOWN_TYPE: 0, START_ABILITY: 1, START_ABILITIES: 2, START_SERVICE: 3, SEND_COMMON_EVENT: 4 },
    WantAgentFlags: { ONE_TIME_FLAG: 0, NO_BUILD_FLAG: 1, CANCEL_PRESENT_FLAG: 2, UPDATE_PRESENT_FLAG: 3, CONSTANT_FLAG: 4 },
    getWantAgent: () => Promise.resolve({}),
    // ── @ohos.resourceschedule.backgroundTaskManager ──
    requestSuspendDelay: (reason, callback) => ({ requestId: 1, actualDelayTime: 180000 }),
    cancelSuspendDelay: () => {
    },
    getRemainingDelayTime: () => Promise.resolve(0),
  },
};
