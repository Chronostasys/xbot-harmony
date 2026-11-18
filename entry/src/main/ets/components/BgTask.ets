/**
 * `DATA_TRANSFER` 长时任务（**私人使用**的保活手段，替代静音播放）。
 *
 * ── 为什么需要 ─────────────────────────────────────────────────────────────────
 *   实况窗（Live View）由端侧 `liveViewManager.updateLiveView` 驱动，而**进程被系统 Freeze
 *   之后就调不出去**（真机日志：`SUSPEND_MANAGER: Freeze com.chronostasys.xbot`）。
 *   现有短时任务只有 ≤3 分钟；`LOCATION`/`AUDIO_PLAYBACK` 我们没有合法用途
 *   （且静音音频会抢音频焦点、打断用户听歌）⇒ 用 `DATA_TRANSFER` 长时任务把进程撑住。
 *
 * ⛔ 已知限制（SDK 原文）：`DATA_TRANSFER` 在**10 分钟无真实数据传输**时会被系统取消
 *    （`@ohos.resourceschedule.backgroundTaskManager.d.ts:1116-1133`）；它还会带一条常驻通知。
 *    所以它只是"比 3 分钟更长的窗"，**不是永久保活**。
 * ⛔ 需要 `ohos.permission.KEEP_BACKGROUND_RUNNING`（normal + system_grant）+ ability
 *    的 `backgroundModes: ["dataTransfer"]`（见 `module.json5`）。
 */
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { startAbilityAgent } from '../core/notify';

/** 本进程是否已持有长时任务（幂等闸；`stopBackgroundRunning` 对未持有者会抛错）。 */
let held: boolean = false;

/** 是否正在持有（供判据/日志使用）。 */
export function dataTransferTaskHeld(): boolean {
  return held;
}

/**
 * 申请（或复用）`DATA_TRANSFER` 长时任务。
 * @returns 是否已持有
 */
export async function ensureDataTransferTask(ctx: common.UIAbilityContext): Promise<boolean> {
  if (held) {
    return true;
  }
  try {
    // 空参数即可（与 LiveViewBridge 同一处 WantAgent 构造；`{}` 是唯一被 ArkTS 接受的形态）
    const agent: Object = await startAbilityAgent({});
    await backgroundTaskManager.startBackgroundRunning(
      ctx, backgroundTaskManager.BackgroundMode.DATA_TRANSFER, agent);
    held = true;
    console.info('xbot bg: DATA_TRANSFER 长时任务已启动（实况窗可在后台继续更新）');
    return true;
  } catch (e) {
    const err: BusinessError = e as BusinessError;
    // 201 = 权限被拒（缺 KEEP_BACKGROUND_RUNNING）；202 = 非系统应用不支持该类型；
    // 其它多为系统拒绝/配额。**一律不抛**：保活失败不能影响正常使用。
    console.warn(`xbot bg: DATA_TRANSFER 启动失败 code=${err.code}: ${err.message}`);
    held = false;
    return false;
  }
}

/** 结束长时任务（回前台/回合结束时调用；未持有时安全空转）。 */
export async function stopDataTransferTask(ctx: common.UIAbilityContext): Promise<void> {
  if (!held) {
    return;
  }
  try {
    await backgroundTaskManager.stopBackgroundRunning(ctx);
    console.info('xbot bg: DATA_TRANSFER 长时任务已结束');
  } catch (e) {
    const err: BusinessError = e as BusinessError;
    console.warn(`xbot bg: 结束长时任务失败 code=${err.code}: ${err.message}`);
  } finally {
    held = false;
  }
}
