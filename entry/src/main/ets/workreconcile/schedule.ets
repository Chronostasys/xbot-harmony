/**
 * 延迟任务（`workScheduler`）的**注册/取消**——「极其轻量的后台对账」的开关。
 *
 * ⛔ 只做一件事：把 `NotifyReconcileAbility` 排进系统的延迟任务队列。判定/发布都在扩展里。
 *
 * ── SDK 依据（`@ohos.resourceschedule.workScheduler.d.ts`，逐条行号）────────────────
 * · `WorkInfo`（`:38-207`）：`workId` / `bundleName` / `abilityName` 必填；
 *   `isRepeat`（`:108`，"默认 false"）、`repeatCycleTime`（`:97`，"毫秒"）、
 *   `networkType`（`:44`，触发条件）、`isCharging`/`batteryLevel`/`storageRequest` 同为**触发条件**；
 *   `parameters`（`:144`）透传给扩展；`earliestStartTime`（`:154`，**@since 22** —— 本项目 21 **不可用**）。
 * · `startWork(work)`（`:210`）/ `stopWork(work, needCancel?)`（`:228`）。
 * · **无 `@permission` 标注** ⇒ 本 API **不需要**在 `module.json5` 声明权限（全文件 grep `@permission` = 空）。
 * · 扩展侧 `onWorkStop` 的触发语义 = **超时 2 分钟**或显式 `stopWork`
 *   （`@ohos.WorkSchedulerExtensionAbility.d.ts` 的 `onWorkStop` 注释原文）。
 * · ⚠️ **d.ts 未写明** `repeatCycleTime` 的**最小值**，也**未**保证按此间隔准时唤醒
 *   （真实节奏受 Doze/省电/内存策略影响）⇒ spec 的覆盖表按"**不保证**"记录。
 */
import workScheduler from '@ohos.resourceschedule.workScheduler';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { common } from '@kit.AbilityKit';
import { RECONCILE_ABILITY, RECONCILE_INTERVAL_MS, RECONCILE_WORK_ID, reconcileIntervalMs, reconcileShouldGiveUp } from '../core/reconcile';
import { preferences } from '@kit.ArkData';

const FAIL_STORE: string = 'xbot_reconcile';
const M_FAILS: string = 'consecutive_failures';

/** 读连续失败数（扩展失败时自增；成功时清零）。读不到按 0（= 基准间隔）。 */
async function readFailures(ctx: common.Context): Promise<number> {
  try {
    const opts: preferences.Options = { name: FAIL_STORE };
    const s: preferences.Preferences = await preferences.getPreferences(ctx, opts);
    const v: Object = s.getSync(M_FAILS, 0);
    return typeof v === 'number' ? v as number : 0;
  } catch (e) {
    return 0;
  }
}

const DOMAIN: number = 0x0000;
const TAG: string = 'XBOTRECON';

/** 幂等注册：重复调用只会覆盖同一个 `workId`（不改判据，只是"确保在队列里"）。 */
export function ensureReconcileScheduled(ctx: common.Context): boolean {
  return ensureReconcileScheduledWith(ctx, 0);
}

/**
 * 与 `ensureReconcileScheduled` 同义，但**按连续失败数退避**；已达"放弃"阈值 ⇒ 不排任务。
 * ⛔ 纯策略来自 `core/reconcile.ets:reconcileIntervalMs/reconcileShouldGiveUp`（本文件不复制数值）。
 */
export function ensureReconcileScheduledWith(ctx: common.Context, failures: number): boolean {
  if (reconcileShouldGiveUp(failures)) {
    hilog.info(DOMAIN, TAG, 'give up scheduling（连续失败 %{public}d 次）', failures);
    return false;
  }
  const interval: number = reconcileIntervalMs(failures);
  try {
    const work: workScheduler.WorkInfo = {
      workId: RECONCILE_WORK_ID,
      bundleName: ctx.applicationInfo.name,
      abilityName: RECONCILE_ABILITY,
      // 有网才值得跑（对账是只读 HTTP）
      networkType: workScheduler.NetworkType.NETWORK_TYPE_ANY,
      isRepeat: true,
      repeatCycleTime: interval,
      // `isPersisted=true` ⇒ **重启后仍有效**（否则用户重启手机就不再有后台对账）
      isPersisted: true,
      parameters: { reason: 'xbot-notify-reconcile' },
    };
    workScheduler.startWork(work);
    hilog.info(DOMAIN, TAG, 'startWork ok (workId=%{public}d, every %{public}d ms, failures=%{public}d)',
      RECONCILE_WORK_ID, interval, failures);
    return true;
  } catch (e) {
    // 旁路：注册失败只记账（最坏结果 = 回到"没后台对账"的现状，不影响主链路）
    hilog.warn(DOMAIN, TAG, 'startWork failed: %{public}s', (e as BusinessError).message);
    return false;
  }
}

/** 取消注册（退出登录时调；幂等）。 */
export function cancelReconcileScheduled(): boolean {
  try {
    const work: workScheduler.WorkInfo = {
      workId: RECONCILE_WORK_ID,
      bundleName: '',
      abilityName: RECONCILE_ABILITY,
    };
    workScheduler.stopWork(work, true);
    return true;
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'stopWork failed: %{public}s', (e as BusinessError).message);
    return false;
  }
}
