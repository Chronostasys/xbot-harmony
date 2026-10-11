/**
 * 对账备忘的**唯一持久化层**（前台与后台扩展**共用**）。
 *
 * ── 为什么要有这个文件（2026-10-11 死消费修复）────────────────────────────────
 * 此前 `loadMemo`/`saveMemo` 是 `NotifyReconcileAbility.ets` 的私有函数，只有**后台扩展**写备忘
 * ⇒ 备忘里的 `lastSeenTurnKey` **只反映"扩展自己见过什么"**，从不反映"**用户**见过什么"
 * ⇒ 用户在前台读完一轮再切后台，首次对账会把**已看过**的回合误报成"新消息"（假阳性）。
 * 修法 = 让**前台**也能写备忘：前台的 `/api/history` 返回里就有权威的 `chat_id` + `last_seq`
 * （与扩展 `fetchMark` 的取数**同源**），据此调 `core/reconcile.markSeen`（⇒ 该方法不再 0 消费）。
 *
 * ── 纪律 ─────────────────────────────────────────────────────────────────────
 * 1. ⛔ **旁路**：所有异常静默（`hilog.warn` + return），绝不外抛（扩展抛错会被系统记异常）。
 * 2. ⛔ **前台只在"前台"时记**（闸在 `core/notify.noteForegroundSeen`，不在本层）。
 * 3. ⛔ `core/reconcile` 保持**纯**（无 `@ohos.*`）；preferences/落盘只在本文件（ArkTS 侧）。
 */
import { preferences } from '@kit.ArkData';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { common } from '@kit.AbilityKit';
import { ReconcileMark, ReconcileMemo, markSeen, turnKeyOf } from '../core/reconcile';

const DOMAIN: number = 0x0000;
const TAG: string = 'XBOTRECON';

/** 对账备忘自成一仓（与前台设置解耦，避免互相覆盖）。 */
export const MEMO_STORE: string = 'xbot_reconcile';
const M_INIT: string = 'initialized';
const M_TURN: string = 'last_seen_turn';
const M_ASK: string = 'last_ask_id';

/** 读备忘（缺项一律按"未立基线/没见过"⇒ 安全侧：不误报）。 */
export async function loadMemo(ctx: common.Context): Promise<ReconcileMemo> {
  const memoOpts: preferences.Options = { name: MEMO_STORE };
  try {
    const s: preferences.Preferences = await preferences.getPreferences(ctx, memoOpts);
    return new ReconcileMemo(
      s.getSync(M_INIT, false) === true,
      String(s.getSync(M_TURN, '')),
      String(s.getSync(M_ASK, '')),
    );
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'loadMemo failed: %{public}s', (e as BusinessError).message);
    return new ReconcileMemo(false, '', '');
  }
}

/** 写备忘（**必须落盘**：否则每次唤醒/每次回前台都重复打扰）。 */
export async function saveMemo(ctx: common.Context, m: ReconcileMemo): Promise<void> {
  const memoOpts: preferences.Options = { name: MEMO_STORE };
  try {
    const s: preferences.Preferences = await preferences.getPreferences(ctx, memoOpts);
    s.putSync(M_INIT, m.initialized);
    s.putSync(M_TURN, m.lastSeenTurnKey);
    s.putSync(M_ASK, m.lastAskId);
    await s.flush();
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'saveMemo failed: %{public}s', (e as BusinessError).message);
  }
}

/**
 * 前台观测到"用户已看到**某会话的第 N 回合**" ⇒ 记进备忘（`markSeen` 的**唯一前台入口**）。
 *
 * 取数**与扩展 `fetchMark` 同源**：`chatId` = 前台当前会话；`lastSeq` = `/api/history` 的
 * `data.last_seq`（**同一个**服务端权威字段）⇒ `turnKeyOf(chatId, lastSeq)` 在两处必然一致。
 * ⛔ 这就是本函数存在的全部理由：让"见没见过"的**前台侧**也有记录（否则只有扩展自说自话）。
 *
 * @param chatId  前台当前会话 id（空 ⇒ 调用方不该记）
 * @param lastSeq 服务端 `/api/history` 的 `last_seq`（≤0 ⇒ 还没有回合，不记）
 */
export async function markForegroundSeen(ctx: common.Context, chatId: string, lastSeq: number): Promise<void> {
  try {
    const key: string = turnKeyOf(chatId, lastSeq);
    if (key.length === 0) {
      return; // 还没回合 / 未知会话 ⇒ 无可记
    }
    const memo: ReconcileMemo = await loadMemo(ctx);
    // 只喂 turnKey（askId 传空 ⇒ 不动"已提醒的待答"）；`markSeen` 会顺手把 initialized 立起来。
    markSeen(memo, new ReconcileMark(false, key, '', chatId, chatId));
    await saveMemo(ctx, memo);
    hilog.info(DOMAIN, TAG, 'foreground seen saved: %{public}s', key);
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'markForegroundSeen failed: %{public}s', (e as BusinessError).message);
  }
}
